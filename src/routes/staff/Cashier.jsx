import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DndContext, useDraggable, useDroppable, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import {
  watchActiveOrders, updateOrderStatus, watchOpenWaiterCalls, resolveWaiterCall, watchOrdersSince, watchCustomers,
  payOrder, payPartial, cancelOrderWithReason, watchOpenCashierSession, processMembershipOnPaid, consumeForOrder,
} from '../../lib/db.js'
import { resolveMembershipPolicy } from '../../lib/membership.js'
import { orderNumber, timeAgo, minutesSince } from '../../lib/format.js'
import { Price } from '../../components/Riyal.jsx'
import { alertParty } from '../../lib/notify.js'
import { printReceipt } from '../../lib/print.js'
import StaffBell from '../../components/StaffBell.jsx'
import { useToast } from '../../components/Toast.jsx'
import OrderDetail from '../../components/OrderDetail.jsx'
import CashierPOS from '../../components/CashierPOS.jsx'
import PaymentSheet from '../../components/PaymentSheet.jsx'
import CancelReasonSheet from '../../components/CancelReasonSheet.jsx'
import CustomerCard from '../../components/CustomerCard.jsx'
import CashDrawer from '../../components/CashDrawer.jsx'
import Icon from '../../components/Icon.jsx'
import { useCompactUI } from '../../lib/useCompactUI.js'
import { systemThemeAttr, useSystemThemeBody } from '../../lib/systemThemes.js'
import { getPinActor, requestLock } from '../../lib/pin.js'
import { CAP } from '../../lib/permissions.js'
import PinLock from '../../components/PinLock.jsx'
import AppBackground from '../../components/AppBackground.jsx'
import LandscapeGate from '../../components/LandscapeGate.jsx'
import Tour from '../../components/Tour.jsx'
import { TOURS } from '../../lib/tours.js'

const NEXT = {
  pending: { to: 'accepted', key: 'accept', cls: 'btn-primary' },
  accepted: { to: 'preparing', key: 'startPreparing', cls: 'btn-primary' },
  preparing: { to: 'ready', key: 'markReady', cls: 'btn-success' },
  ready: { to: 'served', key: 'markServed', cls: 'btn-success' },
}
const COL_STATUS = { new: 'pending', prep: 'preparing', done: 'ready' }
const digits = (p) => (p || '').replace(/[^0-9]/g, '')

function startOfToday() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d
}

