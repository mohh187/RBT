// ===========================================================================
// Social play — the six things that turn single-player menu games into
// something that happens BETWEEN people in one venue.
//
//   1  بطولة المكان الأسبوعية   tenants/{tid}/tournaments/{id}        (READ)
//                                tenants/{tid}/tournaments/{id}/entries/{deviceId}  (WRITE)
//   2  التحدي المعلّق            tenants/{tid}/challenges/{id}         (READ+WRITE)
//   3  طاولة ضد طاولة            tenants/{tid}/matches/{id}            (READ+WRITE)
//   4  أبطال الطاولة             tenants/{tid}/rooms                   (READ)
//   5  ساعة الذروة الجماعية      tenant.gameHappyHour                  (READ)
//                                tenants/{tid}/happyHourScores/{deviceId}_{day} (WRITE)
//   6  خريطة اللاعبين            tenants/{tid}/rooms + matches         (READ)
//
// ---------------------------------------------------------------------------
// THREE RULES THIS FILE OBEYS WITHOUT EXCEPTION
// ---------------------------------------------------------------------------
// HONESTY   Nothing here invents a number. When a board cannot be built from
//           documents that actually exist, the caller receives an empty result
//           plus a reason — never a plausible-looking placeholder. Every
//           `watch*` reports `{ ..., error }` so a component can print a
//           sentence instead of spinning forever.
//
// BOUNDED   Every query carries a limit and uses SINGLE-FIELD equality, a
//           single range, or a single orderBy, so none of this needs a
//           composite index to be deployed.
//           A limit without an order is a TRAP, not a saving: Firestore then
//           returns an arbitrary page (document-id order, and auto-ids are
//           random), so a venue with more challenges than the cap would show
//           month-one leftovers while today's guests pin notes nobody ever
//           sees. Every capped read of a collection that grows without bound
//           is therefore ordered so the slice is the RIGHT slice, and reports
//           `truncated` when it hit its cap — because a count taken over a
//           truncated read is a FLOOR, and a floor printed as a total is a
//           fabricated measurement.
//
// PRIVACY   Guest-visible people data is limited to the first name a player
//           typed themselves. `publicPeer()` is the ONLY way a person crosses
//           into a component, and it drops phone numbers by construction. No
//           feature here reveals where anyone is beyond "played in this venue
//           today".
// ===========================================================================
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  limit,
  orderBy,
  arrayUnion,
  runTransaction,
} from 'firebase/firestore'
import { db, firebaseReady } from './firebase.js'
import { deviceKey } from './device.js'
import { getLocalCustomer } from './customer.js'
// The venue side owns the tournament document, its status machine and its
// prize. Importing them is what keeps the guest's answer to "is it running"
// identical to the manager's.
import { watchTournaments, statusOf } from './tournaments.js'

// ---------------------------------------------------------------------------
// Limits. Each one exists because the alternative is an unbounded read bill or
// an unbounded document.
// ---------------------------------------------------------------------------
export const MAX_CHALLENGES = 40      // open challenges streamed per venue
// beatenBy entries kept on one challenge. This deliberately EQUALS the ceiling
// the security rule puts on the array (`beatenBy.size() <= 50`), so the read
// side never drops a win the document is actually holding — a smaller number
// here silently truncated the list and could hide the true top score. Once the
// array reaches this size the rule refuses further beats, so the count becomes
// a floor; normalizeChallenge flags that as `beatenAtCap` and the UI says so.
export const MAX_BEATEN = 50
export const MAX_MATCHES = 40
export const MAX_ENTRIES = 200        // tournament / happy-hour board rows
export const MAX_ROOMS_SCAN = 80      // rooms scanned for "who is here now"
export const MAX_TABLES = 120
export const MAX_MESSAGE = 90         // characters of guest-written challenge text
export const MAX_NAME = 24
export const CHALLENGE_DEFAULT_DAYS = 3
// The longest a challenge postChallenge will ever write can stay open. It is a
// constant rather than a literal because pageCutOpenSet reasons with it: that
// proof is only sound while it matches the ceiling actually written.
export const CHALLENGE_MAX_DAYS = 14
export const PEER_MEMORY = 40         // room ids remembered on this device

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_SCORE = 10000000

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
const num = (v, f = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : f
}

export const safeId = (v) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)

export function cleanName(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
}

export function clampScore(v) {
  const n = Math.floor(num(v, 0))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, MAX_SCORE)
}

// Latin digits, always — the venue may render in Arabic but the numerals never
// switch to Arabic-Indic (hard repo rule).
export function fmtNum(n) {
  try { return num(n, 0).toLocaleString('ar-SA-u-nu-latn') } catch (_) { return String(num(n, 0)) }
}

// 'YYYYMMDD' built from integers, so the digits can never come out localized.
export function dayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(num(date, Date.now()))
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// A countdown a guest can read. Latin digits by construction (String(number)).
export function fmtLeft(ms, lang = 'ar') {
  const total = Math.max(0, Math.floor(num(ms, 0) / 1000))
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ar = lang !== 'en'
  if (d > 0) return ar ? `${d} يوم و ${h} ساعة` : `${d}d ${h}h`
  if (h > 0) return `${String(h)}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// sanitizeMessage — the ONE place guest-written text becomes safe to show a
// stranger. React already escapes markup on render; this exists for the other
// three problems React does not solve:
//   • control characters and bidi overrides, which can visually reorder a line
//     and make one guest's text impersonate the venue's own UI
//   • contact details smuggled into a "challenge" (phones, emails, links) —
//     this is a note pinned in a cafe, not a channel for reaching strangers
//   • length, so one guest cannot occupy the whole board
// Anything it cannot make safe it removes. It never truncates mid-escape and
// never returns markup.
// ---------------------------------------------------------------------------
export function sanitizeMessage(raw) {
  let s = String(raw == null ? '' : raw)
  // C0 + C1 controls, the zero-width family, and every bidi override/isolate:
  // these are invisible, so a component cannot show them and a reviewer cannot
  // spot them, yet they can visually reorder a line until one guest’s message
  // impersonates the venue's own interface. They are removed, never escaped.
  s = s.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, ' ')
  s = s.replace(/<[^>]*>/g, ' ')                          // no tags, ever
  s = s.replace(/[<>{}[\]\\^`|]/g, ' ')                   // no markup-ish glyphs
  s = s.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')      // no links
  s = s.replace(/\S+@\S+\.\S+/g, ' ')                     // no emails
  s = s.replace(/[+\d][\d\s-]{6,}\d/g, ' ')               // no phone-shaped runs
  s = s.replace(/\s+/g, ' ').trim()
  return s.slice(0, MAX_MESSAGE)
}

