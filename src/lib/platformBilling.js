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

export async function markInvoicePaid(id) {
  await updateDoc(doc(db, 'platformInvoices', id), {
    status: 'paid',
    paidAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function markUnpaid(id) {
  await updateDoc(doc(db, 'platformInvoices', id), {
    status: 'unpaid',
    paidAt: null,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteInvoice(id) {
  await deleteDoc(doc(db, 'platformInvoices', id))
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
