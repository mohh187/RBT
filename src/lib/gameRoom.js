// ===========================================================================
// Multiplayer game rooms — four phones around one table share a live board.
//
// PATH   tenants/{tid}/rooms/{roomId}          (doc id === the room's own code)
//
// SHAPE  {
//   roomId, gameId, tableId|null, tableLabel,
//   status: 'lobby' | 'playing' | 'ended',
//   hostId,                                   // deviceId of the creator
//   players: [ { id, name, phone, seat, joinedAt, connected, lastSeenAt, score } ],
//   maxPlayers, minPlayers,
//   turn: { seat, startedAt, deadlineAt|null },
//   state: { ... },                           // owned by each game's reducer
//   moves: [ { seat, at, ...move } ],         // capped at MAX_MOVES, newest kept
//   winnerSeat|null, endedAt|null,
//   createdAt, updatedAt
// }
//
// ---------------------------------------------------------------------------
// WHAT THE TRANSACTION ACTUALLY GUARANTEES  (read this before trusting it)
// ---------------------------------------------------------------------------
// `applyMove` runs read-validate-reduce-write inside runTransaction. That buys
// exactly one thing, and it is the important one: SERIALISABILITY. Two phones
// tapping in the same instant can never both apply — the loser's transaction
// re-reads the room and re-validates against the winner's result, so a move is
// either applied to the state it was judged against or not applied at all.
// No lost updates, no double-apply, no two players taking the same seat.
//
// It is NOT anti-cheat. Firestore rules (see firestore.rules → match /rooms)
// let any anonymous device write this document, because diners have no
// accounts and a rule cannot know whose turn it is. The reducer runs on the
// CLIENT. A player who tampers with the bundle can therefore submit an illegal
// move, and nothing here stops them. Honest clients cannot corrupt each other;
// a dishonest one can corrupt the game. Fixing that needs the reduce to run in
// a Cloud Function (the reducers are pure, so it is a lift-and-shift when the
// stakes justify the cost). Until then: these are social games at a cafe table
// where everyone can see everyone's screen, and that is the real deterrent.
//
// ---------------------------------------------------------------------------
// SIZE BUDGET (a Firestore doc is capped at 1 MiB — blowing it kills the room)
// ---------------------------------------------------------------------------
//   state   soft budget 40 KB serialised; MAX_STATE_BYTES (60 KB) is rejected
//           outright so a runaway reducer fails loudly instead of bricking play
//   moves   MAX_MOVES (200) entries, oldest dropped; keep a move under ~200 B
//   players 4 max, ~150 B each
// A game needing more than that should keep bulk data OUT of the room (derive
// it from a seed both clients share) rather than growing `state`.
//
// WRITE BUDGET: presence costs 1 read + 1 write per player per HEARTBEAT_MS
// (10s) — about 24 writes/minute for a full table. `heartbeat` skips the write
// when the stored lastSeenAt is younger than HEARTBEAT_MIN_MS, so duplicate
// timers (two components, a re-mount) do not double the bill.
// ===========================================================================
import {
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  query,
  where,
  limit,
  runTransaction,
} from 'firebase/firestore'
import { db, firebaseReady } from './firebase.js'
import { publicBaseUrl } from './qr.js'

// ---------- tunables ----------
export const MAX_MOVES = 200
export const MAX_SEATS = 4
export const HEARTBEAT_MS = 10000
// A player silent this long renders as disconnected. They KEEP their seat —
// a phone that locks mid-game must be able to come back to it.
export const DISCONNECT_MS = 45000
const HEARTBEAT_MIN_MS = 7000
const MAX_STATE_BYTES = 60000
const SOFT_STATE_BYTES = 40000
const MAX_NAME = 24
// Rooms older than this stop being offered as "join what is already running".
const ROOM_STALE_MS = 3 * 60 * 60 * 1000
const TABLE_QUERY_LIMIT = 20
const TX_ATTEMPTS = 4

