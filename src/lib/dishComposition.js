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
  // The bounds are FREE-PLACEMENT wide on purpose («تحكم حر»): the owner seats
  // the plate on the table himself — off-centre, upside-down, hanging half out
  // of the box if that is the picture he wants. The old tight bounds (±50%,
  // ±30°, 2.6x) were the reason he could not put the dish exactly where he
  // pointed. Defaults are unchanged, so nothing moves for anyone else.
  scale: { min: 0.2, max: 4, step: 0.05, dflt: 1 },
  offset: { min: -100, max: 100, step: 0.5, dflt: 0 }, // percent of the photo box
  rot: { min: -180, max: 180, step: 1, dflt: 0 },      // degrees
  // perspective lean (rotateX): what lays a top-shot plate down onto a surface
  // instead of leaving it pasted upright against the wall.
  tilt: { min: -60, max: 60, step: 1, dflt: 0 },       // degrees
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

// ------------------------------------------------------------------ layers --
//
// REAL IMAGES, NOT DRAWINGS. The first attempt at decoration hand-authored
// garnish as inline SVG and materials as CSS gradients. That approach cannot
// reach photographic realism no matter how carefully it is drawn — a vector
// petal reads as a sticker, a gradient "marble" reads as a gradient. So the
// venue places its OWN cut-out photographs instead, and this is the model for
// one placed image.
//
// Every layer is independent: its own position, size, rotation, depth, blend,
// filter, motion and live effect. That is what makes a composition rather than
// a wallpaper.
export const LAYER_DEPTHS = [
  { id: 'behind', ar: 'خلف الطبق', en: 'Behind the dish' },
  { id: 'front', ar: 'أمام الطبق', en: 'In front of the dish' },
]

// How a placed element behaves once it has arrived. Idle motion is deliberately
// tiny — a prop that keeps moving reads as a web banner, not a photograph.
export const LAYER_MOTIONS = [
  { id: '', ar: 'ثابت', en: 'Still' },
  { id: 'float', ar: 'طفو خفيف', en: 'Gentle float' },
  { id: 'sway', ar: 'تمايل', en: 'Sway' },
  { id: 'spin', ar: 'دوران بطيء', en: 'Slow spin' },
  { id: 'pulse', ar: 'نبض خفيف', en: 'Soft pulse' },
]
export const LAYER_MOTION_IDS = LAYER_MOTIONS.map((m) => m.id)

export const LAYER_RANGE = {
  x: { min: 0, max: 100, step: 0.5, dflt: 50 },   // percent of the box, from the start edge
  y: { min: 0, max: 100, step: 0.5, dflt: 70 },
  w: { min: 2, max: 120, step: 0.5, dflt: 22 },   // width as percent of the box's SMALLER side
  rot: { min: -180, max: 180, step: 1, dflt: 0 },
  opacity: { min: 0, max: 1, step: 0.05, dflt: 1 },
  blur: { min: 0, max: 20, step: 0.5, dflt: 0 },
  delay: { min: 0, max: 2000, step: 50, dflt: 0 }, // ms before it arrives
}

/**
 * Normalise one placed layer. Returns null for anything unusable, so a bad row
 * in the document drops that element instead of breaking the dish.
 */
export function normalizeLayer(raw) {
  if (!raw || typeof raw !== 'object') return null
  const url = String(raw.url || '')
  if (!url) return null
  const R = LAYER_RANGE
  return {
    id: String(raw.id || url).slice(0, 80),
    url,
    x: num(raw.x, R.x.dflt, R.x.min, R.x.max),
    y: num(raw.y, R.y.dflt, R.y.min, R.y.max),
    w: num(raw.w, R.w.dflt, R.w.min, R.w.max),
    rot: num(raw.rot, R.rot.dflt, R.rot.min, R.rot.max),
    depth: raw.depth === 'front' ? 'front' : 'behind',
    opacity: num(raw.opacity, R.opacity.dflt, 0, 1),
    blend: str(raw.blend, BLEND_IDS, 'normal'),
    filter: filterCss(raw.filter),
    blur: num(raw.blur, 0, R.blur.min, R.blur.max),
    motion: str(raw.motion, LAYER_MOTION_IDS, ''),
    anim: str(raw.anim, ANIM_IDS, ''),
    delay: num(raw.delay, 0, R.delay.min, R.delay.max),
    flip: !!raw.flip,
  }
}

// `item.layersOff` is EDITOR-ONLY state and is deliberately not read here.
// Hiding an element cannot mean "leave it in `layers` with a flag", because this
// resolver draws anything carrying a url; a hidden element is therefore parked
// in `layersOff` with the index it came from, and the editor splices it back
// when it is shown again so paint order survives a hide/show. Renderers must
// ignore that field entirely.

/** All placed layers on an item, in paint order, split by depth. */
export function resolveLayers(item) {
  const raw = item && Array.isArray(item.layers) ? item.layers : []
  const all = raw.map(normalizeLayer).filter(Boolean).slice(0, 24)
  return { behind: all.filter((l) => l.depth === 'behind'), front: all.filter((l) => l.depth === 'front'), all }
}

