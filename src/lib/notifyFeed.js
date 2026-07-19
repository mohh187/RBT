// Notification-center v2 feed builder: merges the venue's live "somebody needs
// you" sources (pending orders, waiter calls, open complaints, reservation
// requests and newly self-registered customers) into ONE sorted feed where every
// item carries `to` — the EXACT in-app destination — so both the bell dropdown
// and OS notifications land on the precise object, not just a page.
// Every listener has an error callback: a denied/failed source contributes an
// empty list instead of a stuck state (rules keep enforcing RBAC server-side).
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { orderNumber } from './format.js'

const ms = (ts) => ts?.toMillis?.() ?? (typeof ts === 'number' ? ts : 0)

// ---- per-tenant "last seen" marker (device-local) ----
const seenKey = (tid) => `notifyv2Seen_${tid}`
export function getLastSeen(tid) {
  try { return Number(localStorage.getItem(seenKey(tid))) || 0 } catch (_) { return 0 }
}
export function markSeen(tid, at = Date.now()) {
  try { localStorage.setItem(seenKey(tid), String(at)) } catch (_) { /* ignore */ }
}

const orderTypeLabel = (o) =>
  o.tableLabel || (o.orderType === 'curbside' ? 'استلام بالسيارة'
    : o.orderType === 'pickup' ? 'استلام'
    : o.orderType === 'delivery' ? 'توصيل'
    : 'داخل المقهى')

// buildNotifyFeed(db, tenantId, cb): subscribes to the last ~20 of each source
// and calls cb with the merged, newest-first feed:
//   [{ id, type, at, title, body, to }]
// Returns a single unsubscribe for all listeners.
export function buildNotifyFeed(db, tenantId, cb) {
  if (!db || !tenantId) { cb([]); return () => {} }
  const sub = (name) => collection(db, 'tenants', tenantId, name)
  const src = { order: [], call: [], complaint: [], reservation: [], customer: [] }

  const emit = () => {
    const all = [].concat(src.order, src.call, src.complaint, src.reservation, src.customer)
    cb(all.filter((i) => i.at > 0).sort((a, b) => b.at - a.at).slice(0, 60))
  }

  const unsubs = []
  const listen = (key, q, map) => {
    unsubs.push(onSnapshot(q,
      (s) => { src[key] = s.docs.map(map).filter(Boolean); emit() },
      () => { src[key] = []; emit() }, // permission/index error → source stays empty, feed keeps flowing
    ))
  }

  // New (pending) orders → the exact order on the cashier screen.
  // Mirrors the proven (status, createdAt) index of watchActiveOrders.
  listen('order',
    query(sub('orders'), where('status', '==', 'pending'), orderBy('createdAt', 'desc'), limit(20)),
    (d) => {
      const o = d.data()
      return { id: 'order_' + d.id, type: 'order', at: ms(o.createdAt), to: `/cashier?order=${d.id}`,
        title: `طلب جديد · ${orderNumber(o.code)}`, body: orderTypeLabel(o) }
    })

  // Waiter calls + curbside arrivals (tenants/{tid}/waiterCalls, status 'open').
  listen('call',
    query(sub('waiterCalls'), where('status', '==', 'open'), orderBy('createdAt', 'desc'), limit(20)),
    (d) => {
      const c = d.data()
      const arrived = c.reason === 'arrived'
      return { id: 'call_' + d.id, type: 'call', at: ms(c.createdAt), to: '/cashier',
        title: arrived ? 'وصل العميل' : 'نداء نادل',
        body: c.tableLabel || (c.orderCode ? `#${c.orderCode}` : '') }
    })

  // Open complaints → the exact complaint (Complaints.jsx already handles ?focus=).
  listen('complaint',
    query(sub('complaints'), orderBy('createdAt', 'desc'), limit(20)),
    (d) => {
      const c = d.data()
      if ((c.status || 'open') !== 'open') return null
      return { id: 'complaint_' + d.id, type: 'complaint', at: ms(c.createdAt), to: `/admin/complaints?focus=${d.id}`,
        title: `شكوى جديدة${c.orderCode ? ` · #${c.orderCode}` : ''}`, body: (c.message || '').slice(0, 80) }
    })

  // Reservation requests → the reservations screen (?id carried for future focus).
  listen('reservation',
    query(sub('reservations'), orderBy('createdAt', 'desc'), limit(20)),
    (d) => {
      const r = d.data()
      if (r.kind === 'table' || (r.status || 'requested') !== 'requested') return null
      return { id: 'resv_' + d.id, type: 'reservation', at: ms(r.createdAt), to: `/admin/reservations?id=${d.id}`,
        title: `حجز جديد${r.code ? ` · ${orderNumber(r.code)}` : ''}`,
        body: [r.name, r.partySize ? `${r.partySize} أشخاص` : ''].filter(Boolean).join(' · ') }
    })

  // NEW customers self-registering ("join the family"): registerCustomer() stamps
  // registeredAt (number) — ordering on it inherently selects self-registered docs.
  listen('customer',
    query(sub('customers'), orderBy('registeredAt', 'desc'), limit(20)),
    (d) => {
      const c = d.data()
      return { id: 'cust_' + d.id, type: 'customer', at: ms(c.registeredAt), to: `/admin/customers?id=${d.id}`,
        title: 'عميل جديد سجّل بياناته', body: [c.name, c.phone].filter(Boolean).join(' · ') }
    })

  return () => unsubs.forEach((u) => { try { u() } catch (_) { /* ignore */ } })
}