// ---------- room codes ----------
// Six characters, read aloud at a table, so the alphabet drops every glyph that
// gets misheard or mistyped: no 0/O, no 1/I/L, no 5/S. Leaves 29 symbols →
// 29^6 = 594 million codes, and creation still checks for a collision.
const CODE_ALPHABET = '2346789ABCDEFGHJKMNPQRTUVWXYZ'

export function randomRoomCode(len = 6) {
  const a = CODE_ALPHABET
  let out = ''
  const buf = new Uint32Array(len)
  try {
    window.crypto.getRandomValues(buf)
    for (let i = 0; i < len; i += 1) out += a[buf[i] % a.length]
  } catch (_) {
    for (let i = 0; i < len; i += 1) out += a[Math.floor(Math.random() * a.length)]
  }
  return out
}

// Guests type the code by hand. Uppercase, drop spaces and dashes, keep six.
//
// Note what this deliberately does NOT do: it does not "correct" 0/O/1/I/L/5/S
// into alphabet letters. Those glyphs are excluded precisely because nobody can
// know which one was meant, and silently substituting (or deleting) one would
// shift every later character and turn a near-miss into a different valid code.
// A misread fails as «لم نجد هذه الغرفة», which is the honest answer.
export function normalizeRoomCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
}

// ---------- errors ----------
// Every failure carries a stable `code` so the UI can say something true in
// Arabic instead of showing a spinner or a raw Firebase string.
export class RoomError extends Error {
  constructor(code, messageAr) {
    super(messageAr || code)
    this.name = 'RoomError'
    this.code = code
    this.ar = messageAr || ''
  }
}

const ERRORS = {
  unavailable: 'تعذّر الاتصال بالخادم. تحقّق من الشبكة ثم أعد المحاولة.',
  'not-found': 'لم نجد هذه الغرفة. تأكّد من الرمز أو اطلب رابطاً جديداً.',
  ended: 'انتهت هذه الجولة. ابدأ غرفة جديدة.',
  full: 'الغرفة مكتملة. اطلب من أصدقائك غرفة جديدة.',
  started: 'بدأت الجولة قبل أن تنضم. انتظر الجولة القادمة أو ابدأ غرفة جديدة.',
  'not-host': 'المضيف وحده يبدأ الجولة.',
  'not-seated': 'مقعدك لم يعد في هذه الغرفة.',
  'not-enough': 'اللاعبون غير كافين لبدء الجولة.',
  'not-your-turn': 'انتظر دورك.',
  'not-playing': 'الجولة غير جارية الآن.',
  'state-too-big': 'حالة اللعبة كبيرة جداً على غرفة واحدة.',
  permission: 'لا تملك صلاحية الوصول لهذه الغرفة.',
  offline: 'أنت غير متصل بالإنترنت.',
}

export function roomErrorText(err) {
  if (!err) return ''
  const code = err.code || ''
  if (ERRORS[code]) return ERRORS[code]
  if (String(code).includes('permission-denied')) return ERRORS.permission
  if (String(code).includes('unavailable')) return ERRORS.offline
  return 'حدث خطأ غير متوقع. أعد المحاولة.'
}

const fail = (code) => { throw new RoomError(code, ERRORS[code]) }

// ---------- paths ----------
const roomsCol = (tid) => collection(db, 'tenants', tid, 'rooms')
const roomRef = (tid, roomId) => doc(db, 'tenants', tid, 'rooms', roomId)

// ---------- sanitizers ----------
const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
const cleanPhone = (p) => String(p || '').replace(/[^\d+]/g, '').slice(0, 20)

// Firestore rejects `undefined`. Every value that reaches a write goes through
// this, so one sloppy reducer cannot fail the whole transaction.
function stripUndefined(v) {
  if (v === undefined) return null
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(stripUndefined)
  const out = {}
  for (const k of Object.keys(v)) {
    if (v[k] !== undefined) out[k] = stripUndefined(v[k])
  }
  return out
}

