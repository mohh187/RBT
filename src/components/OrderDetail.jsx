import { useEffect, useState } from 'react'
import { useI18n, pickLang } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { Price } from './Riyal.jsx'
import { watchOrder, getCustomerByPhone, setCustomerFlag, refundOrder, compOrder, voidOrderItem, setOrderItemQty, setOrderTable, addOrderItems, watchTables, watchItems, watchStaff, assignDelivery, setDeliveryStatus, settleCod, updateOrderStatus } from '../lib/db.js'

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

const STATUS_FLOW = ['pending', 'accepted', 'preparing', 'ready', 'served']

// Reusable full order view — opens any order (live) by id with all its details.
export default function OrderDetail({ tid, orderId, currency = 'SAR', onClose, staffActions = false }) {
  const { t, lang } = useI18n()
  const { profile, tenant, isManager, can } = useAuth()
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
  const doRefund = () => { if (!o) return; refundOrder(tid, orderId, { amount: Number(refundAmt) || o.total, reason: refundReason.trim(), actor, policy: resolveMembershipPolicy(tenant) }); setRefundOpen(false); setRefundAmt(''); setRefundReason('') }
  const doComp = () => { if (!o) return; compOrder(tid, orderId, { amount: Number(compAmt) || 0, reason: compReason.trim(), actor }); setCompOpen(false); setCompAmt(''); setCompReason('') }
  const canEditOrder = staffActions && ['pending', 'accepted', 'preparing', 'ready'].includes(o?.status)
  const changeTable = (tb) => setOrderTable(tid, orderId, tb ? { tableId: tb.id, tableLabel: tb.label, orderType: 'dine_in' } : { tableId: null, tableLabel: '', orderType: 'takeaway' })
  const appendItem = (it) => {
    const useVar = !Number(it.price) && it.variants?.[0] ? it.variants[0] : null
    const base = useVar ? Number(useVar.price) || 0 : Number(it.price) || 0
    const line = { itemId: it.id, nameAr: it.nameAr, nameEn: it.nameEn || '', variantLabel: useVar ? pickLang(useVar, 'name', lang) : '', variantKey: useVar?.key || '', modifiers: [], unitPrice: base, qty: 1, lineTotal: base, countsForLoyalty: it.countsForLoyalty !== false }
    addOrderItems(tid, orderId, [line], { actor })
  }

  const statusLabel = (s) => {
    const map = { pending: ar ? 'بانتظار' : 'Pending', accepted: ar ? 'مقبول' : 'Accepted', preparing: ar ? 'تحضير' : 'Preparing', ready: ar ? 'جاهز' : 'Ready', served: ar ? 'مُقدّم' : 'Served', paid: ar ? 'مدفوع' : 'Paid', cancelled: ar ? 'ملغى' : 'Cancelled' }
    return map[s] || s
  }
  const timelineStatus = o?.status === 'paid' ? 'served' : o?.status
  const typeLabel = (ty) => ty === 'curbside' ? (ar ? 'استلام بالسيارة' : 'Curbside') : ty === 'delivery' ? (ar ? 'توصيل' : 'Delivery') : ty === 'pickup' ? (ar ? 'استلام' : 'Pickup') : (ar ? 'داخل المقهى' : 'Dine-in')

  // Human duration from milliseconds (s / m / h).
  const fmtDur = (ms) => {
    if (ms == null || ms < 0) return '—'
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

  return (
    <>
      <Sheet open={!!orderId} onClose={onClose} title={o ? `${ar ? 'الطلب' : 'Order'} ${orderNumber(o.code)}` : (ar ? 'الطلب' : 'Order')}>
      {o === undefined ? (
        <p className="muted small">{t('loading') || '…'}</p>
      ) : o === null ? (
        <p className="muted small">{ar ? 'الطلب غير موجود' : 'Order not found'}</p>
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="row-between">
            <span className={`badge ${o.status === 'served' || o.status === 'paid' ? 'badge-success' : o.status === 'cancelled' ? 'badge-danger' : 'badge-gold'}`}>{statusLabel(o.status)}{o.status === 'served' && !o.paidOnline && o.paymentStatus !== 'paid' ? ` · ${ar ? 'غير مدفوع' : 'Unpaid'}` : ''}</span>
            <span className="xs faint">{timeAgo(o.createdAt, lang)}</span>
          </div>

          {/* status timeline — duration to reach each stage shown above its bar */}
          {o.status !== 'cancelled' && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 4, alignItems: 'flex-end' }}>
                {STATUS_FLOW.map((s, i) => {
                  const reached = STATUS_FLOW.indexOf(timelineStatus) >= i
                  const d = timing?.seg?.[s]
                  return (
                    <div key={s} className="grow stack center" style={{ gap: 3 }}>
                      <span style={{ fontSize: 'var(--fs-xs)', lineHeight: 1.1, minHeight: 13, fontWeight: 700, textAlign: 'center', color: d ? (d.live ? 'var(--gold, #e0a82e)' : 'var(--brand)') : 'transparent' }}>{d ? fmtDur(d.ms) : '·'}</span>
                      <div style={{ width: '100%', height: 4, borderRadius: 99, background: reached ? 'var(--brand)' : 'var(--surface-2)' }} />
                      <span className="xs" style={{ color: reached ? 'var(--brand)' : 'var(--text-faint)' }}>{statusLabel(s)}</span>
                    </div>
                  )
                })}
              </div>
              {timing?.totalMs != null && (
                <div className="row-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  <span className="xs faint">{ar ? 'من القبول للتسليم' : 'Accept → handover'}{timing.totalLive ? ` · ${ar ? 'جارٍ' : 'live'}` : ''}</span>
                  <span className="small bold" style={{ color: 'var(--brand)' }}>{fmtDur(timing.totalMs)}</span>
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
            {o.status !== 'paid' && (o.paidOnline || o.paymentStatus === 'paid') && <div className="xs bold" style={{ color: 'var(--success)' }}><Icon name="wallet" size={12} /> {ar ? 'مدفوع أونلاين — لا تُحصّل نقداً' : 'Paid online — do not collect cash'}</div>}
            {o.status !== 'paid' && !o.paidOnline && o.paymentStatus !== 'paid' && o.amountPaid > 0 && o.amountPaid < (o.total || 0) && <div className="xs" style={{ color: 'var(--gold, #e0a82e)' }}><Icon name="wallet" size={12} /> {ar ? 'مدفوع جزئياً' : 'Partial'}: <Price value={o.amountPaid} currency={currency} lang={lang} /> · {ar ? 'متبقّي' : 'left'} <Price value={(o.total || 0) - (o.amountPaid || 0)} currency={currency} lang={lang} /></div>}
            {o.refund && <div className="xs" style={{ color: 'var(--danger)' }}><Icon name="repeat" size={12} /> {ar ? 'استرجاع' : 'Refund'}: <Price value={o.refund.amount} currency={currency} lang={lang} />{o.refund.reason ? ` — ${o.refund.reason}` : ''}{o.refund.by ? ` · ${o.refund.by}` : ''}</div>}
            {o.cancelReason && <div className="xs" style={{ color: 'var(--danger)' }}><Icon name="close" size={12} /> {ar ? 'سبب الإلغاء' : 'Cancel reason'}: {o.cancelReason}</div>}
          </div>

          {/* items */}
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            <strong className="small">{ar ? 'الأصناف' : 'Items'}</strong>
            {(o.items || []).map((it, i) => {
              const nm = (lang === 'en' && it.nameEn ? it.nameEn : it.nameAr) || it.name || it.title || ''
              const mods = it.modifiers?.length ? it.modifiers.map((m) => (lang === 'en' && m.nameEn ? m.nameEn : m.nameAr)).filter(Boolean).join(' · ') : (Array.isArray(it.options) ? it.options.map((op) => op.name || op.label || op).join(' · ') : '')
              const line = it.lineTotal != null ? it.lineTotal : (it.unitPrice != null ? it.unitPrice : it.price || 0) * (it.qty || 1)
              const editable = staffActions && ['pending', 'accepted', 'preparing', 'ready'].includes(o.status)
              const canVoid = editable && (o.items || []).length > 1
              return (
                <div key={i} className="row-between" style={{ alignItems: 'flex-start', gap: 6 }}>
                  <div className="grow">
                    {editable ? (
                      <span className="row" style={{ gap: 4, alignItems: 'center', display: 'inline-flex' }}>
                        {/* staff tablet: 40px minimum tap targets for order edits */}
                        <button className="icon-btn" style={{ width: 40, height: 40 }} onClick={() => setOrderItemQty(tid, orderId, i, (it.qty || 1) - 1, { actor })} disabled={(it.qty || 1) <= 1}><Icon name="minus" size={15} /></button>
                        <span className="small bold" style={{ minWidth: 16, textAlign: 'center' }}>{it.qty || 1}</span>
                        <button className="icon-btn" style={{ width: 40, height: 40 }} onClick={() => setOrderItemQty(tid, orderId, i, (it.qty || 1) + 1, { actor })}><Icon name="add" size={15} /></button>
                        <span className="small">× {nm}{it.variantLabel ? ` · ${it.variantLabel}` : ''}</span>
                      </span>
                    ) : (
                      <><span className="small bold">{it.qty || 1}× </span><span className="small">{nm}{it.variantLabel ? ` · ${it.variantLabel}` : ''}</span></>
                    )}
                    {mods && <div className="xs faint">{mods}</div>}
                    {it.note && <div className="xs faint">{ar ? 'ملاحظة' : 'Note'}: {it.note}</div>}
                  </div>
                  <span className="price small"><Price value={line} currency={currency} lang={lang} /></span>
                  {canVoid && <button className="icon-btn" style={{ width: 40, height: 40, color: 'var(--danger)', marginInlineStart: 4 }} title={ar ? 'حذف الصنف' : 'Void item'} onClick={() => { if (window.confirm(ar ? 'حذف هذا الصنف من الطلب؟' : 'Remove this item?')) voidOrderItem(tid, orderId, i, { actor }) }}><Icon name="delete" size={15} /></button>}
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
              {cust?.flagged && <div className="badge badge-danger" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="warning" size={12} /> {ar ? 'عميل موسوم' : 'Tagged customer'}{cust.flagNote ? ` — ${cust.flagNote}` : ''}</div>}
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

          {o.compDiscount > 0 && (
            <div className="row-between xs" style={{ color: 'var(--success)' }}>
              <span>{ar ? 'مجاملة/خصم' : 'Comp/discount'}{o.compReason ? ` — ${o.compReason}` : ''}{o.compByName ? ` · ${o.compByName}` : ''}</span>
              <span>−<Price value={o.compDiscount} currency={currency} lang={lang} /></span>
            </div>
          )}
          <div className="row-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-2)' }}>
            <strong>{ar ? 'الإجمالي' : 'Total'}</strong>
            <span className="price bold" style={{ fontSize: 'var(--fs-md)' }}><Price value={o.total} currency={currency} lang={lang} /></span>
          </div>

          {/* actions: print, digital receipt, manager refund / comp */}
          {staffActions && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-outline grow" onClick={() => printReceipt(o, { tenant, lang })}><Icon name="print" size={15} /> {ar ? 'طباعة' : 'Print'}</button>
              {o.status !== 'paid' && o.status !== 'cancelled' && o.status !== 'refunded' && <button className="btn btn-sm btn-outline grow" onClick={() => printReceipt(o, { tenant, lang, proforma: true })}><Icon name="print" size={15} /> {ar ? 'حساب مبدئي' : 'Bill'}</button>}
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
                        if (!['paid', 'refunded'].includes(o.status)) await updateOrderStatus(tid, orderId, 'paid', { payMethod: 'cash', _actor: actor })
                      } catch { /* ignore */ }
                    }}><Icon name="wallet" size={14} /> {ar ? 'تسوية العهدة (نقد)' : 'Settle (cash)'}</button>
                  )}
                </div>
              )}
              {drivers.length === 0 && <span className="xs faint">{ar ? 'لا مناديب — أضِف موظفاً بدور «مندوب توصيل» من الفريق.' : 'No drivers yet — add a staff member with the Driver role.'}</span>}
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