/**
 * Inline style for one placed layer. Position is percent-based so a composition
 * holds its arrangement on any screen; width is a share of the box's SMALLER
 * side (cqmin) so an element keeps its visual weight on a wide panoramic photo
 * as well as a tall one — sizing by width alone is what made an earlier version
 * render garnish three times too large on this venue's own images.
 */
export function layerStyle(l) {
  if (!l) return null
  const t = [`translateY(-50%)`]
  if (l.rot) t.push(`rotate(${l.rot}deg)`)
  if (l.flip) t.push('scaleX(-1)')
  const s = {
    position: 'absolute',
    insetInlineStart: `${l.x}%`,
    // The HORIZONTAL half of the centring is a logical margin, never part of the
    // transform. `transform` is physical — its X axis runs left-to-right no
    // matter the document direction — while `inset-inline-start` resolves to
    // `right` under dir="rtl". Pairing the two put every placed element a full
    // element-width away from where the venue dropped it on the Arabic menu,
    // which is to say always. The grab handles in the item editor mirror this
    // exactly; the two must move together or the handle stops matching the art.
    marginInlineStart: `calc(${l.w}cqmin / -2)`,
    top: `${l.y}%`,
    width: `${l.w}cqmin`,
    transform: t.join(' '),
    opacity: l.opacity,
    pointerEvents: 'none',
  }
  const filters = []
  if (l.filter) filters.push(l.filter)
  if (l.blur) filters.push(`blur(${l.blur}px)`)
  if (filters.length) s.filter = filters.join(' ')
  if (l.blend && l.blend !== 'normal') s.mixBlendMode = l.blend
  if (l.delay) s.animationDelay = `${l.delay}ms`
  return s
}

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
    tilt: num(variant === 'stage' ? it.imageTilt : (it.listTilt != null ? it.listTilt : it.imageTilt), 0, RANGE.tilt.min, RANGE.tilt.max),
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
    layers: resolveLayers(it),
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
  // perspective() must LEAD the list — it only applies to the functions after
  // it, so appended at the end it would be a silent no-op.
  if (img.tilt) t.push('perspective(900px)')
  if (img.x || img.y) t.push(`translate(${img.x}%, ${img.y}%)`)
  if (img.scale !== 1) t.push(`scale(${img.scale})`)
  if (img.rot) t.push(`rotate(${img.rot}deg)`)
  if (img.tilt) t.push(`rotateX(${img.tilt}deg)`)
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

// ------------------------------------------------------- the room backdrop --
//
// The wall the whole menu is set against. It was previously a single hard-coded
// brick tile with no controls at all; the venue could neither change its colour,
// its bond, its age, nor swap it for a photograph of its own room.

export const WALL_PATTERNS = [
  { id: 'none', ar: 'بدون جدار', en: 'No wall' },
  { id: 'running', ar: 'طوب عادي', en: 'Running bond' },
  { id: 'stack', ar: 'طوب مصفوف', en: 'Stack bond' },
  { id: 'herringbone', ar: 'طوب متعاكس', en: 'Herringbone' },
  { id: 'basket', ar: 'طوب متشابك', en: 'Basketweave' },
  { id: 'roman', ar: 'طوب روماني', en: 'Roman (long)' },
  { id: 'stone', ar: 'حجر', en: 'Stone' },
  { id: 'plaster', ar: 'بلاستر', en: 'Plaster' },
  { id: 'wood', ar: 'خشب', en: 'Wood panel' },
  { id: 'image', ar: 'صورتي', en: 'My own image' },
]
export const WALL_PATTERN_IDS = WALL_PATTERNS.map((w) => w.id)

// The finish is what makes brick read as REAL rather than as a flat pattern:
// age, chipping, sheen and a pointed mortar edge are the difference between a
// wall and a checkerboard.
export const WALL_FINISHES = [
  { id: 'clean', ar: 'نظيف', en: 'Clean' },
  { id: 'aged', ar: 'قديم', en: 'Aged' },
  { id: 'cracked', ar: 'متشقّق', en: 'Cracked' },
  { id: 'glossy', ar: 'لامع', en: 'Glossy' },
  { id: 'rough', ar: 'خشن', en: 'Rough' },
  { id: 'whitewash', ar: 'مطليّ بالأبيض', en: 'Whitewashed' },
]
export const WALL_FINISH_IDS = WALL_FINISHES.map((f) => f.id)

