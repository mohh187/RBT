// Photo direction — how the ACTIVE menu theme wants an item photo to be shot.
//
// The menu layouts render a dish photo in radically different boxes: a 90px
// cover-cropped square (list), a circle that clips corners (gallery/plates), a
// transparent cutout floating over a card (storefront/spotlight), or the
// editorial room where the cutout SITS on the venue's own table edge. None of
// that geometry exists anywhere but CSS — this registry is the structured
// record of it, so the AI re-shoot can aim at the right aspect, camera angle,
// margin and background treatment instead of the one-size 1:1 marketing shot.
//
// Pure data + pure resolvers (no React, no CSS) so both the item editor and any
// future caller read the same contract — same policy as dishComposition.js.
//
//   resolvePhotoDirection(tenant, item) -> direction for the venue's live theme,
//     enriched with the room's actual table material (resolveTable) so the
//     backdrop/lighting the model paints match the furniture the venue shows.
//   buildThemeFitPrompt(direction, {nameAr,nameEn,catName}) -> the full English
//     edit-prompt: preserve-the-exact-dish lock, camera, canvas, background,
//     vessel guidance by food family, negative list.
import { resolveSkin } from './skins.js'
import { resolveTable } from './dishComposition.js'
import { surfaceById } from './dishProps.js'

const WARM_LIGHT = 'warm key light from the upper left at about 35 degrees, soft fill from the right, warm highlights, soft natural shadows, no blown speculars, no cold blue cast'
const COOL_LIGHT = 'soft neutral daylight from the upper left, gentle fill from the right, clean highlights, soft natural shadows, no cold blue cast'

// The three-quarter fill shot most card layouts want. Shared by spread so a
// layout-specific entry overrides only what actually differs.
const SQUARE_FILL = {
  aspect: '1:1',
  aspectEn: 'square 1:1',
  px: [1200, 1200],
  cutout: false,
  circle: false,
  fit: 'cover',
  labelAr: 'مربع يملأ البطاقة',
  cameraEn: 'three-quarter angle from about 40 degrees above the rim, showing both the food volume and the vessel',
  compositionEn: 'the dish fills 90-100% of the frame, centred, edge to edge, no empty margins',
  backdropEn: 'a clean warm tabletop surface, softly blurred, the dish as the only subject',
  lightingEn: WARM_LIGHT,
}

const WIDE_FILL = {
  ...SQUARE_FILL,
  aspect: '4:3',
  aspectEn: '4:3 landscape',
  px: [1600, 1200],
  labelAr: 'عريض يملأ البطاقة',
  cameraEn: 'hero shot from 25-30 degrees above the rim with a slight three-quarter turn',
}

// Circular crop layouts: the vessel must survive a circle inscribed in the
// square, so it stays centred with real margin instead of touching the edges.
const CIRCLE_SAFE = {
  ...SQUARE_FILL,
  circle: true,
  labelAr: 'دائرة متمركزة',
  compositionEn: 'the whole vessel perfectly centred at 60-75% of the frame width with even margin on every side, so a circular crop never clips it',
}

// Flat-lay layouts that draw the photo as a round plate seen from above.
const OVERHEAD_PLATE = {
  ...SQUARE_FILL,
  circle: true,
  labelAr: 'طبق دائري من الأعلى',
  cameraEn: 'directly overhead at 90 degrees, a top-down flat lay',
  compositionEn: 'the round vessel perfectly centred at 70-80% of the frame width, even margin on every side',
}

// Transparent-cutout layouts: generated on a plain solid ground the client-side
// background removal can cut cleanly (the image model cannot emit alpha).
// `anchor`/`margin`/`widthFrac` drive the post-removal alpha trim (cutoutTrim):
// the model never composes pixel-flush against an edge, so the trim — not the
// prompt — is what guarantees the final placement inside the canvas.
const CUTOUT_SQUARE = {
  ...SQUARE_FILL,
  cutout: true,
  fit: 'contain',
  anchor: 'center',
  margin: 0.03,
  labelAr: 'قصاصة شفافة عائمة',
  cameraEn: 'three-quarter angle from about 30 degrees above the rim',
  compositionEn: 'the whole vessel fully visible with a small even margin on every side, nothing cropped, no part touching the frame edge',
}

