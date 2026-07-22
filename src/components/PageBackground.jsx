import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveChromePage, resolveWall } from '../lib/dishComposition.js'

// «الغرفة في باقي الصفحات» — the background layer for the diner SUBPAGES
// (profile / events / book / order / reserve / pass), driven by
// tenant.menuChrome.pages via resolveChromePage. Null resolver = render
// nothing = today's look; the whole feature is opt-in.
//
// mode 'wall'  -> the venue's own menu wall (resolveWall + the theme's
//                 wallPaint, lazily imported — its data-URI tiles are the
//                 expensive part) under a dim scrim;
// mode 'image' -> the page's own photo under dim + blur.
//
// It portals to document.body and reuses the .venue-bg / .venue-bg-media
// fixed-layer positioning; page content sits above it inside the existing
// .venue-above stacking wrapper. Readability policy: the dim scrim plus the
// page's own var(--surface) cards carry the text — never the photo itself.

export default function PageBackground({ tenant, page }) {
  const key = `${JSON.stringify(tenant?.menuChrome || null)}|${JSON.stringify(tenant?.menuWall || null)}|${page}`
  const cfg = useMemo(() => resolveChromePage(tenant, page), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const wall = useMemo(
    () => (cfg && cfg.mode === 'wall' ? resolveWall(tenant) : null),
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const wantsWall = !!cfg && cfg.mode === 'wall' && !!wall
  const [painter, setPainter] = useState(null)
  useEffect(() => {
    if (!wantsWall || painter) return undefined
    let dead = false
    import('./menuThemes/EditorialLayout.jsx')
      .then((m) => {
        if (!dead && typeof m.wallPaint === 'function') setPainter(() => m.wallPaint)
      })
      .catch(() => { /* the flat wall colour below stays */ })
    return () => { dead = true }
  }, [wantsWall, painter])

  const paint = useMemo(
    () => (wantsWall && painter ? painter(wall) : null),
    [wantsWall, painter, wall],
  )

  if (!cfg || typeof document === 'undefined') return null
  // 'wall' asked for but the venue has no configured wall: nothing to paint
  if (cfg.mode === 'wall' && !wall) return null

  const media = cfg.mode === 'wall'
    ? (paint || { background: wall.color || undefined })
    : {
      backgroundImage: `url("${String(cfg.url).replace(/["\\]/g, '')}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      filter: cfg.blur ? `blur(${cfg.blur}px)` : undefined,
      // a blurred fixed layer bleeds transparent edges — oversize it slightly
      transform: cfg.blur ? 'scale(1.06)' : undefined,
    }

  return createPortal(
    <div className="venue-bg" aria-hidden="true">
      <div className="venue-bg-media" style={media} />
      <div className="venue-bg-media" style={{ background: `rgba(10,6,4,${cfg.dim})` }} />
    </div>,
    document.body,
  )
}
