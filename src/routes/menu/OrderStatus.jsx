import { Suspense, useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { resolveSlug, watchOrder, createReview, createComplaint, notifyArrival, getTenant, listItems } from '../../lib/db.js'
import SocialLinks, { socialHref } from '../../components/SocialLinks.jsx'
import Sheet from '../../components/Sheet.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { distanceMeters } from '../../lib/geo.js'
import { useToast } from '../../components/Toast.jsx'
import { FullSpinner, Empty } from '../../components/ui.jsx'
import DinerBar from '../../components/DinerBar.jsx'
import ChromeSkin from '../../components/ChromeSkin.jsx'
import PageBackground from '../../components/PageBackground.jsx'
import { resolveChrome, resolveChromePage } from '../../lib/dishComposition.js'
import Icon from '../../components/Icon.jsx'
import { orderNumber } from '../../lib/format.js'
import { Price } from '../../components/Riyal.jsx'
import { vibrate, alertParty } from '../../lib/notify.js'
import { getPrefs } from '../../lib/notifyPrefs.js'
import { isRated, markRated, isArrived, markArrived, getMyOrders, getLocalCustomer } from '../../lib/customer.js'
import { startPayment } from '../../lib/payments.js'
import { createVenueReview } from '../../lib/reviewImport.js'
import { lazyOverlay } from '../../components/ErrorBoundary.jsx'
// NotificationSettings -> push.js -> firebase/messaging + installations (~85 kB)
// for a panel most diners never open. Loaded on first open instead; it stays
// mounted afterwards so the sheet keeps its close animation.
// lazyOverlay (not React.lazy): absorbs a failed chunk into an inline retry
// card instead of rejecting through Suspense into a full page reload, and
// shows an instant scrim spinner while the chunk loads.
const NotificationSettings = lazyOverlay(() => import('../../components/NotificationSettings.jsx'), { label: 'notif-settings' })
import { deviceKey } from '../../lib/device.js'
import { gamesFor, resolveWaitGame } from '../../lib/games.js'
// heavy/rarely-opened guest overlays
const Leaderboard = lazyOverlay(() => import('../../components/Leaderboard.jsx'), { label: 'leaderboard' })
const KitchenTwin = lazyOverlay(() => import('../../components/KitchenTwin.jsx'), { label: 'kitchen-twin' })
const YearWrapped = lazyOverlay(() => import('../../components/YearWrapped.jsx'), { label: 'year-wrapped' })
// The full games hub — reused verbatim so a wait-game launch goes through the
// exact same registration gate, lobby and scoring as «ركن الألعاب».
const GamesCenter = lazyOverlay(() => import('../../components/GamesCenter.jsx'), { label: 'games-center' })

const STEPS = ['pending', 'accepted', 'preparing', 'ready', 'served']
const STEP_LABEL = {
  pending: 'statusPending', accepted: 'statusAccepted', preparing: 'statusPreparing',
  ready: 'statusReady', served: 'statusServed',
}

export default function OrderStatus() {
  const { slug, orderId } = useParams()
  const { t, lang } = useI18n()
  const toast = useToast()
  const [tid, setTid] = useState(null)
  const [order, setOrder] = useState(undefined)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifMounted, setNotifMounted] = useState(false)
  const [notifOn, setNotifOn] = useState(getPrefs().enabled)
  const [ratings, setRatings] = useState({})
  const [comment, setComment] = useState('')
  const [rated, setRated] = useState(() => isRated(orderId))
  const [submitting, setSubmitting] = useState(false)
  // venue-level (whole-experience) rating — once per order, flagged in this browser
  const [venueStars, setVenueStars] = useState(0)
  const [venueComment, setVenueComment] = useState('')
  const [venueRated, setVenueRated] = useState(() => { try { return localStorage.getItem(`rbt_rated_${orderId}`) === '1' } catch (_) { return false } })
  const [venueSubmitting, setVenueSubmitting] = useState(false)
  const [complaintOpen, setComplaintOpen] = useState(false)
  const [complaintMsg, setComplaintMsg] = useState('')
  const [sendingComplaint, setSendingComplaint] = useState(false)
  const [arrived, setArrived] = useState(() => isArrived(orderId))
  const [arriving, setArriving] = useState(false)
  const [paying, setPaying] = useState(false)
  // The configurable post-order wait game (tenant.waitGame). Opens the real
  // games hub on top of this screen; the strip below announces «طلبك جاهز» over
  // it without ever tearing the game down mid-round.
  const [waitHubOpen, setWaitHubOpen] = useState(false)
  const [waitHubGame, setWaitHubGame] = useState('')
  const [waitItems, setWaitItems] = useState(null)
  const [readyStrip, setReadyStrip] = useState(true)
  const [boardOpen, setBoardOpen] = useState(false)
  const [twinOpen, setTwinOpen] = useState(false)
  const [lastScore, setLastScore] = useState(0)
  const gameDeviceId = deviceKey()
  const [wrapBusy, setWrapBusy] = useState(false)
  const [wrapStats, setWrapStats] = useState(null)
  const [wrapItems, setWrapItems] = useState([])
  const prevStatus = useRef(null)

  const [venue, setVenue] = useState(null) // social links + Google Maps CTA

  useEffect(() => {
    let unsub
    let alive = true
    resolveSlug(slug).then((id) => {
      if (!alive) return // unmounted before the slug resolved — don't subscribe
      setTid(id)
      if (id) {
        unsub = watchOrder(id, orderId, setOrder)
        getTenant(id).then(setVenue).catch(() => {})
      } else setOrder(null)
    }).catch(() => { if (alive) setOrder(null) }) // a transient slug-lookup reject must not spin forever
    return () => { alive = false; unsub && unsub() }
  }, [slug, orderId])

  // Notify the diner when the status advances (skip first load).
  useEffect(() => {
    if (!order?.status) return
    const labelKey = { pending: 'statusPending', accepted: 'statusAccepted', preparing: 'statusPreparing', ready: 'statusReady', served: 'statusServed', paid: 'statusPaid', cancelled: 'statusCancelled' }[order.status]
    if (prevStatus.current && prevStatus.current !== order.status) {
      vibrate([90, 50, 90])
      toast.success(t(labelKey))
      alertParty({ title: t(labelKey), body: orderNumber(order.code), tag: 'orderstatus', requireInteraction: order.status === 'ready' })
    }
    prevStatus.current = order.status
  }, [order?.status, t])

  if (order === undefined) return <FullSpinner />
  if (!order) return <div className="auth-shell"><Empty icon="search" title={lang === 'ar' ? 'الطلب غير موجود' : 'Order not found'} /></div>

  const cancelled = order.status === 'cancelled'
  // An order prepaid online is paid even while its fulfillment status is still
  // pending/preparing — reflect that to the diner (the lifecycle keeps flowing).
  const paid = order.status === 'paid' || order.paidOnline === true || order.paymentStatus === 'paid'
  const currentIdx = STEPS.indexOf(order.status === 'paid' ? 'served' : order.status)
  // Live delivery tracking: distance from the driver to the customer → rough ETA.
  const dGeo = order.delivery?.driverGeo
  const dCust = order.delivery?.lat != null ? { lat: order.delivery.lat, lng: order.delivery.lng } : null
  const driverKm = (dGeo && dCust) ? distanceMeters(dGeo, dCust) / 1000 : null
  const etaMin = (driverKm != null && order.delivery?.status === 'on_way') ? Math.max(1, Math.round((driverKm / 30) * 60)) : null
  const currency = order.currency || 'SAR'

  // ---- post-order wait game (venue setting: tenant.waitGame) ----------------
  // { enabled, gameId }: gameId is a specific enabled game or 'auto'. When the
  // chosen game is 'auto' — or a game the venue has since disabled — a game is
  // picked deterministically from the enabled set by hashing the order id, so a
  // given order always offers the same game (no flicker across re-renders).
  //
  // ABSENCE MEANS "AUTO", NOT "THE FISHING GAME". This used to fall through to
  // a second, older branch that mounted «صياد البحر» by name — so every venue
  // that had not found the picker (it lived on a REPORTS page, /admin/guest-play,
  // behind VIEW_REPORTS) served that one game and nothing else, forever. The
  // resolver below was already correct; nothing reached it. resolveWaitGame is
  // shared with both admin screens so none of the three can drift again.
  const waitCfg = resolveWaitGame(venue)
  const waitOn = waitCfg?.enabled === true
  const waitEnabledGames = venue ? gamesFor(venue) : []
  const waitGameId = (() => {
    if (!waitOn || !waitEnabledGames.length) return ''
    const want = waitCfg?.gameId
    if (want && want !== 'auto') {
      const g = waitEnabledGames.find((x) => x.id === want)
      if (g) return g.id
    }
    let hsh = 0
    const s = String(orderId || '')
    for (let i = 0; i < s.length; i += 1) hsh = (hsh * 31 + s.charCodeAt(i)) >>> 0
    return waitEnabledGames[hsh % waitEnabledGames.length].id
  })()
  const waitGameObj = waitGameId ? waitEnabledGames.find((g) => g.id === waitGameId) : null
  const waitGameName = waitGameObj ? (lang === 'en' ? (waitGameObj.en || waitGameObj.ar) : waitGameObj.ar) : ''
  const waitFrame = etaMin != null
    ? (lang === 'ar' ? `الوقت المتوقّع نحو ${etaMin} دقيقة` : `about ${etaMin} min to go`)
    : (lang === 'ar' ? 'نحضّر طلبك الآن' : 'we are preparing your order')

  // Load the full menu once (some games build their content from it), then open
  // the hub straight onto the chosen game. Registration is handled inside the
  // hub's own gate — this never bypasses it.
  const openWaitGame = async () => {
    if (!waitGameId) return
    let its = waitItems
    if (its == null) {
      try { its = (await listItems(tid)) || [] } catch (_) { its = [] }
      setWaitItems(its)
    }
    setReadyStrip(true)
    setWaitHubGame(waitGameId)
    setWaitHubOpen(true)
  }

  const canRate = (order.status === 'served' || order.status === 'paid') && !rated && (order.items || []).some((l) => l.itemId)
  const submitRatings = async () => {
    const entries = (order.items || []).map((l, i) => ({ l, stars: ratings[i] })).filter((x) => x.l.itemId && x.stars)
    if (!entries.length) { toast.error(lang === 'ar' ? 'اختر تقييماً بالنجوم أولاً' : 'Pick a star rating first'); return }
    setSubmitting(true)
    try {
      const staffUid = order.servedByUid || order.acceptedByUid || ''
      const results = await Promise.allSettled(entries.map(({ l, stars }) => createReview(tid, { itemId: l.itemId, itemNameAr: l.nameAr || '', itemNameEn: l.nameEn || '', name: order.customerName || '', rating: stars, comment: comment.trim(), staffUid })))
      if (!results.some((r) => r.status === 'fulfilled')) throw results.find((r) => r.status === 'rejected')?.reason || new Error('failed')
      markRated(orderId)
      setRated(true)
      toast.success(t('reviewThanks'))
    } catch (e) {
      console.warn('[rating] failed:', e?.code || e?.message || e)
      toast.error(e?.code === 'permission-denied' ? (lang === 'ar' ? 'لم تُنشر صلاحيات قاعدة البيانات بعد' : 'Database rules not deployed yet') : t('error'))
    } finally {
      setSubmitting(false)
    }
  }

  // Venue (whole-experience) rating → a VENUE review: same reviews collection,
  // itemId null, source 'order' (public-create shape the rules allow: rating 1-5).
  const gmapsHref = socialHref('googleMaps', venue?.social?.googleMaps)
  const canRateVenue = (order.status === 'served' || order.status === 'paid') && !venueRated
  const submitVenueRating = async () => {
    if (!venueStars) { toast.error(lang === 'ar' ? 'اختر عدد النجوم أولاً' : 'Pick a star rating first'); return }
    // Happy guest → offer Google right away. window.open MUST run synchronously
    // inside this click handler or popup blockers will eat it.
    if (venueStars >= 4 && gmapsHref) window.open(gmapsHref, '_blank', 'noopener')
    setVenueSubmitting(true)
    try {
      await createVenueReview(tid, { name: order.customerName || '', rating: venueStars, comment: venueComment.trim() })
      try { localStorage.setItem(`rbt_rated_${orderId}`, '1') } catch (_) { /* ignore */ }
      setVenueRated(true)
      toast.success(t('reviewThanks'))
    } catch (e) {
      console.warn('[venue rating] failed:', e?.code || e?.message || e)
      toast.error(e?.code === 'permission-denied' ? (lang === 'ar' ? 'لم تُنشر صلاحيات قاعدة البيانات بعد' : 'Database rules not deployed yet') : t('error'))
    } finally {
      setVenueSubmitting(false)
    }
  }

  // #5/#9 Pay online for this order (awaiting-payment retry, or pay-at-table for a
  // cash/terminal order that changed its mind). Routes through the inline checkout.
  const payNow = async () => {
    setPaying(true)
    try { await startPayment('order', tid, orderId) }
    catch (_) { setPaying(false); toast.error(lang === 'ar' ? 'تعذّر فتح صفحة الدفع' : 'Could not open payment') }
  }

  // Loads the guest's own year: their orders (by the phone on this order) plus
  // the menu, then computes real stats. Nothing runs until they ask for it.
  const openWrapped = async () => {
    if (wrapBusy) return
    setWrapBusy(true)
    try {
      const [{ customerYear }, { getOrder, listItems }] = await Promise.all([
        import('../../lib/forecast.js'),
        import('../../lib/db.js'),
      ])
      // BUILT FROM THIS DEVICE'S OWN ORDERS, NOT FROM A QUERY.
      //
      // This used to call listOrdersSince(), which is a `list` on
      // tenants/{tid}/orders — and firestore.rules:371 restricts that to staff,
      // deliberately, so a diner cannot enumerate a venue's orders. So the
      // feature asked for the one read it could never have: every guest got
      // permission-denied, and the bare catch below turned it into «تعذّر».
      //
      // Loosening the rule is not the fix either. Firestore rules cannot see a
      // query's where() clauses, so «list only the orders matching your own
      // phone» is not expressible — opening it up would open ALL of them.
      //
      // getMyOrders() is the same source the BUTTON already gates on (three
      // remembered orders), and each id it holds is readable through the `get`
      // that rules:369 does allow. The story is now built from exactly what
      // this guest is entitled to read.
      const year = new Date().getFullYear()
      const mine = (getMyOrders(tid) || []).slice(0, 40)
      const [fetched, menu] = await Promise.all([
        Promise.all(mine.map((m) => getOrder(tid, m.id).catch(() => null))),
        listItems(tid).catch(() => []),
      ])
      const orders = fetched.filter(Boolean).filter((o) => {
        const ms = o.paidAtMs || (o.createdAt?.toMillis?.() ?? 0)
        return new Date(ms).getFullYear() === year
      })
      const phone = order.customerPhone || getLocalCustomer()?.phone || ''
      const stats = customerYear({ orders, customer: { phone }, year })
      if (!stats || !stats.hasData) {
        toast.info?.(lang === 'ar' ? 'لم نجد زيارات كافية بعد' : 'Not enough visits yet')
        return
      }
      setWrapItems(menu || [])
      setWrapStats(stats)
    } catch (e) {
      // The old catch was bare, so a permission denial and «no data yet» were
      // the same message. They are different problems and only one is ours.
      console.error('[wrapped]', e)
      toast.error(lang === 'ar' ? 'تعذّر تجهيز القصة' : 'Could not build your story')
    } finally { setWrapBusy(false) }
  }

  const doArrive = async () => {
    setArriving(true)
    try {
      await notifyArrival(tid, { orderId, code: order.code || '', car: order.car || null, tableLabel: order.tableLabel || '' })
      markArrived(orderId)
      setArrived(true)
      toast.success(t('arrivedNotified'))
    } catch (_) {
      toast.error(t('error'))
    } finally {
      setArriving(false)
    }
  }

  const submitComplaint = async () => {
    if (!complaintMsg.trim()) return
    setSendingComplaint(true)
    try {
      await createComplaint(tid, { name: order.customerName || '', phone: order.customerPhone || '', orderCode: order.code || '', message: complaintMsg.trim() })
      setComplaintOpen(false)
      setComplaintMsg('')
      toast.success(t('complaintSent'))
    } catch (_) {
      toast.error(t('error'))
    } finally {
      setSendingComplaint(false)
    }
  }

  // The REAL venue feeds the bar once loaded (it was already fetched at line
  // ~78 — no second read); until then today's synthetic title renders. The
  // tracking label stays in the page heading below either way. The room
  // wrapper mounts only when the venue configured a page background
  // (menuChrome.pages.order / follow) — at >=980px .venue-above locks the page
  // into a 100vh flex shell, so it must never appear un-opted-in.
  const pageBgOn = !!(venue && resolveChromePage(venue, 'order'))

  return (
    <div className={pageBgOn ? 'venue-above' : undefined} style={{ minHeight: '100dvh' }}>
      <ChromeSkin tenant={venue} />
      <PageBackground tenant={venue} page="order" />
      <DinerBar
        tenant={venue || { name: order.tableLabel || t('trackOrder') }}
        right={<button className="icon-btn db-chrome" onClick={() => { setNotifMounted(true); setNotifOpen(true) }} title={t('notifSettings')}><Icon name={notifOn ? 'bell' : 'bellOff'} size={20} /></button>}
      />
      <div className="container page stack" style={{ gap: 'var(--sp-5)' }}>
        <div className="text-center stack" style={{ gap: 10, alignItems: 'center' }}>
          <span className="center" style={{ width: 66, height: 66, borderRadius: '50%', background: cancelled ? 'var(--danger-soft)' : (order.status === 'ready' || paid) ? 'var(--success-soft)' : 'var(--brand-soft)', color: cancelled ? 'var(--danger)' : (order.status === 'ready' || paid) ? 'var(--success)' : 'var(--brand)' }}>
            <Icon name={cancelled ? 'no' : paid ? 'ok' : order.status === 'ready' ? 'bellRing' : 'clock'} size={32} />
          </span>
          <h2 style={{ fontSize: 'var(--fs-xl)' }}>{t(cancelled ? 'statusCancelled' : paid ? 'statusPaid' : STEP_LABEL[order.status] || 'statusPending')}</h2>
          <p className="muted">{orderNumber(order.code)} {order.tableLabel ? `· ${order.tableLabel}` : ''}</p>
          {cancelled && order.cancelReason && (
            <div className="small bold" style={{ color: 'var(--danger)', marginTop: 8, padding: '8px 16px', background: 'var(--danger-soft)', borderRadius: 'var(--r-md)', display: 'inline-block' }}>
              {order.cancelReason}
            </div>
          )}
        </div>

        {order.orderType === 'curbside' && !cancelled && (
          <div className="card card-pad stack" style={{ gap: 12, borderColor: 'var(--brand)' }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="center" style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--brand-soft)', color: 'var(--brand)', flex: 'none' }}><Icon name="car" size={22} /></span>
              <div className="grow">
                <strong className="small">{t('curbside')}</strong>
                {order.car && <div className="xs faint">{[order.car.model, order.car.color, order.car.plate].filter(Boolean).join(' · ')}</div>}
              </div>
            </div>
            {arrived ? (
              <div className="badge badge-success" style={{ justifyContent: 'center', padding: 10 }}><Icon name="check" size={15} /> {t('arrivedNotified')}</div>
            ) : (
              <button className="btn btn-primary btn-lg btn-block" disabled={arriving} onClick={doArrive}><Icon name="car" size={18} /> {arriving ? t('saving') : t('iArrived')}</button>
            )}
          </div>
        )}

        {order.orderType === 'delivery' && !cancelled && (
          <div className="card card-pad stack" style={{ gap: 10, borderColor: 'var(--brand)' }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="center" style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--brand-soft)', color: 'var(--brand)', flex: 'none' }}><Icon name="car" size={22} /></span>
              <div className="grow">
                <strong className="small">{lang === 'ar' ? 'التوصيل' : 'Delivery'}</strong>
                <div className="xs faint">
                  {({ pending: lang === 'ar' ? 'بانتظار مندوب' : 'Awaiting a driver', assigned: lang === 'ar' ? 'تم إسناد مندوب' : 'Driver assigned', picked_up: lang === 'ar' ? 'استلم المندوب طلبك' : 'Driver picked up your order', on_way: lang === 'ar' ? 'المندوب في الطريق إليك' : 'Driver is on the way', delivered: lang === 'ar' ? 'تم تسليم طلبك' : 'Delivered', failed: lang === 'ar' ? 'تعذّر التسليم' : 'Delivery failed' }[order.delivery?.status]) || (lang === 'ar' ? 'بانتظار مندوب' : 'Awaiting a driver')}
                  {order.delivery?.driverName ? ` · ${order.delivery.driverName}` : ''}
                </div>
              </div>
            </div>
            {etaMin != null && dGeo && (
              <div className="row-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <span className="small bold" style={{ color: 'var(--brand)' }}><Icon name="clock" size={14} /> {lang === 'ar' ? `يصل خلال نحو ${etaMin} دقيقة` : `Arrives in ~${etaMin} min`}</span>
                <a className="btn btn-sm btn-outline" href={`https://www.google.com/maps/search/?api=1&query=${dGeo.lat},${dGeo.lng}`} target="_blank" rel="noreferrer"><Icon name="pin" size={14} /> {lang === 'ar' ? 'تتبّع المندوب' : 'Track driver'}</a>
              </div>
            )}
          </div>
        )}

        {!cancelled && (
          <div className="card card-pad">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              {STEPS.map((s, i) => {
                const done = i <= currentIdx
                const current = i === currentIdx
                return (
                  <div key={s} className="stack center" style={{ gap: 6, flex: 1, textAlign: 'center', position: 'relative' }}>
                    {/* connector line to the previous step — fills with brand up to the current step */}
                    {i > 0 && <span aria-hidden="true" style={{ position: 'absolute', top: 16, insetInlineEnd: '50%', width: '100%', height: 2, background: done ? 'var(--brand)' : 'var(--border)' }} />}
                    <div className="center" style={{ width: 34, height: 34, borderRadius: '50%', background: done ? 'var(--brand)' : 'var(--surface-2)', color: done ? 'var(--on-brand)' : 'var(--text-faint)', fontWeight: 800, border: '1px solid var(--border)', position: 'relative', boxShadow: current ? '0 0 0 3px var(--brand-soft)' : 'none' }}>
                      {done ? <Icon name="check" size={16} /> : i + 1}
                    </div>
                    <span className="xs" style={{ color: done ? 'var(--brand)' : 'var(--text-faint)', fontWeight: current ? 700 : undefined }}>{t(STEP_LABEL[s])}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* «العب وأنت تنتظر» — the venue-chosen wait game (tenant.waitGame),
            launched through the real games hub so its registration gate, lobby
            and scoring are exactly the hub's. Shown until the order is served. */}
        {!cancelled && waitOn && waitGameId && currentIdx < STEPS.indexOf('served') && (
          <button
            type="button" className="wg-invite" onClick={openWaitGame}
            style={{ background: 'linear-gradient(135deg, #7c3aed, #0e7490)' }}
          >
            <span className="wg-invite-ico" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="4" y="4" width="16" height="16" rx="4.5" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="9" cy="9" r="1.4" fill="currentColor" />
                <circle cx="15" cy="9" r="1.4" fill="currentColor" />
                <circle cx="12" cy="12" r="1.4" fill="currentColor" />
                <circle cx="9" cy="15" r="1.4" fill="currentColor" />
                <circle cx="15" cy="15" r="1.4" fill="currentColor" />
              </svg>
            </span>
            <span className="wg-invite-txt">
              <b>{lang === 'ar' ? 'العب وأنت تنتظر' : 'Play while you wait'}</b>
              <span>{lang === 'ar' ? `«${waitGameName}» — ${waitFrame}` : `${waitGameName} — ${waitFrame}`}</span>
            </span>
          </button>
        )}

        {/* The legacy «صياد البحر» branch that used to sit here is gone. It was
            the reason every unconfigured venue served exactly one game: it
            mounted WaitGame by name whenever tenant.waitGame was unset, which
            was almost always. Fishing is still fully available — it is one entry
            in the catalogue above, reachable through the same hub as the rest. */}
        {/* The venue's «لوحة صدارة اللعبة» switch was a dead control: it was
            offered in Settings and nothing anywhere read it, so turning it off
            changed nothing a guest could see. It is honoured here. */}
        {boardOpen && venue?.leaderboardEnabled !== false && (
          <Suspense fallback={null}>
            <Leaderboard open onClose={() => setBoardOpen(false)} tenantId={tid} lang={lang} myScore={lastScore} deviceId={gameDeviceId} />
          </Suspense>
        )}

        {/* The wait game runs in the full games hub, mounted over this screen.
            openGameId drives its own gate/lobby so registration is never skipped. */}
        {waitHubOpen && (
          <Suspense fallback={null}>
            <GamesCenter
              open
              onClose={() => setWaitHubOpen(false)}
              tenantId={tid}
              tenant={venue}
              items={waitItems || []}
              lang={lang}
              openGameId={waitHubGame}
            />
          </Suspense>
        )}

        {/* «طلبك جاهز» over the game — the order flipped to ready/served while the
            guest is still playing. It never tears the round down: a thin strip
            above the hub (z 401 > hub 330), dismissable, with a way back. */}
        {waitHubOpen && readyStrip && (order.status === 'ready' || order.status === 'served' || paid) && (
          <div
            role="status"
            style={{
              position: 'fixed', insetInlineStart: 0, insetInlineEnd: 0, top: 0, zIndex: 401,
              display: 'flex', alignItems: 'center', gap: 10,
              padding: 'calc(10px + env(safe-area-inset-top, 0px)) 14px 10px',
              background: 'var(--success)', color: '#fff', boxShadow: '0 4px 18px rgba(0,0,0,.28)',
            }}
          >
            <Icon name="bellRing" size={18} style={{ flex: 'none' }} />
            <span className="small bold" style={{ flex: 1 }}>{lang === 'ar' ? 'طلبك جاهز' : 'Your order is ready'}</span>
            <button
              type="button" onClick={() => setWaitHubOpen(false)}
              style={{ flex: 'none', border: '1px solid rgba(255,255,255,.6)', background: 'rgba(255,255,255,.16)', color: '#fff', borderRadius: 999, padding: '5px 12px', fontWeight: 800, fontSize: 12.5, cursor: 'pointer' }}
            >{lang === 'ar' ? 'عرض الطلب' : 'View order'}</button>
            <button
              type="button" onClick={() => setReadyStrip(false)}
              aria-label={lang === 'ar' ? 'إخفاء' : 'Dismiss'}
              style={{ flex: 'none', border: 'none', background: 'transparent', color: '#fff', padding: 4, cursor: 'pointer', display: 'grid', placeItems: 'center' }}
            ><Icon name="close" size={16} /></button>
          </div>
        )}

        {/* «توأم المطبخ» — live per-item progress straight from the kitchen screen */}
        {!cancelled && currentIdx >= STEPS.indexOf('accepted') && currentIdx < STEPS.indexOf('served') && venue?.kitchenTwinEnabled !== false && (
          <button type="button" className="wg-invite" style={{ background: 'linear-gradient(135deg, var(--brand), var(--brand-dark, #0b5))' }} onClick={() => setTwinOpen(true)}>
            <span className="wg-invite-ico"><Icon name="kitchen" size={22} /></span>
            <span className="wg-invite-txt">
              <b>{lang === 'ar' ? 'تابع تحضير أصنافك لحظة بلحظة' : 'Follow your dishes live'}</b>
              <span>{lang === 'ar' ? 'كل صنف يُنجز في المطبخ يظهر لك فوراً' : 'Each dish updates as the kitchen finishes it'}</span>
            </span>
          </button>
        )}
        {twinOpen && (
          <Suspense fallback={null}>
            <KitchenTwin open onClose={() => setTwinOpen(false)} tenantId={tid} orderId={orderId} lang={lang} />
          </Suspense>
        )}

        {/* «سنتك معنا» — the guest's own year in review. Offered only to real
            regulars (3+ remembered orders on this device); the heavy history
            query runs on tap, never on page load. */}
        {(order.status === 'served' || order.status === 'paid') && (getMyOrders(tid) || []).length >= 3 && (
          <button type="button" className="wg-invite" style={{ background: 'linear-gradient(135deg, #6d28d9, #2563eb)' }} disabled={wrapBusy} onClick={openWrapped}>
            <span className="wg-invite-ico"><Icon name="award" size={22} /></span>
            <span className="wg-invite-txt">
              <b>{wrapBusy ? (lang === 'ar' ? 'نجهّز قصتك…' : 'Building your story…') : (lang === 'ar' ? 'سنتك معنا' : 'Your year with us')}</b>
              <span>{lang === 'ar' ? 'زياراتك وأطباقك المفضلة في بطاقات جميلة' : 'Your visits and favourites'}</span>
            </span>
          </button>
        )}
        {wrapStats && (
          <Suspense fallback={null}>
            <YearWrapped open onClose={() => setWrapStats(null)} stats={wrapStats} venueName={venue?.name || ''} lang={lang} currency={currency} items={wrapItems} />
          </Suspense>
        )}

        <div className="card card-pad stack">
          <strong>{t('yourOrder')}</strong>
          <div className="stack" style={{ gap: 6 }}>
            {(order.items || []).map((l, i) => (
              <div key={i} className="row-between small">
                <span>{l.qty}× {lang === 'en' && l.nameEn ? l.nameEn : l.nameAr}{l.variantLabel ? ` (${l.variantLabel})` : ''}</span>
                <span className="price"><Price value={l.lineTotal} currency={currency} lang={lang} /></span>
              </div>
            ))}
          </div>
          <div className="row-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-2)' }}>
            <span className="bold">{t('total')}</span>
            <span className="price bold"><Price value={order.total} currency={currency} lang={lang} /></span>
          </div>
        </div>

        {/* #9 payment state — paid (with invoice link) / awaiting (pay now) / pay on handover */}
        {!cancelled && order.total > 0 && (
          <div className="card card-pad stack" style={{ gap: 10 }}>
            {paid ? (
              <>
                <div className="row" style={{ gap: 8, alignItems: 'center', color: 'var(--success)' }}>
                  <Icon name="ok" size={18} /> <strong className="small">{lang === 'ar' ? 'تم الدفع' : 'Paid'}</strong>
                  <span className="grow" />
                  <span className="price bold"><Price value={order.amountPaid ?? order.total} currency={currency} lang={lang} /></span>
                </div>
                {order.receiptId && (
                  <Link to={`/invoice/${tid}/${order.receiptId}`} className="btn btn-outline btn-sm btn-block"><Icon name="receipt" size={15} /> {lang === 'ar' ? 'عرض الفاتورة الضريبية' : 'View tax invoice'}</Link>
                )}
              </>
            ) : (order.status === 'awaiting_payment' || order.paymentStatus === 'awaiting') ? (
              <>
                <div className="row" style={{ gap: 8, alignItems: 'center', color: 'var(--text-muted)' }}><Icon name="clock" size={16} /> <span className="small">{lang === 'ar' ? 'بانتظار إتمام الدفع' : 'Awaiting payment'}</span></div>
                <button className="btn btn-primary btn-block" disabled={paying} onClick={payNow}><Icon name="wallet" size={16} /> {paying ? (lang === 'ar' ? 'جارٍ فتح الدفع…' : 'Opening payment…') : (lang === 'ar' ? 'ادفع الآن' : 'Pay now')}</button>
              </>
            ) : (
              <>
                <div className="row" style={{ gap: 8, alignItems: 'center', color: 'var(--text-muted)' }}>
                  <Icon name={order.paymentMethod === 'card_terminal' ? 'card' : 'wallet'} size={16} />
                  <span className="small">{order.paymentMethod === 'card_terminal' ? (lang === 'ar' ? 'الدفع بالشبكة عند الاستلام' : 'Pay by card machine on handover') : (lang === 'ar' ? 'الدفع نقداً عند الاستلام' : 'Pay cash on handover')}</span>
                </div>
                {venue?.onlinePayment?.enabled === true && (
                  <button className="btn btn-outline btn-block" disabled={paying} onClick={payNow}><Icon name="wallet" size={16} /> {paying ? (lang === 'ar' ? 'جارٍ فتح الدفع…' : 'Opening payment…') : (lang === 'ar' ? 'أو ادفع الآن أونلاين' : 'Or pay online now')}</button>
                )}
              </>
            )}
          </div>
        )}

        {canRate && (
          <div className="card card-pad stack">
            <strong>{t('rateYourOrder')}</strong>
            {(order.items || []).map((l, i) => (l.itemId ? (
              <div key={i} className="row-between">
                <span className="small">{lang === 'en' && l.nameEn ? l.nameEn : l.nameAr}</span>
                <div className="stars">{[1, 2, 3, 4, 5].map((n) => (<button key={n} type="button" className={(ratings[i] || 0) >= n ? 'on' : ''} style={{ padding: 10, margin: -3 }} onClick={() => setRatings((r) => ({ ...r, [i]: n }))}><Icon name="star" size={22} /></button>))}</div>
              </div>
            ) : null))}
            <textarea className="textarea" rows={3} placeholder={lang === 'ar' ? 'اكتب رأيك في الطلب (اختياري)' : 'Write your opinion (optional)'} value={comment} onChange={(e) => setComment(e.target.value)} />
            <button className="btn btn-primary btn-block" disabled={submitting} onClick={submitRatings}>{submitting ? t('saving') : t('submitReview')}</button>
          </div>
        )}
        {rated && <div className="badge badge-success" style={{ justifyContent: 'center', padding: 10 }}><Icon name="check" size={15} /> {t('rated')}</div>}

        {/* venue-level experience rating (writes a VENUE review — itemId null, source 'order') */}
        {canRateVenue && (
          <div className="card card-pad stack rvw-venue-card">
            <strong>{lang === 'ar' ? 'قيّم تجربتك معنا' : 'Rate your experience'}</strong>
            <div className="center" style={{ paddingBlock: 4 }}>
              <div className="stars rvw-venue-stars">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" className={venueStars >= n ? 'on' : ''} style={{ padding: 8 }} onClick={() => setVenueStars(n)} aria-label={`${n}`}>
                    <Icon name="star" size={30} />
                  </button>
                ))}
              </div>
            </div>
            <textarea className="textarea" rows={2} placeholder={lang === 'ar' ? 'أخبرنا عن تجربتك (اختياري)' : 'Tell us about your visit (optional)'} value={venueComment} onChange={(e) => setVenueComment(e.target.value)} />
            <button className="btn btn-primary btn-block" disabled={venueSubmitting} onClick={submitVenueRating}>{venueSubmitting ? t('saving') : t('submitReview')}</button>
          </div>
        )}
        {venueRated && <div className="badge badge-success" style={{ justifyContent: 'center', padding: 10 }}><Icon name="check" size={15} /> {lang === 'ar' ? 'شكراً لك! تم استلام تقييمك' : 'Thank you! Rating received'}</div>}

        {/* after rating: invite the guest to repeat it on Google Maps */}
        {(rated || venueRated) && gmapsHref && (
          <a className="card card-pad row rvw-gmaps-cta" style={{ gap: 10, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}
            href={gmapsHref} target="_blank" rel="noopener noreferrer">
            <Icon name="pin" size={22} style={{ color: 'var(--brand)', flex: 'none' }} />
            <span className="grow">
              <span className="bold small" style={{ display: 'block' }}>{lang === 'ar' ? 'شكراً لتقييمك! قيّمنا على خرائط جوجل' : 'Thanks! Rate us on Google Maps too'}</span>
              <span className="xs faint">{lang === 'ar' ? 'تقييمك هناك يدعمنا كثيراً' : 'Your review there helps a lot'}</span>
            </span>
            <Icon name="next" size={16} className="faint" style={lang === 'ar' ? { transform: 'scaleX(-1)' } : undefined} />
          </a>
        )}

        {/* venue social profiles (only the configured ones) */}
        <SocialLinks social={venue?.social} appearance={venue?.socialStyle} icons={resolveChrome(venue)?.socialIcons} style={{ paddingBlock: 4 }} />

        <Link to={`/m/${slug}`} className="btn btn-outline btn-block">{lang === 'ar' ? 'العودة للمنيو' : 'Back to menu'}</Link>
        <button className="btn btn-ghost btn-block" style={{ color: 'var(--text-muted)' }} onClick={() => setComplaintOpen(true)}>
          <Icon name="complaint" size={16} /> {t('fileComplaint')}
        </button>
      </div>

      <Sheet open={complaintOpen} onClose={() => setComplaintOpen(false)} title={t('fileComplaint')}
        footer={<button className="btn btn-primary btn-lg btn-block" disabled={sendingComplaint || !complaintMsg.trim()} onClick={submitComplaint}>{sendingComplaint ? t('saving') : t('sendComplaint')}</button>}>
        <div className="stack">
          <p className="muted small">{orderNumber(order.code)}{order.tableLabel ? ` · ${order.tableLabel}` : ''}</p>
          <textarea className="textarea" rows={5} placeholder={t('complaintPlaceholder')} value={complaintMsg} onChange={(e) => setComplaintMsg(e.target.value)} />
        </div>
      </Sheet>

      {notifMounted && (
        <Suspense fallback={null}>
          <NotificationSettings open={notifOpen} onClose={() => { setNotifOpen(false); setNotifOn(getPrefs().enabled) }} />
        </Suspense>
      )}
    </div>
  )
}
