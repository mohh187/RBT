// Cloud Function: send a push notification to a tenant's staff devices on every
// new order, so the cashier is alerted even when the app is fully closed.
// Deploy: requires the Blaze plan → `firebase deploy --only functions`.
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { getMessaging } = require('firebase-admin/messaging')
const { getAuth } = require('firebase-admin/auth')

initializeApp()

// Send an FCM multicast in chunks of 500 (the SDK's hard cap) and prune dead
// token docs from the responses. `docs` are Firestore snapshots with a `.token`.
async function multicastChunked(docs, message) {
  const dels = []
  for (let i = 0; i < docs.length; i += 500) {
    const group = docs.slice(i, i + 500)
    const tokens = group.map((d) => d.data().token).filter(Boolean)
    if (!tokens.length) continue
    const res = await getMessaging().sendEachForMulticast({ ...message, tokens })
    res.responses.forEach((r, j) => {
      if (!r.success) {
        const code = (r.error && r.error.code) || ''
        if (code.includes('not-registered') || code.includes('invalid-argument') || code.includes('invalid-registration')) dels.push(group[j].ref.delete())
      }
    })
  }
  await Promise.all(dels)
}

// Push a notification to a tenant's staff devices; prunes dead tokens.
async function pushToStaff(db, tid, notification, data) {
  const snap = await db.collection(`tenants/${tid}/pushTokens`).get()
  if (!snap.docs.length) return
  await multicastChunked(snap.docs, {
    notification, data: data || {},
    webpush: { fcmOptions: { link: (data && data.url) || '/admin' }, notification: { icon: '/favicon.svg' } },
  })
}

// ---- offer evaluation (ported from src/lib/offers.js) — used to validate
// diner-supplied discounts server-side so an order can't be discounted to free. ----
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100 }
function isOfferActive(offer, now) {
  if (!offer || offer.active === false) return false
  const ts = now.getTime()
  if (offer.startsAt && ts < Number(offer.startsAt)) return false
  if (offer.endsAt && ts > Number(offer.endsAt)) return false
  if (Array.isArray(offer.daysOfWeek) && offer.daysOfWeek.length && !offer.daysOfWeek.includes(now.getDay())) return false
  if (offer.startTime && offer.endTime) {
    const cur = now.getHours() * 60 + now.getMinutes()
    const [sh, sm] = String(offer.startTime).split(':').map(Number)
    const [eh, em] = String(offer.endTime).split(':').map(Number)
    const s = sh * 60 + sm, e = eh * 60 + em
    if (s <= e) { if (cur < s || cur > e) return false } else if (cur < s && cur > e) return false
  }
  return true
}
function offerBase(offer, cart, subtotal) {
  if (offer.scope === 'category' && offer.categoryId) return cart.filter((l) => l.categoryId === offer.categoryId).reduce((s, l) => s + l.unitPrice * l.qty, 0)
  if (offer.scope === 'item' && offer.itemId) return cart.filter((l) => l.itemId === offer.itemId).reduce((s, l) => s + l.unitPrice * l.qty, 0)
  return subtotal
}
function discountOf(offer, base) {
  if (base <= 0) return 0
  const d = offer.type === 'percent' ? base * (Number(offer.value) || 0) / 100 : Math.min(Number(offer.value) || 0, base)
  return round2(Math.max(0, d))
}
// Largest legitimate offer discount for this cart (mirrors evaluateOffers).
function bestOfferDiscount(offers, cart, subtotal, couponCode, isMember, now) {
  const code = (couponCode || '').trim().toUpperCase()
  let best = 0
  for (const o of offers || []) {
    if (!isOfferActive(o, now)) continue
    if (o.membersOnly && !isMember) continue
    if (subtotal < (Number(o.minSubtotal) || 0)) continue
    if (o.code) { if (!code || o.code.toUpperCase() !== code) continue } else if (o.autoApply === false) continue
    const d = discountOf(o, offerBase(o, cart, subtotal))
    if (d > best) best = d
  }
  return best
}

