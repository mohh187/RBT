// «سلّم الكلمات» — an Arabic vocabulary and riddle ladder built on the word
// bank in src/lib/puzzleBank.js: synonyms, antonyms, missing letters, proverb
// completion, folk riddles and singular/plural forms.
//
// Every item is curated with a short note explaining WHY the answer is the
// answer (the dictionary meaning, the morphological pattern, the logic of the
// riddle), so a wrong guess still teaches something.
//
// Contract: play area only. Stages rebuild deterministically from
// (seed, stageIndex), so resumeState restores the exact same ladder.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { buildWordStage, WORD_STAGE_COUNT, WORD_FAMILIES } from '../../lib/puzzleBank.js'
import '../../styles/knowledge.css'

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
    stageDone: 'انتهت المرحلة',
    goNext: 'المرحلة التالية',
    right: 'إجابة صحيحة',
    wrong: 'إجابة خاطئة',
    timeout: 'انتهى الوقت',
    correctIs: 'الصحيح',
    over: 'اكتمل السلّم',
    points: 'نقطة',
    solved: 'إجابات صحيحة',
    again: 'من البداية',
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
    stageDone: 'Stage complete',
    goNext: 'Next stage',
    right: 'Correct',
    wrong: 'Wrong',
    timeout: 'Time up',
    correctIs: 'Correct',
    over: 'Ladder complete',
    points: 'points',
    solved: 'correct',
    again: 'Start over',
  },
}

// The only art this game needs: the word laid out letter by letter with one
// slot blanked. Letters are rendered isolated on purpose — a connected Arabic
// word would hide the shape of the missing letter.
function LetterRow({ art }) {
  if (!art || art.type !== 'letters') return null
  return (
    <div className="kn-letters">
      {art.letters.map((ch, i) => (
        <b key={i} className={i === art.blank ? 'gap' : ''}>{i === art.blank ? '؟' : ch}</b>
      ))}
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
  const [picked, setPicked] = useState(null) // index | -1 timeout
  const [hintOn, setHintOn] = useState(false)
  const [marks, setMarks] = useState([])
  const [left, setLeft] = useState(SECONDS)

  const usedRef = useRef(new Set(Array.isArray(saved?.usedIds) ? saved.usedIds : []))
  // Snapshot as of the start of the current stage — see BrainPuzzles for why:
  // mid-stage saves must not consume the items the player only half saw.
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
      usedIds: [...preUsedRef.current],
      done: !!extra.done,
      at: Date.now(),
    })
  }, [seed, stage, score, solved, attempted])

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
    if (hit) {
      const speed = Math.round((Math.max(0, left) / SECONDS) * 6)
      const gain = Math.max(4, p.points - (hintOn ? HINT_COST : 0)) + speed + Math.min(10, streak * 2)
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
      setPicked(null); setHintOn(false); setPi(pi + 1); setPhase('q')
      return
    }
    preUsedRef.current = [...usedRef.current]
    setPhase('stageEnd')
    report({ stage: stage + 1 })
  }

  const nextStage = () => {
    const ns = stage + 1
    if (ns >= WORD_STAGE_COUNT) { setPhase('over'); report({ stage: ns, done: true }); return }
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
        <p className="kn-line faint">{t.stage} {stage + 1} {t.of} {WORD_STAGE_COUNT}</p>
        <button type="button" className="kn-btn" style={{ background: accent }} onClick={nextStage}>
          <Icon name="next" size={16} /> {stage + 1 >= WORD_STAGE_COUNT ? t.endStage : t.goNext}
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
          <span className="kn-tag solid" style={{ background: accent }}>{t.stage} {stage + 1}/{WORD_STAGE_COUNT}</span>
          <span className="kn-tag">{t.item} {pi + 1}/{pool.length}</span>
          {famLabel[p.family] && <span className="kn-tag">{famLabel[p.family]}</span>}
          {streak > 1 && <span className="kn-tag solid" style={{ background: accent }}>x{streak}</span>}
        </div>
        <div className="kn-timer">
          <i style={{ width: `${(Math.max(0, left) / SECONDS) * 100}%`, background: left < 5 ? '#ff7a6b' : accent }} />
        </div>
      </div>

      <div className="kn-body">
        <p className="kn-q">{p.prompt}</p>
        {p.art && <LetterRow art={p.art} />}
        {p.sub && <p className="kn-sub">{p.sub}</p>}
        <div className="kn-opts">
          {p.choices.map((c, i) => {
            const state = revealing ? (i === p.answer ? ' good' : (i === picked ? ' bad' : ' off')) : ''
            return (
              <button
                key={`${p.id}-${i}`}
                type="button"
                className={`kn-opt${state}`}
                disabled={revealing}
                onClick={() => resolve(i)}
              >
                {c.label}
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
              {picked === -1 ? t.timeout : picked === p.answer ? t.right : t.wrong}
              {picked !== p.answer ? ` — ${t.correctIs}: ${p.choices[p.answer].label}` : ''}
            </b>
            <p>{p.explain}</p>
          </div>
        )}
      </div>

      <div className="kn-foot">
        {phase === 'q' && !hintOn && (
          <button type="button" className="kn-btn ghost" onClick={useHint}>
            <Icon name="zap" size={15} /> {t.hintCost}
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
