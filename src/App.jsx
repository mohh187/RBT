import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import { CAP } from './lib/permissions.js'
import { FullSpinner } from './components/ui.jsx'
import { isPlatformHost, resolveHostVenue } from './lib/domains.js'
import FirebaseSetup from './components/FirebaseSetup.jsx'
import AdminLayout from './components/AdminLayout.jsx'
import OfflineBanner from './components/OfflineBanner.jsx'
import UploadProgress from './components/UploadProgress.jsx'
import LiquidFilters from './components/LiquidFilters.jsx'
import PlanGate from './components/PlanGate.jsx'

// Public/entry routes load eagerly (diners hit these first — keep them in the main chunk).
import Landing from './routes/Landing.jsx'
import Login from './routes/Login.jsx'
import Signup from './routes/Signup.jsx'
import Onboarding from './routes/Onboarding.jsx'
import PublicMenu from './routes/menu/PublicMenu.jsx'
import PreviewMenu from './routes/menu/PreviewMenu.jsx'
import TableMenu from './routes/menu/TableMenu.jsx'
import OrderStatus from './routes/menu/OrderStatus.jsx'
import PublicEvents from './routes/events/PublicEvents.jsx'
import BookReservation from './routes/events/BookReservation.jsx'
import BookTable from './routes/menu/BookTable.jsx'
import Pass from './routes/events/Pass.jsx'
import MemberCard from './routes/member/MemberCard.jsx'

// Staff/admin routes are code-split — diners never download the back-office bundle.
const Dashboard = lazy(() => import('./routes/admin/Dashboard.jsx'))
const Items = lazy(() => import('./routes/admin/Items.jsx'))
const Categories = lazy(() => import('./routes/admin/Categories.jsx'))
const Tables = lazy(() => import('./routes/admin/Tables.jsx'))
const Offers = lazy(() => import('./routes/admin/Offers.jsx'))
const Customers = lazy(() => import('./routes/admin/Customers.jsx'))
const StoriesAdmin = lazy(() => import('./routes/admin/StoriesAdmin.jsx'))
const PosPreviewPage = lazy(() => import('./routes/staff/PosPreviewPage.jsx'))
const VenueProfile = lazy(() => import('./routes/menu/VenueProfile.jsx'))
const PostsAdmin = lazy(() => import('./routes/admin/PostsAdmin.jsx'))
const ScreenPlayer = lazy(() => import('./routes/screen/ScreenPlayer.jsx'))
const Setup = lazy(() => import('./routes/Setup.jsx'))
const PinLockPreviewPage = lazy(() => import('./routes/staff/PinLockPreviewPage.jsx'))
const ScreensAdmin = lazy(() => import('./routes/admin/ScreensAdmin.jsx'))
const Inventory = lazy(() => import('./routes/admin/Inventory.jsx'))
const Complaints = lazy(() => import('./routes/admin/Complaints.jsx'))
const Performance = lazy(() => import('./routes/admin/Performance.jsx'))
const Attendance = lazy(() => import('./routes/admin/Attendance.jsx'))
const StaffHub = lazy(() => import('./routes/admin/StaffHub.jsx'))
const Roles = lazy(() => import('./routes/admin/Roles.jsx'))
const Policies = lazy(() => import('./routes/admin/Policies.jsx'))
const Reports = lazy(() => import('./routes/admin/Reports.jsx'))
const DailyReport = lazy(() => import('./routes/admin/DailyReport.jsx'))
const Staff = lazy(() => import('./routes/admin/Staff.jsx'))
const Settings = lazy(() => import('./routes/admin/Settings.jsx'))
const Assistant = lazy(() => import('./routes/admin/Assistant.jsx'))
const Events = lazy(() => import('./routes/admin/Events.jsx'))
const Reservations = lazy(() => import('./routes/admin/Reservations.jsx'))
const InsightsHub = lazy(() => import('./routes/admin/InsightsHub.jsx'))
const MenuHub = lazy(() => import('./routes/admin/MenuHub.jsx'))
const OpsHub = lazy(() => import('./routes/admin/OpsHub.jsx'))
const Orders = lazy(() => import('./routes/admin/Orders.jsx'))
const CustomersHub = lazy(() => import('./routes/admin/CustomersHub.jsx'))
const Campaigns = lazy(() => import('./routes/admin/Campaigns.jsx'))
const PrintMenu = lazy(() => import('./routes/admin/PrintMenu.jsx'))
const Cashier = lazy(() => import('./routes/staff/Cashier.jsx'))
const Kds = lazy(() => import('./routes/staff/Kds.jsx'))
const Scanner = lazy(() => import('./routes/staff/Scanner.jsx'))
const StaffPortal = lazy(() => import('./routes/portal/StaffPortal.jsx'))
const DriverPortal = lazy(() => import('./routes/driver/DriverPortal.jsx'))
const PayReturn = lazy(() => import('./routes/PayReturn.jsx'))
const InlineCheckout = lazy(() => import('./routes/InlineCheckout.jsx'))
const Invoice = lazy(() => import('./routes/Invoice.jsx'))
const Support = lazy(() => import('./routes/admin/Support.jsx'))
const Help = lazy(() => import('./routes/admin/Help.jsx'))
const NotFound = lazy(() => import('./routes/NotFound.jsx'))
const ReviewsStudio = lazy(() => import('./routes/admin/ReviewsStudio.jsx'))
const PostStudio = lazy(() => import('./routes/admin/PostStudio.jsx'))
const Messages = lazy(() => import('./routes/admin/Messages.jsx'))
const Billing = lazy(() => import('./routes/admin/Billing.jsx'))
const Library = lazy(() => import('./routes/admin/Library.jsx'))
const ChoosePlan = lazy(() => import('./routes/ChoosePlan.jsx'))

