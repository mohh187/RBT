import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { CAP } from '../../lib/permissions.js'
import { VENUE_TYPES, venueType, lex, LEX_KEYS, LEX_LABELS } from '../../lib/venueTypes.js'

// Map-based range picking (leaflet) — lazy so the heavy map bundle loads only on demand.
const MapRangePicker = lazy(() => import('../../components/MapRangePicker.jsx'))
import { useI18n, pickLang } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { updateTenant as updTenantRaw, watchCategories, watchStaff, setStaffPin, watchItems, saveItem } from '../../lib/db.js'
import { hashPin } from '../../lib/pin.js'
import { uploadImage, uploadFile, shrinkImage } from '../../lib/storage.js'
import VipCard from '../../components/VipCard.jsx'
import { planAllows } from '../../lib/plans.js'
import { menuUrl } from '../../lib/qr.js'
import InstallButton from '../../components/InstallButton.jsx'
import Icon from '../../components/Icon.jsx'
import ImageCropper from '../../components/ImageCropper.jsx'
import CustomDomainCard from '../../components/CustomDomainCard.jsx'
import SubscriptionCard from '../../components/SubscriptionCard.jsx'
import MenuPreview from '../../components/MenuPreview.jsx'
import MediaLibrary from '../../components/MediaLibrary.jsx'
import BgPanPad from '../../components/BgPanPad.jsx'
import { THEMES, applyTheme } from '../../lib/themes.js'
import { SKINS, getSkin, fontLabel, FONT_OPTIONS, SHAPE_OPTIONS, LAYOUT_OPTIONS, HEADER_STYLES, BOTTOMNAV_STYLES, MOTION_OPTIONS, MOTION_SPEEDS, MOTION_REPEATS, TAP_OPTIONS } from '../../lib/skins.js'
import { UpgradeNotice } from '../../components/PlanGate.jsx'
import { SECTION_TEMPLATES, sectionTemplate } from '../../lib/systemTemplates.js'
import { SYSTEM_THEMES, THEMEABLE_SECTIONS, sectionSystemTheme, systemThemeAttr } from '../../lib/systemThemes.js'
import SocialLinks from '../../components/SocialLinks.jsx'
import StaffPreview from '../../components/StaffPreview.jsx'
import TemplateGallery from '../../components/TemplateGallery.jsx'
import ContrastHint from '../../components/ContrastHint.jsx'
import HelpTip from '../../components/HelpTip.jsx'
import '../../styles/settings-nav.css'

const LAYOUT_LABELS = { list: 'قائمة', minimal: 'مدمج', cards: 'بطاقات', grid: 'شبكة', gallery: 'معرض', bento: 'فسيفساء', sidebar: 'جانبي', catalog: 'كتالوج', plates: 'صحون', storefront: 'تطبيق متجر', coffeelist: 'قائمة مقهى', alternating: 'متعاكس تبادلي (مشاوي)', coffeepan: 'كروت كوفي بان المتميزة', spotlight: 'واجهة العرض (منتج بملء الشاشة)' }
const LAYOUT_LABELS_EN = { list: 'List', minimal: 'Minimal', cards: 'Cards', grid: 'Grid', gallery: 'Gallery', bento: 'Bento', sidebar: 'Sidebar', catalog: 'Catalog', plates: 'Platter', storefront: 'Storefront', coffeelist: 'Cafe List', alternating: 'Alternating Rows', coffeepan: 'Coffeepan Premium Cards', spotlight: 'Spotlight (full-screen product)' }
const BANNER_STYLES = [['full', 'كامل', 'Full'], ['rounded', 'دائري', 'Rounded'], ['card', 'بطاقة', 'Card'], ['tall', 'طويل', 'Tall']]
const SHAPE_LABELS = { sharp: 'حادّ', soft: 'ناعم', round: 'دائري', pill: 'حبّة' }
const SHAPE_LABELS_EN = { sharp: 'Sharp', soft: 'Soft', round: 'Round', pill: 'Pill' }
// ===== Settings information architecture (2026-07-20 reorganisation) =====
// ONE flat list of destinations replaces the old four tabs + in-page anchors:
// every card now lives in the section an owner would look for it in.
// `caps`   — unchanged rule: the section shows if the user holds ANY of them,
//            so a scoped staffer still sees only what they are allowed to edit.
// `save`   — the section ends with the shared Save button (it holds draft
//            fields that only reach Firestore on Save).
// `instant`— every control in the section writes the moment it changes, so the
//            section states that plainly instead of showing a dead Save button.
// (The studio and the receipt designer keep their own Save inside their layout.)
const SECTIONS = [
  {
    id: 'identity', icon: 'store', save: true, caps: [CAP.MANAGE_SETTINGS],
    ar: 'الهوية والنشاط', en: 'Identity & business',
    arSub: 'اسم المنشأة ونوع نشاطها ومفرداتها، الشعار والغلاف، رابط المنيو العام، وحسابات التواصل.',
    enSub: 'Venue name, business type and wording, logo and cover, the public menu link, and social accounts.',
  },
  {
    id: 'studio', icon: 'sparkles', caps: [CAP.MANAGE_SETTINGS, CAP.MANAGE_APPEARANCE],
    ar: 'المظهر والثيمات', en: 'Look & themes',
    arSub: 'استوديو التصميم بمعاينة حية: ثيم المنيو وثيم النظام، الألوان والخطوط، الخلفيات والبانر، شاشة الصنف والواقع المعزز، والكاشير والمطبخ وشاشة القفل.',
    enSub: 'The design studio with a live preview: menu skin and system theme, colours and fonts, backgrounds and banner, item screen and AR, cashier, kitchen and lock screen.',
  },
  {
    id: 'experience', icon: 'play', instant: true, caps: [CAP.MANAGE_SETTINGS],
    ar: 'تجربة العميل', en: 'Guest experience',
    arSub: 'المزايا التفاعلية داخل المنيو وصفحة الطلب: النادل الصوتي والطلب بالصورة والمقارنة والطلب الجماعي، ولعبة الانتظار ومركز الألعاب.',
    enSub: 'Interactive features inside the menu and order page: voice waiter, photo ordering, compare, shared cart, the waiting game and the games centre.',
  },
  {
    id: 'ops', icon: 'orders', save: true, caps: [CAP.MANAGE_SETTINGS],
    ar: 'التشغيل والطلبات', en: 'Operations & orders',
    arSub: 'موقع المنشأة ونطاق الحضور، شاشة المطبخ ومحطات التحضير، تفضيلات الكاشير، تقييد طلبات الطاولات، الاستلام من السيارة، والتوصيل ومناطقه.',
    enSub: 'Venue location and attendance range, kitchen display and prep stations, cashier preferences, table-order restrictions, curbside, and delivery zones.',
  },
  {
    id: 'marketing', icon: 'customers', save: true, caps: [CAP.MANAGE_SETTINGS, CAP.MANAGE_INTEGRATIONS, CAP.MANAGE_LOYALTY],
    ar: 'العملاء والتسويق', en: 'Customers & marketing',
    arSub: 'برنامج الولاء وعضوية VIP وتصميم بطاقتها، إشعارات العميل التلقائية، وتتبّع سلوك الزوار الذي يغذّي التقارير.',
    enSub: 'Loyalty, VIP membership and its card design, automatic customer notifications, and the guest-behaviour tracking that feeds the reports.',
  },
  {
    id: 'finance', icon: 'wallet', save: true, caps: [CAP.MANAGE_SETTINGS, CAP.MANAGE_INTEGRATIONS],
    ar: 'المالية والضريبة', en: 'Finance & VAT',
    arSub: 'ضريبة القيمة المضافة والرقم الضريبي، الدفع الإلكتروني، الإكرامية، واشتراك المنصة.',
    enSub: 'VAT and the tax number, online payment, tips, and the platform subscription.',
  },
  {
    id: 'receipt', icon: 'receipt', caps: [CAP.MANAGE_SETTINGS],
    ar: 'تصميم الفاتورة', en: 'Receipt designer',
    arSub: 'ترويسة الإيصال الحراري وتذييله وما يُطبع فيه من شعار وضريبة ورمز QR — بمعاينة مطابقة للورق.',
    enSub: 'Thermal receipt header and footer and what it prints — logo, VAT, QR — with a paper-accurate preview.',
  },
  {
    id: 'connect', icon: 'share', save: true, caps: [CAP.MANAGE_SETTINGS, CAP.MANAGE_INTEGRATIONS],
    ar: 'الربط والنطاقات', en: 'Integrations & domains',
    arSub: 'النطاق المخصص، أجهزة نقاط البيع والأنظمة المحاسبية وبوابات الرسائل، والربط المخصص عبر Webhook.',
    enSub: 'Your custom domain, POS terminals, accounting systems and SMS gateways, and a custom webhook.',
  },
  {
    id: 'system', icon: 'settings', instant: true, caps: [CAP.MANAGE_SETTINGS],
    ar: 'النظام والأمان', en: 'System & security',
    arSub: 'لغة الواجهة ووضعها الفاتح/الداكن، الجولات الإرشادية، تثبيت التطبيق على الجهاز، وقفل النظام برمز PIN لكل موظف.',
    enSub: 'Interface language and light/dark mode, guided tours, installing the app, and the staff PIN lock.',
  },
]
// Sections whose cards are rendered from the shared venue-setup column below.
const SETUP_SECTIONS = ['identity', 'experience', 'ops', 'system']
// Menu elements the venue can show/hide — [key, ar, en]
const HIDEABLE = [['offers', 'زر العروض', 'Offers button'], ['events', 'الفعاليات', 'Events'], ['reservations', 'الحجوزات', 'Reservations'], ['promos', 'شريط العروض', 'Promos strip'], ['special', 'الأصناف المميّزة', 'Featured'], ['search', 'البحث', 'Search'], ['viewToggle', 'زر طريقة العرض', 'View toggle'], ['notifications', 'جرس الإشعارات', 'Notifications'], ['social', 'أيقونات التواصل', 'Social icons'], ['stories', 'الاستوري', 'Stories'], ['profile', 'زر البروفايل والأخبار', 'Profile button'], ['covers', 'أغلفة الفئات (واجهة العرض)', 'Category covers (Spotlight)'], ['pairings', 'توصيات «يُطلب معه»', 'Pairings'], ['bottomNav', 'القائمة السفلية كاملة', 'Bottom navigation bar']]
// Per-element typography control — [key, ar, en, defaultPx]
const TYPO_ELEMENTS = [['header', 'الهيدر', 'Header', 16], ['hero', 'اسم الكافيه', 'Venue name', 28], ['desc', 'الوصف', 'Description', 14], ['item', 'اسم الصنف', 'Item name', 15], ['price', 'السعر', 'Price', 16]]

// Banner-melt direction labels — shared by the melt control and the design summary line.
const FADE_LABELS = { bottom: ['يذوب للأسفل', 'melt down'], top: ['يذوب للأعلى', 'melt up'], both: ['الطرفان', 'both edges'], none: ['بدون', 'none'] }

// Settings SEARCH registry (jump, not filter): keywords → destination.
// tab  = section id · aSec = studio sub-tab · at = card anchor id to scroll to.
// Every control card below carries the matching id, so a search lands on the
// card itself rather than on the top of a long section.
const SEARCH_INDEX = [
  // ---- الهوية والنشاط ----
  { keys: ['الشعار', 'شعار', 'لوجو', 'الغلاف', 'غلاف', 'logo', 'cover'], tab: 'identity', at: 'set-profile', ar: 'الشعار والغلاف', en: 'Logo & cover' },
  { keys: ['الاسم', 'اسم المنشأة', 'الوصف', 'وصف', 'name'], tab: 'identity', at: 'set-profile', ar: 'اسم المنشأة ووصفها', en: 'Venue name & description' },
  { keys: ['العملة', 'عملة', 'currency'], tab: 'identity', at: 'set-profile', ar: 'العملة', en: 'Currency' },
  { keys: ['الجوال', 'الهاتف', 'رقم', 'العنوان', 'phone', 'address'], tab: 'identity', at: 'set-profile', ar: 'الجوال والعنوان', en: 'Phone & address' },
  { keys: ['نوع النشاط', 'النشاط', 'نشاط', 'مفردات', 'مطعم', 'مقهى', 'متجر', 'type', 'wording', 'lexicon'], tab: 'identity', at: 'set-venue-type', ar: 'نوع النشاط ومفرداته', en: 'Business type & wording' },
  { keys: ['الرابط', 'رابط', 'qr', 'link', 'slug'], tab: 'identity', at: 'set-link', ar: 'رابط المنيو العام', en: 'Public menu link' },
  { keys: ['التواصل', 'انستقرام', 'إنستقرام', 'سناب', 'تيك توك', 'خرائط', 'الموقع الالكتروني', 'instagram', 'snapchat', 'tiktok', 'social', 'maps', 'website'], tab: 'identity', at: 'set-social', ar: 'حسابات التواصل', en: 'Social accounts' },
  // ---- المظهر والثيمات (الاستوديو) ----
  { keys: ['الثيم', 'ثيم', 'ثيمات', 'سكن', 'skin', 'theme'], tab: 'studio', aSec: 'theme', ar: 'ثيم المنيو', en: 'Menu theme' },
  { keys: ['ثيم النظام', 'الزجاج', 'زجاج', 'liquid', 'glass', 'system theme'], tab: 'studio', aSec: 'theme', ar: 'ثيم النظام وقوة الزجاج', en: 'System theme & glass' },
  { keys: ['القائمة الجانبية', 'الجانبية', 'sidebar'], tab: 'studio', aSec: 'theme', ar: 'شكل القائمة الجانبية', en: 'Sidebar style' },
  { keys: ['الواقع المعزز', 'معزز', 'مجسم', 'ar', '3d'], tab: 'studio', aSec: 'theme', ar: 'الواقع المعزز AR في المنيو', en: 'Menu AR' },
  { keys: ['جدولة الثيم', 'نهاري', 'ليلي', 'schedule'], tab: 'studio', aSec: 'theme', ar: 'جدولة الثيم (نهاري/ليلي)', en: 'Theme schedule' },
  { keys: ['الازرار', 'الأزرار', 'زر', 'لون التحديد', 'button'], tab: 'studio', aSec: 'theme', ar: 'مصمم الأزرار ولون التحديد', en: 'Button designer' },
  { keys: ['خلفية النظام', 'خلفية اللوحة', 'app background'], tab: 'studio', aSec: 'theme', ar: 'خلفية النظام الكاملة', en: 'System background' },
  { keys: ['قوالب', 'قالب', 'template'], tab: 'studio', aSec: 'theme', ar: 'قوالب واجهات النظام', en: 'System templates' },
  { keys: ['التخطيط', 'تخطيط', 'layout'], tab: 'studio', aSec: 'elements', ar: 'تخطيط عرض الأصناف', en: 'Menu layout' },
  { keys: ['المميزة', 'مميز', 'الاكثر مبيعا', 'featured'], tab: 'studio', aSec: 'elements', ar: 'الأصناف المميزة', en: 'Featured items' },
  { keys: ['بطاقة العميل', 'welcome'], tab: 'studio', aSec: 'elements', ar: 'بطاقة العميل', en: 'Customer card' },
  { keys: ['شريط التصنيفات', 'التصنيفات', 'تصنيف', 'category'], tab: 'studio', aSec: 'elements', ar: 'شريط التصنيفات', en: 'Category bar' },
  { keys: ['وضع المنيو', 'عرض فقط', 'تصفح', 'browse'], tab: 'studio', aSec: 'elements', ar: 'وضع المنيو (طلب / عرض فقط)', en: 'Menu mode' },
  { keys: ['نداء النادل', 'نادل', 'نداء', 'waiter'], tab: 'studio', aSec: 'elements', ar: 'نداء النادل', en: 'Waiter call' },
  { keys: ['اجمالي السلة', 'إجمالي السلة', 'السلة', 'اجمالي', 'إجمالي', 'cart'], tab: 'studio', aSec: 'elements', ar: 'إجمالي السلة', en: 'Cart total' },
  { keys: ['اخفاء', 'إخفاء', 'الاستوري', 'استوري', 'الحجوزات', 'الفعاليات', 'العروض', 'hide', 'stories', 'reservations'], tab: 'studio', aSec: 'elements', ar: 'إظهار وإخفاء عناصر المنيو', en: 'Show / hide menu elements' },
  { keys: ['الخط', 'خط', 'الحواف', 'الهيدر', 'الحركة', 'font', 'header', 'motion'], tab: 'studio', aSec: 'elements', ar: 'الخط والحواف والهيدر والحركة', en: 'Font, shape, header & motion' },
  { keys: ['الالوان', 'الألوان', 'لون', 'الهوية', 'color', 'brand'], tab: 'studio', aSec: 'colors', ar: 'ألوان الهوية', en: 'Brand colours' },
  { keys: ['حجم النص', 'النصوص', 'typography'], tab: 'studio', aSec: 'colors', ar: 'أحجام وألوان النصوص', en: 'Text sizes & colours' },
  { keys: ['البانر', 'بانر', 'banner'], tab: 'studio', aSec: 'media', ar: 'البانر العلوي', en: 'Top banner' },
  { keys: ['الفيديو', 'فيديو', 'خلفية', 'العلامة المائية', 'مائية', 'video', 'watermark', 'gradient'], tab: 'studio', aSec: 'media', ar: 'خلفيات المنيو والفيديو', en: 'Menu backgrounds & video' },
  { keys: ['الاندماج', 'اندماج', 'تدرج', 'fade', 'melt'], tab: 'studio', aSec: 'media', ar: 'اندماج البانر', en: 'Banner melt' },
  { keys: ['تفاصيل الصنف', 'شاشة الصنف', 'صورة الصنف', 'item details'], tab: 'studio', aSec: 'details', ar: 'شاشة تفاصيل الصنف', en: 'Item details screen' },
  { keys: ['الخلفية الفنية', 'فنية', 'لوحة', 'art'], tab: 'studio', aSec: 'details', ar: 'الخلفية الفنية', en: 'Art backdrop' },
  { keys: ['ايقونات التواصل', 'أيقونات التواصل', 'social icons'], tab: 'studio', aSec: 'details', ar: 'مظهر أيقونات التواصل', en: 'Social icons look' },
  { keys: ['الكاشير', 'كاشير', 'pos', 'cashier'], tab: 'studio', aSec: 'staff', ar: 'مظهر الكاشير والمطبخ', en: 'Cashier & KDS look' },
  { keys: ['خلفية الكاشير', 'pos background'], tab: 'studio', aSec: 'staff', ar: 'خلفية شاشة الكاشير', en: 'Cashier backdrop' },
  { keys: ['شاشة القفل', 'مظهر القفل', 'lock screen'], tab: 'studio', aSec: 'pinlock', ar: 'مظهر شاشة القفل', en: 'Lock screen look' },
  // ---- تجربة العميل ----
  { keys: ['لعبة الانتظار', 'صياد', 'انتظار', 'waiting game'], tab: 'experience', at: 'set-waitgame', ar: 'لعبة الانتظار', en: 'Waiting game' },
  { keys: ['النادل الصوتي', 'صوتي', 'اطلب بصوتك', 'voice'], tab: 'experience', at: 'set-interactive', ar: 'النادل الصوتي', en: 'Voice waiter' },
  { keys: ['اطلب بالصورة', 'بالصورة', 'photo order'], tab: 'experience', at: 'set-interactive', ar: 'اطلب بالصورة', en: 'Order by photo' },
  { keys: ['المكفوفين', 'المنيو الصوتي', 'accessible'], tab: 'experience', at: 'set-interactive', ar: 'المنيو الصوتي', en: 'Accessible voice menu' },
  { keys: ['المقارنة', 'مقارنة', 'compare'], tab: 'experience', at: 'set-interactive', ar: 'مقارنة الأصناف', en: 'Compare items' },
  { keys: ['الطلب الجماعي', 'تقسيم الفاتورة', 'shared cart'], tab: 'experience', at: 'set-interactive', ar: 'الطلب الجماعي', en: 'Shared table order' },
  { keys: ['توأم المطبخ', 'توام', 'kitchen twin'], tab: 'experience', at: 'set-interactive', ar: 'توأم المطبخ', en: 'Kitchen twin' },
  { keys: ['الالعاب', 'الألعاب', 'لعبة', 'صدارة', 'games', 'leaderboard'], tab: 'experience', at: 'set-games', ar: 'ألعاب المنيو', en: 'Menu games' },
  // ---- التشغيل والطلبات ----
  { keys: ['الموقع', 'موقع', 'الحضور', 'انصراف', 'خريطة', 'نطاق', 'geo', 'location', 'geofence'], tab: 'ops', at: 'set-geo', ar: 'موقع المنشأة ونطاق الحضور', en: 'Venue location & geofence' },
  { keys: ['kds', 'المطبخ', 'مطبخ', 'شاشة المطبخ', 'محطات', 'تأخير', 'kitchen', 'station'], tab: 'ops', at: 'set-kds', ar: 'شاشة المطبخ KDS', en: 'Kitchen display (KDS)' },
  { keys: ['الوضع الافقي', 'الأفقي', 'تابلت', 'landscape'], tab: 'ops', at: 'set-cashier', ar: 'تفضيل الوضع الأفقي للكاشير', en: 'Cashier landscape' },
  { keys: ['الطاولات', 'طاولة', 'تقييد', 'table orders'], tab: 'ops', at: 'set-dinein', ar: 'تقييد طلبات الطاولات', en: 'Restrict table orders' },
  { keys: ['السيارة', 'استلام', 'curbside'], tab: 'ops', at: 'set-curbside', ar: 'الاستلام من السيارة', en: 'Curbside pickup' },
  { keys: ['التوصيل', 'توصيل', 'رسوم', 'مناطق', 'delivery', 'zone'], tab: 'ops', at: 'set-delivery', ar: 'التوصيل ومناطقه', en: 'Delivery & zones' },
  // ---- العملاء والتسويق ----
  { keys: ['العضوية', 'عضوية', 'الولاء', 'ولاء', 'نقاط', 'بطاقة vip', 'vip', 'مستويات', 'loyalty', 'tier'], tab: 'marketing', at: 'set-loyalty', ar: 'الولاء وعضوية VIP', en: 'Loyalty & VIP' },
  { keys: ['امتيازات', 'الامتيازات', 'perks'], tab: 'marketing', at: 'set-loyalty', ar: 'امتيازات المستويات', en: 'Tier perks' },
  { keys: ['واتساب', 'اشعارات', 'إشعارات', 'whatsapp', 'notification'], tab: 'marketing', at: 'set-notify', ar: 'إشعارات العميل التلقائية', en: 'Customer notifications' },
  { keys: ['التتبع', 'تتبع', 'سلوك', 'تحليلات', 'analytics', 'tracking'], tab: 'marketing', at: 'set-analytics', ar: 'تتبّع سلوك الزوار', en: 'Guest behaviour tracking' },
  // ---- المالية والضريبة ----
  { keys: ['الضريبة', 'ضريبة', 'زاتكا', 'الرقم الضريبي', 'vat', 'zatca', 'tax'], tab: 'finance', at: 'set-vat', ar: 'ضريبة القيمة المضافة', en: 'VAT (ZATCA)' },
  { keys: ['الاشتراك', 'اشتراك', 'الباقة', 'باقة', 'subscription', 'plan'], tab: 'finance', at: 'set-subscription', ar: 'الاشتراك والباقة', en: 'Subscription' },
  { keys: ['الدفع الالكتروني', 'الدفع الإلكتروني', 'دفع', 'ميسر', 'عربون', 'moyasar', 'pay'], tab: 'finance', at: 'set-pay', ar: 'الدفع الإلكتروني', en: 'Online payment' },
  { keys: ['الاكرامية', 'الإكرامية', 'اكرامية', 'إكرامية', 'tip'], tab: 'finance', at: 'set-tips', ar: 'الإكرامية', en: 'Tips' },
  // ---- تصميم الفاتورة ----
  { keys: ['الطابعة', 'طابعة', 'الايصال', 'الإيصال', 'ايصال', 'إيصال', 'الفاتورة', 'فاتورة', 'ترويسة', 'تذييل', 'receipt', 'print'], tab: 'receipt', ar: 'تصميم الفاتورة والإيصال', en: 'Receipt designer' },
  // ---- الربط والنطاقات ----
  { keys: ['النطاق', 'نطاق', 'دومين', 'domain'], tab: 'connect', at: 'set-domain', ar: 'النطاق المخصص', en: 'Custom domain' },
  { keys: ['نقاط البيع', 'جهاز', 'terminal', 'geidea', 'paytabs'], tab: 'connect', at: 'set-gateways', ar: 'جهاز نقاط البيع', en: 'POS payment terminal' },
  { keys: ['المحاسبة', 'محاسبي', 'quickbooks', 'zoho', 'xero', 'accounting'], tab: 'connect', at: 'set-gateways', ar: 'النظام المحاسبي', en: 'Accounting system' },
  { keys: ['رسائل', 'sms', 'twilio', 'unifonic'], tab: 'connect', at: 'set-gateways', ar: 'بوابة الرسائل', en: 'SMS gateway' },
  { keys: ['ويب هوك', 'ربط مخصص', 'api', 'webhook', 'odoo', 'erp'], tab: 'connect', at: 'set-webhook', ar: 'الربط المخصص (Webhook)', en: 'Custom webhook' },
  // ---- النظام والأمان ----
  { keys: ['تثبيت', 'التطبيق', 'install', 'pwa'], tab: 'system', at: 'set-install', ar: 'تثبيت التطبيق', en: 'Install the app' },
  { keys: ['اللغة', 'لغة', 'الوضع الداكن', 'داكن', 'فاتح', 'الجولات', 'جولة', 'language', 'dark', 'tour'], tab: 'system', at: 'set-prefs', ar: 'اللغة والوضع والجولات', en: 'Language, mode & tours' },
  { keys: ['الموظفون', 'الموظفين', 'موظف', 'pin', 'رمز القفل', 'قفل', 'lock'], tab: 'system', at: 'set-pin', ar: 'قفل النظام وأرقام الموظفين', en: 'PIN lock & staff PINs' },
]

const CURRENCIES = ['SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'EGP', 'USD']
const GRADIENT_PRESETS = [
  ['#7c2d2d', '#2a1212'], ['#0E7490', '#3FB6A8'], ['#4338CA', '#9333EA'],
  ['#C2410C', '#D8A24A'], ['#138063', '#C8A15A'], ['#171717', '#3f3f46'],
  ['#BE3A6B', '#E0A050'], ['#0f172a', '#334155'],
]

// Miniature live cashier preview — repaints instantly with the venue's cashier
// theme (data-systheme), layout template, and POS backdrop + opacity.
function PosPreview({ tenant, posBgOp, device = 'desktop' }) {
  const tpl = sectionTemplate(tenant, 'cashier')
  const isGrid = tpl === 'grid' || tpl === 'touch'
  return (
    <div className="pos-preview" data-systheme={systemThemeAttr(tenant, 'cashier')} data-dev={device}>
      <div className="pp-top"><span className="pp-dot" /><span className="pp-line" style={{ width: 54 }} /><span className="pp-seg" /></div>
      <div className="pp-body">
        <div className="pp-cat">
          {tenant?.posBg?.url && (
            <div className="pos-bg-layer" aria-hidden="true" style={{ opacity: posBgOp }}>
              {tenant.posBg.kind === 'video'
                ? <video src={tenant.posBg.url} autoPlay muted loop playsInline />
                : <div style={{ backgroundImage: `url(${tenant.posBg.url})` }} />}
            </div>
          )}
          <div className={isGrid ? 'pp-grid' : 'pp-list'}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="pp-tile card">
                <span className="pp-img" />
                <span className="pp-line" />
                <span className="pp-price num">12</span>
              </div>
            ))}
          </div>
        </div>
        <div className="pp-bill">
          <span className="pp-line" style={{ width: '75%' }} />
          <span className="pp-line" style={{ width: '55%' }} />
          <div className="pp-total"><span className="pp-line" style={{ width: 36 }} /><span className="pp-price num" style={{ fontSize: 13 }}>36</span></div>
          <span className="pp-btn" />
        </div>
      </div>
    </div>
  )
}

