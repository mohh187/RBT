// «ذوقك يحكي عنك» — a taste-based personality read built from the venue's REAL
// menu, presented as a series of either/or choices.
//
// HONESTY: every round is two ACTUAL items from this venue. Nothing is
// invented, and the trait mapping is the auditable one in insightEngine.js —
// correlational tendencies from preference psychology, never claims of fact.
// If the menu is too thin to build honest contrasting pairs, the game says so
// instead of faking rounds.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import '../../styles/insight.css'
import {
  INSIGHT_DISCLAIMER_AR,
  INSIGHT_DISCLAIMER_EN,
  TRAITS,
  MIN_TASTE_ITEMS,
  arNum,
  archetypeCopy,
  buildTastePairs,
  itemName,
  recommendItems,
  scoreProfile,
  traitById,
} from '../../lib/insightEngine.js'
import { lex } from '../../lib/venueTypes.js'

const ROUNDS = 9
const PER_ROUND = 12
const FINISH_BONUS = 25
const STATE_V = 1

const TXT = {
  ar: {
    title: 'ذوقك يحكي عنك',
    how: (items) => `اختيار واحد في كل جولة من ${items} الحقيقية هنا. لا توجد إجابة صحيحة — نحن نقرأ الميل لا المعرفة.`,
    start: 'ابدأ',
    resume: 'أكمل من حيث توقفت',
    restart: 'من البداية',
    pick: 'أيّهما تختار الآن؟',
    or: 'أو',
    step: (a, b) => `${arNum(a)} من ${arNum(b)}`,
    reading: 'قراءة النتيجة',
    yourType: 'نمطك',
    fit: (n) => `تطابق ${arNum(n)}%`,
    strengths: 'ما تجيده',
    blind: 'النقطة العمياء',
    inPlace: 'أنت هنا',
    checks: 'ثلاثة أشياء تحقّق منها بنفسك',
    bars: 'محاور شخصيتك',
    recs: 'مبني على اختياراتك',
    lowConf: 'إشارة ضعيفة',
    again: 'أعد التجربة',
    done: 'إنهاء',
    share: 'انسخ النتيجة',
    shared: 'تم النسخ',
    thinTitle: 'القائمة غير كافية',
    thin: (items, n) => `تحتاج هذه التجربة إلى ${items} أكثر تنوعاً: على الأقل ${arNum(n)} أصناف مختلفة الطابع حتى تكون المقارنة ذات معنى. لن نبني نتيجة على بيانات لا تكفي.`,
    cardLine: 'نتيجتي في اختبار الذوق',
  },
  en: {
    title: 'Your Taste, Read',
    how: () => 'One pick per round, from this venue\'s real menu. There is no right answer — we read leaning, not knowledge.',
    start: 'Start',
    resume: 'Resume',
    restart: 'Start over',
    pick: 'Which one, right now?',
    or: 'or',
    step: (a, b) => `${a} of ${b}`,
    reading: 'Your reading',
    yourType: 'Your type',
    fit: (n) => `${n}% match`,
    strengths: 'Strengths',
    blind: 'Blind spot',
    inPlace: 'Here',
    checks: 'Three things to check for yourself',
    bars: 'Your axes',
    recs: 'Based on your picks',
    lowConf: 'weak signal',
    again: 'Play again',
    done: 'Finish',
    share: 'Copy result',
    shared: 'Copied',
    thinTitle: 'Not enough menu data',
    thin: (items, n) => `This needs a more varied menu: at least ${n} items with different character. We will not build a result on insufficient data.`,
    cardLine: 'My taste profile',
  },
}

