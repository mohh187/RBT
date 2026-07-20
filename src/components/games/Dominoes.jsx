// «الدومينو» — the standard double-six block-and-draw game as it is played in
// the Gulf, for two to four players, realtime over a game room.
//
// VARIANT CHOICES (dominoes has no single world rule set — these are the most
// common Gulf-table conventions, and they are also stated to the player in
// RULES_AR so nobody is surprised mid-round):
//   · 28 tiles. Two players take 7 each; three or four take 5 each. The rest is
//     the boneyard.
//   · FIRST round: the highest double opens, and its holder MUST open with it.
//     If nobody holds a double, the highest tile by pip total opens (ties broken
//     by the higher single pip). LATER rounds: the winner of the previous round
//     opens with any tile of their choosing.
//   · DRAW variant, not the pure block game: a player who cannot play draws one
//     tile at a time from the boneyard until able. You may NOT draw while you
//     hold a playable tile, and you may only pass once the boneyard is empty.
//   · Turn order runs to the next seat in order.
//   · The round ends when a player lays their last tile, or when every player
//     passes in succession (a blocked round).
//   · Scoring: the winner takes the total pips left in every opponent's hand. A
//     blocked round goes to the lowest remaining pip total, who takes the
//     others' pips. If two or more tie for lowest the round is a draw worth no
//     points, and the same player opens again.
//   · First to 101 wins the match.
//
// DETERMINISM. `reduce` must stay pure, so the deal cannot call Math.random.
// Instead the room carries a `seed` fixed once at creation, and round N is dealt
// by a seeded PRNG from (seed, roundNo). Every client derives the identical deal
// and no client can stack the deck by choosing what to submit.
//
// Contract: this component renders the play area only and never writes to
// Firestore — it calls onMove(move) and re-renders from the live `room`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import '../../styles/boardgames.css'

export const GAME_ID = 'dominoes'
export const TARGET = 101

/* ===========================================================================
   ENGINE — pure, module scope, no React.
   A tile id is `${hi}:${lo}` with hi >= lo, so every tile has one id.
   A laid tile is { id, a, b } where `a` faces the left end of the chain and `b`
   faces the right end.
   =========================================================================== */
const ALL_TILES = (() => {
  const out = []
  for (let a = 6; a >= 0; a--) for (let b = a; b >= 0; b--) out.push(`${a}:${b}`)
  return out
})()

const pipsOf = (id) => {
  const [a, b] = String(id).split(':')
  return [Number(a) || 0, Number(b) || 0]
}
const isDouble = (id) => { const [a, b] = pipsOf(id); return a === b }
const tileWeight = (id) => { const [a, b] = pipsOf(id); return a + b }
const handPips = (hand) => (hand || []).reduce((n, id) => n + tileWeight(id), 0)

function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const endsOf = (line) => {
  if (!line || !line.length) return { L: null, R: null }
  return { L: line[0].a, R: line[line.length - 1].b }
}

// Which ends does this tile fit? An empty chain fits everywhere.
function sidesFor(id, line) {
  if (!line || !line.length) return { L: true, R: true }
  const { L, R } = endsOf(line)
  const [a, b] = pipsOf(id)
  return { L: a === L || b === L, R: a === R || b === R }
}
const isPlayable = (id, line) => { const s = sidesFor(id, line); return s.L || s.R }
const hasPlayable = (hand, line) => (hand || []).some((id) => isPlayable(id, line))

// The opener of the very first round: highest double, else highest tile.
function findOpening(hands, count) {
  let best = null
  for (let s = 0; s < count; s++) {
    for (const id of hands[String(s)] || []) {
      const [a, b] = pipsOf(id)
      const rank = a === b ? 1000 + a : a + b + Math.max(a, b) / 10
      if (!best || rank > best.rank) best = { seat: s, id, rank }
    }
  }
  return best
}

