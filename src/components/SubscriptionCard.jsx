import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n.jsx'
import { useToast } from './Toast.jsx'
import Icon from './Icon.jsx'
import { Price } from './Riyal.jsx'
import { watchInvoices } from '../lib/platformBilling.js'
import { startPayment } from '../lib/payments.js'
import { planLabel, planExpired } from '../lib/plans.js'

function fmtDate(ts, ar) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  if (!d) return '—'
  return d.toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { dateStyle: 'medium' })
}

// Venue-facing subscription status + pay-your-dues. Invoices are minted by the
// platform (generateMonthlyInvoices); paying redirects to the hosted Moyasar
// checkout and the webhook extends the plan.
export default function SubscriptionCard({ tenant, tenantId }) {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const toast = useToast()
  const [invoices, setInvoices] = useState([])
  const [paying, setPaying] = useState('')

  // Query by tenantId only (uses the existing tenantId+createdAt index) and filter
  // unpaid client-side — avoids a 3-field composite index that, if absent, would
  // silently render "no invoices due".
  useEffect(() => { if (tenantId) return watchInvoices(setInvoices, { tenantId }) }, [tenantId])
  const unpaid = invoices.filter((i) => i.status !== 'paid')

  const pay = async (inv) => {
    setPaying(inv.id)
    try { await startPayment('subscription', tenantId, inv.id) } catch (_) { setPaying(''); toast.error(ar ? 'تعذّر فتح صفحة الدفع' : 'Could not open payment') }
  }

  const expired = planExpired(tenant)
  const status = expired ? (ar ? 'منتهٍ' : 'Expired') : tenant?.planStatus === 'trial' ? (ar ? 'تجريبي' : 'Trial') : (ar ? 'فعّال' : 'Active')

  return (
    <div className="card card-pad stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <Icon name="wallet" size={18} style={{ color: 'var(--brand)' }} />
        <strong>{ar ? 'الاشتراك والفواتير' : 'Subscription & billing'}</strong>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="badge">{ar ? 'الباقة' : 'Plan'}: {planLabel(tenant, lang)}</span>
        <span className={`badge ${expired ? 'badge-danger' : tenant?.planStatus === 'trial' ? 'badge-warning' : 'badge-success'}`}>{status}</span>
        <span className="badge">{ar ? 'ينتهي' : 'Expires'}: {fmtDate(tenant?.planExpiresAt, ar)}</span>
      </div>

      {unpaid.length === 0 ? (
        <p className="xs faint" style={{ margin: 0 }}>{ar ? 'لا فواتير مستحقة حالياً.' : 'No invoices due.'}</p>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <strong className="small faint">{ar ? 'فواتير مستحقة' : 'Due invoices'}</strong>
          {unpaid.map((inv) => (
            <div key={inv.id} className="row-between" style={{ gap: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, flexWrap: 'wrap' }}>
              <div className="small">
                <div className="bold">{inv.period || (ar ? 'اشتراك' : 'Subscription')} · <Price value={inv.amount || 0} currency={inv.currency} lang={lang} /></div>
                <div className="xs faint">{ar ? 'غير مدفوعة' : 'Unpaid'}</div>
              </div>
              <button className="btn btn-sm btn-primary" disabled={paying === inv.id} onClick={() => pay(inv)}>
                <Icon name="wallet" size={14} /> {paying === inv.id ? '…' : (ar ? 'ادفع' : 'Pay')}
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="xs faint" style={{ margin: 0 }}>{ar ? 'يتطلّب الدفع الإلكتروني مُفعَّلاً ونشر الدوال.' : 'Requires online payment enabled + deployed functions.'}</p>
    </div>
  )
}
