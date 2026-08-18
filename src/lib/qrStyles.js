// STYLED QR CODES — drawn from the raw module matrix, not the encoder's bitmap.
//
// `qrcode`'s toDataURL only ever paints solid squares in one colour, so every QR
// in the product looked identical. QRCode.create() hands back the actual module
// matrix (a size×size Uint8Array, 1 = dark), which is everything needed to draw
// the code ourselves — so the twenty styles below are real geometry changes, not
// recolours, and they cost no new dependency.
//
// WHY SVG AND NOT CANVAS: the print studio renders in the DOM and rasterises on
// canvas, and a single SVG string satisfies both (the shape elements already do
// exactly this via svgToImage). One source, no divergence between preview and
// export.
//
// SCANNABILITY IS NOT NEGOTIABLE. A pretty code that will not scan is a ruined
// sticker sitting on a table for months, so the drawing rules here are bounded
// by what a phone camera can still decode:
//
//   * The three finder patterns (the corner "eyes") keep their 7×7 footprint and
//     their 1-module white ring. Decoders locate the symbol by those three
//     squares; restyle them freely, move or shrink them and the code dies.
//   * A quiet zone of >= 2 modules is always emitted. Trim it and phones fail to
//     find the symbol at all even though the payload is intact.
//   * Module shapes only ever shrink INSIDE their cell, never past ~0.42 of the
//     cell radius, because thinning the dark area past that flips the sampled
//     value at the cell centre.
//   * A centre logo is punched out of DATA modules, so it needs the error budget
//     to cover it: styles that carry a logo force errorCorrectionLevel 'H' and
//     the hole is capped at 22% of the width (well under H's ~30% headroom).
//
// The visual result is verified for real by decoding the rendered output — see
// verifyQrSvg() and its use in the studio, which refuses to promise a code
// scans until it has actually read it back.

export const QR_EC_WITH_LOGO = 'H'

// ---------------------------------------------------------------- matrix ----

// Finder patterns occupy a 7×7 block in three corners. Their modules are drawn
// by the eye renderer instead of the module renderer.
function isEye(x, y, size) {
  return (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7)
}

export async function qrMatrix(text, ec = 'M') {
  const { default: QRCode } = await import('qrcode')
  const qr = QRCode.create(String(text || ''), { errorCorrectionLevel: ec })
  const size = qr.modules.size
  const data = qr.modules.data
  const at = (x, y) => (x < 0 || y < 0 || x >= size || y >= size ? 0 : data[y * size + x])
  return { size, at, version: qr.version }
}

// ---------------------------------------------------------------- modules ----
// Every renderer draws one module inside the unit cell at (x, y). `n` is the
// 4-bit neighbour mask (1 up, 2 right, 4 down, 8 left) used by the styles that
// fuse touching modules.

// Coordinates are in MODULE units, so two decimals is 1/100th of a module — far
// below any printer or camera threshold. Returns a NUMBER, not a string: the
// arithmetic in roundRectVar builds on these values, and a string here turns
// `x + r` into concatenation, which silently misplaces every rounded module.
const F = (v) => Number(v.toFixed(2))

