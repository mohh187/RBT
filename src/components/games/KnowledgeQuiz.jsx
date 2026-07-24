// «موسوعة المعرفة» — a staged category quiz built on src/lib/quizBank.js.
//
// The useful part is the explanation after every answer: the player leaves the
// question knowing something, not just whether they were right. Nothing is
// generated here — every question, choice and explanation comes from the
// vetted bank, and when a category runs out of unseen questions the game says
// so plainly instead of repeating or inventing.
//
// Premium layer (PACK C): a countdown ring per question, a streak meter with
// escalating feedback, a «50:50» lifeline that removes two wrong answers
// (local, no new data), a stage map on entry, a rich answer reveal and an
// end-of-run summary. All chrome lives in src/styles/quizzes.css.
//
// Contract: renders ONLY the play area. The hub owns the shell, close button
// and live score. Progress is reported through onProgress and restored from
// resumeState — no Firestore access from here.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { play } from '../../lib/gameSounds.js'
import { ALL_CATS, getQuestions, countByCat } from '../../lib/quizBank.js'
import '../../styles/quizzes.css'

export const GAME_ID = 'knowledgeQuiz'
const PER_STAGE = 10
const LIVES = 3
const LIFELINES = 2

const stagesFor = (cat) => (cat === 'mix' ? 6 : 4)
const stageDiff = (s) => (s <= 0 ? [1] : s === 1 ? [1, 2] : s === 2 ? [2] : s === 3 ? [2, 3] : [3])
const stageSeconds = (s) => Math.max(12, 20 - s * 2)

