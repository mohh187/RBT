// ==================== PLATFORM EXTENSIONS (super-admin backend) ====================
// Additional Cloud Functions layered on top of index.js for billing, roles,
// data export, payment webhooks and audit retention. Registered from index.js
// via: Object.assign(exports, require('./platformExtensions'))
//
// initializeApp() is already called in index.js — do NOT call it here.
// getFirestore() is resolved lazily inside every handler.
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { sendEmail, emailShell, esc } = require('./messaging')
const { receiptForSimple, notifyReceipt, invoiceLink } = require('./invoicing')

// Venue owner's email (for subscription invoice/receipt emails).
async function ownerEmailOf(db, ownerUid) {
  if (!ownerUid) return null
  const u = await db.doc(`users/${ownerUid}`).get().catch(() => null)
  return u && u.exists ? (u.data().email || null) : null
}

// ---- small shared helpers (kept local so this file is self-contained) ----

// Run fn over items in bounded-concurrency batches so one large tenant list
// doesn't open N simultaneous connections or blow the function timeout.
async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn))
  }
}

// Append one row to the platform audit trail. Never throws (best-effort).
async function writeAudit(db, entry) {
  try {
    await db.collection('platformAudit').add({
      ...entry,
      at: FieldValue.serverTimestamp(),
    })
  } catch (_) { /* audit is best-effort */ }
}

// Read the caller's platformAdmins doc, or throw if they are not an admin.
async function requirePlatformAdmin(db, auth) {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.')
  const snap = await db.doc(`platformAdmins/${auth.uid}`).get()
  if (!snap.exists) throw new HttpsError('permission-denied', 'Platform admins only.')
  return snap
}

// The current billing period as YYYY-MM in the platform timezone.
function currentPeriod() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).slice(0, 7)
}

// ---------------------------------------------------------------------------
// 1) generateMonthlyInvoices — 1st of each month 02:00 Riyadh.
// For every active, non-expired venue, mint an unpaid invoice for the period
// priced from platformConfig/plans.prices[plan]. Idempotent per tenant+period.
// ---------------------------------------------------------------------------
const generateMonthlyInvoices = onSchedule(
  { schedule: '0 2 1 * *', timeZone: 'Asia/Riyadh', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = getFirestore()
    const period = currentPeriod()

    // Plan prices (SAR by default). Missing doc / plan → 0.
    const cfgSnap = await db.doc('platformConfig/plans').get().catch(() => null)
    const cfg = cfgSnap && cfgSnap.exists ? (cfgSnap.data() || {}) : {}
    const prices = cfg.prices || {}
    const currency = cfg.currency || 'SAR'

    const tenants = await db.collection('tenants').get()
    const now = new Date()

    await inBatches(tenants.docs, 25, async (t) => {
      try {
        const d = t.data() || {}
        // Skip suspended / expired venues — only bill live subscriptions.
        if (d.active === false) return
        if (d.planStatus === 'expired') return
        const exp = d.planExpiresAt && d.planExpiresAt.toDate
          ? d.planExpiresAt.toDate()
          : (d.planExpiresAt ? new Date(d.planExpiresAt) : null)
        if (exp && exp < now) return

        const plan = d.plan || 'menu'
        const amount = Number(prices[plan]) || 0

        // Idempotency: one invoice per tenant per period.
        const dup = await db.collection('platformInvoices')
          .where('tenantId', '==', t.id)
          .where('period', '==', period)
          .limit(1)
          .get()
          .catch(() => null)
        if (dup && !dup.empty) return

        await db.collection('platformInvoices').add({
          tenantId: t.id,
          tenantName: d.name || '',
          plan,
          amount,
          currency,
          period,
          status: 'unpaid',
          createdAt: FieldValue.serverTimestamp(),
        })

        // Email the venue owner their new subscription invoice (best-effort).
        const email = await ownerEmailOf(db, d.ownerUid)
        if (email && amount > 0) {
          const payUrl = (process.env.PUBLIC_BASE_URL || '') + '/admin'
          await sendEmail({
            to: email,
            subject: `فاتورة اشتراك rbt360 — ${period}`,
            html: emailShell(`فاتورة اشتراك ${esc(d.name || '')}`, `
              <p>صدرت فاتورة اشتراكك لفترة <strong>${esc(period)}</strong>.</p>
              <table style="width:100%;border-collapse:collapse;margin:12px 0">
                <tr><td style="padding:6px 0;color:#5c5c66">الباقة</td><td style="padding:6px 0;text-align:end;font-weight:700">${esc(plan)}</td></tr>
                <tr><td style="padding:6px 0;color:#5c5c66">المبلغ</td><td style="padding:6px 0;text-align:end;font-weight:700">${esc(amount)} ${esc(currency)}</td></tr>
              </table>
              <p><a href="${esc(payUrl)}" style="color:#7c2d2d;font-weight:700">ادفع الفاتورة من لوحة الإدارة</a></p>`),
          }).catch(() => {})
        }
      } catch (_) { /* skip this tenant, keep the rest going */ }
    })

    await writeAudit(db, { kind: 'billing', action: 'generateMonthlyInvoices', period })
  }
)

// ---------------------------------------------------------------------------
// 2) setPlatformRole — assign a platform role to an admin. Caller must be a
// superAdmin (an admin doc with no role field is treated as the original
// superAdmin, so the first admin can bootstrap the others).
// ---------------------------------------------------------------------------
const setPlatformRole = onCall(async (request) => {
  const db = getFirestore()
  const callerSnap = await requirePlatformAdmin(db, request.auth)
  const callerRole = (callerSnap.data() || {}).role
  if (callerRole && callerRole !== 'superAdmin') {
    throw new HttpsError('permission-denied', 'Only a super admin can change roles.')
  }

  const uid = request.data && request.data.uid
  const role = request.data && request.data.role
  const allowed = ['superAdmin', 'support', 'analyst']
  if (!uid || !allowed.includes(role)) {
    throw new HttpsError('invalid-argument', 'uid and a valid role are required.')
  }

  const targetRef = db.doc(`platformAdmins/${uid}`)
  const targetSnap = await targetRef.get()
  if (!targetSnap.exists) throw new HttpsError('not-found', 'Target is not a platform admin.')

  await targetRef.set({ role }, { merge: true })
  await writeAudit(db, {
    kind: 'role',
    action: 'setPlatformRole',
    by: request.auth.uid,
    byEmail: (callerSnap.data() || {}).email || null,
    targetUid: uid,
    role,
  })
  return { ok: true, uid, role }
})

