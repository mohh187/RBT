// «الجكارو» — Jackaroo: the marbles-and-cards partnership board game.
//
// ===========================================================================
// WHICH VARIANT THIS FILE IMPLEMENTS  (read this before changing any rule)
// ===========================================================================
// Jackaroo is a Pachisi/Tock cousin and every majlis has its own house rules —
// board size, whether an 8 goes backwards, whether a joker is in the pack.
// Mixing those produces a game nobody plays, so this file implements ONE
// coherent, commonly played ruleset end to end and names its choices.
//
// THE RULESET IMPLEMENTED HERE
//   • 4 players, fixed partnerships, partners opposite: seats 0+2 vs 1+3.
//     Play runs counter-clockwise; on screen you always sit at the bottom.
//   • BOARD: one shared loop of 72 squares, 18 along each player's side. Your
//     start square is the middle of your own side. Behind it sits your base
//     (البيت) holding your 4 marbles, and inward from it runs your private
//     4-square finish lane (الخانة).
//   • CARDS: two full 52-card packs shuffled together, 104 cards, NO jokers.
//     Four cards are dealt to each player; when all four hands are empty the
//     next four are dealt, reshuffling both packs when fewer than 16 remain.
//   • CARD POWERS
//       A  — release a marble from base onto your start square, or move 1
//       K  — release a marble from base onto your start square, or move 13
//       Q  — move 12
//       J  — swap one of your marbles on the loop with any other marble on
//            the loop (yours, your partner's or an opponent's)
//       10 — move 10
//       8  — move 8
//       7  — move 7, and it MAY be split across exactly two of your marbles
//       4  — move 4 BACKWARDS
//       2 3 5 6 9 — move that many forward
//   • Landing on any marble — opponent, partner or your own — sends it back
//     to its base. Passing over marbles on the loop is free.
//   • FINISH LANE: a marble that has travelled a full lap of 72 from its own
//     start turns into its lane. The count must be exact — you may not
//     overshoot past the fourth slot, and you may not jump a marble already
//     parked in the lane.
//   • PARTNER HELP: once all four of your own marbles are in your lane, your
//     cards move your PARTNER's marbles instead.
//   • A card that has no legal move may be discarded; a card that has one
//     must be played.
//   • The first partnership with all 8 marbles in their lanes wins.
//
// WHERE OTHER TABLES DIFFER (deliberately NOT implemented, listed for honesty)
//   • Many tables add 2 jokers that move a marble to any square or kill any
//     marble. Not implemented — no jokers in the pack here.
//   • Some tables play 8 as a backward move, or J as "move 11 or swap", or
//     give the Ace a choice of 1 or 11. Here 8 is forward, J is swap only,
//     and A is release-or-1.
//   • Some tables protect a marble sitting on its own start square so it can
//     be neither killed nor passed. Not implemented — nothing is protected.
//   • Some tables forbid landing on your own or your partner's marble. Here
//     landing sends ANY marble home, which is the more common reading.
//   • Some tables deal 5 cards on the first round. Here every round is 4.
//   • Board sizes of 16 or 20 squares per side exist. Here it is 18.
//
// ===========================================================================
// ARCHITECTURE
// ===========================================================================
// The rulebook lives in `reduce(state, move, room)`, a total pure function:
// an illegal or out-of-turn move returns the state untouched. The move a
// client submits is only a DESCRIPTOR ("step marble 2 by five"); reduce
// re-runs it through the same engine and rejects it if it does not hold on
// the freshest state, so a tampered client cannot force an illegal move.
// The component never writes to Firestore — it calls `onMove(move)`.
//
// Randomness: `reduce` stays pure, so shuffles are never Math.random. Every
// move carries a `seed`, used only on the deal that needs a reshuffle.
//
// MARBLE ENCODING (one integer, so the room document stays small)
//   900        -> in base
//   -71 .. 71  -> on the loop, counted as distance from its OWNER's start
//                 (negative means it has been knocked back behind its start
//                  by a 4 and still owes those squares before it can lap)
//   100 .. 103 -> parked in finish-lane slot 0..3
//
// KNOWN LIMITATION (flagged for the lead, not fixable from inside this file):
// hands and the undealt deck live in room.state, which every player in the
// room can read. The UI never shows them, but the network payload does.
// Hiding them needs per-seat subcollections plus rules, outside this file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '../../styles/cardgames.css'

// ---------------------------------------------------------------------------
// board constants
// ---------------------------------------------------------------------------
const TRACK = 72
const PER = 18
const LANE = 4
const BASE = 900
const L0 = 100

const SUITS = ['S', 'H', 'D', 'C']
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
const RED = { H: true, D: true }

const nx = (s) => (s + 1) % 4
const team = (s) => s % 2
const partnerOf = (s) => (s + 2) % 4
const startOf = (o) => o * PER + 9

const isBase = (p) => p >= BASE
const isLane = (p) => p >= L0 && p < L0 + LANE
const isTrack = (p) => p > -TRACK && p < TRACK
const toQ = (p) => (isLane(p) ? TRACK + (p - L0) : p)
const fromQ = (q) => (q >= TRACK ? L0 + (q - TRACK) : q)
const cellOf = (o, p) => (((startOf(o) + p) % TRACK) + TRACK) % TRACK

const rankOf = (c) => String(c || '').charAt(0)
const suitOf = (c) => String(c || '').charAt(1)
const RANK_LABEL = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }
const label = (c) => RANK_LABEL[rankOf(c)] || rankOf(c)
const canRelease = (c) => rankOf(c) === 'A' || rankOf(c) === 'K'

// forward steps a card is worth; null means it is not a plain step card
function stepsOf(card) {
  const r = rankOf(card)
  if (r === 'A') return 1
  if (r === 'K') return 13
  if (r === 'Q') return 12
  if (r === 'T') return 10
  if (r === 'J') return null
  if (r === '7') return null
  if (r === '4') return -4
  const n = Number(r)
  return Number.isFinite(n) && n >= 2 && n <= 9 ? n : null
}