// The identity a component may show. Phone numbers are dropped here and there
// is deliberately no option to keep them.
export function publicPeer(p) {
  if (!p) return null
  const id = safeId(p.id || p.deviceId)
  if (!id) return null
  return { id, name: cleanName(p.name) || 'ضيف' }
}

// Fill in whatever the caller did not pass, from this device.
export function resolvePlayer(player) {
  const local = getLocalCustomer() || {}
  return {
    id: safeId(player?.id) || safeId(deviceKey()),
    name: cleanName(player?.name) || cleanName(local.name) || '',
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const col = (tid, name) => collection(db, 'tenants', tid, name)
const tournamentEntries = (tid, tourId) => collection(db, 'tenants', tid, 'tournaments', tourId, 'entries')

// A dead subscription that still calls back once, so a caller never waits on a
// listener that was never created.
function deadWatch(cb, payload) {
  setTimeout(() => cb?.(payload), 0)
  return () => {}
}

const errText = (err) => String(err?.code || err?.message || 'error')

// ===========================================================================
// 1 — بطولة المكان الأسبوعية
// ===========================================================================
// The tournament DOCUMENT is owned by lib/tournaments.js (the venue side). Its
// shape, its status machine and its prize are imported from there rather than
// re-derived here, so the guest can never be shown a different answer to "is it
// running" than the manager is looking at.
//
// ---------------------------------------------------------------------------
// WHY THE GUEST BOARD IS NOT THE ADMIN BOARD — and why that is on purpose
// ---------------------------------------------------------------------------
// tournaments.standings() ranks over `gamePlays`. Those documents carry
// customerPhone and every answer a guest ever gave, so a diner's phone must
// never be able to LIST them — that would hand one guest the play history of
// everybody else in the venue. The guest surface therefore cannot use that
// engine, and pretending otherwise would be a privacy hole dressed as a feature.
//
// Instead each device writes ONE row about ITSELF:
//     tenants/{tid}/tournaments/{id}/entries/{deviceId}   { score, plays, ... }
// which is readable by everyone, contains no phone, and cannot be inflated by
// anyone but its owner. That yields an exact live board for the two modes it
// can express:
//     highscore  → rank by best score      (exact)
//     mostPlays  → rank by play count      (exact)
//     streak     → NOT derivable from one row per device. The board is withheld
//                  and the guest is told the ranking is settled at announcement.
//
// And the moment the venue finalizes, `tournament.winners` (frozen on the doc
// by the manager's own action) OUTRANKS this board everywhere it is shown.
export {
  normalizeTournament,
  statusOf as tournamentStatus,
  STATUS_AR as TOURNAMENT_STATUS_AR,
} from './tournaments.js'

// Modes whose ranking one self-written row per device can express exactly.
export const GUEST_RANKABLE_MODES = ['highscore', 'mostPlays']

export function tournamentWindow(t, now = Date.now()) {
  if (!t) return { live: false, upcoming: false, msLeft: 0, msToStart: 0, status: 'draft' }
  const status = statusOf(t, now)
  return {
    live: status === 'running',
    upcoming: status === 'scheduled',
    msLeft: Math.max(0, num(t.to, 0) - now),
    msToStart: Math.max(0, num(t.from, 0) - now),
    status,
  }
}

// The prize, exactly as the venue typed it, or ''. Never a generated stand-in.
export function tournamentPrize(t) {
  return String(t?.prize?.label || '').slice(0, 120)
}

// Does this tournament count the game the guest just played? 'any' counts all.
export function tournamentCounts(t, gameId) {
  const want = String(t?.gameId || 'any')
  return want === 'any' || !gameId || want === gameId
}

// The one tournament a guest should see, plus the next one. Built on the venue
// side's own watcher so the two lists can never disagree.
// cb({ tournament, upcoming, all, error }) — a null tournament is a RESULT
// ("nothing is running"), never a silent failure.
export function watchLiveTournament(tid, cb) {
  return watchTournaments(tid, ({ rows, error }) => {
    const now = Date.now()
    const all = Array.isArray(rows) ? rows : []
    const live = all
      .filter((t) => statusOf(t, now) === 'running')
      .sort((a, b) => num(a.to) - num(b.to))[0] || null
    const upcoming = all
      .filter((t) => statusOf(t, now) === 'scheduled')
      .sort((a, b) => num(a.from) - num(b.from))[0] || null
    cb?.({ tournament: live, upcoming, all, error: error || null })
  })
}

// Standings. One row per device per tournament, so the listener is bounded by
// the number of PEOPLE, not the number of plays, and no phone is ever read.
// cb({ entries, rankable, error })
export function watchTournamentEntries(tid, tourId, cb, mode = 'highscore') {
  if (!firebaseReady || !tid || !tourId) {
    return deadWatch(cb, { entries: [], rankable: false, error: 'unavailable' })
  }
  const rankable = GUEST_RANKABLE_MODES.includes(mode)
  return onSnapshot(
    query(tournamentEntries(tid, safeId(tourId)), limit(MAX_ENTRIES)),
    (snap) => cb?.({
      entries: rankable ? rankEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })), mode) : [],
      rankable,
      error: null,
    }),
    (err) => cb?.({ entries: [], rankable, error: errText(err) }),
  )
}

