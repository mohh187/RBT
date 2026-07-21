// Dish composition — the ONE contract for how a single dish is composed
// visually: its backdrop, the photo on top of it, the light effect over it, and
// how it arrives on screen.
//
// WHY THIS FILE EXISTS
// The pieces already existed but were scattered across the item document and
// half-honoured by the themes: `bgUrl`/`bgOpacity` were read by one layout,
// `imageScale` by another, `effect` by a third, and the editorial theme ignored
// most of them. Worse, the admin UI and the renderer were free to disagree about
// what a field meant. This module is the single source of truth both sides
// import, so a control in the editor and the pixel it produces cannot drift.
//
// PURE ON PURPOSE: no React, no CSS import. The admin picker builds its options
// from these catalogues; the renderer turns the same values into style objects.
//
// EVERY FIELD IS OPTIONAL. An item that sets nothing composes exactly as before.

// ---------------------------------------------------------------- catalogues --

// Photoshop-style blending. Only modes browsers implement natively are offered —
// a mode that silently no-ops would be a lie in the picker.
export const BLEND_MODES = [
  { id: 'normal', ar: 'عادي', en: 'Normal' },
  { id: 'multiply', ar: 'تعتيم (Multiply)', en: 'Multiply' },
  { id: 'screen', ar: 'تفتيح (Screen)', en: 'Screen' },
  { id: 'overlay', ar: 'تراكب (Overlay)', en: 'Overlay' },
  { id: 'soft-light', ar: 'ضوء ناعم', en: 'Soft light' },
  { id: 'hard-light', ar: 'ضوء قوي', en: 'Hard light' },
  { id: 'color-dodge', ar: 'تفتيح لوني', en: 'Color dodge' },
  { id: 'color-burn', ar: 'حرق لوني', en: 'Color burn' },
  { id: 'darken', ar: 'أغمق', en: 'Darken' },
  { id: 'lighten', ar: 'أفتح', en: 'Lighten' },
  { id: 'luminosity', ar: 'إضاءة', en: 'Luminosity' },
  { id: 'saturation', ar: 'تشبّع', en: 'Saturation' },
]
export const BLEND_IDS = BLEND_MODES.map((b) => b.id)

// Filter presets. `css` is a complete CSS filter list; the picker shows the
// Arabic label, the renderer uses the string verbatim.
export const FILTERS = [
  { id: '', ar: 'بدون', en: 'None', css: '' },
  { id: 'warm', ar: 'دافئ', en: 'Warm', css: 'saturate(1.18) sepia(.12) brightness(1.04)' },
  { id: 'rich', ar: 'غني', en: 'Rich', css: 'saturate(1.35) contrast(1.12)' },
  { id: 'crisp', ar: 'حاد', en: 'Crisp', css: 'contrast(1.22) brightness(1.03) saturate(1.1)' },
  { id: 'soft', ar: 'ناعم', en: 'Soft', css: 'contrast(.94) brightness(1.06) saturate(.96)' },
  { id: 'cool', ar: 'بارد', en: 'Cool', css: 'saturate(1.1) hue-rotate(-8deg) brightness(1.02)' },
  { id: 'vintage', ar: 'كلاسيكي', en: 'Vintage', css: 'sepia(.32) saturate(1.05) contrast(1.06)' },
  { id: 'mono', ar: 'أبيض وأسود', en: 'Mono', css: 'grayscale(1) contrast(1.08)' },
  { id: 'glow', ar: 'متوهّج', en: 'Glow', css: 'saturate(1.2) brightness(1.08) contrast(1.05)' },
]
export const filterCss = (id) => (FILTERS.find((f) => f.id === id) || FILTERS[0]).css

// How a dish ENTERS the screen. Transform/opacity only, so none of these can
// cause a layout reflow; all of them are disabled under prefers-reduced-motion
// by the stylesheet that implements them.
export const ANIMS = [
  { id: '', ar: 'افتراضي', en: 'Default' },
  { id: 'none', ar: 'بدون حركة', en: 'None' },
  { id: 'rise', ar: 'صعود', en: 'Rise' },
  { id: 'fade', ar: 'تلاشٍ', en: 'Fade in' },
  { id: 'zoom', ar: 'تقريب', en: 'Zoom in' },
  { id: 'drop', ar: 'سقوط', en: 'Drop' },
  { id: 'tilt', ar: 'ميلان', en: 'Tilt in' },
  { id: 'sweep', ar: 'انزلاق', en: 'Sweep' },
]
export const ANIM_IDS = ANIMS.map((a) => a.id)

