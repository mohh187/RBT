// Guest-behavior capture SDK (RBT360).
//
// ONE Firestore doc per guest session: tenants/{tid}/sessions/{sid}.
// Never one doc per event — writes must stay cheap. The full session state is
// held in memory (mirrored to sessionStorage so a reload continues the SAME
// session) and pushed with setDoc(..., { merge: true }) at most every 8s.
//
// HONEST MEASUREMENT LIMITS (read before trusting any number this produces):
//  - "dwell" is time an item detail was open and the tab was visible. It proves
//    the dish was ON SCREEN, not that a human was looking at it. A phone left
//    face-up on the table looks identical to genuine interest, which is why a
//    single open is capped at MAX_OPEN_DWELL_MS and the clock pauses the moment
//    the tab is hidden.
//  - durationMs is ACTIVE time: wall clock minus every idle gap over IDLE_MS.
//    It is not "time in the restaurant".
//  - abandonedAt is the last place the guest was when they went quiet. Going
//    quiet can mean "left" or "put the phone down and ordered from a waiter".
//    It is a signal, never a verdict.
//  - Sessions are per browser tab. One guest with two tabs is two sessions;
//    one phone passed around a table is one session.
import { doc, setDoc } from 'firebase/firestore'
import { db } from './firebase.js'
import { deviceKey } from './device.js'
import { normalizePhone } from './format.js'

// ---------- tunables ----------
const FLUSH_MS = 8000            // max one write per this window (plus forced flushes)
const IDLE_MS = 90000            // no events for this long = idle gap (excluded from duration)
const EVENT_CAP = 300            // hard cap, oldest dropped
const SEARCH_CAP = 20
const MAX_OPEN_DWELL_MS = 600000 // one item open can never contribute more than this
const PERSIST_MS = 1000          // throttle for the sessionStorage mirror
const STR_CAP = 60               // every captured string is truncated to this

// ---------- privacy copy (Arabic, for the venue's own privacy notice) ----------
export const TRACK_PRIVACY_AR = [
  'نقيس تفاعل الضيف مع القائمة لتحسين الأصناف والعروض فقط.',
  'ما نسجله: الصفحات والأصناف التي فُتحت، مدة بقاء الصنف مفتوحاً، الإضافة والحذف من السلة،',
  'فتح العرض ثلاثي الأبعاد، الألعاب، كلمات البحث داخل القائمة، وإتمام الطلب من عدمه.',
  'ما لا نسجله إطلاقاً: أي نص يكتبه الضيف عدا كلمات البحث داخل القائمة، ولا الاسم أو رقم الجوال',
  'إلا بعد أن يسجّل الضيف بياناته بنفسه في هذا المطعم.',
  'المعرّف المستخدم خاص بهذا الجهاز ولا يُشارك بين المطاعم، ولا نجمع أي بصمة جهاز إضافية.',
  'يمكن للمنشأة إيقاف القياس بالكامل من الإعدادات.',
].join(' ')

// ---------- module state ----------
let S = null              // live session state (superset of the Firestore doc)
let tenantId = ''
let enabled = true
let bound = false
let flushTimer = null
let idleTimer = null
let flushing = false
let dirty = false
let queuedForce = false   // a forced flush that arrived while one was in flight
let version = 0           // bumped on every mutation, so a mid-write change is not lost
let lastFlushAt = 0
let lastPersistAt = 0
let lastEventAt = 0
let openItem = null       // { id, name, at, paused }
let lastPage = ''

const sidKey = (tid) => `rbt_track_sid:${tid}`
const stateKey = (tid) => `rbt_track_state:${tid}`

// ---------- tiny safe helpers (this SDK must never throw into the menu) ----------
function safe(fn) {
  try { return fn() } catch (_) { return undefined }
}

// Single choke point for "the session changed" — keeps dirty and version in step.
function markDirty() {
  dirty = true
  version++
}

