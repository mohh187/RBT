import { useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import { aiQuick, aiConfigured } from '../../lib/aiBridge.js'
import { downloadCsv, downloadJson, parseReportSpec, ACCOUNTS } from '../../lib/accounting.js'

// Asks the model for a REPORT SPEC (columns + filter), never for data. The rows
// are then produced locally from the real datasets, so a custom report cannot
// contain a number the venue does not actually have.
const SPEC_PROMPT = (question, sample, fields) => [
  'أنت مولّد مواصفات تقارير. لا تُرجع أي بيانات ولا أي أرقام.',
  'أرجع كائن JSON فقط، بدون أي شرح قبله أو بعده، بهذا الشكل:',
  '{"title":"عنوان","source":"ledger|expenses|items|orders","columns":[{"key":"حقل","label":"عنوان العمود"}],"filterAccount":null,"filterType":null,"sortBy":"حقل","sortDir":"desc","limit":100}',
  'استخدم فقط أسماء الحقول المتاحة التالية لكل مصدر:',
  JSON.stringify(fields),
  'مثال على صف حقيقي من البيانات (للتعرف على الحقول فقط):',
  JSON.stringify(sample),
  `طلب المدير: ${question}`,
].join('\n')

export default function ExportView({ datasets, snapshot, ar = true, showMoney = true, onPrint, canExport = true }) {
  const [wish, setWish] = useState('')
  const [busy, setBusy] = useState(false)
  const [spec, setSpec] = useState(null)
  const [error, setError] = useState('')

  const fields = useMemo(() => {
    const out = {}
    Object.entries(datasets || {}).forEach(([k, rows]) => { out[k] = Object.keys(rows?.[0] || {}) })
    return out
  }, [datasets])

  const rows = useMemo(() => {
    if (!spec) return []
    let list = datasets?.[spec.source] || []
    if (spec.filterAccount) list = list.filter((r) => r.account === spec.filterAccount || r.accountCode === spec.filterAccount)
    if (spec.filterType) list = list.filter((r) => String(r.type || '') === spec.filterType)
    if (spec.sortBy) {
      const dir = spec.sortDir === 'asc' ? 1 : -1
      list = [...list].sort((a, b) => {
        const x = a[spec.sortBy]; const y = b[spec.sortBy]
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
        return String(x ?? '').localeCompare(String(y ?? ''), 'ar') * dir
      })
    }
    return list.slice(0, spec.limit)
  }, [spec, datasets])

  const buildReport = async () => {
    const q = wish.trim()
    if (!q || busy) return
    setBusy(true); setError(''); setSpec(null)
    try {
      const sampleSource = datasets?.ledger?.[0] || datasets?.expenses?.[0] || {}
      const reply = await aiQuick(SPEC_PROMPT(q, sampleSource, fields), { model: 'gemini-2.5-flash' })
      const parsed = parseReportSpec(reply)
      if (!parsed) {
        // Honest failure: no fabricated fallback report.
        setError(ar
          ? 'لم يُرجع النموذج مواصفة تقرير صالحة، ولن أختلق تقريراً. أعد صياغة طلبك بذكر الأعمدة المطلوبة بوضوح.'
          : 'The model did not return a usable report spec, and no report will be invented.')
        return
      }
      if (!(datasets?.[parsed.source] || []).length) {
        setError(ar
          ? `المصدر المطلوب (${parsed.source}) لا يحتوي أي بيانات في هذه الفترة، لذلك التقرير سيكون فارغاً.`
          : `The requested source has no data in this period.`)
      }
      const valid = parsed.columns.filter((c) => (fields[parsed.source] || []).includes(c.key))
      if (!valid.length) {
        setError(ar
          ? 'الأعمدة التي اقترحها النموذج غير موجودة في البيانات الفعلية، لذلك لن أعرض تقريراً مضلّلاً.'
          : 'The proposed columns do not exist in the real data.')
        return
      }
      setSpec({ ...parsed, columns: valid })
    } catch (e) {
      setError((ar ? 'تعذّر الوصول إلى المساعد: ' : 'Assistant unavailable: ') + (e?.message || e))
    } finally { setBusy(false) }
  }

  const EXPORTS = [
    { key: 'ledger', ar: 'دفتر اليومية', en: 'Journal' },
    { key: 'pnl', ar: 'قائمة الدخل', en: 'Income statement' },
    { key: 'expenses', ar: 'المصروفات', en: 'Expenses' },
    { key: 'items', ar: 'هوامش الأصناف', en: 'Item margins' },
    { key: 'inventory', ar: 'تقييم المخزون', en: 'Inventory' },
    { key: 'sessions', ar: 'ورديات الدرج', en: 'Drawer sessions' },
  ].filter((x) => (datasets?.[x.key] || []).length)

  return (
    <div className="acc-stack">
      <div className="acc-card">
        <span className="acc-card-title"><Icon name="download" size={17} /> {ar ? 'تصدير البيانات' : 'Export'}</span>
        {!canExport ? (
          <p className="acc-empty">{ar ? 'لا تملك صلاحية تصدير بيانات المنشأة.' : 'You lack the export capability.'}</p>
        ) : (
          <>
            <p className="acc-hint">{ar ? 'كل تصدير يشمل الفترة المحددة فقط. ملفات CSV تُفتح في Excel بالعربية مباشرة.' : 'Exports cover the selected period only.'}</p>
            <div className="acc-export-grid">
              {EXPORTS.map((x) => (
                <div key={x.key} className="acc-export-row">
                  <span>{ar ? x.ar : x.en}</span>
                  <span className="acc-period-label acc-num">{(datasets[x.key] || []).length}</span>
                  <span className="row" style={{ gap: 4 }}>
                    <button className="btn btn-xs btn-outline" onClick={() => downloadCsv(`${x.key}.csv`, datasets[x.key])}>CSV</button>
                    <button className="btn btn-xs btn-outline" onClick={() => downloadJson(`${x.key}.json`, datasets[x.key])}>JSON</button>
                  </span>
                </div>
              ))}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-outline" onClick={onPrint}><Icon name="print" size={15} /> {ar ? 'طباعة / حفظ PDF' : 'Print / PDF'}</button>
              <button className="btn btn-sm btn-outline" onClick={() => downloadJson('accounting-snapshot.json', snapshot)}><Icon name="file" size={15} /> {ar ? 'اللقطة المالية' : 'Snapshot'}</button>
            </div>
          </>
        )}
      </div>

      <div className="acc-card">
        <span className="acc-card-title"><Icon name="sparkles" size={17} /> {ar ? 'تقرير مخصص بالذكاء' : 'AI custom report'}</span>
        <p className="acc-hint">
          {ar
            ? 'صف التقرير الذي تريده بالعربية. الذكاء يحدد الأعمدة والترتيب فقط — الأرقام تأتي من بياناتك الحقيقية، ولو تعذّر ذلك سأخبرك بصراحة بدل اختلاق تقرير.'
            : 'The model only chooses columns and ordering; the numbers come from your real data.'}
        </p>
        <div className="acc-ask">
          <input
            className="input"
            value={wish}
            onChange={(e) => setWish(e.target.value)}
            placeholder={ar ? 'مثال: أعلى المصروفات مع المورد والتاريخ' : 'e.g. top expenses with supplier and date'}
            disabled={busy || !aiConfigured()}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buildReport() } }}
          />
          <button className="btn btn-primary btn-sm" onClick={buildReport} disabled={busy || !wish.trim() || !aiConfigured()}>
            {busy ? (ar ? 'يجهّز' : 'Building') : (ar ? 'أنشئ' : 'Build')}
          </button>
        </div>

        {error && <div className="acc-warn"><Icon name="warning" size={15} /><span>{error}</span></div>}

        {spec && (
          <>
            <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{spec.title}</strong>
              <span className="row" style={{ gap: 4 }}>
                <button className="btn btn-xs btn-outline" onClick={() => downloadCsv('custom-report.csv', rows, spec.columns)}>CSV</button>
                <button className="btn btn-xs btn-outline" onClick={() => downloadJson('custom-report.json', rows)}>JSON</button>
              </span>
            </div>
            {!rows.length ? (
              <p className="acc-empty">{ar ? 'لا صفوف مطابقة في هذه الفترة.' : 'No matching rows.'}</p>
            ) : (
              <div className="acc-scroll-x">
                <table className="acc-table">
                  <thead><tr>{spec.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                  <tbody>
                    {rows.slice(0, 200).map((r, i) => (
                      <tr key={i}>
                        {spec.columns.map((c) => (
                          <td key={c.key} className={typeof r[c.key] === 'number' ? 'acc-num acc-ta-end' : ''}>
                            {typeof r[c.key] === 'number' && !showMoney ? '—' : String(r[c.key] ?? '—')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="acc-hint">
              {ar ? `المصدر: ${spec.source}${spec.filterAccount ? ` · مُرشَّح على ${ACCOUNTS[spec.filterAccount]?.ar}` : ''} · ${rows.length} صف` : `Source: ${spec.source} · ${rows.length} rows`}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
