// Skins = full themes (colors + typography + shape + mode + layout). Tokens apply
// via CSS vars + data-attributes; `layout.menuLayout` swaps the menu structure.
// Each skin is fully overridable per-tenant (color/font/shape/layout) via
// tenant.skin.overrides — logic stays in MenuView, skins only change presentation.
import { applyTheme } from './themes.js'

// Professional Arabic + Latin font pairings (Google Fonts). Arabic-only display
// faces are paired with a readable body face.
const FONTS = {
  tajawal: { body: 'Tajawal', display: 'Tajawal', label: 'Tajawal', families: ['Tajawal:wght@400;500;700;800;900'] },
  cairo: { body: 'Cairo', display: 'Cairo', label: 'Cairo', families: ['Cairo:wght@400;500;600;700;900'] },
  ibm: { body: 'IBM Plex Sans Arabic', display: 'IBM Plex Sans Arabic', label: 'IBM Plex Arabic', families: ['IBM+Plex+Sans+Arabic:wght@400;500;600;700'] },
  readex: { body: 'Readex Pro', display: 'Readex Pro', label: 'Readex Pro', families: ['Readex+Pro:wght@300;400;500;600;700'] },
  almarai: { body: 'Almarai', display: 'Almarai', label: 'Almarai', families: ['Almarai:wght@300;400;700;800'] },
  messiri: { body: 'Tajawal', display: 'El Messiri', label: 'El Messiri', families: ['El+Messiri:wght@500;600;700', 'Tajawal:wght@400;500;700'] },
  amiri: { body: 'Tajawal', display: 'Amiri', label: 'Amiri', families: ['Amiri:wght@400;700', 'Tajawal:wght@400;500;700'] },
  reem: { body: 'Cairo', display: 'Reem Kufi', label: 'Reem Kufi', families: ['Reem+Kufi:wght@500;600;700', 'Cairo:wght@400;500;700'] },
  rubik: { body: 'Rubik', display: 'Rubik', label: 'Rubik', families: ['Rubik:wght@400;500;600;700;800'] },
  changa: { body: 'Tajawal', display: 'Changa', label: 'Changa', families: ['Changa:wght@500;600;700', 'Tajawal:wght@400;500;700'] },
}
export const fontLabel = (key) => (FONTS[key] || FONTS.tajawal).label
// css font stacks for a key — used by the SYSTEM font (back-office) mechanism
export const fontStacks = (key) => {
  const f = FONTS[key] || FONTS.tajawal
  return {
    body: `'${f.body}', system-ui, -apple-system, 'Segoe UI', sans-serif`,
    display: `'${f.display}', system-ui, -apple-system, 'Segoe UI', sans-serif`,
  }
}
export const FONT_OPTIONS = Object.entries(FONTS).map(([key, f]) => ({ key, label: f.label }))
export const SHAPE_OPTIONS = ['sharp', 'soft', 'round', 'pill']
export const LAYOUT_OPTIONS = ['list', 'minimal', 'cards', 'grid', 'gallery', 'bento', 'sidebar', 'catalog', 'plates', 'storefront', 'coffeelist', 'alternating', 'coffeepan', 'spotlight']
// Header (top app-bar) styles — [id, ar, en]. 'none' removes the header (floating toggles remain).
export const HEADER_STYLES = [
  ['classic', 'كلاسيكي', 'Classic'], ['glass', 'زجاجي', 'Glass'], ['transparent', 'شفاف', 'Transparent'],
  ['gradient', 'متدرّج', 'Gradient'], ['bordered', 'محدّد', 'Bordered'], ['minimal', 'مصغّر', 'Minimal'],
  ['large', 'كبير', 'Large'], ['centered', 'متمركز', 'Centered'], ['float', 'عائم', 'Floating'],
  ['elevated', 'مرتفع', 'Elevated'], ['none', 'بدون هيدر', 'No header'],
]
// Item motion library — [id, ar, en]. Applied to every item card via data-motion.
export const MOTION_OPTIONS = [
  ['none', 'بدون', 'None'], ['fade-up', 'صعود', 'Fade up'], ['fade-down', 'نزول', 'Fade down'], ['fade-in', 'ظهور', 'Fade in'],
  ['zoom-in', 'تكبير', 'Zoom in'], ['zoom-out', 'تصغير', 'Zoom out'], ['pop', 'انبثاق', 'Pop'], ['slide-right', 'انزلاق ▶', 'Slide right'],
  ['slide-left', 'انزلاق ◀', 'Slide left'], ['flip-x', 'قلب أفقي', 'Flip X'], ['flip-y', 'قلب رأسي', 'Flip Y'], ['rotate-in', 'دوران', 'Rotate in'],
  ['blur-in', 'وضوح', 'Blur in'], ['bounce', 'ارتداد', 'Bounce'], ['swing', 'تأرجح', 'Swing'], ['rise', 'نهوض', 'Rise'],
  ['fold', 'طيّ', 'Fold'], ['tilt', 'إمالة', 'Tilt'], ['reveal', 'كشف', 'Reveal'], ['glow', 'توهّج', 'Glow'],
  ['float', 'طفو ∞', 'Float (loop)'], ['pulse', 'نبض ∞', 'Pulse (loop)'], ['sway', 'تمايل ∞', 'Sway (loop)'], ['breathe', 'تنفّس ∞', 'Breathe (loop)'],
]
// Animation speed presets and tap/press interactions.
export const MOTION_SPEEDS = [['normal', 'عادي', 'Normal'], ['slow', 'بطيء', 'Slow'], ['fast', 'سريع', 'Fast']]
export const MOTION_REPEATS = [['always', 'كل تمرير', 'Every scroll'], ['once', 'مرة واحدة', 'Once'], ['2', 'مرتان', 'Twice'], ['3', 'ثلاث مرات', '3 times']]
export const TAP_OPTIONS = [
  ['none', 'بدون', 'None'], ['press', 'ضغط', 'Press'], ['pop', 'انبثاق', 'Pop'], ['lift', 'رفع', 'Lift'], ['sink', 'غطس', 'Sink'],
  ['tilt', 'إمالة', 'Tilt'], ['rotate', 'دوران', 'Rotate'], ['zoom', 'تكبير', 'Zoom'], ['squeeze', 'عصر', 'Squeeze'], ['jelly', 'هلام', 'Jelly'],
  ['glow', 'توهّج', 'Glow'], ['ring', 'إطار', 'Ring'], ['brighten', 'إضاءة', 'Brighten'], ['dim', 'تعتيم', 'Dim'], ['push', 'دفع', 'Push'],
  ['skew', 'ميل', 'Skew'], ['spin', 'لفّة', 'Spin'], ['depth', 'عمق', 'Depth'], ['shrink', 'تصغير', 'Shrink'], ['raise', 'نهوض', 'Raise'],
]
// Bottom-nav styles — [id, ar, en]. 'none' removes the bottom nav.
export const BOTTOMNAV_STYLES = [
  ['standard', 'قياسي', 'Standard'], ['pill', 'حبّة', 'Pill'], ['floating', 'عائم', 'Floating'],
  ['glass', 'زجاجي', 'Glass'], ['labeled', 'بنصوص', 'Labeled'], ['icononly', 'أيقونات فقط', 'Icons only'],
  ['segmented', 'مقسّم', 'Segmented'], ['bordered', 'محدّد', 'Bordered'], ['elevated', 'مرتفع', 'Elevated'],
  ['minimal', 'مبسّط', 'Minimal'], ['none', 'بدون', 'None'],
]

