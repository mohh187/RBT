// «استوديو الإعلانات» — the ad model, the targeting/frequency DECISION ENGINE,
// and the Firestore access behind both sides (venue designer + guest renderer).
//
// THE HONESTY CONTRACT (same spirit as gameRewards.js):
//   * An ad with nothing real to show (no media, no headline, no body) is never
//     rendered — `pickAd` drops it instead of flashing an empty box.
//   * A reward is only offered when the venue actually configured it. A points
//     reward with no value, or a coupon with neither code nor label, is refused
//     with the plain reason, never with a vague "check back later".
//   * The studio's stats are the raw counters written by the guest side. CTR is
//     `null` while impressions are zero — we show a dash, never a guessed rate.
//   * Points are NOT credited client-side. An anonymous diner cannot write the
//     customers doc, so a points reward issues a code the cashier honours (the
//     exact model «ركن الألعاب» already uses). The UI says so in those words.
//
// Firestore document — tenants/{tid}/ads/{adId}
//   { name, active, kind, shape, media:{type,url,poster},
//     headline, body, ctaLabel,
//     design:{ bg, textColor, accent, radius, overlayOpacity, textPos, fontKey },
//     target:{ link, itemId, categoryId, url, offerId },
//     trigger:{ on, delaySec, scrollPct },
//     audience:{ who, minVisits },
//     schedule:{ from, to, daysOfWeek, startTime, endTime },
//     frequency:{ perGuest, capPerDay },
//     reward:{ kind, value, code, label },
//     stats:{ impressions, clicks, dismissals, converted },
//     createdAt, updatedAt }
import {
  collection, doc, onSnapshot, getDocs, addDoc, updateDoc, deleteDoc, setDoc,
  serverTimestamp, increment,
} from 'firebase/firestore'
import { db, firebaseReady } from './firebase.js'
import { today, rewardCode, HOW_TO_CLAIM } from './gameRewards.js'

const col = (tid) => collection(db, 'tenants', tid, 'ads')
const adDoc = (tid, id) => doc(db, 'tenants', tid, 'ads', id)

// Latin digits, always (hard rule).
const num = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 2 })

// ---------------------------------------------------------------------------
// vocabulary — Arabic labels + Icon.jsx names (both sides read these)
// ---------------------------------------------------------------------------

// How the ad occupies the screen.
export const AD_KINDS = [
  { id: 'popup', ar: 'نافذة منبثقة', en: 'Popup', icon: 'layers', hint: 'تطفو فوق القائمة على خلفية معتمة' },
  { id: 'banner', ar: 'شريط إعلاني', en: 'Banner', icon: 'notepad', hint: 'شريط أسفل الشاشة والقائمة تبقى قابلة للتصفح' },
  { id: 'fullscreen', ar: 'ملء الشاشة', en: 'Fullscreen', icon: 'grid', hint: 'يغطي الشاشة بالكامل — أقوى أثراً وأكثر إزعاجاً' },
]

// The silhouette of the ad body itself.
export const AD_SHAPES = [
  { id: 'card', ar: 'بطاقة', en: 'Card', icon: 'notepad', hint: 'مستطيل بحواف دائرية — الخيار الآمن' },
  { id: 'circle', ar: 'دائرة', en: 'Circle', icon: 'shapes', hint: 'قرص دائري بالكامل — لافت ومميّز' },
  { id: 'sheet', ar: 'لوح سفلي', en: 'Bottom sheet', icon: 'arrowUp', hint: 'يصعد من أسفل الشاشة كورقة' },
  { id: 'wide', ar: 'شريط عريض', en: 'Wide', icon: 'arrowLeftRight', hint: 'صورة عريضة من حافة لحافة' },
]