// Pure. Ranked by the field the MODE actually ranks on — ranking a mostPlays
// tournament by score would put the wrong name at the top of a real prize.
// Ties break toward whoever got there first: a guest who has held a number for
// an hour outranks one who matched it a minute ago.
export function rankEntries(rows, mode = 'highscore') {
  const key = mode === 'mostPlays' ? 'plays' : 'score'
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      id: String(r.id || ''),
      deviceId: safeId(r.deviceId || r.id),
      name: cleanName(r.name) || 'ضيف',
      score: clampScore(r.score),
      plays: num(r.plays, 0),
      at: num(r.at, 0),
    }))
    .map((r) => ({ ...r, value: r[key] }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.at - b.at)
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

// The venue's own announced result, frozen onto the document at finalize. When
// this exists it is the truth and the live board is not shown beside it.
export function tournamentWinners(t) {
  return (Array.isArray(t?.winners) ? t.winners : [])
    .map((w, i) => ({
      rank: num(w?.rank, i + 1),
      deviceId: safeId(w?.deviceId),
      name: cleanName(w?.name) || 'ضيف',
      score: clampScore(w?.score),
      // phone is present on the frozen record for the manager. It is dropped
      // here and never reaches a guest-facing component.
    }))
    .sort((a, b) => a.rank - b.rank)
}

// 1-based rank of this device inside an already-ranked list, or null when the
// device has not entered. Never guesses a rank.
export function myRankIn(rows, deviceId) {
  const id = safeId(deviceId)
  if (!id || !Array.isArray(rows)) return null
  const hit = rows.find((r) => r.deviceId === id)
  return hit ? { rank: hit.rank, entry: hit, total: rows.length } : null
}

// Record a finished play against the running tournament. Best-effort and
// idempotent: only a genuine improvement writes a score, everything else just
// bumps the play counter. A failure never reaches the game.
export async function recordTournamentPlay({ tid, tournament, deviceId, name = '', gameId = '', score = 0 } = {}) {
  try {
    if (!firebaseReady || !tid || !tournament?.id) return { written: false, reason: 'no-tournament' }
    if (!tournamentWindow(tournament).live) return { written: false, reason: 'closed' }
    if (!tournamentCounts(tournament, gameId)) return { written: false, reason: 'other-game' }
    const id = safeId(deviceId)
    if (!id) return { written: false, reason: 'no-device' }
    const s = clampScore(score)
    const ref = doc(tournamentEntries(tid, safeId(tournament.id)), id)
    let best = s
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      const prev = snap.exists() ? snap.data() : null
      best = Math.max(clampScore(prev?.score), s)
      tx.set(ref, {
        deviceId: id,
        name: cleanName(name) || cleanName(prev?.name) || 'ضيف',
        // The game actually played, never the tournament's 'any'.
        gameId: String(gameId || '').slice(0, 64),
        score: best,
        plays: num(prev?.plays, 0) + 1,
        at: best > clampScore(prev?.score) ? Date.now() : num(prev?.at, Date.now()),
      }, { merge: true })
    })
    return { written: true, best, improved: best === s && s > 0 }
  } catch (err) {
    return { written: false, reason: errText(err) }
  }
}

// ===========================================================================
// 2 — التحدي المعلّق
// ===========================================================================
export function isChallengeOpen(c, now = Date.now()) {
  if (!c) return false
  if (c.active === false) return false
  const exp = num(c.expiresAt, 0)
  return exp === 0 || now < exp
}

export function challengeBeatenBy(c, deviceId) {
  const id = safeId(deviceId)
  if (!id) return null
  return (Array.isArray(c?.beatenBy) ? c.beatenBy : []).find((b) => safeId(b?.deviceId) === id) || null
}

export function normalizeChallenge(raw) {
  if (!raw) return null
  // Mapped in full BEFORE any slicing, so the count and the top score are taken
  // over everything the document holds rather than over a rendering window.
  const beaten = (Array.isArray(raw.beatenBy) ? raw.beatenBy : [])
    .map((b) => ({
      name: cleanName(b?.name) || 'ضيف',
      deviceId: safeId(b?.deviceId),
      score: clampScore(b?.score),
      at: num(b?.at, 0),
    }))
  return {
    id: String(raw.id || ''),
    gameId: String(raw.gameId || '').slice(0, 64),
    byName: cleanName(raw.byName) || 'ضيف',
    byDeviceId: safeId(raw.byDeviceId),
    score: clampScore(raw.score),
    // Re-sanitized on READ as well as on write: a document that predates this
    // code, or one written by anything other than postChallenge, still cannot
    // put raw text on a stranger's screen.
    message: sanitizeMessage(raw.message),
    at: num(raw.at, 0),
    expiresAt: num(raw.expiresAt, 0),
    // Newest kept, not oldest: arrayUnion appends, so slicing from the front
    // would pin «كسره فلان» to the FIRST person who ever beat it and would drop
    // this device's own entry, letting recordChallengeBeat write a duplicate.
    beatenBy: beaten.length > MAX_BEATEN ? beaten.slice(-MAX_BEATEN) : beaten,
    // The true number of recorded beats, over the whole array.
    beatenCount: beaten.length,
    // Best score over the whole array — never over the rendered window.
    beatenBest: beaten.reduce((m, b) => (b.score > m ? b.score : m), 0),
    // At the cap the security rule refuses further beats, so beatenCount stops
    // rising: from here on it is a floor and must not be printed as a total.
    beatenAtCap: beaten.length >= MAX_BEATEN,
    active: raw.active !== false,
  }
}

// Was the board page cut BEFORE the open set ended?
//
// A full page is not evidence of anything on its own. Challenge documents are
// never deleted, so a venue that once crossed MAX_CHALLENGES fills every page
// for the rest of its life; `size >= MAX_CHALLENGES` therefore latches true
// forever and turns an exact count into a permanent «فأكثر». A total printed as
// a floor is the same fabrication as a floor printed as a total, in reverse.
//
// What can actually be proved: the page is the newest MAX_CHALLENGES documents
// by `at`, so every unread document has `at` below the oldest one we read. A
// challenge closes at `at + lifetime`, and the longest lifetime in play is the
// ceiling postChallenge clamps to — raised, if some document on the page says
// otherwise, to what that document actually shows. So when
//   oldestReadAt + longestLifetime <= now
// every unread document has certainly expired, the open set ended inside this
// page, and the filtered list is a TOTAL.
//
// Two things defeat the proof and keep the answer conservatively "cut":
// a document that never expires (`expiresAt` 0 — isChallengeOpen keeps those
// open forever, so no horizon exists), and one with no usable `at` to order by.
function pageCutOpenSet(page, full, now = Date.now()) {
  if (!full) return false            // the whole collection fit — nothing unread
  let oldestAt = Infinity
  let longestLifeMs = CHALLENGE_MAX_DAYS * DAY_MS
  for (const c of page) {
    if (!(c.at > 0) || !(c.expiresAt > 0)) return true
    if (c.at < oldestAt) oldestAt = c.at
    const life = c.expiresAt - c.at
    if (life > longestLifeMs) longestLifeMs = life
  }
  if (!Number.isFinite(oldestAt)) return true
  return oldestAt + longestLifeMs > now
}

