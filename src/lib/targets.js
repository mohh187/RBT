// Role-based performance targets — each job type is measured by the metrics that
// actually matter for it (a waiter on served/took/guests, a cook on took, etc.),
// so scoring & evaluation reflect the real job. Admin-configurable per role.

export const TARGET_METRICS = [
  { key: 'served', ar: 'قدّم', en: 'Served' },
  { key: 'handled', ar: 'استلم', en: 'Took' },
  { key: 'custCount', ar: 'عملاء', en: 'Guests' },
  { key: 'revenue', ar: 'إيراد', en: 'Revenue' },
]

// Sensible DAILY defaults per role (admin can override in Performance → Role targets).
export const DEFAULT_ROLE_TARGETS = {
  waiter: { served: 15, handled: 15, custCount: 12 },
  cashier: { handled: 30, served: 30 },
  barista: { served: 25 },
  kitchen: { handled: 30 },
  supervisor: { served: 10, handled: 10, custCount: 8 },
  cleaner: {},
}

const PERIOD_MULT = { today: 1, week: 6, month: 26 }

// Per-role POINT WEIGHTS — each job is scored by what matters for it (a waiter
// weighted toward service & rating, a cook toward orders taken, etc.). Admin can
// override via tenant.roleWeights[role].
export const DEFAULT_WEIGHTS = { served: 10, handled: 4, custCount: 0, revenue: 0.1, rating: 1 }
export const DEFAULT_ROLE_WEIGHTS = {
  waiter: { served: 10, handled: 3, custCount: 3, revenue: 0.08, rating: 1.5 },
  cashier: { served: 6, handled: 8, custCount: 1, revenue: 0.12, rating: 0.8 },
  barista: { served: 12, handled: 4, custCount: 1, revenue: 0.1, rating: 1.2 },
  kitchen: { served: 4, handled: 12, custCount: 0, revenue: 0.05, rating: 0.5 },
  supervisor: { served: 8, handled: 8, custCount: 2, revenue: 0.1, rating: 1 },
  cleaner: { served: 0, handled: 0, custCount: 0, revenue: 0, rating: 0 },
}
export function roleWeightsFor(tenant, role) {
  return { ...DEFAULT_WEIGHTS, ...(DEFAULT_ROLE_WEIGHTS[role] || {}), ...((tenant?.roleWeights || {})[role] || {}) }
}
// A map { role: weights } (incl. a 'default') fed to scoreStaff.
export function buildRoleWeights(tenant) {
  const out = { default: DEFAULT_WEIGHTS }
  const roles = new Set([...Object.keys(DEFAULT_ROLE_WEIGHTS), ...Object.keys(tenant?.roleWeights || {})])
  roles.forEach((role) => { out[role] = roleWeightsFor(tenant, role) })
  return out
}

export function roleTargetDaily(tenant, role) {
  const base = tenant?.roleTargets || {}
  return base[role] || DEFAULT_ROLE_TARGETS[role] || {}
}

// A map { role: { metric: scaledTarget } } for the given period — fed to scoreStaff.
export function buildRoleTargets(tenant, period) {
  const mult = PERIOD_MULT[period] || 1
  const out = {}
  const roles = new Set([...Object.keys(DEFAULT_ROLE_TARGETS), ...Object.keys(tenant?.roleTargets || {})])
  roles.forEach((role) => {
    const t = roleTargetDaily(tenant, role)
    const scaled = {}
    Object.keys(t).forEach((k) => { const v = Number(t[k]) || 0; if (v > 0) scaled[k] = Math.round(v * mult) })
    out[role] = scaled
  })
  return out
}
