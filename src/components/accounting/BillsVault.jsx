import { useMemo, useRef, useState } from 'react'
import { collection, addDoc, updateDoc, deleteDoc, doc, Timestamp, serverTimestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase.js'
import { uploadFile } from '../../lib/storage.js'
import { Price } from '../Riyal.jsx'
import Icon from '../Icon.jsx'
import { useToast } from '../Toast.jsx'
import { EXPENSE_ACCOUNTS, accountAr, accountEn, mapExpenseAccount, toMs, fmtDate, downloadCsv } from '../../lib/accounting.js'

const BILL_FOLDER = 'accounting/bills'
const todayInput = () => new Date().toISOString().slice(0, 10)

// Expenses live in tenants/{tid}/expenses. This screen extends the existing doc
// shape (amount/category/note/at) with account, supplier, vatable, vatAmount and
// the attached bill URL. `createdAt` is written as the CHOSEN date (not the
// server clock) so a backdated bill still lands in the right period for the
// existing date-bounded queries.
export default function BillsVault({ tenantId, expenses = [], ar = true, lang = 'ar', currency = 'SAR', showMoney = true, actor = '', canEdit = true, vatRate = 15 }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [uploadingId, setUploadingId] = useState('')
  const [preview, setPreview] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')

  const [form, setForm] = useState({
    amount: '', account: EXPENSE_ACCOUNTS[0]?.code || 'otherExpense', supplier: '', note: '',
    date: todayInput(), vatable: false, vatAmount: '',
  })
  const [file, setFile] = useState(null)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const rows = useMemo(() => (expenses || []).map((x) => ({
    ...x,
    ms: toMs(x.at) || toMs(x.createdAt),
    accountCode: x.account && EXPENSE_ACCOUNTS.some((a) => a.code === x.account) ? x.account : mapExpenseAccount(x.category),
  })).sort((a, b) => b.ms - a.ms), [expenses])

  const withBills = useMemo(() => rows.filter((r) => r.billUrl), [rows])
  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0), [rows])
  const M = ({ v }) => (showMoney ? <Price value={v} currency={currency} lang={lang} /> : <span className="faint">—</span>)

  const autoVat = (amount) => {
    const g = Number(amount) || 0
    return g ? Math.round((g - g / (1 + (Number(vatRate) || 15) / 100)) * 100) / 100 : 0
  }

  const submit = async (e) => {
    e?.preventDefault?.()
    const amount = Number(form.amount) || 0
    if (!tenantId || amount <= 0) { toast?.error?.(ar ? 'أدخل مبلغاً صحيحاً' : 'Enter a valid amount'); return }
    if (saving) return
    setSaving(true)
    try {
      let billUrl = ''
      let billName = ''
      if (file) {
        billUrl = await uploadFile(tenantId, file, BILL_FOLDER)
        billName = file.name || ''
      }
      const ms = form.date ? new Date(`${form.date}T12:00:00`).getTime() : Date.now()
      const vatAmount = form.vatable ? (Number(form.vatAmount) || autoVat(amount)) : 0
      await addDoc(collection(db, 'tenants', tenantId, 'expenses'), {
        amount,
        account: form.account,
        category: ar ? accountAr(form.account) : accountEn(form.account),
        supplier: form.supplier.trim(),
        note: form.note.trim(),
        vatable: !!form.vatable,
        vatAmount,
        billUrl,
        billName,
        byName: actor || '',
        at: ms,
        createdAt: Timestamp.fromMillis(ms),
        recordedAt: serverTimestamp(),
      })
      setForm({ amount: '', account: form.account, supplier: '', note: '', date: form.date, vatable: false, vatAmount: '' })
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      toast?.success?.(ar ? 'سُجّل المصروف' : 'Expense recorded')
    } catch (err) {
      toast?.error?.((ar ? 'تعذّر الحفظ: ' : 'Save failed: ') + (err?.message || err))
    } finally { setSaving(false) }
  }

  const attachBill = async (row, f) => {
    if (!f || !tenantId) return
    setUploadingId(row.id)
    try {
      const url = await uploadFile(tenantId, f, BILL_FOLDER)
      await updateDoc(doc(db, 'tenants', tenantId, 'expenses', row.id), { billUrl: url, billName: f.name || '' })
      toast?.success?.(ar ? 'أُرفقت الفاتورة' : 'Bill attached')
    } catch (err) {
      toast?.error?.((ar ? 'تعذّر الرفع: ' : 'Upload failed: ') + (err?.message || err))
    } finally { setUploadingId('') }
  }

  const remove = async (row) => {
    if (!tenantId) return
    try { await deleteDoc(doc(db, 'tenants', tenantId, 'expenses', row.id)) } catch (_) { toast?.error?.(ar ? 'تعذّر الحذف' : 'Delete failed') }
  }

  // CSV paste: date,amount,category,supplier,note,vatable — parsed strictly.
  // Unparseable lines are REPORTED, never silently skipped or invented.
  const parsed = useMemo(() => {
    const out = { ok: [], bad: [] }
    importText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
      const parts = line.split(/[,\t;]/).map((p) => p.trim())
      if (/^(date|التاريخ)/i.test(parts[0] || '')) return // header
      const amount = Number(parts[1])
      const ms = parts[0] ? new Date(`${parts[0]}T12:00:00`).getTime() : NaN
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(ms)) { out.bad.push({ line: i + 1, text: line }); return }
      out.ok.push({
        ms, amount,
        account: mapExpenseAccount(parts[2] || ''),
        category: parts[2] || '',
        supplier: parts[3] || '',
        note: parts[4] || '',
        vatable: /^(1|true|yes|نعم)$/i.test(parts[5] || ''),
      })
    })
    return out
  }, [importText])

  const runImport = async () => {
    if (!parsed.ok.length || !tenantId || saving) return
    setSaving(true)
    let done = 0
    try {
      for (const r of parsed.ok) {
        await addDoc(collection(db, 'tenants', tenantId, 'expenses'), {
          amount: r.amount, account: r.account, category: r.category || accountAr(r.account),
          supplier: r.supplier, note: r.note, vatable: r.vatable,
          vatAmount: r.vatable ? autoVat(r.amount) : 0,
          billUrl: '', billName: '', byName: actor || '',
          at: r.ms, createdAt: Timestamp.fromMillis(r.ms), recordedAt: serverTimestamp(), source: 'csv',
        })
        done += 1
      }
      toast?.success?.(ar ? `استُوردت ${done} حركة` : `Imported ${done} rows`)
      setImportText(''); setImportOpen(false)
    } catch (err) {
      toast?.error?.((ar ? `توقف الاستيراد بعد ${done}: ` : `Import stopped after ${done}: `) + (err?.message || err))
    } finally { setSaving(false) }
  }

  const exportCsv = () => downloadCsv('expenses.csv', rows.map((r) => ({
    date: fmtDate(r.ms, ar), amount: r.amount, account: ar ? accountAr(r.accountCode) : accountEn(r.accountCode),
    supplier: r.supplier || '', note: r.note || '', vatable: r.vatable ? '1' : '0', vatAmount: r.vatAmount || '', bill: r.billUrl || '',
  })), [
    { key: 'date', label: ar ? 'التاريخ' : 'Date' },
    { key: 'amount', label: ar ? 'المبلغ' : 'Amount' },
    { key: 'account', label: ar ? 'الحساب' : 'Account' },
    { key: 'supplier', label: ar ? 'المورد' : 'Supplier' },
    { key: 'note', label: ar ? 'ملاحظة' : 'Note' },
    { key: 'vatable', label: ar ? 'خاضع للضريبة' : 'Vatable' },
    { key: 'vatAmount', label: ar ? 'قيمة الضريبة' : 'VAT' },
    { key: 'bill', label: ar ? 'الفاتورة' : 'Bill' },
  ])

  const isImage = (r) => /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(r.billUrl || '')

  return (
    <div className="acc-stack">
      {canEdit && (
        <form className="acc-card" onSubmit={submit}>
          <span className="acc-card-title"><Icon name="add" size={17} /> {ar ? 'تسجيل مصروف' : 'Record an expense'}</span>
          <div className="acc-form-grid">
            <label className="acc-field">
              <span>{ar ? 'المبلغ' : 'Amount'}</span>
              <input className="input num" type="number" step="0.01" min="0" inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} required />
            </label>
            <label className="acc-field">
              <span>{ar ? 'البند المحاسبي' : 'Account'}</span>
              <select className="input" value={form.account} onChange={(e) => set('account', e.target.value)}>
                {EXPENSE_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{ar ? a.ar : a.en}</option>)}
              </select>
            </label>
            <label className="acc-field">
              <span>{ar ? 'التاريخ' : 'Date'}</span>
              <input className="input" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
            </label>
            <label className="acc-field">
              <span>{ar ? 'المورد' : 'Supplier'}</span>
              <input className="input" value={form.supplier} onChange={(e) => set('supplier', e.target.value)} placeholder={ar ? 'اختياري' : 'Optional'} />
            </label>
            <label className="acc-field acc-field-wide">
              <span>{ar ? 'ملاحظة' : 'Note'}</span>
              <input className="input" value={form.note} onChange={(e) => set('note', e.target.value)} placeholder={ar ? 'وصف مختصر للفاتورة' : 'Short description'} />
            </label>
            <label className="acc-field">
              <span>{ar ? 'صورة الفاتورة' : 'Bill file'}</span>
              <input ref={fileRef} className="input" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
          </div>

          <label className="acc-check">
            <input type="checkbox" checked={form.vatable} onChange={(e) => set('vatable', e.target.checked)} />
            <span>{ar ? 'فاتورة ضريبية (خاضعة لضريبة القيمة المضافة)' : 'Tax invoice (vatable)'}</span>
          </label>
          {form.vatable && (
            <label className="acc-field" style={{ maxWidth: 220 }}>
              <span>{ar ? `قيمة الضريبة — اتركه فارغاً ليُحسب بنسبة ${vatRate}%` : `VAT amount (auto at ${vatRate}%)`}</span>
              <input className="input num" type="number" step="0.01" min="0" value={form.vatAmount} onChange={(e) => set('vatAmount', e.target.value)} placeholder={String(autoVat(form.amount) || '')} />
            </label>
          )}

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
              <Icon name="check" size={15} /> {saving ? (ar ? 'جارٍ الحفظ' : 'Saving') : (ar ? 'حفظ المصروف' : 'Save expense')}
            </button>
            <button className="btn btn-outline btn-sm" type="button" onClick={() => setImportOpen((v) => !v)}>
              <Icon name="upload" size={15} /> {ar ? 'استيراد من CSV' : 'Import CSV'}
            </button>
          </div>

          {importOpen && (
            <div className="acc-import">
              <p className="acc-hint">{ar ? 'الصق الأسطر بالترتيب: التاريخ, المبلغ, البند, المورد, ملاحظة, خاضع للضريبة' : 'Paste rows: date, amount, category, supplier, note, vatable'}</p>
              <textarea
                className="input acc-import-box"
                rows={5}
                dir="ltr"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={'2026-07-01, 1500, rent, Al Salam, monthly rent, 1'}
              />
              <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <span className="acc-hint">
                  {ar ? `جاهز: ${parsed.ok.length}` : `Ready: ${parsed.ok.length}`}
                  {parsed.bad.length ? (ar ? ` · أسطر غير مفهومة: ${parsed.bad.length}` : ` · unreadable: ${parsed.bad.length}`) : ''}
                </span>
                <button className="btn btn-sm btn-primary" type="button" onClick={runImport} disabled={!parsed.ok.length || saving}>
                  {ar ? `استيراد ${parsed.ok.length}` : `Import ${parsed.ok.length}`}
                </button>
              </div>
              {parsed.bad.length > 0 && (
                <p className="acc-hint" style={{ color: 'var(--danger)' }}>
                  {ar ? 'لن تُستورد الأسطر التالية لأن التاريخ أو المبلغ غير صالح: ' : 'Skipped (bad date/amount): '}
                  {parsed.bad.map((b) => b.line).join(', ')}
                </p>
              )}
            </div>
          )}
        </form>
      )}

      <div className="acc-card">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="acc-card-title"><Icon name="wallet" size={17} /> {ar ? 'مصروفات الفترة' : 'Expenses'}</span>
          <span className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="acc-num bold"><M v={total} /></span>
            <button className="btn btn-sm btn-outline" onClick={exportCsv} disabled={!rows.length}><Icon name="download" size={15} /> CSV</button>
          </span>
        </div>
        {!rows.length ? (
          <p className="acc-empty">{ar ? 'لا مصروفات مسجّلة في هذه الفترة.' : 'No expenses in this period.'}</p>
        ) : (
          <div className="acc-scroll-x">
            <table className="acc-table">
              <thead>
                <tr>
                  <th>{ar ? 'التاريخ' : 'Date'}</th>
                  <th>{ar ? 'البند' : 'Account'}</th>
                  <th>{ar ? 'المورد / ملاحظة' : 'Supplier / note'}</th>
                  <th className="acc-ta-end">{ar ? 'المبلغ' : 'Amount'}</th>
                  <th className="acc-ta-end">{ar ? 'الفاتورة' : 'Bill'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="acc-num acc-nowrap">{fmtDate(r.ms, ar)}</td>
                    <td>
                      <span className="acc-acc-tag" data-cat="expense">{ar ? accountAr(r.accountCode) : accountEn(r.accountCode)}</span>
                      {r.vatable && <span className="acc-vat-tag">{ar ? 'ضريبية' : 'VAT'}</span>}
                    </td>
                    <td className="acc-note-cell">{[r.supplier, r.note].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="acc-ta-end acc-num"><M v={r.amount} /></td>
                    <td className="acc-ta-end">
                      <span className="acc-row-actions">
                        {r.billUrl ? (
                          <button className="icon-btn" title={ar ? 'عرض الفاتورة' : 'View bill'} onClick={() => setPreview(r)}><Icon name="eye" size={15} /></button>
                        ) : canEdit ? (
                          <label className="icon-btn acc-attach" title={ar ? 'إرفاق فاتورة' : 'Attach bill'}>
                            {uploadingId === r.id ? <Icon name="reload" size={15} /> : <Icon name="clip" size={15} />}
                            <input type="file" accept="image/*,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; attachBill(r, f) }} />
                          </label>
                        ) : <span className="faint">—</span>}
                        {canEdit && <button className="icon-btn acc-danger" title={ar ? 'حذف' : 'Delete'} onClick={() => remove(r)}><Icon name="delete" size={14} /></button>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="acc-card">
        <span className="acc-card-title"><Icon name="folder" size={17} /> {ar ? 'خزنة الفواتير' : 'Bills vault'}</span>
        {!withBills.length ? (
          <p className="acc-empty">{ar ? 'لا فواتير مرفقة بعد — أرفق صورة أو PDF لكل مصروف ليبقى مستنده محفوظاً.' : 'No bills attached yet.'}</p>
        ) : (
          <div className="acc-bill-grid">
            {withBills.map((r) => (
              <button key={r.id} type="button" className="acc-bill" onClick={() => setPreview(r)}>
                <span className="acc-bill-thumb">
                  {isImage(r)
                    ? <img src={r.billUrl} alt={r.billName || ''} loading="lazy" />
                    : <Icon name="file" size={26} />}
                </span>
                <span className="acc-bill-meta">
                  <strong>{ar ? accountAr(r.accountCode) : accountEn(r.accountCode)}</strong>
                  <span className="acc-num"><M v={r.amount} /></span>
                  <span className="acc-period-label">{fmtDate(r.ms, ar)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {preview && (
        <div className="acc-lightbox" role="dialog" aria-modal="true" onClick={() => setPreview(null)}>
          <div className="acc-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <div className="row-between" style={{ gap: 8 }}>
              <strong>{[preview.supplier, preview.note].filter(Boolean).join(' · ') || (ar ? 'فاتورة' : 'Bill')}</strong>
              <button className="icon-btn" onClick={() => setPreview(null)} aria-label={ar ? 'إغلاق' : 'Close'}><Icon name="close" size={17} /></button>
            </div>
            <div className="acc-lightbox-body acc-scroll-y">
              {isImage(preview)
                ? <img src={preview.billUrl} alt={preview.billName || ''} />
                : <p className="acc-hint">{ar ? 'الملف ليس صورة — افتحه في تبويب جديد.' : 'Not an image file.'}</p>}
            </div>
            <a className="btn btn-sm btn-outline" href={preview.billUrl} target="_blank" rel="noreferrer">
              <Icon name="share" size={15} /> {ar ? 'فتح الملف' : 'Open file'}
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
