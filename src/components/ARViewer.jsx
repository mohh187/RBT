import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { Spinner } from './ui.jsx'
import { loadModelViewer } from '../lib/ar3d.js'

/**
 * ARViewer — the single, safe, on-demand 3D/AR viewer a guest opens.
 *
 * WHY THIS EXISTS: the owner's one hard rule is that the menu must NEVER crash a
 * weak phone. A <model-viewer> spins up a WebGL context + decodes a whole GLTF
 * (meshes + textures) into GPU memory; on a 1GB Android or an old iPhone that is
 * exactly the kind of thing that OOM-kills the tab (a crash NO JS boundary can
 * catch — it has to be PREVENTED). So this component:
 *
 *   1) NEVER mounts a viewer until it has checked WebGL is present AND the device
 *      is not bottom-tier. If it can't, it shows a calm bilingual card instead —
 *      the 3D simply declines, the menu lives on.
 *   2) Shows an honest LOADING state while the (heavy, lazy) element + the model
 *      fetch/decode, and a clear ERROR state if either fails.
 *   3) Tears the viewer fully down on unmount (clears src ⇒ the GLTF unloads and
 *      the renderer is released) so opening/closing dishes over and over can
 *      never accumulate 3D memory. Exactly one viewer is meant to be live.
 *
 * The host owns only the surrounding chrome (title, close, hint) and the box
 * size — this fills its parent 100%×100%.
 */

// --- Device capability guard -------------------------------------------------
// TODO(deviceCaps): the crash agent is landing src/lib/deviceCaps.js with shared
// hasWebGL()/isLowEndDevice(). Switch these to import from there once it exists.
// Kept LOCAL on purpose so the very check meant to prevent a crash can never
// itself depend on an un-shipped module (which would throw at import time).
function probeWebGL() {
  try {
    if (typeof window === 'undefined' || !window.WebGLRenderingContext) return false
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl')
    if (!gl) return false
    // Release the probe context at once — never hold a live WebGL context just to
    // answer "is WebGL available?" (contexts are hard-capped on mobile).
    try { gl.getExtension('WEBGL_lose_context')?.loseContext() } catch (_) { /* best-effort */ }
    return true
  } catch (_) {
    return false
  }
}

function isLowEndDevice() {
  try {
    const mem = navigator.deviceMemory // Chromium only; undefined on Safari/iOS
    if (typeof mem === 'number' && mem > 0 && mem <= 1) return true // <=1GB RAM ⇒ decline 3D
    const cores = navigator.hardwareConcurrency
    if (typeof cores === 'number' && cores > 0 && cores <= 2) return true // dual-core ⇒ ancient phone
    return false
  } catch (_) {
    return false
  }
}

// True only when the device both HAS WebGL and is not a bottom-tier phone.
// Exported so surfaces that would mount several viewers (the 3D world) can
// decline up-front instead of spawning contexts that OOM a weak tab.
export function can3D() {
  return probeWebGL() && !isLowEndDevice()
}

