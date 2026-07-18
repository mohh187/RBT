import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { Spinner } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { Price } from '../../components/Riyal.jsx'
import { watchOrdersSince, watchAllReviews, watchComplaints, watchStaff, watchAttendance, watchShiftSwaps } from '../../lib/db.js'
import { scoreStaff } from '../../lib/perf.js'
import { roleName } from '../../lib/permissions.js'

function dayBounds(offset) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - offset); return { start: d.getTime(), end: d.getTime() + 86400000, date: d } }
const inDay = (ts, b) => { const m = ts?.toMillis?.() || 0; return m >= b.start && m < b.end }

// The manager's daily report — everything that happened on a given day:
// orders, revenue, staff performance, attendance/absence, complaints, ratings.
export default function DailyReport() {
  const { lang } = useI18n()
  const { tenantId, tenant } = useAuth()
  const ar = lang === 'ar'
  const currency = tenant?.currency || 'SAR'
  const [params] = useSearchParams()
  const [offset, setOffset] = useState(params.get('date') === 'today' ? 0 : 1) // default: yesterday
  const b = useMemo(() => dayBounds(offset), [offset])

  const [orders, setOrders] = useState(null)
  const [reviews, setReviews] = useState([])
  const [complaints, setComplaints] = useState([])
  const [members, setMembers] = useState([])
  const [attendance, setAttendance] = useState([])
  const [swaps, setSwaps] = useState([])

  useEffect(() => { if (!tenantId) return; setOrders(null); return watchOrdersSince(tenantId, new Date(b.start), setOrders) }, [tenantId, b.start])
  useEffect(() => { if (!tenantId) return; return watchAllReviews(tenantId, setReviews, 400) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchComplaints(tenantId, setComplaints, 200) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchStaff(tenantId, setMembers) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchAttendance(tenantId, setAttendance, 400) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchShiftSwaps(tenantId, setSwaps) }, [tenantId])

  const r = useMemo(() => {
    const dayOrders = (orders || []).filter((o) => inDay(o.createdAt, b))
    const valid = dayOrders.filter((o) => o.status !== 'cancelled')
    const revenue = valid.reduce((s, o) => s + (o.total || 0), 0)
    const cancelled = dayOrders.length - valid.length
    const types = { 'dine-in': 0, pickup: 0, curbside: 0 }
    valid.forEach((o) => { const k = o.orderType === 'curbside' ? 'curbside' : o.orderType === 'pickup' ? 'pickup' : 'dine-in'; types[k]++ })
    const dayReviews = reviews.filter((x) => inDay(x.createdAt, b))
    const avgRating = dayReviews.length ? dayReviews.reduce((s, x) => s + (x.rating || 0), 0) / dayReviews.length : 0
    const dayComplaints = complaints.filter((x) => inDay(x.createdAt, b))
    const rows = scoreStaff(members, valid, dayReviews, { period: 'today', ar }).filter((x) => x.points > 0).slice(0, 5)
    // attendance + absence (work-day staff with no clock-in that day)
    const dayAtt = attendance.filter((x) => inDay(x.at, b))
    const ins = dayAtt.filter((x) => x.type === 'in')
    const lateIns = ins.filter((x) => (x.lateMinutes || 0) > 0)
    const wd = b.date.getDay()
    const dayIso = `${b.date.getFullYear()}-${String(b.date.getMonth() + 1).padStart(2, '0')}-${String(b.date.getDate()).padStart(2, '0')}`
    const presentUids = new Set(ins.map((x) => x.staffUid))
    // staff who swapped this day away (accepted) are NOT counted absent
    const swappedAway = new Set(swaps.filter((s) => s.status === 'accepted' && s.date === dayIso).map((s) => s.fromUid))
    const absent = members.filter((m) => m.active !== false && Array.isArray(m.workDays) && m.workDays.includes(wd) && !presentUids.has(m.uid) && !swappedAway.has(m.uid))
    return { count: valid.length, revenue, avg: valid.length ? revenue / valid.length : 0, cancelled, types, ratingN: dayReviews.length, avgRating, complaints: dayComplaints.length, rows, present: presentUids.size, lateCount: lateIns.length, absent }
  }, [orders, reviews, complaints, members, attendance, swaps, b, ar])

  if (orders === null) return <Spinner />
  const dateLabel = b.date.toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="page stack">
      <div className="row-between">
        <h2 className="page-title row" style={{ gap: 8 }}><Icon name="reports" size={22} /> {ar ? 'التقرير اليومي' : 'Daily report'}</h2>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className={`chip ${offset === 1 ? 'active' : ''}`} onClick={() => setOffset(1)}>{ar ? 'الأمس' : 'Yesterday'}</button>
        <button className={`chip ${offset === 0 ? 'active' : ''}`} onClick={() => setOffset(0)}>{ar ? 'اليوم' : 'Today'}</button>
        <button className={`chip ${offset === 2 ? 'active' : ''}`} onClick={() => setOffset(2)}>{ar ? 'قبل يومين' : '2 days ago'}</button>
      </div>
      <p className="small faint">{dateLabel}</p>

      {/* headline */}
      <div className="stat-grid">
        <div className="stat"><div className="label">{ar ? 'الطلبات' : 'Orders'}</div><div className="value num">{r.count}</div></div>
        <div className="stat"><div className="label">{ar ? 'الإيراد' : 'Revenue'}</div><div className="value price"><Price value={r.revenue} currency={currency} lang={lang} /></div></div>
        <div className="stat"><div className="label">{ar ? 'متوسط الطلب' : 'Avg order'}</div><div className="value price"><Price value={r.avg} currency={currency} lang={lang} /></div></div>
        <div className="stat"><div className="label">{ar ? 'ملغاة' : 'Cancelled'}</div><div className="value num" style={{ color: r.cancelled ? 'var(--danger)' : undefined }}>{r.cancelled}</div></div>
      </div>

      {/* order types */}
      <div className="card card-pad row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
        <span className="small row" style={{ gap: 5 }}><Icon name="tables" size={14} className="faint" /> {ar ? 'محلي' : 'Dine-in'}: <strong>{r.types['dine-in']}</strong></span>
        <span className="small row" style={{ gap: 5 }}><Icon name="bag" size={14} className="faint" /> {ar ? 'استلام' : 'Pickup'}: <strong>{r.types.pickup}</strong></span>
        <span className="small row" style={{ gap: 5 }}><Icon name="car" size={14} className="faint" /> {ar ? 'سيارة' : 'Curbside'}: <strong>{r.types.curbside}</strong></span>
      </div>

      {/* ratings + complaints */}
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <div className="card card-pad grow stack" style={{ gap: 4 }}>
          <span className="xs faint">{ar ? 'التقييمات' : 'Ratings'}</span>
          <span className="bold row" style={{ gap: 6 }}><Icon name="star" size={15} fill="currentColor" strokeWidth={1.5} style={{ color: 'var(--gold)' }} /> {r.ratingN ? `${r.avgRating.toFixed(1)} (${r.ratingN})` : '—'}</span>
        </div>
        <div className="card card-pad grow stack" style={{ gap: 4 }}>
          <span className="xs faint">{ar ? 'الشكاوى' : 'Complaints'}</span>
          <span className="bold row" style={{ gap: 6, color: r.complaints ? 'var(--danger)' : undefined }}><Icon name="complaint" size={15} /> {r.complaints}</span>
        </div>
      </div>

      {/* attendance */}
      <div className="card card-pad stack" style={{ gap: 8 }}>
        <strong className="small row" style={{ gap: 6 }}><Icon name="scan" size={15} className="faint" /> {ar ? 'الحضور' : 'Attendance'}</strong>
        <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
          <span className="small">{ar ? 'حضروا' : 'Present'}: <strong>{r.present}</strong></span>
          <span className="small" style={{ color: r.lateCount ? 'var(--warning)' : undefined }}>{ar ? 'متأخرون' : 'Late'}: <strong>{r.lateCount}</strong></span>
          <span className="small" style={{ color: r.absent.length ? 'var(--danger)' : undefined }}>{ar ? 'غائبون' : 'Absent'}: <strong>{r.absent.length}</strong></span>
        </div>
        {r.absent.length > 0 && <div className="xs faint">{ar ? 'الغائبون' : 'Absent'}: {r.absent.map((m) => m.name || m.email).join('، ')}</div>}
      </div>

      {/* top staff */}
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        <strong className="small row" style={{ gap: 6 }}><Icon name="award" size={15} style={{ color: 'var(--gold)' }} /> {ar ? 'أبرز الموظفين' : 'Top staff'}</strong>
        {r.rows.length === 0 ? <p className="muted small">{ar ? 'لا نشاط' : 'No activity'}</p> : r.rows.map((row, i) => (
          <div key={row.uid} className="list-row">
            <span className="center" style={{ width: 26, height: 26, borderRadius: '50%', background: i === 0 ? 'var(--gold)' : 'var(--surface-2)', color: i === 0 ? '#fff' : 'var(--text-muted)', fontWeight: 800, fontSize: 12, flex: 'none' }}>{i + 1}</span>
            <div className="grow"><div className="small bold">{row.name || row.email}</div><div className="xs faint">{roleName(row.role, lang)} · {ar ? 'قدّم' : 'served'} {row.served} · {row.points} {ar ? 'نقطة' : 'pts'}</div></div>
            <span className="price small"><Price value={row.revenue} currency={currency} lang={lang} /></span>
          </div>
        ))}
      </div>

      <p className="xs faint">{ar ? 'يُحدَّث التقرير تلقائياً. للتذكير اليومي الساعة 5 فجراً يلزم تفعيل المهمة المجدولة على الخادم.' : 'Updates live. A true 5 AM push requires a scheduled server task.'}</p>
    </div>
  )
}