// Deal a fresh round onto the carried-over match facts (scores, seed, roundNo).
function dealRound(base, opener) {
  const count = base.playerCount
  const rnd = mulberry32(((base.seed | 0) + base.roundNo * 7919) | 0)
  const deck = ALL_TILES.slice()
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const tmp = deck[i]
    deck[i] = deck[j]
    deck[j] = tmp
  }
  const per = count === 2 ? 7 : 5
  const hands = {}
  for (let s = 0; s < count; s++) hands[String(s)] = deck.slice(s * per, (s + 1) * per)
  const boneyard = deck.slice(count * per)

  let turn = Number.isInteger(opener) ? opener : 0
  let mustOpen = null
  if (!Number.isInteger(opener)) {
    const first = findOpening(hands, count)
    if (first) { turn = first.seat; mustOpen = first.id }
  }
  return {
    ...base,
    hands,
    boneyard,
    line: [],
    turn,
    opener: turn,
    mustOpen,
    passes: 0,
    drew: 0,
    phase: 'play',
    result: null,
    last: null,
  }
}

const sane = (s) =>
  !!s && typeof s === 'object' && s.hands && Array.isArray(s.boneyard) && Array.isArray(s.line) &&
  Number.isInteger(s.playerCount)

export function initialState(playerCount = 2) {
  const count = Math.max(2, Math.min(4, Number(playerCount) || 2))
  const scores = {}
  for (let s = 0; s < count; s++) scores[String(s)] = 0
  return dealRound(
    {
      playerCount: count,
      target: TARGET,
      seed: Math.floor(Math.random() * 1e9),
      roundNo: 1,
      scores,
      matchWinner: null,
    },
    null,
  )
}

// Close the round out, award the points and decide whether the match is over.
function settleRound(st, kind, winner) {
  const pips = {}
  for (let s = 0; s < st.playerCount; s++) pips[String(s)] = handPips(st.hands[String(s)])
  let points = 0
  if (Number.isInteger(winner)) {
    for (let s = 0; s < st.playerCount; s++) if (s !== winner) points += pips[String(s)]
  }
  const scores = { ...st.scores }
  if (Number.isInteger(winner)) scores[String(winner)] = (scores[String(winner)] || 0) + points
  const done = Number.isInteger(winner) && scores[String(winner)] >= (st.target || TARGET)
  return {
    ...st,
    scores,
    phase: done ? 'matchEnd' : 'roundEnd',
    matchWinner: done ? winner : null,
    result: { kind, winner: Number.isInteger(winner) ? winner : null, points, pips },
  }
}

const stampOf = (move) => (typeof move?.at === 'number' ? move.at : null)
const turnOut = (seat, move) => ({ seat, startedAt: stampOf(move), deadlineAt: null })

