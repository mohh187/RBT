// «مطابقة التوابل» — SpiceMatch: a memory-match board where every tile is a
// hand-drawn spice (inline SVG paths, never an emoji): هيل، زعفران، قرفة،
// كمون، زنجبيل، قرنفل، سماق، نعناع، كركم، حبة البركة. Level one is a 4x4
// board, every level after is 4x5, the peek gets shorter, the clock gets
// tighter, and consecutive matches build a streak multiplier.
//
// CONTRACT (hub-rendered): fills its parent, play area only, ABSOLUTE score via
// onScore(). DEVIATION NOTE: this game is pure DOM/SVG, so it runs on one 1s
// interval instead of a rAF loop — nothing is animated per frame, and the
// interval is torn down with the component.
import { useEffect, useRef, useState } from 'react'

const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

const BEST_KEY = 'rbt_game_spicematch_best'
const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch (_) { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)) } catch (_) { /* private mode */ } }

const SPICES = [
  { id: 'hail', name: 'هيل', bg: '#eef7e4', ring: '#8fbf6a' },
  { id: 'zafaran', name: 'زعفران', bg: '#fdeee9', ring: '#d1462c' },
  { id: 'qirfa', name: 'قرفة', bg: '#f7ebe0', ring: '#a9673a' },
  { id: 'kammun', name: 'كمون', bg: '#f6f0e3', ring: '#b98a52' },
  { id: 'zanjabil', name: 'زنجبيل', bg: '#fbf3e2', ring: '#d9b169' },
  { id: 'qurunful', name: 'قرنفل', bg: '#efe7e0', ring: '#6b4423' },
  { id: 'summaq', name: 'سماق', bg: '#f7e6e6', ring: '#8e2b2b' },
  { id: 'nana', name: 'نعناع', bg: '#e6f6ec', ring: '#3f9e5e' },
  { id: 'kurkum', name: 'كركم', bg: '#fdf2da', ring: '#e0a11a' },
  { id: 'baraka', name: 'حبة البركة', bg: '#eceef2', ring: '#2f3440' },
]

