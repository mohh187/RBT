import { Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import { useI18n } from './lib/i18n.jsx'
import ErrorBoundary, { lazyRoute } from './components/ErrorBoundary.jsx'
import { CAP } from './lib/permissions.js'
import { FullSpinner } from './components/ui.jsx'
import { isPlatformHost, resolveHostVenue } from './lib/domains.js'
import FirebaseSetup from './components/FirebaseSetup.jsx'
import OfflineBanner from './components/OfflineBanner.jsx'
import PinLock from './components/PinLock.jsx'
import { getDeviceVenue } from './lib/pin.js'
import UploadProgress from './components/UploadProgress.jsx'
import LiquidFilters from './components/LiquidFilters.jsx'
import PlanGate from './components/PlanGate.jsx'

// The public menu is THE first paint for diners (QR scan -> /m/:slug or a venue
// domain root), so it stays in the entry chunk: making it lazy would add a
// second round trip to the single most common load in the product.
// The TABLE menu is the same scan-to-first-paint path (/t/:slug/:token on every
// table sticker) and shares MenuView/db/ui with the entry chunk anyway — lazy
// only added a chunk round trip on weak café Wi-Fi, so it rides eager too.
import PublicMenu from './routes/menu/PublicMenu.jsx'
import TableMenu from './routes/menu/TableMenu.jsx'

// Every OTHER public route is code-split. They share MenuView/db/ui with the
// entry chunk already, so their own chunks are small, and a diner reading a
// menu no longer downloads the marketing landing, signup, onboarding, events,
// passes or the order-status screen (which drags in firebase/messaging).
const Landing = lazyRoute(() => import('./routes/Landing.jsx'))
const Login = lazyRoute(() => import('./routes/Login.jsx'))
const StaffEntry = lazyRoute(() => import('./routes/StaffEntry.jsx'))
const Signup = lazyRoute(() => import('./routes/Signup.jsx'))
const Onboarding = lazyRoute(() => import('./routes/Onboarding.jsx'))
const PreviewMenu = lazyRoute(() => import('./routes/menu/PreviewMenu.jsx'))
const OrderStatus = lazyRoute(() => import('./routes/menu/OrderStatus.jsx'))
const PublicEvents = lazyRoute(() => import('./routes/events/PublicEvents.jsx'))
const BookReservation = lazyRoute(() => import('./routes/events/BookReservation.jsx'))
const BookTable = lazyRoute(() => import('./routes/menu/BookTable.jsx'))
const Pass = lazyRoute(() => import('./routes/events/Pass.jsx'))
const MemberCard = lazyRoute(() => import('./routes/member/MemberCard.jsx'))

// The admin shell itself was eager, which put the sidebar, global search index,
// page-guide catalogue, tour scripts, pin lock and the QR encoder in the entry
// chunk for everyone. It is staff-only — it belongs behind the same lazy
// boundary as the pages it wraps.
const AdminLayout = lazyRoute(() => import('./components/AdminLayout.jsx'))

// Staff/admin routes are code-split — diners never download the back-office bundle.
const Dashboard = lazyRoute(() => import('./routes/admin/Dashboard.jsx'))
const Items = lazyRoute(() => import('./routes/admin/Items.jsx'))
const Categories = lazyRoute(() => import('./routes/admin/Categories.jsx'))
const Tables = lazyRoute(() => import('./routes/admin/Tables.jsx'))
const Offers = lazyRoute(() => import('./routes/admin/Offers.jsx'))
const Customers = lazyRoute(() => import('./routes/admin/Customers.jsx'))
const StoriesAdmin = lazyRoute(() => import('./routes/admin/StoriesAdmin.jsx'))
const PosPreviewPage = lazyRoute(() => import('./routes/staff/PosPreviewPage.jsx'))
const VenueProfile = lazyRoute(() => import('./routes/menu/VenueProfile.jsx'))
const PostsAdmin = lazyRoute(() => import('./routes/admin/PostsAdmin.jsx'))
const ScreenPlayer = lazyRoute(() => import('./routes/screen/ScreenPlayer.jsx'))
const Setup = lazyRoute(() => import('./routes/Setup.jsx'))
const PinLockPreviewPage = lazyRoute(() => import('./routes/staff/PinLockPreviewPage.jsx'))
const ScreensAdmin = lazyRoute(() => import('./routes/admin/ScreensAdmin.jsx'))
const Inventory = lazyRoute(() => import('./routes/admin/Inventory.jsx'))
const Complaints = lazyRoute(() => import('./routes/admin/Complaints.jsx'))
const Performance = lazyRoute(() => import('./routes/admin/Performance.jsx'))
const Attendance = lazyRoute(() => import('./routes/admin/Attendance.jsx'))
const StaffHub = lazyRoute(() => import('./routes/admin/StaffHub.jsx'))
const Roles = lazyRoute(() => import('./routes/admin/Roles.jsx'))
const Policies = lazyRoute(() => import('./routes/admin/Policies.jsx'))
const Reports = lazyRoute(() => import('./routes/admin/Reports.jsx'))
const Accounting = lazyRoute(() => import('./routes/admin/Accounting.jsx'))
const Behavior = lazyRoute(() => import('./routes/admin/Behavior.jsx'))
const GuestPlay = lazyRoute(() => import('./routes/admin/GuestPlay.jsx'))
const GamesHub = lazyRoute(() => import('./routes/admin/GamesHub.jsx'))
const GenHistory = lazyRoute(() => import('./routes/admin/GenHistory.jsx'))
const AdsStudio = lazyRoute(() => import('./routes/admin/AdsStudio.jsx'))
const JoinRoom = lazyRoute(() => import('./routes/JoinRoom.jsx'))
const Growth = lazyRoute(() => import('./routes/admin/Growth.jsx'))
const DailyReport = lazyRoute(() => import('./routes/admin/DailyReport.jsx'))
const Staff = lazyRoute(() => import('./routes/admin/Staff.jsx'))
const Settings = lazyRoute(() => import('./routes/admin/Settings.jsx'))
const Assistant = lazyRoute(() => import('./routes/admin/Assistant.jsx'))
const Events = lazyRoute(() => import('./routes/admin/Events.jsx'))
const Reservations = lazyRoute(() => import('./routes/admin/Reservations.jsx'))
const InsightsHub = lazyRoute(() => import('./routes/admin/InsightsHub.jsx'))
const MenuHub = lazyRoute(() => import('./routes/admin/MenuHub.jsx'))
const OpsHub = lazyRoute(() => import('./routes/admin/OpsHub.jsx'))
const Orders = lazyRoute(() => import('./routes/admin/Orders.jsx'))
const CustomersHub = lazyRoute(() => import('./routes/admin/CustomersHub.jsx'))
const Campaigns = lazyRoute(() => import('./routes/admin/Campaigns.jsx'))
const PrintMenu = lazyRoute(() => import('./routes/admin/PrintMenu.jsx'))
const PrintStudio = lazyRoute(() => import('./routes/admin/PrintStudio.jsx'))
const TableStickers = lazyRoute(() => import('./routes/admin/TableStickers.jsx'))
const Cashier = lazyRoute(() => import('./routes/staff/Cashier.jsx'))
const Kds = lazyRoute(() => import('./routes/staff/Kds.jsx'))
const Scanner = lazyRoute(() => import('./routes/staff/Scanner.jsx'))
const StaffPortal = lazyRoute(() => import('./routes/portal/StaffPortal.jsx'))
const DriverPortal = lazyRoute(() => import('./routes/driver/DriverPortal.jsx'))
const PayReturn = lazyRoute(() => import('./routes/PayReturn.jsx'))
const InlineCheckout = lazyRoute(() => import('./routes/InlineCheckout.jsx'))
const Invoice = lazyRoute(() => import('./routes/Invoice.jsx'))
const Support = lazyRoute(() => import('./routes/admin/Support.jsx'))
const Help = lazyRoute(() => import('./routes/admin/Help.jsx'))
const NotFound = lazyRoute(() => import('./routes/NotFound.jsx'))
const ReviewsStudio = lazyRoute(() => import('./routes/admin/ReviewsStudio.jsx'))
const PostStudio = lazyRoute(() => import('./routes/admin/PostStudio.jsx'))
const Messages = lazyRoute(() => import('./routes/admin/Messages.jsx'))
const Billing = lazyRoute(() => import('./routes/admin/Billing.jsx'))
const Library = lazyRoute(() => import('./routes/admin/Library.jsx'))
const ChoosePlan = lazyRoute(() => import('./routes/ChoosePlan.jsx'))

// Platform console (super-admin, cross-venue) — separate lazy chunk; venues never download it.
const PlatformLayout = lazyRoute(() => import('./routes/platform/PlatformLayout.jsx'))
const PlatformOverview = lazyRoute(() => import('./routes/platform/Overview.jsx'))
const PlatformVenues = lazyRoute(() => import('./routes/platform/Venues.jsx'))
const PlatformVenueDetail = lazyRoute(() => import('./routes/platform/VenueDetail.jsx'))
const PlatformChat = lazyRoute(() => import('./routes/platform/Chat.jsx'))
const PlatformIssues = lazyRoute(() => import('./routes/platform/Issues.jsx'))
const PlatformSubscriptions = lazyRoute(() => import('./routes/platform/Subscriptions.jsx'))
const PlatformActivity = lazyRoute(() => import('./routes/platform/Activity.jsx'))
const PlatformAnalytics = lazyRoute(() => import('./routes/platform/Analytics.jsx'))
const PlatformBroadcast = lazyRoute(() => import('./routes/platform/Broadcast.jsx'))
const PlatformDesign = lazyRoute(() => import('./routes/platform/Design.jsx'))
// Extended platform feature screens (the 100-ideas build).
const PlatformRealtime = lazyRoute(() => import('./routes/platform/Realtime.jsx'))
const PlatformInsights = lazyRoute(() => import('./routes/platform/Insights.jsx'))
const PlatformAudit = lazyRoute(() => import('./routes/platform/Audit.jsx'))
const PlatformRoles = lazyRoute(() => import('./routes/platform/Roles.jsx'))
const PlatformSupportTools = lazyRoute(() => import('./routes/platform/SupportTools.jsx'))
const PlatformBilling = lazyRoute(() => import('./routes/platform/Billing.jsx'))
const PlatformPlanEditor = lazyRoute(() => import('./routes/platform/PlanEditor.jsx'))
const PlatformDesignTools = lazyRoute(() => import('./routes/platform/DesignTools.jsx'))
const PlatformGrowth = lazyRoute(() => import('./routes/platform/Growth.jsx'))
const PlatformSettings = lazyRoute(() => import('./routes/platform/PlatformSettings.jsx'))
const PlatformCompliance = lazyRoute(() => import('./routes/platform/Compliance.jsx'))
const PlatformSpend = lazyRoute(() => import('./routes/platform/Spend.jsx'))
const PlatformDocuments = lazyRoute(() => import('./routes/platform/Documents.jsx'))
const PlatformFinance = lazyRoute(() => import('./routes/platform/Finance.jsx'))
const PlatformHealth = lazyRoute(() => import('./routes/platform/Health.jsx'))
const PlatformInvoiceDoc = lazyRoute(() => import('./routes/PlatformInvoice.jsx'))
const PublicQuote = lazyRoute(() => import('./routes/PublicQuote.jsx'))
const PlatformAssistant = lazyRoute(() => import('./routes/platform/PlatformAssistant.jsx'))
const PlatformSegments = lazyRoute(() => import('./routes/platform/Segments.jsx'))
const StatusPage = lazyRoute(() => import('./routes/StatusPage.jsx'))
const Legal = lazyRoute(() => import('./routes/Legal.jsx'))
const PlatformLegal = lazyRoute(() => import('./routes/platform/LegalEditor.jsx'))
const PlatformDomains = lazyRoute(() => import('./routes/platform/Domains.jsx'))
const PlatformLanding = lazyRoute(() => import('./routes/platform/LandingStudio.jsx'))

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <FullSpinner />
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  return children
}

