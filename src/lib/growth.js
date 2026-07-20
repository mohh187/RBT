// GROWTH PACK ENGINES (RBT360) — PURE.
//
// No Firestore, no React, no AI, no network. Every function takes documents the
// caller already loaded and returns plain data. Built on top of forecast.js and
// the session shape behavior.js documents — neither is duplicated here.
//
// THE THREE RULES THIS FILE OBEYS ABSOLUTELY
//  1. ZERO invented numbers. Every figure is counted from the input. No
//     projected uplift, no "you could earn X" — we do not know that.
//  2. A conclusion drawn from a sample too small to mean anything is NOT
//     returned as a weak conclusion; it is refused. `ok:false` + `reason` beats
//     a suggestion the data cannot carry. Silence is a valid answer.
//  3. A rate whose denominator is zero is null, never 0, and every rate is
//     shipped beside the two integers it came from.
//
// Latin digits only. No emojis.

import {
  peakWindows, orderDate, countsAsSale, isSettled, netTotal,
  windowStart, confidenceFor, recipeCost, arPlural, hourLabel, WEEKDAYS_AR,
} from './forecast.js'

// ---------- thresholds: one place, referenced by every verdict ----------
export const GROWTH_THRESHOLDS = {
  // co-occurrence
  MIN_BASKET_ORDERS: 25,   // multi-line settled orders before an index means anything
  MIN_ANCHOR_ORDERS: 8,    // orders containing the anchor before we speak about it
  MIN_PAIR_ORDERS: 3,      // times a pair must have actually co-occurred
  MIN_LIFT: 1.15,          // must beat "they would have bought it anyway"
  // abandoned carts
  MIN_ABANDONED: 3,        // fewer reachable guests than this is a list, not a campaign
  // quiet hours
  MIN_PEAK_ORDERS: 3,      // a peak below this is noise, so "quiet" is meaningless
  MIN_QUIET_GAP: 2,        // peak minus quiet must be a real gap
  MIN_QUIET_ORDERS: 1,     // a slot that NEVER traded is probably a closed slot,
                           // not a quiet one — never schedule an offer into it
  MIN_DAYS_WITH_ORDERS: 7, // fewer operating days than this = low confidence only
  SUGGEST_MAX_PCT: 30,     // never propose deeper than this, whatever margin allows
  UNBACKED_PCT: 10,        // discount proposed when NO recipe cost exists (labelled)
  // menu health
  STALE_DAYS: 60,
  NEW_ITEM_GRACE_DAYS: 30, // younger than this cannot be judged "never ordered"
  // reorder
  MIN_REPEATS: 2,          // a basket seen once is a visit, not a habit
}

// ---------- small pure helpers ----------
const arr = (v) => (Array.isArray(v) ? v : [])
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const r2 = (v) => Math.round(v * 100) / 100
const r3 = (v) => Math.round(v * 1000) / 1000
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()

// Last 9 digits — matches '9665xxxxxxx' against '05xxxxxxxx'. Same rule as
// forecast.js and behavior.js so a guest is one person across all three.
export const phoneKey = (v) => {
  const d = String(v || '').replace(/[^0-9]/g, '')
  return d ? d.slice(-9) : ''
}

// Firestore Timestamp | Date | ms | ISO -> ms, or null. Never throws.
function toMs(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'object') {
    if (typeof v.toMillis === 'function') { try { return v.toMillis() } catch (_) { return null } }
    if (typeof v.toDate === 'function') { try { return v.toDate().getTime() } catch (_) { return null } }
    if (Number.isFinite(v.seconds)) return v.seconds * 1000
  }
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null }
  return null
}

const rate = (n, of) => ({ n: Math.max(0, Math.round(num(n))), of: Math.max(0, Math.round(num(of))), rate: num(of) > 0 ? num(n) / num(of) : null })

const nOrders = (n) => arPlural(n, { one: 'طلب', two: 'طلبان', few: 'طلبات', many: 'طلباً' })
const nItems = (n) => arPlural(n, { one: 'صنف', two: 'صنفان', few: 'أصناف', many: 'صنفاً' })

export const itemName = (it, lang = 'ar') => String(
  (lang === 'en' ? (it?.nameEn || it?.nameAr) : (it?.nameAr || it?.nameEn)) || it?.name || '',
).trim()

// The single canonical availability rule, matching voiceOrder.js.
export function isItemOrderable(item) {
  if (!item) return false
  if (item.available === false) return false
  if (item.trackStock && num(item.stock) <= 0) return false
  return true
}

// An item's effective price: base price, or the cheapest variant when variants
// replace the base price (that is what the item editor does).
export function effectivePrice(item) {
  const base = num(item?.price)
  if (base > 0) return base
  const vs = arr(item?.variants).map((v) => num(v?.price)).filter((p) => p > 0)
  return vs.length ? Math.min(...vs) : 0
}

function ordersInWindow(orders, days, now, filter) {
  const from = windowStart(days, now)
  const out = []
  for (const o of arr(orders)) {
    if (filter && !filter(o)) continue
    const d = orderDate(o)
    if (d && d >= from && d <= now) out.push(o)
  }
  return out
}

// Distinct itemIds in one order. Distinct, because ordering two lattes is not
// "a latte goes with a latte".
const lineIds = (o) => [...new Set(arr(o?.items).map((l) => l?.itemId).filter(Boolean))]

// =====================================================================
// 1. «يُطلب معه» — REAL co-occurrence
// =====================================================================
// Support    = pairOrders / basketOrders          (how common the combo is)
// Confidence = pairOrders / anchorOrders          (given the anchor, how often)
// Lift       = confidence / (otherOrders/basket)  (does the anchor actually
//                                                  predict it, or is the other
//                                                  item just popular anyway)
// Lift is the one that stops us recommending water to everybody.

export function basketIndex(orders, { days = 90, now = new Date() } = {}) {
  const d = Math.max(1, num(days) || 90)
  // Settled orders only (paid / served / refunded): a pending or cancelled
  // basket is an intention, not a purchase.
  const settled = ordersInWindow(orders, d, now, isSettled)

  const itemOrders = new Map()   // itemId -> orders containing it
  const pair = new Map()         // 'a|b' (sorted) -> orders containing both
  const names = new Map()        // itemId -> last seen line name
  let multiLine = 0

  for (const o of settled) {
    const ids = lineIds(o)
    for (const l of arr(o.items)) {
      if (l?.itemId && !names.has(l.itemId)) names.set(l.itemId, String(l.nameAr || l.nameEn || '').trim())
    }
    for (const id of ids) itemOrders.set(id, (itemOrders.get(id) || 0) + 1)
    if (ids.length < 2) continue
    multiLine += 1
    const s = ids.slice().sort()
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        const k = `${s[i]}|${s[j]}`
        pair.set(k, (pair.get(k) || 0) + 1)
      }
    }
  }

  return {
    days: d,
    from: windowStart(d, now),
    to: now,
    basketOrders: settled.length,
    multiLineOrders: multiLine,
    itemOrders,
    pair,
    names,
    // Below this the index cannot support ANY recommendation.
    thin: settled.length < GROWTH_THRESHOLDS.MIN_BASKET_ORDERS,
    confidence: confidenceFor(settled.length),
    basis: 'الطلبات المدفوعة/المقدَّمة فقط',
  }
}