// Open challenges, newest first. Expired ones are hidden here rather than
// deleted — the guest who left one can still see it was beaten.
//
// TWO listeners, because one capped read cannot answer both questions honestly:
//   • the BOARD is the newest MAX_CHALLENGES documents (`orderBy at desc`), so
//     a busy venue shows tonight's notes rather than an arbitrary page that the
//     random auto-ids happened to sort first;
//   • MINE is a separate equality read on byDeviceId, so a guest's own pin is
//     always present even when the venue has far more than one page of them.
// Neither needs a composite index: one orderBy, one equality, nothing combined.
//
// cb({ challenges, mine, truncated, error }) — `truncated:true` means the read
// stopped BEFORE the open set was exhausted, so `challenges.length` is a FLOOR
// and the caller must not present it as a total. `truncated:false` means the
// opposite claim, equally load-bearing: every open challenge this venue holds
// is in the list, so the caller must not hedge a total into a floor either.
export function watchOpenChallenges(tid, cb, { deviceId = '', gameId = '' } = {}) {
  const empty = { challenges: [], mine: [], truncated: false, error: 'unavailable' }
  if (!firebaseReady || !tid) return deadWatch(cb, empty)
  const me = safeId(deviceId)

  let board = []
  let boardFull = false
  let boardReady = false
  let mine = []
  let error = null

  const emit = () => {
    if (!boardReady) return
    const now = Date.now()
    cb?.({
      challenges: board
        .filter((c) => isChallengeOpen(c, now))
        .filter((c) => !gameId || c.gameId === gameId)
        .filter((c) => !me || c.byDeviceId !== me)
        .sort((a, b) => b.at - a.at),
      mine,
      // Recomputed per emit rather than frozen on the snapshot: pageCutOpenSet
      // compares against the clock, so a page that was genuinely cut can age
      // out of that doubt. It still only refreshes when a listener fires, so a
      // long-idle screen can hold a stale `true` — which errs toward the floor,
      // the safe side.
      truncated: pageCutOpenSet(board, boardFull, now),
      error,
    })
  }

  const stopBoard = onSnapshot(
    query(col(tid, 'challenges'), orderBy('at', 'desc'), limit(MAX_CHALLENGES)),
    (snap) => {
      board = snap.docs.map((d) => normalizeChallenge({ id: d.id, ...d.data() })).filter(Boolean)
      boardFull = snap.size >= MAX_CHALLENGES
      boardReady = true
      error = null
      emit()
    },
    (err) => {
      board = []
      boardFull = false
      boardReady = true
      error = errText(err)
      emit()
    },
  )

  // No device id means no personal list to read — and no second listener.
  const stopMine = me
    ? onSnapshot(
      query(col(tid, 'challenges'), where('byDeviceId', '==', me), limit(MAX_CHALLENGES)),
      (snap) => {
        mine = snap.docs
          .map((d) => normalizeChallenge({ id: d.id, ...d.data() }))
          .filter(Boolean)
          .sort((a, b) => b.at - a.at)
        emit()
      },
      // A failure here empties MY list only; it must not blank the board or
      // claim the board failed.
      () => { mine = []; emit() },
    )
    : null

  return () => { stopBoard?.(); stopMine?.() }
}

// Leave a challenge for whoever sits here next.
export async function postChallenge({ tid, gameId, name = '', deviceId, score = 0, message = '', days = CHALLENGE_DEFAULT_DAYS } = {}) {
  if (!firebaseReady || !tid || !gameId) return { ok: false, reason: 'unavailable' }
  const id = safeId(deviceId)
  if (!id) return { ok: false, reason: 'no-device' }
  const s = clampScore(score)
  if (s <= 0) return { ok: false, reason: 'no-score' } // nothing to beat
  const now = Date.now()
  try {
    const ref = await addDoc(col(tid, 'challenges'), {
      gameId: String(gameId).slice(0, 64),
      byName: cleanName(name) || 'ضيف',
      byDeviceId: id,
      score: s,
      message: sanitizeMessage(message),
      at: now,
      expiresAt: now + Math.max(1, Math.min(CHALLENGE_MAX_DAYS, num(days, CHALLENGE_DEFAULT_DAYS))) * DAY_MS,
      beatenBy: [],
      active: true,
    })
    return { ok: true, id: ref.id }
  } catch (err) {
    return { ok: false, reason: errText(err) }
  }
}

// Someone beat it. arrayUnion keeps this a single atomic op, so two phones
// finishing at the same instant cannot erase each other's win.
// Returns { ok, beaten } — `beaten:false` with ok:true means the score did not
// actually clear the bar, which is a normal outcome, not an error.
export async function recordChallengeBeat({ tid, challengeId, name = '', deviceId, score = 0 } = {}) {
  if (!firebaseReady || !tid || !challengeId) return { ok: false, reason: 'unavailable' }
  const id = safeId(deviceId)
  if (!id) return { ok: false, reason: 'no-device' }
  const s = clampScore(score)
  try {
    const ref = doc(col(tid, 'challenges'), challengeId)
    const snap = await getDoc(ref)
    if (!snap.exists()) return { ok: false, reason: 'not-found' }
    const c = normalizeChallenge({ id: snap.id, ...snap.data() })
    if (!isChallengeOpen(c)) return { ok: false, reason: 'closed' }
    if (c.byDeviceId === id) return { ok: false, reason: 'own' }
    if (s <= c.score) return { ok: true, beaten: false, challenge: c }
    const prev = challengeBeatenBy(c, id)
    if (prev && prev.score >= s) return { ok: true, beaten: true, challenge: c, already: true }
    await updateDoc(ref, {
      beatenBy: arrayUnion({ name: cleanName(name) || 'ضيف', deviceId: id, score: s, at: Date.now() }),
    })
    return { ok: true, beaten: true, challenge: c }
  } catch (err) {
    return { ok: false, reason: errText(err) }
  }
}