exports.onNewOrder = onDocumentCreated('tenants/{tid}/orders/{oid}', async (event) => {
  const order = event.data && event.data.data()
  if (!order || order.status !== 'pending') return
  const tid = event.params.tid
  const db = getFirestore()

  // 1. Fetch item documents of all items in the order
  const lines = order.items || []
  const ids = [...new Set(lines.map((l) => l.itemId).filter(Boolean))]
  const itemDocs = {}
  await Promise.all(ids.map(async (itemId) => {
    const snap = await db.doc(`tenants/${tid}/items/${itemId}`).get()
    if (snap.exists) itemDocs[itemId] = snap.data()
  }))

  // 2. Validate prices and finished-goods stock (simple mode); build a server cart.
  let expectedSubtotal = 0
  const serverCart = []
  let cheapestDrink = Infinity
  let drinkUnits = 0
  for (const line of lines) {
    const item = itemDocs[line.itemId]
    if (!item) {
      await event.data.ref.update({
        status: 'cancelled',
        cancelReason: 'بعض الأصناف المطلوبة غير متوفرة حالياً.',
        stockRestored: true
      })
      return
    }

    // Check simple mode stock
    if (item.trackStock && item.stockMode === 'simple' && (Number(item.stock) || 0) < (line.qty || 1)) {
      await event.data.ref.update({
        status: 'cancelled',
        cancelReason: `عذراً، الصنف (${item.nameAr || item.nameEn}) نفد من المخزون.`,
        stockRestored: true
      })
      return
    }

    let unitPrice = Number(item.price) || 0
    if (line.variantKey) {
      const variant = (item.variants || []).find((v) => v.key === line.variantKey)
      if (variant) unitPrice = Number(variant.price) || 0
    }

    let modsPrice = 0
    for (const mod of (line.modifiers || [])) {
      modsPrice += Number(mod.price) || 0
    }

    const qty = line.qty || 1
    const effUnit = unitPrice + modsPrice
    expectedSubtotal += effUnit * qty
    serverCart.push({ itemId: line.itemId, categoryId: item.categoryId, unitPrice: effUnit, qty, countsForLoyalty: !!item.countsForLoyalty })
    if (item.countsForLoyalty) { drinkUnits += qty; if (effUnit < cheapestDrink) cheapestDrink = effUnit }
  }
  if (!isFinite(cheapestDrink)) cheapestDrink = 0

  // 2b. Validate discounts SERVER-SIDE (client discount fields are untrusted).
  // Compute the maximum legitimate discount and reject if the order claims more.
  const now = new Date()
  let offerMax = 0
  try {
    const offersSnap = await db.collection(`tenants/${tid}/offers`).get()
    offerMax = bestOfferDiscount(offersSnap.docs.map((d) => d.data()), serverCart, expectedSubtotal, order.couponCode, !!order.memberCardToken, now)
  } catch (_) { offerMax = 0 }
  // Member (VIP) discount — from the public card mirror, capped by its discountPct.
  // NOTE: round to HALALAS (2 decimals) — whole-riyal rounding used to make the
  // server's cap SMALLER than the client's correct 2-decimal discount (e.g. 10%
  // of 14 → client 1.40, server 1) and legitimate orders were auto-cancelled.
  const round2 = (x) => Math.round(x * 100) / 100
  const memberBase = Math.max(0, expectedSubtotal - offerMax)
  let memberMax = 0
  if (order.memberCardToken) {
    try {
      const cardSnap = await db.doc(`tenants/${tid}/memberCards/${order.memberCardToken}`).get()
      if (cardSnap.exists && cardSnap.data().active !== false) {
        const pct = Number(cardSnap.data().discountPct) || 0
        memberMax = round2(memberBase * pct / 100)
      }
    } catch (_) { /* ignore */ }
  }
  // Fallback: membership recognized by PHONE (cashier orders and phone-recognized
  // menu members carry no card token) — validate against the customer record.
  if (!memberMax && (Number(order.memberDiscount) || 0) > 0) {
    const digits = String(order.customerPhone || '').replace(/[^0-9]/g, '')
    if (digits) {
      try {
        const custSnap = await db.doc(`tenants/${tid}/customers/${digits}`).get()
        const m = custSnap.exists ? custSnap.data().membership : null
        if (m && m.active) memberMax = round2(memberBase * (Number(m.discountPct) || 0) / 100)
      } catch (_) { /* ignore */ }
    }
  }
  // Loyalty redemption — one free drink, and only if the customer actually has rewards.
  let loyaltyMax = 0
  if (order.loyaltyRedeemed && cheapestDrink > 0) {
    const digits = String(order.customerPhone || '').replace(/[^0-9]/g, '')
    if (digits) {
      try {
        const custSnap = await db.doc(`tenants/${tid}/customers/${digits}`).get()
        if (custSnap.exists && (Number(custSnap.data().rewards) || 0) > 0) loyaltyMax = cheapestDrink
      } catch (_) { /* ignore */ }
    }
  }
  const expectedMinTotal = Math.max(0, expectedSubtotal - offerMax - loyaltyMax - memberMax)
  if ((Number(order.total) || 0) < expectedMinTotal - 0.05) {
    await event.data.ref.update({
      status: 'cancelled',
      cancelReason: 'تم إلغاء الطلب تلقائياً بسبب عدم تطابق أسعار الحساب الإجمالية.',
      stockRestored: true
    })
    return
  }

  // 3. Check raw material stock for recipe mode items
  const usage = {}
  const addUsage = (recipeLines, qty) => (recipeLines || []).forEach((r) => {
    if (r.materialId) usage[r.materialId] = (usage[r.materialId] || 0) + (Number(r.qty) || 0) * (qty || 1)
  })

  for (const line of lines) {
    const item = itemDocs[line.itemId]
    if (item && item.stockMode === 'recipe') {
      const recipe = (line.variantKey && item.variantRecipes && item.variantRecipes[line.variantKey]) || item.recipe || []
      addUsage(recipe, line.qty)
    }
    (line.modifiers || []).forEach((mod) => addUsage(mod.recipe, line.qty))
  }

  const entries = Object.entries(usage).filter(([, q]) => q > 0)
  if (entries.length > 0) {
    const matDocs = {}
    await Promise.all(entries.map(async ([mid]) => {
      const snap = await db.doc(`tenants/${tid}/materials/${mid}`).get()
      if (snap.exists) matDocs[mid] = snap.data()
    }))

    for (const [mid, reqQty] of entries) {
      const mat = matDocs[mid]
      const stock = mat ? (Number(mat.stockQty) || 0) : 0
      if (stock < reqQty) {
        const matName = mat ? (mat.nameAr || mat.nameEn || 'المكونات') : 'المكونات'
        await event.data.ref.update({
          status: 'cancelled',
          cancelReason: `عذراً، بعض المكونات غير كافية لتحضير الطلب (${matName}).`,
          stockRestored: true
        })
        return
      }
    }
  }


  // 4. Passed validation → the server is the authority for finished-goods stock
  // (the client decrementStock is permission-denied for anonymous diners). Also
  // overwrite the client-supplied drinkUnits with the server value (loyalty integrity).
  if (!order.stockDecremented) {
    await Promise.all(lines.filter((l) => l.itemId && (l.qty || 0) > 0).map((l) =>
      // soldCount powers the 'auto' (best-sellers) featured strip on the menu.
      db.doc(`tenants/${tid}/items/${l.itemId}`).update({ stock: FieldValue.increment(-(l.qty || 1)), soldCount: FieldValue.increment(l.qty || 1) }).catch(() => {})
    ))
    await event.data.ref.update({ drinkUnits, stockDecremented: true }).catch(() => {})
  }

  const tokensSnap = await db.collection(`tenants/${tid}/pushTokens`).get()
  const docs = tokensSnap.docs
  const tokens = docs.map((d) => d.data().token).filter(Boolean)
  if (!tokens.length) return

  const code = order.code ? `#${order.code}` : ''
  const table = order.tableLabel || (order.orderType === 'takeaway' ? 'سفري' : 'طلب')

  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: 'طلب جديد', body: `${table} ${code} · ${order.total || 0}` },
    data: { url: '/cashier', tag: 'order' },
    webpush: {
      fcmOptions: { link: '/cashier' },
      notification: { icon: '/favicon.svg', requireInteraction: true },
    },
  })

  // Remove tokens that are no longer valid.
  const dels = []
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = (r.error && r.error.code) || ''
      if (code.includes('not-registered') || code.includes('invalid-argument') || code.includes('invalid-registration')) {
        dels.push(docs[i].ref.delete())
      }
    }
  })
  await Promise.all(dels)
})