export const TRIGGERS = [
  { id: 'open', ar: 'عند فتح القائمة', en: 'On open', icon: 'zap' },
  { id: 'delay', ar: 'بعد مدة', en: 'After a delay', icon: 'clock', field: 'delaySec' },
  { id: 'scroll', ar: 'بعد تمرير جزء من القائمة', en: 'After scrolling', icon: 'arrowUpDown', field: 'scrollPct' },
  { id: 'exit', ar: 'عند نية المغادرة', en: 'On exit intent', icon: 'logout', hint: 'على الحاسب فقط؛ على الجوال يتحول تلقائياً إلى مؤقت' },
]

export const AUDIENCES = [
  { id: 'all', ar: 'كل الضيوف', en: 'Everyone', icon: 'users' },
  { id: 'new', ar: 'الزائر لأول مرة', en: 'First-time', icon: 'star' },
  { id: 'returning', ar: 'الزائر العائد', en: 'Returning', icon: 'repeat' },
  { id: 'members', ar: 'الأعضاء فقط', en: 'Members only', icon: 'award' },
]

export const FREQUENCIES = [
  { id: 'always', ar: 'في كل مرة', en: 'Always', icon: 'repeat' },
  { id: 'once', ar: 'مرة واحدة لكل ضيف', en: 'Once per guest', icon: 'check' },
  { id: 'daily', ar: 'مرة كل يوم', en: 'Once a day', icon: 'calendar' },
  { id: 'session', ar: 'مرة كل جلسة', en: 'Once per session', icon: 'clock' },
]

// Where the CTA sends the guest. The renderer resolves these against live data.
export const LINK_TARGETS = [
  { id: 'none', ar: 'بدون رابط', en: 'No link', icon: 'no' },
  { id: 'item', ar: 'صنف من القائمة', en: 'Menu item', icon: 'menu' },
  { id: 'category', ar: 'قسم من القائمة', en: 'Category', icon: 'categories' },
  { id: 'offer', ar: 'عرض', en: 'Offer', icon: 'offers' },
  { id: 'games', ar: 'ركن الألعاب', en: 'Games corner', icon: 'sparkles' },
  { id: 'story', ar: 'الاستوريز', en: 'Stories', icon: 'image' },
  { id: 'url', ar: 'رابط خارجي', en: 'External link', icon: 'share' },
]

export const REWARD_KINDS = [
  { id: 'none', ar: 'بدون مكافأة', en: 'None', icon: 'no' },
  { id: 'points', ar: 'نقاط ولاء', en: 'Loyalty points', icon: 'award' },
  { id: 'coupon', ar: 'كوبون خصم', en: 'Coupon', icon: 'ticket' },
]

export const TEXT_POSITIONS = [
  { id: 'top', ar: 'أعلى', en: 'Top' },
  { id: 'center', ar: 'وسط', en: 'Center' },
  { id: 'bottom', ar: 'أسفل', en: 'Bottom' },
]

const ids = (list) => list.map((x) => x.id)
const pick = (list, v, fallback) => (ids(list).includes(v) ? v : fallback)
export const labelOf = (list, id) => (list.find((x) => x.id === id) || {}).ar || ''

// ---------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------
export const DEFAULT_DESIGN = {
  bg: '#101014',
  textColor: '#ffffff',
  accent: '#c8a15a',
  radius: 24,
  overlayOpacity: 45,
  textPos: 'bottom',
  fontKey: 'tajawal',
}

export function blankAd() {
  return {
    name: '',
    active: false,
    kind: 'popup',
    shape: 'card',
    media: { type: 'none', url: '', poster: '' },
    headline: '',
    body: '',
    ctaLabel: '',
    design: { ...DEFAULT_DESIGN },
    target: { link: 'none', itemId: '', categoryId: '', url: '', offerId: '' },
    trigger: { on: 'open', delaySec: 5, scrollPct: 40 },
    audience: { who: 'all', minVisits: 0 },
    schedule: { from: '', to: '', daysOfWeek: [], startTime: '', endTime: '' },
    frequency: { perGuest: 'session', capPerDay: 0 },
    reward: { kind: 'none', value: 0, code: '', label: '' },
    stats: { impressions: 0, clicks: 0, dismissals: 0, converted: 0 },
  }
}