// The anti-cheat boundary. Total function: any illegal move returns the state
// untouched. Re-runs inside the room transaction against the committed state.
export function reduce(state, move, room) {
  const st = sane(state) ? state : initialState(2)
  const type = move && move.type ? move.type : 'play'
  const seat = Number.isInteger(move && move.seat)
    ? move.seat
    : Number.isInteger(room && room.turn && room.turn.seat)
      ? room.turn.seat
      : st.turn

  // a fresh match is only offered once this one is decided — otherwise a losing
  // player could wipe the scores mid-match
  if (type === 'reset') {
    if (st.phase !== 'matchEnd') return { state: st }
    const fresh = initialState(st.playerCount)
    return { state: fresh, turn: turnOut(fresh.turn, move), status: 'playing', winnerSeat: null }
  }
  if (type === 'next') {
    if (st.phase !== 'roundEnd') return { state: st }
    const opener = st.result && Number.isInteger(st.result.winner) ? st.result.winner : st.opener
    const ns = dealRound({ ...st, roundNo: (st.roundNo || 1) + 1 }, opener)
    return { state: ns, turn: turnOut(ns.turn, move), status: 'playing', winnerSeat: null }
  }
  if (st.phase !== 'play') return { state: st }
  if (!Number.isInteger(seat) || seat < 0 || seat >= st.playerCount) return { state: st }
  if (seat !== st.turn) return { state: st }

  const hand = st.hands[String(seat)] || []
  const nextSeat = (seat + 1) % st.playerCount

  if (type === 'draw') {
    // real rule: you draw only because you cannot play, and only from a live boneyard
    if (!st.boneyard.length) return { state: st }
    if (hasPlayable(hand, st.line)) return { state: st }
    const boneyard = st.boneyard.slice(0, -1)
    const drawn = st.boneyard[st.boneyard.length - 1]
    return {
      state: {
        ...st,
        boneyard,
        hands: { ...st.hands, [String(seat)]: hand.concat(drawn) },
        drew: (st.drew || 0) + 1,
      },
      turn: turnOut(seat, move),
      status: 'playing',
      winnerSeat: null,
    }
  }

  if (type === 'pass') {
    if (st.boneyard.length) return { state: st }
    if (hasPlayable(hand, st.line)) return { state: st }
    const passes = (st.passes || 0) + 1
    if (passes >= st.playerCount) {
      // blocked: lowest remaining pip count takes the round; a tie scores nothing
      let low = Infinity
      let winners = []
      for (let s = 0; s < st.playerCount; s++) {
        const n = handPips(st.hands[String(s)])
        if (n < low) { low = n; winners = [s] }
        else if (n === low) winners.push(s)
      }
      const settled = settleRound(
        { ...st, passes, drew: 0 },
        winners.length === 1 ? 'blocked' : 'tie',
        winners.length === 1 ? winners[0] : null,
      )
      return {
        state: settled,
        turn: turnOut(st.turn, move),
        status: settled.phase === 'matchEnd' ? 'ended' : 'playing',
        winnerSeat: settled.phase === 'matchEnd' ? settled.matchWinner : null,
      }
    }
    return {
      state: { ...st, passes, drew: 0, turn: nextSeat },
      turn: turnOut(nextSeat, move),
      status: 'playing',
      winnerSeat: null,
    }
  }

  if (type !== 'play') return { state: st }

  const id = move.id
  if (typeof id !== 'string' || hand.indexOf(id) < 0) return { state: st }
  const [pa, pb] = pipsOf(id)
  let line

  if (!st.line.length) {
    if (st.mustOpen && id !== st.mustOpen) return { state: st }
    line = [{ id, a: pa, b: pb }]
  } else {
    const side = move.side === 'L' ? 'L' : move.side === 'R' ? 'R' : null
    if (!side) return { state: st }
    const fit = sidesFor(id, st.line)
    if (!fit[side]) return { state: st }
    if (side === 'L') {
      // the new tile joins on the left, so its RIGHT-facing pip must match
      const end = st.line[0].a
      const b = end
      const a = pa === end ? pb : pa
      line = [{ id, a, b }].concat(st.line)
    } else {
      const end = st.line[st.line.length - 1].b
      const a = end
      const b = pa === end ? pb : pa
      line = st.line.concat([{ id, a, b }])
    }
  }

  const rest = hand.filter((x) => x !== id)
  const base = {
    ...st,
    line,
    hands: { ...st.hands, [String(seat)]: rest },
    mustOpen: null,
    passes: 0,
    drew: 0,
    last: { seat, id, side: st.line.length ? move.side : 'R' },
  }

  if (!rest.length) {
    const settled = settleRound(base, 'domino', seat)
    return {
      state: settled,
      turn: turnOut(seat, move),
      status: settled.phase === 'matchEnd' ? 'ended' : 'playing',
      winnerSeat: settled.phase === 'matchEnd' ? settled.matchWinner : null,
    }
  }
  return {
    state: { ...base, turn: nextSeat },
    turn: turnOut(nextSeat, move),
    status: 'playing',
    winnerSeat: null,
  }
}

export const RULES_AR = [
  'الدومينو المزدوج ستة: ثمانية وعشرون حجراً. للاعبين اثنين سبعة أحجار لكل واحد، ولثلاثة أو أربعة خمسة أحجار، والباقي مخزن السحب.',
  'الجولة الأولى يفتحها صاحب أعلى دبل ويلزمه أن يبدأ به، فإن لم يكن مع أحد دبل فتُفتح بأعلى حجر مجموعاً. أما الجولات التالية فيفتحها الفائز بالجولة السابقة بأي حجر يختاره.',
  'يُلعب الحجر على أي من الطرفين المفتوحين إذا طابق أحد رقميه، والدبل يوضع بالعرض.',
  'من لا يستطيع اللعب يسحب من المخزن حجراً بعد حجر حتى يتمكن، ولا يجوز السحب وفي يدك حجر صالح للعب. وإذا فرغ المخزن ولم تستطع اللعب فأنت تمرّر.',
  'تنتهي الجولة بنزول آخر حجر من يد أحد اللاعبين، أو بانسداد اللعب حين يمرّر الجميع تباعاً.',
  'الحساب: يأخذ الفائز مجموع نقاط ما تبقى في أيدي الخصوم. وفي الجولة المسدودة يفوز صاحب أقل مجموع ويأخذ نقاط الباقين، وإن تساوى اثنان في الأقل فالجولة تعادل بلا نقاط ويفتح اللاعب نفسه الجولة التالية.',
  `أول من يبلغ ${TARGET} نقطة يكسب المباراة.`,
].join('\n')