// Every spice is drawn with paths so the board stays emoji-free and prints
// crisply at any tile size.
function SpiceArt({ id }) {
  switch (id) {
    case 'hail':
      return (
        <svg viewBox="0 0 40 40" className="gmsm-art" focusable="false" aria-hidden="true">
          <ellipse cx="20" cy="22" rx="8.5" ry="12.5" fill="#9ccb74" />
          <path d="M20 9.5v25M13.5 14c2.2 5.6 2.2 13 0 16.5M26.5 14c-2.2 5.6-2.2 13 0 16.5" stroke="#5e8f3c" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M20 9.5c0-3 1.2-4.2 3-5.2" stroke="#5e8f3c" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        </svg>
      )
    case 'zafaran':
      return (
        <svg viewBox="0 0 40 40" className="gmsm-art" focusable="false" aria-hidden="true">
          <path d="M9 32c3.5-10 6.5-15 12-20M16 33c2.5-9 5-13.5 9.5-17.5M23 33.5c1.5-7.5 3.5-11.5 7-14.5" stroke="#c8341f" strokeWidth="2.8" fill="none" strokeLinecap="round" />
          <path d="M21 12l2.5-3.5M25.5 15.5l3-3.5M30 19l3.2-2.6" stroke="#e2603f" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        </svg>
      )
    case 'qirfa':
      return (
        <svg viewBox="0 0 40 40" className="gmsm-art" focusable="false" aria-hidden="true">
          <rect x="6.5" y="13" width="27" height="14" rx="7" fill="#a9673a" />
          <path d="M12 14.5v11M16.5 14v12M21 14.5v11" stroke="#844925" strokeOpacity=".55" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M33.5 20a5 5 0 1 0-10 0 3.2 3.2 0 0 0 6.4 0" stroke="#7d4726" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      )
    case 'kammun':
      return (
        <svg viewBox="0 0 40 40" className="gmsm-art" focusable="false" aria-hidden="true">
          <g fill="#b98a52">
            <ellipse cx="13" cy="14" rx="2.4" ry="6" transform="rotate(-24 13 14)" />
            <ellipse cx="26" cy="13" rx="2.4" ry="6" transform="rotate(20 26 13)" />
            <ellipse cx="20" cy="21" rx="2.6" ry="6.6" transform="rotate(-4 20 21)" />
            <ellipse cx="11" cy="28" rx="2.4" ry="6" transform="rotate(34 11 28)" />
            <ellipse cx="28" cy="28" rx="2.4" ry="6" transform="rotate(-30 28 28)" />
          </g>
          <g stroke="#8b6537" strokeWidth="0.9" fill="none">
            <path d="M13 9v10M26 8v10M20 15v12M11 23v10M28 23v10" opacity=".55" />
          </g>
        </svg>
      )
    case 'zanjabil':
      return (
        <svg viewBox="0 0 40 40" className="gmsm-art" focusable="false" aria-hidden="true">
          <path d="M8 24c0-5 4-8 8-7.5 1-4 5-6 8-4s3 6 1 8c3 1 5 4 4 7s-5 5-8 3c-2 3-6 3.5-9 1.5S8 27 8 24z" fill="#dcb478" />
          <path d="M16 16.5c1.5 3 1 6-1 8M24 20.5c-2 1.5-3 4-2.5 6.5" stroke="#b58c4c" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <circle cx="13.5" cy="25" r="1.6" fill="#b58c4c" />
        </svg>
      )
    case 'qurunful':
      return (
        <svg viewBox="0 0 40 40" className="gmsm-art" focusable="false" aria-hidden="true">
          <path d="M20 35V17" stroke="#6b4423" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M20 17l-6-3.5 6-3.5 6 3.5z" fill="#8a5a2e" />
          <g fill="#7a4d27">
            <ellipse cx="13.5" cy="10.5" rx="2.6" ry="3.6" transform="rotate(-32 13.5 10.5)" />
            <ellipse cx="26.5" cy="10.5" rx="2.6" ry="3.6" transform="rotate(32 26.5 10.5)" />
            <ellipse cx="20" cy="6.5" rx="2.6" ry="3.6" />
          </g>
        </svg>
      )
    case 'summaq':
      return (
        <svg viewBox="0 0 40 40" className="gmsm-art" focusable="false" aria-hidden="true">
          <path d="M6 31c4-11 9.5-15.5 14-15.5S30 20 34 31z" fill="#8e2b2b" />
          <g fill="#b34b47">
            <circle cx="15" cy="26" r="1.7" /><circle cx="21" cy="23" r="1.5" />
            <circle cx="26" cy="27" r="1.6" /><circle cx="19" cy="29" r="1.4" />
            <circle cx="12" cy="30" r="1.3" /><circle cx="28" cy="30.5" r="1.3" />
          </g>
          <path d="M6 31h28" stroke="#6d1f1f" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )
    case 'nana':
      return (
        <svg viewBox="0 0 40 40" className="gmsm-art" focusable="false" aria-hidden="true">
          <path d="M20 35C9 29 7 16 20 5c13 11 11 24 0 30z" fill="#48ab68" />
          <path d="M20 34V8M20 17l-6.5-4.5M20 24l-7.5-4.5M20 17l6.5-4.5M20 24l7.5-4.5" stroke="#2c7345" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      )
    case 'kurkum':
      return (
        <svg viewBox="0 0 40 40" className="gmsm-art" focusable="false" aria-hidden="true">
          <path d="M5 31c4.5-12 10-16.5 15-16.5S31 19 35 31z" fill="#e8ab24" />
          <path d="M11 27c3.5-2.4 6.5-2.4 9 0s5.5 2.4 9 0" stroke="#b97f0d" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d="M20 14.5V7" stroke="#b97f0d" strokeWidth="2" strokeLinecap="round" />
          <path d="M5 31h30" stroke="#a97104" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 40 40" className="gmsm-art" focusable="false" aria-hidden="true">
          <g fill="#2f3440">
            <path d="M13 11l4 2-1.5 4-4-1.5z" /><path d="M24 9l4 2.2-1.6 4.2-4.2-1.7z" />
            <path d="M18 20.5l4.4 2-1.6 4.4-4.4-1.8z" /><path d="M10 25l3.6 1.8-1.4 3.8-3.8-1.5z" />
            <path d="M27 24l3.8 1.9-1.5 4-4-1.6z" />
          </g>
          <g fill="#565f70">
            <circle cx="20" cy="13" r="1.2" /><circle cx="30" cy="18" r="1.1" /><circle cx="12" cy="20" r="1.1" />
          </g>
        </svg>
      )
  }
}

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t
  }
  return arr
}