function RequireTenant({ children }) {
  const { tenantId, loading, isPlatformAdmin } = useAuth()
  if (loading) return <FullSpinner />
  // A platform admin with no venue of their own belongs in the console.
  if (!tenantId) return <Navigate to={isPlatformAdmin ? '/platform' : '/onboarding'} replace />
  return children
}

// Platform console gate — only accounts listed in platformAdmins/{uid}.
function RequirePlatform({ children }) {
  const { isPlatformAdmin, loading } = useAuth()
  if (loading) return <FullSpinner />
  if (!isPlatformAdmin) return <Navigate to="/" replace />
  return children
}

// Role-capability guard for an admin sub-route. The sidebar already HIDES links a
// staffer lacks the cap for, but the routes themselves were reachable by typing
// the URL — this closes that hole (a waiter can't open /admin/reports directly).
// Owner/manager hold every cap, so they pass all of these.
function RequireCap({ cap, anyOf, children }) {
  const { can, loading } = useAuth()
  if (loading) return <FullSpinner />
  if (anyOf && !anyOf.some((c) => can(c))) return <Navigate to="/portal" replace />
  if (cap && !can(cap)) return <Navigate to="/portal" replace />
  return children
}

// The behaviour planner hands a ready draft to the campaigns / post-studio
// pages. The draft travels through sessionStorage (it carries a real phone
// list that has no business sitting in a URL) and the target page picks it up.
function BehaviorRoute() {
  const navigate = useNavigate()
  const hand = (key, to) => (draft) => {
    try { sessionStorage.setItem(key, JSON.stringify(draft || {})) } catch (_) { /* private mode: the page just opens blank */ }
    navigate(to)
  }
  return (
    <Behavior
      onCreateCampaign={hand('rbt_campaign_draft', '/admin/campaigns?draft=1')}
      onCreateContent={hand('rbt_content_draft', '/admin/posts-studio?draft=1')}
    />
  )
}

