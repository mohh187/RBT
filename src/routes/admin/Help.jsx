// Help center: searchable system guide (backed by the assistant's knowledge
// base in lib/aiGuide.js), re-run buttons for the first-run tours, and a
// pointer to the AI assistant. Self-contained — no data fetching.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { resetTour } from '../../components/Tour.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { SYSTEM_GUIDE, searchGuide } from '../../lib/aiGuide.js'
import { TOURS } from '../../lib/tours.js'

// Arabic/English labels for each registered tour (keys must match TOURS).
const TOUR_LABELS = {
  dashboard: { ar: 'الرئيسية', en: 'Dashboard' },
  items: { ar: 'الأصناف', en: 'Items' },
  cashier: { ar: 'الكاشير', en: 'Cashier' },
  campaigns: { ar: 'الحملات', en: 'Campaigns' },
  settings: { ar: 'الإعدادات', en: 'Settings' },
  customers: { ar: 'العملاء', en: 'Customers' },
}

export default function Help() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const [q, setQ] = useState('')
  const [resetKey, setResetKey] = useState('') // which tour was just reset (inline hint)

  // Live results: keyword search when typing, the full guide otherwise.
  const topics = useMemo(() => {
    const query = q.trim()
    if (!query) return SYSTEM_GUIDE.map((s) => ({ topic: s.topic, text: s.text }))
    return searchGuide(query, 8).map((r) => ({ topic: r.topic, text: r.guide }))
  }, [q])

  const rerunTour = (key) => {
    resetTour(key)
    setResetKey(key)
  }

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      <div>
        <h2 className="page-title row" style={{ gap: 8 }}>
          <Icon name="sparkles" size={22} /> {ar ? 'مركز المساعدة' : 'Help center'}
        </h2>
        <p className="muted small">
          {ar
            ? 'ابحث في دليل النظام، أعد تشغيل الجولات التعريفية، أو اسأل المساعد الذكي'
            : 'Search the system guide, re-run the intro tours, or ask the AI assistant'}
        </p>
      </div>

      {/* re-run the first-run tours */}
      <div className="card card-pad stack" style={{ gap: 'var(--sp-2)' }}>
        <strong className="row" style={{ gap: 6 }}>
          <Icon name="play" size={16} style={{ color: 'var(--brand)' }} />
          {ar ? 'جولات تعريفية' : 'Guided tours'}
        </strong>
        <p className="muted small" style={{ margin: 0 }}>
          {ar
            ? 'كل صفحة رئيسية فيها جولة قصيرة تشرح أهم أزرارها. أعد تشغيل أي جولة من هنا:'
            : 'Each main page has a short tour of its key actions. Re-run any tour from here:'}
        </p>
        <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {Object.keys(TOURS).map((key) => (
            <button
              key={key}
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => rerunTour(key)}
            >
              {resetKey === key
                ? <Icon name="check" size={14} style={{ color: 'var(--brand)' }} />
                : <Icon name="reload" size={14} />}
              {' '}
              {(TOUR_LABELS[key] || {})[ar ? 'ar' : 'en'] || key}
            </button>
          ))}
        </div>
        {resetKey && (
          <p className="small" style={{ margin: 0, color: 'var(--brand)' }}>
            <Icon name="ok" size={14} style={{ verticalAlign: 'middle' }} />{' '}
            {ar ? 'افتح الصفحة لبدء الجولة' : 'Open that page to start the tour'}
          </p>
        )}
      </div>

      {/* ask the assistant */}
      <div className="card card-pad row-between" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <strong className="row" style={{ gap: 6 }}>
            <Icon name="sparkles" size={16} style={{ color: 'var(--brand)' }} />
            {ar ? 'اسأل المساعد' : 'Ask the assistant'}
          </strong>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {ar
              ? 'لم تجد جوابك؟ المساعد الذكي يجيب عن أي سؤال — وينفّذ المهام عنك مباشرة'
              : 'Did not find it? The AI assistant answers anything — and can do the task for you'}
          </p>
        </div>
        <Link to="/admin/assistant" className="btn btn-primary btn-sm" style={{ flex: 'none' }}>
          {ar ? 'افتح المساعد' : 'Open assistant'}
        </Link>
      </div>

      {/* search */}
      <div className="field" style={{ position: 'relative' }}>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={ar ? 'ابحث في الدليل… (مثلاً: بانر، ضريبة، وردية)' : 'Search the guide… (e.g. banner, tax, shift)'}
          style={{ paddingInlineStart: 38 }}
        />
        <span style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} className="faint">
          <Icon name="search" size={16} />
        </span>
      </div>

      {/* topics */}
      {topics.length === 0 ? (
        <div className="card card-pad small muted" style={{ textAlign: 'center' }}>
          {ar ? 'لا نتائج مطابقة — جرّب كلمة أخرى أو اسأل المساعد' : 'No matches — try another word or ask the assistant'}
        </div>
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {topics.map((s) => (
            <details key={s.topic} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <summary
                className="row-between"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: 'var(--sp-3) var(--sp-4)', cursor: 'pointer',
                  listStyle: 'none', userSelect: 'none',
                }}
              >
                <strong className="small row" style={{ gap: 8 }}>
                  <Icon name="file" size={15} style={{ color: 'var(--brand)', flex: 'none' }} />
                  {s.topic}
                </strong>
                <span className="faint" style={{ flex: 'none' }}><Icon name="back" size={14} style={{ transform: 'rotate(-90deg)' }} /></span>
              </summary>
              <p
                className="small muted"
                style={{ margin: 0, padding: '0 var(--sp-4) var(--sp-3)', lineHeight: 1.9, whiteSpace: 'pre-wrap' }}
              >
                {s.text}
              </p>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
