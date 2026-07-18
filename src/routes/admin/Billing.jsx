import { useEffect, useState } from 'react'
import { collection, getDocs, query, where, limit } from 'firebase/firestore'
import { db } from '../../lib/firebase.js'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { Price } from '../../components/Riyal.jsx'
import { PLANS } from '../../lib/plans.js'

// «الفوترة والاشتراك» — the venue's money page: current plan, every subscription
// invoice (platformInvoices scoped to this tenant), purchased AI credits, and
// pending credit-purchase requests. Card management ships with direct checkout.

const fmtDate = (ts, lang) => {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  return d ? d.toLocaleDateString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB', { dateStyle: 'medium' }) : '—'
}

export default function Billing() {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const { tenantId, tenant } = useAuth()
  const [invoices, setInvoices] = useState(null)
  const [creditReqs, setCreditReqs] = useState([])

  useEffect(() => {
    if (!tenantId) return
    // where-only queries (no orderBy) → no composite index needed; sorted client-side.
    getDocs(query(collection(db, 'platformInvoices'), where('tenantId', '==', tenantId), limit(120)))
      .then((s) => setInvoices(s.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))))
      .catch(() => setInvoices([]))
    getDocs(query(collection(db, 'platformIssues'), where('tenantId', '==', tenantId), limit(60)))
      .then((s) => setCreditReqs(s.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((x) => (x.title || '').includes('شراء رصيد'))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))))
      .catch(() => {})
  }, [tenantId])

  const plan = PLANS.find((p) => p.id === (tenant?.plan || 'enterprise'))
  const planStatus = tenant?.planStatus || 'active'
  const expires = tenant?.planExpiresAt
  const aiExtra = Number(tenant?.aiExtra) || 0
  const STATUS = {
    paid: { ar: 'مدفوعة', cls: 'badge-success' },
    pending: { ar: 'بانتظار السداد', cls: 'badge-warning' },
    overdue: { ar: 'متأخرة', cls: 'badge-danger' },
    void: { ar: 'ملغاة', cls: '' },
  }

  return (
    <div className="page stack" style={{ gap: 'var(--sp-3)' }}>
      <h2 className="page-title row" style={{ gap: 8 }}><Icon name="wallet" size={22} /> {ar ? 'الفوترة والاشتراك' : 'Billing & subscription'}</h2>

      {/* current plan */}
      <div className="card card-pad stack" style={{ gap: 8 }}>
        <div className="row-between wrap" style={{ gap: 8 }}>
          <div className="stack" style={{ gap: 2 }}>
            <strong>{ar ? 'باقتك الحالية' : 'Current plan'}: <span style={{ color: 'var(--brand)' }}>{plan ? (ar ? plan.ar : plan.en || plan.ar) : tenant?.plan}</span></strong>
            <span className="xs faint">
              {planStatus === 'trial' ? (ar ? 'فترة تجريبية' : 'Trial') : planStatus === 'expired' ? (ar ? 'منتهية — جدّد للاستمرار' : 'Expired') : (ar ? 'نشطة' : 'Active')}
              {expires ? ` · ${ar ? 'حتى' : 'until'} ${fmtDate(expires, lang)}` : ''}
            </span>
          </div>
          <span className={`badge ${planStatus === 'expired' ? 'badge-danger' : planStatus === 'trial' ? 'badge-warning' : 'badge-success'}`}>{planStatus === 'trial' ? (ar ? 'تجريبي' : 'Trial') : planStatus === 'expired' ? (ar ? 'منتهٍ' : 'Expired') : (ar ? 'نشط' : 'Active')}</span>
        </div>
        {aiExtra > 0 && (
          <div className="row" style={{ gap: 6, alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <Icon name="zap" size={15} style={{ color: 'var(--brand)' }} />
            <span className="small">{ar ? 'رصيد الذكاء الإضافي المشترى:' : 'Purchased AI credits:'} <strong className="num">{aiExtra}</strong> {ar ? 'طلب' : 'requests'}</span>
          </div>
        )}
      </div>

      {/* payment methods — honest state */}
      <div className="card card-pad row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon name="card" size={18} className="faint" style={{ marginTop: 2 }} />
        <div className="stack" style={{ gap: 2 }}>
          <strong className="small">{ar ? 'وسائل الدفع' : 'Payment methods'}</strong>
          <span className="xs faint">{ar ? 'السداد حالياً عبر رابط دفع أو تحويل تعتمده إدارة المنصة على كل فاتورة. حفظ البطاقة والدفع المباشر بضغطة يُفعَّلان مع الخصم التلقائي القادم.' : 'Payment via a per-invoice link/transfer confirmed by the platform. Saved cards + one-tap pay arrive with auto-charge.'}</span>
        </div>
      </div>

      {/* invoices */}
      <strong className="small muted">{ar ? 'فواتير الاشتراك' : 'Subscription invoices'}</strong>
      {invoices === null ? <Spinner /> : invoices.length === 0 ? (
        <Empty icon="receipt" title={ar ? 'لا فواتير بعد' : 'No invoices yet'} hint={ar ? 'تصدر فواتير اشتراكك هنا تلقائياً كل دورة.' : 'Your subscription invoices appear here.'} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {invoices.map((inv) => {
            const st = STATUS[inv.status] || STATUS.pending
            return (
              <div key={inv.id} className="card card-pad row-between wrap" style={{ gap: 8 }}>
                <div className="stack" style={{ gap: 2 }}>
                  <strong className="small">{inv.no ? `#${inv.no}` : inv.id.slice(0, 6)} · {(PLANS.find((p) => p.id === inv.plan)?.ar) || inv.plan}{inv.period ? ` — ${inv.period}` : ''}</strong>
                  <span className="xs faint">{fmtDate(inv.createdAt, lang)}{inv.paidAt ? ` · ${ar ? 'سُددت' : 'paid'} ${fmtDate(inv.paidAt, lang)}` : ''}</span>
                </div>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="price bold"><Price value={inv.amount || 0} currency={inv.currency || 'SAR'} lang={lang} /></span>
                  <span className={`badge ${st.cls}`}>{ar ? st.ar : inv.status}</span>
                  {inv.payUrl && inv.status !== 'paid' && (
                    <a className="btn btn-sm btn-primary" href={inv.payUrl} target="_blank" rel="noreferrer">{ar ? 'ادفع الآن' : 'Pay now'}</a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* AI credit purchase requests */}
      {creditReqs.length > 0 && (
        <>
          <strong className="small muted">{ar ? 'طلبات شراء رصيد الذكاء' : 'AI credit purchases'}</strong>
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {creditReqs.map((r) => (
              <div key={r.id} className="card card-pad row-between wrap" style={{ gap: 8 }}>
                <div className="stack" style={{ gap: 2 }}>
                  <strong className="small">{r.title?.replace('[شراء رصيد ذكاء] ', '')}</strong>
                  <span className="xs faint">{fmtDate(r.createdAt, lang)}</span>
                </div>
                <span className={`badge ${r.status === 'resolved' ? 'badge-success' : 'badge-warning'}`}>{r.status === 'resolved' ? (ar ? 'فُعِّل الرصيد' : 'Activated') : (ar ? 'قيد الاعتماد' : 'Pending')}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
