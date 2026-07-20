// «الشطرنج» — full-rules chess for two players, realtime over a game room.
//
// RULES COMPLETENESS. This is a complete legal-move generator, not a
// "moves-that-look-right" filter. Implemented in full:
//   · every piece's movement and capture
//   · check, checkmate, stalemate
//   · castling on both wings, with ALL five conditions (rights intact, squares
//     empty, king not in check, king does not pass through or land on an
//     attacked square, the rook is actually still on its home square)
//   · castling rights lost when the king moves, when a rook leaves its home
//     square, AND when a rook is captured on its home square
//   · en passant (target square, the capture itself, and the fact that the
//     captured pawn is not on the destination square)
//   · promotion to queen / rook / bishop / knight, chosen by the player
//   · fifty-move rule and threefold repetition as CLAIMS by the side to move
//   · the automatic FIDE backstops: seventy-five moves and fivefold repetition
//   · insufficient material (K-K, K+B-K, K+N-K, K+B-K+B on the same colour)
//   · draw offer / accept / decline, and resignation
// Illegal moves are impossible rather than discouraged: `reduce` regenerates
// the legal move list from the stored position inside the room transaction and
// returns the state UNCHANGED for anything not in it. A tampered client cannot
// force a move, only waste a round trip.
//
// SIMPLIFICATIONS — stated honestly:
//   1. Threefold repetition compares board + side to move + castling rights +
//      en-passant square. FIDE only counts the en-passant square when the
//      capture is actually legal for some pawn; ignoring that nuance can make
//      two positions look different when FIDE would call them equal. It never
//      creates a false draw, it only occasionally misses one.
//   2. A draw claim must be made by the side to move. FIDE also lets a player
//      claim a repetition/fifty that *would* arise from the move they are about
//      to play; that pre-announcement is not offered here.
//   3. No clock. The room's turn deadline is left to the hub.
//
// Contract: this component renders the play area only. It never writes to
// Firestore — it calls onMove(move) and re-renders from the live `room`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import '../../styles/boardgames.css'

export const GAME_ID = 'chess'

/* ===========================================================================
   ENGINE — pure, module scope, no React.
   Board is a 64-character string, index 0 = a8, index 63 = h1.
   Uppercase = white, lowercase = black, '.' = empty.
   =========================================================================== */
const FILES = 'abcdefgh'
const START =
  'rnbqkbnr' + 'pppppppp' + '........' + '........' + '........' + '........' + 'PPPPPPPP' + 'RNBQKBNR'

const KNIGHT_D = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const ALL8 = [...DIAG, ...ORTH]

const onBoard = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8
const cellAt = (b, r, f) => b[r * 8 + f]
const isUpper = (c) => c >= 'A' && c <= 'Z'
const owner = (c) => (c === '.' ? null : isUpper(c) ? 'w' : 'b')
const sqName = (i) => FILES[i % 8] + String(8 - Math.floor(i / 8))
const other = (s) => (s === 'w' ? 'b' : 'w')
const seatOfSide = (s) => (s === 'w' ? 0 : 1)
const sideOfSeat = (n) => (n === 1 ? 'b' : 'w')

// Is `idx` attacked by side `by`? Reverse-ray scan, so it never recurses into
// move generation (which is what makes the castling test safe).
function attacked(b, idx, by) {
  const r0 = Math.floor(idx / 8)
  const f0 = idx % 8
  // pawns: a white pawn sits one row BELOW (higher row index) the square it hits
  const pr = by === 'w' ? r0 + 1 : r0 - 1
  const pawn = by === 'w' ? 'P' : 'p'
  for (const df of [-1, 1]) {
    if (onBoard(pr, f0 + df) && cellAt(b, pr, f0 + df) === pawn) return true
  }
  const knight = by === 'w' ? 'N' : 'n'
  for (const [dr, df] of KNIGHT_D) {
    if (onBoard(r0 + dr, f0 + df) && cellAt(b, r0 + dr, f0 + df) === knight) return true
  }
  const king = by === 'w' ? 'K' : 'k'
  for (const [dr, df] of ALL8) {
    if (onBoard(r0 + dr, f0 + df) && cellAt(b, r0 + dr, f0 + df) === king) return true
  }
  const ray = (dirs, types) => {
    for (const [dr, df] of dirs) {
      let r = r0 + dr
      let f = f0 + df
      while (onBoard(r, f)) {
        const c = cellAt(b, r, f)
        if (c !== '.') {
          if (owner(c) === by && types.indexOf(c.toLowerCase()) >= 0) return true
          break
        }
        r += dr
        f += df
      }
    }
    return false
  }
  if (ray(DIAG, ['b', 'q'])) return true
  if (ray(ORTH, ['r', 'q'])) return true
  return false
}

const kingIndex = (b, side) => b.indexOf(side === 'w' ? 'K' : 'k')

function inCheck(st) {
  const k = kingIndex(st.board, st.turn)
  return k >= 0 && attacked(st.board, k, other(st.turn))
}