const buildDeck = (pairs) => {
  const chosen = shuffle(SPICES.slice()).slice(0, pairs)
  const cards = []
  for (let i = 0; i < chosen.length; i++) {
    cards.push({ key: `${chosen[i].id}-a`, sid: chosen[i].id })
    cards.push({ key: `${chosen[i].id}-b`, sid: chosen[i].id })
  }
  return shuffle(cards)
}

const levelSeconds = (lvl) => (lvl === 1 ? 60 : lvl === 2 ? 70 : Math.max(40, 70 - (lvl - 2) * 6))
const levelPairs = (lvl) => (lvl === 1 ? 8 : 10)
const spiceOf = (sid) => SPICES.find((s) => s.id === sid) || SPICES[0]

export default function SpiceMatch({ onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '' }) {
  const [phase, setPhase] = useState('ready') // ready | play | clear | over
  const [level, setLevel] = useState(1)
  const [cards, setCards] = useState([])
  const [up, setUp] = useState([])
  const [matched, setMatched] = useState([])
  const [moves, setMoves] = useState(0)
  const [streak, setStreak] = useState(0)
  const [score, setScore] = useState(0)
  const [timeLeft, setTimeLeft] = useState(60)
  const [peek, setPeek] = useState(false)
  const [bonus, setBonus] = useState(0)
  const [pop, setPop] = useState(null)
  const [best, setBest] = useState(readBest)

  const onScoreRef = useRef(onScore)
  const peekTimer = useRef(0)

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { if (typeof onScoreRef.current === 'function') onScoreRef.current(score) }, [score])
  useEffect(() => () => clearTimeout(peekTimer.current), [])

  const startLevel = (lvl, keepScore) => {
    clearTimeout(peekTimer.current)
    setLevel(lvl)
    setCards(buildDeck(levelPairs(lvl)))
    setUp([])
    setMatched([])
    setMoves(0)
    setStreak(0)
    setTimeLeft(levelSeconds(lvl))
    setPop(null)
    if (!keepScore) setScore(0)
    setPeek(true)
    setPhase('play')
    peekTimer.current = setTimeout(() => setPeek(false), lvl >= 3 ? 1000 : 1700)
  }

  const endGame = () => {
    clearTimeout(peekTimer.current)
    setPeek(false)
    setPhase('over')
    if (typeof onScoreRef.current === 'function') onScoreRef.current(score)
    if (score > readBest()) { writeBest(score); setBest(score) }
  }

  // countdown — one interval, paused during the peek and on every non-play phase
  useEffect(() => {
    if (phase !== 'play' || peek) return undefined
    const id = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000)
    return () => clearInterval(id)
  }, [phase, peek])

  useEffect(() => {
    if (phase === 'play' && timeLeft <= 0) endGame()
  }, [timeLeft, phase])

  // resolve a pair
  useEffect(() => {
    if (up.length !== 2) return undefined
    const [a, b] = up
    const same = cards[a] && cards[b] && cards[a].sid === cards[b].sid
    setMoves((m) => m + 1)
    if (same) {
      const ns = streak + 1
      const gain = 50 + 25 * Math.min(ns, 6)
      const t = setTimeout(() => {
        setMatched((prev) => prev.concat([a, b]))
        setUp([])
        setStreak(ns)
        setScore((s) => s + gain)
        setPop({ id: Date.now(), txt: `+${gain}` })
      }, 330)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => { setUp([]); setStreak(0) }, 760)
    return () => clearTimeout(t)
  }, [up, cards, streak])

  // level cleared
  useEffect(() => {
    if (phase !== 'play' || !cards.length) return
    if (matched.length < cards.length) return
    const b = timeLeft * 10
    setBonus(b)
    setScore((s) => s + b)
    setPhase('clear')
  }, [matched, cards, phase, timeLeft])

  const flip = (i) => {
    if (phase !== 'play' || peek) return
    if (up.length >= 2) return
    if (up.includes(i) || matched.includes(i)) return
    setUp(up.concat([i]))
  }

  const rows = cards.length > 16 ? 5 : 4
  const rtl = lang !== 'en'
  const pairsLeft = Math.max(0, (cards.length - matched.length) / 2)

  return (
    <div
      className="gmx-root gmsm-root"
      dir={rtl ? 'rtl' : 'ltr'}
      style={{ '--gm-brand': brand, '--gmsm-rows': rows }}
    >
      <div className="gmsm-stage">
        <div className="gmsm-bar">
          <span className="gmx-pill gmx-pill-score">{fmt(score)}</span>
          <span className="gmx-pill">مستوى {fmt(level)}</span>
          <span className="gmx-pill">نقلات {fmt(moves)}</span>
          {streak > 1 && <span className="gmx-pill gmx-pill-hot">تتابع ×{fmt(streak)}</span>}
          <span className={`gmx-pill gmsm-clock${timeLeft <= 10 ? ' is-warn' : ''}`}>{fmt(timeLeft)} ث</span>
        </div>

        <div className="gmsm-grid">
          {cards.map((c, i) => {
            const sp = spiceOf(c.sid)
            const isMatched = matched.includes(i)
            const faceUp = peek || isMatched || up.includes(i)
            return (
              <button
                key={c.key}
                type="button"
                className={`gmsm-tile${faceUp ? ' up' : ''}${isMatched ? ' done' : ''}`}
                onPointerDown={(e) => { e.preventDefault(); flip(i) }}
                aria-label={faceUp ? sp.name : 'بطاقة مقلوبة'}
              >
                <span className="gmsm-inner">
                  <span className="gmsm-face gmsm-front" aria-hidden="true">
                    <span className="gmsm-mark" />
                  </span>
                  <span
                    className="gmsm-face gmsm-back"
                    style={{ background: sp.bg, borderColor: sp.ring }}
                  >
                    <SpiceArt id={c.sid} />
                    <b className="gmsm-name" style={{ color: sp.ring }}>{sp.name}</b>
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {phase === 'play' && (
          <p className="gmsm-foot">
            {peek ? 'احفظ مواقع التوابل' : `اقلب بطاقتين متطابقتين — بقي ${fmt(pairsLeft)} زوج`}
          </p>
        )}
      </div>

      {pop && <div key={pop.id} className="gmx-toast gmsm-pop">{pop.txt}</div>}

      {phase === 'ready' && (
        <div className="gmx-veil">
          <div className="gmx-card">
            <div className="gmsm-emblem" aria-hidden="true">
              <span className="gmsm-chip"><SpiceArt id="nana" /></span>
              <span className="gmsm-chip"><SpiceArt id="qirfa" /></span>
              <span className="gmsm-chip"><SpiceArt id="zafaran" /></span>
            </div>
            <h3 className="gmx-title">مطابقة التوابل</h3>
            <p className="gmx-line">تظهر البطاقات للحظة ثم تُقلب — اعثر على أزواج التوابل قبل انتهاء الوقت. المطابقات المتتالية ترفع مضاعف التتابع.</p>
            <button type="button" className="gmx-btn" onClick={() => startLevel(1, false)}>ابدأ</button>
            {best > 0 && <p className="gmx-sub">أفضل نتيجة {fmt(best)}</p>}
          </div>
        </div>
      )}

      {phase === 'clear' && (
        <div className="gmx-veil">
          <div className="gmx-card">
            <h3 className="gmx-title">اكتمل المستوى {fmt(level)}</h3>
            <div className="gmx-big">{fmt(score)}</div>
            <p className="gmx-line">مكافأة الوقت {fmt(bonus)} نقطة — المستوى التالي أكبر وأسرع.</p>
            <div className="gmx-actions">
              <button type="button" className="gmx-btn" onClick={() => startLevel(level + 1, true)}>المستوى التالي</button>
              {typeof onExit === 'function' && (
                <button type="button" className="gmx-btn ghost" onClick={onExit}>إنهاء</button>
              )}
            </div>
          </div>
        </div>
      )}

      {phase === 'over' && (
        <div className="gmx-veil">
          <div className="gmx-card">
            <h3 className="gmx-title">انتهى الوقت</h3>
            <div className="gmx-big">{fmt(score)}</div>
            <p className="gmx-line">
              {playerName ? `${playerName}، ` : ''}وصلت إلى المستوى {fmt(level)} في {fmt(moves)} نقلة
            </p>
            <p className="gmx-sub">أفضل نتيجة {fmt(Math.max(best, score))}</p>
            <div className="gmx-actions">
              <button type="button" className="gmx-btn" onClick={() => startLevel(1, false)}>العب مرة أخرى</button>
              {typeof onExit === 'function' && (
                <button type="button" className="gmx-btn ghost" onClick={onExit}>إنهاء</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