const MODULES = {
  square: (x, y) => `M${x} ${y}h1v1h-1z`,

  dot: (x, y) => {
    const c = 0.5
    return `M${F(x + c)} ${y}a${c} ${c} 0 1 0 0 1a${c} ${c} 0 1 0 0-1z`
  },

  rounded: (x, y) => roundRect(x, y, 1, 1, 0.28),
  extraRounded: (x, y) => roundRect(x, y, 1, 1, 0.46),

  diamond: (x, y) => `M${F(x + 0.5)} ${y}L${x + 1} ${F(y + 0.5)}L${F(x + 0.5)} ${y + 1}L${x} ${F(y + 0.5)}z`,

  // Fused: corners round only where there is no neighbour, so runs of modules
  // read as one continuous ribbon. The most "designed" look and still safe,
  // because the cell centre stays fully covered.
  fluid: (x, y, n) => {
    const r = 0.5
    const up = n & 1, right = n & 2, down = n & 4, left = n & 8
    const tl = !up && !left ? r : 0
    const tr = !up && !right ? r : 0
    const br = !down && !right ? r : 0
    const bl = !down && !left ? r : 0
    return roundRectVar(x, y, 1, 1, tl, tr, br, bl)
  },

  // Runs fused along ONE axis only, so the code reads as capsules instead of a
  // grid. Coverage stays 100% of the cell, which is why these are as safe as the
  // classic square while looking nothing like it.
  vbars: (x, y, n) => {
    const r = 0.5, up = n & 1, down = n & 4
    return roundRectVar(x, y, 1, 1, up ? 0 : r, up ? 0 : r, down ? 0 : r, down ? 0 : r)
  },
  hbars: (x, y, n) => {
    const r = 0.5, right = n & 2, left = n & 8
    return roundRectVar(x, y, 1, 1, left ? 0 : r, right ? 0 : r, right ? 0 : r, left ? 0 : r)
  },

  mosaic: (x, y) => roundRect(x + 0.08, y + 0.08, 0.84, 0.84, 0.1),

  star: (x, y) => {
    const cx = x + 0.5, cy = y + 0.5, R = 0.52, r = 0.24
    let d = ''
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r : R
      const a = (Math.PI / 5) * i - Math.PI / 2
      d += `${i ? 'L' : 'M'}${F(cx + Math.cos(a) * rad)} ${F(cy + Math.sin(a) * rad)}`
    }
    return d + 'z'
  },

  triangle: (x, y) => `M${F(x + 0.5)} ${F(y + 0.04)}L${F(x + 0.98)} ${F(y + 0.96)}L${F(x + 0.02)} ${F(y + 0.96)}z`,

  hexagon: (x, y) => {
    const cx = x + 0.5, cy = y + 0.5, R = 0.54
    let d = ''
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6
      d += `${i ? 'L' : 'M'}${F(cx + Math.cos(a) * R)} ${F(cy + Math.sin(a) * R)}`
    }
    return d + 'z'
  },

  plus: (x, y) => {
    const t = 0.3
    const a = F(x + (1 - t) / 2), b = F(y + (1 - t) / 2)
    return `M${a} ${y + 0.02}h${F(t)}v${b - y - 0.02}h${F((1 - t) / 2 - 0.02)}v${F(t)}h${F(-((1 - t) / 2 - 0.02))}v${F(1 - 0.04 - (b - y - 0.02) - t)}h${F(-t)}v${F(-(1 - 0.04 - (b - y - 0.02) - t))}h${F(-((1 - t) / 2 - 0.02))}v${F(-t)}h${F((1 - t) / 2 - 0.02)}z`
  },

  leaf: (x, y, n) => {
    // one sharp corner, three round — a directional petal
    const r = 0.5
    return (n & 2) || (n & 4)
      ? roundRectVar(x, y, 1, 1, r, 0, r, r)
      : roundRectVar(x, y, 1, 1, r, r, 0, r)
  },
}

function roundRect(x, y, w, h, r) {
  return roundRectVar(x, y, w, h, r, r, r, r)
}

// Arithmetic stays in NUMBERS and only the emitted coordinate is formatted. An
// earlier version formatted x/y up front and then kept adding to the result, so
// once F() returned a string the additions became concatenation ("2" + 0.5 →
// "20.5") and every rounded module silently drew in the wrong place.
function roundRectVar(x, y, w, h, tl, tr, br, bl) {
  return [
    `M${F(x + tl)} ${F(y)}`,
    `H${F(x + w - tr)}`, tr ? `A${F(tr)} ${F(tr)} 0 0 1 ${F(x + w)} ${F(y + tr)}` : '',
    `V${F(y + h - br)}`, br ? `A${F(br)} ${F(br)} 0 0 1 ${F(x + w - br)} ${F(y + h)}` : '',
    `H${F(x + bl)}`, bl ? `A${F(bl)} ${F(bl)} 0 0 1 ${F(x)} ${F(y + h - bl)}` : '',
    `V${F(y + tl)}`, tl ? `A${F(tl)} ${F(tl)} 0 0 1 ${F(x + tl)} ${F(y)}` : '',
    'z',
  ].join('')
}

// -------------------------------------------------------------------- eyes ----
// An eye is a 7×7 outer ring plus a 3×3 pupil, drawn at the block's origin.
// Shapes vary; the 7-module footprint and the white gap never do.

