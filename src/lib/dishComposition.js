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
  // the squashed ground ellipse under a TILTED dish — the cheap honest cue that
  // the plate touches something. Opt-in (0 = off); drawn only while tilt ≠ 0.
  tiltContact: { min: 0, max: 1, step: 0.05, dflt: 0 },
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
    trim: normalizeVideoTrim(it.bgVideoTrim),
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
    // NOT `contact` — that name already means the table's contact pool
    // (TABLE_RANGE.contact); two identically-named resolved fields would be
    // exactly the two-halves confusion this file exists to prevent.
    tiltContact: num(it.tiltContact, RANGE.tiltContact.dflt, 0, 1),
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
  // The tilt projection is DELIBERATELY absent here: rotateX on the <img>
  // itself rasterised the photo at layout size and then resampled it through
  // scale() AND the projection — twice through one undersized bitmap, which is
  // the blur the owner reported. The projection lives on a wrapper now
  // (imgTiltBoxStyle); a renderer MUST mount that wrapper whenever it returns
  // non-null. With tilt set, x/y/scale/rot apply IN the tilted plane (they
  // gain foreshortening) — accepted as part of the tilt redesign.
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
  // With tilt set the blend moves to the wrapper: a transformed wrapper is a
  // stacking context, so a blend left on the img inside it would blend with
  // nothing at all.
  if (img.blend && img.blend !== 'normal' && !img.tilt) s.mixBlendMode = img.blend
  return s
}

/**
 * THE TILT WRAPPER. The projection wraps the photo instead of transforming it:
 * the photo paints at its final 2D size from the full-resolution source first,
 * and only the projection resamples it — once. Origin is the BASE (50% 100%):
 * a plate on a table pivots about its contact edge; the centre-origin default
 * is what made it read as a postcard falling backwards. `lift` is PREPENDED
 * (leftmost = applied last = pure screen-space drop) so the seat still meets
 * the table under any tilt. perspective is a var: the same stored degrees must
 * project the same on a 250px list photo and a 560px stage hero, so each
 * surface sets --dish-persp to roughly 3x its photo-box height (index.css and
 * appearance.css own the per-surface values).
 */
export function imgTiltBoxStyle(img, lift = 0) {
  if (!img || !img.tilt) return null
  const s = {
    transform: `${lift ? `translateY(${lift}%) ` : ''}perspective(var(--dish-persp, 1100px)) rotateX(${img.tilt}deg)`,
    transformOrigin: '50% 100%',
    backfaceVisibility: 'hidden',
    willChange: 'transform',
  }
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
    // Whether this ONE wall runs behind the ENTIRE page (header → content),
    // replacing the pre-menu grey zone. Lives on menuWall like `header` does:
    // it has no colours of its own, it IS this wall reaching further. Renderers
    // must derive room-mode from resolveWall() !== null && .room — never from
    // raw pattern truthiness ('none' and 'image'-without-url resolve to null).
    room: t.room === true,
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
  y: { min: -100, max: 100, step: 0.5, dflt: 0 }, // widened ±60→±100 («كاملة للأسفل»); clamped on read, saved venues unmoved
  w: { min: 40, max: 180, step: 1, dflt: 100 },   // percent of the bolted width
  h: { min: 30, max: 300, step: 1, dflt: 100 },   // max widened 220→300 — but the honest flush-to-bottom path is `extend`
  // A flat darkening veil over the surface («تعتيم أكثر») — separate from shade,
  // which only darkens toward the front, and from tint, which recolours.
  dim: { min: 0, max: 0.85, step: 0.05, dflt: 0 },
  // How strongly the surface dissolves into the canvas where the words live.
  // 0.5 is exactly the old hard-coded behaviour; lower shows more material,
  // higher melts it away sooner. The venue owns its own readability trade-off,
  // the same way it owns the reading panel.
  melt: { min: 0, max: 1, step: 0.05, dflt: 0.5 },
  // Bottom-side melt: dissolves the material into the canvas at the BOX BOTTOM,
  // hiding the raw cut the owner reported («الطاولة حافّة من تحت»). 0 (default)
  // = exactly today's paint. Measured upward from the bottom edge.
  meltBottom: { min: 0, max: 1, step: 0.05, dflt: 0 },
  // A canvas-colour reading veil ABOVE the material but under the glyphs, so
  // readability is no longer hostage to the melt dial. Capped at 0.9 so the
  // surface never fully disappears. Raise toward 0.6+ before trusting body
  // text on a bright material (the 4.5:1 rule is the venue's to keep here).
  veil: { min: 0, max: 0.9, step: 0.05, dflt: 0 },
  // Stage cohesion (opened-item window only): the space above the dish and the
  // photo's max height. Defaults reproduce the CSS clamps exactly. heroPad's
  // floor is 20, not 0 — below that the photo slides under the floating close
  // button (.edt-stg-x, top:12px + 44px tall).
  heroPad: { min: 20, max: 80, step: 2, dflt: 56 },  // px, capped by 14vw in CSS
  heroMax: { min: 20, max: 60, step: 1, dflt: 42 },  // dvh; px cap = value*10
  // «بحيث لا يتداخل مع النص أو الاسم»: extra space pushed under the dropped
  // dish before the first text row, so a deep lift never buries the item's
  // name under the plate. 0 = exactly today's layout.
  textPad: { min: 0, max: 200, step: 2, dflt: 0 },   // px
  // «شكل ثابت للطاولة»: a floor under the details panel, in dvh, so the table
  // box — and every percent-of-it dial (free w/h, the melt stops) — reads the
  // same on a bare item as on an option-rich one. 0 = today: height from
  // content alone.
  minBody: { min: 0, max: 90, step: 1, dflt: 0 },    // dvh
  // «سطح الطبق»: the photographed perspective tabletop band INSIDE the photo
  // box — the surface the cutout actually sits on. Active only while
  // menuTable.topUrl is non-empty (no separate on/off key, no invalid states).
  topH: { min: 20, max: 70, step: 1, dflt: 44 },       // band height, % of the dish box
  topSeat: { min: 0, max: 30, step: 0.5, dflt: 12 },   // dish raise above the near edge, % of the dish box
  topFeather: { min: 0, max: 1, step: 0.05, dflt: 0.35 }, // far-edge melt into the wall
  // «تدرج اختفاء الطاولة من الأسفل»: the table's BOTTOM dissolves to nothing
  // instead of stopping on a hard dark edge — the creative fade the owner
  // asked for. 0 = today's hard edge.
  topFade: { min: 0, max: 1, step: 0.05, dflt: 0 },
  // Where the table's NEAR EDGE sits inside the topUrl image, % from its top.
  // The generator now writes a COMPLETE table (surface + front face in one
  // photograph); the band shows rows [0..topEdge] and the panel shows the rest,
  // so the two read as one piece of furniture. 100 = the whole image is the
  // surface (the earlier band-only photographs keep painting unchanged).
  topEdge: { min: 15, max: 100, step: 1, dflt: 100 },
}