// Live effects drawn OVER the dish. Ids must match components/ItemFx.jsx.
export const FX = [
  { id: '', ar: 'بدون', en: 'None' },
  { id: 'steam', ar: 'بخار', en: 'Steam' },
  { id: 'smoke', ar: 'دخان', en: 'Smoke' },
  { id: 'sparkle', ar: 'لمعان', en: 'Sparkle' },
  { id: 'bubbles', ar: 'فقاعات', en: 'Bubbles' },
  { id: 'frost', ar: 'صقيع', en: 'Frost' },
  { id: 'fire', ar: 'نار', en: 'Fire' },
]

// ------------------------------------------------------------------ helpers --

const num = (v, dflt, min, max) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, n))
}
const str = (v, allowed, dflt) => (allowed.includes(String(v || '')) ? String(v || '') : dflt)

// Clamp ranges are the contract the editor's sliders must use. They live here so
// the editor cannot offer a value the renderer would reject.
export const RANGE = {
  scale: { min: 0.4, max: 2.6, step: 0.05, dflt: 1 },
  offset: { min: -50, max: 50, step: 1, dflt: 0 },   // percent of the photo box
  rot: { min: -30, max: 30, step: 1, dflt: 0 },       // degrees
  blur: { min: 0, max: 24, step: 0.5, dflt: 0 },      // px
  opacity: { min: 0, max: 1, step: 0.05, dflt: 1 },
  bgOpacity: { min: 0, max: 1, step: 0.05, dflt: 0.5 },
  bgScale: { min: 0.5, max: 3, step: 0.05, dflt: 1 },
  shadowOffset: { min: -60, max: 60, step: 1, dflt: 0 },
  shadowBlur: { min: 0, max: 80, step: 1, dflt: 28 },
  shadowOpacity: { min: 0, max: 1, step: 0.05, dflt: 0.45 },
}
// NOTE — there is deliberately NO shadow "spread". The dish photo is a
// transparent cutout, so its shadow is drawn with `drop-shadow`, which follows
// the fish's actual silhouette rather than its bounding box. CSS `drop-shadow`
// has no spread term, and faking one by stacking passes only darkens the shadow
// instead of widening it. A slider that moves a stored number while changing
// nothing on screen is worse than no slider, so the control does not exist.
// Use blur and offset, which do exactly what they say.

/**
 * resolveComposition(item, { variant }) -> everything a renderer needs.
 *
 * variant 'list'  : the dish as it appears while browsing
 *         'stage' : the dish with its own screen after it is opened
 *
 * Size is deliberately SEPARATE per variant: the owner asked to control the
 * photo in the menu and in the opened item independently, and one number could
 * never satisfy both (a photo sized to sit in a list row is too small to carry a
 * full screen). `imageScale` remains the stage value for backwards compatibility
 * with every item already saved; `listScale` is the new list-only one.
 */
