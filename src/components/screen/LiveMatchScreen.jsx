// ===========================================================================
// LIVE VENUE SPECTATOR SCREEN — the view a cafe's TV puts on the wall so the
// whole room can watch a live board, at tournament scale.
//
// It renders the same board component the players hold on their phones, but in
// READ-ONLY mode: `room` is passed WITHOUT an `onMove` / `onExit` / `mySeat`, so
// the board draws the live position and nothing on it can be tapped. As extra
// insurance the board is wrapped in `pointer-events: none`, so even a touch TV
// cannot reach it.
//
// PRIVACY, in three independent layers (all defined in lib/spectate.js):
//   1. ALLOWLIST   only games certified to render a SEATLESS viewer without
//                  drawing anybody's hand may mount here at all. BOARDS below
//                  is the structural gate — a game absent from it CANNOT be
//                  rendered — and an uncertified game gets a panel that SAYS
//                  why, rather than a blank screen nobody can explain.
//   2. REDACTION   the room handed to the board has its private fields blanked
//                  first (`redactRoomForSpectator`), lengths kept so the counts
//                  boards legitimately show stay true. A future regression in a
//                  game file would therefore paint placeholder tiles, not a
//                  guest's real hand.
//   3. NO SEAT     mySeat is null and there is no onMove, so nothing on screen
//                  is or can become interactive.
//
// The multiplayer boards render ONLY committed room.state — never an optimistic
// local guess — so this screen repaints at the SAME instant the players' phones
// do, never a move behind them. `room.state` is guaranteed to arrive DECODED (an
// object, never the JSON string gameRoom.js persists): the component decodes it
// once at the top (decodeRoom) and every read below — scoreboard, board mount —
// flows from that single decoded value, so no read path can freeze a board on
// its starting position.
//
// LAYOUT — the board is the star. A slim brand bar sits on top; below it the
// board fills the whole remaining height with the player/score cards FLANKING it
// on the inline sides (one table each for a match, split evenly for a room),
// which turns the felt that used to sit dead beside a square board into useful
// chrome. There is no tall header block and no top gap: the play area fills the
// 1920x1080 wall.
//
// CELEBRATIONS — an optional, venue-toggleable flourish. When a round/trick is
// won (a seat's live score jumps) or the match ends with a winner, a brief burst
// + an Arabic encouragement line appears over the board and auto-dismisses. It
// is transform/opacity only, honours prefers-reduced-motion, and is gated on
// `tenant.screenFx.celebrations !== false` (default ON) so the appearance editor
// can switch it off.
// ===========================================================================
import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import {
  isSpectatableGame,
  spectateSides,
  spectateResult,
  spectateMetric,
  spectateGameName,
  spectateRefusal,
  redactRoomForSpectator,
  roomSeats,
  roomResult,
} from '../../lib/spectate.js'
import { decodeRoom } from '../../lib/gameRoom.js'
import '../../routes/screen/screen-games.css'

// The board's JS chunk is fetched the moment a match goes live. A rejected
// dynamic import (a fresh deploy dropped the old hash, or a network blip) throws
// in render, and there is only ONE error boundary in the whole app — the
// app-level ChunkBoundary — which would replace the ENTIRE all-day signage
// (menu, offers, prayer times) with a manual "reload page" prompt nobody taps on
// a wall-mounted TV. So the load also falls back locally: a failed board chunk
// becomes null, and the boundary below turns any board RENDER error into the
// honest waiting frame, so the core signage always survives the games feature
// failing.
const boardFallback = { default: () => null }

// HARD SAFETY GATE. This map is the structural half of the allowlist in
// lib/spectate.js (SPECTATE_GAMES): only a game listed here can be mounted on a
// public screen, and only certified games are listed.
//
//   chess / ludo     hold nothing private in room.state at all.
//   dominoes         a seatless viewer gets `seat = null`, and its hand is
//                    `owner === null ? [] : …` — empty. Rivals show a COUNT.
//   jackaroo / wist  a seatless viewer fails the component's own `seated` gate
//                    and the whole hand block is skipped. Rivals show BACKS.
//   haree            a seatless viewer is forced to `seat = -1`, so its hand is
//                    empty and the hand area becomes a watch panel.
//
// Adding a game here is a PRIVACY decision, not a wiring one: read its seatless
// path first, and record the evidence next to its entry in lib/spectate.js.
const BOARDS = {
  chess: lazy(() => import('../games/Chess.jsx').catch(() => boardFallback)),
  ludo: lazy(() => import('../games/Ludo.jsx').catch(() => boardFallback)),
  dominoes: lazy(() => import('../games/Dominoes.jsx').catch(() => boardFallback)),
  jackaroo: lazy(() => import('../games/Jackaroo.jsx').catch(() => boardFallback)),
  wist: lazy(() => import('../games/Wist.jsx').catch(() => boardFallback)),
  haree: lazy(() => import('../games/Haree.jsx').catch(() => boardFallback)),
}