// The keys a venue may override FOR THE OPENED-ITEM WINDOW alone
// (tenant.menuTable.stage = partial object). The dish window's panel is far
// taller than a list panel — variants, story, options — so the same numbers
// cannot fit both: the owner reported the table «لا تظهر بشكل مناسب عند فتح
// الصنف». Geometry and strength may differ per place; the material may not —
// it is one room with one table.
export const TABLE_STAGE_KEYS = ['x', 'y', 'w', 'h', 'lift', 'opacity', 'shade', 'dim', 'melt', 'meltBottom', 'veil', 'extend', 'heroPad', 'heroMax', 'textPad', 'minBody', 'contact', 'scale', 'topH', 'topSeat', 'topFade']

/**
 * The table under the dish details. Reads the TENANT document, because it is one
 * room; a venue that wants a different table per dish can still override with the
 * per-item surface library.
 */
export function resolveTable(tenant, options) {
  const room = (tenant && tenant.menuTable) || {}
  // PER-ITEM TABLE («التحكم في الطاولة بشكل مستقل لكل صنف»). The one-room-
  // one-table policy was the default until the owner asked for the opposite
  // outright — a dish may now carry its OWN table (item.table, partial):
  // every key falls back to the room's table, stage sub-objects merge too,
  // and everything passes the same clamps. Absent item.table = the room
  // decides, exactly as before.
  const own = options && options.item && options.item.table && typeof options.item.table === 'object'
    ? options.item.table
    : null
  const base = own
    ? {
      ...room,
      ...own,
      ...(own.stage || room.stage
        ? { stage: { ...(room.stage && typeof room.stage === 'object' ? room.stage : {}), ...(own.stage && typeof own.stage === 'object' ? own.stage : {}) } }
        : {}),
    }
    : room
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
    meltBottom: num(t.meltBottom, R.meltBottom.dflt, 0, 1),
    veil: num(t.veil, R.veil.dflt, 0, R.veil.max),
    // «سطح الطبق» — the perspective tabletop band inside the photo box.
    topUrl: String(t.topUrl || ''),
    topH: num(t.topH, R.topH.dflt, R.topH.min, R.topH.max),
    topSeat: num(t.topSeat, R.topSeat.dflt, R.topSeat.min, R.topSeat.max),
    topFeather: num(t.topFeather, R.topFeather.dflt, 0, 1),
    topFade: num(t.topFade, R.topFade.dflt, 0, 1),
    topEdge: num(t.topEdge, R.topEdge.dflt, R.topEdge.min, R.topEdge.max),
    // «مدّ الطاولة حتى أسفل النافذة» — stage engine only (data-tbl-extend).
    // A boolean, never num-clamped.
    extend: t.extend === true,
    heroPad: num(t.heroPad, R.heroPad.dflt, R.heroPad.min, R.heroPad.max),
    heroMax: num(t.heroMax, R.heroMax.dflt, R.heroMax.min, R.heroMax.max),
    textPad: num(t.textPad, R.textPad.dflt, R.textPad.min, R.textPad.max),
    minBody: num(t.minBody, R.minBody.dflt, R.minBody.min, R.minBody.max),
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
  // shade was DEAD on bright/photo tables (the live venue's case): the bright
  // branch froze b0 at 30 and nothing else reads shade. Coupled now, with the
  // coefficients chosen so the DEFAULT shade (0.35) reproduces exactly 30 —
  // untouched venues byte-identical, the dial spans ~22-46.
  const b0 = bright ? Math.round(21.6 + tb.shade * 24) : Math.round(34 + tb.shade * 36)
  const shift = (0.5 - tb.melt) * 130
  const a = Math.max(0, Math.min(140, a0 + shift))
  const b = Math.max(a + 6, Math.min(190, b0 + shift))
  return { a: Math.round(a), b: Math.round(b) }
}

/**
 * Bottom-edge melt stops, in % measured FROM THE BOTTOM. Null while off, so
 * the element is never mounted and the untouched path stays byte-identical.
 */
export function tableMeltBottom(tb) {
  if (!tb || !tb.meltBottom) return null
  return { a: Math.round(tb.meltBottom * 8), b: Math.round(8 + tb.meltBottom * 40) }
}

/**
 * Stage-window cohesion vars (space above the dish / photo height). Null at
 * the defaults so the CSS clamp fallbacks keep governing untouched venues.
 * --edt-stg-heromin rides along whenever heroMax is overridden: the hero's
 * min-height flex-centring is half of «الصفحة تظهر كبيرة من فوق», and capping
 * the max without releasing the min would change nothing for short photos.
 */