function safeStr(v) {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  return s.length > STR_CAP ? s.slice(0, STR_CAP) : s
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Keys that could carry something the guest typed or that identifies them.
// Anything matching is dropped from event meta, in the SDK, unconditionally —
// so an instrumentation mistake upstream cannot leak free text into analytics.
const BLOCKED_META_KEY = /(note|comment|remark|text|message|msg|addr|address|mail|phone|mobile|tel|name|user|password|pass|token|otp|card|iban|cvv|coupon|code)/i

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {}
  const out = {}
  let n = 0
  for (const k of Object.keys(meta)) {
    if (n >= 8) break
    if (BLOCKED_META_KEY.test(k)) continue
    const v = meta[k]
    if (typeof v === 'number') { if (Number.isFinite(v)) { out[k] = v; n++ } }
    else if (typeof v === 'boolean') { out[k] = v; n++ }
    else if (typeof v === 'string') { const s = safeStr(v); if (s) { out[k] = s; n++ } }
    // objects, arrays, functions, null: deliberately dropped
  }
  return out
}

function readItem(item) {
  if (!item) return null
  if (typeof item === 'string') return { id: safeStr(item), name: '' }
  const id = safeStr(item.id || item.itemId || item.key)
  if (!id) return null
  return { id, name: safeStr(item.name || item.nameAr || item.title || '') }
}

// Coarse platform bucket. Deliberately NOT navigator.platform / UA string —
// three values is all the analytics needs and it is not a fingerprint.
function platformBucket() {
  const ua = safe(() => navigator.userAgent) || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}

function readDevice() {
  return {
    w: num(safe(() => window.innerWidth)),
    h: num(safe(() => window.innerHeight)),
    lang: safeStr(safe(() => navigator.language) || ''),
    standalone: !!safe(() => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true),
    platform: platformBucket(),
  }
}

function newState(sid, opts) {
  const now = Date.now()
  return {
    sid,
    deviceId: safe(() => deviceKey()) || '',
    startedAt: now,
    lastAt: now,
    idleMs: 0, // local only — never written to Firestore, durationMs is derived from it
    customerPhone: null,
    customerName: null,
    entry: {
      table: safeStr(opts.table) || null,
      source: safeStr(opts.source) || 'direct',
      ref: safeStr(opts.ref) || safe(() => new URLSearchParams(location.search).get('ref')) || '',
    },
    device: readDevice(),
    counts: { views: 0, taps: 0, itemViews: 0, arOpens: 0, gamePlays: 0, cartAdds: 0, cartRemoves: 0, checkouts: 0, searches: 0 },
    events: [],
    items: {},
    search: [],
    outcome: { ordered: false, orderId: null, total: null, abandonedAt: null },
  }
}

// ---------- sessionStorage mirror (survives reload, never leaves the device) ----------
function persistLocal(force) {
  if (!S || !tenantId) return
  const now = Date.now()
  if (!force && now - lastPersistAt < PERSIST_MS) return
  lastPersistAt = now
  safe(() => sessionStorage.setItem(stateKey(tenantId), JSON.stringify(S)))
}

function restoreLocal(tid, sid) {
  const raw = safe(() => sessionStorage.getItem(stateKey(tid)))
  if (!raw) return null
  const v = safe(() => JSON.parse(raw))
  if (!v || v.sid !== sid || !v.counts || !Array.isArray(v.events)) return null
  // defensive: fill anything an older shape is missing
  v.items = v.items && typeof v.items === 'object' ? v.items : {}
  v.search = Array.isArray(v.search) ? v.search : []
  v.outcome = v.outcome || { ordered: false, orderId: null, total: null, abandonedAt: null }
  v.idleMs = num(v.idleMs)
  return v
}

