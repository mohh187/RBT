// «دولاب الحظ» — a weighted spin with an ease-out that feels like real inertia
// (~3.5s), a ratchet pointer that flicks over every peg, a tick for each peg it
// passes, and a short settle bounce as it drops into place.
//
// HONESTY RULE (unchanged): the wheel only ever promises what the venue actually
// configured. With no `prizes` prop it is a POINTS wheel and says so in plain
// Arabic — it never shows a discount, a free drink, or any reward the venue did
// not set up. When the venue does configure prizes, a segment awards points only
// when that prize carries a numeric `points` value; otherwise the card shows the
// prize label alone and makes no points claim.
//
// One free spin per session (sessionStorage), so re-entering from the hub does
// not hand out another. NOTE: the odds and the reward/selection logic below are
// deliberately identical to before — only the look, feel and sound changed.
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { play } from '../../lib/gameSounds.js'
import '../../styles/arcade-b.css'

const SPIN_MS = 3500
const SPIN_KEY = 'rbt_wheel_spun'

// The safe default: point-only segments. Nothing here implies a venue reward.
const POINT_SEGMENTS = [
  { label: '10', points: 10, weight: 18 },
  { label: '25', points: 25, weight: 16 },
  { label: '5', points: 5, weight: 20 },
  { label: '50', points: 50, weight: 10 },
  { label: '15', points: 15, weight: 17 },
  { label: '100', points: 100, weight: 3 },
  { label: '30', points: 30, weight: 12 },
  { label: '75', points: 75, weight: 4 },
]

const TXT = {
  ar: {
    title: 'دولاب الحظ',
    pointsOnly: 'هذا الدولاب يمنح نقاطاً فقط تُضاف إلى رصيدك في الألعاب — لا يشمل خصومات أو هدايا.',
    withPrizes: 'أدر الدولاب لتربح إحدى الجوائز التي أعدّها المكان.',
    spin: 'أدر الدولاب',
    spinning: 'يدور...',
    youWon: 'ربحت',
    points: 'نقطة',
    noPoints: 'من دون نقاط في هذه الجولة',
    showStaff: 'اعرض هذه النتيجة على الموظف.',
    oneSpin: 'لديك دورة واحدة في كل جلسة.',
    already: 'استخدمت دورتك في هذه الجلسة. عد إلينا في زيارتك القادمة.',
    luck: 'حظ أوفر',
  },
  en: {
    title: 'Prize Wheel',
    pointsOnly: 'This wheel awards game points only — no discounts or gifts.',
    withPrizes: 'Spin to win one of the venue prizes.',
    spin: 'Spin',
    spinning: 'Spinning...',
    youWon: 'You won',
    points: 'points',
    noPoints: 'No points this round',
    showStaff: 'Show this result to a staff member.',
    oneSpin: 'One spin per session.',
    already: 'You already used your spin this session.',
    luck: 'Better luck',
  },
}

// mix a hex colour toward white (t>0) or black (t<0) for segment shades
function shade(hex, t) {
  const h = String(hex || '#0e7490').replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0')
  const n = parseInt(f.slice(0, 6), 16)
  const to = t > 0 ? 255 : 0
  const a = Math.abs(t)
  const ch = (sh) => Math.round(((n >> sh) & 255) * (1 - a) + to * a)
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
}