function prng(seed) {
  let a = (Number(seed) >>> 0) || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// two full packs, no jokers
function freshDeck(seed) {
  const deck = []
  for (let d = 0; d < 2; d += 1) for (const s of SUITS) for (const r of RANKS) deck.push(r + s)
  const rnd = prng(seed)
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1))
    const t = deck[i]
    deck[i] = deck[j]
    deck[j] = t
  }
  return deck
}

// ---------------------------------------------------------------------------
// the move engine — every function is pure and returns null for an illegal move
// ---------------------------------------------------------------------------
const clone = (marbles) => marbles.map((row) => [...row])

function killOn(next, marbles, cell, skipO, skipM) {
  const kills = []
  for (let o = 0; o < 4; o += 1) {
    for (let j = 0; j < 4; j += 1) {
      if (o === skipO && j === skipM) continue
      const x = marbles[o][j]
      if (isTrack(x) && cellOf(o, x) === cell) {
        next[o][j] = BASE
        kills.push({ o, j })
      }
    }
  }
  return kills
}

// release a marble from base onto its owner's start square
function release(marbles, owner, m) {
  if (!Number.isInteger(m) || m < 0 || m > 3) return null
  const p = marbles[owner][m]
  if (!isBase(p)) return null
  const next = clone(marbles)
  next[owner][m] = 0
  const kills = killOn(next, marbles, startOf(owner), owner, m)
  return { marbles: next, kills }
}

// step a marble n squares (n < 0 is the backward 4)
function step(marbles, owner, m, n) {
  if (!Number.isInteger(m) || m < 0 || m > 3) return null
  if (!Number.isInteger(n) || n === 0) return null
  const p = marbles[owner][m]
  if (isBase(p)) return null
  const q = toQ(p)
  const q2 = q + n

  if (n < 0) {
    if (q >= TRACK) return null // a marble in the lane never comes back out
    if (q2 <= -TRACK) return null // never more than one lap behind its start
  } else if (q2 > TRACK + LANE - 1) {
    return null // overshooting past the last lane slot is not a move
  }

  // inside the lane nothing may be jumped, and the target slot must be free
  if (q2 >= TRACK) {
    for (let k = Math.max(TRACK, q + 1); k <= q2; k += 1) {
      const blocked = marbles[owner].some((x, j) => j !== m && isLane(x) && toQ(x) === k)
      if (blocked) return null
    }
  }

  const next = clone(marbles)
  next[owner][m] = fromQ(q2)
  const kills = q2 < TRACK ? killOn(next, marbles, cellOf(owner, q2), owner, m) : []
  return { marbles: next, kills }
}

// a Jack swaps two marbles that are both out on the loop. The swapped marbles
// keep the ABSOLUTE square, so each is re-measured from its own start — which
// is why a swap can hand a marble most of a lap, or take one away.
function swap(marbles, owner, m, o2, j2) {
  if (!Number.isInteger(m) || m < 0 || m > 3) return null
  if (!Number.isInteger(o2) || o2 < 0 || o2 > 3) return null
  if (!Number.isInteger(j2) || j2 < 0 || j2 > 3) return null
  if (owner === o2 && m === j2) return null
  const a = marbles[owner][m]
  const b = marbles[o2][j2]
  if (!isTrack(a) || !isTrack(b)) return null
  const ca = cellOf(owner, a)
  const cb = cellOf(o2, b)
  const next = clone(marbles)
  next[owner][m] = ((cb - startOf(owner)) % TRACK + TRACK) % TRACK
  next[o2][j2] = ((ca - startOf(o2)) % TRACK + TRACK) % TRACK
  return { marbles: next, kills: [] }
}

// run a descriptor against a card. Returns null unless the card really grants
// that move AND the move is legal on this board. This is the anti-cheat gate.
function runDescriptor(marbles, owner, card, d) {
  if (!d || typeof d !== 'object') return null
  const r = rankOf(card)

  if (d.mode === 'out') {
    if (!canRelease(card)) return null
    return release(marbles, owner, d.m)
  }

  if (d.mode === 'step') {
    const n = stepsOf(card)
    if (n == null || n !== d.n) return null
    return step(marbles, owner, d.m, n)
  }

  if (d.mode === 'swap') {
    if (r !== 'J') return null
    return swap(marbles, owner, d.m, d.o2, d.j2)
  }

  if (d.mode === 'seven') {
    if (r !== '7') return null
    const a = d.a
    if (!a || !Number.isInteger(a.n) || a.n < 1 || a.n > 7) return null
    const first = step(marbles, owner, a.m, a.n)
    if (!first) return null
    if (!d.b) return a.n === 7 ? first : null
    const b = d.b
    if (!Number.isInteger(b.n) || a.n + b.n !== 7) return null
    if (b.m === a.m) return null // a split goes across two different marbles
    const second = step(first.marbles, owner, b.m, b.n)
    if (!second) return null
    return { marbles: second.marbles, kills: [...first.kills, ...second.kills] }
  }

  return null
}

// every legal descriptor for one card — drives the board highlighting, the
// "may I discard this" check, and nothing else
function movesForCard(marbles, owner, card) {
  const out = []
  const r = rankOf(card)

  if (canRelease(card)) {
    for (let m = 0; m < 4; m += 1) {
      if (release(marbles, owner, m)) out.push({ mode: 'out', m })
    }
  }

  const n = stepsOf(card)
  if (n != null) {
    for (let m = 0; m < 4; m += 1) {
      if (step(marbles, owner, m, n)) out.push({ mode: 'step', m, n })
    }
  }

  if (r === 'J') {
    for (let m = 0; m < 4; m += 1) {
      if (!isTrack(marbles[owner][m])) continue
      for (let o2 = 0; o2 < 4; o2 += 1) {
        for (let j2 = 0; j2 < 4; j2 += 1) {
          if (o2 === owner && j2 === m) continue
          if (!isTrack(marbles[o2][j2])) continue
          out.push({ mode: 'swap', m, o2, j2 })
        }
      }
    }
  }

  if (r === '7') {
    for (let m = 0; m < 4; m += 1) {
      if (step(marbles, owner, m, 7)) out.push({ mode: 'seven', a: { m, n: 7 }, b: null })
    }
    for (let k = 1; k <= 6; k += 1) {
      for (let m = 0; m < 4; m += 1) {
        const first = step(marbles, owner, m, k)
        if (!first) continue
        for (let m2 = 0; m2 < 4; m2 += 1) {
          if (m2 === m) continue
          if (step(first.marbles, owner, m2, 7 - k)) {
            out.push({ mode: 'seven', a: { m, n: k }, b: { m: m2, n: 7 - k } })
          }
        }
      }
    }
  }

  return out
}