export const WALL_RANGE = {
  scale: { min: 0.4, max: 3, step: 0.05, dflt: 1 },
  opacity: { min: 0, max: 1, step: 0.05, dflt: 1 },
  blur: { min: 0, max: 30, step: 0.5, dflt: 0 },
  mortar: { min: 0, max: 1, step: 0.05, dflt: 0.5 },  // joint contrast
  grout: { min: 1, max: 8, step: 0.5, dflt: 3 },      // joint width, px at scale 1
  // The readability panel behind the words. It used to be a hard-coded solid
  // slab with a 16px-spread shadow — the "black box with a halo" the owner
  // rejected. Now it is a dial: 1 keeps text bullet-proof on a busy photo wall,
  // 0 removes the panel entirely and trusts the wall to be calm enough.
  panel: { min: 0, max: 1, step: 0.05, dflt: 0.65 },
  // The melt at the FOOT of every dish photo. It was the last hard-coded dark
  // smear left on the room — a translucent canvas-coloured band the owner kept
  // reporting as «خط شفاف داكن» over his photo wall. Now it is his dial:
  // 1 melts the photo's base into the canvas as before, 0 draws nothing at all.
  vignette: { min: 0, max: 1, step: 0.05, dflt: 0.72 },
}

/**
 * The venue's wall. Reads off the TENANT document (it is one room, not one per
 * dish). Returns null when the venue turned it off, so a theme renders its own
 * plain canvas instead.
 */
export function resolveWall(tenant) {
  const t = (tenant && tenant.menuWall) || {}
  const pattern = str(t.pattern, WALL_PATTERN_IDS, 'none')
  if (pattern === 'none') return null
  const url = String(t.url || '')
  if (pattern === 'image' && !url) return null
  const R = WALL_RANGE
  return {
    pattern,
    url,
    finish: str(t.finish, WALL_FINISH_IDS, 'clean'),
    color: String(t.color || '#8a4a2c'),
    mortarColor: String(t.mortarColor || '#b9a893'),
    scale: num(t.scale, R.scale.dflt, R.scale.min, R.scale.max),
    opacity: num(t.opacity, R.opacity.dflt, 0, 1),
    blend: str(t.blend, BLEND_IDS, 'normal'),
    filter: filterCss(t.filter),
    blur: num(t.blur, 0, R.blur.min, R.blur.max),
    mortar: num(t.mortar, R.mortar.dflt, 0, 1),
    grout: num(t.grout, R.grout.dflt, R.grout.min, R.grout.max),
    tint: String(t.tint || ''),
    tintAmount: num(t.tintAmount, 0, 0, 1),
    panel: num(t.panel, R.panel.dflt, 0, 1),
    vignette: num(t.vignette, R.vignette.dflt, 0, 1),
    // Whether the menu HEADER is built from this same wall. It belongs here and
    // not on a key of its own because it has no colours of its own: the theme
    // takes this bond, this clay and this mortar, scales the unit down to the
    // bar and lays a scrim over it. Storing it apart would store half a decision.
    header: t.header === true,
  }
}

/** Inline style for the wall layer (the pattern itself is drawn by the theme). */
export function wallStyle(w) {
  if (!w) return null
  const s = { opacity: w.opacity }
  if (w.pattern === 'image' && w.url) {
    s.backgroundImage = `url(${w.url})`
    s.backgroundSize = w.scale === 1 ? 'cover' : `${Math.round(w.scale * 100)}%`
    s.backgroundPosition = 'center'
  }
  const filters = []
  if (w.filter) filters.push(w.filter)
  if (w.blur) filters.push(`blur(${w.blur}px)`)
  if (filters.length) s.filter = filters.join(' ')
  if (w.blend && w.blend !== 'normal') s.mixBlendMode = w.blend
  return s
}

// ---------------------------------------------------- how dishes are joined --
//
// The editorial theme gives each dish its own screen. Whether those screens read
// as ONE continuous room or as separate cards is a design decision that belongs
// to the venue, not to me: the first version hard-coded a fade to solid canvas
// at the bottom of every dish, which produced a black band between dishes that
// the venue never asked for and could not remove.

export const SECTION_MODES = [
  { id: 'continuous', ar: 'متصل بلا فواصل', en: 'One continuous room' },
  { id: 'gap', ar: 'مسافة بين الأصناف', en: 'Spaced apart' },
  { id: 'divider', ar: 'خط فاصل', en: 'Thin divider' },
  { id: 'card', ar: 'بطاقات منفصلة', en: 'Separate cards' },
]
export const SECTION_MODE_IDS = SECTION_MODES.map((s) => s.id)

export const SECTION_RANGE = {
  gap: { min: 0, max: 120, step: 2, dflt: 0 },        // px between dishes
  height: { min: 50, max: 100, step: 1, dflt: 92 },   // svh per dish
  fade: { min: 0, max: 1, step: 0.05, dflt: 0 },      // how much the room dims behind text
  radius: { min: 0, max: 40, step: 1, dflt: 0 },      // card corner, 'card' mode only
}

export function resolveSections(tenant) {
  const s = (tenant && tenant.menuSections) || {}
  const R = SECTION_RANGE
  return {
    mode: str(s.mode, SECTION_MODE_IDS, 'continuous'),
    gap: num(s.gap, R.gap.dflt, R.gap.min, R.gap.max),
    height: num(s.height, R.height.dflt, R.height.min, R.height.max),
    fade: num(s.fade, R.fade.dflt, 0, 1),
    radius: num(s.radius, R.radius.dflt, R.radius.min, R.radius.max),
    dividerColor: String(s.dividerColor || ''),
  }
}

