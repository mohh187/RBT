// «سلة التمر» — dates, sweets and coffee beans rain down; drag the basket to
// catch them. Spoiled items cost a life, clean streaks build a combo multiplier,
// and both the fall speed and the spawn density climb the longer you survive.
//
// Everything is drawn with canvas paths — no emoji, no image assets.
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'

const START_LIVES = 3
const KINDS = [
  { k: 'date', pts: 5, bad: false, w: 34 },
  { k: 'sweet', pts: 8, bad: false, w: 22 },
  { k: 'bean', pts: 3, bad: false, w: 30 },
  { k: 'spoiled', pts: 0, bad: true, w: 14 },
]

const TXT = {
  ar: {
    title: 'سلة التمر',
    how: 'حرّك السلة بإصبعك لالتقاط التمر والحلوى وحبوب البن. تجنّب التمر الفاسد — كل واحدة تكلفك محاولة. التقاطات متتالية تضاعف نقاطك.',
    start: 'ابدأ الالتقاط',
    again: 'جولة جديدة',
    over: 'انتهت المحاولات',
    score: 'النتيجة',
    lives: 'المحاولات',
    points: 'نقطة',
    combo: 'مضاعف',
  },
  en: {
    title: 'Catch Basket',
    how: 'Drag the basket to catch dates, sweets and coffee beans. Avoid the spoiled ones.',
    start: 'Start catching',
    again: 'Play again',
    over: 'Out of lives',
    score: 'Score',
    lives: 'Lives',
    points: 'points',
    combo: 'Combo',
  },
}

