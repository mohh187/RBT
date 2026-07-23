// ===========================================================================
// LIVE VENUE SPECTATOR + TOURNAMENT LAYER — the data half of what the venue's
// TV puts on the wall.
//
// This module answers four questions for the signage player, and renders
// nothing:
//   1. is there a table-versus-table MATCH this venue can show right now?
//   2. is there a live ROOM (four friends around one table) it may show?
//   3. which rooms are still waiting for players, so the wall can invite the
//      cafe to walk over and join one?
//   4. is a TOURNAMENT running, and what are its standings?
//
// It reads only world-readable documents the players' own phones already read —
// firestore.rules makes `matches`, `rooms`, `tournaments` and
// `tournaments/{id}/entries` all `allow read: if true` — so a TV paired with
// nothing but a six-character screen code needs no auth and no rules change.
//
// The match/room shape comes from lib/socialPlay.js (normalizeMatch) and
// lib/gameRoom.js; watching an individual room is left to the caller
// (gameRoom.watchRoom) because the board component needs that same room.
//
// ===========================================================================
// SAFETY LIMIT 1 — WHICH GAMES MAY BE SHOWN AT ALL (privacy)
// ---------------------------------------------------------------------------
// A public screen shows the ROOM STATE to everyone in the cafe. Some games keep
// nothing private in it — a chess position and a ludo board are the same
// information both players see across the table. Others keep every player's
// HAND inside that same shared state, because it is the only place four phones
// can agree on a deal, and putting one of those on the wall would broadcast a
// guest's cards to the whole room.
//
// A hidden-hand game is therefore showable ONLY if its component renders a
// SEATLESS viewer (mySeat === null) without drawing anybody's hand. That is a
// property of the game file, it was verified by reading each one, and it is
// recorded per game below with the evidence. SPECTATE_GAMES is an ALLOWLIST:
// a game is unshowable until someone deliberately certifies it.
//
//   chess     no hidden state at all.
//   ludo      no hidden state at all.
//   dominoes  CERTIFIED. `seat` is null for a seatless remote viewer, and the
//             hand it renders is `owner === null ? [] : …` — empty. Other seats
//             only ever expose a tile COUNT, and the board draws its own
//             «أنت متفرّج» strip.
//   jackaroo  CERTIFIED. `seated = !remote || Number.isInteger(mySeat)` is
//             false for a seatless viewer and the whole hand block is gated
//             behind it. Other seats expose a card COUNT only.
//   wist      CERTIFIED. `seated` (same shape as Jackaroo) drives
//             `myHand = seated ? st.hands[seat] : []`, every seat including the
//             bottom one renders as CARD BACKS for an unseated viewer, and the
//             board prints «أوراق اللاعبين مخفية».
//   haree     CERTIFIED. `spectator = remote && !seated` forces `seat = -1`, so
//             `myHand = seat >= 0 ? … : []` is empty, and the hand area is
//             replaced by a watch panel of card backs.
//
// The four card games above were re-read and re-certified after their boards
// were rewritten; each now ships a deliberate seatless mode. Certification is
// still a claim about code other people edit, which is exactly why the
// redaction layer below exists and is not optional.
//
// ===========================================================================
// SAFETY LIMIT 2 — REDACTION (defence in depth, because game files change)
// ---------------------------------------------------------------------------
// The certification above is a statement about code that other people edit. So
// the screen never hands a board the raw room: `redactRoomForSpectator` strips
// the private fields out of `state` first, keeping every array's LENGTH (the
// counts the boards legitimately display) and destroying its CONTENT. If a
// future edit ever did draw seat 0's hand on a spectator screen, it would draw
// a row of identical placeholder tiles rather than a guest's real hand.
//
// Redaction is render-only. A spectator holds no seat and submits no move, so
// no reducer ever runs against the redacted state.
//
// ===========================================================================
// SAFETY LIMIT 3 — WHEN A PRIVATE ROOM MAY GO ON THE WALL (consent)
// ---------------------------------------------------------------------------
// A table-versus-table MATCH is a public challenge between two tables — it is
// already announced to the venue, so it takes the screen automatically.
//
// A plain ROOM is four friends who invited each other. Putting that on the wall
// unasked is a different thing, and there is no per-room "broadcast me" switch
// to ask with. The venue-level switch that already exists and already means
// exactly "we are running a competition in this cafe tonight" is a RUNNING
// TOURNAMENT. So live rooms — and the open-room codes on the join panel — are
// offered to the screen ONLY while `statusOf(tournament) === 'running'`.
// Nothing new to configure, and the owner turns it on and off by running a
// tournament, which is precisely the moment they want it.
// ===========================================================================
import { collection, onSnapshot, query, orderBy, where, limit } from 'firebase/firestore'
import { db, firebaseReady } from './firebase.js'
import { normalizeMatch } from './socialPlay.js'

