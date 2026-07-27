// CONTRAST GUARD — the reason "invisible text on some theme" can never happen
// again, for ANY theme, including ones added later and any venue brand colour.
//
// THE PROBLEM IT SOLVES. Every ink token (--text, --text-muted, --text-faint,
// --success, --danger, --warning, --info, --on-brand) was a hand-written
// constant per theme, while the surface it is painted on comes from a DIFFERENT
// place: the system theme, the mode, the venue's brand, and translucency that
// composites over whatever is behind. Nothing tied the two together, so
// combinations nobody tried produced unreadable pairs — white-on-white primary
// buttons, faint text at 1.4:1, "متوفر" badges that vanish. Measured across
// themes x modes x brands, hundreds of pairs failed WCAG AA.
//
// THE FIX. After a theme is applied, read the COMPUTED value of each ink and of
// the surface it actually sits on, measure the real contrast, and if it fails,
// push the ink toward black or white (whichever direction gains contrast) until
// it passes — then write it back as an inline custom property on <html>, which
// beats every stylesheet rule. Because it works on computed values it is immune
// to how the colour was authored (hex, color-mix, color(srgb …), var chains).
//
// It only ever makes text MORE readable; a pair that already passes is left
// exactly as the designer wrote it.

// --- colour plumbing -------------------------------------------------------
// One probe element resolves any CSS colour expression to a concrete value.
let probe = null
function probeEl() {
  if (probe && probe.isConnected) return probe
  probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;pointer-events:none'
  document.body.appendChild(probe)
  return probe
}

// Handles both `rgb()/rgba()` and the modern `color(srgb r g b / a)` that
// color-mix() computes to — the form that silently defeats a naive regex.
function parseColor(str) {
  const s = String(str || '').trim()
  if (!s) return null
  let m = s.match(/^rgba?\(([^)]+)\)$/i)
  if (m) {
    const q = m[1].split(/[,/\s]+/).filter(Boolean).map(parseFloat)
    if (q.length < 3 || q.some((n) => Number.isNaN(n))) return null
    return { r: q[0], g: q[1], b: q[2], a: q.length > 3 ? q[3] : 1 }
  }
  m = s.match(/^color\(srgb\s+([^)]+)\)$/i)
  if (m) {
    const parts = m[1].split('/')
    const q = parts[0].trim().split(/\s+/).map(parseFloat)
    if (q.length < 3 || q.some((n) => Number.isNaN(n))) return null
    const a = parts[1] != null ? parseFloat(parts[1]) : 1
    return { r: q[0] * 255, g: q[1] * 255, b: q[2] * 255, a: Number.isNaN(a) ? 1 : a }
  }
  return null
}

// Resolve any colour expression (including var()/color-mix()) to {r,g,b,a}.
function resolve(expr) {
  try {
    const el = probeEl()
    el.style.color = ''
    el.style.color = expr
    if (!el.style.color) return null // the browser rejected it
    return parseColor(getComputedStyle(el).color)
  } catch (_) { return null }
}

const over = (fg, bg) => ({
  r: bg.r + (fg.r - bg.r) * fg.a,
  g: bg.g + (fg.g - bg.g) * fg.a,
  b: bg.b + (fg.b - bg.b) * fg.a,
  a: 1,
})
function luminance(c) {
  const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}
export function ratio(a, b) {
  const la = luminance(a), lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
const mix = (c, target, t) => ({ r: c.r + (target.r - c.r) * t, g: c.g + (target.g - c.g) * t, b: c.b + (target.b - c.b) * t, a: 1 })

const BLACK = { r: 0, g: 0, b: 0, a: 1 }
const WHITE = { r: 255, g: 255, b: 255, a: 1 }

// Nudge `ink` toward black or white until it clears `min` against `bg`.
// Picks the direction that can actually get there (a mid-tone background may
// only be escapable one way), and stops at the FIRST passing step so the hue is
// disturbed as little as possible.
function correct(ink, bg, min) {
  const towardDark = luminance(bg) > luminance(ink) ? BLACK : WHITE
  const candidates = [towardDark, towardDark === BLACK ? WHITE : BLACK]
  for (const target of candidates) {
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const c = mix(ink, target, t)
      if (ratio(c, bg) >= min) return c
    }
  }
  // Nothing works (a mid-grey background) — take the higher-contrast pole.
  return ratio(BLACK, bg) >= ratio(WHITE, bg) ? BLACK : WHITE
}

