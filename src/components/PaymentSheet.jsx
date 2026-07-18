import { useState, useEffect } from 'react'
import Sheet from './Sheet.jsx'
import { Price } from './Riyal.jsx'

const METHODS = [
  { id: 'cash', ar: 'نقدي', en: 'Cash' },
  { id: 'card', ar: 'شبكة', en: 'Card' },
  { id: 'transfer', ar: 'تحويل', en: 'Transfer' },
  { id: 'mixed', ar: 'مختلط', en: 'Mixed' },
]
const TIPS = [0, 5, 10, 15]

// Confirm payment for an order: method + optional tip. onConfirm({ method, tip }).
export default function PaymentSheet({ open, onClose, order, currency = 'SAR', lang = 'ar', onConfirm }) {
  const ar = lang === 'ar'
  const [method, setMethod] = useState('cash')
  const [tip, setTip] = useState(0)
  const [adv, setAdv] = useState(false)
  const [people, setPeople] = useState(1)
  const [paidNow, setPaidNow] = useState('')
  const [mix, setMix] = useState({ cash: '', card: '', transfer: '' })
  useEffect(() => { if (open) { setMethod('cash'); setTip(0); setAdv(false); setPeople(1); setPaidNow(''); setMix({ cash: '', card: '', transfer: '' }) } }, [open])

  const base = order?.total || 0
  const already = order?.amountPaid || 0
  const due = Math.max(0, base - already) + (Number(tip) || 0)
  const perPerson = people > 1 ? due / people : null
  const isMixed = method === 'mixed'
  const mixSum = (Number(mix.cash) || 0) + (Number(mix.card) || 0) + (Number(mix.transfer) || 0)
  const partial = !isMixed && paidNow !== '' && (Number(paidNow) || 0) < due
  const confirmAmt = isMixed ? mixSum : (partial ? (Number(paidNow) || 0) : due)
  const mixShort = isMixed && mixSum < due

  return (
    <Sheet open={open} onClose={onClose} title={ar ? 'تأكيد الدفع' : 'Confirm payment'}>
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        {/* the amount to collect is THE number of this sheet — it must dominate */}
        <div className="row-between" style={{ alignItems: 'baseline' }}><span className="muted small">{ar ? 'المطلوب' : 'Due'}</span><span className="price bold" style={{ fontSize: 'var(--fs-2xl)' }}><Price value={due} currency={currency} lang={lang} /></span></div>
        {already > 0 && <div className="row-between xs faint"><span>{ar ? 'مدفوع سابقاً' : 'Already paid'}</span><Price value={already} currency={currency} lang={lang} /></div>}

        <div className="stack" style={{ gap: 4 }}>
          <label className="xs faint">{ar ? 'طريقة الدفع' : 'Payment method'}</label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {METHODS.map((m) => (
              <button key={m.id} className={`btn btn-sm ${method === m.id ? 'btn-primary' : 'btn-outline'}`} style={{ flex: '1 0 42%' }} onClick={() => setMethod(m.id)}>{ar ? m.ar : m.en}</button>
            ))}
          </div>
        </div>

        {isMixed && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 6 }}>
              <div className="field grow"><label className="xs">{ar ? 'نقدي' : 'Cash'}</label><input className="input num" type="number" value={mix.cash} onChange={(e) => setMix((m) => ({ ...m, cash: e.target.value }))} /></div>
              <div className="field grow"><label className="xs">{ar ? 'شبكة' : 'Card'}</label><input className="input num" type="number" value={mix.card} onChange={(e) => setMix((m) => ({ ...m, card: e.target.value }))} /></div>
              <div className="field grow"><label className="xs">{ar ? 'تحويل' : 'Transfer'}</label><input className="input num" type="number" value={mix.transfer} onChange={(e) => setMix((m) => ({ ...m, transfer: e.target.value }))} /></div>
            </div>
            <div className="row-between xs" style={{ color: mixShort ? 'var(--danger)' : 'var(--success)' }}><span>{ar ? 'المجموع' : 'Sum'} / {ar ? 'المطلوب' : 'due'}</span><span><Price value={mixSum} currency={currency} lang={lang} /> / <Price value={due} currency={currency} lang={lang} /></span></div>
          </div>
        )}

        <div className="stack" style={{ gap: 4 }}>
          <label className="xs faint">{ar ? 'إكرامية (اختياري)' : 'Tip (optional)'}</label>
          <div className="row" style={{ gap: 6 }}>
            {TIPS.map((tv) => (
              <button key={tv} className={`btn btn-sm grow ${Number(tip) === tv ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTip(tv)}>{tv === 0 ? (ar ? 'بدون' : 'None') : <Price value={tv} currency={currency} lang={lang} symbolSize="0.8em" />}</button>
            ))}
            <input className="input num" style={{ width: 72 }} type="number" min="0" value={tip} onChange={(e) => setTip(e.target.value)} />
          </div>
        </div>

        {!isMixed && <button className="btn btn-sm btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => setAdv((a) => !a)}>{ar ? 'تقسيم / دفعة جزئية' : 'Split / partial'}</button>}
        {!isMixed && adv && (
          <div className="stack" style={{ gap: 8, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
            <div className="field"><label>{ar ? 'تقسيم على (عدد الأشخاص)' : 'Split between (people)'}</label><input className="input num" type="number" min="1" value={people} onChange={(e) => setPeople(Math.max(1, Number(e.target.value) || 1))} /></div>
            {perPerson != null && <div className="row-between small"><span className="faint">{ar ? 'لكل شخص' : 'Per person'}</span><span className="price bold"><Price value={perPerson} currency={currency} lang={lang} /></span></div>}
            <div className="field"><label>{ar ? 'المدفوع الآن (للدفع الجزئي)' : 'Paid now (partial)'}</label><input className="input num" type="number" min="0" placeholder={String(due)} value={paidNow} onChange={(e) => setPaidNow(e.target.value)} /></div>
            {partial && <p className="xs" style={{ color: 'var(--warning)' }}>{ar ? `سيتبقّى ${(due - confirmAmt).toFixed(2)} ويبقى الطلب غير مكتمل الدفع.` : `Remaining ${(due - confirmAmt).toFixed(2)}; order stays partially paid.`}</p>}
          </div>
        )}

        <button className="btn btn-success btn-block" style={{ minHeight: 46, fontWeight: 800 }} disabled={mixShort} onClick={() => {
          const breakdown = isMixed ? Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => v > 0)) : null
          onConfirm?.({ method, tip: partial ? 0 : Number(tip) || 0, amountPaid: isMixed ? null : (paidNow === '' ? null : (Number(paidNow) || 0)), breakdown })
          onClose?.()
        }}>
          {mixShort ? (ar ? `ناقص ${(due - mixSum).toFixed(2)}` : `Short ${(due - mixSum).toFixed(2)}`) : partial ? (ar ? 'تسجيل دفعة' : 'Record payment') : (ar ? 'تأكيد الدفع' : 'Confirm')}{!mixShort ? <> · <Price value={confirmAmt} currency={currency} lang={lang} /></> : null}
        </button>
      </div>
    </Sheet>
  )
}