function stateBytes(state) {
  try { return JSON.stringify(state ?? null).length } catch (_) { return Infinity }
}

function assertStateSize(state) {
  const n = stateBytes(state)
  if (n > MAX_STATE_BYTES) fail('state-too-big')
  if (n > SOFT_STATE_BYTES) {
     
    console.warn(`[gameRoom] state is ${n} bytes — over the ${SOFT_STATE_BYTES} soft budget. Trim it before it hits ${MAX_STATE_BYTES}.`)
  }
  return state
}

function normalizePlayer(p, seat) {
  return {
    id: String(p?.id || '').slice(0, 64),
    name: cleanName(p?.name) || 'ضيف',
    phone: cleanPhone(p?.phone),
    seat,
    joinedAt: Number(p?.joinedAt) || Date.now(),
    connected: true,
    lastSeenAt: Date.now(),
    score: Number(p?.score) || 0,
  }
}

// Lowest unoccupied seat. Players are never auto-removed, so a seat index stays
// bound to the same person for the life of the room.
function nextFreeSeat(players, maxPlayers) {
  const taken = new Set((players || []).map((p) => p.seat))
  for (let s = 0; s < maxPlayers; s += 1) if (!taken.has(s)) return s
  return -1
}

// ---------- presence helpers (pure — safe to call while rendering) ----------
export function isConnected(player, now = Date.now()) {
  if (!player) return false
  if (player.connected === false) return false
  const seen = Number(player.lastSeenAt) || 0
  return now - seen < DISCONNECT_MS
}

export function connectedCount(room, now = Date.now()) {
  return (room?.players || []).filter((p) => isConnected(p, now)).length
}

export function playerOf(room, playerId) {
  return (room?.players || []).find((p) => p.id === playerId) || null
}

export function seatOf(room, playerId) {
  const p = playerOf(room, playerId)
  return p ? p.seat : -1
}

export function isHost(room, playerId) {
  return Boolean(room && playerId && room.hostId === playerId)
}

// A deadline that has passed — the signal a game uses to offer «تخطَّ الدور».
export function turnExpired(room, now = Date.now()) {
  const d = Number(room?.turn?.deadlineAt) || 0
  return d > 0 && now > d
}

// ---------- transaction retry ----------
// runTransaction retries contention on its own; this wraps the transient
// network failures around it so a flaky cafe wifi does not lose a tap.
async function withRetry(fn) {
  let lastErr = null
  for (let attempt = 0; attempt < TX_ATTEMPTS; attempt += 1) {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof RoomError) throw err
      lastErr = err
      const code = String(err?.code || '')
      if (code.includes('permission-denied') || code.includes('invalid-argument')) throw err
      await new Promise((r) => setTimeout(r, 120 * (attempt + 1) + Math.random() * 120))
    }
  }
  throw lastErr || new RoomError('unavailable', ERRORS.unavailable)
}

// ===========================================================================
// createRoom
// ===========================================================================
export async function createRoom({
  tid,
  gameId,
  table = null,
  player,
  maxPlayers = 2,
  minPlayers = 2,
  initialState = {},
  turnMs = 0,
} = {}) {
  if (!firebaseReady || !tid || !gameId || !player?.id) fail('unavailable')
  const seats = Math.max(2, Math.min(MAX_SEATS, Number(maxPlayers) || 2))
  const min = Math.max(2, Math.min(seats, Number(minPlayers) || 2))
  assertStateSize(initialState)

  const now = Date.now()
  const base = {
    gameId: String(gameId),
    tableId: table?.id || null,
    tableLabel: String(table?.label || table?.name || '').slice(0, 40),
    status: 'lobby',
    hostId: String(player.id).slice(0, 64),
    players: [normalizePlayer(player, 0)],
    maxPlayers: seats,
    minPlayers: min,
    // No turn until the host starts; games that want a clock set turnMs.
    turn: { seat: 0, startedAt: 0, deadlineAt: null },
    turnMs: Math.max(0, Number(turnMs) || 0),
    state: stripUndefined(initialState) || {},
    moves: [],
    winnerSeat: null,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  // Codes are short enough to collide eventually; claim one that is free.
  // `create` in the rules pins roomId to the doc id, so the id IS the code.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const roomId = randomRoomCode()
    const ref = roomRef(tid, roomId)
     
    const snap = await getDoc(ref).catch(() => null)
    if (snap && snap.exists()) continue
     
    await setDoc(ref, { roomId, ...base })
    return roomId
  }
  fail('unavailable')
  return ''
}

