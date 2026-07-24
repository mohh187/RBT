// «اختبار الذوق» — a quiz generated from the venue's REAL menu.
//
// HONESTY RULE (the whole point of this file): a question is only ever built
// from data that actually exists on the items.
//   • "أي صنف أغلى؟"        — only from items with a real numeric price, and
//                              only when the four picked prices have a single
//                              unambiguous maximum.
//   • "كم سعرة في X؟"       — only when THAT item carries a calories value.
//   • "أي صنف يحتوي على Y؟" — only when the ingredient is listed on one item and
//                              provably absent from the three other choices.
// Nothing about a dish is ever invented. Wrong answers are either other items'
// real values or plainly-derived numbers used as distractors — the asserted
// fact is always the true one. With fewer than six usable items the quiz
// refuses to run and says why instead of fabricating questions.
//
// Premium layer (PACK C): the honest questions are graded by difficulty and
// dealt out as a rising STAGE ladder (rounds of five), with a countdown ring,
// a streak meter, a «50:50» lifeline (removes two wrong answers, computed
// locally — no new data), a stage map, a rich reveal and an end summary.
// Chrome lives in src/styles/quizzes.css.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { play } from '../../lib/gameSounds.js'
import '../../styles/quizzes.css'

export const GAME_ID = 'tasteQuiz'
const SECONDS = 14
const PER_STAGE = 5
const MIN_ITEMS = 6
const LIFELINES = 2

const TXT = {
  ar: {
    title: 'اختبار الذوق',
    how: 'أسئلة عن قائمة المكان نفسها، تُدار على شكل مراحل ترتفع صعوبتها. أجب بسرعة وبتتابع لتضاعف نقاطك.',
    start: 'ابدأ الاختبار',
    again: 'اختبار جديد',
    over: 'اكتمل الاختبار',
    score: 'النتيجة',
    points: 'نقطة',
    right: 'إجابة صحيحة',
    wrong: 'إجابة خاطئة',
    timeout: 'انتهى الوقت',
    next: 'التالي',
    endStage: 'إنهاء المرحلة',
    stage: 'المرحلة',
    of: 'من',
    q: 'سؤال',
    stageDone: 'أُنجزت المرحلة',
    goNext: 'المرحلة التالية',
    correctOf: 'إجابات صحيحة',
    thin: 'يحتاج هذا الاختبار إلى قائمة أكمل: نحتاج ستة أصناف على الأقل تحمل أسعاراً حقيقية حتى نبني أسئلة صادقة. لن نخترع معلومات عن الأصناف.',
    thinTitle: 'القائمة غير كافية',
    qPricey: 'أي صنف أغلى؟',
    qCheap: 'أي صنف أقل سعراً؟',
    qCal: (n) => `كم سعرة حرارية في ${n}؟`,
    qIng: (n) => `أي صنف يحتوي على ${n}؟`,
    cal: 'سعرة',
    fifty: '50:50',
    fiftyLeft: (n) => `50:50 (${n})`,
    removed: 'أُزيلت إجابتان خاطئتان.',
    resumeAt: (s) => `أفضل مرحلة وصلتها سابقاً: ${s}`,
    accuracy: 'الدقة',
    bestStreak: 'أطول تتابع',
    stageReached: 'المراحل',
    stMeter: ['متتالية', 'ملتهب', 'متّقد', 'أسطوري'],
    correctIs: 'الصحيح',
  },
  en: {
    title: 'Taste Quiz',
    how: 'Questions about this menu, dealt as rising stages. Answer fast and in a streak to multiply your points.',
    start: 'Start quiz',
    again: 'New quiz',
    over: 'Quiz complete',
    score: 'Score',
    points: 'points',
    right: 'Correct',
    wrong: 'Wrong',
    timeout: 'Time up',
    next: 'Next',
    endStage: 'Finish stage',
    stage: 'Stage',
    of: 'of',
    q: 'Question',
    stageDone: 'Stage cleared',
    goNext: 'Next stage',
    correctOf: 'correct',
    thin: 'This quiz needs a fuller menu: at least six items with real prices, so every question is backed by real data.',
    thinTitle: 'Not enough menu data',
    qPricey: 'Which item costs more?',
    qCheap: 'Which item costs less?',
    qCal: (n) => `How many calories in ${n}?`,
    qIng: (n) => `Which item contains ${n}?`,
    cal: 'cal',
    fifty: '50:50',
    fiftyLeft: (n) => `50:50 (${n})`,
    removed: 'Two wrong answers removed.',
    resumeAt: (s) => `Best stage reached before: ${s}`,
    accuracy: 'accuracy',
    bestStreak: 'Best streak',
    stageReached: 'Stages',
    stMeter: ['Streak', 'On fire', 'Blazing', 'Legendary'],
    correctIs: 'Correct',
  },
}

