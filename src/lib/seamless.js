// seamless.js — make any photograph tile without visible seams.
//
// WHY: the menu wall accepts the venue's own photo and REPEATS it at any scale
// other than 1.00x. A photo's edges never match themselves, so every repeat
// drew a hard cut line across the room — the «خطوط وفواصل» the owner reported.
// This turns the photo into a true tile by cross-fading each edge into the
// opposite one: the right edge ends exactly where the left edge begins, so the
// repeat is mathematically continuous. The cost is a soft double-exposure
// inside the feather band, which on brick/stone/wood texture reads as natural
// variation.
//
// Pure canvas, no dependencies, runs in the browser at upload time. The output
// is a WebP blob ready for the existing upload path.

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0))

async function toBitmap(src) {
  // fetch()->blob->createImageBitmap keeps the canvas untainted for same-origin
  // and CORS-enabled hosts (Firebase Storage sends ACAO:*)
  if (typeof src === 'string') {
    const res = await fetch(src)
    if (!res.ok) throw new Error(`fetch ${res.status}`)
    src = await res.blob()
  }
  return createImageBitmap(src)
}

// One strip of the source, alpha-ramped from 0 at its inner side to 1 at the
// outer edge, painted over the destination edge. `axis` is 'x' or 'y'.
function blendEdge(ctx, canvas, axis, band) {
  const { width: w, height: h } = canvas
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  const tc = tmp.getContext('2d')
  if (axis === 'x') {
    // the LEFT band of the image, placed over the RIGHT edge
    tc.drawImage(canvas, 0, 0, band, h, w - band, 0, band, h)
    const g = tc.createLinearGradient(w - band, 0, w, 0)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,1)')
    tc.globalCompositeOperation = 'destination-in'
    tc.fillStyle = g
    tc.fillRect(w - band, 0, band, h)
  } else {
    // the TOP band of the image, placed over the BOTTOM edge
    tc.drawImage(canvas, 0, 0, w, band, 0, h - band, w, band)
    const g = tc.createLinearGradient(0, h - band, 0, h)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,1)')
    tc.globalCompositeOperation = 'destination-in'
    tc.fillStyle = g
    tc.fillRect(0, h - band, w, band)
  }
  ctx.drawImage(tmp, 0, 0)
}

/**
 * makeSeamless(source, { feather, max, quality }) -> WebP Blob
 *
 * source  : Blob/File or a URL string (must be CORS-readable)
 * feather : share of each dimension used for the cross-fade band (0.04–0.3)
 * max     : longest output side, px — walls never need more than ~1600
 */
export async function makeSeamless(source, { feather = 0.12, max = 1600, quality = 0.88 } = {}) {
  const bmp = await toBitmap(source)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const w = Math.max(64, Math.round(bmp.width * k))
  const h = Math.max(64, Math.round(bmp.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bmp, 0, 0, w, h)
  const f = Math.min(0.3, Math.max(0.04, clamp01(feather)))
  // horizontal continuity first, then vertical ON THE RESULT — the second pass
  // wraps the already-continuous rows, so the corner closes on itself too
  blendEdge(ctx, canvas, 'x', Math.round(w * f))
  blendEdge(ctx, canvas, 'y', Math.round(h * f))
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/webp', quality)
  })
  try { bmp.close() } catch (_) { /* bitmap close is best-effort */ }
  return blob
}
