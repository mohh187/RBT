// «سباق النادل» — a staged lane-runner across the restaurant floor. The waiter
// carries a tray through TEN numbered stages, each a fixed distance with rising
// speed and a new hazard: spills to jump, stray chairs, rolling service carts,
// a cat that wanders between lanes, double walls that leave one path open, and
// golden cups worth four times a plain one. Cups build a combo multiplier; any
// hit shakes the tray — the wobble meter climbs, and when it tops out a life
// (one of three hearts) is lost. Clearing a stage banks the score and is saved
// through onProgress, so a returning guest resumes at the stage they reached
// with their banked points (resumeState). Losing all hearts offers a retry of
// the SAME stage with the banked score — a forgiving beat, and farm-safe since
// re-clearing a stage re-banks rather than stacks.
//
// Contract: renders ONLY the play area — the hub owns chrome, live score and
// closing. Absolute score via onScore. Canvas world (paths only, no emoji,
// Latin digits), DOM chrome at the house standard (arcade-a.css). The canvas
// renders through a virtual viewport (SC = h/560 capped) so phone portrait and
// the venue TV both get correctly-sized actors instead of tiny sprites.
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { play } from '../../lib/gameSounds.js'
import '../../styles/arcade-a.css'

const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

const LANES = 3
const START_LIVES = 3
const CUP_POINTS = 5
const GOLD_POINTS = 20
const HIT_WOBBLE = 55
const LANE_WOBBLE = 9
const METER = 45 // virtual px per displayed metre

const BEST_KEY = 'rbt_arc_waiter_best'
const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch (_) { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)) } catch (_) { /* private mode */ } }

// ---------------------------------------------------------------------------
// the stage ladder — distance goal (metres), speed/density factors and which
// hazards exist. `newAr` is the banner line that introduces the stage.
// ---------------------------------------------------------------------------
const STAGES = [
  { goal: 80, speed: 1.0, density: 1.0, kinds: ['table'], newAr: 'اجمع الأكواب وتفادَ الطاولات' },
  { goal: 95, speed: 1.07, density: 1.05, kinds: ['table', 'spill'], newAr: 'انسكابات لزجة — اقفز فوقها' },
  { goal: 110, speed: 1.14, density: 1.1, kinds: ['table', 'spill', 'chair'], newAr: 'كراسي متروكة — راوغها أو اقفز' },
  { goal: 125, speed: 1.2, density: 1.16, kinds: ['table', 'spill', 'chair', 'cart'], newAr: 'عربات تتدحرج نحوك أسرع من الأرض' },
  { goal: 140, speed: 1.26, density: 1.2, kinds: ['table', 'spill', 'chair', 'cart', 'cat'], newAr: 'قطة تتنقل بين المسارات — راقبها' },
  { goal: 155, speed: 1.32, density: 1.26, kinds: ['table', 'spill', 'chair', 'cart', 'cat'], gold: true, newAr: 'أكواب ذهبية: عشرون نقطة' },
  { goal: 170, speed: 1.38, density: 1.42, kinds: ['table', 'spill', 'chair', 'cart', 'cat'], gold: true, newAr: 'زحمة الظهيرة — عوائق أكثر' },
  { goal: 185, speed: 1.44, density: 1.5, kinds: ['table', 'spill', 'chair', 'cart', 'cat'], gold: true, walls: true, newAr: 'صفوف مزدوجة تسدّ مسارين' },
  { goal: 200, speed: 1.52, density: 1.58, kinds: ['table', 'spill', 'chair', 'cart', 'cat'], gold: true, walls: true, newAr: 'المسار السريع — كل شيء أسرع' },
  { goal: 220, speed: 1.6, density: 1.75, kinds: ['table', 'spill', 'chair', 'cart', 'cat'], gold: true, walls: true, newAr: 'القاعة الكبرى — التحدي الأخير' },
]
const LAST = STAGES.length // 10

// hazards the waiter can clear with a jump; tables and carts are too tall
const JUMPABLE = { spill: true, chair: true, cat: true }

const TXT = {
  ar: {
    title: 'سباق النادل',
    how: 'اسحب لأعلى أو لأسفل لتغيير المسار، والمس الشاشة للقفز. اجمع الأكواب، تفادَ العوائق، وأنهِ كل مرحلة قبل أن تسقط الصينية. عشر مراحل، وكل مرحلة تضيف تحدياً جديداً.',
    start: 'ابدأ الجري',
    resume: (n) => `استكمال من المرحلة ${fmt(n)}`,
    fresh: 'من البداية',
    again: 'العب مجدداً',
    nextStage: 'المرحلة التالية',
    exit: 'إنهاء',
    over: 'سقطت الصينية',
    overLine: (n) => `توقفت عند المرحلة ${fmt(n)} — الصينية بانتظارك.`,
    cleared: (n) => `المرحلة ${fmt(n)} اكتملت`,
    victory: 'أنهيت السباق كاملاً!',
    victoryLine: 'عشر مراحل بلا سقوط أخير — نادل من الطراز الأول.',
    wellDone: 'أحسنت',
    grandHall: 'نهاية السباق',
    stageOf: (n) => `المرحلة ${fmt(n)} من ${fmt(LAST)}`,
    best: 'أفضل نتيجة',
    cups: 'أكواب المرحلة',
    stageReached: 'المرحلة',
    points: 'نقطة',
    combo: 'مضاعف',
    balance: 'الاتزان',
    newIn: 'جديد',
    tableNoJump: 'الطاولات لا يُقفز فوقها — غيّر المسار',
    goldCup: 'كوب ذهبي!',
  },
  en: {
    title: 'Waiter Dash',
    how: 'Swipe up/down to change lane, tap to jump. Collect cups, dodge hazards, finish each of the ten stages before the tray drops.',
    start: 'Start running',
    resume: (n) => `Resume from stage ${n}`,
    fresh: 'Start over',
    again: 'Play again',
    nextStage: 'Next stage',
    exit: 'Exit',
    over: 'Tray dropped',
    overLine: (n) => `You stopped at stage ${n} — the tray awaits.`,
    cleared: (n) => `Stage ${n} complete`,
    victory: 'You finished the whole run!',
    victoryLine: 'Ten stages without a final fall — a first-class waiter.',
    wellDone: 'Well done',
    grandHall: 'End of the run',
    stageOf: (n) => `Stage ${n} of ${LAST}`,
    best: 'Best score',
    cups: 'Stage cups',
    stageReached: 'Stage',
    points: 'points',
    combo: 'Combo',
    balance: 'Balance',
    newIn: 'New',
    tableNoJump: 'Tables cannot be jumped — switch lanes',
    goldCup: 'Golden cup!',
  },
}