// Notify staff when a diner requests a table booking (advance reservation).
exports.onNewReservation = onDocumentCreated('tenants/{tid}/reservations/{rid}', async (event) => {
  const r = event.data && event.data.data()
  if (!r || r.kind !== 'table' || r.status !== 'requested') return
  const db = getFirestore()
  const when = [r.date, r.time].filter(Boolean).join(' ')
  await pushToStaff(db, event.params.tid, { title: 'حجز طاولة جديد', body: `${r.name || 'ضيف'} · ${r.partySize || 1} · ${r.tableLabel || 'أي طاولة'}${when ? ' · ' + when : ''}` }, { url: '/admin/operations', tag: 'booking' }).catch(() => {})
})

// ---------- scheduled automation (Cron) — needs Blaze + Cloud Scheduler ----------

// Daily end-of-day summary pushed to each venue's staff.
exports.dailySummary = onSchedule({ schedule: '0 22 * * *', timeZone: 'Asia/Riyadh' }, async () => {
  const db = getFirestore()
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const tenants = await db.collection('tenants').get()
  for (const t of tenants.docs) {
    const tid = t.id
    const snap = await db.collection(`tenants/${tid}/orders`).where('createdAt', '>=', start).get().catch(() => null)
    if (!snap || snap.empty) continue
    const orders = snap.docs.map((d) => d.data())
    const settled = orders.filter((o) => ['paid', 'served', 'refunded'].includes(o.status))
    const revenue = Math.round(settled.reduce((s, o) => s + (o.total || 0) - (o.status === 'refunded' ? ((o.refund && o.refund.amount) || 0) : 0), 0))
    await pushToStaff(db, tid, { title: 'ملخّص اليوم', body: `${orders.length} طلب · المبيعات ${revenue} ${t.data().currency || ''}` }, { url: '/admin', tag: 'summary' }).catch(() => {})
  }
})

// #2 Abandoned online carts: an order held 'awaiting_payment' whose payment never
// completed is expired after 20 min so it never lingers or pollutes reports. It was
// hidden from staff the whole time; a late payment still re-activates it (settle
// treats 'expired' like 'awaiting_payment'). collectionGroup keeps it O(1) per run.
exports.expireUnpaidOrders = onSchedule({ schedule: 'every 15 minutes', timeZone: 'Asia/Riyadh' }, async () => {
  const db = getFirestore()
  const cutoff = new Date(Date.now() - 20 * 60 * 1000)
  const snap = await db.collectionGroup('orders')
    .where('status', '==', 'awaiting_payment')
    .where('createdAt', '<', cutoff)
    .limit(400).get().catch(() => null)
  if (!snap || snap.empty) return
  const batch = db.batch()
  snap.docs.forEach((d) => batch.update(d.ref, {
    status: 'expired',
    cancelReason: 'انتهت مهلة الدفع دون إتمامه.',
    statusHistory: FieldValue.arrayUnion({ status: 'expired', at: Date.now(), by: 'system' }),
    updatedAt: FieldValue.serverTimestamp(),
  }))
  await batch.commit().catch(() => {})
})

// Morning low-stock alert pushed to staff when materials are at/below reorder level.
exports.lowStockCheck = onSchedule({ schedule: '0 8 * * *', timeZone: 'Asia/Riyadh' }, async () => {
  const db = getFirestore()
  const tenants = await db.collection('tenants').get()
  for (const t of tenants.docs) {
    const tid = t.id
    const snap = await db.collection(`tenants/${tid}/materials`).get().catch(() => null)
    if (!snap || snap.empty) continue
    const low = snap.docs.map((d) => d.data()).filter((m) => (m.stockQty || 0) <= (Number(m.reorderLevel) || 0))
    if (!low.length) continue
    const names = low.slice(0, 5).map((m) => m.nameAr).join('، ')
    await pushToStaff(db, tid, { title: 'تنبيه: نقص مخزون', body: `${low.length} مادة منخفضة: ${names}` }, { url: '/admin/inventory', tag: 'lowstock' }).catch(() => {})
  }
})

