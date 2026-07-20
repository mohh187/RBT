import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'
import { usePortalRoot } from '../PortalRoot.jsx'

// Fullscreen image inspector for the generation log: wheel / pinch / button zoom,
// drag to pan, double-tap to toggle, Escape to close. Transform is written
// straight to the node inside ONE rAF so a pinch stays smooth instead of
// re-rendering React on every pointer move.
const MIN = 1
const MAX = 6
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export default function GenImageZoom({ src, alt = '', onClose }) {
  const portalRoot = usePortalRoot()
  const wrapRef = useRef(null)
  const imgRef = useRef(null)
  const view = useRef({ scale: 1, x: 0, y: 0 })
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  const raf = useRef(0)
  const [level, setLevel] = useState(1)

  // Keep the image from being panned entirely out of sight.
  const clampPan = useCallback(() => {
    const el = imgRef.current
    if (!el) return
    const v = view.current
    const w = el.offsetWidth || 0
    const h = el.offsetHeight || 0
    const maxX = Math.max(0, (w * v.scale - w) / 2)
    const maxY = Math.max(0, (h * v.scale - h) / 2)
    v.x = clamp(v.x, -maxX, maxX)
    v.y = clamp(v.y, -maxY, maxY)
  }, [])

  const apply = useCallback(() => {
    raf.current = 0
    const el = imgRef.current
    if (!el) return
    const v = view.current
    el.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.scale})`
    setLevel((prev) => (Math.abs(prev - v.scale) > 0.04 ? v.scale : prev))
  }, [])

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(apply)
  }, [apply])

  const zoomTo = useCallback(
    (next) => {
      const v = view.current
      v.scale = clamp(next, MIN, MAX)
      if (v.scale <= MIN + 0.001) {
        v.x = 0
        v.y = 0
      }
      clampPan()
      schedule()
    },
    [clampPan, schedule],
  )

  // Wheel must be a non-passive native listener to be able to preventDefault.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const onWheel = (e) => {
      e.preventDefault()
      zoomTo(view.current.scale * (e.deltaY < 0 ? 1.14 : 1 / 1.14))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomTo])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
      else if (e.key === '+' || e.key === '=') zoomTo(view.current.scale * 1.25)
      else if (e.key === '-') zoomTo(view.current.scale / 1.25)
      else if (e.key === '0') zoomTo(1)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, zoomTo])

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current) }, [])

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

  const onPointerDown = (e) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) { /* not capturable */ }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { d: dist(a, b), scale: view.current.scale }
    }
  }

  const onPointerMove = (e) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, cur)
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const d = dist(a, b)
      if (pinch.current.d > 0) zoomTo(pinch.current.scale * (d / pinch.current.d))
      return
    }
    if (view.current.scale <= MIN + 0.001) return // nothing to pan at fit size
    view.current.x += cur.x - prev.x
    view.current.y += cur.y - prev.y
    clampPan()
    schedule()
  }

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  if (!src) return null

  return createPortal(
    <div
      className="gh-zoom"
      ref={wrapRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'صورة'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => { if (e.target === e.currentTarget && level <= MIN + 0.001) onClose?.() }}
    >
      <img
        ref={imgRef}
        className="gh-zoom-img"
        src={src}
        alt={alt}
        draggable={false}
        onDoubleClick={() => zoomTo(view.current.scale > MIN + 0.001 ? 1 : 2.5)}
      />
      <div className="gh-zoom-bar">
        <button className="gh-zoom-btn" onClick={() => zoomTo(view.current.scale / 1.35)} disabled={level <= MIN + 0.001} aria-label="تصغير">
          <Icon name="minus" size={18} />
        </button>
        <button className="gh-zoom-btn" onClick={() => zoomTo(view.current.scale * 1.35)} disabled={level >= MAX - 0.001} aria-label="تكبير">
          <Icon name="add" size={18} />
        </button>
        <button className="gh-zoom-btn" onClick={() => zoomTo(1)} aria-label="إعادة الضبط">
          <Icon name="reload" size={17} />
        </button>
        <button className="gh-zoom-btn" onClick={onClose} aria-label="إغلاق">
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="gh-zoom-level">{Math.round(level * 100)}%</div>
    </div>,
    portalRoot,
  )
}