// ===========================================================================
// joinRoom — seats a new player, or returns the SAME seat to someone rejoining.
// A refresh, a locked phone, a reopened tab: none of them cost a place.
// ===========================================================================
export async function joinRoom({ tid, roomId, player } = {}) {
  if (!firebaseReady || !tid || !roomId || !player?.id) fail('unavailable')
  const pid = String(player.id).slice(0, 64)

  return withRetry(() => runTransaction(db, async (tx) => {
    const ref = roomRef(tid, roomId)
    const snap = await tx.get(ref)
    if (!snap.exists()) fail('not-found')
    const room = { id: snap.id, ...snap.data() }
    const players = Array.isArray(room.players) ? room.players.slice() : []
    const now = Date.now()

    // --- rejoin: same id, same seat, always allowed (even mid-game / ended) ---
    const idx = players.findIndex((p) => p.id === pid)
    if (idx >= 0) {
      const name = cleanName(player.name)
      players[idx] = {
        ...players[idx],
        ...(name ? { name } : {}),
        ...(cleanPhone(player.phone) ? { phone: cleanPhone(player.phone) } : {}),
        connected: true,
        lastSeenAt: now,
      }
      tx.update(ref, { players, updatedAt: now })
      return { seat: players[idx].seat, room: { ...room, players }, rejoined: true }
    }

    // --- new player ---
    if (room.status === 'ended') fail('ended')
    if (room.status === 'playing') fail('started')
    const seat = nextFreeSeat(players, room.maxPlayers || MAX_SEATS)
    if (seat < 0 || players.length >= (room.maxPlayers || MAX_SEATS)) fail('full')

    players.push(normalizePlayer({ ...player, id: pid, joinedAt: now }, seat))
    tx.update(ref, { players, updatedAt: now })
    return { seat, room: { ...room, players }, rejoined: false }
  }))
}

// ===========================================================================
// startGame — the host flips 'lobby' → 'playing'. Not in the original contract
// but the lobby cannot work without it, so it lives here rather than as a raw
// write from the UI.
//
// `initialState` is recomputed at start time with the FINAL player count, which
// is the only moment a game knows how many seats it is dealing for.
// ===========================================================================
export async function startGame({ tid, roomId, playerId, initialState, turnMs, firstSeat = 0 } = {}) {
  if (!firebaseReady || !tid || !roomId) fail('unavailable')

  return withRetry(() => runTransaction(db, async (tx) => {
    const ref = roomRef(tid, roomId)
    const snap = await tx.get(ref)
    if (!snap.exists()) fail('not-found')
    const room = snap.data()
    if (room.status === 'ended') fail('ended')
    if (room.status === 'playing') return { already: true }
    if (playerId && room.hostId !== playerId) fail('not-host')
    const players = Array.isArray(room.players) ? room.players : []
    if (players.length < (room.minPlayers || 2)) fail('not-enough')

    const ms = Math.max(0, Number(turnMs ?? room.turnMs) || 0)
    const now = Date.now()
    const patch = {
      status: 'playing',
      turn: { seat: firstSeat, startedAt: now, deadlineAt: ms ? now + ms : null },
      updatedAt: now,
    }
    if (initialState !== undefined) {
      assertStateSize(initialState)
      patch.state = stripUndefined(initialState) || {}
    }
    if (ms) patch.turnMs = ms
    tx.update(ref, patch)
    return { already: false }
  }))
}