// Secure proxy for client-side Gemini requests. Keeps VITE_GEMINI_API_KEY off the client.
exports.geminiProxy = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.')
  }
  const uid = request.auth.uid
  const db = getFirestore()
  const userSnap = await db.collection('users').doc(uid).get()
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found.')
  }
  const userData = userSnap.data()
  if (!userData || !['owner', 'manager'].includes(userData.role)) {
    throw new HttpsError('permission-denied', 'Only managers/owners can use the assistant.')
  }

  const { model, body } = request.data
  // Load Gemini API Key from server environment variables
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'Gemini API key is not configured on the server.')
  }

  // Gemini 2.5 flash enables "thinking" by default, and that reasoning is billed
  // against maxOutputTokens — on short budgets it eats the whole budget and
  // returns empty/truncated replies, so we disable it (thinkingBudget:0).
  //
  // BUT that must not be forced blindly: the newer "pro"/thinking models REJECT
  // a zero budget outright ("Budget 0 is invalid. This model only works in
  // thinking mode"), which turned every deep-mode request into a 400 and left
  // the assistant showing an empty bubble. So the budget is a preference, not a
  // demand — and if the model says it needs to think, we let it think and retry
  // rather than failing the user's request.
  const outBody = { ...(body || {}) }
  const callerSetThinking = !!(outBody.generationConfig && outBody.generationConfig.thinkingConfig)
  if (!callerSetThinking) {
    outBody.generationConfig = { ...(outBody.generationConfig || {}), thinkingConfig: { thinkingBudget: 0 } }
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.5-flash'}:generateContent?key=${apiKey}`
  const post = (payload) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  let res = await post(outBody)

  // The model needs thinking mode: drop our budget and ask again.
  if (!res.ok && res.status === 400 && !callerSetThinking) {
    const probe = await res.clone().text().catch(() => '')
    if (/thinking mode|Budget 0 is invalid|thinkingBudget/i.test(probe)) {
      const retry = { ...outBody }
      const gen = { ...(retry.generationConfig || {}) }
      delete gen.thinkingConfig
      retry.generationConfig = gen
      res = await post(retry)
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // Logged, not just thrown: a silent proxy failure is what made this look
    // like the assistant "not responding" instead of a named API error.
    console.error('geminiProxy failed', { model: model || 'gemini-2.5-flash', status: res.status, body: text.slice(0, 300) })
    throw new HttpsError('internal', `Gemini API error: ${res.status} - ${text.slice(0, 180)}`)
  }

  return await res.json()
})

// Geolocation distance helper (Haversine formula)
function calculateDistance(a, b) {
  const R = 6371000 // metres
  const rad = (x) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// Check work day helper
function isStaffWorkDay(staffer, punchDate) {
  const wd = punchDate.getDay() // 0-6 (Sun-Sat)
  const days = Array.isArray(staffer?.workDays) ? staffer.workDays : null
  return !days || !days.length ? true : days.includes(wd)
}

// Calculate lateness & deductions helper
function calculateLatenessAndDeductions(staffer, tenant, punchTime) {
  const shiftStart = staffer?.shiftStart
  if (!shiftStart) return { lateMinutes: 0, deduction: 0 }
  if (!isStaffWorkDay(staffer, punchTime)) return { lateMinutes: 0, deduction: 0 }
  const [h, m] = String(shiftStart).split(':').map(Number)
  const start = new Date(punchTime)
  start.setHours(h || 0, m || 0, 0, 0)
  const grace = Number(tenant?.attendancePolicy?.graceMinutes) || 0
  const lateMinutes = Math.max(0, Math.round((punchTime.getTime() - start.getTime()) / 60000) - grace)
  const rate = Number(tenant?.attendancePolicy?.lateDeductionPerHour) || 0
  const deduction = lateMinutes > 0 && rate > 0 ? Math.round((lateMinutes / 60) * rate) : 0
  return { lateMinutes, deduction }
}

// Secure server-side validation for employee clock-ins and clock-outs
exports.onAttendanceCreated = onDocumentCreated('tenants/{tid}/attendance/{aid}', async (event) => {
  const tid = event.params.tid
  const punch = event.data && event.data.data()
  if (!punch) return

  const db = getFirestore()
  const punchTime = punch.at && punch.at.toDate ? punch.at.toDate() : new Date()

  // Fetch staff record & tenant settings
  const [staffSnap, tenantSnap] = await Promise.all([
    db.doc(`tenants/${tid}/staff/${punch.staffUid}`).get(),
    db.doc(`tenants/${tid}`).get(),
  ])

  if (!staffSnap.exists || !tenantSnap.exists) return

  const staff = staffSnap.data()
  const tenant = tenantSnap.data()

  // Calculate geofence
  let distance = punch.distance || null
  let withinGeofence = punch.withinGeofence || null
  const venueGeo = tenant.geo && typeof tenant.geo.lat === 'number' && typeof tenant.geo.lng === 'number' ? tenant.geo : null
  const radius = Number(tenant.geofenceRadius) || 200

  if (punch.geo && typeof punch.geo.lat === 'number' && typeof punch.geo.lng === 'number' && venueGeo) {
    distance = Math.round(calculateDistance(punch.geo, venueGeo))
    withinGeofence = distance <= radius
  }

  // Calculate lateness (clock-in only)
  let lateMinutes = 0
  let deduction = 0
  if (punch.type === 'in') {
    const late = calculateLatenessAndDeductions(staff, tenant, punchTime)
    lateMinutes = late.lateMinutes
    deduction = late.deduction
  }

  await event.data.ref.update({
    distance,
    withinGeofence,
    lateMinutes,
    deduction,
  })
})

// ==================== PLATFORM CONSOLE (super-admin) ====================
// Central oversight for ALL venues: an append-only cross-tenant activity feed
// (platformActivity), push notifications to the platform owners' devices
// (platformPushTokens), a venue⇄platform chat, client error capture, and
// subscription lifecycle automation. The console UI lives at /platform.

// Push a notification to the platform admins' registered devices; prunes dead tokens.
async function pushToPlatform(db, notification, data) {
  const snap = await db.collection('platformPushTokens').get()
  if (!snap.docs.length) return
  await multicastChunked(snap.docs, {
    notification, data: data || {},
    webpush: { fcmOptions: { link: (data && data.url) || '/platform' }, notification: { icon: '/favicon.svg', requireInteraction: true } },
  })
}

// Append one event to the cross-venue activity feed (rules deny client writes;
// only these functions produce it). severity: info | warn | high.
async function logActivity(db, tid, event) {
  let tenantName = event.tenantName || ''
  if (tid && !tenantName) {
    const t = await db.doc(`tenants/${tid}`).get().catch(() => null)
    tenantName = t && t.exists ? (t.data().name || '') : ''
  }
  await db.collection('platformActivity').add({
    tenantId: tid || null,
    tenantName,
    severity: 'info',
    ...event,
    at: FieldValue.serverTimestamp(),
  })
}

// Run fn over items in bounded-concurrency batches (avoids N sequential awaits
// blowing the function timeout at scale, and N simultaneous connections).
async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn))
  }
}