// Play analytics hands its segments to campaigns the same way the behaviour
// planner does — one shared handoff shape, one place that knows the URL.
function GuestPlayRoute() {
  const navigate = useNavigate()
  return (
    <GuestPlay
      onCreateCampaign={(draft) => {
        try { sessionStorage.setItem('rbt_campaign_draft', JSON.stringify(draft || {})) } catch (_) { /* private mode */ }
        navigate('/admin/campaigns?draft=1')
      }}
    />
  )
}

// Growth hands its findings to the pages that already know how to act on them:
// offer drafts to Offers, audience drafts to Campaigns. Same handoff shape the
// behaviour planner uses, so there is one convention across the product.
function GrowthRoute() {
  const navigate = useNavigate()
  return (
    <Growth
      onCreateOffer={(draft) => {
        try { sessionStorage.setItem('rbt_offer_draft', JSON.stringify(draft || {})) } catch (_) { /* private mode */ }
        navigate('/admin/offers?draft=1')
      }}
      onCreateCampaign={(draft) => {
        try { sessionStorage.setItem('rbt_campaign_draft', JSON.stringify(draft || {})) } catch (_) { /* private mode */ }
        navigate('/admin/campaigns?draft=1')
      }}
    />
  )
}

// Delivery drivers get their own focused portal, never the admin dashboard.
function DriverGate({ children }) {
  const { role, loading } = useAuth()
  if (loading) return <FullSpinner />
  if (role === 'driver') return <Navigate to="/driver" replace />
  return children
}