// A render error inside a board (an unexpected state shape) must never escape to
// the app boundary and take the signage down. It renders the provided fallback
// frame instead, and recovers automatically when the match id changes.
class BoardBoundary extends Component {
  constructor(props) { super(props); this.state = { dead: false } }
  static getDerivedStateFromError() { return { dead: true } }
  componentDidUpdate(prev) {
    if (this.state.dead && prev.resetKey !== this.props.resetKey) this.setState({ dead: false })
  }
  render() { return this.state.dead ? this.props.fallback : this.props.children }
}

// Latin digits always (hard repo rule) — small integers, but formatted safely.
const fmt = (n) => { try { return Number(n || 0).toLocaleString('ar-SA-u-nu-latn') } catch (_) { return String(n) } }

const TROPHY_PATH = 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z'

export function BrandBar({ venue, context = '', game = '', live = true, liveLabel = 'بث مباشر' }) {
  return (
    <div className="tvg-top">
      {venue?.logoUrl ? <img className="tvg-logo" src={venue.logoUrl} alt="" /> : null}
      <span className="tvg-venue">{venue?.name || ''}</span>
      {game ? (
        <span className="tvg-game-chip">
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={TROPHY_PATH} /></svg>
          {game}
        </span>
      ) : null}
      {context ? (
        <span className="tvg-ctx">
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={TROPHY_PATH} /></svg>
          {context}
        </span>
      ) : null}
      <span className="tvg-spacer" />
      {live ? (
        <span className="tvg-live">
          <span className="tvg-live-dot" aria-hidden="true" />
          {liveLabel}
        </span>
      ) : null}
    </div>
  )
}