// Platform console (super-admin, cross-venue) — separate lazy chunk; venues never download it.
const PlatformLayout = lazy(() => import('./routes/platform/PlatformLayout.jsx'))
const PlatformOverview = lazy(() => import('./routes/platform/Overview.jsx'))
const PlatformVenues = lazy(() => import('./routes/platform/Venues.jsx'))
const PlatformVenueDetail = lazy(() => import('./routes/platform/VenueDetail.jsx'))
const PlatformChat = lazy(() => import('./routes/platform/Chat.jsx'))
const PlatformIssues = lazy(() => import('./routes/platform/Issues.jsx'))
const PlatformSubscriptions = lazy(() => import('./routes/platform/Subscriptions.jsx'))
const PlatformActivity = lazy(() => import('./routes/platform/Activity.jsx'))
const PlatformAnalytics = lazy(() => import('./routes/platform/Analytics.jsx'))
const PlatformBroadcast = lazy(() => import('./routes/platform/Broadcast.jsx'))
const PlatformDesign = lazy(() => import('./routes/platform/Design.jsx'))
// Extended platform feature screens (the 100-ideas build).
const PlatformRealtime = lazy(() => import('./routes/platform/Realtime.jsx'))
const PlatformInsights = lazy(() => import('./routes/platform/Insights.jsx'))
const PlatformAudit = lazy(() => import('./routes/platform/Audit.jsx'))
const PlatformRoles = lazy(() => import('./routes/platform/Roles.jsx'))
const PlatformSupportTools = lazy(() => import('./routes/platform/SupportTools.jsx'))
const PlatformBilling = lazy(() => import('./routes/platform/Billing.jsx'))
const PlatformPlanEditor = lazy(() => import('./routes/platform/PlanEditor.jsx'))
const PlatformDesignTools = lazy(() => import('./routes/platform/DesignTools.jsx'))
const PlatformGrowth = lazy(() => import('./routes/platform/Growth.jsx'))
const PlatformSettings = lazy(() => import('./routes/platform/PlatformSettings.jsx'))
const PlatformCompliance = lazy(() => import('./routes/platform/Compliance.jsx'))
const PlatformAssistant = lazy(() => import('./routes/platform/PlatformAssistant.jsx'))
const PlatformSegments = lazy(() => import('./routes/platform/Segments.jsx'))
const StatusPage = lazy(() => import('./routes/StatusPage.jsx'))
const Legal = lazy(() => import('./routes/Legal.jsx'))
const PlatformLegal = lazy(() => import('./routes/platform/LegalEditor.jsx'))
const PlatformDomains = lazy(() => import('./routes/platform/Domains.jsx'))
const PlatformLanding = lazy(() => import('./routes/platform/LandingStudio.jsx'))

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

// Managers/owners see the admin dashboard. Other staff land on the FIRST admin
// section their caps allow (so e.g. a marketing hire stays in the shell on
// Campaigns), falling back to their personal portal if they have none.
const ADMIN_HOME_ORDER = [
  [CAP.MANAGE_CAMPAIGNS, '/admin/campaigns'],
  [CAP.TAKE_ORDERS, '/admin/orders'],
  [CAP.MANAGE_MENU, '/admin/menu'],
  [CAP.MANAGE_TABLES, '/admin/operations'],
  [CAP.MANAGE_STORIES, '/admin/stories'],
  [CAP.VIEW_CUSTOMERS, '/admin/customers'],
  [CAP.VIEW_REPORTS, '/admin/reports'],
]
function AdminHome() {
  const { isManager, can } = useAuth()
  if (isManager) return <InsightsHub />
  const hit = ADMIN_HOME_ORDER.find(([c]) => can(c))
  return <Navigate to={hit ? hit[1] : '/portal'} replace />
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
  if (!firebaseReady) return <FirebaseSetup />

  return (
    <>
      <OfflineBanner />
      <UploadProgress />
      <LiquidFilters />
    <Suspense fallback={<FullSpinner />}>
    <Routes>
      {/* public marketing + auth (venue menu at root on a custom domain) */}
      <Route path="/" element={<RootRoute />} />
      <Route path="/login" element={<Login />} />
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
      <Route
        path="/portal"
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
        <Route path="offers" element={<RequireCap cap={CAP.MANAGE_OFFERS}><Offers /></RequireCap>} />
        <Route path="events" element={<RequireCap cap={CAP.MANAGE_EVENTS}><Events /></RequireCap>} />
        <Route path="reservations" element={<RequireCap cap={CAP.MANAGE_EVENTS}><PlanGate feature="reservations"><Reservations /></PlanGate></RequireCap>} />
        <Route path="complaints" element={<RequireCap cap={CAP.VIEW_COMPLAINTS}><Complaints /></RequireCap>} />
        <Route path="reports" element={<RequireCap cap={CAP.VIEW_REPORTS}><PlanGate feature="reports"><Reports /></PlanGate></RequireCap>} />
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
    </>
  )
}
