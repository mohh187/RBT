import { useEffect, useMemo, useState } from 'react'
import { resolveChrome, resolveWall } from '../lib/dishComposition.js'

// «كروم المنيو» — the ENGINE half of tenant.menuChrome (resolveChrome).
// Null-render: it never draws a pixel itself. It stamps data-mch-* gate
// attributes plus --mch-* custom properties on document.body, and the CSS
// half (index.css, lead-owned) dresses the real surfaces — bottom nav, the
// two floating fabs, the bar's lang/theme toggles, social buttons and the
// diner sheets — through those vars. Body-level stamping is what lets ONE
// mount reach every portalled surface; inside the studio preview the "body"
// is the iframe's own, so nothing leaks into the admin shell.
//
// The face painter (chromeFaceVars) lives in the editorial theme next to
// wallPaint, whose data-URI tiles are expensive — so the theme chunk is
// loaded lazily and the resolved config is fingerprint-memoized on the raw
// tenant fields: studio slider drags would otherwise regenerate SVG tiles on
// every tick. While the chunk loads, 'room' faces pre-stamp a flat
// wall-coloured fallback so there is no unstyled flash.
//
// Emitted per configured element (prefix per PREFIX below):
//   data-<prefix> + --<prefix>-img/-size/-rep/-pos/-color/-r/-ink
//   (+ -filter/-blend when set) — from chromeFaceVars;
//   fabs only: --<prefix>-x/-y px translate offsets («إمكانية التحريك»).
// Sheet: data-mch-sheet + --mch-sheet-* face vars, --mch-sheet-scrim,
//   --mch-sheet-r, --mch-backdrop (+ --mch-sheet-blur when > 0).
// Everything is removed attribute-by-attribute and property-by-property on
// unmount/config change — a leaked var would dress the admin shell.

const PREFIX = {
  nav: 'mch-nav',
  cartFab: 'mch-fab',
  bellFab: 'mch-bell',
  langBtn: 'mch-lang',
  themeBtn: 'mch-theme',
  social: 'mch-soc',
}

// flat fallback tone while the painter chunk loads — the theme's own clay
const FALLBACK_CLAY = '#8a4a2c'

export default function ChromeSkin({ tenant }) {
  const key = `${JSON.stringify(tenant?.menuChrome || null)}|${JSON.stringify(tenant?.menuWall || null)}`
  const chrome = useMemo(() => resolveChrome(tenant), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const wall = useMemo(() => resolveWall(tenant), [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const needsPainter = !!chrome && (
    Object.values(chrome.elements).some((el) => !!el.skin)
    || !!(chrome.sheet && chrome.sheet.skin)
  )
  const [painter, setPainter] = useState(null)
  useEffect(() => {
    if (!needsPainter || painter) return undefined
    let dead = false
    import('./menuThemes/EditorialLayout.jsx')
      .then((m) => {
        if (!dead && typeof m.chromeFaceVars === 'function') setPainter(() => m.chromeFaceVars)
      })
      .catch(() => { /* face rules keep their CSS fallbacks */ })
    return () => { dead = true }
  }, [needsPainter, painter])

  useEffect(() => {
    if (!chrome || typeof document === 'undefined') return undefined
    const b = document.body
    const attrs = []
    const props = []
    const setProp = (k, v) => { b.style.setProperty(k, String(v)); props.push(k) }
    const mark = (name) => { b.setAttribute(name, '1'); attrs.push(name) }

    Object.entries(chrome.elements).forEach(([id, el]) => {
      const prefix = PREFIX[id]
      if (!prefix) return
      const isFab = id === 'cartFab' || id === 'bellFab'
      const moved = isFab && (el.x !== 0 || el.y !== 0)
      const vars = el.skin && painter ? painter(el, wall, prefix) : null
      // 'room'/'image' before the painter chunk lands: flat colour placeholder
      const pending = !!el.skin && el.skin !== 'none' && !painter
      if (!vars && !moved && !pending) return
      mark(`data-${prefix}`)
      if (vars) {
        Object.entries(vars).forEach(([k, v]) => setProp(k, v))
        if (el.blend && el.blend !== 'normal' && vars[`--${prefix}-blend`] == null) {
          setProp(`--${prefix}-blend`, el.blend)
        }
      } else if (pending) {
        setProp(`--${prefix}-color`, (wall && wall.color) || FALLBACK_CLAY)
      }
      if (moved) {
        setProp(`--${prefix}-x`, `${el.x}px`)
        setProp(`--${prefix}-y`, `${el.y}px`)
      }
    })

    const sheet = chrome.sheet
    if (sheet) {
      mark('data-mch-sheet')
      if (sheet.skin && painter) {
        // sheet face through the same painter; its readability scrim renders
        // separately via --mch-sheet-scrim, so the baked veil is zeroed here
        // to avoid a double veil
        const face = painter({
          skin: sheet.skin,
          url: sheet.url,
          imgScale: 1,
          imgX: 50,
          imgY: 50,
          filter: '',
          blend: 'normal',
          tint: '',
          tintAmount: 0,
          radius: sheet.radius,
          scrim: 0,
          ink: 'light',
        }, wall, 'mch-sheet')
        if (face) Object.entries(face).forEach(([k, v]) => setProp(k, v))
      } else if (sheet.skin && sheet.skin !== 'none' && !painter) {
        setProp('--mch-sheet-color', (wall && wall.color) || FALLBACK_CLAY)
      }
      setProp('--mch-sheet-scrim', sheet.scrim)
      setProp('--mch-sheet-r', `${sheet.radius}px`)
      setProp('--mch-backdrop', sheet.backdrop)
      // The CSS consumes ONE filter var on the sheet's image layer
      // (--mch-sheet-filter); blur composes into it rather than riding a var
      // of its own that no rule reads.
      if (sheet.blur > 0) {
        const cur = props.includes('--mch-sheet-filter') ? b.style.getPropertyValue('--mch-sheet-filter') : ''
        const composed = `${cur && cur !== 'none' ? cur + ' ' : ''}blur(${sheet.blur}px)`
        setProp('--mch-sheet-filter', composed.trim())
      }
    }

    return () => {
      attrs.forEach((a) => b.removeAttribute(a))
      props.forEach((k) => b.style.removeProperty(k))
    }
  }, [chrome, wall, painter])

  return null
}
