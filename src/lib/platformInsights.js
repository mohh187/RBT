// Deep cross-venue analytics helpers for the platform console.
// Built on top of the existing feed (platformActivity) and daily rollups
// (platformStats). Live watchers use onSnapshot; the rest are PURE functions
// that derive KPIs from data the caller already has (watchRecentStats /
// watchAllTenants), so screens stay cheap and testable.
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore'
import { db } from './firebase.js'
import { PLANS } from './plans.js'

const list = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// ---------------------------------------------------------------------------
// LIVE WATCHERS (auto-updating, cross-venue)
// ---------------------------------------------------------------------------
// One query drives both boards: today's order events. We partition client-side
// because Firestore `== null` does NOT match documents where the field is
// simply absent (order-CREATION events carry no `orderStatus`), so filtering in
// JS is the only reliable way to split "new/live" from "settled".

// Live incoming orders today = creation events (no settlement status yet).
export function watchLiveOrders(cb) {
  const q = query(
    collection(db, 'platformActivity'),
    where('kind', '==', 'order'),
    where('at', '>=', startOfToday()),
    orderBy('at', 'desc'),
    limit(2000),
  )
  return onSnapshot(
    q,
    (s) => {
      const rows = list(s).filter((r) => r.orderStatus == null)
      cb(rows)
    },
    () => cb([]),
  )
}

// Settled orders today (paid / served) → revenue recognized on settlement.
export function watchSettledToday(cb) {
  const q = query(
    collection(db, 'platformActivity'),
    where('kind', '==', 'order'),
    where('at', '>=', startOfToday()),
    orderBy('at', 'desc'),
    limit(2000),
  )
  return onSnapshot(
    q,
    (s) => {
      const rows = list(s).filter((r) => r.orderStatus === 'paid' || r.orderStatus === 'served')
      const revenue = Math.round(rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0))
      cb({ rows, count: rows.length, revenue })
    },
    () => cb({ rows: [], count: 0, revenue: 0 }),
  )
}

// ---------------------------------------------------------------------------
// PURE DERIVATIONS (no I/O) — feed them watchRecentStats / watchAllTenants data
// ---------------------------------------------------------------------------

// Rough default monthly price per plan (SAR) used only when the caller has no
// real price map. Swap by passing planPrices = {menu, ops, pro, enterprise}.
const DEFAULT_PLAN_PRICE = { menu: 0, ops: 99, pro: 199, enterprise: 399 }

// Estimated MRR + venue count per plan. Only ACTIVE (non-suspended, non-expired)
// venues contribute revenue; everything else is still counted for the breakdown.
export function mrrFromTenants(tenants = [], planPrices = null) {
  const prices = planPrices || DEFAULT_PLAN_PRICE
  const byPlan = {}
  for (const p of PLANS) byPlan[p.id] = 0
  let mrr = 0
  let paying = 0
  for (const t of tenants) {
    const plan = t.plan || 'enterprise'
    byPlan[plan] = (byPlan[plan] || 0) + 1
    const billable = t.active !== false && t.planStatus !== 'expired'
    if (billable) {
      const price = Number(prices[plan]) || 0
      mrr += price
      if (price > 0) paying++
    }
  }
  return { byPlan, mrr, paying, total: tenants.length, estimated: !planPrices }
}

// Daily rollups (watchRecentStats returns newest-first) → chronological series
// for charts: [{ date, revenue, orders, tenants, activeTenants }].
export function revenueSeries(stats = []) {
  return stats
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((s) => ({
      date: s.date,
      label: String(s.date || '').slice(5), // MM-DD
      revenue: Math.round(Number(s.revenue) || 0),
      orders: Number(s.orders) || 0,
      tenants: Number(s.tenants) || 0,
      activeTenants: Number(s.activeTenants) || 0,
    }))
}

// Churn / idle estimate from the most recent rollup: venues that exist but had
// no orders that day are "idle". churnRate = idle / tenants (0..1).
export function churnFrom(stats = []) {
  const series = revenueSeries(stats)
  const last = series[series.length - 1]
  if (!last || !last.tenants) return { idle: 0, active: 0, tenants: 0, churnRate: 0, engagement: 0 }
  const idle = Math.max(0, last.tenants - last.activeTenants)
  return {
    idle,
    active: last.activeTenants,
    tenants: last.tenants,
    churnRate: idle / last.tenants,
    engagement: last.activeTenants / last.tenants,
  }
}

// Per-venue health score 0..100 from recency of last order + plan + status.
// lastStats = latest byTenant entry for this venue (may be null).
export function healthScore(tenant = {}, lastStat = null) {
  let score = 50
  if (tenant.active === false) return 0
  if (tenant.planStatus === 'expired') score -= 25
  else if (tenant.planStatus === 'trial') score -= 5
  else score += 10

  const raw = lastStat?.lastOrderAt || tenant.lastOrderAt
  const d = raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null
  if (d && !isNaN(d)) {
    const days = (Date.now() - d.getTime()) / 86400000
    if (days < 1) score += 40
    else if (days < 3) score += 30
    else if (days < 7) score += 18
    else if (days < 30) score += 5
    else score -= 20
  } else {
    score -= 15 // never ordered
  }
  if (lastStat && (Number(lastStat.orders) || 0) > 0) score += 10
  return Math.max(0, Math.min(100, Math.round(score)))
}

export function healthLabel(score) {
  if (score >= 75) return { ar: 'ممتازة', cls: 'badge-success' }
  if (score >= 45) return { ar: 'متوسطة', cls: 'badge-warning' }
  return { ar: 'ضعيفة', cls: 'badge-danger' }
}

// Flatten the latest rollup's byTenant map → sortable rows with AOV.
export function byTenantRows(latestStat = null) {
  const bt = latestStat?.byTenant
  if (!bt) return []
  return Object.entries(bt).map(([tid, v]) => {
    const orders = Number(v.orders) || 0
    const revenue = Math.round(Number(v.revenue) || 0)
    return {
      tid,
      name: v.name || tid,
      orders,
      revenue,
      currency: v.currency || 'SAR',
      aov: orders > 0 ? Math.round(revenue / orders) : 0,
      lastOrderAt: v.lastOrderAt || null,
    }
  })
}
