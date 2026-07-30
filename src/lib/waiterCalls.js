// WHAT A WAITER CALL SAYS — one reading, for every surface that shows one.
//
// WHY THIS FILE EXISTS. The guest's words were written to Firestore correctly
// and rendered by NOTHING: the cashier card printed only the table label and a
// timestamp, the OS alert body was the table label, and the bell row was the
// table label. Three surfaces, three independent hand-rolled strings, and the
// one field that carried the request appeared in none of them. A waiter learned
// that table 4 wanted *something*.
//
// So the reading lives here once and all three call it.

// Minutes after which an unanswered call is late. Chosen to match the kitchen's
// own patience rather than invented: a guest who has waited longer than a course
// takes to plate has been forgotten.
export const CALL_LATE_MIN = 4

export const CALL_INTENTS = ['water', 'bill', 'cutlery', 'clean', 'call']

// The chips the guest taps. `intent` is the stable code; the label is only what
// that guest happened to read. Both are stored — the code so staff can route,
// count and translate it, the text so nothing the guest typed is ever lost.
export const CALL_QUICK = [
  { intent: 'water', ar: 'ماء من فضلك', en: 'Water please', icon: 'coffee' },
  { intent: 'bill', ar: 'الحساب لو سمحت', en: 'The bill please', icon: 'wallet' },
  { intent: 'cutlery', ar: 'أدوات إضافية', en: 'Extra cutlery', icon: 'bag' },
  { intent: 'clean', ar: 'تنظيف الطاولة', en: 'Clean the table', icon: 'sparkles' },
]

const INTENT_LABEL = {
  water: { ar: 'ماء', en: 'Water' },
  bill: { ar: 'الحساب', en: 'Bill' },
  cutlery: { ar: 'أدوات', en: 'Cutlery' },
  clean: { ar: 'تنظيف', en: 'Cleaning' },
  call: { ar: 'نداء', en: 'Call' },
  arrived: { ar: 'وصل العميل', en: 'Guest arrived' },
}

export function intentLabel(intent, lang = 'ar') {
  const row = INTENT_LABEL[intent] || INTENT_LABEL.call
  return lang === 'en' ? row.en : row.ar
}

// THE REQUEST, AS A HUMAN SENTENCE.
//
// Prefers what the guest actually wrote. Falls back to the intent code's own
// label — which matters for a call placed from the old quick chips (reason held
// the label, no intent) and for the bare «call» with no words at all.
export function callText(call, lang = 'ar') {
  const c = call || {}
  const raw = String(c.reason || '').trim()
  if (raw && raw !== 'call') return raw
  if (c.reason === 'arrived') return intentLabel('arrived', lang)
  return intentLabel(c.intent, lang)
}

// A one-line summary for an OS notification body or a bell row: WHAT, then
// WHERE. The table alone was what these surfaces used to show.
export function callSummary(call, lang = 'ar') {
  const c = call || {}
  const what = callText(c, lang)
  const where = c.tableLabel || (c.orderCode ? `#${c.orderCode}` : '')
  return where ? `${what} · ${where}` : what
}

const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : Number(t) || 0))

// Minutes this call has been waiting. `now` is injectable so a render can pass
// one clock to a whole list instead of reading Date.now() per row.
export function callAgeMin(call, now = Date.now()) {
  const at = ms(call?.createdAt)
  if (!at) return 0
  return Math.max(0, Math.floor((now - at) / 60000))
}

// open -> waiting, ack -> someone is walking over, late -> nobody has.
// Returns the three things a row needs: the state, its colour token, and its word.
export function callState(call, now = Date.now()) {
  const c = call || {}
  if (c.status === 'ack') return { key: 'ack', color: 'var(--info)', ar: 'في الطريق', en: 'On the way' }
  if (callAgeMin(c, now) >= CALL_LATE_MIN) return { key: 'late', color: 'var(--danger)', ar: 'متأخر', en: 'Late' }
  return { key: 'open', color: 'var(--warning)', ar: 'بانتظار', en: 'Waiting' }
}
