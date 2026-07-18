// VIP membership / loyalty-card logic (pure — no Firestore).
// Sits ON TOP of the existing punch-card loyalty (rewards/loyaltyDrinks):
// membership points are a SEPARATE currency and never touch `rewards`.

export const DEFAULT_MEMBERSHIP_POLICY = {
  enabled: false, // off until the manager enables it
  minOrders: 5, // auto-grant: completed-orders threshold (5 orders = active member)
  minSpent: 0, // auto-grant: lifetime spend threshold
  minAvgBasket: 0, // auto-grant: avg basket threshold
  earnRate: 1, // points earned per 1 currency unit paid
  redeemRate: 20, // points needed for 1 currency unit of discount
  pointsExpiryDays: 0, // 0 = points never expire; else expire the balance after N idle days
  memberSelfDiscount: true, // false = tier discount applies ONLY when staff scans the card (anti-share)
  pointsMultiplier: 1, // promo multiplier on earned points (e.g. 2 = double points)
  birthdayBonus: 0, // bonus points granted once a year on the member's birthday
  // What promotes a member: 'orders' = completed orders count (5 → silver active,
  // 10 → gold, 15 → platinum by default); 'points' = lifetime points (legacy).
  tierBy: 'orders',
  // HOW loyalty rewards members — the venue picks its own policy:
  //  'discounts' = standing tier discounts (classic, the fields above/below)
  //  'perks'     = NO discounts; tiers unlock privileged notifications instead
  //                (new offers, featured items, new dishes) sent automatically
  //                via WhatsApp + in-menu notices per the perks matrix below.
  mode: 'discounts',
  perks: {
    silver: { offers: true, featured: false, newItems: false },
    gold: { offers: true, featured: true, newItems: false },
    platinum: { offers: true, featured: true, newItems: true },
  },
  tiers: {
    silver: { minPoints: 0, minOrders: 0, discountPct: 5 },
    gold: { minPoints: 500, minOrders: 10, discountPct: 10 },
    platinum: { minPoints: 1500, minOrders: 15, discountPct: 15 },
  },
}

export const TIER_META = {
  silver: { ar: 'فضي', en: 'Silver', icon: 'award', color: '#9aa3ad' },
  gold: { ar: 'ذهبي', en: 'Gold', icon: 'award', color: '#e0a82e' },
  platinum: { ar: 'بلاتيني', en: 'Platinum', icon: 'award', color: '#7db3c9' },
}

const TIER_ORDER = ['silver', 'gold', 'platinum']

// Merge a tenant's saved policy over the defaults (deep for tiers + perks).
export function resolveMembershipPolicy(tenant) {
  const p = tenant?.membershipPolicy || {}
  const tiers = p.tiers || {}
  const perks = p.perks || {}
  return {
    ...DEFAULT_MEMBERSHIP_POLICY,
    ...p,
    tiers: {
      silver: { ...DEFAULT_MEMBERSHIP_POLICY.tiers.silver, ...(tiers.silver || {}) },
      gold: { ...DEFAULT_MEMBERSHIP_POLICY.tiers.gold, ...(tiers.gold || {}) },
      platinum: { ...DEFAULT_MEMBERSHIP_POLICY.tiers.platinum, ...(tiers.platinum || {}) },
    },
    perks: {
      silver: { ...DEFAULT_MEMBERSHIP_POLICY.perks.silver, ...(perks.silver || {}) },
      gold: { ...DEFAULT_MEMBERSHIP_POLICY.perks.gold, ...(perks.gold || {}) },
      platinum: { ...DEFAULT_MEMBERSHIP_POLICY.perks.platinum, ...(perks.platinum || {}) },
    },
  }
}

// Standing discount only exists in 'discounts' mode — perks-mode members get
// privileges (notifications) instead, never a price cut.
export function memberDiscountAllowed(policy) {
  return (policy?.mode || 'discounts') !== 'perks'
}

// Tier (and its standing discount). Ranks by COMPLETED ORDERS when the policy
// says tierBy 'orders' (pass totalOrders), else by lifetime points (legacy).
// Backward-compatible: old two-arg calls behave exactly as before for 'points'.
export function tierForPoints(policy, pointsLifetime = 0, totalOrders = null) {
  const t = policy.tiers
  if (policy.tierBy === 'orders' && totalOrders != null) {
    if (totalOrders >= (t.platinum.minOrders ?? 15)) return { tier: 'platinum', discountPct: t.platinum.discountPct }
    if (totalOrders >= (t.gold.minOrders ?? 10)) return { tier: 'gold', discountPct: t.gold.discountPct }
    return { tier: 'silver', discountPct: t.silver.discountPct }
  }
  if (pointsLifetime >= t.platinum.minPoints) return { tier: 'platinum', discountPct: t.platinum.discountPct }
  if (pointsLifetime >= t.gold.minPoints) return { tier: 'gold', discountPct: t.gold.discountPct }
  return { tier: 'silver', discountPct: t.silver.discountPct }
}

// Auto-grant eligibility (evaluated on post-order customer stats).
export function isEligible(policy, c = {}) {
  const orders = c.totalOrders || 0
  const spent = c.totalSpent || 0
  const avg = orders ? spent / orders : 0
  return orders >= (policy.minOrders || 0) && spent >= (policy.minSpent || 0) && avg >= (policy.minAvgBasket || 0)
}

export function genMemberId(token = '') {
  const s = String(token).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  return `NEM-${(s || 'XXXXXX').slice(0, 6)}`
}

// Fresh membership object (silver, 0 points). Caller supplies a random token.
export function newMembership(policy, source = 'manual', token = '') {
  return {
    active: true,
    tier: 'silver',
    memberId: genMemberId(token),
    token,
    points: 0,
    pointsLifetime: 0,
    pointsRedeemed: 0,
    discountPct: policy?.tiers?.silver?.discountPct ?? 5,
    source,
    joinedAt: Date.now(),
    lastEarnAt: 0,
    lastEarnOrderId: '',
  }
}

// Points -> discount currency amount.
export function pointsToDiscount(policy, points = 0) {
  const rate = policy.redeemRate || 20
  return rate > 0 ? points / rate : 0
}
// Discount currency amount -> points needed.
export function discountToPoints(policy, amount = 0) {
  const rate = policy.redeemRate || 20
  return Math.ceil(amount * rate)
}

// Standing tier discount amount for a subtotal.
export function tierDiscountAmount(membership, subtotal = 0) {
  const pct = membership?.discountPct || 0
  return Math.round(((subtotal * pct) / 100) * 100) / 100
}

// Progress to the next tier: { next, need, have, remaining, by } or null at the
// top. In 'orders' mode (totalOrders passed) it counts completed orders.
export function nextTierProgress(policy, pointsLifetime = 0, totalOrders = null) {
  const byOrders = policy.tierBy === 'orders' && totalOrders != null
  const cur = tierForPoints(policy, pointsLifetime, totalOrders).tier
  const idx = TIER_ORDER.indexOf(cur)
  if (idx >= TIER_ORDER.length - 1) return null
  const next = TIER_ORDER[idx + 1]
  const need = byOrders ? (policy.tiers[next].minOrders ?? 0) : policy.tiers[next].minPoints
  const have = byOrders ? totalOrders : pointsLifetime
  return { next, need, have, remaining: Math.max(0, need - have), by: byOrders ? 'orders' : 'points' }
}
