// ============ Invoicing: persisted, numbered receipts for every payment state ============
// A receipt doc is written under tenants/{tid}/receipts/{id} whenever an order /
// ticket / booking is PAID (any method: cash, card, or online). It carries a
// venue-sequential number, a VAT breakdown, and — for a VAT-registered venue — a
// ZATCA Phase-1 simplified tax-invoice QR. It is the single customer-facing
// invoice artifact: viewable at /invoice/:tid/:id and linked over WhatsApp.
// Generation is idempotent (guarded by order.receiptId) and server-authoritative.
const { onDocumentUpdated } = require('firebase-functions/v2/firestore')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { sendWhatsAppTemplate, sendWhatsAppText, sendEmail, emailShell, esc, waCredsFor } = require('./messaging')

// ---- ZATCA TLV (Phase-1 simplified), mirrors src/lib/print.js ----
function tlv(tag, value) {
  const val = Buffer.from(String(value), 'utf8')
  return Buffer.concat([Buffer.from([tag, val.length]), val])
}
function zatcaBase64({ seller, vatNo, ts, total, vat }) {
  return Buffer.concat([tlv(1, seller), tlv(2, vatNo), tlv(3, ts), tlv(4, total), tlv(5, vat)]).toString('base64')
}

// VAT is treated as INCLUSIVE (prices already contain it) — same rule as print.js.
function vatBreakdown(tenant, total) {
  const currency = tenant.currency || 'SAR'
  const vatEnabled = !!tenant.vatEnabled && currency === 'SAR'
  const vatRate = Number(tenant.vatRate ?? 15) || 15
  const t = Number(total) || 0
  const vat = vatEnabled ? Math.round((t - t / (1 + vatRate / 100)) * 100) / 100 : 0
  const subtotal = Math.round((t - vat) * 100) / 100
  return { currency, vatEnabled, vatRate: vatEnabled ? vatRate : 0, vat, subtotal, total: t, isTaxInvoice: vatEnabled && !!tenant.vatNumber }
}

// Next venue-sequential receipt number (transactional counter).
async function nextReceiptNo(db, tid) {
  const ref = db.doc(`tenants/${tid}/meta/counters`)
  let n = 1
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref)
    n = ((s.exists && Number(s.data().receiptSeq)) || 0) + 1
    tx.set(ref, { receiptSeq: n }, { merge: true })
  })
  return n
}

function sellerOf(tenant) {
  return { name: tenant.name || '', vatNumber: tenant.vatNumber || '', phone: tenant.phone || '' }
}
function zatcaFor(bd, tenant, whenMs) {
  if (!bd.isTaxInvoice) return null
  const ts = new Date(whenMs || Date.now()).toISOString()
  return zatcaBase64({ seller: tenant.name || 'rbt360', vatNo: tenant.vatNumber, ts, total: bd.total.toFixed(2), vat: bd.vat.toFixed(2) })
}

// Write a receipt for a PAID order. Idempotent + race-safe: onOrderPaid fires on
// BOTH status→'paid' and paidOnline→true, so the guard, the number allocation,
// the receipt write, and the order.receiptId write-back all happen in ONE
// transaction — two near-simultaneous paid-signals can't mint two receipts.
async function receiptForOrder(db, tid, orderId, order) {
  if (order.receiptId) return null
  const tSnap = await db.doc(`tenants/${tid}`).get().catch(() => null)
  const tenant = (tSnap && tSnap.exists) ? tSnap.data() : {}
  const bd = vatBreakdown(tenant, order.total)
  const lines = (order.items || []).map((l) => ({
    name: l.nameAr || l.nameEn || '', qty: Number(l.qty) || 1, total: Number(l.lineTotal) || 0,
  }))
  const zatca = zatcaFor(bd, tenant, Date.now())
  const oRef = db.doc(`tenants/${tid}/orders/${orderId}`)
  const cRef = db.doc(`tenants/${tid}/meta/counters`)
  const rRef = db.collection(`tenants/${tid}/receipts`).doc()
  let no = 0
  let ok = false
  await db.runTransaction(async (tx) => {
    const oSnap = await tx.get(oRef)
    if (!oSnap.exists || oSnap.data().receiptId) return // already invoiced — atomic guard
    const cSnap = await tx.get(cRef)
    no = ((cSnap.exists && Number(cSnap.data().receiptSeq)) || 0) + 1
    tx.set(cRef, { receiptSeq: no }, { merge: true })
    tx.set(rRef, {
      no, kind: 'order', refId: orderId, status: order.status === 'refunded' ? 'refunded' : 'paid',
      buyerName: order.customerName || '', buyerPhone: order.customerPhone || '',
      seller: sellerOf(tenant), currency: bd.currency, code: order.code || '', orderType: order.orderType || '',
      lines, subtotal: bd.subtotal, vat: bd.vat, vatRate: bd.vatRate, total: bd.total,
      isTaxInvoice: bd.isTaxInvoice, zatca,
      provider: order.paidOnline ? 'moyasar' : (order.paymentMethod || 'cash'), providerRef: order.paymentRef || '',
      paidAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(),
    })
    tx.set(oRef, { receiptId: rRef.id, receiptNo: no }, { merge: true })
    ok = true
  })
  if (!ok) return null
  return { id: rRef.id, no, tenant, total: bd.total, currency: bd.currency }
}

