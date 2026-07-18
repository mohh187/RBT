import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import Sheet from '../../components/Sheet.jsx'
import Icon from '../../components/Icon.jsx'
import { Empty } from '../../components/ui.jsx'
import { watchStaff, watchShiftsRange, setShift, clearShift, watchShiftSwaps } from '../../lib/db.js'
import { roleName } from '../../lib/permissions.js'

function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function weekStart(offset) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay() + offset * 7); return d }

// Manager weekly scheduler — assign a shift per staffer per day (mobile-first,
// horizontally-scrollable day chips). One shift per staffer/day.
export default function Schedule() {
  const { lang } = useI18n()
  const { tenantId } = useAuth()
  const toast = useToast()
  const ar = lang === 'ar'
  const [offset, setOffset] = useState(0)
  const [members, setMembers] = useState([])
  const [shifts, setShifts] = useState([])
  const [swaps, setSwaps] = useState([])
  const [edit, setEdit] = useState(null) // { uid, name, date }
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  const start0 = weekStart(offset)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(start0); d.setDate(d.getDate() + i); return d }), [offset]) // eslint-disable-line react-hooks/exhaustive-deps
  const fromIso = isoDate(days[0]), toIso = isoDate(days[6])

  useEffect(() => { if (!tenantId) return; return watchStaff(tenantId, setMembers) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchShiftsRange(tenantId, fromIso, toIso, setShifts) }, [tenantId, fromIso, toIso])
  useEffect(() => { if (!tenantId) return; return watchShiftSwaps(tenantId, setSwaps) }, [tenantId])

  // Swaps are peer-to-peer (the coworker accepts/declines in their portal); the
  // manager only monitors them here.
  const recentSwaps = swaps.slice(0, 8)
  const swapBadge = (s) => s === 'accepted' ? 'badge-success' : s === 'declined' ? 'badge-danger' : 'badge-gold'
  const swapLabel = (s) => ({ pending: ar ? 'بانتظار الزميل' : 'Awaiting coworker', accepted: ar ? 'تم التبديل' : 'Swapped', declined: ar ? 'مرفوض' : 'Declined' }[s] || s)

  const shiftOf = (uid, date) => shifts.find((s) => s.staffUid === uid && s.date === date)
  const todayIso = isoDate(new Date())

  const openEdit = (m, date) => { const s = shiftOf(m.uid, date); setStart(s?.start || m.shiftStart || ''); setEnd(s?.end || m.shiftEnd || ''); setEdit({ uid: m.uid, name: m.name || m.email, date }) }
  const save = async () => {
    if (!start || !end) { toast.error(ar ? 'حدّد وقت البداية والنهاية' : 'Set start & end'); return }
    try { await setShift(tenantId, { date: edit.date, staffUid: edit.uid, staffName: edit.name, start, end }); setEdit(null); toast.success(ar ? 'تم الحفظ' : 'Saved') } catch (_) { toast.error(ar ? 'خطأ' : 'Error') }
  }
  const remove = async () => { try { await clearShift(tenantId, edit.date, edit.uid); setEdit(null) } catch (_) { toast.error(ar ? 'خطأ' : 'Error') } }
  const fillWeek = async (m) => {
    if (!m.shiftStart || !m.shiftEnd) { toast.error(ar ? 'لا يوجد دوام افتراضي لهذا الموظف' : 'No default shift set'); return }
    try { await Promise.all(days.map((d) => setShift(tenantId, { date: isoDate(d), staffUid: m.uid, staffName: m.name || m.email, start: m.shiftStart, end: m.shiftEnd }))); toast.success(ar ? 'تمت التعبئة' : 'Filled') } catch (_) { toast.error(ar ? 'خطأ' : 'Error') }
  }

  const weekLabel = `${days[0].toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { day: 'numeric', month: 'short' })}`

  return (
    <div className="page stack">
      <div className="row-between">
        <h2 className="page-title">{ar ? 'جدول الورديات' : 'Schedule'}</h2>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <button className="icon-btn" onClick={() => setOffset((o) => o - 1)}><Icon name={ar ? 'next' : 'back'} size={18} /></button>
          <span className="small bold" style={{ minWidth: 96, textAlign: 'center' }}>{offset === 0 ? (ar ? 'هذا الأسبوع' : 'This week') : weekLabel}</span>
          <button className="icon-btn" onClick={() => setOffset((o) => o + 1)}><Icon name={ar ? 'back' : 'next'} size={18} /></button>
        </div>
      </div>
      {offset !== 0 && <div className="xs faint center" style={{ gap: 6 }}>{weekLabel} · <button onClick={() => setOffset(0)} style={{ color: 'var(--brand)', fontWeight: 700, background: 'none', border: 0, cursor: 'pointer', font: 'inherit' }}>{ar ? 'العودة لهذا الأسبوع' : 'Back to this week'}</button></div>}

      {/* swap activity (peer-managed; informational for the manager) */}
      {recentSwaps.length > 0 && (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <strong className="small row" style={{ gap: 6 }}><Icon name="repeat" size={15} style={{ color: 'var(--gold)' }} /> {ar ? 'تبديلات الورديات' : 'Shift swaps'}</strong>
          {recentSwaps.map((sw) => (
            <div key={sw.id} className="card card-pad stack" style={{ gap: 4 }}>
              <div className="row-between">
                <div className="small"><strong>{sw.fromName}</strong> <Icon name="arrowLeftRight" size={11} style={{ verticalAlign: 'middle', marginInline: 4 }} /> <strong>{sw.toName}</strong></div>
                <span className={`badge ${swapBadge(sw.status || 'pending')}`}>{swapLabel(sw.status || 'pending')}</span>
              </div>
              <div className="xs faint" dir="ltr">{new Date(sw.date).toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' })} · {sw.fromStart}–{sw.fromEnd}</div>
              {sw.reason && <div className="xs faint">{ar ? 'السبب' : 'Reason'}: {sw.reason}</div>}
              {sw.status === 'declined' && sw.declineReason && <div className="xs" style={{ color: 'var(--danger)' }}>{ar ? 'سبب الرفض' : 'Decline'}: {sw.declineReason}</div>}
            </div>
          ))}
        </div>
      )}

      {members.length === 0 ? (
        <Empty icon="staff" title={ar ? 'لا موظفون' : 'No staff'} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {members.map((m) => (
            <div key={m.uid} className="card card-pad stack" style={{ gap: 8 }}>
              <div className="row-between">
                <div className="row" style={{ gap: 8 }}>
                  <span className="center" style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', fontWeight: 800, fontSize: 13, flex: 'none', overflow: 'hidden' }}>{m.photoUrl ? <img src={m.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (m.name || '?').charAt(0).toUpperCase()}</span>
                  <div><div className="small bold">{m.name || m.email}</div><div className="xs faint">{roleName(m.role, lang)}</div></div>
                </div>
                <button className="btn btn-sm btn-outline" onClick={() => fillWeek(m)} title={ar ? 'تعبئة الأسبوع بالدوام الافتراضي' : 'Fill week with default shift'}><Icon name="repeat" size={14} /></button>
              </div>
              <div className="row" style={{ gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                {days.map((d) => {
                  const iso = isoDate(d)
                  const s = shiftOf(m.uid, iso)
                  const isToday = iso === todayIso
                  return (
                    <button key={iso} onClick={() => openEdit(m, iso)} className="stack center" style={{ flex: 'none', width: 64, gap: 2, padding: '8px 4px', borderRadius: 10, border: `1px solid ${isToday ? 'var(--brand)' : 'var(--border)'}`, background: s ? 'var(--brand-soft)' : 'var(--surface)' }}>
                      <span className="xs faint">{d.toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { weekday: 'short' })}</span>
                      <span className="xs bold">{d.getDate()}</span>
                      {s ? <span className="xs bold" dir="ltr" style={{ color: 'var(--brand)', fontSize: 10 }}>{s.start}<br />{s.end}</span> : <Icon name="add" size={14} className="faint" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit ? `${edit.name} · ${edit.date}` : ''}
        footer={edit && <div className="row" style={{ gap: 8 }}><button className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={remove}>{ar ? 'مسح' : 'Clear'}</button><button className="btn btn-primary grow" onClick={save}>{ar ? 'حفظ الوردية' : 'Save shift'}</button></div>}>
        <div className="stack">
          <div className="field"><label>{ar ? 'من' : 'Start'}</label><input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="field"><label>{ar ? 'إلى' : 'End'}</label><input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
      </Sheet>
    </div>
  )
}