// Every move the side to move could make ignoring the "do not leave your own
// king in check" rule. Castling IS fully validated here (its own check rules
// cannot be expressed by the generic filter below).
function pseudoMoves(st) {
  const b = st.board
  const me = st.turn
  const foe = other(me)
  const out = []
  for (let i = 0; i < 64; i++) {
    const c = b[i]
    if (c === '.' || owner(c) !== me) continue
    const r = Math.floor(i / 8)
    const f = i % 8
    const t = c.toLowerCase()

    if (t === 'p') {
      const dir = me === 'w' ? -1 : 1
      const homeRow = me === 'w' ? 6 : 1
      const lastRow = me === 'w' ? 0 : 7
      const r1 = r + dir
      if (onBoard(r1, f) && cellAt(b, r1, f) === '.') {
        if (r1 === lastRow) {
          for (const p of ['q', 'r', 'b', 'n']) out.push({ from: i, to: r1 * 8 + f, promo: p })
        } else {
          out.push({ from: i, to: r1 * 8 + f })
          const r2 = r + 2 * dir
          if (r === homeRow && cellAt(b, r2, f) === '.') out.push({ from: i, to: r2 * 8 + f, dbl: true })
        }
      }
      for (const df of [-1, 1]) {
        const nf = f + df
        if (!onBoard(r1, nf)) continue
        const to = r1 * 8 + nf
        const target = b[to]
        if (target !== '.' && owner(target) !== me) {
          if (r1 === lastRow) {
            for (const p of ['q', 'r', 'b', 'n']) out.push({ from: i, to, promo: p })
          } else out.push({ from: i, to })
        } else if (target === '.' && st.ep !== null && st.ep === to) {
          out.push({ from: i, to, epCap: true })
        }
      }
      continue
    }

    if (t === 'n') {
      for (const [dr, df] of KNIGHT_D) {
        const nr = r + dr
        const nf = f + df
        if (!onBoard(nr, nf)) continue
        const target = cellAt(b, nr, nf)
        if (target === '.' || owner(target) !== me) out.push({ from: i, to: nr * 8 + nf })
      }
      continue
    }

    if (t === 'k') {
      for (const [dr, df] of ALL8) {
        const nr = r + dr
        const nf = f + df
        if (!onBoard(nr, nf)) continue
        const target = cellAt(b, nr, nf)
        if (target === '.' || owner(target) !== me) out.push({ from: i, to: nr * 8 + nf })
      }
      // castling: rights, empty squares, rook present, and three unattacked squares
      const home = me === 'w' ? 60 : 4
      const rookCh = me === 'w' ? 'R' : 'r'
      const rights = st.castling || '-'
      if (i === home && !attacked(b, home, foe)) {
        const kSide = me === 'w' ? 'K' : 'k'
        const qSide = me === 'w' ? 'Q' : 'q'
        if (
          rights.indexOf(kSide) >= 0 &&
          b[home + 1] === '.' && b[home + 2] === '.' && b[home + 3] === rookCh &&
          !attacked(b, home + 1, foe) && !attacked(b, home + 2, foe)
        ) out.push({ from: i, to: home + 2, castle: 'k' })
        if (
          rights.indexOf(qSide) >= 0 &&
          b[home - 1] === '.' && b[home - 2] === '.' && b[home - 3] === '.' && b[home - 4] === rookCh &&
          !attacked(b, home - 1, foe) && !attacked(b, home - 2, foe)
        ) out.push({ from: i, to: home - 2, castle: 'q' })
      }
      continue
    }

    const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : ALL8
    for (const [dr, df] of dirs) {
      let nr = r + dr
      let nf = f + df
      while (onBoard(nr, nf)) {
        const target = cellAt(b, nr, nf)
        if (target === '.') out.push({ from: i, to: nr * 8 + nf })
        else {
          if (owner(target) !== me) out.push({ from: i, to: nr * 8 + nf })
          break
        }
        nr += dr
        nf += df
      }
    }
  }
  return out
}

// Apply a move to the board only; returns the derived board-level facts.
function applyRaw(st, mv) {
  const b = st.board.split('')
  const me = st.turn
  const piece = b[mv.from]
  const t = piece.toLowerCase()
  let captured = b[mv.to] !== '.' ? b[mv.to] : null

  b[mv.to] = mv.promo ? (me === 'w' ? mv.promo.toUpperCase() : mv.promo) : piece
  b[mv.from] = '.'

  if (mv.epCap) {
    const capIdx = mv.to + (me === 'w' ? 8 : -8)
    captured = b[capIdx] !== '.' ? b[capIdx] : null
    b[capIdx] = '.'
  }
  if (mv.castle) {
    const home = me === 'w' ? 60 : 4
    if (mv.castle === 'k') { b[home + 1] = b[home + 3]; b[home + 3] = '.' }
    else { b[home - 1] = b[home - 4]; b[home - 4] = '.' }
  }

  let rights = st.castling || '-'
  const drop = (ch) => { rights = rights.split(ch).join('') }
  if (t === 'k') { if (me === 'w') { drop('K'); drop('Q') } else { drop('k'); drop('q') } }
  // a rook leaving OR being captured on its home square kills that right
  if (mv.from === 63 || mv.to === 63) drop('K')
  if (mv.from === 56 || mv.to === 56) drop('Q')
  if (mv.from === 7 || mv.to === 7) drop('k')
  if (mv.from === 0 || mv.to === 0) drop('q')
  if (!rights) rights = '-'

  return {
    board: b.join(''),
    castling: rights,
    ep: mv.dbl ? (mv.from + mv.to) / 2 : null,
    halfmove: t === 'p' || captured ? 0 : (st.halfmove || 0) + 1,
    captured,
  }
}

