// ICON LIBRARY — 1539 vectors, searchable in Arabic and English, emitted as SVG
// markup a print element can own.
//
// The data module it reads is generated (see scripts/gen-icon-library.mjs) and
// deliberately independent of lucide's module graph; the note at the top of that
// file explains why importing the library directly cost 745 kB on first paint.
//
// Everything here is pure string work — no React — so the print rasterizer can
// use it as freely as the picker does.
import { LUCIDE_ICON_DATA, LUCIDE_VIEWBOX } from './iconLibraryData.js'

// "Name" → "cup soda" for searching.
const words = (n) => n
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .toLowerCase()

// Arabic search terms for what a café actually looks for. A manager typing
// «قهوة» gets nothing from a library indexed only on English names, which would
// make 1539 icons effectively unreachable for the people using this.
const AR = {
  Coffee: 'قهوة كوب مشروب ساخن', CupSoda: 'مشروب بارد كوب عصير', Beer: 'بيرة',
  Wine: 'نبيذ كأس', Milk: 'حليب', Croissant: 'كرواسان معجنات',
  Utensils: 'ملاعق شوك أدوات طعام مطعم', UtensilsCrossed: 'أدوات طعام مطعم',
  ChefHat: 'شيف طاهي مطبخ', CookingPot: 'قدر طبخ', Soup: 'شوربة',
  Cake: 'كيك حلى حلويات قالب', CakeSlice: 'قطعة كيك حلى', IceCreamCone: 'آيس كريم مثلجات',
  Cookie: 'كوكيز بسكوت', Donut: 'دونات', Pizza: 'بيتزا', Sandwich: 'ساندويتش',
  Salad: 'سلطة خضار', Egg: 'بيض', EggFried: 'بيض مقلي فطور', Fish: 'سمك',
  Beef: 'لحم', Drumstick: 'دجاج', Wheat: 'قمح حبوب جلوتين', WheatOff: 'بلا جلوتين',
  Nut: 'مكسرات', NutOff: 'بلا مكسرات', Leaf: 'نباتي ورقة أخضر', Vegan: 'نباتي',
  Flame: 'حار نار سعرات', Snowflake: 'بارد مثلج', Citrus: 'حمضيات ليمون',
  Apple: 'تفاح فاكهة', Cherry: 'كرز', Grape: 'عنب', Banana: 'موز',
  Wifi: 'واي فاي انترنت شبكة', QrCode: 'باركود رمز مسح', ScanLine: 'مسح رمز',
  Smartphone: 'جوال هاتف', Phone: 'هاتف اتصال', MessageCircle: 'رسالة محادثة واتساب',
  Mail: 'بريد ايميل', Send: 'ارسال',
  Star: 'نجمة تقييم مميز', Heart: 'قلب اعجاب مفضل', Gift: 'هدية جائزة عرض',
  Award: 'جائزة ولاء وسام', Crown: 'تاج مميز vip', Trophy: 'كأس بطولة فوز',
  Medal: 'ميدالية جائزة', Sparkles: 'لمعة جديد مميز', BadgeCheck: 'موثوق تحقق',
  Percent: 'نسبة خصم عرض', Tag: 'سعر وسم', Tags: 'اسعار وسوم', Ticket: 'تذكرة',
  Gamepad2: 'العاب تحكم يد', Dices: 'نرد لعبة', Puzzle: 'ألغاز أحجية',
  PartyPopper: 'احتفال مناسبة', Music: 'موسيقى', Volume2: 'صوت',
  MapPin: 'موقع خريطة عنوان', Navigation: 'اتجاه توصيل', Clock: 'ساعة وقت',
  Calendar: 'تقويم تاريخ حجز', CalendarDays: 'تقويم مواعيد',
  ShoppingCart: 'سلة طلب شراء', ShoppingBag: 'كيس شراء سفري', Package: 'طلب صندوق',
  Truck: 'توصيل شاحنة', Bike: 'دراجة توصيل', Car: 'سيارة توصيل',
  CreditCard: 'بطاقة دفع شبكة', Banknote: 'نقد فلوس دفع', Wallet: 'محفظة دفع',
  Receipt: 'فاتورة ايصال', Coins: 'نقود عملات',
  Users: 'مجموعة اشخاص طاولة', User: 'شخص ضيف عميل', UserRound: 'ضيف عميل',
  Armchair: 'كرسي طاولة جلوس', Table: 'طاولة', Sofa: 'كنبة جلوس',
  Camera: 'كاميرا صورة', Instagram: 'انستقرام', Twitter: 'تويتر اكس',
  Facebook: 'فيسبوك', Youtube: 'يوتيوب', Share2: 'مشاركة',
  Sun: 'شمس صباح', Moon: 'قمر مسائي ليل', CloudSun: 'طقس',
  Baby: 'أطفال عائلة', Accessibility: 'وصول ذوي احتياجات', Cigarette: 'تدخين',
  CigaretteOff: 'ممنوع التدخين', PawPrint: 'حيوانات أليفة',
  ThumbsUp: 'اعجاب موافق', Smile: 'سعيد ابتسامة', Quote: 'اقتباس',
  Info: 'معلومات', TriangleAlert: 'تنبيه تحذير', CircleCheck: 'تم صح',
  Zap: 'سريع طاقة', Timer: 'مؤقت وقت', Hand: 'يد نادل خدمة', BellRing: 'نداء جرس',
}

const NAMES = Object.keys(LUCIDE_ICON_DATA)

// name → { name, terms } search index, built once per session.
let INDEX = null
function index() {
  if (INDEX) return INDEX
  INDEX = NAMES.map((name) => ({
    name,
    terms: `${name.toLowerCase()} ${words(name)} ${AR[name] || ''}`,
  }))
  return INDEX
}

export const iconCount = () => NAMES.length

export function searchIcons(query, limit = 400) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return NAMES.slice(0, limit)
  const hits = []
  for (const e of index()) {
    if (e.terms.includes(q)) {
      hits.push(e.name)
      if (hits.length >= limit) break
    }
  }
  return hits
}

// Rebuilds the SVG for one icon. `stroke="currentColor"` is kept so the print
// renderers can recolour it exactly the way they recolour shapes.
export function iconSvg(name, { strokeWidth = 2 } = {}) {
  const packed = LUCIDE_ICON_DATA[name]
  if (!packed) return ''
  const body = packed.split(';;').map((node) => {
    const bar = node.indexOf('|')
    const tag = node.slice(0, bar)
    const attrs = node.slice(bar + 1)
    const parts = attrs ? attrs.split('~').map((kv) => {
      const eq = kv.indexOf('=')
      return `${kv.slice(0, eq)}="${escAttr(kv.slice(eq + 1))}"`
    }).join(' ') : ''
    return `<${tag}${parts ? ' ' + parts : ''}/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LUCIDE_VIEWBOX}" fill="none"`
    + ` stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">`
    + body + '</svg>'
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
