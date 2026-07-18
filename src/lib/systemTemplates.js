// Back-office template registry — selectable layout templates per section (like
// the menu skins, but for the admin / cashier / kitchen / dashboard). Plan-gated:
// the free tier is locked to each section's default; advanced plans (Pro+) can
// choose any. Stored on the tenant at `systemTemplates: { cashier, kds, ... }`.
// Pure module (no React) so it's safe to import anywhere.
import { planAllows } from './plans.js'

export const SECTION_TEMPLATES = {
  cashier: {
    label: { ar: 'الكاشير', en: 'Cashier' },
    default: 'grid',
    options: [
      { id: 'grid', ar: 'شبكة أصناف', en: 'Item grid', hint: 'تايلات لمس كبيرة' },
      { id: 'options', ar: 'بطاقات الخيارات', en: 'Option cards', hint: 'الأحجام والإضافات ظاهرة على البطاقة بلا نوافذ' },
      { id: 'compact', ar: 'قائمة مدمجة', en: 'Compact list', hint: 'بحث + قائمة كثيفة للكيبورد' },
      { id: 'touch', ar: 'لمس-متجر', en: 'Touch store', hint: 'فئات جانبية + شبكة صور' },
      { id: 'lite', ar: 'خفيف', en: 'Lite', hint: 'سطر واحد لأجهزة صغيرة' },
    ],
  },
  kds: {
    label: { ar: 'المطبخ', en: 'Kitchen' },
    default: 'rail',
    options: [
      { id: 'rail', ar: 'سكة تذاكر', en: 'Ticket rail', hint: 'تذاكر أفقية' },
      { id: 'kanban', ar: 'أعمدة كانبان', en: 'Kanban', hint: 'جديد / تحضير / جاهز' },
      { id: 'grid', ar: 'شبكة بطاقات', en: 'Card grid', hint: 'بطاقات كبيرة' },
      { id: 'display', ar: 'شاشة عرض', en: 'Display', hint: 'خط إنتاج / bump' },
    ],
  },
  dashboard: {
    label: { ar: 'الرئيسية', en: 'Dashboard' },
    default: 'exec',
    options: [
      { id: 'exec', ar: 'تنفيذي', en: 'Executive', hint: 'مؤشرات + رسوم' },
      { id: 'ops', ar: 'تشغيلي', en: 'Operational', hint: 'طلبات حيّة + مهام' },
      { id: 'min', ar: 'مبسّط', en: 'Minimal', hint: 'الأساسيات فقط' },
    ],
  },
  menu: {
    label: { ar: 'إدارة المنيو', en: 'Menu' },
    default: 'table',
    options: [
      { id: 'table', ar: 'جدول', en: 'Table' },
      { id: 'cards', ar: 'بطاقات', en: 'Cards' },
      { id: 'catalog', ar: 'كتالوج', en: 'Catalog' },
    ],
  },
  orders: {
    label: { ar: 'الطلبات', en: 'Orders' },
    default: 'kanban',
    options: [
      { id: 'kanban', ar: 'كانبان', en: 'Kanban', hint: 'أعمدة حسب الحالة' },
      { id: 'grid', ar: 'شبكة بطاقات', en: 'Card grid', hint: 'بطاقات تفصيلية' },
      { id: 'timeline', ar: 'زمني', en: 'Timeline', hint: 'تسلسل زمني كثيف' },
    ],
  },
}

// The effective template id for a section: the tenant's choice when the plan
// allows it AND the choice is valid; otherwise the section default.
export function sectionTemplate(tenant, section) {
  const sec = SECTION_TEMPLATES[section]
  if (!sec) return 'default'
  if (!planAllows(tenant, 'systemTemplates')) return sec.default
  const chosen = tenant?.systemTemplates?.[section]
  return sec.options.some((o) => o.id === chosen) ? chosen : sec.default
}

export function templateOptions(section) {
  return SECTION_TEMPLATES[section]?.options || []
}