function legalMoves(st) {
  const foe = other(st.turn)
  const res = []
  for (const mv of pseudoMoves(st)) {
    const r = applyRaw(st, mv)
    const k = kingIndex(r.board, st.turn)
    if (k >= 0 && !attacked(r.board, k, foe)) res.push(mv)
  }
  return res
}

const posKey = (st) => `${st.board}|${st.turn}|${st.castling || '-'}|${st.ep === null || st.ep === undefined ? '-' : st.ep}`

function repCount(st) {
  const key = posKey(st)
  let n = 0
  for (const k of st.reps || []) if (k === key) n += 1
  return n
}

// K-K, K+minor-K, and K+B-K+B with both bishops on one colour.
function insufficient(board) {
  const w = []
  const bl = []
  for (let i = 0; i < 64; i++) {
    const c = board[i]
    if (c === '.') continue
    const t = c.toLowerCase()
    if (t === 'k') continue
    if (t === 'p' || t === 'r' || t === 'q') return false
    ;(isUpper(c) ? w : bl).push({ t, sq: i })
  }
  if (!w.length && !bl.length) return true
  if (w.length + bl.length === 1) return true
  if (w.length === 1 && bl.length === 1 && w[0].t === 'b' && bl[0].t === 'b') {
    const colour = (i) => (Math.floor(i / 8) + (i % 8)) % 2
    return colour(w[0].sq) === colour(bl[0].sq)
  }
  return false
}

// Standard algebraic notation, with correct file/rank/full disambiguation.
// The check / mate suffix is appended by the caller once the reply is known.
function toSan(st, mv, list) {
  if (mv.castle) return mv.castle === 'k' ? 'O-O' : 'O-O-O'
  const piece = st.board[mv.from]
  const t = piece.toLowerCase()
  const isCap = st.board[mv.to] !== '.' || !!mv.epCap
  if (t === 'p') {
    let s = isCap ? `${FILES[mv.from % 8]}x${sqName(mv.to)}` : sqName(mv.to)
    if (mv.promo) s += `=${mv.promo.toUpperCase()}`
    return s
  }
  const rivals = list.filter((m) => m.to === mv.to && m.from !== mv.from && st.board[m.from] === piece)
  let dis = ''
  if (rivals.length) {
    const sameFile = rivals.some((m) => m.from % 8 === mv.from % 8)
    const sameRank = rivals.some((m) => Math.floor(m.from / 8) === Math.floor(mv.from / 8))
    if (!sameFile) dis = FILES[mv.from % 8]
    else if (!sameRank) dis = String(8 - Math.floor(mv.from / 8))
    else dis = sqName(mv.from)
  }
  return `${piece.toUpperCase()}${dis}${isCap ? 'x' : ''}${sqName(mv.to)}`
}

/* ===========================================================================
   ROOM CONTRACT — initialState / reduce / RULES_AR
   =========================================================================== */
export function initialState() {
  const st = {
    board: START,
    turn: 'w',
    castling: 'KQkq',
    ep: null,
    halfmove: 0,
    fullmove: 1,
    san: [],
    takenByW: '',
    takenByB: '',
    reps: [],
    status: 'playing',
    result: null,
    reason: null,
    check: false,
    drawOffer: null,
    lastFrom: null,
    lastTo: null,
  }
  st.reps = [posKey(st)]
  return st
}

const stampOf = (move) => (typeof move?.at === 'number' ? move.at : null)
const turnOut = (side, move) => ({ seat: seatOfSide(side), startedAt: stampOf(move), deadlineAt: null })

function finish(st, result, reason, move) {
  const next = {
    ...st,
    status: result === 'draw' ? 'draw' : 'decided',
    result,
    reason,
    drawOffer: null,
  }
  return {
    state: next,
    turn: turnOut(next.turn, move),
    status: 'ended',
    winnerSeat: result === 'draw' ? null : seatOfSide(result),
  }
}