// New venue registered → high-priority platform alert.
exports.onTenantCreated = onDocumentCreated('tenants/{tid}', async (event) => {
  const t = event.data && event.data.data()
  if (!t) return
  const db = getFirestore()
  await logActivity(db, event.params.tid, {
    kind: 'tenant', severity: 'high', tenantName: t.name || '',
    title: 'منشأة جديدة انضمت للمنصة',
    body: `${t.name || '؟'} · /${t.slug || ''} · ${t.type || ''}`,
  }).catch(() => {})
  await pushToPlatform(db,
    { title: 'منشأة جديدة', body: `${t.name || '؟'} انضمت للمنصة الآن` },
    { url: `/platform/venues/${event.params.tid}`, tag: 'tenant' },
  ).catch(() => {})
})

// Venue settings changed → log WHICH fields; plan/suspension changes are high-priority.
exports.onTenantUpdated = onDocumentUpdated('tenants/{tid}', async (event) => {
  const before = event.data && event.data.before.data()
  const after = event.data && event.data.after.data()
  if (!before || !after) return
  const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]) && k !== 'updatedAt' && k !== 'orderSeq')
  if (!changed.length) return
  const db = getFirestore()
  const critical = changed.filter((k) => ['plan', 'planStatus', 'planExpiresAt', 'active'].includes(k))
  if (critical.length) {
    const bits = []
    if (changed.includes('plan')) bits.push(`الباقة: ${before.plan || 'enterprise'} → ${after.plan || 'enterprise'}`)
    if (changed.includes('planStatus')) bits.push(`حالة الاشتراك: ${before.planStatus || '-'} → ${after.planStatus || '-'}`)
    if (changed.includes('active')) bits.push(after.active === false ? 'تم إيقاف الحساب' : 'تم تفعيل الحساب')
    await logActivity(db, event.params.tid, {
      kind: 'subscription', severity: 'high', tenantName: after.name || '',
      title: 'تحديث: الاشتراك/الحالة', body: bits.join(' · '),
    }).catch(() => {})
  } else {
    await logActivity(db, event.params.tid, {
      kind: 'settings', tenantName: after.name || '',
      title: 'تحديث إعدادات المنشأة', body: `الحقول: ${changed.slice(0, 8).join(', ')}`,
    }).catch(() => {})
  }
})

// Every order lands in the platform feed (with its amount, for live cross-venue KPIs).
exports.onOrderActivity = onDocumentCreated('tenants/{tid}/orders/{oid}', async (event) => {
  const o = event.data && event.data.data()
  if (!o) return
  const db = getFirestore()
  // Creation event drives the order COUNT only; revenue (amount) is recognized
  // later on settlement (onOrderStatusActivity), so an auto-cancelled/spoofed
  // order never contributes revenue.
  await logActivity(db, event.params.tid, {
    kind: 'order', amount: 0,
    title: 'طلب جديد', body: `${o.tableLabel || (o.orderType === 'takeaway' ? 'سفري' : 'طلب')} ${o.code ? '#' + o.code : ''} · ${o.total || 0}`,
    ref: event.params.oid,
  }).catch(() => {})
})

