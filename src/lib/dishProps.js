// Dish prop & surface library — the DATA half of the editorial theme's styling
// layer. A dish photo in this theme is usually a TRANSPARENT cutout floating on
// near-black; this library gives it a material to stand on (a surface) and a
// scatter of garnish elements around it (props) so the shot reads as a styled
// food photograph instead of a sticker.
//
// This file holds ONLY the catalogue + the resolver. The drawing (inline SVG)
// lives in components/menuThemes/DishProps.jsx and the material/motion in
// styles/dishprops.css, so an admin screen can import the catalogue to build a
// picker without pulling in React or CSS.
//
// Contract with the item document (both optional, safe defaults when absent):
//   item.surface : 'none' | '<surface id>'
//   item.props   : 'none' | false
//                | ['mintLeaf', 'lemonWedge']                       (auto-scattered)
//                | [{ id, x, y, scale, rot, depth, flip }]          (explicit placement)
//                | { ids: [...], density: 'low'|'normal'|'rich', seed, surface }
// Anything unrecognised falls back to the automatic choice. Props are pure
// decoration: they never assert an ingredient, never carry text, and the whole
// layer is aria-hidden.

// ---------------------------------------------------------------- surfaces --

// grain -> which hand-authored SVG overlay DishProps draws on the plane.
// reflective -> the material earns a soft specular smear under the dish.
export const SURFACES = [
  { id: 'darkMarble',   labelAr: 'رخام داكن',   labelEn: 'Dark marble',  grain: 'marble', reflective: true,  tone: 'cool' },
  { id: 'warmWood',     labelAr: 'طاولة خشب',   labelEn: 'Warm wood',    grain: 'wood',   reflective: false, tone: 'warm' },
  { id: 'brushedSteel', labelAr: 'ستيل مصقول',  labelEn: 'Brushed steel', grain: 'steel',  reflective: true,  tone: 'cool' },
  { id: 'slate',        labelAr: 'حجر أردوازي', labelEn: 'Slate',        grain: 'slate',  reflective: false, tone: 'cool' },
  { id: 'linen',        labelAr: 'قماش كتّان',  labelEn: 'Linen cloth',  grain: 'linen',  reflective: false, tone: 'warm' },
  { id: 'shelf',        labelAr: 'حافة رف',     labelEn: 'Shelf edge',   grain: 'shelf',  reflective: false, tone: 'warm' },
]
export const SURFACE_IDS = SURFACES.map((s) => s.id)
export const surfaceById = (id) => SURFACES.find((s) => s.id === id) || null

// ------------------------------------------------------------------- props --