function usePrefersReduced() {
  const [reduced, setReduced] = useState(() => {
    try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
  })
  useEffect(() => {
    let mq
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)') } catch (_) { return undefined }
    if (!mq) return undefined
    const on = () => setReduced(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return reduced
}

// One live <model-viewer> at a time is the contract. This counter makes an
// accidental double-mount loud in dev; the hard guarantee is the teardown below.
let LIVE_VIEWERS = 0

const WRAP = { position: 'relative', width: '100%', height: '100%', display: 'grid', placeItems: 'center', overflow: 'hidden' }
const OVERLAY = { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'inherit', pointerEvents: 'none', textAlign: 'center', padding: 16 }
const CARD = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', color: 'inherit', padding: 24, width: '100%', height: '100%', minHeight: 180 }
const CARD_ICON = { display: 'grid', placeItems: 'center', width: 56, height: 56, borderRadius: '50%', background: 'color-mix(in srgb, currentColor 12%, transparent)' }
const MV_STYLE = { width: '100%', height: '100%', background: 'transparent' }

function Card({ icon, title, note }) {
  return (
    <div style={CARD} role="status">
      <span style={CARD_ICON} aria-hidden="true"><Icon name={icon} size={28} /></span>
      <strong style={{ fontSize: 15, fontWeight: 800 }}>{title}</strong>
      {note ? <p style={{ margin: 0, maxWidth: '32ch', fontSize: 13, lineHeight: 1.7, opacity: 0.7 }}>{note}</p> : null}
    </div>
  )
}

/**
 * @param {string}   glb          .glb/.gltf source (Android Scene Viewer + inline)
 * @param {string}   usdz         .usdz source (iOS Quick Look)
 * @param {string}   alt          accessible label for the model
 * @param {string}   lang         'ar' | 'en'
 * @param {(status:string)=>void} onArStatus   forwards model-viewer 'ar-status'
 * @param {(phase:string)=>void}  onPhaseChange 'loading' | 'ready' | 'unsupported' | 'error'
 */
// ---- what the generator gets wrong, corrected at render time ----
//
// 1. THE CHROME. Meshy is asked for PBR (`enable_pbr: true`), so it estimates a
//    metallic-roughness map from a single photograph. On a glossy white cup that
//    estimator regularly guesses METAL, and the model renders as polished
//    nickel — a silver teacup on a café menu.
//    Forcing metalness to 0 is not a workaround, it is the physically correct
//    value for the subject: ceramic, glass, liquid, bread, sauce and paper are
//    all dielectric. Nothing a café sells is a metal. Roughness and normal maps
//    are left untouched, so the real surface detail the photo captured survives
//    — only the false mirror goes.
function demetalize(el) {
  const materials = (el && el.model && el.model.materials) || []
  materials.forEach((m) => {
    try { m.pbrMetallicRoughness.setMetallicFactor(0) } catch (_) { /* older build, skip */ }
  })
}

// 2. THE SIZE. A reconstruction comes back at an arbitrary scale, so a cortado
//    and a sharing platter both arrive "one unit tall" and both fill the frame.
//    The guest cannot tell what they are ordering — which is the entire reason
//    to show a model. Scaling to a real height in metres makes the viewer
//    honest, and makes AR placement land at the true size on the table.
const DEFAULT_HEIGHT_CM = 11 // a standard cup with its saucer
function fitRealScale(el, heightCm) {
  const target = (Number(heightCm) || DEFAULT_HEIGHT_CM) / 100 // metres
  try {
    const d = el.getDimensions()
    if (!d || !(d.y > 0)) return
    const k = target / d.y
    if (!Number.isFinite(k) || k <= 0) return
    el.scale = `${k} ${k} ${k}`
  } catch (_) { /* getDimensions is unavailable until the model is parsed */ }
}

export default function ARViewer({ glb, usdz, alt = '', lang = 'ar', heightCm, onArStatus, onPhaseChange }) {
  const ar = lang === 'ar'
  const reduced = usePrefersReduced()

  // Capability is decided ONCE, synchronously, before any WebGL is touched — and
  // a missing source is treated as unsupported so we never mount an empty viewer.
  const supportedRef = useRef(null)
  if (supportedRef.current === null) supportedRef.current = can3D() && !!(glb || usdz)

  // phase: 'unsupported' | 'lib' (element importing) | 'view' (mounted) | 'error'
  const [phase, setPhase] = useState(supportedRef.current ? 'lib' : 'unsupported')
  const [modelLoaded, setModelLoaded] = useState(false)
  const elRef = useRef(null)

  // Publish a coarse phase up so the host can hide/adjust its own chrome (hints).
  useEffect(() => {
    const pub = phase === 'view'
      ? (modelLoaded ? 'ready' : 'loading')
      : (phase === 'lib' ? 'loading' : phase)
    onPhaseChange?.(pub)
  }, [phase, modelLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load the custom element (heavy, lazy) only when the device can actually show it.
  useEffect(() => {
    if (!supportedRef.current) return undefined
    let alive = true
    loadModelViewer()
      .then(() => { if (alive) setPhase('view') })
      .catch(() => { if (alive) setPhase('error') })
    return () => { alive = false }
  }, [])

  // Memory safety: on unmount, unload the model so its GPU textures/meshes are
  // freed. Without this, repeatedly opening dishes leaks 3D memory ⇒ OOM crash.
  useEffect(() => {
    LIVE_VIEWERS += 1
    if (LIVE_VIEWERS > 1 && import.meta.env && import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[ARViewer] more than one 3D viewer is live — expected exactly one')
    }
    return () => {
      LIVE_VIEWERS -= 1
      const el = elRef.current
      if (!el) return
      try {
        el.removeAttribute('src')
        el.removeAttribute('ios-src')
        // model-viewer exposes no public dispose(); clearing src unloads the GLTF,
        // and React removing the node fires its disconnectedCallback (renderer release).
        try { el.src = null } catch (_) { /* setter may reject null — attr removal already unloaded */ }
      } catch (_) { /* best-effort */ }
    }
  }, [])

  const bind = (el) => {
    elRef.current = el
    if (!el || el._rbtArvBound) return
    el._rbtArvBound = true
    el.addEventListener('load', () => {
      setModelLoaded(true)
      // Both corrections need the parsed model, so they belong here and not on
      // the element's attributes.
      demetalize(el)
      fitRealScale(el, heightCm)
    })
    el.addEventListener('error', () => setPhase('error'))
    if (onArStatus) el.addEventListener('ar-status', (e) => onArStatus(e && e.detail ? e.detail.status : ''))
  }

  if (phase === 'unsupported') {
    return (
      <Card
        icon="shapes"
        title={ar ? 'جهازك لا يدعم العرض ثلاثي الأبعاد' : "Your device can't show 3D"}
        note={ar ? 'يمكنك تصفّح صور الصنف كالمعتاد.' : 'You can browse the item photos as usual.'}
      />
    )
  }
  if (phase === 'error') {
    return (
      <Card
        icon="warning"
        title={ar ? 'تعذّر تحميل المجسّم' : "Couldn't load the model"}
        note={ar ? 'تحقّق من اتصالك بالإنترنت وحاول مرة أخرى.' : 'Check your connection and try again.'}
      />
    )
  }

  const showLoading = phase === 'lib' || (phase === 'view' && !modelLoaded)
  return (
    <div style={WRAP}>
      {/* ar-scale is FIXED, not auto: the model is scaled to its true height on
          load, and «auto» would let Scene Viewer resize it again — at which point
          the size stops meaning anything to the guest. */}
      {phase === 'view' && (
        <model-viewer
          ref={bind}
          src={glb || undefined}
          ios-src={usdz || undefined}
          alt={alt}
          ar=""
          ar-modes="scene-viewer webxr quick-look"
          ar-scale="fixed"
          camera-controls=""
          touch-action="pan-y"
          exposure="1"
          shadow-intensity="1"
          interaction-prompt="none"
          loading="eager"
          reveal="auto"
          {...(reduced ? {} : { 'auto-rotate': '', 'rotation-per-second': '20deg' })}
          style={MV_STYLE}
        />
      )}
      {showLoading && (
        <div style={OVERLAY} role="status">
          <Spinner />
          <span style={{ fontSize: 13.5, opacity: 0.85 }}>
            {ar ? 'جارٍ تحميل المجسّم… قد يستغرق لحظات' : 'Loading the model… this may take a moment'}
          </span>
        </div>
      )}
    </div>
  )
}
