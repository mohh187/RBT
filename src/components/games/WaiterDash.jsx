// «سباق النادل» — an endless runner on three lanes. The waiter carries a tray;
// swipe up/down to hop lanes, tap to jump. Cups score, obstacles shake the tray:
// the wobble meter climbs on every hit and drops the plates (a life) when it
// tops out, then decays while you run clean. Speed escalates with distance.
//
// Contract: renders ONLY the play area — the hub owns the chrome and closing.
// Pure canvas (paths only, no emoji), Latin digits, dpr-aware, one rAF loop.
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'

const LANES = 3
const START_LIVES = 3
const CUP_POINTS = 5
const HIT_WOBBLE = 55
const LANE_WOBBLE = 9

const TXT = {
  ar: {
    title: 'سباق النادل',
    how: 'اسحب لأعلى أو لأسفل لتغيير المسار، والمس الشاشة للقفز. اجمع الأكواب وتفادَ الطاولات والانسكابات — كل اصطدام يهزّ الصينية.',
    start: 'ابدأ الجري',
    again: 'جولة جديدة',
    over: 'سقطت الصينية',
    score: 'النتيجة',
    lives: 'المحاولات',
    balance: 'اتزان الصينية',
    got: 'نقطة',
  },
  en: {
    title: 'Waiter Dash',
    how: 'Swipe up or down to change lane, tap to jump. Collect cups, dodge tables and spills.',
    start: 'Start running',
    again: 'Play again',
    over: 'Tray dropped',
    score: 'Score',
    lives: 'Lives',
    balance: 'Tray balance',
    got: 'points',
  },
}

