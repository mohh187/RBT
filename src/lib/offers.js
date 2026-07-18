// Offer evaluation engine (shared by the diner cart and admin preview).
// Offer shape:
//   { nameAr, nameEn, type:'percent'|'fixed', value, scope:'cart'|'category'|'item',
//     categoryId?, itemId?, code?, minSubtotal?, autoApply?, active,
//     daysOfWeek?:[0-6], startTime?:'HH:MM', endTime?:'HH:MM', startsAt?, endsAt? }

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function minutesOfDay(d) {
  return d.getHours() * 60 + d.getMinutes()
}

export function isOfferActive(offer, now = new Date()) {
  if (!offer || offer.active === false) return false
  // date window (limited-time campaigns) — startsAt/endsAt are ms epoch numbers
  const ts = now.getTime()
  if (offer.startsAt && ts < Number(offer.startsAt)) return false
  if (offer.endsAt && ts > Number(offer.endsAt)) return false
  // weekday window
  if (Array.isArray(offer.daysOfWeek) && offer.daysOfWeek.length && !offer.daysOfWeek.includes(now.getDay())) return false
  // time window (supports overnight, e.g. 22:00–02:00)
  if (offer.startTime && offer.endTime) {
    const cur = minutesOfDay(now)
    const [sh, sm] = offer.startTime.split(':').map(Number)
    const [eh, em] = offer.endTime.split(':').map(Number)
    const s = sh * 60 + sm
    const e = eh * 60 + em
    if (s <= e) {
      if (cur < s || cur > e) return false
    } else if (cur < s && cur > e) {
      return false
    }
  }
  return true
}

// Base amount an offer applies to within the cart.
function offerBase(offer, cart, subtotal) {
  if (offer.scope === 'category' && offer.categoryId) {
    return cart.filter((l) => l.categoryId === offer.categoryId).reduce((s, l) => s + l.unitPrice * l.qty, 0)
  }
  if (offer.scope === 'item' && offer.itemId) {
    return cart.filter((l) => l.itemId === offer.itemId).reduce((s, l) => s + l.unitPrice * l.qty, 0)
  }
  return subtotal
}

function discountOf(offer, base) {
  if (base <= 0) return 0
  const d = offer.type === 'percent' ? base * (Number(offer.value) || 0) / 100 : Math.min(Number(offer.value) || 0, base)
  return round2(Math.max(0, d))
}

// Returns the single best applicable offer: { offer, discount } | null.
export function evaluateOffers(offers, cart, subtotal, { couponCode, now = new Date(), isMember = false } = {}) {
  const code = (couponCode || '').trim().toUpperCase()
  let best = null
  for (const o of offers || []) {
    if (!isOfferActive(o, now)) continue
    if (o.membersOnly && !isMember) continue // exclusive member offer
    if (subtotal < (Number(o.minSubtotal) || 0)) continue
    if (o.code) {
      if (!code || o.code.toUpperCase() !== code) continue
    } else if (o.autoApply === false) {
      continue
    }
    const d = discountOf(o, offerBase(o, cart, subtotal))
    if (d > 0 && (!best || d > best.discount)) best = { offer: o, discount: d }
  }
  return best
}

// Auto offers (no code) that are active right now — used for menu badges.
export function activeAutoOffers(offers, now = new Date()) {
  return (offers || []).filter((o) => !o.code && isOfferActive(o, now))
}

// A short discount label for an item card, e.g. "−20%" or "−5", or '' if none.
export function itemOfferLabel(item, offers, currency, now = new Date()) {
  const autos = activeAutoOffers(offers, now)
  let best = null
  for (const o of autos) {
    const applies = o.scope === 'cart' || (o.scope === 'category' && o.categoryId === item.categoryId) || (o.scope === 'item' && o.itemId === item.id)
    if (!applies) continue
    if (o.type === 'percent') {
      const v = Number(o.value) || 0
      if (!best || (best.type === 'percent' && v > best.value)) best = { type: 'percent', value: v }
    } else if (!best) {
      best = { type: 'fixed', value: Number(o.value) || 0 }
    }
  }
  if (!best) return ''
  return best.type === 'percent' ? `−${best.value}%` : `−${best.value}`
}

// The single best active auto-offer that applies to a specific item (item > category > cart), or null.
export function offerForItem(item, offers, now = new Date()) {
  const autos = activeAutoOffers(offers, now)
  let best = null
  for (const o of autos) {
    const applies = o.scope === 'cart' || (o.scope === 'category' && o.categoryId === item.categoryId) || (o.scope === 'item' && o.itemId === item.id)
    if (!applies) continue
    const rank = o.scope === 'item' ? 3 : o.scope === 'category' ? 2 : 1
    const val = Number(o.value) || 0
    if (!best || rank > best.rank || (rank === best.rank && val > best.val)) best = { offer: o, rank, val }
  }
  return best ? best.offer : null
}

// Unit price after applying an offer (for strike-through display).
export function discountedPrice(price, offer) {
  const p = Number(price) || 0
  if (!offer) return p
  const d = offer.type === 'percent' ? p * (Number(offer.value) || 0) / 100 : Math.min(Number(offer.value) || 0, p)
  return round2(Math.max(0, p - d))
}