export default function Cashier() {
  useCompactUI()
  const { t, lang, toggleTheme, theme } = useI18n()
  const { tenantId, tenant, profile, user, isManager, can } = useAuth()
  const toast = useToast()
  useSystemThemeBody(tenant, 'cashier')
  // Payment/refund and cancellation are capability-gated (a waiter with only
  // take_orders can build orders but not settle or void them) — matches OrderDetail.
  const canPay = isManager || can(CAP.REFUND)
  const canCancel = isManager || can(CAP.CANCEL_ORDER)
  const currency = tenant?.currency || 'SAR'
  // PIN-unlocked staff (shared device) takes precedence for accountability
  const actorName = getPinActor(tenantId)?.name || profile?.displayName || profile?.email || (lang === 'ar' ? 'موظف' : 'staff')

  const [orders, setOrders] = useState(null)
  const [todays, setTodays] = useState(null) // null = first snapshot not in yet (loading, not empty)
  const [calls, setCalls] = useState([])
  const [view, setView] = useState('active')
  const [detailId, setDetailId] = useState(null)
  const [flagged, setFlagged] = useState({})
  const [session, setSession] = useState(null)
  const [payTarget, setPayTarget] = useState(null) // { order, markServed }
  const [cancelTarget, setCancelTarget] = useState(null)
  const [custTarget, setCustTarget] = useState(null) // { phone, name }
  const [posOpen, setPosOpen] = useState(false)
  const prevPending = useRef(0)
  const prevCalls = useRef(0)
  const seeded = useRef(false)
  const escalated = useRef(new Set())

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  )

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchActiveOrders(tenantId, setOrders)
    const u2 = watchOpenWaiterCalls(tenantId, setCalls)
    const u3 = watchOrdersSince(tenantId, startOfToday(), setTodays)
    const u4 = watchCustomers(tenantId, (list) => {
      const m = {}
      list.forEach((c) => { if (c.flagged) m[c.id] = c })
      setFlagged(m)
    })
    const u5 = watchOpenCashierSession(tenantId, user?.uid || '', setSession)
    return () => { u1(); u2(); u3(); u4(); u5() }
  }, [tenantId])

  // Escalate orders that sit too long without progress (manager + party alert, once each).
  useEffect(() => {
    if (!orders) return
    const LATE = 12
    orders.forEach((o) => {
      if (['pending', 'accepted', 'preparing'].includes(o.status) && minutesSince(o.createdAt) >= LATE && !escalated.current.has(o.id)) {
        escalated.current.add(o.id)
        alertParty({ title: lang === 'ar' ? 'طلب متأخر' : 'Late order', body: `${orderNumber(o.code)} · ${minutesSince(o.createdAt)}${lang === 'ar' ? 'د' : 'm'}`, tag: 'late', url: '/cashier' })
      }
    })
  }, [orders, lang])

  useEffect(() => {
    if (!orders) return
    const pending = orders.filter((o) => o.status === 'pending').length
    if (seeded.current && pending > prevPending.current) {
      alertParty({ title: lang === 'ar' ? 'طلب جديد' : 'New order', body: lang === 'ar' ? 'وصل طلب جديد' : 'New order', tag: 'order', url: '/cashier' })
    }
    prevPending.current = pending
    seeded.current = true
  }, [orders, lang])

  useEffect(() => {
    const n = calls.length
    if (seeded.current && n > prevCalls.current) {
      alertParty({ title: lang === 'ar' ? 'نداء نادل' : 'Waiter call', body: calls[0]?.tableLabel || '', tag: 'call', url: '/cashier' })
    }
    prevCalls.current = n
  }, [calls, lang])

  // Keyboard shortcuts for hands-on-keyboard cashiers: F4 = new POS order,
  // F2 = collect payment for the first READY order. Skipped while typing.
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'F4') { e.preventDefault(); setPosOpen(true) }
      else if (e.key === 'F2') {
        e.preventDefault()
        const ready = (orders || []).find((o) => o.status === 'ready')
        if (ready && canPay) setPayTarget({ order: ready, markServed: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [orders, canPay])

  const advance = (o) => {
    const n = NEXT[o.status]
    if (!n) return
    const extra = {}
    if (n.to === 'accepted') { extra.acceptedByName = actorName; extra.acceptedByUid = user?.uid || '' }
    if (n.to === 'served') { extra.servedByName = actorName; extra.servedByUid = user?.uid || '' }
    updateOrderStatus(tenantId, o.id, n.to, extra)
  }
  // Payment goes through the PaymentSheet (method + tip). markServed=true for a ready order.
  const askPay = (o, markServed) => setPayTarget({ order: o, markServed })
  // A failed charge must be LOUD: the sheet only closes on success; on error it
  // stays open with a clear toast so the cashier retries instead of assuming paid.
  const payBusy = useRef(false)
  const confirmPay = async ({ method, tip, amountPaid, breakdown }) => {
    if (!payTarget || payBusy.current) return
    payBusy.current = true
    const o = payTarget.order
    const markServed = payTarget.markServed
    const due = Math.max(0, (o.total || 0) - (o.amountPaid || 0))
    const policy = resolveMembershipPolicy(tenant)
    try {
      if (amountPaid != null && amountPaid < due) {
        const r = await payPartial(tenantId, o.id, { amount: amountPaid, method, actor: actorName })
        if (r?.completed && o.customerPhone) processMembershipOnPaid(tenantId, o.customerPhone, o, policy)
        if (r?.completed) consumeForOrder(tenantId, o.id, { actor: actorName }).catch(() => {})
      } else {
        await payOrder(tenantId, o.id, { method, tip, actor: actorName, markServed, breakdown })
        if (o.customerPhone) processMembershipOnPaid(tenantId, o.customerPhone, o, policy)
        consumeForOrder(tenantId, o.id, { actor: actorName }).catch(() => {})
      }
      setPayTarget(null)
      toast.success(lang === 'ar' ? 'تم تحصيل الدفعة' : 'Payment recorded')
    } catch (e) {
      toast.error((lang === 'ar' ? 'فشل تسجيل الدفع — أعد المحاولة' : 'Payment failed — retry') + (e?.code ? ` · ${e.code}` : ''))
    } finally {
      payBusy.current = false
    }
  }
  // Cancellation goes through CancelReasonSheet (reason is mandatory + logged).
  const askCancel = (o) => setCancelTarget(o)
  const confirmCancel = ({ reason, noShow }) => {
    if (!cancelTarget) return
    cancelOrderWithReason(tenantId, cancelTarget.id, { reason, actor: actorName, noShow, policy: resolveMembershipPolicy(tenant) })
    setCancelTarget(null)
  }
  const openCustomer = (o) => { if (o.customerPhone) setCustTarget({ phone: o.customerPhone, name: o.customerName }) }
  const print = (o) => printReceipt(o, { tenant, lang })
  const printTable = (o) => {
    const group = orders.filter((x) => x.tableId && x.tableId === o.tableId)
    printReceipt(group, { tenant, lang, title: o.tableLabel })
  }
  const onDragEnd = ({ active, over }) => {
    if (!over) return
    const status = COL_STATUS[over.id]
    if (!status) return
    const o = orders.find((x) => x.id === active.id)
    if (o && o.status !== status) updateOrderStatus(tenantId, active.id, status)
  }

  if (orders === null) return <Spinner />

  const cols = [
    { key: 'new', label: t('newOrders'), items: orders.filter((o) => o.status === 'pending') },
    { key: 'prep', label: t('preparing'), items: orders.filter((o) => ['accepted', 'preparing'].includes(o.status)) },
    { key: 'done', label: t('ready'), items: orders.filter((o) => o.status === 'ready') },
  ]
  const completed = (todays || [])
    .filter((o) => ['served', 'paid', 'cancelled'].includes(o.status))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))

  return (
    <div className="cashier-shell" data-systheme={systemThemeAttr(tenant, 'cashier')}>
      <AppBackground tenant={tenant} />
      <LandscapeGate enabled={tenant?.cashierLandscape === true} />
      <PinLock tenant={tenant} tenantId={tenantId} />
      <Tour steps={TOURS.cashier} storageKey="cashier" />
      <header className="app-bar">
        <Link to="/admin" className="icon-btn"><Icon name="back" /></Link>
        <strong style={{ fontSize: 'var(--fs-md)' }}>{t('cashier')}</strong>
        <div className="grow" />
        {tenant?.pinLock?.enabled && <button className="icon-btn" onClick={requestLock} title={lang === 'ar' ? 'قفل الشاشة' : 'Lock'}><Icon name="key" size={18} /></button>}
        <StaffBell tenantId={tenantId} />
        <Link to="/scan" className="icon-btn" title={t('scan')}><Icon name="scan" /></Link>
        <Link to="/kds" className="icon-btn" title={t('kitchen')}><Icon name="kitchen" /></Link>
        <button className="icon-btn" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
      </header>

      <div className="container page stack">
        <div className="segmented" style={{ alignSelf: 'center' }}>
          <button className={view === 'active' ? 'active' : ''} onClick={() => setView('active')}>{lang === 'ar' ? 'نشطة' : 'Active'} ({orders.length})</button>
          <button className={view === 'done' ? 'active' : ''} onClick={() => setView('done')}>{lang === 'ar' ? 'مكتملة' : 'Completed'}{todays === null ? '' : ` (${completed.length})`}</button>
        </div>

        <CashDrawer tid={tenantId} lang={lang} actorName={actorName} uid={user?.uid} currency={currency} session={session} orders={todays || []} />

        <button className="btn btn-primary btn-block" style={{ minHeight: 44, fontWeight: 800 }} onClick={() => setPosOpen(true)}><Icon name="add" size={17} /> {lang === 'ar' ? 'طلب جديد من الكاشير' : 'New order (POS)'}</button>

        {calls.length > 0 && view === 'active' && (
          <div className="card card-pad stack" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)' }}>
            <strong><Icon name="bellRing" size={14} style={{ verticalAlign: 'middle' }} /> {lang === 'ar' ? 'نداء النادل' : 'Waiter calls'}</strong>
            {calls.map((c) => (
              <div key={c.id} className="row-between">
                <span className="small">{c.tableLabel || (lang === 'ar' ? 'طاولة' : 'Table')} · {timeAgo(c.createdAt, lang)}</span>
                <button className="btn btn-sm btn-outline" onClick={() => resolveWaiterCall(tenantId, c.id)}>{lang === 'ar' ? 'تم' : 'Done'}</button>
              </div>
            ))}
          </div>
        )}

        {view === 'active' ? (
          orders.length === 0 ? (
            <Empty icon="ok" title={lang === 'ar' ? 'لا طلبات نشطة' : 'No active orders'} hint={lang === 'ar' ? 'تظهر الطلبات الجديدة هنا فوراً' : 'New orders appear here instantly'} />
          ) : (
            <>
              <p className="xs faint text-center"><Icon name="arrowLeftRight" size={12} style={{ verticalAlign: 'middle' }} /> {lang === 'ar' ? 'اسحب الطلب بين الأعمدة لتغيير حالته' : 'Drag an order between columns to change status'}</p>
              <DndContext sensors={sensors} onDragEnd={onDragEnd}>
                <div className="board">
                  {cols.map((col) => (
                    <Column key={col.key} id={col.key} label={col.label} count={col.items.length}>
                      {col.items.map((o) => (
                        <Ticket key={o.id} order={o} currency={currency} lang={lang} t={t} orders={orders} isManager={isManager} canPay={canPay} canCancel={canCancel}
                          flag={flagged[digits(o.customerPhone)]}
                          onAdvance={advance} onServePay={(x) => askPay(x, true)} onCancel={askCancel} onPrint={print} onPrintTable={printTable} onOpen={setDetailId} onOpenCustomer={openCustomer} />
                      ))}
                      {col.items.length === 0 && <p className="xs faint text-center" style={{ padding: 8 }}>—</p>}
                    </Column>
                  ))}
                </div>
              </DndContext>
            </>
          )
        ) : todays === null ? (
          <Spinner />
        ) : completed.length === 0 ? (
          <Empty icon="cashier" title={lang === 'ar' ? 'لا طلبات مكتملة اليوم' : 'No completed orders today'} />
        ) : (
          <div className="stack done-list" style={{ gap: 'var(--sp-2)' }}>
            {completed.map((o) => (
              <div key={o.id} className="list-row">
                <div className="grow" style={{ cursor: 'pointer' }} onClick={() => setDetailId(o.id)}>
                  <div className="bold" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {orderNumber(o.code)}
                    <span className={`badge ${o.status === 'cancelled' ? 'badge-danger' : o.status === 'paid' ? 'badge-success' : ''}`}>{t(o.status === 'paid' ? 'statusPaid' : o.status === 'cancelled' ? 'statusCancelled' : 'statusServed')}</span>
                    {o.status === 'served' && ((o.paidOnline || o.paymentStatus === 'paid')
                      ? <span className="badge badge-success">{lang === 'ar' ? 'مدفوع أونلاين' : 'Paid online'}</span>
                      : o.amountPaid > 0 && o.amountPaid < (o.total || 0)
                        ? <span className="badge badge-gold">{lang === 'ar' ? 'جزئي · متبقّي' : 'Partial · left'} <Price value={(o.total || 0) - (o.amountPaid || 0)} currency={currency} lang={lang} /></span>
                        : <span className="badge badge-danger">{lang === 'ar' ? 'غير مدفوع' : 'Unpaid'}</span>)}
                  </div>
                  <div className="xs faint">{o.tableLabel || t('takeaway')} · {timeAgo(o.createdAt, lang)} · <Price value={o.total} currency={currency} lang={lang} /></div>
                </div>
                <button className="icon-btn" onClick={() => setDetailId(o.id)} title={lang === 'ar' ? 'تفاصيل' : 'Details'}><Icon name="eye" size={18} /></button>
                <button className="icon-btn" onClick={() => print(o)} title={lang === 'ar' ? 'طباعة' : 'Print'}><Icon name="print" size={18} /></button>
                {o.status === 'served' && canPay && <button className="btn btn-sm btn-success" onClick={() => askPay(o, false)}>{t('markPaid')}</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {detailId && <OrderDetail tid={tenantId} orderId={detailId} currency={currency} staffActions onClose={() => setDetailId(null)} />}
      <PaymentSheet open={!!payTarget} order={payTarget?.order} currency={currency} lang={lang} onConfirm={confirmPay} onClose={() => setPayTarget(null)} />
      <CancelReasonSheet open={!!cancelTarget} lang={lang} onConfirm={confirmCancel} onClose={() => setCancelTarget(null)} />
      {custTarget && <CustomerCard tid={tenantId} phone={custTarget.phone} name={custTarget.name} currency={currency} onClose={() => setCustTarget(null)} />}
      <CashierPOS open={posOpen} onClose={() => setPosOpen(false)} tenantId={tenantId} tenant={tenant} lang={lang} actorName={actorName} canPay={canPay} />
    </div>
  )
}

function Column({ id, label, count, children }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className="board-col" style={{ outline: isOver ? '2px dashed var(--brand)' : 'none' }}>
      <h3>{label}<span className="badge">{count}</span></h3>
      {children}
    </div>
  )
}

function Ticket({ order: o, currency, lang, t, orders, flag, isManager, canPay = true, canCancel = true, onAdvance, onServePay, onCancel, onPrint, onPrintTable, onOpen, onOpenCustomer }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: o.id })
  const mins = minutesSince(o.createdAt)
  const ageCls = mins >= 10 ? 'age-late' : mins >= 5 ? 'age-warn' : ''
  const n = NEXT[o.status]
  const sameTable = o.tableId ? orders.filter((x) => x.tableId === o.tableId).length : 0
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50, opacity: isDragging ? 0.85 : 1 } : undefined

  return (
    <div ref={setNodeRef} style={style} className={`order-ticket ${ageCls}`}>
      <div className="row-between" style={{ touchAction: 'none', cursor: 'grab' }} {...listeners} {...attributes}>
        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="drag" size={15} className="faint" />{orderNumber(o.code)}</strong>
        <span className={`cash-timer ${ageCls}`}>{mins}{lang === 'ar' ? 'د' : 'm'}</span>
      </div>
      <div className="xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700, color: (o.orderType === 'curbside' || o.orderType === 'delivery') ? 'var(--brand)' : 'var(--text-muted)' }}>
        <Icon name={(o.orderType === 'curbside' || o.orderType === 'delivery') ? 'car' : o.orderType === 'pickup' ? 'bag' : 'tables'} size={13} />
        {o.tableLabel || (o.orderType === 'curbside' ? t('curbside') : o.orderType === 'delivery' ? (lang === 'ar' ? 'توصيل' : 'Delivery') : o.orderType === 'pickup' ? t('pickup') : o.orderType === 'takeaway' ? t('takeaway') : t('dineIn'))}
        {o.partySize ? ` · ${o.partySize}` : ''}
      </div>
      {/* How the guest pays — so the cashier is ready to collect (or knows it's prepaid). */}
      {(() => {
        const paid = o.paidOnline || o.paymentStatus === 'paid'
        const pm = o.paymentMethod
        const cfg = paid
          ? { icon: 'ok', color: 'var(--success)', label: lang === 'ar' ? 'مدفوع أونلاين' : 'Paid online' }
          : pm === 'card_terminal'
            ? { icon: 'card', color: 'var(--brand)', label: lang === 'ar' ? 'شبكة — يُحصّل عند الاستلام' : 'Card machine — collect on handover' }
            : pm === 'online'
              ? { icon: 'wallet', color: 'var(--text-muted)', label: lang === 'ar' ? 'بانتظار الدفع أونلاين' : 'Awaiting online payment' }
              : { icon: 'wallet', color: 'var(--text-muted)', label: lang === 'ar' ? 'نقدي — يُحصّل عند الاستلام' : 'Cash — collect on handover' }
        return (
          <div className="xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, color: cfg.color }}>
            <Icon name={cfg.icon} size={12} /> {cfg.label}
          </div>
        )
      })()}
      {o.orderType === 'curbside' && o.car && (o.car.model || o.car.color || o.car.plate) ? (
        <div className="xs faint">{[o.car.model, o.car.color, o.car.plate].filter(Boolean).join(' · ')}</div>
      ) : null}
      {o.orderType === 'delivery' && o.delivery?.address ? (
        <div className="xs faint" style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}><Icon name="pin" size={12} style={{ marginTop: 1, flex: 'none' }} /> <span>{o.delivery.address}{o.delivery.lat ? <a href={`https://maps.google.com/?q=${o.delivery.lat},${o.delivery.lng}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)', marginInlineStart: 6 }}>{lang === 'ar' ? 'الخريطة' : 'Map'}</a> : null}</span></div>
      ) : null}
      {o.customerName ? (
        o.customerPhone ? (
          <button className="xs faint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--brand)', textAlign: 'start' }} onClick={() => onOpenCustomer(o)} title={lang === 'ar' ? 'بطاقة العميل' : 'Customer card'}>
            <Icon name="user" size={12} /> {o.customerName} · {o.customerPhone}
          </button>
        ) : (
          <div className="xs faint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="user" size={12} /> {o.customerName}</div>
        )
      ) : null}
      {flag ? (
        <div className="badge badge-danger" style={{ marginTop: 4, whiteSpace: 'normal', textAlign: 'start', lineHeight: 1.3 }}>
          <Icon name="warning" size={12} style={{ verticalAlign: 'middle' }} /> {lang === 'ar' ? 'عميل موسوم' : 'Tagged customer'}{flag.flagNote ? ` — ${flag.flagNote}` : ''}
        </div>
      ) : null}
      {(o.acceptedByName || o.servedByName) ? (
        <div className="xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--brand)' }}>
          <Icon name="staff" size={12} /> {o.servedByName || o.acceptedByName}
        </div>
      ) : null}
      <div className="stack" style={{ gap: 2, margin: '8px 0' }}>
        {(o.items || []).map((l, i) => (
          <div key={i} className="small">
            <span className="bold">{l.qty}× {lang === 'en' && l.nameEn ? l.nameEn : l.nameAr}</span>{l.variantLabel ? ` (${l.variantLabel})` : ''}
            {l.modifiers?.length ? <div className="cash-mods">{l.modifiers.map((m) => (lang === 'en' && m.nameEn ? m.nameEn : m.nameAr)).join(' · ')}</div> : null}
          </div>
        ))}
      </div>
      {o.notes && <div className="cash-note">{o.notes}</div>}
      {o.discount > 0 || o.loyaltyDiscount > 0 || o.memberDiscount > 0 ? <div className="xs" style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="offers" size={13} /> {lang === 'ar' ? 'خصم' : 'disc'} −<Price value={(o.discount || 0) + (o.loyaltyDiscount || 0) + (o.memberDiscount || 0)} currency={currency} lang={lang} /></div> : null}
      <div className="row-between" style={{ marginTop: 8 }}>
        {/* the total is what the cashier scans for — it must dominate the ticket */}
        <span className="price bold" style={{ fontSize: 'var(--fs-lg)' }}><Price value={o.total} currency={currency} lang={lang} /></span>
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn" onClick={() => onOpen(o.id)} title={lang === 'ar' ? 'تفاصيل' : 'Details'}><Icon name="eye" size={17} /></button>
          <button className="icon-btn" onClick={() => onPrint(o)} title={lang === 'ar' ? 'طباعة' : 'Print'}><Icon name="print" size={17} /></button>
          {/* destructive cancel: spaced away from the routine actions */}
          {(((o.status === 'pending' || o.status === 'accepted') && canCancel) || ((o.status === 'preparing' || o.status === 'ready') && isManager)) && <button className="icon-btn" style={{ color: 'var(--danger)', marginInlineStart: 8 }} onClick={() => onCancel(o)} title={lang === 'ar' ? (o.status === 'preparing' || o.status === 'ready' ? 'إلغاء (مدير)' : 'إلغاء') : 'Cancel'}><Icon name="close" size={16} /></button>}
        </div>
      </div>
      {o.status === 'ready' ? (
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          {canPay && <button className="btn btn-success grow" style={{ minHeight: 42, fontWeight: 800 }} onClick={() => onServePay(o)}><Icon name="check" size={15} /> {lang === 'ar' ? 'تم الدفع' : 'Paid'}</button>}
          <button className="btn btn-outline grow" style={{ minHeight: 42 }} onClick={() => onAdvance(o)}>{canPay ? (lang === 'ar' ? 'بدون دفع' : 'Unpaid') : (lang === 'ar' ? 'تم التقديم' : 'Served')}</button>
        </div>
      ) : n ? (
        <button className={`btn ${n.cls} btn-block`} style={{ marginTop: 6, minHeight: 42, fontWeight: 800 }} onClick={() => onAdvance(o)}>{t(n.key)}</button>
      ) : null}
      {sameTable > 1 && (
        <button className="btn btn-sm btn-outline btn-block" style={{ marginTop: 6 }} onClick={() => onPrintTable(o)}>{lang === 'ar' ? `فاتورة الطاولة (${sameTable})` : `Table bill (${sameTable})`}</button>
      )}
    </div>
  )
}