// ---------------------------------------------------------------------------
// The game registry. `safe` is the allowlist; `why` is the sentence the screen
// prints when it refuses, because a refusal the room cannot read is
// indistinguishable from a broken screen.
// ---------------------------------------------------------------------------
export const SPECTATE_GAMES = {
  chess: {
    safe: true,
    ar: 'الشطرنج',
    en: 'Chess',
    metricAr: 'قِطع مأخوذة',
    metricEn: 'captured',
  },
  ludo: {
    safe: true,
    ar: 'الليدو',
    en: 'Ludo',
    metricAr: 'إلى المركز',
    metricEn: 'home',
  },
  dominoes: {
    safe: true,
    ar: 'الدومينو',
    en: 'Dominoes',
    metricAr: 'نقطة',
    metricEn: 'points',
  },
  jackaroo: {
    safe: true,
    ar: 'الجكارو',
    en: 'Jackaroo',
    metricAr: 'بِلي في البيت',
    metricEn: 'marbles home',
  },
  wist: {
    safe: true,
    ar: 'الوِست',
    en: 'Wist',
    metricAr: 'نقطة',
    metricEn: 'points',
  },
  haree: {
    safe: true,
    ar: 'الحريق',
    en: 'Hareeg',
    metricAr: 'جولات',
    metricEn: 'rounds won',
  },
}

// The ONLY games a live venue screen may ever show.
export const SPECTATABLE_GAMES = Object.keys(SPECTATE_GAMES).filter((k) => SPECTATE_GAMES[k].safe)
export const isSpectatableGame = (gameId) => SPECTATABLE_GAMES.includes(String(gameId || ''))

export function spectateGameName(gameId, lang = 'ar') {
  const g = SPECTATE_GAMES[String(gameId || '')]
  if (!g) return String(gameId || '')
  return lang === 'en' ? g.en : g.ar
}

// The honest sentence behind a refusal. A game we have never heard of gets a
// true sentence too — "not certified" — rather than a blank panel.
export function spectateRefusal(gameId, lang = 'ar') {
  const ar = lang !== 'en'
  const g = SPECTATE_GAMES[String(gameId || '')]
  if (g && !g.safe) return ar ? g.whyAr : g.whyEn
  return ar
    ? 'هذه اللعبة لم تُعتمد بعد للعرض على شاشة عامة، فلا تُعرض.'
    : 'This game is not certified for a public screen, so it is not shown.'
}

// ---------------------------------------------------------------------------
// Bounds — every read is capped, and none of them needs a composite index.
// ---------------------------------------------------------------------------
// Recent matches scanned. A single-field orderBy(updatedAt) + limit is served
// by the automatic single-field index (this mirrors watchTableMatches).
export const SPECTATE_SCAN = 30
// Rooms scanned per status. where('status','==',…) + limit is a single-field
// query — also automatic. Sorting happens on the client.
export const SPECTATE_ROOM_SCAN = 40
// A match whose last write is older than this is treated as surely-over and is
// never offered to the screen — a backstop to the room-level watchdog below.
export const SPECTATE_MATCH_MAX_AGE_MS = 3 * 60 * 60 * 1000 // 3h
// DEAD-BOARD WATCHDOG. A live room is written on every move AND on every ~10s
// presence heartbeat while a player has the board open, so a room silent for
// longer than this has been abandoned — the screen must hand itself back to the
// playlist rather than freeze on a dead position. Deliberately generous so a
// long think never trips it; the next move auto-cuts the screen straight back.
export const SPECTATE_ROOM_STALE_MS = 5 * 60 * 1000 // 5 min
// A lobby room silent longer than this is not really waiting for anybody, so
// its code is not put on the wall as an invitation.
export const SPECTATE_LOBBY_STALE_MS = 12 * 60 * 1000 // 12 min
// How long a finished board is celebrated before the screen returns to the
// playlist: show the win/draw banner, then release.
export const SPECTATE_RESULT_HOLD_MS = 15 * 1000

