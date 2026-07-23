// ===========================================================================
// TOURNAMENT BOARD — the venue's running competition, sized for a wall.
//
// PURE PRESENTATION. Every subscription lives in ScreenPlayer (one listener per
// screen, not one per slide rotation), so this component never re-reads
// Firestore when the playlist cycles back to it.
//
// WHAT IT IS ALLOWED TO SAY, and why that matters on a wall:
//   • the standings come from tenants/{tid}/tournaments/{id}/entries — ONE
//     self-written row per device, world-readable by rule, carrying a name and
//     a score and NO phone. That is the same board the guests' own phones show
//     (socialPlay.watchTournamentEntries → rankEntries), so the wall and the
//     phone can never disagree.
//   • a FINALIZED tournament shows the venue's own frozen `winners` array and
//     nothing else — the manager's announced result outranks the live board
//     everywhere, exactly as lib/tournaments.js documents.
//   • the 'streak' mode is NOT derivable from one row per device, so the board
//     is WITHHELD and the room is told the ranking is settled at announcement.
//     An honest blank beats a leaderboard that ranks the wrong person for a
//     real prize.
//   • an empty entries list says «لا نتائج بعد» — it never pads the table with
//     invented names to fill a 1920x1080 panel.
//
// Latin digits everywhere (fmtNum / fmtLeft build them from integers), no emoji
// — the trophy and clock are inline SVG.
// ===========================================================================
import { fmtNum, fmtLeft } from '../../lib/socialPlay.js'
import { BrandBar } from '../../components/screen/LiveMatchScreen.jsx'
import './screen-games.css'

// How many rows a 1080p wall can carry without the type shrinking below
// "readable from across a room". Deliberately a hard cap rather than a scroll:
// a signage screen nobody can touch must never hide content behind a scrollbar.
export const TV_BOARD_ROWS = 8

const MODE_AR = {
  highscore: 'الترتيب بأعلى نتيجة في جولة واحدة',
  mostPlays: 'الترتيب بعدد الجولات',
  streak: 'الترتيب بأطول تتابع أيام',
}
const UNIT_AR = { highscore: 'نقطة', mostPlays: 'جولة', streak: 'يوم' }

const GAME_AR = {
  any: 'كل الألعاب',
  ludo: 'الليدو',
  chess: 'الشطرنج',
  dominoes: 'الدومينو',
  wist: 'الوِست',
  jackaroo: 'الجكارو',
  haree: 'الحريق',
}

function Clock({ msLeft }) {
  return (
    <div className="tvg-cup-clock">
      <b className="tvg-num">{fmtLeft(msLeft)}</b>
      <span>المتبقي</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TournamentBoard
//   tournament  normalized tournament document (lib/tournaments.js shape)
//   entries     already-ranked rows (socialPlay.rankEntries) — [] is a RESULT
//   rankable    false for 'streak' — the board is withheld, not faked
//   winners     the venue's frozen winners, when the tournament is finalized
//   venue       tenant document, for the brand bar
//   now         epoch ms from the caller's own heartbeat, so the countdown
//               ticks without this component owning a timer
// ---------------------------------------------------------------------------
export default function TournamentBoard({
  tournament,
  entries = [],
  rankable = true,
  winners = [],
  venue = null,
  now = Date.now(),
  className = '',
}) {
  if (!tournament) return null
  const brand = venue?.brandColor || venue?.themeColor || '#0e7490'
  const finalized = !!tournament.finalizedAt
  const rows = finalized ? winners : entries
  const unit = UNIT_AR[tournament.mode] || 'نقطة'
  const prize = String(tournament.prize?.label || '').slice(0, 120)
  const gameAr = GAME_AR[tournament.gameId] || tournament.gameId
  const msLeft = Math.max(0, Number(tournament.to || 0) - now)

  const list = (Array.isArray(rows) ? rows : []).slice(0, TV_BOARD_ROWS)

  return (
    <div className={`tvg-root${className ? ' ' + className : ''}`} style={{ '--tvg-brand': brand }}>
      <BrandBar
        venue={venue}
        context={finalized ? 'نتيجة البطولة' : 'بطولة جارية'}
        live={!finalized}
        liveLabel="مباشر"
      />

      <div className="tvg-cup">
        <div className="tvg-cup-head">
          <div className="tvg-cup-meta">
            <h2 className="tvg-cup-title">{tournament.name || 'بطولة'}</h2>
            <span className="tvg-cup-sub">
              {gameAr}
              {' · '}
              {MODE_AR[tournament.mode] || ''}
            </span>
            {prize ? (
              <span className="tvg-cup-prize">
                <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>
                {prize}
              </span>
            ) : null}
          </div>
          {finalized ? null : <Clock msLeft={msLeft} />}
        </div>

        {/* THE THREE HONEST STATES. None of them is a spinner, and none of them
            fills the wall with numbers nobody earned. */}
        {!rankable && !finalized ? (
          <div className="tvg-notice" style={{ margin: 'auto' }}>
            <h3 className="tvg-notice-t">الترتيب يُعلن في النهاية</h3>
            <p className="tvg-notice-p">
              هذه البطولة تُرتَّب بأطول تتابع أيام، وهو لا يُحسب من لوحة مباشرة.
              يُحتسب الترتيب النهائي ويُعلن من إدارة المكان عند انتهاء الفترة.
            </p>
          </div>
        ) : list.length === 0 ? (
          <div className="tvg-notice" style={{ margin: 'auto' }}>
            <h3 className="tvg-notice-t">لا نتائج بعد</h3>
            <p className="tvg-notice-p">
              كن أول من يدخل اللوحة — افتح ركن الألعاب من قائمة المكان والعب جولة الآن.
            </p>
          </div>
        ) : (
          <div className="tvg-board">
            {list.map((r, i) => {
              const rank = Number(r.rank) || i + 1
              const value = Number(finalized ? r.score : r.value) || 0
              return (
                <div key={(r.deviceId || r.id || '') + ':' + rank} className="tvg-row" data-rank={String(rank)}>
                  <span className="tvg-rank tvg-num">{fmtNum(rank)}</span>
                  <span className="tvg-rowname">{r.name || 'ضيف'}</span>
                  <span className="tvg-rowval">
                    <b className="tvg-num">{fmtNum(value)}</b>
                    <span>{unit}</span>
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <p className="tvg-foot">
          {finalized
            ? 'النتيجة النهائية كما أعلنها المكان.'
            : 'اللوحة تتحدّث لحظياً. الجولات ضد الكمبيوتر لا تُحتسب.'}
        </p>
      </div>
    </div>
  )
}
