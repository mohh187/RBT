// VENUE TYPES — the system reshapes itself around WHAT the business actually
// sells. A cafe's «مشروب» is a restaurant's «طبق» and a perfumery's «منتج»,
// and the AI must know the difference before it writes a caption, generates an
// image, or advises on pricing. Everything venue-specific flows through here.
//
// tenant.type holds the id. A venue may also set tenant.lexOverrides to tune
// individual words (the «نشاط آخر» path), and tenant.typeLabel for a custom
// business name. Unknown/unset types degrade to neutral hospitality wording —
// never to cafe wording — so nothing reads wrong for a business we did not
// anticipate.

// The full lexicon every surface may ask for. Keep keys stable; add, never rename.
const NEUTRAL_LEX = {
  item: 'صنف',
  items: 'الأصناف',
  itemNew: 'صنف جديد',
  menu: 'القائمة',
  category: 'تصنيف',
  categories: 'التصنيفات',
  order: 'طلب',
  orderVerb: 'اطلب',
  cart: 'السلة',
  guest: 'عميل',
  guests: 'العملاء',
  place: 'المنشأة',
}

const mk = (over) => ({ ...NEUTRAL_LEX, ...over })

export const VENUE_TYPES = [
  {
    id: 'cafe', ar: 'مقهى / كافيه', en: 'Cafe', icon: 'coffee',
    tags: ['cafe'],
    lex: mk({ item: 'مشروب', items: 'المشروبات', itemNew: 'مشروب جديد', menu: 'المنيو', place: 'المقهى' }),
    aiPersona: 'مقهى مختص بالقهوة والمشروبات، تجربته قائمة على جودة التحضير وأجواء الجلسة والطقس اليومي للزبون',
  },
  {
    id: 'restaurant', ar: 'مطعم', en: 'Restaurant', icon: 'menu',
    tags: ['restaurant'],
    lex: mk({ item: 'طبق', items: 'الأطباق', itemNew: 'طبق جديد', menu: 'المنيو', place: 'المطعم' }),
    aiPersona: 'مطعم يقدّم وجبات وأطباقاً رئيسية، وقيمته في الطزاجة وحجم الطبق وسرعة التقديم وتجربة المائدة',
  },
  {
    id: 'seafood', ar: 'مطعم أسماك ومأكولات بحرية', en: 'Seafood', icon: 'menu',
    tags: ['restaurant', 'seafood'],
    lex: mk({ item: 'طبق', items: 'الأطباق', itemNew: 'طبق جديد', menu: 'المنيو', place: 'المطعم' }),
    aiPersona: 'مطعم مأكولات بحرية، محور تسويقه الطزاجة اليومية ومصدر السمك وطريقة الطهي (مشوي/صاج/مقلي) وتجربة الوليمة الجماعية',
  },
  {
    id: 'grill', ar: 'مشاوي ولحوم', en: 'Grill', icon: 'flame',
    tags: ['restaurant', 'grill'],
    lex: mk({ item: 'طبق', items: 'الأطباق', itemNew: 'طبق جديد', menu: 'المنيو', place: 'المطعم' }),
    aiPersona: 'مطعم مشاوي ولحوم، تبرز فيه جودة اللحم ودرجة النضج والفحم والتقديم العائلي',
  },
  {
    id: 'fastfood', ar: 'وجبات سريعة', en: 'Fast food', icon: 'bag',
    tags: ['restaurant', 'fastfood'],
    lex: mk({ item: 'وجبة', items: 'الوجبات', itemNew: 'وجبة جديدة', menu: 'المنيو', place: 'المطعم' }),
    aiPersona: 'مطعم وجبات سريعة، أولوياته السرعة والقيمة مقابل السعر والوجبات المركبة والعروض',
  },
  {
    id: 'sweets', ar: 'حلويات وكيك', en: 'Sweets', icon: 'cake',
    tags: ['sweets'],
    lex: mk({ item: 'صنف', items: 'الحلويات', itemNew: 'صنف جديد', menu: 'قائمة الحلويات', place: 'المحل' }),
    aiPersona: 'محل حلويات وكيك، تسويقه بصري بالدرجة الأولى: المظهر والطبقات والمناسبات والهدايا والطلبات الخاصة',
  },
  {
    id: 'bakery', ar: 'مخبوزات ومعجنات', en: 'Bakery', icon: 'store',
    tags: ['bakery', 'sweets'],
    lex: mk({ item: 'صنف', items: 'المخبوزات', itemNew: 'صنف جديد', menu: 'قائمة المخبوزات', place: 'المخبز' }),
    aiPersona: 'مخبز ومعجنات، قيمته في الطزاجة اليومية ومواعيد الخبز الطازج والرائحة والأصناف الصباحية',
  },
  {
    id: 'juice', ar: 'عصائر وسموذي', en: 'Juice bar', icon: 'coffee',
    tags: ['cafe', 'juice'],
    lex: mk({ item: 'عصير', items: 'العصائر', itemNew: 'عصير جديد', menu: 'المنيو', place: 'المحل' }),
    aiPersona: 'محل عصائر طازجة وسموذي، محوره الصحة والطزاجة والمكونات الطبيعية والخلطات',
  },
  {
    id: 'icecream', ar: 'آيس كريم وموالح', en: 'Ice cream', icon: 'cake',
    tags: ['sweets', 'icecream'],
    lex: mk({ item: 'صنف', items: 'الأصناف', itemNew: 'صنف جديد', menu: 'المنيو', place: 'المحل' }),
    aiPersona: 'محل آيس كريم، تسويقه موسمي وبصري ويعتمد النكهات والإضافات وتجربة الأطفال والعائلات',
  },
  {
    id: 'lounge', ar: 'لاونج', en: 'Lounge', icon: 'theater',
    tags: ['lounge', 'cafe'],
    lex: mk({ item: 'صنف', items: 'الأصناف', itemNew: 'صنف جديد', menu: 'المنيو', place: 'اللاونج' }),
    aiPersona: 'لاونج للجلسات الطويلة، تجربته قائمة على الأجواء والإضاءة والموسيقى والجلسات الخاصة وطول مدة البقاء',
  },
  {
    id: 'attar', ar: 'عطارة وأعشاب', en: 'Herbs & spices', icon: 'store',
    tags: ['attar', 'retail'],
    lex: mk({ item: 'منتج', items: 'المنتجات', itemNew: 'منتج جديد', menu: 'قائمة المنتجات', order: 'طلب', place: 'المحل' }),
    aiPersona: 'محل عطارة وأعشاب وتوابل، قيمته في جودة المصدر والخلطات والاستخدامات التقليدية والوزن والتعبئة',
  },
  {
    id: 'perfume', ar: 'عطور وبخور', en: 'Perfume & oud', icon: 'store',
    tags: ['perfume', 'retail'],
    lex: mk({ item: 'منتج', items: 'المنتجات', itemNew: 'منتج جديد', menu: 'قائمة المنتجات', place: 'المحل' }),
    aiPersona: 'محل عطور وعود وبخور، لغته حسّية: النفحات والثبات والفخامة والمناسبة والهدايا',
  },
  {
    id: 'dates', ar: 'تمور ومكسرات', en: 'Dates & nuts', icon: 'store',
    tags: ['retail', 'dates'],
    lex: mk({ item: 'منتج', items: 'المنتجات', itemNew: 'منتج جديد', menu: 'قائمة المنتجات', place: 'المحل' }),
    aiPersona: 'محل تمور ومكسرات، محوره الأصناف والمناسبات والضيافة والتغليف والهدايا',
  },
  {
    id: 'foodtruck', ar: 'عربة طعام', en: 'Food truck', icon: 'car',
    tags: ['restaurant', 'foodtruck'],
    lex: mk({ item: 'صنف', items: 'الأصناف', itemNew: 'صنف جديد', menu: 'المنيو', place: 'العربة' }),
    aiPersona: 'عربة طعام متنقلة، تسويقها مرتبط بالموقع اليومي والسرعة والطابور والأصناف المحدودة',
  },
  {
    id: 'catering', ar: 'تجهيز حفلات وضيافة', en: 'Catering', icon: 'events',
    tags: ['catering'],
    lex: mk({ item: 'خدمة', items: 'الخدمات', itemNew: 'خدمة جديدة', menu: 'قائمة الخدمات', order: 'حجز', orderVerb: 'احجز', place: 'المنشأة' }),
    aiPersona: 'خدمة تجهيز حفلات وضيافة، قراراتها بالعدد والمناسبة والباقات والتنسيق المسبق',
  },
  {
    id: 'retail', ar: 'متجر منتجات', en: 'Retail', icon: 'store',
    tags: ['retail'],
    lex: mk({ item: 'منتج', items: 'المنتجات', itemNew: 'منتج جديد', menu: 'قائمة المنتجات', place: 'المتجر' }),
    aiPersona: 'متجر منتجات، تسويقه قائم على الفئات والمخزون والعروض ومقارنة المنتجات',
  },
  {
    id: 'other', ar: 'نشاط آخر', en: 'Other', icon: 'store',
    tags: ['other'],
    lex: mk({}),
    aiPersona: 'منشأة ضيافة/بيع تقدّم أصنافاً لعملائها',
  },
]

