// Rules test for the STAFF SIGN-IN PATH.
//
// Why this file exists: a hardened ruleset was deployed once without being run
// against the real sequence of reads a staffer performs, and it took staff PIN
// sign-in down in production. Nothing about rules may be deployed again without
// this passing first.
//
//   npm run test:rules      (needs Java 17+, JAVA_HOME set)
//
// It drives the EXACT calls src/lib/auth.jsx loadContext makes after a PIN
// sign-in, in order, plus the writes the app performs right afterwards, and it
// separately proves the holes the audit found are actually closed.
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing'
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where,
} from 'firebase/firestore'

const TID = 'venue1'
const WAITER = 'waiterUid'
const OWNER = 'ownerUid'
const OTHER = 'otherUid'

let pass = 0
let fail = 0
const check = async (name, p) => {
  try { await p; pass += 1; console.log(`  ok   ${name}`) } catch (e) {
    fail += 1
    console.log(`  FAIL ${name}\n       ${String(e).split('\n')[0].slice(0, 160)}`)
  }
}

const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
})

// ---- seed the world the way a real venue looks, bypassing rules ----
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users', WAITER), { tenantId: TID, role: 'waiter', email: 'w@x.co' })
  await setDoc(doc(db, 'users', OWNER), { tenantId: TID, role: 'owner', email: 'o@x.co' })
  await setDoc(doc(db, 'users', OTHER), { tenantId: TID, role: 'cashier', email: 'c@x.co' })
  await setDoc(doc(db, 'tenants', TID), { name: 'Venue', ownerUid: OWNER, active: true })
  await setDoc(doc(db, 'tenants', TID, 'staff', WAITER), { name: 'W', role: 'waiter', active: true })
  await setDoc(doc(db, 'tenants', TID, 'staff', OWNER), { name: 'O', role: 'owner', active: true, salary: 9000 })
  await setDoc(doc(db, 'tenants', TID, 'staff', OTHER), { name: 'C', role: 'cashier', active: true })
  await setDoc(doc(db, 'tenants', TID, 'orders', 'o1'), { status: 'paid', total: 100, code: 1 })
  await setDoc(doc(db, 'tenants', TID, 'orders', 'o2'), { status: 'pending', total: 60, code: 2 })
  await setDoc(doc(db, 'tenants', TID, 'customers', '966500000000'), { name: 'G', phone: '0500000000' })
  await setDoc(doc(db, 'screens', 'CODE1'), { tid: TID, name: 'TV' })
  await setDoc(doc(db, 'tenants', TID, 'pushTokens', 'tok1'), { token: 't', uid: WAITER })
})

const waiter = env.authenticatedContext(WAITER).firestore()
const owner = env.authenticatedContext(OWNER).firestore()
const anon = env.unauthenticatedContext().firestore()

console.log('\nA. THE PIN SIGN-IN PATH (loadContext, in order)')
await check('waiter reads platformAdmins/self', assertSucceeds(getDoc(doc(waiter, 'platformAdmins', WAITER))))
await check('waiter reads own users doc', assertSucceeds(getDoc(doc(waiter, 'users', WAITER))))
await check('waiter reads the tenant doc', assertSucceeds(getDoc(doc(waiter, 'tenants', TID))))
await check('waiter self-registers staff doc (upsertStaffMember)', assertSucceeds(
  setDoc(doc(waiter, 'tenants', TID, 'staff', WAITER), { name: 'W', email: 'w@x.co', role: 'waiter', active: true }, { merge: true }),
))
await check('waiter reads own staff doc (caps)', assertSucceeds(getDoc(doc(waiter, 'tenants', TID, 'staff', WAITER))))
await check('waiter saves a push token for itself', assertSucceeds(
  setDoc(doc(waiter, 'tenants', TID, 'pushTokens', 'tokW'), { token: 'x', uid: WAITER, ua: 'ua' }),
))

console.log('\nB. THE FLOOR (what a waiter does all shift)')
await check('waiter lists the staff roster (PIN lock screen)', assertSucceeds(getDocs(collection(waiter, 'tenants', TID, 'staff'))))
await check('waiter lists orders', assertSucceeds(getDocs(collection(waiter, 'tenants', TID, 'orders'))))
await check('waiter accepts a pending order', assertSucceeds(
  updateDoc(doc(waiter, 'tenants', TID, 'orders', 'o2'), { status: 'accepted' }),
))
// a settled order must never be resurrected by a stale offline write
await check('paid order cannot be flipped back to accepted', assertFails(
  updateDoc(doc(waiter, 'tenants', TID, 'orders', 'o1'), { status: 'accepted' }),
))
await check('waiter reads ONE customer by phone id (POS lookup)', assertSucceeds(
  getDoc(doc(waiter, 'tenants', TID, 'customers', '966500000000')),
))
await check('paired TV reads its own screen by code', assertSucceeds(getDoc(doc(anon, 'screens', 'CODE1'))))
await check('staff lists screens filtered by tid', assertSucceeds(
  getDocs(query(collection(owner, 'screens'), where('tid', '==', TID))),
))

console.log('\nC. THE HOLES (each MUST be denied)')
await check('anon cannot list every venue’s screens', assertFails(getDocs(collection(anon, 'screens'))))
await check('waiter cannot hijack another user’s push token', assertFails(
  setDoc(doc(waiter, 'tenants', TID, 'pushTokens', 'tokO'), { token: 'y', uid: OWNER }),
))
await check('waiter cannot delete someone else’s push token', assertFails(
  deleteDoc(doc(waiter, 'tenants', TID, 'pushTokens', 'tok1x')),
))
await check('consent record cannot be filed under another uid', assertFails(
  setDoc(doc(waiter, 'platformConsent', 'c1'), { tenantId: TID, uid: OWNER, byName: 'x', kind: 'legal-acceptance', docs: ['a'], version: 1, at: 1 }),
))
await check('consent record with junk keys is refused', assertFails(
  setDoc(doc(waiter, 'platformConsent', 'c2'), { uid: WAITER, junk: 'x'.repeat(500) }),
))
await check('a real consent record still records', assertSucceeds(
  setDoc(doc(waiter, 'platformConsent', 'c3'), { tenantId: TID, uid: WAITER, byName: 'W', kind: 'legal-acceptance', docs: ['terms'], version: 1, at: 1 }),
))

console.log('\nD. SUSPENSION (only meaningful once staffActive ships)')
await env.withSecurityRulesDisabled(async (ctx) => {
  await updateDoc(doc(ctx.firestore(), 'tenants', TID, 'staff', OTHER), { active: false })
})
const suspended = env.authenticatedContext(OTHER).firestore()
const suspendedBlocked = await getDocs(collection(suspended, 'tenants', TID, 'orders')).then(() => false).catch(() => true)
console.log(`  ${suspendedBlocked ? 'ok   ' : 'INFO '}suspended staffer blocked from orders: ${suspendedBlocked}`)

await env.cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
