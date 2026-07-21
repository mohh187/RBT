// ===========================================================================
// LIVE VENUE SPECTATOR SCREEN — find the match a venue's TV puts on the wall,
// watch it, and know the instant it dies.
//
// This module answers ONE question for the signage player: "is there a
// table-versus-table match this venue can show the whole room right now, and is
// it still alive?" It renders nothing and writes nothing. It reads the same
// world-readable documents the players' own phones read — firestore.rules makes
// both `matches` and `rooms` `allow read: if true` — so a TV paired with only a
// six-character screen code needs no auth and no rules change to watch a match.
//
// It borrows the shape of the match from lib/socialPlay.js (normalizeMatch) and
// leaves watching the ROOM itself to the caller (lib/gameRoom.js → watchRoom),
// because the board component needs that same room to render. The room is the
// authoritative live signal: a match document stays `accepted` for the whole
// game (nothing flips it to `playing`), so "is a round actually running" is a
// property of the ROOM's status, never the match's.
//
// ---------------------------------------------------------------------------
// HARD SAFETY LIMIT — CHESS and LUDO ONLY. Read this before adding a game.
// ---------------------------------------------------------------------------
// A public screen shows the ROOM STATE to everyone in the cafe, and every phone
// can already query that state. Chess and Ludo keep NOTHING private in it: a
// chess position and a ludo board are the same information both players see
// across the table. Wist and Jackaroo do the OPPOSITE — each player's HAND
// lives inside the shared room state, because that is the only place four phones
// can agree on the deal. Putting either on a public screen would broadcast a
// guest's private cards to the whole room. So they are refused here, by name and
// structurally: SPECTATABLE_GAMES is an allowlist, not a denylist, so a game is
// unshowable until someone deliberately and knowingly adds it. Do NOT add wist,
// jackaroo, or any other hidden-information game to this list.
// ===========================================================================
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore'
import { db, firebaseReady } from './firebase.js'
import { normalizeMatch } from './socialPlay.js'

// The ONLY games a live venue screen may ever show. See the safety note above.
export const SPECTATABLE_GAMES = ['chess', 'ludo']
export const isSpectatableGame = (gameId) => SPECTATABLE_GAMES.includes(String(gameId || ''))

// ---------------------------------------------------------------------------
// Bounds — every read is capped, and none of them needs a composite index.
// ---------------------------------------------------------------------------
// Recent matches scanned. A single-field orderBy(updatedAt) + limit is served
// by the automatic single-field index (this mirrors watchTableMatches).
export const SPECTATE_SCAN = 30
// A match whose last write is older than this is treated as surely-over and is
// never offered to the screen — a backstop to the room-level watchdog below.
export const SPECTATE_MATCH_MAX_AGE_MS = 3 * 60 * 60 * 1000 // 3h
// DEAD-BOARD WATCHDOG. A live room is written on every move AND on every ~10s
// presence heartbeat while a player has the board open, so a room silent for
// longer than this has been abandoned — the screen must hand itself back to the
// playlist rather than freeze on a dead position. Deliberately generous so a
// long think never trips it; the next move auto-cuts the screen straight back.
export const SPECTATE_ROOM_STALE_MS = 5 * 60 * 1000 // 5 min
// How long a finished board is celebrated before the screen returns to the
// playlist: show the win/draw banner, then release.
export const SPECTATE_RESULT_HOLD_MS = 15 * 1000

const num = (v, f = 0) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const errText = (err) => String(err?.code || err?.message || 'error')

// ---------------------------------------------------------------------------
// isSpectateCandidate — a match the screen may consider.
// ---------------------------------------------------------------------------
// It must be a chess/ludo match, have a room attached, still be in play (not
// finished / declined / cancelled), and have been touched recently enough to be
// real. This filters the match list; the ROOM watchdog decides live-vs-dead.
export function isSpectateCandidate(m, now = Date.now()) {
  if (!m) return false
  if (!isSpectatableGame(m.gameId)) return false
  if (!m.roomId) return false
  // 'accepted' = a room was created (TableVsTable.accept). 'playing' is set by
  // the optional attachRoom path. 'pending' has no room yet; every other status
  // is a match that is over.
  if (m.status !== 'accepted' && m.status !== 'playing') return false
  if (num(m.updatedAt) < now - SPECTATE_MATCH_MAX_AGE_MS) return false
  return true
}

// ---------------------------------------------------------------------------
// watchSpectatableMatch — streams the venue's matches and reports the ONE the
// screen should show now: the most-recently-touched live chess/ludo match with
// a room. Also reports the full candidate list so a caller could reason further.
//
// cb({ match, candidates, error }) — a null match is a RESULT ("nothing to
// show"), never a silent hang: the error callback always fires so the caller can
// print a sentence instead of spinning.
//
// KNOWN, HONEST LIMITATION: a match document cannot tell a lobby apart from a
// live board (its status is `accepted` for both), so if two tables are mid-match
// at once this returns whichever was accepted most recently. Should that newest
// one still be warming up in its lobby, the screen shows its honest "waiting"
// state (or, since the takeover only fires on a LIVE room, simply keeps playing
// the normal signage) rather than the older live game. It never strands and it
// never fabricates a match — it just may miss the rarer of two simultaneous
// games until the newer one starts or ages out.
// ---------------------------------------------------------------------------
export function watchSpectatableMatch(tid, cb) {
  if (!firebaseReady || !tid) {
    setTimeout(() => cb?.({ match: null, candidates: [], error: 'unavailable' }), 0)
    return () => {}
  }
  return onSnapshot(
    query(collection(db, 'tenants', tid, 'matches'), orderBy('updatedAt', 'desc'), limit(SPECTATE_SCAN)),
    (snap) => {
      const now = Date.now()
      const candidates = snap.docs
        .map((d) => normalizeMatch({ id: d.id, ...d.data() }))
        .filter((m) => isSpectateCandidate(m, now))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      cb?.({ match: candidates[0] || null, candidates, error: null })
    },
    (err) => cb?.({ match: null, candidates: [], error: errText(err) }),
  )
}

