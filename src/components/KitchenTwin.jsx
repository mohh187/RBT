// «توأم المطبخ» — the guest's live mirror of the kitchen screen.
//
// The expo strikes lines one by one on the KDS (writes order.doneLines[index]);
// this reads exactly that map back, so the diner watches their own ticket being
// completed item by item. Snapshot-driven — no polling, no fake progress.
import { useEffect, useMemo, useState } from 'react'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { Spinner } from './ui.jsx'
import { watchOrder } from '../lib/db.js'

// Stage copy per order status. Anything unknown falls back to the neutral line.
function stageOf(status, ar) {
  switch (status) {
    case 'awaiting_payment': return { key: 'pay', text: ar ? 'بانتظار إتمام الدفع' : 'Waiting for payment', icon: 'card' }
    case 'pending': return { key: 'new', text: ar ? 'وصل طلبك إلى المطبخ' : 'Your order reached the kitchen', icon: 'receipt' }
    case 'accepted': return { key: 'ok', text: ar ? 'قُبل الطلب — سيبدأ التحضير' : 'Accepted — prep starts now', icon: 'check' }
    case 'preparing': return { key: 'cook', text: ar ? 'يُحضّر الآن…' : 'Cooking now…', icon: 'kitchen' }
    case 'ready': return { key: 'ready', text: ar ? 'طلبك جاهز!' : 'Your order is ready!', icon: 'bellRing' }
    case 'served': return { key: 'done', text: ar ? 'بالهناء والشفاء' : 'Enjoy your meal', icon: 'ok' }
    case 'cancelled': return { key: 'cancel', text: ar ? 'أُلغي هذا الطلب' : 'This order was cancelled', icon: 'no' }
    default: return { key: 'new', text: ar ? 'نتابع حالة طلبك' : 'Tracking your order', icon: 'clock' }
  }
}

const R = 26
const C = 2 * Math.PI * R

export default function KitchenTwin({ open, onClose, tenantId, orderId, lang = 'ar' }) {
  const ar = lang === 'ar'
  const [order, setOrder] = useState(undefined) // undefined = loading, null = unavailable
  const [everGot, setEverGot] = useState(false)

  useEffect(() => {
    if (!open || !tenantId || !orderId) return undefined
    setOrder(undefined)
    setEverGot(false)
    const off = watchOrder(tenantId, orderId, (o) => {
      if (o) setEverGot(true)
      setOrder(o || null)
    })
    return off
  }, [open, tenantId, orderId])

  const items = useMemo(() => (Array.isArray(order?.items) ? order.items : []), [order])
  const done = useMemo(() => items.filter((_, i) => order?.doneLines?.[i]).length, [items, order])
  const allDone = items.length > 0 && done === items.length
  const status = order?.status || ''
  const stage = stageOf(status, ar)
  // The ring shows LINE progress while cooking; a ready/served ticket is full
  // even if the expo bumped the whole order without striking each line.
  const ratio = status === 'ready' || status === 'served'
    ? 1
    : items.length ? done / items.length : 0

  const title = ar ? 'توأم المطبخ' : 'Kitchen twin'

  return (
    <Sheet open={open} onClose={onClose} title={title} tall>
      {order === undefined ? (
        <div className="tl-state"><Spinner lg /><p>{ar ? 'نتصل بشاشة المطبخ…' : 'Connecting to the kitchen screen…'}</p></div>
      ) : !order ? (
        <div className="tl-state">
          <Icon name="warning" size={22} />
          <p>{ar ? 'لا يمكن عرض حالة هذا الطلب الآن.' : 'This order status is unavailable right now.'}</p>
          <p className="tl-note">
            {everGot
              ? (ar ? 'أُغلق الطلب أو حُذف من النظام.' : 'The order was closed or removed.')
              : (ar ? 'قد يكون الطلب قديماً أو الاتصال منقطعاً — تحقق من الإنترنت وأعد المحاولة.' : 'The order may be old, or you are offline — check your connection and retry.')}
          </p>
        </div>
      ) : (
        <div className="kt-wrap">
          <div className={`kt-head kt-${stage.key}`}>
            <div className="kt-ring" role="img" aria-label={`${done} / ${items.length}`}>
              <svg viewBox="0 0 64 64" width="64" height="64">
                <circle className="kt-ring-bg" cx="32" cy="32" r={R} />
                <circle
                  className="kt-ring-fg"
                  cx="32" cy="32" r={R}
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - ratio)}
                />
              </svg>
              <span className="kt-ring-num">
                {allDone || ratio === 1 ? <Icon name="check" size={20} /> : `${done}/${items.length}`}
              </span>
            </div>
            <div className="grow">
              <div className="kt-stage"><Icon name={stage.icon} size={15} /> {stage.text}</div>
              <div className="kt-sub">
                {items.length
                  ? (ar ? `${done} من ${items.length} جاهز` : `${done} of ${items.length} ready`)
                  : (ar ? 'لا أصناف في هذا الطلب' : 'No items on this order')}
                {order.tableLabel ? ` · ${order.tableLabel}` : ''}
              </div>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="tl-state"><Icon name="notepad" size={22} /><p>{ar ? 'هذا الطلب بلا أصناف.' : 'This order has no items.'}</p></div>
          ) : (
            <ol className="kt-lines">
              {items.map((l, i) => {
                const isDone = !!order?.doneLines?.[i] || status === 'served'
                return (
                  <li key={i} className={`kt-line ${isDone ? 'is-done' : ''}`}>
                    <span className="kt-mark">
                      {isDone ? <Icon name="check" size={13} /> : <span className="kt-dot" />}
                    </span>
                    <span className="kt-qty">{Number(l.qty) || 1}</span>
                    <div className="grow">
                      <div className="kt-name">
                        {(!ar && l.nameEn) ? l.nameEn : l.nameAr}
                        {l.variantLabel ? <span className="kt-variant"> · {l.variantLabel}</span> : null}
                      </div>
                      {l.modifiers?.length ? (
                        <div className="kt-mods">{l.modifiers.map((m) => ((!ar && m.nameEn) ? m.nameEn : m.nameAr)).join(' · ')}</div>
                      ) : null}
                    </div>
                    <span className="kt-line-state">
                      {isDone ? (ar ? 'جاهز' : 'Ready') : (ar ? 'قيد التحضير' : 'In prep')}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}

          <p className="tl-note">
            {ar
              ? 'تتحدّث هذه الشاشة لحظياً مع شاشة المطبخ — كل سطر يُشطب فور اكتماله.'
              : 'This mirrors the kitchen screen live — each line is struck the moment it is done.'}
          </p>
        </div>
      )}
    </Sheet>
  )
}
