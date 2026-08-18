import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import Sheet from '../../components/Sheet.jsx'
import { Price } from '../../components/Riyal.jsx'
import { watchOrdersSince, watchAllReviews, watchComplaints, watchStaff, watchAttendance, watchShiftSwaps } from '../../lib/db.js'
import { scoreStaff } from '../../lib/perf.js'
import { roleName } from '../../lib/permissions.js'
import { orderNumber } from '../../lib/format.js'
import { statusShort } from '../../lib/orderStatus.js'
import { hoursIn } from '../../lib/payroll.js'

function dayBounds(offset) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - offset); return { start: d.getTime(), end: d.getTime() + 86400000, date: d } }
const inDay = (ts, b) => { const m = ts?.toMillis?.() || 0; return m >= b.start && m < b.end }

// Clipboard with the legacy selection fallback (same reason as ErrorBoundary's
// copyFallback: the clipboard API is unavailable on insecure origins and inside
// some in-app browsers — exactly where a manager pastes the day's summary into
// WhatsApp). Resolves true when ANY path managed to copy.
function copyText(text) {
  const fallback = () => {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy') // false = silently refused, not thrown
      document.body.removeChild(ta)
      return ok
    } catch (_) { return false }
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => fallback())
    }
    return Promise.resolve(fallback())
  } catch (_) { return Promise.resolve(fallback()) }
}

// The manager's daily report — everything that happened on a given day:
// orders, revenue, staff performance, attendance/absence, complaints, ratings.
export default function DailyReport() {
  const { lang } = useI18n()
  const { tenantId, tenant } = useAuth()
  const toast = useToast()
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
  // Which staffer's day sheet is open (a row from r.rows), null = closed.
  const [staffFor, setStaffFor] = useState(null)

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
    // ALL active staff, best first. The old top-5 hid everyone else — but a
    // zero row is management information too («بلا نشاط اليوم» is exactly what
    // a manager scans this page for), and every row now opens a per-staffer
    // day sheet, so the list must actually contain the person being asked about.
    const rows = scoreStaff(members.filter((m) => m.active !== false), valid, dayReviews, { period: 'today', ar })
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
    return { count: valid.length, revenue, avg: valid.length ? revenue / valid.length : 0, cancelled, types, ratingN: dayReviews.length, avgRating, complaints: dayComplaints.length, rows, present: presentUids.size, lateCount: lateIns.length, absent, dayOrders: valid, dayReviews, dayAtt }
  }, [orders, reviews, complaints, members, attendance, swaps, b, ar])

  if (orders === null) return <Spinner />
  const dateLabel = b.date.toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })

  // «نسخ تقرير اليوم»: the whole day as plain text, shaped for pasting straight
  // into the owners' WhatsApp group — no screenshots, no export dance.
  const copyDay = () => {
    const top = r.rows.filter((x) => x.points > 0).slice(0, 3)
    const txt = [
      `${ar ? 'تقرير' : 'Report'} ${dateLabel}`,
      `${ar ? 'الإيراد' : 'Revenue'}: ${Math.round(r.revenue)} ${currency}`,
      `${ar ? 'الطلبات' : 'Orders'}: ${r.count} · ${ar ? 'متوسط الطلب' : 'avg order'} ${Math.round(r.avg)} ${currency}`,
      r.cancelled ? `${ar ? 'ملغاة' : 'Cancelled'}: ${r.cancelled}` : '',
      `${ar ? 'الحضور' : 'Attendance'}: ${r.present} ${ar ? 'حضروا' : 'present'} · ${r.lateCount} ${ar ? 'متأخرون' : 'late'} · ${r.absent.length} ${ar ? 'غائبون' : 'absent'}`,
      top.length ? (ar ? 'أبرز الموظفين:' : 'Top staff:') : '',
      ...top.map((x, i) => `${i + 1}. ${x.name || x.email} — ${x.points} ${ar ? 'نقطة' : 'pts'}`),
    ].filter(Boolean).join('\n')
    copyText(txt).then((ok) => (ok ? toast.success(ar ? 'نُسخ تقرير اليوم' : 'Day report copied') : toast.error(ar ? 'تعذّر النسخ' : 'Copy failed')))
  }

  return (
    <div className="page stack">
      <div className="row-between">
        <h2 className="page-title row" style={{ gap: 8 }}><Icon name="reports" size={22} /> {ar ? 'التقرير اليومي' : 'Daily report'}</h2>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className={`chip ${offset === 1 ? 'active' : ''}`} onClick={() => setOffset(1)}>{ar ? 'الأمس' : 'Yesterday'}</button>
        <button className={`chip ${offset === 0 ? 'active' : ''}`} onClick={() => setOffset(0)}>{ar ? 'اليوم' : 'Today'}</button>
        <button className={`chip ${offset === 2 ? 'active' : ''}`} onClick={() => setOffset(2)}>{ar ? 'قبل يومين' : '2 days ago'}</button>
        <span className="grow" />
        <button className="btn btn-outline btn-sm" onClick={copyDay}>
          <Icon name="copy" size={15} /> {ar ? 'نسخ تقرير اليوم' : 'Copy day report'}
        </button>
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

      {/* staff — ALL active staff, best first; every row opens the day sheet */}
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        <strong className="small row" style={{ gap: 6 }}><Icon name="award" size={15} style={{ color: 'var(--gold)' }} /> {ar ? 'الموظفون — ترتيب اليوم' : 'Staff — day ranking'}</strong>
        {r.rows.length === 0 ? <p className="muted small">{ar ? 'لا موظفين' : 'No staff'}</p> : r.rows.map((row, i) => (
          <button key={row.uid} type="button" className="list-row" onClick={() => setStaffFor(row)} style={{ textAlign: 'start', width: '100%' }}>
            <span className="center" style={{ width: 26, height: 26, borderRadius: '50%', background: i === 0 && row.points > 0 ? 'var(--gold)' : 'var(--surface-2)', color: i === 0 && row.points > 0 ? '#fff' : 'var(--text-muted)', fontWeight: 800, fontSize: 12, flex: 'none' }}>{i + 1}</span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className={`small bold ${row.points > 0 ? '' : 'faint'}`}>{row.name || row.email}</div>
              <div className="xs faint">
                {roleName(row.role, lang)} · {row.points > 0
                  ? `${ar ? 'قدّم' : 'served'} ${row.served} · ${row.points} ${ar ? 'نقطة' : 'pts'}`
                  : (ar ? 'بلا نشاط اليوم' : 'No activity today')}
              </div>
            </div>
            {row.points > 0 && <span className="price small"><Price value={row.revenue} currency={currency} lang={lang} /></span>}
            <Icon name={ar ? 'back' : 'next'} size={15} className="faint" style={{ flex: 'none' }} />
          </button>
        ))}
      </div>

      <p className="xs faint">{ar ? 'يُحدَّث التقرير تلقائياً. للتذكير اليومي الساعة 5 فجراً يلزم تفعيل المهمة المجدولة على الخادم.' : 'Updates live. A true 5 AM push requires a scheduled server task.'}</p>

      {staffFor && (
        <StaffDaySheet
          row={staffFor}
          onClose={() => setStaffFor(null)}
          dayOrders={r.dayOrders}
          dayReviews={r.dayReviews}
          dayAtt={r.dayAtt}
          dayStart={b.start}
          dayEnd={b.end}
          dayTitle={offset === 0 ? (ar ? 'اليوم' : 'Today') : dateLabel}
          dateLabel={dateLabel}
          currency={currency}
          lang={lang}
        />
      )}
    </div>
  )
}

