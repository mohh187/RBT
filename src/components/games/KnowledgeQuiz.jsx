// «موسوعة المعرفة» — a staged category quiz built on src/lib/quizBank.js.
//
// The useful part is the explanation after every answer: the player leaves the
// question knowing something, not just whether they were right. Nothing is
// generated here — every question, choice and explanation comes from the
// vetted bank, and when a category runs out of unseen questions the game says
// so plainly instead of repeating or inventing.
//
// Contract: renders ONLY the play area. The hub owns the shell, close button
// and live score. Progress is reported through onProgress and restored from
// resumeState — no Firestore access from here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { ALL_CATS, getQuestions, countByCat } from '../../lib/quizBank.js'
import '../../styles/knowledge.css'

export const GAME_ID = 'knowledgeQuiz'
const PER_STAGE = 10
const LIVES = 3

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
    streak: 'متتالية',
    right: 'إجابة صحيحة',
    wrong: 'إجابة خاطئة',
    timeout: 'انتهى الوقت',
    correctIs: 'الإجابة الصحيحة',
    next: 'السؤال التالي',
    endStage: 'إنهاء المرحلة',
    stageDone: 'انتهت المرحلة',
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
    streak: 'Streak',
    right: 'Correct',
    wrong: 'Wrong',
    timeout: 'Time up',
    correctIs: 'Correct answer',
    next: 'Next question',
    endStage: 'Finish stage',
    stageDone: 'Stage complete',
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
  },
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
  const [correct, setCorrect] = useState(saved ? Number(saved.correct) || 0 : 0)
  const [asked, setAsked] = useState(saved ? Number(saved.asked) || 0 : 0)
  const [picked, setPicked] = useState(null) // index | -1 on timeout
  const [left, setLeft] = useState(20)
  const [endReason, setEndReason] = useState('') // over | win | dry
  const [stageMarks, setStageMarks] = useState([])

  // ids already served this session — never repeated, even across stages
  const usedRef = useRef(new Set(Array.isArray(saved?.usedIds) ? saved.usedIds : []))
  // The set as of the START of the current stage. Mid-stage saves report THIS,
  // not usedRef: if the player quits half way we must not burn the ten
  // questions they only partly saw. It is promoted to usedRef only when the
  // stage actually completes.
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
      usedIds: [...preUsedRef.current],
      done: !!extra.done,
      at: Date.now(),
    })
  }, [cat, stage, score, lives, correct, asked])

  // Load one stage. Returns false when the bank has nothing unseen left — the
  // honest end of the run rather than a repeat.
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
    setStageMarks([])
    setPhase('q')
    return true
  }, [])

  const begin = useCallback((catId, stageIdx = 0, fresh = true) => {
    setCat(catId)
    setStage(stageIdx)
    if (fresh) {
      usedRef.current = new Set()
      preUsedRef.current = []
      setScore(0); setLives(LIVES); setCorrect(0); setAsked(0)
      onScoreRef.current?.(0)
    }
    setStreak(0)
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
    // resolve is stable enough for this effect; qi/phase drive it
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
    if (hit) {
      const speed = Math.round((Math.max(0, left) / secs) * 8)
      const gain = (10 + speed + Math.min(12, streak * 3)) * q.difficulty
      nextScore = score + gain
      nextCorrect = correct + 1
      setScore(nextScore)
      setStreak(streak + 1)
      setCorrect(nextCorrect)
      onScoreRef.current?.(nextScore)
    } else {
      nextLives = Math.max(0, lives - 1)
      setStreak(0)
      setLives(nextLives)
    }
    setPhase('reveal')
    report({ score: nextScore, lives: nextLives, correct: nextCorrect, asked: nextAsked })
  }

  const advance = () => {
    if (lives <= 0) { setEndReason('over'); setPhase('over'); report({ done: true }); return }
    if (qi + 1 < total) { setPicked(null); setQi(qi + 1); setPhase('q'); return }
    // the stage is finished, so its questions are now permanently consumed
    preUsedRef.current = [...usedRef.current]
    setPhase('stageEnd')
    report({ stage: stage + 1 })
  }

  const nextStage = () => {
    const ns = stage + 1
    if (ns >= stagesFor(cat)) { setEndReason('win'); setPhase('over'); report({ stage: ns, done: true }); return }
    setStage(ns)
    if (!loadStage(cat, ns)) { setEndReason('dry'); setPhase('over'); report({ stage: ns, done: true }) }
  }

  const totalStages = stagesFor(cat || 'mix')
  const accent = brand || '#0e7490'

  // ------------------------------------------------------------ views --
  if (phase === 'intro') {
    return (
      <div className="kn-card">
        <strong className="kn-title">{t.title}</strong>
        <p className="kn-line">{t.how}</p>
        <p className="kn-line faint">{t.note}{lang === 'en' ? ` ${t.enOnly}` : ''}</p>
        {saved && (
          <div className="kn-resume">
            <Icon name="reload" size={18} />
            <span>{t.resumeAt(catLabel(saved.cat), (Number(saved.stage) || 0) + 1)}</span>
          </div>
        )}
        {saved && (
          <button type="button" className="kn-btn" style={{ background: accent }} onClick={() => begin(saved.cat, Number(saved.stage) || 0, false)}>
            <Icon name="play" size={16} /> {t.resume}
          </button>
        )}
        <button
          type="button"
          className={saved ? 'kn-btn ghost' : 'kn-btn'}
          style={saved ? undefined : { background: accent }}
          onClick={() => setPhase('cats')}
        >
          <Icon name={saved ? 'repeat' : 'play'} size={16} /> {saved ? t.fresh : t.pick}
        </button>
      </div>
    )
  }

  if (phase === 'cats') {
    return (
      <div className="kn-card">
        <strong className="kn-title">{t.pick}</strong>
        <div className="kn-cats">
          <button type="button" className="kn-cat" onClick={() => begin('mix', 0, true)}>
            <i style={{ background: accent }}><Icon name="shapes" size={17} /></i>
            <span><u>{t.mix}</u><small>{t.mixDesc}</small></span>
          </button>
          {ALL_CATS.map((c) => (
            <button key={c.id} type="button" className="kn-cat" onClick={() => begin(c.id, 0, true)}>
              <i style={{ background: accent }}><Icon name={c.icon} size={17} /></i>
              <span><u>{lang === 'en' ? c.en : c.ar}</u><small>{counts[c.id]} {t.qsLeft}</small></span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (phase === 'stageEnd') {
    const hits = stageMarks.filter(Boolean).length
    return (
      <div className="kn-card">
        <strong className="kn-title">{t.stageDone}</strong>
        <span className="kn-big">{hits}/{stageMarks.length}</span>
        <p className="kn-line">{t.score}: <b>{score}</b> {t.points}</p>
        <p className="kn-line faint">{t.stage} {stage + 1} {t.of} {totalStages}</p>
        <button type="button" className="kn-btn" style={{ background: accent }} onClick={nextStage}>
          <Icon name="next" size={16} /> {stage + 1 >= totalStages ? t.endStage : t.goNext}
        </button>
      </div>
    )
  }

  if (phase === 'over') {
    return (
      <div className="kn-card">
        <strong className="kn-title">
          {endReason === 'win' ? t.win : endReason === 'dry' ? t.exhausted : t.over}
        </strong>
        <span className="kn-big">{score}</span>
        <p className="kn-line">{playerName ? `${playerName} — ` : ''}{correct} {t.of} {asked} {t.correctCount}</p>
        {endReason === 'dry' && <p className="kn-line faint">{t.exhaustedNote}</p>}
        <div className="kn-foot">
          <button type="button" className="kn-btn" style={{ background: accent }} onClick={() => begin(cat, 0, true)}>
            <Icon name="repeat" size={16} /> {t.again}
          </button>
          <button type="button" className="kn-btn ghost" onClick={() => setPhase('cats')}>
            <Icon name="grid" size={15} /> {t.change}
          </button>
        </div>
      </div>
    )
  }

  if (!q) return null
  const revealing = phase === 'reveal'

  return (
    <div className="kn-wrap">
      <div className="kn-top">
        <div className="kn-steps">
          {Array.from({ length: total }, (_, i) => {
            const mark = stageMarks[i]
            const cls = mark === undefined ? 'kn-step' : mark ? 'kn-step done' : 'kn-step miss'
            return <span key={i} className={cls}><i style={{ background: accent }} /></span>
          })}
        </div>
        <div className="kn-meta">
          <span className="kn-tag solid" style={{ background: accent }}>{catLabel(cat)}</span>
          <span className="kn-tag">{t.stage} {stage + 1}/{totalStages}</span>
          <span className="kn-tag">{t.q} {qi + 1}/{total}</span>
          <span className="kn-tag kn-lives">
            {Array.from({ length: LIVES }, (_, i) => (
              <i key={i} className={i < lives ? 'on' : ''}><Icon name="heart" size={12} /></i>
            ))}
          </span>
          {streak > 1 && <span className="kn-tag solid" style={{ background: accent }}>{t.streak} x{streak}</span>}
        </div>
        <div className="kn-timer">
          <i style={{ width: `${(Math.max(0, left) / secs) * 100}%`, background: left < 4 ? '#ff7a6b' : accent }} />
        </div>
      </div>

      <div className="kn-body">
        <p className="kn-q">{q.q}</p>
        <div className="kn-opts">
          {q.choices.map((label, i) => {
            const state = revealing ? (i === q.answer ? ' good' : (i === picked ? ' bad' : ' off')) : ''
            return (
              <button
                key={`${q.id}-${i}`}
                type="button"
                className={`kn-opt${state}`}
                disabled={revealing}
                onClick={() => resolve(i)}
              >
                {label}
              </button>
            )
          })}
        </div>
        {revealing && (
          <div className={`kn-reveal ${picked === q.answer ? 'good' : 'bad'}`}>
            <b className={picked === q.answer ? 'good' : 'bad'}>
              {picked === -1 ? t.timeout : picked === q.answer ? t.right : t.wrong}
              {picked !== q.answer ? ` — ${t.correctIs}: ${q.choices[q.answer]}` : ''}
            </b>
            <p>{q.explain}</p>
          </div>
        )}
      </div>

      <div className="kn-foot">
        {revealing && (
          <button type="button" className="kn-btn" style={{ background: accent }} onClick={advance}>
            <Icon name={lives <= 0 ? 'award' : qi + 1 >= total ? 'ok' : 'next'} size={16} />
            {lives <= 0 ? t.over : qi + 1 >= total ? t.endStage : t.next}
          </button>
        )}
      </div>
    </div>
  )
}
