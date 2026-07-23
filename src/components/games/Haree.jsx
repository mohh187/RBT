// «الحريق» — Haree'g: the Sudanese / Gulf elimination rummy game.
//
// ===========================================================================
// WHICH VARIANT THIS FILE IMPLEMENTS  (read this before changing any rule)
// ===========================================================================
// Hareeg is played slightly differently from table to table — mostly in the
// opening threshold, in whether the thrown card may «cover» a table meld, and
// in how the round penalty is counted. Blending variants produces a game
// nobody actually plays, so this file implements ONE coherent ruleset end to
// end — the widely played «حريق 14» family — with the ONE sanctioned switch
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
//                       «حريق 14» risk).
//       - mode «عدّ»  : one point per card left (the slower classic count).
//   • BURNING (الحرق): a player whose accumulated penalties reach 31 is
//     burned and leaves the table. Rounds continue among the survivors; the
//     LAST PLAYER STANDING wins the match.
//   • STOCK: when the stock runs dry, the thrown pile (minus its top card)
//     is reshuffled — deterministically from the round seed — into a new
//     stock. If there is nothing left to reshuffle the round is void: no
//     winner, no penalties, next dealer redeals. A round that has ALREADY
//     been rebuilt MAX_RESHUFFLE times and still has nobody out is dead and
//     is voided the same way — without that cap a table where nobody can
//     open cycles the same cards forever, which measurement confirmed.
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
// PRESENTATION CONTRACT (this component renders ONLY the play area)
//   • The hub (GamesCenter) owns the title bar, the live score, mute and
//     close. Everything below the hub bar is ours.
//   • Sizing is MEASURED, never guessed: a ResizeObserver on the root feeds
//     five CSS numbers (--hg-card / --hg-tcard / --hg-pile / --hg-fs /
//     --hg-lap) that every length in haree.css is a multiple of. A fifteen
//     card hand fits a 360px phone with no crop and no scroll, and the same
//     markup is legible on a 1920x1080 venue TV.
//   • A viewer holding no seat (`mySeat` not an integer in a room) is a
//     SPECTATOR: no hand is rendered for them, and no control implies they
//     can act.
//   • Any rule that removes an option says so on the board — the cover rule
//     dims the card AND points at the meld it belongs to.
//
// KNOWN LIMITATION (same as every card game here): the hands live in
// room.state and the room doc is readable by its players; the UI hides other
// hands but a network inspector does not. Hiding them for real needs
// per-seat subcollections + rules, outside this component.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { botMoveFor, botLabel, takeSoloIntent, BOT_DELAY_MS } from '../../lib/gameBots.js'
import { play } from '../../lib/gameSounds.js'
import '../../styles/cardgames.css'
import '../../styles/haree.css'

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
// how many times the thrown pile may be rebuilt into a stock before the round
// is declared dead. Termination guard, not a tactic — see the STOCK note above.
const MAX_RESHUFFLE = 3

const suitOf = (c) => String(c || '').charAt(1)
const rankOf = (c) => String(c || '').charAt(0)
const isJoker = (c) => rankOf(c) === 'X'
const nx = (s) => (s + 1) % 4

const RANK_LABEL = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }
// A joker has NO rank text: its corner index is the star SVG in SUIT_PATH.
// (Hard repo rule: icons are inline SVG, never a text glyph or an emoji.)
const label = (c) => (isJoker(c) ? '' : RANK_LABEL[rankOf(c)] || rankOf(c))

const SUIT_AR = { S: 'بستوني', H: 'كبة', D: 'ديناري', C: 'سباتي', '*': 'جوكر' }
const SUIT_EN = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs', '*': 'Joker' }
// how a card is NAMED in running text (a button label, a screen reader)
const cardWord = (c, ar) => (isJoker(c) ? (ar ? SUIT_AR['*'] : SUIT_EN['*']) : label(c))

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

// WHICH melds it fits. The cover rule is the one rule in this game that
// silently removes an option, so the board has to be able to point at the
// meld that took it away.
export function coverTargets(melds, card) {
  const out = []
  const list = melds || []
  for (let i = 0; i < list.length; i += 1) if (validMeld([...list[i].cards, card])) out.push(i)
  return out
}

// melds the current selection could legally be added to
export function extendTargets(melds, cards) {
  const out = []
  const list = melds || []
  if (!cards || !cards.length) return out
  for (let i = 0; i < list.length; i += 1) if (validMeld([...list[i].cards, ...cards])) out.push(i)
  return out
}