// The anti-cheat boundary. Total function: anything illegal returns the state
// untouched. Re-runs inside the room transaction, so the position it validates
// against is always the committed one.
export function reduce(state, move, room) {
  const st = state && typeof state.board === 'string' && state.board.length === 64 ? state : initialState()
  const type = move && move.type ? move.type : 'move'
  const seat = Number.isInteger(move && move.seat)
    ? move.seat
    : Number.isInteger(room && room.turn && room.turn.seat)
      ? room.turn.seat
      : seatOfSide(st.turn)
  const side = sideOfSeat(seat)

  // a rematch is only offered once the game is decided — otherwise a player who
  // is losing could wipe the board out from under the winner
  if (type === 'newGame') {
    if (st.status === 'playing') return { state: st }
    const fresh = initialState()
    return { state: fresh, turn: turnOut('w', move), status: 'playing', winnerSeat: null }
  }
  if (st.status !== 'playing') return { state: st }
  if (seat !== 0 && seat !== 1) return { state: st }

  if (type === 'resign') {
    return finish(st, other(side), 'resign', move)
  }
  if (type === 'offerDraw') {
    if (st.drawOffer === seat) return { state: st }
    return { state: { ...st, drawOffer: seat }, turn: turnOut(st.turn, move) }
  }
  if (type === 'declineDraw') {
    if (st.drawOffer === null || st.drawOffer === seat) return { state: st }
    return { state: { ...st, drawOffer: null }, turn: turnOut(st.turn, move) }
  }
  if (type === 'acceptDraw') {
    if (st.drawOffer === null || st.drawOffer === seat) return { state: st }
    return finish(st, 'draw', 'agreed', move)
  }
  if (type === 'claimDraw') {
    // only the side to move may claim, and only if the claim is genuinely true
    if (side !== st.turn) return { state: st }
    if (move.kind === 'fifty' && (st.halfmove || 0) >= 100) return finish(st, 'draw', 'fifty', move)
    if (move.kind === 'threefold' && repCount(st) >= 3) return finish(st, 'draw', 'threefold', move)
    return { state: st }
  }
  if (type !== 'move') return { state: st }

  if (side !== st.turn) return { state: st }
  const list = legalMoves(st)
  const wanted = list.find(
    (m) =>
      m.from === move.from &&
      m.to === move.to &&
      (m.promo || null) === (move.promo || null),
  )
  if (!wanted) return { state: st }

  const san = toSan(st, wanted, list)
  const r = applyRaw(st, wanted)
  const next = {
    ...st,
    board: r.board,
    turn: other(st.turn),
    castling: r.castling,
    ep: r.ep,
    halfmove: r.halfmove,
    fullmove: st.turn === 'b' ? (st.fullmove || 1) + 1 : st.fullmove || 1,
    lastFrom: wanted.from,
    lastTo: wanted.to,
    drawOffer: null,
  }
  if (r.captured) {
    if (st.turn === 'w') next.takenByW = (st.takenByW || '') + r.captured
    else next.takenByB = (st.takenByB || '') + r.captured
  }
  // repetition history resets on every irreversible move, which keeps it small
  next.reps = (r.halfmove === 0 ? [] : (st.reps || []).slice(-180)).concat(posKey(next))

  const replies = legalMoves(next)
  const chk = inCheck(next)
  next.check = chk
  next.san = (st.san || []).concat(san + (!replies.length ? (chk ? '#' : '') : chk ? '+' : '')).slice(-400)

  if (!replies.length) {
    return chk ? finish(next, st.turn, 'mate', move) : finish(next, 'draw', 'stalemate', move)
  }
  if (insufficient(next.board)) return finish(next, 'draw', 'material', move)
  if ((next.halfmove || 0) >= 150) return finish(next, 'draw', 'seventyfive', move)
  if (repCount(next) >= 5) return finish(next, 'draw', 'fivefold', move)

  return { state: next, turn: turnOut(next.turn, move), status: 'playing', winnerSeat: null }
}

export const RULES_AR = [
  'الشطرنج بقواعده الكاملة للاعبين اثنين. الأبيض يبدأ، ويتناوب اللاعبان دوراً بدور.',
  'حركات القطع كلها مطبّقة: التبييت بجهتيه، والأخذ بالمرور، وترقية البيدق مع اختيارك بين الوزير والرخ والفيل والحصان.',
  'الحركة غير القانونية مستحيلة: النظام يولّد الحركات المشروعة من الوضع المحفوظ ويرفض ما عداها.',
  'الفوز بكش مات، والتعادل بالجمود أو بعدم كفاية القطع أو بالاتفاق.',
  'يحق للاعب صاحب الدور المطالبة بالتعادل عند مرور خمسين نقلة بلا أسر ولا تحريك بيدق، أو عند تكرار الوضع ثلاث مرات.',
  'ويُعلن التعادل تلقائياً عند خمس وسبعين نقلة أو تكرار الوضع خمس مرات.',
  'اختيار المتغيّر: مقارنة تكرار الوضع تعتمد رقعة اللعب والدور وحقوق التبييت ومربع الأخذ بالمرور، والمطالبة تكون من صاحب الدور فقط.',
].join('\n')

/* ===========================================================================
   PIECES — hand-authored SVG, 45x45 viewBox. No external assets.
   =========================================================================== */
