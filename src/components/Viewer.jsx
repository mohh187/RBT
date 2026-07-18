import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { usePortalRoot } from './PortalRoot.jsx'

// Universal fullscreen file viewer — pro replacement for the simple Lightbox
// (which stays untouched for back-compat). Handles image (pinch/wheel zoom +
// pan + double-tap), video, audio, pdf and generic files, with a top action
// bar (download / copy link / open in tab) and prev-next navigation.
//
// <Viewer open items index onClose onIndexChange />
//   items: [{ url, name?, kind? ('image'|'video'|'audio'|'file'|'pdf'), size?, contentType? }]
//
// Or, in two lines via the hook:
//   const viewer = useViewer()
//   viewer.open(items, index)  ...  <Viewer {...viewer.viewerProps} />

const EXT = {
  image: /\.(jpe?g|png|gif|webp|avif|svg|bmp|heic|ico)$/i,
  video: /\.(mp4|webm|mov|m4v|ogv|3gp)$/i,
  audio: /\.(mp3|wav|ogg|m4a|aac|opus|weba|amr|flac)$/i,
  pdf: /\.pdf$/i,
}

function urlPath(url) {
  try { return decodeURIComponent(new URL(url, window.location.origin).pathname) } catch (_) { return String(url || '') }
}

export function inferKind(it) {
  if (it?.kind) return it.kind
  const ct = String(it?.contentType || '')
  if (ct.startsWith('image/')) return 'image'
  if (ct.startsWith('video/')) return 'video'
  if (ct.startsWith('audio/')) return 'audio'
  if (ct === 'application/pdf') return 'pdf'
  const path = urlPath(it?.url)
  for (const k of ['image', 'video', 'audio', 'pdf']) {
    if (EXT[k].test(it?.name || '') || EXT[k].test(path)) return k
  }
  return 'file'
}

function fileName(it) {
  if (it?.name) return it.name
  const seg = urlPath(it?.url).split('/').filter(Boolean).pop() || ''
  return seg.length > 60 ? seg.slice(0, 57) + '...' : seg
}

