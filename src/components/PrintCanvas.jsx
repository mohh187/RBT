import { useEffect, useMemo, useRef, useState } from 'react'
import { fontStacks } from '../lib/skins.js'
import { shapeById, renderShapeSvg } from '../lib/printShapes.js'
import { Price } from './Riyal.jsx'
import Icon from './Icon.jsx'

// Free-form print studio — the canvas stage: renders the page + elements at a
// zoom scale, and hosts every direct-manipulation gesture (select, drag-move
// with center/edge snapping, 8-handle resize, rotate, inline text editing,
// drag-to-pan). Pure pointer events — no external libs. The SAME DOM prints
// (print CSS strips the editor chrome and resets the zoom transform), so what
// you see is exactly what lands on paper.

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const SNAP = 6 // page-unit snap threshold to page center/edges

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
  selectedId, onSelect, onPatch, onCommit,
  zoom = 'fit', onScale,
}) {
  const page = design.page
  const viewportRef = useRef(null)
  const sheetRef = useRef(null)
  const [fitScale, setFitScale] = useState(0.5)
  const [guides, setGuides] = useState({ v: null, h: null })
  const [editingId, setEditingId] = useState(null)
  const gestureRef = useRef(null)

  const scale = zoom === 'fit' ? fitScale : zoom

  // fit-to-viewport scale (recomputed on resize + page size change)
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const calc = () => {
      const s = Math.min((vp.clientWidth - 48) / page.w, (vp.clientHeight - 48) / page.h)
      setFitScale(Math.max(0.05, Math.min(2, s)))
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [page.w, page.h])

  useEffect(() => { onScale?.(scale) }, [scale, onScale])

  const itemsMap = useMemo(() => {
    const m = new Map()
    for (const it of items || []) m.set(it.id, it)
    return m
  }, [items])

  const sorted = useMemo(() => [...(design.elements || [])].sort((a, b) => (a.z || 0) - (b.z || 0)), [design.elements])

  // ---------- gestures (window-level move/up so re-renders never drop them) ----------
  const beginGesture = (e, g) => {
    e.stopPropagation()
    e.preventDefault()
    gestureRef.current = { ...g, startX: e.clientX, startY: e.clientY }
    const move = (ev) => handleMove(ev)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (gestureRef.current?.moved) onCommit?.()
      gestureRef.current = null
      setGuides({ v: null, h: null })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const handleMove = (ev) => {
    const g = gestureRef.current
    if (!g) return
    const dx = (ev.clientX - g.startX) / scale
    const dy = (ev.clientY - g.startY) / scale
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) g.moved = true

    if (g.type === 'move') {
      let nx = g.orig.x + dx
      let ny = g.orig.y + dy
      const gv = { v: null, h: null }
      // snap element left/center/right to page 0 / center / w (same vertically)
      const snapAxis = (pos, size, max) => {
        const anchors = [0, size / 2, size]
        const targets = [0, max / 2, max]
        let best = null
        for (const t of targets) for (const a of anchors) {
          const d = t - (pos + a)
          if (Math.abs(d) <= SNAP && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, t }
        }
        return best
      }
      const bx = snapAxis(nx, g.orig.w, page.w)
      if (bx) { nx += bx.d; gv.v = bx.t }
      const by = snapAxis(ny, g.orig.h, page.h)
      if (by) { ny += by.d; gv.h = by.t }
      setGuides(gv)
      onPatch?.(g.id, { x: Math.round(nx), y: Math.round(ny) })
    } else if (g.type === 'resize') {
      const o = g.orig
      let { x, y, w, h } = o
      const hd = g.handle
      if (hd.includes('e')) w = o.w + dx
      if (hd.includes('w')) { w = o.w - dx; x = o.x + dx }
      if (hd.includes('s')) h = o.h + dy
      if (hd.includes('n')) { h = o.h - dy; y = o.y + dy }
      if (ev.shiftKey && hd.length === 2 && o.h > 0) {
        const ratio = o.w / o.h
        if (Math.abs(dx) >= Math.abs(dy)) { h = w / ratio; if (hd.includes('n')) y = o.y + (o.h - h) } else { w = h * ratio; if (hd.includes('w')) x = o.x + (o.w - w) }
      }
      if (w < 10) { if (hd.includes('w')) x -= 10 - w; w = 10 }
      if (h < 10) { if (hd.includes('n')) y -= 10 - h; h = 10 }
      onPatch?.(g.id, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) })
    } else if (g.type === 'rotate') {
      const rect = sheetRef.current?.getBoundingClientRect()
      if (!rect) return
      const cx = rect.left + (g.orig.x + g.orig.w / 2) * scale
      const cy = rect.top + (g.orig.y + g.orig.h / 2) * scale
      let ang = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90
      ang = ((ang % 360) + 360) % 360
      for (const s of [0, 45, 90, 135, 180, 225, 270, 315, 360]) if (Math.abs(ang - s) <= 4) ang = s % 360
      onPatch?.(g.id, { rotate: Math.round(ang) })
    } else if (g.type === 'pan') {
      const vp = viewportRef.current
      if (vp) {
        vp.scrollLeft = g.sl - (ev.clientX - g.startX)
        vp.scrollTop = g.st - (ev.clientY - g.startY)
      }
    }
  }

  const startMove = (e, el) => {
    if (el.locked) { onSelect?.(el.id); return }
    if (editingId === el.id) return
    onSelect?.(el.id)
    beginGesture(e, { type: 'move', id: el.id, orig: { ...el } })
  }
  const startResize = (e, el, handle) => beginGesture(e, { type: 'resize', id: el.id, handle, orig: { ...el } })
  const startRotate = (e, el) => beginGesture(e, { type: 'rotate', id: el.id, orig: { ...el } })
  const startPan = (e) => {
    onSelect?.(null)
    setEditingId(null)
    const vp = viewportRef.current
    beginGesture(e, { type: 'pan', sl: vp?.scrollLeft || 0, st: vp?.scrollTop || 0 })
  }

  // ---------- element renderers ----------
  const renderInner = (el) => {
    if (el.type === 'text') {
      return (
        <div className="ps-text" style={{ ...textStyleOf(el), width: '100%', minHeight: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {el.text || ''}
        </div>
      )
    }
    if (el.type === 'image') {
      return el.url ? (
        <img
          src={el.url} alt="" draggable={false}
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
      return (
        <div className={`ps-itemcard ps-ic-${el.layout || 'h'}`}>
          {it?.imageUrl ? <img src={it.imageUrl} alt="" draggable={false} className="ps-ic-img" /> : null}
          <div className="ps-ic-main">
            <span className="ps-ic-name">{it ? (it.nameAr || it.nameEn) : 'صنف غير موجود'}</span>
            {el.showDesc && (it?.descAr || it?.descEn) ? <span className="ps-ic-desc">{it.descAr || it.descEn}</span> : null}
            {el.showPrice !== false && it ? <span className="ps-ic-price"><Price value={priceOf(it)} currency={currency} lang="ar" symbolSize="0.85em" /></span> : null}
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div ref={viewportRef} className="ps-viewport" onPointerDown={startPan}>
      <div className="ps-stage-box" style={{ width: page.w * scale, height: page.h * scale }}>
        <div
          ref={sheetRef}
          id="ps-sheet"
          className="ps-sheet"
          dir="rtl"
          onPointerDown={(e) => { if (e.target === sheetRef.current) { e.stopPropagation(); onSelect?.(null); setEditingId(null) } }}
          style={{
            width: page.w, height: page.h,
            transform: `scale(${scale})`,
            background: page.bgColor || '#ffffff',
          }}
        >
          {page.bgImageUrl ? (
            <img src={page.bgImageUrl} alt="" draggable={false} className="ps-bgimg" style={{ opacity: page.bgOpacity ?? 1 }} />
          ) : null}

          {sorted.map((el) => {
            const sel = el.id === selectedId
            const editing = editingId === el.id
            return (
              <div
                key={el.id}
                className={`ps-el ${sel ? 'is-sel' : ''} ${el.locked ? 'is-locked' : ''}`}
                style={{
                  left: el.x, top: el.y, width: el.w, height: el.h,
                  transform: `rotate(${el.rotate || 0}deg)`,
                  opacity: el.opacity ?? 1,
                  zIndex: el.z || 0,
                }}
                onPointerDown={(e) => startMove(e, el)}
                onDoubleClick={(e) => {
                  if (el.type === 'text' && !el.locked) { e.stopPropagation(); setEditingId(el.id); onSelect?.(el.id) }
                }}
              >
                {editing && el.type === 'text' ? (
                  <textarea
                    className="ps-text-edit"
                    autoFocus
                    value={el.text || ''}
                    style={{ ...textStyleOf(el), fontSize: el.size || 18 }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => onPatch?.(el.id, { text: e.target.value })}
                    onBlur={() => { setEditingId(null); onCommit?.() }}
                    onKeyDown={(e) => { if (e.key === 'Escape') e.target.blur(); e.stopPropagation() }}
                  />
                ) : renderInner(el)}

                {sel && !editing ? (
                  <>
                    <div className="ps-sel-outline" style={{ outlineWidth: Math.max(1, 1.5 / scale) }} />
                    {!el.locked && HANDLES.map((h) => (
                      <div key={h} className={`ps-h ps-h-${h}`} style={{ '--hs': `${Math.max(7, 9 / scale)}px` }} onPointerDown={(e) => startResize(e, el, h)} />
                    ))}
                    {!el.locked && (
                      <div className="ps-h-rot" style={{ '--hs': `${Math.max(9, 12 / scale)}px` }} onPointerDown={(e) => startRotate(e, el)} />
                    )}
                    {el.locked ? <span className="ps-lockmark"><Icon name="lock" size={12} /></span> : null}
                  </>
                ) : null}
              </div>
            )
          })}

          {guides.v !== null ? <div className="ps-guide ps-guide-v" style={{ left: guides.v, width: Math.max(1, 1 / scale) }} /> : null}
          {guides.h !== null ? <div className="ps-guide ps-guide-h" style={{ top: guides.h, height: Math.max(1, 1 / scale) }} /> : null}
        </div>
      </div>
    </div>
  )
}
