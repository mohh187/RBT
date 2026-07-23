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
//
// ===========================================================================
// PRESENTATION NOTES (added with the commercial-quality pass)
// ===========================================================================
// · THE BOARD NEVER MIRRORS ITS COORDINATES. Flipping the view rotates
//   `.chs-board` by 180deg in CSS and counter-rotates each piece, so a piece's
//   square index → translate() mapping is the SAME in both orientations. That
//   is what lets a move animate along its real path even in hot-seat, where
//   the view turns over on every handover.
// · SAFARI SVG TRANSFORM TRAP: no SVG child in this file is ever placed with a
//   CSS transform carrying px units. Pieces are HTML divs positioned with
//   percentage translates; the SVG inside each one only ever fills its box.
// · TAP-STEALING TRAP: the only interactive elements over the board are the 64
//   square buttons, which tile it exactly and never overlap. The piece layer,
//   every hint dot, every ring and every label carries pointer-events:none, so
//   nothing can sit on top of a square and eat its tap.
// · SILENT-RULE TRAP: a rule that removes an option the player expects is
//   always SHOWN — a piece with no legal move is dimmed, selecting it marks the
//   checking piece or the pinning piece with a ring and prints the reason, and
//   an unavailable castle says which of the three conditions failed.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { botMoveFor, botLabel, takeSoloIntent, BOT_DELAY_MS } from '../../lib/gameBots.js'
import { play } from '../../lib/gameSounds.js'
import '../../styles/boardgames.css'
import '../../styles/chess.css'

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

export function legalMoves(st) {
  const foe = other(st.turn)
  const res = []
  for (const mv of pseudoMoves(st)) {
    const r = applyRaw(st, mv)
    const k = kingIndex(r.board, st.turn)
    if (k >= 0 && !attacked(r.board, k, foe)) res.push(mv)
  }
  return res
}

// The one thing the computer opponent is allowed to borrow from this file. It
// is THE legal move generator — the same list `reduce` validates against — so
// the bot can never consider a move a human sitting there could not make.
// `applyRaw` / `attacked` / `kingIndex` were added for the «صعب» level, which
// looks one move further ahead: replaying candidate replies through the full
// `reduce` would cost a repetition-history rebuild per node for nothing.
export const botHelpers = { legalMoves, applyRaw, attacked, kingIndex, other }

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
   BOARD EXPLAINERS — the anti "silent rule" layer.
   Every one of these answers the question «لماذا لا تتحرك هذه القطعة؟» with a
   square the player can SEE, not just a sentence.
   =========================================================================== */

// Squares holding an enemy piece that currently gives check.
function checkerSquares(st) {
  const k = kingIndex(st.board, st.turn)
  if (k < 0) return []
  const foeView = { board: st.board, turn: other(st.turn), castling: '-', ep: null }
  const out = []
  for (const m of pseudoMoves(foeView)) {
    if (m.to === k && out.indexOf(m.from) < 0) out.push(m.from)
  }
  return out
}

// The enemy slider pinning `sq` against its own king, or -1. A pinned piece is
// the classic silent removal: the player taps it and nothing lights up.
function pinnerOf(board, sq, side) {
  const k = kingIndex(board, side)
  if (k < 0 || k === sq) return -1
  const kr = Math.floor(k / 8)
  const kf = k % 8
  const sr = Math.floor(sq / 8)
  const sf = sq % 8
  const dr = Math.sign(sr - kr)
  const df = Math.sign(sf - kf)
  const straight = dr === 0 || df === 0
  const diag = Math.abs(sr - kr) === Math.abs(sf - kf)
  if (!straight && !diag) return -1
  let r = kr + dr
  let f = kf + df
  while (r !== sr || f !== sf) {
    if (!onBoard(r, f) || board[r * 8 + f] !== '.') return -1
    r += dr
    f += df
  }
  r += dr
  f += df
  while (onBoard(r, f)) {
    const c = board[r * 8 + f]
    if (c !== '.') {
      if (owner(c) === side) return -1
      const t = c.toLowerCase()
      if (straight && (t === 'r' || t === 'q')) return r * 8 + f
      if (diag && (t === 'b' || t === 'q')) return r * 8 + f
      return -1
    }
    r += dr
    f += df
  }
  return -1
}

// Why the king in front of the player cannot castle, when it still holds the
// right to. Returns { key, marks } or null when castling is simply not on.
function castleBlock(st, side) {
  const rights = st.castling || '-'
  const home = side === 'w' ? 60 : 4
  const foe = other(side)
  const b = st.board
  if (b[home] !== (side === 'w' ? 'K' : 'k')) return null
  const wings = []
  if (rights.indexOf(side === 'w' ? 'K' : 'k') >= 0) wings.push({ step: 1, span: [home + 1, home + 2], rook: home + 3 })
  if (rights.indexOf(side === 'w' ? 'Q' : 'q') >= 0) wings.push({ step: -1, span: [home - 1, home - 2], rook: home - 4, extra: home - 3 })
  if (!wings.length) return null
  if (attacked(b, home, foe)) return { key: 'castleCheck', marks: [home] }
  for (const w of wings) {
    const busy = w.span.concat(w.extra === undefined ? [] : [w.extra]).filter((i) => b[i] !== '.')
    if (busy.length) continue
    const hit = w.span.filter((i) => attacked(b, i, foe))
    if (hit.length) return { key: 'castleThrough', marks: hit }
  }
  const anyClear = wings.some((w) => w.span.concat(w.extra === undefined ? [] : [w.extra]).every((i) => b[i] === '.'))
  if (!anyClear) {
    const w = wings[0]
    const busy = w.span.concat(w.extra === undefined ? [] : [w.extra]).filter((i) => b[i] !== '.')
    return { key: 'castleBusy', marks: busy }
  }
  return null
}

/* ===========================================================================
   PIECES — hand-authored SVG, 45x45 viewBox, no external assets.

   One family, one light source (upper left), one baseline: every piece ends in
   the shared PLINTH + FOOT so the set reads as one carved product. Depth comes
   from three layers over the same silhouette — a body gradient, a sheen pass,
   and a contact shadow ellipse on the square — which is what keeps them sharp
   at 40px on a phone AND at 120px on the venue screen.
   =========================================================================== */
const PLINTH = <path d="M12.8 32.2h19.4a1.1 1.1 0 0 1 1.1 1.1v1a1.1 1.1 0 0 1-1.1 1.1H12.8a1.1 1.1 0 0 1-1.1-1.1v-1a1.1 1.1 0 0 1 1.1-1.1z" />
const FOOT = <path d="M10.6 35.4h23.8a1.6 1.6 0 0 1 1.5 1.1l.8 2.3a1.2 1.2 0 0 1-1.14 1.6H9.44a1.2 1.2 0 0 1-1.14-1.6l.8-2.3a1.6 1.6 0 0 1 1.5-1.1z" />

