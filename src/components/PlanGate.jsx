// Subscription gate — renders children only when the venue's plan includes
// the feature; otherwise a friendly upgrade notice. Used as a route wrapper
// (App.jsx) and inline for tab content (Settings appearance).
// Enforcement is UX-level; the platform console owns the plan fields
// (firestore.rules block tenant managers from editing them).
import { Link } from 'react-router-dom'
import Icon from './Icon.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { planAllows, planLabel, planExpired, PLANS, FEATURE_MIN } from '../lib/plans.js'

export function UpgradeNotice({ feature }) {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const { tenant, isManager, logout } = useAuth()
  const required = PLANS.find((p) => p.order === FEATURE_MIN[feature])
  const expired = planExpired(tenant)
  return (
    <div className="empty" style={{ padding: 'var(--sp-8) var(--sp-4)' }}>
      <div className="emoji"><Icon name="wallet" size={40} /></div>
      <p className="bold" style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>
        {expired
          ? (ar ? 'انتهى اشتراك المنشأة' : 'Your subscription has expired')
          : (ar ? 'هذه الميزة ضمن باقة أعلى' : 'This feature needs a higher plan')}
      </p>
      <p className="small" style={{ marginTop: 4 }}>
        {expired
          ? (ar ? 'جدّد الاشتراك لاستعادة كامل المزايا فوراً.' : 'Renew to restore all features instantly.')
          : ar
            ? `باقتك الحالية «${planLabel(tenant, 'ar')}»، وهذه الميزة تحتاج باقة «${required?.ar || ''}» أو أعلى.`
            : `Your plan is "${planLabel(tenant, 'en')}", and this feature needs "${required?.en || ''}" or higher.`}
      </p>
      {/* A lapsed plan drops /cashier and /kds, so a cashier or cook lands HERE.
          The support link is manager-gated, and every hop in uses replace, so
          without these two they had no way back and no way out of the PWA. */}
      <div className="row" style={{ marginTop: 'var(--sp-4)', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {isManager ? (
          <Link to="/admin/support" className="btn btn-primary">
            <Icon name="mail" size={16} /> {expired ? (ar ? 'جدّد الاشتراك، تواصل معنا' : 'Renew, contact us') : (ar ? 'ارفع باقتك، تواصل معنا' : 'Upgrade, contact us')}
          </Link>
        ) : (
          <Link to="/portal" className="btn btn-primary">
            <Icon name="home" size={16} /> {ar ? 'ارجع لشاشتك' : 'Back to your screen'}
          </Link>
        )}
        <button className="btn btn-outline" onClick={() => logout?.()}>
          <Icon name="logout" size={16} /> {ar ? 'تسجيل الخروج' : 'Sign out'}
        </button>
      </div>
    </div>
  )
}

export default function PlanGate({ feature, children }) {
  const { tenant, loading } = useAuth()
  if (loading) return null
  if (planAllows(tenant, feature)) return children
  return <UpgradeNotice feature={feature} />
}
