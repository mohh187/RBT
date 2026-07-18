import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { watchReservations, setReservationStatus } from '../../lib/db.js'
import { timeAgo, orderNumber } from '../../lib/format.js'

function fmtDate(ts, lang) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  if (!d) return ''
  return d.toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

const STATUS_BADGE = { requested: '', confirmed: 'badge-success', declined: 'badge-danger', done: 'badge-info', cancelled: 'badge-danger' }

export default function Reservations() {
  const { t, lang } = useI18n()
  const { tenantId } = useAuth()
  const toast = useToast()
  const [list, setList] = useState(null)
  const [filter, setFilter] = useState('requested')

  useEffect(() => {
    if (!tenantId) return
    // occasion reservations only — table bookings live in the Tables floor map
    return watchReservations(tenantId, (all) => setList(all.filter((r) => r.kind !== 'table')))
  }, [tenantId])

  const occasionLabel = (o) => ({ birthday: t('birthday'), gathering: t('gathering'), meeting: t('meeting'), other: t('otherOccasion') }[o] || o)
  const statusLabel = (s) => ({ requested: t('requested'), confirmed: t('confirmed'), declined: t('declined'), done: t('checkedIn'), cancelled: t('statusCancelled') }[s] || s)

  const shown = useMemo(() => {
    if (!list) return []
    if (filter === 'all') return list
    return list.filter((r) => r.status === filter)
  }, [list, filter])

  const act = async (r, status) => {
    await setReservationStatus(tenantId, r.id, status)
    toast.success(t('saved'))
  }

  if (list === null) return <Spinner />

  const counts = {
    requested: list.filter((r) => r.status === 'requested').length,
    confirmed: list.filter((r) => r.status === 'confirmed').length,
  }

  return (
    <div className="page stack">
      <h2 className="page-title">{t('reservations')}</h2>

      <div className="scroll-x">
        {['requested', 'confirmed', 'all'].map((f) => (
          <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? t('all') : statusLabel(f)}{counts[f] ? ` (${counts[f]})` : ''}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty icon="reservations" title={t('noReservations')} hint={lang === 'ar' ? 'تصل طلبات الحجز من العملاء هنا' : 'Customer booking requests arrive here'} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {shown.map((r) => (
            <div key={r.id} className="card card-pad stack" style={{ gap: 8 }}>
              <div className="row-between">
                <strong className="row" style={{ gap: 6 }}><Icon name="cake" size={18} /> {occasionLabel(r.occasion)} <span className="faint small">{orderNumber(r.code)}</span></strong>
                <span className={`badge ${STATUS_BADGE[r.status] || ''}`}>{statusLabel(r.status)}</span>
              </div>
              <div className="small"><Icon name="calendar" size={14} className="faint" /> {fmtDate(r.dateTime, lang)} · {r.partySize} {lang === 'ar' ? 'أشخاص' : 'guests'}</div>
              <div className="small"><Icon name="user" size={14} className="faint" /> {r.name || '—'} {r.phone ? <span className="faint" dir="ltr">· {r.phone}</span> : ''}</div>
              {r.notes && <div className="xs muted"><Icon name="notepad" size={12} style={{ verticalAlign: 'middle', marginInlineEnd: 4 }} /> {r.notes}</div>}
              <div className="xs faint">{timeAgo(r.createdAt, lang)}</div>
              {r.status === 'requested' && (
                <div className="row" style={{ gap: 'var(--sp-2)' }}>
                  <button className="btn btn-sm btn-success grow" onClick={() => act(r, 'confirmed')}><Icon name="ok" size={16} /> {t('confirm')}</button>
                  <button className="btn btn-sm btn-outline grow" onClick={() => act(r, 'declined')} style={{ color: 'var(--danger)' }}><Icon name="no" size={16} /> {t('decline')}</button>
                </div>
              )}
              {r.status === 'confirmed' && (
                <button className="btn btn-sm btn-outline" onClick={() => act(r, 'done')}><Icon name="check" size={16} /> {t('checkedIn')}</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
