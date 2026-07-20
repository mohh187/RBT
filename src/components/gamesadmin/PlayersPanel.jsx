// «اللاعبون» — the roster behind the play data.
//
// The rows are built by `playersFrom` in src/components/play/engine.jsx — the
// SAME function that powers «نشاط الألعاب والتحليل». That is reuse on purpose:
// two screens computing "who played" separately would eventually disagree, and
// a manager comparing them would have no way to tell which one lied.
//
// What is NOT reused is the presentation. GuestPlay owns the deep analysis
// (segments, quiz breakdowns, the AI tab); this panel is a compact operational
// roster for the games section, and it links across rather than re-implementing.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../Icon.jsx'
import { playersFrom, playerLabel, maskPhone, shortDevice } from '../play/engine.jsx'
import { tagLabel, tagRule } from '../../lib/gameMemory.js'
import { gameById } from '../../lib/games.js'
import {
  fmtInt, fmtPct, dateTime, dayStamp, durText, isSoloPlay, opponentKind, opponentLabel,
} from './engine.jsx'

const num = (v, f = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : f
}

const gameName = (id, ar) => {
  const g = gameById(id)
  return g ? (ar ? g.ar : (g.en || g.ar)) : id
}

// The games this player actually put the most rounds into, with the counts that
// justify the label. Never "favourite" — just "most played, by this count".
function topGames(row, max = 3) {
  return Object.entries(row.byGame || {})
    .map(([gameId, g]) => ({ gameId, plays: num(g.plays), best: num(g.best) }))
    .sort((a, b) => b.plays - a.plays || b.best - a.best)
    .slice(0, max)
}

