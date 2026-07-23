// «الحريق» — Haree'g: the Sudanese / Gulf elimination rummy game.
//
// ===========================================================================
// WHICH VARIANT THIS FILE IMPLEMENTS  (read this before changing any rule)
// ===========================================================================
// Hareeg is played slightly differently from table to table — mostly in the
// opening threshold, in whether the thrown card may «cover» a table meld, and
// in how the round penalty is counted. Blending variants produces a game
// nobody actually plays, so this file implements ONE coherent ruleset end to
// end — the widely played «حريق ١٤» family — with the ONE sanctioned switch
// being the penalty mode:
//
//   • 2–4 players, no partnerships. TWO 52-card decks plus four jokers (108).
//   • DEAL: fourteen cards each; the player after the dealer gets fifteen and
//     opens the round WITHOUT drawing (their fifteenth card is the draw).
//   • TURN: draw one card (from the stock or the thrown pile), then lay down
//     what you wish, then end the turn by throwing exactly one card.
//   • LAYING DOWN (النزول): melds of three or more cards — a run of the same
//     suit in sequence, or a set of one rank. The Ace may sit low (A-2-3) or
//     high (Q-K-A). Jokers stand for any card; a meld must keep at least two
//     natural cards.
//   • OPENING: your FIRST lay-down of a round must total 51 points or more
//     (the «خمسينة»), in as many melds as needed, all in one turn. Card
//     values: 2–10 by face; J / Q / K / A / joker are 10 each.
//   • After opening you may lay freely and EXTEND any meld on the table,
//     yours or anyone's.
//   • THE THROW (البايظ): the card you end on must NOT fit any meld already
//     on the table — a fitting card is a «غطاء» and must be played, not
//     thrown. The one escape: if every card in your hand is a cover, you may
//     throw anyway (otherwise the game would deadlock).
//   • ROUND END: the first player to empty their hand wins the round — by a
//     final throw or by laying everything. Everyone else adds a penalty:
//       - mode «14»   : the point value of the cards left in hand (brutal —
//                       one bad round can burn you out; this is the classic
//                       «حريق ١٤» risk).
//       - mode «عدّ»  : one point per card left (the slower classic count).
//   • BURNING (الحرق): a player whose accumulated penalties reach 31 is
//     burned and leaves the table. Rounds continue among the survivors; the
//     LAST PLAYER STANDING wins the match.
//   • STOCK: when the stock runs dry, the thrown pile (minus its top card)
//     is reshuffled — deterministically from the round seed — into a new
//     stock. If there is nothing left to reshuffle the round is void: no
//     winner, no penalties, next dealer redeals.
//
// WHERE OTHER TABLES DIFFER (deliberately NOT implemented, listed for honesty)
//   • Some tables open at 41 or 61; here the floor is a flat 51.
//   • Some tables force taking the thrown card into an immediate meld; here
//     taking it is free, like drawing.
//   • Some tables burn at 51 or 101; here the burn line is 31, the number the
//     game is named for at most tables.
//   • «حريق الخمسينات» (fifties-only melding) is not implemented.
//
// ===========================================================================
// ARCHITECTURE — identical contract to Wist.jsx (the reference blueprint)
// ===========================================================================
// The whole game lives in `reduce(state, move, room)`, a total pure function:
// an illegal or out-of-turn move returns the state untouched. The component
// never writes to Firestore; it calls `onMove(move)` and re-renders from the
// live `room`. `reduce` re-runs inside the lead's transaction, so a tampered
// client cannot force an illegal play. All randomness is a seeded PRNG
// carried on the deal move — never Math.random inside reduce.
//
// KNOWN LIMITATION (same as every card game here): the hands live in
// room.state and the room doc is readable by its players; the UI hides other
// hands but a network inspector does not. Hiding them for real needs
// per-seat subcollections + rules, outside this component.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { botMoveFor, botLabel, takeSoloIntent, BOT_DELAY_MS } from '../../lib/gameBots.js'
import '../../styles/cardgames.css'

// ---------------------------------------------------------------------------
// deck — two decks + four jokers. Codes are rank+suit+copy («AS0», «AS1»)
// so every physical card stays unique for React keys and hand removal.
// Jokers are «X*0»…«X*3».
// ---------------------------------------------------------------------------
const SUITS = ['S', 'H', 'D', 'C']
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K']
const RED = { H: true, D: true }
const OPEN_MIN = 51
const BURN_AT = 31

const suitOf = (c) => String(c || '').charAt(1)
const rankOf = (c) => String(c || '').charAt(0)
const isJoker = (c) => rankOf(c) === 'X'
const nx = (s) => (s + 1) % 4

const RANK_LABEL = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }
const label = (c) => (isJoker(c) ? '★' : RANK_LABEL[rankOf(c)] || rankOf(c))

const SUIT_AR = { S: 'بستوني', H: 'كبة', D: 'ديناري', C: 'سباتي', '*': 'جوكر' }
const SUIT_EN = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs', '*': 'Joker' }

// penalty / opening value: 2–10 by face, faces and aces and jokers are 10
function valueOf(c) {
  const r = rankOf(c)
  if (r >= '2' && r <= '9') return Number(r)
  return 10
}

// run position of a rank; the Ace is tried both low (1) and high (14)
const RUN_VAL = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13 }

// mulberry32 — the same deterministic PRNG the other games use
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

function shuffled(cards, seed) {
  const deck = [...cards]
  const rnd = prng(seed)
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1))
    const t = deck[i]
    deck[i] = deck[j]
    deck[j] = t
  }
  return deck
}

function freshDeck(seed) {
  const deck = []
  for (let d = 0; d < 2; d += 1) for (const s of SUITS) for (const r of RANKS) deck.push(r + s + d)
  for (let j = 0; j < 4; j += 1) deck.push('X*' + j)
  return shuffled(deck, seed)
}

// display order: suits together, runs ascending (Ace shown high), jokers last
function sortHand(cards) {
  const order = { S: 0, H: 1, C: 2, D: 3, '*': 4 }
  const pos = (c) => (isJoker(c) ? 99 : rankOf(c) === 'A' ? 14 : RUN_VAL[rankOf(c)])
  return [...cards].sort((a, b) => {
    const d = order[suitOf(a)] - order[suitOf(b)]
    return d !== 0 ? d : pos(a) - pos(b)
  })
}

