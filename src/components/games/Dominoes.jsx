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
//
// ===========================================================================
// PRESENTATION NOTES (read before touching the board)
// ===========================================================================
// · SIZING is ONE model with no breakpoints: a ResizeObserver measures the
//   shell and the felt, and everything downstream is a multiple of two numbers
//   written onto the root as --dmo-fs and --dmo-tile-h. That is what makes the
//   same markup fit a 360x640 phone and stay legible on a 1920x1080 venue TV.
// · THE SNAKE fits by SEARCH, not by guesswork: layoutSnake is run for every
//   candidate row width and the one that yields the LARGEST tile is kept, with
//   a bias towards fewer, fuller rows. Nothing is ever cropped and nothing
//   scrolls.
// · iOS SAFARI TRAP: an SVG child is NEVER positioned with a CSS transform
//   carrying px units — Safari does not resolve CSS px into SVG user space, so
//   the piece lands wrong or vanishes. Every transform inside an <svg> here is
//   the unitless attribute form, transform={`translate(${x} ${y})`}. The only
//   CSS transforms in dominoes.css run on plain HTML elements (the hand tiles
//   and the flying ghost).
// · TAP-STEALING TRAP: the whole chain is pointer-events:none. Only the two
//   open-end slots take taps, only when the selected tile legally fits them,
//   and their hit area is exactly their painted area.
// · SILENT-RULE TRAP: every rule that removes an option says so. The forced
//   opening double dims every other tile and names itself; a refused draw, a
//   refused pass and a tile that matches neither end each shake and print the
//   reason in the hint line.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { botMoveFor, botLabel, takeSoloIntent, BOT_DELAY_MS } from '../../lib/gameBots.js'
import { play } from '../../lib/gameSounds.js'
import '../../styles/boardgames.css'
import '../../styles/dominoes.css'

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