const PIECE_SHAPES = {
  p: (
    <>
      <circle cx="22.5" cy="13" r="5.9" />
      <path d="M16.4 19.2c0 2.4 1.6 3.7 1.6 3.7-2.9 2.4-4.4 6.3-4.9 10.1h19.8c-.5-3.8-2-7.7-4.9-10.1 0 0 1.6-1.3 1.6-3.7z" />
      <path d="M11.6 33h21.8l1.9 5.4H9.7z" />
    </>
  ),
  r: (
    <>
      <path d="M11 9h5v5h4V9h5v5h4V9h5v9H11z" />
      <path d="M13.6 18h17.8l-1.4 13H15z" />
      <path d="M12.4 31h20.2v3.6H12.4z" />
      <path d="M10 34.6h25v4H10z" />
    </>
  ),
  n: (
    <>
      <path d="M22 10.2c2.4-2 4.9-2.6 6.4-.6l1.1-3.4 1.6 3.5c3 2.5 4.6 7.5 4.1 13.4-.4 5-1.2 10.4-1.5 15H14c0-5.2 1.6-9.2 5.1-12.2 2.5-2.1 3.5-4 3.5-6.1l-4.6 3.7c-2 1.6-4.1 1-4.6-1.1-.5-2.6 1-5.7 3.6-8.3 1.5-1.5 3.5-3.2 5-4z" />
      <path d="M12.6 38h20.2v4H12.6z" />
    </>
  ),
  b: (
    <>
      <circle cx="22.5" cy="7.4" r="2.5" />
      <path d="M22.5 10.4c3.6 3.2 6.2 7.2 6.2 11.2 0 3.9-2.7 6.6-6.2 7.5-3.5-.9-6.2-3.6-6.2-7.5 0-4 2.6-8 6.2-11.2z" />
      <path d="M16.6 29.1h11.8v3.3H16.6z" />
      <path d="M13.2 32.4h18.6l1.8 4.2H11.4z" />
      <path d="M10.2 36.6h24.6v3.8H10.2z" />
    </>
  ),
  q: (
    <>
      <path d="M9 19.4 12.6 24 16 12l3.6 8L22.5 9l2.9 11 3.6-8L32.4 24 36 19.4 33 32H12z" />
      <circle cx="9" cy="18.4" r="2.6" />
      <circle cx="16" cy="11.2" r="2.6" />
      <circle cx="22.5" cy="8.2" r="2.9" />
      <circle cx="29" cy="11.2" r="2.6" />
      <circle cx="36" cy="18.4" r="2.6" />
      <path d="M11.6 32h21.8v3.6H11.6z" />
      <path d="M9.4 35.6h26.2v4H9.4z" />
    </>
  ),
  k: (
    <>
      <path d="M21 4.6h3v3.2h3.2v3H24v3.4h-3v-3.4h-3.2v-3H21z" />
      <path d="M22.5 14.4c-5.5 1-10.5 4-11.5 9-.8 4.1 1 7.1 3 8.8h17c2-1.7 3.8-4.7 3-8.8-1-5-6-8-11.5-9z" />
      <path d="M13 32.2h19v3.5H13z" />
      <path d="M10 35.7h25v4H10z" />
    </>
  ),
}

function PieceSvg({ code, className }) {
  if (!code || code === '.') return null
  const t = code.toLowerCase()
  const white = isUpper(code)
  const fill = white ? '#f6f1e6' : '#20303d'
  const line = white ? '#101a24' : '#c9d7e2'
  return (
    <svg className={className} viewBox="0 0 45 45" aria-hidden="true" focusable="false">
      <g fill={fill} stroke={line} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
        {PIECE_SHAPES[t]}
      </g>
      {t === 'n' ? <circle cx="26.6" cy="15.6" r="1.7" fill={line} /> : null}
      {t === 'b' ? <path d="M25.6 13.4 19 22.6" stroke={line} strokeWidth="1.5" strokeLinecap="round" fill="none" /> : null}
    </svg>
  )
}

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const materialOf = (s) => (s || '').split('').reduce((a, c) => a + (PIECE_VALUE[c.toLowerCase()] || 0), 0)

/* ===========================================================================
   TEXT
   =========================================================================== */
