// «رتب الطلب» — a customer's order flashes on screen, then hides; the player
// taps the dishes back in the right order. Five rounds grow from three items to
// seven while the memorization window shrinks.
//
// Built from the venue's REAL menu when it has enough items (photos included);
// with a thin menu it falls back to a fully generic dish set rather than mixing
// real and invented dishes together.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'

const ROUNDS = [3, 4, 5, 6, 7]
const PER_TAP = 10
const PERFECT_BONUS = 25
const MIN_REAL = 6

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
]

const TXT = {
  ar: {
    title: 'رتب الطلب',
    how: 'سيظهر طلب الزبون لثوانٍ ثم يختفي. المس الأصناف بنفس الترتيب. خمس جولات تبدأ بثلاثة أصناف وتنتهي بسبعة.',
    start: 'ابدأ',
    again: 'جولة جديدة',
    memorize: 'احفظ الطلب',
    yourTurn: 'المس الأصناف بالترتيب',
    round: 'الجولة',
    score: 'النتيجة',
    perfect: 'ترتيب مثالي',
    missed: 'ترتيب غير صحيح',
    correctWas: 'الترتيب الصحيح',
    next: 'الجولة التالية',
    over: 'انتهت اللعبة',
    points: 'نقطة',
    finish: 'عرض النتيجة',
  },
  en: {
    title: 'Order Rush',
    how: 'The order shows for a few seconds, then hides. Tap the dishes in the same order.',
    start: 'Start',
    again: 'Play again',
    memorize: 'Memorize the order',
    yourTurn: 'Tap in order',
    round: 'Round',
    score: 'Score',
    perfect: 'Perfect order',
    missed: 'Wrong order',
    correctWas: 'Correct order',
    next: 'Next round',
    over: 'Game over',
    points: 'points',
    finish: 'See result',
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

export default function OrderRush({ onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '' }) {
  const t = TXT[lang] || TXT.ar
  const onScoreRef = useRef(onScore)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])

  const nameOf = (it) => String((lang === 'en' ? it?.nameEn : it?.nameAr) || it?.nameAr || it?.nameEn || '').trim()

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
    if (real.length >= MIN_REAL) return real.slice(0, 14)
    return GENERIC.map((i) => ({ id: i.id, name: lang === 'en' ? i.nameEn : i.nameAr, imageUrl: '' }))
  }, [items, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const [phase, setPhase] = useState('intro') // intro | show | input | round | over
  const [roundIdx, setRoundIdx] = useState(0)
  const [seq, setSeq] = useState([])
  const [choices, setChoices] = useState([])
  const [picked, setPicked] = useState([])
  const [score, setScore] = useState(0)
  const [failed, setFailed] = useState(false)
  const timers = useRef([])

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  useEffect(() => () => clearTimers(), [])

  const showMs = (len, idx) => Math.max(1200, len * 780 - idx * 160)

  const beginRound = (idx, currentScore) => {
    clearTimers()
    const len = Math.min(ROUNDS[idx] ?? 3, pool.length)
    const s = shuffle(pool).slice(0, len)
    const extras = shuffle(pool.filter((p) => !s.some((x) => x.id === p.id))).slice(0, Math.min(3, Math.max(0, pool.length - len)))
    setSeq(s)
    setChoices(shuffle([...s, ...extras]))
    setPicked([])
    setFailed(false)
    setRoundIdx(idx)
    if (typeof currentScore === 'number') setScore(currentScore)
    setPhase('show')
    timers.current.push(setTimeout(() => setPhase('input'), showMs(len, idx)))
  }

  const start = () => {
    setScore(0)
    onScoreRef.current?.(0)
    beginRound(0, 0)
  }

  const tap = (choice) => {
    if (phase !== 'input') return
    const step = picked.length
    const right = seq[step] && seq[step].id === choice.id
    const nextPicked = [...picked, { ...choice, right }]
    setPicked(nextPicked)
    if (!right) {
      setFailed(true)
      setPhase('round')
      return
    }
    const gained = PER_TAP + (nextPicked.length === seq.length ? PERFECT_BONUS : 0)
    const ns = score + gained
    setScore(ns)
    onScoreRef.current?.(ns)
    if (nextPicked.length === seq.length) setPhase('round')
  }

  const next = () => {
    if (roundIdx + 1 >= ROUNDS.length) {
      setPhase('over')
      onScoreRef.current?.(score)
    } else {
      beginRound(roundIdx + 1)
    }
  }

  const lastRound = roundIdx + 1 >= ROUNDS.length

  return (
    <div className="gb-stage gb-dom">
      {/* the hub's title bar owns the live score — only game-specific state here */}
      {phase !== 'intro' && phase !== 'over' && (
        <div className="gb-hud">
          <span className="gb-chip">{t.round} {roundIdx + 1}/{ROUNDS.length}</span>
        </div>
      )}

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
          <button type="button" className="gb-btn" style={{ background: brand }} onClick={start}>
            <Icon name="repeat" size={16} /> {t.again}
          </button>
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
                style={{ animationDuration: `${showMs(seq.length, roundIdx)}ms`, background: 'rgba(255,255,255,0.12)' }}
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
                <Icon name={lastRound ? 'award' : 'next'} size={16} /> {lastRound ? t.finish : t.next}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