export function initialState(playerCount = 2, seed = null) {
  const count = Math.max(2, Math.min(4, Number(playerCount) || 2))
  const scores = {}
  for (let s = 0; s < count; s++) scores[String(s)] = 0
  return dealRound(
    {
      playerCount: count,
      target: TARGET,
      // `reduce` re-runs on every client, so any state it rebuilds must come
      // from a caller-supplied deterministic seed; only a genuinely local
      // first deal (no room involved) may draw randomness here.
      seed: Number.isInteger(seed) ? seed : Math.floor(Math.random() * 1e9),
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
  // A broken state is rebuilt DETERMINISTICALLY — never Math.random inside
  // reduce, or each client would fabricate a different board.
  const st = sane(state)
    ? state
    : initialState(2, (Math.imul((state && state.seed) || 1, 2654435761) + ((state && state.roundNo) || 0)) >>> 0)
  // TOTAL means total: a null / malformed move must return the state, not
  // throw. `reduce` runs inside the room transaction, where a thrown error
  // would abort a commit for every player at the table.
  const mv = move && typeof move === 'object' ? move : {}
  const type = mv.type ? mv.type : 'play'
  const seat = Number.isInteger(mv.seat)
    ? mv.seat
    : Number.isInteger(room && room.turn && room.turn.seat)
      ? room.turn.seat
      : st.turn

  // a fresh match is only offered once this one is decided — otherwise a losing
  // player could wipe the scores mid-match
  if (type === 'reset') {
    if (st.phase !== 'matchEnd') return { state: st }
    // Deterministic reseed: every client must deal the same fresh match.
    const fresh = initialState(st.playerCount, (Math.imul(st.seed || 1, 2654435761) + (st.roundNo || 0)) >>> 0)
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
        // Free-for-all between rounds: «الجولة التالية» renders for every seat
        // and the `next` branch accepts any of them, so pinning the turn to
        // one player (who may have left) silently rejected everyone else's tap.
        turn: null,
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

  const id = mv.id
  if (typeof id !== 'string' || hand.indexOf(id) < 0) return { state: st }
  const [pa, pb] = pipsOf(id)
  let line

  if (!st.line.length) {
    if (st.mustOpen && id !== st.mustOpen) return { state: st }
    line = [{ id, a: pa, b: pb }]
  } else {
    const side = mv.side === 'L' ? 'L' : mv.side === 'R' ? 'R' : null
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
    last: { seat, id, side: st.line.length ? mv.side : 'R' },
  }

  if (!rest.length) {
    const settled = settleRound(base, 'domino', seat)
    return {
      state: settled,
      // Between rounds any seat may deal on — see the blocked-round settle.
      turn: null,
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
   SNAKE LAYOUT
   A boustrophedon run that turns at the row edge, so a full twenty-eight-tile
   chain still fits one screen with nothing cropped. Units: a tile is 2 long
   and 1 wide, and a double lies crosswise, so it is 1 long and 2 wide.

   At a turn the tile is laid ACROSS the corner in the band between two rows:
   it hangs directly below the row's own end column, which is why it can never
   overlap the tile it follows. Row widths are always even integers, which keeps
   the running cursor integral — the previous layout could drop a corner tile
   straight on top of its neighbour when a row filled exactly.

   TWO PASSES, and the second one is the one that matters. A double stands
   CROSSWISE, so it is two units tall inside a row that is otherwise one unit
   tall. Spacing the rows by a constant therefore buried every double under the
   corner tile below it — measured, not assumed: a full twenty-eight tile chain
   produced overlapping tiles on a phone. Pass one fixes columns (which are
   y-independent), pass two walks the bands and gives each one the height its
   own tiles actually need.
   =========================================================================== */
const ROW_GAP = 0.2
const BOX_PAD = 0.38

function layoutSnake(line, rowW) {
  const n = line.length
  if (!n) return []

  // ---- pass 1: columns, orientation and band membership ----
  const items = []
  const bands = [{ tiles: [], corner: -1 }]
  let dir = 1
  let x = 0
  for (let i = 0; i < n; i += 1) {
    const tl = line[i]
    const dbl = tl.a === tl.b
    const len = dbl ? 1 : 2
    const fits = dir === 1 ? x + len <= rowW : x - len >= 0
    const band = bands[bands.length - 1]
    if (!fits && items.length) {
      // The corner tile belongs to the VERTICAL stretch: a plain tile stands on
      // end (rot 90, two units tall), a double lies flat across it (rot 0).
      band.corner = items.length
      items.push({ tl, cx: dir === 1 ? x - 0.5 : x + 0.5, rot: dbl ? 0 : 90, flip: false, half: dbl ? 0.5 : 1 })
      bands.push({ tiles: [], corner: -1 })
      dir = -dir
      continue
    }
    band.tiles.push(items.length)
    items.push({ tl, cx: x + (dir * len) / 2, rot: dbl ? 90 : 0, flip: dir === -1, half: dbl ? 1 : 0.5 })
    x += dir * len
  }

  // ---- pass 2: vertical placement from each band's real height ----
  const out = new Array(items.length)
  let top = 0
  for (let b = 0; b < bands.length; b += 1) {
    const band = bands[b]
    let half = 0.5
    for (const idx of band.tiles) if (items[idx].half > half) half = items[idx].half
    const cy = top + half
    for (const idx of band.tiles) {
      const it = items[idx]
      out[idx] = { ...it.tl, cx: it.cx, cy, rot: it.rot, flip: it.flip }
    }
    let bottom = cy + half
    if (band.corner >= 0) {
      const it = items[band.corner]
      out[band.corner] = { ...it.tl, cx: it.cx, cy: bottom + it.half, rot: it.rot, flip: it.flip }
      bottom += it.half * 2
    }
    top = bottom + ROW_GAP
  }
  return out
}

function boxOf(placed) {
  if (!placed.length) return { x: -1, y: -1, w: 2, h: 2 }
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
  return { x: x0 - BOX_PAD, y: y0 - BOX_PAD, w: x1 - x0 + BOX_PAD * 2, h: y1 - y0 + BOX_PAD * 2 }
}

// Pick the row width that draws the BIGGEST tile inside the measured felt, and
// among near-equal candidates prefer the widest row — fewer, fuller rows read
// better than a tall ladder. Exhaustive over a dozen candidates: exact, and far
// cheaper than one React render.
function fitSnake(nodes, feltW, feltH) {
  if (!nodes.length) return { placed: [], box: boxOf([]), rowW: 8, unit: 0 }
  const w = Math.max(60, feltW || 320)
  const h = Math.max(60, feltH || 320)
  let best = null
  for (let rowW = 6; rowW <= 40; rowW += 2) {
    const placed = layoutSnake(nodes, rowW)
    const box = boxOf(placed)
    const unit = Math.min(w / box.w, h / box.h)
    if (!best || unit > best.unit * 1.035) best = { placed, box, rowW, unit }
    else if (unit > best.unit * 0.965 && rowW > best.rowW) best = { placed, box, rowW, unit }
    // once one row holds the whole chain there is nothing wider to try
    if (box.h <= 2.2 + BOX_PAD * 2) break
  }
  return best
}

/* ---------- tile drawing (SVG, unit space: 2 wide, 1 tall, centred) ---------- */
const PD = 0.215
const PIP_XY = {
  0: [],
  1: [[0, 0]],
  2: [[-PD, -PD], [PD, PD]],
  3: [[-PD, -PD], [0, 0], [PD, PD]],
  4: [[-PD, -PD], [PD, -PD], [-PD, PD], [PD, PD]],
  5: [[-PD, -PD], [PD, -PD], [0, 0], [-PD, PD], [PD, PD]],
  6: [[-PD, -PD], [PD, -PD], [-PD, 0], [PD, 0], [-PD, PD], [PD, PD]],
}

// The shared gradient sheet. One per mounted game; every tile references it by
// id. Kept out of flow rather than display:none — Safari has dropped paint
// references out of a display:none subtree.
function Defs() {
  return (
    <svg className="dmo-defs" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="dmoIvory" x1="0.1" y1="0" x2="0.45" y2="1">
          <stop offset="0" stopColor="#fffdf5" />
          <stop offset="0.38" stopColor="#f7f1e0" />
          <stop offset="0.82" stopColor="#e6dcc4" />
          <stop offset="1" stopColor="#d3c8ad" />
        </linearGradient>
        <linearGradient id="dmoBevel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.15" />
          <stop offset="1" stopColor="#6f5a33" stopOpacity="0.45" />
        </linearGradient>
        <radialGradient id="dmoPip" cx="0.66" cy="0.72" r="0.8">
          <stop offset="0" stopColor="#4a5764" />
          <stop offset="0.5" stopColor="#1a232c" />
          <stop offset="1" stopColor="#060b10" />
        </radialGradient>
        <linearGradient id="dmoBack" x1="0.1" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#8a5c34" />
          <stop offset="0.45" stopColor="#5a381c" />
          <stop offset="1" stopColor="#33200f" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function Pips({ n, ox, detail }) {
  const list = PIP_XY[n] || []
  if (!list.length) return null
  return (
    <>
      {list.map(([px, py], i) => (
        <g key={i} transform={`translate(${ox + px} ${py})`}>
          <circle r="0.094" fill="url(#dmoPip)" />
          {detail ? (
            <path
              d="M -0.066 0.066 A 0.094 0.094 0 0 0 0.066 -0.066"
              fill="none"
              stroke="#ffffff"
              strokeOpacity="0.5"
              strokeWidth="0.02"
              strokeLinecap="round"
            />
          ) : null}
        </g>
      ))}
    </>
  )
}

// A physical domino in its own local frame: contact shadow on the felt, ivory
// body with a lit top bevel and a shaded bottom one, an engraved centre gutter
// and drilled pips. The caller supplies the placing transform.
function TileFace({ a, b, detail = true, shadow = true, glow = false }) {
  return (
    <>
      {shadow ? (
        <>
          <rect x="-1.02" y="-0.4" width="2.04" height="1.02" rx="0.18" fill="#000000" opacity="0.2" />
          <rect x="-0.98" y="-0.44" width="1.96" height="1.0" rx="0.15" fill="#000000" opacity="0.3" />
        </>
      ) : null}
      <rect x="-1" y="-0.5" width="2" height="1" rx="0.145" fill="url(#dmoIvory)" />
      <rect
        x="-0.962"
        y="-0.462"
        width="1.924"
        height="0.924"
        rx="0.115"
        fill="none"
        stroke="url(#dmoBevel)"
        strokeWidth="0.062"
      />
      <rect
        x="-1"
        y="-0.5"
        width="2"
        height="1"
        rx="0.145"
        fill="none"
        stroke="#3a2c18"
        strokeOpacity="0.5"
        strokeWidth="0.026"
      />
      <line x1="-0.014" y1="-0.37" x2="-0.014" y2="0.37" stroke="#4a3c26" strokeOpacity="0.42" strokeWidth="0.042" strokeLinecap="round" />
      <line x1="0.03" y1="-0.37" x2="0.03" y2="0.37" stroke="#ffffff" strokeOpacity="0.72" strokeWidth="0.03" strokeLinecap="round" />
      <Pips n={a} ox={-0.5} detail={detail} />
      <Pips n={b} ox={0.5} detail={detail} />
      {glow ? (
        <rect x="-1" y="-0.5" width="2" height="1" rx="0.145" fill="none" stroke="#e7c46a" strokeWidth="0.05" />
      ) : null}
    </>
  )
}

// Face-down tile: walnut back with an inlaid gold lozenge. Used for the seats a
// spectator may not see into and for the boneyard stack.
function TileBack({ shadow = true }) {
  return (
    <>
      {shadow ? <rect x="-0.98" y="-0.42" width="1.96" height="1.0" rx="0.15" fill="#000000" opacity="0.3" /> : null}
      <rect x="-1" y="-0.5" width="2" height="1" rx="0.145" fill="url(#dmoBack)" />
      <rect
        x="-0.955"
        y="-0.455"
        width="1.91"
        height="0.91"
        rx="0.11"
        fill="none"
        stroke="#e7c46a"
        strokeOpacity="0.42"
        strokeWidth="0.03"
      />
      <path d="M 0 -0.24 L 0.3 0 L 0 0.24 L -0.3 0 Z" fill="#e7c46a" fillOpacity="0.3" />
      <rect x="-1" y="-0.5" width="2" height="1" rx="0.145" fill="none" stroke="#1c1109" strokeOpacity="0.6" strokeWidth="0.026" />
    </>
  )
}

// A hand / mini tile stood on end. Its own <svg> so it can live inside a button.
function StandingTile({ a, b, detail = true, back = false, className }) {
  return (
    <svg viewBox="-0.62 -1.12 1.24 2.24" className={className} aria-hidden="true" focusable="false">
      <g transform="rotate(90)">
        {back ? <TileBack /> : <TileFace a={a} b={b} detail={detail} />}
      </g>
    </svg>
  )
}

/* ===========================================================================
   TEXT — Arabic first, English alongside. Latin digits everywhere.
   =========================================================================== */
const TXT = {
  ar: {
    you: 'أنت',
    player: 'لاعب',
    bot: 'الكمبيوتر',
    spectator: 'أنت متفرّج',
    watchHand: 'يد',
    waiting: 'بانتظار بقية اللاعبين',
    round: 'الجولة',
    store: 'المخزن',
    tiles: 'أحجار',
    emptyTitle: 'الرقعة فارغة',
    emptyHint: 'الجولة تُفتح بحجر من يدك',
    left: 'اليسار',
    right: 'اليمين',
    draw: 'سحب',
    pass: 'تمرير',
    openAny: 'ابدأ الجولة — اختر أي حجر من يدك',
    openWith: 'الجولة الأولى تُفتح بأعلى دبل — العب',
    pickTile: 'اختر حجراً يطابق',
    or: 'أو',
    pickEnd: 'الحجر يناسب الطرفين — اختر طرفاً',
    drawing: 'لا حجر صالح — نسحب من المخزن',
    mustPass: 'المخزن فارغ ولا حجر صالح — مرّر',
    turnOf: 'الدور على',
    watchOnly: 'أنت متفرّج — تتابع اللعب فقط',
    whyNoFit: 'لا يطابق الطرفين',
    whyDraw: 'عندك حجر صالح — لا يجوز السحب',
    whyPass: 'المخزن فيه أحجار — اسحب قبل أن تمرّر',
    whyMustOpen: 'أول جولة: يلزم الفتح بأعلى دبل',
    notTurn: 'ليس دورك بعد',
    roundOver: 'انتهت الجولة',
    matchOver: 'انتهت المباراة',
    byDomino: 'أنزل آخر أحجاره',
    byBlocked: 'انسدّ اللعب — الفوز لأقل مجموع',
    byTie: 'انسدّ اللعب وتساوى الأقل — لا نقاط',
    remainTitle: 'ما تبقّى في الأيدي',
    scoreTitle: 'الحساب إلى',
    nextRound: 'الجولة التالية',
    newMatch: 'مباراة جديدة',
    leave: 'خروج',
    won: 'كسب المباراة',
    clean: 'لا شيء',
  },
  en: {
    you: 'You',
    player: 'Player',
    bot: 'Computer',
    spectator: 'Spectating',
    watchHand: 'Hand of',
    waiting: 'Waiting for players',
    round: 'Round',
    store: 'Boneyard',
    tiles: 'tiles',
    emptyTitle: 'Empty board',
    emptyHint: 'Open the round with a tile from your hand',
    left: 'Left',
    right: 'Right',
    draw: 'Draw',
    pass: 'Pass',
    openAny: 'Open the round — pick any tile',
    openWith: 'The first round opens on the highest double — play',
    pickTile: 'Pick a tile matching',
    or: 'or',
    pickEnd: 'It fits both ends — pick one',
    drawing: 'Nothing playable — drawing from the boneyard',
    mustPass: 'Boneyard empty and nothing playable — pass',
    turnOf: 'Turn of',
    watchOnly: 'You are watching this table',
    whyNoFit: 'matches neither end',
    whyDraw: 'You hold a playable tile — you may not draw',
    whyPass: 'The boneyard still has tiles — draw first',
    whyMustOpen: 'First round: you must open on the highest double',
    notTurn: 'Not your turn yet',
    roundOver: 'Round over',
    matchOver: 'Match over',
    byDomino: 'played the last tile',
    byBlocked: 'Blocked — lowest pip count wins',
    byTie: 'Blocked and tied — no points',
    remainTitle: 'Tiles left in hand',
    scoreTitle: 'Score to',
    nextRound: 'Next round',
    newMatch: 'New match',
    leave: 'Leave',
    won: 'wins the match',
    clean: 'none',
  },
}

const FLY_MS = 400
const NUDGE_MS = 2600
const reduced = () => {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch (_) { return false }
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
  isHost = false,
  // «العب ضد الكمبيوتر»: one to three machine seats. The player is always seat
  // zero, so the seat count of a solo match is soloBots + 1.
  soloBots = null,
}) {
  const ar = lang !== 'en'
  const t = TXT[ar ? 'ar' : 'en']
  const fmt = useCallback((n) => {
    const v = Number(n) || 0
    try { return v.toLocaleString(ar ? 'ar-SA-u-nu-latn' : 'en-US') } catch (_) { return String(v) }
  }, [ar])
  const mp = !!room
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])

  // Latched on the first render and never recomputed: the lobby's hand-off
  // expires after a minute, and re-reading it every render would silently turn
  // a bot match back into a hot-seat match mid-match.
  const [bots] = useState(() => {
    if (mp) return 0
    const n = Number(soloBots)
    if (Number.isFinite(n) && n > 0) return Math.max(1, Math.min(3, n))
    const it = takeSoloIntent(GAME_ID)
    return it ? Math.max(1, Math.min(3, Number(it.bots) || 1)) : 0
  })
  const vsBot = bots > 0

  const [local, setLocal] = useState(() => {
    const saved = resumeState && resumeState.game === GAME_ID && resumeState.state
    // A saved hot-seat match must not be resumed into a bot match with a
    // different seat count — that would deal the player somebody else's hand.
    if (!vsBot && sane(saved)) return saved
    return initialState(vsBot ? bots + 1 : 2)
  })
  const st = useMemo(() => {
    const raw = mp ? room.state : local
    // Stand-in board for a playing room whose state is broken: seed 1, a
    // constant, so every client fabricates the SAME fallback instead of four
    // different random ones.
    return sane(raw) ? raw : initialState(mp && Array.isArray(room.players) ? room.players.length : 2, 1)
  }, [mp, room, local])

  // Hot-seat play passes the phone, so the acting seat follows the turn.
  // Against the computer the player keeps seat zero for the whole match.
  const seat = mp ? (Number.isInteger(mySeat) ? mySeat : null) : (vsBot ? 0 : st.turn)
  const watcher = mp && seat === null
  const myTurn = st.phase === 'play' && seat !== null && seat === st.turn

  // single-device play hides the hand between turns — but there is nobody to
  // hide it from when the other seats are machines
  const [revealed, setRevealed] = useState(() => (mp ? null : st.turn))
  const veiled = !mp && !vsBot && st.phase === 'play' && revealed !== st.turn

  const [sel, setSel] = useState(null)
  const [nudge, setNudge] = useState(null)   // { id, text, n } — a refused action
  const [fly, setFly] = useState(null)       // the ghost tile in flight
  const nudgeTimer = useRef(null)
  const flyTimer = useRef(null)
  const flyKey = useRef(0)

  const rootRef = useRef(null)
  const feltRef = useRef(null)
  const railRef = useRef(null)
  const boneRef = useRef(null)
  const handRefs = useRef({})
  const chainRefs = useRef({})
  const seatRefs = useRef({})
  const srcRef = useRef(null)   // rect captured the instant a tile was tapped

  useEffect(() => () => {
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current)
    if (flyTimer.current) clearTimeout(flyTimer.current)
  }, [])

  /* ---- measurement: one ResizeObserver, two numbers, no breakpoints ------ */
  const [box, setBox] = useState({ w: 390, h: 720, fw: 350, fh: 430 })
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return undefined
    let raf = 0
    const read = () => {
      raf = 0
      const r = root.getBoundingClientRect()
      const f = feltRef.current ? feltRef.current.getBoundingClientRect() : null
      const next = {
        w: Math.round(r.width) || 390,
        h: Math.round(r.height) || 720,
        fw: Math.round(f && f.width ? f.width : r.width * 0.9),
        fh: Math.round(f && f.height ? f.height : r.height * 0.5),
      }
      setBox((prev) => (
        prev.w === next.w && prev.h === next.h && prev.fw === next.fw && prev.fh === next.fh ? prev : next
      ))
    }
    const ro = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(read) })
    ro.observe(root)
    if (feltRef.current) ro.observe(feltRef.current)
    read()
    return () => { ro.disconnect(); if (raf) cancelAnimationFrame(raf) }
  }, [])

  const hand = useMemo(() => {
    const owner = (mp || vsBot) ? seat : st.turn
    if (owner === null) return []
    const raw = st.hands[String(owner)] || []
    // display order only — heaviest first, so a hand reads at a glance and a
    // freshly drawn tile lands somewhere predictable
    return raw.slice().sort((x, y) => {
      const d = tileWeight(y) - tileWeight(x)
      if (d) return d
      return pipsOf(y)[0] - pipsOf(x)[0]
    })
  }, [mp, vsBot, seat, st])

  const metrics = useMemo(() => {
    const w = box.w || 390
    const h = box.h || 720
    const wide = w >= 900 && w > h * 1.15
    const fs = Math.max(9.5, Math.min(34, Math.sqrt(w * h) / (wide ? 42 : 40)))
    const pad = Math.round(fs * 0.55)
    const n = Math.max(5, hand.length || 5)
    // Integer gap FIRST, then derive the tile from what is actually left: a
    // fractional gap plus a rounded-up tile overflowed the rail by a couple of
    // pixels, and an overflowing centred flex row is unreachable at its leading
    // edge — the first tile would have been quietly clipped on a phone.
    const gap = Math.max(2, Math.round(n > 8 ? fs * 0.22 : fs * 0.42))
    const avail = w - pad * 2 - Math.max(8, fs * 0.9)
    const fromW = ((avail - (n - 1) * gap) / n) * 2
    const floor = Math.max(34, fs * 3)
    const want = Math.max(floor, Math.min(fromW, h * (wide ? 0.24 : 0.2), fs * 9))
    // even, so the tile's own half-width stays whole and nothing accumulates
    const tile = Math.max(30, 2 * Math.floor(want / 2))
    return { w, h, wide, fs, pad, gap, tile }
  }, [box.w, box.h, hand.length])

  const ends = endsOf(st.line)
  const selSides = sel ? sidesFor(sel, st.line) : { L: false, R: false }
  const canAnything = hasPlayable(hand, st.line)

  // The chain, plus a dashed slot at each open end. The slots live in the same
  // flow so the geometry never jumps when they light up, and they are the ONLY
  // things on the felt that take a tap.
  const nodes = useMemo(() => {
    const line = st.line || []
    if (!line.length) return []
    return [{ id: '~L', a: -1, b: line[0].a, slot: 'L' }]
      .concat(line)
      .concat([{ id: '~R', a: line[line.length - 1].b, b: -1, slot: 'R' }])
  }, [st.line])

  const snake = useMemo(() => fitSnake(nodes, box.fw, box.fh), [nodes, box.fw, box.fh])
  const placed = snake.placed
  const view = snake.box
  const unitPx = snake.unit || 0
  const fineDetail = unitPx * 2 >= 58

  // drop a stale selection whenever the chain changes underneath us
  const lineRef = useRef(-1)
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

  const refuse = useCallback((id, text) => {
    play('move', { gain: 0.45 })
    setNudge((prev) => ({ id, text, n: (prev ? prev.n : 0) + 1 }))
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current)
    nudgeTimer.current = setTimeout(() => setNudge(null), NUDGE_MS)
  }, [])

  /* ---- the flying ghost -------------------------------------------------- */
  const startFly = useCallback((src, dstEl, content) => {
    if (!src || !dstEl || typeof dstEl.getBoundingClientRect !== 'function') return false
    const d = dstEl.getBoundingClientRect()
    if (!d.width || !d.height || !src.width || !src.height) return false
    const dx = (src.left + src.width / 2) - (d.left + d.width / 2)
    const dy = (src.top + src.height / 2) - (d.top + d.height / 2)
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return false
    const sLong = Math.max(src.width, src.height)
    const dLong = Math.max(d.width, d.height)
    const sc = dLong > 0 ? Math.max(0.15, Math.min(5, sLong / dLong)) : 1
    const srcUp = src.height >= src.width
    const dstUp = d.height >= d.width
    const rot = srcUp === dstUp ? 0 : (srcUp ? -90 : 90)
    flyKey.current += 1
    setFly({
      key: flyKey.current,
      left: d.left, top: d.top, width: d.width, height: d.height,
      dx, dy, rot, sc, up: dstUp, ...content,
    })
    if (flyTimer.current) clearTimeout(flyTimer.current)
    flyTimer.current = setTimeout(() => setFly(null), reduced() ? 30 : FLY_MS + 30)
    return true
  }, [])

  /* ---- one reactor for motion AND sound.
     Runs after layout so the destination is already in the DOM, and is guarded
     by a snapshot so nothing fires on mount or on a room rehydration. -------- */
  const beat = useRef(null)
  useLayoutEffect(() => {
    const owner = (mp || vsBot) ? seat : st.turn
    const cur = {
      lineN: (st.line || []).length,
      boneN: (st.boneyard || []).length,
      phase: st.phase,
      turn: st.turn,
      roundNo: st.roundNo || 1,
      owner,
      handKey: hand.join(','),
      lastId: st.last ? st.last.id : null,
      lastSeat: st.last ? st.last.seat : null,
    }
    const prev = beat.current
    beat.current = cur
    if (!prev) return
    const soft = reduced()

    if (cur.roundNo !== prev.roundNo) {
      setFly(null)
      play('deal')
      return
    }
    if (cur.phase !== prev.phase && (cur.phase === 'roundEnd' || cur.phase === 'matchEnd')) {
      // The sheet slides straight over the board, so the winning tile does not
      // get to fly — but it still has to be HEARD landing before the sting, or
      // the round appears to end on nothing.
      setFly(null)
      const won = cur.lineN > prev.lineN
      if (won) play('card')
      const w = cur.phase === 'matchEnd' ? st.matchWinner : (st.result ? st.result.winner : null)
      const mine = w !== null && w === seat
      setTimeout(() => play(mine ? 'win' : 'lose', { gain: mine ? 0.7 : 0.4 }), won ? 240 : 0)
      return
    }

    // a tile was laid: fly it from wherever it came from onto its place
    if (cur.lineN > prev.lineN && cur.lastId) {
      const dst = chainRefs.current[cur.lastId]
      const src = srcRef.current && srcRef.current.id === cur.lastId
        ? srcRef.current.rect
        : (seatRefs.current[cur.lastSeat] ? seatRefs.current[cur.lastSeat].getBoundingClientRect() : null)
      srcRef.current = null
      const spot = placed.find((p) => p.id === cur.lastId)
      const flew = !soft && spot && startFly(src, dst, {
        kind: 'tile',
        a: spot.flip ? spot.b : spot.a,
        b: spot.flip ? spot.a : spot.b,
        rot90: spot.rot === 90,
      })
      if (flew) setTimeout(() => play('card'), FLY_MS - 60)
      else play('card')
      return
    }

    // a tile was drawn from the boneyard
    if (cur.boneN < prev.boneN) {
      play('dice', { gain: 0.55 })
      if (soft) return
      const drewMine = cur.owner === prev.owner && cur.handKey !== prev.handKey
      const src = boneRef.current ? boneRef.current.getBoundingClientRect() : null
      let dst = null
      if (drewMine) {
        const before = new Set(prev.handKey ? prev.handKey.split(',') : [])
        const added = hand.find((id) => !before.has(id))
        if (added) {
          dst = handRefs.current[added] || null
          if (dst && railRef.current) {
            const rail = railRef.current
            const target = dst.offsetLeft - rail.clientWidth / 2 + dst.offsetWidth / 2
            if (Math.abs(rail.scrollLeft - target) > 4) rail.scrollLeft = target
          }
        }
      } else if (Number.isInteger(st.turn)) {
        dst = seatRefs.current[st.turn] || null
      }
      startFly(src, dst, { kind: 'back' })
      return
    }

    if (cur.turn !== prev.turn && cur.phase === 'play' && cur.turn === seat && (mp || vsBot)) {
      play('turn', { gain: 0.8 })
    }
  }, [st, seat, mp, vsBot, hand, placed, startFly])

  // reveal the new player's hand only after they acknowledge the handover
  useEffect(() => { if (mp) return; if (st.phase !== 'play') setRevealed(st.turn) }, [mp, st.phase, st.turn])

  // ---- machine seats ------------------------------------------------------
  // Every bot move is chosen by src/lib/gameBots.js and validated by THIS
  // file's `reduce` before it is returned, so a machine seat is bound by the
  // same rulebook as the player. The bot reads only its own hand and the chain;
  // it never looks at the tiles the other seats hold, even though the shared
  // state object physically contains them.
  //
  // Round and match transitions are NOT automated: the player taps «الجولة
  // التالية» so the result screen is actually read before the board resets.
  useEffect(() => {
    if (!vsBot || st.phase !== 'play') return undefined
    if (st.turn === 0) return undefined
    const id = setTimeout(() => {
      const mv = botMoveFor(GAME_ID, st, st.turn, { reduce, room: null })
      if (!mv) return
      setLocal((prev) => reduce(prev, { ...mv, seat: prev.turn }, null).state)
    }, st.drew ? Math.round(BOT_DELAY_MS * 0.45) : BOT_DELAY_MS)
    return () => clearTimeout(id)
  }, [vsBot, st])

  // ---- AUTO-DRAW ----------------------------------------------------------
  // The rules force a player with nothing playable to keep drawing, and a bad
  // hand can need fourteen of them. Tapping fourteen times is not a decision,
  // it is a chore, so the table draws for you at a pace you can actually watch:
  // the first tile after half a second, the rest a little quicker. The manual
  // draw button stays live for anyone who wants to go faster.
  const actor = mp ? seat : (vsBot ? 0 : st.turn)
  const autoDraw = st.phase === 'play' && actor !== null && actor === st.turn && !veiled &&
    !watcher && st.boneyard.length > 0 && !canAnything
  useEffect(() => {
    if (!autoDraw) return undefined
    const id = setTimeout(() => submit({ type: 'draw' }), st.drew ? 320 : 520)
    return () => clearTimeout(id)
  }, [autoDraw, st.drew, st.boneyard.length, submit])

  useEffect(() => {
    // Saved progress is a hot-seat convenience ONLY: persisting a bot match
    // resumed it later as pass-the-phone, handing the machine seats' tiles to
    // phantom humans.
    if (!mp && !vsBot) onProgressRef.current?.({ game: GAME_ID, state: st })
    const mine = Number.isInteger(seat) ? st.scores[String(seat)] : null
    if (Number.isInteger(mine)) onScoreRef.current?.(mine)
  }, [st, mp, vsBot, seat])

  /* ---- input ------------------------------------------------------------- */
  const grab = useCallback((id) => {
    const el = handRefs.current[id]
    if (el) srcRef.current = { id, rect: el.getBoundingClientRect() }
  }, [])

  const tapTile = useCallback((id) => {
    if (veiled || watcher) return
    if (!myTurn) { refuse(id, t.notTurn); return }
    const [a, b] = pipsOf(id)
    if (!st.line.length) {
      if (st.mustOpen && id !== st.mustOpen) {
        refuse(id, `${t.whyMustOpen} (${fmt(pipsOf(st.mustOpen)[0])}|${fmt(pipsOf(st.mustOpen)[1])})`)
        return
      }
      grab(id)
      submit({ type: 'play', id, side: 'R' })
      play('click', { gain: 0.5 })
      return
    }
    const s = sidesFor(id, st.line)
    if (!s.L && !s.R) {
      refuse(id, `${fmt(a)}|${fmt(b)} ${t.whyNoFit} (${fmt(ends.L)} / ${fmt(ends.R)})`)
      return
    }
    if (s.L !== s.R) {
      grab(id)
      submit({ type: 'play', id, side: s.L ? 'L' : 'R' })
      play('click', { gain: 0.5 })
      return
    }
    play('click', { gain: 0.45 })
    setSel(id === sel ? null : id) // fits both ends — let the player choose
  }, [veiled, watcher, myTurn, st, sel, submit, refuse, grab, t, ends, fmt])

  const playSide = useCallback((side) => {
    if (!sel || !myTurn) return
    if (!selSides[side]) return
    grab(sel)
    submit({ type: 'play', id: sel, side })
    play('click', { gain: 0.5 })
  }, [sel, myTurn, selSides, submit, grab])

  const tapDraw = useCallback(() => {
    if (!myTurn || veiled || watcher) return
    if (canAnything) { refuse(null, t.whyDraw); return }
    if (!st.boneyard.length) { refuse(null, t.mustPass); return }
    submit({ type: 'draw' })
  }, [myTurn, veiled, watcher, canAnything, st.boneyard.length, submit, refuse, t])

  const tapPass = useCallback(() => {
    if (!myTurn || veiled || watcher) return
    if (canAnything) { refuse(null, t.whyDraw); return }
    if (st.boneyard.length) { refuse(null, t.whyPass); return }
    submit({ type: 'pass' })
  }, [myTurn, veiled, watcher, canAnything, st.boneyard.length, submit, refuse, t])

  /* ---- names, seats ------------------------------------------------------ */
  const players = mp && Array.isArray(room.players) ? room.players : []
  const nameFor = useCallback((s) => {
    const p = players.find((x) => x.seat === s)
    if (p && p.name) return p.name
    if (vsBot && s > 0) return botLabel(s - 1, bots, lang)
    if (!mp && playerName && s === 0) return playerName
    return `${t.player} ${fmt(s + 1)}`
  }, [players, vsBot, bots, lang, mp, playerName, t, fmt])
  const isBotSeat = (s) => vsBot && s > 0
  const handCount = (s) => (st.hands[String(s)] || []).length
  const seats = useMemo(() => {
    const out = []
    for (let s = 0; s < (st.playerCount || 2); s++) out.push(s)
    return out
  }, [st.playerCount])

  /* ---- the one hint line: it always says what is expected NOW ------------- */
  const hint = useMemo(() => {
    if (nudge) return { tone: 'warn', text: nudge.text, icon: 'warning' }
    if (st.phase === 'roundEnd') return { tone: '', text: t.roundOver, icon: 'award' }
    if (st.phase === 'matchEnd') return { tone: '', text: t.matchOver, icon: 'award' }
    if (mp && players.length < (st.playerCount || 2)) return { tone: 'wait', text: t.waiting, icon: 'clock' }
    if (watcher) return { tone: 'wait', text: `${t.watchOnly} — ${t.turnOf} ${nameFor(st.turn)}`, icon: 'eye' }
    if (veiled) return { tone: 'wait', text: `${t.turnOf} ${nameFor(st.turn)}`, icon: 'lock' }
    if (!myTurn) return { tone: 'wait', text: `${t.turnOf} ${nameFor(st.turn)}`, icon: 'clock' }
    if (st.mustOpen) {
      const [a, b] = pipsOf(st.mustOpen)
      return { tone: 'warn', text: `${t.openWith} ${fmt(a)}|${fmt(b)}`, icon: 'star' }
    }
    if (!st.line.length) return { tone: 'go', text: t.openAny, icon: 'play' }
    if (!canAnything) {
      if (st.boneyard.length) return { tone: 'warn', text: `${t.drawing} (${fmt(st.boneyard.length)})`, icon: 'package' }
      return { tone: 'warn', text: t.mustPass, icon: 'next' }
    }
    if (sel) return { tone: 'go', text: t.pickEnd, icon: 'arrowLeftRight' }
    return { tone: 'go', text: `${t.pickTile} ${fmt(ends.L)} ${t.or} ${fmt(ends.R)}`, icon: 'check' }
  }, [nudge, st, mp, players.length, watcher, veiled, myTurn, canAnything, sel, ends, t, nameFor, fmt])

  /* ---- round / match result ---------------------------------------------- */
  const over = st.phase === 'roundEnd' || st.phase === 'matchEnd'
  const res = st.result

  const resultHead = () => {
    if (st.phase === 'matchEnd') return `${nameFor(st.matchWinner)} ${t.won}`
    if (!res) return t.roundOver
    if (res.kind === 'tie') return t.byTie
    if (res.kind === 'domino') return `${nameFor(res.winner)} ${t.byDomino}`
    return `${t.byBlocked} — ${nameFor(res.winner)}`
  }

  const target = st.target || TARGET
  const cssVars = {
    '--dmo-brand': brand,
    '--dmo-fs': `${metrics.fs.toFixed(2)}px`,
    '--dmo-pad': `${metrics.pad}px`,
    '--dmo-tile-h': `${metrics.tile}px`,
    '--dmo-hand-gap': `${metrics.gap}px`,
  }

  return (
    <div className="dmo-root" ref={rootRef} dir={ar ? 'rtl' : 'ltr'} data-rtl={ar ? '1' : '0'} style={cssVars}>
      <Defs />

      {/* ---------- 1. who is at the table ---------- */}
      <div className="dmo-seats" data-tight={seats.length > 2 ? '1' : '0'}>
        {seats.map((s) => (
          <div
            key={s}
            className="dmo-seat"
            ref={(el) => { if (el) seatRefs.current[s] = el; else delete seatRefs.current[s] }}
            data-active={st.phase === 'play' && st.turn === s ? '1' : '0'}
            data-me={seat === s ? '1' : '0'}
            data-bot={isBotSeat(s) ? '1' : '0'}
          >
            <span className="dmo-seat-mark" aria-hidden="true">
              {isBotSeat(s) ? <Icon name="zap" size={12} /> : String(nameFor(s)).trim().charAt(0)}
            </span>
            <span className="dmo-seat-id">
              <span className="dmo-seat-name">{nameFor(s)}{seat === s ? ` · ${t.you}` : ''}</span>
              <span className="dmo-seat-sub">
                <Icon name="layers" size={11} />
                {fmt(handCount(s))}
              </span>
            </span>
            <b className="dmo-seat-score">{fmt(st.scores[String(s)] || 0)}</b>
          </div>
        ))}
      </div>

      {/* ---------- 2. the table ---------- */}
      <div className="dmo-table">
        <div className="dmo-felt" ref={feltRef}>
          <div className="dmo-round">
            <span>{t.round} <b>{fmt(st.roundNo || 1)}</b></span>
            <span className="dmo-round-sep" aria-hidden="true" />
            <span>{t.store} <b>{fmt(st.boneyard.length)}</b></span>
          </div>

          {placed.length ? (
            <svg
              className="dmo-chain"
              viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={`${t.round} ${fmt(st.roundNo || 1)}`}
            >
              {placed.map((p) => {
                const da = p.flip ? p.b : p.a
                const db = p.flip ? p.a : p.b
                const tf = `translate(${p.cx} ${p.cy}) rotate(${p.rot})`
                if (p.slot) {
                  const live = !!sel && !!selSides[p.slot] && myTurn && !veiled
                  // what the selected tile would look like sitting here
                  let pa = da
                  let pb = db
                  if (live) {
                    const [xa, xb] = pipsOf(sel)
                    const join = p.slot === 'L' ? ends.L : ends.R
                    const other = xa === join ? xb : xa
                    if (p.slot === 'L') { pa = p.flip ? join : other; pb = p.flip ? other : join }
                    else { pa = p.flip ? other : join; pb = p.flip ? join : other }
                  }
                  return (
                    <g
                      key={p.id}
                      className="dmo-slot"
                      data-live={live ? '1' : '0'}
                      transform={tf}
                      onClick={live ? () => playSide(p.slot) : undefined}
                      role={live ? 'button' : undefined}
                      aria-label={p.slot === 'L' ? t.left : t.right}
                    >
                      <rect
                        x="-1" y="-0.5" width="2" height="1" rx="0.145"
                        fill={live ? '#6ee7b7' : '#ffffff'}
                        fillOpacity={live ? 0.16 : 0.05}
                        stroke={live ? '#6ee7b7' : '#e7c46a'}
                        strokeOpacity={live ? 0.95 : 0.34}
                        strokeWidth="0.05"
                        strokeDasharray="0.17 0.13"
                        className={live ? 'dmo-endring' : undefined}
                      />
                      {live ? (
                        <g opacity="0.62">
                          <Pips n={pa} ox={-0.5} detail={false} />
                          <Pips n={pb} ox={0.5} detail={false} />
                        </g>
                      ) : (
                        <>
                          <Pips n={da >= 0 ? da : 0} ox={-0.5} detail={false} />
                          <Pips n={db >= 0 ? db : 0} ox={0.5} detail={false} />
                        </>
                      )}
                    </g>
                  )
                }
                const fresh = !!st.last && st.last.id === p.id
                return (
                  <g
                    key={p.id}
                    ref={(el) => { if (el) chainRefs.current[p.id] = el; else delete chainRefs.current[p.id] }}
                    transform={tf}
                    opacity={fly && fly.kind === 'tile' && st.last && st.last.id === p.id ? 0 : 1}
                  >
                    <TileFace a={da} b={db} detail={fineDetail} glow={fresh} />
                    {fresh ? (
                      <rect x="-1" y="-0.5" width="2" height="1" rx="0.145" fill="#e7c46a" className="dmo-fresh" />
                    ) : null}
                  </g>
                )
              })}
            </svg>
          ) : (
            <div className="dmo-empty">
              <div className="dmo-empty-in">
                <svg viewBox="-2.4 -1.2 4.8 2.4" aria-hidden="true">
                  <g transform="translate(-1.15 0)"><TileFace a={6} b={6} /></g>
                  <g transform="translate(1.15 0)"><TileFace a={6} b={3} /></g>
                </svg>
                <b>{t.emptyTitle}</b>
                <span>{t.emptyHint}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------- 3. the action bar ---------- */}
      <div className="dmo-bar">
        <div className="dmo-line">
          <div className="dmo-hint" data-tone={hint.tone} aria-live="polite">
            <Icon name={hint.icon} size={13} />
            <span>{hint.text}</span>
          </div>
          {!watcher ? (
            <>
              <button
                type="button"
                className="dmo-act dmo-bone"
                ref={boneRef}
                data-armed={myTurn && !canAnything && st.boneyard.length ? '1' : '0'}
                disabled={!myTurn || veiled || !st.boneyard.length}
                onClick={tapDraw}
                aria-label={`${t.draw} (${fmt(st.boneyard.length)})`}
              >
                <svg viewBox="-0.75 -1.2 1.5 2.4" aria-hidden="true">
                  <g transform="translate(-0.13 -0.1) rotate(90)"><TileBack /></g>
                  <g transform="translate(0.13 0.1) rotate(90)"><TileBack /></g>
                </svg>
                <span className="dmo-act-n">{fmt(st.boneyard.length)}</span>
              </button>
              <button
                type="button"
                className="dmo-act"
                disabled={!myTurn || veiled || canAnything || st.boneyard.length > 0}
                onClick={tapPass}
                aria-label={t.pass}
              >
                <Icon name="next" size={13} />
                <span className="dmo-act-lbl">{t.pass}</span>
              </button>
            </>
          ) : (
            <span className="dmo-watch"><Icon name="eye" size={13} />{t.spectator}</span>
          )}
        </div>

        {!watcher ? (
          <div className="dmo-ends">
            {['L', 'R'].map((side) => {
              const live = !!sel && !!selSides[side] && myTurn && !veiled
              const dead = !!sel && !selSides[side]
              const pip = side === 'L' ? ends.L : ends.R
              return (
                <button
                  key={side}
                  type="button"
                  className="dmo-end"
                  data-live={live ? '1' : '0'}
                  data-dead={dead ? '1' : '0'}
                  disabled={!live}
                  onClick={() => playSide(side)}
                >
                  <span className="dmo-end-pip">{pip === null ? '-' : fmt(pip)}</span>
                  <span className="dmo-end-lbl">{side === 'L' ? t.left : t.right}</span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* ---------- 4. the hand ---------- */}
      <div className="dmo-handwrap">
        {watcher ? (
          // A viewer holding no seat NEVER sees a private hand and gets no
          // control that implies they may act.
          <div className="dmo-backs" aria-label={`${t.watchHand} ${nameFor(st.turn)}`}>
            {Array.from({ length: Math.min(9, Math.max(1, handCount(st.turn))) }).map((_, i) => (
              <StandingTile key={i} back />
            ))}
            <span className="dmo-backs-lbl">{t.watchHand} {nameFor(st.turn)} · {fmt(handCount(st.turn))}</span>
          </div>
        ) : (
          <div className="dmo-hand" ref={railRef} data-idle={myTurn && !veiled ? '0' : '1'}>
            {hand.map((id) => {
              const [a, b] = pipsOf(id)
              // Once the round-end sheet is up the hand is no longer a control:
              // grey every tile and make the buttons inert so they neither read
              // as playable nor stay keyboard-focusable behind the modal.
              const ok = over ? false : (st.line.length ? isPlayable(id, st.line) : (!st.mustOpen || id === st.mustOpen))
              const forced = !!st.mustOpen && id === st.mustOpen && myTurn
              const shaking = nudge && nudge.id === id
              return (
                <button
                  key={id}
                  type="button"
                  className="dmo-tile"
                  ref={(el) => { if (el) handRefs.current[id] = el; else delete handRefs.current[id] }}
                  data-playable={ok ? '1' : '0'}
                  data-sel={sel === id ? '1' : '0'}
                  data-forced={forced ? '1' : '0'}
                  disabled={over}
                  aria-label={`${fmt(a)} ${fmt(b)}`}
                  onClick={() => tapTile(id)}
                >
                  <span className="dmo-tile-in" key={shaking ? `s${nudge.n}` : 'i'} data-shake={shaking ? '1' : '0'}>
                    <StandingTile a={a} b={b} />
                  </span>
                </button>
              )
            })}
            {!hand.length ? <span className="dmo-hand-empty">{t.clean}</span> : null}
          </div>
        )}

        {veiled ? (
          <div
            className="dmo-veil"
            role="button"
            tabIndex={0}
            onClick={() => setRevealed(st.turn)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setRevealed(st.turn) }}
          >
            <div>
              <b>{nameFor(st.turn)}</b>
              <span>{ar ? 'مرّر الجهاز، ثم اضغط لعرض أحجارك' : 'Pass the device, then tap to reveal'}</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* ---------- 5. round / match sheet ---------- */}
      {over ? (
        <div className="dmo-sheet">
          <div className="dmo-card">
            <div className="dmo-card-head">
              <Icon name="award" size={16} />
              <span>{resultHead()}</span>
            </div>

            <div className="dmo-card-sub">{t.remainTitle}</div>
            <div className="dmo-rows">
              {seats.map((s) => {
                const left = st.hands[String(s)] || []
                const pips = res && res.pips ? (res.pips[String(s)] || 0) : handPips(left)
                const winner = res && res.winner === s
                return (
                  <div key={s} className="dmo-row" data-win={winner ? '1' : '0'}>
                    <span className="dmo-row-name">{nameFor(s)}</span>
                    <span className="dmo-row-tiles">
                      {left.length
                        ? left.slice(0, 8).map((id) => {
                          const [a, b] = pipsOf(id)
                          return <StandingTile key={id} a={a} b={b} detail={false} />
                        })
                        : <em>{t.clean}</em>}
                    </span>
                    <span className="dmo-row-pips">{fmt(pips)}</span>
                    <span className="dmo-row-gain">{winner && res.points ? `+${fmt(res.points)}` : ''}</span>
                  </div>
                )
              })}
            </div>

            <div className="dmo-card-sub">{t.scoreTitle} {fmt(target)}</div>
            <div className="dmo-track">
              {seats.map((s) => {
                const v = st.scores[String(s)] || 0
                const p = Math.max(0, Math.min(1, v / target))
                return (
                  <div key={s} className="dmo-trk">
                    <span className="dmo-trk-name">{nameFor(s)}</span>
                    <span className="dmo-trk-bar">
                      <span className="dmo-trk-fill" style={{ transform: `scaleX(${p.toFixed(3)})` }} />
                    </span>
                    <b className="dmo-trk-n">{fmt(v)}</b>
                  </div>
                )
              })}
            </div>

            <div className="dmo-card-foot">
              {st.phase === 'roundEnd' ? (
                <button type="button" className="dmo-act" data-tone="gold" onClick={() => submit({ type: 'next' })}>
                  <Icon name="play" size={13} />{t.nextRound}
                </button>
              ) : null}
              {st.phase === 'matchEnd' && (!mp || isHost) ? (
                // Online, a finished match means an ENDED room, and only the
                // host can restart it (GamesCenter reroutes this reset through
                // startGame). Everyone else would get a dead button.
                <button type="button" className="dmo-act" data-tone="gold" onClick={() => submit({ type: 'reset' })}>
                  <Icon name="reload" size={13} />{t.newMatch}
                </button>
              ) : null}
              {st.phase === 'matchEnd' && onExit ? (
                <button type="button" className="dmo-act" onClick={onExit}>
                  <Icon name="back" size={13} />{t.leave}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------- 6. the tile in flight ----------
          A plain HTML element on purpose: a CSS transform in px does not
          resolve into SVG user space on iOS Safari, so an SVG child animated
          that way lands in the wrong place or vanishes. The SVG inside only
          ever gets the unitless attribute form. */}
      {fly ? (
        <div
          key={fly.key}
          className="dmo-fly"
          aria-hidden="true"
          style={{
            left: `${fly.left}px`,
            top: `${fly.top}px`,
            width: `${fly.width}px`,
            height: `${fly.height}px`,
            '--dmo-fx': `${fly.dx.toFixed(1)}px`,
            '--dmo-fy': `${fly.dy.toFixed(1)}px`,
            '--dmo-fr': `${fly.rot}deg`,
            '--dmo-fsc': fly.sc.toFixed(3),
          }}
        >
          <svg
            viewBox={(fly.kind === 'back' ? fly.up : fly.rot90) ? '-0.58 -1.08 1.16 2.16' : '-1.08 -0.58 2.16 1.16'}
            preserveAspectRatio="xMidYMid meet"
          >
            <g transform={(fly.kind === 'back' ? fly.up : fly.rot90) ? 'rotate(90)' : undefined}>
              {fly.kind === 'back' ? <TileBack /> : <TileFace a={fly.a} b={fly.b} />}
            </g>
          </svg>
        </div>
      ) : null}
    </div>
  )
}