// Suggestions for one anchor item, or for a whole cart (pass every itemId in
// it). Returns ok:false with a machine-readable reason when the sample is too
// thin — the caller must then render NOTHING, not a softer guess.
export function upsellFor(index, anchorIds, { items = [], limit = 3, exclude = [], lang = 'ar' } = {}) {
  const T = GROWTH_THRESHOLDS
  const anchors = [...new Set(arr(anchorIds).filter(Boolean))]
  const sample = {
    basketOrders: index?.basketOrders || 0,
    multiLineOrders: index?.multiLineOrders || 0,
    windowDays: index?.days || 0,
  }
  if (!index || !index.pair) return { ok: false, reason: 'no-index', reasonAr: 'لا يوجد فهرس محسوب', sample, suggestions: [] }
  if (!anchors.length) return { ok: false, reason: 'no-anchor', reasonAr: 'لم يُحدَّد صنف', sample, suggestions: [] }
  if (index.thin) {
    return {
      ok: false,
      reason: 'thin-sample',
      reasonAr: `العينة ${nOrders(index.basketOrders)} فقط — الحد الأدنى ${T.MIN_BASKET_ORDERS} طلباً قبل أي اقتراح`,
      sample,
      suggestions: [],
    }
  }

  const byId = new Map(arr(items).map((i) => [i.id, i]))
  const skip = new Set([...anchors, ...arr(exclude)])
  const total = index.basketOrders
  const out = []

  for (const a of anchors) {
    const anchorOrders = index.itemOrders.get(a) || 0
    if (anchorOrders < T.MIN_ANCHOR_ORDERS) continue
    for (const [key, together] of index.pair.entries()) {
      if (together < T.MIN_PAIR_ORDERS) continue
      const [x, y] = key.split('|')
      if (x !== a && y !== a) continue
      const other = x === a ? y : x
      if (skip.has(other)) continue

      const otherOrders = index.itemOrders.get(other) || 0
      if (!otherOrders) continue
      const conf = together / anchorOrders
      const baseline = otherOrders / total
      const lift = baseline > 0 ? conf / baseline : null
      if (lift === null || lift < T.MIN_LIFT) continue

      const it = byId.get(other)
      // An item the guest cannot actually order is not a suggestion.
      if (it && !isItemOrderable(it)) continue
      const name = (it ? itemName(it, lang) : '') || index.names.get(other) || ''
      if (!name) continue
      const anchorItem = byId.get(a)
      const anchorName = (anchorItem ? itemName(anchorItem, lang) : '') || index.names.get(a) || ''

      out.push({
        itemId: other,
        item: it || null,
        name,
        viaItemId: a,
        viaName: anchorName,
        together,
        anchorOrders,
        otherOrders,
        support: r3(together / total),
        confidence: r3(conf),
        lift: r2(lift),
        // The reason is the arithmetic, spelled out. No adjectives.
        reasonAr: `طُلب مع «${anchorName}» في ${together} من ${anchorOrders} ${anchorOrders === 2 ? 'طلبين' : 'طلباً'}`,
        reasonEn: `Ordered with "${anchorName}" in ${together} of ${anchorOrders} orders`,
        strength: confidenceFor(anchorOrders),
      })
    }
  }

  if (!out.length) {
    const best = anchors.reduce((m, a) => Math.max(m, index.itemOrders.get(a) || 0), 0)
    const tooFew = best < T.MIN_ANCHOR_ORDERS
    return {
      ok: false,
      reason: tooFew ? 'thin-anchor' : 'no-real-pairing',
      reasonAr: tooFew
        ? `أكثر صنف في السلة ظهر في ${nOrders(best)} فقط — الحد الأدنى ${T.MIN_ANCHOR_ORDERS}`
        : 'لا يوجد تلازم حقيقي يتجاوز الشراء العشوائي',
      sample,
      suggestions: [],
    }
  }

  // Best evidence first, and only ONE row per suggested item (its strongest
  // anchor) so the guest never sees the same thing twice.
  out.sort((p, q) => q.lift - p.lift || q.together - p.together)
  const seen = new Set()
  const picked = []
  for (const s of out) {
    if (seen.has(s.itemId)) continue
    seen.add(s.itemId)
    picked.push(s)
    if (picked.length >= Math.max(1, num(limit) || 3)) break
  }
  return { ok: true, reason: '', reasonAr: '', sample, suggestions: picked }
}

// Admin view: every pairing in the venue that clears the thresholds.
export function topPairings(index, { items = [], limit = 25, lang = 'ar' } = {}) {
  const T = GROWTH_THRESHOLDS
  if (!index || index.thin) {
    return {
      ok: false,
      reasonAr: `تحتاج ${T.MIN_BASKET_ORDERS} طلباً مدفوعاً على الأقل — المتوفر ${index?.basketOrders || 0}`,
      rows: [], sample: { basketOrders: index?.basketOrders || 0, multiLineOrders: index?.multiLineOrders || 0, windowDays: index?.days || 0 },
    }
  }
  const byId = new Map(arr(items).map((i) => [i.id, i]))
  const total = index.basketOrders
  const rows = []
  for (const [key, together] of index.pair.entries()) {
    if (together < T.MIN_PAIR_ORDERS) continue
    const [x, y] = key.split('|')
    const ax = index.itemOrders.get(x) || 0
    const ay = index.itemOrders.get(y) || 0
    if (ax < T.MIN_ANCHOR_ORDERS && ay < T.MIN_ANCHOR_ORDERS) continue
    const nameX = (byId.has(x) ? itemName(byId.get(x), lang) : '') || index.names.get(x) || ''
    const nameY = (byId.has(y) ? itemName(byId.get(y), lang) : '') || index.names.get(y) || ''
    if (!nameX || !nameY) continue
    // Report the DIRECTION with the stronger evidence.
    const fwd = ax >= ay
    const anchorOrders = fwd ? ax : ay
    const otherOrders = fwd ? ay : ax
    const conf = together / anchorOrders
    const baseline = otherOrders / total
    rows.push({
      key,
      aId: fwd ? x : y,
      bId: fwd ? y : x,
      aName: fwd ? nameX : nameY,
      bName: fwd ? nameY : nameX,
      together,
      anchorOrders,
      otherOrders,
      support: r3(together / total),
      confidence: r3(conf),
      lift: baseline > 0 ? r2(conf / baseline) : null,
    })
  }
  rows.sort((p, q) => (q.lift ?? 0) - (p.lift ?? 0) || q.together - p.together)
  return {
    ok: rows.length > 0,
    reasonAr: rows.length ? '' : 'لا يوجد تلازم يتجاوز الحدود الدنيا',
    rows: rows.slice(0, Math.max(1, num(limit) || 25)),
    sample: { basketOrders: total, multiLineOrders: index.multiLineOrders, windowDays: index.days },
  }
}