// id, name, tier, tokens (brand/accent/font/shape/mode), layout (menu structure).
export const SKINS = [
  { id: 'classic', name: { ar: 'كلاسيكي', en: 'Classic' }, tier: 'menu', tokens: { brand: '#7c2d2d', accent: '#5c5c66', font: 'tajawal', shape: 'soft', mode: 'auto' }, layout: { menuLayout: 'list', hero: 'cover', nav: 'standard' } },
  { id: 'nova', name: { ar: 'نوفا', en: 'Nova' }, tier: 'pro', tokens: { brand: '#F97316', accent: '#111827', font: 'cairo', shape: 'round', mode: 'dark' }, layout: { menuLayout: 'cards', hero: 'cover', nav: 'standard' } },
  { id: 'editorial', name: { ar: 'تحرير', en: 'Editorial' }, tier: 'pro', tokens: { brand: '#141414', accent: '#B0895A', font: 'messiri', shape: 'sharp', mode: 'light' }, layout: { menuLayout: 'sidebar', hero: 'cover', nav: 'sidebar' } },
  { id: 'serene', name: { ar: 'صفاء', en: 'Serene' }, tier: 'pro', tokens: { brand: '#15803D', accent: '#0f172a', font: 'ibm', shape: 'soft', mode: 'light' }, layout: { menuLayout: 'minimal', hero: 'minimal', nav: 'pill' } },
  { id: 'vivid', name: { ar: 'حيوي', en: 'Vivid' }, tier: 'pro', tokens: { brand: '#E11D48', accent: '#4338CA', font: 'changa', shape: 'pill', mode: 'light' }, layout: { menuLayout: 'gallery', hero: 'headline', nav: 'pill' } },
  { id: 'bento', name: { ar: 'بنتو', en: 'Bento' }, tier: 'pro', tokens: { brand: '#F59E0B', accent: '#B91C1C', font: 'rubik', shape: 'round', mode: 'light' }, layout: { menuLayout: 'bento', hero: 'cover', nav: 'pill' } },
  { id: 'authority', name: { ar: 'رسمي', en: 'Authority' }, tier: 'pro', tokens: { brand: '#0F766E', accent: '#C8A15A', font: 'readex', shape: 'soft', mode: 'light' }, layout: { menuLayout: 'list', hero: 'cover', nav: 'standard' } },
  { id: 'luxe', name: { ar: 'فخامة', en: 'Luxe' }, tier: 'enterprise', tokens: { brand: '#C9A24B', accent: '#141110', font: 'messiri', shape: 'soft', mode: 'dark' }, layout: { menuLayout: 'cards', hero: 'cover', nav: 'standard' } },
  { id: 'mono', name: { ar: 'أحادي', en: 'Mono' }, tier: 'menu', tokens: { brand: '#171717', accent: '#525252', font: 'ibm', shape: 'sharp', mode: 'light' }, layout: { menuLayout: 'catalog', hero: 'minimal', nav: 'standard' } },
  { id: 'lagoon', name: { ar: 'لاجون', en: 'Lagoon' }, tier: 'pro', tokens: { brand: '#0E7490', accent: '#14B8A6', font: 'almarai', shape: 'round', mode: 'light' }, layout: { menuLayout: 'cards', hero: 'cover', nav: 'standard' } },
  // ---- expanded set ----
  { id: 'forest', name: { ar: 'غابة', en: 'Forest' }, tier: 'pro', tokens: { brand: '#0B6B3A', accent: '#1f2937', font: 'readex', shape: 'soft', mode: 'light' }, layout: { menuLayout: 'minimal', hero: 'cover', nav: 'tabs' } },
  { id: 'golden', name: { ar: 'ذهبي', en: 'Golden' }, tier: 'pro', tokens: { brand: '#F6B500', accent: '#C8102E', font: 'cairo', shape: 'round', mode: 'light' }, layout: { menuLayout: 'grid', hero: 'cover', nav: 'chips' } },
  { id: 'sunrise', name: { ar: 'شروق', en: 'Sunrise' }, tier: 'pro', tokens: { brand: '#FB7A1E', accent: '#1f2937', font: 'rubik', shape: 'round', mode: 'light' }, layout: { menuLayout: 'cards', hero: 'cover', nav: 'chips' } },
  { id: 'midnight', name: { ar: 'منتصف الليل', en: 'Midnight' }, tier: 'pro', tokens: { brand: '#22D3EE', accent: '#6366F1', font: 'ibm', shape: 'sharp', mode: 'dark' }, layout: { menuLayout: 'cards', hero: 'cover', nav: 'standard' } },
  { id: 'blossom', name: { ar: 'زهر', en: 'Blossom' }, tier: 'pro', tokens: { brand: '#DB2777', accent: '#7C3AED', font: 'almarai', shape: 'round', mode: 'light' }, layout: { menuLayout: 'gallery', hero: 'headline', nav: 'pill' } },
  { id: 'sand', name: { ar: 'رمل', en: 'Sand' }, tier: 'pro', tokens: { brand: '#7C5A3A', accent: '#3F2D20', font: 'amiri', shape: 'soft', mode: 'light' }, layout: { menuLayout: 'catalog', hero: 'cover', nav: 'standard' } },
  { id: 'cobalt', name: { ar: 'كوبالت', en: 'Cobalt' }, tier: 'pro', tokens: { brand: '#2563EB', accent: '#0EA5E9', font: 'readex', shape: 'soft', mode: 'light' }, layout: { menuLayout: 'list', hero: 'cover', nav: 'tabs' } },
  { id: 'grape', name: { ar: 'عنبي', en: 'Grape' }, tier: 'pro', tokens: { brand: '#7C3AED', accent: '#FACC15', font: 'changa', shape: 'pill', mode: 'dark' }, layout: { menuLayout: 'gallery', hero: 'headline', nav: 'pill' } },
  { id: 'crimson', name: { ar: 'قرمزي', en: 'Crimson' }, tier: 'pro', tokens: { brand: '#EF4444', accent: '#312E81', font: 'changa', shape: 'pill', mode: 'light' }, layout: { menuLayout: 'gallery', hero: 'headline', nav: 'pill' } },
  { id: 'slate', name: { ar: 'حجري', en: 'Slate' }, tier: 'menu', tokens: { brand: '#334155', accent: '#94A3B8', font: 'ibm', shape: 'sharp', mode: 'light' }, layout: { menuLayout: 'grid', hero: 'minimal', nav: 'chips' } },
  { id: 'tangerine', name: { ar: 'يوسفي', en: 'Tangerine' }, tier: 'pro', tokens: { brand: '#EA580C', accent: '#16A34A', font: 'rubik', shape: 'round', mode: 'light' }, layout: { menuLayout: 'bento', hero: 'cover', nav: 'pill' } },
  { id: 'noir', name: { ar: 'نوار', en: 'Noir' }, tier: 'enterprise', tokens: { brand: '#E5C07B', accent: '#0a0a0a', font: 'messiri', shape: 'sharp', mode: 'dark' }, layout: { menuLayout: 'sidebar', hero: 'cover', nav: 'sidebar' } },
  { id: 'platter', name: { ar: 'صحون', en: 'Platter' }, tier: 'pro', tokens: { brand: '#3F3A34', accent: '#9C6B3F', font: 'amiri', shape: 'soft', mode: 'light' }, layout: { menuLayout: 'plates', hero: 'minimal', nav: 'chips' } },
  // ---- brand-inspired flagship themes ----
  { id: 'goldenarches', name: { ar: 'الأقواس الذهبية', en: 'Golden Arches' }, tier: 'enterprise', tokens: { brand: '#DA291C', accent: '#FFC72C', font: 'cairo', shape: 'round', mode: 'light' }, layout: { menuLayout: 'grid', hero: 'cover', nav: 'segmented' } },
  { id: 'mermaid', name: { ar: 'القهوة الخضراء', en: 'Green Coffee' }, tier: 'enterprise', tokens: { brand: '#006241', accent: '#1E3932', font: 'readex', shape: 'round', mode: 'light' }, layout: { menuLayout: 'storefront', hero: 'cover', nav: 'tabs' } },
  { id: 'gourmet', name: { ar: 'ليلي فاخر', en: 'Noir Gourmet' }, tier: 'enterprise', tokens: { brand: '#15271F', accent: '#E0851B', font: 'messiri', shape: 'round', mode: 'light' }, layout: { menuLayout: 'storefront', hero: 'cover', nav: 'tabs' } },
  { id: 'cafelist', name: { ar: 'قائمة المقهى', en: 'Cafe List' }, tier: 'pro', tokens: { brand: '#1E6B52', accent: '#0d2e26', font: 'readex', shape: 'round', mode: 'light' }, layout: { menuLayout: 'coffeelist', hero: 'cover', nav: 'segmented' } },
  { id: 'delivery', name: { ar: 'توصيل', en: 'Delivery' }, tier: 'pro', tokens: { brand: '#E23744', accent: '#1f2937', font: 'rubik', shape: 'round', mode: 'light' }, layout: { menuLayout: 'list', hero: 'cover', nav: 'circles' } },
  { id: 'vintage', name: { ar: 'ورقي عتيق', en: 'Vintage Paper' }, tier: 'pro', tokens: { brand: '#6B4423', accent: '#A8743A', font: 'amiri', shape: 'pill', mode: 'light' }, layout: { menuLayout: 'coffeelist', hero: 'minimal', nav: 'chips' } },
  { id: 'parisien', name: { ar: 'مقهى باريسي فاخر', en: 'Luxe Parisian' }, tier: 'enterprise', tokens: { brand: '#1E3A2F', accent: '#D4AF37', font: 'messiri', shape: 'soft', mode: 'light' }, layout: { menuLayout: 'coffeelist', hero: 'cover', nav: 'standard' } },
  { id: 'tokyo', name: { ar: 'ماتشا وبساطة يابانية', en: 'Tokyo Minimalist' }, tier: 'pro', tokens: { brand: '#111111', accent: '#708238', font: 'readex', shape: 'sharp', mode: 'light' }, layout: { menuLayout: 'minimal', hero: 'minimal', nav: 'pill' } },
  { id: 'milan', name: { ar: 'إسبريسو ميلانو الكلاسيكي', en: 'Milano Espresso' }, tier: 'enterprise', tokens: { brand: '#5C0612', accent: '#B38B4B', font: 'amiri', shape: 'soft', mode: 'light' }, layout: { menuLayout: 'plates', hero: 'cover', nav: 'standard' } },
  { id: 'sajfish', name: { ar: 'صاج وصيد بلدي', en: 'Saj Al-Samak' }, tier: 'pro', tokens: { brand: '#2B1B17', accent: '#DAA520', font: 'messiri', shape: 'soft', mode: 'light' }, layout: { menuLayout: 'plates', hero: 'cover', nav: 'segmented' } },
  { id: 'rusticcard', name: { ar: 'ورق عتيق ورستك', en: 'Rustic Parchment' }, tier: 'pro', tokens: { brand: '#4A2C2A', accent: '#D4AF37', font: 'amiri', shape: 'sharp', mode: 'light' }, layout: { menuLayout: 'catalog', hero: 'minimal', nav: 'chips' } },
  { id: 'dajajmashwi', name: { ar: 'مشويات ليلي فاخر', en: 'Midnight Grill' }, tier: 'enterprise', tokens: { brand: '#0A1310', accent: '#E76F51', font: 'cairo', shape: 'round', mode: 'dark' }, layout: { menuLayout: 'storefront', hero: 'cover', nav: 'tabs' } },
  { id: 'royalplate', name: { ar: 'روايال بلايت الملكي', en: 'Royal Plate' }, tier: 'enterprise', tokens: { brand: '#111E2E', accent: '#fcda9a', font: 'messiri', shape: 'soft', mode: 'dark' }, layout: { menuLayout: 'sidebar', hero: 'cover', nav: 'sidebar' } },
  { id: 'bubbletea', name: { ar: 'بوب بابل تي الحيوي', en: 'Vibrant Bubble Tea' }, tier: 'pro', tokens: { brand: '#FF4757', accent: '#FFEE00', font: 'changa', shape: 'pill', mode: 'light' }, layout: { menuLayout: 'gallery', hero: 'headline', nav: 'pill' } },
  { id: 'grillplatter', name: { ar: 'مشاوي تبادلية', en: 'Alternating Grill' }, tier: 'pro', tokens: { brand: '#C8102E', accent: '#1A1A1A', font: 'tajawal', shape: 'round', mode: 'light' }, layout: { menuLayout: 'alternating', hero: 'cover', nav: 'standard' } },
  { id: 'coffeepan', name: { ar: 'كوفي بان المتميز', en: 'Coffeepan Premium' }, tier: 'enterprise', tokens: { brand: '#C48443', accent: '#131F22', font: 'readex', shape: 'round', mode: 'dark' }, layout: { menuLayout: 'coffeepan', hero: 'cover', nav: 'standard' } },
  // ---- immersive full-screen "spotlight": one product per view, big transparent
  // image, scroll-snap between products, direct add-to-cart. Warm coffee brand. ----
  { id: 'spotlight', name: { ar: 'واجهة العرض', en: 'Spotlight' }, tier: 'pro', tokens: { brand: '#7c2d2d', accent: '#C9A24B', font: 'messiri', shape: 'round', mode: 'auto' }, layout: { menuLayout: 'spotlight', hero: 'cover', nav: 'chips' } },
]

