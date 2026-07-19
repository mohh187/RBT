import { useEffect, useRef, useState } from 'react'

/**
 * DishHotspots — tappable info points pinned ON the dish photo («قابلية الضغط
 * على عناصر من داخل الطبق»). The manager pins a point on an ingredient, a
 * sauce, or a signature side; the customer taps the dot and a small card
 * explains what it is.
 *
 * DATA CONTRACT (fixed — themes render against it):
 *   item.hotspots = [{ x, y, label, desc? }]   (max 8)
 *   - x, y : percentages 0-100 relative to the IMAGE BOX; x is measured from
 *     the image's LEFT edge, y from its TOP edge.
 *   - label: short Arabic text (required); desc: optional longer text.
 *
 * HOST CONTRACT (what the theme must provide):
 *   Render this component as a sibling right after the <img>, inside a wrapper
 *   that is position:relative and matches the visible image box exactly:
 *     <div style={{ position: 'relative' }}>
 *       <img src={item.imageUrl} ... />
 *       <DishHotspots hotspots={item.hotspots} accent={skinAccent} />
 *     </div>
 *   The layer itself is position:absolute inset:0 with pointer-events:none —
 *   only the dots and the open popover re-enable pointer events (and call
 *   stopPropagation), so the photo's own tap/gesture handlers keep working.
 *
 * RTL NOTE: positioning deliberately uses physical `left`/`top` (never
 * inset-inline). x is measured from the LEFT of the image — a physical,
 * direction-agnostic axis — so the dot stays glued to the same spot of the
 * photo whether the page is dir="rtl" or dir="ltr".
 */

const pct = (v) => Math.min(100, Math.max(0, Number(v) || 0))

export default function DishHotspots({ hotspots = [], accent }) {
  const layerRef = useRef(null)
  const [openIdx, setOpenIdx] = useState(-1)
  const spots = (Array.isArray(hotspots) ? hotspots : []).filter((h) => h && h.label).slice(0, 8)

  // One popover at a time — closes on any tap outside the layer's interactive
  // parts (capture phase, so it fires even when a target swallows the event)
  // and on Escape.
  useEffect(() => {
    if (openIdx < 0) return undefined
    const onDown = (e) => { if (!layerRef.current || !layerRef.current.contains(e.target)) setOpenIdx(-1) }
    const onKey = (e) => { if (e.key === 'Escape') setOpenIdx(-1) }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [openIdx])

  if (!spots.length) return null

  // Popover placement heuristic in % space: flips below/above and start/end so
  // the card stays inside the image box without measuring the DOM. Horizontal
  // math is physical-left based for the same RTL reason as the dots.
  const popStyle = (h) => {
    const x = pct(h.x)
    const y = pct(h.y)
    const st = {}
    if (y >= 55) st.bottom = `calc(${100 - y}% + 16px)`
    else st.top = `calc(${y}% + 16px)`
    if (x <= 28) { st.left = `${x}%`; st.marginLeft = -10 }
    else if (x >= 72) { st.right = `${100 - x}%`; st.marginRight = -10 }
    else { st.left = `${x}%`; st.transform = 'translateX(-50%)' }
    return st
  }

  return (
    <div ref={layerRef} className="dish-hotspots" style={accent ? { color: accent } : undefined}>
      {spots.map((h, i) => (
        <button
          key={i}
          type="button"
          className={`dh-dot ${openIdx === i ? 'dh-open' : ''}`}
          style={{ left: `${pct(h.x)}%`, top: `${pct(h.y)}%` }}
          aria-expanded={openIdx === i}
          aria-label={h.label}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setOpenIdx(openIdx === i ? -1 : i) }}
        >
          <i />
        </button>
      ))}
      {openIdx >= 0 && spots[openIdx] && (
        <div
          className="dh-pop"
          style={popStyle(spots[openIdx])}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <strong>{spots[openIdx].label}</strong>
          {spots[openIdx].desc ? <span>{spots[openIdx].desc}</span> : null}
        </div>
      )}
    </div>
  )
}
