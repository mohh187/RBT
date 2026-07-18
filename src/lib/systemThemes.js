// Full back-office THEMES — like the diner-menu skins, but for the whole staff
// system (dashboard, cashier POS, kitchen, every admin screen). A theme changes
// the complete visual identity: palette, radii, shadows, buttons, cards, bars.
// Layout templates (systemTemplates.js) stay independent — a venue can mix a
// "noir" cashier theme with the "rail" KDS layout, exactly like menu skins.
//
// Applied as `data-systheme` on each shell (.admin-shell / .cashier-shell /
// .kds-shell / .pos-fullscreen), so per-section mixing works and nothing leaks
// into the diner menu. 'classic' = the original look (no attribute needed).
// Plan-gated with the same key as layout templates (Pro+).
import { useEffect, useState } from 'react'
import { planAllows } from './plans.js'
import { loadFont, fontStacks } from './skins.js'

export const SYSTEM_THEMES = [
  {
    id: 'classic',
    ar: 'الكلاسيكي', en: 'Classic',
    hintAr: 'المظهر الأصلي — نظيف ومحايد بلون هوية المنشأة',
    // picker swatches: [bg, surface, accent-hint]
    swatch: ['#fafafa', '#ffffff', '#7c2d2d'],
  },
  {
    id: 'noir',
    ar: 'نوار الليلي', en: 'Noir',
    hintAr: 'داكن فاخر بلمسات ذهبية — أزرار حبّة وقوائم عائمة وشريط تنقّل طافٍ، مريح للمناوبات الليلية',
    swatch: ['#0e0e11', '#17171c', '#e8b04b'],
  },
  {
    id: 'airy',
    ar: 'دافئ هادئ', en: 'Airy',
    hintAr: 'فاتح دافئ بزوايا كبيرة ومسافات رحبة وبطاقات عائمة بلا حدود — إحساس مقهى مريح',
    swatch: ['#faf6f2', '#ffffff', '#c2410c'],
  },
  {
    id: 'glass',
    ar: 'زجاجي', en: 'Glass',
    hintAr: 'شفافية وضبابية بنمط آبل — أسطح زجاجية وأزرار نقية على خلفية هادئة',
    swatch: ['#e9edf3', '#ffffff', '#5b7cfa'],
  },
  {
    id: 'glassdark',
    ar: 'زجاجي داكن', en: 'Glass Dark',
    hintAr: 'الزجاج المدخّن الليلي دائماً — بغض النظر عن وضع الفاتح/الداكن',
    swatch: ['#101318', '#1a1f29', '#7ea2ff'],
  },
  {
    id: 'aurora',
    ar: 'أورورا', en: 'Aurora',
    hintAr: 'زجاج فوق شفق ملوّن يتنفس ببطء خلف كل الأسطح',
    swatch: ['#e9ecfb', '#ffffff', '#8b5cf6'],
  },
  {
    id: 'sharp',
    ar: 'حاد عملي', en: 'Sharp',
    hintAr: 'مسطّح حاد بزوايا مربّعة وفواصل شعرية وكثافة أعلى — طابع أدوات احترافي',
    swatch: ['#f6f6f7', '#ffffff', '#111111'],
  },
  {
    id: 'neon',
    ar: 'نيون ليلي', en: 'Neon',
    hintAr: 'ليلي عميق بحدود سماوية وخط توهّج تحت الاختيار — للكوفيهات الشبابية',
    swatch: ['#0b0e14', '#131824', '#22d3ee'],
  },
  {
    id: 'paper',
    ar: 'ورقي طباعي', en: 'Paper',
    hintAr: 'ورق دافئ بفواصل منقّطة وأزرار كالأختام الحبرية — طابع مطبوعات',
    swatch: ['#f7f4ee', '#fffdf8', '#4a4238'],
  },
  {
    id: 'wood',
    ar: 'خشبي دافئ', en: 'Wood',
    hintAr: 'أسطح كريمية بإطارات مزدوجة وتدرّجات دافئة — للمقاهي التراثية',
    swatch: ['#efe3d3', '#faf3e8', '#8a5a2b'],
  },
]

// glassdark/aurora are VARIANTS of the glass CSS (same data-systheme='glass'
// attribute, so the whole liquid system applies) — the variant itself rides on
// body attributes set by useSystemThemeBody (dark tokens / aurora backdrop).
const GLASS_VARIANTS = { glassdark: 'dark', aurora: 'aurora' }
const attrFor = (id) => (id === 'classic' ? undefined : GLASS_VARIANTS[id] ? 'glass' : id)

