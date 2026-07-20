// Free-form print studio — native PNG rasterizer. We OWN the document model, so
// the export draws it directly onto a real <canvas> at `scale`x: images via
// drawImage (crossOrigin anonymous — bucket CORS is configured), text via
// fillText after document.fonts has actually loaded the family, shapes via
// SVG-blob → drawImage (the SAME svg string the DOM renders, so colours match
// exactly), QR from its dataURL. Any element that fails to rasterize is SKIPPED
// and reported by name — the caller toasts the list honestly rather than
// silently shipping a hole in the page.
//
// FIDELITY CONTRACT: every constant here mirrors a rule in printstudio.css.
// Item cards, text wrapping/clipping and borders are drawn from the same
// numbers the DOM uses, so the PNG matches the editor and the print output.
import { fontStacks } from '../../lib/skins.js'
import { shapeById, renderShapeSvg } from '../../lib/printShapes.js'

// Official Saudi Riyal symbol paths (same geometry as components/Riyal.jsx).
const RIYAL_VB = { w: 1124.14, h: 1256.39 }
const RIYAL_PATHS = [
  'M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z',
  'M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z',
]

const TYPE_AR = { text: 'نص', image: 'صورة', shape: 'شكل', qr: 'رمز QR', itemcard: 'بطاقة صنف' }

// --- item-card metrics, mirroring .ps-itemcard in printstudio.css (page units)
const IC = { pad: 8, gap: 8, radius: 12, imgRadius: 8, name: 15, desc: 12, price: 14, lh: 1.35, rowGap: 3 }

function loadImg(src, cross = true) {
  return new Promise((res, rej) => {
    const img = new Image()
    if (cross && !src.startsWith('data:') && !src.startsWith('blob:')) img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('image load failed'))
    img.src = src
  })
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)))
  else ctx.rect(x, y, w, h)
}

// object-fit cover/contain source-rect math
function fitRect(iw, ih, w, h, mode) {
  if (mode === 'contain') {
    const s = Math.min(w / iw, h / ih)
    const dw = iw * s, dh = ih * s
    return { sx: 0, sy: 0, sw: iw, sh: ih, dx: (w - dw) / 2, dy: (h - dh) / 2, dw, dh }
  }
  const s = Math.max(w / iw, h / ih)
  const sw = w / s, sh = h / s
  return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh, dx: 0, dy: 0, dw: w, dh: h }
}

function wrapLines(ctx, text, maxW) {
  const out = []
  for (const raw of String(text || '').split('\n')) {
    if (!raw) { out.push(''); continue }
    const words = raw.split(' ')
    let line = ''
    for (const word of words) {
      const probe = line ? `${line} ${word}` : word
      if (ctx.measureText(probe).width <= maxW || !line) line = probe
      else { out.push(line); line = word }
    }
    out.push(line)
  }
  return out
}

// single-line ellipsis, matching the DOM's text-overflow on card names
function ellipsize(ctx, text, maxW) {
  const s = String(text || '')
  if (!s || ctx.measureText(s).width <= maxW) return s
  let lo = 0, hi = s.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(`${s.slice(0, mid)}…`).width <= maxW) lo = mid
    else hi = mid - 1
  }
  return `${s.slice(0, lo)}…`
}

function drawRiyal(ctx, x, y, size, color) {
  const s = size / RIYAL_VB.h
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.fillStyle = color
  for (const d of RIYAL_PATHS) ctx.fill(new Path2D(d))
  ctx.restore()
}

function priceOf(it) {
  if (!it) return 0
  const base = Number(it.price) || 0
  if (base > 0) return base
  const vs = (it.variants || []).map((v) => Number(v.price) || 0).filter((v) => v > 0)
  return vs.length ? Math.min(...vs) : 0
}

