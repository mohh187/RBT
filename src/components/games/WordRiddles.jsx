// «سلّم الكلمات» — an Arabic vocabulary and riddle ladder built on the word
// bank in src/lib/puzzleBank.js: synonyms, antonyms, missing letters, proverb
// completion, folk riddles and singular/plural forms.
//
// Every item is curated with a short note explaining WHY the answer is the
// answer (the dictionary meaning, the morphological pattern, the logic of the
// riddle), so a wrong guess still teaches something.
//
// Premium layer (PACK C): a countdown ring per item, a streak meter, a stage
// map on entry, the point-costed hint as the game's one lifeline, a rich reveal
// and an end-of-run summary. Chrome lives in src/styles/quizzes.css.
//
// Contract: play area only. Stages rebuild deterministically from
// (seed, stageIndex), so resumeState restores the exact same ladder.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { play } from '../../lib/gameSounds.js'
import { buildWordStage, WORD_STAGE_COUNT, WORD_FAMILIES } from '../../lib/puzzleBank.js'
import '../../styles/quizzes.css'

export const GAME_ID = 'wordRiddles'
const PER_STAGE = 6
const HINT_COST = 6
const SECONDS = 25

const TXT = {
  ar: {
    title: 'سلّم الكلمات',
    how: 'ثماني مراحل من ألغاز اللغة: المرادف والضد، الحرف الناقص، إكمال المثل، الألغاز الشعبية، والجمع والمفرد.',
    note: 'خمس وعشرون ثانية لكل سؤال. التلميح متاح ويخصم نقاطاً، وتقدّمك يُحفظ بعد كل إجابة.',
    start: 'ابدأ',
    resume: 'استكمل من حيث توقفت',
    resumeAt: (s) => `توقفت عند المرحلة ${s}`,
    fresh: 'ابدأ جديداً',
    stage: 'المرحلة',
    of: 'من',
    item: 'سؤال',
    hint: 'تلميح',
    hintCost: `تلميح (-${HINT_COST})`,
    next: 'التالي',
    endStage: 'إنهاء المرحلة',
    stageDone: 'أُنجزت المرحلة',
    goNext: 'المرحلة التالية',
    right: 'إجابة صحيحة',
    wrong: 'إجابة خاطئة',
    timeout: 'انتهى الوقت',
    correctIs: 'الصحيح',
    over: 'اكتمل السلّم',
    points: 'نقطة',
    solved: 'إجابات صحيحة',
    again: 'من البداية',
    accuracy: 'الدقة',
    bestStreak: 'أطول تتابع',
    stageReached: 'أعلى مرحلة',
    stMeter: ['متتالية', 'ملتهب', 'متّقد', 'أسطوري'],
  },
  en: {
    title: 'Word Ladder',
    how: 'Eight stages of Arabic language puzzles: synonyms and antonyms, missing letters, proverbs, folk riddles and plurals.',
    note: 'Twenty-five seconds per item. A hint costs points. Progress saves after every answer.',
    start: 'Start',
    resume: 'Resume where you stopped',
    resumeAt: (s) => `You stopped at stage ${s}`,
    fresh: 'Start fresh',
    stage: 'Stage',
    of: 'of',
    item: 'Item',
    hint: 'Hint',
    hintCost: `Hint (-${HINT_COST})`,
    next: 'Next',
    endStage: 'Finish stage',
    stageDone: 'Stage cleared',
    goNext: 'Next stage',
    right: 'Correct',
    wrong: 'Wrong',
    timeout: 'Time up',
    correctIs: 'Correct',
    over: 'Ladder complete',
    points: 'points',
    solved: 'correct',
    again: 'Start over',
    accuracy: 'accuracy',
    bestStreak: 'Best streak',
    stageReached: 'Stage reached',
    stMeter: ['Streak', 'On fire', 'Blazing', 'Legendary'],
  },
}

