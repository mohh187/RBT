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
const crypto = require('crypto')

// THE CUSTOMER'S DOCUMENT ID, THE SAME WAY THE BROWSER COMPUTES IT.
//
// The client keys customers/, memberPhones/ and every lookup by
// phoneId() = normalizePhone(phone) — '0501234567' becomes '966501234567'.
// This file used to key by the raw digits, so an online order wrote a SECOND,
// shadow customer record beside the real one: the guest's history never grew,
// their card was never found by phone, and their loyalty sat in a doc nothing
// reads. Port of normalizePhone/phoneId (src/lib/format.js, src/lib/db.js).
function phoneId(phone) {
  let d = String(phone || '').replace(/[^0-9]/g, '')
  if (!d) return ''
  d = d.replace(/^00/, '')
  if (d.startsWith('966')) return d
  if (d.startsWith('0') && d.length === 10) return '966' + d.slice(1)
  if (d.length === 9 && d.startsWith('5')) return '966' + d
  return d
}

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
  const digits = phoneId((order && order.customerPhone) || '')
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

// ---- VIP membership: points, tiers, the card ----------------------------
//
// NOBODY WAS EVER AWARDED A POINT. processMembershipOnPaid (src/lib/db.js) had
// exactly one call site, in the cashier POS, and nothing on the server touched
// `points` at all. Every other channel — online, KDS close, terminal — settled
// without it, so tiers never moved and `pointsAwarded` was never stamped, which
// in turn meant a cancel or a refund always reversed zero.
//
// The arithmetic below is a straight port of src/lib/membership.js and
// processMembershipOnPaid. It must stay a copy, not an improvement: the browser
// still runs the same block for a cash order, and whichever side gets there
// first must reach the same number. `lastEarnOrderId` is what keeps the two
// from double-earning.
const DEFAULT_POLICY = {
  enabled: false, minOrders: 5, minSpent: 0, minAvgBasket: 0,
  earnRate: 1, pointsExpiryDays: 0, pointsMultiplier: 1, birthdayBonus: 0,
  tierBy: 'orders',
  tiers: {
    silver: { minPoints: 0, minOrders: 0, discountPct: 5 },
    gold: { minPoints: 500, minOrders: 10, discountPct: 10 },
    platinum: { minPoints: 1500, minOrders: 15, discountPct: 15 },
  },
}
function membershipPolicy(tenant) {
  const p = (tenant && tenant.membershipPolicy) || {}
  const tiers = p.tiers || {}
  return {
    ...DEFAULT_POLICY,
    ...p,
    tiers: {
      silver: { ...DEFAULT_POLICY.tiers.silver, ...(tiers.silver || {}) },
      gold: { ...DEFAULT_POLICY.tiers.gold, ...(tiers.gold || {}) },
      platinum: { ...DEFAULT_POLICY.tiers.platinum, ...(tiers.platinum || {}) },
    },
  }
}
function tierForPoints(policy, pointsLifetime = 0, totalOrders = null) {
  const t = policy.tiers
  if (policy.tierBy === 'orders' && totalOrders != null) {
    if (totalOrders >= (t.platinum.minOrders != null ? t.platinum.minOrders : 15)) return { tier: 'platinum', discountPct: t.platinum.discountPct }
    if (totalOrders >= (t.gold.minOrders != null ? t.gold.minOrders : 10)) return { tier: 'gold', discountPct: t.gold.discountPct }
    return { tier: 'silver', discountPct: t.silver.discountPct }
  }
  if (pointsLifetime >= t.platinum.minPoints) return { tier: 'platinum', discountPct: t.platinum.discountPct }
  if (pointsLifetime >= t.gold.minPoints) return { tier: 'gold', discountPct: t.gold.discountPct }
  return { tier: 'silver', discountPct: t.silver.discountPct }
}
function isEligible(policy, c = {}) {
  const orders = c.totalOrders || 0
  const spent = c.totalSpent || 0
  const avg = orders ? spent / orders : 0
  return orders >= (policy.minOrders || 0) && spent >= (policy.minSpent || 0) && avg >= (policy.minAvgBasket || 0)
}
const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
function randomToken(len = 12) {
  const bytes = crypto.randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length]
  return out
}
function newMembership(policy, source, token) {
  const s = String(token).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  return {
    active: true, tier: 'silver', memberId: `NEM-${(s || 'XXXXXX').slice(0, 6)}`, token,
    points: 0, pointsLifetime: 0, pointsRedeemed: 0,
    discountPct: (policy.tiers && policy.tiers.silver && policy.tiers.silver.discountPct) || 5,
    source, joinedAt: Date.now(), lastEarnAt: 0, lastEarnOrderId: '',
  }
}
// The two public mirrors (memberCards/{token}, memberPhones/{phoneId}) let a
// diner open their card and be recognized by phone without reading customers/.
function memberCardFields(d, m) {
  return {
    phone: d.phone || '', name: d.name || '',
    tier: m.tier, memberId: m.memberId, discountPct: m.discountPct || 0,
    points: m.points || 0, pointsLifetime: m.pointsLifetime || 0,
    totalOrders: d.totalOrders || 0, totalSpent: d.totalSpent || 0,
    active: m.active !== false, updatedAt: Date.now(),
  }
}
function memberPhoneFields(m) {
  return { token: m.token, active: m.active !== false, discountPct: m.discountPct || 0, tier: m.tier || '', updatedAt: Date.now() }
}