// ===========================================================================
// applyMove — THE mutation path. Every game state change goes through here.
//
//   reduce(state, move, room) -> { state, turn?, winnerSeat?, status?, scores? }
//
// The reducer is a TOTAL function: an illegal move returns the state unchanged,
// and an unchanged state is detected here and written as nothing at all — an
// illegal tap costs zero writes.
//
// Optional extensions a reducer may return beyond the contract:
//   turn    { seat, deadlineAt? }  — omit to leave the turn alone,
//                                    or pass null to clear it (free-for-all)
//   scores  { [seat]: number }     — folded into players[].score
//   status  'ended'                — stamps endedAt for you
// ===========================================================================
export async function applyMove({ tid, roomId, seat, move, reduce, allowOutOfTurn = false } = {}) {
  if (!firebaseReady || !tid || !roomId) fail('unavailable')
  if (typeof reduce !== 'function') fail('unavailable')
  const mySeat = Number(seat)

  return withRetry(() => runTransaction(db, async (tx) => {
    const ref = roomRef(tid, roomId)
    const snap = await tx.get(ref)
    if (!snap.exists()) fail('not-found')
    const room = { id: snap.id, ...snap.data() }
    const now = Date.now()

    if (room.status !== 'playing') fail(room.status === 'ended' ? 'ended' : 'not-playing')

    const players = Array.isArray(room.players) ? room.players : []
    const me = players.find((p) => p.seat === mySeat)
    if (!me) fail('not-seated')

    // Turn gate. `turn.seat === null` is a game that opted out of turns
    // (free-for-all); otherwise the seat must match. A move flagged
    // allowOutOfTurn (a skip on an expired deadline) skips the gate and is
    // judged by the reducer instead — which is where it belongs, because only
    // the reducer knows whether skipping is legal right now.
    const turnSeat = room.turn?.seat
    if (!allowOutOfTurn && turnSeat !== null && turnSeat !== undefined && turnSeat !== mySeat) {
      fail('not-your-turn')
    }

    // --- the pure reducer ---
    // Compare against the SAME object handed to the reducer, so "returned the
    // input unchanged" is detected by identity even when the stored state was
    // missing and we substituted a fresh {}.
    const curState = room.state || {}
    const out = reduce(curState, move || {}, room)
    if (!out || out.state === undefined) return { applied: false, reason: 'rejected' }

    const stateChanged = out.state !== curState
    const turnGiven = Object.prototype.hasOwnProperty.call(out, 'turn')
    const winnerGiven = out.winnerSeat !== undefined && out.winnerSeat !== room.winnerSeat
    const statusGiven = out.status !== undefined && out.status !== room.status
    const scoresGiven = out.scores && typeof out.scores === 'object'
    // A reducer that returned the same state object and changed nothing else
    // has rejected the move. Do not write.
    if (!stateChanged && !turnGiven && !winnerGiven && !statusGiven && !scoresGiven) {
      return { applied: false, reason: 'illegal' }
    }

    assertStateSize(out.state)

    const entry = stripUndefined({ ...(move || {}), seat: mySeat, at: now })
    const moves = [...(Array.isArray(room.moves) ? room.moves : []), entry].slice(-MAX_MOVES)

    const patch = {
      state: stripUndefined(out.state) ?? {},
      moves,
      updatedAt: now,
    }

    if (turnGiven) {
      if (out.turn === null) {
        patch.turn = { seat: null, startedAt: now, deadlineAt: null }
      } else {
        const ms = Number(out.turn.turnMs ?? room.turnMs) || 0
        patch.turn = {
          seat: out.turn.seat ?? turnSeat ?? null,
          startedAt: now,
          deadlineAt: out.turn.deadlineAt ?? (ms ? now + ms : null),
        }
      }
    }

    if (scoresGiven) {
      patch.players = players.map((p) => (
        out.scores[p.seat] === undefined ? p : { ...p, score: Number(out.scores[p.seat]) || 0 }
      ))
    }

    if (out.winnerSeat !== undefined) patch.winnerSeat = out.winnerSeat === null ? null : Number(out.winnerSeat)
    if (out.status !== undefined) {
      patch.status = out.status
      if (out.status === 'ended') {
        patch.endedAt = now
        patch.turn = { seat: null, startedAt: now, deadlineAt: null }
      }
    } else if (out.winnerSeat !== undefined && out.winnerSeat !== null) {
      // A winner without an explicit status still ends the round — otherwise
      // the board would sit "playing" forever behind a win banner.
      patch.status = 'ended'
      patch.endedAt = now
      patch.turn = { seat: null, startedAt: now, deadlineAt: null }
    }

    tx.update(ref, patch)
    return { applied: true, state: patch.state, status: patch.status || room.status }
  }))
}

