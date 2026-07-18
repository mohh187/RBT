// Platform analytics — cross-venue trends from the nightly rollups
// (platformStats), top venues, and a venue-health board (idle venues that
// stopped ordering). Charts use recharts (already a project dependency).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { watchAllTenants, watchRecentStats } from '../../lib/platform.js'
import { fmtWhen } from './shared.jsx'

const DAY = 86400000

function ChartCard({ title, data, dataKey, color }) {
  return (
    <div className="card card-pad stack" style={{ gap: 8 }}>
      <strong className="small">{title}</strong>
      {data.length < 2 ? (
        <p className="muted small">تظهر الرسوم بعد يومين على الأقل من التجميع الليلي (platformStats)</p>
      ) : (
        <div style={{ width: '100%', height: 220 }} dir="ltr">
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`g-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--text-faint)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-faint)' }} width={44} />
              <Tooltip contentStyle={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} />
              <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#g-${dataKey})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

export default function Analytics() {
  const [stats, setStats] = useState(null) // platformStats, newest first
  const [tenants, setTenants] = useState([])

  useEffect(() => watchRecentStats(setStats, 30), [])
  useEffect(() => watchAllTenants(setTenants), [])

  const series = useMemo(() => {
    return (stats || [])
      .slice()
      .reverse()
      .map((s) => ({
        day: (s.date || s.id).slice(5), // MM-DD
        revenue: s.revenue || 0,
        orders: s.orders || 0,
        active: s.activeTenants || 0,
      }))
  }, [stats])

  const topVenues = useMemo(() => {
    const latest = (stats || [])[0]
    if (!latest?.byTenant) return []
    return Object.entries(latest.byTenant)
      .map(([tid, v]) => ({ tid, ...v }))
      .sort((a, b) => (b.revenue || 0) - (a.revenue || 0))
      .slice(0, 10)
  }, [stats])
  const maxRevenue = topVenues[0]?.revenue || 1

  // Cumulative signup growth — bucket by FULL date (unique per calendar day, no
  // cross-year collision), label MM-DD at render.
  const growth = useMemo(() => {
    const dated = tenants
      .map((t) => t.createdAt?.toDate?.())
      .filter(Boolean)
      .sort((a, b) => a - b)
    const byDay = new Map()
    dated.forEach((d) => {
      const key = d.toISOString().slice(0, 10) // YYYY-MM-DD
      byDay.set(key, (byDay.get(key) || 0) + 1)
    })
    let total = 0
    return [...byDay.entries()].map(([day, n]) => {
      total += n
      return { day: day.slice(5), total }
    })
  }, [tenants])

  // Idle venues — read from the nightly rollup's per-tenant lastOrderAt (avoids
  // a client query per venue). Empty until the first rollup has run.
  const idle = useMemo(() => {
    const latest = (stats || [])[0]
    if (!latest?.byTenant) return []
    return Object.entries(latest.byTenant)
      .map(([tid, v]) => {
        const lastMs = v.lastOrderAt?.toMillis?.()
          || (v.lastOrderAt?.toDate ? v.lastOrderAt.toDate().getTime() : (v.lastOrderAt?.seconds ? v.lastOrderAt.seconds * 1000 : 0))
        return { tid, name: v.name || tid, lastMs, idleDays: lastMs ? Math.floor((Date.now() - lastMs) / DAY) : null }
      })
      .filter((r) => r.idleDays === null || r.idleDays >= 7)
      .sort((a, b) => (b.idleDays ?? 9999) - (a.idleDays ?? 9999))
  }, [stats])

  if (stats === null) return <Spinner />

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div>
        <h2 className="page-title">تحليلات المنصّة</h2>
        <p className="muted small">اتجاهات كل المنشآت من التجميع الليلي + صحة النشاط</p>
      </div>

      <ChartCard title="إجمالي المبيعات اليومية (كل المنشآت)" data={series} dataKey="revenue" color="var(--brand)" />
      <ChartCard title="عدد الطلبات اليومية" data={series} dataKey="orders" color="var(--gold)" />
      <ChartCard title="نمو التسجيلات (تراكمي)" data={growth} dataKey="total" color="var(--success)" />

      {/* top venues */}
      <div className="card card-pad stack">
        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="award" size={14} /> أعلى المنشآت مبيعات (آخر يوم مجمَّع)</strong>
        {topVenues.length === 0 ? (
          <p className="muted small">تتوفر القائمة بعد أول تجميع ليلي</p>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {topVenues.map((v, i) => (
              <Link key={v.tid} to={`/platform/venues/${v.tid}`} className="stack" style={{ gap: 3 }}>
                <div className="row-between">
                  <span className="small bold"><span className="faint">{i + 1}.</span> {v.name || v.tid}</span>
                  <span className="small num bold">{(v.revenue || 0).toLocaleString('en-US')} <span className="xs faint">{v.currency || ''}</span></span>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-2, var(--border))', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(3, Math.round(((v.revenue || 0) / maxRevenue) * 100))}%`, background: 'var(--brand)', borderRadius: 99 }} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* venue health */}
      <div className="card card-pad stack">
        <strong><Icon name="warning" size={16} /> منشآت خاملة (7+ أيام بلا طلبات)</strong>
        {idle.length === 0 ? (
          <Empty icon="check" title="كل المنشآت نشطة" hint="تُحسب من التجميع الليلي — تظهر القائمة بعد أول تشغيل" />
        ) : (
          <div className="divide">
            {idle.map((r) => (
              <div key={r.tid} className="row-between" style={{ padding: '8px 0', gap: 8 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <Link to={`/platform/venues/${r.tid}`} className="small bold">{r.name}</Link>
                  <div className="xs faint">
                    {r.lastMs ? `آخر طلب ${fmtWhen(new Date(r.lastMs))}` : 'لم تستقبل أي طلب بعد'}
                  </div>
                </div>
                <span className={`badge ${r.idleDays === null ? '' : 'badge-warning'}`}>
                  {r.idleDays === null ? 'بلا طلبات' : `${r.idleDays} يوم`}
                </span>
                <Link to={`/platform/chat/${r.tid}`} className="btn btn-outline" style={{ padding: '4px 10px' }} title="تواصل معهم">
                  <Icon name="mail" size={14} />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