const PIECE_SHAPES = {
  p: (
    <>
      <circle cx="22.5" cy="11.4" r="5.4" />
      <path d="M17.6 16.9h9.8a1.3 1.3 0 0 1 0 2.6h-.9c.15 2.4 1.35 3.7 2.75 5.6 1.6 2.2 2.4 4.6 2.75 7.1h-19c.35-2.5 1.15-4.9 2.75-7.1 1.4-1.9 2.6-3.2 2.75-5.6h-.9a1.3 1.3 0 0 1 0-2.6z" />
      {PLINTH}
      {FOOT}
    </>
  ),
  r: (
    <>
      <path d="M11.4 8.8h4.6v3.3h4.2V8.8h4.6v3.3h4.2V8.8h4.6v9.1H11.4z" />
      <path d="M13.2 17.9h18.6l-1.5 2.9H14.7z" />
      <path d="M14.8 20.8h15.4l-1.3 11.4H16.1z" />
      {PLINTH}
      {FOOT}
    </>
  ),
  n: (
    <>
      {/* the neck tapers INTO the plinth (12.8 → 32.2); an earlier draft flared
          out to x=36 and the horse looked like it was melting over its base */}
      <path d="M24.2 8.2c2.4-1.8 5.2-1.6 6.6.6l1.2-3.4 1.6 3.9c3 2.9 4.4 7.7 4 13.1-.3 4.4-1.7 7.5-3.2 9.8h-15.1c-.2-4.5 1.3-7.4 4.4-10.2 2.1-1.9 3.2-3.5 3.4-5.4l-4.5 3.5c-2.1 1.6-4.4.9-4.9-1.4-.55-2.7 1.1-5.8 3.8-8.4 1.3-1.3 2.8-2.3 4.25-2.1z" />
      {PLINTH}
      {FOOT}
    </>
  ),
  b: (
    <>
      <circle cx="22.5" cy="6.2" r="2.3" />
      <path d="M22.5 8.2c4 3.4 6.6 7.3 6.6 11.2 0 3.4-2.3 6-5.3 6.9h-2.6c-3-.9-5.3-3.5-5.3-6.9 0-3.9 2.6-7.8 6.6-11.2z" />
      <path d="M16.9 26.3h11.2a1 1 0 0 1 .95 1.3l-.75 2.2H16.7l-.75-2.2a1 1 0 0 1 .95-1.3z" />
      <path d="M15.3 30.1h14.4l1.1 2.1H14.2z" />
      {PLINTH}
      {FOOT}
    </>
  ),
  q: (
    <>
      <path d="M9.2 18.6l3.7 5.2 3.5-11.6 3.5 7.7L22.5 8.8l2.6 11.1 3.5-7.7 3.5 11.6 3.7-5.2-2.9 10H12.1z" />
      <circle cx="9.2" cy="17.4" r="2.5" />
      <circle cx="16.4" cy="11.1" r="2.4" />
      <circle cx="22.5" cy="7.9" r="2.7" />
      <circle cx="28.6" cy="11.1" r="2.4" />
      <circle cx="35.8" cy="17.4" r="2.5" />
      <path d="M11.9 28.6h21.2l-.6 3.6h-20z" />
      {PLINTH}
      {FOOT}
    </>
  ),
  k: (
    <>
      <path d="M20.9 4.2h3.2v3.2h3.2v3.2h-3.2v3.6h-3.2v-3.6h-3.2V7.4h3.2z" />
      <path d="M22.5 14.2c-5.6 0-10.2 3-11.1 7.4-.55 2.7.35 5.3 1.9 7.2h18.4c1.55-1.9 2.45-4.5 1.9-7.2-.9-4.4-5.5-7.4-11.1-7.4z" />
      <circle cx="12.5" cy="20.4" r="2.1" />
      <circle cx="32.5" cy="20.4" r="2.1" />
      <path d="M13.3 28.8h18.4l.5 3.4H12.8z" />
      {PLINTH}
      {FOOT}
    </>
  ),
}

// Per-piece detail drawn ON TOP of the body: the marks that make a silhouette
// identifiable at 40px (the knight's eye and mane, the bishop's mitre slit,
// the rook's course line, the king's crown band).
const PIECE_MARKS = {
  n: (
    <>
      <circle cx="27.4" cy="13.6" r="1.35" className="chs-mark-dot" />
      <path d="M31.9 9.8c1.9 2.6 2.8 6.3 2.6 10.6" className="chs-mark-line" />
      <path d="M20.4 16.4l3.2-2.4" className="chs-mark-line" />
    </>
  ),
  b: <path d="M25.7 12.8l-6.4 9.2" className="chs-mark-line" />,
  r: <path d="M14.9 21.4h15.2" className="chs-mark-line" />,
  k: <path d="M13.6 21.9h17.8" className="chs-mark-line" />,
  q: <path d="M12.9 25.6h19.2" className="chs-mark-line" />,
  p: null,
}

const PIECE_AR = { p: 'بيدق', n: 'حصان', b: 'فيل', r: 'رخ', q: 'وزير', k: 'ملك' }
const PIECE_EN = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' }

// The shared gradient bank. Mounted ONCE per board, never unmounted, so no
// piece can ever end up pointing at a <defs> that React has just removed.
function ChessDefs() {
  return (
    <svg className="chs-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="chsBodyW" x1="0.16" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#fffdf7" />
          <stop offset="0.46" stopColor="#f2e6cf" />
          <stop offset="1" stopColor="#c9b795" />
        </linearGradient>
        <linearGradient id="chsBodyB" x1="0.16" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#5a6774" />
          <stop offset="0.44" stopColor="#2c3742" />
          <stop offset="1" stopColor="#10161c" />
        </linearGradient>
        <linearGradient id="chsSheenW" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.62" />
          <stop offset="0.34" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="0.62" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#6b5a3c" stopOpacity="0.22" />
        </linearGradient>
        <linearGradient id="chsSheenB" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.42" />
          <stop offset="0.3" stopColor="#ffffff" stopOpacity="0.1" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.3" />
        </linearGradient>
        <radialGradient id="chsDrop" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#05080b" stopOpacity="0.5" />
          <stop offset="0.62" stopColor="#05080b" stopOpacity="0.24" />
          <stop offset="1" stopColor="#05080b" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  )
}