const TXT = {
  ar: {
    white: 'الأبيض',
    black: 'الأسود',
    you: 'أنت',
    waiting: 'بانتظار انضمام الخصم',
    yourTurn: 'دورك',
    theirTurn: 'دور الخصم',
    spectator: 'أنت متفرّج',
    check: 'كش',
    mate: 'كش مات',
    stalemate: 'تعادل بالجمود',
    drawAgreed: 'تعادل بالاتفاق',
    drawFifty: 'تعادل بقاعدة الخمسين نقلة',
    drawThree: 'تعادل بتكرار الوضع ثلاث مرات',
    drawFive: 'تعادل بتكرار الوضع خمس مرات',
    draw75: 'تعادل بقاعدة الخمس والسبعين نقلة',
    drawMaterial: 'تعادل لعدم كفاية القطع',
    resigned: 'انسحاب',
    won: 'فاز',
    promote: 'اختر قطعة الترقية',
    promoteNote: 'يتحوّل البيدق إلى القطعة التي تختارها.',
    offerDraw: 'اعرض التعادل',
    claimDraw: 'اطلب التعادل',
    accept: 'أقبل التعادل',
    decline: 'أرفض',
    resign: 'انسحاب',
    resignAsk: 'هل تنسحب من هذه المباراة؟',
    yes: 'نعم، انسحب',
    no: 'تراجع',
    flip: 'اقلب الرقعة',
    offered: 'الخصم يعرض التعادل',
    offeredMine: 'عرضك للتعادل قيد الانتظار',
    newGame: 'مباراة جديدة',
    fiftyReady: 'يمكنك طلب التعادل بقاعدة الخمسين نقلة',
    threeReady: 'يمكنك طلب التعادل بتكرار الوضع',
    hotseat: 'لعب على جهاز واحد: مرّر الجهاز بعد كل نقلة.',
    moves: 'النقلات',
    noMoves: 'لم تبدأ النقلات بعد',
  },
  en: {
    white: 'White',
    black: 'Black',
    you: 'You',
    waiting: 'Waiting for an opponent',
    yourTurn: 'Your turn',
    theirTurn: 'Opponent to move',
    spectator: 'Spectating',
    check: 'Check',
    mate: 'Checkmate',
    stalemate: 'Stalemate',
    drawAgreed: 'Draw agreed',
    drawFifty: 'Draw by the fifty-move rule',
    drawThree: 'Draw by threefold repetition',
    drawFive: 'Draw by fivefold repetition',
    draw75: 'Draw by the seventy-five-move rule',
    drawMaterial: 'Draw by insufficient material',
    resigned: 'Resignation',
    won: 'wins',
    promote: 'Choose a promotion',
    promoteNote: 'The pawn becomes the piece you pick.',
    offerDraw: 'Offer a draw',
    claimDraw: 'Claim a draw',
    accept: 'Accept draw',
    decline: 'Decline',
    resign: 'Resign',
    resignAsk: 'Resign this game?',
    yes: 'Yes, resign',
    no: 'Back',
    flip: 'Flip board',
    offered: 'Your opponent offers a draw',
    offeredMine: 'Your draw offer is pending',
    newGame: 'New game',
    fiftyReady: 'A fifty-move draw can be claimed',
    threeReady: 'A repetition draw can be claimed',
    hotseat: 'One-device play: pass the device after each move.',
    moves: 'Moves',
    noMoves: 'No moves yet',
  },
}

/* ===========================================================================
   COMPONENT
   =========================================================================== */
