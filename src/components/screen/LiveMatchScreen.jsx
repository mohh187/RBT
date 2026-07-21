// ===========================================================================
// LIVE VENUE SPECTATOR SCREEN — the view a cafe's TV puts on the wall so the
// whole room can watch two tables play.
//
// It renders the same board component the players hold on their phones, but in
// READ-ONLY mode: `room` is passed WITHOUT an `onMove` / `onExit` / `mySeat`, so
// the board draws the live position and nothing on it can be tapped. As extra
// insurance the board is wrapped in `pointer-events: none`, so even a touch TV
// cannot reach it. Chess.jsx and Ludo.jsx were both verified to yield a correct
// non-interactive board under exactly these props.
//
// The multiplayer boards render ONLY committed room.state — never an optimistic
// local guess — so this screen repaints at the SAME instant the players' phones
// do, never a move behind them.
//
// The logic that decides WHICH match to show, and when it has ended or died,
// lives in lib/spectate.js. This file is only the frame around the board.
// ===========================================================================
import { Component, Suspense, lazy, useMemo } from 'react'
import {
  isSpectatableGame,
  spectateSides,
  spectateResult,
  spectateMetric,
} from '../../lib/spectate.js'
import '../../styles/spectate.css'

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
const BOARDS = {
  chess: lazy(() => import('../games/Chess.jsx').catch(() => boardFallback)),
  ludo: lazy(() => import('../games/Ludo.jsx').catch(() => boardFallback)),
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

// HARD SAFETY LIMIT (mirrors SPECTATABLE_GAMES in lib/spectate.js): ONLY chess
// and ludo may ever mount on a public screen — see BOARDS above. Wist and
// Jackaroo hold each player's private HAND inside the shared room state, so
// rendering them here would show one guest's cards to the whole cafe. BOARDS is
// the structural gate: a game not in it CANNOT be rendered and gets the honest
// "cannot be shown live" panel below. Do NOT add hidden-information games.

// Latin digits always (hard repo rule) — small integers, but formatted safely.
const fmt = (n) => { try { return Number(n || 0).toLocaleString('ar-SA-u-nu-latn') } catch (_) { return String(n) } }

function BrandBar({ venue }) {
  return (
    <div className="sv-brand">
      {venue?.logoUrl ? <img className="sv-brand-logo" src={venue.logoUrl} alt="" /> : null}
      <span className="sv-brand-name">{venue?.name || ''}</span>
      <span className="sv-live">
        <span className="sv-live-dot" aria-hidden="true" />
        بث مباشر
      </span>
    </div>
  )
}

// Shown when there is no live board to draw (room warming up, or handed an
// unsupported game). Honest, never a fake board.
function Notice({ venue, title, body }) {
  const brand = venue?.brandColor || venue?.themeColor || '#0e7490'
  return (
    <div className="sv-root sv-center" style={{ '--sv-brand': brand }}>
      <BrandBar venue={venue} />
      <div className="sv-notice">
        <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
        <h2 className="sv-notice-t">{title}</h2>
        {body ? <p className="sv-notice-p">{body}</p> : null}
      </div>
    </div>
  )
}

function SideCard({ side, gameId }) {
  const metric = spectateMetric(gameId)
  return (
    <div className={`sv-side${side.isTurn ? ' sv-side-turn' : ''}${side.winner ? ' sv-side-win' : ''}${side.loser ? ' sv-side-lose' : ''}`}>
      <div className="sv-side-label">{side.label || 'طاولة'}</div>
      {side.player ? <div className="sv-side-player">{side.player}</div> : null}
      {side.score != null ? (
        <div className="sv-side-scorewrap">
          <div className="sv-side-num num">{fmt(side.score)}</div>
          {metric ? <div className="sv-side-metric">{metric}</div> : null}
        </div>
      ) : <div className="sv-side-scorewrap" aria-hidden="true" />}
      <div className="sv-side-state">
        {side.winner ? 'الفائزة' : side.loser ? '' : side.isTurn ? 'دورها الآن' : (side.connected ? '' : 'انقطع مؤقتاً')}
      </div>
    </div>
  )
}

export default function LiveMatchScreen({ match, room, venue = null, mode = 'live' }) {
  const gameId = match?.gameId || ''
  const brand = venue?.brandColor || venue?.themeColor || '#0e7490'
  const supported = isSpectatableGame(gameId) && !!BOARDS[gameId]

  const result = spectateResult(match, room)
  const sidesRaw = useMemo(() => spectateSides(match, room), [match, room])

  // Fold the result into the sides so a card can mark itself won / lost.
  const sides = sidesRaw.map((s) => ({
    ...s,
    winner: result.over && !result.draw && result.winner === s.side,
    loser: result.over && !result.draw && result.winner && result.winner !== s.side,
  }))

  // Refusal panel — an unsupported game must SAY so, never render silently. In
  // practice lib/spectate.js never selects one; this is defence in depth.
  if (!supported) {
    return (
      <Notice
        venue={venue}
        title="لا يمكن عرض هذه اللعبة على الشاشة"
        body="هذه اللعبة تُبقي أوراق كل لاعب خاصة، فلا تُعرض مباشرة أمام الجميع. تُعرض هنا مباريات الشطرنج والليدو فقط."
      />
    )
  }

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
  if (!room || String(room.gameId) !== String(gameId)
      || (room.status !== 'playing' && room.status !== 'ended')) {
    return (
      <Notice
        venue={venue}
        title={`${sides[0].label || 'طاولة'} ضد ${sides[1].label || 'طاولة'}`}
        body="تبدأ الجولة بعد لحظات…"
      />
    )
  }

  const Board = BOARDS[gameId]
  const ended = mode === 'ended' || result.over
  const banner = ended
    ? (result.draw
      ? 'تعادل'
      : `فازت ${(sides.find((s) => s.side === result.winner)?.label) || 'الطاولة'}`)
    : ''

  return (
    <div className="sv-root" data-mode={ended ? 'ended' : 'live'} style={{ '--sv-brand': brand }}>
      <BrandBar venue={venue} />

      {/* scoreboard: two tables + the live turn / result. RTL puts A on the
          right and B on the left, which reads naturally in Arabic. */}
      <div className="sv-score">
        <SideCard side={sides[0]} gameId={gameId} />
        <div className="sv-vs">
          <span className="sv-vs-word">ضد</span>
          <span className="sv-vs-game">{gameId === 'ludo' ? 'الليدو' : 'الشطرنج'}</span>
        </div>
        <SideCard side={sides[1]} gameId={gameId} />
      </div>

      {/* the live board — read-only. `pointer-events: none` (see spectate.css)
          makes it untappable even on a touch screen; the board also gets no
          onMove/onExit/mySeat, so it is non-interactive by contract too. */}
      <div className="sv-board">
        <div className="sv-board-inner">
          <BoardBoundary
            resetKey={match?.id || ''}
            fallback={<div className="sv-spin" aria-hidden="true" />}
          >
            <Suspense fallback={<div className="sv-spin" aria-hidden="true" />}>
              <Board room={room} mySeat={null} lang="ar" brand={brand} />
            </Suspense>
          </BoardBoundary>
        </div>
      </div>

      {/* result banner over the finished board */}
      {ended ? (
        <div className="sv-banner" data-draw={result.draw ? '1' : '0'}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>
          <span>{banner}</span>
        </div>
      ) : null}
    </div>
  )
}