/* ===========================================================================
   SNAKE LAYOUT — a boustrophedon run that turns at the edges, so a full
   twenty-eight-tile chain still fits one screen. Units: a tile is 2 long and 1
   wide; the SVG viewBox is fitted to the result, so the drawing scales down
   instead of overflowing.
   =========================================================================== */
const ROW_W = 12
const ROW_GAP = 0.16

function layoutSnake(line) {
  const out = []
  let dir = 1
  let x = 0
  let y = 0
  for (const tl of line) {
    const dbl = tl.a === tl.b
    const len = dbl ? 1 : 2
    const overflow = dir === 1 ? x + len > ROW_W : x - len < 0
    if (overflow && out.length) {
      // the tile at the corner is laid across the turn, joining the two rows
      const cx = dir === 1 ? ROW_W - 0.5 : 0.5
      const top = y - 0.5
      out.push({ ...tl, cx, cy: top + len / 2, rot: dbl ? 0 : 90, flip: false })
      y = top + len + ROW_GAP + 0.5
      dir = -dir
      x = dir === 1 ? 0 : ROW_W
      continue
    }
    out.push({ ...tl, cx: x + (dir * len) / 2, cy: y, rot: dbl ? 90 : 0, flip: dir === -1 })
    x += dir * len
  }
  return out
}

function boxOf(placed) {
  if (!placed.length) return { x: 0, y: 0, w: 1, h: 1 }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of placed) {
    const hw = p.rot === 90 ? 0.5 : 1
    const hh = p.rot === 90 ? 1 : 0.5
    x0 = Math.min(x0, p.cx - hw)
    x1 = Math.max(x1, p.cx + hw)
    y0 = Math.min(y0, p.cy - hh)
    y1 = Math.max(y1, p.cy + hh)
  }
  const pad = 0.5
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 }
}

/* ---------- tile drawing (SVG, unit space: 2 wide, 1 tall, centred) ---------- */
const PIP_XY = {
  0: [],
  1: [[0, 0]],
  2: [[-0.2, -0.24], [0.2, 0.24]],
  3: [[-0.2, -0.24], [0, 0], [0.2, 0.24]],
  4: [[-0.2, -0.24], [0.2, -0.24], [-0.2, 0.24], [0.2, 0.24]],
  5: [[-0.2, -0.24], [0.2, -0.24], [0, 0], [-0.2, 0.24], [0.2, 0.24]],
  6: [[-0.2, -0.24], [0.2, -0.24], [-0.2, 0], [0.2, 0], [-0.2, 0.24], [0.2, 0.24]],
}

function Pips({ n, ox }) {
  return (
    <>
      {(PIP_XY[n] || []).map(([px, py], i) => (
        <circle key={i} cx={ox + px} cy={py} r="0.085" fill="#1b242e" />
      ))}
    </>
  )
}

// The tile face in its own local frame; the caller supplies the transform.
function TileFace({ a, b, tone = 'ivory' }) {
  const face = tone === 'sel' ? '#e8f6ff' : tone === 'dim' ? '#cdc9bf' : '#f4f0e5'
  return (
    <>
      <rect x="-1" y="-0.5" width="2" height="1" rx="0.15" fill={face} stroke="#141d26" strokeWidth="0.055" />
      <line x1="0" y1="-0.4" x2="0" y2="0.4" stroke="#141d26" strokeWidth="0.05" strokeLinecap="round" />
      <Pips n={a} ox={-0.5} />
      <Pips n={b} ox={0.5} />
    </>
  )
}

/* ===========================================================================
   TEXT
   =========================================================================== */