// Custom venue theme (THEMES_HUB #21/#22): a saved copy of a base theme with
// venue-edited core tokens {bg, surface, text, border, brand}. It renders as
// the base's attribute + --cust-* vars inline on <body>; a CSS rule under
// body[data-custheme] re-points the core tokens at them. All five tokens must
// be present (the editor always saves the full set) — a partial set would
// leave var(--cust-*) dangling and break every token consumer.
export const CUSTOM_THEME_ID = 'custom'
export const CUSTOM_TOKEN_KEYS = ['bg', 'surface', 'text', 'border', 'brand']
export function customThemeValid(tenant) {
  const c = tenant?.customTheme
  return !!(c && SYSTEM_THEMES.some((t) => t.id === c.base) && CUSTOM_TOKEN_KEYS.every((k) => c.tokens?.[k]))
}
const resolveId = (id, tenant) => (id === CUSTOM_THEME_ID ? (customThemeValid(tenant) ? tenant.customTheme.base : DEFAULT_THEME) : id)

// Sections that can carry their own theme override (mix & match).
export const THEMEABLE_SECTIONS = [
  { id: 'admin', ar: 'لوحة الإدارة', en: 'Admin' },
  { id: 'cashier', ar: 'الكاشير', en: 'Cashier' },
  { id: 'kds', ar: 'المطبخ', en: 'Kitchen' },
]

const validTheme = (id, tenant) => SYSTEM_THEMES.some((t) => t.id === id) || (id === 'custom' && customThemeValid(tenant))

// THEMES_HUB #25: time-of-day schedule (tenant.themeSchedule {enabled, dayTheme,
// nightTheme, dayStart 'HH:MM', nightStart 'HH:MM'}). It replaces the GLOBAL
// choice inside its window; explicit per-section overrides still win.
function scheduledTheme(tenant) {
  const s = tenant?.themeSchedule
  if (!s?.enabled) return null
  const now = new Date()
  const cur = now.getHours() * 60 + now.getMinutes()
  const parse = (t, dflt) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : dflt }
  const dayAt = parse(s.dayStart, 7 * 60)
  const nightAt = parse(s.nightStart, 19 * 60)
  const isDay = dayAt <= nightAt ? (cur >= dayAt && cur < nightAt) : (cur >= dayAt || cur < nightAt)
  const id = isDay ? s.dayTheme : s.nightTheme
  return validTheme(id, tenant) ? id : null
}

// Effective theme for a section: per-section override → global choice → default.
// DEFAULT = 'glass' (Apple Liquid-Glass) — the platform's signature identity;
// 'classic' stays selectable for the original flat look. Free plans get glass.
const DEFAULT_THEME = 'glass'
export function sectionSystemTheme(tenant, section) {
  if (!planAllows(tenant, 'systemTemplates')) return DEFAULT_THEME
  const per = tenant?.systemThemeBy?.[section]
  if (validTheme(per, tenant)) return per
  const sched = scheduledTheme(tenant)
  if (sched) return sched
  const global = tenant?.systemTheme
  return validTheme(global, tenant) ? global : DEFAULT_THEME
}

// Attribute value for a shell (undefined keeps the DOM clean for classic).
export function systemThemeAttr(tenant, section) {
  return attrFor(resolveId(sectionSystemTheme(tenant, section), tenant))
}

// Venue-tunable Liquid-Glass intensity (tenant.glassFx) → inline CSS vars.
// Spread onto every shell's style (and the body via useSystemThemeBody) so
// cards, buttons, bars — literally everything — obeys the sliders.
export function glassVars(tenant, scope) {
  // per-scope override (tenant.glassFxBy.cashier / .kds / .menu …) inherits the global values
  const g = { ...(tenant?.glassFx || {}), ...((scope && tenant?.glassFxBy?.[scope]) || {}) }
  const v = {}
  if (g.alpha != null) v['--glass-alpha'] = String(g.alpha)
  if (g.blur != null) v['--glass-blur'] = `${g.blur}px`
  if (g.sat != null) v['--glass-sat'] = String(g.sat)
  return v
}

// Selection color (tenant.selColor → --sel) + venue button style
// (tenant.btnFx {kind:'gradient', c1, c2, angle, glow, glowColor, radius}) —
// applied to a carrier node (body for the staff system, the menu portal root
// for the diner menu) so active pills and every primary CTA follow the venue.
const BTN_VARS = ['--btn-g1', '--btn-g2', '--btn-angle', '--btn-glow', '--btn-glowc', '--btn-radius']
export function applyUiFx(node, tenant) {
  if (!node) return
  if (tenant?.selColor) node.style.setProperty('--sel', tenant.selColor)
  else node.style.removeProperty('--sel')
  const b = tenant?.btnFx
  const kind = b?.kind === 'gradient' && b.c1 ? 'gradient' : b?.kind === 'ghost' ? 'ghost' : null
  if (kind) {
    node.setAttribute('data-btnfx', kind)
    if (b.all) node.setAttribute('data-btnfx-all', 'true')
    else node.removeAttribute('data-btnfx-all')
    if (kind === 'gradient') {
      node.style.setProperty('--btn-g1', b.c1)
      node.style.setProperty('--btn-g2', b.c2 || b.c1)
      node.style.setProperty('--btn-angle', `${Number(b.angle) || 135}deg`)
      node.style.setProperty('--btn-glow', String(Math.min(1, Math.max(0, Number(b.glow) || 0))))
      node.style.setProperty('--btn-glowc', b.glowColor || b.c1)
    }
    if (b.radius != null && Number(b.radius) > 0) node.style.setProperty('--btn-radius', `${Number(b.radius)}px`)
    else node.style.removeProperty('--btn-radius')
  } else {
    node.removeAttribute('data-btnfx')
    node.removeAttribute('data-btnfx-all')
    BTN_VARS.forEach((k) => node.style.removeProperty(k))
  }
}
export function clearUiFx(node) {
  if (!node) return
  node.removeAttribute('data-btnfx')
  node.removeAttribute('data-btnfx-all')
  node.style.removeProperty('--sel')
  BTN_VARS.forEach((k) => node.style.removeProperty(k))
}

