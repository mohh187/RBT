import { useEffect, useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase.js'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { useToast } from '../components/Toast.jsx'
import { FullSpinner } from '../components/ui.jsx'
import BrandMark from '../components/BrandMark.jsx'
import { startPayment } from '../lib/payments.js'
import { PLANS } from '../lib/plans.js'
import { normalizePlanConfig, promoOf, watchPricing, yearlyTotal } from '../lib/platformPricing.js'
import { Price } from '../components/Riyal.jsx'
import Icon from '../components/Icon.jsx'
import '../landing.css'

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
  // THE PRICE LIST THE SERVER BILLS FROM. This screen used to print
  // PLAN_PRICES out of src/lib/plans.js while startPlanSubscription derived the
  // real amount server-side — so an owner could pick a plan showing 549 and be
  // invoiced something else. On a page whose only job is to take money, the
  // displayed number and the charged number have to come from one place.
  const [pricing, setPricing] = useState(() => normalizePlanConfig(null))
  useEffect(() => watchPricing(setPricing), [])

  if (loading) return <FullSpinner />
  if (!user) return <Navigate to="/login" replace />
  if (!tenantId) return <Navigate to="/onboarding" replace />

  const offPct = Math.round((1 - (Number(pricing?.yearlyDiscount) || 0.8)) * 100)
  const monthlyOf = (id) => Number(pricing?.prices?.[id]) || 0
  const priceOf = (id) => (yearly ? yearlyTotal(monthlyOf(id), pricing) : monthlyOf(id))

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
        ? (ar ? 'الدفع الإلكتروني غير جاهز بعد، ابدأ بالتجربة المجانية 14 يوماً وسنفعّل الدفع قريباً' : 'Checkout is not ready yet, start the 14-day free trial')
        : msg)
      setBusy('')
    }
  }

  return (
    <div className="cpl" dir={ar ? 'rtl' : 'ltr'}>
      <div className="cpl-in">
        <div className="cpl-head">
          <BrandMark size={30} />
          <h1 className="cpl-h">{ar ? 'اختر باقة منشأتك' : 'Choose your plan'}</h1>
          <p className="cpl-sub">
            {tenant?.name ? `${tenant.name}, ` : ''}{ar ? 'ابدأ تجربة مجانية كاملة المزايا 14 يوماً، أو اشترك الآن وتُفعَّل باقتك لحظة الدفع.' : 'Start a full 14-day trial, or subscribe now.'}
          </p>
          <div className="cpl-cycle" role="group" aria-label={ar ? 'دورة الدفع' : 'Billing cycle'}>
            <button className={!yearly ? 'on' : ''} aria-pressed={!yearly} onClick={() => setYearly(false)}>{ar ? 'شهري' : 'Monthly'}</button>
            <button className={yearly ? 'on' : ''} aria-pressed={yearly} onClick={() => setYearly(true)}>
              {ar ? `سنوي (خصم ${offPct}%)` : `Yearly (-${offPct}%)`}
            </button>
          </div>
        </div>

        <div className="cpl-grid">
          {PLANS.map((p) => {
            const popular = p.id === 'pro'
            const promo = promoOf(p.id, pricing)
            // The struck original is shown in the SAME unit as the price next
            // to it — a yearly «before» beside a monthly «now» is arithmetic a
            // buyer notices at exactly the wrong moment.
            const was = promo ? (yearly ? yearlyTotal(promo.listPrice, pricing) : promo.listPrice) : 0
            return (
              <div key={p.id} className={`cpl-card ${popular ? 'feat' : ''}`}>
                {popular && <span className="cpl-tag">{ar ? 'الأكثر اختياراً' : 'Popular'}</span>}
                <div className="cpl-name">{ar ? p.ar : p.en}</div>
                <div className="cpl-price">
                  <Price value={priceOf(p.id)} lang={lang} symbolSize="0.58em" />
                  <span className="cpl-per">{ar ? (yearly ? '/ سنة' : '/ شهر') : (yearly ? '/ yr' : '/ mo')}</span>
                </div>
                {promo ? (
                  <div className="cpl-was">
                    <s><Price value={was} lang={lang} symbolSize="0.9em" /></s>
                    <span className="cut num">{promo.labelAr} {promo.discountPct}%</span>
                  </div>
                ) : null}
                <ul className="cpl-feats">
                  {TIER_FEATURES[p.id].map((f, i) => (
                    <li key={i}><Icon name="check" size={13} className="ic" /><span>{f}</span></li>
                  ))}
                </ul>
                <button className={`onb-btn ${popular ? '' : 'ghost'}`} disabled={!!busy} onClick={() => subscribe(p.id)}>
                  {busy === p.id ? (ar ? 'يفتح الدفع…' : 'Opening checkout…') : (ar ? 'اشترك وادفع الآن' : 'Subscribe now')}
                </button>
              </div>
            )
          })}
        </div>

        <button className="cpl-alt" onClick={() => navigate('/setup', { replace: true })}>
          {ar ? 'أو ابدأ التجربة المجانية 14 يوماً بكل المزايا' : 'Or start the full 14-day free trial'}
        </button>
        <p className="cpl-fine">
          {ar ? 'الأسعار بالريال السعودي ولا تشمل ضريبة القيمة المضافة، وتأتي من جدول الأسعار نفسه الذي يفوتر منه الخادم. الدفع عبر ميسر (بطاقة أو مدى أو Apple Pay) وتُفعَّل الباقة تلقائياً لحظة السداد مع فاتورة بريدية.' : 'Prices exclude VAT and come from the same table the server bills from. Moyasar checkout; the plan activates automatically on payment.'}
        </p>
      </div>
    </div>
  )
}
