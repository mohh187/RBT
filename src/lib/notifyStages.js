// Which order stages notify the guest — the browser's copy.
//
// The SERVER decides what actually sends (functions/messaging.js stageAllows).
// This copy exists so the settings screen can show the venue the same defaults
// the server will apply, before anything is saved. A settings screen that
// displays different defaults from the ones in force is worse than no screen:
// the venue configures against a fiction.
//
// scripts/guard.mjs fails the build if NOTIFY_STAGE_DEFAULTS drifts from
// functions/messaging.js.
export const NOTIFY_STAGE_DEFAULTS = {
  accepted: { email: true, whatsapp: true },
  preparing: { email: false, whatsapp: false },
  ready: { email: true, whatsapp: true },
  served: { email: false, whatsapp: false },
  paid: { email: true, whatsapp: true },
  cancelled: { email: true, whatsapp: true },
  refunded: { email: true, whatsapp: true },
}

// Display order + labels. Ordered as the guest experiences them, not
// alphabetically — the venue is reading a timeline, not a list of keys.
export const NOTIFY_STAGES = [
  { id: 'accepted', ar: 'استلمنا طلبك', en: 'Order received' },
  { id: 'preparing', ar: 'قيد التحضير', en: 'Preparing' },
  { id: 'ready', ar: 'الطلب جاهز', en: 'Ready' },
  { id: 'served', ar: 'تم التسليم', en: 'Served' },
  { id: 'paid', ar: 'الدفع والفاتورة الضريبية', en: 'Paid + tax invoice' },
  { id: 'cancelled', ar: 'إلغاء الطلب', en: 'Cancelled' },
  { id: 'refunded', ar: 'استرجاع المبلغ', en: 'Refunded' },
]

// Same resolution the server performs, so the checkbox shows what will happen.
export function stageOn(stages, status, channel) {
  const s = (stages && stages[status]) || {}
  if (typeof s[channel] === 'boolean') return s[channel]
  const d = NOTIFY_STAGE_DEFAULTS[status]
  return d ? d[channel] !== false : false
}