const BY_ID = Object.fromEntries(VENUE_TYPES.map((v) => [v.id, v]))
const FALLBACK = BY_ID.other

// The resolved type for a tenant, honouring a custom label when the venue
// picked «نشاط آخر» and typed its own business name.
export function venueType(tenant) {
  const base = BY_ID[tenant?.type] || FALLBACK
  const label = (tenant?.typeLabel || '').trim()
  if (!label || base.id !== 'other') return base
  return { ...base, ar: label, aiPersona: `${label} — ${base.aiPersona}` }
}

// The venue-correct word. Per-venue overrides win, so a business can say
// «قطعة» instead of «صنف» without us shipping a new type.
export function lex(tenant, key) {
  const over = tenant?.lexOverrides
  if (over && typeof over[key] === 'string' && over[key].trim()) return over[key].trim()
  const type = BY_ID[tenant?.type] || FALLBACK
  return type.lex[key] || NEUTRAL_LEX[key] || key
}

// Every lexicon key with its neutral default — powers the custom-wording editor.
export const LEX_KEYS = Object.keys(NEUTRAL_LEX)
export const LEX_LABELS = {
  item: 'اسم الوحدة المفردة', items: 'اسم القائمة الجمع', itemNew: 'زر الإضافة',
  menu: 'اسم المنيو', category: 'التصنيف المفرد', categories: 'التصنيفات',
  order: 'الطلب', orderVerb: 'فعل الطلب', cart: 'السلة',
  guest: 'العميل المفرد', guests: 'العملاء', place: 'المنشأة',
}
export const neutralLex = (key) => NEUTRAL_LEX[key] || key

// The paragraph handed to every AI surface so generations, captions, advice and
// imagery match the actual business. Includes only facts we truly hold.
export function venueAiContext(tenant) {
  const type = venueType(tenant)
  const bits = [`نوع المنشأة: ${type.ar}. ${type.aiPersona}.`]
  if (tenant?.name) bits.push(`الاسم: ${tenant.name}.`)
  if (tenant?.city) bits.push(`المدينة: ${tenant.city}.`)
  bits.push(`استخدم مفردات هذا النشاط: الوحدة تُسمى «${lex(tenant, 'item')}» والقائمة «${lex(tenant, 'items')}» والمكان «${lex(tenant, 'place')}».`)
  bits.push('لا تفترض أن المنشأة مقهى أو مطعم إن لم يُذكر ذلك، ولا تستخدم مفردات نشاط مختلف.')
  return bits.join(' ')
}

// Venue-type tags feed the games picker and any other type-aware catalogue.
export function venueTags(tenant) {
  const t = venueType(tenant)
  return [...(t.tags || []), 'all']
}
