// Landing-page CMS — complete Arabic defaults + a Firestore overlay.
// The public landing (src/routes/Landing.jsx) renders beautifully from
// LANDING_DEFAULTS alone; a platform-admin can override any text, bullet,
// section order or visibility from /platform/landing (LandingStudio), which
// writes the FULL object to platformConfig/landing (public read, admin write).
//
// PRICING TRUTH: displayed prices always come from src/lib/plans.js
// PLAN_PRICES unless a tier explicitly sets `priceOverride` — and either way
// the server (functions/platformExtensions.js) remains the only trusted
// source at checkout.
import { db as appDb } from './firebase.js'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'

export const LANDING_DEFAULTS = {
  announcement: {
    enabled: true,
    text: 'كل المزايا مفتوحة مجاناً خلال فترة الإطلاق — أنشئ حسابك اليوم',
    href: '/signup',
  },

  hero: {
    title: 'شغّل مقهاك كله',
    titleAccent: 'من نظام واحد',
    subtitle: 'من المنيو والطلب بالباركود، إلى الكاشير والمطبخ اللحظي، إلى المخزون والحملات والمساعد الذكي — تشغيل منشأتك كاملاً في نظام عربي واحد، وبدون أي عمولة على طلباتك.',
    ctaText: 'إنشاء حساب مجاناً',
    ctaHref: '/signup',
    secondaryText: 'استعرض الباقات',
    secondaryHref: '#pricing',
    badges: [
      'بدون عمولة على الطلبات',
      'فوترة متوافقة مع ZATCA',
      'عربي أولاً وبدعم كامل للجوال',
      'جاهز خلال دقائق',
    ],
  },

  // Text chips marquee — intentionally OFF by default until real client names
  // are entered from the studio (no fabricated logos on a fresh install).
  logos: {
    enabled: false,
    title: 'يعتمدون علينا في تشغيلهم اليومي',
    items: [
      { name: 'كافيه نيمة' },
      { name: 'مخبز الضحى' },
      { name: 'مطعم الريف' },
      { name: 'قهوة سحابة' },
      { name: 'حلويات لمسة' },
      { name: 'بوفيه المدينة' },
    ],
  },

  features: {
    title: 'كل ما تحتاجه منشأتك — في مكان واحد',
    subtitle: 'أكثر من عشرين وحدة متكاملة تعمل معاً، لا أدوات متفرقة.',
    items: [
      { icon: 'qr', title: 'منيو QR وطلب أونلاين', desc: 'يمسح الضيف الرمز فيتصفح ويطلب — وطلب الطاولة يصل الكاشير والمطبخ لحظياً.' },
      { icon: 'cashier', title: 'كاشير ومطبخ ومخزون', desc: 'نقطة بيع باللمس، شاشة مطبخ لحظية، ومخزون حقيقي بوصفات يُخصم تلقائياً.' },
      { icon: 'message', title: 'حملات واتساب ورسائل تلقائية', desc: 'حملات مجدولة وتنبيهات تلقائية للعروض والأصناف الجديدة — من رقمك الخاص.' },
      { icon: 'sparkles', title: 'مساعد ذكي يشغّل النظام', desc: 'مساعد يفهم أوامرك بالعربي وينفّذها: يعدّل المنيو ويفعّل العروض ويقرأ تقاريرك.' },
      { icon: 'image', title: 'استوديو صور ومنشورات', desc: 'صور أطباق احترافية ومنشورات تسويقية جاهزة للنشر بالذكاء الاصطناعي.' },
      { icon: 'shapes', title: 'مجسمات 3D وواقع معزز', desc: 'حوّل صورة الطبق إلى مجسم واقعي يشاهده الضيف على طاولته بتقنية AR.' },
      { icon: 'theater', title: 'شاشات عرض وشريحة الصلاة', desc: 'حوّل أي شاشة إلى لوحة حية بشرائح مجدولة وموسيقى — مع شريحة توقف للصلاة.' },
      { icon: 'award', title: 'ولاء وVIP وبطاقات أختام', desc: 'نقاط وفئات وبطاقة عضوية رقمية تُمسح — ومكافآت «اشترِ عدداً واحصل على واحدة».' },
      { icon: 'car', title: 'توصيل بمناطق على الخريطة', desc: 'ارسم نطاقات التوصيل على الخريطة برسوم لكل نطاق — مع استلام من السيارة.' },
      { icon: 'key', title: 'أدوار وصلاحيات دقيقة', desc: 'تسعة أدوار جاهزة وصلاحيات مفصّلة لكل موظف — حتى إخفاء الإيرادات وقفل الأسعار.' },
      { icon: 'file', title: 'فواتير ZATCA ودفع إلكتروني', desc: 'فاتورة ضريبية متوافقة تلقائياً، ودفع إلكتروني آمن عبر ميسر (مدى وبطاقات وأبل باي).' },
      { icon: 'store', title: 'رابط ونطاق خاص لمنشأتك', desc: 'نطاق فرعي باسم منشأتك، ومنيو يعمل كتطبيق يُثبّت على جوال ضيوفك.' },
    ],
  },

  // Zigzag sections. `visual` picks a live product mockup on the page:
  // menu | ops | ai | signage | flow — anything else falls back to an icon panel.
  showcase: [
    {
      title: 'تجربة منيو تليق بعلامتك',
      desc: 'منيو سريع وأنيق يفتح بلا تطبيق، بهوية منشأتك الكاملة — ويتغيّر شكله بالكامل بنقرة واحدة.',
      icon: 'palette',
      flip: false,
      visual: 'menu',
      bullets: [
        'عشرات الثيمات والسكنات الجاهزة — أو صمّم ثيمك الخاص.',
        'خلفيات وعلامة مائية وخطوط وحركة تناسب هويتك.',
        'قصص وعروض مميزة تظهر لضيوفك لحظة فتح المنيو.',
      ],
    },
    {
      title: 'تشغيل كامل بلا ورق ولا فوضى',
      desc: 'من لحظة الطلب حتى التسليم: الكاشير والمطبخ والطاولات والمخزون على شاشة واحدة تتحدث لحظياً.',
      icon: 'cashier',
      flip: true,
      visual: 'ops',
      bullets: [
        'كاشير باللمس يرسل للمطبخ لحظياً مع لوحة حالات قابلة للسحب.',
        'طاولات وحجوزات وطلبات توصيل واستلام في مكان واحد.',
        'مخزون بوصفات يُخصم تلقائياً عند دفع كل طلب وينبّهك قبل النفاد.',
      ],
    },
    {
      title: 'ذكاء اصطناعي يعمل معك، لا بدلاً عنك',
      desc: 'مساعد يشغّل النظام بأوامرك، واستوديو يصنع صورك التسويقية، ومجسمات واقعية تعرض أطباقك بالواقع المعزز.',
      icon: 'sparkles',
      flip: false,
      visual: 'ai',
      bullets: [
        'مساعد ينفّذ أوامرك: أضف صنفاً، فعّل عرضاً، واقرأ مبيعات اليوم.',
        'استوديو صور يحوّل لقطات الجوال إلى صور أطباق احترافية.',
        'مجسمات 3D واقعية لأطباقك يشاهدها الضيف بكاميرا جواله.',
      ],
    },
  ],

  // Honest, codebase-verifiable numbers only — no fabricated customer counts.
  stats: {
    enabled: true,
    items: [
      { value: '0%', label: 'عمولة على أي طلب' },
      { value: '+20', label: 'وحدة متكاملة في نظام واحد' },
      { value: '+160', label: 'أداة ينفّذها المساعد الذكي' },
      { value: '4', label: 'باقات متدرّجة حسب حجمك' },
    ],
  },

  pricing: {
    title: 'باقات تناسب كل مرحلة',
    subtitle: 'ابدأ بالمنيو فقط وترقَّ حين تكبر — أسعار واضحة وبدون أي عمولة على الطلبات.',
    note: 'الأسعار شهرية بالريال السعودي. الدفع يتم بأمان عبر بوابة الدفع، وقيمة الاشتراك النهائية تُحتسب دائماً من الخادم.',
    tiers: {
      menu: {
        tagline: 'لحضور رقمي أنيق',
        badge: '',
        highlight: false,
        glow: false,
        priceOverride: null,
        bullets: [
          'منيو رقمي بهوية منشأتك',
          'طلب QR لكل طاولة',
          'صفحة منشأة وقصص',
          'رابط خاص يعمل كتطبيق',
        ],
        more: [
          'أصناف وتصنيفات بلا حدود',
          'تعديل الأسعار والصور في أي وقت',
        ],
      },
      ops: {
        tagline: 'الأنسب لمنشأة تعمل يومياً',
        badge: '',
        highlight: false,
        glow: false,
        priceOverride: null,
        bullets: [
          'كل ما في «منيو»',
          'كاشير ونقطة بيع باللمس',
          'شاشة مطبخ لحظية (KDS)',
          'طاولات وحجوزات وتوصيل',
        ],
        more: [
          'عروض وكوبونات وولاء',
          'قاعدة عملاء (CRM)',
          'إشعارات لحظية لكل طلب',
        ],
      },
      pro: {
        tagline: 'لعلامة تلفت الأنظار',
        badge: 'الأكثر اختياراً',
        highlight: true,
        glow: false,
        priceOverride: null,
        bullets: [
          'كل ما في «منيو + تشغيل»',
          'مكتبة الثيمات والسكنات كاملة',
          'خلفيات وعلامة مائية',
          'استوديو الشاشات والموسيقى',
          'نطاق مخصّص لمنشأتك',
        ],
        more: [
          'فعاليات وتذاكر بدخول QR',
          'حملات واتساب مجدولة',
          'استوديو الصور بالذكاء الاصطناعي',
        ],
      },
      enterprise: {
        tagline: 'تشغيل كامل بلا حدود',
        badge: '',
        highlight: false,
        glow: true,
        priceOverride: null,
        bullets: [
          'كل ما في «احترافي»',
          'طاقم كامل: حضور وورديات ورواتب',
          'أدوار وصلاحيات متقدمة',
          'مخزون ووصفات (BOM) دقيق',
          'مجسمات 3D واقعية لأطباقك',
        ],
        more: [
          'مساعد ذكي ينفّذ أوامرك',
          'تقارير متقدمة وتحليلات',
          'إعلانات داخلية للطاقم',
        ],
      },
    },
  },

  faq: {
    enabled: true,
    items: [
      { q: 'كيف يطلب الضيف؟', a: 'يمسح رمز QR على طاولته، يتصفّح المنيو، ويرسل الطلب — فيصل فوراً للكاشير والمطبخ موسوماً برقم الطاولة.' },
      { q: 'هل أحتاج أجهزة خاصة؟', a: 'لا. يعمل النظام على أي جوال أو تابلت أو كمبيوتر عبر المتصفح، ويمكن تثبيته كتطبيق على أي جهاز.' },
      { q: 'هل المخزون حقيقي؟', a: 'نعم — مواد خام بوحداتها، وصفات ومكوّنات لكل صنف، تكلفة محسوبة، وخصم تلقائي من المخزون عند دفع كل طلب.' },
      { q: 'ماذا يفعل المساعد الذكي؟', a: 'يفهم أوامرك بالعربي وينفّذها داخل النظام: يضيف الأصناف، يعدّل الأسعار، يفعّل العروض، ويقرأ لك تقارير المبيعات.' },
      { q: 'هل الفوترة متوافقة مع الضريبة؟', a: 'نعم — فاتورة ضريبية مبسّطة برمز ZATCA وضريبة القيمة المضافة تلقائياً بعد إدخال رقمك الضريبي.' },
      { q: 'كيف يدفع العملاء إلكترونياً؟', a: 'عبر بوابة ميسر الآمنة: مدى والبطاقات وأبل باي — ويُسوّى الطلب تلقائياً في الكاشير عند نجاح الدفع.' },
      { q: 'هل أستطيع تغيير باقتي لاحقاً؟', a: 'نعم — ترقّ أو اخفض باقتك في أي وقت من لوحة التحكم، وتُفتح المزايا الجديدة فوراً.' },
      { q: 'هل تُفرض عمولة على الطلبات؟', a: 'أبداً. اشتراك شهري ثابت فقط — كل ريال من مبيعاتك يبقى لك مهما كبر حجم طلباتك.' },
    ],
  },

  cta: {
    title: 'جاهز تنقل منشأتك لمستوى آخر؟',
    subtitle: 'أنشئ حسابك وابدأ استقبال الطلبات اليوم — الإعداد يستغرق دقائق.',
    buttonText: 'إنشاء حساب الآن',
  },

  footer: {
    about: 'rbt360 — منصة سعودية متكاملة لإدارة المقاهي والمطاعم: منيو رقمي وطلبات وكاشير ومطبخ ومخزون وولاء وذكاء اصطناعي، في نظام واحد عربي أولاً.',
    links: [
      { label: 'المزايا', href: '#features' },
      { label: 'الباقات', href: '#pricing' },
      { label: 'الأسئلة الشائعة', href: '#faq' },
      { label: 'حالة المنصة', href: '/status' },
    ],
    socials: { whatsapp: '', x: '', instagram: '', tiktok: '', email: '' },
    showPayments: true,
  },

  // Visibility AND order of the page flow. The announcement ribbon always
  // renders above the sticky nav (its row here only controls visibility).
  sections: [
    { key: 'announcement', enabled: true },
    { key: 'hero', enabled: true },
    { key: 'logos', enabled: true },
    { key: 'features', enabled: true },
    { key: 'showcase', enabled: true },
    { key: 'stats', enabled: true },
    { key: 'pricing', enabled: true },
    { key: 'faq', enabled: true },
    { key: 'cta', enabled: true },
  ],

  theme: { accent: '', density: 'comfortable' },

  whatsappFloat: { enabled: false, number: '' },
}

