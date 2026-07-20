// The GUEST-side ad renderer, mounted once inside the menu.
//
// It owns behaviour only — the look lives in AdSurface, the decision lives in
// ads.js `pickAd`. This component:
//   * watches the venue's ads,
//   * keeps a live context (seconds in session, scroll depth, exit intent),
//   * asks pickAd for the ONE ad that should show,
//   * records the impression / click / dismissal,
//   * traps focus, honours Escape and backdrop taps, and animates in and out.
//
// PRODUCT DECISIONS worth knowing (both deliberate):
//   1. At most ONE ad per page load. Once the guest dismisses it nothing else
//      appears until they reload — an ad that keeps coming back is a bug that
//      feels like a bug.
//   2. When an ad carries a reward, the CTA CLAIMS the reward and reveals the
//      code in place; it does not also navigate. Yanking someone off a code
//      they just earned is how codes get lost.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import AdSurface from './ads/AdSurface.jsx'
import { usePortalRoot } from './PortalRoot.jsx'
import { deviceKey } from '../lib/device.js'
import {
  watchAds, pickAd, markSeen, readSeen, sessionId, noteVisit,
  resolveTarget, claimAdReward, normalizeAd,
} from '../lib/ads.js'
import '../styles/ads.css'

// On a touch device there is no "pointer left toward the address bar", so an
// exit-intent ad would never fire. It falls back to this dwell time instead.
const MOBILE_EXIT_FALLBACK_SEC = 25
// Stop ticking after this long — nothing in the model triggers later than that.
const MAX_TICK_SEC = 600

// An ad must never land on top of something the guest deliberately opened. If
// any full-screen surface is up we simply wait — the session clock keeps
// ticking, so the ad fires the moment the guest is back on the menu.
// (Class list mirrors the overlays defined in index.css.)
const BUSY_SELECTOR = '.sheet, .viewer, .ar-stage, .wg-overlay, .gc-overlay, .img-zoom, .story-viewer, .pinlock'
const screenBusy = () => {
  try { return !!document.querySelector(BUSY_SELECTOR) } catch (_) { return false }
}

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
}
const finePointer = () => {
  try { return window.matchMedia('(pointer: fine)').matches } catch (_) { return false }
}