async function svgToImage(svgMarkup, w, h) {
  const withSize = svgMarkup.replace(/<svg /, `<svg width="${Math.ceil(w)}" height="${Math.ceil(h)}" `)
  const blob = new Blob([withSize], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try { return await loadImg(url, false) } finally { setTimeout(() => URL.revokeObjectURL(url), 2000) }
}

function setTextStyle(ctx, el, k) {
  const fonts = fontStacks(el.fontKey || 'tajawal')
  ctx.font = `${el.weight || 400} ${(el.size || 18) * k}px ${fonts.display}`
  ctx.direction = el.dir || 'rtl'
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(el.letterSpacing || 0) * k}px`
  // canvas "left"/"right" are physical, like CSS text-align on a dir'd box
  ctx.textAlign = el.align === 'center' ? 'center' : el.align === 'left' ? 'left' : 'right'
  ctx.textBaseline = 'middle'
}

// Mirrors .ps-text: wrapped, top-aligned, CLIPPED to the element box.
function drawTextBox(ctx, el, k) {
  const w = el.w * k, h = el.h * k
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, w, h)
  ctx.clip()
  setTextStyle(ctx, el, k)
  ctx.fillStyle = el.color || '#1c1c1e'
  const lineH = (el.size || 18) * (el.lineHeight || 1.4) * k
  const lines = wrapLines(ctx, el.text, w)
  const tx = el.align === 'center' ? w / 2 : el.align === 'left' ? 0 : w
  lines.forEach((line, i) => ctx.fillText(line, tx, i * lineH + lineH / 2))
  ctx.restore()
}

// Mirrors .ps-itemcard / .ps-ic-h / .ps-ic-v.
async function drawItemCard(ctx, el, k, it, currency, skipped) {
  const w = el.w * k, h = el.h * k
  const ink = el.ink || '#1c1c1e'
  const accent = el.accent || '#1c1c1e'
  const pad = IC.pad * k
  const vertical = (el.layout || 'h') === 'v'
  const fam = fontStacks('tajawal').display

  ctx.save()
  roundRectPath(ctx, 0, 0, w, h, IC.radius * k)
  ctx.fillStyle = el.bg || '#ffffff'
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.08)'
  ctx.lineWidth = 1 * k
  ctx.stroke()
  ctx.clip()

  const hasDesc = !!(el.showDesc && (it?.descAr || it?.descEn))
  const hasPrice = el.showPrice !== false && !!it
  // text column height, from the same font sizes the DOM uses
  const rows = [IC.name, ...(hasDesc ? [IC.desc] : []), ...(hasPrice ? [IC.price] : [])]
  const textH = (rows.reduce((a, b) => a + b * IC.lh, 0) + IC.rowGap * (rows.length - 1)) * k

  let colX0 = pad, colX1 = w - pad, colTop = pad, colBottom = h - pad

  if (it?.imageUrl) {
    try {
      const img = await loadImg(it.imageUrl)
      if (vertical) {
        // .ps-ic-v .ps-ic-img { flex: 1 } — image takes whatever the text leaves
        const ih = Math.max(0, h - pad * 2 - textH - IC.gap * k)
        if (ih > 4) {
          ctx.save()
          roundRectPath(ctx, pad, pad, w - pad * 2, ih, IC.imgRadius * k)
          ctx.clip()
          const f = fitRect(img.naturalWidth, img.naturalHeight, w - pad * 2, ih, 'cover')
          ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, pad + f.dx, pad + f.dy, f.dw, f.dh)
          ctx.restore()
          colTop = pad + ih + IC.gap * k
        }
      } else {
        // .ps-ic-h .ps-ic-img { width: 40% } — RTL row, so the image sits RIGHT
        const iw = (w - pad * 2) * 0.4
        const ih = h - pad * 2
        ctx.save()
        roundRectPath(ctx, w - pad - iw, pad, iw, ih, IC.imgRadius * k)
        ctx.clip()
        const f = fitRect(img.naturalWidth, img.naturalHeight, iw, ih, 'cover')
        ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, w - pad - iw + f.dx, pad + f.dy, f.dw, f.dh)
        ctx.restore()
        colX1 = w - pad - iw - IC.gap * k
      }
    } catch (_) { skipped.push(`صورة الصنف (${it.nameAr || it.nameEn || ''})`) }
  }

  const colW = Math.max(1, colX1 - colX0)
  ctx.direction = 'rtl'
  ctx.textBaseline = 'middle'
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  const cx = vertical ? colX0 + colW / 2 : colX1
  ctx.textAlign = vertical ? 'center' : 'right'

  let y = colTop
  ctx.fillStyle = ink
  ctx.font = `800 ${IC.name * k}px ${fam}`
  const name = it ? (it.nameAr || it.nameEn || '') : 'صنف غير موجود'
  ctx.fillText(ellipsize(ctx, name, colW), cx, y + (IC.name * IC.lh * k) / 2)
  y += IC.name * IC.lh * k + IC.rowGap * k

  if (hasDesc) {
    ctx.font = `400 ${IC.desc * k}px ${fam}`
    ctx.globalAlpha *= 0.68 // .ps-ic-desc { opacity: .68 }
    ctx.fillText(ellipsize(ctx, it.descAr || it.descEn || '', colW), cx, y + (IC.desc * IC.lh * k) / 2)
    ctx.globalAlpha /= 0.68
    y += IC.desc * IC.lh * k + IC.rowGap * k
  }

  if (hasPrice) {
    // .ps-ic-price { margin-top: auto } — pinned to the bottom of the column
    const py = Math.max(y, colBottom - IC.price * IC.lh * k) + (IC.price * IC.lh * k) / 2
    ctx.font = `800 ${IC.price * k}px ${fam}`
    ctx.fillStyle = accent
    const num = String(priceOf(it))
    if (currency && currency !== 'SAR') {
      ctx.fillText(`${currency} ${num}`, cx, py)
    } else {
      // <Price lang="ar"> renders dir=ltr with the riyal glyph LEFT of the number
      ctx.textAlign = 'left'
      const numW = ctx.measureText(num).width
      const symS = IC.price * 0.92 * k
      const total = numW + symS + 4 * k
      const startX = vertical ? colX0 + (colW - total) / 2 : colX1 - total
      drawRiyal(ctx, startX, py - symS / 2, symS, accent)
      ctx.fillText(num, startX + symS + 4 * k, py)
    }
  }
  ctx.restore()
}

// Preload every family/weight the design actually uses, so fillText is faithful
// instead of silently falling back to a system face.
async function preloadFonts(design, k) {
  const jobs = []
  const want = new Set()
  for (const el of design.elements || []) {
    if (el.hidden) continue
    if (el.type === 'text') {
      const fam = fontStacks(el.fontKey || 'tajawal').display
      want.add(`${el.weight || 400} ${Math.round((el.size || 18) * k)}px ${fam}`)
      want.add(`400 ${Math.round((el.size || 18) * k)}px ${fam}`)
    } else if (el.type === 'itemcard') {
      const fam = fontStacks('tajawal').display
      for (const [wt, sz] of [[800, IC.name], [400, IC.desc], [800, IC.price]]) {
        want.add(`${wt} ${Math.round(sz * k)}px ${fam}`)
      }
    }
  }
  for (const spec of want) jobs.push(document.fonts.load(spec).catch(() => {}))
  await Promise.all(jobs)
  try { await document.fonts.ready } catch (_) { /* older browsers */ }
}

// Renders the design onto a canvas at `scale`x and returns { blob, skipped }.
// skipped = Arabic labels of elements that could not be rasterized (told honestly).
export async function exportDesignPng({ design, items = [], currency = 'SAR', qrSrc = '', scale = 2 }) {
  const k = scale
  const page = design.page
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(page.w * k)
  canvas.height = Math.round(page.h * k)
  const ctx = canvas.getContext('2d')
  const skipped = []
  const itemsMap = new Map((items || []).map((it) => [it.id, it]))

  await preloadFonts(design, k)

  // ---- page background ----
  ctx.fillStyle = page.bgColor || '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (page.bgImageUrl) {
    try {
      const img = await loadImg(page.bgImageUrl)
      const f = fitRect(img.naturalWidth, img.naturalHeight, canvas.width, canvas.height, 'cover')
      ctx.save()
      ctx.globalAlpha = page.bgOpacity ?? 1
      ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, f.dx, f.dy, f.dw, f.dh)
      ctx.restore()
    } catch (_) { skipped.push('صورة الخلفية') }
  }

  // ---- elements in z order (hidden layers are not drawn, exactly like the DOM)
  const sorted = [...(design.elements || [])]
    .filter((el) => !el.hidden)
    .sort((a, b) => (a.z || 0) - (b.z || 0))

  for (const el of sorted) {
    const w = el.w * k, h = el.h * k
    ctx.save()
    ctx.globalAlpha = el.opacity ?? 1
    ctx.translate((el.x + el.w / 2) * k, (el.y + el.h / 2) * k)
    ctx.rotate(((el.rotate || 0) * Math.PI) / 180)
    ctx.translate(-w / 2, -h / 2)
    try {
      if (el.type === 'text') {
        drawTextBox(ctx, el, k)
      } else if (el.type === 'image' && el.url) {
        const img = await loadImg(el.url)
        if (el.shadow) {
          // draw the shadow only: a huge offset keeps the caster off-canvas
          ctx.save()
          ctx.shadowColor = 'rgba(0,0,0,0.35)'
          ctx.shadowBlur = 28 * k
          ctx.shadowOffsetX = w * 4
          ctx.shadowOffsetY = 10 * k
          roundRectPath(ctx, -w * 4, 0, w, h, (el.radius || 0) * k)
          ctx.fillStyle = '#000'
          ctx.fill()
          ctx.restore()
        }
        ctx.save()
        roundRectPath(ctx, 0, 0, w, h, (el.radius || 0) * k)
        ctx.clip()
        if (el.flipH) { ctx.translate(w, 0); ctx.scale(-1, 1) }
        const f = fitRect(img.naturalWidth, img.naturalHeight, w, h, el.fit || 'cover')
        ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, f.dx, f.dy, f.dw, f.dh)
        ctx.restore()
        if (el.borderW) {
          // border-box: the stroke sits INSIDE the element bounds, like CSS
          roundRectPath(ctx, (el.borderW * k) / 2, (el.borderW * k) / 2, w - el.borderW * k, h - el.borderW * k, (el.radius || 0) * k)
          ctx.strokeStyle = el.borderColor || '#1c1c1e'
          ctx.lineWidth = el.borderW * k
          ctx.stroke()
        }
      } else if (el.type === 'image') {
        throw new Error('no image url')
      } else if (el.type === 'shape') {
        const sh = shapeById(el.shapeId)
        if (!sh) throw new Error('shape missing')
        const img = await svgToImage(renderShapeSvg(sh, el), w, h)
        ctx.drawImage(img, 0, 0, w, h)
      } else if (el.type === 'qr') {
        if (!qrSrc) throw new Error('no qr')
        const img = await loadImg(qrSrc)
        ctx.drawImage(img, 0, 0, w, h)
      } else if (el.type === 'itemcard') {
        await drawItemCard(ctx, el, k, itemsMap.get(el.itemId), currency, skipped)
      }
    } catch (_) {
      skipped.push(TYPE_AR[el.type] || el.type)
    }
    ctx.restore()
  }

  const blob = await new Promise((res, rej) => {
    try { canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png') } catch (e) { rej(e) }
  }).catch(() => {
    throw new Error('تعذر إنشاء ملف الصورة — غالباً صورة خارجية بلا CORS منعت التصدير. أزل الصورة أو ارفعها للمكتبة ثم أعد المحاولة.')
  })
  return { blob, skipped }
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
