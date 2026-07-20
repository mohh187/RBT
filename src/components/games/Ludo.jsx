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
    return { state: st }
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
    return { state: st, turn: turnAt(extra ? seat : nextSeat(seats, st, seat)) }
  }

  return { state }
}

export const RULES_AR = [
  'الهدف: أوصِل قطعك الأربع إلى مركز اللوح قبل بقية اللاعبين.',
  'الخروج: لا تخرج القطعة من البيت إلا برمية 6.',
  'الستّة: كل 6 تمنحك رمية إضافية، لكن 3 ستّات متتالية تُسقط دورك كاملاً (قاعدة منع التعطيل المعتمدة).',
  'الأكل: النزول بالضبط على قطعة خصم يعيدها إلى بيتها، ويمنحك رمية إضافية.',
  'الأمان: مربعات النجمة ومربع انطلاق كل لون آمنة — لا تُؤكل فيها قطعة، وتتشارك فيها الألوان.',
  'الحاجز: قطعتان من لونك على مربع واحد تكوّنان حاجزاً لا يستطيع الخصم النزول عليه. المرور فوقه مسموح — هذه هي النسخة الأكثر انتشاراً من اللودو.',
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
    vsBots: 'ضد الحاسوب',
    sameDevice: 'على نفس الجهاز',
    players: 'لاعبون',
    start: 'ابدأ',
    you: 'أنت',
    bot: 'حاسوب',
    place: 'المركز',
    winner: 'الفائز',
    n: {
      start: 'ابدأ برمية الزهر.',
      rolled: 'اختر القطعة التي تتحرك.',
      noMove: 'لا توجد حركة قانونية — انتقل الدور.',
      threeSixes: 'ثلاث ستّات متتالية — سقط الدور.',
      skipped: 'تم تخطي دور لاعب متوقف.',
      moved: 'تحركت القطعة.',
      captured: 'أكل قطعة خصم — رمية إضافية.',
      homed: 'وصلت قطعة إلى المركز — رمية إضافية.',
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
    bot: 'Bot',
    place: 'Place',
    winner: 'Winner',
    n: {
      start: 'Roll to begin.',
      rolled: 'Choose a token to move.',
      noMove: 'No legal move — turn passes.',
      threeSixes: 'Three sixes in a row — turn forfeited.',
      skipped: 'A stalled player was skipped.',
      moved: 'Token moved.',
      captured: 'Captured — extra roll.',
      homed: 'Token home — extra roll.',
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

// A deliberately simple, honest bot: it plays through the SAME reduce, so it
// cannot do anything a human could not. Priority: finish > capture > leave the
// yard > enter the home column > push the most advanced token.
function botPick(st, seat, opts) {
  let best = null
  let bestScore = -1
  for (let i = 0; i < opts.length; i += 1) {
    const o = opts[i]
    let sc
    if (o.to === HOME) sc = 100
    else if (capturesAt(st, seat, o.to)) sc = 90
    else if (o.from === YARD) sc = 62
    else if (o.to >= COL_FIRST) sc = 56
    else sc = 10 + o.to * 0.4 + (SAFE.has(ringIndexOf(seat, o.to)) ? 6 : 0)
    if (sc > bestScore) { bestScore = sc; best = o }
  }
  return best
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
}) {
  const L = T[lang === 'en' ? 'en' : 'ar']
  const online = !!(room && room.roomId)

  const [local, setLocal] = useState(null)      // { room, state, youSeat, bots }
  const [setup, setSetup] = useState({ count: 4, bots: true })
  const [showRules, setShowRules] = useState(false)
  const [busy, setBusy] = useState(false)
  const [spin, setSpin] = useState(false)
  const [tick, setTick] = useState(0)

  const gstate = online ? (room.state || null) : (local ? local.state : null)
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

  const startLocal = useCallback(() => {
    const n = Math.max(2, Math.min(4, setup.count))
    const st = initialState(n)
    st.seats = Array.from({ length: n }, (_, i) => i)
    const players = st.seats.map((s) => ({
      id: `local-${s}`,
      name: s === 0 ? (playerName || L.you) : (setup.bots ? `${L.bot} ${fmt(s)}` : `${L.players} ${fmt(s + 1)}`),
      seat: s,
      connected: true,
      score: 0,
    }))
    setLocal({
      bots: setup.bots,
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
  }, [setup, playerName, L])

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

  // die shake on every new roll
  const rollFp = gstate ? `${gstate.rollCount}` : ''
  useEffect(() => {
    if (!rollFp || rollFp === '0') return undefined
    setSpin(true)
    const t = setTimeout(() => setSpin(false), 460)
    return () => clearTimeout(t)
  }, [rollFp])

  // bots
  useEffect(() => {
    if (online || !local || !local.bots) return undefined
    const st = local.state
    const ts = local.room.turn.seat
    if (!st || st.phase === 'over' || ts === local.youSeat) return undefined
    const t = setTimeout(() => {
      if (st.phase === 'roll') applyLocal({ type: 'roll', seat: ts })
      else if (st.phase === 'move') {
        const pick = botPick(st, ts, legalMoves(st, ts, st.die))
        if (pick) applyLocal({ type: 'move', token: pick.token, seat: ts })
      }
    }, st.phase === 'roll' ? 640 : 540)
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

  const placed = useMemo(() => {
    if (!gstate) return []
    const list = []
    const slots = {}
    for (let s = 0; s < 4; s += 1) {
      if (seats.length && !seats.includes(s)) continue
      const arr = gstate.tokens[s] || []
      for (let t = 0; t < arr.length; t += 1) {
        const p = arr[t]
        const base = tokenXY(s, p, t)
        const key = `${Math.round(base.x * 2)}:${Math.round(base.y * 2)}`
        slots[key] = (slots[key] || 0) + 1
        list.push({ s, t, p, base, key })
      }
    }
    const groups = {}
    list.forEach((it) => { groups[it.key] = slots[it.key] })
    const seen = {}
    return list.map((it) => {
      const n = groups[it.key]
      const i = seen[it.key] || 0
      seen[it.key] = i + 1
      const spread = n > 1 ? 0.19 : 0
      const ang = n > 1 ? (Math.PI * 2 * i) / n - Math.PI / 2 : 0
      return {
        ...it,
        x: it.base.x + Math.cos(ang) * spread,
        y: it.base.y + Math.sin(ang) * spread,
        r: n > 2 ? 0.26 : (n > 1 ? 0.29 : 0.33),
      }
    })
  }, [gstate, seats])

  const stalled = useMemo(() => {
    if (!online || !gstate || gstate.phase === 'over' || myTurn) return false
    const startedAt = Number(groom && groom.turn && groom.turn.startedAt) || 0
    const holder = ((groom && groom.players) || []).find((p) => Number(p.seat) === turnSeat)
    if (!holder || holder.connected === false) return true
    return startedAt > 0 && (Date.now() - startedAt) > STALL_MS
  }, [online, gstate, groom, turnSeat, myTurn, tick])

  const nameOf = useCallback((s) => {
    if (!Number.isInteger(s) || s < 0 || s > 3) return '—'
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
          <button type="button" className="lud-cta" onClick={startLocal}>{L.start}</button>
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

  return (
    <div className="lud-root" style={{ '--lud-brand': brand }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="lud-players">
        {seats.map((s) => {
          const c = COLORS[s]
          const homeN = (gstate.tokens[s] || []).filter((p) => p === HOME).length
          const rank = gstate.finished.indexOf(s)
          return (
            <div
              key={s}
              className={`lud-p${turnSeat === s && !over ? ' is-turn' : ''}${s === seat ? ' is-me' : ''}`}
              style={{ '--pc': c.main, '--pd': c.deep }}
            >
              <span className="lud-pavatar"><span /></span>
              <span className="lud-pname">{nameOf(s)}</span>
              <span className="lud-pmeta">
                {rank >= 0 ? `${L.place} ${fmt(rank + 1)}` : `${fmt(homeN)}/${fmt(4)}`}
              </span>
            </div>
          )
        })}
      </div>

      <div className="lud-stage">
        <div className="lud-boardbox">
          <svg className="lud-board" viewBox="0 0 15 15" preserveAspectRatio="xMidYMid meet" role="img" aria-label={L.soloTitle}>
            <defs>
              <filter id="ludShadow" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="0.07" stdDeviation="0.055" floodColor="#0b1218" floodOpacity="0.5" />
              </filter>
              <radialGradient id="ludGloss" cx="34%" cy="28%" r="72%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
                <stop offset="55%" stopColor="#ffffff" stopOpacity="0.12" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
              </radialGradient>
            </defs>

            <rect x="0" y="0" width="15" height="15" rx="0.7" fill="#f7f4ee" />

            {/* yards */}
            {[0, 1, 2, 3].map((s) => {
              const [r, c] = YARD_AT[s]
              const dim = seats.length && !seats.includes(s)
              return (
                <g key={`y${s}`} opacity={dim ? 0.28 : 1}>
                  <rect x={c} y={r} width="6" height="6" rx="0.6" fill={COLORS[s].main} />
                  <rect x={c + 0.9} y={r + 0.9} width="4.2" height="4.2" rx="0.45" fill="#fbfaf7" />
                </g>
              )
            })}

            {/* ring */}
            {RING.map(([r, c], i) => {
              let fill = '#ffffff'
              const owner = START.indexOf(i)
              if (owner >= 0) fill = COLORS[owner].soft
              return (
                <rect
                  key={`r${i}`}
                  x={c} y={r} width="1" height="1"
                  fill={fill}
                  stroke="rgba(24,32,42,.2)"
                  strokeWidth="0.045"
                />
              )
            })}

            {/* entry arrows + safe stars */}
            {START.map((i, s) => {
              const [r, c] = RING[i]
              return (
                <polygon
                  key={`e${s}`}
                  points={starPoints(c + 0.5, r + 0.5, 0.33)}
                  fill={COLORS[s].main}
                  opacity="0.5"
                />
              )
            })}
            {STAR.map((i) => {
              const [r, c] = RING[i]
              return <polygon key={`s${i}`} points={starPoints(c + 0.5, r + 0.5, 0.34)} fill="rgba(28,38,50,.3)" />
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

            {/* centre */}
            <polygon points="6,6 9,6 7.5,7.5" fill={COLORS[1].main} />
            <polygon points="9,6 9,9 7.5,7.5" fill={COLORS[2].main} />
            <polygon points="6,9 9,9 7.5,7.5" fill={COLORS[3].main} />
            <polygon points="6,6 6,9 7.5,7.5" fill={COLORS[0].main} />
            <rect x="6" y="6" width="3" height="3" fill="none" stroke="rgba(24,32,42,.28)" strokeWidth="0.06" />

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

            {/* tokens */}
            {placed.map((it) => {
              const c = COLORS[it.s]
              const can = myTurn && it.s === seat && movable.has(it.t)
              return (
                <g
                  key={`t${it.s}-${it.t}`}
                  className={`lud-tok${can ? ' is-live' : ''}`}
                  style={{ transform: `translate(${it.x}px, ${it.y}px)` }}
                  onPointerDown={can ? (e) => { e.preventDefault(); onTokenTap(it.s, it.t) } : undefined}
                >
                  <g filter="url(#ludShadow)">
                    <circle r={it.r} fill={c.main} stroke={c.deep} strokeWidth="0.075" />
                    <circle r={it.r} fill="url(#ludGloss)" />
                    <circle r={it.r * 0.42} fill="#ffffff" opacity="0.9" />
                  </g>
                  {can ? <circle className="lud-ping" r={it.r + 0.14} fill="none" stroke={c.deep} strokeWidth="0.08" /> : null}
                </g>
              )
            })}
          </svg>
        </div>
      </div>

      <div className="lud-bar">
        <div className="lud-turn">
          <span className="lud-dot" style={{ background: turnSeat >= 0 ? COLORS[turnSeat].main : '#999' }} />
          <span className="lud-turn-t">
            {over
              ? `${L.winner}: ${gstate.finished.length ? nameOf(gstate.finished[0]) : '—'}`
              : (myTurn ? L.turnYou : `${L.turnOf} ${nameOf(turnSeat)}`)}
          </span>
          <span className="lud-note">{gstate.phase === 'move' && myTurn ? L.pick : noteText}</span>
        </div>

        <div className="lud-actions">
          {stalled ? (
            <button type="button" className="lud-ghost" onClick={() => submit({ type: 'forceSkip' })}>{L.skip}</button>
          ) : null}
          {over ? (
            // Online rematches need a fresh room (applyMove rejects an ended
            // room), so the hub owns that button — only local mode resets here.
            !online ? (
              <button type="button" className="lud-cta lud-cta-sm" onClick={() => setLocal(null)}>{L.again}</button>
            ) : null
          ) : (
            <button
              type="button"
              className={`lud-rollbtn${myTurn && gstate.phase === 'roll' ? ' is-on' : ''}`}
              disabled={!myTurn || gstate.phase !== 'roll' || busy}
              onClick={() => submit({ type: 'roll' })}
              aria-label={L.roll}
            >
              <Die value={gstate.lastDie} spinning={spin} />
              <span>{busy ? L.rolling : L.roll}</span>
            </button>
          )}
          <button type="button" className="lud-ghost" onClick={() => setShowRules(true)}>{L.rules}</button>
        </div>
      </div>

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