// ------------------------------------------------------------- the table ----
//
// The owner's idea, and a good one: the dark panel that carries the dish's name,
// price and details is already a big rectangle directly under the photo — so make
// it the TABLE. The dish then stands ON something instead of floating above an
// anonymous black box, and the words sit on the table with it.
//
// The contract that matters: the dish's base must meet the table's top edge.
// `lift` is the only number that controls that relationship — how far the photo
// overlaps down onto the surface — so a venue can seat the plate exactly.

export const TABLE_KINDS = [
  { id: 'none', ar: 'بدون طاولة', en: 'No table' },
  { id: 'material', ar: 'خامة جاهزة', en: 'Built-in material' },
  { id: 'image', ar: 'صورتي', en: 'My own photo' },
]
export const TABLE_KIND_IDS = TABLE_KINDS.map((k) => k.id)

// Materials share ids with the dish-surface library so a venue that already
// picked a walnut table for its plates gets the same walnut here.
export const TABLE_MATERIALS = [
  { id: 'venueWalnut', ar: 'طاولة جوز داكنة', en: 'Dark walnut' },
  { id: 'warmWood', ar: 'خشب دافئ', en: 'Warm wood' },
  { id: 'brickLedge', ar: 'حافة طوب', en: 'Brick ledge' },
  { id: 'rattanMat', ar: 'حصيرة خوص', en: 'Woven rattan' },
  { id: 'darkMarble', ar: 'رخام داكن', en: 'Dark marble' },
  { id: 'brushedSteel', ar: 'ستيل مصقول', en: 'Brushed steel' },
  { id: 'slate', ar: 'حجر أردوازي', en: 'Slate' },
  { id: 'linen', ar: 'قماش كتّان', en: 'Linen' },
]
export const TABLE_MATERIAL_IDS = TABLE_MATERIALS.map((m) => m.id)

// The lip where the table's far edge catches the light. This is what sells it as
// a horizontal surface seen from a low angle rather than a flat coloured block.
export const TABLE_EDGES = [
  { id: 'lit', ar: 'حافة مضاءة', en: 'Lit edge' },
  { id: 'soft', ar: 'حافة ناعمة', en: 'Soft edge' },
  { id: 'sharp', ar: 'حافة حادّة', en: 'Sharp edge' },
  { id: 'none', ar: 'بدون حافة', en: 'No edge' },
]
export const TABLE_EDGE_IDS = TABLE_EDGES.map((e) => e.id)

export const TABLE_RANGE = {
  // how far the dish photo drops onto the surface, as a percent of the photo's
  // own height. This is the "the dish must sit exactly on it" dial.
  lift: { min: 0, max: 60, step: 0.5, dflt: 10 },
  opacity: { min: 0, max: 1, step: 0.05, dflt: 1 },
  shade: { min: 0, max: 1, step: 0.05, dflt: 0.35 }, // how far the surface darkens toward the front
  radius: { min: 0, max: 40, step: 1, dflt: 0 },
  blur: { min: 0, max: 20, step: 0.5, dflt: 0 },
  scale: { min: 0.5, max: 3, step: 0.05, dflt: 1 },  // image tables only
  contact: { min: 0, max: 1, step: 0.05, dflt: 0.5 }, // the shadow where dish meets table
  // FREE PLACEMENT («تحكم حر بالطاولة»). The table used to be bolted to the
  // details panel's own box; these four move and size it against that box, so
  // the venue slides it, widens it, shortens it — wherever the furniture goes.
  // All defaults are the bolted position, so nothing moves for a saved venue.
  x: { min: -60, max: 60, step: 0.5, dflt: 0 },   // percent of the panel box, physical
  y: { min: -60, max: 60, step: 0.5, dflt: 0 },
  w: { min: 40, max: 180, step: 1, dflt: 100 },   // percent of the bolted width
  h: { min: 30, max: 220, step: 1, dflt: 100 },
  // A flat darkening veil over the surface («تعتيم أكثر») — separate from shade,
  // which only darkens toward the front, and from tint, which recolours.
  dim: { min: 0, max: 0.85, step: 0.05, dflt: 0 },
  // How strongly the surface dissolves into the canvas where the words live.
  // 0.5 is exactly the old hard-coded behaviour; lower shows more material,
  // higher melts it away sooner. The venue owns its own readability trade-off,
  // the same way it owns the reading panel.
  melt: { min: 0, max: 1, step: 0.05, dflt: 0.5 },
}

