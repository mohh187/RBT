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
//   • SEATING AND DIRECTION (this used to disagree with the drawing code; it
//     no longer does — see "THE DIRECTION DECISION" below). The turn passes
//     seat -> seat+1, which is the player sitting on your RIGHT: the majlis
//     convention of passing to the right. On screen you always sit at the
//     BOTTOM, so the seats read bottom -> right -> top (your partner) -> left,
//     and both the turn and the marbles travel that way around the board.
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
// THE DIRECTION DECISION (was a real inconsistency; fixed deliberately)
// ===========================================================================
// The old header claimed play ran counter-clockwise while `cellXY` laid the
// track out clockwise, which put the NEXT player on the viewer's LEFT — the
// opposite of how a majlis passes the turn. The geometry is the half that
// changed: `ringPoint` now lays the 72 squares out anti-clockwise on screen,
// starting at the viewer's own start square at bottom-centre and running to
// the RIGHT. Consequences, all now consistent:
//     seat+1 (next to play) sits on your RIGHT
//     seat+2 (your partner)  sits at the TOP
//     seat+3                 sits on your LEFT
//     a marble leaving your start moves right, up the right side, right-to-
//     left across the top, and down the left side back to you.
// Nothing in `reduce` moved: seat order is still nx(s) = (s+1) % 4, and the
// marble encoding is untouched, so saved rooms and lib/spectate.js still read.
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
// ===========================================================================
// THE THREE ENGINE TRAPS, and how this file stays out of them
// ===========================================================================
// 1) SAFARI SVG TRANSFORM. Nothing here ever positions an SVG child with a CSS
//    transform carrying px units. Position is always the unitless attribute
//    form, transform={`translate(${x} ${y})`}. Where a piece also needs a CSS
//    animation it is wrapped: the OUTER <g> carries the attribute translate,
//    an INNER <g> carries a CSS transform that only ever rotates or scales.
// 2) TAP STEALING. Every painted part of the board carries pointer-events:none.
//    A marble opts back in through ONE explicit hit circle whose radius is
//    1.12x the drawn body — a hair, not a halo — and only when that marble is
//    actually actionable. Destination rings are painted BEFORE the marbles so
//    a piece always wins an overlap with a hint. At most one marble can ever
//    stand on a track square (landing kills), so live targets do not stack.
// 3) SILENT RULES. Every rule that removes an option the player expected is
//    visible: the marble dims, the lane marble that is blocking the way is
//    ringed, and tapping the dimmed marble both wobbles it and prints the
//    reason in the hint line (`blockReason` below is display-only and never
//    touches `reduce`).
//
// SPECTATOR SAFETY: a viewer holding no seat (`mySeat` null on a venue screen)
// gets the board and the four player pods only. `seated` gates the whole hand
// block, `isMyTurn` is false for them by construction, so no card, no control
// and no "your turn" copy can ever reach a screen nobody is sitting at.
//
// KNOWN LIMITATION (flagged for the lead, not fixable from inside this file):
// hands and the undealt deck live in room.state, which every player in the
// room can read. The UI never shows them, but the network payload does.
// Hiding them needs per-seat subcollections plus rules, outside this file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { botMoveFor, botLabel, takeSoloIntent, BOT_DELAY_MS } from '../../lib/gameBots.js'
import { play } from '../../lib/gameSounds.js'
import '../../styles/cardgames.css'
import '../../styles/jackaroo.css'

// ---------------------------------------------------------------------------
// board constants
// ---------------------------------------------------------------------------
const TRACK = 72
const PER = 18
const LANE = 4
const BASE = 900
const L0 = 100

const STALL_MS = 75000 // after this a stopped turn can be skipped by anyone (same window as Ludo)

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

// ---------------------------------------------------------------------------
// WHY a marble cannot move — DISPLAY ONLY. Never called by `reduce`; it exists
// so a rule that quietly removes an option can say what it did (trap 3).
// Returns a message key, or 'none' when the marble is in fact movable.
// ---------------------------------------------------------------------------
function stepWhy(marbles, owner, m, n) {
  const p = marbles[owner][m]
  if (isBase(p)) return 'base'
  const q = toQ(p)
  const q2 = q + n
  if (n < 0) {
    if (q >= TRACK) return 'laneBack'
    if (q2 <= -TRACK) return 'tooFarBack'
    return 'none'
  }
  if (q2 > TRACK + LANE - 1) return 'overshoot'
  if (q2 >= TRACK) {
    for (let k = Math.max(TRACK, q + 1); k <= q2; k += 1) {
      if (marbles[owner].some((x, j) => j !== m && isLane(x) && toQ(x) === k)) return 'laneBlocked'
    }
  }
  return 'none'
}

function blockReason(marbles, owner, m, card) {
  const p = marbles[owner][m]
  const r = rankOf(card)

  if (r === 'J') {
    if (!isTrack(p)) return 'needTrack'
    for (let o2 = 0; o2 < 4; o2 += 1) {
      for (let j2 = 0; j2 < 4; j2 += 1) {
        if (o2 === owner && j2 === m) continue
        if (isTrack(marbles[o2][j2])) return 'none'
      }
    }
    return 'noSwapMate'
  }

  if (r === '7') {
    let anyLeg = false
    for (let k = 1; k <= 7; k += 1) {
      const first = step(marbles, owner, m, k)
      if (!first) continue
      if (k === 7) return 'none'
      anyLeg = true
      for (let m2 = 0; m2 < 4; m2 += 1) {
        if (m2 === m) continue
        if (step(first.marbles, owner, m2, 7 - k)) return 'none'
      }
    }
    return anyLeg ? 'noSecond' : stepWhy(marbles, owner, m, 1)
  }

  const n = stepsOf(card)
  if (n == null) return 'noMove'
  if (isBase(p)) return canRelease(card) ? 'none' : 'base'
  return stepWhy(marbles, owner, m, n)
}

// which of the owner's parked marbles is physically standing in the way — the
// board marks it, so "the count was blocked" is never invisible
function laneBlockers(marbles, owner, m, card) {
  const out = []
  const n = rankOf(card) === '7' ? 7 : stepsOf(card)
  if (n == null || n < 0) return out
  const p = marbles[owner][m]
  if (isBase(p)) return out
  const q = toQ(p)
  const q2 = Math.min(q + n, TRACK + LANE - 1)
  for (let k = Math.max(TRACK, q + 1); k <= q2; k += 1) {
    marbles[owner].forEach((x, j) => {
      if (j !== m && isLane(x) && toQ(x) === k) out.push(j)
    })
  }
  return out
}

// most informative first, so a dead card explains itself with the reason a
// player is most likely to be arguing with
const REASON_ORDER = ['laneBlocked', 'overshoot', 'noSecond', 'tooFarBack', 'laneBack', 'base', 'noSwapMate', 'needTrack', 'noMove']

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

