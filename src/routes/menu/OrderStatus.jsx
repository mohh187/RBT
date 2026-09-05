import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { resolveSlug, watchOrder, createReview, createComplaint, notifyArrival, getTenant, listItems } from '../../lib/db.js'
import { gamesFor } from '../../lib/games.js'
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
// NotificationSettings -> push.js -> firebase/messaging + installations (~85 kB)
// for a panel most diners never open. Loaded on first open instead; it stays
// mounted afterwards so the sheet keeps its close animation.
const NotificationSettings = lazy(() => import('../../components/NotificationSettings.jsx'))
import WaitGame, { getBestScore } from '../../components/WaitGame.jsx'
import { deviceKey } from '../../lib/device.js'
// heavy/rarely-opened guest overlays
const Leaderboard = lazy(() => import('../../components/Leaderboard.jsx'))
const KitchenTwin = lazy(() => import('../../components/KitchenTwin.jsx'))
const YearWrapped = lazy(() => import('../../components/YearWrapped.jsx'))
// The full games hub, opened by the venue-configured «العب وأنت تنتظر» card.
// It owns the whole flow (registration gate, lobby, scores, rewards) — this
// page only points it at the chosen game via openGameId.
const GamesCenter = lazy(() => import('../../components/GamesCenter.jsx'))

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
  const [gameOpen, setGameOpen] = useState(false)
  const [boardOpen, setBoardOpen] = useState(false)
  const [twinOpen, setTwinOpen] = useState(false)
  const [lastScore, setLastScore] = useState(0)
  const gameDeviceId = deviceKey()
  // «العب وأنت تنتظر» — the venue-chosen waiting game (tenant.waitGame).
  const [waitHub, setWaitHub] = useState(false)
  const [hubItems, setHubItems] = useState([])       // menu items, for the quiz/insight games
  const [readyDismissed, setReadyDismissed] = useState(false)
  const autoPlayRef = useRef(false)                  // ?play=1 hand-off consumed once
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

  // Which game the wait card opens. A venue pick that is still enabled wins;
  // 'auto' (or a pick the venue later disabled) rotates over the enabled list
  // by a hash of the order id — stable for this order, varied across orders.
  const waitGame = useMemo(() => {
    if (venue?.waitGame?.enabled !== true) return null
    const pool = gamesFor(venue)
    if (!pool.length) return null
    const want = venue.waitGame.gameId
    if (want && want !== 'auto') {
      const g = pool.find((x) => x.id === want)
      if (g) return g
    }
    let h = 0
    const s = String(orderId || '')
    for (let i = 0; i < s.length; i += 1) h = ((h * 31) + s.charCodeAt(i)) >>> 0
    return pool[h % pool.length]
  }, [venue, orderId])

  const openWaitHub = () => {
    setWaitHub(true)
    // Menu items feed the taste-quiz/insight games; fetched once, best-effort.
    if (tid) listItems(tid).then((v) => { if (Array.isArray(v) && v.length) setHubItems(v) }).catch(() => { /* games cope with an empty menu */ })
  }

  // Arriving from the in-menu «العب وأنت تنتظر» row (?play=1): open the hub on
  // the chosen game once, then strip the flag so a refresh stays a quiet
  // tracking page. Registration is still the hub's own gate — never skipped.
  useEffect(() => {
    if (autoPlayRef.current || !order || !tid || venue === null) return
    let wants = false
    try { wants = new URLSearchParams(window.location.search).get('play') === '1' } catch (_) { wants = false }
    if (!wants) { autoPlayRef.current = true; return }
    autoPlayRef.current = true
    const settled = ['served', 'paid', 'cancelled', 'refunded']
    if (waitGame && !settled.includes(order.status)) {
      setWaitHub(true)
      listItems(tid).then((v) => { if (Array.isArray(v) && v.length) setHubItems(v) }).catch(() => { /* ditto */ })
    }
    try {
      const u = new URL(window.location.href)
      u.searchParams.delete('play')
      window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`)
    } catch (_) { /* cosmetic only */ }
  }, [order, tid, venue, waitGame])

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
      const [{ customerYear }, { listOrdersSince, listItems }] = await Promise.all([
        import('../../lib/forecast.js'),
        import('../../lib/db.js'),
      ])
      const since = new Date(new Date().getFullYear(), 0, 1)
      const [orders, menu] = await Promise.all([listOrdersSince(tid, since), listItems(tid)])
      const phone = order.customerPhone || getLocalCustomer()?.phone || ''
      const stats = customerYear({ orders: orders || [], customer: { phone }, year: new Date().getFullYear() })
      if (!stats || !stats.hasData) {
        toast.info?.(lang === 'ar' ? 'لم نجد زيارات كافية بعد' : 'Not enough visits yet')
        return
      }
      setWrapItems(menu || [])
      setWrapStats(stats)
    } catch (_) {
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

        {/* «العب وأنت تنتظر» — the venue-configured waiting game (tenant.waitGame).
            Opens the full games hub pointed at the chosen game, so registration,
            scores and rewards are exactly the hub's own. Shown while the kitchen
            still works; once ready, the pickup call matters more than a game. */}
        {waitGame && !cancelled && !paid && currentIdx > -1 && currentIdx < STEPS.indexOf('ready') && (
          <button type="button" className="wg-invite" style={{ background: 'linear-gradient(135deg, #5d3a12, #241505)' }} onClick={openWaitHub}>
            <span className="wg-invite-ico" aria-hidden="true">
              {/* original motif: a domino-ish tile and a gold star, drawn here */}
              <svg viewBox="0 0 48 48" width="30" height="30" role="presentation" focusable="false">
                <rect x="5" y="11" width="25" height="25" rx="7" fill="rgba(255,255,255,.16)" stroke="rgba(255,255,255,.38)" strokeWidth="1.4" />
                <circle cx="13" cy="19" r="2.7" fill="#fff" />
                <circle cx="22" cy="28" r="2.7" fill="#fff" />
                <circle cx="13" cy="28" r="2.7" fill="#fff" opacity=".55" />
                <circle cx="22" cy="19" r="2.7" fill="#fff" opacity=".55" />
                <path d="M37 12l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z" fill="#f2c66d" />
              </svg>
            </span>
            <span className="wg-invite-txt">
              <b>{lang === 'ar' ? 'العب وأنت تنتظر' : 'Play while you wait'}</b>
              <span>
                {lang === 'ar'
                  ? `«${waitGame.ar}» جاهزة لك — نقاط وجوائز من المكان حتى يجهز طلبك`
                  : `"${waitGame.en}" is set for you — points and venue rewards while your order is prepared`}
              </span>
            </span>
          </button>
        )}

        {/* «صياد البحر» — the legacy waiting mini-game, while the kitchen works.
            Venue-togglable; hidden once the venue configured the richer
            tenant.waitGame card above (one invitation, not two). */}
        {!cancelled && currentIdx < STEPS.indexOf('ready') && venue?.waitGameEnabled !== false && !waitGame && (
          <button type="button" className="wg-invite" onClick={() => setGameOpen(true)}>
            <span className="wg-invite-ico"><Icon name="play" size={22} /></span>
            <span className="wg-invite-txt">
              <b>{lang === 'ar' ? 'العب «صياد البحر» أثناء التحضير' : 'Play the fishing game while you wait'}</b>
              <span>{lang === 'ar' ? `اصطد الأسماك واجمع النقاط — أفضل نتيجتك: ${getBestScore(tid)}` : `Catch fish, beat your best: ${getBestScore(tid)}`}</span>
            </span>
          </button>
        )}
        {gameOpen && (
          <WaitGame
            open onClose={() => setGameOpen(false)} tenantId={tid} brand={venue?.brandColor || '#0e7490'}
            onLeaderboard={(score) => { setLastScore(score); setGameOpen(false); setBoardOpen(true) }}
          />
        )}
        {boardOpen && (
          <Suspense fallback={null}>
            <Leaderboard open onClose={() => setBoardOpen(false)} tenantId={tid} lang={lang} myScore={lastScore} deviceId={gameDeviceId} />
          </Suspense>
        )}

        {/* the games hub, opened on the venue's chosen waiting game. It stays
            mounted when the order flips to ready — the strip below announces
            it over the board instead of killing the round mid-move. */}
        {waitHub && waitGame && (
          <Suspense fallback={null}>
            <GamesCenter
              open tenantId={tid} tenant={venue} items={hubItems} lang={lang}
              table={null}
              openGameId={waitGame.id}
              onClose={() => setWaitHub(false)}
            />
          </Suspense>
        )}
        {/* «طلبك جاهز» over the running game: z 480 sits above the hub (330).
            The page toast fires on the flip too; this strip stays until acted
            on, because a toast is gone in seconds and the round is not. */}
        {waitHub && waitGame && !readyDismissed && (order.status === 'ready' || order.status === 'served' || paid) && (
          <div
            role="status"
            style={{
              position: 'fixed', top: 'calc(var(--safe-t, 0px) + 10px)', insetInline: 10, zIndex: 480,
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              borderRadius: 14, background: 'var(--success, #1f9d61)', color: '#fff',
              boxShadow: '0 10px 30px rgba(0,0,0,.35)',
            }}
          >
            <Icon name="bellRing" size={18} style={{ flex: 'none' }} />
            <b className="grow" style={{ fontSize: 13.5, minWidth: 0 }}>
              {lang === 'ar' ? 'طلبك جاهز' : 'Your order is ready'}
            </b>
            <button
              type="button" className="btn btn-sm"
              style={{ background: 'rgba(255,255,255,.18)', color: '#fff', border: 0, flex: 'none' }}
              onClick={() => setWaitHub(false)}
            >
              {lang === 'ar' ? 'عرض الطلب' : 'View order'}
            </button>
            <button
              type="button" className="icon-btn"
              style={{ color: '#fff', flex: 'none' }}
              aria-label={lang === 'ar' ? 'مواصلة اللعب' : 'Keep playing'}
              onClick={() => setReadyDismissed(true)}
            >
              <Icon name="close" size={16} />
            </button>
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
