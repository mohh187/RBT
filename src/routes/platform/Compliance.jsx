// Compliance & data governance (/platform/compliance) — platform-admin only.
// Four tabs: data export, consent log, PII masking demo, retention policy.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchAllTenants } from '../../lib/platform.js'
import {
  watchConsents,
  recordConsent,
  requestExport,
  watchExports,
  maskPII,
  getRetentionConfig,
  saveRetentionConfig,
  DEFAULT_RETENTION,
} from '../../lib/platformCompliance.js'
import { fmtWhen } from './shared.jsx'

const TABS = [
  { id: 'export', label: 'تصدير البيانات', icon: 'download' },
  { id: 'consent', label: 'سجل الموافقات', icon: 'file' },
  { id: 'mask', label: 'إخفاء البيانات', icon: 'eye' },
  { id: 'retention', label: 'سياسة الاحتفاظ', icon: 'clock' },
]

const CONSENT_KINDS = {
  dpa: 'اتفاقية معالجة البيانات',
  privacy: 'سياسة الخصوصية',
  marketing: 'موافقة تسويقية',
  terms: 'الشروط والأحكام',
  general: 'موافقة عامة',
}

export default function Compliance() {
  const [tab, setTab] = useState('export')

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div>
        <h2 className="page-title">الامتثال وحوكمة البيانات</h2>
        <p className="muted small">
          تصدير بيانات المنشآت، سجل الموافقات، إخفاء البيانات الحساسة (PII)، وسياسة الاحتفاظ بالبيانات.
        </p>
      </div>

      {/* Tabs */}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'export' && <ExportTab />}
      {tab === 'consent' && <ConsentTab />}
      {tab === 'mask' && <MaskTab />}
      {tab === 'retention' && <RetentionTab />}
    </div>
  )
}

