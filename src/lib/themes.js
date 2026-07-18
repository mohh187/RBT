// Professional theme presets. Each sets the brand + accent colors that cascade
// through the whole UI (menu, admin, cashier). Base light/dark is neutral
// white/black; presets tint the accents. Tenants can also pick a custom color.

export const THEMES = [
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

// Apply brand/accent CSS variables at runtime (base values; CSS derives per mode).
export function applyTheme({ brand, accent } = {}) {
  const r = document.documentElement.style
  if (brand) r.setProperty('--brand-base', brand)
  if (accent) r.setProperty('--accent-base', accent)
}

// Resolve the effective theme for a tenant (preset + optional custom override).
export function resolveTenantTheme(tenant) {
  if (!tenant) return { brand: '#7c2d2d', accent: '#5c5c66' }
  const preset = tenant.themePreset ? getTheme(tenant.themePreset) : null
  return {
    brand: tenant.themeColor || preset?.brand || '#7c2d2d',
    accent: tenant.themeAccent || preset?.accent || '#5c5c66',
  }
}
