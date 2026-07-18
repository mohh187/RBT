// Subscription control center — the packages matrix (what each tier unlocks)
// and full per-venue control: plan, status, expiry. Changes are logged to the
// activity feed and pushed to both sides by the Cloud Functions.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchAllTenants, setTenantPlan } from '../../lib/platform.js'
import { PLANS } from '../../lib/plans.js'
import { PlanBadge, StatusChip, toDateInput, fmtWhen } from './shared.jsx'

// Human matrix mirroring FEATURE_MIN in lib/plans.js (order 1..4).
const TIER_FEATURES = {
  menu: ['منيو رقمي QR', 'هوية وشعار وألوان', 'استقبال طلبات أساسية'],
  ops: ['كل مزايا «منيو»', 'كاشير ونقطة بيع', 'إدارة الطلبات والطاولات', 'شاشة المطبخ KDS', 'الحجوزات ونداء النادل'],
  pro: ['كل مزايا «منيو + تشغيل»', 'مكتبة الثيمات والسكنات', 'خلفيات وفيديو وعلامة مائية', 'تخصيص كامل للمظهر'],
  enterprise: ['كل مزايا «احترافي»', 'إدارة الموظفين الكاملة', 'الحضور بالسيلفي والجيوفنس', 'الأداء والرواتب والورديات', 'التقارير الكاملة والإعلانات'],
}

function VenueRow({ t, onSaved }) {
  const toast = useToast()
  const [plan, setPlan] = useState(t.plan || 'enterprise')
  const [status, setStatus] = useState(t.planStatus || 'active')
  const [expiry, setExpiry] = useState(toDateInput(t.planExpiresAt))
  // Re-sync local controls when this venue's doc changes from another screen
  // (e.g. VenueDetail / Chat panel), so the row never shows stale values.
  useEffect(() => {
    setPlan(t.plan || 'enterprise')
    setStatus(t.planStatus || 'active')
    setExpiry(toDateInput(t.planExpiresAt))
  }, [t.plan, t.planStatus, t.planExpiresAt])
  const dirty = plan !== (t.plan || 'enterprise') || status !== (t.planStatus || 'active') || expiry !== toDateInput(t.planExpiresAt)

  const save = async () => {
    try {
      await setTenantPlan(t.id, {
        plan, planStatus: status,
        planExpiresAt: expiry ? new Date(expiry + 'T23:59:59') : null,
      })
      toast.success(`تم تحديث اشتراك «${t.name}»`)
      onSaved?.()
    } catch {
      toast.error('تعذّر الحفظ')
    }
  }

  return (
    <div className="card card-pad row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <div className="grow" style={{ minWidth: 150 }}>
        <Link to={`/platform/venues/${t.id}`} className="bold">{t.name || t.id}</Link>
        <div className="xs faint">/{t.slug} · انضمت {fmtWhen(t.createdAt)}</div>
      </div>
      <StatusChip tenant={t} />
      <select className="input" style={{ width: 'auto' }} value={plan} onChange={(e) => setPlan(e.target.value)}>
        {PLANS.map((p) => <option key={p.id} value={p.id}>{p.ar}</option>)}
      </select>
      <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="active">فعّال</option>
        <option value="trial">تجريبي</option>
        <option value="expired">منتهٍ</option>
      </select>
      <input type="date" className="input" style={{ width: 'auto' }} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      <button className={`btn ${dirty ? 'btn-primary' : 'btn-outline'}`} style={{ padding: '6px 12px' }} disabled={!dirty} onClick={save}>
        <Icon name="check" size={15} /> حفظ
      </button>
    </div>
  )
}

export default function Subscriptions() {
  const [tenants, setTenants] = useState(null)
  const [planFilter, setPlanFilter] = useState('all')

  useEffect(() => watchAllTenants(setTenants), [])

  const byPlan = useMemo(() => {
    const m = { menu: 0, ops: 0, pro: 0, enterprise: 0 }
    ;(tenants || []).forEach((t) => { m[t.plan || 'enterprise'] = (m[t.plan || 'enterprise'] || 0) + 1 })
    return m
  }, [tenants])

  if (tenants === null) return <Spinner />

  const rows = planFilter === 'all' ? tenants : tenants.filter((t) => (t.plan || 'enterprise') === planFilter)

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div>
        <h2 className="page-title">الباقات والاشتراكات</h2>
        <p className="muted small">تقسيم المزايا حسب الباقة + التحكم الكامل في اشتراك كل منشأة</p>
      </div>

      {/* packages matrix */}
      <div className="menu-grid">
        {PLANS.map((p) => (
          <div key={p.id} className="card card-pad stack" style={{ gap: 8 }}>
            <div className="row-between">
              <strong>{p.ar}</strong>
              <PlanBadge plan={p.id} />
            </div>
            <div className="xs faint bold num">{byPlan[p.id] || 0} منشأة</div>
            <ul className="stack xs" style={{ gap: 4, paddingInlineStart: 16, margin: 0 }}>
              {TIER_FEATURES[p.id].map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
        ))}
      </div>

      {/* per-venue control */}
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className={`btn ${planFilter === 'all' ? 'btn-primary' : 'btn-outline'}`} style={{ padding: '5px 12px' }} onClick={() => setPlanFilter('all')}>
            الكل ({tenants.length})
          </button>
          {PLANS.map((p) => (
            <button key={p.id} className={`btn ${planFilter === p.id ? 'btn-primary' : 'btn-outline'}`} style={{ padding: '5px 12px' }} onClick={() => setPlanFilter(p.id)}>
              {p.ar} ({byPlan[p.id] || 0})
            </button>
          ))}
        </div>
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {rows.map((t) => <VenueRow key={t.id} t={t} />)}
        </div>
      </div>
    </div>
  )
}
