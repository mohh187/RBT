// Advanced, role-aware notification feed. Aggregates EVERY meaningful event in a
// venue — new orders, waiter calls, complaints, announcements, leave requests &
// decisions, customer ratings, and the staffer's own lateness — into one live,
// sorted inbox with unread tracking + sound/system alerts. No backend needed:
// everything is derived from collections the user can already read, so it honours
// tenant isolation and RBAC. Used by <StaffBell/> on every staff & admin screen.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './auth.jsx'
import { useI18n } from './i18n.jsx'
import {
  watchActiveOrders, watchOpenWaiterCalls, watchComplaints, watchAnnouncements,
  watchLeaves, watchMyLeaves, watchAllReviews, watchMyAttendance, resolveWaiterCall,
  watchStatusLog, watchMyShifts, watchShiftSwaps,
} from './db.js'
import { CAP } from './permissions.js'
import { alertParty } from './notify.js'
import { orderNumber } from './format.js'

const ms = (ts) => ts?.toMillis?.() ?? (typeof ts === 'number' ? ts : 0)
// Kinds that should make a sound when they arrive (orders beep from the page itself).
const ALERT_KINDS = new Set(['announcement', 'waiter', 'complaint', 'leave', 'leaveDecision', 'rating', 'late', 'status', 'shift', 'swap'])
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export function useNotificationFeed(tenantId) {
  const { user, can, isManager, tenant } = useAuth()
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const uid = user?.uid
  const takesOrders = can(CAP.TAKE_ORDERS)

  const [orders, setOrders] = useState([])
  const [calls, setCalls] = useState([])
  const [complaints, setComplaints] = useState([])
  const [announcements, setAnnouncements] = useState([])
  const [leaves, setLeaves] = useState([])
  const [myLeaves, setMyLeaves] = useState([])
  const [reviews, setReviews] = useState([])
  const [punches, setPunches] = useState([])
  const [statusLog, setStatusLog] = useState([])
  const [myShifts, setMyShifts] = useState([])
  const [swaps, setSwaps] = useState([])

  // role-gated subscriptions
  useEffect(() => { if (!tenantId || !takesOrders) return; return watchActiveOrders(tenantId, (l) => setOrders(l || [])) }, [tenantId, takesOrders])
  useEffect(() => { if (!tenantId || !takesOrders) return; return watchOpenWaiterCalls(tenantId, (l) => setCalls(l || [])) }, [tenantId, takesOrders])
  useEffect(() => { if (!tenantId || !isManager) return; return watchComplaints(tenantId, (l) => setComplaints((l || []).filter((c) => (c.status || 'open') === 'open')), 50) }, [tenantId, isManager])
  useEffect(() => { if (!tenantId) return; return watchAnnouncements(tenantId, (l) => setAnnouncements(l || []), 30) }, [tenantId])
  useEffect(() => { if (!tenantId || !isManager) return; return watchLeaves(tenantId, (l) => setLeaves(l || [])) }, [tenantId, isManager])
  useEffect(() => { if (!tenantId || !uid || isManager) return; return watchMyLeaves(tenantId, uid, (l) => setMyLeaves(l || [])) }, [tenantId, uid, isManager])
  useEffect(() => { if (!tenantId) return; return watchAllReviews(tenantId, (l) => setReviews(l || []), 60) }, [tenantId])
  useEffect(() => { if (!tenantId || !uid) return; return watchMyAttendance(tenantId, uid, (l) => setPunches(l || []), 30) }, [tenantId, uid])
  useEffect(() => { if (!tenantId || !isManager) return; return watchStatusLog(tenantId, (l) => setStatusLog(l || []), 80) }, [tenantId, isManager])
  useEffect(() => { if (!tenantId || !uid) return; return watchMyShifts(tenantId, uid, (l) => setMyShifts(l || [])) }, [tenantId, uid])
  useEffect(() => { if (!tenantId) return; return watchShiftSwaps(tenantId, (l) => setSwaps(l || []), 60) }, [tenantId])

  const items = useMemo(() => {
    const now = Date.now()
    const out = []

    // announcements (everyone) — only those whose publish time has arrived & not expired
    announcements.forEach((a) => {
      const at = a.publishAt || ms(a.createdAt)
      if (at > now) return
      if (a.expiresAt && a.expiresAt <= now) return
      out.push({ id: 'ann_' + a.id, kind: 'announcement', icon: 'bell', color: 'var(--brand)', url: '/portal', at,
        title: a.title || (ar ? 'إعلان جديد' : 'Announcement'), body: a.body || '' })
    })

    // new (pending) orders — for order-takers (click opens the full order)
    orders.filter((o) => o.status === 'pending').forEach((o) => {
      out.push({ id: 'ord_' + o.id, kind: 'order', icon: 'orders', color: 'var(--brand)', orderId: o.id, at: ms(o.createdAt),
        title: `${ar ? 'طلب جديد' : 'New order'} · ${orderNumber(o.code)}`,
        body: o.tableLabel || (o.orderType === 'curbside' ? (ar ? 'استلام بالسيارة' : 'Curbside') : o.orderType === 'pickup' ? (ar ? 'استلام' : 'Pickup') : (ar ? 'داخل المقهى' : 'Dine-in')) })
    })

    // waiter calls / arrivals — for order-takers (resolvable inline)
    calls.forEach((c) => {
      const arrived = c.reason === 'arrived'
      out.push({ id: 'wc_' + c.id, kind: 'waiter', icon: arrived ? 'car' : 'waiter', color: 'var(--brand)', url: '/cashier', at: ms(c.createdAt),
        title: arrived ? (ar ? 'وصل العميل' : 'Customer arrived') : (ar ? 'نداء نادل' : 'Waiter call'),
        body: c.tableLabel || (c.orderCode ? `#${c.orderCode}` : ''), resolve: () => resolveWaiterCall(tenantId, c.id) })
    })

    // complaints — for managers (click opens the exact complaint)
    complaints.forEach((c) => {
      out.push({ id: 'cmp_' + c.id, kind: 'complaint', icon: 'complaint', color: 'var(--danger)', url: '/admin/complaints?focus=' + c.id, at: ms(c.createdAt),
        title: `${ar ? 'شكوى جديدة' : 'New complaint'}${c.orderCode ? ` · #${c.orderCode}` : ''}`, body: (c.message || '').slice(0, 80) })
    })

    // pending leave requests — for managers (click opens the exact request)
    leaves.filter((l) => (l.status || 'pending') === 'pending').forEach((l) => {
      out.push({ id: 'lv_' + l.id, kind: 'leave', icon: 'calendar', color: 'var(--gold)', url: '/admin/hr?tab=leaves&focus=' + l.id, at: ms(l.createdAt),
        title: `${ar ? 'طلب إجازة' : 'Leave request'} · ${l.staffName || ''}`, body: `${l.from || ''}${l.to ? ` → ${l.to}` : ''}` })
    })

    // my leave decisions — for the staffer
    myLeaves.filter((l) => l.status === 'approved' || l.status === 'declined').forEach((l) => {
      const ok = l.status === 'approved'
      out.push({ id: 'lvd_' + l.id, kind: 'leaveDecision', icon: ok ? 'check' : 'close', color: ok ? 'var(--success)' : 'var(--danger)', url: '/portal?leave=' + l.id, at: ms(l.updatedAt) || ms(l.createdAt),
        title: ok ? (ar ? 'تمت الموافقة على إجازتك' : 'Leave approved') : (ar ? 'رُفض طلب الإجازة' : 'Leave declined'),
        body: l.declineReason ? `${l.from || ''}${l.to ? ` → ${l.to}` : ''} · ${l.declineReason}` : `${l.from || ''}${l.to ? ` → ${l.to}` : ''}` })
    })

    // customer ratings tied to me (staffer); low ratings (managers)
    reviews.forEach((r) => {
      if (uid && r.staffUid === uid) {
        out.push({ id: 'rt_' + r.id, kind: 'rating', icon: 'star', color: 'var(--gold)', url: '/portal', at: ms(r.createdAt),
          title: `${ar ? 'تقييم جديد لك' : 'New rating'} · ${r.rating}★`, body: r.comment || '' })
      } else if (isManager && (r.rating || 5) <= 2) {
        out.push({ id: 'lr_' + r.id, kind: 'rating', icon: 'star', color: 'var(--danger)', url: '/admin/hr', at: ms(r.createdAt),
          title: `${ar ? 'تقييم منخفض' : 'Low rating'} · ${r.rating}★`, body: (r.comment || r.staffName || '').slice(0, 80) })
      }
    })

    // morning daily report — managers, once per day after 5 AM
    if (isManager) {
      const fiveAm = new Date(); fiveAm.setHours(5, 0, 0, 0)
      if (now >= fiveAm.getTime()) {
        out.push({ id: 'report_' + isoToday(), kind: 'report', icon: 'reports', color: 'var(--brand)', url: '/admin/daily', at: fiveAm.getTime(),
          title: ar ? 'التقرير اليومي جاهز' : 'Daily report ready', body: ar ? 'ملخّص الأمس: طلبات وإيرادات وأداء وحضور' : 'Yesterday: orders, revenue, performance, attendance' })
      }
    }

    // status sessions — for managers: who is currently busy / on break (+ overstay vs policy)
    const breakLimit = tenant?.statusPolicy?.breakLimitMinutes ?? 30
    const busyLimit = tenant?.statusPolicy?.busyLimitMinutes ?? 60
    statusLog.filter((s) => !s.endedAt && (s.status === 'busy' || s.status === 'break')).forEach((s) => {
      const elapsed = now - (s.startedAt || now)
      const limitMin = s.status === 'break' ? breakLimit : busyLimit
      const over = limitMin > 0 && elapsed > limitMin * 60000
      const label = s.status === 'busy' ? (ar ? 'مشغول' : 'busy') : (ar ? 'في استراحة' : 'on break')
      out.push({ id: 'st_' + s.id, kind: 'status', icon: 'clock', color: over ? 'var(--danger)' : 'var(--gold)', url: '/admin/hr?tab=members&staff=' + s.staffUid, at: s.startedAt || 0,
        title: over
          ? (ar ? `${s.staffName || ''} تجاوز وقت ${label} المسموح` : `${s.staffName || ''} over the allowed ${label} time`)
          : (ar ? `${s.staffName || ''} ${label} الآن` : `${s.staffName || ''} is ${label}`),
        body: ar ? `منذ ${Math.floor(elapsed / 60000)} دقيقة (الحد ${limitMin}د)` : `${Math.floor(elapsed / 60000)}m (limit ${limitMin}m)` })
    })

    // upcoming shifts — for the staffer (new assignment alerts)
    const tday = isoToday()
    myShifts.filter((s) => s.date >= tday && s.start).forEach((s) => {
      out.push({ id: 'sh_' + s.id, kind: 'shift', icon: 'calendar', color: 'var(--brand)', url: '/portal', at: ms(s.createdAt),
        title: ar ? `وردية ${s.date === tday ? 'اليوم' : s.date}` : `Shift ${s.date === tday ? 'today' : s.date}`,
        body: `${s.start} – ${s.end}` })
    })

    // shift swaps — managers: pending requests; coworker: incoming; requester: decision
    swaps.forEach((s) => {
      const st = s.status || 'pending'
      const when = ar ? s.date : s.date
      if (st === 'pending' && isManager) {
        out.push({ id: 'sw_m_' + s.id, kind: 'swap', icon: 'repeat', color: 'var(--gold)', url: '/admin/hr?tab=schedule', at: ms(s.createdAt),
          title: ar ? `طلب تبديل وردية` : 'Shift swap request', body: `${s.fromName || ''} ↔ ${s.toName || ''} · ${when}` })
      } else if (st === 'pending' && s.toUid === uid) {
        out.push({ id: 'sw_t_' + s.id, kind: 'swap', icon: 'repeat', color: 'var(--brand)', url: '/portal', at: ms(s.createdAt),
          title: ar ? `${s.fromName || ''} يطلب تبديل وردية معك` : `${s.fromName || ''} wants to swap with you`, body: `${when} · ${s.fromStart || ''}–${s.fromEnd || ''}` })
      } else if ((st === 'accepted' || st === 'declined') && s.fromUid === uid) {
        const ok = st === 'accepted'
        out.push({ id: 'sw_d_' + s.id, kind: 'swap', icon: ok ? 'check' : 'close', color: ok ? 'var(--success)' : 'var(--danger)', url: '/portal', at: ms(s.updatedAt) || ms(s.createdAt),
          title: ok ? (ar ? `قبل ${s.toName || 'الزميل'} تبديل وردِيتك` : 'Shift swap accepted') : (ar ? 'رُفض طلب التبديل' : 'Swap declined'),
          body: !ok && s.declineReason ? `${when} · ${s.declineReason}` : `${when}` })
      }
    })

    // my lateness — for the staffer
    punches.filter((p) => p.type === 'in' && (p.lateMinutes || 0) > 0).forEach((p) => {
      out.push({ id: 'late_' + p.id, kind: 'late', icon: 'clock', color: 'var(--warning)', url: '/portal', at: ms(p.at),
        title: ar ? `سجّلت تأخيراً ${p.lateMinutes} دقيقة` : `Late clock-in · ${p.lateMinutes}m`,
        body: p.deduction ? (ar ? `سيُحتسب خصم ${p.deduction}` : `Deduction ${p.deduction}`) : (ar ? 'احتُسب كتأخير' : 'Counted as late') })
    })

    return out.sort((a, b) => b.at - a.at).slice(0, 80)
  }, [orders, calls, complaints, announcements, leaves, myLeaves, reviews, punches, statusLog, myShifts, swaps, tenant, ar, isManager, uid, tenantId])

  // ---- unread tracking (per user, per device) ----
  const seenKey = tenantId && uid ? `notifSeen_${tenantId}_${uid}` : ''
  const [lastSeen, setLastSeen] = useState(() => {
    try { return seenKey ? Number(localStorage.getItem(seenKey)) || 0 : 0 } catch (_) { return 0 }
  })
  useEffect(() => {
    try { setLastSeen(seenKey ? Number(localStorage.getItem(seenKey)) || 0 : 0) } catch (_) { /* ignore */ }
  }, [seenKey])
  const unread = items.filter((i) => i.at > lastSeen).length
  const markAllRead = () => {
    const now = Date.now()
    setLastSeen(now)
    try { if (seenKey) localStorage.setItem(seenKey, String(now)) } catch (_) { /* ignore */ }
  }

  // ---- live alerts (sound + system notification) for events after mount ----
  const sessionStart = useRef(Date.now())
  const known = useRef(new Set())
  const primed = useRef(false)
  useEffect(() => {
    const fresh = items.filter((i) => !known.current.has(i.id))
    fresh.forEach((i) => known.current.add(i.id))
    if (primed.current) {
      const alertable = fresh.filter((i) => i.at >= sessionStart.current && ALERT_KINDS.has(i.kind))
      if (alertable.length) {
        const top = alertable.sort((a, b) => b.at - a.at)[0]
        alertParty({ title: top.title, body: top.body, tag: top.kind, url: top.url, requireInteraction: top.kind === 'waiter' || top.kind === 'complaint' })
      }
    }
    primed.current = true
  }, [items])

  return { items, unread, markAllRead }
}