// The editorial room (the fish-restaurant presentation): a wide cutout whose
// vessel base SITS on the bottom edge of the canvas, because the theme seats it
// on the venue's table lip. The bottom anchor is what stops the dish floating.
const EDITORIAL = {
  aspect: '4:3',
  aspectEn: '4:3 landscape',
  px: [1600, 1200],
  cutout: true,
  circle: false,
  fit: 'contain',
  anchor: 'bottom',
  widthFrac: 0.88,
  labelAr: 'قصاصة شفافة تجلس على حافة طاولة الثيم',
  cameraEn: 'from 25-30 degrees above the rim with a slight three-quarter angle, showing BOTH the food volume and the vessel rim — never top-down, never eye-level',
  compositionEn: "the vessel's base sits exactly ON the BOTTOM EDGE of the canvas, horizontally centred, so it reads as resting on a real tabletop; the dish occupies 85-92% of the frame width, no empty margins",
  backdropEn: '',
  lightingEn: 'warm tungsten key light from the upper left at about 35 degrees, soft fill from the right, warm highlights, soft shadows, no blown speculars, no cold blue cast',
}

// Keyed by menuLayout, NOT skin id — 41 skins share these layouts and the box
// geometry follows the layout (see LAYOUT_OPTIONS in skins.js).
export const PHOTO_DIRECTION = {
  list: SQUARE_FILL,
  minimal: { ...SQUARE_FILL, labelAr: 'مربع صغير يملأ البطاقة', compositionEn: `${SQUARE_FILL.compositionEn}; bold simple composition with high contrast that reads clearly at thumbnail size` },
  grid: SQUARE_FILL,
  bento: SQUARE_FILL,
  sidebar: SQUARE_FILL,
  catalog: SQUARE_FILL,
  coffeepan: SQUARE_FILL,
  cards: WIDE_FILL,
  alternating: WIDE_FILL,
  gallery: CIRCLE_SAFE,
  coffeelist: { ...CIRCLE_SAFE, labelAr: 'دائرة صغيرة متمركزة', compositionEn: `${CIRCLE_SAFE.compositionEn}; bold simple silhouette with high contrast — this renders very small` },
  plates: OVERHEAD_PLATE,
  oceanart: OVERHEAD_PLATE,
  storefront: CUTOUT_SQUARE,
  spotlight: CUTOUT_SQUARE,
  editorial: EDITORIAL,
}

