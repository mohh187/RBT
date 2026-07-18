import { useState } from 'react'
import { useToast } from './Toast.jsx'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { Price } from './Riyal.jsx'
import { openCashierSession, closeCashierSession } from '../lib/db.js'

// Cash-drawer session bar: open with a float, close with a count + auto reconciliation.
// `orders` = today's orders (paid ones since the session opened drive the totals).
export default function CashDrawer({ tid, lang = 'ar', actorName = '', uid = '', currency = 'SAR', session, orders = [] }) {
  const ar = lang === 'ar'
  const toast = useToast()
  const [openSheet, setOpenSheet] = useState(false)
  const [closeSheet, setCloseSheet] = useState(false)
  const [float0, setFloat0] = useState('')
  const [counted, setCounted] = useState('')

  const since = session?.openedAtMs || 0
  // attribute sales to THIS cashier (by name) since the session opened
  const settled = orders.filter((o) => (o.status === 'paid' || o.status === 'refunded') && (o.paidAtMs || 0) >= since && (!actorName || o.paidByName === actorName))
  const refundOf = (o) => (o.status === 'refunded' ? (o.refund?.amount || 0) : 0)
  const byMethod = settled.reduce((acc, o) => {
    if (o.paymentBreakdown) { // mixed: credit each method its share, refund off cash
      Object.entries(o.paymentBreakdown).forEach(([m, amt]) => { acc[m] = (acc[m] || 0) + (Number(amt) || 0) })
      if (refundOf(o)) acc.cash = (acc.cash || 0) - refundOf(o)
    } else {
      const m = o.paymentMethod || 'cash'
      acc[m] = (acc[m] || 0) + (o.total || 0) - refundOf(o)
    }
    return acc
  }, {})
  const cashSales = byMethod.cash || 0
  // Card machine (شبكة) — diner-intended 'card_terminal' plus cashier-settled 'card'.
  const cardSales = (byMethod.card || 0) + (byMethod.card_terminal || 0)
  const tipsTotal = settled.reduce((s, o) => s + (o.tip || 0), 0)
  const refundsTotal = settled.reduce((s, o) => s + refundOf(o), 0)
  const totalSales = settled.reduce((s, o) => s + (o.total || 0) - refundOf(o), 0)
  // Online prepaid sales this shift — attributed by time (no cashier); do NOT hit
  // the physical drawer, shown separately so the shift picture is complete.
  const onlineSales = orders.filter((o) => o.paidOnline === true && (o.paidAtMs || 0) >= since).reduce((s, o) => s + (o.total || 0) - refundOf(o), 0)
  const expectedCash = (session?.openingFloat || 0) + cashSales
  const variance = counted === '' ? null : (Number(counted) || 0) - expectedCash

  // Session open/close are money-critical: guard double-taps and surface failures.
  const [busy, setBusy] = useState(false)
  const doOpen = async () => {
    if (busy) return
    setBusy(true)
    try {
      await openCashierSession(tid, { openingFloat: Number(float0) || 0, actor: actorName, uid })
      setOpenSheet(false); setFloat0(''); toast?.success?.(ar ? 'تم فتح الدرج' : 'Drawer opened')
    } catch (_) { toast?.error?.(ar ? 'تعذّر فتح الوردية — أعد المحاولة' : 'Could not open the session — retry') }
    finally { setBusy(false) }
  }
  const doClose = async () => {
    if (busy) return
    setBusy(true)
    try {
      await closeCashierSession(tid, session.id, {
        closingCount: Number(counted) || 0, expectedCash, variance: variance || 0,
        cashSales, cardSales, onlineSales, totalSales, tips: tipsTotal, refunds: refundsTotal, byMethod, ordersCount: settled.length, closedByName: actorName,
      })
      setCloseSheet(false); setCounted(''); toast?.success?.(ar ? 'تم إغلاق الوردية' : 'Session closed')
    } catch (_) { toast?.error?.(ar ? 'تعذّر إغلاق الوردية — أعد المحاولة' : 'Could not close the session — retry') }
    finally { setBusy(false) }
  }

  return (
    <>
      {!session ? (
        <button className="btn btn-outline btn-block" onClick={() => setOpenSheet(true)}><Icon name="wallet" size={16} /> {ar ? 'افتح درج الكاشير' : 'Open cash drawer'}</button>
      ) : (
        <div className="card card-pad row-between" style={{ alignItems: 'center', gap: 8 }}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="small bold" style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} /> {ar ? 'الدرج مفتوح' : 'Drawer open'}{session.openedByName ? ` · ${session.openedByName}` : ''}</span>
            <span className="xs faint">{ar ? 'المبيعات' : 'Sales'}: <Price value={totalSales} currency={currency} lang={lang} /> · {settled.length} {ar ? 'طلب' : 'orders'}</span>
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => setCloseSheet(true)}>{ar ? 'إغلاق وجرد' : 'Close & count'}</button>
        </div>
      )}

      <Sheet open={openSheet} onClose={() => setOpenSheet(false)} title={ar ? 'فتح الدرج' : 'Open drawer'}>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="field"><label>{ar ? 'الرصيد الافتتاحي (نقدي)' : 'Opening float (cash)'}</label><input className="input num" type="number" min="0" value={float0} onChange={(e) => setFloat0(e.target.value)} /></div>
          <button className="btn btn-success btn-block" disabled={busy} onClick={doOpen}>{busy ? (ar ? 'جارٍ الفتح…' : 'Opening…') : (ar ? 'فتح الوردية' : 'Open session')}</button>
        </div>
      </Sheet>

      <Sheet open={closeSheet} onClose={() => setCloseSheet(false)} title={ar ? 'إغلاق الدرج وجرده' : 'Close & reconcile'}>
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <Row l={ar ? 'الرصيد الافتتاحي' : 'Opening float'} v={<Price value={session?.openingFloat || 0} currency={currency} lang={lang} />} />
          <Row l={ar ? 'مبيعات نقدية' : 'Cash sales'} v={<Price value={cashSales} currency={currency} lang={lang} />} />
          <Row l={ar ? 'شبكة (مدى/بطاقة)' : 'Card machine'} v={<Price value={cardSales} currency={currency} lang={lang} />} />
          {(byMethod.transfer || 0) > 0 && <Row l={ar ? 'تحويل' : 'Transfer'} v={<Price value={byMethod.transfer || 0} currency={currency} lang={lang} />} />}
          {onlineSales > 0 && <Row l={ar ? 'أونلاين (مدفوع مسبقاً)' : 'Online (prepaid)'} v={<Price value={onlineSales} currency={currency} lang={lang} />} />}
          <Row l={ar ? 'إكراميات' : 'Tips'} v={<Price value={tipsTotal} currency={currency} lang={lang} />} />
          {refundsTotal > 0 && <Row l={ar ? 'مستردّات' : 'Refunds'} v={<>−<Price value={refundsTotal} currency={currency} lang={lang} /></>} danger />}
          <Row l={ar ? 'النقد المتوقع بالدرج' : 'Expected cash'} v={<Price value={expectedCash} currency={currency} lang={lang} />} bold />
          <div className="field"><label>{ar ? 'النقد الفعلي المعدود' : 'Actual counted cash'}</label><input className="input num" type="number" value={counted} onChange={(e) => setCounted(e.target.value)} /></div>
          {variance !== null && <Row l={ar ? 'الفرق' : 'Variance'} v={<Price value={variance} currency={currency} lang={lang} />} bold danger={variance !== 0} />}
          <button className="btn btn-danger btn-block" style={{ minHeight: 44 }} disabled={busy} onClick={doClose}>{busy ? (ar ? 'جارٍ الإغلاق…' : 'Closing…') : (ar ? 'إغلاق الوردية' : 'Close session')}</button>
        </div>
      </Sheet>
    </>
  )
}

function Row({ l, v, bold, danger }) {
  return (
    <div className="row-between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
      <span className={bold ? 'small bold' : 'small'} style={{ color: danger ? 'var(--danger)' : undefined }}>{l}</span>
      <span className={bold ? 'price bold' : 'small'} style={{ color: danger ? 'var(--danger)' : undefined }}>{v}</span>
    </div>
  )
}
