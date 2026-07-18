// Platform "Advanced Design Tools" — cross-venue theming utilities:
//  1. Templates library: create/edit/delete reusable named appearance templates
//     (theme preset + brand/accent colors + optional full skin) with live swatch.
//  2. Bulk apply: multi-select venues then apply a chosen template to all at once.
//  3. Contrast checker: pick brand + background → WCAG ratio + pass/fail.
//  4. Per-venue "lock design" toggle (tenant.designLocked) to freeze a venue's
//     own theme editing (enforcement in the venue app is a follow-up).
import { useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchAllTenants, platformUpdateTenant } from '../../lib/platform.js'
import { THEMES } from '../../lib/themes.js'
import { SKINS } from '../../lib/skins.js'
import {
  watchTemplates,
  saveTemplate,
  deleteTemplate,
  applyTemplateToTenants,
  contrastRatio,
} from '../../lib/platformTemplates.js'
import { PlanBadge, StatusChip } from './shared.jsx'

const DEFAULTS = { name: '', themePreset: '', themeColor: '#7c2d2d', themeAccent: '#5c5c66', skinId: '' }
const skinName = (id) => SKINS.find((s) => s.id === id)?.name?.ar || id

// Small brand→accent gradient swatch used everywhere a template is shown.
function Swatch({ brand, accent, size = 40 }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: 'var(--r-md)', flex: 'none',
        background: `linear-gradient(135deg, ${brand || '#7c2d2d'}, ${accent || '#5c5c66'})`,
        border: '1px solid var(--border)',
      }}
    />
  )
}

// ---------------- (1) Templates library ----------------
function TemplateEditor({ initial, onSaved, onCancel }) {
  const toast = useToast()
  const [form, setForm] = useState(() => ({
    ...DEFAULTS,
    ...(initial || {}),
    themePreset: initial?.themePreset || '',
    themeColor: initial?.themeColor || DEFAULTS.themeColor,
    themeAccent: initial?.themeAccent || DEFAULTS.themeAccent,
    skinId: initial?.skinId || '',
  }))
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const pickPreset = (p) => setForm((f) => ({ ...f, themePreset: p.id, themeColor: p.brand, themeAccent: p.accent }))

  const submit = async () => {
    if (!form.name.trim()) { toast.error('اكتب اسماً للقالب'); return }
    setBusy(true)
    try {
      await saveTemplate(form.id || null, {
        name: form.name,
        themePreset: form.themePreset,
        themeColor: form.themeColor,
        themeAccent: form.themeAccent,
        skinId: form.skinId,
      })
      toast.success(form.id ? 'تم تحديث القالب' : 'تم إنشاء القالب')
      onSaved?.()
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="row-between">
        <strong>{form.id ? 'تعديل القالب' : 'قالب جديد'}</strong>
        <button className="btn btn-icon btn-sm btn-outline" onClick={onCancel} aria-label="إغلاق"><Icon name="close" size={15} /></button>
      </div>

      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <Swatch brand={form.themeColor} accent={form.themeAccent} size={48} />
        <input className="input grow" placeholder="اسم القالب (مثل: هوية ذهبية)" value={form.name} onChange={(e) => set('name', e.target.value)} />
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <span className="xs faint bold">ثيم جاهز</span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {THEMES.map((p) => (
            <button key={p.id} className={`chip ${form.themePreset === p.id ? 'active' : ''}`} onClick={() => pickPreset(p)} title={p.name.ar}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: p.brand, display: 'inline-block', marginInlineEnd: 4, verticalAlign: 'middle' }} />
              {p.name.ar}
            </button>
          ))}
        </div>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <label className="stack grow" style={{ gap: 4 }}>
          <span className="xs faint bold">اللون الأساسي</span>
          <input type="color" value={form.themeColor} onChange={(e) => set('themeColor', e.target.value)} style={{ width: '100%', height: 38, border: '1px solid var(--border)', borderRadius: 8, background: 'none' }} />
        </label>
        <label className="stack grow" style={{ gap: 4 }}>
          <span className="xs faint bold">اللون الثانوي</span>
          <input type="color" value={form.themeAccent} onChange={(e) => set('themeAccent', e.target.value)} style={{ width: '100%', height: 38, border: '1px solid var(--border)', borderRadius: 8, background: 'none' }} />
        </label>
      </div>

      <label className="stack" style={{ gap: 4 }}>
        <span className="xs faint bold">السكن (تصميم كامل — اختياري)</span>
        <select className="input" value={form.skinId} onChange={(e) => set('skinId', e.target.value)}>
          <option value="">بدون سكن (ثيم فقط)</option>
          {SKINS.map((s) => <option key={s.id} value={s.id}>{s.name.ar} — {s.tier}</option>)}
        </select>
      </label>

      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
        <Icon name="check" size={16} /> {busy ? 'جارٍ الحفظ…' : 'حفظ القالب'}
      </button>
    </div>
  )
}