// once all four of your marbles are parked, your cards move your partner's
const allParked = (row) => row.every((p) => isLane(p))
function activeOwner(marbles, seat) {
  return allParked(marbles[seat]) ? partnerOf(seat) : seat
}

function teamHome(marbles, t) {
  let n = 0
  for (const s of [t, t + 2]) for (const p of marbles[s]) if (isLane(p)) n += 1
  return n
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
export function initialState() {
  return {
    v: 1,
    phase: 'waiting', // waiting | play | end
    turnSeat: 0,
    dealer: 3,
    round: 0,
    deck: [],
    hands: [[], [], [], []],
    marbles: [0, 1, 2, 3].map(() => [BASE, BASE, BASE, BASE]),
    last: null, // { seat, card, mode, kills }
    winnerTeam: null,
  }
}

export const RULES_AR = [
  'الجكارو — أربعة لاعبون، فريقان، الشريك يجلس مقابلك (المقاعد 0 و 2 ضد 1 و 3).',
  '',
  'اللوح: مسار واحد مشترك من 72 خانة، لكل لاعب 18 خانة على ضلعه. خانة انطلاقك في منتصف ضلعك، وخلفها بيتك وفيه أربعة بيادق، وإلى الداخل خانتك الأخيرة وفيها أربعة مواضع.',
  '',
  'الورق: مجموعتان كاملتان بلا جوكر (104 ورقة). يوزَّع أربع أوراق لكل لاعب، وحين تنفد أيدي الجميع تُوزَّع أربع جديدة.',
  '',
  'قيمة الأوراق:',
  '• A — أخرج بيدقاً من البيت إلى خانة الانطلاق، أو تقدّم خانة واحدة.',
  '• K — أخرج بيدقاً من البيت، أو تقدّم 13 خانة.',
  '• Q — تقدّم 12 خانة.',
  '• J — بدّل أحد بيادقك الموجودة على المسار ببيدق آخر على المسار، لك أو لشريكك أو لخصمك.',
  '• 10 — تقدّم 10 خانات. 8 — تقدّم 8 خانات.',
  '• 7 — تقدّم 7 خانات، ويجوز تقسيمها بين بيدقين اثنين من بيادقك.',
  '• 4 — تراجع 4 خانات إلى الخلف.',
  '• 2 و 3 و 5 و 6 و 9 — تقدّم بعددها.',
  '',
  'القتل: من ينزل على بيدق يعيده إلى بيته، سواء كان للخصم أو للشريك أو لك أنت. المرور فوق البيادق مسموح.',
  '',
  'الخانة الأخيرة: بعد أن يكمل بيدقك دورة كاملة (72 خانة) من انطلاقه ينعطف إلى خانتك. العدد يجب أن يكون مضبوطاً — لا تجاوز بعد الموضع الرابع، ولا قفز فوق بيدق راقد في الخانة.',
  '',
  'مساعدة الشريك: إذا دخلت بيادقك الأربعة خانتك، صارت أوراقك تُحرّك بيادق شريكك.',
  '',
  'الورقة التي لا حركة لها يجوز رميها، والورقة التي لها حركة يجب لعبها.',
  '',
  'الفوز: أول فريق تدخل بيادقه الثمانية خاناتها.',
  '',
  'ملاحظة عن النسخ الأخرى: موائد تضيف الجوكر، وموائد تلعب 8 إلى الخلف، وموائد تحمي خانة الانطلاق، وموائد تمنع قتل بيدقك أو بيدق شريكك. هذه النسخة لا تطبّق أياً منها.',
].join('\n')

const RULES_EN = [
  'Jackaroo — four players in two fixed partnerships, partners opposite (seats 0+2 against 1+3).',
  '',
  'Board: one shared loop of 72 squares, 18 along each side. Your start square is the middle of your side; behind it is your base with four marbles, and inward from it runs your private four-slot finish lane.',
  '',
  'Cards: two full packs, no jokers (104 cards). Four cards each; when every hand is empty, four more are dealt.',
  '',
  'A — release from base, or move 1. K — release from base, or move 13. Q — 12. J — swap one of your marbles on the loop with any other marble on the loop. 10 — 10. 8 — 8. 7 — seven, splittable across exactly two of your marbles. 4 — four BACKWARDS. 2 3 5 6 9 — that many forward.',
  '',
  'Landing on any marble (opponent, partner or your own) sends it back to base. Passing over marbles is free.',
  '',
  'Finish lane: after a full lap of 72 from your own start, a marble turns in. The count must be exact — no overshooting past the fourth slot and no jumping a parked marble.',
  '',
  'Once all four of your marbles are parked, your cards move your partner\'s marbles.',
  '',
  'A card with no legal move may be discarded; a card with one must be played.',
  '',
  'First partnership with all eight marbles parked wins.',
].join('\n')

// ---------------------------------------------------------------------------
// reduce — the whole rulebook, pure and total
// ---------------------------------------------------------------------------
const keep = (state) => ({ state })

function normalise(state) {
  const ok = state && state.v === 1 && Array.isArray(state.marbles) && state.marbles.length === 4
  return ok ? state : initialState()
}

function turnOf(seat, move) {
  return { seat, startedAt: Number(move?.at) || 0, deadlineAt: null }
}

function seatedCount(room) {
  const list = Array.isArray(room?.players) ? room.players : []
  return list.filter((p) => Number.isInteger(p?.seat) && p.seat >= 0 && p.seat < 4).length
}

// refill every hand with four cards, reshuffling both packs when short
function dealRound(deck, seed) {
  const src = deck && deck.length >= 16 ? deck : freshDeck(seed)
  const hands = [0, 1, 2, 3].map((i) => src.slice(i * 4, i * 4 + 4))
  return { deck: src.slice(16), hands }
}

function doDeal(s, move, room) {
  if (s.phase !== 'waiting') return keep(s)
  if (seatedCount(room) < 4) return keep(s)
  const { deck, hands } = dealRound(null, move?.seed)
  const dealer = Number.isInteger(move?.dealer) ? ((move.dealer % 4) + 4) % 4 : 0
  const opener = nx(dealer)
  return {
    state: {
      ...initialState(),
      phase: 'play',
      dealer,
      round: 1,
      deck,
      hands,
      turnSeat: opener,
    },
    turn: turnOf(opener, move),
    status: 'playing',
  }
}

// shared tail for a play or a discard: drop the card, refill if the table is
// out of cards, hand the turn on, and check for a finished partnership
function advance(s, seat, hands, marbles, last, move) {
  let nextHands = hands
  let deck = s.deck
  let round = s.round
  if (nextHands.every((h) => h.length === 0)) {
    const dealt = dealRound(deck, move?.seed)
    nextHands = dealt.hands
    deck = dealt.deck
    round += 1
  }

  const wonBy = [0, 1].find((t) => teamHome(marbles, t) === 8)
  const state = {
    ...s,
    hands: nextHands,
    deck,
    round,
    marbles,
    last,
    turnSeat: wonBy == null ? nx(seat) : seat,
    phase: wonBy == null ? 'play' : 'end',
    winnerTeam: wonBy == null ? null : wonBy,
  }

  // gameRoom folds `scores` into players[].score. Only send it when the parked
  // count actually moved, so the players array is not rewritten every turn.
  const was = [teamHome(s.marbles, 0), teamHome(s.marbles, 1)]
  const now = [teamHome(marbles, 0), teamHome(marbles, 1)]
  const scores = (was[0] !== now[0] || was[1] !== now[1])
    ? { 0: now[0], 1: now[1], 2: now[0], 3: now[1] }
    : undefined

  if (wonBy == null) return { state, turn: turnOf(nx(seat), move), scores }
  // winnerSeat carries the winning PARTNERSHIP: 0 means seats 0+2, 1 means 1+3.
  return { state, turn: turnOf(seat, move), scores, winnerSeat: wonBy, status: 'ended' }
}

function doPlay(s, move) {
  if (s.phase !== 'play') return keep(s)
  const seat = move.seat
  if (seat !== s.turnSeat) return keep(s)

  const hand = s.hands[seat] || []
  const i = move.i
  if (!Number.isInteger(i) || i < 0 || i >= hand.length) return keep(s)
  if (hand[i] !== move.card) return keep(s)

  const owner = activeOwner(s.marbles, seat)
  const res = runDescriptor(s.marbles, owner, hand[i], move.d)
  if (!res) return keep(s)

  const hands = s.hands.map((h, k) => (k === seat ? h.filter((_, j) => j !== i) : h))
  const last = { seat, owner, card: hand[i], mode: move.d.mode, kills: res.kills.length }
  return advance(s, seat, hands, res.marbles, last, move)
}

function doDiscard(s, move) {
  if (s.phase !== 'play') return keep(s)
  const seat = move.seat
  if (seat !== s.turnSeat) return keep(s)

  const hand = s.hands[seat] || []
  const i = move.i
  if (!Number.isInteger(i) || i < 0 || i >= hand.length) return keep(s)
  if (hand[i] !== move.card) return keep(s)

  // a card that CAN be played must be played
  const owner = activeOwner(s.marbles, seat)
  if (movesForCard(s.marbles, owner, hand[i]).length > 0) return keep(s)

  const hands = s.hands.map((h, k) => (k === seat ? h.filter((_, j) => j !== i) : h))
  const last = { seat, owner, card: hand[i], mode: 'discard', kills: 0 }
  return advance(s, seat, hands, s.marbles, last, move)
}

export function reduce(state, move, room) {
  const s = normalise(state)
  const m = move && typeof move === 'object' ? move : null
  if (!m) return keep(s)
  if (Number.isInteger(m.seat) && (m.seat < 0 || m.seat > 3)) return keep(s)
  if (!Number.isInteger(m.seat) && m.t !== 'deal') return keep(s)

  switch (m.t) {
    case 'deal': return doDeal(s, m, room)
    case 'play': return doPlay(s, m)
    case 'discard': return doDiscard(s, m)
    default: return keep(s)
  }
}

// ---------------------------------------------------------------------------
// geometry — the board is drawn from these, and the whole thing is rotated so
// the viewer always sits on the bottom side
// ---------------------------------------------------------------------------
const EDGE = 8
const STEP_XY = (100 - 2 * EDGE) / PER

function cellXY(di) {
  const side = Math.floor(di / PER)
  const k = di % PER
  const t = EDGE + STEP_XY * (k + 0.5)
  if (side === 0) return { x: t, y: EDGE }
  if (side === 1) return { x: 100 - EDGE, y: t }
  if (side === 2) return { x: 100 - t, y: 100 - EDGE }
  return { x: EDGE, y: 100 - t }
}

function laneXY(ds, slot) {
  const d = EDGE + 6 + slot * 5.4
  if (ds === 0) return { x: 50, y: d }
  if (ds === 1) return { x: 100 - d, y: 50 }
  if (ds === 2) return { x: 50, y: 100 - d }
  return { x: d, y: 50 }
}

const BASE_HUB = [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 75, y: 75 }, { x: 25, y: 75 }]
function baseXY(ds, k) {
  const h = BASE_HUB[ds]
  return { x: h.x + (k % 2 ? 4.4 : -4.4), y: h.y + (k > 1 ? 4.4 : -4.4) }
}

