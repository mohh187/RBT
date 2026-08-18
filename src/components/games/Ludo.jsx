// «الليدو» — Ludo / Parcheesi, real rules, 2-4 players, realtime over the
// shared room contract (src/lib/gameRoom.js).
//
// ---------------------------------------------------------------------------
// BOARD MODEL (derived from the real 15x15 cross board, not invented)
// ---------------------------------------------------------------------------
// The classic board is a 15x15 grid. RING below is the 52 shared squares in
// travel order. Each colour enters the ring at its own start square
// (indices 0 / 13 / 26 / 39) and travels 51 ring squares — relPos 0..50 — the
// last of which (relPos 50) is the gateway square sitting at the mouth of its
// own arm. It then turns into its private 5-square home column (relPos 51..55)
// and finally reaches the centre HOME on relPos 56, which must be hit EXACTLY.
//
// So: 52 shared squares on the board, 51 of them walked by any one colour
// (a token never walks back onto its own start square), plus a 5-square home
// column. That is the real geometry of the board — the "52 steps" figure often
// quoted counts the squares that exist, not the squares one token walks.
//
// ---------------------------------------------------------------------------
// WHY THE DIE IS ROLLED INSIDE `reduce` (this is the whole anti-cheat story)
// ---------------------------------------------------------------------------
// A client NEVER sends a die value. The move is `{ type: 'roll' }` and nothing
// else. `reduce` derives the die from data the mover cannot choose:
//
//     die = 1 + hash32(`${room.roomId}|${state.seed}|${state.rollCount}|${seat}`) % 6
//
//   · room.roomId   — the Firestore document id, generated server-side on
//                     createRoom. Nobody picks it.
//   · state.seed    — a random 32-bit value baked into initialState() BEFORE
//                     the room exists, so the host who generated it could not
//                     have known the roomId it would be mixed with. Host and
//                     guests are therefore both blind to the final stream.
//   · state.rollCount — a monotonic counter owned by the game state and
//                     incremented inside `reduce`. Deliberately NOT
//                     `room.moves.length`, because `moves` is capped at 200 and
//                     stops being monotonic once the cap is hit.
//   · seat          — the mover, so two players never share a sub-stream.
//
// Because applyMove wraps this in a runTransaction read-modify-write, the die
// is recomputed from the freshly-read document on whichever client commits.
// A tampered client cannot roll sixes forever: it can only ask to roll, and the
// answer is a pure function of state it does not control. Every other move is
// re-validated the same way — `reduce` recomputes the legal move list and
// returns the state UNCHANGED for anything not on it.
//
// HONEST LIMITATION: the stream is deterministic, so a player who reads this
// source can predict their own next die. That is close to harmless (rolling is
// forced — you cannot decline a roll to dodge a bad number), but it is a real
// property and it is stated rather than hidden. Making it unpredictable would
// need a server-side secret, which this architecture does not have.
//
// ---------------------------------------------------------------------------
// PURITY NOTE: `reduce` is pure with respect to `state`. It calls Date.now()
// only for `turn.startedAt` (display metadata) and for the stall detector on
// `forceSkip`. No game decision depends on the clock.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { botMoveFor, botLabel, takeSoloIntent, BOT_DELAY_MS, BOT_DELAY_FAST } from '../../lib/gameBots.js'
import { play } from '../../lib/gameSounds.js'
import '../../styles/ludo.css'

// ===========================================================================
// board geometry
// ===========================================================================

// 52 shared squares as [row, col] on the 15x15 grid, in travel order.
const RING = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7],
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0],
  [6, 0],
]

const START = [0, 13, 26, 39]

// The eight safe squares of the standard board: the four colour entry squares
// plus the four starred squares, each exactly 8 ahead of an entry square.
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47])
const STAR = [8, 21, 34, 47]

const LAST_RING = 50   // relPos of the gateway square (start + 50)
const COL_FIRST = 51   // relPos of the first home-column square
const HOME = 56        // relPos of the centre — reachable only by an exact count
const YARD = -1

// private 5-square home column per seat, as [row, col]
const HOME_COL = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
]

// 6x6 yard origins as [row, col]
const YARD_AT = [[0, 0], [0, 9], [9, 9], [9, 0]]

// seat -> colour identity. Red top-left, green top-right, yellow bottom-right,
// blue bottom-left, travelling clockwise — the layout every player knows.
const COLORS = [
  { id: 'red', ar: 'الأحمر', en: 'Red', main: '#d92b3a', deep: '#9d1220', soft: '#fbe3e5' },
  { id: 'green', ar: 'الأخضر', en: 'Green', main: '#16a34a', deep: '#0d6c31', soft: '#ddf3e5' },
  { id: 'yellow', ar: 'الأصفر', en: 'Yellow', main: '#e0a409', deep: '#96690a', soft: '#fbf0d6' },
  { id: 'blue', ar: 'الأزرق', en: 'Blue', main: '#2563eb', deep: '#16409c', soft: '#dfe8fd' },
]

const STALL_MS = 75000 // after this a stopped turn can be skipped by anyone

// ===========================================================================
// pure engine — shared by `reduce` and by the board renderer
// ===========================================================================

const clamp4 = (n) => Math.max(0, Math.min(3, Number(n) || 0))

function ringIndexOf(seat, rel) {
  if (rel < 0 || rel > LAST_RING) return -1
  return (START[clamp4(seat)] + rel) % RING.length
}

