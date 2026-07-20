import { useMemo, useState } from 'react'
import { Price } from '../Riyal.jsx'
import Icon from '../Icon.jsx'
import { ACCOUNTS, fmtDateTime, downloadCsv } from '../../lib/accounting.js'

const TYPE_LABELS = {
  sale: { ar: 'مبيعات', en: 'Sale' },
  cogs: { ar: 'تكلفة بضاعة', en: 'COGS' },
  expense: { ar: 'مصروف', en: 'Expense' },
  purchase: { ar: 'شراء', en: 'Purchase' },
  payroll: { ar: 'رواتب', en: 'Payroll' },
  subscription: { ar: 'اشتراك', en: 'Subscription' },
}

const PAGE = 300

// The full journal. Rendering is capped at PAGE rows with an explicit "load
// more" so a year of orders cannot freeze the tab.
export default function LedgerTable({ ledger = [], ar = true, lang = 'ar', currency = 'SAR', showMoney = true, title }) {
  const [q, setQ] = useState('')
  const [account, setAccount] = useState('')
  const [type, setType] = useState('')
  const [shown, setShown] = useState(PAGE)

  const usedAccounts = useMemo(() => {
    const set = new Set(ledger.map((e) => e.account))
    return Object.values(ACCOUNTS).filter((a) => set.has(a.code))
  }, [ledger])

  const usedTypes = useMemo(() => [...new Set(ledger.map((e) => e.type))], [ledger])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return ledger.filter((e) => {
      if (account && e.account !== account) return false
      if (type && e.type !== type) return false
      if (!needle) return true
      return `${e.accountAr} ${e.accountEn} ${e.note} ${e.ref}`.toLowerCase().includes(needle)
    })
  }, [ledger, q, account, type])

  const totals = useMemo(() => rows.reduce((s, e) => ({ debit: s.debit + (e.debit || 0), credit: s.credit + (e.credit || 0) }), { debit: 0, credit: 0 }), [rows])

  const visible = rows.slice(0, shown)
  const M = ({ v }) => (showMoney ? <Price value={v} currency={currency} lang={lang} /> : <span className="faint">—</span>)

  const exportCsv = () => {
    downloadCsv('journal.csv', rows.map((e) => ({
      date: fmtDateTime(e.date, ar),
      type: TYPE_LABELS[e.type]?.[ar ? 'ar' : 'en'] || e.type,
      account: ar ? e.accountAr : e.accountEn,
      debit: e.debit || '',
      credit: e.credit || '',
      ref: e.ref,
      note: e.note,
    })), [
      { key: 'date', label: ar ? 'التاريخ' : 'Date' },
      { key: 'type', label: ar ? 'النوع' : 'Type' },
      { key: 'account', label: ar ? 'الحساب' : 'Account' },
      { key: 'debit', label: ar ? 'مدين' : 'Debit' },
      { key: 'credit', label: ar ? 'دائن' : 'Credit' },
      { key: 'ref', label: ar ? 'المرجع' : 'Ref' },
      { key: 'note', label: ar ? 'البيان' : 'Note' },
    ])
  }

  return (
    <div className="acc-card">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="acc-card-title"><Icon name="notepad" size={17} /> {title || (ar ? 'دفتر اليومية' : 'Journal')}</span>
        <button className="btn btn-sm btn-outline" onClick={exportCsv} disabled={!rows.length}><Icon name="download" size={15} /> CSV</button>
      </div>

      <div className="acc-filters">
        <input className="input" placeholder={ar ? 'بحث في البيان أو المرجع' : 'Search note or ref'} value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE) }} />
        <select className="input" value={account} onChange={(e) => { setAccount(e.target.value); setShown(PAGE) }}>
          <option value="">{ar ? 'كل الحسابات' : 'All accounts'}</option>
          {usedAccounts.map((a) => <option key={a.code} value={a.code}>{ar ? a.ar : a.en}</option>)}
        </select>
        <select className="input" value={type} onChange={(e) => { setType(e.target.value); setShown(PAGE) }}>
          <option value="">{ar ? 'كل الأنواع' : 'All types'}</option>
          {usedTypes.map((tp) => <option key={tp} value={tp}>{TYPE_LABELS[tp]?.[ar ? 'ar' : 'en'] || tp}</option>)}
        </select>
      </div>

      {!rows.length ? (
        <p className="acc-empty">{ar ? 'لا قيود في هذه الفترة بهذه الشروط.' : 'No entries match.'}</p>
      ) : (
        <>
          <div className="acc-scroll-x">
            <table className="acc-table">
              <thead>
                <tr>
                  <th>{ar ? 'التاريخ' : 'Date'}</th>
                  <th>{ar ? 'الحساب' : 'Account'}</th>
                  <th>{ar ? 'البيان' : 'Note'}</th>
                  <th className="acc-ta-end">{ar ? 'مدين' : 'Debit'}</th>
                  <th className="acc-ta-end">{ar ? 'دائن' : 'Credit'}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr key={e.id}>
                    <td className="acc-num acc-nowrap">{fmtDateTime(e.date, ar)}</td>
                    <td><span className="acc-acc-tag" data-cat={e.category}>{ar ? e.accountAr : e.accountEn}</span></td>
                    <td className="acc-note-cell">{e.note || '—'}</td>
                    <td className="acc-ta-end acc-num">{e.debit ? <M v={e.debit} /> : <span className="faint">—</span>}</td>
                    <td className="acc-ta-end acc-num">{e.credit ? <M v={e.credit} /> : <span className="faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>{ar ? `الإجمالي (${rows.length} قيد)` : `Total (${rows.length} entries)`}</td>
                  <td className="acc-ta-end acc-num"><M v={totals.debit} /></td>
                  <td className="acc-ta-end acc-num"><M v={totals.credit} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {rows.length > shown && (
            <button className="btn btn-sm btn-outline btn-block" onClick={() => setShown((s) => s + PAGE)}>
              {ar ? `عرض المزيد (${rows.length - shown} متبقٍ)` : `Load more (${rows.length - shown} left)`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