export default function TasteProfile({
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

  // Deterministic pair building: the same menu always produces the same rounds,
  // which is what makes resume land the player on the exact question they left.
  const pairs = useMemo(() => buildTastePairs(items, ROUNDS), [items])

  const saved = resumeState && resumeState.v === STATE_V && resumeState.game === 'tasteProfile'
    ? resumeState
    : null

  const [phase, setPhase] = useState(saved?.answers?.length ? 'gate' : 'intro')
  const [answers, setAnswers] = useState(() => (Array.isArray(saved?.answers) ? saved.answers : []))
  const [flash, setFlash] = useState(null) // { pairId, side } — the just-tapped card
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(0)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const answeredIds = useMemo(() => new Set(answers.map((a) => a.id)), [answers])
  const queue = useMemo(
    () => (pairs || []).filter((p) => !answeredIds.has(p.id)),
    [pairs, answeredIds],
  )
  const total = pairs ? pairs.length : 0
  const doneCount = answers.length
  const current = queue[0] || null

  const profile = useMemo(
    () => scoreProfile(answers.map((a) => a.l), { source: 'tasteProfile' }),
    [answers],
  )

  const finished = phase === 'reveal' || (phase === 'play' && !current && doneCount > 0)

  // Score is always ABSOLUTE, reported on every change.
  useEffect(() => {
    const s = doneCount * PER_ROUND + (finished ? FINISH_BONUS : 0)
    onScoreRef.current?.(s)
  }, [doneCount, finished])

  // Persist after every answer so the guest can walk away and come back.
  const persist = (nextAnswers, stage) => {
    onProgRef.current?.({
      v: STATE_V,
      game: 'tasteProfile',
      stage,
      answers: nextAnswers,
      at: Date.now(),
    })
  }

  const begin = (fresh) => {
    clearTimeout(timerRef.current)
    if (fresh) {
      setAnswers([])
      persist([], 'play')
    }
    setPhase('play')
  }

  const pick = (side) => {
    if (!current || flash) return
    const opt = side === 'a' ? current.a : current.b
    setFlash({ pairId: current.id, side })
    timerRef.current = setTimeout(() => {
      const next = [...answers, { id: current.id, side, l: opt.loadings }]
      setAnswers(next)
      setFlash(null)
      const last = next.length >= total
      persist(next, last ? 'reveal' : 'play')
      if (last) setPhase('reveal')
    }, 280)
  }

  const recs = useMemo(() => {
    if (!finished) return []
    const skip = []
    for (const a of answers) {
      const p = (pairs || []).find((x) => x.id === a.id)
      if (p) skip.push(String((a.side === 'a' ? p.b.item : p.a.item)?.id || ''))
    }
    return recommendItems(profile, items, tenant, { limit: 3, lang, excludeIds: skip })
  }, [finished, profile, items, tenant, lang, answers, pairs])

  const arch = useMemo(() => archetypeCopy(profile.archetype, tenant), [profile.archetype, tenant])

  const shareText = () => {
    const top = profile.topTraits.slice(0, 2)
      .map((x) => `${traitById(x.id)?.ar}: ${x.dir === 'high' ? traitById(x.id)?.high : traitById(x.id)?.low}`)
      .join(' | ')
    return `${t.cardLine}: ${arch?.ar || ''}\n${top}\n${tenant?.name || ''}`.trim()
  }

  const doShare = async () => {
    const text = shareText()
    try {
      if (navigator.share) { await navigator.share({ text }); return }
      await navigator.clipboard.writeText(text)
      setCopied(true)
      timerRef.current = setTimeout(() => setCopied(false), 1800)
    } catch { /* the guest dismissed the sheet — nothing to report */ }
  }

  // ---- honest refusal on a menu that cannot support real contrasts ----
  if (!pairs) {
    return (
      <div className="ins-root">
        <div className="ins-empty">
          <span className="ins-empty-ico" style={{ background: brand }}><Icon name="menu" size={22} /></span>
          <strong className="ins-title">{t.thinTitle}</strong>
          <p className="ins-sub">{t.thin(lex(tenant, 'items'), MIN_TASTE_ITEMS)}</p>
        </div>
      </div>
    )
  }

  const pct = total ? Math.min(100, Math.round((doneCount / total) * 100)) : 0

  return (
    <div className="ins-root">
      {(phase === 'play' || finished) && (
        <div className="ins-top">
          <span className="ins-prog"><i style={{ width: `${finished ? 100 : pct}%`, background: brand }} /></span>
          <span className="ins-step">{t.step(Math.min(doneCount + (finished ? 0 : 1), total), total)}</span>
        </div>
      )}

      {phase === 'intro' && (
        <div className="ins-scroll">
          <div className="ins-pad ins-fade" style={{ minHeight: '100%', justifyContent: 'center' }}>
            <span className="ins-kicker"><Icon name="sparkles" size={13} /> {ar ? 'بصيرة' : 'Insight'}</span>
            <h2 className="ins-title">{t.title}</h2>
            <p className="ins-sub">{t.how(lex(tenant, 'items'))}</p>
            <button type="button" className="ins-btn" style={{ background: brand }} onClick={() => begin(true)}>
              <Icon name="play" size={16} /> {t.start}
            </button>
            <p className="ins-disc">{ar ? INSIGHT_DISCLAIMER_AR : INSIGHT_DISCLAIMER_EN}</p>
          </div>
        </div>
      )}

      {phase === 'gate' && (
        <div className="ins-scroll">
          <div className="ins-pad ins-fade" style={{ minHeight: '100%', justifyContent: 'center' }}>
            <span className="ins-resume"><Icon name="clock" size={13} /> {t.step(doneCount, total)}</span>
            <h2 className="ins-title">{t.title}</h2>
            <p className="ins-sub">{t.how(lex(tenant, 'items'))}</p>
            <div className="ins-btnrow">
              <button type="button" className="ins-btn" style={{ background: brand }} onClick={() => begin(false)}>
                <Icon name="play" size={16} /> {t.resume}
              </button>
              <button type="button" className="ins-btn ghost" onClick={() => begin(true)}>
                <Icon name="reload" size={15} /> {t.restart}
              </button>
            </div>
            <p className="ins-disc">{ar ? INSIGHT_DISCLAIMER_AR : INSIGHT_DISCLAIMER_EN}</p>
          </div>
        </div>
      )}

      {phase === 'play' && current && (
        <div className="ins-scroll">
          <div className="ins-pad" style={{ minHeight: '100%', justifyContent: 'center' }}>
            <p className="ins-or">{t.pick}</p>
            <div className="ins-duo ins-fade" key={current.id}>
              {['a', 'b'].map((side) => {
                const opt = side === 'a' ? current.a : current.b
                const it = opt.item
                const isFlash = flash && flash.pairId === current.id
                const cls = isFlash ? (flash.side === side ? ' picked' : ' faded') : ''
                const price = Number(it?.price) > 0 ? Number(it.price) : null
                return (
                  <button
                    key={side}
                    type="button"
                    className={`ins-duo-card${cls}`}
                    style={{ color: brand }}
                    disabled={!!flash}
                    onClick={() => pick(side)}
                  >
                    <span className="ins-duo-media">
                      {it?.imageUrl
                        ? <img src={it.imageUrl} alt="" loading="lazy" />
                        : <Icon name="coffee" size={28} />}
                    </span>
                    <span className="ins-duo-name">{itemName(it, lang)}</span>
                    {price != null && <span className="ins-duo-meta">{arNum(price)}</span>}
                  </button>
                )
              })}
            </div>
            <p className="ins-hint">{t.or}</p>
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
                <p className="ins-portrait">{arch?.portrait}</p>
              </div>

              <section className="ins-sec" style={{ color: brand }}>
                <h3 className="ins-sec-h"><Icon name="chartBar" size={14} /> {t.bars}</h3>
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
                <h3 className="ins-sec-h"><Icon name="store" size={14} /> {t.inPlace}</h3>
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
              </section>

              {recs.length > 0 && (
                <section className="ins-sec" style={{ color: brand }}>
                  <h3 className="ins-sec-h"><Icon name="heart" size={14} /> {t.recs}</h3>
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
                          {Number(r.item.price) > 0 && (
                            <span className="ins-rec-price">{arNum(Number(r.item.price))}</span>
                          )}
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