// The keys a venue may override FOR THE OPENED-ITEM WINDOW alone
// (tenant.menuTable.stage = partial object). The dish window's panel is far
// taller than a list panel — variants, story, options — so the same numbers
// cannot fit both: the owner reported the table «لا تظهر بشكل مناسب عند فتح
// الصنف». Geometry and strength may differ per place; the material may not —
// it is one room with one table.
export const TABLE_STAGE_KEYS = ['x', 'y', 'w', 'h', 'lift', 'opacity', 'shade', 'dim', 'melt', 'contact', 'scale']

/**
 * The table under the dish details. Reads the TENANT document, because it is one
 * room; a venue that wants a different table per dish can still override with the
 * per-item surface library.
 */
export function resolveTable(tenant, options) {
  const base = (tenant && tenant.menuTable) || {}
  // The opened-item window may carry its own geometry (see TABLE_STAGE_KEYS).
  // Merged BEFORE clamping so an override obeys exactly the same bounds.
  const variant = options && options.variant === 'stage' ? 'stage' : 'list'
  let t = base
  if (variant === 'stage' && base.stage && typeof base.stage === 'object') {
    const over = {}
    TABLE_STAGE_KEYS.forEach((k) => { if (base.stage[k] != null) over[k] = base.stage[k] })
    t = { ...base, ...over }
  }
  let kind = str(t.kind, TABLE_KIND_IDS, 'none')
  if (kind === 'none') return null
  const url = String(t.url || '')
  // "My own photo" with no photo yet falls back to the chosen material instead
  // of disappearing: the live venue had kind:'image', url:'' with a fully tuned
  // slate table, and the menu silently rendered a bare black panel. A venue that
  // configured lift/shade/material has clearly decided to HAVE a table; the
  // missing upload must not undo that decision.
  if (kind === 'image' && !url) kind = 'material'
  const R = TABLE_RANGE
  return {
    kind,
    url,
    material: str(t.material, TABLE_MATERIAL_IDS, 'venueWalnut'),
    edge: str(t.edge, TABLE_EDGE_IDS, 'lit'),
    lift: num(t.lift, R.lift.dflt, R.lift.min, R.lift.max),
    opacity: num(t.opacity, R.opacity.dflt, 0, 1),
    shade: num(t.shade, R.shade.dflt, 0, 1),
    radius: num(t.radius, R.radius.dflt, R.radius.min, R.radius.max),
    blur: num(t.blur, 0, R.blur.min, R.blur.max),
    scale: num(t.scale, R.scale.dflt, R.scale.min, R.scale.max),
    contact: num(t.contact, R.contact.dflt, 0, 1),
    blend: str(t.blend, BLEND_IDS, 'normal'),
    filter: filterCss(t.filter),
    tint: String(t.tint || ''),
    tintAmount: num(t.tintAmount, 0, 0, 1),
    x: num(t.x, R.x.dflt, R.x.min, R.x.max),
    y: num(t.y, R.y.dflt, R.y.min, R.y.max),
    w: num(t.w, R.w.dflt, R.w.min, R.w.max),
    h: num(t.h, R.h.dflt, R.h.min, R.h.max),
    dim: num(t.dim, R.dim.dflt, 0, R.dim.max),
    melt: num(t.melt, R.melt.dflt, 0, 1),
  }
}

/**
 * The free-placement transform for the table box. Null while the table is in
 * its bolted position, so the untouched path stays byte-identical.
 * The origin is the TOP CENTRE: the top edge is where the dish sits, so height
 * grows DOWNWARD and the seat never drifts while the venue resizes. x/y are
 * physical on purpose — the dial is symmetric and the owner drags until the
 * furniture looks right; a logical flip would make the preview and the menu
 * agree and the two sliders feel reversed, which is worse.
 */
const n3 = (v) => Math.round(v * 1000) / 1000
export function tableFreeStyle(tb) {
  if (!tb) return null
  if (!tb.x && !tb.y && tb.w === 100 && tb.h === 100) return null
  const t = []
  if (tb.x || tb.y) t.push(`translate(${tb.x}%, ${tb.y}%)`)
  if (tb.w !== 100 || tb.h !== 100) t.push(`scale(${n3(tb.w / 100)}, ${n3(tb.h / 100)})`)
  return { transform: t.join(' '), transformOrigin: '50% 0%' }
}

/**
 * Where the surface starts dissolving into the canvas, as the two stops of the
 * melt gradient. ONE function for the theme and the settings preview — the
 * bright-material special case lived only in the theme before, so the preview
 * showed a linen table the menu would never draw.
 * `melt` slides both stops: 0.5 is exactly the old hard-coded pair, 0 pushes
 * the melt off the bottom (full material), 1 pulls it to the top (all canvas).
 */
export const TABLE_BRIGHT_IDS = ['linen', 'rattanMat']
export function tableMeltStops(tb) {
  if (!tb) return { a: 16, b: 52 }
  const bright = tb.kind === 'image' || TABLE_BRIGHT_IDS.includes(tb.material)
  const a0 = bright ? 6 : 16
  const b0 = bright ? 30 : Math.round(34 + tb.shade * 36)
  const shift = (0.5 - tb.melt) * 130
  const a = Math.max(0, Math.min(140, a0 + shift))
  const b = Math.max(a + 6, Math.min(190, b0 + shift))
  return { a: Math.round(a), b: Math.round(b) }
}