// Blocks operational staff routes when the venue is suspended by the platform.
function RequireActive({ children }) {
  const { tenant, loading } = useAuth()
  if (loading) return <FullSpinner />
  if (tenant?.active === false) {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <div>
          <p style={{ fontWeight: 800, color: 'var(--danger)' }}>الحساب موقوف مؤقتاً من إدارة المنصة</p>
          <p className="small" style={{ marginTop: 6 }}>{tenant?.suspendReason || 'تم إيقاف الوصول. تواصل مع الدعم لإعادة التفعيل.'}</p>
        </div>
      </div>
    )
  }
  return children
}

// Managers/owners see the admin dashboard. ADMIN-class roles (supervisor,
// marketing) land on the first admin section their caps allow. OPERATIONAL
// roles (cashier/waiter/barista/kitchen/cleaner/staff) get their OWN world —
// the staff portal shell — never "admin with fewer items" (owner decision:
// staff screens are a distinct experience).
const ADMIN_ROLES = ['owner', 'manager', 'supervisor', 'marketing', 'accountant']
const ADMIN_HOME_ORDER = [
  [CAP.MANAGE_CAMPAIGNS, '/admin/campaigns'],
  [CAP.TAKE_ORDERS, '/admin/orders'],
  [CAP.MANAGE_MENU, '/admin/menu'],
  [CAP.MANAGE_TABLES, '/admin/operations'],
  [CAP.MANAGE_STORIES, '/admin/stories'],
  // accountant's landing — AFTER the floor caps so a supervisor (who also
  // holds view_revenue) still lands on orders, not the ledgers
  [CAP.VIEW_REVENUE, '/admin/accounting'],
  [CAP.VIEW_CUSTOMERS, '/admin/customers'],
  [CAP.VIEW_REPORTS, '/admin/reports'],
]
function AdminHome() {
  const { isManager, role, can } = useAuth()
  if (isManager) return <InsightsHub />
  if (!ADMIN_ROLES.includes(role)) {
    // Operational roles live in the portal BY DESIGN — but an owner can grant
    // one an ADMIN-ONLY cap (per-staffer override, e.g. a cashier who manages
    // the menu). Those caps have no portal surface, so bouncing every /admin
    // visit to /portal left the deliberate grant with zero navigation to it.
    // Orders/tables stay portal-served for these roles; the rest route in.
    const PORTAL_SERVED = new Set([CAP.TAKE_ORDERS, CAP.MANAGE_TABLES])
    const grant = ADMIN_HOME_ORDER.find(([c]) => !PORTAL_SERVED.has(c) && can(c))
    return <Navigate to={grant ? grant[1] : '/portal'} replace />
  }
  const hit = ADMIN_HOME_ORDER.find(([c]) => can(c))
  return <Navigate to={hit ? hit[1] : '/portal'} replace />
}

