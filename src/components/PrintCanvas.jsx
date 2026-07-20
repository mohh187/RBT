import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fontStacks } from '../lib/skins.js'
import { shapeById, renderShapeSvg } from '../lib/printShapes.js'
import { Price } from './Riyal.jsx'
import Icon from './Icon.jsx'

// Free-form print studio — the canvas stage. Renders the page + elements at a
// zoom scale and hosts every direct-manipulation gesture: select, marquee
// multi-select, drag-move (multi) with page + element snapping, rotation-aware
// 8-handle resize, rotate, inline text edit, space/middle-drag pan and
// ctrl+wheel zoom-at-pointer. Pure pointer events, no external libs.
//
// The SAME DOM prints (print CSS strips the chrome and resets the transform),
// so what you see is exactly what lands on paper.
//
// GEOMETRY CONTRACT: the sheet is `position:absolute; left:0; top:0` with
// `transform: scale(s); transform-origin: 0 0`. Under <html dir="rtl"> a
// logical `inset-inline-start` would anchor it to the RIGHT while it scales
// from the left — which is exactly the bug that made the page render a full
// page-width to the left, jammed under the library panel. Everything that
// lives in page coordinates therefore uses PHYSICAL left/top.

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const SNAP_PX = 6      // snap threshold measured in SCREEN px (scale-corrected)
const MIN_SIZE = 8     // smallest element side, in page units
const FIT_PAD = 28     // MUST stay in sync with --ps-pad in printstudio.css
const GRID_STEP = 40   // page units

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const rad = (deg) => ((deg || 0) * Math.PI) / 180

// axis-aligned bounding box of a (possibly rotated) element, in page units
export function aabbOf(el) {
  const r = rad(el.rotate)
  if (!r) return { x: el.x, y: el.y, w: el.w, h: el.h }
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r))
  const w = el.w * c + el.h * s
  const h = el.w * s + el.h * c
  return { x: el.x + (el.w - w) / 2, y: el.y + (el.h - h) / 2, w, h }
}

