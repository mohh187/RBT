// ==================== PLATFORM EXTENSIONS (super-admin backend) ====================
// Additional Cloud Functions layered on top of index.js for billing, roles,
// data export, payment webhooks and audit retention. Registered from index.js
// via: Object.assign(exports, require('./platformExtensions'))
//
// initializeApp() is already called in index.js — do NOT call it here.
// getFirestore() is resolved lazily inside every handler.
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https')
const logger = require('firebase-functions/logger')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { sendEmail, emailShell, esc } = require('./messaging')
const { shell, facts, section } = require('./emailTemplates.js')
const { platformBrand } = require('./emailBrand.js')
const { normLang, L } = require('./emailLang.js')
const { receiptForSimple, notifyReceipt, invoiceLink } = require('./invoicing')
const { takeSpend, readSpend, packPrice, extraField, CHANNEL_AR, limitsFor: spendLimitsFor } = require('./spend')
const { plansConfig, resolvePlanPrice, yearlyAmount } = require('./platformPricing')

// Take one unit off a metered channel or refuse the call outright, with a
// message the venue can act on. Used by the three AI features whose bespoke
// counters used to live inside their own functions — each one invisible to the
// console, each one hardcoded, none of them toppable-up.
//
// error-open passes through on purpose: a Firestore blip must not take a paid
// feature offline (and takeSpend caps how long it will do that).
async function claimSpend(db, tenantId, channel, want = 1) {
  const r = await takeSpend(db, tenantId, channel, want)
  if (r.granted >= want || r.reason === 'error-open') return r
  const label = CHANNEL_AR[channel] || channel
  const why = {
    cap: `اكتمل رصيدك الشهري من «${label}». يمكنك شراء رصيد إضافي من صفحة الفوترة، أو ترقية باقتك.`,
    daily: `بلغت الحد اليومي من «${label}» — يتجدد غداً.`,
    burst: 'طلبات كثيرة في وقت قصير — انتظر دقيقة ثم أعد المحاولة.',
    platformBurst: 'الذكاء الاصطناعي مزدحم على المنصة الآن — أعد المحاولة بعد لحظات.',
    killed: `«${label}» موقوف مؤقتاً من إدارة المنصة.`,
    suspended: 'اشتراك المنشأة موقوف.',
    disabled: `«${label}» غير مفعّل في باقتك — رقِّ اشتراكك أو اشترِ رصيداً.`,
    'error-closed': 'الخدمة غير متاحة مؤقتاً، أعد المحاولة بعد قليل.',
  }[r.reason] || 'تم بلوغ حدّ الاستخدام.'
  throw new HttpsError('resource-exhausted', why)
}

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