// PIN entry = shift start on the floor (owner decision 2026-08-18): each role
// lands on ITS working screen — waiter → tables/operations (falls back to the
// POS when the venue hasn't granted manage_tables), cashier → POS, kitchen and
// barista → KDS, driver → driver portal. Everyone else takes the /admin funnel
// (managers → dashboard, admin-class → first permitted section, rest → portal).
// EMAIL entry deliberately keeps funnelling through /admin, which lands
// operational staff on the PORTAL — that's the asked-for split. This only
// picks the FIRST screen; everyone can still navigate anywhere their caps allow.
function PinHome() {
  const { role, can, loading } = useAuth()
  if (loading) return <FullSpinner />
  if (role === 'cashier') return <Navigate to="/cashier" replace />
  if (role === 'kitchen' || role === 'barista') return <Navigate to="/kds" replace />
  if (role === 'waiter') return <Navigate to={can(CAP.MANAGE_TABLES) ? '/admin/operations' : '/cashier'} replace />
  if (role === 'driver') return <Navigate to="/driver" replace />
  return <Navigate to="/admin" replace />
}

// Cold-start lock screen (/lock): the tablet remembers its venue (device cache,
// written on every staff login) but nobody holds a Firebase session — the PIN
// alone signs the staffer in (pinSignIn custom token). Deliberately NO
// RequireAuth: this IS the login. A live session skips straight to /admin,
// where the in-shell PinLock overlay takes over.
function LockRoute() {
  const { user, tenantId, loading } = useAuth()
  const navigate = useNavigate()
  const cached = getDeviceVenue()
  if (loading) return <FullSpinner />
  if (user && tenantId) return <Navigate to="/admin" replace />
  if (!cached?.tid) return <Navigate to="/login" replace />
  return (
    <PinLock
      standalone
      tenant={cached}
      tenantId={cached.tid}
      onSuccess={() => navigate('/go/pin', { replace: true })}
    />
  )
}

// The "/" route: on the platform host it's the marketing landing; on a venue's
// own custom domain / subdomain it resolves to that venue's menu at the root.
function RootRoute() {
  const platform = isPlatformHost()
  const [venue, setVenue] = useState(null)
  const [resolving, setResolving] = useState(!platform)
  useEffect(() => {
    if (platform) return
    let alive = true
    resolveHostVenue().then((v) => { if (alive) { setVenue(v); setResolving(false) } })
    return () => { alive = false }
  }, [platform])
  if (platform) return <Landing />
  if (resolving) return <FullSpinner />
  if (venue?.slug) return <PublicMenu slug={venue.slug} />
  return <Landing />
}

