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
// seeded PRNG, which keeps the deal reproducible and auditable. Time is the
// same story: the anti-stall `forceSkip` compares the ROOM's turn.startedAt
// against the stamp the submitting client already puts on every move (`at`),
// so nothing inside `reduce` ever reads the clock.
//
// `state.seen` is the public record of every card played this hand, in play
// order. It exists because it is information EVERY player at a real table has
// (they watched the cards fall) — it lets the hard bot count honestly instead
// of peeking at hands it does not own, and it lets the board tell the player
// which high cards are already gone. It is optional on rehydration: an older
// room document without it reads as an empty list rather than resetting.
//
// KNOWN LIMITATION (flagged for the lead, not fixable from inside this file):
// the four hands live in room.state, and the room document is readable by
// every player in it. The UI never shows another player's hand, but a player
// who inspects the network payload can. Truly hiding it needs per-seat
// subcollections plus security rules, which live outside this component.
//
// ===========================================================================
// PRESENTATION CONTRACT (the part the player actually judges)
// ===========================================================================
//   • The component renders ONLY the play area. The hub owns the title bar,
//     the live score, mute and close.
//   • Sizing is MEASURED, never guessed: one ResizeObserver on the root feeds
//     a single scale number `--wst-u`, and every card, pod and type size is a
//     multiple of it. A 360x640 phone and a 1920x1080 venue TV are the same
//     layout at two scales, with one aspect switch (`is-wide`) that moves the
//     hand tray over the felt so a landscape screen has no dead band.
//   • Card faces are inline SVG ink over a CSS-gradient paper body: crisp at
//     any scale, no image assets, no glyph fonts, no emoji.
//   • SVG children are positioned with the UNITLESS ATTRIBUTE form
//     (transform="translate(x y)"), never a CSS px transform — iOS Safari does
//     not resolve CSS px into SVG user space and the piece vanishes.
//   • Hit targets: the fanned cards overlap, so each card's tappable box is
//     exactly its painted box and the later sibling paints (and receives taps)
//     on top. Nothing invisible is ever a tap target.
//   • Every rule that removes an option says so on the board: an illegal card
//     is dimmed, tapping it shakes it and prints the reason in the hint line.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { botMoveFor, botLabel, takeSoloIntent, BOT_DELAY_MS } from '../../lib/gameBots.js'
import { play } from '../../lib/gameSounds.js'
import '../../styles/cardgames.css'
import '../../styles/wist.css'

// ---------------------------------------------------------------------------
// deck
// ---------------------------------------------------------------------------
const SUITS = ['S', 'H', 'D', 'C']
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
const RED = { H: true, D: true }
const MIN_BID = 7
const MAX_BID = 13
const TARGET = 41

// After this much silence the turn holder can be skipped by anybody at the
// table. Same window as Ludo and Jackaroo so a player learns it once.
const STALL_MS = 75000

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

// display order only — grouped by suit, high to low inside a suit. The two
// reds are kept apart so a fanned hand never puts hearts next to diamonds.
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
export const botHelpers = { suitOf, rankOf, rankVal, trickWinner, team, SUITS, RANKS, MIN_BID, MAX_BID }

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
    seen: [], // [{ s: seat, c: card }] every card played this hand, in play order
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
  'على الطاولة: يظهر «عدّاد العقد» طوال اللعب — كم يحتاج فريق المزايدة، وكم أخذ، وكم بقي من الأكلات. الورقة التي لا يجوز لعبها تظهر باهتة، وإن ضغطتها يخبرك الشريط بالسبب.',
  '',
  'إن توقّف لاعب عن اللعب أو انقطع اتصاله، يظهر لبقية الطاولة زر «تخطّي المتوقف» بعد دقيقة وربع، فتمضي اليد ولا تتجمّد الغرفة.',
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
  '',
  'On the table: the contract tracker is on screen the whole time — what the bidding side needs, what it has, and how many tricks are left. A card you may not play is dimmed; tap it and the hint line says why.',
  '',
  'If a player stops responding or drops, everyone else gets a «skip stalled player» button after seventy-five seconds, so a room can never freeze.',
].join('\n')

// ---------------------------------------------------------------------------
// reduce — the whole rulebook, pure and total
// ---------------------------------------------------------------------------
const keep = (state) => ({ state })

function normalise(state) {
  return state && state.v === 1 && Array.isArray(state.hands) ? state : initialState()
}

const seenOf = (s) => (Array.isArray(s.seen) ? s.seen : [])

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
      seen: [],
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
    state: { ...s, phase: 'play', trump: move.suit, lead, turnSeat: lead, trick: [], doneWinner: null, seen: [] },
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
  const seen = [...seenOf(s), { s: seat, c: card }]

  if (nextTrick.length < 4) {
    const k = nx(seat)
    return {
      state: {
        ...s,
        hands,
        seen,
        trick: nextTrick,
        doneWinner: null,
        turnSeat: k,
        lead: opening ? seat : s.lead,
      },
      turn: turnOf(k, move),
    }
  }

  const w = trickWinner(nextTrick, s.trump)
  const tricksWon = [...s.tricksWon]
  tricksWon[team(w)] += 1

  const mid = {
    ...s,
    hands,
    seen,
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

// ---- anti-stall ----------------------------------------------------------
// The same shape as Ludo's and Jackaroo's `forceSkip`: ANY seat may submit it,
// but it only bites when the seat holding the turn is disconnected or has sat
// on that turn past STALL_MS. The two differences here are deliberate:
//   • time comes from `move.at` (the stamp the submitting client already puts
//     on every move) measured against the room's own turn.startedAt, so this
//     reducer never reads a clock and stays pure;
//   • the skip does not invent a shortcut — it builds the move the stalled
//     seat SHOULD have made and runs it through the very same handler, so a
//     forced action can never produce a state a real player could not.
function longestSuit(hand) {
  let best = SUITS[0]
  let bestN = -1
  for (const s of SUITS) {
    const n = (hand || []).filter((c) => suitOf(c) === s).length
    if (n > bestN) { bestN = n; best = s }
  }
  return best
}

// the card a stalled seat is forced to play: lowest legal, ties by suit order
function forcedCard(s, seat) {
  const hand = s.hands[seat] || []
  if (!hand.length) return null
  const opening = s.doneWinner != null || s.trick.length === 0
  const trick = opening ? [] : s.trick
  let pool = hand
  if (trick.length) {
    const led = suitOf(trick[0].card)
    const follow = hand.filter((c) => suitOf(c) === led)
    if (follow.length) pool = follow
  }
  return [...pool].sort((a, b) => (
    rankVal(a) - rankVal(b) || SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b))
  ))[0]
}