// Studio labels + icons per section key (icons from src/components/Icon.jsx).
export const SECTION_META = [
  { key: 'announcement', ar: 'شريط الإعلان', icon: 'bellRing' },
  { key: 'hero', ar: 'الواجهة الرئيسية', icon: 'flame' },
  { key: 'logos', ar: 'شريط العملاء', icon: 'store' },
  { key: 'features', ar: 'شبكة المزايا', icon: 'grid' },
  { key: 'showcase', ar: 'أقسام العرض', icon: 'layers' },
  { key: 'stats', ar: 'الأرقام', icon: 'chartBar' },
  { key: 'pricing', ar: 'الباقات والأسعار', icon: 'wallet' },
  { key: 'faq', ar: 'الأسئلة الشائعة', icon: 'message' },
  { key: 'cta', ar: 'الدعوة الختامية', icon: 'zap' },
]

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const clone = (v) => (v != null && typeof v === 'object' ? structuredClone(v) : v)

// Recursive merge: plain objects merge key-by-key; arrays and scalars from the
// override replace the default wholesale; `undefined` keeps the default.
export function deepMerge(defaults, overrides) {
  if (overrides === undefined) return clone(defaults)
  if (!isObj(defaults) || !isObj(overrides)) return clone(overrides)
  const out = {}
  for (const k of new Set([...Object.keys(defaults), ...Object.keys(overrides)])) {
    out[k] = deepMerge(defaults[k], overrides[k])
  }
  return out
}

