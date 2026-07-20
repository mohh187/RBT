import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { db } from '../../lib/firebase.js'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { Spinner } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { CAP } from '../../lib/permissions.js'
import { planAllows } from '../../lib/plans.js'
import { listOrdersSince, listExpensesSince, listItems, listMaterials, listStaff } from '../../lib/db.js'
import {
  PERIODS, periodRange, buildLedger, profitAndLoss, cashFlow, vatReturn,
  inventoryValuation, cogsRatioByItem, anomalies, breakEven, dailySeries, aiSnapshot,
  accruePayroll, accountAr, accountEn, fmtDate, fmtDateTime, toMs, mapExpenseAccount,
} from '../../lib/accounting.js'

import AccountingDashboard from '../../components/accounting/AccountingDashboard.jsx'
import PnlView from '../../components/accounting/PnlView.jsx'
import LedgerTable from '../../components/accounting/LedgerTable.jsx'
import CashFlowView from '../../components/accounting/CashFlowView.jsx'
import VatView from '../../components/accounting/VatView.jsx'
import BillsVault from '../../components/accounting/BillsVault.jsx'
import MarginsView from '../../components/accounting/MarginsView.jsx'
import AiAccountant from '../../components/accounting/AiAccountant.jsx'
import ExportView from '../../components/accounting/ExportView.jsx'

const TABS = [
  { key: 'dash', icon: 'chartBar', ar: 'لوحة المحاسب', en: 'Dashboard' },
  { key: 'pnl', icon: 'notepad', ar: 'قائمة الدخل', en: 'Income statement' },
  { key: 'ledger', icon: 'list', ar: 'دفتر اليومية', en: 'Journal' },
  { key: 'cash', icon: 'wallet', ar: 'التدفق النقدي والدرج', en: 'Cash & drawer' },
  { key: 'vat', icon: 'receipt', ar: 'الضريبة', en: 'VAT' },
  { key: 'bills', icon: 'folder', ar: 'المصروفات والفواتير', en: 'Expenses & bills' },
  { key: 'margins', icon: 'scale', ar: 'التكاليف والهوامش', en: 'Costs & margins' },
  { key: 'ai', icon: 'sparkles', ar: 'المحاسب الذكي', en: 'AI accountant' },
  { key: 'export', icon: 'download', ar: 'التصدير', en: 'Export' },
]

const rowsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))
const inputDate = (d) => new Date(d).toISOString().slice(0, 10)

// Collections db.js has no reader for. Read directly (this file may not edit
// db.js) — each is failure-tolerant so one missing rule never blanks the page.
async function fetchPurchaseOrders(tid) {
  try {
    return rowsOf(await getDocs(query(collection(db, 'tenants', tid, 'purchaseOrders'), orderBy('createdAt', 'desc'), limit(400))))
  } catch (_) { return [] }
}
async function fetchDrawerSessions(tid, fromMs) {
  try {
    const all = rowsOf(await getDocs(query(collection(db, 'tenants', tid, 'cashierSessions'), limit(400))))
    return all.filter((s) => (toMs(s.openedAtMs) || toMs(s.openedAt)) >= fromMs)
  } catch (_) { return [] }
}
async function fetchSubscriptionInvoices(tid) {
  try {
    return rowsOf(await getDocs(query(collection(db, 'platformInvoices'), where('tenantId', '==', tid), limit(60))))
  } catch (_) { return [] } // venue may not be allowed to read the platform ledger
}