export function getSkin(id) { return SKINS.find((s) => s.id === id) || SKINS[0] }

// Per-skin default header + bottom-nav chrome (so each theme feels distinct).
// Overridable per-tenant via overrides.header / overrides.bottomNav.
const CHROME = {
  classic: { header: 'classic', bottomNav: 'standard' },
  nova: { header: 'glass', bottomNav: 'floating' },
  editorial: { header: 'minimal', bottomNav: 'minimal' },
  serene: { header: 'transparent', bottomNav: 'pill' },
  vivid: { header: 'gradient', bottomNav: 'pill' },
  bento: { header: 'elevated', bottomNav: 'floating' },
  authority: { header: 'bordered', bottomNav: 'standard' },
  luxe: { header: 'glass', bottomNav: 'glass' },
  mono: { header: 'bordered', bottomNav: 'labeled' },
  lagoon: { header: 'glass', bottomNav: 'floating' },
  forest: { header: 'transparent', bottomNav: 'pill' },
  golden: { header: 'gradient', bottomNav: 'segmented' },
  sunrise: { header: 'large', bottomNav: 'floating' },
  midnight: { header: 'glass', bottomNav: 'glass' },
  blossom: { header: 'gradient', bottomNav: 'pill' },
  sand: { header: 'centered', bottomNav: 'labeled' },
  cobalt: { header: 'classic', bottomNav: 'segmented' },
  grape: { header: 'glass', bottomNav: 'glass' },
  crimson: { header: 'gradient', bottomNav: 'pill' },
  slate: { header: 'minimal', bottomNav: 'icononly' },
  tangerine: { header: 'elevated', bottomNav: 'floating' },
  noir: { header: 'glass', bottomNav: 'glass' },
  platter: { header: 'float', bottomNav: 'floating' },
  goldenarches: { header: 'gradient', bottomNav: 'segmented' },
  mermaid: { header: 'gradient', bottomNav: 'glass' },
  gourmet: { header: 'gradient', bottomNav: 'glass' },
  cafelist: { header: 'minimal', bottomNav: 'labeled' },
  delivery: { header: 'glass', bottomNav: 'floating' },
  vintage: { header: 'bordered', bottomNav: 'labeled' },
  parisien: { header: 'glass', bottomNav: 'glass' },
  tokyo: { header: 'minimal', bottomNav: 'minimal' },
  milan: { header: 'classic', bottomNav: 'standard' },
  sajfish: { header: 'classic', bottomNav: 'standard' },
  rusticcard: { header: 'bordered', bottomNav: 'labeled' },
  dajajmashwi: { header: 'glass', bottomNav: 'glass' },
  royalplate: { header: 'glass', bottomNav: 'glass' },
  bubbletea: { header: 'gradient', bottomNav: 'pill' },
  grillplatter: { header: 'classic', bottomNav: 'standard' },
  coffeepan: { header: 'glass', bottomNav: 'floating' },
  spotlight: { header: 'transparent', bottomNav: 'floating' },
}