// ---------------------------------------------------------------------------
// meld validation — sets and runs, jokers standing in, total and pure
// ---------------------------------------------------------------------------
export function validMeld(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false
  if (new Set(cards).size !== cards.length) return false
  const nat = cards.filter((c) => !isJoker(c))
  const jokers = cards.length - nat.length
  if (nat.length < 2) return false

  // a set: one rank, any suits (two decks make duplicates legitimate)
  if (nat.every((c) => rankOf(c) === rankOf(nat[0]))) return true

  // a run: one suit, consecutive, jokers filling gaps or extending the ends
  const suit = suitOf(nat[0])
  if (!nat.every((c) => suitOf(c) === suit)) return false
  const hasAce = nat.some((c) => rankOf(c) === 'A')
  const aceTries = hasAce ? [14, 1] : [0]
  for (const aceVal of aceTries) {
    const vals = nat.map((c) => (rankOf(c) === 'A' ? aceVal : RUN_VAL[rankOf(c)]))
    if (new Set(vals).size !== vals.length) continue
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const gaps = (max - min + 1) - vals.length
    if (gaps > jokers) continue
    const spare = jokers - gaps
    if (spare <= (min - 1) + (14 - max)) return true
  }
  return false
}

export function meldPoints(cards) {
  return (cards || []).reduce((s, c) => s + valueOf(c), 0)
}

const meldKind = (cards) => {
  const nat = cards.filter((c) => !isJoker(c))
  return nat.length && nat.every((c) => rankOf(c) === rankOf(nat[0])) ? 'set' : 'run'
}

// does `card` fit some meld already on the table? (the «cover» test)
function isCover(melds, card) {
  return (melds || []).some((m) => validMeld([...m.cards, card]))
}

// ---------------------------------------------------------------------------
// greedy meld finder — shared by the bots and the «hint» affordance. Runs
// first (they spend more cards), then sets, then jokers complete pairs and
// one-gap runs. Never uses a card twice.
// ---------------------------------------------------------------------------
export function findMelds(hand) {
  const pool = new Set(hand)
  const jokers = hand.filter(isJoker)
  jokers.forEach((j) => pool.delete(j))
  const melds = []

  // natural runs per suit
  for (const s of SUITS) {
    let cards = sortHand([...pool].filter((c) => suitOf(c) === s))
    // walk ascending, extending while consecutive (Ace high; A-2-3 found via ace-low retry below)
    let run = []
    const flush = () => {
      if (run.length >= 3) { melds.push([...run]); run.forEach((c) => pool.delete(c)) }
      run = []
    }
    for (const c of cards) {
      const v = rankOf(c) === 'A' ? 14 : RUN_VAL[rankOf(c)]
      const pv = run.length ? (rankOf(run[run.length - 1]) === 'A' ? 14 : RUN_VAL[rankOf(run[run.length - 1])]) : null
      if (pv == null || v === pv + 1) run.push(c)
      else if (v === pv) continue
      else { flush(); run = [c] }
    }
    flush()
    // ace-low retry: A + 2 + 3 still in the pool
    const ace = [...pool].find((c) => suitOf(c) === s && rankOf(c) === 'A')
    const two = [...pool].find((c) => suitOf(c) === s && rankOf(c) === '2')
    const three = [...pool].find((c) => suitOf(c) === s && rankOf(c) === '3')
    if (ace && two && three) { melds.push([ace, two, three]); pool.delete(ace); pool.delete(two); pool.delete(three) }
  }

  // natural sets
  const byRank = {}
  for (const c of pool) (byRank[rankOf(c)] = byRank[rankOf(c)] || []).push(c)
  for (const r of Object.keys(byRank)) {
    if (byRank[r].length >= 3) { melds.push(byRank[r].slice(0, 4)); byRank[r].slice(0, 4).forEach((c) => pool.delete(c)) }
  }

  // jokers finish pairs (highest value first), then one-gap runs
  let free = [...jokers]
  if (free.length) {
    const pairs = Object.values(byRank).filter((g) => g.filter((c) => pool.has(c)).length === 2)
      .sort((a, b) => valueOf(b[0]) - valueOf(a[0]))
    for (const g of pairs) {
      if (!free.length) break
      const pair = g.filter((c) => pool.has(c)).slice(0, 2)
      const j = free.pop()
      melds.push([...pair, j])
      pair.forEach((c) => pool.delete(c))
    }
  }
  if (free.length) {
    for (const s of SUITS) {
      if (!free.length) break
      const cards = sortHand([...pool].filter((c) => suitOf(c) === s))
      for (let i = 0; i < cards.length - 1 && free.length; i += 1) {
        const a = cards[i]
        const b = cards[i + 1]
        const va = rankOf(a) === 'A' ? 14 : RUN_VAL[rankOf(a)]
        const vb = rankOf(b) === 'A' ? 14 : RUN_VAL[rankOf(b)]
        if (vb - va === 2 || vb - va === 1) {
          const j = free.pop()
          melds.push([a, b, j])
          pool.delete(a)
          pool.delete(b)
          i += 1
        }
      }
    }
  }

  const points = melds.reduce((t, m) => t + meldPoints(m), 0)
  const used = new Set(melds.flat())
  return { melds, points, used }
}

// The narrow window the computer opponents get onto this file — see gameBots.
export const botHelpers = { validMeld, meldPoints, findMelds, isCover, isJoker, valueOf, suitOf, rankOf, OPEN_MIN }

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
export function initialState() {
  return {
    v: 1,
    phase: 'waiting', // waiting | turn | roundEnd | matchEnd
    step: 'draw',     // inside a turn: draw | act
    mode: '14',       // '14' = value penalties | 'count' = one per card
    roundNo: 0,
    dealer: 0,
    turnSeat: 0,
    roundSeed: 1,
    reshuffles: 0,
    hands: [[], [], [], []],
    stock: [],
    discard: [],      // top of the pile = last element
    melds: [],        // [{ cards:[codes], kind:'run'|'set' }] — shared table
    opened: [false, false, false, false],
    playing: [false, false, false, false], // seated into THIS round
    out: [false, false, false, false],     // burned out of the match
    burns: [0, 0, 0, 0],
    roundsWon: [0, 0, 0, 0],
    lastRound: null,  // { winner|null, void, pens:[4], burnedNow:[seats] }
    winnerSeat: null,
  }
}