export default function WaiterDash({ onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '' }) {
  const t = TXT[lang] || TXT.ar
  const cvsRef = useRef(null)
  const gRef = useRef(null)
  const onScoreRef = useRef(onScore)
  const phaseRef = useRef('ready')
  const [phase, setPhase] = useState('ready')
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(START_LIVES)
  const [wobble, setWobble] = useState(0)

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { phaseRef.current = phase }, [phase])

  // Real menu names float up when a cup is collected — no invented facts, just
  // the venue's own dish names as confetti.
  const namesRef = useRef([])
  useEffect(() => {
    namesRef.current = (items || [])
      .map((i) => String((lang === 'en' ? i?.nameEn : i?.nameAr) || i?.nameAr || i?.nameEn || '').trim())
      .filter((n) => n && n.length <= 18)
      .slice(0, 24)
  }, [items, lang])

  const start = () => {
    const g = gRef.current
    if (!g) return
    g.obstacles = []
    g.cups = []
    g.floats = []
    g.dist = 0
    g.cupCount = 0
    g.lane = 1
    g.laneY = 1
    g.jump = 0
    g.wobble = 0
    g.lives = START_LIVES
    g.invuln = 0
    g.spawnGap = 0
    g.scroll = 0
    g.last = 0
    g.uiScore = 0
    g.uiWobble = 0
    setScore(0)
    setLives(START_LIVES)
    setWobble(0)
    onScoreRef.current?.(0)
    setPhase('play')
  }

  useEffect(() => {
    const cvs = cvsRef.current
    if (!cvs) return undefined
    const ctx = cvs.getContext('2d')
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const g = {
      obstacles: [], cups: [], floats: [], dist: 0, cupCount: 0,
      lane: 1, laneY: 1, jump: 0, wobble: 0, lives: START_LIVES, invuln: 0,
      spawnGap: 0, scroll: 0, last: 0, raf: 0, w: 0, h: 0, reduced,
      uiScore: 0, uiWobble: 0,
    }
    gRef.current = g

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      g.w = cvs.clientWidth || 1
      g.h = cvs.clientHeight || 1
      cvs.width = Math.round(g.w * dpr)
      cvs.height = Math.round(g.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
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

    const laneY = (i) => g.h * (0.46 + i * 0.18)
    const playerX = () => g.w * 0.74
    const speed = () => (g.reduced ? 190 : 250) * (1 + Math.min(1.5, g.dist / 2600))

    const spawn = () => {
      const kinds = ['table', 'spill', 'chair']
      const kind = kinds[Math.floor(Math.random() * kinds.length)]
      // never block every lane at once — one lane always stays open
      const blocked = Math.floor(Math.random() * LANES)
      g.obstacles.push({ x: -70, lane: blocked, kind })
      if (Math.random() < 0.55) {
        let l = Math.floor(Math.random() * LANES)
        if (l === blocked) l = (l + 1) % LANES
        g.cups.push({ x: -70 - 40 - Math.random() * 120, lane: l, taken: false })
      }
    }

    const hitLife = () => {
      g.lives = Math.max(0, g.lives - 1)
      setLives(g.lives)
      g.wobble = 25
      g.invuln = 1.2
      if (g.lives <= 0) {
        setPhase('over')
        onScoreRef.current?.(Math.round(g.dist / 10) + g.cupCount * CUP_POINTS)
      }
    }

    const drawWaiter = (x, y, tilt) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(-1, 1) // faces the direction of travel (leftward = forward in RTL)
      // legs
      ctx.strokeStyle = '#243b53'
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      const stride = g.reduced ? 0 : Math.sin(g.scroll / 22) * 9
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(stride, 24); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(-stride, 24); ctx.stroke()
      // body
      ctx.fillStyle = '#f6f4ef'
      ctx.beginPath()
      ctx.moveTo(-11, 6); ctx.lineTo(11, 6); ctx.lineTo(8, -20); ctx.lineTo(-8, -20)
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#1f2d3d'
      ctx.fillRect(-3, -20, 6, 26)
      // head
      ctx.fillStyle = '#e8b98c'
      ctx.beginPath(); ctx.arc(0, -28, 8, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#243b53'
      ctx.beginPath(); ctx.arc(0, -32, 8, Math.PI, 0); ctx.fill()
      // arm + tray (tilts with the wobble meter)
      ctx.strokeStyle = '#e8b98c'
      ctx.lineWidth = 4
      ctx.beginPath(); ctx.moveTo(-6, -14); ctx.lineTo(-20, -26); ctx.stroke()
      ctx.save()
      ctx.translate(-22, -28)
      ctx.rotate(tilt)
      ctx.fillStyle = '#c8cdd4'
      ctx.beginPath(); ctx.ellipse(0, 0, 20, 4, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = brand
      for (let i = -1; i <= 1; i++) {
        rrect(i * 11 - 4, -11, 8, 11, 2)
        ctx.fill()
      }
      ctx.restore()
      ctx.restore()
    }

    const drawObstacle = (o, y) => {
      ctx.save()
      ctx.translate(o.x, y)
      if (o.kind === 'table') {
        ctx.fillStyle = '#8a5a3b'
        rrect(-26, -34, 52, 9, 3); ctx.fill()
        ctx.fillRect(-4, -26, 8, 26)
        rrect(-16, -2, 32, 6, 3); ctx.fill()
      } else if (o.kind === 'chair') {
        ctx.fillStyle = '#6b7a8f'
        rrect(-14, -22, 28, 7, 3); ctx.fill()
        rrect(10, -40, 6, 22, 3); ctx.fill()
        ctx.fillRect(-12, -15, 4, 15)
        ctx.fillRect(9, -15, 4, 15)
      } else {
        ctx.fillStyle = 'rgba(210, 160, 60, 0.85)'
        ctx.beginPath(); ctx.ellipse(0, -2, 26, 8, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = 'rgba(255, 235, 190, 0.6)'
        ctx.beginPath(); ctx.ellipse(-7, -4, 9, 3, 0, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore()
    }

    const drawCup = (c, y) => {
      ctx.save()
      ctx.translate(c.x, y - 16 + Math.sin(g.scroll / 30 + c.x / 60) * (g.reduced ? 0 : 3))
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.moveTo(-8, -9); ctx.lineTo(8, -9); ctx.lineTo(5, 9); ctx.lineTo(-5, 9)
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = brand
      ctx.beginPath(); ctx.ellipse(0, -9, 8, 2.6, 0, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2.4
      ctx.beginPath(); ctx.arc(9, -1, 5, -1.1, 1.1); ctx.stroke()
      ctx.restore()
    }

    const frame = (now) => {
      g.raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - (g.last || now)) / 1000)
      g.last = now
      const playing = phaseRef.current === 'play'
      const v = speed()

      // ---- floor ----
      ctx.clearRect(0, 0, g.w, g.h)
      const wall = ctx.createLinearGradient(0, 0, 0, g.h * 0.38)
      wall.addColorStop(0, '#12212f'); wall.addColorStop(1, '#1d3547')
      ctx.fillStyle = wall
      ctx.fillRect(0, 0, g.w, g.h * 0.38)
      const floor = ctx.createLinearGradient(0, g.h * 0.38, 0, g.h)
      floor.addColorStop(0, '#3b2c22'); floor.addColorStop(1, '#6b4f3c')
      ctx.fillStyle = floor
      ctx.fillRect(0, g.h * 0.38, g.w, g.h * 0.62)
      // scrolling floor seams
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'
      ctx.lineWidth = 2
      for (let i = -1; i < 14; i++) {
        const x = ((i * 90 + (g.scroll % 90)) + g.w) % (g.w + 180) - 90
        ctx.beginPath(); ctx.moveTo(x, g.h * 0.38); ctx.lineTo(x - 30, g.h); ctx.stroke()
      }
      // lane guides
      for (let i = 0; i < LANES; i++) {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(0, laneY(i) + 6); ctx.lineTo(g.w, laneY(i) + 6); ctx.stroke()
      }

      if (playing) {
        g.dist += v * dt
        g.scroll += v * dt
        // ease the drawn lane toward the chosen one
        g.laneY += (g.lane - g.laneY) * Math.min(1, dt * (g.reduced ? 30 : 13))
        if (g.jump > 0) g.jump = Math.max(0, g.jump - dt * 1.9)
        g.wobble = Math.max(0, g.wobble - dt * 16)
        if (g.invuln > 0) g.invuln -= dt

        g.spawnGap -= v * dt
        if (g.spawnGap <= 0) {
          spawn()
          g.spawnGap = 200 + Math.random() * 200 + Math.max(0, 120 - g.dist / 24)
        }

        const px = playerX()
        const jumpH = Math.sin(Math.PI * (1 - g.jump)) * 64
        const pyBase = laneY(g.laneY)
        const py = pyBase - jumpH

        for (const o of g.obstacles) {
          o.x += v * dt
          if (o.hit || g.invuln > 0) continue
          const sameLane = Math.abs(o.lane - g.laneY) < 0.42
          const clears = g.jump > 0.12 && o.kind !== 'table' && jumpH > 26
          if (sameLane && !clears && Math.abs(o.x - px) < 26) {
            o.hit = true
            g.wobble = Math.min(140, g.wobble + HIT_WOBBLE)
            if (g.wobble >= 100) hitLife()
          }
        }
        g.obstacles = g.obstacles.filter((o) => o.x < g.w + 90)

        for (const c of g.cups) {
          c.x += v * dt
          if (c.taken) continue
          if (Math.abs(c.lane - g.laneY) < 0.5 && Math.abs(c.x - px) < 30 && Math.abs((laneY(c.lane) - 16) - py) < 46) {
            c.taken = true
            g.cupCount += 1
            const nm = namesRef.current
            g.floats.push({ x: c.x, y: laneY(c.lane) - 24, life: 1, label: nm.length ? nm[Math.floor(Math.random() * nm.length)] : `+${CUP_POINTS}` })
          }
        }
        g.cups = g.cups.filter((c) => !c.taken && c.x < g.w + 90)

        // Sync React only when a displayed value actually changed — never once
        // per frame.
        const sc = Math.round(g.dist / 10) + g.cupCount * CUP_POINTS
        if (sc !== g.uiScore) {
          g.uiScore = sc
          setScore(sc)
          onScoreRef.current?.(sc)
        }
        const wb = Math.round(Math.min(100, g.wobble))
        if (wb !== g.uiWobble) { g.uiWobble = wb; setWobble(wb) }
      }

      // ---- actors ----
      const order = [...g.obstacles].sort((a, b) => a.lane - b.lane)
      const px = playerX()
      const jumpH = Math.sin(Math.PI * (1 - g.jump)) * 64
      for (const o of order) if (o.lane <= g.laneY) drawObstacle(o, laneY(o.lane))
      for (const c of g.cups) drawCup(c, laneY(c.lane))
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.beginPath()
      ctx.ellipse(px, laneY(g.laneY) + 24, 16 - jumpH * 0.1, 5 - jumpH * 0.03, 0, 0, Math.PI * 2)
      ctx.fill()
      if (g.invuln <= 0 || Math.floor(now / 90) % 2 === 0) {
        drawWaiter(px, laneY(g.laneY) - jumpH, Math.min(0.55, (g.wobble / 100) * 0.55) * (g.reduced ? 0.4 : 1))
      }
      for (const o of order) if (o.lane > g.laneY) drawObstacle(o, laneY(o.lane))

      // floating menu names on pickup
      for (const f of g.floats) {
        f.life -= dt * 1.1
        f.y -= dt * 40
        f.x += v * dt
        ctx.save()
        ctx.globalAlpha = Math.max(0, f.life)
        ctx.fillStyle = '#ffe9a8'
        ctx.font = '600 14px system-ui, sans-serif'
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
  }, [brand]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- input: swipe = lane, tap = jump ----
  const ptr = useRef(null)
  const hop = (dir) => {
    const g = gRef.current
    if (!g || phaseRef.current !== 'play') return
    const next = Math.max(0, Math.min(LANES - 1, g.lane + dir))
    if (next === g.lane) return
    g.lane = next
    g.wobble = Math.min(140, g.wobble + LANE_WOBBLE)
  }
  const jump = () => {
    const g = gRef.current
    if (!g || phaseRef.current !== 'play' || g.jump > 0) return
    g.jump = 1
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
  }, [])

  return (
    <div className="gb-stage">
      <canvas ref={cvsRef} className="gb-canvas" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { ptr.current = null }} />
      {/* the hub's title bar owns the live score — only game-specific state here */}
      {phase === 'play' && (
        <div className="gb-hud">
          <span className="gb-chip">{t.lives} {lives}</span>
          <span className="gb-meter" aria-label={t.balance}>
            <i style={{ width: `${wobble}%`, background: wobble > 70 ? '#ff7a6b' : brand }} />
          </span>
        </div>
      )}
      {phase !== 'play' && (
        <div className="gb-card">
          <strong className="gb-title">{phase === 'over' ? t.over : t.title}</strong>
          {phase === 'over' ? (
            <p className="gb-line">{playerName ? `${playerName}: ` : ''}<b>{score}</b> {t.got}</p>
          ) : (
            <p className="gb-line">{t.how}</p>
          )}
          <button type="button" className="gb-btn" style={{ background: brand }} onClick={start}>
            <Icon name="play" size={16} /> {phase === 'over' ? t.again : t.start}
          </button>
        </div>
      )}
    </div>
  )
}
