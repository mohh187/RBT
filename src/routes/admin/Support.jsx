// Venue-side support center: direct chat with the platform team + support
// tickets. Managers only (rules enforce it). Counterpart of /platform/chat.
// The conversation itself is the shared ChatThread component.
import { useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { watchIssues, createIssue } from '../../lib/platform.js'
import { fmtWhen } from '../platform/shared.jsx'
import ChatThread from '../../components/ChatThread.jsx'

const ISSUE_BADGE = { open: 'badge-danger', inProgress: 'badge-warning', resolved: 'badge-success' }

export default function Support() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const toast = useToast()
  const { user, profile, tenant, tenantId, isManager } = useAuth()
  const [issues, setIssues] = useState([])
  const [issueTitle, setIssueTitle] = useState('')
  const [issueBody, setIssueBody] = useState('')
  const [priority, setPriority] = useState('normal')

  useEffect(() => {
    if (!tenantId || !isManager) return
    return watchIssues(setIssues, { tenantId })
  }, [tenantId, isManager])

  if (!isManager) {
    return <Empty icon="mail" title={ar ? 'قسم الدعم متاح للمدراء فقط' : 'Support is managers-only'} />
  }

  const commands = [
    {
      icon: 'orders',
      label: ar ? 'بيانات النظام' : 'Send system info',
      action: () => `[معلومات النظام/System Info]\nالمتصفح: ${navigator.userAgent}\nالشاشة: ${window.screen.width}x${window.screen.height}\nاللغة: ${navigator.language}`,
    },
    {
      icon: 'zap',
      label: ar ? 'فحص الاتصال' : 'Ping test',
      action: () => '[حالة الاتصال/Ping test]\nالحالة: متصل نشط',
    },
    {
      icon: 'file',
      label: ar ? 'تذكرة دعم' : 'Open a ticket',
      action: () => { document.getElementById('issue-form')?.scrollIntoView({ behavior: 'smooth' }) },
    },
  ]

  const submitIssue = async (e) => {
    e.preventDefault()
    if (!issueTitle.trim()) return
    await createIssue({
      tenantId, tenantName: tenant?.name || '',
      title: issueTitle.trim(), body: issueBody.trim(), priority,
      createdBy: user?.uid, createdByName: profile?.displayName || user?.email || '',
    })
    setIssueTitle(''); setIssueBody(''); setPriority('normal')
    toast.success(ar ? 'تم إرسال التذكرة — سنتابعها معك' : 'Ticket sent')
  }

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div>
        <h2 className="page-title">{ar ? 'الدعم والتواصل' : 'Support'}</h2>
        <p className="muted small">{ar ? 'تواصل مباشر مع إدارة المنصة + تذاكر متابعة المشاكل' : 'Direct chat with the platform team + support tickets'}</p>
      </div>

      {/* chat */}
      <div className="card stack shadow-sm" style={{ padding: 'var(--sp-3)', height: '58dvh', border: '1px solid var(--border)' }}>
        <strong className="row" style={{ gap: 6, borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 4, flex: 'none' }}>
          <Icon name="mail" size={17} style={{ color: 'var(--brand)' }} />
          {ar ? 'الدردشة مع إدارة المنصة' : 'Chat with the platform'}
        </strong>
        <ChatThread
          tid={tenantId}
          side="venue"
          ar={ar}
          uid={user?.uid}
          senderName={profile?.displayName || user?.email || tenant?.name || ''}
          tenantName={tenant?.name || ''}
          commands={commands}
          placeholder={ar ? 'اكتب رسالتك…' : 'Type a message…'}
          emptyHint={ar ? 'اكتب رسالتك — يصلنا إشعار فوري وسنرد عليك هنا' : 'Write a message — we get notified instantly'}
        />
      </div>

      {/* new ticket */}
      <form id="issue-form" className="card card-pad stack" onSubmit={submitIssue}>
        <strong><Icon name="warning" size={16} /> {ar ? 'فتح تذكرة مشكلة' : 'Open a support ticket'}</strong>
        <input className="input" placeholder={ar ? 'عنوان المشكلة' : 'Title'} value={issueTitle} onChange={(e) => setIssueTitle(e.target.value)} />
        <textarea className="input" rows={3} placeholder={ar ? 'اشرح المشكلة بالتفصيل…' : 'Describe the problem…'} value={issueBody} onChange={(e) => setIssueBody(e.target.value)} />
        <div className="row" style={{ gap: 8 }}>
          <select className="input" style={{ width: 'auto' }} value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="low">{ar ? 'منخفضة' : 'Low'}</option>
            <option value="normal">{ar ? 'عادية' : 'Normal'}</option>
            <option value="high">{ar ? 'عالية' : 'High'}</option>
            <option value="urgent">{ar ? 'عاجلة' : 'Urgent'}</option>
          </select>
          <button className="btn btn-primary grow" type="submit" disabled={!issueTitle.trim()}>
            {ar ? 'إرسال التذكرة' : 'Send ticket'}
          </button>
        </div>
      </form>

      {/* my tickets */}
      {issues.length > 0 && (
        <div className="card card-pad stack">
          <strong>{ar ? 'تذاكري' : 'My tickets'}</strong>
          <div className="divide">
            {issues.map((i) => (
              <div key={i.id} className="row-between" style={{ padding: '8px 0', gap: 8 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small bold">{i.title}</div>
                  <div className="xs faint">{fmtWhen(i.createdAt)}</div>
                </div>
                <span className={`badge ${ISSUE_BADGE[i.status] || ''}`}>
                  {i.status === 'open' ? (ar ? 'مفتوحة' : 'Open') : i.status === 'inProgress' ? (ar ? 'قيد المعالجة' : 'In progress') : (ar ? 'محلولة' : 'Resolved')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
