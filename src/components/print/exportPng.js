// Free-form print studio — native PNG rasterizer. We OWN the document model, so
// the export draws it directly onto a real <canvas> at 2x scale: images via
// drawImage (crossOrigin anonymous — bucket CORS is configured), text via
// fillText with document.fonts loading, shapes via SVG-blob → drawImage (the
// same svg string the DOM renders, so colors match exactly), QR from its
// dataURL. Any element that fails to rasterize is SKIPPED and reported by name
// — the caller toasts the list honestly.
import { fontStacks } from '../../lib/skins.js'
import { shapeById, renderShapeSvg } from '../../lib/printShapes.js'

// Official Saudi Riyal symbol paths (same geometry as components/Riyal.jsx).
const RIYAL_VB = { w: 1124.14, h: 1256.39 }
const RIYAL_PATHS = [
  'M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z',
  'M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z',
]

const TYPE_AR = { text: 'نص', image: 'صورة', shape: 'شكل', qr: 'رمز QR', itemcard: 'بطاقة صنف' }

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
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, Math.max(0, r))
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
  ctx.textAlign = el.align === 'center' ? 'center' : el.align === 'left' ? 'left' : 'right'
  ctx.textBaseline = 'middle'
}

function drawTextBox(ctx, el, k) {
  setTextStyle(ctx, el, k)
  ctx.fillStyle = el.color || '#1c1c1e'
  const w = el.w * k
  const lineH = (el.size || 18) * (el.lineHeight || 1.4) * k
  const lines = wrapLines(ctx, el.text, w)
  const tx = el.align === 'center' ? w / 2 : el.align === 'left' ? 0 : w
  lines.forEach((line, i) => ctx.fillText(line, tx, i * lineH + lineH / 2))
}

// preload every font family used by the design so fillText is faithful
async function preloadFonts(design, k) {
  const jobs = []
  for (const el of design.elements || []) {
    if (el.type !== 'text' && el.type !== 'itemcard') continue
    const fam = fontStacks(el.fontKey || 'tajawal').display
    const size = Math.round((el.size || 18) * k)
    jobs.push(document.fonts.load(`${el.weight || 700} ${size}px ${fam}`).catch(() => {}))
    jobs.push(document.fonts.load(`400 ${size}px ${fam}`).catch(() => {}))
  }
  jobs.push(document.fonts.ready.catch?.(() => {}) || Promise.resolve())
  await Promise.all(jobs)
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

  // ---- elements in z order ----
  const sorted = [...(design.elements || [])].sort((a, b) => (a.z || 0) - (b.z || 0))
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
          // draw only the shadow: huge offset trick keeps the caster off-canvas
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
          roundRectPath(ctx, el.borderW * k / 2, el.borderW * k / 2, w - el.borderW * k, h - el.borderW * k, (el.radius || 0) * k)
          ctx.strokeStyle = el.borderColor || '#1c1c1e'
          ctx.lineWidth = el.borderW * k
          ctx.stroke()
        }
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
        const it = itemsMap.get(el.itemId)
        // card chrome (mirrors the DOM card: white, radius 12, hairline border)
        roundRectPath(ctx, 0, 0, w, h, 12 * k)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.08)'
        ctx.lineWidth = 1 * k
        ctx.stroke()
        const pad = 8 * k
        const vertical = (el.layout || 'h') === 'v'
        let textX0 = pad, textX1 = w - pad, textTop = pad
        if (it?.imageUrl) {
          try {
            const img = await loadImg(it.imageUrl)
            if (vertical) {
              const ih = Math.min(h * 0.55, h - 40 * k)
              ctx.save()
              roundRectPath(ctx, pad, pad, w - pad * 2, ih, 8 * k)
              ctx.clip()
              const f = fitRect(img.naturalWidth, img.naturalHeight, w - pad * 2, ih, 'cover')
              ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, pad + f.dx, pad + f.dy, f.dw, f.dh)
              ctx.restore()
              textTop = pad + ih + 6 * k
            } else {
              const s = h - pad * 2
              ctx.save()
              roundRectPath(ctx, w - pad - s, pad, s, s, 8 * k)
              ctx.clip()
              const f = fitRect(img.naturalWidth, img.naturalHeight, s, s, 'cover')
              ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, w - pad - s + f.dx, pad + f.dy, f.dw, f.dh)
              ctx.restore()
              textX1 = w - pad - s - 8 * k
            }
          } catch (_) { skipped.push(`صورة الصنف (${it.nameAr || it.nameEn || ''})`) }
        }
        const fam = fontStacks('tajawal').display
        ctx.direction = 'rtl'
        ctx.textBaseline = 'middle'
        const name = it ? (it.nameAr || it.nameEn || '') : 'صنف غير موجود'
        ctx.fillStyle = '#1c1c1e'
        ctx.font = `700 ${15 * k}px ${fam}`
        ctx.textAlign = vertical ? 'center' : 'right'
        const nx = vertical ? w / 2 : textX1
        ctx.fillText(name, nx, textTop + 11 * k, textX1 - textX0)
        let cy2 = textTop + 24 * k
        if (el.showDesc && (it?.descAr || it?.descEn)) {
          ctx.fillStyle = '#6b6b70'
          ctx.font = `400 ${11 * k}px ${fam}`
          const desc = (it.descAr || it.descEn || '').slice(0, 90)
          ctx.fillText(desc, nx, cy2, textX1 - textX0)
          cy2 += 16 * k
        }
        if (el.showPrice !== false && it) {
          const num = String(priceOf(it))
          ctx.fillStyle = '#1c1c1e'
          ctx.font = `800 ${14 * k}px ${fam}`
          if (currency && currency !== 'SAR') {
            ctx.fillText(`${currency} ${num}`, nx, cy2 + 6 * k)
          } else {
            // dir ltr pair: symbol on the left of the number (matches <Price lang="ar">)
            ctx.textAlign = 'left'
            const numW = ctx.measureText(num).width
            const symS = 13 * k
            const total = numW + symS + 4 * k
            const startX = vertical ? (w - total) / 2 : (textX1 - total)
            drawRiyal(ctx, startX, cy2, symS, '#1c1c1e')
            ctx.fillText(num, startX + symS + 4 * k, cy2 + 6 * k)
          }
        }
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
