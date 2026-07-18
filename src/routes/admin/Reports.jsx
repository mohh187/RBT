import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { watchOrdersSince, watchCustomers, watchItems, watchCategories, watchExpensesSince, addExpense, deleteExpense } from '../../lib/db.js'
import { money } from '../../lib/format.js'
import { Price as RiyalPrice } from '../../components/Riyal.jsx'
import Icon from '../../components/Icon.jsx'
import { CAP } from '../../lib/permissions.js'

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d
}
// Rendered in place of an amount for staff lacking the view_revenue cap.
function MaskedPrice() {
  return <span className="faint">—</span>
}
function toDate(ts) {
  if (!ts) return null
  return ts.toDate ? ts.toDate() : new Date(ts)
}

export default function Reports() {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const { tenantId, tenant, isManager, can } = useAuth()
  const currency = tenant?.currency || 'SAR'
  // Money masking: without view_revenue the report keeps counts/rankings but every
  // amount renders as a dash. Shadows the imported Price for this component only.
  const showMoney = can(CAP.VIEW_REVENUE)
  const Price = showMoney ? RiyalPrice : MaskedPrice
  const [range, setRange] = useState(7)
  const [orders, setOrders] = useState(null)
  const [customers, setCustomers] = useState([])
  const [items, setItems] = useState([])
  const [cats, setCats] = useState([])
  const [expenses, setExpenses] = useState([])
  const [expAmt, setExpAmt] = useState('')
  const [expCat, setExpCat] = useState('')
  const { profile } = useAuth()
  const actor = profile?.displayName || profile?.email || ''

  useEffect(() => {
    if (!tenantId) return
    setOrders(null)
    const u1 = watchOrdersSince(tenantId, daysAgo(range), setOrders)
    const u2 = watchCustomers(tenantId, setCustomers)
    const u3 = watchItems(tenantId, setItems)
    const u4 = watchCategories(tenantId, setCats)
    const u5 = watchExpensesSince(tenantId, daysAgo(range), setExpenses)
    return () => { u1(); u2(); u3(); u4(); u5() }
  }, [tenantId, range])

  const expensesTotal = useMemo(() => expenses.reduce((s, e) => s + (e.amount || 0), 0), [expenses])
  const addExp = () => { const amt = Number(expAmt) || 0; if (amt <= 0) return; addExpense(tenantId, { amount: amt, category: expCat.trim() || 'other', actor }); setExpAmt(''); setExpCat('') }

  const report = useMemo(() => {
    const periodStart = daysAgo(range).getTime()
    const list = (orders || []).filter((o) => o.status !== 'cancelled')
    const revenue = list.reduce((s, o) => s + (o.total || 0), 0)
    const count = list.length
    const avg = count ? revenue / count : 0

    // daily revenue
    const buckets = {}
    for (let i = range - 1; i >= 0; i--) {
      const d = daysAgo(i)
      buckets[`${d.getMonth() + 1}/${d.getDate()}`] = 0
    }
    list.forEach((o) => {
      const d = toDate(o.createdAt)
      if (!d) return
      const key = `${d.getMonth() + 1}/${d.getDate()}`
      if (key in buckets) buckets[key] += o.total || 0
    })
    const daily = Object.entries(buckets).map(([day, total]) => ({ day, total: Math.round(total) }))

    // peak hours (orders per hour of day)
    const hours = Array.from({ length: 24 }, (_, h) => ({ h, label: `${h}`, orders: 0 }))
    list.forEach((o) => {
      const d = toDate(o.createdAt)
      if (d) hours[d.getHours()].orders += 1
    })
    const busiest = hours.reduce((m, x) => (x.orders > m.orders ? x : m), hours[0])

    // new vs returning (by customer firstOrderAt vs period start)
    const firstByPhone = {}
    customers.forEach((c) => { firstByPhone[c.id] = toDate(c.firstOrderAt)?.getTime() || 0 })
    const phones = new Set()
    let guests = 0
    list.forEach((o) => {
      const p = (o.customerPhone || '').replace(/[^0-9]/g, '')
      if (p) phones.add(p)
      else guests += 1
    })
    let newC = 0
    let returningC = 0
    phones.forEach((p) => {
      const first = firstByPhone[p]
      if (first && first < periodStart) returningC += 1
      else newC += 1
    })

    // top items
    const tally = {}
    list.forEach((o) => (o.items || []).forEach((it) => {
      const name = lang === 'en' && it.nameEn ? it.nameEn : it.nameAr
      if (!tally[name]) tally[name] = { qty: 0, rev: 0 }
      tally[name].qty += it.qty || 1
      tally[name].rev += it.lineTotal || 0
    }))
    const top = Object.entries(tally).sort((a, b) => b[1].qty - a[1].qty).slice(0, 8)

    // staff performance (by who served)
    const staff = {}
    list.filter((o) => ['served', 'paid'].includes(o.status)).forEach((o) => {
      const k = o.servedByName || '—'
      if (!staff[k]) staff[k] = { orders: 0, rev: 0 }
      staff[k].orders += 1
      staff[k].rev += o.total || 0
    })
    const staffRows = Object.entries(staff).sort((a, b) => b[1].rev - a[1].rev)

    const dineIn = list.filter((o) => o.orderType === 'dine_in').length
    const takeaway = list.filter((o) => o.orderType === 'takeaway').length

    // financial / Z-report: settled (paid + refunded) by payment method + tips + VAT + refunds
    const paidList = (orders || []).filter((o) => ['paid', 'refunded'].includes(o.status))
    const refundOf = (o) => (o.status === 'refunded' ? (o.refund?.amount || 0) : 0)
    const byMethod = {}
    let tips = 0
    let refunds = 0
    const tipsByStaff = {}
    paidList.forEach((o) => {
      const net = (o.total || 0) - refundOf(o)
      if (o.paymentBreakdown) Object.entries(o.paymentBreakdown).forEach(([m, a]) => { byMethod[m] = (byMethod[m] || 0) + (Number(a) || 0) })
      else { const m = o.paymentMethod || 'cash'; byMethod[m] = (byMethod[m] || 0) + net }
      tips += o.tip || 0
      if (o.tip) { const k = o.servedByName || '—'; tipsByStaff[k] = (tipsByStaff[k] || 0) + (o.tip || 0) }
      refunds += refundOf(o)
    })
    const grossPaid = paidList.reduce((s, o) => s + (o.total || 0) - refundOf(o), 0)
    const vatEnabled = tenant?.vatEnabled
    const vatRate = Number(tenant?.vatRate ?? 15) || 15
    const vat = vatEnabled ? Math.round((grossPaid - grossPaid / (1 + vatRate / 100)) * 100) / 100 : 0
    const tipsRows = Object.entries(tipsByStaff).sort((a, b) => b[1] - a[1])
    const methodRows = Object.entries(byMethod).filter(([, v]) => v).sort((a, b) => b[1] - a[1])

    // by category (resolve item → categoryId → name)
    const catOfItem = {}; items.forEach((it) => { catOfItem[it.id] = it.categoryId })
    const catName = {}; cats.forEach((c) => { catName[c.id] = lang === 'en' && c.nameEn ? c.nameEn : c.nameAr })
    const catTally = {}
    list.forEach((o) => (o.items || []).forEach((it) => {
      const cid = it.categoryId || catOfItem[it.itemId] || '—'
      const nm = catName[cid] || (lang === 'ar' ? 'أخرى' : 'Other')
      catTally[nm] = (catTally[nm] || 0) + (it.lineTotal || 0)
    }))
    const byCat = Object.entries(catTally).sort((a, b) => b[1] - a[1]).slice(0, 8)

    return { revenue, count, avg, daily, hours, busiest, newC, returningC, guests, top, staffRows, dineIn, takeaway, methodRows, grossPaid, vat, vatRate, vatEnabled, tips, refunds, tipsRows, byCat }
  }, [orders, customers, items, cats, range, lang, tenant])

  const exportCsv = () => {
    const rows = [['order', 'date', 'type', 'table', 'total', 'status', 'servedBy']]
    ;(orders || []).forEach((o) => {
      const d = toDate(o.createdAt)
      rows.push([o.code || '', d ? d.toISOString() : '', o.orderType || '', o.tableLabel || '', o.total || 0, o.status, o.servedByName || ''])
    })
    const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'orders.csv'
    a.click()
  }

  if (orders === null) return <Spinner />
  const ML = { cash: ar ? 'نقدي' : 'Cash', card: ar ? 'شبكة' : 'Card', transfer: ar ? 'تحويل' : 'Transfer', mixed: ar ? 'مختلط' : 'Mixed', other: ar ? 'أخرى' : 'Other' }

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div className="row-between">
        <h2 className="page-title">{t('reports')}</h2>
        <div className="segmented">
          <button className={range === 7 ? 'active' : ''} onClick={() => setRange(7)}>{t('last7days')}</button>
          <button className={range === 30 ? 'active' : ''} onClick={() => setRange(30)}>{t('last30days')}</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat"><div className="label">{t('revenue')}</div><div className="value price"><Price value={report.revenue} currency={currency} lang={lang} /></div></div>
        <div className="stat"><div className="label">{t('orders')}</div><div className="value num">{report.count}</div></div>
        <div className="stat"><div className="label">{t('avgTicket')}</div><div className="value price"><Price value={report.avg} currency={currency} lang={lang} /></div></div>
        <div className="stat"><div className="label">{t('dineIn')} / {t('takeaway')}</div><div className="value num">{report.dineIn}/{report.takeaway}</div></div>
      </div>

      {/* financial Z-report */}
      <div className="card card-pad stack" style={{ gap: 8 }}>
        <strong className="row" style={{ gap: 6 }}><Icon name="wallet" size={18} /> {ar ? 'الملخّص المالي (Z)' : 'Financial summary (Z)'}</strong>
        {report.methodRows.length === 0 ? <p className="muted small">{t('noData')}</p> : report.methodRows.map(([m, v]) => (
          <div key={m} className="row-between small"><span className="faint">{ML[m] || m}</span><Price value={v} currency={currency} lang={lang} /></div>
        ))}
        {report.tips > 0 && <div className="row-between small"><span className="faint">{ar ? 'إكراميات' : 'Tips'}</span><Price value={report.tips} currency={currency} lang={lang} /></div>}
        {report.refunds > 0 && <div className="row-between small" style={{ color: 'var(--danger)' }}><span>{ar ? 'مستردّات' : 'Refunds'}</span><span>−<Price value={report.refunds} currency={currency} lang={lang} /></span></div>}
        {report.vatEnabled && <div className="row-between small"><span className="faint">{ar ? `ض.ق.م (${report.vatRate}%)` : `VAT (${report.vatRate}%)`}</span><Price value={report.vat} currency={currency} lang={lang} /></div>}
        <div className="row-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}><strong>{ar ? 'صافي المدفوع' : 'Net paid'}</strong><span className="price bold"><Price value={report.grossPaid} currency={currency} lang={lang} /></span></div>
        {expensesTotal > 0 && <div className="row-between small" style={{ color: 'var(--danger)' }}><span>{ar ? 'مصروفات تشغيلية' : 'Operating expenses'}</span><span>−<Price value={expensesTotal} currency={currency} lang={lang} /></span></div>}
        {expensesTotal > 0 && <div className="row-between"><strong>{ar ? 'الصافي بعد المصروفات' : 'Net after expenses'}</strong><span className="price bold" style={{ color: report.grossPaid - expensesTotal >= 0 ? 'var(--success)' : 'var(--danger)' }}><Price value={report.grossPaid - expensesTotal} currency={currency} lang={lang} /></span></div>}
      </div>

      {/* expenses */}
      <div className="card card-pad stack" style={{ gap: 8 }}>
        <strong className="row" style={{ gap: 6 }}><Icon name="wallet" size={18} /> {ar ? 'المصروفات' : 'Expenses'}</strong>
        {isManager && (
          <div className="row" style={{ gap: 6 }}>
            <input className="input num" style={{ maxWidth: 110 }} type="number" placeholder={ar ? 'مبلغ' : 'Amount'} value={expAmt} onChange={(e) => setExpAmt(e.target.value)} />
            <input className="input grow" placeholder={ar ? 'البند (إيجار/رواتب…)' : 'Category'} value={expCat} onChange={(e) => setExpCat(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={addExp}><Icon name="add" size={15} /></button>
          </div>
        )}
        {expenses.length === 0 ? <p className="muted small">{ar ? 'لا مصروفات في الفترة' : 'No expenses in range'}</p> : (
          <div className="divide">
            {expenses.slice(0, 12).map((e) => (
              <div key={e.id} className="row-between">
                <span className="small">{e.category}{e.note ? ` · ${e.note}` : ''}</span>
                <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="price small"><Price value={e.amount} currency={currency} lang={lang} /></span>
                  {isManager && <button className="icon-btn" style={{ width: 24, height: 24, color: 'var(--danger)' }} onClick={() => deleteExpense(tenantId, e.id)}><Icon name="delete" size={13} /></button>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* revenue */}
      <div className="card card-pad stack">
        <strong className="row" style={{ gap: 6 }}><Icon name="trending" size={18} /> {t('revenue')}</strong>
        {report.count === 0 ? (
          <Empty icon="chartBar" title={t('noData')} />
        ) : (
          <div style={{ width: '100%', height: 190 }}>
            <ResponsiveContainer>
              <BarChart data={report.daily} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} interval="preserveStartEnd" />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13 }} formatter={(v) => [showMoney ? money(v, currency, lang) : '—', t('revenue')]} />
                <Bar dataKey="total" radius={[6, 6, 0, 0]}>{report.daily.map((_, i) => <Cell key={i} fill="var(--brand)" />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* peak hours */}
      <div className="card card-pad stack">
        <div className="row-between">
          <strong className="row" style={{ gap: 6 }}><Icon name="peak" size={18} /> {t('peakHours')}</strong>
          {report.busiest?.orders > 0 && <span className="badge badge-gold">{report.busiest.h}:00 · {report.busiest.orders} {t('ordersWord')}</span>}
        </div>
        {report.count === 0 ? <Empty icon="clock" title={t('noData')} /> : (
          <div style={{ width: '100%', height: 170 }}>
            <ResponsiveContainer>
              <BarChart data={report.hours} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} interval={2} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13 }} formatter={(v) => [v, t('ordersWord')]} labelFormatter={(l) => `${l}:00`} />
                <Bar dataKey="orders" radius={[5, 5, 0, 0]}>{report.hours.map((x, i) => <Cell key={i} fill={x.h === report.busiest.h && x.orders > 0 ? 'var(--accent)' : 'var(--brand)'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* new vs returning */}
      <div className="card card-pad stack">
        <strong className="row" style={{ gap: 6 }}><Icon name="repeat" size={18} /> {t('newVsReturning')}</strong>
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div className="stat"><div className="label">{t('newCustomers')}</div><div className="value num" style={{ color: 'var(--success)' }}>{report.newC}</div></div>
          <div className="stat"><div className="label">{t('returningCustomers')}</div><div className="value num" style={{ color: 'var(--brand)' }}>{report.returningC}</div></div>
          <div className="stat"><div className="label">{t('guests')}</div><div className="value num">{report.guests}</div></div>
        </div>
      </div>

      {/* staff performance */}
      <div className="card card-pad stack">
        <strong className="row" style={{ gap: 6 }}><Icon name="award" size={18} /> {t('staffPerformance')}</strong>
        {report.staffRows.length === 0 ? <p className="muted small">{t('noData')}</p> : (
          <div className="divide">
            {report.staffRows.map(([name, v], i) => (
              <div key={name} className="row-between">
                <span className="small"><span className="faint">{i + 1}.</span> {name}</span>
                <span className="row" style={{ gap: 8 }}><span className="badge">{v.orders} {t('ordersWord')}</span><span className="price small"><Price value={v.rev} currency={currency} lang={lang} /></span></span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* tips by staff */}
      {report.tipsRows.length > 0 && (
        <div className="card card-pad stack">
          <strong className="row" style={{ gap: 6 }}><Icon name="wallet" size={18} /> {ar ? 'الإكراميات حسب الموظف' : 'Tips by staff'}</strong>
          <div className="divide">
            {report.tipsRows.map(([name, v]) => (
              <div key={name} className="row-between"><span className="small">{name}</span><span className="price small"><Price value={v} currency={currency} lang={lang} /></span></div>
            ))}
          </div>
        </div>
      )}

      {/* sales by category */}
      {report.byCat.length > 0 && (
        <div className="card card-pad stack">
          <strong className="row" style={{ gap: 6 }}><Icon name="categories" size={18} /> {ar ? 'المبيعات حسب الفئة' : 'Sales by category'}</strong>
          <div className="divide">
            {report.byCat.map(([name, v], i) => (
              <div key={name} className="row-between"><span className="small"><span className="faint">{i + 1}.</span> {name}</span><span className="price small"><Price value={v} currency={currency} lang={lang} /></span></div>
            ))}
          </div>
        </div>
      )}

      {/* top items */}
      <div className="card card-pad stack">
        <div className="row-between">
          <strong className="row" style={{ gap: 6 }}><Icon name="star" size={18} /> {t('topItems')}</strong>
          <button className="btn btn-sm btn-outline" onClick={exportCsv}><Icon name="download" size={16} /> CSV</button>
        </div>
        {report.top.length === 0 ? <p className="muted small">—</p> : (
          <div className="divide">
            {report.top.map(([name, v], i) => (
              <div key={name} className="row-between">
                <span className="small"><span className="faint">{i + 1}.</span> {name}</span>
                <span className="row" style={{ gap: 8 }}><span className="badge">{v.qty}×</span><span className="price small"><Price value={v.rev} currency={currency} lang={lang} /></span></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