const TXT = {
  ar: {
    you: 'أنت',
    player: 'لاعب',
    yourTurn: 'دورك',
    theirTurn: 'دور',
    spectator: 'أنت متفرّج',
    waiting: 'بانتظار اللاعبين',
    empty: 'الرقعة فارغة — افتح الجولة بحجر من يدك',
    mustOpen: 'افتح الجولة بهذا الحجر',
    left: 'الطرف الأيسر',
    right: 'الطرف الأيمن',
    draw: 'اسحب',
    pass: 'مرّر',
    boneyard: 'المخزن',
    round: 'الجولة',
    roundOver: 'انتهت الجولة',
    matchOver: 'انتهت المباراة',
    byDomino: 'خرج بكل أحجاره',
    byBlocked: 'انسدّ اللعب — الفوز لأقل مجموع',
    byTie: 'انسدّ اللعب وتساوى الأقل — لا نقاط لهذه الجولة',
    gained: 'نقطة',
    nextRound: 'الجولة التالية',
    newMatch: 'مباراة جديدة',
    won: 'كسب المباراة',
    pass2: 'مرّر لعدم وجود حجر صالح',
    reveal: 'مرّر الجهاز، ثم اضغط لعرض أحجارك',
    tapToShow: 'اضغط للعرض',
    pickSide: 'اختر الطرف',
    left1: 'يسار',
    right1: 'يمين',
    left2: 'اليسار',
    remaining: 'أحجار',
  },
  en: {
    you: 'You',
    player: 'Player',
    yourTurn: 'Your turn',
    theirTurn: 'Turn of',
    spectator: 'Spectating',
    waiting: 'Waiting for players',
    empty: 'Empty board — open the round with a tile',
    mustOpen: 'Open the round with this tile',
    left: 'Left end',
    right: 'Right end',
    draw: 'Draw',
    pass: 'Pass',
    boneyard: 'Boneyard',
    round: 'Round',
    roundOver: 'Round over',
    matchOver: 'Match over',
    byDomino: 'played the last tile',
    byBlocked: 'Blocked — lowest pip count wins',
    byTie: 'Blocked and tied — no points this round',
    gained: 'points',
    nextRound: 'Next round',
    newMatch: 'New match',
    won: 'wins the match',
    pass2: 'Pass, nothing playable',
    reveal: 'Pass the device, then tap to see your tiles',
    tapToShow: 'Tap to reveal',
    pickSide: 'Pick an end',
    left1: 'Left',
    right1: 'Right',
    left2: 'Left',
    remaining: 'tiles',
  },
}

/* ===========================================================================
   COMPONENT
   =========================================================================== */
