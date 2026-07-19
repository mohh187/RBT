// Global admin search — static page/action index + live Firestore lookups.
// Consumed by src/components/GlobalSearch.jsx (the command-palette Sheet).
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore'
import { db } from './firebase.js'
import { listItems, listCategories, listCustomers, listStaff, listCampaigns } from './db.js'
import { CAP } from './permissions.js'

// ---------- Arabic-aware normalization ----------
// Lowercase, strip tashkeel/tatweel, unify hamza-alef forms, taa-marbuta and
// alef-maqsura so «قهوة» matches «قهوه» and «أصناف» matches «اصناف».
export function normalizeAr(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '') // harakat + dagger alif + tatweel
    .replace(/[أإآ]/g, 'ا') // أ إ آ -> ا
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ى/g, 'ي') // ى -> ي
    .trim()
}

// ---------- static index: every admin destination ----------
// cap/anyOf mirror AdminLayout's navItems/moreGroups + App.jsx RequireCap guards;
// the UI filters entries with the same `can()` the sidebar uses.
export const PAGE_INDEX = [
  { id: 'home', ar: 'الرئيسية', en: 'Home', to: '/admin', icon: 'home',
    keywords: ['الرئيسيه', 'لوحة', 'لوحه', 'نظرة عامة', 'احصائيات', 'dashboard', 'insights', 'overview'] },
  { id: 'orders', ar: 'الطلبات', en: 'Orders', to: '/admin/orders', icon: 'orders', cap: CAP.TAKE_ORDERS,
    keywords: ['طلب', 'طلبات', 'فاتورة', 'فواتير', 'مبيعات', 'orders', 'sales', 'invoices'] },
  { id: 'menu', ar: 'المنيو', en: 'Menu', to: '/admin/menu', icon: 'menu', cap: CAP.MANAGE_MENU,
    keywords: ['منيو', 'قائمة', 'قائمه', 'اصناف', 'منتجات', 'اسعار', 'menu', 'products'] },
  { id: 'items', ar: 'الأصناف', en: 'Items', to: '/admin/items', icon: 'menu', cap: CAP.MANAGE_MENU,
    keywords: ['صنف', 'اصناف', 'منتج', 'منتجات', 'اطباق', 'مشروبات', 'items', 'dishes', 'drinks'] },
  { id: 'categories', ar: 'التصنيفات', en: 'Categories', to: '/admin/categories', icon: 'categories', cap: CAP.MANAGE_MENU,
    keywords: ['تصنيف', 'تصنيفات', 'فئة', 'فئات', 'اقسام المنيو', 'categories', 'sections'] },
  { id: 'offers', ar: 'العروض', en: 'Offers', to: '/admin/offers', icon: 'offers', cap: CAP.MANAGE_OFFERS,
    keywords: ['عرض', 'عروض', 'خصم', 'خصومات', 'تخفيضات', 'كوبون', 'offers', 'discounts', 'promo'] },
  { id: 'print-menu', ar: 'طباعة المنيو PDF', en: 'Print menu PDF', to: '/admin/print-menu', icon: 'print', cap: CAP.MANAGE_MENU,
    keywords: ['طباعة', 'طباعه', 'بي دي اف', 'منيو ورقي', 'print', 'pdf', 'paper menu'] },
  { id: 'print-studio', ar: 'استوديو التصميم الحر', en: 'Print design studio', to: '/admin/print-studio', icon: 'penLine', cap: CAP.MANAGE_MENU,
    keywords: ['استوديو تصميم', 'تصميم حر', 'بوستر', 'مطبوعات', 'اشكال', 'عناصر', 'كانفا', 'design studio', 'poster', 'canvas'] },
  { id: 'operations', ar: 'العمليات', en: 'Operations', to: '/admin/operations', icon: 'tables', cap: CAP.MANAGE_TABLES,
    keywords: ['عمليات', 'تشغيل', 'صالة', 'صاله', 'operations', 'floor'] },
  { id: 'tables', ar: 'الطاولات', en: 'Tables', to: '/admin/tables', icon: 'tables', cap: CAP.MANAGE_TABLES,
    keywords: ['طاولة', 'طاوله', 'طاولات', 'كراسي', 'رمز الطاولة', 'tables', 'qr'] },
  { id: 'reservations', ar: 'الحجوزات', en: 'Reservations', to: '/admin/reservations', icon: 'reservations', cap: CAP.MANAGE_EVENTS,
    keywords: ['حجز', 'حجوزات', 'مواعيد', 'reservations', 'booking'] },
  { id: 'events', ar: 'الفعاليات', en: 'Events', to: '/admin/events', icon: 'events', cap: CAP.MANAGE_EVENTS,
    keywords: ['فعالية', 'فعاليه', 'فعاليات', 'مناسبات', 'تذاكر', 'events', 'tickets'] },
  { id: 'hr', ar: 'الفريق', en: 'Team', to: '/admin/hr', icon: 'staff', cap: CAP.ATTENDANCE,
    keywords: ['فريق', 'موظف', 'موظفين', 'طاقم', 'team', 'hr', 'staff'] },
  { id: 'staff', ar: 'الموظفون', en: 'Staff', to: '/admin/staff', icon: 'staff', cap: CAP.MANAGE_STAFF,
    keywords: ['موظف', 'موظفين', 'دعوة موظف', 'حسابات الموظفين', 'staff', 'invite'] },
  { id: 'attendance', ar: 'الحضور', en: 'Attendance', to: '/admin/attendance', icon: 'clock', cap: CAP.MANAGE_STAFF,
    keywords: ['حضور', 'انصراف', 'دوام', 'ورديات', 'اجازات', 'attendance', 'shifts', 'leaves'] },
  { id: 'performance', ar: 'الأداء', en: 'Performance', to: '/admin/performance', icon: 'trending', cap: CAP.VIEW_PERFORMANCE,
    keywords: ['اداء', 'تقييم', 'انتاجية', 'انتاجيه', 'performance'] },
  { id: 'roles', ar: 'الأدوار والصلاحيات', en: 'Roles & permissions', to: '/admin/roles', icon: 'key', cap: CAP.MANAGE_STAFF,
    keywords: ['دور', 'ادوار', 'صلاحية', 'صلاحيات', 'roles', 'permissions', 'caps'] },
  { id: 'policies', ar: 'السياسات', en: 'Policies', to: '/admin/policies', icon: 'file', cap: CAP.MANAGE_SETTINGS,
    keywords: ['سياسة', 'سياسه', 'سياسات', 'لوائح', 'قواعد', 'policies', 'rules'] },
  { id: 'customers', ar: 'العملاء', en: 'Customers', to: '/admin/customers', icon: 'customers', cap: CAP.VIEW_CUSTOMERS,
    keywords: ['عميل', 'عملاء', 'زبون', 'زبائن', 'نقاط', 'ولاء', 'customers', 'loyalty'] },
  { id: 'campaigns', ar: 'الإعلانات والحملات', en: 'Campaigns', to: '/admin/campaigns', icon: 'bellRing', cap: CAP.MANAGE_CAMPAIGNS,
    keywords: ['حملة', 'حمله', 'حملات', 'اعلان', 'اعلانات', 'تسويق', 'رسائل', 'واتساب', 'campaigns', 'marketing', 'whatsapp', 'blast'] },
  { id: 'assistant', ar: 'المساعد الذكي', en: 'AI assistant', to: '/admin/assistant', icon: 'sparkles', cap: CAP.USE_ASSISTANT,
    keywords: ['مساعد', 'ذكاء', 'ذكاء اصطناعي', 'شات', 'assistant', 'ai', 'chat'] },
  { id: 'stories', ar: 'الاستوري', en: 'Stories', to: '/admin/stories', icon: 'camera', cap: CAP.MANAGE_STORIES,
    keywords: ['استوري', 'ستوري', 'قصص', 'قصة', 'قصه', 'stories', 'story'] },
  { id: 'posts', ar: 'البروفايل والأخبار', en: 'Profile & news', to: '/admin/posts', icon: 'events', cap: CAP.MANAGE_STORIES,
    keywords: ['بروفايل', 'ملف', 'اخبار', 'منشور', 'منشورات', 'posts', 'news', 'profile'] },
  { id: 'screens', ar: 'شاشات العرض', en: 'Display screens', to: '/admin/screens', icon: 'qr', cap: CAP.MANAGE_APPEARANCE,
    keywords: ['شاشة', 'شاشه', 'شاشات', 'تلفزيون', 'عرض', 'screens', 'signage', 'tv'] },
  { id: 'settings', ar: 'الإعدادات', en: 'Settings', to: '/admin/settings', icon: 'settings',
    anyOf: [CAP.MANAGE_SETTINGS, CAP.MANAGE_APPEARANCE, CAP.MANAGE_LOYALTY, CAP.MANAGE_INTEGRATIONS],
    keywords: ['اعدادات', 'ضبط', 'ثيم', 'الوان', 'شعار', 'لوجو', 'دومين', 'رابط', 'ضريبة', 'ضريبه', 'دفع', 'مدفوعات', 'ولاء', 'عضويات', 'واتساب', 'settings', 'theme', 'logo', 'domain', 'tax', 'payments', 'loyalty', 'membership'] },
  { id: 'inventory', ar: 'المخزون', en: 'Inventory', to: '/admin/inventory', icon: 'inventory', cap: CAP.MANAGE_INVENTORY,
    keywords: ['مخزون', 'مواد', 'خامات', 'موردين', 'جرد', 'هدر', 'inventory', 'stock', 'suppliers'] },
  { id: 'reports', ar: 'التقارير', en: 'Reports', to: '/admin/reports', icon: 'reports', cap: CAP.VIEW_REPORTS,
    keywords: ['تقرير', 'تقارير', 'ارباح', 'ايرادات', 'مبيعات', 'تحليلات', 'reports', 'revenue', 'analytics'] },
  { id: 'daily', ar: 'تقرير اليوم', en: 'Daily report', to: '/admin/daily', icon: 'calendar', cap: CAP.VIEW_REPORTS,
    keywords: ['يومي', 'تقرير اليوم', 'اقفال', 'نهاية اليوم', 'daily', 'end of day'] },
  { id: 'complaints', ar: 'الشكاوى', en: 'Complaints', to: '/admin/complaints', icon: 'complaint', cap: CAP.VIEW_COMPLAINTS,
    keywords: ['شكوى', 'شكاوي', 'شكاوى', 'ملاحظات', 'complaints', 'feedback'] },
  { id: 'support', ar: 'الدعم والتواصل', en: 'Support', to: '/admin/support', icon: 'mail', cap: CAP.MANAGE_SETTINGS,
    keywords: ['دعم', 'تواصل', 'مساعدة', 'مساعده', 'اشتراك', 'باقة', 'باقه', 'support', 'contact', 'subscription'] },
  { id: 'help', ar: 'مركز المساعدة', en: 'Help center', to: '/admin/help', icon: 'zap',
    keywords: ['مساعدة', 'مساعده', 'شرح', 'دليل', 'تعليمات', 'help', 'guide', 'docs'] },
  { id: 'library', ar: 'المكتبة', en: 'Library', to: '/admin/library', icon: 'folder', anyOf: [CAP.MANAGE_MENU, CAP.MANAGE_CAMPAIGNS, CAP.MANAGE_STORIES, CAP.MANAGE_APPEARANCE],
    keywords: ['مكتبة', 'ملفات', 'صور', 'وسائط', 'مجلد', 'مجلدات', 'توليد', 'خلفيات', 'library', 'media', 'assets', 'files'] },
  { id: 'messages', ar: 'سجل الرسائل والتحليلات', en: 'Messages log', to: '/admin/messages', icon: 'message', cap: CAP.MANAGE_CAMPAIGNS,
    keywords: ['رسائل', 'سجل', 'تحليلات', 'حملات مرسلة', 'واتساب', 'messages', 'log', 'analytics'] },
  { id: 'billing', ar: 'الفوترة والاشتراك', en: 'Billing', to: '/admin/billing', icon: 'wallet', cap: CAP.MANAGE_SETTINGS,
    keywords: ['فوترة', 'فواتير', 'اشتراك', 'باقة', 'دفع', 'رصيد', 'billing', 'invoices', 'plan', 'credits'] },
  { id: 'reviews-studio', ar: 'استوديو التقييمات', en: 'Reviews studio', to: '/admin/reviews-studio', icon: 'star', cap: CAP.MANAGE_CAMPAIGNS,
    keywords: ['تقييمات', 'تقييم', 'جوجل', 'اراء', 'آراء', 'reviews', 'google', 'rating'] },
  { id: 'posts-studio', ar: 'استوديو المنشورات', en: 'Post studio', to: '/admin/posts-studio', icon: 'camera', cap: CAP.MANAGE_CAMPAIGNS,
    keywords: ['منشورات', 'استوديو', 'تصميم', 'توليد صور', 'نانو', 'سوشيال', 'posts', 'studio', 'design', 'social'] },
  { id: 'cashier', ar: 'الكاشير', en: 'Cashier', to: '/cashier', icon: 'cashier', cap: CAP.TAKE_ORDERS,
    keywords: ['كاشير', 'كاشيير', 'نقطة بيع', 'نقطه بيع', 'بيع', 'cashier', 'pos'] },
  { id: 'kds', ar: 'المطبخ', en: 'Kitchen', to: '/kds', icon: 'kitchen', cap: CAP.KITCHEN,
    keywords: ['مطبخ', 'شاشة المطبخ', 'تحضير', 'kitchen', 'kds', 'prep'] },
  { id: 'scan', ar: 'مسح التذاكر', en: 'Scan tickets', to: '/scan', icon: 'scan', cap: CAP.SCAN_TICKETS,
    keywords: ['مسح', 'تذكرة', 'تذكره', 'تذاكر', 'دخول', 'scan', 'tickets', 'checkin'] },
  { id: 'portal', ar: 'بوابتي', en: 'My portal', to: '/portal', icon: 'user',
    keywords: ['بوابة', 'بوابه', 'بوابتي', 'حسابي', 'ملفي', 'portal', 'my account'] },
]