// category  : grouping for an admin picker
// motion    : which arrival family the element uses
//               drift  — light things that fall through air and rock (petals, leaves)
//               drop   — things with mass that fall, squash once and still (ice, tomato)
//               tumble — small hard grains that roll into place (seeds, peppercorn)
//               lay    — things a hand placed (sprigs, sticks, wedges)
// size      : natural width as a percentage of the photo box width
// upright   : true  -> rotation stays near vertical (a chilli does not lie upside down)
// cluster   : [min, max] instances the auto-scatter may drop of this prop
// idle      : element keeps a very small idle life once settled
// shine     : element carries a specular path that glints slowly (ice, steel-ish)
export const PROPS = [
  { id: 'hibiscusPetal', labelAr: 'وردة كركديه',  labelEn: 'Hibiscus petal', category: 'petal',  motion: 'drift',  size: 8.5, upright: false, cluster: [2, 4], idle: true },
  { id: 'mintLeaf',      labelAr: 'ورقة نعناع',   labelEn: 'Mint leaf',      category: 'herb',   motion: 'drift',  size: 8.0, upright: false, cluster: [1, 3], idle: true },
  { id: 'parsley',       labelAr: 'بقدونس',       labelEn: 'Parsley',        category: 'herb',   motion: 'drift',  size: 9.5, upright: false, cluster: [1, 2], idle: true },
  { id: 'herbSprig',     labelAr: 'غصن أعشاب',    labelEn: 'Herb sprig',     category: 'herb',   motion: 'lay',    size: 13.5, upright: true, cluster: [1, 2], idle: true },
  { id: 'lemonSlice',    labelAr: 'شريحة ليمون',  labelEn: 'Lemon slice',    category: 'citrus', motion: 'drop',   size: 11.5, upright: false, cluster: [1, 2] },
  { id: 'lemonWedge',    labelAr: 'قطعة ليمون',   labelEn: 'Lemon wedge',    category: 'citrus', motion: 'lay',    size: 10.5, upright: false, cluster: [1, 2] },
  { id: 'garlicClove',   labelAr: 'فص ثوم',       labelEn: 'Garlic clove',   category: 'allium', motion: 'drop',   size: 8.0, upright: false, cluster: [1, 3] },
  { id: 'chilli',        labelAr: 'فلفل حار',     labelEn: 'Chilli',         category: 'spice',  motion: 'lay',    size: 12.5, upright: true, cluster: [1, 2], idle: true },
  // the two smallest entries: pushed off the sub-pixel floor, since the back
  // layer shrinks them again and a two-pixel seed just reads as dirt
  { id: 'peppercorn',    labelAr: 'حبة فلفل',     labelEn: 'Peppercorn',     category: 'seed',   motion: 'tumble', size: 3.6, upright: false, cluster: [3, 6] },
  { id: 'sesame',        labelAr: 'سمسم',         labelEn: 'Sesame',         category: 'seed',   motion: 'tumble', size: 2.9, upright: false, cluster: [4, 8] },
  { id: 'coffeeBean',    labelAr: 'حبة بن',       labelEn: 'Coffee bean',    category: 'seed',   motion: 'tumble', size: 5.4, upright: false, cluster: [2, 5] },
  { id: 'cardamom',      labelAr: 'هيل',          labelEn: 'Cardamom',       category: 'spice',  motion: 'tumble', size: 5.0, upright: false, cluster: [2, 4] },
  { id: 'cinnamonStick', labelAr: 'عود قرفة',     labelEn: 'Cinnamon stick', category: 'spice',  motion: 'lay',    size: 13.0, upright: false, cluster: [1, 1] },
  { id: 'saltCrystals',  labelAr: 'بلورات ملح',   labelEn: 'Salt crystals',  category: 'seed',   motion: 'tumble', size: 4.0, upright: false, cluster: [2, 4] },
  { id: 'iceCube',       labelAr: 'مكعب ثلج',     labelEn: 'Ice cube',       category: 'ice',    motion: 'drop',   size: 10.0, upright: false, cluster: [1, 2], shine: true },
  { id: 'tomato',        labelAr: 'طماطم',        labelEn: 'Tomato',         category: 'veg',    motion: 'drop',   size: 9.5, upright: false, cluster: [1, 2], shine: true },
  { id: 'olive',         labelAr: 'زيتون',        labelEn: 'Olive',          category: 'veg',    motion: 'drop',   size: 6.5, upright: false, cluster: [1, 3] },
]
export const PROP_IDS = PROPS.map((p) => p.id)
export const propById = (id) => PROPS.find((p) => p.id === id) || null

// Groups for a future picker UI (ids only — labels live on the entries above).
export const PROP_CATEGORIES = [
  { id: 'petal',  labelAr: 'بتلات',   labelEn: 'Petals' },
  { id: 'herb',   labelAr: 'أعشاب',   labelEn: 'Herbs' },
  { id: 'citrus', labelAr: 'حمضيات',  labelEn: 'Citrus' },
  { id: 'spice',  labelAr: 'بهارات',  labelEn: 'Spices' },
  { id: 'seed',   labelAr: 'بذور',    labelEn: 'Seeds' },
  { id: 'allium', labelAr: 'ثوم وبصل', labelEn: 'Allium' },
  { id: 'veg',    labelAr: 'خضار',    labelEn: 'Vegetables' },
  { id: 'ice',    labelAr: 'ثلج',     labelEn: 'Ice' },
]

// ---------------------------------------------------------- auto defaults ---

