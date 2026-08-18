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

  // THE SIGNAL IOS NEVER SENDS.
  //
  // navigator.deviceMemory is Chromium-only — Safari has never implemented it,
  // so `mem` is 0 on every iPhone and iPad, and the `mem <= 2` test can never
  // fire there. Modern iPhones also report 6 cores, so the core test misses
  // too. The result was that this function returned FALSE for the exact devices
  // it exists to protect: a guest on an iPhone got the full heavy-media path,
  // WKWebView hit its per-tab memory ceiling, and the tab was killed and
  // reloaded mid-browse — reported as "the screen closes and loads again".
  //
  // Absence of the API is itself information. A touch device that reports no
  // memory at all is treated as constrained: on iOS that is correct, and on the
  // rare Android without the API the cost is a slightly lighter menu, which is
  // the safe direction to be wrong in.
  let touchNoMem = false
  try {
    touchNoMem = mem === 0
      && typeof matchMedia === 'function'
      && matchMedia('(pointer: coarse)').matches
  } catch (_) { touchNoMem = false }

  _lowEnd = (mem > 0 && mem <= 2) || (cores > 0 && cores <= 2) || touchNoMem
  return _lowEnd
}

// 3D IN THE GUEST MENU IS OFF.
//
// Turned off at the owner's instruction after guests' phones were killing and
// reloading the tab mid-browse. The cost of the feature is not the model — it is
// ~1.1 MB of JavaScript (@google/model-viewer 444 kB + three 725 kB) plus a live
// WebGL context and the GPU memory for textures and meshes, on a page that is
// already holding fifty-odd full-bleed dish photographs. On a phone that is the
// difference between a menu that scrolls and a tab that dies.
//
// This gates the GUEST menu only. The admin side (ModelStudio, Settings, the
// item editor) still previews models, because that happens on a desktop, on
// purpose, one model at a time.
//
// Flip to true to restore it; every guest-facing 3D entry point reads this one
// constant, so there is a single switch and no half-enabled state.
export const MENU_3D_ENABLED = false

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
