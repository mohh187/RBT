// ===========================================================================
// بطولة المكان الأسبوعية — the guest's window onto the tournament the venue is
// actually running.
//
// The document, its status machine and its prize belong to lib/tournaments.js
// (the manager's side). This component only reads them, which is why a guest
// can never see a different answer to "is it running" than the manager does.
//
// FOUR STATES, ALL OF THEM HONEST
//   nothing running        → renders nothing (or one calm line if showEmpty)
//   running, no entries    → «لم يسجّل أحد نتيجة بعد» and an invitation
//   running, streak mode   → no board at all, and it SAYS why: a streak cannot
//                            be derived from one self-written row per device
//   finalized              → the winners the venue froze onto the document,
//                            which outrank the live board completely
//
// A listener that failed is reported as a failure, never as "no tournament" —
// a venue must never be able to believe its prize is on screen when it is not.
// ===========================================================================
import { useCallback, useMemo } from 'react'
import Icon from '../Icon.jsx'
import { Card, Head, LivePill, BoardRow, useBrand, useNow, useWatch, pick } from './parts.jsx'
import {
  watchLiveTournament,
  watchTournamentEntries,
  tournamentWindow,
  tournamentPrize,
  tournamentWinners,
  myRankIn,
  resolvePlayer,
  fmtLeft,
  fmtNum,
} from '../../lib/socialPlay.js'
import { modeInfo } from '../../lib/tournaments.js'
import { gameById } from '../../lib/games.js'

const TOP = 8