// =====================================================================
// 2. استرجاع السلة المتروكة
// =====================================================================
// A phone is NEVER invented. Three provenances only, each labelled on its row:
//   'session'    — the guest identified themselves in that very session
//   'device'     — the same browser identified itself in another session
//   'past-order' — the same browser placed an order that carries a phone
// Everything else is counted as unreachable and shown as such.

const sessionItems = (s) => (s && s.items && typeof s.items === 'object' ? s.items : {})
const sessionCounts = (s) => (s && s.counts && typeof s.counts === 'object' ? s.counts : {})

export function abandonedCarts({
  sessions = [], orders = [], customers = [], items = [],
  days = 14, now = new Date(), lang = 'ar',
} = {}) {
  const d = Math.max(1, num(days) || 14)
  const fromMs = windowStart(d, now).getTime()
  const toMs = now.getTime()
  const byId = new Map(arr(items).map((i) => [i.id, i]))

  const all = arr(sessions)
  const inWindow = all.filter((s) => {
    const t = num(s?.startedAt)
    return t >= fromMs && t <= toMs
  })

  // --- provenance maps, built from the WHOLE session/order history ---
  const orderById = new Map(arr(orders).map((o) => [String(o.id || ''), o]))
  const phoneByDevice = new Map()   // deviceId -> { phone, name, via }
  const noteDevice = (dev, phone, name, via) => {
    const key = phoneKey(phone)
    if (!dev || !key) return
    if (!phoneByDevice.has(dev)) phoneByDevice.set(dev, { phone: String(phone), name: name || '', via })
  }
  for (const s of all) {
    if (s?.customerPhone) noteDevice(s.deviceId, s.customerPhone, s.customerName, 'device')
    const oid = s?.outcome?.orderId
    if (oid) {
      const o = orderById.get(String(oid))
      if (o?.customerPhone) noteDevice(s.deviceId, o.customerPhone, o.customerName, 'past-order')
    }
  }
  // Known customers, so a name can be shown where we have one.
  const custByPhone = new Map()
  for (const c of arr(customers)) {
    const k = phoneKey(c?.phone)
    if (k && !custByPhone.has(k)) custByPhone.set(k, c)
  }

  // --- the abandoned sessions themselves ---
  const abandoned = inWindow.filter((s) => num(sessionCounts(s).cartAdds) > 0 && !s?.outcome?.ordered)

  const rows = []
  let unreachable = 0
  for (const s of abandoned) {
    // What they actually put in the cart, with the qty the session recorded.
    const recs = sessionItems(s)
    const left = []
    for (const id of Object.keys(recs)) {
      const added = num(recs[id]?.added)
      if (added <= 0) continue
      const it = byId.get(id)
      const name = (it ? itemName(it, lang) : '') || String(recs[id]?.name || '')
      if (!name) continue
      left.push({ itemId: id, name, qty: added, price: it ? effectivePrice(it) : null, stillOnMenu: !!it && isItemOrderable(it) })
    }
    if (!left.length) continue
    left.sort((a, b) => b.qty - a.qty)

    // Value is priced from the CURRENT menu, and only when every line has a
    // price we actually hold. Otherwise it stays null rather than half-counted.
    const priced = left.filter((l) => num(l.price) > 0)
    const estValue = priced.length === left.length ? r2(left.reduce((a, l) => a + num(l.price) * l.qty, 0)) : null

    let phone = s?.customerPhone ? String(s.customerPhone) : ''
    let via = phone ? 'session' : ''
    let name = s?.customerName || ''
    if (!phone && s?.deviceId && phoneByDevice.has(s.deviceId)) {
      const hit = phoneByDevice.get(s.deviceId)
      phone = hit.phone
      via = hit.via
      name = name || hit.name
    }
    if (!phoneKey(phone)) { unreachable += 1; continue }
    const cust = custByPhone.get(phoneKey(phone))
    rows.push({
      sid: String(s.sid || s.id || ''),
      deviceId: String(s.deviceId || ''),
      at: num(s.startedAt) || null,
      lastAt: num(s.lastAt) || null,
      phone,
      phoneKey: phoneKey(phone),
      via,
      viaAr: via === 'session' ? 'سجّل بياناته في نفس الزيارة' : via === 'device' ? 'نفس الجهاز عرّف نفسه في زيارة أخرى' : 'نفس الجهاز صاحب طلب سابق يحمل رقماً',
      name: name || cust?.name || '',
      known: !!cust,
      items: left,
      estValue,
      reachedCheckout: num(sessionCounts(s).checkouts) > 0,
      abandonedAt: s?.outcome?.abandonedAt || null,
    })
  }

  // One message per person: keep their most recent abandoned cart.
  const byPhone = new Map()
  for (const r of rows) {
    const prev = byPhone.get(r.phoneKey)
    if (!prev || num(r.at) > num(prev.at)) byPhone.set(r.phoneKey, { ...r, sessionsAbandoned: (prev?.sessionsAbandoned || 0) + 1 })
    else byPhone.set(r.phoneKey, { ...prev, sessionsAbandoned: (prev.sessionsAbandoned || 0) + 1 })
  }
  const reachable = [...byPhone.values()].sort((a, b) => num(b.at) - num(a.at))

  const recoverable = reachable.reduce((a, r) => a + (r.estValue === null ? 0 : r.estValue), 0)
  const pricedRows = reachable.filter((r) => r.estValue !== null).length

  return {
    days: d,
    from: new Date(fromMs),
    to: now,
    sample: {
      sessionsLoaded: all.length,
      sessionsInWindow: inWindow.length,
      abandonedSessions: abandoned.length,
      distinctReachableGuests: reachable.length,
    },
    reachable,
    unreachable,
    // Phrased as a noun clause so it stays grammatical at every count — Arabic
    // verb agreement breaks on "1 ضيف تركوا".
    unreachableNote: unreachable > 0
      ? `عدد من ترك السلة دون أي رقم يمكن الوصول إليه: ${unreachable} — لا يمكن مراسلتهم، ولن نخترع رقماً`
      : '',
    // Priced from today's menu, for the carts where every line still has a
    // price. It is a value LEFT BEHIND, not a forecast of what you will recover.
    leftBehindValue: pricedRows ? r2(recoverable) : null,
    leftBehindPricedRows: pricedRows,
    leftBehindNote: 'محسوبة بأسعار القائمة الحالية للسلال التي تحمل كل أسطرها سعراً — قيمة متروكة، وليست توقّع استرجاع',
    abandonRate: rate(abandoned.length, inWindow.filter((s) => num(sessionCounts(s).cartAdds) > 0).length),
    thin: reachable.length < GROWTH_THRESHOLDS.MIN_ABANDONED,
    thinNote: reachable.length < GROWTH_THRESHOLDS.MIN_ABANDONED
      ? `عدد من يمكن الوصول إليهم ${reachable.length} فقط — قائمة أسماء، لا حملة`
      : '',
    limits: [
      'الجلسة لكل تبويب متصفح: هاتف واحد يتنقل بين الضيوف = جلسة واحدة',
      'ترك السلة قد يعني أن الضيف طلب من الموظف مباشرة، لا أنه غادر',
      'الأرقام مأخوذة من تعريف الضيف بنفسه أو من طلب سابق على نفس الجهاز — لا يوجد أي رقم مُستنتج',
    ],
  }
}