// Order lifecycle transitions (paid / cancelled / refunded) → feed.
exports.onOrderStatusActivity = onDocumentUpdated('tenants/{tid}/orders/{oid}', async (event) => {
  const before = event.data && event.data.before.data()
  const after = event.data && event.data.after.data()
  if (!before || !after || before.status === after.status) return
  if (!['paid', 'served', 'cancelled', 'refunded'].includes(after.status)) return
  const db = getFirestore()
  const label = { paid: 'دفع طلب', served: 'تقديم طلب', cancelled: 'إلغاء طلب', refunded: 'استرجاع طلب' }[after.status]
  await logActivity(db, event.params.tid, {
    kind: 'order', severity: ['cancelled', 'refunded'].includes(after.status) ? 'warn' : 'info',
    title: label, body: `${after.code ? '#' + after.code : ''} · ${after.total || 0}${after.cancelReason ? ' · ' + after.cancelReason : ''}`,
    // Revenue is recognized only on settlement (paid/served) — never from the
    // unvalidated creation event, so cancelled/spoofed orders don't inflate KPIs.
    amount: ['paid', 'served'].includes(after.status) ? (Number(after.total) || 0) : 0,
    ref: event.params.oid, orderStatus: after.status,
  }).catch(() => {})
})

// Guest complaint → platform feed + push (venues with unhappy guests need attention).
exports.onComplaintActivity = onDocumentCreated('tenants/{tid}/complaints/{cid}', async (event) => {
  const c = event.data && event.data.data()
  if (!c) return
  const db = getFirestore()
  await logActivity(db, event.params.tid, {
    kind: 'complaint', severity: 'high',
    title: 'شكوى جديدة من ضيف', body: (c.message || '').slice(0, 140),
    ref: event.params.cid,
  }).catch(() => {})
  await pushToPlatform(db,
    { title: 'شكوى جديدة', body: (c.message || '').slice(0, 100) },
    { url: `/platform/venues/${event.params.tid}`, tag: 'complaint' },
  ).catch(() => {})
})

// Staff roster changes (hire / role change / removal) → feed.
exports.onStaffActivity = onDocumentWritten('tenants/{tid}/staff/{uid}', async (event) => {
  const before = event.data && event.data.before.exists ? event.data.before.data() : null
  const after = event.data && event.data.after.exists ? event.data.after.data() : null
  const db = getFirestore()
  if (!before && after) {
    await logActivity(db, event.params.tid, {
      kind: 'staff', title: 'موظف جديد', body: `${after.name || after.email || '؟'} · ${after.role || 'staff'}`,
    }).catch(() => {})
  } else if (before && !after) {
    await logActivity(db, event.params.tid, {
      kind: 'staff', severity: 'warn', title: 'حذف موظف', body: before.name || before.email || '؟',
    }).catch(() => {})
  } else if (before && after && (before.role !== after.role || before.active !== after.active)) {
    await logActivity(db, event.params.tid, {
      kind: 'staff', title: 'تعديل موظف',
      body: `${after.name || '؟'} · ${before.role !== after.role ? `الدور: ${before.role} → ${after.role}` : after.active === false ? 'إيقاف' : 'تفعيل'}`,
    }).catch(() => {})
  }
})

// Client error report captured → platform feed + immediate push (code monitoring).
exports.onErrorReported = onDocumentCreated('platformErrors/{id}', async (event) => {
  const e = event.data && event.data.data()
  if (!e) return
  const db = getFirestore()
  await logActivity(db, e.tenantId || null, {
    kind: 'error', severity: 'high',
    title: 'خطأ في النظام', body: (e.message || '').slice(0, 140),
    ref: event.params.id,
  }).catch(() => {})
  // Throttle pushes to ONE per distinct error signature per 30 minutes, so a
  // fleet-wide bug hitting many devices doesn't storm the platform's phones.
  const raw = `${(e.message || '').slice(0, 120)}|${(e.url || '').slice(0, 80)}`
  let h = 0
  for (let i = 0; i < raw.length; i++) { h = (h * 31 + raw.charCodeAt(i)) | 0 }
  const sigRef = db.doc(`platformErrorSignatures/sig_${(h >>> 0).toString(36)}`)
  let shouldPush = true
  try {
    shouldPush = await db.runTransaction(async (tx) => {
      const snap = await tx.get(sigRef)
      const last = snap.exists ? (snap.data().lastPushAt && snap.data().lastPushAt.toMillis ? snap.data().lastPushAt.toMillis() : 0) : 0
      if (Date.now() - last < 30 * 60000) {
        tx.set(sigRef, { count: FieldValue.increment(1) }, { merge: true })
        return false
      }
      tx.set(sigRef, { lastPushAt: FieldValue.serverTimestamp(), count: FieldValue.increment(1) }, { merge: true })
      return true
    })
  } catch (_) { shouldPush = true }
  if (shouldPush) {
    await pushToPlatform(db,
      { title: 'خطأ في النظام', body: (e.message || '').slice(0, 100) },
      { url: '/platform/issues', tag: 'error' },
    ).catch(() => {})
  }
})

// Venue opened a support ticket → platform feed + push.
exports.onIssueCreated = onDocumentCreated('platformIssues/{id}', async (event) => {
  const issue = event.data && event.data.data()
  if (!issue) return
  const db = getFirestore()
  await logActivity(db, issue.tenantId || null, {
    kind: 'issue', severity: 'high',
    title: 'بلاغ/تذكرة جديدة', body: (issue.title || '').slice(0, 120),
    ref: event.params.id,
  }).catch(() => {})
  await pushToPlatform(db,
    { title: 'تذكرة دعم جديدة', body: (issue.title || '').slice(0, 100) },
    { url: '/platform/issues', tag: 'issue' },
  ).catch(() => {})
})