// size label — MB with 1 decimal (Latin digits); KB below 0.1 MB to avoid "0.0 MB"
function fmtSize(bytes) {
  const n = Number(bytes)
  if (!n || n <= 0 || !isFinite(n)) return ''
  if (n < 102400) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

const MIN_SCALE = 0.5
const MAX_SCALE = 4

export default function Viewer({ open, items = [], index = 0, onClose, onIndexChange }) {
  const portalRoot = usePortalRoot()
  const [closing, setClosing] = useState(false)
  const [copied, setCopied] = useState(false)
  const stageRef = useRef(null)
  const imgRef = useRef(null)
  const closeTimer = useRef(null)
  const copyTimer = useRef(null)
  // gesture state lives in a ref — transforms applied directly to the node (no re-render per move)
  const g = useRef({ scale: 1, tx: 0, ty: 0, pointers: new Map(), pinchDist: 0, pinchScale: 1, panX: 0, panY: 0, lastTap: 0, moved: false })

  const count = items.length
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, count - 1))
  const it = items[safeIndex]
  const kind = it ? inferKind(it) : 'file'
  const rtl = typeof document !== 'undefined' && (document.documentElement.dir || 'rtl') !== 'ltr'

  const apply = useCallback((animate) => {
    const el = imgRef.current
    if (!el) return
    const s = g.current
    el.style.transition = animate ? 'transform 180ms ease' : 'none'
    el.style.transform = `translate3d(${s.tx}px, ${s.ty}px, 0) scale(${s.scale})`
    el.style.cursor = s.scale > 1.02 ? 'grab' : 'zoom-in'
  }, [])

  const clampPan = useCallback(() => {
    const st = stageRef.current
    const s = g.current
    if (!st) return
    const mx = Math.max(0, s.scale - 1) * st.clientWidth * 0.5 + 60
    const my = Math.max(0, s.scale - 1) * st.clientHeight * 0.5 + 60
    s.tx = Math.min(mx, Math.max(-mx, s.tx))
    s.ty = Math.min(my, Math.max(-my, s.ty))
  }, [])

  const resetZoom = useCallback((animate) => {
    Object.assign(g.current, { scale: 1, tx: 0, ty: 0, pinchDist: 0 })
    g.current.pointers.clear()
    apply(animate)
  }, [apply])

  // zoom keeping the point under (cx, cy) fixed
  const zoomAt = useCallback((cx, cy, nextScale, animate) => {
    const st = stageRef.current
    const s = g.current
    const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
    if (st) {
      const r = st.getBoundingClientRect()
      const ox = cx - (r.left + r.width / 2)
      const oy = cy - (r.top + r.height / 2)
      const k = ns / s.scale
      s.tx = ox - k * (ox - s.tx)
      s.ty = oy - k * (oy - s.ty)
    }
    s.scale = ns
    clampPan()
    apply(animate)
  }, [apply, clampPan])

  const toggleZoom = useCallback((cx, cy) => {
    if (g.current.scale > 1.05) resetZoom(true)
    else zoomAt(cx, cy, 2.5, true)
  }, [resetZoom, zoomAt])

  const requestClose = useCallback(() => {
    if (closing) return
    setClosing(true)
    closeTimer.current = setTimeout(() => {
      setClosing(false)
      onClose && onClose()
    }, 150)
  }, [closing, onClose])

  const go = useCallback((delta) => {
    const n = Math.min(count - 1, Math.max(0, safeIndex + delta))
    if (n !== safeIndex && onIndexChange) onIndexChange(n)
  }, [count, safeIndex, onIndexChange])

  // keyboard: Escape closes, arrows navigate (direction-aware)
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); requestClose() }
      else if (e.key === 'ArrowLeft') go(rtl ? 1 : -1)
      else if (e.key === 'ArrowRight') go(rtl ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, requestClose, go, rtl])

  // body scroll lock while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // reset per item / per open
  useEffect(() => {
    if (!open) return
    setCopied(false)
    resetZoom(false)
  }, [open, safeIndex, resetZoom])

  // wheel zoom — must be a non-passive native listener to preventDefault
  useEffect(() => {
    const st = stageRef.current
    if (!open || !st) return
    const onWheel = (e) => {
      e.preventDefault()
      zoomAt(e.clientX, e.clientY, g.current.scale * Math.exp(-e.deltaY * 0.0018), false)
    }
    st.addEventListener('wheel', onWheel, { passive: false })
    return () => st.removeEventListener('wheel', onWheel)
  }, [open, safeIndex, kind, zoomAt])

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  if (!open || !it) return null

  const name = fileName(it)
  const size = fmtSize(it.size)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(it.url)
      setCopied(true)
      copyTimer.current = setTimeout(() => setCopied(false), 1600)
    } catch (_) { /* clipboard unavailable */ }
  }

  // ---- image gestures (pointer events: pan + pinch + touch double-tap) ----
  const onPointerDown = (e) => {
    const s = g.current
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId)
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    s.moved = false
    if (s.pointers.size === 2) {
      const [a, b] = [...s.pointers.values()]
      s.pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      s.pinchScale = s.scale
    } else if (s.pointers.size === 1) {
      s.panX = e.clientX - s.tx
      s.panY = e.clientY - s.ty
      if (e.pointerType === 'touch') {
        const now = Date.now()
        if (now - s.lastTap < 300) { toggleZoom(e.clientX, e.clientY); s.lastTap = 0 } else { s.lastTap = now }
      }
    }
  }
  const onPointerMove = (e) => {
    const s = g.current
    if (!s.pointers.has(e.pointerId)) return
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (s.pointers.size === 2 && s.pinchDist > 0) {
      const [a, b] = [...s.pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      s.moved = true
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, s.pinchScale * (d / s.pinchDist), false)
    } else if (s.pointers.size === 1 && s.scale > 1) {
      const dx = e.clientX - s.panX - s.tx
      const dy = e.clientY - s.panY - s.ty
      if (Math.abs(dx) + Math.abs(dy) > 2) s.moved = true
      s.tx = e.clientX - s.panX
      s.ty = e.clientY - s.panY
      clampPan()
      apply(false)
    }
  }
  const onPointerUp = (e) => {
    const s = g.current
    s.pointers.delete(e.pointerId)
    if (s.pointers.size < 2) s.pinchDist = 0
    if (s.pointers.size === 1) {
      const [p] = [...s.pointers.values()]
      s.panX = p.x - s.tx
      s.panY = p.y - s.ty
    }
  }
  const onStageClick = (e) => {
    if (e.target === e.currentTarget && !g.current.moved) requestClose()
  }
  const backdropClick = (e) => {
    if (e.target === e.currentTarget) requestClose()
  }

  const body = kind === 'image' ? (
    <div
      className="viewer-stage"
      ref={stageRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onStageClick}
    >
      <img
        ref={imgRef}
        src={it.url}
        alt={name}
        draggable={false}
        onDoubleClick={(e) => toggleZoom(e.clientX, e.clientY)}
      />
    </div>
  ) : kind === 'video' ? (
    <video key={it.url} className="viewer-media" src={it.url} controls autoPlay muted playsInline />
  ) : kind === 'audio' ? (
    <div className="viewer-filecard">
      <span className="viewer-file-badge"><Icon name="sound" size={30} /></span>
      <div className="viewer-file-name">{name || 'ملف صوتي'}</div>
      {size ? <div className="viewer-file-size">{size}</div> : null}
      <audio key={it.url} src={it.url} controls style={{ width: '100%' }} />
    </div>
  ) : kind === 'pdf' ? (
    <iframe className="viewer-frame" src={it.url} title={name || 'pdf'} />
  ) : (
    <div className="viewer-filecard">
      <span className="viewer-file-badge"><Icon name="file" size={30} /></span>
      <div className="viewer-file-name">{name || 'ملف'}</div>
      {size ? <div className="viewer-file-size">{size}</div> : null}
      <a className="viewer-file-dl" href={it.url} download={name || true} target="_blank" rel="noreferrer">
        <Icon name="download" size={16} /> تحميل
      </a>
    </div>
  )

  return createPortal(
    <div
      className={`viewer${closing ? ' closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={name || 'عارض الملفات'}
      onClick={backdropClick}
    >
      <div className="viewer-top">
        <div className="viewer-meta">
          <div className="viewer-name" title={name}>{name || ' '}</div>
          {size ? <div className="viewer-size">{size}</div> : null}
        </div>
        <div className="viewer-actions">
          <a className="viewer-btn" href={it.url} download={name || true} title="تحميل" aria-label="تحميل">
            <Icon name="download" size={18} />
          </a>
          <button type="button" className="viewer-btn" onClick={copyLink} title="نسخ الرابط" aria-label="نسخ الرابط">
            <Icon name={copied ? 'check' : 'copy'} size={18} />
          </button>
          <a className="viewer-btn" href={it.url} target="_blank" rel="noreferrer" title="فتح في تبويب" aria-label="فتح في تبويب">
            <Icon name="share" size={18} />
          </a>
          <button type="button" className="viewer-btn" onClick={requestClose} title="إغلاق" aria-label="إغلاق">
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>

      <div className="viewer-body" onClick={kind === 'image' ? undefined : backdropClick}>{body}</div>

      {count > 1 ? (
        <>
          <button
            type="button"
            className="viewer-nav viewer-nav-left"
            aria-label={rtl ? 'التالي' : 'السابق'}
            disabled={rtl ? safeIndex >= count - 1 : safeIndex <= 0}
            onClick={() => go(rtl ? 1 : -1)}
          >
            <Icon name="back" size={22} />
          </button>
          <button
            type="button"
            className="viewer-nav viewer-nav-right"
            aria-label={rtl ? 'السابق' : 'التالي'}
            disabled={rtl ? safeIndex <= 0 : safeIndex >= count - 1}
            onClick={() => go(rtl ? -1 : 1)}
          >
            <Icon name="next" size={22} />
          </button>
          <div className="viewer-counter">{safeIndex + 1} / {count}</div>
        </>
      ) : null}
    </div>,
    portalRoot,
  )
}

// Two-line integration:
//   const viewer = useViewer()
//   <img onClick={() => viewer.open([{ url }])} /> ... <Viewer {...viewer.viewerProps} />
export function useViewer() {
  const [state, setState] = useState({ open: false, items: [], index: 0 })
  const open = useCallback((items, index = 0) => {
    const list = (Array.isArray(items) ? items : [items])
      .filter(Boolean)
      .map((x) => (typeof x === 'string' ? { url: x } : x))
    if (!list.length) return
    setState({ open: true, items: list, index: Math.min(Math.max(0, index), list.length - 1) })
  }, [])
  const onClose = useCallback(() => setState((s) => ({ ...s, open: false })), [])
  const onIndexChange = useCallback((index) => setState((s) => ({ ...s, index })), [])
  return { open, viewerProps: { open: state.open, items: state.items, index: state.index, onClose, onIndexChange } }
}