// ---------- quick actions ----------
export const ACTION_INDEX = [
  { id: 'new-order', ar: 'طلب جديد', en: 'New order', to: '/cashier', icon: 'cashier', cap: CAP.TAKE_ORDERS },
  { id: 'new-item', ar: 'صنف جديد', en: 'New item', to: '/admin/menu', icon: 'add', cap: CAP.MANAGE_MENU },
  { id: 'new-campaign', ar: 'حملة جديدة', en: 'New campaign', to: '/admin/campaigns', icon: 'bellRing', cap: CAP.MANAGE_CAMPAIGNS },
  { id: 'new-staff', ar: 'موظف جديد', en: 'New staff member', to: '/admin/hr', icon: 'staff', cap: CAP.MANAGE_STAFF },
  { id: 'new-offer', ar: 'عرض جديد', en: 'New offer', to: '/admin/offers', icon: 'offers', cap: CAP.MANAGE_OFFERS },
  { id: 'menu-preview', ar: 'معاينة المنيو', en: 'Preview menu', kind: 'menu-preview', icon: 'eye' },
]

// ---------- live Firestore search ----------
// Raw lists are cached module-level for 60s so keystrokes don't refetch.
const CACHE_TTL = 60_000
const _cache = new Map()

async function cachedList(tenantId, key, fetcher) {
  const k = `${tenantId}:${key}`
  const hit = _cache.get(k)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.rows
  const rows = await fetcher()
  _cache.set(k, { at: Date.now(), rows: rows || [] })
  return rows || []
}

