// Granular role-based capabilities. Each role gets a default capability set;
// managers can later override per-staffer (via staff doc `caps`). The data layer
// is still enforced by Firestore rules — this gates the UI precisely per role.

export const CAP = {
  TAKE_ORDERS: 'take_orders',     // accept/advance orders (cashier/waiter)
  CANCEL_ORDER: 'cancel_order',   // cancel an order
  REFUND: 'refund',               // mark paid / refund
  PRINT: 'print',                 // print receipts
  KITCHEN: 'kitchen',             // kitchen display + advance prep
  SCAN_TICKETS: 'scan_tickets',   // event ticket check-in
  MANAGE_MENU: 'manage_menu',     // items + categories
  MANAGE_OFFERS: 'manage_offers',
  MANAGE_EVENTS: 'manage_events', // events + reservations
  MANAGE_TABLES: 'manage_tables',
  VIEW_REPORTS: 'view_reports',
  VIEW_CUSTOMERS: 'view_customers',
  VIEW_COMPLAINTS: 'view_complaints',
  MANAGE_STAFF: 'manage_staff',       // add/manage staff
  MANAGE_PAYROLL: 'manage_payroll',   // salary, deductions
  VIEW_PERFORMANCE: 'view_performance',
  MANAGE_SETTINGS: 'manage_settings', // full settings (kept for owner/manager + back-compat)
  ATTENDANCE: 'attendance',           // clock in/out (everyone)
  DELIVER: 'deliver',                 // delivery driver: see + fulfil assigned deliveries
  // --- granular caps (split out of the mega-caps for per-employee scoping) ---
  MANAGE_CAMPAIGNS: 'manage_campaigns',     // marketing: campaigns + in-menu notices
  MANAGE_LOYALTY: 'manage_loyalty',         // membership / VIP / loyalty policy
  MANAGE_APPEARANCE: 'manage_appearance',   // studio / themes / banner / display screens
  MANAGE_STORIES: 'manage_stories',         // stories + venue profile posts
  MANAGE_INVENTORY: 'manage_inventory',     // materials / suppliers / purchase orders
  MANAGE_INTEGRATIONS: 'manage_integrations', // payment / WhatsApp / email keys (most sensitive)
  USE_ASSISTANT: 'use_assistant',           // open + run the AI assistant
  VIEW_REVENUE: 'view_revenue',             // see money figures (revenue/salary/totals)
  EDIT_PRICES: 'edit_prices',               // change item prices (vs. editing name/photo only)
  EXPORT_DATA: 'export_data',               // export Excel/PDF of venue data
}

const ALL = Object.values(CAP)

export const ROLE_CAPS = {
  owner: ALL,
  manager: ALL,
  supervisor: [CAP.TAKE_ORDERS, CAP.CANCEL_ORDER, CAP.REFUND, CAP.PRINT, CAP.SCAN_TICKETS, CAP.KITCHEN, CAP.VIEW_REPORTS, CAP.VIEW_REVENUE, CAP.VIEW_CUSTOMERS, CAP.VIEW_COMPLAINTS, CAP.VIEW_PERFORMANCE, CAP.ATTENDANCE],
  // Marketing hire: campaigns/offers/stories/customers/assistant — NO settings, payroll, or revenue.
  marketing: [CAP.MANAGE_CAMPAIGNS, CAP.MANAGE_OFFERS, CAP.MANAGE_STORIES, CAP.VIEW_CUSTOMERS, CAP.USE_ASSISTANT, CAP.EXPORT_DATA, CAP.ATTENDANCE],
  cashier: [CAP.TAKE_ORDERS, CAP.CANCEL_ORDER, CAP.REFUND, CAP.PRINT, CAP.SCAN_TICKETS, CAP.ATTENDANCE],
  barista: [CAP.TAKE_ORDERS, CAP.KITCHEN, CAP.ATTENDANCE],
  waiter: [CAP.TAKE_ORDERS, CAP.ATTENDANCE],
  kitchen: [CAP.KITCHEN, CAP.ATTENDANCE],
  driver: [CAP.DELIVER, CAP.ATTENDANCE],
  cleaner: [CAP.ATTENDANCE],
  staff: [CAP.ATTENDANCE],
}

