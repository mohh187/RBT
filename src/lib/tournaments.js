// ===========================================================================
// البطولات — venue-run competitions scored from REAL play data.
//
// PATH   tenants/{tid}/tournaments/{id}
// SHAPE  {
//   id, name, gameId | 'any',
//   mode: 'highscore' | 'mostPlays' | 'streak',
//   from, to,                                // epoch ms, inclusive window
//   prize: { label, kind, value },           // whatever the venue typed
//   active, autoAnnounce,
//   createdAt, updatedAt,
//   winners: [{ deviceId, name, phone, score, rank }],
//   finalizedAt | null,
// }
//
// ---------------------------------------------------------------------------
// THE HONESTY CONTRACT (the whole reason this file is separate from the UI)
// ---------------------------------------------------------------------------
// `standings()` is a PURE function over rows this venue actually wrote. It
// never estimates, never back-fills, never invents a participant. When no play
// qualifies it returns an EMPTY list — the caller renders «لا نتائج بعد» and a
// leaderboard is not fabricated to fill the space.
//
// But an empty list is only a MEASUREMENT when the read behind it saw the whole
// window. Play reads are newest-first and capped, so a window older than the cap
// reaches yields zero rows that look exactly like "nobody played". That is why
// `standings()` takes the caller's read REPORT and returns `complete`, and why
// `finalize()` REFUSES to freeze a standing whose read is not complete: an
// announced wrong winner is far worse to a venue's guests than no announcement.
// Absent a report, a read is treated as unproven — coverage is claimed, never
// assumed.
//
// Every returned row carries its own evidence: how many plays it counted, which
// games those plays were, the exact moment of the best one, and the day span.
// A manager can therefore argue with any rank, which is the point.
//
// WHAT EACH INPUT IS ALLOWED TO DO — read this before changing the scoring:
//   plays     (tenants/{tid}/gamePlays) — THE ONLY ranking basis. A rank is
//             always a count or a maximum over plays inside the window. Rounds
//             played against the MACHINE seats (`solo` on the play document) are
//             DISQUALIFIED before anything is counted: a prize handed to whoever
//             farmed a fixed heuristic the longest is not a competition result.
//             How many were dropped is reported, never silently swallowed.
//   scores    (tenants/{tid}/gameScores) — NOT ranked. These rows are a MONTHLY
//             best per device, so their number does not belong to any arbitrary
//             window and folding it into a rank would silently import points
//             earned outside the tournament. It is used for exactly two things:
//             (1) resolving a display name the guest typed themselves, and
//             (2) `boardBest` on a row — surfaced as a note beside the rank so
//             staff can see a monthly board figure that disagrees, never as the
//             ranked value.
//   profiles  (tenants/{tid}/playerProfiles) — name/phone enrichment only.
//
// A prize is a string the venue typed. Nothing here generates, suggests or
// upgrades a prize, and `finalize` freezes only what was actually computed.
// ===========================================================================
import {
  collection, doc, onSnapshot, query, orderBy, limit, setDoc, deleteDoc,
} from 'firebase/firestore'
import { db, firebaseReady } from './firebase.js'
import { isSoloPlay } from './gameMemory.js'

// ---------------------------------------------------------------------------
// limits
// ---------------------------------------------------------------------------
export const MAX_TOURNAMENTS = 60   // listener bound
export const MAX_WINNERS = 10       // frozen onto the doc at finalize
export const MIN_SAMPLE = 10        // below this the standings are labelled thin
const MAX_NAME = 60
const MAX_PRIZE_LABEL = 80
const DAY_MS = 24 * 60 * 60 * 1000

// Appended to EVERY mode explanation, because it applies to every mode and is
// applied in one place in `standings()`. Wherever the screen states the rule, it
// states this part of it too — the file's whole point is that the sentence a
// manager reads and the code that ranks cannot drift apart.
const SOLO_RULE_AR = ' الجولات ضد الكمبيوتر لا تُحتسب إطلاقاً.'