export default function Accounting() {
  const { lang } = useI18n()
  const ar = lang !== 'en'
  const { tenantId, tenant, isManager, can, profile } = useAuth()
  const currency = tenant?.currency || 'SAR'
  const showMoney = can(CAP.VIEW_REVENUE)
  const canExport = can(CAP.EXPORT_DATA)
  const canEditBills = isManager || can(CAP.MANAGE_SETTINGS)
  const actor = profile?.displayName || profile?.email || ''
  // Gate the AI parts only if the plan actually defines an 'accounting' feature.
  const aiAllowed = planAllows(tenant, 'accounting') && can(CAP.USE_ASSISTANT)

  const [tab, setTab] = useState('dash')
  const [periodKey, setPeriodKey] = useState('month')
  const [custom, setCustom] = useState(() => {
    const { from, to } = periodRange('month')
    return { from: inputDate(from), to: inputDate(to) }
  })
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [includePayroll, setIncludePayroll] = useState(true)

  const { from, to } = useMemo(() => periodRange(periodKey, custom), [periodKey, custom])
  const fromMs = from.getTime()
  const toMsX = to.getTime()

  // Load ONLY the selected period (plus three prior periods of expenses, used by
  // the spike rule). Keyed on the range alone, so switching tabs never refetches.
  useEffect(() => {
    if (!tenantId) return
    let alive = true
    setData(null); setErr('')
    const span = Math.max(86400000, toMsX - fromMs)
    const priorFrom = new Date(fromMs - span * 3)
    ;(async () => {
      try {
        const [orders, expensesAll, items, materials, staff, purchaseOrders, drawerSessions, subscriptions] = await Promise.all([
          listOrdersSince(tenantId, from).catch(() => []),
          listExpensesSince(tenantId, priorFrom).catch(() => []),
          listItems(tenantId).catch(() => []),
          listMaterials(tenantId).catch(() => []),
          listStaff(tenantId).catch(() => []),
          fetchPurchaseOrders(tenantId),
          fetchDrawerSessions(tenantId, fromMs),
          fetchSubscriptionInvoices(tenantId),
        ])
        if (!alive) return
        const stamp = (x) => toMs(x.at) || toMs(x.createdAt)
        setData({
          orders,
          expenses: expensesAll.filter((x) => stamp(x) >= fromMs && stamp(x) <= toMsX),
          priorExpenses: expensesAll.filter((x) => stamp(x) < fromMs),
          items, materials, staff, purchaseOrders, drawerSessions, subscriptions,
        })
      } catch (e) {
        if (alive) setErr(e?.message || String(e))
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, fromMs, toMsX])

  const vatEnabled = !!tenant?.vatEnabled
  const vatRate = Number(tenant?.vatRate ?? 15) || 15

  const payroll = useMemo(
    () => (includePayroll && data ? accruePayroll(data.staff, fromMs, toMsX) : []),
    [data, includePayroll, fromMs, toMsX],
  )

  // The ledger is the single expensive computation; everything else derives from
  // it and is memoized on top, so tab switching is free.
  const ledger = useMemo(() => {
    if (!data) return []
    return buildLedger({
      orders: data.orders, expenses: data.expenses, purchaseOrders: data.purchaseOrders,
      materials: data.materials, items: data.items, payroll,
      subscriptions: data.subscriptions, from: fromMs, to: toMsX, vatEnabled, vatRate,
    })
  }, [data, payroll, fromMs, toMsX, vatEnabled, vatRate])

  const pnl = useMemo(() => profitAndLoss(ledger), [ledger])
  const cf = useMemo(() => cashFlow(ledger, data?.drawerSessions || []), [ledger, data])
  const vat = useMemo(() => vatReturn(ledger, vatRate), [ledger, vatRate])
  const inventory = useMemo(() => inventoryValuation(data?.materials || []), [data])
  const margins = useMemo(() => cogsRatioByItem({ orders: data?.orders || [], items: data?.items || [], materials: data?.materials || [] }), [data])
  const series = useMemo(() => dailySeries(ledger, fromMs, toMsX), [ledger, fromMs, toMsX])
  const be = useMemo(() => breakEven(pnl, pnl.totalExpenses), [pnl])
  const findings = useMemo(() => (data ? anomalies({
    orders: data.orders, expenses: data.expenses, ledger, materials: data.materials,
    items: data.items, drawerSessions: data.drawerSessions, priorExpenses: data.priorExpenses,
    tenant, from: fromMs, to: toMsX,
  }) : []), [data, ledger, tenant, fromMs, toMsX])

  const snapshot = useMemo(() => (data ? aiSnapshot({
    ledger, orders: data.orders, items: data.items, materials: data.materials,
    drawerSessions: data.drawerSessions, findings, tenant, from: fromMs, to: toMsX, vatRate,
  }) : null), [data, ledger, findings, tenant, fromMs, toMsX, vatRate])

  const periodLabel = `${fmtDate(fromMs, ar)} — ${fmtDate(toMsX, ar)}`

  // Flat, export-ready datasets (the AI custom report also builds from these).
  const datasets = useMemo(() => ({
    ledger: ledger.map((e) => ({
      date: fmtDateTime(e.date, ar), type: e.type, account: e.account,
      accountName: ar ? e.accountAr : e.accountEn, debit: e.debit, credit: e.credit, note: e.note, ref: e.ref,
    })),
    pnl: [
      { line: ar ? 'صافي المبيعات' : 'Net sales', amount: pnl.revenueNet },
      { line: ar ? 'خصومات ومردودات' : 'Discounts', amount: pnl.discounts },
      { line: ar ? 'تكلفة البضاعة المباعة' : 'COGS', amount: pnl.cogs },
      { line: ar ? 'مجمل الربح' : 'Gross profit', amount: pnl.grossProfit },
      ...Object.entries(pnl.expensesByCategory).map(([a, v]) => ({ line: ar ? accountAr(a) : accountEn(a), amount: v })),
      { line: ar ? 'إجمالي المصروفات' : 'Total expenses', amount: pnl.totalExpenses },
      { line: ar ? 'صافي الربح' : 'Net profit', amount: pnl.netProfit },
    ],
    expenses: (data?.expenses || []).map((x) => ({
      date: fmtDate(toMs(x.at) || toMs(x.createdAt), ar), amount: Number(x.amount) || 0,
      accountCode: x.account || mapExpenseAccount(x.category),
      account: ar ? accountAr(x.account || mapExpenseAccount(x.category)) : accountEn(x.account || mapExpenseAccount(x.category)),
      supplier: x.supplier || '', note: x.note || '', vatable: x.vatable ? 1 : 0, bill: x.billUrl || '',
    })),
    items: margins.rows.map((r) => ({
      name: r.nameAr, price: r.price, cost: r.cost ?? '', margin: r.margin ?? '',
      marginPct: r.marginPct ?? '', qtySold: r.qtySold, revenue: r.revenue,
    })),
    inventory: inventory.rows.map((m) => ({ name: m.nameAr, qty: m.qty, unit: m.unit, avgCost: m.avgCost, value: m.value })),
    sessions: cf.sessions.map((s) => ({
      opened: fmtDate(s.openedAt, ar), by: s.by, expected: s.expected,
      counted: s.counted ?? '', variance: s.variance ?? '', status: s.status,
    })),
    orders: (data?.orders || []).map((o) => ({
      code: o.code || '', date: fmtDateTime(toMs(o.paidAtMs) || toMs(o.createdAt), ar),
      total: Number(o.total) || 0, status: o.status, method: o.paymentMethod || '', servedBy: o.servedByName || '',
    })),
  }), [ledger, pnl, data, margins, inventory, cf, ar])

  const doPrint = useCallback(() => {
    document.body.classList.add('acc-printing')
    const done = () => { document.body.classList.remove('acc-printing'); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    setTimeout(() => { window.print(); setTimeout(done, 800) }, 60)
  }, [])

  if (!tenantId) return <Spinner />

  return (
    <div className="page acc-page" id="acc-print-root">
      {/* Print-only letterhead — the app chrome is hidden by the print rules */}
      <div className="acc-print-head">
        {tenant?.logoUrl && <img src={tenant.logoUrl} alt="" className="acc-print-logo" />}
        <div>
          <strong>{tenant?.name || ''}</strong>
          <div className="acc-hint">
            {(tenant?.vatNumber || tenant?.taxNumber) ? `${ar ? 'الرقم الضريبي' : 'Tax number'}: ${tenant.vatNumber || tenant.taxNumber}` : ''}
          </div>
        </div>
        <div className="acc-print-period">
          <span>{ar ? 'الفترة' : 'Period'}</span>
          <strong className="acc-num">{periodLabel}</strong>
        </div>
      </div>

      <div className="acc-head acc-no-print">
        <h2 className="page-title">{ar ? 'المحاسبة' : 'Accounting'}</h2>
        <div className="acc-period">
          <div className="segmented">
            {PERIODS.map((p) => (
              <button key={p.key} className={periodKey === p.key ? 'active' : ''} onClick={() => setPeriodKey(p.key)}>
                {ar ? p.ar : p.en}
              </button>
            ))}
          </div>
          {periodKey === 'custom' && (
            <div className="acc-period-custom">
              <input className="input" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              <span className="acc-period-label">—</span>
              <input className="input" type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </div>
          )}
        </div>
      </div>

      <div className="acc-scroll-x acc-no-print">
        <div className="acc-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`chip${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
              <Icon name={t.icon} size={14} /> {ar ? t.ar : t.en}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="acc-warn acc-no-print"><Icon name="warning" size={15} /><span>{ar ? 'تعذّر تحميل البيانات: ' : 'Load failed: '}{err}</span></div>}

      {!data ? <Spinner /> : (
        <>
          {payroll.length > 0 && tab !== 'ai' && (
            <div className="acc-accrual acc-no-print">
              <label className="acc-check">
                <input type="checkbox" checked={includePayroll} onChange={(e) => setIncludePayroll(e.target.checked)} />
                <span>
                  {ar
                    ? `احتساب الرواتب (${payroll.length} موظف) — مأخوذة من الرواتب الشهرية المسجّلة في ملفات الطاقم وموزّعة على أيام الفترة، وليست دفعات فعلية.`
                    : `Include payroll (${payroll.length}) — accrued from registered monthly salaries, not actual payments.`}
                </span>
              </label>
            </div>
          )}

          {tab === 'dash' && (
            <AccountingDashboard
              pnl={pnl} vat={vat} inventory={inventory} series={series} findings={findings} breakEven={be}
              ar={ar} lang={lang} currency={currency} showMoney={showMoney} onJump={setTab}
            />
          )}

          {tab === 'pnl' && (
            <PnlView pnl={pnl} ledger={ledger} ar={ar} lang={lang} currency={currency} showMoney={showMoney} periodLabel={periodLabel} />
          )}

          {tab === 'ledger' && (
            <LedgerTable ledger={ledger} ar={ar} lang={lang} currency={currency} showMoney={showMoney} />
          )}

          {tab === 'cash' && (
            <CashFlowView cf={cf} ar={ar} lang={lang} currency={currency} showMoney={showMoney} />
          )}

          {tab === 'vat' && (
            <VatView vat={vat} ar={ar} lang={lang} currency={currency} showMoney={showMoney} tenant={tenant} periodLabel={periodLabel} onPrint={doPrint} />
          )}

          {tab === 'bills' && (
            <BillsVault
              tenantId={tenantId} expenses={data.expenses} ar={ar} lang={lang} currency={currency}
              showMoney={showMoney} actor={actor} canEdit={canEditBills} vatRate={vatRate}
            />
          )}

          {tab === 'margins' && (
            <MarginsView margins={margins} inventory={inventory} ar={ar} lang={lang} currency={currency} showMoney={showMoney} />
          )}

          {tab === 'ai' && (
            <AiAccountant
              snapshot={snapshot} ar={ar} disabled={!aiAllowed}
              disabledReason={!aiAllowed ? (ar ? 'المحاسب الذكي غير متاح في باقتك أو لا تملك صلاحية استخدام المساعد.' : 'Not available on your plan.') : ''}
            />
          )}

          {tab === 'export' && (
            <ExportView datasets={datasets} snapshot={snapshot} ar={ar} showMoney={showMoney} onPrint={doPrint} canExport={canExport} />
          )}

          {/* Printed statement: always the P&L, regardless of the open tab */}
          {tab !== 'pnl' && (
            <div className="acc-print-only">
              <PnlView pnl={pnl} ledger={[]} ar={ar} lang={lang} currency={currency} showMoney={showMoney} periodLabel={periodLabel} />
            </div>
          )}

          <p className="acc-hint acc-no-print acc-foot">
            {ar
              ? `كل رقم في هذه الشاشة محسوب من مستندات المنشأة الفعلية في الفترة المحددة: ${data.orders.length} طلب، ${data.expenses.length} مصروف، ${ledger.length} قيد. لا توجد أي تقديرات.`
              : `Every figure is computed from real documents: ${data.orders.length} orders, ${data.expenses.length} expenses, ${ledger.length} journal entries.`}
            {vatEnabled ? '' : (ar ? ' ضريبة القيمة المضافة غير مفعّلة في الإعدادات، لذلك لا تُحتسب.' : ' VAT is disabled in settings.')}
          </p>
        </>
      )}
    </div>
  )
}
