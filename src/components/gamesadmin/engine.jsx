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
import { collection, getDocs, query, where, orderBy, limit, startAfter } from 'firebase/firestore'
import { db, firebaseReady } from '../../lib/firebase.js'
import { GAMES } from '../../lib/games.js'
import { isSoloPlay } from '../../lib/gameMemory.js'

// Re-exported so a panel never re-invents "was this against the computer".
export { isSoloPlay }

// --------------------------------------------------------------------------
// read bounds
// --------------------------------------------------------------------------
// Documents per round trip. NOT the coverage limit — the play read pages until
// the window is exhausted, so this only decides how many round trips it takes.
export const PLAYS_PAGE = 500
// The hard safety ceiling across ALL pages of one play read. A venue with more
// history than this inside a single window costs bounded reads and gets an
// honest "not covered" instead of an unbounded bill.
export const MAX_PLAYS_SCAN = 5000
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
//
// ROUNDS AGAINST THE COMPUTER ARE NOT COMPETITIVE PLAY. A party game can be
// played against machine seats, and the machine is a fixed heuristic: its scores,
// its durations and its completion rate say something about the bot, not about
// this venue's guests. So every measured figure below — avgScore, best,
// completion, duration, unique players, and `plays` itself — counts ONLY rounds
// played against people, and the machine rounds are carried alongside as their
// own visible number (`soloPlays` / `soloPlayers` / `allPlays`).
//
// The two halves are always returned together so a screen physically cannot show
// one without the other, and `allPlays` exists so "nothing was played" is never
// printed over a period that only had computer rounds.
// --------------------------------------------------------------------------
export function statsByGame(plays = []) {
  const map = new Map()
  for (const p of plays) {
    const id = p.gameId || 'unknown'
    const g = map.get(id) || {
      gameId: id, plays: 0, completed: 0, scoreSum: 0, scoreN: 0,
      best: 0, durSum: 0, durN: 0, devices: new Set(), lastAt: 0,
      soloPlays: 0, soloDevices: new Set(),
    }
    // `lastAt` deliberately spans BOTH: it answers "when was this game last
    // touched", which a computer round genuinely answers.
    g.lastAt = Math.max(g.lastAt, num(p.endedAt) || num(p.startedAt))
    if (isSoloPlay(p)) {
      g.soloPlays += 1
      if (p.deviceId) g.soloDevices.add(p.deviceId)
      map.set(id, g)
      continue
    }
    g.plays += 1
    if (p.completed === true) g.completed += 1
    // Only a finished play carries a meaningful score; a play still running is
    // recorded with score 0 and would deflate the average.
    if (num(p.endedAt) > 0) { g.scoreSum += num(p.score); g.scoreN += 1 }
    g.best = Math.max(g.best, num(p.score))
    if (num(p.durationMs) > 0) { g.durSum += num(p.durationMs); g.durN += 1 }
    if (p.deviceId) g.devices.add(p.deviceId)
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
      soloPlays: g.soloPlays,
      soloPlayers: g.soloDevices.size,
      allPlays: g.plays + g.soloPlays,
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
  soloPlays: 0, soloPlayers: 0, allPlays: 0,
})

// Who a single recorded round was played against — THREE states, not two.
// A row written before the solo flag existed carries no answer, and printing
// «أشخاص» over it would be inventing evidence to fill a column. It reads
// «غير مسجّل» instead, which is what the document actually says.
export function opponentKind(play) {
  if (!play || typeof play !== 'object') return 'unknown'
  if (isSoloPlay(play)) return 'computer'
  if (typeof play.solo === 'boolean' || play.soloBots != null) return 'people'
  return 'unknown'
}

export const opponentLabel = (kind, ar = true) => {
  if (kind === 'computer') return ar ? 'الكمبيوتر' : 'Computer'
  if (kind === 'people') return ar ? 'أشخاص' : 'People'
  return ar ? 'غير مسجّل' : 'Not recorded'
}

// The one sentence that explains a solo count, used verbatim wherever one shows.
export const soloNote = (n, ar = true) => (
  ar
    ? `${fmtInt(n)} من جولات هذه الفترة كانت ضد الكمبيوتر ولا تدخل في الأرقام أعلاه — الخصم آلة بنمط ثابت، فمتوسّطه ونسبة إكماله لا تصف ضيوف هذا المكان.`
    : `${n} rounds this period were against the computer and are excluded above.`
)

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

