// Support tooling — canned responses, support tags & SLA settings for the
// platform support desk. Canned replies + tags are reused by the chat/issues
// screens; SLA settings drive the breach badges on the live open-ticket board.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchIssues } from '../../lib/platform.js'
import {
  watchCanned,
  saveCanned,
  deleteCanned,
  watchSupportConfig,
  saveSupportConfig,
  isBreached,
  minutesSince,
} from '../../lib/platformSupport.js'
import { fmtWhen } from './shared.jsx'

const EMPTY_FORM = { id: null, title: '', body: '' }

export default function SupportTools() {
  const toast = useToast()

  // ----- canned responses -----
  const [canned, setCanned] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // ----- support config (SLA + tags) -----
  const [config, setConfig] = useState(null)
  const [slaInput, setSlaInput] = useState('')
  const [tags, setTags] = useState([])
  const [tagInput, setTagInput] = useState('')
  const [savingCfg, setSavingCfg] = useState(false)

  // ----- open tickets -----
  const [issues, setIssues] = useState(null)

  useEffect(() => watchCanned(setCanned), [])
  useEffect(
    () =>
      watchSupportConfig((c) => {
        setConfig(c)
        setSlaInput(String(c.slaMinutes))
        setTags(c.tags)
      }),
    [],
  )
  useEffect(() => watchIssues(setIssues, { max: 200 }), [])

  const openIssues = useMemo(
    () => (issues || []).filter((i) => i.status !== 'resolved'),
    [issues],
  )
  const breachedCount = useMemo(
    () => openIssues.filter((i) => isBreached(i.createdAt, config?.slaMinutes)).length,
    [openIssues, config],
  )

  // ---- canned handlers ----
  const editCanned = (c) => setForm({ id: c.id, title: c.title || '', body: c.body || '' })
  const resetForm = () => setForm(EMPTY_FORM)

  const submitCanned = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) {
      toast.error('العنوان مطلوب')
      return
    }
    setSaving(true)
    try {
      await saveCanned(form.id, { title: form.title, body: form.body })
      toast.success(form.id ? 'تم تحديث الرد' : 'تمت إضافة الرد')
      resetForm()
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setSaving(false)
    }
  }

  const removeCanned = async (c) => {
    if (!window.confirm(`حذف الرد "${c.title}"؟`)) return
    try {
      await deleteCanned(c.id)
      if (form.id === c.id) resetForm()
      toast.success('تم الحذف')
    } catch {
      toast.error('تعذّر الحذف')
    }
  }

  // ---- tag handlers ----
  const addTag = () => {
    const t = tagInput.trim()
    if (!t) return
    if (tags.includes(t)) {
      toast.error('الوسم موجود')
      setTagInput('')
      return
    }
    setTags([...tags, t])
    setTagInput('')
  }
  const removeTag = (t) => setTags(tags.filter((x) => x !== t))

  const saveConfig = async () => {
    setSavingCfg(true)
    try {
      await saveSupportConfig({ slaMinutes: Number(slaInput) || 60, tags })
      toast.success('تم حفظ الإعدادات')
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setSavingCfg(false)
    }
  }

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div>
        <h2 className="page-title">أدوات الدعم</h2>
        <p className="muted small">
          الردود الجاهزة والوسوم تُستخدم من شاشتَي الدردشة والتذاكر، وإعداد زمن الاستجابة (SLA)
          يحدّد التذاكر المتأخرة تلقائياً.
        </p>
      </div>

      {/* ============ 1) Canned responses ============ */}
      <section className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="message" size={18} />
          <strong className="grow">الردود الجاهزة</strong>
          {canned ? <span className="badge badge-info">{canned.length}</span> : null}
        </div>

        <form className="stack" style={{ gap: 8 }} onSubmit={submitCanned}>
          <input
            className="input"
            placeholder="عنوان الرد (مثال: طلب معلومات إضافية)"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            className="textarea"
            rows={3}
            placeholder="نص الرد الذي سيُلصق في الدردشة…"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Icon name={form.id ? 'check' : 'add'} size={14} />{' '}
              {form.id ? 'حفظ التعديل' : 'إضافة رد'}
            </button>
            {form.id ? (
              <button type="button" className="btn btn-outline" onClick={resetForm}>
                إلغاء
              </button>
            ) : null}
          </div>
        </form>

        {canned === null ? (
          <Spinner />
        ) : canned.length === 0 ? (
          <Empty icon="message" title="لا ردود جاهزة" hint="أضف ردوداً متكررة لتسريع الدعم" />
        ) : (
          <div className="stack divide">
            {canned.map((c) => (
              <div key={c.id} className="list-row row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small bold">{c.title}</div>
                  {c.body ? (
                    <div className="xs faint truncate" style={{ whiteSpace: 'pre-wrap' }}>
                      {c.body}
                    </div>
                  ) : null}
                </div>
                <div className="row" style={{ gap: 4, flex: 'none' }}>
                  <button className="btn-icon" onClick={() => editCanned(c)} title="تعديل">
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => removeCanned(c)}
                    title="حذف"
                    style={{ color: 'var(--danger)' }}
                  >
                    <Icon name="delete" size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============ 2) Tags + 3) SLA settings ============ */}
      <section className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="settings" size={18} />
          <strong className="grow">وسوم الدعم وإعداد زمن الاستجابة</strong>
        </div>

        {config === null ? (
          <Spinner />
        ) : (
          <>
            {/* SLA minutes */}
            <div className="stack" style={{ gap: 6 }}>
              <label className="small bold">
                زمن الاستجابة المستهدف (بالدقائق)
              </label>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <input
                  type="number"
                  min={1}
                  className="input input-sm"
                  style={{ maxWidth: 140 }}
                  value={slaInput}
                  onChange={(e) => setSlaInput(e.target.value)}
                />
                <span className="xs faint">
                  التذاكر المفتوحة الأقدم من هذه المدة تُعلَّم كمتأخرة.
                </span>
              </div>
            </div>

            {/* Tags */}
            <div className="stack" style={{ gap: 6 }}>
              <label className="small bold">وسوم التصنيف</label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  className="input input-sm grow"
                  placeholder="أضف وسماً (مثال: فوترة، تقني، استفسار)"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addTag()
                    }
                  }}
                />
                <button type="button" className="btn btn-outline btn-sm" onClick={addTag}>
                  <Icon name="add" size={14} /> إضافة
                </button>
              </div>
              {tags.length === 0 ? (
                <span className="xs faint">لا وسوم بعد.</span>
              ) : (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="chip"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      {t}
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => removeTag(t)}
                        title="إزالة"
                        style={{ padding: 0, color: 'var(--danger)' }}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="row">
              <button className="btn btn-primary" onClick={saveConfig} disabled={savingCfg}>
                <Icon name="check" size={14} /> حفظ الإعدادات
              </button>
            </div>
          </>
        )}
      </section>

      {/* ============ Live open tickets with SLA breach ============ */}
      <section className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="warning" size={18} />
          <strong className="grow">التذاكر المفتوحة</strong>
          {issues !== null && config ? (
            <>
              <span className="badge badge-info">{openIssues.length}</span>
              {breachedCount > 0 ? (
                <span className="badge badge-danger">متأخرة {breachedCount}</span>
              ) : null}
            </>
          ) : null}
        </div>

        {issues === null || config === null ? (
          <Spinner />
        ) : openIssues.length === 0 ? (
          <Empty icon="check" title="لا تذاكر مفتوحة" hint="كل التذاكر مغلقة حالياً" />
        ) : (
          <div className="stack divide">
            {openIssues.map((i) => {
              const breached = isBreached(i.createdAt, config.slaMinutes)
              const mins = minutesSince(i.createdAt)
              return (
                <div key={i.id} className="list-row row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="small bold">{i.title}</span>
                      {breached ? (
                        <span className="badge badge-danger">
                          <Icon name="clock" size={12} /> تجاوز SLA
                        </span>
                      ) : (
                        <span className="badge badge-success">ضمن الوقت</span>
                      )}
                    </div>
                    <div className="xs faint">
                      {i.tenantId ? (
                        <Link to={`/platform/venues/${i.tenantId}`} className="bold">
                          {i.tenantName || i.tenantId}
                        </Link>
                      ) : (
                        'المنصة'
                      )}
                      {' · '}
                      {fmtWhen(i.createdAt)}
                      {mins != null ? ` · منذ ${mins} د` : ''}
                    </div>
                  </div>
                  {i.tenantId ? (
                    <Link
                      to={`/platform/chat/${i.tenantId}`}
                      className="btn btn-outline btn-sm"
                      style={{ flex: 'none' }}
                    >
                      <Icon name="mail" size={14} /> دردشة
                    </Link>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
