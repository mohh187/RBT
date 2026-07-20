// «مرآة الشخصية» — a twelve-question adaptive profile.
//
// Adaptive in two real senses (both implemented in insightEngine.js, not faked
// here): questions are GATED on the profile built so far (`when`), and among
// the eligible ones the next asked is the one carrying the most information
// about the traits we are least sure of. Selection is deterministic, so a
// resumed session continues on exactly the question the guest left.
//
// HONESTY: items are situational-judgement questions grounded in the Big Five
// plus the decision-style and novelty axes. Nothing here is divinatory, and
// the reveal shows a confidence signal per axis rather than pretending every
// number is equally earned.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import '../../styles/insight.css'
import {
  INSIGHT_DISCLAIMER_AR,
  INSIGHT_DISCLAIMER_EN,
  MIND_MIRROR_LENGTH,
  TRAITS,
  answersToLoadings,
  arNum,
  archetypeCopy,
  mindMirrorNext,
  recommendItems,
  scoreProfile,
  traitById,
} from '../../lib/insightEngine.js'
import { lex } from '../../lib/venueTypes.js'

const PER_Q = 15
const FINISH_BONUS = 40
const STATE_V = 1

const TXT = {
  ar: {
    title: 'مرآة الشخصية',
    how: 'اثنا عشر موقفاً واقعياً. اختر ما تفعله فعلاً لا ما يُفترض أن تفعله — النتيجة تتغيّر مع إجاباتك، والأسئلة نفسها تتغيّر.',
    start: 'ابدأ',
    resume: 'أكمل من حيث توقفت',
    restart: 'من البداية',
    step: (a, b) => `${arNum(a)} من ${arNum(b)}`,
    yourType: 'نمطك',
    fit: (n) => `تطابق ${arNum(n)}%`,
    alt: (n) => `وفيك لمسة من «${n}»`,
    portrait: 'الصورة',
    strengths: 'ما تجيده',
    blind: 'النقطة العمياء',
    order: 'كيف تطلب',
    checks: 'ثلاثة أشياء تحقّق منها بنفسك',
    checksNote: 'هذه ميول شائعة لمن يشبه نتيجتك، لا حقائق مؤكدة عنك. اقرأها واحكم بنفسك.',
    bars: 'محاورك السبعة',
    conf: (n) => `دقة القياس ${arNum(n)}%`,
    lowConf: 'إشارة ضعيفة',
    recs: 'يناسبك من القائمة',
    again: 'أعد التجربة',
    done: 'إنهاء',
    share: 'انسخ النتيجة',
    shared: 'تم النسخ',
    cardLine: 'نتيجتي في مرآة الشخصية',
    building: 'نحسب النتيجة',
  },
  en: {
    title: 'Mind Mirror',
    how: 'Twelve real situations. Pick what you actually do, not what you should do — the questions adapt as you answer.',
    start: 'Start',
    resume: 'Resume',
    restart: 'Start over',
    step: (a, b) => `${a} of ${b}`,
    yourType: 'Your type',
    fit: (n) => `${n}% match`,
    alt: (n) => `with a touch of "${n}"`,
    portrait: 'Portrait',
    strengths: 'Strengths',
    blind: 'Blind spot',
    order: 'How you order',
    checks: 'Three things to check for yourself',
    checksNote: 'These are common tendencies for profiles like yours, not certainties about you.',
    bars: 'Your seven axes',
    conf: (n) => `measurement confidence ${n}%`,
    lowConf: 'weak signal',
    recs: 'Suits you here',
    again: 'Play again',
    done: 'Finish',
    share: 'Copy result',
    shared: 'Copied',
    cardLine: 'My Mind Mirror result',
    building: 'Scoring',
  },
}

