// «رتب الطلب» — a customer's order flashes on screen, then hides; the player
// taps the dishes back in the right order. A STAGE ladder (مراحل): every stage
// the order grows by a dish, more decoy dishes crowd the tray, and the
// memorize window shrinks. A wrong tap costs one of three tickets — run out and
// the shift ends. A perfect stage pays a bonus and moves you up.
//
// Built from the venue's REAL menu when it has enough items (photos included);
// with a thin menu it falls back to a fully generic dish set rather than mixing
// real and invented dishes together. Progress is saved through onProgress so a
// guest resumes at their stage with their score.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { play } from '../../lib/gameSounds.js'
import '../../styles/arcade-b.css'

const GAME_ID = 'orderRush'
const PROG_V = 2
const BEST_KEY = 'rbt_game_orderrush_best'
const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch (_) { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)) } catch (_) { /* private mode */ } }

const LIVES = 3
const PER_TAP = 10
const PERFECT_BONUS = 25
const MIN_REAL = 6

const seqLen = (stage, poolLen) => Math.min(Math.max(3, 2 + stage), 8, poolLen)
const extrasFor = (stage, poolLen, len) => Math.min(Math.max(0, poolLen - len), 2 + Math.floor(stage / 2))
const showMs = (len, stage) => Math.max(1100, len * 760 - stage * 110)

const GENERIC = [
  { id: 'g1', nameAr: 'كبسة', nameEn: 'Kabsa' },
  { id: 'g2', nameAr: 'شاورما', nameEn: 'Shawarma' },
  { id: 'g3', nameAr: 'حمص', nameEn: 'Hummus' },
  { id: 'g4', nameAr: 'فتوش', nameEn: 'Fattoush' },
  { id: 'g5', nameAr: 'سمبوسة', nameEn: 'Samosa' },
  { id: 'g6', nameAr: 'تبولة', nameEn: 'Tabbouleh' },
  { id: 'g7', nameAr: 'كنافة', nameEn: 'Kunafa' },
  { id: 'g8', nameAr: 'قهوة عربية', nameEn: 'Arabic coffee' },
  { id: 'g9', nameAr: 'عصير برتقال', nameEn: 'Orange juice' },
  { id: 'g10', nameAr: 'مندي', nameEn: 'Mandi' },
  { id: 'g11', nameAr: 'مطبق', nameEn: 'Mutabbaq' },
]

const TXT = {
  ar: {
    title: 'رتب الطلب',
    how: 'سيظهر طلب الزبون لثوانٍ ثم يختفي. المس الأصناف بنفس الترتيب. كل مرحلة أطول وأسرع وبمشتّتات أكثر — وخطأ واحد يكلّفك تذكرة.',
    start: 'ابدأ',
    again: 'من جديد',
    resume: 'تابع من المرحلة',
    fromStart: 'من البداية',
    memorize: 'احفظ الطلب',
    yourTurn: 'المس الأصناف بالترتيب',
    stage: 'المرحلة',
    perfect: 'ترتيب مثالي',
    missed: 'ترتيب غير صحيح',
    correctWas: 'الترتيب الصحيح',
    next: 'المرحلة التالية',
    over: 'انتهت المناوبة',
    reached: 'بلغت المرحلة',
    points: 'نقطة',
    best: 'أفضل نتيجة',
  },
  en: {
    title: 'Order Rush',
    how: 'The order shows for a few seconds, then hides. Tap the dishes in the same order.',
    start: 'Start',
    again: 'Play again',
    resume: 'Continue from stage',
    fromStart: 'From start',
    memorize: 'Memorize the order',
    yourTurn: 'Tap in order',
    stage: 'Stage',
    perfect: 'Perfect order',
    missed: 'Wrong order',
    correctWas: 'Correct order',
    next: 'Next stage',
    over: 'Shift over',
    reached: 'Reached stage',
    points: 'points',
    best: 'Best',
  },
}

// Hoisted on purpose: defined inside the component it would be a NEW component
// type every render, remounting every <img> and re-fetching the item photos.
function Tile({ it, idx, dim, mark, brand }) {
  return (
    <span className={`gb-tile${dim ? ' dim' : ''}${mark === 'bad' ? ' bad' : ''}${mark === 'good' ? ' good' : ''}`}>
      {it.imageUrl
        ? <img className="gb-tile-img" src={it.imageUrl} alt="" loading="lazy" />
        : <span className="gb-tile-img gb-tile-ph" style={{ background: brand }}><Icon name="coffee" size={20} /></span>}
      <span className="gb-tile-nm">{it.name}</span>
      {typeof idx === 'number' && <span className="gb-tile-no" style={{ background: brand }}>{idx + 1}</span>}
    </span>
  )
}

