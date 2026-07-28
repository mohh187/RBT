// One-shot backfill: staffInvites/{email} → staffInvites/{email}__{tenantId}
//
// The old id was the bare email, which allowed exactly one pending invite per
// address across the entire platform. The new id is per venue, and the address
// now also lives in an `email` FIELD because that is what the claim callable
// queries and what the invite-email trigger reads.
//
// Safe by construction: writes the new doc, verifies it, and only then deletes
// the old one. Dry-run unless --apply is passed.
//
//   node scripts/migrate-staff-invites.mjs            # report only
//   node scripts/migrate-staff-invites.mjs --apply    # actually migrate
//
// Requires GOOGLE_APPLICATION_CREDENTIALS or an authenticated gcloud ADC.
//
// firebase-admin lives in functions/node_modules (it is a server dependency and
// deliberately not a root one), so it is resolved from there.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { initializeApp, applicationDefault } = require('../functions/node_modules/firebase-admin/lib/app/index.js')
const { getFirestore } = require('../functions/node_modules/firebase-admin/lib/firestore/index.js')

const APPLY = process.argv.includes('--apply')
const PROJECT = process.env.GCLOUD_PROJECT || 'menu-88996'

initializeApp({ credential: applicationDefault(), projectId: PROJECT })
const db = getFirestore()

const isLegacyId = (id) => !id.includes('__')

const snap = await db.collection('staffInvites').get()
console.log(`staffInvites: ${snap.size} documents\n`)

let migrated = 0
let skipped = 0
let broken = 0

for (const d of snap.docs) {
  const inv = d.data() || {}
  if (!isLegacyId(d.id)) { skipped += 1; continue }

  const email = String(inv.email || d.id).trim().toLowerCase()
  const tid = inv.tenantId
  if (!tid || !email.includes('@')) {
    // An invite with no tenant cannot be claimed by anyone and never could be.
    console.log(`  BROKEN  ${d.id} — tenantId=${tid || 'none'} email=${email || 'none'}`)
    broken += 1
    continue
  }

  const newId = `${email}__${tid}`
  console.log(`  ${APPLY ? 'MIGRATE' : 'would  '} ${d.id}  ->  ${newId}`)
  if (!APPLY) { migrated += 1; continue }

  await db.doc(`staffInvites/${newId}`).set({ ...inv, email }, { merge: true })
  // Verify before destroying the original — a failed write followed by a
  // delete would silently lose someone's invite.
  const check = await db.doc(`staffInvites/${newId}`).get()
  if (check.exists) {
    await d.ref.delete()
    migrated += 1
  } else {
    console.log(`  FAILED to write ${newId} — original kept`)
    broken += 1
  }
}

console.log(`\n${APPLY ? 'migrated' : 'would migrate'}: ${migrated} · already new: ${skipped} · broken: ${broken}`)
if (!APPLY) console.log('\nDry run. Re-run with --apply to write.')
process.exit(0)
