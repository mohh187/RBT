// One player, fully opened: every play, every question they saw, every answer
// they gave, the stage they reached, and the insight result if there is one.
//
// Design rule for this panel: show the raw material, not a verdict. A manager
// reading a guest's actual answers can judge for themselves whether the label
// on top means anything. That is the difference between analytics and fortune
// telling.
import { useState } from 'react'
import Icon from '../Icon.jsx'
import { fmtNum } from '../../lib/format.js'
import { tagLabel } from '../../lib/gameMemory.js'
import { dateTime, playerLabel, shortDevice, maskPhone, tagRule, THIN_ANSWERS } from './engine.jsx'

const secText = (ms, ar) => {
  const s = Math.round(Number(ms || 0) / 1000)
  if (!s) return ar ? 'لم تنتهِ' : 'unfinished'
  return s >= 60 ? `${fmtNum(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}` : `${fmtNum(s)} ${ar ? 'ث' : 's'}`
}

// Traits arrive as arbitrary numbers from whichever insight game produced them.
// They are normalised to 0-100 for the bar ONLY when they look like a 0-1 or
// 0-5 scale; anything else is printed as a bare number rather than being forced
// into a percentage that would imply a precision we do not have.
function traitBar(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  if (n >= 0 && n <= 1) return Math.round(n * 100)
  if (n >= 0 && n <= 5) return Math.round((n / 5) * 100)
  if (n >= 0 && n <= 100) return Math.round(n)
  return null
}