/** Inline style for the table panel itself. */
export function tableStyle(tb) {
  if (!tb) return null
  const s = { opacity: tb.opacity }
  if (tb.kind === 'image' && tb.url) {
    s.backgroundImage = `url(${tb.url})`
    s.backgroundSize = tb.scale === 1 ? 'cover' : `${Math.round(tb.scale * 100)}%`
    s.backgroundPosition = 'center'
    s.backgroundRepeat = 'no-repeat'
  }
  if (tb.radius) { s.borderStartStartRadius = `${tb.radius}px`; s.borderStartEndRadius = `${tb.radius}px` }
  const filters = []
  if (tb.filter) filters.push(tb.filter)
  if (tb.blur) filters.push(`blur(${tb.blur}px)`)
  if (filters.length) s.filter = filters.join(' ')
  if (tb.blend && tb.blend !== 'normal') s.mixBlendMode = tb.blend
  return s
}

/**
 * How far the dish photo must drop so its base meets the table. Returned as a
 * negative margin in percent of the photo height — one number, one meaning, so
 * the editor's "seat the plate" slider and the menu can never disagree.
 */
export const tableLift = (tb) => (tb ? -tb.lift : 0)

// ---------------------------------------------------------- room decoration --
//
// The venue hangs its OWN objects in the menu — a pair of lanterns in the header,
// a clay pot in a corner, whatever is actually in its room. This replaces the
// drawn lantern/pot/basket ornaments, which the owner rightly called crude: a
// photograph of his own lantern will always beat my drawing of one.
//
// `anchor` decides what the piece is fixed to. A header lantern must stay with
// the header while the menu scrolls under it; a corner pot belongs to the page.
export const DECOR_ANCHORS = [
  { id: 'header-start', ar: 'الهيدر — بداية', en: 'Header start' },
  { id: 'header-end', ar: 'الهيدر — نهاية', en: 'Header end' },
  { id: 'header-center', ar: 'الهيدر — الوسط', en: 'Header centre' },
  { id: 'page-top-start', ar: 'أعلى الصفحة — بداية', en: 'Page top start' },
  { id: 'page-top-end', ar: 'أعلى الصفحة — نهاية', en: 'Page top end' },
  { id: 'page-bottom-start', ar: 'أسفل الصفحة — بداية', en: 'Page bottom start' },
  { id: 'page-bottom-end', ar: 'أسفل الصفحة — نهاية', en: 'Page bottom end' },
  // The two the owner actually asked for once the slots proved too coarse:
  // 'page-free' rides WITH the page (x/y are percent of the whole scroll), so a
  // pot can stand beside the third dish and stay there; 'screen' is pinned to
  // the viewport and does not move while the menu scrolls under it.
  { id: 'page-free', ar: 'حر في الصفحة — يتحرك مع التمرير', en: 'Anywhere on the page' },
  { id: 'screen', ar: 'ثابت على الشاشة — لا يتحرك', en: 'Pinned to the screen' },
]
export const DECOR_ANCHOR_IDS = DECOR_ANCHORS.map((a) => a.id)

// Where the piece sits in the room's depth. Replaces the old front/back
// boolean: 'back' slips behind the menu content onto the wall itself, 'front'
// floats over the content, 'top' clears even the sticky bars (a lamp hanging
// over everything). The old `front` field still resolves for saved documents.
export const DECOR_DEPTHS = [
  { id: 'back', ar: 'على الخلفية — خلف المحتوى', en: 'On the wall, behind content' },
  { id: 'front', ar: 'أمام المحتوى', en: 'In front of content' },
  { id: 'top', ar: 'فوق كل شيء', en: 'Above everything' },
]
export const DECOR_DEPTH_IDS = DECOR_DEPTHS.map((d) => d.id)

// A hanging object should swing a little; a standing one should not. `hang`
// swings from its TOP edge, which is what makes a lantern read as suspended
// rather than as a sticker that happens to wobble.
export const DECOR_MOTIONS = [
  { id: '', ar: 'ثابت', en: 'Still' },
  { id: 'hang', ar: 'تأرجح معلّق', en: 'Hanging sway' },
  { id: 'float', ar: 'طفو', en: 'Float' },
  { id: 'glow', ar: 'وهج نابض', en: 'Pulsing glow' },
  { id: 'spin', ar: 'دوران بطيء', en: 'Slow spin' },
]
export const DECOR_MOTION_IDS = DECOR_MOTIONS.map((m) => m.id)