// Resolve the effective skin for a tenant + surface. Per-surface overrides win,
// then the tenant-wide skin, then the default. Per-skin `overrides` and the
// legacy custom colors further override the skin tokens & layout.
export function resolveSkin(tenant, surface) {
  const conf = (surface && tenant?.surfaceThemes?.[surface]) || tenant?.skin || {}
  const skin = getSkin(conf.skinId)
  const ov = conf.overrides || {}
  const chrome = CHROME[skin.id] || {}
  return {
    id: skin.id,
    hidden: ov.hidden || [], // element keys the venue chose to hide (events, search, …)
    motion: ov.motion || 'fade-up', // item entrance/idle animation
    motionSpeed: ov.motionSpeed || 'normal',
    motionRepeat: ov.motionRepeat || 'always', // how many times the motion replays on scroll
    tap: ov.tap || 'press', // touch/press interaction on cards
    detailLayout: ov.detailLayout || '',
    layout: {
      ...skin.layout,
      menuLayout: ov.menuLayout || skin.layout.menuLayout,
      nav: ov.nav || skin.layout.nav,
      header: ov.header || chrome.header || 'classic',
      bottomNav: ov.bottomNav || chrome.bottomNav || 'standard',
    },
    brand: ov.brand || tenant?.themeColor || skin.tokens.brand,
    accent: ov.accent || tenant?.themeAccent || skin.tokens.accent,
    font: ov.font || skin.tokens.font,
    shape: ov.shape || skin.tokens.shape,
    mode: ov.mode || skin.tokens.mode,
    itemImageStyle: ov.itemImageStyle || '',
    spotImageSize: ov.spotImageSize || 'md', // spotlight product-image size (md|lg|xl)
  }
}

