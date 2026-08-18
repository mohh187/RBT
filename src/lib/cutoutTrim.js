// Cutout anchoring — the deterministic half of "the dish SITS on the table".
//
// The editorial theme seats the IMAGE's bottom edge on the table (the photo box
// is `align-items: flex-end` + `object-position: bottom center`), so any
// transparent padding left under the dish inside the PNG floats the dish by
// exactly that padding. Background removal preserves the canvas size and strips
// the very shadow band the model drew under the vessel — which is where that
// padding comes from. The image model itself cannot be trusted to compose
// pixel-flush against an edge, so this file makes the guarantee in code:
// scan the alpha channel, find the opaque bounding box, and rebuild the canvas
// with the cutout anchored where the theme needs it.
//
// Pure canvas work — no WASM, no AI, deliberately independent of bgRemove.js so
// importing the trim never pulls the heavy background-removal module.

/**
 * Rebuild a cutout PNG around its opaque bounding box.
 *
 *   anchor 'bottom' — the seat contract (editorial): the lowest opaque pixel
 *     lands EXACTLY on the bottom edge, centred, sized so the cutout spans
 *     `widthFrac` of the width; all remaining space goes to the top.
 *   anchor 'center' — floating cutouts (storefront/spotlight): the bbox gets an
 *     even `margin` on every side inside the target aspect.
 *
 * Fail-safe by design: decode failure, an empty bbox, or an image whose four
 * corners are all opaque (i.e. NOT a cutout — background removal failed or was
 * skipped) return the input untouched.
 *
 * @param {Blob|File} input transparent PNG from background removal
 * @returns {Promise<File>} PNG file, anchored — or the input as-is
 */
export async function anchorCutout(input, { aspect = 4 / 3, anchor = 'bottom', widthFrac = 0.88, margin = 0.03, alphaMin = 40 } = {}) {
  const asFile = (blob, name) => (blob instanceof File ? blob : new File([blob], name, { type: blob.type || 'image/png' }))
  const name = (input && input.name) || `cutout-${Date.now()}.png`
  try {
    const bmp = await createImageBitmap(input)
    const w = bmp.width
    const h = bmp.height
    if (!w || !h) return asFile(input, name)
    const src = document.createElement('canvas')
    src.width = w
    src.height = h
    const sctx = src.getContext('2d')
    sctx.drawImage(bmp, 0, 0)
    if (bmp.close) bmp.close()
    const data = sctx.getImageData(0, 0, w, h).data
    const alphaAt = (x, y) => data[(y * w + x) * 4 + 3]
    // All four corners opaque -> a photo, not a cutout. Trimming would crop food.
    if (alphaAt(0, 0) >= alphaMin && alphaAt(w - 1, 0) >= alphaMin && alphaAt(0, h - 1) >= alphaMin && alphaAt(w - 1, h - 1) >= alphaMin) {
      return asFile(input, name)
    }
    let minX = w
    let maxX = -1
    let minY = h
    let maxY = -1
    for (let y = 0; y < h; y += 1) {
      const row = y * w
      for (let x = 0; x < w; x += 1) {
        if (data[(row + x) * 4 + 3] >= alphaMin) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return asFile(input, name) // fully transparent — nothing to anchor
    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    let W
    let H
    let dx
    let dy
    if (anchor === 'center') {
      const pad = Math.round(Math.max(bw, bh) * margin)
      const cw = bw + pad * 2
      const ch = bh + pad * 2
      W = Math.max(cw, Math.round(ch * aspect))
      H = Math.round(W / aspect)
      if (H < ch) { H = ch; W = Math.round(H * aspect) }
      dx = Math.round((W - bw) / 2)
      dy = Math.round((H - bh) / 2)
    } else {
      // bottom seat: width first (the user's 85-92%-of-frame rule), height from
      // the aspect; a taller-than-frame dish flips to height-led sizing, and the
      // degenerate case (wider than the aspect allows at full height) just
      // becomes the bare bbox — still bottom-flush, which is the one invariant.
      W = Math.round(bw / Math.min(0.98, Math.max(0.5, widthFrac)))
      H = Math.round(W / aspect)
      if (H < bh) {
        H = bh
        W = Math.round(H * aspect)
        if (W < bw) { W = bw; H = bh }
      }
      dx = Math.round((W - bw) / 2)
      dy = H - bh // zero pixels under the base — this line IS the fix
    }
    const out = document.createElement('canvas')
    out.width = W
    out.height = H
    out.getContext('2d').drawImage(src, minX, minY, bw, bh, dx, dy, bw, bh)
    const blob = await new Promise((resolve, reject) => {
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png')
    })
    return new File([blob], name, { type: 'image/png' })
  } catch (_) {
    return asFile(input, name)
  }
}
