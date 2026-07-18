// Shared staff performance scoring — computed from a venue's own orders + reviews
// (the source of truth, tamper-resistant). Used by the Performance page, the
// Members tab, and the profile so a staffer's row is identical everywhere.

export const LEVELS = [
  { id: 'gold', min: 1, ar: 'ذهبي', en: 'Gold', color: '#e0b15c' },
  { id: 'silver', min: 0.6, ar: 'فضّي', en: 'Silver', color: '#9aa0b4' },
  { id: 'bronze', min: 0, ar: 'برونزي', en: 'Bronze', color: '#c08457' },
]

export function startOf(period) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (period === 'week') d.setDate(d.getDate() - d.getDay()) // week starts Sunday
  if (period === 'month') d.setDate(1)
  return d
}

const DEFAULT_W = { served: 10, handled: 4, custCount: 0, revenue: 0.1, rating: 1 }

export function scoreStaff(members, orders, reviews, { period = 'today', target = 0, roleTargets = null, roleWeights = null, ar = true } = {}) {
  const m = {}
  const add = (uid) => (m[uid] || (m[uid] = { handled: 0, served: 0, revenue: 0, customers: new Set(), ratingSum: 0, ratingN: 0 }))
  ;(orders || []).forEach((o) => {
    if (o.status === 'cancelled') return
    if (o.acceptedByUid) add(o.acceptedByUid).handled++
    if (o.servedByUid) { const s = add(o.servedByUid); s.served++; s.revenue += o.total || 0; if (o.customerPhone) s.customers.add(o.customerPhone) }
  })
  const periodStart = startOf(period).getTime()
  ;(reviews || []).forEach((r) => {
    const at = r.createdAt?.toMillis?.() || 0
    if (at < periodStart || !r.staffUid) return
    const s = add(r.staffUid); s.ratingSum += r.rating || 0; s.ratingN++
  })
  return (members || []).map((mem) => {
    const s = m[mem.uid] || { handled: 0, served: 0, revenue: 0, customers: new Set(), ratingSum: 0, ratingN: 0 }
    const custCount = s.customers.size
    const avgRating = s.ratingN ? s.ratingSum / s.ratingN : 0
    const ratingBonus = s.ratingN ? Math.round((avgRating - 3) * 5 * s.ratingN) : 0
    // Role-weighted points (each job scored by what matters for it).
    const w = (roleWeights && (roleWeights[mem.role] || roleWeights.default)) || DEFAULT_W
    const points = Math.round(s.served * w.served + s.handled * w.handled + custCount * (w.custCount || 0) + s.revenue * w.revenue + ratingBonus * (w.rating != null ? w.rating : 1))
    // Progress: composite of the role's own target metrics when configured,
    // else the legacy single served-target.
    const rt = roleTargets && roleTargets[mem.role]
    const statOf = (k) => (k === 'served' ? s.served : k === 'handled' ? s.handled : k === 'custCount' ? custCount : k === 'revenue' ? s.revenue : 0)
    let progress, targetMetrics = null
    if (rt && Object.keys(rt).filter((k) => Number(rt[k]) > 0).length) {
      const keys = Object.keys(rt).filter((k) => Number(rt[k]) > 0)
      targetMetrics = keys.map((k) => ({ key: k, value: statOf(k), target: Number(rt[k]) }))
      progress = Math.min(1.5, keys.reduce((a, k) => a + Math.min(1.5, statOf(k) / Number(rt[k])), 0) / keys.length)
    } else {
      progress = target ? Math.min(1.5, s.served / target) : 0
    }
    const level = LEVELS.find((l) => progress >= l.min) || LEVELS[2]
    let insight = ''
    if (s.served > 0 && avgRating > 0 && avgRating < 3.5) insight = ar ? 'يحتاج تدريب خدمة عملاء' : 'Needs customer-service coaching'
    else if (progress >= 1.4) insight = ar ? 'يتجاوز هدفه بكثير — فكّر برفع هدفه' : 'Far exceeds — consider raising the target'
    else if (progress >= 1) insight = ar ? 'حقّق هدف وظيفته — يستحق مكافأة' : 'Hit role target — reward-worthy'
    else if ((targetMetrics || target) && progress > 0 && progress < 0.4) insight = ar ? 'أقل من هدفه — راجع الهدف أو ادعمه' : 'Below target — review or support'
    return { ...mem, ...s, custCount, avgRating, points, progress, level, insight, targetMetrics }
  }).sort((a, b) => b.points - a.points)
}