export const TOURNAMENT_MODES = [
  {
    id: 'highscore',
    ar: 'أعلى نتيجة',
    en: 'Highest score',
    // Stated exactly as it is computed, so the screen and the code agree.
    howAr: `الترتيب بأعلى نتيجة سجّلها اللاعب في جولة واحدة داخل الفترة. التعادل يُحسم لمن بلغها أولاً.${SOLO_RULE_AR}`,
  },
  {
    id: 'mostPlays',
    ar: 'أكثر عدد جولات',
    en: 'Most rounds',
    howAr: `الترتيب بعدد الجولات المسجّلة داخل الفترة. التعادل يُحسم بأعلى نتيجة.${SOLO_RULE_AR}`,
  },
  {
    id: 'streak',
    ar: 'أطول تتابع أيام',
    en: 'Longest daily streak',
    howAr: `الترتيب بأطول سلسلة أيام متتالية لعب فيها اللاعب مرة واحدة على الأقل. التعادل يُحسم بعدد الجولات.${SOLO_RULE_AR}`,
  },
]

export const PRIZE_KINDS = [
  { id: 'custom', ar: 'جائزة كما كتبتها' },
  { id: 'discount', ar: 'خصم على الفاتورة' },
  { id: 'freeItem', ar: 'صنف مجاني' },
  { id: 'points', ar: 'نقاط ولاء' },
]

const MODE_IDS = TOURNAMENT_MODES.map((m) => m.id)
const KIND_IDS = PRIZE_KINDS.map((k) => k.id)

export const modeInfo = (id) => TOURNAMENT_MODES.find((m) => m.id === id) || TOURNAMENT_MODES[0]

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
const num = (v, f = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : f
}
const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max)
const safeId = (v) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)

// 'YYYY-MM-DD' local, Latin digits (en-CA gives ISO order without Arabic-Indic).
export const dayKey = (ms) => new Date(num(ms)).toLocaleDateString('en-CA')

// A Firestore Timestamp, a Date, or a plain number — all reduced to epoch ms.
export function tsMs(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (typeof v.toMillis === 'function') { try { return v.toMillis() } catch (_) { return 0 } }
  if (v instanceof Date) return v.getTime()
  if (typeof v.seconds === 'number') return v.seconds * 1000
  return 0
}

