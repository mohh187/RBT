// «كيف تقرر؟» — decision-making style through eight short scenarios.
//
// Grounded in the dual-process view of decision making (fast/intuitive vs
// deliberate/analytic) plus the Big Five traits that actually move decisions:
// conscientiousness (planning), emotional stability (tolerating uncertainty),
// agreeableness (consulting others) and the novelty axis (risk/variety).
//
// HONESTY: the reveal names a STYLE, never a verdict. Every style is presented
// with real strengths and a genuine cost, because no decision style is best in
// all situations — that is the actual finding in the literature.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import '../../styles/insight.css'
import {
  DECISION_SCENARIOS,
  INSIGHT_DISCLAIMER_AR,
  INSIGHT_DISCLAIMER_EN,
  TRAITS,
  arNum,
  decisionAnswersToLoadings,
  decisionStyle,
  fillLex,
  scoreProfile,
  traitById,
} from '../../lib/insightEngine.js'

const PER_Q = 14
const FINISH_BONUS = 30
const STATE_V = 1
// The axes a decision profile can actually speak to. The other three are
// measured too, but showing them here would over-claim from eight items.
const SHOWN = ['analysis', 'conscientiousness', 'novelty', 'stability']

const TXT = {
  ar: {
    title: 'كيف تقرر؟',
    how: 'ثمانية مواقف قصيرة. اختر ما تفعله فعلاً — لا يوجد أسلوب قرار «صحيح»، لكل أسلوب موضع يتفوق فيه وموضع يكلّفك.',
    start: 'ابدأ',
    resume: 'أكمل من حيث توقفت',
    restart: 'من البداية',
    step: (a, b) => `${arNum(a)} من ${arNum(b)}`,
    style: 'أسلوبك في القرار',
    strengths: 'أين يتفوق أسلوبك',
    watch: 'وأين يكلّفك',
    takeaway: 'خذها معك',
    axes: 'محاور القرار',
    lowConf: 'إشارة ضعيفة',
    again: 'أعد التجربة',
    done: 'إنهاء',
    share: 'انسخ النتيجة',
    shared: 'تم النسخ',
    cardLine: 'أسلوبي في اتخاذ القرار',
  },
  en: {
    title: 'How You Decide',
    how: 'Eight short scenarios. Pick what you actually do — no decision style is the right one; each wins somewhere and costs somewhere.',
    start: 'Start',
    resume: 'Resume',
    restart: 'Start over',
    step: (a, b) => `${a} of ${b}`,
    style: 'Your decision style',
    strengths: 'Where it wins',
    watch: 'Where it costs you',
    takeaway: 'Take this with you',
    axes: 'Decision axes',
    lowConf: 'weak signal',
    again: 'Play again',
    done: 'Finish',
    share: 'Copy result',
    shared: 'Copied',
    cardLine: 'My decision style',
  },
}