const int = (v, def = 0) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? n : def
}
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const str = (v, max = 200) => String(v == null ? '' : v).slice(0, max)

// Every consumer (engine, preview, renderer) reads a normalized ad, so a
// half-written document from an older shape can never crash the guest menu.
export function normalizeAd(raw) {
  if (!raw || typeof raw !== 'object') return null
  const d = raw.design || {}
  const m = raw.media || {}
  const t = raw.target || {}
  const tr = raw.trigger || {}
  const a = raw.audience || {}
  const s = raw.schedule || {}
  const f = raw.frequency || {}
  const r = raw.reward || {}
  const st = raw.stats || {}
  return {
    id: raw.id || '',
    name: str(raw.name, 80),
    active: raw.active === true,
    kind: pick(AD_KINDS, raw.kind, 'popup'),
    shape: pick(AD_SHAPES, raw.shape, 'card'),
    media: {
      type: ['image', 'video', 'none'].includes(m.type) ? m.type : 'none',
      url: str(m.url, 600),
      poster: str(m.poster, 600),
    },
    headline: str(raw.headline, 120),
    body: str(raw.body, 400),
    ctaLabel: str(raw.ctaLabel, 40),
    design: {
      bg: str(d.bg, 32) || DEFAULT_DESIGN.bg,
      textColor: str(d.textColor, 32) || DEFAULT_DESIGN.textColor,
      accent: str(d.accent, 32) || DEFAULT_DESIGN.accent,
      radius: clamp(int(d.radius, DEFAULT_DESIGN.radius), 0, 80),
      overlayOpacity: clamp(int(d.overlayOpacity, DEFAULT_DESIGN.overlayOpacity), 0, 95),
      textPos: pick(TEXT_POSITIONS, d.textPos, 'bottom'),
      fontKey: str(d.fontKey, 24) || DEFAULT_DESIGN.fontKey,
    },
    target: {
      link: pick(LINK_TARGETS, t.link, 'none'),
      itemId: str(t.itemId, 64),
      categoryId: str(t.categoryId, 64),
      url: str(t.url, 600),
      offerId: str(t.offerId, 64),
    },
    trigger: {
      on: pick(TRIGGERS, tr.on, 'open'),
      delaySec: clamp(int(tr.delaySec, 5), 0, 600),
      scrollPct: clamp(int(tr.scrollPct, 40), 0, 100),
    },
    audience: {
      who: pick(AUDIENCES, a.who, 'all'),
      minVisits: clamp(int(a.minVisits, 0), 0, 999),
    },
    schedule: {
      from: dayString(s.from),
      to: dayString(s.to),
      daysOfWeek: Array.isArray(s.daysOfWeek) ? s.daysOfWeek.map((n) => int(n, -1)).filter((n) => n >= 0 && n <= 6) : [],
      startTime: /^\d{2}:\d{2}$/.test(String(s.startTime || '')) ? s.startTime : '',
      endTime: /^\d{2}:\d{2}$/.test(String(s.endTime || '')) ? s.endTime : '',
    },
    frequency: {
      perGuest: pick(FREQUENCIES, f.perGuest, 'session'),
      capPerDay: clamp(int(f.capPerDay, 0), 0, 50),
    },
    reward: {
      kind: pick(REWARD_KINDS, r.kind, 'none'),
      value: clamp(int(r.value, 0), 0, 100000),
      code: str(r.code, 24).trim().toUpperCase(),
      label: str(r.label, 60),
    },
    stats: {
      impressions: Math.max(0, int(st.impressions, 0)),
      clicks: Math.max(0, int(st.clicks, 0)),
      dismissals: Math.max(0, int(st.dismissals, 0)),
      converted: Math.max(0, int(st.converted, 0)),
    },
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  }
}

