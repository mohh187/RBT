import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import OrderDetail from './OrderDetail.jsx'
import NotificationSettings from './NotificationSettings.jsx'
import { useNotificationFeed } from '../lib/notifications.js'
import { getPrefs } from '../lib/notifyPrefs.js'
import { timeAgo } from '../lib/format.js'

// Unified, role-aware notification center: every venue event (orders, waiter
// calls, complaints, announcements, leave requests & decisions, ratings,
// lateness) in one live inbox with unread badge + sound alerts.
export default function StaffBell({ tenantId }) {
  const { t, lang } = useI18n()
  const { tenant } = useAuth()
  const navigate = useNavigate()
  const ar = lang === 'ar'
  const { items, unread, markAllRead } = useNotificationFeed(tenantId)
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [orderId, setOrderId] = useState('')
  const [notifOn, setNotifOn] = useState(getPrefs().enabled)

  const openInbox = () => { setOpen(true); markAllRead() }
  // Click a notification → jump precisely to its exact item/window.
  const onClickNotif = (n) => {
    if (n.orderId) { setOpen(false); setOrderId(n.orderId) }
    else if (n.url) { setOpen(false); navigate(n.url) }
  }

  return (
    <>
      <button className="icon-btn" onClick={openInbox} aria-label={t('notificationsTitle')} style={{ position: 'relative' }}>
        <Icon name={notifOn ? 'bell' : 'bellOff'} />
        {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('notificationsTitle')}
        footer={<button className="btn btn-outline btn-block" onClick={() => { setOpen(false); setSettingsOpen(true) }}><Icon name="settings" size={16} /> {t('notifSettings')}</button>}>
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {items.length === 0 && <div className="empty"><div className="emoji"><Icon name="bell" size={40} /></div><p className="muted small">{t('noNotifs')}</p></div>}

          {items.map((n) => {
            const clickable = !!(n.orderId || n.url)
            return (
              <div key={n.id} className="list-row" style={{ borderInlineStart: `3px solid ${n.color}`, alignItems: 'center', textAlign: 'start', cursor: clickable ? 'pointer' : 'default' }}
                onClick={() => onClickNotif(n)}>
                <span className="center" style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface-2)', color: n.color, flex: 'none' }}><Icon name={n.icon} size={18} /></span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title}</div>
                  {n.body && <div className="xs faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>}
                  <div className="xs faint">{timeAgo(n.at, lang)}</div>
                </div>
                {n.resolve
                  ? <button className="btn btn-sm btn-success" onClick={(e) => { e.stopPropagation(); n.resolve() }}><Icon name="check" size={15} /></button>
                  : clickable ? <Icon name={ar ? 'back' : 'next'} size={16} className="faint" /> : null}
              </div>
            )
          })}
        </div>
      </Sheet>

      {orderId && <OrderDetail tid={tenantId} orderId={orderId} currency={tenant?.currency || 'SAR'} onClose={() => setOrderId('')} />}

      <NotificationSettings open={settingsOpen} onClose={() => { setSettingsOpen(false); setNotifOn(getPrefs().enabled) }} />
    </>
  )
}
