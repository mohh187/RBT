import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import BranchSwitcher from './BranchSwitcher.jsx'
import StaffBell from './StaffBell.jsx'
import InstallButton from './InstallButton.jsx'
import { watchComplaints, healMemberMirrors, healStaffCapsMirrors, healRegisteredCustomers, healImageRatios } from '../lib/db.js'
import { useActiveOrders } from '../lib/liveBoard.js'
import { migrateStaffPins } from '../lib/pin.js'
import { CAP } from '../lib/permissions.js'
import { planAllows, planExpired, EXPIRED_GRACE_DAYS } from '../lib/plans.js'
import { alertParty } from '../lib/notify.js'
import { orderNumber } from '../lib/format.js'
import { useCompactUI } from '../lib/useCompactUI.js'
import { systemThemeAttr, useSystemThemeBody } from '../lib/systemThemes.js'
import { applyStaffManifest, restorePlatformManifest } from '../lib/pwa.js'
import PinLock from './PinLock.jsx'
import IncomingAlerts from './IncomingAlerts.jsx'
import AppBackground from './AppBackground.jsx'
import { requestLock } from '../lib/pin.js'
import { menuUrl } from '../lib/qr.js'
import Tour from './Tour.jsx'
import { TOURS } from '../lib/tours.js'
import GlobalSearch from './GlobalSearch.jsx'
import AssistantQuick from './AssistantQuick.jsx'
import PageGuide from './PageGuide.jsx'
import { initScrollAffordance } from '../lib/scrollAffordance.js'
import '../styles/scrollfix.css'
import { getDocs, collection, doc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import '../styles/venue-console.css'

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
// GROUP ORDER is frequency-of-use, not alphabet: the screens a shift opens every
// hour (cashier/kitchen/inventory) come first, the morning read (reports) second,
// campaign work third — nobody should scroll past thirteen marketing studios to
// reach the kitchen. Group TITLES are load-bearing: the collapse memory
// (rbt_nav_closed) keys on title.en, so reordering must never rename a group.
const moreGroups = [
  { title: { ar: 'التشغيل اليومي', en: 'Daily operations' }, items: [
    { to: '/cashier', icon: 'cashier', label: { ar: 'الكاشير', en: 'Cashier' }, cap: CAP.TAKE_ORDERS, feature: 'cashier' },
    { to: '/kds', icon: 'kitchen', label: { ar: 'المطبخ', en: 'Kitchen' }, cap: CAP.KITCHEN, feature: 'kds' },
    { to: '/scan', icon: 'scan', label: { ar: 'مسح التذاكر', en: 'Scan tickets' }, cap: CAP.SCAN_TICKETS },
    { to: '/admin/inventory', icon: 'inventory', label: { ar: 'المخزون والموردون', en: 'Inventory' }, cap: CAP.MANAGE_INVENTORY },
    { to: '/admin/complaints', icon: 'message', label: { ar: 'الشكاوى', en: 'Complaints' }, cap: CAP.VIEW_COMPLAINTS },
  ] },
  { title: { ar: 'التقارير والتحليلات', en: 'Reports & analytics' }, items: [
    { to: '/admin/reports', icon: 'reports', label: { ar: 'التقارير', en: 'Reports' }, cap: CAP.VIEW_REPORTS, feature: 'reports' },
    { to: '/admin/daily', icon: 'chartBar', label: { ar: 'تقرير اليوم', en: 'Daily report' }, cap: CAP.VIEW_REPORTS, feature: 'reports' },
    { to: '/admin/accounting', icon: 'wallet', label: { ar: 'المحاسبة', en: 'Accounting' }, cap: CAP.VIEW_REVENUE },
    { to: '/admin/behavior', icon: 'trending', label: { ar: 'سلوك العملاء', en: 'Guest behavior' }, cap: CAP.VIEW_REPORTS },
    { to: '/admin/games-hub', icon: 'games', label: { ar: 'مركز الألعاب', en: 'Games centre' }, cap: CAP.VIEW_REPORTS },
    { to: '/admin/guest-play', icon: 'chartBar', label: { ar: 'نشاط الألعاب', en: 'Play activity' }, cap: CAP.VIEW_REPORTS },
    { to: '/admin/growth', icon: 'trending', label: { ar: 'فرص النمو', en: 'Growth' }, cap: CAP.VIEW_REPORTS },
  ] },
  { title: { ar: 'التسويق والعملاء', en: 'Marketing & customers' }, items: [
    { to: '/admin/customers', icon: 'customers', label: { ar: 'العملاء', en: 'Customers' }, cap: CAP.VIEW_CUSTOMERS },
    { to: '/admin/offers', icon: 'offers', label: { ar: 'العروض والخصومات', en: 'Offers' }, cap: CAP.MANAGE_OFFERS },
    { to: '/admin/campaigns', icon: 'bellRing', label: { ar: 'الإعلانات والحملات', en: 'Campaigns' }, cap: CAP.MANAGE_CAMPAIGNS },
    { to: '/admin/library', icon: 'folder', label: { ar: 'المكتبة', en: 'Library' }, anyOf: [CAP.MANAGE_MENU, CAP.MANAGE_CAMPAIGNS, CAP.MANAGE_STORIES, CAP.MANAGE_APPEARANCE] },
    { to: '/admin/stories', icon: 'camera', label: { ar: 'الاستوري', en: 'Stories' }, cap: CAP.MANAGE_STORIES },
    { to: '/admin/posts', icon: 'events', label: { ar: 'البروفايل والأخبار', en: 'Profile & news' }, cap: CAP.MANAGE_STORIES },
    { to: '/admin/reviews-studio', icon: 'star', label: { ar: 'استوديو التقييمات', en: 'Reviews studio' }, cap: CAP.MANAGE_CAMPAIGNS },
    { to: '/admin/posts-studio', icon: 'camera', label: { ar: 'استوديو المنشورات', en: 'Post studio' }, cap: CAP.MANAGE_CAMPAIGNS },
    // The print studio sat behind a button on /admin/print-menu and appeared in
    // no menu at all, so nobody looking for it from the tables side could find
    // it. It belongs beside the other studios.
    { to: '/admin/print-studio', icon: 'penLine', label: { ar: 'استوديو التصميم والمطبوعات', en: 'Print design studio' }, anyOf: [CAP.MANAGE_MENU, CAP.MANAGE_APPEARANCE] },
    // its OWN cap: floor control (manage_tables) must not drag the design studio along
    { to: '/admin/table-stickers', icon: 'qr', label: { ar: 'ملصقات استاند الطاولة', en: 'Table stand stickers' }, cap: CAP.MANAGE_STICKERS, feature: 'tables' },
    { to: '/admin/messages', icon: 'message', label: { ar: 'سجل الرسائل والتحليلات', en: 'Messages log' }, cap: CAP.MANAGE_CAMPAIGNS },
    { to: '/admin/ads', icon: 'image', label: { ar: 'استوديو الإعلانات', en: 'Ads studio' }, cap: CAP.MANAGE_CAMPAIGNS },
    { to: '/admin/gen-history', icon: 'sparkles', label: { ar: 'سجل التوليد', en: 'Generation log' }, anyOf: [CAP.MANAGE_CAMPAIGNS, CAP.MANAGE_MENU, CAP.MANAGE_APPEARANCE] },
  ] },
  { title: { ar: 'الفعاليات والحجوزات', en: 'Events & bookings' }, items: [
    { to: '/admin/events', icon: 'events', label: { ar: 'الفعاليات والتذاكر', en: 'Events & tickets' }, cap: CAP.MANAGE_EVENTS },
    { to: '/admin/reservations', icon: 'calendar', label: { ar: 'الحجوزات', en: 'Reservations' }, cap: CAP.MANAGE_EVENTS, feature: 'reservations' },
  ] },
  { title: { ar: 'النظام والمساعدة', en: 'System & help' }, items: [
    { to: '/admin/assistant', icon: 'sparkles', label: { ar: 'المساعد الذكي', en: 'AI assistant' }, cap: CAP.USE_ASSISTANT },
    { to: '/admin/screens', icon: 'qr', label: { ar: 'شاشات العرض', en: 'Display screens' }, cap: CAP.MANAGE_APPEARANCE },
    { to: '/admin/settings', icon: 'settings', label: { ar: 'الإعدادات', en: 'Settings' }, anyOf: [CAP.MANAGE_SETTINGS, CAP.MANAGE_APPEARANCE, CAP.MANAGE_LOYALTY, CAP.MANAGE_INTEGRATIONS] },
    { to: '/admin/billing', icon: 'wallet', label: { ar: 'الفوترة والاشتراك', en: 'Billing' }, cap: CAP.MANAGE_SETTINGS },
    { to: '/admin/help', icon: 'zap', label: { ar: 'مركز المساعدة', en: 'Help center' } },
    { to: '/admin/support', icon: 'mail', label: { ar: 'الدعم والتواصل', en: 'Support' }, cap: CAP.MANAGE_SETTINGS },
    { to: '/portal', icon: 'user', label: { ar: 'بوابتي', en: 'My portal' } },
  ] },
]

export default function AdminLayout() {
  useCompactUI()

  // Prefetch ONLY the primary hubs, late and politely. The old list pulled 30
  // chunks — Settings alone is a ~577KB source module — the moment the layout
  // mounted, and on a tablet that parse/compile burst competed with the
  // cashier's first interactions. These hubs cover the primary nav; everything
  // else loads on demand (all routes are lazy anyway). ORDER mirrors the
  // sidebar's most-used-first order — the browser fetches sequentially, so the
  // daily-ops + reports chunks (what a shift opens next) land before the
  // menu/marketing hubs. DailyReport rides along: it is a ~130-line chunk and
  // the manager's first tap every morning.
  useEffect(() => {
    if (navigator.connection?.saveData) return undefined
    const routes = [
      () => import('../routes/admin/Orders.jsx'),
      () => import('../routes/admin/OpsHub.jsx'),
      () => import('../routes/admin/Tables.jsx'),
      () => import('../routes/admin/InsightsHub.jsx'),
      () => import('../routes/admin/DailyReport.jsx'),
      () => import('../routes/admin/Dashboard.jsx'),
      () => import('../routes/admin/MenuHub.jsx'),
      () => import('../routes/admin/CustomersHub.jsx'),
      () => import('../routes/admin/StaffHub.jsx'),
    ]
    const trigger = () => routes.forEach((r) => { try { r() } catch (_) { /* chunk 404 mid-deploy */ } })
    // wait 4s after mount, then ask for idle time (8s deadline) — first taps win
    const timer = setTimeout(() => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(trigger, { timeout: 8000 })
      else trigger()
    }, 4000)
    return () => clearTimeout(timer)
  }, [])

  const { t, toggleTheme, toggleLang, theme, lang } = useI18n()
  const { tenant, tenantId, logout, profile, can, isPlatformAdmin, isManager } = useAuth()
  // Nav is filtered by BOTH role capability and the venue's subscription plan.
  const allowed = (n) => (!n.cap || can(n.cap)) && (!n.anyOf || n.anyOf.some((c) => can(c))) && (!n.feature || planAllows(tenant, n.feature))
  useSystemThemeBody(tenant, 'admin') // portaled sheets/toasts pick the theme up from <body>
  // The venue's own tab identity: its logo as favicon + its name as the title,
  // restored to the platform's when the dashboard unmounts.
  useEffect(() => {
    if (!tenant?.name) return
    const prevTitle = document.title
    document.title = tenant.name
    // Full INSTALL identity, not just the favicon: "Install app" from the
    // console now produces the venue-logo staff app starting at /app/:slug
    // (→ PIN lock), instead of the platform manifest and the landing page.
    applyStaffManifest(tenant, tenant.slug)
    return () => { document.title = prevTitle; restorePlatformManifest() }
  }, [tenant?.name, tenant?.logoUrl, tenant?.slug])
  const visibleNav = navItems.filter(allowed)
  const [moreOpen, setMoreOpen] = useState(false)
  // «المزيد» is the ONLY route to 33 destinations and was one undifferentiated
  // scroll — reaching «تسجيل الخروج» or «الدعم» meant ~3 screens of dragging.
  const [moreQ, setMoreQ] = useState('')
  // WHICH GROUPS ARE CLOSED, remembered per device.
  //
  // Stored as the CLOSED set rather than the open one, so the default for a
  // group that did not exist when the staffer last chose is "open". A new
  // section must never arrive already hidden — that is how a shipped feature
  // goes unnoticed for a month.
  const [closedGroups, setClosedGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem('rbt_nav_closed') || '{}') || {} } catch (_) { return {} }
  })
  const toggleGroup = (key) => setClosedGroups((prev) => {
    const next = { ...prev, [key]: !prev[key] }
    if (!next[key]) delete next[key]
    try { localStorage.setItem('rbt_nav_closed', JSON.stringify(next)) } catch (_) { /* ignore */ }
    return next
  })
  // Global search (everything in the system): topbar button or Ctrl/Cmd+K.
  const [searchOpen, setSearchOpen] = useState(false)
  // Quick assistant sheet (the floating FAB) — see AssistantQuick.jsx.
  const [aiQuickOpen, setAiQuickOpen] = useState(false)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setSearchOpen((v) => !v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Collapsible + drag-resizable desktop sidebar (persisted). < 130px renders as
  // an icon rail. FIRST-RUN DEFAULT is width-aware: on a ~1024px tablet a fixed
  // 248px sidebar ate a third of the operations floor plan — those screens start
  // as the icon rail; an explicit user choice (stored) always wins.
  const [sideW, setSideW] = useState(() => {
    const v = Number(localStorage.getItem('adminSideW'))
    if (v >= 66 && v <= 360) return v
    return window.innerWidth < 1280 ? 66 : 248
  })
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
  // «رقم مضيء على حسب الإشعارات»: live counts rendered as glowing badges on
  // the nav rows OF THE SECTION they belong to — pending orders on the
  // cashier/orders entries, working tickets on the kitchen, open complaints on
  // the complaints row. Fed by the SAME order listener the sound alert already
  // uses, so the badge costs nothing extra.
  const [ordersPending, setOrdersPending] = useState(0)
  const [kitchenBusy, setKitchenBusy] = useState(0)
  const [complaintsOpen, setComplaintsOpen] = useState(0)
  // EVERY bell notification lights its own section too («أي إشعار في أي مكان
  // يظهر في قسمه»): StaffBell publishes its unread rows' deep links, and each
  // one is charged to the nav route that owns it by LONGEST-prefix match — so
  // «التقرير اليومي جاهز» lands on تقرير اليوم and a new registered customer
  // on العملاء, without a hand-written map that goes stale.
  const [unreadNotifs, setUnreadNotifs] = useState([])
  const notifCounts = useMemo(() => {
    const routes = [
      ...navItems.map((n) => n.to),
      ...moreGroups.flatMap((g) => g.items.map((l) => l.to)),
    ]
    const counts = {}
    for (const u of unreadNotifs) {
      const path = String(u.to || '').split(/[?#]/)[0]
      if (!path) continue
      let best = ''
      for (const r of routes) {
        // '/admin' is Home — it must not swallow every unmatched admin link
        if (r === '/admin' && path !== '/admin') continue
        if ((path === r || path.startsWith(`${r}/`)) && r.length > best.length) best = r
      }
      if (best) counts[best] = (counts[best] || 0) + 1
    }
    return counts
  }, [unreadNotifs])
  // Live operational counts OWN their four routes (a pending order is truer
  // than its unread notification and never double-counts); unread bell items
  // cover every other section.
  const navBadges = {
    '/cashier': ordersPending,
    '/admin/orders': ordersPending,
    '/kds': kitchenBusy,
    '/admin/complaints': complaintsOpen,
  }
  const badgeFor = (to) => (navBadges[to] !== undefined ? navBadges[to] : (notifCounts[to] || 0))
  const navBadge = (to) => {
    const n = badgeFor(to)
    if (!n) return null
    return <span className="nav-badge">{n > 99 ? '99+' : n}</span>
  }
  const navigate = useNavigate()
  const loc = useLocation()
  // When suspended, lock every admin screen EXCEPT the support page (so managers
  // can still reach the platform to resolve the suspension).
  const suspended = tenant?.active === false
  const onSupport = loc.pathname.endsWith('/support')
  // True on every destination that is NOT one of the primary bottom-nav tabs —
  // i.e. anything reached through the «المزيد» sheet.
  const onMore = !visibleNav.some((n) => (n.exact ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))

  // A notification tapped on a page this worker does not control cannot be
  // navigated by the worker, so it posts the destination instead. Routed here
  // rather than reloaded, so the tap lands on the order without losing state.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined
    const onMsg = (e) => {
      const d = e.data || {}
      if (d.type === 'navigate' && typeof d.url === 'string' && d.url.startsWith('/')) navigate(d.url)
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [navigate])

  // Shared refcounted stream (lib/liveBoard.js) — the badge counter, the accept
  // modal, the cashier board and the KDS all ride ONE snapshot per tenant now.
  const activeOrders = useActiveOrders(tenantId)
  useEffect(() => {
    if (!activeOrders) return
    const waiting = activeOrders.filter((o) => o.status === 'pending')
    const pending = waiting.length
    if (seeded.current && pending > prevPending.current) {
      // CARRY THE ORDER ID. This sent a bare '/cashier' with the venue name as
      // the body — no way to know WHICH order arrived, and because all three
      // new-order alerts share tag:'order' they collapse into one OS
      // notification whose url is whichever raiser fired last. So the bell's
      // correct deep link was being replaced at random by this one.
      const fresh = waiting[0]
      alertParty({
        title: lang === 'ar' ? 'طلب جديد' : 'New order',
        body: fresh ? `${orderNumber(fresh.code)} · ${fresh.tableLabel || tenant?.name || ''}` : (tenant?.name || ''),
        tag: 'order',
        url: fresh ? `/cashier?order=${fresh.id}` : '/cashier',
      })
    }
    prevPending.current = pending
    seeded.current = true
    setOrdersPending(pending)
    setKitchenBusy(activeOrders.filter((o) => o.status === 'accepted' || o.status === 'preparing').length)
  }, [activeOrders, lang, tenant])

  // Open complaints count for the sidebar badge — CAP-GATED to match the
  // firestore rule (view_complaints): an ungated listener here was a
  // guaranteed permission-denied on every session for cashiers/waiters.
  const canComplaints = isManager || can(CAP.VIEW_COMPLAINTS)
  useEffect(() => {
    if (!tenantId || !canComplaints) return undefined
    return watchComplaints(tenantId, (list) => {
      setComplaintsOpen((list || []).filter((c) => (c.status || 'open') === 'open').length)
    })
  }, [tenantId, canComplaints])

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
  // (New staffers are seeded instantly by the onStaffDocCreated Cloud
  // Function; this sweep remains the safety net for role-caps edits.)
  useEffect(() => {
    if (!tenantId || !isManager) return
    healStaffCapsMirrors(tenantId, tenant?.roleCaps)
      .then((n) => { if (n > 0) console.info(`[heal] refreshed ${n} staff caps mirrors`) })
      .catch((err) => console.warn('[heal staff caps]', err))
  }, [tenantId, isManager, tenant?.roleCaps])

  // 5. legacy PIN sweep: move any pinHash still sitting on peer-readable staff
  // docs into the server-only staffPins collection (idempotent; once/session).
  useEffect(() => {
    if (!tenantId || !isManager) return
    const key = `ml.pinmig.${tenantId}`
    if (sessionStorage.getItem(key)) return
    migrateStaffPins(tenantId)
      .then((r) => { sessionStorage.setItem(key, '1'); if (r.moved > 0) console.info(`[heal] migrated ${r.moved} staff PIN(s) to staffPins`) })
      .catch(() => {})
  }, [tenantId, isManager])

  // 6. self-registered guests: backfill lastOrderAt so the lastOrderAt-ordered
  // customer list actually shows them (they were bell-visible but list-invisible).
  useEffect(() => {
    if (!tenantId) return
    const key = `ml.custheal.${tenantId}`
    if (sessionStorage.getItem(key)) return
    healRegisteredCustomers(tenantId)
      .then((n) => { sessionStorage.setItem(key, '1'); if (n > 0) console.info(`[heal] surfaced ${n} registered customer(s)`) })
      .catch(() => {})
  }, [tenantId])

  // 7. dish-photo ratios: persist imageRatio on items that lack it, so the
  // menu reserves each photo's box before decode (kills the stage table jump
  // on cold opens). Manager-only (items update requires the menu cap).
  useEffect(() => {
    if (!tenantId || !isManager) return
    const key = `ml.imgratio.${tenantId}`
    if (sessionStorage.getItem(key)) return
    healImageRatios(tenantId)
      .then((n) => { sessionStorage.setItem(key, '1'); if (n > 0) console.info(`[heal] stored ${n} photo ratio(s)`) })
      .catch(() => {})
  }, [tenantId, isManager])

  const doLogout = async () => {
    await logout()
    navigate('/login')
  }

  // Reveal horizontal overflow everywhere in the admin (see scrollAffordance).
  useEffect(() => initScrollAffordance(document.body), [])

  // In-app navigation bridge for the AI assistant's open_page tool (actions.js
  // dispatches 'rbt:navigate' — SPA navigation instead of a full reload).
  useEffect(() => {
    const onNav = (e) => {
      const to = e?.detail?.to
      if (typeof to === 'string' && to.startsWith('/')) navigate(to)
    }
    window.addEventListener('rbt:navigate', onNav)
    return () => window.removeEventListener('rbt:navigate', onNav)
  }, [navigate])

  // First-run guided tour for the current section (shows once per device per key).
  const tourKey = loc.pathname === '/admin' ? 'dashboard'
    : loc.pathname.startsWith('/admin/menu') || loc.pathname.startsWith('/admin/items') ? 'items'
    : loc.pathname.startsWith('/admin/campaigns') ? 'campaigns'
    : loc.pathname.startsWith('/admin/settings') ? 'settings'
    : loc.pathname.startsWith('/admin/customers') ? 'customers'
    : loc.pathname.startsWith('/admin/library') ? 'library'
    : null

  return (
    <div className="admin-shell" style={{ '--sidebar-w': `${effW}px` }} data-collapsed={collapsed ? 'true' : undefined} data-systheme={systemThemeAttr(tenant, 'admin')} data-sidebar={tenant?.sidebarStyle || undefined} data-sidetheme={tenant?.sidebarTheme || undefined}>
      <AppBackground tenant={tenant} />
      <PinLock tenant={tenant} tenantId={tenantId} />
      <IncomingAlerts />
      {tourKey && TOURS[tourKey] && tenant?.toursEnabled !== false && <Tour key={tourKey} steps={TOURS[tourKey]} storageKey={tourKey} />}
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
        {/* Renders NOTHING for a single-venue account — which is every account
            today, so this line is invisible until a group exists. */}
        <BranchSwitcher />
        <nav className="admin-side-nav">
          {visibleNav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.exact} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={n.icon} size={18} /> <span>{lang === 'ar' ? n.label.ar : n.label.en}</span>
              {navBadge(n.to)}
            </NavLink>
          ))}
          {/* COLLAPSIBLE GROUPS. Five groups, thirty-three destinations, all
              expanded at once — the sidebar was a wall a staffer scrolled past
              rather than read. The title is now the control.

              Three rules keep it from ever hiding what you need:
                · the group holding the CURRENT page is always open, so you can
                  never collapse yourself into not knowing where you are;
                · a search match forces its group open, because a filtered
                  sidebar exists precisely to show you the hit;
                · the state is per-group and persists, so the shape a staffer
                  arranges is the shape they come back to. */}
          {moreGroups.map((g) => {
            const q = moreQ.trim().toLowerCase()
            const items = g.items.filter(allowed).filter((l) => !q
              || l.label.ar.toLowerCase().includes(q) || l.label.en.toLowerCase().includes(q))
            if (!items.length) return null
            const key = g.title.en
            const hasActive = items.some((l) => (l.exact ? loc.pathname === l.to : loc.pathname.startsWith(l.to)))
            const open = !!q || hasActive || !closedGroups[key]
            return (
              <div key={key} className="admin-side-group" data-open={open ? 'true' : 'false'}>
                <button type="button" className="admin-side-title" aria-expanded={open}
                  onClick={() => toggleGroup(key)}
                  // A group you cannot close because you are standing in it
                  // should say so rather than swallow the tap.
                  disabled={!!q || hasActive}
                  title={hasActive ? (lang === 'ar' ? 'يحتوي الصفحة الحالية' : 'Contains the current page') : undefined}>
                  <span>{lang === 'ar' ? g.title.ar : g.title.en}</span>
                  <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
                </button>
                {open && items.map((l) => (
                  <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                    <Icon name={l.icon} size={18} /> <span>{lang === 'ar' ? l.label.ar : l.label.en}</span>
                    {navBadge(l.to)}
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
        {/* 44px sidebar toggle a FINGER can hit — the 28px one inside the
            sidebar and the 8px drag rail are mouse furniture. Shows only where
            the sidebar exists (≥980px, via .ab-side-toggle in index.css). */}
        <button className="icon-btn ab-side-toggle" onClick={toggleSide}
          title={lang === 'ar' ? (collapsed ? 'فتح القائمة الجانبية' : 'طي القائمة الجانبية') : (collapsed ? 'Expand sidebar' : 'Collapse sidebar')}
          aria-label="toggle sidebar">
          <Icon name="sidebar" size={20} />
        </button>
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
        <button className="icon-btn" onClick={() => setSearchOpen(true)} title={lang === 'ar' ? 'البحث الشامل (Ctrl+K)' : 'Global search (Ctrl+K)'} aria-label={lang === 'ar' ? 'البحث الشامل' : 'Global search'}>
          <Icon name="search" size={18} />
        </button>
        <PageGuide />
        {tenant?.pinLock?.enabled && (
          <button className="icon-btn" onClick={requestLock} title={lang === 'ar' ? 'قفل الشاشة الآن' : 'Lock now'} aria-label="lock">
            <Icon name="key" size={18} />
          </button>
        )}
        {tenant?.slug && (
          <a
            className="icon-btn ab-wide"
            href={menuUrl(tenant.slug)}
            target="_blank"
            rel="noreferrer"
            title={lang === 'ar' ? 'معاينة كعميل' : 'Preview as customer'}
            aria-label="preview as customer"
          >
            <Icon name="eye" size={18} />
          </a>
        )}
        <StaffBell tenantId={tenantId} onUnread={setUnreadNotifs} />
        <button className="icon-btn ab-wide" onClick={toggleLang} aria-label={lang === 'ar' ? 'تغيير اللغة' : 'Change language'} style={{ fontWeight: 800, fontSize: 13 }}>
          {lang === 'ar' ? 'EN' : 'ع'}
        </button>
        <button className="icon-btn ab-wide" onClick={toggleTheme} aria-label={lang === 'ar' ? 'تبديل الوضع الليلي' : 'Toggle dark mode'}>
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
            {navBadge(n.to)}
          </NavLink>
        ))}
        {/* «المزيد» reads as ACTIVE on every secondary screen. Without this the
            33 destinations behind this sheet all showed an entirely unlit nav —
            the phone user's only navigation gave zero "where am I" feedback. */}
        <button
          className={onMore ? 'active' : ''}
          onClick={() => setMoreOpen(true)}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}
        >
          <Icon name="more" size={22} />
          <span>{t('more')}</span>
        </button>
      </nav>
      </div>

      {/* Floating quick-assistant button — one tap to ask the AI a question
          from ANY admin screen without abandoning the work in progress.
          Cap-gated like the sidebar entry, and hidden on the full assistant
          page itself (a FAB that opens a lesser copy of the page you are
          already on is noise). z-index 250 keeps it under every backdrop/sheet
          (300/310), so open sheets — including its own — cover it. */}
      {can(CAP.USE_ASSISTANT) && loc.pathname !== '/admin/assistant' && (
        <button className="ai-fab" onClick={() => setAiQuickOpen(true)} aria-label={lang === 'ar' ? 'المساعد' : 'Assistant'}>
          <Icon name="sparkles" size={20} />
        </button>
      )}
      <AssistantQuick open={aiQuickOpen} onClose={() => setAiQuickOpen(false)} />

      <Sheet open={moreOpen} onClose={() => { setMoreOpen(false); setMoreQ('') }} title={t('more')}>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <input
            className="input"
            value={moreQ}
            onChange={(e) => setMoreQ(e.target.value)}
            placeholder={lang === 'ar' ? 'ابحث في الأقسام…' : 'Filter sections…'}
            aria-label={lang === 'ar' ? 'ابحث في الأقسام' : 'Filter sections'}
          />
          <InstallButton />
          {/* The app bar cannot hold six 46px controls next to the venue name on
              a phone, so these three live here instead — nothing is lost. */}
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {tenant?.slug && (
              <a className="list-row" href={menuUrl(tenant.slug)} target="_blank" rel="noreferrer" onClick={() => setMoreOpen(false)}>
                <Icon name="eye" size={22} />
                <span className="bold">{lang === 'ar' ? 'معاينة كعميل' : 'Preview as customer'}</span>
                <span className="grow" />
                <Icon name="next" size={18} className="faint" />
              </a>
            )}
            <button className="list-row" onClick={toggleTheme}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={22} />
              <span className="bold">{lang === 'ar' ? (theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي') : (theme === 'dark' ? 'Light mode' : 'Dark mode')}</span>
              <span className="grow" />
            </button>
            <button className="list-row" onClick={toggleLang}>
              <Icon name="globe" size={22} />
              <span className="bold">{lang === 'ar' ? 'English' : 'العربية'}</span>
              <span className="grow" />
            </button>
          </div>
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
                    {navBadge(l.to)}
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
