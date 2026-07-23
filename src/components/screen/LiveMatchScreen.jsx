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
// do, never a move behind them.
//
// TWO SHAPES, one frame:
//   • a table-versus-table MATCH  → two big side cards (طاولة ضد طاولة)
//   • a plain ROOM with no match  → one card per seated player (two to four)
// The logic that decides WHICH of them to show, and when it has ended or died,
// lives in lib/spectate.js. This file is only the frame around the board.
// ===========================================================================
import { Component, Suspense, lazy, useMemo } from 'react'
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
  turnPlayerName,
} from '../../lib/spectate.js'
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

export function BrandBar({ venue, context = '', live = true, liveLabel = 'بث مباشر' }) {
  return (
    <div className="tvg-top">
      {venue?.logoUrl ? <img className="tvg-logo" src={venue.logoUrl} alt="" /> : null}
      <span className="tvg-venue">{venue?.name || ''}</span>
      {context ? (
        <span className="tvg-ctx">
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>
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

export default function LiveMatchScreen({
  match = null,
  room,
  venue = null,
  mode = 'live',
  context = '',
}) {
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
  const ended = mode === 'ended' || result.over || rResult.over
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

  const now = !ended ? turnPlayerName(room) : ''
  const seatCount = Math.min(4, Math.max(2, sides.length))

  return (
    <div className="tvg-root" data-mode={ended ? 'ended' : 'live'} style={{ '--tvg-brand': brand }}>
      <BrandBar venue={venue} context={context} />

      {/* scoreboard. A match shows two TABLES with «ضد» between them (RTL puts
          the challenger on the right, which reads naturally in Arabic); a plain
          room shows one card per seated player in seat order, the same order the
          board itself plays in. */}
      {isMatch ? (
        <div className="tvg-score">
          <SeatCard seat={sides[0]} gameId={gameId} />
          <div className="tvg-vs">
            <span className="tvg-vs-word">ضد</span>
            <span className="tvg-vs-game">{spectateGameName(gameId)}</span>
          </div>
          <SeatCard seat={sides[1]} gameId={gameId} />
        </div>
      ) : (
        <div className="tvg-score" data-seats={String(seatCount)}>
          {sides.slice(0, 4).map((s) => <SeatCard key={s.seat} seat={s} gameId={gameId} />)}
        </div>
      )}

      {/* «من يلعب الآن» — the single line that tells a room walking past what it
          is looking at. Rendered only when the board actually names a seat on
          turn: a free-for-all or a finished round says nothing rather than
          guessing at a name. */}
      {now ? (
        <div className="tvg-now">
          <span className="tvg-now-label">من يلعب الآن</span>
          <span className="tvg-now-name">{now}</span>
          {/* The game's name already sits between the two table cards in match
              mode; printing it twice on one wall is noise, not clarity. */}
          {isMatch ? null : <span className="tvg-now-game">{spectateGameName(gameId)}</span>}
        </div>
      ) : null}

      {/* the live board — read-only. `pointer-events: none` (see
          screen-games.css) makes it untappable even on a touch screen; the board
          also gets no onMove/onExit/mySeat, so it is non-interactive by contract
          too, and the room it receives is redacted. */}
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

      {/* result banner over the finished board */}
      {ended && banner ? (
        <div className="tvg-banner" data-draw={(result.draw || rResult.draw) ? '1' : '0'}>
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>
          <span>{banner}</span>
        </div>
      ) : null}
    </div>
  )
}