export function resolveComposition(item, options) {
  const it = item || {}
  const variant = (options && options.variant) === 'stage' ? 'stage' : 'list'

  // ---- backdrop -------------------------------------------------------------
  const bgUrl = String(it.bgUrl || '')
  const bg = bgUrl ? {
    url: bgUrl,
    kind: String(it.bgKind || 'image'),
    opacity: num(it.bgOpacity, RANGE.bgOpacity.dflt, 0, 1),
    pos: String(it.bgPos || 'center'),
    scale: num(it.bgScale, RANGE.bgScale.dflt, RANGE.bgScale.min, RANGE.bgScale.max),
    blend: str(it.bgBlend, BLEND_IDS, 'normal'),
    filter: filterCss(it.bgFilter),
  } : null

  // ---- the dish photo -------------------------------------------------------
  const scale = variant === 'stage'
    ? num(it.imageScale, RANGE.scale.dflt, RANGE.scale.min, RANGE.scale.max)
    : num(it.listScale != null ? it.listScale : it.imageScale, RANGE.scale.dflt, RANGE.scale.min, RANGE.scale.max)

  const img = {
    scale,
    x: num(variant === 'stage' ? it.imageX : (it.listX != null ? it.listX : it.imageX), 0, RANGE.offset.min, RANGE.offset.max),
    y: num(variant === 'stage' ? it.imageY : (it.listY != null ? it.listY : it.imageY), 0, RANGE.offset.min, RANGE.offset.max),
    rot: num(it.imageRot, 0, RANGE.rot.min, RANGE.rot.max),
    blend: str(it.imageBlend, BLEND_IDS, 'normal'),
    filter: filterCss(it.imageFilter),
    blur: num(it.imageBlur, 0, RANGE.blur.min, RANGE.blur.max),
  }

  // ---- the shadow the dish casts on its surface ------------------------------
  // Off unless asked for: an invented shadow under a photo that already contains
  // its own lighting looks wrong, and the owner must be the one who decides.
  const shadow = it.shadowOn ? {
    x: num(it.shadowX, RANGE.shadowOffset.dflt, RANGE.shadowOffset.min, RANGE.shadowOffset.max),
    y: num(it.shadowY, 14, RANGE.shadowOffset.min, RANGE.shadowOffset.max),
    blur: num(it.shadowBlur, RANGE.shadowBlur.dflt, RANGE.shadowBlur.min, RANGE.shadowBlur.max),
    opacity: num(it.shadowOpacity, RANGE.shadowOpacity.dflt, 0, 1),
    color: String(it.shadowColor || '#000000'),
  } : null

  return {
    bg,
    img,
    shadow,
    fx: String(it.effect || ''),
    anim: str(it.anim, ANIM_IDS, ''),
  }
}

/** Inline style for the backdrop layer. */
export function bgStyle(bg) {
  if (!bg) return null
  const s = { opacity: bg.opacity }
  // A VIDEO backdrop is played by a <video> element, not painted as a
  // background-image. Emitting a background-image for it would put the video's
  // URL where a picture is expected and paint nothing; the caller renders the
  // element and still gets opacity, blend and filter from here.
  if (bg.kind !== 'video') {
    s.backgroundImage = `url(${bg.url})`
    s.backgroundPosition = bg.pos
    s.backgroundSize = bg.scale === 1 ? 'cover' : `${Math.round(bg.scale * 100)}%`
    s.backgroundRepeat = 'no-repeat'
  }
  if (bg.blend && bg.blend !== 'normal') s.mixBlendMode = bg.blend
  if (bg.filter) s.filter = bg.filter
  return s
}

/**
 * Inline style for the dish photo. Translation is expressed in percent so it
 * scales with the box instead of drifting on a different screen size, and it is
 * folded into ONE transform so nothing here triggers layout.
 */
export function imgStyle(img, shadow) {
  if (!img) return null
  const t = []
  if (img.x || img.y) t.push(`translate(${img.x}%, ${img.y}%)`)
  if (img.scale !== 1) t.push(`scale(${img.scale})`)
  if (img.rot) t.push(`rotate(${img.rot}deg)`)
  const s = {}
  if (t.length) s.transform = t.join(' ')
  const filters = []
  if (img.filter) filters.push(img.filter)
  if (img.blur) filters.push(`blur(${img.blur}px)`)
  // drop-shadow, not box-shadow: the dish photo is a transparent cutout, so the
  // shadow must follow the FISH, not the rectangle it sits in.
  if (shadow) {
    const a = Math.round(shadow.opacity * 255).toString(16).padStart(2, '0')
    filters.push(`drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color}${a})`)
  }
  if (filters.length) s.filter = filters.join(' ')
  if (img.blend && img.blend !== 'normal') s.mixBlendMode = img.blend
  return s
}

/**
 * Inline style for a VIDEO backdrop. Same layer, but painted by a <video>
 * element rather than a background-image, so the size/position that bgStyle
 * expresses as background-size/position become object-fit and a transform.
 * Kept here rather than in one theme: every layout that supports a video
 * backdrop needs the identical mapping, and a second copy is how the two drift.
 */
export function bgVideoStyle(bg) {
  if (!bg) return null
  const s = { opacity: bg.opacity, objectFit: 'cover', objectPosition: bg.pos }
  if (bg.blend && bg.blend !== 'normal') s.mixBlendMode = bg.blend
  if (bg.filter) s.filter = bg.filter
  if (bg.scale !== 1) { s.transform = `scale(${bg.scale})`; s.transformOrigin = bg.pos }
  return s
}

/** True when the item has any composition worth rendering a backdrop layer for. */
export const hasBackdrop = (comp) => !!(comp && comp.bg)