// What the computer opponents are allowed to borrow from this file: the legal
// descriptor generator and the descriptor runner — i.e. the rulebook itself, so
// a bot cannot invent a move — plus the board vocabulary needed to score a
// resulting position. Nothing here exposes another seat's cards.
// See src/lib/gameBots.js.
export const botHelpers = {
  movesForCard, runDescriptor, activeOwner, team, partnerOf,
  isBase, isLane, isTrack, rankOf, cellOf, TRACK, LANE, L0, BASE, PER,
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
  'الجكارو: أربعة لاعبون، فريقان، الشريك يجلس مقابلك (المقاعد 0 و 2 ضد 1 و 3).',
  '',
  'الدور والاتجاه: الدور ينتقل إلى اللاعب الذي على يمينك. أنت دائماً في الأسفل، والذي بعدك على اليمين، وشريكك في الأعلى، والرابع على اليسار. والبيادق تدور في نفس هذا الاتجاه.',
  '',
  'اللوح: مسار واحد مشترك من 72 خانة، لكل لاعب 18 خانة على ضلعه. خانة انطلاقك في منتصف ضلعك، وخلفها بيتك وفيه أربعة بيادق، وإلى الداخل خانتك الأخيرة وفيها أربعة مواضع.',
  '',
  'الورق: مجموعتان كاملتان بلا جوكر (104 ورقة). يوزَّع أربع أوراق لكل لاعب، وحين تنفد أيدي الجميع تُوزَّع أربع جديدة.',
  '',
  'قيمة الأوراق:',
  '• A: أخرج بيدقاً من البيت إلى خانة الانطلاق، أو تقدّم خانة واحدة.',
  '• K: أخرج بيدقاً من البيت، أو تقدّم 13 خانة.',
  '• Q: تقدّم 12 خانة.',
  '• J: بدّل أحد بيادقك الموجودة على المسار ببيدق آخر على المسار، لك أو لشريكك أو لخصمك.',
  '• 10: تقدّم 10 خانات. و8: تقدّم 8 خانات.',
  '• 7: تقدّم 7 خانات، ويجوز تقسيمها بين بيدقين اثنين من بيادقك.',
  '• 4: تراجع 4 خانات إلى الخلف.',
  '• 2 و 3 و 5 و 6 و 9: تقدّم بعددها.',
  '',
  'القتل: من ينزل على بيدق يعيده إلى بيته، سواء كان للخصم أو للشريك أو لك أنت. المرور فوق البيادق مسموح.',
  '',
  'الخانة الأخيرة: بعد أن يكمل بيدقك دورة كاملة (72 خانة) من انطلاقه ينعطف إلى خانتك. العدد يجب أن يكون مضبوطاً: لا تجاوز بعد الموضع الرابع، ولا قفز فوق بيدق راقد في الخانة.',
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
  'Jackaroo: four players in two fixed partnerships, partners opposite (seats 0+2 against 1+3).',
  '',
  'Turn order: the turn passes to the player on your RIGHT. You always sit at the bottom, the next player is on your right, your partner is at the top, the fourth is on your left. The marbles travel the same way around the board.',
  '',
  'Board: one shared loop of 72 squares, 18 along each side. Your start square is the middle of your side; behind it is your base with four marbles, and inward from it runs your private four-slot finish lane.',
  '',
  'Cards: two full packs, no jokers (104 cards). Four cards each; when every hand is empty, four more are dealt.',
  '',
  'A: release from base, or move 1. K: release from base, or move 13. Q: move 12. J: swap one of your marbles on the loop with any other marble on the loop. 10: move ten. 8: move eight. 7: move seven, splittable across exactly two of your marbles. 4: move four squares backwards. 2, 3, 5, 6 and 9: that many forward.',
  '',
  'Landing on any marble (opponent, partner or your own) sends it back to base. Passing over marbles is free.',
  '',
  'Finish lane: after a full lap of 72 from your own start, a marble turns in. The count must be exact: no overshooting past the fourth slot and no jumping a parked marble.',
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

// ---- anti-stall: a disconnected or timed-out seat can be skipped ----------
// Mirrors Ludo's forceSkip: any player may submit it, but it only bites when
// the turn holder is disconnected or has sat on the turn past STALL_MS. The
// stalled seat loses its first card so the round still drains toward the next
// deal; a hand already empty mid-round has nothing to lose and just passes on.
function doForceSkip(s, move, room) {
  if (s.phase !== 'play') return keep(s)
  const turnSeat = s.turnSeat
  const holder = (Array.isArray(room?.players) ? room.players : []).find((p) => Number(p?.seat) === turnSeat)
  const startedAt = Number(room?.turn?.startedAt) || 0
  const stale = startedAt > 0 && (Date.now() - startedAt) > STALL_MS
  const gone = !holder || holder.connected === false
  if (!stale && !gone) return keep(s)
  const hand = s.hands[turnSeat] || []
  const hands = hand.length ? s.hands.map((h, k) => (k === turnSeat ? h.slice(1) : h)) : s.hands
  const last = { seat: turnSeat, owner: turnSeat, card: hand.length ? hand[0] : null, mode: 'discard', kills: 0 }
  return advance(s, turnSeat, hands, s.marbles, last, move)
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
    case 'forceSkip': return doForceSkip(s, m, room)
    default: return keep(s)
  }
}

// ===========================================================================
// GEOMETRY — a real board, not a diagram.
//
// The 72 squares sit on a ROUNDED SQUARE walked by arc length, so every hole is
// exactly the same distance from its neighbours, corners included. Index 0 is
// always the VIEWER's own start square at bottom-centre and the index grows to
// the right — which is what puts the next player on the viewer's right (see
// THE DIRECTION DECISION at the top).
//
// One 18-index block is one straight side plus one corner, so each player's
// side is the block centred on their start: [off*18-9, off*18+9].
// ===========================================================================
const RR = 43            // half-size of the ring, in a 0..100 board box
const CR = 13            // corner radius
const K = RR - CR        // half length of a straight run
const STRAIGHT = 2 * K
const ARC = (Math.PI * CR) / 2
const PERIM = 4 * STRAIGHT + 4 * ARC
const PITCH = PERIM / TRACK
const HALF_PITCH = PITCH / 2

const HOLE_R = 1.85
const LANE_R = 2.0
const MR = 2.1           // marble radius

function ringPoint(u) {
  let s = (((u * PITCH) % PERIM) + PERIM) % PERIM
  const half = STRAIGHT / 2
  if (s < half) return { x: 50 + s, y: 50 + RR }
  s -= half
  if (s < ARC) { const a = (s / ARC) * (Math.PI / 2); return { x: 50 + K + CR * Math.sin(a), y: 50 + K + CR * Math.cos(a) } }
  s -= ARC
  if (s < STRAIGHT) return { x: 50 + RR, y: 50 + K - s }
  s -= STRAIGHT
  if (s < ARC) { const a = (s / ARC) * (Math.PI / 2); return { x: 50 + K + CR * Math.cos(a), y: 50 - K - CR * Math.sin(a) } }
  s -= ARC
  if (s < STRAIGHT) return { x: 50 + K - s, y: 50 - RR }
  s -= STRAIGHT
  if (s < ARC) { const a = (s / ARC) * (Math.PI / 2); return { x: 50 - K - CR * Math.sin(a), y: 50 - K - CR * Math.cos(a) } }
  s -= ARC
  if (s < STRAIGHT) return { x: 50 - RR, y: 50 - K + s }
  s -= STRAIGHT
  if (s < ARC) { const a = (s / ARC) * (Math.PI / 2); return { x: 50 - K - CR * Math.cos(a), y: 50 + K + CR * Math.sin(a) } }
  s -= ARC
  return { x: 50 - K + s, y: 50 + RR }
}

// the direction of travel along a player's own side, and the inward normal
const TRAVEL = [{ x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 1 }]
const INWARD = [{ x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }]

// the lane hangs off the half-square BEFORE the start, which is what gives the
// four lanes their pinwheel — exactly how a drilled board reads
const LANE_D0 = 6.6
const LANE_DP = 5.3
function laneXY(off, slot) {
  const d = LANE_D0 + slot * LANE_DP
  const inw = INWARD[off]
  const base = ringPoint(off * PER - 0.5)
  return { x: base.x + inw.x * d, y: base.y + inw.y * d }
}

// the base plate sits in the inner corner BEHIND the player's start, so each
// of the four corners belongs to exactly one player
const BASE_OFF = 19
const BASE_DIAG = [{ x: -1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }]
function baseHub(off) {
  const d = BASE_DIAG[off]
  return { x: 50 + d.x * BASE_OFF, y: 50 + d.y * BASE_OFF }
}
function baseXY(off, k) {
  const h = baseHub(off)
  return { x: h.x + (k % 2 ? 4.4 : -4.4), y: h.y + (k > 1 ? 4.4 : -4.4) }
}

const offsetOf = (o, viewer) => (((o - viewer) % 4) + 4) % 4

// where a marble sits, in the viewer's rotated frame
function posXY(o, p, viewer, m = 0) {
  const off = offsetOf(o, viewer)
  if (isBase(p)) return baseXY(off, m)
  if (isLane(p)) return laneXY(off, p - L0)
  return ringPoint(off * PER + p)
}

// the same point for a FRACTIONAL q, so a marble walks its real path square by
// square instead of teleporting. q < 72 is the loop, q >= 72 is the lane.
function pathXY(o, q, viewer) {
  const off = offsetOf(o, viewer)
  if (q <= TRACK - 1) return ringPoint(off * PER + q)
  if (q >= TRACK) {
    const slot = Math.min(LANE - 1, q - TRACK)
    const s0 = Math.floor(slot)
    const f = slot - s0
    const a = laneXY(off, s0)
    if (f <= 0 || s0 >= LANE - 1) return a
    const b = laneXY(off, s0 + 1)
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
  }
  const f = q - (TRACK - 1)
  const a = ringPoint(off * PER + TRACK - 1)
  const b = laneXY(off, 0)
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
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

// partnership colours, identical to cardgames.css: seats 0+2 cool, 1+3 warm
const SEAT_COLOR = ['#38bdf8', '#fbbf24', '#818cf8', '#fb7185']
const SEAT_LITE = ['#d7f2ff', '#fff0c4', '#e3e5ff', '#ffdfe4']
const SEAT_DARK = ['#0a4f74', '#7c5205', '#343a92', '#87202f']

function arcPath(r, a0, a1) {
  const x0 = (Math.cos(a0) * r).toFixed(2)
  const y0 = (Math.sin(a0) * r).toFixed(2)
  const x1 = (Math.cos(a1) * r).toFixed(2)
  const y1 = (Math.sin(a1) * r).toFixed(2)
  return 'M' + x0 + ' ' + y0 + 'A' + r.toFixed(2) + ' ' + r.toFixed(2) + ' 0 0 1 ' + x1 + ' ' + y1
}
const MB_RIM = arcPath(MR * 0.84, 0.2, 1.4)

// ONE piece. Outer <g> = position, attribute form, no CSS px (trap 1).
// Inner <g class="jak-mb"> = the only place a CSS transform runs, and it only
// ever rotates or scales. The single hit circle is the only tappable part and
// it is barely wider than the body (trap 2).
function Piece({ x, y, seatIx, cls, scale, onTap, label: aria }) {
  const tapAble = typeof onTap === 'function'
  return (
    <g className={cls} transform={'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ')'}>
      <g className="jak-mb" transform={scale && scale !== 1 ? 'scale(' + scale.toFixed(3) + ')' : undefined}>
        <ellipse className="jak-mb-sh" cx="0.3" cy={MR * 1.05} rx={MR * 0.95} ry={MR * 0.36} />
        <circle r={MR} fill={'url(#jak-mb' + seatIx + ')'} />
        <circle className="jak-mb-rim" r={MR} />
        <path className="jak-mb-lite" d={MB_RIM} />
        <ellipse
          className="jak-mb-shine"
          cx={-MR * 0.32}
          cy={-MR * 0.44}
          rx={MR * 0.3}
          ry={MR * 0.19}
          transform="rotate(-28)"
        />
        <circle className="jak-mb-spark" cx={MR * 0.36} cy={-MR * 0.5} r={MR * 0.1} />
        <circle className="jak-mb-halo" r={MR * 1.4} fill="none" />
      </g>
      {tapAble ? (
        <circle
          className="jak-mb-hit"
          r={MR * 1.12}
          onClick={onTap}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(e) } }}
          role="button"
          tabIndex={0}
          aria-label={aria}
        />
      ) : null}
    </g>
  )
}

