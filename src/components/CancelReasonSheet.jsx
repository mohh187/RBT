import { useState, useEffect } from 'react'
import Sheet from './Sheet.jsx'

// Cancellation with a mandatory reason. onConfirm({ reason, noShow }).
export default function CancelReasonSheet({ open, onClose, lang = 'ar', onConfirm }) {
  const ar = lang === 'ar'
  const REASONS = [
    { id: 'customer_request', ar: 'طلب العميل', en: 'Customer request', noShow: false },
    { id: 'no_show', ar: 'العميل لم يحضر', en: 'Customer no-show', noShow: true },
    { id: 'out_of_stock', ar: 'نفاد صنف', en: 'Out of stock', noShow: false },
    { id: 'wrong_order', ar: 'طلب خاطئ', en: 'Wrong order', noShow: false },
    { id: 'duplicate', ar: 'طلب مكرّر', en: 'Duplicate order', noShow: false },
    { id: 'other', ar: 'سبب آخر', en: 'Other', noShow: false },
  ]
  const [sel, setSel] = useState(null)
  const [note, setNote] = useState('')
  useEffect(() => { if (open) { setSel(null); setNote('') } }, [open])

  const confirm = () => {
    const r = REASONS.find((x) => x.id === sel)
    const label = r ? (ar ? r.ar : r.en) : ''
    const reason = `${label}${note ? ` — ${note}` : ''}`.trim()
    onConfirm?.({ reason, noShow: !!r?.noShow })
    onClose?.()
  }

  return (
    <Sheet open={open} onClose={onClose} title={ar ? 'سبب الإلغاء' : 'Cancellation reason'}>
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        <p className="xs faint">{ar ? 'يُسجَّل السبب في سجل الطلب للمراجعة.' : 'The reason is recorded in the order audit log.'}</p>
        {REASONS.map((r) => (
          <button key={r.id} className={`btn btn-block ${sel === r.id ? 'btn-primary' : 'btn-outline'}`} onClick={() => setSel(r.id)}>{ar ? r.ar : r.en}</button>
        ))}
        <input className="input" placeholder={ar ? 'ملاحظة (اختياري)' : 'Note (optional)'} value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn-danger btn-block" style={{ minHeight: 44 }} disabled={!sel} onClick={confirm}>{ar ? 'تأكيد الإلغاء' : 'Confirm cancel'}</button>
      </div>
    </Sheet>
  )
}
