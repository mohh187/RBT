// BRAND INSIGHT — derive a venue's real identity from the data it ALREADY has.
//
// This module NEVER invents a claim. Every field it returns is either a direct
// measurement of the venue's own records (theme colours, item names/prices/
// photos, category mix, published posts) or is explicitly flagged as a rough
// heuristic. Whatever cannot be measured is listed in `unknown` and repeated in
// the Arabic paragraph, so the assistant says "I don't know" instead of guessing.
//
// Pure and synchronous: it reads nothing from Firestore and WRITES NOTHING.
// Callers pass data they already loaded.
//
//   import { analyzeBrand } from './brandInsight.js'
//   const profile = analyzeBrand({ tenant, items, posts, categories })
//   profile.paragraph        -> Arabic style guidance for any AI prompt
//   profile.visualDirective  -> short English directive for image models
import { venueType, lex } from './venueTypes.js'

// ---------------------------------------------------------------------------
// small numeric helpers — Latin digits ONLY (brand hard rule), never toLocaleString
// ---------------------------------------------------------------------------
const n = (x) => String(x)
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)
const round1 = (x) => Math.round(x * 10) / 10

function median(nums) {
  const a = nums.slice().sort((x, y) => x - y)
  if (!a.length) return 0
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}

// ---------------------------------------------------------------------------
// colour: hex -> HSL -> plain Arabic description. This is a factual restatement
// of the colour the owner actually saved, not an interpretation of "brand mood".
// ---------------------------------------------------------------------------
export function hexToHsl(hex) {
  const raw = String(hex || '').trim().replace(/^#/, '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0))
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

const HUE_NAMES = [
  [15, 'أحمر'], [45, 'برتقالي'], [70, 'ذهبي'], [95, 'زيتوني'], [165, 'أخضر'],
  [200, 'تركوازي'], [255, 'أزرق'], [290, 'بنفسجي'], [335, 'أرجواني'], [361, 'أحمر'],
]
const hueName = (h) => (HUE_NAMES.find(([lim]) => h < lim) || [0, 'أحمر'])[1]
const temperatureOf = (h) => (h < 55 || h >= 320 ? 'دافئة' : h >= 165 && h < 300 ? 'باردة' : 'محايدة')

function describeColor(hex) {
  const hsl = hexToHsl(hex)
  if (!hsl) return null
  const sat = hsl.s < 12 ? 'رمادية شبه محايدة' : hsl.s < 40 ? 'هادئة' : hsl.s < 72 ? 'متوسطة الحيوية' : 'صريحة وقوية'
  const light = hsl.l < 28 ? 'داكنة' : hsl.l < 55 ? 'متوسطة' : hsl.l < 80 ? 'فاتحة' : 'فاتحة جداً'
  return {
    hex, hsl,
    hue: hueName(hsl.h),
    temperature: temperatureOf(hsl.h),
    saturation: sat,
    lightness: light,
    ar: `${hueName(hsl.h)} ${light}، درجة ${sat}`,
  }
}

// Skin ids -> the visual language each skin actually ships (kept in sync with
// src/lib/skins.js). Only the skins we genuinely know are described.
const SKIN_MOOD = {
  noir: { ar: 'داكن فاخر ليلي', en: 'dark luxurious night aesthetic' },
  luxe: { ar: 'ذهبي فاخر', en: 'gold luxury aesthetic' },
  classic: { ar: 'كلاسيكي نظيف', en: 'clean classic aesthetic' },
  paper: { ar: 'ورقي تحريري دافئ', en: 'warm print-editorial aesthetic' },
  wood: { ar: 'خشبي تراثي دافئ', en: 'warm heritage wood aesthetic' },
  nova: { ar: 'عصري جريء', en: 'bold modern aesthetic' },
  midnight: { ar: 'أزرق ليلي عميق', en: 'deep night-blue aesthetic' },
  golden: { ar: 'ذهبي دافئ', en: 'golden warm aesthetic' },
  editorial: { ar: 'مجلة داكنة بصور ضخمة', en: 'dark editorial magazine aesthetic, full-bleed photography' },
  oceanart: { ar: 'لوحة فنية غنية', en: 'rich painterly art-gallery aesthetic' },
}

// ---------------------------------------------------------------------------
// tone: keyword frequency over the venue's OWN item names + descriptions.
// This is a word-count, nothing more — the returned label always carries the
// count it was derived from so the assistant can quote its basis.
// ---------------------------------------------------------------------------
const TONE_LEXICON = {
  luxury: { ar: 'فاخر/راقٍ', words: ['فاخر', 'فخامة', 'راقي', 'راقٍ', 'نخبة', 'حصري', 'ملكي', 'ذهبي', 'مميز', 'استثنائي'] },
  heritage: { ar: 'تراثي أصيل', words: ['أصيل', 'اصيل', 'تراث', 'تراثي', 'بلدي', 'شعبي', 'عريق', 'قديم', 'جدتي', 'حجازي', 'نجدي'] },
  craft: { ar: 'حرفي مختص', words: ['مختص', 'سبيشالتي', 'تحميص', 'محمص', 'يدوي', 'حرفي', 'مقطر', 'إسبريسو', 'اسبريسو', 'طازج', 'يومي'] },
  health: { ar: 'صحي خفيف', words: ['صحي', 'دايت', 'خالي', 'قليل السكر', 'بروتين', 'نباتي', 'عضوي', 'لايت', 'بدون سكر'] },
  homey: { ar: 'بيتي دافئ', words: ['بيتي', 'دافئ', 'منزلي', 'محبوب', 'عائلي', 'مريح', 'كوزي'] },
  bold: { ar: 'جريء شبابي', words: ['ناري', 'حار', 'مزدوج', 'ضخم', 'وحش', 'انفجار', 'قوي', 'ماكس'] },
}

function analyzeTone(items) {
  const texts = []
  let described = 0
  let bilingual = 0
  let bangs = 0
  let descWords = 0
  for (const it of items) {
    const nameAr = String(it?.nameAr || '')
    const nameEn = String(it?.nameEn || '')
    const desc = String(it?.descAr || it?.descEn || '')
    if (nameAr) texts.push(nameAr)
    if (nameEn) bilingual++
    if (desc.trim()) {
      described++
      texts.push(desc)
      descWords += desc.trim().split(/\s+/).filter(Boolean).length
      bangs += (desc.match(/!/g) || []).length
    }
  }
  const blob = texts.join(' ')
  const hits = {}
  let total = 0
  for (const [key, def] of Object.entries(TONE_LEXICON)) {
    let c = 0
    for (const w of def.words) c += (blob.split(w).length - 1)
    if (c > 0) hits[key] = c
    total += c
  }
  const ranked = Object.entries(hits).sort((a, b) => b[1] - a[1])
  // A label is only claimed when there is a clear winner over enough matches.
  const dominant = ranked.length && ranked[0][1] >= 3 && (!ranked[1] || ranked[0][1] > ranked[1][1])
    ? { key: ranked[0][0], ar: TONE_LEXICON[ranked[0][0]].ar, matches: ranked[0][1] }
    : null
  return {
    describedCount: described,
    describedPct: pct(described, items.length),
    avgDescWords: described ? round1(descWords / described) : 0,
    bilingualPct: pct(bilingual, items.length),
    exclamations: bangs,
    keywordHits: hits,
    keywordTotal: total,
    dominant,
    basis: 'تكرار كلمات مفتاحية في أسماء وأوصاف الأصناف الفعلية',
    confidence: described >= 12 && total >= 6 ? 'high' : described >= 5 ? 'medium' : 'low',
  }
}

// ---------------------------------------------------------------------------
// price: real distribution. The band label is an explicit rule-of-thumb, not a
// market study — it carries heuristic:true and its own thresholds.
// ---------------------------------------------------------------------------
const SAR_BANDS = [
  { max: 15, id: 'value', ar: 'اقتصادي' },
  { max: 35, id: 'mid', ar: 'متوسط' },
  { max: 80, id: 'upper', ar: 'مرتفع' },
  { max: Infinity, id: 'premium', ar: 'فاخر' },
]

function analyzePrice(items, currency) {
  const prices = items.map((i) => Number(i?.price)).filter((p) => Number.isFinite(p) && p > 0)
  if (!prices.length) return { count: 0, currency, band: null, unknown: true }
  const med = median(prices)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const hit = SAR_BANDS.find((b) => med < b.max)
  const band = currency === 'SAR' && hit
    ? { id: hit.id, ar: hit.ar, heuristic: true, basis: 'قاعدة تقريبية على وسيط السعر بالريال (أقل من 15 اقتصادي، أقل من 35 متوسط، أقل من 80 مرتفع، وما فوق فاخر) — ليست دراسة سوق' }
    : null
  return {
    count: prices.length, currency,
    min: round1(min), max: round1(max), median: round1(med),
    avg: round1(prices.reduce((s, p) => s + p, 0) / prices.length),
    spread: round1(max - min),
    band,
  }
}

// ---------------------------------------------------------------------------
// main entry
// ---------------------------------------------------------------------------
export function analyzeBrand({ tenant = null, items = [], posts = [], categories = [] } = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : []
  const postList = Array.isArray(posts) ? posts.filter(Boolean) : []
  const catList = Array.isArray(categories) ? categories.filter(Boolean) : []
  const vt = venueType(tenant)
  const unknown = []

  // --- identity -------------------------------------------------------------
  const typeSet = !!tenant?.type
  if (!typeSet) unknown.push('نوع المنشأة غير محدد في الإعدادات — الوصف أدناه عام وليس مخصصاً لنشاطها')

  // --- palette --------------------------------------------------------------
  const brandHex = tenant?.skin?.overrides?.brand || tenant?.themeColor || ''
  const accentHex = tenant?.skin?.overrides?.accent || tenant?.themeAccent || ''
  const brand = describeColor(brandHex)
  const accent = describeColor(accentHex)
  const skinId = tenant?.skin?.skinId || ''
  const skinMood = SKIN_MOOD[skinId] || null
  if (!brand) unknown.push('لا يوجد لون هوية محفوظ — لا يمكن وصف لوحة الألوان')
  if (skinId && !skinMood) unknown.push(`الثيم «${skinId}» غير موصوف في هذا التحليل`)
  const palette = {
    brand, accent, skinId: skinId || null, skinMood,
    known: !!brand,
    temperature: brand?.temperature || null,
    darkUi: brand ? brand.hsl.l < 35 : null,
  }

  // --- menu shape -----------------------------------------------------------
  const withPhoto = list.filter((i) => !!i?.imageUrl).length
  const withGallery = list.filter((i) => Array.isArray(i?.images) && i.images.length > 1).length
  const with3d = list.filter((i) => !!(i?.model3dUrl || i?.arStandeeUrl)).length
  const withEffect = list.filter((i) => !!i?.effect).length
  const unavailable = list.filter((i) => i?.available === false).length
  const byCat = {}
  for (const i of list) byCat[i?.categoryId || '_none'] = (byCat[i?.categoryId || '_none'] || 0) + 1
  const catName = (id) => (id === '_none' ? 'بدون تصنيف' : (catList.find((c) => c.id === id)?.nameAr || catList.find((c) => c.id === id)?.nameEn || id))
  const catMix = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => ({ id, name: catName(id), count, share: pct(count, list.length) }))
  if (!list.length) unknown.push('لا توجد أصناف بعد — لا يمكن استنتاج نبرة الكتابة ولا مستوى الأسعار ولا الأسلوب البصري')
  else if (!withPhoto) unknown.push('لا توجد صور منتجات — الأسلوب البصري للمنشأة غير معروف')
  if (list.length && !catList.length) unknown.push('أسماء التصنيفات غير ممررة — عُرضت المعرفات بدل الأسماء')
  const menu = {
    total: list.length,
    withPhoto, photoPct: pct(withPhoto, list.length),
    withGallery, with3d, withEffect, unavailable,
    categories: catMix,
    categoryCount: Object.keys(byCat).length,
  }

  // --- tone + price ---------------------------------------------------------
  const tone = analyzeTone(list)
  if (list.length && !tone.describedCount) unknown.push('لا يوجد وصف مكتوب لأي صنف — نبرة الكتابة غير معروفة')
  const price = analyzePrice(list, tenant?.currency || 'SAR')
  if (price.unknown) unknown.push('لا أسعار صالحة — مستوى التسعير غير معروف')
  if (price.band && price.currency !== 'SAR') unknown.push('العملة ليست الريال — لم يُصنَّف مستوى السعر')

  // --- published voice (posts) ---------------------------------------------
  const postWords = postList.reduce((s, p) => s + String(p?.body || '').trim().split(/\s+/).filter(Boolean).length, 0)
  const publishing = {
    count: postList.length,
    withImage: postList.filter((p) => (p?.media || []).some((m) => m?.kind === 'image' && m?.url)).length,
    avgBodyWords: postList.length ? round1(postWords / postList.length) : 0,
  }
  if (!postList.length) unknown.push('لا منشورات سابقة — أسلوب المحتوى المنشور غير معروف')

  // --- overall confidence ---------------------------------------------------
  const signals = [typeSet, !!brand, list.length >= 5, tone.describedCount >= 5, withPhoto > 0, price.count > 0].filter(Boolean).length
  const confidence = signals >= 5 ? 'high' : signals >= 3 ? 'medium' : 'low'

  const profile = {
    venue: {
      name: tenant?.name || '',
      typeId: vt?.id || null, typeAr: vt?.ar || null, typeEn: vt?.en || null,
      typeSet,
      lex: {
        item: lex(tenant, 'item'), items: lex(tenant, 'items'), menu: lex(tenant, 'menu'),
        category: lex(tenant, 'category'), categories: lex(tenant, 'categories'),
        guest: lex(tenant, 'guest'), guests: lex(tenant, 'guests'), place: lex(tenant, 'place'),
      },
    },
    palette, menu, tone, price, publishing,
    unknown, confidence,
  }
  profile.paragraph = brandParagraph(profile)
  profile.visualDirective = brandVisualDirective(profile)
  return profile
}

// ---------------------------------------------------------------------------
// Arabic style guidance for text prompts. States its evidence, and states its
// gaps — never fills a gap with a guess.
// ---------------------------------------------------------------------------
export function brandParagraph(profile) {
  if (!profile) return ''
  const { venue, palette, menu, tone, price, publishing, unknown, confidence } = profile
  const L = venue.lex
  const out = []

  out.push(
    `هوية ${venue.name ? `«${venue.name}»` : 'المنشأة'}${venue.typeSet && venue.typeAr ? ` (${venue.typeAr})` : ''} كما تظهر من بياناتها الفعلية:`
  )

  if (palette.known) {
    const a = palette.accent ? `، ولون مميز ${palette.accent.ar} (${palette.accent.hex})` : ''
    out.push(`الألوان: اللون الأساسي ${palette.brand.ar} (${palette.brand.hex})${a} — لوحة ${palette.brand.temperature}${palette.darkUi ? ' على واجهة داكنة' : ''}.`)
  } else {
    out.push('الألوان: لا يوجد لون هوية محفوظ.')
  }
  if (palette.skinMood) out.push(`الثيم المستخدم «${palette.skinId}» لغته البصرية: ${palette.skinMood.ar}.`)

  if (menu.total) {
    const top = menu.categories[0]
    out.push(
      `${L.menu}: ${n(menu.total)} من ${L.items} في ${n(menu.categoryCount)} تصنيفاً` +
      (top ? `، أكبرها «${top.name}» بنسبة ${n(top.share)} بالمئة` : '') +
      `. الصور: ${n(menu.withPhoto)} من ${n(menu.total)} (${n(menu.photoPct)} بالمئة)` +
      (menu.with3d ? `، و${n(menu.with3d)} بمجسم ثلاثي الأبعاد` : '') + '.'
    )
  } else {
    out.push(`${L.menu}: لا ${L.items} بعد.`)
  }

  if (tone.describedCount) {
    out.push(
      `الكتابة: ${n(tone.describedCount)} من ${L.items} لها وصف (${n(tone.describedPct)} بالمئة)، بمتوسط ${n(tone.avgDescWords)} كلمة للوصف` +
      (tone.bilingualPct ? `، و${n(tone.bilingualPct)} بالمئة لها اسم إنجليزي` : '') + '.' +
      (tone.dominant
        ? ` النبرة الغالبة: ${tone.dominant.ar} (بناءً على ${n(tone.dominant.matches)} تطابقاً لكلمات مفتاحية — مؤشر لغوي لا حكم نهائي).`
        : ' لا تظهر نبرة غالبة واضحة من الكلمات المستخدمة.')
    )
  } else if (menu.total) {
    out.push('الكتابة: لا يوجد وصف مكتوب لأي صنف، فنبرة الكتابة غير معروفة.')
  }

  if (price.count) {
    out.push(
      `الأسعار: من ${n(price.min)} إلى ${n(price.max)} ${price.currency}، الوسيط ${n(price.median)}` +
      (price.band ? ` — شريحة ${price.band.ar} حسب قاعدة تقريبية معلنة، وليست مقارنة بالسوق.` : '.')
    )
  }

  if (publishing.count) {
    out.push(`المنشورات السابقة: ${n(publishing.count)}، منها ${n(publishing.withImage)} بصورة، بمتوسط ${n(publishing.avgBodyWords)} كلمة.`)
  }

  out.push(
    `استخدم هذه المعطيات كموجّه أسلوبي: التزم بلوحة ألوانها ونبرتها، وسمِّ المنتج «${L.item}» و${L.menu} بمسماها الصحيح، ولا تقترح أي شيء لا تبيعه هذه المنشأة.`
  )

  if (unknown.length) out.push(`ما لا نعرفه (لا تخترعه): ${unknown.join(' | ')}.`)
  out.push(`درجة الثقة في هذا الملف: ${confidence === 'high' ? 'عالية' : confidence === 'medium' ? 'متوسطة' : 'منخفضة (بيانات قليلة)'}.`)

  return out.join(' ')
}

// ---------------------------------------------------------------------------
// Short English directive for image models (they compose better in English).
// Only states what was actually measured.
// ---------------------------------------------------------------------------
export function brandVisualDirective(profile) {
  if (!profile) return ''
  const bits = []
  const { palette, venue, price } = profile
  if (venue.typeSet && venue.typeEn) bits.push(`a ${venue.typeEn}`)
  if (palette.known) {
    bits.push(`brand palette built on ${palette.brand.hex}${palette.accent ? ` with ${palette.accent.hex}` : ''} (${palette.brand.temperature === 'دافئة' ? 'warm' : palette.brand.temperature === 'باردة' ? 'cool' : 'neutral'} ${palette.brand.lightness === 'داكنة' ? 'dark' : 'light'} tones) — keep this the dominant colour mood`)
  }
  if (palette.skinMood) bits.push(palette.skinMood.en)
  if (price?.band) bits.push(`${price.band.id === 'value' ? 'accessible everyday' : price.band.id === 'premium' ? 'high-end premium' : price.band.id === 'upper' ? 'upscale' : 'mid-market'} positioning`)
  if (!bits.length) return ''
  return `Brand direction: ${bits.join(', ')}.`
}

export default analyzeBrand
