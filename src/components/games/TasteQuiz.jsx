// «اختبار الذوق» — a staged quiz ladder generated from the venue's REAL menu.
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
// fact is always the true one. With too few usable items the quiz refuses to
// run and says why instead of fabricating questions.
//
// STAGES: the run is a ladder of 5-question stages (up to 5 of them, as deep
// as the menu allows). Each stage shaves a second off the clock and raises the
// score multiplier. The whole run is built deterministically from one seed, so
// resumeState restores the EXACT same ladder at the stage the guest left.
//
// Contract: play area only — the hub owns the shell, score line and closing.
// Progress is reported through onProgress at stage boundaries and restored
// from resumeState. Lifeline: «حذف إجابتين» — two provably-wrong choices are
// dimmed, twice per run, computed locally from the same honest data.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { play } from '../../lib/gameSounds.js'
import { makeRng } from '../../lib/puzzleBank.js'
import '../../styles/quizzes.css'

export const GAME_ID = 'tasteQuiz'
const PER_STAGE = 5
const MAX_STAGES = 5
const MIN_ITEMS = 6
const BASE_POINTS = 10
const CUTS = 2 // remove-two lifeline uses per run

const stageSeconds = (s) => Math.max(7, 12 - s)
const stageMult = (s) => 1 + s * 0.25

const num = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 2 })

const TXT = {
  ar: {
    title: 'اختبار الذوق',
    how: 'سُلّم مراحل مبني من قائمة هذا المكان: كل مرحلة خمسة أسئلة، والوقت يقصر والنقاط تتضاعف كلما صعدت.',
    note: 'لديك مساعدتا «حذف إجابتين» للجولة كاملة، والتتابع الصحيح يضاعف نقاطك.',
    start: 'ابدأ التحدي',
    resume: 'استكمل من حيث توقفت',
    resumeAt: (s) => `توقفت عند المرحلة ${s}`,
    fresh: 'ابدأ جديداً',
    stage: 'المرحلة',
    q: 'سؤال',
    of: 'من',
    points: 'نقطة',
    streak: 'متتالية',
    right: 'إجابة صحيحة',
    wrong: 'إجابة خاطئة',
    timeout: 'انتهى الوقت',
    correctIs: 'الصحيح',
    next: 'التالي',
    endStage: 'إنهاء المرحلة',
    stageDone: (s) => `المرحلة ${s} اكتملت`,
    goNext: 'المرحلة التالية',
    finishRun: 'عرض النتيجة',
    over: 'انتهى التحدي',
    accuracy: 'الدقة',
    bestStreak: 'أفضل تتابع',
    stageReached: 'وصلت للمرحلة',
    correctCount: 'إجابات صحيحة',
    again: 'تحدٍّ جديد',
    cut: 'حذف إجابتين',
    cutDone: 'أُزيلت إجابتان خاطئتان',
    cutNone: 'انتهت مساعدات الحذف',
    thin: 'يحتاج هذا الاختبار إلى قائمة أكمل: نحتاج ستة أصناف على الأقل تحمل أسعاراً حقيقية حتى نبني أسئلة صادقة. لن نخترع معلومات عن الأصناف.',
    thinTitle: 'القائمة غير كافية',
    qPricey: 'أي صنف أغلى؟',
    qCal: (n) => `كم سعرة حرارية في ${n}؟`,
    qIng: (n) => `أي صنف يحتوي على ${n}؟`,
    cal: 'سعرة',
    famPrice: 'الأسعار',
    famCal: 'السعرات',
    famIng: 'المكونات',
    exPrice: (n, p) => `${n} أغلى الأربعة — سعره ${p}.`,
    exCal: (n, c) => `${n} يحمل ${c} سعرة حرارية كما هو مدوّن في القائمة.`,
    exIng: (n, g) => `«${g}» مذكور في مكونات ${n} في القائمة.`,
    gained: 'نقاط المرحلة',
  },
  en: {
    title: 'Taste Quiz',
    how: 'A stage ladder built from this venue’s menu: five questions per stage, with a shorter clock and a higher multiplier as you climb.',
    note: 'Two «remove two answers» lifelines per run, and a streak multiplies your points.',
    start: 'Start the run',
    resume: 'Resume where you stopped',
    resumeAt: (s) => `You stopped at stage ${s}`,
    fresh: 'Start fresh',
    stage: 'Stage',
    q: 'Question',
    of: 'of',
    points: 'points',
    streak: 'Streak',
    right: 'Correct',
    wrong: 'Wrong',
    timeout: 'Time up',
    correctIs: 'Correct',
    next: 'Next',
    endStage: 'Finish stage',
    stageDone: (s) => `Stage ${s} complete`,
    goNext: 'Next stage',
    finishRun: 'See result',
    over: 'Run finished',
    accuracy: 'Accuracy',
    bestStreak: 'Best streak',
    stageReached: 'Stage reached',
    correctCount: 'correct',
    again: 'New run',
    cut: 'Remove two',
    cutDone: 'Two wrong answers removed',
    cutNone: 'No removals left',
    thin: 'This quiz needs a fuller menu: at least six items with real prices, so every question is backed by real data.',
    thinTitle: 'Not enough menu data',
    qPricey: 'Which item costs more?',
    qCal: (n) => `How many calories in ${n}?`,
    qIng: (n) => `Which item contains ${n}?`,
    cal: 'cal',
    famPrice: 'Prices',
    famCal: 'Calories',
    famIng: 'Ingredients',
    exPrice: (n, p) => `${n} is the priciest of the four — ${p}.`,
    exCal: (n, c) => `${n} carries ${c} calories, as listed on the menu.`,
    exIng: (n, g) => `“${g}” is listed among the ingredients of ${n}.`,
    gained: 'Stage points',
  },
}