// ---------------------------------------------------------------------------
// 3) requestVenueExport — build a summary export of one venue and store it in
// platformExports for download. Caller must be a platform admin.
// ---------------------------------------------------------------------------
const requestVenueExport = onCall(async (request) => {
  const db = getFirestore()
  const callerSnap = await requirePlatformAdmin(db, request.auth)
  const tid = request.data && request.data.tid
  if (!tid) throw new HttpsError('invalid-argument', 'tid is required.')

  const tenantSnap = await db.doc(`tenants/${tid}`).get()
  if (!tenantSnap.exists) throw new HttpsError('not-found', 'Tenant not found.')
  const tenant = tenantSnap.data() || {}

  // Count sub-collections in parallel (count() aggregation avoids reading docs).
  const countOf = async (col) => {
    try {
      const agg = await db.collection(`tenants/${tid}/${col}`).count().get()
      return agg.data().count
    } catch (_) { return 0 }
  }
  const [orders, customers, items, staff] = await Promise.all([
    countOf('orders'), countOf('customers'), countOf('items'), countOf('staff'),
  ])

  // Latest 200 orders, minimal fields.
  let recentOrders = []
  try {
    const snap = await db.collection(`tenants/${tid}/orders`)
      .orderBy('createdAt', 'desc').limit(200).get()
    recentOrders = snap.docs.map((doc) => {
      const o = doc.data() || {}
      const createdAt = o.createdAt && o.createdAt.toMillis ? o.createdAt.toMillis() : null
      return {
        id: doc.id,
        code: o.code || null,
        status: o.status || null,
        total: Number(o.total) || 0,
        orderType: o.orderType || null,
        tableLabel: o.tableLabel || null,
        createdAt,
      }
    })
  } catch (_) { recentOrders = [] }

  const data = {
    tenant: {
      id: tid,
      name: tenant.name || '',
      slug: tenant.slug || '',
      type: tenant.type || '',
      plan: tenant.plan || 'menu',
      planStatus: tenant.planStatus || null,
      currency: tenant.currency || 'SAR',
      active: tenant.active !== false,
    },
    counts: { orders, customers, items, staff },
    recentOrders,
  }

  const ref = await db.collection('platformExports').add({
    tenantId: tid,
    tenantName: tenant.name || '',
    requestedBy: request.auth.uid,
    requestedByEmail: (callerSnap.data() || {}).email || null,
    status: 'ready',
    data,
    at: FieldValue.serverTimestamp(),
  })

  await writeAudit(db, {
    kind: 'export', action: 'requestVenueExport',
    by: request.auth.uid, tenantId: tid, exportId: ref.id,
  })
  return { id: ref.id }
})

