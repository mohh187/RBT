import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import Icon from '../../components/Icon.jsx'
import Sheet from '../../components/Sheet.jsx'
import StaffBell from '../../components/StaffBell.jsx'
import OrderDetail from '../../components/OrderDetail.jsx'
import { Price } from '../../components/Riyal.jsx'
import {
  watchActiveOrders, updateOrderStatus, watchMyAttendance, watchStaff,
  watchOrdersSince, watchAllReviews, createLeaveRequest, watchMyLeaves, setStaffMeta,
  watchAnnouncements, startStatusSession, endStatusSession, watchMyShifts, createShiftSwap,
  watchShiftSwaps, setShiftSwapStatus,
} from '../../lib/db.js'
import { uploadImage, shrinkImage } from '../../lib/storage.js'
import { useSystemThemeBody, systemThemeAttr } from '../../lib/systemThemes.js'
import AppBackground from '../../components/AppBackground.jsx'
import { alertParty } from '../../lib/notify.js'
import { Link } from 'react-router-dom'
import { scoreStaff, startOf } from '../../lib/perf.js'
import { achievementsFor } from '../../lib/achievements.js'
import { overtimePay } from '../../lib/payroll.js'
import { buildRoleTargets, buildRoleWeights, TARGET_METRICS } from '../../lib/targets.js'
import { orderNumber, timeAgo, staffIdFallback } from '../../lib/format.js'
import { CAP, roleName } from '../../lib/permissions.js'
import Attendance from '../admin/Attendance.jsx'
import { useCompactUI } from '../../lib/useCompactUI.js'

const NEXT = { pending: 'accepted', accepted: 'preparing', preparing: 'ready', ready: 'served' }
function startToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

// Hours worked since a moment: pair in→out punches, count an open shift up to now.
function hoursIn(punches, sinceMs) {
  const list = (punches || []).filter((p) => (p.at?.toMillis?.() || 0) >= sinceMs).slice().sort((a, b) => (a.at?.toMillis?.() || 0) - (b.at?.toMillis?.() || 0))
  let ms = 0, lastIn = null
  list.forEach((p) => {
    const at = p.at?.toMillis?.() || 0
    if (p.type === 'in') lastIn = at
    else if (p.type === 'out' && lastIn) { ms += at - lastIn; lastIn = null }
  })
  if (lastIn) ms += Date.now() - lastIn
  return ms / 3600000
}
// "HH:MM" → minutes; shift length in hours; minutes remaining until an end time today.
const hhmmToMin = (s) => { const [h, m] = String(s || '').split(':').map(Number); return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0) }
function shiftLenHrs(s, e) { if (!s || !e) return 0; let d = hhmmToMin(e) - hhmmToMin(s); if (d < 0) d += 1440; return d / 60 }
function minutesUntil(e) { if (!e) return 0; const n = new Date(); const cur = n.getHours() * 60 + n.getMinutes(); const d = hhmmToMin(e) - cur; return d > 0 ? d : 0 }
function leaveDays(l) { if (!l.from) return 1; const a = new Date(l.from); const b = l.to ? new Date(l.to) : a; const d = Math.round((b - a) / 86400000) + 1; return d > 0 ? d : 1 }
const PERIOD_KEY = { today: 'daily', week: 'weekly', month: 'monthly' }

