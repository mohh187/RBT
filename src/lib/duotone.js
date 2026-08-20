// «تلوين» — a Canva-style duotone recolour.
//
// WHAT IT IS, and why it is not the tint the venue already had. `menuTable.tint`
// paints a flat colour over the photograph at an opacity: at 20% it barely
// shows, at 60% the wood grain is gone under a slab of paint. It cannot do what
// the owner asked for, because a covering layer and visible detail are the same
// dial pulling in opposite directions.
//
// A duotone does the opposite. It throws away the photograph's COLOUR and keeps
// its LIGHT, then paints that light with colours of your choosing: the darkest
// pixels become the first colour, the brightest the last, everything between is
// interpolated. Every crease, grain, highlight and shadow survives exactly as it
// was, because the texture lives in the luminance, and the luminance is the one
// thing a duotone preserves perfectly. That is why a duotoned table still reads
// as a real table made of a different material, rather than a table with paint
// spilled on it.
//
// Two colours is the classic. This takes as many as you like: three or four
// stops give a warm shadow, a mid tone and a cool highlight, which is what makes
// a recolour look photographed rather than filtered.

// Rec.709 luminance, the same weights the browser's own `grayscale()` uses, so
// a preview built on an SVG filter and a bake built on this loop agree.
const LR = 0.2126
const LG = 0.7152
const LB = 0.0722

export const DUOTONE_MAX_STOPS = 5

const clamp255 = (n) => (n < 0 ? 0 : n > 255 ? 255 : n)