// Keyword -> styling. First match wins, so the specific rules (fish, coffee)
// sit above the broad ones (hot dish, fallback). Matching runs over the item
// name (both languages), its category name and its ingredient lines.
// These only DECORATE: nothing here is rendered as a claim about the dish.
const AUTO_RULES = [
  {
    id: 'hibiscus',
    words: ['كركديه', 'karkade', 'hibiscus', 'عناب'],
    surface: 'darkMarble',
    props: ['hibiscusPetal', 'iceCube', 'mintLeaf'],
  },
  {
    id: 'coffee',
    words: ['قهوة', 'قهوه', 'اسبريسو', 'إسبريسو', 'لاتيه', 'كابتشينو', 'كابوتشينو', 'مكياتو', 'موكا', 'coffee', 'espresso', 'latte', 'cappuccino', 'americano', 'macchiato', 'mocha', 'flat white'],
    surface: 'warmWood',
    props: ['coffeeBean', 'cardamom', 'cinnamonStick'],
  },
  {
    id: 'seafood',
    words: ['سمك', 'سمكة', 'سلمون', 'هامور', 'ربيان', 'جمبري', 'صاج', 'بحري', 'مأكولات بحرية', 'fish', 'salmon', 'shrimp', 'prawn', 'seafood', 'hamour', 'tuna', 'calamari'],
    surface: 'slate',
    props: ['lemonWedge', 'parsley', 'chilli', 'garlicClove'],
  },
  {
    id: 'grill',
    words: ['مشوي', 'مشاوي', 'لحم', 'دجاج', 'كباب', 'شاورما', 'ستيك', 'تكا', 'grill', 'grilled', 'meat', 'chicken', 'kebab', 'steak', 'shawarma', 'beef', 'lamb', 'bbq'],
    surface: 'slate',
    props: ['chilli', 'garlicClove', 'herbSprig', 'saltCrystals'],
  },
  {
    id: 'rice',
    words: ['رز', 'أرز', 'ارز', 'كبسة', 'مندي', 'مضغوط', 'بخاري', 'مظبي', 'rice', 'kabsa', 'mandi', 'biryani', 'madfoon'],
    surface: 'warmWood',
    props: ['cardamom', 'cinnamonStick', 'peppercorn'],
  },
  {
    id: 'salad',
    words: ['سلطة', 'سلطه', 'فتوش', 'تبولة', 'تبوله', 'salad', 'fattoush', 'tabbouleh', 'greens'],
    surface: 'linen',
    props: ['tomato', 'olive', 'parsley', 'lemonWedge'],
  },
  {
    id: 'sandwich',
    words: ['برجر', 'برغر', 'ساندويتش', 'ساندوتش', 'شطيرة', 'راب', 'burger', 'sandwich', 'wrap', 'sub', 'club'],
    surface: 'brushedSteel',
    props: ['sesame', 'tomato', 'chilli'],
  },
  {
    id: 'dessert',
    words: ['حلى', 'حلا', 'حلويات', 'كيك', 'كيكة', 'تشيز', 'كنافة', 'بسبوسة', 'وافل', 'بان كيك', 'آيس كريم', 'ايس كريم', 'dessert', 'cake', 'cheesecake', 'brownie', 'waffle', 'pancake', 'ice cream', 'pudding'],
    surface: 'darkMarble',
    props: ['mintLeaf', 'cinnamonStick', 'coffeeBean'],
  },
  {
    id: 'bakery',
    words: ['خبز', 'معجنات', 'فطاير', 'فطيرة', 'عجينة', 'مناقيش', 'بيتزا', 'كرواسون', 'bread', 'pastry', 'pizza', 'manakish', 'croissant', 'bun', 'toast'],
    surface: 'warmWood',
    props: ['sesame', 'herbSprig', 'olive'],
  },
  {
    id: 'soup',
    words: ['شوربة', 'شوربه', 'حساء', 'soup', 'broth', 'lentil'],
    surface: 'linen',
    props: ['parsley', 'peppercorn', 'lemonWedge'],
  },
  {
    id: 'breakfast',
    words: ['فطور', 'بيض', 'شكشوكة', 'عجة', 'فول', 'breakfast', 'egg', 'eggs', 'shakshuka', 'omelette', 'foul'],
    surface: 'linen',
    props: ['tomato', 'parsley', 'chilli'],
  },
  // The drink rules sit LAST on purpose: their words are the greedy ones.
  // 'ليمون' would otherwise steal «سمك بالليمون» and «كيكة ليمون», and 'نعناع'
  // would turn a mojito into a pot of tea.
  {
    id: 'colddrink',
    words: ['عصير', 'ليمون', 'ليمونادة', 'موهيتو', 'مشروب بارد', 'آيس', 'ايس', 'سموذي', 'مياه', 'juice', 'lemonade', 'mojito', 'iced', 'smoothie', 'soda', 'cold brew', 'refresher'],
    surface: 'darkMarble',
    props: ['lemonSlice', 'mintLeaf', 'iceCube'],
  },
  {
    id: 'tea',
    words: ['شاي', 'نعناع', 'زهورات', 'tea', 'mint', 'matcha', 'chai', 'herbal'],
    surface: 'warmWood',
    props: ['mintLeaf', 'cardamom', 'lemonSlice'],
  },
]

