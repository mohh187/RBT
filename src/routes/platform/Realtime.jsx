// /platform/realtime — live cross-venue operations board. Auto-updates via
// onSnapshot: total live orders right now, today's settled revenue, the latest
// order events across all venues, and today's busiest venues.
import { useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { ActivityRow, fmtWhen } from './shared.jsx'
import { watchAllTenants, watchRecentStats } from '../../lib/platform.js'
import { watchLiveOrders, watchSettledToday, byTenantRows } from '../../lib/platformInsights.js'

function Kpi({ icon, label, value, sub, tone }) {
  return (
    <div className="stat" style={{ borderInlineStart: `3px solid ${tone || 'var(--brand)'}` }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span style={{ color: tone || 'var(--brand)' }}><Icon name={icon} size={18} /></span>
        <span className="xs muted">{label}</span>
      </div>
      <div className="num bold" style={{ fontSize: 26, marginTop: 4 }}>{value}</div>
      {sub ? <div className="xs faint">{sub}</div> : null}
    </div>
  )
}

export default function Realtime() {
  const [live, setLive] = useState(null)
  const [settled, setSettled] = useState(null)
  const [stats, setStats] = useState(null)
  const [tenants, setTenants] = useState(null)

  useEffect(() => {
    const u1 = watchLiveOrders(setLive)
    const u2 = watchSettledToday(setSettled)
    const u3 = watchRecentStats(setStats, 1)
    const u4 = watchAllTenants(setTenants)
    return () => { u1 && u1(); u2 && u2(); u3 && u3(); u4 && u4() }
  }, [])

  const loading = live === null || settled === null || stats === null || tenants === null

  const tenantName = useMemo(() => {
    const m = {}
    for (const t of tenants || []) m[t.id] = t.name || t.id
    return m
  }, [tenants])

  // Busiest venues today: latest rollup byTenant, else fall back to live events.
  const busiest = useMemo(() => {
    const rows = byTenantRows((stats || [])[0])
    if (rows.length) return rows.sort((a, b) => b.orders - a.orders).slice(0, 8)
    // fallback: aggregate today's live+settled events per tenant
    const agg = {}
    for (const r of [...(live || []), ...((settled && settled.rows) || [])]) {
      const id = r.tenantId || 'x'
      agg[id] = agg[id] || { tid: id, name: r.tenantName || tenantName[id] || id, orders: 0, revenue: 0 }
      agg[id].orders += 1
      agg[id].revenue += Number(r.amount) || 0
    }
    return Object.values(agg).sort((a, b) => b.orders - a.orders).slice(0, 8)
  }, [stats, live, settled, tenantName])

  const feed = useMemo(() => {
    const all = [...(live || []), ...((settled && settled.rows) || [])]
    all.sort((a, b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0))
    return all.slice(0, 40)
  }, [live, settled])

  if (loading) return <div className="page"><Spinner /></div>

  const liveCount = (live || []).length
  const maxOrders = busiest.length ? Math.max(...busiest.map((b) => b.orders || 0), 1) : 1
  const updated = fmtWhen(feed[0]?.at) || 'الآن'

  return (
    <div className="page">
      <div className="row-between" style={{ alignItems: 'center' }}>
        <h1 className="page-title" style={{ margin: 0 }}>البث المباشر للعمليات</h1>
        <span className="chip"><span style={{ color: 'var(--success)' }}><Icon name="zap" size={14} /></span> مباشر · {updated}</span>
      </div>

      <div className="stat-grid" style={{ marginTop: 'var(--sp-4)' }}>
        <Kpi icon="orders" label="طلبات جديدة اليوم" value={liveCount} sub="عبر كل المنشآت" tone="var(--brand)" />
        <Kpi icon="check" label="طلبات مُسدّدة اليوم" value={settled.count} tone="var(--success)" />
        <Kpi icon="wallet" label="إيراد اليوم (مُحقّق)" value={settled.revenue.toLocaleString('en-US')} sub="مجموع المبالغ المدفوعة" tone="var(--gold)" />
        <Kpi icon="store" label="منشآت نشطة الآن" value={busiest.filter((b) => b.orders > 0).length} tone="var(--accent)" />
      </div>

      <div className="row" style={{ gap: 'var(--sp-4)', marginTop: 'var(--sp-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card grow" style={{ minWidth: 280, flex: '2 1 320px' }}>
          <div className="card-pad">
            <div className="row-between"><div className="bold">آخر أحداث الطلبات</div><span className="xs faint">{feed.length}</span></div>
          </div>
          <div style={{ padding: '0 var(--sp-4) var(--sp-2)', maxHeight: 460, overflowY: 'auto' }}>
            {feed.length === 0
              ? <Empty icon="orders" title="لا توجد طلبات بعد اليوم" hint="ستظهر الأحداث هنا فور وصولها" />
              : <div className="divide">{feed.map((a) => <ActivityRow key={a.id} a={a} showTenant />)}</div>}
          </div>
        </div>

        <div className="card grow" style={{ minWidth: 260, flex: '1 1 260px' }}>
          <div className="card-pad">
            <div className="bold">أكثر المنشآت ازدحاماً اليوم</div>
            <div className="xs faint">حسب عدد الطلبات</div>
          </div>
          <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
            {busiest.length === 0
              ? <Empty icon="store" title="لا بيانات بعد" hint="ينتظر أول طلب اليوم" />
              : busiest.map((b, i) => (
                <div key={b.tid} className="list-row" style={{ display: 'block', padding: '8px 0' }}>
                  <div className="row-between" style={{ alignItems: 'center' }}>
                    <div className="row" style={{ gap: 8, minWidth: 0, alignItems: 'center' }}>
                      <span className="xs faint num" style={{ width: 16 }}>{i + 1}</span>
                      <span className="small bold truncate">{b.name}</span>
                    </div>
                    <span className="xs num bold">{b.orders} طلب</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 4, marginTop: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round((b.orders / maxOrders) * 100)}%`, background: 'var(--brand)', borderRadius: 4 }} />
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}
