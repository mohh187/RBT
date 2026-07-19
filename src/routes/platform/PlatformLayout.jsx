// Platform console shell — OUR standalone cross-venue command center.
// Mirrors the AdminLayout chrome (same CSS classes) but with its own nav,
// a live unread-chat badge, and instant alerts for high-severity events.
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import Icon from '../../components/Icon.jsx'
import { watchChatThreads, watchActivity, registerPlatformPush } from '../../lib/platform.js'
import { alertParty, requestNotifyPermission, notifyState } from '../../lib/notify.js'
import PlatformSearch from '../../components/PlatformSearch.jsx'

// Grouped navigation (24 screens). Sidebar shows all with faint section headers;
// the mobile bottom-nav shows the 5 essentials. Ctrl/Cmd+K opens the search.
const NAV_GROUPS = [
  { title: 'نظرة عامة', items: [
    { to: '/platform', exact: true, icon: 'home', label: 'الرئيسية' },
    { to: '/platform/realtime', icon: 'zap', label: 'البث المباشر' },
    { to: '/platform/analytics', icon: 'trending', label: 'التحليلات' },
    { to: '/platform/insights', icon: 'chartBar', label: 'الرؤى' },
  ] },
  { title: 'المنشآت', items: [
    { to: '/platform/venues', icon: 'store', label: 'المنشآت' },
    { to: '/platform/segments', icon: 'customers', label: 'الشرائح' },
    { to: '/platform/domains', icon: 'pin', label: 'النطاقات' },
    { to: '/platform/activity', icon: 'bellRing', label: 'الأنشطة' },
  ] },
  { title: 'الإيرادات', items: [
    { to: '/platform/subscriptions', icon: 'wallet', label: 'الاشتراكات' },
    { to: '/platform/billing', icon: 'receipt', label: 'الفواتير' },
    { to: '/platform/plans', icon: 'layers', label: 'محرر الخطط' },
    { to: '/platform/growth', icon: 'award', label: 'النمو' },
  ] },
  { title: 'التواصل والدعم', items: [
    { to: '/platform/chat', icon: 'mail', label: 'المحادثات', badge: 'chat' },
    { to: '/platform/issues', icon: 'warning', label: 'التذاكر' },
    { to: '/platform/broadcast', icon: 'sound', label: 'التعميمات' },
    { to: '/platform/support', icon: 'wrench', label: 'أدوات الدعم' },
  ] },
  { title: 'النظام', items: [
    { to: '/platform/assistant', icon: 'sparkles', label: 'المساعد الذكي' },
    { to: '/platform/audit', icon: 'notepad', label: 'المراقبة' },
    { to: '/platform/roles', icon: 'key', label: 'الأدوار' },
    { to: '/platform/settings', icon: 'settings', label: 'الإعدادات' },
    { to: '/platform/compliance', icon: 'scale', label: 'الامتثال' },
    { to: '/platform/legal', icon: 'file', label: 'المحرر القانوني' },
    { to: '/platform/design-tools', icon: 'penLine', label: 'أدوات التصميم' },
    { to: '/platform/design', icon: 'image', label: 'التصميم' },
    { to: '/platform/landing', icon: 'palette', label: 'واجهة الموقع' },
  ] },
]
const PRIMARY = [
  { to: '/platform', exact: true, icon: 'home', label: 'الرئيسية' },
  { to: '/platform/venues', icon: 'store', label: 'المنشآت' },
  { to: '/platform/chat', icon: 'mail', label: 'الدردشة', badge: 'chat' },
  { to: '/platform/issues', icon: 'warning', label: 'المشاكل' },
  { to: '/platform/realtime', icon: 'zap', label: 'مباشر' },
]

function UnreadDot({ count }) {
  if (!count) return null
  return (
    <span className="num" style={{
      background: 'var(--danger)', color: 'var(--on-brand)', borderRadius: 99, fontSize: 10,
      minWidth: 17, height: 17, display: 'inline-grid', placeItems: 'center', padding: '0 4px', fontWeight: 800,
    }}>{count > 99 ? '99+' : count}</span>
  )
}