const EYES = {
  square: (x, y) => ({
    ring: `M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5z`,
    pupil: `M${x + 2} ${y + 2}h3v3h-3z`,
  }),
  circle: (x, y) => ({
    ring: `M${x + 3.5} ${y}a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM${x + 3.5} ${y + 1}a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5z`,
    pupil: `M${x + 3.5} ${y + 2}a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z`,
  }),
  roundedSquare: (x, y) => ({
    ring: `${roundRect(x, y, 7, 7, 1.9)}${roundRect(x + 1, y + 1, 5, 5, 1.2)}`,
    pupil: roundRect(x + 2, y + 2, 3, 3, 0.8),
  }),
  // Three round corners, one sharp — points inward, a signature look.
  leaf: (x, y, corner) => {
    const r = 2.4
    const m = { tl: [0, r, r, r], tr: [r, 0, r, r], bl: [r, r, r, 0] }[corner] || [0, r, r, r]
    const i = m.map((v) => (v ? v * 0.62 : 0))
    return {
      ring: `${roundRectVar(x, y, 7, 7, ...m)}${roundRectVar(x + 1, y + 1, 5, 5, ...i)}`,
      pupil: roundRectVar(x + 2, y + 2, 3, 3, ...m.map((v) => (v ? 1 : 0))),
    }
  },
  petal: (x, y) => ({
    ring: `${roundRectVar(x, y, 7, 7, 3.5, 0.6, 3.5, 0.6)}${roundRectVar(x + 1, y + 1, 5, 5, 2.5, 0.4, 2.5, 0.4)}`,
    pupil: roundRectVar(x + 2, y + 2, 3, 3, 1.5, 0.3, 1.5, 0.3),
  }),
  // The ring built from discrete dots. Heaviest restyle here, so the pupil stays
  // a solid disc to keep the centre sample unambiguous.
  dotted: (x, y) => {
    let ring = ''
    for (let i = 0; i < 7; i++) {
      for (const [dx, dy] of [[i, 0], [i, 6], [0, i], [6, i]]) {
        ring += `M${F(x + dx + 0.5)} ${F(y + dy + 0.1)}a0.4 0.4 0 1 0 0 0.8a0.4 0.4 0 1 0 0-0.8z`
      }
    }
    return { ring, pupil: `M${x + 3.5} ${y + 2}a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z` }
  },
}

// ------------------------------------------------------------------ styles ----
// Twenty presets. Each differs in module geometry, eye geometry, fill treatment
// or a centre cut-out — never in colour alone.

// `risk` drives the honest minimum print size below. It is a property of how much
// of each cell the shape actually inks: a full-coverage square survives a small
// sticker and a cheap camera, a thin star does not. Every style here decodes in
// the test harness at 440px — that is NOT the same as decoding at 18mm on matte
// vinyl under a dim café light, which is what `minMm` is for.
export const QR_STYLES = [
  { id: 'classic', ar: 'كلاسيكي مربّع', module: 'square', eye: 'square', risk: 'low' },
  { id: 'dots', ar: 'نقاط دائرية', module: 'dot', eye: 'circle', risk: 'med' },
  { id: 'rounded', ar: 'مربّعات مستديرة', module: 'rounded', eye: 'roundedSquare', risk: 'low' },
  { id: 'extra', ar: 'استدارة فائقة', module: 'extraRounded', eye: 'roundedSquare', risk: 'med' },
  { id: 'diamond', ar: 'معيّنات', module: 'diamond', eye: 'square', risk: 'high' },
  { id: 'fluid', ar: 'سائل متّصل', module: 'fluid', eye: 'roundedSquare', risk: 'low' },
  { id: 'vbars', ar: 'شرائط رأسية', module: 'vbars', eye: 'roundedSquare', risk: 'low' },
  { id: 'hbars', ar: 'شرائط أفقية', module: 'hbars', eye: 'roundedSquare', risk: 'low' },
  { id: 'mosaic', ar: 'فسيفساء', module: 'mosaic', eye: 'square', risk: 'low' },
  { id: 'stars', ar: 'نجوم', module: 'star', eye: 'circle', risk: 'high' },
  { id: 'triangles', ar: 'مثلّثات', module: 'triangle', eye: 'square', risk: 'high' },
  { id: 'hexagons', ar: 'سداسيات', module: 'hexagon', eye: 'circle', risk: 'med' },
  { id: 'plus', ar: 'صلبان', module: 'plus', eye: 'square', risk: 'high' },
  { id: 'leafEye', ar: 'عيون بورقة', module: 'rounded', eye: 'leaf', risk: 'low' },
  { id: 'petal', ar: 'عيون بتلة', module: 'dot', eye: 'petal', risk: 'med' },
  { id: 'dottedEye', ar: 'عيون منقّطة', module: 'dot', eye: 'dotted', risk: 'high' },
  { id: 'gradDiag', ar: 'تدرّج قطري', module: 'rounded', eye: 'roundedSquare', gradient: 'linear', risk: 'med' },
  { id: 'gradRadial', ar: 'تدرّج شعاعي', module: 'dot', eye: 'circle', gradient: 'radial', risk: 'med' },
  { id: 'logoCenter', ar: 'شعار في المنتصف', module: 'fluid', eye: 'roundedSquare', logo: true, risk: 'med' },
  { id: 'logoDots', ar: 'شعار مع نقاط', module: 'dot', eye: 'circle', logo: true, gradient: 'linear', risk: 'high' },
]

