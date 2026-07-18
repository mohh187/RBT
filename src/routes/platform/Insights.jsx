// /platform/insights — deep analytics: revenue & orders history charts,
// plan distribution, churn/idle summary, per-venue AOV+revenue ranking, and an
// Excel export of the latest per-venue breakdown. All data comes from the
// nightly platformStats rollups + the tenants collection (no extra writes).
import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import * as XLSX from 'xlsx'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { PlanBadge, fmtWhen } from './shared.jsx'
import { PLANS } from '../../lib/plans.js'
import { watchRecentStats, watchAllTenants } from '../../lib/platform.js'
import { revenueSeries, mrrFromTenants, churnFrom, byTenantRows } from '../../lib/platformInsights.js'

const AX = { fontSize: 11, fill: 'var(--text-faint)' }

function ChartTip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="card-pad shadow-md" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-sm)' }}>
      <div className="xs faint">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="row" style={{ gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: 'inline-block' }} />
          <span className="xs">{p.name}: <b className="num">{Number(p.value).toLocaleString('en-US')}</b></span>
        </div>
      ))}
    </div>
  )
}

function Panel({ title, sub, children, right }) {
  return (
    <div className="card grow" style={{ minWidth: 280 }}>
      <div className="card-pad row-between" style={{ alignItems: 'flex-start' }}>
        <div><div className="bold">{title}</div>{sub ? <div className="xs faint">{sub}</div> : null}</div>
        {right || null}
      </div>
      <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>{children}</div>
    </div>
  )
}