export function tableStageVars(tb) {
  if (!tb) return null
  const v = {}
  if (tb.textPad) v['--tbl-textpad'] = `${tb.textPad}px`
  // svh, not dvh: this is a LAYOUT FLOOR under the details panel, and dvh
    // changes while the mobile URL bar animates — the same unit that made the
    // table shift on every scroll (see --edt-hero-cap in index.css).
    if (tb.minBody) v['--edt-stg-bodymin'] = `${tb.minBody}svh`
  // ONE DIAL, BOTH SURFACES. The control is labelled «شكل ثابت للطاولة في كل
  // الأصناف» — a consistent table on every item — but it only ever reached the
  // OPENED dish. In the pager the plank is drawn against `.edt-main`, which
  // hugs its content, so a dish with three add-ons drew a taller table than a
  // bare one and the promise was broken exactly where the guest scrolls. Same
  // number, same unit, now also emitted for the list.
  if (tb.minBody) v['--edt-main-min'] = `${tb.minBody}svh`
  if (tb.heroPad !== TABLE_RANGE.heroPad.dflt) v['--edt-stg-padtop'] = `min(${tb.heroPad}px, 14vw)`
  if (tb.heroMax !== TABLE_RANGE.heroMax.dflt) {
    // svh, not dvh — the same URL-bar rule as minBody above: a dvh hero cap
    // resized the stage photo while the phone scrolled.
    v['--edt-stg-heromax'] = `min(${tb.heroMax}svh, ${tb.heroMax * 10}px)`
    const mn = Math.min(30, tb.heroMax)
    v['--edt-stg-heromin'] = `min(${mn}svh, ${mn * 10}px)`
  }
  return Object.keys(v).length ? v : null
}

/**
 * «سطح الطبق» band vars. Null while no band (topUrl empty) — untouched venues
 * stamp nothing and [data-top] never exists, so their paint stays byte-identical.
 */
export function tableTopVars(tb) {
  if (!tb || !tb.topUrl) return null
  return {
    '--edt-toph': n3(tb.topH / 100),
    '--edt-topseat': n3(tb.topSeat / 100),
    '--edt-topfeather': n3(tb.topFeather),
    '--edt-topfade': n3(tb.topFade),
    '--edt-topedge': n3(tb.topEdge),
  }
}

/** Inline style for the table panel itself. */
export function tableStyle(tb) {
  if (!tb) return null
  const s = { opacity: tb.opacity }
  if (tb.kind === 'image' && tb.url && tb.topUrl === tb.url) {
    // COMPLETE-table mode: .edt-topfull paints the photograph as one
    // continuous element from inside the photo box down behind the panel —
    // the art layer here must NOT paint it a second time. The panel keeps
    // contributing its readability layers (melt/veil/dim) on top.
  } else if (tb.kind === 'image' && tb.url) {
    s.backgroundImage = `url(${tb.url})`
    s.backgroundSize = tb.scale === 1 ? 'cover' : `${Math.round(tb.scale * 100)}%`
    s.backgroundPosition = 'center'
    s.backgroundRepeat = 'no-repeat'
  }
  const filters = []
  if (tb.filter) filters.push(tb.filter)
  if (tb.blur) filters.push(`blur(${tb.blur}px)`)
  if (filters.length) s.filter = filters.join(' ')
  if (tb.blend && tb.blend !== 'normal') s.mixBlendMode = tb.blend
  return s
}

/**
 * Top-corner radii for the .edt-table BOX (the overflow clip), not the art:
 * a radius painted on the art below the box's 18px clip was invisible (nearly
 * half the dial did nothing), and a non-uniform free scale warped it
 * elliptically. Null at the 0 default — the CSS 18px keeps governing untouched
 * venues. Bottom corners are the extend dial's business.
 */
export function tableBoxStyle(tb) {
  if (!tb || !tb.radius) return null
  return { borderStartStartRadius: `${tb.radius}px`, borderStartEndRadius: `${tb.radius}px` }
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
  { id: 'header-start', ar: 'الهيدر (بداية)', en: 'Header start' },
  { id: 'header-end', ar: 'الهيدر (نهاية)', en: 'Header end' },
  { id: 'header-center', ar: 'الهيدر (الوسط)', en: 'Header centre' },
  { id: 'page-top-start', ar: 'أعلى الصفحة (بداية)', en: 'Page top start' },
  { id: 'page-top-end', ar: 'أعلى الصفحة (نهاية)', en: 'Page top end' },
  { id: 'page-bottom-start', ar: 'أسفل الصفحة (بداية)', en: 'Page bottom start' },
  { id: 'page-bottom-end', ar: 'أسفل الصفحة (نهاية)', en: 'Page bottom end' },
  // The two the owner actually asked for once the slots proved too coarse:
  // 'page-free' rides WITH the page (x/y are percent of the whole scroll), so a
  // pot can stand beside the third dish and stay there; 'screen' is pinned to
  // the viewport and does not move while the menu scrolls under it.
  { id: 'page-free', ar: 'حر في الصفحة، يتحرك مع التمرير', en: 'Anywhere on the page' },
  { id: 'screen', ar: 'ثابت على الشاشة، لا يتحرك', en: 'Pinned to the screen' },
]
export const DECOR_ANCHOR_IDS = DECOR_ANCHORS.map((a) => a.id)