function PieceSvg({ code, className = '', shadow = true }) {
  if (!code || code === '.') return null
  const t = code.toLowerCase()
  const white = isUpper(code)
  const shapes = PIECE_SHAPES[t]
  if (!shapes) return null
  return (
    <svg
      className={`chs-piece-svg ${className}`}
      viewBox="0 0 45 45"
      data-side={white ? 'w' : 'b'}
      aria-hidden="true"
      focusable="false"
    >
      {shadow ? <ellipse cx="22.5" cy="40.2" rx="12.2" ry="2.6" fill="url(#chsDrop)" /> : null}
      <g
        fill={white ? 'url(#chsBodyW)' : 'url(#chsBodyB)'}
        stroke={white ? '#3a2f1e' : '#05090d'}
        strokeWidth="1.05"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {shapes}
      </g>
      <g fill={white ? 'url(#chsSheenW)' : 'url(#chsSheenB)'} stroke="none">
        {shapes}
      </g>
      <g
        fill={white ? '#3a2f1e' : '#aebccb'}
        stroke={white ? '#3a2f1e' : '#aebccb'}
        strokeWidth="0.9"
        strokeLinecap="round"
        className="chs-marks"
      >
        {PIECE_MARKS[t]}
      </g>
    </svg>
  )
}

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const materialOf = (s) => (s || '').split('').reduce((a, c) => a + (PIECE_VALUE[c.toLowerCase()] || 0), 0)
const byValueDesc = (s) => (s || '').split('').sort((a, b) => (PIECE_VALUE[b.toLowerCase()] || 0) - (PIECE_VALUE[a.toLowerCase()] || 0))

/* ===========================================================================
   PIECE TRACKING — what makes a move TRAVEL instead of teleport.

   React needs a stable DOM node per physical piece for a CSS transform
   transition to mean anything. This walks the previous piece list forward with
   the move the state reports (lastFrom → lastTo, plus the capture, the
   en-passant victim, the castled rook and the promotion), then VERIFIES the
   result against the new board string. Any mismatch — a rehydrated room, a
   rematch, a skipped snapshot — rebuilds from the board, which is correct and
   simply does not animate. It can never show a piece that is not there.
   =========================================================================== */
function trackPieces(prev, board, lastFrom, lastTo, seqRef) {
  const scratch = () => {
    const list = []
    for (let i = 0; i < 64; i += 1) {
      if (board[i] === '.') continue
      seqRef.current += 1
      list.push({ id: `p${seqRef.current}`, code: board[i], idx: i, born: true })
    }
    return list
  }
  if (!prev || !prev.list) return scratch()
  if (prev.board === board) return prev.list
  if (!Number.isInteger(lastFrom) || !Number.isInteger(lastTo)) return scratch()

  const at = new Map()
  for (const p of prev.list) at.set(p.idx, p)
  const mover = at.get(lastFrom)
  if (!mover) return scratch()

  const gone = new Set()
  if (at.has(lastTo)) gone.add(lastTo)
  const movedPawn = mover.code.toLowerCase() === 'p'
  const fFrom = lastFrom % 8
  const fTo = lastTo % 8
  if (movedPawn && fFrom !== fTo && !at.has(lastTo)) {
    gone.add(lastTo + (isUpper(mover.code) ? 8 : -8))
  }
  let rookFrom = -1
  let rookTo = -1
  if (mover.code.toLowerCase() === 'k' && Math.abs(fTo - fFrom) === 2) {
    const rowStart = Math.floor(lastFrom / 8) * 8
    if (fTo === 6) { rookFrom = rowStart + 7; rookTo = rowStart + 5 }
    else { rookFrom = rowStart; rookTo = rowStart + 3 }
  }

  const out = []
  for (const p of prev.list) {
    if (p === mover) { out.push({ ...p, idx: lastTo, code: board[lastTo], born: false }); continue }
    if (gone.has(p.idx)) continue
    if (p.idx === rookFrom) { out.push({ ...p, idx: rookTo, born: false }); continue }
    out.push(p.born ? { ...p, born: false } : p)
  }

  const seen = new Array(64).fill(null)
  for (const p of out) {
    if (seen[p.idx] !== null) return scratch()
    seen[p.idx] = p.code
  }
  for (let i = 0; i < 64; i += 1) {
    const c = board[i] === '.' ? null : board[i]
    if (seen[i] !== c) return scratch()
  }
  return out
}

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
    thinking: 'يفكّر',
    check: 'كش',
    inCheckNow: 'ملكك تحت الكش',
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
    youWon: 'فزت',
    youLost: 'خسرت',
    drawTitle: 'تعادل',
    promote: 'اختر قطعة الترقية',
    promoteNote: 'يتحوّل البيدق إلى القطعة التي تختارها.',
    offerDraw: 'اعرض التعادل',
    drawShort: 'تعادل',
    claimDraw: 'اطلب التعادل',
    accept: 'أقبل التعادل',
    decline: 'أرفض',
    resign: 'انسحاب',
    resignAsk: 'هل تنسحب من هذه المباراة؟',
    resignNote: 'الانسحاب يمنح الخصم الفوز فوراً.',
    yes: 'نعم، انسحب',
    no: 'تراجع',
    flip: 'اقلب الرقعة',
    newGame: 'مباراة جديدة',
    rematch: 'أعد المباراة',
    review: 'راجع الرقعة',
    exit: 'خروج',
    fiftyReady: 'يمكنك طلب التعادل بقاعدة الخمسين نقلة',
    threeReady: 'يمكنك طلب التعادل بتكرار الوضع',
    hotseat: 'لعب على جهاز واحد: تنقلب الرقعة بعد كل نقلة ليصير دور اللاعب في الأسفل.',
    moves: 'سجل النقلات',
    noMoves: 'لم تبدأ النقلات بعد',
    level: 'مستوى الكمبيوتر',
    easy: 'سهل',
    normal: 'متوسط',
    hard: 'صعب',
    lvEasy: 'سهل: يوازن قيمة القطع بعد نقلته فقط ولا يؤمّن قطعه، فيترك أشياء مكشوفة عمداً.',
    lvNormal: 'متوسط: يحسب المادة بعمق نقلة واحدة ويتفادى ترك قطعة مكشوفة. ليس محرك شطرنج.',
    lvHard: 'صعب: يحسب ردّك أيضاً — نقلتان ببحث ألفا-بيتا والأسر أولاً — ولا يدخل كش مات بنقلة واحدة.',
    // guidance
    gPick: 'اختر قطعة من قطعك لتحريكها.',
    gTarget: 'اختر مربعاً مضيئاً لإتمام النقلة، أو اضغط القطعة مرة أخرى للإلغاء.',
    gCheck: 'أنت في كش — اللعبة تسمح لك بالنقلات التي تنقذ ملكك فقط.',
    gWait: 'دور الخصم — انتظر نقلته.',
    gBot: 'الكمبيوتر يفكّر في نقلته.',
    gWaitJoin: 'بانتظار لاعب ثانٍ ليبدأ اللعب.',
    gSpectate: 'تشاهد المباراة — لا تملك مقعداً فيها.',
    gOfferIn: 'الخصم يعرض التعادل — اقبل أو ارفض.',
    gOfferOut: 'أرسلنا عرض التعادل، بانتظار رد الخصم.',
    notYourTurn: 'ليس دورك الآن.',
    whyPinned: 'هذه القطعة مربوطة: تحريكها يكشف ملكك للقطعة المعلّمة.',
    whyCheck: 'ملكك تحت الكش من القطعة المعلّمة، فلا تُقبل إلا نقلة تنهي الكش.',
    whyStuck: 'هذه القطعة لا تملك أي نقلة قانونية الآن.',
    whyTarget: 'هذا المربع ليس من نقلات هذه القطعة.',
    castleCheck: 'لا تبييت والملك تحت الكش.',
    castleThrough: 'لا تبييت عبر مربع يهاجمه الخصم (المربع معلّم).',
    castleBusy: 'لا تبييت وبين الملك والرخ قطع.',
    material: 'فارق المادة',
    turnOf: 'الدور على',
    toMove: 'يلعب الآن',
  },
  en: {
    white: 'White',
    black: 'Black',
    you: 'You',
    waiting: 'Waiting for an opponent',
    yourTurn: 'Your turn',
    theirTurn: 'Opponent to move',
    thinking: 'thinking',
    check: 'Check',
    inCheckNow: 'Your king is in check',
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
    youWon: 'You win',
    youLost: 'You lose',
    drawTitle: 'Draw',
    promote: 'Choose a promotion',
    promoteNote: 'The pawn becomes the piece you pick.',
    offerDraw: 'Offer a draw',
    drawShort: 'Draw',
    claimDraw: 'Claim a draw',
    accept: 'Accept draw',
    decline: 'Decline',
    resign: 'Resign',
    resignAsk: 'Resign this game?',
    resignNote: 'Resigning hands the opponent the win immediately.',
    yes: 'Yes, resign',
    no: 'Back',
    flip: 'Flip board',
    newGame: 'New game',
    rematch: 'Rematch',
    review: 'Review the board',
    exit: 'Exit',
    fiftyReady: 'A fifty-move draw can be claimed',
    threeReady: 'A repetition draw can be claimed',
    hotseat: 'One-device play: the board turns after each move so the player to move is at the bottom.',
    moves: 'Move list',
    noMoves: 'No moves yet',
    level: 'Computer level',
    easy: 'Easy',
    normal: 'Normal',
    hard: 'Hard',
    lvEasy: 'Easy: counts material after its own move only and never defends, so it leaves pieces hanging.',
    lvNormal: 'Normal: one-ply material with a hanging-piece guard. Not a chess engine.',
    lvHard: 'Hard: also weighs your reply — two plies, alpha-beta, captures first — and will not walk into mate in one.',
    gPick: 'Pick one of your pieces to move.',
    gTarget: 'Tap a marked square to move, or tap the piece again to cancel.',
    gCheck: 'You are in check — only moves that save your king are allowed.',
    gWait: 'Opponent to move — wait for their reply.',
    gBot: 'The computer is thinking.',
    gWaitJoin: 'Waiting for a second player.',
    gSpectate: 'You are watching this game — you hold no seat.',
    gOfferIn: 'A draw is offered — accept or decline.',
    gOfferOut: 'Your draw offer was sent; waiting for a reply.',
    notYourTurn: 'It is not your turn.',
    whyPinned: 'This piece is pinned: moving it exposes your king to the marked piece.',
    whyCheck: 'Your king is in check from the marked piece, so only a move that ends the check is legal.',
    whyStuck: 'This piece has no legal move right now.',
    whyTarget: 'That square is not one of this piece’s moves.',
    castleCheck: 'No castling while the king is in check.',
    castleThrough: 'No castling through a square the opponent attacks (marked).',
    castleBusy: 'No castling with pieces between the king and the rook.',
    material: 'Material',
    turnOf: 'To move',
    toMove: 'to move',
  },
}