export const RULES_AR = [
  'الحريق — من لاعبَين إلى أربعة، كلٌّ لنفسه. الورق شدّتان مع أربعة جوكرات.',
  '',
  'التوزيع: أربع عشرة ورقة لكل لاعب، واللاعب الذي بعد الموزّع يأخذ خمس عشرة ويبدأ الجولة دون سحب.',
  '',
  'الدور: اسحب ورقة من الكومة أو خذ أعلى المرمية، انزل ما تشاء إن استطعت، ثم اختم بِرمي ورقة واحدة.',
  '',
  'النزول: ثلاث ورقات فأكثر — سلسلة من نوع واحد متتابعة، أو مجموعة من رتبة واحدة. الآس يصح أولاً (آس-2-3) وآخراً (Q-K-آس). الجوكر يقوم مقام أي ورقة، على أن تبقى في النزلة ورقتان حقيقيتان على الأقل.',
  '',
  'الافتتاح: أول نزول لك في الجولة يجب أن يبلغ 51 نقطة فأكثر دفعة واحدة، بأي عدد من النزلات. القيم: من 2 إلى 10 برقمها، والصور والآس والجوكر بعشر.',
  '',
  'بعد الافتتاح: انزل ما شئت ومدّد أي نزلة على الطاولة — نزلتك أو نزلة غيرك.',
  '',
  'الرمية: الورقة التي تختم بها لا يجوز أن تدخل في نزلة موجودة على الطاولة — تلك «غطاء» يُلعب ولا يُرمى. إن كانت كل أوراقك أغطية، فارمِ ما شئت.',
  '',
  'نهاية الجولة: من أنهى أوراقه أولاً فاز بها. الباقون يتحمّلون عقوبة الجولة:',
  '• طور «حريق 14»: مجموع قيم الورق المتبقي في اليد — جولة سيئة واحدة قد تحرقك.',
  '• طور «عدّ الورق»: نقطة عن كل ورقة متبقية.',
  '',
  'الحرق: من بلغ مجموع عقوباته 31 «احترق» وخرج من الطاولة. تستمر الجولات بين الناجين، وآخر لاعب يبقى هو الفائز بالمباراة.',
  '',
  'الكومة: إذا نفدت تُخلط المرمية (عدا أعلاها) كومةً جديدة. وإن لم يبق ما يُخلط أُلغيت الجولة بلا عقوبات وأعاد الموزّع التالي التوزيع.',
].join('\n')

const RULES_EN = [
  'Hareeg — two to four players, everyone for themselves. Two decks plus four jokers.',
  '',
  'Deal: fourteen cards each; the player after the dealer takes fifteen and opens the round without drawing.',
  '',
  'A turn: draw from the stock or take the top of the thrown pile, lay down what you can, then end by throwing exactly one card.',
  '',
  'Laying down: melds of three or more — a one-suit run, or a one-rank set. The Ace plays low (A-2-3) or high (Q-K-A). Jokers stand for any card; keep at least two natural cards per meld.',
  '',
  'Opening: your first lay-down of a round must total 51 points or more, in one turn. Values: 2–10 by face; pictures, Aces and jokers are 10.',
  '',
  'After opening you may lay freely and extend any meld on the table.',
  '',
  'The throw must not fit an existing meld (such a card is a cover — play it, do not throw it). If your whole hand is covers, throw anything.',
  '',
  'Round end: first empty hand wins. The rest take the round penalty — card values in «14» mode, one per card in count mode. Reaching 31 burns you out of the match; the last player standing wins.',
].join('\n')

// ---------------------------------------------------------------------------
// reduce — the whole rulebook, pure and total
// ---------------------------------------------------------------------------
const keep = (state) => ({ state })

function normalise(state) {
  return state && state.v === 1 && Array.isArray(state.hands) ? state : initialState()
}

function turnOf(seat, move) {
  return { seat, startedAt: Number(move?.at) || 0, deadlineAt: null }
}

function seatedFlags(room) {
  const flags = [false, false, false, false]
  const list = Array.isArray(room?.players) ? room.players : []
  for (const p of list) if (Number.isInteger(p?.seat) && p.seat >= 0 && p.seat < 4) flags[p.seat] = true
  return flags
}

function nextAlive(s, from) {
  let k = from
  for (let i = 0; i < 4; i += 1) {
    k = nx(k)
    if (s.playing[k] && !s.out[k]) return k
  }
  return from
}

function doDeal(s, move, room) {
  if (s.phase !== 'waiting' && s.phase !== 'roundEnd') return keep(s)
  const seated = seatedFlags(room)
  const fresh = s.phase === 'waiting'
  const out = fresh ? [false, false, false, false] : s.out
  const playing = [0, 1, 2, 3].map((i) => seated[i] && !out[i])
  const alive = playing.filter(Boolean).length
  if (alive < 2) return keep(s)

  const seed = (Number(move?.seed) >>> 0) || 1
  const deck = freshDeck(seed)
  const mode = fresh && (move?.mode === 'count' || move?.mode === '14') ? move.mode : s.mode

  const base = { ...s, playing, out, mode }
  const dealer = fresh
    ? (Number.isInteger(move?.dealer) && playing[((move.dealer % 4) + 4) % 4] ? ((move.dealer % 4) + 4) % 4 : playing.indexOf(true))
    : nextAlive(base, s.dealer)
  const opener = nextAlive({ ...base, dealer }, dealer)

  const hands = [[], [], [], []]
  let i = 0
  for (let seat = 0; seat < 4; seat += 1) {
    if (!playing[seat]) continue
    hands[seat] = deck.slice(i, i + 14)
    i += 14
  }
  hands[opener] = [...hands[opener], deck[i]]
  i += 1
  const stock = deck.slice(i)

  return {
    state: {
      ...base,
      phase: 'turn',
      step: 'act', // the opener holds the extra card — no draw on the first turn
      roundNo: s.roundNo + 1,
      dealer,
      turnSeat: opener,
      roundSeed: seed,
      reshuffles: 0,
      hands: hands.map(sortHand),
      stock,
      discard: [],
      melds: [],
      opened: [false, false, false, false],
      burns: fresh ? [0, 0, 0, 0] : s.burns,
      roundsWon: fresh ? [0, 0, 0, 0] : s.roundsWon,
      lastRound: null,
      winnerSeat: null,
    },
    turn: turnOf(opener, move),
    status: 'playing',
  }
}

