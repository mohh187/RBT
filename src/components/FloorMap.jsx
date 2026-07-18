import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

const STATUS_COLOR = { free: '#16a34a', occupied: '#dc2626', billed: '#2563eb', reserved: '#e0a82e' }

// A realistic table with chairs drawn around it, colored by status.
// shape: 'round' | 'square' | 'rect'. `meta` renders as a small chip under the
// table (elapsed time / bill amount on occupied tables).
export function TableShape({ seats = 4, shape = 'round', status = 'free', label = '', size = 58, activeOrdersCount = 0, meta = '' }) {
  const c = STATUS_COLOR[status] || STATUS_COLOR.free
  const chairR = 7
  const isRect = shape === 'rect'
  const tw = isRect ? Math.round(size * 1.6) : size
  const th = isRect ? Math.round(size * 0.78) : size
  const ringX = tw / 2 + chairR + 5
  const ringY = th / 2 + chairR + 5
  const boxW = tw + (chairR + 5) * 2 + 6
  const boxH = th + (chairR + 5) * 2 + 6
  const n = Math.max(1, Math.min(Number(seats) || 1, 16))
  const chairs = []
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 - Math.PI / 2; chairs.push({ x: Math.cos(a) * ringX, y: Math.sin(a) * ringY }) }
  return (
    <div style={{ position: 'relative', width: boxW, height: boxH }}>
      {chairs.map((ch, i) => (
        <div key={i} style={{ position: 'absolute', left: boxW / 2 + ch.x - chairR, top: boxH / 2 + ch.y - chairR, width: chairR * 2, height: chairR * 2, borderRadius: '50%', background: 'var(--surface-2)', border: `2px solid ${c}` }} />
      ))}
      <div style={{ position: 'absolute', left: (boxW - tw) / 2, top: (boxH - th) / 2, width: tw, height: th, borderRadius: shape === 'round' ? '50%' : 10, background: c, color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 14px rgba(0,0,0,.22)' }}>
        <div style={{ textAlign: 'center', lineHeight: 1.05, padding: 2 }}>
          <div style={{ fontSize: 12, fontWeight: 800, maxWidth: tw - 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
          <div style={{ fontSize: 10, opacity: 0.92, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>{seats} <Icon name="tables" size={9} style={{ strokeWidth: 2.5 }} /></div>
        </div>
      </div>
      {activeOrdersCount > 0 && (
        <div style={{
          position: 'absolute',
          top: 4,
          right: 4,
          background: '#ef4444',
          color: '#ffffff',
          borderRadius: '50%',
          minWidth: 18,
          height: 18,
          fontSize: 10,
          fontWeight: 900,
          display: 'grid',
          placeItems: 'center',
          padding: '0 4px',
          boxShadow: '0 2px 5px rgba(0,0,0,0.24)',
          border: '1.5px solid var(--surface)',
          zIndex: 12
        }}>
          {activeOrdersCount}
        </div>
      )}
      {meta ? (
        <div style={{ position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)', background: 'var(--surface)', color: 'var(--text)', border: `1px solid ${c}`, borderRadius: 999, fontSize: 9.5, fontWeight: 700, padding: '1px 8px', whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,.14)', zIndex: 12 }}>
          {meta}
        </div>
      ) : null}
    </div>
  )
}

// Floor canvas: positions tables at (x,y); drag in edit mode, tap otherwise.
// The canvas auto-scales down so the whole floor always fits the container
// width (phones) — drag math divides by the scale so editing keeps working.
export default function FloorMap({ tables = [], statusOf, metaOf, edit, onMove, onTap }) {
  const outer = useRef(null)
  const drag = useRef(null)
  const dims = useRef({ w: 640, h: 380 })
  const [cw, setCw] = useState(0)

  useEffect(() => {
    if (!outer.current) return
    const ro = new ResizeObserver((es) => setCw(es[0]?.contentRect?.width || 0))
    ro.observe(outer.current)
    return () => ro.disconnect()
  }, [])

  const positioned = tables.map((tb, i) => ({
    ...tb,
    _x: tb.x != null ? tb.x : 16 + (i % 4) * 104,
    _y: tb.y != null ? tb.y : 16 + Math.floor(i / 4) * 118,
  }))

  // Freeze canvas size while dragging so the fit-scale can't shift mid-drag.
  if (!drag.current) {
    const pad = edit ? 150 : 24
    dims.current = {
      w: Math.max(640, ...positioned.map((t) => t._x + 150)) + (edit ? pad : 0),
      h: Math.max(380, ...positioned.map((t) => t._y + 150)) + (edit ? pad : 0),
    }
  }
  const needW = dims.current.w
  const needH = dims.current.h
  const scale = cw > 0 && cw < needW ? cw / needW : 1

  const toLocal = (e) => {
    const rect = outer.current.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale }
  }
  const onPointerDown = (e, tb) => {
    if (!edit) return
    const p = toLocal(e)
    drag.current = { id: tb.id, dx: p.x - tb._x, dy: p.y - tb._y }
    e.target.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!drag.current || !outer.current) return
    const p = toLocal(e)
    const x = Math.max(0, Math.min(needW - 132, p.x - drag.current.dx))
    const y = Math.max(0, Math.min(needH - 140, p.y - drag.current.dy))
    onMove?.(drag.current.id, x, y, false)
  }
  const onPointerUp = () => { if (drag.current) { onMove?.(drag.current.id, null, null, true); drag.current = null } }

  return (
    <div ref={outer} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
      style={{ position: 'relative', width: '100%', height: Math.max(needH * scale, 300), background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: needW, height: needH, transform: `scale(${scale})`, transformOrigin: 'top left', backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
        {positioned.map((tb) => (
          <div key={tb.id} onPointerDown={(e) => onPointerDown(e, tb)} onClick={() => !edit && onTap?.(tb)}
            style={{ position: 'absolute', left: tb._x, top: tb._y, cursor: edit ? 'grab' : 'pointer', touchAction: 'none', userSelect: 'none' }}>
            <TableShape seats={tb.seats} shape={tb.shape || 'round'} status={statusOf(tb)} label={tb.label} activeOrdersCount={tb.activeOrdersCount} meta={metaOf ? metaOf(tb) : ''} />
          </div>
        ))}
      </div>
    </div>
  )
}