function PlayerDetail({ ar, row, onBack, soloPlays = 0 }) {
  const games = Object.entries(row.byGame || {})
    .map(([gameId, g]) => ({ gameId, ...g }))
    .sort((a, b) => num(b.plays) - num(a.plays))
  const recent = (row.plays || []).slice(0, 15)

  return (
    <div className="ga-stack">
      <div className="ga-sheet-head">
        <button type="button" className="ga-back" onClick={onBack}>
          <Icon name="back" size={16} /> <span>{ar ? 'كل اللاعبين' : 'All players'}</span>
        </button>
      </div>

      <div className="ga-card">
        <div className="ga-sheet-title">
          <span className="ga-ico"><Icon name="user" size={22} /></span>
          <div className="ga-sheet-t">
            <strong>{playerLabel(row, ar)}</strong>
            <span className="ga-num">
              {row.customerPhone ? maskPhone(row.customerPhone) : (ar ? 'بلا رقم جوال — لا يمكن مراسلته' : 'no phone')}
              {' · '}
              {shortDevice(row.deviceId)}
            </span>
          </div>
        </div>

        {row.outsideWindow && (
          <p className="ga-hint">
            {ar
              ? 'هذا اللاعب لم يلعب داخل الفترة المختارة. الأرقام أدناه من ملفه التراكمي الكامل، لا من الفترة.'
              : 'No play inside the selected period; figures come from the lifetime rollup.'}
          </p>
        )}

        <div className="ga-figs">
          <div className="ga-fig">
            <span className="ga-fig-l">{ar ? 'الجولات' : 'Plays'}</span>
            <strong className="ga-fig-v ga-num">{fmtInt(row.totalPlays)}</strong>
          </div>
          <div className="ga-fig">
            <span className="ga-fig-l">{ar ? 'مجموع النقاط' : 'Total points'}</span>
            <strong className="ga-fig-v ga-num">{fmtInt(row.totalScore)}</strong>
          </div>
          <div className="ga-fig">
            <span className="ga-fig-l">{ar ? 'أعلى نتيجة' : 'Best'}</span>
            <strong className="ga-fig-v ga-num">{fmtInt(row.bestScore)}</strong>
          </div>
          <div className="ga-fig">
            <span className="ga-fig-l">{ar ? 'نسبة الإكمال' : 'Completion'}</span>
            <strong className="ga-fig-v ga-num">{fmtPct(row.completionRate)}</strong>
            <span className="ga-fig-s ga-num">{fmtInt(row.completedPlays)} / {fmtInt(row.totalPlays)}</span>
          </div>
          {/* Only for a player whose figures came from the window's plays — for
              an out-of-window row the totals come from the lifetime rollup, which
              carries no solo split, so subtracting a window count from it would
              produce a number that means nothing. */}
          {soloPlays > 0 && !row.outsideWindow && (
            // This player's own totals DO include computer rounds on purpose —
            // they are rounds he really played. What must not happen is a
            // manager reading them as competitive play, so the split is shown
            // next to them rather than explained in a footnote.
            <div className="ga-fig">
              <span className="ga-fig-l">{ar ? 'منها ضد الكمبيوتر' : 'Of which vs computer'}</span>
              <strong className="ga-fig-v ga-num">{fmtInt(soloPlays)}</strong>
              <span className="ga-fig-s ga-num">
                {ar ? 'أمام أشخاص' : 'vs people'} {fmtInt(Math.max(0, num(row.totalPlays) - soloPlays))}
              </span>
            </div>
          )}
          <div className="ga-fig">
            <span className="ga-fig-l">{ar ? 'ألعاب جرّبها' : 'Games tried'}</span>
            <strong className="ga-fig-v ga-num">{fmtInt(row.gamesTried)}</strong>
          </div>
          <div className="ga-fig">
            <span className="ga-fig-l">{ar ? 'أول وآخر ظهور' : 'First / last'}</span>
            <strong className="ga-fig-v ga-num">{dayStamp(row.firstAt)} — {dayStamp(row.lastAt)}</strong>
          </div>
        </div>
      </div>

      {row.insight?.archetype && (
        <div className="ga-card">
          <div className="ga-card-t"><Icon name="sparkles" size={15} /> {ar ? 'النمط المعلَن ذاتياً' : 'Self-reported type'}</div>
          <strong>{row.insight.archetype}</strong>
          <p className="ga-hint">
            {ar
              ? 'ناتج عن اختيارات تركها الضيف بنفسه داخل لعبة في المنيو. وصف ذاتي وليس تشخيصاً ولا حكماً على شخص.'
              : 'From the guest\'s own picks inside a menu game — self-report, not a diagnosis.'}
          </p>
        </div>
      )}

      {(row.tags || []).length > 0 && (
        <div className="ga-card">
          <div className="ga-card-t"><Icon name="layers" size={15} /> {ar ? 'الوسوم وقواعدها' : 'Tags & their rules'}</div>
          {(row.tags || []).map((t) => (
            <div key={t} className="ga-tagrow">
              <span className="ga-tag">{tagLabel(t, ar)}</span>
              <span className="ga-hint">{tagRule(t, ar)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="ga-card">
        <div className="ga-card-t"><Icon name="play" size={15} /> {ar ? 'حسب اللعبة' : 'By game'}</div>
        {games.length ? (
          <div className="ga-tablewrap">
            <table className="ga-table">
              <thead>
                <tr>
                  <th>{ar ? 'اللعبة' : 'Game'}</th>
                  <th>{ar ? 'جولات' : 'Plays'}</th>
                  <th>{ar ? 'أفضل' : 'Best'}</th>
                  <th>{ar ? 'أبعد مرحلة' : 'Stage'}</th>
                  <th>{ar ? 'آخر مرة' : 'Last'}</th>
                </tr>
              </thead>
              <tbody>
                {games.map((g) => (
                  <tr key={g.gameId}>
                    <td>{g.gameAr || gameName(g.gameId, ar)}</td>
                    <td className="ga-num">{fmtInt(g.plays)}</td>
                    <td className="ga-num">{fmtInt(g.best)}</td>
                    <td className="ga-num">{num(g.stage) ? fmtInt(g.stage) : '—'}</td>
                    <td className="ga-num">{dateTime(g.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="ga-hint">{ar ? 'لا سجل لعب لهذا اللاعب.' : 'No play history.'}</p>}
      </div>

      <div className="ga-card">
        <div className="ga-card-t"><Icon name="clock" size={15} /> {ar ? 'آخر الجولات' : 'Recent rounds'}</div>
        {recent.length ? (
          <div className="ga-tablewrap">
            <table className="ga-table">
              <thead>
                <tr>
                  <th>{ar ? 'متى' : 'When'}</th>
                  <th>{ar ? 'اللعبة' : 'Game'}</th>
                  <th>{ar ? 'الخصم' : 'Opponent'}</th>
                  <th>{ar ? 'النقاط' : 'Score'}</th>
                  <th>{ar ? 'المدة' : 'Duration'}</th>
                  <th>{ar ? 'أُكملت' : 'Done'}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p) => (
                  <tr key={p.id || p.playId}>
                    <td className="ga-num">{dateTime(p.startedAt)}</td>
                    <td>{p.gameAr || gameName(p.gameId, ar)}</td>
                    <td>
                      <span className={opponentKind(p) === 'people' ? 'ga-of' : 'ga-thin'}>
                        {opponentLabel(opponentKind(p), ar)}
                      </span>
                    </td>
                    <td className="ga-num">{fmtInt(p.score)}</td>
                    <td className="ga-num">{num(p.durationMs) > 0 ? durText(num(p.durationMs) / 1000) : '—'}</td>
                    <td>{p.completed === true ? <span className="ga-ok"><Icon name="ok" size={14} /></span> : <span className="ga-of">{ar ? 'لا' : 'No'}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ga-hint">
            {ar
              ? 'لا جولات لهذا اللاعب داخل الفترة المختارة — الأرقام أعلاه من ملفه التراكمي.'
              : 'No rounds inside the selected period.'}
          </p>
        )}
      </div>

      <p className="ga-hint">
        {ar
          ? 'للتحليل الأعمق (الشرائح، دقة الأسئلة، الحملات المبنية على السلوك) افتح «نشاط الألعاب والتحليل».'
          : 'For deeper analysis open the play activity page.'}
        {' '}
        <Link className="ga-link" to="/admin/guest-play">{ar ? 'فتح الصفحة' : 'Open'}</Link>
      </p>
    </div>
  )
}

export default function PlayersPanel({
  ar = true, plays = [], profiles = [], periodLabel = '',
}) {
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState('')

  const players = useMemo(() => playersFrom(plays, profiles), [plays, profiles])

  // Counted here rather than inside `playersFrom`, which is shared with the deep
  // analysis page and is not this fix's to reshape. Same predicate as everywhere
  // else, so the roster cannot disagree with the catalogue about what solo is.
  const soloByDevice = useMemo(() => {
    const m = new Map()
    for (const p of plays) {
      if (!p || !p.deviceId || !isSoloPlay(p)) continue
      m.set(p.deviceId, (m.get(p.deviceId) || 0) + 1)
    }
    return m
  }, [plays])
  const soloTotal = useMemo(
    () => [...soloByDevice.values()].reduce((n, v) => n + v, 0),
    [soloByDevice],
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return players
    return players.filter((p) => (
      String(p.customerName || '').toLowerCase().includes(needle)
      || String(p.customerPhone || '').includes(needle)
      || String(p.deviceId || '').toLowerCase().includes(needle)
    ))
  }, [players, q])

  const open = openId ? players.find((p) => p.deviceId === openId) : null
  if (open) {
    return (
      <PlayerDetail
        ar={ar}
        row={open}
        soloPlays={soloByDevice.get(open.deviceId) || 0}
        onBack={() => setOpenId('')}
      />
    )
  }

  const identified = players.filter((p) => p.customerPhone).length

  return (
    <div className="ga-stack">
      <div className="ga-card">
        <div className="ga-card-t">
          <Icon name="customers" size={15} /> {ar ? 'لاعبو هذا المكان' : 'Players'}
          <span className="ga-grow" />
          <span className="ga-of ga-num">{fmtInt(players.length)}</span>
        </div>
        <p className="ga-hint">
          {ar
            ? `${fmtInt(identified)} من ${fmtInt(players.length)} تركوا رقم جوال — هؤلاء وحدهم يمكن مراسلتهم. البقية أجهزة مجهولة، وهذا واقع البيانات لا نقص فيها.`
            : `${identified} of ${players.length} left a phone; only those are reachable.`}
          {periodLabel ? <span className="ga-num"> {' · '}{periodLabel}</span> : null}
        </p>
        {soloTotal > 0 && (
          // «جولات» in this table is every round the guest played, computer
          // rounds included. That is the right total for a roster — but it is NOT
          // a competitive figure, and it must not be read as one.
          <p className="ga-hint">
            {ar
              ? `عمود «جولات» هنا يشمل الجولات ضد الكمبيوتر — ${fmtInt(soloTotal)} منها في هذه الفترة. للترتيب التنافسي استخدم البطولات، فهي تستبعدها.`
              : `The plays column here includes computer rounds (${fmtInt(soloTotal)} this period). Tournament standings exclude them.`}
          </p>
        )}
        <label className="ga-search">
          <Icon name="search" size={15} />
          <input
            className="ga-input" type="search" value={q}
            placeholder={ar ? 'ابحث بالاسم أو رقم الجوال' : 'Search name or phone'}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      {players.length === 0 ? (
        <div className="ga-card">
          <p className="ga-empty-t">{ar ? 'لا لاعبين بعد' : 'No players yet'}</p>
          <p className="ga-hint">
            {ar
              ? 'عند أول ضيف يفتح ركن الألعاب من المنيو يظهر هنا صفّه: اسمه إن سجّله، عدد جولاته، نقاطه، أكثر ألعابه، ووسومه المبنية على قواعد معلنة.'
              : 'The first guest to open the games corner appears here.'}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="ga-card">
          <p className="ga-hint">{ar ? 'لا لاعب يطابق هذا البحث.' : 'No player matches this search.'}</p>
        </div>
      ) : (
        <div className="ga-card">
          <div className="ga-tablewrap">
            <table className="ga-table is-click">
              <thead>
                <tr>
                  <th>{ar ? 'اللاعب' : 'Player'}</th>
                  <th>{ar ? 'جولات' : 'Plays'}</th>
                  <th>{ar ? 'نقاط' : 'Points'}</th>
                  <th>{ar ? 'أكثر ألعابه' : 'Most played'}</th>
                  <th>{ar ? 'النمط' : 'Type'}</th>
                  <th>{ar ? 'وسوم' : 'Tags'}</th>
                  <th>{ar ? 'آخر ظهور' : 'Last seen'}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.deviceId} onClick={() => setOpenId(p.deviceId)}>
                    <td>
                      <div className="ga-cellname">
                        <strong>{playerLabel(p, ar)}</strong>
                        <small className="ga-num">{p.customerPhone ? maskPhone(p.customerPhone) : shortDevice(p.deviceId)}</small>
                      </div>
                    </td>
                    <td className="ga-num">{fmtInt(p.totalPlays)}</td>
                    <td className="ga-num">{fmtInt(p.totalScore)}</td>
                    <td>
                      <span className="ga-evi">
                        {topGames(p).map((g) => (
                          <span key={g.gameId} className="ga-num">
                            {gameName(g.gameId, ar)} ({fmtInt(g.plays)})
                          </span>
                        ))}
                        {topGames(p).length === 0 ? <span className="ga-of">—</span> : null}
                      </span>
                    </td>
                    <td>{p.insight?.archetype || <span className="ga-of">—</span>}</td>
                    <td>
                      <span className="ga-chipsrow">
                        {(p.tags || []).slice(0, 3).map((t) => (
                          <span key={t} className="ga-tag ga-tag-sm" title={tagRule(t, ar)}>{tagLabel(t, ar)}</span>
                        ))}
                      </span>
                    </td>
                    <td className="ga-num">
                      {dateTime(p.lastAt)}
                      {p.outsideWindow ? <span className="ga-thin">{ar ? 'خارج الفترة' : 'outside'}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
