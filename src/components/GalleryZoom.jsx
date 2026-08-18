// GalleryZoom — fullscreen swipeable photo lightbox, extracted VERBATIM from
// ItemSheet's inline img-zoom portal so the editorial stage (and any future
// detail view) can share one implementation. Same CSS contract — .img-zoom /
// .img-zoom-track / .img-zoom-x in index.css — no styles of its own.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'
import { usePortalRoot } from './PortalRoot.jsx'

export default function GalleryZoom({ gallery, startIdx = 0, onClose }) {
  const { t } = useI18n()
  const portalRoot = usePortalRoot()
  const trackRef = useRef(null)
  // which zoom slide is in view — drives the ±1 decode window below
  const [zoomIdx, setZoomIdx] = useState(() => Math.min(Math.max(0, startIdx), Math.max(0, gallery.length - 1)))

  // Land on the opening slide instantly (no smooth scroll on mount).
  // scrollIntoView is direction-safe, so RTL needs no scrollLeft sign math.
  useEffect(() => {
    const slide = trackRef.current && trackRef.current.children[zoomIdx]
    if (!slide) return
    try { slide.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' }) } catch (_) { slide.scrollIntoView() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes THIS layer only. Capture on window fires before the host's
  // own Escape listeners (Sheet's document one, the editorial stage's window
  // one), and stopPropagation keeps that single press from also closing the
  // whole detail view underneath the lightbox.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // ---- pinch + pan, owned by this component ----
  // Native page zoom is now off product-wide (index.html + touch-action), and
  // this lightbox is the ONE surface the owner wants zoomable. It used to lean
  // on the browser's pinch, so it had to grow its own. Pointer events, so one
  // path covers touch, pen and trackpad.
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 })
  const g = useRef({ pts: new Map(), d0: 0, s0: 1, x0: 0, y0: 0, px: 0, py: 0, tap: 0 })
  const zoomed = z.s > 1.01

  // a new slide always starts unzoomed, or the next photo inherits the last pan
  useEffect(() => { setZ({ s: 1, x: 0, y: 0 }) }, [zoomIdx])

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  const onDown = (e) => {
    const st = g.current
    st.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (st.pts.size === 2) {
      const [a, b] = [...st.pts.values()]
      st.d0 = dist(a, b); st.s0 = z.s; st.x0 = z.x; st.y0 = z.y
    } else if (st.pts.size === 1 && zoomed) {
      st.px = e.clientX; st.py = e.clientY; st.x0 = z.x; st.y0 = z.y
    }
  }
  const onMove = (e) => {
    const st = g.current
    if (!st.pts.has(e.pointerId)) return
    st.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (st.pts.size >= 2 && st.d0 > 0) {
      const [a, b] = [...st.pts.values()]
      const s = Math.min(5, Math.max(1, st.s0 * (dist(a, b) / st.d0)))
      setZ({ s, x: st.x0 * (s / st.s0), y: st.y0 * (s / st.s0) })
    } else if (st.pts.size === 1 && zoomed) {
      // panning a zoomed photo must not also swipe the track to the next one
      setZ((v) => ({ ...v, x: st.x0 + (e.clientX - st.px), y: st.y0 + (e.clientY - st.py) }))
    }
  }
  const onUp = (e) => {
    const st = g.current
    st.pts.delete(e.pointerId)
    if (st.pts.size < 2) st.d0 = 0
    // settle back to a clean fit rather than leaving a 1.004 scale behind.
    // Functional form on purpose: `z` from this render can lag the last
    // setZ of the gesture, and the stale read would skip the settle.
    setZ((v) => (v.s <= 1.01 ? { s: 1, x: 0, y: 0 } : v))
  }
  // double-tap / double-click toggles, the gesture people expect from a photo
  const onTapZoom = (e) => {
    e.stopPropagation()
    const now = e.timeStamp || 0
    const st = g.current
    const quick = now - st.tap < 320
    st.tap = now
    if (quick) setZ(zoomed ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 })
  }

  if (!portalRoot) return null
  return createPortal(
    <div className="img-zoom" onClick={onClose} role="dialog" aria-modal="true">
      {/* DECODE WINDOW ±1. This track used to mount EVERY gallery photo
          at full resolution simultaneously — on a menu already holding
          dozens of images that spike is WKWebView tab-kill fuel (the
          "screen breaks and reloads" report). Only the current slide and
          its neighbours are real <img>; the rest are placeholder slots
          with identical flex-basis + snap so the geometry, snapping and
          dots are untouched. Slots match .img-zoom-track img (90vw). */}
      <div
        ref={trackRef}
        className="img-zoom-track"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onUp}
        onDoubleClick={onTapZoom}
        // unzoomed: the browser owns the horizontal swipe between photos.
        // zoomed: we own every finger, or dragging the photo would scroll the
        // track to the next one instead of panning the picture.
        style={{ touchAction: zoomed ? 'none' : 'pan-x', overflowX: zoomed ? 'hidden' : 'auto' }}
        onScroll={(e) => {
          const el = e.currentTarget
          const w = (el.firstElementChild && el.firstElementChild.offsetWidth + 14) || 1
          setZoomIdx(Math.min(gallery.length - 1, Math.round(Math.abs(el.scrollLeft) / w)))
        }}
      >
        {gallery.map((src, i) => (
          Math.abs(i - zoomIdx) <= 1
            ? (
              <img
                key={i}
                src={src}
                alt=""
                decoding="async"
                draggable={false}
                onTouchEnd={i === zoomIdx ? onTapZoom : undefined}
                style={i === zoomIdx && zoomed
                  ? { transform: `translate3d(${z.x}px, ${z.y}px, 0) scale(${z.s})`, cursor: 'grab', willChange: 'transform' }
                  : undefined}
              />
            )
            : <div key={i} aria-hidden="true" style={{ flex: '0 0 90vw', scrollSnapAlign: 'center' }} />
        ))}
      </div>
      <button className="img-zoom-x" onClick={onClose} aria-label={t('close')}><Icon name="close" size={22} /></button>
    </div>,
    portalRoot,
  )
}
