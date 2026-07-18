// WCAG 2.x contrast math for the design studio's color guards: any custom
// text color must stay readable on BOTH the light and the dark menu surfaces,
// so pickers show a live verdict per mode instead of letting a venue ship
// invisible text (user-mandated rule 2026-07-05).

const SRGB = (c) => {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  return 0.2126 * SRGB(rgb[0]) + 0.7152 * SRGB(rgb[1]) + 0.0722 * SRGB(rgb[2])
}

export function contrastRatio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  if (la == null || lb == null) return null
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// representative surfaces of the two app modes (menu cards light / dark)
export const LIGHT_SURFACE = '#ffffff'
export const DARK_SURFACE = '#16181d'

// verdict per mode: 'ok' (>= 4.5 AA), 'weak' (>= 3, large-text only), 'bad'
export function textReadability(color) {
  const grade = (r) => (r == null ? null : r >= 4.5 ? 'ok' : r >= 3 ? 'weak' : 'bad')
  return {
    light: grade(contrastRatio(color, LIGHT_SURFACE)),
    dark: grade(contrastRatio(color, DARK_SURFACE)),
  }
}
