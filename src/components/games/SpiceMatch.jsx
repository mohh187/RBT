// «توأم البهارات» — SpiceMatch: a memory-match board where every tile is a
// hand-drawn spice (inline SVG paths, never an emoji). A stage ladder: stage one
// is a 4x4 board, stage two 4x5, stage three and up 4x6. Each stage the peek
// gets shorter, the clock gets tighter, and — the real squeeze — you are given a
// MOVE BUDGET: run out of flips before you clear the board and the round ends.
// Consecutive matches build a streak multiplier.
//
// Progress is saved through onProgress so a guest resumes at their stage with
// their score.
//
// CONTRACT (hub-rendered): fills its parent, play area only, ABSOLUTE score via
// onScore(). DEVIATION NOTE: this game is pure DOM/SVG, so it runs on one 1s
// interval instead of a rAF loop — nothing is animated per frame, and the
// interval is torn down with the component.
import { useEffect, useMemo, useRef, useState } from 'react'
import { play } from '../../lib/gameSounds.js'
import '../../styles/arcade-b.css'

const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

const GAME_ID = 'spiceMatch'
const PROG_V = 2
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
  { id: 'filfil', name: 'فلفل حار', bg: '#fdeae7', ring: '#c33221' },
  { id: 'luban', name: 'لبان', bg: '#fbf3df', ring: '#c99a3a' },
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
    case 'filfil':
      return (
        <svg viewBox="0 0 40 40" className="gmsm-art" focusable="false" aria-hidden="true">
          <path d="M15 9c.4 3 1 5.4 2.6 7.6 3 4 8.4 6.4 9.6 11.6 1 4.2-2.2 8.2-6.4 8s-8.4-3.6-9.2-9c-.9-6.2 1.2-12.4 3.4-16.2z" fill="#cf3524" />
          <path d="M27 28c.6-2-.2-4-1.6-5.4" stroke="#f0a596" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M15 9c-1.2-1.8-3.2-2.4-5.4-2M15 9c1.8-1.2 4-1.2 5.4.4" stroke="#3f8f4e" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        </svg>
      )
    case 'luban':
      return (
        <svg viewBox="0 0 40 40" className="gmsm-art" focusable="false" aria-hidden="true">
          <g fill="#e6c274">
            <ellipse cx="15" cy="16" rx="6.4" ry="7.4" />
            <ellipse cx="25.5" cy="22" rx="5.8" ry="6.8" />
            <ellipse cx="16.5" cy="28" rx="4.6" ry="5.2" />
          </g>
          <g fill="rgba(255,255,255,.5)">
            <ellipse cx="13" cy="13.5" rx="2" ry="2.6" /><ellipse cx="23.5" cy="19.5" rx="1.7" ry="2.2" />
          </g>
          <g fill="#c39a44">
            <circle cx="17.5" cy="18" r="1" /><circle cx="27" cy="24" r=".9" />
          </g>
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

const levelSeconds = (lvl) => (lvl === 1 ? 60 : lvl === 2 ? 66 : Math.max(42, 66 - (lvl - 2) * 6))
const levelPairs = (lvl) => (lvl === 1 ? 8 : lvl === 2 ? 10 : 12)
// a finite flip budget that tightens as the board grows
const levelBudget = (lvl, pairs) => pairs + Math.max(4, Math.round(pairs * (lvl >= 3 ? 0.5 : lvl === 2 ? 0.75 : 1)))
const spiceOf = (sid) => SPICES.find((s) => s.id === sid) || SPICES[0]

export default function SpiceMatch({
  onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '',
  onProgress, resumeState,
}) {
  const saved = useMemo(() => {
    const s = resumeState
    return s && s.game === GAME_ID && s.v === PROG_V && Number(s.stage) > 0 ? s : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [phase, setPhase] = useState('ready') // ready | play | clear | over
  const [level, setLevel] = useState(saved ? Number(saved.stage) : 1)
  const [cards, setCards] = useState([])
  const [up, setUp] = useState([])
  const [matched, setMatched] = useState([])
  const [movesLeft, setMovesLeft] = useState(0)
  const [streak, setStreak] = useState(0)
  const [score, setScore] = useState(saved ? Number(saved.score) || 0 : 0)
  const [timeLeft, setTimeLeft] = useState(60)
  const [peek, setPeek] = useState(false)
  const [bonus, setBonus] = useState(0)
  const [pop, setPop] = useState(null)
  const [overReason, setOverReason] = useState('time')
  const [best, setBest] = useState(readBest)

  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  const peekTimer = useRef(0)
  const scoreRef = useRef(score)
  const levelRef = useRef(level)

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])
  useEffect(() => { scoreRef.current = score }, [score])
  useEffect(() => { levelRef.current = level }, [level])
  useEffect(() => { if (typeof onScoreRef.current === 'function') onScoreRef.current(score) }, [score])
  useEffect(() => () => clearTimeout(peekTimer.current), [])

  const report = (done, stageVal, scoreVal) => {
    try {
      onProgressRef.current?.({
        game: GAME_ID, v: PROG_V,
        stage: stageVal != null ? stageVal : levelRef.current,
        score: scoreVal != null ? scoreVal : scoreRef.current,
        done: !!done, completed: false, at: Date.now(),
      })
    } catch (_) { /* best-effort */ }
  }

  const startLevel = (lvl, keepScore, startScore) => {
    clearTimeout(peekTimer.current)
    const pairs = levelPairs(lvl)
    setLevel(lvl)
    levelRef.current = lvl
    setCards(buildDeck(pairs))
    setUp([])
    setMatched([])
    setMovesLeft(levelBudget(lvl, pairs))
    setStreak(0)
    setTimeLeft(levelSeconds(lvl))
    setPop(null)
    if (!keepScore) { setScore(0); scoreRef.current = 0 }
    else if (typeof startScore === 'number') { setScore(startScore); scoreRef.current = startScore }
    setPeek(true)
    setPhase('play')
    play('deal')
    report(false, lvl) // resume point at the start of each stage
    peekTimer.current = setTimeout(() => setPeek(false), lvl >= 3 ? 900 : lvl === 2 ? 1300 : 1700)
  }

  const endGame = (reason) => {
    clearTimeout(peekTimer.current)
    setPeek(false)
    setOverReason(reason || 'time')
    setPhase('over')
    if (typeof onScoreRef.current === 'function') onScoreRef.current(scoreRef.current)
    if (scoreRef.current > readBest()) { writeBest(scoreRef.current); setBest(scoreRef.current) }
    report(true)
    play('lose')
  }

  // countdown — one interval, paused during the peek and on every non-play phase
  useEffect(() => {
    if (phase !== 'play' || peek) return undefined
    const id = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000)
    return () => clearInterval(id)
  }, [phase, peek])

  useEffect(() => {
    if (phase === 'play' && timeLeft <= 0) endGame('time')
  }, [timeLeft, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // resolve a pair
  useEffect(() => {
    if (up.length !== 2) return undefined
    const [a, b] = up
    const same = cards[a] && cards[b] && cards[a].sid === cards[b].sid
    setMovesLeft((m) => Math.max(0, m - 1))
    if (same) {
      const ns = streak + 1
      const gain = 50 + 25 * Math.min(ns, 6)
      play('capture', { gain: 0.5 })
      const t = setTimeout(() => {
        setMatched((prev) => prev.concat([a, b]))
        setUp([])
        setStreak(ns)
        setScore((s) => s + gain)
        setPop({ id: Date.now(), txt: `+${gain}` })
      }, 330)
      return () => clearTimeout(t)
    }
    play('lose', { gain: 0.32 })
    const t = setTimeout(() => { setUp([]); setStreak(0) }, 760)
    return () => clearTimeout(t)
  }, [up, cards, streak])

  // level cleared
  useEffect(() => {
    if (phase !== 'play' || !cards.length) return
    if (matched.length < cards.length) return
    const b = timeLeft * 10 + movesLeft * 15
    const ns = scoreRef.current + b
    scoreRef.current = ns
    setBonus(b)
    setScore(ns)
    setPhase('clear')
    play('win', { gain: 0.55 })
    report(false, level + 1, ns) // next-stage resume point, with the bonus folded in
  }, [matched, cards, phase, timeLeft]) // eslint-disable-line react-hooks/exhaustive-deps

  // out of flips — the squeeze that makes the budget matter
  useEffect(() => {
    if (phase !== 'play' || peek) return
    if (!cards.length || up.length !== 0) return
    if (movesLeft <= 0 && matched.length < cards.length) endGame('moves')
  }, [movesLeft, up, peek, phase, matched, cards]) // eslint-disable-line react-hooks/exhaustive-deps

  const flip = (i) => {
    if (phase !== 'play' || peek) return
    if (up.length >= 2) return
    if (up.includes(i) || matched.includes(i)) return
    play('card', { gain: 0.5 })
    setUp(up.concat([i]))
  }

  const rows = cards.length > 20 ? 6 : cards.length > 16 ? 5 : 4
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
          <span className="gmx-pill arb-stage-pill">المرحلة {fmt(level)}</span>
          <span className={`gmx-pill${movesLeft <= 3 ? ' is-warn' : ''}`}>نقلات {fmt(movesLeft)}</span>
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
            {peek ? 'احفظ مواقع التوابل' : `اقلب بطاقتين متطابقتين، وبقي ${fmt(pairsLeft)} ${pairsLeft >= 3 && pairsLeft <= 10 ? 'أزواج' : 'زوج'}`}
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
            <h3 className="gmx-title">توأم البهارات</h3>
            <p className="gmx-line">تظهر البطاقات للحظة ثم تُقلب، فاعثر على أزواج التوابل قبل نفاد الوقت أو النقلات. كل مرحلة لوحها أكبر ونقلاتها أقل، والمطابقات المتتالية ترفع المضاعف.</p>
            {saved ? (
              <div className="gmx-actions">
                <button type="button" className="gmx-btn" onClick={() => startLevel(Number(saved.stage), true, Number(saved.score) || 0)}>
                  تابع من المرحلة {fmt(saved.stage)}
                </button>
                <button type="button" className="gmx-btn ghost" onClick={() => startLevel(1, false)}>من البداية</button>
              </div>
            ) : (
              <button type="button" className="gmx-btn" onClick={() => startLevel(1, false)}>ابدأ</button>
            )}
            {best > 0 && <p className="gmx-sub">أفضل نتيجة {fmt(best)}</p>}
          </div>
        </div>
      )}

      {phase === 'clear' && (
        <div className="gmx-veil">
          <div className="gmx-card">
            <h3 className="gmx-title">اكتمل المستوى {fmt(level)}</h3>
            <div className="gmx-big">{fmt(score)}</div>
            <p className="gmx-line">مكافأة الوقت والنقلات {fmt(bonus)} {bonus >= 3 && bonus <= 10 ? 'نقاط' : 'نقطة'}. المستوى التالي أكبر وأسرع.</p>
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
            <h3 className="gmx-title">{overReason === 'moves' ? 'نفدت النقلات' : 'انتهى الوقت'}</h3>
            <div className="gmx-big">{fmt(score)}</div>
            <p className="gmx-line">
              {playerName ? `${playerName}، ` : ''}بلغت المستوى {fmt(level)}
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
