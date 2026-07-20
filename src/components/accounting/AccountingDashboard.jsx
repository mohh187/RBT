import { useState } from 'react'
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Price } from '../Riyal.jsx'
import Icon from '../Icon.jsx'
import { money } from '../../lib/format.js'
import { fmtDate } from '../../lib/accounting.js'

const SEV = {
  high: { ar: 'حرج', en: 'Critical' },
  medium: { ar: 'مهم', en: 'Important' },
  low: { ar: 'ملاحظة', en: 'Note' },
}

// Accountant dashboard: the six figures a manager checks first, the profit
// trend, and the rule-based findings. Every finding card exposes the exact
// numbers that triggered it — none of this comes from a model.
export default function AccountingDashboard({
  pnl, vat, inventory, series = [], findings = [], breakEven: be,
  ar = true, lang = 'ar', currency = 'SAR', showMoney = true, onJump,
}) {
  const [openFinding, setOpenFinding] = useState(null)
  const M = ({ v }) => (showMoney ? <Price value={v} currency={currency} lang={lang} /> : <span className="faint">—</span>)

  const chartData = series.map((b) => ({
    day: fmtDate(b.ms, ar).slice(0, 5),
    profit: Math.round(b.profit),
    revenue: Math.round(b.revenue),
  }))
  const hasChart = chartData.some((d) => d.revenue !== 0 || d.profit !== 0)

  return (
    <div className="acc-stack">
      <div className="acc-kpis">
        <div className="acc-kpi" data-tone={pnl.netProfit >= 0 ? 'good' : 'bad'}>
          <span className="acc-kpi-label">{ar ? 'صافي الربح' : 'Net profit'}</span>
          <span className="acc-kpi-value"><M v={pnl.netProfit} /></span>
        </div>
        <div className="acc-kpi" data-tone={pnl.netMarginPct >= 0 ? 'good' : 'bad'}>
          <span className="acc-kpi-label">{ar ? 'هامش الربح الصافي' : 'Net margin'}</span>
          <span className="acc-kpi-value acc-num">{pnl.netMarginPct}%</span>
          <span className="acc-kpi-sub">{ar ? `مجمل الربح ${pnl.grossMarginPct}%` : `Gross ${pnl.grossMarginPct}%`}</span>
        </div>
        <div className="acc-kpi">
          <span className="acc-kpi-label">{ar ? 'المبيعات الصافية' : 'Net sales'}</span>
          <span className="acc-kpi-value"><M v={pnl.revenueNet} /></span>
        </div>
        <div className="acc-kpi" data-tone="bad">
          <span className="acc-kpi-label">{ar ? 'إجمالي التكاليف' : 'Total costs'}</span>
          <span className="acc-kpi-value"><M v={pnl.cogs + pnl.totalExpenses} /></span>
          <span className="acc-kpi-sub">{ar ? `تكلفة بضاعة ${pnl.cogs}` : `COGS ${pnl.cogs}`}</span>
        </div>
        <div className="acc-kpi">
          <span className="acc-kpi-label">{ar ? 'الضريبة المستحقة' : 'VAT payable'}</span>
          <span className="acc-kpi-value"><M v={vat.netPayable} /></span>
        </div>
        <div className="acc-kpi">
          <span className="acc-kpi-label">{ar ? 'قيمة المخزون' : 'Inventory value'}</span>
          <span className="acc-kpi-value"><M v={inventory.total} /></span>
        </div>
      </div>

      <div className="acc-card">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="acc-card-title"><Icon name="trending" size={17} /> {ar ? 'اتجاه الربح اليومي' : 'Daily profit trend'}</span>
          <span className="acc-legend">
            <span className="acc-legend-dot is-pos" /> {ar ? 'ربح' : 'Profit'}
            <span className="acc-legend-dot is-neg" /> {ar ? 'خسارة' : 'Loss'}
          </span>
        </div>
        {!hasChart ? (
          <p className="acc-empty">{ar ? 'لا حركة مالية في هذه الفترة.' : 'No activity in this period.'}</p>
        ) : (
          <div className="acc-chart">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} interval="preserveStartEnd" />
                <Tooltip
                  cursor={{ fill: 'var(--surface-2)' }}
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12.5 }}
                  formatter={(v, k) => [showMoney ? money(v, currency, lang) : '—', k === 'profit' ? (ar ? 'الربح' : 'Profit') : (ar ? 'الإيراد' : 'Revenue')]}
                />
                <Bar dataKey="profit" radius={[5, 5, 0, 0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.profit >= 0 ? 'var(--success)' : 'var(--danger)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {be?.possible && (
        <div className="acc-card">
          <span className="acc-card-title"><Icon name="scale" size={17} /> {ar ? 'نقطة التعادل' : 'Break-even'}</span>
          <div className="acc-be">
            <div><span className="acc-kpi-label">{ar ? 'مبيعات التعادل' : 'Break-even sales'}</span><strong className="acc-num"><M v={be.breakEvenRevenue} /></strong></div>
            <div><span className="acc-kpi-label">{ar ? 'نسبة المساهمة' : 'Contribution'}</span><strong className="acc-num">{be.contributionPct}%</strong></div>
            <div>
              <span className="acc-kpi-label">{ar ? 'هامش الأمان' : 'Margin of safety'}</span>
              <strong className="acc-num" style={{ color: be.marginOfSafety >= 0 ? 'var(--success)' : 'var(--danger)' }}><M v={be.marginOfSafety} /></strong>
            </div>
          </div>
          <p className="acc-hint">
            {ar
              ? `تحتاج مبيعات صافية بقيمة ${be.breakEvenRevenue} لتغطية تكاليفك الثابتة المسجّلة في هذه الفترة.`
              : `You need ${be.breakEvenRevenue} in net sales to cover the fixed costs recorded this period.`}
          </p>
        </div>
      )}

      <div className="acc-card">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="acc-card-title"><Icon name="warning" size={17} /> {ar ? 'ملاحظات المراجعة' : 'Audit findings'}</span>
          <span className="acc-period-label">{ar ? `${findings.length} ملاحظة` : `${findings.length} findings`}</span>
        </div>
        <p className="acc-hint">{ar ? 'قواعد ثابتة تعمل على مستنداتك الحقيقية — ليست تخميناً من الذكاء الاصطناعي.' : 'Deterministic rules over your real documents.'}</p>
        {!findings.length ? (
          <p className="acc-empty">{ar ? 'لا ملاحظات على حسابات هذه الفترة.' : 'Nothing flagged this period.'}</p>
        ) : (
          <div className="acc-findings">
            {findings.map((f, i) => (
              <div key={f.id} className="acc-finding" data-sev={f.severity}>
                <div className="acc-finding-head">
                  <span className="acc-sev">{SEV[f.severity]?.[ar ? 'ar' : 'en'] || f.severity}</span>
                  <strong>{f.titleAr}</strong>
                </div>
                <p className="acc-hint">{f.detailAr}</p>
                <div className="acc-finding-foot">
                  <button type="button" className="acc-snap-toggle" onClick={() => setOpenFinding(openFinding === i ? null : i)}>
                    <Icon name={openFinding === i ? 'arrowUpDown' : 'next'} size={12} />
                    {ar ? 'الأرقام' : 'Numbers'}
                  </button>
                  {onJump && f.kind === 'below-cost' && <button type="button" className="acc-snap-toggle" onClick={() => onJump('margins')}>{ar ? 'فتح الهوامش' : 'Open margins'}</button>}
                  {onJump && (f.kind === 'no-expenses' || f.kind === 'bookkeeping-gap' || f.kind === 'expense-spike') && <button type="button" className="acc-snap-toggle" onClick={() => onJump('bills')}>{ar ? 'فتح المصروفات' : 'Open expenses'}</button>}
                  {onJump && f.kind === 'drawer-variance' && <button type="button" className="acc-snap-toggle" onClick={() => onJump('cash')}>{ar ? 'فتح الدرج' : 'Open drawer'}</button>}
                </div>
                {openFinding === i && <pre className="acc-snap acc-scroll-y" dir="ltr">{JSON.stringify(f.numbers, null, 2)}</pre>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