// FNV-1a plus an avalanche mix. Integer-only (Math.imul) so every client
// computes bit-identical values — a must, since two clients may both run the
// transaction body before one of them commits.
function hash32(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

function dieFor(room, st, seat) {
  const rid = (room && room.roomId) || 'local'
  const key = `${rid}|${(st.seed >>> 0)}|${st.rollCount || 0}|${seat}`
  return (hash32(key) % 6) + 1
}

// How many tokens of seat `s` sit on absolute ring square `idx`.
function countOn(st, s, idx) {
  const arr = (st.tokens && st.tokens[s]) || []
  let n = 0
  for (let t = 0; t < arr.length; t += 1) {
    const p = arr[t]
    if (p >= 0 && p <= LAST_RING && ringIndexOf(s, p) === idx) n += 1
  }
  return n
}

// The single source of truth for what a roll allows. Exported shape:
//   [{ token, from, to }]
export function legalMoves(st, seat, die) {
  const out = []
  const d = Number(die) || 0
  if (!st || !Array.isArray(st.tokens) || d < 1 || d > 6) return out
  const mine = st.tokens[seat] || []
  for (let t = 0; t < mine.length; t += 1) {
    const from = mine[t]
    if (from === HOME) continue
    let to
    if (from === YARD) {
      if (d !== 6) continue          // a six is required to leave the yard
      to = 0
    } else {
      to = from + d
      if (to > HOME) continue        // overshooting the centre is illegal
    }
    if (to <= LAST_RING) {
      // a block (2+ tokens of one opponent colour) cannot be landed on
      const idx = ringIndexOf(seat, to)
      let blocked = false
      for (let s = 0; s < 4 && !blocked; s += 1) {
        if (s === seat) continue
        if (countOn(st, s, idx) >= 2) blocked = true
      }
      if (blocked) continue
    }
    out.push({ token: t, from, to })
  }
  return out
}

function capturesAt(st, seat, to) {
  if (to > LAST_RING) return false
  const idx = ringIndexOf(seat, to)
  if (SAFE.has(idx)) return false
  for (let s = 0; s < 4; s += 1) {
    if (s === seat) continue
    if (countOn(st, s, idx) > 0) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// helpers the bot layer needs. They are exported rather than reimplemented in
// src/lib/gameBots.js on purpose: the ring geometry lives here, and a second
// copy of it would drift the first time this board changes.
// ---------------------------------------------------------------------------
function isSafeRel(seat, rel) {
  if (rel < 0 || rel > LAST_RING) return false
  return SAFE.has(ringIndexOf(seat, rel))
}

// How many opponent tokens sit one to six squares behind the square (seat, rel)
// and could therefore land on it with a single roll. Zero on a safe square.
//
// HONEST APPROXIMATION: it does not check whether that opponent token would
// overshoot into its own home column instead of landing here, so very late
// tokens are counted as threats when they are not. It over-states danger; it
// never misses it.
function riskAt(st, seat, rel) {
  if (rel < 0 || rel > LAST_RING) return 0
  const idx = ringIndexOf(seat, rel)
  if (SAFE.has(idx)) return 0
  let n = 0
  for (let s = 0; s < 4; s += 1) {
    if (s === seat) continue
    const arr = (st.tokens && st.tokens[s]) || []
    for (let t = 0; t < arr.length; t += 1) {
      const p = arr[t]
      if (p < 0 || p > LAST_RING) continue
      const d = ((idx - ringIndexOf(s, p)) % RING.length + RING.length) % RING.length
      if (d >= 1 && d <= 6) n += 1
    }
  }
  return n
}

export const botHelpers = {
  legalMoves, capturesAt, isSafe: isSafeRel, riskAt, YARD, COL_FIRST, HOME, LAST_RING,
}

function seatsFromRoom(room) {
  const ps = (room && Array.isArray(room.players)) ? room.players : []
  const seen = []
  for (let i = 0; i < ps.length; i += 1) {
    const s = Number(ps[i] && ps[i].seat)
    if (Number.isInteger(s) && s >= 0 && s < 4 && !seen.includes(s)) seen.push(s)
  }
  seen.sort((a, b) => a - b)
  return seen
}

function activeSeats(st, room) {
  if (st && Array.isArray(st.seats) && st.seats.length) return st.seats
  const s = seatsFromRoom(room)
  return s.length >= 2 ? s : [0, 1]
}

function nextSeat(seats, st, from) {
  const n = seats.length
  if (!n) return from
  let i = seats.indexOf(from)
  if (i < 0) i = 0
  const done = (st && st.finished) || []
  for (let k = 1; k <= n; k += 1) {
    const cand = seats[(i + k) % n]
    if (!done.includes(cand)) return cand
  }
  return from
}

const cloneState = (s) => {
  try { return JSON.parse(JSON.stringify(s)) } catch (_) { return null }
}

// Only the seat is returned. applyMove stamps `startedAt` itself and derives
// `deadlineAt` from the room's turnMs — passing an explicit `deadlineAt: null`
// here would win the `??` in applyMove and permanently kill the turn clock.
const turnAt = (seat) => ({ seat })

function pushLog(st, entry) {
  const log = Array.isArray(st.log) ? st.log : []
  log.push(entry)
  st.log = log.slice(-6)
}

// ===========================================================================
// contract exports
// ===========================================================================

export function initialState(playerCount = 4) {
  const n = Math.max(2, Math.min(4, Number(playerCount) || 4))
  return {
    v: 1,
    // random here, mixed with the server-generated roomId later — see the die
    // note at the top of this file.
    seed: (Math.floor(Math.random() * 0xffffffff)) >>> 0,
    rollCount: 0,
    tokens: [
      [YARD, YARD, YARD, YARD],
      [YARD, YARD, YARD, YARD],
      [YARD, YARD, YARD, YARD],
      [YARD, YARD, YARD, YARD],
    ],
    seats: null,           // locked from the room's real seats on the first roll
    plannedSeats: Array.from({ length: n }, (_, i) => i),
    die: null,
    lastDie: null,
    sixStreak: 0,
    phase: 'roll',         // 'roll' | 'move' | 'over'
    finished: [],
    note: { k: 'start' },
    log: [],
  }
}

export function reduce(state, move, room) {
  const st = cloneState(state)
  if (!st || !Array.isArray(st.tokens)) return { state }

  const type = move && move.type
  const seats = activeSeats(st, room)
  const roomTurn = (room && room.turn && Number.isInteger(room.turn.seat)) ? room.turn.seat : seats[0]
  // `move.seat` is stamped by gameRoom.applyMove. Falling back to the room's
  // turn is safe because every gameplay branch below refuses to act unless the
  // seat IS the turn holder — so a spoofed seat buys nothing.
  const seat = Number.isInteger(move && move.seat) ? move.seat : roomTurn

  // ---- rematch ----
  // WIRING CAVEAT: applyMove refuses to run at all once room.status === 'ended'
  // ('not-playing'), and startGame refuses an ended room too. So this branch is
  // only reachable in the offline/local engine below. An online rematch has to
  // be a NEW room — see the note handed to the lead. The branch is kept because
  // it is the correct reducer semantics if a resettable path ever lands.
  if (type === 'restart') {
    if (st.phase !== 'over') return { state }
    const fresh = initialState(seats.length)
    fresh.seats = seats.slice()
    fresh.seed = hash32(`${(room && room.roomId) || 'local'}|${st.seed}|${st.rollCount}`) >>> 0
    return { state: fresh, turn: turnAt(seats[0]), status: 'playing', winnerSeat: null }
  }

  if (st.phase === 'over') return { state }

  // ---- anti-stall: a disconnected or timed-out seat can be skipped ----
  if (type === 'forceSkip') {
    const holder = ((room && room.players) || []).find((p) => Number(p && p.seat) === roomTurn)
    const startedAt = Number(room && room.turn && room.turn.startedAt) || 0
    const stale = startedAt > 0 && (Date.now() - startedAt) > STALL_MS
    const gone = !holder || holder.connected === false
    if (!stale && !gone) return { state }
    st.die = null
    st.sixStreak = 0
    st.phase = 'roll'
    st.note = { k: 'skipped', a: roomTurn }
    return { state: st, turn: turnAt(nextSeat(seats, st, roomTurn)) }
  }

  if (seat !== roomTurn) return { state }

  // ---- roll ----
  if (type === 'roll') {
    if (st.phase !== 'roll') return { state }
    if (!Array.isArray(st.seats) || !st.seats.length) st.seats = seats.slice()

    const die = dieFor(room, st, seat)
    st.rollCount = (st.rollCount || 0) + 1
    st.die = die
    st.lastDie = die

    if (die === 6) {
      st.sixStreak = (st.sixStreak || 0) + 1
      // Standard anti-stall rule: the third consecutive six forfeits the turn
      // outright — it is not played. (Variants that also send the last-moved
      // token back to the yard are NOT implemented; see RULES_AR.)
      if (st.sixStreak >= 3) {
        st.sixStreak = 0
        st.die = null
        st.phase = 'roll'
        st.note = { k: 'threeSixes', a: seat }
        pushLog(st, { seat, die, k: 'threeSixes' })
        return { state: st, turn: turnAt(nextSeat(seats, st, seat)) }
      }
    } else {
      st.sixStreak = 0
    }

    const opts = legalMoves(st, seat, die)
    if (!opts.length) {
      st.die = null
      st.sixStreak = 0
      st.phase = 'roll'
      st.note = { k: 'noMove', a: seat, b: die }
      pushLog(st, { seat, die, k: 'noMove' })
      return { state: st, turn: turnAt(nextSeat(seats, st, seat)) }
    }

    st.phase = 'move'
    st.note = { k: 'rolled', a: seat, b: die }
    // Same seat, FRESH turn stamp: without it turn.startedAt keeps aging while
    // the player picks a token, so a roll made near the stall window's edge
    // left them force-skippable mid-move with a die they never got to play.
    return { state: st, turn: turnAt(seat) }
  }

  // ---- move a token ----
  if (type === 'move') {
    if (st.phase !== 'move' || !st.die) return { state }
    const die = st.die
    const opts = legalMoves(st, seat, die)
    const chosen = opts.find((o) => o.token === Number(move.token))
    if (!chosen) return { state }   // illegal -> state unchanged (total function)

    st.tokens[seat][chosen.token] = chosen.to

    let captured = 0
    if (chosen.to <= LAST_RING) {
      const idx = ringIndexOf(seat, chosen.to)
      // Safe squares (stars + every colour's entry square) are shared, never
      // captured on — different colours simply coexist there.
      if (!SAFE.has(idx)) {
        for (let s = 0; s < 4; s += 1) {
          if (s === seat) continue
          const arr = st.tokens[s]
          for (let t = 0; t < arr.length; t += 1) {
            const p = arr[t]
            if (p >= 0 && p <= LAST_RING && ringIndexOf(s, p) === idx) {
              arr[t] = YARD
              captured += 1
            }
          }
        }
      }
    }

    const homed = chosen.to === HOME
    pushLog(st, { seat, die, k: captured ? 'captured' : (homed ? 'homed' : 'moved'), n: captured })

    const done = st.tokens[seat].every((p) => p === HOME)
    if (done && !st.finished.includes(seat)) st.finished.push(seat)

    // A six, a capture and getting a token home each grant another roll — but
    // never to a player who has just finished.
    const extra = (die === 6 || captured > 0 || homed) && !done
    if (die !== 6) st.sixStreak = 0

    st.die = null
    st.note = { k: captured ? 'captured' : (homed ? 'homed' : (extra ? 'extra' : 'moved')), a: seat, b: captured }

    const unfinished = seats.filter((s) => !st.finished.includes(s))
    if (unfinished.length <= 1) {
      st.phase = 'over'
      st.note = { k: 'over', a: st.finished[0] }
      const out = { state: st, status: 'ended' }
      if (st.finished.length) out.winnerSeat = st.finished[0]
      return out
    }

    // NOTE: `winnerSeat` is deliberately NOT returned for the first finisher of
    // a 3-4 player game. applyMove treats any non-null winnerSeat as "the round
    // is over" and force-ends the room, which would cut the remaining players
    // off mid-game. Placings live in state.finished and are shown on the board;
    // winnerSeat is only reported when the round genuinely ends, above.
    st.phase = 'roll'
    // The streak belongs to the PLAYER. Finishing a token on a six grants no
    // extra roll (`done` above), and without this reset the count would leak
    // to the next seat, who could then forfeit off a single six of their own.
    if (!extra) st.sixStreak = 0
    return { state: st, turn: turnAt(extra ? seat : nextSeat(seats, st, seat)) }
  }

  return { state }
}

export const RULES_AR = [
  'الهدف: أوصِل قطعك الأربع إلى مركز اللوح قبل بقية اللاعبين.',
  'الخروج: لا تخرج القطعة من البيت إلا برمية 6.',
  'الستّة: كل 6 تمنحك رمية إضافية، لكن 3 ستّات متتالية تُسقط دورك كاملاً (قاعدة منع التعطيل المعتمدة).',
  'الأكل: النزول بالضبط على قطعة خصم يعيدها إلى بيتها، ويمنحك رمية إضافية.',
  'الأمان: مربعات النجمة ومربع انطلاق كل لون آمنة، فلا تُؤكل فيها قطعة، وتتشارك فيها الألوان.',
  'الحاجز: قطعتان من لونك على مربع واحد تكوّنان حاجزاً لا يستطيع الخصم النزول عليه. المرور فوقه مسموح، وهذه هي النسخة الأكثر انتشاراً من اللودو.',
  'ممر البيت: 5 مربعات خاصة بلونك، ثم المركز. يلزم عدد مطابق تماماً؛ أي زيادة حركة غير قانونية.',
  'الوصول: إدخال قطعة إلى المركز يمنح رمية إضافية.',
  'إن لم تكن هناك أي حركة قانونية انتقل الدور تلقائياً.',
  'الزهر: تُحسب قيمته داخل قواعد اللعبة من بيانات الغرفة لا من جهاز اللاعب، فلا يستطيع أحد اختيار رميته.',
].join('\n')

// ===========================================================================
// UI
// ===========================================================================

const T = {
  ar: {
    turnYou: 'دورك',
    turnOf: 'دور',
    roll: 'ارمِ الزهر',
    rolling: 'جارٍ الرمي',
    pick: 'اختر قطعة',
    wait: 'بانتظار اللاعبين',
    waitMsg: 'اللعبة تبدأ حين ينضم لاعب آخر على الأقل.',
    rules: 'القواعد',
    close: 'إغلاق',
    home: 'وصلت',
    again: 'جولة جديدة',
    skip: 'تخطَّ اللاعب المتوقف',
    solo: 'العب الآن',
    soloTitle: 'الليدو',
    soloSub: 'اختر عدد اللاعبين وطريقة اللعب، أو انتظر انضمام الآخرين إلى الغرفة.',
    vsBots: 'ضد الكمبيوتر',
    sameDevice: 'على نفس الجهاز',
    players: 'لاعبون',
    start: 'ابدأ',
    you: 'أنت',
    bot: 'الكمبيوتر',
    place: 'المركز',
    winner: 'الفائز',
    yourDie: 'زهرك',
    blockedHint: 'قطعة عليها حاجز: خانتها يحتلّها حجر خصم مزدوج، ولا يجوز النزول عليه.',
    autoPlay: 'حركتك الوحيدة، تُلعب تلقائياً',
    n: {
      start: 'ابدأ برمية الزهر.',
      rolled: 'اختر القطعة التي تتحرك.',
      noMove: 'لا توجد حركة قانونية، فانتقل الدور.',
      threeSixes: 'ثلاث ستّات متتالية، فسقط الدور.',
      skipped: 'تم تخطي دور لاعب متوقف.',
      moved: 'تحركت القطعة.',
      captured: 'أكل قطعة خصم، ومعها رمية إضافية.',
      homed: 'وصلت قطعة إلى المركز، ومعها رمية إضافية.',
      extra: 'رمية إضافية.',
      over: 'انتهت اللعبة.',
    },
  },
  en: {
    turnYou: 'Your turn',
    turnOf: 'Turn of',
    roll: 'Roll',
    rolling: 'Rolling',
    pick: 'Pick a token',
    wait: 'Waiting for players',
    waitMsg: 'The game starts once another player joins.',
    rules: 'Rules',
    close: 'Close',
    home: 'Home',
    again: 'New round',
    skip: 'Skip stalled player',
    solo: 'Play now',
    soloTitle: 'Ludo',
    soloSub: 'Pick the player count and mode, or wait for others to join the room.',
    vsBots: 'Vs computer',
    sameDevice: 'Same device',
    players: 'players',
    start: 'Start',
    you: 'You',
    bot: 'Computer',
    place: 'Place',
    winner: 'Winner',
    yourDie: 'Your die',
    blockedHint: 'Blocked: an opponent holds that square with two tokens, and a block cannot be landed on.',
    autoPlay: 'Your only move, playing it now',
    n: {
      start: 'Roll to begin.',
      rolled: 'Choose a token to move.',
      noMove: 'No legal move, so the turn passes.',
      threeSixes: 'Three sixes in a row, so the turn is forfeited.',
      skipped: 'A stalled player was skipped.',
      moved: 'Token moved.',
      captured: 'Captured, with an extra roll.',
      homed: 'Token home, with an extra roll.',
      extra: 'Extra roll.',
      over: 'Game over.',
    },
  },
}

const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

// screen position (in 15x15 user units) of a token at relPos p for `seat`
function tokenXY(seat, p, slot) {
  if (p === YARD) {
    const [r0, c0] = YARD_AT[seat]
    const dx = slot % 2 === 0 ? 2 : 4
    const dy = slot < 2 ? 2 : 4
    return { x: c0 + dx, y: r0 + dy, yard: true }
  }
  if (p === HOME) {
    const dirs = [[-1, 0], [0, -1], [1, 0], [0, 1]]
    const [ux, uy] = dirs[seat]
    const perp = [uy, -ux]
    const off = (slot - 1.5) * 0.34
    return { x: 7.5 + ux * 1.0 + perp[0] * off, y: 7.5 + uy * 1.0 + perp[1] * off, home: true }
  }
  if (p >= COL_FIRST) {
    const [r, c] = HOME_COL[seat][p - COL_FIRST]
    return { x: c + 0.5, y: r + 0.5 }
  }
  const [r, c] = RING[ringIndexOf(seat, p)]
  return { x: c + 0.5, y: r + 0.5 }
}

function starPoints(cx, cy, r) {
  const pts = []
  for (let i = 0; i < 10; i += 1) {
    const rad = i % 2 === 0 ? r : r * 0.44
    const a = (Math.PI / 5) * i - Math.PI / 2
    pts.push(`${(cx + Math.cos(a) * rad).toFixed(3)},${(cy + Math.sin(a) * rad).toFixed(3)}`)
  }
  return pts.join(' ')
}

const PIPS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
}

function Die({ value, spinning }) {
  const pips = PIPS[value] || []
  return (
    <svg className={`lud-die${spinning ? ' is-roll' : ''}`} viewBox="0 0 40 40" focusable="false" aria-hidden="true">
      <rect x="2.5" y="2.5" width="35" height="35" rx="9" fill="#fdfdfb" stroke="rgba(12,18,26,.28)" strokeWidth="1.4" />
      <rect x="4.6" y="4.6" width="30.8" height="30.8" rx="7" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="1" />
      {pips.map(([dx, dy], i) => (
        <circle key={i} cx={20 + dx * 8.4} cy={20 + dy * 8.4} r="3.5" fill="#17202b" />
      ))}
      {!value ? <circle cx="20" cy="20" r="3.2" fill="rgba(23,32,43,.22)" /> : null}
    </svg>
  )
}

export default function Ludo({
  onScore,
  lang = 'ar',
  brand = '#0e7490',
  playerName = '',
  room = null,
  mySeat = null,
  onMove,
  isHost = false,
  // «العب ضد الكمبيوتر»: how many machine seats to open. The hub passes this
  // when the lobby routed a solo round; when it does not, the lobby's own
  // hand-off (takeSoloIntent) supplies the same answer.
  soloBots = null,
}) {
  const L = T[lang === 'en' ? 'en' : 'ar']
  const online = !!(room && room.roomId)

  const [local, setLocal] = useState(null)      // { room, state, youSeat, bots }
  const [setup, setSetup] = useState({ count: 4, bots: true })
  const [showRules, setShowRules] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  // -------- presentation-only state (never touches the engine) --------
  const [dieShow, setDieShow] = useState(null)  // face shown while tumbling
  const [tumbling, setTumbling] = useState(false)
  const [disp, setDisp] = useState(null)        // {'s:t': relPos} display overrides while a token walks
  const [flying, setFlying] = useState(null)    // Set('s:t') — captured tokens flying home
  const [fx, setFx] = useState([])              // transient bursts/star pops on the board
  const [shake, setShake] = useState(false)     // triple-six forfeit
  const [now, setNow] = useState(0)             // countdown ring clock (online only)

  const reduceMotion = useMemo(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
  }, [])

  const fxIdRef = useRef(0)
  const pushFx = useCallback((f) => {
    fxIdRef.current += 1
    const id = fxIdRef.current
    setFx((list) => [...list, { ...f, id }])
    setTimeout(() => setFx((list) => list.filter((x) => x.id !== id)), 950)
  }, [])

  // createRoom seeds `state: {}` — truthy but not a board. Anything without a
  // tokens array must read as "not started yet" so the waiting panel renders;
  // an invited guest arriving before the host starts used to crash here on
  // `gstate.finished.length`.
  const gstate = online
    ? (room.state && Array.isArray(room.state.tokens) ? room.state : null)
    : (local ? local.state : null)
  const groom = online ? room : (local ? local.room : null)
  const turnSeat = (groom && groom.turn && Number.isInteger(groom.turn.seat)) ? groom.turn.seat : -1

  const seats = useMemo(() => (gstate ? activeSeats(gstate, groom) : []), [gstate, groom])

  const seat = online
    ? (Number.isInteger(mySeat) ? mySeat : -1)
    : (local ? (local.bots ? local.youSeat : turnSeat) : -1)

  const myTurn = seat >= 0 && seat === turnSeat && !!gstate && gstate.phase !== 'over'

  // ---- local (offline) engine -------------------------------------------
  const applyLocal = useCallback((mv) => {
    setLocal((prev) => {
      if (!prev) return prev
      const s = Number.isInteger(mv.seat) ? mv.seat : prev.room.turn.seat
      const res = reduce(prev.state, { ...mv, seat: s }, prev.room)
      if (!res || res.state === prev.state) return prev
      // mirror what applyMove stamps on the server side, so the offline board
      // and the online board see exactly the same room shape
      const nextRoom = {
        ...prev.room,
        turn: res.turn
          ? { seat: res.turn.seat, startedAt: Date.now(), deadlineAt: null }
          : prev.room.turn,
        status: res.status || prev.room.status,
        winnerSeat: Object.prototype.hasOwnProperty.call(res, 'winnerSeat') ? res.winnerSeat : prev.room.winnerSeat,
      }
      return { ...prev, state: res.state, room: nextRoom }
    })
  }, [])

  const startLocal = useCallback((cfg) => {
    const bots = cfg && cfg.bots !== undefined ? !!cfg.bots : setup.bots
    const n = Math.max(2, Math.min(4, Number(cfg && cfg.count) || setup.count))
    const st = initialState(n)
    st.seats = Array.from({ length: n }, (_, i) => i)
    const players = st.seats.map((s) => ({
      // A machine seat is named «الكمبيوتر» and carries `bot: true`. It is never
      // shown as a person, and never given the player's name.
      id: bots && s !== 0 ? `bot-${s}` : `local-${s}`,
      name: s === 0
        ? (playerName || L.you)
        : (bots ? botLabel(s - 1, n - 1, lang) : `${L.players} ${fmt(s + 1)}`),
      bot: bots && s !== 0,
      seat: s,
      connected: true,
      score: 0,
    }))
    setLocal({
      bots,
      youSeat: 0,
      state: st,
      room: {
        roomId: `local-${Date.now().toString(36)}`,
        gameId: 'ludo',
        status: 'playing',
        hostId: 'local-0',
        players,
        turn: { seat: 0, startedAt: Date.now(), deadlineAt: null },
        moves: [],
        winnerSeat: null,
      },
    })
  }, [setup, playerName, L, lang])

  // The lobby already asked «كم خصماً؟» — do not ask again on the board. An
  // explicit `soloBots` prop wins; otherwise the lobby's hand-off is read once.
  const soloRef = useRef(false)
  useEffect(() => {
    if (online || local || soloRef.current) return
    soloRef.current = true
    const n = Number(soloBots)
    const intent = Number.isFinite(n) && n > 0 ? { bots: n } : takeSoloIntent('ludo')
    if (!intent) return
    const bots = Math.max(1, Math.min(3, Number(intent.bots) || 1))
    startLocal({ count: bots + 1, bots: true })
  }, [online, local, soloBots, startLocal])

  const submit = useCallback((mv) => {
    if (online) {
      if (busy) return
      setBusy(true)
      try { if (typeof onMove === 'function') onMove(mv) } catch (_) { setBusy(false) }
    } else {
      applyLocal(mv)
    }
  }, [online, busy, onMove, applyLocal])

  // clear the in-flight lock whenever the authoritative state actually moves
  const fp = gstate
    ? `${gstate.rollCount}|${gstate.phase}|${turnSeat}|${gstate.finished.length}|${JSON.stringify(gstate.tokens)}`
    : ''
  useEffect(() => { setBusy(false) }, [fp])
  useEffect(() => {
    if (!busy) return undefined
    const t = setTimeout(() => setBusy(false), 2600)
    return () => clearTimeout(t)
  }, [busy])

  // ---- die tumble: display-only. The engine already resolved the value; the
  // face just cycles for ~600ms before settling on it. Ref-guarded so joining
  // a room mid-game does not replay the last roll.
  const rollFp = gstate ? `${gstate.rollCount}` : ''
  const rollSeenRef = useRef(null)
  useEffect(() => {
    if (!gstate) return undefined
    if (rollSeenRef.current === null || rollSeenRef.current === rollFp) {
      rollSeenRef.current = rollFp
      setDieShow(gstate.lastDie)
      return undefined
    }
    rollSeenRef.current = rollFp
    const final = gstate.lastDie
    play('dice')
    if (reduceMotion) { setDieShow(final); return undefined }
    setTumbling(true)
    let n = 0
    const iv = setInterval(() => {
      n += 1
      if (n >= 8) {
        clearInterval(iv)
        setDieShow(final)
        setTumbling(false)
      } else {
        setDieShow(1 + ((final + n * 2 + (n % 3)) % 6))
      }
    }, 75)
    return () => { clearInterval(iv); setTumbling(false); setDieShow(final) }
  }, [rollFp, gstate, reduceMotion])

  // ---- token motion: walk the mover cell by cell, hold any captured token on
  // its square until the mover lands, then let it fly home. Pure display —
  // `disp` only overrides where a token is DRAWN, never what the engine says.
  const tokensJson = gstate ? JSON.stringify(gstate.tokens) : ''
  const prevTokensRef = useRef(null)
  const animTimerRef = useRef(null)
  useEffect(() => () => { if (animTimerRef.current) clearTimeout(animTimerRef.current) }, [])
  useEffect(() => {
    if (!gstate) { prevTokensRef.current = null; return }
    const cur = gstate.tokens.map((a) => (a || []).slice())
    const prev = prevTokensRef.current
    prevTokensRef.current = cur
    if (!prev) { setDisp(null); setFlying(null); return }
    const changed = []
    for (let s = 0; s < 4; s += 1) {
      for (let t = 0; t < 4; t += 1) {
        if (Number.isInteger(prev[s]?.[t]) && prev[s][t] !== cur[s]?.[t]) {
          changed.push({ s, t, from: prev[s][t], to: cur[s][t] })
        }
      }
    }
    // No token moved (a roll, a turn pass...): leave any running walk alone —
    // cancelling here would freeze the walker mid-path with a stale override.
    if (!changed.length) return
    if (animTimerRef.current) { clearTimeout(animTimerRef.current); animTimerRef.current = null }
    const mover = changed.find((e) => e.to !== YARD)
    const caps = changed.filter((e) => e.to === YARD)
    if (!mover) { setDisp(null); setFlying(null); return } // restart / reset — silent
    const homed = mover.to === HOME

    const landFx = () => {
      if (caps.length) {
        play('capture')
        const q = tokenXY(mover.s, mover.to, mover.t)
        pushFx({ kind: 'burst', x: q.x, y: q.y, color: COLORS[mover.s].main })
      } else if (homed) {
        play('win', { gain: 0.45 })
        pushFx({ kind: 'star', x: 7.5, y: 7.5, color: COLORS[mover.s].main })
      }
    }
    const flyCaps = () => {
      if (!caps.length) { setFlying(null); return }
      setFlying(new Set(caps.map((e) => `${e.s}:${e.t}`)))
      setTimeout(() => setFlying(null), 620)
    }

    const steps = []
    if (mover.from === YARD) steps.push(mover.to)
    else for (let p = mover.from + 1; p <= mover.to; p += 1) steps.push(p)

    if (reduceMotion || steps.length <= 1) {
      setDisp(null)
      play('move')
      landFx()
      flyCaps()
      return
    }

    const overrides = {}
    caps.forEach((e) => { overrides[`${e.s}:${e.t}`] = e.from })
    const key = `${mover.s}:${mover.t}`
    let i = 0
    overrides[key] = steps[0]
    setDisp({ ...overrides })
    play('move', { gain: 0.6 })
    const stepMs = steps.length > 7 ? 72 : 95
    const walk = () => {
      i += 1
      if (i < steps.length) {
        overrides[key] = steps[i]
        setDisp({ ...overrides })
        play('move', { gain: 0.45 })
        animTimerRef.current = setTimeout(walk, stepMs)
      } else {
        animTimerRef.current = null
        setDisp(null)
        landFx()
        flyCaps()
      }
    }
    animTimerRef.current = setTimeout(walk, stepMs)
  }, [tokensJson, gstate, reduceMotion, pushFx])

  // ---- triple-six forfeit: shake the board, sigh softly (only loud-ish for me)
  const noteFp = gstate ? `${gstate.rollCount}|${gstate.note?.k || ''}` : ''
  const noteSeenRef = useRef(null)
  useEffect(() => {
    if (!gstate) return undefined
    if (noteSeenRef.current === null) { noteSeenRef.current = noteFp; return undefined }
    if (noteSeenRef.current === noteFp) return undefined
    noteSeenRef.current = noteFp
    if (gstate.note?.k !== 'threeSixes') return undefined
    play('lose', { gain: gstate.note.a === seat ? 0.55 : 0.3 })
    if (reduceMotion) return undefined
    setShake(true)
    const t = setTimeout(() => setShake(false), 560)
    return () => clearTimeout(t)
  }, [noteFp, gstate, seat, reduceMotion])

  // ---- countdown clock for the active seat's ring (online rooms only) ----
  const deadlineAt = online ? Number(groom?.turn?.deadlineAt) || 0 : 0
  useEffect(() => {
    if (!deadlineAt || !gstate || gstate.phase === 'over') return undefined
    setNow(Date.now())
    const iv = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(iv)
  }, [deadlineAt, gstate])

  // ---- machine seats ----------------------------------------------------
  // The bot decides through src/lib/gameBots.js, which validates every candidate
  // against THIS file's `reduce` before returning it — so a bot seat can only
  // ever submit a move a human sitting there could have made. The delay is not
  // cosmetic: without it the three machine turns resolve inside one frame and
  // the player never sees who moved what.
  useEffect(() => {
    if (online || !local || !local.bots) return undefined
    const st = local.state
    const ts = local.room.turn.seat
    if (!st || st.phase === 'over' || ts === local.youSeat) return undefined
    const t = setTimeout(() => {
      const mv = botMoveFor('ludo', st, ts, { reduce, room: local.room, helpers: botHelpers })
      if (mv) applyLocal(mv)
    }, st.phase === 'roll' ? BOT_DELAY_MS : BOT_DELAY_FAST)
    return () => clearTimeout(t)
  }, [online, local, applyLocal])

  // 1s heartbeat only so the stall button can appear; nothing else polls
  useEffect(() => {
    if (!online || !gstate || gstate.phase === 'over') return undefined
    const iv = setInterval(() => setTick((n) => (n + 1) % 100000), 3000)
    return () => clearInterval(iv)
  }, [online, gstate])

  // absolute score for the hub
  const onScoreRef = useRef(onScore)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => {
    const cb = onScoreRef.current
    if (typeof cb !== 'function' || !gstate || seat < 0) return
    const mine = gstate.tokens[seat] || []
    let sc = 0
    for (let i = 0; i < mine.length; i += 1) {
      const p = mine[i]
      if (p === HOME) sc += 300
      else if (p >= 0) sc += 6 + p * 4
    }
    if (gstate.finished && gstate.finished[0] === seat) sc += 800
    cb(sc)
  }, [fp, gstate, seat])

  // ---- derived view data -------------------------------------------------
  const moves = useMemo(() => {
    if (!gstate || gstate.phase !== 'move' || !myTurn) return []
    return legalMoves(gstate, seat, gstate.die)
  }, [gstate, myTurn, seat])

  const movable = useMemo(() => {
    const m = new Map()
    moves.forEach((o) => m.set(o.token, o))
    return m
  }, [moves])

  // A token the die COULD advance, held back only by an opponent's block (two
  // of their tokens on one square). The rulebook says so; the board never did
  // — and «لم أستطع تحريكه» was reported over exactly this silence, because a
  // block sits on the opponent's entry square, i.e. at the mouth of their
  // house, which is precisely where the owner's token stood. Overshooting the
  // centre is deliberately NOT counted here: that is the player's own count,
  // not an obstacle.
  const blockedTokens = useMemo(() => {
    const out = new Set()
    if (!gstate || gstate.phase !== 'move' || !myTurn) return out
    const d = Number(gstate.die) || 0
    if (d < 1) return out
    const mine = gstate.tokens[seat] || []
    for (let t = 0; t < mine.length; t += 1) {
      if (movable.has(t)) continue
      const from = mine[t]
      if (from === YARD || from === HOME) continue
      const to = from + d
      if (to > LAST_RING) continue // home column: no blocks live there
      const idx = ringIndexOf(seat, to)
      for (let s = 0; s < 4; s += 1) {
        if (s === seat) continue
        if (countOn(gstate, s, idx) >= 2) { out.add(t); break }
      }
    }
    return out
  }, [gstate, myTurn, seat, movable])

  const placed = useMemo(() => {
    if (!gstate) return []
    const list = []
    const slots = {}
    for (let s = 0; s < 4; s += 1) {
      if (seats.length && !seats.includes(s)) continue
      const arr = gstate.tokens[s] || []
      for (let t = 0; t < arr.length; t += 1) {
        // `disp` overrides where a walking / just-captured token is DRAWN;
        // the engine's position stays authoritative for every decision.
        const ov = disp ? disp[`${s}:${t}`] : undefined
        const p = ov !== undefined ? ov : arr[t]
        const base = tokenXY(s, p, t)
        const key = `${Math.round(base.x * 2)}:${Math.round(base.y * 2)}`
        slots[key] = (slots[key] || 0) + 1
        list.push({ s, t, p, base, key, moving: ov !== undefined })
      }
    }
    const groups = {}
    list.forEach((it) => { groups[it.key] = slots[it.key] })
    const seen = {}
    const out = list.map((it) => {
      const n = groups[it.key]
      const i = seen[it.key] || 0
      seen[it.key] = i + 1
      // Co-located tokens used to sit 0.19 apart while each carried a 0.55
      // hit circle — so a token's own centre lay inside every neighbour's tap
      // area and only a ~1px crescent still reached its own handler. The
      // spread now exceeds the visual radius, so discs read as a stack
      // instead of a smear, and the hit circle below is sized to the disc.
      const spread = n > 1 ? 0.25 : 0
      const ang = n > 1 ? (Math.PI * 2 * i) / n - Math.PI / 2 : 0
      return {
        ...it,
        x: it.base.x + Math.cos(ang) * spread,
        y: it.base.y + Math.sin(ang) * spread,
        r: n > 2 ? 0.22 : (n > 1 ? 0.26 : 0.33),
      }
    })
    // SVG paints in document order, so order IS z-order. My own playable
    // tokens must end up on top: otherwise a higher-seat opponent sharing a
    // safe square paints over mine and buries the piece I am being asked to
    // move (seat 0 — the only seat a solo player can hold — sits under all
    // three others, which is why this hit every offline game).
    const rank = (it) => (myTurn && it.s === seat && movable.has(it.t) ? 2 : (it.moving ? 1 : 0))
    out.sort((a, b) => rank(a) - rank(b))
    return out
  }, [gstate, seats, disp, myTurn, seat, movable])

  const stalled = useMemo(() => {
    if (!online || !gstate || gstate.phase === 'over' || myTurn) return false
    const startedAt = Number(groom && groom.turn && groom.turn.startedAt) || 0
    const holder = ((groom && groom.players) || []).find((p) => Number(p.seat) === turnSeat)
    if (!holder || holder.connected === false) return true
    return startedAt > 0 && (Date.now() - startedAt) > STALL_MS
  }, [online, gstate, groom, turnSeat, myTurn, tick])

  const nameOf = useCallback((s) => {
    if (!Number.isInteger(s) || s < 0 || s > 3) return '…'
    const p = ((groom && groom.players) || []).find((x) => Number(x.seat) === s)
    if (p && p.name) return p.name
    return lang === 'en' ? COLORS[s].en : COLORS[s].ar
  }, [groom, lang])

  const onTokenTap = useCallback((s, t) => {
    if (!myTurn || s !== seat) return
    const o = movable.get(t)
    if (!o) return
    submit({ type: 'move', token: t })
  }, [myTurn, seat, movable, submit])

  // ---- auto-move: when there is no real decision, play it after a beat.
  // "No decision" = one legal move, OR several interchangeable ones (four yard
  // tokens all exiting to the same start square are the same move four times).
  // Reduced-motion users still get the auto-play, just as a jump cut.
  //
  // It ANNOUNCES itself now. Silent self-play was the second half of «حرّكت
  // القطعة القريبة ولم تتحرك البعيدة»: when a block killed every other option
  // the board quietly played the one that was left, which reads as the game
  // choosing for you. The fingerprint dep is a scalar on purpose — depending
  // on `gstate`/`moves` object identity restarted this timer on every room
  // snapshot, so in a busy room the move could be postponed indefinitely.
  const [autoPlaying, setAutoPlaying] = useState(false)
  const soleMove = useMemo(() => {
    if (!myTurn || !gstate || gstate.phase !== 'move' || !moves.length) return null
    const distinct = new Set(moves.map((o) => `${o.from}>${o.to}`))
    return distinct.size === 1 ? moves[0].token : null
  }, [myTurn, gstate, moves])
  const autoFp = `${gstate ? gstate.rollCount : ''}:${soleMove}`
  useEffect(() => {
    if (soleMove == null) { setAutoPlaying(false); return undefined }
    setAutoPlaying(true)
    const id = setTimeout(() => submit({ type: 'move', token: soleMove }), 700)
    return () => { clearTimeout(id); setAutoPlaying(false) }
  }, [autoFp]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- a gentle cue when the turn lands on me (never on mount/rehydration)
  const turnSeenRef = useRef(null)
  useEffect(() => {
    if (!gstate || gstate.phase === 'over') return
    if (turnSeenRef.current === null) { turnSeenRef.current = turnSeat; return }
    if (turnSeenRef.current === turnSeat) return
    turnSeenRef.current = turnSeat
    // Hot-seat (same device, no bots) would chime on every handover — noise.
    if (turnSeat === seat && (online || (local && local.bots))) play('turn')
  }, [gstate, turnSeat, seat, online, local])

  // ---- one verdict sound when the round ends
  const overSoundRef = useRef(false)
  useEffect(() => {
    if (!gstate) return
    if (gstate.phase !== 'over') { overSoundRef.current = false; return }
    if (overSoundRef.current) return
    overSoundRef.current = true
    play(gstate.finished && gstate.finished[0] === seat ? 'win' : 'lose')
  }, [gstate, seat])

  // ---- gates -------------------------------------------------------------
  // room exists but the lead has not seeded state yet (still in the lobby)
  if (online && !gstate) {
    return (
      <div className="lud-root lud-center" style={{ '--lud-brand': brand }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="lud-panel">
          <div className="lud-panel-t">{L.wait}</div>
          <p className="lud-panel-p">{L.waitMsg}</p>
          <div className="lud-roster">
            {((groom && groom.players) || []).map((p) => (
              <div className="lud-rchip" key={p.id}>
                <span className="lud-dot" style={{ background: COLORS[clamp4(p.seat)].main }} />
                <span>{p.name || COLORS[clamp4(p.seat)].ar}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!online && !local) {
    return (
      <div className="lud-root lud-center" style={{ '--lud-brand': brand }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="lud-panel">
          <div className="lud-mini-board" aria-hidden="true">
            <span style={{ background: COLORS[0].main }} />
            <span style={{ background: COLORS[1].main }} />
            <span style={{ background: COLORS[3].main }} />
            <span style={{ background: COLORS[2].main }} />
          </div>
          <div className="lud-panel-t">{L.soloTitle}</div>
          <p className="lud-panel-p">{L.soloSub}</p>
          <div className="lud-seg" role="group">
            {[2, 3, 4].map((n) => (
              <button
                type="button"
                key={n}
                className={`lud-segb${setup.count === n ? ' is-on' : ''}`}
                onClick={() => setSetup((s) => ({ ...s, count: n }))}
              >
                {fmt(n)}
              </button>
            ))}
            <span className="lud-seg-l">{L.players}</span>
          </div>
          <div className="lud-seg" role="group">
            <button type="button" className={`lud-segb${setup.bots ? ' is-on' : ''}`} onClick={() => setSetup((s) => ({ ...s, bots: true }))}>{L.vsBots}</button>
            <button type="button" className={`lud-segb${!setup.bots ? ' is-on' : ''}`} onClick={() => setSetup((s) => ({ ...s, bots: false }))}>{L.sameDevice}</button>
          </div>
          <button type="button" className="lud-cta" onClick={() => startLocal({ count: setup.count, bots: setup.bots })}>{L.start}</button>
          <button type="button" className="lud-link" onClick={() => setShowRules(true)}>{L.rules}</button>
        </div>
        {showRules ? <RulesSheet L={L} onClose={() => setShowRules(false)} /> : null}
      </div>
    )
  }

  if (!gstate) return <div className="lud-root lud-center" style={{ '--lud-brand': brand }} />

  const over = gstate.phase === 'over'
  const note = gstate.note || { k: 'start' }
  const noteText = (L.n && L.n[note.k]) || ''
  const turnMsTotal = online ? (Number(groom?.turnMs) || 45000) : 0
  const ringPct = deadlineAt && turnMsTotal && !over
    ? Math.max(0, Math.min(100, ((deadlineAt - (now || Date.now())) / turnMsTotal) * 100))
    : null
  const placings = over
    ? [...gstate.finished, ...seats.filter((s) => !gstate.finished.includes(s))]
    : []
  const initialOf = (nm) => {
    const str = String(nm || '').trim()
    return str ? Array.from(str)[0].toUpperCase() : '·'
  }

  // The four chips sit on the side of the board their yard is on — reds and
  // greens above it, blues and yellows below — so a player looks straight down
  // at their own corner instead of hunting a row of names at the top. It also
  // uses the space a square board leaves on a tall phone, which is what made
  // the screen read as half-empty.
  const topSeats = seats.filter((s) => s === 0 || s === 1)
  const bottomSeats = [3, 2].filter((s) => seats.includes(s))

  const Chip = ({ s }) => {
    const c = COLORS[s]
    const homeN = (gstate.tokens[s] || []).filter((p) => p === HOME).length
    const rank = gstate.finished.indexOf(s)
    const isTurn = turnSeat === s && !over
    return (
      <div
        className={`lud-p${isTurn ? ' is-turn' : ''}${s === seat ? ' is-me' : ''}${rank >= 0 ? ' is-done' : ''}`}
        style={{ '--pc': c.main, '--pd': c.deep }}
      >
        <span className="lud-pavatar">
          <b>{initialOf(nameOf(s))}</b>
          {isTurn && ringPct != null ? (
            <svg className="lud-pring" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="16" pathLength="100" />
              <circle cx="18" cy="18" r="16" pathLength="100" style={{ strokeDashoffset: 100 - ringPct }} />
            </svg>
          ) : null}
        </span>
        <span className="lud-pcol">
          <span className="lud-pname">{nameOf(s)}{s === seat ? ` · ${L.you}` : ''}</span>
          {rank >= 0 ? (
            <span className="lud-pmeta">{`${L.place} ${fmt(rank + 1)}`}</span>
          ) : (
            <span className="lud-pdots" role="img" aria-label={`${fmt(homeN)}/${fmt(4)}`}>
              {[0, 1, 2, 3].map((i) => <i key={i} className={i < homeN ? 'on' : ''} />)}
            </span>
          )}
        </span>
      </div>
    )
  }

  return (
    <div className="lud-root" style={{ '--lud-brand': brand }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="lud-players is-top">
        {topSeats.map((s) => <Chip key={s} s={s} />)}
      </div>

      <div className="lud-stage">
        <div className="lud-boardbox">
          <svg
            className={`lud-board${shake ? ' is-shake' : ''}`}
            viewBox="-0.85 -0.85 16.7 16.7"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={L.soloTitle}
          >
            <defs>
              <radialGradient id="ludGloss" cx="34%" cy="28%" r="72%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
                <stop offset="55%" stopColor="#ffffff" stopOpacity="0.12" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
              </radialGradient>
              <linearGradient id="ludWood" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#8a5a30" />
                <stop offset="28%" stopColor="#6f4523" />
                <stop offset="55%" stopColor="#82552c" />
                <stop offset="80%" stopColor="#5f3a1d" />
                <stop offset="100%" stopColor="#714724" />
              </linearGradient>
              <linearGradient id="ludCell" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fffdf7" />
                <stop offset="100%" stopColor="#ece3cf" />
              </linearGradient>
              <linearGradient id="ludGold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f6df9a" />
                <stop offset="100%" stopColor="#c69f3d" />
              </linearGradient>
              {COLORS.map((c, s) => (
                <linearGradient key={s} id={`ludY${s}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={c.main} />
                  <stop offset="100%" stopColor={c.deep} />
                </linearGradient>
              ))}
            </defs>

            {/* wood frame with a gold pinstripe */}
            <rect x="-0.85" y="-0.85" width="16.7" height="16.7" rx="1.05" fill="url(#ludWood)" />
            <rect x="-0.62" y="-0.62" width="16.24" height="16.24" rx="0.9" fill="none" stroke="rgba(46,26,10,.5)" strokeWidth="0.1" />
            <rect x="-0.34" y="-0.34" width="15.68" height="15.68" rx="0.7" fill="none" stroke="rgba(231,196,106,.55)" strokeWidth="0.07" />

            {/* board base */}
            <rect x="0" y="0" width="15" height="15" rx="0.45" fill="#f3ecdb" />

            {/* yards: colour panel, cream inner court, four token sockets */}
            {[0, 1, 2, 3].map((s) => {
              const [r, c] = YARD_AT[s]
              const dim = seats.length && !seats.includes(s)
              return (
                <g key={`y${s}`} opacity={dim ? 0.26 : 1}>
                  <rect x={c} y={r} width="6" height="6" rx="0.55" fill={`url(#ludY${s})`} />
                  <rect x={c + 0.16} y={r + 0.16} width="5.68" height="5.68" rx="0.45" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="0.09" />
                  <rect x={c + 0.75} y={r + 0.75} width="4.5" height="4.5" rx="0.4" fill="#faf5e9" />
                  <rect x={c + 0.75} y={r + 0.75} width="4.5" height="4.5" rx="0.4" fill={COLORS[s].soft} opacity="0.55" />
                  {[[2, 2], [4, 2], [2, 4], [4, 4]].map(([dx, dy], k) => (
                    <g key={k}>
                      <circle cx={c + dx} cy={r + dy} r="0.5" fill="rgba(37,26,12,0.1)" />
                      <circle cx={c + dx} cy={r + dy} r="0.5" fill="none" stroke={COLORS[s].main} strokeOpacity="0.5" strokeWidth="0.07" />
                    </g>
                  ))}
                </g>
              )
            })}

            {/* ring: soft-depth cells; each colour's entry square wears its colour */}
            {RING.map(([r, c], i) => {
              const owner = START.indexOf(i)
              return (
                <rect
                  key={`r${i}`}
                  x={c} y={r} width="1" height="1"
                  fill={owner >= 0 ? COLORS[owner].main : 'url(#ludCell)'}
                  opacity={owner >= 0 ? 0.92 : 1}
                  stroke="rgba(88,68,44,.3)"
                  strokeWidth="0.042"
                />
              )
            })}

            {/* safe squares: white star on the entries, gold star on the free stars */}
            {START.map((i, s) => {
              const [r, c] = RING[i]
              return (
                <polygon
                  key={`e${s}`}
                  points={starPoints(c + 0.5, r + 0.5, 0.3)}
                  fill="#ffffff"
                  opacity="0.9"
                />
              )
            })}
            {STAR.map((i) => {
              const [r, c] = RING[i]
              return (
                <polygon
                  key={`s${i}`}
                  points={starPoints(c + 0.5, r + 0.5, 0.34)}
                  fill="url(#ludGold)"
                  stroke="rgba(122,90,34,.55)"
                  strokeWidth="0.035"
                />
              )
            })}

            {/* home columns */}
            {[0, 1, 2, 3].map((s) => {
              const dim = seats.length && !seats.includes(s)
              return (
                <g key={`h${s}`} opacity={dim ? 0.3 : 1}>
                  {HOME_COL[s].map(([r, c], k) => (
                    <rect key={k} x={c} y={r} width="1" height="1" fill={COLORS[s].main} stroke="rgba(255,255,255,.55)" strokeWidth="0.05" />
                  ))}
                </g>
              )
            })}

            {/* centre home: four colour triangles under a gold star */}
            <polygon points="6,6 9,6 7.5,7.5" fill={COLORS[1].main} />
            <polygon points="9,6 9,9 7.5,7.5" fill={COLORS[2].main} />
            <polygon points="6,9 9,9 7.5,7.5" fill={COLORS[3].main} />
            <polygon points="6,6 6,9 7.5,7.5" fill={COLORS[0].main} />
            <rect x="6" y="6" width="3" height="3" fill="none" stroke="rgba(24,32,42,.3)" strokeWidth="0.06" />
            <circle cx="7.5" cy="7.5" r="0.62" fill="rgba(255,255,255,0.16)" />
            <polygon points={starPoints(7.5, 7.5, 0.5)} fill="url(#ludGold)" stroke="rgba(122,90,34,.6)" strokeWidth="0.04" />

            {/* legal destination highlights */}
            {moves.map((o) => {
              const q = tokenXY(seat, o.to, 0)
              return (
                <circle
                  key={`d${o.token}`}
                  className="lud-target"
                  cx={q.x} cy={q.y} r="0.42"
                  fill="none"
                  stroke={COLORS[seat] ? COLORS[seat].deep : '#111'}
                  strokeWidth="0.11"
                />
              )
            })}

            {/* tokens: glossy discs with a grounding shadow; the movable ones
                breathe and carry an enlarged invisible hit circle */}
            {placed.map((it) => {
              const c = COLORS[it.s]
              const can = myTurn && it.s === seat && movable.has(it.t)
              const blocked = myTurn && it.s === seat && blockedTokens.has(it.t)
              const fly = flying && flying.has(`${it.s}:${it.t}`)
              return (
                <g
                  key={`t${it.s}-${it.t}`}
                  className={`lud-tok${can ? ' is-live' : ''}${it.moving ? ' is-step' : ''}${fly ? ' is-fly' : ''}`}
                  // SVG ATTRIBUTE, never a CSS px transform: iOS Safari does
                  // not resolve CSS pixels into this viewBox's user units, so
                  // the px form piled every token into the board's corner and
                  // the owner's iPhone showed an empty board with only the
                  // sockets painted. Unitless attribute = identical in every
                  // engine, and the CSS transitions still ride it.
                  transform={`translate(${it.x.toFixed(3)} ${it.y.toFixed(3)})`}
                  // Only a token the player may actually move is a tap target.
                  // Everything else is inert, so no opponent disc — and no
                  // frozen token of my own — can swallow the tap aimed at the
                  // piece underneath it.
                  style={{ pointerEvents: can ? 'auto' : 'none' }}
                  onPointerDown={can ? (e) => { e.preventDefault(); onTokenTap(it.s, it.t) } : undefined}
                >
                  {/* NO SVG FILTER ON THE PIECE. `filter="url(#ludShadow)"`
                      wrapped these four circles and WebKit rendered NOTHING
                      for the filtered group — the ground ellipse below (no
                      filter) still painted, which is exactly the owner's
                      «تظهر ظلال فقط»: an iPhone board of empty sockets and
                      floating shadows. Proven by removing the attribute live
                      in a WebKit page, where all eight discs appeared at
                      once. The depth is drawn instead: a grounded ellipse, a
                      dark base ring, the body, a gloss and a highlight — same
                      look, no filter, and cheaper on a phone. */}
                  <ellipse cx="0" cy={it.r * 0.58} rx={it.r * 0.95} ry={it.r * 0.34} fill="rgba(8,12,18,0.34)" />
                  <circle r={it.r} fill={c.deep} />
                  <circle r={it.r * 0.92} cy={-it.r * 0.09} fill={c.main} />
                  <circle r={it.r * 0.92} cy={-it.r * 0.09} fill="url(#ludGloss)" />
                  <circle r={it.r * 0.36} cy={-it.r * 0.24} fill="#ffffff" opacity="0.92" />
                  {can ? <circle className="lud-halo" r={it.r + 0.15} fill="none" stroke="#f3d98b" strokeWidth="0.09" /> : null}
                  {can ? <circle className="lud-ping" r={it.r + 0.14} fill="none" stroke={c.deep} strokeWidth="0.07" /> : null}
                  {/* the rulebook's block, drawn: a barred ring says the square
                      ahead is held, instead of the piece silently going dead */}
                  {blocked ? (
                    <g className="lud-blocked">
                      <circle r={it.r + 0.12} fill="none" stroke="#2b3542" strokeWidth="0.08" strokeDasharray="0.16 0.12" opacity="0.85" />
                      <path d={`M${-it.r * 0.5} ${-it.r * 0.5} L${it.r * 0.5} ${it.r * 0.5}`} stroke="#141a22" strokeWidth="0.09" strokeLinecap="round" opacity="0.7" />
                    </g>
                  ) : null}
                  {/* the tap target is the CELL, not a circle wider than it:
                      a full cell is the largest area that cannot reach into a
                      neighbour's square, and it only exists on live tokens */}
                  {can ? <circle r="0.48" fill="transparent" /> : null}
                </g>
              )
            })}

            {/* THE DIE SITS IN FRONT OF ITS OWNER — one per seat, resting in
                the middle of that player's own yard («يجب أن يكون الزهر أمام
                كل شخص»). The seat on turn holds the live die: it is the only
                tappable one, it tumbles, and it wears its owner's colour. The
                other three rest dim, showing the face each last rolled, so the
                table reads like four people sitting around a board rather
                than one shared die in a toolbar. */}
            {seats.map((s) => {
              const [r, c] = YARD_AT[s]
              const cx = c + 3
              const cy = r + 3
              const live = turnSeat === s && gstate.phase === 'roll' && !over
              const mineLive = live && s === seat && !busy
              // only the seat holding the turn shows a face; the rest rest empty
              const face = turnSeat === s ? (dieShow ?? gstate.lastDie) : null
              const spin = turnSeat === s && tumbling
              return (
                <g
                  key={`die${s}`}
                  className={`lud-seatdie${live ? ' is-live' : ''}${spin ? ' is-roll' : ''}${s === seat ? ' is-mine' : ''}`}
                  transform={`translate(${cx} ${cy})`}
                  style={{ pointerEvents: mineLive ? 'auto' : 'none' }}
                  onPointerDown={mineLive ? (e) => { e.preventDefault(); submit({ type: 'roll' }) } : undefined}
                  role={mineLive ? 'button' : undefined}
                  aria-label={mineLive ? L.roll : undefined}
                >
                  <rect x="-0.62" y="-0.55" width="1.24" height="1.24" rx="0.3" fill="rgba(12,18,26,0.26)" />
                  <rect x="-0.62" y="-0.62" width="1.24" height="1.24" rx="0.3" fill="#fdfdfb" stroke={COLORS[s].deep} strokeWidth="0.07" />
                  <rect x="-0.5" y="-0.5" width="1" height="1" rx="0.22" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="0.05" />
                  {(PIPS[face] || []).map(([dx, dy], i) => (
                    <circle key={i} cx={dx * 0.28} cy={dy * 0.28} r="0.11" fill="#17202b" />
                  ))}
                  {!face ? <circle r="0.09" fill="rgba(23,32,43,.22)" /> : null}
                  {mineLive ? <circle className="lud-diehalo" r="0.86" fill="none" stroke="#f3d98b" strokeWidth="0.08" /> : null}
                </g>
              )
            })}

            {/* transient effects: capture ring burst, home star pop */}
            {fx.map((f) => (f.kind === 'burst' ? (
              <g key={f.id} className="lud-fxg" transform={`translate(${f.x.toFixed(3)} ${f.y.toFixed(3)})`}>
                <circle className="lud-fx-ring" r="0.3" fill="none" stroke={f.color} strokeWidth="0.11" />
                <circle className="lud-fx-ring lud-fx-ring2" r="0.3" fill="none" stroke="#f3d98b" strokeWidth="0.07" />
              </g>
            ) : (
              <g key={f.id} className="lud-fxg" transform={`translate(${f.x.toFixed(3)} ${f.y.toFixed(3)})`}>
                <polygon className="lud-fx-star" points={starPoints(0, 0, 0.62)} fill="url(#ludGold)" stroke="rgba(122,90,34,.5)" strokeWidth="0.04" />
              </g>
            )))}
          </svg>
        </div>
      </div>

      <div className="lud-players is-bottom">
        {bottomSeats.map((s) => <Chip key={s} s={s} />)}
      </div>

      <div className="lud-bar">
        <div className="lud-turn">
          <span className="lud-dot" style={{ background: turnSeat >= 0 && COLORS[turnSeat] ? COLORS[turnSeat].main : '#999' }} />
          <span className="lud-turn-t">
            {over
              ? `${L.winner}: ${nameOf(gstate.finished[0])}`
              : (myTurn ? L.turnYou : `${L.turnOf} ${nameOf(turnSeat)}`)}
          </span>
          {/* the hint always states what is happening NOW, in priority order:
              the board playing for me, a block holding a piece back, then the
              plain prompt. A rule that removes an option has to say so. */}
          <span className="lud-note">
            {autoPlaying
              ? L.autoPlay
              : (gstate.phase === 'move' && myTurn
                ? (blockedTokens.size ? L.blockedHint : L.pick)
                : noteText)}
          </span>
        </div>

        <div className="lud-actions">
          {stalled ? (
            <button type="button" className="lud-ghost" onClick={() => submit({ type: 'forceSkip' })}>{L.skip}</button>
          ) : null}
          {!over ? (
            <button
              type="button"
              className={`lud-rollbtn${myTurn && gstate.phase === 'roll' ? ' is-on' : ''}`}
              disabled={!myTurn || gstate.phase !== 'roll' || busy}
              onClick={() => submit({ type: 'roll' })}
              aria-label={L.roll}
            >
              <Die value={dieShow ?? gstate.lastDie} spinning={tumbling} />
              <span>{busy ? L.rolling : L.roll}</span>
            </button>
          ) : null}
          <button type="button" className="lud-ghost" onClick={() => setShowRules(true)}>{L.rules}</button>
        </div>
      </div>

      {/* round-over celebration: placings in seat colours, the winner crowned.
          Online rematches need a fresh room (applyMove rejects an ended room),
          so the hub owns that button — only local mode resets here. */}
      {over ? (
        <div className="lud-over" role="dialog" aria-modal="true" aria-label={L.winner}>
          <div className="lud-over-card">
            <svg className="lud-crown" viewBox="0 0 48 34" aria-hidden="true">
              <defs>
                <linearGradient id="ludCrownG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f6df9a" />
                  <stop offset="100%" stopColor="#c69f3d" />
                </linearGradient>
              </defs>
              <path d="M6 25 L3.4 8.5 L15 16 L24 3.6 L33 16 L44.6 8.5 L42 25 Z" fill="url(#ludCrownG)" stroke="rgba(122,90,34,.6)" strokeWidth="1" strokeLinejoin="round" />
              <rect x="6.4" y="26.6" width="35.2" height="4.4" rx="1.6" fill="url(#ludCrownG)" stroke="rgba(122,90,34,.5)" strokeWidth="0.8" />
              <circle cx="3.4" cy="7.4" r="1.9" fill="url(#ludCrownG)" />
              <circle cx="24" cy="2.6" r="1.9" fill="url(#ludCrownG)" />
              <circle cx="44.6" cy="7.4" r="1.9" fill="url(#ludCrownG)" />
            </svg>
            <div className="lud-over-w">{nameOf(gstate.finished[0])}</div>
            <div className="lud-over-sub">{L.winner}</div>
            <ol className="lud-places">
              {placings.map((s, i) => (
                <li key={s} className={s === seat ? 'is-me' : ''} style={{ '--pc': COLORS[s].main }}>
                  <b>{fmt(i + 1)}</b>
                  <span className="lud-place-dot" />
                  <span className="lud-place-nm">{nameOf(s)}</span>
                  {gstate.finished.includes(s) ? <span className="lud-place-ok">{L.home}</span> : null}
                </li>
              ))}
            </ol>
            {!online ? (
              <button type="button" className="lud-cta lud-cta-sm" onClick={() => setLocal(null)}>{L.again}</button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showRules ? <RulesSheet L={L} onClose={() => setShowRules(false)} /> : null}
    </div>
  )
}

function RulesSheet({ L, onClose }) {
  return (
    <div className="lud-sheet" role="dialog" aria-modal="true">
      <div className="lud-sheet-in">
        <div className="lud-sheet-t">{L.rules}</div>
        <div className="lud-sheet-body">
          {RULES_AR.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        <button type="button" className="lud-cta lud-cta-sm" onClick={onClose}>{L.close}</button>
      </div>
    </div>
  )
}
