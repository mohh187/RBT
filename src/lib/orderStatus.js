// ONE status vocabulary for the whole system. Three surfaces used to carry
// three different Arabic label sets for the same five states (cashier board,
// admin orders lanes, order-detail sheet) — a guest's «تم القبول» was a
// cashier's «مقبولة» and a manager's «مقبول». Every surface now reads from
// here; the strings themselves live in i18n (`status_*` keys, both languages).

export const STATUS_FLOW = ['pending', 'accepted', 'preparing', 'ready', 'served']

// The next action for each active status — label key (i18n), button class,
// icon. Merged from the cashier ticket button and the order-detail button so
// an order advances identically no matter which control the staffer reaches.
export const NEXT_STEP = {
  pending: { to: 'accepted', key: 'accept', cls: 'btn-primary', icon: 'ok' },
  accepted: { to: 'preparing', key: 'startPreparing', cls: 'btn-primary', icon: 'kitchen' },
  preparing: { to: 'ready', key: 'markReady', cls: 'btn-success', icon: 'bellRing' },
  ready: { to: 'served', key: 'markServed', cls: 'btn-success', icon: 'ok' },
}

// Full label — `t` is the i18n translator.
export const statusLabel = (t, s) => t(`status_${s}`) || s

// Compact label for tight layouts (journey bar segments, lane chips) where
// «بانتظار القبول» would wrap. Same vocabulary, shortened — not a third set.
const SHORT = {
  pending: { ar: 'بانتظار', en: 'Pending' },
  accepted: { ar: 'مقبول', en: 'Accepted' },
  preparing: { ar: 'تحضير', en: 'Preparing' },
  ready: { ar: 'جاهز', en: 'Ready' },
  served: { ar: 'مُقدَّم', en: 'Served' },
  paid: { ar: 'مدفوع', en: 'Paid' },
  cancelled: { ar: 'ملغي', en: 'Cancelled' },
  refunded: { ar: 'مسترجع', en: 'Refunded' },
}
export const statusShort = (lang, s) => SHORT[s]?.[lang === 'ar' ? 'ar' : 'en'] || s

// ONE word per order type, for the same reason. The guest taps «سفري» and the
// order stores orderType 'pickup', while a counter sale rung up on the POS
// stores 'takeaway' — two values for one behaviour, which the staff screens
// then showed under a third word. Everything reads the label from here.
const TYPES = {
  dinein: { ar: 'في الصالة', en: 'Dine-in' },
  pickup: { ar: 'سفري', en: 'Takeaway' },
  takeaway: { ar: 'سفري', en: 'Takeaway' },
  curbside: { ar: 'استلام بالسيارة', en: 'Curbside' },
  delivery: { ar: 'توصيل', en: 'Delivery' },
}
export const orderTypeLabel = (type, lang) => (TYPES[type] || TYPES.dinein)[lang === 'ar' ? 'ar' : 'en']