// Shown when there is no live board to draw (room warming up, or handed an
// unsupported game). Honest, never a fake board.
export function ScreenNotice({ venue, title, body, brand, live = false, context = '' }) {
  const c = brand || venue?.brandColor || venue?.themeColor || '#0e7490'
  return (
    <div className="tvg-root tvg-center" style={{ '--tvg-brand': c }}>
      <BrandBar venue={venue} live={live} context={context} />
      <div className="tvg-notice">
        <svg width="7vmin" height="7vmin" style={{ minWidth: 48, minHeight: 48 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
        <h2 className="tvg-notice-t">{title}</h2>
        {body ? <p className="tvg-notice-p">{body}</p> : null}
      </div>
    </div>
  )
}

function SeatCard({ seat, gameId }) {
  const metric = spectateMetric(gameId)
  const cls = `tvg-seat${seat.isTurn ? ' is-turn' : ''}${seat.winner ? ' is-win' : ''}${seat.loser ? ' is-lose' : ''}${seat.connected ? '' : ' is-off'}`
  return (
    <div className={cls}>
      <div className="tvg-seat-name">{seat.label || 'طاولة'}</div>
      {seat.player ? <div className="tvg-seat-sub">{seat.player}</div> : null}
      {seat.score != null ? (
        <div className="tvg-seat-scorewrap">
          <div className="tvg-seat-num tvg-num">{fmt(seat.score)}</div>
          {metric ? <div className="tvg-seat-metric">{metric}</div> : null}
        </div>
      ) : <div className="tvg-seat-scorewrap" aria-hidden="true" />}
      <div className="tvg-seat-state">
        {seat.winner
          ? 'الفائز'
          : seat.loser
            ? ''
            : seat.isTurn
              ? 'دوره الآن'
              : (seat.connected ? '' : 'انقطع مؤقتاً')}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CELEBRATIONS — a brief burst + an Arabic line when something is won. Two
// tiers: a full-screen flourish when the match ENDS with a winner, and a small
// toast when a live SCORE jumps mid-game (a trick / round / marble home). The
// lines rotate so the wall never repeats itself twice in a row by feel.
// ---------------------------------------------------------------------------
const WIN_LINES = ['أحسنت! فوز رائع', 'مبروك الفوز', 'بطل الطاولة', 'لعب رائع حتى النهاية', 'فوز يستحق التصفيق']
const CHEER_LINES = ['مبروك الجولة', 'أحسنت!', 'نقطة جميلة', 'لعبة موفّقة', 'استمر هكذا']
const pickLine = (arr) => arr[Math.floor(Math.random() * arr.length)] || arr[0]

// Deterministic confetti field — radial, so the burst reads as a starburst
// rather than a shower. Positions are unitless vmin multiplied in the keyframe.
const CELEB_CONFETTI = Array.from({ length: 20 }, (_, i) => {
  const ang = (i / 20) * Math.PI * 2
  const dist = 24 + (i % 5) * 5
  return {
    tx: Math.round(Math.cos(ang) * dist),
    ty: Math.round(Math.sin(ang) * dist),
    rot: (i * 57) % 360,
    delay: (i % 6) * 45,
    hue: i % 4,
  }
})

function CelebrationOverlay({ celebration, confetti = true, messages = true, intensity = 'normal' }) {
  if (!celebration) return null
  const big = !!celebration.big
  // intensity trims (or keeps) the particle field — the appearance editor's
  // «هدوء / عادي / حماسي» control maps here.
  const pieces = intensity === 'low' ? CELEB_CONFETTI.slice(0, 10)
    : intensity === 'high' ? CELEB_CONFETTI
      : CELEB_CONFETTI.slice(0, 16)
  return (
    <div
      className="tvg-celebrate"
      key={celebration.key}
      data-big={big ? '1' : '0'}
      data-intensity={intensity}
      style={{ '--tvg-celeb-dur': `${big ? 5200 : 3200}ms` }}
    >
      {confetti ? (
        <div className="tvg-celebrate-fx" aria-hidden="true">
          <svg className="tvg-burst" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
            <g className="tvg-burst-rays">
              {Array.from({ length: 12 }, (_, i) => (
                <rect key={i} className="tvg-burst-ray" x="48.6" y="6" width="2.8" height="20" rx="1.4" transform={`rotate(${i * 30} 50 50)`} />
              ))}
            </g>
            <circle className="tvg-burst-ring" cx="50" cy="50" r="22" fill="none" />
          </svg>
          {pieces.map((c, i) => (
            <i
              key={i}
              className="tvg-confetti"
              data-hue={String(c.hue)}
              style={{ '--tx': c.tx, '--ty': c.ty, '--rot': `${c.rot}deg`, animationDelay: `${c.delay}ms` }}
            />
          ))}
        </div>
      ) : null}
      <div className="tvg-celebrate-card">
        <svg className="tvg-celebrate-ico" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={TROPHY_PATH} /></svg>
        {messages ? <span className="tvg-celebrate-line">{celebration.line}</span> : null}
        {celebration.name ? <span className="tvg-celebrate-name">{celebration.name}</span> : null}
      </div>
    </div>
  )
}

export default function LiveMatchScreen({
  match = null,
  room: rawRoom = null,
  venue = null,
  mode = 'live',
  context = '',
}) {
  // ONE decode, at the top: every read below (scoreboard + board) flows from
  // this object state, so a raw JSON-string state (gameRoom.js persists it that
  // way) can never reach a board and freeze it on its starting position. A no-op
  // on an already-decoded room, so the match path pays nothing.
  const room = useMemo(() => decodeRoom(rawRoom), [rawRoom])

  // A room shown WITHOUT a match document names its own game; a match names it
  // on the match. Either way the game id must survive both being half-loaded.
  const gameId = String(match?.gameId || room?.gameId || '')
  const brand = venue?.brandColor || venue?.themeColor || '#0e7490'
  const supported = isSpectatableGame(gameId) && !!BOARDS[gameId]
  const isMatch = !!match

  const result = isSpectatableGame(gameId) && isMatch
    ? spectateResult(match, room)
    : { over: false, winner: null, draw: false }
  const rResult = roomResult(room)
  const ended = mode === 'ended' || result.over || rResult.over

  const sides = useMemo(() => {
    if (!isMatch) return roomSeats(room)
    const raw = spectateSides(match, room)
    const r = spectateResult(match, room)
    return raw.map((s) => ({
      ...s,
      winner: r.over && !r.draw && r.winner === s.side,
      loser: r.over && !r.draw && !!r.winner && r.winner !== s.side,
    }))
  }, [isMatch, match, room])

  // PRIVACY LAYER 2 — never hand the board the raw room. Memoised on the room
  // identity so a redaction does not remount the board on every render.
  const safeRoom = useMemo(() => redactRoomForSpectator(room), [room])

  // ---- celebrations -------------------------------------------------------
  // The appearance editor (gamesadmin/ScreenAppearance.jsx) writes
  // tenant.screenFx. It may store `celebrations` as a rich object
  // { enabled, confetti, messages, intensity } OR, in the simplest form, as a
  // bare boolean. Read BOTH so the on/off switch works whichever shape is
  // stored, and honour the sub-toggles; default fully ON when nothing is set.
  const cel = useMemo(() => {
    const raw = venue?.screenFx?.celebrations
    if (raw === false) return { on: false, confetti: true, messages: true, intensity: 'normal' }
    if (raw && typeof raw === 'object') {
      return {
        on: raw.enabled !== false,
        confetti: raw.confetti !== false,
        messages: raw.messages !== false,
        intensity: raw.intensity || 'normal',
      }
    }
    return { on: raw !== false, confetti: true, messages: true, intensity: 'normal' }
  }, [venue])
  const fxOn = cel.on
  const [celebration, setCelebration] = useState(null)
  const celebRef = useRef({ key: '', scores: {}, ended: false })
  const celebTimer = useRef(null)
  useEffect(() => () => clearTimeout(celebTimer.current), [])
  useEffect(() => {
    const roomKey = `${match?.id || room?.roomId || ''}:${gameId}`
    const scoreMap = {}
    for (const s of sides) scoreMap[s.seat] = Number.isFinite(s.score) ? s.score : null
    const prev = celebRef.current
    const commit = () => { celebRef.current = { key: roomKey, scores: scoreMap, ended } }

    // First sight of a room (or a switch, or a reload mid-game): snapshot only,
    // never fire — a jump we did not watch happen is not a jump we celebrate.
    if (prev.key !== roomKey) { commit(); return }
    if (!fxOn) { commit(); if (celebration) setCelebration(null); return }

    const fire = (name, big) => {
      clearTimeout(celebTimer.current)
      setCelebration({ key: `${roomKey}:${Date.now()}`, name, big, line: pickLine(big ? WIN_LINES : CHEER_LINES) })
      celebTimer.current = setTimeout(() => setCelebration(null), big ? 5200 : 3200)
    }

    if (ended && !prev.ended) {
      // Match just finished with a winner → full-screen flourish (draws skip).
      let winnerName = ''
      if (isMatch) {
        if (!result.draw && result.winner) winnerName = (sides.find((s) => s.side === result.winner) || {}).label || ''
      } else if (!rResult.draw) {
        winnerName = (sides.find((s) => s.winner) || {}).label || ''
      }
      if (winnerName) fire(winnerName, true)
    } else if (!ended && gameId !== 'chess') {
      // Mid-game score jump = a trick / round / marble home. Chess is excluded:
      // its "score" is captured pieces, which climbs on nearly every move and
      // would turn the wall into a strobe.
      for (const s of sides) {
        const before = prev.scores[s.seat]
        const now = scoreMap[s.seat]
        if (Number.isFinite(before) && Number.isFinite(now) && now > before) { fire(s.label, false); break }
      }
    }
    commit()
  }, [sides, ended, fxOn, gameId, isMatch, result.draw, result.winner, rResult.draw, match?.id, room?.roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refusal panel — an unsupported game must SAY so, never render silently, and
  // never fall through to a blank frame the venue cannot explain. In practice
  // lib/spectate.js never selects one; this is defence in depth.
  if (!supported) {
    return (
      <ScreenNotice
        venue={venue}
        brand={brand}
        title="لا تُعرض هذه اللعبة على الشاشة"
        body={spectateRefusal(gameId)}
      />
    )
  }

  const nameA = sides[0]?.label || 'طاولة'
  const nameB = sides[1]?.label || 'طاولة'

  // Room not drawable yet (still in the lobby, or momentarily unread), OR the
  // room we hold is not the one this match is about. That last case is the
  // important one: when the live match switches (table X's chess ends, table Y's
  // ludo begins) the new match id arrives one snapshot BEFORE its room does, so
  // for a moment `room` is still the previous game's room. Mounting the board
  // chosen by the NEW match.gameId against the OLD room state crashes the board
  // (e.g. Ludo reading room.state.tokens on a chess room) and, with only the
  // app-level boundary above it, would white-screen the whole signage. It is
  // also the privacy backstop: the board is only ever fed a room whose OWN
  // gameId is the allowlisted game being shown, so a mismatched or spoofed room
  // can never be driven onto the screen. Require the room to name the same game.
  if (!room || String(room.gameId) !== gameId
      || (room.status !== 'playing' && room.status !== 'ended')) {
    return (
      <ScreenNotice
        venue={venue}
        brand={brand}
        context={context}
        title={isMatch ? `${nameA} ضد ${nameB}` : `${spectateGameName(gameId)} — تجهيز الطاولة`}
        body="تبدأ الجولة بعد لحظات…"
      />
    )
  }

  const Board = BOARDS[gameId]
  const banner = (() => {
    if (!ended) return ''
    if (isMatch) {
      if (result.draw) return 'تعادل'
      const w = sides.find((s) => s.side === result.winner)
      return `فازت ${w?.label || 'الطاولة'}`
    }
    if (rResult.draw) return 'تعادل'
    const w = sides.find((s) => s.winner)
    return w ? `فاز ${w.label}` : 'انتهت الجولة'
  })()

  // Split the seat cards to FLANK the board: for a match, one table each side;
  // for a room, the seats split evenly (2 → 1|1, 3 → 2|1, 4 → 2|2), so the board
  // is always framed and never has a dead gutter of felt beside it.
  const seatCount = Math.min(4, Math.max(2, sides.length))
  const half = Math.ceil(sides.length / 2)
  const startCards = sides.slice(0, half)
  const endCards = sides.slice(half)

  return (
    <div className="tvg-root" data-mode={ended ? 'ended' : 'live'} data-fill="1" style={{ '--tvg-brand': brand }}>
      <BrandBar venue={venue} context={context} game={spectateGameName(gameId)} />

      {/* ARENA — the board fills the whole remaining height, the score cards
          flank it on the inline sides. In Arabic RTL the first flank sits on the
          right, which puts the challenger (side A) where a Saudi room expects
          it, exactly as the old «ضد» layout did. */}
      <div className="tvg-arena" data-seats={String(seatCount)}>
        <div className="tvg-flank">
          {startCards.map((s) => <SeatCard key={s.side || `s${s.seat}`} seat={s} gameId={gameId} />)}
        </div>

        {/* the live board — read-only. `pointer-events: none` (see
            screen-games.css) makes it untappable even on a touch screen; the
            board also gets no onMove/onExit/mySeat, so it is non-interactive by
            contract too, and the room it receives is redacted. */}
        <div className="tvg-stage">
          <div className="tvg-stage-inner">
            <BoardBoundary
              resetKey={(match?.id || room?.roomId || '') + ':' + gameId}
              fallback={<div className="tvg-spin" aria-hidden="true" />}
            >
              <Suspense fallback={<div className="tvg-spin" aria-hidden="true" />}>
                <Board room={safeRoom} mySeat={null} lang="ar" brand={brand} />
              </Suspense>
            </BoardBoundary>
          </div>
        </div>

        <div className="tvg-flank">
          {endCards.map((s) => <SeatCard key={s.side || `s${s.seat}`} seat={s} gameId={gameId} />)}
        </div>
      </div>

      {/* celebration flourish — over everything, never interactive */}
      <CelebrationOverlay celebration={celebration} confetti={cel.confetti} messages={cel.messages} intensity={cel.intensity} />

      {/* result banner over the finished board */}
      {ended && banner ? (
        <div className="tvg-banner" data-draw={(result.draw || rResult.draw) ? '1' : '0'}>
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={TROPHY_PATH} /></svg>
          <span>{banner}</span>
        </div>
      ) : null}
    </div>
  )
}