export default function CatchBasket({ onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '' }) {
  const t = TXT[lang] || TXT.ar
  const cvsRef = useRef(null)
  const gRef = useRef(null)
  const onScoreRef = useRef(onScore)
  const phaseRef = useRef('ready')
  const [phase, setPhase] = useState('ready')
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(START_LIVES)
  const [mult, setMult] = useState(1)

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { phaseRef.current = phase }, [phase])

  const start = () => {
    const g = gRef.current
    if (!g) return
    g.drops = []
    g.bits = []
    g.score = 0
    g.lives = START_LIVES
    g.streak = 0
    g.elapsed = 0
    g.spawnIn = 0
    g.last = 0
    g.uiScore = 0
    g.uiMult = 1
    setScore(0)
    setLives(START_LIVES)
    setMult(1)
    onScoreRef.current?.(0)
    setPhase('play')
  }

  useEffect(() => {
    const cvs = cvsRef.current
    if (!cvs) return undefined
    const ctx = cvs.getContext('2d')
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const g = {
      drops: [], bits: [], score: 0, lives: START_LIVES, streak: 0, elapsed: 0,
      spawnIn: 0, last: 0, bx: 0.5, raf: 0, w: 0, h: 0, reduced, uiScore: 0, uiMult: 1,
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

    const basketW = () => Math.max(66, Math.min(120, g.w * 0.24))
    const basketY = () => g.h - 62

    const multiplier = () => Math.min(5, 1 + Math.floor(g.streak / 4))

    const spawn = () => {
      // spoiled share climbs slowly so the early game teaches the shapes first
      const badChance = Math.min(0.3, 0.1 + g.elapsed / 260)
      const isBad = Math.random() < badChance
      const pool = KINDS.filter((k) => k.bad === isBad)
      const kind = pool[Math.floor(Math.random() * pool.length)]
      const r = 15 + Math.random() * 5
      g.drops.push({
        x: r + 10 + Math.random() * Math.max(1, g.w - 2 * r - 20),
        y: -30,
        r,
        spin: (Math.random() - 0.5) * 3,
        rot: Math.random() * Math.PI,
        kind: kind.k,
        pts: kind.pts,
        bad: kind.bad,
      })
    }

    const burst = (x, y, color) => {
      if (g.reduced) return
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2
        g.bits.push({ x, y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 40, life: 0.5, color })
      }
    }

    const drawDrop = (d) => {
      ctx.save()
      ctx.translate(d.x, d.y)
      ctx.rotate(d.rot)
      if (d.kind === 'date') {
        ctx.fillStyle = '#8a5321'
        ctx.beginPath(); ctx.ellipse(0, 0, d.r * 0.62, d.r, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = 'rgba(255, 214, 150, 0.45)'
        ctx.beginPath(); ctx.ellipse(-d.r * 0.2, -d.r * 0.28, d.r * 0.2, d.r * 0.4, 0.3, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#5d3512'
        ctx.lineWidth = 1.4
        ctx.beginPath(); ctx.moveTo(0, -d.r); ctx.lineTo(0, d.r * 0.8); ctx.stroke()
      } else if (d.kind === 'sweet') {
        ctx.fillStyle = '#e8617f'
        ctx.beginPath(); ctx.arc(0, 0, d.r * 0.85, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#fff3f6'
        ctx.lineWidth = 3
        ctx.beginPath(); ctx.arc(0, 0, d.r * 0.45, 0.4, 4.2); ctx.stroke()
      } else if (d.kind === 'bean') {
        ctx.fillStyle = '#4a2c1a'
        ctx.beginPath(); ctx.ellipse(0, 0, d.r * 0.58, d.r * 0.9, 0, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#c9a27a'
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(0, -d.r * 0.75); ctx.quadraticCurveTo(d.r * 0.3, 0, 0, d.r * 0.75); ctx.stroke()
      } else {
        ctx.fillStyle = '#4f5a4a'
        ctx.beginPath(); ctx.ellipse(0, 0, d.r * 0.62, d.r, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#2e3a2c'
        ctx.beginPath(); ctx.arc(-d.r * 0.2, -d.r * 0.3, d.r * 0.22, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(d.r * 0.22, d.r * 0.25, d.r * 0.18, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#1d251c' // the crack that reads as "do not catch"
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(-d.r * 0.5, -d.r * 0.6); ctx.lineTo(0, -d.r * 0.1); ctx.lineTo(-d.r * 0.3, d.r * 0.35); ctx.lineTo(d.r * 0.4, d.r * 0.85)
        ctx.stroke()
      }
      ctx.restore()
    }

    const drawBasket = (x) => {
      const w = basketW()
      const y = basketY()
      ctx.save()
      ctx.translate(x, y)
      ctx.fillStyle = '#a9713c'
      ctx.beginPath()
      ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.lineTo(w / 2 - 10, 40); ctx.lineTo(-w / 2 + 10, 40)
      ctx.closePath(); ctx.fill()
      ctx.strokeStyle = 'rgba(60, 34, 12, 0.5)'
      ctx.lineWidth = 2
      for (let i = 1; i < 4; i++) {
        const yy = i * 10
        const k = (w / 2) - (yy / 40) * 10
        ctx.beginPath(); ctx.moveTo(-k, yy); ctx.lineTo(k, yy); ctx.stroke()
      }
      ctx.fillStyle = brand
      ctx.fillRect(-w / 2 - 3, -7, w + 6, 8)
      ctx.restore()
    }

    const frame = (now) => {
      g.raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - (g.last || now)) / 1000)
      g.last = now
      const playing = phaseRef.current === 'play'

      ctx.clearRect(0, 0, g.w, g.h)
      const sky = ctx.createLinearGradient(0, 0, 0, g.h)
      sky.addColorStop(0, '#1a2c3a'); sky.addColorStop(1, '#0a141c')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, g.w, g.h)
      // ground line
      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      ctx.fillRect(0, g.h - 24, g.w, 24)

      if (playing) {
        g.elapsed += dt
        const fall = (g.reduced ? 150 : 200) + g.elapsed * 11
        g.spawnIn -= dt
        if (g.spawnIn <= 0) {
          spawn()
          g.spawnIn = Math.max(0.28, 0.95 - g.elapsed / 45)
        }
        const bx = g.bx * g.w
        const bw = basketW()
        const by = basketY()
        for (const d of g.drops) {
          d.y += fall * dt
          d.rot += d.spin * dt
          if (d.caught || d.gone) continue
          if (d.y + d.r * 0.5 >= by && d.y - d.r * 0.5 <= by + 26 && Math.abs(d.x - bx) < bw / 2 + d.r * 0.4) {
            d.caught = true
            if (d.bad) {
              g.streak = 0
              g.lives = Math.max(0, g.lives - 1)
              setLives(g.lives)
              burst(d.x, by, '#6f7a68')
              if (g.lives <= 0) {
                setPhase('over')
                onScoreRef.current?.(g.score)
              }
            } else {
              g.streak += 1
              g.score += d.pts * multiplier()
              burst(d.x, by, '#ffd166')
            }
          } else if (d.y - d.r > g.h) {
            d.gone = true
            if (!d.bad) g.streak = 0 // a dropped good item breaks the combo
          }
        }
        g.drops = g.drops.filter((d) => !d.caught && !d.gone)

        if (g.score !== g.uiScore) { g.uiScore = g.score; setScore(g.score); onScoreRef.current?.(g.score) }
        const m = multiplier()
        if (m !== g.uiMult) { g.uiMult = m; setMult(m) }
      }

      for (const d of g.drops) drawDrop(d)
      drawBasket(g.bx * g.w)

      for (const b of g.bits) {
        b.life -= dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.vy += 320 * dt
        ctx.save()
        ctx.globalAlpha = Math.max(0, b.life * 2)
        ctx.fillStyle = b.color
        ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
      }
      g.bits = g.bits.filter((b) => b.life > 0)
    }

    g.raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(g.raf)
      ro?.disconnect()
      window.removeEventListener('resize', resize)
      gRef.current = null
    }
  }, [brand]) // eslint-disable-line react-hooks/exhaustive-deps

  const moveTo = (clientX) => {
    const g = gRef.current
    const cvs = cvsRef.current
    if (!g || !cvs) return
    const r = cvs.getBoundingClientRect()
    g.bx = Math.max(0.08, Math.min(0.92, (clientX - r.left) / Math.max(1, r.width)))
  }
  const dragging = useRef(false)
  const onDown = (e) => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); moveTo(e.clientX) }
  const onMove = (e) => { if (dragging.current) moveTo(e.clientX) }
  const onUp = () => { dragging.current = false }

  useEffect(() => {
    const onKey = (e) => {
      const g = gRef.current
      if (!g) return
      if (e.key === 'ArrowLeft') g.bx = Math.max(0.08, g.bx - 0.06)
      else if (e.key === 'ArrowRight') g.bx = Math.min(0.92, g.bx + 0.06)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="gb-stage">
      <canvas
        ref={cvsRef}
        className="gb-canvas"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      {/* the hub's title bar owns the live score — only game-specific state here */}
      {phase === 'play' && (
        <div className="gb-hud">
          <span className="gb-chip">{t.lives} {lives}</span>
          {mult > 1 && <span className="gb-chip" style={{ background: brand, borderColor: 'transparent' }}>{t.combo} x{mult}</span>}
        </div>
      )}
      {phase !== 'play' && (
        <div className="gb-card">
          <strong className="gb-title">{phase === 'over' ? t.over : t.title}</strong>
          {phase === 'over'
            ? <p className="gb-line">{playerName ? `${playerName}: ` : ''}<b>{score}</b> {t.points}</p>
            : <p className="gb-line">{t.how}</p>}
          <button type="button" className="gb-btn" style={{ background: brand }} onClick={start}>
            <Icon name="play" size={16} /> {phase === 'over' ? t.again : t.start}
          </button>
        </div>
      )}
    </div>
  )
}