const FAM = {
  price: { icon: 'wallet', ar: 'famPrice' },
  cal: { icon: 'flame', ar: 'famCal' },
  ing: { icon: 'menu', ar: 'famIng' },
}

// seeded Fisher-Yates — the run must rebuild identically from its seed
const shuffleWith = (rnd, a) => {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

// ---------------------------------------------------------------------------
// run builder — every question provably true, deterministic from (items, seed)
// ---------------------------------------------------------------------------
function buildRun(items, lang, seed) {
  const t = TXT[lang] || TXT.ar
  const rnd = makeRng((Number(seed) || 1) * 2654435761 % 4294967296)
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

  // ---- 1. which is more expensive (needs a unique maximum) ----
  const priceQs = []
  for (let attempt = 0; attempt < 70 && priceQs.length < 10; attempt++) {
    const four = shuffleWith(rnd, pool).slice(0, 4)
    const sorted = [...four].sort((a, b) => b.price - a.price)
    if (sorted[0].price === sorted[1].price) continue // ambiguous — skip it
    if (priceQs.some((q) => q.answer === sorted[0].id)) continue
    priceQs.push({
      id: `p-${sorted[0].id}-${attempt}`,
      kind: 'price',
      text: t.qPricey,
      choices: four.map((x) => ({ key: x.id, label: x.name })),
      answer: sorted[0].id,
      explain: t.exPrice(sorted[0].name, num(sorted[0].price)),
    })
  }

  // ---- 2. calories (only for items that actually declare them) ----
  const calQs = []
  const withCal = shuffleWith(rnd, pool.filter((x) => x.calories))
  const otherCals = [...new Set(pool.map((x) => x.calories).filter(Boolean))]
  for (const it of withCal.slice(0, 8)) {
    const wrong = new Set()
    // prefer other items' REAL calorie values as distractors
    for (const c of shuffleWith(rnd, otherCals)) {
      if (wrong.size >= 3) break
      if (c !== it.calories) wrong.add(c)
    }
    // top up with plainly-derived numbers (clearly distractors, never claimed of any dish)
    const derived = [
      Math.round(it.calories * 0.55 / 5) * 5,
      Math.round(it.calories * 1.6 / 5) * 5,
      it.calories + 85,
      Math.max(5, it.calories - 65),
    ]
    for (const c of derived) {
      if (wrong.size >= 3) break
      if (c > 0 && c !== it.calories) wrong.add(c)
    }
    if (wrong.size < 3) continue
    const opts = shuffleWith(rnd, [it.calories, ...[...wrong].slice(0, 3)])
    calQs.push({
      id: `c-${it.id}`,
      kind: 'cal',
      text: t.qCal(it.name),
      choices: opts.map((v) => ({ key: String(v), label: `${num(v)} ${t.cal}` })),
      answer: String(it.calories),
      explain: t.exCal(it.name, num(it.calories)),
    })
  }

  // ---- 3. which item contains ingredient Y (absence proven on the other 3) ----
  const ingQs = []
  const withIngs = shuffleWith(rnd, pool.filter((x) => x.ings.length))
  for (const it of withIngs) {
    if (ingQs.length >= 8) break
    const ing = it.ings[Math.floor(rnd() * it.ings.length)]
    // the other three must verifiably NOT list it, otherwise the question lies
    const clean = shuffleWith(rnd, pool.filter((x) => x.id !== it.id && !x.ings.some((y) => y === ing)))
    if (clean.length < 3) continue
    if (ingQs.some((q) => q.ing === ing)) continue
    const four = shuffleWith(rnd, [it, ...clean.slice(0, 3)])
    ingQs.push({
      id: `i-${it.id}-${ing}`,
      kind: 'ing',
      ing,
      text: t.qIng(ing),
      choices: four.map((x) => ({ key: x.id, label: x.name })),
      answer: it.id,
      explain: t.exIng(it.name, ing),
    })
  }

  // interleave the kinds so a stage never feels like one long price drill
  const lanes = [shuffleWith(rnd, priceQs), shuffleWith(rnd, calQs), shuffleWith(rnd, ingQs)]
  const list = []
  for (let i = 0; list.length < PER_STAGE * MAX_STAGES && i < 12; i++) {
    let added = false
    for (const lane of lanes) {
      if (list.length >= PER_STAGE * MAX_STAGES) break
      const q = lane[i]
      if (q) { list.push(q); added = true }
    }
    if (!added) break
  }

  // chunk into full stages; a lone short run (4 questions) still plays
  const stages = []
  for (let i = 0; i + PER_STAGE <= list.length && stages.length < MAX_STAGES; i += PER_STAGE) {
    stages.push(list.slice(i, i + PER_STAGE))
  }
  if (!stages.length) {
    if (list.length >= 4) stages.push(list)
    else return null
  }
  return stages
}

const newSeed = () => Math.floor(Math.random() * 1e9) + 1

// ---------------------------------------------------------------------------
// small shared atoms (duplicated across the four quiz games on purpose — the
// ownership boundary is per-component, so no shared UI module is introduced)
// ---------------------------------------------------------------------------
const RING_C = 2 * Math.PI * 18

function Ring({ secs, left }) {
  const frac = Math.max(0, Math.min(1, left / secs))
  return (
    <span className={`qz-ring${left < 4 ? ' low' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 44 44">
        <circle className="track" cx="22" cy="22" r="18" />
        <circle
          className="bar"
          cx="22"
          cy="22"
          r="18"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - frac)}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <b>{Math.ceil(Math.max(0, left))}</b>
    </span>
  )
}

const STAR_PATH = 'M12 1.9l2.98 6.05 6.68.97-4.83 4.71 1.14 6.65L12 17.13l-5.97 3.14 1.14-6.65-4.83-4.71 6.68-.97z'

function Stars({ n }) {
  return (
    <div className="qz-stars" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`qz-star${i === 1 ? ' mid' : ''}${i < n ? ' on' : ''}`}>
          <svg viewBox="0 0 24 24"><path d={STAR_PATH} fill="currentColor" /></svg>
        </span>
      ))}
    </div>
  )
}

const starsFor = (hits, total) => {
  if (!total) return 0
  const f = hits / total
  return f >= 0.99 ? 3 : f >= 0.7 ? 2 : f >= 0.5 ? 1 : 0
}

function StageMap({ total, cleared, current }) {
  const nodes = []
  for (let i = 0; i < total; i++) {
    if (i > 0) nodes.push(<i key={`l${i}`} className={`qz-link${i <= cleared ? ' clear' : ''}`} />)
    const st = i < cleared ? 'clear' : i === current ? 'now' : 'lock'
    nodes.push(
      <span key={i} className={`qz-node ${st}`}>
        {st === 'clear' ? <Icon name="check" size={15} /> : i + 1}
      </span>,
    )
  }
  return <div className="qz-map" aria-hidden="true">{nodes}</div>
}

function StreakChip({ streak, label }) {
  if (streak < 2) return null
  const tier = streak >= 7 ? 't3' : streak >= 4 ? 't2' : 't1'
  return (
    <span key={streak} className={`qz-streak ${tier}`}>
      <Icon name="flame" size={13} /> {label} x{streak}
    </span>
  )
}

// ===========================================================================
export default function TasteQuiz({
  onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '',
  onProgress, resumeState,
}) {
  const t = TXT[lang] || TXT.ar
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])

  const saved = resumeState && resumeState.game === GAME_ID && Number(resumeState.seed) > 0 ? resumeState : null

  const [phase, setPhase] = useState('intro') // intro | q | reveal | stageEnd | over
  const [seed, setSeed] = useState(saved ? Number(saved.seed) : newSeed())
  const [stage, setStage] = useState(0)
  const [qi, setQi] = useState(0)
  const [score, setScore] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [asked, setAsked] = useState(0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [cuts, setCuts] = useState(CUTS)
  const [cutKeys, setCutKeys] = useState([]) // choices removed on THIS question
  const [picked, setPicked] = useState(null) // key | '' on timeout
  const [left, setLeft] = useState(stageSeconds(0))
  const [marks, setMarks] = useState([])

  // score/correct/... as of the START of the current stage: this is what a
  // mid-stage quit resumes from, so an interrupted stage never double-counts.
  const preRef = useRef({ score: 0, correct: 0, asked: 0, bestStreak: 0, cuts: CUTS })

  const stages = useMemo(() => buildRun(items, lang, seed), [items, lang, seed])
  const totalStages = stages ? stages.length : 0
  const cur = stages ? stages[Math.min(stage, totalStages - 1)] : null
  const q = cur ? cur[qi] : null
  const secs = stageSeconds(stage)

  const report = (extra = {}) => {
    const p = preRef.current
    onProgressRef.current?.({
      game: GAME_ID,
      v: 2,
      seed,
      stage: extra.stage !== undefined ? extra.stage : stage,
      score: p.score,
      correct: p.correct,
      asked: p.asked,
      bestStreak: p.bestStreak,
      cuts: p.cuts,
      done: !!extra.done,
      at: Date.now(),
    })
  }

  const enterStage = (idx) => {
    setStage(idx)
    setQi(0)
    setPicked(null)
    setCutKeys([])
    setMarks([])
    setStreak(0)
    setPhase('q')
  }

  const begin = (fresh) => {
    play('deal')
    if (fresh || !saved) {
      const sd = fresh ? newSeed() : seed
      setSeed(sd)
      setScore(0); setCorrect(0); setAsked(0); setBestStreak(0); setCuts(CUTS)
      preRef.current = { score: 0, correct: 0, asked: 0, bestStreak: 0, cuts: CUTS }
      onScoreRef.current?.(0)
      enterStage(0)
    } else {
      const st = Math.min(Math.max(0, Number(saved.stage) || 0), totalStages - 1)
      const s = {
        score: Number(saved.score) || 0,
        correct: Number(saved.correct) || 0,
        asked: Number(saved.asked) || 0,
        bestStreak: Number(saved.bestStreak) || 0,
        cuts: saved.cuts === undefined ? CUTS : Math.max(0, Math.min(CUTS, Number(saved.cuts) || 0)),
      }
      preRef.current = { ...s }
      setScore(s.score); setCorrect(s.correct); setAsked(s.asked)
      setBestStreak(s.bestStreak); setCuts(s.cuts)
      onScoreRef.current?.(s.score)
      enterStage(st)
    }
  }

  // per-question countdown; a timeout scores nothing and breaks the streak
  useEffect(() => {
    if (phase !== 'q' || !q) return undefined
    setLeft(secs)
    const t0 = Date.now()
    const iv = setInterval(() => {
      const rem = secs - (Date.now() - t0) / 1000
      if (rem <= 0) { clearInterval(iv); setLeft(0); resolve('') }
      else setLeft(rem)
    }, 100)
    return () => clearInterval(iv)
  }, [phase, stage, qi]) // eslint-disable-line react-hooks/exhaustive-deps

  function resolve(key) {
    if (phase !== 'q' || !q) return
    const hit = key !== '' && key === q.answer
    setPicked(key)
    setMarks((m) => [...m, hit])
    setAsked(asked + 1)
    if (hit) {
      const speed = Math.round(Math.max(0, left) / secs * 8)
      const gain = Math.round((BASE_POINTS + speed + Math.min(10, streak * 2)) * stageMult(stage))
      const ns = score + gain
      const nk = streak + 1
      setScore(ns)
      setStreak(nk)
      setBestStreak(Math.max(bestStreak, nk))
      setCorrect(correct + 1)
      onScoreRef.current?.(ns)
      play('turn')
      if (nk === 4 || nk === 7) play('capture', { gain: 0.4 })
    } else {
      setStreak(0)
      play('lose', { gain: key === '' ? 0.35 : 0.5 })
    }
    setPhase('reveal')
  }

  const advance = () => {
    play('click')
    if (qi + 1 < cur.length) {
      setPicked(null)
      setCutKeys([])
      setQi(qi + 1)
      setPhase('q')
      return
    }
    // stage boundary: promote the live stats to the resume snapshot
    preRef.current = { score, correct, asked, bestStreak, cuts }
    const finished = stage + 1 >= totalStages
    if (finished) {
      setPhase('over')
      report({ stage: stage + 1, done: true })
      play(correct / Math.max(1, asked) >= 0.5 ? 'win' : 'lose')
    } else {
      setPhase('stageEnd')
      report({ stage: stage + 1 })
      play('win', { gain: 0.7 })
    }
  }

  const useCut = () => {
    if (phase !== 'q' || !q || cuts <= 0 || cutKeys.length) return
    const wrong = q.choices.filter((c) => c.key !== q.answer)
    const cut = wrong.sort(() => Math.random() - 0.5).slice(0, 2).map((c) => c.key)
    setCutKeys(cut)
    setCuts(cuts - 1)
    play('card')
  }

  // ------------------------------------------------------------ views ----
  // Honest refusal: a thin menu gets an explanation, not invented questions.
  if (!stages) {
    return (
      <div className="qz-root qz-taste">
        <div className="qz-screen">
          <span className="qz-emptyico"><Icon name="menu" size={24} /></span>
          <strong className="qz-title">{t.thinTitle}</strong>
          <p className="qz-lead">{t.thin}</p>
        </div>
      </div>
    )
  }

  if (phase === 'intro') {
    const cleared = saved ? Math.min(Math.max(0, Number(saved.stage) || 0), totalStages) : 0
    return (
      <div className="qz-root qz-taste">
        <div className="qz-screen">
          <strong className="qz-title">{t.title}</strong>
          <p className="qz-lead">{t.how}</p>
          <p className="qz-lead faint">{t.note}</p>
          <StageMap total={totalStages} cleared={cleared} current={Math.min(cleared, totalStages - 1)} />
          {saved && (
            <>
              <div className="qz-resume">
                <Icon name="reload" size={18} />
                <span>{t.resumeAt(Math.min((Number(saved.stage) || 0) + 1, totalStages))}</span>
              </div>
              <button type="button" className="qz-btn" onClick={() => begin(false)}>
                <Icon name="play" size={16} /> {t.resume}
              </button>
            </>
          )}
          <button
            type="button"
            className={saved ? 'qz-btn ghost' : 'qz-btn'}
            onClick={() => begin(true)}
          >
            <Icon name={saved ? 'repeat' : 'play'} size={16} /> {saved ? t.fresh : t.start}
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'stageEnd') {
    const hits = marks.filter(Boolean).length
    const gained = score - preRef.current.score + (score === preRef.current.score ? 0 : 0)
    return (
      <div className="qz-root qz-taste">
        <div className="qz-screen">
          <strong className="qz-title">{t.stageDone(stage + 1)}</strong>
          <Stars n={starsFor(hits, marks.length)} />
          <div className="qz-stats">
            <span className="qz-stat"><b>{hits}/{marks.length}</b><small>{t.correctCount}</small></span>
            <span className="qz-stat"><b>{score}</b><small>{t.points}</small></span>
          </div>
          <StageMap total={totalStages} cleared={stage + 1} current={stage + 1} />
          <button type="button" className="qz-btn gold" onClick={() => { play('click'); enterStage(stage + 1) }}>
            <Icon name="next" size={16} /> {t.goNext}
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'over') {
    const acc = asked ? Math.round((correct / asked) * 100) : 0
    return (
      <div className="qz-root qz-taste">
        <div className="qz-screen">
          <strong className="qz-title">{t.over}</strong>
          <span className="qz-bignum">{score}</span>
          <Stars n={starsFor(correct, asked)} />
          <p className="qz-lead">{playerName ? `${playerName} — ` : ''}{correct} {t.of} {asked} {t.correctCount}</p>
          <div className="qz-stats">
            <span className="qz-stat"><b>{acc}٪</b><small>{t.accuracy}</small></span>
            <span className="qz-stat"><b>x{bestStreak}</b><small>{t.bestStreak}</small></span>
            <span className="qz-stat"><b>{Math.min(stage + 1, totalStages)}/{totalStages}</b><small>{t.stageReached}</small></span>
          </div>
          <button type="button" className="qz-btn" onClick={() => begin(true)}>
            <Icon name="repeat" size={16} /> {t.again}
          </button>
        </div>
      </div>
    )
  }

  if (!q) return null
  const revealing = phase === 'reveal'
  const fam = FAM[q.kind] || FAM.price

  return (
    <div className="qz-root qz-taste">
      <div className="qz-top">
        <div className="qz-steps">
          {Array.from({ length: cur.length }, (_, i) => {
            const mark = marks[i]
            const cls = mark === undefined ? 'qz-step' : mark ? 'qz-step done' : 'qz-step miss'
            return <span key={i} className={cls}><i /></span>
          })}
        </div>
        <div className="qz-meta">
          <span className="qz-chip solid">{t.stage} {stage + 1}/{totalStages}</span>
          <span className="qz-chip">{t.q} {qi + 1}/{cur.length}</span>
          <StreakChip streak={streak} label={t.streak} />
          <span className="qz-spring" />
          <Ring secs={secs} left={revealing ? left : left} />
        </div>
      </div>

      <div className="qz-body">
        <div key={q.id} className="qz-qblock">
          <div className="qz-qcard">
            <span className="qz-fam"><Icon name={fam.icon} size={12} /> {t[fam.ar]}</span>
            <p className="qz-qtext">{q.text}</p>
          </div>
          <div className="qz-answers">
            {q.choices.map((c) => {
              const isAnswer = c.key === q.answer
              const isPicked = picked === c.key
              const isCut = cutKeys.includes(c.key)
              const state = revealing
                ? (isAnswer ? ' good' : (isPicked ? ' bad' : ' off'))
                : (isCut ? ' cut' : '')
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`qz-ans${state}`}
                  disabled={revealing || isCut}
                  onClick={() => resolve(c.key)}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
          {revealing && (
            <div className={`qz-reveal ${picked === q.answer ? 'good' : 'bad'}`}>
              <b>
                <Icon name={picked === q.answer ? 'ok' : 'no'} size={15} />
                {picked === '' ? t.timeout : picked === q.answer ? t.right : t.wrong}
                {picked !== q.answer ? ` — ${t.correctIs}: ${q.choices.find((c) => c.key === q.answer)?.label || ''}` : ''}
              </b>
              <p>{q.explain}</p>
            </div>
          )}
        </div>
      </div>

      <div className="qz-dock">
        {!revealing && (
          <>
            <button
              type="button"
              className="qz-life"
              disabled={cuts <= 0 || cutKeys.length > 0}
              onClick={useCut}
            >
              <Icon name="no" size={15} /> {t.cut}
              <span className="qz-pips">
                {Array.from({ length: CUTS }, (_, i) => <i key={i} className={i < cuts ? '' : 'used'} />)}
              </span>
            </button>
            {cutKeys.length > 0 && <span className="qz-note"><Icon name="ok" size={13} /> {t.cutDone}</span>}
            {cuts <= 0 && !cutKeys.length && <span className="qz-note" style={{ opacity: 0.55 }}>{t.cutNone}</span>}
          </>
        )}
        {revealing && (
          <button type="button" className="qz-btn" onClick={advance}>
            <Icon name={qi + 1 >= cur.length ? (stage + 1 >= totalStages ? 'award' : 'ok') : 'next'} size={16} />
            {qi + 1 >= cur.length ? (stage + 1 >= totalStages ? t.finishRun : t.endStage) : t.next}
          </button>
        )}
      </div>
    </div>
  )
}
