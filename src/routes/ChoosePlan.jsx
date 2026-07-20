import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase.js'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { useToast } from '../components/Toast.jsx'
import { BrandMark, FullSpinner } from '../components/ui.jsx'
import { startPayment } from '../lib/payments.js'
import { PLANS, PLAN_PRICES, YEARLY_DISCOUNT } from '../lib/plans.js'
import Icon from '../components/Icon.jsx'

// Plan selection right after venue creation — the signup→payment bridge.
// «ابدأ التجربة» keeps today's behavior (full trial); a paid pick creates a
// SERVER-priced invoice (startPlanSubscription callable) then jumps into the
// inline Moyasar checkout; the payment webhook activates the plan automatically.
const TIER_FEATURES = {
  menu: ['منيو رقمي بثيمات كاملة', 'طلب QR من الطاولة', 'هوية وشعار وألوان', 'استوري وبروفايل المنشأة'],
  ops: ['كل مزايا «منيو»', 'كاشير ولوحة طلبات لحظية', 'شاشة المطبخ KDS', 'الطاولات والحجوزات والتوصيل'],
  pro: ['كل مزايا «منيو + تشغيل»', 'مكتبة الثيمات والاستوديو الكامل', 'دومين خاص وسب-دومين', 'شاشات العرض والقوالب'],
  enterprise: ['كل مزايا «احترافي»', 'الفريق والحضور والرواتب والأدوار الدقيقة', 'التقارير المتقدمة والتحليلات', 'مجسمات AR واقعية بالذكاء'],
}

export default function ChoosePlan() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const { user, tenantId, tenant, loading } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [yearly, setYearly] = useState(false)
  const [busy, setBusy] = useState('')

  if (loading) return <FullSpinner />
  if (!user) return <Navigate to="/login" replace />
  if (!tenantId) return <Navigate to="/onboarding" replace />

  const priceOf = (id) => (yearly ? Math.round(PLAN_PRICES[id] * 12 * YEARLY_DISCOUNT) : PLAN_PRICES[id])

  const subscribe = async (planId) => {
    setBusy(planId)
    try {
      const res = await httpsCallable(functions, 'startPlanSubscription')({ planId, yearly })
      const invoiceId = res?.data?.invoiceId
      if (!invoiceId) throw new Error(ar ? 'تعذر إنشاء الفاتورة' : 'Invoice failed')
      await startPayment('subscription', tenantId, invoiceId) // navigates to /pay/:id
    } catch (e) {
      // Friendly mapping: raw provider/config errors (moyasar:, not-found, …)
      // must never leak to a signing-up owner — offer the trial path instead.
      const msg = String(e?.message || e)
      const technical = /internal|moyasar|not.?found|not configured|MOYASAR/i.test(msg)
      toast.error(technical
        ? (ar ? 'الدفع الإلكتروني غير جاهز بعد — ابدأ بالتجربة المجانية 14 يوماً وسنفعّل الدفع قريباً' : 'Checkout is not ready yet — start the 14-day free trial')
        : msg)
      setBusy('')
    }
  }

  return (
    <div className="auth-shell" style={{ alignItems: 'flex-start', paddingTop: 32 }}>
      <div className="stack" style={{ width: 'min(1060px, 100%)', margin: '0 auto', gap: 18 }}>
        <div className="stack" style={{ alignItems: 'center', gap: 6, textAlign: 'center' }}>
          <BrandMark />
          <h2 style={{ fontSize: 'var(--fs-xl)', margin: 0 }}>{ar ? 'اختر باقة منشأتك' : 'Choose your plan'}</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {tenant?.name ? `${tenant.name} — ` : ''}{ar ? 'ابدأ تجربة مجانية كاملة المزايا 14 يوماً، أو اشترك الآن وتُفعَّل باقتك لحظة الدفع.' : 'Start a full 14-day trial, or subscribe now.'}
          </p>
          <div className="segmented" style={{ marginTop: 4 }}>
            <button className={!yearly ? 'active' : ''} onClick={() => setYearly(false)}>{ar ? 'شهري' : 'Monthly'}</button>
            <button className={yearly ? 'active' : ''} onClick={() => setYearly(true)}>{ar ? 'سنوي (خصم 20%)' : 'Yearly (-20%)'}</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
          {PLANS.map((p) => {
            const top = p.id === 'enterprise'
            const popular = p.id === 'pro'
            return (
              <div key={p.id} className="card card-pad stack" style={{ gap: 10, position: 'relative', border: top ? '2px solid var(--brand)' : undefined }}>
                {popular && <span className="badge badge-gold" style={{ position: 'absolute', top: 10, insetInlineEnd: 10 }}>{ar ? 'الأكثر اختياراً' : 'Popular'}</span>}
                {top && <span className="badge" style={{ position: 'absolute', top: 10, insetInlineEnd: 10, background: 'var(--brand)', color: 'var(--on-brand, #fff)' }}>{ar ? 'الأقوى' : 'Top'}</span>}
                <strong style={{ fontSize: 'var(--fs-lg)' }}>{ar ? p.ar : p.en}</strong>
                <div className="row" style={{ gap: 4, alignItems: 'baseline' }}>
                  <span className="num" style={{ fontSize: 26, fontWeight: 900, color: 'var(--brand)' }}>{priceOf(p.id)}</span>
                  <span className="xs faint">{ar ? `ر.س / ${yearly ? 'سنة' : 'شهر'}` : `SAR / ${yearly ? 'yr' : 'mo'}`}</span>
                </div>
                <ul className="stack" style={{ gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
                  {TIER_FEATURES[p.id].map((f, i) => (
                    <li key={i} className="row xs" style={{ gap: 6, alignItems: 'flex-start' }}>
                      <Icon name="check" size={13} style={{ color: 'var(--success)', flex: 'none', marginTop: 2 }} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <button className={`btn ${top || popular ? 'btn-primary' : 'btn-outline'} btn-block`} disabled={!!busy} onClick={() => subscribe(p.id)}>
                  {busy === p.id ? (ar ? 'يفتح الدفع…' : 'Opening checkout…') : (ar ? 'اشترك وادفع الآن' : 'Subscribe now')}
                </button>
              </div>
            )
          })}
        </div>

        <button className="btn btn-ghost" style={{ alignSelf: 'center' }} onClick={() => navigate('/setup', { replace: true })}>
          {ar ? 'أو ابدأ التجربة المجانية 14 يوماً بكل المزايا ←' : 'Or start the full 14-day free trial'}
        </button>
        <p className="xs faint" style={{ textAlign: 'center', margin: 0 }}>
          {ar ? 'الأسعار من جدول الخادم — الدفع عبر ميسر (بطاقة/مدى/Apple Pay) وتُفعَّل الباقة تلقائياً لحظة السداد مع فاتورة بريدية.' : 'Server-priced; Moyasar checkout; plan activates automatically on payment.'}
        </p>
      </div>
    </div>
  )
}