function doDraw(s, move) {
  if (s.phase !== 'turn' || s.step !== 'draw') return keep(s)
  const seat = move.seat
  if (seat !== s.turnSeat) return keep(s)

  if (move.from === 'discard') {
    if (!s.discard.length) return keep(s)
    const card = s.discard[s.discard.length - 1]
    const hands = s.hands.map((h, i) => (i === seat ? sortHand([...h, card]) : h))
    return {
      state: { ...s, hands, discard: s.discard.slice(0, -1), step: 'act', lastDraw: { seat, from: 'discard' } },
      turn: turnOf(seat, move),
    }
  }

  let stock = s.stock
  let discard = s.discard
  let reshuffles = s.reshuffles
  if (!stock.length) {
    if (discard.length <= 1) {
      // nothing to rebuild from — the round is void, no penalties
      return {
        state: {
          ...s,
          phase: 'roundEnd',
          lastRound: { winner: null, void: true, pens: [0, 0, 0, 0], burnedNow: [] },
        },
        turn: turnOf(nextAlive(s, s.dealer), move),
      }
    }
    reshuffles += 1
    const reseed = (s.roundSeed ^ Math.imul(reshuffles, 0x9e3779b9)) >>> 0
    stock = shuffled(discard.slice(0, -1), reseed || 1)
    discard = discard.slice(-1)
  }
  const card = stock[stock.length - 1]
  const hands = s.hands.map((h, i) => (i === seat ? sortHand([...h, card]) : h))
  return {
    state: { ...s, hands, stock: stock.slice(0, -1), discard, reshuffles, step: 'act', lastDraw: { seat, from: 'stock' } },
    turn: turnOf(seat, move),
  }
}

// the shared «this hand is empty» exit — round scoring + eliminations
function roundWon(s, move, winner) {
  const pens = [0, 0, 0, 0]
  const burns = [...s.burns]
  const out = [...s.out]
  const burnedNow = []
  for (let seat = 0; seat < 4; seat += 1) {
    if (!s.playing[seat] || s.out[seat] || seat === winner) continue
    const hand = s.hands[seat] || []
    pens[seat] = s.mode === 'count' ? hand.length : hand.reduce((t, c) => t + valueOf(c), 0)
    burns[seat] += pens[seat]
    if (burns[seat] >= BURN_AT) { out[seat] = true; burnedNow.push(seat) }
  }
  const roundsWon = [...s.roundsWon]
  roundsWon[winner] += 1

  const survivors = [0, 1, 2, 3].filter((i) => s.playing[i] && !out[i])
  const matchOver = survivors.length <= 1
  const champion = matchOver ? (survivors[0] ?? winner) : null

  const state = {
    ...s,
    phase: matchOver ? 'matchEnd' : 'roundEnd',
    burns,
    out,
    roundsWon,
    winnerSeat: champion,
    lastRound: { winner, void: false, pens, burnedNow },
  }
  const scores = {}
  for (let i = 0; i < 4; i += 1) scores[i] = roundsWon[i] * 10 + (champion === i ? 40 : 0)
  if (!matchOver) return { state, turn: turnOf(nextAlive(state, s.dealer), move), scores }
  return { state, turn: turnOf(champion, move), scores, winnerSeat: champion, status: 'ended' }
}

function doLay(s, move) {
  if (s.phase !== 'turn' || s.step !== 'act') return keep(s)
  const seat = move.seat
  if (seat !== s.turnSeat) return keep(s)
  const groups = Array.isArray(move.melds) ? move.melds.map((g) => (Array.isArray(g) ? g.map(String) : null)) : null
  if (!groups || !groups.length || groups.some((g) => !g)) return keep(s)

  const flat = groups.flat()
  if (new Set(flat).size !== flat.length) return keep(s)
  const hand = s.hands[seat] || []
  if (!flat.every((c) => hand.includes(c))) return keep(s)
  if (!groups.every(validMeld)) return keep(s)

  const pts = groups.reduce((t, g) => t + meldPoints(g), 0)
  if (!s.opened[seat] && pts < OPEN_MIN) return keep(s)

  const hands = s.hands.map((h, i) => (i === seat ? h.filter((c) => !flat.includes(c)) : h))
  const melds = [...s.melds, ...groups.map((g) => ({ cards: g, kind: meldKind(g) }))]
  const opened = s.opened.map((o, i) => (i === seat ? true : o))
  const next = { ...s, hands, melds, opened }

  if (!hands[seat].length) return roundWon(next, move, seat)
  return { state: next, turn: turnOf(seat, move) }
}

function doExtend(s, move) {
  if (s.phase !== 'turn' || s.step !== 'act') return keep(s)
  const seat = move.seat
  if (seat !== s.turnSeat || !s.opened[seat]) return keep(s)
  const idx = Number(move.meld)
  if (!Number.isInteger(idx) || idx < 0 || idx >= s.melds.length) return keep(s)
  const add = Array.isArray(move.cards) ? move.cards.map(String) : null
  if (!add || !add.length || new Set(add).size !== add.length) return keep(s)
  const hand = s.hands[seat] || []
  if (!add.every((c) => hand.includes(c))) return keep(s)

  const merged = [...s.melds[idx].cards, ...add]
  if (!validMeld(merged)) return keep(s)

  const hands = s.hands.map((h, i) => (i === seat ? h.filter((c) => !add.includes(c)) : h))
  const melds = s.melds.map((m, i) => (i === idx ? { cards: merged, kind: meldKind(merged) } : m))
  const next = { ...s, hands, melds }

  if (!hands[seat].length) return roundWon(next, move, seat)
  return { state: next, turn: turnOf(seat, move) }
}

function doDiscard(s, move) {
  if (s.phase !== 'turn' || s.step !== 'act') return keep(s)
  const seat = move.seat
  if (seat !== s.turnSeat) return keep(s)
  const card = String(move.card || '')
  const hand = s.hands[seat] || []
  if (!hand.includes(card)) return keep(s)

  // the cover rule: a card that fits the table must be played, not thrown —
  // unless the whole hand is covers (the deadlock escape)
  if (isCover(s.melds, card) && hand.some((c) => !isCover(s.melds, c))) return keep(s)

  const hands = s.hands.map((h, i) => (i === seat ? h.filter((c) => c !== card) : h))
  const next = { ...s, hands, discard: [...s.discard, card] }

  if (!hands[seat].length) return roundWon(next, move, seat)
  const k = nextAlive(next, seat)
  return {
    state: { ...next, turnSeat: k, step: 'draw', lastDraw: null },
    turn: turnOf(k, move),
  }
}