// Smallest printed width at which this style is still reliable, in mm. A QR needs
// roughly 0.5mm per module for a phone camera; a v4 symbol plus quiet zone is ~41
// modules, so ~21mm is the floor for a full-coverage style. Thin shapes ink less
// of each module and need proportionally more room.
export const qrStyleById = (id) => QR_STYLES.find((s) => s.id === id) || QR_STYLES[0]

// FRAMES.
//
// A bare code on a table gets ignored; a framed code with a two-word instruction
// gets scanned. The frame is drawn INTO the same SVG rather than composed from
// separate elements, for two reasons: it travels as one unit so a designer
// cannot drag the code out of its own caption, and both renderers already
// consume that SVG, so the frame needs no second implementation.
//
// The quiet zone is measured from the CODE, never from the frame — frame
// geometry is added outside it, so decorating can never eat the margin that
// makes the symbol findable.
export const QR_FRAMES = [
  { id: 'none', ar: 'بلا إطار' },
  { id: 'round', ar: 'إطار مستدير' },
  { id: 'card', ar: 'بطاقة' },
  { id: 'ribbon', ar: 'شريط سفلي' },
  { id: 'badge', ar: 'شارة علوية' },
  { id: 'ticket', ar: 'تذكرة' },
]

// Geometry of a frame, in MODULE units, around a code of `total` units.
// pad: space added on every side. cap: extra height for the caption strip.
function frameGeom(frame, hasCaption) {
  if (frame === 'none') return { pad: 0, cap: 0 }
  const cap = hasCaption ? 5 : 0
  if (frame === 'round') return { pad: 2.5, cap }
  if (frame === 'card') return { pad: 3, cap }
  if (frame === 'ribbon') return { pad: 2.5, cap: hasCaption ? 6 : 0 }
  if (frame === 'badge') return { pad: 2.5, cap, top: hasCaption ? 6 : 0 }
  if (frame === 'ticket') return { pad: 3, cap }
  return { pad: 0, cap: 0 }
}

const RISK_MM = { low: 22, med: 28, high: 36 }
export const qrMinMm = (styleId) => RISK_MM[qrStyleById(styleId).risk || 'low']

// ------------------------------------------------------------------ render ----

/**
 * Renders a styled QR as an SVG string.
 * `dark2` is only consulted by the gradient styles; everything else ignores it.
 * Returns the svg plus the facts a caller needs to reason about safety.
 */