// ---------------------------------------------------------------------------
// Pure mapping helpers. The room's HOST is whichever table ACCEPTED the
// challenge, so seat 0 is NOT reliably table A. Identity is: each side's
// deviceId on the match equals that player's id in the room. Seat order is only
// a fallback for when identity is missing (a side that has not joined yet).
// ---------------------------------------------------------------------------
const roomPlayers = (room) => (room && Array.isArray(room.players) ? room.players : [])

export function sideForSeat(match, room, seat) {
  const p = roomPlayers(room).find((x) => Number(x.seat) === Number(seat))
  const aDev = match?.tableA?.deviceId
  const bDev = match?.tableB?.deviceId
  if (p && p.id && aDev && p.id === aDev) return 'A'
  if (p && p.id && bDev && p.id === bDev) return 'B'
  return Number(seat) === 1 ? 'B' : 'A'
}

export function seatForSide(match, room, side) {
  const dev = side === 'A' ? match?.tableA?.deviceId : match?.tableB?.deviceId
  const p = roomPlayers(room).find((x) => x.id && dev && x.id === dev)
  if (p) return Number(p.seat)
  return side === 'A' ? 0 : 1
}

// ---------------------------------------------------------------------------
// liveSideScore — a live, honest per-side figure taken from COMMITTED room
// state: the very progress each board already draws, surfaced big for the room.
// Best-effort — returns null when the state is not the shape we expect, and the
// caller then shows no number rather than a guess.
//   ludo  -> tokens that reached the centre (0..4)
//   chess -> number of pieces that side has captured
// These constants mirror the games' own displays; they are small and stable,
// but if a board ever changes shape this returns null and degrades gracefully.
// ---------------------------------------------------------------------------
const LUDO_HOME = 56 // mirrors HOME in components/games/Ludo.jsx (the centre square)

export function liveSideScore(gameId, state, seat) {
  try {
    if (gameId === 'ludo') {
      const toks = state && state.tokens && state.tokens[seat]
      if (!Array.isArray(toks)) return null
      return toks.filter((p) => p === LUDO_HOME).length
    }
    if (gameId === 'chess') {
      // seat 0 = white, seat 1 = black (seatOfSide in Chess.jsx); the pieces a
      // side has captured live in takenByW / takenByB.
      const taken = Number(seat) === 1 ? (state && state.takenByB) : (state && state.takenByW)
      if (typeof taken !== 'string') return null
      return taken.replace(/[^a-zA-Z]/g, '').length
    }
  } catch (_) { /* fall through to null */ }
  return null
}

// A short caption for the number above, so the room knows what it is counting.
export function spectateMetric(gameId, lang = 'ar') {
  const ar = lang !== 'en'
  if (gameId === 'ludo') return ar ? 'إلى المركز' : 'home'
  if (gameId === 'chess') return ar ? 'قِطع مأخوذة' : 'captured'
  return ''
}

// ---------------------------------------------------------------------------
// spectateStale / spectatePhase / spectateResult — the takeover + watchdog
// vocabulary, all derived from the authoritative ROOM.
// ---------------------------------------------------------------------------
export function spectateStale(room, now = Date.now()) {
  return !room || num(room.updatedAt) < now - SPECTATE_ROOM_STALE_MS
}

// 'none'    nothing to show
// 'waiting' a match + room exist but the round has not started (lobby / no room)
// 'live'    the room is playing and fresh — this is the ONLY hard-takeover state
// 'stale'   the room says playing but has been silent past the watchdog window
//           (abandoned board) — the screen must release
// 'ended'   the room finished — celebrate the result briefly, then release
export function spectatePhase(match, room, now = Date.now()) {
  if (!match || !isSpectatableGame(match.gameId)) return 'none'
  if (!room) return 'waiting'
  if (room.status === 'ended') return 'ended'
  if (room.status === 'playing') return spectateStale(room, now) ? 'stale' : 'live'
  return 'waiting' // 'lobby' or anything unexpected — not yet a board to show
}

// The finished result, read from the ROOM (authoritative and live) and mapped to
// a table side. A null winnerSeat on an ended room is a draw.
export function spectateResult(match, room) {
  if (!room || room.status !== 'ended') return { over: false, winner: null, draw: false }
  const ws = room.winnerSeat
  if (ws === null || ws === undefined) return { over: true, winner: null, draw: true }
  return { over: true, winner: sideForSeat(match, room, Number(ws)), draw: false }
}

// ---------------------------------------------------------------------------
// spectateSides — everything the scoreboard needs for both tables, mapped by
// identity and ordered A (challenger) then B (challenged).
// ---------------------------------------------------------------------------
export function spectateSides(match, room) {
  const turnSeat = room && room.turn && Number.isInteger(room.turn.seat) ? room.turn.seat : null
  const playing = !!room && room.status === 'playing'
  return ['A', 'B'].map((side) => {
    const seat = seatForSide(match, room, side)
    const p = roomPlayers(room).find((x) => Number(x.seat) === seat) || null
    const rawLabel = side === 'A' ? match?.tableA?.label : match?.tableB?.label
    return {
      side,
      seat,
      label: String(rawLabel || '').slice(0, 40),
      player: p ? String(p.name || '').slice(0, 24) : '',
      connected: p ? p.connected !== false : true,
      isTurn: playing && turnSeat === seat,
      score: liveSideScore(match?.gameId, room?.state, seat),
    }
  })
}