export default function DecisionStyle({
  onScore,
  onExit,
  lang = 'ar',
  brand = '#0e7490',
  playerName = '',
  tenant = null,
  onProgress,
  resumeState,
}) {
  const ar = lang !== 'en'
  const t = ar ? TXT.ar : TXT.en
  const onScoreRef = useRef(onScore)
  const onProgRef = useRef(onProgress)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgRef.current = onProgress }, [onProgress])

  const saved = resumeState && resumeState.v === STATE_V && resumeState.game === 'decisionStyle'
    ? resumeState
    : null

  const [phase, setPhase] = useState(saved?.answers?.length ? 'gate' : 'intro')
  const [answers, setAnswers] = useState(() => (Array.isArray(saved?.answers) ? saved.answers : []))
  const [flash, setFlash] = useState(null)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(0)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const total = DECISION_SCENARIOS.length
  const answeredIds = useMemo(() => new Set(answers.map((a) => a.id)), [answers])
  const current = useMemo(
    () => DECISION_SCENARIOS.find((s) => !answeredIds.has(s.id)) || null,
    [answeredIds],
  )
  const doneCount = answers.length
  const finished = phase === 'reveal' || (phase === 'play' && !current)

  const profile = useMemo(
    () => scoreProfile(decisionAnswersToLoadings(answers), { source: 'decisionStyle' }),
    [answers],
  )
  const style = useMemo(() => decisionStyle(profile), [profile])

  useEffect(() => {
    onScoreRef.current?.(doneCount * PER_Q + (finished ? FINISH_BONUS : 0))
  }, [doneCount, finished])

  const persist = (next, stage) => {
    onProgRef.current?.({ v: STATE_V, game: 'decisionStyle', stage, answers: next, at: Date.now() })
  }

  const begin = (fresh) => {
    clearTimeout(timerRef.current)
    if (fresh) { setAnswers([]); persist([], 'play') }
    setPhase('play')
  }

  const answer = (key) => {
    if (!current || flash) return
    setFlash(key)
    timerRef.current = setTimeout(() => {
      const next = [...answers, { id: current.id, key }]
      setAnswers(next)
      setFlash(null)
      const last = next.length >= total
      persist(next, last ? 'reveal' : 'play')
      if (last) setPhase('reveal')
    }, 240)
  }

  const doShare = async () => {
    const text = `${t.cardLine}: ${style?.ar || ''}\n${style?.takeaway || ''}\n${tenant?.name || ''}`.trim()
    try {
      if (navigator.share) { await navigator.share({ text }); return }
      await navigator.clipboard.writeText(text)
      setCopied(true)
      timerRef.current = setTimeout(() => setCopied(false), 1800)
    } catch { /* dismissed — nothing to report */ }
  }

  const pct = Math.min(100, Math.round((doneCount / total) * 100))

  return (
    <div className="ins-root">
      {(phase === 'play' || finished) && (
        <div className="ins-top">
          <span className="ins-prog"><i style={{ width: `${finished ? 100 : pct}%`, background: brand }} /></span>
          <span className="ins-step">{t.step(Math.min(doneCount + (finished ? 0 : 1), total), total)}</span>
        </div>
      )}

      {(phase === 'intro' || phase === 'gate') && (
        <div className="ins-scroll">
          <div className="ins-pad ins-fade" style={{ minHeight: '100%', justifyContent: 'center' }}>
            {phase === 'gate'
              ? <span className="ins-resume"><Icon name="clock" size={13} /> {t.step(doneCount, total)}</span>
              : <span className="ins-kicker"><Icon name="arrowLeftRight" size={13} /> {ar ? 'بصيرة' : 'Insight'}</span>}
            <h2 className="ins-title">{t.title}</h2>
            <p className="ins-sub">{t.how}</p>
            <div className="ins-btnrow">
              {phase === 'gate' && (
                <button type="button" className="ins-btn" style={{ background: brand }} onClick={() => begin(false)}>
                  <Icon name="play" size={16} /> {t.resume}
                </button>
              )}
              <button
                type="button"
                className={phase === 'gate' ? 'ins-btn ghost' : 'ins-btn'}
                style={phase === 'gate' ? undefined : { background: brand }}
                onClick={() => begin(true)}
              >
                <Icon name={phase === 'gate' ? 'reload' : 'play'} size={15} />
                {phase === 'gate' ? t.restart : t.start}
              </button>
            </div>
            <p className="ins-disc">{ar ? INSIGHT_DISCLAIMER_AR : INSIGHT_DISCLAIMER_EN}</p>
          </div>
        </div>
      )}

      {phase === 'play' && current && (
        <div className="ins-scroll">
          <div className="ins-pad" style={{ minHeight: '100%', justifyContent: 'center' }}>
            <div className="ins-fade" key={current.id} style={{ display: 'grid', gap: 14, justifyItems: 'center', width: '100%' }}>
              <p className="ins-q">{fillLex(current.text, tenant)}</p>
              <div className="ins-opts">
                {current.options.map((o) => {
                  const cls = flash ? (flash === o.key ? ' picked' : ' faded') : ''
                  return (
                    <button
                      key={o.key}
                      type="button"
                      className={`ins-opt${cls}`}
                      style={{ color: brand }}
                      disabled={!!flash}
                      onClick={() => answer(o.key)}
                    >
                      <span style={{ color: '#fff' }}>{fillLex(o.label, tenant)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {finished && (
        <div className="ins-scroll">
          <div className="ins-pad">
            <div className="ins-reveal ins-rise">
              <div className="ins-crown">
                <span className="ins-seal" style={{ background: brand }}><Icon name="arrowLeftRight" size={24} /></span>
                <span className="ins-kicker">{t.style}</span>
                <h2 className="ins-arch">{style?.ar}</h2>
                <p className="ins-portrait">{style?.portrait}</p>
              </div>

              <section className="ins-sec" style={{ color: brand }}>
                <h3 className="ins-sec-h"><Icon name="star" size={14} /> {t.strengths}</h3>
                <ul className="ins-list">
                  {(style?.strengths || []).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </section>

              <section className="ins-sec" style={{ color: brand }}>
                <h3 className="ins-sec-h"><Icon name="warning" size={14} /> {t.watch}</h3>
                <p className="ins-body">{style?.watchOut}</p>
              </section>

              <section className="ins-sec" style={{ color: brand, borderColor: brand }}>
                <h3 className="ins-sec-h"><Icon name="key" size={14} /> {t.takeaway}</h3>
                <p className="ins-body" style={{ fontWeight: 700 }}>{style?.takeaway}</p>
              </section>

              <section className="ins-sec" style={{ color: brand }}>
                <h3 className="ins-sec-h"><Icon name="chartBar" size={14} /> {t.axes}</h3>
                <div className="ins-bars">
                  {TRAITS.filter((tr) => SHOWN.includes(tr.id)).map((tr) => {
                    const v = profile.traits[tr.id] ?? 0.5
                    const conf = profile.traitConfidence[tr.id] ?? 0
                    const left = Math.min(v, 0.5) * 100
                    const w = Math.abs(v - 0.5) * 100
                    return (
                      <div className={`ins-bar${conf < 0.3 ? ' low-conf' : ''}`} key={tr.id}>
                        <div className="ins-bar-top">
                          <span className="ins-bar-nm">{ar ? tr.ar : tr.en}</span>
                          <span className="ins-bar-val">
                            {conf < 0.3 ? t.lowConf : `${arNum(Math.round(v * 100))}%`}
                          </span>
                        </div>
                        <div className="ins-bar-track">
                          <span
                            className="ins-bar-fill"
                            style={{ insetInlineStart: `${left}%`, width: `${Math.max(1.5, w)}%`, background: brand }}
                          />
                        </div>
                        <div className="ins-bar-poles">
                          <span>{tr.low}</span>
                          <span>{tr.high}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              <div className="ins-cardish" style={{ color: brand }}>
                {playerName ? <span className="ins-who">{playerName}</span> : null}
                <strong className="ins-arch" style={{ fontSize: 20 }}>{style?.ar}</strong>
                <div className="ins-chips">
                  {profile.topTraits
                    .filter((x) => SHOWN.includes(x.id))
                    .slice(0, 3)
                    .map((x) => (
                      <span className="ins-chip" key={x.id}>
                        {x.dir === 'high' ? traitById(x.id)?.high : traitById(x.id)?.low}
                      </span>
                    ))}
                </div>
                <span className="ins-line">{tenant?.name || ''}</span>
                <div className="ins-btnrow">
                  <button type="button" className="ins-btn ghost" onClick={doShare}>
                    <Icon name={copied ? 'check' : 'share'} size={15} /> {copied ? t.shared : t.share}
                  </button>
                </div>
              </div>

              <p className="ins-disc">{ar ? INSIGHT_DISCLAIMER_AR : INSIGHT_DISCLAIMER_EN}</p>

              <div className="ins-btnrow">
                <button type="button" className="ins-btn" style={{ background: brand }} onClick={() => begin(true)}>
                  <Icon name="repeat" size={15} /> {t.again}
                </button>
                {onExit && (
                  <button type="button" className="ins-btn ghost" onClick={onExit}>
                    <Icon name="ok" size={15} /> {t.done}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
