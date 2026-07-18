import { useEffect, useState } from 'react'
import { useI18n } from '../../lib/i18n.jsx'
import { useAuth } from '../../lib/auth.jsx'
import { useToast } from '../../components/Toast.jsx'
import Sheet from '../../components/Sheet.jsx'
import Icon from '../../components/Icon.jsx'
import Lightbox from '../../components/Lightbox.jsx'
import { Price } from '../../components/Riyal.jsx'
import { watchMyAttendance, setStaffMeta, watchStatusLog, watchLeaves, setStaffCaps } from '../../lib/db.js'
import { uploadImage, shrinkImage } from '../../lib/storage.js'
import { roleName, roleDefaultCaps, CAP_GROUPS, CAP_LABELS } from '../../lib/permissions.js'
import { staffIdFallback } from '../../lib/format.js'
import { achievementsFor } from '../../lib/achievements.js'
import { overtimePay } from '../../lib/payroll.js'

function fmtTime(ts, lang) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  if (!d) return ''
  return d.toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })
}
const WD_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Unified per-staffer profile — organised into professional tabs.
export default function StaffProfile({ tid, row, reviews = [], target = 0, currency = 'SAR', onClose }) {
  const { t, lang } = useI18n()
  const { isManager, tenant } = useAuth()
  const toast = useToast()
  const ar = lang === 'ar'
  const [tab, setTab] = useState('overview')
  const [punches, setPunches] = useState([])
  const [statusSessions, setStatusSessions] = useState([])
  const [leaves, setLeaves] = useState([])
  const [editPay, setEditPay] = useState(false)
  const [editSched, setEditSched] = useState(false)
  const [salary, setSalary] = useState(row?.salary ?? '')
  const [hireDate, setHireDate] = useState(row?.hireDate || '')
  const [shiftStart, setShiftStart] = useState(row?.shiftStart || '')
  const [shiftEnd, setShiftEnd] = useState(row?.shiftEnd || '')
  const [shiftPeriod, setShiftPeriod] = useState(row?.shiftPeriod || 'morning')
  const [workDays, setWorkDays] = useState(Array.isArray(row?.workDays) ? row.workDays : [0, 1, 2, 3, 4])
  const [staffId, setStaffId] = useState(row?.staffId || '')
  const [phone, setPhone] = useState(row?.phone || '')
  const [dedAmount, setDedAmount] = useState('')
  const [dedReason, setDedReason] = useState('')
  const [zoom, setZoom] = useState('')
  const [mRating, setMRating] = useState(Number(row?.managerRating) || 0)
  // Per-staffer capability override (manager-only). Seeds from the saved override or the role default.
  const isPrivileged = row?.role === 'owner' || row?.role === 'manager'
  const [capDraft, setCapDraft] = useState(() => new Set(Array.isArray(row?.caps) ? row.caps : roleDefaultCaps(row?.role, tenant?.roleCaps)))
  const [capOverride, setCapOverride] = useState(!!row?.capsCustom)
  const [capBusy, setCapBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoUrl, setPhotoUrl] = useState(row?.photoUrl || '')

  // Manager uploads a photo FOR the staffer (tap the avatar) — staff-photos path,
  // shrunk client-side; the staffer's portal upload stays independent.
  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file || !isManager) return
    setPhotoBusy(true)
    try {
      const small = await shrinkImage(file)
      const url = await uploadImage(tid, small, 'staff-photos')
      await setStaffMeta(tid, row.uid, { photoUrl: url })
      setPhotoUrl(url)
      toast.success(t('saved'))
    } catch (err) {
      toast.error((ar ? 'تعذّر حفظ الصورة' : 'Photo failed') + (err?.code ? ` · ${err.code}` : ''))
    } finally { setPhotoBusy(false) }
  }

  useEffect(() => { if (!tid || !row?.uid) return; return watchMyAttendance(tid, row.uid, setPunches) }, [tid, row?.uid])
  useEffect(() => { if (!tid || !row?.uid) return; return watchStatusLog(tid, (l) => setStatusSessions((l || []).filter((s) => s.staffUid === row.uid))) }, [tid, row?.uid])
  useEffect(() => { if (!tid || !row?.uid) return; return watchLeaves(tid, (l) => setLeaves((l || []).filter((x) => x.staffUid === row.uid))) }, [tid, row?.uid])

  if (!row) return null
  const deductions = Array.isArray(row.deductions) ? row.deductions : []
  const totalDed = deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0)
  const monthStart = (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime() })()
  const autoDed = punches.reduce((s, p) => s + (p.type === 'in' && (p.at?.toMillis?.() || 0) >= monthStart ? (Number(p.deduction) || 0) : 0), 0)
  const lateCount = punches.reduce((s, p) => s + (p.type === 'in' && (p.at?.toMillis?.() || 0) >= monthStart && p.lateMinutes > 0 ? 1 : 0), 0)
  const otMonth = overtimePay(punches, monthStart, tenant?.overtimePolicy)
  const netSalary = Math.max(0, (Number(row.salary) || 0) - totalDed - autoDed + otMonth.pay)
  // busy/break aggregation (this month)
  const stMonth = statusSessions.filter((s) => (s.startedAt || 0) >= monthStart)
  const sumStatus = (kind) => stMonth.filter((s) => s.status === kind).reduce((a, s) => a + (s.endedAt ? (Number(s.durationMs) || 0) : Date.now() - (s.startedAt || Date.now())), 0)
  const busyMs = sumStatus('busy'), breakMs = sumStatus('break'), breakCount = stMonth.filter((s) => s.status === 'break').length
  const fmtDur = (msv) => { const m = Math.round(msv / 60000); return m >= 60 ? `${Math.floor(m / 60)}${ar ? 'س' : 'h'} ${m % 60}${ar ? 'د' : 'm'}` : `${m}${ar ? 'د' : 'm'}` }
  // leave balance
  const yearStart = (() => { const d = new Date(); d.setMonth(0, 1); d.setHours(0, 0, 0, 0); return d })()
  const leaveDays = (l) => { if (!l.from) return 1; const a = new Date(l.from); const b = l.to ? new Date(l.to) : a; const d = Math.round((b - a) / 86400000) + 1; return d > 0 ? d : 1 }
  const annualLeave = tenant?.leavePolicy?.annualDays || 21
  const usedLeave = leaves.filter((l) => l.status === 'approved' && l.type !== 'permission' && new Date(l.from) >= yearStart).reduce((s, l) => s + leaveDays(l), 0)
  const leaveBalance = Math.max(0, annualLeave - usedLeave)

  const savePay = async () => {
    try { await setStaffMeta(tid, row.uid, { salary: Math.max(0, Number(salary) || 0), hireDate: hireDate || '', staffId: staffId.trim(), phone: phone.trim() }); setEditPay(false); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
  }
  const saveSched = async () => {
    try { await setStaffMeta(tid, row.uid, { shiftStart: shiftStart || '', shiftEnd: shiftEnd || '', shiftPeriod, workDays }); setEditSched(false); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
  }
  const toggleDay = (d) => setWorkDays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()))
  const addDeduction = async () => {
    const amt = Number(dedAmount) || 0; if (amt <= 0) return
    const next = [...deductions, { amount: amt, reason: dedReason.trim(), at: Date.now() }]
    try { await setStaffMeta(tid, row.uid, { deductions: next }); setDedAmount(''); setDedReason(''); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
  }
  const removeDeduction = async (i) => {
    const next = deductions.filter((_, idx) => idx !== i)
    try { await setStaffMeta(tid, row.uid, { deductions: next }) } catch (_) { toast.error(t('error')) }
  }

  const roleLabel = roleName(row.role, lang)
  const clockedIn = punches?.[0]?.type === 'in'
  const comments = reviews.filter((r) => r.comment)
  const earnedBadges = achievementsFor(row, { rank: row.rank, lateCount, hasPunches: punches.length > 0, ar }).filter((a) => a.earned)
  // 360° evaluation: target (40%) + customer rating (25%) + attendance (20%) + manager rating (15%).
  const attendanceScore = Math.max(0, 1 - lateCount * 0.1)
  const evalScore = Math.round(
    Math.min(1, row.progress || 0) * 40 +
    (row.ratingN ? row.avgRating / 5 : 0.6) * 25 +
    attendanceScore * 20 +
    (mRating ? mRating / 5 : 0.6) * 15,
  )
  const evalColor = evalScore >= 80 ? 'var(--success)' : evalScore >= 55 ? 'var(--gold)' : 'var(--danger)'
  const saveManagerRating = async (n) => { setMRating(n); try { await setStaffMeta(tid, row.uid, { managerRating: n }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } }
  const toggleCap = (cap) => setCapDraft((s) => { const n = new Set(s); if (n.has(cap)) n.delete(cap); else n.add(cap); return n })
  const saveCaps = async () => {
    setCapBusy(true)
    try { await setStaffCaps(tid, row.uid, [...capDraft], true); setCapOverride(true); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } finally { setCapBusy(false) }
  }
  const resetCaps = async () => {
    // Reset writes the ROLE-DEFAULT array back (never deletes) — Firestore rules
    // read granular caps only from this mirror, so it must always exist.
    setCapBusy(true)
    const def = roleDefaultCaps(row?.role, tenant?.roleCaps)
    try { await setStaffCaps(tid, row.uid, def, false); setCapDraft(new Set(def)); setCapOverride(false); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } finally { setCapBusy(false) }
  }
  const workDaysLabel = (Array.isArray(row.workDays) ? row.workDays : [0, 1, 2, 3, 4]).map((d) => (ar ? WD_AR[d] : WD_EN[d])).join('، ')

  const TABS = [
    { id: 'overview', icon: 'home', label: ar ? 'نظرة عامة' : 'Overview' },
    { id: 'performance', icon: 'award', label: ar ? 'الأداء' : 'Performance' },
    ...(isManager ? [{ id: 'payroll', icon: 'wallet', label: ar ? 'الرواتب' : 'Payroll' }] : []),
    { id: 'attendance', icon: 'clock', label: ar ? 'الدوام' : 'Attendance' },
    { id: 'leave', icon: 'calendar', label: ar ? 'الإجازات' : 'Leave' },
    ...(isManager ? [{ id: 'permissions', icon: 'lock', label: ar ? 'الصلاحيات' : 'Permissions' }] : []),
  ]

  return (
    <Sheet open onClose={onClose} title={row.name || row.email} tall>
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        {/* header (always visible) */}
        <div className="row" style={{ gap: 12 }}>
          <label className="center" title={isManager ? (ar ? 'اضغط لرفع صورة' : 'Tap to upload a photo') : undefined} style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', fontWeight: 900, fontSize: 22, flex: 'none', overflow: 'hidden', cursor: isManager ? 'pointer' : 'default', position: 'relative' }}>
            {(photoUrl || row.photoUrl) ? <img src={photoUrl || row.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: photoBusy ? 0.4 : 1 }} /> : (row.name || '?').charAt(0).toUpperCase()}
            {isManager && <input type="file" accept="image/*" onChange={onPickPhoto} disabled={photoBusy} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />}
            {isManager && !photoBusy && <span className="center" style={{ position: 'absolute', insetInlineEnd: -2, bottom: -2, width: 20, height: 20, borderRadius: '50%', background: 'var(--brand)', color: 'var(--on-brand, #fff)' }}><Icon name="camera" size={11} /></span>}
          </label>
          <div className="grow">
            <div className="bold" style={{ fontSize: 'var(--fs-md)' }}>{row.name}</div>
            <div className="xs faint">{roleLabel} · <span style={{ color: row.level?.color, fontWeight: 800 }}>{ar ? row.level?.ar : row.level?.en}</span></div>
            <div className="xs faint" dir="ltr">{row.staffId || staffIdFallback(tenant, row.uid)}{row.phone ? ` · ${row.phone}` : ''}</div>
            <div className="xs" style={{ marginTop: 3 }}>
              <span className="row" style={{ gap: 5, display: 'inline-flex' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: row.status === 'busy' ? 'var(--danger)' : row.status === 'break' ? 'var(--gold)' : 'var(--success)' }} />
                <span className="faint">{row.status === 'busy' ? (ar ? 'مشغول' : 'Busy') : row.status === 'break' ? (ar ? 'استراحة' : 'On break') : (ar ? 'متاح' : 'Available')}</span>
                <span className="faint"> · {clockedIn ? (ar ? 'في الدوام' : 'Clocked in') : (ar ? 'خارج الدوام' : 'Clocked out')}</span>
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="bold" style={{ color: 'var(--brand)', fontSize: 'var(--fs-lg)' }}>{row.points}</div>
            <div className="xs faint">{ar ? 'نقطة' : 'pts'}</div>
          </div>
        </div>

        {/* tab bar */}
        <div className="row" style={{ gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {TABS.map((tb) => (
            <button key={tb.id} className={`chip ${tab === tb.id ? 'active' : ''}`} style={{ flex: 'none' }} onClick={() => setTab(tb.id)}><Icon name={tb.icon} size={14} /> {tb.label}</button>
          ))}
        </div>

        {/* ---------- OVERVIEW ---------- */}
        {tab === 'overview' && (
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="badge" style={{ background: clockedIn ? 'var(--success-soft)' : 'var(--surface-2)', color: clockedIn ? 'var(--success)' : 'var(--text-muted)', padding: 10, justifyContent: 'center' }}>
              <Icon name={clockedIn ? 'ok' : 'clock'} size={14} /> {clockedIn ? (ar ? 'في الدوام الآن' : 'On shift now') : (ar ? 'خارج الدوام' : 'Off shift')}
            </div>

            {/* 360° composite evaluation */}
            <div className="card card-pad row" style={{ gap: 12, alignItems: 'center' }}>
              <div className="center" style={{ width: 60, height: 60, borderRadius: '50%', flex: 'none', background: `conic-gradient(${evalColor} ${evalScore * 3.6}deg, var(--surface-2) 0)`, position: 'relative' }}>
                <span className="center" style={{ position: 'absolute', inset: 5, borderRadius: '50%', background: 'var(--surface)', fontWeight: 900, color: evalColor }}>{evalScore}</span>
              </div>
              <div className="grow">
                <div className="small bold">{ar ? 'التقييم الشامل 360°' : '360° evaluation'}</div>
                <div className="xs faint">{ar ? 'هدف + تقييم عملاء + التزام + تقييم المدير' : 'target + rating + attendance + manager'}</div>
              </div>
            </div>
            <div className="stat-grid">
              <div className="stat"><div className="label">{ar ? 'استلم' : 'Took'}</div><div className="value num">{row.handled}</div></div>
              <div className="stat"><div className="label">{ar ? 'قدّم' : 'Served'}</div><div className="value num">{row.served}</div></div>
              <div className="stat"><div className="label">{ar ? 'عملاء' : 'Guests'}</div><div className="value num">{row.custCount}</div></div>
              <div className="stat"><div className="label">{ar ? 'الإيراد' : 'Revenue'}</div><div className="value price"><Price value={row.revenue} currency={currency} lang={lang} /></div></div>
            </div>
            {earnedBadges.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <strong className="small row" style={{ gap: 6 }}><Icon name="award" size={15} style={{ color: 'var(--gold)' }} /> {ar ? 'الشارات' : 'Badges'}</strong>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {earnedBadges.map((b) => (
                    <span key={b.id} className="badge" title={b.desc} style={{ background: 'color-mix(in srgb, ' + b.color + ' 18%, transparent)', color: b.color, fontWeight: 700 }}>
                      <Icon name={b.icon} size={13} fill={b.icon === 'star' ? 'currentColor' : 'none'} strokeWidth={1.6} /> {b.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {row.insight && (
              <div className="card card-pad row" style={{ gap: 8, background: 'var(--surface-2)' }}>
                <Icon name="sparkles" size={16} className="faint" /><span className="small">{row.insight}</span>
              </div>
            )}
            <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
              {isManager && <span className="small">{ar ? 'الراتب' : 'Salary'}: <strong><Price value={Number(row.salary) || 0} currency={currency} lang={lang} /></strong></span>}
              {row.shiftStart && <span className="small">{ar ? 'الدوام' : 'Shift'}: <strong dir="ltr">{row.shiftStart}{row.shiftEnd ? `–${row.shiftEnd}` : ''}</strong></span>}
              <span className="small">{ar ? 'أيام العمل' : 'Work days'}: <strong>{workDaysLabel}</strong></span>
            </div>
          </div>
        )}

        {/* ---------- PERFORMANCE ---------- */}
        {tab === 'performance' && (
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            {isManager && (
              <div className="card card-pad row-between">
                <span className="small">{ar ? 'تقييم المدير' : 'Manager rating'}</span>
                <div className="row" style={{ gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} className="icon-btn" style={{ width: 28, height: 28, color: n <= mRating ? 'var(--gold)' : 'var(--text-faint)' }} onClick={() => saveManagerRating(n)}>
                      <Icon name="star" size={20} fill={n <= mRating ? 'currentColor' : 'none'} strokeWidth={1.5} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {target > 0 && (
              <div className="stack" style={{ gap: 4 }}>
                <div className="xs faint row-between"><span>{ar ? 'نحو الهدف' : 'To target'} ({row.served}/{target})</span><span>{Math.round((row.served / target) * 100)}%</span></div>
                <div style={{ height: 8, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(100, (row.served / target) * 100)}%`, background: row.served >= target ? 'var(--success)' : 'var(--brand)', borderRadius: 99 }} /></div>
              </div>
            )}
            {row.ratingN > 0 && (
              <div className="row-between">
                <span className="small">{ar ? 'متوسّط تقييم العملاء' : 'Avg customer rating'}</span>
                <span className="rating" style={{ gap: 3 }}>{[1, 2, 3, 4, 5].map((n) => <Icon key={n} name="star" size={14} fill="currentColor" strokeWidth={1.5} style={{ color: n <= Math.round(row.avgRating) ? 'var(--gold)' : 'var(--text-faint)' }} />)} {row.avgRating.toFixed(1)}</span>
              </div>
            )}
            <div className="stat-grid">
              <div className="stat"><div className="label">{ar ? 'النقاط' : 'Points'}</div><div className="value num" style={{ color: 'var(--brand)' }}>{row.points}</div></div>
              <div className="stat"><div className="label">{ar ? 'المستوى' : 'Level'}</div><div className="value" style={{ color: row.level?.color, fontWeight: 800, fontSize: 'var(--fs-sm)' }}>{ar ? row.level?.ar : row.level?.en}</div></div>
            </div>
            {comments.length > 0 ? (
              <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                <strong className="small">{ar ? 'آراء العملاء' : 'Customer feedback'}</strong>
                {comments.slice(0, 8).map((r) => (
                  <div key={r.id} className="card card-pad" style={{ padding: 'var(--sp-3)' }}>
                    <div className="rating" style={{ gap: 2 }}>{[1, 2, 3, 4, 5].map((n) => <Icon key={n} name="star" size={11} fill="currentColor" strokeWidth={1.5} style={{ color: n <= (r.rating || 0) ? 'var(--gold)' : 'var(--text-faint)' }} />)}</div>
                    <p className="small" style={{ marginTop: 4 }}>{r.comment}</p>
                  </div>
                ))}
              </div>
            ) : <p className="muted small">{ar ? 'لا آراء بعد' : 'No feedback yet'}</p>}
          </div>
        )}

        {/* ---------- PAYROLL (managers) ---------- */}
        {tab === 'payroll' && isManager && (
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="card card-pad stack" style={{ gap: 10 }}>
              <div className="row-between">
                <strong className="small row" style={{ gap: 6 }}><Icon name="wallet" size={16} /> {ar ? 'بيانات التوظيف' : 'Employment'}</strong>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditPay((v) => !v)}><Icon name="edit" size={14} /> {ar ? 'تعديل' : 'Edit'}</button>
              </div>
              {editPay ? (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <div className="field" style={{ width: 120 }}><label>{ar ? 'الراتب' : 'Salary'}</label><input className="input num" type="number" value={salary} onChange={(e) => setSalary(e.target.value)} /></div>
                    <div className="field grow"><label>{ar ? 'تاريخ التعيين' : 'Hire date'}</label><input className="input" type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} /></div>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <div className="field grow"><label>{ar ? 'الرقم الوظيفي' : 'Staff ID'}</label><input className="input" dir="ltr" value={staffId} onChange={(e) => setStaffId(e.target.value)} placeholder={staffIdFallback(tenant, row.uid)} /></div>
                    <div className="field grow"><label>{t('phone')}</label><input className="input num" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xxxxxxxx" /></div>
                  </div>
                  <button className="btn btn-sm btn-primary" style={{ alignSelf: 'flex-start' }} onClick={savePay}>{t('save')}</button>
                </div>
              ) : (
                <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                  <span className="small">{ar ? 'الراتب' : 'Salary'}: <strong><Price value={Number(row.salary) || 0} currency={currency} lang={lang} /></strong></span>
                  {row.hireDate && <span className="small">{ar ? 'التعيين' : 'Since'}: <strong dir="ltr">{row.hireDate}</strong></span>}
                </div>
              )}
              <div className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <div className="row-between"><span className="small bold">{ar ? 'الخصومات' : 'Deductions'}</span><span className="small" style={{ color: 'var(--danger)' }}>−<Price value={totalDed} currency={currency} lang={lang} /></span></div>
                {deductions.map((d, i) => (
                  <div key={i} className="row-between xs">
                    <span>{d.reason || (ar ? 'خصم' : 'Deduction')}</span>
                    <span className="row" style={{ gap: 6, alignItems: 'center' }}><span style={{ color: 'var(--danger)' }}>−<Price value={d.amount} currency={currency} lang={lang} /></span><button className="icon-btn" style={{ width: 24, height: 24, color: 'var(--danger)' }} onClick={() => removeDeduction(i)}>✕</button></span>
                  </div>
                ))}
                <div className="row" style={{ gap: 6 }}>
                  <input className="input num" style={{ width: 90 }} type="number" placeholder={ar ? 'مبلغ' : 'Amount'} value={dedAmount} onChange={(e) => setDedAmount(e.target.value)} />
                  <input className="input grow" placeholder={ar ? 'السبب' : 'Reason'} value={dedReason} onChange={(e) => setDedReason(e.target.value)} />
                  <button className="btn btn-sm btn-outline" onClick={addDeduction}>+</button>
                </div>
                {autoDed > 0 && (
                  <div className="row-between xs" style={{ color: 'var(--warning)' }}>
                    <span>{ar ? `خصم التأخير التلقائي (${lateCount}×)` : `Auto lateness (${lateCount}×)`}</span>
                    <span>−<Price value={autoDed} currency={currency} lang={lang} /></span>
                  </div>
                )}
                {otMonth.pay > 0 && (
                  <div className="row-between xs" style={{ color: 'var(--success)' }}>
                    <span>{ar ? `عمل إضافي (${otMonth.hours.toFixed(1)} ساعة)` : `Overtime (${otMonth.hours.toFixed(1)}h)`}</span>
                    <span>+<Price value={otMonth.pay} currency={currency} lang={lang} /></span>
                  </div>
                )}
                <div className="row-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  <span className="small bold">{ar ? 'صافي الراتب' : 'Net salary'}</span>
                  <span className="price bold"><Price value={netSalary} currency={currency} lang={lang} /></span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---------- ATTENDANCE & SCHEDULE ---------- */}
        {tab === 'attendance' && (
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            {isManager && (
              <div className="card card-pad stack" style={{ gap: 10 }}>
                <div className="row-between">
                  <strong className="small row" style={{ gap: 6 }}><Icon name="clock" size={16} /> {ar ? 'الدوام وأيام العمل' : 'Shift & work days'}</strong>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditSched((v) => !v)}><Icon name="edit" size={14} /> {ar ? 'تعديل' : 'Edit'}</button>
                </div>
                {editSched ? (
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <div className="field grow"><label>{ar ? 'بداية الدوام' : 'Shift start'}</label><input className="input" type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} /></div>
                      <div className="field grow"><label>{ar ? 'نهاية الدوام' : 'Shift end'}</label><input className="input" type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} /></div>
                    </div>
                    <div className="field">
                      <label>{ar ? 'الفترة' : 'Period'}</label>
                      <div className="row" style={{ gap: 8 }}>
                        {[['morning', ar ? 'صباحية' : 'Morning'], ['evening', ar ? 'مسائية' : 'Evening']].map(([id, lbl]) => (
                          <button key={id} className={`chip ${shiftPeriod === id ? 'active' : ''}`} onClick={() => setShiftPeriod(id)}>{lbl}</button>
                        ))}
                      </div>
                    </div>
                    <div className="field">
                      <label>{ar ? 'أيام العمل (الباقي إجازة)' : 'Work days (rest are off)'}</label>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                          <button key={d} className={`chip ${workDays.includes(d) ? 'active' : ''}`} onClick={() => toggleDay(d)}>{ar ? WD_AR[d] : WD_EN[d]}</button>
                        ))}
                      </div>
                    </div>
                    <button className="btn btn-sm btn-primary" style={{ alignSelf: 'flex-start' }} onClick={saveSched}>{t('save')}</button>
                  </div>
                ) : (
                  <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                    {row.shiftStart && <span className="small">{ar ? 'الدوام' : 'Shift'}: <strong dir="ltr">{row.shiftStart}{row.shiftEnd ? `–${row.shiftEnd}` : ''}</strong> {row.shiftPeriod ? `(${row.shiftPeriod === 'evening' ? (ar ? 'مسائية' : 'Eve') : (ar ? 'صباحية' : 'Morn')})` : ''}</span>}
                    <span className="small">{ar ? 'أيام العمل' : 'Work days'}: <strong>{workDaysLabel}</strong></span>
                  </div>
                )}
              </div>
            )}

            {/* busy / break time this month */}
            <div className="card card-pad stack" style={{ gap: 8 }}>
              <strong className="small row" style={{ gap: 6 }}><Icon name="clock" size={15} className="faint" /> {ar ? 'الانشغال والاستراحات (هذا الشهر)' : 'Busy & breaks (this month)'}</strong>
              <div className="stat-grid">
                <div className="stat"><div className="label" style={{ color: 'var(--danger)' }}>{ar ? 'مشغول' : 'Busy'}</div><div className="value num">{fmtDur(busyMs)}</div></div>
                <div className="stat"><div className="label" style={{ color: 'var(--gold)' }}>{ar ? 'استراحة' : 'Break'}</div><div className="value num">{fmtDur(breakMs)}</div></div>
                <div className="stat"><div className="label">{ar ? 'مرات الاستراحة' : 'Breaks'}</div><div className="value num">{breakCount}</div></div>
              </div>
            </div>

            {/* recent attendance */}
            <div className="stack" style={{ gap: 'var(--sp-2)' }}>
              <strong className="small">{ar ? 'آخر الحضور' : 'Recent attendance'}</strong>
              {punches.length === 0 ? <p className="muted small">—</p> : punches.slice(0, 10).map((p) => (
                <div key={p.id} className="list-row" style={{ alignItems: 'center' }}>
                  {p.selfieUrl ? <img src={p.selfieUrl} alt="" onClick={() => setZoom(p.selfieUrl)} style={{ width: 34, height: 34, borderRadius: 9, objectFit: 'cover', flex: 'none', cursor: 'zoom-in' }} /> : <span className="center" style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--surface-2)', flex: 'none' }}><Icon name="user" size={15} /></span>}
                  <div className="grow">
                    <span className="small bold" style={{ color: p.type === 'in' ? 'var(--success)' : 'var(--text-muted)' }}>{p.type === 'in' ? (ar ? 'حضور' : 'In') : (ar ? 'انصراف' : 'Out')}</span> <span className="xs faint">{fmtTime(p.at, lang)}</span>
                    {p.type === 'in' && p.lateMinutes > 0 && <span className="xs" style={{ color: 'var(--warning)' }}> · {ar ? `تأخّر ${p.lateMinutes}د` : `late ${p.lateMinutes}m`}</span>}
                  </div>
                  {p.withinGeofence === true && <Icon name="pin" size={13} style={{ color: 'var(--success)' }} />}
                  {p.withinGeofence === false && <Icon name="pin" size={13} style={{ color: 'var(--danger)' }} />}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---------- LEAVE ---------- */}
        {tab === 'leave' && (
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="card card-pad row-between"><span className="small">{ar ? 'رصيد الإجازات' : 'Leave balance'}</span><strong>{leaveBalance} / {annualLeave} {ar ? 'يوم' : 'days'}</strong></div>
            {leaves.length === 0 ? <p className="muted small">{ar ? 'لا طلبات إجازة' : 'No leave requests'}</p> : leaves.map((l) => (
              <div key={l.id} className="card card-pad stack" style={{ gap: 4 }}>
                <div className="row-between">
                  <strong className="small">{({ leave: ar ? 'إجازة' : 'Leave', sick: ar ? 'مرضي' : 'Sick', permission: ar ? 'استئذان' : 'Permission' }[l.type]) || l.type} · <span dir="ltr">{l.from}{l.to ? ` → ${l.to}` : ''}</span></strong>
                  <span className={`badge ${l.status === 'approved' ? 'badge-success' : l.status === 'declined' ? 'badge-danger' : 'badge-gold'}`}>{({ pending: ar ? 'معلّقة' : 'Pending', approved: ar ? 'مقبولة' : 'Approved', declined: ar ? 'مرفوضة' : 'Declined' }[l.status || 'pending'])}</span>
                </div>
                {l.reason && <p className="xs faint">{l.reason}</p>}
                {l.status === 'declined' && l.declineReason && <p className="xs" style={{ color: 'var(--danger)' }}>{ar ? 'سبب الرفض' : 'Reason'}: {l.declineReason}</p>}
              </div>
            ))}
          </div>
        )}

        {/* ---------- PERMISSIONS (managers) ---------- */}
        {tab === 'permissions' && isManager && (
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            {isPrivileged ? (
              <div className="card card-pad row" style={{ gap: 8, background: 'var(--surface-2)' }}>
                <Icon name="lock" size={16} className="faint" />
                <span className="small">{ar ? 'المالك والمدير يملكان كل الصلاحيات — لا يمكن تقييدهما.' : 'Owner & manager hold every permission and cannot be limited.'}</span>
              </div>
            ) : (
              <>
                <div className="card card-pad stack" style={{ gap: 6 }}>
                  <div className="row-between">
                    <strong className="small row" style={{ gap: 6 }}><Icon name="lock" size={15} /> {ar ? 'صلاحيات هذا الموظف' : "This staffer's permissions"}</strong>
                    <span className={`badge ${capOverride ? 'badge-gold' : ''}`}>{capOverride ? (ar ? 'مخصّصة' : 'Custom') : (ar ? `افتراضي: ${roleLabel}` : `Default: ${roleLabel}`)}</span>
                  </div>
                  <p className="xs faint">{ar ? 'تبدأ من صلاحيات الدور. فعّل أو عطّل أي صلاحية لهذا الشخص تحديداً، ثم احفظ. «إرجاع للدور» يزيل التخصيص.' : "Starts from the role's caps. Toggle any capability for this person, then save. Reset removes the override."}</p>
                </div>

                {CAP_GROUPS.map((g) => (
                  <div key={g.en} className="stack" style={{ gap: 2 }}>
                    <strong className="xs faint" style={{ padding: '2px 0' }}>{ar ? g.ar : g.en}</strong>
                    {g.caps.map((cap) => (
                      <label key={cap} className="row-between" style={{ cursor: 'pointer', padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                        <span className="small">{ar ? CAP_LABELS[cap].ar : CAP_LABELS[cap].en}</span>
                        <input type="checkbox" checked={capDraft.has(cap)} onChange={() => toggleCap(cap)} style={{ width: 20, height: 20, accentColor: 'var(--brand)' }} />
                      </label>
                    ))}
                  </div>
                ))}

                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-primary grow" disabled={capBusy} onClick={saveCaps}>{capBusy ? t('saving') : (ar ? `حفظ (${capDraft.size} صلاحية)` : `Save (${capDraft.size} caps)`)}</button>
                  {capOverride && <button className="btn btn-outline" disabled={capBusy} onClick={resetCaps}>{ar ? 'إرجاع للدور' : 'Reset to role'}</button>}
                </div>
                <p className="xs faint">{ar ? 'يسري التغيير عند تحديث الموظف للصفحة أو إعادة دخوله.' : 'Applies when the staffer refreshes or signs in again.'}</p>
              </>
            )}
          </div>
        )}

        <Lightbox src={zoom} onClose={() => setZoom('')} />
      </div>
    </Sheet>
  )
}
