import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import StaffBell from './StaffBell.jsx'
import InstallButton from './InstallButton.jsx'
import { watchActiveOrders, healMemberMirrors, healStaffCapsMirrors } from '../lib/db.js'
import { CAP } from '../lib/permissions.js'
import { planAllows, planExpired, EXPIRED_GRACE_DAYS } from '../lib/plans.js'
import { alertParty } from '../lib/notify.js'
import { useCompactUI } from '../lib/useCompactUI.js'
import { systemThemeAttr, useSystemThemeBody } from '../lib/systemThemes.js'
import PinLock from './PinLock.jsx'
import AppBackground from './AppBackground.jsx'
import { requestLock } from '../lib/pin.js'
import { menuUrl } from '../lib/qr.js'
import Tour from './Tour.jsx'
import { TOURS } from '../lib/tours.js'
import GlobalSearch from './GlobalSearch.jsx'
import { getDocs, collection, doc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase.js'

// Primary sections (bottom nav / sidebar) — each is a hub with its own sub-tabs.
const navItems = [
  { to: '/admin', exact: true, icon: 'home', label: { ar: 'الرئيسية', en: 'Home' } },
  { to: '/admin/orders', icon: 'orders', label: { ar: 'الطلبات', en: 'Orders' }, cap: CAP.TAKE_ORDERS, feature: 'orders' },
  { to: '/admin/menu', icon: 'menu', label: { ar: 'المنيو', en: 'Menu' }, cap: CAP.MANAGE_MENU },
  { to: '/admin/operations', icon: 'tables', label: { ar: 'العمليات', en: 'Operations' }, cap: CAP.MANAGE_TABLES, feature: 'tables' },
  { to: '/admin/hr', icon: 'staff', label: { ar: 'الفريق', en: 'Team' }, cap: CAP.ATTENDANCE, feature: 'staff' },
]

// Secondary, grouped under the "More" sheet — organized by job-to-be-done so a
// staffer finds their world in one group (marketing / operations / analytics / system).
const moreGroups = [
  { title: { ar: 'التسويق والعملاء', en: 'Marketing & customers' }, items: [
    { to: '/admin/customers', icon: 'customers', label: { ar: 'العملاء', en: 'Customers' }, cap: CAP.VIEW_CUSTOMERS },
    { to: '/admin/campaigns', icon: 'bellRing', label: { ar: 'الإعلانات والحملات', en: 'Campaigns' }, cap: CAP.MANAGE_CAMPAIGNS },
    { to: '/admin/offers', icon: 'offers', label: { ar: 'العروض والخصومات', en: 'Offers' }, cap: CAP.MANAGE_OFFERS },
    { to: '/admin/reviews-studio', icon: 'star', label: { ar: 'استوديو التقييمات', en: 'Reviews studio' }, cap: CAP.MANAGE_CAMPAIGNS },
    { to: '/admin/posts-studio', icon: 'camera', label: { ar: 'استوديو المنشورات', en: 'Post studio' }, cap: CAP.MANAGE_CAMPAIGNS },
    { to: '/admin/stories', icon: 'camera', label: { ar: 'الاستوري', en: 'Stories' }, cap: CAP.MANAGE_STORIES },
    { to: '/admin/posts', icon: 'events', label: { ar: 'البروفايل والأخبار', en: 'Profile & news' }, cap: CAP.MANAGE_STORIES },
  ] },
  { title: { ar: 'التشغيل اليومي', en: 'Daily operations' }, items: [
    { to: '/cashier', icon: 'cashier', label: { ar: 'الكاشير', en: 'Cashier' }, cap: CAP.TAKE_ORDERS, feature: 'cashier' },
    { to: '/kds', icon: 'kitchen', label: { ar: 'المطبخ', en: 'Kitchen' }, cap: CAP.KITCHEN, feature: 'kds' },
    { to: '/scan', icon: 'scan', label: { ar: 'مسح التذاكر', en: 'Scan tickets' }, cap: CAP.SCAN_TICKETS },
    { to: '/admin/inventory', icon: 'inventory', label: { ar: 'المخزون والموردون', en: 'Inventory' }, cap: CAP.MANAGE_INVENTORY },
    { to: '/admin/complaints', icon: 'message', label: { ar: 'الشكاوى', en: 'Complaints' }, cap: CAP.VIEW_COMPLAINTS },
  ] },
  { title: { ar: 'الفعاليات والحجوزات', en: 'Events & bookings' }, items: [
    { to: '/admin/events', icon: 'events', label: { ar: 'الفعاليات والتذاكر', en: 'Events & tickets' }, cap: CAP.MANAGE_EVENTS },
    { to: '/admin/reservations', icon: 'calendar', label: { ar: 'الحجوزات', en: 'Reservations' }, cap: CAP.MANAGE_EVENTS, feature: 'reservations' },
  ] },
  { title: { ar: 'التقارير والتحليلات', en: 'Reports & analytics' }, items: [
    { to: '/admin/reports', icon: 'reports', label: { ar: 'التقارير', en: 'Reports' }, cap: CAP.VIEW_REPORTS, feature: 'reports' },
    { to: '/admin/daily', icon: 'chartBar', label: { ar: 'تقرير اليوم', en: 'Daily report' }, cap: CAP.VIEW_REPORTS, feature: 'reports' },
  ] },
  { title: { ar: 'النظام والمساعدة', en: 'System & help' }, items: [
    { to: '/admin/assistant', icon: 'sparkles', label: { ar: 'المساعد الذكي', en: 'AI assistant' }, cap: CAP.USE_ASSISTANT },
    { to: '/admin/screens', icon: 'qr', label: { ar: 'شاشات العرض', en: 'Display screens' }, cap: CAP.MANAGE_APPEARANCE },
    { to: '/admin/settings', icon: 'settings', label: { ar: 'الإعدادات', en: 'Settings' }, anyOf: [CAP.MANAGE_SETTINGS, CAP.MANAGE_APPEARANCE, CAP.MANAGE_LOYALTY, CAP.MANAGE_INTEGRATIONS] },
    { to: '/admin/help', icon: 'zap', label: { ar: 'مركز المساعدة', en: 'Help center' } },
    { to: '/admin/support', icon: 'mail', label: { ar: 'الدعم والتواصل', en: 'Support' }, cap: CAP.MANAGE_SETTINGS },
    { to: '/portal', icon: 'user', label: { ar: 'بوابتي', en: 'My portal' } },
  ] },
]

export default function AdminLayout() {
  useCompactUI()

  // Prefetch admin sub-routes in background when browser is idle
  useEffect(() => {
    const prefetchRoutes = () => {
      const routes = [
        () => import('../routes/admin/Dashboard.jsx'),
        () => import('../routes/admin/Items.jsx'),
        () => import('../routes/admin/Categories.jsx'),
        () => import('../routes/admin/Tables.jsx'),
        () => import('../routes/admin/Offers.jsx'),
        () => import('../routes/admin/Customers.jsx'),
        () => import('../routes/admin/StoriesAdmin.jsx'),
        () => import('../routes/staff/PosPreviewPage.jsx'),
        () => import('../routes/menu/VenueProfile.jsx'),
        () => import('../routes/admin/PostsAdmin.jsx'),
        () => import('../routes/admin/Inventory.jsx'),
        () => import('../routes/admin/Complaints.jsx'),
        () => import('../routes/admin/Performance.jsx'),
        () => import('../routes/admin/Attendance.jsx'),
        () => import('../routes/admin/StaffHub.jsx'),
        () => import('../routes/admin/Roles.jsx'),
        () => import('../routes/admin/Policies.jsx'),
        () => import('../routes/admin/Reports.jsx'),
        () => import('../routes/admin/DailyReport.jsx'),
        () => import('../routes/admin/Staff.jsx'),
        () => import('../routes/admin/Settings.jsx'),
        () => import('../routes/admin/Assistant.jsx'),
        () => import('../routes/admin/Events.jsx'),
        () => import('../routes/admin/Reservations.jsx'),
        () => import('../routes/admin/InsightsHub.jsx'),
        () => import('../routes/admin/MenuHub.jsx'),
        () => import('../routes/admin/OpsHub.jsx'),
        () => import('../routes/admin/Orders.jsx'),
        () => import('../routes/admin/CustomersHub.jsx'),
        () => import('../routes/admin/Support.jsx'),
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
    prefetchRoutes()
  }, [])

  const { t, toggleTheme, toggleLang, theme, lang } = useI18n()
  const { tenant, tenantId, logout, profile, can, isPlatformAdmin, isManager } = useAuth()
  // Nav is filtered by BOTH role capability and the venue's subscription plan.
  const allowed = (n) => (!n.cap || can(n.cap)) && (!n.anyOf || n.anyOf.some((c) => can(c))) && (!n.feature || planAllows(tenant, n.feature))
  useSystemThemeBody(tenant, 'admin') // portaled sheets/toasts pick the theme up from <body>
  const visibleNav = navItems.filter(allowed)
  const [moreOpen, setMoreOpen] = useState(false)
  // Global search (everything in the system): topbar button or Ctrl/Cmd+K.
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setSearchOpen((v) => !v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Collapsible + drag-resizable desktop sidebar (persisted). < 130px renders as an icon rail.
  const [sideW, setSideW] = useState(() => { const v = Number(localStorage.getItem('adminSideW')); return v >= 66 && v <= 360 ? v : 248 })
  const collapsed = sideW < 130
  const effW = collapsed ? 66 : sideW
  useEffect(() => { localStorage.setItem('adminSideW', String(sideW)) }, [sideW])
  const toggleSide = () => setSideW(collapsed ? 248 : 66)
  const startResize = (e) => {
    e.preventDefault()
    const startX = e.clientX, startW = effW
    const dir = getComputedStyle(document.documentElement).direction === 'rtl' ? -1 : 1
    const move = (ev) => setSideW(Math.max(66, Math.min(360, startW + (ev.clientX - startX) * dir)))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.userSelect = '' }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const prevPending = useRef(0)
  const seeded = useRef(false)
  const navigate = useNavigate()
  const loc = useLocation()
  // When suspended, lock every admin screen EXCEPT the support page (so managers
  // can still reach the platform to resolve the suspension).
  const suspended = tenant?.active === false
  const onSupport = loc.pathname.endsWith('/support')

  useEffect(() => {
    if (!tenantId) return
    return watchActiveOrders(tenantId, (orders) => {
      const pending = orders.filter((o) => o.status === 'pending').length
      if (seeded.current && pending > prevPending.current) {
        alertParty({ title: lang === 'ar' ? 'طلب جديد' : 'New order', body: tenant?.name || '', tag: 'order', url: '/cashier' })
      }
      prevPending.current = pending
      seeded.current = true
    })
  }, [tenantId, lang, tenant])

  // One-time self-healing DB migration to restore items/categories missing sortOrder
  useEffect(() => {
    if (!tenantId) return
    let alive = true
    const runMigration = async () => {
      try {
        // 1. Check categories
        const catSnap = await getDocs(collection(db, 'tenants', tenantId, 'categories'))
        const catsToFix = catSnap.docs.filter(d => d.data().sortOrder === undefined)
        for (const d of catsToFix) {
          if (!alive) return
          await updateDoc(doc(db, 'tenants', tenantId, 'categories', d.id), { sortOrder: 0 })
        }
        
        // 2. Check items
        const itemSnap = await getDocs(collection(db, 'tenants', tenantId, 'items'))
        const itemsToFix = itemSnap.docs.filter(d => d.data().sortOrder === undefined)
        for (const d of itemsToFix) {
          if (!alive) return
          await updateDoc(doc(db, 'tenants', tenantId, 'items', d.id), { sortOrder: 0 })
        }
      } catch (err) {
        console.warn('[migration error]', err)
      }
    }
    runMigration()
    // 3. member-card mirrors self-heal: pre-mirror members had dead /mcard QR
    // links («بطاقة غير صالحة»). Runs once per device per venue.
    const healKey = `ml.healmc.${tenantId}`
    if (!localStorage.getItem(healKey)) {
      healMemberMirrors(tenantId)
        .then((n) => { localStorage.setItem(healKey, '1'); if (n > 0) console.info(`[heal] rebuilt ${n} member card mirrors`) })
        .catch((err) => console.warn('[heal member mirrors]', err))
    }
    return () => { alive = false }
  }, [tenantId])

  // 4. staff caps mirrors: Firestore rules enforce granular permissions from
  // staff/{uid}.caps, which only managers may write. Refresh stale role-default
  // mirrors whenever a manager opens the admin (writes only when out of date).
  useEffect(() => {
    if (!tenantId || !isManager) return
    healStaffCapsMirrors(tenantId, tenant?.roleCaps)
      .then((n) => { if (n > 0) console.info(`[heal] refreshed ${n} staff caps mirrors`) })
      .catch((err) => console.warn('[heal staff caps]', err))
  }, [tenantId, isManager, tenant?.roleCaps])

  const doLogout = async () => {
    await logout()
    navigate('/login')
  }

  // First-run guided tour for the current section (shows once per device per key).
  const tourKey = loc.pathname === '/admin' ? 'dashboard'
    : loc.pathname.startsWith('/admin/menu') || loc.pathname.startsWith('/admin/items') ? 'items'
    : loc.pathname.startsWith('/admin/campaigns') ? 'campaigns'
    : loc.pathname.startsWith('/admin/settings') ? 'settings'
    : loc.pathname.startsWith('/admin/customers') ? 'customers'
    : null

  return (
    <div className="admin-shell" style={{ '--sidebar-w': `${effW}px` }} data-collapsed={collapsed ? 'true' : undefined} data-systheme={systemThemeAttr(tenant, 'admin')} data-sidebar={tenant?.sidebarStyle || undefined}>
      <AppBackground tenant={tenant} />
      <PinLock tenant={tenant} tenantId={tenantId} />
      {tourKey && TOURS[tourKey] && <Tour key={tourKey} steps={TOURS[tourKey]} storageKey={tourKey} />}
      {searchOpen && <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />}
      {/* desktop sidebar (hidden on mobile; bottom nav takes over) — collapsible + drag-resizable */}
      <aside className="admin-sidebar">
        <div className="admin-brand-row">
          <Link to="/admin" className="admin-brand">
            {tenant?.logoUrl ? (
              <img src={tenant.logoUrl} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flex: 'none' }} />
            ) : (
              <span className="dot" style={{ width: 30, height: 30, borderRadius: 10, background: 'var(--brand)', color: 'var(--on-brand)', display: 'grid', placeItems: 'center', flex: 'none' }}><Icon name="store" size={17} /></span>
            )}
            <strong style={{ fontSize: 'var(--fs-md)' }}>{tenant?.name || t('appName')}</strong>
          </Link>
          <button className="admin-side-toggle" onClick={toggleSide} aria-label="collapse sidebar"><Icon name={collapsed ? 'back' : 'next'} size={16} /></button>
        </div>
        <nav className="admin-side-nav">
          {visibleNav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.exact} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={n.icon} size={18} /> <span>{lang === 'ar' ? n.label.ar : n.label.en}</span>
            </NavLink>
          ))}
          {moreGroups.map((g) => {
            const items = g.items.filter(allowed)
            if (!items.length) return null
            return (
              <div key={g.title.en} className="admin-side-group">
                <div className="admin-side-title">{lang === 'ar' ? g.title.ar : g.title.en}</div>
                {items.map((l) => (
                  <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                    <Icon name={l.icon} size={18} /> <span>{lang === 'ar' ? l.label.ar : l.label.en}</span>
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="admin-side-foot">
          <InstallButton />
          {isPlatformAdmin && (
            <Link to="/platform" className="list-row" style={{ color: 'var(--brand)' }}>
              <Icon name="sparkles" size={18} /> <span className="bold">{lang === 'ar' ? 'لوحة المنصّة' : 'Platform console'}</span>
            </Link>
          )}
          <button className="list-row" onClick={doLogout} style={{ color: 'var(--danger)' }}>
            <Icon name="logout" size={18} /> <span className="bold">{t('logout')}</span>
          </button>
          <p className="xs faint" style={{ paddingInlineStart: 4 }}>{profile?.email} · {t(profile?.role || 'owner')}</p>
        </div>
        <div className="admin-side-resize" onPointerDown={startResize} title="" />
      </aside>

      <div className="admin-main">
      <header className="app-bar">
        <Link to="/admin" className="row app-bar-brand" style={{ gap: 8 }}>
          {tenant?.logoUrl ? (
            <img src={tenant.logoUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <span className="dot" style={{ width: 28, height: 28, borderRadius: 9, background: 'var(--brand)', color: 'var(--on-brand)', display: 'grid', placeItems: 'center' }}>
              <Icon name="store" size={16} />
            </span>
          )}
          <strong style={{ fontSize: 'var(--fs-md)' }}>{tenant?.name || t('appName')}</strong>
        </Link>
        <div className="grow" />
        <button className="icon-btn" onClick={() => setSearchOpen(true)} title={lang === 'ar' ? 'البحث الشامل (Ctrl+K)' : 'Global search (Ctrl+K)'} aria-label="global search">
          <Icon name="search" size={18} />
        </button>
        {tenant?.pinLock?.enabled && (
          <button className="icon-btn" onClick={requestLock} title={lang === 'ar' ? 'قفل الشاشة الآن' : 'Lock now'} aria-label="lock">
            <Icon name="key" size={18} />
          </button>
        )}
        {tenant?.slug && (
          <a
            className="icon-btn"
            href={menuUrl(tenant.slug)}
            target="_blank"
            rel="noreferrer"
            title={lang === 'ar' ? 'معاينة كعميل' : 'Preview as customer'}
            aria-label="preview as customer"
          >
            <Icon name="eye" size={18} />
          </a>
        )}
        <StaffBell tenantId={tenantId} />
        <button className="icon-btn" onClick={toggleLang} aria-label="language" style={{ fontWeight: 800, fontSize: 13 }}>
          {lang === 'ar' ? 'EN' : 'ع'}
        </button>
        <button className="icon-btn" onClick={toggleTheme} aria-label="theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </header>

      <main className="container">
        {suspended && !onSupport ? (
          <div className="empty" style={{ padding: 'var(--sp-8) var(--sp-4)' }}>
            <div className="emoji"><Icon name="warning" size={40} style={{ color: 'var(--danger)' }} /></div>
            <p className="bold" style={{ fontSize: 'var(--fs-md)', color: 'var(--danger)' }}>
              {lang === 'ar' ? 'الحساب موقوف مؤقتاً من إدارة المنصة' : 'Account suspended by the platform'}
            </p>
            <p className="small" style={{ marginTop: 4 }}>
              {tenant?.suspendReason || (lang === 'ar' ? 'تم إيقاف الوصول للنظام. تواصل مع الدعم لإعادة التفعيل.' : 'Access is locked. Contact support to reactivate.')}
            </p>
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <Link to="/admin/support" className="btn btn-primary"><Icon name="mail" size={16} /> {lang === 'ar' ? 'التواصل مع الدعم' : 'Contact support'}</Link>
            </div>
          </div>
        ) : (
          <>
            {suspended && (
              <div className="card card-pad" style={{ borderColor: 'var(--danger)', marginBottom: 'var(--sp-3)' }}>
                <strong style={{ color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="warning" size={14} /> {lang === 'ar' ? 'الحساب موقوف مؤقتاً من إدارة المنصة' : 'Account suspended by the platform'}</strong>
                <p className="small" style={{ marginTop: 4 }}>
                  {tenant?.suspendReason || (lang === 'ar' ? 'يرجى التواصل مع الدعم لمعرفة التفاصيل وإعادة التفعيل.' : 'Contact support for details.')}
                </p>
              </div>
            )}
            {!suspended && tenant?.planStatus === 'expired' && (
              <div className="card card-pad" style={{ borderColor: 'var(--gold)', marginBottom: 'var(--sp-3)' }}>
                <strong style={{ color: 'var(--gold)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="clock" size={14} /> {lang === 'ar' ? 'انتهى اشتراك المنشأة' : 'Subscription expired'}</strong>
                <p className="small" style={{ marginTop: 4 }}>
                  {planExpired(tenant)
                    ? (lang === 'ar' ? 'تم تقييد المزايا إلى باقة «منيو» حتى التجديد.' : 'Features are limited to the Menu plan until renewal.')
                    : (lang === 'ar' ? `المزايا مستمرة خلال مهلة ${EXPIRED_GRACE_DAYS} أيام — جدّد قبل انتهائها.` : `Full features continue during a ${EXPIRED_GRACE_DAYS}-day grace period.`)}
                  {' '}<Link to="/admin/support" className="bold">{lang === 'ar' ? 'تجديد الاشتراك ←' : 'Renew →'}</Link>
                </p>
              </div>
            )}
            <Outlet />
          </>
        )}
      </main>

      <nav className="bottom-nav">
        {visibleNav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.exact} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={n.icon} size={22} />
            <span>{lang === 'ar' ? n.label.ar : n.label.en}</span>
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: 10, color: 'var(--text-faint)' }}
        >
          <Icon name="more" size={22} />
          <span>{t('more')}</span>
        </button>
      </nav>
      </div>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t('more')}>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <InstallButton />
          {moreGroups.map((g) => {
            const items = g.items.filter(allowed)
            if (!items.length) return null
            return (
              <div key={g.title.en} className="stack" style={{ gap: 'var(--sp-2)' }}>
                <div className="xs faint bold" style={{ paddingInlineStart: 4 }}>{lang === 'ar' ? g.title.ar : g.title.en}</div>
                {items.map((l) => (
                  <Link key={l.to} to={l.to} className="list-row" onClick={() => setMoreOpen(false)}>
                    <Icon name={l.icon} size={22} />
                    <span className="bold">{lang === 'ar' ? l.label.ar : l.label.en}</span>
                    <span className="grow" />
                    <Icon name="next" size={18} className="faint" />
                  </Link>
                ))}
              </div>
            )
          })}
          <button className="list-row" onClick={doLogout} style={{ color: 'var(--danger)' }}>
            <Icon name="logout" size={22} />
            <span className="bold">{t('logout')}</span>
            <span className="grow" />
          </button>
          <p className="xs faint text-center" style={{ marginTop: 8 }}>
            {profile?.email} · {t(profile?.role || 'owner')}
          </p>
        </div>
      </Sheet>

    </div>
  )
}