// reading order for a meld on the table: a run ascends and its jokers sit in
// the gaps they are standing in for; a set keeps its naturals together.
export function orderMeld(cards) {
  const all = Array.isArray(cards) ? cards : []
  const nat = all.filter((c) => !isJoker(c))
  const jok = all.filter(isJoker)
  if (nat.length < 2) return [...all]
  if (nat.every((c) => rankOf(c) === rankOf(nat[0]))) return [...nat, ...jok]
  const aceLow = nat.some((c) => rankOf(c) === 'A') && nat.some((c) => rankOf(c) === '2')
  const val = (c) => (rankOf(c) === 'A' ? (aceLow ? 1 : 14) : RUN_VAL[rankOf(c)] || 0)
  const asc = [...nat].sort((a, b) => val(a) - val(b))
  const spare = [...jok]
  const out = []
  for (let i = 0; i < asc.length; i += 1) {
    out.push(asc[i])
    if (i < asc.length - 1) {
      let gap = val(asc[i + 1]) - val(asc[i]) - 1
      while (gap > 0 && spare.length) { out.push(spare.shift()); gap -= 1 }
    }
  }
  return [...spare, ...out]
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
    const cards = sortHand([...pool].filter((c) => suitOf(c) === s))
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
  const free = [...jokers]
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
export const botHelpers = { validMeld, meldPoints, findMelds, isCover, isJoker, valueOf, suitOf, rankOf, OPEN_MIN, RUN_VAL }

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
    melds: [],        // [{ cards:[codes], kind:'run'|'set', by:seat }] — shared table
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
  'الكومة: إذا نفدت تُخلط المرمية (عدا أعلاها) كومةً جديدة. وإن لم يبق ما يُخلط، أو تكرّر الخلط ثلاث مرات ولم يخرج أحد، أُلغيت الجولة بلا عقوبات وأعاد الموزّع التالي التوزيع.',
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
  '',
  'The stock: when it runs dry the thrown pile (minus its top card) is reshuffled into a new stock. If there is nothing left to rebuild, or the pile has been rebuilt three times and nobody has gone out, the round is void — no winner, no penalties, next dealer redeals.',
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
      lastDraw: null,
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
      state: { ...s, hands, discard: s.discard.slice(0, -1), step: 'act', lastDraw: { seat, from: 'discard', card } },
      turn: turnOf(seat, move),
    }
  }

  let stock = s.stock
  let discard = s.discard
  let reshuffles = s.reshuffles
  if (!stock.length) {
    if (discard.length <= 1 || reshuffles >= MAX_RESHUFFLE) {
      // nothing left to rebuild from, or the same cards have gone round often
      // enough that nobody is going to go out — the round is void, no penalties
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
    state: { ...s, hands, stock: stock.slice(0, -1), discard, reshuffles, step: 'act', lastDraw: { seat, from: 'stock', card } },
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
  const melds = [...s.melds, ...groups.map((g) => ({ cards: g, kind: meldKind(g), by: seat }))]
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
  const melds = s.melds.map((m, i) => (i === idx ? { ...m, cards: merged, kind: meldKind(merged) } : m))
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
// drawing — inline SVG only (never a glyph, never an emoji)
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

const GLYPH = {
  help: 'M9.1 9a3 3 0 1 1 4 2.8c-.7.3-1.1 1-1.1 1.7v.6M12 17.4h.01',
  caret: 'M6 9l6 6 6-6',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z',
  close: 'M6 6l12 12M18 6L6 18',
  down: 'M12 4v13m0 0l-5-5m5 5l5-5',
  up: 'M12 20V7m0 0l-5 5m5-5l5 5',
  spark: 'M12 3l1.9 4.9L19 9.8l-4.1 3.1 1.3 5.3L12 15.5 7.8 18.2l1.3-5.3L5 9.8l5.1-.9z',
  warn: 'M12 4.5l8.5 15h-17zM12 10v4m0 3h.01',
  check: 'M4.5 12.5l5 5 10-11',
  flame: 'M12 3.2c3.4 3 5.2 5.6 5.2 8.4a5.2 5.2 0 1 1-10.4 0c0-1.3.5-2.6 1.4-3.9.3 1.2 1 1.9 1.9 2 .3-2.4.9-4.4 1.9-6.5z',
}

function Glyph({ name, className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} focusable="false" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d={GLYPH[name] || GLYPH.help} />
    </svg>
  )
}

// One card face. `w` names the CSS variable that drives its size, so the same
// component is a hand card, a table card or a pile card.
function CardFace({ code, w = 'var(--hg-card)', className = '' }) {
  const s = suitOf(code)
  const joker = isJoker(code)
  return (
    <span
      className={'hg-card' + (RED[s] ? ' is-red' : '') + (joker ? ' is-joker' : '') + (className ? ' ' + className : '')}
      style={{ '--w': w }}
    >
      {joker
        ? <Suit s="*" className="hg-rank-ico" />
        : <span className="hg-rank">{label(code)}</span>}
      <Suit s={s} className="hg-mini" />
      <Suit s={s} className="hg-big" />
      <Suit s={s} className="hg-pip" />
    </span>
  )
}

function CardBack({ w = 'var(--hg-card)', className = '' }) {
  return <span className={'hg-back' + (className ? ' ' + className : '')} style={{ '--w': w }} aria-hidden="true" />
}

// ---------------------------------------------------------------------------
// local fallback table — hot-seat or vs the computer, same reduce
// ---------------------------------------------------------------------------
const LOCAL_NAMES = ['اللاعب الأول', 'اللاعب الثاني', 'اللاعب الثالث', 'اللاعب الرابع']

// `bots` is the NUMBER of machine seats the lobby asked for (1..3), or 0 for a
// hot-seat table. The old build always opened four seats, so «خصم واحد» still
// dealt a four-handed game — the lobby's choice is honoured here now.
function makeLocalRoom(playerName, bots, lang) {
  const seats = bots > 0 ? bots + 1 : 4
  return {
    roomId: 'local',
    gameId: 'haree',
    status: 'playing',
    local: true,
    players: [0, 1, 2, 3].slice(0, seats).map((seat) => ({
      id: (bots && seat > 0 ? 'bot-' : 'local-') + seat,
      name: seat === 0
        ? (playerName || LOCAL_NAMES[0])
        : (bots ? botLabel(seat - 1, bots, lang) : LOCAL_NAMES[seat]),
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

const SEAT_COLOR = ['#38bdf8', '#fbbf24', '#818cf8', '#fb7185']
const LEVELS = ['easy', 'normal', 'hard']
const clamp = (lo, v, hi) => Math.max(lo, Math.min(hi, v))

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
  // how many machine seats the lobby asked for — 0 means a hot-seat table
  const [bots] = useState(() => {
    if (remote) return 0
    const asked = Number(soloBots) > 0 ? Number(soloBots) : Number(takeSoloIntent('haree')?.bots || 0)
    return asked > 0 ? clamp(1, Math.round(asked), 3) : 0
  })
  const vsBot = bots > 0
  const [localRoom, setLocalRoom] = useState(() => makeLocalRoom(playerName, bots, lang))
  const [rules, setRules] = useState(false)
  const [covered, setCovered] = useState(false)
  const [sel, setSel] = useState([])       // selected card codes in my hand
  const [staged, setStaged] = useState([]) // melds built but not committed yet
  const [mode, setMode] = useState('14')
  const [level, setLevel] = useState('normal')
  const [levelOpen, setLevelOpen] = useState(false)
  const [shake, setShake] = useState(0)    // a rejected attempt, never silence
  const [flash, setFlash] = useState('')   // the reason it was rejected
  const [fresh, setFresh] = useState(null) // codes that just arrived in my hand

  const rootRef = useRef(null)

  const table = remote ? room : localRoom
  const st = useMemo(() => normalise(table?.state), [table])

  // ---- who am I? a room viewer with no seat WATCHES and is never handed a
  // hand or a control that implies they can act.
  const seated = remote && Number.isInteger(mySeat) && mySeat >= 0 && mySeat < 4
  const spectator = remote && !seated
  const seat = spectator ? -1 : (remote ? mySeat : (vsBot ? 0 : (Number.isInteger(st.turnSeat) ? st.turnSeat : 0)))
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

  // Selection resets whenever the turn moves on or a new round starts — and so
  // does any rule warning: a «that card is a cover» line left on screen during
  // someone else's turn reads as a complaint about a card nobody is holding.
  useEffect(() => {
    setSel([]); setStaged([]); setShake(0); setFlash('')
    // the level menu covers two player tiles — it never survives a turn
    setLevelOpen(false)
  }, [st.turnSeat, st.step, st.roundNo])

  const myHand = seat >= 0 ? (st.hands[seat] || []) : []
  const handKey = myHand.join(',')

  // ---- cards that just landed in my hand get one entry animation, once ----
  const handRef = useRef(null)
  useEffect(() => {
    const prev = handRef.current
    handRef.current = myHand
    if (!prev) return undefined
    const added = myHand.filter((c) => !prev.includes(c))
    if (!added.length) return undefined
    setFresh(new Set(added))
    // long enough to outlast the staggered cascade of a full fourteen-card
    // deal (13 * 22ms of delay + the 420ms flight), or the last cards snap
    const id = setTimeout(() => setFresh(null), 820)
    return () => clearTimeout(id)
    // handKey is the identity of the hand; myHand is a fresh array every render
  }, [handKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- a meld that just landed (or just grew) plays its arrival once ----
  const meldSig = st.melds.map((m) => (m.cards || []).join('')).join('|')
  const meldRef = useRef(null)
  const [freshMelds, setFreshMelds] = useState(null)
  useEffect(() => {
    const cur = st.melds.map((m) => (m.cards || []).join(''))
    const prev = meldRef.current
    meldRef.current = cur
    if (!prev) return undefined
    const changed = new Set()
    cur.forEach((sig, i) => { if (prev[i] !== sig) changed.add(i) })
    if (!changed.size) return undefined
    setFreshMelds(changed)
    const id = setTimeout(() => setFreshMelds(null), 460)
    return () => clearTimeout(id)
  }, [meldSig]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- MEASURED SIZING. Everything on screen is a multiple of these five
  // numbers, so a fifteen-card hand fits a 360px phone with no crop and the
  // same markup is legible across a room on a 1920x1080 TV.
  const [box, setBox] = useState({ w: 390, h: 760 })
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const read = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        setBox((b) => (Math.abs(b.w - r.width) < 1 && Math.abs(b.h - r.height) < 1 ? b : { w: r.width, h: r.height }))
      }
    }
    read()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read)
      return () => window.removeEventListener('resize', read)
    }
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const tableCards = st.melds.reduce((a, m) => a + ((m.cards && m.cards.length) || 0), 0)
  const longestMeld = st.melds.reduce((a, m) => Math.max(a, (m.cards && m.cards.length) || 0), 3)

  const metrics = useMemo(() => {
    const w = Math.max(240, box.w)
    const h = Math.max(360, box.h)
    // base type: tracks the scarcer axis so a TV gets big type and a phone
    // stays honest. Latin digits are tabular everywhere, so this never reflows.
    const fs = clamp(10, Math.min(w / 33, h / 42), 26)
    // hand: solve for the widest card that still fits N of them at 56% pitch
    const n = Math.max(6, myHand.length || 14)
    const pitch = 0.56
    const byW = (w - fs * 2.2) / (1 + (n - 1) * pitch)
    const card = clamp(20, Math.min(byW, h * 0.135), 96)
    // The furniture on the table must NOT breathe with the hand. `card` grows
    // as the hand empties (a last card deserves to be big), and hanging the
    // piles and the melds off it made the whole table swell every time someone
    // laid down. `unit` is the same solve for a FULL fourteen-card hand, so it
    // is stable for the length of a round.
    const unit = clamp(20, Math.min((w - fs * 2.2) / (1 + 13 * pitch), h * 0.135), 96)
    // the piles carry the empty table: while the shelf is sparse they grow to
    // fill the felt, so an early round is a real card table rather than two
    // stamps floating in green
    const pileMul = st.melds.length === 0 ? 1.55 : st.melds.length <= 3 ? 1.28 : 1.02
    const pile = clamp(26, Math.min(unit * pileMul, h * 0.19, w * 0.3), 132)

    // ---- the melds shelf is SOLVED, not guessed. Estimate the height the
    // felt actually leaves it from the same multiples the stylesheet uses,
    // then take the largest table card whose real wrapped layout still fits.
    // The old density ladder cropped the top row of the shelf on a 1920x1080
    // TV, which is exactly the screen the tournaments run on.
    const topH = fs * 6.9
    const benchH = fs * 0.3 + unit * 0.66 * 1.4
    const handH = fs * 0.72 + benchH + card * 1.4 + fs * 0.75 + fs * 2.5 + fs * 1.3 + fs * 0.42
    const boardH = Math.max(fs * 8, h - topH - handH - fs * 0.84)
    const shelfH = Math.max(fs * 3, boardH - fs * 1.7 - (pile * 1.4 + fs * 1.2))
    const shelfW = Math.max(fs * 6, w - fs * 2.8)
    const M = Math.max(1, st.melds.length)
    const L = Math.max(3, longestMeld)
    const heightAt = (tc) => {
      const trayW = tc * (1 + (L - 1) * 0.62) + fs * 1.3
      const perRow = Math.max(1, Math.floor(shelfW / trayW))
      const rows = Math.ceil(M / perRow)
      return rows * (tc * 1.4 + fs * 1.5) + (rows - 1) * fs * 0.4
    }
    let tcard = clamp(13, Math.min(unit * 0.86, shelfW * 0.3), 80)
    for (let guard = 0; guard < 40 && tcard > 13; guard += 1) {
      if (heightAt(tcard) <= shelfH) break
      tcard = Math.max(13, tcard * 0.92)
    }
    return {
      fs: Math.round(fs * 10) / 10,
      card: Math.round(card * 10) / 10,
      tcard: Math.round(tcard * 10) / 10,
      pile: Math.round(pile * 10) / 10,
      lap: -Math.round(card * (1 - pitch) * 10) / 10,
      tlap: -Math.round(tcard * 0.38 * 10) / 10,
    }
  }, [box.w, box.h, myHand.length, st.melds.length, longestMeld])

  const cssVars = {
    '--cg-brand': brand,
    '--hg-fs': metrics.fs + 'px',
    '--hg-card': metrics.card + 'px',
    '--hg-tcard': metrics.tcard + 'px',
    '--hg-pile': metrics.pile + 'px',
    '--hg-lap': metrics.lap + 'px',
    '--hg-tlap': metrics.tlap + 'px',
  }

  // ---- sound feedback. Display-only: one effect over existing state fields,
  // ref-guarded so nothing fires on mount or on a room rehydration — only on
  // a real change. Every event this game has is wired.
  const sndRef = useRef(null)
  useEffect(() => {
    const cur = {
      roundNo: st.roundNo,
      discardN: st.discard.length,
      stockN: st.stock.length,
      meldN: tableCards,
      phase: st.phase,
      turnSeat: st.turnSeat,
      step: st.step,
      burns: st.burns.join(','),
    }
    const prev = sndRef.current
    sndRef.current = cur
    if (!prev) return
    if (cur.roundNo !== prev.roundNo) { play('deal'); return }
    if (cur.phase !== prev.phase) {
      // A screen that only WATCHES has no result of its own: it celebrates the
      // table rather than mourning a seat it never held.
      if (cur.phase === 'matchEnd') { play(seat < 0 || st.winnerSeat === seat ? 'win' : 'lose'); return }
      if (cur.phase === 'roundEnd') {
        const lr = st.lastRound
        if (lr && !lr.void) {
          const burnedMe = (lr.burnedNow || []).includes(seat)
          if ((lr.burnedNow || []).length) play('capture', { gain: 0.9 })
          if (seat < 0 || lr.winner === seat) play('win', { gain: 0.6 })
          else play('lose', { gain: burnedMe ? 0.7 : 0.35 })
        }
        return
      }
    }
    // a lay / an extend puts cards on the table: a heavier, slid sound
    if (cur.meldN > prev.meldN) play('move', { gain: 0.9 })
    // a throw grows the pile; a take from the pile shrinks it
    else if (cur.discardN > prev.discardN) play('card')
    else if (cur.discardN < prev.discardN || cur.stockN < prev.stockN) play('card', { gain: 0.6 })
    if (cur.turnSeat !== prev.turnSeat && cur.turnSeat === seat && cur.phase === 'turn' && (remote || vsBot)) {
      play('turn', { gain: 0.85 })
    }
  }, [st, seat, remote, vsBot, tableCards])

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
    const id = setTimeout(() => submit({ t: 'deal', seat: 0, seed: newSeed(), dealer: 0, mode }), 300)
    return () => clearTimeout(id)
  }, [vsBot, st.phase, submit, mode])

  // machine seats — one legal move per state change, validated through reduce.
  // The chosen level rides on ctx; gameBots reads ctx.level and nothing else
  // in this component changes.
  const levelRef = useRef(level)
  useEffect(() => { levelRef.current = level }, [level])
  // A Hareeg turn is not one move: a bot draws, then lays, then extends once
  // per meld, then throws. Charging the full «thinking» beat for every link in
  // that chain made one bot turn take five seconds and a lap of three bots
  // forty. The beat belongs BETWEEN players, so only the first move of a seat's
  // turn waits; the rest of its own chain runs at a readable clip.
  const chainRef = useRef({ seat: -1, n: 0 })
  useEffect(() => {
    if (!vsBot) return undefined
    if (st.phase !== 'turn') return undefined
    const acting = st.turnSeat
    if (!Number.isInteger(acting) || acting <= 0) return undefined
    if (!bySeat[acting]?.bot) return undefined
    if (chainRef.current.seat !== acting) chainRef.current = { seat: acting, n: 0 }
    const wait = chainRef.current.n === 0 ? BOT_DELAY_MS : 300
    const id = setTimeout(() => {
      const mv = botMoveFor('haree', st, acting, {
        reduce, room: localRoom, helpers: botHelpers, level: levelRef.current,
      })
      if (mv) { chainRef.current = { seat: acting, n: chainRef.current.n + 1 }; submit(mv) }
    }, wait)
    return () => clearTimeout(id)
  }, [vsBot, st, localRoom, submit, bySeat])

  // solo: roll the next round automatically once the result has been readable
  useEffect(() => {
    if (!vsBot || st.phase !== 'roundEnd') return undefined
    const id = setTimeout(() => submit({ t: 'deal', seat: 0, seed: newSeed() }), 4200)
    return () => clearTimeout(id)
  }, [vsBot, st.phase, submit])

  useEffect(() => {
    if (seat < 0) return
    onScore?.(Math.max(0, (st.roundsWon[seat] || 0) * 10 + (st.winnerSeat === seat ? 40 : 0)))
  }, [onScore, st.roundsWon, st.winnerSeat, seat])

  const t = ar
    ? {
      rules: 'الشرح', close: 'إغلاق', deal: 'وزّع الورق', next: 'الجولة التالية', exit: 'خروج',
      waitPlayers: 'بانتظار اللاعبين', need: 'من لاعبَين إلى أربعة — كلٌّ لنفسه، وآخر من يبقى يفوز.',
      startNow: 'ابدأ بالموجودين', hostStarts: 'مضيف الغرفة يبدأ التوزيع.',
      round: 'الجولة', stock: 'الكومة', thrown: 'المرمية', empty: 'فارغة',
      addMeld: 'أضف نزلة', lay: 'انزل', throwCard: 'ارمِ', undo: 'تراجع', suggest: 'اقترح', extend: 'مدّد', clearSel: 'ألغِ التحديد',
      pts: 'نقطة', openMeter: 'نحو الافتتاح',
      hintDraw: 'دورك — اسحب من الكومة أو خذ أعلى المرمية',
      hintPickMeld: 'علّم ثلاث ورقات فأكثر تكوّن نزلة، ثم «أضف نزلة»',
      hintNeedMore: (n) => 'ينقصك ' + n + ' نقطة لبلوغ 51 — أضف نزلة أخرى أو تراجع',
      hintReady: 'بلغت 51 — اضغط «انزل» لتثبيت نزلاتك',
      hintThrow: 'اضغط «ارمِ» لإنهاء دورك',
      hintExtend: 'اضغط النزلة المضيئة لتمديدها بما علّمت',
      hintNoOpen: 'لا تمديد قبل الافتتاح — افتتح بـ51 نقطة أولاً',
      hintBad: 'الورقات المعلّمة لا تكوّن نزلة صحيحة',
      hintFree: 'انزل أو مدّد، ثم ارمِ ورقة واحدة لإنهاء دورك',
      hintOpenFirst: 'افتتح بـ51 نقطة، أو ارمِ ورقة لإنهاء دورك',
      coverBlock: 'غطاء — هذه الورقة تدخل في النزلة المضيئة، تُلعب ولا تُرمى',
      coverAll: 'كل أوراقك أغطية — يجوز لك الرمي',
      waitFor: 'الدور على', watching: 'أنت تشاهد هذه الجولة', youBurned: 'احترقت وخرجت من المباراة — تتابع حتى ينتهي الباقون',
      noMelds: 'لا نزلات على الطاولة بعد — أول نزول يحتاج 51 نقطة',
      run: 'سلسلة', set: 'مجموعة',
      roundOver: 'انتهت الجولة', voidRound: 'نفد الورق — جولة لاغية',
      wonRound: 'أنهى ورقه وفاز بالجولة', burned: 'احترق', youWin: 'فزت بالمباراة', winnerIs: 'الفائز',
      mode14: 'حريق 14', modeCount: 'عدّ الورق', modePick: 'طريقة الحساب',
      opened: 'مفتّح', you: 'أنت', emptySeat: 'مقعد فارغ',
      lvl: 'الخصوم', easy: 'سهل', normal: 'عادي', hard: 'صعب',
      lvlNote: {
        easy: 'لا ينظر إلى المرمية أبداً، ويؤخّر افتتاحه حتى يفيض عن 51، ويرمي أخفّ ورقة عنده فتتراكم الصور في يده وتحرقه.',
        normal: 'يأخذ المرمية إذا دخلت في نزلة عنده، يفتتح فور بلوغ 51، ينزل ويمدّد ما يجد، ويرمي أثقل ورقة لا تنفعه.',
        hard: 'مثل «عادي» ويزيد: يحتفظ بالأزواج والمتتاليات القريبة، ويرمي أثقل ورقة ليس لها شريك في يده.',
      },
      shakeNoOpen: 'لم تفتتح بعد — لا يمكنك التمديد',
      shakeNoFit: 'ما علّمته لا يدخل في هذه النزلة',
      shakeShort: 'الافتتاح يحتاج 51 نقطة دفعة واحدة',
      shakeOne: 'علّم ورقة واحدة فقط للرمي',
    }
    : {
      rules: 'Rules', close: 'Close', deal: 'Deal', next: 'Next round', exit: 'Exit',
      waitPlayers: 'Waiting for players', need: 'Two to four players — last one standing wins.',
      startNow: 'Start with current players', hostStarts: 'The host deals.',
      round: 'Round', stock: 'Stock', thrown: 'Thrown', empty: 'Empty',
      addMeld: 'Stage meld', lay: 'Lay down', throwCard: 'Throw', undo: 'Undo', suggest: 'Suggest', extend: 'Extend', clearSel: 'Clear picks',
      pts: 'pts', openMeter: 'To open',
      hintDraw: 'Your turn — draw from the stock or take the thrown card',
      hintPickMeld: 'Select three or more cards that form a meld, then «Stage meld»',
      hintNeedMore: (n) => n + ' more points to reach 51 — stage another meld or undo',
      hintReady: 'You have 51 — press «Lay down» to commit',
      hintThrow: 'Press «Throw» to end your turn',
      hintExtend: 'Tap the highlighted meld to extend it',
      hintNoOpen: 'No extending before you open — lay 51 first',
      hintBad: 'The selected cards are not a valid meld',
      hintFree: 'Lay or extend, then throw one card to end your turn',
      hintOpenFirst: 'Open with 51, or throw a card to end your turn',
      coverBlock: 'Cover — this card fits the highlighted meld; play it, do not throw it',
      coverAll: 'Every card in your hand is a cover — you may throw anything',
      waitFor: 'Turn:', watching: 'You are watching this round', youBurned: 'You burned out — the survivors play on',
      noMelds: 'No melds on the table yet — the first lay-down needs 51',
      run: 'Run', set: 'Set',
      roundOver: 'Round over', voidRound: 'Deck exhausted — void round',
      wonRound: 'emptied their hand and wins the round', burned: 'burned out', youWin: 'You win the match', winnerIs: 'Winner',
      mode14: 'Hareeg 14', modeCount: 'Card count', modePick: 'Penalty mode',
      opened: 'opened', you: 'You', emptySeat: 'Empty seat',
      lvl: 'Opponents', easy: 'Easy', normal: 'Normal', hard: 'Hard',
      lvlNote: {
        easy: 'Never reads the thrown pile, waits for a margin over 51 before opening, and throws its lightest card so the pictures pile up and burn it.',
        normal: 'Takes the thrown card when it completes a meld, opens the moment it holds 51, lays and extends, and throws its heaviest useless card.',
        hard: 'Like normal, plus it keeps pairs and near-runs and throws the heaviest card with no partner in hand.',
      },
      shakeNoOpen: 'You have not opened yet — no extending',
      shakeNoFit: 'Your selection does not fit that meld',
      shakeShort: 'Opening needs 51 points in one turn',
      shakeOne: 'Select exactly one card to throw',
    }

  const nameOf = (sx) => bySeat[sx]?.name || t.emptySeat
  const shortName = (sx) => (sx === seat ? t.you : nameOf(sx))

  const iAmOut = seat >= 0 && !!st.out[seat] && st.phase !== 'matchEnd'
  const isMyTurn = seat >= 0 && st.phase === 'turn' && st.turnSeat === seat && (!remote || st.playing[seat])
  const canAct = isMyTurn && st.step === 'act'
  const canDraw = isMyTurn && st.step === 'draw'

  const stagedFlat = staged.flat()
  const selFree = sel.filter((c) => !stagedFlat.includes(c))
  const stagedPts = staged.reduce((s2, g) => s2 + meldPoints(g), 0)
  const selValidMeld = selFree.length >= 3 && validMeld(selFree)
  const needOpen = seat >= 0 && !st.opened[seat]
  const canCommit = staged.length > 0 && (!needOpen || stagedPts >= OPEN_MIN)
  const oneSelected = selFree.length === 1 && staged.length === 0
  const coverIdx = useMemo(
    () => (oneSelected ? coverTargets(st.melds, selFree[0]) : []),
    [oneSelected, st.melds, selFree],
  )
  const allCovers = myHand.length > 0 && myHand.every((c) => isCover(st.melds, c))
  const canThrow = canAct && oneSelected && (!coverIdx.length || allCovers)
  const extIdx = useMemo(
    () => ((canAct && !needOpen && selFree.length) ? extendTargets(st.melds, selFree) : []),
    [canAct, needOpen, st.melds, selFree],
  )
  const suggestion = useMemo(() => {
    if (!canAct || staged.length || !myHand.length) return null
    const f = findMelds(myHand)
    if (!f.melds.length) return null
    if (needOpen && f.points < OPEN_MIN) return null
    return f.melds
  }, [canAct, staged.length, myHand, needOpen])

  const bump = useCallback((msg) => {
    setFlash(msg || '')
    setShake((k) => k + 1)
  }, [])
  useEffect(() => {
    if (!shake) return undefined
    const id = setTimeout(() => { setShake(0); setFlash('') }, 1900)
    return () => clearTimeout(id)
  }, [shake])

  const toggleCard = (c) => {
    if (!canAct) return
    if (stagedFlat.includes(c)) return
    setSel((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))
  }

  const stageMeld = () => {
    if (!selValidMeld) { bump(t.hintBad); return }
    play('click')
    setStaged((cur) => [...cur, selFree])
    setSel([])
  }

  const takeSuggestion = () => {
    if (!suggestion) return
    play('click')
    setStaged(suggestion)
    setSel([])
  }

  const unstage = () => { play('click'); setStaged([]); setSel([]) }

  const commitLay = () => {
    if (!staged.length) return
    if (!canCommit) { bump(t.shakeShort); return }
    submit({ t: 'lay', seat, melds: staged })
    setStaged([])
    setSel([])
  }

  const throwSel = () => {
    if (!canAct) return
    if (!oneSelected) { bump(t.shakeOne); return }
    if (!canThrow) { bump(t.coverBlock); return }
    submit({ t: 'discard', seat, card: selFree[0] })
    setSel([])
  }

  const tapMeld = (idx) => {
    if (!canAct || !selFree.length) return
    if (needOpen) { bump(t.shakeNoOpen); return }
    if (!extIdx.includes(idx)) { bump(t.shakeNoFit); return }
    submit({ t: 'extend', seat, meld: idx, cards: selFree })
    setSel([])
  }

  const showLobby = st.phase === 'waiting' && !vsBot
  const showRoundEnd = st.phase === 'roundEnd'
  const showMatchEnd = st.phase === 'matchEnd'
  const showCover = covered && !remote && !vsBot && st.phase === 'turn'
  const discardTop = st.discard.length ? st.discard[st.discard.length - 1] : null
  const liveSeats = [0, 1, 2, 3].filter((sx) => st.playing[sx] || bySeat[sx])

  // ---- the one hint line. It always states what is expected now, and when a
  // rule has removed an option it says which rule and points at the meld.
  const hint = (() => {
    if (flash) return { text: flash, tone: 'warn', icon: 'warn' }
    if (spectator) return { text: t.watching, tone: '', icon: 'eye' }
    if (st.phase !== 'turn') return { text: '', tone: '', icon: null }
    if (!isMyTurn) return { text: t.waitFor + ' ' + nameOf(st.turnSeat), tone: '', icon: null }
    if (canDraw) return { text: t.hintDraw, tone: 'go', icon: 'down' }
    if (staged.length) {
      return canCommit
        ? { text: t.hintReady, tone: 'go', icon: 'check' }
        : { text: t.hintNeedMore(fmt(OPEN_MIN - stagedPts, ar)), tone: 'warn', icon: 'warn' }
    }
    if (oneSelected && coverIdx.length) {
      return allCovers
        ? { text: t.coverAll, tone: 'go', icon: 'up' }
        : { text: t.coverBlock, tone: 'warn', icon: 'warn' }
    }
    if (oneSelected) return { text: t.hintThrow, tone: 'go', icon: 'up' }
    if (selFree.length >= 3 && !selValidMeld && !extIdx.length) return { text: t.hintBad, tone: 'warn', icon: 'warn' }
    if (selFree.length && extIdx.length) return { text: t.hintExtend, tone: 'go', icon: 'check' }
    if (selFree.length && needOpen && st.melds.length) return { text: t.hintNoOpen, tone: '', icon: null }
    if (selValidMeld) return { text: t.hintPickMeld, tone: 'go', icon: 'check' }
    return needOpen
      ? { text: t.hintOpenFirst, tone: '', icon: null }
      : { text: t.hintFree, tone: '', icon: null }
  })()

  // progress toward the 51 opening — a meter, never a number buried in a button
  const liveOpenPts = stagedPts + (selValidMeld ? meldPoints(selFree) : 0)
  const openProgress = needOpen ? clamp(0, liveOpenPts / OPEN_MIN, 1) : 1
  // the meter is on screen for the whole of my turn while I still owe the 51,
  // not only once something is staged — that is the number the round turns on
  const showMeter = canAct && needOpen

  const nextLevel = () => setLevelOpen((v) => !v)

  return (
    <div
      ref={rootRef}
      className={'cg-root hg-root' + (ar ? '' : ' is-ltr')}
      style={cssVars}
    >
      {/* ---------------------------------------------------------- top */}
      <div className="hg-top">
        <div className="hg-tools">
          <span className="hg-chip">{t.round} {fmt(Math.max(1, st.roundNo), ar)}</span>
          <span className="hg-chip">{(st.phase === 'waiting' ? mode : st.mode) === '14' ? t.mode14 : t.modeCount}</span>
          {vsBot ? (
            <button type="button" className="hg-chip is-gold cg-press" onClick={nextLevel} aria-expanded={levelOpen}>
              {t.lvl}: {t[level]}
              <Glyph name="caret" />
            </button>
          ) : null}
          <span className="hg-tools-sp" />
          <button type="button" className="hg-help cg-press" onClick={() => setRules(true)} aria-label={t.rules}>
            <Glyph name="help" />
          </button>
        </div>

        <div className="hg-players">
          {liveSeats.map((sx) => {
            const burn = st.burns[sx] || 0
            const f = clamp(0, burn / BURN_AT, 1)
            const hot = burn >= BURN_AT * 0.72 && !st.out[sx]
            const n = (st.hands[sx] || []).length
            return (
              <div
                key={sx}
                className={'hg-p'
                  + (st.phase === 'turn' && st.turnSeat === sx ? ' is-turn' : '')
                  + (sx === seat ? ' is-me' : '')
                  + (st.out[sx] ? ' is-out' : '')}
              >
                <span className="hg-p-row">
                  <span className="hg-av" style={{ '--sc': SEAT_COLOR[sx] }}>{avatarOf(nameOf(sx), sx, ar)}</span>
                  <span className="hg-p-name">{shortName(sx)}</span>
                  {st.phase === 'turn' && st.turnSeat === sx ? <Glyph name="caret" className="hg-turn-mark" /> : null}
                </span>
                <span className="hg-p-sub">
                  {st.out[sx] ? (
                    <span className="hg-tag">{t.burned}</span>
                  ) : (
                    <>
                      <span className="hg-stack" aria-hidden="true">
                        {[0, 1, 2].slice(0, Math.min(3, Math.max(1, Math.ceil(n / 5)))).map((k) => <i key={k} />)}
                      </span>
                      <b>{fmt(n, ar)}</b>
                      {st.opened[sx] ? <span className="hg-tag">{t.opened}</span> : null}
                    </>
                  )}
                </span>
                <span className={'hg-burn' + (hot ? ' is-hot' : '') + (st.out[sx] ? ' is-done' : '')}>
                  <span className="hg-burn-fill" style={{ '--f': f }} />
                  <b className="hg-burn-num hg-num">{fmt(burn, ar)}/{fmt(BURN_AT, ar)}</b>
                </span>
              </div>
            )
          })}
        </div>

        {levelOpen ? (
          <div className="hg-pop" role="dialog" aria-label={t.lvl}>
            {LEVELS.map((lv) => (
              <button
                key={lv}
                type="button"
                className={level === lv ? 'is-on' : ''}
                onClick={() => { setLevel(lv); setLevelOpen(false); play('click') }}
              >
                {t[lv]}
              </button>
            ))}
            <span className="hg-pop-note">{t.lvlNote[level]}</span>
          </div>
        ) : null}
      </div>

      {/* -------------------------------------------------------- table */}
      <div className="hg-board">
        <span className="hg-felt" aria-hidden="true" />
        <div className="hg-in">
          <div className={'hg-shelf hg-scroll' + (st.melds.length ? '' : ' is-empty')}>
            {st.melds.length ? st.melds.map((m, i) => {
              const target = extIdx.includes(i)
              const fits = coverIdx.includes(i) && !allCovers
              const nat = (m.cards || []).find((c) => !isJoker(c)) || m.cards?.[0]
              return (
                <button
                  key={i}
                  type="button"
                  className={'hg-meld' + (target ? ' is-target' : '') + (fits ? ' is-fits' : '')
                    + (freshMelds && freshMelds.has(i) ? ' is-fresh' : '')}
                  onClick={() => tapMeld(i)}
                  aria-label={(m.kind === 'run' ? t.run : t.set) + ' · ' + fmt(meldPoints(m.cards), ar)}
                >
                  <span className="hg-meld-cards">
                    {orderMeld(m.cards).map((c, k) => (
                      <CardFace key={c} code={c} w="var(--hg-tcard)" className={k ? 'is-lap' : ''} />
                    ))}
                  </span>
                  <span className="hg-meld-lbl">
                    <i className="hg-meld-owner" style={{ '--oc': Number.isInteger(m.by) ? SEAT_COLOR[m.by] : 'rgba(255,255,255,.3)' }} />
                    {m.kind === 'run'
                      ? <Suit s={suitOf(nat)} />
                      : <b>{label(nat)}</b>}
                    {m.kind === 'run' ? t.run : t.set} · {fmt(meldPoints(m.cards), ar)}
                  </span>
                </button>
              )
            }) : (
              <p className="hg-none">{t.noMelds}</p>
            )}
          </div>

          <div className="hg-piles">
            <button
              type="button"
              className={'hg-pile' + (canDraw && st.stock.length ? ' is-live' : '')}
              disabled={!canDraw || !st.stock.length}
              onClick={() => submit({ t: 'draw', seat, from: 'stock' })}
              aria-label={t.stock}
            >
              <span className="hg-slot">
                {st.stock.length > 6 ? <span className="hg-shim s1" /> : null}
                {st.stock.length > 2 ? <span className="hg-shim s2" /> : null}
                {st.stock.length
                  ? <CardBack w="var(--hg-pile)" />
                  : <span className="hg-empty">{t.empty}</span>}
                {canDraw && st.stock.length ? <span className="hg-ring" /> : null}
              </span>
              <span className="hg-pile-lbl">{t.stock} · {fmt(st.stock.length, ar)}</span>
            </button>

            <button
              type="button"
              className={'hg-pile' + (canDraw && discardTop ? ' is-live' : '')}
              disabled={!canDraw || !discardTop}
              onClick={() => submit({ t: 'draw', seat, from: 'discard' })}
              aria-label={t.thrown}
            >
              <span className="hg-slot">
                {st.discard.length > 4 ? <span className="hg-shim s1 is-thrown" /> : null}
                {st.discard.length > 1 ? <span className="hg-shim s2 is-thrown" /> : null}
                {discardTop
                  ? <CardFace key={discardTop} code={discardTop} w="var(--hg-pile)" className="is-thrown" />
                  : <span className="hg-empty">{t.empty}</span>}
                {canDraw && discardTop ? <span className="hg-ring" /> : null}
              </span>
              <span className="hg-pile-lbl">{t.thrown} · {fmt(st.discard.length, ar)}</span>
            </button>
          </div>
        </div>
      </div>

      {/* --------------------------------------------------------- hand */}
      {spectator || iAmOut ? (
        // Nobody without a live hand is shown a hand or a control that implies
        // they can act: a room viewer never had a seat, and a burned player
        // has lost theirs. Both get the reason and, if the match is still
        // running, the way out.
        <div className="hg-hand-wrap">
          <div className={'hg-watch' + (iAmOut ? ' is-out' : '')}>
            <Glyph name={iAmOut ? 'flame' : 'eye'} />
            <span>{iAmOut ? t.youBurned : t.watching}</span>
          </div>
          <div className="hg-watch-backs" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((k) => <CardBack key={k} w="calc(var(--hg-card) * 0.78)" />)}
          </div>
          <div className="hg-bar">
            {iAmOut ? (
              <button type="button" className="hg-btn is-ghost cg-press" onClick={() => onExit?.()}>{t.exit}</button>
            ) : null}
          </div>
          <div className="hg-hint">
            <span>{st.phase === 'turn' ? t.waitFor + ' ' + nameOf(st.turnSeat) : ''}</span>
          </div>
        </div>
      ) : (
        <div className="hg-hand-wrap">
          {(staged.length || showMeter) ? (
            <div className="hg-bench">
              {staged.map((g, i) => (
                <span key={i} className="hg-bench-meld">
                  {orderMeld(g).map((c, k) => (
                    <CardFace key={c} code={c} w="var(--hg-tcard)" className={k ? 'is-lap' : ''} />
                  ))}
                </span>
              ))}
              {staged.length ? <span className="hg-bench-pts">{fmt(stagedPts, ar)} {t.pts}</span> : null}
              {needOpen ? (
                <span className={'hg-meter' + (liveOpenPts >= OPEN_MIN ? ' is-ready' : '')}>
                  <span className="hg-meter-head">
                    <span>{t.openMeter}</span>
                    <b className="hg-num">{fmt(liveOpenPts, ar)} / {fmt(OPEN_MIN, ar)}</b>
                  </span>
                  <span className="hg-meter-bar">
                    <span className="hg-meter-fill" style={{ '--f': openProgress }} />
                  </span>
                </span>
              ) : null}
            </div>
          ) : null}

          <div className={'hg-hand' + (shake ? ' is-shake' : '')} key={'h' + shake}>
            {myHand.map((c, ci) => {
              const benched = stagedFlat.includes(c)
              const on = sel.includes(c) && !benched
              const cover = canAct && !allCovers && !staged.length && isCover(st.melds, c)
              return (
                <button
                  key={c}
                  type="button"
                  className={'hg-slotbtn'
                    + (on ? ' is-sel' : '')
                    + (benched ? ' is-benched' : '')
                    + (cover ? ' is-cover' : '')
                    + (fresh && fresh.has(c) ? ' is-new' : '')}
                  style={{ '--i': ci }}
                  disabled={!canAct || benched}
                  onClick={() => toggleCard(c)}
                  aria-pressed={on}
                  aria-label={cardWord(c, ar) + (isJoker(c) ? '' : ' ' + (ar ? SUIT_AR[suitOf(c)] : SUIT_EN[suitOf(c)])) + (cover ? ' — ' + (ar ? 'غطاء' : 'cover') : '')}
                >
                  <CardFace code={c} />
                </button>
              )
            })}
          </div>

          <div className="hg-bar">
            {canDraw ? (
              <>
                <button
                  type="button"
                  className="hg-btn is-gold cg-press"
                  disabled={!st.stock.length}
                  onClick={() => submit({ t: 'draw', seat, from: 'stock' })}
                >
                  <Glyph name="down" />
                  {t.stock} · {fmt(st.stock.length, ar)}
                </button>
                <button
                  type="button"
                  className={'hg-btn cg-press' + (discardTop ? ' is-primary' : ' is-ghost')}
                  disabled={!discardTop}
                  onClick={() => submit({ t: 'draw', seat, from: 'discard' })}
                >
                  <Glyph name="down" />
                  {t.thrown}{discardTop ? ' · ' + cardWord(discardTop, ar) : ''}
                </button>
              </>
            ) : null}
            {canAct && selValidMeld ? (
              <button type="button" className="hg-btn is-primary cg-press" onClick={stageMeld}>
                <Glyph name="down" />
                {t.addMeld} · {fmt(meldPoints(selFree), ar)}
              </button>
            ) : null}
            {canAct && !staged.length && !selFree.length && suggestion ? (
              <button type="button" className="hg-btn is-ghost cg-press" onClick={takeSuggestion}>
                <Glyph name="spark" />
                {t.suggest}
              </button>
            ) : null}
            {canAct && staged.length ? (
              <>
                <button
                  type="button"
                  className={'hg-btn cg-press' + (canCommit ? ' is-gold' : ' is-ghost') + (shake && !canCommit ? ' is-shake' : '')}
                  onClick={commitLay}
                >
                  <Glyph name="check" />
                  {t.lay}
                  <span className="hg-num">{fmt(stagedPts, ar)}{needOpen ? ' / ' + fmt(OPEN_MIN, ar) : ''}</span>
                </button>
                <button type="button" className="hg-btn is-ghost cg-press" onClick={unstage}>{t.undo}</button>
              </>
            ) : null}
            {canAct && extIdx.length === 1 && selFree.length && !staged.length ? (
              <button type="button" className="hg-btn is-primary cg-press" onClick={() => tapMeld(extIdx[0])}>
                <Glyph name="check" />
                {t.extend}
              </button>
            ) : null}
            {canAct && oneSelected ? (
              <button
                type="button"
                className={'hg-btn cg-press' + (canThrow ? ' is-primary' : ' is-ghost') + (shake && !canThrow ? ' is-shake' : '')}
                onClick={throwSel}
              >
                <Glyph name="up" />
                {t.throwCard}
              </button>
            ) : null}
            {/* The bar must NEVER be empty while cards are marked. Two marked
                cards that form no meld used to remove every button at once —
                the way back (re-tapping a card) existed but nothing on screen
                named it, and a tester sat in that dead end for 20 straight
                probes. One always-present escape hatch ends the trap. */}
            {canAct && selFree.length ? (
              <button type="button" className="hg-btn is-ghost cg-press" onClick={() => { play('click'); setSel([]) }}>
                <Glyph name="close" />
                {t.clearSel}
              </button>
            ) : null}
          </div>

          <div className={'hg-hint' + (hint.tone ? ' is-' + hint.tone : '')}>
            {hint.icon ? <Glyph name={hint.icon} /> : null}
            <span>{hint.text}</span>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------- overlays */}
      {showLobby ? (
        <div className="hg-veil">
          <div className="hg-card-panel">
            <strong className="hg-panel-title">{t.waitPlayers}</strong>
            <p className="hg-panel-sub">{t.need}</p>
            <div className="hg-seatgrid">
              {[0, 1, 2, 3].map((sx) => (
                <div key={sx} className={'hg-seatbox' + (bySeat[sx] ? ' is-filled' : '') + (sx === seat ? ' is-me' : '')}>
                  <span className="hg-av" style={{ '--sc': SEAT_COLOR[sx] }}>{avatarOf(bySeat[sx]?.name, sx, ar)}</span>
                  <span>{bySeat[sx]?.name || '—'}</span>
                </div>
              ))}
            </div>
            {host ? (
              <>
                <div className="hg-choice" role="radiogroup" aria-label={t.modePick}>
                  <button type="button" className={'hg-btn cg-press' + (mode === '14' ? ' is-gold' : ' is-ghost')} onClick={() => setMode('14')}>{t.mode14}</button>
                  <button type="button" className={'hg-btn cg-press' + (mode === 'count' ? ' is-gold' : ' is-ghost')} onClick={() => setMode('count')}>{t.modeCount}</button>
                </div>
                <div className="hg-choice" style={{ marginTop: 'calc(var(--hg-fs) * 0.6)' }}>
                  {filled >= 2 ? (
                    <button type="button" className="hg-btn is-gold cg-press" onClick={() => submit({ t: 'deal', seed: newSeed(), dealer: 0, mode })}>
                      {filled < 4 ? t.startNow : t.deal}
                    </button>
                  ) : (
                    <span className="cg-dots"><i /><i /><i /></span>
                  )}
                </div>
              </>
            ) : (
              <p className="hg-panel-sub">{t.hostStarts}</p>
            )}
          </div>
        </div>
      ) : null}

      {showCover ? (
        <div className="hg-veil" onClick={() => setCovered(false)}>
          <div className="hg-card-panel">
            <strong className="hg-panel-title">{ar ? 'سلّم الجهاز إلى' : 'Pass the phone to'} {nameOf(seat)}</strong>
            <p className="hg-panel-sub">{ar ? 'اضغط لعرض أوراقك' : 'Tap to see your cards'}</p>
          </div>
        </div>
      ) : null}

      {showRoundEnd || showMatchEnd ? (
        <div className="hg-veil">
          <div className="hg-card-panel">
            {(showMatchEnd && st.winnerSeat === seat) || st.lastRound?.winner === seat
              ? <span className="hg-burst" aria-hidden="true" />
              : null}
            <strong className="hg-panel-title">
              {showMatchEnd
                ? (st.winnerSeat === seat ? t.youWin : t.winnerIs + ': ' + nameOf(st.winnerSeat ?? 0))
                : st.lastRound?.void ? t.voidRound : t.roundOver}
            </strong>
            {st.lastRound && !st.lastRound.void && st.lastRound.winner != null ? (
              <p className="hg-panel-sub">{shortName(st.lastRound.winner)} — {t.wonRound}</p>
            ) : null}
            <div className="hg-rows">
              {/* `playing` is re-derived every deal as «seated and not burned»,
                  so filtering the standings by it silently DROPPED everyone who
                  burned out in an earlier round — including the player reading
                  the panel. The result screen lists the whole table. */}
              {liveSeats.map((sx) => {
                const pen = st.lastRound?.pens?.[sx] || 0
                const burnedNow = (st.lastRound?.burnedNow || []).includes(sx)
                return (
                  <div key={sx} className={'hg-row' + (st.lastRound?.winner === sx ? ' is-win' : '') + (st.out[sx] ? ' is-burned' : '')}>
                    <span className="hg-av" style={{ '--sc': SEAT_COLOR[sx] }}>{avatarOf(nameOf(sx), sx, ar)}</span>
                    <span className="hg-row-name">
                      {shortName(sx)}
                      {st.out[sx] ? ' · ' + t.burned : ''}
                      {burnedNow ? '' : ''}
                    </span>
                    <span className="hg-row-pen">{pen ? '+' + fmt(pen, ar) : '—'}</span>
                    <span className={'hg-burn hg-row-burn' + (st.burns[sx] >= BURN_AT * 0.72 && !st.out[sx] ? ' is-hot' : '') + (st.out[sx] ? ' is-done' : '')}>
                      <span className="hg-burn-fill" style={{ '--f': clamp(0, (st.burns[sx] || 0) / BURN_AT, 1) }} />
                    </span>
                    <span className="hg-row-tot hg-num">{fmt(st.burns[sx], ar)}/{fmt(BURN_AT, ar)}</span>
                  </div>
                )
              })}
            </div>
            <div className="hg-choice">
              {showMatchEnd ? (
                <button type="button" className="hg-btn is-primary cg-press" onClick={() => onExit?.()}>{t.exit}</button>
              ) : vsBot ? (
                <span className="cg-dots"><i /><i /><i /></span>
              ) : host ? (
                <button type="button" className="hg-btn is-gold cg-press" onClick={() => submit({ t: 'deal', seed: newSeed() })}>{t.next}</button>
              ) : (
                <span className="cg-dots"><i /><i /><i /></span>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {rules ? (
        <div className="hg-sheet">
          <div className="hg-sheet-head">
            <strong>{ar ? 'الحريق — الشرح' : 'Hareeg — how to play'}</strong>
            <button type="button" className="hg-help cg-press" onClick={() => setRules(false)} aria-label={t.close}>
              <Glyph name="close" />
            </button>
          </div>
          <div className="hg-sheet-body hg-scroll">{ar ? RULES_AR : RULES_EN}</div>
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
// One legible character for a seat badge. Machine seats are named «الكمبيوتر 2»
// / «Computer 2», so every one of them used to reduce to the same first letter
// and three identical badges told the player nothing — take the trailing
// number when the name carries one, otherwise the first letter of the name.
function avatarOf(name, seat, ar) {
  const s = String(name || '').trim()
  const m = s.match(/(\d+)\s*$/)
  if (m) return fmt(Number(m[1]), ar)
  return s.charAt(0) || fmt(seat + 1, ar)
}
function newSeed() {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1
}
