import { useRef, useState } from 'react'

const KEYWORDS = { center: [50, 50], top: [50, 0], bottom: [50, 100], left: [0, 50], right: [100, 50] }

function parse(value) {
  if (KEYWORDS[value]) return KEYWORDS[value]
  const m = String(value || '').match(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/)
  return m ? [Number(m[1]), Number(m[2])] : [50, 50]
}
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)))

// Drag the dot to move the background's focal point manually (sets "x% y%").
export default function BgPanPad({ value, onChange, label }) {
  const ref = useRef(null)
  const dragging = useRef(false)
  const [x, y] = parse(value)

  const apply = (e) => {
    const r = ref.current?.getBoundingClientRect(); if (!r) return
    const cx = e.clientX ?? e.touches?.[0]?.clientX
    const cy = e.clientY ?? e.touches?.[0]?.clientY
    onChange(`${clamp(((cx - r.left) / r.width) * 100)}% ${clamp(((cy - r.top) / r.height) * 100)}%`)
  }
  const down = (e) => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); apply(e) }
  const move = (e) => { if (dragging.current) apply(e) }
  const up = () => { dragging.current = false }

  return (
    <div className="field">
      <label>{label}</label>
      <div ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ position: 'relative', width: '100%', height: 90, borderRadius: 10, background: 'repeating-conic-gradient(var(--surface-2) 0% 25%, var(--surface) 0% 50%) 0 / 16px 16px', border: '1px solid var(--border-strong)', cursor: 'crosshair', touchAction: 'none' }}>
        <div style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)', width: 18, height: 18, borderRadius: '50%', background: 'var(--brand)', border: '2px solid #fff', boxShadow: 'var(--sh-1)' }} />
      </div>
    </div>
  )
}
