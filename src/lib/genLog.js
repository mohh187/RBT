// Generation history — EVERY AI generation in the system is recorded under
// tenants/{tid}/aiGenerations, so an owner can browse, preview, learn from and
// reuse prompts. Failures are recorded too: knowing which prompts break is half
// the value of the log.
//
// Design constraints this file deliberately holds to:
//  - logGeneration is FIRE-AND-FORGET and NEVER throws into its caller. A broken
//    log must never break the generation the user actually asked for.
//  - Reads use ONLY orderBy('at','desc') + limit, and filter kind/section/date/
//    search CLIENT-side. That needs ZERO composite indexes, so the history can
//    never die with a "query requires an index" error. Trade-off: filters see a
//    window of the most recent N entries, not the whole collection (see
//    DEFAULT_WINDOW / MAX_WINDOW below).
//  - Every listener passes an onSnapshot error callback, so a rules/network
//    failure surfaces as a message instead of a spinner that never stops.
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  query,
  orderBy,
  limit as qLimit,
  onSnapshot,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore'
import { db, auth, firebaseReady } from './firebase.js'

// Newest-first window the UI filters within. 400 covers many months of real
// venue usage; the page tells the user plainly when it is looking at a window.
export const DEFAULT_WINDOW = 400
export const MAX_WINDOW = 1000

export const GEN_KINDS = ['image', 'text', 'caption', 'story', 'plan', 'model3d', 'report', 'other']

// Icon names below are real entries in components/Icon.jsx — do not invent new ones.
export const KIND_META = {
  image: { ar: 'صور', en: 'Images', icon: 'image' },
  text: { ar: 'نصوص', en: 'Text', icon: 'file' },
  caption: { ar: 'تعليقات', en: 'Captions', icon: 'message' },
  story: { ar: 'قصص', en: 'Stories', icon: 'theater' },
  plan: { ar: 'خطط', en: 'Plans', icon: 'notepad' },
  model3d: { ar: 'مجسمات', en: '3D models', icon: 'shapes' },
  report: { ar: 'تقارير', en: 'Reports', icon: 'chartBar' },
  other: { ar: 'أخرى', en: 'Other', icon: 'sparkles' },
}

// Known sections. Unknown ids still render (raw id) — the log never hides an entry
// just because a new caller was added without touching this map.
export const SECTION_META = {
  library: { ar: 'مكتبة الوسائط', en: 'Media library' },
  'post-studio': { ar: 'استوديو المنشورات', en: 'Post studio' },
  'item-editor': { ar: 'محرر الأصناف', en: 'Item editor' },
  assistant: { ar: 'المساعد الذكي', en: 'Assistant' },
  'print-studio': { ar: 'استوديو الطباعة', en: 'Print studio' },
  'settings-backdrop': { ar: 'خلفيات المنشأة', en: 'Venue backdrops' },
  'behavior-planner': { ar: 'مخطط السلوك', en: 'Behavior planner' },
  'model-studio': { ar: 'استوديو المجسمات', en: 'Model studio' },
  'reviews-studio': { ar: 'استوديو التقييمات', en: 'Reviews studio' },
  campaigns: { ar: 'الحملات', en: 'Campaigns' },
  stories: { ar: 'القصص', en: 'Stories' },
  menu: { ar: 'القائمة', en: 'Menu' },
  other: { ar: 'غير محدد', en: 'Unspecified' },
}

export const kindLabel = (k, ar = true) => KIND_META[k]?.[ar ? 'ar' : 'en'] || k || (ar ? 'أخرى' : 'Other')
export const kindIcon = (k) => KIND_META[k]?.icon || 'sparkles'
export const sectionLabel = (s, ar = true) => SECTION_META[s]?.[ar ? 'ar' : 'en'] || s || (ar ? 'غير محدد' : 'Unspecified')

// ---------- sanitising ----------
const MAX_PROMPT = 2000
const MAX_TEXT = 20000
const MAX_ERR = 600
const MAX_REFS = 12
const MAX_URL = 1500

const str = (v, max) => {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v)
  const t = s.trim()
  return max && t.length > max ? t.slice(0, max) : t
}

// blob: URLs are revoked the moment the page reloads, and data: URLs of a
// generated image blow past the 1MB document limit. Storing either would create
// entries that look fine and are actually dead, so we store neither and say so.
function safeUrl(u) {
  const s = str(u, MAX_URL + 1)
  if (!s || /^(blob:|data:)/i.test(s) || s.length > MAX_URL) return ''
  return s
}

// Firestore rejects `undefined` outright, and a caller's meta object may carry
// functions, class instances or cycles. Reduce to plain JSON-ish values.
function plain(value, depth = 0) {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  const type = typeof value
  if (type === 'string') return str(value, 4000)
  if (type === 'number') return Number.isFinite(value) ? value : null
  if (type === 'boolean') return value
  if (depth >= 3) return null
  if (Array.isArray(value)) {
    return value
      .slice(0, 40)
      .map((v) => plain(v, depth + 1))
      .filter((v) => v !== null)
  }
  if (type === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value).slice(0, 40)) {
      const p = plain(v, depth + 1)
      if (p !== null) out[k] = p
    }
    return out
  }
  return null
}

