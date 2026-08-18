import { useEffect, useMemo, useState } from 'react'
import { useI18n, pickLang } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { Price } from './Riyal.jsx'
import { watchOrder, getCustomerByPhone, setCustomerFlag, refundOrder, compOrder, voidOrderItem, setOrderItemQty, setOrderTable, addOrderItems, watchTables, watchItems, watchStaff, assignDelivery, setDeliveryStatus, settleCod, updateOrderStatus, claimOrder } from '../lib/db.js'

// THE STATUS LADDER lives in lib/orderStatus.js — the same vocabulary and the
// same NEXT_STEP the cashier's ticket button walks, so an order advances (and
// reads) identically no matter which surface the staffer is on.
import { STATUS_FLOW, NEXT_STEP, statusShort, orderTypeLabel } from '../lib/orderStatus.js'
import { useToast } from './Toast.jsx'
import '../styles/order-detail.css'

// Delivery sub-status labels (mirrors the driver portal).
const DSTAT = {
  pending: { ar: 'بانتظار مندوب', en: 'Waiting', cls: '' },
  assigned: { ar: 'مُسند', en: 'Assigned', cls: 'badge-info' },
  picked_up: { ar: 'استُلم', en: 'Picked up', cls: 'badge-info' },
  on_way: { ar: 'في الطريق', en: 'On the way', cls: 'badge-info' },
  delivered: { ar: 'سُلّم', en: 'Delivered', cls: 'badge-success' },
  failed: { ar: 'تعذّر', en: 'Failed', cls: 'badge-danger' },
}
import { printReceipt } from '../lib/print.js'
import { qrDataUrl, publicBaseUrl } from '../lib/qr.js'
import { CAP } from '../lib/permissions.js'
import { resolveMembershipPolicy } from '../lib/membership.js'
import { orderNumber, timeAgo } from '../lib/format.js'