// The message references what they actually left. It promises NOTHING the venue
// has not configured — no discount, no reward, no "we saved your cart".
export function abandonedMessage(row, { venueName = '', lang = 'ar' } = {}) {
  const names = arr(row?.items).slice(0, 2).map((i) => `«${i.name}»`).join(' و')
  const more = arr(row?.items).length > 2 ? ` و${nItems(arr(row.items).length - 2)} أخرى` : ''
  const who = row?.name ? `${row.name}، ` : ''
  const place = venueName ? ` في ${venueName}` : ''
  if (lang === 'en') {
    const en = arr(row?.items).slice(0, 2).map((i) => `"${i.name}"`).join(' and ')
    return `${row?.name ? `${row.name}, ` : ''}you left ${en}${more ? ' and more' : ''} in your cart${venueName ? ` at ${venueName}` : ''} without completing the order. The menu is still open whenever you are ready.`
  }
  return `${who}تركت ${names}${more} في سلتك${place} دون إكمال الطلب. القائمة ما زالت مفتوحة متى أحببت.`
}

// A campaign draft in the EXACT shape Campaigns.jsx already consumes.
export function abandonedCampaignDraft(result, { venueName = '', lang = 'ar', rows = null } = {}) {
  const list = arr(rows || result?.reachable)
  const phones = list.map((r) => r.phone).filter(Boolean)
  const sample = list[0]
  return {
    title: lang === 'en' ? 'Abandoned cart recovery' : 'استرجاع السلة المتروكة',
    text: sample ? abandonedMessage(sample, { venueName, lang }) : '',
    purpose: lang === 'en'
      ? `Guests who added to cart and did not order in the last ${result?.days || 0} days`
      : `ضيوف أضافوا للسلة ولم يطلبوا خلال ${result?.days || 0} يوماً`,
    audience: { phones },
  }
}

// =====================================================================
// 3. الساعات الهادئة والتسعير الذكي
// =====================================================================
// Quiet windows come from forecast.peakWindows (which already restricts itself
// to hours the venue demonstrably operates). The discount is bounded by the
// WORST real margin among the items the offer would touch — a cart-wide offer
// applies to everything, so the weakest item sets the ceiling.

export function marginHeadroom({ items = [], materials = [], marginFloorPct = 15, itemIds = null } = {}) {
  const matById = new Map(arr(materials).map((m) => [m.id, m]))
  const floor = clamp(num(marginFloorPct), 0, 90) / 100
  const scope = itemIds ? new Set(arr(itemIds)) : null

  const rows = []
  let pricedCount = 0
  for (const it of arr(items)) {
    if (scope && !scope.has(it.id)) continue
    const price = effectivePrice(it)
    if (price <= 0) continue
    pricedCount += 1
    const cost = recipeCost(it, matById)
    if (cost <= 0) continue // 0 means UNKNOWN cost, never "free"
    const marginPct = ((price - cost) / price) * 100
    // Keep margin above the floor: p*(1-v) - c >= floor * p*(1-v)
    const maxDiscountPct = Math.floor(100 * (1 - cost / ((1 - floor) * price)))
    rows.push({ id: it.id, name: itemName(it), price: r2(price), cost: r2(cost), marginPct: Math.round(marginPct), maxDiscountPct })
  }

  if (!rows.length) {
    return {
      known: false,
      itemsWithCost: 0,
      itemsPriced: pricedCount,
      marginFloorPct: Math.round(num(marginFloorPct)),
      maxDiscountPct: null,
      bindingItem: null,
      rows: [],
      noteAr: 'لا توجد تكاليف وصفات محسوبة — لا يمكن تحديد سقف خصم مسنود بهامش حقيقي',
    }
  }
  rows.sort((a, b) => a.maxDiscountPct - b.maxDiscountPct)
  const binding = rows[0]
  return {
    known: true,
    itemsWithCost: rows.length,
    itemsPriced: pricedCount,
    marginFloorPct: Math.round(num(marginFloorPct)),
    // The weakest item binds the whole offer.
    maxDiscountPct: Math.max(0, binding.maxDiscountPct),
    bindingItem: binding,
    rows,
    // Counts sit in parentheses so the sentence stays grammatical at any value
    // (Arabic tamyeez changes with 1 / 2 / 3-10 / 11+).
    noteAr: `أقصى خصم آمن ${Math.max(0, binding.maxDiscountPct)}% يحدّده «${binding.name}» (هامشه ${binding.marginPct}%). أساس الحساب: الأصناف التي لها تكلفة وصفة (${rows.length}) من الأصناف المسعّرة (${pricedCount})`,
  }
}