export const DECOR_RANGE = {
  x: { min: -20, max: 120, step: 0.5, dflt: 8 },   // percent across its anchor box
  y: { min: -40, max: 140, step: 0.5, dflt: 0 },
  w: { min: 3, max: 150, step: 0.5, dflt: 16 },    // percent of the anchor's smaller side
  rot: { min: -180, max: 180, step: 1, dflt: 0 },
  opacity: { min: 0, max: 1, step: 0.05, dflt: 1 },
  glow: { min: 0, max: 1, step: 0.05, dflt: 0 },   // warm halo behind it, for lamps
  speed: { min: 0.5, max: 3, step: 0.1, dflt: 1 }, // motion speed multiplier
}

export function normalizeDecor(raw) {
  if (!raw || typeof raw !== 'object') return null
  const url = String(raw.url || '')
  if (!url) return null
  const R = DECOR_RANGE
  const anchor = str(raw.anchor, DECOR_ANCHOR_IDS, 'header-start')
  // depth supersedes the old boolean; old documents resolve front:false -> back.
  let depth = str(raw.depth, DECOR_DEPTH_IDS, raw.front === false ? 'back' : 'front')
  // A screen-pinned piece cannot go behind the content: position:fixed cannot
  // slide under the page without leaving the stacking context, so it would
  // simply vanish. Clamp instead of lying.
  if (anchor === 'screen' && depth === 'back') depth = 'front'
  return {
    id: String(raw.id || url).slice(0, 80),
    url,
    kind: raw.kind === 'model' ? 'model' : 'image',
    anchor,
    x: num(raw.x, R.x.dflt, R.x.min, R.x.max),
    y: num(raw.y, R.y.dflt, R.y.min, R.y.max),
    w: num(raw.w, R.w.dflt, R.w.min, R.w.max),
    rot: num(raw.rot, R.rot.dflt, R.rot.min, R.rot.max),
    opacity: num(raw.opacity, R.opacity.dflt, 0, 1),
    blend: str(raw.blend, BLEND_IDS, 'normal'),
    filter: filterCss(raw.filter),
    motion: str(raw.motion, DECOR_MOTION_IDS, ''),
    speed: num(raw.speed, R.speed.dflt, R.speed.min, R.speed.max),
    glow: num(raw.glow, R.glow.dflt, 0, 1),
    glowColor: String(raw.glowColor || '#f5b942'),
    flip: !!raw.flip,
    depth,
    front: depth !== 'back', // kept for old readers; derived, never stored apart
  }
}

/** Every decoration the venue has hung, grouped by anchor. */
export function resolveDecor(tenant) {
  const raw = tenant && Array.isArray(tenant.menuDecor) ? tenant.menuDecor : []
  const all = raw.map(normalizeDecor).filter(Boolean).slice(0, 16)
  const byAnchor = {}
  for (const d of all) (byAnchor[d.anchor] = byAnchor[d.anchor] || []).push(d)
  return {
    all,
    byAnchor,
    header: all.filter((d) => d.anchor.startsWith('header-')),
    screen: all.filter((d) => d.anchor === 'screen'),
  }
}

/** Inline style for one hung decoration. */
export function decorStyle(d) {
  if (!d) return null
  const t = [`translate(-50%, -50%)`]
  if (d.rot) t.push(`rotate(${d.rot}deg)`)
  if (d.flip) t.push('scaleX(-1)')
  const s = {
    position: 'absolute',
    insetInlineStart: `${d.x}%`,
    top: `${d.y}%`,
    width: `${d.w}cqmin`,
    transform: t.join(' '),
    opacity: d.opacity,
    pointerEvents: 'none',
  }
  if (d.filter) s.filter = d.filter
  if (d.blend && d.blend !== 'normal') s.mixBlendMode = d.blend
  if (d.speed !== 1) s.animationDuration = `${(6 / d.speed).toFixed(2)}s`
  return s
}

/** True when the item has any composition worth rendering a backdrop layer for. */
export const hasBackdrop = (comp) => !!(comp && comp.bg)

// ------------------------------------------------------------ the top header --
//
// The venue owns its header. Before this, the bar's face was chosen from fixed
// chrome presets plus one special case (brick reusing the wall); the owner asked
// to hang his OWN image there and to decide which of the bar's elements exist.
// Stored on `tenant.menuHeader`; the brick mode still delegates its colours to
// `menuWall` (that decision lives there — see resolveWall.header).

export const HEADER_MODES = [
  { id: '', ar: 'حسب الثيم', en: 'Theme default' },
  { id: 'brick', ar: 'من جدار المنيو', en: 'From the menu wall' },
  { id: 'image', ar: 'صورتي', en: 'My own image' },
]
export const HEADER_MODE_IDS = HEADER_MODES.map((h) => h.id)

export const HEADER_RANGE = {
  scrim: { min: 0, max: 1, step: 0.05, dflt: 0.55 }, // dark veil so the bar's text survives any photo
  blur: { min: 0, max: 20, step: 0.5, dflt: 0 },
}

/**
 * The menu's top bar. `show` lists the bar's own elements; hiding the venue
 * name does not hide the bar. Back-compatible: a venue that only ever ticked
 * the old brick-header checkbox (menuWall.header) resolves to mode 'brick'.
 */
