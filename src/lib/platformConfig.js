// Platform-wide pricing/plan configuration + bulk subscription operations.
// Reads/writes a single platformConfig/plans doc (platform-admin only, guarded
// by firestore.rules from the backend bundle). Bulk actions fan out over the
// existing tenant subscription helpers so activity logging / push stay intact.
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase.js'
import { setTenantPlan, setVenueMeta } from './platform.js'
import { PLANS } from './plans.js'

const CONFIG_DOC = () => doc(db, 'platformConfig', 'plans')

// Sensible defaults so the editor always renders even before the doc exists.
export const DEFAULT_PRICES = { menu: 0, ops: 99, pro: 199, enterprise: 399 }
export const DEFAULT_FEATURES = {
  menu: [
    "منيو رقمي بـ QR لكل طاولة، بأصناف وصور ومكوّنات وأسعار",
    "هوية المنشأة كاملة: الشعار والألوان والخطوط والخلفيات",
    "استقبال طلبات الضيوف من المنيو مباشرة",
    "صفحة عامة للمنشأة بالموقع وأوقات العمل ووسائل التواصل",
    "إشعار الضيف بحالة طلبه على واتساب"
  ],
  ops: [
    "كل ما في باقة «منيو»",
    "كاشير ونقطة بيع كاملة مع الطباعة الحرارية",
    "إدارة الطلبات وخريطة الطاولات وحالة كل طاولة",
    "شاشة مطبخ KDS بترتيب زمني وتنبيهات",
    "الحجوزات ونداء النادل وطلبات التوصيل",
    "تقارير المبيعات اليومية وإغلاق الورديات"
  ],
  pro: [
    "كل ما في باقة «منيو + تشغيل»",
    "مكتبة ثيمات وسكنات كاملة لتصميم المنيو",
    "خلفيات وفيديو وعلامة مائية وتخصيص كامل للمظهر",
    "نطاق إلكتروني مخصّص باسم منشأتك",
    "حملات واتساب مجدولة وبرنامج ولاء ونقاط",
    "العروض والكوبونات والأسعار الموسمية"
  ],
  enterprise: [
    "كل ما في باقة «احترافي»",
    "إدارة الموظفين: الحضور والانصراف والورديات والرواتب",
    "الصلاحيات التفصيلية لكل موظف",
    "المحاسبة الكاملة: قائمة الدخل والتدفق النقدي والإقرار الضريبي",
    "الفواتير الضريبية المعتمدة برمز ZATCA",
    "المساعد الذكي للإدارة — تحليل وتقارير وتوصيات",
    "إدارة المخزون والمواد الخام والتكلفة الفعلية للصنف"
  ]
}

function normalize(data) {
  const d = data || {}
  const prices = { ...DEFAULT_PRICES }
  const listPrices = {}
  const features = {}
  PLANS.forEach((p) => {
    const raw = d.prices?.[p.id]
    if (raw !== undefined && raw !== null && raw !== '') prices[p.id] = Number(raw) || 0
    // The struck-through «before» price. Zero means «no strike» — see promoOf
    // in platformPricing.js for the three conditions it must satisfy to print.
    listPrices[p.id] = Number(d.listPrices?.[p.id]) || 0
    const f = d.features?.[p.id]
    features[p.id] = Array.isArray(f) && f.length ? f : (DEFAULT_FEATURES[p.id] || [])
  })
  return { prices, listPrices, features, promo: d.promo || null }
}

// One-shot read of the plans config (merged with defaults).
export async function getPlansConfig() {
  try {
    const snap = await getDoc(CONFIG_DOC())
    return normalize(snap.exists() ? snap.data() : null)
  } catch {
    return normalize(null)
  }
}

// Live subscription to the plans config.
export function watchPlansConfig(cb) {
  return onSnapshot(CONFIG_DOC(), (s) => cb(normalize(s.exists() ? s.data() : null)), () => cb(normalize(null)))
}

// Merge-save a partial patch ({prices?, features?}).
export async function savePlansConfig(patch) {
  await setDoc(CONFIG_DOC(), { ...patch, updatedAt: serverTimestamp() }, { merge: true })
}

// Apply a plan change to many venues at once. status stays whatever it was.
export async function bulkSetPlan(tenantIds, plan) {
  const ids = (tenantIds || []).filter(Boolean)
  const results = await Promise.allSettled(ids.map((tid) => setTenantPlan(tid, { plan })))
  return summarize(results)
}

// Extend (or shorten with a negative value) each venue's expiry by N days from
// its current expiry, or from now if it has none. Also marks status active.
export async function bulkExtend(tenants, days) {
  const n = Number(days) || 0
  const rows = (tenants || []).filter(Boolean)
  const results = await Promise.allSettled(rows.map((t) => {
    const raw = t.planExpiresAt
    const base = raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null
    const from = base && !isNaN(base) && base.getTime() > Date.now() ? base : new Date()
    const next = new Date(from.getTime() + n * 86400000)
    return setTenantPlan(t.id, { planStatus: 'active', planExpiresAt: next })
  }))
  return summarize(results)
}

// Per-venue custom price override (falls back to the plan's list price when
// unset). Stored on the platform-only platformVenueMeta doc — never on the
// world-readable tenant doc; the monthly billing function reads it from there.
export async function setCustomPrice(tid, amount) {
  const clean = amount === '' || amount === null || amount === undefined ? null : Number(amount)
  await setVenueMeta(tid, { customPrice: Number.isFinite(clean) ? clean : null })
}

function summarize(results) {
  let ok = 0, fail = 0
  results.forEach((r) => (r.status === 'fulfilled' ? ok++ : fail++))
  return { ok, fail, total: results.length }
}
