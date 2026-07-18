import { useEffect, useRef, useState } from 'react'
import { isOfferActive } from '../lib/offers.js'
import { money } from '../lib/format.js'

// Shared renderer for `design` signage slides — used by the TV player AND the
// editor canvas (WYSIWYG: same code paints both). Layers live on a relative
// percentage grid `{x,y,w,h}` of the canvas, font sizes are % of canvas WIDTH,
// so one design adapts to any screen size or orientation.
//
// slide = { type:'design', duration, bg:{kind:'color'|'image', color, color2?, angle?, url?}, layers:[...] }
// layer = { id, type:'text'|'image'|'shape'|'qr', x,y,w,h, rot?, opacity?,
//           text: content, fs, color, weight, align, shadow, binding?
//           image: url, fit, radius (% of width)
//           shape: shape:'rect'|'circle', color, radius (% of width)
//           qr: qrKind:'menu'|'custom', value?, dark? }
// binding = { kind:'itemName'|'itemPrice'|'offerTitle'|'offerValue'|'offerCode', itemId? }
// `data` = { items, offers, venue } — live Firestore feeds; text falls back to
// the layer's static content when the bound value isn't available.

export function newLayerId() { return `L${Math.random().toString(36).slice(2, 9)}` }

const itemPriceVal = (it) => {
  const b = Number(it?.price) || 0
  if (b) return b
  const vs = (it?.variants || []).map((v) => Number(v.price) || 0).filter((x) => x > 0)
  return vs.length ? Math.min(...vs) : 0
}

// Live-binding resolution: pulls item name/price or the currently ACTIVE offer
// straight from tenant data. Static `content` is the designed fallback.
export function resolveBinding(l, data) {
  const b = l.binding
  if (!b || !b.kind) return l.content || ''
  if (b.kind === 'itemName' || b.kind === 'itemPrice') {
    const it = (data?.items || []).find((x) => x.id === b.itemId)
    if (!it) return l.content || ''
    return b.kind === 'itemName'
      ? (it.nameAr || it.nameEn || '')
      : money(itemPriceVal(it), data?.venue?.currency || 'SAR', 'ar')
  }
  const offer = (data?.offers || []).filter((o) => isOfferActive(o))
    .sort((a, b2) => (Number(b2.value) || 0) - (Number(a.value) || 0))[0]
  if (!offer) return l.content || ''
  if (b.kind === 'offerTitle') return offer.nameAr || offer.nameEn || ''
  if (b.kind === 'offerValue') return offer.type === 'percent' ? `${offer.value}%` : money(offer.value, data?.venue?.currency || 'SAR', 'ar')
  if (b.kind === 'offerCode') return offer.code || ''
  return l.content || ''
}

// QR layer body — generates the code lazily (qrcode lib is code-split away
// from the base player bundle) and regenerates when the target changes.
function QrLayer({ layer, data, radiusPx }) {
  const [src, setSrc] = useState('')
  const slug = data?.venue?.slug || ''
  const target = layer.qrKind === 'custom' ? (layer.value || '') : slug ? `menu:${slug}` : ''
  useEffect(() => {
    let alive = true
    if (!target) { setSrc(''); return }
    import('../lib/qr.js').then(({ qrDataUrl, menuUrl }) => {
      const text = layer.qrKind === 'custom' ? (layer.value || '') : menuUrl(slug)
      if (!text) return
      qrDataUrl(text, { width: 512, dark: layer.dark || '#111111', light: '#ffffff' }).then((d) => { if (alive) setSrc(d) })
    }).catch(() => {})
    return () => { alive = false }
  }, [target, layer.qrKind, layer.value, layer.dark, slug])
  if (!src) return <div style={{ width: '100%', height: '100%', borderRadius: radiusPx, background: 'rgba(255,255,255,.92)', display: 'grid', placeItems: 'center', color: '#111', fontSize: 12, fontWeight: 700 }}>QR</div>
  return <img src={src} alt="QR" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: radiusPx, background: '#ffffff', display: 'block', pointerEvents: 'none' }} />
}