export function quietHourPlan({
  orders = [], items = [], materials = [], offers = [],
  days = 30, now = new Date(), marginFloorPct = 15, top = 3, windowHours = 2,
} = {}) {
  const T = GROWTH_THRESHOLDS
  const d = Math.max(1, num(days) || 30)
  const peaks = peakWindows(orders, { days: d, now, top: 24 })
  const head = marginHeadroom({ items, materials, marginFloorPct })

  const sample = {
    windowDays: d,
    ordersInWindow: peaks.sampleOrders,
    daysWithOrders: peaks.daysWithOrders,
    openHours: peaks.openHours.length,
    openWeekdays: peaks.openWeekdays.length,
    buckets: peaks.buckets.length,
  }

  const busiest = peaks.busiest[0] || null
  if (!busiest || busiest.orders < T.MIN_PEAK_ORDERS) {
    return {
      ok: false,
      reasonAr: `أعلى فترة بها ${nOrders(busiest?.orders || 0)} فقط — لا يمكن تمييز الهدوء عن التذبذب العشوائي (الحد الأدنى ${T.MIN_PEAK_ORDERS})`,
      sample, headroom: head, windows: [], peaks,
    }
  }

  // Windows already covered by an active timed offer are not "opportunities".
  const coveredDays = new Set()
  for (const o of arr(offers)) {
    if (o?.active === false) continue
    if (!o?.startTime) continue
    for (const wd of arr(o.daysOfWeek)) coveredDays.add(`${wd}|${String(o.startTime).slice(0, 2)}`)
  }

  const windows = []
  let blockedByMargin = 0
  let alreadyCovered = 0
  let neverTraded = 0
  for (const q of peaks.quiet) {
    // forecast.peakWindows restricts the grid to hours and weekdays the venue
    // traded in AT ALL, but their intersection can still be a slot the venue has
    // never once been open for (Sunday 06:00 in a venue that opens early only on
    // weekdays). Scheduling a discount there would be advice about a shift that
    // does not exist, so a bucket with zero lifetime orders is refused.
    if (q.orders < T.MIN_QUIET_ORDERS) { neverTraded += 1; continue }
    if (busiest.orders - q.orders < T.MIN_QUIET_GAP) continue
    if (coveredDays.has(`${q.weekday}|${hourLabel(q.hour).slice(0, 2)}`)) { alreadyCovered += 1; continue }
    const endHour = Math.min(23, q.hour + Math.max(1, num(windowHours) || 2))
    const ceiling = head.known ? Math.min(head.maxDiscountPct, T.SUGGEST_MAX_PCT) : T.UNBACKED_PCT
    // The margin cannot carry ANY offer. That is a pricing finding, not an
    // absence of quiet hours — it is reported as its own reason below.
    if (head.known && ceiling < 5) { blockedByMargin += 1; continue }
    // Sit below the ceiling: a discount the margin merely survives is not a
    // discount worth training guests to wait for.
    const value = head.known
      ? clamp(Math.floor((ceiling * 0.7) / 5) * 5, 5, ceiling)
      : T.UNBACKED_PCT

    windows.push({
      id: `quiet-${q.weekday}-${q.hour}`,
      weekday: q.weekday,
      weekdayName: WEEKDAYS_AR[q.weekday],
      hour: q.hour,
      startTime: hourLabel(q.hour),
      endTime: hourLabel(endHour),
      orders: q.orders,
      ordersPerWeek: q.ordersPerWeek,
      revenue: q.revenue,
      peakOrders: busiest.orders,
      peakLabel: busiest.label,
      gap: busiest.orders - q.orders,
      suggestedValue: value,
      marginBacked: head.known,
      ceiling,
      whyAr: `${WEEKDAYS_AR[q.weekday]} ${hourLabel(q.hour)} سجّلت ${nOrders(q.orders)} خلال ${d} يوماً (${q.ordersPerWeek} أسبوعياً)، مقابل ${nOrders(busiest.orders)} في الذروة (${busiest.label})`,
      boundAr: head.known
        ? `الخصم المقترح ${value}% ضمن سقف ${ceiling}% يحدّده هامش «${head.bindingItem.name}»`
        : `الخصم المقترح ${value}% غير مسنود بهامش — لا توجد تكاليف وصفات، راجعه يدوياً قبل التفعيل`,
      numbers: {
        'طلبات الفترة الهادئة': `${q.orders}`,
        'أسبوعياً': `${q.ordersPerWeek}`,
        'إيراد الفترة': `${q.revenue}`,
        'طلبات الذروة': `${busiest.orders}`,
        'الفارق': `${busiest.orders - q.orders}`,
        'أيام فيها طلبات': `${peaks.daysWithOrders} من ${d}`,
        'سقف الخصم الآمن': head.known ? `${head.maxDiscountPct}%` : 'غير محسوب',
      },
      confidence: peaks.daysWithOrders < T.MIN_DAYS_WITH_ORDERS ? 'low' : confidenceFor(peaks.sampleOrders),
    })
    if (windows.length >= Math.max(1, num(top) || 3)) break
  }

  // A precise refusal. "No quiet window" and "quiet windows exist but your
  // margins cannot fund a discount" are completely different problems.
  let reasonAr = ''
  if (!windows.length) {
    if (blockedByMargin > 0) {
      reasonAr = `وُجدت ${blockedByMargin} فترة هادئة، لكن الهامش لا يحتمل أي خصم فوق أرضية ${head.marginFloorPct}% — سقف الخصم الآمن ${head.maxDiscountPct}% فقط، يحدّده «${head.bindingItem?.name || ''}». المشكلة تسعير وتكلفة، لا توقيت`
    } else if (alreadyCovered > 0) {
      reasonAr = `أهدأ الفترات مغطاة أصلاً بعروض مؤقتة مفعّلة (${alreadyCovered})`
    } else if (neverTraded > 0) {
      reasonAr = `أهدأ الفترات لم تسجّل أي طلب إطلاقاً (${neverTraded}) — الأرجح أنها خارج ساعات العمل الفعلية لتلك الأيام، لا فترات هادئة`
    } else {
      reasonAr = 'لا توجد فترة هادئة يتجاوز فارقها عن الذروة الضجيج الإحصائي'
    }
  }

  return {
    ok: windows.length > 0,
    reasonAr,
    blockedByMargin,
    alreadyCovered,
    neverTraded,
    sample,
    headroom: head,
    windows,
    peaks,
    limits: [
      'الهدوء محسوب على ساعات وأيام سجّلت فيها المنشأة طلبات فعلاً — الصفر خارج أوقات العمل ليس هدوءاً',
      'لا يوجد هنا أي توقّع لزيادة المبيعات: الأرقام المعروضة هي الحجم الحالي فقط',
    ],
  }
}