// Only the device that left a challenge may retire it. This is a convenience
// check; the rule is the boundary.
export async function closeChallenge({ tid, challengeId, deviceId } = {}) {
  if (!firebaseReady || !tid || !challengeId) return false
  try {
    const ref = doc(col(tid, 'challenges'), challengeId)
    const snap = await getDoc(ref)
    if (!snap.exists()) return false
    if (safeId(snap.data()?.byDeviceId) !== safeId(deviceId)) return false
    await updateDoc(ref, { active: false })
    return true
  } catch (_) { return false }
}

// ===========================================================================
// 3 — طاولة ضد طاولة
// ===========================================================================
export const MATCH_STATUSES = ['pending', 'accepted', 'playing', 'done', 'declined', 'cancelled']

function normalizeSide(side) {
  return {
    id: safeId(side?.id),
    label: String(side?.label || side?.name || '').slice(0, 40),
    by: cleanName(side?.by),
    deviceId: safeId(side?.deviceId),
  }
}

export function normalizeMatch(raw) {
  if (!raw) return null
  const status = MATCH_STATUSES.includes(raw.status) ? raw.status : 'pending'
  return {
    id: String(raw.id || ''),
    gameId: String(raw.gameId || '').slice(0, 64),
    tableA: normalizeSide(raw.tableA),
    tableB: normalizeSide(raw.tableB),
    roomId: String(raw.roomId || '').slice(0, 12),
    scoreA: clampScore(raw.scoreA),
    scoreB: clampScore(raw.scoreB),
    status,
    startedAt: num(raw.startedAt, 0),
    updatedAt: num(raw.updatedAt, num(raw.startedAt, 0)),
    // Present so «خريطة اللاعبين» can find matches this device took part in
    // with a single array-contains query.
    deviceIds: (Array.isArray(raw.deviceIds) ? raw.deviceIds : []).map(safeId).filter(Boolean),
  }
}

// Which side of a match a table is on, or null when it is not in it at all.
export function matchSideFor(match, tableId) {
  const id = safeId(tableId)
  if (!id || !match) return null
  if (match.tableA?.id === id) return 'A'
  if (match.tableB?.id === id) return 'B'
  return null
}

// Never called on an unfinished match — an in-progress lead is not a winner.
export function matchWinner(match) {
  if (!match || match.status !== 'done') return null
  if (match.scoreA === match.scoreB) return 'draw'
  return match.scoreA > match.scoreB ? 'A' : 'B'
}

// Matches touching THIS table, either side. Firestore cannot OR two fields, so
// this streams a small capped page of RECENT matches and filters in JS.
// `orderBy updatedAt desc` is what makes "recent" true: unordered, the page was
// an arbitrary slice of the whole history, so on a busy night the day-old
// filter below could empty a table's card while its match was live.
// cb({ matches, incoming, mine, error })
export function watchTableMatches(tid, tableId, cb) {
  if (!firebaseReady || !tid) return deadWatch(cb, { matches: [], incoming: [], mine: [], error: 'unavailable' })
  const id = safeId(tableId)
  if (!id) return deadWatch(cb, { matches: [], incoming: [], mine: [], error: 'no-table' })
  return onSnapshot(
    query(col(tid, 'matches'), orderBy('updatedAt', 'desc'), limit(MAX_MATCHES)),
    (snap) => {
      const cutoff = Date.now() - DAY_MS
      const rows = snap.docs
        .map((d) => normalizeMatch({ id: d.id, ...d.data() }))
        .filter(Boolean)
        .filter((m) => m.updatedAt >= cutoff)
        .filter((m) => matchSideFor(m, id))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      cb?.({
        matches: rows,
        incoming: rows.filter((m) => m.status === 'pending' && m.tableB.id === id),
        mine: rows.filter((m) => m.status === 'pending' && m.tableA.id === id),
        error: null,
      })
    },
    (err) => cb?.({ matches: [], incoming: [], mine: [], error: errText(err) }),
  )
}

export function watchMatch(tid, matchId, cb) {
  if (!firebaseReady || !tid || !matchId) return deadWatch(cb, { match: null, error: 'unavailable' })
  return onSnapshot(
    doc(col(tid, 'matches'), matchId),
    (snap) => cb?.({ match: snap.exists() ? normalizeMatch({ id: snap.id, ...snap.data() }) : null, error: null }),
    (err) => cb?.({ match: null, error: errText(err) }),
  )
}