// date <input type="date"> <-> epoch ms
export const toDayInput = (ms) => (num(ms) ? new Date(num(ms)).toLocaleDateString('en-CA') : '')
export function fromDayInput(str, endOfDay = false) {
  if (!str) return 0
  const [y, m, d] = String(str).split('-').map((x) => Number(x))
  if (!y || !m || !d) return 0
  const dt = new Date(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
  const t = dt.getTime()
  return Number.isNaN(t) ? 0 : t
}

function randomId() {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `t_${window.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
    }
  } catch (_) { /* fall through to the time-based id */ }
  return `t_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

// ---------------------------------------------------------------------------
// shape
// ---------------------------------------------------------------------------
export function newTournament(overrides = {}) {
  const now = Date.now()
  const from = new Date(now); from.setHours(0, 0, 0, 0)
  const to = new Date(now); to.setDate(to.getDate() + 6); to.setHours(23, 59, 59, 999)
  return {
    id: randomId(),
    name: '',
    gameId: 'any',
    mode: 'highscore',
    from: from.getTime(),
    to: to.getTime(),
    prize: { label: '', kind: 'custom', value: 0 },
    active: true,
    autoAnnounce: false,
    createdAt: now,
    updatedAt: now,
    winners: [],
    finalizedAt: null,
    ...overrides,
  }
}

function normalizePrize(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  const kind = KIND_IDS.includes(p.kind) ? p.kind : 'custom'
  const value = num(p.value, 0)
  return {
    // Verbatim. The venue's own words are the prize; nothing is generated.
    label: clean(p.label, MAX_PRIZE_LABEL),
    kind,
    value: Math.max(0, Math.round(value * 100) / 100),
  }
}

export function normalizeTournament(raw = {}) {
  const t = raw && typeof raw === 'object' ? raw : {}
  let from = num(t.from)
  let to = num(t.to)
  if (from && to && to < from) { const swap = from; from = to; to = swap }
  return {
    id: safeId(t.id) || randomId(),
    name: clean(t.name, MAX_NAME),
    gameId: clean(t.gameId, 64) || 'any',
    mode: MODE_IDS.includes(t.mode) ? t.mode : 'highscore',
    from,
    to,
    prize: normalizePrize(t.prize),
    active: t.active !== false,
    autoAnnounce: t.autoAnnounce === true,
    createdAt: num(t.createdAt) || Date.now(),
    updatedAt: num(t.updatedAt) || Date.now(),
    winners: Array.isArray(t.winners) ? t.winners.slice(0, MAX_WINNERS) : [],
    finalizedAt: num(t.finalizedAt) || null,
  }
}

// Arabic problems, in the order a manager would fix them. Empty array = valid.
export function validateTournament(raw) {
  const t = normalizeTournament(raw)
  const out = []
  if (!t.name) out.push('اكتب اسماً للبطولة.')
  if (!t.from || !t.to) out.push('حدّد تاريخ البداية وتاريخ النهاية.')
  if (t.from && t.to && t.to - t.from < 60 * 1000) out.push('الفترة قصيرة جداً — اجعل النهاية بعد البداية.')
  if (t.prize.kind === 'discount' && (t.prize.value <= 0 || t.prize.value > 100)) {
    out.push('نسبة الخصم يجب أن تكون بين 1 و 100.')
  }
  if (t.prize.kind === 'points' && t.prize.value < 1) out.push('عدد نقاط الولاء يجب أن يكون 1 فأكثر.')
  if (t.prize.kind !== 'custom' && !t.prize.label && t.prize.kind === 'freeItem') {
    out.push('اكتب اسم الصنف المجاني — جائزة بلا اسم ليست جائزة.')
  }
  return out
}

// 'draft' | 'scheduled' | 'running' | 'ended' | 'finalized'
export function statusOf(t, now = Date.now()) {
  const x = normalizeTournament(t)
  if (x.finalizedAt) return 'finalized'
  if (!x.active) return 'draft'
  if (x.from && now < x.from) return 'scheduled'
  if (x.to && now > x.to) return 'ended'
  return 'running'
}

export const STATUS_AR = {
  draft: 'متوقفة',
  scheduled: 'لم تبدأ بعد',
  running: 'جارية الآن',
  ended: 'انتهت الفترة — لم تُعلن',
  finalized: 'أُعلنت',
}

// ---------------------------------------------------------------------------
// Firestore
// ---------------------------------------------------------------------------
const col = (tid) => collection(db, 'tenants', tid, 'tournaments')
const ref = (tid, id) => doc(db, 'tenants', tid, 'tournaments', safeId(id))

// Live list, newest first, bounded. cb({ rows, error }) — `error` is an Arabic
// sentence, never null-and-hanging: a denied rule resolves the callback so the
// page can say something true instead of spinning forever.
export function watchTournaments(tid, cb) {
  if (!firebaseReady || !tid) {
    setTimeout(() => cb?.({ rows: [], error: 'unavailable' }), 0)
    return () => {}
  }
  const q = query(col(tid), orderBy('createdAt', 'desc'), limit(MAX_TOURNAMENTS))
  const emit = (snap) => {
    const rows = snap.docs.map((d) => normalizeTournament({ id: d.id, ...d.data() }))
    cb?.({ rows, error: null })
  }
  return onSnapshot(q, emit, (err) => {
    // No composite index is needed for a single-field sort, so a failure here is
    // a rule or a network problem. Retry unordered before giving up.
    const code = String(err?.code || '')
    if (code.includes('permission-denied')) { cb?.({ rows: [], error: 'permission' }); return }
    try {
      onSnapshot(query(col(tid), limit(MAX_TOURNAMENTS)), (snap) => {
        const rows = snap.docs
          .map((d) => normalizeTournament({ id: d.id, ...d.data() }))
          .sort((a, b) => b.createdAt - a.createdAt)
        cb?.({ rows, error: null })
      }, () => cb?.({ rows: [], error: code || 'error' }))
    } catch (_) { cb?.({ rows: [], error: code || 'error' }) }
  })
}

export async function saveTournament(tid, raw) {
  if (!firebaseReady || !tid) throw new Error('unavailable')
  const problems = validateTournament(raw)
  if (problems.length) throw new Error(problems[0])
  const t = normalizeTournament(raw)
  t.updatedAt = Date.now()
  await setDoc(ref(tid, t.id), t, { merge: true })
  return t.id
}

export async function deleteTournament(tid, id) {
  if (!firebaseReady || !tid || !id) return false
  await deleteDoc(ref(tid, id))
  return true
}

// ===========================================================================
// standings — the scoring engine. PURE: no Firestore, no clock beyond `now`.
//
// Returns:
// {
//   mode, modeAr, howAr, gameId, from, to,
//   rows: [{
//     rank, deviceId, name, phone, identified,
//     value,                       // the ranked number for this mode
//     plays, activeDays, streak,
//     bestScore, bestAt, bestGameId,
//     games: [gameId],             // which games the counted plays were
//     firstAt, lastAt,
//     boardBest,                   // gameScores note — NEVER the ranked value
//   }],
//   qualifyingPlays, soloExcluded, players, thin, minSample, windowValid, noteAr,
//   coverage, complete,
// }
//
// `read` is the caller's play-read REPORT (engine.jsx fetchPlays). It decides
// `complete`, which is the difference between "nobody qualified" and "we never
// saw the window". Nothing about it changes a rank; it changes only what the
// result is ALLOWED TO CLAIM about itself.
// ===========================================================================

// A read may only claim the coverage it can prove. With no report at all the
// answer is "unproven" — never "complete", because assuming coverage is exactly
// how a truncated slice became an announced tournament result.
function readCoverage(read) {
  const r = read && typeof read === 'object' ? read : null
  return {
    ok: Boolean(r) && r.ok !== false,
    capped: Boolean(r) && r.capped === true,
    cap: r ? num(r.cap) : 0,
    scanned: r ? num(r.scanned) : 0,
    oldestScannedMs: r ? num(r.oldestScannedMs) : 0,
    covers: Boolean(r) && r.ok !== false && r.covers === true,
    reported: Boolean(r),
  }
}

export function standings({
  tournament, plays = [], scores = [], profiles = [], read = null,
} = {}) {
  const t = normalizeTournament(tournament)
  const info = modeInfo(t.mode)
  const cov = readCoverage(read)
  const base = {
    mode: t.mode,
    modeAr: info.ar,
    howAr: info.howAr,
    gameId: t.gameId,
    from: t.from,
    to: t.to,
    rows: [],
    qualifyingPlays: 0,
    soloExcluded: 0,
    players: 0,
    thin: true,
    minSample: MIN_SAMPLE,
    windowValid: Boolean(t.from && t.to && t.to > t.from),
    coverage: cov,
    // The one flag `finalize` trusts. False means: do not present this as a
    // result, and do not let anyone freeze it.
    complete: cov.covers,
    noteAr: '',
  }
  if (!base.windowValid) {
    return { ...base, complete: false, noteAr: 'فترة البطولة غير صالحة — حدّد بداية ونهاية.' }
  }

  const list = Array.isArray(plays) ? plays : []
  const wantGame = t.gameId && t.gameId !== 'any' ? t.gameId : null

  // --- qualification: one rule, applied once, stated on screen verbatim ------
  //
  // A round against the computer is dropped HERE, before a single number is
  // counted, so no downstream figure can accidentally include it. The count of
  // what was dropped is carried out with the result: a manager who wonders why a
  // busy player is missing gets an answer instead of an unexplained gap.
  const inWindow = list.filter((p) => {
    const at = num(p.startedAt)
    if (at < t.from || at > t.to) return false
    if (wantGame && p.gameId !== wantGame) return false
    return true
  })
  const soloExcluded = inWindow.filter(isSoloPlay).length
  const qualified = inWindow.filter((p) => !isSoloPlay(p))
  const soloNote = soloExcluded
    ? ` استُبعدت ${soloExcluded} جولة ضد الكمبيوتر — البطولة تُحتسب من اللعب أمام أشخاص فقط.`
    : ''

  if (!qualified.length) {
    // Nothing counted. WHY nothing counted decides what may be said: only a read
    // that provably spanned the window can call this an empty period. A failed
    // or truncated read produced the same empty array without measuring
    // anything, and printing «لا توجد جولات» over it would be a fabricated
    // measurement — the exact one that used to get frozen as an announced
    // result.
    let noteAr
    if (!cov.ok) {
      noteAr = 'تعذّرت قراءة جولات اللعب لهذه الفترة، فلا يمكن القول إنها خالية. هذه ليست نتيجة قياس.'
    } else if (!cov.covers) {
      noteAr = `توقفت قراءة الجولات عند حدّها (${cov.cap} جولة) قبل أن تبلغ بداية الفترة، فجولات الفترة لم تُقرأ كلها. خلوّ الجدول هنا نقصُ قراءة لا نتيجة.`
    } else {
      noteAr = (wantGame
        ? 'لا توجد جولات مسجّلة لهذه اللعبة داخل فترة البطولة.'
        : 'لا توجد جولات مسجّلة داخل فترة البطولة.') + soloNote
    }
    return { ...base, soloExcluded, noteAr }
  }

  // --- name / phone index ---------------------------------------------------
  const names = new Map()
  const take = (deviceId, name, phone) => {
    if (!deviceId) return
    const cur = names.get(deviceId) || { name: '', phone: '' }
    names.set(deviceId, {
      name: cur.name || clean(name, MAX_NAME),
      phone: cur.phone || clean(phone, 20),
    })
  }
  for (const p of profiles || []) take(p.deviceId || p.id, p.customerName, p.customerPhone)
  // The gameScores name is one the guest typed themselves — a good fallback,
  // never an override of a profile that carries a real identity.
  for (const s of scores || []) take(s.deviceId, s.name, '')

  // --- monthly-board note (evidence only, never ranked) ----------------------
  const boardBest = new Map()
  for (const s of scores || []) {
    const at = tsMs(s.at)
    if (!s.deviceId || !at || at < t.from || at > t.to) continue
    boardBest.set(s.deviceId, Math.max(num(boardBest.get(s.deviceId)), num(s.score)))
  }

  // --- roll up per device ---------------------------------------------------
  const byDevice = new Map()
  for (const p of qualified) {
    const id = p.deviceId
    if (!id) continue
    const at = num(p.startedAt)
    const r = byDevice.get(id) || {
      deviceId: id, plays: 0, bestScore: 0, bestAt: 0, bestGameId: '',
      games: new Set(), days: new Set(), firstAt: at, lastAt: at,
      completed: 0,
    }
    r.plays += 1
    if (p.completed === true) r.completed += 1
    const sc = num(p.score)
    // Strictly greater keeps the EARLIEST achievement of a tied best, which is
    // what the documented tie-break promises.
    if (sc > r.bestScore) { r.bestScore = sc; r.bestAt = at; r.bestGameId = p.gameId || '' }
    if (p.gameId) r.games.add(p.gameId)
    r.days.add(dayKey(at))
    r.firstAt = Math.min(r.firstAt, at)
    r.lastAt = Math.max(r.lastAt, num(p.endedAt) || at)
    take(id, p.customerName, p.customerPhone)
    byDevice.set(id, r)
  }

  const rows = [...byDevice.values()].map((r) => {
    const who = names.get(r.deviceId) || { name: '', phone: '' }
    return {
      deviceId: r.deviceId,
      name: who.name || '',
      phone: who.phone || '',
      identified: Boolean(who.phone),
      plays: r.plays,
      completed: r.completed,
      activeDays: r.days.size,
      streak: longestStreak(r.days),
      bestScore: r.bestScore,
      bestAt: r.bestAt,
      bestGameId: r.bestGameId,
      games: [...r.games],
      firstAt: r.firstAt,
      lastAt: r.lastAt,
      boardBest: boardBest.has(r.deviceId) ? num(boardBest.get(r.deviceId)) : null,
    }
  })

  // --- rank -----------------------------------------------------------------
  let ranked
  if (t.mode === 'mostPlays') {
    ranked = rows
      .map((r) => ({ ...r, value: r.plays }))
      .sort((a, b) => b.value - a.value || b.bestScore - a.bestScore || a.firstAt - b.firstAt)
  } else if (t.mode === 'streak') {
    ranked = rows
      .map((r) => ({ ...r, value: r.streak }))
      .sort((a, b) => b.value - a.value || b.plays - a.plays || a.firstAt - b.firstAt)
  } else {
    ranked = rows
      .map((r) => ({ ...r, value: r.bestScore }))
      .sort((a, b) => b.value - a.value || a.bestAt - b.bestAt || b.plays - a.plays)
  }

  // A zero is a real result for a score board but meaningless for the other two
  // modes, where a value of zero cannot happen for anyone who qualified.
  ranked = ranked.map((r, i) => ({ ...r, rank: i + 1 }))

  return {
    ...base,
    rows: ranked,
    qualifyingPlays: qualified.length,
    soloExcluded,
    players: ranked.length,
    thin: qualified.length < MIN_SAMPLE,
    // The count is stated as what it is. When the read did not span the window
    // it is a floor over rows that happened to be readable, and the sentence
    // says so instead of implying a census of the period.
    noteAr: cov.covers
      ? `احتُسبت ${qualified.length} جولة لـ ${ranked.length} لاعباً داخل الفترة${wantGame ? ' ولهذه اللعبة وحدها' : ''}.${soloNote}`
      : `ترتيب جزئي: احتُسبت ${qualified.length} جولة لـ ${ranked.length} لاعباً من الجولات التي أمكن قراءتها فقط، لا من كل جولات الفترة.${soloNote}`,
  }
}

// Longest run of consecutive calendar days inside a Set of 'YYYY-MM-DD' keys.
function longestStreak(daySet) {
  const days = [...(daySet || [])].sort()
  if (!days.length) return 0
  let best = 1
  let run = 1
  for (let i = 1; i < days.length; i += 1) {
    const prev = Date.parse(`${days[i - 1]}T00:00:00`)
    const cur = Date.parse(`${days[i]}T00:00:00`)
    // Compare on a whole-day tolerance so a DST shift cannot break a real run.
    const gap = Math.round((cur - prev) / DAY_MS)
    if (gap === 1) { run += 1; best = Math.max(best, run) } else if (gap > 1) { run = 1 }
  }
  return best
}

// ===========================================================================
// finalize — freeze the computed result onto the document.
//
// It writes ONLY what `standings` produced. A tournament that nobody qualified
// for is closed with an EMPTY winners array and an honest finalizedAt, because
// "nobody played" is a true outcome and inventing a winner is not.
//
// And it REFUSES to write anything at all when the standing did not prove its
// read spanned the tournament window (`complete !== true`). "Nobody played" is a
// true outcome; "we only read part of the period" is not an outcome, and once
// frozen it becomes the venue's announced result, with the wrong guest holding
// the prize and no trace of the truncation that caused it. This guard lives here
// rather than only in the UI so no future caller can route around it.
// ===========================================================================
export async function finalize(tid, tournament, computed) {
  if (!firebaseReady || !tid) throw new Error('unavailable')
  if (!computed || computed.complete !== true) {
    throw new Error(
      'القراءة لم تشمل كل جولات فترة البطولة، فالترتيب الحالي قد يكون ناقصاً أو خاطئاً — ولا يصح إعلان فائز على أساسه. ضيّق فترة البطولة ثم أعد المحاولة.',
    )
  }
  const t = normalizeTournament(tournament)
  const rows = Array.isArray(computed?.rows) ? computed.rows.slice(0, MAX_WINNERS) : []
  // NO PHONE NUMBER IN THE WINNERS ARRAY. The tournament document is
  // `allow read: if true` -- every diner's phone already streams it to read the
  // board -- so a phone written here is a published phone. Announcing winners
  // must not cost the venue's most engaged guests their privacy. Staff who need
  // to contact a winner have the device id, and the CRM on its protected path.
  const winners = rows.map((r) => ({
    deviceId: String(r.deviceId || '').slice(0, 64),
    name: clean(r.name, MAX_NAME),
    score: num(r.value),
    rank: num(r.rank),
  }))
  const patch = {
    ...t,
    winners,
    active: false,
    finalizedAt: Date.now(),
    updatedAt: Date.now(),
  }
  await setDoc(ref(tid, t.id), patch, { merge: true })
  return winners
}

// Reopen a finalized tournament (a manager who announced by mistake). Clears the
// frozen winners rather than leaving a stale board next to a live one.
export async function reopen(tid, tournament) {
  if (!firebaseReady || !tid) throw new Error('unavailable')
  const t = normalizeTournament(tournament)
  await setDoc(ref(tid, t.id), {
    ...t, winners: [], finalizedAt: null, active: true, updatedAt: Date.now(),
  }, { merge: true })
  return true
}

// The value label for a mode, so a number never appears without its unit.
export function valueLabel(mode, value, ar = true) {
  const n = num(value)
  const digits = n.toLocaleString('ar-SA-u-nu-latn')
  if (mode === 'mostPlays') return ar ? `${digits} جولة` : `${digits} rounds`
  if (mode === 'streak') return ar ? `${digits} يوم متتالٍ` : `${digits} day streak`
  return ar ? `${digits} نقطة` : `${digits} pts`
}