// Accepts 'YYYY-MM-DD', a Date, or an epoch — always returns a local day string
// or ''. Schedules compare day strings so a timezone shift cannot move a window.
function dayString(v) {
  if (!v) return ''
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''
  const d = v instanceof Date ? v : new Date(Number(v))
  return Number.isFinite(d.getTime()) ? today(d) : ''
}

// Is there anything real on this ad? An ad with no media and no words would
// render as an empty rectangle over the guest's menu — we refuse to show it.
export function hasContent(ad) {
  if (!ad) return false
  const hasMedia = ad.media?.type !== 'none' && !!ad.media?.url
  return hasMedia || !!ad.headline.trim() || !!ad.body.trim()
}

// Honest, specific problems the studio shows next to the ad. Each string names
// exactly what is missing and what the consequence is — no generic warnings.
export function adProblems(raw) {
  const ad = normalizeAd(raw)
  if (!ad) return ['السجل غير صالح.']
  const out = []
  if (!hasContent(ad)) out.push('لا صورة ولا نص — لن يظهر هذا الإعلان للضيف إطلاقاً.')
  if (ad.media.type !== 'none' && !ad.media.url) out.push('نوع الوسيط مضبوط على وسيط لكن لا يوجد ملف مرفوع.')
  const t = ad.target
  if (t.link === 'item' && !t.itemId) out.push('الربط مضبوط على صنف ولم يُختر صنف — زر الإجراء لن ينقل الضيف لأي مكان.')
  if (t.link === 'category' && !t.categoryId) out.push('الربط مضبوط على قسم ولم يُختر قسم.')
  if (t.link === 'offer' && !t.offerId) out.push('الربط مضبوط على عرض ولم يُختر عرض.')
  if (t.link === 'url' && !safeUrl(t.url)) out.push('الرابط الخارجي فارغ أو غير صالح — يجب أن يبدأ بـ https.')
  if (ad.ctaLabel.trim() && t.link === 'none') out.push('يوجد زر إجراء بلا وجهة — سيغلق الإعلان فقط.')
  if (ad.reward.kind === 'points' && ad.reward.value < 1) out.push('مكافأة نقاط بلا قيمة — لن تُعرض على الضيف.')
  if (ad.reward.kind === 'coupon' && !ad.reward.code && !ad.reward.label) out.push('كوبون بلا رمز ولا وصف — لن يُعرض على الضيف.')
  if (ad.schedule.from && ad.schedule.to && ad.schedule.from > ad.schedule.to) out.push('تاريخ البداية بعد تاريخ النهاية — لن يظهر في أي يوم.')
  if (ad.audience.who === 'new' && ad.audience.minVisits > 1) out.push('الجمهور «زائر لأول مرة» مع حد أدنى للزيارات أكبر من واحد — شرطان متناقضان، لن يظهر لأحد.')
  return out
}

// Real click-through rate, or null while there is nothing to divide by.
// The UI renders a dash for null — it must never invent a percentage.
export function ctrOf(ad) {
  const imp = Number(ad?.stats?.impressions) || 0
  if (imp <= 0) return null
  return ((Number(ad?.stats?.clicks) || 0) / imp) * 100
}