function sideLabelXY(ds) {
  if (ds === 0) return { x: 50, y: EDGE - 3.4 }
  if (ds === 1) return { x: 100 - EDGE + 0.4, y: 50 - 4 }
  if (ds === 2) return { x: 50, y: 100 - EDGE + 5.4 }
  return { x: EDGE - 0.4, y: 50 - 4 }
}

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------
const SUIT_PATH = {
  S: 'M12 2.2c0 0-8 6.4-8 11.1a4.15 4.15 0 0 0 6.9 3.1c-.2 1.9-1 3.4-2.3 4.2h6.8c-1.3-.8-2.1-2.3-2.3-4.2a4.15 4.15 0 0 0 6.9-3.1c0-4.7-8-11.1-8-11.1z',
  H: 'M12 21.3s-8.2-5.2-8.2-10.6a4.7 4.7 0 0 1 8.2-3.1 4.7 4.7 0 0 1 8.2 3.1c0 5.4-8.2 10.6-8.2 10.6z',
  D: 'M12 2.2l7.2 9.8-7.2 9.8-7.2-9.8z',
  C: 'M12 3.1a3.62 3.62 0 0 0-2.7 6 3.62 3.62 0 1 0-1.4 6.9 3.6 3.6 0 0 0 3.2-2c-.1 2.3-.9 4.2-2.2 5.1h6.2c-1.3-.9-2.1-2.8-2.2-5.1a3.6 3.6 0 0 0 3.2 2 3.62 3.62 0 1 0-1.4-6.9 3.62 3.62 0 0 0-2.7-6z',
}

