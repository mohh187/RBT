// «تحدي الذكاء» — escalating logic stages built on src/lib/puzzleBank.js.
//
// Families: sequences, odd-one-out, verbal analogies, matchstick grids
// (stick / square / rectangle counts from closed formulas), arithmetic
// reasoning, spatial rotation of polyominoes, memory span and lateral-thinking
// riddles. Every answer is computed or curated in the bank — this file only
// presents it.
//
// Stages are rebuilt deterministically from (seed, stageIndex), so resuming
// restores the EXACT same puzzles the player left behind.
//
// Contract: play area only. onProgress persists, resumeState restores. No
// Firestore access from here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { buildStage, STAGE_COUNT, PUZZLE_FAMILIES, stageLevel } from '../../lib/puzzleBank.js'
import '../../styles/knowledge.css'

export const GAME_ID = 'brainPuzzles'
const PER_STAGE = 6
const HINT_COST = 8

const TXT = {
  ar: {
    title: 'تحدي الذكاء',
    how: 'ثماني مراحل ترتفع صعوبتها: متتاليات، شاذ من مجموعة، تناظر لفظي، أعواد ومربعات، استدلال حسابي، تدوير أشكال، مدى الذاكرة وألغاز تفكير جانبي.',
    note: 'التلميح متاح دائماً، لكنه يخصم من نقاط اللغز. تقدّمك يُحفظ بعد كل إجابة.',
    start: 'ابدأ',
    resume: 'استكمل من حيث توقفت',
    resumeAt: (s) => `توقفت عند المرحلة ${s}`,
    fresh: 'ابدأ جديداً',
    stage: 'المرحلة',
    of: 'من',
    puzzle: 'لغز',
    level: 'المستوى',
    hint: 'تلميح',
    hintCost: `تلميح (-${HINT_COST})`,
    skip: 'تخطّي',
    next: 'التالي',
    endStage: 'إنهاء المرحلة',
    stageDone: 'انتهت المرحلة',
    goNext: 'المرحلة التالية',
    right: 'إجابة صحيحة',
    wrong: 'إجابة خاطئة',
    skipped: 'تخطّيت اللغز',
    correctIs: 'الصحيح',
    over: 'اكتمل التحدي',
    points: 'نقطة',
    solved: 'ألغاز محلولة',
    again: 'من البداية',
    memWatch: 'احفظ التسلسل',
    memReady: 'استعد',
  },
  en: {
    title: 'Brain Puzzles',
    how: 'Eight rising stages: sequences, odd-one-out, analogies, stick grids, arithmetic reasoning, spatial rotation, memory span and lateral thinking.',
    note: 'A hint is always available but costs points. Progress saves after every answer.',
    start: 'Start',
    resume: 'Resume where you stopped',
    resumeAt: (s) => `You stopped at stage ${s}`,
    fresh: 'Start fresh',
    stage: 'Stage',
    of: 'of',
    puzzle: 'Puzzle',
    level: 'Level',
    hint: 'Hint',
    hintCost: `Hint (-${HINT_COST})`,
    skip: 'Skip',
    next: 'Next',
    endStage: 'Finish stage',
    stageDone: 'Stage complete',
    goNext: 'Next stage',
    right: 'Correct',
    wrong: 'Wrong',
    skipped: 'Skipped',
    correctIs: 'Correct',
    over: 'Challenge complete',
    points: 'points',
    solved: 'solved',
    again: 'Start over',
    memWatch: 'Memorize the sequence',
    memReady: 'Get ready',
  },
}