export default function WeeklyTournament({
  tenantId,
  tenant = null,
  lang = 'ar',
  table = null,
  player = null,
  // Default false so the lead can mount this permanently: it stays invisible
  // until the venue actually runs a tournament. Turn it on for a dedicated
  // screen where an empty state beats an empty page.
  showEmpty = false,
  onPlay = null,
}) {
  const brand = useBrand(tenant)
  const me = useMemo(() => resolvePlayer(player), [player])

  const live = useWatch(
    (cb) => watchLiveTournament(tenantId, cb),
    [tenantId],
    { tournament: null, upcoming: null, all: [], error: null },
  )
  const t = live.tournament
  const mode = t?.mode || 'highscore'

  const board = useWatch(
    (cb) => (t?.id
      ? watchTournamentEntries(tenantId, t.id, cb, mode)
      : cb({ entries: [], rankable: false, error: null })),
    [tenantId, t?.id, mode],
    { entries: [], rankable: false, error: null },
  )

  const now = useNow(Boolean(t))
  const win = useMemo(() => tournamentWindow(t, now), [t, now])
  const mine = useMemo(() => myRankIn(board.entries, me.id), [board.entries, me.id])

  // A finalized tournament that is still inside its window shows the frozen
  // result; the live board is not a second opinion on an announced prize.
  const frozen = useMemo(() => tournamentWinners(t), [t])

  const game = t && t.gameId && t.gameId !== 'any' ? gameById(t.gameId) : null
  const info = modeInfo(mode)

  // The contract with the hub: a game id opens THAT game, and an empty id means
  // «any game counts» — the default for a venue tournament (gameId: 'any'). The
  // hub answers an empty id by returning the guest to the full game shelf with a
  // line saying every game on it enters the tournament. It must never be read as
  // "no game": that turns this button into a dead tap on a blank stage.
  const play = useCallback(() => {
    if (!onPlay || !t) return
    onPlay(t.gameId && t.gameId !== 'any' ? t.gameId : '', { source: 'tournament', tournamentId: t.id })
  }, [t, onPlay])

  // ---- nothing running -----------------------------------------------------
  // A failed read is NOT "no tournament", so it surfaces even when the empty
  // state is suppressed.
  if (!t) {
    if (live.error) {
      return (
        <Card brand={brand}>
          <Head icon="award" title={pick(lang, 'بطولة المكان', 'Venue tournament')} />
          <p className="sp-err">
            {live.error === 'permission'
              ? pick(lang, 'لا نملك صلاحية عرض البطولات هنا.', 'Tournaments are not readable here.')
              : pick(lang, 'تعذّر قراءة البطولات الآن. تحقّق من الاتصال ثم أعد فتح الصفحة.', 'Could not read tournaments right now.')}
          </p>
        </Card>
      )
    }
    if (!showEmpty) return null
    const soon = live.upcoming
    return (
      <Card brand={brand}>
        <Head icon="award" title={pick(lang, 'بطولة المكان', 'Venue tournament')} />
        <p className="sp-sub">
          {soon
            ? pick(lang, 'البطولة القادمة لم تبدأ بعد.', 'The next tournament has not started yet.')
            : pick(lang, 'لا توجد بطولة جارية الآن.', 'No tournament is running right now.')}
        </p>
        {soon?.name ? <p className="sp-note">{soon.name}</p> : null}
      </Card>
    )
  }

  const prize = tournamentPrize(t)
  const top = board.entries.slice(0, TOP)
  const showMineSeparately = mine && mine.rank > TOP

  return (
    <Card brand={brand}>
      <Head
        icon="award"
        title={t.name || pick(lang, 'بطولة المكان الأسبوعية', 'Weekly venue tournament')}
        right={<LivePill>{pick(lang, 'جارية', 'Live')}</LivePill>}
      />

      <p className="sp-sub">
        {game
          ? pick(lang, `اللعبة: ${game.ar}`, `Game: ${game.en || game.ar}`)
          : pick(lang, 'كل الألعاب تحتسب.', 'Every game counts.')}
        {' · '}
        <span className="sp-clock">
          {pick(lang, `يتبقّى ${fmtLeft(win.msLeft, lang)}`, `${fmtLeft(win.msLeft, lang)} left`)}
        </span>
      </p>

      {/* How the rank is earned, in the scoring engine's own words — so the
          screen and the code can never describe it differently. The sentence
          exists only in Arabic, so English falls back to the mode's name
          rather than showing Arabic prose to an English reader. */}
      {info ? <p className="sp-note">{lang === 'en' ? (info.en || info.ar) : info.howAr}</p> : null}

      {/* Shown verbatim. An empty prize promises nothing. */}
      {prize ? (
        <div className="sp-prize">
          <Icon name="offers" size={15} />
          <span>{prize}</span>
        </div>
      ) : null}

      {/* ---- the announced result outranks everything ---- */}
      {frozen.length ? (
        <>
          <p className="sp-sub" style={{ marginTop: 11 }}>
            {pick(lang, 'النتيجة المعلنة', 'The announced result')}
          </p>
          <div className="sp-board">
            {frozen.map((w) => (
              <BoardRow
                key={`${w.rank}-${w.deviceId || w.name}`}
                rank={w.rank}
                name={w.name}
                score={w.score}
                me={Boolean(w.deviceId) && w.deviceId === me.id}
              />
            ))}
          </div>
        </>
      ) : board.error ? (
        <p className="sp-err">{pick(lang, 'تعذّر تحميل الترتيب.', 'Could not load the standings.')}</p>
      ) : !board.rankable ? (
        // streak (and anything added later that one row per device cannot
        // express). Withholding the board is the honest move.
        <p className="sp-empty">
          {pick(
            lang,
            'ترتيب هذه البطولة يُحتسب عند الإعلان، فلا نعرض لوحة مباشرة قد تخالف النتيجة النهائية.',
            'This tournament is ranked at announcement, so no live board is shown that could disagree with it.',
          )}
        </p>
      ) : top.length ? (
        <div className="sp-board">
          {top.map((r) => (
            <BoardRow
              key={r.deviceId || r.id}
              rank={r.rank}
              name={r.name}
              score={r.value}
              me={r.deviceId === me.id}
            />
          ))}
        </div>
      ) : (
        <p className="sp-empty">
          {pick(lang, 'لم يسجّل أحد نتيجة في هذه البطولة بعد. كن أول اسم على اللوحة.', 'Nobody has scored yet. Be the first name here.')}
        </p>
      )}

      {!frozen.length && showMineSeparately ? (
        <div className="sp-mine">
          <Icon name="user" size={15} />
          <span>{pick(lang, 'ترتيبك', 'Your rank')}</span>
          <span className="sp-score">{fmtNum(mine.rank)}</span>
          <span className="sp-meta">{pick(lang, `من ${fmtNum(mine.total)}`, `of ${fmtNum(mine.total)}`)}</span>
        </div>
      ) : null}

      {!frozen.length && board.rankable && !mine && board.entries.length > 0 ? (
        <p className="sp-note">{pick(lang, 'لم تدخل البطولة بعد.', 'You have not entered yet.')}</p>
      ) : null}

      {onPlay && !frozen.length ? (
        <div className="sp-actions">
          <button type="button" className="sp-btn sp-wide" onClick={play}>
            <Icon name="play" size={15} />
            {mine ? pick(lang, 'حسّن نتيجتك', 'Improve your standing') : pick(lang, 'ادخل البطولة', 'Enter the tournament')}
          </button>
        </div>
      ) : null}

      {table?.label ? (
        <p className="sp-note">{pick(lang, `طاولتك: ${table.label}`, `Your table: ${table.label}`)}</p>
      ) : null}
    </Card>
  )
}
