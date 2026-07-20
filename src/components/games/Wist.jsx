// «الوِست» — Wist: the Sudanese / Gulf trick-taking partnership game.
//
// ===========================================================================
// WHICH VARIANT THIS FILE IMPLEMENTS  (read this before changing any rule)
// ===========================================================================
// Wist genuinely varies from town to town — mostly in the auction floor, in
// whether a no-trump ("سن" / "صن") contract exists, and in how the defending
// side scores. Blending those variants produces a game nobody actually plays,
// so this file implements ONE coherent ruleset end to end: the widely played
// «وست 41» family, the same auction-and-contract skeleton as Tarneeb 41.
//
// THE RULESET IMPLEMENTED HERE
//   • 4 players, fixed partnerships, partners sit opposite: seats 0+2 vs 1+3.
//   • Seats are numbered in playing order; play runs counter-clockwise, which
//     on screen is: me (bottom) -> right -> partner (top) -> left.
//   • 52 cards, 13 each. Ace is high, then K Q J 10 9 8 7 6 5 4 3 2.
//   • AUCTION: opens with the player after the dealer and keeps going round.
//     A bid is a number of tricks from 7 to 13 and must beat the standing bid.
//     Passing puts you out of the auction for that hand. The auction closes
//     when only the high bidder is left in, or the moment someone bids 13.
//     If all four pass, the hand is washed out and redealt by the next dealer.
//   • The auction winner names the trump suit (الحكم) and leads the first trick.
//   • PLAY: follow suit if you can; otherwise play anything, trump included.
//     Highest trump wins the trick, else the highest card of the led suit.
//     The winner of a trick leads the next one.
//   • SCORING, per hand:
//       - bidding side made its contract  -> + the tricks it actually took
//       - bidding side fell short         -> - the number it bid
//       - the defending side always scores + one per trick it took
//     A bid of 13 is «كبوت»: it is worth 26 made, and -26 failed.
//   • MATCH: first side to 41 points. If both cross 41 on the same hand the
//     higher total wins; a dead tie plays one more hand.
//
// WHERE OTHER TABLES DIFFER (deliberately NOT implemented, listed for honesty)
//   • Many tables allow a no-trump contract that outranks a suit contract of
//     the same number. Not implemented — every contract here has a trump suit.
//   • Some tables let the defenders score only when the contract fails; here
//     they always score their tricks, which is the 41-point family's rule.
//   • Some tables force the dealer to bid the floor when the first three pass
//     instead of washing the hand out. Here it washes out and is redealt.
//   • Some tables set the auction floor at 8, or allow bids below 7 with a
//     partner confirmation. Here the floor is a flat 7.
//
// ===========================================================================
// ARCHITECTURE
// ===========================================================================
// The whole game lives in `reduce(state, move, room)`, a total pure function:
// an illegal or out-of-turn move returns the state untouched. The component
// never writes to Firestore; it calls `onMove(move)` and re-renders from the
// live `room` it is handed back. `reduce` runs inside the lead's runTransaction
// read-modify-write, so it re-validates on top of the freshest state and a
// tampered client cannot force an illegal card.
//
// Randomness: `reduce` must stay pure, so the shuffle is NEVER Math.random.
// Every deal move carries a `seed` and the deck is derived from it with a
// seeded PRNG, which keeps the deal reproducible and auditable.
//
// KNOWN LIMITATION (flagged for the lead, not fixable from inside this file):
// the four hands live in room.state, and the room document is readable by
// every player in it. The UI never shows another player's hand, but a player
// who inspects the network payload can. Truly hiding it needs per-seat
// subcollections plus security rules, which live outside this component.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { botMoveFor, botLabel, takeSoloIntent, BOT_DELAY_MS } from '../../lib/gameBots.js'
import '../../styles/cardgames.css'

// ---------------------------------------------------------------------------
// deck
// ---------------------------------------------------------------------------
const SUITS = ['S', 'H', 'D', 'C']
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
const RED = { H: true, D: true }
const MIN_BID = 7
const MAX_BID = 13
const TARGET = 41

const suitOf = (c) => String(c || '').charAt(1)
const rankOf = (c) => String(c || '').charAt(0)
const rankVal = (c) => RANKS.indexOf(rankOf(c))
const nx = (s) => (s + 1) % 4
const team = (s) => s % 2

const RANK_LABEL = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }
const label = (c) => RANK_LABEL[rankOf(c)] || rankOf(c)

const SUIT_AR = { S: 'بستوني', H: 'كبة', D: 'ديناري', C: 'سباتي' }
const SUIT_EN = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' }

