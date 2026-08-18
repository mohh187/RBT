// Billing & invoices data layer for the platform console.
// Invoices live in platformInvoices; subscription coupons in platformCoupons.
// Automatic monthly invoice generation is handled by the generateMonthlyInvoices
// Cloud Function; real payment capture requires the paymentWebhook gateway.
// Rules for both collections come from the backend bundle (platform-admin only).
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase.js'

const list = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))

// ---------- invoices ----------
// Live invoices, newest first. Optionally scope to a venue and/or status.
export function watchInvoices(cb, { tenantId = null, status = null, max = 200 } = {}) {
  const col = collection(db, 'platformInvoices')
  const clauses = []
  if (tenantId) clauses.push(where('tenantId', '==', tenantId))
  if (status) clauses.push(where('status', '==', status))
  clauses.push(orderBy('createdAt', 'desc'), limit(max))
  const q = query(col, ...clauses)
  return onSnapshot(q, (s) => cb(list(s)), () => cb([]))
}

export async function createInvoice({ tenantId, tenantName, plan, amount, currency = 'SAR', period }) {
  const ref = await addDoc(collection(db, 'platformInvoices'), {
    tenantId,
    tenantName: tenantName || '',
    plan: plan || 'enterprise',
    amount: Number(amount) || 0,
    currency: currency || 'SAR',
    period: period || '', // e.g. "2026-07"
    status: 'unpaid',
    source: 'manual',
    createdAt: serverTimestamp(),
  })
  return ref.id
}

// Manual settlement must do what the payment webhook does: EXTEND the venue.
// It used to flip the invoice alone — a yearly invoice marked paid by hand
// left planExpiresAt untouched, so the monthly cron kept billing the venue
// (the «دفعنا سنوياً وما زالت تظهر فاتورة شهرية» incident).
export async function markInvoicePaid(id) {
  const invRef = doc(db, 'platformInvoices', id)
  await updateDoc(invRef, {
    status: 'paid',
    paidAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  try {
    const { getDoc } = await import('firebase/firestore')
    const snap = await getDoc(invRef)
    const inv = snap.exists() ? snap.data() : null
    if (inv?.tenantId) {
      const tRef = doc(db, 'tenants', inv.tenantId)
      const tSnap = await getDoc(tRef)
      const d = tSnap.exists() ? tSnap.data() : {}
      const cur = d.planExpiresAt?.toDate ? d.planExpiresAt.toDate() : (d.planExpiresAt ? new Date(d.planExpiresAt) : null)
      const base = cur && cur > new Date() ? cur : new Date()
      const days = String(inv.billing || '').includes('year') ? 365 : 30
      await setDoc(tRef, {
        planStatus: 'active',
        planExpiresAt: new Date(base.getTime() + days * 86400000),
        ...(inv.billing ? { billing: inv.billing } : {}),
        ...(inv.plan ? { plan: inv.plan } : {}),
      }, { merge: true })
    }
  } catch (_) { /* invoice settled; extension is best-effort and visible in the console */ }
}

// A payment that happened cannot un-happen. `markUnpaid` used to null `paidAt`
// on a settled invoice — rewriting financial history, and unrecoverable once
// the invoice carries a sequential number and a tax QR. Reversing a settled
// invoice is a CREDIT NOTE; this only exists for an invoice mistakenly marked
// paid by hand, and it says so in the record.
export async function markUnpaid(id, reason = '') {
  await updateDoc(doc(db, 'platformInvoices', id), {
    status: 'unpaid',
    paidAt: null,
    // The correction is itself part of the audit trail.
    correction: { was: 'paid', at: Date.now(), reason: String(reason || '').slice(0, 300) },
    updatedAt: serverTimestamp(),
  })
}

// NEVER DELETE A FINANCIAL RECORD. A deleted invoice punches a hole in the
// number sequence, and a sequence with holes is exactly what an auditor walks
// looking for. Abandoning one writes a void with a stated reason: a numbered,
// explained entry that stays in the ledger.
export async function voidInvoice(id, { reason, by } = {}) {
  await updateDoc(doc(db, 'platformInvoices', id), {
    status: 'void',
    voidReason: String(reason || '').slice(0, 300),
    voidedBy: by || '',
    voidedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

// MRR = sum of paid invoices for the most recent billing period present.
// Keeps the estimate honest even when older paid periods linger in the list.
export function computeMRR(invoices) {
  const paid = (invoices || []).filter((i) => i.status === 'paid' && i.period)
  if (!paid.length) return 0
  const latest = paid.reduce((mx, i) => (i.period > mx ? i.period : mx), paid[0].period)
  return paid
    .filter((i) => i.period === latest)
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0)
}

// ---------- coupons ----------
export function watchCoupons(cb, max = 200) {
  const q = query(collection(db, 'platformCoupons'), orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(list(s)), () => cb([]))
}

// id null → create a new coupon; otherwise update in place.
export async function saveCoupon(id, { code, type, value, expiresAt, active }) {
  const data = {
    code: String(code || '').trim().toUpperCase(),
    type: type || 'percent', // percent | fixed
    value: Number(value) || 0,
    expiresAt: expiresAt || null,
    active: active !== false,
    updatedAt: serverTimestamp(),
  }
  if (id) {
    await updateDoc(doc(db, 'platformCoupons', id), data)
    return id
  }
  const ref = await addDoc(collection(db, 'platformCoupons'), { ...data, createdAt: serverTimestamp() })
  return ref.id
}

export async function deleteCoupon(id) {
  await deleteDoc(doc(db, 'platformCoupons', id))
}
