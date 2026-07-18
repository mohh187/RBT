// Audience segments — slice the venue base (by plan, new, idle, expired,
// enterprise) with live counts, preview the matching venues, and broadcast to a
// segment via the existing broadcast pipeline. Also a lightweight platform
// usage/health panel (venues + open issues + open errors).
import { useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchAllTenants, watchIssues, watchErrors } from '../../lib/platform.js'
import { buildSegments, estimateUsage, saveSegmentBroadcast } from '../../lib/platformSegments.js'
import { PlanBadge, StatusChip } from './shared.jsx'

export default function Segments() {
  const toast = useToast()
  const [tenants, setTenants] = useState(null)
  const [issues, setIssues] = useState([])
  const [errors, setErrors] = useState([])
  const [activeKey, setActiveKey] = useState('all')

  // broadcast composer state
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [push, setPush] = useState(true)
  const [days, setDays] = useState(14)
  const [busy, setBusy] = useState(false)

  useEffect(() => watchAllTenants(setTenants), [])
  useEffect(() => watchIssues(setIssues, { max: 200 }), [])
  useEffect(() => watchErrors(setErrors, 200), [])

  const segments = useMemo(() => buildSegments(tenants || []), [tenants])
  const active = useMemo(
    () => segments.find((s) => s.key === activeKey) || segments[0],
    [segments, activeKey],
  )
  const usage = useMemo(() => estimateUsage(tenants || []), [tenants])
  const openIssues = useMemo(() => issues.filter((i) => i.status !== 'closed' && i.status !== 'done').length, [issues])

  if (tenants === null) {
    return (
      <div className="page" style={{ display: 'grid', placeItems: 'center', minHeight: 240 }}>
        <Spinner />
      </div>
    )
  }

  const members = active?.members || []

  const broadcast = async (e) => {
    e.preventDefault()
    if (!title.trim() || !active) return
    const scopeTxt = active.plan
      ? `منشآت «${active.label}» (${members.length})`
      : `كل المنشآت — لا يمكن حصر البث بهذه الشريحة تلقائيًا`
    if (!window.confirm(`بث الإعلان إلى ${scopeTxt}${push ? ' + إشعار Push' : ''}. متابعة؟`)) return
    setBusy(true)
    try {
      const res = await saveSegmentBroadcast(active, { title: title.trim(), body: body.trim(), push, days })
      setTitle(''); setBody('')
      toast.success(
        res.scoped
          ? `أُرسل إلى شريحة «${active.label}» — تتولى المنصة التوزيع`
          : 'أُرسل لكل المنشآت (هذه الشريحة غير قابلة للحصر في خط البث)',
      )
    } catch {
      toast.error('تعذّر البث')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div>
        <h2 className="page-title">الشرائح والبث الموجّه</h2>
        <p className="muted small">قسّم قاعدة المنشآت إلى شرائح، عاين المطابقة، وابثّ لها مباشرة</p>
      </div>

      {/* platform usage / health */}
      <div className="stat-grid">
        <div className="stat">
          <span className="xs faint bold"><Icon name="store" size={13} /> إجمالي المنشآت</span>
          <strong className="num">{usage.venues}</strong>
          <span className="xs faint num">{usage.active} نشطة · {usage.suspended} موقوفة</span>
        </div>
        <div className="stat">
          <span className="xs faint bold"><Icon name="warning" size={13} /> تذاكر مفتوحة</span>
          <strong className="num" style={{ color: openIssues ? 'var(--warning)' : undefined }}>{openIssues}</strong>
        </div>
        <div className="stat">
          <span className="xs faint bold"><Icon name="warning" size={13} /> أخطاء مسجّلة</span>
          <strong className="num" style={{ color: errors.length ? 'var(--danger)' : undefined }}>{errors.length}</strong>
        </div>
        <div className="stat">
          <span className="xs faint bold"><Icon name="package" size={13} /> مستندات تقديرية</span>
          <strong className="num">≈ {usage.approxDocs.toLocaleString('en')}</strong>
        </div>
      </div>
      <p className="xs faint" style={{ marginTop: -8 }}>{usage.note}</p>

      {/* segment chips */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {segments.map((s) => (
          <button
            key={s.key}
            type="button"
            className="chip"
            onClick={() => setActiveKey(s.key)}
            style={s.key === activeKey ? { background: 'var(--brand)', color: 'var(--on-brand)', borderColor: 'var(--brand)' } : undefined}
          >
            <Icon name={s.icon} size={14} /> {s.label}
            <span className="num bold" style={{ marginInlineStart: 6 }}>{s.members.length}</span>
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* preview */}
        <div className="card card-pad stack grow" style={{ minWidth: 280 }}>
          <div className="row-between">
            <strong>{active?.label}</strong>
            <span className="badge badge-info num">{members.length} منشأة</span>
          </div>
          {members.length === 0 ? (
            <Empty icon="store" title="لا منشآت في هذه الشريحة" />
          ) : (
            <div className="divide" style={{ maxHeight: 420, overflowY: 'auto' }}>
              {members.map((t) => (
                <div key={t.id} className="row-between" style={{ padding: '8px 0', gap: 8 }}>
                  <div className="grow truncate" style={{ minWidth: 0 }}>
                    <div className="small bold truncate">{t.name || t.id}</div>
                    <div className="xs faint truncate">{t.ownerEmail || t.slug || t.id}</div>
                  </div>
                  <StatusChip tenant={t} />
                  <PlanBadge plan={t.plan} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* broadcast composer */}
        <form className="card card-pad stack" style={{ minWidth: 280, width: 340, maxWidth: '100%' }} onSubmit={broadcast}>
          <strong><Icon name="sound" size={15} /> بث لهذه الشريحة</strong>
          {!active?.plan ? (
            <p className="xs faint">
              هذه الشريحة (مثل الجديدة/الخاملة/المنتهية) لا يدعمها فلتر البث الأصلي؛ سيصل الإعلان لكل المنشآت.
              الشرائح المبنية على الباقة تُبثّ محصورة تمامًا.
            </p>
          ) : null}
          <input className="input" placeholder="عنوان الإعلان" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input" rows={4} placeholder="نص الإعلان…" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="row" style={{ gap: 8 }}>
            <label className="stack grow" style={{ gap: 4 }}>
              <span className="xs faint bold">يظهر لمدة (يوم)</span>
              <input type="number" className="input" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
            <label className="row" style={{ gap: 6, alignItems: 'center', alignSelf: 'flex-end', paddingBottom: 8 }}>
              <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />
              <span className="small bold">Push</span>
            </label>
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy || !title.trim()}>
            <Icon name="sound" size={16} /> {busy ? 'جارٍ البث…' : `بث إلى ${members.length} منشأة`}
          </button>
        </form>
      </div>
    </div>
  )
}
