// Audience segmentation + lightweight usage/health estimates for the platform
// console. PURE functions over the tenants array (from watchAllTenants) plus a
// thin wrapper over the existing broadcast pipeline — no new collections.
import { createBroadcast } from './platform.js'
import { PLANS } from './plans.js'

const NEW_WINDOW_MS = 30 * 86400000 // "new" = created within 30 days
const IDLE_WINDOW_MS = 14 * 86400000 // "idle" = no activity for 14+ days

// Firestore Timestamp | Date | number | string → millis (0 if unknown).
function ms(v) {
  if (!v) return 0
  if (typeof v?.toMillis === 'function') return v.toMillis()
  if (typeof v?.toDate === 'function') return v.toDate().getTime()
  const d = new Date(v)
  return isNaN(d) ? 0 : d.getTime()
}

// ---- segment predicates over a single tenant ----
export function isEnterprise(t) {
  return (t?.plan || 'enterprise') === 'enterprise'
}
export function isExpired(t) {
  return t?.planStatus === 'expired' || t?.active === false
}
export function isNew(t) {
  const c = ms(t?.createdAt)
  return c > 0 && Date.now() - c <= NEW_WINDOW_MS
}
// Idle needs a "last activity" signal. We look at lastStats (a map keyed by
// tenantId, e.g. { [tid]: { lastAt } }) if provided, else fall back to the
// tenant's own updatedAt/lastOrderAt fields.
export function isIdle(t, lastStats = {}) {
  const stat = lastStats?.[t?.id]
  const last = ms(stat?.lastAt) || ms(t?.lastOrderAt) || ms(t?.updatedAt)
  if (!last) return true // never seen any activity → treat as idle
  return Date.now() - last >= IDLE_WINDOW_MS
}

// ---- segment selectors over the tenants array ----
export function segEnterprise(tenants = []) {
  return tenants.filter(isEnterprise)
}
export function segExpired(tenants = []) {
  return tenants.filter(isExpired)
}
export function segNew(tenants = []) {
  return tenants.filter(isNew)
}
export function segIdle(tenants = [], lastStats = {}) {
  return tenants.filter((t) => isIdle(t, lastStats))
}
export function segByPlan(tenants = [], plan) {
  if (!plan) return tenants.slice()
  return tenants.filter((t) => (t?.plan || 'enterprise') === plan)
}

// Build the full catalogue of segments with live-computed members. Each entry:
// { key, label(ar), icon, plan (broadcast filter or ''), members[] }.
export function buildSegments(tenants = [], lastStats = {}) {
  const out = [
    { key: 'all', label: 'كل المنشآت', icon: 'store', plan: '', members: tenants.slice() },
    { key: 'new', label: 'منشآت جديدة (30 يوم)', icon: 'sparkles', plan: '', members: segNew(tenants) },
    { key: 'idle', label: 'منشآت خاملة (14 يوم+)', icon: 'clock', plan: '', members: segIdle(tenants, lastStats) },
    { key: 'expired', label: 'اشتراك منتهٍ / موقوفة', icon: 'warning', plan: '', members: segExpired(tenants) },
    { key: 'enterprise', label: 'باقة متكاملة', icon: 'award', plan: 'enterprise', members: segEnterprise(tenants) },
  ]
  // One segment per plan tier for targeted broadcasts.
  for (const p of PLANS) {
    out.push({
      key: 'plan_' + p.id,
      label: 'باقة ' + p.ar,
      icon: 'wallet',
      plan: p.id,
      members: segByPlan(tenants, p.id),
    })
  }
  return out
}

// Broadcast to a segment. Segments carrying a plan filter reuse the native
// broadcast plan targeting; segments WITHOUT a plan filter (new/idle/expired)
// can't be expressed to the fan-out function, so we send platform-wide and let
// the composer know via the returned `scoped` flag.
export async function saveSegmentBroadcast(segment, { title, body, push = true, days = 14 }) {
  const plan = segment?.plan || ''
  await createBroadcast({ title, body, plan, push, days })
  return { scoped: !!plan, reached: plan ? (segment?.members?.length ?? null) : null }
}

// Rough usage / health estimate. This is a CHEAP client-side count hint only —
// precise per-collection document counts and true quota need Cloud Monitoring /
// getCountFromServer per tenant. We approximate a documents-per-venue baseline.
const DOCS_PER_VENUE_HINT = 40 // menu items + settings + a little history, ballpark

export function estimateUsage(tenants = []) {
  const venues = tenants.length
  const active = tenants.filter((t) => t.active !== false).length
  return {
    venues,
    active,
    suspended: venues - active,
    approxDocs: venues * DOCS_PER_VENUE_HINT,
    note:
      'تقدير تقريبي فقط: عدد المنشآت × متوسط مستندات لكل منشأة. ' +
      'المراقبة الدقيقة للحصص (عدد المستندات/القراءات) تتطلب Cloud Monitoring.',
  }
}