// Mirror the shell's theme onto <body> while the shell is mounted, so PORTALED
// overlays (sheets, toasts — rendered outside the shell) inherit it too.
// Inner shells with their own attribute still win locally (descendant scope).
export function useSystemThemeBody(tenant, section) {
  const id = sectionSystemTheme(tenant, section)
  // deps fingerprint: EVERYTHING this effect reads must be here, or changes
  // (e.g. switching the system background kind) silently stop applying live
  const fx = JSON.stringify([tenant?.glassFx || null, tenant?.glassFxBy || null, tenant?.customTheme || null, tenant?.appBg?.kind || null, tenant?.selColor || null, tenant?.btnFx || null, tenant?.systemFont || null, tenant?.themeSchedule || null])
  // schedule needs the clock: a minute tick re-renders the consumer so the
  // day/night switch happens live without a reload
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!tenant?.themeSchedule?.enabled) return undefined
    const iv = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(iv)
  }, [tenant?.themeSchedule?.enabled])
  useEffect(() => {
    const vars = glassVars(tenant, section)
    const base = resolveId(id, tenant)
    const attr = attrFor(base)
    if (attr) document.body.setAttribute('data-systheme', attr)
    else document.body.removeAttribute('data-systheme')
    // glass variants: glassdark forces the dark token set for the whole subtree;
    // aurora paints the living gradient layer behind transparent shells
    const variant = GLASS_VARIANTS[base]
    if (variant === 'dark') document.body.setAttribute('data-theme', 'dark')
    else document.body.removeAttribute('data-theme')
    if (variant === 'aurora') document.body.setAttribute('data-sysvariant', 'aurora')
    else document.body.removeAttribute('data-sysvariant')
    // custom theme: expose the edited tokens as --cust-* (CSS re-points core tokens)
    if (id === CUSTOM_THEME_ID && customThemeValid(tenant)) {
      document.body.setAttribute('data-custheme', 'true')
      CUSTOM_TOKEN_KEYS.forEach((k) => document.body.style.setProperty(`--cust-${k}`, tenant.customTheme.tokens[k]))
    } else {
      document.body.removeAttribute('data-custheme')
      CUSTOM_TOKEN_KEYS.forEach((k) => document.body.style.removeProperty(`--cust-${k}`))
    }
    Object.entries(vars).forEach(([k, val]) => document.body.style.setProperty(k, val))
    // refraction level (0 = off) → drives the SVG displacement filter choice
    const ripple = Number(tenant?.glassFx?.ripple) || 0
    if (ripple >= 1 && ripple <= 3) document.body.setAttribute('data-glass-ripple', String(ripple))
    else document.body.removeAttribute('data-glass-ripple')
    // system-wide ambient background active → shells go transparent
    const bgKind = tenant?.appBg?.kind
    if (bgKind && bgKind !== 'mesh') document.body.setAttribute('data-appbg', bgKind)
    else document.body.removeAttribute('data-appbg')
    // controllable selection color + venue button style (gradient/glow)
    applyUiFx(document.body, tenant)
    // SYSTEM font (plan idea #3): the whole back-office re-types from one pick.
    // Body-level vars beat the :root defaults for every shell + portal.
    if (tenant?.systemFont && tenant.systemFont !== 'tajawal') {
      loadFont(tenant.systemFont)
      const fs = fontStacks(tenant.systemFont)
      document.body.style.setProperty('--font-body', fs.body)
      document.body.style.setProperty('--font-display', fs.display)
    } else {
      document.body.style.removeProperty('--font-body')
      document.body.style.removeProperty('--font-display')
    }
    return () => {
      document.body.removeAttribute('data-systheme')
      document.body.removeAttribute('data-theme')
      document.body.removeAttribute('data-sysvariant')
      document.body.removeAttribute('data-custheme')
      document.body.removeAttribute('data-glass-ripple')
      document.body.removeAttribute('data-appbg')
      ;['--glass-alpha', '--glass-blur', '--glass-sat', '--font-body', '--font-display'].forEach((k) => document.body.style.removeProperty(k))
      CUSTOM_TOKEN_KEYS.forEach((k) => document.body.style.removeProperty(`--cust-${k}`))
      clearUiFx(document.body)
    }
  }, [id, fx]) // eslint-disable-line react-hooks/exhaustive-deps
}