function TemplatesLibrary({ templates, onEdit }) {
  const toast = useToast()

  const remove = async (t) => {
    if (!window.confirm(`حذف القالب «${t.name}»؟`)) return
    try {
      await deleteTemplate(t.id)
      toast.success('تم حذف القالب')
    } catch {
      toast.error('تعذّر الحذف')
    }
  }

  if (!templates.length) return <Empty icon="image" title="لا قوالب بعد" hint="أنشئ قالب مظهر لإعادة استخدامه على عدة منشآت" />

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {templates.map((t) => (
        <div key={t.id} className="card card-pad stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <Swatch brand={t.themeColor} accent={t.themeAccent} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="bold truncate">{t.name}</div>
              <div className="xs faint">{t.themePreset ? `ثيم: ${t.themePreset}` : 'ألوان مخصّصة'}{t.skinId ? ` · سكن: ${skinName(t.skinId)}` : ''}</div>
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-outline btn-sm grow" onClick={() => onEdit(t)}><Icon name="edit" size={14} /> تعديل</button>
            <button className="btn btn-danger btn-sm btn-icon" onClick={() => remove(t)} aria-label="حذف"><Icon name="delete" size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------- (2) Bulk apply ----------------
function BulkApply({ tenants, templates }) {
  const toast = useToast()
  const [templateId, setTemplateId] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    let l = tenants || []
    if (s) l = l.filter((t) => (t.name || '').toLowerCase().includes(s) || (t.slug || '').toLowerCase().includes(s))
    return l
  }, [tenants, q])

  const template = templates.find((t) => t.id === templateId) || null

  const toggle = (id) => setSel((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const allShownSelected = rows.length > 0 && rows.every((t) => sel.has(t.id))
  const toggleAll = () => setSel((prev) => {
    const next = new Set(prev)
    if (allShownSelected) rows.forEach((t) => next.delete(t.id))
    else rows.forEach((t) => next.add(t.id))
    return next
  })

  const apply = async () => {
    if (!template) { toast.error('اختر قالباً'); return }
    const ids = [...sel]
    if (!ids.length) { toast.error('اختر منشأة واحدة على الأقل'); return }
    if (!window.confirm(`تطبيق قالب «${template.name}» على ${ids.length} منشأة؟ سيتغيّر مظهر واجهاتها فوراً.`)) return
    setBusy(true)
    try {
      const { ok, failed } = await applyTemplateToTenants(ids, template)
      if (failed.length) toast.error(`طُبّق على ${ok}، فشل ${failed.length}`)
      else toast.success(`تم التطبيق على ${ok} منشأة`)
      setSel(new Set())
    } catch {
      toast.error('تعذّر التطبيق')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <strong><Icon name="repeat" size={16} /> تطبيق جماعي</strong>
        <span className="xs faint num">{sel.size} محدّدة</span>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select className="input grow" value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ minWidth: 160 }}>
          <option value="">اختر قالباً…</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {template ? <Swatch brand={template.themeColor} accent={template.themeAccent} size={38} /> : null}
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="input grow" placeholder="بحث عن منشأة…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 160 }} />
        <button className="btn btn-outline btn-sm" onClick={toggleAll} disabled={!rows.length}>
          <Icon name={allShownSelected ? 'no' : 'check'} size={14} /> {allShownSelected ? 'إلغاء تحديد الظاهر' : 'تحديد الظاهر'}
        </button>
      </div>

      {!rows.length ? (
        <Empty icon="store" title="لا منشآت" />
      ) : (
        <div className="stack divide" style={{ maxHeight: 320, overflowY: 'auto' }}>
          {rows.map((t) => (
            <label key={t.id} className="list-row row" style={{ gap: 10, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small bold truncate">{t.name || t.id}</div>
                <div className="xs faint">/{t.slug}</div>
              </div>
              <StatusChip tenant={t} />
            </label>
          ))}
        </div>
      )}

      <button className="btn btn-primary btn-block" onClick={apply} disabled={busy || !template || !sel.size}>
        <Icon name="check" size={16} /> {busy ? 'جارٍ التطبيق…' : `تطبيق على ${sel.size} منشأة`}
      </button>
    </div>
  )
}

// ---------------- (3) Contrast checker ----------------
function ContrastChecker() {
  const [brand, setBrand] = useState('#7c2d2d')
  const [bg, setBg] = useState('#ffffff')
  const ratio = contrastRatio(brand, bg)
  const passAA = ratio >= 4.5
  const passAAlarge = ratio >= 3
  const passAAA = ratio >= 7

  const Row = ({ label, pass }) => (
    <div className="row-between">
      <span className="small">{label}</span>
      <span className={`badge ${pass ? 'badge-success' : 'badge-danger'}`}>{pass ? 'ناجح' : 'راسب'}</span>
    </div>
  )

  return (
    <div className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
      <strong><Icon name="eye" size={16} /> فاحص التباين (WCAG)</strong>

      <div className="row" style={{ gap: 8 }}>
        <label className="stack grow" style={{ gap: 4 }}>
          <span className="xs faint bold">لون المقدّمة (النص/العلامة)</span>
          <input type="color" value={brand} onChange={(e) => setBrand(e.target.value)} style={{ width: '100%', height: 38, border: '1px solid var(--border)', borderRadius: 8, background: 'none' }} />
        </label>
        <label className="stack grow" style={{ gap: 4 }}>
          <span className="xs faint bold">لون الخلفية</span>
          <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} style={{ width: '100%', height: 38, border: '1px solid var(--border)', borderRadius: 8, background: 'none' }} />
        </label>
      </div>

      <div style={{ background: bg, color: brand, borderRadius: 'var(--r-md)', border: '1px solid var(--border)', padding: 'var(--sp-4)', textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>نص تجريبي Aa 123</div>
        <div style={{ fontSize: 13 }}>معاينة القراءة على هذه الخلفية</div>
      </div>

      <div className="row-between">
        <span className="small bold">نسبة التباين</span>
        <span className="num bold" style={{ fontSize: 18, color: passAA ? 'var(--success)' : 'var(--danger)' }}>{ratio.toFixed(2)}:1</span>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <Row label="AA نص عادي (≥ 4.5)" pass={passAA} />
        <Row label="AA نص كبير (≥ 3)" pass={passAAlarge} />
        <Row label="AAA (≥ 7)" pass={passAAA} />
      </div>
    </div>
  )
}

// ---------------- (4) Lock design toggle ----------------
function DesignLocks({ tenants }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    let l = tenants || []
    if (s) l = l.filter((t) => (t.name || '').toLowerCase().includes(s) || (t.slug || '').toLowerCase().includes(s))
    return l
  }, [tenants, q])

  const toggle = async (t) => {
    const next = !t.designLocked
    if (next && !window.confirm(`قفل تصميم «${t.name}»؟ لن تتمكن المنشأة من تعديل ثيمها بنفسها.`)) return
    setBusy(t.id)
    try {
      await platformUpdateTenant(t.id, { designLocked: next })
      toast.success(next ? 'تم قفل التصميم' : 'تم فتح التصميم')
    } catch {
      toast.error('تعذّر التحديث')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <strong><Icon name="key" size={16} /> قفل التصميم لكل منشأة</strong>
      </div>
      <p className="xs faint">عند القفل، يُمنع تعديل الثيم من داخل المنشأة (الحقل <span className="num">designLocked</span>). فرض المنع داخل تطبيق المنشأة خطوة لاحقة.</p>
      <input className="input" placeholder="بحث عن منشأة…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!rows.length ? (
        <Empty icon="store" title="لا منشآت" />
      ) : (
        <div className="stack divide" style={{ maxHeight: 340, overflowY: 'auto' }}>
          {rows.map((t) => (
            <div key={t.id} className="list-row row" style={{ gap: 10, alignItems: 'center' }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small bold truncate">{t.name || t.id}</div>
                <div className="xs faint">/{t.slug}</div>
              </div>
              {t.designLocked ? <span className="badge badge-warning">مقفول</span> : <span className="badge">مفتوح</span>}
              <PlanBadge plan={t.plan} />
              <button className={`btn btn-sm ${t.designLocked ? 'btn-outline' : 'btn-primary'}`} onClick={() => toggle(t)} disabled={busy === t.id}>
                <Icon name={t.designLocked ? 'undo' : 'key'} size={14} /> {t.designLocked ? 'فتح' : 'قفل'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------- page ----------------
const TABS = [
  ['library', 'مكتبة القوالب', 'image'],
  ['bulk', 'تطبيق جماعي', 'repeat'],
  ['contrast', 'فاحص التباين', 'eye'],
  ['locks', 'قفل التصميم', 'key'],
]

export default function DesignTools() {
  const [tenants, setTenants] = useState(null)
  const [templates, setTemplates] = useState(null)
  const [tab, setTab] = useState('library')
  const [editing, setEditing] = useState(null) // template object | {} for new | null

  useEffect(() => watchAllTenants(setTenants), [])
  useEffect(() => watchTemplates(setTemplates), [])

  const loading = tenants === null || templates === null

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      <div>
        <h2 className="page-title">أدوات التصميم المتقدمة</h2>
        <p className="muted small">قوالب مظهر قابلة لإعادة الاستخدام، تطبيق جماعي، فحص التباين، وقفل تصميم المنشآت</p>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {TABS.map(([id, label, icon]) => (
          <button key={id} className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(id)}>
            <Icon name={icon} size={14} /> {label}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : (
        <>
          {tab === 'library' && (
            <div className="stack" style={{ gap: 'var(--sp-4)' }}>
              <div className="row-between">
                <span className="muted small num">{templates.length} قالب</span>
                {!editing && <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}><Icon name="add" size={15} /> قالب جديد</button>}
              </div>
              {editing && (
                <TemplateEditor
                  initial={editing.id ? editing : DEFAULTS}
                  onSaved={() => setEditing(null)}
                  onCancel={() => setEditing(null)}
                />
              )}
              <TemplatesLibrary templates={templates} onEdit={(t) => setEditing(t)} />
            </div>
          )}
          {tab === 'bulk' && <BulkApply tenants={tenants} templates={templates} />}
          {tab === 'contrast' && <ContrastChecker />}
          {tab === 'locks' && <DesignLocks tenants={tenants} />}
        </>
      )}
    </div>
  )
}
