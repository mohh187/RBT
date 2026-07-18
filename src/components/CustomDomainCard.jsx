import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n.jsx'
import { useToast } from './Toast.jsx'
import Icon from './Icon.jsx'
import { PLATFORM_APEX, DOMAIN_CNAME_TARGET } from '../lib/domains.js'
import { watchVenueDomains, requestDomain, cancelDomainRequest, verifyDomainDns } from '../lib/venueDomains.js'
import { planAllows } from '../lib/plans.js'

// Venue self-serve: request a custom domain / subdomain, see status + DNS
// instructions, verify DNS (real DoH check), and cancel a pending request.
export default function CustomDomainCard({ tenant, tenantId }) {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const toast = useToast()
  const [domains, setDomains] = useState([])
  const type = 'custom' // subdomains are automatic now (resolved by slug) — only custom domains need a request
  const [host, setHost] = useState('')
  const [busy, setBusy] = useState(false)
  const [checks, setChecks] = useState({}) // host -> { ok, answers, loading }

  useEffect(() => { if (tenantId) return watchVenueDomains(tenantId, setDomains) }, [tenantId])

  const allowed = planAllows(tenant, 'customDomain')
  const slug = tenant?.slug || ''
  const suggestedSub = slug ? `${slug}.${PLATFORM_APEX}` : ''

  const submit = async () => {
    const h = (type === 'subdomain' && !host.trim()) ? suggestedSub : host.trim()
    if (!h) { toast.error(ar ? 'أدخل النطاق' : 'Enter a domain'); return }
    setBusy(true)
    try {
      await requestDomain(h, { tenantId, slug, type })
      toast.success(ar ? 'تم إرسال الطلب — نفعّله بعد جاهزية DNS' : 'Requested — we activate it once DNS is ready')
      setHost('')
    } catch (e) {
      const m = e?.message
      toast.error(m === 'invalid-host' ? (ar ? 'صيغة نطاق غير صحيحة' : 'Invalid host')
        : m === 'platform-host' ? (ar ? 'هذا نطاق المنصة' : 'That is a platform host')
          : (ar ? 'تعذّر الطلب' : 'Request failed'))
    } finally { setBusy(false) }
  }

  const verify = async (h) => {
    setChecks((c) => ({ ...c, [h]: { loading: true } }))
    const r = await verifyDomainDns(h)
    setChecks((c) => ({ ...c, [h]: r }))
    toast[r.ok ? 'success' : 'error'](r.ok ? (ar ? 'DNS موجّه بشكل صحيح' : 'DNS verified') : (ar ? 'DNS غير موجّه بعد' : 'DNS not pointing yet'))
  }

  const cancel = async (h) => {
    if (!window.confirm(ar ? 'إلغاء طلب هذا النطاق؟' : 'Cancel this request?')) return
    try { await cancelDomainRequest(h); toast.success(ar ? 'أُلغي' : 'Cancelled') } catch { toast.error(ar ? 'تعذّر (قد يكون مفعّلاً)' : 'Failed (may be active)') }
  }

  return (
    <div className="card card-pad stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <Icon name="share" size={18} style={{ color: 'var(--brand)' }} />
        <strong>{ar ? 'النطاق المخصّص' : 'Custom domain'}</strong>
      </div>
      <p className="xs faint" style={{ margin: 0 }}>{ar ? `اعرض منيوك على نطاقك الخاص (menu.مقهاك.com) أو نطاق فرعي (${suggestedSub || 'اسمك.' + PLATFORM_APEX}) بدل الرابط العام.` : `Serve your menu from your own domain or a ${PLATFORM_APEX} subdomain instead of the shared link.`}</p>

      {/* Automatic subdomain — live for every venue with zero setup (resolved by slug). */}
      {suggestedSub && (
        <div className="row-between" style={{ gap: 8, flexWrap: 'wrap', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="xs faint bold">{ar ? 'نطاقك الفرعي التلقائي — جاهز الآن' : 'Your automatic subdomain — live now'}</span>
            <a href={`https://${suggestedSub}`} target="_blank" rel="noreferrer" className="small bold" dir="ltr">{suggestedSub}</a>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <span className="badge badge-success">{ar ? 'نشط' : 'Active'}</span>
            <button className="btn btn-sm btn-outline" onClick={() => { navigator.clipboard?.writeText(`https://${suggestedSub}`).then(() => toast.success(ar ? 'نُسخ الرابط' : 'Copied')).catch(() => {}) }}><Icon name="copy" size={14} /> {ar ? 'نسخ' : 'Copy'}</button>
          </div>
        </div>
      )}

      {!allowed ? (
        <div className="badge badge-warning" style={{ alignSelf: 'flex-start' }}>{ar ? 'متاح في الباقة الاحترافية فأعلى' : 'Available on Pro and above'}</div>
      ) : (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field grow" style={{ minWidth: 200, marginBottom: 0 }}>
              <label>{ar ? 'نطاقك الخاص' : 'Your own domain'}</label>
              <input className="input" dir="ltr" placeholder="menu.yourcafe.com" value={host} onChange={(e) => setHost(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={submit} disabled={busy}><Icon name="add" size={15} /> {ar ? 'طلب' : 'Request'}</button>
          </div>

          {domains.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              {domains.map((d) => {
                const chk = checks[d.id]
                return (
                  <div key={d.id} className="stack" style={{ gap: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                    <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <a href={`https://${d.id}`} target="_blank" rel="noreferrer" className="small bold" dir="ltr">{d.id}</a>
                      <span className={`badge ${d.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{d.status === 'active' ? (ar ? 'نشط' : 'Active') : (ar ? 'قيد التفعيل' : 'Pending')}</span>
                    </div>
                    {d.status !== 'active' && d.type !== 'subdomain' && (
                      <div className="xs faint" style={{ lineHeight: 1.7 }}>
                        {ar ? 'أضف سجل CNAME عند مزوّد نطاقك:' : 'Add this CNAME at your domain registrar:'}
                        <div dir="ltr" style={{ fontFamily: 'monospace', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', marginTop: 4, wordBreak: 'break-all' }}>{d.id} &nbsp;CNAME&nbsp; {DOMAIN_CNAME_TARGET}</div>
                      </div>
                    )}
                    {d.status !== 'active' && d.type === 'subdomain' && <span className="xs faint">{ar ? 'لا حاجة لإعداد — نجهّزه ونفعّله قريباً.' : 'No setup needed — we configure and activate it.'}</span>}
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {d.type !== 'subdomain' && <button className="btn btn-sm btn-outline" onClick={() => verify(d.id)} disabled={chk?.loading}><Icon name="check" size={14} /> {chk?.loading ? (ar ? 'يفحص…' : 'Checking…') : (ar ? 'فحص DNS' : 'Verify DNS')}</button>}
                      {chk && !chk.loading && <span className="xs row" style={{ gap: 4, color: chk.ok ? 'var(--success)' : 'var(--danger)' }}>{chk.ok && <Icon name="check" size={12} />}{chk.ok ? (ar ? 'موجّه بشكل صحيح' : 'Pointing correctly') : (ar ? 'غير موجّه بعد' : 'Not pointing yet')}</span>}
                      {d.status !== 'active' && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)', marginInlineStart: 'auto' }} onClick={() => cancel(d.id)}>{ar ? 'إلغاء' : 'Cancel'}</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