export default function App() {
  const { firebaseReady } = useAuth()
  const location = useLocation()
  const { lang } = useI18n()
  if (!firebaseReady) return <FirebaseSetup />

  return (
    <>
      <OfflineBanner />
      <UploadProgress />
      <LiquidFilters />
    {/* Route-level boundary. Two jobs: (1) a dead network or fresh deploy can
        make a code-split chunk fetch fail — that self-heals with one reload;
        (2) a genuine render crash in ONE screen now shows an inline recovery
        card RIGHT HERE, while the app shell above (offline banner, uploads)
        stays mounted — instead of blanking or re-throwing to the full-screen
        root. resetKey=path so navigating to another screen clears it. */}
    <ErrorBoundary variant="route" resetKey={location.pathname} lang={lang} label={location.pathname}>
    <Suspense fallback={<FullSpinner />}>
    <Routes>
      {/* public marketing + auth (venue menu at root on a custom domain) */}
      <Route path="/" element={<RootRoute />} />
      <Route path="/login" element={<Login />} />
      <Route path="/lock" element={<LockRoute />} />
      {/* post-PIN role router — PinLock navigates here after every real entry */}
      <Route path="/go/pin" element={<PinHome />} />
      {/* the venue's own front door — never the marketing landing (staff PWA start_url) */}
      <Route path="/app" element={<StaffEntry />} />
      <Route path="/app/:slug" element={<StaffEntry />} />
      <Route path="/signup" element={<Signup />} />
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <Onboarding />
          </RequireAuth>
        }
      />

      {/* inline checkout (Apple Pay native, on our own domain) + return */}
      <Route path="/pay/return" element={<PayReturn />} />
      <Route path="/pay/:intentId" element={<InlineCheckout />} />
      <Route path="/invoice/:tid/:id" element={<Invoice />} />
      {/* platform-issued documents: a tax invoice/credit note the venue can open
          from an email link, and a prospect-facing quotation guarded by a token */}
      <Route path="/inv/:id" element={<PlatformInvoiceDoc />} />
      <Route path="/quote/:id/:token" element={<PublicQuote />} />

      {/* diner-facing */}
      <Route path="/m/:slug" element={<PublicMenu />} />
      <Route path="/m/:slug/about" element={<VenueProfile />} />
      <Route path="/screen" element={<ScreenPlayer />} />
      <Route path="/preview/:slug" element={<PreviewMenu />} />
      <Route path="/t/:slug/:token" element={<TableMenu />} />
      <Route path="/order/:slug/:orderId" element={<OrderStatus />} />
      <Route path="/e/:slug" element={<PublicEvents />} />
      <Route path="/book/:slug" element={<BookReservation />} />
      <Route path="/reserve/:slug" element={<BookTable />} />
      <Route path="/pass/:slug/:kind/:id" element={<Pass />} />
      <Route path="/mcard/:slug/:token" element={<MemberCard />} />

      {/* staff realtime boards */}
      <Route
        path="/cashier"
        element={
          <RequireAuth>
            <RequireTenant>
              <RequireActive>
                <RequireCap cap={CAP.TAKE_ORDERS}>
                  <PlanGate feature="cashier">
                    <Cashier />
                  </PlanGate>
                </RequireCap>
              </RequireActive>
            </RequireTenant>
          </RequireAuth>
        }
      />
      <Route
        path="/choose-plan"
        element={
          <RequireAuth>
            <RequireTenant>
              <ChoosePlan />
            </RequireTenant>
          </RequireAuth>
        }
      />
      <Route
        path="/setup"
        element={
          <RequireAuth>
            <RequireTenant>
              <Setup />
            </RequireTenant>
          </RequireAuth>
        }
      />
      <Route
        path="/preview/pinlock"
        element={
          <RequireAuth>
            <RequireTenant>
              <PinLockPreviewPage />
            </RequireTenant>
          </RequireAuth>
        }
      />
      <Route
        path="/preview/pos"
        element={
          <RequireAuth>
            <RequireTenant>
              <PosPreviewPage />
            </RequireTenant>
          </RequireAuth>
        }
      />
      <Route
        path="/kds"
        element={
          <RequireAuth>
            <RequireTenant>
              <RequireActive>
                <RequireCap cap={CAP.KITCHEN}>
                  <PlanGate feature="kds">
                    <Kds />
                  </PlanGate>
                </RequireCap>
              </RequireActive>
            </RequireTenant>
          </RequireAuth>
        }
      />
      {/* staff portal — its own shell (sidebar + bottom nav + PIN lock), tabs
          are URL-driven so back-navigation and deep links behave like real pages */}
      <Route
        path="/portal/:ptab?"
        element={
          <RequireAuth>
            <RequireTenant>
              <RequireActive>
                <StaffPortal />
              </RequireActive>
            </RequireTenant>
          </RequireAuth>
        }
      />
      <Route
        path="/scan"
        element={
          <RequireAuth>
            <RequireTenant>
              <RequireActive>
                <RequireCap cap={CAP.SCAN_TICKETS}>
                  <Scanner />
                </RequireCap>
              </RequireActive>
            </RequireTenant>
          </RequireAuth>
        }
      />
      <Route
        path="/driver"
        element={
          <RequireAuth>
            <RequireTenant>
              <RequireActive>
                <RequireCap cap={CAP.DELIVER}>
                  <DriverPortal />
                </RequireCap>
              </RequireActive>
            </RequireTenant>
          </RequireAuth>
        }
      />

      {/* admin */}
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RequireTenant>
              <DriverGate>
                <AdminLayout />
              </DriverGate>
            </RequireTenant>
          </RequireAuth>
        }
      >
        <Route index element={<AdminHome />} />
        {/* Every admin sub-route carries BOTH a role-capability guard (RequireCap)
            and, where relevant, a subscription PlanGate. RequireCap closes the
            direct-URL hole: lower roles only reach what their caps permit. */}
        <Route path="menu" element={<RequireCap cap={CAP.MANAGE_MENU}><MenuHub /></RequireCap>} />
        <Route path="print-menu" element={<RequireCap cap={CAP.MANAGE_MENU}><PrintMenu /></RequireCap>} />
        <Route path="print-studio" element={<RequireCap anyOf={[CAP.MANAGE_MENU, CAP.MANAGE_APPEARANCE]}><PrintStudio /></RequireCap>} />
        <Route path="orders" element={<RequireCap cap={CAP.TAKE_ORDERS}><PlanGate feature="orders"><Orders /></PlanGate></RequireCap>} />
        <Route path="operations" element={<RequireCap cap={CAP.MANAGE_TABLES}><PlanGate feature="tables"><OpsHub /></PlanGate></RequireCap>} />
        <Route path="inventory" element={<RequireCap cap={CAP.MANAGE_INVENTORY}><Inventory /></RequireCap>} />
        <Route path="customers" element={<RequireCap cap={CAP.VIEW_CUSTOMERS}><CustomersHub /></RequireCap>} />
        <Route path="campaigns" element={<RequireCap cap={CAP.MANAGE_CAMPAIGNS}><Campaigns /></RequireCap>} />
        <Route path="stories" element={<RequireCap cap={CAP.MANAGE_STORIES}><StoriesAdmin /></RequireCap>} />
        <Route path="posts" element={<RequireCap cap={CAP.MANAGE_STORIES}><PostsAdmin /></RequireCap>} />
        <Route path="screens" element={<RequireCap cap={CAP.MANAGE_APPEARANCE}><ScreensAdmin /></RequireCap>} />
        {/* standalone routes kept for deep-links / back-compat */}
        <Route path="items" element={<RequireCap cap={CAP.MANAGE_MENU}><Items /></RequireCap>} />
        <Route path="categories" element={<RequireCap cap={CAP.MANAGE_MENU}><Categories /></RequireCap>} />
        <Route path="tables" element={<RequireCap cap={CAP.MANAGE_TABLES}><PlanGate feature="tables"><Tables /></PlanGate></RequireCap>} />
        {/* sticker studio is a DESIGN tool, not floor control — its own cap, so a
            waiter granted manage_tables to seat guests doesn't get the print studio */}
        <Route path="table-stickers" element={<RequireCap cap={CAP.MANAGE_STICKERS}><PlanGate feature="tables"><TableStickers /></PlanGate></RequireCap>} />
        <Route path="offers" element={<RequireCap cap={CAP.MANAGE_OFFERS}><Offers /></RequireCap>} />
        <Route path="events" element={<RequireCap cap={CAP.MANAGE_EVENTS}><Events /></RequireCap>} />
        <Route path="reservations" element={<RequireCap cap={CAP.MANAGE_EVENTS}><PlanGate feature="reservations"><Reservations /></PlanGate></RequireCap>} />
        <Route path="complaints" element={<RequireCap cap={CAP.VIEW_COMPLAINTS}><Complaints /></RequireCap>} />
        <Route path="reports" element={<RequireCap cap={CAP.VIEW_REPORTS}><PlanGate feature="reports"><Reports /></PlanGate></RequireCap>} />
        <Route path="accounting" element={<RequireCap cap={CAP.VIEW_REVENUE}><Accounting /></RequireCap>} />
        <Route path="behavior" element={<RequireCap cap={CAP.VIEW_REPORTS}><BehaviorRoute /></RequireCap>} />
        <Route path="guest-play" element={<RequireCap cap={CAP.VIEW_REPORTS}><GuestPlayRoute /></RequireCap>} />
        <Route path="games-hub" element={<RequireCap cap={CAP.VIEW_REPORTS}><GamesHub /></RequireCap>} />
        <Route path="gen-history" element={<RequireCap anyOf={[CAP.MANAGE_CAMPAIGNS, CAP.MANAGE_MENU, CAP.MANAGE_APPEARANCE]}><GenHistory /></RequireCap>} />
        <Route path="ads" element={<RequireCap cap={CAP.MANAGE_CAMPAIGNS}><AdsStudio /></RequireCap>} />
        <Route path="growth" element={<RequireCap cap={CAP.VIEW_REPORTS}><GrowthRoute /></RequireCap>} />
        <Route path="daily" element={<RequireCap cap={CAP.VIEW_REPORTS}><PlanGate feature="reports"><DailyReport /></PlanGate></RequireCap>} />
        <Route path="hr" element={<RequireCap cap={CAP.ATTENDANCE}><PlanGate feature="staff"><StaffHub /></PlanGate></RequireCap>} />
        <Route path="roles" element={<RequireCap cap={CAP.MANAGE_STAFF}><PlanGate feature="staff"><Roles /></PlanGate></RequireCap>} />
        <Route path="policies" element={<RequireCap cap={CAP.MANAGE_SETTINGS}><PlanGate feature="staff"><Policies /></PlanGate></RequireCap>} />
        <Route path="staff" element={<RequireCap cap={CAP.MANAGE_STAFF}><PlanGate feature="staff"><Staff /></PlanGate></RequireCap>} />
        <Route path="performance" element={<RequireCap cap={CAP.VIEW_PERFORMANCE}><PlanGate feature="performance"><Performance /></PlanGate></RequireCap>} />
        <Route path="attendance" element={<RequireCap cap={CAP.MANAGE_STAFF}><PlanGate feature="attendance"><Attendance /></PlanGate></RequireCap>} />
        <Route path="settings" element={<RequireCap anyOf={[CAP.MANAGE_SETTINGS, CAP.MANAGE_APPEARANCE, CAP.MANAGE_LOYALTY, CAP.MANAGE_INTEGRATIONS]}><Settings /></RequireCap>} />
        <Route path="assistant" element={<RequireCap cap={CAP.USE_ASSISTANT}><Assistant /></RequireCap>} />
        <Route path="support" element={<RequireCap cap={CAP.MANAGE_SETTINGS}><Support /></RequireCap>} />
        {/* help center — open to every staffer (no cap) */}
        <Route path="help" element={<Help />} />
        <Route path="reviews-studio" element={<RequireCap cap={CAP.MANAGE_CAMPAIGNS}><ReviewsStudio /></RequireCap>} />
        <Route path="posts-studio" element={<RequireCap cap={CAP.MANAGE_CAMPAIGNS}><PostStudio /></RequireCap>} />
        <Route path="messages" element={<RequireCap cap={CAP.MANAGE_CAMPAIGNS}><Messages /></RequireCap>} />
        <Route path="billing" element={<RequireCap cap={CAP.MANAGE_SETTINGS}><Billing /></RequireCap>} />
        {/* library — any staffer who can touch menu/marketing content */}
        <Route path="library" element={<RequireCap anyOf={[CAP.MANAGE_MENU, CAP.MANAGE_CAMPAIGNS, CAP.MANAGE_STORIES, CAP.MANAGE_APPEARANCE]}><Library /></RequireCap>} />
      </Route>

      {/* platform console (super-admin, cross-venue) */}
      <Route
        path="/platform"
        element={
          <RequireAuth>
            <RequirePlatform>
              <PlatformLayout />
            </RequirePlatform>
          </RequireAuth>
        }
      >
        <Route index element={<PlatformOverview />} />
        <Route path="venues" element={<PlatformVenues />} />
        <Route path="venues/:tid" element={<PlatformVenueDetail />} />
        <Route path="chat" element={<PlatformChat />} />
        <Route path="chat/:tid" element={<PlatformChat />} />
        <Route path="issues" element={<PlatformIssues />} />
        <Route path="subscriptions" element={<PlatformSubscriptions />} />
        <Route path="activity" element={<PlatformActivity />} />
        <Route path="analytics" element={<PlatformAnalytics />} />
        <Route path="broadcast" element={<PlatformBroadcast />} />
        <Route path="design" element={<PlatformDesign />} />
        <Route path="design/:tid" element={<PlatformDesign />} />
        <Route path="realtime" element={<PlatformRealtime />} />
        <Route path="insights" element={<PlatformInsights />} />
        <Route path="audit" element={<PlatformAudit />} />
        <Route path="roles" element={<PlatformRoles />} />
        <Route path="support" element={<PlatformSupportTools />} />
        <Route path="billing" element={<PlatformBilling />} />
        <Route path="spend" element={<PlatformSpend />} />
        <Route path="documents" element={<PlatformDocuments />} />
        <Route path="finance" element={<PlatformFinance />} />
        <Route path="health" element={<PlatformHealth />} />
        <Route path="plans" element={<PlatformPlanEditor />} />
        <Route path="design-tools" element={<PlatformDesignTools />} />
        <Route path="growth" element={<PlatformGrowth />} />
        <Route path="settings" element={<PlatformSettings />} />
        <Route path="compliance" element={<PlatformCompliance />} />
        <Route path="assistant" element={<PlatformAssistant />} />
        <Route path="segments" element={<PlatformSegments />} />
        <Route path="legal" element={<PlatformLegal />} />
        <Route path="domains" element={<PlatformDomains />} />
        <Route path="landing" element={<PlatformLanding />} />
      </Route>

      {/* An invited guest lands here from a shared room link, registers, and is
          handed to the menu with ?room=&game= so the board opens immediately. */}
      <Route path="/join/:tid/:roomId" element={<JoinRoom />} />

      {/* public platform status page + legal documents */}
      <Route path="/status" element={<StatusPage />} />
      <Route path="/legal" element={<Legal />} />
      <Route path="/legal/:doc" element={<Legal />} />
      <Route path="/terms" element={<Legal />} />
      <Route path="/privacy" element={<Legal />} />
      <Route path="/refund" element={<Legal />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
    </ErrorBoundary>
    </>
  )
}
