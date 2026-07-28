// ==================== QUOTATIONS ====================
// A quotation for one chosen plan, showing the original price struck through
// and the launch price beside it, convertible to a real invoice on payment.
//
// TWO DESIGN POINTS WORTH THE WORDS:
//
// 1. THE FEATURES AND TERMS ARE SNAPSHOTTED, NOT REFERENCED. A quote sitting
//    in a customer's inbox must say tomorrow what it said today. If it read
//    platformConfig/plans live, editing the catalogue would silently rewrite
//    an offer someone is deciding on.
//
// 2. THE PUBLIC VIEW IS A CALLABLE, NOT A READ RULE. A quote carries the
//    prospect's VAT number AND a negotiated price. A leaked negotiated price
//    is a commercial injury, and an unguessable document id is not a
//    permission model. getPublicQuote compares a token and returns a redacted
//    payload; the collection itself stays closed to everyone but the console.
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const nodeCrypto = require('crypto')
const { sellerBlock } = require('./platformSeller')
const { plansConfig, promoOf, yearlyAmount } = require('./platformPricing')
const { platformVatBreakdown, issueDocument, SERIES } = require('./platformInvoicing')

const RIYADH = { timeZone: 'Asia/Riyadh' }
const todayRiyadh = () => new Date().toLocaleDateString('en-CA', RIYADH)

const DEFAULT_TERMS_AR = [
  'الأسعار بالريال السعودي ولا تشمل ضريبة القيمة المضافة، وتُضاف بنسبة 15% كما هو مبيّن أعلاه.',
  'يبدأ الاشتراك من تاريخ السداد، ويشمل التهيئة والتدريب الأولي ودعماً فنياً طوال مدة الاشتراك.',
  'هذا العرض ساري حتى التاريخ المبيّن، وبعده تُطبَّق الأسعار المعتمدة وقتها.',
  'يشمل الاشتراك حدود استخدام شهرية لكل خدمة، ويمكن شراء رصيد إضافي عند الحاجة.',
]

async function financeCfg(db) {
  const s = await db.doc('platformConfig/finance').get().catch(() => null)
  return s && s.exists ? (s.data() || {}) : {}
}

// The end of the current calendar year, Riyadh — the natural default for a
// launch offer described as «حتى نهاية السنة».
function endOfYearMs() {
  const y = Number(todayRiyadh().slice(0, 4))
  return Date.parse(`${y}-12-31T23:59:59+03:00`)
}