/* ============ 1) Data export ============ */
function ExportTab() {
  const toast = useToast()
  const [tenants, setTenants] = useState(null)
  const [exports, setExports] = useState(null)
  const [tid, setTid] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => watchAllTenants(setTenants), [])
  useEffect(() => watchExports(setExports), [])

  const tenantName = (id) => tenants?.find((t) => t.id === id)?.name || id

  const trigger = async () => {
    if (!tid) {
      toast.error('اختر منشأة أولاً')
      return
    }
    setBusy(true)
    try {
      await requestExport(tid)
      toast.success('تم طلب التصدير، سيظهر الملف جاهزاً عند اكتماله')
    } catch {
      toast.error('تعذّر طلب التصدير')
    } finally {
      setBusy(false)
    }
  }

  const download = (row) => {
    try {
      const payload = row.data !== undefined ? row.data : row
      const json = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `export-${row.tenantId || row.id}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('تعذّر تنزيل الملف')
    }
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <section className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="download" size={18} />
          <strong className="grow">طلب تصدير بيانات منشأة</strong>
        </div>
        {tenants === null ? (
          <Spinner />
        ) : (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              className="select grow"
              style={{ minWidth: 200 }}
              value={tid}
              onChange={(e) => setTid(e.target.value)}
            >
              <option value="">— اختر منشأة —</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || t.id}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={trigger} disabled={busy || !tid}>
              <Icon name="upload" size={14} /> طلب التصدير
            </button>
          </div>
        )}
        <p className="xs faint">
          يجمع التصدير بيانات المنشأة عبر دالة <span className="num">requestVenueExport</span> ثم يظهر الملف جاهزاً في القائمة أدناه.
        </p>
      </section>

      <section className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="file" size={18} />
          <strong className="grow">التصديرات الجاهزة</strong>
          {exports ? <span className="badge badge-info">{exports.length}</span> : null}
        </div>
        {exports === null ? (
          <Spinner />
        ) : exports.length === 0 ? (
          <Empty icon="download" title="لا تصديرات بعد" hint="اطلب تصدير منشأة لتظهر هنا" />
        ) : (
          <div className="stack divide">
            {exports.map((row) => {
              const ready = row.status === 'ready' || row.data !== undefined || row.status === undefined
              return (
                <div key={row.id} className="list-row row" style={{ gap: 8, alignItems: 'center' }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="small bold truncate">{tenantName(row.tenantId)}</div>
                    <div className="xs faint">
                      {fmtWhen(row.createdAt)}
                      {row.records != null ? ` · ${row.records} سجل` : ''}
                    </div>
                  </div>
                  {ready ? (
                    <span className="badge badge-success">جاهز</span>
                  ) : (
                    <span className="badge badge-warning">قيد التجهيز</span>
                  )}
                  {row.url ? (
                    <a className="btn btn-outline btn-sm" href={row.url} target="_blank" rel="noreferrer" style={{ flex: 'none' }}>
                      <Icon name="download" size={14} /> رابط
                    </a>
                  ) : (
                    <button className="btn btn-outline btn-sm" onClick={() => download(row)} disabled={!ready} style={{ flex: 'none' }}>
                      <Icon name="download" size={14} /> JSON
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

/* ============ 2) Consent log ============ */
function ConsentTab() {
  const toast = useToast()
  const [tenants, setTenants] = useState(null)
  const [consents, setConsents] = useState(null)
  const [tid, setTid] = useState('')
  const [kind, setKind] = useState('dpa')
  const [busy, setBusy] = useState(false)

  useEffect(() => watchAllTenants(setTenants), [])
  useEffect(() => watchConsents(setConsents), [])

  const tenantName = (id) => tenants?.find((t) => t.id === id)?.name || id || 'المنصة'

  const add = async () => {
    setBusy(true)
    try {
      await recordConsent({ tenantId: tid || null, kind, by: 'platform-admin' })
      toast.success('تم تسجيل الموافقة')
    } catch {
      toast.error('تعذّر التسجيل')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <section className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="add" size={18} />
          <strong className="grow">تسجيل موافقة</strong>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select className="select grow" style={{ minWidth: 160 }} value={tid} onChange={(e) => setTid(e.target.value)}>
            <option value="">المنصة (عام)</option>
            {(tenants || []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name || t.id}
              </option>
            ))}
          </select>
          <select className="select" style={{ minWidth: 180 }} value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(CONSENT_KINDS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={add} disabled={busy}>
            <Icon name="check" size={14} /> تسجيل
          </button>
        </div>
      </section>

      <section className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="file" size={18} />
          <strong className="grow">سجل الموافقات</strong>
          {consents ? <span className="badge badge-info">{consents.length}</span> : null}
        </div>
        {consents === null ? (
          <Spinner />
        ) : consents.length === 0 ? (
          <Empty icon="file" title="لا موافقات مسجلة" hint="سجّل موافقة لتظهر في السجل" />
        ) : (
          <div className="stack divide">
            {consents.map((c) => (
              <div key={c.id} className="list-row row" style={{ gap: 8, alignItems: 'center' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small bold">{CONSENT_KINDS[c.kind] || c.kind}</div>
                  <div className="xs faint">
                    {c.tenantId ? (
                      <Link to={`/platform/venues/${c.tenantId}`} className="bold">
                        {tenantName(c.tenantId)}
                      </Link>
                    ) : (
                      'المنصة'
                    )}
                    {c.by ? ` · ${c.by}` : ''}
                    {' · '}
                    {fmtWhen(c.at)}
                  </div>
                </div>
                <span className="badge badge-success" style={{ flex: 'none' }}>
                  <Icon name="check" size={12} /> موافَق
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/* ============ 3) PII masking demo ============ */
function MaskTab() {
  const [enabled, setEnabled] = useState(true)
  const [sample, setSample] = useState('0551234567')

  const shown = useMemo(() => (enabled ? maskPII(sample) : sample), [enabled, sample])
  const examples = ['0551234567', 'moh.idris.18@gmail.com', 'أحمد العتيبي', '+966501112233']

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <section className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row row-between" style={{ alignItems: 'center' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Icon name="eye" size={18} />
            <strong>إخفاء البيانات الحساسة</strong>
          </div>
          <button
            className={`btn btn-sm ${enabled ? 'btn-success' : 'btn-outline'}`}
            onClick={() => setEnabled((v) => !v)}
          >
            <Icon name={enabled ? 'check' : 'close'} size={14} /> {enabled ? 'مُفعّل' : 'معطّل'}
          </button>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <label className="small bold">جرّب قيمة</label>
          <input
            className="input"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder="رقم جوال أو بريد إلكتروني"
            dir="ltr"
          />
          <div
            className="row row-between"
            style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-md)', padding: 'var(--sp-3)' }}
          >
            <span className="xs faint">الناتج</span>
            <span className="bold num" dir="ltr" style={{ letterSpacing: 1 }}>
              {shown || '—'}
            </span>
          </div>
        </div>

        <div className="stack" style={{ gap: 4 }}>
          <span className="xs faint">أمثلة (تظهر أول حرفين وآخر حرفين فقط):</span>
          {examples.map((ex) => (
            <div key={ex} className="row row-between xs" style={{ gap: 8 }}>
              <span className="faint num" dir="ltr">
                {ex}
              </span>
              <Icon name="next" size={12} />
              <span className="bold num" dir="ltr">
                {maskPII(ex)}
              </span>
            </div>
          ))}
        </div>

        <p className="xs faint">
          ملاحظة: على شاشات الدعم أن تستدعي <span className="num">maskPII()</span> عند عرض أرقام
          العملاء أو بريدهم الإلكتروني حتى لا تُكشف بياناتهم للموظفين بلا داعٍ.
        </p>
      </section>
    </div>
  )
}

/* ============ 4) Retention policy ============ */
function RetentionTab() {
  const toast = useToast()
  const [cfg, setCfg] = useState(null)
  const [activity, setActivity] = useState('')
  const [error, setErrorDays] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    getRetentionConfig().then((c) => {
      if (!alive) return
      setCfg(c)
      setActivity(String(c.activityDays))
      setErrorDays(String(c.errorDays))
    })
    return () => {
      alive = false
    }
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await saveRetentionConfig({ activityDays: Number(activity), errorDays: Number(error) })
      toast.success('تم حفظ سياسة الاحتفاظ')
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setSaving(false)
    }
  }

  if (cfg === null) return <Spinner />

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <section className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="clock" size={18} />
          <strong className="grow">سياسة الاحتفاظ بالبيانات</strong>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <label className="small bold">مدة الاحتفاظ بسجل النشاط (بالأيام)</label>
          <input
            type="number"
            min={1}
            className="input input-sm"
            style={{ maxWidth: 160 }}
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
          />
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <label className="small bold">مدة الاحتفاظ بسجل الأخطاء (بالأيام)</label>
          <input
            type="number"
            min={1}
            className="input input-sm"
            style={{ maxWidth: 160 }}
            value={error}
            onChange={(e) => setErrorDays(e.target.value)}
          />
        </div>

        <div className="row">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <Icon name="check" size={14} /> حفظ السياسة
          </button>
        </div>

        <p className="xs faint">
          تُخزَّن القيم في <span className="num">platformConfig/retention</span>. تقرأ دالة التنظيف
          الدورية هذه القيم لحذف السجلات الأقدم منها (الافتراضي: {DEFAULT_RETENTION.activityDays} يوم للنشاط،
          {' '}
          {DEFAULT_RETENTION.errorDays} يوم للأخطاء).
        </p>
      </section>
    </div>
  )
}
