// ============ PLATFORM DOCUMENTS: tax invoices, credit notes, quotations ============
//
// Three rules shape this file, and each exists because its opposite is a
// specific, nameable failure:
//
// 1. THE NUMBER IS ALLOCATED INSIDE THE TRANSACTION THAT CREATES THE DOCUMENT.
//    functions/invoicing.js does this correctly for venue receipts at :71-88
//    and INCORRECTLY at :98, where receiptForSimple allocates a number and then
//    writes outside the transaction — which can leak a number that no document
//    ever claims. Copying that pattern here would put a hole in a legal
//    sequence.
//
// 2. NOTHING IS EVER DELETED. Abandoning a document writes status:'void' with
//    a reason and an actor. A void number is an explained entry in the
//    sequence and survives an audit; a deleted one is a hole, and a hole is
//    exactly what an auditor walks the sequence looking for.
//
// 3. VAT IS EXCLUSIVE HERE, unlike vatBreakdown() in functions/invoicing.js.
//    That function is right for a menu price a diner pays: the number on the
//    board is the number they hand over, so VAT is inside it. Platform B2B
//    prices are the opposite — 899 + 134.85 = 1,033.85. Two reasons: a B2B
//    buyer reclaims input VAT, so quoting inclusive makes us 15% dearer than a
//    competitor quoting exclusive for identical cash to us; and if 899 were
//    inclusive our real net is 781.74, which would overstate every margin in
//    PROFITABILITY.md by about 13%.
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { sellerBlock } = require('./platformSeller')
const { zatcaBase64 } = require('./invoicing')
const nodeCrypto = require('crypto')

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const RIYADH = { timeZone: 'Asia/Riyadh' }
const todayRiyadh = () => new Date().toLocaleDateString('en-CA', RIYADH)

// ------------------------------------------------------------- numbering
const SERIES = {
  invoice: { prefix: 'INV', pad: 6 },
  credit: { prefix: 'CRN', pad: 6 },
  quote: { prefix: 'QT', pad: 4 },
  // Historic platformInvoices rows carried no number, no seller and no QR.
  // They are NOT retroactively compliant tax invoices, so they get their own
  // series — which is what lets INV- run gap-free from 000001, and that is the
  // series an auditor actually walks.
  legacy: { prefix: 'LEG', pad: 4 },
}