export async function renderQrSvg(text, {
  styleId = 'classic', dark = '#111111', dark2 = '', light = '#ffffff',
  margin = 2, logoUrl = '', ec, px = 0,
  frame = 'none', caption = '', frameColor = '', captionColor = '', font = 'Tajawal, sans-serif',
} = {}) {
  const style = qrStyleById(styleId)
  // A logo eats data modules, so the error budget has to be able to cover it.
  const level = ec || (style.logo ? QR_EC_WITH_LOGO : 'M')
  const { size, at, version } = await qrMatrix(text, level)
  const q = Math.max(2, margin) // quiet zone floor — below 2 phones stop locating
  const total = size + q * 2
  const modFn = MODULES[style.module] || MODULES.square
  const eyeFn = EYES[style.eye] || EYES.square

  // Centre cut-out, in modules, kept under the error-correction headroom.
  const hole = style.logo ? Math.round(size * 0.22) : 0
  const h0 = Math.floor((size - hole) / 2), h1 = h0 + hole
  const inHole = (x, y) => hole && x >= h0 && x < h1 && y >= h0 && y < h1

  let d = ''
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!at(x, y) || isEye(x, y, size) || inHole(x, y)) continue
      const n = (at(x, y - 1) ? 1 : 0) | (at(x + 1, y) ? 2 : 0) | (at(x, y + 1) ? 4 : 0) | (at(x - 1, y) ? 8 : 0)
      d += modFn(x + q, y + q, n)
    }
  }

  const eyes = [
    eyeFn(q, q, 'tl'),
    eyeFn(q + size - 7, q, 'tr'),
    eyeFn(q, q + size - 7, 'bl'),
  ]
  const eyeD = eyes.map((e) => e.ring + e.pupil).join('')

  const fillId = `qg-${styleId}-${Math.abs(hashOf(text)) % 100000}`
  const useGrad = style.gradient && dark2
  const grad = !useGrad ? '' : style.gradient === 'radial'
    ? `<radialGradient id="${fillId}" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="${dark2}"/></radialGradient>`
    : `<linearGradient id="${fillId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="${dark2}"/></linearGradient>`
  const paint = useGrad ? `url(#${fillId})` : dark

  const logo = style.logo && logoUrl
    ? `<image href="${escAttr(logoUrl)}" x="${F(q + h0)}" y="${F(q + h0)}" width="${hole}" height="${hole}" preserveAspectRatio="xMidYMid meet"/>`
    : ''

  // Frame geometry is added OUTSIDE the finished code, so the quiet zone above
  // is untouched by any decoration.
  const cap = String(caption || '').trim()
  const g = frameGeom(frame, !!cap)
  const topPad = g.top || 0
  const W = total + g.pad * 2
  const H = total + g.pad * 2 + g.cap + topPad
  const fcol = frameColor || dark
  const ccol = captionColor || (frame === 'ribbon' || frame === 'badge' ? light : dark)
  const codeY = g.pad + topPad
  const sw = 0.9 // frame stroke width, in module units

  let frameSvg = ''
  if (frame === 'round') {
    frameSvg = `<rect x="${F(sw / 2)}" y="${F(sw / 2)}" width="${F(W - sw)}" height="${F(H - sw)}" rx="4" fill="${light}" stroke="${fcol}" stroke-width="${sw}"/>`
  } else if (frame === 'card') {
    frameSvg = `<rect width="${W}" height="${H}" rx="3.4" fill="${light}"/>`
      + `<rect x="${F(sw)}" y="${F(sw)}" width="${F(W - sw * 2)}" height="${F(H - sw * 2)}" rx="2.6" fill="none" stroke="${fcol}" stroke-width="${F(sw * 0.7)}"/>`
  } else if (frame === 'ribbon') {
    frameSvg = `<rect width="${W}" height="${H}" rx="3.4" fill="${light}" stroke="${fcol}" stroke-width="${F(sw * 0.7)}"/>`
      + (cap ? `<path d="M0 ${F(H - g.cap)}h${W}v${F(g.cap - 3.4)}a3.4 3.4 0 0 1-3.4 3.4h${F(-(W - 6.8))}a3.4 3.4 0 0 1-3.4-3.4z" fill="${fcol}"/>` : '')
  } else if (frame === 'badge') {
    frameSvg = `<rect width="${W}" height="${H}" rx="3.4" fill="${light}" stroke="${fcol}" stroke-width="${F(sw * 0.7)}"/>`
      + (cap ? `<path d="M3.4 0h${F(W - 6.8)}a3.4 3.4 0 0 1 3.4 3.4v${F(topPad - 3.4)}H0V3.4A3.4 3.4 0 0 1 3.4 0z" fill="${fcol}"/>` : '')
  } else if (frame === 'ticket') {
    // notched sides — reads as a coupon, which is what a table offer is
    const n = 2.2
    frameSvg = `<path d="M0 0h${W}v${F(H / 2 - n)}a${n} ${n} 0 0 0 0 ${F(n * 2)}V${H}H0v${F(-(H / 2 - n))}a${n} ${n} 0 0 0 0${F(-n * 2)}z" fill="${light}" stroke="${fcol}" stroke-width="${F(sw * 0.7)}"/>`
  }

  const capSvg = cap
    ? `<text x="${F(W / 2)}" y="${frame === 'badge' ? F(topPad / 2) : F(H - g.cap / 2)}" fill="${ccol}"`
      + ` font-family="${escAttr(font)}" font-size="${F(g.cap * 0.62)}" font-weight="700"`
      + ` text-anchor="middle" dominant-baseline="central" direction="rtl">${escText(cap)}</text>`
    : ''

  const dim = px ? ` width="${px}" height="${F((px * H) / W)}"` : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${F(W)} ${F(H)}"${dim} shape-rendering="geometricPrecision">`
    + (grad ? `<defs>${grad}</defs>` : '')
    + frameSvg
    + `<g transform="translate(${F(g.pad)} ${F(codeY)})">`
    + `<rect width="${total}" height="${total}" fill="${light}"/>`
    + `<path d="${d}" fill="${paint}" fill-rule="evenodd"/>`
    + `<path d="${eyeD}" fill="${paint}" fill-rule="evenodd"/>`
    + logo
    + '</g>'
    + capSvg
    + '</svg>'

  return { svg, size, total, version, ec: level, quietZone: q, holeModules: hole, style, width: W, height: H }
}

