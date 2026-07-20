// ===========================================================================
// ساعة الذروة الجماعية — for one window the whole venue plays the same game.
//
// The window is a VENUE SETTING, not a document per occurrence:
//   tenant.gameHappyHour = { enabled, gameId, startTime, endTime,
//                            daysOfWeek, prizeLabel }
// which means there is nothing to clean up, nothing to expire, and no way for
// a stale "happy hour" to survive the venue switching it off — the next tenant
// snapshot simply stops matching and this component returns null.
//
// It renders NOTHING outside the window. Not a greyed card, not a "coming
// soon": a banner that is visible when there is no happy hour trains guests to
// ignore it on the one evening it matters.
//
// The countdown re-evaluates every second against the real clock, so a phone
// left open across the closing minute rolls the banner away by itself.
// ===========================================================================
import { useCallback, useMemo } from 'react'
import Icon from '../Icon.jsx'
import { Card, Head, LivePill, BoardRow, useBrand, useNow, useWatch, pick } from './parts.jsx'
import {
  happyHourWindow,
  watchHappyHourBoard,
  myRankIn,
  resolvePlayer,
  dayKey,
  fmtLeft,
  fmtNum,
} from '../../lib/socialPlay.js'
import { gameById } from '../../lib/games.js'

const TOP = 5

export default function HappyHourBanner({
  tenantId,
  tenant = null,
  lang = 'ar',
  table = null,
  player = null,
  // onPlay(gameId, { source }) — the one tap that joins.
  onPlay = null,
  // Show the shared board under the banner. Off gives a pure strip.
  showBoard = true,
}) {
  const brand = useBrand(tenant)
  const me = useMemo(() => resolvePlayer(player), [player])
  const cfg = tenant?.gameHappyHour || null

  // Tick every second only while something is plausibly configured — a venue
  // with no happy hour pays for no timer.
  const now = useNow(Boolean(cfg?.enabled))
  const win = useMemo(() => happyHourWindow(cfg, now), [cfg, now])

  const board = useWatch(
    (cb) => ((win.active && showBoard) ? watchHappyHourBoard(tenantId, dayKey(), cb) : cb({ rows: [], error: null })),
    [tenantId, win.active, showBoard],
    { rows: [], error: null },
  )

  const mine = useMemo(() => myRankIn(board.rows, me.id), [board.rows, me.id])

  const join = useCallback(() => {
    if (win.gameId && onPlay) onPlay(win.gameId, { source: 'happyHour' })
  }, [win.gameId, onPlay])

  // Outside the window there is nothing true to say. Say nothing.
  if (!win.active) return null

  const game = gameById(win.gameId)
  const rows = board.rows.slice(0, TOP)

  return (
    <Card brand={brand} hot>
      <Head
        icon="flame"
        title={pick(lang, 'ساعة الذروة — الكل يلعب الآن', 'Happy hour — everyone is playing')}
        right={<LivePill>{fmtLeft(win.msLeft, lang)}</LivePill>}
      />

      <p className="sp-sub">
        {game
          ? pick(
            lang,
            `اللعبة الآن: ${game.ar}. من يلعب داخل هذه الساعة يدخل لوحة واحدة مع كل من في المكان.`,
            `Now playing: ${game.en || game.ar}. Play inside the window and you join one shared board.`,
          )
          : pick(
            lang,
            'اللعبة المختارة غير متاحة في هذا المكان حالياً.',
            'The scheduled game is not available in this venue right now.',
          )}
      </p>

      {/* Verbatim, or not at all. */}
      {win.prizeLabel ? (
        <div className="sp-prize">
          <Icon name="offers" size={15} />
          <span>{win.prizeLabel}</span>
        </div>
      ) : null}

      {game && onPlay ? (
        <div className="sp-actions">
          <button type="button" className="sp-btn sp-wide" onClick={join}>
            <Icon name="play" size={15} />
            {mine ? pick(lang, 'ارفع نتيجتك', 'Improve your score') : pick(lang, 'انضم الآن', 'Join now')}
          </button>
        </div>
      ) : null}

      {showBoard ? (
        board.error ? (
          <p className="sp-err">{pick(lang, 'تعذّر تحميل اللوحة المشتركة.', 'Could not load the shared board.')}</p>
        ) : rows.length ? (
          <div className="sp-board">
            {rows.map((r) => (
              <BoardRow key={r.deviceId || r.id} rank={r.rank} name={r.name} score={r.score} me={r.deviceId === me.id} />
            ))}
          </div>
        ) : (
          <p className="sp-empty">
            {pick(lang, 'لا أحد على اللوحة بعد. أول من يلعب يتصدّر.', 'Nobody is on the board yet. First to play leads it.')}
          </p>
        )
      ) : null}

      {mine && mine.rank > TOP ? (
        <div className="sp-mine">
          <Icon name="user" size={15} />
          <span>{pick(lang, 'ترتيبك', 'Your rank')}</span>
          <span className="sp-score">{fmtNum(mine.rank)}</span>
          <span className="sp-meta">{pick(lang, `من ${fmtNum(mine.total)}`, `of ${fmtNum(mine.total)}`)}</span>
        </div>
      ) : null}

      {table?.label ? (
        <p className="sp-note">{pick(lang, `من ${table.label}`, `From ${table.label}`)}</p>
      ) : null}
    </Card>
  )
}