// Allocate the next number. MUST be called inside a transaction that also
// writes the document — see rule 1 above.
function nextNo(tx, counterRef, counterSnap, series, year) {
  const cfg = SERIES[series]
  const d = counterSnap.exists ? (counterSnap.data() || {}) : {}
  const seq = (Number(d[series] && d[series][year]) || 0) + 1
  tx.set(counterRef, { [series]: { [year]: seq }, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return { no: `${cfg.prefix}-${year}-${String(seq).padStart(cfg.pad, '0')}`, seq }
}

// ------------------------------------------------------------------- VAT
// Lines carry NET (ex-VAT) unit prices. Returns the money block.
function platformVatBreakdown(lines, { rate = 15 } = {}) {
  const out = { lines: [], subtotal: 0, discountTotal: 0, vat: 0, total: 0, vatRate: rate }
  for (const l of lines || []) {
    const qty = Number(l.qty) || 1
    const listPrice = Number(l.listPrice) || Number(l.unitPrice) || 0
    const unitPrice = Number(l.unitPrice) || 0
    const net = round2(unitPrice * qty)
    const discount = round2(Math.max(0, (listPrice - unitPrice) * qty))
    const vat = round2(net * (rate / 100))
    out.lines.push({
      sku: l.sku || '', descAr: l.descAr || '', descEn: l.descEn || '',
      qty, listPrice, unitPrice, discount, discountLabelAr: l.discountLabelAr || '',
      net, vatRate: rate, vat, total: round2(net + vat),
    })
    out.subtotal = round2(out.subtotal + net)
    out.discountTotal = round2(out.discountTotal + discount)
    out.vat = round2(out.vat + vat)
  }
  out.total = round2(out.subtotal + out.vat)
  return out
}

// ----------------------------------------------------------------- ZATCA
// Phase 1 today: the same TLV encoder the venue receipts use (tags 1-5).
//
// `uuid` and `icv` are populated FROM DAY ONE even though Phase 1 does not
// need them. They cost nothing now and they are precisely the two fields that
// cannot be backfilled later: icv must be a gapless counter across every
// invoice from the very first one, and the Phase-2 PIH chain links each
// invoice's hash to its predecessor's. Leaving `pih`/`hash` as null keeps a
// home for that chain, so switching on clearance becomes a code change rather
// than a data reconstruction.
function zatcaFor(doc, seller) {
  return {
    phase: 1,
    qr: zatcaBase64({
      seller: seller.legalNameAr,
      vatNo: seller.vatNumber,
      ts: new Date(doc.issuedAtMs || Date.now()).toISOString(),
      total: doc.total.toFixed(2),
      vat: doc.vat.toFixed(2),
    }),
    uuid: nodeCrypto.randomUUID(),
    icv: doc.seq,
    pih: null,
    hash: null,
    cleared: false,
    clearedAt: null,
    error: null,
  }
}

// ------------------------------------------------------------ issue a doc
// One entry point for every platform document. `series` decides the number
// series; `kind` is what was sold.
//
// docId lets a caller pin a deterministic id (the monthly cron uses
// `sub_{tid}_{period}` so a scheduler retry collides instead of double-billing).
async function issueDocument(db, {
  series = 'invoice', docType = 'taxInvoice', kind, docId,
  tenantId, tenantName, buyer, lines, planId = null, period = null,
  billing = 'monthly', periodFrom = null, periodTo = null,
  status = 'unpaid', dueInDays = 14, source = 'console', quoteId = null,
  creditNoteFor = null, financeCfg = null,
}) {
  const seller = sellerBlock(financeCfg)
  const money = platformVatBreakdown(lines, { rate: seller.vatRate })
  const year = todayRiyadh().slice(0, 4)
  const counterRef = db.doc('platformCounters/seq')
  const ref = docId ? db.doc(`platformInvoices/${docId}`) : db.collection('platformInvoices').doc()

  let created = null
  await db.runTransaction(async (tx) => {
    // Read BOTH before any write — Firestore transactions require it.
    const [counterSnap, existing] = await Promise.all([tx.get(counterRef), tx.get(ref)])
    if (existing.exists) { created = { id: ref.id, duplicate: true }; return }

    const { no, seq } = nextNo(tx, counterRef, counterSnap, series, year)
    const issuedAtMs = Date.now()
    const doc = {
      schema: 2,
      no, seq, series, issueYear: Number(year), docType,
      taxCompliant: series !== 'legacy',
      tenantId, tenantName: tenantName || '',
      buyer: buyer || {},
      seller,
      kind, planId, plan: planId, period,
      periodFrom, periodTo, billing,
      lines: money.lines,
      currency: 'SAR', vatMode: 'exclusive',
      subtotal: money.subtotal, discountTotal: money.discountTotal,
      vatRate: money.vatRate, vat: money.vat, total: money.total,
      // `amount` stays an alias of the VAT-INCLUSIVE total on purpose:
      // deriveIntentAmount and settleInvoiceFromPayment both bind the Moyasar
      // charge to invoice.amount, and charging the inclusive total is correct.
      amount: money.total,
      status,
      issuedAt: FieldValue.serverTimestamp(),
      issuedAtMs,
      dueAt: issuedAtMs + dueInDays * 86400000,
      paidAt: null, voidedAt: null, voidReason: null, voidedBy: null,
      amountPaid: null, amountPaidSar: null,
      provider: null, providerRef: null, payIntentId: null,
      gatewayFee: null, gatewayFeeSource: null,
      quoteId, creditNoteFor, creditNotes: [],
      source,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    doc.zatca = zatcaFor({ ...doc, issuedAtMs }, seller)
    tx.set(ref, doc)
    created = { id: ref.id, no, seq, total: money.total }
  })
  return created
}

// Void — never delete. See rule 2.
async function voidDocument(db, id, { reason, by }) {
  await db.doc(`platformInvoices/${id}`).set({
    status: 'void',
    voidReason: String(reason || '').slice(0, 300),
    voidedBy: by || '',
    voidedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

// Reverse a SETTLED invoice properly: a credit note that references it, rather
// than editing the original — which is what markUnpaid used to do.
async function creditNote(db, invoiceId, { reason, by, financeCfg }) {
  const src = await db.doc(`platformInvoices/${invoiceId}`).get()
  if (!src.exists) throw new Error('invoice not found')
  const inv = src.data()
  const negLines = (inv.lines || []).map((l) => ({
    sku: l.sku, descAr: `إلغاء: ${l.descAr}`, qty: l.qty,
    listPrice: -Math.abs(l.listPrice), unitPrice: -Math.abs(l.unitPrice),
  }))
  const out = await issueDocument(db, {
    series: 'credit', docType: 'creditNote', kind: 'creditNote',
    tenantId: inv.tenantId, tenantName: inv.tenantName, buyer: inv.buyer,
    lines: negLines, planId: inv.planId, period: inv.period,
    status: 'issued', source: 'console', creditNoteFor: invoiceId, financeCfg,
  })
  await src.ref.set({
    creditNotes: FieldValue.arrayUnion(out.id),
    status: 'refunded',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  await db.collection('platformActivity').add({
    tenantId: inv.tenantId, tenantName: inv.tenantName || '', type: 'creditNote',
    severity: 'warn', title: `إشعار دائن ${out.no}`,
    body: `عن الفاتورة ${inv.no || invoiceId} بمبلغ ${inv.total || inv.amount}. السبب: ${reason || '—'} · بواسطة ${by || '—'}`,
    at: FieldValue.serverTimestamp(),
  }).catch(() => {})
  return out
}

// The audit the numbering exists for: walk a series and prove there is no
// missing integer. This is why `seq` is stored as a number beside `no`.
async function auditSequence(db, series, year) {
  const snap = await db.collection('platformInvoices')
    .where('series', '==', series).where('issueYear', '==', Number(year))
    .orderBy('seq').get()
  const seqs = snap.docs.map((d) => Number(d.data().seq)).filter(Number.isFinite)
  const gaps = []
  for (let i = 1; i <= (seqs[seqs.length - 1] || 0); i++) if (!seqs.includes(i)) gaps.push(i)
  return { series, year: Number(year), count: seqs.length, highest: seqs[seqs.length - 1] || 0, gaps, ok: gaps.length === 0 }
}

module.exports = { issueDocument, voidDocument, creditNote, auditSequence, platformVatBreakdown, round2, SERIES }