export function bboxOfMany(els) {
  if (!els.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const el of els) {
    const b = aabbOf(el)
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function priceOf(it) {
  if (!it) return 0
  const base = Number(it.price) || 0
  if (base > 0) return base
  const vs = (it.variants || []).map((v) => Number(v.price) || 0).filter((v) => v > 0)
  return vs.length ? Math.min(...vs) : 0
}

export function textStyleOf(el) {
  const fonts = fontStacks(el.fontKey || 'tajawal')
  return {
    fontFamily: fonts.display,
    fontSize: el.size || 18,
    fontWeight: el.weight || 400,
    color: el.color || '#1c1c1e',
    textAlign: el.align || 'right',
    lineHeight: el.lineHeight || 1.4,
    letterSpacing: `${el.letterSpacing || 0}px`,
    direction: el.dir || 'rtl',
  }
}

export default function PrintCanvas({
  design, items, currency = 'SAR', qrSrc = '',
  selectedIds = [], onSelect, onPatchMany, onCommit,
  zoom = 'fit', onScale, onZoom, showGrid = false,
}) {
  const page = design.page
  const viewportRef = useRef(null)
  const sheetRef = useRef(null)
  const [fitScale, setFitScale] = useState(0.5)
  const [guides, setGuides] = useState({ v: null, h: null })
  const [marquee, setMarquee] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [panning, setPanning] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const gestureRef = useRef(null)
  const zoomAnchorRef = useRef(null)

  const scale = zoom === 'fit' ? fitScale : zoom
  const selSet = useMemo(() => new Set(selectedIds), [selectedIds])

  // ---------- fit-to-viewport ----------
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const calc = () => {
      const availW = vp.clientWidth - FIT_PAD * 2
      const availH = vp.clientHeight - FIT_PAD * 2
      if (availW <= 0 || availH <= 0) return
      setFitScale(clamp(Math.min(availW / page.w, availH / page.h), 0.05, 4))
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [page.w, page.h])

  useEffect(() => { onScale?.(scale) }, [scale, onScale])

  // ---------- ctrl+wheel zoom, anchored at the pointer ----------
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp || !onZoom) return
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = sheetRef.current?.getBoundingClientRect()
      if (!rect) return
      const next = clamp(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.05, 4)
      if (Math.abs(next - scale) < 0.0005) return
      zoomAnchorRef.current = {
        px: (e.clientX - rect.left) / scale,
        py: (e.clientY - rect.top) / scale,
        cx: e.clientX, cy: e.clientY,
      }
      onZoom(next)
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [scale, onZoom])

  // after a zoom, scroll so the anchored page point stays under the cursor
  useLayoutEffect(() => {
    const a = zoomAnchorRef.current
    if (!a) return
    zoomAnchorRef.current = null
    const vp = viewportRef.current
    const rect = sheetRef.current?.getBoundingClientRect()
    if (!vp || !rect) return
    vp.scrollLeft += rect.left + a.px * scale - a.cx
    vp.scrollTop += rect.top + a.py * scale - a.cy
  }, [scale])

  // ---------- space = temporary pan tool ----------
  useEffect(() => {
    const isField = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
    const down = (e) => { if (e.code === 'Space' && !isField(e.target)) { e.preventDefault(); setSpaceDown(true) } }
    const up = (e) => { if (e.code === 'Space') setSpaceDown(false) }
    const blur = () => setSpaceDown(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const itemsMap = useMemo(() => {
    const m = new Map()
    for (const it of items || []) m.set(it.id, it)
    return m
  }, [items])

  const visible = useMemo(() => (design.elements || []).filter((e) => !e.hidden), [design.elements])
  const sorted = useMemo(() => [...visible].sort((a, b) => (a.z || 0) - (b.z || 0)), [visible])

  // page coordinates of a client point
  const toPage = (clientX, clientY) => {
    const rect = sheetRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale }
  }

  // ---------- gesture plumbing (window-level so re-renders never drop it) ----------
  const beginGesture = (e, g) => {
    if (e.button != null && e.button !== 0 && e.button !== 1) return
    e.stopPropagation()
    e.preventDefault()
    gestureRef.current = { ...g, startX: e.clientX, startY: e.clientY, scale, moved: false }
    if (g.type === 'pan') setPanning(true)
    const move = (ev) => handleMove(ev)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const done = gestureRef.current
      gestureRef.current = null
      setGuides({ v: null, h: null })
      setPanning(false)
      if (done?.type === 'marquee') finishMarquee(done)
      else if (done?.moved) onCommit?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const finishMarquee = (g) => {
    setMarquee(null)
    const r = g.rect
    if (!r || r.w < 3 || r.h < 3) {
      if (!g.additive) onSelect?.([])
      return
    }
    const hits = visible.filter((el) => {
      const b = aabbOf(el)
      return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y
    }).map((el) => el.id)
    onSelect?.(g.additive ? [...new Set([...g.baseIds, ...hits])] : hits)
  }

  // snap the moving selection bbox to page thirds/centre AND to other elements
  const snapBox = (bx, by, bw, bh, movingIds) => {
    const tol = SNAP_PX / scale
    const others = visible.filter((el) => !movingIds.has(el.id)).map(aabbOf)
    const vTargets = [0, page.w / 2, page.w]
    const hTargets = [0, page.h / 2, page.h]
    for (const o of others) {
      vTargets.push(o.x, o.x + o.w / 2, o.x + o.w)
      hTargets.push(o.y, o.y + o.h / 2, o.y + o.h)
    }
    const axis = (pos, size, targets) => {
      const anchors = [0, size / 2, size]
      let best = null
      for (const t of targets) for (const a of anchors) {
        const d = t - (pos + a)
        if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, t }
      }
      return best
    }
    const bx2 = axis(bx, bw, vTargets)
    const by2 = axis(by, bh, hTargets)
    return {
      dx: bx2 ? bx2.d : 0, dy: by2 ? by2.d : 0,
      gv: bx2 ? bx2.t : null, gh: by2 ? by2.t : null,
    }
  }

  const handleMove = (ev) => {
    const g = gestureRef.current
    if (!g) return
    const s = g.scale
    const dxRaw = (ev.clientX - g.startX) / s
    const dyRaw = (ev.clientY - g.startY) / s
    if (Math.abs(ev.clientX - g.startX) > 2 || Math.abs(ev.clientY - g.startY) > 2) g.moved = true

    if (g.type === 'pan') {
      const vp = viewportRef.current
      if (vp) {
        vp.scrollLeft = g.sl - (ev.clientX - g.startX)
        vp.scrollTop = g.st - (ev.clientY - g.startY)
      }
      return
    }

    if (g.type === 'marquee') {
      const p = toPage(ev.clientX, ev.clientY)
      const r = {
        x: Math.min(g.origin.x, p.x), y: Math.min(g.origin.y, p.y),
        w: Math.abs(p.x - g.origin.x), h: Math.abs(p.y - g.origin.y),
      }
      g.rect = r
      setMarquee(r)
      return
    }

    if (g.type === 'move') {
      let dx = dxRaw, dy = dyRaw
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 } // axis lock
      const gv = { v: null, h: null }
      if (!ev.altKey) { // alt disables snapping
        const sn = snapBox(g.bbox.x + dx, g.bbox.y + dy, g.bbox.w, g.bbox.h, g.ids)
        dx += sn.dx; dy += sn.dy
        gv.v = sn.gv; gv.h = sn.gh
      }
      setGuides(gv)
      const patches = {}
      for (const o of g.origs) patches[o.id] = { x: Math.round(o.x + dx), y: Math.round(o.y + dy) }
      onPatchMany?.(patches)
      return
    }

    if (g.type === 'resize') {
      const o = g.orig
      const r = rad(o.rotate)
      const cos = Math.cos(r), sin = Math.sin(r)
      // pointer delta expressed in the element's own (rotated) frame
      const ldx = dxRaw * cos + dyRaw * sin
      const ldy = -dxRaw * sin + dyRaw * cos
      const hd = g.handle
      let w = o.w, h = o.h
      if (hd.includes('e')) w = o.w + ldx
      if (hd.includes('w')) w = o.w - ldx
      if (hd.includes('s')) h = o.h + ldy
      if (hd.includes('n')) h = o.h - ldy
      // shift on a corner keeps the aspect ratio
      if (ev.shiftKey && hd.length === 2 && o.w > 0 && o.h > 0) {
        const ratio = o.w / o.h
        if (Math.abs(w - o.w) >= Math.abs(h - o.h)) h = w / ratio
        else w = h * ratio
      }
      w = Math.max(MIN_SIZE, w)
      h = Math.max(MIN_SIZE, h)
      // keep the OPPOSITE edge/corner pinned in page space (correct while rotated)
      const ax = hd.includes('w') ? 1 : hd.includes('e') ? -1 : 0
      const ay = hd.includes('n') ? 1 : hd.includes('s') ? -1 : 0
      const cx0 = o.x + o.w / 2, cy0 = o.y + o.h / 2
      const a0x = (ax * o.w) / 2, a0y = (ay * o.h) / 2
      const anchorX = cx0 + a0x * cos - a0y * sin
      const anchorY = cy0 + a0x * sin + a0y * cos
      const a1x = (ax * w) / 2, a1y = (ay * h) / 2
      const cx1 = anchorX - (a1x * cos - a1y * sin)
      const cy1 = anchorY - (a1x * sin + a1y * cos)
      onPatchMany?.({
        [g.id]: {
          x: Math.round(cx1 - w / 2), y: Math.round(cy1 - h / 2),
          w: Math.round(w), h: Math.round(h),
        },
      })
      return
    }

    if (g.type === 'rotate') {
      const rect = sheetRef.current?.getBoundingClientRect()
      if (!rect) return
      const cx = rect.left + (g.orig.x + g.orig.w / 2) * s
      const cy = rect.top + (g.orig.y + g.orig.h / 2) * s
      const a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI
      let ang = g.rot0 + (a - g.a0)   // grab-relative: no jump on grab
      ang = ((ang % 360) + 360) % 360
      if (ev.shiftKey) ang = Math.round(ang / 15) * 15 % 360
      else for (const t of [0, 45, 90, 135, 180, 225, 270, 315, 360]) {
        if (Math.abs(ang - t) <= 3) { ang = t % 360; break }
      }
      onPatchMany?.({ [g.id]: { rotate: Math.round(ang) } })
    }
  }

  // ---------- gesture starters ----------
  const startMove = (e, el) => {
    if (e.button !== 0 && e.button !== 1) return
    if (spaceDown || e.button === 1) return startPan(e)
    if (editingId === el.id) { e.stopPropagation(); return }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    let ids = selectedIds
    if (additive) {
      ids = selSet.has(el.id) ? selectedIds.filter((i) => i !== el.id) : [...selectedIds, el.id]
      onSelect?.(ids)
      e.stopPropagation()
      e.preventDefault()
      return // a modifier click toggles selection; it never starts a drag
    }
    if (!selSet.has(el.id)) { ids = [el.id]; onSelect?.(ids) }
    const movers = (design.elements || []).filter((x) => ids.includes(x.id) && !x.locked && !x.hidden)
    if (!movers.length) { e.stopPropagation(); return }
    beginGesture(e, {
      type: 'move',
      ids: new Set(movers.map((m) => m.id)),
      origs: movers.map((m) => ({ id: m.id, x: m.x, y: m.y })),
      bbox: bboxOfMany(movers),
    })
  }

  const startResize = (e, el, handle) => beginGesture(e, { type: 'resize', id: el.id, handle, orig: { ...el } })

  const startRotate = (e, el) => {
    const rect = sheetRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + (el.x + el.w / 2) * scale
    const cy = rect.top + (el.y + el.h / 2) * scale
    beginGesture(e, {
      type: 'rotate', id: el.id, orig: { ...el },
      rot0: el.rotate || 0,
      a0: (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI,
    })
  }

  const startPan = (e) => {
    const vp = viewportRef.current
    beginGesture(e, { type: 'pan', sl: vp?.scrollLeft || 0, st: vp?.scrollTop || 0 })
  }

  // empty sheet: marquee (or pan when space/middle is held)
  const startSheetGesture = (e) => {
    if (e.target !== sheetRef.current) return
    if (e.button !== 0 && e.button !== 1) return
    setEditingId(null)
    if (spaceDown || e.button === 1) return startPan(e)
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    if (!additive) onSelect?.([])
    beginGesture(e, {
      type: 'marquee',
      origin: toPage(e.clientX, e.clientY),
      additive,
      baseIds: additive ? selectedIds : [],
      rect: null,
    })
  }

  // grey area around the sheet: pan, and clear the selection on a plain click
  const startViewportGesture = (e) => {
    if (e.button !== 0 && e.button !== 1) return
    setEditingId(null)
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) onSelect?.([])
    startPan(e)
  }

  // ---------- element renderers ----------
  const renderInner = (el) => {
    if (el.type === 'text') {
      return (
        <div
          className="ps-text"
          style={{ ...textStyleOf(el), width: '100%', minHeight: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {el.text || ''}
        </div>
      )
    }
    if (el.type === 'image') {
      return el.url ? (
        <img
          src={el.url} alt="" draggable={false} crossOrigin="anonymous"
          style={{
            width: '100%', height: '100%', display: 'block',
            objectFit: el.fit || 'cover',
            borderRadius: el.radius || 0,
            border: el.borderW ? `${el.borderW}px solid ${el.borderColor || '#1c1c1e'}` : 'none',
            boxShadow: el.shadow ? '0 10px 28px rgba(0,0,0,0.35)' : 'none',
            transform: el.flipH ? 'scaleX(-1)' : 'none',
          }}
        />
      ) : <div className="ps-ph"><Icon name="image" size={22} /></div>
    }
    if (el.type === 'shape') {
      const sh = shapeById(el.shapeId)
      if (!sh) return <div className="ps-ph"><Icon name="shapes" size={20} /></div>
      return <div className="ps-shape" dangerouslySetInnerHTML={{ __html: renderShapeSvg(sh, el) }} />
    }
    if (el.type === 'qr') {
      return qrSrc
        ? <img src={qrSrc} alt="QR" draggable={false} style={{ width: '100%', height: '100%', display: 'block' }} />
        : <div className="ps-ph"><Icon name="qr" size={22} /></div>
    }
    if (el.type === 'itemcard') {
      const it = itemsMap.get(el.itemId)
      const ink = el.ink || '#1c1c1e'
      const accent = el.accent || '#1c1c1e'
      return (
        <div className={`ps-itemcard ps-ic-${el.layout || 'h'}`} style={{ background: el.bg || '#ffffff', color: ink }}>
          {it?.imageUrl ? <img src={it.imageUrl} alt="" draggable={false} crossOrigin="anonymous" className="ps-ic-img" /> : null}
          <div className="ps-ic-main">
            <span className="ps-ic-name">{it ? (it.nameAr || it.nameEn) : 'صنف غير موجود'}</span>
            {el.showDesc && (it?.descAr || it?.descEn) ? <span className="ps-ic-desc">{it.descAr || it.descEn}</span> : null}
            {el.showPrice !== false && it ? (
              <span className="ps-ic-price" style={{ color: accent }}>
                <Price value={priceOf(it)} currency={currency} lang="ar" symbolSize="0.85em" />
              </span>
            ) : null}
          </div>
        </div>
      )
    }
    return null
  }

  const single = selectedIds.length === 1
  const hairline = Math.max(1, 1 / scale)

  return (
    <div
      ref={viewportRef}
      className={`ps-viewport ${spaceDown ? 'can-pan' : ''} ${panning ? 'panning' : ''}`}
      onPointerDown={startViewportGesture}
    >
      <div className="ps-stage-box" style={{ width: page.w * scale, height: page.h * scale }}>
        <div
          ref={sheetRef}
          id="ps-sheet"
          className="ps-sheet"
          dir="rtl"
          onPointerDown={startSheetGesture}
          style={{
            width: page.w, height: page.h,
            transform: `scale(${scale})`,
            background: page.bgColor || '#ffffff',
          }}
        >
          {page.bgImageUrl ? (
            <img src={page.bgImageUrl} alt="" draggable={false} crossOrigin="anonymous" className="ps-bgimg" style={{ opacity: page.bgOpacity ?? 1 }} />
          ) : null}

          {showGrid ? <div className="ps-grid no-print" style={{ '--gs': `${GRID_STEP}px` }} /> : null}

          {sorted.map((el) => {
            const sel = selSet.has(el.id)
            const editing = editingId === el.id
            return (
              <div
                key={el.id}
                className={`ps-el ${sel ? 'is-sel' : ''} ${sel && !single ? 'is-multi' : ''} ${el.locked ? 'is-locked' : ''}`}
                style={{
                  left: el.x, top: el.y, width: el.w, height: el.h,
                  transform: `rotate(${el.rotate || 0}deg)`,
                  opacity: el.opacity ?? 1,
                  zIndex: el.z || 0,
                }}
                onPointerDown={(e) => startMove(e, el)}
                onDoubleClick={(e) => {
                  if (el.type === 'text' && !el.locked) { e.stopPropagation(); setEditingId(el.id); onSelect?.([el.id]) }
                }}
              >
                {editing && el.type === 'text' ? (
                  <textarea
                    className="ps-text-edit"
                    autoFocus
                    value={el.text || ''}
                    style={{ ...textStyleOf(el), fontSize: el.size || 18 }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onChange={(e) => onPatchMany?.({ [el.id]: { text: e.target.value } })}
                    onBlur={() => { setEditingId(null); onCommit?.() }}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Escape') e.currentTarget.blur()
                    }}
                  />
                ) : renderInner(el)}

                {sel && !editing ? (
                  <>
                    <div className="ps-sel-outline" style={{ outlineWidth: Math.max(1, 1.5 / scale) }} />
                    {single && !el.locked ? (
                      <>
                        {HANDLES.map((hn) => (
                          <div
                            key={hn}
                            className={`ps-h ps-h-${hn} no-print`}
                            style={{ '--hs': `${Math.max(6, 9 / scale)}px` }}
                            onPointerDown={(e) => startResize(e, el, hn)}
                          />
                        ))}
                        <div
                          className="ps-h-rot no-print"
                          style={{ '--hs': `${Math.max(8, 12 / scale)}px`, '--ro': `${22 / scale}px` }}
                          onPointerDown={(e) => startRotate(e, el)}
                        />
                      </>
                    ) : null}
                    {el.locked ? <span className="ps-lockmark no-print"><Icon name="lock" size={12} /></span> : null}
                  </>
                ) : null}
              </div>
            )
          })}

          {guides.v !== null ? <div className="ps-guide ps-guide-v no-print" style={{ left: guides.v, width: hairline }} /> : null}
          {guides.h !== null ? <div className="ps-guide ps-guide-h no-print" style={{ top: guides.h, height: hairline }} /> : null}
          {marquee ? (
            <div
              className="ps-marquee no-print"
              style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderWidth: hairline }}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