// ---------------------------------------------------------------- art ----
export function PuzzleArt({ art, color = '#ffd98a', small = false }) {
  if (!art) return null

  if (art.type === 'grid') {
    const n = art.n
    const cell = n <= 3 ? 32 : n === 4 ? 26 : 22
    const s = n * cell
    const pad = 3
    const box = s + pad * 2
    return (
      <div className="kn-art">
        <svg viewBox={`0 0 ${box} ${box}`} width={box} height={box} role="img" aria-hidden="true">
          {Array.from({ length: n + 1 }, (_, i) => (
            <line key={`h${i}`} x1={pad} y1={pad + i * cell} x2={pad + s} y2={pad + i * cell} className="kn-line-s" />
          ))}
          {Array.from({ length: n + 1 }, (_, i) => (
            <line key={`v${i}`} x1={pad + i * cell} y1={pad} x2={pad + i * cell} y2={pad + s} className="kn-line-s" />
          ))}
        </svg>
      </div>
    )
  }

  if (art.type === 'poly') {
    const c = small ? 15 : 20
    const w = art.w * c
    const h = art.h * c
    return (
      <div className="kn-art">
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ color }} role="img" aria-hidden="true">
          {art.cells.map(([r, cc], i) => (
            <rect key={i} x={cc * c + 1} y={r * c + 1} width={c - 2} height={c - 2} rx={3} className="kn-cell" />
          ))}
        </svg>
      </div>
    )
  }

  if (art.type === 'letters') {
    return (
      <div className="kn-letters">
        {art.letters.map((ch, i) => (
          <b key={i} className={i === art.blank ? 'gap' : ''}>{i === art.blank ? '؟' : ch}</b>
        ))}
      </div>
    )
  }

  return null
}

const newSeed = () => Math.floor(Math.random() * 1e9) + 1