// ===========================================================================
// watchRoom — cb(room|null, err|null). NEVER hangs: the error callback fires on
// a permission failure or a dropped listener, so the UI can show a sentence
// instead of a spinner. Returns an unsubscribe.
// ===========================================================================
export function watchRoom(tid, roomId, cb, onError) {
  if (!firebaseReady || !tid || !roomId) {
    const err = new RoomError('unavailable', ERRORS.unavailable)
    setTimeout(() => { cb?.(null, err); onError?.(err) }, 0)
    return () => {}
  }
  return onSnapshot(
    roomRef(tid, roomId),
    (snap) => {
      if (!snap.exists()) {
        const err = new RoomError('not-found', ERRORS['not-found'])
        cb?.(null, err)
        return
      }
      cb?.({ id: snap.id, ...snap.data() }, null)
    },
    (err) => {
       
      console.warn('[gameRoom] watchRoom', err?.code || err)
      cb?.(null, err)
      onError?.(err)
    },
  )
}

// ===========================================================================
// roomsForTable — open rooms on this table, for "join what is already running".
//
// Deliberately a single-field query (tableId) with client-side filtering and
// sorting: adding status + orderBy would need a composite index, and a table
// never holds enough rooms for that to matter. Stale rooms (older than
// ROOM_STALE_MS) are hidden rather than deleted — history stays readable.
// ===========================================================================
export function roomsForTable(tid, tableId, cb, onError) {
  if (!firebaseReady || !tid || !tableId) {
    setTimeout(() => cb?.([], null), 0)
    return () => {}
  }
  const q = query(roomsCol(tid), where('tableId', '==', tableId), limit(TABLE_QUERY_LIMIT))
  return onSnapshot(
    q,
    (snap) => {
      const now = Date.now()
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => r.status === 'lobby' || r.status === 'playing')
        .filter((r) => now - (Number(r.updatedAt) || 0) < ROOM_STALE_MS)
        .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
      cb?.(rows, null)
    },
    (err) => {
       
      console.warn('[gameRoom] roomsForTable', err?.code || err)
      cb?.([], err)
      onError?.(err)
    },
  )
}

// ===========================================================================
// heartbeat — presence. Writes lastSeenAt; a player silent for DISCONNECT_MS
// renders as disconnected but KEEPS their seat. Nothing here ever removes a
// player: a phone that locks mid-game must be able to come back.
//
// Skips the write when the stored stamp is younger than HEARTBEAT_MIN_MS, so
// two timers (a re-mount, a duplicated effect) cost one write, not two.
// ===========================================================================
export async function heartbeat({ tid, roomId, playerId } = {}) {
  if (!firebaseReady || !tid || !roomId || !playerId) return false
  try {
    return await runTransaction(db, async (tx) => {
      const ref = roomRef(tid, roomId)
      const snap = await tx.get(ref)
      if (!snap.exists()) return false
      const room = snap.data()
      const players = Array.isArray(room.players) ? room.players.slice() : []
      const i = players.findIndex((p) => p.id === playerId)
      if (i < 0) return false
      const now = Date.now()
      if (players[i].connected === true && now - (Number(players[i].lastSeenAt) || 0) < HEARTBEAT_MIN_MS) {
        return false
      }
      players[i] = { ...players[i], connected: true, lastSeenAt: now }
      tx.update(ref, { players, updatedAt: now })
      return true
    })
  } catch (err) {
    // Presence is best-effort by design: a failed heartbeat must never
    // interrupt play or surface an error to the player.
    return false
  }
}