export default function PrizeWheel({ onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '', prizes = [] }) {
  const t = TXT[lang] || TXT.ar
  const cvsRef = useRef(null)
  const gRef = useRef(null)
  const onScoreRef = useRef(onScore)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])

  // A venue prize list wins; otherwise the honest points-only wheel.
  const custom = (prizes || [])
    .filter((p) => p && String(p.label || '').trim())
    .map((p) => ({ label: String(p.label).trim().slice(0, 22), points: Number(p.points) || 0, weight: Math.max(1, Number(p.weight) || 1) }))
    .slice(0, 12)
  const segs = custom.length >= 2 ? custom : POINT_SEGMENTS
  const isPointsOnly = custom.length < 2
  const segsRef = useRef(segs)
  segsRef.current = segs

  const [phase, setPhase] = useState(() => {
    try { return sessionStorage.getItem(SPIN_KEY) === '1' ? 'used' : 'ready' } catch (_) { return 'ready' }
  })
  const [result, setResult] = useState(null)

  useEffect(() => {
    const cvs = cvsRef.current
    if (!cvs) return undefined
    const ctx = cvs.getContext('2d')
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const g = { rot: 0, from: 0, to: 0, t0: 0, spinning: false, settle: null, lastPeg: null, raf: 0, w: 0, h: 0, reduced, done: null }
    gRef.current = g

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      g.w = cvs.clientWidth || 1
      g.h = cvs.clientHeight || 1
      cvs.width = Math.round(g.w * dpr)
      cvs.height = Math.round(g.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (g.start && !g.spinning && !g.settle) g.start()
    }
    resize()
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null
    ro?.observe(cvs)
    window.addEventListener('resize', resize)

    const geo = () => {
      const cx = g.w / 2
      const cy = g.h * 0.44
      const R = Math.max(40, Math.min(g.w, g.h) * 0.38)
      return { cx, cy, R }
    }

    const finishSpin = () => { const d = g.done; g.done = null; d?.() }

    const frame = (now) => {
      const list = segsRef.current
      const n = list.length
      const segA = (Math.PI * 2) / n
      const { cx, cy, R } = geo()

      if (g.spinning) {
        const dur = g.reduced ? 900 : SPIN_MS
        const p = Math.min(1, (now - g.t0) / dur)
        const e = 1 - Math.pow(1 - p, 4) // ease-out quart reads as real inertia
        g.rot = g.from + (g.to - g.from) * e
        // tick once per peg the pointer crosses; quieter as the wheel slows
        if (!g.reduced) {
          const peg = Math.floor(g.rot / segA)
          if (g.lastPeg == null) g.lastPeg = peg
          else if (peg !== g.lastPeg) {
            g.lastPeg = peg
            const spd = Math.max(0, 1 - p)
            play('click', { gain: 0.18 + spd * 0.5 })
          }
        }
        if (p >= 1) {
          g.spinning = false
          if (g.reduced) { g.rot = g.to; finishSpin() }
          else { g.settle = { t0: now }; play('capture', { gain: 0.32 }) }
        }
      } else if (g.settle) {
        const s = (now - g.settle.t0) / 1000
        const dur = 0.46
        if (s >= dur) { g.settle = null; g.rot = g.to; finishSpin() }
        else {
          const amp = segA * 0.16
          g.rot = g.to + amp * Math.exp(-7 * s) * Math.sin(26 * s) // damped drop-into-place
        }
      }

      ctx.clearRect(0, 0, g.w, g.h)
      // majlis felt backdrop
      const bg = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.3)
      bg.addColorStop(0, '#173026'); bg.addColorStop(0.6, '#0e1f18'); bg.addColorStop(1, '#08130e')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, g.w, g.h)

      // soft cast shadow under the wheel
      ctx.save()
      ctx.globalAlpha = 0.4
      ctx.fillStyle = '#000'
      ctx.beginPath()
      ctx.ellipse(cx, cy + R * 0.08, R * 1.03, R * 1.0, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // outer walnut casing + gold rim
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2)
      ctx.fillStyle = '#3a2417'; ctx.fill()
      const rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R)
      rim.addColorStop(0, '#f6d98a'); rim.addColorStop(0.5, '#b98d3e'); rim.addColorStop(1, '#f6d98a')
      ctx.lineWidth = Math.max(4, R * 0.07)
      ctx.strokeStyle = rim
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2); ctx.stroke()

      // wheel face
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(g.rot)
      for (let i = 0; i < n; i++) {
        const a0 = i * segA
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.arc(0, 0, R, a0, a0 + segA)
        ctx.closePath()
        // radial shading gives each wedge a lit inner edge and a deep rim
        const wedge = ctx.createRadialGradient(0, 0, R * 0.12, 0, 0, R)
        const base = i % 2 === 0 ? shade(brand, -0.12) : shade(brand, 0.28)
        wedge.addColorStop(0, shade(brand, i % 2 === 0 ? 0.05 : 0.4))
        wedge.addColorStop(1, base)
        ctx.fillStyle = wedge
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,236,190,0.28)'
        ctx.lineWidth = 1.4
        ctx.stroke()
        // label along the radius
        ctx.save()
        ctx.rotate(a0 + segA / 2)
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#fffaf0'
        ctx.shadowColor = 'rgba(0,0,0,0.45)'
        ctx.shadowBlur = 3
        const fs = Math.max(11, Math.min(19, R * 0.13))
        ctx.font = `800 ${fs}px system-ui, sans-serif`
        ctx.fillText(list[i].label, R - 14, 0)
        ctx.restore()
      }
      // glossy top-left highlight sweeping across the face
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2)
      const gloss = ctx.createLinearGradient(-R, -R, R * 0.3, R * 0.3)
      gloss.addColorStop(0, 'rgba(255,255,255,0.16)')
      gloss.addColorStop(0.4, 'rgba(255,255,255,0)')
      ctx.fillStyle = gloss
      ctx.fill()
      ctx.restore()

      // pegs on the rim (one at every segment boundary) — what the pointer flicks
      for (let i = 0; i < n; i++) {
        const a = g.rot + i * segA - Math.PI / 2
        const px = cx + Math.cos(a) * R * 1.0
        const py = cy + Math.sin(a) * R * 1.0
        ctx.beginPath(); ctx.arc(px, py, Math.max(2.4, R * 0.028), 0, Math.PI * 2)
        ctx.fillStyle = '#fff4d6'
        ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 2
        ctx.fill()
        ctx.shadowBlur = 0
      }

      // hub cap with screws and a jewel
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.19, 0, Math.PI * 2)
      const hub = ctx.createRadialGradient(cx - R * 0.05, cy - R * 0.05, R * 0.02, cx, cy, R * 0.19)
      hub.addColorStop(0, '#fffdf7'); hub.addColorStop(1, '#d9dbe0')
      ctx.fillStyle = hub; ctx.fill()
      ctx.strokeStyle = shade(brand, -0.3); ctx.lineWidth = Math.max(3, R * 0.03); ctx.stroke()
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * 0.12, cy + Math.sin(a) * R * 0.12, Math.max(1.4, R * 0.016), 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(80,70,50,0.5)'; ctx.fill()
      }
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.06, 0, Math.PI * 2)
      ctx.fillStyle = brand; ctx.fill()

      // ratchet pointer at the top — flicks back as every peg passes under it
      const phaseIn = (((g.rot + Math.PI / 2) % segA) + segA) % segA / segA
      const speed = g.spinning ? Math.max(0, 1 - (now - g.t0) / (g.reduced ? 900 : SPIN_MS)) : 0
      const flick = g.reduced ? 0 : -0.5 * Math.exp(-phaseIn * 7) * speed
      ctx.save()
      ctx.translate(cx, cy - R - 2)
      ctx.rotate(flick)
      ctx.beginPath()
      ctx.moveTo(0, 22)
      ctx.lineTo(-12, -9)
      ctx.lineTo(12, -9)
      ctx.closePath()
      const pg = ctx.createLinearGradient(0, -9, 0, 22)
      pg.addColorStop(0, '#ffe9a8'); pg.addColorStop(1, '#e0a827')
      ctx.fillStyle = pg
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.strokeStyle = 'rgba(90,60,10,0.5)'
      ctx.lineWidth = 1.4
      ctx.stroke()
      ctx.beginPath(); ctx.arc(0, -6, 3, 0, Math.PI * 2)
      ctx.fillStyle = '#8a5a12'; ctx.fill()
      ctx.restore()

      // keep animating ONLY while something moves — a resting wheel does not need
      // 60fps forever (that quietly drained the guest's battery/CPU).
      if (g.spinning || g.settle) g.raf = requestAnimationFrame(frame)
    }

    // one static draw now; spin() restarts the loop
    g.start = () => { cancelAnimationFrame(g.raf); g.raf = requestAnimationFrame(frame) }
    frame(performance.now())
    return () => {
      cancelAnimationFrame(g.raf)
      ro?.disconnect()
      window.removeEventListener('resize', resize)
      gRef.current = null
    }
  }, [brand]) // eslint-disable-line react-hooks/exhaustive-deps

  const spin = () => {
    const g = gRef.current
    if (!g || g.spinning || g.settle || phase !== 'ready') return
    const list = segsRef.current
    const total = list.reduce((s, x) => s + x.weight, 0)
    let r = Math.random() * total
    let idx = list.length - 1
    for (let i = 0; i < list.length; i++) {
      r -= list[i].weight
      if (r <= 0) { idx = i; break }
    }
    const segA = (Math.PI * 2) / list.length
    const center = idx * segA + segA / 2
    const jitter = (Math.random() - 0.5) * segA * 0.55
    const turns = g.reduced ? 2 : 5
    g.from = g.rot
    // land the chosen segment under the pointer (screen top = -PI/2)
    const base = -Math.PI / 2 - center - jitter
    let to = base
    while (to < g.from + turns * Math.PI * 2) to += Math.PI * 2
    g.to = to
    g.t0 = performance.now()
    g.lastPeg = null
    g.spinning = true
    g.start?.() // restart the animation loop for the spin
    setPhase('spinning')
    g.done = () => {
      const won = list[idx]
      try { sessionStorage.setItem(SPIN_KEY, '1') } catch (_) { /* storage off */ }
      setResult(won)
      setPhase('done')
      play(won.points > 0 ? 'win' : 'turn')
      onScoreRef.current?.(won.points || 0)
    }
  }

  return (
    <div className="gb-stage" style={{ '--gm-brand': brand }}>
      <canvas ref={cvsRef} className="gb-canvas" />
      <div className="gb-wheel-panel arb-wheel-panel">
        {phase === 'ready' && (
          <>
            <p className="gb-line">{isPointsOnly ? t.pointsOnly : t.withPrizes}</p>
            <button type="button" className="gb-btn arb-spin-btn" style={{ background: brand }} onClick={spin}>
              <Icon name="repeat" size={16} /> {t.spin}
            </button>
            <p className="gb-line faint">{t.oneSpin}</p>
          </>
        )}
        {phase === 'spinning' && <p className="gb-line">{t.spinning}</p>}
        {phase === 'used' && <p className="gb-line">{t.already}</p>}
        {phase === 'done' && result && (
          <>
            <strong className="gb-title arb-won">
              {playerName ? `${playerName} — ` : ''}{t.youWon}
            </strong>
            <p className="gb-line">
              {isPointsOnly
                ? <><b>{result.points}</b> {t.points}</>
                : <><b>{result.label}</b>{result.points ? <> {'—'} {result.points} {t.points}</> : null}</>}
            </p>
            {/* only shown when the venue actually configured a prize list */}
            {!isPointsOnly && <p className="gb-line faint">{t.showStaff}</p>}
            {!isPointsOnly && !result.points ? <p className="gb-line faint">{t.noPoints}</p> : null}
          </>
        )}
      </div>
    </div>
  )
}