const shuffle = (a) => {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

// ---------------------------------------------------------- shared UI ----
function Ring({ frac, secs, danger }) {
  const R = 19
  const C = 2 * Math.PI * R
  const off = C * (1 - Math.max(0, Math.min(1, frac)))
  return (
    <div className={`qz-ring${danger ? ' danger' : ''}`}>
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle className="qz-ring-bg" cx="22" cy="22" r={R} strokeWidth="4" />
        <circle className="qz-ring-fg" cx="22" cy="22" r={R} strokeWidth="4" strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 22 22)" />
      </svg>
      <b>{secs}</b>
    </div>
  )
}

function StreakMeter({ streak, labels }) {
  if (streak < 2) return null
  const flames = Math.min(5, streak - 1)
  const tier = streak >= 9 ? 'legend' : streak >= 6 ? 'blaze' : streak >= 4 ? 'hot' : ''
  const label = streak >= 9 ? labels[3] : streak >= 6 ? labels[2] : streak >= 4 ? labels[1] : labels[0]
  return (
    <span className={`qz-streak ${tier}`.trim()}>
      <span className="qz-flames">
        {Array.from({ length: flames }, (_, i) => <i key={i}><Icon name="flame" size={13} /></i>)}
      </span>
      <span className="qz-slabel">{label}</span>
      <span>x{streak}</span>
    </span>
  )
}

function StageMap({ total, current, cleared }) {
  if (total <= 1) return null
  return (
    <div className="qz-map">
      {Array.from({ length: total }, (_, i) => {
        const done = i < cleared
        const cur = i === current && !done
        const cls = done ? 'qz-node done' : cur ? 'qz-node cur' : 'qz-node'
        return (
          <Fragment key={i}>
            {i > 0 && <span className={`qz-link${i <= cleared ? ' done' : ''}`} />}
            <span className={cls}>
              <span className="qz-medal">{done ? <Icon name="check" size={15} /> : i + 1}</span>
            </span>
          </Fragment>
        )
      })}
    </div>
  )
}

function AccRing({ pct, label }) {
  const R = 52
  const C = 2 * Math.PI * R
  const off = C * (1 - Math.max(0, Math.min(100, pct)) / 100)
  return (
    <div className="qz-acc">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="qz-acc-bg" cx="60" cy="60" r={R} strokeWidth="9" />
        <circle className="qz-acc-fg" cx="60" cy="60" r={R} strokeWidth="9" strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 60 60)" />
      </svg>
      <b><u>{pct}%</u><span>{label}</span></b>
    </div>
  )
}

// chunk a difficulty-sorted pool into rising stages of five; fold a tiny final
// stage into the one before it so no stage is left with one or two questions.
function chunkStages(pool) {
  const groups = []
  for (let i = 0; i < pool.length; i += PER_STAGE) groups.push(pool.slice(i, i + PER_STAGE))
  if (groups.length > 1 && groups[groups.length - 1].length < 3) {
    const last = groups.pop()
    groups[groups.length - 1] = groups[groups.length - 1].concat(last)
  }
  return groups
}