// ------------------------------------------------------------ food families --
// Vessel guidance per food family, used ONLY to faithfully complete parts the
// source photo cropped or hid — never to replace the real vessel. Same matching
// discipline as dishProps.AUTO_RULES: specific dishes first, and the drink
// rules sit LAST because their words are the greedy ones ('ليمون' must not
// steal «سمك بالليمون»).
const FOOD_FAMILIES = [
  { id: 'soup', words: ['شوربة', 'شوربه', 'حساء', 'ملوخية', 'ملوخيه', 'مرق', 'soup', 'broth', 'stew', 'lentil'], vesselEn: 'a deep bowl on its saucer, filled to just below the rim, solid pieces breaking the liquid surface, gentle steam rising' },
  { id: 'salad', words: ['سلطة', 'سلطه', 'فتوش', 'تبولة', 'تبوله', 'بابا غنوج', 'طحينية', 'طحينيه', 'دكوة', 'دكوه', 'شطة', 'شطه', 'مقبلات', 'salad', 'fattoush', 'tabbouleh', 'hummus', 'dip', 'mezze'], vesselEn: 'a shallow round bowl with the food domed well above the rim, glossy dressing, a light oil sheen' },
  { id: 'rice', words: ['رز', 'أرز', 'ارز', 'كبسة', 'كبسه', 'مندي', 'بخاري', 'صيادية', 'صياديه', 'rice', 'kabsa', 'mandi', 'biryani'], vesselEn: 'a plate with the rice mounded into a tall dome of separated glistening grains' },
  { id: 'fries', words: ['بطاطس', 'مقلية', 'مقليه', 'fries', 'chips'], vesselEn: 'a plate with the fries stacked high, crisp and golden' },
  { id: 'bread', words: ['خبز', 'مناقيش', 'معجنات', 'فطاير', 'فطيرة', 'bread', 'loaf', 'manakish', 'pastry', 'croissant'], vesselEn: 'a woven basket or wooden board with the pieces stacked and overlapping, one broken open to show the crumb' },
  { id: 'dessert', words: ['حلى', 'حلا', 'حلويات', 'كيك', 'كيكة', 'كريم كرامل', 'كنافة', 'بسبوسة', 'فواكه', 'فواكة', 'dessert', 'cake', 'custard', 'caramel', 'fruit'], vesselEn: 'a small dessert plate, glossy sauce running naturally down the sides, cut pieces glistening' },
  { id: 'can', words: ['بيبسي', 'سفن', 'كولا', 'مياه', 'موية', 'غازي', 'علبة', 'pepsi', 'cola', 'soda', 'sprite', 'water bottle'], vesselEn: 'the chilled can or bottle upright, frosted with condensation beads, label facing forward and legible' },
  { id: 'hotdrink', words: ['قهوة', 'قهوه', 'جبنة', 'جبنه', 'براد', 'شاي', 'اسبريسو', 'إسبريسو', 'لاتيه', 'كابتشينو', 'coffee', 'espresso', 'latte', 'cappuccino', 'tea', 'jebena', 'teapot', 'chai'], vesselEn: 'the traditional pot or cup with a small serving glass beside it, amber liquid catching the light, gentle steam' },
  { id: 'mains', words: ['فيليه', 'فيلية', 'فيله', 'سمك', 'سمكة', 'هامور', 'سالمون', 'سلمون', 'جمبري', 'ربيان', 'بلطي', 'دنيس', 'قاروص', 'أقاشي', 'اقاشي', 'كبدة', 'كبده', 'مشوي', 'مشاوي', 'لحم', 'دجاج', 'ستيك', 'كباب', 'شاورما', 'برجر', 'برغر', 'fish', 'fillet', 'hamour', 'shrimp', 'prawn', 'tilapia', 'grill', 'grilled', 'meat', 'chicken', 'steak', 'liver', 'kebab', 'burger', 'shawarma'], vesselEn: 'a wide platter with the protein as the hero and the sides arranged around it, built with real height' },
  { id: 'colddrink', words: ['عصير', 'ليمون', 'برتقال', 'كركديه', 'كركدية', 'عرديب', 'تبلدي', 'شربوت', 'فراولة', 'فراوله', 'نعناع', 'سموذي', 'موهيتو', 'juice', 'lemonade', 'orange', 'smoothie', 'mojito', 'iced', 'hibiscus'], vesselEn: 'a tall clear glass filled to just below the rim, ice cubes, condensation beads, fresh garnish on the rim' },
]

// Same Arabic normalisation as dishProps (private there): strip diacritics,
// unify alef/ya/ta-marbuta so 'أرز' matches 'ارز'.
const norm = (s) => String(s == null ? '' : s)
  .toLowerCase()
  .replace(/[ً-ْٰ]/g, '')
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')

const matchFamily = (hay) => {
  if (!hay) return null
  for (const fam of FOOD_FAMILIES) {
    for (const w of fam.words) {
      if (hay.includes(norm(w))) return fam
    }
  }
  return null
}

// Two passes like dishProps.autoRuleFor: the dish's own name decides first;
// only when it says nothing does the category get a vote — otherwise a
// category called «مشروبات» would put every food in it into a glass.
export function foodFamilyFor({ nameAr = '', nameEn = '', catName = '' } = {}) {
  return matchFamily(norm([nameAr, nameEn].filter(Boolean).join(' | ')))
    || matchFamily(norm(catName))
}

// -------------------------------------------------------------- resolvers ----

// The venue's live direction: layout entry + room enrichment. The table
// material refines lighting always, and becomes the painted backdrop for the
// non-cutout layouts (cutout layouts drop the background anyway — there the
// material only decides how warm the light reads).
export function resolvePhotoDirection(tenant, item) {
  const layout = resolveSkin(tenant, 'menu')?.layout?.menuLayout || 'list'
  const d = { ...(PHOTO_DIRECTION[layout] || PHOTO_DIRECTION.list), layout }
  const tb = resolveTable(tenant, { item })
  const surf = tb && tb.kind === 'material' ? surfaceById(tb.material) : null
  if (tb && (tb.topUrl || tb.kind === 'image')) {
    // Photo tables and the «سطح الطبق» band carry no material id — and when a
    // band exists it, not the panel material, is what the dish sits on. Direct
    // the light (and the backdrop, for non-cutout layouts) from a generic warm
    // wood tabletop.
    d.surfaceEn = 'rustic wood tabletop'
    d.lightingEn = WARM_LIGHT
    if (!d.cutout) d.backdropEn = 'a rustic wood restaurant tabletop, softly blurred, the dish as the only subject'
  } else if (surf) {
    d.surfaceEn = surf.labelEn
    d.lightingEn = surf.tone === 'cool' ? COOL_LIGHT : WARM_LIGHT
    if (surf.reflective) d.lightingEn += ', a soft specular reflection of the vessel on the surface'
    if (!d.cutout) d.backdropEn = `a ${surf.labelEn.toLowerCase()} surface, softly blurred, the dish as the only subject`
  }
  return d
}