// Per-staffer day sheet: one tap on a row answers «ماذا فعل فلان اليوم؟» from
// the data the page ALREADY streams — zero extra queries, zero new indexes.
// Money is shown un-masked on purpose: the page itself sits behind
// VIEW_REPORTS and prints the day's revenue in its headline anyway.
function StaffDaySheet({ row, onClose, dayOrders, dayReviews, dayAtt, dayStart, dayEnd, dayTitle, dateLabel, currency, lang }) {
  const ar = lang === 'ar'
  const toast = useToast()
  const name = row.name || row.email || ''
  // Served/handled are recomputed here rather than read off the scoreStaff row
  // so the sheet can exclude refunded orders from the money figures — points
  // keep the scoring engine's view, money shows what stayed in the drawer.
  // (dayOrders already excludes cancelled — same set the page totals use.)
  const servedOrders = dayOrders.filter((o) => o.servedByUid === row.uid && o.status !== 'refunded')
  const revenue = servedOrders.reduce((s, o) => s + (o.total || 0), 0)
  const handled = dayOrders.filter((o) => o.acceptedByUid === row.uid).length
  const avg = servedOrders.length ? revenue / servedOrders.length : 0
  // Tips are recorded under the display name (servedByName), not the uid.
  const tips = dayOrders.reduce((s, o) => s + (o.servedByName === name ? (o.tip || 0) : 0), 0)
  const touched = dayOrders.filter((o) => o.servedByUid === row.uid || o.acceptedByUid === row.uid).slice(0, 15)
  const punches = dayAtt.filter((p) => p.staffUid === row.uid)
  // Same pairing math as the staffer's own portal (lib/payroll.js hoursIn);
  // dayEnd caps a forgotten clock-out when viewing a PAST day («الأمس») —
  // today's live view still ticks because the cap clamps to now.
  const hours = hoursIn(punches, dayStart, dayEnd)
  const lateMin = punches.filter((p) => p.type === 'in' && (p.lateMinutes || 0) > 0).reduce((s, p) => s + (p.lateMinutes || 0), 0)
  const myReviews = dayReviews.filter((x) => x.staffUid === row.uid)
  const avgRating = myReviews.length ? myReviews.reduce((s, x) => s + (x.rating || 0), 0) / myReviews.length : 0

  // «نسخ الملخص»: the staffer's day as plain text — for a WhatsApp message or
  // an end-of-shift note, without retyping the numbers.
  const copySummary = () => {
    const txt = [
      `${ar ? 'تقرير' : 'Report'} ${name} — ${dateLabel}`,
      `${ar ? 'قدّم' : 'Served'}: ${servedOrders.length} · ${ar ? 'الإيراد' : 'revenue'} ${Math.round(revenue)} ${currency}`,
      `${ar ? 'ساعات العمل' : 'Hours'}: ${hours.toFixed(1)}`,
      lateMin ? `${ar ? 'التأخير' : 'Late'}: ${lateMin} ${ar ? 'دقيقة' : 'min'}` : (ar ? 'بلا تأخير' : 'On time'),
      myReviews.length ? `${ar ? 'التقييم' : 'Rating'}: ${avgRating.toFixed(1)} (${myReviews.length})` : '',
    ].filter(Boolean).join('\n')
    copyText(txt).then((ok) => (ok ? toast.success(ar ? 'نُسخ الملخص' : 'Summary copied') : toast.error(ar ? 'تعذّر النسخ' : 'Copy failed')))
  }

  return (
    <Sheet
      open
      onClose={onClose}
      tall
      title={ar ? `تقرير ${name} — ${dayTitle}` : `${name} — ${dayTitle}`}
      footer={(
        <button type="button" className="btn btn-outline" style={{ width: '100%' }} onClick={copySummary}>
          <Icon name="copy" size={16} /> {ar ? 'نسخ الملخص' : 'Copy summary'}
        </button>
      )}
    >
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="stat-grid">
          <div className="stat"><div className="label">{ar ? 'قدّم' : 'Served'}</div><div className="value num">{servedOrders.length}</div></div>
          <div className="stat"><div className="label">{ar ? 'الإيراد' : 'Revenue'}</div><div className="value price"><Price value={revenue} currency={currency} lang={lang} /></div></div>
          <div className="stat"><div className="label">{ar ? 'استلم' : 'Handled'}</div><div className="value num">{handled}</div></div>
          <div className="stat"><div className="label">{ar ? 'متوسط الطلب' : 'Avg order'}</div><div className="value price"><Price value={avg} currency={currency} lang={lang} /></div></div>
        </div>

        <div className="card card-pad row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
          <span className="small">{ar ? 'ساعات العمل' : 'Hours'}: <strong className="num">{hours.toFixed(1)}</strong></span>
          <span className="small" style={{ color: lateMin ? 'var(--warning)' : undefined }}>{ar ? 'التأخير' : 'Late'}: <strong className="num">{lateMin}</strong> {ar ? 'دقيقة' : 'min'}</span>
          {tips > 0 && <span className="small">{ar ? 'إكراميات' : 'Tips'}: <span className="price"><Price value={tips} currency={currency} lang={lang} /></span></span>}
          <span className="small">{ar ? 'النقاط' : 'Points'}: <strong className="num">{row.points}</strong>{row.level ? ` · ${ar ? row.level.ar : row.level.en}` : ''}</span>
        </div>

        {myReviews.length > 0 && (
          <div className="card card-pad row" style={{ gap: 6, alignItems: 'center' }}>
            <Icon name="star" size={15} fill="currentColor" strokeWidth={1.5} style={{ color: 'var(--gold)' }} />
            <span className="small bold num">{avgRating.toFixed(1)}</span>
            <span className="xs faint">({myReviews.length} {ar ? 'تقييم في هذا اليوم' : 'reviews this day'})</span>
          </div>
        )}

        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <strong className="small">{ar ? 'طلبات لمسها' : 'Orders touched'} {touched.length >= 15 ? (ar ? '(أول 15)' : '(first 15)') : `(${touched.length})`}</strong>
          {touched.length === 0 ? <p className="muted small">{ar ? 'لا طلبات في هذا اليوم' : 'No orders this day'}</p> : touched.map((o) => (
            <div key={o.id} className="list-row">
              <span className="small bold num">{orderNumber(o.code)}</span>
              <span className="grow" />
              <span className="price small"><Price value={o.total || 0} currency={currency} lang={lang} /></span>
              <span className={`badge ${o.status === 'served' || o.status === 'paid' ? 'badge-success' : o.status === 'refunded' ? 'badge-danger' : 'badge-gold'}`}>{statusShort(lang, o.status)}</span>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  )
}
