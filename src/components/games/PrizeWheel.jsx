// «دولاب الحظ» — a weighted spin with an ease-out that feels like real inertia
// (~3.5s) and a ratchet pointer that flicks over every peg.
//
// HONESTY RULE: the wheel only ever promises what the venue actually configured.
// With no `prizes` prop it is a POINTS wheel and says so in plain Arabic — it
// never shows a discount, a free drink, or any reward the venue did not set up.
// When the venue does configure prizes, a segment awards points only when that
// prize carries a numeric `points` value; otherwise the card shows the prize
// label alone and makes no points claim.
//
// One free spin per session (sessionStorage), so re-entering from the hub does
// not hand out another.
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'

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
    const g = { rot: 0, from: 0, to: 0, t0: 0, spinning: false, raf: 0, w: 0, h: 0, reduced, done: null }
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

    const frame = (now) => {
      g.raf = requestAnimationFrame(frame)
      const list = segsRef.current
      const n = list.length
      const segA = (Math.PI * 2) / n
      const cx = g.w / 2
      const cy = g.h * 0.5
      const R = Math.max(40, Math.min(g.w, g.h) * 0.38)

      if (g.spinning) {
        const dur = g.reduced ? 900 : SPIN_MS
        const p = Math.min(1, (now - g.t0) / dur)
        const e = 1 - Math.pow(1 - p, 4) // ease-out quart reads as real inertia
        g.rot = g.from + (g.to - g.from) * e
        if (p >= 1) {
          g.spinning = false
          g.done?.()
          g.done = null
        }
      }

      ctx.clearRect(0, 0, g.w, g.h)
      const bg = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.2)
      bg.addColorStop(0, '#16242f'); bg.addColorStop(1, '#0a141c')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, g.w, g.h)

      // wheel
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(g.rot)
      for (let i = 0; i < n; i++) {
        const a0 = i * segA
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.arc(0, 0, R, a0, a0 + segA)
        ctx.closePath()
        ctx.fillStyle = i % 2 === 0 ? shade(brand, -0.18) : shade(brand, 0.24)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.16)'
        ctx.lineWidth = 1.5
        ctx.stroke()
        // label along the radius
        ctx.save()
        ctx.rotate(a0 + segA / 2)
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#ffffff'
        const fs = Math.max(11, Math.min(17, R * 0.13))
        ctx.font = `700 ${fs}px system-ui, sans-serif`
        ctx.fillText(list[i].label, R - 12, 0)
        ctx.restore()
      }
      ctx.restore()

      // hub cap
      ctx.beginPath()
      ctx.arc(cx, cy, R * 0.17, 0, Math.PI * 2)
      ctx.fillStyle = '#f6f7f8'
      ctx.fill()
      ctx.strokeStyle = shade(brand, -0.3)
      ctx.lineWidth = 4
      ctx.stroke()

      // ratchet pointer at the top — flicks back as every peg passes under it
      const phaseIn = (((g.rot + Math.PI / 2) % segA) + segA) % segA / segA
      const speed = g.spinning ? Math.max(0, 1 - (now - g.t0) / (g.reduced ? 900 : SPIN_MS)) : 0
      const flick = g.reduced ? 0 : -0.5 * Math.exp(-phaseIn * 7) * speed
      ctx.save()
      ctx.translate(cx, cy - R - 2)
      ctx.rotate(flick)
      ctx.beginPath()
      ctx.moveTo(0, 20)
      ctx.lineTo(-11, -8)
      ctx.lineTo(11, -8)
      ctx.closePath()
      ctx.fillStyle = '#ffd166'
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()
    }

    g.raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(g.raf)
      ro?.disconnect()
      window.removeEventListener('resize', resize)
      gRef.current = null
    }
  }, [brand]) // eslint-disable-line react-hooks/exhaustive-deps

  const spin = () => {
    const g = gRef.current
    if (!g || g.spinning || phase !== 'ready') return
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
    g.spinning = true
    setPhase('spinning')
    g.done = () => {
      const won = list[idx]
      try { sessionStorage.setItem(SPIN_KEY, '1') } catch (_) { /* storage off */ }
      setResult(won)
      setPhase('done')
      onScoreRef.current?.(won.points || 0)
    }
  }

  return (
    <div className="gb-stage">
      <canvas ref={cvsRef} className="gb-canvas" />
      <div className="gb-wheel-panel">
        {phase === 'ready' && (
          <>
            <p className="gb-line">{isPointsOnly ? t.pointsOnly : t.withPrizes}</p>
            <button type="button" className="gb-btn" style={{ background: brand }} onClick={spin}>
              <Icon name="repeat" size={16} /> {t.spin}
            </button>
            <p className="gb-line faint">{t.oneSpin}</p>
          </>
        )}
        {phase === 'spinning' && <p className="gb-line">{t.spinning}</p>}
        {phase === 'used' && <p className="gb-line">{t.already}</p>}
        {phase === 'done' && result && (
          <>
            <strong className="gb-title">
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