export default function StaffPortal() {
  useCompactUI()
  const { t, lang, toggleTheme, toggleLang, theme } = useI18n()
  const { tenant, tenantId, user, profile, role, can, logout, updateMyProfile, changePassword } = useAuth()
  useSystemThemeBody(tenant, 'admin') // portal follows the venue's system theme fully (sheets/toasts too)
  const toast = useToast()
  const navigate = useNavigate()
  const ar = lang === 'ar'
  const currency = tenant?.currency || 'SAR'
  const [tab, setTab] = useState('home')
  const [period, setPeriod] = useState('today')
  const [orders, setOrders] = useState([])
  const [monthOrders, setMonthOrders] = useState([])
  const [reviews, setReviews] = useState([])
  const [punches, setPunches] = useState([])
  const [members, setMembers] = useState([])
  const [leaves, setLeaves] = useState([])
  const [announcements, setAnnouncements] = useState([])
  const [myShifts, setMyShifts] = useState([])
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [detailOrderId, setDetailOrderId] = useState('')
  const [swapOpen, setSwapOpen] = useState(false)
  const [swap, setSwap] = useState({ date: '', toUid: '', reason: '' })
  const [allSwaps, setAllSwaps] = useState([])
  const [declineFor, setDeclineFor] = useState(null) // swap being declined
  const [declineReason, setDeclineReason] = useState('')
  const [lv, setLv] = useState({ type: 'leave', from: '', to: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [pf, setPf] = useState({ name: '', phone: '', cur: '', pw: '' })
  const [savingPf, setSavingPf] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)

  const canOrders = can(CAP.TAKE_ORDERS)
  const name = profile?.displayName || user?.email || ''

  useEffect(() => { if (!tenantId || !canOrders) return; return watchActiveOrders(tenantId, setOrders) }, [tenantId, canOrders])
  useEffect(() => { if (!tenantId) return; return watchOrdersSince(tenantId, startOf('month'), setMonthOrders) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchAllReviews(tenantId, setReviews, 200) }, [tenantId])
  useEffect(() => { if (!tenantId || !user) return; return watchMyAttendance(tenantId, user.uid, setPunches, 120) }, [tenantId, user])
  useEffect(() => { if (!tenantId) return; return watchStaff(tenantId, setMembers) }, [tenantId])
  useEffect(() => { if (!tenantId || !user) return; return watchMyLeaves(tenantId, user.uid, setLeaves) }, [tenantId, user])
  useEffect(() => { if (!tenantId) return; return watchAnnouncements(tenantId, setAnnouncements, 10) }, [tenantId])
  useEffect(() => { if (!tenantId || !user) return; return watchMyShifts(tenantId, user.uid, setMyShifts) }, [tenantId, user])
  useEffect(() => { if (!tenantId) return; return watchShiftSwaps(tenantId, setAllSwaps) }, [tenantId])

  const periodTarget = tenant?.staffTargets?.[PERIOD_KEY[period]] || 0
  const monthlyTarget = tenant?.staffTargets?.monthly || 0
  const weeklyTarget = tenant?.staffTargets?.weekly || 0
  const base = useMemo(() => (members.length ? members : [{ uid: user?.uid, name, role }]), [members, user, name, role])
  const periodOrders = useMemo(() => monthOrders.filter((o) => (o.createdAt?.toMillis?.() || 0) >= startOf(period).getTime()), [monthOrders, period])
  const allRows = useMemo(() => scoreStaff(base, periodOrders, reviews, { period, target: periodTarget, roleTargets: buildRoleTargets(tenant, period), roleWeights: buildRoleWeights(tenant), ar }), [base, periodOrders, reviews, period, periodTarget, tenant, ar])
  const myRow = allRows.find((r) => r.uid === user?.uid) || { served: 0, handled: 0, points: 0, custCount: 0, avgRating: 0, ratingN: 0, progress: 0, level: { color: 'var(--text-muted)', ar: 'برونزي', en: 'Bronze' } }
  const teamAvgPoints = allRows.length ? Math.round(allRows.reduce((s, r) => s + r.points, 0) / allRows.length) : 0
  const roleRows = allRows.filter((r) => r.role === role)
  const roleAvgPoints = roleRows.length ? Math.round(roleRows.reduce((s, r) => s + r.points, 0) / roleRows.length) : 0
  // Month-based row + rank (for achievements, which should reflect the whole month).
  const monthRows = useMemo(() => scoreStaff(base, monthOrders, reviews, { period: 'month', target: monthlyTarget, roleTargets: buildRoleTargets(tenant, 'month'), roleWeights: buildRoleWeights(tenant), ar }), [base, monthOrders, reviews, monthlyTarget, tenant, ar])
  const monthRow = monthRows.find((r) => r.uid === user?.uid) || myRow
  const monthRank = Math.max(1, monthRows.findIndex((r) => r.uid === user?.uid) + 1)
  // 7-day points trend (derived per day from my orders).
  const last7 = useMemo(() => {
    const days = []
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); days.push({ start: d.getTime(), end: d.getTime() + 86400000, wd: d.getDay(), served: 0, points: 0 }) }
    monthOrders.forEach((o) => {
      if (o.status === 'cancelled') return
      const at = o.createdAt?.toMillis?.() || 0
      const day = days.find((x) => at >= x.start && at < x.end); if (!day) return
      if (o.servedByUid === user?.uid) { day.served++; day.points += 10 + Math.round((o.total || 0) / 10) }
      if (o.acceptedByUid === user?.uid) day.points += 4
    })
    return days
  }, [monthOrders, user])
  const maxPts = Math.max(1, ...last7.map((d) => d.points))
  const weekServed = monthOrders.filter((o) => o.status !== 'cancelled' && o.servedByUid === user?.uid && (o.createdAt?.toMillis?.() || 0) >= startOf('week').getTime()).length
  const me = members.find((x) => x.uid === user?.uid) || null
  const rank = Math.max(1, allRows.findIndex((r) => r.uid === user?.uid) + 1)
  const clockedIn = punches?.[0]?.type === 'in'
  const pendingLeaves = leaves.filter((l) => (l.status || 'pending') === 'pending').length

  // ---- attendance / payroll / leave derived metrics ----
  const monthStartMs = startOf('month').getTime()
  const hrsToday = hoursIn(punches, startToday().getTime())
  const hrsWeek = hoursIn(punches, startOf('week').getTime())
  const hrsMonth = hoursIn(punches, monthStartMs)
  const shiftHrs = shiftLenHrs(me?.shiftStart, me?.shiftEnd)
  const otAfter = Number(tenant?.overtimePolicy?.afterHours) || shiftHrs || 0
  const overtimeToday = otAfter ? Math.max(0, hrsToday - otAfter) : 0
  const otMonth = overtimePay(punches, monthStartMs, tenant?.overtimePolicy)
  const shiftRemainMin = clockedIn ? minutesUntil(me?.shiftEnd) : 0
  const monthInPunches = punches.filter((p) => p.type === 'in' && (p.at?.toMillis?.() || 0) >= monthStartMs)
  const lateCount = monthInPunches.filter((p) => (p.lateMinutes || 0) > 0).length
  const lateDed = monthInPunches.reduce((s, p) => s + (Number(p.deduction) || 0), 0)
  const salary = Number(me?.salary) || 0
  const manualDed = (Array.isArray(me?.deductions) ? me.deductions : []).reduce((s, d) => s + (Number(d.amount) || 0), 0)
  const targetBonus = monthRow.progress >= 1 ? (Number(tenant?.rewardPolicy?.monthlyTargetBonus) || 0) : 0
  const netSalary = Math.max(0, salary - manualDed - lateDed + otMonth.pay + targetBonus)
  const yearStart = (() => { const d = new Date(); d.setMonth(0, 1); d.setHours(0, 0, 0, 0); return d })()
  const annualLeave = tenant?.leavePolicy?.annualDays || 21
  const usedLeave = leaves.filter((l) => l.status === 'approved' && l.type !== 'permission' && new Date(l.from) >= yearStart).reduce((s, l) => s + leaveDays(l), 0)
  const leaveBalance = Math.max(0, annualLeave - usedLeave)

  const myStatus = me?.status || 'available'
  const STATUSES = [['available', ar ? 'متاح' : 'Available', 'var(--success)'], ['busy', ar ? 'مشغول' : 'Busy', 'var(--danger)'], ['break', ar ? 'استراحة' : 'Break', 'var(--gold)']]
  const availLabel = (s) => (STATUSES.find((x) => x[0] === s) || STATUSES[0])[1]
  // Switch status: close the previous busy/break session (with duration) and open a new one.
  const setStatus = async (s) => {
    if (!me || s === myStatus) return
    const now = Date.now()
    const prev = me.status || 'available'
    const since = me.statusSince || now
    try {
      if ((prev === 'busy' || prev === 'break') && me.statusSessionId) {
        await endStatusSession(tenantId, me.statusSessionId, { endedAt: now, durationMs: Math.max(0, now - since) })
      }
      let sessionId = null
      if (s === 'busy' || s === 'break') {
        sessionId = await startStatusSession(tenantId, { staffUid: user.uid, staffName: name, status: s, startedAt: now })
      }
      await setStaffMeta(tenantId, user.uid, { status: s, statusSince: now, statusSessionId: sessionId })
    } catch (_) { toast.error(t('error')) }
  }

  // Live elapsed in the current busy/break status + self-alert past the allowed limit.
  const [, setTick] = useState(0)
  const overstayAlerted = useRef(null)
  const statusLimitMin = myStatus === 'break' ? (tenant?.statusPolicy?.breakLimitMinutes ?? 30) : myStatus === 'busy' ? (tenant?.statusPolicy?.busyLimitMinutes ?? 60) : 0
  const statusLimitMs = statusLimitMin * 60000
  const statusElapsedMs = (myStatus === 'busy' || myStatus === 'break') && me?.statusSince ? Date.now() - me.statusSince : 0
  useEffect(() => {
    if (myStatus !== 'busy' && myStatus !== 'break') return
    const limitMs = (myStatus === 'break' ? (tenant?.statusPolicy?.breakLimitMinutes ?? 30) : (tenant?.statusPolicy?.busyLimitMinutes ?? 60)) * 60000
    const check = () => {
      setTick((n) => n + 1)
      const elapsed = Date.now() - (me?.statusSince || Date.now())
      if (limitMs > 0 && elapsed > limitMs && overstayAlerted.current !== me?.statusSessionId) {
        overstayAlerted.current = me?.statusSessionId
        const mins = Math.round(elapsed / 60000)
        const hh = Math.floor(mins / 60), mm = mins % 60
        const dur = hh > 0 ? (ar ? `${hh}س ${mm}د` : `${hh}h ${mm}m`) : (ar ? `${mm}د` : `${mm}m`)
        toast.error(ar ? `تجاوزت وقت «${availLabel(myStatus)}» المسموح (${statusLimitMin}د) — أنت منذ ${dur}` : `Over the allowed "${availLabel(myStatus)}" time (${statusLimitMin}m) — ${dur} elapsed`)
        alertParty({ title: ar ? 'تجاوزت الوقت المسموح' : 'Over the limit', body: ar ? `وضع ${availLabel(myStatus)} منذ ${dur}` : `${availLabel(myStatus)} for ${dur}`, tag: 'overstay' })
      }
    }
    check()
    const iv = setInterval(check, 60000)
    return () => clearInterval(iv)
  }, [myStatus, me?.statusSince, me?.statusSessionId]) // eslint-disable-line react-hooks/exhaustive-deps
  const visibleAnnouncements = announcements.filter((a) => (a.publishAt || a.createdAt?.toMillis?.() || 0) <= Date.now() && (!a.expiresAt || a.expiresAt > Date.now()))
  const achievements = achievementsFor(monthRow, { rank: monthRank, lateCount, hasPunches: punches.length > 0, ar })
  const earnedBadges = achievements.filter((a) => a.earned)
  const nextBadge = achievements.filter((a) => !a.earned).sort((a, b) => b.progress - a.progress)[0]
  // this week's schedule (assigned shifts keyed by ISO date)
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const weekDays = useMemo(() => { const s = startOf('week'); return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(d.getDate() + i); return d }) }, [])
  const shiftByDate = useMemo(() => { const m = {}; myShifts.forEach((s) => { m[s.date] = s }); return m }, [myShifts])
  const todayIsoP = isoOf(new Date())
  const coworkers = members.filter((m) => m.uid !== user?.uid && m.active !== false)
  const acceptedSwaps = allSwaps.filter((s) => s.status === 'accepted')
  // Days I can swap = my upcoming working days (assigned shift OR a work day), next 14 days.
  const upcomingWorkDays = useMemo(() => {
    const out = []
    const wd = Array.isArray(me?.workDays) ? me.workDays : [0, 1, 2, 3, 4]
    const base = new Date(); base.setHours(0, 0, 0, 0)
    for (let i = 0; i < 14; i++) {
      const d = new Date(base); d.setDate(d.getDate() + i)
      const iso = isoOf(d); const assigned = shiftByDate[iso]
      const isWork = assigned ? !!assigned.start : wd.includes(d.getDay())
      // skip days I already gave away
      const gave = acceptedSwaps.some((s) => s.fromUid === user?.uid && s.date === iso)
      if (isWork && !gave) out.push({ iso, d, start: assigned?.start || me?.shiftStart || '', end: assigned?.end || me?.shiftEnd || '' })
    }
    return out
  }, [me, shiftByDate, acceptedSwaps, user])
  const incomingSwaps = allSwaps.filter((s) => s.toUid === user?.uid && (s.status || 'pending') === 'pending')

  const submitSwap = async () => {
    if (!swap.date || !swap.toUid) { toast.error(ar ? 'اختر اليوم والزميل' : 'Pick a day & coworker'); return }
    if (!swap.reason.trim()) { toast.error(ar ? 'اذكر سبب التبديل' : 'Add a reason'); return }
    const day = upcomingWorkDays.find((s) => s.iso === swap.date)
    const co = members.find((m) => m.uid === swap.toUid)
    setBusy(true)
    try {
      await createShiftSwap(tenantId, { date: swap.date, fromUid: user.uid, fromName: name, toUid: swap.toUid, toName: co?.name || co?.email || '', fromStart: day?.start || '', fromEnd: day?.end || '', reason: swap.reason.trim() })
      setSwapOpen(false); setSwap({ date: '', toUid: '', reason: '' })
      toast.success(ar ? 'تم إرسال طلب التبديل للزميل' : 'Swap request sent')
    } catch (_) { toast.error(t('error')) } finally { setBusy(false) }
  }
  const acceptSwap = async (s) => {
    try { await setShiftSwapStatus(tenantId, s.id, 'accepted'); toast.success(ar ? 'تم قبول التبديل' : 'Swap accepted') } catch (_) { toast.error(t('error')) }
  }
  const confirmDecline = async () => {
    try { await setShiftSwapStatus(tenantId, declineFor.id, 'declined', declineReason.trim()); setDeclineFor(null); setDeclineReason('') } catch (_) { toast.error(t('error')) }
  }

  const advance = (o) => {
    const n = NEXT[o.status]; if (!n) return
    const extra = {}
    if (n === 'accepted') { extra.acceptedByUid = user.uid; extra.acceptedByName = name }
    if (n === 'served') { extra.servedByUid = user.uid; extra.servedByName = name }
    updateOrderStatus(tenantId, o.id, n, extra).catch(() => toast.error(t('error')))
  }

  const submitLeave = async () => {
    if (!lv.from) { toast.error(ar ? 'حدّد تاريخ البداية' : 'Pick a start date'); return }
    setBusy(true)
    try {
      await createLeaveRequest(tenantId, { staffUid: user.uid, staffName: name, ...lv })
      setLeaveOpen(false); setLv({ type: 'leave', from: '', to: '', reason: '' })
      toast.success(ar ? 'تم إرسال الطلب' : 'Request sent')
    } catch (_) { toast.error(t('error')) } finally { setBusy(false) }
  }

  const staffId = me?.staffId || staffIdFallback(tenant, user?.uid)
  const myPhoto = me?.photoUrl || user?.photoURL || ''

  const onPhoto = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    try {
      const small = await shrinkImage(file)
      const url = await uploadImage(tenantId, small, 'staff-photos')
      await updateMyProfile({ photoUrl: url })
      toast.success(t('saved'))
    } catch (e) {
      // surface the real cause — permission-denied here means the updated
      // firestore/storage rules have not been deployed yet
      const c = e?.code || ''
      toast.error((ar ? 'تعذّر حفظ الصورة' : 'Photo failed') + (c ? ` · ${c}` : ''))
    } finally { setPhotoBusy(false) }
  }

  const saveProfile = async () => {
    if (pf.pw && pf.pw.length < 6) { toast.error(ar ? 'كلمة المرور 6 أحرف على الأقل' : 'Password min 6 chars'); return }
    setSavingPf(true)
    try {
      if (pf.name.trim() && pf.name.trim() !== name) await updateMyProfile({ displayName: pf.name.trim() })
      // owners/managers may have NO staff row — writing staff meta to a missing
      // doc was the silent «حدث خطأ» on profile save
      if (me && pf.phone.trim() !== (me?.phone || '')) await setStaffMeta(tenantId, user.uid, { phone: pf.phone.trim() })
      if (pf.pw) await changePassword(pf.cur, pf.pw)
      setProfileOpen(false); setPf((v) => ({ ...v, cur: '', pw: '' }))
      toast.success(t('saved'))
    } catch (e) {
      const c = e?.code || ''
      toast.error(c === 'auth/wrong-password' || c === 'auth/invalid-credential' ? (ar ? 'كلمة المرور الحالية خاطئة' : 'Wrong current password')
        : c === 'auth/requires-recent-login' ? (ar ? 'أدخل كلمة المرور الحالية للتغيير' : 'Enter current password to change')
        : (ar ? 'تعذّر الحفظ' : 'Save failed') + (c ? ` · ${c}` : ''))
    } finally { setSavingPf(false) }
  }

  const TABS = [
    { id: 'home', icon: 'home', label: ar ? 'الرئيسية' : 'Home' },
    ...(canOrders ? [{ id: 'orders', icon: 'orders', label: ar ? 'الطلبات' : 'Orders' }] : []),
    { id: 'attendance', icon: 'scan', label: ar ? 'الحضور' : 'Attendance' },
    { id: 'leave', icon: 'calendar', label: ar ? 'الإجازات' : 'Leave' },
  ]
  const leaveLabel = (x) => ({ leave: ar ? 'إجازة' : 'Leave', sick: ar ? 'مرضي' : 'Sick', permission: ar ? 'استئذان' : 'Permission' }[x] || x)
  const statusBadge = (s) => s === 'approved' ? 'badge-success' : s === 'declined' ? 'badge-danger' : ''
  const statusLabel = (s) => ({ pending: ar ? 'قيد المراجعة' : 'Pending', approved: ar ? 'مقبولة' : 'Approved', declined: ar ? 'مرفوضة' : 'Declined' }[s] || s)

  return (
    <div className="portal-shell" data-systheme={systemThemeAttr(tenant, 'admin')} style={{ minHeight: '100dvh', paddingBottom: 'calc(var(--bottomnav-h) + var(--safe-b))' }}>
      <AppBackground tenant={tenant} />
      <header className="app-bar">
        <button className="icon-btn" onClick={() => setDrawerOpen(true)} aria-label="menu"><Icon name="more" /></button>
        <strong style={{ fontSize: 'var(--fs-md)' }}>{ar ? 'بوابتي' : 'My portal'}</strong>
        <div className="grow" />
        <StaffBell tenantId={tenantId} />
        <button className="icon-btn" onClick={toggleLang} style={{ fontWeight: 800, fontSize: 13 }}>{ar ? 'EN' : 'ع'}</button>
        <button className="icon-btn" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
        <button className="icon-btn portal-desktop-only" onClick={logout} title={t('logout')} style={{ color: 'var(--danger)' }}><Icon name="logout" /></button>
      </header>

      {/* DESKTOP navigation: the phone bottom-nav is hidden ≥900px — tabs live up top */}
      <div className="portal-topnav">
        {TABS.map((tb) => (
          <button key={tb.id} className={`chip ${tab === tb.id ? 'active' : ''}`} onClick={() => setTab(tb.id)} style={{ position: 'relative' }}>
            <Icon name={tb.icon} size={15} /> {tb.label}
            {tb.id === 'leave' && pendingLeaves > 0 && <span className="cart-badge">{pendingLeaves}</span>}
          </button>
        ))}
      </div>

      <main className="container">
        {tab === 'home' && (
          <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
            {/* hero */}
            <div className="portal-hero">
              <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 12, opacity: .92 }}>
                {tenant?.logoUrl ? <img src={tenant.logoUrl} alt="" style={{ width: 24, height: 24, borderRadius: 7, objectFit: 'cover' }} /> : <Icon name="store" size={17} />}
                <span className="small bold">{tenant?.name}</span>
              </div>
              <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                <span className="portal-avatar" style={{ overflow: 'hidden', padding: 0 }}>{myPhoto ? <img src={myPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (name || '?').charAt(0).toUpperCase()}</span>
                <div className="grow">
                  <div className="bold" style={{ fontSize: 'var(--fs-lg)' }}>{ar ? `أهلاً، ${name.split(' ')[0] || ''}` : `Hi, ${name.split(' ')[0] || ''}`}</div>
                  <div className="xs" style={{ opacity: .85 }}>{roleName(role, lang)} · {new Date().toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                </div>
                <button className="portal-chip" onClick={() => { setPf({ name, phone: me?.phone || '', cur: '', pw: '' }); setProfileOpen(true) }}><Icon name="edit" size={13} /> {ar ? 'تعديل' : 'Edit'}</button>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <span className="portal-chip" dir="ltr"><Icon name="user" size={13} /> {staffId}</span>
                <span className="portal-chip"><Icon name="award" size={13} /> {ar ? 'المركز' : 'Rank'} #{rank}</span>
                <span className="portal-chip" style={{ color: myRow.level?.color }}>{ar ? myRow.level?.ar : myRow.level?.en}</span>
                {myRow.ratingN > 0 && <span className="portal-chip"><Icon name="star" size={13} fill="currentColor" strokeWidth={1.5} /> {myRow.avgRating.toFixed(1)}</span>}
              </div>
              {/* availability — self-set, visible to managers; logs busy/break duration */}
              <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                {STATUSES.map(([id, label, color]) => (
                  <button key={id} className="portal-chip" onClick={() => setStatus(id)}
                    style={{ background: myStatus === id ? 'var(--on-brand)' : 'transparent', color: myStatus === id ? color : 'var(--on-brand)', borderColor: 'color-mix(in srgb, var(--on-brand) 33%, transparent)', fontWeight: myStatus === id ? 800 : 600 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} /> {label}
                  </button>
                ))}
                {statusElapsedMs > 0 && (
                  <span className="portal-chip" style={{ background: statusLimitMs > 0 && statusElapsedMs > statusLimitMs ? 'var(--danger)' : 'transparent', color: 'var(--on-brand)', borderColor: 'color-mix(in srgb, var(--on-brand) 33%, transparent)' }}>
                    <Icon name="clock" size={12} /> {Math.floor(statusElapsedMs / 3600000)}:{String(Math.floor((statusElapsedMs % 3600000) / 60000)).padStart(2, '0')}{statusLimitMin > 0 ? ` / ${statusLimitMin}${ar ? 'د' : 'm'}` : ''}
                  </span>
                )}
              </div>
            </div>

            {/* announcements from the venue (only published & not expired) */}
            {visibleAnnouncements.length > 0 && (
              <div className="card card-pad stack" style={{ gap: 10 }}>
                <div className="row" style={{ gap: 6 }}><Icon name="bell" size={15} className="faint" /><strong className="small">{ar ? 'إعلانات المنشأة' : 'Announcements'}</strong></div>
                {visibleAnnouncements.slice(0, 3).map((a) => (
                  <div key={a.id} className="stack" style={{ gap: 2, borderInlineStart: '3px solid var(--brand)', paddingInlineStart: 10 }}>
                    {a.title && <div className="small bold">{a.title}</div>}
                    {a.body && <div className="xs faint" style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>}
                    <div className="xs faint">{a.authorName ? `${a.authorName} · ` : ''}{timeAgo(a.createdAt, lang)}</div>
                  </div>
                ))}
              </div>
            )}

            {/* clock card */}
            <div className="card card-pad row" style={{ gap: 12, alignItems: 'center' }}>
              <span className="center" style={{ width: 50, height: 50, borderRadius: '50%', background: clockedIn ? 'var(--success-soft)' : 'var(--surface-2)', color: clockedIn ? 'var(--success)' : 'var(--text-muted)', flex: 'none' }}><Icon name={clockedIn ? 'ok' : 'clock'} size={24} /></span>
              <div className="grow">
                <div className="bold">{clockedIn ? (ar ? 'أنت في الدوام' : 'On shift') : (ar ? 'خارج الدوام' : 'Off shift')}</div>
                <div className="xs faint">
                  {me?.shiftStart && <span dir="ltr">{me.shiftStart}{me.shiftEnd ? `–${me.shiftEnd}` : ''} · </span>}
                  {ar ? `اليوم ${hrsToday.toFixed(1)} س` : `${hrsToday.toFixed(1)}h today`}
                  {clockedIn && shiftRemainMin > 0 && <span> · {ar ? `يتبقّى ${Math.floor(shiftRemainMin / 60)}:${String(shiftRemainMin % 60).padStart(2, '0')}` : `${Math.floor(shiftRemainMin / 60)}:${String(shiftRemainMin % 60).padStart(2, '0')} left`}</span>}
                </div>
              </div>
              <button className={`btn btn-sm ${clockedIn ? 'btn-outline' : 'btn-primary'}`} onClick={() => setTab('attendance')}><Icon name="camera" size={15} /> {clockedIn ? (ar ? 'انصراف' : 'Out') : (ar ? 'حضور' : 'In')}</button>
            </div>

            {/* incoming swap requests (a coworker wants to swap with me) */}
            {incomingSwaps.length > 0 && (
              <div className="card card-pad stack" style={{ gap: 10, borderInlineStart: '3px solid var(--gold)' }}>
                <strong className="small row" style={{ gap: 6 }}><Icon name="repeat" size={15} style={{ color: 'var(--gold)' }} /> {ar ? 'طلبات تبديل واردة' : 'Swap requests for you'}</strong>
                {incomingSwaps.map((s) => (
                  <div key={s.id} className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <div className="small"><strong>{s.fromName}</strong> {ar ? 'يطلب أن تغطّي يوم' : 'asks you to cover'} <span dir="ltr">{new Date(s.date).toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { weekday: 'long', day: 'numeric', month: 'short' })}</span> {s.fromStart ? <span dir="ltr">({s.fromStart}–{s.fromEnd})</span> : null}</div>
                    {s.reason && <div className="xs faint">{ar ? 'السبب' : 'Reason'}: {s.reason}</div>}
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn btn-sm btn-outline grow" style={{ color: 'var(--danger)' }} onClick={() => { setDeclineFor(s); setDeclineReason('') }}><Icon name="no" size={14} /> {ar ? 'رفض' : 'Decline'}</button>
                      <button className="btn btn-sm btn-success grow" onClick={() => acceptSwap(s)}><Icon name="check" size={14} /> {ar ? 'قبول' : 'Accept'}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* my weekly schedule (reflects accepted swaps) */}
            <div className="card card-pad stack" style={{ gap: 8 }}>
              <div className="row-between">
                <strong className="small row" style={{ gap: 6 }}><Icon name="calendar" size={15} className="faint" /> {ar ? 'جدول هذا الأسبوع' : 'This week'}</strong>
                {coworkers.length > 0 && upcomingWorkDays.length > 0 && (
                  <button className="btn btn-sm btn-outline" onClick={() => { setSwap({ date: upcomingWorkDays[0]?.iso || '', toUid: '', reason: '' }); setSwapOpen(true) }}><Icon name="repeat" size={13} /> {ar ? 'تبديل وردية' : 'Swap'}</button>
                )}
              </div>
              <div className="row" style={{ gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                {weekDays.map((d) => {
                  const iso = isoOf(d); const isToday = iso === todayIsoP
                  const gaveAway = acceptedSwaps.some((s) => s.fromUid === user?.uid && s.date === iso)
                  const covering = acceptedSwaps.find((s) => s.toUid === user?.uid && s.date === iso)
                  const base = shiftByDate[iso]
                  const eff = covering ? { start: covering.fromStart, end: covering.fromEnd } : (!gaveAway ? base : null)
                  return (
                    <div key={iso} className="stack center" style={{ flex: 'none', width: 62, gap: 2, padding: '8px 4px', borderRadius: 10, border: `1px solid ${isToday ? 'var(--brand)' : 'var(--border)'}`, background: eff ? (covering ? 'color-mix(in srgb, var(--gold, #d8b26a) 18%, var(--surface))' : 'var(--brand-soft)') : 'var(--surface-2)' }}>
                      <span className="xs faint">{d.toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { weekday: 'short' })}</span>
                      <span className="xs bold">{d.getDate()}</span>
                      {eff ? <span className="xs bold" dir="ltr" style={{ color: covering ? 'var(--gold)' : 'var(--brand)', fontSize: 10, textAlign: 'center' }}>{eff.start}<br />{eff.end}{covering ? <><br />{ar ? '(تغطية)' : '(cover)'}</> : null}</span>
                        : <span className="xs faint">{gaveAway ? (ar ? 'بدّلت' : 'swapped') : (ar ? 'إجازة' : 'Off')}</span>}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* period toggle */}
            <div className="row" style={{ gap: 6 }}>
              {[['today', ar ? 'اليوم' : 'Today'], ['week', ar ? 'الأسبوع' : 'Week'], ['month', ar ? 'الشهر' : 'Month']].map(([id, lbl]) => (
                <button key={id} className={`chip ${period === id ? 'active' : ''} grow`} onClick={() => setPeriod(id)}>{lbl}</button>
              ))}
            </div>

            {/* stats */}
            <div className="stat-grid">
              <div className="stat"><div className="label">{ar ? 'قدّمت' : 'Served'}</div><div className="value num">{myRow.served}</div></div>
              <div className="stat"><div className="label">{ar ? 'استلمت' : 'Took'}</div><div className="value num">{myRow.handled}</div></div>
              <div className="stat"><div className="label">{ar ? 'نقاطي' : 'Points'}</div><div className="value num" style={{ color: 'var(--brand)' }}>{myRow.points}</div></div>
              <div className="stat"><div className="label">{ar ? 'عملاء' : 'Guests'}</div><div className="value num">{myRow.custCount}</div></div>
            </div>

            {/* you vs team average + same-role average (fair comparison) */}
            <div className="card card-pad stack" style={{ gap: 8 }}>
              <div className="row-between">
                <span className="small row" style={{ gap: 6 }}><Icon name="staff" size={15} className="faint" /> {ar ? 'أنت مقابل متوسّط الفريق' : 'You vs team avg'}</span>
                <span className="small"><strong style={{ color: 'var(--brand)' }}>{myRow.points}</strong> <span className="faint">/ {teamAvgPoints}</span> {myRow.points >= teamAvgPoints ? <Icon name="trending" size={14} style={{ color: 'var(--success)' }} /> : null}</span>
              </div>
              {roleRows.length > 1 && (
                <div className="row-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <span className="small row" style={{ gap: 6 }}><Icon name="award" size={15} className="faint" /> {ar ? `مقابل متوسّط ${roleName(role, lang)}` : `vs ${roleName(role, lang)} avg`}</span>
                  <span className="small"><strong style={{ color: 'var(--brand)' }}>{myRow.points}</strong> <span className="faint">/ {roleAvgPoints}</span> {myRow.points >= roleAvgPoints ? <Icon name="trending" size={14} style={{ color: 'var(--success)' }} /> : null}</span>
                </div>
              )}
            </div>

            {myRow.targetMetrics ? (
              <div className="card card-pad stack" style={{ gap: 8 }}>
                <div className="row-between small"><span className="row" style={{ gap: 6 }}><Icon name="award" size={15} className="faint" /> {ar ? 'هدف وظيفتي' : 'My role target'} ({{ today: ar ? 'يومي' : 'daily', week: ar ? 'أسبوعي' : 'weekly', month: ar ? 'شهري' : 'monthly' }[period]})</span><span className="bold">{Math.round(myRow.progress * 100)}%</span></div>
                {myRow.targetMetrics.map((mt) => {
                  const meta = TARGET_METRICS.find((x) => x.key === mt.key) || {}
                  const pct = Math.min(100, (mt.value / mt.target) * 100)
                  const done = mt.value >= mt.target
                  return (
                    <div key={mt.key} className="stack" style={{ gap: 3 }}>
                      <div className="row-between xs"><span className="faint">{ar ? meta.ar : meta.en}</span><span className="bold">{mt.value}/{mt.target}</span></div>
                      <div style={{ height: 7, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: done ? 'var(--success)' : 'var(--brand)', borderRadius: 99, transition: 'width .3s' }} /></div>
                    </div>
                  )
                })}
                {myRow.progress >= 1 ? <span className="xs" style={{ color: 'var(--success)' }}><Icon name="check" size={12} /> {ar ? 'حقّقت هدف وظيفتك!' : 'Role target hit!'}</span>
                  : (() => {
                    const behind = myRow.targetMetrics.filter((m) => m.value < m.target).map((m) => ({ ...m, rem: m.target - m.value })).sort((a, b) => b.rem - a.rem)[0]
                    if (!behind) return null
                    const meta = TARGET_METRICS.find((x) => x.key === behind.key) || {}
                    return <span className="xs faint"><Icon name="sparkles" size={11} /> {ar ? `تبقّى ${behind.rem} (${meta.ar}) لإكمال هدفك` : `${behind.rem} more ${meta.en} to hit your goal`}</span>
                  })()}
              </div>
            ) : periodTarget > 0 ? (
              <div className="card card-pad stack" style={{ gap: 6 }}>
                <div className="row-between small"><span className="row" style={{ gap: 6 }}><Icon name="award" size={15} className="faint" /> {ar ? 'الهدف' : 'Target'} ({{ today: ar ? 'يومي' : 'daily', week: ar ? 'أسبوعي' : 'weekly', month: ar ? 'شهري' : 'monthly' }[period]})</span><span className="bold">{myRow.served}/{periodTarget}</span></div>
                <div style={{ height: 9, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(100, (myRow.served / periodTarget) * 100)}%`, background: myRow.served >= periodTarget ? 'var(--success)' : 'var(--brand)', borderRadius: 99, transition: 'width .3s' }} /></div>
                {myRow.served >= periodTarget && <span className="xs" style={{ color: 'var(--success)' }}><Icon name="check" size={12} /> {ar ? 'حقّقت الهدف!' : 'Target hit!'}</span>}
              </div>
            ) : null}

            {/* weekly challenge */}
            {weeklyTarget > 0 && (
              <div className="card card-pad stack" style={{ gap: 6, borderInlineStart: '3px solid var(--gold)' }}>
                <div className="row-between small"><span className="row" style={{ gap: 6 }}><Icon name="award" size={15} style={{ color: 'var(--gold)' }} /> {ar ? 'تحدّي الأسبوع' : 'Weekly challenge'}</span><span className="bold">{weekServed}/{weeklyTarget}</span></div>
                <div className="xs faint">{ar ? `قدّم ${weeklyTarget} طلباً هذا الأسبوع` : `Serve ${weeklyTarget} orders this week`}</div>
                <div style={{ height: 8, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(100, (weekServed / weeklyTarget) * 100)}%`, background: weekServed >= weeklyTarget ? 'var(--success)' : 'var(--gold)', borderRadius: 99, transition: 'width .3s' }} /></div>
                {weekServed >= weeklyTarget && <span className="xs row" style={{ color: 'var(--success)', gap: 4, alignItems: 'center' }}><Icon name="award" size={13} /> {ar ? 'أكملت التحدّي!' : 'Challenge complete!'}</span>}
              </div>
            )}

            {/* achievements */}
            <div className="card card-pad stack" style={{ gap: 10 }}>
              <div className="row-between">
                <strong className="small row" style={{ gap: 6 }}><Icon name="award" size={15} style={{ color: 'var(--gold)' }} /> {ar ? 'إنجازاتي' : 'Achievements'}</strong>
                <span className="xs faint">{earnedBadges.length}/{achievements.length}</span>
              </div>
              {earnedBadges.length > 0 ? (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {earnedBadges.map((b) => (
                    <span key={b.id} className="badge" title={b.desc} style={{ background: 'color-mix(in srgb, ' + b.color + ' 18%, transparent)', color: b.color, fontWeight: 700 }}>
                      <Icon name={b.icon} size={13} fill={b.icon === 'star' ? 'currentColor' : 'none'} strokeWidth={1.6} /> {b.label}
                    </span>
                  ))}
                </div>
              ) : <div className="xs faint">{ar ? 'لا إنجازات بعد — ابدأ بتقديم الطلبات!' : 'No badges yet — start serving!'}</div>}
              {nextBadge && (
                <div className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <div className="row-between xs"><span className="faint">{ar ? 'التالي' : 'Next'}: {nextBadge.label}</span><span className="faint">{Math.round(nextBadge.progress * 100)}%</span></div>
                  <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.round(nextBadge.progress * 100)}%`, background: nextBadge.color, borderRadius: 99 }} /></div>
                </div>
              )}
            </div>

            {/* 7-day points trend */}
            <div className="card card-pad stack" style={{ gap: 8 }}>
              <strong className="small row" style={{ gap: 6 }}><Icon name="trending" size={15} className="faint" /> {ar ? 'أدائي آخر 7 أيام' : 'Last 7 days'}</strong>
              <div className="row" style={{ gap: 6, alignItems: 'flex-end', height: 80 }}>
                {last7.map((d, i) => {
                  const wd = new Date(d.start).toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { weekday: 'narrow' })
                  const today = i === last7.length - 1
                  return (
                    <div key={i} className="grow stack" style={{ gap: 4, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                      <div style={{ width: '100%', maxWidth: 26, height: `${Math.max(6, (d.points / maxPts) * 64)}px`, borderRadius: 6, background: today ? 'var(--brand)' : 'color-mix(in srgb, var(--brand) 40%, var(--surface))', boxShadow: 'inset 0 0 0 1px var(--border)', transition: 'height .3s' }} title={`${d.points} ${ar ? 'نقطة' : 'pts'}`} />
                      <span className="xs faint">{wd}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* work summary: hours · overtime · lateness */}
            <div className="card card-pad stack" style={{ gap: 10 }}>
              <strong className="small row" style={{ gap: 6 }}><Icon name="clock" size={15} className="faint" /> {ar ? 'ملخّص الدوام' : 'Work summary'}</strong>
              <div className="stat-grid">
                <div className="stat"><div className="label">{ar ? 'اليوم' : 'Today'}</div><div className="value num">{hrsToday.toFixed(1)}<span className="xs faint"> {ar ? 'س' : 'h'}</span></div></div>
                <div className="stat"><div className="label">{ar ? 'الأسبوع' : 'Week'}</div><div className="value num">{hrsWeek.toFixed(1)}<span className="xs faint"> {ar ? 'س' : 'h'}</span></div></div>
                <div className="stat"><div className="label">{ar ? 'الشهر' : 'Month'}</div><div className="value num">{hrsMonth.toFixed(0)}<span className="xs faint"> {ar ? 'س' : 'h'}</span></div></div>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {overtimeToday > 0.05 && <span className="badge badge-success">{ar ? 'إضافي اليوم' : 'OT today'} +{overtimeToday.toFixed(1)}{ar ? 'س' : 'h'}</span>}
                {otMonth.hours > 0.05 && <span className="badge badge-success">{ar ? `إضافي الشهر ${otMonth.hours.toFixed(1)}س` : `OT month ${otMonth.hours.toFixed(1)}h`}{otMonth.pay > 0 ? ` · +${otMonth.pay}` : ''}</span>}
                {lateCount > 0 && <span className="badge badge-danger">{ar ? `تأخير الشهر: ${lateCount}` : `Late this month: ${lateCount}`}</span>}
                {lateCount === 0 && <span className="badge badge-success"><Icon name="check" size={12} /> {ar ? 'بدون تأخير' : 'No lateness'}</span>}
              </div>
            </div>

            {/* payslip + leave balance */}
            <div className="card card-pad row-between" onClick={() => setPayOpen(true)} style={{ cursor: 'pointer' }}>
              <div className="stack" style={{ gap: 2 }}>
                <span className="small row" style={{ gap: 6 }}><Icon name="reports" size={15} className="faint" /> {ar ? 'راتبي هذا الشهر' : 'My pay this month'}</span>
                <span className="xs faint">{ar ? `رصيد الإجازات: ${leaveBalance} يوم` : `Leave balance: ${leaveBalance} days`}</span>
              </div>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="price bold"><Price value={netSalary} currency={currency} lang={lang} /></span>
                <Icon name={ar ? 'back' : 'next'} size={16} className="faint" />
              </div>
            </div>

            <div className="menu-grid">
              {canOrders && <button className="card card-pad row" onClick={() => setTab('orders')}><Icon name="orders" size={22} /><span className="bold">{ar ? 'الطلبات' : 'Orders'}</span></button>}
              <button className="card card-pad row" onClick={() => setTab('leave')} style={{ position: 'relative' }}><Icon name="calendar" size={22} /><span className="bold">{ar ? 'إجازاتي' : 'My leave'}</span>{pendingLeaves > 0 && <span className="badge badge-gold" style={{ marginInlineStart: 'auto' }}>{pendingLeaves}</span>}</button>
              <button className="card card-pad row portal-qa-logout" onClick={logout} style={{ color: 'var(--danger)' }}><Icon name="logout" size={22} /><span className="bold">{t('logout')}</span></button>
            </div>
          </div>
        )}

        {tab === 'orders' && canOrders && (
          <div className="page stack">
            <h2 className="page-title">{ar ? 'الطلبات النشطة' : 'Active orders'}</h2>
            {orders.length === 0 ? (
              <div className="empty"><div className="emoji"><Icon name="orders" size={40} /></div><p className="muted small">{ar ? 'لا طلبات نشطة' : 'No active orders'}</p></div>
            ) : (
              <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                {orders.map((o) => (
                  <div key={o.id} className="card card-pad stack" style={{ gap: 8, cursor: 'pointer' }} onClick={() => setDetailOrderId(o.id)}>
                    <div className="row-between">
                      <strong>{orderNumber(o.code)}</strong>
                      <span className="xs faint">{timeAgo(o.createdAt, lang)}</span>
                    </div>
                    <div className="xs faint row" style={{ gap: 5 }}>
                      <Icon name={o.orderType === 'curbside' ? 'car' : o.orderType === 'pickup' ? 'bag' : 'tables'} size={13} />
                      {o.tableLabel || (o.orderType === 'curbside' ? t('curbside') : o.orderType === 'pickup' ? t('pickup') : t('dineIn'))}
                      · {(o.items || []).reduce((s, l) => s + (l.qty || 1), 0)} {ar ? 'صنف' : 'items'}
                    </div>
                    {o.acceptedByName && <div className="xs" style={{ color: 'var(--brand)' }}><Icon name="user" size={12} /> {o.servedByName || o.acceptedByName}</div>}
                    <div className="row-between">
                      <span className="price bold"><Price value={o.total} currency={currency} lang={lang} /></span>
                      {NEXT[o.status] && <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); advance(o) }}>{{ accepted: ar ? 'قبول' : 'Accept', preparing: ar ? 'تحضير' : 'Prepare', ready: ar ? 'جاهز' : 'Ready', served: ar ? 'تقديم' : 'Serve' }[NEXT[o.status]]}</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'attendance' && <Attendance />}

        {tab === 'leave' && (
          <div className="page stack">
            <div className="row-between">
              <h2 className="page-title">{ar ? 'إجازاتي' : 'My leave'}</h2>
              <button className="btn btn-primary btn-sm" onClick={() => setLeaveOpen(true)}><Icon name="add" size={14} /> {ar ? 'طلب إجازة' : 'Request'}</button>
            </div>
            {leaves.length === 0 ? (
              <div className="empty"><div className="emoji"><Icon name="calendar" size={40} /></div><p className="muted small">{ar ? 'لا طلبات إجازة' : 'No leave requests'}</p></div>
            ) : (
              <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                {leaves.map((l) => (
                  <div key={l.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                    <Icon name="calendar" size={20} className="faint" />
                    <div className="grow">
                      <div className="small bold">{leaveLabel(l.type)} · <span dir="ltr">{l.from}{l.to ? ` → ${l.to}` : ''}</span></div>
                      {l.reason && <div className="xs faint">{l.reason}</div>}
                      {l.status === 'declined' && l.declineReason && <div className="xs" style={{ color: 'var(--danger)', marginTop: 2 }}><Icon name="no" size={11} /> {ar ? 'سبب الرفض' : 'Reason'}: {l.declineReason}</div>}
                    </div>
                    <span className={`badge ${statusBadge(l.status)}`}>{statusLabel(l.status)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <nav className="m-bottomnav">
        {TABS.map((tb) => (
          <button key={tb.id} className={tab === tb.id ? 'active' : ''} onClick={() => setTab(tb.id)}>
            <Icon name={tb.icon} size={20} /><span>{tb.label}</span>
            {tb.id === 'leave' && pendingLeaves > 0 && <span className="cart-badge">{pendingLeaves}</span>}
          </button>
        ))}
      </nav>

      {/* side drawer (smart, role-aware) */}
      <Sheet open={drawerOpen} onClose={() => setDrawerOpen(false)} title={ar ? 'القائمة' : 'Menu'}>
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <div className="row" style={{ gap: 10, paddingBottom: 'var(--sp-2)' }}>
            <span className="portal-avatar" style={{ width: 44, height: 44, fontSize: 18, background: 'var(--brand)', overflow: 'hidden', padding: 0 }}>{myPhoto ? <img src={myPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (name || '?').charAt(0).toUpperCase()}</span>
            <div className="grow"><div className="bold">{name}</div><div className="xs faint" dir="ltr">{staffId}</div></div>
          </div>
          {[
            { id: 'home', icon: 'home', label: ar ? 'الرئيسية' : 'Home', show: true },
            { id: 'orders', icon: 'orders', label: ar ? 'الطلبات' : 'Orders', show: canOrders },
            { id: 'attendance', icon: 'scan', label: ar ? 'الحضور' : 'Attendance', show: true },
            { id: 'leave', icon: 'calendar', label: ar ? 'الإجازات' : 'Leave', show: true },
          ].filter((x) => x.show).map((x) => (
            <button key={x.id} className="list-row" onClick={() => { setTab(x.id); setDrawerOpen(false) }}>
              <Icon name={x.icon} size={20} /><span className="bold">{x.label}</span><span className="grow" />
            </button>
          ))}
          {/* role-aware shortcuts to the live boards */}
          {can(CAP.TAKE_ORDERS) && <Link to="/cashier" className="list-row" onClick={() => setDrawerOpen(false)}><Icon name="cashier" size={20} /><span className="bold">{t('cashier')}</span><span className="grow" /><Icon name={ar ? 'back' : 'next'} size={16} className="faint" /></Link>}
          {can(CAP.KITCHEN) && <Link to="/kds" className="list-row" onClick={() => setDrawerOpen(false)}><Icon name="kitchen" size={20} /><span className="bold">{t('kitchen')}</span><span className="grow" /><Icon name={ar ? 'back' : 'next'} size={16} className="faint" /></Link>}
          {can(CAP.SCAN_TICKETS) && <Link to="/scan" className="list-row" onClick={() => setDrawerOpen(false)}><Icon name="scan" size={20} /><span className="bold">{t('scan')}</span><span className="grow" /><Icon name={ar ? 'back' : 'next'} size={16} className="faint" /></Link>}
          <button className="list-row" onClick={() => { setPf({ name, phone: me?.phone || '', cur: '', pw: '' }); setProfileOpen(true); setDrawerOpen(false) }}><Icon name="settings" size={20} /><span className="bold">{ar ? 'ملفي والإعدادات' : 'My profile & settings'}</span></button>
          <button className="list-row" onClick={logout} style={{ color: 'var(--danger)' }}><Icon name="logout" size={20} /><span className="bold">{t('logout')}</span></button>
        </div>
      </Sheet>

      {/* edit my profile: photo · name · phone · password */}
      <Sheet open={profileOpen} onClose={() => setProfileOpen(false)} title={ar ? 'ملفي' : 'My profile'}
        footer={<button className="btn btn-primary btn-lg btn-block" disabled={savingPf} onClick={saveProfile}>{savingPf ? t('saving') : t('save')}</button>}>
        <div className="stack">
          <div className="center stack" style={{ gap: 8, alignItems: 'center' }}>
            <span className="portal-avatar" style={{ width: 84, height: 84, fontSize: 32, background: 'var(--brand)', overflow: 'hidden', padding: 0 }}>{myPhoto ? <img src={myPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (name || '?').charAt(0).toUpperCase()}</span>
            <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
              <Icon name="camera" size={15} /> {photoBusy ? t('saving') : (ar ? 'تغيير الصورة' : 'Change photo')}
              <input type="file" accept="image/*" hidden disabled={photoBusy} onChange={onPhoto} />
            </label>
            <span className="xs faint" dir="ltr">{staffId}</span>
          </div>
          <div className="field"><label>{ar ? 'الاسم' : 'Name'}</label><input className="input" autoComplete="name" value={pf.name} onChange={(e) => setPf((v) => ({ ...v, name: e.target.value }))} /></div>
          <div className="field"><label>{t('phone')}</label><input className="input num" dir="ltr" inputMode="tel" autoComplete="tel" value={pf.phone} onChange={(e) => setPf((v) => ({ ...v, phone: e.target.value }))} placeholder="05xxxxxxxx" /></div>
          <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)' }}>
            <span className="small bold">{ar ? 'تغيير كلمة المرور' : 'Change password'}</span>
            <div className="field">
              <label>{ar ? 'كلمة المرور الجديدة' : 'New password'}</label>
              <input className="input" dir="ltr" type="password" autoComplete="new-password" value={pf.pw} onChange={(e) => setPf((v) => ({ ...v, pw: e.target.value }))} placeholder={ar ? '6 أحرف على الأقل (اتركه فارغاً للإبقاء)' : 'Min 6 (leave blank to keep)'} />
            </div>
            {pf.pw && (
              <div className="field animate-fade-in">
                <label>{ar ? 'كلمة المرور الحالية' : 'Current password'}</label>
                <input className="input" dir="ltr" type="password" autoComplete="current-password" value={pf.cur} onChange={(e) => setPf((v) => ({ ...v, cur: e.target.value }))} />
              </div>
            )}
          </div>
        </div>
      </Sheet>

      <Sheet open={leaveOpen} onClose={() => setLeaveOpen(false)} title={ar ? 'طلب إجازة' : 'Leave request'}
        footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={submitLeave}>{busy ? t('saving') : (ar ? 'إرسال الطلب' : 'Send request')}</button>}>
        <div className="stack">
          <div className="field">
            <label>{ar ? 'النوع' : 'Type'}</label>
            <div className="row" style={{ gap: 8 }}>
              {[['leave', ar ? 'إجازة' : 'Leave'], ['sick', ar ? 'مرضي' : 'Sick'], ['permission', ar ? 'استئذان' : 'Permission']].map(([id, lbl]) => (
                <button key={id} className={`chip ${lv.type === id ? 'active' : ''}`} onClick={() => setLv((v) => ({ ...v, type: id }))}>{lbl}</button>
              ))}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="field grow"><label>{ar ? 'من' : 'From'}</label><input className="input" type="date" value={lv.from} onChange={(e) => setLv((v) => ({ ...v, from: e.target.value }))} /></div>
            <div className="field grow"><label>{ar ? 'إلى' : 'To'}</label><input className="input" type="date" value={lv.to} onChange={(e) => setLv((v) => ({ ...v, to: e.target.value }))} /></div>
          </div>
          <div className="field"><label>{ar ? 'السبب' : 'Reason'}</label><textarea className="textarea" rows={3} value={lv.reason} onChange={(e) => setLv((v) => ({ ...v, reason: e.target.value }))} /></div>
        </div>
      </Sheet>

      {detailOrderId && <OrderDetail tid={tenantId} orderId={detailOrderId} currency={currency} staffActions onClose={() => setDetailOrderId('')} />}

      {/* request a shift swap with a coworker (peer-approved) */}
      <Sheet open={swapOpen} onClose={() => setSwapOpen(false)} title={ar ? 'تبديل وردية' : 'Swap a shift'}
        footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={submitSwap}>{busy ? t('saving') : (ar ? 'إرسال الطلب للزميل' : 'Send to coworker')}</button>}>
        <div className="stack">
          <div className="field">
            <label>{ar ? 'اليوم الذي أريد تبديله' : 'Day to swap'}</label>
            <select className="select" value={swap.date} onChange={(e) => setSwap((v) => ({ ...v, date: e.target.value }))}>
              <option value="">{ar ? 'اختر اليوم' : 'Pick a day'}</option>
              {upcomingWorkDays.map((s) => <option key={s.iso} value={s.iso}>{s.d.toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { weekday: 'long', day: 'numeric', month: 'short' })}{s.start ? ` · ${s.start}–${s.end}` : ''}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{ar ? 'الزميل الذي سيغطّي' : 'Coworker to cover'}</label>
            <select className="select" value={swap.toUid} onChange={(e) => setSwap((v) => ({ ...v, toUid: e.target.value }))}>
              <option value="">{ar ? 'اختر زميلاً' : 'Pick a coworker'}</option>
              {coworkers.map((m) => <option key={m.uid} value={m.uid}>{m.name || m.email}</option>)}
            </select>
          </div>
          <div className="field"><label>{ar ? 'سبب التبديل' : 'Reason'}</label><textarea className="textarea" rows={2} value={swap.reason} onChange={(e) => setSwap((v) => ({ ...v, reason: e.target.value }))} placeholder={ar ? 'مثال: ظرف عائلي' : 'e.g. family matter'} /></div>
          <p className="xs faint">{ar ? 'يصل الطلب للزميل ليقبل أو يرفض. عند القبول يُبدَّل اليوم تلقائياً ولا يُحتسب عليك غياب.' : 'Your coworker accepts or declines. On accept the day is swapped automatically with no absence counted.'}</p>
        </div>
      </Sheet>

      {/* decline an incoming swap (reason optional) */}
      <Sheet open={!!declineFor} onClose={() => setDeclineFor(null)} title={ar ? 'رفض التبديل' : 'Decline swap'}
        footer={<button className="btn btn-danger btn-lg btn-block" onClick={confirmDecline}>{ar ? 'تأكيد الرفض' : 'Confirm decline'}</button>}>
        <div className="stack">
          <p className="small faint">{ar ? 'يمكنك الرفض دون ذكر سبب.' : 'You can decline without a reason.'}</p>
          <div className="field"><label>{ar ? 'السبب (اختياري)' : 'Reason (optional)'}</label><textarea className="textarea" rows={2} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} /></div>
        </div>
      </Sheet>

      {/* payslip (read-only) */}
      <Sheet open={payOpen} onClose={() => setPayOpen(false)} title={ar ? 'كشف الراتب' : 'Payslip'}>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="card card-pad row-between"><span className="muted small">{ar ? 'الراتب الأساسي' : 'Base salary'}</span><span className="price bold"><Price value={salary} currency={currency} lang={lang} /></span></div>
          <div className="card card-pad stack" style={{ gap: 8 }}>
            <strong className="small">{ar ? 'الخصومات' : 'Deductions'}</strong>
            <div className="row-between xs"><span className="faint">{ar ? 'خصومات يدوية' : 'Manual deductions'}</span><span className="price" style={{ color: 'var(--danger)' }}>− <Price value={manualDed} currency={currency} lang={lang} /></span></div>
            <div className="row-between xs"><span className="faint">{ar ? `خصم تأخير (${lateCount})` : `Lateness (${lateCount})`}</span><span className="price" style={{ color: 'var(--danger)' }}>− <Price value={lateDed} currency={currency} lang={lang} /></span></div>
            {(Array.isArray(me?.deductions) ? me.deductions : []).map((d, i) => (
              <div key={i} className="row-between xs faint"><span>• {d.reason || (ar ? 'خصم' : 'Deduction')}</span><span className="price">− <Price value={d.amount} currency={currency} lang={lang} /></span></div>
            ))}
          </div>
          {otMonth.pay > 0 && (
            <div className="card card-pad row-between"><span className="muted small">{ar ? `إضافي (${otMonth.hours.toFixed(1)} ساعة)` : `Overtime (${otMonth.hours.toFixed(1)}h)`}</span><span className="price" style={{ color: 'var(--success)' }}>+ <Price value={otMonth.pay} currency={currency} lang={lang} /></span></div>
          )}
          {targetBonus > 0 && (
            <div className="card card-pad row-between" style={{ background: 'var(--success-soft)' }}><span className="small row" style={{ gap: 6 }}><Icon name="award" size={14} style={{ color: 'var(--success)' }} /> {ar ? 'مكافأة تحقيق الهدف' : 'Target bonus'}</span><span className="price" style={{ color: 'var(--success)' }}>+ <Price value={targetBonus} currency={currency} lang={lang} /></span></div>
          )}
          <div className="card card-pad row-between" style={{ background: 'var(--brand-soft)' }}><strong>{ar ? 'الصافي' : 'Net pay'}</strong><span className="price bold" style={{ fontSize: 'var(--fs-lg)', color: 'var(--brand)' }}><Price value={netSalary} currency={currency} lang={lang} /></span></div>
          <div className="card card-pad row-between"><span className="muted small">{ar ? 'رصيد الإجازات السنوي' : 'Annual leave balance'}</span><span className="bold">{leaveBalance} / {annualLeave} {ar ? 'يوم' : 'days'}</span></div>
          <p className="xs faint">{ar ? 'الأرقام تقديرية وتُحتسب آلياً من الحضور والخصومات. الكشف الرسمي من الإدارة.' : 'Figures are auto-estimated from attendance & deductions. Official statement comes from management.'}</p>
        </div>
      </Sheet>
    </div>
  )
}
