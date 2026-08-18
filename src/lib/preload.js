// Critical-image warm-up — «يجب أن تظهر كل الأشياء مع فتحة المنيو».
//
// The menu's photographs (wall, table, header, logo, the first dishes) used to
// start downloading only when their element mounted, each racing the rest —
// so the diner watched an empty room fill in piece by piece. This warms them
// the moment the tenant document lands: the browser fetches them immediately
// and in parallel, the service worker / HTTP cache keeps them, and by the time
// the layout mounts the pixels are (usually) already local.
//
// Fire-and-forget by design: a warm that fails costs nothing — the element's
// own load path still stands.

import { isLowEndDevice } from './deviceCaps.js'

const warmed = new Set()

/** Warm a list of image URLs once per session. `priority` marks the first few
    as high fetch-priority (the above-the-fold set).
    GATED off on constrained clients: on save-data or a low-end phone, six
    concurrent high-priority full-res fetches COMPETE with the images the guest
    is actually looking at (priority inversion on 3G) — there, warming nothing
    is the optimization. */
export function warmImages(urls, { priority = 4 } = {}) {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return
  try {
    if (navigator.connection?.saveData) return
    if (isLowEndDevice()) return
  } catch (_) { /* gate is best-effort */ }
  const list = (urls || []).filter((u) => typeof u === 'string' && /^https?:/.test(u) && !warmed.has(u))
  list.forEach((u, i) => {
    warmed.add(u)
    try {
      const im = new Image()
      if (i < priority) im.fetchPriority = 'high'
      im.decoding = 'async'
      im.src = u
    } catch (_) { /* warm-up only */ }
  })
}

/** The tenant's room-critical images, most visible first. Pure — safe on any
    partial tenant document. */
export function tenantCriticalImages(tenant) {
  const t = tenant || {}
  const tb = t.menuTable || {}
  return [
    (t.menuWall && t.menuWall.url) || '',
    tb.topUrl || '',
    tb.url || '',
    (t.menuHeader && t.menuHeader.url) || '',
    t.logoUrl || '',
    t.coverUrl || '',
    ...(Array.isArray(t.menuDecor) ? t.menuDecor.map((d) => d && d.url).slice(0, 4) : []),
  ].filter(Boolean)
}
