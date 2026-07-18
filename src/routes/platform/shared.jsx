// Shared atoms for the platform console screens (Arabic-first internal tool).
import Icon from '../../components/Icon.jsx'
import { PLANS } from '../../lib/plans.js'

// Relative "when" label for Firestore Timestamps.
export function fmtWhen(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  if (!d) return ''
  const diff = Date.now() - d.getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return 'الآن'
  if (min < 60) return `قبل ${min} د`
  const h = Math.round(min / 60)
  if (h < 24) return `قبل ${h} س`
  return d.toLocaleDateString('ar-SA-u-nu-latn', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
}

export function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// Activity kinds → icon + label (mirrors what the Cloud Functions emit).
export const KINDS = {
  tenant: { icon: 'store', label: 'منشآت' },
  order: { icon: 'orders', label: 'طلبات' },
  complaint: { icon: 'complaint', label: 'شكاوى' },
  staff: { icon: 'staff', label: 'موظفون' },
  settings: { icon: 'settings', label: 'إعدادات' },
  subscription: { icon: 'wallet', label: 'اشتراكات' },
  chat: { icon: 'mail', label: 'دردشة' },
  error: { icon: 'warning', label: 'أخطاء' },
  issue: { icon: 'warning', label: 'تذاكر' },
}

const SEV_COLOR = { high: 'var(--danger)', warn: 'var(--gold)', info: 'var(--text-faint)' }

export function ActivityRow({ a, showTenant = true }) {
  const meta = KINDS[a.kind] || { icon: 'bell' }
  return (
    <div className="row" style={{ gap: 10, alignItems: 'flex-start', padding: '8px 0' }}>
      <span style={{ color: SEV_COLOR[a.severity] || SEV_COLOR.info, marginTop: 2, flex: 'none' }}>
        <Icon name={meta.icon} size={17} />
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="small bold">{a.title}</div>
        {a.body ? <div className="xs faint" style={{ wordBreak: 'break-word' }}>{a.body}</div> : null}
      </div>
      <div style={{ textAlign: 'start', flex: 'none' }}>
        {showTenant && a.tenantName ? <div className="xs bold">{a.tenantName}</div> : null}
        <div className="xs faint num">{fmtWhen(a.at)}</div>
      </div>
    </div>
  )
}

const PLAN_BADGE = { menu: '', ops: 'badge-info', pro: 'badge-gold', enterprise: 'badge-success' }
export function PlanBadge({ plan }) {
  const p = PLANS.find((x) => x.id === (plan || 'enterprise')) || PLANS[PLANS.length - 1]
  return <span className={`badge ${PLAN_BADGE[p.id] || ''}`}>{p.ar}</span>
}

export function StatusChip({ tenant }) {
  if (tenant.active === false) return <span className="badge badge-danger">موقوفة</span>
  if (tenant.planStatus === 'expired') return <span className="badge badge-warning">اشتراك منتهٍ</span>
  if (tenant.planStatus === 'trial') return <span className="badge badge-info">تجريبي</span>
  return <span className="badge badge-success">نشطة</span>
}

// Unified venue-suspension flow — one wording + reason prompt used by
// Venues, VenueDetail and Chat so the venue always sees a reason.
// Returns the reason string, or null when the admin cancels.
export function promptSuspendReason(name) {
  const reason = window.prompt(`سبب إيقاف «${name}»؟ (يظهر للمنشأة)`, 'تجميد إداري من المنصة')
  if (reason === null) return null
  return reason.trim() || 'تجميد إداري من المنصة'
}

// Firestore Timestamp | Date | string → value for <input type="date">.
export function toDateInput(v) {
  const d = v?.toDate ? v.toDate() : v ? new Date(v) : null
  if (!d || isNaN(d)) return ''
  return d.toISOString().slice(0, 10)
}