// mulberry32 — small, fast, deterministic. Keeps `reduce` pure.
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

function freshDeck(seed) {
  const deck = []
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s)
  const rnd = prng(seed)
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1))
    const t = deck[i]
    deck[i] = deck[j]
    deck[j] = t
  }
  return deck
}

// display order only — grouped by suit, high to low inside a suit
function sortHand(cards) {
  const order = { S: 0, H: 1, C: 2, D: 3 }
  return [...cards].sort((a, b) => {
    const d = order[suitOf(a)] - order[suitOf(b)]
    return d !== 0 ? d : rankVal(b) - rankVal(a)
  })
}

function trickWinner(trick, trump) {
  const led = suitOf(trick[0].card)
  let best = trick[0]
  for (const p of trick) {
    const bs = suitOf(best.card)
    const ps = suitOf(p.card)
    if (ps === bs) { if (rankVal(p.card) > rankVal(best.card)) best = p }
    else if (ps === trump) best = p
    else if (bs !== trump && ps === led && bs !== led) best = p
  }
  return best.seat
}

// The narrow window the computer opponents are given onto this file. It is
// deliberately small: the trick logic and the card ordering, nothing that would
// let a bot read a hand it does not own. See src/lib/gameBots.js.
export const botHelpers = { suitOf, rankOf, rankVal, trickWinner, team, SUITS, MIN_BID, MAX_BID }

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
export function initialState() {
  return {
    v: 1,
    phase: 'waiting', // waiting | bid | trump | play | handEnd | matchEnd
    handNo: 0,
    dealer: 3,
    hands: [[], [], [], []],
    bids: [null, null, null, null], // number | 'pass' | null
    bidTurn: 0,
    highBid: null, // { seat, n }
    trump: null,
    turnSeat: 0,
    lead: 0,
    trick: [], // [{ seat, card }] in play order
    doneWinner: null, // trick is complete and on the table; cleared by the next lead
    tricksWon: [0, 0], // by team index
    scores: [0, 0],
    lastHand: null, // { bidSeat, bid, tricks:[a,b], delta:[a,b], made, washout }
    winnerTeam: null,
    target: TARGET,
  }
}

export const RULES_AR = [
  'الوِست — أربعة لاعبون، فريقان، الشريك يجلس مقابلك (المقاعد 0 و 2 ضد 1 و 3).',
  '',
  'التوزيع: ثلاث عشرة ورقة لكل لاعب. الآس أعلى ورقة ثم K ثم Q ثم J ثم 10 فما دون.',
  '',
  'المزايدة: تبدأ من اللاعب بعد الموزّع وتدور. المزايدة رقم من 7 إلى 13، ويجب أن تعلو على المزايدة القائمة. من يقول «باس» يخرج من مزايدة هذه اليد. تنتهي المزايدة حين لا يبقى غير صاحب أعلى مزايدة، أو فور أن يزايد أحدهم بـ 13. إذا مرّ الأربعة بلا مزايدة تُلغى اليد وتُوزَّع من جديد.',
  '',
  'الحكم: صاحب المزايدة الفائزة يختار نوع الحكم (الشدة) وهو من يلعب الورقة الأولى.',
  '',
  'اللعب: يجب اتّباع نوع الورقة الأولى إن كان لديك منه. إن لم يكن، فالعب ما شئت بما فيه الحكم. تفوز بالأكلة أعلى ورقة حكم، وإن لم يُلعب حكم ففوز أعلى ورقة من النوع المطلوب. الفائز بالأكلة يبدأ التي تليها.',
  '',
  'الحساب في كل يد:',
  '• إذا حقّق فريق المزايدة عدد أكلاته أو زاد: يضاف له عدد الأكلات التي أخذها فعلاً.',
  '• إذا نقص عن مزايدته: يُخصم منه عدد ما زايد به.',
  '• الفريق الآخر يضاف له أكلة بنقطة دائماً.',
  '• المزايدة بـ 13 اسمها «كبوت» وقيمتها 26 لها أو عليها.',
  '',
  'الفوز: أول فريق يبلغ 41 نقطة. إن تجاوز الفريقان 41 في اليد نفسها فالأعلى يفوز، وإن تعادلا تُلعب يد إضافية.',
  '',
  'ملاحظة عن النسخ الأخرى: هناك موائد تلعب «سن» (بلا حكم)، وموائد لا تحتسب أكلات الفريق المدافع إلا عند سقوط المزايدة، وموائد تُلزم الموزّع بالمزايدة بدل إلغاء اليد. هذه النسخة لا تطبّق أياً منها.',
].join('\n')

