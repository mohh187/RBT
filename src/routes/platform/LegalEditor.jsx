// Platform console — edit & publish the legal documents (Terms, Privacy, Refund,
// Acceptable Use). Publishes to platformConfig/legal which the public /legal
// pages render (merged over the built-in defaults). Bumping the version re-prompts
// venues for consent on their next onboarding/session.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { LEGAL_DEFAULTS, LEGAL_ORDER, mergeLegal, watchPublishedLegal, savePublishedLegalDoc, COMPANY } from '../../lib/legal.js'

export default function LegalEditor() {
  const toast = useToast()
  const [published, setPublished] = useState(null)
  const [active, setActive] = useState('terms')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => watchPublishedLegal(setPublished), [])
  useEffect(() => {
    if (published === null) return
    setDraft(structuredClone(mergeLegal(published, active)))
  }, [published, active])

  const dirty = useMemo(() => {
    if (!draft || published === null) return false
    return JSON.stringify(draft) !== JSON.stringify(mergeLegal(published, active))
  }, [draft, published, active])

  if (published === null || !draft) return <Spinner />

  const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }))
  const setSection = (i, k, v) => setDraft((d) => ({ ...d, sections: d.sections.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }))
  const addSection = () => setDraft((d) => ({ ...d, sections: [...(d.sections || []), { h: 'بند جديد', body: '' }] }))
  const removeSection = (i) => setDraft((d) => ({ ...d, sections: d.sections.filter((_, j) => j !== i) }))
  const moveSection = (i, dir) => setDraft((d) => {
    const arr = [...d.sections]; const j = i + dir
    if (j < 0 || j >= arr.length) return d
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    return { ...d, sections: arr }
  })
  const resetToDefault = () => setDraft(structuredClone(LEGAL_DEFAULTS[active]))

  const save = async () => {
    setBusy(true)
    try {
      await savePublishedLegalDoc(active, draft)
      toast.success('نُشر المستند')
    } catch {
      toast.error('تعذّر النشر')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      <div>
        <h2 className="page-title">المستندات القانونية</h2>
        <p className="muted small">حرّر وانشر الشروط والخصوصية والاسترجاع والاستخدام المقبول — تظهر مباشرةً على صفحات <Link to="/legal" className="bold">/legal</Link> العامة</p>
      </div>

      <div className="card card-pad" style={{ borderColor: 'var(--warning)' }}>
        <p className="small">
          <Icon name="warning" size={14} style={{ verticalAlign: 'middle', color: 'var(--warning)' }} /> عدّل بيانات المنشأة القانونية في الكود (<code>src/lib/legal.js → COMPANY</code>): الاسم القانوني، السجل التجاري، الرقم الضريبي، العنوان، التواصل. الحالية: {COMPANY.legalName} · {COMPANY.cr}
        </p>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {LEGAL_ORDER.map((d) => (
          <button key={d} className={`btn ${active === d ? 'btn-primary' : 'btn-outline'}`} style={{ padding: '6px 12px' }} onClick={() => setActive(d)}>
            {LEGAL_DEFAULTS[d].title}
          </button>
        ))}
      </div>

      <div className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="stack grow" style={{ gap: 4, minWidth: 200 }}>
            <span className="xs faint bold">العنوان</span>
            <input className="input" value={draft.title || ''} onChange={(e) => setField('title', e.target.value)} />
          </label>
          <label className="stack" style={{ gap: 4, width: 110 }}>
            <span className="xs faint bold">الإصدار</span>
            <input className="input" value={draft.version || ''} onChange={(e) => setField('version', e.target.value)} />
          </label>
          <label className="stack" style={{ gap: 4, width: 150 }}>
            <span className="xs faint bold">آخر تحديث</span>
            <input type="date" className="input" value={draft.updated || ''} onChange={(e) => setField('updated', e.target.value)} />
          </label>
        </div>
        <label className="stack" style={{ gap: 4 }}>
          <span className="xs faint bold">المقدّمة</span>
          <textarea className="input" rows={3} value={draft.intro || ''} onChange={(e) => setField('intro', e.target.value)} />
        </label>
      </div>

      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        {(draft.sections || []).map((s, i) => (
          <div key={i} className="card card-pad stack" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 6 }}>
              <input className="input grow" value={s.h} onChange={(e) => setSection(i, 'h', e.target.value)} placeholder="عنوان البند" />
              <button className="btn btn-outline btn-xs" onClick={() => moveSection(i, -1)} title="أعلى"><Icon name="arrowUp" size={13} /></button>
              <button className="btn btn-outline btn-xs" onClick={() => moveSection(i, 1)} title="أسفل"><Icon name="arrowUp" size={13} style={{ transform: 'rotate(180deg)' }} /></button>
              <button className="btn btn-outline btn-xs" style={{ color: 'var(--danger)' }} onClick={() => removeSection(i)} title="حذف"><Icon name="delete" size={13} /></button>
            </div>
            <textarea className="input" rows={4} value={s.body} onChange={(e) => setSection(i, 'body', e.target.value)} placeholder="نص البند" />
          </div>
        ))}
        <button className="btn btn-outline" onClick={addSection}><Icon name="add" size={15} /> إضافة بند</button>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className={`btn ${dirty ? 'btn-primary' : 'btn-outline'}`} onClick={save} disabled={busy || !dirty}>
          <Icon name="check" size={16} /> {busy ? 'جارٍ النشر…' : 'نشر التغييرات'}
        </button>
        <button className="btn btn-outline" onClick={resetToDefault}><Icon name="undo" size={15} /> استعادة النص الافتراضي</button>
        <a href={`/legal/${active}`} target="_blank" rel="noreferrer" className="btn btn-outline"><Icon name="eye" size={15} /> معاينة عامة</a>
      </div>
    </div>
  )
}