// ------------------------------------------------------------ create
const createQuote = onCall(async (request) => {
  const db = getFirestore()
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign in')
  const adminSnap = await db.doc(`platformAdmins/${uid}`).get()
  if (!adminSnap.exists) throw new HttpsError('permission-denied', 'platform admins only')

  const d = request.data || {}
  const planId = d.planId
  const cfg = await plansConfig(db)
  if (!cfg.prices[planId]) throw new HttpsError('invalid-argument', 'unknown plan')

  const yearly = d.billing === 'yearly'
  const promo = promoOf(planId, cfg)
  // The price the customer pays. An explicit override is allowed (a negotiated
  // deal) but it is recorded as such, never silently blended into the list.
  const negotiated = Number(d.unitPrice)
  const monthly = Number.isFinite(negotiated) && negotiated >= 0 ? negotiated : cfg.prices[planId]
  const unitPrice = yearly ? yearlyAmount(monthly, cfg) : monthly
  const listMonthly = promo ? promo.listPrice : monthly
  const listPrice = yearly ? yearlyAmount(listMonthly, cfg) : listMonthly

  const planAr = { menu: 'منيو', ops: 'منيو + تشغيل', pro: 'احترافي', enterprise: 'متكامل' }[planId] || planId
  const lines = [{
    sku: `plan:${planId}`,
    descAr: `اشتراك منصة RBT360 — باقة «${planAr}» (${yearly ? 'سنوي' : 'شهري'})`,
    qty: 1, listPrice, unitPrice,
    discountLabelAr: promo ? promo.labelAr : (Number.isFinite(negotiated) ? 'سعر متفق عليه' : ''),
  }]
  const seller = sellerBlock(await financeCfg(db))
  const money = platformVatBreakdown(lines, { rate: seller.vatRate })

  const year = todayRiyadh().slice(0, 4)
  const counterRef = db.doc('platformCounters/seq')
  const ref = db.collection('platformQuotes').doc()
  const token = nodeCrypto.randomBytes(16).toString('hex')
  let out = null

  await db.runTransaction(async (tx) => {
    const cs = await tx.get(counterRef)
    const cur = cs.exists ? (cs.data() || {}) : {}
    const seq = (Number(cur.quote && cur.quote[year]) || 0) + 1
    tx.set(counterRef, { quote: { [year]: seq }, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    const no = `${SERIES.quote.prefix}-${year}-${String(seq).padStart(SERIES.quote.pad, '0')}`
    tx.set(ref, {
      schema: 1, no, seq, issueYear: Number(year), status: 'draft',
      tenantId: d.tenantId || null,
      buyer: {
        nameAr: d.buyerName || '', vatNumber: d.buyerVat || '', crNumber: d.buyerCr || '',
        contactName: d.contactName || '', email: d.email || '', phone: d.phone || '', cityAr: d.city || '',
      },
      seller,
      planId, billing: yearly ? 'yearly' : 'monthly',
      // SNAPSHOTS — see the header note.
      features: Array.isArray(d.features) && d.features.length ? d.features : (cfg.features[planId] || []),
      termsAr: Array.isArray(d.termsAr) && d.termsAr.length ? d.termsAr : DEFAULT_TERMS_AR,
      promo: promo || null,
      lines: money.lines,
      subtotal: money.subtotal, discountTotal: money.discountTotal,
      vatRate: money.vatRate, vat: money.vat, total: money.total, currency: 'SAR',
      issuedAt: FieldValue.serverTimestamp(),
      validUntil: Number(d.validUntil) || (promo && promo.validUntil) || endOfYearMs(),
      notesAr: String(d.notesAr || '').slice(0, 1000),
      publicToken: token,
      convertedInvoiceId: null,
      createdBy: uid, createdByEmail: (request.auth.token && request.auth.token.email) || '',
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
    out = { id: ref.id, no, token, total: money.total }
  })
  return out
})

// ------------------------------------------------------------- public view
// Constant-time token comparison: a length-leaking or early-exit compare on a
// secret is a real (if slow) oracle, and there is no reason to accept one.
function tokenMatches(a, b) {
  const x = Buffer.from(String(a || ''))
  const y = Buffer.from(String(b || ''))
  if (x.length !== y.length) return false
  return nodeCrypto.timingSafeEqual(x, y)
}

const getPublicQuote = onCall(async (request) => {
  const { id, token } = request.data || {}
  if (!id || !token) throw new HttpsError('invalid-argument', 'id + token required')
  const db = getFirestore()
  const snap = await db.doc(`platformQuotes/${id}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'العرض غير موجود')
  const q = snap.data()
  if (!tokenMatches(q.publicToken, token)) throw new HttpsError('permission-denied', 'رابط غير صالح')

  const expired = q.validUntil && Date.now() > Number(q.validUntil)
  // Mark it seen once, so the console knows the customer opened it.
  if (q.status === 'sent' && !q.viewedAt) {
    await snap.ref.set({ viewedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {})
  }
  // Redacted: no publicToken, no internal ids, no createdBy.
  return {
    no: q.no, status: expired ? 'expired' : q.status,
    seller: q.seller, buyer: q.buyer,
    planId: q.planId, billing: q.billing, features: q.features || [], termsAr: q.termsAr || [],
    promo: q.promo || null, lines: q.lines || [],
    subtotal: q.subtotal, discountTotal: q.discountTotal, vatRate: q.vatRate, vat: q.vat, total: q.total,
    currency: q.currency || 'SAR',
    issuedAtMs: q.issuedAt && q.issuedAt.toMillis ? q.issuedAt.toMillis() : null,
    validUntil: q.validUntil || null,
    notesAr: q.notesAr || '',
    expired,
  }
})

// --------------------------------------------------------------- accept
// Converts to a real invoice through the EXISTING payment pipeline — no new
// payment code. The amount is re-derived from the quote document, never from
// the request, so a tampered client can only ever accept what was offered.
const acceptQuote = onCall(async (request) => {
  const { id, token } = request.data || {}
  if (!id || !token) throw new HttpsError('invalid-argument', 'id + token required')
  const db = getFirestore()
  const snap = await db.doc(`platformQuotes/${id}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'العرض غير موجود')
  const q = snap.data()
  if (!tokenMatches(q.publicToken, token)) throw new HttpsError('permission-denied', 'رابط غير صالح')
  if (q.convertedInvoiceId) return { invoiceId: q.convertedInvoiceId, already: true }
  if (q.validUntil && Date.now() > Number(q.validUntil)) throw new HttpsError('failed-precondition', 'انتهت صلاحية هذا العرض — اطلب عرضاً محدّثاً')
  if (!q.tenantId) throw new HttpsError('failed-precondition', 'العرض غير مرتبط بمنشأة بعد — تواصل معنا لإتمام التسجيل')

  const inv = await issueDocument(db, {
    series: 'invoice', docType: 'taxInvoice', kind: 'subscription',
    tenantId: q.tenantId, tenantName: q.buyer && q.buyer.nameAr,
    buyer: q.buyer,
    // Rebuilt from the quote's own stored lines.
    lines: (q.lines || []).map((l) => ({
      sku: l.sku, descAr: l.descAr, qty: l.qty,
      listPrice: l.listPrice, unitPrice: l.unitPrice, discountLabelAr: l.discountLabelAr,
    })),
    planId: q.planId, billing: q.billing,
    period: todayRiyadh().slice(0, 7),
    status: 'unpaid', source: 'quote', quoteId: id,
    financeCfg: await financeCfg(db),
  })

  await snap.ref.set({
    status: 'accepted', acceptedAt: FieldValue.serverTimestamp(),
    convertedInvoiceId: inv.id, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { invoiceId: inv.id, no: inv.no, total: inv.total }
})

// -------------------------------------------------------------- expire
const expireQuotes = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'Asia/Riyadh', timeoutSeconds: 300 },
  async () => {
    const db = getFirestore()
    const snap = await db.collection('platformQuotes')
      .where('status', 'in', ['draft', 'sent']).get().catch(() => null)
    if (!snap || snap.empty) return
    const now = Date.now()
    for (const d of snap.docs) {
      const v = Number(d.data().validUntil) || 0
      if (v && now > v) await d.ref.set({ status: 'expired', updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {})
    }
  },
)

module.exports = { createQuote, getPublicQuote, acceptQuote, expireQuotes, DEFAULT_TERMS_AR }
