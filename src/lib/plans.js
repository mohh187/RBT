// Subscription tiers — gate features per venue plan. Built ahead of monetization
// so features (esp. themes/skins) can be locked to higher tiers later WITHOUT
// breaking anything today: tenant.plan defaults to the top tier until enforced.
//
// See memory: roadmap-tiered-packages, roadmap-themes-library.

export const PLANS = [
  { id: 'menu', ar: 'منيو', en: 'Menu', order: 1 },
  { id: 'ops', ar: 'منيو + تشغيل', en: 'Operations', order: 2 },
  { id: 'pro', ar: 'احترافي', en: 'Pro', order: 3 },
  { id: 'enterprise', ar: 'متكامل', en: 'Enterprise', order: 4 },
]

// Minimum plan order a feature needs. (themes/skins = Pro+; full staff = Enterprise.)
export const FEATURE_MIN = {
  menu: 1, qrOrder: 1, branding: 1,
  cashier: 2, orders: 2, delivery: 2, tables: 2, kds: 2, reservations: 2,
  themes: 3, background: 3, watermark: 3, customSkins: 3, systemTemplates: 3, customDomain: 3,
  staff: 4, attendance: 4, performance: 4, payroll: 4, shifts: 4, reports: 4, announcements: 4,
  // realistic image→3D conversion (Meshy pipeline) — the top tier's signature perk.
  ar3d: 4,
}

// Self-signup display prices (SAR/month) — MUST mirror PLAN_PRICES in
// functions/platformExtensions.js (the server table is the only trusted source).
export const PLAN_PRICES = { menu: 99, ops: 199, pro: 349, enterprise: 549 }
export const YEARLY_DISCOUNT = 0.8

// After a subscription expires the venue keeps full features for a grace
// period, then drops to the lowest tier (menu-only) until renewed.
export const EXPIRED_GRACE_DAYS = 7

export function planExpired(tenant) {
  if (tenant?.planStatus !== 'expired') return false
  const raw = tenant.planExpiresAt
  const exp = raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null
  if (!exp || isNaN(exp)) return true // marked expired with no date → expired now
  return Date.now() > exp.getTime() + EXPIRED_GRACE_DAYS * 86400000
}

export function planOrder(tenant) {
  if (planExpired(tenant)) return PLANS[0].order // clamp to menu-only
  const id = tenant?.plan || 'enterprise' // default ON: gating activates only once a lower plan is assigned
  return (PLANS.find((p) => p.id === id) || PLANS[PLANS.length - 1]).order
}

export function planAllows(tenant, feature) {
  // Per-venue override set by the platform console (tenant.features) wins over
  // plan gating — lets a super-admin force any module on/off for one venue.
  const ov = tenant?.features?.[feature]
  if (ov === true) return true
  if (ov === false) return false
  const min = FEATURE_MIN[feature]
  if (min == null) return true
  return planOrder(tenant) >= min
}

// Venue-facing modules the platform console can force on/off per venue. Keys
// must exist in FEATURE_MIN so the override actually changes planAllows() and
// the app's route/feature gates.
// NOTE: only keys the app actually gates through planAllows()/PlanGate belong
// here — a toggle for an ungated key (e.g. delivery is governed by its own
// Settings switch, payroll by capabilities) would silently do nothing.
export const FEATURE_CATALOG = [
  { key: 'cashier', ar: 'الكاشير والطلبات', en: 'Cashier & orders', tier: 'ops' },
  { key: 'kds', ar: 'شاشة المطبخ', en: 'Kitchen display', tier: 'ops' },
  { key: 'tables', ar: 'الطاولات', en: 'Tables', tier: 'ops' },
  { key: 'reservations', ar: 'الحجوزات', en: 'Reservations', tier: 'ops' },
  { key: 'themes', ar: 'الثيمات والتخصيص', en: 'Themes & customization', tier: 'pro' },
  { key: 'systemTemplates', ar: 'قوالب النظام', en: 'System templates', tier: 'pro' },
  { key: 'customDomain', ar: 'نطاق مخصّص', en: 'Custom domain', tier: 'pro' },
  { key: 'staff', ar: 'الطاقم والموارد البشرية', en: 'Staff & HR', tier: 'enterprise' },
  { key: 'attendance', ar: 'الحضور والانصراف', en: 'Attendance', tier: 'enterprise' },
  { key: 'reports', ar: 'التقارير المتقدمة', en: 'Advanced reports', tier: 'enterprise' },
  { key: 'ar3d', ar: 'مجسمات AR واقعية بالذكاء', en: 'Realistic AI 3D models', tier: 'enterprise' },
]

export function planLabel(tenant, lang = 'ar') {
  const p = PLANS.find((x) => x.id === (tenant?.plan || 'enterprise')) || PLANS[PLANS.length - 1]
  return lang === 'ar' ? p.ar : p.en
}
