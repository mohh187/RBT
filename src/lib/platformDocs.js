// Client access to platform documents: quotations, tax invoices, credit notes.
//
// Every WRITE goes through a callable — the collections are read-only to the
// client in firestore.rules. That is deliberate: a document number is a legal
// sequence, and a client that can write one can mint a duplicate.
import { collection, doc, getDoc, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from './firebase.js'

const call = (name) => (payload) => httpsCallable(functions, name)(payload || {}).then((r) => r.data)

// ------------------------------------------------------------- quotations
export const createQuote = call('createQuote')
export const acceptQuote = call('acceptQuote')
// Admin-side conversion, for a deal closed by phone rather than by the
// customer clicking. Accepts a quote with no venue yet.
export const convertQuoteToInvoice = call('convertQuoteToInvoice')
// Attach an already-issued document to a venue once their account exists.
export const linkDocumentTenant = call('linkDocumentTenant')

export function watchQuotes(cb, max = 100) {
  const q = query(collection(db, 'platformQuotes'), orderBy('createdAt', 'desc'), limit(max))
  // The error callback renders an empty list rather than leaving a spinner
  // running forever — the stuck-spinner failure this codebase already paid for.
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}

// The prospect-facing link. The token is what authorises the view, so it is
// part of the path — see getPublicQuote for why a bare id is not enough.
export function quoteUrl(q) {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/quote/${q.id}/${q.publicToken}`
}
export function invoiceUrl(id) {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/inv/${id}`
}

// -------------------------------------------------------------- invoices
export function watchPlatformDocs(cb, { max = 200 } = {}) {
  const q = query(collection(db, 'platformInvoices'), orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}

export async function getPlatformDoc(id) {
  const s = await getDoc(doc(db, 'platformInvoices', id))
  return s.exists() ? { id: s.id, ...s.data() } : null
}

// ------------------------------------------------------- sequence audit
// Walks a numbered series and reports any missing integer. This is the whole
// reason `seq` is stored as a number beside the formatted `no`, and the check
// an auditor would run by hand.
export function auditSequence(docs, series, year) {
  const rows = (docs || [])
    .filter((d) => d.series === series && Number(d.issueYear) === Number(year))
    .map((d) => Number(d.seq))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  if (!rows.length) return { series, year, count: 0, highest: 0, gaps: [], ok: true }
  const highest = rows[rows.length - 1]
  const present = new Set(rows)
  const gaps = []
  for (let i = 1; i <= highest; i++) if (!present.has(i)) gaps.push(i)
  return { series, year, count: rows.length, highest, gaps, ok: gaps.length === 0 }
}

export const DOC_STATUS_AR = {
  draft: 'مسودة', sent: 'مُرسَل', accepted: 'مقبول', declined: 'مرفوض',
  expired: 'منتهٍ', converted: 'تحوّل لفاتورة',
  unpaid: 'غير مدفوعة', pending: 'غير مدفوعة', paid: 'مدفوعة',
  void: 'ملغاة', refunded: 'مُرجَعة', issued: 'صادر',
}
export const DOC_STATUS_BADGE = {
  paid: 'badge-success', accepted: 'badge-success', converted: 'badge-success',
  unpaid: 'badge-warning', pending: 'badge-warning', sent: 'badge-info', draft: '',
  void: '', expired: '', declined: 'badge-danger', refunded: 'badge-danger',
}