const num = (v, f = 0) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const errText = (err) => String(err?.code || err?.message || 'error')
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n)

// ---------------------------------------------------------------------------
// REDACTION — see SAFETY LIMIT 2 above.
//
// Each redactor keeps the shape and every length the boards legitimately draw
// (a tile count, a card count) and replaces the identities with one constant
// placeholder that is a VALID value for that game, so nothing downstream has to
// parse an unexpected token.
// ---------------------------------------------------------------------------
const DOM_BLANK = '0:0'   // ALL_TILES format in Dominoes.jsx is `${a}:${b}`
const CARD_BLANK = '2S'   // RANKS + SUITS in Jackaroo.jsx and Wist.jsx
const HAREE_BLANK = '2S0' // Haree.jsx appends the deck index: `${rank}${suit}${d}`

const blankArray = (v, fill) => (Array.isArray(v) ? v.map(() => fill) : v)

// Public-by-play fields are deliberately LEFT ALONE: the dominoes line, the
// wist trick and `seen`, the haree discard pile and melds are all cards that
// have already been played face-up in front of everybody.
const REDACTORS = {
  // hands: { '0': [tileId…], … }   boneyard: [tileId…]
  dominoes(state) {
    const out = { ...state }
    if (state.hands && typeof state.hands === 'object' && !Array.isArray(state.hands)) {
      const hands = {}
      for (const k of Object.keys(state.hands)) hands[k] = blankArray(state.hands[k], DOM_BLANK)
      out.hands = hands
    }
    if (Array.isArray(state.boneyard)) out.boneyard = blankArray(state.boneyard, DOM_BLANK)
    return out
  },
  // hands: [[code…] x4]            deck: [code…]
  jackaroo(state) {
    const out = { ...state }
    if (Array.isArray(state.hands)) out.hands = state.hands.map((h) => blankArray(h, CARD_BLANK))
    if (Array.isArray(state.deck)) out.deck = blankArray(state.deck, CARD_BLANK)
    return out
  },
  // hands: [[code…] x4]. Wist has no undealt stock — all 52 cards are dealt.
  wist(state) {
    const out = { ...state }
    if (Array.isArray(state.hands)) out.hands = state.hands.map((h) => blankArray(h, CARD_BLANK))
    return out
  },
  // hands: [[code…] x4]            stock: [code…]
  haree(state) {
    const out = { ...state }
    if (Array.isArray(state.hands)) out.hands = state.hands.map((h) => blankArray(h, HAREE_BLANK))
    if (Array.isArray(state.stock)) out.stock = blankArray(state.stock, HAREE_BLANK)
    return out
  },
}

// Returns the room a spectator board may be handed. Same object back when the
// game holds nothing private (chess, ludo) so React sees no needless change.
// Never throws: a state shape we do not recognise is passed through untouched
// for the games that have no secrets, and the allowlist already refused the
// ones that do.
export function redactRoomForSpectator(room) {
  if (!room) return room
  const fn = REDACTORS[String(room.gameId || '')]
  if (!fn) return room
  const state = room.state
  if (!state || typeof state !== 'object') return room
  try {
    return { ...room, state: fn(state) }
  } catch (_) {
    // A redactor that cannot do its job must not let the raw hand through.
    return { ...room, state: {} }
  }
}