// A draft in the EXACT shape Offers.jsx openNewFromDraft() already consumes.
export function quietOfferDraft(w, { lang = 'ar' } = {}) {
  return {
    name: lang === 'en'
      ? `Quiet hour - ${WEEKDAYS_AR[w.weekday]} ${w.startTime}`
      : `ساعة هادئة - ${w.weekdayName} ${w.startTime}`,
    type: 'percent',
    value: w.suggestedValue,
    scope: 'cart',
    itemIds: [],
    window: { daysOfWeek: [w.weekday], startTime: w.startTime, endTime: w.endTime },
  }
}

// =====================================================================
// 4. صحة المنيو
// =====================================================================
// Weights sum to 100 across MEASURABLE checks only. A check we cannot evaluate
// (no recipes at all, no orders at all) is EXCLUDED and its weight redistributed
// — scoring a venue on a test we never ran would be a lie. The formula string is
// returned so the UI can show exactly how the number was produced.

const HEALTH_CHECKS = [
  { key: 'noPrice', weight: 20, labelAr: 'بلا سعر', labelEn: 'No price', fixTab: 'basics', whyAr: 'الصنف بلا سعر لا يمكن طلبه' },
  { key: 'belowCost', weight: 18, labelAr: 'سعره لا يغطي تكلفته', labelEn: 'Priced below cost', fixTab: 'recipe', whyAr: 'كل بيعة من هذا الصنف تخسر' },
  { key: 'noPhoto', weight: 15, labelAr: 'بلا صورة', labelEn: 'No photo', fixTab: 'images', whyAr: 'الصنف بلا صورة يُتخطّى في التصفح' },
  { key: 'noCategory', weight: 12, labelAr: 'بلا تصنيف صالح', labelEn: 'No valid category', fixTab: 'basics', whyAr: 'لا يظهر تحت أي قسم في القائمة' },
  { key: 'neverOrdered', weight: 12, labelAr: 'لم يُطلب إطلاقاً', labelEn: 'Never ordered', fixTab: 'basics', whyAr: 'يشغل مساحة في القائمة دون مبيعات' },
  { key: 'noDescription', weight: 10, labelAr: 'بلا وصف', labelEn: 'No description', fixTab: 'basics', whyAr: 'الوصف هو ما يبيع الصنف عند التردد' },
  { key: 'duplicateName', weight: 8, labelAr: 'اسم مكرر', labelEn: 'Duplicate name', fixTab: 'basics', whyAr: 'الاسم المكرر يربك الضيف والمطبخ' },
  { key: 'missingEnglish', weight: 5, labelAr: 'بلا اسم إنجليزي', labelEn: 'No English name', fixTab: 'basics', whyAr: 'الضيوف غير الناطقين بالعربية لا يقرؤونه' },
]

export function menuHealth({
  items = [], categories = [], orders = [], materials = [],
  days = GROWTH_THRESHOLDS.STALE_DAYS, now = new Date(), lang = 'ar',
} = {}) {
  const T = GROWTH_THRESHOLDS
  const d = Math.max(1, num(days) || T.STALE_DAYS)
  const list = arr(items)
  const catIds = new Set(arr(categories).map((c) => c.id))
  const matById = new Map(arr(materials).map((m) => [m.id, m]))
  const nowMs = now.getTime()

  // Items sold at least once in the window (any non-dead order).
  const sold = new Set()
  const inWin = ordersInWindow(orders, d, now, countsAsSale)
  for (const o of inWin) for (const id of lineIds(o)) sold.add(id)

  // Duplicate names, by normalized Arabic name.
  const nameTally = new Map()
  for (const it of list) {
    const k = norm(it?.nameAr || it?.nameEn)
    if (!k) continue
    nameTally.set(k, (nameTally.get(k) || 0) + 1)
  }

  const anyRecipeCost = list.some((it) => recipeCost(it, matById) > 0)
  const hits = Object.fromEntries(HEALTH_CHECKS.map((c) => [c.key, []]))
  const applicable = Object.fromEntries(HEALTH_CHECKS.map((c) => [c.key, 0]))
  let tooNew = 0

  for (const it of list) {
    const name = itemName(it, lang) || String(it?.id || '')
    const ref = { id: it.id, name }
    const price = effectivePrice(it)
    const createdMs = toMs(it?.createdAt)

    // noPrice — every item is applicable
    applicable.noPrice += 1
    if (price <= 0) hits.noPrice.push(ref)

    // noPhoto
    applicable.noPhoto += 1
    if (!String(it?.imageUrl || '').trim() && !arr(it?.images).length) hits.noPhoto.push(ref)

    // noDescription
    applicable.noDescription += 1
    if (!String(it?.descAr || '').trim() && !String(it?.descEn || '').trim()) hits.noDescription.push(ref)

    // noCategory — only measurable when the venue actually HAS categories
    if (catIds.size) {
      applicable.noCategory += 1
      if (!it?.categoryId || !catIds.has(it.categoryId)) hits.noCategory.push(ref)
    }

    // missingEnglish
    applicable.missingEnglish += 1
    if (!String(it?.nameEn || '').trim()) hits.missingEnglish.push(ref)

    // duplicateName
    applicable.duplicateName += 1
    const k = norm(it?.nameAr || it?.nameEn)
    if (k && (nameTally.get(k) || 0) > 1) hits.duplicateName.push(ref)

    // belowCost — only for items whose recipe cost we actually know
    const cost = recipeCost(it, matById)
    if (cost > 0 && price > 0) {
      applicable.belowCost += 1
      if (cost >= price) hits.belowCost.push({ ...ref, price: r2(price), cost: r2(cost) })
    }

    // neverOrdered — an item younger than the grace period CANNOT be judged:
    // it may simply not have had its chance yet.
    if (inWin.length > 0) {
      const ageDays = createdMs ? (nowMs - createdMs) / 86400000 : null
      const tooYoung = ageDays !== null && ageDays < T.NEW_ITEM_GRACE_DAYS
      if (tooYoung) {
        tooNew += 1
      } else {
        applicable.neverOrdered += 1
        if (!sold.has(it.id)) hits.neverOrdered.push(ref)
      }
    }
  }

  // --- score ---
  const findings = HEALTH_CHECKS.map((c) => {
    const app = applicable[c.key]
    const measurable = app > 0
    const affected = hits[c.key].length
    return {
      ...c,
      measurable,
      applicable: app,
      affected,
      share: measurable ? affected / app : null,
      items: hits[c.key],
      unmeasurableAr: measurable ? '' : (
        c.key === 'belowCost' ? (anyRecipeCost ? 'لا يوجد صنف مسعّر له تكلفة وصفة' : 'لا توجد وصفات أو تكاليف مواد مسجّلة')
          : c.key === 'neverOrdered' ? `لا توجد طلبات خلال ${d} يوماً للمقارنة`
            : c.key === 'noCategory' ? 'لا توجد تصنيفات معرّفة أصلاً'
              : 'غير قابل للقياس بالبيانات الحالية'
      ),
    }
  })

  const measured = findings.filter((f) => f.measurable)
  const weightSum = measured.reduce((a, f) => a + f.weight, 0)
  let score = null
  let formulaAr = ''
  if (!list.length) {
    formulaAr = 'لا توجد أصناف في القائمة — لا يمكن حساب درجة'
  } else if (!weightSum) {
    formulaAr = 'لا يوجد فحص قابل للقياس بالبيانات الحالية — لا درجة'
  } else {
    // Weights renormalized over the checks we could actually run.
    const penalty = measured.reduce((a, f) => a + (f.weight / weightSum) * f.share * 100, 0)
    score = clamp(Math.round(100 - penalty), 0, 100)
    formulaAr = `الدرجة = 100 − Σ ( وزن الفحص ÷ ${weightSum} × نسبة الأصناف المتأثرة × 100 )، على الفحوص القابلة للقياس (${measured.length} من ${HEALTH_CHECKS.length})`
  }

  findings.sort((a, b) => {
    if (a.measurable !== b.measurable) return a.measurable ? -1 : 1
    return (b.weight * (b.share || 0)) - (a.weight * (a.share || 0))
  })

  return {
    days: d,
    score,
    grade: score === null ? null : score >= 85 ? 'good' : score >= 65 ? 'fair' : 'poor',
    formulaAr,
    weightSum,
    measurableChecks: measured.length,
    totalChecks: HEALTH_CHECKS.length,
    findings,
    sample: {
      items: list.length,
      categories: catIds.size,
      ordersInWindow: inWin.length,
      itemsSoldInWindow: sold.size,
      materials: arr(materials).length,
      itemsTooNewToJudge: tooNew,
    },
    notes: [
      tooNew > 0 ? `عدد الأصناف المضافة خلال آخر ${T.NEW_ITEM_GRACE_DAYS} يوماً واستُثنيت من فحص «لم يُطلب»: ${tooNew} — من غير العدل الحكم عليها قبل أن تأخذ فرصتها` : '',
      inWin.length === 0 ? `لا توجد طلبات خلال ${d} يوماً — فحص «لم يُطلب» غير محسوب ووزنه أُعيد توزيعه` : '',
      !anyRecipeCost ? 'لا توجد تكاليف وصفات — فحص «السعر تحت التكلفة» غير محسوب ووزنه أُعيد توزيعه' : '',
    ].filter(Boolean),
  }
}