// Neutral styling when nothing matches — still looks deliberate, claims nothing.
const FALLBACK_RULE = { id: 'default', surface: 'warmWood', props: ['herbSprig', 'peppercorn', 'saltCrystals'] }

const norm = (s) => String(s == null ? '' : s)
  .toLowerCase()
  // strip Arabic diacritics and unify alef/ya/ta-marbuta so 'أرز' matches 'ارز'
  .replace(/[ً-ْٰ]/g, '')
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')

const matchRule = (hay) => {
  if (!hay) return null
  for (const rule of AUTO_RULES) {
    for (const w of rule.words) {
      if (hay.includes(norm(w))) return rule
    }
  }
  return null
}

// Which styling rule an item falls under. Exported so an admin picker can show
// «سيُختار تلقائياً» next to the automatic choice.
// Two passes on purpose: the dish's own name decides first, and only when it
// says nothing useful do the category and the ingredient lines get a vote —
// otherwise a category called «مشاوي» would restyle every drink inside it.
export function autoRuleFor(item, catName) {
  const it = item || {}
  const byName = matchRule(norm([it.nameAr, it.nameEn, it.name].filter(Boolean).join(' | ')))
  if (byName) return byName
  // Array.isArray, not a truthiness check: a `tags` value that is a string or an
  // object (perfectly possible from imported or assistant-written data) would
  // throw here, and there is NO error boundary around the menu — so one odd
  // field would white-screen the whole thing rather than skip one garnish.
  const parts = [catName, Array.isArray(it.tags) ? it.tags.join(' ') : '']
  const ings = Array.isArray(it.ingredients) ? it.ingredients : []
  ings.slice(0, 8).forEach((g) => { parts.push(g && (g.nameAr || g.nameEn || g.name)) })
  return matchRule(norm(parts.filter(Boolean).join(' | '))) || FALLBACK_RULE
}

// ------------------------------------------------------------------- rng ----