const HEART = 'M12 21C7 16.6 2.5 12.9 2.5 8.8 2.5 6 4.7 4 7.3 4c1.8 0 3.4.9 4.7 2.6C13.3 4.9 14.9 4 16.7 4c2.6 0 4.8 2 4.8 4.8 0 4.1-4.5 7.8-9.5 12.2z'
const STAR = 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z'

function Hearts({ lives }) {
  return (
    <span className="arc-lives" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < lives ? 'arc-heart' : i === lives ? 'arc-heart off hit' : 'arc-heart off'}>
          <svg viewBox="0 0 24 24"><path d={HEART} /></svg>
        </span>
      ))}
    </span>
  )
}

function Stars({ n }) {
  return (
    <div className="arc-stars" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < n ? 'arc-star on' : 'arc-star'}>
          <svg viewBox="0 0 24 24"><path d={STAR} /></svg>
        </span>
      ))}
    </div>
  )
}

// resumeState → { stage (1-based), score } or null
function readResume(rs) {
  if (!rs || typeof rs !== 'object') return null
  const stage = Math.floor(Number(rs.stage))
  const score = Math.max(0, Math.floor(Number(rs.score) || 0))
  if (!Number.isFinite(stage) || stage < 2 || stage > LAST) return null
  return { stage, score }
}