const errText = (e) => {
  if (!e) return 'خطأ غير معروف'
  if (typeof e === 'string') return str(e, MAX_ERR) || 'خطأ غير معروف'
  return str(e.message || e.code || String(e), MAX_ERR) || 'خطأ غير معروف'
}

const looksLikeUrl = (s) => /^(https?:\/\/|\/)/i.test(s)

// Accepts a raw string (url or text), or the schema's { url, text, meta }.
export function normalizeResult(result) {
  if (result == null) return null
  if (typeof result === 'string') {
    const s = result.trim()
    if (!s) return null
    if (looksLikeUrl(s)) {
      const url = safeUrl(s)
      return url ? { url } : { meta: { urlOmitted: true } }
    }
    return { text: str(s, MAX_TEXT) }
  }
  if (typeof result !== 'object') return { text: str(result, MAX_TEXT) }
  const out = {}
  if (result.url) {
    const url = safeUrl(result.url)
    if (url) out.url = url
  }
  if (result.text) out.text = str(result.text, MAX_TEXT)
  const meta = plain(result.meta, 1)
  if (meta && Object.keys(meta).length) out.meta = meta
  // A url we refused to store (blob:/data:/oversized) is stated, not hidden.
  if (result.url && !out.url) out.meta = { ...(out.meta || {}), urlOmitted: true }
  return Object.keys(out).length ? out : null
}

function currentUser() {
  try {
    return auth?.currentUser || null
  } catch (_) {
    return null
  }
}

// Strips anything that is not part of the fixed schema.
function buildEntry(entry = {}) {
  const kind = GEN_KINDS.includes(entry.kind) ? entry.kind : 'other'
  const u = currentUser()
  const hasBy = entry.by && (entry.by.uid || entry.by.name)
  const by = hasBy
    ? { uid: str(entry.by.uid, 128) || null, name: str(entry.by.name, 120) }
    : { uid: u?.uid || null, name: str(u?.displayName || u?.email || '', 120) }
  const refUrls = Array.isArray(entry.refUrls) ? entry.refUrls.map(safeUrl).filter(Boolean).slice(0, MAX_REFS) : []
  const ok = entry.ok !== false && !entry.error
  return {
    kind,
    section: str(entry.section, 60) || 'other',
    prompt: str(entry.prompt, MAX_PROMPT),
    result: normalizeResult(entry.result),
    itemId: str(entry.itemId, 128) || null,
    refUrls,
    model: str(entry.model, 120),
    ok,
    error: ok ? null : errText(entry.error),
    by,
    at: serverTimestamp(),
    ms: Number.isFinite(Number(entry.ms)) ? Math.max(0, Math.round(Number(entry.ms))) : 0,
  }
}

// ---------- writing ----------

// Fire-and-forget. Resolves to the new doc id, or null when it could not be
// written (no tid, firebase not ready, rules, offline). NEVER rejects.
export function logGeneration(tid, entry) {
  try {
    if (!tid || !firebaseReady) return Promise.resolve(null)
    return addDoc(collection(db, 'tenants', tid, 'aiGenerations'), buildEntry(entry))
      .then((ref) => ref.id)
      .catch(() => null)
  } catch (_) {
    return Promise.resolve(null)
  }
}

// Wrap an async generation so the duration is recorded for you:
//
//   const g = startGen(tid, { kind: 'image', section: 'post-studio', prompt, model, refUrls })
//   try { const url = await generate(); g.done({ url }) }
//   catch (e) { g.fail(e); throw e }
//
// done() accepts a url string, a text string, or { url, text, meta }.
// Both settle once; a second call is ignored, so a done() in a try and a fail()
// in a catch can coexist safely.
export function startGen(tid, base = {}) {
  const t0 = Date.now()
  let settled = false
  const finish = (patch) => {
    if (settled) return Promise.resolve(null)
    settled = true
    return logGeneration(tid, { ...base, ...patch, ms: Date.now() - t0 })
  }
  return {
    done: (result, extra = {}) => finish({ ...extra, ok: true, error: null, result }),
    fail: (error, extra = {}) => finish({ ...extra, ok: false, error, result: null }),
    get settled() {
      return settled
    },
  }
}

export async function deleteGeneration(tid, id) {
  if (!tid || !id || !firebaseReady) return false
  await deleteDoc(doc(db, 'tenants', tid, 'aiGenerations', id))
  return true
}

// ---------- reading ----------
export function tsToMs(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (typeof v.toDate === 'function') return v.toDate().getTime()
  if (typeof v.seconds === 'number') return v.seconds * 1000
  return 0
}