// '#rgb' | '#rrggbb' -> [r, g, b] 0..255. Anything unparseable returns null so
// a half-typed colour in an input never paints black over a venue's photo.
export function hexToRgb(hex) {
  const s = String(hex || '').trim().replace('#', '')
  if (s.length === 3) {
    const r = parseInt(s[0] + s[0], 16)
    const g = parseInt(s[1] + s[1], 16)
    const b = parseInt(s[2] + s[2], 16)
    return Number.isNaN(r + g + b) ? null : [r, g, b]
  }
  if (s.length === 6) {
    const n = parseInt(s, 16)
    return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  return null
}

export const rgbToHex = ([r, g, b]) => `#${[r, g, b].map((v) => clamp255(Math.round(v)).toString(16).padStart(2, '0')).join('')}`

// The colour ramp as feComponentTransfer tableValues (0..1), one array per
// channel. N stops produce N-1 linear segments across the luminance range,
// which is precisely what `type="table"` interpolates, so the CSS preview and
// the canvas bake are the same function and cannot drift apart.
export function rampTable(colors) {
  const stops = (colors || []).map(hexToRgb).filter(Boolean).slice(0, DUOTONE_MAX_STOPS)
  if (stops.length < 2) return null
  return {
    r: stops.map((c) => c[0] / 255),
    g: stops.map((c) => c[1] / 255),
    b: stops.map((c) => c[2] / 255),
  }
}

// Is this config worth applying at all? An off switch, one colour, or an
// intensity of zero all mean "leave the photograph alone".
export const duotoneActive = (cfg) => !!(cfg && cfg.on && (cfg.colors || []).length >= 2 && Number(cfg.intensity) > 0)

export const DUOTONE_DEFAULT = { on: false, colors: ['#2b1a10', '#e8c9a0'], intensity: 1 }

// Presets chosen for what this tool is mostly pointed at: a wooden table, a
// brick wall, a stone counter. Each is a shadow colour and a highlight colour,
// which is the pair that reads as a material rather than a filter.
export const DUOTONE_PRESETS = [
  { id: 'walnut', ar: 'جوز داكن', en: 'Walnut', colors: ['#241309', '#d8a76c'] },
  { id: 'oak', ar: 'بلوط فاتح', en: 'Light oak', colors: ['#4a3018', '#f0dcc0'] },
  { id: 'ebony', ar: 'آبنوس', en: 'Ebony', colors: ['#0d0b0a', '#8c8378'] },
  { id: 'clay', ar: 'طين وطوب', en: 'Clay', colors: ['#2a1008', '#e0764a'] },
  { id: 'slate', ar: 'حجر رمادي', en: 'Slate', colors: ['#12161a', '#c3ccd4'] },
  { id: 'marble', ar: 'رخام', en: 'Marble', colors: ['#3b3b40', '#f6f4ef'] },
  { id: 'olive', ar: 'زيتوني', en: 'Olive', colors: ['#161c0e', '#b6c48a'] },
  { id: 'wine', ar: 'نبيذي', en: 'Wine', colors: ['#1e0710', '#c9647e'] },
  { id: 'steel', ar: 'فولاذ بارد', en: 'Cold steel', colors: ['#0b1220', '#9fb6cf'] },
  { id: 'gold', ar: 'ذهبي دافئ', en: 'Warm gold', colors: ['#1a1206', '#f2c14e'] },
  // three stops: a warm shadow, a neutral mid and a cool highlight is the
  // combination that stops a recolour looking like a single-hue wash
  { id: 'sunset', ar: 'غروب', en: 'Sunset', colors: ['#1b0d1f', '#c2532f', '#f7d9a0'] },
  { id: 'teal', ar: 'أزرق مخضر', en: 'Teal', colors: ['#08181c', '#2f7d7a', '#e6f2ea'] },
]

// Sample the ramp at a given luminance, for swatches and gradient previews.
export function sampleRamp(colors, l) {
  const stops = (colors || []).map(hexToRgb).filter(Boolean)
  if (!stops.length) return [0, 0, 0]
  if (stops.length === 1) return stops[0]
  const x = Math.max(0, Math.min(1, l)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const f = x - i
  const a = stops[i]
  const b = stops[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

// A CSS gradient of the ramp itself, for the swatch strip in the picker.
export const rampGradient = (colors) => {
  const stops = (colors || []).filter(Boolean)
  if (stops.length < 2) return stops[0] || 'transparent'
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

// ---------------------------------------------------------------- the bake --
// Applied ONCE, at edit time, into the stored file. Not at runtime.
//
// The runtime alternative is an SVG filter on the painted element, and it is
// tempting because it stays editable forever. It is also the wrong trade here:
// the table paints once per menu section, an SVG filter forces an offscreen
// buffer per filtered element, and this product has already had guests' phones
// killed by exactly that class of per-section cost. Baking costs one canvas
// pass in the admin, on a desktop, once, and costs a guest nothing at all.
//
// The original file is never overwritten: uploadImage writes every result to a
// new timestamped path, so the untouched photograph stays in Storage and the
// config that produced this version is stored beside the url.
export function duotonePixels(data, colors, intensity = 1) {
  const table = rampTable(colors)
  if (!table) return
  const n = table.r.length - 1
  const amt = Math.max(0, Math.min(1, Number(intensity)))
  // Precompute the whole ramp at 8-bit resolution: 256 lookups instead of a
  // multiply-and-branch per pixel, which on a 2.5 megapixel photo is the
  // difference between instant and a visible freeze.
  const lutR = new Uint8ClampedArray(256)
  const lutG = new Uint8ClampedArray(256)
  const lutB = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i += 1) {
    const x = (i / 255) * n
    const k = Math.min(n - 1, Math.floor(x))
    const f = x - k
    lutR[i] = 255 * (table.r[k] + (table.r[k + 1] - table.r[k]) * f)
    lutG[i] = 255 * (table.g[k] + (table.g[k + 1] - table.g[k]) * f)
    lutB[i] = 255 * (table.b[k] + (table.b[k + 1] - table.b[k]) * f)
  }
  for (let i = 0; i < data.length; i += 4) {
    // a fully transparent pixel has no colour worth mapping, and touching it
    // would put a colour fringe around every cutout's edge
    if (data[i + 3] === 0) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const l = (LR * r + LG * g + LB * b) | 0
    // intensity blends back toward the original, so the owner can stop at
    // "tinted photograph" instead of being forced all the way to two colours
    data[i] = r + (lutR[l] - r) * amt
    data[i + 1] = g + (lutG[l] - g) * amt
    data[i + 2] = b + (lutB[l] - b) * amt
    // alpha untouched, on purpose
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Storage download urls serve CORS headers, so a remote photo can be
    // re-coloured in place without tainting the canvas.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Bake a duotone into a Blob/File/URL and return a Blob. Returns the input
// untouched when the config is off, so callers can pipe unconditionally.
export async function bakeDuotone(input, cfg) {
  if (!duotoneActive(cfg)) return input
  const isBlob = typeof Blob !== 'undefined' && input instanceof Blob
  const url = isBlob ? URL.createObjectURL(input) : String(input)
  try {
    const img = await loadImage(url)
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h) return input
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const id = ctx.getImageData(0, 0, w, h)
    duotonePixels(id.data, cfg.colors, cfg.intensity)
    ctx.putImageData(id, 0, 0)
    // PNG only where the source could carry transparency: webp keeps alpha too
    // and is far smaller, so it is the default and png is never chosen blindly.
    const type = isBlob && /png/i.test(input.type || '') ? 'image/png' : 'image/webp'
    const out = await new Promise((res) => cv.toBlob(res, type, 0.9))
    return out || input
  } catch (_) {
    // a failed recolour must hand back the original rather than nothing
    return input
  } finally {
    if (isBlob) URL.revokeObjectURL(url)
  }
}
