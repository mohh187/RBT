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
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'

const TOTAL_Q = 10
const SECONDS = 12
const BASE_POINTS = 10
const MIN_ITEMS = 6

const TXT = {
  ar: {
    title: 'اختبار الذوق',
    how: 'عشرة أسئلة عن قائمة المكان. لكل سؤال اثنتا عشرة ثانية — أجب بسرعة وبتتابع لتضاعف نقاطك.',
    start: 'ابدأ الاختبار',
    again: 'اختبار جديد',
    over: 'انتهى الاختبار',
    score: 'النتيجة',
    points: 'نقطة',
    streak: 'متتالية',
    right: 'إجابة صحيحة',
    wrong: 'إجابة خاطئة',
    timeout: 'انتهى الوقت',
    next: 'التالي',
    finish: 'عرض النتيجة',
    correctOf: 'إجابات صحيحة',
    thin: 'يحتاج هذا الاختبار إلى قائمة أكمل: نحتاج ستة أصناف على الأقل تحمل أسعاراً حقيقية حتى نبني أسئلة صادقة. لن نخترع معلومات عن الأصناف.',
    thinTitle: 'القائمة غير كافية',
    qPricey: 'أي صنف أغلى؟',
    qCal: (n) => `كم سعرة حرارية في ${n}؟`,
    qIng: (n) => `أي صنف يحتوي على ${n}؟`,
    cal: 'سعرة',
  },
  en: {
    title: 'Taste Quiz',
    how: 'Ten questions about this menu. Twelve seconds each — answer fast and in a streak.',
    start: 'Start quiz',
    again: 'New quiz',
    over: 'Quiz finished',
    score: 'Score',
    points: 'points',
    streak: 'Streak',
    right: 'Correct',
    wrong: 'Wrong',
    timeout: 'Time up',
    next: 'Next',
    finish: 'See result',
    correctOf: 'correct',
    thin: 'This quiz needs a fuller menu: at least six items with real prices, so every question is backed by real data.',
    thinTitle: 'Not enough menu data',
    qPricey: 'Which item costs more?',
    qCal: (n) => `How many calories in ${n}?`,
    qIng: (n) => `Which item contains ${n}?`,
    cal: 'cal',
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

export default function TasteQuiz({ onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '' }) {
  const t = TXT[lang] || TXT.ar
  const onScoreRef = useRef(onScore)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])

  const questions = useMemo(() => {
    const nm = (it) => String((lang === 'en' ? it?.nameEn : it?.nameAr) || it?.nameAr || it?.nameEn || '').trim()
    const ingName = (ing) => {
      if (typeof ing === 'string') return ing.trim()
      return String((lang === 'en' ? ing?.nameEn : ing?.nameAr) || ing?.nameAr || ing?.nameEn || '').trim()
    }

    // usable = has a name AND a real price (the field every menu item carries)
    const pool = (items || [])
      .filter((i) => i && nm(i) && Number(i.price) > 0)
      .map((i, n) => ({
        id: String(i.id || `q${n}`),
        name: nm(i),
        price: Number(i.price),
        calories: Number(i.calories) > 0 ? Math.round(Number(i.calories)) : null,
        ings: Array.isArray(i.ingredients) ? i.ingredients.map(ingName).filter(Boolean) : [],
      }))
    if (pool.length < MIN_ITEMS) return null

    const out = []

    // ---- 1. which is more expensive (needs a unique maximum) ----
    const priceQs = []
    for (let attempt = 0; attempt < 40 && priceQs.length < 6; attempt++) {
      const four = shuffle(pool).slice(0, 4)
      const sorted = [...four].sort((a, b) => b.price - a.price)
      if (sorted[0].price === sorted[1].price) continue // ambiguous — skip it
      if (priceQs.some((q) => q.answer === sorted[0].id)) continue
      priceQs.push({
        id: `p-${sorted[0].id}-${attempt}`,
        text: t.qPricey,
        choices: four.map((x) => ({ key: x.id, label: x.name })),
        answer: sorted[0].id,
        note: `${sorted[0].name} — ${sorted[0].price}`,
      })
    }

    // ---- 2. calories (only for items that actually declare them) ----
    const calQs = []
    const withCal = shuffle(pool.filter((x) => x.calories))
    const otherCals = [...new Set(pool.map((x) => x.calories).filter(Boolean))]
    for (const it of withCal.slice(0, 6)) {
      const wrong = new Set()
      // prefer other items' REAL calorie values as distractors
      for (const c of shuffle(otherCals)) {
        if (wrong.size >= 3) break
        if (c !== it.calories) wrong.add(c)
      }
      // top up with plainly-derived numbers (clearly distractors, never claimed of any dish)
      const derived = [Math.round(it.calories * 0.55 / 5) * 5, Math.round(it.calories * 1.6 / 5) * 5, it.calories + 85, Math.max(5, it.calories - 65)]
      for (const c of derived) {
        if (wrong.size >= 3) break
        if (c > 0 && c !== it.calories) wrong.add(c)
      }
      if (wrong.size < 3) continue
      const opts = shuffle([it.calories, ...[...wrong].slice(0, 3)])
      calQs.push({
        id: `c-${it.id}`,
        text: t.qCal(it.name),
        choices: opts.map((v) => ({ key: String(v), label: `${v} ${t.cal}` })),
        answer: String(it.calories),
        note: `${it.name} — ${it.calories} ${t.cal}`,
      })
    }

    // ---- 3. which item contains ingredient Y (absence proven on the other 3) ----
    const ingQs = []
    const withIngs = shuffle(pool.filter((x) => x.ings.length))
    for (const it of withIngs) {
      if (ingQs.length >= 6) break
      const ing = it.ings[Math.floor(Math.random() * it.ings.length)]
      // the other three must verifiably NOT list it, otherwise the question lies
      const clean = shuffle(pool.filter((x) => x.id !== it.id && !x.ings.some((y) => y === ing)))
      if (clean.length < 3) continue
      if (ingQs.some((q) => q.ing === ing)) continue
      const four = shuffle([it, ...clean.slice(0, 3)])
      ingQs.push({
        id: `i-${it.id}-${ing}`,
        ing,
        text: t.qIng(ing),
        choices: four.map((x) => ({ key: x.id, label: x.name })),
        answer: it.id,
        note: `${it.name} — ${ing}`,
      })
    }

    // interleave the kinds so the quiz never feels like one long price drill
    const lanes = [shuffle(priceQs), shuffle(calQs), shuffle(ingQs)]
    for (let i = 0; out.length < TOTAL_Q && i < 12; i++) {
      let added = false
      for (const lane of lanes) {
        if (out.length >= TOTAL_Q) break
        const q = lane[i]
        if (q) { out.push(q); added = true }
      }
      if (!added) break
    }
    return out.length ? out : null
  }, [items, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const [phase, setPhase] = useState('intro') // intro | q | reveal | over
  const [qi, setQi] = useState(0)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [picked, setPicked] = useState(null) // key | '' on timeout
  const [left, setLeft] = useState(SECONDS)

  const q = questions ? questions[qi] : null
  const total = questions ? questions.length : 0

  // per-question countdown; a timeout scores nothing and breaks the streak
  useEffect(() => {
    if (phase !== 'q') return undefined
    setLeft(SECONDS)
    const t0 = Date.now()
    const iv = setInterval(() => {
      const rem = SECONDS - (Date.now() - t0) / 1000
      if (rem <= 0) {
        clearInterval(iv)
        setLeft(0)
        setPicked('')
        setStreak(0)
        setPhase('reveal')
      } else {
        setLeft(rem)
      }
    }, 100)
    return () => clearInterval(iv)
  }, [phase, qi])

  const start = () => {
    setQi(0); setScore(0); setStreak(0); setCorrect(0); setPicked(null)
    onScoreRef.current?.(0)
    setPhase('q')
  }

  const answer = (key) => {
    if (phase !== 'q' || !q) return
    setPicked(key)
    if (key === q.answer) {
      const speed = Math.round(Math.max(0, left) / SECONDS * 8)
      const ns = score + BASE_POINTS + speed + Math.min(10, streak * 2)
      setScore(ns)
      setStreak(streak + 1)
      setCorrect(correct + 1)
      onScoreRef.current?.(ns)
    } else {
      setStreak(0)
    }
    setPhase('reveal')
  }

  const next = () => {
    if (qi + 1 >= total) {
      setPhase('over')
      onScoreRef.current?.(score)
    } else {
      setPicked(null)
      setQi(qi + 1)
      setPhase('q')
    }
  }

  // Honest refusal: a thin menu gets an explanation, not invented questions.
  if (!questions) {
    return (
      <div className="gb-stage gb-dom">
        <div className="gb-card">
          <span className="gb-emptyico" style={{ background: brand }}><Icon name="menu" size={22} /></span>
          <strong className="gb-title">{t.thinTitle}</strong>
          <p className="gb-line">{t.thin}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="gb-stage gb-dom">
      {/* the hub's title bar owns the live score — only game-specific state here */}
      <div className="gb-hud">
        {phase !== 'intro' && phase !== 'over' && <span className="gb-chip">{qi + 1}/{total}</span>}
        {streak > 1 && <span className="gb-chip" style={{ background: brand, borderColor: 'transparent' }}>{t.streak} x{streak}</span>}
      </div>

      {phase === 'intro' && (
        <div className="gb-card">
          <strong className="gb-title">{t.title}</strong>
          <p className="gb-line">{t.how}</p>
          <button type="button" className="gb-btn" style={{ background: brand }} onClick={start}>
            <Icon name="play" size={16} /> {t.start}
          </button>
        </div>
      )}

      {phase === 'over' && (
        <div className="gb-card">
          <strong className="gb-title">{t.over}</strong>
          <p className="gb-line">{playerName ? `${playerName}: ` : ''}<b>{score}</b> {t.points}</p>
          <p className="gb-line faint">{correct}/{total} {t.correctOf}</p>
          <button type="button" className="gb-btn" style={{ background: brand }} onClick={start}>
            <Icon name="repeat" size={16} /> {t.again}
          </button>
        </div>
      )}

      {(phase === 'q' || phase === 'reveal') && q && (
        <div className="gb-pane">
          <div className="gb-qtimer">
            <i style={{ width: `${Math.max(0, left) / SECONDS * 100}%`, background: left < 4 ? '#ff7a6b' : brand }} />
          </div>
          <p className="gb-q">{q.text}</p>
          <div className="gb-answers">
            {q.choices.map((c) => {
              const isAnswer = c.key === q.answer
              const isPicked = picked === c.key
              const state = phase === 'reveal' ? (isAnswer ? ' good' : (isPicked ? ' bad' : ' off')) : ''
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`gb-answer${state}`}
                  disabled={phase === 'reveal'}
                  onClick={() => answer(c.key)}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
          {phase === 'reveal' && (
            <>
              <p className="gb-line faint">
                {picked === '' ? t.timeout : picked === q.answer ? t.right : t.wrong}
                {q.note ? ` — ${q.note}` : ''}
              </p>
              <button type="button" className="gb-btn" style={{ background: brand }} onClick={next}>
                <Icon name={qi + 1 >= total ? 'award' : 'next'} size={16} /> {qi + 1 >= total ? t.finish : t.next}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