export default function WaiterDash({ onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '', onProgress, resumeState }) {
  const t = TXT[lang] || TXT.ar
  const cvsRef = useRef(null)
  const gRef = useRef(null)
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  const phaseRef = useRef('ready')
  const brandRef = useRef(brand)

  const [phase, setPhase] = useState('ready') // ready | play | cleared | over | victory
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(START_LIVES)
  const [wobble, setWobble] = useState(0)
  const [mult, setMult] = useState(1)
  const [stageNo, setStageNo] = useState(1)
  const [prog, setProg] = useState(0)
  const [banner, setBanner] = useState(null) // { key, n, line }
  const [toast, setToast] = useState(null) // { key, text, tone }
  const [best, setBest] = useState(readBest)
  const [clearedInfo, setClearedInfo] = useState(null) // { stars, cups }

  const resume = useRef(readResume(resumeState)).current
  const timersRef = useRef([])

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])
  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { brandRef.current = brand }, [brand])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  const later = (fn, ms) => { timersRef.current.push(setTimeout(fn, ms)) }
  const showToast = (text, tone) => {
    setToast({ key: Date.now() + Math.random(), text, tone })
    later(() => setToast(null), 1150)
  }

  // real menu names float up on cup pickup — the venue's own dishes as confetti
  const namesRef = useRef([])
  useEffect(() => {
    namesRef.current = (items || [])
      .map((i) => String((lang === 'en' ? i?.nameEn : i?.nameAr) || i?.nameAr || i?.nameEn || '').trim())
      .filter((n) => n && n.length <= 18)
      .slice(0, 24)
  }, [items, lang])

  // -------------------------------------------------------------------------
  // stage lifecycle (called from React handlers AND from the rAF via refs)
  // -------------------------------------------------------------------------
  const startStage = (idx0, bank) => {
    const g = gRef.current
    if (!g) return
    const st = STAGES[idx0]
    g.stage = idx0
    g.goalPx = st.goal * METER
    g.stageDist = 0
    g.bank = bank
    g.cupPts = 0
    g.cupCount = 0
    g.combo = 0
    g.obstacles = []
    g.cups = []
    g.floats = []
    g.puffs = []
    g.lane = 1
    g.laneY = 1
    g.jump = 0
    g.wobble = 0
    g.invuln = 0
    g.spawnGap = 260
    g.shake = 0
    g.clearing = false
    g.uiScore = -1
    g.uiWobble = -1
    g.uiMult = -1
    g.uiProg = -1
    setStageNo(idx0 + 1)
    setProg(0)
    setWobble(0)
    setMult(1)
    setBanner({ key: Date.now(), n: idx0 + 1, line: st.newAr })
    later(() => setBanner((b) => (b && b.n === idx0 + 1 ? null : b)), 1650)
    play('deal', { gain: 0.7 })
    setPhase('play')
  }

  const startRun = (fromStage, bank) => {
    const g = gRef.current
    if (!g) return
    g.lives = START_LIVES
    setLives(START_LIVES)
    setScore(bank)
    onScoreRef.current?.(bank)
    startStage(fromStage, bank)
  }

  const scoreNow = (g) => g.bank + Math.round(g.stageDist / METER) + g.cupPts

  const stageCleared = () => {
    const g = gRef.current
    if (!g) return
    const sc = scoreNow(g)
    g.bank = sc
    const nextNo = g.stage + 2 // 1-based number of the NEXT stage
    if (sc > readBest()) { writeBest(sc); setBest(sc) }
    if (g.stage + 1 >= LAST) {
      // the whole ladder is done — completed run, resume resets
      try { onProgressRef.current?.({ stage: LAST, done: true, score: sc }) } catch (_) { /* progress is optional */ }
      play('win')
      setPhase('victory')
    } else {
      try { onProgressRef.current?.({ stage: nextNo, score: sc }) } catch (_) { /* progress is optional */ }
      play('win', { gain: 0.9 })
      setClearedInfo({ stars: g.lives, cups: g.cupCount })
      setPhase('cleared')
    }
  }
  const stageClearedRef = useRef(stageCleared)
  useEffect(() => { stageClearedRef.current = stageCleared })

  const gameOver = () => {
    const g = gRef.current
    const sc = g ? scoreNow(g) : 0
    if (sc > readBest()) { writeBest(sc); setBest(sc) }
    onScoreRef.current?.(sc)
    play('lose')
    setPhase('over')
  }
  const gameOverRef = useRef(gameOver)
  useEffect(() => { gameOverRef.current = gameOver })

  const toastRef = useRef(showToast)
  useEffect(() => { toastRef.current = showToast })
  const tRef = useRef(t)
  useEffect(() => { tRef.current = t }, [t])

  // -------------------------------------------------------------------------
  // engine — mounted once; gameplay state lives entirely in the ref
  // -------------------------------------------------------------------------
  useEffect(() => {
    const cvs = cvsRef.current
    if (!cvs) return undefined
    const ctx = cvs.getContext('2d')
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const g = {
      obstacles: [], cups: [], floats: [], puffs: [],
      stage: 0, goalPx: STAGES[0].goal * METER, stageDist: 0, bank: 0,
      cupPts: 0, cupCount: 0, combo: 0,
      lane: 1, laneY: 1, jump: 0, wobble: 0, lives: START_LIVES, invuln: 0,
      spawnGap: 260, scroll: 0, last: 0, raf: 0, w: 0, h: 0, sc: 1, reduced,
      shake: 0, clearing: false, taughtTable: false,
      uiScore: -1, uiWobble: -1, uiMult: -1, uiProg: -1,
    }
    gRef.current = g

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const cw = cvs.clientWidth || 1
      const ch = cvs.clientHeight || 1
      g.sc = Math.max(1, Math.min(2.2, ch / 560))
      g.w = cw / g.sc // virtual viewport — actors keep phone-tuned sizes
      g.h = ch / g.sc
      cvs.width = Math.round(cw * dpr)
      cvs.height = Math.round(ch * dpr)
      ctx.setTransform(dpr * g.sc, 0, 0, dpr * g.sc, 0, 0)
    }
    resize()
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null
    ro?.observe(cvs)
    window.addEventListener('resize', resize)

    const rrect = (x, y, w, h, r) => {
      const rr = Math.min(r, w / 2, h / 2)
      ctx.beginPath()
      ctx.moveTo(x + rr, y)
      ctx.arcTo(x + w, y, x + w, y + h, rr)
      ctx.arcTo(x + w, y + h, x, y + h, rr)
      ctx.arcTo(x, y + h, x, y, rr)
      ctx.arcTo(x, y, x + w, y, rr)
      ctx.closePath()
    }

    const laneY = (i) => g.h * (0.5 + i * 0.16)
    const playerX = () => g.w * 0.74
    const stageOf = () => STAGES[g.stage] || STAGES[0]
    const speed = () => (g.reduced ? 200 : 250) * stageOf().speed * (1 + Math.min(0.12, g.stageDist / (g.goalPx * 8)))
    const multiplier = () => 1 + Math.min(3, Math.floor(g.combo / 4))

    const puff = (x, y, color, n = 6, up = 0) => {
      if (g.reduced) return
      for (let i = 0; i < n && g.puffs.length < 70; i += 1) {
        const a = Math.random() * Math.PI * 2
        g.puffs.push({ x, y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 40 - up, r: 2 + Math.random() * 3, life: 0.45, t: 0.45, color })
      }
    }

    const spawn = () => {
      const st = stageOf()
      const kinds = st.kinds
      const kind = kinds[Math.floor(Math.random() * kinds.length)]
      const wall = st.walls && Math.random() < 0.24
      const open = Math.floor(Math.random() * LANES) // this lane ALWAYS stays open
      if (wall) {
        // two static obstacles, one lane open — carts/cats never form walls
        const pool = kinds.filter((k) => k !== 'cart' && k !== 'cat')
        for (let l = 0; l < LANES; l += 1) {
          if (l === open) continue
          g.obstacles.push({ x: -70, lane: l, kind: pool[Math.floor(Math.random() * pool.length)] || 'table', phase: Math.random() * 6 })
        }
      } else {
        let l = Math.floor(Math.random() * LANES)
        if (kinds.length === 1 && Math.random() < 0.5) l = (open + 1 + Math.floor(Math.random() * 2)) % LANES
        g.obstacles.push({ x: -70, lane: l === open && Math.random() < 0.5 ? (open + 1) % LANES : l, kind, phase: Math.random() * 6, baseLane: null })
      }
      if (Math.random() < 0.6) {
        let l = open
        const gold = !!st.gold && Math.random() < 0.16
        g.cups.push({ x: -70 - 50 - Math.random() * 130, lane: l, taken: false, gold })
      }
    }

    const hitLife = () => {
      g.lives = Math.max(0, g.lives - 1)
      setLives(g.lives)
      g.wobble = 25
      g.invuln = 1.2
      if (g.lives <= 0) gameOverRef.current()
    }

    // ---------------- drawing ----------------
    const drawBackdrop = (now) => {
      const { w, h } = g
      // majlis wall
      const wall = ctx.createLinearGradient(0, 0, 0, h * 0.42)
      wall.addColorStop(0, '#152a24')
      wall.addColorStop(1, '#1f3a30')
      ctx.fillStyle = wall
      ctx.fillRect(0, 0, w, h * 0.42)
      // slow parallax: framed art + wainscot
      const px2 = (g.scroll * 0.35) % 340
      for (let i = -1; i < w / 340 + 1; i += 1) {
        const x = i * 340 + px2
        ctx.fillStyle = 'rgba(231, 196, 106, 0.14)'
        rrect(x + 40, h * 0.08, 64, 84, 4); ctx.fill()
        ctx.fillStyle = 'rgba(12, 24, 20, 0.55)'
        rrect(x + 46, h * 0.08 + 6, 52, 72, 3); ctx.fill()
        ctx.fillStyle = 'rgba(231, 196, 106, 0.1)'
        ctx.beginPath()
        ctx.arc(x + 72, h * 0.08 + 40, 16, 0, Math.PI * 2)
        ctx.fill()
      }
      // wainscot band
      ctx.fillStyle = '#2c2016'
      ctx.fillRect(0, h * 0.34, w, h * 0.08)
      ctx.fillStyle = 'rgba(231, 196, 106, 0.18)'
      ctx.fillRect(0, h * 0.34, w, 2)
      // hanging lamps, mid parallax, gentle sway
      const px3 = (g.scroll * 0.6) % 260
      for (let i = -1; i < w / 260 + 1; i += 1) {
        const x = i * 260 + px3 + 130
        const sway = g.reduced ? 0 : Math.sin(now / 900 + i * 1.7) * 4
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + sway, h * 0.1); ctx.stroke()
        const lx = x + sway
        const ly = h * 0.1
        const glow = ctx.createRadialGradient(lx, ly + 12, 2, lx, ly + 12, 46)
        glow.addColorStop(0, 'rgba(255, 209, 102, 0.5)')
        glow.addColorStop(1, 'rgba(255, 209, 102, 0)')
        ctx.fillStyle = glow
        ctx.beginPath(); ctx.arc(lx, ly + 12, 46, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#caa24a'
        ctx.beginPath()
        ctx.moveTo(lx - 11, ly + 8); ctx.lineTo(lx + 11, ly + 8); ctx.lineTo(lx + 6, ly - 4); ctx.lineTo(lx - 6, ly - 4)
        ctx.closePath(); ctx.fill()
        ctx.fillStyle = '#ffe9ad'
        ctx.beginPath(); ctx.arc(lx, ly + 11, 4.5, 0, Math.PI * 2); ctx.fill()
      }
      // walnut floor
      const floor = ctx.createLinearGradient(0, h * 0.42, 0, h)
      floor.addColorStop(0, '#3b2c22')
      floor.addColorStop(1, '#6b4f3c')
      ctx.fillStyle = floor
      ctx.fillRect(0, h * 0.42, w, h * 0.58)
      // scrolling plank seams with perspective
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'
      ctx.lineWidth = 2
      const seam = (g.scroll % 90)
      for (let i = -1; i < w / 90 + 2; i += 1) {
        const x = i * 90 + seam
        ctx.beginPath(); ctx.moveTo(x, h * 0.42); ctx.lineTo(x - 30, h); ctx.stroke()
      }
      // lane guides
      for (let i = 0; i < LANES; i += 1) {
        ctx.strokeStyle = 'rgba(231, 196, 106, 0.07)'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(0, laneY(i) + 8); ctx.lineTo(w, laneY(i) + 8); ctx.stroke()
      }
    }

    const drawWaiter = (x, y, tilt) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(-1, 1) // faces the travel direction (leftward = forward in RTL)
      const stride = g.reduced ? 0 : Math.sin(g.scroll / 20) * 10
      // legs
      ctx.strokeStyle = '#1d2b3a'
      ctx.lineWidth = 5.5
      ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(stride, 25); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(-stride, 25); ctx.stroke()
      // shirt body + dark vest
      ctx.fillStyle = '#f6f4ef'
      ctx.beginPath()
      ctx.moveTo(-12, 7); ctx.lineTo(12, 7); ctx.lineTo(9, -21); ctx.lineTo(-9, -21)
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#22333f'
      ctx.beginPath()
      ctx.moveTo(-12, 7); ctx.lineTo(-3, 7); ctx.lineTo(-3, -21); ctx.lineTo(-9, -21)
      ctx.closePath(); ctx.fill()
      ctx.beginPath()
      ctx.moveTo(12, 7); ctx.lineTo(3, 7); ctx.lineTo(3, -21); ctx.lineTo(9, -21)
      ctx.closePath(); ctx.fill()
      // waist apron
      ctx.fillStyle = '#7a1f2b'
      ctx.beginPath()
      ctx.moveTo(-11, 7); ctx.lineTo(11, 7); ctx.lineTo(8, 18); ctx.lineTo(-8, 18)
      ctx.closePath(); ctx.fill()
      // head + hair
      ctx.fillStyle = '#e8b98c'
      ctx.beginPath(); ctx.arc(0, -29, 8, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#243b53'
      ctx.beginPath(); ctx.arc(0, -33, 8, Math.PI, 0); ctx.fill()
      // bow tie
      ctx.fillStyle = '#7a1f2b'
      ctx.beginPath()
      ctx.moveTo(-4, -20); ctx.lineTo(0, -18); ctx.lineTo(4, -20); ctx.lineTo(0, -16)
      ctx.closePath(); ctx.fill()
      // arm + tray (tilts with the wobble meter)
      ctx.strokeStyle = '#e8b98c'
      ctx.lineWidth = 4
      ctx.beginPath(); ctx.moveTo(-6, -15); ctx.lineTo(-21, -27); ctx.stroke()
      ctx.save()
      ctx.translate(-23, -29)
      ctx.rotate(tilt)
      // tray
      ctx.fillStyle = '#d8dde3'
      ctx.beginPath(); ctx.ellipse(0, 0, 21, 4.5, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.beginPath(); ctx.ellipse(0, -1.4, 16, 2.4, 0, 0, Math.PI * 2); ctx.fill()
      // cups riding the tray grow with the combo
      const stack = Math.min(3, 1 + Math.floor(g.combo / 4))
      ctx.fillStyle = brandRef.current
      for (let i = 0; i < stack; i += 1) {
        rrect(i * 12 - (stack * 12) / 2 + 2, -12, 8, 11, 2)
        ctx.fill()
      }
      ctx.restore()
      ctx.restore()
    }

    const drawObstacle = (o, y, now) => {
      ctx.save()
      ctx.translate(o.x, y)
      if (o.kind === 'table') {
        // walnut table with cream runner — reads as a solid, unjumpable block
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.beginPath(); ctx.ellipse(0, 4, 30, 6, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#8a5a3b'
        rrect(-27, -36, 54, 10, 3); ctx.fill()
        ctx.fillStyle = '#f1e4c8'
        ctx.fillRect(-10, -36, 20, 10)
        ctx.fillStyle = '#6d4429'
        ctx.fillRect(-4, -26, 8, 26)
        rrect(-17, -2, 34, 6, 3); ctx.fill()
      } else if (o.kind === 'chair') {
        ctx.fillStyle = 'rgba(0,0,0,0.22)'
        ctx.beginPath(); ctx.ellipse(0, 2, 20, 5, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#5c6f83'
        rrect(-14, -22, 28, 7, 3); ctx.fill()
        rrect(10, -42, 6, 24, 3); ctx.fill()
        ctx.fillStyle = '#46566a'
        ctx.fillRect(-12, -15, 4, 16)
        ctx.fillRect(9, -15, 4, 16)
      } else if (o.kind === 'cart') {
        // rolling service cart — taller than a jump
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.beginPath(); ctx.ellipse(0, 3, 30, 6, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#96a3b1'
        rrect(-24, -46, 48, 7, 3); ctx.fill()
        rrect(-24, -24, 48, 6, 3); ctx.fill()
        ctx.strokeStyle = '#7c8a99'
        ctx.lineWidth = 4
        ctx.beginPath(); ctx.moveTo(-20, -44); ctx.lineTo(-20, -4); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(20, -44); ctx.lineTo(20, -4); ctx.stroke()
        // teapot on top
        ctx.fillStyle = '#d9c9a8'
        ctx.beginPath(); ctx.arc(0, -52, 7, 0, Math.PI * 2); ctx.fill()
        ctx.fillRect(-2, -62, 4, 6)
        // wheels spin
        const a = now / 90
        for (const wx of [-14, 14]) {
          ctx.fillStyle = '#2c333b'
          ctx.beginPath(); ctx.arc(wx, -2, 6, 0, Math.PI * 2); ctx.fill()
          ctx.strokeStyle = '#96a3b1'
          ctx.lineWidth = 1.6
          ctx.beginPath()
          ctx.moveTo(wx - Math.cos(a) * 5, -2 - Math.sin(a) * 5)
          ctx.lineTo(wx + Math.cos(a) * 5, -2 + Math.sin(a) * 5)
          ctx.stroke()
        }
      } else if (o.kind === 'cat') {
        // the wandering cat — soft, clearly alive, clearly jumpable
        ctx.fillStyle = 'rgba(0,0,0,0.2)'
        ctx.beginPath(); ctx.ellipse(0, 3, 18, 4, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#c98d4b'
        ctx.beginPath(); ctx.ellipse(0, -8, 14, 9, 0, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(13, -13, 7, 0, Math.PI * 2); ctx.fill()
        // ears
        ctx.beginPath(); ctx.moveTo(9, -18); ctx.lineTo(11, -25); ctx.lineTo(14, -19); ctx.closePath(); ctx.fill()
        ctx.beginPath(); ctx.moveTo(15, -19); ctx.lineTo(18, -25); ctx.lineTo(19, -17); ctx.closePath(); ctx.fill()
        // tail waves
        const wag = g.reduced ? 0 : Math.sin(now / 200 + o.phase) * 6
        ctx.strokeStyle = '#c98d4b'
        ctx.lineWidth = 4
        ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(-13, -10); ctx.quadraticCurveTo(-22, -18 + wag, -19, -26 + wag); ctx.stroke()
        // face
        ctx.fillStyle = '#2c1d10'
        ctx.beginPath(); ctx.arc(14.5, -14, 1.2, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(11, -14, 1.2, 0, Math.PI * 2); ctx.fill()
      } else {
        // spill — glossy, flat, MUST be jumped
        ctx.fillStyle = 'rgba(210, 160, 60, 0.85)'
        ctx.beginPath(); ctx.ellipse(0, -2, 27, 8, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = 'rgba(255, 235, 190, 0.6)'
        ctx.beginPath(); ctx.ellipse(-7, -4, 9, 3, 0, 0, Math.PI * 2); ctx.fill()
        const sh = g.reduced ? 0 : Math.sin(now / 300 + o.phase) * 2
        ctx.fillStyle = 'rgba(255, 250, 235, 0.5)'
        ctx.beginPath(); ctx.ellipse(9 + sh, -1, 4, 1.6, 0, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore()
    }

    const drawCup = (c, y, now) => {
      ctx.save()
      const bob = g.reduced ? 0 : Math.sin(now / 480 + c.x / 60) * 3
      ctx.translate(c.x, y - 18 + bob)
      if (c.gold) {
        const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 22)
        glow.addColorStop(0, 'rgba(255, 214, 102, 0.4)')
        glow.addColorStop(1, 'rgba(255, 214, 102, 0)')
        ctx.fillStyle = glow
        ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill()
      }
      ctx.fillStyle = c.gold ? '#f3cf6e' : '#ffffff'
      ctx.beginPath()
      ctx.moveTo(-8, -9); ctx.lineTo(8, -9); ctx.lineTo(5, 9); ctx.lineTo(-5, 9)
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = c.gold ? '#b98a2f' : brandRef.current
      ctx.beginPath(); ctx.ellipse(0, -9, 8, 2.6, 0, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = c.gold ? '#f3cf6e' : '#ffffff'
      ctx.lineWidth = 2.4
      ctx.beginPath(); ctx.arc(9, -1, 5, -1.1, 1.1); ctx.stroke()
      if (c.gold && !g.reduced) {
        // rotating sparkle
        const a = now / 300
        ctx.strokeStyle = 'rgba(255, 240, 200, 0.9)'
        ctx.lineWidth = 1.6
        ctx.save()
        ctx.translate(-10, -14)
        ctx.rotate(a)
        ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.moveTo(0, -4); ctx.lineTo(0, 4); ctx.stroke()
        ctx.restore()
      }
      ctx.restore()
    }

    // cat lanes drift — its DRAWN and HIT lane are the same value (fair play)
    const laneOf = (o, now) => {
      if (o.kind !== 'cat') return o.lane
      const f = o.lane + Math.sin(now / 600 + o.phase) * 0.9
      return Math.max(0, Math.min(LANES - 1, f))
    }

    const frame = (now) => {
      g.raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - (g.last || now)) / 1000)
      g.last = now
      const playing = phaseRef.current === 'play'
      const v = speed()

      ctx.save()
      if (g.shake > 0.01 && !g.reduced) {
        ctx.translate((Math.random() - 0.5) * 7 * g.shake, (Math.random() - 0.5) * 7 * g.shake)
      }
      ctx.clearRect(-8, -8, g.w + 16, g.h + 16)
      drawBackdrop(now)

      if (playing) {
        g.stageDist += v * dt
        g.scroll += v * dt
        g.shake = Math.max(0, g.shake - dt * 3)
        g.laneY += (g.lane - g.laneY) * Math.min(1, dt * (g.reduced ? 30 : 13))
        if (g.jump > 0) g.jump = Math.max(0, g.jump - dt * 1.9)
        g.wobble = Math.max(0, g.wobble - dt * 16)
        if (g.invuln > 0) g.invuln -= dt

        g.spawnGap -= v * dt
        if (g.spawnGap <= 0) {
          spawn()
          g.spawnGap = (210 + Math.random() * 190) / stageOf().density + Math.max(0, 90 - g.stageDist / 30)
        }

        const px = playerX()
        const jumpH = Math.sin(Math.PI * (1 - g.jump)) * 64
        for (const o of g.obstacles) {
          o.x += v * dt * (o.kind === 'cart' ? 1.55 : 1)
          if (o.hit || g.invuln > 0) continue
          const ol = laneOf(o, now)
          const sameLane = Math.abs(ol - g.laneY) < 0.42
          const clears = g.jump > 0.12 && JUMPABLE[o.kind] && jumpH > 26
          if (sameLane && !clears && Math.abs(o.x - px) < 26) {
            o.hit = true
            g.combo = 0
            g.wobble = Math.min(140, g.wobble + HIT_WOBBLE)
            g.shake = 0.8
            puff(o.x, laneY(ol) - 10, 'rgba(255,255,255,0.6)', 8, 30)
            play('capture', { gain: 0.8 })
            if (o.kind === 'table' && g.jump > 0.12 && !g.taughtTable) {
              g.taughtTable = true
              toastRef.current(tRef.current.tableNoJump, 'bad')
            }
            if (g.wobble >= 100) hitLife()
          }
        }
        g.obstacles = g.obstacles.filter((o) => o.x < g.w + 90)

        const pyNow = laneY(g.laneY) - jumpH
        for (const c of g.cups) {
          c.x += v * dt
          if (c.taken) continue
          if (Math.abs(c.lane - g.laneY) < 0.5 && Math.abs(c.x - px) < 30 && Math.abs((laneY(c.lane) - 18) - pyNow) < 48) {
            c.taken = true
            g.combo += 1
            g.cupCount += 1
            const gain = (c.gold ? GOLD_POINTS : CUP_POINTS) * multiplier()
            g.cupPts += gain
            puff(c.x, laneY(c.lane) - 18, c.gold ? 'rgba(255,214,102,0.9)' : 'rgba(255,255,255,0.8)', c.gold ? 12 : 6, 50)
            play(c.gold ? 'turn' : 'card', { gain: c.gold ? 0.9 : 0.6 })
            if (c.gold) toastRef.current(tRef.current.goldCup, 'good')
            const nm = namesRef.current
            g.floats.push({
              x: c.x,
              y: laneY(c.lane) - 26,
              life: 1,
              label: nm.length && !c.gold ? nm[Math.floor(Math.random() * nm.length)] : `+${gain}`,
              gold: c.gold,
            })
          }
        }
        g.cups = g.cups.filter((c) => !c.taken && c.x < g.w + 90)

        // stage complete?
        if (!g.clearing && g.stageDist >= g.goalPx) {
          g.clearing = true
          stageClearedRef.current()
        }

        // React sync only when a displayed value actually changed
        const sc = scoreNow(g)
        if (sc !== g.uiScore) {
          g.uiScore = sc
          setScore(sc)
          onScoreRef.current?.(sc)
        }
        const wb = Math.round(Math.min(100, g.wobble))
        if (wb !== g.uiWobble) { g.uiWobble = wb; setWobble(wb) }
        const m = multiplier()
        if (m !== g.uiMult) { g.uiMult = m; setMult(m) }
        const pr = Math.round(Math.min(1, g.stageDist / g.goalPx) * 100)
        if (pr !== g.uiProg) { g.uiProg = pr; setProg(pr) }
      }

      // ---- actors (painter's order: far lanes behind the waiter) ----
      const px = playerX()
      const jumpH = Math.sin(Math.PI * (1 - g.jump)) * 64
      const order = [...g.obstacles].sort((a, b) => laneOf(a, now) - laneOf(b, now))
      for (const o of order) if (laneOf(o, now) <= g.laneY) drawObstacle(o, laneY(laneOf(o, now)), now)
      for (const c of g.cups) drawCup(c, laneY(c.lane), now)
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.beginPath()
      ctx.ellipse(px, laneY(g.laneY) + 24, 16 - jumpH * 0.1, 5 - jumpH * 0.03, 0, 0, Math.PI * 2)
      ctx.fill()
      if (g.invuln <= 0 || Math.floor(now / 90) % 2 === 0) {
        drawWaiter(px, laneY(g.laneY) - jumpH, Math.min(0.55, (g.wobble / 100) * 0.55) * (g.reduced ? 0.4 : 1))
      }
      for (const o of order) if (laneOf(o, now) > g.laneY) drawObstacle(o, laneY(laneOf(o, now)), now)

      // dust / sparkle bits
      for (const p of g.puffs) {
        p.t -= dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vy += 220 * dt
        ctx.globalAlpha = Math.max(0, p.t / p.life)
        ctx.fillStyle = p.color
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
      g.puffs = g.puffs.filter((p) => p.t > 0)

      // floating labels (menu names / points)
      for (const f of g.floats) {
        f.life -= dt * 1.1
        f.y -= dt * 42
        f.x += v * dt * (playing ? 1 : 0)
        ctx.save()
        ctx.globalAlpha = Math.max(0, f.life)
        ctx.fillStyle = f.gold ? '#ffd166' : '#ffe9a8'
        ctx.font = `${f.gold ? 800 : 600} ${f.gold ? 17 : 14}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText(f.label, f.x, f.y)
        ctx.restore()
      }
      g.floats = g.floats.filter((f) => f.life > 0)
      ctx.restore()
    }

    g.raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(g.raf)
      ro?.disconnect()
      window.removeEventListener('resize', resize)
      gRef.current = null
    }
    // one-shot engine: gameplay state lives in the ref, never in deps
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- input: swipe = lane, tap = jump ----
  const ptr = useRef(null)
  const hop = (dir) => {
    const g = gRef.current
    if (!g || phaseRef.current !== 'play') return
    const next = Math.max(0, Math.min(LANES - 1, g.lane + dir))
    if (next === g.lane) return
    g.lane = next
    g.wobble = Math.min(140, g.wobble + LANE_WOBBLE)
    play('move', { gain: 0.5 })
  }
  const jump = () => {
    const g = gRef.current
    if (!g || phaseRef.current !== 'play' || g.jump > 0) return
    g.jump = 1
    play('click', { gain: 0.6 })
  }
  const onDown = (e) => { ptr.current = { y: e.clientY, x: e.clientX, t: performance.now() } }
  const onUp = (e) => {
    const p = ptr.current
    ptr.current = null
    if (!p) return
    const dy = e.clientY - p.y
    if (Math.abs(dy) > 26) hop(dy > 0 ? 1 : -1)
    else jump()
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowUp') hop(-1)
      else if (e.key === 'ArrowDown') hop(1)
      else if (e.key === ' ' || e.key === 'ArrowLeft') jump()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // chrome
  // -------------------------------------------------------------------------
  const g = gRef.current
  const curStage = g ? g.stage : stageNo - 1

  return (
    <div className="arc-root" dir={lang === 'en' ? 'ltr' : 'rtl'} style={{ '--arc-brand': brand }}>
      <canvas ref={cvsRef} className="arc-canvas" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { ptr.current = null }} />

      {phase === 'play' && (
        <div className="arc-hud">
          <span className="arc-pill arc-pill-stage">{t.stageOf(stageNo)}</span>
          <Hearts lives={lives} />
          {mult > 1 && <span key={mult} className="arc-pill arc-combo">x{fmt(mult)}</span>}
          <span className={`arc-prog${prog >= 100 ? ' done' : ''}`} aria-label={t.stageOf(stageNo)}>
            <i style={{ '--p': Math.min(1, prog / 100) }} />
          </span>
          <span className={`arc-pill${wobble > 70 ? ' is-warn' : ''}`}>{t.balance} {fmt(100 - wobble)}%</span>
        </div>
      )}

      {banner && phase === 'play' && (
        <div key={banner.key} className="arc-banner">
          <span className="arc-banner-kicker">{t.stageOf(banner.n)}</span>
          <span className="arc-banner-title">{fmt(banner.n)}</span>
          {banner.line && <span className="arc-banner-line">{t.newIn}: {banner.line}</span>}
        </div>
      )}
      {toast && (
        <div key={toast.key} className={`arc-toast ${toast.tone || ''}`}><span>{toast.text}</span></div>
      )}

      {phase === 'ready' && (
        <div className="arc-veil">
          <div className="arc-card">
            <span className="arc-emblem" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round">
                <ellipse cx="12" cy="14" rx="9" ry="2.4" fill="rgba(255,255,255,0.25)" />
                <path d="M5 14v-1.2C5 9 8 6.6 12 6.6s7 2.4 7 6.2V14" />
                <path d="M12 6.6V5" />
                <circle cx="12" cy="4" r="1" fill="#fff" />
              </svg>
            </span>
            <h3 className="arc-title">{t.title}</h3>
            <p className="arc-line">{t.how}</p>
            <div className="arc-actions">
              {resume ? (
                <>
                  <button type="button" className="arc-btn gold" onClick={() => startRun(resume.stage - 1, resume.score)}>{t.resume(resume.stage)}</button>
                  <button type="button" className="arc-btn ghost" onClick={() => startRun(0, 0)}>{t.fresh}</button>
                </>
              ) : (
                <button type="button" className="arc-btn" onClick={() => startRun(0, 0)}><Icon name="play" size={16} /> {t.start}</button>
              )}
            </div>
            {best > 0 && <p className="arc-sub">{t.best}: {fmt(best)}</p>}
          </div>
        </div>
      )}

      {phase === 'cleared' && clearedInfo && (
        <div className="arc-veil">
          <div className="arc-card">
            <span className="arc-kicker">{t.wellDone}</span>
            <h3 className="arc-title">{t.cleared(stageNo)}</h3>
            <Stars n={clearedInfo.stars} />
            <div className="arc-statrow">
              <span className="arc-stat"><b>{fmt(score)}</b><span>{t.points}</span></span>
              <span className="arc-stat"><b>{fmt(clearedInfo.cups)}</b><span>{t.cups}</span></span>
            </div>
            <div className="arc-actions">
              <button type="button" className="arc-btn gold" onClick={() => startStage(curStage + 1, gRef.current ? gRef.current.bank : score)}>{t.nextStage}</button>
              {typeof onExit === 'function' && (
                <button type="button" className="arc-btn ghost" onClick={onExit}>{t.exit}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {phase === 'over' && (
        <div className="arc-veil">
          <div className="arc-card">
            <h3 className="arc-title">{t.over}</h3>
            <div className="arc-big">{fmt(score)}</div>
            <p className="arc-line">{playerName ? `${playerName}، ` : ''}{t.overLine(stageNo)}</p>
            <div className="arc-statrow">
              <span className="arc-stat"><b>{fmt(best)}</b><span>{t.best}</span></span>
              <span className="arc-stat"><b>{fmt(stageNo)}</b><span>{t.stageReached}</span></span>
            </div>
            <div className="arc-actions">
              <button type="button" className="arc-btn" onClick={() => startRun(curStage, gRef.current ? gRef.current.bank : 0)}>{t.again}</button>
              <button type="button" className="arc-btn ghost" onClick={() => startRun(0, 0)}>{t.fresh}</button>
            </div>
          </div>
        </div>
      )}

      {phase === 'victory' && (
        <div className="arc-veil">
          <div className="arc-card">
            <span className="arc-kicker">{t.grandHall}</span>
            <h3 className="arc-title">{t.victory}</h3>
            <Stars n={3} />
            <div className="arc-big">{fmt(score)}</div>
            <p className="arc-line">{playerName ? `${playerName}، ` : ''}{t.victoryLine}</p>
            <p className="arc-sub">{t.best}: {fmt(Math.max(best, score))}</p>
            <div className="arc-actions">
              <button type="button" className="arc-btn gold" onClick={() => startRun(0, 0)}>{t.again}</button>
              {typeof onExit === 'function' && (
                <button type="button" className="arc-btn ghost" onClick={onExit}>{t.exit}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