export function reduce(state, move, room) {
  const s = normalise(state)
  const m = move && typeof move === 'object' ? move : null
  if (!m) return keep(s)
  if (!Number.isInteger(m.seat) && m.t !== 'deal') return keep(s)
  if (Number.isInteger(m.seat) && (m.seat < 0 || m.seat > 3)) return keep(s)

  switch (m.t) {
    case 'deal': return doDeal(s, m, room)
    case 'draw': return doDraw(s, m)
    case 'lay': return doLay(s, m)
    case 'extend': return doExtend(s, m)
    case 'discard': return doDiscard(s, m)
    default: return keep(s)
  }
}

// ---------------------------------------------------------------------------
// drawing — inline SVG suits (never glyphs, never emoji); joker is a star
// ---------------------------------------------------------------------------
const SUIT_PATH = {
  S: 'M12 2.2c0 0-8 6.4-8 11.1a4.15 4.15 0 0 0 6.9 3.1c-.2 1.9-1 3.4-2.3 4.2h6.8c-1.3-.8-2.1-2.3-2.3-4.2a4.15 4.15 0 0 0 6.9-3.1c0-4.7-8-11.1-8-11.1z',
  H: 'M12 21.3s-8.2-5.2-8.2-10.6a4.7 4.7 0 0 1 8.2-3.1 4.7 4.7 0 0 1 8.2 3.1c0 5.4-8.2 10.6-8.2 10.6z',
  D: 'M12 2.2l7.2 9.8-7.2 9.8-7.2-9.8z',
  C: 'M12 3.1a3.62 3.62 0 0 0-2.7 6 3.62 3.62 0 1 0-1.4 6.9 3.6 3.6 0 0 0 3.2-2c-.1 2.3-.9 4.2-2.2 5.1h6.2c-1.3-.9-2.1-2.8-2.2-5.1a3.6 3.6 0 0 0 3.2 2 3.62 3.62 0 1 0-1.4-6.9 3.62 3.62 0 0 0-2.7-6z',
  '*': 'M12 2.4l2.5 6.1 6.6.5-5 4.3 1.5 6.4-5.6-3.4-5.6 3.4 1.5-6.4-5-4.3 6.6-.5z',
}

function Suit({ s, className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} focusable="false" aria-hidden="true">
      <path d={SUIT_PATH[s] || SUIT_PATH.S} fill="currentColor" />
    </svg>
  )
}

function CardFace({ code, small }) {
  const s = suitOf(code)
  const joker = isJoker(code)
  return (
    <span className={'cg-card' + (RED[s] ? ' is-red' : '') + (joker ? ' is-joker' : '') + (small ? ' is-sm' : '')}>
      <span className="cg-card-rank">{label(code)}</span>
      <Suit s={s} className="cg-card-mini" />
      <Suit s={s} className="cg-card-big" />
    </span>
  )
}

// ---------------------------------------------------------------------------
// local fallback table — hot-seat or vs the computer, same reduce
// ---------------------------------------------------------------------------
const LOCAL_NAMES = ['اللاعب الأول', 'اللاعب الثاني', 'اللاعب الثالث', 'اللاعب الرابع']