// Miniature live KDS preview — theme + template aware (display = forced dark).
function KdsPreview({ tenant, device = 'desktop' }) {
  const tpl = sectionTemplate(tenant, 'kds')
  const tickets = [['var(--brand)'], ['var(--warning)'], ['var(--danger)']]
  return (
    <div className="pos-preview" data-systheme={systemThemeAttr(tenant, 'kds')} data-theme={tpl === 'display' ? 'dark' : undefined} data-dev={device} style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="pp-top"><span className="pp-dot" style={{ background: 'var(--success)' }} /><span className="pp-line" style={{ width: 54 }} /><span className="pp-seg" /></div>
      <div className="pp-kpis">
        {[['0', 'var(--success)'], ['3', 'var(--brand)'], ['1', 'var(--success)'], ['12', 'var(--text)']].map(([n, c], i) => (
          <div key={i} className="pp-kpi"><b className="num" style={{ color: c }}>{n}</b><span className="pp-line" style={{ width: '80%' }} /></div>
        ))}
      </div>
      <div className={tpl === 'kanban' ? 'pp-lanes' : 'pp-rail'}>
        {tickets.map(([c], i) => (
          <div key={i} className="pp-ticket" style={{ borderInlineStartColor: c }}>
            <div className="row-between"><span className="pp-line" style={{ width: 34 }} /><span className="pp-price num">{5 + i}د</span></div>
            <span className="pp-line" style={{ width: '85%' }} />
            <span className="pp-line" style={{ width: '60%' }} />
            <span className="pp-bump" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Settings() {
  const { t, lang, theme, setTheme, setLang, langs } = useI18n()
  const { tenant, tenantId, updateTenantLocal, can } = useAuth()
  const toast = useToast()
  const ar = lang === 'ar'

  // `tab` now holds a SECTION id (see SECTIONS above) — the settings page has
  // one flat section index instead of tabs-inside-tabs.
  const [tab, setTab] = useState('identity')
  // Settings search (jump-to-card) + last-successful-save stamp
  const [q, setQ] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  // Kitchen (KDS) operational settings — categories for the station mapping +
  // the venue's late threshold, both saved instantly like the templates card.
  const [kdsCats, setKdsCats] = useState([])
  const [staffList, setStaffList] = useState([])
  useEffect(() => { if (!tenantId) return; return watchStaff(tenantId, setStaffList) }, [tenantId])
  const [kdsSla, setKdsSla] = useState(tenant?.kdsSla ?? 10)
  useEffect(() => { if (!tenantId) return; return watchCategories(tenantId, setKdsCats) }, [tenantId])
  // Items list (for the manual featured-items picker).
  const [allItems, setAllItems] = useState([])
  useEffect(() => { if (!tenantId) return; return watchItems(tenantId, setAllItems) }, [tenantId])
  const toggleFeatured = async (it) => { try { await saveItem(tenantId, it.id, { featured: !it.featured }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }
  useEffect(() => { setKdsSla(tenant?.kdsSla ?? 10) }, [tenant?.kdsSla])
  const saveKdsSla = async () => {
    const v = Math.max(2, Math.min(120, Number(kdsSla) || 10))
    setKdsSla(v)
    if (v === (tenant?.kdsSla ?? 10)) return
    try { await saveNow({ kdsSla: v }); updateTenantLocal({ kdsSla: v }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
  }
  const saveKdsStation = async (catId, raw) => {
    const v = (raw || '').trim()
    const cur = tenant?.kdsStations || {}
    if ((cur[catId] || '') === v) return
    const next = { ...cur }
    if (v) next[catId] = v
    else delete next[catId]
    try { await saveNow({ kdsStations: next }); updateTenantLocal({ kdsStations: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
  }
  const [name, setName] = useState(tenant?.name || '')
  const [descAr, setDescAr] = useState(tenant?.descAr || '')
  const [phone, setPhone] = useState(tenant?.phone || '')
  const [address, setAddress] = useState(tenant?.address || '')
  const [currency, setCurrency] = useState(tenant?.currency || 'SAR')
  const initSkin = getSkin(tenant?.skin?.skinId)
  const initOv = tenant?.skin?.overrides || {}
  const [skinId, setSkinId] = useState(tenant?.skin?.skinId || 'classic')
  const [ovFont, setOvFont] = useState(initOv.font || initSkin.tokens.font)
  const [ovShape, setOvShape] = useState(initOv.shape || initSkin.tokens.shape)
  const [ovLayout, setOvLayout] = useState(initOv.menuLayout || initSkin.layout.menuLayout)
  const [ovHeader, setOvHeader] = useState(initOv.header || '') // '' = use the theme's default header
  const [ovBottomNav, setOvBottomNav] = useState(initOv.bottomNav || '') // '' = use the theme's default nav
  const [ovMotion, setOvMotion] = useState(initOv.motion || '') // '' = default (fade-up)
  const [ovMotionSpeed, setOvMotionSpeed] = useState(initOv.motionSpeed || 'normal')
  const [ovMotionRepeat, setOvMotionRepeat] = useState(initOv.motionRepeat || 'always')
  const [ovTap, setOvTap] = useState(initOv.tap || 'press')
  const [ovDetailLayout, setOvDetailLayout] = useState(initOv.detailLayout || '') // '' = use default layout
  const [ovItemImageStyle, setOvItemImageStyle] = useState(initOv.itemImageStyle || '') // '' = use default style
  const [ovSpotSize, setOvSpotSize] = useState(initOv.spotImageSize || 'md') // spotlight product-image size
  const [ovHidden, setOvHidden] = useState(initOv.hidden || []) // element keys hidden from the menu
  const [customThemes, setCustomThemes] = useState(tenant?.customThemes || []) // saved named themes
  const [newThemeName, setNewThemeName] = useState('')
  const [skinsExpanded, setSkinsExpanded] = useState(false)
  const [typo, setTypo] = useState(tenant?.typo || {}) // per-element color + size overrides
  const setTypoField = (key, prop, val) => setTypo((tp) => {
    if (prop === null) { const n = { ...tp }; delete n[key]; return n }
    return { ...tp, [key]: { ...(tp[key] || {}), [prop]: val } }
  })
  const [preset, setPreset] = useState(tenant?.themePreset || 'maroon')
  const [color, setColor] = useState(initOv.brand || tenant?.themeColor || initSkin.tokens.brand)
  const [accent, setAccent] = useState(initOv.accent || tenant?.themeAccent || initSkin.tokens.accent)
  const [logoUrl, setLogoUrl] = useState(tenant?.logoUrl || '')
  const [coverUrl, setCoverUrl] = useState(tenant?.coverUrl || '')
  const [bannerUrl, setBannerUrl] = useState(tenant?.bannerUrl || '')
  const [bannerOpacity, setBannerOpacity] = useState(tenant?.bannerOpacity != null ? tenant.bannerOpacity : 1)
  const [bannerPosition, setBannerPosition] = useState(tenant?.bannerPosition || 'center')
  const [bannerScale, setBannerScale] = useState(tenant?.bannerScale != null ? tenant.bannerScale : 1)
  const [bannerGradient, setBannerGradient] = useState(tenant?.bannerGradient != null ? tenant.bannerGradient : 0.55)
  const [bannerStyle, setBannerStyle] = useState(tenant?.bannerStyle || 'full')
  const [bannerVideoUrl, setBannerVideoUrl] = useState(tenant?.bannerVideoUrl || '')
  const [bannerFadeDir, setBannerFadeDir] = useState(tenant?.bannerFadeDir || 'bottom') // bottom | top | both | none
  const [immersiveBgUrl, setImmersiveBgUrl] = useState(tenant?.immersiveBgUrl || '')
  const [immersiveBgVideoUrl, setImmersiveBgVideoUrl] = useState(tenant?.immersiveBgVideoUrl || '')
  const [immersiveBgOpacity, setImmersiveBgOpacity] = useState(tenant?.immersiveBgOpacity != null ? tenant.immersiveBgOpacity : 0.5)
  const [immersiveBgPosition, setImmersiveBgPosition] = useState(tenant?.immersiveBgPosition || 'center')
  const [immersiveBgScale, setImmersiveBgScale] = useState(tenant?.immersiveBgScale != null ? tenant.immersiveBgScale : 1)
  const [immersiveFull, setImmersiveFull] = useState(tenant?.immersiveFull === true)
  const [bgImageUrl, setBgImageUrl] = useState(tenant?.bgImageUrl || '')
  const [bgVideoUrl, setBgVideoUrl] = useState(tenant?.bgVideoUrl || '')
  // Media-library picker: { kind, apply(url,item) } — reuse an already-uploaded asset
  const [libPick, setLibPick] = useState(null)
  const [watermarkUrl, setWatermarkUrl] = useState(tenant?.watermarkUrl || '')
  const [bgOpacity, setBgOpacity] = useState(tenant?.bgOpacity != null ? tenant.bgOpacity : 0.15)
  const [bgPosition, setBgPosition] = useState(tenant?.bgPosition || 'center')
  const [bgScale, setBgScale] = useState(tenant?.bgScale != null ? tenant.bgScale : 1)
  const [gradEnabled, setGradEnabled] = useState(tenant?.gradEnabled === true)
  const [gradC1, setGradC1] = useState(tenant?.gradC1 || '#7c2d2d')
  const [gradC2, setGradC2] = useState(tenant?.gradC2 || '#2a1212')
  const [gradAngle, setGradAngle] = useState(tenant?.gradAngle != null ? tenant.gradAngle : 135)
  const [previewMode, setPreviewMode] = useState('mobile')
  const [aSec, setASec] = useState('theme') // appearance sub-tab (theme|elements|colors|media|details|staff)
  const [staffPrev, setStaffPrev] = useState('pos') // staff preview: pos | kds
  const [staffDev, setStaffDev] = useState('desktop') // staff preview device (desktop default)
  const [pinDev, setPinDev] = useState('tablet') // lock-screen preview device (tablet default)
  // lock-screen style helpers (nested pinLockStyle object, debounced for sliders)
  const pinStyle = tenant?.pinLockStyle || {}
  const savePinStyle = async (patch) => {
    const next = { ...pinStyle, ...patch }
    try { await saveNow({ pinLockStyle: next }); updateTenantLocal({ pinLockStyle: next }) } catch (_) { toast.error(t('error')) }
  }
  const [pinBgBusy, setPinBgBusy] = useState(false)
  // cashier POS backdrop (image/video behind the item grid)
  const [posBgOp, setPosBgOp] = useState(tenant?.posBgOpacity ?? 0.12)
  useEffect(() => { setPosBgOp(tenant?.posBgOpacity ?? 0.12) }, [tenant?.posBgOpacity])
  const [posBgBusy, setPosBgBusy] = useState(false)
  const [posBgPos, setPosBgPos] = useState(tenant?.posBgPosition || 'center')
  const [posBgScale, setPosBgScale] = useState(tenant?.posBgScale ?? 1)
  useEffect(() => { setPosBgPos(tenant?.posBgPosition || 'center'); setPosBgScale(tenant?.posBgScale ?? 1) }, [tenant?.posBgPosition, tenant?.posBgScale])
  const posBgTimer = useRef(null)
  // ROOT FIX (lost writes): this debounce is SHARED by many controls. It used to
  // save only the LAST patch — a new call on a different field cancelled the
  // pending one, silently losing it. Now patches ACCUMULATE and flush merged.
  const pendingDesign = useRef({})
  const commitPosBg = (patch) => {
    pendingDesign.current = { ...pendingDesign.current, ...patch }
    clearTimeout(posBgTimer.current)
    posBgTimer.current = setTimeout(async () => {
      const merged = pendingDesign.current
      pendingDesign.current = {}
      try { await saveNow(merged); updateTenantLocal(merged) } catch (_) { toast.error(t('error')) }
    }, 400)
  }
  // leaving the page flushes anything still pending so no tweak is ever dropped
  useEffect(() => () => {
    if (Object.keys(pendingDesign.current).length) {
      clearTimeout(posBgTimer.current)
      saveNow(pendingDesign.current).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // ROOT FIX («يتبع العام لا يتبع»): EVERY immediate design write purges its keys
  // from the pending debounce first — otherwise a queued slider patch (holding
  // the OLD map, deleted key included) flushes 400ms later and RESURRECTS what
  // the user just reset. Snapshot before purging so flushing pending itself works.
  const saveNow = async (patch) => {
    const p = { ...patch }
    Object.keys(p).forEach((k) => delete pendingDesign.current[k])
    const res = await updTenantRaw(tenantId, p)
    setLastSavedAt(new Date()) // feeds the tiny «آخر حفظ HH:MM» stamp next to Save
    return res
  }
  // custom system theme editor (THEMES_HUB #21/#22) — draft kept local until save
  const [custEdit, setCustEdit] = useState(null)

  // ===== design history: undo/redo across the WHOLE studio (Ctrl+Z / Ctrl+Y +
  // header buttons). Snapshot-diff based, so it captures every tenant design
  // write no matter which control made it; rapid slider ticks coalesce (800ms)
  // into one step. Platform-owned fields are never recorded or replayed.
  const HIST_SKIP = ['updatedAt', 'createdAt', 'plan', 'planStatus', 'planExpiresAt', 'active', 'suspendReason', 'platformNote', 'ownerUid', 'setupDone']
  const histRef = useRef({ undo: [], redo: [], applying: false, prev: null })
  const [histVer, setHistVer] = useState(0)
  useEffect(() => {
    const h = histRef.current
    const prev = h.prev
    h.prev = tenant
    if (!prev || !tenant) return
    if (h.applying) { h.applying = false; return }
    const before = {}
    const after = {}
    let changed = false
    new Set([...Object.keys(prev), ...Object.keys(tenant)]).forEach((k) => {
      if (HIST_SKIP.includes(k)) return
      if (JSON.stringify(prev[k] ?? null) !== JSON.stringify(tenant[k] ?? null)) {
        before[k] = prev[k] ?? null; after[k] = tenant[k] ?? null; changed = true
      }
    })
    if (!changed) return
    const now = Date.now()
    const last = h.undo[h.undo.length - 1]
    if (last && now - last.at < 800) {
      Object.keys(before).forEach((k) => { if (!(k in last.before)) last.before[k] = before[k] })
      Object.assign(last.after, after)
      last.at = now
    } else {
      h.undo.push({ before, after, at: now })
      if (h.undo.length > 60) h.undo.shift()
    }
    h.redo = []
    setHistVer((v) => v + 1)
  }, [tenant]) // eslint-disable-line react-hooks/exhaustive-deps
  const applyHist = async (dir) => {
    const h = histRef.current
    const entry = dir === 'undo' ? h.undo.pop() : h.redo.pop()
    if (!entry) return
    ;(dir === 'undo' ? h.redo : h.undo).push(entry)
    const patch = dir === 'undo' ? entry.before : entry.after
    h.applying = true
    updateTenantLocal(patch)
    setHistVer((v) => v + 1)
    try { await saveNow(patch) } catch (_) { toast.error(t('error')) }
  }
  const applyHistRef = useRef(applyHist)
  applyHistRef.current = applyHist
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = (e.key || '').toLowerCase()
      if (k !== 'z' && k !== 'y') return
      const el = document.activeElement
      const typing = el && (el.tagName === 'TEXTAREA' || el.isContentEditable
        || (el.tagName === 'INPUT' && !['range', 'color', 'checkbox', 'radio', 'file'].includes(el.type)))
      if (typing) return // text fields keep the browser's native undo
      e.preventDefault()
      applyHistRef.current(k === 'y' || e.shiftKey ? 'redo' : 'undo')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(tenant?.loyaltyEnabled !== false)
  const [loyaltyThreshold, setLoyaltyThreshold] = useState(tenant?.loyaltyThreshold || 5)
  const mp = tenant?.membershipPolicy || {}
  const [memEnabled, setMemEnabled] = useState(mp.enabled === true)
  const [memMinOrders, setMemMinOrders] = useState(mp.minOrders ?? 10)
  const [memMinSpent, setMemMinSpent] = useState(mp.minSpent ?? 300)
  const [memMinAvg, setMemMinAvg] = useState(mp.minAvgBasket ?? 25)
  const [memEarnRate, setMemEarnRate] = useState(mp.earnRate ?? 1)
  const [memRedeemRate, setMemRedeemRate] = useState(mp.redeemRate ?? 20)
  const [memSilverPct, setMemSilverPct] = useState(mp.tiers?.silver?.discountPct ?? 5)
  const [memGoldMin, setMemGoldMin] = useState(mp.tiers?.gold?.minPoints ?? 500)
  const [memGoldPct, setMemGoldPct] = useState(mp.tiers?.gold?.discountPct ?? 10)
  const [memPlatMin, setMemPlatMin] = useState(mp.tiers?.platinum?.minPoints ?? 1500)
  const [memPlatPct, setMemPlatPct] = useState(mp.tiers?.platinum?.discountPct ?? 15)
  // Tier progression mode: 'orders' = completed orders promote (5 active → 10 gold →
  // 15 platinum by default), 'points' = legacy lifetime-points thresholds.
  const [memTierBy, setMemTierBy] = useState(mp.tierBy || 'orders')
  const [memGoldMinOrders, setMemGoldMinOrders] = useState(mp.tiers?.gold?.minOrders ?? 10)
  const [memPlatMinOrders, setMemPlatMinOrders] = useState(mp.tiers?.platinum?.minOrders ?? 15)
  const [vipPreviewTier, setVipPreviewTier] = useState('gold') // card designer preview
  const [vipBgBusy, setVipBgBusy] = useState(false)
  // Loyalty MODE: 'discounts' (classic tier %) or 'perks' (privileged notifications
  // instead of discounts — offers/featured/new-item WhatsApp alerts per tier).
  const [memMode, setMemMode] = useState(mp.mode || 'discounts')
  const [memPerks, setMemPerks] = useState({
    silver: { offers: mp.perks?.silver?.offers !== false, featured: mp.perks?.silver?.featured === true, newItems: mp.perks?.silver?.newItems === true },
    gold: { offers: mp.perks?.gold?.offers !== false, featured: mp.perks?.gold?.featured !== false, newItems: mp.perks?.gold?.newItems === true },
    platinum: { offers: mp.perks?.platinum?.offers !== false, featured: mp.perks?.platinum?.featured !== false, newItems: mp.perks?.platinum?.newItems !== false },
  })
  const setPerk = (tier, key, val) => setMemPerks((p) => ({ ...p, [tier]: { ...p[tier], [key]: val } }))
  const [memExpiry, setMemExpiry] = useState(mp.pointsExpiryDays ?? 0)
  const [memSelfDiscount, setMemSelfDiscount] = useState(mp.memberSelfDiscount !== false)
  const [memMultiplier, setMemMultiplier] = useState(mp.pointsMultiplier ?? 1)
  const [memBday, setMemBday] = useState(mp.birthdayBonus ?? 0)
  const [vatEnabled, setVatEnabled] = useState(tenant?.vatEnabled === true)
  const [vatRate, setVatRate] = useState(tenant?.vatRate ?? 15)
  const [vatNumber, setVatNumber] = useState(tenant?.vatNumber || '')
  const [curbsideEnabled, setCurbsideEnabled] = useState(tenant?.curbsideEnabled === true)
  const [geo, setGeo] = useState(tenant?.geo || null)
  const [geofenceRadius, setGeofenceRadius] = useState(tenant?.geofenceRadius || 200)
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState('')
  const [cropState, setCropState] = useState(null)

  // Receipt Settings states
  const [receiptHeader, setReceiptHeader] = useState(tenant?.receiptHeader || '')
  const [receiptFooter, setReceiptFooter] = useState(tenant?.receiptFooter || '')
  const [receiptShowLogo, setReceiptShowLogo] = useState(tenant?.receiptShowLogo !== false)
  const [receiptShowVat, setReceiptShowVat] = useState(tenant?.receiptShowVat !== false)
  const [receiptShowBarcode, setReceiptShowBarcode] = useState(tenant?.receiptShowBarcode !== false)
  const [receiptShowCustomer, setReceiptShowCustomer] = useState(tenant?.receiptShowCustomer !== false)
  const [receiptFontSize, setReceiptFontSize] = useState(tenant?.receiptFontSize || 'medium')
  const [receiptExtraNote, setReceiptExtraNote] = useState(tenant?.receiptExtraNote || '')

  // Integration States
  const [payGateway, setPayGateway] = useState(tenant?.payGateway || 'none')
  const [payApiKey, setPayApiKey] = useState(tenant?.payApiKey || '')
  const [accountingSystem, setAccountingSystem] = useState(tenant?.accountingSystem || 'none')
  const [smsGateway, setSmsGateway] = useState(tenant?.smsGateway || 'none')
  const [smsApiKey, setSmsApiKey] = useState(tenant?.smsApiKey || '')
  const [smsTemplate, setSmsTemplate] = useState(tenant?.smsTemplate || '')
  const [notifyWa, setNotifyWa] = useState(tenant?.customerNotify?.whatsapp !== false)
  const [notifyEmail, setNotifyEmail] = useState(tenant?.customerNotify?.email !== false)

  // Custom webhook integration states
  const [customWebhookEnabled, setCustomWebhookEnabled] = useState(tenant?.customWebhookEnabled === true)
  const [customWebhookUrl, setCustomWebhookUrl] = useState(tenant?.customWebhookUrl || '')
  const [customWebhookToken, setCustomWebhookToken] = useState(tenant?.customWebhookToken || '')

  // (A second full-snapshot undo system used to live here. It ALSO intercepted
  // Ctrl+Z — without the text-field guard — so two histories fought each other
  // and broke native typing undo. The saved-change history above [histRef] is
  // the single undo system now; the header buttons are wired to it below.)

  const link = tenant?.slug ? menuUrl(tenant.slug) : ''
  const gradientCss = gradEnabled ? `linear-gradient(${gradAngle}deg, ${gradC1}, ${gradC2})` : ''
  // Tenant-shaped appearance streamed live to the real-menu preview iframe.
  const skinOverrides = { brand: color, accent, font: ovFont, shape: ovShape, menuLayout: ovLayout, motionSpeed: ovMotionSpeed, motionRepeat: ovMotionRepeat, tap: ovTap, detailLayout: ovDetailLayout, itemImageStyle: ovItemImageStyle, spotImageSize: ovSpotSize, ...(ovHeader ? { header: ovHeader } : {}), ...(ovBottomNav ? { bottomNav: ovBottomNav } : {}), ...(ovMotion ? { motion: ovMotion } : {}), ...(ovHidden.length ? { hidden: ovHidden } : {}) }
  const previewOverride = {
    name: name.trim(), descAr: descAr.trim(), logoUrl, coverUrl, currency, curbsideEnabled,
    skin: { skinId, overrides: skinOverrides }, themePreset: preset, themeColor: color, themeAccent: accent,
    bannerUrl, bannerVideoUrl, bannerFadeDir, bannerOpacity: Number(bannerOpacity), bannerPosition, bannerScale: Number(bannerScale), bannerGradient: Number(bannerGradient), bannerStyle,
    immersiveBgUrl, immersiveBgVideoUrl, immersiveBgOpacity: Number(immersiveBgOpacity), immersiveBgPosition, immersiveBgScale: Number(immersiveBgScale), immersiveFull,
    typo,
    bgGradient: gradientCss, bgImageUrl, bgVideoUrl: bgVideoUrl.trim(), watermarkUrl,
    bgOpacity: Number(bgOpacity), bgPosition, bgScale: Number(bgScale),
  }

  const onPick = (e, kind) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) setCropState({ file, kind }) }
  const onCropped = async (blob, kind) => {
    setCropState(null); setUploading(kind)
    try {
      const fileObj = new File([blob], `${kind}.webp`, { type: 'image/webp' })
      const url = await uploadImage(tenantId, fileObj, 'branding')
      if (kind === 'logo') setLogoUrl(url); else setCoverUrl(url)
      const patch = kind === 'logo' ? { logoUrl: url } : { coverUrl: url }
      await saveNow(patch); updateTenantLocal(patch); toast.success(t('saved'))
    } catch (_) { toast.error(ar ? 'تعذّر رفع الصورة (فعّل Storage)' : 'Upload failed (enable Storage)') } finally { setUploading('') }
  }
  const onBgFile = async (e, kind) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setUploading(kind)
    try {
      const small = await shrinkImage(file, kind === 'watermark' ? 600 : 1600, 0.85)
      const url = await uploadImage(tenantId, small, 'branding')
      const patch = kind === 'watermark' ? { watermarkUrl: url } : kind === 'banner' ? { bannerUrl: url } : kind === 'immersive' ? { immersiveBgUrl: url } : { bgImageUrl: url }
      if (kind === 'watermark') setWatermarkUrl(url)
      else if (kind === 'banner') setBannerUrl(url)
      else if (kind === 'immersive') setImmersiveBgUrl(url)
      else { setBgImageUrl(url); setBgVideoUrl(''); patch.bgVideoUrl = '' }
      await saveNow(patch); updateTenantLocal(patch); toast.success(t('saved'))
    } catch (_) { toast.error(ar ? 'تعذّر رفع الصورة (فعّل Storage)' : 'Upload failed (enable Storage)') } finally { setUploading('') }
  }
  // Art backdrop (oceanart theme): AI generation in the theme's visual
  // language + manual upload. Both instant-save tenant.artBgUrl.
  const [artBgBusy, setArtBgBusy] = useState(false)
  const ART_TONE_PROMPTS = {
    deepblue: 'BACKGROUND SURFACE ONLY: an empty deep royal cobalt-blue textured plaster tabletop photographed from directly above, rich saturated blue, subtle brush strokes and soft vignette, moody studio light, a couple of lemon wedges and green leaves ONLY at the far corners, ABSOLUTELY NO dishes, NO plated food, NO products, NO text, NO hands',
    emerald: 'BACKGROUND SURFACE ONLY: an empty deep emerald-green textured stone tabletop from directly above, luxurious dark green, soft vignette, faint herb sprigs ONLY at the far corners, ABSOLUTELY NO dishes, NO plated food, NO products, NO text',
    burgundy: 'BACKGROUND SURFACE ONLY: an empty deep burgundy velvet-textured plaster surface from directly above, rich wine red, soft studio vignette, a few scattered rose petals ONLY at the far edges, ABSOLUTELY NO dishes, NO plated food, NO products, NO text',
    charcoal: 'BACKGROUND SURFACE ONLY: an empty near-black charcoal slate surface from directly above, subtle stone texture, dramatic low-key light, faint scattered peppercorns and herbs ONLY at the far corners, ABSOLUTELY NO dishes, NO plated food, NO products, NO text',
  }
  const genArtBg = async () => {
    if (artBgBusy) return
    setArtBgBusy(true)
    try {
      const { generatePostImage } = await import('../../lib/postGen.js')
      const tone = tenant?.artBgTone || 'deepblue'
      const blob = await generatePostImage({ stylePrompt: ART_TONE_PROMPTS[tone], tenant, venueName: tenant?.name || '' })
      const url = await uploadImage(tenantId, blob, 'branding')
      await saveNow({ artBgUrl: url }); updateTenantLocal({ artBgUrl: url })
      toast.success(ar ? 'وُلدت الخلفية وطُبقت' : 'Backdrop generated & applied')
    } catch (e) {
      toast.error(String(e?.message || e))
    } finally { setArtBgBusy(false) }
  }
  const onArtBgFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setUploading('artbg')
    try {
      const small = await shrinkImage(file, 1800, 0.85)
      const url = await uploadImage(tenantId, small, 'branding')
      await saveNow({ artBgUrl: url }); updateTenantLocal({ artBgUrl: url }); toast.success(t('saved'))
    } catch (_) { toast.error(ar ? 'تعذّر رفع الصورة (فعّل Storage)' : 'Upload failed (enable Storage)') } finally { setUploading('') }
  }
  const onVideoFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (file.size > 25 * 1024 * 1024) { toast.error(ar ? 'الفيديو أكبر من 25 ميجا' : 'Video larger than 25MB'); return }
    setUploading('video')
    try {
      const url = await uploadFile(tenantId, file, 'branding')
      setBgVideoUrl(url)
      await saveNow({ bgVideoUrl: url }); updateTenantLocal({ bgVideoUrl: url }); toast.success(t('saved'))
    } catch (_) { toast.error(ar ? 'تعذّر رفع الفيديو (فعّل Storage)' : 'Upload failed (enable Storage)') } finally { setUploading('') }
  }
  // Banner VIDEO (hero) — replaces the banner image when set; same controls apply.
  const onBannerVideoFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (file.size > 25 * 1024 * 1024) { toast.error(ar ? 'الفيديو أكبر من 25 ميجا' : 'Video larger than 25MB'); return }
    setUploading('bannerVideo')
    try {
      const url = await uploadFile(tenantId, file, 'branding')
      setBannerVideoUrl(url)
      await saveNow({ bannerVideoUrl: url }); updateTenantLocal({ bannerVideoUrl: url }); toast.success(t('saved'))
    } catch (_) { toast.error(ar ? 'تعذّر رفع الفيديو (فعّل Storage)' : 'Upload failed (enable Storage)') } finally { setUploading('') }
  }
  const onDetailsVideoFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (file.size > 25 * 1024 * 1024) { toast.error(ar ? 'الفيديو أكبر من 25 ميجا' : 'Video larger than 25MB'); return }
    setUploading('immersive-video')
    try {
      const url = await uploadFile(tenantId, file, 'branding')
      setImmersiveBgVideoUrl(url)
      await saveNow({ immersiveBgVideoUrl: url }); updateTenantLocal({ immersiveBgVideoUrl: url }); toast.success(t('saved'))
    } catch (_) { toast.error(ar ? 'تعذّر رفع الفيديو' : 'Upload failed') } finally { setUploading('') }
  }
  const clearField = async (key, setter) => {
    setter('')
    updateTenantLocal({ [key]: '' })
    try { await saveNow({ [key]: '' }) } catch (_) { toast.error(t('error')) }
  }

  // ----- named custom themes (save the whole current skin config under a name) -----
  const persistThemes = async (list) => {
    setCustomThemes(list)
    updateTenantLocal({ customThemes: list })
    try { await saveNow({ customThemes: list }) } catch (_) { toast.error(t('error')) }
  }
  // A full snapshot of EVERY appearance field (so a saved theme restores backgrounds, banner, typography… exactly).
  const currentAppearance = () => ({
    themePreset: preset, themeColor: color, themeAccent: accent,
    bannerUrl, bannerVideoUrl, bannerFadeDir, bannerOpacity, bannerPosition, bannerScale, bannerGradient, bannerStyle,
    immersiveBgUrl, immersiveBgVideoUrl, immersiveBgOpacity, immersiveBgPosition, immersiveBgScale, immersiveFull,
    bgImageUrl, bgVideoUrl, watermarkUrl, bgOpacity, bgPosition, bgScale,
    gradEnabled, gradC1, gradC2, gradAngle, typo,
  })
  const saveCurrentAsTheme = () => {
    const nm = newThemeName.trim()
    if (!nm) { toast.error(ar ? 'أدخل اسماً للثيم' : 'Enter a theme name'); return }
    const ct = { id: 'ct_' + Date.now(), name: nm, skinId, overrides: skinOverrides, appearance: currentAppearance() }
    persistThemes([...customThemes.filter((c) => c.name !== nm), ct]); setNewThemeName(''); toast.success(ar ? 'حُفظ الثيم' : 'Theme saved')
  }
  const applyCustomTheme = (ct) => {
    const o = ct.overrides || {}
    const a = ct.appearance || {}
    const base = getSkin(ct.skinId)
    setSkinId(ct.skinId || 'classic')
    setColor(o.brand || a.themeColor || base.tokens.brand); setAccent(o.accent || a.themeAccent || base.tokens.accent)
    setOvFont(o.font || base.tokens.font); setOvShape(o.shape || base.tokens.shape); setOvLayout(o.menuLayout || base.layout.menuLayout)
    setOvHeader(o.header || ''); setOvBottomNav(o.bottomNav || ''); setOvMotion(o.motion || ''); setOvMotionSpeed(o.motionSpeed || 'normal'); setOvMotionRepeat(o.motionRepeat || 'always'); setOvTap(o.tap || 'press'); setOvDetailLayout(o.detailLayout || ''); setOvItemImageStyle(o.itemImageStyle || ''); setOvSpotSize(o.spotImageSize || 'md'); setOvHidden(o.hidden || [])
    // restore the full appearance snapshot (older themes without it keep current backgrounds)
    if (ct.appearance) {
      setPreset(a.themePreset || 'custom')
      setBannerUrl(a.bannerUrl || ''); setBannerVideoUrl(a.bannerVideoUrl || ''); setBannerFadeDir(a.bannerFadeDir || 'bottom'); setBannerOpacity(a.bannerOpacity ?? 1); setBannerPosition(a.bannerPosition || 'center'); setBannerScale(a.bannerScale ?? 1); setBannerGradient(a.bannerGradient ?? 0.55); setBannerStyle(a.bannerStyle || 'full')
      setImmersiveBgUrl(a.immersiveBgUrl || ''); setImmersiveBgVideoUrl(a.immersiveBgVideoUrl || ''); setImmersiveBgOpacity(a.immersiveBgOpacity ?? 0.5); setImmersiveBgPosition(a.immersiveBgPosition || 'center'); setImmersiveBgScale(a.immersiveBgScale ?? 1); setImmersiveFull(a.immersiveFull === true)
      setBgImageUrl(a.bgImageUrl || ''); setBgVideoUrl(a.bgVideoUrl || ''); setWatermarkUrl(a.watermarkUrl || ''); setBgOpacity(a.bgOpacity ?? 0.15); setBgPosition(a.bgPosition || 'center'); setBgScale(a.bgScale ?? 1)
      setGradEnabled(a.gradEnabled === true); setGradC1(a.gradC1 || '#7c2d2d'); setGradC2(a.gradC2 || '#2a1212'); setGradAngle(a.gradAngle ?? 135)
      setTypo(a.typo || {})
    } else {
      setPreset('custom')
    }
    applyTheme({ brand: o.brand || a.themeColor || base.tokens.brand, accent: o.accent || a.themeAccent || base.tokens.accent })
  }
  const removeCustomTheme = (id) => persistThemes(customThemes.filter((c) => c.id !== id))

  const save = async () => {
    setBusy(true)
    try {
      const patch = {
        name: name.trim(), descAr: descAr.trim(), phone: phone.trim(), address: address.trim(), currency,
        skin: { skinId, overrides: skinOverrides }, themePreset: preset, themeColor: color, themeAccent: accent,
        logoUrl, coverUrl,
        bannerUrl, bannerVideoUrl, bannerFadeDir, bannerOpacity: Number(bannerOpacity), bannerPosition, bannerScale: Number(bannerScale), bannerGradient: Number(bannerGradient), bannerStyle,
        immersiveBgUrl, immersiveBgVideoUrl, immersiveBgOpacity: Number(immersiveBgOpacity), immersiveBgPosition, immersiveBgScale: Number(immersiveBgScale), immersiveFull,
        typo,
        bgImageUrl, bgVideoUrl: bgVideoUrl.trim(), watermarkUrl,
        bgOpacity: Number(bgOpacity), bgPosition, bgScale: Number(bgScale),
        gradEnabled, gradC1, gradC2, gradAngle: Number(gradAngle), bgGradient: gradientCss,
        loyaltyEnabled, loyaltyThreshold: Number(loyaltyThreshold) || 5, curbsideEnabled,
        vatEnabled, vatRate: Number(vatRate) || 15, vatNumber: vatNumber.trim(),
        receiptHeader: receiptHeader.trim(),
        receiptFooter: receiptFooter.trim(),
        receiptShowLogo,
        receiptShowVat,
        receiptShowBarcode,
        receiptShowCustomer,
        receiptFontSize,
        receiptExtraNote: receiptExtraNote.trim(),
        payGateway,
        payApiKey: payApiKey.trim(),
        accountingSystem,
        smsGateway,
        smsApiKey: smsApiKey.trim(),
        smsTemplate: smsTemplate.trim(),
        customerNotify: { whatsapp: notifyWa, email: notifyEmail },
        customWebhookEnabled,
        customWebhookUrl: customWebhookUrl.trim(),
        customWebhookToken: customWebhookToken.trim(),
        membershipPolicy: {
          enabled: memEnabled,
          minOrders: Number(memMinOrders) || 0,
          minSpent: Number(memMinSpent) || 0,
          minAvgBasket: Number(memMinAvg) || 0,
          earnRate: Number(memEarnRate) || 1,
          redeemRate: Number(memRedeemRate) || 20,
          pointsExpiryDays: Number(memExpiry) || 0,
          memberSelfDiscount: memSelfDiscount,
          pointsMultiplier: Number(memMultiplier) || 1,
          birthdayBonus: Number(memBday) || 0,
          tierBy: memTierBy,
          mode: memMode,
          perks: memPerks,
          tiers: {
            silver: { minPoints: 0, minOrders: 0, discountPct: Number(memSilverPct) || 0 },
            gold: { minPoints: Number(memGoldMin) || 0, minOrders: Number(memGoldMinOrders) || 0, discountPct: Number(memGoldPct) || 0 },
            platinum: { minPoints: Number(memPlatMin) || 0, minOrders: Number(memPlatMinOrders) || 0, discountPct: Number(memPlatPct) || 0 },
          },
        },
        geo: geo || null, geofenceRadius: Number(geofenceRadius) || 200,
      }
      await saveNow(patch); updateTenantLocal(patch); toast.success(t('saved'))
      savedSnapRef.current = designSnap() // drafts now match the live menu
    } catch (_) { toast.error(t('error')) } finally { setBusy(false) }
  }
  const copyLink = async () => { try { await navigator.clipboard.writeText(link); toast.success(t('copied')) } catch (_) { toast.error(t('error')) } }

  // ----- settings search: match the static registry, jump straight to the card -----
  // Matching also covers the destination SECTION title, so typing «تشغيل» or
  // «marketing» surfaces everything that lives there.
  const searchMatches = useMemo(() => {
    const qq = q.trim().toLowerCase()
    if (!qq) return []
    return SEARCH_INDEX.filter((s) => {
      const dest = SECTIONS.find((x) => x.id === s.tab)
      return s.keys.some((k) => k.includes(qq) || qq.includes(k))
        || s.ar.includes(qq) || s.en.toLowerCase().includes(qq)
        || (dest ? dest.ar.includes(qq) || dest.en.toLowerCase().includes(qq) : false)
    }).slice(0, 8)
  }, [q])
  const jumpTo = (m) => {
    setTab(m.tab)
    if (m.aSec) setASec(m.aSec)
    setQ(''); setSearchOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    // the section has to paint before its card exists — scroll on the next frame
    if (m.at) requestAnimationFrame(() => {
      const el = document.getElementById(m.at)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    toast.success((ar ? 'انتقلت إلى: ' : 'Jumped to: ') + (ar ? m.ar : m.en))
  }

  // ----- one-tap design bundles: set several DRAFT states at once (Save still commits) -----
  const applyBundle = (bundleSkinId, { layout, fade } = {}) => {
    const s = getSkin(bundleSkinId)
    setSkinId(s.id); setColor(s.tokens.brand); setAccent(s.tokens.accent)
    setOvFont(s.tokens.font); setOvShape(s.tokens.shape); setOvLayout(layout || s.layout.menuLayout)
    setOvHeader(''); setOvBottomNav(''); setOvMotion(''); setOvMotionSpeed('normal'); setOvMotionRepeat('always')
    setOvTap('press'); setOvDetailLayout(''); setOvItemImageStyle(''); setOvSpotSize('md'); setPreset('custom')
    if (fade) setBannerFadeDir(fade)
    applyTheme({ brand: s.tokens.brand, accent: s.tokens.accent })
    toast.success(ar ? 'طُبّقت الحزمة — اضغط حفظ لتثبيتها' : 'Bundle applied — press Save to keep it')
  }

  // ===== unsaved-changes detector: the menu appearance (skins/colors/media) is
  // DRAFT-based — the live preview follows instantly but the REAL menu changes
  // only on Save. Without a visible flag this reads as "customization broken".
  const designSnap = () => JSON.stringify([currentAppearance(), skinId, skinOverrides])
  const savedSnapRef = useRef(null)
  if (savedSnapRef.current == null && tenant) savedSnapRef.current = designSnap()
  const designDirty = savedSnapRef.current != null && savedSnapRef.current !== designSnap()

  // Each section is visible if the user holds ANY of its caps — unchanged rule,
  // so a scoped staffer (e.g. appearance-only) still sees just their section.
  const TABS = SECTIONS.filter((tb) => tb.caps.some((c) => can(c)))
  const secMeta = TABS.find((s) => s.id === tab) || TABS[0] || null

  // If the current section got filtered out (scoped staffer), snap to the first allowed one.
  useEffect(() => {
    if (TABS.length && !TABS.some((tb) => tb.id === tab)) setTab(TABS[0].id)
  }, [TABS.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page stack settings-page" style={{ gap: 'var(--sp-3)' }}>
      <h2 className="page-title">{t('settings')}</h2>

      {cropState && (
        <ImageCropper file={cropState.file} aspect={cropState.kind === 'logo' ? 1 : 2.5}
          output={cropState.kind === 'logo' ? { width: 512, height: 512 } : { width: 1500, height: 600 }}
          title={cropState.kind === 'logo' ? (ar ? 'قص الشعار' : 'Crop logo') : (ar ? 'قص الغلاف' : 'Crop cover')}
          hint={cropState.kind === 'logo' ? (ar ? 'المقاس المناسب 512×512' : 'Recommended 512×512') : (ar ? 'المقاس المناسب 1500×600' : 'Recommended 1500×600')}
          onClose={() => setCropState(null)} onCropped={(blob) => onCropped(blob, cropState.kind)} />
      )}

      {/* ---- top bar: search every control + the studio's undo/redo ---- */}
      <div className="set-topbar">
        {/* type a keyword, pick a match, land on the exact card (not just the section) */}
        <div className="set-search">
          <Icon name="search" size={13} className="set-search-ico" />
          <input
            className="input input-sm"
            value={q}
            placeholder={ar ? 'ابحث عن أي إعداد…' : 'Search any setting…'}
            aria-label={ar ? 'ابحث في الإعدادات' : 'Search settings'}
            onChange={(e) => { setQ(e.target.value); setSearchOpen(true) }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchMatches[0]) { e.preventDefault(); jumpTo(searchMatches[0]) }
              if (e.key === 'Escape') { setQ(''); setSearchOpen(false) }
            }}
          />
          {searchOpen && q.trim() && (
            <div className="set-search-pop">
              {searchMatches.length === 0 ? (
                <div className="set-search-empty">{ar ? 'لا يوجد إعداد بهذا الاسم.' : 'No setting matches that.'}</div>
              ) : searchMatches.map((m) => (
                <button
                  key={m.tab + (m.aSec || '') + (m.at || '') + m.ar}
                  type="button"
                  className="set-search-item"
                  onMouseDown={(e) => { e.preventDefault(); jumpTo(m) }}
                >
                  <Icon name="search" size={12} className="faint" style={{ flex: 'none' }} />
                  <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ar ? m.ar : m.en}</span>
                  <span className="set-search-where">{(() => { const d = SECTIONS.find((s) => s.id === m.tab); return d ? (ar ? d.ar : d.en) : '' })()}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="grow" />

        {['studio', 'receipt'].includes(tab) && (
          /* wired to the single saved-change history (histRef); histVer re-renders the counts */
          <div className="row" style={{ gap: 6 }} data-histver={histVer}>
            <button type="button" className="btn btn-sm btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => applyHist('undo')} disabled={histRef.current.undo.length === 0}>
              <Icon name="undo" size={14} /> {ar ? 'تراجع' : 'Undo'} <span className="xs faint" style={{ opacity: 0.6 }}>Ctrl+Z</span>
            </button>
            <button type="button" className="btn btn-sm btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => applyHist('redo')} disabled={histRef.current.redo.length === 0}>
              <Icon name="undo" size={14} style={{ transform: 'scaleX(-1)' }} /> {ar ? 'إعادة' : 'Redo'} <span className="xs faint" style={{ opacity: 0.6 }}>Ctrl+Y</span>
            </button>
          </div>
        )}
      </div>

      <div className="set-shell">
        {/* persistent section index — a sticky rail on desktop, a sticky strip on phones */}
        <nav className="set-nav" aria-label={ar ? 'أقسام الإعدادات' : 'Settings sections'}>
          {TABS.map((tb) => (
            <button key={tb.id} type="button" className={`set-nav-item ${tab === tb.id ? 'active' : ''}`}
              aria-current={tab === tb.id ? 'page' : undefined} onClick={() => setTab(tb.id)}>
              <Icon name={tb.icon} size={15} className="set-nav-ico" />
              <span>{ar ? tb.ar : tb.en}</span>
            </button>
          ))}
        </nav>

        <div className="set-body">
          {secMeta && (
            <div className="set-head">
              <h3>{ar ? secMeta.ar : secMeta.en}</h3>
              <p>{ar ? secMeta.arSub : secMeta.enSub}</p>
            </div>
          )}

      {/* ============ VENUE SETUP CARDS (identity · experience · ops · system) ============ */}
      {SETUP_SECTIONS.includes(tab) && (
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          {tab === 'system' && <div id="set-install"><InstallButton /></div>}

          {tab === 'identity' && (
          <VenueTypeCard ar={ar} tenant={tenant} saveNow={saveNow} updateTenantLocal={updateTenantLocal} toast={toast} t={t} />
          )}

          {/* Profile Card */}
          {tab === 'identity' && (
          <div className="card card-pad stack" id="set-profile" style={{ gap: 'var(--sp-3)' }}>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <Icon name="store" size={18} style={{ color: 'var(--brand)' }} />
              <strong>{t('venueProfile')}</strong>
            </div>
            
            <div className="row" style={{ gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
              <label style={{ cursor: 'pointer', textAlign: 'center' }}>
                <div className="center" style={{ width: 86, height: 86, borderRadius: '50%', overflow: 'hidden', background: 'var(--surface-2)', border: '1px dashed var(--border-strong)' }}>
                  {uploading === 'logo' ? <div className="spinner" /> : logoUrl ? <img src={logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="store" size={26} className="muted" />}
                </div>
                <input type="file" accept="image/*" hidden onChange={(e) => onPick(e, 'logo')} />
                <span className="xs faint" style={{ display: 'block', marginTop: 4 }}>{ar ? 'الشعار' : 'Logo'}</span>
              </label>
              <label style={{ cursor: 'pointer', textAlign: 'center', flex: 1 }}>
                <div className="center" style={{ width: '100%', height: 86, borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--surface-2)', border: '1px dashed var(--border-strong)' }}>
                  {uploading === 'cover' ? <div className="spinner" /> : coverUrl ? <img src={coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="row muted" style={{ gap: 6 }}><Icon name="image" size={20} /> {ar ? 'صورة الغلاف' : 'Cover'}</span>}
                </div>
                <input type="file" accept="image/*" hidden onChange={(e) => onPick(e, 'cover')} />
                <span className="xs faint" style={{ display: 'block', marginTop: 4 }}>{ar ? 'غلاف المنيو' : 'Menu cover'}</span>
              </label>
            </div>
            
            <div className="field"><label>{t('venueName')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label>{t('description')} <span className="faint">({t('optional')})</span></label><textarea className="textarea" value={descAr} onChange={(e) => setDescAr(e.target.value)} placeholder={ar ? 'نبذة قصيرة تظهر في أعلى المنيو' : 'A short tagline shown on the menu'} /></div>
            <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              <div className="field grow" style={{ minWidth: 150 }}><label>{t('phone')} <span className="faint">({t('optional')})</span></label><input className="input num" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              <div className="field grow" style={{ minWidth: 150 }}><label>{t('currency')}</label><select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            </div>
            <div className="field"><label>{ar ? 'العنوان المطبوع' : 'Address'} <span className="faint">({t('optional')})</span></label><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
          </div>
          )}

          {/* Menu Link Card */}
          {tab === 'identity' && (
          <div className="card card-pad stack" id="set-link" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <Icon name="reports" size={18} style={{ color: 'var(--brand)' }} />
              <strong>{t('publicRBT360')}</strong>
            </div>
            <p className="xs faint">{ar ? 'الرابط العام الذي يمسحه العملاء لتصفح وطلب المنيو.' : 'The public link scanned by customers to browse and order.'}</p>
            <div className="input-group">
              <input className="input" dir="ltr" value={link} readOnly />
              <button className="btn btn-outline" onClick={copyLink}>{t('copyLink')}</button>
            </div>
            <a href={link} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ color: 'var(--brand)', alignSelf: 'flex-start', gap: 5 }}>{ar ? 'فتح المنيو العام' : 'Open public menu'} <Icon name="next" size={13} style={{ transform: 'rotate(-45deg)' }} /></a>
          </div>
          )}

          {/* GPS Geofencing Location Card — the venue pin every other range reuses */}
          {tab === 'ops' && (
          <div className="card card-pad stack" id="set-geo" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <Icon name="pin" size={18} style={{ color: 'var(--brand)' }} />
              <strong>{ar ? 'موقع المنشأة الجغرافي (للحضور والانصراف)' : 'Venue GPS Geolocation'}</strong>
            </div>
            <p className="xs faint">{ar ? 'يحدد النطاق المسموح للموظفين بتسجيل الحضور والانصراف من هواتفهم بداخل المقهى.' : 'Sets the geographical zone where staff are allowed to clock in/out.'}</p>
            <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm btn-outline grow" disabled={locating} onClick={() => {
                if (!navigator.geolocation) { toast.error(ar ? 'الموقع غير مدعوم' : 'Geolocation unsupported'); return }
                setLocating(true)
                navigator.geolocation.getCurrentPosition(
                  (p) => { setGeo({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocating(false); toast.success(ar ? 'تم تحديد الموقع' : 'Location set') },
                  () => { setLocating(false); toast.error(ar ? 'تعذّر تحديد الموقع' : 'Could not get location') },
                  { enableHighAccuracy: true, timeout: 8000 })
              }}><Icon name="pin" size={15} /> {locating ? t('saving') : (ar ? 'استخدم موقعي الحالي' : 'Use current location')}</button>
              <div className="field" style={{ width: 120 }}><label>{ar ? 'نطاق السماح (متر)' : 'Geofence Radius (m)'}</label><input className="input num" type="number" value={geofenceRadius} onChange={(e) => setGeofenceRadius(e.target.value)} /></div>
            </div>
            {geo && (
              <div className="row xs" style={{ gap: 10, color: 'var(--success)', background: 'var(--surface-2)', padding: '6px 12px', borderRadius: 8 }}>
                <span dir="ltr" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="pin" size={13} /> {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)} ({geofenceRadius}m)</span>
                <button type="button" className="btn-link" style={{ color: 'var(--danger)', marginInlineStart: 'auto' }} onClick={() => setGeo(null)}>{ar ? 'حذف الإحداثيات' : 'Clear'}</button>
              </div>
            )}
            {/* Same range, visually: click the map to place the venue, size the circle */}
            <details>
              <summary className="small bold" style={{ cursor: 'pointer', listStyle: 'none' }}><Icon name="pin" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'التحديد على الخريطة (الموقع + نطاق الحضور)' : 'Pick on map (location + radius)'}</summary>
              <Suspense fallback={<span className="xs faint">{ar ? 'تحميل الخريطة…' : 'Loading map…'}</span>}>
                <div style={{ marginTop: 8 }}>
                  <MapRangePicker mode="radius" unit="m" height={240}
                    center={geo} onCenter={(c) => { setGeo(c); updateTenantLocal({ geo: c }); commitPosBg({ geo: c }) }}
                    radius={Number(geofenceRadius) || 200} onRadius={(n) => setGeofenceRadius(n)} />
                </div>
              </Suspense>
            </details>
          </div>
          )}

          {/* System Preferences Card */}
          {tab === 'system' && (
          <div className="card card-pad stack" id="set-prefs" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <Icon name="settings" size={18} style={{ color: 'var(--brand)' }} />
              <strong>{ar ? 'تفضيلات التطبيق والنظام' : 'System Preferences'}</strong>
            </div>
            <div className="row-between">
              <span className="small">{t('theme')}</span>
              <div className="segmented">
                <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>{t('light')}</button>
                <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>{t('dark')}</button>
              </div>
            </div>
            <div className="row-between wrap" style={{ gap: 10 }}>
              <span className="small">{t('language')}</span>
              <div className="segmented">
                {langs.map((l) => <button key={l.id} className={lang === l.id ? 'active' : ''} onClick={() => setLang(l.id)}>{l.name}</button>)}
              </div>
            </div>
            <div className="row-between wrap" style={{ gap: 10 }}>
              <div>
                <span className="small">{ar ? 'الجولات الإرشادية' : 'Guided tours'}</span>
                <p className="xs faint" style={{ margin: 0 }}>{ar ? 'بطاقات الشرح التي تظهر تلقائياً أول مرة يفتح فيها الموظف كل قسم — الإيقاف يشمل كل الفريق.' : 'First-run walkthrough cards shown once per screen — turning off applies to the whole team.'}</p>
              </div>
              <input type="checkbox" checked={tenant?.toursEnabled !== false} style={{ width: 22, height: 22 }}
                onChange={async (e) => { try { await saveNow({ toursEnabled: e.target.checked }); updateTenantLocal({ toursEnabled: e.target.checked }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }} />
            </div>
            <div className="row-between wrap" style={{ gap: 10 }}>
              <span className="small">{ar ? 'أعد عرض كل الجولات على هذا الجهاز' : 'Replay all tours on this device'}</span>
              <button className="btn btn-outline btn-sm" onClick={() => {
                try {
                  const keys = []
                  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('rbt_tour_')) keys.push(k) }
                  keys.forEach((k) => localStorage.removeItem(k))
                  toast.success(ar ? 'ستظهر الجولات من جديد عند فتح كل صفحة' : 'Tours will replay on each page')
                } catch (_) { toast.error(t('error')) }
              }}>{ar ? 'إعادة العرض' : 'Replay'}</button>
            </div>
          </div>
          )}

          {/* Social profiles — icons under the menu name + on the rating screen.
              Only filled entries render; hide entirely via the studio's "hidden elements". */}
          {tab === 'identity' && (
          <div className="card card-pad stack" id="set-social" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <Icon name="heart" size={18} style={{ color: 'var(--brand)' }} />
              <strong>{ar ? 'وسائل التواصل الاجتماعي' : 'Social media'}</strong>
            </div>
            <p className="xs faint" style={{ margin: 0 }}>{ar ? 'تظهر كأيقونات تحت اسم المنشأة في المنيو وفي شاشة التقييم بعد الطلب — يُعرض المُدخل فقط. رابط خرائط جوجل يُستخدم أيضاً لدعوة الزبون للتقييم هناك بعد تقييمه.' : 'Shown as icons under the venue name and on the rating screen — only filled entries appear. The Google Maps link also invites guests to review there.'}</p>
            {[
              ['instagram', 'Instagram', ar ? 'اسم المستخدم أو الرابط' : '@handle or URL'],
              ['x', 'X (Twitter)', ar ? 'اسم المستخدم أو الرابط' : '@handle or URL'],
              ['tiktok', 'TikTok', ar ? 'اسم المستخدم أو الرابط' : '@handle or URL'],
              ['snapchat', 'Snapchat', ar ? 'اسم المستخدم أو الرابط' : '@handle or URL'],
              ['whatsapp', 'WhatsApp', ar ? 'رقم الجوال بصيغة دولية 9665…' : 'International number 9665…'],
              ['googleMaps', ar ? 'خرائط جوجل' : 'Google Maps', ar ? 'رابط صفحة المنشأة على الخرائط' : 'Your Maps place URL'],
              ['website', ar ? 'الموقع الإلكتروني' : 'Website', 'example.com'],
            ].map(([key, label, ph]) => (
              <div key={key} className="row" style={{ gap: 10, alignItems: 'center' }}>
                <span className="small" style={{ minWidth: 110 }}>{label}</span>
                <input className="input input-sm grow" dir="ltr" placeholder={ph}
                  defaultValue={tenant?.social?.[key] || ''}
                  onBlur={async (e) => {
                    const v = e.target.value.trim()
                    if ((tenant?.social?.[key] || '') === v) return
                    const next = { ...(tenant?.social || {}), [key]: v }
                    if (!v) delete next[key]
                    try { await saveNow({ social: next }); updateTenantLocal({ social: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                  }} />
              </div>
            ))}
          </div>
          )}

          {/* Waiting mini-game on the order-tracking page */}
          {tab === 'experience' && (
          <div className="card card-pad stack" id="set-waitgame" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <Icon name="play" size={18} style={{ color: 'var(--brand)' }} />
              <strong>{ar ? 'لعبة الانتظار «صياد البحر»' : 'Waiting game'}</strong>
            </div>
            <div className="row-between wrap" style={{ gap: 10 }}>
              <p className="xs faint" style={{ margin: 0, maxWidth: '46ch' }}>
                {ar ? 'أثناء تحضير الطلب تظهر للعميل دعوة للعب لعبة صيد ممتعة (45 ثانية، أفضل نتيجة تُحفظ على جهازه) — تجربة انتظار لا يملكها غيرك.' : 'While the kitchen works, guests can play a 45-second fishing game with a saved best score.'}
              </p>
              <input type="checkbox" checked={tenant?.waitGameEnabled !== false} style={{ width: 22, height: 22 }}
                onChange={async (e) => { try { await saveNow({ waitGameEnabled: e.target.checked }); updateTenantLocal({ waitGameEnabled: e.target.checked }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }} />
            </div>
          </div>
          )}

          {/* Interactive guest experience — the flagship features, each switchable
              per venue so a demo can be tuned to the client in seconds.
              (Guest-behaviour tracking used to sit in this list; it is a reporting
              feature, so it now lives in «العملاء والتسويق».) */}
          {tab === 'experience' && (
          <div className="card card-pad stack" id="set-interactive" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <Icon name="sparkles" size={18} style={{ color: 'var(--brand)' }} />
              <strong>{ar ? 'التجربة التفاعلية للعميل' : 'Interactive guest experience'}</strong>
            </div>
            <p className="xs faint" style={{ margin: 0 }}>{ar ? 'مزايا تفاعلية داخل المنيو وصفحة الطلب — فعّل ما يناسب منشأتك.' : 'Interactive features inside the menu and order page.'}</p>
            {[
              ['voiceWaiterEnabled', ar ? 'النادل الصوتي (اطلب بصوتك)' : 'Voice waiter', ar ? 'يتحدث العميل فيُضاف الصنف لسلته' : 'Speak to order'],
              ['photoOrderEnabled', ar ? 'اطلب بالصورة' : 'Order by photo', ar ? 'يصوّر طبقاً فيجد الذكاء أقرب صنف في منيوك' : 'Photo to nearest menu item'],
              ['voiceMenuEnabled', ar ? 'المنيو الصوتي (إتاحة للمكفوفين)' : 'Accessible voice menu', ar ? 'يقرأ المنيو صوتياً ويتنقل بالأوامر' : 'Reads the menu aloud'],
              ['menu3dEnabled', ar ? 'عالم المنيو ثلاثي الأبعاد' : '3D menu world', ar ? 'معرض يتنقل فيه العميل بين المجسمات' : 'Walk between 3D dishes'],
              ['compareEnabled', ar ? 'مقارنة الأصناف' : 'Compare items', ar ? 'يقارن العميل صنفين أو ثلاثة جنباً لجنب' : 'Side-by-side comparison'],
              ['sharedCartEnabled', ar ? 'الطلب الجماعي وتقسيم الفاتورة' : 'Shared table order', ar ? 'كل من على الطاولة يضيف من جواله لسلة واحدة' : 'One live basket per table'],
              ['kitchenTwinEnabled', ar ? 'توأم المطبخ (متابعة حية للأصناف)' : 'Kitchen twin', ar ? 'يرى العميل أصنافه تُنجز واحداً واحداً' : 'Live per-item progress'],
              ['leaderboardEnabled', ar ? 'لوحة صدارة اللعبة' : 'Game leaderboard', ar ? 'ترتيب شهري لأفضل اللاعبين' : 'Monthly top players'],
              ['gamesEnabled', ar ? 'مركز الألعاب' : 'Games centre', ar ? 'ألعاب داخل المنيو تُفتح بتسجيل الاسم والجوال — تعمل حتى بدون طلبات' : 'Games unlocked by name+phone; works without ordering'],
            ].map(([key, label, hint]) => (
              <div key={key} className="row-between wrap" style={{ gap: 10, paddingBlock: 4, borderTop: '1px solid var(--border)' }}>
                <div>
                  <div className="small bold">{label}</div>
                  <div className="xs faint">{hint}</div>
                </div>
                <input type="checkbox" checked={tenant?.[key] !== false} style={{ width: 22, height: 22 }}
                  onChange={async (e) => { try { await saveNow({ [key]: e.target.checked }); updateTenantLocal({ [key]: e.target.checked }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }} />
              </div>
            ))}
          </div>
          )}

          {/* Which games this venue shows — a café, a lounge, a sweets shop and
              a perfumery each want a different set, so the picker is filtered by
              venue-type tags and multi-select. */}
          {tab === 'experience' && tenant?.gamesEnabled !== false && (
            <div id="set-games"><GamePicker ar={ar} tenant={tenant} saveNow={saveNow} updateTenantLocal={updateTenantLocal} toast={toast} t={t} /></div>
          )}

          {/* Kitchen (KDS) operational tuning: late threshold + category→station names */}
          {tab === 'ops' && (
          <div className="card card-pad stack" id="set-kds" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <Icon name="kitchen" size={18} style={{ color: 'var(--brand)' }} />
              <strong>{ar ? 'شاشة المطبخ (KDS)' : 'Kitchen display (KDS)'}</strong>
            </div>
            <div className="row-between wrap" style={{ gap: 10, alignItems: 'center' }}>
              <div>
                <div className="small bold">{ar ? 'حد التأخير (دقائق)' : 'Late threshold (minutes)'}</div>
                <div className="xs faint">{ar ? 'تُعد التذكرة متأخرة بعده، والتنبيه الأصفر عند نصفه' : 'Ticket turns late after this; amber warning at half of it'}</div>
              </div>
              <input className="input num" style={{ width: 90 }} type="number" min="2" max="120" inputMode="numeric"
                value={kdsSla} onChange={(e) => setKdsSla(e.target.value)} onBlur={saveKdsSla} />
            </div>
            {kdsCats.length > 0 && (
              <>
                <div style={{ borderTop: '1px solid var(--border)' }} />
                <div className="small bold">{ar ? 'محطات التحضير (تصنيف ← محطة)' : 'Prep stations (category → station)'}</div>
                <p className="xs faint" style={{ margin: 0 }}>{ar ? 'اسم المحطة يظهر على كل سطر في تذكرة المطبخ وفي «حمل الأقسام» — اتركه فارغاً لاستخدام اسم التصنيف.' : 'Shown on every KDS ticket line and in station load — leave empty to use the category name.'}</p>
                {kdsCats.map((c) => (
                  <div key={c.id} className="row" style={{ gap: 10, alignItems: 'center' }}>
                    <span className="small" style={{ minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pickLang(c, 'name', lang)}</span>
                    <input className="input input-sm grow" placeholder={ar ? 'مثال: الشواية، البار، الحلويات…' : 'e.g. Grill, Bar…'}
                      defaultValue={tenant?.kdsStations?.[c.id] || ''} onBlur={(e) => saveKdsStation(c.id, e.target.value)} />
                  </div>
                ))}
              </>
            )}
          </div>
          )}

          {/* Staff PIN lock — shared-device tamper guard + per-order accountability */}
          {tab === 'system' && (
          <div className="card card-pad stack" id="set-pin" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <Icon name="key" size={18} style={{ color: 'var(--brand)' }} />
              <strong>{ar ? 'قفل النظام برمز PIN' : 'Staff PIN lock'}</strong>
            </div>
            <div className="row-between" style={{ alignItems: 'center' }}>
              <div>
                <div className="small bold">{ar ? 'تفعيل القفل' : 'Enable lock'}</div>
                <div className="xs faint">{ar ? 'يختار الموظف اسمه ويدخل 4 أرقام لفتح اللوحة والكاشير والمطبخ — واسمه يُسجل على كل طلب.' : 'Staff pick their name + 4-digit PIN; their name is stamped on every order.'}</div>
              </div>
              <input type="checkbox" checked={!!tenant?.pinLock?.enabled} style={{ width: 22, height: 22 }}
                onChange={async (e) => {
                  const next = { ...(tenant?.pinLock || {}), enabled: e.target.checked }
                  try { await saveNow({ pinLock: next }); updateTenantLocal({ pinLock: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                }} />
            </div>
            <div className="row-between wrap" style={{ gap: 8, alignItems: 'center' }}>
              <span className="small">{ar ? 'قفل تلقائي بعد خمول' : 'Auto-lock after idle'}</span>
              <div className="segmented">
                {[[0, ar ? 'بلا' : 'Off'], [2, '2د'], [5, '5د'], [15, '15د']].map(([m, lbl]) => (
                  <button key={m} className={(Number(tenant?.pinLock?.idleMin) || 0) === m ? 'active' : ''}
                    onClick={async () => {
                      const next = { ...(tenant?.pinLock || {}), idleMin: m }
                      try { await saveNow({ pinLock: next }); updateTenantLocal({ pinLock: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                    }}>{lbl}</button>
                ))}
              </div>
            </div>
            {staffList.length > 0 && (
              <>
                <div style={{ borderTop: '1px solid var(--border)' }} />
                <div className="small bold">{ar ? 'أرقام الموظفين (4 أرقام)' : 'Staff PINs (4 digits)'}</div>
                {staffList.filter((s) => s.active !== false).map((s) => (
                  <div key={s.uid || s.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <span className="small grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name || s.displayName || '—'} {s.pinHash ? <span className="badge badge-success" style={{ padding: '1px 5px' }}><Icon name="check" size={10} /></span> : null}</span>
                    <input className="input input-sm num" dir="ltr" type="password" inputMode="numeric" maxLength={4} placeholder="••••" style={{ width: 86, textAlign: 'center' }}
                      onBlur={async (e) => {
                        const v = e.target.value.replace(/[^0-9]/g, '')
                        e.target.value = ''
                        if (v.length !== 4) return
                        try { await setStaffPin(tenantId, s.uid || s.id, await hashPin(tenantId, v)); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                      }} />
                    {s.pinHash && <button className="icon-btn" style={{ width: 30, height: 30, color: 'var(--danger)' }} title={ar ? 'مسح الرمز' : 'Clear PIN'}
                      onClick={async () => { try { await setStaffPin(tenantId, s.uid || s.id, ''); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }}><Icon name="close" size={13} /></button>}
                  </div>
                ))}
                <p className="xs faint" style={{ margin: 0 }}>{ar ? 'قفل تشغيلي ضد العبث على جهاز مفتوح — الأمان الحقيقي يبقى بحساب الدخول. الرمز يُخزن مشفراً (هاش) ولا يمكن استرجاعه.' : 'An operational tamper guard — real security stays with the account. PINs are stored hashed.'}</p>
              </>
            )}
            <p className="xs faint" style={{ margin: 0 }}>{ar ? 'مظهر شاشة القفل نفسها (الثيم والخلفية وشكل الأزرار) في: المظهر والثيمات ← شاشة القفل.' : 'The lock screen’s own look lives in Look & themes → Lock screen.'}</p>
          </div>
          )}

          {/* Cashier display: prefer landscape on tablets */}
          {tab === 'ops' && (
          <div className="card card-pad stack" id="set-cashier">
            <label className="row-between" style={{ cursor: 'pointer' }}>
              <span className="small bold row" style={{ gap: 6 }}><Icon name="cashier" size={16} /> {ar ? 'تفضيل الوضع الأفقي للكاشير (تابلت)' : 'Prefer landscape for cashier (tablet)'}</span>
              <input type="checkbox" checked={tenant?.cashierLandscape === true} onChange={async (e) => { try { await saveNow({ cashierLandscape: e.target.checked }); updateTenantLocal({ cashierLandscape: e.target.checked }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }} style={{ width: 22, height: 22 }} />
            </label>
            <p className="xs faint" style={{ marginTop: 4 }}>{ar ? 'على التابلت العمودي يعرض الكاشير دعوة للدخول بملء الشاشة والوضع الأفقي (أندرويد/سامسونج) لعرض الكتالوج والفاتورة معاً — وعلى آيفون تلميح لتدوير الجهاز.' : 'On a portrait tablet, the cashier offers fullscreen + landscape lock (Android/Samsung) to show catalog + bill together; iOS shows a rotate hint.'}</p>
          </div>
          )}

          {/* Dine-in geofence: restrict table orders to the venue premises */}
          {tab === 'ops' && (
          <div className="card card-pad stack" id="set-dinein">
            <label className="row-between" style={{ cursor: 'pointer' }}>
              <span className="small bold row" style={{ gap: 6 }}><Icon name="pin" size={16} /> {ar ? 'تقييد طلبات الطاولات بنطاق المقهى' : 'Restrict table orders to the venue'}</span>
              <input type="checkbox" checked={tenant?.dineInGeofence?.enabled === true} onChange={async (e) => { const next = { ...(tenant?.dineInGeofence || {}), enabled: e.target.checked }; try { await saveNow({ dineInGeofence: next }); updateTenantLocal({ dineInGeofence: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }} style={{ width: 22, height: 22 }} />
            </label>
            {tenant?.dineInGeofence?.enabled && (
              <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="field" style={{ width: 150, marginBottom: 0 }}><label>{ar ? 'النطاق (متر)' : 'Radius (m)'}</label><input className="input num" type="number" min="20" value={tenant?.dineInGeofence?.radius ?? 150} onChange={(e) => { const next = { ...(tenant?.dineInGeofence || {}), radius: Number(e.target.value) || 150 }; updateTenantLocal({ dineInGeofence: next }); commitPosBg({ dineInGeofence: next }) }} /></div>
                {!tenant?.geo?.lat && <span className="xs" style={{ color: 'var(--danger)' }}>{ar ? 'حدّد موقع المقهى أولاً من بطاقة «الموقع الجغرافي» أعلاه.' : 'Set the venue location first (geo card above).'}</span>}
              </div>
            )}
            {tenant?.dineInGeofence?.enabled && (
              <details>
                <summary className="small bold" style={{ cursor: 'pointer', listStyle: 'none' }}><Icon name="pin" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'التحديد على الخريطة' : 'Pick on map'}</summary>
                <Suspense fallback={<span className="xs faint">{ar ? 'تحميل الخريطة…' : 'Loading map…'}</span>}>
                  <div style={{ marginTop: 8 }}>
                    <MapRangePicker mode="radius" unit="m" height={220}
                      center={tenant?.geo || null} onCenter={(c) => { updateTenantLocal({ geo: c }); commitPosBg({ geo: c }) }}
                      radius={Number(tenant?.dineInGeofence?.radius) || 150}
                      onRadius={(n) => { const next = { ...(tenant?.dineInGeofence || {}), radius: Number(n) || 150 }; updateTenantLocal({ dineInGeofence: next }); commitPosBg({ dineInGeofence: next }) }} />
                  </div>
                </Suspense>
              </details>
            )}
            <p className="xs faint" style={{ marginTop: 4 }}>{ar ? 'يطلب من العميل تأكيد وجوده داخل المقهى عند طلب الطاولة (يمنع الطلبات الوهمية عن بُعد). يستخدم موقع المقهى المحدّد أعلاه.' : 'Requires the guest to be within the venue when placing a table order (blocks remote/fake orders). Uses the venue location set above.'}</p>
          </div>
          )}
        </div>
      )}

      {/* ============ LOOK & THEMES — the design studio ============ */}
      {/* Themes/skins/backgrounds are a Pro+ feature (plan-gated). */}
      {tab === 'studio' && !planAllows(tenant, 'themes') && <UpgradeNotice feature="themes" />}
      {tab === 'studio' && planAllows(tenant, 'themes') && (
        <div className="appearance-grid">

          {/* live preview — sticky on desktop only (CSS); stacked on tablet/phone */}
          <div className="appearance-preview">
            <div className="card card-pad stack" style={{ gap: 10 }}>
              {aSec === 'pinlock' ? (
                <>
                  {/* lock-screen live preview — the REAL PinLock in demo mode */}
                  <div className="row-between wrap" style={{ gap: 8 }}>
                    <strong className="small"><Icon name="eye" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'معاينة شاشة القفل' : 'Lock screen preview'}</strong>
                    <div className="segmented">
                      <button className={pinDev === 'desktop' ? 'active' : ''} onClick={() => setPinDev('desktop')}>{ar ? 'كمبيوتر' : 'Desktop'}</button>
                      <button className={pinDev === 'tablet' ? 'active' : ''} onClick={() => setPinDev('tablet')}>{ar ? 'تابلت' : 'Tablet'}</button>
                      <button className={pinDev === 'mobile' ? 'active' : ''} onClick={() => setPinDev('mobile')}>{ar ? 'جوال' : 'Mobile'}</button>
                    </div>
                  </div>
                  <StaffPreview which="pinlock" mode={pinDev} />
                  <p className="xs faint" style={{ margin: 0 }}>{ar ? 'الشاشة الحقيقية نفسها — تتحدث تلقائياً بعد كل تعديل.' : 'The real screen — updates live after every change.'}</p>
                </>
              ) : aSec === 'staff' ? (
                <>
                  {/* the preview panel follows the active sub-tab: staff = live POS/KDS mock */}
                  <div className="row-between wrap" style={{ gap: 8 }}>
                    <strong className="small"><Icon name="eye" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'معاينة الكاشير والمطبخ' : 'Cashier & kitchen preview'}</strong>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <div className="segmented">
                        <button className={staffPrev === 'pos' ? 'active' : ''} onClick={() => setStaffPrev('pos')}>{ar ? 'الكاشير' : 'POS'}</button>
                        <button className={staffPrev === 'kds' ? 'active' : ''} onClick={() => setStaffPrev('kds')}>{ar ? 'المطبخ' : 'KDS'}</button>
                      </div>
                      <div className="segmented">
                        <button className={staffDev === 'desktop' ? 'active' : ''} onClick={() => setStaffDev('desktop')}>{ar ? 'كمبيوتر' : 'Desktop'}</button>
                        <button className={staffDev === 'tablet' ? 'active' : ''} onClick={() => setStaffDev('tablet')}>{ar ? 'تابلت' : 'Tablet'}</button>
                        <button className={staffDev === 'mobile' ? 'active' : ''} onClick={() => setStaffDev('mobile')}>{ar ? 'جوال' : 'Mobile'}</button>
                      </div>
                    </div>
                  </div>
                  <StaffPreview which={staffPrev} mode={staffDev} />
                  <p className="xs faint" style={{ margin: 0 }}>{ar ? 'هذه الشاشة الحقيقية نفسها (نفس آلية معاينة المنيو) — تتحدث تلقائياً بعد كل حفظ.' : 'The real screen itself (same mechanism as the menu preview) — refreshes live after every save.'}</p>
                </>
              ) : (
                <>
                  <div className="row-between">
                    <strong className="small"><Icon name="eye" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'معاينة منيو الزوار مباشرة' : 'Customer Menu Preview'}</strong>
                    <div className="segmented">
                      <button className={previewMode === 'mobile' ? 'active' : ''} onClick={() => setPreviewMode('mobile')}>{ar ? 'جوال' : 'Mobile'}</button>
                      <button className={previewMode === 'tablet' ? 'active' : ''} onClick={() => setPreviewMode('tablet')}>{ar ? 'تابلت' : 'Tablet'}</button>
                      <button className={previewMode === 'desktop' ? 'active' : ''} onClick={() => setPreviewMode('desktop')}>{ar ? 'كمبيوتر' : 'Desktop'}</button>
                    </div>
                  </div>
                  {tenant?.slug
                    ? <MenuPreview slug={tenant.slug} override={previewOverride} mode={previewMode} />
                    : <p className="xs faint center" style={{ padding: 'var(--sp-6)' }}>{ar ? 'احفظ بيانات المنشأة أولاً لعرض المعاينة' : 'Save the venue first to preview'}</p>}
                </>
              )}
            </div>
          </div>

          {/* Controls list — grouped into sub-tabs so the section stays tidy */}
          <div className="appearance-controls stack" style={{ gap: 'var(--sp-4)' }}>
            {planAllows(tenant, 'themes') ? (
              <>
                {/* one-line summary of the current design — every part jumps to its sub-section */}
                <div className="card" style={{ padding: '8px 12px', display: 'flex', flexWrap: 'wrap', gap: '4px 6px', alignItems: 'center', fontSize: 'var(--fs-xs)' }}>
                  <span className="faint bold" style={{ flex: 'none' }}>{ar ? 'تصميمك الحالي:' : 'Current design:'}</span>
                  {[
                    [ar ? `ثيم «${getSkin(skinId).name[lang] || getSkin(skinId).name.ar}»` : `“${getSkin(skinId).name.en}” theme`, 'theme'],
                    [(ar ? 'التخطيط: ' : 'Layout: ') + (ar ? (LAYOUT_LABELS[ovLayout] || ovLayout) : (LAYOUT_LABELS_EN[ovLayout] || ovLayout)), 'elements'],
                    [(ar ? 'البانر: ' : 'Banner: ') + (bannerVideoUrl ? (ar ? 'فيديو' : 'video') : bannerUrl ? (ar ? 'صورة' : 'image') : (ar ? 'بدون' : 'none')), 'media'],
                    [(ar ? 'الاندماج: ' : 'Melt: ') + ((FADE_LABELS[bannerFadeDir] || FADE_LABELS.bottom)[ar ? 0 : 1]), 'media'],
                  ].map(([lbl, sec], i) => (
                    <span key={sec + i} className="row" style={{ gap: 6, alignItems: 'center', flex: 'none' }}>
                      {i > 0 && <span className="faint">·</span>}
                      <button type="button" className="btn-link" style={{ fontSize: 'inherit', fontWeight: 700 }} onClick={() => setASec(sec)}>{lbl}</button>
                    </span>
                  ))}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {[['theme', 'sparkles', ar ? 'الثيم' : 'Theme'], ['elements', 'settings', ar ? 'المكونات والعناصر' : 'Elements'], ['colors', 'penLine', ar ? 'الألوان والنصوص' : 'Colors & text'], ['media', 'image', ar ? 'الخلفيات والوسائط' : 'Media'], ['details', 'eye', ar ? 'التفاصيل والتواصل' : 'Details & social'], ['staff', 'cashier', ar ? 'الكاشير والمطبخ' : 'Cashier & kitchen'], ['pinlock', 'key', ar ? 'شاشة القفل' : 'Lock screen']].map(([id, ic, lbl]) => (
                    <button key={id} className={`chip ${aSec === id ? 'active' : ''}`} style={{ flex: 'none' }} onClick={() => setASec(id)}><Icon name={ic} size={14} /> {lbl}</button>
                  ))}
                  {/* studio-wide undo/redo (also Ctrl+Z / Ctrl+Y) — histVer keeps counts fresh */}
                  <div className="row" style={{ gap: 4, marginInlineStart: 'auto', flex: 'none' }} data-histver={histVer}>
                    <button className="icon-btn" disabled={histRef.current.undo.length === 0} style={{ opacity: histRef.current.undo.length ? 1 : 0.35 }}
                      onClick={() => applyHist('undo')} title={ar ? 'تراجع (Ctrl+Z)' : 'Undo (Ctrl+Z)'} aria-label="undo"><Icon name="undo" size={16} /></button>
                    <button className="icon-btn" disabled={histRef.current.redo.length === 0} style={{ opacity: histRef.current.redo.length ? 1 : 0.35 }}
                      onClick={() => applyHist('redo')} title={ar ? 'إعادة (Ctrl+Y)' : 'Redo (Ctrl+Y)'} aria-label="redo"><Icon name="undo" size={16} style={{ transform: 'scaleX(-1)' }} /></button>
                  </div>
                </div>
                <div style={{ display: aSec === 'theme' ? 'contents' : 'none' }}>
                {/* SYSTEM THEME + Liquid intensity + per-section mix — moved here from General (Studio H1) */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <Icon name="sparkles" size={18} style={{ color: 'var(--brand)' }} />
                    <strong>{ar ? 'ثيم النظام الكامل' : 'System theme'}</strong>
                  </div>
                  <p className="small faint" style={{ margin: 0 }}>{ar ? 'هوية بصرية كاملة للوحة والكاشير والمطبخ — الألوان والزوايا والأزرار والبطاقات.' : 'A complete visual identity for the staff system.'}</p>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {SYSTEM_THEMES.map((th) => {
                      const active = (tenant?.systemTheme || 'glass') === th.id
                      return (
                        <button key={th.id} type="button" className={`systheme-swatch ${active ? 'active' : ''}`} title={ar ? th.hintAr : th.en}
                          onClick={async () => {
                            // global theme also clears per-section overrides — otherwise old mixes silently mask the new identity
                            try { await saveNow({ systemTheme: th.id, systemThemeBy: {} }); updateTenantLocal({ systemTheme: th.id, systemThemeBy: {} }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                          }}>
                          <span className="systheme-dots">
                            {th.swatch.map((c, i) => <span key={i} style={{ background: c }} />)}
                          </span>
                          <span className="small bold">{ar ? th.ar : th.en}</span>
                        </button>
                      )
                    })}
                    {tenant?.customTheme && (
                      <button type="button" className={`systheme-swatch ${tenant?.systemTheme === 'custom' ? 'active' : ''}`} title={ar ? 'ثيمك المخصص المحفوظ' : 'Your saved custom theme'}
                        onClick={async () => {
                          try { await saveNow({ systemTheme: 'custom', systemThemeBy: {} }); updateTenantLocal({ systemTheme: 'custom', systemThemeBy: {} }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                        }}>
                        <span className="systheme-dots">
                          {[tenant.customTheme.tokens?.bg, tenant.customTheme.tokens?.surface, tenant.customTheme.tokens?.brand].map((c, i) => <span key={i} style={{ background: c || 'var(--surface)' }} />)}
                        </span>
                        <span className="small bold">{tenant.customTheme.name || (ar ? 'مخصص' : 'Custom')}</span>
                      </button>
                    )}
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-sm" onClick={() => {
                      if (custEdit) { setCustEdit(null); return }
                      const cur = tenant?.customTheme
                      if (cur) { setCustEdit({ base: cur.base, name: cur.name || '', tokens: { ...cur.tokens } }); return }
                      // seed the draft from the current theme's palette so the first open is never blank
                      const baseId = tenant?.systemTheme && tenant.systemTheme !== 'custom' && SYSTEM_THEMES.some((x) => x.id === tenant.systemTheme) ? tenant.systemTheme : 'glass'
                      const th = SYSTEM_THEMES.find((x) => x.id === baseId)
                      const dark = baseId === 'noir' || baseId === 'glassdark'
                      let brand = '#7c2d2d'
                      try { const v = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(); if (/^#[0-9a-fA-F]{6}$/.test(v)) brand = v } catch (_) { /* keep fallback */ }
                      setCustEdit({ base: baseId, name: '', tokens: { bg: th.swatch[0], surface: th.swatch[1], text: dark ? '#f2f3f7' : '#17181c', border: dark ? '#3a3f4d' : '#e5e7eb', brand } })
                    }}>
                      <Icon name="penLine" size={14} /> {custEdit ? (ar ? 'إغلاق المحرر' : 'Close editor') : tenant?.customTheme ? (ar ? 'تعديل ثيمك المخصص' : 'Edit custom theme') : (ar ? 'صمم ثيمك الخاص' : 'Design your own theme')}
                    </button>
                    {tenant?.customTheme && (
                      <button type="button" className="btn btn-sm btn-danger" onClick={async () => {
                        const fallback = tenant?.systemTheme === 'custom' ? (tenant?.customTheme?.base || 'glass') : (tenant?.systemTheme || 'glass')
                        try { await saveNow({ customTheme: null, systemTheme: fallback }); updateTenantLocal({ customTheme: null, systemTheme: fallback }); setCustEdit(null); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                      }}><Icon name="delete" size={14} /> {ar ? 'حذف المخصص' : 'Delete custom'}</button>
                    )}
                  </div>
                  {custEdit && (() => {
                    const setTok = (k, v) => {
                      const next = { ...custEdit, tokens: { ...custEdit.tokens, [k]: v } }
                      setCustEdit(next)
                      // live paint when the custom theme is already the active one
                      if (tenant?.systemTheme === 'custom' && tenant?.customTheme) {
                        const ct = { ...tenant.customTheme, base: next.base, tokens: next.tokens }
                        updateTenantLocal({ customTheme: ct }); commitPosBg({ customTheme: ct })
                      }
                    }
                    return (
                      <div className="stack" style={{ gap: 10, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 12 }}>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>{ar ? 'اسم الثيم' : 'Theme name'}</label>
                          <input className="input" value={custEdit.name} placeholder={ar ? 'ثيمي الخاص' : 'My theme'} onChange={(e) => setCustEdit({ ...custEdit, name: e.target.value })} />
                        </div>
                        <div className="stack" style={{ gap: 6 }}>
                          <span className="small bold">{ar ? 'الأساس (يرث سلوكه وحركته)' : 'Base (inherits its behavior)'}</span>
                          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                            {SYSTEM_THEMES.map((th) => (
                              <button key={th.id} type="button" className={`chip ${custEdit.base === th.id ? 'active' : ''}`} onClick={() => setCustEdit({ ...custEdit, base: th.id })}>{ar ? th.ar : th.en}</button>
                            ))}
                          </div>
                        </div>
                        <div className="row wrap" style={{ gap: 12 }}>
                          {[['bg', ar ? 'الخلفية' : 'Background'], ['surface', ar ? 'الأسطح والبطاقات' : 'Surfaces'], ['text', ar ? 'النصوص' : 'Text'], ['border', ar ? 'الحدود' : 'Borders'], ['brand', ar ? 'لون الهوية' : 'Brand']].map(([k, lbl]) => (
                            <label key={k} className="stack center" style={{ gap: 4, cursor: 'pointer' }}>
                              <input type="color" value={custEdit.tokens[k]} onChange={(e) => setTok(k, e.target.value)} style={{ width: 44, height: 34, border: 'none', background: 'none', cursor: 'pointer' }} />
                              <span className="xs">{lbl}</span>
                            </label>
                          ))}
                        </div>
                        <p className="xs faint" style={{ margin: 0 }}>{ar ? 'تلميح: احرص على تباين واضح بين النصوص والخلفية — الحفظ يفعّل الثيم فوراً على كل النظام.' : 'Keep text/background contrast high — saving activates the theme system-wide.'}</p>
                        <div className="row" style={{ gap: 8 }}>
                          <button type="button" className="btn btn-primary btn-sm" onClick={async () => {
                            const payload = { customTheme: { base: custEdit.base, name: (custEdit.name || '').trim() || (ar ? 'ثيمي الخاص' : 'My theme'), tokens: custEdit.tokens }, systemTheme: 'custom', systemThemeBy: {} }
                            try { await saveNow(payload); updateTenantLocal(payload); setCustEdit(null); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                          }}>{ar ? 'حفظ وتفعيل' : 'Save & apply'}</button>
                          <button type="button" className="btn btn-sm" onClick={() => setCustEdit(null)}>{t('cancel') || (ar ? 'إلغاء' : 'Cancel')}</button>
                        </div>
                      </div>
                    )
                  })()}
                  <div style={{ borderTop: '1px solid var(--border)' }} />
                  <div className="small bold">{ar ? 'قوة الزجاج (Liquid)' : 'Glass intensity (Liquid)'}</div>
                  <div className="row-between wrap" style={{ gap: 8, alignItems: 'center' }}>
                    <span className="small">{ar ? 'التموج (انكسار حقيقي خلف الزجاج)' : 'Refraction (true ripple)'}</span>
                    <div className="segmented">
                      {[[0, ar ? 'بلا' : 'Off'], [1, ar ? 'خفيف' : 'Soft'], [2, ar ? 'متوسط' : 'Med'], [3, ar ? 'قوي' : 'Strong']].map(([lv, lbl]) => (
                        <button key={lv} className={(Number(tenant?.glassFx?.ripple) || 0) === lv ? 'active' : ''}
                          onClick={async () => {
                            const next = { ...(tenant?.glassFx || {}), ripple: lv }
                            try { await saveNow({ glassFx: next }); updateTenantLocal({ glassFx: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                          }}>{lbl}</button>
                      ))}
                    </div>
                  </div>
                  {[
                    ['alpha', ar ? 'الشفافية (دقة كاملة)' : 'Opacity (precise)', 0.08, 0.9, 0.01, tenant?.glassFx?.alpha ?? 0.62, (v) => `${Math.round(v * 100)}%`],
                    ['blur', ar ? 'اللزوجة (الضبابية)' : 'Frost (blur)', 4, 48, 1, tenant?.glassFx?.blur ?? 24, (v) => `${v}px`],
                    ['sat', ar ? 'حيوية الألوان' : 'Vibrancy', 1, 2.4, 0.05, tenant?.glassFx?.sat ?? 1.8, (v) => `${Math.round(v * 100)}%`],
                  ].map(([key, label, min, max, step, val, fmt]) => (
                    <div key={key} className="field" style={{ marginBottom: 0 }}>
                      <label>{label}: <span className="num">{fmt(val)}</span></label>
                      <input type="range" min={min} max={max} step={step} value={val} style={{ width: '100%' }}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          const next = { ...(tenant?.glassFx || {}), [key]: v }
                          updateTenantLocal({ glassFx: next })
                          commitPosBg({ glassFx: next })
                        }} />
                    </div>
                  ))}
                  <div className="row-between wrap" style={{ gap: 10, alignItems: 'center' }}>
                    <div>
                      <div className="small bold">{ar ? 'خط النظام' : 'System font'}</div>
                      <div className="xs faint">{ar ? 'يطبق على الإدارة والكاشير والمطبخ كاملة — خط المنيو مستقل في تبويب الألوان والنصوص.' : 'Applies to the whole back-office; the menu font is separate.'}</div>
                    </div>
                    <select className="select" style={{ maxWidth: 180 }} value={tenant?.systemFont || 'tajawal'}
                      onChange={async (e) => {
                        try { await saveNow({ systemFont: e.target.value }); updateTenantLocal({ systemFont: e.target.value }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                      }}>
                      {FONT_OPTIONS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)' }} />
                  <div className="row-between wrap" style={{ gap: 10, alignItems: 'center' }}>
                    <div>
                      <div className="small bold">{ar ? 'شكل القائمة الجانبية' : 'Sidebar style'}</div>
                      <div className="xs faint">{ar ? 'كلاسيكية ملتصقة، أو عائمة كجزيرة زجاجية، أو شفافة مندمجة مع الخلفية.' : 'Docked, floating island, or transparent minimal.'}</div>
                    </div>
                    <div className="segmented">
                      {[['', ar ? 'كلاسيكي' : 'Classic'], ['floating', ar ? 'عائمة' : 'Floating'], ['minimal', ar ? 'شفافة' : 'Minimal']].map(([v, lbl]) => (
                        <button key={v || 'dock'} className={(tenant?.sidebarStyle || '') === v ? 'active' : ''} onClick={async () => {
                          try { await saveNow({ sidebarStyle: v }); updateTenantLocal({ sidebarStyle: v }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                        }}>{lbl}</button>
                      ))}
                    </div>
                  </div>

                  {/* independent sidebar THEME — layers over ANY system theme (mix & match) */}
                  <div className="row-between wrap" style={{ gap: 10, alignItems: 'center' }}>
                    <div>
                      <div className="small bold">{ar ? 'سمة القائمة الجانبية (مستقلة)' : 'Sidebar theme (independent)'}</div>
                      <div className="xs faint">{ar ? 'شكل روابط وأزرار القائمة وتفاعلها — تُركَّب فوق أي ثيم نظام تختاره. الشعار ثابت أعلى وتسجيل الخروج ثابت أسفل دائماً.' : 'Nav links look & interaction — layered over any system theme.'}</div>
                    </div>
                    <select className="select" style={{ maxWidth: 190 }} value={tenant?.sidebarTheme || ''}
                      onChange={async (e) => {
                        const v = e.target.value
                        try { await saveNow({ sidebarTheme: v }); updateTenantLocal({ sidebarTheme: v }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                      }}>
                      <option value="">{ar ? 'حسب ثيم النظام' : 'Follow system theme'}</option>
                      <option value="pills">{ar ? 'حبوب عائمة' : 'Pills'}</option>
                      <option value="blocks">{ar ? 'كتل مصمتة' : 'Blocks'}</option>
                      <option value="line">{ar ? 'خط مؤشر بسيط' : 'Indicator line'}</option>
                      <option value="glassy">{ar ? 'زجاجية شفافة' : 'Glassy'}</option>
                      <option value="golden">{ar ? 'ذهبية ملكية' : 'Golden'}</option>
                    </select>
                  </div>

                  {/* AR — global switch + the AR stage's OWN theme */}
                  <div className="row-between wrap" style={{ gap: 10, alignItems: 'center' }}>
                    <div>
                      <div className="small bold">{ar ? 'الواقع المعزز AR في المنيو' : 'Menu AR'}</div>
                      <div className="xs faint">{ar ? 'زر «اعرضه على طاولتك» للأصناف التي لها مجسم (من محرر الصنف). لواجهة العرض ثيمها الخاص المستقل.' : 'Table AR for items with a 3D model/standee; the AR stage has its own theme.'}</div>
                    </div>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <select className="select" style={{ maxWidth: 130 }} value={tenant?.ar?.style || 'noir'}
                        onChange={async (e) => { const next = { ...(tenant?.ar || {}), style: e.target.value }; try { await saveNow({ ar: next }); updateTenantLocal({ ar: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }}>
                        <option value="noir">{ar ? 'ليلي فاخر' : 'Noir'}</option>
                        <option value="brand">{ar ? 'بلون هويتي' : 'Brand'}</option>
                        <option value="light">{ar ? 'فاتح' : 'Light'}</option>
                      </select>
                      <input type="checkbox" checked={tenant?.ar?.enabled !== false} style={{ width: 22, height: 22 }}
                        onChange={async (e) => { const next = { ...(tenant?.ar || {}), enabled: e.target.checked }; try { await saveNow({ ar: next }); updateTenantLocal({ ar: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }} />
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)' }} />
                  <div className="row-between wrap" style={{ gap: 10, alignItems: 'center' }}>
                    <div>
                      <div className="small bold">{ar ? 'جدولة الثيم (نهاري / ليلي)' : 'Theme schedule (day / night)'}</div>
                      <div className="xs faint">{ar ? 'يتبدل الثيم تلقائياً بحسب الساعة — مثلاً زجاجي نهاراً ونوار في المناوبة الليلية.' : 'Switches automatically by the clock.'}</div>
                    </div>
                    <input type="checkbox" checked={!!tenant?.themeSchedule?.enabled} style={{ width: 22, height: 22 }}
                      onChange={async (e) => {
                        const next = { dayTheme: 'glass', nightTheme: 'noir', dayStart: '07:00', nightStart: '19:00', ...(tenant?.themeSchedule || {}), enabled: e.target.checked }
                        try { await saveNow({ themeSchedule: next }); updateTenantLocal({ themeSchedule: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                      }} />
                  </div>
                  {tenant?.themeSchedule?.enabled && (() => {
                    const sc = tenant.themeSchedule
                    const saveSched = (patch) => { const next = { ...sc, ...patch }; updateTenantLocal({ themeSchedule: next }); commitPosBg({ themeSchedule: next }) }
                    return (
                      <div className="stack" style={{ gap: 8 }}>
                        {[['dayTheme', 'dayStart', ar ? 'النهار' : 'Day'], ['nightTheme', 'nightStart', ar ? 'الليل' : 'Night']].map(([themeKey, timeKey, lbl]) => (
                          <div key={themeKey} className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                            <span className="small bold" style={{ minWidth: 52 }}>{lbl}</span>
                            <select className="select" style={{ maxWidth: 170 }} value={sc[themeKey] || (themeKey === 'dayTheme' ? 'glass' : 'noir')}
                              onChange={(e) => saveSched({ [themeKey]: e.target.value })}>
                              {SYSTEM_THEMES.map((th) => <option key={th.id} value={th.id}>{ar ? th.ar : th.en}</option>)}
                            </select>
                            <span className="xs faint">{ar ? 'يبدأ' : 'from'}</span>
                            <input className="input num" type="time" style={{ maxWidth: 130 }} value={sc[timeKey] || (timeKey === 'dayStart' ? '07:00' : '19:00')}
                              onChange={(e) => saveSched({ [timeKey]: e.target.value })} />
                          </div>
                        ))}
                        <p className="xs faint" style={{ margin: 0 }}>{ar ? 'المزج اليدوي لقسم معيّن يتقدم على الجدولة؛ والجدولة تتقدم على الثيم العام.' : 'Per-section overrides beat the schedule; the schedule beats the global theme.'}</p>
                      </div>
                    )
                  })()}
                  <div style={{ borderTop: '1px solid var(--border)' }} />
                  <div className="row-between wrap" style={{ alignItems: 'center', gap: 8 }}>
                    <div>
                      <div className="small bold">{ar ? 'زجاج المنيو (فوق أي ثيم)' : 'Menu glass (over any theme)'}</div>
                      <div className="xs faint">{ar ? '«الأشرطة»: الهيدر والبحث والتنقل فقط. «كامل»: البطاقات والأزرار والأيقونات والنوافذ (السلة والإشعارات وتفاصيل الصنف).' : 'Chrome = bars only. Full = cards, buttons, icons and the cart/notification sheets.'}</div>
                    </div>
                    <div className="segmented">
                      {[[false, ar ? 'بلا' : 'Off'], ['chrome', ar ? 'الأشرطة' : 'Chrome'], ['full', ar ? 'كامل المنيو' : 'Full']].map(([v, lbl]) => {
                        const cur = tenant?.menuGlass === 'full' ? 'full' : tenant?.menuGlass ? 'chrome' : false
                        return (
                          <button key={String(v)} className={cur === v ? 'active' : ''} onClick={async () => {
                            try { await saveNow({ menuGlass: v }); updateTenantLocal({ menuGlass: v }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                          }}>{lbl}</button>
                        )
                      })}
                    </div>
                  </div>
                  {!!tenant?.menuGlass && (
                    <div className="stack" style={{ gap: 8 }}>
                      <span className="xs faint">{ar ? 'قوة زجاج المنيو (مستقلة عن النظام):' : 'Menu glass intensity (independent):'}</span>
                      {(() => {
                        const cur = { ...(tenant?.glassFx || {}), ...(tenant?.glassFxBy?.menu || {}) }
                        const saveMenuFx = (patch) => {
                          const next = { ...(tenant?.glassFxBy || {}), menu: { ...(tenant?.glassFxBy?.menu || {}), ...patch } }
                          updateTenantLocal({ glassFxBy: next }); commitPosBg({ glassFxBy: next })
                        }
                        return [
                          ['alpha', ar ? 'الشفافية' : 'Opacity', 0.08, 0.9, 0.01, cur.alpha ?? 0.62, (v) => `${Math.round(v * 100)}%`],
                          ['blur', ar ? 'اللزوجة' : 'Frost', 4, 48, 1, cur.blur ?? 24, (v) => `${v}px`],
                          ['sat', ar ? 'الحيوية' : 'Vibrancy', 1, 2.4, 0.05, cur.sat ?? 1.8, (v) => `${Math.round(v * 100)}%`],
                        ].map(([key, label, min, max, step, val, fmt]) => (
                          <div key={key} className="field" style={{ marginBottom: 0 }}>
                            <label>{label}: <span className="num">{fmt(val)}</span></label>
                            <input type="range" min={min} max={max} step={step} value={val} style={{ width: '100%' }}
                              onChange={(e) => saveMenuFx({ [key]: Number(e.target.value) })} />
                          </div>
                        ))
                      })()}
                    </div>
                  )}
                  <div style={{ borderTop: '1px solid var(--border)' }} />
                  <div className="small bold">{ar ? 'مزج لكل قسم (اختياري)' : 'Per-section mix (optional)'}</div>
                  {THEMEABLE_SECTIONS.filter((s) => s.id === 'admin').map((sec) => (
                    <div key={sec.id} className="row-between wrap" style={{ gap: 8, alignItems: 'center' }}>
                      <span className="small" style={{ flex: 'none' }}>{ar ? sec.ar : sec.en}</span>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" className={`chip ${!tenant?.systemThemeBy?.[sec.id] ? 'active' : ''}`}
                          onClick={async () => {
                            const next = { ...(tenant?.systemThemeBy || {}) }
                            delete next[sec.id]
                            try { await saveNow({ systemThemeBy: next }); updateTenantLocal({ systemThemeBy: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                          }}>{ar ? 'يتبع العام' : 'Follow global'}</button>
                        {SYSTEM_THEMES.map((th) => (
                          <button key={th.id} type="button" className={`chip ${tenant?.systemThemeBy?.[sec.id] === th.id ? 'active' : ''}`}
                            onClick={async () => {
                              const next = { ...(tenant?.systemThemeBy || {}), [sec.id]: th.id }
                              try { await saveNow({ systemThemeBy: next }); updateTenantLocal({ systemThemeBy: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                            }}>{ar ? th.ar : th.en}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* BUTTON DESIGNER + SELECTION COLOR — venue-tunable across the
                    WHOLE platform (admin/cashier/kitchen/diner CTAs) via --sel
                    and data-btnfx vars carried on body + the menu portal root */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <Icon name="penLine" size={18} style={{ color: 'var(--brand)' }} />
                    <strong>{ar ? 'مصمم الأزرار ولون التحديد' : 'Button designer & selection color'}</strong>
                  </div>
                  <div className="row-between wrap" style={{ gap: 10, alignItems: 'center' }}>
                    <div>
                      <div className="small bold">{ar ? 'لون التحديد والتفعيل' : 'Selection color'}</div>
                      <div className="xs faint">{ar ? 'لون العنصر النشط في القوائم والرقاقات والتبويبات — في كل النظام.' : 'Active pills, chips and tabs across the system.'}</div>
                    </div>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      {tenant?.selColor && (
                        <button type="button" className="chip" onClick={async () => {
                          try { await saveNow({ selColor: '' }); updateTenantLocal({ selColor: '' }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                        }}>{ar ? 'يتبع الهوية' : 'Follow brand'}</button>
                      )}
                      <input type="color" value={tenant?.selColor || (tenant?.themeColor || '#7c2d2d')} style={{ width: 44, height: 34, border: 'none', background: 'none', cursor: 'pointer' }}
                        onChange={(e) => { updateTenantLocal({ selColor: e.target.value }); commitPosBg({ selColor: e.target.value }) }} />
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)' }} />
                  <div className="row-between wrap" style={{ gap: 10, alignItems: 'center' }}>
                    <div>
                      <div className="small bold">{ar ? 'نمط الأزرار الرئيسية (كل المنصة)' : 'Primary button style (platform-wide)'}</div>
                      <div className="xs faint">{ar ? 'متدرج بتوهج قابل للضبط — يشمل أزرار النظام وأزرار المنيو (أضف للسلة وغيرها).' : 'Gradient with tunable glow — system + diner menu CTAs.'}</div>
                    </div>
                    <div className="segmented">
                      {[['', ar ? 'افتراضي' : 'Default'], ['gradient', ar ? 'متدرج متوهج' : 'Gradient glow'], ['ghost', ar ? 'شفاف' : 'Ghost']].map(([v, lbl]) => (
                        <button key={v || 'off'} className={(tenant?.btnFx?.kind || '') === v ? 'active' : ''} onClick={async () => {
                          const next = v ? { ...(tenant?.btnFx || {}), kind: v, c1: tenant?.btnFx?.c1 || tenant?.themeColor || '#c2410c', c2: tenant?.btnFx?.c2 || tenant?.themeAccent || '#7c2d2d', angle: tenant?.btnFx?.angle ?? 135, glow: tenant?.btnFx?.glow ?? 0.45, glowColor: tenant?.btnFx?.glowColor || '', radius: tenant?.btnFx?.radius ?? 0 } : null
                          try { await saveNow({ btnFx: next }); updateTenantLocal({ btnFx: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                        }}>{lbl}</button>
                      ))}
                    </div>
                  </div>
                  {!!tenant?.btnFx?.kind && (() => {
                    const b = tenant.btnFx
                    const saveBtn = (patch) => { const next = { ...b, ...patch }; updateTenantLocal({ btnFx: next }); commitPosBg({ btnFx: next }) }
                    return (
                      <div className="stack" style={{ gap: 10 }}>
                        <label className="row-between" style={{ cursor: 'pointer' }}>
                          <span className="small">{ar ? 'تطبيق على كل الأزرار (حتى الثانوية)' : 'Apply to ALL buttons (secondary too)'}</span>
                          <input type="checkbox" checked={!!b.all} style={{ width: 20, height: 20 }} onChange={(e) => saveBtn({ all: e.target.checked })} />
                        </label>
                        {b.kind === 'ghost' && (
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label>{ar ? `استدارة الحواف: ${b.radius > 0 ? `${b.radius}px` : 'حبة كاملة'}` : `Radius: ${b.radius > 0 ? `${b.radius}px` : 'pill'}`}</label>
                            <input type="range" min="0" max="34" step="1" value={b.radius ?? 0} style={{ width: '100%' }} onChange={(e) => saveBtn({ radius: Number(e.target.value) })} />
                          </div>
                        )}
                        {b.kind === 'ghost' && (
                          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span className="xs faint">{ar ? 'معاينة حية:' : 'Live sample:'}</span>
                            <button type="button" className="btn btn-primary">{ar ? 'زر رئيسي' : 'Primary'}</button>
                            <button type="button" className="btn btn-primary btn-sm">{ar ? 'صغير' : 'Small'}</button>
                          </div>
                        )}
                        {b.kind === 'gradient' && (
                          <>
                            <div className="row wrap" style={{ gap: 14, alignItems: 'center' }}>
                              <label className="stack center" style={{ gap: 4 }}>
                                <input type="color" value={b.c1 || '#c2410c'} onChange={(e) => saveBtn({ c1: e.target.value })} style={{ width: 44, height: 34, border: 'none', background: 'none', cursor: 'pointer' }} />
                                <span className="xs">{ar ? 'اللون الأول' : 'Color 1'}</span>
                              </label>
                              <label className="stack center" style={{ gap: 4 }}>
                                <input type="color" value={b.c2 || '#7c2d2d'} onChange={(e) => saveBtn({ c2: e.target.value })} style={{ width: 44, height: 34, border: 'none', background: 'none', cursor: 'pointer' }} />
                                <span className="xs">{ar ? 'اللون الثاني' : 'Color 2'}</span>
                              </label>
                              <label className="stack center" style={{ gap: 4 }}>
                                <input type="color" value={b.glowColor || b.c1 || '#c2410c'} onChange={(e) => saveBtn({ glowColor: e.target.value })} style={{ width: 44, height: 34, border: 'none', background: 'none', cursor: 'pointer' }} />
                                <span className="xs">{ar ? 'لون التوهج' : 'Glow color'}</span>
                              </label>
                            </div>
                            {[
                              ['angle', ar ? 'زاوية التدرج' : 'Angle', 0, 360, 5, b.angle ?? 135, (v) => `${v}°`],
                              ['glow', ar ? 'قوة التوهج' : 'Glow', 0, 1, 0.05, b.glow ?? 0.45, (v) => `${Math.round(v * 100)}%`],
                              ['radius', ar ? 'استدارة الحواف (0 = حبة كاملة)' : 'Corner radius (0 = pill)', 0, 34, 1, b.radius ?? 0, (v) => (v > 0 ? `${v}px` : (ar ? 'حبة' : 'pill'))],
                            ].map(([key, label, min, max, step, val, fmt]) => (
                              <div key={key} className="field" style={{ marginBottom: 0 }}>
                                <label>{label}: <span className="num">{fmt(val)}</span></label>
                                <input type="range" min={min} max={max} step={step} value={val} style={{ width: '100%' }} onChange={(e) => saveBtn({ [key]: Number(e.target.value) })} />
                              </div>
                            ))}
                            <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                              <span className="xs faint">{ar ? 'معاينة حية:' : 'Live sample:'}</span>
                              <button type="button" className="btn btn-primary">{ar ? 'زر رئيسي' : 'Primary'}</button>
                              <button type="button" className="btn btn-primary btn-sm">{ar ? 'صغير' : 'Small'}</button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })()}
                </div>

                {/* SYSTEM BACKGROUND — gradient / image / video behind the whole staff app.
                    This is what makes light-mode Liquid Glass pop like the references. */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <Icon name="image" size={18} style={{ color: 'var(--brand)' }} />
                    <strong>{ar ? 'خلفية النظام الكاملة' : 'System background'}</strong>
                  </div>
                  <p className="xs faint" style={{ margin: 0 }}>{ar ? 'تظهر خلف كل شاشات النظام (اللوحة والكاشير والمطبخ) — الزجاج ينكسر فوقها. طبقة تعتيم تلقائية تحفظ وضوح النصوص.' : 'Behind every staff screen — the glass refracts over it. An automatic veil keeps text readable.'}</p>
                  <div className="segmented">
                    {[['mesh', ar ? 'افتراضي' : 'Default'], ['gradient', ar ? 'تدرج' : 'Gradient'], ['image', ar ? 'صورة' : 'Image'], ['video', ar ? 'فيديو' : 'Video']].map(([k, lbl]) => (
                      <button key={k} className={(tenant?.appBg?.kind || 'mesh') === k ? 'active' : ''}
                        onClick={async () => {
                          const next = { ...(tenant?.appBg || {}), kind: k }
                          try { await saveNow({ appBg: next }); updateTenantLocal({ appBg: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                        }}>{lbl}</button>
                    ))}
                  </div>
                  {tenant?.appBg?.kind === 'gradient' && (
                    <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="small">{ar ? 'من' : 'From'}</span>
                      <input type="color" value={tenant?.appBg?.from || '#eef1f7'} style={{ width: 42, height: 32, border: 'none', background: 'none', cursor: 'pointer' }}
                        onChange={(e) => { const next = { ...(tenant?.appBg || {}), from: e.target.value }; updateTenantLocal({ appBg: next }); commitPosBg({ appBg: next }) }} />
                      <span className="small">{ar ? 'إلى' : 'To'}</span>
                      <input type="color" value={tenant?.appBg?.to || '#dfe6f0'} style={{ width: 42, height: 32, border: 'none', background: 'none', cursor: 'pointer' }}
                        onChange={(e) => { const next = { ...(tenant?.appBg || {}), to: e.target.value }; updateTenantLocal({ appBg: next }); commitPosBg({ appBg: next }) }} />
                      <span className="small">{ar ? 'الزاوية' : 'Angle'}</span>
                      <input type="range" min="0" max="360" step="5" value={tenant?.appBg?.angle ?? 160} style={{ flex: 1, minWidth: 120 }}
                        onChange={(e) => { const next = { ...(tenant?.appBg || {}), angle: Number(e.target.value) }; updateTenantLocal({ appBg: next }); commitPosBg({ appBg: next }) }} />
                    </div>
                  )}
                  {(tenant?.appBg?.kind === 'image' || tenant?.appBg?.kind === 'video') && (
                    <>
                      {tenant?.appBg?.url && (
                        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                          {tenant.appBg.kind === 'video'
                            ? <video src={tenant.appBg.url} muted style={{ width: 84, height: 52, objectFit: 'cover', borderRadius: 8 }} />
                            : <img src={tenant.appBg.url} alt="" style={{ width: 84, height: 52, objectFit: 'cover', borderRadius: 8 }} />}
                          <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)' }}
                            onClick={async () => { const next = { ...(tenant?.appBg || {}), url: '' }; try { await saveNow({ appBg: next }); updateTenantLocal({ appBg: next }) } catch (_) { toast.error(t('error')) } }}>{ar ? 'إزالة' : 'Remove'}</button>
                        </div>
                      )}
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <label className="btn btn-outline" style={{ cursor: 'pointer' }}>
                          <Icon name="upload" size={15} /> {posBgBusy ? t('saving') : (ar ? 'رفع صورة / فيديو' : 'Upload')}
                          <input type="file" accept={tenant?.appBg?.kind === 'video' ? 'video/*' : 'image/*'} style={{ display: 'none' }} disabled={posBgBusy}
                            onChange={async (e) => {
                              const f = e.target.files?.[0]; e.target.value = ''
                              if (!f) return
                              setPosBgBusy(true)
                              try {
                                const isV = f.type.startsWith('video/')
                                const url = isV ? await uploadFile(tenantId, f, 'appbg') : await uploadImage(tenantId, f, 'appbg')
                                const next = { ...(tenant?.appBg || {}), url, kind: isV ? 'video' : 'image' }
                                await saveNow({ appBg: next }); updateTenantLocal({ appBg: next }); toast.success(t('saved'))
                              } catch (err) { toast.error(err?.message && !err?.code ? err.message : t('error')) } finally { setPosBgBusy(false) }
                            }} />
                        </label>
                        <button className="btn btn-outline" onClick={() => setLibPick({ kind: tenant?.appBg?.kind === 'video' ? 'video' : 'image', apply: async (url, item) => {
                          const isV = (item?.kind || tenant?.appBg?.kind) === 'video'
                          const next = { ...(tenant?.appBg || {}), url, kind: isV ? 'video' : 'image' }
                          try { await saveNow({ appBg: next }); updateTenantLocal({ appBg: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                        } })}>
                          <Icon name="folder" size={15} /> {ar ? 'من المكتبة' : 'From library'}
                        </button>
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>{ar ? `وضوح الخلفية: ${Math.round((tenant?.appBg?.opacity ?? 1) * 100)}%` : `Media opacity: ${Math.round((tenant?.appBg?.opacity ?? 1) * 100)}%`}</label>
                        <input type="range" min="0.2" max="1" step="0.05" value={tenant?.appBg?.opacity ?? 1} style={{ width: '100%' }}
                          onChange={(e) => { const next = { ...(tenant?.appBg || {}), opacity: Number(e.target.value) }; updateTenantLocal({ appBg: next }); commitPosBg({ appBg: next }) }} />
                      </div>
                    </>
                  )}
                </div>

                {/* SYSTEM LAYOUT TEMPLATES — moved here from General (Studio H1) */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <Icon name="grid" size={18} style={{ color: 'var(--brand)' }} />
                    <strong>{ar ? 'قوالب واجهات النظام' : 'System interface templates'}</strong>
                  </div>
                  {!planAllows(tenant, 'systemTemplates') ? (
                    <UpgradeNotice feature="systemTemplates" />
                  ) : (
                    <>
                      <p className="xs faint" style={{ margin: 0 }}>{ar ? 'التخطيط الافتراضي لكل قسم — قوالب الكاشير والمطبخ في تبويب «الكاشير والمطبخ».' : 'Default layout per section — cashier & KDS live in their own sub-tab.'}</p>
                      {Object.entries(SECTION_TEMPLATES).filter(([sec]) => sec !== 'cashier' && sec !== 'kds').map(([sec, def]) => (
                        <TemplateGallery key={sec} sec={sec} def={def} ar={ar} current={sectionTemplate(tenant, sec)}
                          onPick={async (id) => {
                            const next = { ...(tenant?.systemTemplates || {}), [sec]: id }
                            try { await saveNow({ systemTemplates: next }); updateTenantLocal({ systemTemplates: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                          }} />
                      ))}
                    </>
                  )}
                </div>

                {/* 1. Skins/Themes gallery */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <div className="row-between">
                    <strong className="small"><Icon name="sparkles" size={14} style={{ verticalAlign: 'middle', color: 'var(--brand)' }} /> {ar ? 'اختر الثيم الأساسي للمنيو' : 'Select core theme'} <HelpTip topic="الثيمات" /></strong>
                    <span className="badge badge-success xs">{ar ? 'مظهر متجاوب' : 'Responsive'}</span>
                  </div>
                  {/* one-tap bundles: each sets several draft states at once (theme + layout + banner melt) */}
                  <div className="stack" style={{ gap: 6, background: 'var(--brand-soft)', borderRadius: 'var(--r-md)', padding: 10 }}>
                    <span className="xs bold">{ar ? 'حزم جاهزة بضغطة — ثم عدّل ما تشاء' : 'One-tap bundles — tweak later if needed'}</span>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => applyBundle('classic', { layout: 'list', fade: 'bottom' })}>
                        <Icon name="coffee" size={14} /> {ar ? 'هادئ كلاسيكي' : 'Calm classic'}
                      </button>
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => applyBundle('nova', { layout: 'storefront', fade: 'none' })}>
                        <Icon name="store" size={14} /> {ar ? 'متجر عصري' : 'Modern storefront'}
                      </button>
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => applyBundle('luxe', { fade: 'both' })}>
                        <Icon name="sparkles" size={14} /> {ar ? 'رمضاني دافئ' : 'Warm Ramadan'}
                      </button>
                    </div>
                  </div>
                  <div className="row wrap" style={{ gap: 10 }}>
                    {(skinsExpanded ? SKINS : SKINS.slice(0, 8)).map((s) => {
                      const isActive = skinId === s.id
                      return (
                        <button 
                          key={s.id} 
                          onClick={() => { setSkinId(s.id); setColor(s.tokens.brand); setAccent(s.tokens.accent); setOvFont(s.tokens.font); setOvShape(s.tokens.shape); setOvLayout(s.layout.menuLayout); setOvHeader(''); setOvBottomNav(''); setOvMotion(''); setOvMotionSpeed('normal'); setOvMotionRepeat('always'); setOvTap('press'); setOvDetailLayout(''); setOvItemImageStyle(''); setOvSpotSize('md'); setPreset('custom'); applyTheme({ brand: s.tokens.brand, accent: s.tokens.accent }) }}
                          className="stack" 
                          style={{
                            width: 'calc(25% - 8px)',
                            minWidth: 72,
                            gap: 4,
                            padding: 6,
                            borderRadius: 10,
                            border: `2px solid ${isActive ? 'var(--brand)' : 'var(--border)'}`,
                            boxShadow: isActive ? 'var(--sh-1)' : 'none',
                            background: isActive ? 'var(--surface-3, var(--surface))' : 'var(--surface)',
                            cursor: 'pointer',
                            textAlign: 'center',
                            transition: 'all 0.2s ease',
                            transform: isActive ? 'scale(1.02)' : 'scale(1)'
                          }}
                        >
                          <div style={{ height: 32, borderRadius: 6, background: `linear-gradient(135deg, ${s.tokens.brand}, ${s.tokens.accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 4px rgba(0,0,0,0.1)' }}>
                            <span style={{ color: '#fff', fontWeight: 800, fontSize: 11, fontFamily: s.tokens.font === 'amiri' || s.tokens.font === 'messiri' ? 'serif' : 'inherit' }}>
                              {ar ? 'أبجد' : 'Aa'}
                            </span>
                          </div>
                          <span className="xs bold" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{s.name[lang] || s.name.ar}</span>
                          <span className="faint" style={{ fontSize: 8 }}>{fontLabel(s.tokens.font)}</span>
                        </button>
                      )
                    })}
                  </div>
                  <button type="button" className="btn btn-sm btn-outline" style={{ width: '100%', marginTop: 8 }} onClick={() => setSkinsExpanded(!skinsExpanded)}>
                    {skinsExpanded ? (ar ? 'طي قائمة الثيمات' : 'Collapse Themes') : (ar ? `عرض كافة الثيمات (+${SKINS.length - 8})` : `Show all themes (+${SKINS.length - 8})`)} <Icon name="arrowUpDown" size={12} />
                  </button>
                </div>

                {/* 2. Custom theme snapshots */}
                <div className="card card-pad stack" style={{ gap: 10 }}>
                  <strong className="small"><Icon name="download" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'حفظ ثيم خاص باسم' : 'My Custom Theme Snapshots'}</strong>
                  <p className="xs faint">{ar ? 'سجل إعدادات الألوان الحالية والخلفيات لتبدل بينها حسب المواسم (رمضان، الشتاء).' : 'Save current palette & branding parameters to switch seasonal looks instantly.'}</p>
                  {customThemes.length > 0 && (
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      {customThemes.map((ct) => (
                        <div key={ct.id} className="stack" style={{ width: 88, gap: 4, position: 'relative' }}>
                          <button onClick={() => applyCustomTheme(ct)} className="stack" style={{ width: '100%', gap: 4, padding: 6, borderRadius: 10, border: '2px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', textAlign: 'center' }}>
                            <div style={{ height: 36, borderRadius: 7, background: `linear-gradient(135deg, ${ct.overrides?.brand || 'var(--brand)'}, ${ct.overrides?.accent || 'var(--accent)'})` }} />
                            <span className="xs bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{ct.name}</span>
                          </button>
                          <button className="icon-btn" style={{ position: 'absolute', top: -8, insetInlineEnd: -8, width: 32, height: 32, background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: '50%', color: 'var(--danger)' }} onClick={() => { if (window.confirm(ar ? `حذف الثيم المحفوظ «${ct.name || ''}»؟` : `Delete saved theme “${ct.name || ''}”?`)) removeCustomTheme(ct.id) }} aria-label={ar ? 'حذف' : 'Delete'}><Icon name="close" size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="row" style={{ gap: 8 }}>
                    <input className="input grow" placeholder={ar ? 'مثال: ثيم الصيف' : 'e.g. Summer vibe'} value={newThemeName} onChange={(e) => setNewThemeName(e.target.value)} />
                    <button className="btn btn-sm btn-primary" style={{ whiteSpace: 'nowrap' }} onClick={saveCurrentAsTheme}><Icon name="download" size={14} /> {ar ? 'حفظ الحالي' : 'Save Theme'}</button>
                  </div>
                </div>

                </div>
                <div style={{ display: aSec === 'elements' ? 'contents' : 'none' }}>
                {/* 3. Detailed skin overrides */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <strong className="small"><Icon name="settings" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'تخصيص مكونات المنيو الفنية' : 'Fine-Tune Menu Components'}</strong>
                  <div className="field">
                    <label>{ar ? 'التخطيط — طريقة عرض المنتجات' : 'Layout — products display'}</label>
                    <select className="select" value={ovLayout} onChange={(e) => setOvLayout(e.target.value)}>
                      {LAYOUT_OPTIONS.map((l) => <option key={l} value={l}>{ar ? LAYOUT_LABELS[l] : LAYOUT_LABELS_EN[l]}</option>)}
                    </select>
                  </div>

                  {/* Featured strip: manual pick (item editor) vs. auto best-sellers (by soldCount). */}
                  <div className="card card-pad stack" style={{ gap: 10 }}>
                    <strong className="small"><Icon name="star" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'الأصناف المميزة' : 'Featured items'}</strong>
                    <div className="field">
                      <label>{ar ? 'طريقة الاختيار' : 'Selection mode'}</label>
                      <select className="select" value={tenant?.featuredMode === 'auto' ? 'auto' : 'manual'}
                        onChange={async (e) => { try { await saveNow({ featuredMode: e.target.value }); updateTenantLocal({ featuredMode: e.target.value }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }}>
                        <option value="manual">{ar ? 'اختيار يدوي (تحدّده أنت)' : 'Manual (you choose)'}</option>
                        <option value="auto">{ar ? 'رصد ذكي — الأكثر طلباً تلقائياً' : 'Smart auto — best sellers'}</option>
                      </select>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <div className="field grow">
                        <label>{ar ? 'عدد الأصناف المعروضة' : 'How many to show'}</label>
                        <select className="select" value={String(tenant?.featuredCount || 8)}
                          onChange={async (e) => { const n = Number(e.target.value); try { await saveNow({ featuredCount: n }); updateTenantLocal({ featuredCount: n }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }}>
                          {[4, 6, 8, 10, 12].map((n) => <option key={n} value={String(n)}>{n}</option>)}
                        </select>
                      </div>
                      <div className="field grow">
                        <label>{ar ? 'شكل العرض' : 'Card look'}</label>
                        <select className="select" value={tenant?.featuredStyle || 'soft'}
                          onChange={async (e) => { const v = e.target.value; try { await saveNow({ featuredStyle: v }); updateTenantLocal({ featuredStyle: v }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }}>
                          <option value="soft">{ar ? 'طافية بظل ناعم' : 'Soft float'}</option>
                          <option value="plain">{ar ? 'بدون إطار (مطابق للثيم)' : 'No frame (matches theme)'}</option>
                          <option value="circle">{ar ? 'دائرية كلاسيكية' : 'Classic circle'}</option>
                        </select>
                      </div>
                    </div>
                    <p className="xs faint" style={{ margin: 0 }}>
                      {tenant?.featuredMode === 'auto'
                        ? (ar ? 'يختار النظام الأكثر مبيعاً تلقائياً بناءً على الطلبات الفعلية. تظهر بعد تراكم بعض الطلبات.' : 'The system auto-picks best sellers from real orders. Appears once some orders accrue.')
                        : (ar ? 'اختر الأصناف المميزة بالضغط عليها أدناه (أو من مفتاح «مميز» في محرّر الصنف).' : 'Pick featured items by tapping them below (or via the “Featured” switch in the Item editor).')}
                    </p>
                    {tenant?.featuredMode !== 'auto' && allItems.length > 0 && (
                      <div className="stack" style={{ gap: 6 }}>
                        <span className="xs faint">{ar ? 'الأصناف المميزة' : 'Featured items'} · {allItems.filter((i) => i.featured).length}</span>
                        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                          {allItems.map((it) => (
                            <button key={it.id} type="button" className={`btn btn-sm ${it.featured ? 'btn-primary' : 'btn-outline'}`} style={{ gap: 6, paddingInline: 8 }} onClick={() => toggleFeatured(it)}>
                              {it.imageUrl ? <img src={it.imageUrl} alt="" style={{ width: 20, height: 20, borderRadius: 6, objectFit: 'cover', flex: 'none' }} /> : <Icon name="coffee" size={13} />}
                              {pickLang(it, 'name', lang)}
                              {it.featured && <Icon name="check" size={13} />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Menu elements that used to look stark-white — now theme-matched + controllable. */}
                  <div className="card card-pad stack" style={{ gap: 10 }}>
                    <strong className="small"><Icon name="sparkles" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'تناسق عناصر المنيو مع الثيم' : 'Menu elements & theme fit'}</strong>
                    <div className="row" style={{ gap: 8 }}>
                      <div className="field grow">
                        <label>{ar ? 'بطاقة العميل' : 'Customer card'}</label>
                        <select className="select" value={tenant?.welcomeStyle || 'tinted'}
                          onChange={async (e) => { const v = e.target.value; try { await saveNow({ welcomeStyle: v }); updateTenantLocal({ welcomeStyle: v }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }}>
                          <option value="tinted">{ar ? 'بلون الثيم (موصى به)' : 'Theme-tinted (recommended)'}</option>
                          <option value="plain">{ar ? 'بدون إطار' : 'No frame'}</option>
                          <option value="card">{ar ? 'بطاقة بيضاء كلاسيكية' : 'Classic white card'}</option>
                        </select>
                      </div>
                      <div className="field grow">
                        <label>{ar ? 'شريط التصنيفات' : 'Category bar'}</label>
                        <select className="select" value={tenant?.catNavStyle || 'chips'}
                          onChange={async (e) => { const v = e.target.value; try { await saveNow({ catNavStyle: v }); updateTenantLocal({ catNavStyle: v }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }}>
                          <option value="chips">{ar ? 'حبوب (Chips)' : 'Chips'}</option>
                          <option value="tabs">{ar ? 'تبويبات بخط سفلي' : 'Underline tabs'}</option>
                          <option value="pill">{ar ? 'حبة بارزة' : 'Pill'}</option>
                          <option value="segmented">{ar ? 'مقسّم' : 'Segmented'}</option>
                        </select>
                      </div>
                    </div>
                    <p className="xs faint" style={{ margin: 0 }}>{ar ? 'حقول الطلب صارت أيضاً بلون الثيم بدل الأبيض الصريح، مع عناوين أوضح.' : 'Order-form fields now tint to the theme (no stark white) with clearer labels.'}</p>

                    {/* menu MODE: full ordering vs display-only + waiter call toggle */}
                    <div className="row" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10, flexWrap: 'wrap' }}>
                      <div className="field grow" style={{ minWidth: 200 }}>
                        <label>{ar ? 'وضع المنيو' : 'Menu mode'}</label>
                        <select className="select" value={tenant?.menuMode || 'order'}
                          onChange={async (e) => { const v = e.target.value; try { await saveNow({ menuMode: v }); updateTenantLocal({ menuMode: v }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }}>
                          <option value="order">{ar ? 'طلبات كاملة (الافتراضي)' : 'Full ordering (default)'}</option>
                          <option value="browse">{ar ? 'عرض فقط — تصفح وتسجيل بيانات العملاء' : 'Display-only — browse + customer registration'}</option>
                        </select>
                        {(tenant?.menuMode === 'browse') && <span className="xs faint">{ar ? 'تختفي السلة والطلب بالكامل؛ يظهر شريط «سجّل ليصلك جديدنا» ويُجمَع رقم العميل لإشعارات واتساب. نداء النادل يبقى متاحاً على الطاولات.' : 'Cart & ordering disappear; a “register for updates” strip collects the guest phone for WhatsApp alerts. Waiter call stays available on tables.'}</span>}
                      </div>
                      <label className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'center', alignSelf: 'flex-end', paddingBottom: 10 }}>
                        <input type="checkbox" checked={tenant?.waiterCallEnabled !== false}
                          onChange={async (e) => { try { await saveNow({ waiterCallEnabled: e.target.checked }); updateTenantLocal({ waiterCallEnabled: e.target.checked }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }} style={{ width: 20, height: 20 }} />
                        <span className="small">{ar ? 'زر نداء النادل (مع ملاحظة)' : 'Waiter-call button (with note)'}</span>
                      </label>
                    </div>

                    {/* psychology of the cart total — some guests shrink their order when
                        the sum shouts at them; let the venue choose how loud it is */}
                    <div className="field">
                      <label>{ar ? 'عرض إجمالي السلة (خدعة تسويقية)' : 'Cart total display (marketing trick)'}</label>
                      <select className="select" value={tenant?.cartTotalStyle || 'normal'}
                        onChange={async (e) => { const v = e.target.value; try { await saveNow({ cartTotalStyle: v }); updateTenantLocal({ cartTotalStyle: v }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }}>
                        <option value="normal">{ar ? 'عادي' : 'Normal'}</option>
                        <option value="bold">{ar ? 'كبير وواضح' : 'Big & clear'}</option>
                        <option value="small">{ar ? 'صغير' : 'Small'}</option>
                        <option value="faint">{ar ? 'باهت وخافت' : 'Faint'}</option>
                        <option value="hidden">{ar ? 'مخفي تماماً (تبقى أسعار الأصناف)' : 'Hidden (line prices stay)'}</option>
                      </select>
                      <span className="xs faint">{ar ? 'بعض العملاء «يستخسر» المجموع فيصغّر طلبه — إخفاؤه أو تخفيته يرفع متوسط السلة.' : 'Some guests shrink orders when the sum stares at them — hiding/fading it lifts basket size.'}</span>
                    </div>
                  </div>

                  {ovLayout === 'spotlight' && (
                    <div className="card card-pad stack" style={{ gap: 10, borderColor: 'var(--brand)' }}>
                      <strong className="small"><Icon name="sparkles" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'إعدادات واجهة العرض' : 'Spotlight settings'}</strong>
                      <div className="field">
                        <label>{ar ? 'حجم صورة المنتج' : 'Product image size'}</label>
                        <select className="select" value={ovSpotSize} onChange={(e) => setOvSpotSize(e.target.value)}>
                          <option value="md">{ar ? 'عادي' : 'Normal'}</option>
                          <option value="lg">{ar ? 'كبير' : 'Large'}</option>
                          <option value="xl">{ar ? 'كبير جداً' : 'Extra large'}</option>
                        </select>
                      </div>
                      <label className="row-between" style={{ cursor: 'pointer' }}>
                        <span className="small">{ar ? 'أغلفة الفئات (شرائح فاصلة)' : 'Category covers'}</span>
                        <input type="checkbox" checked={!ovHidden.includes('covers')} onChange={(e) => setOvHidden((h) => e.target.checked ? h.filter((k) => k !== 'covers') : [...h, 'covers'])} style={{ width: 22, height: 22 }} />
                      </label>
                      <label className="row-between" style={{ cursor: 'pointer' }}>
                        <span className="small">{ar ? 'توصيات «يُطلب معه»' : 'Pairings ("goes well with")'}</span>
                        <input type="checkbox" checked={!ovHidden.includes('pairings')} onChange={(e) => setOvHidden((h) => e.target.checked ? h.filter((k) => k !== 'pairings') : [...h, 'pairings'])} style={{ width: 22, height: 22 }} />
                      </label>
                      <p className="xs faint" style={{ margin: 0 }}>{ar ? 'الأفضل صور بخلفية شفافة (PNG). غلاف كل فئة (صورة/وصف) من محرّر الفئات، والتوصيات اليدوية من محرّر الصنف. الخلفية من تبويب «الخلفيات والوسائط».' : 'Tip: use transparent (PNG) images. Set each category cover in the Categories editor; curate pairings in the Item editor. Background lives in the Backgrounds tab.'}</p>
                    </div>
                  )}
                  <div className="row" style={{ gap: 8 }}>
                    <div className="field grow">
                      <label>{ar ? 'الخط العربي' : 'Font Family'}</label>
                      <select className="select" value={ovFont} onChange={(e) => setOvFont(e.target.value)}>
                        {FONT_OPTIONS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                    </div>
                    <div className="field grow">
                      <label>{ar ? 'انحناء الحواف' : 'Border Rounding'}</label>
                      <select className="select" value={ovShape} onChange={(e) => setOvShape(e.target.value)}>
                        {SHAPE_OPTIONS.map((s) => <option key={s} value={s}>{ar ? SHAPE_LABELS[s] : SHAPE_LABELS_EN[s]}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <div className="field grow">
                      <label>{ar ? 'الشريط العلوي (Header)' : 'Header Style'}</label>
                      <select className="select" value={ovHeader} onChange={(e) => setOvHeader(e.target.value)}>
                        <option value="">{ar ? 'تلقائي (حسب الثيم)' : 'Auto (theme)'}</option>
                        {HEADER_STYLES.map(([id, la, le]) => <option key={id} value={id}>{ar ? la : le}</option>)}
                      </select>
                    </div>
                    <div className="field grow">
                      <label>{ar ? 'شريط التصفح السفلي' : 'Bottom Navigation'}</label>
                      <select className="select" value={ovBottomNav} onChange={(e) => setOvBottomNav(e.target.value)}>
                        <option value="">{ar ? 'تلقائي (حسب الثيم)' : 'Auto (theme)'}</option>
                        {BOTTOMNAV_STYLES.map(([id, la, le]) => <option key={id} value={id}>{ar ? la : le}</option>)}
                      </select>
                    </div>
                  </div>
                  
                  {/* Motion effects */}
                  <div className="field" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <label>{ar ? 'تأثير حركة ظهور العناصر (Animations)' : 'Item Entrance Animation'}</label>
                    <select className="select" value={ovMotion} onChange={(e) => setOvMotion(e.target.value)}>
                      <option value="">{ar ? 'تلقائي (تلاشي للأعلى)' : 'Auto (Fade up)'}</option>
                      {MOTION_OPTIONS.map(([id, la, le]) => <option key={id} value={id}>{ar ? la : le}</option>)}
                    </select>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <div className="field grow">
                      <label>{ar ? 'سرعة الحركة' : 'Animation Speed'}</label>
                      <select className="select" value={ovMotionSpeed} onChange={(e) => setOvMotionSpeed(e.target.value)}>
                        {MOTION_SPEEDS.map(([id, la, le]) => <option key={id} value={id}>{ar ? la : le}</option>)}
                      </select>
                    </div>
                    <div className="field grow">
                      <label>{ar ? 'تكرار الحركة' : 'Replay Trigger'}</label>
                      <select className="select" value={ovMotionRepeat} onChange={(e) => setOvMotionRepeat(e.target.value)}>
                        {MOTION_REPEATS.map(([id, la, le]) => <option key={id} value={id}>{ar ? la : le}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label>{ar ? 'ميكرو-أوتوميشن عند لمس بطاقة الصنف' : 'Card Click Ripple Interaction'}</label>
                    <select className="select" value={ovTap} onChange={(e) => setOvTap(e.target.value)}>
                      {TAP_OPTIONS.map(([id, la, le]) => <option key={id} value={id}>{ar ? la : le}</option>)}
                    </select>
                  </div>
                </div>

                {/* 4. Show/Hide elements checklist */}
                <div className="card card-pad stack" style={{ gap: 10 }}>
                  <strong className="small"><Icon name="bell" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'عناصر المنيو المعروضة والنشطة' : 'Show / Hide Active Elements'}</strong>
                  <p className="xs faint">{ar ? 'اضغط لإخفاء أو تفعيل أي قسم من صفحة الزوار الخارجية مباشرة.' : 'Tap any element to toggle its visibility on the customer page.'}</p>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {HIDEABLE.map(([key, la, le]) => {
                      const on = !ovHidden.includes(key)
                      return (
                        <button 
                          key={key} 
                          className={`chip ${on ? 'active' : ''}`}
                          style={{ borderRadius: 10 }}
                          onClick={() => setOvHidden((h) => h.includes(key) ? h.filter((x) => x !== key) : [...h, key])}
                        >
                          <Icon name={on ? 'check' : 'close'} size={12} /> {ar ? la : le}
                        </button>
                      )
                    })}
                  </div>
                </div>

                </div>
                <div style={{ display: aSec === 'colors' ? 'contents' : 'none' }}>
                {/* 5. Custom colors configuration */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <strong className="small"><Icon name="penLine" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'لوحة ألوان الهوية البصرية الكلية' : 'Color Scheme Customization'}</strong>
                  <div className="row wrap" style={{ gap: 8 }}>
                    {THEMES.map((th) => (
                      <button key={th.id} className={`chip ${preset === th.id ? 'active' : ''}`} style={{ borderRadius: 10 }} onClick={() => { setPreset(th.id); setColor(th.brand); setAccent(th.accent); applyTheme({ brand: th.brand, accent: th.accent }) }}>
                        <span style={{ width: 12, height: 12, borderRadius: '50%', background: th.brand, display: 'inline-block', marginInlineEnd: 6, border: '1px solid rgba(0,0,0,.1)' }} />
                        {th.name[lang] || th.name.ar}
                      </button>
                    ))}
                  </div>
                  <div className="row" style={{ gap: 14, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label className="row" style={{ gap: 6, cursor: 'pointer' }}><span className="xs faint">{ar ? 'أساسي (البراند):' : 'Brand Color:'}</span><input type="color" value={color} onChange={(e) => { setColor(e.target.value); setPreset('custom'); applyTheme({ brand: e.target.value }) }} style={{ width: 44, height: 34, border: '1px solid var(--border)', borderRadius: 8, background: 'none' }} /></label>
                    <label className="row" style={{ gap: 6, cursor: 'pointer' }}><span className="xs faint">{ar ? 'ثانوي (الأكسنت):' : 'Accent Color:'}</span><input type="color" value={accent} onChange={(e) => { setAccent(e.target.value); setPreset('custom'); applyTheme({ accent: e.target.value }) }} style={{ width: 44, height: 34, border: '1px solid var(--border)', borderRadius: 8, background: 'none' }} /></label>
                  </div>
                </div>

                {/* 6. Advanced Typography controls */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <strong className="small"><Icon name="penLine" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'أحجام وألوان النصوص المنفردة' : 'Granular Text Control'}</strong>
                  <p className="xs faint">{ar ? 'تحكم بحجم خط ولون كل عنصر بشكل منفصل بداخل المنيو.' : 'Override font size and color of specific elements.'}</p>
                  {TYPO_ELEMENTS.map(([key, la, le, dft]) => (
                    <div key={key} className="field" style={{ paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)' }}>
                      <label className="bold xs">{ar ? la : le}</label>
                      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                        <input type="color" value={typo[key]?.color || '#888888'} onChange={(e) => setTypoField(key, 'color', e.target.value)} style={{ width: 38, height: 30, padding: 2, borderRadius: 8, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', flex: 'none' }} aria-label={ar ? `لون ${la}` : `${le} color`} />
                        <input type="range" min="10" max="44" step="1" value={typo[key]?.size || dft} onChange={(e) => setTypoField(key, 'size', Number(e.target.value))} className="grow" />
                        <span className="xs bold num" style={{ minWidth: 38, textAlign: 'end' }}>{typo[key]?.size || dft}px</span>
                        {(typo[key]?.color || typo[key]?.size) && <button className="icon-btn" style={{ width: 24, height: 24, flex: 'none', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: '50%' }} onClick={() => setTypoField(key, null)} aria-label={ar ? 'إرجاع' : 'Reset'}><Icon name="close" size={12} /></button>}
                      </div>
                      {/* readability guard: a custom text color must stay legible in BOTH modes */}
                      {typo[key]?.color && <div style={{ marginTop: 4 }}><ContrastHint color={typo[key].color} ar={ar} /></div>}
                    </div>
                  ))}
                </div>

                </div>
                <div style={{ display: aSec === 'media' ? 'contents' : 'none' }}>
                {/* 7. Custom gradient builders */}
                <div className="card card-pad stack" style={{ gap: 10 }}>
                  <label className="row-between" style={{ cursor: 'pointer' }}>
                    <strong className="small"><Icon name="sparkles" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'خلفية متدرّجة مخصّصة للمنيو' : 'Custom Gradient Backdrop'}</strong>
                    <input type="checkbox" checked={gradEnabled} onChange={(e) => setGradEnabled(e.target.checked)} style={{ width: 22, height: 22 }} />
                  </label>
                  {gradEnabled && (
                    <>
                      <div className="row" style={{ gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label className="row" style={{ gap: 6, cursor: 'pointer' }}><span className="xs faint">{ar ? 'لون 1' : 'Color 1'}</span><input type="color" value={gradC1} onChange={(e) => setGradC1(e.target.value)} style={{ width: 40, height: 34, border: '1px solid var(--border)', borderRadius: 8, background: 'none' }} /></label>
                        <label className="row" style={{ gap: 6, cursor: 'pointer' }}><span className="xs faint">{ar ? 'لون 2' : 'Color 2'}</span><input type="color" value={gradC2} onChange={(e) => setGradC2(e.target.value)} style={{ width: 40, height: 34, border: '1px solid var(--border)', borderRadius: 8, background: 'none' }} /></label>
                        <div className="field grow" style={{ minWidth: 120 }}><label>{ar ? `الزاوية: ${gradAngle}°` : `Angle: ${gradAngle}°`}</label><input type="range" min="0" max="360" value={gradAngle} onChange={(e) => setGradAngle(Number(e.target.value))} style={{ width: '100%' }} /></div>
                      </div>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {GRADIENT_PRESETS.map(([c1, c2]) => (
                          <button key={c1 + c2} onClick={() => { setGradC1(c1); setGradC2(c2) }} title="" style={{ width: 38, height: 26, borderRadius: 8, border: '1px solid var(--border)', background: `linear-gradient(135deg, ${c1}, ${c2})`, cursor: 'pointer' }} />
                        ))}
                      </div>
                      <div style={{ height: 40, borderRadius: 10, background: gradientCss }} />
                    </>
                  )}
                </div>

                {/* 8. Media items library */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <strong className="small"><Icon name="image" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'خلفيات وصوتيات المنيو المتقدمة' : 'Backdrop Media Library'} <HelpTip topic="البانر" /></strong>
                  <p className="xs faint">{ar ? 'تظهر خلف منيو العملاء. الفيديو له الأولوية على الصورة.' : 'Shown behind the customer menu. Video takes priority over the image.'}</p>
                  
                  <div className="row wrap" style={{ gap: 10 }}>
                    <div style={{ flex: '1 1 45%', minWidth: 140 }} className="stack">
                      <span className="xs faint">{ar ? 'صورة خلفية المنيو:' : 'Background image:'}</span>
                      <label className="center" style={{ cursor: 'pointer', height: 70, border: '1px dashed var(--border-strong)', borderRadius: 10, background: 'var(--surface-2)', overflow: 'hidden' }}>
                        {uploading === 'bg' ? <div className="spinner" /> : bgImageUrl ? <img src={bgImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="xs text-center">{ar ? 'اضغط لرفع صورة' : 'Upload Image'}</span>}
                        <input type="file" accept="image/*" hidden onChange={(e) => onBgFile(e, 'bg')} />
                      </label>
                      <button type="button" className="btn-link text-center xs" style={{ marginTop: 4 }} onClick={() => setLibPick({ kind: 'image', apply: async (url) => { setBgImageUrl(url); setBgVideoUrl(''); try { await saveNow({ bgImageUrl: url, bgVideoUrl: '' }); updateTenantLocal({ bgImageUrl: url, bgVideoUrl: '' }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } } })}>{ar ? 'من المكتبة' : 'From library'}</button>
                      {bgImageUrl && <button type="button" className="btn-link text-center xs" style={{ color: 'var(--danger)', marginTop: 4 }} onClick={() => clearField('bgImageUrl', setBgImageUrl)}>{ar ? 'إزالة الصورة' : 'Remove'}</button>}
                    </div>

                    <div style={{ flex: '1 1 45%', minWidth: 140 }} className="stack">
                      <span className="xs faint">{ar ? 'بانر المنيو العلوي:' : 'Top Banner:'}</span>
                      <label className="center" style={{ cursor: 'pointer', height: 70, border: '1px dashed var(--border-strong)', borderRadius: 10, background: 'var(--surface-2)', overflow: 'hidden' }}>
                        {uploading === 'banner' ? <div className="spinner" /> : bannerUrl ? <img src={bannerUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="xs text-center">{ar ? 'اضغط لرفع صورة' : 'Upload Image'}</span>}
                        <input type="file" accept="image/*" hidden onChange={(e) => onBgFile(e, 'banner')} />
                      </label>
                      {bannerUrl && <button type="button" className="btn-link text-center xs" style={{ color: 'var(--danger)', marginTop: 4 }} onClick={() => clearField('bannerUrl', setBannerUrl)}>{ar ? 'إزالة البانر' : 'Remove'}</button>}
                    </div>

                    <div style={{ flex: '1 1 45%', minWidth: 140 }} className="stack">
                      <span className="xs faint">{ar ? 'فيديو البانر العلوي (بدل الصورة):' : 'Banner video (replaces image):'}</span>
                      <label className="center" style={{ cursor: 'pointer', height: 70, border: '1px dashed var(--border-strong)', borderRadius: 10, background: 'var(--surface-2)', overflow: 'hidden' }}>
                        {uploading === 'bannerVideo' ? <div className="spinner" /> : bannerVideoUrl ? <video src={bannerVideoUrl} muted loop autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="xs text-center">{ar ? 'اضغط لرفع فيديو' : 'Upload Video'}</span>}
                        <input type="file" accept="video/*" hidden onChange={onBannerVideoFile} />
                      </label>
                      {bannerVideoUrl && <button type="button" className="btn-link text-center xs" style={{ color: 'var(--danger)', marginTop: 4 }} onClick={() => clearField('bannerVideoUrl', setBannerVideoUrl)}>{ar ? 'إزالة الفيديو' : 'Remove'}</button>}
                    </div>

                    <div style={{ flex: '1 1 45%', minWidth: 140 }} className="stack">
                      <span className="xs faint">{ar ? 'فيديو خلفية المنيو:' : 'Background Video:'}</span>
                      <label className="center" style={{ cursor: 'pointer', height: 70, border: '1px dashed var(--border-strong)', borderRadius: 10, background: 'var(--surface-2)', overflow: 'hidden' }}>
                        {uploading === 'video' ? <div className="spinner" /> : bgVideoUrl ? <div className="xs text-center bold text-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={12} /> {ar ? 'فيديو مرفوع' : 'Video set'}</div> : <span className="xs text-center">{ar ? 'اضغط لرفع فيديو' : 'Upload Video'}</span>}
                        <input type="file" accept="video/*" hidden onChange={onVideoFile} />
                      </label>
                      <button type="button" className="btn-link text-center xs" style={{ marginTop: 4 }} onClick={() => setLibPick({ kind: 'video', apply: async (url) => { setBgVideoUrl(url); try { await saveNow({ bgVideoUrl: url }); updateTenantLocal({ bgVideoUrl: url }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } } })}>{ar ? 'من المكتبة' : 'From library'}</button>
                      {bgVideoUrl && <button type="button" className="btn-link text-center xs" style={{ color: 'var(--danger)', marginTop: 4 }} onClick={() => clearField('bgVideoUrl', setBgVideoUrl)}>{ar ? 'إزالة الفيديو' : 'Remove'}</button>}
                    </div>

                    <div style={{ flex: '1 1 45%', minWidth: 140 }} className="stack">
                      <span className="xs faint">{ar ? 'علامة مائية مخصصة:' : 'Watermark image:'}</span>
                      <label className="center" style={{ cursor: 'pointer', height: 70, border: '1px dashed var(--border-strong)', borderRadius: 10, background: 'var(--surface-2)', overflow: 'hidden' }}>
                        {uploading === 'watermark' ? <div className="spinner" /> : watermarkUrl ? <img src={watermarkUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="xs text-center">{ar ? 'اضغط لرفع صورة' : 'Upload Image'}</span>}
                        <input type="file" accept="image/*" hidden onChange={(e) => onBgFile(e, 'watermark')} />
                      </label>
                      {watermarkUrl && <button type="button" className="btn-link text-center xs" style={{ color: 'var(--danger)', marginTop: 4 }} onClick={() => clearField('watermarkUrl', setWatermarkUrl)}>{ar ? 'إزالة العلامة' : 'Remove'}</button>}
                    </div>
                  </div>

                  {/* Positioning sliders — for image AND video backdrops alike */}
                  {(bgImageUrl || bgVideoUrl) && (
                    <div className="stack" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                      <div className="field"><label>{ar ? `شفافية الخلفية: ${Math.round(bgOpacity * 100)}%` : `Opacity: ${Math.round(bgOpacity * 100)}%`}</label><input type="range" min="0" max="1" step="0.05" value={bgOpacity} onChange={(e) => setBgOpacity(Number(e.target.value))} style={{ width: '100%' }} /></div>
                      <BgPanPad value={bgPosition} onChange={setBgPosition} label={ar ? 'تحريك الخلفية (اسحب النقطة)' : 'Move background (drag the dot)'} />
                      <div className="field"><label>{ar ? `التكبير: ${Number(bgScale).toFixed(1)}×` : `Zoom: ${Number(bgScale).toFixed(1)}×`}</label><input type="range" min="1" max="3" step="0.1" value={bgScale} onChange={(e) => setBgScale(Number(e.target.value))} style={{ width: '100%' }} /></div>
                    </div>
                  )}
                </div>

                {/* 9. Top banner controls */}
                {(bannerUrl || bannerVideoUrl) && (
                  <div className="card card-pad stack" style={{ gap: 12 }}>
                    <strong className="small">{ar ? 'تحكّم البانر العلوي' : 'Top banner controls'}</strong>
                    <div className="field">
                      <label>{ar ? 'النمط' : 'Style'}</label>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {BANNER_STYLES.map(([id, a, e]) => <button key={id} className={`chip ${bannerStyle === id ? 'active' : ''}`} onClick={() => setBannerStyle(id)}>{ar ? a : e}</button>)}
                      </div>
                    </div>
                    <div className="field"><label>{ar ? `الشفافية: ${Math.round(bannerOpacity * 100)}%` : `Opacity: ${Math.round(bannerOpacity * 100)}%`}</label><input type="range" min="0.2" max="1" step="0.05" value={bannerOpacity} onChange={(e) => setBannerOpacity(Number(e.target.value))} style={{ width: '100%' }} /></div>
                    {/* the melt: where the banner dissolves into the page, and how strongly */}
                    <div className="field">
                      <label>{ar ? 'اندماج البانر مع المنيو (اتجاه التدرّج)' : 'Banner melt (fade direction)'}</label>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {[['bottom', ar ? 'يذوب للأسفل (موصى به)' : 'Melt down (recommended)'], ['top', ar ? 'يذوب للأعلى' : 'Melt up'], ['both', ar ? 'الطرفان' : 'Both edges'], ['none', ar ? 'بدون تدرّج' : 'No fade']].map(([id, l]) => (
                          <button key={id} className={`chip ${bannerFadeDir === id ? 'active' : ''}`} onClick={() => setBannerFadeDir(id)}>{l}</button>
                        ))}
                      </div>
                      <span className="xs faint">{ar ? 'التدرّج يذوّب الصورة/الفيديو في خلفية المنيو نفسها فيبدو جزءاً منه لا شريطاً منفصلاً.' : 'The fade dissolves the image/video into the menu background itself — one piece, not a pasted strip.'}</span>
                    </div>
                    <div className="field"><label>{ar ? `قوّة الاندماج: ${Math.round(bannerGradient * 100)}%` : `Melt strength: ${Math.round(bannerGradient * 100)}%`}</label><input type="range" min="0" max="1" step="0.05" value={bannerGradient} onChange={(e) => setBannerGradient(Number(e.target.value))} style={{ width: '100%' }} /></div>
                    <BgPanPad value={bannerPosition} onChange={setBannerPosition} label={ar ? 'تحريك البانر (اسحب النقطة)' : 'Move banner (drag the dot)'} />
                    <div className="field"><label>{ar ? `التكبير: ${Number(bannerScale).toFixed(1)}×` : `Zoom: ${Number(bannerScale).toFixed(1)}×`}</label><input type="range" min="1" max="3" step="0.1" value={bannerScale} onChange={(e) => setBannerScale(Number(e.target.value))} style={{ width: '100%' }} /></div>
                  </div>
                )}

                </div>
                <div style={{ display: aSec === 'details' ? 'contents' : 'none' }}>
                {/* Social icons appearance — a normal control card inside this sub-tab */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <strong className="small">{ar ? 'مظهر أيقونات التواصل' : 'Social icons look'}</strong>
                  <SocialLinks social={{ instagram: 'x', x: 'x', tiktok: 'x', whatsapp: '9665' }} appearance={tenant?.socialStyle} />
                  {[
                    ['shape', ar ? 'الشكل' : 'Shape', [['circle', ar ? 'دائري' : 'Circle'], ['rounded', ar ? 'مدوّر' : 'Rounded'], ['square', ar ? 'مربع' : 'Square'], ['bare', ar ? 'بلا خلفية' : 'Bare']]],
                    ['tone', ar ? 'اللون' : 'Tone', [['auto', ar ? 'تلقائي' : 'Auto'], ['brand', ar ? 'لون الهوية' : 'Brand'], ['custom', ar ? 'مخصص' : 'Custom']]],
                    ['size', ar ? 'الحجم' : 'Size', [['sm', ar ? 'صغير' : 'S'], ['md', ar ? 'وسط' : 'M'], ['lg', ar ? 'كبير' : 'L']]],
                  ].map(([key, label, opts]) => (
                    <div key={key} className="row-between wrap" style={{ gap: 8, alignItems: 'center' }}>
                      <span className="small">{label}</span>
                      <div className="segmented">
                        {opts.map(([id, lbl]) => (
                          <button key={id} className={(tenant?.socialStyle?.[key] || (key === 'shape' ? 'circle' : key === 'tone' ? 'auto' : 'md')) === id ? 'active' : ''}
                            onClick={async () => {
                              const next = { ...(tenant?.socialStyle || {}), [key]: id }
                              try { await saveNow({ socialStyle: next }); updateTenantLocal({ socialStyle: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                            }}>{lbl}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {tenant?.socialStyle?.tone === 'custom' && (
                    <div className="row-between" style={{ alignItems: 'center' }}>
                      <span className="small">{ar ? 'اللون المخصص' : 'Custom color'}</span>
                      <input type="color" value={tenant?.socialStyle?.color || '#7c2d2d'} style={{ width: 44, height: 32, border: 'none', background: 'none', cursor: 'pointer' }}
                        onChange={async (e) => {
                          const next = { ...(tenant?.socialStyle || {}), color: e.target.value }
                          updateTenantLocal({ socialStyle: next }); commitPosBg({ socialStyle: next })
                        }} />
                    </div>
                  )}
                  <p className="xs faint" style={{ margin: 0 }}>{ar ? 'روابط الحسابات نفسها تُدخل من قسم «الهوية والنشاط» ← وسائل التواصل.' : 'The links themselves are set in the Identity & business section → Social media.'}</p>
                </div>

                {/* 10. Immersive screen controls */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <strong className="small">{ar ? 'شاشة تفاصيل المنتج (Item Details Screen)' : 'Item Details Screen'}</strong>
                  <div className="field">
                    <label>{ar ? 'تصميم وشكل نافذة تفاصيل المنتج' : 'Item Details Layout Style'}</label>
                    <select className="select" value={ovDetailLayout} onChange={(e) => setOvDetailLayout(e.target.value)}>
                      <option value="">{ar ? 'تلقائي (حسب الثيم)' : 'Auto (theme)'}</option>
                      <option value="sheet">{ar ? 'درج سفلي قياسي' : 'Standard Bottom Sheet'}</option>
                      <option value="immersive">{ar ? 'كامل بملء النافذة (غامر)' : 'Immersive Full Window'}</option>
                      <option value="modern-card">{ar ? 'كارت حديث منقسم' : 'Modern Split Card'}</option>
                      <option value="split-page">{ar ? 'صفحة منقسمة' : 'Split Page Layout'}</option>
                      <option value="elegant-dark">{ar ? 'كارت كلاسيكي فاخر' : 'Elegant Dark Card'}</option>
                      <option value="compact-row">{ar ? 'نافذة مبسطة مدمجة' : 'Compact Row List'}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>{ar ? 'طريقة عرض وتأطير صورة المنتج' : 'Item Image Display Style'}</label>
                    <select className="select" value={ovItemImageStyle} onChange={(e) => setOvItemImageStyle(e.target.value)}>
                      <option value="">{ar ? 'تلقائي (حسب الثيم)' : 'Auto (theme)'}</option>
                      <option value="circle">{ar ? 'شكل دائري كلاسيكي بإطار' : 'Classic Circle with Border'}</option>
                      <option value="square">{ar ? 'شكل مربع بحواف مستديرة' : 'Soft Rounded Square'}</option>
                      <option value="float">{ar ? 'طافية ومجسمة بدون إطار (PNG)' : 'Frameless Float PNG'}</option>
                      <option value="hexagon">{ar ? 'شكل هندسي سداسي' : 'Elegant Hexagonal Polygon'}</option>
                      <option value="heart">{ar ? 'شكل قلبي رومانسي' : 'Heart Shape'}</option>
                      <option value="hidden">{ar ? 'مخفية بالكامل (نصي فقط)' : 'Hidden (Text Only)'}</option>
                    </select>
                  </div>
                  <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}><Icon name="image" size={15} /> {uploading === 'immersive' ? t('saving') : (ar ? 'صورة الخلفية' : 'Screen backdrop image')}<input type="file" accept="image/*" hidden onChange={(e) => onBgFile(e, 'immersive')} /></label>
                    {immersiveBgUrl && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => clearField('immersiveBgUrl', setImmersiveBgUrl)}>{ar ? 'إزالة الصورة' : 'Remove'}</button>}

                    <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}><Icon name="video" size={15} /> {uploading === 'immersive-video' ? t('saving') : (ar ? 'فيديو الخلفية' : 'Screen backdrop video')}<input type="file" accept="video/*" hidden onChange={onDetailsVideoFile} /></label>
                    {immersiveBgVideoUrl && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => clearField('immersiveBgVideoUrl', setImmersiveBgVideoUrl)}>{ar ? 'إزالة الفيديو' : 'Remove'}</button>}
                  </div>
                  {(immersiveBgUrl || immersiveBgVideoUrl) && (
                    <>
                      <div className="field"><label>{ar ? `شفافية الخلفية: ${Math.round(immersiveBgOpacity * 100)}%` : `Backdrop opacity: ${Math.round(immersiveBgOpacity * 100)}%`}</label><input type="range" min="0.05" max="1" step="0.05" value={immersiveBgOpacity} onChange={(e) => setImmersiveBgOpacity(Number(e.target.value))} style={{ width: '100%' }} /></div>
                      <BgPanPad value={immersiveBgPosition} onChange={setImmersiveBgPosition} label={ar ? 'تحريك الخلفية (اسحب النقطة)' : 'Move backdrop (drag the dot)'} />
                      <div className="field"><label>{ar ? `التكبير: ${Number(immersiveBgScale).toFixed(1)}×` : `Zoom: ${Number(immersiveBgScale).toFixed(1)}×`}</label><input type="range" min="1" max="3" step="0.1" value={immersiveBgScale} onChange={(e) => setImmersiveBgScale(Number(e.target.value))} style={{ width: '100%' }} /></div>
                    </>
                  )}
                  <label className="row-between" style={{ cursor: 'pointer' }}>
                    <span className="small">{ar ? 'فتح تفاصيل الصنف بملء الشاشة مباشرة' : 'Open item fullscreen'}</span>
                    <input type="checkbox" checked={immersiveFull} onChange={(e) => setImmersiveFull(e.target.checked)} style={{ width: 22, height: 22 }} />
                  </label>
                </div>

                {/* Art backdrop for the artistic themes (oceanart) — AI-generated in the
                    theme's visual language, or uploaded. Instant-save (artBgUrl/artBgTone). */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <strong className="small"><Icon name="palette" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'الخلفية الفنية (ثيم «اللوحة الفنية»)' : 'Art backdrop (Ocean-art theme)'}</strong>
                  <p className="xs faint" style={{ margin: 0 }}>{ar ? 'سطح مصمم بروح الثيم تُعرض عليه الأصناف كلوحات. ولّدها بالذكاء بنفس اللغة البصرية أو ارفع تصميمك.' : 'A designed surface the dishes sit on. Generate it with AI in the theme language, or upload your own.'}</p>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {[['deepblue', ar ? 'أزرق ملكي' : 'Deep blue'], ['emerald', ar ? 'زمردي' : 'Emerald'], ['burgundy', ar ? 'عنابي' : 'Burgundy'], ['charcoal', ar ? 'فحمي' : 'Charcoal']].map(([id, label]) => (
                      <button key={id} type="button" className={`chip ${(tenant?.artBgTone || 'deepblue') === id ? 'active' : ''}`}
                        onClick={async () => { try { await saveNow({ artBgTone: id }); updateTenantLocal({ artBgTone: id }) } catch (_) { toast.error(t('error')) } }}>{label}</button>
                    ))}
                  </div>
                  <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" className="btn btn-sm btn-primary" disabled={!!artBgBusy} onClick={genArtBg}>
                      <Icon name="sparkles" size={15} /> {artBgBusy ? (ar ? 'يولّد الخلفية…' : 'Generating…') : (ar ? 'توليد خلفية بالذكاء' : 'AI-generate backdrop')}
                    </button>
                    <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
                      <Icon name="upload" size={15} /> {uploading === 'artbg' ? t('saving') : (ar ? 'رفع خلفية' : 'Upload')}
                      <input type="file" accept="image/*" hidden onChange={onArtBgFile} />
                    </label>
                    {tenant?.artBgUrl && (
                      <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }}
                        onClick={async () => { try { await saveNow({ artBgUrl: '' }); updateTenantLocal({ artBgUrl: '' }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }}>
                        {ar ? 'إزالة' : 'Remove'}
                      </button>
                    )}
                  </div>
                  {tenant?.artBgUrl && <img src={tenant.artBgUrl} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 'var(--r-md)' }} />}
                </div>

                </div>
                <div style={{ display: aSec === 'staff' ? 'contents' : 'none' }}>
                {/* cashier & kitchen templates + themes — the live preview sits in the main
                    preview panel (it switches automatically while this tab is active) */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <strong className="small"><Icon name="grid" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'قوالب وثيمات الكاشير والمطبخ' : 'Cashier & kitchen templates + themes'}</strong>
                  {!planAllows(tenant, 'systemTemplates') ? (
                    <UpgradeNotice feature="systemTemplates" />
                  ) : (
                    <>
                      {['cashier', 'kds'].map((sec) => (
                        <TemplateGallery key={sec} sec={sec} def={SECTION_TEMPLATES[sec]} ar={ar} current={sectionTemplate(tenant, sec)}
                          onPick={async (id) => {
                            const next = { ...(tenant?.systemTemplates || {}), [sec]: id }
                            try { await saveNow({ systemTemplates: next }); updateTenantLocal({ systemTemplates: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                          }} />
                      ))}
                      <div style={{ borderTop: '1px solid var(--border)' }} />
                      {[['cashier', ar ? 'ثيم الكاشير' : 'Cashier theme'], ['kds', ar ? 'ثيم المطبخ' : 'Kitchen theme']].map(([sec, label]) => (
                        <div key={sec} className="row-between wrap" style={{ gap: 8, alignItems: 'center' }}>
                          <span className="small bold" style={{ flex: 'none' }}>{label}</span>
                          <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <button type="button" className={`chip ${!tenant?.systemThemeBy?.[sec] ? 'active' : ''}`}
                              onClick={async () => {
                                const next = { ...(tenant?.systemThemeBy || {}) }
                                delete next[sec]
                                try { await saveNow({ systemThemeBy: next }); updateTenantLocal({ systemThemeBy: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                              }}>{ar ? 'يتبع العام' : 'Follow global'}</button>
                            {SYSTEM_THEMES.map((th) => (
                              <button key={th.id} type="button" className={`chip ${tenant?.systemThemeBy?.[sec] === th.id ? 'active' : ''}`} title={ar ? th.hintAr : th.en}
                                onClick={async () => {
                                  const next = { ...(tenant?.systemThemeBy || {}), [sec]: th.id }
                                  try { await saveNow({ systemThemeBy: next }); updateTenantLocal({ systemThemeBy: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                                }}>{ar ? th.ar : th.en}</button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {/* per-scope Liquid overrides: cashier / kitchen can run their own glass values */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <strong className="small"><Icon name="sparkles" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'زجاج مخصص لهذا القسم (اختياري)' : 'Per-section glass (optional)'}</strong>
                  <p className="xs faint" style={{ margin: 0 }}>{ar ? 'افتراضياً يتبع قيم الزجاج العامة في تبويب «الثيم» — فعّل قيماً خاصة عند الحاجة (مثلاً كاشير أوضح ومطبخ أصفى).' : 'Follows the global glass values by default — enable custom values per screen when needed.'}</p>
                  {['cashier', 'kds'].map((scope) => {
                    const on = !!tenant?.glassFxBy?.[scope]
                    const cur = { ...(tenant?.glassFx || {}), ...(tenant?.glassFxBy?.[scope] || {}) }
                    const saveScope = (patch) => {
                      const next = { ...(tenant?.glassFxBy || {}), [scope]: { ...(tenant?.glassFxBy?.[scope] || {}), ...patch } }
                      updateTenantLocal({ glassFxBy: next }); commitPosBg({ glassFxBy: next })
                    }
                    return (
                      <div key={scope} className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        <div className="row-between" style={{ alignItems: 'center' }}>
                          <span className="small bold">{scope === 'cashier' ? (ar ? 'الكاشير' : 'Cashier') : (ar ? 'المطبخ' : 'Kitchen')}</span>
                          <div className="segmented">
                            <button className={!on ? 'active' : ''} onClick={async () => {
                              const next = { ...(tenant?.glassFxBy || {}) }; delete next[scope]
                              try { await saveNow({ glassFxBy: next }); updateTenantLocal({ glassFxBy: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                            }}>{ar ? 'يتبع العام' : 'Global'}</button>
                            <button className={on ? 'active' : ''} onClick={async () => {
                              if (on) return
                              const next = { ...(tenant?.glassFxBy || {}), [scope]: { alpha: cur.alpha ?? 0.62, blur: cur.blur ?? 24, sat: cur.sat ?? 1.8 } }
                              try { await saveNow({ glassFxBy: next }); updateTenantLocal({ glassFxBy: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
                            }}>{ar ? 'مخصص' : 'Custom'}</button>
                          </div>
                        </div>
                        {on && [
                          ['alpha', ar ? 'الشفافية' : 'Opacity', 0.08, 0.9, 0.01, cur.alpha ?? 0.62, (v) => `${Math.round(v * 100)}%`],
                          ['blur', ar ? 'اللزوجة' : 'Frost', 4, 48, 1, cur.blur ?? 24, (v) => `${v}px`],
                          ['sat', ar ? 'الحيوية' : 'Vibrancy', 1, 2.4, 0.05, cur.sat ?? 1.8, (v) => `${Math.round(v * 100)}%`],
                        ].map(([key, label, min, max, step, val, fmt]) => (
                          <div key={key} className="field" style={{ marginBottom: 0 }}>
                            <label>{label}: <span className="num">{fmt(val)}</span></label>
                            <input type="range" min={min} max={max} step={step} value={val} style={{ width: '100%' }}
                              onChange={(e) => saveScope({ [key]: Number(e.target.value) })} />
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>

                {/* Cashier POS backdrop: subtle image/video behind the item grid */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <strong className="small"><Icon name="cashier" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'خلفية شاشة الكاشير (POS)' : 'Cashier screen backdrop'}</strong>
                  <p className="xs faint" style={{ margin: 0 }}>{ar ? 'صورة أو فيديو هادئ خلف شبكة الأصناف — أبقِ الشفافية منخفضة ليبقى الموظف مركّزاً. تعمل على كل الأجهزة (جوال/تابلت/كمبيوتر).' : 'A calm image or video behind the item grid — keep opacity low for legibility. Works on every device size.'}</p>
                  {tenant?.posBg?.url && (
                    <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                      {tenant.posBg.kind === 'video'
                        ? <video src={tenant.posBg.url} muted style={{ width: 84, height: 56, objectFit: 'cover', borderRadius: 8 }} />
                        : <img src={tenant.posBg.url} alt="" style={{ width: 84, height: 56, objectFit: 'cover', borderRadius: 8 }} />}
                      <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)' }}
                        onClick={async () => { try { await saveNow({ posBg: '' }); updateTenantLocal({ posBg: '' }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }}>
                        {ar ? 'إزالة' : 'Remove'}
                      </button>
                    </div>
                  )}
                  <label className="btn btn-outline" style={{ cursor: 'pointer' }}>
                    <Icon name="upload" size={15} /> {posBgBusy ? t('saving') : (ar ? 'رفع صورة / فيديو' : 'Upload image / video')}
                    <input type="file" accept="image/*,video/*" style={{ display: 'none' }} disabled={posBgBusy}
                      onChange={async (e) => {
                        const f = e.target.files?.[0]; e.target.value = ''
                        if (!f) return
                        setPosBgBusy(true)
                        try {
                          const isV = f.type.startsWith('video/')
                          const url = isV ? await uploadFile(tenantId, f, 'posbg') : await uploadImage(tenantId, f, 'posbg')
                          const posBg = { url, kind: isV ? 'video' : 'image' }
                          await saveNow({ posBg }); updateTenantLocal({ posBg }); toast.success(t('saved'))
                        } catch (_) { toast.error(t('error')) } finally { setPosBgBusy(false) }
                      }} />
                  </label>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>{ar ? `الشفافية: ${Math.round(posBgOp * 100)}%` : `Opacity: ${Math.round(posBgOp * 100)}%`}</label>
                    <input type="range" min="0.04" max="0.6" step="0.02" value={posBgOp} style={{ width: '100%' }}
                      onChange={(e) => { const v = Number(e.target.value); setPosBgOp(v); commitPosBg({ posBgOpacity: v }) }} />
                  </div>
                  {tenant?.posBg?.url && (
                    <>
                      <BgPanPad value={posBgPos} onChange={(v) => { setPosBgPos(v); commitPosBg({ posBgPosition: v }) }} label={ar ? 'تحريك الخلفية (اسحب النقطة)' : 'Move backdrop (drag the dot)'} />
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>{ar ? `التكبير: ${Number(posBgScale).toFixed(1)}×` : `Zoom: ${Number(posBgScale).toFixed(1)}×`}</label>
                        <input type="range" min="1" max="3" step="0.1" value={posBgScale} style={{ width: '100%' }}
                          onChange={(e) => { const v = Number(e.target.value); setPosBgScale(v); commitPosBg({ posBgScale: v }) }} />
                      </div>
                    </>
                  )}
                </div>
                </div>
                <div style={{ display: aSec === 'pinlock' ? 'contents' : 'none' }}>
                {/* Lock-screen look: tone theme + pad shape + background media with full control */}
                <div className="card card-pad stack" style={{ gap: 12 }}>
                  <strong className="small"><Icon name="key" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'مظهر شاشة القفل' : 'Lock screen look'}</strong>
                  <div className="row-between wrap" style={{ gap: 8, alignItems: 'center' }}>
                    <span className="small">{ar ? 'الثيم' : 'Theme'}</span>
                    <div className="segmented">
                      {[['auto', ar ? 'تلقائي' : 'Auto'], ['dark', ar ? 'داكن' : 'Dark'], ['light', ar ? 'فاتح' : 'Light'], ['brand', ar ? 'لون الهوية' : 'Brand']].map(([id, lbl]) => (
                        <button key={id} className={(pinStyle.tone || 'auto') === id ? 'active' : ''} onClick={() => savePinStyle({ tone: id })}>{lbl}</button>
                      ))}
                    </div>
                  </div>
                  <div className="row-between wrap" style={{ gap: 8, alignItems: 'center' }}>
                    <span className="small">{ar ? 'شكل الأزرار' : 'Pad shape'}</span>
                    <div className="segmented">
                      {[['rounded', ar ? 'مدوّر' : 'Rounded'], ['circle', ar ? 'دائري' : 'Circle'], ['square', ar ? 'مربع' : 'Square'], ['pill', ar ? 'حبّة' : 'Pill']].map(([id, lbl]) => (
                        <button key={id} className={(pinStyle.padShape || 'rounded') === id ? 'active' : ''} onClick={() => savePinStyle({ padShape: id })}>{lbl}</button>
                      ))}
                    </div>
                  </div>
                  {/* Apple-style clock customization */}
                  {[
                    ['clockFont', ar ? 'خط الساعة' : 'Clock font', [['default', ar ? 'افتراضي' : 'Default'], ['thin', ar ? 'رفيع' : 'Thin'], ['serif', ar ? 'كلاسيكي' : 'Serif'], ['mono', ar ? 'رقمي' : 'Mono']]],
                    ['clockSize', ar ? 'حجم الساعة' : 'Clock size', [['sm', ar ? 'صغير' : 'S'], ['md', ar ? 'وسط' : 'M'], ['lg', ar ? 'كبير' : 'L']]],
                    ['clockFormat', ar ? 'صيغة الوقت' : 'Time format', [['24', '24'], ['12', '12']]],
                  ].map(([key, label, opts]) => (
                    <div key={key} className="row-between wrap" style={{ gap: 8, alignItems: 'center' }}>
                      <span className="small">{label}</span>
                      <div className="segmented">
                        {opts.map(([id, lbl]) => (
                          <button key={id} className={(pinStyle[key] || (key === 'clockSize' ? 'md' : key === 'clockFormat' ? '24' : 'default')) === id ? 'active' : ''} onClick={() => savePinStyle({ [key]: id })}>{lbl}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div style={{ borderTop: '1px solid var(--border)' }} />
                  <div className="small bold">{ar ? 'خلفية الشاشة (صورة / فيديو)' : 'Background (image / video)'}</div>
                  {pinStyle.bg?.url && (
                    <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                      {pinStyle.bg.kind === 'video'
                        ? <video src={pinStyle.bg.url} muted style={{ width: 84, height: 56, objectFit: 'cover', borderRadius: 8 }} />
                        : <img src={pinStyle.bg.url} alt="" style={{ width: 84, height: 56, objectFit: 'cover', borderRadius: 8 }} />}
                      <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)' }} onClick={() => savePinStyle({ bg: '' })}>{ar ? 'إزالة' : 'Remove'}</button>
                    </div>
                  )}
                  <label className="btn btn-outline" style={{ cursor: 'pointer' }}>
                    <Icon name="upload" size={15} /> {pinBgBusy ? t('saving') : (ar ? 'رفع صورة / فيديو' : 'Upload image / video')}
                    <input type="file" accept="image/*,video/*" style={{ display: 'none' }} disabled={pinBgBusy}
                      onChange={async (e) => {
                        const f = e.target.files?.[0]; e.target.value = ''
                        if (!f) return
                        setPinBgBusy(true)
                        try {
                          const isV = f.type.startsWith('video/')
                          const url = isV ? await uploadFile(tenantId, f, 'pinlock') : await uploadImage(tenantId, f, 'pinlock')
                          await savePinStyle({ bg: { url, kind: isV ? 'video' : 'image' } })
                          toast.success(t('saved'))
                        } catch (_) { toast.error(t('error')) } finally { setPinBgBusy(false) }
                      }} />
                  </label>
                  {pinStyle.bg?.url && (
                    <>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>{ar ? `الشفافية: ${Math.round((pinStyle.bgOpacity ?? 0.35) * 100)}%` : `Opacity: ${Math.round((pinStyle.bgOpacity ?? 0.35) * 100)}%`}</label>
                        <input type="range" min="0.05" max="1" step="0.05" value={pinStyle.bgOpacity ?? 0.35} style={{ width: '100%' }}
                          onChange={(e) => { const v = Number(e.target.value); updateTenantLocal({ pinLockStyle: { ...pinStyle, bgOpacity: v } }); commitPosBg({ pinLockStyle: { ...pinStyle, bgOpacity: v } }) }} />
                      </div>
                      <BgPanPad value={pinStyle.bgPosition || 'center'} onChange={(v) => { updateTenantLocal({ pinLockStyle: { ...pinStyle, bgPosition: v } }); commitPosBg({ pinLockStyle: { ...pinStyle, bgPosition: v } }) }} label={ar ? 'تحريك الخلفية (اسحب النقطة)' : 'Move background'} />
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>{ar ? `التكبير: ${Number(pinStyle.bgScale || 1).toFixed(1)}×` : `Zoom: ${Number(pinStyle.bgScale || 1).toFixed(1)}×`}</label>
                        <input type="range" min="1" max="3" step="0.1" value={pinStyle.bgScale || 1} style={{ width: '100%' }}
                          onChange={(e) => { const v = Number(e.target.value); updateTenantLocal({ pinLockStyle: { ...pinStyle, bgScale: v } }); commitPosBg({ pinLockStyle: { ...pinStyle, bgScale: v } }) }} />
                      </div>
                    </>
                  )}
                  <p className="xs faint" style={{ margin: 0 }}>{ar ? 'تفعيل القفل وأرقام الموظفين من قسم «النظام والأمان» ← قفل النظام برمز PIN.' : 'Enable the lock and the staff PINs in the System & security section.'}</p>
                </div>
                </div>

                {designDirty && (
                  <div className="row" style={{ gap: 8, alignItems: 'center', background: 'var(--warning-soft)', color: 'var(--warning)', borderRadius: 'var(--r-md)', padding: '8px 12px', fontWeight: 700, fontSize: 'var(--fs-xs)' }}>
                    <Icon name="warning" size={14} style={{ flex: 'none' }} />
                    {ar ? 'لديك تغييرات غير محفوظة — المعاينة تعرضها، لكن المنيو الحقيقي لن يتغير حتى تضغط «حفظ».' : 'Unsaved changes — the preview shows them, but the live menu updates only after Save.'}
                  </div>
                )}
                <button className="btn btn-primary btn-block btn-lg" onClick={save} disabled={busy}>{busy ? t('saving') : t('save')}</button>
                {lastSavedAt && (
                  <span className="xs faint" style={{ textAlign: 'center' }}>
                    {ar ? 'آخر حفظ ' : 'Last saved '}
                    <span className="num">{lastSavedAt.toLocaleTimeString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                  </span>
                )}
              </>
            ) : (
              <div className="card card-pad stack center" style={{ gap: 8, textAlign: 'center' }}>
                <Icon name="award" size={28} style={{ color: 'var(--gold)' }} />
                <strong>{ar ? 'الثيمات والخلفيات ميزة احترافية' : 'Themes are a Pro feature'}</strong>
                <p className="xs faint">{ar ? 'فعّل الباقة الاحترافية لتغيير شكل المنيو بالكامل.' : 'Upgrade to Pro to fully restyle your menu.'}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ RECEIPT DESIGNER ============ */}
      {tab === 'receipt' && (
        <div className="appearance-grid" id="set-receipt">
          {/* Settings Panel */}
          <div className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
            <strong>{ar ? 'تخصيص تصميم الفاتورة' : 'Customize Receipt Design'}</strong>
            <p className="xs faint">{ar ? 'تحكّم في البيانات والنصوص التي تظهر في الفاتورة الحرارية المطبوعة للعملاء.' : 'Configure text and details shown on the thermal customer receipt.'}</p>
            
            <div className="field">
              <label>{ar ? 'ترويسة الفاتورة (اسم المحل والعنوان)' : 'Receipt Header'}</label>
              <textarea className="textarea" rows={3} value={receiptHeader} onChange={(e) => setReceiptHeader(e.target.value)} placeholder={ar ? "اسم المنشأة\nشارع التخصصي، الرياض\nالهاتف: 011XXXXXXX" : "Venue Name\nTakhassusi St, Riyadh\nPhone: 011XXXXXXX"} />
            </div>
            
            <div className="field">
              <label>{ar ? 'تذييل الفاتورة (رسالة شكر أو سياسة)' : 'Receipt Footer'}</label>
              <textarea className="textarea" rows={2} value={receiptFooter} onChange={(e) => setReceiptFooter(e.target.value)} placeholder={ar ? "شكراً لزيارتكم!\nالرقم الضريبي: XXXXXXXXX" : "Thank you for your visit!\nVAT ID: XXXXXXXXX"} />
            </div>

            <div className="field">
              <label>{ar ? 'ملاحظة إضافية أسفل الفاتورة' : 'Extra Receipt Note'}</label>
              <input className="input" value={receiptExtraNote} onChange={(e) => setReceiptExtraNote(e.target.value)} placeholder={ar ? "لا يمكن استبدال المواد المفتوحة" : "Opened items are not exchangeable"} />
            </div>
            
            <div className="field">
              <label>{ar ? 'حجم خط الطباعة للفاتورة' : 'Receipt Font Size'}</label>
              <select className="select" value={receiptFontSize} onChange={(e) => setReceiptFontSize(e.target.value)}>
                <option value="small">{ar ? 'صغير' : 'Small'}</option>
                <option value="medium">{ar ? 'متوسط' : 'Medium'}</option>
                <option value="large">{ar ? 'كبير' : 'Large'}</option>
              </select>
            </div>

            <div className="stack" style={{ gap: 10, marginBlock: 'var(--sp-2)' }}>
              <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={receiptShowLogo} onChange={(e) => setReceiptShowLogo(e.target.checked)} style={{ width: 18, height: 18 }} />
                <span className="small">{ar ? 'إظهار شعار الكافيه' : 'Show Logo'}</span>
              </label>
              
              <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={receiptShowVat} onChange={(e) => setReceiptShowVat(e.target.checked)} style={{ width: 18, height: 18 }} />
                <span className="small">{ar ? 'إظهار تفاصيل وقيم الضريبة (VAT)' : 'Show VAT Details'}</span>
              </label>
              
              <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={receiptShowBarcode} onChange={(e) => setReceiptShowBarcode(e.target.checked)} style={{ width: 18, height: 18 }} />
                <span className="small">{ar ? 'إظهار الرمز الشريطي / QR' : 'Show QR / Barcode'}</span>
              </label>

              <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={receiptShowCustomer} onChange={(e) => setReceiptShowCustomer(e.target.checked)} style={{ width: 18, height: 18 }} />
                <span className="small">{ar ? 'إظهار اسم ورقم العميل' : 'Show Customer Info'}</span>
              </label>
            </div>
            
            <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>{busy ? t('saving') : t('save')}</button>
          </div>

          {/* Live Preview Panel */}
          <div className="stack" style={{ gap: 'var(--sp-3)', background: 'var(--surface-2)', padding: 'var(--sp-4)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
            <strong className="small text-center" style={{ display: 'block', color: 'var(--text-muted)' }}>{ar ? 'معاينة حية للفاتورة الحرارية' : 'Thermal Receipt Live Preview'}</strong>
            
            <div 
              className="receipt-preview-paper" 
              style={{
                background: '#ffffff',
                color: '#1c1917',
                padding: '24px 20px',
                borderRadius: 'var(--r-md)',
                boxShadow: 'var(--sh-2)',
                fontFamily: 'monospace',
                fontSize: receiptFontSize === 'small' ? '11px' : receiptFontSize === 'large' ? '15px' : '13px',
                lineHeight: '1.4',
                maxWidth: '340px',
                width: '100%',
                margin: '0 auto',
                border: '1px solid #e7e5e4',
                position: 'relative',
                boxSizing: 'border-box'
              }}
            >
              {/* Jagged top edge effect */}
              <div style={{ position: 'absolute', top: -4, left: 0, right: 0, height: 6, background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, #ffffff 4px, #ffffff 8px)', filter: 'drop-shadow(0 -2px 1px rgba(0,0,0,0.05))' }} />
              
              {/* Logo */}
              {receiptShowLogo && logoUrl && (
                <div className="center" style={{ marginBottom: 12 }}>
                  <img src={logoUrl} alt="logo" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', filter: 'grayscale(100%) contrast(150%)' }} />
                </div>
              )}
              
              {/* Header text */}
              <div style={{ textAlign: 'center', whiteSpace: 'pre-line', marginBottom: 10, fontWeight: 700 }}>
                {receiptHeader || (name || (ar ? 'كافيه مزاج فال' : 'My Cafe'))}
              </div>
              
              <div style={{ borderBottom: '1px dashed #78716c', margin: '8px 0' }} />
              
              {/* Order Details */}
              <div className="row-between xs" style={{ color: '#44403c', fontSize: '11px' }}>
                <span>{ar ? 'الطلب: #4859' : 'Order: #4859'}</span>
                <span>{new Date().toLocaleDateString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US')} {new Date().toLocaleTimeString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              
              {receiptShowCustomer && (
                <div style={{ color: '#44403c', fontSize: '11px', marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{ar ? 'العميل: أحمد' : 'Customer: Ahmad'}</span>
                  <span>050XXXXXXX</span>
                </div>
              )}
              
              <div style={{ borderBottom: '1px dashed #78716c', margin: '8px 0' }} />
              
              {/* Items list */}
              <div className="stack" style={{ gap: 4, marginBlock: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>2 x {ar ? 'كورتادو كولومبي' : 'Colombian Cortado'}</span>
                  <span className="num">30.00 {currency}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>1 x {ar ? 'كرواسون لوز دافئ' : 'Warm Almond Croissant'}</span>
                  <span className="num">14.00 {currency}</span>
                </div>
              </div>
              
              <div style={{ borderBottom: '1px dashed #78716c', margin: '8px 0' }} />
              
              {/* Totals */}
              <div className="stack" style={{ gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.92em', color: '#44403c' }}>
                  <span>{ar ? 'المجموع الفرعي' : 'Subtotal'}</span>
                  <span className="num">38.26 {currency}</span>
                </div>
                {receiptShowVat && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.92em', color: '#44403c' }}>
                    <span>{ar ? `الضريبة (${vatRate}%)` : `VAT (${vatRate}%)`}</span>
                    <span className="num">5.74 {currency}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '1.08em', marginTop: 4 }}>
                  <span>{ar ? 'المجموع الكلي' : 'TOTAL'}</span>
                  <span className="num">44.00 {currency}</span>
                </div>
              </div>
              
              <div style={{ borderBottom: '1px dashed #78716c', margin: '8px 0' }} />
              
              {/* Footer */}
              {receiptFooter && (
                <div style={{ textAlign: 'center', whiteSpace: 'pre-line', fontSize: '0.9em', color: '#44403c', marginTop: 4 }}>
                  {receiptFooter}
                </div>
              )}
              
              {/* Extra Note */}
              {receiptExtraNote && (
                <div style={{ textAlign: 'center', fontSize: '0.85em', color: '#78716c', marginTop: 8, fontStyle: 'italic' }}>
                  * {receiptExtraNote} *
                </div>
              )}
              
              {/* QR/Barcode */}
              {receiptShowBarcode && (
                <div className="center stack" style={{ marginTop: 14, gap: 4 }}>
                  <div style={{ width: 80, height: 80, background: '#f5f5f4', padding: 6, border: '1px solid #d6d3d1', display: 'grid', placeItems: 'center' }}>
                    <Icon name="qr" size={54} style={{ color: '#1c1917' }} />
                  </div>
                  <span style={{ fontSize: '9px', color: '#78716c', letterSpacing: 2 }}>* 4859 *</span>
                </div>
              )}
              
              {/* Jagged bottom edge effect */}
              <div style={{ position: 'absolute', bottom: -4, left: 0, right: 0, height: 6, background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, #ffffff 4px, #ffffff 8px)', filter: 'drop-shadow(0 2px 1px rgba(0,0,0,0.05))' }} />
            </div>
          </div>
        </div>
      )}

          {/* ============ CUSTOMERS & MARKETING ============ */}
          {tab === 'marketing' && (
            <div className="stack animate-fade-in" style={{ gap: 'var(--sp-4)' }}>
              <div className="card card-pad stack" id="set-loyalty" style={{ gap: 'var(--sp-3)' }}>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <Icon name="award" size={18} style={{ color: 'var(--brand)' }} />
                  <strong>{t('loyaltyProgram')}</strong>
                </div>
                
                <label className="row-between" style={{ cursor: 'pointer' }}>
                  <span className="small">{t('enableLoyalty')}</span>
                  <input type="checkbox" checked={loyaltyEnabled} onChange={(e) => setLoyaltyEnabled(e.target.checked)} style={{ width: 22, height: 22 }} />
                </label>
                {loyaltyEnabled && <div className="field"><label>{t('loyaltyEvery')}</label><input className="input num" type="number" value={loyaltyThreshold} onChange={(e) => setLoyaltyThreshold(e.target.value)} /></div>}

                {/* VIP Tiers Policy */}
                <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)' }}>
                  <label className="row-between" style={{ cursor: 'pointer' }}>
                    <span className="small bold"><Icon name="award" size={14} style={{ verticalAlign: 'middle', marginInlineEnd: 4 }} /> {ar ? 'عضوية VIP وعتبات النقاط' : 'VIP membership tiers'} <HelpTip topic="العضوية" /></span>
                    <input type="checkbox" checked={memEnabled} onChange={(e) => setMemEnabled(e.target.checked)} style={{ width: 22, height: 22 }} />
                  </label>
                  {memEnabled && (
                    <>
                      <p className="xs faint">{ar ? 'تُمنح العضوية تلقائياً عند تحقّق كل الشروط التالية:' : 'Auto-granted when all of these are met:'}</p>
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <div className="field grow" style={{ minWidth: 80 }}><label>{ar ? 'أدنى طلبات' : 'Min orders'}</label><input className="input num" type="number" value={memMinOrders} onChange={(e) => setMemMinOrders(e.target.value)} /></div>
                        <div className="field grow" style={{ minWidth: 80 }}><label>{ar ? 'أدنى إنفاق' : 'Min spent'}</label><input className="input num" type="number" value={memMinSpent} onChange={(e) => setMemMinSpent(e.target.value)} /></div>
                        <div className="field grow" style={{ minWidth: 80 }}><label>{ar ? 'متوسط السلة' : 'Avg basket'}</label><input className="input num" type="number" value={memMinAvg} onChange={(e) => setMemMinAvg(e.target.value)} /></div>
                      </div>
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <div className="field grow" style={{ minWidth: 120 }}><label>{ar ? 'نقاط لكل وحدة عملة' : 'Points per unit'}</label><input className="input num" type="number" value={memEarnRate} onChange={(e) => setMemEarnRate(e.target.value)} /></div>
                        <div className="field grow" style={{ minWidth: 120 }}><label>{ar ? 'نقاط لكل وحدة خصم' : 'Points per 1 off'}</label><input className="input num" type="number" value={memRedeemRate} onChange={(e) => setMemRedeemRate(e.target.value)} /></div>
                      </div>
                      {/* one-tap presets: most venues never need to touch the details below */}
                      <div className="stack" style={{ gap: 6, background: 'var(--brand-soft)', borderRadius: 'var(--r-md)', padding: 10 }}>
                        <span className="xs bold">{ar ? 'إعداد سريع بضغطة — ثم عدّل ما تشاء' : 'One-tap setup — tweak later if needed'}</span>
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-sm btn-outline" onClick={() => {
                            setMemMode('discounts'); setMemTierBy('orders'); setMemMinOrders(5)
                            setMemGoldMinOrders(10); setMemPlatMinOrders(15)
                            setMemSilverPct(5); setMemGoldPct(10); setMemPlatPct(15)
                            toast.success(ar ? 'جاهز: خصومات 5/10/15% بترقية 5/10/15 طلبات — اضغط حفظ' : 'Ready: 5/10/15% at 5/10/15 orders — press Save')
                          }}><Icon name="offers" size={14} /> {ar ? 'خصومات تلقائية (موصى به)' : 'Auto discounts (recommended)'}</button>
                          <button type="button" className="btn btn-sm btn-outline" onClick={() => {
                            setMemMode('perks'); setMemTierBy('orders'); setMemMinOrders(5)
                            setMemGoldMinOrders(10); setMemPlatMinOrders(15)
                            setMemPerks({ silver: { offers: true, featured: false, newItems: false }, gold: { offers: true, featured: true, newItems: false }, platinum: { offers: true, featured: true, newItems: true } })
                            toast.success(ar ? 'جاهز: امتيازات إشعارات بلا خصومات — اضغط حفظ' : 'Ready: notification perks, no discounts — press Save')
                          }}><Icon name="bellRing" size={14} /> {ar ? 'امتيازات بلا خصومات' : 'Perks, no discounts'}</button>
                        </div>
                        <span className="xs faint">{ar ? 'الخلاصة الحالية: ' : 'Current summary: '}
                          {memMode === 'perks'
                            ? (ar ? `امتيازات إشعارات · عضوية بعد ${memMinOrders || 5} طلبات · ذهبي ${memGoldMinOrders} · بلاتيني ${memPlatMinOrders}` : `Notification perks · member at ${memMinOrders || 5} orders · gold ${memGoldMinOrders} · platinum ${memPlatMinOrders}`)
                            : (ar ? `خصومات ${memSilverPct}/${memGoldPct}/${memPlatPct}% · ${memTierBy === 'orders' ? `ترقية بالطلبات ${memMinOrders || 5}/${memGoldMinOrders}/${memPlatMinOrders}` : 'ترقية بالنقاط'}` : `${memSilverPct}/${memGoldPct}/${memPlatPct}% discounts`)}
                        </span>
                      </div>

                      {/* the venue's LOYALTY POLICY — discounts or privileged notifications */}
                      <div className="field">
                        <label>{ar ? 'نوع الولاء — ماذا يكسب أعضاؤك؟' : 'Loyalty type — what do members get?'}</label>
                        <select className="select" value={memMode} onChange={(e) => setMemMode(e.target.value)}>
                          <option value="discounts">{ar ? 'ولاء الخصومات — خصم دائم حسب المستوى' : 'Discount loyalty — standing tier discounts'}</option>
                          <option value="perks">{ar ? 'ولاء الامتيازات — إشعارات حصرية بالجديد (بلا خصومات)' : 'Perks loyalty — exclusive alerts (no discounts)'}</option>
                        </select>
                        {memMode === 'perks' && <p className="xs faint" style={{ margin: '4px 0 0' }}>{ar ? 'لا خصومات — أعضاؤك يحصلون على أسبقية المعرفة: إشعارات واتساب تلقائية بالعروض والأصناف المميزة والجديدة حسب مستواهم (المصفوفة أدناه).' : 'No discounts — members get first-to-know privileges: automatic WhatsApp alerts for offers, featured and new items per tier (matrix below).'}</p>}
                      </div>
                      <div className="field">
                        <label>{ar ? 'ما الذي يرقّي العضو؟' : 'What promotes a member?'}</label>
                        <select className="select" value={memTierBy} onChange={(e) => setMemTierBy(e.target.value)}>
                          <option value="orders">{ar ? 'عدد الطلبات المكتملة (موصى به)' : 'Completed orders (recommended)'}</option>
                          <option value="points">{ar ? 'النقاط التراكمية' : 'Lifetime points'}</option>
                        </select>
                        {memTierBy === 'orders' && <p className="xs faint" style={{ margin: '4px 0 0' }}>{ar ? `العميل يُمنح العضوية (فضي) بعد ${memMinOrders || 5} طلبات، ثم يترقّى تلقائياً حسب العتبات أدناه.` : `Membership (Silver) is granted after ${memMinOrders || 5} orders, then auto-promotes at the thresholds below.`}</p>}
                      </div>
                      <span className="xs faint">{memTierBy === 'orders' ? (memMode === 'perks' ? (ar ? 'المستويات (أدنى طلبات مكتملة)' : 'Tiers (min completed orders)') : (ar ? 'المستويات (أدنى طلبات مكتملة · نسبة الخصم %)' : 'Tiers (min completed orders · discount %)')) : (ar ? 'المستويات (أدنى نقاط · نسبة الخصم %)' : 'Tiers (min points · discount %)')}</span>
                      <div className="row" style={{ gap: 6, alignItems: 'center' }}><span className="small" style={{ width: 70, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="award" size={12} /> {ar ? 'فضي' : 'Silver'}</span><span className="xs faint grow">{memTierBy === 'orders' ? (ar ? 'مع منح العضوية' : 'on grant') : '0'}</span>{memMode !== 'perks' && <><input className="input num" style={{ width: 64 }} type="number" value={memSilverPct} onChange={(e) => setMemSilverPct(e.target.value)} /><span className="xs faint">%</span></>}</div>
                      <div className="row" style={{ gap: 6, alignItems: 'center' }}><span className="small" style={{ width: 70, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="award" size={12} style={{ color: 'var(--gold, #e0a82e)' }} /> {ar ? 'ذهبي' : 'Gold'}</span>{memTierBy === 'orders' ? <input className="input num grow" type="number" value={memGoldMinOrders} onChange={(e) => setMemGoldMinOrders(e.target.value)} /> : <input className="input num grow" type="number" value={memGoldMin} onChange={(e) => setMemGoldMin(e.target.value)} />}{memMode !== 'perks' && <><input className="input num" style={{ width: 64 }} type="number" value={memGoldPct} onChange={(e) => setMemGoldPct(e.target.value)} /><span className="xs faint">%</span></>}</div>
                      <div className="row" style={{ gap: 6, alignItems: 'center' }}><span className="small" style={{ width: 70, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="award" size={12} style={{ color: '#7db3c9' }} /> {ar ? 'بلاتيني' : 'Platinum'}</span>{memTierBy === 'orders' ? <input className="input num grow" type="number" value={memPlatMinOrders} onChange={(e) => setMemPlatMinOrders(e.target.value)} /> : <input className="input num grow" type="number" value={memPlatMin} onChange={(e) => setMemPlatMin(e.target.value)} />}{memMode !== 'perks' && <><input className="input num" style={{ width: 64 }} type="number" value={memPlatPct} onChange={(e) => setMemPlatPct(e.target.value)} /><span className="xs faint">%</span></>}</div>

                      {/* perks matrix — which alerts each tier unlocks (auto-sent by the server) */}
                      {memMode === 'perks' && (
                        <div className="stack" style={{ gap: 6, background: 'var(--surface-2)', borderRadius: 'var(--r-md)', padding: 10 }}>
                          <span className="xs bold">{ar ? 'امتيازات كل مستوى — تُرسل واتساب تلقائياً + إشعار منيو' : 'Per-tier privileges — auto WhatsApp + menu notice'}</span>
                          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                            <span className="xs faint" style={{ width: 70 }} />
                            <span className="xs faint grow" style={{ textAlign: 'center' }}>{ar ? 'العروض' : 'Offers'}</span>
                            <span className="xs faint grow" style={{ textAlign: 'center' }}>{ar ? 'الأصناف المميزة' : 'Featured'}</span>
                            <span className="xs faint grow" style={{ textAlign: 'center' }}>{ar ? 'الأصناف الجديدة' : 'New items'}</span>
                          </div>
                          {['silver', 'gold', 'platinum'].map((tr) => (
                            <div key={tr} className="row" style={{ gap: 6, alignItems: 'center' }}>
                              <span className="small" style={{ width: 70, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="award" size={12} style={{ color: { silver: undefined, gold: 'var(--gold, #e0a82e)', platinum: '#7db3c9' }[tr] }} /> {ar ? ({ silver: 'فضي', gold: 'ذهبي', platinum: 'بلاتيني' }[tr]) : tr}</span>
                              {['offers', 'featured', 'newItems'].map((k) => (
                                <span key={k} className="grow" style={{ textAlign: 'center' }}>
                                  <input type="checkbox" checked={!!memPerks[tr][k]} onChange={(e) => setPerk(tr, k, e.target.checked)} style={{ width: 20, height: 20 }} />
                                </span>
                              ))}
                            </div>
                          ))}
                          <span className="xs faint">{ar ? 'مثال: البلاتيني يعرف بكل جديد أولاً؛ الفضي بالعروض فقط. الإرسال يتم تلقائياً لحظة نشر العرض أو تمييز الصنف.' : 'e.g. Platinum knows everything first; Silver gets offers only. Sent the moment an offer/star goes live.'}</span>
                        </div>
                      )}
                      {/* rarely-touched knobs live behind one collapsible row */}
                      <details>
                        <summary className="small bold" style={{ cursor: 'pointer' }}>{ar ? 'خيارات متقدمة (النقاط والمكافآت)' : 'Advanced (points & bonuses)'}</summary>
                        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                            <div className="field grow" style={{ minWidth: 150 }}><label>{ar ? 'انتهاء النقاط (يوم خمول) — 0=لا' : 'Expire (idle days) — 0=never'}</label><input className="input num" type="number" value={memExpiry} onChange={(e) => setMemExpiry(e.target.value)} /></div>
                            <div className="field" style={{ width: 100 }}><label>{ar ? 'مضاعف النقاط' : 'Points ×'}</label><input className="input num" type="number" step="0.5" value={memMultiplier} onChange={(e) => setMemMultiplier(e.target.value)} /></div>
                          </div>
                          <div className="field"><label>{ar ? 'مكافأة عيد الميلاد (نقاط) — مع تهنئة واتساب تلقائية' : 'Birthday bonus (points) — with auto WhatsApp greeting'}</label><input className="input num" type="number" value={memBday} onChange={(e) => setMemBday(e.target.value)} /></div>
                        </div>
                      </details>
                      {memMode !== 'perks' && (
                        <>
                          <label className="row-between" style={{ cursor: 'pointer' }}>
                            <span className="small">{ar ? 'تطبيق خصم العضوية ذاتياً من المنيو' : 'Self-apply member discount from menu'}</span>
                            <input type="checkbox" checked={memSelfDiscount} onChange={(e) => setMemSelfDiscount(e.target.checked)} style={{ width: 22, height: 22 }} />
                          </label>
                          {!memSelfDiscount && <p className="xs faint">{ar ? 'سيُطبّق الخصم فقط عند مسح الموظف لبطاقة العضو (يمنع مشاركة الرابط).' : 'Discount applies only when staff scan the card (prevents link sharing).'}</p>}
                        </>
                      )}

                      {/* ===== luxury card designer — live preview + instant save ===== */}
                      <div className="stack" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)' }}>
                        <strong className="small"><Icon name="palette" size={14} style={{ verticalAlign: 'middle', marginInlineEnd: 4 }} /> {ar ? 'تصميم بطاقة العضوية' : 'Membership card design'}</strong>
                        <div style={{ maxWidth: 380 }}>
                          <VipCard
                            tenant={{ ...tenant, memberCardDesign: tenant?.memberCardDesign || {} }}
                            card={{ name: ar ? 'عبدالله محمد' : 'Abdullah M.', memberId: 'NEM-4F7K2A', tier: vipPreviewTier, discountPct: { silver: Number(memSilverPct) || 5, gold: Number(memGoldPct) || 10, platinum: Number(memPlatPct) || 15 }[vipPreviewTier] }}
                            lang={lang}
                          />
                        </div>
                        <div className="row" style={{ gap: 6 }}>
                          {['silver', 'gold', 'platinum'].map((tr) => (
                            <button key={tr} type="button" className={`btn btn-sm ${vipPreviewTier === tr ? 'btn-primary' : 'btn-outline'}`} onClick={() => setVipPreviewTier(tr)}>
                              {ar ? ({ silver: 'فضي', gold: 'ذهبي', platinum: 'بلاتيني' }[tr]) : tr}
                            </button>
                          ))}
                        </div>
                        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <div className="field grow" style={{ minWidth: 150 }}>
                            <label>{ar ? 'قالب البطاقة' : 'Card template'}</label>
                            <select className="select" value={tenant?.memberCardDesign?.template || 'metal'}
                              onChange={async (e) => { const d = { ...(tenant?.memberCardDesign || {}), template: e.target.value }; try { await saveNow({ memberCardDesign: d }); updateTenantLocal({ memberCardDesign: d }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }}>
                              <option value="metal">{ar ? 'معدني فاخر (حسب المستوى)' : 'Luxury metal (per tier)'}</option>
                              <option value="glass">{ar ? 'زجاجي بلون هويتك' : 'Brand glass'}</option>
                              <option value="noir">{ar ? 'أسود وذهب' : 'Noir & gold'}</option>
                            </select>
                          </div>
                          <label className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'center', alignSelf: 'flex-end', paddingBottom: 10 }}>
                            <input type="checkbox" checked={tenant?.memberCardDesign?.showLogo !== false}
                              onChange={async (e) => { const d = { ...(tenant?.memberCardDesign || {}), showLogo: e.target.checked }; try { await saveNow({ memberCardDesign: d }); updateTenantLocal({ memberCardDesign: d }) } catch (_) { toast.error(t('error')) } }} style={{ width: 20, height: 20 }} />
                            <span className="small">{ar ? 'إظهار الشعار' : 'Show logo'}</span>
                          </label>
                        </div>
                        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
                            {vipBgBusy ? (ar ? 'جارٍ الرفع…' : 'Uploading…') : (ar ? 'صورة خلفية للبطاقة' : 'Card background photo')}
                            <input type="file" accept="image/*" hidden disabled={vipBgBusy} onChange={async (e) => {
                              const f = e.target.files?.[0]; e.target.value = ''
                              if (!f) return
                              setVipBgBusy(true)
                              try {
                                const small = await shrinkImage(f, 1200, 0.85).catch(() => f)
                                const url = await uploadImage(tenantId, new File([small], 'vipcard.webp', { type: small.type || 'image/webp' }), 'branding')
                                const d = { ...(tenant?.memberCardDesign || {}), bgUrl: url }
                                await saveNow({ memberCardDesign: d }); updateTenantLocal({ memberCardDesign: d }); toast.success(t('saved'))
                              } catch (_) { toast.error(t('error')) } finally { setVipBgBusy(false) }
                            }} />
                          </label>
                          {tenant?.memberCardDesign?.bgUrl && (
                            <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }}
                              onClick={async () => { const d = { ...(tenant?.memberCardDesign || {}), bgUrl: '' }; try { await saveNow({ memberCardDesign: d }); updateTenantLocal({ memberCardDesign: d }) } catch (_) { toast.error(t('error')) } }}>
                              {ar ? 'إزالة الخلفية' : 'Remove photo'}
                            </button>
                          )}
                          <span className="xs faint">{ar ? 'التغييرات تُحفظ فوراً وتظهر لكل الأعضاء.' : 'Saved instantly — visible to every member.'}</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Customer notifications (WhatsApp order updates + invoice link).
                  Moved out of the technical-gateways card: this is customer
                  communication, not plumbing. */}
              <div className="card card-pad stack" id="set-notify" style={{ gap: 10 }}>
                <strong className="row" style={{ gap: 6 }}><Icon name="bellRing" size={16} /> {ar ? 'إشعارات العميل التلقائية' : 'Customer notifications'}</strong>
                <p className="xs faint">{ar ? 'إشعار العميل تلقائياً بحالة طلبه وإرسال رابط فاتورته عبر واتساب/الإيميل (يتطلّب تفعيل المزوّد لدى المنصة).' : 'Auto-notify the customer of order status + invoice link via WhatsApp/Email.'}</p>
                <label className="row-between" style={{ cursor: 'pointer' }}>
                  <span className="small">{ar ? 'إشعارات واتساب' : 'WhatsApp updates'}</span>
                  <input type="checkbox" checked={notifyWa} onChange={(e) => setNotifyWa(e.target.checked)} style={{ width: 22, height: 22 }} />
                </label>
                <label className="row-between" style={{ cursor: 'pointer' }}>
                  <span className="small">{ar ? 'إشعارات الإيميل (إن توفّر إيميل العميل)' : 'Email updates (if a customer email is present)'}</span>
                  <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} style={{ width: 22, height: 22 }} />
                </label>
                <p className="xs faint" style={{ margin: 0 }}>{ar ? 'قوالب الرسائل ورقم الواتساب الخاص بالمنشأة تُدار من صفحة الرسائل والقوالب، لا من هنا.' : 'Message templates and the venue WhatsApp number are managed on the messaging page, not here.'}</p>
              </div>

              {/* Guest-behaviour tracking — a reporting switch, so it sits with the
                  customer/marketing settings instead of the interactive features. */}
              <div className="card card-pad stack" id="set-analytics" style={{ gap: 10 }}>
                <div className="row-between wrap" style={{ gap: 10 }}>
                  <div>
                    <div className="small bold row" style={{ gap: 6 }}><Icon name="chartBar" size={16} /> {ar ? 'تتبّع سلوك الزوار' : 'Guest behaviour tracking'}</div>
                    <div className="xs faint">{ar ? 'يغذّي صفحة «سلوك العملاء» والمخطِّط الذكي — بلا تتبع أي نص يكتبه الزائر عدا البحث' : 'Feeds the behaviour page and AI planner'}</div>
                  </div>
                  <input type="checkbox" checked={tenant?.analyticsEnabled !== false} style={{ width: 22, height: 22 }}
                    onChange={async (e) => { try { await saveNow({ analyticsEnabled: e.target.checked }); updateTenantLocal({ analyticsEnabled: e.target.checked }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }} />
                </div>
                <p className="xs faint" style={{ margin: 0 }}>{ar ? 'يُحفظ فور التبديل — التقارير المبنية عليه تتوقف عن التجميع فور الإيقاف.' : 'Saved on toggle — the reports built on it stop collecting the moment it is off.'}</p>
              </div>
            </div>
          )}

          {/* ============ FINANCE & VAT ============ */}
          {tab === 'finance' && (
            <div className="stack animate-fade-in" style={{ gap: 'var(--sp-4)' }}>
              {/* Tax / VAT Settings */}
              <div className="card card-pad stack" id="set-vat" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <Icon name="cashier" size={18} style={{ color: 'var(--brand)' }} />
                  <strong><Icon name="reports" size={16} style={{ verticalAlign: 'middle' }} /> {ar ? 'ضريبة القيمة المضافة (ZATCA)' : 'VAT (ZATCA)'}</strong>
                </div>
                <label className="row-between" style={{ cursor: 'pointer', marginTop: 4 }}>
                  <span className="small">{ar ? 'تمكين حساب الضريبة بالفاتورة' : 'Enable Tax Calculation'}</span>
                  <input type="checkbox" checked={vatEnabled} onChange={(e) => setVatEnabled(e.target.checked)} style={{ width: 22, height: 22 }} />
                </label>
                {vatEnabled && (
                  <>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <div className="field" style={{ width: 100 }}><label>{ar ? 'النسبة %' : 'Rate %'}</label><input className="input num" type="number" value={vatRate} onChange={(e) => setVatRate(e.target.value)} /></div>
                      <div className="field grow" style={{ minWidth: 150 }}><label>{ar ? 'الرقم الضريبي للمنشأة' : 'VAT number'}</label><input className="input num" dir="ltr" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} placeholder="3001234567890003" /></div>
                    </div>
                    <p className="xs faint">{ar ? 'الأسعار شاملة الضريبة؛ تظهر الضريبة في الفاتورة مع رمز ZATCA QR عند إدخال الرقم الضريبي.' : 'Prices are VAT-inclusive; VAT + ZATCA QR show on the invoice once a VAT number is set.'}</p>
                  </>
                )}
                <p className="xs faint" style={{ margin: 0 }}>{ar ? 'شكل الإيصال المطبوع نفسه (الترويسة والتذييل وما يظهر فيه) في قسم «تصميم الفاتورة».' : 'The printed receipt itself is designed in the Receipt designer section.'}</p>
              </div>
            </div>
          )}

          {/* Curbside + Delivery are ORDER TYPES, so they live with operations
              (they used to sit under the VAT/municipal sub-tab). */}
          {tab === 'ops' && (
            <div className="stack animate-fade-in" style={{ gap: 'var(--sp-4)' }}>
              {/* Curbside pickup */}
              <div className="card card-pad stack" id="set-curbside">
                <label className="row-between" style={{ cursor: 'pointer' }}>
                  <span className="small bold row" style={{ gap: 6 }}><Icon name="car" size={16} /> {t('curbside')}</span>
                  <input type="checkbox" checked={curbsideEnabled} onChange={(e) => setCurbsideEnabled(e.target.checked)} style={{ width: 22, height: 22 }} />
                </label>
                <p className="xs faint" style={{ marginTop: 4 }}>{ar ? 'تسمح للعملاء بطلب المنتجات والتحضير للتوصيل لسياراتهم خارج المقهى.' : 'Allows customers to request curbside delivery to their cars.'}</p>
              </div>

              {/* Delivery — adds a Delivery order type to the menu (address + fee) */}
              <div className="card card-pad stack" id="set-delivery" style={{ gap: 10 }}>
                <label className="row-between" style={{ cursor: 'pointer' }}>
                  <span className="small bold row" style={{ gap: 6 }}><Icon name="car" size={16} /> {ar ? 'التوصيل' : 'Delivery'}</span>
                  <input type="checkbox" checked={tenant?.delivery?.enabled === true} onChange={async (e) => { const next = { ...(tenant?.delivery || {}), enabled: e.target.checked }; try { await saveNow({ delivery: next }); updateTenantLocal({ delivery: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }} style={{ width: 22, height: 22 }} />
                </label>
                <p className="xs faint" style={{ margin: 0 }}>{ar ? 'يظهر «توصيل» كنوع طلب في المنيو، ويطلب عنوان العميل ويضيف رسوم التوصيل للفاتورة.' : 'Adds a Delivery order type: captures the customer address and adds the fee.'}</p>
                {tenant?.delivery?.enabled && (
                  <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <div className="field" style={{ minWidth: 110, marginBottom: 0 }}><label>{ar ? 'رسوم التوصيل' : 'Delivery fee'}</label><input className="input num" type="number" min="0" value={tenant?.delivery?.fee ?? 0} onChange={(e) => { const next = { ...(tenant?.delivery || {}), fee: Number(e.target.value) || 0 }; updateTenantLocal({ delivery: next }); commitPosBg({ delivery: next }) }} /></div>
                    <div className="field" style={{ minWidth: 110, marginBottom: 0 }}><label>{ar ? 'الحد الأدنى' : 'Min order'}</label><input className="input num" type="number" min="0" value={tenant?.delivery?.minOrder ?? 0} onChange={(e) => { const next = { ...(tenant?.delivery || {}), minOrder: Number(e.target.value) || 0 }; updateTenantLocal({ delivery: next }); commitPosBg({ delivery: next }) }} /></div>
                    <div className="field" style={{ minWidth: 110, marginBottom: 0 }}><label>{ar ? 'مجاني فوق' : 'Free above'}</label><input className="input num" type="number" min="0" value={tenant?.delivery?.freeAbove ?? 0} onChange={(e) => { const next = { ...(tenant?.delivery || {}), freeAbove: Number(e.target.value) || 0 }; updateTenantLocal({ delivery: next }); commitPosBg({ delivery: next }) }} /></div>
                    <div className="field" style={{ minWidth: 110, marginBottom: 0 }}><label>{ar ? 'نطاق التوصيل (كم)' : 'Delivery radius (km)'}</label><input className="input num" type="number" min="0" value={tenant?.delivery?.radiusKm ?? 0} onChange={(e) => { const next = { ...(tenant?.delivery || {}), radiusKm: Number(e.target.value) || 0 }; updateTenantLocal({ delivery: next }); commitPosBg({ delivery: next }) }} /></div>
                  </div>
                )}
                {tenant?.delivery?.enabled && (
                  <div className="stack" style={{ gap: 6 }}>
                    <div className="row-between">
                      <span className="small bold">{ar ? 'مناطق التوصيل بالمسافة' : 'Distance zones'}</span>
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => { const zones = [...(tenant?.delivery?.zones || []), { maxKm: 0, fee: 0 }]; const next = { ...(tenant?.delivery || {}), zones }; updateTenantLocal({ delivery: next }); commitPosBg({ delivery: next }) }}><Icon name="add" size={13} /> {ar ? 'منطقة' : 'Zone'}</button>
                    </div>
                    {(tenant?.delivery?.zones || []).map((z, i) => (
                      <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                        <div className="field" style={{ width: 120, marginBottom: 0 }}><label>{ar ? 'حتى (كم)' : 'Up to (km)'}</label><input className="input num" type="number" min="0" value={z.maxKm ?? 0} onChange={(e) => { const zones = (tenant?.delivery?.zones || []).map((x, j) => j === i ? { ...x, maxKm: Number(e.target.value) || 0 } : x); const next = { ...(tenant?.delivery || {}), zones }; updateTenantLocal({ delivery: next }); commitPosBg({ delivery: next }) }} /></div>
                        <div className="field grow" style={{ minWidth: 100, marginBottom: 0 }}><label>{ar ? 'الرسوم' : 'Fee'}</label><input className="input num" type="number" min="0" value={z.fee ?? 0} onChange={(e) => { const zones = (tenant?.delivery?.zones || []).map((x, j) => j === i ? { ...x, fee: Number(e.target.value) || 0 } : x); const next = { ...(tenant?.delivery || {}), zones }; updateTenantLocal({ delivery: next }); commitPosBg({ delivery: next }) }} /></div>
                        <button type="button" className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => { const zones = (tenant?.delivery?.zones || []).filter((_, j) => j !== i); const next = { ...(tenant?.delivery || {}), zones }; updateTenantLocal({ delivery: next }); commitPosBg({ delivery: next }) }}><Icon name="delete" size={15} /></button>
                      </div>
                    ))}
                    <p className="xs faint" style={{ margin: 0 }}>{ar ? 'إن حدّدت مناطق، تُحسب الرسوم حسب مسافة العميل (تتجاوز الرسم الثابت) ويُمنع الطلب خارج أبعد منطقة. يحتاج موقع المقهى محدّداً أعلاه.' : 'If zones are set, the fee follows the customer distance (overrides the flat fee) and orders beyond the farthest zone are blocked. Needs the venue location.'}</p>
                    {/* Map alternative: venue pin + delivery circles drawn live (zones when set, else the flat radius) */}
                    <details>
                      <summary className="small bold" style={{ cursor: 'pointer', listStyle: 'none' }}><Icon name="pin" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'التحديد على الخريطة (الموقع + النطاقات)' : 'Pick on map (location + zones)'}</summary>
                      <Suspense fallback={<span className="xs faint">{ar ? 'تحميل الخريطة…' : 'Loading map…'}</span>}>
                        <div style={{ marginTop: 8 }}>
                          <MapRangePicker
                            mode={(tenant?.delivery?.zones || []).length ? 'zones' : 'radius'} unit="km" height={280}
                            center={tenant?.geo || null}
                            onCenter={(c) => { updateTenantLocal({ geo: c }); commitPosBg({ geo: c }) }}
                            radius={Number(tenant?.delivery?.radiusKm) || 5}
                            onRadius={(n) => { const next = { ...(tenant?.delivery || {}), radiusKm: Number(n) || 0 }; updateTenantLocal({ delivery: next }); commitPosBg({ delivery: next }) }}
                            zones={tenant?.delivery?.zones || []}
                            onZones={(zones) => { const next = { ...(tenant?.delivery || {}), zones }; updateTenantLocal({ delivery: next }); commitPosBg({ delivery: next }) }} />
                        </div>
                      </Suspense>
                    </details>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============ FINANCE — subscription, online payment, tips ============ */}
          {tab === 'finance' && (
            <div className="stack animate-fade-in" style={{ gap: 'var(--sp-4)' }}>
              <div id="set-subscription"><SubscriptionCard tenant={tenant} tenantId={tenantId} /></div>
              {/* Online payment (Moyasar) */}
              <div className="card card-pad stack" id="set-pay" style={{ gap: 8 }}>
                <label className="row-between" style={{ cursor: 'pointer' }}>
                  <span className="small bold row" style={{ gap: 6 }}><Icon name="wallet" size={16} /> {ar ? 'الدفع الإلكتروني (Moyasar)' : 'Online payment (Moyasar)'}</span>
                  <input type="checkbox" checked={tenant?.onlinePayment?.enabled === true} onChange={async (e) => { const next = { ...(tenant?.onlinePayment || {}), enabled: e.target.checked }; try { await saveNow({ onlinePayment: next }); updateTenantLocal({ onlinePayment: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }} style={{ width: 22, height: 22 }} />
                </label>
                <p className="xs faint" style={{ margin: 0 }}>{ar ? 'يضيف خيار «ادفع أونلاين» (مدى/بطاقة عبر Moyasar) للطلبات في المنيو. يتطلّب حساب Moyasar تاجر مُفعَّل ونشر الدوال.' : 'Adds a “pay online” option (mada/card via Moyasar) to menu orders. Requires an active Moyasar merchant account + deployed functions.'}</p>
                {tenant?.onlinePayment?.enabled && (
                  <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <div className="field" style={{ width: 190, marginBottom: 0 }}><label>{ar ? 'عربون الحجز (0 = بلا)' : 'Reservation deposit (0 = none)'}</label><input className="input num" type="number" min="0" value={tenant?.reservationDeposit ?? 0} onChange={(e) => { const v = Number(e.target.value) || 0; updateTenantLocal({ reservationDeposit: v }); commitPosBg({ reservationDeposit: v }) }} /></div>
                    <span className="xs faint" style={{ alignSelf: 'center' }}>{ar ? 'يُطلب من العميل عند حجز مناسبة، ويُؤكَّد الحجز فور الدفع.' : 'Charged when a guest books an occasion; confirms on payment.'}</span>
                  </div>
                )}
              </div>
              {/* Tipping (gratuity) */}
              <div className="card card-pad stack" id="set-tips" style={{ gap: 8 }}>
                <label className="row-between" style={{ cursor: 'pointer' }}>
                  <span className="small bold row" style={{ gap: 6 }}><Icon name="heart" size={16} /> {ar ? 'الإكرامية (Tips)' : 'Tips (gratuity)'}</span>
                  <input type="checkbox" checked={tenant?.tipsEnabled === true} onChange={async (e) => { try { await saveNow({ tipsEnabled: e.target.checked }); updateTenantLocal({ tipsEnabled: e.target.checked }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }} style={{ width: 22, height: 22 }} />
                </label>
                <p className="xs faint" style={{ margin: 0 }}>{ar ? 'يُظهر خيار إكرامية اختياري (نسب سريعة) في سلة المنيو، ويُضاف للإجمالي ويظهر للكاشير وفي الفاتورة.' : 'Shows an optional tip (quick percentages) in the menu cart; it is added to the total and shown to the cashier and on the receipt.'}</p>
              </div>
            </div>
          )}

          {/* ============ INTEGRATIONS & DOMAINS ============ */}
          {tab === 'connect' && (
            <div className="stack animate-fade-in" style={{ gap: 'var(--sp-4)' }}>
              <div id="set-domain"><CustomDomainCard tenant={tenant} tenantId={tenantId} /></div>
              {/* Ready-made Technical External Integrations */}
              <div className="card card-pad stack" id="set-gateways" style={{ gap: 12 }}>
                <span className="small bold row" style={{ gap: 6 }}><Icon name="settings" size={16} /> {ar ? 'الربط الفني الفوري والجاهز' : 'Preconfigured Integrations'}</span>
                <p className="xs faint">{ar ? 'ربط المقاهي بأجهزة نقاط البيع والأنظمة المحاسبية المعتمدة تلقائياً.' : 'Connect your cafe to POS payment devices and certified accounting software.'}</p>
                
                {/* Payment machine */}
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <div className="field grow" style={{ minWidth: 150 }}>
                    <label>{ar ? 'جهاز نقاط البيع (Payment Terminal)' : 'POS Payment Terminal'}</label>
                    <select className="select" value={payGateway} onChange={(e) => setPayGateway(e.target.value)}>
                      <option value="none">{ar ? 'تعطيل / بدون ربط' : 'Disabled'}</option>
                      <option value="geidea">Geidea (جيديّـا)</option>
                      <option value="paytabs">PayTabs (بي تابس)</option>
                      <option value="local">{ar ? 'جهاز محلي (Local IP)' : 'Local Terminal'}</option>
                    </select>
                  </div>
                  {payGateway !== 'none' && (
                    <div className="field grow" style={{ minWidth: 150 }}>
                      <label>{ar ? 'معرّف الجهاز أو مفتاح API' : 'Terminal ID / API Key'}</label>
                      <input className="input num" value={payApiKey} onChange={(e) => setPayApiKey(e.target.value)} placeholder="T-102930 / sk_live_..." />
                    </div>
                  )}
                </div>

                {/* Accounting systems */}
                <div className="field">
                  <label>{ar ? 'النظام المحاسبي المربوط' : 'Linked Accounting System'}</label>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <select className="select grow" style={{ minWidth: 150 }} value={accountingSystem} onChange={(e) => setAccountingSystem(e.target.value)}>
                      <option value="none">{ar ? 'لا يوجد ربط حالي' : 'Not Connected'}</option>
                      <option value="quickbooks">QuickBooks Books</option>
                      <option value="zoho">Zoho Books</option>
                      <option value="xero">Xero Accounting</option>
                    </select>
                    {accountingSystem !== 'none' && (
                      /* honest state: the OAuth link isn't wired yet — never fake a success */
                      <span className="badge" style={{ whiteSpace: 'nowrap' }}>{ar ? 'الربط قريباً' : 'Coming soon'}</span>
                    )}
                  </div>
                </div>

                {/* SMS Gateways */}
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <div className="field grow" style={{ minWidth: 150 }}>
                    <label>{ar ? 'بوابة إرسال الرسائل (SMS Gateway)' : 'SMS Gateway'}</label>
                    <select className="select" value={smsGateway} onChange={(e) => setSmsGateway(e.target.value)}>
                      <option value="none">{ar ? 'تعطيل رسائل الولاء' : 'Disabled'}</option>
                      <option value="twilio">Twilio SMS</option>
                      <option value="unifonic">Unifonic (يونيفونيك)</option>
                    </select>
                  </div>
                  {smsGateway !== 'none' && (
                    <div className="field grow" style={{ minWidth: 150 }}>
                      <label>{ar ? 'مفتاح بوابة الرسائل API Key' : 'API Key'}</label>
                      <input className="input num" type="password" value={smsApiKey} onChange={(e) => setSmsApiKey(e.target.value)} placeholder="••••••••••••••••" />
                    </div>
                  )}
                </div>

                {smsGateway !== 'none' && (
                  <div className="field">
                    <label>{ar ? 'قالب رسائل التنبيهات (WhatsApp/SMS)' : 'Order WhatsApp/SMS Template'}</label>
                    <input className="input" value={smsTemplate} onChange={(e) => setSmsTemplate(e.target.value)} placeholder={ar ? "طلبك رقم {order} جاهز للاستلام من {brand}!" : "Your order #{order} is ready at {brand}!"} />
                    <span className="xs faint">{ar ? 'المتغيرات المتاحة: {order} لرمز الطلب، {brand} لاسم الكافيه.' : 'Variables available: {order} for code, {brand} for name.'}</span>
                  </div>
                )}

                <p className="xs faint" style={{ margin: 0 }}>{ar ? 'إشعارات العميل نفسها (واتساب/الإيميل) تُفعَّل من قسم «العملاء والتسويق».' : 'The customer-facing WhatsApp/email notifications are switched on in Customers & marketing.'}</p>
              </div>

              {/* Developer Custom Webhook Integration for Unregistered Systems */}
              <div className="card card-pad stack" id="set-webhook" style={{ gap: 12 }}>
                <div className="row-between">
                  <span className="small bold row" style={{ gap: 6 }}><Icon name="code" size={16} style={{ color: 'var(--brand)' }} /> {ar ? 'طلب ربط مخصص (Custom API / Webhook)' : 'Custom API / Webhook Integration'}</span>
                  <input type="checkbox" checked={customWebhookEnabled} onChange={(e) => setCustomWebhookEnabled(e.target.checked)} style={{ width: 20, height: 20 }} />
                </div>
                <p className="xs faint">
                  {ar 
                    ? 'هل تستخدم نظاماً محاسبياً أو تشغيلياً آخر (مثل Odoo, ERP, أو نظام مبيعات خاص بك)؟ فعّل خيار الـ Webhook لبث بيانات الفواتير والطلبات لحظياً لأي سيرفر تختاره.' 
                    : 'Integrating with custom systems like Odoo or a custom ERP? Enable custom Webhook to push paid invoices and status updates instantly.'}
                </p>
                {customWebhookEnabled && (
                  <div className="stack animate-fade-in" style={{ gap: 8 }}>
                    <div className="field">
                      <label>{ar ? 'رابط استقبال البيانات (Webhook Endpoint URL)' : 'Webhook Endpoint URL'}</label>
                      <input className="input" dir="ltr" value={customWebhookUrl} onChange={(e) => setCustomWebhookUrl(e.target.value)} placeholder="https://my-system.com/api/webhook" />
                    </div>
                    <div className="field">
                      <label>{ar ? 'رمز المصادقة السري (Auth Token / Header Key)' : 'Secret Authorization Token'}</label>
                      <input className="input num" dir="ltr" type="password" value={customWebhookToken} onChange={(e) => setCustomWebhookToken(e.target.value)} placeholder="Secret Bearer Token or API Key" />
                    </div>
                    <div className="stack" style={{ gap: 4, background: 'var(--surface-2)', padding: 8, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                      <strong className="xs muted">{ar ? 'الأحداث الصادرة تلقائياً:' : 'Triggered Webhook Events:'}</strong>
                      <span className="xs" style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={11} /> `order.paid` ({ar ? 'عند دفع الفواتير' : 'When invoice paid'})</span>
                      <span className="xs" style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={11} /> `inventory.low` ({ar ? 'تنبيهات نقص المخزون' : 'Low stock alerts'})</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---- ONE Save for every section that still holds draft fields ----
              save() writes the whole settings patch (it always did), so pressing
              Save anywhere commits every pending edit — not only this section's.
              The studio and the receipt designer keep their own Save inside their
              two-column layout, next to the live preview they belong to. */}
          {secMeta?.save && (
            <>
              <button className="btn btn-primary btn-block btn-lg" onClick={save} disabled={busy}>{busy ? t('saving') : t('save')}</button>
              {lastSavedAt && (
                <span className="set-saved">
                  {ar ? 'آخر حفظ ' : 'Last saved '}
                  <span className="num">{lastSavedAt.toLocaleTimeString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                </span>
              )}
            </>
          )}
          {/* honest: these sections have no Save because nothing here is a draft */}
          {secMeta?.instant && (
            <div className="set-instant">
              <Icon name="check" size={14} style={{ flex: 'none' }} />
              <span>{ar ? 'كل مفتاح في هذا القسم يُحفظ لحظة تغييره — لا حاجة لزر حفظ.' : 'Every switch in this section saves the moment you change it — no Save button needed.'}</span>
            </div>
          )}
        </div>
      </div>

      {libPick && (
        <MediaLibrary open onClose={() => setLibPick(null)} kind={libPick.kind} tenantId={tenantId} lang={lang}
          onPick={(url, item) => { libPick.apply?.(url, item); setLibPick(null) }} />
      )}
    </div>
  )
}

// «ألعاب المنيو» — the venue picks WHICH games guests see. Different venue
// types want different sets (a perfumery wants spice matching, a seafood
// restaurant wants the fisher), so the list is filtered by venue-type tags and
// is multi-select. tenant.games = array of game ids; unset = a starter set.
function GamePicker({ ar, tenant, saveNow, updateTenantLocal, toast, t }) {
  const [catalog, setCatalog] = useState(null)
  const [tagList, setTagList] = useState([])
  const [tag, setTag] = useState('all')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    let alive = true
    import('../../lib/games.js')
      .then((m) => {
        if (!alive) return
        setCatalog(m.GAMES || [])
        // Labels come from the registry itself so they can never drift apart.
        setTagList(m.GAME_TAGS || [])
      })
      .catch(() => { if (alive) setCatalog([]) })
    return () => { alive = false }
  }, [])

  const chosen = Array.isArray(tenant?.games) ? tenant.games : null // null = defaults
  const isOn = (id) => (chosen ? chosen.includes(id) : true)

  const toggle = async (id) => {
    if (busy) return
    const base = chosen || (catalog || []).map((g) => g.id)
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
    setBusy(id)
    try {
      await saveNow({ games: next })
      updateTenantLocal({ games: next })
    } catch (_) { toast.error(t('error')) } finally { setBusy('') }
  }

  if (catalog === null) return null
  if (!catalog.length) {
    return (
      <div className="card card-pad">
        <p className="xs faint" style={{ margin: 0 }}>{ar ? 'مكتبة الألعاب غير متاحة في هذه النسخة.' : 'Game library unavailable.'}</p>
      </div>
    )
  }

  const present = new Set(catalog.flatMap((g) => g.tags || []))
  const tags = (tagList.length ? tagList : [{ id: 'all', ar: 'الكل', en: 'All' }])
    .filter((tg) => tg.id === 'all' || present.has(tg.id))
  const shown = tag === 'all' ? catalog : catalog.filter((g) => (g.tags || []).includes(tag))
  const onCount = catalog.filter((g) => isOn(g.id)).length

  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <Icon name="play" size={18} style={{ color: 'var(--brand)' }} />
        <strong>{ar ? 'ألعاب المنيو' : 'Menu games'}</strong>
        <span className="grow" />
        <span className="xs faint num">{onCount} / {catalog.length}</span>
      </div>
      <p className="xs faint" style={{ margin: 0 }}>
        {ar ? 'اختر الألعاب التي تظهر لعملائك — يمكن تفعيل أكثر من لعبة، وتُفتح للعميل بعد تسجيل اسمه وجواله فيدخل قاعدة عملائك.' : 'Pick the games guests see; several can run at once.'}
      </p>
      <div className="row scroll-x" style={{ gap: 6 }}>
        {tags.map((tg) => (
          <button key={tg.id} type="button" className={`chip ${tag === tg.id ? 'active' : ''}`} onClick={() => setTag(tg.id)}>{ar ? tg.ar : (tg.en || tg.ar)}</button>
        ))}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {shown.map((g) => (
          <label key={g.id} className="row-between" style={{ gap: 10, cursor: 'pointer', paddingBlock: 6, borderTop: '1px solid var(--border)' }}>
            <span className="row" style={{ gap: 10, alignItems: 'center' }}>
              <span className="center" style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface-2)', color: 'var(--brand)', flex: 'none' }}>
                <Icon name={g.icon || 'play'} size={17} />
              </span>
              <span className="stack" style={{ gap: 1 }}>
                <span className="small bold">{ar ? g.ar : (g.en || g.ar)}</span>
                <span className="xs faint">{g.desc || ''}</span>
              </span>
            </span>
            <input type="checkbox" checked={isOn(g.id)} disabled={busy === g.id} onChange={() => toggle(g.id)} style={{ width: 22, height: 22, flex: 'none' }} />
          </label>
        ))}
      </div>
    </div>
  )
}

// «نوع النشاط ومفرداته» — the venue type reshapes the system's vocabulary and
// tells every AI surface what this business actually is. Changing it is safe
// at any time; per-word overrides let an unusual business fine-tune wording
// without waiting for us to ship a new type.
function VenueTypeCard({ ar, tenant, saveNow, updateTenantLocal, toast, t }) {
  const [openLex, setOpenLex] = useState(false)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState(tenant?.typeLabel || '')
  const current = venueType(tenant)

  const pick = async (id) => {
    if (busy) return
    setBusy(true)
    try {
      await saveNow({ type: id })
      updateTenantLocal({ type: id })
      toast.success(t('saved'))
    } catch (_) { toast.error(t('error')) } finally { setBusy(false) }
  }

  const saveLabel = async () => {
    try {
      await saveNow({ typeLabel: label.trim() })
      updateTenantLocal({ typeLabel: label.trim() })
      toast.success(t('saved'))
    } catch (_) { toast.error(t('error')) }
  }

  const setWord = async (key, value) => {
    const next = { ...(tenant?.lexOverrides || {}) }
    if (value.trim()) next[key] = value.trim()
    else delete next[key]
    try {
      await saveNow({ lexOverrides: next })
      updateTenantLocal({ lexOverrides: next })
    } catch (_) { toast.error(t('error')) }
  }

  return (
    <div className="card card-pad stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <Icon name="store" size={18} style={{ color: 'var(--brand)' }} />
        <strong>{ar ? 'نوع النشاط ومفرداته' : 'Business type & wording'}</strong>
      </div>
      <p className="xs faint" style={{ margin: 0 }}>
        {ar
          ? 'يحدّد هذا الخيار مفردات النظام كلها (مشروب / طبق / منتج…) ويجعل الذكاء الاصطناعي يفهم طبيعة نشاطك في كل ما يكتبه ويصمّمه ويقترحه.'
          : 'Drives the system vocabulary and tells the AI what this business is.'}
      </p>

      <div className="row wrap" style={{ gap: 6 }}>
        {VENUE_TYPES.map((ty) => (
          <button key={ty.id} type="button" disabled={busy}
            className={`chip ${tenant?.type === ty.id ? 'active' : ''}`}
            onClick={() => pick(ty.id)}>
            <Icon name={ty.icon} size={13} style={{ verticalAlign: 'middle', marginInlineEnd: 4 }} />{ty.ar}
          </button>
        ))}
      </div>

      {tenant?.type === 'other' && (
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="input input-sm grow" style={{ minWidth: 200 }} value={label}
            placeholder={ar ? 'اكتب اسم نشاطك بالضبط' : 'Name your business type'}
            onChange={(e) => setLabel(e.target.value)} onBlur={saveLabel} />
        </div>
      )}

      <div className="card card-pad" style={{ background: 'var(--surface-2)', border: 'none' }}>
        <p className="xs" style={{ margin: 0, lineHeight: 1.8 }}>
          {ar ? 'حالياً يخاطب النظام عملاءك بـ: ' : 'Currently: '}
          <b>{lex(tenant, 'item')}</b>{' · '}<b>{lex(tenant, 'items')}</b>{' · '}<b>{lex(tenant, 'menu')}</b>{' · '}<b>{lex(tenant, 'place')}</b>
        </p>
      </div>

      <button type="button" className="btn btn-sm btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => setOpenLex((v) => !v)}>
        <Icon name="penLine" size={13} /> {ar ? 'تخصيص المفردات يدوياً' : 'Custom wording'}
      </button>

      {openLex && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="xs faint" style={{ margin: 0 }}>
            {ar ? 'اترك الحقل فارغاً ليستخدم النظام الكلمة الافتراضية لنشاطك.' : 'Leave empty to use the type default.'}
          </p>
          {LEX_KEYS.map((k) => (
            <div key={k} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="xs faint" style={{ minWidth: 120 }}>{LEX_LABELS[k] || k}</span>
              <input
                className="input input-sm grow"
                defaultValue={(tenant?.lexOverrides || {})[k] || ''}
                placeholder={lex(tenant, k)}
                onBlur={(e) => setWord(k, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