// ---------------------------------------------------------------------------
// isSpectateCandidate — a match the screen may consider.
// ---------------------------------------------------------------------------
// It must be a certified game, have a room attached, still be in play (not
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
// screen should show now: the most-recently-touched live match with a room.
// Also reports the full candidate list so a caller could reason further.
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
// ROOMS — the other 90% of what actually gets played.
//
// Most rounds in a cafe are plain rooms ("play with my table", "invite a
// friend"), which carry no match document at all. A screen that only watched
// `matches` therefore sat on the menu playlist through an entire tournament
// night. These two watchers are single-field equality queries + limit, so they
// need no composite index.
//
// Consent: see SAFETY LIMIT 3. The CALLER decides whether it is allowed to use
// these right now; they are dumb readers.
// ---------------------------------------------------------------------------
function watchRoomsByStatus(tid, status, cb) {
  if (!firebaseReady || !tid) {
    setTimeout(() => cb?.({ rooms: [], error: 'unavailable' }), 0)
    return () => {}
  }
  return onSnapshot(
    query(collection(db, 'tenants', tid, 'rooms'), where('status', '==', status), limit(SPECTATE_ROOM_SCAN)),
    (snap) => cb?.({ rooms: snap.docs.map((d) => ({ id: d.id, ...d.data() })), error: null }),
    (err) => cb?.({ rooms: [], error: errText(err) }),
  )
}

// Live boards. cb({ rooms, error }) — `rooms` are raw room documents.
export function watchLiveGameRooms(tid, cb) { return watchRoomsByStatus(tid, 'playing', cb) }
// Rooms still filling up. cb({ rooms, error }).
export function watchOpenGameRooms(tid, cb) { return watchRoomsByStatus(tid, 'lobby', cb) }

// PURE. The one live room the screen should show: certified game, fresh enough
// to be alive, most recently written. Null when there is nothing to show.
export function pickSpectateRoom(rooms, now = Date.now()) {
  return (Array.isArray(rooms) ? rooms : [])
    .filter((r) => r && r.status === 'playing')
    .filter((r) => isSpectatableGame(r.gameId))
    .filter((r) => num(r.updatedAt) >= now - SPECTATE_ROOM_STALE_MS)
    .sort((a, b) => num(b.updatedAt) - num(a.updatedAt))[0] || null
}

// PURE. Rooms whose code the wall may print as an invitation: still in the
// lobby, still has a free seat, still being watched by somebody. Newest first.
// Returns a trimmed public shape — a room document carries no phone (see
// gameRoom.normalizePlayer), and only the fields below ever leave this file.
export function openRoomInvites(rooms, now = Date.now(), max = 3) {
  return (Array.isArray(rooms) ? rooms : [])
    .filter((r) => r && r.status === 'lobby' && r.roomId)
    .filter((r) => num(r.updatedAt) >= now - SPECTATE_LOBBY_STALE_MS)
    .map((r) => {
      const players = Array.isArray(r.players) ? r.players : []
      const seats = Math.max(2, Math.min(4, num(r.maxPlayers, 2)))
      return {
        roomId: String(r.roomId),
        gameId: String(r.gameId || ''),
        tableLabel: str(r.tableLabel, 24),
        taken: players.length,
        seats,
        free: Math.max(0, seats - players.length),
        hostName: str(players.find((p) => p.id === r.hostId)?.name, 20),
        updatedAt: num(r.updatedAt),
      }
    })
    .filter((r) => r.free > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, max))
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
// liveSideScore — a live, honest per-seat figure taken from COMMITTED room
// state: the very progress each board already draws, surfaced big for the room.
// Best-effort — returns null when the state is not the shape we expect, and the
// caller then shows no number rather than a guess.
//   ludo      tokens that reached the centre (0..4)
//   chess     number of pieces that seat has captured
//   dominoes  the match score (first to 101 wins)
//   jackaroo  marbles parked in the home lane (0..4)
// These constants mirror the games' own displays; they are small and stable,
// but if a board ever changes shape this returns null and degrades gracefully.
// ---------------------------------------------------------------------------
const LUDO_HOME = 56 // mirrors HOME in components/games/Ludo.jsx (the centre square)
const JAK_L0 = 100   // mirrors L0 in components/games/Jackaroo.jsx (home lane base)
const JAK_LANE = 4   // mirrors LANE

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
    if (gameId === 'dominoes') {
      // scores is keyed by seat STRING and counts toward the 101 target.
      const sc = state && state.scores
      if (!sc || typeof sc !== 'object') return null
      const v = sc[String(seat)]
      return Number.isFinite(Number(v)) ? Number(v) : null
    }
    if (gameId === 'jackaroo') {
      const row = state && Array.isArray(state.marbles) ? state.marbles[Number(seat)] : null
      if (!Array.isArray(row)) return null
      return row.filter((p) => p >= JAK_L0 && p < JAK_L0 + JAK_LANE).length
    }
    if (gameId === 'wist') {
      // A partnership game: scores is [teamA, teamB] and seats 0+2 / 1+3 share
      // one. Both partners therefore show the SAME number, which is the truth
      // of the game — a per-player figure here would be an invention.
      const sc = state && state.scores
      if (!Array.isArray(sc)) return null
      const v = sc[Number(seat) % 2]
      return Number.isFinite(Number(v)) ? Number(v) : null
    }
    if (gameId === 'haree') {
      // ROUNDS WON, not burn points. Burns count UP toward elimination at 31,
      // so a big burn number on a wall reads as a big score and says the
      // opposite of what it means. Rounds won cannot be misread.
      const rw = state && state.roundsWon
      if (!Array.isArray(rw)) return null
      const v = rw[Number(seat)]
      return Number.isFinite(Number(v)) ? Number(v) : null
    }
  } catch (_) { /* fall through to null */ }
  return null
}

