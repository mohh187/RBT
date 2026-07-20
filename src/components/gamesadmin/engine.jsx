// Pure computation + bounded reads behind «مركز الألعاب».
//
// No component here. Everything is either a plain function over rows the venue
// actually wrote, or a HARD-BOUNDED Firestore read. Two rules hold throughout:
//
//   1. Nothing is estimated. A figure that cannot be counted is `null`, and the
//      UI prints «—» next to the sample size rather than a confident zero.
//   2. Every read carries a limit and a progressive fallback, so a missing
//      composite index or a strict rule degrades to "fewer rows" — never to a
//      thrown error and never to a spinner that hangs.
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { db, firebaseReady } from '../../lib/firebase.js'
import { GAMES } from '../../lib/games.js'

// --------------------------------------------------------------------------
// read bounds
// --------------------------------------------------------------------------
export const MAX_PLAYS = 500
export const MAX_PROFILES = 400
export const MAX_SCORES = 300
export const MAX_CLAIMS = 500
export const MAX_ROOMS = 40

// Below this a per-game figure is LABELLED thin everywhere it appears. It is
// never hidden — a manager needs to see the number AND how little backs it.
export const THIN_PLAYS = 15

const num = (v, f = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : f
}
const round2 = (n) => Math.round(n * 100) / 100

// Latin digits, always (hard rule).
export const fmtInt = (n) => Math.round(num(n)).toLocaleString('ar-SA-u-nu-latn')
export const fmtPct = (frac) => (frac == null ? '—' : `${Math.round(num(frac) * 100).toLocaleString('ar-SA-u-nu-latn')}٪`)

