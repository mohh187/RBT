// Ordering availability: is the venue accepting NEW diner orders right now?
//
// Two independent gates, both default-OFF so an untouched venue behaves exactly
// as before (always open):
//   1. tenant.ordersPaused === true  — a manual "stop taking orders" switch for
//      when the kitchen is slammed or closed early. This is the authoritative
//      gate: it is also enforced server-side (onNewOrder) and in the rules.
//   2. tenant.hours — an optional weekly schedule { mon:{open,close}, ... } in
//      24h "HH:MM", evaluated in the venue timezone. Enforced on the diner UI
//      (server/rules stay timezone-free and lean on the manual switch).
//
// Returns { open: boolean, reason: '' | 'paused' | 'closed' }.

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function minutesNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(new Date())
    const h = Number(parts.find((p) => p.type === 'hour')?.value || 0)
    const m = Number(parts.find((p) => p.type === 'minute')?.value || 0)
    const wd = (parts.find((p) => p.type === 'weekday')?.value || '').toLowerCase().slice(0, 3)
    return { mins: (h % 24) * 60 + m, day: DAYS.includes(wd) ? wd : null }
  } catch (_) {
    return null
  }
}

function toMins(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  if (Number.isNaN(h)) return null
  return (h % 24) * 60 + (m || 0)
}

export function orderingState(tenant) {
  if (!tenant) return { open: true, reason: '' }
  if (tenant.ordersPaused === true) return { open: false, reason: 'paused' }
  const hours = tenant.hours
  if (hours && typeof hours === 'object') {
    const now = minutesNow(tenant.tz || tenant.timezone)
    if (now && now.day) {
      const today = hours[now.day]
      // A missing day = open (owner only lists the days they want to gate).
      if (today && today.open && today.close) {
        const o = toMins(today.open)
        const c = toMins(today.close)
        if (o != null && c != null) {
          const within = o <= c ? (now.mins >= o && now.mins < c) : (now.mins >= o || now.mins < c) // overnight
          if (!within) return { open: false, reason: 'closed' }
        }
      }
    }
  }
  return { open: true, reason: '' }
}

export function orderingClosedMessage(reason, lang = 'ar') {
  const ar = lang !== 'en'
  if (reason === 'paused') return ar ? 'المطعم متوقف عن استقبال الطلبات مؤقتاً' : 'The venue has paused new orders'
  if (reason === 'closed') return ar ? 'مغلق الآن، تصفّح المنيو وعُد في وقت العمل' : 'Closed right now — browse the menu and come back during opening hours'
  return ''
}