// --- what is painted on what ----------------------------------------------
// `on` lists the surfaces this ink appears over; the WORST one decides, so a
// token that is readable on a card but not on the page still gets corrected.
const PAIRS = [
  { ink: '--text', on: ['--surface', '--bg'], min: 4.5 },
  { ink: '--text-muted', on: ['--surface', '--bg'], min: 4.5 },
  { ink: '--text-faint', on: ['--surface', '--bg'], min: 4.5 },
  { ink: '--success', on: ['--success-soft', '--surface'], min: 4.5 },
  { ink: '--danger', on: ['--danger-soft', '--surface'], min: 4.5 },
  { ink: '--warning', on: ['--warning-soft', '--surface'], min: 4.5 },
  { ink: '--info', on: ['--info-soft', '--surface'], min: 4.5 },
  // The mode-adjusted brand, NOT the venue's raw colour: dark mode lightens
  // --brand (color-mix with white) while --on-brand stayed pure white, which is
  // exactly how a primary button became white-on-light.
  { ink: '--on-brand', on: ['--brand'], min: 4.5 },
  { ink: '--on-accent', on: ['--accent'], min: 4.5 },
]

// Tokens we set last run, so a theme change starts from the stylesheet's own
// values instead of compounding corrections on top of corrections.
let applied = []

export function guardContrast() {
  if (typeof document === 'undefined' || !document.body) return null
  const root = document.documentElement
  try {
    for (const name of applied) root.style.removeProperty(name)
    applied = []

    const cs = getComputedStyle(root)
    const page = resolve(cs.getPropertyValue('--bg').trim() || '#ffffff') || WHITE
    const pageOpaque = page.a >= 0.999 ? page : over(page, WHITE)
    const fixed = []

    for (const pair of PAIRS) {
      const inkRaw = resolve(cs.getPropertyValue(pair.ink).trim())
      if (!inkRaw) continue
      let worst = null
      for (const surfVar of pair.on) {
        const sRaw = resolve(cs.getPropertyValue(surfVar).trim())
        if (!sRaw) continue
        const surf = sRaw.a >= 0.999 ? sRaw : over(sRaw, pageOpaque)
        const ink = inkRaw.a >= 0.999 ? inkRaw : over(inkRaw, surf)
        const r = ratio(ink, surf)
        if (!worst || r < worst.r) worst = { r, surf, ink }
      }
      if (!worst || worst.r >= pair.min) continue
      const corrected = correct(worst.ink, worst.surf, pair.min)
      root.style.setProperty(pair.ink, hex(corrected))
      applied.push(pair.ink)
      fixed.push({ token: pair.ink, was: Number(worst.r.toFixed(2)), now: Number(ratio(corrected, worst.surf).toFixed(2)) })
    }
    return fixed
  } catch (_) { return null }
}

// Re-run whenever anything that can change a colour changes: theme, system
// theme, skin, venue custom theme, or an inline brand write from applyTheme().
export function initContrastGuard() {
  if (typeof document === 'undefined') return () => {}
  const run = () => guardContrast()
  run()
  const attrs = ['data-theme', 'data-systheme', 'data-sysvariant', 'data-custheme', 'data-skin', 'data-menuglass', 'style', 'class']
  const obs = new MutationObserver(() => {
    // The guard writes to <html> style itself — skip the self-triggered pass.
    if (guardBusy) return
    guardBusy = true
    requestAnimationFrame(() => { guardBusy = false; run() })
  })
  let guardBusy = false
  try {
    obs.observe(document.documentElement, { attributes: true, attributeFilter: attrs })
    if (document.body) obs.observe(document.body, { attributes: true, attributeFilter: attrs })
  } catch (_) { /* ignore */ }
  // Fonts/skins can land after first paint and repaint surfaces.
  setTimeout(run, 400)
  setTimeout(run, 1600)
  return () => { try { obs.disconnect() } catch (_) { /* ignore */ } }
}
