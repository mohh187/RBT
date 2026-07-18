// Growth console — onboarding funnel, NPS, acquisition sources, and status
// incidents (which surface on the public /status page). All data lives in the
// growth collections (platformOnboarding / platformNps / platformReferrals /
// platformStatus) plus tenant.source read via watchAllTenants.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchAllTenants } from '../../lib/platform.js'
import { fmtWhen } from './shared.jsx'
import {
  ONBOARDING_STEPS, watchOnboarding, setOnboardingStep, completion,
  watchNps, npsScore, npsDistribution,
  watchReferrals, acquisitionBreakdown,
  watchStatus, saveStatusIncident, overallStatus, STATUS_LEVELS,
} from '../../lib/platformGrowth.js'

const TABS = [
  { id: 'onboarding', ar: 'التهيئة', icon: 'check' },
  { id: 'nps', ar: 'رضا العملاء', icon: 'star' },
  { id: 'acquisition', ar: 'مصادر النمو', icon: 'trending' },
  { id: 'status', ar: 'حالة النظام', icon: 'warning' },
]

export default function Growth() {
  const [tab, setTab] = useState('onboarding')
  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div>
        <h2 className="page-title">النمو والتهيئة</h2>
        <p className="muted small">قمع التهيئة، رضا العملاء (NPS)، مصادر النمو، وحالة النظام العامة</p>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setTab(t.id)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <Icon name={t.icon} size={14} /> {t.ar}
          </button>
        ))}
      </div>

      {tab === 'onboarding' && <OnboardingTab />}
      {tab === 'nps' && <NpsTab />}
      {tab === 'acquisition' && <AcquisitionTab />}
      {tab === 'status' && <StatusTab />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Onboarding                                                          */
/* ------------------------------------------------------------------ */
function OnboardingTab() {
  const [tenants, setTenants] = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => watchAllTenants(setTenants), [])

  if (tenants === null) return <Spinner />
  if (!tenants.length) return <Empty icon="store" title="لا توجد منشآت بعد" hint="ستظهر قائمة التهيئة بعد أول تسجيل" />

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      {selected ? (
        <OnboardingEditor
          tenant={tenants.find((t) => t.id === selected) || null}
          onBack={() => setSelected(null)}
        />
      ) : (
        <div className="card stack" style={{ gap: 0 }}>
          {tenants.map((t) => <OnboardingRow key={t.id} tenant={t} onOpen={() => setSelected(t.id)} />)}
        </div>
      )}
    </div>
  )
}

