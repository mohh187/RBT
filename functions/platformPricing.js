// ==================== ONE PRICE, ONE PLACE ====================
// There were three disagreeing price tables, and the disagreement was billing
// real customers the wrong amount:
//
//   src/lib/plans.js PLAN_PRICES               menu 99  ops 199 pro 349 ent 549
//   functions/platformExtensions.js PLAN_PRICES   (same literal, duplicated)
//   src/lib/platformConfig.js DEFAULT_PRICES   menu 0   ops 99  pro 199 ent 399
//
// A venue that self-signed-up paid 549 through the second table, and was then
// re-billed every month at 399 through the third — for the identical service.
// The comment in plans.js even claimed a hand-sync contract with no guard
// behind it, which is exactly the drift class scripts/guard.mjs exists for.
//
// This file is now the only place a subscription price is decided, for both
// the monthly cron and self-signup. FALLBACK_PRICES is what applies when the
// console has never written platformConfig/plans; the console's values win.
const FALLBACK_PRICES = { menu: 99, ops: 199, pro: 349, enterprise: 549 }
// The struck-through "before" price on a quotation. Only meaningful while a
// promo is active; see promoOf(). Editable from the console like the rest.
const FALLBACK_LIST_PRICES = { menu: 149, ops: 299, pro: 499, enterprise: 1299 }
const YEARLY_DISCOUNT = 0.8

// What each plan actually includes, spelled out — a quotation that says
// «كل مزايا احترافي» tells a buyer nothing they can evaluate. Each plan lists
// its OWN concrete capabilities plus one carry-over line, so the sheet stands
// on its own without the reader holding three other price lists in their head.
//
// Deliberately NOT listing realistic AR 3D models: that feature's future is
// undecided, and a quotation is a commitment. Nothing goes on a customer's
// document that we are considering withdrawing.
//
// Mirrors DEFAULT_FEATURES in src/lib/platformConfig.js; the console's edits
// at platformConfig/plans.features override it entirely.
const FALLBACK_FEATURES = {
  menu: [
    'منيو رقمي بـ QR لكل طاولة، بأصناف وصور ومكوّنات وأسعار',
    'هوية المنشأة كاملة: الشعار والألوان والخطوط والخلفيات',
    'استقبال طلبات الضيوف من المنيو مباشرة',
    'صفحة عامة للمنشأة بالموقع وأوقات العمل ووسائل التواصل',
    'إشعار الضيف بحالة طلبه على واتساب',
  ],
  ops: [
    'كل ما في باقة «منيو»',
    'كاشير ونقطة بيع كاملة مع الطباعة الحرارية',
    'إدارة الطلبات وخريطة الطاولات وحالة كل طاولة',
    'شاشة مطبخ KDS بترتيب زمني وتنبيهات',
    'الحجوزات ونداء النادل وطلبات التوصيل',
    'تقارير المبيعات اليومية وإغلاق الورديات',
  ],
  pro: [
    'كل ما في باقة «منيو + تشغيل»',
    'مكتبة ثيمات وسكنات كاملة لتصميم المنيو',
    'خلفيات وفيديو وعلامة مائية وتخصيص كامل للمظهر',
    'نطاق إلكتروني مخصّص باسم منشأتك',
    'حملات واتساب مجدولة وبرنامج ولاء ونقاط',
    'العروض والكوبونات والأسعار الموسمية',
  ],
  enterprise: [
    'كل ما في باقة «احترافي»',
    'إدارة الموظفين: الحضور والانصراف والورديات والرواتب',
    'الصلاحيات التفصيلية لكل موظف',
    'المحاسبة الكاملة: قائمة الدخل والتدفق النقدي والإقرار الضريبي',
    'الفواتير الضريبية المعتمدة برمز ZATCA',
    'المساعد الذكي للإدارة — تحليل وتقارير وتوصيات',
    'إدارة المخزون والمواد الخام والتكلفة الفعلية للصنف',
  ],
}

// Read the console's plan config once, with the fallbacks merged in. Returns
// { prices, listPrices, promo, currency, vatMode, yearlyDiscount }.
async function plansConfig(db) {
  const snap = await db.doc('platformConfig/plans').get().catch(() => null)
  const d = snap && snap.exists ? (snap.data() || {}) : {}
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  const merge = (base, over) => {
    const out = { ...base }
    Object.keys(base).forEach((k) => {
      const v = num(over && over[k])
      if (v !== null) out[k] = v
    })
    return out
  }
  return {
    prices: merge(FALLBACK_PRICES, d.prices),
    listPrices: merge(FALLBACK_LIST_PRICES, d.listPrices),
    // The feature bullets a quotation prints. The console already edits these
    // at platformConfig/plans.features; the fallbacks keep a quote printable
    // before anyone has touched that screen.
    features: { ...FALLBACK_FEATURES, ...(d.features && typeof d.features === 'object' ? d.features : {}) },
    promo: d.promo && typeof d.promo === 'object' ? d.promo : null,
    currency: d.currency || 'SAR',
    // Platform B2B prices are quoted EXCLUSIVE of VAT — see platformInvoicing.
    vatMode: d.vatMode === 'inclusive' ? 'inclusive' : 'exclusive',
    yearlyDiscount: num(d.yearlyDiscount) !== null ? num(d.yearlyDiscount) : YEARLY_DISCOUNT,
  }
}

// The price ACTUALLY charged to one venue for one plan, most specific first:
//   platformVenueMeta.customPrice  — the console's negotiated price
//   tenant.customPrice             — legacy, pre-migration only
//   cfg.prices[plan]               — the plan's list price
// Returns null when the venue has no assigned plan (not billable — an unset
// plan is a trial, and auto-invoicing it at the lowest tier would be wrong).
function resolvePlanPrice(tenant, meta, cfg) {
  const plan = tenant && tenant.plan
  if (!plan) return null
  const raw = meta && meta.customPrice != null ? meta.customPrice : (tenant ? tenant.customPrice : null)
  const custom = raw == null ? null : Number(raw)
  if (custom != null && Number.isFinite(custom) && custom >= 0) return custom
  const list = Number(cfg && cfg.prices && cfg.prices[plan])
  return Number.isFinite(list) ? list : 0
}

// The launch promotion, or null. A struck-through price is only honest while
// all three hold: a higher list price exists, the promo is switched on, and it
// has not expired. One condition, one place to turn it off.
function promoOf(planId, cfg) {
  const p = cfg && cfg.promo
  if (!p || p.active !== true) return null
  const until = Number(p.validUntil) || 0
  if (until && Date.now() > until) return null
  const list = Number(cfg.listPrices && cfg.listPrices[planId])
  const price = Number(cfg.prices && cfg.prices[planId])
  if (!Number.isFinite(list) || !Number.isFinite(price) || list <= price) return null
  return { listPrice: list, price, discount: Math.round((list - price) * 100) / 100, labelAr: p.labelAr || 'خصم', validUntil: until || null }
}

// A yearly subscription's amount for one plan.
function yearlyAmount(monthly, cfg) {
  const f = Number(cfg && cfg.yearlyDiscount)
  return Math.round(monthly * 12 * (Number.isFinite(f) ? f : YEARLY_DISCOUNT))
}

module.exports = { FALLBACK_PRICES, FALLBACK_LIST_PRICES, FALLBACK_FEATURES, YEARLY_DISCOUNT, plansConfig, resolvePlanPrice, promoOf, yearlyAmount }