export default function PlatformLayout() {
  // Prefetch platform sub-routes in background when browser is idle
  useEffect(() => {
    const prefetchPlatformRoutes = () => {
      const routes = [
        () => import('./Overview.jsx'),
        () => import('./Venues.jsx'),
        () => import('./VenueDetail.jsx'),
        () => import('./Chat.jsx'),
        () => import('./Issues.jsx'),
        () => import('./Subscriptions.jsx'),
        () => import('./Activity.jsx'),
        () => import('./Analytics.jsx'),
        () => import('./Broadcast.jsx'),
        () => import('./Design.jsx'),
        () => import('./Realtime.jsx'),
        () => import('./Insights.jsx'),
        () => import('./Audit.jsx'),
        () => import('./Roles.jsx'),
        () => import('./SupportTools.jsx'),
        () => import('./Billing.jsx'),
        () => import('./PlanEditor.jsx'),
        () => import('./DesignTools.jsx'),
        () => import('./Growth.jsx'),
        () => import('./PlatformSettings.jsx'),
        () => import('./Compliance.jsx'),
        () => import('./PlatformAssistant.jsx'),
        () => import('./Segments.jsx'),
        () => import('../StatusPage.jsx'),
        () => import('../Legal.jsx'),
        () => import('./LegalEditor.jsx'),
        () => import('./Domains.jsx'),
      ]
      
      const triggerPrefetch = () => {
        routes.forEach((r) => {
          try { r() } catch (_) {}
        })
      }

      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(triggerPrefetch)
      } else {
        setTimeout(triggerPrefetch, 2000)
      }
    }
    prefetchPlatformRoutes()
  }, [])

  const { user, logout } = useAuth()
  const { toggleTheme, theme } = useI18n()
  const navigate = useNavigate()
  const [threads, setThreads] = useState([])
  const [pushOn, setPushOn] = useState(notifyState() === 'granted')
  const [searchOpen, setSearchOpen] = useState(false)
  const seededAt = useRef(Date.now())

  // Ctrl/Cmd+K anywhere in the console toggles the platform-wide search.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => watchChatThreads(setThreads), [])
  const unreadChat = useMemo(() => threads.reduce((s, t) => s + (t.unreadByPlatform || 0), 0), [threads])

  // Device push registration (silent if permission already granted).
  useEffect(() => {
    if (notifyState() === 'granted') registerPlatformPush(user?.uid).then((ok) => ok && setPushOn(true))
  }, [user])

  // In-app strong alerts: any NEW high-severity event while the console is open.
  useEffect(() => watchActivity((rows) => {
    const fresh = rows.filter((a) => a.severity === 'high' && (a.at?.toMillis?.() || 0) > seededAt.current)
    if (fresh.length) {
      seededAt.current = Math.max(seededAt.current, ...fresh.map((a) => a.at?.toMillis?.() || 0))
      const a = fresh[0]
      alertParty({ title: a.title, body: `${a.tenantName ? a.tenantName + ' · ' : ''}${a.body || ''}`, tag: 'platform', url: '/platform/activity' })
    }
  }, { max: 15 }), [])

  const enablePush = async () => {
    const ok = await requestNotifyPermission()
    if (ok && (await registerPlatformPush(user?.uid))) setPushOn(true)
  }

  const doLogout = async () => { await logout(); navigate('/login') }

  return (
    <div className="admin-shell platform-scope" style={{ '--sidebar-w': '236px' }}>
      <aside className="admin-sidebar">
        <div className="admin-brand-row">
          <Link to="/platform" className="admin-brand">
            <span className="dot" style={{ width: 30, height: 30, borderRadius: 10, background: 'var(--brand)', color: 'var(--on-brand)', display: 'grid', placeItems: 'center', flex: 'none' }}>
              <Icon name="sparkles" size={17} />
            </span>
            <strong style={{ fontSize: 'var(--fs-md)' }}>لوحة المنصّة</strong>
          </Link>
        </div>
        <nav className="admin-side-nav">
          {NAV_GROUPS.map((g) => (
            <div key={g.title} className="admin-side-group">
              <div className="admin-side-title">{g.title}</div>
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.exact} className={({ isActive }) => (isActive ? 'active' : '')}>
                  <Icon name={n.icon} size={18} /> <span>{n.label}</span>
                  {n.badge === 'chat' ? <><span className="grow" /><UnreadDot count={unreadChat} /></> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="admin-side-foot">
          {!pushOn && (
            <button className="list-row" onClick={enablePush}>
              <Icon name="bell" size={18} /> <span className="bold">تفعيل إشعارات الجهاز</span>
            </button>
          )}
          <button className="list-row" onClick={doLogout} style={{ color: 'var(--danger)' }}>
            <Icon name="logout" size={18} /> <span className="bold">خروج</span>
          </button>
          <p className="xs faint" style={{ paddingInlineStart: 4 }}>{user?.email} · مدير المنصة</p>
        </div>
      </aside>

      <div className="admin-main">
        <header className="app-bar">
          <Link to="/platform" className="row app-bar-brand" style={{ gap: 8 }}>
            <span className="dot" style={{ width: 28, height: 28, borderRadius: 9, background: 'var(--brand)', color: 'var(--on-brand)', display: 'grid', placeItems: 'center' }}>
              <Icon name="sparkles" size={16} />
            </span>
            <strong style={{ fontSize: 'var(--fs-md)' }}>لوحة المنصّة</strong>
          </Link>
          <div className="grow" />
          <button className="icon-btn" onClick={() => setSearchOpen(true)} aria-label="بحث في المنصة" title="بحث في المنصة (Ctrl+K)">
            <Icon name="search" />
          </button>
          {!pushOn && (
            <button className="icon-btn" onClick={enablePush} aria-label="notifications" title="تفعيل إشعارات الجهاز">
              <Icon name="bellOff" />
            </button>
          )}
          <button className="icon-btn" onClick={toggleTheme} aria-label="theme">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </header>

        <main className="container">
          <Outlet />
        </main>

        <nav className="bottom-nav">
          {PRIMARY.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.exact} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span style={{ position: 'relative' }}>
                <Icon name={n.icon} size={22} />
                {n.badge === 'chat' && unreadChat ? <span style={{ position: 'absolute', top: -4, insetInlineEnd: -8 }}><UnreadDot count={unreadChat} /></span> : null}
              </span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {/* platform-wide search sheet (Ctrl/Cmd+K or the topbar button) */}
      <PlatformSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