const shuffle = (a) => {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

export default function OrderRush({
  onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '',
  onProgress, resumeState,
}) {
  const t = TXT[lang] || TXT.ar
  const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])

  const nameOf = (it) => String((lang === 'en' ? it?.nameEn : it?.nameAr) || it?.nameAr || it?.nameEn || '').trim()

  const saved = useMemo(() => {
    const s = resumeState
    return s && s.game === GAME_ID && s.v === PROG_V && Number(s.stage) > 0 ? s : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Real menu when it is deep enough, otherwise an all-generic set (never mixed).
  const pool = useMemo(() => {
    const seen = new Set()
    const real = (items || [])
      .filter((i) => i && nameOf(i))
      .filter((i) => {
        const k = nameOf(i)
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      .map((i, n) => ({ id: String(i.id || `r${n}`), name: nameOf(i), imageUrl: i.imageUrl || '' }))
    if (real.length >= MIN_REAL) return real.slice(0, 16)
    return GENERIC.map((i) => ({ id: i.id, name: lang === 'en' ? i.nameEn : i.nameAr, imageUrl: '' }))
  }, [items, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const [phase, setPhase] = useState('intro') // intro | show | input | round | over
  const [stage, setStage] = useState(saved ? Number(saved.stage) : 1)
  const [lives, setLives] = useState(LIVES)
  const [seq, setSeq] = useState([])
  const [choices, setChoices] = useState([])
  const [picked, setPicked] = useState([])
  const [score, setScore] = useState(saved ? Number(saved.score) || 0 : 0)
  const [failed, setFailed] = useState(false)
  const [best, setBest] = useState(readBest)
  const timers = useRef([])
  const scoreRef = useRef(score)
  const stageRef = useRef(stage)
  const livesRef = useRef(LIVES)

  useEffect(() => { scoreRef.current = score }, [score])
  useEffect(() => { stageRef.current = stage }, [stage])
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  useEffect(() => () => clearTimers(), [])

  const report = (done, stageVal, scoreVal) => {
    try {
      onProgressRef.current?.({
        game: GAME_ID, v: PROG_V,
        stage: stageVal != null ? stageVal : stageRef.current,
        score: scoreVal != null ? scoreVal : scoreRef.current,
        done: !!done, completed: false, at: Date.now(),
      })
    } catch (_) { /* best-effort */ }
  }

  const beginStage = (n, currentScore) => {
    clearTimers()
    const len = seqLen(n, pool.length)
    const s = shuffle(pool).slice(0, len)
    const extras = shuffle(pool.filter((p) => !s.some((x) => x.id === p.id))).slice(0, extrasFor(n, pool.length, len))
    setSeq(s)
    setChoices(shuffle([...s, ...extras]))
    setPicked([])
    setFailed(false)
    setStage(n)
    stageRef.current = n
    if (typeof currentScore === 'number') { setScore(currentScore); scoreRef.current = currentScore }
    setPhase('show')
    play('deal')
    report(false, n) // resume point at the start of each stage
    timers.current.push(setTimeout(() => setPhase('input'), showMs(len, n)))
  }

  const start = (fromStage, fromScore) => {
    const n = Math.max(1, Math.floor(Number(fromStage) || 1))
    const sc = Math.max(0, Math.floor(Number(fromScore) || 0))
    setLives(LIVES)
    livesRef.current = LIVES
    setScore(sc)
    scoreRef.current = sc
    onScoreRef.current?.(sc)
    beginStage(n, sc)
  }

  const endGame = () => {
    clearTimers()
    setPhase('over')
    onScoreRef.current?.(scoreRef.current)
    if (scoreRef.current > readBest()) { writeBest(scoreRef.current); setBest(scoreRef.current) }
    report(true)
    play('lose')
  }

  const tap = (choice) => {
    if (phase !== 'input') return
    const step = picked.length
    const right = seq[step] && seq[step].id === choice.id
    const nextPicked = [...picked, { ...choice, right }]
    setPicked(nextPicked)
    if (!right) {
      play('lose', { gain: 0.5 })
      const nl = livesRef.current - 1
      livesRef.current = nl
      setLives(nl)
      setFailed(true)
      setPhase('round')
      return
    }
    play('move', { gain: 0.55 })
    const perfect = nextPicked.length === seq.length
    const gained = PER_TAP + (perfect ? PERFECT_BONUS : 0)
    const ns = scoreRef.current + gained
    scoreRef.current = ns
    setScore(ns)
    onScoreRef.current?.(ns)
    if (perfect) { play('win', { gain: 0.5 }); setPhase('round') }
  }

  const next = () => {
    if (livesRef.current <= 0) { endGame(); return }
    play('turn', { gain: 0.5 })
    beginStage(stageRef.current + 1)
  }

  return (
    <div className="gb-stage gb-dom" dir={lang === 'en' ? 'ltr' : 'rtl'} style={{ '--gm-brand': brand }}>
      {phase !== 'intro' && phase !== 'over' && (
        <div className="gb-hud">
          <span className="gb-chip arb-stage-pill">{t.stage} {fmt(stage)}</span>
          <span className="gmx-lives" aria-label={`${lives}`}>
            {[0, 1, 2].map((i) => <i key={i} className={`gmx-life${i < lives ? '' : ' off'}`} />)}
          </span>
        </div>
      )}

      {phase === 'intro' && (
        <div className="gb-card">
          <strong className="gb-title">{t.title}</strong>
          <p className="gb-line">{t.how}</p>
          {saved ? (
            <div className="arb-actions">
              <button type="button" className="gb-btn" style={{ background: brand }} onClick={() => start(Number(saved.stage), Number(saved.score) || 0)}>
                <Icon name="reload" size={16} /> {t.resume} {fmt(saved.stage)}
              </button>
              <button type="button" className="gb-btn ghost" onClick={() => start(1, 0)}>{t.fromStart}</button>
            </div>
          ) : (
            <button type="button" className="gb-btn" style={{ background: brand }} onClick={() => start(1, 0)}>
              <Icon name="play" size={16} /> {t.start}
            </button>
          )}
          {best > 0 && <p className="gb-line faint">{t.best} {fmt(best)}</p>}
        </div>
      )}

      {phase === 'over' && (
        <div className="gb-card">
          <strong className="gb-title">{t.over}</strong>
          <div className="arb-big" style={{ color: brand }}>{fmt(score)}</div>
          <p className="gb-line">{playerName ? `${playerName} — ` : ''}{t.reached} {fmt(stage)}</p>
          <p className="gb-line faint">{t.best} {fmt(Math.max(best, score))}</p>
          <div className="arb-actions">
            <button type="button" className="gb-btn" style={{ background: brand }} onClick={() => start(1, 0)}>
              <Icon name="repeat" size={16} /> {t.again}
            </button>
            {typeof onExit === 'function' && (
              <button type="button" className="gb-btn ghost" onClick={onExit}>إنهاء</button>
            )}
          </div>
        </div>
      )}

      {(phase === 'show' || phase === 'input' || phase === 'round') && (
        <div className="gb-pane">
          <p className="gb-step">
            {phase === 'show' ? t.memorize : phase === 'input' ? t.yourTurn : (failed ? t.missed : t.perfect)}
          </p>

          {phase === 'show' && (
            <>
              <div
                className="gb-timerbar"
                style={{ animationDuration: `${showMs(seq.length, stage)}ms`, background: 'rgba(255,255,255,0.12)' }}
              >
                <i style={{ background: brand }} />
              </div>
              <div className="gb-row">{seq.map((it, i) => <Tile key={it.id} it={it} idx={i} brand={brand} />)}</div>
            </>
          )}

          {phase === 'input' && (
            <>
              <div className="gb-slots">
                {seq.map((s, i) => (
                  <span key={s.id} className={`gb-slot${picked[i] ? ' filled' : ''}`} style={picked[i] ? { borderColor: brand } : undefined}>
                    {picked[i] ? picked[i].name : i + 1}
                  </span>
                ))}
              </div>
              <div className="gb-grid">
                {choices.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="gb-pick"
                    disabled={picked.some((p) => p.id === c.id)}
                    onClick={() => tap(c)}
                  >
                    <Tile it={c} brand={brand} dim={picked.some((p) => p.id === c.id)} />
                  </button>
                ))}
              </div>
            </>
          )}

          {phase === 'round' && (
            <>
              {failed && <p className="gb-line faint">{t.correctWas}</p>}
              <div className="gb-row">
                {seq.map((it, i) => (
                  <Tile key={it.id} it={it} idx={i} brand={brand} mark={picked[i] && picked[i].id === it.id ? 'good' : (failed && picked[i] ? 'bad' : undefined)} />
                ))}
              </div>
              <button type="button" className="gb-btn" style={{ background: brand }} onClick={next}>
                <Icon name={livesRef.current <= 0 ? 'award' : 'next'} size={16} /> {livesRef.current <= 0 ? t.over : t.next}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
