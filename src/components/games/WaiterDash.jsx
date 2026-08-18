// «سباق النادل» — a staged three-lane runner. The waiter carries a tray; swipe
// up/down to hop lanes, tap to jump over what can be cleared. Cups score, and
// each obstacle shakes the tray: the balance meter climbs on every hit and
// drops the plates (a life) when it tops out, then decays while you run clean.
//
// STAGES («مناوبات»): a real difficulty ladder. Each shift adds a NEW hazard and
// runs faster/denser than the last — the hall, the rush, the kitchen (oncoming
// waiters), the terrace (double-wide carts), then escalating peak hours. A stage
// clears on distance; a banner marks the beat; the reached stage is saved via
// onProgress so a returning guest can continue from it (resumeState).
//
// Contract: renders ONLY the play area — the hub owns the chrome and closing.
// Pure canvas (paths only, no emoji), Latin digits, dpr-aware, one rAF loop.
// The canvas fills its own event mailbox (`g.ev`); a light React sync loop reads
// it, so setState is never called from inside the 60fps frame.
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { play } from '../../lib/gameSounds.js'
import '../../styles/arcade-a.css'

const LANES = 3
const START_LIVES = 3
const CUP_POINTS = 5
const GOLD_POINTS = 25
const HIT_WOBBLE = 52
const LANE_WOBBLE = 8
const DROP_WOBBLE = 100

// The shift ladder. `dist` is the in-stage distance that clears it; `kinds` are
// the obstacle types alive in that shift (later shifts inherit and extend);
// `speed` is the base run speed. Past the last entry the game keeps escalating.
const STAGES = [
  { ar: 'الصالة', en: 'The hall', dist: 2100, kinds: ['table', 'spill'], speed: 244 },
  { ar: 'الزحمة', en: 'The rush', dist: 2500, kinds: ['table', 'spill', 'chair'], speed: 286 },
  { ar: 'المطبخ', en: 'The kitchen', dist: 2900, kinds: ['table', 'spill', 'chair', 'waiter'], speed: 330 },
  { ar: 'الشرفة', en: 'The terrace', dist: 3300, kinds: ['table', 'spill', 'chair', 'waiter', 'cart'], speed: 374 },
  { ar: 'ذروة المساء', en: 'Peak hour', dist: 3700, kinds: ['table', 'spill', 'chair', 'waiter', 'cart'], speed: 418 },
]
const JUMPABLE = new Set(['spill', 'chair'])

function stageAt(i) {
  if (i < STAGES.length) return STAGES[i]
  const base = STAGES[STAGES.length - 1]
  const over = i - STAGES.length + 1
  return { ar: base.ar, en: base.en, dist: base.dist + over * 260, kinds: base.kinds, speed: base.speed + over * 26 }
}
const stageLabel = (n, lang) => (lang === 'en' ? stageAt(n - 1).en : stageAt(n - 1).ar)

const TXT = {
  ar: {
    title: 'سباق النادل',
    how: 'اسحب لأعلى أو لأسفل لتغيير المسار، والمس الشاشة للقفز. اجمع الأكواب وتفادَ العوائق. كل اصطدام يهزّ الصينية، وامتلاؤها يُسقط طبقاً.',
    start: 'ابدأ الجري',
    again: 'العب مجدداً',
    cont: 'تابع من المرحلة',
    fresh: 'من البداية',
    over: 'سقطت الصينية',
    lives: 'المحاولات',
    balance: 'اتزان الصينية',
    stage: 'المرحلة',
    reached: 'أبعد مرحلة',
    cups: 'الأكواب',
    best: 'أفضل نتيجة',
    record: 'رقم قياسي جديد',
    got: 'نقطة',
    cleared: 'انتهت المناوبة',
    swipe: 'اسحب للأعلى/الأسفل',
    tap: 'المس للقفز',
    hintTable: 'الطاولة لا تُقفز، غيّر مسارك لتفاديها',
    hintWaiter: 'نادل قادم بسرعة، أفسح له المسار',
    hintCart: 'عربة عريضة تسدّ مسارين، خذ المسار المفتوح',
    goldCup: 'كوب ذهبي',
  },
  en: {
    title: 'Waiter Dash',
    how: 'Swipe up or down to change lane, tap to jump what can be cleared. Collect cups and dodge the rest. Every hit rocks the tray.',
    start: 'Start running',
    again: 'Play again',
    cont: 'Continue from stage',
    fresh: 'From the start',
    over: 'Tray dropped',
    lives: 'Lives',
    balance: 'Tray balance',
    stage: 'Stage',
    reached: 'Best stage',
    cups: 'Cups',
    best: 'Best score',
    record: 'New record',
    got: 'points',
    cleared: 'Shift cleared',
    swipe: 'Swipe up/down',
    tap: 'Tap to jump',
    hintTable: 'Tables cannot be jumped, so change lane to dodge',
    hintWaiter: 'A waiter is closing fast, so clear the lane',
    hintCart: 'A wide cart blocks two lanes, so take the open one',
    goldCup: 'Golden cup',
  },
}