export default function Dominoes({
  onScore,
  onExit,
  lang = 'ar',
  brand = '#0e7490',
  playerName = '',
  room = null,
  mySeat = null,
  onMove,
  onProgress,
  resumeState,
}) {
  const t = TXT[lang === 'en' ? 'en' : 'ar']
  const mp = !!room
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])

  const [local, setLocal] = useState(() => {
    const saved = resumeState && resumeState.game === GAME_ID && resumeState.state
    return sane(saved) ? saved : initialState(2)
  })
  const st = useMemo(() => {
    const raw = mp ? room.state : local
    return sane(raw) ? raw : initialState(mp && Array.isArray(room.players) ? room.players.length : 2)
  }, [mp, room, local])

  const seat = mp ? (Number.isInteger(mySeat) ? mySeat : null) : st.turn
  const myTurn = st.phase === 'play' && seat !== null && seat === st.turn

  // single-device play hides the hand between turns
  const [revealed, setRevealed] = useState(() => (mp ? null : st.turn))
  const veiled = !mp && st.phase === 'play' && revealed !== st.turn

  const [sel, setSel] = useState(null)

  const hand = useMemo(() => {
    const owner = mp ? seat : st.turn
    return owner === null ? [] : st.hands[String(owner)] || []
  }, [mp, seat, st])

  const ends = endsOf(st.line)
  const placed = useMemo(() => layoutSnake(st.line || []), [st.line])
  const box = useMemo(() => boxOf(placed), [placed])
  const canAnything = hasPlayable(hand, st.line)
  const selSides = sel ? sidesFor(sel, st.line) : { L: false, R: false }

  // drop a stale selection whenever the chain changes underneath us
  const lineRef = useRef(0)
  useEffect(() => {
    const n = (st.line || []).length
    if (lineRef.current !== n) { lineRef.current = n; setSel(null) }
  }, [st.line])

  const submit = useCallback((move) => {
    const payload = Number.isInteger(seat) ? { ...move, seat } : move
    if (mp) onMove?.(payload)
    else setLocal((prev) => reduce(prev, { ...payload, seat: prev.turn }, null).state)
    setSel(null)
  }, [mp, onMove, seat])

  // reveal the new player's hand only after they acknowledge the handover
  useEffect(() => { if (mp) return; if (st.phase !== 'play') setRevealed(st.turn) }, [mp, st.phase, st.turn])

  useEffect(() => {
    if (!mp) onProgressRef.current?.({ game: GAME_ID, state: st })
    const mine = Number.isInteger(seat) ? st.scores[String(seat)] : null
    if (Number.isInteger(mine)) onScoreRef.current?.(mine)
  }, [st, mp, seat])

  const tapTile = useCallback((id) => {
    if (!myTurn || veiled) return
    if (!st.line.length) {
      if (st.mustOpen && id !== st.mustOpen) return
      submit({ type: 'play', id, side: 'R' })
      return
    }
    const s = sidesFor(id, st.line)
    if (!s.L && !s.R) return
    if (s.L && !s.R) { submit({ type: 'play', id, side: 'L' }); return }
    if (s.R && !s.L) { submit({ type: 'play', id, side: 'R' }); return }
    setSel(id === sel ? null : id) // fits both ends — let the player choose
  }, [myTurn, veiled, st, sel, submit])

  const players = mp && Array.isArray(room.players) ? room.players : []
  const nameFor = (s) => {
    const p = players.find((x) => x.seat === s)
    if (p && p.name) return p.name
    if (!mp && playerName && s === 0) return playerName
    return `${t.player} ${s + 1}`
  }

  const handCount = (s) => (st.hands[String(s)] || []).length
  const res = st.result

  const banner = () => {
    if (st.phase === 'matchEnd') {
      return { tone: 'ok', text: `${nameFor(st.matchWinner)} ${t.won}` }
    }
    if (st.phase === 'roundEnd' && res) {
      if (res.kind === 'tie') return { tone: 'warn', text: t.byTie }
      const who = nameFor(res.winner)
      const why = res.kind === 'domino' ? `${who} ${t.byDomino}` : `${t.byBlocked} — ${who}`
      return { tone: 'ok', text: `${why} (+${res.points} ${t.gained})` }
    }
    if (mp && players.length < (st.playerCount || 2)) return { tone: '', text: t.waiting }
    if (st.mustOpen && myTurn) return { tone: 'warn', text: t.mustOpen }
    if (myTurn && !canAnything) return { tone: 'warn', text: t.pass2 }
    return null
  }
  const bn = banner()

  const seats = []
  for (let s = 0; s < (st.playerCount || 2); s++) seats.push(s)

  return (
    <div className="bgm-root" style={{ '--bgm-brand': brand }}>
      <div className="bgm-scorerow">
        {seats.map((s) => (
          <div key={s} className="bgm-score" data-active={st.phase === 'play' && st.turn === s ? '1' : '0'}>
            <b>{st.scores[String(s)] || 0}</b>
            <span>{nameFor(s)}{seat === s ? ` (${t.you})` : ''}</span>
            <i>{handCount(s)} {t.remaining}</i>
          </div>
        ))}
        <div className="bgm-score">
          <b>{st.roundNo || 1}</b>
          <span>{t.round}</span>
          <i>{t.boneyard}: {st.boneyard.length}</i>
        </div>
      </div>

      {bn ? (
        <div className="bgm-banner" data-tone={bn.tone}>
          <Icon name={st.phase === 'matchEnd' ? 'award' : 'notepad'} size={15} />
          <span>{bn.text}</span>
        </div>
      ) : (
        <div className="bgm-banner">
          <span>{seat === null ? t.spectator : myTurn ? t.yourTurn : `${t.theirTurn} ${nameFor(st.turn)}`}</span>
        </div>
      )}

      <div className="bgm-dom-stage">
        <div className="bgm-snake">
          {placed.length === 0 ? (
            <div className="bgm-snake-empty">{t.empty}</div>
          ) : (
            <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} role="img" aria-label={t.round}>
              {placed.map((p, i) => {
                const first = i === 0
                const last = i === placed.length - 1
                const a = p.flip ? p.b : p.a
                const b = p.flip ? p.a : p.b
                // the open pip of the first tile is `a`, of the last tile `b`;
                // a one-tile chain is both, so it gets both rings
                const marks = []
                if (first) marks.push(p.flip ? 0.5 : -0.5)
                if (last) marks.push(p.flip ? -0.5 : 0.5)
                return (
                  <g key={`${p.id}-${i}`} transform={`translate(${p.cx} ${p.cy}) rotate(${p.rot})`}>
                    <TileFace a={a} b={b} tone={st.last && st.last.id === p.id ? 'sel' : 'ivory'} />
                    {marks.map((mx) => (
                      <rect
                        key={mx}
                        x={mx - 0.46}
                        y="-0.46"
                        width="0.92"
                        height="0.92"
                        rx="0.13"
                        fill="none"
                        stroke="#34d399"
                        strokeWidth="0.075"
                      />
                    ))}
                  </g>
                )
              })}
            </svg>
          )}
        </div>

        <div className="bgm-ends">
          <button
            type="button"
            className="bgm-end bgm-press"
            data-live={sel && selSides.L ? '1' : '0'}
            disabled={!sel || !selSides.L}
            onClick={() => sel && selSides.L && submit({ type: 'play', id: sel, side: 'L' })}
          >
            <span className="bgm-end-pip">{ends.L === null ? '-' : ends.L}</span>
            {t.left}
          </button>
          <button
            type="button"
            className="bgm-end bgm-press"
            data-live={sel && selSides.R ? '1' : '0'}
            disabled={!sel || !selSides.R}
            onClick={() => sel && selSides.R && submit({ type: 'play', id: sel, side: 'R' })}
          >
            <span className="bgm-end-pip">{ends.R === null ? '-' : ends.R}</span>
            {t.right}
          </button>
        </div>

        <div style={{ position: 'relative' }}>
          <div className="bgm-hand">
            {hand.map((id) => {
              const [a, b] = pipsOf(id)
              const ok = st.line.length ? isPlayable(id, st.line) : !st.mustOpen || id === st.mustOpen
              return (
                <button
                  key={id}
                  type="button"
                  className="bgm-tile"
                  data-playable={ok && myTurn ? '1' : '0'}
                  data-sel={sel === id ? '1' : '0'}
                  disabled={!ok || !myTurn || veiled}
                  aria-label={`${a} ${b}`}
                  onClick={() => tapTile(id)}
                >
                  <svg viewBox="-0.58 -1.08 1.16 2.16" aria-hidden="true">
                    <g transform="rotate(90)">
                      <TileFace a={a} b={b} tone={ok && myTurn ? (sel === id ? 'sel' : 'ivory') : 'dim'} />
                    </g>
                  </svg>
                </button>
              )
            })}
            {hand.length === 0 ? <span className="bgm-seat-sub">{t.remaining}: 0</span> : null}
          </div>
          {veiled ? (
            <div
              className="bgm-veil"
              role="button"
              tabIndex={0}
              onClick={() => setRevealed(st.turn)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setRevealed(st.turn) }}
            >
              <div style={{ textAlign: 'center', fontSize: 12.5, fontWeight: 800, lineHeight: 1.9 }}>
                <div>{nameFor(st.turn)}</div>
                <div style={{ opacity: 0.7 }}>{t.reveal}</div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="bgm-strip">
          <button
            type="button"
            className="bgm-boneyard bgm-press"
            disabled={!myTurn || veiled || canAnything || !st.boneyard.length}
            onClick={() => submit({ type: 'draw' })}
          >
            <Icon name="package" size={15} />
            {t.draw} ({st.boneyard.length})
          </button>
          <button
            type="button"
            className="bgm-btn bgm-press"
            disabled={!myTurn || veiled || canAnything || st.boneyard.length > 0}
            onClick={() => submit({ type: 'pass' })}
          >
            <Icon name="next" size={14} />{t.pass}
          </button>
          {st.phase === 'roundEnd' ? (
            <button type="button" className="bgm-btn bgm-press" data-tone="brand" onClick={() => submit({ type: 'next' })}>
              <Icon name="play" size={14} />{t.nextRound}
            </button>
          ) : null}
          {st.phase === 'matchEnd' ? (
            <button type="button" className="bgm-btn bgm-press" data-tone="brand" onClick={() => submit({ type: 'reset' })}>
              <Icon name="reload" size={14} />{t.newMatch}
            </button>
          ) : null}
          {onExit ? (
            <button type="button" className="bgm-btn bgm-press" onClick={onExit}><Icon name="close" size={14} /></button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