// Recent orders one-shot (db.js has no list-recent helper — same pattern it uses).
// The composite index may be missing on old projects: fail silently, skip orders.
async function fetchRecentOrders(tenantId) {
  const snap = await getDocs(
    query(collection(db, 'tenants', tenantId, 'orders'), orderBy('createdAt', 'desc'), limit(200)),
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

const MAX_PER_KIND = 6

// searchLive(tenantId, q, helpers?) -> flat array of result rows:
//   { kind, id, label, labelEn?, to, meta? }
// helpers.kinds: optional whitelist of kinds the caller's caps allow
// (['item','category','customer','staff','campaign','order']).
export async function searchLive(tenantId, q, helpers = {}) {
  const qn = normalizeAr(q)
  const digits = String(q || '').replace(/\D/g, '')
  if (!tenantId || (qn.length < 2 && digits.length < 2)) return []
  const kinds = Array.isArray(helpers.kinds) ? helpers.kinds : null
  const want = (k) => !kinds || kinds.includes(k)
  const has = (v) => normalizeAr(v).includes(qn)
  const cap = (rows) => rows.slice(0, helpers.maxPerKind || MAX_PER_KIND)

  const jobs = []

  if (want('item')) {
    jobs.push(
      cachedList(tenantId, 'items', () => listItems(tenantId)).then((rows) =>
        cap(rows.filter((it) => (qn.length >= 2) && (has(it.nameAr) || has(it.nameEn)))).map((it) => ({
          kind: 'item',
          id: it.id,
          label: it.nameAr || it.nameEn || '',
          labelEn: it.nameEn || it.nameAr || '',
          to: '/admin/menu',
          meta: it.price != null && it.price !== '' ? String(it.price) : '',
        })),
      ).catch(() => []),
    )
  }

  if (want('category')) {
    jobs.push(
      cachedList(tenantId, 'categories', () => listCategories(tenantId)).then((rows) =>
        cap(rows.filter((c) => (qn.length >= 2) && (has(c.nameAr) || has(c.nameEn) || has(c.name)))).map((c) => ({
          kind: 'category',
          id: c.id,
          label: c.nameAr || c.name || c.nameEn || '',
          labelEn: c.nameEn || c.nameAr || c.name || '',
          to: '/admin/menu',
        })),
      ).catch(() => []),
    )
  }

  if (want('customer')) {
    jobs.push(
      cachedList(tenantId, 'customers', () => listCustomers(tenantId, 400)).then((rows) =>
        cap(rows.filter((c) =>
          (qn.length >= 2 && has(c.name)) ||
          (digits.length >= 2 && String(c.phone || '').replace(/\D/g, '').includes(digits)),
        )).map((c) => ({
          kind: 'customer',
          id: c.id,
          label: c.name || c.phone || '',
          to: '/admin/customers',
          meta: c.phone || '',
        })),
      ).catch(() => []),
    )
  }

  if (want('staff')) {
    jobs.push(
      cachedList(tenantId, 'staff', () => listStaff(tenantId)).then((rows) =>
        cap(rows.filter((s) => qn.length >= 2 && (has(s.name) || has(s.email)))).map((s) => ({
          kind: 'staff',
          id: s.id,
          label: s.name || s.email || '',
          to: '/admin/hr',
          meta: s.email || '',
        })),
      ).catch(() => []),
    )
  }

  if (want('campaign')) {
    jobs.push(
      cachedList(tenantId, 'campaigns', () => listCampaigns(tenantId, 400)).then((rows) =>
        cap(rows.filter((c) => qn.length >= 2 && (has(c.title) || has(c.text)))).map((c) => ({
          kind: 'campaign',
          id: c.id,
          label: c.title || c.text || '',
          to: '/admin/campaigns',
          meta: c.title && c.text ? String(c.text).slice(0, 40) : '',
        })),
      ).catch(() => []),
    )
  }

  // Orders: exact short-code match only, for numeric queries of 2+ digits.
  if (want('order') && /^\d{2,}$/.test(String(q || '').trim())) {
    const codeQ = String(q).trim()
    jobs.push(
      cachedList(tenantId, 'orders', () => fetchRecentOrders(tenantId)).then((rows) =>
        cap(rows.filter((o) => String(o.code || '') === codeQ)).map((o) => ({
          kind: 'order',
          id: o.id,
          label: codeQ,
          to: '/admin/orders',
          meta: o.status || '',
        })),
      ).catch(() => []),
    )
  }

  const settled = await Promise.all(jobs)
  return settled.flat()
}