// Deterministic per item: the same dish scatters the same way on every render
// and on every device, so nothing jitters when a section re-enters the viewport.
const hashStr = (s) => {
  let h = 2166136261 >>> 0
  const str = String(s || 'dish')
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
const mulberry = (seed) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ------------------------------------------------------------- placement ----

const DENSITY = { low: 6, normal: 10, rich: 14 }
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

// The plate's body. Front props keep clear of it so the scatter FRAMES the food
// instead of burying it — except at the very bottom of the frame, where a prop
// nearest the camera is allowed to overlap the plate's lower edge, which is how
// a real food photograph reads depth.
const DISH_ZONE = { cx: 50, cy: 82, rx: 24, ry: 11 }
const inDishZone = (x, y) => {
  const dx = (x - DISH_ZONE.cx) / DISH_ZONE.rx
  const dy = (y - DISH_ZONE.cy) / DISH_ZONE.ry
  return dx * dx + dy * dy < 1
}

// Rejection sampling inside the surface band. `horizon` is the top edge of the
// material (percent from the top of the photo box): nothing may sit above it,
// or the prop would float in the dark canvas with no table under it.
// Falls back to the last try so a crowded scatter still renders something.
function pickSpot(rand, placed, depth, spread, horizon) {
  const depthOf = 100 - horizon
  let best = null
  for (let attempt = 0; attempt < 14; attempt += 1) {
    let x
    let y
    if (depth === 'back') {
      // further up the table, hugging the sides where the plate does not hide it
      const side = rand() < 0.5 ? -1 : 1
      x = 50 + side * (17 + rand() * 31)
      y = horizon + depthOf * (0.08 + rand() * 0.32)
    } else {
      // nearer the camera and denser toward the base: u^0.55 pulls samples down.
      // The band stops short of the very bottom edge so samples do not pile up
      // against the clamp.
      x = 4 + rand() * 92
      y = horizon + depthOf * (0.31 + 0.575 * Math.pow(rand(), 0.55))
      if (inDishZone(x, y)) continue
    }
    x = clamp(x, 3, 97)
    y = clamp(y, horizon + 1, 98)
    const cand = { x, y }
    const tooClose = placed.some((p) => {
      const dx = p.x - x
      const dy = (p.y - y) * 1.15 // the band is shallow; do not over-reject on y
      return Math.sqrt(dx * dx + dy * dy) < spread
    })
    if (!tooClose) return cand
    best = cand
  }
  return best || { x: 50, y: horizon + depthOf * 0.8 }
}

function rotationFor(rand, spec) {
  if (spec.upright) return Math.round((rand() * 2 - 1) * 26)
  return Math.round((rand() * 2 - 1) * 168)
}

// Build one placed instance from a catalogue entry. Size follows the spot:
// the nearer the base a prop landed, the nearer the camera it reads, so it is
// drawn larger. That single link is most of what sells the plane as a plane.
function instance(spec, spot, depth, rand, order, horizon) {
  const jitter = 0.82 + rand() * 0.46
  const near = clamp((spot.y - horizon) / Math.max(1, 100 - horizon), 0, 1)
  const depthScale = depth === 'back' ? 0.66 + near * 0.14 : 0.88 + near * 0.4
  return {
    key: `${spec.id}-${order}`,
    id: spec.id,
    x: Math.round(spot.x * 10) / 10,
    y: Math.round(spot.y * 10) / 10,
    // width as a percentage of the photo box
    w: Math.round(spec.size * jitter * depthScale * 10) / 10,
    rot: rotationFor(rand, spec),
    flip: rand() < 0.5,
    depth,
    motion: spec.motion,
    shine: !!spec.shine,
    idle: !!spec.idle,
    // horizontal drift amplitude for the falling families (px, signed)
    dx: Math.round((rand() * 2 - 1) * 16),
    delay: 0,
  }
}

// Normalise whatever the venue put on the document into a plain request.
function readConfig(item) {
  const raw = item && item.props
  if (raw === false || raw === 'none' || raw === '') return { off: true }
  if (Array.isArray(raw) && raw.length) {
    const explicit = raw.filter((e) => e && typeof e === 'object' && e.id)
    if (explicit.length) return { explicit }
    const ids = raw.filter((e) => typeof e === 'string' && propById(e))
    if (ids.length) return { ids }
    return {}
  }
  if (raw && typeof raw === 'object') {
    if (raw.off === true) return { off: true }
    const explicit = Array.isArray(raw.items) ? raw.items.filter((e) => e && e.id) : []
    if (explicit.length) return { explicit, density: raw.density, seed: raw.seed, surface: raw.surface }
    const ids = Array.isArray(raw.ids) ? raw.ids.filter((e) => typeof e === 'string' && propById(e)) : []
    return { ids: ids.length ? ids : null, density: raw.density, seed: raw.seed, surface: raw.surface }
  }
  return {}
}

/**
 * resolveDishProps(item, options) -> { surface, props, plane }
 *   surface : a SURFACES entry, or null when the venue turned it off
 *   props   : placed instances, sorted back-to-front, each with x/y/w/rot/delay
 *   plane   : how tall the surface band is, as a percentage of the photo box
 * Never throws on a malformed document: an unknown id is dropped, an unknown
 * surface falls back to the automatic pick.
 */
export function resolveDishProps(item, options) {
  const it = item || {}
  const opts = options || {}
  const variant = opts.variant === 'stage' ? 'stage' : 'list'
  const cfg = readConfig(it)

  // OPT-IN, NOT OPT-OUT. This used to decorate every dish automatically from a
  // keyword guess, which put garnish on plates that never asked for it and made
  // the menu look busy rather than styled. Decoration is a choice the venue
  // makes per dish; nothing is drawn until it does.
  const chosen = !!(cfg.explicit || cfg.ids || cfg.surface || it.surface)
  if (!chosen) return { surface: null, props: [], plane: 0 }

  const rule = autoRuleFor(it, opts.catName)

  // surface: explicit id wins, then a surface set inside item.props, then auto
  const wantSurface = it.surface || cfg.surface || rule.surface
  const surface = wantSurface === 'none' || wantSurface === false
    ? null
    : (surfaceById(wantSurface) || surfaceById(rule.surface))

  // how tall the material band is, and therefore where its far edge sits
  const plane = variant === 'stage' ? 20 : 26
  const horizon = 100 - plane

  if (cfg.off) return { surface, props: [], plane }

  const seed = hashStr(cfg.seed || it.id || it.nameEn || it.nameAr || 'dish')
  const rand = mulberry(seed)
  // the stage view already gives the dish a lot of air; keep it quieter there
  const cap = Math.min(
    DENSITY[cfg.density] || DENSITY.normal,
    variant === 'stage' ? 7 : 11,
  )

  let placed = []

  if (cfg.explicit) {
    // Explicit placement: the venue positioned each element itself. Missing
    // numbers still fall back to a sensible auto value rather than zero.
    placed = cfg.explicit.slice(0, 16).map((e, i) => {
      const spec = propById(e.id)
      if (!spec) return null
      const depth = e.depth === 'back' ? 'back' : 'front'
      const auto = instance(spec, { x: 50, y: horizon + plane * 0.7 }, depth, rand, i, horizon)
      return {
        ...auto,
        // explicit placement is trusted as given — a venue that wants a petal
        // hanging off the top edge gets a petal hanging off the top edge
        x: clamp(num(e.x, auto.x), -5, 105),
        y: clamp(num(e.y, auto.y), -5, 105),
        w: clamp(num(e.scale, 1) * spec.size, 1, 60),
        rot: num(e.rot, auto.rot),
        flip: e.flip === undefined ? auto.flip : !!e.flip,
      }
    }).filter(Boolean)
  } else {
    const ids = (cfg.ids && cfg.ids.length ? cfg.ids : rule.props).filter((id) => propById(id))
    const specs = ids.length ? ids : FALLBACK_RULE.props
    let order = 0
    // one pass per catalogue entry, each dropping a small varied cluster
    specs.forEach((id, si) => {
      const spec = propById(id)
      if (!spec) return
      const [lo, hi] = spec.cluster || [1, 1]
      let count = lo + Math.floor(rand() * (hi - lo + 1))
      if (placed.length + count > cap) count = Math.max(0, cap - placed.length)
      for (let i = 0; i < count; i += 1) {
        // the first entry of a rule is the hero garnish: keep it in front
        const depth = si === 0 ? 'front' : (rand() < 0.28 ? 'back' : 'front')
        const spread = Math.max(7, spec.size * 0.9)
        const spot = pickSpot(rand, placed, depth, spread, horizon)
        placed.push(instance(spec, spot, depth, rand, order, horizon))
        order += 1
      }
    })
  }

  // Paint order and arrival order both run far-to-near: the things deepest in
  // the frame settle first, the nearest garnish lands last.
  placed.sort((a, b) => (a.depth === b.depth ? a.y - b.y : (a.depth === 'back' ? -1 : 1)))
  let idleBudget = 5
  placed = placed.map((p, i) => {
    const idle = p.idle && idleBudget > 0
    if (idle) idleBudget -= 1
    return {
      ...p,
      idle,
      // ms, staggered but not metronomic — the jitter comes off the same seed.
      // Capped so the last grain never lands more than a second late.
      delay: Math.min(120 + i * 78, 820) + Math.round(hashStr(p.key + seed) % 70),
    }
  })

  return { surface, props: placed, plane }
}

export default { SURFACES, PROPS, PROP_CATEGORIES, resolveDishProps, autoRuleFor }
