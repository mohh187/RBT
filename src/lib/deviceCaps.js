// Shared, cheap device-capability probes, used to PREVENT the OOM tab crash the
// live-menu diagnosis pinned down. A tab that runs out of memory is killed by
// the OS/WebView — no JS error boundary can observe or recover it; the only
// defence is to NOT allocate the memory on weak devices in the first place
// (fewer WebGL contexts, fewer simultaneous <video> decoders, smaller image
// decodes, no auto-rotate 3D loops).
//
// These live in one place so the whole app agrees on what "weak device" means:
// the 3D / video / image sites import the SAME helpers and scale themselves down
// together, instead of each re-deriving a different heuristic. Every probe is
// wrapped in try/catch and memoised where the answer can't change in a session.

// prefers-reduced-motion — a one-shot read of the current value. Callers that
// must react to a live change already own a matchMedia listener; this is for the
// common "decide once at mount" case.
export function prefersReduced() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  } catch (_) {
    return false
  }
}

// Can this device create a WebGL context at all? Memoised — probing is not free
// and the answer is stable for the session. Returns false on machines where a
// <model-viewer> / three.js canvas would either fail outright or drop to a
// catastrophically slow (and memory-heavy) software rasteriser. The probe
// context is released immediately so it never counts against the browser's hard
// cap on live WebGL contexts (~8-16 on mobile, and each is expensive).
let _webgl // undefined = not yet probed
export function hasWebGL() {
  if (_webgl !== undefined) return _webgl
  _webgl = false
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl') || c.getContext('webgl2')
    _webgl = !!gl
    try { gl && gl.getExtension && gl.getExtension('WEBGL_lose_context')?.loseContext() } catch (_) { /* ignore */ }
  } catch (_) {
    _webgl = false
  }
  return _webgl
}

// Weak-device heuristic. navigator.deviceMemory (GiB, coarse buckets:
// 0.25/0.5/1/2/4/8) and hardwareConcurrency are the only broadly-available
// RAM/CPU signals in a browser. Chromium/Android expose both; Safari/iOS expose
// NEITHER (undefined) — so on iOS this stays false BY DESIGN, and iOS callers
// must also guard by viewport width / content-visibility, because the iOS
// memory ceiling is tied to the WKWebView and isn't reported here. Memoised.
//   deviceMemory <= 2 GiB, OR <= 2 logical cores  => low-end.
// An unreported 0 does NOT trip the gate (that's Safari, not a weak Android).
let _lowEnd // undefined = not yet computed
export function isLowEndDevice() {
  if (_lowEnd !== undefined) return _lowEnd
  let mem = 0
  let cores = 0
  try { mem = Number(navigator.deviceMemory) || 0 } catch (_) { mem = 0 }
  try { cores = Number(navigator.hardwareConcurrency) || 0 } catch (_) { cores = 0 }
  _lowEnd = (mem > 0 && mem <= 2) || (cores > 0 && cores <= 2)
  return _lowEnd
}

// The gate most heavy-effect callers actually want: skip the expensive layer
// when the user asked for less motion OR the device looks weak. 3D sites should
// additionally require hasWebGL(). Kept separate from hasWebGL so a device that
// merely lacks WebGL still gets its (2D) images and video.
export function preferLightweight() {
  return prefersReduced() || isLowEndDevice()
}

// Rough, saturating budget for "how many heavy media layers may be live at
// once" (simultaneous autoplay <video> decoders, mounted <model-viewer>s,
// full-res image sections). Weak devices get the tightest cap. A helper so the
// menu's video/image/3D sites can size their windows off ONE number instead of
// three ad-hoc guesses. Desktop-class devices get a generous cap; the caller
// still applies its own hard ceiling.
export function heavyLayerBudget() {
  if (isLowEndDevice()) return 1
  let mem = 0
  try { mem = Number(navigator.deviceMemory) || 0 } catch (_) { mem = 0 }
  if (mem > 0 && mem <= 4) return 2
  return 3
}