export default function MindMirror({
  onScore,
  onExit,
  lang = 'ar',
  brand = '#0e7490',
  items = [],
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

  const saved = resumeState && resumeState.v === STATE_V && resumeState.game === 'mindMirror'
    ? resumeState
    : null

  const [phase, setPhase] = useState(saved?.answers?.length ? 'gate' : 'intro')
  const [answers, setAnswers] = useState(() => (Array.isArray(saved?.answers) ? saved.answers : []))
  const [flash, setFlash] = useState(null) // the option key just tapped
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(0)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const question = useMemo(() => mindMirrorNext(answers), [answers])
  const doneCount = answers.length
  const finished = phase === 'reveal' || (phase === 'play' && !question)

  const profile = useMemo(
    () => scoreProfile(answersToLoadings(answers), { source: 'mindMirror' }),
    [answers],
  )

  useEffect(() => {
    onScoreRef.current?.(doneCount * PER_Q + (finished ? FINISH_BONUS : 0))
  }, [doneCount, finished])

  const persist = (next, stage) => {
    onProgRef.current?.({ v: STATE_V, game: 'mindMirror', stage, answers: next, at: Date.now() })
  }

  const begin = (fresh) => {
    clearTimeout(timerRef.current)
    if (fresh) { setAnswers([]); persist([], 'play') }
    setPhase('play')
  }

  const answer = (key) => {
    if (!question || flash) return
    setFlash(key)
    timerRef.current = setTimeout(() => {
      const next = [...answers, { id: question.id, key }]
      setAnswers(next)
      setFlash(null)
      const last = next.length >= MIND_MIRROR_LENGTH || !mindMirrorNext(next)
      persist(next, last ? 'reveal' : 'play')
      if (last) setPhase('reveal')
    }, 240)
  }

  const arch = useMemo(() => archetypeCopy(profile.archetype, tenant), [profile.archetype, tenant])
  const alt = useMemo(() => archetypeCopy(profile.alt, tenant), [profile.alt, tenant])

  const recs = useMemo(
    () => (finished ? recommendItems(profile, items, tenant, { limit: 3, lang }) : []),
    [finished, profile, items, tenant, lang],
  )

  const doShare = async () => {
    const top = profile.topTraits.slice(0, 3)
      .map((x) => (x.dir === 'high' ? traitById(x.id)?.high : traitById(x.id)?.low))
      .join(' | ')
    const text = `${t.cardLine}: ${arch?.ar || ''}\n${top}\n${tenant?.name || ''}`.trim()
    try {
      if (navigator.share) { await navigator.share({ text }); return }
      await navigator.clipboard.writeText(text)
      setCopied(true)
      timerRef.current = setTimeout(() => setCopied(false), 1800)
    } catch { /* dismissed — nothing to report */ }
  }

  const pct = Math.min(100, Math.round((doneCount / MIND_MIRROR_LENGTH) * 100))

  return (
    <div className="ins-root">
      {(phase === 'play' || finished) && (
        <div className="ins-top">
          <span className="ins-prog"><i style={{ width: `${finished ? 100 : pct}%`, background: brand }} /></span>
          <span className="ins-step">
            {t.step(Math.min(doneCount + (finished ? 0 : 1), MIND_MIRROR_LENGTH), MIND_MIRROR_LENGTH)}
          </span>
        </div>
      )}

      {(phase === 'intro' || phase === 'gate') && (
        <div className="ins-scroll">
          <div className="ins-pad ins-fade" style={{ minHeight: '100%', justifyContent: 'center' }}>
            {phase === 'gate'
              ? <span className="ins-resume"><Icon name="clock" size={13} /> {t.step(doneCount, MIND_MIRROR_LENGTH)}</span>
              : <span className="ins-kicker"><Icon name="sparkles" size={13} /> {ar ? 'بصيرة' : 'Insight'}</span>}
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

      {phase === 'play' && question && (
        <div className="ins-scroll">
          <div className="ins-pad" style={{ minHeight: '100%', justifyContent: 'center' }}>
            <div className="ins-fade" key={question.id} style={{ display: 'grid', gap: 14, justifyItems: 'center', width: '100%' }}>
              <p className="ins-q">{question.text}</p>
              <div className="ins-opts">
                {question.options.map((o) => {
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
                      <span style={{ color: '#fff' }}>{o.label}</span>
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
                <span className="ins-seal" style={{ background: brand }}><Icon name="award" size={24} /></span>
                <span className="ins-kicker">{t.yourType}</span>
                <h2 className="ins-arch">{arch?.ar}</h2>
                <span className="ins-fit">{t.fit(Math.round((profile.archetypeFit || 0) * 100))}</span>
                {alt && alt.id !== arch?.id && <span className="ins-fit">{t.alt(alt.ar)}</span>}
              </div>

              <section className="ins-sec" style={{ color: brand }}>
                <h3 className="ins-sec-h"><Icon name="user" size={14} /> {t.portrait}</h3>
                <p className="ins-body">{arch?.portrait}</p>
              </section>

              <section className="ins-sec" style={{ color: brand }}>
                <h3 className="ins-sec-h"><Icon name="star" size={14} /> {t.strengths}</h3>
                <ul className="ins-list">
                  {(arch?.strengths || []).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </section>

              <section className="ins-sec" style={{ color: brand }}>
                <h3 className="ins-sec-h"><Icon name="eye" size={14} /> {t.blind}</h3>
                <p className="ins-body">{arch?.blindSpot}</p>
              </section>

              <section className="ins-sec" style={{ color: brand }}>
                <h3 className="ins-sec-h"><Icon name="orders" size={14} /> {t.order}</h3>
                <p className="ins-body">{arch?.venue}</p>
              </section>

              <section className="ins-sec" style={{ color: brand }}>
                <h3 className="ins-sec-h"><Icon name="check" size={14} /> {t.checks}</h3>
                <ol className="ins-preds">
                  {(arch?.predictions || []).map((p, i) => (
                    <li className="ins-pred" key={i}>
                      <span className="ins-pred-n" style={{ background: brand }}>{arNum(i + 1)}</span>
                      {p}
                    </li>
                  ))}
                </ol>
                <p className="ins-disc" style={{ textAlign: 'start', marginTop: 10 }}>{t.checksNote}</p>
              </section>

              <section className="ins-sec" style={{ color: brand }}>
                <h3 className="ins-sec-h">
                  <Icon name="chartBar" size={14} /> {t.bars}
                  <span style={{ marginInlineStart: 'auto', fontWeight: 700, opacity: 0.75 }}>
                    {t.conf(Math.round((profile.confidence || 0) * 100))}
                  </span>
                </h3>
                <div className="ins-bars">
                  {TRAITS.map((tr) => {
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

              {recs.length > 0 && (
                <section className="ins-sec" style={{ color: brand }}>
                  <h3 className="ins-sec-h"><Icon name="heart" size={14} /> {t.recs} — {lex(tenant, 'menu')}</h3>
                  <div className="ins-recs">
                    {recs.map((r) => (
                      <div className="ins-rec" key={String(r.item.id)}>
                        <span className="ins-rec-media">
                          {r.item.imageUrl
                            ? <img src={r.item.imageUrl} alt="" loading="lazy" />
                            : <Icon name="coffee" size={20} />}
                        </span>
                        <span className="ins-rec-body">
                          <span className="ins-rec-nm">{r.name}</span>
                          <span className="ins-rec-why">{r.reason}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div className="ins-cardish" style={{ color: brand }}>
                {playerName ? <span className="ins-who">{playerName}</span> : null}
                <strong className="ins-arch" style={{ fontSize: 20 }}>{arch?.ar}</strong>
                <div className="ins-chips">
                  {profile.topTraits.slice(0, 3).map((x) => (
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