function OnboardingRow({ tenant, onOpen }) {
  const [ob, setOb] = useState(undefined)
  useEffect(() => watchOnboarding(tenant.id, setOb), [tenant.id])
  const { pct, source } = completion(tenant, ob || null)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="list-row row-between"
      style={{ gap: 10, width: '100%', background: 'none', border: 'none', textAlign: 'inherit', cursor: 'pointer', padding: 'var(--sp-3) var(--sp-4)' }}
    >
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="small bold truncate">{tenant.name || tenant.id}</div>
        <div className="xs faint">/{tenant.slug || tenant.id} · {source === 'doc' ? 'قائمة محفوظة' : 'مُستنتَج من البيانات'}</div>
      </div>
      <div style={{ width: 120, flex: 'none' }}>
        <div style={{ height: 8, borderRadius: 99, background: 'var(--surface-2, var(--border))', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.max(3, pct)}%`, background: pct >= 100 ? 'var(--success)' : 'var(--brand)', borderRadius: 99 }} />
        </div>
      </div>
      <span className="small num bold" style={{ width: 42, textAlign: 'end', flex: 'none' }}>{pct}%</span>
      <Icon name="next" size={16} />
    </button>
  )
}

function OnboardingEditor({ tenant, onBack }) {
  const toast = useToast()
  const [ob, setOb] = useState(undefined)
  const [saving, setSaving] = useState('')
  useEffect(() => {
    if (!tenant) return
    return watchOnboarding(tenant.id, setOb)
  }, [tenant?.id])

  if (!tenant) return <Empty icon="store" title="المنشأة غير متاحة" />
  if (ob === undefined) return <Spinner />

  const { steps, pct, source } = completion(tenant, ob || null)

  const toggle = async (key) => {
    setSaving(key)
    try {
      await setOnboardingStep(tenant.id, key, !steps[key])
      toast.success('تم التحديث')
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setSaving('')
    }
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={onBack}>
        <Icon name="back" size={14} /> رجوع للقائمة
      </button>

      <div className="card card-pad stack" style={{ gap: 'var(--sp-4)' }}>
        <div className="row-between">
          <div>
            <Link to={`/platform/venues/${tenant.id}`} className="bold">{tenant.name || tenant.id}</Link>
            <div className="xs faint">/{tenant.slug || tenant.id}</div>
          </div>
          <span className="badge badge-info num">{pct}%</span>
        </div>
        {source === 'inferred' && (
          <p className="xs faint">لم تُحفظ قائمة تهيئة بعد — الحالات الحالية مُستنتَجة من بيانات المنشأة. أي تعديل هنا ينشئ قائمة محفوظة.</p>
        )}
        <div className="stack" style={{ gap: 8 }}>
          {ONBOARDING_STEPS.map((s) => {
            const done = !!steps[s.key]
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggle(s.key)}
                disabled={saving === s.key}
                className="row"
                style={{
                  gap: 10, alignItems: 'center', padding: 'var(--sp-3)', cursor: 'pointer',
                  border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                  background: done ? 'color-mix(in srgb, var(--success) 10%, transparent)' : 'var(--surface)',
                  textAlign: 'inherit', width: '100%',
                }}
              >
                <span style={{
                  width: 24, height: 24, borderRadius: 99, flex: 'none',
                  display: 'grid', placeItems: 'center',
                  background: done ? 'var(--success)' : 'var(--surface-2, var(--border))',
                  color: done ? 'var(--on-brand, #fff)' : 'var(--text-faint)',
                }}>
                  <Icon name={done ? 'check' : 'clock'} size={14} />
                </span>
                <span className="small bold grow">{s.ar}</span>
                <span className={`badge ${done ? 'badge-success' : ''}`}>{done ? 'مكتمل' : 'قيد الانتظار'}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* NPS                                                                 */
/* ------------------------------------------------------------------ */
function NpsTab() {
  const [responses, setResponses] = useState(null)
  useEffect(() => watchNps(setResponses), [])

  const score = useMemo(() => npsScore(responses || []), [responses])
  const dist = useMemo(() => npsDistribution(responses || []), [responses])

  if (responses === null) return <Spinner />

  const scoreColor = score >= 50 ? 'var(--success)' : score >= 0 ? 'var(--gold)' : 'var(--danger)'

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="card card-pad row" style={{ gap: 'var(--sp-5)', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="num bold" style={{ fontSize: 44, lineHeight: 1, color: scoreColor }}>{score}</div>
          <div className="xs faint">مؤشر NPS</div>
        </div>
        <div className="grow" style={{ minWidth: 200 }}>
          <Bar label="مروّجون (9-10)" pct={dist.pPromoters} count={dist.promoters} color="var(--success)" />
          <Bar label="محايدون (7-8)" pct={dist.pPassives} count={dist.passives} color="var(--gold)" />
          <Bar label="منتقدون (0-6)" pct={dist.pDetractors} count={dist.detractors} color="var(--danger)" />
          <div className="xs faint" style={{ marginTop: 6 }}>{dist.total} استجابة</div>
        </div>
      </div>

      <div className="card card-pad stack">
        <strong className="small"><Icon name="message" size={14} /> أحدث الاستجابات</strong>
        {(!responses.length) ? (
          <Empty icon="star" title="لا توجد استجابات بعد" hint="تظهر هنا استبيانات NPS القادمة من المنشآت" />
        ) : (
          <div className="divide">
            {responses.slice(0, 40).map((r) => (
              <div key={r.id} className="row" style={{ gap: 10, padding: '8px 0', alignItems: 'flex-start' }}>
                <span className="badge num" style={{
                  flex: 'none',
                  background: r.score >= 9 ? 'var(--success)' : r.score >= 7 ? 'var(--gold)' : 'var(--danger)',
                  color: 'var(--on-brand, #fff)',
                }}>{r.score}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  {r.comment ? <div className="small">{r.comment}</div> : <div className="small faint">بدون تعليق</div>}
                  <div className="xs faint">{r.tenantName || r.tenantId || '—'} · {fmtWhen(r.at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Bar({ label, pct, count, color }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="row-between xs">
        <span>{label}</span>
        <span className="num faint">{count} · {pct}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 99, background: 'var(--surface-2, var(--border))', overflow: 'hidden', marginTop: 3 }}>
        <div style={{ height: '100%', width: `${Math.max(pct ? 3 : 0, pct)}%`, background: color, borderRadius: 99 }} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Acquisition                                                         */
/* ------------------------------------------------------------------ */
function AcquisitionTab() {
  const [tenants, setTenants] = useState(null)
  const [referrals, setReferrals] = useState(null)
  useEffect(() => watchAllTenants(setTenants), [])
  useEffect(() => watchReferrals(setReferrals), [])

  const breakdown = useMemo(() => acquisitionBreakdown(tenants || []), [tenants])
  const total = (tenants || []).length
  const maxCount = breakdown[0]?.count || 1

  if (tenants === null) return <Spinner />

  const palette = ['var(--brand)', 'var(--gold)', 'var(--success)', 'var(--accent)', 'var(--warning)', 'var(--danger)']

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="card card-pad stack">
        <strong className="small"><Icon name="trending" size={14} /> مصادر اكتساب المنشآت</strong>
        {total === 0 ? (
          <Empty icon="store" title="لا توجد منشآت بعد" />
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {breakdown.map((r, i) => (
              <div key={r.source}>
                <div className="row-between small">
                  <span className="bold">{r.source}</span>
                  <span className="num faint">{r.count} · {Math.round((r.count / total) * 100)}%</span>
                </div>
                <div style={{ height: 10, borderRadius: 99, background: 'var(--surface-2, var(--border))', overflow: 'hidden', marginTop: 4 }}>
                  <div style={{ height: '100%', width: `${Math.max(3, Math.round((r.count / maxCount) * 100))}%`, background: palette[i % palette.length], borderRadius: 99 }} />
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="xs faint" style={{ marginTop: 4 }}>يُقرأ من الحقل <span className="num" dir="ltr">tenant.source</span> المُسجَّل عند التسجيل.</p>
      </div>

      <div className="card card-pad stack">
        <strong className="small"><Icon name="award" size={14} /> الإحالات</strong>
        {referrals === null ? (
          <Spinner />
        ) : referrals.length === 0 ? (
          <Empty icon="award" title="لا توجد إحالات بعد" hint="تظهر هنا الإحالات القادمة من المنشآت عبر أكوادها" />
        ) : (
          <div className="divide">
            {referrals.map((r) => (
              <div key={r.id} className="row-between small" style={{ padding: '7px 0' }}>
                <span className="chip num" dir="ltr">{r.code || '—'}</span>
                <span className="grow faint xs" style={{ textAlign: 'center' }}>
                  {r.fromTid ? <Link to={`/platform/venues/${r.fromTid}`}>{r.fromTid}</Link> : '—'}
                </span>
                <span className="xs faint num">{fmtWhen(r.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Status incidents                                                    */
/* ------------------------------------------------------------------ */
const LEVEL_OPTS = [
  { id: 'operational', ar: 'يعمل بشكل طبيعي' },
  { id: 'degraded', ar: 'أداء منخفض' },
  { id: 'down', ar: 'تعطّل' },
]

function StatusTab() {
  const toast = useToast()
  const [incidents, setIncidents] = useState(null)
  const [editing, setEditing] = useState(null) // incident id or 'new' or null
  const [form, setForm] = useState({ title: '', level: 'degraded', body: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => watchStatus(setIncidents), [])

  const overall = useMemo(() => overallStatus(incidents || []), [incidents])

  const openNew = () => { setForm({ title: '', level: 'degraded', body: '' }); setEditing('new') }
  const openEdit = (i) => { setForm({ title: i.title || '', level: i.level || 'degraded', body: i.body || '' }); setEditing(i.id) }

  const save = async () => {
    if (!form.title.trim()) { toast.error('أدخل عنوان الحدث'); return }
    setBusy(true)
    try {
      await saveStatusIncident(editing === 'new' ? null : editing, form)
      toast.success('تم حفظ الحدث')
      setEditing(null)
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setBusy(false)
    }
  }

  if (incidents === null) return <Spinner />

  const ov = STATUS_LEVELS[overall]

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="card card-pad row-between" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <span style={{ width: 12, height: 12, borderRadius: 99, background: ov.color, flex: 'none' }} />
          <div>
            <div className="bold small">الحالة العامة: {ov.ar}</div>
            <div className="xs faint">تظهر للجمهور على صفحة <a href="/status" target="_blank" rel="noreferrer" className="num" dir="ltr">/status</a></div>
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={openNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Icon name="add" size={14} /> حدث جديد
        </button>
      </div>

      {editing && (
        <div className="card card-pad stack" style={{ gap: 10 }}>
          <strong className="small">{editing === 'new' ? 'حدث جديد' : 'تعديل الحدث'}</strong>
          <input className="input" placeholder="العنوان" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <select className="select" value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}>
            {LEVEL_OPTS.map((o) => <option key={o.id} value={o.id}>{o.ar}</option>)}
          </select>
          <textarea className="textarea" rows={3} placeholder="التفاصيل (اختياري)" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>حفظ</button>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setEditing(null)}>إلغاء</button>
          </div>
        </div>
      )}

      <div className="card card-pad stack">
        <strong className="small"><Icon name="clock" size={14} /> سجل الأحداث</strong>
        {incidents.length === 0 ? (
          <Empty icon="check" title="لا توجد أحداث" hint="كل الأنظمة تعمل بشكل طبيعي" />
        ) : (
          <div className="divide">
            {incidents.map((i) => {
              const lv = STATUS_LEVELS[i.level] || STATUS_LEVELS.operational
              return (
                <div key={i.id} className="row" style={{ gap: 10, padding: '10px 0', alignItems: 'flex-start' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 99, background: lv.color, marginTop: 5, flex: 'none' }} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="small bold">{i.title}</span>
                      <span className={`badge ${lv.badge}`}>{lv.ar}</span>
                    </div>
                    {i.body ? <div className="xs faint" style={{ marginTop: 2, wordBreak: 'break-word' }}>{i.body}</div> : null}
                    <div className="xs faint num">{fmtWhen(i.at)}</div>
                  </div>
                  <button type="button" className="btn btn-outline btn-xs" onClick={() => openEdit(i)}>
                    <Icon name="edit" size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
