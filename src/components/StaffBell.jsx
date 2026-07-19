import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'
import NotificationSettings from './NotificationSettings.jsx'
import { useNotificationFeed } from '../lib/notifications.js'
import { buildNotifyFeed, getLastSeen, markSeen } from '../lib/notifyFeed.js'
import { db } from '../lib/firebase.js'
import { getPrefs } from '../lib/notifyPrefs.js'
import { alertParty } from '../lib/notify.js'
import { timeAgo } from '../lib/format.js'

// Notification center v2: one dropdown inbox merging the precise-deep-link feed
// (orders / calls / complaints / reservations / new registered customers, via
// notifyFeed.js) with the role-aware HR/venue feed (announcements, leaves,
// ratings, shifts, swaps, lateness — via notifications.js). Every row navigates
// to the EXACT object; OS notifications carry the same url.
const V2_META = {
  order: { icon: 'orders', color: 'var(--brand)' },
  complaint: { icon: 'complaint', color: 'var(--danger)' },
  reservation: { icon: 'reservations', color: 'var(--gold)' },
  customer: { icon: 'customers', color: 'var(--success)' },
  call: { icon: 'waiter', color: 'var(--brand)' },
}
// Kinds the v2 feed replaces inside the legacy feed (calls stay legacy: they
// carry an inline resolve button and already fire their own precise alert).
const LEGACY_DROP = new Set(['order', 'complaint'])
// v2 kinds StaffBell itself alerts for (calls/complaints already alert from the
// legacy hook — don't double up).
const V2_ALERT = new Set(['order', 'customer', 'reservation'])

export default function StaffBell({ tenantId }) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const ar = lang === 'ar'
  const { items: legacyItems, markAllRead } = useNotificationFeed(tenantId)
  const [v2Items, setV2Items] = useState([])
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notifOn, setNotifOn] = useState(getPrefs().enabled)
  const [lastSeen, setLastSeen] = useState(() => getLastSeen(tenantId))
  const [tick, setTick] = useState(0)

  useEffect(() => { setLastSeen(getLastSeen(tenantId)) }, [tenantId])

  // v2 precise feed (own onSnapshot listeners; error-guarded inside)
  useEffect(() => {
    if (!tenantId) return
    return buildNotifyFeed(db, tenantId, setV2Items)
  }, [tenantId])

  // OS/sound alerts for brand-new v2 items (dedupe by id, skip the initial
  // snapshot) — same url as the row so a notification click lands on the object.
  const known = useRef(new Set())
  const primed = useRef(false)
  const mountedAt = useRef(Date.now())
  useEffect(() => {
    const fresh = v2Items.filter((i) => !known.current.has(i.id))
    fresh.forEach((i) => known.current.add(i.id))
    if (primed.current) {
      const alertable = fresh.filter((i) => i.at >= mountedAt.current && V2_ALERT.has(i.type))
      if (alertable.length) {
        const top = alertable.sort((a, b) => b.at - a.at)[0]
        alertParty({ title: top.title, body: top.body, tag: top.type, url: top.to })
      }
    }
    primed.current = true
  }, [v2Items])

  // merged feed: v2 (minus calls) + legacy (minus kinds v2 now owns), normalized
  const feed = useMemo(() => {
    const v2 = v2Items.filter((i) => i.type !== 'call').map((i) => ({
      ...i, icon: V2_META[i.type]?.icon || 'bell', color: V2_META[i.type]?.color || 'var(--brand)',
    }))
    const legacy = (legacyItems || [])
      .filter((n) => !LEGACY_DROP.has(n.kind))
      .map((n) => ({ id: n.id, type: n.kind, at: n.at, title: n.title, body: n.body, to: n.url || '', icon: n.icon, color: n.color, resolve: n.resolve }))
    return v2.concat(legacy).sort((a, b) => b.at - a.at).slice(0, 80)
  }, [v2Items, legacyItems])

  const unread = feed.filter((i) => i.at > lastSeen).length

  // recency groups: «الآن» (< 10 min) / «اليوم» / «أقدم»
  const groups = useMemo(() => {
    const now = Date.now()
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
    const g = [
      { key: 'now', label: ar ? 'الآن' : 'Now', items: [] },
      { key: 'today', label: ar ? 'اليوم' : 'Today', items: [] },
      { key: 'older', label: ar ? 'أقدم' : 'Older', items: [] },
    ]
    feed.forEach((i) => {
      if (now - i.at < 10 * 60000) g[0].items.push(i)
      else if (i.at >= midnight.getTime()) g[1].items.push(i)
      else g[2].items.push(i)
    })
    return g.filter((x) => x.items.length)
  }, [feed, ar])

  // keep relative times fresh while the panel is open
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setTick((x) => x + 1), 30000)
    return () => clearInterval(id)
  }, [open])
  // close on Escape / click-outside (no scrim: .app-bar's backdrop-filter would
  // turn a position:fixed scrim into an app-bar-sized one)
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown) }
  }, [open])

  const markAll = () => {
    const now = Date.now()
    markSeen(tenantId, now)
    setLastSeen(now)
    markAllRead() // keep the legacy per-user marker in sync
  }
  const onRow = (n) => {
    if (!n.to) return
    setOpen(false)
    navigate(n.to)
  }

  return (
    <div className="nfy-wrap" ref={wrapRef}>
      <button className="icon-btn" onClick={() => setOpen((v) => !v)} aria-label={t('notificationsTitle')} style={{ position: 'relative' }}>
        <Icon name={notifOn ? 'bell' : 'bellOff'} />
        {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
          <div className="nfy-panel" role="dialog" aria-label={t('notificationsTitle')}>
            <div className="nfy-head">
              <strong className="small">{t('notificationsTitle')}</strong>
              <div className="row" style={{ gap: 4, alignItems: 'center' }}>
                {unread > 0 && (
                  <button className="nfy-mark" onClick={markAll}>
                    <Icon name="check" size={13} /> {ar ? 'تحديد الكل كمقروء' : 'Mark all read'}
                  </button>
                )}
                <button className="icon-btn" onClick={() => { setOpen(false); setSettingsOpen(true) }} title={t('notifSettings')}><Icon name="settings" size={16} /></button>
              </div>
            </div>

            <div className="nfy-list">
              {feed.length === 0 && (
                <div className="empty" style={{ padding: 'var(--sp-4)' }}>
                  <div className="emoji"><Icon name="bell" size={36} /></div>
                  <p className="muted small">{t('noNotifs')}</p>
                </div>
              )}
              {groups.map((g) => (
                <div key={g.key}>
                  <div className="nfy-group-label">{g.label}</div>
                  {g.items.map((n) => (
                    <div key={n.id} className={`nfy-row ${n.at > lastSeen ? 'is-unread' : ''}`}
                      style={{ cursor: n.to ? 'pointer' : 'default' }} onClick={() => onRow(n)}>
                      <span className="nfy-ico" style={{ color: n.color }}><Icon name={n.icon} size={17} /></span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="small bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</div>
                        {n.body && <div className="xs faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>}
                        <div className="xs faint num">{timeAgo(n.at, lang)}</div>
                      </div>
                      {n.resolve
                        ? <button className="btn btn-sm btn-success" style={{ flex: 'none' }} onClick={(e) => { e.stopPropagation(); n.resolve() }}><Icon name="check" size={15} /></button>
                        : n.to ? <Icon name={ar ? 'back' : 'next'} size={15} className="faint" style={{ flex: 'none' }} /> : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
      )}

      <NotificationSettings open={settingsOpen} onClose={() => { setSettingsOpen(false); setNotifOn(getPrefs().enabled) }} />
    </div>
  )
}