export default function Insights() {
  const toast = useToast()
  const [stats, setStats] = useState(null)
  const [tenants, setTenants] = useState(null)

  useEffect(() => {
    const u1 = watchRecentStats(setStats, 30)
    const u2 = watchAllTenants(setTenants)
    return () => { u1 && u1(); u2 && u2() }
  }, [])

  const loading = stats === null || tenants === null

  const series = useMemo(() => revenueSeries(stats || []), [stats])
  const latest = useMemo(() => (stats || [])[0] || null, [stats])
  const mrr = useMemo(() => mrrFromTenants(tenants || []), [tenants])
  const churn = useMemo(() => churnFrom(stats || []), [stats])
  const ranking = useMemo(
    () => byTenantRows(latest).sort((a, b) => b.revenue - a.revenue).slice(0, 15),
    [latest],
  )

  const totals = useMemo(() => {
    const rev = series.reduce((s, x) => s + x.revenue, 0)
    const ord = series.reduce((s, x) => s + x.orders, 0)
    return { rev, ord, days: series.length }
  }, [series])

  function exportExcel() {
    const rows = byTenantRows(latest).sort((a, b) => b.revenue - a.revenue)
    if (!rows.length) { toast.error('لا توجد بيانات للتصدير بعد'); return }
    const data = rows.map((r, i) => ({
      '#': i + 1,
      'المنشأة': r.name,
      'الطلبات': r.orders,
      'الإيراد': r.revenue,
      'متوسط قيمة الطلب': r.aov,
      'العملة': r.currency,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = [{ wch: 5 }, { wch: 28 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 8 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'venues')
    XLSX.writeFile(wb, `platform-venues-${latest?.date || 'export'}.xlsx`)
    toast.success('تم تصدير الملف')
  }

  if (loading) return <div className="page"><Spinner /></div>

  const hasStats = series.length > 0
  const planMax = Math.max(...PLANS.map((p) => mrr.byPlan[p.id] || 0), 1)

  return (
    <div className="page">
      <div className="row-between" style={{ alignItems: 'center' }}>
        <h1 className="page-title" style={{ margin: 0 }}>التحليلات المتعمّقة</h1>
        <button className="btn btn-outline btn-sm" onClick={exportExcel}>
          <Icon name="download" size={15} /> تصدير Excel
        </button>
      </div>

      <div className="stat-grid" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="stat"><div className="xs muted">MRR تقديري</div><div className="num bold" style={{ fontSize: 24 }}>{mrr.mrr.toLocaleString('en-US')}</div><div className="xs faint">{mrr.paying} منشأة مدفوعة · تقديري</div></div>
        <div className="stat"><div className="xs muted">إيراد آخر {totals.days} يوم</div><div className="num bold" style={{ fontSize: 24 }}>{totals.rev.toLocaleString('en-US')}</div><div className="xs faint">{totals.ord.toLocaleString('en-US')} طلب</div></div>
        <div className="stat"><div className="xs muted">منشآت نشطة</div><div className="num bold" style={{ fontSize: 24 }}>{churn.active}<span className="faint" style={{ fontSize: 14 }}>/{churn.tenants}</span></div><div className="xs faint">تفاعل {Math.round(churn.engagement * 100)}%</div></div>
        <div className="stat"><div className="xs muted">منشآت خاملة (اليوم)</div><div className="num bold" style={{ fontSize: 24, color: churn.idle ? 'var(--warning)' : 'var(--text)' }}>{churn.idle}</div><div className="xs faint">معدل خمول {Math.round(churn.churnRate * 100)}%</div></div>
      </div>

      {!hasStats ? (
        <div className="card" style={{ marginTop: 'var(--sp-4)' }}>
          <Empty icon="chartBar" title="لا توجد إحصائيات بعد" hint="تُبنى التقارير من التجميع اليومي (platformStats) — عُد بعد أول دورة ليلية" />
        </div>
      ) : (
        <>
          <div className="row" style={{ gap: 'var(--sp-4)', marginTop: 'var(--sp-4)', alignItems: 'stretch', flexWrap: 'wrap' }}>
            <Panel title="الإيراد اليومي" sub={`آخر ${series.length} يوم`}>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <AreaChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={AX} axisLine={false} tickLine={false} />
                    <YAxis tick={AX} axisLine={false} tickLine={false} width={44} />
                    <Tooltip content={<ChartTip />} />
                    <Area type="monotone" dataKey="revenue" name="الإيراد" stroke="var(--brand)" fill="url(#revGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="عدد الطلبات اليومي" sub={`آخر ${series.length} يوم`}>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={AX} axisLine={false} tickLine={false} />
                    <YAxis tick={AX} axisLine={false} tickLine={false} width={44} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--surface-2)' }} />
                    <Bar dataKey="orders" name="الطلبات" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <div className="row" style={{ gap: 'var(--sp-4)', marginTop: 'var(--sp-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Panel title="توزيع الباقات" sub={`${mrr.total} منشأة`}>
              <div className="stack" style={{ gap: 10, marginTop: 4 }}>
                {PLANS.map((p) => {
                  const c = mrr.byPlan[p.id] || 0
                  return (
                    <div key={p.id}>
                      <div className="row-between" style={{ alignItems: 'center' }}>
                        <PlanBadge plan={p.id} />
                        <span className="xs num bold">{c}</span>
                      </div>
                      <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 4, marginTop: 5, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.round((c / planMax) * 100)}%`, background: 'var(--brand)', borderRadius: 4 }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Panel>

            <div className="card grow" style={{ minWidth: 300, flex: '2 1 400px' }}>
              <div className="card-pad row-between">
                <div><div className="bold">ترتيب المنشآت (أعلى إيراداً)</div><div className="xs faint">أحدث تجميع · {latest?.date || ''}</div></div>
                <span className="xs faint">{ranking.length}</span>
              </div>
              <div style={{ overflowX: 'auto', padding: '0 var(--sp-2) var(--sp-4)' }}>
                {ranking.length === 0 ? (
                  <Empty icon="store" title="لا توجد بيانات منشآت" hint="ينتظر أول تجميع يومي" />
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
                    <thead>
                      <tr className="xs faint" style={{ textAlign: 'start' }}>
                        <th style={{ textAlign: 'start', padding: '6px 8px' }}>#</th>
                        <th style={{ textAlign: 'start', padding: '6px 8px' }}>المنشأة</th>
                        <th style={{ textAlign: 'end', padding: '6px 8px' }}>الطلبات</th>
                        <th style={{ textAlign: 'end', padding: '6px 8px' }}>الإيراد</th>
                        <th style={{ textAlign: 'end', padding: '6px 8px' }}>متوسط الطلب</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.map((r, i) => (
                        <tr key={r.tid} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className="num faint" style={{ padding: '7px 8px' }}>{i + 1}</td>
                          <td style={{ padding: '7px 8px' }}>
                            <div className="small bold truncate" style={{ maxWidth: 200 }}>{r.name}</div>
                            {r.lastOrderAt ? <div className="xs faint">{fmtWhen(r.lastOrderAt)}</div> : null}
                          </td>
                          <td className="num" style={{ textAlign: 'end', padding: '7px 8px' }}>{r.orders}</td>
                          <td className="num bold" style={{ textAlign: 'end', padding: '7px 8px' }}>{r.revenue.toLocaleString('en-US')}</td>
                          <td className="num" style={{ textAlign: 'end', padding: '7px 8px' }}>{r.aov.toLocaleString('en-US')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