const BEST_KEY = 'rbt_waiterdash_best'
const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch (_) { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)) } catch (_) { /* private mode */ } }
const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

function Heart({ lost, hit }) {
  return (
    <svg className={`arc-life${lost ? ' is-lost' : ''}${hit ? ' is-hit' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 21s-7.5-4.7-10-9.3C.4 8.4 2 4.7 5.4 4.7c2 0 3.4 1.2 4.2 2.5.4.6 1.4.6 1.8 0 .8-1.3 2.2-2.5 4.2-2.5 3.4 0 5 3.7 3.4 7C19.5 16.3 12 21 12 21Z" />
    </svg>
  )
}

export default function WaiterDash({
  onScore, onExit, onProgress, resumeState,
  lang = 'ar', brand = '#0e7490', items = [], playerName = '',
}) {
  const t = TXT[lang] || TXT.ar
  const cvsRef = useRef(null)
  const gRef = useRef(null)
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  const phaseRef = useRef('ready')

  const resumeStage = Math.max(0, Math.floor(Number(resumeState?.stage) || 0))
  const [phase, setPhase] = useState('ready')
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(START_LIVES)
  const [lostAt, setLostAt] = useState(-1)   // which heart just popped
  const [wobble, setWobble] = useState(0)
  const [stage, setStage] = useState(1)
  const [stageName, setStageName] = useState('')
  const [prog, setProg] = useState(0)        // 0..1 through the current stage
  const [banner, setBanner] = useState(null) // { n, name }
  const [toasts, setToasts] = useState([])
  const [hint, setHint] = useState('')
  const [reached, setReached] = useState(1)
  const [cups, setCups] = useState(0)
  const [best, setBest] = useState(readBest)
  const toastId = useRef(0)
  const bannerTimer = useRef(null)
  const hintTimer = useRef(null)

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])
  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => () => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    if (hintTimer.current) clearTimeout(hintTimer.current)
  }, [])

  // Real menu names float up when a cup is collected — no invented facts.
  const namesRef = useRef([])
  useEffect(() => {
    namesRef.current = (items || [])
      .map((i) => String((lang === 'en' ? i?.nameEn : i?.nameAr) || i?.nameAr || i?.nameEn || '').trim())
      .filter((n) => n && n.length <= 16)
      .slice(0, 24)
  }, [items, lang])

  const pushToast = (text, kind) => {
    toastId.current += 1
    const id = toastId.current
    setToasts((list) => [...list.slice(-2), { id, text, kind }])
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 1100)
  }
  const showBanner = (n, name) => {
    setBanner({ n, name })
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    bannerTimer.current = setTimeout(() => setBanner(null), 1650)
  }
  const showHint = (text) => {
    setHint(text)
    if (hintTimer.current) clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setHint(''), 2500)
  }

  const start = (fromStage = 0) => {
    const g = gRef.current
    if (!g) return
    const idx = Math.max(0, fromStage - 1)
    g.obstacles = []
    g.cups = []
    g.floats = []
    g.stageIdx = idx
    g.stageDist = 0
    g.dist = 0
    g.cupCount = 0
    g.lane = 1
    g.laneY = 1
    g.jump = 0
    g.wobble = 0
    g.lives = START_LIVES
    g.invuln = 0.6
    g.spawnGap = 140 * g.S
    g.scroll = 0
    g.last = 0
    g.uiScore = 0
    g.uiWobble = 0
    g.reached = idx + 1
    g.seenKinds = new Set()
    g.ev = freshEvents()
    setScore(0)
    setLives(START_LIVES)
    setLostAt(-1)
    setWobble(0)
    setStage(idx + 1)
    setStageName(stageLabel(idx + 1, lang))
    setProg(0)
    setReached(idx + 1)
    setCups(0)
    onScoreRef.current?.(0)
    setPhase('play')
    play('deal', { gain: 0.5 })
    if (idx > 0) showBanner(idx + 1, stageLabel(idx + 1, lang))
  }

  useEffect(() => {
    const cvs = cvsRef.current
    if (!cvs) return undefined
    const ctx = cvs.getContext('2d')
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const g = {
      obstacles: [], cups: [], floats: [], dist: 0, stageDist: 0, stageIdx: 0, cupCount: 0,
      lane: 1, laneY: 1, jump: 0, wobble: 0, lives: START_LIVES, invuln: 0,
      spawnGap: 0, scroll: 0, last: 0, raf: 0, w: 0, h: 0, reduced, S: 1,
      uiScore: 0, uiWobble: 0, reached: 1, seenKinds: new Set(), ev: freshEvents(),
    }
    gRef.current = g

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      g.w = cvs.clientWidth || 1
      g.h = cvs.clientHeight || 1
      cvs.width = Math.round(g.w * dpr)
      cvs.height = Math.round(g.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.S = Math.max(0.82, Math.min(2.2, g.h / 720))
    }
    resize()
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null
    ro?.observe(cvs)
    window.addEventListener('resize', resize)

    // roundRect is missing on iOS Safari < 16.4 — a lot of diners still run it
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

    const laneY = (i) => g.h * (0.44 + i * 0.185)
    const playerX = () => g.w * (lang === 'en' ? 0.26 : 0.74)
    const fwd = () => (lang === 'en' ? 1 : -1)
    const cfg = () => stageAt(g.stageIdx)
    const speed = () => cfg().speed * g.S * (1 + Math.min(0.5, g.stageDist / (cfg().dist * 3)))
    const covers = (o, laneIdx) => laneIdx >= o.lane && laneIdx <= o.lane + (o.span || 1) - 1

    const spawn = () => {
      const kinds = cfg().kinds
      const kind = kinds[Math.floor(Math.random() * kinds.length)]
      const wide = kind === 'cart'
      let blocked = Math.floor(Math.random() * LANES)
      let span = 1
      if (wide) { blocked = Math.random() < 0.5 ? 0 : 1; span = 2 }
      const speedMul = kind === 'waiter' ? 1.7 : 1
      g.obstacles.push({ x: -80 * g.S, lane: blocked, span, kind, speedMul })
      // first sighting of a dodge-only hazard: teach it (trap 4 — say the rule)
      if (!g.seenKinds.has(kind)) {
        g.seenKinds.add(kind)
        if (kind === 'table') g.ev.hint = t.hintTable
        else if (kind === 'waiter') g.ev.hint = t.hintWaiter
        else if (kind === 'cart') g.ev.hint = t.hintCart
      }
      // a cup in a lane the obstacle leaves open
      if (Math.random() < 0.6) {
        let l = Math.floor(Math.random() * LANES)
        let guard = 0
        while (covers({ lane: blocked, span }, l) && guard < 6) { l = (l + 1) % LANES; guard += 1 }
        const gold = Math.random() < 0.12
        g.cups.push({ x: -80 * g.S - 40 - Math.random() * 130, lane: l, taken: false, gold })
      }
    }

    const drawWaiter = (x, y, tilt) => {
      const S = g.S
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(fwd(), 1)
      ctx.strokeStyle = '#243b53'
      ctx.lineWidth = 5 * S
      ctx.lineCap = 'round'
      const stride = g.reduced ? 0 : Math.sin(g.scroll / 22) * 9 * S
      ctx.beginPath(); ctx.moveTo(0, 6 * S); ctx.lineTo(stride, 24 * S); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, 6 * S); ctx.lineTo(-stride, 24 * S); ctx.stroke()
      ctx.fillStyle = '#f6f4ef'
      ctx.beginPath()
      ctx.moveTo(-11 * S, 6 * S); ctx.lineTo(11 * S, 6 * S); ctx.lineTo(8 * S, -20 * S); ctx.lineTo(-8 * S, -20 * S)
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#1f2d3d'
      ctx.fillRect(-3 * S, -20 * S, 6 * S, 26 * S)
      ctx.fillStyle = '#e8b98c'
      ctx.beginPath(); ctx.arc(0, -28 * S, 8 * S, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#243b53'
      ctx.beginPath(); ctx.arc(0, -32 * S, 8 * S, Math.PI, 0); ctx.fill()
      ctx.strokeStyle = '#e8b98c'
      ctx.lineWidth = 4 * S
      ctx.beginPath(); ctx.moveTo(-6 * S, -14 * S); ctx.lineTo(-20 * S, -26 * S); ctx.stroke()
      ctx.save()
      ctx.translate(-22 * S, -28 * S)
      ctx.rotate(tilt)
      ctx.fillStyle = '#c8cdd4'
      ctx.beginPath(); ctx.ellipse(0, 0, 20 * S, 4 * S, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = brand
      for (let i = -1; i <= 1; i++) { rrect(i * 11 * S - 4 * S, -11 * S, 8 * S, 11 * S, 2 * S); ctx.fill() }
      ctx.restore()
      ctx.restore()
    }

    const drawObstacle = (o, y) => {
      const S = g.S
      ctx.save()
      ctx.translate(o.x, y)
      if (o.kind === 'table') {
        ctx.fillStyle = '#8a5a3b'
        rrect(-26 * S, -34 * S, 52 * S, 9 * S, 3 * S); ctx.fill()
        ctx.fillRect(-4 * S, -26 * S, 8 * S, 26 * S)
        rrect(-16 * S, -2 * S, 32 * S, 6 * S, 3 * S); ctx.fill()
      } else if (o.kind === 'chair') {
        ctx.fillStyle = '#6b7a8f'
        rrect(-14 * S, -22 * S, 28 * S, 7 * S, 3 * S); ctx.fill()
        rrect(10 * S, -40 * S, 6 * S, 22 * S, 3 * S); ctx.fill()
        ctx.fillRect(-12 * S, -15 * S, 4 * S, 15 * S)
        ctx.fillRect(9 * S, -15 * S, 4 * S, 15 * S)
      } else if (o.kind === 'waiter') {
        ctx.fillStyle = '#b23b4e'
        ctx.beginPath()
        ctx.moveTo(-10 * S, 6 * S); ctx.lineTo(10 * S, 6 * S); ctx.lineTo(7 * S, -18 * S); ctx.lineTo(-7 * S, -18 * S)
        ctx.closePath(); ctx.fill()
        ctx.fillStyle = '#e8b98c'
        ctx.beginPath(); ctx.arc(0, -26 * S, 7 * S, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#33202a'
        ctx.beginPath(); ctx.arc(0, -29 * S, 7 * S, Math.PI, 0); ctx.fill()
        ctx.fillStyle = '#d7dbe0'
        ctx.beginPath(); ctx.ellipse(0, -20 * S, 15 * S, 3 * S, 0, 0, Math.PI * 2); ctx.fill()
      } else if (o.kind === 'cart') {
        const w = 30 * (o.span || 2) * S
        ctx.fillStyle = '#5a4632'
        rrect(-w / 2, -40 * S, w, 30 * S, 5 * S); ctx.fill()
        ctx.fillStyle = brand
        rrect(-w / 2 + 5 * S, -36 * S, w - 10 * S, 9 * S, 3 * S); ctx.fill()
        ctx.fillStyle = '#2a2018'
        ctx.beginPath(); ctx.arc(-w / 2 + 12 * S, -6 * S, 6 * S, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(w / 2 - 12 * S, -6 * S, 6 * S, 0, Math.PI * 2); ctx.fill()
      } else {
        ctx.fillStyle = 'rgba(210, 160, 60, 0.85)'
        ctx.beginPath(); ctx.ellipse(0, -2 * S, 26 * S, 8 * S, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = 'rgba(255, 235, 190, 0.6)'
        ctx.beginPath(); ctx.ellipse(-7 * S, -4 * S, 9 * S, 3 * S, 0, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore()
    }

    const drawCup = (c, y) => {
      const S = g.S
      ctx.save()
      ctx.translate(c.x, y - 16 * S + Math.sin(g.scroll / 30 + c.x / 60) * (g.reduced ? 0 : 3 * S))
      if (c.gold) {
        const gg = ctx.createLinearGradient(0, -10 * S, 0, 10 * S)
        gg.addColorStop(0, '#ffe9a8'); gg.addColorStop(1, '#d3a13a')
        ctx.fillStyle = gg
        ctx.shadowColor = 'rgba(231,196,106,.8)'; ctx.shadowBlur = 12 * S
      } else {
        ctx.fillStyle = '#ffffff'
      }
      ctx.beginPath()
      ctx.moveTo(-8 * S, -9 * S); ctx.lineTo(8 * S, -9 * S); ctx.lineTo(5 * S, 9 * S); ctx.lineTo(-5 * S, 9 * S)
      ctx.closePath(); ctx.fill()
      ctx.shadowBlur = 0
      ctx.fillStyle = c.gold ? '#8a5f14' : brand
      ctx.beginPath(); ctx.ellipse(0, -9 * S, 8 * S, 2.6 * S, 0, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = c.gold ? '#ffe9a8' : '#ffffff'
      ctx.lineWidth = 2.4 * S
      ctx.beginPath(); ctx.arc(9 * S, -1 * S, 5 * S, -1.1, 1.1); ctx.stroke()
      ctx.restore()
    }

    const frame = (now) => {
      g.raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - (g.last || now)) / 1000)
      g.last = now
      const playing = phaseRef.current === 'play'
      const S = g.S
      const v = speed()

      // ---- floor ----
      ctx.clearRect(0, 0, g.w, g.h)
      const wall = ctx.createLinearGradient(0, 0, 0, g.h * 0.36)
      wall.addColorStop(0, '#0c1a18'); wall.addColorStop(1, '#173026')
      ctx.fillStyle = wall
      ctx.fillRect(0, 0, g.w, g.h * 0.36)
      const floor = ctx.createLinearGradient(0, g.h * 0.36, 0, g.h)
      floor.addColorStop(0, '#3b2c22'); floor.addColorStop(1, '#6b4f3c')
      ctx.fillStyle = floor
      ctx.fillRect(0, g.h * 0.36, g.w, g.h * 0.64)
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'
      ctx.lineWidth = 2
      for (let i = -1; i < 16; i++) {
        const x = ((i * 90 * S + (g.scroll % (90 * S))) + g.w) % (g.w + 180 * S) - 90 * S
        ctx.beginPath(); ctx.moveTo(x, g.h * 0.36); ctx.lineTo(x - 30 * S, g.h); ctx.stroke()
      }
      for (let i = 0; i < LANES; i++) {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(0, laneY(i) + 6 * S); ctx.lineTo(g.w, laneY(i) + 6 * S); ctx.stroke()
      }

      if (playing) {
        g.dist += v * dt
        g.stageDist += v * dt
        g.scroll += v * dt
        g.laneY += (g.lane - g.laneY) * Math.min(1, dt * (g.reduced ? 30 : 13))
        if (g.jump > 0) g.jump = Math.max(0, g.jump - dt * 1.9)
        g.wobble = Math.max(0, g.wobble - dt * 15)
        if (g.invuln > 0) g.invuln -= dt

        if (g.stageDist >= cfg().dist) {
          g.stageIdx += 1
          g.stageDist = 0
          g.obstacles = []
          g.invuln = Math.max(g.invuln, 1.0)
          g.reached = Math.max(g.reached, g.stageIdx + 1)
          g.ev.stageClear = g.stageIdx + 1
          play('win', { gain: 0.5 })
        }

        g.spawnGap -= v * dt
        if (g.spawnGap <= 0) {
          spawn()
          const dens = Math.max(0, 130 - g.stageIdx * 14 - g.stageDist / 30)
          g.spawnGap = (150 + Math.random() * 190 + dens) * S
        }

        const px = playerX()
        const jumpH = Math.sin(Math.PI * (1 - g.jump)) * 64 * S
        const py = laneY(g.laneY) - jumpH

        for (const o of g.obstacles) {
          o.x += v * (o.speedMul || 1) * dt
          if (o.hit || g.invuln > 0) continue
          const centre = o.lane + ((o.span || 1) - 1) / 2
          const sameLane = covers(o, Math.round(g.laneY)) && Math.abs(centre - g.laneY) < 0.62
          const clears = g.jump > 0.12 && JUMPABLE.has(o.kind) && jumpH > 26 * S
          if (sameLane && !clears && Math.abs(o.x - px) < 28 * S) {
            o.hit = true
            g.wobble = Math.min(150, g.wobble + HIT_WOBBLE)
            play('capture', { gain: 0.4 })
            if (g.wobble >= DROP_WOBBLE) {
              g.wobble = 24
              g.lives = Math.max(0, g.lives - 1)
              g.invuln = 1.3
              g.ev.life = g.lives
              play('lose', { gain: 0.5 })
              if (g.lives <= 0) g.ev.end = true
            }
          }
        }
        g.obstacles = g.obstacles.filter((o) => o.x < g.w + 100 * S)

        for (const c of g.cups) {
          c.x += v * dt
          if (c.taken) continue
          if (Math.abs(c.lane - g.laneY) < 0.5 && Math.abs(c.x - px) < 32 * S && Math.abs((laneY(c.lane) - 16 * S) - py) < 52 * S) {
            c.taken = true
            g.cupCount += 1
            const nm = namesRef.current
            g.floats.push({
              x: c.x, y: laneY(c.lane) - 24 * S, life: 1, gold: c.gold,
              label: c.gold ? `+${GOLD_POINTS}` : (nm.length ? nm[Math.floor(Math.random() * nm.length)] : `+${CUP_POINTS}`),
            })
            if (c.gold) { g.ev.gold = true; play('win', { gain: 0.4 }) } else play('click', { gain: 0.55 })
          }
        }
        g.cups = g.cups.filter((c) => !c.taken && c.x < g.w + 100 * S)

        const sc = Math.round(g.dist / 10) + g.cupCount * CUP_POINTS + (g.reached - 1) * 120
        if (sc !== g.uiScore) { g.uiScore = sc; g.ev.score = sc }
        const wb = Math.round(Math.min(100, g.wobble))
        if (wb !== g.uiWobble) { g.uiWobble = wb; g.ev.wobble = wb }
        g.ev.prog = Math.max(0, Math.min(1, g.stageDist / cfg().dist))
      }

      // ---- actors ----
      const order = [...g.obstacles].sort((a, b) => a.lane - b.lane)
      const px = playerX()
      const jumpH = Math.sin(Math.PI * (1 - g.jump)) * 64 * S
      for (const o of order) if (o.lane <= g.laneY) drawObstacle(o, laneY(o.lane))
      for (const c of g.cups) drawCup(c, laneY(c.lane))
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.beginPath()
      ctx.ellipse(px, laneY(g.laneY) + 24 * S, (16 - jumpH * 0.1) * S, (5 - jumpH * 0.03) * S, 0, 0, Math.PI * 2)
      ctx.fill()
      if (g.invuln <= 0 || Math.floor(now / 90) % 2 === 0) {
        drawWaiter(px, laneY(g.laneY) - jumpH, Math.min(0.55, (g.wobble / 100) * 0.55) * (g.reduced ? 0.4 : 1))
      }
      for (const o of order) if (o.lane > g.laneY) drawObstacle(o, laneY(o.lane))

      for (const f of g.floats) {
        f.life -= dt * 1.1
        f.y -= dt * 42 * S
        f.x += v * dt
        ctx.save()
        ctx.globalAlpha = Math.max(0, f.life)
        ctx.fillStyle = f.gold ? '#ffe08a' : '#ffe9a8'
        ctx.font = `700 ${14 * S}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText(f.label, f.x, f.y)
        ctx.restore()
      }
      g.floats = g.floats.filter((f) => f.life > 0)
    }

    g.raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(g.raf)
      ro?.disconnect()
      window.removeEventListener('resize', resize)
      gRef.current = null
    }
    // one-shot engine: gameplay state lives in the ref, never in deps
  }, [brand, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- bridge the canvas event mailbox -> React (own light loop) ----
  useEffect(() => {
    if (phase !== 'play') return undefined
    let raf = 0
    const pump = () => {
      raf = requestAnimationFrame(pump)
      const g = gRef.current
      if (!g || !g.ev) return
      const e = g.ev
      if (e.score >= 0) { const s = e.score; e.score = -1; setScore(s); onScoreRef.current?.(s) }
      if (e.wobble >= 0) { const w = e.wobble; e.wobble = -1; setWobble(w) }
      if (e.prog >= 0) { const p = e.prog; e.prog = -1; setProg(p) }
      if (e.life >= 0) {
        const lv = e.life; e.life = -1
        setLives(lv); setLostAt(lv); setTimeout(() => setLostAt(-1), 500)
      }
      if (e.stageClear > 0) {
        const n = e.stageClear; e.stageClear = -1
        setStage(n); setReached((r) => Math.max(r, n)); setStageName(stageLabel(n, lang))
        showBanner(n, stageLabel(n, lang)); pushToast(t.cleared, 'plain')
        onProgressRef.current?.({ stage: n })
      }
      if (e.gold) { e.gold = false; pushToast(`${t.goldCup} +${GOLD_POINTS}`, 'gold') }
      if (e.hint) { const h = e.hint; e.hint = ''; showHint(h) }
      if (e.end) { e.end = false; finishRun() }
    }
    raf = requestAnimationFrame(pump)
    return () => cancelAnimationFrame(raf)
  }, [phase, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const finishRun = () => {
    const g = gRef.current
    const s = g ? Math.round(g.dist / 10) + g.cupCount * CUP_POINTS + (g.reached - 1) * 120 : score
    const rc = g ? g.reached : reached
    setScore(s)
    setReached(rc)
    setCups(g ? g.cupCount : cups)
    onScoreRef.current?.(s)
    if (s > readBest()) { writeBest(s); setBest(s) }
    // Persist the reached stage (not `done`) so the ready card can offer a continue.
    if (rc > 1) onProgressRef.current?.({ stage: rc })
    setPhase('over')
  }

  // ---- input: swipe = lane, tap = jump ----
  const ptr = useRef(null)
  const hop = (dir) => {
    const g = gRef.current
    if (!g || phaseRef.current !== 'play') return
    const next = Math.max(0, Math.min(LANES - 1, g.lane + dir))
    if (next === g.lane) return
    g.lane = next
    g.wobble = Math.min(150, g.wobble + LANE_WOBBLE)
    play('move', { gain: 0.5 })
  }
  const jump = () => {
    const g = gRef.current
    if (!g || phaseRef.current !== 'play' || g.jump > 0) return
    g.jump = 1
    play('click', { gain: 0.4 })
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
      else if (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') jump()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rtl = lang !== 'en'
  const wobbleHot = wobble > 68

  return (
    <div className="arc-root" dir={rtl ? 'rtl' : 'ltr'} style={{ '--arc-brand': brand }}>
      <canvas
        ref={cvsRef}
        className="arc-canvas"
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => { ptr.current = null }}
      />

      {phase === 'play' && (
        <div className="arc-hud">
          <div className="arc-hud-l">
            <span className="arc-stage">
              <span className="arc-stage-k">{t.stage}</span>
              <span className="arc-stage-n">{fmt(stage)}</span>
              {stageName ? <span className="arc-stage-nm">{stageName}</span> : null}
            </span>
            <span className="arc-track"><i style={{ transform: `scaleX(${prog})` }} /></span>
          </div>
          <div className="arc-hud-r">
            <span className={`arc-chip${wobbleHot ? ' is-warn' : ''}`} aria-label={t.balance}>
              <Icon name="scale" size={14} />{fmt(wobble)}%
            </span>
            <span className="arc-lives" aria-label={`${t.lives} ${lives}`}>
              {Array.from({ length: START_LIVES }).map((_, i) => (
                <Heart key={i} lost={i >= lives} hit={i === lostAt} />
              ))}
            </span>
          </div>
        </div>
      )}

      {phase === 'play' && toasts.length > 0 && (
        <div className="arc-toasts">
          {toasts.map((x) => (
            <span key={x.id} className={`arc-toast${x.kind === 'plain' ? ' is-plain' : ''}`}>{x.text}</span>
          ))}
        </div>
      )}

      {banner && phase === 'play' && (
        <div className="arc-banner">
          <div className="arc-banner-card">
            <span className="arc-banner-k">{t.stage}</span>
            <span className="arc-banner-num">{fmt(banner.n)}</span>
            {banner.name ? <span className="arc-banner-sub">{banner.name}</span> : null}
          </div>
        </div>
      )}

      {hint && phase === 'play' && (
        <div className="arc-hint"><span><Icon name="warning" size={15} />{hint}</span></div>
      )}

      {phase !== 'play' && (
        <div className="arc-veil">
          <div className="arc-card">
            {phase === 'ready' ? (
              <>
                <svg className="arc-emblem" viewBox="0 0 96 96" aria-hidden="true">
                  <circle cx="48" cy="48" r="46" fill="#123c35" stroke="#e7c46a" strokeWidth="2" />
                  <ellipse cx="48" cy="40" rx="30" ry="8" fill="#c8cdd4" />
                  <ellipse cx="48" cy="38" rx="30" ry="8" fill="#e6eaef" />
                  <rect x="34" y="24" width="10" height="15" rx="3" fill={brand} />
                  <rect x="48" y="22" width="10" height="17" rx="3" fill="#ffe9a8" />
                  <path d="M48 44 L48 70" stroke="#8a5f2a" strokeWidth="4" strokeLinecap="round" />
                  <circle cx="48" cy="76" r="7" fill="#e8b98c" />
                </svg>
                <h3 className="arc-card-title">{t.title}</h3>
                <p className="arc-card-line">{t.how}</p>
                <div className="arc-how">
                  <span><Icon name="arrowUpDown" size={15} />{t.swipe}</span>
                  <span><Icon name="arrowUp" size={15} />{t.tap}</span>
                </div>
                {best > 0 ? <p className="arc-sub">{t.best}: {fmt(best)}</p> : null}
                <div className="arc-actions">
                  {resumeStage > 1 ? (
                    <>
                      <button type="button" className="arc-btn is-gold" onClick={() => start(resumeStage)}>
                        <Icon name="play" size={17} />{t.cont} {fmt(resumeStage)}
                      </button>
                      <button type="button" className="arc-btn ghost" onClick={() => start(0)}>{t.fresh}</button>
                    </>
                  ) : (
                    <button type="button" className="arc-btn" onClick={() => start(0)}>
                      <Icon name="play" size={17} />{t.start}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <h3 className="arc-card-title">{t.over}</h3>
                <div className="arc-card-big">{fmt(score)}<em>{t.got}</em></div>
                {score >= best && score > 0 ? (
                  <span className="arc-record"><Icon name="award" size={15} />{t.record}</span>
                ) : (
                  <p className="arc-sub">{t.best}: {fmt(best)}</p>
                )}
                <div className="arc-stats">
                  <span className="arc-stat is-record"><b>{fmt(reached)}</b><em>{t.reached}</em></span>
                  <span className="arc-stat"><b>{fmt(cups)}</b><em>{t.cups}</em></span>
                </div>
                <div className="arc-actions">
                  <button type="button" className="arc-btn" onClick={() => start(0)}>
                    <Icon name="reload" size={17} />{t.again}
                  </button>
                  {reached > 1 ? (
                    <button type="button" className="arc-btn ghost" onClick={() => start(reached)}>
                      {t.cont} {fmt(reached)}
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function freshEvents() {
  return { score: -1, wobble: -1, prog: -1, life: -1, stageClear: -1, gold: false, end: false, hint: '' }
}