const RULES_EN = [
  'Wist — four players in two fixed partnerships, partners sitting opposite (seats 0+2 against 1+3).',
  '',
  'Deal: thirteen cards each. Ace is high, then K Q J 10 down to 2.',
  '',
  'Auction: opens after the dealer and goes round. A bid is a number of tricks from 7 to 13 and must beat the standing bid. Passing puts you out for the hand. The auction closes when only the high bidder remains, or immediately on a bid of 13. All four passing washes the hand out and it is redealt.',
  '',
  'Trump: the auction winner names trump and leads the first trick.',
  '',
  'Play: follow suit if you can, otherwise play anything including trump. Highest trump takes the trick, else the highest card of the led suit. The winner leads next.',
  '',
  'Scoring each hand: the bidding side scores the tricks it took if it made its bid, or loses the number it bid if it fell short. The defending side always scores one per trick. A bid of 13 (kaboot) is worth 26 either way.',
  '',
  'Match: first side to 41. Both crossing on the same hand, the higher total wins; a dead tie plays one more hand.',
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

function seatedCount(room) {
  const list = Array.isArray(room?.players) ? room.players : []
  return list.filter((p) => Number.isInteger(p?.seat) && p.seat >= 0 && p.seat < 4).length
}

function doDeal(s, move, room) {
  if (s.phase !== 'waiting' && s.phase !== 'handEnd') return keep(s)
  if (seatedCount(room) < 4) return keep(s)

  const deck = freshDeck(move?.seed)
  const hands = [0, 1, 2, 3].map((i) => sortHand(deck.slice(i * 13, i * 13 + 13)))
  const dealer = s.phase === 'waiting'
    ? (Number.isInteger(move?.dealer) ? ((move.dealer % 4) + 4) % 4 : 0)
    : nx(s.dealer)
  const opener = nx(dealer)

  return {
    state: {
      ...s,
      phase: 'bid',
      handNo: s.handNo + 1,
      dealer,
      hands,
      bids: [null, null, null, null],
      bidTurn: opener,
      highBid: null,
      trump: null,
      turnSeat: opener,
      lead: opener,
      trick: [],
      doneWinner: null,
      tricksWon: [0, 0],
      lastHand: null,
    },
    turn: turnOf(opener, move),
    status: 'playing',
  }
}

// next seat still in the auction, starting after `from`
function nextBidder(bids, from) {
  let k = from
  for (let i = 0; i < 4; i += 1) {
    k = nx(k)
    if (bids[k] !== 'pass') return k
  }
  return -1
}

function closeAuction(s, move) {
  // everybody passed -> washed out hand, redealt by the next dealer
  if (!s.highBid) {
    return {
      state: {
        ...s,
        phase: 'handEnd',
        lastHand: { washout: true, bidSeat: null, bid: 0, tricks: [0, 0], delta: [0, 0], made: false },
      },
      turn: turnOf(nx(s.dealer), move),
    }
  }
  return {
    state: { ...s, phase: 'trump', turnSeat: s.highBid.seat, bidTurn: s.highBid.seat },
    turn: turnOf(s.highBid.seat, move),
  }
}

function doBid(s, move) {
  if (s.phase !== 'bid') return keep(s)
  const seat = move.seat
  if (seat !== s.bidTurn || s.bids[seat] === 'pass') return keep(s)

  const bids = [...s.bids]
  let highBid = s.highBid

  if (move.t === 'pass') {
    bids[seat] = 'pass'
  } else {
    const n = Math.trunc(Number(move.n))
    const floor = highBid ? highBid.n + 1 : MIN_BID
    if (!Number.isFinite(n) || n < floor || n > MAX_BID) return keep(s)
    bids[seat] = n
    highBid = { seat, n }
  }

  const next = { ...s, bids, highBid }

  // a kaboot cannot be topped — the auction is over the instant it is called
  if (highBid && highBid.n >= MAX_BID) return closeAuction(next, move)

  const alive = [0, 1, 2, 3].filter((k) => bids[k] !== 'pass')
  if (alive.length === 0) return closeAuction(next, move)
  if (highBid && alive.length === 1 && alive[0] === highBid.seat) return closeAuction(next, move)

  const k = nextBidder(bids, seat)
  if (k < 0) return closeAuction(next, move)
  // a full lap with no bid at all and everyone still in cannot happen: a
  // player either bids or passes, so `bids` always converges.
  return { state: { ...next, bidTurn: k, turnSeat: k }, turn: turnOf(k, move) }
}

function doTrump(s, move) {
  if (s.phase !== 'trump' || !s.highBid) return keep(s)
  if (move.seat !== s.highBid.seat) return keep(s)
  if (!SUITS.includes(move.suit)) return keep(s)
  const lead = s.highBid.seat
  return {
    state: { ...s, phase: 'play', trump: move.suit, lead, turnSeat: lead, trick: [], doneWinner: null },
    turn: turnOf(lead, move),
  }
}

function scoreHand(s, move) {
  const bt = team(s.highBid.seat)
  const dt = 1 - bt
  const bid = s.highBid.n
  const kaboot = bid >= MAX_BID
  const took = s.tricksWon[bt]
  const made = took >= bid

  const delta = [0, 0]
  delta[bt] = made ? (kaboot ? 26 : took) : -(kaboot ? 26 : bid)
  delta[dt] = s.tricksWon[dt]

  const scores = [s.scores[0] + delta[0], s.scores[1] + delta[1]]

  let winnerTeam = null
  const a = scores[0]
  const b = scores[1]
  if (a >= TARGET || b >= TARGET) {
    if (a > b) winnerTeam = 0
    else if (b > a) winnerTeam = 1
    // a dead tie at or above the target leaves winnerTeam null: one more hand
  }

  const state = {
    ...s,
    phase: winnerTeam == null ? 'handEnd' : 'matchEnd',
    scores,
    winnerTeam,
    lastHand: {
      washout: false,
      bidSeat: s.highBid.seat,
      bid,
      kaboot,
      made,
      tricks: [s.tricksWon[0], s.tricksWon[1]],
      delta,
    },
  }

  // gameRoom folds `scores` into players[].score, so both partners carry the
  // partnership total and the room list reads right without knowing the game
  const seatScores = { 0: scores[0], 1: scores[1], 2: scores[0], 3: scores[1] }

  if (winnerTeam == null) return { state, turn: turnOf(nx(s.dealer), move), scores: seatScores }
  // winnerSeat carries the winning PARTNERSHIP: 0 means seats 0+2, 1 means 1+3.
  return {
    state,
    turn: turnOf(nx(s.dealer), move),
    scores: seatScores,
    winnerSeat: winnerTeam,
    status: 'ended',
  }
}

function doPlay(s, move) {
  if (s.phase !== 'play') return keep(s)
  const seat = move.seat
  if (seat !== s.turnSeat) return keep(s)

  const hand = s.hands[seat] || []
  const card = String(move.card || '')
  if (!hand.includes(card)) return keep(s)

  // a finished trick stays on the table until its winner leads again
  const opening = s.doneWinner != null || s.trick.length === 0
  const trick = opening ? [] : s.trick

  if (trick.length > 0) {
    const led = suitOf(trick[0].card)
    if (suitOf(card) !== led && hand.some((c) => suitOf(c) === led)) return keep(s)
  }

  const hands = s.hands.map((h, i) => (i === seat ? h.filter((c) => c !== card) : h))
  const nextTrick = [...trick, { seat, card }]

  if (nextTrick.length < 4) {
    const k = nx(seat)
    return {
      state: { ...s, hands, trick: nextTrick, doneWinner: null, turnSeat: k, lead: opening ? seat : s.lead },
      turn: turnOf(k, move),
    }
  }

  const w = trickWinner(nextTrick, s.trump)
  const tricksWon = [...s.tricksWon]
  tricksWon[team(w)] += 1

  const mid = {
    ...s,
    hands,
    trick: nextTrick,
    doneWinner: w,
    tricksWon,
    lead: w,
    turnSeat: w,
  }

  const handOver = hands.every((h) => h.length === 0)
  if (!handOver) return { state: mid, turn: turnOf(w, move) }
  return scoreHand(mid, move)
}

export function reduce(state, move, room) {
  const s = normalise(state)
  const m = move && typeof move === 'object' ? move : null
  if (!m) return keep(s)
  if (!Number.isInteger(m.seat) && m.t !== 'deal') return keep(s)
  if (Number.isInteger(m.seat) && (m.seat < 0 || m.seat > 3)) return keep(s)

  switch (m.t) {
    case 'deal': return doDeal(s, m, room)
    case 'bid':
    case 'pass': return doBid(s, m)
    case 'trump': return doTrump(s, m)
    case 'play': return doPlay(s, m)
    default: return keep(s)
  }
}

// ---------------------------------------------------------------------------
// drawing — suits and card faces are inline SVG, never glyphs, never emoji
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

// ---------------------------------------------------------------------------
// local fallback table — lets the game be played (and reviewed) on one device
// when no multiplayer room is supplied. It runs the SAME `reduce`, so the
// rules can never drift between the two modes.
// ---------------------------------------------------------------------------
const LOCAL_NAMES = ['اللاعب الأول', 'اللاعب الثاني', 'اللاعب الثالث', 'اللاعب الرابع']

// `bots` true builds the «العب ضد الكمبيوتر» table: the player keeps seat zero
// and the other three are machine seats, named as machines and flagged as such
// so nothing in the UI can present one as a person.
function makeLocalRoom(playerName, bots, lang) {
  return {
    roomId: 'local',
    gameId: 'wist',
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
export default function Wist({
  onScore,
  onExit,
  lang = 'ar',
  brand = '#0e7490',
  playerName = '',
  room = null,
  mySeat = null,
  onMove,
  isHost = false,
  // Wist is a fixed four-seat game, so a solo round always means three machine
  // seats; any positive value here selects it.
  soloBots = null,
}) {
  const ar = lang !== 'en'
  const remote = !!room
  // Latched on the first render: the lobby hand-off expires after a minute and
  // re-reading it every render would turn a bot table back into a hot-seat one.
  const [vsBot] = useState(() => !remote && (Number(soloBots) > 0 || !!takeSoloIntent('wist')))
  const [localRoom, setLocalRoom] = useState(() => makeLocalRoom(playerName, vsBot, lang))
  const [rules, setRules] = useState(false)
  const [covered, setCovered] = useState(false)
  const [pickSuit, setPickSuit] = useState(null)

  const table = remote ? room : localRoom
  const st = useMemo(() => normalise(table?.state), [table])

  // remote: my fixed seat. local hot-seat: whoever is on turn holds the phone.
  // against the computer: seat zero for the whole match, because the phone is
  // never handed over and the hand shown must stay the player's own.
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
    submit({ t: 'deal', seed: newSeed(), dealer: 0 })
  }, [remote, isHost, st.phase, filled, submit])

  // hot-seat privacy: hide the hand between turns on a shared device. Never
  // against the computer — there is no second person to hide it from, and a
  // "pass the phone" curtain every third of a second would be nonsense.
  const prevSeat = useRef(seat)
  useEffect(() => {
    if (remote || vsBot) return
    if (prevSeat.current !== seat) {
      prevSeat.current = seat
      if (st.phase === 'bid' || st.phase === 'play' || st.phase === 'trump') setCovered(true)
    }
  }, [seat, remote, vsBot, st.phase])

  // A solo table is complete the moment it is built, so the FIRST deal happens
  // by itself rather than asking the one player present to press «وزّع الورق»
  // against three machines. Later hands still wait for «اليد التالية» — the
  // result of a hand has to be readable before the next one wipes it.
  useEffect(() => {
    if (!vsBot || st.phase !== 'waiting') return undefined
    const id = setTimeout(() => submit({ t: 'deal', seat: 0, seed: newSeed(), dealer: st.dealer }), 260)
    return () => clearTimeout(id)
  }, [vsBot, st.phase, st.dealer, submit])

  // ---- machine seats ------------------------------------------------------
  // Each bot decides in src/lib/gameBots.js and every candidate it considers is
  // run through THIS file's `reduce` first, so it can only submit a card a
  // player in that seat could legally play. It is handed `botHelpers` — the
  // trick logic and card ordering — and reads `state.hands` at its OWN seat
  // only; the shared state carries all four hands but the bot never opens them.
  useEffect(() => {
    if (!vsBot) return undefined
    const acting = st.phase === 'bid' ? st.bidTurn : st.phase === 'trump' ? (st.highBid?.seat ?? -1) : st.turnSeat
    if (st.phase !== 'bid' && st.phase !== 'trump' && st.phase !== 'play') return undefined
    if (!Number.isInteger(acting) || acting <= 0) return undefined
    // A finished trick sits on the table until its winner leads again. When
    // that winner is a machine, hold the four cards up for long enough to see
    // who took it before they are swept away.
    const wait = st.doneWinner != null ? 1400 : BOT_DELAY_MS
    const id = setTimeout(() => {
      const mv = botMoveFor('wist', st, acting, { reduce, room: localRoom, helpers: botHelpers })
      if (mv) submit(mv)
    }, wait)
    return () => clearTimeout(id)
  }, [vsBot, st, localRoom, submit])

  // report an absolute score to the hub: my side's match total, floored at zero
  const myTeam = team(seat)
  useEffect(() => {
    onScore?.(Math.max(0, st.scores[myTeam] || 0))
  }, [onScore, st.scores, myTeam])

  const t = ar
    ? {
      us: 'فريقنا', them: 'الخصوم', hand: 'اليد', trump: 'الحكم', contract: 'المزايدة',
      rules: 'الشرح', close: 'إغلاق', deal: 'وزّع الورق', next: 'اليد التالية',
      waitPlayers: 'بانتظار اكتمال الطاولة', needFour: 'اللعبة لأربعة لاعبين — كل لاعب يجلس مقابل شريكه.',
      yourTurn: 'دورك', waitingFor: 'الدور على', pass: 'باس', chooseTrump: 'اختر الحكم',
      chooseBid: 'زايد بعدد الأكلات', follow: 'يجب اتّباع النوع المطلوب', tapCard: 'اختر ورقة',
      won: 'أخذ الأكلة', kaboot: 'كبوت', washout: 'لا مزايدة — تُعاد اليد',
      handOver: 'انتهت اليد', matchOver: 'انتهت المباراة', youWin: 'فزتم', youLose: 'فاز الخصوم',
      tricks: 'الأكلات', exit: 'خروج', cover: 'سلّم الجهاز إلى', reveal: 'اضغط لعرض أوراقك',
      bidOf: 'مزايدة', passed: 'باس', hostStarts: 'يبدأ مضيف الغرفة التوزيع.',
    }
    : {
      us: 'Us', them: 'Them', hand: 'Hand', trump: 'Trump', contract: 'Contract',
      rules: 'Rules', close: 'Close', deal: 'Deal', next: 'Next hand',
      waitPlayers: 'Waiting for the table', needFour: 'Four players, partners opposite.',
      yourTurn: 'Your turn', waitingFor: 'Turn:', pass: 'Pass', chooseTrump: 'Name trump',
      chooseBid: 'Bid a number of tricks', follow: 'You must follow suit', tapCard: 'Pick a card',
      won: 'takes the trick', kaboot: 'Kaboot', washout: 'All passed — redealing',
      handOver: 'Hand over', matchOver: 'Match over', youWin: 'You win', youLose: 'They win',
      tricks: 'Tricks', exit: 'Exit', cover: 'Pass the phone to', reveal: 'Tap to see your cards',
      bidOf: 'Bid', passed: 'Pass', hostStarts: 'The host deals.',
    }

  const nameOf = (sx) => bySeat[sx]?.name || (ar ? 'مقعد فارغ' : 'Empty seat')
  const rel = (sx) => (sx - seat + 4) % 4
  const POS = ['bottom', 'right', 'top', 'left']

  const myHand = st.hands[seat] || []
  const isMyTurn = st.turnSeat === seat
  const trickCards = st.trick || []
  const ledSuit = trickCards.length && st.doneWinner == null ? suitOf(trickCards[0].card) : null
  const mustFollow = ledSuit && myHand.some((c) => suitOf(c) === ledSuit)

  const playable = useCallback((c) => {
    if (st.phase !== 'play' || !isMyTurn) return false
    if (!ledSuit) return true
    if (!mustFollow) return true
    return suitOf(c) === ledSuit
  }, [st.phase, isMyTurn, ledSuit, mustFollow])

  const bidFloor = st.highBid ? st.highBid.n + 1 : MIN_BID
  const overlap = myHand.length > 10 ? -20 : myHand.length > 7 ? -14 : -8

  // Against the computer the table is already full, so the "waiting for the
  // table" overlay would flash for a quarter of a second and say nothing true.
  const showLobby = st.phase === 'waiting' && !vsBot
  const showHandEnd = st.phase === 'handEnd'
  const showMatchEnd = st.phase === 'matchEnd'
  const showCover = covered && !remote && !vsBot && !showLobby && !showHandEnd && !showMatchEnd

  const trumpChip = st.trump
    ? (
      <span className="cg-chip is-gold">
        <Suit s={st.trump} className="cg-suit-inline" />
        <span>{ar ? SUIT_AR[st.trump] : SUIT_EN[st.trump]}</span>
      </span>
    )
    : null

  return (
    <div className="cg-root" style={{ '--cg-brand': brand }}>
      <div className="cg-top">
        <span className="cg-score is-a">
          <span>{myTeam === 0 ? t.us : t.them}</span>
          <b>{fmt(st.scores[0], ar)}</b>
        </span>
        <span className="cg-score is-b">
          <span>{myTeam === 1 ? t.us : t.them}</span>
          <b>{fmt(st.scores[1], ar)}</b>
        </span>
        <span className="cg-top-sp" />
        {st.highBid ? (
          <span className="cg-chip">
            {t.contract} <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(st.highBid.n, ar)}</b>
          </span>
        ) : null}
        {trumpChip}
        <button type="button" className="cg-iconbtn cg-press" onClick={() => setRules(true)} aria-label={t.rules}>
          <span aria-hidden="true">?</span>
        </button>
      </div>

      <div className="cg-stage">
        <div className="cg-felt" />

        {[0, 1, 2, 3].map((sx) => {
          const r = rel(sx)
          const p = bySeat[sx]
          const on = st.turnSeat === sx && !showLobby && !showHandEnd && !showMatchEnd
          const bid = st.bids[sx]
          const isHigh = st.highBid && st.highBid.seat === sx
          return (
            <div
              key={sx}
              className={'cg-seat pos-' + POS[r] + (on ? ' is-turn' : '') + (p ? '' : ' is-off')}
              style={{ '--sc': ['var(--cg-s0)', 'var(--cg-s1)', 'var(--cg-s2)', 'var(--cg-s3)'][sx] }}
            >
              <span className="cg-av">{initialsOf(p?.name)}</span>
              <span className="cg-seat-col">
                <span className="cg-seat-name">{r === 0 ? (ar ? 'أنت' : 'You') : nameOf(sx)}</span>
                <span className="cg-seat-sub">
                  {team(sx) === myTeam ? (ar ? 'فريقك' : 'your side') : (ar ? 'الخصوم' : 'opponents')}
                </span>
              </span>
              {r !== 0 && st.phase === 'play' ? (
                <span className="cg-backs">
                  {Array.from({ length: Math.min(6, (st.hands[sx] || []).length) }).map((_, i) => (
                    <i key={i} className="cg-back" />
                  ))}
                </span>
              ) : null}
              {st.phase === 'bid' && bid != null ? (
                <span className={'wst-bidtag' + (isHigh ? ' is-high' : '')}>
                  {bid === 'pass' ? t.passed : t.bidOf + ' ' + fmt(bid, ar)}
                </span>
              ) : null}
              {st.phase === 'play' || st.phase === 'handEnd' ? (
                <span className="wst-bidtag">
                  {t.tricks} {fmt(st.tricksWon[team(sx)], ar)}
                </span>
              ) : null}
            </div>
          )
        })}

        {st.phase === 'play' || st.phase === 'trump' ? (
          <div className="wst-trick">
            {trickCards.map((p) => (
              <div
                key={p.seat + p.card}
                className={
                  'wst-played at-' + POS[rel(p.seat)] +
                  (st.doneWinner === p.seat ? ' is-win' : '')
                }
              >
                <CardFace code={p.card} />
              </div>
            ))}
          </div>
        ) : null}

        {st.phase === 'bid' && !st.highBid && trickCards.length === 0 ? (
          <div className="cg-note">{t.chooseBid}</div>
        ) : null}

        {st.doneWinner != null ? (
          <div className="cg-banner">
            {nameOf(st.doneWinner)} — {t.won}
          </div>
        ) : st.phase === 'play' && !isMyTurn ? (
          <div className="cg-banner">{t.waitingFor} {nameOf(st.turnSeat)}</div>
        ) : null}

        {showLobby ? (
          <div className="cg-lobby">
            <strong className="cg-lobby-title">{t.waitPlayers}</strong>
            <p className="cg-lobby-sub">{t.needFour}</p>
            <div className="cg-lobby-seats">
              {[0, 1, 2, 3].map((sx) => (
                <div
                  key={sx}
                  className={
                    'cg-lobby-seat' + (bySeat[sx] ? ' is-filled' : '') + (sx === seat ? ' is-me' : '')
                  }
                  style={{ '--sc': ['var(--cg-s0)', 'var(--cg-s1)', 'var(--cg-s2)', 'var(--cg-s3)'][sx] }}
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
                onClick={() => submit({ t: 'deal', seed: newSeed(), dealer: 0 })}
              >
                {t.deal}
              </button>
            ) : (
              <p className="cg-lobby-sub">{t.hostStarts}</p>
            )}
          </div>
        ) : null}

        {showCover ? (
          <div className="cg-modal" onClick={() => setCovered(false)}>
            <div className="cg-modal-card">
              <strong className="cg-modal-title">{t.cover} {nameOf(seat)}</strong>
              <p className="cg-modal-sub">{t.reveal}</p>
            </div>
          </div>
        ) : null}

        {showHandEnd || showMatchEnd ? (
          <div className="cg-modal">
            <div className="cg-modal-card">
              <strong className="cg-modal-title">
                {showMatchEnd
                  ? (st.winnerTeam === myTeam ? t.youWin : t.youLose)
                  : st.lastHand?.washout ? t.washout : t.handOver}
              </strong>
              {st.lastHand && !st.lastHand.washout ? (
                <p className="cg-modal-sub">
                  {nameOf(st.lastHand.bidSeat)} — {t.bidOf} {fmt(st.lastHand.bid, ar)}
                  {st.lastHand.kaboot ? ' (' + t.kaboot + ')' : ''}
                </p>
              ) : null}
              <div className="cg-modal-rows">
                {[0, 1].map((tm) => (
                  <div key={tm} className={'cg-row ' + (tm === 0 ? 'is-a' : 'is-b')}>
                    <span>{tm === myTeam ? t.us : t.them}</span>
                    <span className={
                      'cg-delta' + ((st.lastHand?.delta?.[tm] || 0) > 0 ? ' is-up' : (st.lastHand?.delta?.[tm] || 0) < 0 ? ' is-down' : '')
                    }>
                      {signed(st.lastHand?.delta?.[tm] || 0, ar)}
                    </span>
                    <b>{fmt(st.scores[tm], ar)}</b>
                  </div>
                ))}
              </div>
              <div className="cg-actions">
                {showMatchEnd ? (
                  <button type="button" className="cg-btn is-primary cg-press" onClick={() => onExit?.()}>
                    {t.exit}
                  </button>
                ) : host ? (
                  <button
                    type="button"
                    className="cg-btn is-gold cg-press"
                    onClick={() => submit({ t: 'deal', seed: newSeed() })}
                  >
                    {t.next}
                  </button>
                ) : (
                  <span className="cg-dots"><i /><i /><i /></span>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="cg-hand-wrap">
        <div className="cg-hand" style={{ '--cg-overlap': overlap + 'px' }}>
          {myHand.map((c) => {
            const can = playable(c)
            return (
              <button
                key={c}
                type="button"
                className={'cg-hand-slot' + (can ? ' is-up' : '') + (st.phase === 'play' && isMyTurn && !can ? ' is-dim' : '')}
                disabled={!can}
                onClick={() => submit({ t: 'play', seat, card: c })}
                aria-label={label(c) + ' ' + (ar ? SUIT_AR[suitOf(c)] : SUIT_EN[suitOf(c)])}
              >
                <CardFace code={c} />
              </button>
            )
          })}
        </div>

        {st.phase === 'bid' && st.bidTurn === seat && st.bids[seat] !== 'pass' ? (
          <div className="cg-actions">
            {Array.from({ length: MAX_BID - MIN_BID + 1 }).map((_, i) => {
              const n = MIN_BID + i
              return (
                <button
                  key={n}
                  type="button"
                  className={'wst-bidbtn cg-press' + (n === MAX_BID ? ' is-kaboot' : '')}
                  disabled={n < bidFloor}
                  onClick={() => submit({ t: 'bid', seat, n })}
                >
                  {fmt(n, ar)}
                </button>
              )
            })}
            <button
              type="button"
              className="cg-btn is-ghost is-sm cg-press"
              onClick={() => submit({ t: 'pass', seat })}
            >
              {t.pass}
            </button>
          </div>
        ) : null}

        {st.phase === 'trump' && st.highBid?.seat === seat ? (
          <div className="cg-actions">
            {SUITS.map((sx) => (
              <button
                key={sx}
                type="button"
                className={'wst-suitbtn cg-press' + (pickSuit === sx ? ' is-on' : '')}
                style={{ color: RED[sx] ? 'var(--cg-red)' : 'var(--cg-black)' }}
                onClick={() => { setPickSuit(sx); submit({ t: 'trump', seat, suit: sx }) }}
                aria-label={ar ? SUIT_AR[sx] : SUIT_EN[sx]}
              >
                <Suit s={sx} />
              </button>
            ))}
          </div>
        ) : null}

        <div className="cg-hand-hint">
          {st.phase === 'bid'
            ? (st.bidTurn === seat ? t.chooseBid : t.waitingFor + ' ' + nameOf(st.bidTurn))
            : st.phase === 'trump'
              ? (st.highBid?.seat === seat ? t.chooseTrump : t.waitingFor + ' ' + nameOf(st.highBid?.seat ?? 0))
              : st.phase === 'play'
                ? (isMyTurn ? (mustFollow ? t.follow : t.tapCard) : t.waitingFor + ' ' + nameOf(st.turnSeat))
                : ''}
        </div>
      </div>

      {rules ? (
        <div className="cg-over">
          <div className="cg-over-head">
            <strong>{ar ? 'الوِست — الشرح' : 'Wist — how to play'}</strong>
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
function signed(n, ar) {
  const v = Number(n) || 0
  if (v === 0) return '0'
  return (v > 0 ? '+' : '−') + fmt(Math.abs(v), ar)
}
function initialsOf(name) {
  const s = String(name || '').trim()
  if (!s) return '·'
  return s.slice(0, 1)
}
function newSeed() {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1
}