// SVG → dataURL, for the canvas rasterizer and <img> consumers. encodeURIComponent
// (not base64) keeps Arabic-safe and avoids btoa's latin1 throw.
export function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export async function qrStyleDataUrl(text, opts = {}) {
  const { svg } = await renderQrSvg(text, opts)
  return svgToDataUrl(svg)
}

function hashOf(s) {
  let h = 0
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0
  return h
}
const escAttr = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
// Caption text is venue-authored and goes into SVG markup, so it is escaped as
// text content, not as an attribute.
const escText = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ------------------------------------------------------------------ verify ----

/**
 * Proves a styled code still decodes, by rasterising the SVG and reading it back
 * with jsQR. Styling a QR is a bet against the decoder, and the only honest way
 * to show a «tested» badge is to have actually tested THIS payload in THIS style
 * at the size it will print.
 *
 * Returns { ok, text, reason }. `ok: false` means do not print it.
 */
export async function verifyQrSvg(svg, expectText, { px = 360 } = {}) {
  let host = null
  try {
    const blob = await svgToPngBlob(svg, px)
    const file = new File([blob], 'qr.png', { type: 'image/png' })
    // The decoder already in the project (it powers the staff scanner) can read a
    // file with no camera, so verification costs no new dependency — and it is
    // dynamically imported, so its ~340 kB stays out of every other chunk.
    const { Html5Qrcode } = await import('html5-qrcode')
    host = document.createElement('div')
    host.id = `qrverify-${Math.random().toString(36).slice(2)}`
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden'
    document.body.appendChild(host)
    const text = await new Html5Qrcode(host.id, { verbose: false }).scanFile(file, false)
    if (expectText && text !== String(expectText)) return { ok: false, reason: 'mismatch', text }
    return { ok: true, text }
  } catch (e) {
    const msg = String(e?.message || e)
    // A "no code found" rejection is a real FAIL of this style, not a tooling
    // error — the two must never be conflated or an unscannable style ships
    // wearing a «tested» badge.
    if (/no *multiformat|not *found|no +qr|nomatch/i.test(msg)) return { ok: false, reason: 'no-decode' }
    return { ok: null, reason: msg }
  } finally {
    host?.remove()
  }
}

// Rasterise an SVG string to a PNG blob at `px`, on white — the same path the
// print export takes, so verification tests what actually gets printed.
export async function svgToPngBlob(svg, px = 360) {
  const img = await loadImage(svgToDataUrl(svg))
  const cv = document.createElement('canvas')
  cv.width = px; cv.height = px
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, px, px)
  ctx.drawImage(img, 0, 0, px, px)
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'))
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = () => rej(new Error('image'))
    i.src = src
  })
}