const loaded = new Set()
export function loadFont(key) {
  const f = FONTS[key]
  if (!f || loaded.has(key) || typeof document === 'undefined') return
  loaded.add(key)
  const href = `https://fonts.googleapis.com/css2?${f.families.map((x) => `family=${x}`).join('&')}&display=swap`
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

// Apply a resolved skin's tokens to the document. `applyMode` controls whether
// the skin's light/dark mode overrides the user toggle (true for the menu).
export function applySkin(resolved, { applyMode = true } = {}) {
  if (typeof document === 'undefined' || !resolved) return
  const r = document.documentElement
  applyTheme({ brand: resolved.brand, accent: resolved.accent })
  loadFont(resolved.font)
  const f = FONTS[resolved.font] || FONTS.tajawal
  r.style.setProperty('--font-body', `'${f.body}', system-ui, -apple-system, 'Segoe UI', sans-serif`)
  r.style.setProperty('--font-display', `'${f.display}', system-ui, -apple-system, 'Segoe UI', sans-serif`)
  r.setAttribute('data-shape', resolved.shape || 'soft')
  r.setAttribute('data-skin', resolved.id || 'classic') // hook for brand-specific CSS (e.g. Starbucks/McDonald's)
  if (applyMode && resolved.mode && resolved.mode !== 'auto') r.setAttribute('data-theme', resolved.mode)
}

// Per-element typography overrides (color + size) → CSS variables. Empty = inherit theme.
export const TYPO_KEYS = ['header', 'hero', 'desc', 'item', 'price']
export function applyTypography(tenant) {
  if (typeof document === 'undefined') return
  const r = document.documentElement
  const typo = tenant?.typo || {}
  TYPO_KEYS.forEach((k) => {
    const v = typo[k] || {}
    r.style.setProperty(`--typo-${k}-color`, v.color || '')
    r.style.setProperty(`--typo-${k}-size`, v.size ? `${Number(v.size)}px` : '')
  })
}