// Write a single-line receipt for a paid ticket / booking deposit (online only).
async function receiptForSimple(db, tid, { kind, refId, buyerName, buyerPhone, label, amount, providerRef }) {
  const tSnap = await db.doc(`tenants/${tid}`).get().catch(() => null)
  const tenant = (tSnap && tSnap.exists) ? tSnap.data() : {}
  const bd = vatBreakdown(tenant, amount)
  const no = await nextReceiptNo(db, tid)
  const whenMs = Date.now()
  const rRef = db.collection(`tenants/${tid}/receipts`).doc()
  await rRef.set({
    no, kind, refId, status: 'paid',
    buyerName: buyerName || '', buyerPhone: buyerPhone || '',
    seller: sellerOf(tenant), currency: bd.currency,
    lines: [{ name: label || '', qty: 1, total: bd.total }],
    subtotal: bd.subtotal, vat: bd.vat, vatRate: bd.vatRate, total: bd.total,
    isTaxInvoice: bd.isTaxInvoice, zatca: zatcaFor(bd, tenant, whenMs),
    provider: 'moyasar', providerRef: providerRef || '',
    paidAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(),
  })
  return { id: rRef.id, no, tenant, total: bd.total, currency: bd.currency }
}

// Deliver the customer their invoice link — WhatsApp + email (when known), sent in
// the VENUE's name (its own WA number if connected, branded email display name).
// Extra options (email, tid) are optional so older call sites keep working.
async function notifyReceipt(tenant, phone, { code, total, currency, link, email, tid }) {
  const ch = tenant.customerNotify || {}
  const venueName = tenant.name || ''
  const amount = Number(total).toFixed(2)
  const custom = (tenant.msgTemplates && tenant.msgTemplates.receipt) || ''
  const text = custom
    ? String(custom)
      .replace(/\{venue\}|\{المنشأة\}/g, venueName)
      .replace(/\{code\}|\{الطلب\}/g, code ? '#' + code : '')
      .replace(/\{total\}|\{المبلغ\}/g, amount)
      .replace(/\{link\}|\{الرابط\}/g, link)
    : `${venueName}\nتم استلام دفعتك للطلب ${code ? '#' + code : ''} بمبلغ ${amount} ${currency}.\nفاتورتك: ${link}`

  if (phone && ch.whatsapp !== false) {
    const creds = tid ? await waCredsFor(getFirestore(), tid) : null
    const tmpl = (creds && creds.templates && creds.templates.templateReceipt) || process.env.WA_TEMPLATE_RECEIPT
    if (tmpl) {
      await sendWhatsAppTemplate(phone, tmpl, tenant.locale || 'ar', [venueName, '#' + (code || ''), amount, link], creds).catch(() => {})
    } else {
      await sendWhatsAppText(phone, text, creds).catch(() => {})
    }
  }
  if (email && ch.email !== false) {
    await sendEmail({
      to: email, fromName: venueName, replyTo: tenant.contactEmail || undefined,
      subject: `${venueName} — فاتورتك ${code ? '#' + code : ''}`.replace(/[\r\n]+/g, ' '),
      html: emailShell(esc(venueName), `
        <p>تم استلام دفعتك${code ? ' للطلب <strong>#' + esc(code) + '</strong>' : ''} بمبلغ <strong>${esc(amount)} ${esc(currency)}</strong>.</p>
        <p><a href="${esc(link)}" style="color:#7c2d2d;font-weight:700">عرض الفاتورة الضريبية</a></p>`),
    }).catch(() => {})
  }
}

function invoiceLink(tid, id) {
  return (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') + `/invoice/${tid}/${id}`
}

// TRIGGER: generate the receipt the moment an order is PAID (cash close → status
// 'paid'; online → paidOnline true). Mark the receipt refunded on refund.
const onOrderPaid = onDocumentUpdated('tenants/{tid}/orders/{oid}', async (event) => {
  const before = event.data && event.data.before.data()
  const after = event.data && event.data.after.data()
  if (!before || !after) return
  const tid = event.params.tid
  const oid = event.params.oid
  const db = getFirestore()

  const becamePaid = (after.status === 'paid' && before.status !== 'paid') ||
                     (after.paidOnline === true && before.paidOnline !== true)
  const becameRefunded = after.status === 'refunded' && before.status !== 'refunded'

  if (becamePaid && !after.receiptId) {
    const r = await receiptForOrder(db, tid, oid, after).catch(() => null)
    if (r) await notifyReceipt(r.tenant, after.customerPhone, { code: after.code, total: r.total, currency: r.currency, link: invoiceLink(tid, r.id), email: after.customerEmail || '', tid })
  } else if (becameRefunded && after.receiptId) {
    await db.doc(`tenants/${tid}/receipts/${after.receiptId}`).set({
      status: 'refunded',
      refund: { amount: (after.refund && after.refund.amount) || 0, reason: (after.refund && after.refund.reason) || '', at: Date.now() },
    }, { merge: true }).catch(() => {})
  }
})

module.exports = {
  onOrderPaid,
  receiptForOrder,
  receiptForSimple,
  notifyReceipt,
  invoiceLink,
  nextReceiptNo,
}