// Roles a manager can assign + their bilingual labels.
export const ROLE_LABELS = {
  owner: { ar: 'مالك', en: 'Owner' },
  manager: { ar: 'مدير', en: 'Manager' },
  supervisor: { ar: 'مشرف', en: 'Supervisor' },
  marketing: { ar: 'مسؤول تسويق', en: 'Marketing' },
  cashier: { ar: 'كاشير', en: 'Cashier' },
  barista: { ar: 'باريستا', en: 'Barista' },
  waiter: { ar: 'نادل', en: 'Waiter' },
  kitchen: { ar: 'مطبخ / طاهٍ', en: 'Kitchen' },
  driver: { ar: 'مندوب توصيل', en: 'Driver' },
  cleaner: { ar: 'عامل نظافة', en: 'Cleaner' },
  staff: { ar: 'موظف', en: 'Staff' },
}
export const ASSIGNABLE_ROLES = ['manager', 'supervisor', 'marketing', 'cashier', 'barista', 'waiter', 'kitchen', 'driver', 'cleaner']
export function roleName(role, lang) { return (ROLE_LABELS[role] && (lang === 'ar' ? ROLE_LABELS[role].ar : ROLE_LABELS[role].en)) || role }

// Capabilities a manager may toggle per role (owner is always all; manager is fixed all).
export const EDITABLE_ROLES = ['supervisor', 'marketing', 'cashier', 'barista', 'waiter', 'kitchen', 'cleaner']

export const CAP_LABELS = {
  [CAP.TAKE_ORDERS]: { ar: 'استقبال الطلبات', en: 'Take orders' },
  [CAP.CANCEL_ORDER]: { ar: 'إلغاء الطلب', en: 'Cancel order' },
  [CAP.REFUND]: { ar: 'الدفع/الاسترجاع', en: 'Payment / refund' },
  [CAP.PRINT]: { ar: 'الطباعة', en: 'Printing' },
  [CAP.KITCHEN]: { ar: 'شاشة المطبخ', en: 'Kitchen display' },
  [CAP.SCAN_TICKETS]: { ar: 'مسح التذاكر', en: 'Scan tickets' },
  [CAP.MANAGE_MENU]: { ar: 'إدارة المنيو', en: 'Manage menu' },
  [CAP.MANAGE_OFFERS]: { ar: 'إدارة العروض', en: 'Manage offers' },
  [CAP.MANAGE_EVENTS]: { ar: 'الفعاليات والحجوزات', en: 'Events & reservations' },
  [CAP.MANAGE_TABLES]: { ar: 'إدارة الطاولات', en: 'Manage tables' },
  [CAP.VIEW_REPORTS]: { ar: 'التقارير', en: 'Reports' },
  [CAP.VIEW_CUSTOMERS]: { ar: 'العملاء', en: 'Customers' },
  [CAP.VIEW_COMPLAINTS]: { ar: 'الشكاوى', en: 'Complaints' },
  [CAP.MANAGE_STAFF]: { ar: 'إدارة الموظفين', en: 'Manage staff' },
  [CAP.MANAGE_PAYROLL]: { ar: 'الرواتب', en: 'Payroll' },
  [CAP.VIEW_PERFORMANCE]: { ar: 'الأداء', en: 'Performance' },
  [CAP.MANAGE_SETTINGS]: { ar: 'الإعدادات والسياسات', en: 'Settings & policies' },
  [CAP.ATTENDANCE]: { ar: 'الحضور والانصراف', en: 'Attendance' },
  [CAP.DELIVER]: { ar: 'توصيل الطلبات', en: 'Deliver orders' },
  [CAP.MANAGE_CAMPAIGNS]: { ar: 'الحملات والإعلانات', en: 'Campaigns & ads' },
  [CAP.MANAGE_LOYALTY]: { ar: 'العضويات والولاء', en: 'Loyalty & VIP' },
  [CAP.MANAGE_APPEARANCE]: { ar: 'المظهر والاستوديو', en: 'Appearance & studio' },
  [CAP.MANAGE_STORIES]: { ar: 'الاستوري والأخبار', en: 'Stories & posts' },
  [CAP.MANAGE_INVENTORY]: { ar: 'المخزون والموردين', en: 'Inventory & suppliers' },
  [CAP.MANAGE_INTEGRATIONS]: { ar: 'مفاتيح الدفع والربط', en: 'Payment & integration keys' },
  [CAP.USE_ASSISTANT]: { ar: 'المساعد الذكي', en: 'AI assistant' },
  [CAP.VIEW_REVENUE]: { ar: 'رؤية الأرقام المالية', en: 'View revenue figures' },
  [CAP.EDIT_PRICES]: { ar: 'تعديل الأسعار', en: 'Edit prices' },
  [CAP.EXPORT_DATA]: { ar: 'تصدير البيانات', en: 'Export data' },
}

