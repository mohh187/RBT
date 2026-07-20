import { useEffect, useMemo, useState } from 'react'
import '../../styles/genhistory.css'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import GenFilters from '../../components/gen/GenFilters.jsx'
import GenCard from '../../components/gen/GenCard.jsx'
import GenViewer from '../../components/gen/GenViewer.jsx'
import {
  watchGenerations,
  deleteGeneration,
  applyFilters,
  sectionsIn,
  DEFAULT_WINDOW,
  GEN_KINDS,
} from '../../lib/genLog.js'

// /admin/gen-history — «سجل التوليد».
// Every AI generation anywhere in the system lands in tenants/{tid}/aiGenerations
// and is browsable here: filter, preview, inspect the exact prompt, reuse it.
//
// The live query is UNFILTERED (newest-first window) and every filter is applied
// in memory. That keeps typing in the search box from re-subscribing, lets the
// chip counts describe the whole window, and needs zero composite indexes.

const EMPTY_FILTERS = { kind: 'all', section: 'all', search: '', from: '', to: '', status: 'all' }

export default function GenHistory() {
  const { tenantId } = useAuth()
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [view, setView] = useState('grid')
  const [open, setOpen] = useState(null)

  useEffect(() => {
    if (!tenantId) {
      setRows([])
      setLoading(false)
      return undefined
    }
    setLoading(true)
    // cb is called on failure too (with a message), so this never hangs on a spinner.
    const unsub = watchGenerations(tenantId, { limit: DEFAULT_WINDOW }, (list, err) => {
      setRows(list)
      setError(err || null)
      setLoading(false)
    })
    return unsub
  }, [tenantId])

  const kindCounts = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      const k = r.kind || 'other'
      m.set(k, (m.get(k) || 0) + 1)
    }
    const list = GEN_KINDS.filter((k) => m.has(k)).map((k) => ({ id: k, count: m.get(k) }))
    for (const [k, c] of m) if (!GEN_KINDS.includes(k)) list.push({ id: k, count: c })
    return list
  }, [rows])

  const sectionCounts = useMemo(() => sectionsIn(rows), [rows])

  const statusCounts = useMemo(
    () => ({ ok: rows.filter((r) => r.ok).length, failed: rows.filter((r) => !r.ok).length }),
    [rows],
  )

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters])

  const remove = async (row) => {
    await deleteGeneration(tenantId, row.id)
    setRows((list) => list.filter((r) => r.id !== row.id))
  }

  const windowFull = rows.length >= DEFAULT_WINDOW

  return (
    <div className="page gh-page">
      <div className="gh-head">
        <h2 className="page-title gh-head-title">
          <Icon name="sparkles" size={22} /> {ar ? 'سجل التوليد' : 'Generation history'}
          {!loading && !error && (
            <span className="gh-count">
              {filtered.length === rows.length
                ? `${rows.length}`
                : `${filtered.length} / ${rows.length}`}
            </span>
          )}
        </h2>
        <div className="gh-viewtoggle" role="group" aria-label={ar ? 'طريقة العرض' : 'View mode'}>
          <button type="button" className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} aria-pressed={view === 'grid'}>
            <Icon name="grid" size={14} /> {ar ? 'معرض' : 'Gallery'}
          </button>
          <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-pressed={view === 'list'}>
            <Icon name="list" size={14} /> {ar ? 'قائمة' : 'List'}
          </button>
        </div>
      </div>

      <p className="gh-note">
        {ar
          ? 'كل عملية توليد بالذكاء الاصطناعي في النظام تُسجَّل هنا — الناجحة والفاشلة معاً — مع البرومبت الذي استُخدم بالضبط، لتراجعها وتعيد استخدام ما نجح وتتجنّب ما فشل.'
          : 'Every AI generation in the system is recorded here — successes and failures alike — with the exact prompt used, so you can review it, reuse what worked and avoid what did not.'}
      </p>

      {error && (
        <div className="gh-error">
          <Icon name="warning" size={18} />
          <div>
            <strong>{ar ? 'تعذّر تحميل السجل' : 'Could not load the history'}</strong>
            <div style={{ marginTop: 4 }}>{error}</div>
          </div>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <GenFilters
          filters={filters}
          onChange={setFilters}
          kindCounts={kindCounts}
          sectionCounts={sectionCounts}
          statusCounts={statusCounts}
          ar={ar}
        />
      )}

      {loading && <Spinner lg />}

      {!loading && !error && rows.length === 0 && (
        <Empty
          icon="sparkles"
          title={ar ? 'لا توجد عمليات توليد بعد' : 'No generations yet'}
          hint={
            ar
              ? 'يمتلئ هذا السجل تلقائياً عند أول استخدام لأي أداة ذكاء اصطناعي: توليد صور المنشورات، صور الأصناف، النصوص والتعليقات، الخطط والتقارير. لا شيء هنا الآن لأن شيئاً لم يُولَّد بعد.'
              : 'This log fills itself the first time an AI tool is used — post images, item photos, text and captions, plans and reports. It is empty because nothing has been generated yet.'
          }
        />
      )}

      {!loading && !error && rows.length > 0 && filtered.length === 0 && (
        <Empty
          icon="search"
          title={ar ? 'لا نتائج مطابقة' : 'Nothing matches'}
          hint={
            ar
              ? 'غيّر الفلاتر أو امسحها لعرض السجل كاملاً.'
              : 'Change or clear the filters to see the whole log.'
          }
          action={
            <button className="btn btn-outline btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              <Icon name="undo" size={15} /> {ar ? 'مسح الفلاتر' : 'Clear filters'}
            </button>
          }
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          {view === 'grid' ? (
            <div className="gh-grid">
              {filtered.map((row) => (
                <GenCard key={row.id} row={row} view="grid" ar={ar} onOpen={setOpen} />
              ))}
            </div>
          ) : (
            <div className="gh-list">
              {filtered.map((row) => (
                <GenCard key={row.id} row={row} view="list" ar={ar} onOpen={setOpen} />
              ))}
            </div>
          )}

          {windowFull && (
            <p className="gh-note">
              {ar
                ? `يعرض السجل ويبحث داخل آخر ${DEFAULT_WINDOW} عملية توليد فقط — العمليات الأقدم من ذلك محفوظة لكنها ليست ضمن هذه النافذة.`
                : `The log shows and searches the most recent ${DEFAULT_WINDOW} generations only — older entries are still stored but fall outside this window.`}
            </p>
          )}
        </>
      )}

      {open && <GenViewer row={open} ar={ar} onClose={() => setOpen(null)} onDelete={remove} />}
    </div>
  )
}
