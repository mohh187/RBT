// Platform — per-venue custom domains & subdomains. Map a hostname to a venue
// and activate it (after its DNS + SSL are ready). The public menu then resolves
// that hostname to the venue's menu at the root. Advanced plans only.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchAllTenants } from '../../lib/platform.js'
import { watchDomains, saveDomain, setDomainStatus, deleteDomain } from '../../lib/platformDomains.js'
import { PLATFORM_APEX, DOMAIN_CNAME_TARGET } from '../../lib/domains.js'
import { PlanBadge, fmtWhen } from './shared.jsx'

export default function Domains() {
  const toast = useToast()
  const [tenants, setTenants] = useState(null)
  const [domains, setDomains] = useState([])
  const [host, setHost] = useState('')
  const [tid, setTid] = useState('')
  const [type, setType] = useState('custom')
  const [busy, setBusy] = useState(false)

  useEffect(() => watchAllTenants(setTenants), [])
  useEffect(() => watchDomains(setDomains), [])

  const byId = useMemo(() => {
    const m = {}
    ;(tenants || []).forEach((t) => { m[t.id] = t })
    return m
  }, [tenants])

  if (tenants === null) return <Spinner />

  const selectedVenue = byId[tid]
  const suggestedSub = selectedVenue?.slug ? `${selectedVenue.slug}.${PLATFORM_APEX}` : ''

  const add = async () => {
    if (!host.trim() || !tid) { toast.error('أدخل النطاق واختر المنشأة'); return }
    setBusy(true)
    try {
      await saveDomain(host, { tenantId: tid, slug: selectedVenue?.slug || '', type, status: 'active' })
      toast.success('تم ربط النطاق وتفعيله')
      setHost('')
    } catch (e) {
      toast.error(e?.message || 'تعذّر الربط')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      <div>
        <h2 className="page-title">النطاقات المخصّصة</h2>
        <p className="muted small">اربط لكل منشأة (باقة متقدمة) نطاقها الخاص أو نطاقاً فرعياً — الباقة المجانية تبقى على {PLATFORM_APEX}/m/الاسم</p>
      </div>

      <div className="card card-pad stack" style={{ borderColor: 'var(--info)', gap: 6 }}>
        <p className="small"><Icon name="warning" size={14} style={{ verticalAlign: 'middle', color: 'var(--info)' }} /> قبل التفعيل: يوجّه صاحب النطاق سجل CNAME إلى منصّتنا وتُصدَر شهادة SSL (Cloudflare for SaaS أو نطاق Firebase مخصّص). يطلب المدير النطاق من إعداداته (يظهر هنا «قيد التفعيل») ثم تفعّله أنت.</p>
        <p className="xs faint" dir="ltr" style={{ margin: 0 }}>CNAME target: <span style={{ fontFamily: 'monospace' }}>{DOMAIN_CNAME_TARGET}</span> · apex: <span style={{ fontFamily: 'monospace' }}>{PLATFORM_APEX}</span></p>
      </div>

      {/* add / map */}
      <div className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
        <strong><Icon name="add" size={16} /> ربط نطاق بمنشأة</strong>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="stack grow" style={{ gap: 4, minWidth: 180 }}>
            <span className="xs faint bold">المنشأة</span>
            <select className="input" value={tid} onChange={(e) => setTid(e.target.value)}>
              <option value="">اختر منشأة…</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name || t.slug} ({t.plan || 'enterprise'})</option>)}
            </select>
          </label>
          <label className="stack" style={{ gap: 4, width: 150 }}>
            <span className="xs faint bold">النوع</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="custom">نطاق خاص بالمنشأة</option>
              <option value="subdomain">نطاق فرعي لنا</option>
            </select>
          </label>
          <label className="stack grow" style={{ gap: 4, minWidth: 200 }}>
            <span className="xs faint bold">النطاق (host)</span>
            <input className="input" placeholder={type === 'subdomain' ? suggestedSub || `venue.${PLATFORM_APEX}` : 'menu.venue.com'} value={host} onChange={(e) => setHost(e.target.value)} />
          </label>
        </div>
        {type === 'subdomain' && suggestedSub && (
          <button className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setHost(suggestedSub)}>استخدام {suggestedSub}</button>
        )}
        <button className="btn btn-primary" onClick={add} disabled={busy}><Icon name="check" size={16} /> ربط وتفعيل</button>
      </div>

      {/* list */}
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        {domains.length === 0 ? (
          <Empty icon="store" title="لا نطاقات مربوطة" hint="اربط أول نطاق مخصّص لمنشأة" />
        ) : domains.map((d) => (
          <div key={d.id} className="card card-pad row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="grow" style={{ minWidth: 160 }}>
              <a href={`https://${d.id}`} target="_blank" rel="noreferrer" className="bold" dir="ltr">{d.id}</a>
              <div className="xs faint">
                {byId[d.tenantId]?.name || d.tenantId} · {d.type === 'subdomain' ? 'نطاق فرعي' : 'نطاق خاص'} · {fmtWhen(d.createdAt)}
              </div>
            </div>
            {byId[d.tenantId] && <PlanBadge plan={byId[d.tenantId].plan} />}
            <span className={`badge ${d.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{d.status === 'active' ? 'نشط' : 'قيد التفعيل'}</span>
            <div className="row" style={{ gap: 6 }}>
              <Link to={`/platform/venues/${d.tenantId}`} className="btn btn-outline" style={{ padding: '6px 10px' }}><Icon name="eye" size={14} /></Link>
              {d.status === 'active'
                ? <button className="btn btn-outline" style={{ padding: '6px 10px', color: 'var(--warning)' }} onClick={() => setDomainStatus(d.id, 'pending')} title="تعطيل"><Icon name="no" size={14} /></button>
                : <button className="btn btn-outline" style={{ padding: '6px 10px', color: 'var(--success)' }} onClick={() => setDomainStatus(d.id, 'active')} title="تفعيل"><Icon name="ok" size={14} /></button>}
              <button className="btn btn-outline" style={{ padding: '6px 10px', color: 'var(--danger)' }} onClick={() => { if (window.confirm('حذف هذا النطاق؟')) deleteDomain(d.id) }}><Icon name="delete" size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