// A short caption for the number above, so the room knows what it is counting.
export function spectateMetric(gameId, lang = 'ar') {
  const g = SPECTATE_GAMES[String(gameId || '')]
  if (!g || !g.safe) return ''
  return lang === 'en' ? g.metricEn : g.metricAr
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

// The same vocabulary for a room with NO match document behind it.
export function roomPhase(room, now = Date.now()) {
  if (!room || !isSpectatableGame(room.gameId)) return 'none'
  if (room.status === 'ended') return 'ended'
  if (room.status === 'playing') return spectateStale(room, now) ? 'stale' : 'live'
  return 'waiting'
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
      label: str(rawLabel, 40),
      player: p ? str(p.name, 24) : '',
      connected: p ? p.connected !== false : true,
      isTurn: playing && turnSeat === seat,
      score: liveSideScore(match?.gameId, room?.state, seat),
    }
  })
}

// ---------------------------------------------------------------------------
// roomSeats — the same scoreboard for a plain room, one card PER PLAYER (two to
// four of them) instead of two table sides. Seat order, because that is the
// order the game itself plays in and the order the board draws.
// ---------------------------------------------------------------------------
export function roomSeats(room) {
  const turnSeat = room && room.turn && Number.isInteger(room.turn.seat) ? room.turn.seat : null
  const playing = !!room && room.status === 'playing'
  const ended = !!room && room.status === 'ended'
  const winner = ended && room.winnerSeat !== null && room.winnerSeat !== undefined
    ? Number(room.winnerSeat)
    : null
  // Partnership games report winnerSeat as the winning TEAM (0|1: seats 0+2 vs
  // 1+3), exactly as socialPlay.tableChampions documents. A plain seat compare
  // would crown one player of a winning pair and dim their partner.
  const teamGame = room?.gameId === 'jackaroo' || room?.gameId === 'wist'
  return roomPlayers(room)
    .slice()
    .sort((a, b) => num(a.seat) - num(b.seat))
    .map((p) => {
      const seat = num(p.seat)
      const won = winner === null
        ? false
        : (teamGame ? seat % 2 === winner : seat === winner)
      return {
        seat,
        label: str(p.name, 24) || `لاعب ${seat + 1}`,
        player: '',
        connected: p.connected !== false,
        isTurn: playing && turnSeat === seat,
        score: liveSideScore(room?.gameId, room?.state, seat),
        winner: ended && won,
        loser: ended && winner !== null && !won,
      }
    })
}

// Who the room is waiting on right now — the «من يلعب الآن» line. Empty string
// when nobody is on turn (a free-for-all game, or a finished board), never a
// guess.
export function turnPlayerName(room) {
  if (!room || room.status !== 'playing') return ''
  const seat = room.turn && Number.isInteger(room.turn.seat) ? room.turn.seat : null
  if (seat === null) return ''
  const p = roomPlayers(room).find((x) => Number(x.seat) === seat)
  return p ? str(p.name, 24) : ''
}

// The room's own result, for a room shown without a match document.
export function roomResult(room) {
  if (!room || room.status !== 'ended') return { over: false, winnerSeat: null, draw: false }
  const ws = room.winnerSeat
  if (ws === null || ws === undefined) return { over: true, winnerSeat: null, draw: true }
  return { over: true, winnerSeat: Number(ws), draw: false }
}