// =====================================================================
// 5. إعادة الطلب بضغطة
// =====================================================================

// REQUIRED EXPORT. The guest's most recent real order, normalized. null when
// there is no phone or no order — never an empty shell that renders as "0".
export function lastOrderFor(orders, phone) {
  const key = phoneKey(phone)
  if (!key) return null
  let best = null
  let bestAt = -1
  for (const o of arr(orders)) {
    if (!countsAsSale(o)) continue
    if (phoneKey(o?.customerPhone) !== key) continue
    const d = orderDate(o)
    const t = d ? d.getTime() : 0
    if (t > bestAt) { bestAt = t; best = o }
  }
  if (!best) return null
  return {
    orderId: String(best.id || ''),
    at: bestAt > 0 ? new Date(bestAt) : null,
    status: String(best.status || ''),
    total: r2(netTotal(best)),
    lines: arr(best.items).map((l) => ({
      itemId: l?.itemId || null,
      name: String(l?.nameAr || l?.nameEn || '').trim(),
      qty: num(l?.qty) || 1,
      variantKey: l?.variantKey || null,
      unitPrice: r2(num(l?.unitPrice)),
    })),
  }
}

// A basket's identity: which items, in which quantities. Variant included,
// because a large latte and a small latte are not the same habit.
function basketSignature(o) {
  const parts = arr(o?.items)
    .filter((l) => l?.itemId)
    .map((l) => `${l.itemId}:${l.variantKey || ''}:${num(l.qty) || 1}`)
    .sort()
  return parts.join('|')
}

