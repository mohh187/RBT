import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Sheet from '../../components/Sheet.jsx'
import Icon from '../../components/Icon.jsx'
import { watchComplaints, setComplaintStatus } from '../../lib/db.js'
import { timeAgo } from '../../lib/format.js'

export default function Complaints() {
  const { t, lang } = useI18n()
  const { tenantId } = useAuth()
  const toast = useToast()
  const ar = lang === 'ar'
  const [list, setList] = useState(null)
  const [filter, setFilter] = useState('open')
  const [open, setOpen] = useState(null)
  const [params, setParams] = useSearchParams()

  useEffect(() => {
    if (!tenantId) return
    return watchComplaints(tenantId, setList)
  }, [tenantId])

  // Deep-link: ?focus=<id> opens that exact complaint.
  useEffect(() => {
    const focus = params.get('focus')
    if (!focus || !list) return
    const c = list.find((x) => x.id === focus)
    if (c) { setOpen(c); setFilter('all'); const p = new URLSearchParams(params); p.delete('focus'); setParams(p, { replace: true }) }
  }, [params, list]) // eslint-disable-line react-hooks/exhaustive-deps

  if (list === null) return <Spinner />

  const shown = list.filter((c) => (filter === 'all' ? true : (c.status || 'open') === filter))
  const openCount = list.filter((c) => (c.status || 'open') === 'open').length
  const cur = open ? list.find((c) => c.id === open.id) || open : null

  const resolve = async (c) => {
    const next = (c.status || 'open') === 'open' ? 'resolved' : 'open'
    try { await setComplaintStatus(tenantId, c.id, next); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
  }

  const FILTERS = [
    { id: 'open', label: lang === 'ar' ? 'جديدة' : 'New' },
    { id: 'resolved', label: lang === 'ar' ? 'معالَجة' : 'Resolved' },
    { id: 'all', label: lang === 'ar' ? 'الكل' : 'All' },
  ]

  return (
    <div className="page stack">
      <div className="row-between">
        <h2 className="page-title row" style={{ gap: 8 }}><Icon name="complaint" size={22} /> {lang === 'ar' ? 'الشكاوى' : 'Complaints'}</h2>
        {openCount > 0 && <span className="badge badge-danger">{openCount} {lang === 'ar' ? 'جديدة' : 'new'}</span>}
      </div>

      <div className="row" style={{ gap: 8 }}>
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty icon="complaint" title={lang === 'ar' ? 'لا شكاوى' : 'No complaints'} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {shown.map((c) => {
            const resolved = (c.status || 'open') === 'resolved'
            return (
              <button key={c.id} className="card card-pad stack" style={{ gap: 6, opacity: resolved ? 0.7 : 1, textAlign: 'start', cursor: 'pointer' }} onClick={() => setOpen(c)}>
                <div className="row-between">
                  <strong className="small">{c.name || (lang === 'ar' ? 'ضيف' : 'Guest')}{c.orderCode ? ` · #${c.orderCode}` : ''}</strong>
                  <span className="xs faint">{timeAgo(c.createdAt, lang)}</span>
                </div>
                <p className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{c.message}</p>
                <span className={`badge ${resolved ? 'badge-success' : 'badge-danger'}`} style={{ width: 'fit-content' }}>{resolved ? (ar ? 'معالَجة' : 'Resolved') : (ar ? 'جديدة' : 'New')}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* exact complaint window */}
      <Sheet open={!!cur} onClose={() => setOpen(null)} title={cur ? (cur.name || (ar ? 'شكوى' : 'Complaint')) : ''}
        footer={cur && <button className={`btn btn-block ${(cur.status || 'open') === 'resolved' ? 'btn-outline' : 'btn-success'}`} onClick={() => resolve(cur)}><Icon name={(cur.status || 'open') === 'resolved' ? 'repeat' : 'check'} size={16} /> {(cur.status || 'open') === 'resolved' ? (ar ? 'إعادة فتح' : 'Reopen') : (ar ? 'تمت المعالجة' : 'Resolve')}</button>}>
        {cur && (
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="row-between"><span className="muted small">{ar ? 'الحالة' : 'Status'}</span><span className={`badge ${(cur.status || 'open') === 'resolved' ? 'badge-success' : 'badge-danger'}`}>{(cur.status || 'open') === 'resolved' ? (ar ? 'معالَجة' : 'Resolved') : (ar ? 'جديدة' : 'New')}</span></div>
            {cur.orderCode && <div className="row-between"><span className="muted small">{ar ? 'الطلب' : 'Order'}</span><span dir="ltr">#{cur.orderCode}</span></div>}
            <div className="row-between"><span className="muted small">{ar ? 'الوقت' : 'Time'}</span><span>{timeAgo(cur.createdAt, lang)}</span></div>
            {cur.phone && <div className="row-between"><span className="muted small">{ar ? 'الجوال' : 'Phone'}</span><a href={`tel:${cur.phone}`} dir="ltr" style={{ color: 'var(--brand)' }}>{cur.phone}</a></div>}
            <div className="card card-pad"><p className="small">{cur.message}</p></div>
          </div>
        )}
      </Sheet>
    </div>
  )
}