export default function TasteQuiz({
  onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '',
  tenant = null, onProgress, resumeState,
}) {
  const t = TXT[lang] || TXT.ar
  const accent = brand || '#0e7490'
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])

  const saved = resumeState && resumeState.game === GAME_ID ? resumeState : null
  const bestStageBefore = saved ? Number(saved.stage) || 0 : 0

  // regenerate a fresh, honest question set each mount, then grade + stage it.
  const stages = useMemo(() => {
    const nm = (it) => String((lang === 'en' ? it?.nameEn : it?.nameAr) || it?.nameAr || it?.nameEn || '').trim()
    const ingName = (ing) => {
      if (typeof ing === 'string') return ing.trim()
      return String((lang === 'en' ? ing?.nameEn : ing?.nameAr) || ing?.nameAr || ing?.nameEn || '').trim()
    }

    const poolItems = (items || [])
      .filter((i) => i && nm(i) && Number(i.price) > 0)
      .map((i, n) => ({
        id: String(i.id || `q${n}`),
        name: nm(i),
        price: Number(i.price),
        calories: Number(i.calories) > 0 ? Math.round(Number(i.calories)) : null,
        ings: Array.isArray(i.ingredients) ? i.ingredients.map(ingName).filter(Boolean) : [],
      }))
    if (poolItems.length < MIN_ITEMS) return null

    const out = []

    // ---- 1. which is more expensive / cheaper (needs a unique extreme) ----
    // difficulty scales with how close the top two prices are.
    const priceQs = []
    for (let attempt = 0; attempt < 60 && priceQs.length < 8; attempt++) {
      const four = shuffle(poolItems).slice(0, 4)
      const asc = [...four].sort((a, b) => a.price - b.price)
      const desc = [...four].sort((a, b) => b.price - a.price)
      const highGap = desc[0].price - desc[1].price
      const lowGap = asc[1].price - asc[0].price
      const cheap = attempt % 3 === 0 && asc[1].price !== asc[0].price
      const ext = cheap ? asc[0] : desc[0]
      const gap = cheap ? lowGap : highGap
      const second = cheap ? asc[1].price : desc[1].price
      if (gap <= 0) continue // ambiguous — skip it
      if (priceQs.some((q) => q.answer === ext.id && q.cheap === cheap)) continue
      const rel = ext.price > 0 ? gap / ext.price : 0
      const difficulty = rel >= 0.4 ? 1 : rel >= 0.18 ? 2 : 3
      priceQs.push({
        id: `p-${ext.id}-${attempt}`,
        cheap,
        difficulty,
        text: cheap ? t.qCheap : t.qPricey,
        choices: shuffle(four).map((x) => ({ key: x.id, label: x.name })),
        answer: ext.id,
        note: `${ext.name} — ${ext.price}`,
      })
    }

    // ---- 2. calories (only for items that actually declare them) ----
    const calQs = []
    const withCal = shuffle(poolItems.filter((x) => x.calories))
    const otherCals = [...new Set(poolItems.map((x) => x.calories).filter(Boolean))]
    for (const it of withCal.slice(0, 8)) {
      const wrong = new Set()
      for (const c of shuffle(otherCals)) {
        if (wrong.size >= 3) break
        if (c !== it.calories) wrong.add(c)
      }
      const derived = [Math.round(it.calories * 0.55 / 5) * 5, Math.round(it.calories * 1.6 / 5) * 5, it.calories + 85, Math.max(5, it.calories - 65)]
      for (const c of derived) {
        if (wrong.size >= 3) break
        if (c > 0 && c !== it.calories) wrong.add(c)
      }
      if (wrong.size < 3) continue
      const opts = shuffle([it.calories, ...[...wrong].slice(0, 3)])
      calQs.push({
        id: `c-${it.id}`,
        difficulty: 2,
        text: t.qCal(it.name),
        choices: opts.map((v) => ({ key: String(v), label: `${v} ${t.cal}` })),
        answer: String(it.calories),
        note: `${it.name} — ${it.calories} ${t.cal}`,
      })
    }

    // ---- 3. which item contains ingredient Y (absence proven on the other 3) ----
    const ingQs = []
    const withIngs = shuffle(poolItems.filter((x) => x.ings.length))
    for (const it of withIngs) {
      if (ingQs.length >= 8) break
      const ing = it.ings[Math.floor(Math.random() * it.ings.length)]
      const clean = shuffle(poolItems.filter((x) => x.id !== it.id && !x.ings.some((y) => y === ing)))
      if (clean.length < 3) continue
      if (ingQs.some((q) => q.ing === ing)) continue
      const four = shuffle([it, ...clean.slice(0, 3)])
      ingQs.push({
        id: `i-${it.id}-${ing}`,
        ing,
        difficulty: 3,
        text: t.qIng(ing),
        choices: four.map((x) => ({ key: x.id, label: x.name })),
        answer: it.id,
        note: `${it.name} — ${ing}`,
      })
    }

    // interleave the three kinds so a stage never feels like one long drill,
    // then sort by difficulty so the ladder genuinely rises across stages.
    const lanes = [shuffle(priceQs), shuffle(calQs), shuffle(ingQs)]
    for (let i = 0; out.length < 30 && i < 12; i++) {
      for (const lane of lanes) {
        if (out.length >= 30) break
        if (lane[i]) out.push(lane[i])
      }
    }
    if (out.length < MIN_ITEMS) return null
    out.sort((a, b) => a.difficulty - b.difficulty)
    return chunkStages(out)
  }, [items, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalStages = stages ? stages.length : 0

  const [phase, setPhase] = useState('intro') // intro | q | reveal | stageEnd | over
  const [si, setSi] = useState(0)
  const [qi, setQi] = useState(0)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [asked, setAsked] = useState(0)
  const [picked, setPicked] = useState(null) // key | '' on timeout
  const [left, setLeft] = useState(SECONDS)
  const [removed, setRemoved] = useState(() => new Set())
  const [lifelines, setLifelines] = useState(LIFELINES)
  const [marks, setMarks] = useState([])

  const stage = stages ? stages[si] : null
  const q = stage ? stage[qi] : null
  const total = stage ? stage.length : 0

  const report = (extra = {}) => {
    onProgressRef.current?.({
      game: GAME_ID,
      v: 1,
      stage: extra.stage !== undefined ? extra.stage : si,
      score: extra.score !== undefined ? extra.score : score,
      correct: extra.correct !== undefined ? extra.correct : correct,
      asked: extra.asked !== undefined ? extra.asked : asked,
      bestStreak: extra.bestStreak !== undefined ? extra.bestStreak : bestStreak,
      done: !!extra.done,
      at: Date.now(),
    })
  }

  // per-question countdown; a timeout scores nothing and breaks the streak
  useEffect(() => {
    if (phase !== 'q' || !q) return undefined
    setLeft(SECONDS)
    const t0 = Date.now()
    const iv = setInterval(() => {
      const rem = SECONDS - (Date.now() - t0) / 1000
      if (rem <= 0) { clearInterval(iv); setLeft(0); resolve('') }
      else setLeft(rem)
    }, 100)
    return () => clearInterval(iv)
  }, [phase, si, qi]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    setSi(0); setQi(0); setScore(0); setStreak(0); setBestStreak(0)
    setCorrect(0); setAsked(0); setPicked(null); setRemoved(new Set()); setLifelines(LIFELINES); setMarks([])
    onScoreRef.current?.(0)
    play('deal')
    setPhase('q')
  }

  function resolve(key) {
    if (phase !== 'q' || !q) return
    const hit = key === q.answer
    setPicked(key)
    setMarks((m) => [...m, hit])
    const nextAsked = asked + 1
    setAsked(nextAsked)

    let nextScore = score
    let nextCorrect = correct
    let nextBest = bestStreak
    if (hit) {
      const speed = Math.round((Math.max(0, left) / SECONDS) * 8)
      const gain = 10 * (q.difficulty || 1) + speed + Math.min(12, streak * 2)
      nextScore = score + gain
      nextCorrect = correct + 1
      const ns = streak + 1
      nextBest = Math.max(bestStreak, ns)
      setScore(nextScore)
      setCorrect(nextCorrect)
      setStreak(ns)
      setBestStreak(nextBest)
      onScoreRef.current?.(nextScore)
      play('win', { gain: 0.4 })
      if (ns % 3 === 0) play('turn', { gain: 0.5 })
    } else {
      setStreak(0)
      play('lose', { gain: 0.5 })
    }
    setPhase('reveal')
    report({ score: nextScore, correct: nextCorrect, asked: nextAsked, bestStreak: nextBest })
  }

  const advance = () => {
    if (qi + 1 < total) { setPicked(null); setRemoved(new Set()); setQi(qi + 1); setPhase('q'); return }
    setPhase('stageEnd')
    play('win', { gain: 0.7 })
    report({ stage: si + 1 })
  }

  const nextStage = () => {
    const ns = si + 1
    if (ns >= totalStages) {
      setPhase('over')
      report({ stage: totalStages, done: true })
      play('win')
      onScoreRef.current?.(score)
      return
    }
    setSi(ns); setQi(0); setPicked(null); setRemoved(new Set()); setMarks([])
    setStreak(0)
    setPhase('q')
    play('deal')
  }

  const useFifty = () => {
    if (phase !== 'q' || !q || lifelines <= 0 || removed.size) return
    const wrong = q.choices.map((c) => c.key).filter((k) => k !== q.answer)
    for (let i = wrong.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[wrong[i], wrong[j]] = [wrong[j], wrong[i]] }
    setRemoved(new Set(wrong.slice(0, 2)))
    setLifelines((n) => n - 1)
    play('card')
  }

  const pct = asked ? Math.round((correct / asked) * 100) : 0

  // Honest refusal: a thin menu gets an explanation, not invented questions.
  if (!stages) {
    return (
      <div className="qz-root" style={{ '--qz-brand': accent }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="qz-card">
          <span className="qz-crest brand"><Icon name="menu" size={32} /></span>
          <strong className="qz-title">{t.thinTitle}</strong>
          <p className="qz-line">{t.thin}</p>
        </div>
      </div>
    )
  }

  if (phase === 'intro') {
    return (
      <div className="qz-root" style={{ '--qz-brand': accent }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="qz-card">
          <span className="qz-crest brand"><Icon name="notepad" size={34} /></span>
          <strong className="qz-title">{t.title}</strong>
          <p className="qz-line">{t.how}</p>
          <StageMap total={totalStages} current={0} cleared={Math.min(bestStageBefore, totalStages)} />
          {bestStageBefore > 0 && <p className="qz-line faint">{t.resumeAt(Math.min(bestStageBefore, totalStages))}</p>}
          <button type="button" className="qz-btn gold" onClick={start}>
            <Icon name="play" size={16} /> {t.start}
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'stageEnd') {
    const hits = marks.filter(Boolean).length
    return (
      <div className="qz-root" style={{ '--qz-brand': accent }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="qz-card">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="qz-spark" style={{ '--sx': `${(i - 2.5) * 26}px`, '--sy': '-46px', left: `${44 + i * 3}%`, animationDelay: `${i * 60}ms` }} />
          ))}
          <span className="qz-crest"><Icon name="award" size={34} /></span>
          <strong className="qz-title">{t.stageDone}</strong>
          <span className="qz-big">{hits}/{marks.length}</span>
          <StageMap total={totalStages} current={si + 1} cleared={si + 1} />
          <p className="qz-line">{t.score}: <b>{score}</b> {t.points}</p>
          <button type="button" className="qz-btn gold" onClick={nextStage}>
            <Icon name={si + 1 >= totalStages ? 'award' : 'next'} size={16} /> {si + 1 >= totalStages ? t.endStage : t.goNext}
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'over') {
    return (
      <div className="qz-root" style={{ '--qz-brand': accent }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="qz-card">
          <span className="qz-crest"><Icon name="award" size={34} /></span>
          <strong className="qz-title">{t.over}</strong>
          {playerName ? <p className="qz-line">{playerName}</p> : null}
          <AccRing pct={pct} label={t.accuracy} />
          <div className="qz-stats">
            <div className="qz-stat"><span className="qz-ci"><Icon name="star" size={16} /></span><b>{score}</b><span>{t.points}</span></div>
            <div className="qz-stat"><span className="qz-ci"><Icon name="flame" size={16} /></span><b>{bestStreak}</b><span>{t.bestStreak}</span></div>
            <div className="qz-stat"><span className="qz-ci"><Icon name="trending" size={16} /></span><b>{totalStages}</b><span>{t.stageReached}</span></div>
          </div>
          <p className="qz-line faint">{correct} {t.of} {asked} {t.correctOf}</p>
          <button type="button" className="qz-btn gold" onClick={start}>
            <Icon name="repeat" size={16} /> {t.again}
          </button>
        </div>
      </div>
    )
  }

  if (!q) return null
  const revealing = phase === 'reveal'
  const frac = Math.max(0, left) / SECONDS
  const danger = left < 4

  return (
    <div className="qz-root" style={{ '--qz-brand': accent }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="qz-wrap">
        <div className="qz-hud">
          <div className="qz-pips">
            {Array.from({ length: total }, (_, i) => {
              const mark = marks[i]
              const cls = mark === undefined ? (i === qi ? 'qz-pip cur' : 'qz-pip') : mark ? 'qz-pip done' : 'qz-pip miss'
              return <span key={i} className={cls}><i /></span>
            })}
          </div>
          <div className="qz-meta">
            <span className="qz-chip solid">{t.stage} {si + 1}/{totalStages}</span>
            <span className="qz-chip">{t.q} {qi + 1}/{total}</span>
            <StreakMeter streak={streak} labels={t.stMeter} />
            <span className="qz-spacer" />
            <Ring frac={frac} secs={Math.max(0, Math.ceil(left))} danger={danger} />
          </div>
        </div>

        <div className="qz-body">
          <div className="qz-plate">
            <span className="qz-kicker"><Icon name="notepad" size={13} /> {t.title}</span>
            <p className="qz-q">{q.text}</p>
          </div>
          <div className="qz-opts">
            {q.choices.map((c) => {
              const isAnswer = c.key === q.answer
              const isPicked = picked === c.key
              const gone = removed.has(c.key)
              const state = revealing
                ? (isAnswer ? ' good' : (isPicked ? ' bad' : ' off'))
                : (gone ? ' gone' : '')
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`qz-opt${state}`}
                  disabled={revealing || gone}
                  onClick={() => resolve(c.key)}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
          {revealing && (
            <div className={`qz-reveal ${picked === q.answer ? 'good' : 'bad'}`}>
              <span className={`qz-reveal-h ${picked === q.answer ? 'good' : 'bad'}`}>
                <Icon name={picked === q.answer ? 'ok' : 'warning'} size={15} />
                {picked === '' ? t.timeout : picked === q.answer ? t.right : t.wrong}
              </span>
              {q.note ? <p>{q.note}</p> : null}
            </div>
          )}
        </div>

        <div className="qz-foot">
          {!revealing && (
            <button
              type="button"
              className={`qz-btn ghost${lifelines > 0 && !removed.size ? ' live' : ''}`}
              disabled={lifelines <= 0 || removed.size > 0}
              onClick={useFifty}
            >
              <Icon name="scale" size={15} /> {removed.size ? t.removed : t.fiftyLeft(lifelines)}
            </button>
          )}
          {revealing && (
            <button type="button" className="qz-btn" onClick={advance}>
              <Icon name={qi + 1 >= total ? 'ok' : 'next'} size={16} />
              {qi + 1 >= total ? t.endStage : t.next}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
