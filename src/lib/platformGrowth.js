// Growth data layer — onboarding, NPS, referrals, and the public status page.
// Platform-only collections (rules gated by isPlatformAdmin) EXCEPT platformStatus,
// which is public-read so the standalone /status page works for anyone.
import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase.js'

const list = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))

// ---------- onboarding checklist (per venue) ----------
// Doc shape: platformOnboarding/{tid} { steps:{profile,menu,firstOrder,branding,staff}, updatedAt }
export const ONBOARDING_STEPS = [
  { key: 'profile', ar: 'ملف المنشأة' },
  { key: 'menu', ar: 'إضافة المنيو' },
  { key: 'firstOrder', ar: 'أول طلب' },
  { key: 'branding', ar: 'الهوية والشعار' },
  { key: 'staff', ar: 'دعوة الفريق' },
]

export async function getOnboarding(tid) {
  try {
    const snap = await getDoc(doc(db, 'platformOnboarding', tid))
    return snap.exists() ? { id: snap.id, ...snap.data() } : null
  } catch {
    return null
  }
}

export function watchOnboarding(tid, cb) {
  return onSnapshot(
    doc(db, 'platformOnboarding', tid),
    (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null),
    () => cb(null),
  )
}

export async function setOnboardingStep(tid, step, done) {
  await setDoc(
    doc(db, 'platformOnboarding', tid),
    { steps: { [step]: !!done }, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

// Completion % from a stored onboarding doc, or inferred from tenant fields
// when no explicit checklist exists yet (has slug/name → profile; has logo/brand
// → branding; etc.). Returns { pct, steps:{...bool}, source:'doc'|'inferred' }.
export function completion(tenant, onboardingDoc) {
  const keys = ONBOARDING_STEPS.map((s) => s.key)
  if (onboardingDoc?.steps) {
    const steps = {}
    keys.forEach((k) => { steps[k] = !!onboardingDoc.steps[k] })
    const done = keys.filter((k) => steps[k]).length
    return { pct: Math.round((done / keys.length) * 100), steps, source: 'doc' }
  }
  // Infer from tenant fields.
  const t = tenant || {}
  const steps = {
    profile: !!(t.name && t.slug),
    menu: !!(t.itemCount || t.hasItems || t.menuReady),
    firstOrder: !!(t.orderCount || t.firstOrderAt || t.lastOrderAt),
    branding: !!(t.logoUrl || t.logo || t.brandColor || t.theme),
    staff: !!(t.staffCount && t.staffCount > 1),
  }
  const done = keys.filter((k) => steps[k]).length
  return { pct: Math.round((done / keys.length) * 100), steps, source: 'inferred' }
}

// ---------- NPS ----------
// Docs on platformNps: { tenantId, tenantName, score:0..10, comment, at }
export function watchNps(cb, max = 300) {
  const q = query(collection(db, 'platformNps'), orderBy('at', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(list(s)), () => cb([]))
}

export async function addNps({ tenantId, tenantName, score, comment }) {
  await addDoc(collection(db, 'platformNps'), {
    tenantId: tenantId || null,
    tenantName: tenantName || '',
    score: Math.max(0, Math.min(10, Number(score) || 0)),
    comment: String(comment || '').slice(0, 500),
    at: serverTimestamp(),
  })
}

// NPS = %promoters (9-10) − %detractors (0-6). Returns integer -100..100.
export function npsScore(responses) {
  const rows = (responses || []).filter((r) => r && r.score != null)
  const n = rows.length
  if (!n) return 0
  const promoters = rows.filter((r) => r.score >= 9).length
  const detractors = rows.filter((r) => r.score <= 6).length
  return Math.round(((promoters - detractors) / n) * 100)
}

// Distribution buckets for a simple bar chart.
export function npsDistribution(responses) {
  const rows = (responses || []).filter((r) => r && r.score != null)
  const n = rows.length || 1
  const promoters = rows.filter((r) => r.score >= 9).length
  const passives = rows.filter((r) => r.score >= 7 && r.score <= 8).length
  const detractors = rows.filter((r) => r.score <= 6).length
  return {
    total: rows.length,
    promoters, passives, detractors,
    pPromoters: Math.round((promoters / n) * 100),
    pPassives: Math.round((passives / n) * 100),
    pDetractors: Math.round((detractors / n) * 100),
  }
}

// ---------- referrals ----------
// Docs on platformReferrals: { fromTid, code, at }
export function watchReferrals(cb, max = 200) {
  const q = query(collection(db, 'platformReferrals'), orderBy('at', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(list(s)), () => cb([]))
}

export async function addReferral({ fromTid, code }) {
  await addDoc(collection(db, 'platformReferrals'), {
    fromTid: fromTid || null,
    code: String(code || '').trim().slice(0, 40),
    at: serverTimestamp(),
  })
}

// ---------- acquisition sources ----------
// Reads tenant.source (set at signup). Returns [{ source, count }] desc.
export function acquisitionBreakdown(tenants) {
  const map = new Map()
  ;(tenants || []).forEach((t) => {
    const key = (t.source || 'غير معروف').toString().trim() || 'غير معروف'
    map.set(key, (map.get(key) || 0) + 1)
  })
  return [...map.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
}

// ---------- status incidents (PUBLIC read) ----------
// Docs on platformStatus: { title, level:operational|degraded|down, body, at }
export const STATUS_LEVELS = {
  operational: { ar: 'يعمل بشكل طبيعي', color: 'var(--success)', badge: 'badge-success' },
  degraded: { ar: 'أداء منخفض', color: 'var(--warning)', badge: 'badge-warning' },
  down: { ar: 'تعطّل', color: 'var(--danger)', badge: 'badge-danger' },
}

export function watchStatus(cb, max = 30) {
  const q = query(collection(db, 'platformStatus'), orderBy('at', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(list(s)), () => cb([]))
}

export async function saveStatusIncident(id, { title, level, body, at }) {
  const data = {
    title: String(title || '').slice(0, 160),
    level: STATUS_LEVELS[level] ? level : 'operational',
    body: String(body || '').slice(0, 2000),
    at: at || serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  if (id) {
    await updateDoc(doc(db, 'platformStatus', id), data)
    return id
  }
  const ref = await addDoc(collection(db, 'platformStatus'), { ...data, createdAt: serverTimestamp() })
  return ref.id
}

// Overall status = worst level among incidents from the last 24h (else operational).
export function overallStatus(incidents) {
  const rank = { operational: 0, degraded: 1, down: 2 }
  const now = Date.now()
  let worst = 'operational'
  ;(incidents || []).forEach((i) => {
    const ms = i.at?.toMillis?.() || (i.at?.toDate ? i.at.toDate().getTime() : 0)
    if (ms && now - ms > 86400000) return // older than 24h → not "current"
    if ((rank[i.level] ?? 0) > (rank[worst] ?? 0)) worst = i.level
  })
  return worst
}