function Suit({ s, className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} focusable="false" aria-hidden="true">
      <path d={SUIT_PATH[s] || SUIT_PATH.S} fill="currentColor" />
    </svg>
  )
}

function CardFace({ code }) {
  const s = suitOf(code)
  const isFace = ['J', 'Q', 'K'].includes(rankOf(code))
  return (
    <span className={'cg-card' + (RED[s] ? ' is-red' : '')}>
      <span className="cg-card-rank">{label(code)}</span>
      <Suit s={s} className="cg-card-mini" />
      {isFace ? <span className="cg-card-face">{rankOf(code)}</span> : null}
      <Suit s={s} className="cg-card-big" />
    </span>
  )
}

const SEAT_COLOR = ['#38bdf8', '#fbbf24', '#818cf8', '#fb7185']

function Marble({ x, y, color, live, picked, onClick }) {
  return (
    <g
      className={'jak-marble' + (live ? ' is-live' : '') + (picked ? ' is-pick' : '')}
      transform={'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ')'}
      onClick={live ? onClick : undefined}
    >
      <circle className="jak-marble-body" r="2.7" fill={color} />
      <circle className="jak-marble-shine" cx="-0.85" cy="-0.95" r="0.75" />
      {live ? <circle r="5" fill="transparent" /> : null}
    </g>
  )
}

// ---------------------------------------------------------------------------
// local fallback table — one device, pass and play, running the SAME reduce
// ---------------------------------------------------------------------------
const LOCAL_NAMES = ['اللاعب الأول', 'اللاعب الثاني', 'اللاعب الثالث', 'اللاعب الرابع']