// Where the piece sits in the room's depth. Replaces the old front/back
// boolean: 'back' slips behind the menu content onto the wall itself, 'front'
// floats over the content, 'top' clears even the sticky bars (a lamp hanging
// over everything). The old `front` field still resolves for saved documents.
export const DECOR_DEPTHS = [
  { id: 'back', ar: 'على الخلفية، خلف المحتوى', en: 'On the wall, behind content' },
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

// A 3D piece must not pinwheel as a flat sticker: engines hand motion 'spin'
// to model-viewer's native auto-rotate instead of the CSS keyframe. 360deg
// over the same 6/speed seconds the edtDecSpin keyframe takes, so the speed
// dial means one thing on a photo and on a model.
export const decorSpinRate = (d) => `${(60 * d.speed).toFixed(1)}deg`

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

// ------------------------------------------------------------- video trim ----
//
// One {start,end} window in SECONDS for every uploaded video, stored NEXT TO
// its url field: tenant.bannerVideoTrim, tenant.bgVideoTrim,
// tenant.immersiveBgVideoTrim, tenant.appBg.trim (nested — appBg is already an
// object), item.bgVideoTrim, item.videoTrim (legacy spot video), story.trim.
// end === 0 means «to the natural end», so a start-only trim can be saved
// before the duration is known. Both zero = no trim, and normalize returns
// null so the untouched playback path stays byte-identical. Every handler that
// REPLACES a video url must null its sibling trim — a window chosen for clip A
// must never silently apply to clip B.

export const VIDEO_TRIM_RANGE = {
  start: { min: 0, max: 7200, step: 0.1, dflt: 0 },
  end: { min: 0, max: 7200, step: 0.1, dflt: 0 }, // 0 = natural end
  span: 0.5, // narrowest playable window, seconds
}

export function normalizeVideoTrim(raw) {
  if (!raw || typeof raw !== 'object') return null
  const R = VIDEO_TRIM_RANGE
  const start = num(raw.start, R.start.dflt, R.start.min, R.start.max)
  let end = num(raw.end, R.end.dflt, R.end.min, R.end.max)
  if (end && end < start + R.span) end = 0 // impossible window -> to the end
  if (!start && !end) return null
  return { start, end }
}

/**
 * The window actually playable once the real duration is known: start is
 * pulled back if it falls past the file's end; an end past the duration means
 * the natural end.
 */
export function trimWindow(trim, duration) {
  if (!trim) return null
  const d = Number.isFinite(duration) && duration > 0 ? duration : Infinity
  const start = d === Infinity ? trim.start : Math.min(trim.start, Math.max(0, d - VIDEO_TRIM_RANGE.span))
  const end = trim.end && trim.end > start && trim.end < d ? trim.end : d
  return { start, end }
}

// ---------------------------------------------------------------- shadows ----
//
// «التحكم في الظلال بالكامل — إزالتها أو وضعها كما هي». Every fixed dark line
// and cast in the editorial room, one dial each, 0..1 where 1 is exactly
// today's look and 0 removes it outright. tableTop is the exception: it is a
// FEATHER (melts an image-table's hard top edge up into the wall), a softener
// the venue adds — so its default is 0 per the opt-in policy. In CSS it is
// scoped to .edt-table-art:not([data-m]) so it reaches ONLY photo tables;
// material tables already feather their own top stop.

export const SHADOW_RANGE = {
  panelHalo: { min: 0, max: 1, step: 0.05, dflt: 1 }, // reading-panel outward halo
  tableEdge: { min: 0, max: 1, step: 0.05, dflt: 1 }, // dark 1px under the lit lip
  tableTop: { min: 0, max: 1, step: 0.05, dflt: 0 },  // photo-table top feather (opt-in)
  header: { min: 0, max: 1, step: 0.05, dflt: 1 },    // bar bottom hairline + cast
  bars: { min: 0, max: 1, step: 0.05, dflt: 1 },      // catbar / stage-bar hairlines
  buttons: { min: 0, max: 1, step: 0.05, dflt: 1 },   // brick bed + cast + skin text-shadow
  dish: { min: 0, max: 1, step: 0.05, dflt: 1 },      // master over per-item dish shadows
  seams: { min: 0, max: 1, step: 0.05, dflt: 1 },     // card-mode border + lift shadow
}

/**
 * Null when the venue never opened the shadows card, so the untouched path
 * stays byte-identical. CALLERS MEMOIZE on a JSON fingerprint of
 * tenant.menuShadows — a fresh object per render would defeat every comp memo
 * downstream.
 */
export function resolveShadows(tenant) {
  const s = tenant && tenant.menuShadows
  if (!s || typeof s !== 'object') return null
  const out = {}
  Object.keys(SHADOW_RANGE).forEach((k) => {
    const R = SHADOW_RANGE[k]
    out[k] = num(s[k], R.dflt, R.min, R.max)
  })
  return out
}

/**
 * CSS vars for BOTH engine roots (.edt-wrap and the portalled .edt-stg).
 * `header` deliberately rides elsewhere: --hd-sh is stamped by DinerBar and
 * --edt-hd-sh by headerBrickVars, because the app bar lives outside the wrap.
 */
export function shadowVars(sh) {
  if (!sh) return null
  return {
    '--edt-sh-panel': sh.panelHalo,
    '--edt-sh-tedge': sh.tableEdge,
    '--edt-sh-ttop': sh.tableTop,
    '--edt-sh-bars': sh.bars,
    '--edt-sh-btn': sh.buttons,
    '--edt-sh-dish': sh.dish,
    '--edt-sh-seam': sh.seams,
  }
}

/**
 * The tenant-level master over per-item dish shadows. Scales, never deletes:
 * the staff's per-item work survives under a lowered dial.
 */
export const scaleDishShadow = (comp, k) =>
  (!comp || !comp.shadow || k == null || k === 1)
    ? comp
    : { ...comp, shadow: { ...comp.shadow, opacity: comp.shadow.opacity * k } }

// ------------------------------------------------------ per-mode menu inks --
//
// «عند التحويل للفاتح أو الداكن أتحكم في ألوان الخطوط». The editorial tokens
// flip globally with [data-theme]; a photographic wall does not. These are the
// venue's own inks per mode, emitted INLINE at the menu root so they beat both
// token blocks. Every key optional; an empty object means the theme decides.

export const INK_MODE_IDS = ['light', 'dark']
export const INK_FIELDS = [
  { id: 'heading', ar: 'العناوين', en: 'Headings' },                  // --edt-ink
  { id: 'text', ar: 'نص الوصف', en: 'Body text' },                    // --edt-ink-2
  { id: 'muted', ar: 'النص الثانوي', en: 'Muted text' },              // --edt-mut
  { id: 'price', ar: 'السعر والتمييز', en: 'Price & accent' },        // --edt-amber
  { id: 'chip', ar: 'رقاقات التصنيفات', en: 'Category chips' },       // --edt-chip-ink
  { id: 'canvas', ar: 'لوح القراءة والذوبان', en: 'Reading canvas' }, // --edt-bg/-2
  { id: 'barBg', ar: 'خلفية الشريطين', en: 'Bars background' },       // --chrome-bg
  { id: 'barText', ar: 'نص الشريطين', en: 'Bars text' },              // --chrome-text
]
export const INK_FIELD_IDS = INK_FIELDS.map((f) => f.id)

// Derived-surface alphas: hairlines/fills/bar-muted are FUNCTIONS of the text
// ink, exactly as the theme derives its own. One place, or the card's preview
// and the engine drift.
export const INK_ALPHA = { line: 0.15, edge: 0.45, soft: 0.05, soft2: 0.10, barMuted: 0.78, barBorder: 0.18 }

const HEX6 = /^#[0-9a-fA-F]{6}$/
const inkRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const inkRgba = (h, a) => { const [r, g, b] = inkRgb(h); return `rgba(${r}, ${g}, ${b}, ${a})` }
const inkModeObj = (m) => {
  if (!m || typeof m !== 'object') return null
  const out = {}
  INK_FIELD_IDS.forEach((k) => {
    const v = String(m[k] || '')
    if (HEX6.test(v)) out[k] = v
  })
  return Object.keys(out).length ? out : null
}

export function resolveInk(tenant) {
  const i = tenant && tenant.menuInk
  if (!i || typeof i !== 'object') return null
  const light = inkModeObj(i.light)
  const dark = inkModeObj(i.dark)
  if (!light && !dark && i.followTheme !== true) return null
  return { light, dark, followTheme: i.followTheme === true }
}

/**
 * AUTOMATIC FALLBACK: a configured wall — photo OR drawn — is the same picture
 * in both modes, so with no light override the light flip is a lie (dark ink
 * onto the dark room). Locked ⇒ the engine keeps the dark token set in light
 * mode. The venue opts back into the flip with menuInk.followTheme, or simply
 * by saving light inks.
 */
export function inkLocked(tenant) {
  if (!resolveWall(tenant)) return false
  const i = resolveInk(tenant)
  return !(i && (i.followTheme || i.light))
}

/** The mode whose inks apply right now. `theme` is i18n's 'light'|'dark'. */
export const inkModeFor = (tenant, theme) => (theme === 'dark' || inkLocked(tenant) ? 'dark' : 'light')

/** Inline vars for the menu roots (.edt-wrap / .edt-stg). */
export function inkVars(m) {
  if (!m) return null
  const v = {}
  if (m.heading) v['--edt-ink'] = m.heading
  if (m.text) v['--edt-ink-2'] = m.text
  if (m.muted) v['--edt-mut'] = m.muted
  if (m.price) { v['--edt-amber'] = m.price; v['--edt-amber-soft'] = m.price }
  if (m.chip) v['--edt-chip-ink'] = m.chip
  const src = m.text || m.heading
  if (src) {
    v['--edt-line'] = inkRgba(src, INK_ALPHA.line)
    v['--edt-edge'] = inkRgba(src, INK_ALPHA.edge)
    v['--edt-soft'] = inkRgba(src, INK_ALPHA.soft)
    v['--edt-soft-2'] = inkRgba(src, INK_ALPHA.soft2)
  }
  if (m.canvas) { v['--edt-bg'] = m.canvas; v['--edt-bg-2'] = m.canvas }
  return Object.keys(v).length ? v : null
}

/** Bar vars for the app bar + bottom nav, set on the portal root. */
export function chromeInkVars(m) {
  if (!m || (!m.barBg && !m.barText)) return null
  const v = {}
  if (m.barBg) { v['--chrome-bg'] = m.barBg; v['--chrome-bg-2'] = m.barBg }
  if (m.barText) {
    v['--chrome-text'] = m.barText
    v['--chrome-icon'] = m.barText
    v['--chrome-active'] = m.barText
    v['--chrome-muted'] = inkRgba(m.barText, INK_ALPHA.barMuted)
    v['--chrome-border'] = inkRgba(m.barText, INK_ALPHA.barBorder)
  }
  return v
}

// -------------------------------------------------- banner + featured film --
//
// The venue header's melt into the page and the plaster behind featured cards.
// melt 0 keeps the legacy painted fade untouched; >0 switches the banner media
// stack to a TRUE-transparency mask so whatever runs behind it (the room wall)
// shows through the ramp.

export const BANNER_RANGE = {
  melt: { min: 0, max: 1, step: 0.05, dflt: 0 },
  meltLen: { min: 10, max: 100, step: 1, dflt: 55 }, // % of banner height the ramp covers
  // Veil behind the hero text, painted ONLY in room mode. Honest note: 0.35 is
  // tuned for DARK photo walls; a light drawn wall needs ~0.6 for 4.5:1.
  scrim: { min: 0, max: 1, step: 0.05, dflt: 0.35 },
}

export function resolveBanner(tenant) {
  const t = tenant || {}
  const R = BANNER_RANGE
  return {
    melt: num(t.bannerMelt, R.melt.dflt, 0, 1),
    meltLen: num(t.bannerMeltLen, R.meltLen.dflt, R.meltLen.min, R.meltLen.max),
    scrim: num(t.bannerScrim, R.scrim.dflt, 0, 1),
  }
}

export const FEATURED_RANGE = {
  // plaster behind each featured card so cutout dishes read over a photo wall;
  // engine default 0 = nothing changes for any saved venue (the studio seeds a
  // subtle value only when room mode is switched on)
  film: { min: 0, max: 1, step: 0.05, dflt: 0 },
  // «تكبير وتصغير الأصناف المميزة»: one multiplier over the featured tile's
  // width (the photo and text scale with their card). 1 = today exactly.
  scale: { min: 0.6, max: 1.8, step: 0.05, dflt: 1 },
}

export const resolveFeatured = (tenant) => ({
  film: num(tenant && tenant.featuredFilm, FEATURED_RANGE.film.dflt, 0, 1),
  scale: num(tenant && tenant.featuredScale, FEATURED_RANGE.scale.dflt, FEATURED_RANGE.scale.min, FEATURED_RANGE.scale.max),
})

// ------------------------------------------------- the home page order ----
//
// Which blocks the menu HOME shows above the dishes, and in what order. Ids
// reuse skin.overrides.hidden keys where those exist (stories/search/welcome/
// promos/special) so hide and order stay ONE system, never two.

export const HOME_BLOCKS = [
  { id: 'hero', ar: 'الترويسة والشعار', en: 'Header & logo' },
  { id: 'stories', ar: 'القصص', en: 'Stories' },
  { id: 'search', ar: 'البحث', en: 'Search' },
  { id: 'chips', ar: 'أزرار التجارب (الألعاب والصوت والصورة)', en: 'Experience buttons' },
  { id: 'welcome', ar: 'بطاقة الترحيب والولاء', en: 'Welcome & loyalty card' },
  { id: 'promos', ar: 'العروض', en: 'Promos' },
  { id: 'memory', ar: 'ذاكرة المكان', en: 'Venue memory' },
  { id: 'reviews', ar: 'تقييمات جوجل', en: 'Google reviews' },
  { id: 'special', ar: 'الأطباق المميزة', en: 'Featured dishes' },
]
export const HOME_BLOCK_IDS = HOME_BLOCKS.map((b) => b.id)

/**
 * Tenant-chosen order of the home blocks. Absent/empty → default order
 * (byte-identical home for every venue that never touched the card). Unknown
 * ids are dropped; ids missing from a saved order (features added later) are
 * inserted at their DEFAULT position, not appended blindly.
 */
// A block this build knows but a saved order predates is inserted at its
// DEFAULT position (after the nearest saved predecessor), not appended — new
// features must not pile up at the page's foot for older venues. Shared by the
// home page and the item-window orders; one algorithm, one behaviour.
const mergeOrder = (saved, ids) => {
  const out = [...saved]
  ids.forEach((id, idx) => {
    if (out.includes(id)) return
    let at = -1
    for (let j = idx - 1; j >= 0 && at < 0; j--) {
      const p = out.indexOf(ids[j])
      if (p >= 0) at = p + 1
    }
    if (at < 0) {
      for (let j = idx + 1; j < ids.length && at < 0; j++) {
        const p = out.indexOf(ids[j])
        if (p >= 0) at = p
      }
    }
    out.splice(at < 0 ? out.length : at, 0, id)
  })
  return out
}

export function resolveHomeOrder(tenant) {
  const raw = tenant && tenant.menuHome && Array.isArray(tenant.menuHome.order) ? tenant.menuHome.order : []
  const saved = raw
    .map((k) => String(k || ''))
    .filter((k, i, a) => HOME_BLOCK_IDS.includes(k) && a.indexOf(k) === i)
    .slice(0, 16)
  if (!saved.length) return [...HOME_BLOCK_IDS]
  return mergeOrder(saved, HOME_BLOCK_IDS)
}

// ------------------------------------------- the item window's text blocks --
//
// «أضف تخصيص وضع مكان اسم الصنف أو حتى الخيارات الأخرى والنصوص»: the opened
// dish's panel blocks — name, price, facts, description, sizes, modifiers,
// pairings… — take an order and a bounded per-block placement (align + a
// logical-inline nudge + a vertical nudge). Flow shifts, never transforms, so
// the RTL translate trap cannot occur and a shifted block pushes its
// neighbours instead of stacking glyphs. All defaults = today's exact DOM.

export const STAGE_BLOCKS = [
  { id: 'tags', ar: 'الشارات (عرض/مميز/نفد)', en: 'Badges' },
  { id: 'name', ar: 'اسم الصنف', en: 'Item name' },
  { id: 'price', ar: 'السعر', en: 'Price' },
  { id: 'facts', ar: 'الحقائق (سعرات/تحضير/يكفي)', en: 'Facts' },
  { id: 'desc', ar: 'الوصف', en: 'Description' },
  { id: 'note', ar: 'تنبيه الحساسية', en: 'Allergen note' },
  { id: 'ing', ar: 'المكونات', en: 'Ingredients' },
  { id: 'story', ar: 'قصة الطبق', en: 'Dish story' },
  { id: 'variants', ar: 'المقاسات', en: 'Sizes' },
  { id: 'options', ar: 'الإضافات', en: 'Modifiers' },
  { id: 'pairs', ar: 'يُطلب معه', en: 'Pairings' },
]
export const STAGE_BLOCK_IDS = STAGE_BLOCKS.map((b) => b.id)
// The browsing-LIST panel carries fewer blocks than the opened window — its
// own catalogue, so the card offers only what the pager actually renders.
// Stored under menuStage.list ({blocks, order}) beside the stage's own keys.
export const LIST_BLOCKS = [
  { id: 'name', ar: 'اسم الصنف', en: 'Item name' },
  { id: 'price', ar: 'السعر', en: 'Price' },
  { id: 'facts', ar: 'الحقائق (سعرات/تحضير/يكفي)', en: 'Facts' },
  { id: 'ing', ar: 'المكونات', en: 'Ingredients' },
  { id: 'desc', ar: 'الوصف', en: 'Description' },
  { id: 'pairs', ar: 'يُطلب معه', en: 'Pairings' },
  { id: 'open', ar: 'زر «اعرض الطبق»', en: 'View-dish button' },
  // quick add-to-cart from the browsing pager — mergeOrder appends unknown ids,
  // so venues with a saved order get it after 'open' automatically
  { id: 'add', ar: 'زر «أضف للسلة»', en: 'Add-to-cart button' },
]
export const LIST_BLOCK_IDS = LIST_BLOCKS.map((b) => b.id)
// Placeable but NOT orderable: the AR button lives in the media column under
// the photo, outside the panel's flow.
export const STAGE_PLACE_ONLY_IDS = ['ar']
export const STAGE_ALIGN_IDS = ['', 'start', 'center', 'end'] // '' = today's alignment
// Where the 3D button STANDS: in flow under the photo ('' — today), or lifted
// onto the wall above the dish («ارفع فوق يكون في النص في الجدار») — absolute,
// centred on the brick, dy still nudges it.
export const STAGE_AR_POS_IDS = ['', 'wall']

export const STAGE_TEXT_RANGE = {
  dx: { min: -40, max: 40, step: 0.5, dflt: 0 }, // % of panel width, LOGICAL inline
  dy: { min: -60, max: 60, step: 1, dflt: 0 },   // px, block-start
}

/**
 * Null when menuStage is absent or entirely default, so the untouched path
 * renders today's exact DOM — attribute-free.
 * `place` 'stage' (default — the opened window, menuStage's own keys) or
 * 'list' (the browsing pager, menuStage.list) — two independent tunings of
 * the same block system, each against its own catalogue.
 */
export function resolveStageBlocks(tenant, place = 'stage') {
  const root = tenant && tenant.menuStage
  if (!root || typeof root !== 'object') return null
  const s = place === 'list' ? (root.list && typeof root.list === 'object' ? root.list : null) : root
  if (!s) return null
  const IDS = place === 'list' ? LIST_BLOCK_IDS : STAGE_BLOCK_IDS
  const EXTRA = place === 'list' ? [] : STAGE_PLACE_ONLY_IDS
  const R = STAGE_TEXT_RANGE
  const src = s.blocks && typeof s.blocks === 'object' ? s.blocks : {}
  const blocks = {}
  IDS.concat(EXTRA).forEach((id) => {
    const b = src[id]
    if (!b || typeof b !== 'object') return
    const align = str(b.align, STAGE_ALIGN_IDS, '')
    const dx = num(b.dx, R.dx.dflt, R.dx.min, R.dx.max)
    const dy = num(b.dy, R.dy.dflt, R.dy.min, R.dy.max)
    const pos = id === 'ar' ? str(b.pos, STAGE_AR_POS_IDS, '') : ''
    if (!align && !dx && !dy && !pos) return
    blocks[id] = { align, dx, dy, pos }
  })
  const raw = Array.isArray(s.order) ? s.order : []
  const saved = raw
    .map((k) => String(k || ''))
    .filter((k, i, a) => IDS.includes(k) && a.indexOf(k) === i)
    .slice(0, 16)
  const order = saved.length ? mergeOrder(saved, IDS) : [...IDS]
  const moved = order.some((id, i) => id !== IDS[i])
  if (!Object.keys(blocks).length && !moved) return null
  return { blocks, order }
}

/** Spreadable props for one block's root element. Null when unconfigured. */
export function stageBlockProps(sb, id) {
  const b = sb && sb.blocks ? sb.blocks[id] : null
  if (!b) return null
  const p = { 'data-blk': id }
  if (b.align) p['data-blk-align'] = b.align
  if (b.pos) p['data-blk-pos'] = b.pos
  const st = {}
  if (b.dx) st['--sblk-dx'] = `${b.dx}%`
  if (b.dy) st['--sblk-dy'] = `${b.dy}px`
  if (Object.keys(st).length) p.style = st
  return p
}

// -------------------------------------------------------- the menu chrome --
//
// «نفس الشيء مع أزرار التواصل واللغة والثيم والإشعارات والسلة والقائمة
// السفلية». One identity system for every chrome surface instead of twelve
// pickers: each element takes a face (theme default / the room's wall / the
// venue's own photo / transparent), the sheets take a face, and the subpages
// (قصتنا وأخبارنا وغيرها) take a background — all falling back to the wall by
// the ONE `follow` switch. Whole feature is opt-in: an absent menuChrome
// resolves to null and not a single body attribute is stamped.

export const CHROME_ELEMENTS = [
  { id: 'nav', ar: 'الشريط السفلي', en: 'Bottom bar' },
  { id: 'cartFab', ar: 'زر السلة العائم', en: 'Cart button' },
  { id: 'bellFab', ar: 'جرس الإشعارات', en: 'Notification bell' },
  { id: 'langBtn', ar: 'زر اللغة', en: 'Language button' },
  { id: 'themeBtn', ar: 'زر الوضع', en: 'Theme button' },
  { id: 'social', ar: 'أزرار التواصل', en: 'Social buttons' },
]
export const CHROME_ELEMENT_IDS = CHROME_ELEMENTS.map((e) => e.id)

export const CHROME_SKIN_MODES = [
  { id: '', ar: 'حسب الثيم', en: 'Theme default' },
  { id: 'room', ar: 'من جدار المنيو', en: 'From the menu wall' },
  { id: 'image', ar: 'صورتي', en: 'My own image' },
  { id: 'none', ar: 'شفاف', en: 'Transparent' },
]
export const CHROME_SKIN_MODE_IDS = CHROME_SKIN_MODES.map((m) => m.id)

// profile = «قصتنا وأخبارنا» (VenueProfile), order = order tracking,
// reserve = table booking, pass = the ticket/reservation pass page.
export const CHROME_PAGE_IDS = ['profile', 'events', 'book', 'order', 'reserve', 'pass']

export const PAGE_BG_MODES = [
  { id: '', ar: 'حسب الثيم', en: 'Theme default' },
  { id: 'wall', ar: 'جدار المنيو', en: 'The menu wall' },
  { id: 'image', ar: 'صورتي', en: 'My own image' },
  { id: 'none', ar: 'بدون خلفية', en: 'None' },
]
export const PAGE_BG_MODE_IDS = PAGE_BG_MODES.map((m) => m.id)

export const CHROME_RANGE = {
  // mirrors BUTTON_RANGE deliberately — one mental model for every face
  imgScale: { min: 0.2, max: 4, step: 0.05, dflt: 1 },
  imgX: { min: 0, max: 100, step: 1, dflt: 50 },
  imgY: { min: 0, max: 100, step: 1, dflt: 50 },
  radius: { min: 0, max: 28, step: 1, dflt: 12 },
  scrim: { min: 0, max: 1, step: 0.05, dflt: 0.35 },
  tintAmount: { min: 0, max: 1, step: 0.05, dflt: 0 },
  // «إمكانية التحريك»: screen-px offsets, consumed ONLY by the two fixed fabs
  // (cartFab/bellFab) as a translate — bars and in-flow buttons do not move.
  x: { min: -60, max: 60, step: 1, dflt: 0 },
  y: { min: -60, max: 60, step: 1, dflt: 0 },
}

export const CHROME_SHEET_RANGE = {
  scrim: { min: 0, max: 1, step: 0.05, dflt: 0.5 },   // readability veil over the face
  blur: { min: 0, max: 24, step: 0.5, dflt: 0 },
  radius: { min: 0, max: 28, step: 1, dflt: 18 },
  backdrop: { min: 0, max: 0.85, step: 0.05, dflt: 0.55 }, // veil BEHIND the sheet
}

export const PAGE_BG_RANGE = {
  dim: { min: 0, max: 0.85, step: 0.05, dflt: 0.35 },
  blur: { min: 0, max: 30, step: 0.5, dflt: 0 },
}

export function normalizeChromeElement(raw) {
  const e = raw || {}
  const R = CHROME_RANGE
  let skin = str(e.skin, CHROME_SKIN_MODE_IDS, '')
  const url = String(e.url || '')
  // «صورتي» with no photo yet degrades to theme-default instead of vanishing —
  // the kind:'image'-without-url lesson from resolveTable.
  if (skin === 'image' && !url) skin = ''
  return {
    skin,
    url,
    imgScale: num(e.imgScale, R.imgScale.dflt, R.imgScale.min, R.imgScale.max),
    imgX: num(e.imgX, R.imgX.dflt, 0, 100),
    imgY: num(e.imgY, R.imgY.dflt, 0, 100),
    filter: filterCss(e.filter),
    blend: str(e.blend, BLEND_IDS, 'normal'),
    tint: String(e.tint || ''),
    tintAmount: num(e.tintAmount, R.tintAmount.dflt, 0, 1),
    radius: num(e.radius, R.radius.dflt, R.radius.min, R.radius.max),
    scrim: num(e.scrim, R.scrim.dflt, 0, 1),
    ink: e.ink === 'dark' ? 'dark' : 'light',
    icon: String(e.icon || ''),
    x: num(e.x, R.x.dflt, R.x.min, R.x.max),
    y: num(e.y, R.y.dflt, R.y.min, R.y.max),
  }
}

/**
 * Null when the venue never opened the chrome card — zero body attributes,
 * today's pixels. follow===true makes every element whose skin is '' resolve
 * 'room', so ONE switch flows the wall identity everywhere; explicit
 * per-element values override it.
 */
export function resolveChrome(tenant) {
  const c = tenant && tenant.menuChrome
  if (!c || typeof c !== 'object') return null
  const follow = c.follow === true
  const elements = {}
  CHROME_ELEMENT_IDS.forEach((id) => {
    const el = normalizeChromeElement((c.elements || {})[id])
    if (follow && !el.skin) el.skin = 'room'
    // an element earns its entry by having ANY effect: a face, a custom icon,
    // or (fabs only) a position offset
    if (el.skin || el.icon || el.x || el.y) elements[id] = el
  })
  const icons = {}
  Object.entries(c.socialIcons || {}).forEach(([k, v]) => { if (v) icons[k] = String(v) })
  return { follow, elements, socialIcons: icons, sheet: resolveChromeSheet(tenant) }
}

/** The diner sheets' face (cart, orders, offers, item…) + backdrop veil. */
export function resolveChromeSheet(tenant) {
  const c = tenant && tenant.menuChrome
  if (!c || typeof c !== 'object') return null
  const s = c.sheet && typeof c.sheet === 'object' ? c.sheet : {}
  let skin = str(s.skin, CHROME_SKIN_MODE_IDS, '')
  const url = String(s.url || '')
  if (skin === 'image' && !url) skin = ''
  if (!skin && c.follow === true) skin = 'room'
  if (!skin && !c.sheet) return null
  const R = CHROME_SHEET_RANGE
  return {
    skin,
    url,
    scrim: num(s.scrim, R.scrim.dflt, 0, 1),
    blur: num(s.blur, R.blur.dflt, R.blur.min, R.blur.max),
    radius: num(s.radius, R.radius.dflt, R.radius.min, R.radius.max),
    backdrop: num(s.backdrop, R.backdrop.dflt, 0, R.backdrop.max),
  }
}

/**
 * One subpage's background. Null = mount nothing (theme default). 'none' is
 * the explicit opt-out that beats `follow`.
 */
export function resolveChromePage(tenant, pageId) {
  const c = tenant && tenant.menuChrome
  if (!c || typeof c !== 'object') return null
  if (!CHROME_PAGE_IDS.includes(pageId)) return null
  const p = (c.pages && typeof c.pages === 'object' && c.pages[pageId]) || {}
  let mode = str(p.mode, PAGE_BG_MODE_IDS, '')
  const url = String(p.url || '')
  if (mode === 'image' && !url) mode = ''
  if (!mode && c.follow === true) mode = 'wall'
  if (!mode || mode === 'none') return null
  const R = PAGE_BG_RANGE
  return {
    mode,
    url,
    dim: num(p.dim, R.dim.dflt, 0, R.dim.max),
    blur: num(p.blur, R.blur.dflt, R.blur.min, R.blur.max),
  }
}

// ------------------------------------------------------- AI feature bounds --
//
// 3D generation contract (imageTo3d): UI half. functions/platformExtensions.js
// mirrors maxViews=4 (the Meshy hard cap) — keep in sync BY HAND; the functions
// package is CommonJS and cannot import this ESM module, and the inline drift
// scanner does not cover functions/.
export const GEN3D_RANGE = {
  maxViews: 4,             // primary photo + up to 3 hand-picked gallery shots
  maxExtraViews: 3,        // checkboxes the studio may enable
  smoothPolycount: 150000, // only used by the opt-in smooth (stylized) mode
}

// Diner AI ordering (photo + voice) — client-side bounds. Server mirror:
// DINER_AI in functions/platformExtensions.js (photoMaxB64 6.5MB ≈ 4.5MB raw,
// audioMaxB64 2.5MB, monthlyDflt 2000, perMinute 20, catalogMax 200). Same
// numbers, same names — change BOTH or the halves diverge.
export const AI_ORDER_RANGE = {
  photoMaxEdge: { min: 640, max: 2048, step: 64, dflt: 1280 },          // px, canvas downscale long edge
  photoJpegQ: { min: 0.5, max: 0.95, step: 0.01, dflt: 0.82 },
  photoMaxBytes: { min: 1048576, max: 4718592, step: 1, dflt: 4718592 }, // post-resize hard cap (4.5MB)
  recordMaxMs: { min: 4000, max: 30000, step: 1000, dflt: 15000 },
  silenceStopMs: { min: 600, max: 3000, step: 100, dflt: 1400 },        // auto-stop after this much quiet
  cloudTimeoutMs: { min: 4000, max: 20000, step: 500, dflt: 12000 },
  qty: { min: 1, max: 20, step: 1, dflt: 1 },
}
