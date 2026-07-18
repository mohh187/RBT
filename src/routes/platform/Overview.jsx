// Platform overview — the cross-venue pulse: KPIs, newest venues, live feed,
// open errors, unread chats. "Today" numbers come from the order activity
// stream (every order is mirrored into platformActivity with its amount).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner } from '../../components/ui.jsx'
import {
  watchAllTenants, watchActivity, watchErrors, watchChatThreads, watchTodayOrderActivity,
} from '../../lib/platform.js'
import { ActivityRow, PlanBadge, StatusChip, fmtWhen } from './shared.jsx'

export default function Overview() {
  const [tenants, setTenants] = useState(null)
  const [activity, setActivity] = useState([])
  const [errors, setErrors] = useState([])
  const [threads, setThreads] = useState([])
  const [todayOrders, setTodayOrders] = useState([])

  useEffect(() => watchAllTenants(setTenants), [])
  useEffect(() => watchActivity(setActivity, { max: 12 }), [])
  useEffect(() => watchErrors(setErrors, 30), [])
  useEffect(() => watchChatThreads(setThreads), [])
  useEffect(() => watchTodayOrderActivity(setTodayOrders), [])

  const kpi = useMemo(() => {
    const all = tenants || []
    const suspended = all.filter((t) => t.active === false).length
    // Order COUNT = creation events (no orderStatus). REVENUE = settled
    // transitions (paid/served) which carry a verified amount — never the
    // unvalidated creation total, so cancelled/spoofed orders don't inflate it.
    const created = todayOrders.filter((a) => !a.orderStatus)
    const settled = todayOrders.filter((a) => a.orderStatus === 'paid' || a.orderStatus === 'served')
    const revenue = Math.round(settled.reduce((s, a) => s + (a.amount || 0), 0))
    return {
      venues: all.length,
      suspended,
      activeVenues: all.length - suspended,
      orders: created.length,
      revenue,
      openErrors: errors.filter((e) => e.status !== 'resolved').length,
      unread: threads.reduce((s, t) => s + (t.unreadByPlatform || 0), 0),
    }
  }, [tenants, todayOrders, errors, threads])

  if (tenants === null) return <Spinner />

  const newest = tenants.slice(0, 5)
  const unreadThreads = threads.filter((t) => t.unreadByPlatform > 0).slice(0, 5)

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div>
        <h2 className="page-title">نظرة عامة على المنصّة</h2>
        <p className="muted small">كل المنشآت المسجّلة · مباشر</p>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="label">المنشآت المسجّلة</div>
          <div className="value num">{kpi.venues}</div>
        </div>
        <div className="stat">
          <div className="label">نشطة / موقوفة</div>
          <div className="value num">{kpi.activeVenues} / <span style={{ color: kpi.suspended ? 'var(--danger)' : 'inherit' }}>{kpi.suspended}</span></div>
        </div>
        <div className="stat">
          <div className="label">طلبات اليوم (كل المنشآت)</div>
          <div className="value num">{kpi.orders}</div>
        </div>
        <div className="stat">
          <div className="label">مبيعات اليوم (تقريبي · بالريال)</div>
          <div className="value num">{kpi.revenue.toLocaleString('en-US')} <span className="xs faint">SAR</span></div>
        </div>
        <div className="stat">
          <div className="label">أخطاء مفتوحة</div>
          <div className="value num" style={{ color: kpi.openErrors ? 'var(--danger)' : 'inherit' }}>{kpi.openErrors}</div>
        </div>
        <div className="stat">
          <div className="label">رسائل غير مقروءة</div>
          <div className="value num" style={{ color: kpi.unread ? 'var(--brand)' : 'inherit' }}>{kpi.unread}</div>
        </div>
      </div>

      {unreadThreads.length > 0 && (
        <div className="card card-pad stack">
          <div className="row-between">
            <strong><Icon name="message" size={14} style={{ verticalAlign: 'middle' }} /> محادثات بانتظار الرد</strong>
            <Link to="/platform/chat" className="small bold">الكل</Link>
          </div>
          <div className="divide">
            {unreadThreads.map((th) => (
              <Link key={th.id} to={`/platform/chat/${th.id}`} className="row-between" style={{ padding: '8px 0' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small bold">{th.tenantName || th.id}</div>
                  <div className="xs faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{th.lastText}</div>
                </div>
                <span className="badge" style={{ color: 'var(--brand)', borderColor: 'var(--brand)' }}>{th.unreadByPlatform}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="card card-pad stack">
        <div className="row-between">
          <strong><Icon name="store" size={14} style={{ verticalAlign: 'middle' }} /> أحدث المنشآت</strong>
          <Link to="/platform/venues" className="small bold">الكل ({kpi.venues})</Link>
        </div>
        {newest.length === 0 ? (
          <p className="muted small">لا منشآت مسجّلة بعد</p>
        ) : (
          <div className="divide">
            {newest.map((t) => (
              <Link key={t.id} to={`/platform/venues/${t.id}`} className="row-between" style={{ padding: '8px 0', gap: 8 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small bold">{t.name || t.id}</div>
                  <div className="xs faint">/{t.slug} · {fmtWhen(t.createdAt)}</div>
                </div>
                <PlanBadge plan={t.plan} />
                <StatusChip tenant={t} />
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="card card-pad stack">
        <div className="row-between">
          <strong><Icon name="zap" size={14} style={{ verticalAlign: 'middle' }} /> آخر النشاط</strong>
          <Link to="/platform/activity" className="small bold">السجل الكامل</Link>
        </div>
        {activity.length === 0 ? (
          <p className="muted small">لا نشاط بعد — سيظهر هنا كل إجراء تقوم به أي منشأة</p>
        ) : (
          <div className="divide">
            {activity.map((a) => <ActivityRow key={a.id} a={a} />)}
          </div>
        )}
      </div>

      {kpi.openErrors > 0 && (
        <div className="card card-pad stack" style={{ borderColor: 'var(--danger)' }}>
          <div className="row-between">
            <strong style={{ color: 'var(--danger)' }}><Icon name="warning" size={16} /> أخطاء تحتاج مراجعة</strong>
            <Link to="/platform/issues" className="small bold">المعالجة</Link>
          </div>
          <div className="divide">
            {errors.filter((e) => e.status !== 'resolved').slice(0, 5).map((e) => (
              <div key={e.id} className="row-between" style={{ padding: '8px 0', gap: 8 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.message}</div>
                  <div className="xs faint">{e.tenantName || e.tenantId || 'زائر'} · {fmtWhen(e.at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