// Chat relay: maintain thread meta + unread counters, and push to the OTHER side.
exports.onPlatformChatMessage = onDocumentCreated('platformChats/{tid}/messages/{mid}', async (event) => {
  const m = event.data && event.data.data()
  if (!m) return
  const tid = event.params.tid
  const db = getFirestore()
  const fromVenue = m.from === 'venue'
  await db.doc(`platformChats/${tid}`).set({
    tenantId: tid,
    lastText: (m.text || '').slice(0, 200),
    lastFrom: m.from || 'venue',
    lastAt: FieldValue.serverTimestamp(),
    ...(fromVenue ? { unreadByPlatform: FieldValue.increment(1) } : { unreadByVenue: FieldValue.increment(1) }),
  }, { merge: true }).catch(() => {})
  if (fromVenue) {
    await pushToPlatform(db,
      { title: m.name || 'منشأة', body: (m.text || '').slice(0, 120) },
      { url: `/platform/chat/${tid}`, tag: 'chat' },
    ).catch(() => {})
    await logActivity(db, tid, {
      kind: 'chat', title: 'رسالة من المنشأة', body: (m.text || '').slice(0, 120),
    }).catch(() => {})
  } else {
    await pushToStaff(db, tid,
      { title: 'رسالة من إدارة المنصة', body: (m.text || '').slice(0, 120) },
      { url: '/admin/support', tag: 'chat' },
    ).catch(() => {})
  }
})

// Nightly cross-venue rollup → platformStats/{YYYY-MM-DD} (fast history for the
// console). Also stores lastOrderAt per venue so the Analytics health board reads
// one doc instead of one query per venue.
exports.platformDailyRollup = onSchedule({ schedule: '55 23 * * *', timeZone: 'Asia/Riyadh', timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const db = getFirestore()
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const tenants = await db.collection('tenants').get()
  const byTenant = {}
  let totalOrders = 0, totalRevenue = 0, activeTenants = 0
  await inBatches(tenants.docs, 25, async (t) => {
    const tid = t.id
    const snap = await db.collection(`tenants/${tid}/orders`).where('createdAt', '>=', start).get().catch(() => null)
    const orders = snap ? snap.docs.map((d) => d.data()) : []
    const settled = orders.filter((o) => ['paid', 'served'].includes(o.status))
    const revenue = Math.round(settled.reduce((s, o) => s + (o.total || 0), 0))
    const lastSnap = await db.collection(`tenants/${tid}/orders`).orderBy('createdAt', 'desc').limit(1).get().catch(() => null)
    const lastAt = lastSnap && !lastSnap.empty ? lastSnap.docs[0].data().createdAt : null
    byTenant[tid] = { name: t.data().name || '', orders: orders.length, revenue, currency: t.data().currency || 'SAR', lastOrderAt: lastAt || null }
    totalOrders += orders.length
    totalRevenue += revenue
    if (orders.length > 0) activeTenants++
  })
  const dateId = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
  await db.doc(`platformStats/${dateId}`).set({
    date: dateId, tenants: tenants.size, activeTenants,
    orders: totalOrders, revenue: totalRevenue, byTenant,
    at: FieldValue.serverTimestamp(),
  })
})

// Support impersonation: mint a custom token for a venue's OWNER so a platform
// admin can sign in as them and see exactly what they see. Fully audited.
exports.platformImpersonate = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.')
  const db = getFirestore()
  const adminSnap = await db.doc(`platformAdmins/${request.auth.uid}`).get()
  if (!adminSnap.exists) throw new HttpsError('permission-denied', 'Platform admins only.')
  const tid = request.data && request.data.tid
  if (!tid) throw new HttpsError('invalid-argument', 'tid is required.')
  const t = await db.doc(`tenants/${tid}`).get()
  if (!t.exists || !t.data().ownerUid) throw new HttpsError('not-found', 'Tenant or owner not found.')
  const token = await getAuth().createCustomToken(t.data().ownerUid)
  await logActivity(db, tid, {
    kind: 'settings', severity: 'high', tenantName: t.data().name || '',
    title: 'دخول دعم فني (بحساب المالك)',
    body: `بواسطة ${adminSnap.data().email || request.auth.uid}`,
  }).catch(() => {})
  return { token }
})

// Global broadcast fan-out: one platformBroadcasts doc → an announcement inside
// EVERY (matching) venue's own announcements board, plus optional push.
exports.onPlatformBroadcast = onDocumentCreated({ document: 'platformBroadcasts/{id}', timeoutSeconds: 540, memory: '512MiB' }, async (event) => {
  const b = event.data && event.data.data()
  if (!b) return
  const db = getFirestore()
  const tenants = await db.collection('tenants').get()
  const now = new Date()
  const expires = new Date(now.getTime() + (Number(b.days) || 14) * 86400000)
  const targets = tenants.docs.filter((t) => {
    const d = t.data()
    if (b.plan && (d.plan || 'enterprise') !== b.plan) return false
    if (d.active === false) return false
    return true
  })
  let sent = 0, failed = 0
  await inBatches(targets, 25, async (t) => {
    try {
      // Only the announcement write counts as "delivered"; push is best-effort.
      await db.collection(`tenants/${t.id}/announcements`).add({
        title: b.title || 'إعلان من إدارة المنصة',
        body: b.body || '',
        authorName: 'إدارة المنصة',
        fromPlatform: true,
        publishAt: now,
        expiresAt: expires,
        createdAt: FieldValue.serverTimestamp(),
      })
      sent++
      if (b.push) {
        await pushToStaff(db, t.id,
          { title: b.title || 'إعلان من المنصة', body: (b.body || '').slice(0, 120) },
          { url: '/portal', tag: 'broadcast' },
        ).catch(() => {})
      }
    } catch (_) {
      failed++
    }
  })
  await event.data.ref.update({ sentTo: sent, failed, sentAt: FieldValue.serverTimestamp() }).catch(() => {})
  await logActivity(db, null, {
    kind: 'tenant', title: 'بث إعلان عام', body: `${(b.title || '').slice(0, 80)} → ${sent} منشأة${failed ? ` (${failed} فشل)` : ''}`,
  }).catch(() => {})
})

