// ==================== WHAT HAPPENS WHEN AN ORDER IS PAID ====================
//
// WHY THIS EXISTS. Every consequence of payment — raw materials leaving the
// store, loyalty progress, the customer's record — lived ONLY in the browser
// (src/lib/db.js triggerPostPaymentEffects), reached ONLY from
// updateOrderStatus(status:'paid').
//
// An online order never takes that path. The server settles it with
// paidOnline:true while `status` stays on the kitchen track, and the cashier is
// told explicitly not to collect for it — so the order ends its life at
// 'served' and NONE of the effects ever ran. A venue could take online money
// all day and read back zero material usage, zero loyalty, and a customer list
// that never grew.
//
// The effects belong on the server anyway. The client version depends on a
// browser being open at the moment of settlement; for a pay-first order the
// guest's tab may already be closed, and the venue's may never have been open.
//
// ── IDEMPOTENCY IS SHARED WITH THE CLIENT, DELIBERATELY ──────────────────
// A cash order still runs the client effects AND fires this trigger. Both claim
// the SAME `sideEffectsTriggered` flag in the SAME transactional way, so
// whichever arrives first does the work and the other becomes a no-op. That is
// why this file must not invent its own flag: two guards over one action is how
// you get two deductions.
const { FieldValue } = require('firebase-admin/firestore')

// Claim the right to run the effects, exactly once, for this order.
// Mirrors triggerPostPaymentEffects in src/lib/db.js — same field, same shape.
async function claimSideEffects(db, tid, oid) {
  const ref = db.doc(`tenants/${tid}/orders/${oid}`)
  let claimed = false
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return
    if (snap.data().sideEffectsTriggered) return
    tx.update(ref, { sideEffectsTriggered: true })
    claimed = true
  })
  return claimed
}

// Consume raw materials by recipe and log the movements.
// Port of consumeForOrder (src/lib/db.js) — `materialUsage` is the second,
// narrower guard: it is what makes a retry safe even if the caller loses track.
async function consumeMaterials(db, tid, oid, order, actor) {
  if (!order || order.materialUsage) return null
  const lines = order.items || []
  const ids = [...new Set(lines.map((l) => l.itemId).filter(Boolean))]
  const itemDocs = {}
  await Promise.all(ids.map(async (id) => {
    const s = await db.doc(`tenants/${tid}/items/${id}`).get().catch(() => null)
    if (s && s.exists) itemDocs[id] = s.data()
  }))

  const usage = {}
  const add = (recipe, qty) => (recipe || []).forEach((r) => {
    if (r && r.materialId) usage[r.materialId] = (usage[r.materialId] || 0) + (Number(r.qty) || 0) * (qty || 1)
  })
  lines.forEach((line) => {
    const it = itemDocs[line.itemId]
    if (it && it.stockMode === 'recipe') {
      const recipe = (line.variantKey && it.variantRecipes && it.variantRecipes[line.variantKey]) || it.recipe || []
      add(recipe, line.qty)
    }
    ;(line.modifiers || []).forEach((mod) => add(mod && mod.recipe, line.qty))
  })

  const entries = Object.entries(usage).filter(([, q]) => q > 0)
  // Marked consumed even when empty — an order with no recipe items must not be
  // re-examined on every retry.
  await db.doc(`tenants/${tid}/orders/${oid}`).set({ materialUsage: usage }, { merge: true })
  if (!entries.length) return usage

  await Promise.all(entries.map(([mid, q]) =>
    db.doc(`tenants/${tid}/materials/${mid}`).update({ stockQty: FieldValue.increment(-q) }).catch(() => {})
  ))
  await Promise.all(entries.map(([mid, q]) =>
    db.collection(`tenants/${tid}/stockMoves`).add({
      type: 'sale', materialId: mid, qty: -q, orderId: oid,
      byName: actor || '', at: Date.now(), createdAt: FieldValue.serverTimestamp(),
    }).catch(() => {})
  ))
  return usage
}

// The guest's record and their loyalty progress.
// Port of upsertCustomerOnOrder (src/lib/db.js) — the arithmetic is copied
// exactly, including that a redeemed reward is spent BEFORE new ones are earned.
async function upsertCustomer(db, tid, order, tenant) {
  const phone = String((order && order.customerPhone) || '')
  const digits = phone.replace(/[^0-9]/g, '')
  if (!digits) return null

  const t = tenant || {}
  const threshold = Number(t.loyaltyThreshold) || 5
  const loyaltyEnabled = t.loyaltyEnabled !== false
  const redeemReward = !!order.loyaltyRedeemed || (Number(order.loyaltyDiscount) || 0) > 0
  const drinks = Number(order.drinkUnits) || 0

  const ref = db.doc(`tenants/${tid}/customers/${digits}`)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const d = snap.exists ? snap.data() : {}
    let rewards = Number(d.rewards) || 0
    if (redeemReward && rewards > 0) rewards -= 1
    let progress = (Number(d.loyaltyDrinks) || 0) + drinks
    if (loyaltyEnabled && threshold > 0) {
      rewards += Math.floor(progress / threshold)
      progress = progress % threshold
    }
    const base = {
      name: order.customerName || d.name || '',
      phone: digits,
      totalOrders: (Number(d.totalOrders) || 0) + 1,
      totalSpent: (Number(d.totalSpent) || 0) + (Number(order.total) || 0),
      totalDrinks: (Number(d.totalDrinks) || 0) + drinks,
      loyaltyDrinks: progress,
      rewards,
      lastOrderAt: FieldValue.serverTimestamp(),
    }
    if (!snap.exists) base.firstOrderAt = FieldValue.serverTimestamp()
    tx.set(ref, base, { merge: true })
  })
  return digits
}

// Everything that must happen once, when the money has actually moved.
// Returns what it did so the caller can log or alert on a partial run.
async function runPaidEffects(db, tid, oid, order, { tenant, actor } = {}) {
  if (!(await claimSideEffects(db, tid, oid))) return { skipped: 'already-run' }
  const out = { materials: null, customer: null, errors: [] }
  try {
    out.materials = await consumeMaterials(db, tid, oid, order, actor)
  } catch (e) { out.errors.push('materials: ' + ((e && e.message) || e)) }
  try {
    out.customer = await upsertCustomer(db, tid, order, tenant)
  } catch (e) { out.errors.push('customer: ' + ((e && e.message) || e)) }
  return out
}

module.exports = { claimSideEffects, consumeMaterials, upsertCustomer, runPaidEffects }