// The guest's MOST REPEATED basket, falling back to their last order when no
// basket repeats. `kind` says which one you got — the UI must not call a single
// visit "your usual".
export function usualOrder(orders, phone, { items = [], now = new Date(), lang = 'ar' } = {}) {
  const key = phoneKey(phone)
  const empty = { found: false, reason: 'no-phone', kind: null, lines: [], dropped: [], timesOrdered: 0, ofOrders: 0 }
  if (!key) return empty

  const mine = arr(orders)
    .filter((o) => countsAsSale(o) && phoneKey(o?.customerPhone) === key)
    .map((o) => ({ o, d: orderDate(o) }))
    .filter((x) => x.d)
    .sort((a, b) => b.d - a.d)
  if (!mine.length) return { ...empty, reason: 'no-orders' }

  const groups = new Map()
  for (const x of mine) {
    const sig = basketSignature(x.o)
    if (!sig) continue
    const g = groups.get(sig) || { sig, count: 0, latest: x }
    g.count += 1
    if (x.d > g.latest.d) g.latest = x
    groups.set(sig, g)
  }

  const ranked = [...groups.values()].sort((a, b) => b.count - a.count || b.latest.d - a.latest.d)
  const top = ranked[0] || null
  const isHabit = !!top && top.count >= GROWTH_THRESHOLDS.MIN_REPEATS
  const chosen = isHabit ? top.latest : mine[0]
  const kind = isHabit ? 'usual' : 'last'

  const byId = new Map(arr(items).map((i) => [i.id, i]))
  const lines = []
  const dropped = []
  let priceChanged = false

  for (const l of arr(chosen.o.items)) {
    const histName = String(l?.nameAr || l?.nameEn || '').trim()
    const qty = num(l?.qty) || 1
    if (!l?.itemId) { dropped.push({ name: histName, reason: 'no-id', reasonAr: 'سطر قديم بلا معرّف صنف' }); continue }
    const it = byId.get(l.itemId)
    if (!it) { dropped.push({ itemId: l.itemId, name: histName, reason: 'removed', reasonAr: 'حُذف من القائمة' }); continue }
    if (!isItemOrderable(it)) { dropped.push({ itemId: l.itemId, name: itemName(it, lang) || histName, reason: 'unavailable', reasonAr: it.available === false ? 'غير متاح حالياً' : 'نفد من المخزون' }); continue }

    // Variant may have been renamed, repriced or removed since. Keys follow the
    // system convention `v.key || \`v${index}\`` (see RecipeEditor).
    let unitPrice = effectivePrice(it)
    let variantKey = l.variantKey || null
    let variantName = ''
    if (variantKey) {
      const vs = arr(it.variants)
      const i = vs.findIndex((x, n) => (x?.key || `v${n}`) === variantKey)
      const v = i >= 0 ? vs[i] : null
      if (v && num(v.price) > 0) {
        unitPrice = num(v.price)
        variantName = String(v.nameAr || v.nameEn || '').trim()
      } else {
        // The size they used to order no longer exists — fall back to the base
        // price and SAY the variant was dropped rather than silently resizing.
        variantKey = null
      }
    }
    if (unitPrice <= 0) { dropped.push({ itemId: l.itemId, name: itemName(it, lang) || histName, reason: 'no-price', reasonAr: 'بلا سعر في القائمة الحالية' }); continue }
    if (num(l?.unitPrice) > 0 && r2(num(l.unitPrice)) !== r2(unitPrice)) priceChanged = true

    lines.push({
      itemId: l.itemId,
      item: it,
      name: itemName(it, lang) || histName,
      qty,
      variantKey,
      variantName,
      variantDropped: !!l.variantKey && !variantKey,
      unitPrice: r2(unitPrice),
      oldUnitPrice: num(l?.unitPrice) > 0 ? r2(num(l.unitPrice)) : null,
      lineTotal: r2(unitPrice * qty),
    })
  }

  return {
    found: lines.length > 0,
    reason: lines.length ? '' : 'nothing-available',
    reasonAr: lines.length ? '' : 'لم يبقَ من هذا الطلب صنف متاح اليوم',
    kind,
    // How strong the habit is — shown, never hidden behind "your usual".
    timesOrdered: isHabit ? top.count : 1,
    ofOrders: mine.length,
    at: chosen.d,
    orderId: String(chosen.o.id || ''),
    lines,
    dropped,
    // Recomputed from TODAY's menu, never the historical total.
    total: r2(lines.reduce((a, l) => a + l.lineTotal, 0)),
    historicalTotal: r2(netTotal(chosen.o)),
    priceChanged,
    droppedNoteAr: dropped.length
      ? `أُسقط ${nItems(dropped.length)} من طلبك السابق: ${dropped.map((x) => `«${x.name || 'صنف'}» (${x.reasonAr})`).join('، ')}`
      : '',
    labelAr: isHabit
      ? `طلبك المعتاد — تكرر ${top.count} من ${mine.length} ${mine.length === 2 ? 'طلبين' : 'طلباً'}`
      : `آخر طلب لك${mine.length > 1 ? ` من ${mine.length} طلباً` : ''}`,
    honestNote: isHabit ? '' : 'لم يتكرر أي طلب بعد، لذا هذا آخر طلب وليس عادة',
    now,
  }
}

// Admin view: the guests with a real repeated habit, so the venue can see the
// feature has something to work with (and how much).
export function repeatGuests({ orders = [], items = [], limit = 20, lang = 'ar' } = {}) {
  const byPhone = new Map()
  for (const o of arr(orders)) {
    if (!countsAsSale(o)) continue
    const k = phoneKey(o?.customerPhone)
    if (!k) continue
    const g = byPhone.get(k) || { key: k, phone: String(o.customerPhone), name: '', orders: 0 }
    g.orders += 1
    if (!g.name && o.customerName) g.name = String(o.customerName)
    byPhone.set(k, g)
  }
  const rows = []
  for (const g of byPhone.values()) {
    if (g.orders < GROWTH_THRESHOLDS.MIN_REPEATS) continue
    const u = usualOrder(orders, g.phone, { items, lang })
    if (!u.found) continue
    rows.push({
      ...g,
      kind: u.kind,
      timesOrdered: u.timesOrdered,
      ofOrders: u.ofOrders,
      lines: u.lines.length,
      dropped: u.dropped.length,
      total: u.total,
      at: u.at,
      labelAr: u.labelAr,
    })
  }
  rows.sort((a, b) => (b.kind === 'usual') - (a.kind === 'usual') || b.timesOrdered - a.timesOrdered || b.ofOrders - a.ofOrders)
  return {
    rows: rows.slice(0, Math.max(1, num(limit) || 20)),
    totalGuestsWithPhone: byPhone.size,
    withRealHabit: rows.filter((r) => r.kind === 'usual').length,
    ordersScanned: arr(orders).filter(countsAsSale).length,
  }
}

// =====================================================================
// Cross-feature snapshot — the ONLY thing an AI layer may reason over.
// =====================================================================
export function growthSnapshot({ orders = [], items = [], categories = [], materials = [], offers = [], sessions = [], customers = [], days = 30, now = new Date() } = {}) {
  const idx = basketIndex(orders, { days: Math.max(days, 90), now })
  const pairs = topPairings(idx, { items, limit: 8 })
  const carts = abandonedCarts({ sessions, orders, customers, items, days: 14, now })
  const quiet = quietHourPlan({ orders, items, materials, offers, days, now })
  const health = menuHealth({ items, categories, orders, materials, now })
  const repeat = repeatGuests({ orders, items, limit: 5 })
  return {
    generatedAt: now.getTime(),
    windowDays: days,
    upsell: { ok: pairs.ok, sample: pairs.sample, top: pairs.rows.map((r) => ({ a: r.aName, b: r.bName, together: r.together, of: r.anchorOrders, lift: r.lift })) },
    abandoned: { sample: carts.sample, reachable: carts.reachable.length, unreachable: carts.unreachable, leftBehindValue: carts.leftBehindValue, thin: carts.thin },
    quietHours: { ok: quiet.ok, reason: quiet.reasonAr, marginKnown: quiet.headroom.known, maxDiscountPct: quiet.headroom.maxDiscountPct, windows: quiet.windows.map((w) => ({ when: `${w.weekdayName} ${w.startTime}`, orders: w.orders, peak: w.peakOrders, suggested: w.suggestedValue })) },
    menuHealth: { score: health.score, formula: health.formulaAr, sample: health.sample, worst: health.findings.filter((f) => f.measurable && f.affected > 0).slice(0, 4).map((f) => ({ check: f.labelAr, affected: f.affected, of: f.applicable })) },
    reorder: { guestsWithPhone: repeat.totalGuestsWithPhone, withRealHabit: repeat.withRealHabit, ordersScanned: repeat.ordersScanned },
    guard: 'أجب فقط من هذه الأرقام. لا تقدّر، ولا تتوقع زيادة مبيعات — لا يوجد في هذا الملخص أي رقم توقّعي.',
  }
}