const TXT = {
  ar: {
    title: 'موسوعة المعرفة',
    how: 'اختر مجالاً، ثم مراحل متتابعة من عشرة أسئلة ترتفع صعوبتها. بعد كل إجابة تظهر معلومة قصيرة موثّقة.',
    note: 'ثلاث محاولات فقط: كل إجابة خاطئة أو انتهاء وقت يكلّفك محاولة.',
    pick: 'اختر المجال',
    mix: 'منوّع',
    mixDesc: 'من كل المجالات',
    q: 'سؤال',
    stage: 'المرحلة',
    points: 'نقطة',
    right: 'إجابة صحيحة',
    wrong: 'إجابة خاطئة',
    timeout: 'انتهى الوقت',
    correctIs: 'الصحيح',
    next: 'السؤال التالي',
    endStage: 'إنهاء المرحلة',
    stageDone: 'أُنجزت المرحلة',
    goNext: 'المرحلة التالية',
    over: 'انتهت المحاولات',
    win: 'أكملت كل المراحل',
    exhausted: 'أكملت كل أسئلة هذا المجال',
    exhaustedNote: 'لن نكرر عليك سؤالاً رأيته، ولن نخترع أسئلة جديدة. جرّب مجالاً آخر أو الوضع المنوّع.',
    again: 'من البداية',
    change: 'تغيير المجال',
    resume: 'استكمل من حيث توقفت',
    resumeAt: (c, s) => `توقفت في «${c}» عند المرحلة ${s}`,
    fresh: 'ابدأ جديداً',
    score: 'النتيجة',
    of: 'من',
    correctCount: 'إجابات صحيحة',
    qsLeft: 'سؤالاً',
    enOnly: 'الأسئلة بالعربية.',
    fifty: '50:50',
    fiftyLeft: (n) => `50:50 (${n})`,
    removed: 'أُزيلت إجابتان خاطئتان.',
    accuracy: 'الدقة',
    bestStreak: 'أطول تتابع',
    stageReached: 'أعلى مرحلة',
    stMeter: ['متتالية', 'ملتهب', 'متّقد', 'أسطوري'],
  },
  en: {
    title: 'Knowledge Library',
    how: 'Pick a field, then climb stages of ten questions. A short verified fact follows every answer.',
    note: 'Three lives: a wrong answer or a timeout costs one.',
    pick: 'Pick a field',
    mix: 'Mixed',
    mixDesc: 'All fields',
    q: 'Question',
    stage: 'Stage',
    points: 'points',
    right: 'Correct',
    wrong: 'Wrong',
    timeout: 'Time up',
    correctIs: 'Correct',
    next: 'Next question',
    endStage: 'Finish stage',
    stageDone: 'Stage cleared',
    goNext: 'Next stage',
    over: 'Out of lives',
    win: 'All stages complete',
    exhausted: 'You finished every question in this field',
    exhaustedNote: 'We never repeat a question you have seen, and we never invent new ones. Try another field or Mixed.',
    again: 'Start over',
    change: 'Change field',
    resume: 'Resume where you stopped',
    resumeAt: (c, s) => `You stopped in "${c}" at stage ${s}`,
    fresh: 'Start fresh',
    score: 'Score',
    of: 'of',
    correctCount: 'correct',
    qsLeft: 'questions',
    enOnly: 'Questions are written in Arabic.',
    fifty: '50:50',
    fiftyLeft: (n) => `50:50 (${n})`,
    removed: 'Two wrong answers removed.',
    accuracy: 'accuracy',
    bestStreak: 'Best streak',
    stageReached: 'Stage reached',
    stMeter: ['Streak', 'On fire', 'Blazing', 'Legendary'],
  },
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
              <span className="qz-medal">{done ? <Icon name="check" size={16} /> : i + 1}</span>
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

export default function KnowledgeQuiz({
  onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '',
  tenant = null, onProgress, resumeState,
}) {
  const t = TXT[lang] || TXT.ar
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])

  const counts = useMemo(() => countByCat(), [])
  const saved = resumeState && resumeState.game === GAME_ID && resumeState.cat ? resumeState : null

  const [phase, setPhase] = useState('intro') // intro | cats | q | reveal | stageEnd | over
  const [cat, setCat] = useState(saved ? saved.cat : null)
  const [stage, setStage] = useState(saved ? Number(saved.stage) || 0 : 0)
  const [pool, setPool] = useState([])
  const [qi, setQi] = useState(0)
  const [score, setScore] = useState(saved ? Number(saved.score) || 0 : 0)
  const [lives, setLives] = useState(saved ? Number(saved.lives) || LIVES : LIVES)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(saved ? Number(saved.bestStreak) || 0 : 0)
  const [correct, setCorrect] = useState(saved ? Number(saved.correct) || 0 : 0)
  const [asked, setAsked] = useState(saved ? Number(saved.asked) || 0 : 0)
  const [picked, setPicked] = useState(null) // index | -1 on timeout
  const [left, setLeft] = useState(20)
  const [endReason, setEndReason] = useState('') // over | win | dry
  const [stageMarks, setStageMarks] = useState([])
  const [removed, setRemoved] = useState(() => new Set())
  const [lifelines, setLifelines] = useState(LIFELINES)

  // ids already served this session — never repeated, even across stages
  const usedRef = useRef(new Set(Array.isArray(saved?.usedIds) ? saved.usedIds : []))
  const preUsedRef = useRef(Array.isArray(saved?.usedIds) ? [...saved.usedIds] : [])

  const catLabel = useCallback((id) => {
    if (id === 'mix') return t.mix
    const c = ALL_CATS.find((x) => x.id === id)
    return c ? (lang === 'en' ? c.en : c.ar) : ''
  }, [lang, t.mix])

  const report = useCallback((extra = {}) => {
    onProgressRef.current?.({
      game: GAME_ID,
      v: 1,
      cat: extra.cat !== undefined ? extra.cat : cat,
      stage: extra.stage !== undefined ? extra.stage : stage,
      score: extra.score !== undefined ? extra.score : score,
      lives: extra.lives !== undefined ? extra.lives : lives,
      correct: extra.correct !== undefined ? extra.correct : correct,
      asked: extra.asked !== undefined ? extra.asked : asked,
      bestStreak: extra.bestStreak !== undefined ? extra.bestStreak : bestStreak,
      usedIds: [...preUsedRef.current],
      done: !!extra.done,
      at: Date.now(),
    })
  }, [cat, stage, score, lives, correct, asked, bestStreak])

  const loadStage = useCallback((catId, stageIdx) => {
    const qs = getQuestions({
      cat: catId,
      difficulty: stageDiff(stageIdx),
      count: PER_STAGE,
      exclude: usedRef.current,
    })
    if (!qs.length) return false
    qs.forEach((q) => usedRef.current.add(q.id))
    setPool(qs)
    setQi(0)
    setPicked(null)
    setRemoved(new Set())
    setStageMarks([])
    setPhase('q')
    play('deal')
    return true
  }, [])

  const begin = useCallback((catId, stageIdx = 0, fresh = true) => {
    setCat(catId)
    setStage(stageIdx)
    if (fresh) {
      usedRef.current = new Set()
      preUsedRef.current = []
      setScore(0); setLives(LIVES); setCorrect(0); setAsked(0); setBestStreak(0)
      onScoreRef.current?.(0)
    }
    setStreak(0)
    setLifelines(LIFELINES)
    if (!loadStage(catId, stageIdx)) { setEndReason('dry'); setPhase('over') }
  }, [loadStage])

  const q = pool[qi] || null
  const total = pool.length
  const secs = stageSeconds(stage)

  // per-question countdown
  useEffect(() => {
    if (phase !== 'q' || !q) return undefined
    setLeft(secs)
    const t0 = Date.now()
    const iv = setInterval(() => {
      const rem = secs - (Date.now() - t0) / 1000
      if (rem <= 0) { clearInterval(iv); setLeft(0); resolve(-1) }
      else setLeft(rem)
    }, 100)
    return () => clearInterval(iv)
  }, [phase, qi, secs]) // eslint-disable-line react-hooks/exhaustive-deps

  function resolve(idx) {
    if (!q) return
    const hit = idx === q.answer
    setPicked(idx)
    setStageMarks((m) => [...m, hit])
    const nextAsked = asked + 1
    setAsked(nextAsked)

    let nextScore = score
    let nextLives = lives
    let nextCorrect = correct
    let nextBest = bestStreak
    if (hit) {
      const speed = Math.round((Math.max(0, left) / secs) * 8)
      const gain = (10 + speed + Math.min(12, streak * 3)) * q.difficulty
      nextScore = score + gain
      nextCorrect = correct + 1
      const ns = streak + 1
      nextBest = Math.max(bestStreak, ns)
      setScore(nextScore)
      setStreak(ns)
      setCorrect(nextCorrect)
      setBestStreak(nextBest)
      onScoreRef.current?.(nextScore)
      play('win', { gain: 0.4 })
      if (ns % 3 === 0) play('turn', { gain: 0.5 })
    } else {
      nextLives = Math.max(0, lives - 1)
      setStreak(0)
      setLives(nextLives)
      play(idx === -1 ? 'lose' : 'lose', { gain: 0.5 })
    }
    setPhase('reveal')
    report({ score: nextScore, lives: nextLives, correct: nextCorrect, asked: nextAsked, bestStreak: nextBest })
  }

  const advance = () => {
    if (lives <= 0) { setEndReason('over'); setPhase('over'); report({ done: true }); play('lose'); return }
    if (qi + 1 < total) { setPicked(null); setRemoved(new Set()); setQi(qi + 1); setPhase('q'); return }
    // the stage is finished, so its questions are now permanently consumed
    preUsedRef.current = [...usedRef.current]
    setPhase('stageEnd')
    play('win', { gain: 0.7 })
    report({ stage: stage + 1 })
  }

  const nextStage = () => {
    const ns = stage + 1
    if (ns >= stagesFor(cat)) { setEndReason('win'); setPhase('over'); report({ stage: ns, done: true }); play('win'); return }
    setStage(ns)
    setStreak(0)
    if (!loadStage(cat, ns)) { setEndReason('dry'); setPhase('over'); report({ stage: ns, done: true }) }
  }

  const useFifty = () => {
    if (phase !== 'q' || !q || lifelines <= 0 || removed.size) return
    const wrong = q.choices.map((_, i) => i).filter((i) => i !== q.answer)
    for (let i = wrong.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[wrong[i], wrong[j]] = [wrong[j], wrong[i]] }
    setRemoved(new Set(wrong.slice(0, 2)))
    setLifelines((n) => n - 1)
    play('card')
  }

  const totalStages = stagesFor(cat || 'mix')
  const accent = brand || '#0e7490'
  const pct = asked ? Math.round((correct / asked) * 100) : 0

  // ------------------------------------------------------------ views --
  if (phase === 'intro') {
    return (
      <div className="qz-root" style={{ '--qz-brand': accent }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="qz-card">
          <span className="qz-crest brand"><Icon name="notepad" size={34} /></span>
          <strong className="qz-title">{t.title}</strong>
          <p className="qz-line">{t.how}</p>
          <p className="qz-line faint">{t.note}{lang === 'en' ? ` ${t.enOnly}` : ''}</p>
          {saved && (
            <>
              <StageMap total={stagesFor(saved.cat)} current={Number(saved.stage) || 0} cleared={Number(saved.stage) || 0} />
              <div className="qz-resume">
                <span className="qz-ci"><Icon name="reload" size={18} /></span>
                <span>{t.resumeAt(catLabel(saved.cat), (Number(saved.stage) || 0) + 1)}</span>
              </div>
              <button type="button" className="qz-btn gold" onClick={() => begin(saved.cat, Number(saved.stage) || 0, false)}>
                <Icon name="play" size={16} /> {t.resume}
              </button>
            </>
          )}
          <button
            type="button"
            className={saved ? 'qz-btn ghost' : 'qz-btn'}
            onClick={() => setPhase('cats')}
          >
            <Icon name={saved ? 'repeat' : 'play'} size={16} /> {saved ? t.fresh : t.pick}
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'cats') {
    return (
      <div className="qz-root" style={{ '--qz-brand': accent }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="qz-card">
          <strong className="qz-title">{t.pick}</strong>
          <div className="qz-cats">
            <button type="button" className="qz-cat" onClick={() => begin('mix', 0, true)}>
              <i className="qz-ci"><Icon name="shapes" size={18} /></i>
              <span><u>{t.mix}</u><small>{t.mixDesc}</small></span>
            </button>
            {ALL_CATS.map((c) => (
              <button key={c.id} type="button" className="qz-cat" onClick={() => begin(c.id, 0, true)}>
                <i className="qz-ci"><Icon name={c.icon} size={18} /></i>
                <span><u>{lang === 'en' ? c.en : c.ar}</u><small>{counts[c.id]} {t.qsLeft}</small></span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'stageEnd') {
    const hits = stageMarks.filter(Boolean).length
    return (
      <div className="qz-root" style={{ '--qz-brand': accent }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="qz-card">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="qz-spark" style={{ '--sx': `${(i - 2.5) * 26}px`, '--sy': '-46px', left: `${44 + i * 3}%`, animationDelay: `${i * 60}ms` }} />
          ))}
          <span className="qz-crest"><Icon name="award" size={34} /></span>
          <strong className="qz-title">{t.stageDone}</strong>
          <span className="qz-big">{hits}/{stageMarks.length}</span>
          <StageMap total={totalStages} current={stage + 1} cleared={stage + 1} />
          <p className="qz-line">{t.score}: <b>{score}</b> {t.points}</p>
          <button type="button" className="qz-btn gold" onClick={nextStage}>
            <Icon name={stage + 1 >= totalStages ? 'award' : 'next'} size={16} /> {stage + 1 >= totalStages ? t.endStage : t.goNext}
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'over') {
    return (
      <div className="qz-root" style={{ '--qz-brand': accent }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="qz-card">
          <span className={`qz-crest${endReason === 'win' ? '' : ' brand'}`}>
            <Icon name={endReason === 'win' ? 'award' : endReason === 'dry' ? 'ok' : 'heart'} size={34} />
          </span>
          <strong className="qz-title">
            {endReason === 'win' ? t.win : endReason === 'dry' ? t.exhausted : t.over}
          </strong>
          {playerName ? <p className="qz-line">{playerName}</p> : null}
          <AccRing pct={pct} label={t.accuracy} />
          <div className="qz-stats">
            <div className="qz-stat"><span className="qz-ci"><Icon name="star" size={16} /></span><b>{score}</b><span>{t.points}</span></div>
            <div className="qz-stat"><span className="qz-ci"><Icon name="flame" size={16} /></span><b>{bestStreak}</b><span>{t.bestStreak}</span></div>
            <div className="qz-stat"><span className="qz-ci"><Icon name="trending" size={16} /></span><b>{Math.min(stage + 1, totalStages)}</b><span>{t.stageReached}</span></div>
          </div>
          <p className="qz-line faint">{correct} {t.of} {asked} {t.correctCount}</p>
          {endReason === 'dry' && <p className="qz-line faint">{t.exhaustedNote}</p>}
          <div className="qz-foot-2">
            <button type="button" className="qz-btn gold" onClick={() => begin(cat, 0, true)}>
              <Icon name="repeat" size={16} /> {t.again}
            </button>
            <button type="button" className="qz-btn ghost" onClick={() => setPhase('cats')}>
              <Icon name="grid" size={15} /> {t.change}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!q) return null
  const revealing = phase === 'reveal'
  const frac = Math.max(0, left) / secs
  const danger = left < 4

  return (
    <div className="qz-root" style={{ '--qz-brand': accent }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="qz-wrap">
        <div className="qz-hud">
          <div className="qz-pips">
            {Array.from({ length: total }, (_, i) => {
              const mark = stageMarks[i]
              const cls = mark === undefined ? (i === qi ? 'qz-pip cur' : 'qz-pip') : mark ? 'qz-pip done' : 'qz-pip miss'
              return <span key={i} className={cls}><i /></span>
            })}
          </div>
          <div className="qz-meta">
            <span className="qz-chip solid">{catLabel(cat)}</span>
            <span className="qz-chip">{t.stage} {stage + 1}/{totalStages}</span>
            <span className="qz-lives" aria-label="lives">
              {Array.from({ length: LIVES }, (_, i) => (
                <span key={i} className={`qz-life${i < lives ? ' on' : ' lost'}`}><Icon name="heart" size={15} /></span>
              ))}
            </span>
            <StreakMeter streak={streak} labels={t.stMeter} />
            <span className="qz-spacer" />
            <Ring frac={frac} secs={Math.max(0, Math.ceil(left))} danger={danger} />
          </div>
        </div>

        <div className="qz-body">
          <div className="qz-plate">
            <span className="qz-kicker"><Icon name="notepad" size={13} /> {t.q} {qi + 1}/{total}</span>
            <p className="qz-q">{q.q}</p>
          </div>
          <div className="qz-opts">
            {q.choices.map((label, i) => {
              const gone = removed.has(i)
              const state = revealing
                ? (i === q.answer ? ' good' : (i === picked ? ' bad' : ' off'))
                : (gone ? ' gone' : '')
              return (
                <button
                  key={`${q.id}-${i}`}
                  type="button"
                  className={`qz-opt${state}`}
                  disabled={revealing || gone}
                  onClick={() => resolve(i)}
                >
                  {label}
                </button>
              )
            })}
          </div>
          {revealing && (
            <div className={`qz-reveal ${picked === q.answer ? 'good' : 'bad'}`}>
              <span className={`qz-reveal-h ${picked === q.answer ? 'good' : 'bad'}`}>
                <Icon name={picked === q.answer ? 'ok' : 'warning'} size={15} />
                {picked === -1 ? t.timeout : picked === q.answer ? t.right : t.wrong}
              </span>
              {picked !== q.answer && <span className="qz-correct-was">{t.correctIs}: {q.choices[q.answer]}</span>}
              <p>{q.explain}</p>
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
              <Icon name={lives <= 0 ? 'heart' : qi + 1 >= total ? 'ok' : 'next'} size={16} />
              {lives <= 0 ? t.over : qi + 1 >= total ? t.endStage : t.next}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
