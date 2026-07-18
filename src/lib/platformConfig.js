// Platform-wide pricing/plan configuration + bulk subscription operations.
// Reads/writes a single platformConfig/plans doc (platform-admin only, guarded
// by firestore.rules from the backend bundle). Bulk actions fan out over the
// existing tenant subscription helpers so activity logging / push stay intact.
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase.js'
import { setTenantPlan, platformUpdateTenant } from './platform.js'
import { PLANS } from './plans.js'

const CONFIG_DOC = () => doc(db, 'platformConfig', 'plans')

// Sensible defaults so the editor always renders even before the doc exists.
export const DEFAULT_PRICES = { menu: 0, ops: 99, pro: 199, enterprise: 399 }
export const DEFAULT_FEATURES = {
  menu: ['منيو رقمي QR', 'هوية وشعار وألوان', 'استقبال طلبات أساسية'],
  ops: ['كل مزايا «منيو»', 'كاشير ونقطة بيع', 'إدارة الطلبات والطاولات', 'شاشة المطبخ KDS'],
  pro: ['كل مزايا «منيو + تشغيل»', 'مكتبة الثيمات والسكنات', 'خلفيات وفيديو وعلامة مائية'],
  enterprise: ['كل مزايا «احترافي»', 'إدارة الموظفين الكاملة', 'الأداء والرواتب والورديات', 'التقارير الكاملة'],
}

function normalize(data) {
  const d = data || {}
  const prices = { ...DEFAULT_PRICES }
  const features = {}
  PLANS.forEach((p) => {
    const raw = d.prices?.[p.id]
    if (raw !== undefined && raw !== null && raw !== '') prices[p.id] = Number(raw) || 0
    const f = d.features?.[p.id]
    features[p.id] = Array.isArray(f) && f.length ? f : (DEFAULT_FEATURES[p.id] || [])
  })
  return { prices, features }
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

// Per-venue custom price override (falls back to the plan's list price when unset).
export async function setCustomPrice(tid, amount) {
  const clean = amount === '' || amount === null || amount === undefined ? null : Number(amount)
  await platformUpdateTenant(tid, { customPrice: Number.isFinite(clean) ? clean : null })
}

function summarize(results) {
  let ok = 0, fail = 0
  results.forEach((r) => (r.status === 'fulfilled' ? ok++ : fail++))
  return { ok, fail, total: results.length }
}