export default function AdPopup({
  tenant = null,
  tenantId = '',
  items = [],
  categories = [],
  lang = 'ar',
  ctx = null,
  onNavigate,
  onClose,
}) {
  const portalRoot = usePortalRoot()
  const [ads, setAds] = useState([])
  const [shown, setShown] = useState(null)     // the normalized ad on screen
  const [visible, setVisible] = useState(false) // drives the enter/exit transition
  const [claimed, setClaimed] = useState(null)  // reward result, once taken
  const [done, setDone] = useState(false)       // this mount has had its one ad

  const [seconds, setSeconds] = useState(0)
  const [scrollPct, setScrollPct] = useState(0)
  const [exitIntent, setExitIntent] = useState(false)

  const surfaceRef = useRef(null)
  const ctaRef = useRef(null)
  const returnFocusRef = useRef(null)
  const impressionRef = useRef('')  // ad id already counted, so StrictMode cannot double-count
  const closeTimerRef = useRef(0)

  const deviceId = useMemo(() => deviceKey(), [])
  const isMember = ctx?.isMember === true
  // The lead may pass a visit count; otherwise we count it here (once per
  // browser session per venue) so audience targeting has a real number.
  const visits = useMemo(() => {
    const given = Number(ctx?.visitCount)
    return Number.isFinite(given) && given > 0 ? Math.floor(given) : noteVisit(tenantId)
  }, [ctx?.visitCount, tenantId])

  // ---- live ads ----
  useEffect(() => {
    if (!tenantId) return undefined
    return watchAds(tenantId, setAds)
  }, [tenantId])

  // ---- session clock (only while we are still waiting for an ad) ----
  useEffect(() => {
    if (done || shown) return undefined
    let n = 0
    const id = setInterval(() => {
      n += 1
      setSeconds(n)
      if (n >= MAX_TICK_SEC) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [done, shown])

  // A popup or fullscreen ad owns the screen while it is up, so the page behind
  // it must not scroll. A banner deliberately does not lock anything — leaving
  // the menu usable is the entire point of that placement.
  useEffect(() => {
    if (!shown || shown.kind === 'banner') return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [shown])

  // ---- scroll depth ----
  useEffect(() => {
    if (done || shown) return undefined
    let frame = 0
    const read = () => {
      frame = 0
      const doc = document.documentElement
      const max = (doc.scrollHeight || 0) - (window.innerHeight || 0)
      setScrollPct(max > 0 ? Math.min(100, Math.round((window.scrollY / max) * 100)) : 0)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read) }
    window.addEventListener('scroll', onScroll, { passive: true })
    read()
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [done, shown])

  // ---- exit intent: desktop pointer leaving toward the top of the window ----
  useEffect(() => {
    if (done || shown || !finePointer()) return undefined
    const onOut = (e) => {
      if (e.relatedTarget || e.toElement) return       // moved to another element, not out
      if ((e.clientY ?? 1) > 0) return                 // left sideways or downward
      setExitIntent(true)
    }
    document.addEventListener('mouseout', onOut)
    return () => document.removeEventListener('mouseout', onOut)
  }, [done, shown])

  // ---- exit intent on touch: a dwell timer stands in for the pointer ----
  useEffect(() => {
    if (!exitIntent && !finePointer() && seconds >= MOBILE_EXIT_FALLBACK_SEC) setExitIntent(true)
  }, [seconds, exitIntent])

  // A venue-level kill switch: `tenant.adsEnabled === false` silences every ad
  // without touching a single document. Undefined means on (nothing regresses).
  const adsOff = tenant?.adsEnabled === false

  // ---- the decision ----
  useEffect(() => {
    if (adsOff || done || shown || !tenantId || !ads.length) return
    if (screenBusy()) return
    const ad = pickAd(ads, {
      now: new Date(),
      visitCount: visits,
      isMember,
      secondsInSession: seconds,
      scrollPct,
      seenMap: readSeen(tenantId),
      sessionId: sessionId(),
      exitIntent,
    })
    if (!ad) return
    returnFocusRef.current = document.activeElement
    setShown(ad)
    if (impressionRef.current !== ad.id) {
      impressionRef.current = ad.id
      markSeen(tenantId, ad.id, deviceId, 'impression')
    }
  }, [ads, adsOff, done, shown, tenantId, visits, isMember, seconds, scrollPct, exitIntent, deviceId])

  // ---- enter transition ----
  useEffect(() => {
    if (!shown) return undefined
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [shown])

  const finish = useCallback(() => {
    setVisible(false)
    const wait = reducedMotion() ? 0 : 240
    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      setShown(null)
      setClaimed(null)
      setDone(true)
      try { returnFocusRef.current?.focus?.() } catch (_) { /* element gone */ }
      onClose?.()
    }, wait)
  }, [onClose])

  useEffect(() => () => clearTimeout(closeTimerRef.current), [])

  const dismiss = useCallback(() => {
    if (shown) markSeen(tenantId, shown.id, deviceId, 'dismiss')
    finish()
  }, [shown, tenantId, deviceId, finish])

  const onCta = useCallback(() => {
    if (!shown) return
    markSeen(tenantId, shown.id, deviceId, 'click')

    // A configured reward takes over the CTA: claim it and show the code here.
    if (shown.reward.kind !== 'none') {
      const res = claimAdReward(tenantId, shown, { deviceId })
      setClaimed(res)
      if (res.ok) markSeen(tenantId, shown.id, deviceId, 'convert')
      return
    }

    const target = resolveTarget(shown, { items, categories })
    if (target?.link === 'url') {
      try { window.open(target.url, '_blank', 'noopener,noreferrer') } catch (_) { /* blocked */ }
      finish()
      return
    }
    if (target) onNavigate?.(target)
    finish()
  }, [shown, tenantId, deviceId, items, categories, onNavigate, finish])

  // ---- Escape + focus trap ----
  useEffect(() => {
    if (!shown) return undefined
    const node = surfaceRef.current
    const focusables = () => {
      if (!node) return []
      return [...node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.disabled && el.offsetParent !== null)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); dismiss(); return }
      if (e.key !== 'Tab') return
      const list = focusables()
      if (!list.length) return
      const first = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      else if (!node.contains(document.activeElement)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    const id = setTimeout(() => { (ctaRef.current || focusables()[0])?.focus?.() }, 60)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      clearTimeout(id)
    }
  }, [shown, dismiss])

  if (!shown || !portalRoot) return null

  const ad = normalizeAd(shown)
  const ar = lang !== 'en'

  return createPortal(
    <div
      className="adx-root"
      data-kind={ad.kind}
      data-shape={ad.shape}
      data-in={visible ? '1' : '0'}
    >
      <button
        type="button"
        className="adx-backdrop"
        onClick={dismiss}
        aria-label={ar ? 'إغلاق الإعلان' : 'Close ad'}
        tabIndex={-1}
      />
      <AdSurface
        ad={ad}
        lang={lang}
        onCta={onCta}
        onClose={dismiss}
        claimed={claimed}
        surfaceRef={surfaceRef}
        ctaRef={ctaRef}
      />
    </div>,
    portalRoot,
  )
}
