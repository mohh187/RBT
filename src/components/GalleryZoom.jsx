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
        onScroll={(e) => {
          const el = e.currentTarget
          const w = (el.firstElementChild && el.firstElementChild.offsetWidth + 14) || 1
          setZoomIdx(Math.min(gallery.length - 1, Math.round(Math.abs(el.scrollLeft) / w)))
        }}
      >
        {gallery.map((src, i) => (
          Math.abs(i - zoomIdx) <= 1
            ? <img key={i} src={src} alt="" decoding="async" />
            : <div key={i} aria-hidden="true" style={{ flex: '0 0 90vw', scrollSnapAlign: 'center' }} />
        ))}
      </div>
      <button className="img-zoom-x" onClick={onClose} aria-label={t('close')}><Icon name="close" size={22} /></button>
    </div>,
    portalRoot,
  )
}