function doForceSkip(s, move, room) {
  const phase = s.phase
  if (phase !== 'bid' && phase !== 'trump' && phase !== 'play') return keep(s)
  const holderSeat = phase === 'bid'
    ? s.bidTurn
    : phase === 'trump'
      ? (s.highBid ? s.highBid.seat : -1)
      : s.turnSeat
  if (!Number.isInteger(holderSeat) || holderSeat < 0 || holderSeat > 3) return keep(s)

  const list = Array.isArray(room?.players) ? room.players : []
  const holder = list.find((p) => Number(p?.seat) === holderSeat)
  const startedAt = Number(room?.turn?.startedAt) || 0
  const at = Number(move?.at) || 0
  const stale = startedAt > 0 && at > 0 && (at - startedAt) > STALL_MS
  const gone = !holder || holder.connected === false
  if (!stale && !gone) return keep(s)

  if (phase === 'bid') return doBid(s, { t: 'pass', seat: holderSeat, at })
  if (phase === 'trump') {
    return doTrump(s, { t: 'trump', seat: holderSeat, suit: longestSuit(s.hands[holderSeat]), at })
  }
  const card = forcedCard(s, holderSeat)
  if (!card) return keep(s)
  return doPlay(s, { t: 'play', seat: holderSeat, card, at })
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
    case 'forceSkip': return doForceSkip(s, m, room)
    default: return keep(s)
  }
}

// ---------------------------------------------------------------------------
// drawing — suits, card faces and court art are inline SVG. No image assets,
// no glyph fonts, no emoji (hard repo rule). Everything below is drawn in a
// 100x140 user-space box so it stays crisp from a 33px phone card to a 90px
// card across a venue TV.
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

// Pip layouts — the standard arrangement every deck uses. [x, y, flipped]
// Each pip is placed with the UNITLESS SVG ATTRIBUTE transform, never a CSS px
// transform: iOS Safari does not resolve CSS px into SVG user space, which is
// how a piece ends up in the wrong place or invisible on an iPhone.
const PIPS = {
  '2': [[50, 30, 0], [50, 110, 1]],
  '3': [[50, 30, 0], [50, 70, 0], [50, 110, 1]],
  '4': [[36, 30, 0], [64, 30, 0], [36, 110, 1], [64, 110, 1]],
  '5': [[36, 30, 0], [64, 30, 0], [50, 70, 0], [36, 110, 1], [64, 110, 1]],
  '6': [[36, 30, 0], [64, 30, 0], [36, 70, 0], [64, 70, 0], [36, 110, 1], [64, 110, 1]],
  '7': [[36, 30, 0], [64, 30, 0], [50, 50, 0], [36, 70, 0], [64, 70, 0], [36, 110, 1], [64, 110, 1]],
  '8': [[36, 30, 0], [64, 30, 0], [50, 50, 0], [36, 70, 0], [64, 70, 0], [50, 90, 1], [36, 110, 1], [64, 110, 1]],
  '9': [[36, 28, 0], [64, 28, 0], [36, 55, 0], [64, 55, 0], [50, 70, 0], [36, 85, 1], [64, 85, 1], [36, 112, 1], [64, 112, 1]],
  T: [[36, 28, 0], [64, 28, 0], [50, 42, 0], [36, 55, 0], [64, 55, 0], [36, 85, 1], [64, 85, 1], [50, 98, 1], [36, 112, 1], [64, 112, 1]],
}

// Original court art: an arabesque panel with a mirrored half figure. No
// reproduction of any published deck — a crown / veil / cap crest over a robed
// shoulder line, rotated 180 about the card centre for the lower half.
function CourtHalf({ r, suit }) {
  const crest = r === 'K'
    ? 'M40 35 L41.5 25.5 L46 30.5 L50 23 L54 30.5 L58.5 25.5 L60 35 Z'
    : r === 'Q'
      ? 'M41 35 Q41 23.5 50 23.5 Q59 23.5 59 35 Z'
      : 'M41 35 L44.5 26.5 L55.5 26.5 L59 35 Z'
  return (
    <g>
      <path className="wst-ink-fill" d="M33 68 L33 61 Q33 52.5 41.5 50.5 L58.5 50.5 Q67 52.5 67 61 L67 68 Z" opacity="0.9" />
      <path className="wst-ink-line" d="M50 50.5 L50 68" strokeWidth="1.1" />
      <circle className="wst-ink-fill" cx="50" cy="42.5" r="7.2" />
      <path className="wst-ink-fill" d={crest} />
      {r === 'Q' ? <circle className="wst-ink-hole" cx="50" cy="28.5" r="1.9" /> : null}
      {r === 'J' ? <path className="wst-ink-line" d="M55.5 26.5 L63 19.5" strokeWidth="1.6" /> : null}
      <g transform="translate(44 55) scale(0.5)">
        <path className="wst-ink-hole" d={SUIT_PATH[suit] || SUIT_PATH.S} />
      </g>
    </g>
  )
}

// The ink layer of one card. The paper, its rounded edge, the highlight and the
// contact shadow are CSS on the wrapper — that keeps them resolution free.
function CardInk({ code }) {
  const s = suitOf(code)
  const r = rankOf(code)
  const txt = label(code)
  const court = r === 'J' || r === 'Q' || r === 'K'
  const corner = (
    <g>
      <text className="wst-ink-rank" x="16" y={txt === '10' ? 30 : 31} fontSize={txt === '10' ? 25 : 29}>{txt}</text>
      <g transform="translate(8.5 35) scale(0.63)">
        <path className="wst-ink-fill" d={SUIT_PATH[s] || SUIT_PATH.S} />
      </g>
    </g>
  )
  return (
    <svg className="wst-ink" viewBox="0 0 100 140" focusable="false" aria-hidden="true">
      {corner}
      <g transform="rotate(180 50 70)">{corner}</g>
      {court ? (
        <g>
          <rect className="wst-ink-panel" x="29" y="19" width="42" height="102" rx="5" />
          <CourtHalf r={r} suit={s} />
          <g transform="rotate(180 50 70)"><CourtHalf r={r} suit={s} /></g>
        </g>
      ) : r === 'A' ? (
        <g transform="translate(29 49) scale(1.75)">
          <path className="wst-ink-fill" d={SUIT_PATH[s] || SUIT_PATH.S} />
        </g>
      ) : (
        (PIPS[r] || []).map(([x, y, f], i) => {
          const k = 20 / 24
          return (
            <g key={i} transform={`translate(${x - 10} ${y - 10}) scale(${k})${f ? ' rotate(180 12 12)' : ''}`}>
              <path className="wst-ink-fill" d={SUIT_PATH[s] || SUIT_PATH.S} />
            </g>
          )
        })
      )}
    </svg>
  )
}

// A full card: CSS paper + SVG ink. `w` is the width in px; the 5:7 ratio and
// every inner metric follow from it, so one number scales the whole object.
function CardFace({ code, w, className = '' }) {
  const s = suitOf(code)
  return (
    <span
      className={'wst-card' + (RED[s] ? ' is-red' : '') + (className ? ' ' + className : '')}
      style={{ width: w + 'px' }}
    >
      <span className="wst-card-paper" />
      <CardInk code={code} />
      <span className="wst-card-gloss" />
    </span>
  )
}