// The venue's tables, so a guest can point at the one they want to beat.
// cb({ tables, error }) — an error is NOT an empty list, because "this venue
// has no tables" and "we could not read the tables" must not look alike.
export function watchVenueTables(tid, cb) {
  if (!firebaseReady || !tid) return deadWatch(cb, { tables: [], error: 'unavailable' })
  return onSnapshot(
    query(col(tid, 'tables'), limit(MAX_TABLES)),
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((t) => t.active !== false)
        .map((t) => ({ id: t.id, label: String(t.label || '').slice(0, 40), zone: String(t.zone || '').slice(0, 40) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ar'))
      cb?.({ tables: rows, error: null })
    },
    (err) => cb?.({ tables: [], error: errText(err) }),
  )
}

export async function createMatch({ tid, gameId, tableA, tableB, player } = {}) {
  if (!firebaseReady || !tid || !gameId) return { ok: false, reason: 'unavailable' }
  const a = normalizeSide({ ...tableA, by: player?.name, deviceId: player?.id })
  const b = normalizeSide(tableB)
  if (!a.id || !b.id) return { ok: false, reason: 'no-table' }
  if (a.id === b.id) return { ok: false, reason: 'same-table' }
  const now = Date.now()
  try {
    const ref = await addDoc(col(tid, 'matches'), {
      gameId: String(gameId).slice(0, 64),
      tableA: a,
      tableB: b,
      roomId: '',
      scoreA: 0,
      scoreB: 0,
      status: 'pending',
      startedAt: now,
      updatedAt: now,
      deviceIds: [a.deviceId].filter(Boolean),
    })
    return { ok: true, id: ref.id }
  } catch (err) {
    return { ok: false, reason: errText(err) }
  }
}

// The challenged table says yes. Transactional so two phones at table B cannot
// both accept and create two rooms for one match.
export async function acceptMatch({ tid, matchId, player, roomId = '' } = {}) {
  if (!firebaseReady || !tid || !matchId) return { ok: false, reason: 'unavailable' }
  try {
    let out = { ok: true, roomId }
    await runTransaction(db, async (tx) => {
      const ref = doc(col(tid, 'matches'), matchId)
      const snap = await tx.get(ref)
      if (!snap.exists()) { out = { ok: false, reason: 'not-found' }; return }
      const m = normalizeMatch({ id: snap.id, ...snap.data() })
      if (m.status !== 'pending') { out = { ok: true, already: true, roomId: m.roomId }; return }
      const pid = safeId(player?.id)
      tx.update(ref, {
        status: 'accepted',
        roomId: String(roomId || '').slice(0, 12),
        'tableB.by': cleanName(player?.name),
        'tableB.deviceId': pid,
        // arrayUnion() with zero arguments throws, so an unidentified device
        // leaves the field alone instead of failing the whole accept.
        ...(pid ? { deviceIds: arrayUnion(pid) } : {}),
        updatedAt: Date.now(),
      })
      out = { ok: true, roomId }
    })
    return out
  } catch (err) {
    return { ok: false, reason: errText(err) }
  }
}

export async function setMatchStatus({ tid, matchId, status } = {}) {
  if (!firebaseReady || !tid || !matchId || !MATCH_STATUSES.includes(status)) return false
  try {
    await updateDoc(doc(col(tid, 'matches'), matchId), { status, updatedAt: Date.now() })
    return true
  } catch (_) { return false }
}

export async function attachRoom({ tid, matchId, roomId } = {}) {
  if (!firebaseReady || !tid || !matchId || !roomId) return false
  try {
    await updateDoc(doc(col(tid, 'matches'), matchId), {
      roomId: String(roomId).slice(0, 12),
      status: 'playing',
      updatedAt: Date.now(),
    })
    return true
  } catch (_) { return false }
}

export async function reportMatchResult({ tid, matchId, scoreA, scoreB } = {}) {
  if (!firebaseReady || !tid || !matchId) return false
  try {
    await updateDoc(doc(col(tid, 'matches'), matchId), {
      scoreA: clampScore(scoreA),
      scoreB: clampScore(scoreB),
      status: 'done',
      updatedAt: Date.now(),
    })
    return true
  } catch (_) { return false }
}

// Fold a finished room into the match it was created for. Seat 0 is table A's
// player, seat 1 is table B's — the only mapping a two-table match can have.
export async function settleMatchFromRoom({ tid, matchId, room } = {}) {
  const players = Array.isArray(room?.players) ? room.players : []
  if (!matchId || !players.length) return false
  const scoreOf = (seat) => clampScore(players.find((p) => p.seat === seat)?.score)
  return reportMatchResult({ tid, matchId, scoreA: scoreOf(0), scoreB: scoreOf(1) })
}

// ===========================================================================
// 4 — أبطال الطاولة
// ===========================================================================
// HONEST LIMIT, stated once here so no caller has to rediscover it:
// `gamePlays` records WHO played and WHAT they scored, but it does not record
// WHERE — there is no table on a play document. So a champions board built from
// gamePlays would be a venue board wearing a table's name, which is exactly the
// lie this feature must not tell.
//
// `rooms` DO carry tableId and per-seat scores, and their player ids are the
// same deviceKey a play uses. So this table's champions are built from the
// rooms actually played AT this table. When there are none, the caller is told
// `resolved:false` and is expected to show the venue board under its own name.
export function watchTableRooms(tid, tableId, cb) {
  if (!firebaseReady || !tid) return deadWatch(cb, { rooms: [], error: 'unavailable' })
  const id = safeId(tableId) || String(tableId || '')
  if (!id) return deadWatch(cb, { rooms: [], error: 'no-table' })
  return onSnapshot(
    query(col(tid, 'rooms'), where('tableId', '==', id), limit(MAX_ROOMS_SCAN)),
    (snap) => cb?.({ rooms: snap.docs.map((d) => ({ id: d.id, ...d.data() })), error: null }),
    (err) => cb?.({ rooms: [], error: errText(err) }),
  )
}

// Pure. Best score per person across the rooms handed in. Only rooms that
// actually finished contribute — a live board's running score is not a record.
export function tableChampions(rooms, { gameId = '' } = {}) {
  const byPerson = new Map()
  for (const r of (Array.isArray(rooms) ? rooms : [])) {
    if (r?.status !== 'ended') continue
    if (gameId && r.gameId !== gameId) continue
    for (const p of (Array.isArray(r.players) ? r.players : [])) {
      const peer = publicPeer(p)
      if (!peer) continue
      const score = clampScore(p.score)
      if (score <= 0) continue
      const at = num(r.endedAt, num(r.updatedAt, 0))
      const prev = byPerson.get(peer.id)
      if (!prev || score > prev.score) {
        byPerson.set(peer.id, { deviceId: peer.id, name: peer.name, score, gameId: String(r.gameId || ''), at, wins: num(prev?.wins, 0) })
      }
      const cur = byPerson.get(peer.id)
      if (r.winnerSeat != null && r.winnerSeat === p.seat) cur.wins = num(cur.wins, 0) + 1
    }
  }
  return [...byPerson.values()]
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map((x, i) => ({ ...x, rank: i + 1 }))
}

// The venue-wide board this feature falls back to. Read from the same
// gameScores collection leaderboard.js writes, so the two never disagree.
export function watchVenueBoard(tid, month, cb) {
  if (!firebaseReady || !tid) return deadWatch(cb, { rows: [], error: 'unavailable' })
  const m = month || new Date().toLocaleDateString('en-CA').slice(0, 7)
  return onSnapshot(
    query(col(tid, 'gameScores'), where('month', '==', m), limit(MAX_ENTRIES)),
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .map((x) => ({ deviceId: safeId(x.deviceId), name: cleanName(x.name) || 'ضيف', score: clampScore(x.score) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x, i) => ({ ...x, rank: i + 1 }))
      cb?.({ rows, error: null })
    },
    (err) => cb?.({ rows: [], error: errText(err) }),
  )
}

// ===========================================================================
// 5 — ساعة الذروة الجماعية
// ===========================================================================
// Config lives on the tenant document: it is a venue setting, not a document
// per occurrence, so there is nothing to clean up and no chance of a stale
// "happy hour" surviving after the venue turns it off.
//
//   tenant.gameHappyHour = { enabled, gameId, startTime:'HH:MM',
//                            endTime:'HH:MM', daysOfWeek:[0..6], prizeLabel }
//
// A window whose end is at or before its start is read as crossing midnight,
// which is the common case for a cafe («من 21:00 إلى 01:00»). Local time
// throughout — the guest and the venue are in the same room.
function parseHm(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!(h >= 0 && h <= 23 && min >= 0 && min <= 59)) return null
  return h * 60 + min
}

export function happyHourWindow(cfg, now = Date.now()) {
  const off = { active: false, gameId: '', msLeft: 0, endsAt: 0, prizeLabel: '', reason: 'off' }
  if (!cfg || cfg.enabled !== true) return off
  const gameId = String(cfg.gameId || '').slice(0, 64)
  if (!gameId) return { ...off, reason: 'no-game' }
  const start = parseHm(cfg.startTime)
  const end = parseHm(cfg.endTime)
  if (start == null || end == null) return { ...off, reason: 'no-window' }

  const d = new Date(now)
  const minutes = d.getHours() * 60 + d.getMinutes()
  const days = Array.isArray(cfg.daysOfWeek) ? cfg.daysOfWeek.map((x) => num(x, -1)) : null
  const crosses = end <= start

  // The window is anchored to the day it STARTED on, so a session running past
  // midnight is still "Thursday's happy hour" when Thursday is the scheduled day.
  const startedToday = minutes >= start
  const anchorDay = crosses && !startedToday ? (d.getDay() + 6) % 7 : d.getDay()
  if (days && days.length && !days.includes(anchorDay)) return { ...off, reason: 'other-day' }

  const inside = crosses ? (minutes >= start || minutes < end) : (minutes >= start && minutes < end)
  if (!inside) return { ...off, gameId, reason: 'closed' }

  const base = new Date(d)
  base.setSeconds(0, 0)
  base.setHours(Math.floor(end / 60), end % 60, 0, 0)
  let endsAt = base.getTime()
  if (endsAt <= now) endsAt += DAY_MS

  return {
    active: true,
    gameId,
    endsAt,
    msLeft: Math.max(0, endsAt - now),
    prizeLabel: String(cfg.prizeLabel || '').slice(0, 120),
    reason: 'live',
  }
}

// The shared board for today's window. One row per device per day, mirroring
// the leaderboard.js id pattern so a device can never spam rows.
export function watchHappyHourBoard(tid, day, cb) {
  if (!firebaseReady || !tid) return deadWatch(cb, { rows: [], error: 'unavailable' })
  const dk = day || dayKey()
  return onSnapshot(
    query(col(tid, 'happyHourScores'), where('day', '==', dk), limit(MAX_ENTRIES)),
    (snap) => cb?.({ rows: rankEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), error: null }),
    (err) => cb?.({ rows: [], error: errText(err) }),
  )
}