// Only absolute http(s) links leave the app.
export function safeUrl(u) {
  const s = String(u || '').trim()
  if (!/^https?:\/\//i.test(s)) return ''
  try { return new URL(s).toString() } catch (_) { return '' }
}

// The CTA destination, resolved against the venue's live data. Returns null
// when there is nothing valid to go to, so the renderer just closes instead of
// pretending a dead link works.
export function resolveTarget(ad, { items = [], categories = [] } = {}) {
  const t = normalizeAd(ad)?.target
  if (!t || t.link === 'none') return null
  if (t.link === 'item') {
    const item = (items || []).find((i) => i.id === t.itemId)
    return item ? { link: 'item', itemId: item.id, item } : null
  }
  if (t.link === 'category') {
    const cat = (categories || []).find((c) => c.id === t.categoryId)
    return cat ? { link: 'category', categoryId: cat.id, category: cat } : null
  }
  if (t.link === 'offer') return t.offerId ? { link: 'offer', offerId: t.offerId } : null
  if (t.link === 'games') return { link: 'games' }
  if (t.link === 'story') return { link: 'story' }
  if (t.link === 'url') {
    const url = safeUrl(t.url)
    return url ? { link: 'url', url } : null
  }
  return null
}

// ---------------------------------------------------------------------------
// Firestore — tenants/{tid}/ads
// ---------------------------------------------------------------------------
const byNewest = (a, b) => (msOf(b.createdAt) - msOf(a.createdAt)) || String(a.id).localeCompare(String(b.id))
function msOf(ts) {
  if (!ts) return 0
  if (typeof ts === 'number') return ts
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  return 0
}

// No orderBy: ads written before createdAt existed would silently vanish from an
// ordered query, and an index-less order clause is exactly how the other screens
// ended up with permanent spinners. The error callback ALWAYS fires a value.
export function watchAds(tid, cb) {
  if (!firebaseReady || !db || !tid) { cb([]); return () => {} }
  return onSnapshot(
    col(tid),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNewest)),
    () => cb([]),
  )
}

export async function listAds(tid) {
  if (!firebaseReady || !db || !tid) return []
  const s = await getDocs(col(tid))
  return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNewest)
}