function makeLocalRoom(playerName) {
  return {
    roomId: 'local',
    gameId: 'jackaroo',
    status: 'playing',
    local: true,
    players: [0, 1, 2, 3].map((seat) => ({
      id: 'local-' + seat,
      name: seat === 0 ? (playerName || LOCAL_NAMES[0]) : LOCAL_NAMES[seat],
      seat,
      connected: true,
      score: 0,
    })),
    maxPlayers: 4,
    minPlayers: 4,
    turn: { seat: 0, startedAt: 0, deadlineAt: null },
    state: initialState(),
    winnerSeat: null,
  }
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------
export default function Jackaroo({
  onScore,
  onExit,
  lang = 'ar',
  brand = '#0e7490',
  playerName = '',
  room = null,
  mySeat = null,
  onMove,
  isHost = false,
}) {
  const ar = lang !== 'en'
  const remote = !!room
  const [localRoom, setLocalRoom] = useState(() => makeLocalRoom(playerName))
  const [rules, setRules] = useState(false)
  const [sel, setSel] = useState(null) // { i, card }
  const [split, setSplit] = useState(null) // null | 7 | 1..6
  const [picks, setPicks] = useState([]) // [{ o, m }]

  const table = remote ? room : localRoom
  const st = useMemo(() => normalise(table?.state), [table])

  const seat = remote
    ? (Number.isInteger(mySeat) ? mySeat : 0)
    : (Number.isInteger(st.turnSeat) ? st.turnSeat : 0)

  const host = remote ? !!isHost : true
  const players = Array.isArray(table?.players) ? table.players : []
  const bySeat = useMemo(() => {
    const out = [null, null, null, null]
    for (const p of players) if (Number.isInteger(p?.seat) && p.seat >= 0 && p.seat < 4) out[p.seat] = p
    return out
  }, [players])
  const filled = bySeat.filter(Boolean).length

  const submit = useCallback((move) => {
    const full = { ...move, at: Date.now(), seed: newSeed() }
    if (remote) { onMove?.(full); return }
    setLocalRoom((r) => {
      const res = reduce(r.state, full, r) || {}
      if (!res.state || res.state === r.state) return r
      return {
        ...r,
        state: res.state,
        turn: res.turn || r.turn,
        status: res.status || r.status,
        winnerSeat: res.winnerSeat != null ? res.winnerSeat : r.winnerSeat,
      }
    })
  }, [remote, onMove])

  // The room lobby starts the game with this file's `initialState`, which is a
  // pre-deal 'waiting' board — so the host deals the moment the table is full.
  // A ref keeps it to one attempt per entry into 'waiting'; the manual button
  // below stays on screen as the fallback if that attempt is refused.
  const dealtRef = useRef(false)
  useEffect(() => {
    if (!remote || !isHost) return
    if (st.phase !== 'waiting' || filled < 4) { dealtRef.current = false; return }
    if (dealtRef.current) return
    dealtRef.current = true
    submit({ t: 'deal', dealer: 0 })
  }, [remote, isHost, st.phase, filled, submit])

  // clear the selection whenever the board moves on
  const stamp = st.round + ':' + st.turnSeat + ':' + (st.hands[seat] || []).length
  useEffect(() => { setSel(null); setSplit(null); setPicks([]) }, [stamp])

  const myTeam = team(seat)
  useEffect(() => {
    onScore?.(teamHome(st.marbles, myTeam) * 10 + (st.winnerTeam === myTeam ? 40 : 0))
  }, [onScore, st.marbles, st.winnerTeam, myTeam])

  const t = ar
    ? {
      rules: 'الشرح', close: 'إغلاق', deal: 'ابدأ اللعب', exit: 'خروج',
      waitPlayers: 'بانتظار اكتمال الطاولة', needFour: 'اللعبة لأربعة لاعبين — كل لاعب يجلس مقابل شريكه.',
      hostStarts: 'يبدأ مضيف الغرفة التوزيع.', yourTurn: 'دورك', waitingFor: 'الدور على',
      pickCard: 'اختر ورقة', pickMarble: 'اختر بيدقاً', pickSwapA: 'اختر بيدقك',
      pickSwapB: 'اختر البيدق الذي تبادله', pickSecond: 'اختر البيدق الثاني',
      noMove: 'لا حركة لهذه الورقة', discard: 'ارمِ الورقة', full7: 'السبعة كاملة',
      home: 'في الخانة', us: 'فريقنا', them: 'الخصوم', win: 'فزتم', lose: 'فاز الخصوم',
      partnerNow: 'بيادقك وصلت — أنت تحرّك بيادق شريكك الآن.', round: 'الجولة',
      killed: 'قتل', swapped: 'بدّل', released: 'أخرج بيدقاً', discarded: 'رمى',
    }
    : {
      rules: 'Rules', close: 'Close', deal: 'Start', exit: 'Exit',
      waitPlayers: 'Waiting for the table', needFour: 'Four players, partners opposite.',
      hostStarts: 'The host starts.', yourTurn: 'Your turn', waitingFor: 'Turn:',
      pickCard: 'Pick a card', pickMarble: 'Pick a marble', pickSwapA: 'Pick your marble',
      pickSwapB: 'Pick the marble to swap with', pickSecond: 'Pick the second marble',
      noMove: 'No legal move for this card', discard: 'Discard', full7: 'Full seven',
      home: 'parked', us: 'Us', them: 'Them', win: 'You win', lose: 'They win',
      partnerNow: 'Your marbles are all in — you now move your partner\'s.', round: 'Round',
      killed: 'sent one home', swapped: 'swapped', released: 'released a marble', discarded: 'discarded',
    }

  const nameOf = (sx) => bySeat[sx]?.name || (ar ? 'مقعد فارغ' : 'Empty')
  const shortName = (sx) => String(nameOf(sx)).slice(0, 10)
  const isMyTurn = st.turnSeat === seat && st.phase === 'play'
  const owner = activeOwner(st.marbles, seat)
  const myHand = st.hands[seat] || []

  // legal descriptors for the selected card, recomputed from live state
  const legal = useMemo(
    () => (sel ? movesForCard(st.marbles, owner, sel.card) : []),
    [sel, st.marbles, owner],
  )

  // which cards in hand have no move at all (so may be discarded)
  const deadCards = useMemo(() => {
    if (!isMyTurn) return []
    return myHand.map((c) => movesForCard(st.marbles, owner, c).length === 0)
  }, [isMyTurn, myHand, st.marbles, owner])

  const isSeven = sel && rankOf(sel.card) === '7'
  const isJack = sel && rankOf(sel.card) === 'J'

  // the descriptors still reachable given what has been tapped so far
  const reachable = useMemo(() => {
    if (!sel) return []
    if (isJack) {
      if (picks.length === 0) return legal
      const [a] = picks
      return legal.filter((d) => d.m === a.m && a.o === owner)
    }
    if (isSeven) {
      if (split == null) return []
      if (split === 7) return legal.filter((d) => d.a.n === 7 && !d.b)
      if (picks.length === 0) return legal.filter((d) => d.b && d.a.n === split)
      const [a] = picks
      return legal.filter((d) => d.b && d.a.n === split && d.a.m === a.m && a.o === owner)
    }
    return legal
  }, [sel, legal, picks, split, isJack, isSeven, owner])

  // marbles that can be tapped right now
  const liveMarbles = useMemo(() => {
    const set = new Set()
    if (!isMyTurn || !sel) return set
    for (const d of reachable) {
      if (isJack && picks.length === 1) set.add(d.o2 + ':' + d.j2)
      else if (isJack) set.add(owner + ':' + d.m)
      else if (isSeven) set.add(owner + ':' + (picks.length === 1 && d.b ? d.b.m : d.a.m))
      else set.add(owner + ':' + d.m)
    }
    return set
  }, [isMyTurn, sel, reachable, picks, isJack, isSeven, owner])

  // the squares a simple step / release would land on, ringed on the board
  const targets = useMemo(() => {
    const out = []
    if (!isMyTurn || !sel || isJack || isSeven) return out
    for (const d of reachable) {
      const res = runDescriptor(st.marbles, owner, sel.card, d)
      if (!res) continue
      out.push({ o: owner, m: d.m, p: res.marbles[owner][d.m] })
    }
    return out
  }, [isMyTurn, sel, reachable, st.marbles, owner, isJack, isSeven])

  const tapMarble = useCallback((o, m) => {
    if (!isMyTurn || !sel) return
    const key = o + ':' + m
    if (!liveMarbles.has(key)) return

    if (isJack) {
      if (picks.length === 0) { setPicks([{ o, m }]); return }
      const a = picks[0]
      const d = { mode: 'swap', m: a.m, o2: o, j2: m }
      submit({ t: 'play', seat, i: sel.i, card: sel.card, d })
      return
    }

    if (isSeven) {
      if (split === 7) {
        submit({ t: 'play', seat, i: sel.i, card: sel.card, d: { mode: 'seven', a: { m, n: 7 }, b: null } })
        return
      }
      if (picks.length === 0) { setPicks([{ o, m }]); return }
      const a = picks[0]
      const d = { mode: 'seven', a: { m: a.m, n: split }, b: { m, n: 7 - split } }
      submit({ t: 'play', seat, i: sel.i, card: sel.card, d })
      return
    }

    // release beats a plain step when both are on offer for a base marble
    const outMove = reachable.find((d) => d.mode === 'out' && d.m === m)
    const stepMove = reachable.find((d) => d.mode === 'step' && d.m === m)
    const d = outMove || stepMove
    if (!d) return
    submit({ t: 'play', seat, i: sel.i, card: sel.card, d })
  }, [isMyTurn, sel, liveMarbles, isJack, isSeven, picks, split, reachable, seat, submit])

  const pickCard = useCallback((i, card) => {
    setPicks([])
    setSplit(null)
    setSel((cur) => (cur && cur.i === i ? null : { i, card }))
  }, [])

  const showLobby = st.phase === 'waiting'
  const showEnd = st.phase === 'end'
  const selDead = sel ? legal.length === 0 : false

  const hint = !isMyTurn
    ? t.waitingFor + ' ' + nameOf(st.turnSeat)
    : !sel
      ? t.pickCard
      : selDead
        ? t.noMove
        : isJack
          ? (picks.length === 0 ? t.pickSwapA : t.pickSwapB)
          : isSeven
            ? (split == null ? '7 = ' + (ar ? 'اختر التقسيم' : 'choose the split')
              : picks.length === 0 ? t.pickMarble : t.pickSecond)
            : t.pickMarble

  return (
    <div className="cg-root" style={{ '--cg-brand': brand }}>
      <div className="cg-top">
        <span className="cg-score is-a">
          <span>{myTeam === 0 ? t.us : t.them}</span>
          <b>{fmt(teamHome(st.marbles, 0), ar)}</b>
        </span>
        <span className="cg-score is-b">
          <span>{myTeam === 1 ? t.us : t.them}</span>
          <b>{fmt(teamHome(st.marbles, 1), ar)}</b>
        </span>
        <span className="cg-top-sp" />
        {st.round > 0 ? <span className="cg-chip">{t.round} {fmt(st.round, ar)}</span> : null}
        <button type="button" className="cg-iconbtn cg-press" onClick={() => setRules(true)} aria-label={t.rules}>
          <span aria-hidden="true">?</span>
        </button>
      </div>

      <div className="cg-stage">
        <div className="jak-boardwrap">
          <svg className="jak-board" viewBox="0 0 100 100" role="img" aria-label={ar ? 'لوح الجكارو' : 'Jackaroo board'}>
            {/* the loop */}
            {Array.from({ length: TRACK }).map((_, cell) => {
              const di = (cell + (2 - seat) * PER + TRACK * 2) % TRACK
              const { x, y } = cellXY(di)
              const startFor = [0, 1, 2, 3].find((o) => startOf(o) === cell)
              return (
                <rect
                  key={'c' + cell}
                  className={'jak-cell' + (startFor != null ? ' is-start' : '')}
                  x={x - 2}
                  y={y - 2}
                  width="4"
                  height="4"
                  rx="1.2"
                  style={startFor != null ? { fill: SEAT_COLOR[startFor] + '55' } : undefined}
                />
              )
            })}

            {/* lanes and bases */}
            {[0, 1, 2, 3].map((o) => {
              const ds = (o - seat + 2 + 4) % 4
              return (
                <g key={'z' + o} style={{ '--lc': SEAT_COLOR[o] }}>
                  {Array.from({ length: LANE }).map((_, k) => {
                    const { x, y } = laneXY(ds, k)
                    return (
                      <rect
                        key={'l' + k}
                        className="jak-cell is-lane"
                        x={x - 2}
                        y={y - 2}
                        width="4"
                        height="4"
                        rx="1.2"
                      />
                    )
                  })}
                  {Array.from({ length: 4 }).map((_, k) => {
                    const { x, y } = baseXY(ds, k)
                    return <circle key={'b' + k} className="jak-cell is-base" cx={x} cy={y} r="2.9" />
                  })}
                  <text
                    className={'jak-sidelabel' + (st.turnSeat === o ? ' is-turn' : '')}
                    x={sideLabelXY(ds).x}
                    y={sideLabelXY(ds).y}
                  >
                    {o === seat ? (ar ? 'أنت' : 'You') : shortName(o)}
                  </text>
                </g>
              )
            })}

            {/* destination rings */}
            {targets.map((tg, k) => {
              const pos = posXY(tg.o, tg.p, seat, tg.m)
              return <circle key={'t' + k} className="jak-target" cx={pos.x} cy={pos.y} r="3.4" />
            })}

            {/* the hub: last card played */}
            <circle className="jak-hub" cx="50" cy="50" r="10.5" />
            {st.last ? (
              <>
                <text className="jak-hub-text" x="50" y="49">{label(st.last.card)}</text>
                <text className="jak-hub-sub" x="50" y="54">{shortName(st.last.seat)}</text>
              </>
            ) : (
              <text className="jak-hub-sub" x="50" y="51">{st.phase === 'play' ? shortName(st.turnSeat) : '—'}</text>
            )}

            {/* marbles last, so they sit above every cell */}
            {[0, 1, 2, 3].map((o) => (
              <g key={'m' + o}>
                {st.marbles[o].map((p, m) => {
                  const pos = posXY(o, p, seat, m)
                  const key = o + ':' + m
                  return (
                    <Marble
                      key={key}
                      x={pos.x}
                      y={pos.y}
                      color={SEAT_COLOR[o]}
                      live={liveMarbles.has(key)}
                      picked={picks.some((q) => q.o === o && q.m === m)}
                      onClick={() => tapMarble(o, m)}
                    />
                  )
                })}
              </g>
            ))}
          </svg>
        </div>

        {showLobby ? (
          <div className="cg-lobby">
            <strong className="cg-lobby-title">{t.waitPlayers}</strong>
            <p className="cg-lobby-sub">{t.needFour}</p>
            <div className="cg-lobby-seats">
              {[0, 1, 2, 3].map((sx) => (
                <div
                  key={sx}
                  className={'cg-lobby-seat' + (bySeat[sx] ? ' is-filled' : '') + (sx === seat ? ' is-me' : '')}
                  style={{ '--sc': SEAT_COLOR[sx] }}
                >
                  <span className="cg-av">{initialsOf(bySeat[sx]?.name)}</span>
                  <span>{bySeat[sx]?.name || '—'}</span>
                  <span className={'cg-team-tag ' + (team(sx) === 0 ? 'is-a' : 'is-b')}>
                    {team(sx) === 0 ? (ar ? 'أ' : 'A') : (ar ? 'ب' : 'B')}
                  </span>
                </div>
              ))}
            </div>
            {filled < 4 ? (
              <span className="cg-dots"><i /><i /><i /></span>
            ) : host ? (
              <button
                type="button"
                className="cg-btn is-gold cg-press"
                onClick={() => submit({ t: 'deal', dealer: 0 })}
              >
                {t.deal}
              </button>
            ) : (
              <p className="cg-lobby-sub">{t.hostStarts}</p>
            )}
          </div>
        ) : null}

        {showEnd ? (
          <div className="cg-modal">
            <div className="cg-modal-card">
              <strong className="cg-modal-title">{st.winnerTeam === myTeam ? t.win : t.lose}</strong>
              <div className="cg-modal-rows">
                {[0, 1].map((tm) => (
                  <div key={tm} className={'cg-row ' + (tm === 0 ? 'is-a' : 'is-b')}>
                    <span>{tm === myTeam ? t.us : t.them}</span>
                    <b>{fmt(teamHome(st.marbles, tm), ar)}</b>
                  </div>
                ))}
              </div>
              <div className="cg-actions">
                <button type="button" className="cg-btn is-primary cg-press" onClick={() => onExit?.()}>
                  {t.exit}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="cg-hand-wrap">
        {owner !== seat && st.phase === 'play' ? (
          <div className="jak-legend"><span>{t.partnerNow}</span></div>
        ) : null}

        <div className="cg-hand" style={{ '--cg-overlap': '-6px' }}>
          {myHand.map((c, i) => (
            <button
              key={c + ':' + i}
              type="button"
              className={
                'cg-hand-slot' +
                (sel && sel.i === i ? ' is-sel' : '') +
                (isMyTurn && deadCards[i] ? ' is-dim' : '')
              }
              disabled={!isMyTurn}
              onClick={() => pickCard(i, c)}
              aria-label={label(c)}
            >
              <CardFace code={c} />
            </button>
          ))}
        </div>

        {isSeven && isMyTurn && !selDead ? (
          <div className="jak-split">
            <button
              type="button"
              className={'jak-splitbtn cg-press' + (split === 7 ? ' is-on' : '')}
              onClick={() => { setSplit(7); setPicks([]) }}
              disabled={!legal.some((d) => !d.b)}
            >
              {t.full7}
            </button>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                type="button"
                className={'jak-splitbtn cg-press' + (split === n ? ' is-on' : '')}
                onClick={() => { setSplit(n); setPicks([]) }}
                disabled={!legal.some((d) => d.b && d.a.n === n)}
              >
                {fmt(n, ar)} + {fmt(7 - n, ar)}
              </button>
            ))}
          </div>
        ) : null}

        <div className="cg-actions">
          {isMyTurn && sel && selDead ? (
            <button
              type="button"
              className="cg-btn is-primary cg-press"
              onClick={() => submit({ t: 'discard', seat, i: sel.i, card: sel.card })}
            >
              {t.discard} {label(sel.card)}
            </button>
          ) : null}
          {isMyTurn && picks.length > 0 ? (
            <button type="button" className="cg-btn is-ghost is-sm cg-press" onClick={() => setPicks([])}>
              {ar ? 'تراجع' : 'Undo'}
            </button>
          ) : null}
        </div>

        <div className="cg-hand-hint">{hint}</div>
      </div>

      {rules ? (
        <div className="cg-over">
          <div className="cg-over-head">
            <strong>{ar ? 'الجكارو — الشرح' : 'Jackaroo — how to play'}</strong>
            <button type="button" className="cg-iconbtn cg-press" onClick={() => setRules(false)} aria-label={t.close}>
              <span aria-hidden="true">&#215;</span>
            </button>
          </div>
          <div className="cg-over-body cg-scroll">{ar ? RULES_AR : RULES_EN}</div>
        </div>
      ) : null}
    </div>
  )
}

// where a marble sits on screen, in the viewer's rotated frame. `m` is the
// marble's index, which is what keeps the four base marbles from stacking.
function posXY(o, p, viewer, m = 0) {
  const ds = (o - viewer + 2 + 4) % 4
  if (isBase(p)) return baseXY(ds, m)
  if (isLane(p)) return laneXY(ds, p - L0)
  const di = (cellOf(o, p) + (2 - viewer) * PER + TRACK * 2) % TRACK
  return cellXY(di)
}

// ---------------------------------------------------------------------------
// tiny format helpers — Latin digits only (hard repo rule)
// ---------------------------------------------------------------------------
function fmt(n, ar) {
  const v = Number(n) || 0
  return ar ? v.toLocaleString('ar-SA-u-nu-latn') : v.toLocaleString('en-US')
}
function initialsOf(name) {
  const s = String(name || '').trim()
  return s ? s.slice(0, 1) : '·'
}
function newSeed() {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1
}
