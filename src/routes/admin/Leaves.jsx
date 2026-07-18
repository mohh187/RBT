import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Sheet from '../../components/Sheet.jsx'
import Icon from '../../components/Icon.jsx'
import { watchLeaves, setLeaveStatus } from '../../lib/db.js'
import { timeAgo } from '../../lib/format.js'

export default function Leaves({ focusId, onFocusHandled }) {
  const { t, lang } = useI18n()
  const { tenantId } = useAuth()
  const toast = useToast()
  const ar = lang === 'ar'
  const [list, setList] = useState(null)
  const [filter, setFilter] = useState('pending')
  const [open, setOpen] = useState(null) // the leave being viewed
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (!tenantId) return; return watchLeaves(tenantId, setList) }, [tenantId])
  // Deep-link: open the exact request when arriving from a notification.
  useEffect(() => {
    if (!focusId || !list) return
    const lv = list.find((l) => l.id === focusId)
    if (lv) { setOpen(lv); setFilter('all'); onFocusHandled && onFocusHandled() }
  }, [focusId, list]) // eslint-disable-line react-hooks/exhaustive-deps

  if (list === null) return <Spinner />

  const shown = list.filter((l) => (filter === 'all' ? true : (l.status || 'pending') === filter))
  const pendingCount = list.filter((l) => (l.status || 'pending') === 'pending').length
  const typeLabel = (x) => ({ leave: ar ? 'إجازة' : 'Leave', sick: ar ? 'مرضي' : 'Sick', permission: ar ? 'استئذان' : 'Permission' }[x] || x)
  const cur = open ? list.find((l) => l.id === open.id) || open : null

  const approve = async () => {
    setBusy(true)
    try { await setLeaveStatus(tenantId, cur.id, 'approved'); toast.success(t('saved')); setOpen(null) } catch (_) { toast.error(t('error')) } finally { setBusy(false) }
  }
  const decline = async () => {
    setBusy(true)
    try { await setLeaveStatus(tenantId, cur.id, 'declined', reason.trim()); toast.success(t('saved')); setOpen(null); setDeclining(false); setReason('') } catch (_) { toast.error(t('error')) } finally { setBusy(false) }
  }

  const FILTERS = [
    { id: 'pending', label: ar ? 'معلّقة' : 'Pending' },
    { id: 'approved', label: ar ? 'مقبولة' : 'Approved' },
    { id: 'declined', label: ar ? 'مرفوضة' : 'Declined' },
    { id: 'all', label: ar ? 'الكل' : 'All' },
  ]
  const statusBadge = (s) => s === 'approved' ? 'badge-success' : s === 'declined' ? 'badge-danger' : 'badge-gold'
  const statusLabel = (s) => ({ pending: ar ? 'معلّقة' : 'Pending', approved: ar ? 'مقبولة' : 'Approved', declined: ar ? 'مرفوضة' : 'Declined' }[s] || s)

  return (
    <div className="page stack">
      <div className="row-between">
        <h2 className="page-title row" style={{ gap: 8 }}><Icon name="calendar" size={22} /> {ar ? 'طلبات الإجازة' : 'Leave requests'}</h2>
        {pendingCount > 0 && <span className="badge badge-gold">{pendingCount} {ar ? 'معلّقة' : 'pending'}</span>}
      </div>

      <div className="row" style={{ gap: 8 }}>
        {FILTERS.map((f) => <button key={f.id} className={`chip ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>

      {shown.length === 0 ? (
        <Empty icon="calendar" title={ar ? 'لا طلبات' : 'No requests'} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {shown.map((l) => {
            const status = l.status || 'pending'
            return (
              <button key={l.id} className="card card-pad stack" style={{ gap: 6, textAlign: 'start', cursor: 'pointer' }} onClick={() => { setOpen(l); setDeclining(false); setReason('') }}>
                <div className="row-between">
                  <strong className="small">{l.staffName || '—'} · {typeLabel(l.type)}</strong>
                  <span className="xs faint">{timeAgo(l.createdAt, lang)}</span>
                </div>
                <div className="small" dir="ltr">{l.from}{l.to ? ` → ${l.to}` : ''}</div>
                {l.reason && <p className="xs faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.reason}</p>}
                <span className={`badge ${statusBadge(status)}`} style={{ width: 'fit-content' }}>{statusLabel(status)}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* exact request window (opened directly from list or a notification) */}
      <Sheet open={!!cur} onClose={() => { setOpen(null); setDeclining(false); setReason('') }} title={cur ? `${cur.staffName || ''} · ${typeLabel(cur.type)}` : ''}
        footer={cur && (cur.status || 'pending') === 'pending' && !declining
          ? <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-outline grow" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => setDeclining(true)}><Icon name="no" size={16} /> {ar ? 'رفض' : 'Decline'}</button>
              <button className="btn btn-success grow" disabled={busy} onClick={approve}><Icon name="check" size={16} /> {ar ? 'قبول' : 'Approve'}</button>
            </div>
          : cur && declining
            ? <button className="btn btn-danger btn-block" disabled={busy} onClick={decline}>{busy ? t('saving') : (ar ? 'تأكيد الرفض' : 'Confirm decline')}</button>
            : null}>
        {cur && (
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="row-between"><span className="muted small">{ar ? 'الموظف' : 'Staff'}</span><strong>{cur.staffName || '—'}</strong></div>
            <div className="row-between"><span className="muted small">{ar ? 'النوع' : 'Type'}</span><span>{typeLabel(cur.type)}</span></div>
            <div className="row-between"><span className="muted small">{ar ? 'الفترة' : 'Dates'}</span><span dir="ltr">{cur.from}{cur.to ? ` → ${cur.to}` : ''}</span></div>
            <div className="row-between"><span className="muted small">{ar ? 'الحالة' : 'Status'}</span><span className={`badge ${statusBadge(cur.status || 'pending')}`}>{statusLabel(cur.status || 'pending')}</span></div>
            {cur.reason && <div className="stack" style={{ gap: 4 }}><span className="muted small">{ar ? 'سبب الموظف' : 'Reason'}</span><p className="small">{cur.reason}</p></div>}
            {cur.declineReason && <div className="card card-pad stack" style={{ gap: 4, background: 'var(--danger-soft)' }}><span className="xs bold" style={{ color: 'var(--danger)' }}>{ar ? 'سبب الرفض' : 'Decline reason'}</span><p className="small">{cur.declineReason}</p></div>}
            {declining && (
              <div className="field"><label>{ar ? 'سبب الرفض (يظهر للموظف)' : 'Decline reason (shown to staff)'}</label>
                <textarea className="textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ar ? 'وضّح سبب الرفض…' : 'Explain the reason…'} autoFocus /></div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}