// The word laid out letter by letter with one slot blanked. Letters are
// rendered isolated on purpose — a connected Arabic word would hide the shape
// of the missing letter.
function LetterRow({ art }) {
  if (!art || art.type !== 'letters') return null
  return (
    <div className="qz-letters">
      {art.letters.map((ch, i) => (
        <b key={i} className={i === art.blank ? 'gap' : ''}>{i === art.blank ? '؟' : ch}</b>
      ))}
    </div>
  )
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

const newSeed = () => Math.floor(Math.random() * 1e9) + 1

export default function WordRiddles({
  onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '',
  tenant = null, onProgress, resumeState,
}) {
  const t = TXT[lang] || TXT.ar
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])

  const saved = resumeState && resumeState.game === GAME_ID && resumeState.seed ? resumeState : null

  const [phase, setPhase] = useState('intro') // intro | q | reveal | stageEnd | over
  const [seed, setSeed] = useState(saved ? Number(saved.seed) : newSeed())
  const [stage, setStage] = useState(saved ? Number(saved.stage) || 0 : 0)
  const [pool, setPool] = useState([])
  const [pi, setPi] = useState(0)
  const [score, setScore] = useState(saved ? Number(saved.score) || 0 : 0)
  const [solved, setSolved] = useState(saved ? Number(saved.solved) || 0 : 0)
  const [attempted, setAttempted] = useState(saved ? Number(saved.attempted) || 0 : 0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(saved ? Number(saved.bestStreak) || 0 : 0)
  const [picked, setPicked] = useState(null) // index | -1 timeout
  const [hintOn, setHintOn] = useState(false)
  const [marks, setMarks] = useState([])
  const [left, setLeft] = useState(SECONDS)

  const usedRef = useRef(new Set(Array.isArray(saved?.usedIds) ? saved.usedIds : []))
  const preUsedRef = useRef(Array.isArray(saved?.usedIds) ? [...saved.usedIds] : [])
  const p = pool[pi] || null
  const accent = brand || '#0e7490'

  const famLabel = useMemo(() => {
    const map = { prv: '', wrd: '' }
    WORD_FAMILIES.forEach((f) => { map[f.id] = f.ar })
    map.prv = map.proverb
    map.wrd = map.riddle
    map.frm = map.form
    return map
  }, [])

  const report = useCallback((extra = {}) => {
    onProgressRef.current?.({
      game: GAME_ID,
      v: 1,
      seed,
      stage: extra.stage !== undefined ? extra.stage : stage,
      score: extra.score !== undefined ? extra.score : score,
      solved: extra.solved !== undefined ? extra.solved : solved,
      attempted: extra.attempted !== undefined ? extra.attempted : attempted,
      bestStreak: extra.bestStreak !== undefined ? extra.bestStreak : bestStreak,
      usedIds: [...preUsedRef.current],
      done: !!extra.done,
      at: Date.now(),
    })
  }, [seed, stage, score, solved, attempted, bestStreak])

  const loadStage = useCallback((sd, stageIdx) => {
    const st = buildWordStage(stageIdx, PER_STAGE, sd, usedRef.current)
    if (!st.length) return false
    st.forEach((x) => usedRef.current.add(x.id))
    setPool(st)
    setPi(0)
    setPicked(null)
    setHintOn(false)
    setMarks([])
    setPhase('q')
    play('deal')
    return true
  }, [])

  const begin = useCallback((fresh) => {
    const sd = fresh ? newSeed() : seed
    const st = fresh ? 0 : stage
    if (fresh) {
      usedRef.current = new Set()
      preUsedRef.current = []
      setSeed(sd)
      setScore(0); setSolved(0); setAttempted(0); setBestStreak(0)
      onScoreRef.current?.(0)
    }
    setStage(st)
    setStreak(0)
    if (!loadStage(sd, st)) setPhase('over')
  }, [seed, stage, loadStage])

  // countdown; running out scores nothing and breaks the streak
  useEffect(() => {
    if (phase !== 'q' || !p) return undefined
    setLeft(SECONDS)
    const t0 = Date.now()
    const iv = setInterval(() => {
      const rem = SECONDS - (Date.now() - t0) / 1000
      if (rem <= 0) { clearInterval(iv); setLeft(0); resolve(-1) }
      else setLeft(rem)
    }, 100)
    return () => clearInterval(iv)
  }, [phase, pi]) // eslint-disable-line react-hooks/exhaustive-deps

  function resolve(idx) {
    if (!p) return
    const hit = idx === p.answer
    setPicked(idx)
    setMarks((m) => [...m, hit])
    const nextAttempted = attempted + 1
    setAttempted(nextAttempted)

    let nextScore = score
    let nextSolved = solved
    let nextBest = bestStreak
    if (hit) {
      const speed = Math.round((Math.max(0, left) / SECONDS) * 6)
      const gain = Math.max(4, p.points - (hintOn ? HINT_COST : 0)) + speed + Math.min(10, streak * 2)
      nextScore = score + gain
      nextSolved = solved + 1
      const ns = streak + 1
      nextBest = Math.max(bestStreak, ns)
      setScore(nextScore)
      setSolved(nextSolved)
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
    report({ score: nextScore, solved: nextSolved, attempted: nextAttempted, bestStreak: nextBest })
  }

  const advance = () => {
    if (pi + 1 < pool.length) {
      setPicked(null); setHintOn(false); setPi(pi + 1); setPhase('q')
      return
    }
    preUsedRef.current = [...usedRef.current]
    setPhase('stageEnd')
    play('win', { gain: 0.7 })
    report({ stage: stage + 1 })
  }

  const nextStage = () => {
    const ns = stage + 1
    if (ns >= WORD_STAGE_COUNT) { setPhase('over'); report({ stage: ns, done: true }); play('win'); return }
    setStage(ns)
    setStreak(0)
    if (!loadStage(seed, ns)) { setPhase('over'); report({ stage: ns, done: true }) }
  }

  const useHint = () => {
    if (hintOn) return
    setHintOn(true)
    const ns = Math.max(0, score - HINT_COST)
    setScore(ns)
    onScoreRef.current?.(ns)
    play('card')
  }

  const accPct = attempted ? Math.round((solved / attempted) * 100) : 0

  // ------------------------------------------------------------ views --
  if (phase === 'intro') {
    return (
      <div className="qz-root" style={{ '--qz-brand': accent }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="qz-card">
          <span className="qz-crest brand"><Icon name="text" size={34} /></span>
          <strong className="qz-title">{t.title}</strong>
          <p className="qz-line">{t.how}</p>
          <p className="qz-line faint">{t.note}</p>
          {saved && (
            <>
              <StageMap total={WORD_STAGE_COUNT} current={Number(saved.stage) || 0} cleared={Number(saved.stage) || 0} />
              <div className="qz-resume">
                <span className="qz-ci"><Icon name="reload" size={18} /></span>
                <span>{t.resumeAt((Number(saved.stage) || 0) + 1)}</span>
              </div>
              <button type="button" className="qz-btn gold" onClick={() => begin(false)}>
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
    return (
      <div className="qz-root" style={{ '--qz-brand': accent }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="qz-card">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="qz-spark" style={{ '--sx': `${(i - 2.5) * 26}px`, '--sy': '-46px', left: `${44 + i * 3}%`, animationDelay: `${i * 60}ms` }} />
          ))}
          <span className="qz-crest"><Icon name="award" size={34} /></span>
          <strong className="qz-title">{t.stageDone}</strong>
          <span className="qz-big">{hits}/{marks.length}</span>
          <StageMap total={WORD_STAGE_COUNT} current={stage + 1} cleared={stage + 1} />
          <p className="qz-line">{score} {t.points}</p>
          <button type="button" className="qz-btn gold" onClick={nextStage}>
            <Icon name={stage + 1 >= WORD_STAGE_COUNT ? 'award' : 'next'} size={16} /> {stage + 1 >= WORD_STAGE_COUNT ? t.endStage : t.goNext}
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
          <AccRing pct={accPct} label={t.accuracy} />
          <div className="qz-stats">
            <div className="qz-stat"><span className="qz-ci"><Icon name="star" size={16} /></span><b>{score}</b><span>{t.points}</span></div>
            <div className="qz-stat"><span className="qz-ci"><Icon name="flame" size={16} /></span><b>{bestStreak}</b><span>{t.bestStreak}</span></div>
            <div className="qz-stat"><span className="qz-ci"><Icon name="trending" size={16} /></span><b>{Math.min(stage + 1, WORD_STAGE_COUNT)}</b><span>{t.stageReached}</span></div>
          </div>
          <p className="qz-line faint">{solved} {t.of} {attempted} {t.solved}</p>
          <button type="button" className="qz-btn gold" onClick={() => begin(true)}>
            <Icon name="repeat" size={16} /> {t.again}
          </button>
        </div>
      </div>
    )
  }

  if (!p) return null
  const revealing = phase === 'reveal'
  const frac = Math.max(0, left) / SECONDS
  const danger = left < 5

  return (
    <div className="qz-root" style={{ '--qz-brand': accent }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="qz-wrap">
        <div className="qz-hud">
          <div className="qz-pips">
            {Array.from({ length: pool.length }, (_, i) => {
              const mark = marks[i]
              const cls = mark === undefined ? (i === pi ? 'qz-pip cur' : 'qz-pip') : mark ? 'qz-pip done' : 'qz-pip miss'
              return <span key={i} className={cls}><i /></span>
            })}
          </div>
          <div className="qz-meta">
            <span className="qz-chip solid">{t.stage} {stage + 1}/{WORD_STAGE_COUNT}</span>
            {famLabel[p.family] && <span className="qz-chip">{famLabel[p.family]}</span>}
            <StreakMeter streak={streak} labels={t.stMeter} />
            <span className="qz-spacer" />
            <Ring frac={frac} secs={Math.max(0, Math.ceil(left))} danger={danger} />
          </div>
        </div>

        <div className="qz-body">
          <div className="qz-plate">
            <span className="qz-kicker"><Icon name="text" size={13} /> {t.item} {pi + 1}/{pool.length}</span>
            <p className="qz-q">{p.prompt}</p>
            {p.art && <div style={{ marginTop: 12 }}><LetterRow art={p.art} /></div>}
            {p.sub && <p className="qz-sub">{p.sub}</p>}
          </div>
          <div className="qz-opts">
            {p.choices.map((c, i) => {
              const state = revealing ? (i === p.answer ? ' good' : (i === picked ? ' bad' : ' off')) : ''
              return (
                <button
                  key={`${p.id}-${i}`}
                  type="button"
                  className={`qz-opt${state}`}
                  disabled={revealing}
                  onClick={() => resolve(i)}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
          {hintOn && !revealing && (
            <div className="qz-reveal">
              <span className="qz-reveal-h"><Icon name="zap" size={15} /> {t.hint}</span>
              <p>{p.hint}</p>
            </div>
          )}
          {revealing && (
            <div className={`qz-reveal ${picked === p.answer ? 'good' : 'bad'}`}>
              <span className={`qz-reveal-h ${picked === p.answer ? 'good' : 'bad'}`}>
                <Icon name={picked === p.answer ? 'ok' : 'warning'} size={15} />
                {picked === -1 ? t.timeout : picked === p.answer ? t.right : t.wrong}
              </span>
              {picked !== p.answer && <span className="qz-correct-was">{t.correctIs}: {p.choices[p.answer].label}</span>}
              <p>{p.explain}</p>
            </div>
          )}
        </div>

        <div className="qz-foot">
          {phase === 'q' && !hintOn && (
            <button type="button" className="qz-btn ghost live" onClick={useHint}>
              <Icon name="zap" size={15} /> {t.hintCost}
            </button>
          )}
          {revealing && (
            <button type="button" className="qz-btn" onClick={advance}>
              <Icon name={pi + 1 >= pool.length ? 'ok' : 'next'} size={16} />
              {pi + 1 >= pool.length ? t.endStage : t.next}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
