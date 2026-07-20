import { useState } from 'react'
import { Price } from '../Riyal.jsx'
import Icon from '../Icon.jsx'
import { ACCOUNTS, accountAr, accountEn, entriesForLine, fmtDateTime, downloadCsv } from '../../lib/accounting.js'

// Income statement. EVERY line is clickable and opens the exact journal entries
// that produced it — a number the manager cannot trace is a number they cannot
// trust, so drill-down is not optional here.
export default function PnlView({ pnl, ledger = [], ar = true, lang = 'ar', currency = 'SAR', showMoney = true, periodLabel = '' }) {
  const [open, setOpen] = useState(null)

  const M = ({ v }) => (showMoney ? <Price value={v} currency={currency} lang={lang} /> : <span className="faint">—</span>)
  const toggle = (key) => setOpen((o) => (o === key ? null : key))

  const expenseRows = Object.entries(pnl.expensesByCategory || {}).sort((a, b) => b[1] - a[1])

  const drill = (key) => {
    const entries = entriesForLine(ledger, key)
    if (!entries.length) return <p className="acc-empty">{ar ? 'لا مستندات خلف هذا البند في الفترة.' : 'No documents behind this line.'}</p>
    const rows = entries.slice(0, 200)
    return (
      <div className="acc-drill">
        <div className="row-between" style={{ marginBottom: 6 }}>
          <span className="acc-hint">
            {ar ? `${entries.length} قيد${entries.length > 200 ? ' — يعرض أول ' + rows.length : ''}` : `${entries.length} entries`}
          </span>
          <button
            className="btn btn-xs btn-outline"
            onClick={() => downloadCsv(`pnl-${key}.csv`, entries.map((e) => ({
              date: fmtDateTime(e.date, ar), account: ar ? e.accountAr : e.accountEn, note: e.note, debit: e.debit || '', credit: e.credit || '', ref: e.ref,
            })), [
              { key: 'date', label: ar ? 'التاريخ' : 'Date' },
              { key: 'account', label: ar ? 'الحساب' : 'Account' },
              { key: 'note', label: ar ? 'البيان' : 'Note' },
              { key: 'debit', label: ar ? 'مدين' : 'Debit' },
              { key: 'credit', label: ar ? 'دائن' : 'Credit' },
              { key: 'ref', label: ar ? 'المرجع' : 'Ref' },
            ])}
          >
            <Icon name="download" size={13} /> CSV
          </button>
        </div>
        <div className="acc-scroll-y acc-drill-scroll">
          {rows.map((e) => (
            <div key={e.id} className="acc-drill-row">
              <span className="acc-num acc-nowrap acc-drill-date">{fmtDateTime(e.date, ar)}</span>
              <span className="acc-drill-note">{e.note || (ar ? e.accountAr : e.accountEn)}</span>
              <span className="acc-num acc-drill-amt"><M v={e.debit || e.credit} /></span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const Line = ({ label, value, drillKey, tone, strong, indent, pct }) => (
    <>
      <button
        type="button"
        className={`acc-pnl-row${strong ? ' is-strong' : ''}${indent ? ' is-indent' : ''}${drillKey ? '' : ' is-static'}`}
        data-tone={tone || ''}
        onClick={drillKey ? () => toggle(drillKey) : undefined}
        aria-expanded={drillKey ? open === drillKey : undefined}
      >
        <span className="acc-pnl-label">
          {drillKey && <Icon name={open === drillKey ? 'arrowUpDown' : 'next'} size={13} />}
          {label}
        </span>
        <span className="acc-pnl-val acc-num">
          {pct != null && <em className="acc-pnl-pct">{pct}%</em>}
          <M v={value} />
        </span>
      </button>
      {drillKey && open === drillKey && drill(drillKey)}
    </>
  )

  return (
    <div className="acc-card">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="acc-card-title"><Icon name="chartBar" size={17} /> {ar ? 'قائمة الدخل' : 'Income statement'}</span>
        {periodLabel && <span className="acc-period-label">{periodLabel}</span>}
      </div>
      <p className="acc-hint">{ar ? 'اضغط أي بند لعرض المستندات الحقيقية التي كوّنته.' : 'Tap any line to see the documents behind it.'}</p>

      <div className="acc-pnl">
        <Line label={ar ? 'إجمالي المبيعات' : 'Gross sales'} value={pnl.revenueGross} drillKey="revenue" />
        <Line label={ar ? 'خصومات ومردودات' : 'Discounts & returns'} value={-pnl.discounts} drillKey="discounts" tone="bad" indent />
        <Line label={ar ? 'صافي المبيعات' : 'Net sales'} value={pnl.revenueNet} strong />

        <Line label={ar ? 'تكلفة البضاعة المباعة' : 'Cost of goods sold'} value={-pnl.cogs} drillKey="cogs" tone="bad" />
        <Line label={ar ? 'مجمل الربح' : 'Gross profit'} value={pnl.grossProfit} strong tone={pnl.grossProfit >= 0 ? 'good' : 'bad'} pct={pnl.grossMarginPct} />

        <div className="acc-pnl-group">{ar ? 'المصروفات التشغيلية' : 'Operating expenses'}</div>
        {expenseRows.length === 0 && <p className="acc-empty">{ar ? 'لا مصروفات مسجّلة في الفترة.' : 'No expenses recorded.'}</p>}
        {expenseRows.map(([acc, amt]) => (
          <Line key={acc} label={ar ? accountAr(acc) : accountEn(acc)} value={-amt} drillKey={acc} tone="bad" indent />
        ))}
        <Line label={ar ? 'إجمالي المصروفات' : 'Total expenses'} value={-pnl.totalExpenses} drillKey="expenses" strong tone="bad" />

        <Line
          label={ar ? 'صافي الربح' : 'Net profit'}
          value={pnl.netProfit}
          strong
          tone={pnl.netProfit >= 0 ? 'good' : 'bad'}
          pct={pnl.netMarginPct}
        />
      </div>

      <div className="acc-pnl-notes">
        <p className="acc-hint">
          {ar
            ? `ضريبة القيمة المضافة المحصّلة (${ACCOUNTS.vatPayable.ar}) لا تدخل في الإيراد — هي التزام على المنشأة.`
            : 'Collected VAT is a liability, not revenue, so it is excluded from the statement.'}
        </p>
        <div className="acc-pnl-memo">
          <span>{ar ? 'ضريبة محصّلة' : 'VAT collected'}</span>
          <span className="acc-num"><M v={pnl.vat} /></span>
        </div>
        {pnl.tips > 0 && (
          <div className="acc-pnl-memo">
            <span>{ar ? 'إكراميات مستحقة للموظفين' : 'Tips payable to staff'}</span>
            <span className="acc-num"><M v={pnl.tips} /></span>
          </div>
        )}
      </div>
    </div>
  )
}