// serverTimestamps:'estimate' means a just-written entry has a usable local time
// instead of a null that would sort and render as a blank.
const mapDoc = (d) => {
  const data = d.data({ serverTimestamps: 'estimate' }) || {}
  return { id: d.id, ...data, atMs: tsToMs(data.at) }
}

export const genDate = (row) => (row?.atMs ? new Date(row.atMs) : null)

export function resultKindOf(row) {
  if (row?.result?.url) return 'image'
  if (row?.result?.text) return 'text'
  return 'none'
}

// One-line preview for a card.
export function genPreviewText(row) {
  const p = str(row?.prompt)
  if (p) return p
  const t = str(row?.result?.text)
  if (t) return t
  return ''
}

// 'ar-EG-u-nu-latn' — Arabic month names, GREGORIAN calendar, Latin digits.
// ('ar-SA' would switch to the Hijri calendar, which makes a generation log hard
// to line up with the day the owner remembers.)
export function fmtWhen(row, ar = true, withTime = true) {
  const d = genDate(row)
  if (!d) return ar ? 'غير معروف' : 'unknown'
  const locale = ar ? 'ar-EG-u-nu-latn' : 'en-GB'
  try {
    const day = d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
    if (!withTime) return day
    return `${day} · ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })}`
  } catch (_) {
    return d.toISOString().slice(0, 16).replace('T', ' ')
  }
}

export function fmtDuration(ms, ar = true) {
  const n = Number(ms) || 0
  if (n <= 0) return ar ? 'غير مسجَّل' : 'not recorded'
  if (n < 1000) return `${Math.round(n)} ${ar ? 'مللي ثانية' : 'ms'}`
  const s = n / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} ${ar ? 'ثانية' : 's'}`
  const m = Math.floor(s / 60)
  return `${m} ${ar ? 'دقيقة' : 'min'} ${Math.round(s % 60)} ${ar ? 'ثانية' : 's'}`
}

// Distinct sections present in a result set, ordered by frequency — so the chip
// row shows what this venue actually uses rather than a hardcoded list.
export function sectionsIn(rows) {
  const counts = new Map()
  for (const r of rows || []) {
    const s = r?.section || 'other'
    counts.set(s, (counts.get(s) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count }))
}

// All filtering happens here (client-side, see the header note).
// opts: { kind, section, search, from, to, status: 'all'|'ok'|'failed' }
export function applyFilters(rows, opts = {}) {
  const { kind, section, from, to, status } = opts
  const search = str(opts.search).toLowerCase()
  const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null
  const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null
  return (rows || []).filter((r) => {
    if (kind && kind !== 'all' && r.kind !== kind) return false
    if (section && section !== 'all' && (r.section || 'other') !== section) return false
    if (status === 'ok' && !r.ok) return false
    if (status === 'failed' && r.ok) return false
    if (fromMs && (r.atMs || 0) < fromMs) return false
    if (toMs && (r.atMs || 0) > toMs) return false
    if (search) {
      const hay = `${r.prompt || ''} ${r.result?.text || ''} ${r.model || ''} ${r.by?.name || ''} ${r.section || ''}`.toLowerCase()
      if (!hay.includes(search)) return false
    }
    return true
  })
}

// Live history. cb(rows, error) — error is null on success and a string on
// failure, and cb is ALWAYS called on failure so the caller can leave its
// loading state. Returns an unsubscribe function (a no-op when it never started).
export function watchGenerations(tid, opts, cb) {
  const fn = typeof opts === 'function' ? opts : cb
  const o = typeof opts === 'function' ? {} : opts || {}
  if (typeof fn !== 'function') return () => {}
  if (!tid || !firebaseReady) {
    fn([], null)
    return () => {}
  }
  const cap = Math.min(Math.max(Number(o.limit) || DEFAULT_WINDOW, 1), MAX_WINDOW)
  try {
    const q = query(collection(db, 'tenants', tid, 'aiGenerations'), orderBy('at', 'desc'), qLimit(cap))
    return onSnapshot(
      q,
      (snap) => fn(applyFilters(snap.docs.map(mapDoc), o), null),
      (err) => fn([], errText(err)),
    )
  } catch (e) {
    fn([], errText(e))
    return () => {}
  }
}

// One-shot read. Resolves to [] on any failure rather than rejecting, so a
// non-UI consumer (the assistant answering "what did we generate?") degrades to
// "nothing to show" instead of blowing up a chat turn.
export async function listGenerations(tid, opts = {}) {
  if (!tid || !firebaseReady) return []
  const cap = Math.min(Math.max(Number(opts.limit) || DEFAULT_WINDOW, 1), MAX_WINDOW)
  try {
    const q = query(collection(db, 'tenants', tid, 'aiGenerations'), orderBy('at', 'desc'), qLimit(cap))
    const snap = await getDocs(q)
    return applyFilters(snap.docs.map(mapDoc), opts)
  } catch (_) {
    return []
  }
}