export default function PlayerPanel({ player, ar = true, onBack }) {
  const [openPlay, setOpenPlay] = useState(null)
  if (!player) return null

  const p = player
  const traits = (p.insight && p.insight.traits) ? Object.entries(p.insight.traits) : []
  const catRows = Object.entries((p.knowledge && p.knowledge.byCat) || {})
    .map(([cat, c]) => ({ cat, ...c, accuracy: c.answered > 0 ? c.correct / c.answered : null }))
    .sort((a, b) => b.answered - a.answered)

  return (
    <div className="gp-card gp-panel">
      <div className="gp-panel-head">
        <div className="gp-panel-id">
          <strong>{playerLabel(p, ar)}</strong>
          <span className="gp-num">
            {p.customerPhone ? maskPhone(p.customerPhone) : (ar ? 'بلا رقم جوال — لا يمكن مراسلته' : 'no phone — unreachable')}
            {' · '}{ar ? 'الجهاز' : 'device'} {shortDevice(p.deviceId)}
          </span>
          <span className="gp-num">
            {ar ? 'أول لعبة' : 'first'} {dateTime(p.firstAt)} · {ar ? 'آخر لعبة' : 'last'} {dateTime(p.lastAt)}
          </span>
        </div>
        {onBack && (
          <button type="button" className="btn btn-sm btn-outline" onClick={onBack}>
            <Icon name="back" size={15} /> {ar ? 'رجوع للقائمة' : 'Back'}
          </button>
        )}
      </div>

      <div className="gp-kpis">
        <div className="gp-kpi">
          <span className="gp-kpi-l">{ar ? 'محاولات' : 'Plays'}</span>
          <span className="gp-kpi-v gp-num">{fmtNum(p.totalPlays)}</span>
          <span className="gp-kpi-s gp-num">{ar ? `أنهى ${fmtNum(p.completedPlays)}` : `${fmtNum(p.completedPlays)} completed`}</span>
        </div>
        <div className="gp-kpi">
          <span className="gp-kpi-l">{ar ? 'ألعاب مختلفة' : 'Games tried'}</span>
          <span className="gp-kpi-v gp-num">{fmtNum(p.gamesTried)}</span>
        </div>
        <div className="gp-kpi">
          <span className="gp-kpi-l">{ar ? 'أعلى نتيجة' : 'Best score'}</span>
          <span className="gp-kpi-v gp-num">{fmtNum(p.bestScore)}</span>
          <span className="gp-kpi-s gp-num">{ar ? `مجموع ${fmtNum(p.totalScore)}` : `total ${fmtNum(p.totalScore)}`}</span>
        </div>
        <div className="gp-kpi">
          <span className="gp-kpi-l">{ar ? 'دقة الإجابات' : 'Accuracy'}</span>
          <span className="gp-kpi-v gp-num">{p.accuracy == null ? '—' : `${fmtNum(Math.round(p.accuracy * 100))}%`}</span>
          <span className="gp-kpi-s gp-num">
            {ar ? `من ${fmtNum((p.knowledge && p.knowledge.answered) || 0)} سؤالاً` : `of ${fmtNum((p.knowledge && p.knowledge.answered) || 0)}`}
          </span>
          {(p.knowledge && p.knowledge.answered) < THIN_ANSWERS && (
            <span className="gp-thin">{ar ? 'عينة صغيرة' : 'thin sample'}</span>
          )}
        </div>
      </div>

      {(p.tags || []).length > 0 && (
        <div>
          <span className="gp-card-t"><Icon name="layers" size={16} /> {ar ? 'الوسوم وقاعدة كل وسم' : 'Tags and their rules'}</span>
          <div className="gp-tags" style={{ marginTop: 8 }}>
            {p.tags.map((t) => (
              <span
                className={`gp-tag${t === 'anonymous' ? ' is-anon' : ''}${t === 'identified' ? ' is-id' : ''}`}
                key={t} title={tagRule(t, ar)}
              >{tagLabel(t, ar)}</span>
            ))}
          </div>
          <p className="gp-hint" style={{ marginTop: 6 }}>
            {ar
              ? 'كل وسم هنا قاعدة رقمية ثابتة على عدّادات حقيقية، لا تخمين ولا ذكاء اصطناعي. مرّر المؤشر فوق أي وسم لترى قاعدته حرفياً.'
              : 'Every tag is a fixed threshold on a real counter. Hover to read the exact rule.'}
          </p>
        </div>
      )}

      {/* Insight result — carried verbatim, framed honestly. */}
      {p.insight && p.insight.archetype && (
        <div className="gp-result">
          <strong>{ar ? 'نتيجة اختبار الشخصية: ' : 'Archetype: '}{p.insight.archetype}</strong>
          {p.insight.summary && <p>{p.insight.summary}</p>}
          {traits.length > 0 && (
            <div className="gp-traits" style={{ marginTop: 4 }}>
              {traits.map(([k, v]) => {
                const w = traitBar(v)
                return (
                  <div className="gp-trait" key={k}>
                    <span className="gp-trait-l">{k}</span>
                    <span className="gp-trait-track">{w != null && <i className="gp-trait-fill" style={{ width: `${w}%` }} />}</span>
                    <span className="gp-num">{w != null ? `${fmtNum(w)}%` : fmtNum(v)}</span>
                  </div>
                )
              })}
            </div>
          )}
          <p className="gp-hint">
            {ar
              ? 'هذه النتيجة مبنية على إجابات اختارها الضيف بنفسه داخل لعبة في المنيو. تصلح لفهم تفضيلاته وللتسويق، ولا تصلح كتشخيص نفسي ولا كحكم على شخصه.'
              : 'Built from the guest\'s own answers in a menu mini-game. Useful for preference marketing, not a psychological assessment.'}
          </p>
        </div>
      )}

      {/* Per-category knowledge */}
      {catRows.length > 0 && (
        <div>
          <span className="gp-card-t"><Icon name="notepad" size={16} /> {ar ? 'المعرفة حسب التصنيف' : 'Knowledge by category'}</span>
          <div className="gp-bars" style={{ marginTop: 8 }}>
            {catRows.map((c) => {
              const pc = Math.round((c.accuracy || 0) * 100)
              return (
                <div className="gp-bar" key={c.cat}>
                  <span className="gp-bar-l" title={c.cat}>{c.cat}</span>
                  <span className="gp-bar-track">
                    <i className={`gp-bar-fill ${pc >= 70 ? 'is-good' : (pc <= 40 ? 'is-bad' : '')}`} style={{ width: `${pc}%` }} />
                  </span>
                  <span className="gp-bar-v gp-num">
                    {fmtNum(c.correct)}/{fmtNum(c.answered)}
                    {c.answered < THIN_ANSWERS && <> <span className="gp-thin">{ar ? 'قليل' : 'thin'}</span></>}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Per-game bests */}
      {Object.keys(p.byGame || {}).length > 0 && (
        <div className="gp-tablewrap">
          <table className="gp-table">
            <thead>
              <tr>
                <th>{ar ? 'اللعبة' : 'Game'}</th>
                <th>{ar ? 'محاولات' : 'Plays'}</th>
                <th>{ar ? 'أفضل نتيجة' : 'Best'}</th>
                <th>{ar ? 'أبعد مرحلة' : 'Stage'}</th>
                <th>{ar ? 'آخر لعب' : 'Last'}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(p.byGame).map(([gid, g]) => (
                <tr key={gid} style={{ cursor: 'default' }}>
                  <td>{g.gameAr || gid}</td>
                  <td className="gp-num">{fmtNum(g.plays)}</td>
                  <td className="gp-num">{fmtNum(g.best)}</td>
                  <td className="gp-num">{fmtNum(g.stage)}</td>
                  <td className="gp-num">{dateTime(g.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Every play, expandable to its questions and answers. */}
      <div>
        <span className="gp-card-t"><Icon name="clock" size={16} /> {ar ? 'كل محاولة بأسئلتها وإجاباتها' : 'Every play, with questions and answers'}</span>
        {p.outsideWindow && (
          <div className="gp-warn" style={{ marginTop: 8 }}>
            <Icon name="warning" size={15} />
            <span>{ar
              ? 'هذا اللاعب له ملف مجمّع لكن لا توجد له محاولات داخل الفترة المختارة. الأرقام أعلاه من ملفه التراكمي — وسّع الفترة لرؤية تفاصيل محاولاته.'
              : 'Profile exists but no plays inside the selected period.'}</span>
          </div>
        )}
        {!p.plays.length ? (
          <p className="gp-hint">{ar ? 'لا محاولات مسجّلة داخل الفترة المختارة.' : 'No plays inside the selected period.'}</p>
        ) : (
          <div className="gp-plays" style={{ marginTop: 8 }}>
            {p.plays.map((x) => {
              const open = openPlay === x.playId
              const answers = x.answers || []
              return (
                <div className="gp-play" key={x.playId}>
                  <button
                    type="button" className="gp-play-head" aria-expanded={open}
                    onClick={() => setOpenPlay(open ? null : x.playId)}
                  >
                    <Icon name={open ? 'arrowUpDown' : 'next'} size={13} />
                    <span className="gp-play-name">{x.gameAr || x.gameId}</span>
                    <span className="gp-play-meta gp-num">
                      <span>{dateTime(x.startedAt)}</span>
                      <span>{ar ? 'النتيجة' : 'score'} {fmtNum(x.score)}</span>
                      <span>{ar ? 'المرحلة' : 'stage'} {fmtNum(x.stage)}</span>
                      <span>{secText(x.durationMs, ar)}</span>
                      <span>{x.completed ? (ar ? 'أُنهيت' : 'completed') : (ar ? 'لم تُنهَ' : 'abandoned')}</span>
                      {answers.length > 0 && <span>{fmtNum(answers.length)} {ar ? 'إجابة' : 'answers'}</span>}
                    </span>
                  </button>
                  {open && (
                    <div className="gp-play-body">
                      {x.result && x.result.archetype && (
                        <div className="gp-result">
                          <strong>{ar ? 'النتيجة: ' : 'Result: '}{x.result.archetype}</strong>
                          {x.result.summary && <p>{x.result.summary}</p>}
                        </div>
                      )}
                      {!answers.length ? (
                        <p className="gp-hint">
                          {ar
                            ? 'لعبة بلا أسئلة (لعبة مهارة أو سرعة)، فلا توجد إجابات تُعرض — النتيجة والمرحلة أعلاه هما كل ما سجّلته.'
                            : 'A skill game with no questions — score and stage above are the whole record.'}
                        </p>
                      ) : (
                        <div className="gp-qa">
                          {answers.map((a, i) => {
                            const state = a.correct === true ? 'right' : (a.correct === false ? 'wrong' : 'open')
                            return (
                              <div className={`gp-qrow is-${state}`} key={`${x.playId}-${a.qId || i}`}>
                                <span className={`gp-qmark is-${state}`}>
                                  <Icon name={state === 'right' ? 'ok' : (state === 'wrong' ? 'no' : 'notepad')} size={13} />
                                </span>
                                <div>
                                  <div className="gp-qrow-q">{a.q || (ar ? 'سؤال بلا نص محفوظ' : 'question text not stored')}</div>
                                  <div className="gp-qrow-a">
                                    {ar ? 'اختار: ' : 'chose: '}<b>{a.choice || (ar ? 'لا شيء' : 'none')}</b>
                                    {a.cat ? ` · ${a.cat}` : ''}
                                    {state === 'open' && (ar ? ' · سؤال تفضيلي، لا إجابة صحيحة له' : ' · preference item, no right answer')}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {x.resumeState && (
                        <p className="gp-hint">
                          {ar ? 'لهذه المحاولة نقطة استئناف محفوظة — يستطيع الضيف إكمالها من حيث توقّف.' : 'A resume point is stored for this play.'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