export default function DesignSlideView({ slide, data, animate = false, selIdx = -1, onLayerDown, onHandleDown, style }) {
  const ref = useRef(null)
  const [w, setW] = useState(0)

  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((es) => setW(es[0]?.contentRect?.width || 0))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  const bg = slide?.bg || {}
  const bgStyle = bg.kind === 'image' && bg.url
    ? { backgroundImage: `url(${bg.url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: bg.color2 ? `linear-gradient(${bg.angle ?? 135}deg, ${bg.color || '#111827'}, ${bg.color2})` : (bg.color || '#111827') }

  const editable = typeof onLayerDown === 'function'

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', direction: 'rtl', ...bgStyle, ...style }}>
      {(slide?.layers || []).map((l, i) => {
        const common = {
          position: 'absolute',
          left: `${l.x}%`,
          top: `${l.y}%`,
          width: `${l.w}%`,
          height: `${l.h}%`,
          transform: l.rot ? `rotate(${l.rot}deg)` : undefined,
          opacity: l.opacity ?? 1,
          cursor: editable ? 'move' : undefined,
          touchAction: editable ? 'none' : undefined,
          userSelect: editable ? 'none' : undefined,
          outline: editable && i === selIdx ? '2px dashed #22d3ee' : editable ? '1px dashed rgba(255,255,255,.14)' : undefined,
          outlineOffset: 2,
        }
        const radiusPx = `${((Number(l.radius) || 0) * w) / 100}px`
        let body = null
        if (l.type === 'text') {
          body = (
            <div style={{
              width: '100%', height: '100%', display: 'flex', alignItems: 'center',
              justifyContent: l.align === 'start' ? 'flex-start' : l.align === 'end' ? 'flex-end' : 'center',
              textAlign: l.align === 'start' ? 'start' : l.align === 'end' ? 'end' : 'center',
              fontSize: Math.max(8, (w * (Number(l.fs) || 5)) / 100),
              fontWeight: Number(l.weight) || 800,
              color: l.color || '#ffffff',
              lineHeight: 1.15,
              whiteSpace: 'pre-wrap',
              overflow: 'hidden',
              textShadow: l.shadow ? '0 2px 14px rgba(0,0,0,.5)' : undefined,
            }}>{resolveBinding(l, data)}</div>
          )
        } else if (l.type === 'qr') {
          body = <QrLayer layer={l} data={data} radiusPx={radiusPx} />
        } else if (l.type === 'image') {
          body = l.url
            ? <img src={l.url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: l.fit || 'cover', borderRadius: radiusPx, display: 'block', pointerEvents: 'none' }} />
            : <div style={{ width: '100%', height: '100%', borderRadius: radiusPx, background: 'rgba(255,255,255,.12)', display: 'grid', placeItems: 'center', fontSize: 12, color: '#fff' }}>صورة</div>
        } else {
          body = <div style={{ width: '100%', height: '100%', background: l.color || '#ffffff', borderRadius: l.shape === 'circle' ? '50%' : radiusPx }} />
        }
        return (
          <div key={l.id || i} style={common} onPointerDown={editable ? (e) => onLayerDown(i, e) : undefined}>
            {animate ? (
              <div style={{ width: '100%', height: '100%', animation: 'scr-layer-in 650ms cubic-bezier(0.23, 1, 0.32, 1) both', animationDelay: `${Math.min(i, 8) * 130}ms` }}>
                {body}
              </div>
            ) : body}
            {editable && i === selIdx && (
              <div
                onPointerDown={(e) => { e.stopPropagation(); onHandleDown?.(i, e) }}
                style={{ position: 'absolute', bottom: -9, right: -9, width: 18, height: 18, borderRadius: 5, background: '#22d3ee', border: '2px solid #0e7490', cursor: 'nwse-resize', touchAction: 'none', zIndex: 5 }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