// Reusable full order view — opens any order (live) by id with all its details.
export default function OrderDetail({ tid, orderId, currency = 'SAR', onClose, staffActions = false, onCollect = null }) {
  const { t, lang } = useI18n()
  const { profile, tenant, isManager, can, user } = useAuth()
  const toast = useToast()
  const ar = lang === 'ar'
  const [o, setO] = useState(undefined)
  const [cust, setCust] = useState(null)
  const [refundOpen, setRefundOpen] = useState(false)
  const [refundAmt, setRefundAmt] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [compOpen, setCompOpen] = useState(false)
  const [compAmt, setCompAmt] = useState('')
  const [compReason, setCompReason] = useState('')
  const [receiptQr, setReceiptQr] = useState('')
  const [copied, setCopied] = useState(false)
  const [tables, setTables] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [addOpen, setAddOpen] = useState(false)
  const [addQ, setAddQ] = useState('')
  const [drivers, setDrivers] = useState([])

  useEffect(() => { if (!tid || !orderId) return; return watchOrder(tid, orderId, setO) }, [tid, orderId])
  useEffect(() => { if (!tid || !staffActions || o?.orderType !== 'delivery') return; return watchStaff(tid, (list) => setDrivers(list.filter((s) => s.role === 'driver' && s.active !== false))) }, [tid, staffActions, o?.orderType])
  useEffect(() => { if (!tid || !staffActions) return; const u1 = watchTables(tid, setTables); const u2 = watchItems(tid, setMenuItems); return () => { u1(); u2() } }, [tid, staffActions])
  useEffect(() => { if (!tid || !o?.customerPhone || !staffActions) return; getCustomerByPhone(tid, o.customerPhone).then(setCust) }, [tid, o?.customerPhone, staffActions])
  const actor = profile?.displayName || profile?.email || ''
  const saveFlag = (patch) => { setCust((c) => ({ ...(c || {}), ...patch })); setCustomerFlag(tid, o.customerPhone, { ...patch, staffRatedBy: actor }) }

  const canPay = staffActions && (isManager || can?.(CAP.REFUND))
  const payMethodLabel = (m) => ({ cash: ar ? 'نقدي' : 'Cash', card: ar ? 'شبكة' : 'Card', transfer: ar ? 'تحويل' : 'Transfer', other: ar ? 'أخرى' : 'Other' }[m] || (ar ? 'نقدي' : 'Cash'))
  const fmtClock = (ms) => { try { return new Date(ms).toLocaleTimeString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { hour: '2-digit', minute: '2-digit' }) } catch (_) { return '' } }
  const receiptUrl = o && tenant?.slug ? `${publicBaseUrl()}/order/${tenant.slug}/${orderId}` : ''
  const genReceipt = async () => { if (!receiptUrl) return; try { setReceiptQr(await qrDataUrl(receiptUrl, { width: 320 })) } catch (_) { /* ignore */ } }
  const copyLink = async () => { try { await navigator.clipboard.writeText(receiptUrl); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch (_) { /* ignore */ } }
  const doRefund = () => {
    if (!o) return
    // Empty field = full refund (the convenience default); a typed amount is
    // clamped to [0, total] so an explicit 0 refunds 0 (not the whole order) and
    // no one can over-refund past the order total.
    const amount = refundAmt === '' || refundAmt == null ? (o.total || 0) : Math.min(Math.max(0, Number(refundAmt) || 0), o.total || 0)
    refundOrder(tid, orderId, { amount, reason: refundReason.trim(), actor, policy: resolveMembershipPolicy(tenant) })
    setRefundOpen(false); setRefundAmt(''); setRefundReason('')
  }
  const doComp = () => { if (!o) return; compOrder(tid, orderId, { amount: Number(compAmt) || 0, reason: compReason.trim(), actor }); setCompOpen(false); setCompAmt(''); setCompReason('') }
  const canEditOrder = staffActions && ['pending', 'accepted', 'preparing', 'ready'].includes(o?.status)
  // item photos for the lines — the live menu is already subscribed on staff
  // surfaces (watchItems above powers the add-items sheet); reuse it here
  const imgById = useMemo(() => { const m = {}; menuItems.forEach((it) => { if (it.imageUrl) m[it.id] = it.imageUrl }); return m }, [menuItems])
  const changeTable = (tb) => setOrderTable(tid, orderId, tb ? { tableId: tb.id, tableLabel: tb.label, orderType: 'dine_in' } : { tableId: null, tableLabel: '', orderType: 'takeaway' })
  const appendItem = (it) => {
    const useVar = !Number(it.price) && it.variants?.[0] ? it.variants[0] : null
    const base = useVar ? Number(useVar.price) || 0 : Number(it.price) || 0
    const line = { itemId: it.id, nameAr: it.nameAr, nameEn: it.nameEn || '', variantLabel: useVar ? pickLang(useVar, 'name', lang) : '', variantKey: useVar?.key || '', modifiers: [], unitPrice: base, qty: 1, lineTotal: base, countsForLoyalty: it.countsForLoyalty !== false }
    addOrderItems(tid, orderId, [line], { actor })
  }

  const statusLabel = (s) => statusShort(lang, s)
  const timelineStatus = o?.status === 'paid' ? 'served' : o?.status
  const typeLabel = (ty) => orderTypeLabel(ty, lang)

  // Human duration from milliseconds (s / m / h).
  const fmtDur = (ms) => {
    if (ms == null || ms < 0) return ''
    const s = Math.round(ms / 1000)
    if (s < 60) return ar ? `${s} ث` : `${s}s`
    const m = Math.floor(s / 60); const rs = s % 60
    if (m < 60) return ar ? `${m} د${rs ? ` ${rs} ث` : ''}` : `${m}m${rs ? ` ${rs}s` : ''}`
    const h = Math.floor(m / 60); const rm = m % 60
    return ar ? `${h} س${rm ? ` ${rm} د` : ''}` : `${h}h${rm ? ` ${rm}m` : ''}`
  }
  // Per-stage durations from statusHistory ({ status, at } in ms); 'pending' anchored to createdAt.
  const buildTiming = () => {
    if (!o || o.status === 'cancelled') return null
    const reached = {}
    const created = o.createdAt?.toMillis?.() ?? (o.createdAt?.seconds ? o.createdAt.seconds * 1000 : null)
    if (created != null) reached.pending = created
    ;(o.statusHistory || []).forEach((h) => { if (h?.status && reached[h.status] == null && typeof h.at === 'number') reached[h.status] = h.at })
    const endOf = (st) => (st === 'served' ? (reached.served ?? reached.paid) : reached[st])
    const now = Date.now()
    const defs = [
      { from: 'pending', to: 'accepted', label: ar ? 'انتظار القبول' : 'Wait to accept' },
      { from: 'accepted', to: 'preparing', label: ar ? 'انتظار التحضير' : 'Wait to prep' },
      { from: 'preparing', to: 'ready', label: ar ? 'التحضير' : 'Preparing' },
      { from: 'ready', to: 'served', label: ar ? 'التسليم' : 'Handover' },
    ]
    const rows = []
    defs.forEach((d) => {
      const start = reached[d.from]
      if (start == null) return
      const end = endOf(d.to)
      if (end != null) rows.push({ label: d.label, ms: end - start, live: false })
      else if (d.from === o.status) rows.push({ label: d.label, ms: now - start, live: true })
    })
    // duration to REACH each stage (shown above each timeline segment)
    const order = ['pending', 'accepted', 'preparing', 'ready', 'served']
    const seg = {}
    for (let i = 1; i < order.length; i++) {
      const cur = endOf(order[i])
      const prev = reached[order[i - 1]]
      if (prev == null) continue
      if (cur != null) seg[order[i]] = { ms: cur - prev, live: false }
      else if (order[i - 1] === o.status) seg[order[i]] = { ms: now - prev, live: true }
    }
    const deliverEnd = endOf('served')
    const acceptStart = reached.accepted
    const totalMs = acceptStart != null ? ((deliverEnd ?? now) - acceptStart) : null
    return { rows, seg, totalMs, totalLive: acceptStart != null && deliverEnd == null }
  }
  const timing = buildTiming()

  // ADVANCE + COLLECT are the primary actions whenever they apply, so they are
  // PINNED in the sheet's footer — always reachable, no scrolling past a long
  // items list to act. Same stamps as the cashier's own button (acceptedBy /
  // servedBy), so the audit trail is identical from every surface.
  const advanceStep = () => {
    const n = o && NEXT_STEP[o.status]
    if (!n) return
    // Acceptance is EXCLUSIVE — it goes through claimOrder's compare-and-set,
    // never plain updateOrderStatus, or the last tap overwrites the real claimant.
    if (n.to === 'accepted') {
      claimOrder(tid, orderId, { name: actor, uid: user?.uid || '' }).then((r) => {
        if (r?.ok) return
        if (r?.gone) { toast.error(ar ? 'هذا الطلب لم يعد موجوداً، ربما أُلغي' : 'This order is gone, it may have been cancelled'); return }
        toast.error(r?.by
          ? (ar ? `${r.by} استلم الطلب قبلك` : `${r.by} took this order first`)
          : (ar ? 'تعذّر قبول الطلب، جرّب مرة ثانية' : 'Could not accept the order, try again'))
      })
      return
    }
    const extra = { _actor: actor, _code: o.code || '' }
    if (n.to === 'served') { extra.servedByName = actor; extra.servedByUid = user?.uid || '' }
    // toast on rejection: offline-queued writes replayed against a terminal
    // order are DENIED by rules — the optimistic card snaps back, and without
    // a toast that read as "the button does nothing"
    updateOrderStatus(tid, orderId, n.to, extra).catch(() => {
      toast.error(ar ? 'ما تحدّثت الحالة. افتح الطلب من جديد وتأكد من حالته' : 'The status did not change. Reopen the order and check its state')
    })
  }
  const showCollect = !!(o && staffActions && canPay && onCollect && !['paid', 'refunded', 'cancelled'].includes(o.status))
  const footerNode = o && staffActions && (NEXT_STEP[o.status] || showCollect) ? (
    <div className="od-foot">
      {NEXT_STEP[o.status] && (
        <button className={`btn ${NEXT_STEP[o.status].cls} btn-block`} onClick={advanceStep}>
          <Icon name={NEXT_STEP[o.status].icon} size={16} /> {t(NEXT_STEP[o.status].key)}
        </button>
      )}
      {showCollect && (
        <button className="btn btn-primary btn-block" onClick={() => onCollect(o)}>
          <Icon name="wallet" size={16} /> {ar ? 'تحصيل الدفع' : 'Collect payment'}
          {' · '}<Price value={Math.max(0, (o.total || 0) - (o.amountPaid || 0))} currency={currency} lang={lang} />
        </button>
      )}
    </div>
  ) : null

  return (
    <>
      <Sheet open={!!orderId} onClose={onClose} footer={footerNode} title={o ? `${ar ? 'الطلب' : 'Order'} ${orderNumber(o.code)}` : (ar ? 'الطلب' : 'Order')}>
      {o === undefined ? (
        <p className="muted small">{t('loading') || '…'}</p>
      ) : o === null ? (
        <p className="muted small">{ar ? 'الطلب غير موجود' : 'Order not found'}</p>
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="od-head">
            <div className="od-chips">
              <span className={`badge ${o.status === 'served' || o.status === 'paid' ? 'badge-success' : o.status === 'cancelled' ? 'badge-danger' : 'badge-gold'}`}>{statusLabel(o.status)}{o.status === 'served' && !o.paidOnline && o.paymentStatus !== 'paid' ? ` · ${ar ? 'غير مدفوع' : 'Unpaid'}` : ''}</span>
              <span className="od-chip">
                <Icon name={(o.orderType === 'curbside' || o.orderType === 'delivery') ? 'car' : o.orderType === 'pickup' ? 'bag' : 'tables'} size={13} />
                {o.tableLabel || typeLabel(o.orderType)}
              </span>
              {o.partySize ? <span className="od-chip"><Icon name="user" size={12} /> <span className="num">{o.partySize}</span></span> : null}
              {o.rush ? <span className="badge badge-danger"><Icon name="flame" size={11} style={{ verticalAlign: 'middle' }} /> {ar ? 'عاجل' : 'Rush'}</span> : null}
            </div>
            <span className="xs faint">{timeAgo(o.createdAt, lang)}</span>
          </div>

          {/* the order's journey — icon stages, brand-filled connector, elapsed
              per stage (from buildTiming, unchanged maths), pulse on the live one */}
          {o.status !== 'cancelled' && (
            <div className="od-journey">
              <div className="od-journey-track">
                <div className="od-journey-line" aria-hidden>
                  <div className="od-journey-fill" style={{ width: `${(Math.max(0, STATUS_FLOW.indexOf(timelineStatus)) / (STATUS_FLOW.length - 1)) * 100}%` }} />
                </div>
                {STATUS_FLOW.map((s, i) => {
                  const nowIdx = STATUS_FLOW.indexOf(timelineStatus)
                  const d = timing?.seg?.[s]
                  const ICONS = { pending: 'clock', accepted: 'ok', preparing: 'kitchen', ready: 'bellRing', served: 'check' }
                  return (
                    <div key={s} className={`od-stage ${nowIdx >= i ? 'is-done' : ''} ${nowIdx === i ? 'is-now' : ''} ${d?.live ? 'is-live' : ''} ${i === STATUS_FLOW.length - 1 ? 'is-final' : ''}`}>
                      <span className="od-stage-time num">{d ? fmtDur(d.ms) : ''}</span>
                      <span className="od-stage-dot"><Icon name={ICONS[s]} size={15} /></span>
                      <span className="od-stage-label">{statusLabel(s)}</span>
                    </div>
                  )
                })}
              </div>
              {timing?.totalMs != null && (
                <div className="od-journey-total">
                  <span className="faint">{ar ? 'من القبول للتسليم' : 'Accept → handover'}{timing.totalLive ? ` · ${ar ? 'جارٍ' : 'live'}` : ''}</span>
                  <span className="bold num" style={{ color: 'var(--brand)' }}>{fmtDur(timing.totalMs)}</span>
                </div>
              )}
            </div>
          )}

          <div className="card card-pad stack" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 6 }}><Icon name={(o.orderType === 'curbside' || o.orderType === 'delivery') ? 'car' : o.orderType === 'pickup' ? 'bag' : 'tables'} size={15} className="faint" /><span className="small bold">{o.tableLabel || typeLabel(o.orderType)}</span>{o.orderType === 'delivery' && o.deliveryFee > 0 ? <span className="xs faint">· {ar ? 'رسوم' : 'fee'} <Price value={o.deliveryFee} currency={currency} lang={lang} /></span> : null}</div>
            {o.orderType === 'delivery' && o.delivery?.address && <div className="xs faint" style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}><Icon name="pin" size={12} style={{ marginTop: 1, flex: 'none' }} /> <span>{o.delivery.address}{o.delivery.lat ? <a href={`https://maps.google.com/?q=${o.delivery.lat},${o.delivery.lng}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)', marginInlineStart: 6 }}>{ar ? 'الخريطة' : 'Map'}</a> : null}</span></div>}
            {o.customerName && <div className="xs faint"><Icon name="user" size={12} /> {o.customerName}{o.customerPhone ? ` · ${o.customerPhone}` : ''}</div>}
            {(o.servedByName || o.acceptedByName) && <div className="xs" style={{ color: 'var(--brand)' }}><Icon name="staff" size={12} /> {ar ? 'الموظف' : 'Staff'}: {o.servedByName || o.acceptedByName}</div>}
            {o.status === 'paid' && <div className="xs" style={{ color: 'var(--success)' }}><Icon name="wallet" size={12} /> {ar ? 'مدفوع' : 'Paid'}: {payMethodLabel(o.paymentMethod)}{o.tip ? ` · ${ar ? 'إكرامية' : 'tip'} ${o.tip}` : ''}{o.paidByName ? ` · ${o.paidByName}` : ''}</div>}
            {o.status !== 'paid' && (o.paidOnline || o.paymentStatus === 'paid') && <div className="xs bold" style={{ color: 'var(--success)' }}><Icon name="wallet" size={12} /> {ar ? 'مدفوع بالدفع الإلكتروني، لا تُحصّل نقداً' : 'Paid online, do not collect cash'}</div>}
            {/* 0.005 epsilon: float sums (8.2+0.1) sit a hair under total — without it this showed «متبقّي 0.00» forever */}
            {o.status !== 'paid' && !o.paidOnline && o.paymentStatus !== 'paid' && o.amountPaid > 0 && o.amountPaid < (o.total || 0) - 0.005 && <div className="xs" style={{ color: 'var(--gold, #e0a82e)' }}><Icon name="wallet" size={12} /> {ar ? 'مدفوع جزئياً' : 'Partial'}: <Price value={o.amountPaid} currency={currency} lang={lang} /> · {ar ? 'متبقّي' : 'left'} <Price value={(o.total || 0) - (o.amountPaid || 0)} currency={currency} lang={lang} /></div>}
            {o.refund && <div className="xs" style={{ color: 'var(--danger)' }}><Icon name="repeat" size={12} /> {ar ? 'استرجاع' : 'Refund'}: <Price value={o.refund.amount} currency={currency} lang={lang} />{o.refund.reason ? ` · ${o.refund.reason}` : ''}{o.refund.by ? ` · ${o.refund.by}` : ''}</div>}
            {o.cancelReason && <div className="xs" style={{ color: 'var(--danger)' }}><Icon name="close" size={12} /> {ar ? 'سبب الإلغاء' : 'Cancel reason'}: {o.cancelReason}</div>}
          </div>

          {/* items — thumbnail + qty badge, name/options, line price */}
          <div className="od-items">
            <strong className="small">{ar ? 'الأصناف' : 'Items'}</strong>
            {(o.items || []).map((it, i) => {
              const nm = (lang === 'en' && it.nameEn ? it.nameEn : it.nameAr) || it.name || it.title || ''
              const mods = it.modifiers?.length ? it.modifiers.map((m) => (lang === 'en' && m.nameEn ? m.nameEn : m.nameAr)).filter(Boolean).join(' · ') : (Array.isArray(it.options) ? it.options.map((op) => op.name || op.label || op).join(' · ') : '')
              const line = it.lineTotal != null ? it.lineTotal : (it.unitPrice != null ? it.unitPrice : it.price || 0) * (it.qty || 1)
              const editable = staffActions && ['pending', 'accepted', 'preparing', 'ready'].includes(o.status)
              const canVoid = editable && (o.items || []).length > 1
              const img = it.itemId ? imgById[it.itemId] : ''
              return (
                <div key={i} className="od-item">
                  <span className="od-item-thumb">
                    {img ? <img src={img} alt="" loading="lazy" decoding="async" /> : <Icon name="coffee" size={18} />}
                    <span className="od-item-qty num">{it.qty || 1}×</span>
                  </span>
                  <div className="od-item-main">
                    <div className="od-item-name">{nm}{it.variantLabel ? ` · ${it.variantLabel}` : ''}</div>
                    {mods && <div className="od-item-sub">{mods}</div>}
                    {it.note && <div className="od-item-sub">{ar ? 'ملاحظة' : 'Note'}: {it.note}</div>}
                    {editable && (
                      <span className="row" style={{ gap: 4, alignItems: 'center', display: 'inline-flex', marginTop: 4 }}>
                        {/* staff tablet: 40px minimum tap targets for order edits */}
                        <button className="icon-btn" style={{ width: 40, height: 40 }} onClick={() => setOrderItemQty(tid, orderId, i, (it.qty || 1) - 1, { actor })} disabled={(it.qty || 1) <= 1}><Icon name="minus" size={15} /></button>
                        <span className="small bold num" style={{ minWidth: 16, textAlign: 'center' }}>{it.qty || 1}</span>
                        <button className="icon-btn" style={{ width: 40, height: 40 }} onClick={() => setOrderItemQty(tid, orderId, i, (it.qty || 1) + 1, { actor })}><Icon name="add" size={15} /></button>
                      </span>
                    )}
                  </div>
                  <span className="od-item-price price small num"><Price value={line} currency={currency} lang={lang} /></span>
                  {canVoid && <button className="icon-btn" style={{ width: 40, height: 40, color: 'var(--danger)', flex: 'none' }} title={ar ? 'حذف الصنف' : 'Void item'} onClick={() => { if (window.confirm(ar ? 'حذف هذا الصنف من الطلب؟' : 'Remove this item?')) voidOrderItem(tid, orderId, i, { actor }) }}><Icon name="delete" size={15} /></button>}
                </div>
              )
            })}
          </div>

          {/* edit an active order: add items + transfer table (running tab) */}
          {canEditOrder && (
            <div className="card card-pad stack" style={{ gap: 8 }}>
              <div className="row-between"><strong className="small">{ar ? 'تعديل الطلب' : 'Edit order'}</strong><button className="btn btn-sm btn-primary" onClick={() => setAddOpen(true)}><Icon name="add" size={14} /> {ar ? 'إضافة أصناف' : 'Add items'}</button></div>
              {tables.length > 0 && (
                <div className="stack" style={{ gap: 4 }}>
                  <span className="xs faint">{ar ? 'نقل لطاولة' : 'Move to table'}</span>
                  <div className="row" style={{ gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                    <button className={`btn btn-sm ${!o.tableId ? 'btn-primary' : 'btn-outline'}`} onClick={() => changeTable(null)}>{ar ? 'سفري' : 'Takeaway'}</button>
                    {tables.map((tb) => <button key={tb.id} className={`btn btn-sm ${o.tableId === tb.id ? 'btn-primary' : 'btn-outline'}`} style={{ whiteSpace: 'nowrap' }} onClick={() => changeTable(tb)}>{tb.label}</button>)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* staff: rate / flag the customer */}
          {staffActions && o.customerPhone && (
            <div className="card card-pad stack" style={{ gap: 8 }}>
              {cust?.flagged && <div className="badge badge-danger" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="warning" size={12} /> {ar ? 'انتبه لهذا العميل' : 'Careful with this guest'}{cust.flagNote ? `: ${cust.flagNote}` : ''}</div>}
              <div className="row" style={{ gap: 4, alignItems: 'center' }}>
                <span className="xs faint">{ar ? 'تقييم الموظف:' : 'Staff rating:'}</span>
                {[1, 2, 3, 4, 5].map((s) => (
                  <button key={s} className="icon-btn" style={{ width: 30, height: 30, color: (cust?.staffRating || 0) >= s ? 'var(--gold, #e0a82e)' : 'var(--text-faint)' }} onClick={() => saveFlag({ staffRating: s })} title={`${s}`}><Icon name="star" size={17} fill="currentColor" strokeWidth={1.4} /></button>
                ))}
                {cust?.staffRating ? <button className="icon-btn xs faint" style={{ width: 26, height: 26 }} onClick={() => saveFlag({ staffRating: 0 })} title={ar ? 'مسح' : 'Clear'}><Icon name="close" size={13} /></button> : null}
              </div>
              <label className="row-between" style={{ cursor: 'pointer', gap: 8 }}>
                <span className="small">{ar ? 'وسم العميل (تنبيه عند طلبه القادم)' : 'Tag (warn on next order)'}</span>
                <input type="checkbox" checked={!!cust?.flagged} onChange={(e) => saveFlag({ flagged: e.target.checked })} style={{ width: 20, height: 20 }} />
              </label>
              {cust?.flagged && <input className="input" placeholder={ar ? 'سبب الوسم (اختياري)' : 'Reason (optional)'} defaultValue={cust?.flagNote || ''} onBlur={(e) => saveFlag({ flagNote: e.target.value.trim() })} />}
            </div>
          )}

          {o.note && <div className="card card-pad"><span className="xs faint">{ar ? 'ملاحظة' : 'Note'}: </span><span className="small">{o.note}</span></div>}

          {/* money — one block, the total dominant */}
          <div className="od-money">
            {(o.discount > 0 || o.loyaltyDiscount > 0 || o.memberDiscount > 0 || o.compDiscount > 0) && o.subtotal != null && (
              <div className="od-money-row faint">
                <span>{ar ? 'المجموع قبل الخصم' : 'Subtotal'}</span>
                <span className="num"><Price value={o.subtotal} currency={currency} lang={lang} /></span>
              </div>
            )}
            {o.discount > 0 && (
              <div className="od-money-row" style={{ color: 'var(--success)' }}>
                <span>{ar ? 'خصم' : 'Discount'}</span>
                <span className="num">−<Price value={o.discount} currency={currency} lang={lang} /></span>
              </div>
            )}
            {o.loyaltyDiscount > 0 && (
              <div className="od-money-row" style={{ color: 'var(--success)' }}>
                <span>{ar ? 'خصم الولاء' : 'Loyalty'}</span>
                <span className="num">−<Price value={o.loyaltyDiscount} currency={currency} lang={lang} /></span>
              </div>
            )}
            {o.memberDiscount > 0 && (
              <div className="od-money-row" style={{ color: 'var(--success)' }}>
                <span>{ar ? 'خصم العضوية' : 'Membership'}</span>
                <span className="num">−<Price value={o.memberDiscount} currency={currency} lang={lang} /></span>
              </div>
            )}
            {o.compDiscount > 0 && (
              <div className="od-money-row" style={{ color: 'var(--success)' }}>
                <span>{ar ? 'مجاملة/خصم' : 'Comp'}{o.compReason ? ` · ${o.compReason}` : ''}{o.compByName ? ` · ${o.compByName}` : ''}</span>
                <span className="num">−<Price value={o.compDiscount} currency={currency} lang={lang} /></span>
              </div>
            )}
            <div className="od-money-row od-money-total">
              <span>{ar ? 'الإجمالي' : 'Total'}</span>
              <span className="price num"><Price value={o.total} currency={currency} lang={lang} /></span>
            </div>
          </div>

          {/* actions: print, digital receipt, manager refund / comp.
              printReceipt resolves false when the popup was blocked (TWA/strict
              browsers) — surface it, the old silent no-op read as a dead printer. */}
          {staffActions && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-outline grow" onClick={async () => { if (!(await printReceipt(o, { tenant, lang }))) toast.error(ar ? 'اسمح بالنوافذ المنبثقة لهذا الموقع لتعمل الطباعة' : 'Allow popups for this site so printing works') }}><Icon name="print" size={15} /> {ar ? 'طباعة' : 'Print'}</button>
              {o.status !== 'paid' && o.status !== 'cancelled' && o.status !== 'refunded' && <button className="btn btn-sm btn-outline grow" onClick={async () => { if (!(await printReceipt(o, { tenant, lang, proforma: true }))) toast.error(ar ? 'اسمح بالنوافذ المنبثقة لهذا الموقع لتعمل الطباعة' : 'Allow popups for this site so printing works') }}><Icon name="print" size={15} /> {ar ? 'حساب مبدئي' : 'Bill'}</button>}
              <button className="btn btn-sm btn-outline grow" onClick={genReceipt}><Icon name="qr" size={15} /> {ar ? 'إيصال رقمي' : 'Digital'}</button>
              {canPay && o.status === 'paid' && !o.refund && <button className="btn btn-sm btn-outline grow" style={{ color: 'var(--danger)' }} onClick={() => setRefundOpen(true)}><Icon name="repeat" size={15} /> {ar ? 'استرجاع' : 'Refund'}</button>}
              {canPay && ['pending', 'accepted', 'preparing', 'ready'].includes(o.status) && <button className="btn btn-sm btn-outline grow" onClick={() => setCompOpen(true)}><Icon name="offers" size={15} /> {ar ? 'مجاملة/خصم' : 'Comp'}</button>}
            </div>
          )}

          {staffActions && o.orderType === 'delivery' && (
            <div className="card card-pad stack" style={{ gap: 8 }}>
              <div className="row-between">
                <strong className="small row" style={{ gap: 6 }}><Icon name="car" size={16} /> {ar ? 'التوصيل والمندوب' : 'Delivery & driver'}</strong>
                <span className={`badge ${DSTAT[o.delivery?.status]?.cls || ''}`}>{ar ? (DSTAT[o.delivery?.status]?.ar || 'بانتظار مندوب') : (DSTAT[o.delivery?.status]?.en || 'Waiting')}</span>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select className="input" style={{ maxWidth: 220 }} value={o.delivery?.driverId || ''} onChange={(e) => {
                  const d = drivers.find((x) => (x.uid || x.id) === e.target.value)
                  assignDelivery(tid, orderId, d ? { uid: d.uid || d.id, name: d.name || d.displayName || '' } : null)
                }}>
                  <option value="">{ar ? 'بلا مندوب (متاح للاستلام)' : 'Unassigned (open pool)'}</option>
                  {drivers.map((d) => <option key={d.uid || d.id} value={d.uid || d.id}>{d.name || d.displayName || d.email}</option>)}
                </select>
                {o.delivery?.status && !['pending', 'delivered'].includes(o.delivery.status) && (
                  <button className="btn btn-sm btn-outline" onClick={() => setDeliveryStatus(tid, orderId, 'delivered')}><Icon name="check" size={14} /> {ar ? 'تم التسليم' : 'Delivered'}</button>
                )}
              </div>
              {o.delivery?.codCollected && (
                <div className="row-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, flexWrap: 'wrap', gap: 8 }}>
                  <span className="small">{ar ? 'نقد محصّل من المندوب' : 'Cash collected'}: <strong className="num"><Price value={o.delivery.codAmount || 0} currency={currency} lang={lang} /></strong>{o.delivery.codSettled ? <span className="badge badge-success" style={{ marginInlineStart: 6 }}>{ar ? 'مسوّى' : 'Settled'}</span> : null}</span>
                  {!o.delivery.codSettled && isManager && (
                    <button className="btn btn-sm btn-primary" onClick={async () => {
                      try {
                        await settleCod(tid, orderId)
                        // 'cancelled' is terminal too (rules deny cancelled→paid) — attempting
                        // it marked the drawer settled while the write silently died.
                        // paymentMethod, not payMethod: the field every reader uses.
                        if (!['paid', 'refunded', 'cancelled'].includes(o.status)) await updateOrderStatus(tid, orderId, 'paid', { paymentMethod: 'cash', _actor: actor })
                      } catch {
                        toast.error(ar ? 'ما تمّت التسوية. تأكد أن الطلب ما زال مفتوحاً ثم أعد المحاولة' : 'The settlement did not go through. Check that the order is still open and try again')
                      }
                    }}><Icon name="wallet" size={14} /> {ar ? 'تسوية العهدة (نقد)' : 'Settle (cash)'}</button>
                  )}
                </div>
              )}
              {drivers.length === 0 && <span className="xs faint">{ar ? 'لا يوجد مناديب بعد. أضِف موظفاً بدور «مندوب توصيل» من صفحة الفريق.' : 'No drivers yet. Add a staff member with the Driver role.'}</span>}
            </div>
          )}

          {receiptQr && (
            <div className="card card-pad stack center" style={{ gap: 8 }}>
              <img src={receiptQr} alt="QR" style={{ width: 176, height: 176 }} />
              <button className="btn btn-sm btn-outline" onClick={copyLink}>{copied ? (ar ? 'تم النسخ' : 'Copied') : (ar ? 'نسخ الرابط' : 'Copy link')}</button>
              <span className="xs faint" style={{ wordBreak: 'break-all', textAlign: 'center' }}>{receiptUrl}</span>
            </div>
          )}

          {/* audit log */}
          {Array.isArray(o.statusHistory) && o.statusHistory.length > 0 && (
            <details className="card card-pad">
              <summary className="small bold" style={{ cursor: 'pointer' }}>{ar ? 'سجل الطلب' : 'Audit log'}</summary>
              <div className="stack" style={{ gap: 4, marginTop: 8 }}>
                {o.statusHistory.map((h, i) => (
                  <div key={i} className="row-between xs faint">
                    <span>{statusLabel(h.status)}{h.by ? ` · ${h.by}` : ''}</span>
                    <span>{fmtClock(h.at)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      </Sheet>

      <Sheet open={refundOpen} onClose={() => setRefundOpen(false)} title={ar ? 'استرجاع' : 'Refund'}>
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <div className="field"><label>{ar ? 'المبلغ' : 'Amount'}</label><input className="input num" type="number" min="0" placeholder={o ? String(o.total) : ''} value={refundAmt} onChange={(e) => setRefundAmt(e.target.value)} /></div>
          <div className="field"><label>{ar ? 'السبب' : 'Reason'}</label><input className="input" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder={ar ? 'سبب الاسترجاع' : 'Refund reason'} /></div>
          <button className="btn btn-danger btn-block" onClick={doRefund}>{ar ? 'تأكيد الاسترجاع' : 'Confirm refund'}</button>
        </div>
      </Sheet>

      <Sheet open={compOpen} onClose={() => setCompOpen(false)} title={ar ? 'مجاملة / خصم' : 'Comp / discount'}>
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <div className="field"><label>{ar ? 'قيمة الخصم' : 'Discount amount'}</label><input className="input num" type="number" min="0" value={compAmt} onChange={(e) => setCompAmt(e.target.value)} /></div>
          <div className="field"><label>{ar ? 'السبب' : 'Reason'}</label><input className="input" value={compReason} onChange={(e) => setCompReason(e.target.value)} placeholder={ar ? 'سبب المجاملة' : 'Comp reason'} /></div>
          <button className="btn btn-primary btn-block" onClick={doComp}>{ar ? 'تطبيق الخصم' : 'Apply'}</button>
        </div>
      </Sheet>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={ar ? 'إضافة أصناف' : 'Add items'}>
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <input className="input" placeholder={ar ? 'بحث' : 'Search'} value={addQ} onChange={(e) => setAddQ(e.target.value)} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {menuItems.filter((i) => i.available !== false && (!addQ.trim() || `${i.nameAr || ''} ${i.nameEn || ''}`.toLowerCase().includes(addQ.trim().toLowerCase()))).map((it) => (
              <button key={it.id} className="card card-pad stack" style={{ gap: 2, alignItems: 'flex-start', textAlign: 'start', cursor: 'pointer' }} onClick={() => appendItem(it)}>
                <span className="xs bold" style={{ lineHeight: 1.2 }}>{pickLang(it, 'name', lang)}</span>
                <span className="price xs"><Price value={Number(it.price) || (it.variants?.[0] ? Number(it.variants[0].price) : 0)} currency={currency} lang={lang} /></span>
              </button>
            ))}
          </div>
          <p className="xs faint">{ar ? 'يُضاف بسعره الأساسي؛ للتخصيص المعقّد أنشئ طلباً جديداً من الكاشير.' : 'Added at base price; for complex options use a new POS order.'}</p>
        </div>
      </Sheet>
    </>
  )
}
