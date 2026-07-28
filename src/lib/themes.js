import { contrastRatio } from './contrast.js'
import { guardContrast } from './contrastGuard.js'

// Professional theme presets. Each sets the brand + accent colors that cascade
// through the whole UI (menu, admin, cashier). Base light/dark is neutral
// white/black; presets tint the accents. Tenants can also pick a custom color.

// THE DEFAULT IS FIRST, AND ONLY THE DEFAULT CHANGED.
//
// Every entry below `classic` is byte-for-byte what it always was. That is the
// whole safety argument: a venue already on «كبدي» keeps the exact colour it
// picked, because presets are matched by id and its id still resolves to the
// same two hex values. Nothing about a live venue moves.
//
// What DOES change is what a NEW venue starts on, and that was safe to change
// for a reason worth writing down: createTenant() in src/lib/db.js always
// persists themeColor/themeAccent/themePreset at creation, so no existing
// venue is relying on a fallback to know its own colour. The fallbacks in this
// file only ever fire when there is no venue at all.
//
// Deep slate over brass: a neutral that flatters food photography, carries any
// cuisine, and dates slowly. A default is worn by every venue that never opens
// the theme picker, so it has to be the least opinionated thing in the list —
// not the most characterful.
export const THEMES = [
  { id: 'classic', name: { ar: 'كلاسيكي', en: 'Classic' }, brand: '#1F2A37', accent: '#8A6A3F' },
  { id: 'maroon', name: { ar: 'كبدي', en: 'Maroon' }, brand: '#7c2d2d', accent: '#5c5c66' },
  { id: 'mono', name: { ar: 'أبيض وأسود', en: 'Mono' }, brand: '#171717', accent: '#525252' },
  { id: 'coffee', name: { ar: 'قهوة', en: 'Coffee' }, brand: '#8B5E3C', accent: '#6B8E5A' },
  { id: 'emerald', name: { ar: 'زمردي', en: 'Emerald' }, brand: '#138063', accent: '#C8A15A' },
  { id: 'royal', name: { ar: 'ملكي', en: 'Royal' }, brand: '#4338CA', accent: '#C0A062' },
  { id: 'rose', name: { ar: 'وردي', en: 'Rosé' }, brand: '#BE3A6B', accent: '#E0A050' },
  { id: 'ocean', name: { ar: 'محيط', en: 'Ocean' }, brand: '#0E7490', accent: '#3FB6A8' },
  { id: 'sunset', name: { ar: 'غروب', en: 'Sunset' }, brand: '#C2410C', accent: '#D8A24A' },
  { id: 'gold', name: { ar: 'ذهبي فاخر', en: 'Luxe Gold' }, brand: '#A77B22', accent: '#1F2937' },
]

export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0]
}

// Ink that stays readable ON a filled brand/accent surface. Every theme block in
// index.css hard-codes `--on-brand: #ffffff`, which is only right for a DARK
// brand: a venue on a light brand (sand, cream, gold, mint) got white text on a
// light fill — buttons, badges and pills that read as blank. Both candidates are
// scored against the real colour and the better one wins, so a venue can pick
// any brand and its primary buttons stay legible.
const INK_DARK = '#101114'
const INK_LIGHT = '#ffffff'
export function onColor(bg) {
  const cLight = contrastRatio(INK_LIGHT, bg)
  const cDark = contrastRatio(INK_DARK, bg)
  if (cLight == null || cDark == null) return INK_LIGHT
  return cDark > cLight ? INK_DARK : INK_LIGHT
}

// Apply brand/accent CSS variables at runtime (base values; CSS derives per mode).
export function applyTheme({ brand, accent } = {}) {
  const r = document.documentElement.style
  if (brand) {
    r.setProperty('--brand-base', brand)
    r.setProperty('--on-brand', onColor(brand))
  }
  if (accent) {
    r.setProperty('--accent-base', accent)
    r.setProperty('--on-accent', onColor(accent))
  }
  // Derived tokens are only half the story: the mode also re-mixes --brand and
  // every theme ships its own ink constants. The guard measures what is ACTUALLY
  // painted and repairs anything unreadable.
  guardContrast()
}

// The colours used when nothing has been chosen. Kept as one named constant so
// «the default» is a single fact rather than six copies of a hex value that
// drift apart. THEMES[0] is that default by construction.
export const DEFAULT_THEME = THEMES[0]

// Resolve the effective theme for a tenant (preset + optional custom override).
// A stored themeColor always wins, which is why changing the default above
// cannot reach a venue that has ever been through onboarding.
export function resolveTenantTheme(tenant) {
  if (!tenant) return { brand: DEFAULT_THEME.brand, accent: DEFAULT_THEME.accent }
  const preset = tenant.themePreset ? getTheme(tenant.themePreset) : null
  return {
    brand: tenant.themeColor || preset?.brand || DEFAULT_THEME.brand,
    accent: tenant.themeAccent || preset?.accent || DEFAULT_THEME.accent,
  }
}