export default function Chess({
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

  // single-device fallback: the very same reduce drives it, so the rules can
  // never drift between the two modes
  const [local, setLocal] = useState(() => {
    const saved = resumeState && resumeState.game === GAME_ID && resumeState.state
    return saved && typeof saved.board === 'string' && saved.board.length === 64 ? saved : initialState()
  })
  const st = useMemo(() => {
    const raw = mp ? room.state : local
    return raw && typeof raw.board === 'string' && raw.board.length === 64 ? raw : initialState()
  }, [mp, room, local])

  const seat = mp ? (Number.isInteger(mySeat) ? mySeat : null) : seatOfSide(st.turn)
  const mySide = seat === null ? null : sideOfSeat(seat)
  const myTurn = st.status === 'playing' && mySide !== null && mySide === st.turn

  const [sel, setSel] = useState(null)
  const [promo, setPromo] = useState(null) // { from, to }
  const [askResign, setAskResign] = useState(false)
  const [flipPin, setFlipPin] = useState(null)
  const flipped = flipPin !== null ? flipPin : mp ? mySeat === 1 : st.turn === 'b'

  const legal = useMemo(() => (st.status === 'playing' ? legalMoves(st) : []), [st])
  const targets = useMemo(() => {
    if (sel === null) return new Map()
    const m = new Map()
    for (const mv of legal) {
      if (mv.from !== sel) continue
      const cap = st.board[mv.to] !== '.' || !!mv.epCap
      m.set(mv.to, { cap, promo: !!mv.promo })
    }
    return m
  }, [sel, legal, st])

  // clear a stale selection whenever the position changes underneath us
  const posRef = useRef('')
  useEffect(() => {
    const key = `${st.board}|${st.turn}`
    if (posRef.current !== key) { posRef.current = key; setSel(null); setPromo(null) }
  }, [st.board, st.turn])

  const submit = useCallback((move) => {
    const payload = Number.isInteger(seat) ? { ...move, seat } : move
    if (mp) onMove?.(payload)
    else setLocal((prev) => {
      // hot-seat: the seat acting is the side to move, EXCEPT when answering a
      // draw offer — that answer belongs to the player who did not offer, and
      // offering never passes the turn
      const answering = move.type === 'acceptDraw' || move.type === 'declineDraw'
      const actor = answering ? (prev.drawOffer === 0 ? 1 : 0) : seatOfSide(prev.turn)
      return reduce(prev, { ...payload, seat: actor }, null).state
    })
    setSel(null)
    setPromo(null)
  }, [mp, onMove, seat])

  // persist single-device games; report the result to the hub once
  const reportedRef = useRef(false)
  useEffect(() => {
    if (!mp) onProgressRef.current?.({ game: GAME_ID, state: st })
    if (st.status === 'playing' || reportedRef.current) return
    reportedRef.current = true
    const points = st.result === 'draw' ? 75 : mySide === null ? 40 : st.result === mySide ? 150 : 25
    onScoreRef.current?.(points)
  }, [st, mp, mySide])

  const clickSquare = useCallback((idx) => {
    if (st.status !== 'playing') return
    if (!myTurn) return
    if (sel !== null && targets.has(idx)) {
      if (targets.get(idx).promo) { setPromo({ from: sel, to: idx }); return }
      submit({ type: 'move', from: sel, to: idx })
      return
    }
    const c = st.board[idx]
    if (c !== '.' && owner(c) === st.turn) { setSel(idx === sel ? null : idx); return }
    setSel(null)
  }, [st, myTurn, sel, targets, submit])

  const order = useMemo(() => {
    const a = []
    for (let i = 0; i < 64; i++) a.push(i)
    return flipped ? a.reverse() : a
  }, [flipped])

  const checkSq = st.status === 'playing' && st.check ? kingIndex(st.board, st.turn) : -1

  const canClaimFifty = myTurn && (st.halfmove || 0) >= 100
  const canClaimThree = myTurn && repCount(st) >= 3
  const hasOffer = st.drawOffer !== null && st.drawOffer !== undefined
  // on one device both sides sit here, so any pending offer is answerable
  const offerFromFoe = hasOffer && (!mp || st.drawOffer !== seat)
  const offerFromMe = hasOffer && mp && st.drawOffer === seat

  const players = mp && Array.isArray(room.players) ? room.players : []
  const nameFor = (s) => {
    const p = players.find((x) => x.seat === s)
    if (p && p.name) return p.name
    if (!mp && playerName && s === 0) return playerName
    return s === 0 ? t.white : t.black
  }
  const connFor = (s) => {
    const p = players.find((x) => x.seat === s)
    return !mp || !p ? true : p.connected !== false
  }

  const resultLine = () => {
    if (st.status === 'playing') return st.check ? t.check : ''
    const map = {
      mate: t.mate,
      stalemate: t.stalemate,
      agreed: t.drawAgreed,
      fifty: t.drawFifty,
      threefold: t.drawThree,
      fivefold: t.drawFive,
      seventyfive: t.draw75,
      material: t.drawMaterial,
      resign: t.resigned,
    }
    const why = map[st.reason] || ''
    if (st.result === 'draw') return why
    const who = st.result === 'w' ? nameFor(0) : nameFor(1)
    return `${who} ${t.won} — ${why}`
  }

  const advW = materialOf(st.takenByW) - materialOf(st.takenByB)

  // called, not mounted: a nested component would remount its whole subtree on
  // every snapshot and kill the press/entrance transitions
  const renderSeat = (s) => (
    <div className="bgm-seat" data-active={st.status === 'playing' && seatOfSide(st.turn) === s ? '1' : '0'} data-me={seat === s ? '1' : '0'}>
      <span className="bgm-dot" data-off={connFor(s) ? '0' : '1'} style={{ background: s === 0 ? '#f6f1e6' : '#20303d' }} />
      <span className="bgm-seat-name">{nameFor(s)}{seat === s ? ` (${t.you})` : ''}</span>
      <span className="bgm-tray">
        {((s === 0 ? st.takenByW : st.takenByB) || '').split('').map((c, i) => <PieceSvg key={`${c}${i}`} code={c} />)}
        {(s === 0 ? advW > 0 : advW < 0) ? <span className="bgm-adv">+{Math.abs(advW)}</span> : null}
      </span>
    </div>
  )

  const moveRows = useMemo(() => {
    const rows = []
    const list = st.san || []
    for (let i = 0; i < list.length; i += 2) {
      rows.push({ no: Math.floor(i / 2) + 1, w: list[i], b: list[i + 1] || '', live: i + 1 >= list.length - 1 })
    }
    return rows
  }, [st.san])

  return (
    <div className="bgm-root" style={{ '--bgm-brand': brand }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        {renderSeat(flipped ? 0 : 1)}
        <span className="bgm-turnpill">
          {st.status !== 'playing' ? '' : mySide === null ? t.spectator : myTurn ? t.yourTurn : t.theirTurn}
        </span>
      </div>

      <div className="bgm-chess-stage">
        <div className="bgm-boardwrap">
          <div className="bgm-board" role="grid">
            {order.map((idx) => {
              const r = Math.floor(idx / 8)
              const f = idx % 8
              const dark = (r + f) % 2 === 1
              const hint = targets.get(idx)
              const showFile = flipped ? r === 0 : r === 7
              const showRank = flipped ? f === 7 : f === 0
              return (
                <button
                  key={idx}
                  type="button"
                  className="bgm-sq"
                  data-shade={dark ? 'dark' : 'light'}
                  data-sel={sel === idx ? '1' : '0'}
                  data-last={sel === null && (st.lastFrom === idx || st.lastTo === idx) ? '1' : '0'}
                  data-check={checkSq === idx ? '1' : '0'}
                  aria-label={sqName(idx)}
                  onClick={() => clickSquare(idx)}
                  disabled={!myTurn}
                >
                  {hint ? <span className="bgm-hint" data-cap={hint.cap ? '1' : '0'} /> : null}
                  <PieceSvg code={st.board[idx]} className="bgm-piece" />
                  {showFile ? <span className="bgm-coord" data-kind="file">{FILES[f]}</span> : null}
                  {showRank ? <span className="bgm-coord" data-kind="rank">{8 - r}</span> : null}
                </button>
              )
            })}
          </div>
        </div>

        <div className="bgm-rail">
          {st.status !== 'playing' ? (
            <div className="bgm-banner" data-tone={st.result === 'draw' ? 'warn' : 'ok'}>
              <Icon name="award" size={15} />
              <span>{resultLine()}</span>
            </div>
          ) : st.check ? (
            <div className="bgm-banner" data-tone="bad"><Icon name="warning" size={15} /><span>{t.check}</span></div>
          ) : offerFromFoe ? (
            <div className="bgm-banner" data-tone="warn"><span>{t.offered}</span></div>
          ) : offerFromMe ? (
            <div className="bgm-banner"><span>{t.offeredMine}</span></div>
          ) : mp && players.length < 2 ? (
            <div className="bgm-banner"><Icon name="clock" size={15} /><span>{t.waiting}</span></div>
          ) : !mp ? (
            <div className="bgm-banner"><span>{t.hotseat}</span></div>
          ) : null}

          <div className="bgm-moves bgm-strip" aria-label={t.moves}>
            {moveRows.length === 0 ? (
              <span className="bgm-move" style={{ opacity: 0.5 }}>{t.noMoves}</span>
            ) : moveRows.map((row) => (
              <span key={row.no} className="bgm-move" data-live={row.live ? '1' : '0'}>
                <span className="bgm-moveno">{row.no}.</span> {row.w} {row.b}
              </span>
            ))}
          </div>

          <div className="bgm-strip" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="bgm-btn bgm-press" onClick={() => setFlipPin(!flipped)}>
              <Icon name="repeat" size={14} />{t.flip}
            </button>
            {offerFromFoe && st.status === 'playing' ? (
              <>
                <button type="button" className="bgm-btn bgm-press" data-tone="brand" onClick={() => submit({ type: 'acceptDraw' })}>
                  <Icon name="check" size={14} />{t.accept}
                </button>
                <button type="button" className="bgm-btn bgm-press" onClick={() => submit({ type: 'declineDraw' })}>{t.decline}</button>
              </>
            ) : null}
            {canClaimFifty || canClaimThree ? (
              <button
                type="button"
                className="bgm-btn bgm-press"
                data-tone="brand"
                onClick={() => submit({ type: 'claimDraw', kind: canClaimThree ? 'threefold' : 'fifty' })}
              >
                <Icon name="scale" size={14} />{t.claimDraw}
              </button>
            ) : null}
            {st.status === 'playing' && mySide !== null && !offerFromFoe ? (
              <button type="button" className="bgm-btn bgm-press" onClick={() => submit({ type: 'offerDraw' })} disabled={offerFromMe}>
                {t.offerDraw}
              </button>
            ) : null}
            {st.status === 'playing' && mySide !== null ? (
              <button type="button" className="bgm-btn bgm-press" data-tone="bad" onClick={() => setAskResign(true)}>
                <Icon name="no" size={14} />{t.resign}
              </button>
            ) : null}
            {st.status !== 'playing' && (!mp || (isHostLike(room, mySeat))) ? (
              <button type="button" className="bgm-btn bgm-press" data-tone="brand" onClick={() => submit({ type: 'newGame' })}>
                <Icon name="reload" size={14} />{t.newGame}
              </button>
            ) : null}
            {onExit ? (
              <button type="button" className="bgm-btn bgm-press" onClick={onExit}><Icon name="close" size={14} /></button>
            ) : null}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        {renderSeat(flipped ? 1 : 0)}
        {canClaimFifty ? <span className="bgm-seat-sub">{t.fiftyReady}</span> : canClaimThree ? <span className="bgm-seat-sub">{t.threeReady}</span> : null}
      </div>

      {promo ? (
        <div className="bgm-modal" role="dialog" aria-modal="true">
          <div className="bgm-card">
            <h3>{t.promote}</h3>
            <p>{t.promoteNote}</p>
            <div className="bgm-promo-row">
              {['q', 'r', 'b', 'n'].map((p) => (
                <button
                  key={p}
                  type="button"
                  className="bgm-promo-btn bgm-press"
                  onClick={() => submit({ type: 'move', from: promo.from, to: promo.to, promo: p })}
                  aria-label={p}
                >
                  <PieceSvg code={st.turn === 'w' ? p.toUpperCase() : p} />
                </button>
              ))}
            </div>
            <button type="button" className="bgm-btn bgm-press" onClick={() => setPromo(null)}>{t.no}</button>
          </div>
        </div>
      ) : null}

      {askResign ? (
        <div className="bgm-modal" role="dialog" aria-modal="true">
          <div className="bgm-card">
            <h3>{t.resignAsk}</h3>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button type="button" className="bgm-btn bgm-press" data-tone="bad" onClick={() => { setAskResign(false); submit({ type: 'resign' }) }}>{t.yes}</button>
              <button type="button" className="bgm-btn bgm-press" onClick={() => setAskResign(false)}>{t.no}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// Only the room host offers the rematch button, so two clients cannot reset the
// board at the same instant (the transaction would serialise them anyway, but a
// double reset reads as a glitch).
function isHostLike(room, mySeat) {
  if (!room) return true
  const me = Array.isArray(room.players) ? room.players.find((p) => p.seat === mySeat) : null
  return !!me && me.id === room.hostId
}
