// Reusable first-run guided tour overlay. Shows once per device (localStorage
// key `rbt_tour_<storageKey>`), spotlights a target element per step and shows
// a floating card with title/body + التالي / السابق / تخطّي الكل. Steps whose
// selector is missing (or not found in the DOM) fall back to a centered card.
// No external libs. RTL-safe (physical px positioning + logical paddings).
// Re-run a tour via resetTour(storageKey) then remount/open the page.
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

const LS_PREFIX = 'rbt_tour_'

export function resetTour(storageKey) {
  try { localStorage.removeItem(LS_PREFIX + storageKey) } catch { /* storage unavailable */ }
}

function seenTour(storageKey) {
  try { return !!localStorage.getItem(LS_PREFIX + storageKey) } catch { return true }
}

function markTour(storageKey) {
  try { localStorage.setItem(LS_PREFIX + storageKey, String(Date.now())) } catch { /* storage unavailable */ }
}

const PAD = 6 // spotlight breathing room around the target (px)
const CARD_W = 330
const GAP = 12 // gap between spotlight and card

export default function Tour({ steps = [], storageKey, open, onClose }) {
  const controlled = typeof open === 'boolean'
  const [show, setShow] = useState(() => (controlled ? open : !seenTour(storageKey)))
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState(null) // DOMRect-like of the current target, null => centered
  const [visible, setVisible] = useState(false) // for the opacity fade-in
  const throttleRef = useRef(null)
  const cardRef = useRef(null)

  // Controlled mode: follow the `open` prop, restarting from step 0.
  useEffect(() => {
    if (!controlled) return
    setShow(open)
    if (open) setIdx(0)
  }, [controlled, open])

  const step = steps[idx] || null
  const total = steps.length

  const finish = useCallback(() => {
    if (storageKey) markTour(storageKey)
    setShow(false)
    if (onClose) onClose()
  }, [storageKey, onClose])

  // Measure the current step's target element.
  const measure = useCallback(() => {
    const sel = steps[idx] && steps[idx].selector
    if (!sel) { setRect(null); return }
    let el = null
    try { el = document.querySelector(sel) } catch { el = null }
    if (!el) { setRect(null); return }
    const r = el.getBoundingClientRect()
    if (!r || (r.width === 0 && r.height === 0)) { setRect(null); return }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right })
  }, [steps, idx])

  // Bring the target into view, then measure. Runs on step change while open.
  useEffect(() => {
    if (!show || !step) return
    const sel = step.selector
    if (sel) {
      let el = null
      try { el = document.querySelector(sel) } catch { el = null }
      if (el && el.scrollIntoView) {
        try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch { /* older engines */ }
      }
    }
    measure()
  }, [show, idx, step, measure])

  // Fade in after mount (opacity only — reduced-motion safe).
  useEffect(() => {
    if (!show) { setVisible(false); return }
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [show])

  // Recompute position on resize/scroll (throttled).
  useEffect(() => {
    if (!show) return
    const onMove = () => {
      if (throttleRef.current) return
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null
        measure()
      }, 80)
    }
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true) // capture: catches inner containers too
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
      if (throttleRef.current) { clearTimeout(throttleRef.current); throttleRef.current = null }
    }
  }, [show, measure])

  // Escape skips the whole tour.
  useEffect(() => {
    if (!show) return
    const onKey = (e) => { if (e.key === 'Escape') finish() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, finish])

  if (!show || total === 0 || !step) return null

  const vw = window.innerWidth
  const vh = window.innerHeight
  const cardW = Math.min(CARD_W, vw - 24)
  const cardH = (cardRef.current && cardRef.current.offsetHeight) || 190

  // Card placement: below the spotlight when it fits, otherwise above,
  // otherwise centered. Horizontal center on the target, clamped to viewport.
  let cardStyle
  if (rect) {
    const below = rect.bottom + PAD + GAP
    const top = (below + cardH <= vh - 12)
      ? below
      : Math.max(12, rect.top - PAD - GAP - cardH)
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - cardW / 2), Math.max(12, vw - cardW - 12))
    cardStyle = { position: 'fixed', top, left, width: cardW }
  } else {
    cardStyle = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: cardW }
  }

  const isLast = idx === total - 1

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={step.title}
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.2s ease',
      }}
    >
      {rect ? (
        // Spotlight: rounded ring whose huge box-shadow dims everything else.
        <div
          style={{
            position: 'fixed',
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderRadius: 'var(--r-md, 12px)',
            boxShadow: '0 0 0 2px var(--brand, #c9a227), 0 0 0 9999px rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)' }} />
      )}

      <div
        ref={cardRef}
        className="card shadow-md stack"
        style={{
          ...cardStyle,
          padding: 'var(--sp-4, 16px)',
          gap: 'var(--sp-2, 8px)',
          background: 'var(--surface, #fff)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg, 14px)',
        }}
      >
        <div className="row-between" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 'var(--fs-md, 15px)' }}>{step.title}</strong>
          <span className="xs faint" style={{ flex: 'none', direction: 'ltr' }}>{idx + 1} / {total}</span>
        </div>

        <p className="small muted" style={{ margin: 0, lineHeight: 1.7 }}>{step.body}</p>

        <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            style={{ paddingInline: 8 }}
            onClick={finish}
          >
            <Icon name="close" size={14} /> تخطّي الكل
          </button>
          <span style={{ flex: 1 }} />
          {idx > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
            >
              السابق
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => { if (isLast) finish(); else setIdx((i) => Math.min(total - 1, i + 1)) }}
          >
            {isLast ? 'إنهاء' : 'التالي'}
          </button>
        </div>
      </div>
    </div>
  )
}