export default function BrainPuzzles({
  onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '',
  tenant = null, onProgress, resumeState,
}) {
  const t = TXT[lang] || TXT.ar
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])

  const saved = resumeState && resumeState.game === GAME_ID && resumeState.seed ? resumeState : null

  const [phase, setPhase] = useState('intro') // intro | flash | q | reveal | stageEnd | over
  const [seed, setSeed] = useState(saved ? Number(saved.seed) : newSeed())
  const [stage, setStage] = useState(saved ? Number(saved.stage) || 0 : 0)
  const [pool, setPool] = useState([])
  const [pi, setPi] = useState(0)
  const [score, setScore] = useState(saved ? Number(saved.score) || 0 : 0)
  const [solved, setSolved] = useState(saved ? Number(saved.solved) || 0 : 0)
  const [attempted, setAttempted] = useState(saved ? Number(saved.attempted) || 0 : 0)
  const [streak, setStreak] = useState(0)
  const [picked, setPicked] = useState(null) // index | -1 skipped
  const [hintOn, setHintOn] = useState(false)
  const [marks, setMarks] = useState([])

  const usedRef = useRef(new Set(Array.isArray(saved?.usedIds) ? saved.usedIds : []))
  // Snapshot as of the start of the current stage. Mid-stage saves report THIS
  // one, so a resume rebuilds the very same stage from (seed, stage) instead of
  // regenerating a different one out of a half-consumed pool.
  const preUsedRef = useRef(Array.isArray(saved?.usedIds) ? [...saved.usedIds] : [])
  const p = pool[pi] || null
  const accent = brand || '#0e7490'
  const famLabel = useMemo(() => {
    const map = {}
    PUZZLE_FAMILIES.forEach((f) => { map[f.id] = lang === 'en' ? f.en : f.ar })
    return map
  }, [lang])

  const report = useCallback((extra = {}) => {
    onProgressRef.current?.({
      game: GAME_ID,
      v: 1,
      seed,
      stage: extra.stage !== undefined ? extra.stage : stage,
      score: extra.score !== undefined ? extra.score : score,
      solved: extra.solved !== undefined ? extra.solved : solved,
      attempted: extra.attempted !== undefined ? extra.attempted : attempted,
      usedIds: [...preUsedRef.current],
      done: !!extra.done,
      at: Date.now(),
    })
  }, [seed, stage, score, solved, attempted])

  const loadStage = useCallback((sd, stageIdx) => {
    const st = buildStage(stageIdx, PER_STAGE, sd, usedRef.current)
    if (!st.length) return false
    st.forEach((x) => usedRef.current.add(x.id))
    setPool(st)
    setPi(0)
    setPicked(null)
    setHintOn(false)
    setMarks([])
    setPhase(st[0].kind === 'memory' ? 'flash' : 'q')
    return true
  }, [])

  const begin = useCallback((fresh) => {
    const sd = fresh ? newSeed() : seed
    const st = fresh ? 0 : stage
    if (fresh) {
      usedRef.current = new Set()
      preUsedRef.current = []
      setSeed(sd)
      setScore(0); setSolved(0); setAttempted(0)
      onScoreRef.current?.(0)
    }
    setStage(st)
    setStreak(0)
    if (!loadStage(sd, st)) { setPhase('over') }
  }, [seed, stage, loadStage])

  // memory puzzles flash their sequence, then the question appears
  useEffect(() => {
    if (phase !== 'flash' || !p) return undefined
    const ms = p.showMs || 2500
    const id = setTimeout(() => setPhase('q'), ms)
    return () => clearTimeout(id)
  }, [phase, p])

  const resolve = (idx) => {
    if (!p || phase !== 'q') return
    const hit = idx === p.answer
    setPicked(idx)
    setMarks((m) => [...m, hit])
    const nextAttempted = attempted + 1
    setAttempted(nextAttempted)

    let nextScore = score
    let nextSolved = solved
    if (hit) {
      const gain = Math.max(4, p.points - (hintOn ? HINT_COST : 0)) + Math.min(10, streak * 2)
      nextScore = score + gain
      nextSolved = solved + 1
      setScore(nextScore)
      setSolved(nextSolved)
      setStreak(streak + 1)
      onScoreRef.current?.(nextScore)
    } else {
      setStreak(0)
    }
    setPhase('reveal')
    report({ score: nextScore, solved: nextSolved, attempted: nextAttempted })
  }

  const advance = () => {
    if (pi + 1 < pool.length) {
      const nxt = pool[pi + 1]
      setPicked(null)
      setHintOn(false)
      setPi(pi + 1)
      setPhase(nxt.kind === 'memory' ? 'flash' : 'q')
      return
    }
    preUsedRef.current = [...usedRef.current]
    setPhase('stageEnd')
    report({ stage: stage + 1 })
  }

  const nextStage = () => {
    const ns = stage + 1
    if (ns >= STAGE_COUNT) { setPhase('over'); report({ stage: ns, done: true }); return }
    setStage(ns)
    if (!loadStage(seed, ns)) { setPhase('over'); report({ stage: ns, done: true }) }
  }

  const useHint = () => {
    if (hintOn) return
    setHintOn(true)
    const ns = Math.max(0, score - HINT_COST)
    setScore(ns)
    onScoreRef.current?.(ns)
  }

  // ------------------------------------------------------------ views --
  if (phase === 'intro') {
    return (
      <div className="kn-card">
        <strong className="kn-title">{t.title}</strong>
        <p className="kn-line">{t.how}</p>
        <p className="kn-line faint">{t.note}</p>
        {saved && (
          <>
            <div className="kn-resume">
              <Icon name="reload" size={18} />
              <span>{t.resumeAt((Number(saved.stage) || 0) + 1)}</span>
            </div>
            <button type="button" className="kn-btn" style={{ background: accent }} onClick={() => begin(false)}>
              <Icon name="play" size={16} /> {t.resume}
            </button>
          </>
        )}
        <button
          type="button"
          className={saved ? 'kn-btn ghost' : 'kn-btn'}
          style={saved ? undefined : { background: accent }}
          onClick={() => begin(true)}
        >
          <Icon name={saved ? 'repeat' : 'play'} size={16} /> {saved ? t.fresh : t.start}
        </button>
      </div>
    )
  }

  if (phase === 'stageEnd') {
    const hits = marks.filter(Boolean).length
    return (
      <div className="kn-card">
        <strong className="kn-title">{t.stageDone}</strong>
        <span className="kn-big">{hits}/{marks.length}</span>
        <p className="kn-line">{score} {t.points}</p>
        <p className="kn-line faint">{t.stage} {stage + 1} {t.of} {STAGE_COUNT}</p>
        <button type="button" className="kn-btn" style={{ background: accent }} onClick={nextStage}>
          <Icon name="next" size={16} /> {stage + 1 >= STAGE_COUNT ? t.endStage : t.goNext}
        </button>
      </div>
    )
  }

  if (phase === 'over') {
    return (
      <div className="kn-card">
        <strong className="kn-title">{t.over}</strong>
        <span className="kn-big">{score}</span>
        <p className="kn-line">{playerName ? `${playerName} — ` : ''}{solved} {t.of} {attempted} {t.solved}</p>
        <button type="button" className="kn-btn" style={{ background: accent }} onClick={() => begin(true)}>
          <Icon name="repeat" size={16} /> {t.again}
        </button>
      </div>
    )
  }

  if (!p) return null
  const revealing = phase === 'reveal'
  const flashing = phase === 'flash'
  const artChoices = p.choices.some((c) => c.art)

  return (
    <div className="kn-wrap">
      <div className="kn-top">
        <div className="kn-steps">
          {Array.from({ length: pool.length }, (_, i) => {
            const mark = marks[i]
            const cls = mark === undefined ? 'kn-step' : mark ? 'kn-step done' : 'kn-step miss'
            return <span key={i} className={cls}><i style={{ background: accent }} /></span>
          })}
        </div>
        <div className="kn-meta">
          <span className="kn-tag solid" style={{ background: accent }}>{t.stage} {stage + 1}/{STAGE_COUNT}</span>
          <span className="kn-tag">{t.puzzle} {pi + 1}/{pool.length}</span>
          <span className="kn-tag">{famLabel[p.family] || ''}</span>
          <span className="kn-tag">{t.level} {stageLevel(stage)}</span>
          {streak > 1 && <span className="kn-tag solid" style={{ background: accent }}>x{streak}</span>}
        </div>
      </div>

      <div className="kn-body">
        {flashing ? (
          <>
            <p className="kn-sub">{t.memWatch}</p>
            <span className="kn-flash">{p.show}</span>
          </>
        ) : (
          <>
            <p className="kn-q">{p.prompt}</p>
            {p.sub && <p className="kn-sub"><span className="kn-seq">{p.sub}</span></p>}
            {p.art && <PuzzleArt art={p.art} color={accent} />}
            <div className={`kn-opts${artChoices ? ' art' : ''}`}>
              {p.choices.map((c, i) => {
                const state = revealing ? (i === p.answer ? ' good' : (i === picked ? ' bad' : ' off')) : ''
                return (
                  <button
                    key={`${p.id}-${i}`}
                    type="button"
                    className={`kn-opt${artChoices ? ' art' : ''}${state}`}
                    disabled={revealing}
                    onClick={() => resolve(i)}
                  >
                    {c.art ? <PuzzleArt art={c.art} color={accent} small /> : c.label}
                  </button>
                )
              })}
            </div>
            {hintOn && !revealing && (
              <div className="kn-reveal">
                <b>{t.hint}</b>
                <p>{p.hint}</p>
              </div>
            )}
            {revealing && (
              <div className={`kn-reveal ${picked === p.answer ? 'good' : 'bad'}`}>
                <b className={picked === p.answer ? 'good' : 'bad'}>
                  {picked === -1 ? t.skipped : picked === p.answer ? t.right : t.wrong}
                  {picked !== p.answer && !artChoices ? ` — ${t.correctIs}: ${p.choices[p.answer].label}` : ''}
                </b>
                <p>{p.explain}</p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="kn-foot">
        {phase === 'q' && !hintOn && (
          <button type="button" className="kn-btn ghost" onClick={useHint}>
            <Icon name="zap" size={15} /> {t.hintCost}
          </button>
        )}
        {phase === 'q' && (
          <button type="button" className="kn-btn ghost" onClick={() => resolve(-1)}>
            <Icon name="next" size={15} /> {t.skip}
          </button>
        )}
        {revealing && (
          <button type="button" className="kn-btn" style={{ background: accent }} onClick={advance}>
            <Icon name={pi + 1 >= pool.length ? 'ok' : 'next'} size={16} />
            {pi + 1 >= pool.length ? t.endStage : t.next}
          </button>
        )}
      </div>
    </div>
  )
}
