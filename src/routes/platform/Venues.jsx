// All registered venues — search, subscription at a glance, quick suspend /
// activate, jump to the 360° detail view or the chat thread.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchAllTenants, setTenantActive } from '../../lib/platform.js'
import { PlanBadge, StatusChip, fmtWhen, promptSuspendReason } from './shared.jsx'

export default function Venues() {
  const toast = useToast()
  const [tenants, setTenants] = useState(null)
  const [qText, setQText] = useState('')
  const [filter, setFilter] = useState('all') // all | active | suspended | expired

  useEffect(() => watchAllTenants(setTenants), [])

  const rows = useMemo(() => {
    let list = tenants || []
    if (filter === 'active') list = list.filter((t) => t.active !== false)
    if (filter === 'suspended') list = list.filter((t) => t.active === false)
    if (filter === 'expired') list = list.filter((t) => t.planStatus === 'expired')
    const s = qText.trim().toLowerCase()
    if (s) list = list.filter((t) => (t.name || '').toLowerCase().includes(s) || (t.slug || '').toLowerCase().includes(s))
    return list
  }, [tenants, qText, filter])

  const [togglingId, setTogglingId] = useState('')
  const toggleActive = async (t) => {
    if (togglingId) return
    setTogglingId(t.id)
    try {
      if (t.active === false) {
        await setTenantActive(t.id, true)
        toast.success(`تم تفعيل «${t.name}»`)
      } else {
        const reason = promptSuspendReason(t.name || t.id)
        if (reason === null) return
        await setTenantActive(t.id, false, reason)
        toast.success(`تم إيقاف «${t.name}»`)
      }
    } catch (_) { toast.error('تعذّر تحديث حالة المنشأة — أعد المحاولة') }
    finally { setTogglingId('') }
  }

  if (tenants === null) return <Spinner />

  const FILTERS = [
    ['all', `الكل (${tenants.length})`],
    ['active', 'نشطة'],
    ['suspended', 'موقوفة'],
    ['expired', 'اشتراك منتهٍ'],
  ]

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      <div>
        <h2 className="page-title">المنشآت</h2>
        <p className="muted small">كل الحسابات المسجّلة على المنصة والتحكم الكامل بها</p>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          className="input grow"
          placeholder="بحث بالاسم أو الرابط…"
          value={qText}
          onChange={(e) => setQText(e.target.value)}
          style={{ minWidth: 180 }}
        />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(([id, label]) => (
            <button key={id} className={`btn ${filter === id ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter(id)} style={{ padding: '6px 12px' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty icon="store" title="لا نتائج" hint="جرّب بحثاً أو فلتراً مختلفاً" />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {rows.map((t) => (
            <div key={t.id} className="card card-pad row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {t.logoUrl ? (
                <img src={t.logoUrl} alt="" style={{ width: 38, height: 38, borderRadius: 10, objectFit: 'cover', flex: 'none' }} />
              ) : (
                <span className="dot" style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface-2, var(--bg))', display: 'grid', placeItems: 'center', flex: 'none' }}>
                  <Icon name="store" size={18} />
                </span>
              )}
              <div className="grow" style={{ minWidth: 140 }}>
                <Link to={`/platform/venues/${t.id}`} className="bold">{t.name || t.id}</Link>
                <div className="xs faint">/{t.slug} · {t.type || 'cafe'} · انضمت {fmtWhen(t.createdAt)}</div>
              </div>
              <PlanBadge plan={t.plan} />
              <StatusChip tenant={t} />
              <div className="row" style={{ gap: 10 }}>
                <Link to={`/platform/venues/${t.id}`} className="btn btn-outline" style={{ padding: '6px 10px', minWidth: 42, minHeight: 42 }} title="التفاصيل">
                  <Icon name="eye" size={16} />
                </Link>
                <Link to={`/platform/chat/${t.id}`} className="btn btn-outline" style={{ padding: '6px 10px', minWidth: 42, minHeight: 42 }} title="دردشة">
                  <Icon name="mail" size={16} />
                </Link>
                <button
                  className="btn btn-outline"
                  disabled={togglingId === t.id}
                  style={{ padding: '6px 10px', minWidth: 42, minHeight: 42, marginInlineStart: 4, color: t.active === false ? 'var(--success)' : 'var(--danger)' }}
                  onClick={() => toggleActive(t)}
                  title={t.active === false ? 'تفعيل الحساب' : 'إيقاف الحساب'}
                >
                  <Icon name={t.active === false ? 'ok' : 'no'} size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