// Weekly platform digest (Sunday 09:00 Riyadh): 7-day totals + idle venues.
exports.weeklyPlatformReport = onSchedule({ schedule: '0 9 * * 0', timeZone: 'Asia/Riyadh', timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const db = getFirestore()
  const statsSnap = await db.collection('platformStats').orderBy('date', 'desc').limit(7).get().catch(() => null)
  const stats = statsSnap ? statsSnap.docs.map((d) => d.data()) : []
  const revenue = Math.round(stats.reduce((s, x) => s + (x.revenue || 0), 0))
  const orders = stats.reduce((s, x) => s + (x.orders || 0), 0)
  const tenants = await db.collection('tenants').get()
  let idle = 0
  await inBatches(tenants.docs, 25, async (t) => {
    const last = await db.collection(`tenants/${t.id}/orders`).orderBy('createdAt', 'desc').limit(1).get().catch(() => null)
    const lastAt = last && !last.empty ? last.docs[0].data().createdAt : null
    const ms = lastAt && lastAt.toDate ? lastAt.toDate().getTime() : 0
    if (!ms || Date.now() - ms > 7 * 86400000) idle++
  })
  const body = `مبيعات الأسبوع ${revenue} · ${orders} طلب · ${tenants.size} منشأة · ${idle} خاملة`
  await pushToPlatform(db, { title: 'التقرير الأسبوعي للمنصة', body }, { url: '/platform/analytics', tag: 'weekly' }).catch(() => {})
  await logActivity(db, null, { kind: 'tenant', title: 'التقرير الأسبوعي', body }).catch(() => {})
})

// Monthly retention sweep: prune old feed events + old resolved errors so the
// activity log stays fast and cheap.
exports.activityCleanup = onSchedule({ schedule: '0 4 * * *', timeZone: 'Asia/Riyadh', timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const db = getFirestore()
  const prune = async (col, field, cutoff, extra) => {
    for (;;) {
      let q = db.collection(col).where(field, '<', cutoff).limit(400)
      if (extra) q = q.where(...extra)
      const snap = await q.get().catch(() => null)
      if (!snap || snap.empty) return
      const batch = db.batch()
      snap.docs.forEach((d) => batch.delete(d.ref))
      await batch.commit()
      if (snap.size < 400) return
    }
  }
  await prune('platformActivity', 'at', new Date(Date.now() - 60 * 86400000))
  await prune('platformErrors', 'at', new Date(Date.now() - 30 * 86400000), ['status', '==', 'resolved'])
})

// Subscription lifecycle: expire overdue plans, and REACTIVATE renewed ones
// (planExpiresAt pushed into the future) so a renewal that only updates the date
// isn't left clamped to menu-only.
exports.subscriptionSweep = onSchedule({ schedule: '0 3 * * *', timeZone: 'Asia/Riyadh', timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const db = getFirestore()
  const now = new Date()
  const tenants = await db.collection('tenants').get()
  await inBatches(tenants.docs, 25, async (t) => {
    const d = t.data()
    const exp = d.planExpiresAt && d.planExpiresAt.toDate ? d.planExpiresAt.toDate() : (d.planExpiresAt ? new Date(d.planExpiresAt) : null)
    // Renewal: was expired, now has a future expiry → restore to active.
    if (d.planStatus === 'expired' && exp && exp > now) {
      await t.ref.update({ planStatus: 'active' }).catch(() => {})
      return
    }
    if (!exp || exp > now || d.planStatus === 'expired') return
    await t.ref.update({ planStatus: 'expired' }).catch(() => {})
    await pushToStaff(db, t.id,
      { title: 'انتهى اشتراك المنشأة', body: 'انتهت صلاحية الباقة — يرجى التجديد للاستمرار بكامل المزايا.' },
      { url: '/admin/support', tag: 'subscription' },
    ).catch(() => {})
    await pushToPlatform(db,
      { title: 'اشتراك منتهي', body: `${d.name || t.id} — انتهت صلاحية الباقة` },
      { url: `/platform/venues/${t.id}`, tag: 'subscription' },
    ).catch(() => {})
  })
})

// ---- extended platform features (invoices, roles, exports, payment webhook) ----
// Defined in a separate file to keep this one readable; registered here.
Object.assign(exports, require('./platformExtensions'))
Object.assign(exports, require('./campaigns'))

// ---- customer/venue messaging (WhatsApp order updates + Resend emails) ----
// Register ONLY the triggers (the send helpers stay internal to messaging.js).
const messaging = require('./messaging')
exports.onOrderCustomerNotify = messaging.onOrderCustomerNotify
exports.onVenueWelcomeEmail = messaging.onVenueWelcomeEmail
exports.onStaffInviteEmail = messaging.onStaffInviteEmail

// ---- invoicing (numbered receipts / tax invoices for every paid order) ----
exports.onOrderPaid = require('./invoicing').onOrderPaid