// The back of a card — an original lattice, drawn once per element with no
// <defs>/<pattern> so there are no duplicate ids anywhere on the page.
function CardBack({ w, className = '' }) {
  return (
    <span className={'wst-card is-back' + (className ? ' ' + className : '')} style={{ width: w + 'px' }}>
      <span className="wst-back-paper" />
      <svg className="wst-ink" viewBox="0 0 100 140" focusable="false" aria-hidden="true">
        <rect className="wst-back-frame" x="7" y="7" width="86" height="126" rx="6" />
        <path className="wst-back-line" d="M50 24 L74 70 L50 116 L26 70 Z" />
        <path className="wst-back-line" d="M50 40 L64 70 L50 100 L36 70 Z" />
        <path className="wst-back-line" d="M20 46 L80 46 M20 94 L80 94" />
      </svg>
      <span className="wst-card-gloss" />
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
// layout maths — measured, never guessed
// ---------------------------------------------------------------------------
const clamp = (lo, v, hi) => Math.max(lo, Math.min(hi, v))

const LEVEL_KEY = 'ml.games.wist.level'
const LEVELS = ['easy', 'normal', 'hard']

function readLevel() {
  try {
    const v = localStorage.getItem(LEVEL_KEY)
    return LEVELS.includes(v) ? v : 'normal'
  } catch (_) { return 'normal' }
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
  const [level, setLevel] = useState(readLevel)
  const [sel, setSel] = useState(null)
  const [shake, setShake] = useState(null) // { c, n } — retriggers the shake keyframe
  const [reason, setReason] = useState('')
  const [sweep, setSweep] = useState(false)
  const [tick, setTick] = useState(0)
  const [nowMs, setNowMs] = useState(0)

  const rootRef = useRef(null)
  const [box, setBox] = useState({ w: 390, h: 760 })

  // ---- the one measurement everything else is derived from ----------------
  useEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const read = () => {
      const r = el.getBoundingClientRect()
      const w = Math.round(r.width)
      const h = Math.round(r.height)
      if (w > 40 && h > 40) setBox((p) => (p.w === w && p.h === h ? p : { w, h }))
    }
    read()
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', read)
      return () => window.removeEventListener('resize', read)
    }
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [reduceMotion, setReduceMotion] = useState(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
  })
  useEffect(() => {
    let mq = null
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)') } catch (_) { mq = null }
    if (!mq) return undefined
    const on = () => setReduceMotion(!!mq.matches)
    if (mq.addEventListener) mq.addEventListener('change', on)
    else if (mq.addListener) mq.addListener(on)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', on)
      else if (mq.removeListener) mq.removeListener(on)
    }
  }, [])

  // A landscape screen (a venue TV, a tablet turned sideways) gets the hand
  // tray floated over the near rail instead of a band under the table, so the
  // felt owns the whole area and there is no empty strip left or right.
  const wide = box.w / Math.max(1, box.h) >= 1.15
  // ONE scale number. 390x844 phone -> ~1. 360x640 -> ~0.75. 1920x1080 TV ->
  // ~1.9, which is what keeps type legible from across a room.
  const u = clamp(0.62, Math.min(box.w / 392, box.h / (wide ? 480 : 830)), 2.35)
  // The card size is measured SEPARATELY from the type scale. Thirteen cards
  // fan by overlapping, so a bigger card does not need a wider screen — it
  // needs the height for the tray. Tying it to `u` alone left a tall phone with
  // a small hand and a large empty felt; this fills both.
  //   • width term  keeps the fan inside the tray (a 13-card fan is 4.6 cards
  //     wide at the tightest overlap that still shows every corner index)
  //   • height term keeps the tray from eating the table
  const cardW = Math.round(clamp(28, Math.min(box.w * 0.155, box.h * 0.105), wide ? 120 : 100))

  const table = remote ? room : localRoom
  const st = useMemo(() => normalise(table?.state), [table])

  // remote: my fixed seat. local hot-seat: whoever is on turn holds the phone.
  // against the computer: seat zero for the whole match, because the phone is
  // never handed over and the hand shown must stay the player's own.
  const seat = remote
    ? (Number.isInteger(mySeat) ? mySeat : 0)
    : (vsBot ? 0 : (Number.isInteger(st.turnSeat) ? st.turnSeat : 0))
  // A remote viewer holding NO seat (a spectator, or a snapshot that arrived
  // before the join settled) falls back to seat 0 above only so the table can
  // be rotated — they are never handed that seat's cards or its controls.
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
  // trick logic and card ordering — plus the chosen level, and reads
  // `state.hands` at its OWN seat only; the shared state carries all four hands
  // but the bot never opens them. Everything else it knows comes from
  // `state.seen`, which is the public record of the cards already on the table.
  useEffect(() => {
    if (!vsBot) return undefined
    const acting = st.phase === 'bid' ? st.bidTurn : st.phase === 'trump' ? (st.highBid?.seat ?? -1) : st.turnSeat
    if (st.phase !== 'bid' && st.phase !== 'trump' && st.phase !== 'play') return undefined
    if (!Number.isInteger(acting) || acting <= 0) return undefined
    // A finished trick sits on the table until its winner leads again. When
    // that winner is a machine, hold the four cards up for long enough to see
    // who took it before they are swept away.
    const wait = st.doneWinner != null ? 1500 : BOT_DELAY_MS
    const id = setTimeout(() => {
      const mv = botMoveFor('wist', st, acting, { reduce, room: localRoom, helpers: botHelpers, level })
      if (mv) submit(mv)
    }, wait)
    return () => clearTimeout(id)
  }, [vsBot, st, localRoom, submit, level])

  // report an absolute score to the hub: my side's match total, floored at zero
  const myTeam = team(seat)

  // ---- sound feedback. Display-only: one effect watching existing state
  // fields, ref-guarded so nothing fires on mount or on a room rehydration —
  // only on real CHANGES after the first snapshot. Never touches the reducer.
  const sndRef = useRef(null)
  useEffect(() => {
    const cur = {
      handNo: st.handNo,
      trickN: st.trick.length,
      phase: st.phase,
      turnSeat: st.turnSeat,
      bidN: st.bids.filter((b) => b != null).length,
      done: st.doneWinner,
    }
    const prev = sndRef.current
    sndRef.current = cur
    if (!prev) return
    if (cur.handNo !== prev.handNo) { play('deal'); return }
    if (cur.phase !== prev.phase) {
      if (cur.phase === 'matchEnd') { play(st.winnerTeam === myTeam ? 'win' : 'lose'); return }
      if (cur.phase === 'handEnd') {
        const lh = st.lastHand
        if (lh && !lh.washout) play(lh.delta[myTeam] >= lh.delta[1 - myTeam] ? 'win' : 'lose', { gain: 0.5 })
        return
      }
      // the auction closed and trump has just been named
      if (cur.phase === 'play' && prev.phase === 'trump') play('card', { gain: 0.75 })
    }
    if (cur.phase === 'bid' && cur.bidN !== prev.bidN) play('click', { gain: 0.6 })
    if (cur.done != null && prev.done == null) {
      play(team(cur.done) === myTeam ? 'capture' : 'move', { gain: 0.6 })
    } else if (cur.trickN !== prev.trickN && cur.trickN > 0) {
      play('card')
    }
    // hot-seat (no bots, same phone) would chime on every handover — noise
    if (cur.turnSeat !== prev.turnSeat && cur.turnSeat === seat && cur.phase === 'play' && (remote || vsBot)) {
      play('turn', { gain: 0.8 })
    }
  }, [st, seat, myTeam, remote, vsBot])

  useEffect(() => {
    onScore?.(Math.max(0, st.scores[myTeam] || 0))
  }, [onScore, st.scores, myTeam])

  // ---- the trick sweep: hold the finished trick up, then collect it toward
  // whoever won it. Under reduced motion it is a jump cut, not a slide.
  useEffect(() => {
    if (st.doneWinner == null) { setSweep(false); return undefined }
    if (reduceMotion) { setSweep(false); return undefined }
    const id = setTimeout(() => setSweep(true), 900)
    return () => clearTimeout(id)
  }, [st.doneWinner, st.handNo, st.tricksWon, reduceMotion])

  // clear a stale selection whenever the hand or the turn moves on
  useEffect(() => { setSel(null); setReason('') }, [st.turnSeat, st.phase, st.handNo])

  // ---- clocks. Two, both display-only and both remote-only: a one-second
  // pulse for the countdown ring, and a slow one so the anti-stall affordance
  // can appear while a dead turn ages.
  const deadlineAt = remote ? Number(table?.turn?.deadlineAt) || 0 : 0
  const livePhase = st.phase === 'bid' || st.phase === 'trump' || st.phase === 'play'
  useEffect(() => {
    if (!deadlineAt || !livePhase) return undefined
    setNowMs(Date.now())
    const iv = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [deadlineAt, livePhase])
  useEffect(() => {
    if (!remote || !livePhase) return undefined
    const iv = setInterval(() => setTick((n) => (n + 1) % 100000), 3000)
    return () => clearInterval(iv)
  }, [remote, livePhase])

  const t = ar
    ? {
      us: 'فريقنا', them: 'الخصوم', trump: 'الحكم',
      rules: 'الشرح', close: 'إغلاق', deal: 'وزّع الورق', next: 'اليد التالية',
      waitPlayers: 'بانتظار اكتمال الطاولة', needFour: 'اللعبة لأربعة لاعبين — كل لاعب يجلس مقابل شريكه.',
      pass: 'باس', chooseTrump: 'اختر الحكم — الشدة التي تقطع بها',
      chooseBid: 'زايد بعدد الأكلات أو قل باس', floorIs: 'أقل مزايدة الآن',
      follow: 'اتبع النوع المطلوب', tapCard: 'اختر ورقة والعبها', playIt: 'العب',
      cancel: 'تراجع', tapTwice: 'اضغط الورقة مرة أخرى للعبها',
      won: 'أخذ الأكلة', kaboot: 'كبوت', washout: 'لا مزايدة — تُعاد اليد',
      handOver: 'انتهت اليد', matchOver: 'انتهت المباراة', youWin: 'فزتم', youLose: 'فاز الخصوم',
      tricks: 'أكلات', exit: 'خروج', cover: 'سلّم الجهاز إلى', reveal: 'اضغط لعرض أوراقك',
      bidOf: 'زايد', passed: 'باس', hostStarts: 'يبدأ مضيف الغرفة التوزيع.',
      auction: 'المزايدة', standing: 'المزايدة القائمة', kabootNote: 'المزايدة بـ 13 اسمها «كبوت» — قيمتها 26 نقطة لك أو عليك.',
      left: 'بقي', usBid: 'العقد لفريقك', themBid: 'العقد للخصوم',
      yourTurn: 'دورك', turnOf: 'الدور على', turnNow: 'الدور',
      waitingBid: 'المزايدة على', waitingTrump: 'يختار الحكم:', partner: 'شريكك', rival: 'خصم', you: 'أنت',
      skip: 'تخطّي المتوقف', offline: 'منقطع',
      stallNote: 'اللاعب متوقف أو انقطع اتصاله — يستطيع أي لاعب تخطّيه ليمضي الدور.',
      watcher: 'متفرّج', watchNote: 'أنت تتابع الطاولة فقط — أوراق اللاعبين مخفية.',
      teamA: 'الفريق أ', teamB: 'الفريق ب', contractOf: 'العقد لـ',
      cantFollow: (s) => 'لا يمكن لعبها — عندك ' + s + ' ويجب اتّباع النوع المطلوب.',
      notYourTurn: 'ليس دورك بعد — هذه معاينة فقط.',
      levelLbl: 'الكمبيوتر', easy: 'سهل', normal: 'عادي', hard: 'صعب',
      levelTip: 'اضغط لتغيير مستوى الكمبيوتر',
      trickNo: 'الأكلة', ofThirteen: 'من 13', namingTrump: 'يختار الحكم الآن',
      dealer: 'الموزّع', led: 'المطلوب',
    }
    : {
      us: 'Us', them: 'Them', trump: 'Trump',
      rules: 'Rules', close: 'Close', deal: 'Deal', next: 'Next hand',
      waitPlayers: 'Waiting for the table', needFour: 'Four players, partners opposite.',
      pass: 'Pass', chooseTrump: 'Name trump — the suit that cuts',
      chooseBid: 'Bid a number of tricks, or pass', floorIs: 'Lowest bid now',
      follow: 'Follow the led suit', tapCard: 'Pick a card, then play it', playIt: 'Play',
      cancel: 'Undo', tapTwice: 'Tap the card again to play it',
      won: 'takes the trick', kaboot: 'Kaboot', washout: 'All passed — redealing',
      handOver: 'Hand over', matchOver: 'Match over', youWin: 'You win', youLose: 'They win',
      tricks: 'tricks', exit: 'Exit', cover: 'Pass the phone to', reveal: 'Tap to see your cards',
      bidOf: 'Bid', passed: 'Pass', hostStarts: 'The host deals.',
      auction: 'Auction', standing: 'Standing bid', kabootNote: 'A bid of 13 is a kaboot — worth 26 points for you or against you.',
      left: 'left', usBid: 'Your side holds the contract', themBid: 'They hold the contract',
      yourTurn: 'Your turn', turnOf: 'Turn:', turnNow: 'To play',
      waitingBid: 'Bidding:', waitingTrump: 'Naming trump:', partner: 'partner', rival: 'opponent', you: 'You',
      skip: 'Skip stalled player', offline: 'offline',
      stallNote: 'This player has stalled or dropped — anyone at the table can skip them so the hand moves on.',
      watcher: 'Watching', watchNote: 'You are watching this table — every hand stays hidden.',
      teamA: 'Side A', teamB: 'Side B', contractOf: 'Contract:',
      cantFollow: (s) => 'Not legal — you still hold ' + s + ' and must follow suit.',
      notYourTurn: 'Not your turn yet — this is only a preview.',
      levelLbl: 'Computer', easy: 'Easy', normal: 'Normal', hard: 'Hard',
      levelTip: 'Tap to change the computer level',
      trickNo: 'Trick', ofThirteen: 'of 13', namingTrump: 'is naming trump',
      dealer: 'Dealer', led: 'Led',
    }

  const nameOf = (sx) => bySeat[sx]?.name || (ar ? 'مقعد فارغ' : 'Empty seat')
  const rel = (sx) => (sx - seat + 4) % 4
  const POS = ['bottom', 'right', 'top', 'left']
  // "Us / Them" only means something to a player who holds a seat. A spectator
  // is on neither side, so every label switches to the neutral side names.
  const teamLabel = (tm) => (seated ? (tm === myTeam ? t.us : t.them) : (tm === 0 ? t.teamA : t.teamB))

  const myHand = seated ? (st.hands[seat] || []) : []
  const isMyTurn = seated && st.turnSeat === seat
  const trickCards = st.trick || []
  const ledSuit = trickCards.length && st.doneWinner == null ? suitOf(trickCards[0].card) : null
  const mustFollow = !!ledSuit && myHand.some((c) => suitOf(c) === ledSuit)

  const playable = useCallback((c) => {
    if (st.phase !== 'play' || !isMyTurn) return false
    if (!ledSuit) return true
    if (!mustFollow) return true
    return suitOf(c) === ledSuit
  }, [st.phase, isMyTurn, ledSuit, mustFollow])

  const bidFloor = st.highBid ? st.highBid.n + 1 : MIN_BID
  const myBidTurn = seated && st.phase === 'bid' && st.bidTurn === seat && st.bids[seat] !== 'pass'
  const myTrumpTurn = seated && st.phase === 'trump' && st.highBid?.seat === seat

  // Against the computer the table is already full, so the "waiting for the
  // table" overlay would flash for a quarter of a second and say nothing true.
  const showLobby = st.phase === 'waiting' && !vsBot
  const showHandEnd = st.phase === 'handEnd'
  const showMatchEnd = st.phase === 'matchEnd'
  const showCover = covered && !remote && !vsBot && !showLobby && !showHandEnd && !showMatchEnd

  // ---- anti-stall affordance ---------------------------------------------
  const holderSeat = st.phase === 'bid'
    ? st.bidTurn
    : st.phase === 'trump' ? (st.highBid?.seat ?? -1) : st.turnSeat
  const stalled = useMemo(() => {
    void tick
    if (!remote || !livePhase || !seated) return false
    if (holderSeat === seat) return false
    const holder = bySeat[holderSeat]
    if (holder && holder.connected === false) return true
    const startedAt = Number(table?.turn?.startedAt) || 0
    return startedAt > 0 && Date.now() - startedAt > STALL_MS
  }, [tick, remote, livePhase, seated, holderSeat, seat, bySeat, table])

  // countdown ring on the active seat (online rooms only — a local table has
  // no deadline, and mirrors deadlineAt: null)
  const turnMsTotal = remote ? (Number(table?.turnMs) || 45000) : 0
  const ringPct = deadlineAt && turnMsTotal && livePhase
    ? clamp(0, ((deadlineAt - (nowMs || Date.now())) / turnMsTotal) * 100, 100)
    : null

  // ---- the fan --------------------------------------------------------------
  // Cards overlap, so the LATER sibling paints on top and takes the tap. Each
  // card's tappable box is exactly its painted box: no invisible hit ring is
  // laid over a neighbour, which is what quietly eats taps on a phone.
  const fan = useMemo(() => {
    const n = myHand.length
    if (!n) return []
    const mid = (n - 1) / 2
    const perCard = n > 1 ? Math.min(2.6, 26 / (n - 1)) : 0
    // The fan is centred on the tray, so the two OUTERMOST cards are also the
    // most tilted, and a tilted card reaches sideways further than its upright
    // edge: half its height * sin(tilt) is added, half its width * (1 - cos)
    // taken back. Left unaccounted, that reach is what pushed the end cards ~2px
    // past a 360px screen. Fold it into the tray margin on BOTH sides so the
    // rotated corner, not just the upright box, is what stays inside the tray.
    const maxA = (mid * perCard) * Math.PI / 180
    const rotReach = Math.max(0, cardW * 0.7 * Math.sin(maxA) - (cardW / 2) * (1 - Math.cos(maxA)))
    const trayW = wide ? Math.min(box.w, 960 * u) : box.w
    const availW = Math.max(150, trayW - 18 * u - 2 * rotReach)
    const step = n > 1 ? Math.min(cardW * 0.62, (availW - cardW) / (n - 1)) : 0
    return myHand.map((c, i) => {
      const d = i - mid
      const nd = mid ? d / mid : 0
      return { c, i, x: d * step, y: nd * nd * cardW * 0.2, a: d * perCard }
    })
  }, [myHand, box.w, cardW, u, wide])
  const fanH = Math.round(cardW * 1.4 + cardW * 0.2 + 2)

  const onCardTap = useCallback((c) => {
    if (!seated) return
    if (st.phase !== 'play' || !isMyTurn) {
      setSel((p) => (p === c ? null : c))
      setReason(st.phase === 'play' ? t.notYourTurn : '')
      play('click', { gain: 0.45 })
      return
    }
    if (!playable(c)) {
      setShake({ c, n: Date.now() })
      setReason(t.cantFollow(ar ? SUIT_AR[ledSuit] : SUIT_EN[ledSuit]))
      play('move', { gain: 0.45 })
      return
    }
    if (sel === c) {
      submit({ t: 'play', seat, card: c })
      setSel(null)
      setReason('')
      return
    }
    setSel(c)
    setReason('')
    play('click', { gain: 0.5 })
  }, [seated, st.phase, isMyTurn, playable, sel, submit, seat, ledSuit, ar, t])

  // clear the shake class once its keyframe has run
  useEffect(() => {
    if (!shake) return undefined
    const id = setTimeout(() => setShake(null), 460)
    return () => clearTimeout(id)
  }, [shake])

  const cycleLevel = () => {
    const i = LEVELS.indexOf(level)
    const nextLevel = LEVELS[(i + 1) % LEVELS.length]
    setLevel(nextLevel)
    try { localStorage.setItem(LEVEL_KEY, nextLevel) } catch (_) { /* storage off */ }
    play('click', { gain: 0.5 })
  }

  // ---- the hint line: it always says what is expected RIGHT NOW ------------
  let hint = ''
  if (!seated) hint = t.watchNote
  else if (reason) hint = reason
  // a skip button with no explanation is the SILENT RULE again — say what it
  // is for, on the same line that always says what is expected now
  else if (stalled) hint = t.stallNote
  else if (showLobby) hint = t.waitPlayers
  else if (st.phase === 'bid') {
    hint = myBidTurn
      ? t.chooseBid + ' — ' + t.floorIs + ' ' + fmt(bidFloor, ar)
      : t.waitingBid + ' ' + nameOf(st.bidTurn)
  } else if (st.phase === 'trump') {
    hint = myTrumpTurn ? t.chooseTrump : t.waitingTrump + ' ' + nameOf(st.highBid?.seat ?? 0)
  } else if (st.phase === 'play') {
    if (st.doneWinner != null) hint = nameOf(st.doneWinner) + ' — ' + t.won
    else if (!isMyTurn) hint = t.turnOf + ' ' + nameOf(st.turnSeat)
    else if (sel) hint = t.tapTwice
    else if (mustFollow) hint = t.follow + ': ' + (ar ? SUIT_AR[ledSuit] : SUIT_EN[ledSuit])
    else hint = t.tapCard
  }

  // ---- contract tracker ---------------------------------------------------
  const bidTeam = st.highBid ? team(st.highBid.seat) : null
  const need = st.highBid ? st.highBid.n : 0
  const got = bidTeam == null ? 0 : st.tricksWon[bidTeam]
  const playedTricks = st.tricksWon[0] + st.tricksWon[1]
  const remaining = 13 - playedTricks

  const seatColour = (sx) => ['var(--cg-s0)', 'var(--cg-s1)', 'var(--cg-s2)', 'var(--cg-s3)'][sx]

  // Where a played card comes in from, and where the finished trick sweeps to.
  // Multiples of the card width, so the whole cross scales with one number.
  const IN = {
    bottom: [0, 2.4], right: [2.4, 0], top: [0, -2.4], left: [-2.4, 0],
  }
  const REST = {
    bottom: [0, 0.68, 2], right: [0.68, 0, 6], top: [0, -0.68, -3], left: [-0.68, 0, -6],
  }
  // the pad is a square, held clear of the two side pods on a narrow phone
  const padSize = Math.round(Math.min(cardW * 3.4, box.w * 0.55, box.h * 0.5))

  const sweepVec = st.doneWinner != null ? IN[POS[rel(st.doneWinner)]] : [0, 0]

  return (
    <div
      ref={rootRef}
      className={'cg-root wst-root' + (wide ? ' is-wide' : '')}
      style={{ '--cg-brand': brand, '--wst-u': u, '--wst-card': cardW + 'px' }}
    >
      {/* ------------------------------------------------------------- HUD */}
      <div className="wst-hud">
        <div className="wst-hud-row">
          <span className={'wst-chip is-team' + (myTeam === 0 ? ' is-mine' : '')} style={{ '--tc': 'var(--cg-teamA)' }}>
            <i className="wst-chip-dot" />
            <span className="wst-chip-lbl">{teamLabel(0)}</span>
            <b key={'a' + st.scores[0]} className="wst-num">{fmt(st.scores[0], ar)}</b>
          </span>
          <span className={'wst-chip is-team' + (myTeam === 1 ? ' is-mine' : '')} style={{ '--tc': 'var(--cg-teamB)' }}>
            <i className="wst-chip-dot" />
            <span className="wst-chip-lbl">{teamLabel(1)}</span>
            <b key={'b' + st.scores[1]} className="wst-num">{fmt(st.scores[1], ar)}</b>
          </span>

          <span className="wst-hud-sp" />

          {st.trump ? (
            <span className={'wst-chip is-gold' + (RED[st.trump] ? ' is-red' : '')}>
              <Suit s={st.trump} className="wst-chip-suit" />
              <span className="wst-chip-lbl">{ar ? SUIT_AR[st.trump] : SUIT_EN[st.trump]}</span>
            </span>
          ) : st.highBid ? (
            <span className="wst-chip is-gold">
              <span className="wst-chip-lbl">{t.standing}</span>
              <b className="wst-num">{fmt(st.highBid.n, ar)}</b>
            </span>
          ) : null}

          {!seated ? <span className="wst-chip is-watch">{t.watcher}</span> : null}

          {vsBot ? (
            <button type="button" className="wst-chip is-btn cg-press" onClick={cycleLevel} title={t.levelTip} aria-label={t.levelTip}>
              <span className="wst-chip-lbl">{t.levelLbl}</span>
              <b>{t[level]}</b>
            </button>
          ) : null}

          <button type="button" className="wst-iconbtn cg-press" onClick={() => setRules(true)} aria-label={t.rules}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M9.4 9.2a2.7 2.7 0 1 1 3.4 2.7c-.6.2-.9.7-.9 1.4v.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <circle cx="12" cy="17" r="1.1" fill="currentColor" />
            </svg>
          </button>
        </div>

        {/* the contract tracker — on screen for every trick of every hand */}
        {(st.phase === 'play' || st.phase === 'handEnd') && st.highBid ? (
          <div className={'wst-track' + (bidTeam === myTeam ? ' is-ours' : '')}>
            <span className="wst-track-lbl">{seated ? (bidTeam === myTeam ? t.usBid : t.themBid) : t.contractOf + ' ' + teamLabel(bidTeam)}</span>
            <span className="wst-track-bars" aria-hidden="true">
              {Array.from({ length: 13 }).map((_, i) => (
                <i key={i} className={'wst-seg' + (i < got ? ' is-on' : i < need ? ' is-need' : '')} />
              ))}
            </span>
            <span className="wst-track-num">
              <b className="wst-num">{fmt(got, ar)}</b>
              <span>/</span>
              <b className="wst-num">{fmt(need, ar)}</b>
            </span>
            <span className="wst-track-rest">{t.left} <b className="wst-num">{fmt(remaining, ar)}</b></span>
          </div>
        ) : null}
      </div>

      {/* ----------------------------------------------------------- table */}
      <div className="wst-stage">
        <div className="wst-table">
          <div className="wst-felt">
            <span className="wst-grain" />
            <span className="wst-vig" />
            <span className="wst-inlay" />
            {st.trump ? (
              <svg className={'wst-mark' + (RED[st.trump] ? ' is-red' : '')} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d={SUIT_PATH[st.trump]} fill="currentColor" />
              </svg>
            ) : null}
          </div>
        </div>

        {/* seats */}
        {[0, 1, 2, 3].map((sx) => {
          const r = rel(sx)
          const p = bySeat[sx]
          const on = holderSeat === sx && livePhase && !showLobby
          const bid = st.bids[sx]
          const isHigh = st.highBid && st.highBid.seat === sx
          const mates = team(sx) === myTeam
          const cardsLeft = (st.hands[sx] || []).length
          return (
            <div
              key={sx}
              className={
                'wst-seat pos-' + POS[r] + (on ? ' is-turn' : '') + (p ? '' : ' is-off')
                + (mates ? ' is-mate' : '') + (r === 0 ? ' is-self' : '')
                // During the auction the panel in the middle of the felt owns
                // the width, so the two side pods collapse to their avatar
                // rather than being half-hidden behind it.
                + (st.phase === 'bid' && (r === 1 || r === 3) ? ' is-slim' : '')
              }
              style={{ '--sc': seatColour(sx) }}
            >
              <span className="wst-av">
                {on && ringPct != null ? (
                  <svg className="wst-av-ring" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
                    <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="3" />
                    <circle
                      cx="20" cy="20" r="18" fill="none"
                      stroke={ringPct < 25 ? 'var(--cg-red)' : 'var(--cg-gold)'}
                      strokeWidth="3" strokeLinecap="round"
                      strokeDasharray="113.1"
                      strokeDashoffset={113.1 * (1 - ringPct / 100)}
                      transform="rotate(-90 20 20)"
                    />
                  </svg>
                ) : null}
                <span className="wst-av-i">{initialsOf(p?.name)}</span>
              </span>

              <span className="wst-seat-col">
                <span className="wst-seat-name">{r === 0 && seated ? t.you : nameOf(sx)}</span>
                <span className="wst-seat-sub">
                  {/* "your partner" on your OWN pod would be nonsense */}
                  {r === 0 && seated ? null : (
                    <span className={'wst-role' + (mates && seated ? ' is-mate' : '')}>
                      {seated ? (mates ? t.partner : t.rival) : teamLabel(team(sx))}
                    </span>
                  )}
                  {st.phase === 'play' || st.phase === 'handEnd' ? (
                    <span key={'tr' + st.tricksWon[team(sx)]} className="wst-seat-tricks">
                      {tricksLabel(st.tricksWon[team(sx)], ar, t)}
                    </span>
                  ) : null}
                  {st.dealer === sx && st.phase === 'bid' ? <span className="wst-seat-deal">{t.dealer}</span> : null}
                  {p && p.connected === false ? <span className="wst-seat-gone">{t.offline}</span> : null}
                </span>
              </span>

              {/* an opponent's remaining cards, as backs. The bottom seat only
                  shows them to a spectator, who holds no hand of their own. */}
              {(r !== 0 || !seated) && (st.phase === 'play' || st.phase === 'trump') && cardsLeft > 0 ? (
                <span className="wst-backs" aria-hidden="true">
                  {Array.from({ length: Math.min(4, cardsLeft) }).map((_, i) => (
                    <CardBack key={i} w={Math.round(cardW * 0.34)} className="wst-mini" />
                  ))}
                  <span className="wst-backs-n">{fmt(cardsLeft, ar)}</span>
                </span>
              ) : null}

              {st.phase === 'bid' && bid != null ? (
                <span className={'wst-tag' + (isHigh ? ' is-high' : bid === 'pass' ? ' is-pass' : '')}>
                  {bid === 'pass' ? t.passed : t.bidOf + ' ' + fmt(bid, ar)}
                </span>
              ) : null}

              {on ? <span className="wst-turnlbl">{sx === seat && seated ? t.yourTurn : t.turnNow}</span> : null}
            </div>
          )
        })}

        {/* the centre: the trick pad during play, the auction panel before it */}
        {st.phase === 'play' || st.phase === 'trump' ? (
          <div className="wst-pad" style={{ width: padSize + 'px', height: padSize + 'px' }}>
            <span className="wst-pad-ring" />
            <div
              className={'wst-pad-cards' + (sweep ? ' is-sweep' : '')}
              style={sweep ? {
                transform: `translate(${sweepVec[0] * cardW * 0.8}px, ${sweepVec[1] * cardW * 0.8}px) scale(0.45)`,
              } : undefined}
            >
              {trickCards.map((p, idx) => {
                const pos = POS[rel(p.seat)]
                const [rx, ry, rot] = REST[pos]
                const [ix, iy] = IN[pos]
                const winning = st.doneWinner === p.seat
                return (
                  <div
                    key={p.seat + ':' + p.card}
                    className={'wst-lay' + (winning ? ' is-win' : '')}
                    style={{
                      '--ix': ix * cardW + 'px',
                      '--iy': iy * cardW + 'px',
                      // later cards land on top of earlier ones, and the card
                      // that TOOK the trick comes to the front so the gold ring
                      // is never half-hidden under somebody else's card
                      zIndex: winning ? 10 : idx + 1,
                      transform: `translate(-50%, -50%) translate(${rx * cardW}px, ${ry * cardW}px) rotate(${rot}deg)`,
                    }}
                  >
                    <CardFace code={p.card} w={Math.round(cardW * 1.1)} />
                  </div>
                )
              })}
            </div>
            {st.phase === 'trump' && st.highBid ? (
              <span className="wst-pad-note">
                {nameOf(st.highBid.seat)} — {t.bidOf} {fmt(st.highBid.n, ar)}
                {st.highBid.n >= MAX_BID ? ' (' + t.kaboot + ')' : ''}
                <br />
                {t.namingTrump}
              </span>
            ) : st.phase === 'play' && !trickCards.length ? (
              <span className="wst-pad-note">{t.trickNo} {fmt(playedTricks + 1, ar)} {t.ofThirteen}</span>
            ) : null}
            {ledSuit ? (
              <span className={'wst-led' + (RED[ledSuit] ? ' is-red' : '')}>
                <span>{t.led}</span>
                <Suit s={ledSuit} className="wst-chip-suit" />
              </span>
            ) : null}
          </div>
        ) : null}

        {st.phase === 'bid' ? (
          <div className="wst-auction">
            <div className="wst-auction-head">
              <strong>{t.auction}</strong>
              <span>{t.floorIs} <b className="wst-num">{fmt(bidFloor, ar)}</b></span>
            </div>
            <div className="wst-auction-rows">
              {[0, 1, 2, 3].map((k) => {
                const sx = (nx(st.dealer) + k) % 4
                const bid = st.bids[sx]
                const isHigh = st.highBid && st.highBid.seat === sx
                const onNow = st.bidTurn === sx
                return (
                  <div
                    key={sx}
                    className={'wst-arow' + (isHigh ? ' is-high' : '') + (onNow ? ' is-now' : '')}
                    style={{ '--sc': seatColour(sx) }}
                  >
                    <i className="wst-arow-dot" />
                    <span className="wst-arow-name">{sx === seat && seated ? t.you : nameOf(sx)}</span>
                    <span className={'wst-arow-bid' + (bid === 'pass' ? ' is-pass' : '')}>
                      {bid == null ? (onNow ? '…' : '—') : bid === 'pass' ? t.passed : fmt(bid, ar)}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="wst-auction-foot">{t.kabootNote}</p>
          </div>
        ) : null}

        {st.doneWinner != null ? (
          <div className="wst-banner">{nameOf(st.doneWinner)} — {t.won}</div>
        ) : null}

        {showLobby ? (
          <div className="cg-lobby">
            <strong className="cg-lobby-title">{t.waitPlayers}</strong>
            <p className="cg-lobby-sub">{t.needFour}</p>
            <div className="cg-lobby-seats">
              {[0, 1, 2, 3].map((sx) => (
                <div
                  key={sx}
                  className={'cg-lobby-seat' + (bySeat[sx] ? ' is-filled' : '') + (sx === seat && seated ? ' is-me' : '')}
                  style={{ '--sc': seatColour(sx) }}
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

      </div>

      {/* --------------------------------------------------------- hand tray */}
      <div className={'wst-bar' + (seated ? '' : ' is-watch')}>
        {seated ? (
          <div className="wst-fan" style={{ height: fanH + 'px' }}>
            {fan.map((f) => {
              const can = playable(f.c)
              const dim = st.phase === 'play' && isMyTurn && !can
              const isSel = sel === f.c
              const lift = isSel ? cardW * 0.34 : can ? cardW * 0.1 : 0
              return (
                <button
                  key={f.c}
                  type="button"
                  className={'wst-fc' + (isSel ? ' is-sel' : '') + (dim ? ' is-dim' : '')}
                  style={{
                    width: cardW + 'px',
                    marginInlineStart: -cardW / 2 + 'px',
                    // PAINT ORDER IS HIT ORDER. A fanned card only exposes its
                    // left sliver, so whichever card paints on top owns the tap
                    // in the overlap. Playable cards therefore paint ABOVE the
                    // ones a rule has removed: otherwise the single card you
                    // are allowed to play can end up with a 24px crescent of
                    // itself while a dead card covers the rest of its face.
                    zIndex: isSel ? 90 : can ? 40 + f.i : f.i + 1,
                    transform: `translate(${f.x}px, ${f.y - lift}px) rotate(${f.a}deg)`,
                  }}
                  onClick={() => onCardTap(f.c)}
                  aria-label={label(f.c) + ' ' + (ar ? SUIT_AR[suitOf(f.c)] : SUIT_EN[suitOf(f.c)])}
                  aria-pressed={isSel}
                >
                  <span
                    key={shake && shake.c === f.c ? 'sh' + shake.n : 'st'}
                    className={'wst-fc-in' + (shake && shake.c === f.c ? ' is-shake' : '')}
                  >
                    <CardFace code={f.c} w={cardW} />
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}

        {myBidTurn ? (
          <div className="wst-bids">
            {Array.from({ length: MAX_BID - MIN_BID + 1 }).map((_, i) => {
              const n = MIN_BID + i
              const off = n < bidFloor
              return (
                <button
                  key={n}
                  type="button"
                  className={'wst-bidnum cg-press' + (n === MAX_BID ? ' is-kaboot' : '') + (off ? ' is-off' : '')}
                  disabled={off}
                  onClick={() => submit({ t: 'bid', seat, n })}
                  aria-label={t.bidOf + ' ' + n}
                >
                  {fmt(n, ar)}
                </button>
              )
            })}
            <button type="button" className="wst-passbtn cg-press" onClick={() => submit({ t: 'pass', seat })}>
              {t.pass}
            </button>
          </div>
        ) : null}

        {myTrumpTurn ? (
          <div className="wst-suits">
            {SUITS.map((sx) => (
              <button
                key={sx}
                type="button"
                className={'wst-suitpick cg-press' + (RED[sx] ? ' is-red' : '')}
                onClick={() => submit({ t: 'trump', seat, suit: sx })}
                aria-label={ar ? SUIT_AR[sx] : SUIT_EN[sx]}
              >
                <Suit s={sx} />
                <span>{ar ? SUIT_AR[sx] : SUIT_EN[sx]}</span>
              </button>
            ))}
          </div>
        ) : null}

        {(seated && st.phase === 'play' && isMyTurn && sel && playable(sel)) || stalled ? (
          <div className="wst-acts">
            {seated && st.phase === 'play' && isMyTurn && sel && playable(sel) ? (
              <>
                <button
                  type="button"
                  className="wst-play cg-press"
                  onClick={() => { submit({ t: 'play', seat, card: sel }); setSel(null) }}
                >
                  <span>{t.playIt}</span>
                  <CardFace code={sel} w={Math.round(cardW * 0.5)} className="wst-mini" />
                </button>
                <button type="button" className="cg-btn is-ghost is-sm cg-press" onClick={() => setSel(null)}>
                  {t.cancel}
                </button>
              </>
            ) : null}
            {stalled ? (
              <button type="button" className="cg-btn is-ghost is-sm cg-press" onClick={() => submit({ t: 'forceSkip', seat })}>
                {t.skip}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={'wst-hint' + (reason ? ' is-warn' : '')} role="status">{hint}</div>
      </div>

      {/* Both curtains cover the WHOLE component, hand tray included: a
          privacy cover that leaves the cards showing under it is not a cover,
          and a result screen that leaves the fan live invites a stray tap. */}
      {showCover ? (
        <div className="cg-modal wst-modal" onClick={() => setCovered(false)}>
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
                  <span>{teamLabel(tm)}</span>
                  <span className={
                    'cg-delta' + ((st.lastHand?.delta?.[tm] || 0) > 0 ? ' is-up' : (st.lastHand?.delta?.[tm] || 0) < 0 ? ' is-down' : '')
                  }>
                    {signed(st.lastHand?.delta?.[tm] || 0, ar)}
                  </span>
                  <b>{fmt(st.scores[tm], ar)}</b>
                </div>
              ))}
            </div>
            {vsBot && !showMatchEnd ? (
              <div className="wst-levels">
                <span className="wst-levels-lbl">{t.levelLbl}</span>
                {LEVELS.map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    className={'wst-levelbtn cg-press' + (level === lv ? ' is-on' : '')}
                    onClick={() => {
                      setLevel(lv)
                      try { localStorage.setItem(LEVEL_KEY, lv) } catch (_) { /* storage off */ }
                      play('click', { gain: 0.5 })
                    }}
                  >
                    {t[lv]}
                  </button>
                ))}
              </div>
            ) : null}
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

      {rules ? (
        <div className="cg-over">
          <div className="cg-over-head">
            <strong>{ar ? 'الوِست — الشرح' : 'Wist — how to play'}</strong>
            <button type="button" className="wst-iconbtn cg-press" onClick={() => setRules(false)} aria-label={t.close}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 6 L18 18 M18 6 L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="cg-over-body cg-scroll">
            {vsBot ? (
              <div className="wst-levels is-inline">
                <span className="wst-levels-lbl">{t.levelLbl}</span>
                {LEVELS.map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    className={'wst-levelbtn cg-press' + (level === lv ? ' is-on' : '')}
                    onClick={() => {
                      setLevel(lv)
                      try { localStorage.setItem(LEVEL_KEY, lv) } catch (_) { /* storage off */ }
                    }}
                  >
                    {t[lv]}
                  </button>
                ))}
              </div>
            ) : null}
            {ar ? RULES_AR : RULES_EN}
          </div>
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
// Arabic counted-noun agreement for tricks: 1 and 2 have their own forms, 3-10
// take the plural «أكلات», 11+ take the singular accusative «أكلة». Printing a
// bare «N أكلات» read as «1 أكلات» on a side that had taken exactly one trick.
function tricksLabel(n, ar, t) {
  const v = Number(n) || 0
  if (!ar) return `${fmt(v, ar)} ${t.tricks}`
  if (v === 1) return 'أكلة واحدة'
  if (v === 2) return 'أكلتان'
  return `${fmt(v, ar)} ${v >= 3 && v <= 10 ? 'أكلات' : 'أكلة'}`
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