// A play read must answer a question a single capped page cannot: did we see
// EVERY play in [fromMs, toMs]? A one-shot newest-first read truncates at the
// OLD end, so a busy window comes back as a newest-N slice, and the rows the
// caller filters out are indistinguishable — in a bare array — from "nothing
// was played". Worse, a cap warning computed off the FILTERED length would also
// be zero, silencing the one signal that could correct the reading.
//
// So the read PAGES the window instead of truncating it, and this returns a
// REPORT, not an array:
//   rows            plays inside [fromMs, toMs]
//   scanned         documents actually read, across every page
//   pages           round trips it took
//   exhausted       the query ran out of documents — the window was fully walked
//   capped          the safety ceiling stopped the walk early, so rows are unread
//   cap             that ceiling
//   oldestScannedMs the furthest back the read reached (null if unknowable)
//   covers          TRUE only when every play in the window was provably seen
//   ok              the read itself succeeded
//
// `covers` is a PROOF, never an assumption. There are exactly two proofs:
//   • `exhausted` — the paged query returned less than it was allowed to, so
//     there is nothing left behind it. For a both-bounds query that walks the
//     window itself, this is proof for the window.
//   • `reachedBack` — an unbounded newest-first walk that got to a document at
//     or before `fromMs`. Descending order then guarantees everything newer,
//     which is the whole window, was already read.
// `covers === false` means the figures are a floor, and zero means "not read",
// never "did not happen". The UI must say so rather than print a clean zero.
export function playsReadReport(raw, fromMs, toMs, cap, mode, ok = true, walk = {}) {
  const w = walk && typeof walk === 'object' ? walk : {}
  const scanned = raw.length
  const exhausted = ok && w.exhausted === true
  // "capped" now means one thing only: the SAFETY CEILING cut the walk short.
  // It is no longer implied by "the page was full".
  const capped = ok && !exhausted && scanned >= cap
  let oldestScannedMs = null
  let newestScannedMs = null
  for (const p of raw) {
    const t = num(p.startedAt)
    if (!(t > 0)) continue
    if (oldestScannedMs == null || t < oldestScannedMs) oldestScannedMs = t
    if (newestScannedMs == null || t > newestScannedMs) newestScannedMs = t
  }
  // Only a walk that was actually ordered newest-first can argue from how far
  // back it reached. An unordered read proves nothing except by exhaustion.
  const reachedBack = (mode === 'ordered' || mode === 'range')
    && oldestScannedMs != null && oldestScannedMs <= fromMs
  return {
    rows: raw.filter((p) => {
      const t = num(p.startedAt)
      return t >= fromMs && t <= toMs
    }),
    scanned,
    pages: num(w.pages),
    cap,
    capped,
    exhausted,
    mode,
    oldestScannedMs,
    newestScannedMs,
    covers: ok && (exhausted || reachedBack),
    ok,
  }
}

// Walk a query in pages until it runs out, a caller-supplied stop condition is
// met, or `ceiling` documents have been read. Every page is the SAME query plus
// a `startAfter` cursor, so no extra index is ever required beyond the one the
// first page already needed.
//
// Returns { rows, exhausted, pages }. `exhausted` is true ONLY when a page came
// back shorter than it was allowed to be — the one fact that proves nothing was
// left behind. Stopping on `ceiling` or on `stopAt` never sets it.
async function walkPages(ref, constraints, ceiling, stopAt = null) {
  const rows = []
  let cursor = null
  let exhausted = false
  let pages = 0
  while (rows.length < ceiling) {
    const want = Math.min(PLAYS_PAGE, ceiling - rows.length)
    const parts = cursor ? [...constraints, startAfter(cursor), limit(want)] : [...constraints, limit(want)]
    // eslint-disable-next-line no-await-in-loop -- pages are cursor-chained: page N+1 needs page N's last doc
    const snap = await getDocs(query(ref, ...parts))
    pages += 1
    const docs = snap.docs
    for (const d of docs) rows.push({ id: d.id, ...d.data() })
    if (docs.length < want) { exhausted = true; break }
    cursor = docs[docs.length - 1]
    if (stopAt && stopAt(rows[rows.length - 1])) break
  }
  return { rows, exhausted, pages }
}

// Read every play in [fromMs, toMs], in pages, up to a hard ceiling.
//
// The primary query bounds the window on BOTH sides. Both bounds sit on the one
// field `startedAt`, and the sort is on that same field, so this is still a
// single-field query: no composite index, exactly like the old one-shot read.
// The difference is that it walks the WINDOW rather than the newest N documents
// of the collection, which is why exhausting it is a real proof of coverage —
// and why "narrow the window", the advice the UI gives, now actually works.
export async function fetchPlays(tid, fromMs, toMs, ceiling = MAX_PLAYS_SCAN) {
  const cap = Math.max(PLAYS_PAGE, Math.round(num(ceiling, MAX_PLAYS_SCAN)))
  if (!firebaseReady || !tid) return playsReadReport([], fromMs, toMs, cap, 'none', false)
  const ref = collection(db, 'tenants', tid, 'gamePlays')
  try {
    const w = await walkPages(ref, [
      where('startedAt', '>=', fromMs),
      where('startedAt', '<=', toMs),
      orderBy('startedAt', 'desc'),
    ], cap)
    return playsReadReport(w.rows, fromMs, toMs, cap, 'range', true, w)
  } catch (_) { /* range refused — fall back to a plain sort */ }
  try {
    // No window bound available, so walk newest-first and stop the moment the
    // walk has passed the start of the window: everything newer is now in hand.
    const w = await walkPages(ref, [orderBy('startedAt', 'desc')], cap,
      (row) => num(row.startedAt) > 0 && num(row.startedAt) <= num(fromMs))
    return playsReadReport(w.rows, fromMs, toMs, cap, 'ordered', true, w)
  } catch (_) { /* no sort allowed — take whatever is readable */ }
  try {
    // Unordered: only total exhaustion of the collection can prove anything, and
    // walkPages reports exactly that.
    const w = await walkPages(ref, [], cap)
    return playsReadReport(w.rows, fromMs, toMs, cap, 'unordered', true, w)
  } catch (_) {
    return playsReadReport([], fromMs, toMs, cap, 'failed', false)
  }
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