export const dayStamp = (ms) => (num(ms) ? new Date(num(ms)).toLocaleDateString('en-CA') : '—')
export const clockOf = (ms) => (num(ms) ? new Date(num(ms)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—')
export const dateTime = (ms) => (num(ms) ? `${dayStamp(ms)} ${clockOf(ms)}` : '—')

// A duration a human reads at a glance. `null` in, «—» out — never "0 ثانية"
// standing in for "we never measured it".
export function durText(seconds) {
  if (seconds == null) return '—'
  const s = Math.max(0, Math.round(num(seconds)))
  if (s < 60) return `${fmtInt(s)} ثانية`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest ? `${fmtInt(m)} د ${fmtInt(rest)} ث` : `${fmtInt(m)} دقيقة`
}

export function elapsedText(fromMs, now = Date.now()) {
  const ms = Math.max(0, now - num(fromMs))
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'أقل من دقيقة'
  if (mins < 60) return `${fmtInt(mins)} دقيقة`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${fmtInt(h)} س ${fmtInt(m)} د` : `${fmtInt(h)} ساعة`
}

// --------------------------------------------------------------------------
// period picker (shared with the rest of the admin's reporting vocabulary)
// --------------------------------------------------------------------------
export const PERIODS = [
  { key: 'd7', ar: '7 أيام', en: '7 days' },
  { key: 'd30', ar: '30 يوماً', en: '30 days' },
  { key: 'd90', ar: '90 يوماً', en: '90 days' },
  { key: 'custom', ar: 'مخصص', en: 'Custom' },
]

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }

export function periodRange(key, custom = {}) {
  const now = new Date()
  let from = startOfDay(now)
  let to = endOfDay(now)
  if (key === 'd7') { from = startOfDay(now); from.setDate(from.getDate() - 6) } else if (key === 'd30') { from = startOfDay(now); from.setDate(from.getDate() - 29) } else if (key === 'd90') { from = startOfDay(now); from.setDate(from.getDate() - 89) } else if (key === 'custom') {
    from = custom.from ? startOfDay(new Date(custom.from)) : startOfDay(new Date(now.getFullYear(), now.getMonth(), 1))
    to = custom.to ? endOfDay(new Date(custom.to)) : endOfDay(now)
  }
  if (Number.isNaN(from.getTime())) from = startOfDay(now)
  if (Number.isNaN(to.getTime())) to = endOfDay(now)
  return { from, to }
}

// --------------------------------------------------------------------------
// categories
//
// The registry carries `kind` on the newer entries and omits it on the original
// arcade titles. Rather than edit the registry, "no kind" resolves to 'arcade'
// here — one place, so the catalogue, the filters and the bulk actions can
// never disagree about which group a game is in.
// --------------------------------------------------------------------------
export const GAME_KINDS = [
  { id: 'arcade', ar: 'ألعاب سريعة', en: 'Arcade' },
  { id: 'trivia', ar: 'معرفة وأسئلة', en: 'Knowledge' },
  { id: 'puzzle', ar: 'ألغاز وذكاء', en: 'Puzzles' },
  { id: 'insight', ar: 'شخصية وذوق', en: 'Insight' },
  { id: 'party', ar: 'ألعاب جماعية', en: 'Party' },
]

export const kindOf = (g) => (g && g.kind) || 'arcade'
export const kindLabel = (id, ar = true) => {
  const k = GAME_KINDS.find((x) => x.id === id)
  return k ? (ar ? k.ar : k.en) : id
}

// --------------------------------------------------------------------------
// tenant.games — the SAME array the settings picker writes.
//
// `null`/absent means "never configured", which the registry treats as "every
// game on". This module materialises that default the moment the venue makes
// its first change, so an explicit order can be stored without the toggle and
// the ordering disagreeing about what "on" means.
// --------------------------------------------------------------------------
export const configuredIds = (tenant) => (Array.isArray(tenant?.games) ? tenant.games : null)

export function enabledIds(tenant) {
  const ids = configuredIds(tenant)
  if (!ids) return GAMES.map((g) => g.id)
  // Registry order is irrelevant here: the stored order IS the venue's order.
  return ids.filter((id) => GAMES.some((g) => g.id === id))
}

export function splitCatalogue(tenant) {
  const on = enabledIds(tenant)
  const onSet = new Set(on)
  const byId = new Map(GAMES.map((g) => [g.id, g]))
  return {
    enabled: on.map((id) => byId.get(id)).filter(Boolean),
    disabled: GAMES.filter((g) => !onSet.has(g.id)),
    usingDefaults: configuredIds(tenant) === null,
  }
}

// --------------------------------------------------------------------------
// per-game statistics, computed from gamePlays only
//
// Averages exclude plays that never ended (durationMs 0): an abandoned tab has
// no duration, and folding it in as zero would drag every average toward a lie.
// --------------------------------------------------------------------------
export function statsByGame(plays = []) {
  const map = new Map()
  for (const p of plays) {
    const id = p.gameId || 'unknown'
    const g = map.get(id) || {
      gameId: id, plays: 0, completed: 0, scoreSum: 0, scoreN: 0,
      best: 0, durSum: 0, durN: 0, devices: new Set(), lastAt: 0,
    }
    g.plays += 1
    if (p.completed === true) g.completed += 1
    // Only a finished play carries a meaningful score; a play still running is
    // recorded with score 0 and would deflate the average.
    if (num(p.endedAt) > 0) { g.scoreSum += num(p.score); g.scoreN += 1 }
    g.best = Math.max(g.best, num(p.score))
    if (num(p.durationMs) > 0) { g.durSum += num(p.durationMs); g.durN += 1 }
    if (p.deviceId) g.devices.add(p.deviceId)
    g.lastAt = Math.max(g.lastAt, num(p.endedAt) || num(p.startedAt))
    map.set(id, g)
  }
  const out = new Map()
  for (const g of map.values()) {
    out.set(g.gameId, {
      gameId: g.gameId,
      plays: g.plays,
      players: g.devices.size,
      completed: g.completed,
      completionRate: g.plays > 0 ? round2(g.completed / g.plays) : null,
      avgScore: g.scoreN > 0 ? Math.round(g.scoreSum / g.scoreN) : null,
      avgScoreN: g.scoreN,
      best: g.best,
      avgDurationSec: g.durN > 0 ? Math.round(g.durSum / g.durN / 1000) : null,
      avgDurationN: g.durN,
      lastAt: g.lastAt,
      thin: g.plays < THIN_PLAYS,
    })
  }
  return out
}

// A game with no play in the window gets this row: zeros that are TRUE (nothing
// happened) next to nulls that are honest (nothing was measured).
export const emptyStat = (gameId) => ({
  gameId, plays: 0, players: 0, completed: 0, completionRate: null,
  avgScore: null, avgScoreN: 0, best: 0, avgDurationSec: null, avgDurationN: 0,
  lastAt: 0, thin: true, noData: true,
})

export function recentPlaysFor(plays = [], gameId, max = 12) {
  return plays
    .filter((p) => p.gameId === gameId)
    .sort((a, b) => num(b.startedAt) - num(a.startedAt))
    .slice(0, max)
}

// --------------------------------------------------------------------------
// bounded reads
// --------------------------------------------------------------------------
const rowsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))

export async function fetchPlays(tid, fromMs, toMs, cap = MAX_PLAYS) {
  if (!firebaseReady || !tid) return []
  const inWindow = (p) => {
    const t = num(p.startedAt)
    return t >= fromMs && t <= toMs
  }
  const ref = collection(db, 'tenants', tid, 'gamePlays')
  try {
    return rowsOf(await getDocs(query(ref, where('startedAt', '>=', fromMs), orderBy('startedAt', 'desc'), limit(cap)))).filter(inWindow)
  } catch (_) { /* no index for the range — try a plain sort */ }
  try {
    return rowsOf(await getDocs(query(ref, orderBy('startedAt', 'desc'), limit(cap)))).filter(inWindow)
  } catch (_) { /* no sort allowed — take whatever is readable */ }
  try {
    return rowsOf(await getDocs(query(ref, limit(cap)))).filter(inWindow)
  } catch (_) { return [] }
}

export async function fetchProfiles(tid, cap = MAX_PROFILES) {
  if (!firebaseReady || !tid) return []
  const ref = collection(db, 'tenants', tid, 'playerProfiles')
  try {
    return rowsOf(await getDocs(query(ref, orderBy('lastAt', 'desc'), limit(cap))))
  } catch (_) { /* unordered fallback */ }
  try {
    return rowsOf(await getDocs(query(ref, limit(cap))))
  } catch (_) { return [] }
}

// The monthly fishing board. Read unordered and unfiltered by month on purpose:
// the tournament engine decides which rows fall inside its own window, and a
// month filter here would hide a row a longer window legitimately covers.
export async function fetchScores(tid, cap = MAX_SCORES) {
  if (!firebaseReady || !tid) return []
  try {
    return rowsOf(await getDocs(query(collection(db, 'tenants', tid, 'gameScores'), limit(cap))))
  } catch (_) { return [] }
}

// Reward codes actually issued. Written best-effort by gameRewards.claimReward,
// which matters for how the number is LABELLED: it is a floor, not a census.
//
// Returns { rows, ok }. The flag exists because "zero claims" and "we could not
// read the claims" look identical in an array, and printing 0 for the second
// one would be a measured-looking lie. The UI shows a count only when ok.
export async function fetchClaims(tid, cap = MAX_CLAIMS) {
  if (!firebaseReady || !tid) return { rows: [], ok: false }
  const ref = collection(db, 'tenants', tid, 'gameRewardClaims')
  try {
    return { rows: rowsOf(await getDocs(query(ref, orderBy('at', 'desc'), limit(cap)))), ok: true }
  } catch (_) { /* unordered fallback */ }
  try {
    return { rows: rowsOf(await getDocs(query(ref, limit(cap)))), ok: true }
  } catch (_) { return { rows: [], ok: false } }
}

// claims -> { [ruleId]: { total, inWindow, lastAt, redeemed } }
export function claimsByRule(claims = [], fromMs = 0, toMs = Infinity) {
  const out = new Map()
  for (const c of claims) {
    const id = String(c.ruleId || '')
    if (!id) continue
    const at = (() => {
      const v = c.at
      if (!v) return 0
      if (typeof v === 'number') return v
      if (typeof v.toMillis === 'function') { try { return v.toMillis() } catch (_) { return 0 } }
      if (typeof v.seconds === 'number') return v.seconds * 1000
      return 0
    })()
    const r = out.get(id) || { total: 0, inWindow: 0, lastAt: 0, redeemed: 0 }
    r.total += 1
    if (at && at >= fromMs && at <= toMs) r.inWindow += 1
    if (c.redeemed === true) r.redeemed += 1
    r.lastAt = Math.max(r.lastAt, at)
    out.set(id, r)
  }
  return out
}
