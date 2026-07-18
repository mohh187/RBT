import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { useI18n } from '../lib/i18n.jsx'

// Branded 404 — a dead end still points somewhere useful.
export default function NotFound() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const navigate = useNavigate()
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="stack" style={{ alignItems: 'center', gap: 14, textAlign: 'center', maxWidth: 420 }}>
        <span className="center" style={{ width: 72, height: 72, borderRadius: 22, background: 'var(--brand-soft, rgba(124,45,45,0.12))', color: 'var(--brand)' }}>
          <Icon name="search" size={34} />
        </span>
        <strong style={{ fontSize: 'var(--fs-xl, 24px)' }}>{ar ? 'الصفحة غير موجودة' : 'Page not found'}</strong>
        <p className="small faint" style={{ margin: 0 }}>
          {ar ? 'الرابط الذي فتحته غير صحيح أو تم نقل الصفحة. جرّب العودة أو الانتقال للوحة التحكم.' : 'The link is wrong or the page has moved. Go back or head to your dashboard.'}
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn btn-outline" onClick={() => navigate(-1)}><Icon name="back" size={15} /> {ar ? 'رجوع' : 'Back'}</button>
          <Link className="btn btn-primary" to="/admin">{ar ? 'لوحة التحكم' : 'Dashboard'}</Link>
          <Link className="btn btn-ghost" to="/">{ar ? 'الرئيسية' : 'Home'}</Link>
        </div>
      </div>
    </div>
  )
}