async function processMembership(db, tid, oid, order, tenant) {
  const policy = membershipPolicy(tenant)
  const pid = phoneId((order && order.customerPhone) || '')
  if (!pid || !policy.enabled) return null

  const ref = db.doc(`tenants/${tid}/customers/${pid}`)
  let earned = 0
  let bday = 0
  let member = null
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const d = snap.exists ? snap.data() : {}
    let m = d.membership || null
    if (!(m && m.active) && isEligible(policy, d)) m = newMembership(policy, 'auto', randomToken(12))
    if (!(m && m.active)) return
    // Lazy expiry of the redeemable balance after N idle days (tier preserved).
    if (policy.pointsExpiryDays > 0 && m.lastEarnAt && (Date.now() - m.lastEarnAt) > policy.pointsExpiryDays * 86400000) m = { ...m, points: 0 }
    if (m.lastEarnOrderId !== oid) {
      earned = Math.round((Number(order.total) || 0) * (policy.earnRate || 1) * (policy.pointsMultiplier || 1))
      const lifetime = (m.pointsLifetime || 0) + earned
      const points = (m.points || 0) + earned
      const { tier, discountPct } = tierForPoints(policy, lifetime, d.totalOrders || 0)
      m = { ...m, points, pointsLifetime: lifetime, tier, discountPct, lastEarnOrderId: oid, lastEarnAt: Date.now() }
      // The EXACT points this order gave, multiplier included, so a later
      // cancel or refund reverses this amount and not a recomputed guess.
      tx.set(db.doc(`tenants/${tid}/orders/${oid}`), { pointsAwarded: earned }, { merge: true })
    }
    const custPatch = { membership: m }
    const bonus = Number(policy.birthdayBonus) || 0
    if (bonus > 0 && d.birthday) {
      const now = new Date()
      const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      if (d.birthday === md && d.lastBdayYear !== now.getFullYear()) {
        const lifetime = (m.pointsLifetime || 0) + bonus
        const points = (m.points || 0) + bonus
        const { tier, discountPct } = tierForPoints(policy, lifetime, d.totalOrders || 0)
        m = { ...m, points, pointsLifetime: lifetime, tier, discountPct }
        custPatch.membership = m
        custPatch.lastBdayYear = now.getFullYear()
        bday = bonus
      }
    }
    tx.set(ref, custPatch, { merge: true })
    tx.set(db.doc(`tenants/${tid}/memberCards/${m.token}`), memberCardFields({ ...d, phone: pid }, m), { merge: true })
    tx.set(db.doc(`tenants/${tid}/memberPhones/${pid}`), memberPhoneFields(m), { merge: true })
    member = m
  })
  // The statement the member reads (mirrors logLoyalty in src/lib/db.js).
  const log = (points, byName, orderId) => db.collection(`tenants/${tid}/loyaltyLog`).add({
    phoneId: pid, memberId: (member && member.memberId) || '', type: 'earn',
    points: Number(points) || 0, orderId: orderId || '', byName: byName || '',
    at: Date.now(), createdAt: FieldValue.serverTimestamp(),
  }).catch(() => {})
  if (member && earned > 0) await log(earned, '', oid)
  if (member && bday > 0) await log(bday, 'birthday', '')
  return member
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
  try {
    // AFTER upsertCustomer, never before: the tier is ranked on totalOrders,
    // which the line above has just incremented for this very order.
    out.member = await processMembership(db, tid, oid, order, tenant)
  } catch (e) { out.errors.push('membership: ' + ((e && e.message) || e)) }
  return out
}

module.exports = { claimSideEffects, consumeMaterials, upsertCustomer, processMembership, runPaidEffects, phoneId }
