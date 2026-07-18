import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import Icon from '../../components/Icon.jsx'
import { Empty } from '../../components/ui.jsx'
import { timeAgo } from '../../lib/format.js'
import { watchAnnouncements, createAnnouncement, deleteAnnouncement } from '../../lib/db.js'

// Manager posts venue-wide announcements → every staffer sees them in their portal.
export default function Announcements() {
  const { t, lang } = useI18n()
  const { tenantId, profile, isManager } = useAuth()
  const toast = useToast()
  const ar = lang === 'ar'
  const [list, setList] = useState([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [schedule, setSchedule] = useState('')
  const [expiry, setExpiry] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (!tenantId) return; return watchAnnouncements(tenantId, setList) }, [tenantId])

  const post = async () => {
    if (!body.trim() && !title.trim()) { toast.error(ar ? 'اكتب نص الإعلان' : 'Write the message'); return }
    setBusy(true)
    try {
      await createAnnouncement(tenantId, {
        title: title.trim(), body: body.trim(), authorName: profile?.displayName || profile?.email || '',
        publishAt: schedule ? new Date(schedule).getTime() : Date.now(),
        expiresAt: expiry ? new Date(expiry).getTime() : null,
      })
      setTitle(''); setBody(''); setSchedule(''); setExpiry('')
      toast.success(schedule ? (ar ? 'تمت الجدولة' : 'Scheduled') : (ar ? 'تم النشر' : 'Posted'))
    } catch (_) { toast.error(t('error')) } finally { setBusy(false) }
  }

  const statusOf = (a) => {
    const now = Date.now()
    if ((a.publishAt || 0) > now) return { key: 'scheduled', label: ar ? `مجدول ${new Date(a.publishAt).toLocaleString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}` : `Scheduled ${new Date(a.publishAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}`, cls: 'badge-gold' }
    if (a.expiresAt && a.expiresAt <= now) return { key: 'expired', label: ar ? 'منتهٍ' : 'Expired', cls: '' }
    return { key: 'active', label: ar ? 'منشور' : 'Live', cls: 'badge-success' }
  }

  return (
    <div className="page stack">
      <h2 className="page-title">{ar ? 'إعلانات المنشأة' : 'Announcements'}</h2>

      {isManager && (
        <div className="card card-pad stack" style={{ gap: 10 }}>
          <div className="field"><label>{ar ? 'العنوان (اختياري)' : 'Title (optional)'}</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={ar ? 'مثال: اجتماع الفريق' : 'e.g. Team meeting'} /></div>
          <div className="field"><label>{ar ? 'الرسالة' : 'Message'}</label><textarea className="textarea" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={ar ? 'سيراها كل الموظفين في بوابتهم…' : 'Every staffer sees this in their portal…'} /></div>
          <div className="field"><label>{ar ? 'وقت النشر (اختياري)' : 'Publish at (optional)'}</label><input className="input" type="datetime-local" style={{ width: '100%', minWidth: 0, maxWidth: '100%' }} value={schedule} onChange={(e) => setSchedule(e.target.value)} /></div>
          <div className="field"><label>{ar ? 'ينتهي (اختياري)' : 'Expires (optional)'}</label><input className="input" type="datetime-local" style={{ width: '100%', minWidth: 0, maxWidth: '100%' }} value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
          <p className="xs faint">{ar ? 'إن تركت وقت النشر فارغاً يُنشر فوراً. عند النشر يصل الموظفين كإشعار صوتي وفي مركز الإشعارات.' : 'Leave publish time empty to post now. On publish, staff get a sound alert + a notification.'}</p>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={post}>{busy ? t('saving') : schedule ? (ar ? 'جدولة الإعلان' : 'Schedule') : (ar ? 'نشر للفريق' : 'Post to team')}</button>
        </div>
      )}

      {list.length === 0 ? (
        <Empty icon="bell" title={ar ? 'لا إعلانات' : 'No announcements'} hint={ar ? 'انشر إعلاناً ليظهر لكل الموظفين.' : 'Post one to reach every staffer.'} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {list.map((a) => (
            <div key={a.id} className="card card-pad stack" style={{ gap: 4 }}>
              <div className="row-between">
                <div className="row" style={{ gap: 8 }}>
                  {a.title ? <strong>{a.title}</strong> : <span className="muted small">{ar ? 'إعلان' : 'Announcement'}</span>}
                  {(() => { const s = statusOf(a); return <span className={`badge ${s.cls}`} style={{ fontSize: 10 }}>{s.label}</span> })()}
                </div>
                {isManager && <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => deleteAnnouncement(tenantId, a.id)}><Icon name="delete" size={16} /></button>}
              </div>
              {a.body && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>}
              <div className="xs faint">{a.authorName ? `${a.authorName} · ` : ''}{timeAgo(a.createdAt, lang)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