// ---------------------------------------------------------------------------
// local fallback table — one device, pass and play, running the SAME reduce
// ---------------------------------------------------------------------------
const LOCAL_NAMES = ['اللاعب الأول', 'اللاعب الثاني', 'اللاعب الثالث', 'اللاعب الرابع']

// the machine level, remembered between rounds on this device only
const LEVEL_KEY = 'ml.games.jackaroo.level'
const LEVELS = ['easy', 'normal', 'hard']
function readLevel() {
  try {
    const v = localStorage.getItem(LEVEL_KEY)
    return LEVELS.includes(v) ? v : 'normal'
  } catch (_) { return 'normal' }
}

// `bots` true builds the «العب ضد الكمبيوتر» table: seat zero is the player,
// the other three are machine seats — named as machines, flagged as machines.
function makeLocalRoom(playerName, bots, lang) {
  return {
    roomId: 'local',
    gameId: 'jackaroo',
    status: 'playing',
    local: true,
    players: [0, 1, 2, 3].map((seat) => ({
      id: (bots && seat > 0 ? 'bot-' : 'local-') + seat,
      name: seat === 0
        ? (playerName || LOCAL_NAMES[0])
        : (bots ? botLabel(seat - 1, 3, lang) : LOCAL_NAMES[seat]),
      bot: !!bots && seat > 0,
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
  // Jackaroo is a fixed four-seat partnership game, so a solo round always
  // means three machine seats; any positive value here selects it.
  soloBots = null,
}) {
  const ar = lang !== 'en'
  const remote = !!room
  // Latched on the first render: the lobby hand-off expires after a minute and
  // re-reading it every render would turn a bot table back into a hot-seat one.
  const [vsBot] = useState(() => !remote && (Number(soloBots) > 0 || !!takeSoloIntent('jackaroo')))
  const [localRoom, setLocalRoom] = useState(() => makeLocalRoom(playerName, vsBot, lang))
  const [level, setLevel] = useState(readLevel)
  const [rules, setRules] = useState(false)
  const [sel, setSel] = useState(null)      // { i, card }
  const [pickA, setPickA] = useState(null)  // first marble of a J swap or a split 7
  const [legN, setLegN] = useState(null)    // how far the first marble of a split 7 goes
  const [shake, setShake] = useState(null)  // { key, id } — the wobble on an illegal tap
  const [note, setNote] = useState(null)    // { msg, id } — the reason line for it
  const [flash, setFlash] = useState(null)  // round rollover / event banner
  const [tick, setTick] = useState(0)       // re-render pulse for the stall detector only

  const table = remote ? room : localRoom
  const st = useMemo(() => normalise(table?.state), [table])

  // ---- one measured unit drives every size on screen ----------------------
  // Measured, not guessed: --jak-u is min(width,height)/100 of the real element
  // box, so a 360px phone and a 1920x1080 venue TV get the same layout at two
  // different scales with no breakpoints and no fixed type size.
  const rootRef = useRef(null)
  const stageRef = useRef(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  // the play area's OWN box decides the layout: a portrait tablet has a tall
  // root but a WIDE stage, and that is the shape the board has to fit into.
  // Reading it is loop-free — the wide class rearranges the inside of the
  // stage and never changes the stage's own height.
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = rootRef.current
    const sl = stageRef.current
    if (!el) return undefined
    if (typeof ResizeObserver === 'undefined') {
      setBox({ w: el.clientWidth, h: el.clientHeight })
      if (sl) setStageBox({ w: sl.clientWidth, h: sl.clientHeight })
      return undefined
    }
    const put = (set) => (r) => set((b) => ((Math.abs(b.w - r.width) < 1 && Math.abs(b.h - r.height) < 1) ? b : { w: r.width, h: r.height }))
    const onRoot = put(setBox)
    const onStage = put(setStageBox)
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (!e.contentRect) continue
        if (e.target === el) onRoot(e.contentRect)
        else onStage(e.contentRect)
      }
    })
    ro.observe(el)
    if (sl) ro.observe(sl)
    return () => ro.disconnect()
  }, [])
  const unit = box.w > 0 ? Math.max(3.1, Math.min(9, Math.min(box.w, box.h) / 100)) : 3.9
  const wide = stageBox.w > 0 && stageBox.w / Math.max(1, stageBox.h) >= 1.28
  // A hand is only ever four cards, so on a tall phone the board runs out of
  // WIDTH long before the column runs out of height. Rather than leave that
  // height as a void under the board, it is handed to the cards — but only the
  // part the board could not have used anyway (h - 1.62w), so a short screen
  // still gives every pixel to the board. Measured, not guessed.
  const cardW = box.w > 0
    ? Math.max(34, Math.min(
      110,
      box.w * 0.17,
      unit * (wide ? 8.5 : 11) + Math.max(0, box.h - box.w * 1.62) * 0.5,
    ))
    : 43

  const [reduced] = useState(() => {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) } catch (_) { return false }
  })

  // hot-seat follows the turn (the phone is handed round); against the computer
  // the player holds seat zero for the whole game
  const seat = remote
    ? (Number.isInteger(mySeat) ? mySeat : 0)
    : (vsBot ? 0 : (Number.isInteger(st.turnSeat) ? st.turnSeat : 0))
  // A remote viewer with no seat (spectator, or a snapshot arriving before the
  // join settles) falls back to seat 0 above so the BOARD can rotate — but it
  // must never be handed seat 0's cards or controls (see the hand gate below).
  const seated = !remote || Number.isInteger(mySeat)

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

  // A solo table is already full, so it deals itself instead of asking the one
  // player present to press «ابدأ اللعب» against three machines.
  useEffect(() => {
    if (!vsBot || st.phase !== 'waiting') return undefined
    const id = setTimeout(() => submit({ t: 'deal', dealer: 3 }), 260)
    return () => clearTimeout(id)
  }, [vsBot, st.phase, submit])

  // ---- machine seats ------------------------------------------------------
  // The bot enumerates its options with THIS file's own `movesForCard` and its
  // chosen move is re-validated by `reduce` before it is submitted, so a
  // machine seat is held to the same rulebook as the player. It reads only its
  // own hand; the marbles it scores are public on the board.
  useEffect(() => {
    if (!vsBot || st.phase !== 'play') return undefined
    if (st.turnSeat === 0) return undefined
    const id = setTimeout(() => {
      const mv = botMoveFor('jackaroo', st, st.turnSeat, { reduce, room: localRoom, helpers: botHelpers, level })
      if (mv) submit(mv)
    }, BOT_DELAY_MS)
    return () => clearTimeout(id)
  }, [vsBot, st, localRoom, submit, level])

  // slow re-render pulse only so the skip affordance can appear while a
  // stalled turn ages; nothing else polls (same rhythm as Ludo)
  useEffect(() => {
    if (!remote || st.phase !== 'play') return undefined
    const iv = setInterval(() => setTick((n) => (n + 1) % 100000), 3000)
    return () => clearInterval(iv)
  }, [remote, st.phase])

  // clear the selection whenever the board moves on
  const stamp = st.round + ':' + st.turnSeat + ':' + (st.hands[seat] || []).length
  useEffect(() => { setSel(null); setPickA(null); setLegN(null) }, [stamp])

  const myTeam = team(seat)
  useEffect(() => {
    onScore?.(teamHome(st.marbles, myTeam) * 10 + (st.winnerTeam === myTeam ? 40 : 0))
  }, [onScore, st.marbles, st.winnerTeam, myTeam])

  // =========================================================================
  // MOTION + SOUND — one effect over the state diff, ref-guarded so nothing
  // fires on mount or on a room rehydration. Every marble that moved gets a
  // FLIGHT: a walk follows the real track square by square, a kill arcs the
  // victim home, a swap arcs both ways. Because the flights come from the diff
  // and not from the local move, a remote player and a venue screen see the
  // same travel the mover sees.
  // =========================================================================
  const [anim, setAnim] = useState(null)  // { t0, end, list }
  const [fx, setFx] = useState([])        // celebration marks
  const [now, setNow] = useState(0)
  const sndRef = useRef(null)
  // Timers live in refs, NOT in the effect's cleanup: this effect re-runs on
  // every state snapshot, and a bot table produces one every ~700ms. Cleaning
  // them up on re-run would cancel the "hide the round banner" timer before it
  // ever fired and pin the banner to the screen for the rest of the game.
  const fxTimer = useRef(0)
  const flashTimer = useRef(0)
  const killTimer = useRef(0)

  useEffect(() => {
    const cur = {
      mk: JSON.stringify(st.marbles),
      lk: JSON.stringify(st.last),
      round: st.round,
      phase: st.phase,
      turnSeat: st.turnSeat,
      marbles: st.marbles,
    }
    const prev = sndRef.current
    sndRef.current = cur
    if (!prev) return undefined

    const moved = cur.mk !== prev.mk
    const mode = (st.last && st.last.mode) || ''

    if (cur.round !== prev.round && cur.round > 0) {
      play('deal')
      setFlash({
        id: cur.round,
        msg: (ar ? 'الجولة' : 'Round') + ' ' + fmt(cur.round, ar),
        deal: ar ? 'أوراق جديدة' : 'new cards',
        a: fmt(teamHome(st.marbles, 0), ar),
        b: fmt(teamHome(st.marbles, 1), ar),
      })
      clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlash(null), 2800)
    }

    if (moved) {
      const list = []
      const marks = []
      let walk = 0
      for (let o = 0; o < 4; o += 1) {
        for (let m = 0; m < 4; m += 1) {
          const a = prev.marbles[o] ? prev.marbles[o][m] : undefined
          const b = st.marbles[o][m]
          if (a === b || a === undefined) continue
          if (isBase(b) && !isBase(a)) { list.push({ o, m, kind: 'home', a, b, dur: 480, delay: 0, bow: 1 }); continue }
          if (isBase(a) && !isBase(b)) { list.push({ o, m, kind: 'out', a, b, dur: 300, delay: 0, bow: 1 }); continue }
          if (mode === 'swap') { list.push({ o, m, kind: 'swap', a, b, dur: 430, delay: 0, bow: list.length ? -1 : 1 }); continue }
          const steps = Math.abs(toQ(b) - toQ(a))
          const dur = Math.max(240, Math.min(760, steps * 95))
          walk = Math.max(walk, dur)
          list.push({ o, m, kind: 'walk', a, b, dur, delay: 0 })
          if (isLane(b) && !isLane(a)) {
            const p = posXY(o, b, seat, m)
            marks.push({ id: 'p' + o + m + cur.round + b, x: p.x, y: p.y, kind: 'park', delay: dur })
          }
        }
      }
      for (const f of list) {
        if (f.kind !== 'home') continue
        f.delay = walk ? Math.max(0, walk - 110) : 0
        const p = posXY(f.o, f.a, seat, f.m)
        marks.push({ id: 'k' + f.o + f.m + cur.round + f.a, x: p.x, y: p.y, kind: 'kill', delay: f.delay })
      }

      const kills = st.last && st.last.kills > 0
      play(mode === 'out' ? 'card' : 'move', { gain: 0.9 })
      if (kills) {
        const d = list.find((f) => f.kind === 'home')
        clearTimeout(killTimer.current)
        killTimer.current = setTimeout(() => play('capture'), reduced ? 0 : ((d && d.delay) || 0))
      }

      if (!reduced && list.length) {
        const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now())
        const end = t0 + list.reduce((mx, f) => Math.max(mx, f.delay + f.dur), 0)
        setAnim({ t0, end, list })
        setNow(t0)
        if (marks.length) {
          setFx(marks)
          clearTimeout(fxTimer.current)
          fxTimer.current = setTimeout(() => setFx([]), 1400)
        }
      }
    } else if (cur.lk !== prev.lk && st.last) {
      play('card') // a card was spent without a marble moving (burn / discard)
    }

    if (cur.phase !== prev.phase && cur.phase === 'end') {
      play(st.winnerTeam === myTeam ? 'win' : 'lose')
      return undefined
    }
    // hot-seat (no bots, same phone) would chime on every handover — noise
    if (cur.turnSeat !== prev.turnSeat && cur.turnSeat === seat && cur.phase === 'play' && seated && (remote || vsBot)) {
      play('turn', { gain: 0.8 })
    }
    return undefined
  }, [st, seat, seated, myTeam, remote, vsBot, ar, reduced])

  // the only place these timers are cancelled: leaving the board
  useEffect(() => () => {
    clearTimeout(fxTimer.current)
    clearTimeout(flashTimer.current)
    clearTimeout(killTimer.current)
  }, [])

  // the frame pump — runs only while a flight is in the air
  useEffect(() => {
    if (!anim) return undefined
    let raf = 0
    const tickFrame = () => {
      const t = (typeof performance !== 'undefined' ? performance.now() : Date.now())
      setNow(t)
      if (t >= anim.end) { setAnim(null); return }
      raf = requestAnimationFrame(tickFrame)
    }
    raf = requestAnimationFrame(tickFrame)
    return () => cancelAnimationFrame(raf)
  }, [anim])

  const flights = useMemo(() => {
    const map = {}
    if (anim) for (const f of anim.list) map[f.o + ':' + f.m] = f
    return map
  }, [anim])

  // ---- where every marble is drawn RIGHT NOW ------------------------------
  const drawPos = useCallback((o, m) => {
    const f = flights[o + ':' + m]
    const still = st.marbles[o][m]
    if (!f || !anim) return { ...posXY(o, still, seat, m), s: 1 }
    const el = now - anim.t0 - f.delay
    if (el <= 0) return { ...posXY(o, f.a, seat, m), s: 1 }
    const t = Math.min(1, el / f.dur)
    if (f.kind === 'walk') {
      const qa = toQ(f.a)
      const qb = toQ(f.b)
      const e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2
      const q = qa + (qb - qa) * e
      const p = pathXY(o, q, seat)
      const frac = q - Math.floor(q)
      const hop = Math.abs(Math.sin(Math.PI * frac)) * 0.85
      return { x: p.x, y: p.y - hop, s: 1 + 0.06 * Math.sin(Math.PI * t) }
    }
    const A = posXY(o, f.a, seat, m)
    const B = posXY(o, f.b, seat, m)
    const e = 1 - ((1 - t) ** 3)
    const dx = B.x - A.x
    const dy = B.y - A.y
    const len = Math.max(0.001, Math.hypot(dx, dy))
    let nxv = -dy / len
    let nyv = dx / len
    if (f.kind === 'home') {
      const mxp = (A.x + B.x) / 2 - 50
      const myp = (A.y + B.y) / 2 - 50
      if (nxv * mxp + nyv * myp < 0) { nxv = -nxv; nyv = -nyv }
    } else if (f.bow < 0) { nxv = -nxv; nyv = -nyv }
    const bow = Math.min(16, len * 0.24)
    const cx = (A.x + B.x) / 2 + nxv * bow
    const cy = (A.y + B.y) / 2 + nyv * bow
    const it = 1 - e
    const x = it * it * A.x + 2 * it * e * cx + e * e * B.x
    const y = it * it * A.y + 2 * it * e * cy + e * e * B.y
    return { x, y, s: 1 + 0.42 * Math.sin(Math.PI * t) }
  }, [flights, anim, now, st.marbles, seat])

  // ---- copy ---------------------------------------------------------------
  const t = ar
    ? {
      rules: 'الشرح', close: 'إغلاق', deal: 'ابدأ اللعب', exit: 'خروج',
      waitPlayers: 'بانتظار اكتمال الطاولة', needFour: 'اللعبة لأربعة لاعبين، كل لاعب يجلس مقابل شريكه.',
      hostStarts: 'يبدأ مضيف الغرفة التوزيع.', waitingFor: 'الدور على',
      pickCard: 'اختر ورقة من يدك', pickMarble: 'اختر بيدقاً، والأهداف مطوّقة بالذهب',
      pickSwapA: 'اختر بيدقك الذي تريد تبديله', pickSwapB: 'اختر البيدق الذي تبادله معه',
      pickSevenA: 'السبعة: اختر البيدق الأول', pickSevenN: 'كم خانة يتقدّم هذا البيدق؟',
      pickSevenB: 'اختر البيدق الثاني', rest: 'الباقي',
      noMove: 'لا حركة لهذه الورقة', discard: 'ارمِ الورقة', full7: 'كاملة',
      us: 'فريقنا', them: 'الخصوم', teamA: 'الفريق الأول', teamB: 'الفريق الثاني',
      win: 'فزتم', lose: 'فاز الخصوم', round: 'الجولة', now: 'الآن',
      partnerNow: 'بيادقك كلها وصلت، وأوراقك تحرّك بيادق شريكك الآن.',
      you: 'أنت', partner: 'شريكك', watching: 'أنت تشاهد الطاولة',
      skip: 'تخطَّ اللاعب المتوقف', undo: 'تراجع', off: 'منقطع',
      mHome: 'في البيت', mTrack: 'على المسار', mLane: 'في الخانة',
      played: 'لعب', out: 'أخرج بيدقاً', swapped: 'بدّل بيدقين', walked: 'تقدّم',
      sevenPlay: 'لعب السبعة', threw: 'رمى الورقة', andKill: 'وقتل بيدقاً',
      rbase: 'هذا البيدق في البيت، لا يخرجه إلا آص أو شايب.',
      rlaneBack: 'البيدق دخل خانتك، ولا رجوع منها إلى المسار.',
      rtooFarBack: 'لا يمكن التراجع أبعد من دورة كاملة خلف انطلاقك.',
      rovershoot: 'هذا العدد يتجاوز آخر موضع في خانتك، والدخول يحتاج عدداً مضبوطاً.',
      rlaneBlocked: 'بيدقك الراقد في الخانة يسدّ الطريق، ولا قفز داخل الخانة.',
      rneedTrack: 'الولد يبدّل بيدقين على المسار فقط.',
      rnoSwapMate: 'لا يوجد بيدق آخر على المسار لتبادله.',
      rnoSecond: 'لا يوجد بيدق ثانٍ يكمل بقية السبعة.',
      rnoMove: 'هذه الورقة لا تحرّك هذا البيدق.',
      rnotYours: 'هذا ليس بيدقك.',
      rnotNow: 'ليس هذا اختيار هذه الخطوة.',
      levelLbl: 'الكمبيوتر', easy: 'سهل', normal: 'عادي', hard: 'صعب',
      levelTip: 'اضغط لتغيير مستوى الكمبيوتر',
      cA: 'آص: أخرج بيدقاً من البيت أو تقدّم خانة', cK: 'شايب: أخرج بيدقاً من البيت أو تقدّم 13',
      cQ: 'بنت: تقدّم 12', cJ: 'ولد: بدّل بيدقين على المسار',
      c7: 'سبعة: سبع خانات، ويجوز تقسيمها بين بيدقين', c4: 'أربعة: تراجع أربع خانات',
      cN: 'تقدّم', newDeal: 'أوراق جديدة',
    }
    : {
      rules: 'Rules', close: 'Close', deal: 'Start', exit: 'Exit',
      waitPlayers: 'Waiting for the table', needFour: 'Four players, partners opposite.',
      hostStarts: 'The host starts.', waitingFor: 'Turn:',
      pickCard: 'Pick a card', pickMarble: 'Pick a marble. Legal targets are ringed',
      pickSwapA: 'Pick your marble to swap', pickSwapB: 'Pick the marble to swap with',
      pickSevenA: 'Seven: pick the first marble', pickSevenN: 'How far does it go?',
      pickSevenB: 'Pick the second marble', rest: 'left',
      noMove: 'No legal move for this card', discard: 'Discard', full7: 'Full',
      us: 'Us', them: 'Them', teamA: 'Team one', teamB: 'Team two',
      win: 'You win', lose: 'They win', round: 'Round', now: 'NOW',
      partnerNow: 'All your marbles are in, so your cards now move your partner\'s.',
      you: 'You', partner: 'Partner', watching: 'You are watching',
      skip: 'Skip stalled player', undo: 'Back', off: 'offline',
      mHome: 'in base', mTrack: 'on track', mLane: 'parked',
      played: 'played', out: 'released a marble', swapped: 'swapped two marbles', walked: 'moved',
      sevenPlay: 'played the seven', threw: 'discarded', andKill: 'and sent one home',
      rbase: 'This marble is in the base. Only an Ace or a King releases it.',
      rlaneBack: 'A marble inside your lane never comes back out.',
      rtooFarBack: 'It cannot go more than one lap behind your start.',
      rovershoot: 'That count runs past the last slot of your lane, and it must be exact.',
      rlaneBlocked: 'Your own parked marble blocks the way, and there is no jumping inside the lane.',
      rneedTrack: 'A Jack only swaps marbles that are out on the loop.',
      rnoSwapMate: 'There is no other marble on the loop to swap with.',
      rnoSecond: 'No second marble can take the rest of the seven.',
      rnoMove: 'This card cannot move this marble.',
      rnotYours: 'That marble is not yours to move.',
      rnotNow: 'Not the choice this step is asking for.',
      levelLbl: 'Computer', easy: 'Easy', normal: 'Normal', hard: 'Hard',
      levelTip: 'Tap to change the computer level',
      cA: 'Ace: release from base, or move 1', cK: 'King: release from base, or move 13',
      cQ: 'Queen: move 12', cJ: 'Jack: swap two marbles on the loop',
      c7: 'Seven: seven squares, splittable across two marbles', c4: 'Four: move four squares backwards',
      cN: 'Move', newDeal: 'new cards',
    }

  const nameOf = (sx) => bySeat[sx]?.name || (ar ? 'مقعد فارغ' : 'Empty')
  const isMyTurn = seated && st.turnSeat === seat && st.phase === 'play'
  const owner = activeOwner(st.marbles, seat)
  const myHand = seated ? (st.hands[seat] || []) : []

  // Same anti-stall affordance as Ludo: when the turn holder is gone or has
  // sat on the turn past STALL_MS, the other players get a skip button, and
  // `reduce` re-checks the window before honouring it.
  const stalled = useMemo(() => {
    if (!remote || !seated || st.phase !== 'play' || isMyTurn) return false
    const holder = players.find((p) => Number(p?.seat) === st.turnSeat)
    if (!holder || holder.connected === false) return true
    const startedAt = Number(table?.turn?.startedAt) || 0
    return startedAt > 0 && (Date.now() - startedAt) > STALL_MS
  }, [remote, seated, st.phase, st.turnSeat, isMyTurn, players, table, tick])

  // legal descriptors for the selected card, recomputed from live state
  const legal = useMemo(
    () => (sel && isMyTurn ? movesForCard(st.marbles, owner, sel.card) : []),
    [sel, isMyTurn, st.marbles, owner],
  )

  // which cards in hand have no move at all (so may be discarded)
  const deadCards = useMemo(() => {
    if (!isMyTurn) return []
    return myHand.map((c) => movesForCard(st.marbles, owner, c).length === 0)
  }, [isMyTurn, myHand, st.marbles, owner])

  const isSeven = !!sel && rankOf(sel.card) === '7'
  const isJack = !!sel && rankOf(sel.card) === 'J'
  const selDead = !!sel && legal.length === 0

  // TRAP 3: a card with nothing to do must say WHY, not just go quiet. The most
  // informative of the four marbles' reasons is the one that gets printed.
  const deadWhy = useMemo(() => {
    if (!sel || !selDead || !isMyTurn) return ''
    const found = new Set()
    for (let m = 0; m < 4; m += 1) found.add(blockReason(st.marbles, owner, m, sel.card))
    const key = REASON_ORDER.find((k) => found.has(k))
    return key ? (t['r' + key] || '') : ''
  }, [sel, selDead, isMyTurn, st.marbles, owner, t])
  // the two-step seven: 'a' pick a marble, 'n' pick its distance, 'b' pick the
  // marble that takes the rest
  const stage = !isSeven ? null : (!pickA ? 'a' : (legN == null ? 'n' : 'b'))

  const say = useCallback((msg) => {
    setNote({ msg, id: Date.now() })
  }, [])
  useEffect(() => {
    if (!note) return undefined
    const id = setTimeout(() => setNote(null), 3200)
    return () => clearTimeout(id)
  }, [note])
  useEffect(() => {
    if (!shake) return undefined
    const id = setTimeout(() => setShake(null), 460)
    return () => clearTimeout(id)
  }, [shake])

  const clearPick = useCallback(() => { setPickA(null); setLegN(null) }, [])

  const commit = useCallback((d) => {
    if (!sel) return
    submit({ t: 'play', seat, i: sel.i, card: sel.card, d })
    setSel(null)
    clearPick()
  }, [sel, seat, submit, clearPick])

  // ---- what can be tapped, and where a card can land ----------------------
  const view = useMemo(() => {
    const live = new Set()     // marbles that move the game on when tapped
    const ask = new Set()      // the owner's marbles that will explain themselves
    const targetMb = new Set() // marbles ringed as a swap partner
    const dim = new Set()      // the owner's marbles this card cannot move
    const blocks = new Set()   // parked marbles that are physically in the way
    const rings = []           // destination rings drawn on the board

    if (!isMyTurn || !sel) return { live, ask, targetMb, dim, blocks, rings }

    for (let m = 0; m < 4; m += 1) ask.add(owner + ':' + m)

    const ringFor = (key, d, text) => {
      const res = runDescriptor(st.marbles, owner, sel.card, d)
      if (!res) return
      const mm = d.mode === 'seven' ? (d.b ? d.b.m : d.a.m) : d.m
      const p = res.marbles[owner][mm]
      const pos = posXY(owner, p, seat, mm)
      rings.push({
        key,
        x: pos.x,
        y: pos.y,
        kind: res.kills.length ? 'kill' : (isLane(p) ? 'lane' : 'move'),
        text,
        act: () => commit(d),
      })
    }

    if (isJack) {
      if (!pickA) {
        for (const d of legal) live.add(owner + ':' + d.m)
      } else {
        live.add(owner + ':' + pickA.m)
        for (const d of legal) {
          if (d.m !== pickA.m) continue
          const key = d.o2 + ':' + d.j2
          live.add(key)
          targetMb.add(key)
          const pos = posXY(d.o2, st.marbles[d.o2][d.j2], seat, d.j2)
          rings.push({ key: 'sw' + key, x: pos.x, y: pos.y, kind: 'swap', text: '', act: null })
        }
      }
    } else if (isSeven) {
      if (stage === 'a') {
        for (const d of legal) live.add(owner + ':' + d.a.m)
      } else if (stage === 'n') {
        live.add(owner + ':' + pickA.m)
        const seen = new Set()
        for (const d of legal) {
          if (d.a.m !== pickA.m) continue
          const n = d.a.n
          if (seen.has(n)) continue
          seen.add(n)
          if (!d.b) {
            ringFor('n7', { mode: 'seven', a: { m: pickA.m, n: 7 }, b: null }, fmt(7, ar))
          } else {
            const res = step(st.marbles, owner, pickA.m, n)
            if (!res) continue
            const p = res.marbles[owner][pickA.m]
            const pos = posXY(owner, p, seat, pickA.m)
            rings.push({
              key: 'n' + n,
              x: pos.x,
              y: pos.y,
              kind: res.kills.length ? 'kill' : (isLane(p) ? 'lane' : 'move'),
              text: fmt(n, ar),
              act: () => setLegN(n),
            })
          }
        }
      } else {
        for (const d of legal) {
          if (!d.b || d.a.m !== pickA.m || d.a.n !== legN) continue
          live.add(owner + ':' + d.b.m)
          ringFor('b' + d.b.m, d, fmt(7 - legN, ar))
        }
      }
    } else {
      for (const d of legal) {
        live.add(owner + ':' + d.m)
        ringFor('d' + d.m, d, '')
      }
    }

    for (let m = 0; m < 4; m += 1) {
      const key = owner + ':' + m
      if (live.has(key)) continue
      if (pickA && pickA.o === owner && pickA.m === m) continue
      dim.add(key)
      if (blockReason(st.marbles, owner, m, sel.card) === 'laneBlocked') {
        for (const j of laneBlockers(st.marbles, owner, m, sel.card)) blocks.add(owner + ':' + j)
      }
    }

    return { live, ask, targetMb, dim, blocks, rings }
  }, [isMyTurn, sel, legal, pickA, legN, stage, isJack, isSeven, st.marbles, owner, seat, ar, commit])

  // the half-played first marble of a split seven, drawn as a translucent
  // stand-in so the player can see what they already spent
  const ghost = useMemo(() => {
    if (!isSeven || stage !== 'b' || !pickA || legN == null) return null
    const res = step(st.marbles, owner, pickA.m, legN)
    if (!res) return null
    const p = posXY(owner, res.marbles[owner][pickA.m], seat, pickA.m)
    return { x: p.x, y: p.y, seatIx: owner }
  }, [isSeven, stage, pickA, legN, st.marbles, owner, seat])

  const reasonFor = useCallback((o, m) => {
    if (!sel) return t.rnotNow
    if (o !== owner) return t.rnotYours
    if (isJack && pickA) return t.pickSwapB
    if (isSeven && stage === 'n') return t.pickSevenN
    if (isSeven && stage === 'b') return t.rnoSecond
    const why = blockReason(st.marbles, owner, m, sel.card)
    return why === 'none' ? t.rnotNow : (t['r' + why] || t.rnotNow)
  }, [sel, owner, isJack, isSeven, stage, pickA, st.marbles, t])

  const tapMarble = useCallback((o, m) => {
    if (!isMyTurn || !sel) return
    const key = o + ':' + m
    // tapping the marble you already picked always takes the step back
    if (pickA && pickA.o === o && pickA.m === m) { clearPick(); play('click', { gain: 0.5 }); return }
    if (!view.live.has(key)) {
      setShake({ key, id: Date.now() })
      say(reasonFor(o, m))
      play('click', { gain: 0.5 })
      return
    }

    if (isJack) {
      if (!pickA) { setPickA({ o, m }); play('click'); return }
      commit({ mode: 'swap', m: pickA.m, o2: o, j2: m })
      return
    }

    if (isSeven) {
      if (stage === 'a') { setPickA({ o, m }); play('click'); return }
      if (stage !== 'b') return
      commit({ mode: 'seven', a: { m: pickA.m, n: legN }, b: { m, n: 7 - legN } })
      return
    }

    // release beats a plain step when both are on offer for a base marble
    const outMove = legal.find((d) => d.mode === 'out' && d.m === m)
    const stepMove = legal.find((d) => d.mode === 'step' && d.m === m)
    const d = outMove || stepMove
    if (d) commit(d)
  }, [isMyTurn, sel, view, isJack, isSeven, stage, pickA, legN, legal, owner, commit, clearPick, reasonFor, say])

  // the machine level cycles on the chip; it applies from the next machine turn
  const cycleLevel = useCallback(() => {
    setLevel((cur) => {
      const next = LEVELS[(LEVELS.indexOf(cur) + 1) % LEVELS.length]
      try { localStorage.setItem(LEVEL_KEY, next) } catch (_) { /* storage off */ }
      return next
    })
    play('click', { gain: 0.5 })
  }, [])

  const pickCard = useCallback((i, card) => {
    clearPick()
    setNote(null)
    play('click', { gain: 0.6 })
    setSel((cur) => (cur && cur.i === i ? null : { i, card }))
  }, [clearPick])

  // ---- board art. Static under the pieces, so the frame pump never rebuilds
  // 72 holes: React skips the memoised subtree on every animation frame.
  const boardArt = useMemo(() => {
    const holes = []
    for (let i = 0; i < TRACK; i += 1) {
      const p = ringPoint(i)
      holes.push(<circle key={'h' + i} className="jak-hole" cx={p.x.toFixed(2)} cy={p.y.toFixed(2)} r={HOLE_R} />)
      holes.push(<circle key={'r' + i} className="jak-hole-cut" cx={p.x.toFixed(2)} cy={p.y.toFixed(2)} r={HOLE_R} />)
    }

    const zones = [0, 1, 2, 3].map((off) => {
      const o = (seat + off) % 4
      const col = SEAT_COLOR[o]
      const a = off * PER - 9
      const b = off * PER + 9
      let band = ''
      for (let i = 0; i <= 26; i += 1) {
        const p = ringPoint(a + (b - a) * (i / 26))
        band += (i ? 'L' : 'M') + p.x.toFixed(2) + ' ' + p.y.toFixed(2)
      }
      const startP = ringPoint(off * PER)
      const laneEnd = laneXY(off, LANE - 1)
      const laneStart = ringPoint(off * PER - 0.5)
      const hub = baseHub(off)
      const dg = BASE_DIAG[off]
      const trv = TRAVEL[off]
      const inw = INWARD[off]
      const chevC = {
        x: ringPoint(off * PER + 4).x + inw.x * 4.4,
        y: ringPoint(off * PER + 4).y + inw.y * 4.4,
      }
      const px = -trv.y
      const py = trv.x
      const chev = 'M' + (chevC.x - trv.x * 0.4 + px * 1.1).toFixed(2) + ' ' + (chevC.y - trv.y * 0.4 + py * 1.1).toFixed(2)
        + 'L' + (chevC.x + trv.x * 1.2).toFixed(2) + ' ' + (chevC.y + trv.y * 1.2).toFixed(2)
        + 'L' + (chevC.x - trv.x * 0.4 - px * 1.1).toFixed(2) + ' ' + (chevC.y - trv.y * 0.4 - py * 1.1).toFixed(2)

      return (
        <g key={'z' + off}>
          <path
            className="jak-band"
            d={band}
            stroke={col}
            strokeWidth="5.6"
            opacity={st.turnSeat === o ? 0.24 : 0.1}
          />
          <path
            className="jak-channel"
            d={'M' + laneStart.x.toFixed(2) + ' ' + laneStart.y.toFixed(2) + 'L' + laneEnd.x.toFixed(2) + ' ' + laneEnd.y.toFixed(2)}
            stroke={col}
          />
          <rect
            className="jak-plate"
            x={hub.x - 10.2}
            y={hub.y - 10.2}
            width="20.4"
            height="20.4"
            rx="5"
            fill={col}
            fillOpacity="0.16"
            stroke={col}
            strokeOpacity="0.5"
          />
          <text
            className="jak-plate-ini"
            x={hub.x + dg.x * 8.2}
            y={hub.y + dg.y * 8.2}
            fill={col}
          >
            {initialsOf(bySeat[o]?.name)}
          </text>
          {Array.from({ length: LANE }).map((_, k) => {
            const p = laneXY(off, k)
            return (
              <g key={'l' + k}>
                <circle className="jak-hole" cx={p.x.toFixed(2)} cy={p.y.toFixed(2)} r={LANE_R} />
                <circle cx={p.x.toFixed(2)} cy={p.y.toFixed(2)} r={LANE_R} fill={col} fillOpacity="0.24" />
                <circle className="jak-hole-cut" cx={p.x.toFixed(2)} cy={p.y.toFixed(2)} r={LANE_R} stroke={col} strokeOpacity="0.6" />
              </g>
            )
          })}
          {Array.from({ length: 4 }).map((_, k) => {
            const p = baseXY(off, k)
            return (
              <g key={'b' + k}>
                <circle className="jak-hole" cx={p.x.toFixed(2)} cy={p.y.toFixed(2)} r={LANE_R} />
                <circle className="jak-hole-cut" cx={p.x.toFixed(2)} cy={p.y.toFixed(2)} r={LANE_R} stroke={col} strokeOpacity="0.45" />
              </g>
            )
          })}
          <circle
            className="jak-start-ring"
            cx={startP.x.toFixed(2)}
            cy={startP.y.toFixed(2)}
            r={HOLE_R + 0.85}
            stroke={col}
          />
          <path className="jak-chev" d={chev} stroke={col} />
        </g>
      )
    })

    return (
      <g className="jak-board-layer">
        {zones}
        {holes}
        <circle className="jak-med" cx="50" cy="50" r="15" />
        <circle className="jak-med-ring" cx="50" cy="50" r="13.4" />
      </g>
    )
  }, [seat, st.turnSeat, bySeat])

  // ---- pieces, painted so the actionable ones are last (trap 2) ------------
  const pieces = useMemo(() => {
    const rows = []
    for (let o = 0; o < 4; o += 1) {
      for (let m = 0; m < 4; m += 1) {
        const key = o + ':' + m
        const live = view.live.has(key)
        const askable = !live && view.ask.has(key)
        const flying = !!flights[key]
        const pos = drawPos(o, m)
        let cls = 'jak-piece'
        if (live) cls += ' is-live'
        else if (askable) cls += ' is-ask'
        if (view.dim.has(key)) cls += ' is-dim'
        if (view.targetMb.has(key)) cls += ' is-target'
        if (view.blocks.has(key)) cls += ' is-block'
        if (pickA && pickA.o === o && pickA.m === m) cls += ' is-pick'
        if (shake && shake.key === key) cls += ' is-shake'
        rows.push({
          key,
          z: flying ? 3 : live ? 2 : askable ? 1 : 0,
          node: (
            <Piece
              key={key + (shake && shake.key === key ? ':' + shake.id : '')}
              x={pos.x}
              y={pos.y}
              scale={pos.s}
              seatIx={o}
              cls={cls}
              onTap={live || askable ? () => tapMarble(o, m) : undefined}
              label={nameOf(o)}
            />
          ),
        })
      }
    }
    rows.sort((a, b) => a.z - b.z)
    return rows.map((r) => r.node)
  }, [view, flights, drawPos, pickA, shake, tapMarble, bySeat])

  // ---- copy for the one line that always says what is expected now ---------
  const cardNote = useMemo(() => {
    if (!sel) return ''
    const r = rankOf(sel.card)
    if (r === 'A') return t.cA
    if (r === 'K') return t.cK
    if (r === 'Q') return t.cQ
    if (r === 'J') return t.cJ
    if (r === '7') return t.c7
    if (r === '4') return t.c4
    return t.cN + ' ' + fmt(stepsOf(sel.card) || 0, ar)
  }, [sel, t, ar])

  const hint = !seated
    ? t.watching + '. ' + t.waitingFor + ' ' + nameOf(st.turnSeat)
    : note
      ? note.msg
      : !isMyTurn
        ? t.waitingFor + ' ' + nameOf(st.turnSeat)
        : !sel
          ? t.pickCard
          : selDead
            ? t.noMove + (deadWhy ? '. ' + deadWhy : '. ' + t.discard)
            : isJack
              ? (!pickA ? t.pickSwapA : t.pickSwapB)
              : isSeven
                ? (stage === 'a' ? t.pickSevenA : stage === 'n' ? t.pickSevenN : t.pickSevenB + ' (' + t.rest + ' ' + fmt(7 - legN, ar) + ')')
                : t.pickMarble

  const hintCls = 'jak-hint' + (note ? ' is-warn' : (isMyTurn && seated ? ' is-you' : ''))

  const lastLine = useMemo(() => {
    if (!st.last || !st.last.card) return null
    const who = nameOf(st.last.seat)
    const c = label(st.last.card)
    const mode = st.last.mode
    let what = t.played + ' ' + c
    if (mode === 'out') what = t.out + ' (' + c + ')'
    else if (mode === 'swap') what = t.swapped + ' (' + c + ')'
    else if (mode === 'seven') what = t.sevenPlay
    else if (mode === 'discard') what = t.threw + ' ' + c
    else if (mode === 'step') what = t.walked + ' ' + fmt(Math.abs(stepsOf(st.last.card) || 0), ar)
    return { who, what, kills: st.last.kills > 0, seatIx: st.last.seat }
  }, [st.last, t, ar, bySeat])

  const showLobby = st.phase === 'waiting' && !vsBot
  const showEnd = st.phase === 'end'

  // pods: the three seats around the board, in SCREEN order left -> top -> right.
  // A viewer with no seat gets all four, because none of them is "you".
  const podSeats = seated
    ? [(seat + 3) % 4, (seat + 2) % 4, (seat + 1) % 4]
    : [(seat + 3) % 4, (seat + 2) % 4, (seat + 1) % 4, seat]

  const renderPod = (sx, mine) => {
    const p = bySeat[sx]
    const row = st.marbles[sx] || []
    const cards = (st.hands[sx] || []).length
    const isTurn = st.turnSeat === sx && st.phase === 'play'
    return (
      <div
        key={sx}
        className={'jak-pod' + (isTurn ? ' is-turn' : '') + (team(sx) === myTeam && seated ? ' is-mate' : '') + (p && p.connected === false ? ' is-off' : '')}
        style={{ '--pc': SEAT_COLOR[sx] }}
        dir={ar ? 'rtl' : 'ltr'}
      >
        <span className="jak-pod-av" aria-hidden="true">{initialsOf(p?.name)}</span>
        <span className="jak-pod-col">
          <span className="jak-pod-nm">{mine ? t.you : (p?.name || (ar ? 'مقعد فارغ' : 'Empty'))}</span>
          <span className="jak-pod-sub">
            <span className="jak-mp" aria-hidden="true">
              {row.map((q, k) => (
                <i key={k} className={isLane(q) ? 'is-lane' : (isBase(q) ? '' : 'is-track')} />
              ))}
            </span>
            {st.phase === 'play' ? (
              <span className="cg-backs" aria-hidden="true">
                {Array.from({ length: Math.min(4, cards) }).map((_, k) => <i key={k} className="cg-back" />)}
              </span>
            ) : null}
          </span>
        </span>
        {isTurn ? <span className="jak-pod-tag">{t.now}</span> : null}
      </div>
    )
  }

  const teamPill = (tm) => {
    const n = teamHome(st.marbles, tm)
    const mine = seated && tm === myTeam
    const who = [tm, tm + 2].map((sx) => bySeat[sx]?.name || (ar ? 'فارغ' : 'Empty')).join(' + ')
    return (
      <span className={'jak-team' + (mine ? ' is-us' : '')}>
        <span className="jak-team-nm">{seated ? (mine ? t.us : t.them) : (tm === 0 ? t.teamA : t.teamB)}</span>
        <span className="jak-team-who">{who}</span>
        <span className="jak-tp" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, k) => <i key={k} className={k < n ? 'is-on' : ''} />)}
        </span>
        <span className="jak-team-n">{fmt(n, ar)}</span>
      </span>
    )
  }

  return (
    <div
      ref={rootRef}
      className="cg-root jak-root"
      dir={ar ? 'rtl' : 'ltr'}
      style={{ '--cg-brand': brand, '--jak-u': unit.toFixed(2) + 'px', '--cg-card-w': cardW.toFixed(1) + 'px' }}
    >
      <div className="cg-top">
        {teamPill(0)}
        {teamPill(1)}
        <span className="cg-top-sp" />
        {vsBot ? (
          <button
            type="button"
            className="cg-chip jak-levelbtn cg-press"
            onClick={cycleLevel}
            title={t.levelTip}
            aria-label={t.levelTip}
          >
            <span className="jak-level-lbl">{t.levelLbl}</span>
            <b>{t[level]}</b>
          </button>
        ) : null}
        {st.round > 0 ? <span className="cg-chip">{t.round} {fmt(st.round, ar)}</span> : null}
        <button type="button" className="cg-iconbtn cg-press" onClick={() => setRules(true)} aria-label={t.rules}>
          <span aria-hidden="true">?</span>
        </button>
      </div>

      <div ref={stageRef} className={'cg-stage jak-stage' + (wide ? ' is-wide' : '')}>
        <div className="jak-seats" dir="ltr">
          {podSeats.map((sx) => renderPod(sx, seated && sx === seat))}
        </div>

        <div className="jak-arena">
          <div className="jak-frame">
            <div className="jak-face">
              {/* role=group, not role=img: an img would hide the marbles from
                  assistive tech, and the marbles are the only way to move */}
              <svg className="jak-svg" viewBox="0 0 100 100" role="group" aria-label={ar ? 'لوح الجكارو' : 'Jackaroo board'}>
                <defs>
                  <radialGradient id="jak-hole" cx="46%" cy="32%" r="76%">
                    <stop offset="0%" stopColor="#3a2512" stopOpacity="0.92" />
                    <stop offset="58%" stopColor="#54371c" stopOpacity="0.78" />
                    <stop offset="100%" stopColor="#a8895c" stopOpacity="0.5" />
                  </radialGradient>
                  <radialGradient id="jak-med" cx="36%" cy="26%" r="82%">
                    <stop offset="0%" stopColor="#8a6636" stopOpacity="0.28" />
                    <stop offset="70%" stopColor="#5a3d1c" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#3a2411" stopOpacity="0.3" />
                  </radialGradient>
                  {[0, 1, 2, 3].map((i) => (
                    <radialGradient key={i} id={'jak-mb' + i} cx="33%" cy="27%" r="80%">
                      <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                      <stop offset="20%" stopColor={SEAT_LITE[i]} />
                      <stop offset="60%" stopColor={SEAT_COLOR[i]} />
                      <stop offset="100%" stopColor={SEAT_DARK[i]} />
                    </radialGradient>
                  ))}
                </defs>

                {boardArt}

                {/* hints paint BEFORE the pieces, so a piece always wins an
                    overlapping tap (trap 2) */}
                <g className="jak-rings">
                  {view.rings.map((r) => (
                    <g key={r.key} className={'jak-ring is-' + r.kind}>
                      <circle className="jak-ring-art" cx={r.x.toFixed(2)} cy={r.y.toFixed(2)} r="3.2" />
                      {r.text ? (
                        <text className="jak-ring-n" x={r.x.toFixed(2)} y={r.y.toFixed(2)}>{r.text}</text>
                      ) : null}
                      {r.act ? (
                        <circle
                          className="jak-ring-hit"
                          cx={r.x.toFixed(2)}
                          cy={r.y.toFixed(2)}
                          r="3.1"
                          onClick={r.act}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.act() } }}
                          role="button"
                          tabIndex={0}
                          aria-label={(ar ? 'وجهة' : 'target') + (r.text ? ' ' + r.text : '')}
                        />
                      ) : null}
                    </g>
                  ))}
                </g>

                {ghost ? (
                  <g className="jak-ghost">
                    <Piece x={ghost.x} y={ghost.y} seatIx={ghost.seatIx} cls="jak-piece" scale={1} />
                    <circle className="jak-ghost-ring" cx={ghost.x.toFixed(2)} cy={ghost.y.toFixed(2)} r="3" />
                  </g>
                ) : null}

                {pieces}

                <g className="jak-fx-layer">
                  {fx.map((f) => (
                    <circle
                      key={f.id}
                      className={'jak-burst is-' + f.kind}
                      cx={f.x.toFixed(2)}
                      cy={f.y.toFixed(2)}
                      r="3"
                      style={{ animationDelay: f.delay + 'ms' }}
                    />
                  ))}
                </g>
              </svg>

              <div className="jak-centre" aria-hidden="true">
                {st.last && st.last.card ? (
                  <>
                    <CardFace code={st.last.card} />
                    <span className="jak-centre-nm">{nameOf(st.last.seat)}</span>
                  </>
                ) : (
                  <span className="jak-centre-idle" />
                )}
              </div>

              {flash ? (
                <div className="jak-flash">
                  <span>{flash.msg}</span>
                  <span className="jak-flash-dot" aria-hidden="true" />
                  <span>{flash.deal}</span>
                  <span className="jak-flash-dot" aria-hidden="true" />
                  <span>{seated ? (myTeam === 0 ? t.us : t.them) : t.teamA} <b>{flash.a}</b></span>
                  <span>{seated ? (myTeam === 1 ? t.us : t.them) : t.teamB} <b>{flash.b}</b></span>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="jak-rail">
          {lastLine ? (
            <span className="jak-last" style={{ '--pc': SEAT_COLOR[lastLine.seatIx] }}>
              <i aria-hidden="true" />
              <span>{lastLine.who} {lastLine.what}{lastLine.kills ? ' ' + t.andKill : ''}</span>
            </span>
          ) : (
            <span className="jak-last">{st.phase === 'play' ? t.waitingFor + ' ' + nameOf(st.turnSeat) : ''}</span>
          )}
        </div>

        {showLobby ? (
          <div className="cg-lobby">
            <strong className="cg-lobby-title">{t.waitPlayers}</strong>
            <p className="cg-lobby-sub">{t.needFour}</p>
            <div className="cg-lobby-seats">
              {[0, 1, 2, 3].map((sx) => (
                <div
                  key={sx}
                  className={'cg-lobby-seat' + (bySeat[sx] ? ' is-filled' : '') + (seated && sx === seat ? ' is-me' : '')}
                  style={{ '--sc': SEAT_COLOR[sx] }}
                >
                  <span className="cg-av">{initialsOf(bySeat[sx]?.name)}</span>
                  <span>{nameOf(sx)}</span>
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
              <strong className="cg-modal-title">
                {seated ? (st.winnerTeam === myTeam ? t.win : t.lose) : ((st.winnerTeam === 0 ? t.teamA : t.teamB))}
              </strong>
              <p className="cg-modal-sub">{t.round} {fmt(st.round, ar)}</p>
              <div className="cg-modal-rows">
                {[0, 1].map((tm) => (
                  <div key={tm} className={'cg-row ' + (tm === 0 ? 'is-a' : 'is-b')}>
                    <span>{seated ? (tm === myTeam ? t.us : t.them) : (tm === 0 ? t.teamA : t.teamB)}</span>
                    <b>{fmt(teamHome(st.marbles, tm), ar)}</b>
                  </div>
                ))}
              </div>
              {onExit ? (
                <div className="cg-actions">
                  <button type="button" className="cg-btn is-primary cg-press" onClick={() => onExit?.()}>
                    {t.exit}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* A seatless remote viewer gets the board only: rendering this block
          for them dressed seat 0's hand in live-looking controls. */}
      {seated ? (
        <div className="cg-hand-wrap">
          <div className="jak-me">
            {renderPod(seat, true)}
            {owner !== seat && st.phase === 'play' ? (
              <span className="jak-me-note">{t.partnerNow}</span>
            ) : sel ? (
              <span className="jak-me-note">{cardNote}</span>
            ) : null}
          </div>

          <div className="cg-hand">
            {myHand.map((c, i) => (
              <button
                key={c + ':' + i}
                type="button"
                className={
                  'cg-hand-slot' +
                  (sel && sel.i === i ? ' is-sel' : '') +
                  (isMyTurn && deadCards[i] ? ' is-dim is-dead' : '')
                }
                disabled={!isMyTurn}
                onClick={() => pickCard(i, c)}
                aria-label={label(c)}
              >
                <CardFace code={c} />
              </button>
            ))}
          </div>

          {isSeven && isMyTurn && !selDead && stage === 'n' ? (
            <div className="jak-legs">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => {
                const can = legal.some((d) => d.a.m === pickA.m && (d.b ? d.a.n === n : n === 7))
                return (
                  <button
                    key={n}
                    type="button"
                    className={'jak-legbtn' + (legN === n ? ' is-on' : '')}
                    disabled={!can}
                    onClick={() => {
                      play('click')
                      if (n === 7) commit({ mode: 'seven', a: { m: pickA.m, n: 7 }, b: null })
                      else setLegN(n)
                    }}
                  >
                    {n === 7 ? fmt(7, ar) : fmt(n, ar)}
                  </button>
                )
              })}
            </div>
          ) : null}

          {isSeven && isMyTurn && stage === 'b' ? (
            <div className="jak-legs">
              <span className="jak-legs-rest">{t.rest} {fmt(7 - legN, ar)}</span>
            </div>
          ) : null}

          <div className="cg-actions">
            {isMyTurn && sel && selDead ? (
              <button
                type="button"
                className="cg-btn is-primary cg-press"
                onClick={() => { submit({ t: 'discard', seat, i: sel.i, card: sel.card }); setSel(null); clearPick() }}
              >
                {t.discard} {label(sel.card)}
              </button>
            ) : null}
            {isMyTurn && (pickA || legN != null) ? (
              <button type="button" className="cg-btn is-ghost is-sm cg-press" onClick={clearPick}>
                {t.undo}
              </button>
            ) : null}
            {stalled ? (
              <button type="button" className="cg-btn is-ghost cg-press" onClick={() => submit({ t: 'forceSkip', seat })}>
                {t.skip}
              </button>
            ) : null}
          </div>

          <div className={hintCls} aria-live="polite">{hint}</div>
        </div>
      ) : (
        <div className="jak-watch">
          <span className="jak-watch-dot" aria-hidden="true" />
          <span>{t.watching}</span>
          {st.phase === 'play' ? <b>{t.waitingFor} {nameOf(st.turnSeat)}</b> : null}
        </div>
      )}

      {rules ? (
        <div className="cg-over">
          <div className="cg-over-head">
            <strong>{ar ? 'شرح الجكارو' : 'How to play Jackaroo'}</strong>
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