// Merge a stored doc over the defaults + normalize `sections` so newly shipped
// sections still appear (appended, default visibility) and unknown/duplicate
// keys are dropped — old saved docs never blank out a new section.
export function mergeLanding(overrides) {
  const m = deepMerge(LANDING_DEFAULTS, overrides || {})
  const known = LANDING_DEFAULTS.sections.map((s) => s.key)
  const have = new Set()
  const list = []
  for (const s of Array.isArray(m.sections) ? m.sections : []) {
    if (!s || !known.includes(s.key) || have.has(s.key)) continue
    have.add(s.key)
    list.push({ key: s.key, enabled: s.enabled !== false })
  }
  for (const k of known) {
    if (!have.has(k)) list.push({ key: k, enabled: LANDING_DEFAULTS.sections.find((d) => d.key === k).enabled !== false })
  }
  m.sections = list
  return m
}

const landingRef = (db) => doc(db, 'platformConfig', 'landing')

// One-shot read → full merged content (falls back to defaults on any error).
export async function loadLanding(db = appDb) {
  try {
    const snap = await getDoc(landingRef(db))
    return mergeLanding(snap.exists() ? snap.data() : {})
  } catch {
    return mergeLanding({})
  }
}

// Live subscription → cb(mergedContent). Always provides the error callback so
// a rules/network failure still paints the defaults (no stuck skeletons).
export function watchLanding(db = appDb, cb) {
  return onSnapshot(
    landingRef(db),
    (snap) => cb(mergeLanding(snap.exists() ? snap.data() : {})),
    () => cb(mergeLanding({})),
  )
}
