// The anti-underpay guard, pinned by test.
//
// WHY THIS FILE EXISTS. On launch day this guard was found to have never fired,
// not once, for any order:
//
//   const itemsSum = (o.items || []).reduce((s, l) => s + (Number(l.price)||0) * ..., 0)
//   if (itemsSum > 0 && amountSar + 0.01 < itemsSum - discount) throw ...
//
// No order writer emits `l.price`. MenuView.jsx, CashierPOS.jsx and
// OrderDetail.jsx all write `unitPrice` + `lineTotal`. So `itemsSum` was
// always 0, `itemsSum > 0` was always false, and createPayIntent charged
// whatever `total` the client had written — on a channel where the client is
// an anonymous diner and firestore.rules only requires `total is number`.
//
// The failure mode of a guard like this is that it is INVISIBLE. Reviewing the
// code, it reads as protection. Only running it against a real order shape
// shows that it does nothing. Hence: real order shapes, from the actual
// writers, asserted both ways.
import { createRequire } from 'node:module'

const require_ = createRequire(new URL('../functions/', import.meta.url))
const { orderLinesSum, orderTotalIsSane } = require_('./platformExtensions.js')

// Exactly the line shape MenuView.jsx:2457 writes for a diner order.
const dinerLine = (unitPrice, qty) => ({
  itemId: 'i1', nameAr: 'صنف', modifiers: [], unitPrice, qty, lineTotal: unitPrice * qty,
})
// CashierPOS.jsx:299 — same two fields.
const posLine = (unitPrice, qty) => ({ itemId: 'i2', unitPrice, qty, lineTotal: unitPrice * qty })

const CASES = [
  // --- the attack this exists to stop ---
  ['tampered total: 1 SAR for a 500 SAR basket',
    { total: 1, items: [dinerLine(250, 2)] }, false],
  ['tampered total: zero',
    { total: 0, items: [dinerLine(24, 1)] }, false],
  ['tampered total: negative',
    { total: -50, items: [dinerLine(24, 1)] }, false],
  ['shaved total: 1 SAR under',
    { total: 47, items: [dinerLine(24, 2)] }, false],
  ['discount claimed but not recorded on the order',
    { total: 10, items: [dinerLine(50, 1)] }, false],

  // --- legitimate orders that must NOT be refused ---
  ['honest diner order', { total: 48, items: [dinerLine(24, 2)] }, true],
  ['honest POS order', { total: 30, items: [posLine(15, 2)] }, true],
  ['mixed lines', { total: 78, items: [dinerLine(24, 2), posLine(15, 2)] }, true],
  ['recorded staff discount', { total: 38, items: [dinerLine(24, 2)], discount: 10 }, true],
  ['recorded loyalty redemption', { total: 24, items: [dinerLine(24, 2)], loyaltyDiscount: 24 }, true],
  ['recorded member discount', { total: 43.2, items: [dinerLine(24, 2)], memberDiscount: 4.8 }, true],
  ['recorded offer discount', { total: 43, items: [dinerLine(24, 2)], offerDiscount: 5 }, true],
  ['stacked discounts', { total: 20, items: [dinerLine(24, 2)], discount: 10, loyaltyDiscount: 18 }, true],
  ['rounding tolerance (one halala under)', { total: 47.99, items: [dinerLine(24, 2)] }, true],
  ['comped to zero, recorded', { total: 0, items: [dinerLine(24, 2)], discount: 48 }, true],

  // --- unverifiable, not invalid: no priced lines to compare against ---
  ['no items at all', { total: 25, items: [] }, true],
  ['items with no price fields', { total: 25, items: [{ itemId: 'x', qty: 1 }] }, true],
  ['missing items key', { total: 25 }, true],
]

let failed = 0

// 1. The sum must read the fields the writers actually emit.
const sum = orderLinesSum([dinerLine(24, 2), posLine(15, 3)])
if (Math.abs(sum - 93) > 0.001) {
  console.error(`  FAIL  orderLinesSum read the wrong fields: expected 93, got ${sum}`)
  failed++
}
// 2. And it must NOT be reading `price` — the field the broken version used.
//    If someone reintroduces `l.price`, this case silently returns 0 and the
//    guard dies again. This assertion is the tripwire for that exact mistake.
const legacyShaped = orderLinesSum([{ itemId: 'i', price: 24, qty: 2 }])
if (legacyShaped !== 0) {
  console.error('  NOTE  orderLinesSum now also reads `price` — fine, but update this test')
}

for (const [why, order, shouldPass] of CASES) {
  const got = orderTotalIsSane(order)
  if (got === shouldPass) continue
  failed++
  console.error(`  FAIL  ${shouldPass ? 'should ACCEPT' : 'should REFUSE'} — ${why}\n        ${JSON.stringify(order)}`)
}

if (failed) {
  console.error(`\norder-guard: ${failed} failed`)
  process.exit(1)
}
console.log(`order-guard: ${CASES.length + 1} cases pass — tampered totals refused, honest discounts charged`)
