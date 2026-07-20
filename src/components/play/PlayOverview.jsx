// Overview tab: what actually happened, with the sample size next to every
// figure. Nothing here is smoothed, estimated or projected — each number is a
// count of rows that exist.
import Icon from '../Icon.jsx'
import { fmtNum } from '../../lib/format.js'
import { THIN_PLAYS, THIN_ANSWERS, THIN_PLAYERS } from './engine.jsx'

const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)
const secText = (s, ar) => (s == null ? '—' : (s >= 60 ? `${fmtNum(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}` : `${fmtNum(s)} ${ar ? 'ث' : 's'}`))

function Kpi({ label, value, sub, thin, thinText }) {
  return (
    <div className="gp-kpi">
      <span className="gp-kpi-l">{label}</span>
      <span className="gp-kpi-v gp-num">{value}</span>
      {sub && <span className="gp-kpi-s">{sub}</span>}
      {thin && <span className="gp-thin">{thinText}</span>}
    </div>
  )
}

export default function PlayOverview({ over, games = [], quiz, hard = [], archetypes, findings = [], ar = true }) {
  const thinTxt = ar ? 'عينة صغيرة' : 'thin sample'
  const maxPlays = Math.max(1, ...games.map((g) => g.plays))

  return (
    <div className="gp-stack">
      <div className="gp-kpis">
        <Kpi
          label={ar ? 'المحاولات المسجّلة' : 'Plays recorded'}
          value={fmtNum(over.plays)}
          sub={ar ? `منها ${fmtNum(over.endedPlays)} انتهت فعلاً` : `${fmtNum(over.endedPlays)} ended`}
          thin={over.plays < THIN_PLAYS} thinText={thinTxt}
        />
        <Kpi
          label={ar ? 'لاعبون مختلفون' : 'Unique players'}
          value={fmtNum(over.players)}
          sub={ar
            ? `${fmtNum(over.identifiedPlayers)} معروف · ${fmtNum(over.anonymousPlayers)} مجهول`
            : `${fmtNum(over.identifiedPlayers)} known · ${fmtNum(over.anonymousPlayers)} anonymous`}
          thin={over.players < THIN_PLAYERS} thinText={thinTxt}
        />
        <Kpi
          label={ar ? 'متوسط مدة اللعب' : 'Average duration'}
          value={secText(over.avgDurationSec, ar)}
          sub={ar
            ? `الوسيط ${secText(over.medianDurationSec, ar)} · من ${fmtNum(over.endedPlays)} محاولة منتهية`
            : `median ${secText(over.medianDurationSec, ar)}`}
        />
        <Kpi
          label={ar ? 'نسبة الإكمال' : 'Completion rate'}
          value={over.completionRate == null ? '—' : `${fmtNum(Math.round(over.completionRate * 100))}%`}
          sub={ar ? `${fmtNum(over.completedPlays)} من ${fmtNum(over.plays)}` : `${fmtNum(over.completedPlays)} of ${fmtNum(over.plays)}`}
          thin={over.plays < THIN_PLAYS} thinText={thinTxt}
        />
        <Kpi
          label={ar ? 'محاولات لكل لاعب' : 'Plays per player'}
          value={over.playsPerPlayer == null ? '—' : fmtNum(over.playsPerPlayer)}
          sub={ar ? 'كلما ارتفع، زاد التعلّق باللعبة' : 'higher means stickier'}
        />
        <Kpi
          label={ar ? 'إجابات مسجّلة' : 'Answers recorded'}
          value={fmtNum(over.answersRecorded)}
          sub={ar ? `منها ${fmtNum(quiz.answered)} لها إجابة صحيحة` : `${fmtNum(quiz.answered)} scored`}
        />
      </div>

      {/* Rule findings — true with or without the AI tab. */}
      {findings.length > 0 && (
        <div className="gp-card">
          <span className="gp-card-t"><Icon name="notepad" size={17} /> {ar ? 'ما تقوله الأرقام بلا ذكاء اصطناعي' : 'What the numbers already say'}</span>
          <div className="gp-findings">
            {findings.map((f) => (
              <div className={`gp-finding is-${f.tone}`} key={f.key}>
                <Icon name={f.tone === 'good' ? 'check' : (f.tone === 'neutral' ? 'notepad' : 'warning')} size={15} />
                <div>
                  <strong>{f.title}</strong>
                  <p>{f.body}</p>
                  <span className="gp-of gp-num">{ar ? 'حجم العينة' : 'sample'} {fmtNum(f.sample)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="gp-two">
        {/* Most played */}
        <div className="gp-card">
          <span className="gp-card-t"><Icon name="play" size={17} /> {ar ? 'الألعاب الأكثر لعباً' : 'Most played'}</span>
          {!games.length ? (
            <p className="gp-hint">{ar ? 'لا محاولات في هذه الفترة.' : 'No plays in this period.'}</p>
          ) : (
            <div className="gp-bars">
              {games.slice(0, 10).map((g) => (
                <div className="gp-bar" key={g.gameId}>
                  <span className="gp-bar-l" title={g.gameAr}>{g.gameAr}</span>
                  <span className="gp-bar-track"><i className="gp-bar-fill" style={{ width: `${Math.round((g.plays / maxPlays) * 100)}%` }} /></span>
                  <span className="gp-bar-v gp-num">{fmtNum(g.plays)}</span>
                </div>
              ))}
            </div>
          )}
          {games.length > 0 && (
            <div className="gp-tablewrap">
              <table className="gp-table">
                <thead>
                  <tr>
                    <th>{ar ? 'اللعبة' : 'Game'}</th>
                    <th>{ar ? 'محاولات' : 'Plays'}</th>
                    <th>{ar ? 'لاعبون' : 'Players'}</th>
                    <th>{ar ? 'الإكمال' : 'Completion'}</th>
                    <th>{ar ? 'المدة' : 'Duration'}</th>
                    <th>{ar ? 'أعلى نتيجة' : 'Best'}</th>
                  </tr>
                </thead>
                <tbody>
                  {games.map((g) => (
                    <tr key={g.gameId} style={{ cursor: 'default' }}>
                      <td><span className="gp-cell-name">{g.gameAr}<small>{g.kind}</small></span></td>
                      <td className="gp-num">{fmtNum(g.plays)}</td>
                      <td className="gp-num">{fmtNum(g.players)}</td>
                      <td className="gp-num">
                        {g.completionRate == null ? '—' : `${fmtNum(Math.round(g.completionRate * 100))}%`}
                        {g.thin && <> <span className="gp-thin">{thinTxt}</span></>}
                      </td>
                      <td className="gp-num">{secText(g.avgDurationSec, ar)}</td>
                      <td className="gp-num">{fmtNum(g.best)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quiz accuracy */}
        <div className="gp-card">
          <span className="gp-card-t"><Icon name="check" size={17} /> {ar ? 'دقة الإجابات حسب التصنيف' : 'Quiz accuracy by category'}</span>
          <p className="gp-hint">
            {ar
              ? `تُحتسب فقط الأسئلة التي لها إجابة صحيحة واحدة. أسئلة الشخصية لا تدخل هنا إطلاقاً لأنه لا توجد فيها إجابة صحيحة. أي تصنيف تحت ${fmtNum(THIN_ANSWERS)} إجابة يُوسم «عينة صغيرة».`
              : `Only questions with one right answer are counted. Anything under ${fmtNum(THIN_ANSWERS)} answers is labelled thin.`}
          </p>
          {!quiz.rows.length ? (
            <p className="gp-hint">{ar ? 'لم تُسجَّل أي إجابة قابلة للتصحيح بعد.' : 'No scored answers yet.'}</p>
          ) : (
            <>
              <div className="gp-bars">
                {quiz.rows.slice(0, 10).map((r) => {
                  const p = Math.round((r.accuracy || 0) * 100)
                  return (
                    <div className="gp-bar" key={r.cat}>
                      <span className="gp-bar-l" title={r.cat}>{r.cat}</span>
                      <span className="gp-bar-track">
                        <i className={`gp-bar-fill ${p >= 70 ? 'is-good' : (p <= 40 ? 'is-bad' : '')}`} style={{ width: `${p}%` }} />
                      </span>
                      <span className="gp-bar-v gp-num">{fmtNum(p)}% <span className="gp-of">({fmtNum(r.answered)})</span></span>
                    </div>
                  )
                })}
              </div>
              <p className="gp-hint gp-num">
                {ar
                  ? `الإجمالي: ${fmtNum(quiz.correct)} صحيحة من ${fmtNum(quiz.answered)} — ${fmtNum(pctOf(quiz.correct, quiz.answered))}%`
                  : `Total: ${fmtNum(quiz.correct)} of ${fmtNum(quiz.answered)}`}
                {quiz.thin && <> <span className="gp-thin">{thinTxt}</span></>}
              </p>
            </>
          )}

          {hard.length > 0 && (
            <>
              <span className="gp-card-t"><Icon name="warning" size={15} /> {ar ? 'أصعب الأسئلة فعلياً' : 'Hardest questions'}</span>
              <div className="gp-qa">
                {hard.slice(0, 5).map((h) => (
                  <div className="gp-qrow is-wrong" key={h.key}>
                    <span className="gp-qmark is-wrong"><Icon name="no" size={13} /></span>
                    <div>
                      <div className="gp-qrow-q">{h.q}</div>
                      <div className="gp-qrow-a gp-num">
                        {ar
                          ? `أُخطئ فيه ${fmtNum(h.missed)} من ${fmtNum(h.asked)} محاولة (${fmtNum(Math.round(h.missRate * 100))}%)`
                          : `${fmtNum(h.missed)} of ${fmtNum(h.asked)} wrong`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Archetype spread — labelled honestly. */}
      {archetypes.total > 0 && (
        <div className="gp-card">
          <span className="gp-card-t"><Icon name="user" size={17} /> {ar ? 'توزيع أنماط الشخصية' : 'Archetype spread'}</span>
          <p className="gp-hint">
            {ar
              ? 'هذه النتائج مبنية على إجابات اختيارية تركها الضيف بنفسه داخل لعبة في المنيو. هي وصف ذاتي مفيد للتسويق، وليست تشخيصاً نفسياً ولا مقياساً معتمداً.'
              : 'Self-report answers inside a menu mini-game — useful for marketing, not a psychological assessment.'}
          </p>
          <div className="gp-bars">
            {archetypes.rows.map((r) => (
              <div className="gp-bar" key={r.archetype}>
                <span className="gp-bar-l" title={r.archetype}>{r.archetype}</span>
                <span className="gp-bar-track"><i className="gp-bar-fill" style={{ width: `${Math.round(r.share * 100)}%` }} /></span>
                <span className="gp-bar-v gp-num">{fmtNum(r.count)} <span className="gp-of">({fmtNum(Math.round(r.share * 100))}%)</span></span>
              </div>
            ))}
          </div>
          <span className="gp-of gp-num">
            {ar ? `من ${fmtNum(archetypes.total)} لاعباً وصلوا إلى نتيجة` : `from ${fmtNum(archetypes.total)} players with a result`}
            {archetypes.thin && <> <span className="gp-thin">{thinTxt}</span></>}
          </span>
        </div>
      )}
    </div>
  )
}
