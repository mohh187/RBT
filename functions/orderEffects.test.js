// One runnable check for the paid-order membership block (functions/orderEffects.js).
// Points, tiers and pointsAwarded are money-adjacent and were never exercised
// anywhere on the server, so this drives processMembership against an in-memory
// stub of the few Firestore calls it makes. Run: `node functions/orderEffects.test.js`.
const assert = require('assert')
const path = require('path')
const { processMembership, phoneId } = require(path.join(__dirname, 'orderEffects.js'))

// ---- the customer's document id must match what the browser computes ----
assert.strictEqual(phoneId('0501234567'), '966501234567')
assert.strictEqual(phoneId('501234567'), '966501234567')
assert.strictEqual(phoneId('+966 50 123 4567'), '966501234567')
assert.strictEqual(phoneId('00966501234567'), '966501234567')
assert.strictEqual(phoneId(''), '')

// ---- in-memory Firestore ----
function makeDb(seed = {}) {
  const store = { ...seed }
  const added = []
  const docRef = (p) => ({
    _p: p,
    get: async () => ({ exists: p in store, data: () => store[p] }),
    set: async (v, o) => { store[p] = o && o.merge ? { ...(store[p] || {}), ...v } : v },
  })
  return {
    store, added,
    doc: docRef,
    collection: (p) => ({ add: async (v) => { added.push({ p, v }); return { id: 'x' } } }),
    runTransaction: async (fn) => fn({
      get: async (r) => ({ exists: r._p in store, data: () => store[r._p] }),
      set: (r, v, o) => { store[r._p] = o && o.merge ? { ...(store[r._p] || {}), ...v } : v },
    }),
  }
}

const TENANT = { membershipPolicy: { enabled: true, minOrders: 5, earnRate: 1, tierBy: 'orders' } }
const CUST = 'tenants/t1/customers/966501234567'
const order = { customerPhone: '0501234567', total: 120 }

;(async () => {
  // A customer past the auto-grant threshold becomes a member and earns.
  const db = makeDb({ [CUST]: { totalOrders: 10, totalSpent: 900, name: 'ضيف' } })
  const m = await processMembership(db, 't1', 'o1', order, TENANT)
  assert.ok(m && m.active, 'membership granted')
  assert.strictEqual(m.points, 120)
  assert.strictEqual(m.pointsLifetime, 120)
  assert.strictEqual(m.tier, 'gold', '10 completed orders is gold')
  assert.strictEqual(db.store['tenants/t1/orders/o1'].pointsAwarded, 120, 'the reversal needs this stamp')
  assert.ok(db.store[`tenants/t1/memberCards/${m.token}`], 'public card mirror written')
  assert.ok(db.store['tenants/t1/memberPhones/966501234567'], 'phone lookup mirror written')
  assert.strictEqual(db.added.filter((a) => a.p.endsWith('loyaltyLog')).length, 1)

  // The same order must never earn twice, whichever side ran first.
  const before = db.store[CUST].membership.points
  await processMembership(db, 't1', 'o1', order, TENANT)
  assert.strictEqual(db.store[CUST].membership.points, before, 'same order earns once')

  // Not eligible yet, and no policy: nothing happens either way.
  const db2 = makeDb({ [CUST]: { totalOrders: 1, totalSpent: 40 } })
  assert.strictEqual(await processMembership(db2, 't1', 'o2', order, TENANT), null)
  assert.strictEqual(await processMembership(makeDb(), 't1', 'o3', order, {}), null)

  console.log('orderEffects membership: OK')
})()