// Prepended by generateThemeFitImage when a pose reference image actually
// loads (the venue's last APPROVED cutout). Field lesson from the owner's own
// manual attempts: «change the angle, keep everything» alone rarely lands —
// what the model reliably obeys is a second image showing the target pose.
export const POSE_REF_LINE = 'TWO images are attached. The FIRST is the real dish to re-photograph. The SECOND shows ONLY the target camera angle, plate pose and seating on the canvas — match its perspective and placement exactly, but take NOTHING else from it: not its food, not its vessel, not its colours, not its garnish.'

// The full English edit-prompt. Ordered blocks: the preserve lock first (the
// one instruction that must win every conflict), then identity, camera, canvas,
// background, vessel completion, styling, the negative list, finish.
export function buildThemeFitPrompt(d, { nameAr = '', nameEn = '', catName = '' } = {}) {
  const name = [nameAr, nameEn].filter(Boolean).join(' / ')
  const family = foodFamilyFor({ nameAr, nameEn, catName })
  return [
    'RE-PHOTOGRAPH the dish in the attached photograph from a NEW CAMERA POSITION — physically move the camera around the same plate; never merely crop, tilt, stretch or distort the original pixels.',
    'PRESERVE THE EXACT DISH — same food, same ingredients, same colours, same textures, same serving vessel, same garnish. Do NOT invent, add, remove or substitute any food, ingredient or vessel.',
    name ? `The dish is "${name}"${catName ? ` (category: ${catName})` : ''}.` : '',
    `CAMERA: ${d.cameraEn}.`,
    `COMPOSITION: ${d.compositionEn}. Output canvas: ${d.aspectEn}, ${d.px[0]}x${d.px[1]} pixels.`,
    // No contact shadow: the model reserves a band under the vessel for it,
    // background removal then strips the shadow but keeps the canvas — and that
    // empty band is exactly what floated the dish above the theme's table. The
    // themes paint their own contact shadow on the live menu.
    d.cutout
      ? 'BACKGROUND: a seamless, solid, evenly lit light-gray (#f0f0f0) studio background. No table, no surface, no wall, no cloth, no props, no scenery. Absolutely NO shadow, reflection or glow below or around the vessel — the vessel is cleanly isolated on the plain ground. The background will be removed afterwards, so it must stay perfectly plain.'
      : `BACKGROUND: ${d.backdropEn}.`,
    `LIGHT: ${d.lightingEn}.`,
    family
      ? `VESSEL: keep the original serving vessel exactly as photographed. Only if parts of the dish or vessel are cropped or hidden in the source photo, complete them faithfully in the style of ${family.vesselEn}.`
      : 'VESSEL: keep the original serving vessel exactly as photographed; faithfully complete any parts the source photo cropped or hid.',
    'FOOD STYLING: the vessel must look generously full. Keep every component of the original dish clearly separated and identifiable, with natural height and layering, deliberate garnish placement, and visible surface detail (char marks, glaze, sear, crumb, moisture). Hot dishes may show faint natural steam; cold dishes and drinks light condensation.',
    `MUST NOT APPEAR: text, letters, numbers, watermarks, logos, hands, people, cutlery, napkins${d.cutout ? ', any background scenery, any tabletop, a cropped vessel rim' : ''}; no cartoon or illustration look, no oversaturation, no blur, no duplicate vessels, no sparse portion, no empty plate.`,
    'Photorealistic professional restaurant food photography, 85mm macro lens character, tack sharp across the food, natural appetising colour.',
  ].filter(Boolean).join('\n')
}