export function resolveMenuHeader(tenant) {
  const h = (tenant && tenant.menuHeader) || {}
  let mode = str(h.mode, HEADER_MODE_IDS, '')
  if (!mode && tenant && tenant.menuWall && tenant.menuWall.header === true) mode = 'brick'
  const url = String(h.url || '')
  if (mode === 'image' && !url) mode = ''
  const R = HEADER_RANGE
  return {
    mode,
    url,
    scrim: num(h.scrim, R.scrim.dflt, 0, 1),
    blur: num(h.blur, 0, R.blur.min, R.blur.max),
    pos: String(h.pos || 'center'),
    show: {
      logo: h.logo !== false,
      name: h.name !== false,
      lang: h.lang !== false,
      theme: h.theme !== false,
    },
  }
}

// ----------------------------------------------------------- button skins ----
//
// The menu's action buttons (add to cart, the + steppers, the cart bar). The
// owner asked to shape them like the room: brick like his wall, or faced with
// his own photo. One tenant-level decision — a menu where every button dresses
// differently reads as broken, so there is deliberately no per-item override.

export const BUTTON_SKINS = [
  { id: '', ar: 'حسب الثيم', en: 'Theme default' },
  { id: 'brick', ar: 'طوب من الجدار', en: 'Brick from the wall' },
  { id: 'image', ar: 'صورتي', en: 'My own image' },
]
export const BUTTON_SKIN_IDS = BUTTON_SKINS.map((b) => b.id)

// Which buttons wear the skin. 'primary' is the original set (view dish, add
// to cart, the active chip, the AR button); 'all' reaches EVERY control in the
// menu — category chips, size/option choices, the pairing bricks, the qty
// steppers and the close button — «كل الازرار وليس الاساسية فقط».
export const BUTTON_SCOPES = [
  { id: 'primary', ar: 'الأزرار الأساسية', en: 'Primary buttons' },
  { id: 'all', ar: 'كل الأزرار', en: 'Every button' },
]
export const BUTTON_SCOPE_IDS = BUTTON_SCOPES.map((s) => s.id)

// The SHAPE of the face, over whichever skin is chosen. 'slab' is the owner's
// «طوبة واحدة»: the face is ONE laid brick — a flat clay fired from the wall's
// own colour under the mortar's lit arris and shadowed bed — instead of a
// wall pattern shrunk until the units blur. The others are honest geometry:
// pill and sharp override the radius outright, chamfer cuts the corners.
export const BUTTON_SHAPES = [
  { id: '', ar: 'حسب الاستدارة', en: 'Radius only' },
  { id: 'slab', ar: 'طوبة واحدة', en: 'One laid brick' },
  { id: 'pill', ar: 'كبسولة', en: 'Pill' },
  { id: 'sharp', ar: 'حاد بلا استدارة', en: 'Sharp' },
  { id: 'chamfer', ar: 'زوايا مشطوفة', en: 'Chamfered corners' },
]
export const BUTTON_SHAPE_IDS = BUTTON_SHAPES.map((s) => s.id)

export const BUTTON_RANGE = {
  radius: { min: 0, max: 28, step: 1, dflt: 12 },
  scrim: { min: 0, max: 1, step: 0.05, dflt: 0.35 }, // veil over the face so the label reads
  // The picture INSIDE the face («تكبير وتصغير الصورة داخل الزر»): 1 = cover the
  // face exactly; below zooms out (the picture tiles), above zooms in. The two
  // offsets choose WHICH part of the picture shows when it is bigger than the
  // face. On the brick skin the same dial scales the wall's unit instead.
  imgScale: { min: 0.2, max: 4, step: 0.05, dflt: 1 },
  imgX: { min: 0, max: 100, step: 1, dflt: 50 },
  imgY: { min: 0, max: 100, step: 1, dflt: 50 },
}

export function resolveButtons(tenant) {
  const b = (tenant && tenant.menuButtons) || {}
  let skin = str(b.skin, BUTTON_SKIN_IDS, '')
  const url = String(b.url || '')
  if (skin === 'image' && !url) skin = ''
  if (!skin) return null
  const R = BUTTON_RANGE
  return {
    skin,
    url,
    scope: str(b.scope, BUTTON_SCOPE_IDS, 'primary'),
    shape: str(b.shape, BUTTON_SHAPE_IDS, ''),
    radius: num(b.radius, R.radius.dflt, R.radius.min, R.radius.max),
    scrim: num(b.scrim, R.scrim.dflt, 0, 1),
    imgScale: num(b.imgScale, R.imgScale.dflt, R.imgScale.min, R.imgScale.max),
    imgX: num(b.imgX, R.imgX.dflt, R.imgX.min, R.imgX.max),
    imgY: num(b.imgY, R.imgY.dflt, R.imgY.min, R.imgY.max),
    // ink is decided by the renderer from the face; a manual override exists for
    // the one photo the heuristic will inevitably get wrong.
    ink: b.ink === 'dark' ? 'dark' : 'light',
  }
}