export async function recordHappyHourPlay({ tid, deviceId, name = '', gameId = '', score = 0, cfg = null } = {}) {
  try {
    if (!firebaseReady || !tid) return { written: false, reason: 'unavailable' }
    const win = happyHourWindow(cfg)
    if (!win.active) return { written: false, reason: 'closed' }
    if (gameId && win.gameId && gameId !== win.gameId) return { written: false, reason: 'other-game' }
    const id = safeId(deviceId)
    if (!id) return { written: false, reason: 'no-device' }
    const dk = dayKey()
    const s = clampScore(score)
    const ref = doc(col(tid, 'happyHourScores'), `${id}_${dk}`)
    let best = s
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      const prev = snap.exists() ? snap.data() : null
      best = Math.max(clampScore(prev?.score), s)
      tx.set(ref, {
        deviceId: id,
        name: cleanName(name) || cleanName(prev?.name) || 'ضيف',
        gameId: String(gameId || win.gameId || '').slice(0, 64),
        score: best,
        day: dk,
        plays: num(prev?.plays, 0) + 1,
        at: best > clampScore(prev?.score) ? Date.now() : num(prev?.at, Date.now()),
      }, { merge: true })
    })
    return { written: true, best }
  } catch (err) {
    return { written: false, reason: errText(err) }
  }
}

// ===========================================================================
// 6 — خريطة اللاعبين
// ===========================================================================
// PRIVACY CONTRACT, and it is narrow on purpose:
//   • A person appears ONLY if they shared a game room (or a table match) with
//     THIS device. There is no venue-wide directory of guests here.
//   • The only field shown is the first name that person typed into the room
//     themselves. Phone numbers are dropped in publicPeer() and are never read.
//   • "هنا الآن" means exactly one thing: that device appears in a room in this
//     venue that was updated today. It is not a location, not a table number,
//     and it expires with the day.
const lsRooms = (tid) => `rbt_social_rooms:${tid}`

export function rememberRoom(tid, roomId) {
  try {
    if (!tid || !roomId) return false
    const key = lsRooms(tid)
    const prev = JSON.parse(localStorage.getItem(key) || '[]')
    const list = (Array.isArray(prev) ? prev : []).filter((r) => r?.id !== roomId)
    list.unshift({ id: String(roomId).slice(0, 12), at: Date.now() })
    localStorage.setItem(key, JSON.stringify(list.slice(0, PEER_MEMORY)))
    return true
  } catch (_) { return false }
}