// ---------------------------------------------------------------------------
// 4) paymentWebhook — HTTP endpoint for a payment gateway callback. SCAFFOLD.
// On status "paid": mark the invoice paid and extend the tenant's plan by ~30d.
//
// TODO: real per-gateway signature verification MUST be wired before production.
//   - Moyasar: verify the `X-Moyasar-Signature` HMAC-SHA256 over the raw body.
//   - Tap:     verify the `hashstring` header against your API secret.
//   - Stripe:  use stripe.webhooks.constructEvent(rawBody, sig, endpointSecret).
// The shared-secret check below is a placeholder, NOT gateway-grade security.
// ---------------------------------------------------------------------------
// Fetch a payment from the Moyasar API (source of truth). Basic auth = secret key
// as username, empty password. Never trust a client/webhook-supplied status.
async function moyasarGetPayment(paymentId) {
  const sk = process.env.MOYASAR_SECRET_KEY
  if (!sk) throw new Error('MOYASAR_SECRET_KEY not configured')
  const auth = Buffer.from(sk + ':').toString('base64')
  const r = await fetch(`https://api.moyasar.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: 'Basic ' + auth },
  })
  if (!r.ok) throw new Error('moyasar api ' + r.status)
  return r.json()
}

// Verify a paid Moyasar payment against its bound invoice and settle it:
// amount binding (server-derived, halalas), tenant binding, idempotent, then
// mark the invoice paid + extend the venue's subscription. Returns a result object.
async function settleInvoiceFromPayment(db, payment) {
  if (!payment || payment.status !== 'paid') return { settled: false, reason: 'not-paid' }
  const meta = payment.metadata || {}
  const invoiceId = meta.invoiceId
  if (!invoiceId) return { settled: false, reason: 'no-invoice-binding' }
  const invRef = db.doc(`platformInvoices/${invoiceId}`)
  const invSnap = await invRef.get()
  if (!invSnap.exists) return { settled: false, reason: 'invoice-not-found' }
  const invoice = invSnap.data() || {}
  if (invoice.status === 'paid') return { settled: true, already: true }
  // Amount binding: Moyasar amount is in halalas; invoice.amount is in SAR.
  const expectedHalalas = Math.round((Number(invoice.amount) || 0) * 100)
  if (expectedHalalas > 0 && (Number(payment.amount) || 0) + 1 < expectedHalalas) {
    return { settled: false, reason: 'amount-mismatch' }
  }
  // Tenant binding (defensive — blocks replaying a payment across venues).
  if (meta.tenantId && invoice.tenantId && meta.tenantId !== invoice.tenantId) {
    return { settled: false, reason: 'tenant-mismatch' }
  }
  await invRef.set({
    status: 'paid', paidAt: FieldValue.serverTimestamp(),
    provider: 'moyasar', providerRef: payment.id, amountPaid: payment.amount,
  }, { merge: true })
  // Extend the subscription (yearly period → 365 days, else 30) and reactivate.
  if (invoice.tenantId) {
    const tRef = db.doc(`tenants/${invoice.tenantId}`)
    const tSnap = await tRef.get().catch(() => null)
    if (tSnap && tSnap.exists) {
      const d = tSnap.data() || {}
      const cur = d.planExpiresAt && d.planExpiresAt.toDate ? d.planExpiresAt.toDate() : (d.planExpiresAt ? new Date(d.planExpiresAt) : null)
      const base = cur && cur > new Date() ? cur : new Date()
      const days = String(invoice.billing || '').includes('year') ? 365 : 30
      const next = new Date(base.getTime() + days * 86400000)
      await tRef.set({ planStatus: 'active', planExpiresAt: next, ...(invoice.plan ? { plan: invoice.plan } : {}) }, { merge: true }).catch(() => {})

      // Email the venue owner a payment receipt (best-effort).
      const email = await ownerEmailOf(db, d.ownerUid)
      if (email) {
        await sendEmail({
          to: email,
          subject: `تم استلام دفعة اشتراك rbt360 — ${invoice.period || ''}`,
          html: emailShell('تم استلام دفعتك', `
            <p>شكراً لك. تم استلام دفعة اشتراك <strong>${esc(d.name || '')}</strong> بنجاح.</p>
            <table style="width:100%;border-collapse:collapse;margin:12px 0">
              <tr><td style="padding:6px 0;color:#5c5c66">الفترة</td><td style="padding:6px 0;text-align:end;font-weight:700">${esc(invoice.period || '')}</td></tr>
              <tr><td style="padding:6px 0;color:#5c5c66">المبلغ</td><td style="padding:6px 0;text-align:end;font-weight:700">${esc(Number(invoice.amount) || 0)} ${esc(invoice.currency || 'SAR')}</td></tr>
              <tr><td style="padding:6px 0;color:#5c5c66">تفعيل حتى</td><td style="padding:6px 0;text-align:end;font-weight:700">${esc(next.toISOString().slice(0, 10))}</td></tr>
            </table>`),
        }).catch(() => {})
      }
    }
  }
  await writeAudit(db, { kind: 'payment', action: 'invoiceSettled', invoiceId, tenantId: invoice.tenantId || null, providerRef: payment.id })
  return { settled: true }
}

// ---------------------------------------------------------------------------
// Generic payment intents — receive money for ALL flows (diner orders, venue
// subscriptions, booking deposits) through one hosted-Moyasar-invoice pipeline.
// The amount is ALWAYS re-derived server-side from the authoritative doc, never
// trusted from the client.
// ---------------------------------------------------------------------------
async function moyasarCreateInvoice({ amount, currency, description, successUrl, metadata }) {
  const sk = process.env.MOYASAR_SECRET_KEY
  if (!sk) throw new Error('MOYASAR_SECRET_KEY not configured')
  const auth = Buffer.from(sk + ':').toString('base64')
  const r = await fetch('https://api.moyasar.com/v1/invoices', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, currency: currency || 'SAR', description: description || 'Payment', success_url: successUrl, metadata }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.id) throw new Error('moyasar invoice ' + r.status + ' ' + (j.message || ''))
  return j
}
async function moyasarGetInvoice(id) {
  const sk = process.env.MOYASAR_SECRET_KEY
  if (!sk) throw new Error('MOYASAR_SECRET_KEY not configured')
  const auth = Buffer.from(sk + ':').toString('base64')
  const r = await fetch(`https://api.moyasar.com/v1/invoices/${encodeURIComponent(id)}`, { headers: { Authorization: 'Basic ' + auth } })
  if (!r.ok) throw new Error('moyasar invoice get ' + r.status)
  return r.json()
}
// Refund a captured payment (full unless `amount` halalas given). Returns true on
// success. Used to auto-refund an online order we can no longer fulfil (stock-out).
async function moyasarRefund(paymentId, amount) {
  const sk = process.env.MOYASAR_SECRET_KEY
  if (!sk || !paymentId) return false
  const auth = Buffer.from(sk + ':').toString('base64')
  const r = await fetch(`https://api.moyasar.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(amount ? { amount } : {}),
  }).catch(() => null)
  return !!(r && r.ok)
}
// Charge a saved card TOKEN (server-side, secret key). The card number/CVV are
// never handled here — only the opaque token. Returns the Moyasar payment.
async function moyasarChargeToken({ amount, token, description, callbackUrl, metadata }) {
  const sk = process.env.MOYASAR_SECRET_KEY
  if (!sk) throw new Error('MOYASAR_SECRET_KEY not configured')
  const auth = Buffer.from(sk + ':').toString('base64')
  const r = await fetch('https://api.moyasar.com/v1/payments', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, currency: 'SAR', description: description || 'Payment', callback_url: callbackUrl, source: { type: 'token', token }, metadata }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.id) throw new Error('moyasar charge ' + r.status + ' ' + (j.message || ''))
  return j
}

// SINGLE SOURCE OF TRUTH for a payment's server-derived amount + description.
// Used by BOTH createPayIntent (hosted/inline) and payWithSavedCard (token charge)
// so a saved-card charge can never bill a different amount than a fresh one.
// ANONYMOUS for order/booking/ticket (public diners); subscription needs an
// authenticated manager/admin of the venue.
async function deriveIntentAmount(db, { kind, tenantId, refId, request }) {
  let amountSar = 0
  let description = ''
  if (kind === 'order') {
    const s = await db.doc(`tenants/${tenantId}/orders/${refId}`).get()
    if (!s.exists) throw new HttpsError('not-found', 'order not found')
    const o = s.data()
    amountSar = Number(o.total) || 0
    // Anti-underpay guard (R3): the charged total must not fall BELOW the order's
    // own line items minus any recorded discount — blocks a tampered `total`.
    const itemsSum = (o.items || []).reduce((sum, l) => sum + (Number(l.price) || 0) * (Number(l.qty) || 0), 0)
    const discount = (Number(o.discount) || 0) + (Number(o.loyaltyDiscount) || 0)
    if (itemsSum > 0 && amountSar + 0.01 < itemsSum - discount) {
      throw new HttpsError('failed-precondition', 'order total below its line items')
    }
    description = `Order ${o.code || refId}`
  } else if (kind === 'subscription') {
    const s = await db.doc(`platformInvoices/${refId}`).get()
    if (!s.exists) throw new HttpsError('not-found', 'invoice not found')
    const inv = s.data()
    const uid = request && request.auth && request.auth.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to pay a subscription.')
    const [uSnap, aSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.doc(`platformAdmins/${uid}`).get(),
    ])
    const isMgr = uSnap.exists && ['owner', 'manager'].includes(uSnap.data().role) && uSnap.data().tenantId === inv.tenantId
    if (!isMgr && !aSnap.exists) throw new HttpsError('permission-denied', 'Not your invoice.')
    amountSar = Number(inv.amount) || 0
    description = `Subscription ${refId}`
  } else if (kind === 'aiCredits') {
    // AI-assistant credit packs. refId = pack quantity as a string; the PRICE is
    // this server-side table ONLY (client-sent amounts are never trusted).
    const AI_PACKS = { 100: 49, 300: 129, 1000: 349 }
    const qty = Number(refId)
    if (!AI_PACKS[qty]) throw new HttpsError('invalid-argument', 'unknown credit pack')
    const uid = request && request.auth && request.auth.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to buy credits.')
    const uSnap = await db.collection('users').doc(uid).get()
    const isMgr = uSnap.exists && ['owner', 'manager'].includes(uSnap.data().role) && uSnap.data().tenantId === tenantId
    if (!isMgr) throw new HttpsError('permission-denied', 'Managers only.')
    amountSar = AI_PACKS[qty]
    description = `AI credits ${qty} — ${tenantId}`
  } else if (kind === 'booking') {
    const [rs, ts] = await Promise.all([
      db.doc(`tenants/${tenantId}/reservations/${refId}`).get(),
      db.doc(`tenants/${tenantId}`).get(),
    ])
    if (!rs.exists) throw new HttpsError('not-found', 'reservation not found')
    amountSar = Number(ts.exists && ts.data().reservationDeposit) || 0
    description = `Booking deposit ${rs.data().code || refId}`
  } else if (kind === 'ticket') {
    const s = await db.doc(`tenants/${tenantId}/tickets/${refId}`).get()
    if (!s.exists) throw new HttpsError('not-found', 'ticket not found')
    const tk = s.data()
    const ev = tk.eventId ? await db.doc(`tenants/${tenantId}/events/${tk.eventId}`).get() : null
    const types = ev && ev.exists ? (ev.data().ticketTypes || []) : []
    const type = types.find((t) => t.key === tk.typeKey)
    if (types.length && !type) throw new HttpsError('failed-precondition', 'ticket type not found for this event')
    amountSar = type ? (Number(type.price) || 0) : (Number(tk.price) || 0)
    description = `Ticket ${tk.code || refId}`
  } else {
    throw new HttpsError('invalid-argument', 'unknown kind')
  }
  return { amountSar, description }
}

// createPayIntent(kind, tenantId, refId) → server-derives the amount, opens a
// hosted Moyasar invoice, records a payIntents doc, returns { payIntentId, url }.
const createPayIntent = onCall(async (request) => {
  const { kind, tenantId, refId } = request.data || {}
  if (!kind || !tenantId || !refId) throw new HttpsError('invalid-argument', 'kind, tenantId, refId required')
  const db = getFirestore()
  const base = (process.env.APP_BASE_URL || 'https://rbt360sa.com').replace(/\/$/, '')
  const { amountSar, description } = await deriveIntentAmount(db, { kind, tenantId, refId, request })
  const amount = Math.round(amountSar * 100) // halalas
  if (amount < 100) throw new HttpsError('failed-precondition', 'amount too small')

  const intentRef = db.collection('payIntents').doc()
  const successUrl = `${base}/pay/return?intent=${intentRef.id}`
  const invoice = await moyasarCreateInvoice({
    amount, currency: 'SAR', description, successUrl,
    metadata: { payIntentId: intentRef.id, kind, tenantId, refId },
  }).catch((e) => { throw new HttpsError('internal', 'moyasar: ' + ((e && e.message) || '')) })

  await intentRef.set({
    kind, tenantId, refId, amount, currency: 'SAR', status: 'created',
    description, // shown on the inline checkout page
    moyasarInvoiceId: invoice.id, hostedUrl: invoice.url, // hosted page = fallback
    createdAt: FieldValue.serverTimestamp(),
  })
  // amount/currency/description let the client mount the inline (Apple Pay) form;
  // url stays for the hosted-page fallback.
  return { payIntentId: intentRef.id, url: invoice.url, amount, currency: 'SAR', description }
})

// issueFreeTicket(tenantId, eventId, typeKey, name, phone) → creates a VALID
// ticket server-side ONLY when the event's ticket-type price is 0 (R1). Free
// tickets must not be self-issued by the client as 'valid' — a diner could set
// price 0 for a PAID type. The rules now let diners create only 'pending'
// tickets; this callable is the authoritative free-issue path (Admin SDK bypasses
// rules and re-derives the price from the event).
const issueFreeTicket = onCall(async (request) => {
  const { tenantId, eventId, typeKey, name, phone } = request.data || {}
  if (!tenantId || !eventId) throw new HttpsError('invalid-argument', 'tenantId, eventId required')
  const db = getFirestore()
  // Anti-spam: only accept a real attendee identity for a genuinely-bookable event.
  if (!String(name || '').trim() && !String(phone || '').trim()) throw new HttpsError('invalid-argument', 'name or phone required')
  const ev = await db.doc(`tenants/${tenantId}/events/${eventId}`).get()
  if (!ev.exists) throw new HttpsError('not-found', 'event not found')
  const evd = ev.data() || {}
  if (evd.status !== 'published') throw new HttpsError('failed-precondition', 'event not open for booking')
  const types = evd.ticketTypes || []
  const type = types.find((t) => t.key === typeKey) || types[0] || { key: 't0', price: 0 }
  if ((Number(type.price) || 0) > 0) throw new HttpsError('failed-precondition', 'this ticket type requires payment')
  // Enforce capacity when the event/type defines one (prevent oversell of a
  // limited free event). Counts issued (valid/used) tickets for this event.
  const cap = Number(type.capacity ?? evd.capacity) || 0
  if (cap > 0) {
    const cnt = await db.collection(`tenants/${tenantId}/tickets`)
      .where('eventId', '==', eventId).where('status', 'in', ['valid', 'used']).count().get().catch(() => null)
    const issued = cnt ? cnt.data().count : 0
    if (issued >= cap) throw new HttpsError('resource-exhausted', 'event is fully booked')
  }
  const rand = (n) => require('crypto').randomBytes(n).toString('hex').slice(0, n)
  const ref = db.collection(`tenants/${tenantId}/tickets`).doc()
  const code = 'T-' + rand(5).toUpperCase()
  await ref.set({
    eventId,
    eventTitleAr: evd.titleAr || '', eventTitleEn: evd.titleEn || '',
    startsAt: evd.startsAt || null,
    typeKey: type.key || 't0', typeName: type.nameAr || type.nameEn || '', price: 0,
    name: (name || '').toString().slice(0, 80), phone: (phone || '').toString().slice(0, 20),
    status: 'valid', code, qrToken: rand(12),
    createdAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id, code }
})

// Dispatch a PAID Moyasar payment by its bound payIntent kind. Idempotent and
// amount-bound. Falls back to the legacy invoice-only path for older payments.
async function settleFromPayment(db, payment) {
  if (!payment || payment.status !== 'paid') return { settled: false, reason: 'not-paid' }
  const meta = payment.metadata || {}
  const payIntentId = meta.payIntentId
  if (!payIntentId) {
    if (meta.invoiceId) return settleInvoiceFromPayment(db, payment) // back-compat
    return { settled: false, reason: 'no-intent' }
  }
  const intentRef = db.doc(`payIntents/${payIntentId}`)
  const snap = await intentRef.get()
  if (!snap.exists) return { settled: false, reason: 'unknown-intent' }
  const intent = snap.data() || {}
  if (Number(intent.amount) > 0 && (Number(payment.amount) || 0) + 1 < Number(intent.amount)) {
    return { settled: false, reason: 'amount-mismatch' }
  }
  // Atomically CLAIM the intent (R6): the webhook and the /pay/return path both
  // call this — a transaction guarantees only ONE flips 'created'→'paid' and
  // proceeds to dispatch, so a subscription can't double-extend nor effects
  // double-run. A loser returns already-settled.
  let claimed = false
  await db.runTransaction(async (tx) => {
    const s = await tx.get(intentRef)
    if (!s.exists || (s.data() || {}).status === 'paid') return
    tx.update(intentRef, { status: 'paid', moyasarPaymentId: payment.id, paidAt: FieldValue.serverTimestamp() })
    claimed = true
  })
  if (!claimed) return { settled: true, already: true }
  const tid = intent.tenantId
  if (intent.kind === 'order') {
    // Online orders are captured BEFORE they reach staff. The order was created
    // 'awaiting_payment' (hidden from the kitchen; onNewOrder skipped it). Now that
    // it's paid we ACTIVATE it — status -> 'pending' surfaces it in watchActiveOrders
    // + the KDS — and apply the finished-goods stock deduction that onNewOrder does
    // for cash/terminal orders (mirrors index.js's stock authority, runs once via the
    // atomic claim above). amountPaid = total makes the cashier's PaymentSheet show
    // "due 0" (no re-collection), and the 'paid' statusHistory entry notifies the diner.
    // Legacy 'pending' online orders (older clients) are only flagged paid — never
    // re-activated or double-decremented.
    const oRef = db.doc(`tenants/${tid}/orders/${intent.refId}`)
    const oSnap = await oRef.get().catch(() => null)
    const order = oSnap && oSnap.exists ? (oSnap.data() || {}) : {}
    const total = Number(order.total) || 0
    // A late payment on an order that was auto-expired still gets honoured/activated.
    const held = order.status === 'awaiting_payment' || order.status === 'expired'
    const lines = (order.items || []).filter((l) => l.itemId && (l.qty || 0) > 0)

    // #1 Never charge for what we can't serve. A held order may have sold out during
    // the payment window — re-check finished-goods stock; if short, REFUND and cancel.
    if (held) {
      const ids = [...new Set(lines.map((l) => l.itemId))]
      const snaps = {}
      await Promise.all(ids.map(async (id) => { const s = await db.doc(`tenants/${tid}/items/${id}`).get().catch(() => null); if (s && s.exists) snaps[id] = s.data() }))
      const short = lines.find((l) => { const it = snaps[l.itemId]; return it && it.trackStock && it.stockMode === 'simple' && (Number(it.stock) || 0) < (l.qty || 1) })
      if (short) {
        const refunded = await moyasarRefund(payment.id, Number(payment.amount) || undefined)
        await oRef.set({
          status: 'cancelled', paidOnline: true, paymentRef: payment.id,
          paymentStatus: refunded ? 'refunded' : 'paid',
          cancelReason: refunded ? 'نفد أحد الأصناف — تمّت إعادة المبلغ كاملاً.' : 'نفد أحد الأصناف — سيتواصل معك المتجر بشأن الاسترداد.',
          refund: refunded ? { amount: total, reason: 'stock-out', at: Date.now() } : null,
          statusHistory: FieldValue.arrayUnion({ status: 'cancelled', at: Date.now(), by: 'system' }),
        }, { merge: true }).catch(() => {})
        await writeAudit(db, { kind: 'payment', action: refunded ? 'autoRefundStockOut' : 'autoRefundFailed', tenantId: tid, refId: intent.refId, providerRef: payment.id })
        return { settled: true, refunded, cancelled: true }
      }
    }

    // Activate: status -> 'pending' surfaces the paid order to the kitchen/cashier.
    const patch = {
      paymentStatus: 'paid', paidOnline: true, paymentMethod: 'online',
      paymentRef: payment.id, amountPaid: total, paidAt: FieldValue.serverTimestamp(),
      paidAtMs: Date.now(), // lets the cashier shift/drawer report attribute it by time
      statusHistory: FieldValue.arrayUnion({ status: 'paid', at: Date.now(), by: 'online' }),
    }
    if (held) patch.status = 'pending'
    await oRef.set(patch, { merge: true }).catch(() => {})
    // Stock + popularity (onNewOrder skipped the held order): decrement stock and
    // bump soldCount so the 'auto' featured strip reflects real best-sellers.
    if (held && !order.stockDecremented) {
      await Promise.all(lines.map((l) =>
        db.doc(`tenants/${tid}/items/${l.itemId}`).update({ stock: FieldValue.increment(-(l.qty || 1)), soldCount: FieldValue.increment(l.qty || 1) }).catch(() => {})
      ))
      await oRef.set({ stockDecremented: true }, { merge: true }).catch(() => {})
    }
  } else if (intent.kind === 'subscription') {
    await settleInvoiceFromPayment(db, { ...payment, metadata: { ...meta, invoiceId: intent.refId } })
  } else if (intent.kind === 'aiCredits') {
    // FULL AUTOMATION: payment settled → credits appear on the venue instantly
    // + a PAID invoice record lands in the platform console for the admin.
    const qty = Number(intent.refId) || 0
    const tRef = db.doc(`tenants/${tid}`)
    const tSnap = await tRef.get().catch(() => null)
    const tName = tSnap && tSnap.exists ? (tSnap.data().name || '') : ''
    await tRef.set({ aiExtra: FieldValue.increment(qty) }, { merge: true }).catch(() => {})
    await db.collection('platformInvoices').add({
      tenantId: tid, tenantName: tName, plan: 'aiCredits',
      amount: (Number(intent.amount) || 0) / 100, currency: 'SAR',
      period: `${qty} طلب ذكاء`, status: 'paid', provider: 'moyasar', providerRef: payment.id,
      paidAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(),
    }).catch(() => {})
  } else if (intent.kind === 'booking') {
    const rRef = db.doc(`tenants/${tid}/reservations/${intent.refId}`)
    const rSnap = await rRef.get().catch(() => null)
    const rd = rSnap && rSnap.exists ? rSnap.data() : {}
    await rRef.set({ depositStatus: 'paid', status: 'confirmed', paymentRef: payment.id, paidAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {})
    const rec = await receiptForSimple(db, tid, { kind: 'booking', refId: intent.refId, buyerName: rd.name || '', buyerPhone: rd.phone || '', label: 'عربون حجز', amount: (Number(intent.amount) || 0) / 100, providerRef: payment.id }).catch(() => null)
    if (rec && rd.phone) await notifyReceipt(rec.tenant, rd.phone, { code: rd.code || '', total: rec.total, currency: rec.currency, link: invoiceLink(tid, rec.id) })
  } else if (intent.kind === 'ticket') {
    const tRef = db.doc(`tenants/${tid}/tickets/${intent.refId}`)
    const tSnap = await tRef.get().catch(() => null)
    const td = tSnap && tSnap.exists ? tSnap.data() : {}
    await tRef.set({ status: 'valid', paidOnline: true, paymentRef: payment.id, paidAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {})
    const rec = await receiptForSimple(db, tid, { kind: 'ticket', refId: intent.refId, buyerName: td.name || '', buyerPhone: td.phone || '', label: td.typeName ? `تذكرة: ${td.typeName}` : 'تذكرة', amount: (Number(intent.amount) || 0) / 100, providerRef: payment.id }).catch(() => null)
    if (rec && td.phone) await notifyReceipt(rec.tenant, td.phone, { code: td.code || '', total: rec.total, currency: rec.currency, link: invoiceLink(tid, rec.id) })
  }
  // #6 Saved card (opt-in): if the payer ticked "save card", Moyasar returns a
  // reusable token in payment.source.token. Store it SERVER-ONLY (the client never
  // sees the token — only last4/brand), keyed to the paying device, for one-tap
  // future orders. Never let this break settlement.
  try {
    const src = payment.source || {}
    const stid = intent.tenantId
    if (src.token && meta.deviceKey && stid) {
      const last4 = (String(src.number || '').replace(/[^0-9]/g, '').slice(-4)) || ''
      const cardId = `${meta.deviceKey}_${src.token}`.replace(/[^A-Za-z0-9_]/g, '').slice(0, 300)
      await db.doc(`tenants/${stid}/savedCards/${cardId}`).set({
        token: src.token, last4, brand: (src.company || src.type || 'card'),
        deviceKey: String(meta.deviceKey).slice(0, 80),
        createdAt: FieldValue.serverTimestamp(), createdAtMs: Date.now(),
      }, { merge: true }).catch(() => {})
    }
  } catch (_) { /* saving a card must never break settlement */ }
  // (intent already marked 'paid' in the atomic claim above — R6)
  await writeAudit(db, { kind: 'payment', action: 'paidOnline', payIntentKind: intent.kind, tenantId: tid || null, refId: intent.refId, providerRef: payment.id })
  return { settled: true }
}

// Reliable return-path settlement (belt-and-suspenders with the webhook). Called
// from /pay/return. No auth: it only settles a genuinely-paid Moyasar payment,
// idempotently and amount-bound — safe for anonymous diners.
const confirmPayIntent = onCall(async (request) => {
  const { payIntentId, paymentId } = request.data || {}
  const db = getFirestore()
  let payment = null
  try {
    if (paymentId) {
      payment = await moyasarGetPayment(paymentId)
    } else if (payIntentId) {
      const snap = await db.doc(`payIntents/${payIntentId}`).get()
      if (!snap.exists) throw new HttpsError('not-found', 'intent not found')
      const invId = snap.data().moyasarInvoiceId
      if (invId) {
        const inv = await moyasarGetInvoice(invId)
        const pays = (inv && inv.payments) || []
        payment = pays.find((p) => p.status === 'paid') || pays[0] || null
      }
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e
    throw new HttpsError('internal', 'moyasar: ' + ((e && e.message) || ''))
  }
  if (!payment) return { settled: false, reason: 'no-payment-yet' }
  return await settleFromPayment(db, payment)
})

// Moyasar webhook (configure the URL + a webhook secret in the Moyasar dashboard).
const paymentWebhook = onRequest(async (req, res) => {
  try {
    const body = req.body || {}
    // Moyasar posts { id, type, secret_token, data:<payment> }. FAIL CLOSED:
    // reject if no secret is configured OR the token doesn't match — a missing
    // secret must never mean "accept anonymous callbacks".
    const hookSecret = process.env.MOYASAR_WEBHOOK_SECRET
    if (!hookSecret || body.secret_token !== hookSecret) {
      res.status(401).json({ ok: false, error: 'invalid secret_token' })
      return
    }
    const paymentId = (body.data && body.data.id) || body.paymentId || body.id
    if (!paymentId) {
      res.status(400).json({ ok: false, error: 'no payment id' })
      return
    }
    const db = getFirestore()
    // Re-fetch from the Moyasar API — the webhook body is NEVER trusted. If the
    // fetch fails, settle nothing and let Moyasar retry (no body.data fallback:
    // that would let a forged callback fabricate a "paid" payment).
    let payment
    try {
      payment = await moyasarGetPayment(paymentId)
    } catch (e) {
      res.status(502).json({ ok: false, error: 'gateway re-fetch failed' })
      return
    }
    const out = await settleFromPayment(db, payment)
    res.status(200).json({ ok: true, ...out })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err && err.message) || 'internal error' })
  }
})

// Callable used by the venue's return page right after a Moyasar checkout — the
// reliable settlement path (doesn't depend on webhook delivery). Verifies the
// caller manages the invoice's venue (or is a platform admin).
const confirmInvoicePayment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.')
  const paymentId = request.data && request.data.paymentId
  if (!paymentId) throw new HttpsError('invalid-argument', 'paymentId is required.')
  const db = getFirestore()
  let payment
  try { payment = await moyasarGetPayment(paymentId) } catch (e) { throw new HttpsError('internal', 'moyasar: ' + ((e && e.message) || '')) }
  const meta = payment.metadata || {}
  if (!meta.invoiceId) throw new HttpsError('failed-precondition', 'Payment is not bound to an invoice.')
  const invSnap = await db.doc(`platformInvoices/${meta.invoiceId}`).get()
  if (!invSnap.exists) throw new HttpsError('not-found', 'Invoice not found.')
  const invoice = invSnap.data() || {}
  const uid = request.auth.uid
  const userSnap = await db.collection('users').doc(uid).get()
  const isMgr = userSnap.exists && ['owner', 'manager'].includes(userSnap.data().role) && userSnap.data().tenantId === invoice.tenantId
  const isAdmin = (await db.doc(`platformAdmins/${uid}`).get()).exists
  if (!isMgr && !isAdmin) throw new HttpsError('permission-denied', 'Not your invoice.')
  return await settleInvoiceFromPayment(db, payment)
})

// ---------------------------------------------------------------------------
// #6 SAVED CARDS (one-tap reorder). Tokens live server-only under
// tenants/{tid}/savedCards and are keyed to the paying DEVICE (a random key in
// the diner's localStorage) — never to a phone, so knowing a phone can't charge
// a card. The client only ever sees last4/brand; charges are server-derived.
// ---------------------------------------------------------------------------

// Return this device's saved cards for a venue — sanitized (NO token).
const listSavedCards = onCall(async (request) => {
  const { tenantId, deviceKey } = request.data || {}
  if (!tenantId || !deviceKey) return { cards: [] }
  const db = getFirestore()
  const snap = await db.collection(`tenants/${tenantId}/savedCards`)
    .where('deviceKey', '==', String(deviceKey)).limit(10).get().catch(() => null)
  if (!snap) return { cards: [] }
  return { cards: snap.docs.map((d) => ({ id: d.id, last4: d.data().last4 || '', brand: d.data().brand || 'card' })) }
})

// Delete a saved card — only if it belongs to the requesting device.
const deleteSavedCard = onCall(async (request) => {
  const { tenantId, savedCardId, deviceKey } = request.data || {}
  if (!tenantId || !savedCardId || !deviceKey) throw new HttpsError('invalid-argument', 'missing fields')
  const db = getFirestore()
  const ref = db.doc(`tenants/${tenantId}/savedCards/${savedCardId}`)
  const snap = await ref.get()
  if (snap.exists && snap.data().deviceKey === String(deviceKey)) await ref.delete().catch(() => {})
  return { ok: true }
})

// Charge a saved card for an order/booking/ticket. Amount is server-derived
// (same helper as createPayIntent), the token is verified to belong to THIS
// device, and settlement is amount-bound & idempotent. 3DS-required charges
// return a transactionUrl for the client to complete, then /pay/return settles.
const payWithSavedCard = onCall(async (request) => {
  const { tenantId, savedCardId, deviceKey, kind, refId } = request.data || {}
  if (!tenantId || !savedCardId || !deviceKey || !kind || !refId) throw new HttpsError('invalid-argument', 'missing fields')
  if (kind === 'subscription') throw new HttpsError('permission-denied', 'not allowed for subscriptions')
  const db = getFirestore()
  const cardRef = db.doc(`tenants/${tenantId}/savedCards/${savedCardId}`)
  const cardSnap = await cardRef.get()
  if (!cardSnap.exists) throw new HttpsError('not-found', 'saved card not found')
  const card = cardSnap.data() || {}
  if (card.deviceKey !== String(deviceKey) || !card.token) throw new HttpsError('permission-denied', 'card not on this device')

  const { amountSar, description } = await deriveIntentAmount(db, { kind, tenantId, refId, request })
  const amount = Math.round(amountSar * 100)
  if (amount < 100) throw new HttpsError('failed-precondition', 'amount too small')
  const base = (process.env.APP_BASE_URL || 'https://rbt360sa.com').replace(/\/$/, '')
  const intentRef = db.collection('payIntents').doc()
  await intentRef.set({ kind, tenantId, refId, amount, currency: 'SAR', status: 'created', description, createdAt: FieldValue.serverTimestamp() })

  let payment
  try {
    payment = await moyasarChargeToken({
      amount, token: card.token, description,
      callbackUrl: `${base}/pay/return?intent=${intentRef.id}`,
      metadata: { payIntentId: intentRef.id, kind, tenantId, refId },
    })
  } catch (e) { throw new HttpsError('internal', 'charge failed: ' + ((e && e.message) || '')) }

  if (payment.status === 'paid') {
    await cardRef.set({ lastUsedAtMs: Date.now() }, { merge: true }).catch(() => {})
    const out = await settleFromPayment(db, { ...payment, metadata: { payIntentId: intentRef.id, kind, tenantId, refId } })
    return { paid: true, payIntentId: intentRef.id, paymentId: payment.id, settled: !!out.settled }
  }
  // needs 3DS/OTP → hand the transaction_url to the client to finish.
  const url = (payment.source && payment.source.transaction_url) || ''
  return { paid: false, payIntentId: intentRef.id, transactionUrl: url, status: payment.status || 'initiated' }
})

// ---------------------------------------------------------------------------
// 5) auditRetention — 1st of each month 05:00: prune platformAudit older than
// 365 days in batches so the trail stays bounded.
// ---------------------------------------------------------------------------
const auditRetention = onSchedule(
  { schedule: '0 5 1 * *', timeZone: 'Asia/Riyadh', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = getFirestore()
    const cutoff = new Date(Date.now() - 365 * 86400000)
    for (;;) {
      const snap = await db.collection('platformAudit')
        .where('at', '<', cutoff).limit(400).get().catch(() => null)
      if (!snap || snap.empty) return
      const batch = db.batch()
      snap.docs.forEach((doc) => batch.delete(doc.ref))
      await batch.commit().catch(() => {})
      if (snap.size < 400) return
    }
  }
)

// ============ Self-serve plan subscription (signup checkout) ============
// The ONLY price source for self-signup plans. Adjust here; the client page
// mirrors these numbers for display only and is never trusted.
const PLAN_PRICES = { menu: 99, ops: 199, pro: 349, enterprise: 549 } // SAR / month
const YEARLY_DISCOUNT = 0.8 // yearly = 12 months at 20% off

// A venue manager creates their OWN pending plan invoice (server-priced), then
// pays it through the normal 'subscription' pay-intent flow; the payment webhook
// (settleInvoiceFromPayment) marks it paid AND activates plan + expiry + email.
const startPlanSubscription = onCall(async (request) => {
  const { planId, yearly } = request.data || {}
  if (!PLAN_PRICES[planId]) throw new HttpsError('invalid-argument', 'unknown plan')
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign in first')
  const db = getFirestore()
  const uSnap = await db.collection('users').doc(uid).get()
  const u = uSnap.exists ? uSnap.data() : {}
  const tid = u.tenantId
  if (!tid || !['owner', 'manager'].includes(u.role)) throw new HttpsError('permission-denied', 'managers only')
  const tSnap = await db.doc(`tenants/${tid}`).get()
  const tName = tSnap.exists ? (tSnap.data().name || '') : ''
  const monthly = PLAN_PRICES[planId]
  const amount = yearly ? Math.round(monthly * 12 * YEARLY_DISCOUNT) : monthly
  const now = new Date()
  const ref = await db.collection('platformInvoices').add({
    tenantId: tid, tenantName: tName, plan: planId, amount, currency: 'SAR',
    period: `${now.toISOString().slice(0, 7)}${yearly ? ' — سنوي' : ''}`,
    billing: yearly ? 'yearly' : 'monthly', status: 'pending', source: 'self-signup',
    createdAt: FieldValue.serverTimestamp(),
  })
  return { invoiceId: ref.id, amount }
})

// ============ Realistic image→3D model (top-tier feature) ============
// Provider: Meshy image-to-3D (MESHY_API_KEY env). Fail-soft honest: without a
// key the callable explains exactly what to configure. Result GLB is stored in
// the venue library and (optionally) attached to the item as model3dUrl.
const { getStorage } = require('firebase-admin/storage')
const nodeCrypto = require('crypto')
const sleepMs = (ms) => new Promise((res) => setTimeout(res, ms))

const imageTo3d = onCall({ timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  const key = process.env.MESHY_API_KEY
  if (!key) {
    throw new HttpsError('failed-precondition',
      'خدمة المجسمات الواقعية تحتاج تفعيلاً: أنشئ حساباً في meshy.ai وضع MESHY_API_KEY في functions/.env ثم أعد نشر الدوال.')
  }
  const { tenantId, itemId, imageUrl } = request.data || {}
  if (!tenantId || !imageUrl) throw new HttpsError('invalid-argument', 'tenantId + imageUrl required')
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign in')
  const db = getFirestore()
  const uSnap = await db.collection('users').doc(uid).get()
  const u = uSnap.exists ? uSnap.data() : {}
  if (u.tenantId !== tenantId || !['owner', 'manager'].includes(u.role)) throw new HttpsError('permission-denied', 'managers only')
  // Plan gate: top tier (enterprise) or an explicit per-venue feature override.
  const tSnap = await db.doc(`tenants/${tenantId}`).get()
  const td = tSnap.exists ? tSnap.data() : {}
  const ORDER = { menu: 1, ops: 2, pro: 3, enterprise: 4 }
  const allowed = td.features && td.features.ar3d === true
    ? true
    : (ORDER[td.plan || 'enterprise'] || 4) >= 4 && td.features?.ar3d !== false
  if (!allowed) throw new HttpsError('permission-denied', 'المجسمات الواقعية ميزة الباقة المتكاملة — رقِّ اشتراكك لتفعيلها.')

  // Credit protection (server-enforced): every conversion consumes PLATFORM
  // Meshy credits, so venues get a monthly cap (tenant.ar3dMonthly, default 20,
  // platform console edits it) + max 2 conversions per item per month.
  const AR3D_DEFAULT_MONTHLY = 20
  const cap = Math.max(0, Number(td.ar3dMonthly) || AR3D_DEFAULT_MONTHLY)
  const monthStart = new Date()
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const jobsSnap = await db.collection(`tenants/${tenantId}/ar3dJobs`)
    .where('createdAt', '>=', monthStart).get().catch(() => null)
  const monthJobs = jobsSnap ? jobsSnap.docs.map((d) => d.data()).filter((j) => j.status === 'done' || j.status === 'running') : []
  if (monthJobs.length >= cap) {
    throw new HttpsError('resource-exhausted',
      `اكتمل حد التحويلات الواقعية لهذا الشهر (${cap} تحويلاً). يتجدد الحد مطلع الشهر، أو تواصل مع المنصة لرفعه.`)
  }
  if (itemId && monthJobs.filter((j) => j.itemId === itemId).length >= 2) {
    throw new HttpsError('resource-exhausted',
      'هذا الصنف حُوِّل مرتين هذا الشهر — الحد تحويلان لكل صنف شهرياً حمايةً للرصيد. عدِّل صورة الصنف جيداً قبل إعادة المحاولة الشهر القادم.')
  }
  // Fail-soft provider-balance guard: warn out loudly before burning a task on
  // an empty Meshy wallet (endpoint shape may change — never block on it).
  try {
    const bal = await fetch('https://api.meshy.ai/openapi/v1/balance', { headers: { Authorization: `Bearer ${key}` } }).then((r) => r.json())
    const credits = bal && (typeof bal.balance === 'number' ? bal.balance : (bal.result && typeof bal.result.balance === 'number' ? bal.result.balance : null))
    if (credits != null && credits < 5) {
      throw new HttpsError('resource-exhausted', `رصيد مزود المجسمات أوشك على النفاد (${credits} نقطة) — أعد الشحن من meshy.ai ثم أعد المحاولة.`)
    }
  } catch (e) { if (e instanceof HttpsError) throw e }

  // 1) create the conversion task
  const create = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, should_texture: true, enable_pbr: true, topology: 'triangle' }),
  }).then((r) => r.json()).catch((e) => ({ _err: String(e && e.message) }))
  const taskId = create && create.result
  if (!taskId) throw new HttpsError('internal', 'تعذر بدء التحويل: ' + JSON.stringify(create || {}).slice(0, 160))
  await db.collection(`tenants/${tenantId}/ar3dJobs`).doc(String(taskId)).set({
    itemId: itemId || '', imageUrl, status: 'running', by: uid, createdAt: FieldValue.serverTimestamp(),
  }).catch(() => {})

  // 2) poll (up to ~8 min inside the callable window)
  let glbUrl = ''
  let usdzUrl = ''
  for (let i = 0; i < 48; i++) {
    await sleepMs(10000)
    const s = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`, {
      headers: { Authorization: `Bearer ${key}` },
    }).then((r) => r.json()).catch(() => null)
    const st = s && s.status
    if (st === 'SUCCEEDED') { glbUrl = s.model_urls && s.model_urls.glb; usdzUrl = (s.model_urls && s.model_urls.usdz) || ''; break }
    if (st === 'FAILED' || st === 'CANCELED') {
      await db.collection(`tenants/${tenantId}/ar3dJobs`).doc(String(taskId)).set({ status: 'failed' }, { merge: true }).catch(() => {})
      throw new HttpsError('internal', 'فشل التحويل لدى المزود: ' + ((s.task_error && s.task_error.message) || st))
    }
  }
  if (!glbUrl) {
    throw new HttpsError('deadline-exceeded', 'التحويل يستغرق أطول من المعتاد — المهمة مستمرة لدى المزود، أعد المحاولة بعد دقائق وسيكتمل أسرع.')
  }

  // 3) store the GLB (+ USDZ for iPhone Quick Look) in the venue library + attach to the item
  const buf = Buffer.from(await (await fetch(glbUrl)).arrayBuffer())
  const bucket = getStorage().bucket()
  const stamp = Date.now()
  const path = `tenants/${tenantId}/library/ar/real-${stamp}.glb`
  const token = nodeCrypto.randomUUID()
  await bucket.file(path).save(buf, {
    metadata: { contentType: 'model/gltf-binary', metadata: { firebaseStorageDownloadTokens: token } },
  })
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
  // Without a USDZ, iPhones have no on-table AR at all (Quick Look accepts
  // only USDZ) — Meshy provides one; a failure here must not lose the GLB.
  let usdzStoredUrl = ''
  if (usdzUrl) {
    try {
      const ubuf = Buffer.from(await (await fetch(usdzUrl)).arrayBuffer())
      const upath = `tenants/${tenantId}/library/ar/real-${stamp}.usdz`
      const utoken = nodeCrypto.randomUUID()
      await bucket.file(upath).save(ubuf, {
        metadata: { contentType: 'model/vnd.usdz+zip', metadata: { firebaseStorageDownloadTokens: utoken } },
      })
      usdzStoredUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(upath)}?alt=media&token=${utoken}`
    } catch (_) { /* GLB alone still works everywhere except iOS Quick Look */ }
  }
  if (itemId) await db.doc(`tenants/${tenantId}/items/${itemId}`).set({ model3dUrl: url, model3dUsdzUrl: usdzStoredUrl }, { merge: true }).catch(() => {})
  await db.collection(`tenants/${tenantId}/ar3dJobs`).doc(String(taskId)).set({ status: 'done', url, usdzUrl: usdzStoredUrl }, { merge: true }).catch(() => {})
  return { url, usdzUrl: usdzStoredUrl, remaining: Math.max(0, cap - monthJobs.length - 1), cap }
})

module.exports = {
  generateMonthlyInvoices,
  setPlatformRole,
  startPlanSubscription,
  imageTo3d,
  requestVenueExport,
  createPayIntent,
  issueFreeTicket,
  confirmPayIntent,
  paymentWebhook,
  confirmInvoicePayment,
  listSavedCards,
  deleteSavedCard,
  payWithSavedCard,
  auditRetention,
}
