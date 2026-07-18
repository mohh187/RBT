import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n.jsx'
import { useToast } from './Toast.jsx'
import Icon from './Icon.jsx'
import { watchDinerNotices, saveDinerNotice, deleteDinerNotice } from '../lib/db.js'
import { timeAgo } from '../lib/format.js'

// Manager posts short notices that appear in the DINER's menu notification bell.
export default function DinerNoticeComposer({ tenantId }) {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const toast = useToast()
  const [notices, setNotices] = useState([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (tenantId) return watchDinerNotices(tenantId, setNotices) }, [tenantId])

  const send = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    try { await saveDinerNotice(tenantId, { title: title.trim(), body: body.trim() }); setTitle(''); setBody(''); toast.success(ar ? 'أُرسل الإشعار للعملاء' : 'Notice sent') }
    catch (_) { toast.error(ar ? 'تعذّر الإرسال' : 'Failed') } finally { setBusy(false) }
  }
  const remove = async (id) => { if (!window.confirm(ar ? 'حذف الإشعار؟' : 'Delete notice?')) return; try { await deleteDinerNotice(tenantId, id) } catch (_) { toast.error(ar ? 'تعذّر' : 'Failed') } }

  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <Icon name="bellRing" size={18} style={{ color: 'var(--brand)' }} />
        <strong>{ar ? 'إشعار للعملاء' : 'Notify customers'}</strong>
      </div>
      <p className="xs faint" style={{ margin: 0 }}>{ar ? 'يظهر فوراً في جرس الإشعارات داخل منيو العملاء.' : 'Appears instantly in the notification bell inside the customer menu.'}</p>
      <input className="input" placeholder={ar ? 'العنوان (مثال: عرض اليوم)' : 'Title (e.g. Today’s offer)'} value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input" rows={2} placeholder={ar ? 'التفاصيل (اختياري)' : 'Details (optional)'} value={body} onChange={(e) => setBody(e.target.value)} style={{ resize: 'vertical', minHeight: 48 }} />
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy || !title.trim()} onClick={send}><Icon name="bellRing" size={16} /> {ar ? 'إرسال' : 'Send'}</button>
      {notices.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {notices.map((n) => (
            <div key={n.id} className="row-between" style={{ gap: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</div>
                <div className="xs faint">{timeAgo(n.createdAt?.toMillis?.() || 0, lang)}</div>
              </div>
              <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => remove(n.id)}><Icon name="delete" size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