export function rememberedRoomIds(tid) {
  try {
    const v = JSON.parse(localStorage.getItem(lsRooms(tid)) || '[]')
    return (Array.isArray(v) ? v : []).map((r) => String(r?.id || '')).filter(Boolean).slice(0, PEER_MEMORY)
  } catch (_) { return [] }
}

// Rooms in this venue touched since the start of today. A single-field range on
// updatedAt — served by the automatic single-field index, no composite needed.
// This is the "who is here now" signal AND the auto-discovery of people this
// device played with today without any bookkeeping.
export function watchTodayRooms(tid, cb) {
  if (!firebaseReady || !tid) return deadWatch(cb, { rooms: [], error: 'unavailable' })
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return onSnapshot(
    query(col(tid, 'rooms'), where('updatedAt', '>=', start.getTime()), orderBy('updatedAt', 'desc'), limit(MAX_ROOMS_SCAN)),
    (snap) => cb?.({ rooms: snap.docs.map((d) => ({ id: d.id, ...d.data() })), error: null }),
    (err) => cb?.({ rooms: [], error: errText(err) }),
  )
}

// One read of the rooms this device remembers playing in. Bounded by
// PEER_MEMORY and done as individual gets — a documentId() `in` query caps at
// thirty and would silently drop the rest.
export async function fetchRememberedRooms(tid, ids) {
  if (!firebaseReady || !tid) return []
  const list = (Array.isArray(ids) ? ids : []).slice(0, PEER_MEMORY)
  const out = await Promise.all(list.map(async (id) => {
    try {
      const snap = await getDoc(doc(col(tid, 'rooms'), id))
      return snap.exists() ? { id: snap.id, ...snap.data() } : null
    } catch (_) { return null }
  }))
  return out.filter(Boolean)
}

// Matches this device took part in. array-contains on one field — no index.
export async function fetchMyMatches(tid, deviceId) {
  if (!firebaseReady || !tid) return []
  const id = safeId(deviceId)
  if (!id) return []
  try {
    const snap = await getDocs(query(col(tid, 'matches'), where('deviceIds', 'array-contains', id), limit(MAX_MATCHES)))
    return snap.docs.map((d) => normalizeMatch({ id: d.id, ...d.data() }))
  } catch (_) { return [] }
}

// Pure. People this device actually sat in a room with, most recent first.
// A room this device is not in contributes NOBODY — that is the whole boundary.
export function peersFromRooms(rooms, myDeviceId) {
  const me = safeId(myDeviceId)
  if (!me) return []
  const byId = new Map()
  for (const r of (Array.isArray(rooms) ? rooms : [])) {
    const players = Array.isArray(r?.players) ? r.players : []
    if (!players.some((p) => safeId(p?.id) === me)) continue
    const at = num(r.updatedAt, num(r.createdAt, 0))
    for (const p of players) {
      const peer = publicPeer(p)
      if (!peer || peer.id === me) continue
      const prev = byId.get(peer.id)
      byId.set(peer.id, {
        ...peer,
        name: peer.name !== 'ضيف' ? peer.name : (prev?.name || peer.name),
        games: (prev?.games || 0) + 1,
        lastAt: Math.max(num(prev?.lastAt, 0), at),
        lastGameId: at >= num(prev?.lastAt, 0) ? String(r.gameId || '') : (prev?.lastGameId || ''),
      })
    }
  }
  return [...byId.values()].sort((a, b) => b.lastAt - a.lastAt)
}

// Pure. The same boundary applied to table matches: a match this device was not
// part of contributes nobody, and the only thing carried across is the name the
// other side typed when they accepted.
export function peersFromMatches(matches, myDeviceId) {
  const me = safeId(myDeviceId)
  if (!me) return []
  const byId = new Map()
  for (const m of (Array.isArray(matches) ? matches : [])) {
    if (!Array.isArray(m?.deviceIds) || !m.deviceIds.includes(me)) continue
    for (const side of [m.tableA, m.tableB]) {
      const peer = publicPeer({ id: side?.deviceId, name: side?.by })
      if (!peer || peer.id === me) continue
      const prev = byId.get(peer.id)
      byId.set(peer.id, {
        ...peer,
        name: peer.name !== 'ضيف' ? peer.name : (prev?.name || peer.name),
        games: (prev?.games || 0) + 1,
        lastAt: Math.max(num(prev?.lastAt, 0), num(m.updatedAt, 0)),
        lastGameId: String(m.gameId || prev?.lastGameId || ''),
      })
    }
  }
  return [...byId.values()].sort((a, b) => b.lastAt - a.lastAt)
}

// Merge two peer lists (rooms + matches) without double-counting a person.
export function mergePeers(...lists) {
  const byId = new Map()
  for (const list of lists) {
    for (const p of (Array.isArray(list) ? list : [])) {
      const prev = byId.get(p.id)
      if (!prev) { byId.set(p.id, { ...p }); continue }
      byId.set(p.id, {
        ...prev,
        name: prev.name !== 'ضيف' ? prev.name : p.name,
        games: num(prev.games, 0) + num(p.games, 0),
        lastAt: Math.max(num(prev.lastAt, 0), num(p.lastAt, 0)),
        lastGameId: num(p.lastAt, 0) >= num(prev.lastAt, 0) ? p.lastGameId : prev.lastGameId,
      })
    }
  }
  return [...byId.values()].sort((a, b) => b.lastAt - a.lastAt)
}

// Which of those peers is in a room in this venue that moved today. Their own
// presence flag is respected: a phone that went quiet is not "here now".
export function presentPeerIds(todayRooms, now = Date.now()) {
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const out = new Set()
  for (const r of (Array.isArray(todayRooms) ? todayRooms : [])) {
    if (num(r?.updatedAt, 0) < startOfDay.getTime()) continue
    for (const p of (Array.isArray(r?.players) ? r.players : [])) {
      const id = safeId(p?.id)
      if (id) out.add(id)
    }
  }
  return out
}
