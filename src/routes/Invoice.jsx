import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import { qrDataUrl } from '../lib/qr.js'
import { FullSpinner, Empty } from '../components/ui.jsx'
import { Price } from '../components/Riyal.jsx'
import Icon from '../components/Icon.jsx'

// Numbers/dates in Latin digits (hard rule) even under an Arabic locale.
const money = (n) => new Intl.NumberFormat('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)
function fmtDate(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  if (!d || isNaN(d)) return ''
  return d.toLocaleString('ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })
}
const KIND_AR = { order: 'طلب', ticket: 'تذكرة', booking: 'حجز' }

export default function Invoice() {
  const { tid, id } = useParams()
  const [rec, setRec] = useState(undefined)
  const [qr, setQr] = useState('')

  useEffect(() => {
    let alive = true
    getDoc(doc(db, 'tenants', tid, 'receipts', id))
      .then((s) => { if (alive) setRec(s.exists() ? { id: s.id, ...s.data() } : null) })
      .catch(() => { if (alive) setRec(null) })
    return () => { alive = false }
  }, [tid, id])

  useEffect(() => {
    if (rec?.zatca) qrDataUrl(rec.zatca, { width: 200 }).then(setQr).catch(() => {})
  }, [rec])

  if (rec === undefined) return <FullSpinner />
  if (!rec) return <div className="auth-shell"><Empty icon="search" title="الفاتورة غير موجودة" /></div>

  const currency = rec.currency || 'SAR'
  const refunded = rec.status === 'refunded'
  const hasVat = Number(rec.vat) > 0

  return (
    <div className="inv-page">
      <div className="inv-doc">
        <header className="inv-head">
          <div>
            <h1 className="inv-seller">{rec.seller?.name || 'rbt360'}</h1>
            {rec.seller?.phone && <div className="inv-sub">{rec.seller.phone}</div>}
            {rec.seller?.vatNumber && <div className="inv-sub">الرقم الضريبي: {rec.seller.vatNumber}</div>}
          </div>
          <div className="inv-meta">
            <span className={`inv-badge ${refunded ? 'is-refund' : 'is-paid'}`}>
              <Icon name={refunded ? 'repeat' : 'check'} size={14} /> {refunded ? 'مُسترجَعة' : 'مدفوعة'}
            </span>
            <div className="inv-no">فاتورة رقم {rec.no}</div>
            <div className="inv-sub">{fmtDate(rec.paidAt || rec.createdAt)}</div>
          </div>
        </header>

        <div className="inv-title">{rec.isTaxInvoice ? 'فاتورة ضريبية مبسطة' : 'إيصال دفع'}</div>

        {(rec.buyerName || rec.buyerPhone) && (
          <div className="inv-buyer">
            <span className="inv-sub">العميل</span>
            <span>{rec.buyerName}{rec.buyerPhone ? ` · ${rec.buyerPhone}` : ''}</span>
          </div>
        )}

        <div className="inv-lines">
          <div className="inv-row inv-row-head">
            <span>الوصف</span><span className="inv-qty">الكمية</span><span className="inv-amt">المبلغ</span>
          </div>
          {(rec.lines || []).map((l, i) => (
            <div className="inv-row" key={i}>
              <span>{l.name || (KIND_AR[rec.kind] || 'بند')}</span>
              <span className="inv-qty">{new Intl.NumberFormat('ar-SA-u-nu-latn').format(l.qty || 1)}</span>
              <span className="inv-amt"><Price value={l.total} currency={currency} lang="ar" /></span>
            </div>
          ))}
        </div>

        <div className="inv-totals">
          <div className="inv-trow"><span>المجموع الفرعي</span><span>{money(rec.subtotal)} {currency}</span></div>
          {hasVat && <div className="inv-trow"><span>شامل ض.ق.م ({new Intl.NumberFormat('ar-SA-u-nu-latn').format(rec.vatRate)}%)</span><span>{money(rec.vat)} {currency}</span></div>}
          <div className="inv-trow inv-grand"><span>الإجمالي</span><span><Price value={rec.total} currency={currency} lang="ar" /></span></div>
        </div>

        {refunded && rec.refund && (
          <div className="inv-refund">
            <Icon name="repeat" size={14} /> تم استرجاع {money(rec.refund.amount)} {currency}{rec.refund.reason ? ` — ${rec.refund.reason}` : ''}
          </div>
        )}

        {rec.zatca && qr && (
          <div className="inv-qr">
            <img src={qr} alt="ZATCA QR" width={112} height={112} />
            <span className="inv-sub">امسح للتحقّق (ZATCA)</span>
          </div>
        )}

        <footer className="inv-foot">
          <span className="inv-sub">
            {KIND_AR[rec.kind] || 'دفعة'}{rec.code ? ` #${rec.code}` : ''} · {rec.provider === 'moyasar' ? 'دفع إلكتروني' : rec.provider === 'cash' ? 'نقدي' : 'بطاقة'}
          </span>
          <span className="inv-sub">rbt360</span>
        </footer>

        {/* the invoice sheet is intentionally white — force dark ink on this button
            (theme tokens would render light-on-white in dark mode) */}
        <button className="btn btn-block no-print" style={{ marginTop: 16, background: '#fff', color: '#16181d', border: '1px solid #c9c9cf' }} onClick={() => window.print()}>
          <Icon name="print" size={16} /> طباعة / حفظ PDF
        </button>
      </div>

      <style>{`
        .inv-page{min-height:100dvh;display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;background:var(--bg,#f4f4f6)}
        .inv-doc{width:100%;max-width:520px;background:#fff;color:#16181d;border-radius:16px;padding:28px;border:1px solid #e7e7ea;box-shadow:0 8px 30px rgba(0,0,0,.06)}
        .inv-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
        .inv-seller{font-size:20px;font-weight:800;margin:0}
        .inv-sub{color:#6b6f76;font-size:12px}
        .inv-meta{text-align:end}
        .inv-no{font-weight:700;margin-top:6px}
        .inv-badge{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px}
        .inv-badge.is-paid{background:#e7f6ec;color:#1c7a44}
        .inv-badge.is-refund{background:#fdecec;color:#b3261e}
        .inv-title{text-align:center;font-weight:700;color:#6b6f76;margin:18px 0 10px;padding-bottom:10px;border-bottom:1px dashed #d9d9de}
        .inv-buyer{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px;font-size:14px}
        .inv-lines{border-top:1px solid #eee;border-bottom:1px solid #eee;padding:6px 0;margin-bottom:12px}
        .inv-row{display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;padding:7px 0;font-size:14px}
        .inv-row-head{color:#6b6f76;font-size:12px;font-weight:700}
        .inv-qty{min-width:44px;text-align:center}
        .inv-amt{min-width:80px;text-align:end}
        .inv-totals{margin-bottom:14px}
        .inv-trow{display:flex;justify-content:space-between;padding:4px 0;font-size:14px;color:#3a3d44}
        .inv-grand{font-weight:800;font-size:17px;color:#16181d;border-top:1px solid #16181d;margin-top:6px;padding-top:8px}
        .inv-refund{background:#fdecec;color:#b3261e;border-radius:10px;padding:10px 12px;font-size:13px;display:flex;align-items:center;gap:6px;margin-bottom:14px}
        .inv-qr{display:flex;flex-direction:column;align-items:center;gap:6px;margin:6px 0 14px}
        .inv-foot{display:flex;justify-content:space-between;gap:12px;border-top:1px dashed #d9d9de;padding-top:12px}
        @media print{
          .inv-page{background:#fff;padding:0}
          .inv-doc{box-shadow:none;border:none;max-width:none}
          .no-print{display:none}
          @page{margin:12mm}
        }
      `}</style>
    </div>
  )
}