const LEVELS = ['easy', 'normal', 'hard']
const LEVEL_KEY = 'ml.games.chess.level'
function readLevel() {
  try {
    const v = localStorage.getItem(LEVEL_KEY)
    return LEVELS.indexOf(v) >= 0 ? v : 'normal'
  } catch (_) { return 'normal' }
}

const prefersStill = () => {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) } catch (_) { return false }
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
  // «العب ضد الكمبيوتر». Chess is a two-seat game, so any positive value means
  // "one machine opponent"; the player always takes white.
  soloBots = null,
}) {
  const t = TXT[lang === 'en' ? 'en' : 'ar']
  const mp = !!room
  // Latched on the first render and never recomputed: the lobby's hand-off
  // expires after a minute, and re-reading it every render would silently turn
  // a bot match back into a hot-seat match mid-game.
  const [vsBot] = useState(() => !mp && (Number(soloBots) > 0 || !!takeSoloIntent(GAME_ID)))
  const [level, setLevel] = useState(readLevel)
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])

  // single-device fallback: the very same reduce drives it, so the rules can
  // never drift between the two modes
  const [local, setLocal] = useState(() => {
    // A saved position belongs to the hot-seat game it was saved from. Dropping
    // the player into it against the computer would hand them somebody else's
    // half-finished board, so a bot round always starts from the opening.
    if (vsBot) return initialState()
    const saved = resumeState && resumeState.game === GAME_ID && resumeState.state
    return saved && typeof saved.board === 'string' && saved.board.length === 64 ? saved : initialState()
  })
  const st = useMemo(() => {
    const raw = mp ? room.state : local
    return raw && typeof raw.board === 'string' && raw.board.length === 64 ? raw : initialState()
  }, [mp, room, local])

  // Hot-seat play hands the phone round, so the acting seat follows the side to
  // move. Against the computer it must NOT: the player owns white for the whole
  // game, otherwise the board would flip to the bot's view on its turn.
  const seat = mp ? (Number.isInteger(mySeat) ? mySeat : null) : (vsBot ? 0 : seatOfSide(st.turn))
  const mySide = seat === null ? null : sideOfSeat(seat)
  const myTurn = st.status === 'playing' && mySide !== null && mySide === st.turn
  // A viewer with no seat gets a board and nothing else: no controls, no
  // enabled squares, nothing that implies they can act. (This is also exactly
  // how the venue TV mounts the game — room, mySeat null, no onMove.)
  const viewer = mySide === null
  const canAct = !viewer && !!(mp ? onMove : true)

  const [sel, setSel] = useState(null)
  const [promo, setPromo] = useState(null) // { from, to }
  const [askResign, setAskResign] = useState(false)
  const [flipPin, setFlipPin] = useState(null)
  const [why, setWhy] = useState(null) // { text, marks: number[] }
  const [shake, setShake] = useState({ sq: -1, n: 0 })
  const [flash, setFlash] = useState({ sq: -1, n: 0 })
  const [botBusy, setBotBusy] = useState(false)
  const [overSeen, setOverSeen] = useState(false)

  // Hot-seat rotates the board to whoever is holding the phone. Against the
  // computer the player never lets go of it, so the view stays on white.
  const flipped = flipPin !== null
    ? flipPin
    : mp ? mySeat === 1 : (vsBot ? false : st.turn === 'b')

  // A manual flip pins the view only until the turn changes hands: without
  // this, one tap of «اقلب» killed hot-seat auto-rotation for the whole match.
  useEffect(() => { if (!mp && !vsBot) setFlipPin(null) }, [mp, vsBot, st.turn])

  const legal = useMemo(() => (st.status === 'playing' ? legalMoves(st) : []), [st])
  const targets = useMemo(() => {
    if (sel === null) return new Map()
    const m = new Map()
    for (const mv of legal) {
      if (mv.from !== sel) continue
      const cap = st.board[mv.to] !== '.' || !!mv.epCap
      m.set(mv.to, { cap, promo: !!mv.promo, castle: mv.castle || null })
    }
    return m
  }, [sel, legal, st])

  // Which of my own pieces can legally move at all. A piece that cannot is
  // DIMMED rather than silently inert — see the silent-rule note in the header.
  const movable = useMemo(() => {
    const s = new Set()
    if (!myTurn) return s
    for (const mv of legal) s.add(mv.from)
    return s
  }, [legal, myTurn])

  // clear a stale selection whenever the position changes underneath us
  const posRef = useRef('')
  useEffect(() => {
    const key = `${st.board}|${st.turn}|${st.status}`
    if (posRef.current !== key) {
      posRef.current = key
      setSel(null)
      setPromo(null)
      setWhy(null)
    }
  }, [st.board, st.turn, st.status])

  useEffect(() => { if (st.status === 'playing') setOverSeen(false) }, [st.status])

  // ---- stable piece identities, so a move travels instead of teleporting ----
  const seqRef = useRef(0)
  const trackRef = useRef(null)
  const pieces = useMemo(() => {
    const next = trackPieces(trackRef.current, st.board, st.lastFrom, st.lastTo, seqRef)
    trackRef.current = { board: st.board, list: next }
    return next
  }, [st.board, st.lastFrom, st.lastTo])

  // ---- sound + impact feedback. Display-only: one effect over existing state
  // fields, ref-guarded so nothing fires on mount or on a room rehydration.
  const sndRef = useRef(null)
  useEffect(() => {
    const cur = {
      board: st.board,
      caps: (st.takenByW || '').length + (st.takenByB || '').length,
      status: st.status,
      turn: st.turn,
      check: !!st.check,
      to: Number.isInteger(st.lastTo) ? st.lastTo : -1,
    }
    const prev = sndRef.current
    sndRef.current = cur
    if (!prev) return
    if (cur.board !== prev.board) {
      const took = cur.caps > prev.caps
      play(took ? 'capture' : 'move')
      if (took && cur.to >= 0) setFlash((f) => ({ sq: cur.to, n: f.n + 1 }))
      if (cur.check && !prev.check) play('turn', { gain: 0.9 })
    }
    if (cur.status !== prev.status && cur.status !== 'playing') {
      if (st.result === 'draw' || viewer) play('win', { gain: 0.35 })
      else play(st.result === mySide ? 'win' : 'lose')
      return
    }
    // hot-seat (same phone) would chime on every handover — noise
    if (cur.turn !== prev.turn && !viewer && cur.turn === mySide && cur.status === 'playing' && (mp || vsBot)) {
      play('turn', { gain: 0.8 })
    }
  }, [st, mySide, mp, vsBot, viewer])

  useEffect(() => {
    if (flash.sq < 0) return undefined
    const id = setTimeout(() => setFlash((f) => ({ ...f, sq: -1 })), 420)
    return () => clearTimeout(id)
  }, [flash])

  useEffect(() => {
    if (shake.sq < 0) return undefined
    const id = setTimeout(() => setShake((s) => ({ ...s, sq: -1 })), 420)
    return () => clearTimeout(id)
  }, [shake])

  const submit = useCallback((move) => {
    const payload = Number.isInteger(seat) ? { ...move, seat } : move
    if (mp) onMove?.(payload)
    else setLocal((prev) => {
      // hot-seat: the seat acting is the side to move, EXCEPT when answering a
      // draw offer — that answer belongs to the player who did not offer, and
      // offering never passes the turn. Against the computer the human is
      // ALWAYS seat 0: attributing a resign tapped during the bot's think time
      // to the side to move scored it as the BOT resigning (a free win), and
      // the same path let the human offer-and-accept their own draw.
      const answering = move.type === 'acceptDraw' || move.type === 'declineDraw'
      const actor = answering
        ? (prev.drawOffer === 0 ? 1 : 0)
        : (vsBot ? 0 : seatOfSide(prev.turn))
      return reduce(prev, { ...payload, seat: actor }, null).state
    })
    setSel(null)
    setPromo(null)
    setWhy(null)
  }, [mp, onMove, seat, vsBot])

  // ---- the computer opponent ---------------------------------------------
  // It plays black through src/lib/gameBots.js, which runs every candidate
  // through THIS file's `reduce` before returning one — so the machine seat is
  // held to exactly the rules the player is held to. The delay lets the player
  // see the reply land instead of it appearing in the same frame as their own.
  // The chosen level rides on the SAME ctx the bot already receives; no new
  // plumbing, and the search stays synchronous and bounded so it cannot stall.
  useEffect(() => {
    if (!vsBot || st.status !== 'playing') return undefined
    if (st.turn !== 'b') return undefined
    // A pending offer is answered before anything is moved, so the two timers
    // below can never race for the same tick.
    if (st.drawOffer === 0) return undefined
    setBotBusy(true)
    const id = setTimeout(() => {
      const mv = botMoveFor(GAME_ID, st, 1, { reduce, room: null, helpers: botHelpers, level })
      setBotBusy(false)
      if (mv) setLocal((prev) => reduce(prev, { ...mv, seat: seatOfSide(prev.turn) }, null).state)
    }, BOT_DELAY_MS)
    return () => { clearTimeout(id); setBotBusy(false) }
  }, [vsBot, st, level])

  // A draw offer needs an answer, and «الكمبيوتر» answering by material is the
  // only honest thing it can do — it has no plan to weigh the offer against.
  useEffect(() => {
    if (!vsBot || st.status !== 'playing') return undefined
    if (st.drawOffer !== 0) return undefined
    const id = setTimeout(() => {
      let bal = 0
      for (let i = 0; i < 64; i += 1) {
        const c = st.board[i]
        if (c === '.') continue
        const v = PIECE_VALUE[c.toLowerCase()] || 0
        bal += isUpper(c) ? v : -v
      }
      // bal > 0 means white (the player) is ahead, so black takes the draw
      setLocal((prev) => reduce(
        prev,
        { type: bal >= 3 ? 'acceptDraw' : 'declineDraw', seat: 1 },
        null,
      ).state)
    }, BOT_DELAY_MS)
    return () => clearTimeout(id)
  }, [vsBot, st])

  // persist single-device games; report the result to the hub once
  const reportedRef = useRef(false)
  useEffect(() => {
    if (!mp) onProgressRef.current?.({ game: GAME_ID, state: st })
    // A rematch flips the board back to 'playing' — re-arm the one-shot here,
    // or every round after the first would award no points.
    if (st.status === 'playing') { reportedRef.current = false; return }
    if (reportedRef.current) return
    reportedRef.current = true
    const points = st.result === 'draw' ? 75 : viewer ? 40 : st.result === mySide ? 150 : 25
    onScoreRef.current?.(points)
  }, [st, mp, mySide, viewer])

  const complain = useCallback((sq, text, marks) => {
    setShake({ sq, n: shake.n + 1 })
    setWhy(text ? { text, marks: marks || [] } : null)
    play('click', { gain: 0.45 })
  }, [shake.n])

  const clickSquare = useCallback((idx) => {
    if (viewer || st.status !== 'playing') return
    if (!myTurn) {
      complain(idx, vsBot ? t.gBot : t.notYourTurn, [])
      return
    }
    if (sel !== null && targets.has(idx)) {
      if (targets.get(idx).promo) { setPromo({ from: sel, to: idx }); play('click'); return }
      submit({ type: 'move', from: sel, to: idx })
      return
    }
    const c = st.board[idx]
    if (c !== '.' && owner(c) === st.turn) {
      if (idx === sel) { setSel(null); setWhy(null); play('click', { gain: 0.5 }); return }
      if (!movable.has(idx)) {
        // THE SILENT RULE, MADE LOUD: name the reason and mark the piece that
        // is enforcing it, instead of just refusing to light anything up.
        const checkers = st.check ? checkerSquares(st) : []
        const pin = pinnerOf(st.board, idx, st.turn)
        if (checkers.length) complain(idx, t.whyCheck, checkers)
        else if (pin >= 0) complain(idx, t.whyPinned, [pin])
        else complain(idx, t.whyStuck, [])
        return
      }
      setSel(idx)
      play('click', { gain: 0.6 })
      // Castling is the option players expect most and lose most silently.
      if (c.toLowerCase() === 'k') {
        const hasCastle = legal.some((m) => m.from === idx && m.castle)
        if (!hasCastle) {
          const blk = castleBlock(st, st.turn)
          setWhy(blk ? { text: t[blk.key], marks: blk.marks } : null)
        } else setWhy(null)
      } else setWhy(null)
      return
    }
    if (sel !== null) { complain(sel, t.whyTarget, [idx]); return }
    setWhy(null)
  }, [viewer, st, myTurn, sel, targets, submit, movable, legal, t, complain, vsBot])

  const checkSq = st.status === 'playing' && st.check ? kingIndex(st.board, st.turn) : -1
  const marks = why && why.marks ? why.marks : []

  const canClaimFifty = myTurn && (st.halfmove || 0) >= 100
  const canClaimThree = myTurn && repCount(st) >= 3
  const hasOffer = st.drawOffer !== null && st.drawOffer !== undefined
  // On one shared device both sides sit here, so any pending offer is
  // answerable. Against the computer they are not: the machine answers its own
  // side, and the player must never be shown "accept" for their own offer.
  const offerFromFoe = !viewer && hasOffer && ((mp || vsBot) ? st.drawOffer !== seat : true)
  const offerFromMe = !viewer && hasOffer && (mp || vsBot) && st.drawOffer === seat

  const players = mp && Array.isArray(room.players) ? room.players : []
  const nameFor = (s) => {
    const p = players.find((x) => x.seat === s)
    if (p && p.name) return p.name
    if (vsBot && s === 1) return botLabel(0, 1, lang)
    if (!mp && playerName && s === 0) return playerName
    return s === 0 ? t.white : t.black
  }
  const connFor = (s) => {
    const p = players.find((x) => x.seat === s)
    return !mp || !p ? true : p.connected !== false
  }
  const waitingForPlayers = mp && players.length < 2

  const reasonText = () => {
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
    return map[st.reason] || ''
  }
  const resultLine = () => {
    if (st.status === 'playing') return st.check ? t.inCheckNow : ''
    const why2 = reasonText()
    if (st.result === 'draw') return why2
    const who = st.result === 'w' ? nameFor(0) : nameFor(1)
    return `${who} ${t.won} — ${why2}`
  }
  const overTitle = () => {
    if (st.result === 'draw') return t.drawTitle
    if (viewer) return `${st.result === 'w' ? nameFor(0) : nameFor(1)} ${t.won}`
    return st.result === mySide ? t.youWon : t.youLost
  }

  // ---- the one line that always says what is expected now ------------------
  const guide = (() => {
    if (st.status !== 'playing') return { text: `${overTitle()} — ${reasonText()}`, tone: 'over' }
    // NB: sentences are joined with a full stop, never a middle dot — in an
    // Arabic face a middle dot reads as the Arabic-Indic zero, and this repo
    // ships Latin digits only.
    if (viewer) {
      const who = st.turn === 'w' ? t.white : t.black
      return { text: `${t.gSpectate} ${lang === 'en' ? `${who} ${t.toMove}` : `${t.turnOf} ${who}`}`, tone: 'flat' }
    }
    if (waitingForPlayers) return { text: t.gWaitJoin, tone: 'flat' }
    if (offerFromFoe) return { text: t.gOfferIn, tone: 'warn' }
    if (offerFromMe) return { text: t.gOfferOut, tone: 'flat' }
    if (!myTurn) return { text: vsBot && botBusy ? t.gBot : t.gWait, tone: 'flat' }
    if (why) return { text: why.text, tone: 'warn' }
    if (st.check) return { text: t.gCheck, tone: 'bad' }
    const next = sel !== null ? t.gTarget : t.gPick
    // a claim that just became available is a rule the player cannot see on the
    // board, so the line says it out loud rather than only growing a button
    if (canClaimThree) return { text: `${t.threeReady} — ${next}`, tone: 'warn' }
    if (canClaimFifty) return { text: `${t.fiftyReady} — ${next}`, tone: 'warn' }
    return { text: next, tone: 'live' }
  })()

  const advW = materialOf(st.takenByW) - materialOf(st.takenByB)

  // called, not mounted: a nested component would remount its whole subtree on
  // every snapshot and kill the press/entrance transitions
  const renderSeat = (s) => {
    const active = st.status === 'playing' && seatOfSide(st.turn) === s
    const taken = byValueDesc(s === 0 ? st.takenByW : st.takenByB)
    const lead = s === 0 ? advW : -advW
    // A viewer holds no seat, so «دور الخصم» would be a lie: they get the
    // neutral "to move" instead.
    const state = st.status !== 'playing'
      ? (st.result === 'draw' ? t.drawTitle : st.result === sideOfSeat(s) ? t.won : '')
      : active
        ? (vsBot && s === 1 && botBusy ? t.thinking : viewer ? t.toMove : seat === s ? t.yourTurn : t.theirTurn)
        : ''
    return (
      <div className="chs-seat" data-active={active ? '1' : '0'} data-me={seat === s ? '1' : '0'}>
        <span className="chs-badge" data-side={s === 0 ? 'w' : 'b'} data-off={connFor(s) ? '0' : '1'}>
          <PieceSvg code={s === 0 ? 'K' : 'k'} shadow={false} />
        </span>
        <span className="chs-seat-mid">
          <span className="chs-seat-top">
            <b className="chs-seat-name">{nameFor(s)}</b>
            {seat === s ? <em className="chs-tag">{t.you}</em> : null}
            {connFor(s) ? null : <em className="chs-tag" data-tone="off">—</em>}
          </span>
          <span className="chs-tray" aria-hidden="true">
            {taken.map((c, i) => (
              <span className="chs-tray-pc" key={`${c}${i}`}><PieceSvg code={c} shadow={false} /></span>
            ))}
            {/* dir=ltr, or Arabic bidi reorders the sign and «+1» reads «1+» */}
            {lead > 0 ? <b className="chs-adv" dir="ltr">+{lead}</b> : null}
          </span>
        </span>
        <span className="chs-seat-state" data-live={active ? '1' : '0'}>
          {active ? <i className="chs-bead" aria-hidden="true" /> : null}
          {state}
        </span>
      </div>
    )
  }

  const moveRows = useMemo(() => {
    const rows = []
    const list = st.san || []
    for (let i = 0; i < list.length; i += 2) {
      rows.push({ no: Math.floor(i / 2) + 1, w: list[i], b: list[i + 1] || '', live: i >= list.length - 2 })
    }
    return rows
  }, [st.san])

  const movesRef = useRef(null)
  const liveRef = useRef(null)
  useEffect(() => {
    const box = movesRef.current
    const el = liveRef.current
    if (!box || !el) return
    const top = el.offsetTop - (box.clientHeight - el.offsetHeight) / 2
    try {
      box.scrollTo({ top: Math.max(0, top), behavior: prefersStill() ? 'auto' : 'smooth' })
    } catch (_) { box.scrollTop = Math.max(0, top) }
  }, [moveRows.length])

  const squares = []
  for (let idx = 0; idx < 64; idx += 1) {
    const r = Math.floor(idx / 8)
    const f = idx % 8
    const dark = (r + f) % 2 === 1
    const hint = targets.get(idx)
    const code = st.board[idx]
    squares.push(
      <button
        key={idx}
        type="button"
        className="chs-sq"
        data-shade={dark ? 'dark' : 'light'}
        data-sel={sel === idx ? '1' : '0'}
        data-last={st.lastFrom === idx || st.lastTo === idx ? '1' : '0'}
        data-check={checkSq === idx ? '1' : '0'}
        data-mark={marks.indexOf(idx) >= 0 ? '1' : '0'}
        aria-label={`${sqName(idx)}${code === '.' ? '' : ` — ${(lang === 'en' ? PIECE_EN : PIECE_AR)[code.toLowerCase()]}`}`}
        onClick={() => clickSquare(idx)}
        disabled={viewer || st.status !== 'playing' || !canAct}
      >
        {hint ? <span className="chs-dot" data-cap={hint.cap ? '1' : '0'} aria-hidden="true" /> : null}
        {/* mounted fresh each time, so the impact always replays */}
        {flash.sq === idx ? <span className="chs-burst" key={`f${flash.n}`} aria-hidden="true" /> : null}
        {shake.sq === idx ? <span className="chs-nope" key={`s${shake.n}`} aria-hidden="true" /> : null}
      </button>,
    )
  }

  const rematchAllowed = st.status !== 'playing' && !viewer && (!mp || isHostLike(room, mySeat))

  return (
    <div
      className="chs-root"
      style={{ '--chs-brand': brand }}
      data-turn={flipped ? '180' : '0'}
      data-over={st.status !== 'playing' ? '1' : '0'}
    >
      <ChessDefs />

      <div className="chs-main">
        {renderSeat(flipped ? 0 : 1)}

        <div className="chs-stage">
          <div className="chs-frame" dir="ltr" data-cheer={st.status !== 'playing' ? '1' : '0'}>
            <div className="chs-rankbar" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <span key={i}>{flipped ? i + 1 : 8 - i}</span>
              ))}
            </div>
            <div className="chs-filebar" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <span key={i}>{FILES[flipped ? 7 - i : i]}</span>
              ))}
            </div>

            <div className="chs-board" role="grid" aria-label="chess board">
              {squares}
              {/* pointer-events:none — the 64 buttons above own every tap */}
              <div className="chs-layer" aria-hidden="true">
                {pieces.map((p) => (
                  <div
                    key={p.id}
                    className="chs-pc"
                    style={{ '--f': p.idx % 8, '--r': Math.floor(p.idx / 8) }}
                    data-sel={sel === p.idx ? '1' : '0'}
                    data-stuck={myTurn && owner(p.code) === st.turn && !movable.has(p.idx) ? '1' : '0'}
                    data-born={p.born ? '1' : '0'}
                    data-shake={shake.sq === p.idx ? (shake.n % 2 ? 'a' : 'b') : '0'}
                  >
                    <span className="chs-pc-in">
                      <PieceSvg code={p.code} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {renderSeat(flipped ? 1 : 0)}
      </div>

      <div className="chs-side">
        <div className="chs-panel">
          <div className="chs-panel-head">
            <span className="chs-panel-title">
              {t.moves}
              {advW !== 0 ? (
                <em className="chs-panel-note">
                  {t.material} {advW > 0 ? nameFor(0) : nameFor(1)} <bdi dir="ltr">+{Math.abs(advW)}</bdi>
                </em>
              ) : null}
            </span>
            {/* the level lives WITH the note that describes it, not in the
                action bar — that keeps the action bar short enough to fit a
                360px phone without scrolling to reach «انسحاب» */}
            {vsBot && st.status === 'playing' ? (
              <span className="chs-seg" data-size="sm" role="group" aria-label={t.level}>
                {LEVELS.map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    className="chs-seg-btn chs-press"
                    data-on={level === lv ? '1' : '0'}
                    aria-pressed={level === lv}
                    onClick={() => {
                      setLevel(lv)
                      try { localStorage.setItem(LEVEL_KEY, lv) } catch (_) { /* storage off */ }
                      play('click', { gain: 0.5 })
                    }}
                  >
                    {t[lv]}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
          <div className="chs-moves chs-scroll" ref={movesRef}>
            {moveRows.length === 0 ? (
              <p className="chs-empty">
                {waitingForPlayers ? t.waiting : viewer ? t.gSpectate : vsBot ? t[level === 'easy' ? 'lvEasy' : level === 'hard' ? 'lvHard' : 'lvNormal'] : mp ? t.noMoves : t.hotseat}
              </p>
            ) : moveRows.map((row) => (
              <div className="chs-mrow" key={row.no} data-live={row.live ? '1' : '0'} ref={row.live ? liveRef : null}>
                <span className="chs-mno">{row.no}.</span>
                <span className="chs-msan">{row.w}</span>
                <span className="chs-msan">{row.b}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="chs-bar">
          <p className="chs-guide" data-tone={guide.tone} aria-live="polite">
            {guide.tone === 'bad' || guide.tone === 'warn' ? <Icon name="warning" size={14} /> : null}
            <span>{guide.text}</span>
          </p>

          <div className="chs-actions chs-scroll">
            <button type="button" className="chs-btn chs-press" onClick={() => { setFlipPin(!flipped); play('click', { gain: 0.5 }) }}>
              <Icon name="repeat" size={14} />{t.flip}
            </button>

            {offerFromFoe && st.status === 'playing' ? (
              <>
                <button type="button" className="chs-btn chs-press" data-tone="brand" onClick={() => submit({ type: 'acceptDraw' })}>
                  <Icon name="check" size={14} />{t.accept}
                </button>
                <button type="button" className="chs-btn chs-press" onClick={() => submit({ type: 'declineDraw' })}>{t.decline}</button>
              </>
            ) : null}

            {canClaimFifty || canClaimThree ? (
              <button
                type="button"
                className="chs-btn chs-press"
                data-tone="brand"
                onClick={() => submit({ type: 'claimDraw', kind: canClaimThree ? 'threefold' : 'fifty' })}
              >
                <Icon name="scale" size={14} />{t.claimDraw}
              </button>
            ) : null}

            {st.status === 'playing' && canAct && !offerFromFoe ? (
              <button type="button" className="chs-btn chs-press" onClick={() => submit({ type: 'offerDraw' })} disabled={offerFromMe} title={t.offerDraw}>
                <Icon name="scale" size={14} />{t.drawShort}
              </button>
            ) : null}

            {st.status === 'playing' && canAct ? (
              <button type="button" className="chs-btn chs-press" data-tone="bad" onClick={() => setAskResign(true)}>
                <Icon name="no" size={14} />{t.resign}
              </button>
            ) : null}

            {rematchAllowed && canAct ? (
              <button type="button" className="chs-btn chs-press" data-tone="brand" onClick={() => submit({ type: 'newGame' })}>
                <Icon name="reload" size={14} />{t.newGame}
              </button>
            ) : null}

            {onExit && !viewer ? (
              <button type="button" className="chs-btn chs-press" onClick={onExit} aria-label={t.exit}>
                <Icon name="close" size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {promo ? (
        <div className="chs-modal" role="dialog" aria-modal="true">
          <div className="chs-card">
            <h3>{t.promote}</h3>
            <p>{t.promoteNote}</p>
            <div className="chs-promo-row">
              {['q', 'r', 'b', 'n'].map((p) => (
                <button
                  key={p}
                  type="button"
                  className="chs-promo-btn chs-press"
                  onClick={() => submit({ type: 'move', from: promo.from, to: promo.to, promo: p })}
                  aria-label={(lang === 'en' ? PIECE_EN : PIECE_AR)[p]}
                >
                  <PieceSvg code={st.turn === 'w' ? p.toUpperCase() : p} />
                </button>
              ))}
            </div>
            <button type="button" className="chs-btn chs-press" onClick={() => setPromo(null)}>{t.no}</button>
          </div>
        </div>
      ) : null}

      {askResign ? (
        <div className="chs-modal" role="dialog" aria-modal="true">
          <div className="chs-card">
            <h3>{t.resignAsk}</h3>
            <p>{t.resignNote}</p>
            <div className="chs-card-row">
              <button type="button" className="chs-btn chs-press" data-tone="bad" onClick={() => { setAskResign(false); submit({ type: 'resign' }) }}>{t.yes}</button>
              <button type="button" className="chs-btn chs-press" onClick={() => setAskResign(false)}>{t.no}</button>
            </div>
          </div>
        </div>
      ) : null}

      {st.status !== 'playing' && !overSeen && !viewer ? (
        <div className="chs-modal" role="dialog" aria-modal="true">
          <div className="chs-card" data-kind="over">
            <span className="chs-over-mark" data-tone={st.result === 'draw' ? 'draw' : st.result === mySide ? 'win' : 'lose'}>
              <Icon name={st.result === 'draw' ? 'scale' : 'award'} size={26} />
            </span>
            <h3>{overTitle()}</h3>
            <p>{resultLine()}</p>
            <div className="chs-card-row">
              {rematchAllowed ? (
                <button type="button" className="chs-btn chs-press" data-tone="brand" onClick={() => { setOverSeen(true); submit({ type: 'newGame' }) }}>
                  <Icon name="reload" size={14} />{t.rematch}
                </button>
              ) : null}
              <button type="button" className="chs-btn chs-press" onClick={() => setOverSeen(true)}>
                <Icon name="eye" size={14} />{t.review}
              </button>
              {onExit ? (
                <button type="button" className="chs-btn chs-press" onClick={onExit}>
                  <Icon name="close" size={14} />{t.exit}
                </button>
              ) : null}
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