// Caps grouped for a cleaner Roles/Staff editor UI. Keys are section headers.
export const CAP_GROUPS = [
  { ar: 'التشغيل', en: 'Operations', caps: [CAP.TAKE_ORDERS, CAP.CANCEL_ORDER, CAP.REFUND, CAP.PRINT, CAP.KITCHEN, CAP.SCAN_TICKETS, CAP.MANAGE_TABLES, CAP.DELIVER] },
  { ar: 'المنيو والمخزون', en: 'Menu & stock', caps: [CAP.MANAGE_MENU, CAP.EDIT_PRICES, CAP.MANAGE_OFFERS, CAP.MANAGE_INVENTORY, CAP.MANAGE_EVENTS] },
  { ar: 'التسويق والعملاء', en: 'Marketing & CRM', caps: [CAP.MANAGE_CAMPAIGNS, CAP.MANAGE_STORIES, CAP.MANAGE_LOYALTY, CAP.VIEW_CUSTOMERS, CAP.VIEW_COMPLAINTS, CAP.USE_ASSISTANT] },
  { ar: 'التقارير والمال', en: 'Reports & money', caps: [CAP.VIEW_REPORTS, CAP.VIEW_REVENUE, CAP.VIEW_PERFORMANCE, CAP.EXPORT_DATA] },
  { ar: 'الفريق والإعدادات', en: 'Team & settings', caps: [CAP.ATTENDANCE, CAP.MANAGE_STAFF, CAP.MANAGE_PAYROLL, CAP.MANAGE_APPEARANCE, CAP.MANAGE_INTEGRATIONS, CAP.MANAGE_SETTINGS] },
]

// Effective caps = tenant role override (if any) → defaults, then per-staffer add/remove.
export function capsFor(role, overrides, roleCapsOverride) {
  const base = (roleCapsOverride && roleCapsOverride[role]) || ROLE_CAPS[role] || ROLE_CAPS.staff
  if (!overrides || (!overrides.add && !overrides.remove)) return base
  const set = new Set(base)
  ;(overrides.remove || []).forEach((c) => set.delete(c))
  ;(overrides.add || []).forEach((c) => set.add(c))
  return [...set]
}

export function roleCan(role, overrides, cap, roleCapsOverride) {
  if (role === 'owner') return true
  return capsFor(role, overrides, roleCapsOverride).includes(cap)
}

// The caps a role gets by default (role-level, before any per-staffer override).
// Used to seed the per-staffer editor and as the fallback when no override exists.
export function roleDefaultCaps(role, roleCapsOverride) {
  return capsFor(role, null, roleCapsOverride)
}

// Effective permission check. Owner/manager always all. A per-staffer RESOLVED caps
// array (stored on staff/{uid}.caps, manager-written) overrides the role default when
// present; otherwise we fall back to the role's (optionally tenant-customized) caps.
export function effectiveCan(role, staffCaps, cap, roleCapsOverride) {
  if (role === 'owner' || role === 'manager') return true
  if (Array.isArray(staffCaps)) return staffCaps.includes(cap)
  return roleCan(role, null, cap, roleCapsOverride)
}

// Resolve the full effective caps list for a staffer (per-staffer override or role default).
export function effectiveCaps(role, staffCaps, roleCapsOverride) {
  if (role === 'owner' || role === 'manager') return [...ALL]
  if (Array.isArray(staffCaps)) return staffCaps
  return roleDefaultCaps(role, roleCapsOverride)
}