// Stricter gate for the highest-impact platform actions (cross-tenant data
// export, etc.). A doc with no `role` field is the bootstrap superAdmin (same
// convention as setPlatformRole); support/analyst tiers are rejected.
async function requireSuperAdmin(db, auth) {
  const snap = await requirePlatformAdmin(db, auth)
  const role = (snap.data() || {}).role
  if (role && role !== 'superAdmin') throw new HttpsError('permission-denied', 'Super admins only.')
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

    // The single price config, shared with self-signup.
    const planCfg = await plansConfig(db)
    const currency = planCfg.currency

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

        // COVERAGE RULE — the root fix for «دفعنا سنوياً وما زالت تصلنا فاتورة
        // شهرية»: a venue whose paid coverage (planExpiresAt) extends past the
        // END of the month being billed owes nothing this month. A yearly
        // subscriber's expiry sits ~a year out, so the cron skips them for
        // eleven months and resumes exactly when coverage lapses. Monthly
        // payers (expiry ≤ month end) keep getting billed as before.
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
        if (exp && exp > monthEnd) return

        // Resolve the default mismatch: the app grants an UNSET plan full
        // (enterprise) features as a trial, so a venue with no plan assigned is
        // not a billable subscription — don't auto-invoice it at the lowest tier.
        // Billing begins only once the platform assigns an explicit plan.
        if (!d.plan) return
        const plan = d.plan
        // ONE price resolver, shared with self-signup (functions/platformPricing.js).
        // These two used to read different tables, so a venue paid 549 to join
        // and was then billed 399 a month later for the same service.
        const metaSnap = await db.doc(`platformVenueMeta/${t.id}`).get().catch(() => null)
        const meta = metaSnap && metaSnap.exists ? (metaSnap.data() || {}) : {}
        const amount = resolvePlanPrice({ ...d, id: t.id }, meta, planCfg)
        if (amount == null) return

        // IDEMPOTENCY IS THE DOCUMENT ID, NOT A QUERY. The old check was
        // `where(tenantId).where(period).limit(1)` — a read, then a write, with
        // a gap in between. A scheduler retry (or a 540s timeout mid-fan-out
        // followed by a re-run) raced that gap and double-billed every venue.
        // A deterministic id makes the duplicate a write collision instead.
        const invId = `sub_${t.id}_${period}`
        const existing = await db.doc(`platformInvoices/${invId}`).get().catch(() => null)
        if (existing && existing.exists) return
        // Legacy auto-id invoices from before this change still count as issued.
        const dup = await db.collection('platformInvoices')
          .where('tenantId', '==', t.id)
          .where('period', '==', period)
          .limit(1)
          .get()
          .catch(() => null)
        if (dup && !dup.empty) return

        await db.doc(`platformInvoices/${invId}`).set({
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
          const il = normLang(d.lang)
          const p = L(il)
          const ib = platformBrand({}, il)
          await sendEmail({
            // The platform billing the venue — one mail per venue per month,
            // and it must never be refused by the venue's own usage meter.
            meter: 'platform',
            to: email,
            lang: il,
            subject: p(`فاتورة اشتراك rbt360 — ${period}`, `rbt360 subscription invoice — ${period}`),
            // OUR identity — we are billing them. The footer carries the legal
            // entity, which is the same one printed on the tax invoice itself.
            html: shell(ib, {
              title: p(`فاتورة اشتراك — ${d.name || ''}`, `Subscription invoice — ${d.name || ''}`),
              preheader: p(`فاتورة اشتراك ${period}`, `Subscription invoice ${period}`),
              body: p(
                `<p style="margin:0 0 10px;">صدرت فاتورة اشتراك «${esc(d.name || '')}» عن فترة <strong>${esc(period)}</strong>.</p>`,
                `<p style="margin:0 0 10px;">The subscription invoice for ${esc(d.name || '')} covering <strong>${esc(period)}</strong> has been issued.</p>`,
              )
                + facts([[p('الباقة', 'Plan'), plan], [p('المبلغ', 'Amount'), `${amount} ${currency}`]], { dir: ib.dir }),
              cta: { label: p('سداد الفاتورة', 'Pay the invoice'), href: payUrl },
            }),
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
  // Exporting an entire venue's data is super-admin only (support/analyst tiers
  // must not be able to exfiltrate a tenant's full dataset).
  const callerSnap = await requireSuperAdmin(db, request.auth)
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
      // billing is stamped on the tenant so the console and the coverage rule
      // in generateMonthlyInvoices can both see the cycle at a glance.
      await tRef.set({ planStatus: 'active', planExpiresAt: next, ...(invoice.billing ? { billing: invoice.billing } : {}), ...(invoice.plan ? { plan: invoice.plan } : {}) }, { merge: true }).catch(() => {})

      // Email the venue owner a payment receipt (best-effort).
      const email = await ownerEmailOf(db, d.ownerUid)
      if (email) {
        const rl = normLang(d.lang)
        const p = L(rl)
        const rb = platformBrand({}, rl)
        await sendEmail({
          // Payment receipt for the platform's own subscription — see above.
          meter: 'platform',
          to: email,
          lang: rl,
          subject: p(`تم استلام دفعة اشتراك rbt360 — ${invoice.period || ''}`, `rbt360 subscription payment received — ${invoice.period || ''}`),
          html: shell(rb, {
            title: p('تم استلام دفعتك', 'Payment received'),
            preheader: p(`إيصال سداد اشتراك ${invoice.period || ''}`, `Subscription payment receipt ${invoice.period || ''}`),
            body: p(
              `<p style="margin:0 0 10px;">شكراً لك. تم استلام دفعة اشتراك «${esc(d.name || '')}» وتفعيل الباقة.</p>`,
              `<p style="margin:0 0 10px;">Thank you. The subscription payment for ${esc(d.name || '')} was received and the plan is active.</p>`,
            )
              + facts([
                [p('الفترة', 'Period'), invoice.period || ''],
                [p('المبلغ', 'Amount'), `${Number(invoice.amount) || 0} ${invoice.currency || 'SAR'}`],
                [p('مفعّلة حتى', 'Active until'), next.toISOString().slice(0, 10)],
              ], { dir: rb.dir }),
          }),
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
// The sum of what an order's own lines say it costs.
//
// Order writers do NOT agree on one field, so this reads what each actually
// emits: MenuView/CashierPOS/OrderDetail all write `unitPrice` + `lineTotal`.
// A previous version of the anti-underpay guard summed `l.price` — a field no
// writer has ever produced — so it always measured 0 and never fired once.
// Exported and pure so it can be TESTED; the version that shipped broken was
// untestable inline code inside a Firestore-bound function.
function orderLinesSum(items) {
  return (items || []).reduce((sum, l) => {
    const line = Number(l && l.lineTotal) || (Number(l && l.unitPrice) || 0) * (Number(l && l.qty) || 1)
    return sum + (Number.isFinite(line) ? line : 0)
  }, 0)
}

// Anti-underpay: the amount about to be charged must not fall below what the
// order's own lines add up to, minus the reductions the order records. An order
// with no priced lines is unverifiable, not invalid — the price check in
// onNewOrder is the authority there; this is the second line of defence.
function orderTotalIsSane(order) {
  const o = order || {}
  const itemsSum = orderLinesSum(o.items)
  if (!(itemsSum > 0)) return true
  const discount = (Number(o.discount) || 0)
    + (Number(o.loyaltyDiscount) || 0)
    + (Number(o.memberDiscount) || 0)
    + (Number(o.offerDiscount) || 0)
  return (Number(o.total) || 0) + 0.01 >= itemsSum - discount
}

async function deriveIntentAmount(db, { kind, tenantId, refId, request }) {
  let amountSar = 0
  let description = ''
  if (kind === 'order') {
    const s = await db.doc(`tenants/${tenantId}/orders/${refId}`).get()
    if (!s.exists) throw new HttpsError('not-found', 'order not found')
    const o = s.data()
    // An order the server already refused must never be payable. Validation in
    // onNewOrder cancels a tampered or out-of-stock order — without this check
    // the guest could still be charged for it, because nothing else here looks
    // at status.
    if (o.status === 'cancelled' || o.status === 'refunded') {
      throw new HttpsError('failed-precondition', 'order is no longer payable')
    }
    amountSar = Number(o.total) || 0
    if (!orderTotalIsSane(o)) {
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
  } else if (kind === 'spendPack') {
    // Top-up for ANY metered channel. refId is "<channel>:<qty>" and the price
    // comes from packPrice() — the server table in functions/spend.js, or its
    // console override. Nothing the client sends touches the amount, and an
    // unlisted quantity is refused outright rather than priced by arithmetic
    // (which is how a client-chosen qty would become a client-chosen price).
    const [channel, qtyRaw] = String(refId).split(':')
    const qty = Number(qtyRaw)
    const uid = request && request.auth && request.auth.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to buy credits.')
    const uSnap = await db.collection('users').doc(uid).get()
    const isMgr = uSnap.exists && ['owner', 'manager'].includes(uSnap.data().role) && uSnap.data().tenantId === tenantId
    if (!isMgr) throw new HttpsError('permission-denied', 'Managers only.')
    const price = await packPrice(db, channel, qty)
    if (!price) throw new HttpsError('invalid-argument', 'unknown credit pack')
    amountSar = price
    description = `${CHANNEL_AR[channel] || channel} +${qty} — ${tenantId}`
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
    // THE CLAIM IS RELEASED IF THIS FAILS.
    //
    // The intent is claimed above so only one caller dispatches. But this write
    // — the one that actually turns a captured payment into a live order — used
    // to end in `.catch(() => {})`. If it failed, the money was taken, the
    // intent said 'paid', every webhook redelivery returned {already:true}, and
    // expireUnpaidOrders cancelled the order twenty minutes later. The guest was
    // charged and their order silently vanished, with nothing anywhere to say so.
    //
    // So: on failure, hand the claim back. Moyasar redelivers a webhook that was
    // not acknowledged, and the next delivery re-runs the whole dispatch. A
    // retry is safe precisely because the claim is atomic.
    try {
      await oRef.set(patch, { merge: true })
    } catch (e) {
      await intentRef.update({
        status: 'created',
        settleError: (e && e.message) || 'order activation failed',
        settleErrorAt: FieldValue.serverTimestamp(),
      }).catch(() => {})
      await writeAudit(db, {
        kind: 'payment', action: 'settleRetry', tenantId: tid,
        refId: intent.refId, providerRef: payment.id,
      }).catch(() => {})
      logger.error('[settle] order activation failed — claim released for retry', {
        tid, orderId: intent.refId, paymentId: payment.id, error: (e && e.message) || String(e),
      })
      throw e // a non-2xx tells Moyasar to redeliver
    }
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
  } else if (intent.kind === 'spendPack') {
    // Same full automation as aiCredits: settled payment → the balance is on
    // the venue instantly and a PAID invoice lands in the console. The balance
    // DEPLETES as it is used (functions/spend.js draws it down), so a pack of
    // 1,000 is 1,000 units — not 1,000 extra every month forever.
    const [channel, qtyRaw] = String(intent.refId).split(':')
    const qty = Number(qtyRaw) || 0
    if (CHANNEL_AR[channel] && qty > 0) {
      const tRef = db.doc(`tenants/${tid}`)
      const tSnap = await tRef.get().catch(() => null)
      const tName = tSnap && tSnap.exists ? (tSnap.data().name || '') : ''
      // update(), NOT set(merge): only update() reads a dotted key as a FIELD
      // PATH. set() would have created a literal top-level field named
      // "spendExtra.waUtility" and the balance would never have been found.
      await tRef.update({ [extraField(channel)]: FieldValue.increment(qty) }).catch(() => {})
      await db.collection('platformInvoices').add({
        tenantId: tid, tenantName: tName, plan: 'spendPack',
        amount: (Number(intent.amount) || 0) / 100, currency: 'SAR',
        period: `${CHANNEL_AR[channel]} +${qty}`, status: 'paid', provider: 'moyasar', providerRef: payment.id,
        paidAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(),
      }).catch(() => {})
      await writeAudit(db, { kind: 'payment', action: 'spendPackCredited', tenantId: tid, refId: intent.refId, providerRef: payment.id })
    }
  } else if (intent.kind === 'booking') {
    const rRef = db.doc(`tenants/${tid}/reservations/${intent.refId}`)
    const rSnap = await rRef.get().catch(() => null)
    const rd = rSnap && rSnap.exists ? rSnap.data() : {}
    if (['cancelled', 'declined', 'done'].includes(rd.status)) {
      // the venue already closed this booking — record the deposit for a manual
      // refund but do NOT resurrect it to 'confirmed'.
      await rRef.set({ depositStatus: 'paid', refundDue: true, paymentRef: payment.id, paidAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {})
      await writeAudit(db, { kind: 'payment', action: 'bookingDepositAfterClose', tenantId: tid, refId: intent.refId, providerRef: payment.id })
    } else {
      await rRef.set({ depositStatus: 'paid', status: 'confirmed', paymentRef: payment.id, paidAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {})
      const rec = await receiptForSimple(db, tid, { kind: 'booking', refId: intent.refId, buyerName: rd.name || '', buyerPhone: rd.phone || '', label: 'عربون حجز', amount: (Number(intent.amount) || 0) / 100, providerRef: payment.id }).catch(() => null)
      if (rec && rd.phone) await notifyReceipt(rec.tenant, rd.phone, { code: rd.code || '', total: rec.total, currency: rec.currency, link: invoiceLink(tid, rec.id) })
    }
  } else if (intent.kind === 'ticket') {
    const tRef = db.doc(`tenants/${tid}/tickets/${intent.refId}`)
    const tSnap = await tRef.get().catch(() => null)
    const td = tSnap && tSnap.exists ? tSnap.data() : {}
    // Capacity: a paid ticket must not oversell a limited event. Count issued
    // (valid/used) tickets and, if full, hold this one for a manual refund
    // rather than admitting an over-capacity guest.
    let full = false
    if (td.eventId) {
      const ev = await db.doc(`tenants/${tid}/events/${td.eventId}`).get().catch(() => null)
      const evd = ev && ev.exists ? ev.data() : {}
      const type = (evd.ticketTypes || []).find((t) => t.key === td.typeKey) || {}
      const cap = Number(type.capacity ?? evd.capacity) || 0
      if (cap > 0) {
        const cnt = await db.collection(`tenants/${tid}/tickets`).where('eventId', '==', td.eventId).where('status', 'in', ['valid', 'used']).count().get().catch(() => null)
        if (cnt && cnt.data().count >= cap) full = true
      }
    }
    if (full) {
      await tRef.set({ status: 'refund_due', paidOnline: true, oversold: true, paymentRef: payment.id, paidAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {})
      await writeAudit(db, { kind: 'payment', action: 'ticketOversold', tenantId: tid, refId: intent.refId, providerRef: payment.id })
    } else {
      await tRef.set({ status: 'valid', paidOnline: true, paymentRef: payment.id, paidAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {})
      const rec = await receiptForSimple(db, tid, { kind: 'ticket', refId: intent.refId, buyerName: td.name || '', buyerPhone: td.phone || '', label: td.typeName ? `تذكرة: ${td.typeName}` : 'تذكرة', amount: (Number(intent.amount) || 0) / 100, providerRef: payment.id }).catch(() => null)
      if (rec && td.phone) await notifyReceipt(rec.tenant, td.phone, { code: td.code || '', total: rec.total, currency: rec.currency, link: invoiceLink(tid, rec.id) })
    }
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
// Prices come from functions/platformPricing.js — the SAME resolver the
// monthly cron uses. The duplicate table that used to live here is what made
// a self-signup pay 549 and then be re-billed 399 for the identical service.
//
// A venue manager creates their OWN pending plan invoice (server-priced), then
// pays it through the normal 'subscription' pay-intent flow; the payment webhook
// (settleInvoiceFromPayment) marks it paid AND activates plan + expiry + email.
const startPlanSubscription = onCall(async (request) => {
  const { planId, yearly } = request.data || {}
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign in first')
  const db = getFirestore()
  const planCfg = await plansConfig(db)
  if (!planCfg.prices[planId]) throw new HttpsError('invalid-argument', 'unknown plan')
  const uSnap = await db.collection('users').doc(uid).get()
  const u = uSnap.exists ? uSnap.data() : {}
  const tid = u.tenantId
  if (!tid || !['owner', 'manager'].includes(u.role)) throw new HttpsError('permission-denied', 'managers only')
  const tSnap = await db.doc(`tenants/${tid}`).get()
  const tName = tSnap.exists ? (tSnap.data().name || '') : ''
  const metaSnap = await db.doc(`platformVenueMeta/${tid}`).get().catch(() => null)
  const meta = metaSnap && metaSnap.exists ? (metaSnap.data() || {}) : {}
  // A negotiated price honoured at signup too — previously the console's
  // «سعر خاص» was ignored here and only applied from the next monthly run.
  const monthly = resolvePlanPrice({ ...(tSnap.exists ? tSnap.data() : {}), plan: planId }, meta, planCfg)
  const amount = yearly ? yearlyAmount(monthly, planCfg) : monthly
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

// Hand-synced mirror of GEN3D_RANGE in src/lib/dishComposition.js — this
// package is CommonJS and cannot import the ESM contract, and the inline
// drift scanner does not cover functions/. Change BOTH sides together.
const GEN3D = {
  maxViews: 4,             // Meshy hard cap: primary photo + up to 3 picked shots
  smoothPolycount: 150000, // only used by the opt-in smooth (stylized) mode
}

const imageTo3d = onCall({ timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  const key = process.env.MESHY_API_KEY
  if (!key) {
    throw new HttpsError('failed-precondition',
      'خدمة المجسمات الواقعية تحتاج تفعيلاً: أنشئ حساباً في meshy.ai وضع MESHY_API_KEY في functions/.env ثم أعد نشر الدوال.')
  }
  const { tenantId, itemId, imageUrl, imageUrls, itemName, multiView, smooth } = request.data || {}
  if (!tenantId || !imageUrl) throw new HttpsError('invalid-argument', 'tenantId + imageUrl required')
  // Multi-view is OPT-IN: only shots the manager explicitly ticked in the
  // studio arrive with multiView:true. Un-flagged imageUrls (stale deployed
  // SPA bundles still send the whole swipe gallery) are IGNORED — feeding
  // arbitrary gallery shots to multi-image-to-3d fused mismatched platings
  // into averaged cartoon-blob geometry.
  const extra = multiView === true && Array.isArray(imageUrls)
    ? imageUrls.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
    : []
  // Deduped, capped at GEN3D.maxViews (mirrors GEN3D_RANGE.maxViews).
  const views = [...new Set([imageUrl, ...extra].filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)))].slice(0, GEN3D.maxViews)
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

  // Credit protection: every conversion consumes PLATFORM Meshy credits — the
  // dearest unit on the platform at roughly 1.20 USD each.
  //
  // The MONTHLY cap now lives in the shared meter (functions/spend.js, channel
  // 'ar3d'), which is what makes it plan-aware, toppable-up with a purchase,
  // and visible in /platform/spend. tenant.ar3dMonthly still wins if the
  // console set one — limitsFor reads it through spendCaps precedence.
  //
  // The PER-ITEM guard stays here, because it is not a spend limit: it stops a
  // venue re-converting the same bad photo over and over, which the monthly
  // meter alone would happily allow until the money ran out.
  const uncapped = td.ar3dUnlimited === true
  // cap/monthUsed live OUTSIDE the guard: the success payload at the end of
  // this function reports `remaining`, and block-scoping them here once threw
  // a ReferenceError on every call (the 500 INTERNAL the owner hit).
  const ar3dLim = spendLimitsFor(td, 'ar3d')
  const cap = ar3dLim.month < 0 ? Infinity : ar3dLim.month
  let monthUsed = 0
  if (!uncapped) {
    const monthStart = new Date()
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
    const jobsSnap = await db.collection(`tenants/${tenantId}/ar3dJobs`)
      .where('createdAt', '>=', monthStart).get().catch(() => null)
    const monthJobs = jobsSnap ? jobsSnap.docs.map((d) => d.data()).filter((j) => j.status === 'done' || j.status === 'running') : []
    monthUsed = monthJobs.length
    if (itemId && monthJobs.filter((j) => j.itemId === itemId).length >= 2) {
      throw new HttpsError('resource-exhausted',
        'هذا الصنف حُوِّل مرتين هذا الشهر — الحد تحويلان لكل صنف شهرياً حمايةً للرصيد. عدِّل صورة الصنف جيداً قبل إعادة المحاولة الشهر القادم.')
    }
    await claimSpend(db, tenantId, 'ar3d')
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

  // 1) create the conversion task.
  // REALISM DEFAULT: texture derives from the photograph alone — no
  // texture_prompt repainting it toward a prompt-imagined generic dish, and
  // no remesh — Meshy's raw reconstruction keeps drips, wobble edges and rim
  // detail instead of smoothing them into rounded lumps. Keepers in BOTH
  // modes: ai_model meshy-5, enable_pbr, and symmetry_mode off (food is never
  // symmetric; forced symmetry is what stamps the toy look onto a plate).
  // smooth:true opts back into the session-2 stylized set VERBATIM (quad
  // topology + remesh + 150k polys + food texture_prompt) for owners who
  // prefer that clean-shaded look.
  const base = { ai_model: 'meshy-5', symmetry_mode: 'off', should_texture: true, enable_pbr: true }
  const quality = smooth === true
    ? {
        ...base,
        topology: 'quad',
        target_polycount: GEN3D.smoothPolycount,
        should_remesh: true,
        texture_prompt: `photorealistic restaurant dish${itemName ? `: ${String(itemName).slice(0, 80)}` : ''}, real food photography surface detail, natural appetizing colors, glossy sauce and oil highlights, 4k`,
      }
    : { ...base, should_remesh: false }
  // Multi-image only when the studio explicitly picked extra views (above) —
  // then the model's far side is built from a real photo instead of invented.
  const multi = views.length > 1
  const endpoint = multi ? 'https://api.meshy.ai/openapi/v1/multi-image-to-3d' : 'https://api.meshy.ai/openapi/v1/image-to-3d'
  const payload = multi ? { image_urls: views, ...quality } : { image_url: imageUrl, ...quality }
  const create = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json()).catch((e) => ({ _err: String(e && e.message) }))
  const taskId = create && create.result
  if (!taskId) throw new HttpsError('internal', 'تعذر بدء التحويل: ' + JSON.stringify(create || {}).slice(0, 160))
  // mode + views are diagnostics only — lets a later audit tell which mode
  // produced which model; no client reads them.
  await db.collection(`tenants/${tenantId}/ar3dJobs`).doc(String(taskId)).set({
    itemId: itemId || '', imageUrl, status: 'running', by: uid,
    mode: smooth === true ? 'smooth' : 'real', views: views.length,
    createdAt: FieldValue.serverTimestamp(),
  }).catch(() => {})

  // 2) poll (up to ~8 min inside the callable window)
  let glbUrl = ''
  let usdzUrl = ''
  for (let i = 0; i < 48; i++) {
    await sleepMs(10000)
    const s = await fetch(`${endpoint}/${taskId}`, {
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
  // -1 for unlimited: Infinity is not representable in JSON and arrives at the
  // client as null, which the usage meter would render as «0 remaining».
  const ar3dCapOut = Number.isFinite(cap) ? cap : -1
  return {
    url,
    usdzUrl: usdzStoredUrl,
    remaining: uncapped || !Number.isFinite(cap) ? -1 : Math.max(0, cap - monthUsed - 1),
    cap: ar3dCapOut,
  }
})

// ============ AI tabletop for the menu room (Gemini image) ============
// «أضف الذكاء في مكان الطاولة»: the venue asks for a tabletop that matches its
// room and gets a photograph written by the image model — steered by the wall's
// own bond, finish and clay colour plus an optional hint — stored in the venue
// library and returned as a URL the settings card wires straight into
// tenant.menuTable as kind:'image'. Fail-soft honest like imageTo3d: without a
// key the callable says exactly what to configure.
const TABLE_WALL_WORDS = {
  running: 'red-brown brick', stack: 'stack-bond brick', herringbone: 'herringbone brick',
  basket: 'basketweave brick', roman: 'long roman brick', stone: 'rustic stone',
  plaster: 'warm plaster', wood: 'wood-panelled',
  // pattern 'image' = the venue's own wall photo (sent as an inlineData
  // reference in top mode); 'none' still deserves a warm room in the words
  image: 'photographed venue', none: 'warm plaster',
}
// sharp, lazily — the logoMask.js pattern: required only when a top-mode table
// actually needs its gray sky trimmed, so no other function's cold start pays.
function loadTableSharp() {
  try {
    // eslint-disable-next-line global-require
    return require('sharp')
  } catch (_) {
    return null
  }
}
const generateTableImage = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY
  if (!key) {
    throw new HttpsError('failed-precondition',
      'توليد صور الطاولات يحتاج GEMINI_API_KEY في functions/.env ثم إعادة نشر الدوال.')
  }
  const { tenantId, hint, wall, mode, surfaceEn, venueName } = request.data || {}
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId required')
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign in')
  const db = getFirestore()
  const uSnap = await db.collection('users').doc(uid).get()
  const u = uSnap.exists ? uSnap.data() : {}
  if (u.tenantId !== tenantId || !['owner', 'manager'].includes(u.role)) throw new HttpsError('permission-denied', 'managers only')
  // Credit protection — now the SHARED meter (functions/spend.js) instead of a
  // bespoke count of aiImageJobs. Three things the old version could not do:
  // the cap follows the plan, the platform can stop it or top it up without a
  // deploy, and the usage shows up beside every other channel in
  // /platform/spend instead of being invisible.
  await claimSpend(db, tenantId, 'tableImage')

  const w = wall && typeof wall === 'object' ? wall : {}
  const clean = (s, n) => String(s || '').replace(/[\r\n"]+/g, ' ').trim().slice(0, n)
  const roomWord = TABLE_WALL_WORDS[String(w.pattern || '')] || ''
  // mode 'top' = «سطح الطبق»: a PERSPECTIVE tabletop band (near edge at the
  // frame bottom, planks receding to the venue's wall) that the menu paints
  // inside the photo box under the dish cutouts. Default 'panel' keeps the
  // original flat straight-on prompt byte-identical for existing callers.
  const top = mode === 'top'
  // In top mode the venue's own wall photo steers the far edge: fetched here
  // (the browser cannot inline it past bucket CORS), size-capped, and any
  // failure silently falls back to the words below.
  let wallPart = null
  // SSRF guard: only fetch from the project's own storage hosts — a bare
  // https:// check let any tenant member point this server-side fetch at
  // internal HTTPS services.
  const wallHostOk = (() => {
    try {
      const h = new URL(String(w.url || '')).hostname
      return h === 'firebasestorage.googleapis.com' || h === 'storage.googleapis.com'
    } catch (_) { return false }
  })()
  if (top && String(w.pattern) === 'image' && /^https:\/\//.test(String(w.url || '')) && wallHostOk) {
    try {
      const r = await fetch(String(w.url))
      const ab = r.ok ? await r.arrayBuffer() : null
      if (ab && ab.byteLength > 0 && ab.byteLength <= 4 * 1024 * 1024) {
        wallPart = { inlineData: {
          mimeType: r.headers.get('content-type') || 'image/jpeg',
          data: Buffer.from(ab).toString('base64'),
        } }
      }
    } catch (_) { /* the words still describe the room */ }
  }
  const surfWord = clean(hint, 120) || clean(surfaceEn, 60) || 'dark walnut wood with warm natural grain'
  const prompt = top ? [
    "A photorealistic photograph of a COMPLETE EMPTY wooden restaurant table, shot from a seated diner's eye level looking slightly down at about a 30 degree angle.",
    'Composition from top to bottom: the TOP of the frame above the table is a flat, solid, evenly lit light-gray background (#f0f0f0) with absolutely nothing in it;',
    'below it the TABLETOP SURFACE recedes in clear perspective — wood planks running toward the viewer, the FAR edge of the surface meeting the gray area in one clean straight horizontal line;',
    'then the NEAR front edge of the tabletop closest to the camera, with visible thickness and a soft highlight along the lip;',
    "and below the near edge the table's FRONT FACE of vertical wood panels fills the frame all the way down to the very bottom edge.",
    'The table spans the FULL width of the frame edge to edge — the gray background appears ONLY above the far edge, never at the sides and never at the bottom.',
    wallPart ? 'The attached photograph is the actual wall of this venue — borrow its colour temperature and lighting for the light falling on the wood (the gray area itself must stay plain flat gray).' : '',
    `wood style for the whole table: ${surfWord},`,
    clean(venueName, 60) ? `the room belongs to the venue "${clean(venueName, 60)}" — mood only; never write any name in the image,` : '',
    'warm amber lantern light pooling on the surface, soft highlights along the plank grain, gentle falloff toward the sides,',
    'strictly empty: no plates, no food, no cutlery, no glasses, no napkins, no people, no hands, no text, no lettering, no logo, no watermark,',
    'portrait orientation about 9:16 (around 900 by 1600 pixels), sharp focus on the near edge,',
    'usable as the table a cut-out food photograph will be seated on inside a digital menu.',
  ].filter(Boolean).join(' ') : [
    'A photorealistic photograph of an EMPTY restaurant tabletop surface filling the whole frame edge to edge,',
    'seen straight-on and slightly from the front, like a dining table directly in front of the camera,',
    clean(hint, 120) ? `surface style: ${clean(hint, 120)},` : 'surface style: dark walnut wood with warm natural grain,',
    roomWord ? `belonging to a ${roomWord}-walled room with warm amber lantern light,` : 'belonging to a warm brick-walled room with amber lantern light,',
    /^#[0-9a-fA-F]{3,8}$/.test(String(w.color || '')) ? `the room's wall clay colour is about ${w.color},` : '',
    'soft warm side lighting, fine texture detail,',
    'strictly empty: no plates, no food, no cutlery, no people, no hands, no text, no watermark,',
    'horizontal, evenly lit, usable as a clean background surface under food photography',
  ].filter(Boolean).join(' ')

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [...(wallPart ? [wallPart] : []), { text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    console.error('generateTableImage provider error', { status: res.status, body: JSON.stringify(body || {}).slice(0, 300) })
    throw new HttpsError('internal', 'مزود الصور رفض الطلب — أعد المحاولة بعد قليل.')
  }
  // the image arrives inline, base64, camelCase or snake_case depending on the
  // serving stack — accept both rather than betting on one
  const parts = (body && body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts) || []
  const imgPart = parts.find((p) => (p.inlineData && p.inlineData.data) || (p.inline_data && p.inline_data.data))
  const inline = imgPart ? (imgPart.inlineData || imgPart.inline_data) : null
  if (!inline || !inline.data) throw new HttpsError('internal', 'النموذج لم يرجع صورة — جرّب وصفاً أوضح للخامة.')
  let mime = inline.mimeType || inline.mime_type || 'image/png'
  let buf = Buffer.from(inline.data, 'base64')
  // Top mode: crop the flat gray sky above the table's far edge — the model
  // never lands the far edge pixel-flush on the frame top, and the menu wants
  // the image to START at the surface so its feather melts into the REAL wall.
  // sharp.trim removes uniform borders matching the background; the sides and
  // bottom are wood, so only the gray top actually trims. Any failure keeps
  // the raw photograph — the band's own mask still hides most of the gray.
  if (top) {
    const sharp = loadTableSharp()
    if (sharp) {
      try {
        buf = await sharp(buf).trim({ background: '#f0f0f0', threshold: 40 }).png().toBuffer()
        mime = 'image/png'
      } catch (_) { /* raw image stands */ }
    }
  }
  const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
  const bucket = getStorage().bucket()
  const stamp = Date.now()
  const path = `tenants/${tenantId}/library/tables/ai-${top ? 'top-' : ''}${stamp}.${ext}`
  const token = nodeCrypto.randomUUID()
  await bucket.file(path).save(buf, {
    metadata: { contentType: mime, metadata: { firebaseStorageDownloadTokens: token } },
  })
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
  await db.collection(`tenants/${tenantId}/aiImageJobs`).add({
    kind: top ? 'tableTop' : 'table', by: uid, url, hint: clean(hint, 120), createdAt: FieldValue.serverTimestamp(),
  }).catch(() => {})
  // The meter is the source of truth for what is left, so this read-out cannot
  // drift from what the next call will actually allow. -1 means unlimited.
  const tableUsage = await readSpend(db, tenantId).catch(() => ({}))
  const tableLim = spendLimitsFor((await db.doc(`tenants/${tenantId}`).get().catch(() => null))?.data() || {}, 'tableImage')
  return {
    url,
    remaining: tableLim.month < 0 ? -1 : Math.max(0, tableLim.month - (Number(tableUsage.tableImage) || 0)),
    cap: tableLim.month,
  }
})

// ============ Diner AI ordering — photo + voice (guest-facing) ============
// Unauthenticated ON PURPOSE (createPayIntent precedent, line ~456): diners
// on /m/:slug carry no Firebase auth at all. What stands between this
// endpoint and the platform Gemini bill: server-side feature gates read from
// the tenant doc, a transactional monthly + per-minute quota, and hard
// payload caps. Anti-hallucination contract: the model only ever answers
// with INDICES into a server-built catalog; the server maps them back to
// real item ids, so a made-up dish can never become orderable.
//
// Hand-synced mirror of AI_ORDER_RANGE in src/lib/dishComposition.js (this
// package is CommonJS and cannot import the ESM contract; the inline drift
// scanner does not cover functions/). Same numbers, same names — change
// BOTH sides together. photoMaxB64 6.5MB of base64 ≈ 4.5MB raw
// (= AI_ORDER_RANGE.photoMaxBytes after the client canvas downscale).
// The monthly and per-minute walls used to live here; they now come from
// functions/spend.js (PLAN_QUOTAS.dinerAi and BURST_PER_MINUTE.dinerAi, which
// keeps the historic 20/min). Only the payload and catalogue limits are still
// this function's own business.
const DINER_AI = {
  photoMaxB64: 6.5 * 1024 * 1024,
  audioMaxB64: 2.5 * 1024 * 1024,
  catalogMax: 200,   // menu entries offered to the model
}

// The monthly + per-minute quota now comes from the shared meter (channel
// 'dinerAi'), which enforces the same three walls transactionally and, unlike
// the bespoke counter this replaces, is plan-aware, toppable-up and visible in
// the console. tenant.dinerAiMonthly still wins where it is set — limitsFor
// reads it through the spendCaps precedence, and an explicit 0 still DISABLES
// the feature outright.
//
// The guest is anonymous here, so the refusal must read as something a diner
// understands rather than a quota code.
async function takeDinerAiCredit(db, tenantId) {
  const r = await takeSpend(db, tenantId, 'dinerAi', 1)
  if (r.granted >= 1 || r.reason === 'error-open') return
  throw new HttpsError('resource-exhausted', {
    burst: 'المساعد مشغول الآن — أعد المحاولة بعد لحظات.',
    platformBurst: 'المساعد مشغول الآن — أعد المحاولة بعد لحظات.',
    daily: 'بلغ المساعد حدّه اليومي في هذا المطعم — جرّب غداً أو اطلب من النادل.',
    killed: 'المساعد متوقف مؤقتاً.',
    disabled: 'المساعد غير مفعّل في هذا المطعم.',
    suspended: 'هذا المطعم غير نشط حالياً.',
  }[r.reason] || 'اكتمل رصيد المساعد في هذا المطعم لهذا الشهر — يمكنك الطلب يدوياً من المنيو.')
}

// Request: { tenantId, kind: 'photo'|'audio', inlineData: { mimeType, data },
// lang } — `mode`/`media` accepted as aliases so neither client-wrapper
// naming splits the contract. Response: { lines: [{ id, qty, variantKey,
// note, confidence?, why? }], reply, transcript?, language?, unmatched?,
// matches? } — ids are real catalog ids; clients re-validate against their
// own item list before adding.
const dinerOrderAi = onCall({ timeoutSeconds: 60, memory: '512MiB' }, async (request) => {
  const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY
  if (!key) {
    throw new HttpsError('failed-precondition', 'GEMINI_API_KEY مفقود في functions/.env — أضِفه ثم أعد نشر الدوال.')
  }
  const data = request.data || {}
  const tenantId = data.tenantId
  const kind = data.kind || data.mode
  const inline = data.inlineData || data.media
  const lang = data.lang === 'en' ? 'en' : 'ar'
  if (!tenantId || !['photo', 'audio'].includes(kind) || !inline || !inline.data || !inline.mimeType) {
    throw new HttpsError('invalid-argument', 'tenantId + kind + inlineData{mimeType,data} required')
  }
  const maxB64 = kind === 'photo' ? DINER_AI.photoMaxB64 : DINER_AI.audioMaxB64
  if (String(inline.data).length > maxB64) throw new HttpsError('invalid-argument', 'media too large')

  const db = getFirestore()
  const tSnap = await db.doc(`tenants/${tenantId}`).get()
  if (!tSnap.exists) throw new HttpsError('not-found', 'tenant')
  const td = tSnap.data() || {}
  // Server-side feature gates — the client toggle alone must never open the
  // wallet. photo follows the experiences-matrix default-ON convention
  // (!== false); audio AI is opt-in default OFF (=== true), per the contract.
  if (kind === 'photo' && td.photoOrderEnabled === false) throw new HttpsError('permission-denied', 'disabled')
  if (kind === 'audio' && td.voiceAiEnabled !== true) throw new HttpsError('permission-denied', 'disabled')
  await takeDinerAiCredit(db, tenantId)

  // Catalog straight from Firestore — never trusts client-supplied names.
  // Same conventions the menu client itself uses (MenuView allActive +
  // soldOut): active !== false = not archived, available === false = sold
  // out, trackStock && stock <= 0 = out of stock. Filtering here is what
  // keeps a sold-out item from becoming addable by voice.
  const itemsSnap = await db.collection(`tenants/${tenantId}/items`).get()
  const catalog = itemsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((i) => (i.nameAr || i.nameEn)
      && i.active !== false
      && i.available !== false
      && !(i.trackStock && (i.stock || 0) <= 0))
    .slice(0, DINER_AI.catalogMax)
  if (!catalog.length) throw new HttpsError('failed-precondition', 'empty menu')

  // INDEX-ONLY numbered list: the model returns row numbers (and variant
  // indices), never free text we would have to fuzzy-match back.
  const catalogLines = catalog.map((i, n) => {
    const vs = (i.variants || [])
      .map((v, k) => (v && (v.nameAr || v.nameEn) ? `${k}:${String(v.nameAr || v.nameEn).slice(0, 30)}` : null))
      .filter(Boolean).join(', ')
    return `${n}. ${String(i.nameAr || '').slice(0, 60)}${i.nameEn ? ` / ${String(i.nameEn).slice(0, 60)}` : ''}${vs ? ` | sizes ${vs}` : ''}`
  }).join('\n')

  const venueName = String(td.name || '').replace(/[\r\n"]+/g, ' ').slice(0, 60)
  const replyLang = lang === 'en' ? 'English' : 'Arabic'
  const prompt = kind === 'audio'
    ? [
        `You are the ordering assistant for the restaurant "${venueName}".`,
        'The attached audio is a guest ordering, possibly in ANY language or ANY Arabic dialect (Gulf, Najdi, Hijazi, Egyptian, Levantine, Maghrebi, Sudanese) or English, Urdu, Hindi, Tagalog, French, etc.',
        'STEP 1: transcribe the audio faithfully. STEP 2: map every requested dish or drink to the MENU below, choosing entries by INDEX ONLY.',
        'MENU:\n' + catalogLines,
        'Rules: never invent an index; one line per distinct requested item; qty per line (default 1); variantIndex only when the guest clearly names that size; anything you could not map goes into "unmatched".',
        `Return STRICT JSON only: {"transcript":"...","language":"<bcp47-or-dialect>","lines":[{"index":0,"qty":2,"variantIndex":1,"note":""}],"unmatched":["..."],"reply":"<one short ${replyLang} sentence confirming the order, Latin digits only, no emojis>"}`,
      ].join('\n')
    : [
        `You identify food and drinks for the restaurant "${venueName}".`,
        'Look at the attached photo, identify the dish or drink, then pick up to 4 closest MENU entries by INDEX ONLY, best match first. If nothing plausibly matches return an empty array — never force a match.',
        'MENU:\n' + catalogLines,
        `Return STRICT JSON only: {"lines":[{"index":0,"qty":1,"confidence":85,"why":"<short ${replyLang}, Latin digits, no emojis>"}],"reply":"<one short ${replyLang} sentence>"}`,
      ].join('\n')

  // Same Gemini fetch pattern as generateTableImage (key in query, plain
  // fetch); gemini-2.5-flash is the live model geminiProxy uses (trap 8).
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`
  const callModel = (mime) => fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: inline.data } }, { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } },
    }),
  })
  let res = await callModel(inline.mimeType)
  // Some serving stacks 400 on the audio/webm label while accepting the very
  // same opus payload relabeled audio/ogg — one retry, audio only.
  if (!res.ok && res.status === 400 && kind === 'audio' && /webm/i.test(String(inline.mimeType))) {
    res = await callModel('audio/ogg')
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('dinerOrderAi provider error', { tenantId, kind, status: res.status, body: String(errText).slice(0, 300) })
    throw new HttpsError('internal', 'ai: ' + res.status)
  }
  const body = await res.json().catch(() => null)
  const rawText = (((body && body.candidates && body.candidates[0] && body.candidates[0].content
    && body.candidates[0].content.parts) || []).map((p) => p.text).filter(Boolean).join(''))
  let obj = {}
  try { obj = JSON.parse(rawText) } catch (_) {
    const m = /\{[\s\S]*\}/.exec(rawText || '')
    if (m) { try { obj = JSON.parse(m[0]) } catch (_) { obj = {} } }
  }

  // Map indices back to real ids. Out-of-range / non-integer indices are
  // dropped here and can never become orderable. qty clamp mirrors
  // AI_ORDER_RANGE.qty (1..20).
  const pickCat = (n) => (Number.isInteger(n) && n >= 0 && n < catalog.length ? catalog[n] : null)
  const rawLines = Array.isArray(obj.lines) ? obj.lines
    : (Array.isArray(obj.items) ? obj.items : (Array.isArray(obj.matches) ? obj.matches : []))
  const seen = new Set()
  const lines = rawLines.map((l) => {
    const c = pickCat(Number(l && l.index))
    if (!c) return null
    if (kind === 'photo') {
      if (seen.has(c.id)) return null
      seen.add(c.id)
    }
    const v = (c.variants || [])[Number(l.variantIndex)]
    const out = {
      id: c.id,
      qty: Math.max(1, Math.min(20, Math.round(Number(l.qty) || 1))),
      variantKey: (v && v.key) || '',
      note: String(l.note || l.notes || '').slice(0, 120),
    }
    if (kind === 'photo') {
      out.confidence = Math.max(0, Math.min(100, Math.round(Number(l.confidence) || 0)))
      out.why = String(l.why || '').slice(0, 140)
    }
    return out
  }).filter(Boolean).slice(0, kind === 'photo' ? 4 : 10)

  const reply = String(obj.reply || '').slice(0, 200)
  if (kind === 'audio') {
    return {
      lines,
      transcript: String(obj.transcript || '').slice(0, 500),
      language: String(obj.language || '').slice(0, 24),
      unmatched: (Array.isArray(obj.unmatched) ? obj.unmatched : []).map((s) => String(s).slice(0, 60)).slice(0, 5),
      reply,
    }
  }
  // photo: `matches` kept as an alias carrying confidence/why for the
  // PhotoOrder results UI, same ids as `lines`.
  return {
    lines,
    matches: lines.map((l) => ({ id: l.id, confidence: l.confidence || 0, why: l.why || '' })),
    reply,
  }
})

module.exports = {
  // pure + exported so the anti-underpay guard is TESTABLE — the version that
  // shipped broken was untestable inline code inside a Firestore-bound function
  orderLinesSum,
  orderTotalIsSane,
  generateMonthlyInvoices,
  setPlatformRole,
  startPlanSubscription,
  imageTo3d,
  generateTableImage,
  dinerOrderAi,
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