// `stats` is deliberately stripped from every venue-side write: the counters
// belong to the guest side and a save from the studio must never reset them.
export async function saveAd(tid, id, data) {
  const clean = { ...data }
  delete clean.stats
  delete clean.id
  delete clean.createdAt
  if (id) return updateDoc(adDoc(tid, id), { ...clean, updatedAt: serverTimestamp() })
  const ref = await addDoc(col(tid), {
    ...clean,
    stats: { impressions: 0, clicks: 0, dismissals: 0, converted: 0 },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function deleteAd(tid, id) {
  return deleteDoc(adDoc(tid, id))
}

// A copy starts inactive with zeroed counters — carrying the original's numbers
// over would make the studio lie about a campaign that never ran.
export async function duplicateAd(tid, ad) {
  const src = normalizeAd(ad)
  if (!src) return null
  const copy = { ...src }
  delete copy.id
  delete copy.createdAt
  delete copy.updatedAt
  copy.active = false
  copy.name = `${src.name || 'إعلان'} — نسخة`
  return saveAd(tid, null, copy)
}

// ---------------------------------------------------------------------------
// the guest's own device ledger (localStorage) + session
// ---------------------------------------------------------------------------
// LIMIT, stated plainly: this ledger is the guest's browser. "Once per guest"
// really means "once per browser profile" — clearing storage or switching phone
// resets it. There is no diner account to hang it on, so this is the ceiling.
const seenKey = (tid) => `rbt_ads_seen_${tid || 'x'}`
const visitsKey = 'rbt_ads_visits'
const claimsKey = (tid) => `rbt_ad_claims_${tid || 'x'}`
const SESSION_KEY = 'rbt_ads_session'

export function sessionId() {
  try {
    let s = sessionStorage.getItem(SESSION_KEY)
    if (!s) {
      s = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      sessionStorage.setItem(SESSION_KEY, s)
    }
    return s
  } catch (_) { return '' }
}

// Per-ad record: { n, dn, d, at, s, clicked, dismissed, converted }
export function readSeen(tid) {
  try {
    const v = JSON.parse(localStorage.getItem(seenKey(tid)) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch (_) { return {} }
}

export function writeSeen(tid, map) {
  try { localStorage.setItem(seenKey(tid), JSON.stringify(map || {})) } catch (_) { /* storage off */ }
}

// Counts this device's visits to a venue, at most one per browser session.
// Returns the visit number of the CURRENT visit (first ever visit === 1).
export function noteVisit(tid) {
  if (!tid) return 1
  try {
    const all = JSON.parse(localStorage.getItem(visitsKey) || '{}')
    const rec = all[tid] || { n: 0, s: '' }
    const sid = sessionId()
    if (!sid || rec.s !== sid) {
      rec.n = (Number(rec.n) || 0) + 1
      rec.s = sid
      rec.at = Date.now()
      all[tid] = rec
      localStorage.setItem(visitsKey, JSON.stringify(all))
    }
    return Math.max(1, Number(rec.n) || 1)
  } catch (_) { return 1 }
}

export function visitCount(tid) {
  try {
    const all = JSON.parse(localStorage.getItem(visitsKey) || '{}')
    return Math.max(0, Number(all?.[tid]?.n) || 0)
  } catch (_) { return 0 }
}

// ---------------------------------------------------------------------------
// THE DECISION ENGINE — pure, deterministic, side-effect free.
//
// `ctx` = { now, visitCount, isMember, secondsInSession, scrollPct, seenMap,
//           sessionId, exitIntent }
//   `sessionId` and `exitIntent` are additions the spec's field list implies but
//   does not name: 'once per session' needs an identity for "this session" and
//   the 'exit' trigger needs the signal the renderer detected. Both default
//   safely (no session id => a session-capped ad behaves as un-capped once the
//   tab reloads; no exitIntent => exit-triggered ads simply do not fire).
//
// Returns ONE ad or null. It records nothing — the caller records the
// impression, which is what keeps this function testable.
// ---------------------------------------------------------------------------
export function pickAd(ads, ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date(Number(ctx.now) || Date.now())
  const seenMap = ctx.seenMap || {}
  const sid = ctx.sessionId || ''
  const eligible = []
  for (const raw of Array.isArray(ads) ? ads : []) {
    const ad = normalizeAd(raw)
    if (!ad || !ad.id) continue
    if (!ad.active) continue
    if (!hasContent(ad)) continue
    if (!inSchedule(ad.schedule, now)) continue
    if (!matchesAudience(ad.audience, ctx)) continue
    const seen = seenMap[ad.id] || null
    if (!withinFrequency(ad.frequency, seen, now, sid)) continue
    if (!triggerReady(ad.trigger, ctx)) continue
    eligible.push({ ad, seen: Number(seen?.n) || 0 })
  }
  if (!eligible.length) return null
  // Fair rotation: the ad this guest has seen least wins, then the older ad,
  // then the id — fully determined by (ads, ctx), so the same inputs always
  // produce the same answer.
  eligible.sort((a, b) => (
    a.seen - b.seen
    || msOf(a.ad.createdAt) - msOf(b.ad.createdAt)
    || String(a.ad.id).localeCompare(String(b.ad.id))
  ))
  return eligible[0].ad
}

function minutesOfDay(d) { return d.getHours() * 60 + d.getMinutes() }

export function inSchedule(s = {}, now = new Date()) {
  const day = today(now)
  if (s.from && day < s.from) return false
  if (s.to && day > s.to) return false
  const dows = Array.isArray(s.daysOfWeek) ? s.daysOfWeek : []
  if (dows.length && !dows.includes(now.getDay())) return false
  if (s.startTime && s.endTime) {
    const cur = minutesOfDay(now)
    const [sh, sm] = String(s.startTime).split(':').map(Number)
    const [eh, em] = String(s.endTime).split(':').map(Number)
    const start = sh * 60 + sm
    const end = eh * 60 + em
    // start <= end is a same-day window; otherwise it wraps past midnight.
    if (start <= end) {
      if (cur < start || cur > end) return false
    } else if (cur < start && cur > end) {
      return false
    }
  }
  return true
}

export function matchesAudience(a = {}, ctx = {}) {
  const visits = Math.max(0, Math.floor(Number(ctx.visitCount) || 0))
  const min = Math.max(0, Math.floor(Number(a.minVisits) || 0))
  if (visits < min) return false
  const who = a.who || 'all'
  if (who === 'new') return visits <= 1
  if (who === 'returning') return visits >= 2
  if (who === 'members') return ctx.isMember === true
  return true
}

export function withinFrequency(f = {}, seen, now = new Date(), sid = '') {
  const day = today(now)
  const total = Number(seen?.n) || 0
  const todayCount = seen?.d === day ? (Number(seen.dn) || 0) : 0
  const cap = Math.max(0, Math.floor(Number(f.capPerDay) || 0))
  if (cap > 0 && todayCount >= cap) return false
  const per = f.perGuest || 'always'
  if (per === 'once') return total < 1
  if (per === 'daily') return todayCount < 1
  if (per === 'session') return !(sid && seen?.s === sid)
  return true
}

export function triggerReady(t = {}, ctx = {}) {
  const on = t.on || 'open'
  if (on === 'delay') return (Number(ctx.secondsInSession) || 0) >= Math.max(0, Number(t.delaySec) || 0)
  if (on === 'scroll') return (Number(ctx.scrollPct) || 0) >= Math.max(0, Number(t.scrollPct) || 0)
  if (on === 'exit') return ctx.exitIntent === true
  return true
}

// ---------------------------------------------------------------------------
// recording — local ledger + aggregate counters. Fire-and-forget, never throws.
// ---------------------------------------------------------------------------
const STAT_FIELD = { impression: 'impressions', click: 'clicks', dismiss: 'dismissals', convert: 'converted' }

// `deviceId` is stored on the local record and used to derive the guest's reward
// code. We deliberately do NOT write a per-device impression row: that would be
// one Firestore write per view for data nobody reads. The venue sees totals.
export function markSeen(tid, adId, deviceId = '', action = 'impression') {
  const field = STAT_FIELD[action]
  if (!tid || !adId || !field) return null
  let rec = null
  try {
    const map = readSeen(tid)
    rec = map[adId] || { n: 0, dn: 0, d: '', at: 0, s: '' }
    const day = today()
    if (action === 'impression') {
      rec.n = (Number(rec.n) || 0) + 1
      rec.dn = rec.d === day ? (Number(rec.dn) || 0) + 1 : 1
      rec.d = day
      rec.s = sessionId()
    }
    if (action === 'click') rec.clicked = true
    if (action === 'dismiss') rec.dismissed = true
    if (action === 'convert') rec.converted = true
    rec.at = Date.now()
    if (deviceId) rec.dev = String(deviceId).slice(0, 48)
    map[adId] = rec
    writeSeen(tid, map)
  } catch (_) { /* storage off — counters below still work */ }
  bumpStat(tid, adId, field)
  return rec
}

// Aggregate counter on the ad doc. Guests are anonymous, so the rules must allow
// an unauthenticated update restricted to the stats.* fields (see the note the
// lead received). If they do not, this rejects silently and the guest sees an
// ad that works perfectly — only the venue's numbers stop moving.
function bumpStat(tid, adId, field) {
  if (!firebaseReady || !db) return
  try {
    updateDoc(adDoc(tid, adId), { [`stats.${field}`]: increment(1) }).catch(() => {})
  } catch (_) { /* never surfaces into the guest UI */ }
}

// ---------------------------------------------------------------------------
// rewards — the same model «ركن الألعاب» uses, for the same honest reason
// ---------------------------------------------------------------------------
export function readAdClaims(tid) {
  try {
    const v = JSON.parse(localStorage.getItem(claimsKey(tid)) || '[]')
    return Array.isArray(v) ? v.filter((c) => c && c.adId) : []
  } catch (_) { return [] }
}

function writeAdClaims(tid, list) {
  try { localStorage.setItem(claimsKey(tid), JSON.stringify((list || []).slice(-40))) } catch (_) { /* storage off */ }
}

const rewardScope = (ad, day) => (ad?.frequency?.perGuest === 'daily' ? day : 'once')

// Has this device already been handed this ad's reward in the current scope?
export function hasClaimedAd(tid, ad, day = today()) {
  const norm = normalizeAd(ad)
  if (!norm) return false
  const scope = rewardScope(norm, day)
  return readAdClaims(tid).some((c) => c.adId === norm.id && c.scope === scope)
}

// The truthful text for a configured reward, or '' when there is nothing real
// to promise. `''` is the signal the renderer uses to show no reward at all.
export function rewardText(reward) {
  if (!reward) return ''
  if (reward.kind === 'points') return reward.value >= 1 ? `${num(reward.value)} نقطة في برنامج ولاء المكان` : ''
  if (reward.kind === 'coupon') {
    const label = String(reward.label || '').trim()
    if (label) return label
    return reward.code ? `كوبون خصم بالرمز ${reward.code}` : ''
  }
  return ''
}

// Points are NOT credited here. An anonymous diner cannot write the customers
// document, and inventing a "points added" toast that no ledger backs would be
// a lie. So a points reward issues the same kind of cashier-honoured code the
// games corner issues, and says exactly that.
const HOW_TO_POINTS = 'أظهر هذا الرمز للكاشير ليضيف النقاط إلى عضويتك'

// Returns { ok, code, text, howTo, alreadyClaimed } on success, or
// { ok: false, message } naming the exact reason nothing can be given.
export function claimAdReward(tid, ad, { deviceId = '', day = today() } = {}) {
  const norm = normalizeAd(ad)
  if (!norm) return { ok: false, message: 'تعذّر قراءة هذا الإعلان.' }
  const r = norm.reward
  if (r.kind === 'none') return { ok: false, message: 'لا توجد مكافأة مرتبطة بهذا الإعلان.' }
  if (r.kind === 'points' && r.value < 1) {
    return { ok: false, message: 'لم تحدد المنشأة عدد النقاط لهذه المكافأة بعد، فلا شيء يمكن منحه الآن.' }
  }
  if (r.kind === 'coupon' && !r.code && !r.label) {
    return { ok: false, message: 'لم تضبط المنشأة تفاصيل هذا الكوبون بعد، فلا شيء يمكن منحه الآن.' }
  }
  const text = rewardText(r)
  if (!text) return { ok: false, message: 'المكافأة غير مكتملة الإعداد لدى المنشأة.' }

  const scope = rewardScope(norm, day)
  // Same entitlement => same code on every reopen, and no two guests share one.
  const code = rewardCode(
    { id: norm.id, gameId: 'ad', perGuest: scope === 'once' ? 'once' : 'daily', prize: { code: r.code } },
    { deviceId, day },
  )
  const already = hasClaimedAd(tid, norm, day)
  if (!already) {
    const ledger = readAdClaims(tid)
    ledger.push({ adId: norm.id, scope, code, kind: r.kind, value: r.value, text, day, at: Date.now() })
    writeAdClaims(tid, ledger)
    recordAdClaimRemote(tid, norm, { code, scope, day, deviceId, text }).catch(() => { /* best-effort mirror */ })
  }
  return {
    ok: true,
    kind: r.kind,
    code,
    text,
    howTo: r.kind === 'points' ? HOW_TO_POINTS : HOW_TO_CLAIM,
    alreadyClaimed: already,
  }
}

const safeId = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)

// tenants/{tid}/adRewardClaims/{deviceId}_{adId}_{scope}
// Deterministic id: one row per entitlement, so reopening the ad overwrites
// instead of spamming rows, and staff can reconcile what was handed out.
export async function recordAdClaimRemote(tid, ad, { code = '', scope = 'once', day = today(), deviceId = '', text = '' } = {}) {
  if (!firebaseReady || !db || !tid || !ad?.id) return false
  const id = `${safeId(deviceId)}_${safeId(ad.id)}_${safeId(scope)}`
  await setDoc(doc(db, 'tenants', tid, 'adRewardClaims', id), {
    adId: ad.id,
    adName: ad.name || '',
    rewardKind: ad.reward.kind,
    rewardValue: ad.reward.value,
    rewardLabel: ad.reward.label || '',
    text,
    code,
    scope,
    day,
    deviceId: safeId(deviceId),
    at: serverTimestamp(),
  }, { merge: true })
  return true
}