// ===========================================================================
// leaveRoom — an EXPLICIT departure (tapping «خروج»), not a dropped connection.
//   in 'lobby'   the seat is freed, because the player chose to go
//   in 'playing' the seat is kept and marked disconnected, because pulling a
//                player out mid-board would corrupt every game's state
// The host leaving in the lobby hands the host badge to the next seated player;
// the last player leaving ends the room instead of orphaning it.
// ===========================================================================
export async function leaveRoom({ tid, roomId, playerId } = {}) {
  if (!firebaseReady || !tid || !roomId || !playerId) return false
  try {
    return await runTransaction(db, async (tx) => {
      const ref = roomRef(tid, roomId)
      const snap = await tx.get(ref)
      if (!snap.exists()) return false
      const room = snap.data()
      const players = Array.isArray(room.players) ? room.players.slice() : []
      const i = players.findIndex((p) => p.id === playerId)
      if (i < 0) return false
      const now = Date.now()

      if (room.status === 'playing') {
        players[i] = { ...players[i], connected: false, lastSeenAt: now }
        tx.update(ref, { players, updatedAt: now })
        return true
      }

      const rest = players.filter((p) => p.id !== playerId)
      if (rest.length === 0) {
        tx.update(ref, { players: rest, status: 'ended', endedAt: now, updatedAt: now })
        return true
      }
      const patch = { players: rest, updatedAt: now }
      if (room.hostId === playerId) patch.hostId = rest[0].id
      tx.update(ref, patch)
      return true
    })
  } catch (err) {
    return false
  }
}

// ===========================================================================
// endRoom — close a round for everyone (host abandoning, or a game that ends
// outside a move). Idempotent.
// ===========================================================================
export async function endRoom({ tid, roomId, winnerSeat = null } = {}) {
  if (!firebaseReady || !tid || !roomId) return false
  try {
    return await runTransaction(db, async (tx) => {
      const ref = roomRef(tid, roomId)
      const snap = await tx.get(ref)
      if (!snap.exists()) return false
      if (snap.data().status === 'ended') return true
      const now = Date.now()
      tx.update(ref, {
        status: 'ended',
        endedAt: now,
        updatedAt: now,
        turn: { seat: null, startedAt: now, deadlineAt: null },
        ...(winnerSeat === null ? {} : { winnerSeat: Number(winnerSeat) }),
      })
      return true
    })
  } catch (err) {
    return false
  }
}

// ===========================================================================
// inviteUrl — the link a guest opens. The venue slug rides as `?v=` so the join
// page can show the venue's name and brand before the tenant document loads,
// and can offer a way back to the menu.
// ===========================================================================
export function inviteUrl(tid, roomId, slug) {
  const base = `${publicBaseUrl()}/join/${encodeURIComponent(tid)}/${encodeURIComponent(roomId)}`
  return slug ? `${base}?v=${encodeURIComponent(slug)}` : base
}

// One read, for a join page that wants to check a room before subscribing.
export async function getRoom(tid, roomId) {
  if (!firebaseReady || !tid || !roomId) return null
  const snap = await getDoc(roomRef(tid, roomId)).catch(() => null)
  return snap && snap.exists() ? { id: snap.id, ...snap.data() } : null
}
