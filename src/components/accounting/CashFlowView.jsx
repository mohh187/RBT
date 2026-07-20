import { Price } from '../Riyal.jsx'
import Icon from '../Icon.jsx'
import { METHOD_LABELS, accountAr, accountEn, fmtDate, downloadCsv } from '../../lib/accounting.js'

// Inflow by payment method, outflow by account, and the drawer reconciliation.
// Variance is shown against what the cashier ACTUALLY counted — never a guess.
export default function CashFlowView({ cf, ar = true, lang = 'ar', currency = 'SAR', showMoney = true }) {
  const M = ({ v }) => (showMoney ? <Price value={v} currency={currency} lang={lang} /> : <span className="faint">—</span>)

  const inflow = Object.entries(cf.inflowByMethod || {}).sort((a, b) => b[1] - a[1])
  const outflow = Object.entries(cf.outflowByAccount || {}).sort((a, b) => b[1] - a[1])
  const maxIn = Math.max(1, ...inflow.map(([, v]) => v))
  const maxOut = Math.max(1, ...outflow.map(([, v]) => v))

  const exportSessions = () => downloadCsv('drawer-sessions.csv', cf.sessions.map((s) => ({
    opened: fmtDate(s.openedAt, ar), closed: s.closedAt ? fmtDate(s.closedAt, ar) : '',
    by: s.by, opening: s.openingFloat, cash: s.cashSales, expected: s.expected,
    counted: s.counted == null ? '' : s.counted, variance: s.variance == null ? '' : s.variance, status: s.status,
  })), [
    { key: 'opened', label: ar ? 'الفتح' : 'Opened' },
    { key: 'closed', label: ar ? 'الإغلاق' : 'Closed' },
    { key: 'by', label: ar ? 'الموظف' : 'By' },
    { key: 'opening', label: ar ? 'رصيد افتتاحي' : 'Opening float' },
    { key: 'cash', label: ar ? 'مبيعات نقدية' : 'Cash sales' },
    { key: 'expected', label: ar ? 'المتوقع' : 'Expected' },
    { key: 'counted', label: ar ? 'المعدود' : 'Counted' },
    { key: 'variance', label: ar ? 'الفرق' : 'Variance' },
    { key: 'status', label: ar ? 'الحالة' : 'Status' },
  ])

  return (
    <div className="acc-stack">
      <div className="acc-kpis">
        <div className="acc-kpi" data-tone="good">
          <span className="acc-kpi-label">{ar ? 'التدفق الداخل' : 'Inflow'}</span>
          <span className="acc-kpi-value"><M v={cf.inflow} /></span>
        </div>
        <div className="acc-kpi" data-tone="bad">
          <span className="acc-kpi-label">{ar ? 'التدفق الخارج' : 'Outflow'}</span>
          <span className="acc-kpi-value"><M v={cf.outflow} /></span>
        </div>
        <div className="acc-kpi" data-tone={cf.net >= 0 ? 'good' : 'bad'}>
          <span className="acc-kpi-label">{ar ? 'صافي التدفق' : 'Net cash flow'}</span>
          <span className="acc-kpi-value"><M v={cf.net} /></span>
        </div>
        <div className="acc-kpi" data-tone={cf.totalVariance === 0 ? '' : 'bad'}>
          <span className="acc-kpi-label">{ar ? 'فروقات الدرج' : 'Drawer variance'}</span>
          <span className="acc-kpi-value"><M v={cf.totalVariance} /></span>
          <span className="acc-kpi-sub">{ar ? `${cf.sessionsCount} وردية` : `${cf.sessionsCount} sessions`}</span>
        </div>
      </div>

      <div className="acc-two-col">
        <div className="acc-card">
          <span className="acc-card-title"><Icon name="wallet" size={17} /> {ar ? 'الداخل حسب طريقة الدفع' : 'Inflow by method'}</span>
          {!inflow.length ? <p className="acc-empty">{ar ? 'لا تحصيلات في الفترة.' : 'No inflow.'}</p> : inflow.map(([m, v]) => (
            <div key={m} className="acc-bar-row">
              <span className="acc-bar-label">{METHOD_LABELS[m]?.[ar ? 'ar' : 'en'] || m}</span>
              <span className="acc-bar-track"><span className="acc-bar-fill" style={{ width: `${(v / maxIn) * 100}%` }} /></span>
              <span className="acc-bar-val acc-num"><M v={v} /></span>
            </div>
          ))}
        </div>

        <div className="acc-card">
          <span className="acc-card-title"><Icon name="arrowUpDown" size={17} /> {ar ? 'الخارج حسب البند' : 'Outflow by account'}</span>
          {!outflow.length ? <p className="acc-empty">{ar ? 'لا مدفوعات في الفترة.' : 'No outflow.'}</p> : outflow.map(([acc, v]) => (
            <div key={acc} className="acc-bar-row">
              <span className="acc-bar-label">{ar ? accountAr(acc) : accountEn(acc)}</span>
              <span className="acc-bar-track"><span className="acc-bar-fill is-out" style={{ width: `${(v / maxOut) * 100}%` }} /></span>
              <span className="acc-bar-val acc-num"><M v={v} /></span>
            </div>
          ))}
        </div>
      </div>

      <div className="acc-card">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="acc-card-title"><Icon name="cashier" size={17} /> {ar ? 'مطابقة درج النقد' : 'Drawer reconciliation'}</span>
          <button className="btn btn-sm btn-outline" onClick={exportSessions} disabled={!cf.sessions.length}><Icon name="download" size={15} /> CSV</button>
        </div>
        {!cf.sessions.length ? (
          <p className="acc-empty">{ar ? 'لا ورديات درج في هذه الفترة — افتح الدرج من شاشة الكاشير لتتم المطابقة تلقائياً.' : 'No drawer sessions in this period.'}</p>
        ) : (
          <div className="acc-scroll-x">
            <table className="acc-table">
              <thead>
                <tr>
                  <th>{ar ? 'الوردية' : 'Session'}</th>
                  <th>{ar ? 'الموظف' : 'By'}</th>
                  <th className="acc-ta-end">{ar ? 'المتوقع' : 'Expected'}</th>
                  <th className="acc-ta-end">{ar ? 'المعدود' : 'Counted'}</th>
                  <th className="acc-ta-end">{ar ? 'الفرق' : 'Variance'}</th>
                </tr>
              </thead>
              <tbody>
                {cf.sessions.map((s) => (
                  <tr key={s.id} data-variance={s.variance == null ? 'open' : (s.variance === 0 ? 'ok' : (Math.abs(s.variance) >= 50 ? 'high' : 'low'))}>
                    <td className="acc-num acc-nowrap">{fmtDate(s.openedAt, ar)}</td>
                    <td className="acc-nowrap">{s.by || '—'}</td>
                    <td className="acc-ta-end acc-num"><M v={s.expected} /></td>
                    <td className="acc-ta-end acc-num">{s.counted == null ? <span className="faint">{ar ? 'مفتوحة' : 'Open'}</span> : <M v={s.counted} />}</td>
                    <td className="acc-ta-end acc-num acc-var-cell">
                      {s.variance == null ? <span className="faint">—</span> : <M v={s.variance} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