function makeLocalRoom(playerName, bots, lang) {
  return {
    roomId: 'local',
    gameId: 'haree',
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
    minPlayers: 2,
    turn: { seat: 0, startedAt: 0, deadlineAt: null },
    state: initialState(),
    winnerSeat: null,
  }
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------
export default function Haree({
  onScore,
  onExit,
  lang = 'ar',
  brand = '#0e7490',
  playerName = '',
  room = null,
  mySeat = null,
  onMove,
  isHost = false,
  soloBots = null,
}) {
  const ar = lang !== 'en'
  const remote = !!room
  const [vsBot] = useState(() => !remote && (Number(soloBots) > 0 || !!takeSoloIntent('haree')))
  const [localRoom, setLocalRoom] = useState(() => makeLocalRoom(playerName, vsBot, lang))
  const [rules, setRules] = useState(false)
  const [covered, setCovered] = useState(false)
  const [sel, setSel] = useState([])       // selected card codes in my hand
  const [staged, setStaged] = useState([]) // melds built but not committed yet
  const [mode, setMode] = useState('14')

  const table = remote ? room : localRoom
  const st = useMemo(() => normalise(table?.state), [table])

  const seat = remote
    ? (Number.isInteger(mySeat) ? mySeat : 0)
    : (vsBot ? 0 : (Number.isInteger(st.turnSeat) ? st.turnSeat : 0))
  const host = remote ? !!isHost : true
  const players = Array.isArray(table?.players) ? table.players : []
  const bySeat = useMemo(() => {
    const out = [null, null, null, null]
    for (const p of players) if (Number.isInteger(p?.seat) && p.seat >= 0 && p.seat < 4) out[p.seat] = p
    return out
  }, [players])
  const filled = bySeat.filter(Boolean).length

  const submit = useCallback((move) => {
    const full = { ...move, at: Date.now() }
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

  // selection resets whenever the turn moves on or the hand changes shape
  useEffect(() => { setSel([]); setStaged([]) }, [st.turnSeat, st.step, st.roundNo])

  // remote host: auto-deal when enough seats are filled
  const dealtRef = useRef(false)
  useEffect(() => {
    if (!remote || !isHost) return
    if (st.phase !== 'waiting' || filled < 2) { dealtRef.current = false; return }
    if (dealtRef.current) return
    dealtRef.current = true
    submit({ t: 'deal', seed: newSeed(), dealer: 0, mode })
  }, [remote, isHost, st.phase, filled, submit, mode])

  // hot-seat privacy curtain between turns on one shared phone
  const prevSeat = useRef(seat)
  useEffect(() => {
    if (remote || vsBot) return
    if (prevSeat.current !== seat) {
      prevSeat.current = seat
      if (st.phase === 'turn') setCovered(true)
    }
  }, [seat, remote, vsBot, st.phase])

  // solo: the table is full of machines — deal the first round by itself
  useEffect(() => {
    if (!vsBot || st.phase !== 'waiting') return undefined
    const id = setTimeout(() => submit({ t: 'deal', seat: 0, seed: newSeed(), dealer: 0, mode }), 260)
    return () => clearTimeout(id)
  }, [vsBot, st.phase, submit, mode])

  // machine seats — one legal move per state change, validated through reduce
  useEffect(() => {
    if (!vsBot) return undefined
    if (st.phase !== 'turn') return undefined
    const acting = st.turnSeat
    if (!Number.isInteger(acting) || acting <= 0) return undefined
    if (!bySeat[acting]?.bot) return undefined
    const id = setTimeout(() => {
      const mv = botMoveFor('haree', st, acting, { reduce, room: localRoom, helpers: botHelpers })
      if (mv) submit(mv)
    }, BOT_DELAY_MS)
    return () => clearTimeout(id)
  }, [vsBot, st, localRoom, submit, bySeat])

  // solo: roll the next round automatically once the result has been readable
  useEffect(() => {
    if (!vsBot || st.phase !== 'roundEnd') return undefined
    const id = setTimeout(() => submit({ t: 'deal', seat: 0, seed: newSeed() }), 3600)
    return () => clearTimeout(id)
  }, [vsBot, st.phase, submit])

  useEffect(() => {
    onScore?.(Math.max(0, (st.roundsWon[seat] || 0) * 10 + (st.winnerSeat === seat ? 40 : 0)))
  }, [onScore, st.roundsWon, st.winnerSeat, seat])

  const t = ar
    ? {
      rules: 'الشرح', close: 'إغلاق', deal: 'وزّع الورق', next: 'الجولة التالية', exit: 'خروج',
      waitPlayers: 'بانتظار اللاعبين', need: 'من لاعبَين إلى أربعة — كلٌّ لنفسه، وآخر من يبقى يفوز.',
      startNow: 'ابدأ بالموجودين', hostStarts: 'مضيف الغرفة يبدأ التوزيع.',
      yourTurn: 'دورك', waitingFor: 'الدور على', drawHint: 'اسحب من الكومة أو خذ أعلى المرمية',
      stock: 'الكومة', thrown: 'المرمية', empty: 'فارغة',
      addMeld: 'أضف نزلة', lay: 'انزل', throwCard: 'ارمِ', undo: 'تراجع',
      openNeeds: 'الافتتاح يحتاج 51 نقطة — جهّزت', pts: 'نقطة',
      selHint: 'علّم 3 ورقات فأكثر تكوّن نزلة، أو ورقة واحدة لرميها',
      extHint: 'اضغط نزلة على الطاولة لتمديدها بما علّمت',
      coverBlock: 'هذه الورقة «غطاء» — تُلعب على الطاولة ولا تُرمى',
      badMeld: 'الورقات المعلّمة لا تكوّن نزلة صحيحة',
      roundOver: 'انتهت الجولة', matchOver: 'انتهت المباراة', voidRound: 'نفد الورق — جولة لاغية',
      wonRound: 'أنهى ورقه وفاز بالجولة', burned: 'احترق', youWin: 'فزت بالمباراة', winnerIs: 'الفائز',
      burnsOf: 'الحريق', of31: 'من 31', mode14: 'حريق 14', modeCount: 'عدّ الورق',
      modePick: 'طريقة الحساب', opened: 'مفتّح', notOpened: 'لم يفتتح',
      cards: 'ورقة',
    }
    : {
      rules: 'Rules', close: 'Close', deal: 'Deal', next: 'Next round', exit: 'Exit',
      waitPlayers: 'Waiting for players', need: 'Two to four players — last one standing wins.',
      startNow: 'Start with current players', hostStarts: 'The host deals.',
      yourTurn: 'Your turn', waitingFor: 'Turn:', drawHint: 'Draw from the stock or take the thrown card',
      stock: 'Stock', thrown: 'Thrown', empty: 'Empty',
      addMeld: 'Stage meld', lay: 'Lay down', throwCard: 'Throw', undo: 'Undo',
      openNeeds: 'Opening needs 51 — staged', pts: 'pts',
      selHint: 'Select 3+ cards forming a meld, or one card to throw',
      extHint: 'Tap a table meld to extend it with your selection',
      coverBlock: 'That card fits a meld — play it, not throw it',
      badMeld: 'The selected cards are not a valid meld',
      roundOver: 'Round over', matchOver: 'Match over', voidRound: 'Deck exhausted — void round',
      wonRound: 'emptied their hand and wins the round', burned: 'burned out', youWin: 'You win the match', winnerIs: 'Winner',
      burnsOf: 'Burn', of31: 'of 31', mode14: 'Hareeg 14', modeCount: 'Card count',
      modePick: 'Penalty mode', opened: 'opened', notOpened: 'not opened',
      cards: 'cards',
    }

  const nameOf = (sx) => bySeat[sx]?.name || (ar ? 'مقعد فارغ' : 'Empty seat')
  const rel = (sx) => (sx - seat + 4) % 4
  const POS = ['bottom', 'right', 'top', 'left']

  const myHand = st.hands[seat] || []
  const isMyTurn = st.phase === 'turn' && st.turnSeat === seat && (!remote || st.playing[seat])
  const canAct = isMyTurn && st.step === 'act'
  const canDraw = isMyTurn && st.step === 'draw'

  const stagedFlat = staged.flat()
  const selFree = sel.filter((c) => !stagedFlat.includes(c))
  const stagedPts = staged.reduce((s2, g) => s2 + meldPoints(g), 0)
  const selValidMeld = selFree.length >= 3 && validMeld(selFree)
  const needOpen = !st.opened[seat]
  const canCommit = staged.length > 0 && (!needOpen || stagedPts >= OPEN_MIN)
  const oneSelected = selFree.length === 1 && staged.length === 0
  const selIsCover = oneSelected && isCover(st.melds, selFree[0])
  const allCovers = myHand.length > 0 && myHand.every((c) => isCover(st.melds, c))
  const canThrow = canAct && oneSelected && (!selIsCover || allCovers)

  const toggleCard = (c) => {
    if (!canAct) return
    if (stagedFlat.includes(c)) return
    setSel((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))
  }

  const stageMeld = () => {
    if (!selValidMeld) return
    setStaged((cur) => [...cur, selFree])
    setSel([])
  }

  const unstage = () => { setStaged([]); setSel([]) }

  const commitLay = () => {
    if (!canCommit) return
    submit({ t: 'lay', seat, melds: staged })
    setStaged([])
    setSel([])
  }

  const throwSel = () => {
    if (!canThrow) return
    submit({ t: 'discard', seat, card: selFree[0] })
    setSel([])
  }

  const tryExtend = (idx) => {
    if (!canAct || !st.opened[seat] || !selFree.length) return
    submit({ t: 'extend', seat, meld: idx, cards: selFree })
    setSel([])
  }

  const showLobby = st.phase === 'waiting' && !vsBot
  const showRoundEnd = st.phase === 'roundEnd'
  const showMatchEnd = st.phase === 'matchEnd'
  const showCover = covered && !remote && !vsBot && st.phase === 'turn'
  const discardTop = st.discard.length ? st.discard[st.discard.length - 1] : null

  const modeChip = (
    <span className="cg-chip">{st.phase === 'waiting' ? (mode === '14' ? t.mode14 : t.modeCount) : (st.mode === '14' ? t.mode14 : t.modeCount)}</span>
  )

  return (
    <div className="cg-root" style={{ '--cg-brand': brand }}>
      <div className="cg-top">
        {[0, 1, 2, 3].filter((sx) => st.playing[sx] || bySeat[sx]).map((sx) => (
          <span key={sx} className={'cg-score ' + (sx === seat ? 'is-a' : 'is-b') + (st.out[sx] ? ' is-out' : '')}>
            <span>{sx === seat ? (ar ? 'أنت' : 'You') : initialsOf(nameOf(sx))}</span>
            <b>{fmt(st.burns[sx], ar)}</b>
          </span>
        ))}
        <span className="cg-top-sp" />
        {modeChip}
        <button type="button" className="cg-iconbtn cg-press" onClick={() => setRules(true)} aria-label={t.rules}>
          <span aria-hidden="true">?</span>
        </button>
      </div>

      <div className="cg-stage">
        <div className="cg-felt" />

        {[0, 1, 2, 3].map((sx) => {
          if (!st.playing[sx] && !bySeat[sx]) return null
          const r = rel(sx)
          const p = bySeat[sx]
          const on = st.phase === 'turn' && st.turnSeat === sx
          return (
            <div
              key={sx}
              className={'cg-seat pos-' + POS[r] + (on ? ' is-turn' : '') + (p ? '' : ' is-off') + (st.out[sx] ? ' is-out' : '')}
              style={{ '--sc': ['var(--cg-s0)', 'var(--cg-s1)', 'var(--cg-s2)', 'var(--cg-s3)'][sx] }}
            >
              <span className="cg-av">{initialsOf(p?.name)}</span>
              <span className="cg-seat-col">
                <span className="cg-seat-name">{r === 0 ? (ar ? 'أنت' : 'You') : nameOf(sx)}</span>
                <span className="cg-seat-sub">
                  {st.out[sx]
                    ? t.burned
                    : st.phase === 'turn'
                      ? fmt((st.hands[sx] || []).length, ar) + ' ' + t.cards + (st.opened[sx] ? ' · ' + t.opened : '')
                      : t.burnsOf + ' ' + fmt(st.burns[sx], ar) + ' ' + t.of31}
                </span>
              </span>
            </div>
          )
        })}

        {st.phase === 'turn' || showRoundEnd || showMatchEnd ? (
          <div className="hr-table">
            <div className="hr-piles">
              <button
                type="button"
                className={'hr-pile cg-press' + (canDraw ? ' is-live' : '')}
                disabled={!canDraw}
                onClick={() => submit({ t: 'draw', seat, from: 'stock' })}
                aria-label={t.stock}
              >
                <span className="cg-back hr-pile-back" />
                <span className="hr-pile-lbl">{t.stock} · {fmt(st.stock.length, ar)}</span>
              </button>
              <button
                type="button"
                className={'hr-pile cg-press' + (canDraw && discardTop ? ' is-live' : '')}
                disabled={!canDraw || !discardTop}
                onClick={() => submit({ t: 'draw', seat, from: 'discard' })}
                aria-label={t.thrown}
              >
                {discardTop ? <CardFace code={discardTop} small /> : <span className="hr-pile-empty">{t.empty}</span>}
                <span className="hr-pile-lbl">{t.thrown} · {fmt(st.discard.length, ar)}</span>
              </button>
            </div>

            <div className="hr-melds cg-scroll">
              {st.melds.map((m, i) => (
                <button
                  key={i}
                  type="button"
                  className={'hr-meld cg-press' + (canAct && st.opened[seat] && selFree.length ? ' is-target' : '')}
                  onClick={() => tryExtend(i)}
                  aria-label={(m.kind === 'run' ? (ar ? 'سلسلة' : 'Run') : (ar ? 'مجموعة' : 'Set'))}
                >
                  {sortHand(m.cards).map((c) => <CardFace key={c} code={c} small />)}
                </button>
              ))}
              {!st.melds.length ? (
                <span className="hr-nomelds">{ar ? 'لا نزلات على الطاولة بعد — الافتتاح 51 نقطة' : 'No melds yet — opening needs 51'}</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {st.phase === 'turn' && !isMyTurn ? (
          <div className="cg-banner">{t.waitingFor} {nameOf(st.turnSeat)}</div>
        ) : null}

        {showLobby ? (
          <div className="cg-lobby">
            <strong className="cg-lobby-title">{t.waitPlayers}</strong>
            <p className="cg-lobby-sub">{t.need}</p>
            <div className="cg-lobby-seats">
              {[0, 1, 2, 3].map((sx) => (
                <div
                  key={sx}
                  className={'cg-lobby-seat' + (bySeat[sx] ? ' is-filled' : '') + (sx === seat ? ' is-me' : '')}
                  style={{ '--sc': ['var(--cg-s0)', 'var(--cg-s1)', 'var(--cg-s2)', 'var(--cg-s3)'][sx] }}
                >
                  <span className="cg-av">{initialsOf(bySeat[sx]?.name)}</span>
                  <span>{bySeat[sx]?.name || '—'}</span>
                </div>
              ))}
            </div>
            {host ? (
              <>
                <div className="cg-actions" role="radiogroup" aria-label={t.modePick}>
                  <button type="button" className={'cg-btn is-sm cg-press' + (mode === '14' ? ' is-gold' : ' is-ghost')} onClick={() => setMode('14')}>{t.mode14}</button>
                  <button type="button" className={'cg-btn is-sm cg-press' + (mode === 'count' ? ' is-gold' : ' is-ghost')} onClick={() => setMode('count')}>{t.modeCount}</button>
                </div>
                {filled >= 2 ? (
                  <button type="button" className="cg-btn is-gold cg-press" onClick={() => submit({ t: 'deal', seed: newSeed(), dealer: 0, mode })}>
                    {filled < 4 ? t.startNow : t.deal}
                  </button>
                ) : (
                  <span className="cg-dots"><i /><i /><i /></span>
                )}
              </>
            ) : (
              <p className="cg-lobby-sub">{t.hostStarts}</p>
            )}
          </div>
        ) : null}

        {showCover ? (
          <div className="cg-modal" onClick={() => setCovered(false)}>
            <div className="cg-modal-card">
              <strong className="cg-modal-title">{ar ? 'سلّم الجهاز إلى' : 'Pass the phone to'} {nameOf(seat)}</strong>
              <p className="cg-modal-sub">{ar ? 'اضغط لعرض أوراقك' : 'Tap to see your cards'}</p>
            </div>
          </div>
        ) : null}

        {showRoundEnd || showMatchEnd ? (
          <div className="cg-modal">
            <div className="cg-modal-card">
              <strong className="cg-modal-title">
                {showMatchEnd
                  ? (st.winnerSeat === seat ? t.youWin : t.winnerIs + ': ' + nameOf(st.winnerSeat ?? 0))
                  : st.lastRound?.void ? t.voidRound : t.roundOver}
              </strong>
              {st.lastRound && !st.lastRound.void && st.lastRound.winner != null ? (
                <p className="cg-modal-sub">{nameOf(st.lastRound.winner)} — {t.wonRound}</p>
              ) : null}
              <div className="cg-modal-rows">
                {[0, 1, 2, 3].filter((sx) => st.playing[sx]).map((sx) => (
                  <div key={sx} className={'cg-row ' + (sx === seat ? 'is-a' : 'is-b')}>
                    <span>{sx === seat ? (ar ? 'أنت' : 'You') : nameOf(sx)}{st.out[sx] ? ' · ' + t.burned : ''}</span>
                    <span className={'cg-delta' + ((st.lastRound?.pens?.[sx] || 0) > 0 ? ' is-down' : '')}>
                      {st.lastRound?.pens?.[sx] ? '+' + fmt(st.lastRound.pens[sx], ar) : '—'}
                    </span>
                    <b>{fmt(st.burns[sx], ar)} / {fmt(BURN_AT, ar)}</b>
                  </div>
                ))}
              </div>
              <div className="cg-actions">
                {showMatchEnd ? (
                  <button type="button" className="cg-btn is-primary cg-press" onClick={() => onExit?.()}>{t.exit}</button>
                ) : vsBot ? (
                  <span className="cg-dots"><i /><i /><i /></span>
                ) : host ? (
                  <button type="button" className="cg-btn is-gold cg-press" onClick={() => submit({ t: 'deal', seed: newSeed() })}>{t.next}</button>
                ) : (
                  <span className="cg-dots"><i /><i /><i /></span>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="cg-hand-wrap">
        {staged.length ? (
          <div className="hr-staged">
            {staged.map((g, i) => (
              <span key={i} className="hr-staged-meld">
                {g.map((c) => <CardFace key={c} code={c} small />)}
              </span>
            ))}
            <span className="hr-staged-pts">{fmt(stagedPts, ar)} {t.pts}</span>
          </div>
        ) : null}

        <div className="cg-hand" style={{ '--cg-overlap': (myHand.length > 12 ? -24 : myHand.length > 9 ? -18 : -10) + 'px' }}>
          {myHand.map((c) => {
            const inStage = stagedFlat.includes(c)
            const on = sel.includes(c) && !inStage
            return (
              <button
                key={c}
                type="button"
                className={'cg-hand-slot' + (on ? ' is-up' : '') + (inStage ? ' is-dim' : '')}
                disabled={!canAct || inStage}
                onClick={() => toggleCard(c)}
                aria-label={label(c) + ' ' + (ar ? SUIT_AR[suitOf(c)] : SUIT_EN[suitOf(c)])}
              >
                <CardFace code={c} />
              </button>
            )
          })}
        </div>

        {canAct ? (
          <div className="cg-actions">
            {selValidMeld ? (
              <button type="button" className="cg-btn is-sm is-primary cg-press" onClick={stageMeld}>
                {t.addMeld} · {fmt(meldPoints(selFree), ar)}
              </button>
            ) : null}
            {staged.length ? (
              <>
                <button type="button" className={'cg-btn is-sm cg-press' + (canCommit ? ' is-gold' : ' is-ghost')} disabled={!canCommit} onClick={commitLay}>
                  {t.lay} · {fmt(stagedPts, ar)} {needOpen ? '/ ' + fmt(OPEN_MIN, ar) : ''}
                </button>
                <button type="button" className="cg-btn is-sm is-ghost cg-press" onClick={unstage}>{t.undo}</button>
              </>
            ) : null}
            {oneSelected ? (
              <button type="button" className={'cg-btn is-sm cg-press' + (canThrow ? ' is-primary' : ' is-ghost')} disabled={!canThrow} onClick={throwSel}>
                {t.throwCard}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="cg-hand-hint">
          {st.phase !== 'turn'
            ? ''
            : !isMyTurn
              ? t.waitingFor + ' ' + nameOf(st.turnSeat)
              : canDraw
                ? t.drawHint
                : oneSelected && selIsCover && !allCovers
                  ? t.coverBlock
                  : selFree.length >= 3 && !selValidMeld
                    ? t.badMeld
                    : canAct && st.opened[seat] && selFree.length
                      ? t.extHint
                      : t.selHint}
        </div>
      </div>

      {rules ? (
        <div className="cg-over">
          <div className="cg-over-head">
            <strong>{ar ? 'الحريق — الشرح' : 'Hareeg — how to play'}</strong>
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
  if (!s) return '·'
  return s.slice(0, 1)
}
function newSeed() {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1
}