function makeSid() {
  const r = safe(() => window.crypto && window.crypto.randomUUID && window.crypto.randomUUID())
  return r || `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

// ---------- duration / idle ----------
// A gap longer than IDLE_MS is treated as the guest being away and is removed
// from durationMs. durationMs is therefore ACTIVE time, never wall clock.
function absorbIdle(now) {
  if (lastEventAt && now - lastEventAt > IDLE_MS) S.idleMs += now - lastEventAt
}

function activeDuration() {
  if (!S) return 0
  return Math.max(0, (S.lastAt - S.startedAt) - S.idleMs)
}

// ---------- item dwell ----------
function closeOpenItem(atMs) {
  if (!S || !openItem) return
  if (!openItem.paused) {
    const raw = Math.max(0, num(atMs) - openItem.at)
    const rec = S.items[openItem.id]
    if (rec) rec.dwellMs += Math.min(raw, MAX_OPEN_DWELL_MS)
  }
  openItem = null
}

function pauseOpenItem(atMs) {
  if (!S || !openItem || openItem.paused) return
  const raw = Math.max(0, num(atMs) - openItem.at)
  const rec = S.items[openItem.id]
  if (rec) rec.dwellMs += Math.min(raw, MAX_OPEN_DWELL_MS)
  openItem.paused = true
}

function resumeOpenItem(atMs) {
  if (!S || !openItem || !openItem.paused) return
  openItem.at = num(atMs)
  openItem.paused = false
}

function itemRec(id, name) {
  if (!S.items[id]) S.items[id] = { name: name || '', views: 0, dwellMs: 0, added: 0, removed: 0, ordered: 0 }
  else if (name && !S.items[id].name) S.items[id].name = name
  return S.items[id]
}

// ---------- where the guest currently is (for abandonedAt) ----------
function whereNow() {
  if (openItem) return `item:${openItem.id}`
  if (lastPage) return `page:${lastPage}`
  return 'page:menu'
}

function armIdle() {
  safe(() => clearTimeout(idleTimer))
  idleTimer = safe(() => setTimeout(onIdle, IDLE_MS))
}

function onIdle() {
  if (!S || !enabled) return
  // Dwell must stop at the START of the silence, not now — the guest was not
  // looking at the dish for the 90s they were doing nothing.
  pauseOpenItem(lastEventAt || Date.now())
  if (!S.outcome.ordered) S.outcome.abandonedAt = whereNow()
  markDirty()
  persistLocal(true)
  flush(true)
}

// ---------- the single write ----------
// Picks EXACTLY the agreed schema fields. Local-only bookkeeping (idleMs) never
// reaches Firestore, so the lead's rules can validate a closed field set.
function toDoc() {
  return {
    sid: S.sid,
    deviceId: S.deviceId,
    startedAt: S.startedAt,
    lastAt: S.lastAt,
    durationMs: activeDuration(),
    customerPhone: S.customerPhone || null,
    customerName: S.customerName || null,
    entry: S.entry,
    device: S.device,
    counts: S.counts,
    events: S.events,
    items: S.items,
    search: S.search,
    outcome: S.outcome,
  }
}

// merge:true + full-state payload means a failed flush loses nothing: the state
// stays in memory and the NEXT flush carries it. Nothing is ever thrown.
async function flush(force) {
  if (!enabled || !S || !tenantId) return false
  // A forced flush (hidden / pagehide / order / identify) that lands while a
  // write is in flight must NOT be dropped — it is re-run when that write ends.
  if (flushing) { if (force) queuedForce = true; return false }
  if (!dirty && !force) return false
  const now = Date.now()
  if (!force && now - lastFlushAt < FLUSH_MS) return false
  flushing = true
  const payload = safe(toDoc)
  if (!payload) { flushing = false; return false }
  // INVARIANT: the local mirror is never older than what we have written to
  // Firestore. Without this, a reload right after a burst of activity would
  // restore a stale state and the NEXT merge write would regress the doc.
  persistLocal(true)
  const v = version
  try {
    await setDoc(doc(db, 'tenants', tenantId, 'sessions', S.sid), payload, { merge: true })
    lastFlushAt = Date.now()
    // Only clear dirty if nothing changed while the write was in flight —
    // otherwise those events would sit unwritten until the guest acts again.
    if (version === v) dirty = false
    return true
  } catch (_) {
    return false // keep dirty; the next flush retries with the same full state
  } finally {
    flushing = false
    if (queuedForce) { queuedForce = false; safe(() => flush(true)) }
  }
}

// ---------- event core ----------
function push(type, target, meta) {
  if (!enabled || !S) return
  safe(() => {
    const now = Date.now()
    absorbIdle(now)
    S.events.push({ t: now - S.startedAt, type, target: safeStr(target), meta: sanitizeMeta(meta) })
    if (S.events.length > EVENT_CAP) S.events.splice(0, S.events.length - EVENT_CAP)
    S.lastAt = now
    lastEventAt = now
    markDirty()
    persistLocal()
    armIdle()
  })
}

// ---------- page lifecycle ----------
function onVisibility() {
  if (!S) return
  if (document.visibilityState === 'hidden') {
    pauseOpenItem(Date.now())
    S.lastAt = Date.now()
    markDirty()
    persistLocal(true)
    flush(true)
  } else {
    resumeOpenItem(Date.now())
    armIdle()
  }
}

function onPageHide() {
  if (!S) return
  pauseOpenItem(Date.now())
  markDirty()
  persistLocal(true)
  flush(true)
}

function bindListeners() {
  if (bound) return
  bound = true
  safe(() => document.addEventListener('visibilitychange', onVisibility))
  safe(() => window.addEventListener('pagehide', onPageHide))
}

function unbindListeners() {
  if (!bound) return
  bound = false
  safe(() => document.removeEventListener('visibilitychange', onVisibility))
  safe(() => window.removeEventListener('pagehide', onPageHide))
}

// ---------- public API ----------

// Starts a session, or resumes the one already in this tab (reload-safe).
// Returns the session id, or '' when tracking is off.
export function initTracking(tid, options = {}) {
  return safe(() => {
    if (options.enabled === false) { setTrackingEnabled(false); return '' }
    enabled = true
    tenantId = safeStr(tid)
    if (!tenantId) return ''

    let sid = safe(() => sessionStorage.getItem(sidKey(tenantId))) || ''
    let restored = sid ? restoreLocal(tenantId, sid) : null
    if (!restored) {
      sid = makeSid()
      safe(() => sessionStorage.setItem(sidKey(tenantId), sid))
      restored = newState(sid, options)
    } else {
      // resumed after a reload: refresh viewport, keep everything else
      restored.device = readDevice()
      if (options.table && !restored.entry.table) restored.entry.table = safeStr(options.table)
    }
    S = restored
    lastEventAt = S.lastAt || S.startedAt
    openItem = null
    lastPage = ''
    markDirty()

    bindListeners()
    safe(() => clearInterval(flushTimer))
    flushTimer = safe(() => setInterval(() => { flush(false) }, FLUSH_MS))
    armIdle()
    persistLocal(true)
    flush(true)
    return S.sid
  }) || ''
}

// Kill switch. Off = every capture call becomes a no-op and no write is made.
export function setTrackingEnabled(on) {
  enabled = !!on
  if (!enabled) {
    safe(() => clearInterval(flushTimer))
    safe(() => clearTimeout(idleTimer))
    flushTimer = null
    idleTimer = null
    openItem = null
    queuedForce = false
    unbindListeners()
  }
  return enabled
}

export function isTrackingEnabled() { return !!enabled && !!S }

// Detach timers/listeners (call on unmount). Flushes what is pending first.
export function stopTracking() {
  safe(() => { pauseOpenItem(Date.now()); flush(true) })
  safe(() => clearInterval(flushTimer))
  safe(() => clearTimeout(idleTimer))
  flushTimer = null
  idleTimer = null
  unbindListeners()
}

export function flushNow() { return flush(true) }

export function trackView(page) {
  if (!enabled || !S) return
  lastPage = safeStr(page)
  S.counts.views++
  push('view', lastPage, null)
}

export function trackTap(target, meta) {
  if (!enabled || !S) return
  S.counts.taps++
  push('tap', target, meta)
}

// Opens the dwell clock for an item. Opening a second item auto-closes the first.
export function trackItemView(item) {
  if (!enabled || !S) return
  const it = readItem(item)
  if (!it) return
  const now = Date.now()
  if (openItem && openItem.id !== it.id) closeOpenItem(now)
  const rec = itemRec(it.id, it.name)
  rec.views++
  S.counts.itemViews++
  openItem = { id: it.id, name: it.name, at: now, paused: false }
  push('itemView', it.id, null)
}

export function trackItemClose(item) {
  if (!enabled || !S) return
  const it = readItem(item)
  const now = Date.now()
  if (!openItem) return
  if (it && it.id !== openItem.id) return
  const id = openItem.id
  closeOpenItem(now)
  push('itemClose', id, null)
}

export function trackAr(itemId) {
  if (!enabled || !S) return
  const id = safeStr(itemId)
  if (id) itemRec(id, '')
  S.counts.arOpens++
  push('ar', id, null)
}

export function trackGame(gameId, score) {
  if (!enabled || !S) return
  S.counts.gamePlays++
  push('game', gameId, { score: num(score) })
}

export function trackCartAdd(item, qty) {
  if (!enabled || !S) return
  const it = readItem(item)
  if (!it) return
  const q = Math.max(1, Math.round(num(qty) || 1))
  itemRec(it.id, it.name).added += q
  S.counts.cartAdds++
  push('cartAdd', it.id, { qty: q })
}

export function trackCartRemove(item) {
  if (!enabled || !S) return
  const it = readItem(item)
  if (!it) return
  itemRec(it.id, it.name).removed++
  S.counts.cartRemoves++
  push('cartRemove', it.id, null)
}

// Search text is the ONE piece of guest-typed text captured — it is the whole
// point of the feature (zero-result searches tell the venue what it is missing).
export function trackSearch(q, resultCount) {
  if (!enabled || !S) return
  const text = safeStr(q)
  if (!text) return
  S.counts.searches++
  S.search.push({ q: text, results: Math.max(0, Math.round(num(resultCount))), at: Date.now() })
  if (S.search.length > SEARCH_CAP) S.search.splice(0, S.search.length - SEARCH_CAP)
  push('search', text, { results: Math.max(0, Math.round(num(resultCount))) })
}

export function trackCheckout() {
  if (!enabled || !S) return
  S.counts.checkouts++
  push('checkout', 'checkout', null)
}

// orderedItems is optional. When the caller does not pass it we fall back to
// what our OWN cart events say was still in the cart (added minus removed) —
// stated plainly because it is an inference, not a read of the order document.
export function trackOrdered(orderId, total, orderedItems) {
  if (!enabled || !S) return
  S.outcome = {
    ordered: true,
    orderId: safeStr(orderId) || null,
    total: Number.isFinite(Number(total)) ? Number(total) : null,
    abandonedAt: null,
  }
  safe(() => {
    if (Array.isArray(orderedItems) && orderedItems.length) {
      for (const raw of orderedItems) {
        const it = readItem(raw)
        if (!it) continue
        const q = Math.max(1, Math.round(num(raw && raw.qty) || 1))
        itemRec(it.id, it.name).ordered += q
      }
    } else {
      for (const id of Object.keys(S.items)) {
        const rec = S.items[id]
        const left = rec.added - rec.removed
        if (left > 0) rec.ordered = left
      }
    }
  })
  push('ordered', S.outcome.orderId || '', { total: S.outcome.total === null ? 0 : S.outcome.total })
  flush(true)
}

// The bridge to the CRM profile: called by the app ONLY once the guest has
// entered their own details. Until then customerPhone/customerName stay null.
export function identify(who = {}) {
  if (!enabled || !S) return
  const name = safeStr(who.name)
  const phone = safe(() => normalizePhone(who.phone)) || ''
  if (!name && !phone) return
  if (name) S.customerName = name
  if (phone) S.customerPhone = phone
  push('identify', phone ? 'phone' : 'name', null)
  flush(true) // link it immediately — this is the moment the session gains an owner
}

export function getSessionId() { return S ? S.sid : '' }

// Debug/inspection copy. Includes the local-only fields (idleMs, openItem) that
// are never written to Firestore.
export function currentSessionSnapshot() {
  if (!S) return null
  return safe(() => ({
    ...JSON.parse(JSON.stringify(S)),
    durationMs: activeDuration(),
    _local: {
      enabled,
      tenantId,
      dirty,
      lastFlushAt,
      openItem: openItem ? { ...openItem } : null,
      lastPage,
      bufferedEvents: S.events.length,
    },
  })) || null
}
