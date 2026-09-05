import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useI18n, pickLang } from '../lib/i18n.jsx'
import { useToast } from './Toast.jsx'
import Sheet from './Sheet.jsx'
import { usePortalRoot } from './PortalRoot.jsx'
import Icon from './Icon.jsx'
import GalleryZoom from './GalleryZoom.jsx'
import DinerNav from './DinerNav.jsx'
import SocialLinks from './SocialLinks.jsx'
import Stories from './Stories.jsx'
import { glassVars, applyUiFx, clearUiFx } from '../lib/systemThemes.js'
import { EventsSheet, ReserveSheet } from './BookSheets.jsx'
import { Stepper, Empty, Spinner } from './ui.jsx'
import { orderNumber, timeAgo } from '../lib/format.js'
import { Price } from './Riyal.jsx'
import { createOrder, upsertCustomerOnOrder, getCustomerByPhone, getMemberByToken, getMemberByPhone, watchItemReviews, watchOrder, watchDinerNotices, callOrAppend, watchMyWaiterCall, registerCustomer } from '../lib/db.js'
import { CALL_QUICK, intentLabel } from '../lib/waiterCalls.js'
import { tierDiscountAmount, TIER_META, resolveMembershipPolicy } from '../lib/membership.js'
import { evaluateOffers, activeAutoOffers, offerForItem, discountedPrice } from '../lib/offers.js'
import { orderingState, orderingClosedMessage } from '../lib/ordering.js'
import { alertParty } from '../lib/notify.js'
import { initTracking, identify, trackItemView, trackItemClose, trackCartAdd, trackSearch, trackCheckout, trackOrdered, trackGame } from '../lib/track.js'
import ItemFx from './ItemFx.jsx'
import { RANGE, filterCss, BLEND_IDS, resolveWall, resolveButtons, resolveBanner, resolveFeatured, resolveHomeOrder, resolveChrome, resolveInk, inkModeFor, chromeInkVars, imgTiltBoxStyle, resolveMenuHeader } from '../lib/dishComposition.js'
import { useVideoTrim } from '../lib/useVideoTrim.js'
import { MENU_3D_ENABLED } from '../lib/deviceCaps.js'
import GamesIcon from './GamesIcon.jsx'
import { lazyOverlay } from './ErrorBoundary.jsx'
import '../styles/tactile.css'
import '../styles/scrollfix.css'
import { initScrollAffordance } from '../lib/scrollAffordance.js'
// Interactive guest experience — each lazily loaded so a diner who never opens
// them pays no bytes (speech, vision, WebGL and Firestore-session code).
//
// lazyOverlay, NOT React.lazy: a raw lazy() whose chunk fails to arrive
// (offline blip, stale deploy) REJECTS through Suspense into the route
// boundary, which classified it as a stale chunk and reloaded the whole page —
// that was the «الضغط على الألعاب يعيد تحميل الصفحة» bug. lazyOverlay absorbs
// the import (retry + inline error card inside the overlay), shows an instant
// scrim spinner instead of fallback={null}'s dead silence, and isolates render
// crashes to the overlay. 'silent' = ambient widgets that must never flash UI.
const VoiceWaiter = lazyOverlay(() => import('./VoiceWaiter.jsx'), { label: 'voice-waiter' })
const PhotoOrder = lazyOverlay(() => import('./PhotoOrder.jsx'), { label: 'photo-order' })
const VoiceMenuReader = lazyOverlay(() => import('./VoiceMenuReader.jsx'), { label: 'voice-reader' })
const Menu3DWorld = lazyOverlay(() => import('./Menu3DWorld.jsx'), { label: 'menu-3d' })
const CompareItems = lazyOverlay(() => import('./CompareItems.jsx'), { label: 'compare' })
const SharedCart = lazyOverlay(() => import('./SharedCart.jsx'), { label: 'shared-cart' })
const DishStoryReader = lazyOverlay(() => import('./DishStory.jsx'), { label: 'dish-story' })
const GamesCenter = lazyOverlay(() => import('./GamesCenter.jsx'), { label: 'games-center' })
const AdPopup = lazyOverlay(() => import('./AdPopup.jsx'), { label: 'ad-popup', variant: 'silent' })
const VenueMemory = lazyOverlay(() => import('./VenueMemory.jsx'), { label: 'venue-memory', variant: 'silent' })
// tiny sync helpers (no heavy deps) so the item sheet can decide instantly
import { hasStory, StoryBadge } from './DishStory.jsx'
import { getLocalCustomer, setLocalCustomer, isRegisterDismissed, dismissRegister, fetchIp, getMyOrders, addMyOrder, getMemberToken, setMemberToken } from '../lib/customer.js'
import { resolveSkin } from '../lib/skins.js'
import { distanceMeters, getPosition } from '../lib/geo.js'
import { startPayment } from '../lib/payments.js'
import ARViewer from './ARViewer.jsx'
import EditorialLayout, { EditorialItemStage, buttonSkinVars, EditorialRoomBg } from './menuThemes/EditorialLayout.jsx'
import OceanArtLayout from './menuThemes/OceanArtLayout.jsx'
import ChromeSkin from './ChromeSkin.jsx'
import { basePrice, variantHasOwnPrice } from '../lib/pricing.js'
import { orderTypeLabel } from '../lib/orderStatus.js'
import { arPlural } from '../lib/forecast.js'
import { scrollSectionIntoView, scrollSectionToTop, scrollRailIntoView, chromeOffset, stuckOffset } from '../lib/scrollToSection.js'

const resolveItemStyles = (it) => {
  const nameStyle = {}
  const priceStyle = {}
  if (it.nameColor) nameStyle.color = it.nameColor
  if (it.priceColor) priceStyle.color = it.priceColor
  if (it.namePriceStyle === 'bold') {
    nameStyle.fontWeight = '900'
  } else if (it.namePriceStyle === 'glow') {
    const color = it.nameColor || 'var(--brand)'
    nameStyle.textShadow = `0 0 6px ${color}, 0 0 12px ${color}`
    // keep the glow in the shadow only — a hard #fff disappears on light themes
    nameStyle.color = it.nameColor || 'var(--text)'
  } else if (it.namePriceStyle === 'shadow') {
    nameStyle.textShadow = '2px 2px 4px rgba(0,0,0,0.3)'
  } else if (it.namePriceStyle === 'serif') {
    nameStyle.fontFamily = 'serif'
  }
  return { nameStyle, priceStyle }
}

// Shared diner menu + cart + checkout (offers + loyalty + modifiers).
export default function MenuView({ tenant, tenantId, items, categories, offers = [], table, partySize, onPlaced, onCallWaiter, preview = false, previewFocus = null }) {
  const { t, lang, theme, toggleLang, toggleTheme } = useI18n()
  const toast = useToast()
  const currency = tenant?.currency || 'SAR'
  // «يجب أن تظهر كل الأشياء مع فتحة المنيو»: warm the room's critical images
  // (wall, table, header, logo, decor) the instant the tenant doc lands, and
  // the first dishes the instant items land — parallel fetches ahead of the
  // layout mounting, into the SW/HTTP cache, so the room paints assembled
  // instead of piece by piece.
  useEffect(() => {
    if (!tenant) return
    import('../lib/preload.js').then(({ warmImages, tenantCriticalImages }) => warmImages(tenantCriticalImages(tenant))).catch(() => {})
  }, [tenant])
  useEffect(() => {
    if (!items || !items.length) return
    const first = items.slice(0, 8).map((it) => it && it.imageUrl).filter(Boolean)
    import('../lib/preload.js').then(({ warmImages }) => warmImages(first, { priority: 2 })).catch(() => {})
  }, [items])
  // The active skin's menu layout drives how items are presented (Phase 2).
  const menuLayout = resolveSkin(tenant, 'menu')?.layout?.menuLayout || 'list'
  const catNav = tenant?.catNavStyle || resolveSkin(tenant, 'menu')?.layout?.nav || 'chips' // category-bar style (chips/tabs/pill/segmented) — venue override wins
  // Display-only menu: browsing + customer registration, no ordering. Any add
  // attempt nudges the guest to register for notifications instead.
  const orderingEnabled = tenant?.menuMode !== 'browse'
  // Waiter call: table context + venue toggle (on by default for table QRs).
  const waiterEnabled = tenant?.waiterCallEnabled !== false
  const [waiterOpen, setWaiterOpen] = useState(false)
  const [waiterNote, setWaiterNote] = useState('')
  const [waiterBusy, setWaiterBusy] = useState(false)
  // Which quick chip was tapped — the STABLE code, not its label. Typing in the
  // textarea clears it, because free text is its own intent.
  const [waiterIntent, setWaiterIntent] = useState('')
  // THE GUEST'S OWN CALL, held by id.
  //
  // Kept on the device rather than found by query: a diner cannot `list`
  // waiterCalls, and a rule cannot inspect a where() clause, so "my table's open
  // call" is not something the server can answer. The id we were handed is, and
  // it survives a reload — a guest who refreshes still sees their call is live.
  const callKey = tenantId && table?.id ? `rbt_call_${tenantId}_${table.id}` : ''
  const [myCallId, setMyCallId] = useState(() => {
    try { return callKey ? localStorage.getItem(callKey) || '' : '' } catch (_) { return '' }
  })
  const [myCall, setMyCall] = useState(null)
  useEffect(() => {
    if (!tenantId || !myCallId || !waiterEnabled) { setMyCall(null); return undefined }
    return watchMyWaiterCall(tenantId, myCallId, setMyCall)
  }, [tenantId, myCallId, waiterEnabled])
  // Once the floor marks it done the watcher reports null — drop the id so the
  // next call starts a fresh one instead of trying to append to a closed record.
  useEffect(() => {
    if (myCallId && myCall === null && callKey) {
      try { localStorage.removeItem(callKey) } catch (_) { /* ignore */ }
      setMyCallId('')
    }
  }, [myCall, myCallId, callKey])
  const motion = resolveSkin(tenant, 'menu')?.motion || 'fade-up' // item animation (data-motion)
  const motionSpeed = resolveSkin(tenant, 'menu')?.motionSpeed || 'normal'
  const motionRepeat = resolveSkin(tenant, 'menu')?.motionRepeat || 'always' // once | always | 2 | 3 …
  const tap = resolveSkin(tenant, 'menu')?.tap || 'press' // touch/press interaction (data-tap)
  // Sticky bars sit under the app bar — unless the skin drops it (header 'none'),
  // in which case --appbar-h (56px global) would leave a gap content scrolls through.
  const skinHeader = resolveSkin(tenant, 'menu')?.layout?.header || 'classic'
  // The sticky offset of every category bar. It CANNOT be a fixed expression:
  // below 980px the window scrolls and the app bar sits inside the same flow, so
  // the bar must clear it; at >= 980px the scroller is the layout element and the
  // app bar is OUTSIDE that scrollport, so the same offset double-counts it and
  // parks the bar 56px too low — floating in mid-page with content sliding
  // underneath, which is exactly what the owner saw. The value is therefore a CSS
  // variable that the breakpoint zeroes (see .venue-above in index.css).
  const stickyTop = skinHeader === 'none' ? 'var(--menu-sticky-top-nohdr)' : 'var(--menu-sticky-top)'
  const rootRef = useRef(null)
  const menuPortalRoot = usePortalRoot()
  // Menu-glass level ('chrome' = bars only, 'full' = cards/buttons/icons/sheets).
  // Mirrored onto the portal root (body on the live site, the preview frame in
  // the studio) so PORTALED sheets — cart, notifications, item detail — pick
  // the glass up too, along with the menu-scope glass sliders (glassFxBy.menu).
  const menuGlassLvl = tenant?.menuGlass === 'full' ? 'full' : tenant?.menuGlass ? 'chrome' : null
  const menuGlassFx = JSON.stringify([tenant?.menuGlass || null, tenant?.glassFx || null, tenant?.glassFxBy || null, tenant?.btnFx || null])
  useEffect(() => {
    const node = menuPortalRoot
    if (!node) return undefined
    // venue button style (gradient/glow) follows onto the diner menu's CTAs
    // The TENANT, not a hand-picked slice of it.
    //
    // This used to pass a literal `{ btnFx: tenant?.btnFx }`, so applyUiFx never
    // saw `selColor`, took its else branch, and REMOVED `--sel` from the menu
    // root on every render. The Settings card promises that colour applies «في
    // كل النظام» — it reached every surface except the one the guest sees.
    applyUiFx(node, tenant)
    if (menuGlassLvl) {
      node.setAttribute('data-menuglass', menuGlassLvl)
      const vars = glassVars(tenant, 'menu')
      Object.entries(vars).forEach(([k, v]) => node.style.setProperty(k, v))
    }
    return () => {
      node.removeAttribute('data-menuglass')
      ;['--glass-alpha', '--glass-blur', '--glass-sat'].forEach((k) => node.style.removeProperty(k))
      clearUiFx(node)
    }
  }, [menuPortalRoot, menuGlassLvl, menuGlassFx]) // eslint-disable-line react-hooks/exhaustive-deps
  // OceanArt: mirror the venue art tone onto the portal root so PORTALED
  // sheets (item detail, cart) inherit the blue-canvas styling ([data-oa-tone] CSS).
  useEffect(() => {
    const node = menuPortalRoot
    if (!node || menuLayout !== 'oceanart') return undefined
    node.setAttribute('data-oa-tone', tenant?.artBgTone || 'deepblue')
    return () => node.removeAttribute('data-oa-tone')
  }, [menuPortalRoot, menuLayout, tenant?.artBgTone])
  const heroRef = useRef(null) // storefront hero scroller (for the thumbnail strip)
  const [heroIdx, setHeroIdx] = useState(0)
  const SHOWCASE_LAYOUTS = ['cards', 'grid', 'gallery', 'bento', 'catalog', 'plates', 'coffeepan']
  // The list/grid toggle only makes sense where both views fit; hidden otherwise.
  const showViewToggle = ['list', 'cards', 'grid'].includes(menuLayout)
  // Read user details style override if set, otherwise fallback to skin default layout rules.
  // 'editorial' gets its own FLIP photo-expand stage; 'oceanart' reuses the immersive sheet (re-skinned via [data-oa-tone]).
  const itemDetail = resolveSkin(tenant, 'menu')?.detailLayout
    || (menuLayout === 'editorial' ? 'editorial' : ['plates', 'gallery', 'spotlight', 'oceanart'].includes(menuLayout) ? 'immersive' : 'sheet')
  // Elements the venue chose to hide for this surface (events, search, …).
  const hiddenEls = resolveSkin(tenant, 'menu')?.hidden || []
  const isHidden = (k) => hiddenEls.includes(k)

  // ---- the venue's room dials -----------------------------------------------
  // Everything below is opt-in with null/0 defaults, so an untouched venue
  // renders byte-identically. Fingerprint memos (JSON keys) follow the theme's
  // own wallKey/btnKey pattern so streamed studio snapshots never rebuild the
  // expensive paints per slider tick.
  const edtWallKey = JSON.stringify(tenant?.menuWall || null)
  // Room mode derives from the RESOLVED wall — null for pattern 'none' and for
  // 'image' without a url — never from raw pattern truthiness, or data-room
  // would stamp fixed light hero ink with no room behind it.
  // The WALL resolves on every layout, because the button face is painted from
  // it (buttonSkinVars(btn, wall)) and the chips now wear that face everywhere.
  // Gating the wall too would have handed every non-editorial venue the generic
  // #8a4a2c fallback instead of its own clay.
  const edtWall = useMemo(() => resolveWall(tenant), [edtWallKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // ROOM MODE STAYS EDITORIAL-ONLY, and this gate is load-bearing — not
  // tidiness. `data-room` drives fixed light hero ink through rules that target
  // .menu-hero-body / .menu-hero-title / .special-head strong, and those
  // elements exist on EVERY layout. Stamping it without the dark room behind it
  // would put pale text on a pale page.
  const roomOn = menuLayout === 'editorial' && !!(edtWall && edtWall.room)
  const banner = resolveBanner(tenant)
  const featured = resolveFeatured(tenant)
  // The true-transparency banner melt: bannerMelt > 0 replaces the painted
  // .menu-hero-fade with a mask on the media wrapper, revealing whatever runs
  // behind the banner (the room wall). bannerFadeDir is honoured — 'top' ramps
  // upward, 'both' ramps both edges, anything else (including 'none': the
  // owner opted into the melt explicitly) ramps toward the bottom.
  const meltStyle = useMemo(() => {
    if (!(banner.melt > 0)) return null
    const hold = Math.max(0, 100 - banner.meltLen)
    const edge = `rgba(0, 0, 0, ${(1 - banner.melt).toFixed(3)})`
    const dir = tenant?.bannerFadeDir === 'top' ? 'top' : tenant?.bannerFadeDir === 'both' ? 'both' : 'bottom'
    const half = banner.meltLen / 2
    const mask = dir === 'both'
      ? `linear-gradient(to bottom, ${edge} 0%, #000 ${Math.min(50, half)}%, #000 ${Math.max(50, 100 - half)}%, ${edge} 100%)`
      : `linear-gradient(to ${dir}, #000 0%, #000 ${hold}%, ${edge} 100%)`
    return { WebkitMaskImage: mask, maskImage: mask }
  }, [banner.melt, banner.meltLen, tenant?.bannerFadeDir]) // eslint-disable-line react-hooks/exhaustive-deps
  // The exp-bar wears the venue button skin ON EVERY LAYOUT.
  //
  // It used to be gated to `editorial`, which meant the whole menuButtons
  // feature — normaliser, painter, and a full admin editor with a live preview —
  // was unreachable for fifteen of the sixteen layouts. An owner styled the
  // games button, saved, and saw nothing change.
  //
  // Safe to ungate because absence still means absence: BUTTON_DEFAULTS.skin is
  // '' and resolveButtons returns null for it, so a venue that never opened the
  // editor renders byte-identically. Only venues that deliberately chose a skin
  // move. buttonSkinVars is the editorial theme's own painter, so the two faces
  // cannot drift apart.
  const edtBtnKey = JSON.stringify(tenant?.menuButtons || null)
  const edtBtn = useMemo(() => resolveButtons(tenant), [edtBtnKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const edtBtnVars = useMemo(() => (edtBtn ? buttonSkinVars(edtBtn, edtWall) : null), [edtBtn, edtWall])
  // Tenant-ordered home blocks (tenant.menuHome.order; absent = today's order).
  const homeKey = JSON.stringify(tenant?.menuHome || null)
  const homeOrder = useMemo(() => resolveHomeOrder(tenant), [homeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // Menu chrome: custom bell icon + per-platform social icons resolve here;
  // the faces themselves ride ChromeSkin's body vars.
  const chromeKey = JSON.stringify(tenant?.menuChrome || null)
  const mch = useMemo(() => resolveChrome(tenant), [chromeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // Pre-menu ink lock: while the light flip is a lie (configured wall, no
  // venue light inks) the root pins the dark token set for the zone ABOVE
  // .edt-wrap too — index.css guards its light [data-menu-layout='editorial']
  // block with :not([data-edt-dark]). Same condition the theme stamps.
  const edtDarkRoot = menuLayout === 'editorial' && theme !== 'dark' && inkModeFor(tenant, theme) === 'dark'
  // Banner video trim window (tenant.bannerVideoTrim) — the hook lives at TOP
  // level (Rules of Hooks); the <video> itself renders inside an IIFE below.
  const bannerTrimRef = useVideoTrim(tenant?.bannerVideoTrim)
  // «ألوان الخطوط» bar inks: chromeInkVars stamped on the portal root so the
  // app bar + bottom nav + portalled kin read the venue's per-mode bar
  // colours. Cleanup mirrors the clearChrome discipline — the exact key list
  // is captured and removed one by one, so nothing leaks into staff shells.
  // Deps carry a menuWall fingerprint because inkModeFor()'s automatic dark
  // lock derives from the resolved wall (a streamed wall change must re-run).
  const inkKeyMv = JSON.stringify(tenant?.menuInk || null)
  const inkWallKeyMv = JSON.stringify([tenant?.menuWall?.pattern || '', tenant?.menuWall?.url || ''])
  useEffect(() => {
    const node = menuPortalRoot
    if (!node) return undefined
    const ink = resolveInk(tenant)
    const vars = ink ? chromeInkVars(ink[inkModeFor(tenant, theme)]) : null
    if (!vars) return undefined
    const keys = Object.keys(vars)
    keys.forEach((k) => node.style.setProperty(k, vars[k]))
    return () => keys.forEach((k) => node.style.removeProperty(k))
  }, [menuPortalRoot, inkKeyMv, inkWallKeyMv, theme]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- per-venue share + install identity ------------------------------------
  // The server shell (functions/venueMeta.js via the /m/** rewrite) already
  // carries these for crawlers; this effect keeps the LIVE document in sync
  // after hydration/SPA navigation so the tab title, share sheets and
  // "Add to Home Screen" all present the VENUE, never the platform.
  useEffect(() => {
    if (preview || !tenant?.name || typeof document === 'undefined') return undefined
    const prevTitle = document.title
    document.title = tenant.name
    const ensure = (sel, make) => {
      let el = document.head.querySelector(sel)
      if (!el) { el = make(); document.head.appendChild(el) }
      return el
    }
    const setLinkTag = (rel, href) => ensure(`link[rel="${rel}"]`, () => {
      const l = document.createElement('link'); l.setAttribute('rel', rel); return l
    }).setAttribute('href', href)
    const setOg = (prop, content) => ensure(`meta[property="${prop}"]`, () => {
      const mEl = document.createElement('meta'); mEl.setAttribute('property', prop); return mEl
    }).setAttribute('content', content)
    // manifest -> the server endpoint (prod only: vite dev has no functions
    // rewrite, where pwa.js's blob manifest already covers install)
    if (tenant.slug && import.meta.env.PROD) setLinkTag('manifest', `/m/${encodeURIComponent(tenant.slug)}/manifest.webmanifest`)
    if (tenant.logoUrl) setLinkTag('apple-touch-icon', tenant.logoUrl)
    // og fallback for JS-running share surfaces (crawlers get the server tags)
    setOg('og:title', tenant.name)
    if (tenant.descAr) setOg('og:description', tenant.descAr)
    const ogImg = tenant.coverUrl || tenant.logoUrl
    if (ogImg) setOg('og:image', ogImg)
    return () => { document.title = prevTitle }
  }, [preview, tenant?.name, tenant?.slug, tenant?.logoUrl, tenant?.coverUrl, tenant?.descAr])

  const navigate = useNavigate()
  const [activeCat, setActiveCat] = useState('all')
  // Picking a category SCROLLS to it instead of cutting the list (see the
  // visibleItems note): the diner lands on that section's first dish and can
  // keep scrolling straight into the next one, exactly like a paper menu.
  const pickCat = (id) => {
    setActiveCat(id)
    requestAnimationFrame(() => {
      try {
        // Not every layout HAS a sticky chip bar: the sidebar skin navigates
        // from a vertical rail, storefront and spotlight carry their own. When
        // there is no bar to measure, the chrome height is measured directly —
        // otherwise the jump aims at viewport zero and parks the dish behind
        // the fixed app bar.
        const bar = document.querySelector('.cat-bar, .cat-circles, .spot-cats') || chromeOffset()
        // «All» goes home. Start the walk from the menu root, not document.body:
        // at >= 980px the root IS the scroller and body is not, and the walk
        // stops AT body — which is how «all» used to move nothing on desktop.
        if (!id || id === 'all') {
          scrollSectionToTop(typeof bar === 'number' ? (document.querySelector('[data-menu-layout]') || document.body) : bar)
          return
        }
        const first = allActive.find((i) => i.categoryId === id)
        if (!first) return
        const el = document.querySelector(`[data-item-id="${CSS.escape(String(first.id))}"]`)
        if (!el) return
        // The gallery skin lays each category out as a horizontal rail, so the
        // dish can be the right section but parked off to the side — a rail
        // the diner scrolled earlier stays where they left it. Move the rail
        // first, then correct vertically (the vertical pass re-measures, so it
        // absorbs whatever the rail move shifted).
        scrollRailIntoView(el)
        // NOT window.scrollTo: at >= 980px the menu layout element is the
        // scroller, not the window, so the manual maths moved nothing at all.
        scrollSectionIntoView(el, bar)
      } catch (_) { /* a browser without scrollIntoView options still lights the chip */ }
    })
  }
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState(SHOWCASE_LAYOUTS.includes(menuLayout) ? 'gallery' : 'list')
  // Follow the skin's layout (so switching themes in the live preview re-renders).
  useEffect(() => { setViewMode(SHOWCASE_LAYOUTS.includes(menuLayout) ? 'gallery' : 'list') }, [menuLayout]) // eslint-disable-line react-hooks/exhaustive-deps
  const [viewItem, setViewItem] = useState(null)
  // The cart line this detail was opened FROM (tap on a cart row). It seeds the
  // detail with the line's qty/variant/mods — without it the sheet opened at
  // qty 1 «كأنني لم أطلبه» — and flips the add into a REPLACE of that line.
  const [viewLine, setViewLine] = useState(null)
  // editorial detail: viewport rect of the tapped photo — the FLIP animation origin.
  const [openRect, setOpenRect] = useState(null)
  const [cart, setCart] = useState([])
  const [cartOpen, setCartOpen] = useState(false)
  // Interactive-experience overlays (venue-togglable in Settings; each defaults
  // ON so a fresh venue demos fully, and each closes back to the menu).
  const [fxOpen, setFxOpen] = useState('') // '' | voice | photo | read | world | compare | table | games
  const [storyItem, setStoryItem] = useState(null)
  // An invited guest lands on the menu carrying the room to open.
  // This initialiser only READS. It used to also strip the params from the URL,
  // which is why an invited guest ended up staring at the menu instead of the
  // board: a useState initialiser must be pure, because React runs it twice
  // under StrictMode and may throw a render away entirely. When that happened
  // the URL had already been rewritten, so the second, surviving mount saw no
  // room at all and the hub never opened. The strip now lives in the effect
  // below, after the hub has actually been told to open.
  const [joinRoom] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search)
      return { room: q.get('room') || '', game: q.get('game') || '' }
    } catch (_) { return { room: '', game: '' } }
  })
  const [savedCustomer, setSavedCustomer] = useState(() => getLocalCustomer())
  const [regOpen, setRegOpen] = useState(false)
  const [regDismissed, setRegDismissed] = useState(() => isRegisterDismissed(tenantId))
  // VIP member: identified via the card token (?m=…) OR a token remembered on this device.
  const [memberCard, setMemberCard] = useState(null)
  useEffect(() => {
    if (!tenantId) return
    let token = ''
    try { token = new URLSearchParams(window.location.search).get('m') || '' } catch (_) { /* ignore */ }
    if (!token) token = getMemberToken(tenantId)
    if (!token) { setMemberCard(null); return }
    let alive = true
    getMemberByToken(tenantId, token).then((c) => {
      if (!alive) return
      if (c?.active) { setMemberCard(c); setMemberToken(tenantId, token) } // remember for next visit
      else { setMemberCard(null); if (c && !c.active) setMemberToken(tenantId, '') }
    }).catch(() => {})
    return () => { alive = false }
  }, [tenantId])

  // order type: dine_in (في المكان) · pickup (استلام) · curbside (سيارة). For a table → dine_in.
  const curbsideEnabled = tenant?.curbsideEnabled === true
  // Public menu (no table) = external orders only (takeaway / curbside / delivery).
  const deliveryEnabled = tenant?.delivery?.enabled === true && !table && !preview
  const [orderType, setOrderType] = useState(table ? 'dine_in' : 'pickup')
  const [car, setCar] = useState({ model: '', color: '', plate: '' })
  const [typeGateOpen, setTypeGateOpen] = useState(!table && !preview)

  // this device's own order history + live status + "ready" notifications
  const myOrderRefs = useMemo(() => getMyOrders(tenantId), [tenantId])
  const [orderDocs, setOrderDocs] = useState({})
  const [ordersOpen, setOrdersOpen] = useState(false)
  const [eventsOpen, setEventsOpen] = useState(false)
  const [offersOpen, setOffersOpen] = useState(false)
  const [reserveOpen, setReserveOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const seenKey = `dinerNotifSeen_${tenantId}`
  const [lastSeen, setLastSeen] = useState(() => { try { return Number(localStorage.getItem(seenKey)) || 0 } catch (_) { return 0 } })
  const [notices, setNotices] = useState([])
  const prevStatusRef = useRef({})

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      if (sp.get('cart') === '1') {
        setCartOpen(true)
        const url = new URL(window.location)
        url.searchParams.delete('cart')
        window.history.replaceState({}, '', url)
      }
    } catch (_) {}
  }, [])

  useEffect(() => {
    if (!tenantId || myOrderRefs.length === 0) return
    const unsubs = myOrderRefs.map((o) => watchOrder(tenantId, o.id, (doc) => {
      if (!doc) return
      setOrderDocs((m) => ({ ...m, [o.id]: doc }))
      const prev = prevStatusRef.current[o.id]
      if (prev && prev !== doc.status && doc.status === 'ready') {
        alertParty({ title: lang === 'ar' ? 'طلبك جاهز' : 'Order ready', body: orderNumber(doc.code), tag: 'ready', url: tenant?.slug ? `/order/${tenant.slug}/${o.id}` : '/' })
      }
      prevStatusRef.current[o.id] = doc.status
    }))
    return () => unsubs.forEach((u) => u && u())
  }, [tenantId, myOrderRefs, lang, tenant])

  useEffect(() => {
    if (!tenantId || preview) return
    return watchDinerNotices(tenantId, setNotices)
  }, [tenantId, preview])

  const readyCount = Object.values(orderDocs).filter((d) => d && d.status === 'ready').length

  // Durable diner notifications derived from each watched order's statusHistory —
  // survives refresh/reopen (unlike the old in-memory, 'ready'-only push).
  const notifItems = useMemo(() => {
    const meaningful = { accepted: 1, preparing: 1, ready: 1, served: 1, paid: 1, cancelled: 1 }
    const out = []
    Object.values(orderDocs).forEach((doc) => {
      if (!doc) return
      ;(Array.isArray(doc.statusHistory) ? doc.statusHistory : []).forEach((h) => {
        // Skip staff-edit entries (addItems/qty/void re-append the CURRENT status
        // with an `edit` tag) — else editing an order spawns a phantom duplicate
        // notification. Key by `at` too so genuine repeats never collide.
        if (meaningful[h.status] && h.at && !h.edit) out.push({ type: 'order', key: `o-${doc.id}-${h.status}-${h.at}`, orderId: doc.id, code: doc.code, status: h.status, at: h.at })
      })
    })
    ;(notices || []).forEach((n) => {
      const at = n.createdAt?.toMillis?.() || 0
      if (at) out.push({ type: 'notice', key: `n-${n.id}`, id: n.id, title: n.title, body: n.body, at })
    })
    return out.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 40)
  }, [orderDocs, notices])
  const unreadCount = notifItems.filter((n) => (n.at || 0) > lastSeen).length
  const markAllRead = () => { const now = Math.max(Date.now(), ...notifItems.map((n) => n.at || 0), 0); setLastSeen(now); try { localStorage.setItem(seenKey, String(now)) } catch (_) { /* ignore */ } }

  // The device's most recent STILL-ACTIVE order → a persistent "track your order"
  // banner so a returning diner (re-scan / re-open) lands back on their order
  // instead of a fresh menu. A different phone has its own localStorage = fresh.
  const activeOrder = useMemo(() => {
    const SETTLED = ['paid', 'served', 'cancelled', 'refunded']
    for (const ref of myOrderRefs) {
      const d = orderDocs[ref.id]
      if (d && !SETTLED.includes(d.status)) return { id: ref.id, code: d.code || ref.code, status: d.status }
    }
    return null
  }, [myOrderRefs, orderDocs])
  const ORDER_ST = {
    pending: [lang === 'ar' ? 'بانتظار القبول' : 'Pending', 'orders'],
    accepted: [lang === 'ar' ? 'تم القبول' : 'Accepted', 'check'],
    preparing: [lang === 'ar' ? 'قيد التحضير' : 'Preparing', 'kitchen'],
    ready: [lang === 'ar' ? 'طلبك جاهز' : 'Ready', 'bell'],
  }

  const sortedCats = useMemo(() => [...(categories || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)), [categories])
  // Time-windowed items (breakfast 06:00-11:30 …): outside the window the item
  // vanishes from the menu entirely. Window may wrap midnight (22:00-03:00).
  // A minute tick re-evaluates so the switch happens live without a reload.
  const [clockTick, setClockTick] = useState(0)
  useEffect(() => {
    const hasWindows = (items || []).some((i) => i.availableFrom && i.availableTo)
    if (!hasWindows) return undefined
    const iv = setInterval(() => setClockTick((t) => t + 1), 60000)
    return () => clearInterval(iv)
  }, [items])
  const inTimeWindow = (i) => {
    if (!i.availableFrom || !i.availableTo) return true
    const parse = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
    const from = parse(i.availableFrom); const to = parse(i.availableTo)
    if (from == null || to == null) return true
    const d = new Date(); const cur = d.getHours() * 60 + d.getMinutes()
    return from <= to ? (cur >= from && cur < to) : (cur >= from || cur < to)
  }
  // clockTick is a real dep: the minute tick must recompute time-windowed items,
  // otherwise a scheduled item never appears/vanishes without a manual reload.
  const allActive = useMemo(() => (items || []).filter((i) => i.active !== false && inTimeWindow(i)), [items, clockTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const matchSearch = (i, q) => `${i.nameAr} ${i.nameEn}`.toLowerCase().includes(q)

  // TWO RULES, and they used to fight each other because both lived here:
  //
  // 1. A CATEGORY IS A DESTINATION, NOT A CAGE. Picking one used to hard-filter
  //    the list to that category, so the diner was locked inside it and could
  //    not keep scrolling into the next section the way a paper menu works. The
  //    list now always holds the whole menu; picking a category SCROLLS to it
  //    (each layout does the scrolling, see the chip handlers) and the chip
  //    stays lit through the scroll-spy.
  //
  // 2. SEARCH IS ALWAYS GLOBAL. The query used to be applied AFTER the category
  //    filter, so searching while a category was open could only ever match
  //    inside that category — the item you were looking for simply did not
  //    exist as far as the search was concerned. A query now ignores the open
  //    category entirely and looks at the whole menu.
  //
  // 3. THE ORDER IS THE MENU'S OWN ORDER. sortOrder is numbered PER CATEGORY —
  //    every category has its own item 0, item 1, item 2 — so sorting the flat
  //    list by sortOrder alone interleaved them: every category's first dish,
  //    then every category's second. That is what made the immersive sheet's
  //    prev/next jump between sections instead of walking a section through,
  //    and it shuffled the flat layouts (storefront / showcase / list) too.
  //    Sorting by (category position, then sortOrder) reads the menu the way
  //    the page renders it and the way the eye moves down it.
  const catRank = useMemo(() => {
    const m = new Map()
    sortedCats.forEach((c, i) => m.set(c.id, i))
    return m
  }, [sortedCats])
  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q ? allActive.filter((i) => matchSearch(i, q)) : allActive
    // Uncategorised dishes sit after every real category rather than at the top.
    const rank = (i) => (catRank.has(i.categoryId) ? catRank.get(i.categoryId) : Number.MAX_SAFE_INTEGER)
    return [...list].sort((a, b) => (rank(a) - rank(b)) || ((a.sortOrder || 0) - (b.sortOrder || 0)))
  }, [allActive, search, catRank])

  const itemsByCat = useMemo(() => {
    const map = {}
    allActive.forEach((i) => { const k = i.categoryId || '_uncat'; (map[k] = map[k] || []).push(i) })
    Object.values(map).forEach((arr) => arr.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)))
    return map
  }, [allActive])

  // Featured strip. Two modes the venue controls:
  //  • 'manual' (default): the items it flagged (item editor → featured), in order.
  //  • 'auto': the system ranks by real popularity (soldCount, maintained server-side
  //    on every paid/placed order) and shows the current best-sellers.
  // Either mode falls back to flagged→photo'd items so the strip is never empty.
  const featuredMode = tenant?.featuredMode === 'auto' ? 'auto' : 'manual'
  const featuredCount = Math.min(12, Math.max(4, Number(tenant?.featuredCount) || 8))
  const special = useMemo(() => {
    const base = allActive.filter((i) => i.available !== false)
    const flagged = base.filter((i) => i.featured)
    const photod = base.filter((i) => i.imageUrl)
    if (featuredMode === 'auto') {
      const ranked = [...base].filter((i) => (Number(i.soldCount) || 0) > 0).sort((a, b) => (Number(b.soldCount) || 0) - (Number(a.soldCount) || 0))
      if (ranked.length) return ranked.slice(0, featuredCount)
    }
    return (flagged.length ? flagged : photod).slice(0, featuredCount)
  }, [allActive, featuredMode, featuredCount])
  const promos = useMemo(() => activeAutoOffers(offers).filter((o) => o.type === 'percent' || o.type === 'fixed'), [offers])
  // Items currently carrying an active offer (for the offers browser + strike-through prices).
  const offeredItems = useMemo(() => allActive.map((it) => ({ it, offer: offerForItem(it, offers) })).filter((x) => x.offer), [allActive, offers])
  const hasOffers = promos.length > 0 || offeredItems.length > 0

  // Reveal each item card as it scrolls into view → the motion plays on entry AND re-plays every time it re-enters
  // (down & up), up to the chosen repeat count. 'always' = every scroll; 'once' = first time only; '2'/'3' = N times.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !rootRef.current) return
    const els = rootRef.current.querySelectorAll('.food-card, .showcase-card, .store-card, .special-card, .store-hero-item, .cl-row')
    if (!els.length) return
    const limit = motionRepeat === 'always' ? Infinity : (motionRepeat === 'once' ? 1 : (Number(motionRepeat) || 1))
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const el = e.target
        const c = Number(el.dataset.ac || 0)
        if (e.isIntersecting) {
          el.classList.add('in-view')
          if (c < limit) el.dataset.ac = String(c + 1)
        } else if (c < limit) {
          el.classList.remove('in-view') // allow it to replay next time it scrolls back in
        }
      })
    }, { threshold: 0.04 })
    els.forEach((el) => { el.dataset.ac = '0'; io.observe(el) })
    return () => io.disconnect()
  }, [menuLayout, motion, motionSpeed, motionRepeat, activeCat, viewMode, search, visibleItems, items])

  // When a search starts, bring the search bar into view — but ONLY if it is
  // actually off-screen. Scrolling the whole page every keystroke-that-starts-a-
  // search lurched the viewport even when the bar was already visible, which
  // reads as a web page jumping under you rather than an app. Scroll only to
  // recover a bar that has scrolled above the fold.
  const searching = search.trim().length > 0
  useEffect(() => {
    if (!searching) return
    const el = document.getElementById('m-search')
    if (!el) return
    const top = el.getBoundingClientRect().top
    // Already in view (within the sticky header zone)? Leave the viewport alone.
    if (top >= 0 && top < 140) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [searching])

  const cartCount = cart.reduce((s, l) => s + l.qty, 0)
  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0)

  // Category rails and chip strips in the menu get the same overflow reveal.
  useEffect(() => initScrollAffordance(document.body), [])

  // «ذاكرة المكان»: computed only for a guest we actually know (a saved phone
  // or remembered orders), on demand, and never for the admin preview. The
  // engine returns an empty list when it has nothing true to say.
  const [memoryLines, setMemoryLines] = useState([])
  useEffect(() => {
    if (preview || !tenantId) return undefined
    const phone = savedCustomer?.phone || ''
    const mine = getMyOrders(tenantId) || []
    if (!phone && mine.length < 2) return undefined // a stranger gets no "welcome back"
    let alive = true
    ;(async () => {
      try {
        const [{ recallFor }, { getOrder }] = await Promise.all([
          import('../lib/venueMemory.js'),
          import('../lib/db.js'),
        ])
        // Per-id reads, NOT a collection query: firestore.rules allow a diner
        // `get` on one order but deny `list` (staff-only), so listOrdersSince
        // was permission-denied for every guest and this never once ran.
        const cutoff = Date.now() - 365 * 86400000
        const fetched = await Promise.all(
          mine.filter((m) => m.id && (m.at || 0) >= cutoff).slice(0, 10).map((m) => getOrder(tenantId, m.id).catch(() => null)),
        )
        if (!alive) return
        const lines = recallFor({
          orders: fetched.filter(Boolean),
          items,
          tenant,
          customer: { phone, name: savedCustomer?.name || '' },
          now: Date.now(),
        })
        setMemoryLines(Array.isArray(lines) ? lines.slice(0, 3) : [])
      } catch (_) { /* recognition is a bonus, never a blocker */ }
    })()
    return () => { alive = false }
    // `items` / `tenant` are READ but not tracked by identity: both re-emit on
    // every staff edit while a diner has the menu open, and this used to refire
    // the whole lookup each time. items.length is enough to catch the first load.
  }, [tenantId, preview, savedCustomer?.phone, items?.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // An invite link opens the games hub straight away — the guest came for the
  // board, not the menu. Stripping the params happens HERE, once the hub is
  // open, so the URL is only rewritten after the handover actually succeeded
  // (and a refresh still does not re-enter a finished game).
  useEffect(() => {
    if (!joinRoom.room || !joinRoom.game) return
    setFxOpen('games')
    try {
      const q = new URLSearchParams(window.location.search)
      if (!q.has('room') && !q.has('game')) return
      q.delete('room'); q.delete('game')
      const rest = q.toString()
      window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''))
    } catch (_) { /* the hub is already open; a tidy URL is cosmetic */ }
  }, [joinRoom])

  // Behaviour tracking: one session per visit, batched writes, no-op when the
  // venue turned analytics off or when this is an admin preview.
  useEffect(() => {
    if (!tenantId || preview) return undefined
    initTracking(tenantId, {
      enabled: tenant?.analyticsEnabled !== false,
      table: table?.label || table?.id || null,
      source: table?.id ? 'table-qr' : 'direct',
    })
    return undefined
  }, [tenantId, preview, tenant?.analyticsEnabled, table])

  // Item dwell: opening an item starts its timer, closing/switching ends it —
  // this is what makes «شاهدوه ولم يطلبوه» measurable.
  const lastViewed = useRef(null)
  useEffect(() => {
    if (preview) return undefined
    if (lastViewed.current && lastViewed.current !== viewItem) trackItemClose(lastViewed.current)
    if (viewItem) trackItemView(viewItem)
    lastViewed.current = viewItem || null
    return undefined
  }, [viewItem, preview])

  // The studio/editor preview steers which dish is on screen (preview only).
  // SPLIT into two effects on purpose: the scroll effect keys on the focus
  // identity alone, so the fresh focus clone every postMessage tick brings
  // never re-scrolls under the owner's wheel; the stage-follow effect keys on
  // `items` too, so the OPEN stage keeps tracking the streamed draft live —
  // freezing on the first draft was the exact complaint this serves.
  useEffect(() => {
    if (!preview || !previewFocus || !previewFocus.itemId || previewFocus.view === 'stage') return undefined
    setViewItem(null); setOpenRect(null)
    // RETRY until the row exists, instead of one shot at 80ms.
    // The frame announces itself ready the moment PreviewMenu mounts, which is
    // BEFORE Firestore has delivered the items, so the single attempt queried an
    // empty list, found nothing, and never looked again: the owner got the TOP
    // of the menu on first open and the right dish only after switching tabs.
    // Bounded at ~5s and it returns on the first hit, so it cannot spin. Note
    // this stays out of the `items` dependency deliberately (see above): a
    // keystroke in the editor streams a new items array, and re-scrolling on
    // every one of those is the behaviour the split was written to prevent.
    let tm = 0
    let tries = 0
    const tick = () => {
      // CSS.escape like the other two call sites in this file: a firestore id is
      // normally safe, but this selector is the only one that was interpolating raw
      const el = rootRef.current && rootRef.current.querySelector(`[data-item-id="${CSS.escape(String(previewFocus.itemId))}"]`)
      if (el && el.scrollIntoView) { el.scrollIntoView({ block: 'center' }); return }
      tries += 1
      if (tries < 40) tm = setTimeout(tick, 120)
    }
    tm = setTimeout(tick, 80)
    return () => clearTimeout(tm)
  }, [preview, previewFocus?.itemId, previewFocus?.view]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!preview || !previewFocus || previewFocus.view !== 'stage' || !previewFocus.itemId) return undefined
    const it = (items || []).find((x) => x.id === previewFocus.itemId)
    if (it) setViewItem(it)
    return undefined
  }, [preview, previewFocus?.itemId, previewFocus?.view, items]) // eslint-disable-line react-hooks/exhaustive-deps

  // Searches (including the zero-result ones — what guests ask for and the
  // venue does not have) are recorded after the guest stops typing.
  useEffect(() => {
    if (preview || !search.trim()) return undefined
    const id = setTimeout(() => trackSearch(search.trim(), visibleItems.length), 900)
    return () => clearTimeout(id)
  }, [search, visibleItems.length, preview])

  // Table order: merge the shared session lines into THIS device's cart rather
  // than creating an order straight from session data. Prices are re-derived
  // from the live menu (session lines are written by unauthenticated phones and
  // must never be trusted for money), then the normal cart/checkout flow runs —
  // so payment, loyalty, VAT and stock all behave exactly as usual.
  const placeTableOrder = (lines) => {
    let merged = 0
    for (const l of lines || []) {
      const item = (items || []).find((i) => i.id === l.itemId)
      if (!item || item.available === false) continue
      const variant = l.variant?.key ? (item.variants || []).find((v) => v.key === l.variant.key) || null : null
      const mods = (l.mods || []).map((m) => {
        const grp = (item.modifierGroups || []).flatMap((g) => g.options || [])
        const real = grp.find((o) => o.nameAr === m.nameAr && o.nameEn === m.nameEn)
        return real ? { nameAr: real.nameAr, nameEn: real.nameEn, price: Number(real.price) || 0, recipe: real.recipe || [] } : null
      }).filter(Boolean)
      addLine(item, variant, mods, Math.max(1, Math.min(50, Number(l.qty) || 1)))
      merged += 1
    }
    if (!merged) { toast.error(lang === 'ar' ? 'لم تعد الأصناف متاحة' : 'Those items are no longer available'); return false }
    setFxOpen('')
    setCartOpen(true)
    toast.success(lang === 'ar' ? 'نقلنا أصناف الطاولة إلى سلتك، أكمل طلبك' : 'Table items moved to your cart')
    return true
  }

  // Which interactive chips to surface: venue toggle (default on) AND a real
  // reason to exist — never advertise an experience that would open empty.
  const expChips = useMemo(() => {
    // Until the tenant document resolves, we do NOT know which experiences are
    // on. Guessing "all on" (which `tenant?.[k] !== false` does when tenant is
    // null) paints four chips, then REMOVES the disabled ones the instant the
    // real tenant arrives — the exact "bar moves up and down" the owner saw.
    // An unresolved tenant means an empty bar (the row height is reserved in
    // CSS), and the real chips fill in horizontally with no vertical shift.
    if (!tenant) return []
    const on = (k) => tenant?.[k] !== false
    const out = []
    // Games lead the bar: they are the reason a browsing guest stays, and for
    // browse-only venues they are the main interactive surface.
    if (on('gamesEnabled')) out.push({ id: 'games', icon: 'play', label: lang === 'ar' ? 'الألعاب والتحديات' : 'Games' })
    if (orderingEnabled && on('voiceWaiterEnabled')) out.push({ id: 'voice', icon: 'mic', label: lang === 'ar' ? 'اطلب بصوتك' : 'Voice order' })
    if (on('photoOrderEnabled')) out.push({ id: 'photo', icon: 'camera', label: lang === 'ar' ? 'اطلب بالصورة' : 'Photo order' })
    // Gate the world/compare chips on the FULL active menu, never the
    // search/category-filtered `visibleItems` — otherwise the chip set changes
    // as the guest searches or switches tabs, and the bar reflows mid-browse.
    if (MENU_3D_ENABLED && on('menu3dEnabled') && allActive.some((i) => i.model3dUrl || i.arStandeeUrl)) out.push({ id: 'world', icon: 'shapes', label: lang === 'ar' ? 'عالم ثلاثي الأبعاد' : '3D world' })
    if (on('compareEnabled') && allActive.length > 1) out.push({ id: 'compare', icon: 'scale', label: lang === 'ar' ? 'قارن الأصناف' : 'Compare' })
    if (orderingEnabled && on('sharedCartEnabled') && table?.id) out.push({ id: 'table', icon: 'customers', label: lang === 'ar' ? 'طلب الطاولة معاً' : 'Table order' })
    if (on('voiceMenuEnabled')) out.push({ id: 'read', icon: 'sound', label: lang === 'ar' ? 'اقرأ المنيو صوتياً' : 'Read aloud' })
    return out
  }, [tenant, orderingEnabled, allActive, table, lang])

  const addLine = (item, variant, mods, qty) => {
    // browse mode: adding still works — the cart is the guest's "show the waiter"
    // list; only SUBMITTING an order is disabled (in CartSheet).
    const modSum = mods.reduce((s, m) => s + (m.price || 0), 0)
    const unitPrice = basePrice(item, variant) + modSum
    const modSig = mods.map((m) => m.nameAr).sort().join(',')
    const key = `${item.id}|${variant?.key || ''}|${modSig}`
    setCart((c) => {
      const idx = c.findIndex((l) => l.key === key)
      if (idx >= 0) {
        const next = [...c]
        next[idx] = { ...next[idx], qty: next[idx].qty + qty }
        return next
      }
      return [...c, {
        key, itemId: item.id, categoryId: item.categoryId || '',
        nameAr: item.nameAr, nameEn: item.nameEn || '',
        variantLabel: variant ? pickLang(variant, 'name', lang) : '', variantKey: variant?.key || '',
        modifiers: mods, unitPrice, qty, image: item.imageUrl || '',
        countsForLoyalty: item.countsForLoyalty !== false,
      }]
    })
    if (!preview) trackCartAdd(item, qty)
    toast.success(t('addToCart'))
  }

  const setQty = (key, qty) => setCart((c) => (qty <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, qty } : l))))

  // QUICK ADD straight from the card (owner request): one tap puts a
  // no-decisions item in the cart; anything with a REQUIRED choice (2+ sizes,
  // required modifier group) opens the sheet instead — same rule the POS
  // tapItem uses and the same `missing` maths the sheet enforces, so a quick
  // add can never smuggle an incomplete line past the options.
  const needsSheet = (it) => {
    if ((it.variants || []).length > 1) return true
    return (it.modifierGroups || []).some((g) => g.required || Number(g.min) > 0)
  }
  const quickAddOn = !isHidden('quickAdd')
  // Returns TRUE only when a line actually landed in the cart — the pairing
  // chips flash their ✓ off this, and flashing it while we merely OPENED the
  // detail (required choices) lied to the guest.
  const quickAdd = (it, fromEl = null) => {
    const out = it.available === false || (it.trackStock && (it.stock || 0) <= 0)
    if (out) return false
    if (!quickAddOn || needsSheet(it)) { setViewItem(it); return false }
    addLine(it, (it.variants && it.variants[0]) || null, [], 1)
    try { navigator.vibrate?.(12) } catch (_) { /* no haptics */ }
    if (fromEl) spotFlyToCart(fromEl, it.imageUrl || '')
    return true
  }
  // the add badge lives INSIDE a <button> card root — a nested <button> is
  // invalid HTML, so it's a keyboard-accessible role=button span that stops
  // the card's own open-sheet click
  const quickAddProps = (it) => ({
    role: 'button', tabIndex: 0, 'aria-label': t('addToCart'),
    onClick: (e) => { e.stopPropagation(); quickAdd(it, e.currentTarget.closest('[data-item-id]')?.querySelector('img') || e.currentTarget) },
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); quickAdd(it) } },
  })

  const renderCard = (it) => {
    const out = it.available === false || (it.trackStock && (it.stock || 0) <= 0)
    const offer = offerForItem(it, offers)
    const isAlternating = menuLayout === 'alternating'
    const { nameStyle, priceStyle } = resolveItemStyles(it)
    return (
      <button key={it.id} className={`food-card ${out ? 'unavailable' : ''}`} data-item-id={it.id} onClick={() => !out && setViewItem(it)} disabled={out} data-item-layout={it.namePriceLayout || ''}>
        {it.imageUrl ? <img className="food-img" src={it.imageUrl} alt="" loading="lazy" decoding="async" /> : <div className="food-img center muted"><Icon name="coffee" size={26} /></div>}
        <div className="body">
          <div className="name" style={nameStyle}>{pickLang(it, 'name', lang)}</div>
          <div className="row" style={{ gap: 12 }}>
            {it.rating ? <span className="rating"><Icon name="star" size={14} fill="currentColor" strokeWidth={1.5} /> {it.rating}</span> : null}
            {!isHidden('prepTime') && it.prepTime ? <span className="time-chip"><Icon name="clock" size={13} /> {it.prepTime} {t('minutesShort')}</span> : null}
          </div>
          {!isAlternating ? (
            <div className="row-between">
              <span className="price" style={priceStyle}>
                <Price value={offer ? discountedPrice(it.price, offer) : it.price} currency={currency} lang={lang} />
                {offer && <span className="price-was"><Price value={it.price} currency={currency} lang={lang} /></span>}
              </span>
              {out ? <span className="badge badge-danger">{t('soldOut')}</span> : offer ? <span className="badge badge-gold">{offer.type === 'percent' ? `−${offer.value}%` : `−${offer.value}`}</span> : quickAddOn ? <span className="food-add menu-grad" {...quickAddProps(it)}><Icon name="add" size={18} /></span> : null}
            </div>
          ) : (
            <div className="row">
              <span className="price" style={priceStyle}>
                <Price value={offer ? discountedPrice(it.price, offer) : it.price} currency={currency} lang={lang} />
                {offer && <span className="price-was"><Price value={it.price} currency={currency} lang={lang} /></span>}
              </span>
            </div>
          )}
        </div>
        {isAlternating && (
          <div className="food-card-action">
            {out ? (
              <span className="badge badge-danger">{t('soldOut')}</span>
            ) : offer ? (
              <span className="badge badge-gold">{offer.type === 'percent' ? `−${offer.value}%` : `−${offer.value}`}</span>
            ) : quickAddOn ? (
              <span className="food-add menu-grad" {...quickAddProps(it)}><Icon name="add" size={18} /></span>
            ) : null}
          </div>
        )}
      </button>
    )
  }

  const renderShowcase = (it) => {
    const out = it.available === false || (it.trackStock && (it.stock || 0) <= 0)
    const offer = offerForItem(it, offers)
    const priceVal = offer ? discountedPrice(it.price, offer) : it.price
    const { nameStyle, priceStyle } = resolveItemStyles(it)
    return (
      <button key={it.id} className={`showcase-card ${out ? 'unavailable' : ''}`} data-item-id={it.id} onClick={() => !out && setViewItem(it)} disabled={out} data-item-layout={it.namePriceLayout || ''}>
        {it.imageUrl ? <img className="showcase-img" data-imgstyle={it.imageStyle || ''} src={it.imageUrl} alt="" loading="lazy" decoding="async" /> : <div className="showcase-img center muted"><Icon name="coffee" size={34} /></div>}
        <div className="showcase-name" style={nameStyle}>{pickLang(it, 'name', lang)}</div>
        {menuLayout === 'coffeepan' && pickLang(it, 'desc', lang) && (
          <div className="coffeepan-desc">{pickLang(it, 'desc', lang)}</div>
        )}
        <div className="row" style={{ gap: 8, justifyContent: 'center', marginTop: 4 }}>
          {it.rating ? <span className="rating"><Icon name="star" size={13} fill="currentColor" strokeWidth={1.5} /> {it.rating}</span> : null}
          {it.calories ? <span className="time-chip"><Icon name="flame" size={13} /> {it.calories}</span> : null}
        </div>
        <div className="showcase-price" style={priceStyle}>
          <span>
            <Price value={priceVal} currency={currency} lang={lang} />
            {offer && <span className="price-was"><Price value={it.price} currency={currency} lang={lang} /></span>}
          </span>
          {menuLayout === 'coffeepan' && !out && quickAddOn && (
            <span className="coffeepan-add-btn" {...quickAddProps(it)}><Icon name="add" size={14} /></span>
          )}
        </div>
        {out && <span className="badge badge-danger" style={{ position: 'absolute', top: 8, insetInlineEnd: 8 }}>{t('soldOut')}</span>}
      </button>
    )
  }

  // Coffee-list (image #46) row: round product · name + desc · price · "+".
  const renderClRow = (it) => {
    const out = it.available === false || (it.trackStock && (it.stock || 0) <= 0)
    const offer = offerForItem(it, offers)
    const { nameStyle, priceStyle } = resolveItemStyles(it)
    return (
      <button key={it.id} className={`cl-row ${out ? 'unavailable' : ''}`} data-item-id={it.id} onClick={() => !out && setViewItem(it)} disabled={out} data-item-layout={it.namePriceLayout || ''}>
        <span className="cl-media" data-imgstyle={it.imageStyle || ''}>{it.imageUrl ? <img src={it.imageUrl} alt="" loading="lazy" decoding="async" /> : <Icon name="coffee" size={22} />}</span>
        <div className="cl-body">
          <div className="cl-name" style={nameStyle}>{pickLang(it, 'name', lang)}</div>
          {pickLang(it, 'desc', lang) && <div className="cl-desc">{pickLang(it, 'desc', lang)}</div>}
        </div>
        <div className="cl-price" style={priceStyle}><Price value={offer ? discountedPrice(it.price, offer) : it.price} currency={currency} lang={lang} />{offer && <span className="price-was"><Price value={it.price} currency={currency} lang={lang} /></span>}</div>
        {out ? <span className="badge badge-danger">{t('soldOut')}</span> : quickAddOn ? <span className="cl-add" {...quickAddProps(it)}><Icon name="add" size={16} /></span> : null}
      </button>
    )
  }

  const renderItems = (list) =>
    menuLayout === 'coffeelist'
      ? <div className="cl-list">{list.map(renderClRow)}</div>
      : viewMode === 'gallery'
        ? <div className="showcase-grid">{list.map(renderShowcase)}</div>
        : <div className="stack" style={{ gap: 'var(--sp-2)' }}>{list.map(renderCard)}</div>

  // Storefront (brand-app) card: a light tile with the product image floating above + a "+" badge.
  const renderStoreCard = (it) => {
    const offer = offerForItem(it, offers)
    const out = it.available === false || (it.trackStock && (it.stock || 0) <= 0)
    const { nameStyle, priceStyle } = resolveItemStyles(it)
    return (
      <button key={it.id} className={`store-card ${out ? 'unavailable' : ''}`} data-item-id={it.id} onClick={() => !out && setViewItem(it)} disabled={out} data-item-layout={it.namePriceLayout || ''}>
        <span className="store-card-media" data-imgstyle={it.imageStyle || ''}>{it.imageUrl ? <img src={it.imageUrl} alt="" loading="lazy" decoding="async" /> : <Icon name="coffee" size={40} />}</span>
        <div className="store-card-name" style={nameStyle}>{pickLang(it, 'name', lang)}</div>
        <div className="store-card-price" style={priceStyle}><Price value={offer ? discountedPrice(it.price, offer) : it.price} currency={currency} lang={lang} />{offer && <span className="price-was"><Price value={it.price} currency={currency} lang={lang} /></span>}</div>
        {!out && quickAddOn && <span className="store-add" {...quickAddProps(it)}><Icon name="add" size={16} /></span>}
      </button>
    )
  }

  const hasAnyItems = allActive.length > 0

  // ------------------------------------------------------------------ home ----
  // The blocks above the dishes, extracted VERBATIM into one renderer map so
  // tenant.menuHome.order (resolveHomeOrder) can arrange them. Every renderer
  // keeps its exact original condition INSIDE itself, so a block that renders
  // nothing today still renders nothing wherever it is placed. The resume
  // banner stays pinned above the loop (system notice, not decor) and the
  // layout switch stays fixed after it.
  //
  // hero: the venue header. All media layers live inside ONE .menu-hero-media
  // wrapper (the wrapper carries the banner height; every layer inside paints
  // absolutely — the tint used to be a second in-flow cover that doubled the
  // hero's height) so the true-transparency melt has a single thing to mask.
  // The painted .menu-hero-fade stays OUTSIDE the wrapper (its card-variant
  // inset is authored against .menu-hero) and is gated OFF while bannerMelt>0.
  const HOME_RENDER = {
    hero: () => {
      const bannerH = tenant?.bannerHeight ? Number(tenant.bannerHeight) : null
      const mediaStyle = bannerH
        ? { height: `${bannerH}px`, ...(meltStyle || {}) }
        : (meltStyle || undefined)
      const hasCustomOffset = tenant?.heroOffset != null && tenant.heroOffset !== ''
      const isBrandHidden = isHidden('heroBrand')
      const effectiveOffset = hasCustomOffset
        ? Number(tenant.heroOffset)
        : (isBrandHidden ? 16 : undefined)
      const bodyStyle = effectiveOffset != null ? { marginTop: `${effectiveOffset}px` } : undefined

      return (
        <div className="menu-hero" data-banner={(tenant?.bannerVideoUrl || tenant?.bannerUrl) ? (tenant?.bannerStyle || 'full') : undefined}>
          <div className="menu-hero-media" style={mediaStyle} aria-hidden="true">
            {(tenant?.bannerVideoUrl || tenant?.bannerUrl) ? (
              <>
                {(() => {
                  /* the banner's MOOD — the same filter presets, blend modes and
                     tint every other backdrop already has (bannerFilter/bannerBlend/
                     bannerTint+bannerTintAmount). filterCss() resolves the preset,
                     so an unknown id is simply no filter, never a broken string. */
                  const moodFilter = filterCss(tenant?.bannerFilter) || undefined
                  const moodBlend = tenant?.bannerBlend && tenant.bannerBlend !== 'normal' && BLEND_IDS.includes(tenant.bannerBlend) ? tenant.bannerBlend : undefined
                  return tenant?.bannerVideoUrl ? (
                    /* video banner — same opacity/position/zoom controls as the image */
                    <video ref={bannerTrimRef} className="menu-hero-cover menu-hero-video" src={tenant.bannerVideoUrl} autoPlay muted loop playsInline preload="auto"
                      style={{ objectPosition: tenant.bannerPosition || 'center', opacity: tenant.bannerOpacity != null ? Number(tenant.bannerOpacity) : 1, transform: Number(tenant.bannerScale) > 1 ? `scale(${Number(tenant.bannerScale)})` : undefined, transformOrigin: tenant.bannerPosition || 'center', filter: moodFilter, mixBlendMode: moodBlend }} />
                  ) : (
                    <div className="menu-hero-cover" style={{ backgroundImage: `url(${tenant.bannerUrl})`, backgroundSize: tenant.bannerScale ? `${Number(tenant.bannerScale) * 100}%` : 'cover', backgroundPosition: tenant.bannerPosition || 'center', opacity: tenant.bannerOpacity != null ? Number(tenant.bannerOpacity) : 1, filter: moodFilter, mixBlendMode: moodBlend }} />
                  )
                })()}
                {tenant?.bannerTint && Number(tenant.bannerTintAmount) > 0 && (
                  <div className="menu-hero-cover" aria-hidden="true" style={{ background: tenant.bannerTint, opacity: Math.min(1, Number(tenant.bannerTintAmount)), pointerEvents: 'none' }} />
                )}
              </>
            ) : tenant?.coverUrl ? (
              <div className="menu-hero-cover" style={{ backgroundImage: `url(${tenant.coverUrl})` }} />
            ) : (
              <div className="menu-hero-cover menu-hero-grad" />
            )}
          </div>
          {(tenant?.bannerVideoUrl || tenant?.bannerUrl) && banner.melt === 0 && (
            <div className="menu-hero-fade" data-fade={tenant?.bannerFadeDir || 'bottom'} style={{ opacity: tenant.bannerGradient != null ? Number(tenant.bannerGradient) : 0.55 }} />
          )}
          <div className="container menu-hero-body" style={bodyStyle}>
          {!isHidden('heroBrand') && (
            <>
              {tenant?.logoUrl && <img className="menu-hero-logo" src={tenant.logoUrl} alt="" decoding="async" />}
              <h2 className="menu-hero-title" style={{ marginTop: tenant?.logoUrl ? 4 : 44 }}>{tenant?.name}</h2>
              {tenant?.descAr && <p className="muted small" style={{ maxWidth: 520 }}>{tenant.descAr}</p>}
            </>
          )}
          {(() => {
            const hd = resolveMenuHeader(tenant)
            const showHeroLang = hd.show.lang && (hd.langPos === 'hero')
            const showHeroTheme = hd.show.theme && (hd.themePos === 'hero')
            const showHeroBell = !isHidden('notifications') && (hd.bellPos === 'hero')
            if (!showHeroLang && !showHeroTheme && !showHeroBell) return null
            const langIcon = mch?.elements?.langBtn?.icon || ''
            const themeIcon = mch?.elements?.themeBtn?.icon || ''
            const bellIcon = mch?.elements?.bellFab?.icon || ''
            return (
              <div className="row center" style={{ gap: 8, marginTop: 6 }}>
                {showHeroLang && (
                  <button type="button" className="icon-btn db-lang" onClick={toggleLang} aria-label="language" style={{ fontWeight: 800, fontSize: 13, width: 38, height: 38, borderRadius: 'var(--r-pill)', background: 'color-mix(in srgb, var(--surface) 80%, transparent)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-strong)', ...(hd.langOffsetX || hd.langOffsetY ? { transform: `translate(${hd.langOffsetX || 0}px, ${hd.langOffsetY || 0}px)` } : {}) }}>
                    {langIcon ? <img className="mch-icon" src={langIcon} alt="" /> : (lang === 'ar' ? 'EN' : 'ع')}
                  </button>
                )}
                {showHeroTheme && (
                  <button type="button" className="icon-btn db-theme" onClick={toggleTheme} aria-label="theme" style={{ width: 38, height: 38, borderRadius: 'var(--r-pill)', background: 'color-mix(in srgb, var(--surface) 80%, transparent)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-strong)', ...(hd.themeOffsetX || hd.themeOffsetY ? { transform: `translate(${hd.themeOffsetX || 0}px, ${hd.themeOffsetY || 0}px)` } : {}) }}>
                    {themeIcon ? <img className="mch-icon" src={themeIcon} alt="" /> : <Icon name={theme === 'dark' ? 'sun' : 'moon'} />}
                  </button>
                )}
                {showHeroBell && (
                  <button type="button" className="icon-btn db-bell" onClick={() => setNotifOpen(true)} aria-label={t('notificationsTitle')} style={{ width: 38, height: 38, borderRadius: 'var(--r-pill)', background: 'color-mix(in srgb, var(--surface) 80%, transparent)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-strong)', position: 'relative', ...(hd.bellOffsetX || hd.bellOffsetY ? { transform: `translate(${hd.bellOffsetX || 0}px, ${hd.bellOffsetY || 0}px)` } : {}) }}>
                    {bellIcon ? <img className="mch-icon" src={bellIcon} alt="" /> : <Icon name="bell" size={18} />}
                    {unreadCount > 0 && <span className="b" style={{ position: 'absolute', top: -4, right: -4, background: 'var(--brand)', color: 'var(--on-brand)', borderRadius: 999, fontSize: 9, fontWeight: 800, minWidth: 16, height: 16, display: 'grid', placeItems: 'center', padding: '0 3px' }}>{unreadCount}</span>}
                  </button>
                )}
              </div>
            )
          })()}
          {!isHidden('social') && <SocialLinks social={tenant?.social} appearance={tenant?.socialStyle} icons={mch?.socialIcons} className="menu-hero-social" />}
          {!isHidden('profile') && tenant?.slug && !preview && (
            <Link to={`/m/${tenant.slug}/about`} className="btn btn-sm btn-outline" style={{ marginTop: 8 }}>
              <Icon name="events" size={14} /> {lang === 'ar' ? 'قصتنا وأخبارنا' : 'Our story & news'}
            </Link>
          )}
        </div>
      </div>
    )},
    // stories strip (hidden via appearance "hidden elements"; renders nothing when empty)
    stories: () => (!isHidden('stories') && !preview ? <Stories tenantId={tenantId} lang={lang} /> : null),
    // search + view toggle
    search: () => ((!isHidden('search') || (showViewToggle && !isHidden('viewToggle'))) ? (
      <div className="container" id="m-search" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          {!isHidden('search') && (
            <div className="m-search grow">
              <Icon name="search" size={18} className="faint" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchFood')} aria-label={t('search')} />
              {search && <button type="button" className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => setSearch('')}><Icon name="close" size={15} /></button>}
            </div>
          )}
          {showViewToggle && !isHidden('viewToggle') && (
            <div className="view-toggle">
              <button className={viewMode === 'list' ? 'on' : ''} onClick={() => setViewMode('list')} aria-label={t('listView')}><Icon name="list" size={18} /></button>
              <button className={viewMode === 'gallery' ? 'on' : ''} onClick={() => setViewMode('gallery')} aria-label={t('galleryView')}><Icon name="grid" size={18} /></button>
            </div>
          )}
        </div>
      </div>
    ) : null),
    // «التجربة التفاعلية» — voice / photo / 3D world / compare / table order.
    // The bar renders while the tenant is still loading (an empty row whose
    // height is reserved in CSS) and once it has chips — but NOT once we know
    // the venue enabled no experiences, so the row's vertical footprint never
    // shifts. It renders in the studio preview too now (the venue must SEE the
    // chip skin and position while editing); the click guard keeps the
    // overlays closed there. The bar wears the venue button skin
    // (data-btnskin/-btnshape + buttonSkinVars — the theme's own painter)
    // whenever menuButtons is configured on the editorial theme, regardless of
    // scope: these chips are primary-grade actions. The games chip keeps its
    // GamesIcon; under a skin its purple gradient surrenders to the venue face
    // via the exp-bar skin CSS and stays findable through the amber inset ring
    // (brick is structure, amber is light). Same icon box for every chip so
    // the row is one consistent control set.
    chips: () => ((!tenant || expChips.length > 0) ? (
      <div className="container" style={{ marginTop: 'var(--sp-2)' }}>
        <div className="exp-bar scroll-x" data-btnskin={edtBtn ? edtBtn.skin : undefined} data-btnshape={edtBtn && edtBtn.shape ? edtBtn.shape : undefined} style={edtBtnVars || undefined}>
          {expChips.map((c) => (
            <button key={c.id} type="button" className={`exp-chip${c.id === 'games' ? ' is-games' : ''}`} onClick={() => { if (!preview) setFxOpen(c.id) }}>
              {c.id === 'games'
                ? <GamesIcon size={16} animated />
                : <Icon name={c.icon} size={16} />}
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </div>
    ) : null),
    // The welcome pair. The browse-only card keeps its condition INDEPENDENT
    // of isHidden('welcome') — hiding 'welcome' has never hidden it, and the
    // merge into one ordered block must not change that.
    welcome: () => (
      <>
        {!orderingEnabled && !search.trim() && (
          <div className="container" style={{ paddingTop: 8 }}>
            <div className="welcome-card" style={{ borderColor: 'var(--brand)' }}>
              <span className="welcome-ic"><Icon name="menu" size={19} /></span>
              <div className="grow stack" style={{ gap: 1 }}>
                <strong className="small">{lang === 'ar' ? 'منيو للتصفح والاستعراض' : 'Browse-only menu'}</strong>
                <span className="xs faint">{lang === 'ar' ? 'سجّل رقمك ليصلك كل جديد وعروضنا على واتساب' : 'Register to get our news & offers on WhatsApp'}</span>
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => setRegOpen(true)}>{lang === 'ar' ? 'سجّل الآن' : 'Register'}</button>
            </div>
          </div>
        )}
        {(memberCard?.active || savedCustomer || !regDismissed) && !search.trim() && !isHidden('welcome') && (
          <div className="container" data-welcome-style={tenant?.welcomeStyle || 'tinted'} style={{ paddingTop: 8, paddingBottom: 4 }}>
            {memberCard?.active && tenant?.slug ? (
              <a className="welcome-card" href={`/mcard/${tenant.slug}/${memberCard.token}`} style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer', borderColor: (TIER_META[memberCard.tier] || {}).color }}>
                {/* TIER_META has icon/color (no emoji field — this used to render empty) */}
                <span className="welcome-ic" style={{ color: (TIER_META[memberCard.tier] || TIER_META.silver).color }}><Icon name={(TIER_META[memberCard.tier] || TIER_META.silver).icon || 'award'} size={19} /></span>
                <div className="grow stack" style={{ gap: 1 }}>
                  <strong className="small">{lang === 'ar' ? `عضو ${TIER_META[memberCard.tier] ? TIER_META[memberCard.tier].ar : ''}` : `${TIER_META[memberCard.tier] ? TIER_META[memberCard.tier].en : ''} member`} · {memberCard.points || 0} {lang === 'ar' ? 'نقطة' : 'pts'} · {memberCard.discountPct || 0}%</strong>
                  <span className="xs faint">{lang === 'ar' ? 'اضغط لعرض بطاقتك' : 'Tap to view your card'}</span>
                </div>
                {/* the global RTL chevron flip only covers .list-row, and this is a .welcome-card */}
                <Icon name={lang === 'ar' ? 'back' : 'next'} size={18} className="faint" />
              </a>
            ) : savedCustomer ? (
              <div className="welcome-card">
                <span className="welcome-ic"><Icon name="user" size={19} /></span>
                <div className="grow stack" style={{ gap: 1 }}>
                  <strong className="small">{lang === 'ar' ? `أهلاً ${savedCustomer.name || 'بعودتك'}` : `Welcome back${savedCustomer.name ? ` ${savedCustomer.name}` : ''}`}</strong>
                  <span className="xs faint">{lang === 'ar' ? 'سعداء بعودتك، تابع نقاطك وعروضك' : 'Track your points & offers'}</span>
                </div>
                <Icon name="award" size={18} className="faint" />
              </div>
            ) : (
              <div className="welcome-card">
                <span className="welcome-ic"><Icon name="sparkles" size={19} /></span>
                <div className="grow stack" style={{ gap: 1 }}>
                  <strong className="small">{lang === 'ar' ? 'انضمّ لبرنامج الولاء' : 'Join the loyalty program'}</strong>
                  <span className="xs faint">{lang === 'ar' ? 'اجمع نقاطاً واحصل على عروض خاصة' : 'Collect points & unlock offers'}</span>
                </div>
                <button className="btn btn-sm btn-primary" onClick={() => setRegOpen(true)}>{lang === 'ar' ? 'تسجيل' : 'Join'}</button>
                <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => { dismissRegister(tenantId); setRegDismissed(true) }}><Icon name="close" size={15} /></button>
              </div>
            )}
          </div>
        )}
      </>
    ),
    // promos
    promos: () => (promos.length > 0 && !search.trim() && !isHidden('promos') && menuLayout !== 'storefront' ? (
      <div className="container" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="m-promos">
          {promos.map((o) => (
            <div key={o.id} className="m-promo">
              <strong style={{ fontSize: 'var(--fs-lg)' }}>{o.type === 'percent' ? `${o.value}%` : <Price value={o.value} currency={currency} lang={lang} />} {lang === 'ar' ? 'خصم' : 'OFF'}</strong>
              <span className="small" style={{ opacity: .92 }}>{pickLang(o, 'name', lang) || (lang === 'ar' ? 'عرض خاص' : 'Special offer')}</span>
              {o.code && <span className="badge" style={{ width: 'fit-content', background: 'rgba(255,255,255,.2)', color: 'var(--on-brand)' }}>{o.code}</span>}
            </div>
          ))}
        </div>
      </div>
    ) : null),
    // «ذاكرة المكان» — a returning guest is recognised the way a good waiter
    // would: only things that are true and specific, and silence otherwise.
    memory: () => (!preview && memoryLines.length > 0 ? (
      <div className="container" style={{ marginTop: 'var(--sp-3)' }}>
        <Suspense fallback={null}>
          <VenueMemory
            lines={memoryLines}
            venueName={tenant?.name || ''}
            lang={lang}
            storageKey={tenantId}
            onAction={(line) => {
              if (line?.kind === 'lookedNotOrdered' && line.itemId) {
                const it = (items || []).find((i) => i.id === line.itemId)
                if (it) setViewItem(it)
              } else if (line?.kind === 'usual' && line.itemId) {
                const it = (items || []).find((i) => i.id === line.itemId)
                if (it) setViewItem(it)
              }
            }}
          />
        </Suspense>
      </div>
    ) : null),
    // Google-reviews showcase strip — the ReviewsStudio toggle
    // (tenant.reviewShowcase.enabled) finally has its render surface.
    reviews: () => (tenant?.reviewShowcase?.enabled && !search.trim() && !preview ? (
      <ReviewShowcase tenantId={tenantId} lang={lang} />
    ) : null),
    // special dishes — data-film + --feat-film carry the venue's plaster dial
    // (resolveFeatured; 0 = attribute absent, byte-identical)
    special: () => (special.length > 0 && !search.trim() && !isHidden('special') && menuLayout !== 'storefront' ? (
      <div className="container special-sec" data-menu-layout={menuLayout} data-featured-style={tenant?.featuredStyle || 'soft'} data-film={featured.film > 0 ? '1' : undefined} style={{ marginTop: 'var(--sp-4)', ...(featured.film > 0 ? { '--feat-film': featured.film } : {}), ...(featured.scale !== 1 ? { '--feat-scale': featured.scale } : {}) }}>
        <div className="special-head">
          <Icon name={featuredMode === 'auto' ? 'flame' : 'star'} size={16} />
          <strong>{featuredMode === 'auto' ? (lang === 'ar' ? 'الأكثر طلباً' : 'Best sellers') : t('specialDishes')}</strong>
        </div>
        <div className="special-row">
          {special.map((it, idx) => (
            <button key={it.id} className="special-card" data-item-id={it.id} onClick={() => setViewItem(it)}>
              {featuredMode === 'auto'
                ? <span className="special-badge special-rank">{idx + 1}</span>
                : <span className="special-badge special-star" aria-hidden="true"><Icon name="star" size={11} /></span>}
              {it.imageUrl ? <img src={it.imageUrl} alt="" loading="lazy" decoding="async" /> : <span className="special-ph" aria-hidden="true"><Icon name="image" size={26} /></span>}
              <div className="bold small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pickLang(it, 'name', lang)}</div>
              <div className="row" style={{ gap: 6, alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div className="price small" style={{ color: 'var(--brand)' }}><Price value={it.price} currency={currency} lang={lang} /></div>
                {/* gated like every other layout: no badge when quick-add is
                    hidden, and no dead tap on a sold-out best-seller */}
                {quickAddOn && !(it.available === false || (it.trackStock && (it.stock || 0) <= 0)) && <span className="special-add" {...quickAddProps(it)}><Icon name="add" size={13} /></span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    ) : null),
  }

  return (
    <div ref={rootRef} data-menu-layout={menuLayout} data-motion={motion} data-motion-speed={motionSpeed} data-tap={tap} data-menuglass={menuGlassLvl || undefined} data-venue-bg={(tenant?.bgImageUrl || tenant?.bgVideoUrl || tenant?.watermarkUrl || tenant?.bgGradient) ? '1' : '0'} data-room={roomOn ? '1' : undefined} data-edt-dark={edtDarkRoot ? '1' : undefined} key={`${motion}-${motionSpeed}`} style={{ paddingBottom: 'calc(var(--bottomnav-h) + var(--safe-b) + 8px)', ...glassVars(tenant, 'menu'), ...(roomOn ? { '--bn-scrim': banner.scrim } : {}) }}>
      {/* the venue's chrome faces (null-render body vars) + the ONE room wall
          behind the whole page (menuWall.room — EditorialRoomBg guards itself) */}
      <ChromeSkin tenant={tenant} />
      {menuLayout === 'editorial' && <EditorialRoomBg tenant={tenant} />}
      {/* resume banner — a returning diner taps to reopen their live order page */}
      {!preview && activeOrder && tenant?.slug && (() => {
        const [stLabel, stIcon] = ORDER_ST[activeOrder.status] || ORDER_ST.pending
        const isReady = activeOrder.status === 'ready'
        return (
          <Link
            to={`/order/${tenant.slug}/${activeOrder.id}`}
            className="row-between"
            style={{
              gap: 10, padding: '11px 14px', textDecoration: 'none',
              background: isReady ? 'var(--success)' : 'var(--brand)', color: 'var(--on-brand)',
              boxShadow: '0 2px 12px rgba(0,0,0,.18)',
            }}
          >
            <span className="row" style={{ gap: 8, alignItems: 'center', minWidth: 0 }}>
              <Icon name={stIcon} size={17} />
              <span className="small bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {lang === 'ar' ? 'طلبك' : 'Your order'} {orderNumber(activeOrder.code)} · {stLabel}
              </span>
            </span>
            <span className="row" style={{ gap: 4, alignItems: 'center', flex: 'none', fontWeight: 800, fontSize: 13 }}>
              {lang === 'ar' ? 'تابع' : 'Track'} <Icon name="next" size={15} style={{ transform: lang === 'ar' ? 'scaleX(1)' : 'scaleX(-1)' }} />
            </span>
          </Link>
        )
      })()}

      {/* the home blocks, in the venue's own order (tenant.menuHome.order —
          renderers + conditions live in HOME_RENDER above the return) */}
      {homeOrder.map((k) => {
        const render = HOME_RENDER[k]
        return render ? <Fragment key={k}>{render()}</Fragment> : null
      })}

      {menuLayout === 'spotlight' ? (
        /* spotlight — immersive one-product-per-view: big image, scroll-snap, direct add-to-cart */
        <div className="spot-wrap" data-spot-size={resolveSkin(tenant, 'menu')?.spotImageSize || 'md'}>
          <div className="spot-cats scroll-x" style={{ top: stickyTop }}>
            <button className={`spot-cat ${activeCat === 'all' ? 'on' : ''}`} onClick={() => pickCat('all')}>{t('all')}</button>
            {sortedCats.map((c) => (<button key={c.id} className={`spot-cat ${activeCat === c.id ? 'on' : ''}`} onClick={() => pickCat(c.id)}>{pickLang(c, 'name', lang)}</button>))}
          </div>
          {!hasAnyItems || visibleItems.length === 0 ? (
            <div className="spot-empty"><Empty icon={search.trim() ? 'search' : 'menu'} title={lang === 'ar' ? (search.trim() ? 'لا نتائج' : 'لا توجد أصناف') : (search.trim() ? 'No results' : 'No items')} /></div>
          ) : (
            <SpotlightStage
              // Same rule as the classic branch: the category covers/groups survive
              // a chip tap — only a SEARCH collapses the deck into one flat result set.
              groups={search.trim()
                ? [{ cat: null, items: visibleItems }]
                : [...sortedCats.map((c) => ({ cat: c, items: itemsByCat[c.id] || [] })).filter((g) => g.items.length), ...((itemsByCat._uncat || []).length ? [{ cat: null, items: itemsByCat._uncat }] : [])]}
              allItems={allActive} currency={currency} offers={offers}
              onAdd={addLine} onOpen={setViewItem}
              onQuickAdd={quickAdd}
              cartCount={cartCount} onCart={() => setCartOpen(true)} lang={lang}
              showCovers={!isHidden('covers')} showPairings={!isHidden('pairings')}
              hidePrep={isHidden('prepTime')}
            />
          )}
        </div>
      ) : menuLayout === 'editorial' ? (
        /* editorial («المجلة الداكنة») — dark magazine: one dish per screen, vertical snap, FLIP item stage */
        <EditorialLayout
          tenant={tenant}
          cats={sortedCats} itemsByCat={itemsByCat} visibleItems={visibleItems}
          filtered={!!search.trim()}
          // pickCat, not setActiveCat — these chips used to only light up.
          activeCat={activeCat} onPickCat={pickCat}
          currency={currency} offers={offers} stickyTop={stickyTop}
          allItems={allActive} showPairings={!isHidden('pairings')}
          onQuickAdd={quickAdd}
          quickAddOn={quickAddOn}
          hidePrep={isHidden('prepTime')} hideServes={isHidden('serves')}
          onOpen={(it, rect) => { setOpenRect(rect || null); setViewItem(it) }}
        />
      ) : menuLayout === 'oceanart' ? (
        /* oceanart («اللوحة الفنية») — painted deep-tone canvas, rotated plates, scalloped price seals */
        <OceanArtLayout
          tenant={tenant} cats={sortedCats} itemsByCat={itemsByCat} visibleItems={visibleItems}
          filtered={!!search.trim()}
          activeCat={activeCat} onPickCat={pickCat}
          currency={currency} offers={offers} stickyTop={stickyTop}
          onOpen={setViewItem} onQuickAdd={quickAdd} hidePrep={isHidden('prepTime')}
        />
      ) : menuLayout === 'storefront' ? (
        /* storefront — brand-app carbon copy: brand-colored page, sections, floating product cards (#Starbucks) */
        <div className="store-app">
          {special.length > 0 && !search.trim() && (
            <>
              <div className="container store-sec"><strong>{lang === 'ar' ? 'قائمة جديدة' : 'New Menu'}</strong></div>
              <div className="store-hero scroll-x" ref={heroRef} onScroll={(e) => { const w = e.currentTarget.clientWidth || 1; setHeroIdx(Math.min(special.length - 1, Math.round(Math.abs(e.currentTarget.scrollLeft) / w))) }}>
                {special.slice(0, 6).map((it) => (
                  <button key={it.id} className="store-hero-item" onClick={() => setViewItem(it)}>
                    <span className="store-hero-media" data-imgstyle={it.imageStyle || ''}>{it.imageUrl ? <img src={it.imageUrl} alt="" decoding="async" /> : <Icon name="coffee" size={48} />}</span>
                    <strong className="store-hero-name">{pickLang(it, 'name', lang)}</strong>
                    <span className="store-hero-price"><Price value={it.price} currency={currency} lang={lang} /></span>
                  </button>
                ))}
              </div>
              {special.length > 1 && (
                <div className="store-thumbs scroll-x">
                  {special.slice(0, 6).map((it, i) => (
                    <button key={it.id} className={`store-thumb ${heroIdx === i ? 'on' : ''}`} onClick={() => heroRef.current?.children[i]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })}>
                      {it.imageUrl ? <img src={it.imageUrl} alt="" loading="lazy" decoding="async" /> : <Icon name="coffee" size={18} />}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="container">
            {!hasAnyItems ? (
              <Empty icon="menu" title={lang === 'ar' ? 'لا توجد أصناف' : 'No items'} />
            ) : search.trim() ? (
              visibleItems.length === 0 ? <Empty icon="search" title={lang === 'ar' ? 'لا نتائج' : 'No results'} /> : <div className="store-grid">{visibleItems.map(renderStoreCard)}</div>
            ) : (
              <>
                {sortedCats.map((c) => {
                  const list = itemsByCat[c.id] || []
                  if (!list.length) return null
                  return (<section key={c.id} className="store-cat"><h3 className="cat-heading">{pickLang(c, 'name', lang)}</h3><div className="store-grid">{list.map(renderStoreCard)}</div></section>)
                })}
                {(itemsByCat._uncat || []).length > 0 && (<section className="store-cat"><h3 className="cat-heading">{lang === 'ar' ? 'أخرى' : 'Other'}</h3><div className="store-grid">{itemsByCat._uncat.map(renderStoreCard)}</div></section>)}
              </>
            )}
          </div>
        </div>
      ) : menuLayout === 'sidebar' ? (
        /* sidebar layout — vertical category rail + items grid (theme #18) */
        <div className="container">
          <div className="menu-side">
            <aside className="menu-side-rail">
              <button className={`side-cat ${activeCat === 'all' ? 'active' : ''}`} onClick={() => pickCat('all')}>{t('all')}</button>
              {sortedCats.map((c) => (<button key={c.id} className={`side-cat ${activeCat === c.id ? 'active' : ''}`} onClick={() => pickCat(c.id)}>{pickLang(c, 'name', lang)}</button>))}
            </aside>
            <div className="menu-side-main grow">
              {!hasAnyItems ? (
                <Empty icon="menu" title={lang === 'ar' ? 'لا توجد أصناف' : 'No items'} />
              ) : visibleItems.length === 0 ? (
                <Empty icon="search" title={lang === 'ar' ? 'لا نتائج' : 'No results'} />
              ) : search.trim() ? (
                // A search is one flat result set — headings would claim these
                // results belong to sections they were pulled out of.
                <div className="showcase-grid">{visibleItems.map(renderShowcase)}</div>
              ) : (
                // The rail is a jump list, not a filter (a category is a
                // destination, not a cage). Without headings the whole menu
                // rendered as one unlabelled grid, so tapping a rail entry
                // scrolled somewhere with nothing to say you had arrived —
                // and no way to tell one section from the next while scrolling.
                <>
                  {sortedCats.map((c) => {
                    const list = itemsByCat[c.id] || []
                    if (!list.length) return null
                    return (
                      <section key={c.id} className="side-sec">
                        <h3 className="cat-heading">{pickLang(c, 'name', lang)}</h3>
                        <div className="showcase-grid">{list.map(renderShowcase)}</div>
                      </section>
                    )
                  })}
                  {(itemsByCat._uncat || []).length > 0 && (
                    <section className="side-sec">
                      <h3 className="cat-heading">{lang === 'ar' ? 'أخرى' : 'Other'}</h3>
                      <div className="showcase-grid">{itemsByCat._uncat.map(renderShowcase)}</div>
                    </section>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* category nav — circular image chips (delivery style) or text chips */}
          {catNav === 'circles' ? (
            <div className="scroll-x container cat-circles" style={{ position: 'sticky', top: stickyTop, zIndex: 50, paddingBlock: 'var(--sp-3)', marginTop: 'var(--sp-1)', background: 'var(--bg)' }}>
              <button className={`cat-circle ${activeCat === 'all' ? 'on' : ''}`} onClick={() => pickCat('all')}>
                <span className="cat-circle-img"><Icon name="grid" size={20} /></span>
                <span className="cat-circle-lbl">{t('all')}</span>
              </button>
              {sortedCats.map((c) => {
                const img = (itemsByCat[c.id] || [])[0]?.imageUrl
                return (
                  <button key={c.id} className={`cat-circle ${activeCat === c.id ? 'on' : ''}`} onClick={() => pickCat(c.id)}>
                    <span className="cat-circle-img">{img ? <img src={img} alt="" loading="lazy" decoding="async" /> : <Icon name="coffee" size={20} />}</span>
                    <span className="cat-circle-lbl">{pickLang(c, 'name', lang)}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            // translucent + blur (not opaque --bg) so custom venue backgrounds show through the sticky bar
            <div className="scroll-x container cat-bar" data-cat-nav={catNav} style={{ position: 'sticky', top: stickyTop, zIndex: 50, paddingBlock: 'var(--sp-3)', marginTop: 'var(--sp-1)', background: 'color-mix(in srgb, var(--bg) 72%, transparent)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
              <button className={`chip ${activeCat === 'all' ? 'active' : ''}`} onClick={() => pickCat('all')}>{t('all')}</button>
              {sortedCats.map((c) => (<button key={c.id} className={`chip ${activeCat === c.id ? 'active' : ''}`} onClick={() => pickCat(c.id)}>{pickLang(c, 'name', lang)}</button>))}
            </div>
          )}

          <div className="container">
            {!hasAnyItems ? (
              <Empty icon="menu" title={lang === 'ar' ? 'لا توجد أصناف' : 'No items'} />
            ) : search.trim() ? (
              visibleItems.length === 0 ? <Empty icon="search" title={lang === 'ar' ? 'لا نتائج' : 'No results'} /> : renderItems(visibleItems)
            ) : (
              // Grouped by category whenever there is NO search — headings and all.
              // This used to be gated on `activeCat === 'all'`, which was fine while
              // a category filtered the list. Once a category became a destination
              // instead, that gate flattened the whole menu into one unlabelled,
              // category-interleaved list the moment a chip was tapped: no
              // headings, no way to tell one section from the next. The grouping
              // is also what the category jump scrolls to.
              <>
                {sortedCats.map((c) => {
                  const list = itemsByCat[c.id] || []
                  if (!list.length) return null
                  return (<section key={c.id}><h3 className="cat-heading">{pickLang(c, 'name', lang)}</h3>{renderItems(list)}</section>)
                })}
                {(itemsByCat._uncat || []).length > 0 && (<section><h3 className="cat-heading">{lang === 'ar' ? 'أخرى' : 'Other'}</h3>{renderItems(itemsByCat._uncat)}</section>)}
              </>
            )}
          </div>
        </>
      )}

      {/* diner bottom nav (cart placed in the center) — hideable per venue */}
      {!isHidden('bottomNav') && (
        <DinerNav
          slug={tenant?.slug} tenant={tenant} active="menu" cartCount={cartCount} readyCount={readyCount}
          onMenu={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          onOrders={() => setOrdersOpen(true)}
          onCart={() => setCartOpen(true)}
          onOffers={() => setOffersOpen(true)}
          onEvents={() => setEventsOpen(true)}
          onReservations={() => setReserveOpen(true)}
        />
      )}

      {/* waiter call — table context + venue toggle; opens a note sheet so the
          guest can say WHAT they need ("ماء للطاولة 4"، "الحساب"، …) */}
      {/* THE BUTTON REPORTS THE FLOOR, it does not just fire and forget.
          The old confirmation toast claimed «في الطريق إليك» the instant the
          guest tapped — before any human had seen it. Now the button itself
          carries the live state of their call: waiting, then «النادل في الطريق»
          once a staffer actually claims it. A guest who can see they were heard
          does not tap four more times. */}
      {table && waiterEnabled && (
        <button className={`m-waiter-fab${myCall ? ' is-live' : ''}`} data-callstate={myCall ? (myCall.status === 'ack' ? 'ack' : 'open') : undefined}
          onClick={() => setWaiterOpen(true)}
          aria-label={myCall && myCall.status === 'ack' ? (lang === 'ar' ? 'النادل في الطريق' : 'Waiter on the way') : t('callWaiter')}>
          <Icon name="waiter" size={22} />
          {myCall && (
            <span className="m-waiter-tag">
              {myCall.status === 'ack'
                ? (lang === 'ar' ? 'في الطريق' : 'On the way')
                : (lang === 'ar' ? 'وصل نداؤك' : 'Sent')}
            </span>
          )}
        </button>
      )}

      <Sheet open={waiterOpen} onClose={() => setWaiterOpen(false)} title={`${t('callWaiter')}${table?.label ? ` · ${table.label}` : ''}`}
        footer={<button className="btn btn-primary btn-lg btn-block" disabled={waiterBusy} onClick={async () => {
          setWaiterBusy(true)
          try {
            // callOrAppend, not callWaiter: a table that already has a live call
            // gets this need appended to it instead of spawning a second row for
            // the floor to triage. It also carries the table's open order, so the
            // waiter reads the request and the context in one line.
            const id = await callOrAppend(tenantId, {
              callId: myCallId || '',
              tableId: table?.id || null,
              tableLabel: table?.label || '',
              reason: waiterNote.trim() || (waiterIntent ? intentLabel(waiterIntent, lang) : 'call'),
              intent: waiterIntent || 'call',
              orderId: activeOrder?.id || null,
              orderCode: activeOrder?.code || '',
            })
            if (id && callKey) {
              try { localStorage.setItem(callKey, id) } catch (_) { /* ignore */ }
              setMyCallId(id)
            }
            setWaiterOpen(false); setWaiterNote(''); setWaiterIntent('')
            toast.success(lang === 'ar' ? 'وصل نداؤك' : 'Your call was sent')
          } catch (_) { toast.error(t('error')) }
          finally { setWaiterBusy(false) }
        }}>{waiterBusy ? t('saving') : (lang === 'ar' ? 'نداء النادل' : 'Call waiter')}</button>}>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {CALL_QUICK.map((q) => {
              const label = lang === 'en' ? q.en : q.ar
              return (
                <button key={q.intent} type="button" className={`chip ${waiterIntent === q.intent ? 'active' : ''}`}
                  onClick={() => { setWaiterIntent(q.intent); setWaiterNote(label) }}>
                  <Icon name={q.icon} size={14} /> {label}
                </button>
              )
            })}
          </div>
          <textarea className="textarea" rows={2} value={waiterNote}
            onChange={(e) => { setWaiterNote(e.target.value); setWaiterIntent('') }}
            placeholder={lang === 'ar' ? 'أو اكتب طلبك للنادل… (اختياري)' : 'Or write what you need… (optional)'} />
        </div>
      </Sheet>

      {/* floating actions: notifications bell — each with a count badge */}
      {(() => {
        const hd = resolveMenuHeader(tenant)
        const bellPos = hd.bellPos || 'float-top-start'
        if (isHidden('notifications') || bellPos === 'hero' || bellPos === 'header-start' || bellPos === 'header-end') return null
        return (
          <button
            className={`m-fab m-fab-bell db-${bellPos}`}
            style={(hd.bellOffsetX || hd.bellOffsetY) ? { transform: `translate(${hd.bellOffsetX || 0}px, ${hd.bellOffsetY || 0}px)` } : undefined}
            onClick={() => setNotifOpen(true)}
            aria-label={t('notificationsTitle')}
          >
            {mch?.elements?.bellFab?.icon
              ? <img className="mch-icon" src={mch.elements.bellFab.icon} alt="" />
              : <Icon name="bell" size={20} />}
            {unreadCount > 0 && <span className="b">{unreadCount}</span>}
          </button>
        )
      })()}

      <MyOrdersSheet open={ordersOpen} onClose={() => setOrdersOpen(false)} refs={myOrderRefs} docs={orderDocs} slug={tenant?.slug} navigate={navigate} />
      <NotificationsSheet open={notifOpen} onClose={() => setNotifOpen(false)} items={notifItems} lastSeen={lastSeen} onMarkRead={markAllRead} slug={tenant?.slug} navigate={navigate} />
      <OffersSheet open={offersOpen} onClose={() => setOffersOpen(false)} promos={promos} offeredItems={offeredItems} currency={currency} onPick={(it) => { setOffersOpen(false); setViewItem(it) }} />

      {eventsOpen && (
        <EventsSheet
          tenantId={tenantId} currency={currency}
          onlinePay={tenant?.onlinePayment?.enabled === true}
          onClose={() => setEventsOpen(false)}
          onBooked={(id) => { setEventsOpen(false); navigate(`/pass/${tenant?.slug}/ticket/${id}`) }}
        />
      )}
      {reserveOpen && (
        <ReserveSheet
          tenantId={tenantId}
          onClose={() => setReserveOpen(false)}
          onBooked={(id) => { setReserveOpen(false); navigate(`/pass/${tenant?.slug}/reservation/${id}`) }}
        />
      )}

      {viewItem && (itemDetail === 'editorial' ? (
        /* editorial detail: FLIP photo-expand full-screen stage (ordering included) */
        <EditorialItemStage
          item={viewItem} tenant={tenant} currency={currency} originRect={openRect}
          allItems={allActive} offers={offers}
          onQuickAdd={quickAdd}
          initialLine={viewLine && viewLine.itemId === viewItem.id ? viewLine : null}
          onOpenItem={(p) => { setViewLine(null); setOpenRect(null); setViewItem(p) }}
          hidePrep={isHidden('prepTime')} hideServes={isHidden('serves')}
          onClose={() => { setViewItem(null); setOpenRect(null); setViewLine(null) }}
          onAdd={(variant, mods, qty) => {
            // opened from a cart row → REPLACE that line (drop then re-add);
            // plain addLine would MERGE by key and double the quantity
            if (viewLine && viewLine.itemId === viewItem.id) setQty(viewLine.key, 0)
            addLine(viewItem, variant, mods, qty); setViewItem(null); setOpenRect(null); setViewLine(null)
          }}
        />
      ) : (
        <ItemSheet item={viewItem} tenant={tenant} currency={currency} tenantId={tenantId} detail={itemDetail} siblings={visibleItems}
          initialLine={viewLine && viewLine.itemId === viewItem.id ? viewLine : null}
          onNavigate={(it) => { setViewLine(null); setViewItem(it) }} onClose={() => { setViewItem(null); setViewLine(null) }} onOpenStory={(it) => setStoryItem(it)}
          onAdd={(variant, mods, qty) => {
            if (viewLine && viewLine.itemId === viewItem.id) setQty(viewLine.key, 0)
            addLine(viewItem, variant, mods, qty); setViewItem(null); setViewLine(null)
          }} />
      ))}

      {/* Venue ad / welcome popup. It decides for itself whether anything is
          due (schedule, audience, trigger, per-guest frequency) and renders
          nothing when it is not — so mounting it is always safe.

          NOT while a full-screen experience is open. The popup paints at
          z-index 420 across the whole viewport, which is ABOVE the games hub
          and the item stage: an ad that fired mid-game silently swallowed
          every tap on the board, and the game read as frozen. Caught by a
          WebKit hit-test during Ludo testing — the tap that should have
          reached a token was landing on `.adx-backdrop`. A guest deep in a
          game or reading a dish is mid-task; the ad waits for them to come
          back out. */}
      {!preview && tenant?.adsEnabled !== false && !fxOpen && !viewItem && (
        <Suspense fallback={null}>
          <AdPopup
            tenant={tenant} tenantId={tenantId} items={visibleItems} categories={sortedCats} lang={lang}
            ctx={{ visitCount: (getMyOrders(tenantId) || []).length, isMember: !!memberCard?.active }}
            onNavigate={(target) => {
              // resolveTarget() already verified the item/category still exists
              // and handled the url case itself, so this only routes in-app.
              if (!target) return
              if (target.link === 'item' && target.item) setViewItem(target.item)
              else if (target.link === 'category' && target.categoryId) pickCat(target.categoryId)
              else if (target.link === 'games') setFxOpen('games')
              else if (target.link === 'story') setFxOpen('')
            }}
          />
        </Suspense>
      )}

      {/* interactive-experience overlays (lazy; one at a time) */}
      {fxOpen && (
        <Suspense fallback={null}>
          {/* The AI engines re-validate server-matched ids against allItems —
              the FULL active menu — never the tab/search-filtered visibleItems,
              which would silently drop a correctly understood dish. The cloud
              engine is gated off in the studio preview (no quota burn). */}
          {fxOpen === 'voice' && (
            <VoiceWaiter
              open items={visibleItems} allItems={allActive} tenant={tenant} tenantId={tenantId}
              cloudEnabled={!preview} lang={lang} currency={currency}
              onClose={() => setFxOpen('')}
              onAdd={(item, variant, mods, qty) => addLine(item, variant, mods || [], qty || 1)}
              onOpenItem={(it) => { setFxOpen(''); setViewItem(it) }}
            />
          )}
          {fxOpen === 'photo' && (
            <PhotoOrder
              open items={visibleItems} allItems={allActive} tenant={tenant} tenantId={tenantId}
              cloudEnabled={!preview} lang={lang} currency={currency}
              onClose={() => setFxOpen('')}
              onPick={(it) => { setFxOpen(''); setViewItem(it) }}
            />
          )}
          {fxOpen === 'read' && (
            <VoiceMenuReader
              open cats={sortedCats} itemsByCat={itemsByCat} lang={lang} currency={currency}
              onClose={() => setFxOpen('')}
              onOpenItem={(it) => { setFxOpen(''); setViewItem(it) }}
              onAdd={(item) => addLine(item, (item.variants || [])[0] || null, [], 1)}
            />
          )}
          {fxOpen === 'world' && (
            <Menu3DWorld
              open items={visibleItems} cats={sortedCats} lang={lang} currency={currency}
              onClose={() => setFxOpen('')}
              onOpenItem={(it) => { setFxOpen(''); setViewItem(it) }}
            />
          )}
          {fxOpen === 'compare' && (
            <CompareItems
              open items={visibleItems} lang={lang} currency={currency}
              hidden={hiddenEls}
              onClose={() => setFxOpen('')}
              onOpenItem={(it) => { setFxOpen(''); setViewItem(it) }}
            />
          )}
          {fxOpen === 'games' && (
            <GamesCenter
              open tenantId={tenantId} tenant={tenant} items={visibleItems} lang={lang}
              table={table}
              joinRoomId={joinRoom.room} joinGameId={joinRoom.game}
              onClose={() => setFxOpen('')}
              onIdentify={(who) => { try { setSavedCustomer(who); identify?.(who) } catch (_) { /* tracking is best-effort */ } }}
              onGamePlay={(gameId, score) => { try { trackGame(gameId, score) } catch (_) { /* best-effort */ } }}
            />
          )}
          {fxOpen === 'table' && table?.id && (
            <SharedCart
              open tenantId={tenantId} table={table} currency={currency} lang={lang}
              onClose={() => setFxOpen('')}
              onPlaceOrder={placeTableOrder}
            />
          )}
        </Suspense>
      )}

      {storyItem && (
        <Suspense fallback={null}>
          <DishStoryReader open item={storyItem} tenant={tenant} lang={lang} onClose={() => setStoryItem(null)} />
        </Suspense>
      )}

      {cartOpen && !preview && <CheckoutTracker />}
      {cartOpen && (
        <CartSheet
          cart={cart} subtotal={subtotal} currency={currency} offers={offers}
          tenant={tenant} tenantId={tenantId} table={table} partySize={partySize}
          orderType={orderType} setOrderType={setOrderType} car={car} setCar={setCar} curbsideEnabled={curbsideEnabled}
          initialProfile={savedCustomer} preview={preview}
          onProfileSaved={setSavedCustomer}
          onQty={setQty} onClose={() => setCartOpen(false)}
          // cart line → its full item record. Resolved against the RAW items
          // prop, not allActive: a line added before its time-window closed
          // must still open. The detail mounts after the cart's portal, so it
          // paints above and closing it returns to the intact cart.
          onOpenItem={(l) => { const it = (items || []).find((i) => i.id === l.itemId); if (it) { setViewLine(l); setViewItem(it) } }}
          onPlaced={(id) => { setCart([]); setCartOpen(false); onPlaced?.(id) }}
        />
      )}

      {/* Never over a full-screen experience: the sheet painted across the
          lower half of a running game board (caught in a WebKit screenshot).
          Same guest-is-mid-task rule as the ad popup — the question waits
          until they come back out to the menu. */}
      <OrderTypeGate
        open={typeGateOpen && !fxOpen && !viewItem} curbsideEnabled={curbsideEnabled} deliveryEnabled={deliveryEnabled}
        onPick={(type) => { setOrderType(type); setTypeGateOpen(false) }}
        onClose={() => setTypeGateOpen(false)}
      />
      {regOpen && (
        <RegisterSheet
          tenantId={tenantId} tenantName={tenant?.name}
          onClose={() => setRegOpen(false)}
          onSaved={(p) => { setSavedCustomer(p); setRegOpen(false); dismissRegister(tenantId); setRegDismissed(true) }}
        />
      )}
    </div>
  )
}

// ---- spotlight helpers ----
const SPOT_HOT_RE = /قهوة|شاي|ساخن|حار|لات[يه]ه?|كابت|إسبر|اسبر|موكا|هوت|hot|latte|cappu|espresso|mocha|macchiato|americano|chai/i
const SPOT_COLD_RE = /بارد|مثلج|آيس|ايس|ثلج|فراب|عصير|سموذ|ليمون|شيك|ice|cold|frapp|smoothie|iced|lemonade|juice|shake/i

// Fly a ghost clone of the product image toward the cart (bottom-center) on add.
function spotFlyToCart(fromEl, src) {
  try {
    if (fromEl && src && typeof document !== 'undefined') {
      const r = fromEl.getBoundingClientRect()
      const ghost = document.createElement('img')
      ghost.src = src; ghost.className = 'spot-fly'
      ghost.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`
      document.body.appendChild(ghost)
      const tx = window.innerWidth / 2 - (r.left + r.width / 2)
      const ty = (window.innerHeight - 42) - (r.top + r.height / 2)
      requestAnimationFrame(() => { ghost.style.transform = `translate(${tx}px,${ty}px) scale(0.14)`; ghost.style.opacity = '0.12' })
      setTimeout(() => ghost.remove(), 700)
    }
  } catch (_) { /* ignore */ }
  try { if (navigator.vibrate) navigator.vibrate(12) } catch (_) { /* ignore */ }
}

// One full-viewport product "slide": big image (tilt + float + entrance),
// color-adaptive halo, ambient steam/ice, nutrition flip, inline size + qty,
// direct add (flies to cart), "customize", and "goes well with" pairings.
function SpotSlide({ it, slideId, currency, offers, catName, suggestions = [], onAdd, onOpen, onQuickAdd, hidePrep = false }) {
  const { t, lang } = useI18n()
  const ref = useRef(null)
  const tiltRef = useRef(null)
  const [inview, setInview] = useState(false)
  const [variant, setVariant] = useState(() => (it.variants && it.variants.length ? it.variants[0] : null))
  const [qty, setQty] = useState(1)
  const [flipped, setFlipped] = useState(false)
  // playback window for the legacy spot video (item.videoTrim — engine-only,
  // the field has no uploader; a null trim attaches nothing)
  const spotTrimRef = useVideoTrim(it.videoTrim)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((entries) => entries.forEach((e) => setInview(e.isIntersecting)), { threshold: 0.45 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const out = it.available === false || (it.trackStock && (it.stock || 0) <= 0)
  const offer = offerForItem(it, offers)
  const base = basePrice(it, variant)
  const unit = offer ? discountedPrice(base, offer) : base
  const desc = pickLang(it, 'desc', lang)
  const name = pickLang(it, 'name', lang)
  const hasSizes = !!(it.variants && it.variants.length > 1)
  const canCustomize = hasSizes || !!(it.modifiers && it.modifiers.length) || !!(it.modifierGroups && it.modifierGroups.length) || !!(it.options && it.options.length)
  const hasInfo = !!(it.calories || desc || it.allergens)
  const ambient = SPOT_HOT_RE.test(`${name} ${catName}`) ? 'hot' : SPOT_COLD_RE.test(`${name} ${catName}`) ? 'cold' : ''

  const onMove = (e) => {
    const el = tiltRef.current; if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--tiltX', `${(-(((e.clientY - r.top) / r.height) - 0.5) * 9).toFixed(2)}deg`)
    el.style.setProperty('--tiltY', `${((((e.clientX - r.left) / r.width) - 0.5) * 11).toFixed(2)}deg`)
  }
  const onLeave = () => { const el = tiltRef.current; if (el) { el.style.setProperty('--tiltX', '0deg'); el.style.setProperty('--tiltY', '0deg') } }
  const doAdd = () => { spotFlyToCart(tiltRef.current, it.imageUrl); onAdd(variant, [], qty) }

  return (
    <section ref={ref} id={slideId ? `spot-${slideId}` : undefined} data-id={slideId || undefined} className={`spot-slide ${inview ? 'in' : ''} ${out ? 'is-out' : ''}`}>
      <span className="spot-bg" aria-hidden="true" />
      <button type="button" className="spot-media" onClick={onOpen} aria-label={name} onPointerMove={onMove} onPointerLeave={onLeave}>
        <span className="spot-tilt" ref={tiltRef}>
          <span className={`spot-flip ${flipped ? 'flipped' : ''}`}>
            <span className="spot-face spot-front">
              {it.videoUrl
                ? <video ref={spotTrimRef} className="spot-img" src={it.videoUrl} autoPlay muted loop playsInline />
                : it.imageUrl
                  ? <img className="spot-img" src={it.imageUrl} alt="" decoding="async" />
                  : <span className="spot-img spot-noimg"><Icon name="coffee" size={90} /></span>}
              {it.effect
                ? <ItemFx kind={it.effect} />
                : (
                  <>
                    {ambient === 'hot' && <span className="spot-steam" aria-hidden="true"><i /><i /><i /></span>}
                    {ambient === 'cold' && <span className="spot-cold" aria-hidden="true" />}
                  </>
                )}
            </span>
            <span className="spot-face spot-back">
              <strong>{lang === 'ar' ? 'التفاصيل' : 'Details'}</strong>
              {it.calories ? <span className="spot-back-cal"><Icon name="flame" size={14} /> {it.calories} {lang === 'ar' ? 'سعرة حرارية' : 'cal'}</span> : null}
              {desc && <span className="spot-back-desc">{desc}</span>}
              {it.allergens && <span className="spot-back-al">{lang === 'ar' ? 'قد يحتوي: ' : 'May contain: '}{it.allergens}</span>}
            </span>
          </span>
        </span>
      </button>
      {hasInfo && (
        <button type="button" className="spot-info" onClick={() => setFlipped((f) => !f)} aria-label={lang === 'ar' ? 'التفاصيل' : 'Details'}>
          <Icon name={flipped ? 'close' : 'notepad'} size={16} />
        </button>
      )}
      <div className="spot-panel">
        {catName && <span className="spot-kicker">{catName}</span>}
        <h2 className="spot-name">{name}</h2>
        {desc && <p className="spot-desc">{desc}</p>}
        <div className="spot-meta">
          {it.calories ? <span><Icon name="flame" size={14} /> {it.calories} {lang === 'ar' ? 'سعرة حرارية' : 'cal'}</span> : null}
          {!hidePrep && it.prepTime ? <span><Icon name="clock" size={14} /> {it.prepTime} {t('minutesShort')}</span> : null}
          {it.rating ? <span><Icon name="star" size={14} fill="currentColor" strokeWidth={1.5} /> {it.rating}</span> : null}
        </div>
        {hasSizes && (
          <div className="spot-sizes">
            {it.variants.map((v) => (
              <button key={v.key} type="button" className={`spot-size ${variant && variant.key === v.key ? 'on' : ''}`} onClick={() => setVariant(v)}>{pickLang(v, 'name', lang)}</button>
            ))}
          </div>
        )}
        {out ? (
          <div className="spot-soldout">{t('soldOut')}</div>
        ) : (
          <>
            <div className="spot-row">
              <Stepper value={qty} onChange={setQty} min={1} max={99} />
              <div className="spot-price"><Price value={unit * qty} currency={currency} lang={lang} />{offer && <span className="price-was"><Price value={base * qty} currency={currency} lang={lang} /></span>}</div>
            </div>
            <div className="spot-actions">
              <button type="button" className="spot-add menu-grad" onClick={doAdd}><Icon name="add" size={18} /> {t('addToCart')}</button>
              {canCustomize && <button type="button" className="spot-custom" onClick={onOpen}>{lang === 'ar' ? 'خصّص' : 'Customize'}</button>}
            </div>
            {suggestions.length > 0 && (
              <div className="spot-pair">
                <span className="spot-pair-lbl">{lang === 'ar' ? 'يُطلب معه' : 'Goes well with'}</span>
                <div className="spot-pair-row">
                  {suggestions.map((s) => (
                    <button key={s.id} type="button" className="spot-pair-item" onClick={() => onQuickAdd(s)}>
                      <span className="spot-pair-media">{s.imageUrl ? <img src={s.imageUrl} alt="" loading="lazy" decoding="async" /> : <Icon name="coffee" size={16} />}</span>
                      <span className="spot-pair-name">{pickLang(s, 'name', lang)}</span>
                      <span className="spot-pair-add"><Icon name="add" size={12} /></span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

// Full-bleed "chapter" cover shown before each category's products.
function SpotCover({ cat, item, lang }) {
  const ref = useRef(null)
  const [inview, setInview] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((entries) => entries.forEach((e) => setInview(e.isIntersecting)), { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const img = cat?.coverUrl || cat?.imageUrl || item?.imageUrl
  const cdesc = pickLang(cat, 'desc', lang)
  return (
    <section ref={ref} className={`spot-cover ${inview ? 'in' : ''}`}>
      {img && <span className="spot-cover-bg" style={{ backgroundImage: `url(${img})` }} aria-hidden="true" />}
      <span className="spot-cover-veil" aria-hidden="true" />
      <div className="spot-cover-in">
        <span className="spot-cover-kick">{lang === 'ar' ? 'المنيو' : 'The Menu'}</span>
        <h2 className="spot-cover-name">{pickLang(cat, 'name', lang)}</h2>
        {cdesc && <p className="spot-cover-desc">{cdesc}</p>}
        <span className="spot-cover-hint" aria-hidden="true"><Icon name="next" size={22} style={{ transform: 'rotate(90deg)' }} /></span>
      </div>
    </section>
  )
}

// Orchestrates the spotlight scroll: category covers + product slides, a
// side progress rail (dot per product, tap to jump), and the final cart CTA.
function SpotlightStage({ groups, allItems, currency, offers, onAdd, onOpen, onQuickAdd, cartCount, onCart, lang, showCovers = true, showPairings = true, hidePrep = false }) {
  const stageRef = useRef(null)
  const [activeId, setActiveId] = useState('')
  const flat = groups.flatMap((g) => g.items)
  useEffect(() => {
    const root = stageRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) setActiveId(e.target.getAttribute('data-id') || '') }), { threshold: 0.5 })
    root.querySelectorAll('.spot-slide[data-id]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [flat.length])

  const pairFor = (it) => {
    if (!showPairings) return []
    // Venue control: item.pairings = [itemId, …] curates the "goes well with" row.
    if (Array.isArray(it.pairings) && it.pairings.length) {
      return it.pairings.map((id) => allItems.find((x) => x.id === id)).filter(Boolean).slice(0, 3)
    }
    const pool = allItems.filter((x) => x.id !== it.id && x.imageUrl && x.available !== false)
    if (!pool.length) return []
    const start = ((it.id && it.id.charCodeAt(0)) || 0) % pool.length
    const pick = [pool[start], pool[(start + 3) % pool.length]]
    return pick.filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 2)
  }

  return (
    <div className="spot-stage" ref={stageRef}>
      {flat.length > 3 && (
        <div className="spot-rail">
          {flat.map((it) => (
            <button key={it.id} type="button" className={`spot-dot ${activeId === it.id ? 'on' : ''}`} aria-label={pickLang(it, 'name', lang)}
              onClick={() => { const el = document.getElementById(`spot-${it.id}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }} />
          ))}
        </div>
      )}
      {groups.map((g, gi) => (
        <div key={g.cat?.id || `g${gi}`} className="spot-group">
          {g.cat && showCovers && <SpotCover cat={g.cat} item={g.items[0]} lang={lang} />}
          {g.items.map((it) => (
            <SpotSlide key={it.id} it={it} slideId={it.id} currency={currency} offers={offers}
              catName={g.cat ? pickLang(g.cat, 'name', lang) : ''} suggestions={pairFor(it)}
              onAdd={(v, m, q) => onAdd(it, v, m, q)} onOpen={() => onOpen(it)} onQuickAdd={onQuickAdd} hidePrep={hidePrep} />
          ))}
        </div>
      ))}
      <div className="spot-end">
        <button className="spot-cart-btn menu-grad" onClick={onCart}>
          <Icon name="cart" size={18} /> {cartCount > 0 ? (lang === 'ar' ? `عرض السلة · ${cartCount}` : `View cart · ${cartCount}`) : (lang === 'ar' ? 'السلة' : 'Cart')}
        </button>
      </div>
    </div>
  )
}

// Public-menu order-type picker (no table) — external orders only:
// takeaway / curbside / delivery. Dine-in is reserved for table QR.
function OrderTypeGate({ open, curbsideEnabled, deliveryEnabled, onPick, onClose }) {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const Opt = ({ icon, label, sub, onClick }) => (
    <button className="otype-opt" onClick={onClick}>
      <span className="otype-ic"><Icon name={icon} size={26} /></span>
      <span className="grow stack" style={{ gap: 2, textAlign: 'start' }}>
        <strong>{label}</strong>
        {sub && <span className="xs faint">{sub}</span>}
      </span>
      <Icon name={ar ? 'back' : 'next'} size={18} className="faint" />
    </button>
  )
  return (
    <Sheet open={open} onClose={onClose} title={t('chooseOrderType')}>
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        {/* one vocabulary with the chips in the cart (orderTypeLabel) — this gate
            used to say «سفري» for the very type the chip below called «استلام من المحل» */}
        <Opt icon="bag" label={orderTypeLabel('pickup', lang)} sub={ar ? 'أستلم من الكاشير' : 'Pick up at the counter'} onClick={() => onPick('pickup')} />
        {curbsideEnabled && <Opt icon="car" label={orderTypeLabel('curbside', lang)} sub={ar ? 'يصل طلبك لسيارتك' : 'Brought to your car'} onClick={() => onPick('curbside')} />}
        {deliveryEnabled && <Opt icon="car" label={orderTypeLabel('delivery', lang)} sub={ar ? 'يصل طلبك إلى عنوانك' : 'Delivered to your address'} onClick={() => onPick('delivery')} />}
      </div>
    </Sheet>
  )
}

function RegisterSheet({ tenantId, tenantName, onClose, onSaved }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!name.trim() && !phone.trim()) { onClose(); return }
    setBusy(true)
    const p = { name: name.trim(), phone: phone.trim() }
    setLocalCustomer(p)
    // Persist to the venue's CRM — this is what makes campaigns/follow-ups reach
    // the guest and lets the menu greet them by name on every device revisit.
    if (p.phone) await registerCustomer(tenantId, p).catch(() => {})
    setBusy(false)
    toast.success(lang === 'ar' ? `أهلاً بك${p.name ? ` يا ${p.name}` : ''} في عائلة ${tenantName || 'المنشأة'}` : `Welcome${p.name ? `, ${p.name}` : ''}!`)
    onSaved(p)
  }
  return (
    <Sheet open onClose={onClose} title={lang === 'ar' ? 'انضم لعائلتنا' : 'Join our family'}
      footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={save}>{busy ? t('saving') : (lang === 'ar' ? 'انضمام' : 'Join')}</button>}>
      <div className="stack">
        <p className="muted small">{lang === 'ar' ? 'سجّل اسمك ورقمك لنتعرّف عليك في كل زيارة، نرصد نقاط ولائك، ويصلك جديدنا وعروضنا على واتساب.' : 'Save your name & phone: we recognize you each visit, track loyalty, and send news & offers on WhatsApp.'}</p>
        <div className="field">
          <label>{t('yourName')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('phone')}</label>
          <input className="input num" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <button className="btn btn-ghost" onClick={onClose}>{lang === 'ar' ? 'تخطّي' : 'Skip'}</button>
      </div>
    </Sheet>
  )
}

export function ItemSheet({ item, tenant, currency, tenantId, onClose, onAdd, detail = 'sheet', siblings = [], onNavigate, onOpenStory, initialLine = null }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const variants = item.variants || []
  const groups = item.modifierGroups || []
  const ingredients = item.ingredients || []
  // Full image gallery = primary first, then extras (deduped).
  const gallery = [...new Set([item.imageUrl, ...(item.images || [])].filter(Boolean))]
  // Frameless product by default in product-style themes (storefront/gallery); 'circle' for plate/food themes. Per-item override wins.
  const sheetLayout = resolveSkin(tenant, 'menu')?.layout?.menuLayout
  const globalImgStyle = resolveSkin(tenant, 'menu')?.itemImageStyle || ''
  const imgStyle = item.imageStyle || globalImgStyle || (['storefront', 'gallery'].includes(sheetLayout) ? 'float' : 'circle')
  // Per-product size of the image in THIS detail view. The bounds come from the
  // composition contract rather than being repeated here: this used to hard-clamp
  // to 1.8 while the editor's slider went to 2.6, so the last third of the slider
  // silently did nothing on this sheet.
  const detailScale = Math.min(RANGE.scale.max, Math.max(RANGE.scale.min, Number(item.imageScale) || 1))
  const scaleStyle = detailScale !== 1 ? { transform: `scale(${detailScale})`, transformOrigin: 'center' } : null
  // The perspective lean on this sheet's photo — the same contract wrapper the
  // editorial engine mounts (imgTiltBoxStyle: --dish-persp var + base origin
  // 50% 100%), clamped through RANGE.tilt exactly like the editor's slider.
  // The wrapper carries the 3D projection while scale stays 2D on the img
  // inside it; null when tilt is 0, so untouched items are byte-identical.
  const detailTilt = Math.min(RANGE.tilt.max, Math.max(RANGE.tilt.min, Number(item.imageTilt) || 0))
  const tiltBox = imgTiltBoxStyle({ tilt: detailTilt, blend: 'normal' })
  const [variant, setVariant] = useState(variants[0] || null)
  const [qty, setQty] = useState(1)
  const [selected, setSelected] = useState(() => groups.map(() => []))
  const [tab, setTab] = useState('info')
  const [reviews, setReviews] = useState(null)
  const [zoom, setZoom] = useState(false)
  // which zoom slide is in view — drives the ±1 decode window below
  const [zoomIdx, setZoomIdx] = useState(0)
  const [imgIdx, setImgIdx] = useState(0)
  const [arOpen, setArOpen] = useState(false)
  const hasAr = MENU_3D_ENABLED && (item.model3dUrl || item.arStandeeUrl) && tenant?.ar?.enabled !== false

  // CLOSE THE 3D STAGE WHEN THE DISH CHANGES.
  //
  // The sheet is reused across dishes (chevrons and the «يُطلب معه» chips swap
  // `item` without remounting), so leaving `arOpen` true handed a NEW model
  // source to the SAME live <model-viewer>. The viewer then re-measured a mesh
  // that still carried the previous dish's scale, and the size flip-flopped
  // between passes. Reopening per dish is also what a guest expects: the model
  // is a deliberate action, not a mode you stay in while browsing.
  useEffect(() => { setArOpen(false) }, [item?.id])

  // Immersive screen: chevrons / horizontal swipe move to the adjacent dish.
  const navEnabled = detail === 'immersive' && typeof onNavigate === 'function' && siblings.length > 1
  const navIdx = navEnabled ? siblings.findIndex((s) => s.id === item.id) : -1
  const prevItem = navIdx > 0 ? siblings[navIdx - 1] : null
  const nextItem = navIdx >= 0 && navIdx < siblings.length - 1 ? siblings[navIdx + 1] : null
  // Detail backdrop: the ITEM's own background (item.bgUrl — set per item in
  // the item editor) wins over the venue-wide immersive backdrop settings.
  const ownBg = item?.bgUrl || ''
  const imBg = ownBg ? (item.bgKind === 'video' ? '' : ownBg) : (tenant?.immersiveBgUrl || '')
  const imOpacity = ownBg ? (item.bgOpacity != null ? Number(item.bgOpacity) : 0.5) : (tenant?.immersiveBgOpacity != null ? tenant.immersiveBgOpacity : 0.5)
  const imPos = ownBg ? (item.bgPos || 'center') : (tenant?.immersiveBgPosition || 'center')
  const imScale = ownBg ? (item.bgScale != null ? Number(item.bgScale) : 1) : (tenant?.immersiveBgScale != null ? Number(tenant.immersiveBgScale) : 1)
  const imFull = detail === 'immersive' && tenant?.immersiveFull === true
  const touchRef = useRef(null)
  const onTouchStart = (e) => {
    // swipes that begin on the image carousel/zoom belong to the image gallery, not item navigation
    if (!navEnabled || e.target.closest('.dish-carousel') || e.target.closest('.img-zoom')) { touchRef.current = null; return }
    const tp = e.touches[0]; touchRef.current = { x: tp.clientX, y: tp.clientY }
  }
  const onTouchEnd = (e) => {
    if (!touchRef.current) return
    const tp = e.changedTouches[0]
    const dx = tp.clientX - touchRef.current.x, dy = tp.clientY - touchRef.current.y
    touchRef.current = null
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.4) return // ignore taps & vertical scrolls
    const target = dx < 0 ? nextItem : prevItem
    if (target) onNavigate(target)
  }

  useEffect(() => {
    if (tab !== 'reviews' || !tenantId) return
    return watchItemReviews(tenantId, item.id, setReviews)
  }, [tab, tenantId, item.id])

  // Reset per-item selections when navigating to an adjacent dish (the component stays mounted).
  useEffect(() => {
    // zoomIdx too: carrying dish A's slide index into dish B's shorter gallery
    // put every real image outside the ±1 decode window — a blank lightbox.
    // Opened from a CART ROW → seed the line's qty/variant/mods so the sheet
    // shows what was actually ordered (add then REPLACES the line upstream).
    const line = initialLine && initialLine.itemId === item.id ? initialLine : null
    setVariant((line?.variantKey && variants.find((v) => v.key === line.variantKey)) || variants[0] || null)
    setQty(line?.qty || 1)
    setSelected(groups.map((g) => line ? (g.options || []).filter((o) => (line.modifiers || []).some((m) => m.nameAr === o.nameAr)) : []))
    setTab('info'); setImgIdx(0); setZoom(false); setZoomIdx(0)
  }, [item.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (gi, opt) => {
    const g = groups[gi]
    const max = Number(g.max) || 0
    setSelected((sel) => {
      const cur = sel[gi] || []
      const exists = cur.find((o) => o.nameAr === opt.nameAr && o.nameEn === opt.nameEn)
      let next
      if (max === 1) next = exists ? [] : [opt]
      else if (exists) next = cur.filter((o) => o !== exists)
      else if (max > 0 && cur.length >= max) next = cur
      else next = [...cur, opt]
      return sel.map((s, i) => (i === gi ? next : s))
    })
  }

  const flatMods = groups.flatMap((g, gi) => (selected[gi] || []).map((o) => ({ nameAr: o.nameAr, nameEn: o.nameEn, price: Number(o.price) || 0, recipe: o.recipe || [] })))
  const modSum = flatMods.reduce((s, m) => s + m.price, 0)
  const price = (basePrice(item, variant) + modSum) * qty
  const missing = groups.find((g, gi) => {
    const need = Math.max(Number(g.min) || 0, g.required ? 1 : 0)
    return need > 0 && (selected[gi] || []).length < need
  })
  const add = () => {
    if (missing) { toast.error(`${lang === 'ar' ? 'اختر من' : 'Choose from'}: ${pickLang(missing, 'name', lang)}`); return }
    onAdd(variant, flatMods, qty)
  }

  const avgRating = reviews && reviews.length ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1) : null
  const displayRating = item.rating || avgRating
  const displayCount = item.reviewsCount || (reviews ? reviews.length || null : null)

  const imBgVideo = ownBg ? (item.bgKind === 'video' ? ownBg : '') : (tenant?.immersiveBgVideoUrl || '')
  // The trim source MIRRORS the url source line-for-line (ownBg wins): the
  // item's own backdrop window or the venue-wide immersive one, never a mix.
  const imBgTrim = ownBg ? (item.bgKind === 'video' ? item.bgVideoTrim : null) : (tenant?.immersiveBgVideoTrim || null)
  const imBgTrimRef = useVideoTrim(imBgTrim)
  const bgNode = (imBgVideo || imBg) ? (
    <div className="sheet-bg-media-layer" style={{ '--immersive-overlay-opacity': String(1 - imOpacity) }} aria-hidden="true">
      {imBgVideo ? (
        // item-detail video honors the same opacity / pan / zoom controls as images
        <video ref={imBgTrimRef} className="sheet-bg-video" src={imBgVideo} autoPlay muted loop playsInline preload="auto" style={{ objectPosition: imPos, opacity: imOpacity, objectFit: 'cover', transform: imScale > 1 ? `scale(${imScale})` : undefined, transformOrigin: imPos }} />
      ) : imBg ? (
        <div className="sheet-bg-image" style={{ backgroundImage: `url(${imBg})`, backgroundSize: imScale > 1 ? `${imScale * 100}%` : 'cover', backgroundPosition: imPos, opacity: imOpacity }} />
      ) : null}
    </div>
  ) : null

  const isImmersive = detail === 'immersive'

  return (
    <Sheet open onClose={onClose} title={pickLang(item, 'name', lang)} tall={isImmersive} full={imFull || isImmersive}
      className={(imBgVideo || imBg) ? 'sheet-immersive' : ''}
      bgNode={bgNode}
      footer={onAdd ? <button className="btn btn-lg btn-block menu-grad" onClick={add}>{t('addToCart')} · <Price value={price} currency={currency} lang={lang} /></button> : null}>
      <div className={`stack${navEnabled ? ' item-pane' : ''}`} data-item-detail={detail} key={item.id} onTouchStart={navEnabled ? onTouchStart : undefined} onTouchEnd={navEnabled ? onTouchEnd : undefined}>
        {detail === 'immersive' && <div className="dish-immersive-band" />}
        {navEnabled && prevItem && (
          <button type="button" className="dish-nav-btn start" onClick={() => onNavigate(prevItem)} aria-label={lang === 'ar' ? 'السابق' : 'Previous'}><Icon name={lang === 'ar' ? 'next' : 'back'} size={20} /></button>
        )}
        {navEnabled && nextItem && (
          <button type="button" className="dish-nav-btn end" onClick={() => onNavigate(nextItem)} aria-label={lang === 'ar' ? 'التالي' : 'Next'}><Icon name={lang === 'ar' ? 'back' : 'next'} size={20} /></button>
        )}
        {gallery.length === 1 ? (
          /* the tilt wrapper rides the EXISTING outer span (img + fx tilt
             together, so steam stays attached to a leaned plate); the span
             shrink-wraps the img, so origin 50% 100% is the photo's base */
          <span style={{ position: 'relative', display: 'inline-block', ...(tiltBox || {}) }}>
            <img className="dish-circle" data-imgstyle={imgStyle} src={gallery[0]} alt={pickLang(item, 'name', lang)} decoding="async" onClick={() => setZoom(true)} style={{ cursor: 'zoom-in', ...scaleStyle }} />
            <ItemFx kind={item.effect} />
          </span>
        ) : gallery.length > 1 ? (
          <div className="dish-stack">
            <div className="dish-carousel" onScroll={(e) => { const w = e.currentTarget.clientWidth || 1; setImgIdx(Math.min(gallery.length - 1, Math.round(Math.abs(e.currentTarget.scrollLeft) / w))) }}>
              {gallery.map((src, i) => (
                <div key={i} className="dish-slide" style={{ position: 'relative', ...(tiltBox || {}) }}>
                  {/* zoom starts on the slide being viewed, not always the first photo */}
                  <img className="dish-circle" data-imgstyle={imgStyle} src={src} alt="" decoding="async" onClick={() => { setZoomIdx(imgIdx); setZoom(true) }} style={{ cursor: 'zoom-in', ...scaleStyle }} />
                  {i === imgIdx && <ItemFx kind={item.effect} />}
                </div>
              ))}
            </div>
            <div className="dish-dots">{gallery.map((_, i) => <span key={i} className={i === imgIdx ? 'on' : ''} />)}</div>
          </div>
        ) : null}
        {/* fullscreen swipeable lightbox — shared GalleryZoom (the ±1 decode
            window and the Escape handling live inside the component now) */}
        {zoom && gallery.length > 0 && (
          <GalleryZoom gallery={gallery} startIdx={zoomIdx} onClose={() => { setZoom(false); setZoomIdx(0) }} />
        )}
        <div className="dish-details-pane grow stack" style={{ gap: 'var(--sp-4)' }}>
          <div className="text-center stack" style={{ gap: 6, alignItems: 'center' }}>
            <strong style={{ fontSize: 'var(--fs-lg)' }}>{pickLang(item, 'name', lang)}</strong>
            <div className="row wrap" style={{ gap: 12, justifyContent: 'center' }}>
              {displayRating ? <span className="rating"><Icon name="star" size={15} fill="currentColor" strokeWidth={1.5} /> {displayRating}{displayCount ? ` (${displayCount})` : ''}</span> : null}
              {!(resolveSkin(tenant, 'menu')?.hidden || []).includes('prepTime') && item.prepTime ? <span className="time-chip"><Icon name="clock" size={14} /> {item.prepTime} {t('minutesShort')}</span> : null}
              {!(resolveSkin(tenant, 'menu')?.hidden || []).includes('serves') && item.serves ? <span className="time-chip"><Icon name="customers" size={14} /> {item.serves}</span> : null}
              {item.calories ? <span className="time-chip"><Icon name="flame" size={14} /> {item.calories}</span> : null}
            </div>
            {onOpenStory && hasStory(item) && <StoryBadge lang={lang} onClick={() => onOpenStory(item)} />}
          </div>

          <div className="dish-tabs">
            <button className={`dish-tab ${tab === 'info' ? 'on' : ''}`} onClick={() => setTab('info')}>{t('information')}</button>
            <button className={`dish-tab ${tab === 'reviews' ? 'on' : ''}`} onClick={() => setTab('reviews')}>{t('reviewsTab')}</button>
          </div>

          {tab === 'info' ? (
            <div className="stack">
              {pickLang(item, 'desc', lang) && <p className="muted">{pickLang(item, 'desc', lang)}</p>}

              {variants.length > 0 && (
                <div className="field">
                  <label>{t('variants')}</label>
                  <div className="row wrap" style={{ gap: 8 }}>
                    {variants.map((v) => (<button key={v.key} className={`chip ${variant?.key === v.key ? 'active' : ''}`} onClick={() => setVariant(v)}>{pickLang(v, 'name', lang)}{variantHasOwnPrice(v) ? <> · <Price value={v.price} currency={currency} lang={lang} /></> : null}</button>))}
                  </div>
                </div>
              )}

              {groups.map((g, gi) => {
                // A max:1 group already BEHAVES as a radio (toggle() replaces
                // rather than appends), but it looked exactly like a
                // multi-select one — so a guest tapped a second size, watched
                // the first silently clear, and had no way to know why. Say it,
                // and mark the chips with role=radio so it also reads correctly
                // to a screen reader.
                const single = Number(g.max) === 1
                return (
                <div key={gi} className="field">
                  <label>
                    {pickLang(g, 'name', lang)}
                    {(g.required || Number(g.min) > 0) ? <span style={{ color: 'var(--danger)' }}> *</span> : <span className="faint xs"> ({t('optional')})</span>}
                    {single && <span className="faint xs"> · {lang === 'ar' ? 'اختر واحداً' : 'choose one'}</span>}
                  </label>
                  <div className="row wrap" style={{ gap: 8 }} role={single ? 'radiogroup' : 'group'} aria-label={pickLang(g, 'name', lang)}>
                    {(g.options || []).map((o, oi) => {
                      const on = (selected[gi] || []).some((x) => x.nameAr === o.nameAr && x.nameEn === o.nameEn)
                      return (<button key={oi} className={`chip ${on ? 'active' : ''}`} role={single ? 'radio' : undefined} aria-checked={single ? on : undefined} aria-pressed={single ? undefined : on} onClick={() => toggle(gi, o)}>{pickLang(o, 'name', lang)}{Number(o.price) ? <> +<Price value={o.price} currency={currency} lang={lang} /></> : ''}</button>)
                    })}
                  </div>
                </div>
                )
              })}

              {ingredients.length > 0 && (
                <div className="field">
                  <label>{t('ingredients')}</label>
                  <div className="ing-row">
                    {ingredients.map((ing, i) => (
                      <div key={i} className="ingredient">
                        {/* hard rule: never render the stored emoji — initial letter chip instead */}
                        <span className="ic">{(pickLang(ing, 'name', lang) || '·').charAt(0)}</span>
                        <span className="nm">{pickLang(ing, 'name', lang)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {hasAr && (
                <button type="button" className="ar-btn" onClick={() => setArOpen(true)}>
                  <Icon name="scan" size={16} />
                  <span>{lang === 'ar' ? 'اعرضه على طاولتك (AR)' : 'View on your table (AR)'}</span>
                </button>
              )}
              {arOpen && <ArStage item={item} tenant={tenant} lang={lang} onClose={() => setArOpen(false)} />}
              <div className="row-between">
                <span className="bold">{t('qty')}</span>
                <Stepper value={qty} onChange={setQty} />
              </div>
            </div>
          ) : (
            <ReviewsTab reviews={reviews} />
          )}
        </div>
      </div>
    </Sheet>
  )
}

// AR stage — its own immersive theme (tenant.ar.style), independent of the menu
// skin. Renders <model-viewer>: real AR via Scene Viewer (Android) / Quick Look
// (iOS) with camera-controls 3D preview inline. Loaded lazily (heavy bundle).
function ArStage({ item, tenant, lang, onClose }) {
  const ar = lang === 'ar'
  // <ARViewer> owns loading/unsupported/error + the single-context teardown; we
  // keep its coarse phase to gate our own hint, and forward the AR-session status.
  const [phase, setPhase] = useState('loading') // loading | ready | unsupported | error
  const [arFailed, setArFailed] = useState(false)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const isUsdzMain = /\.usdz($|\?)/i.test(item.model3dUrl || '')
  const glb = isUsdzMain ? (item.arStandeeUrl || '') : (item.model3dUrl || item.arStandeeUrl || '')
  // iPhone Quick Look accepts ONLY USDZ — the realistic pipeline stores one
  // alongside the GLB (item.model3dUsdzUrl); an uploaded .usdz main model works too.
  const usdz = item.model3dUsdzUrl || (isUsdzMain ? item.model3dUrl : '')
  const name = ar ? (item.nameAr || item.nameEn) : (item.nameEn || item.nameAr)
  return (
    <div className="ar-stage" data-artheme={tenant?.ar?.style || 'noir'} onClick={(e) => e.stopPropagation()}>
      <div className="ar-stage-head">
        <strong>{name}</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="close" style={{ color: 'inherit' }}><Icon name="close" size={20} /></button>
      </div>
      <div className="ar-stage-body" style={{ position: 'relative' }}>
        <ARViewer
          glb={glb}
          usdz={usdz}
          alt={name}
          lang={lang}
          heightCm={item?.realHeightCm}
          onPhaseChange={setPhase}
          onArStatus={(s) => { if (s === 'failed') setArFailed(true) }}
        />
        {phase === 'ready' && <ItemFx kind={item.effect} scale={1.4} />}
      </div>
      {arFailed ? (
        <p className="ar-stage-hint" style={{ color: 'var(--danger, #e5484d)' }}>
          {ar
            ? 'تعذر بدء الواقع المعزز على هذا الجهاز: على أندرويد ثبّت «Google Play Services for AR» من المتجر وافتح الرابط في Chrome نفسه (لا من متصفح داخل تطبيق آخر)، وعلى آيفون افتح في Safari.'
            : 'AR could not start: on Android install "Google Play Services for AR" and open in Chrome itself (not an in-app browser); on iPhone use Safari.'}
        </p>
      ) : (phase !== 'unsupported' && phase !== 'error') ? (
        <p className="ar-stage-hint">{ar ? 'اضغط أيقونة AR داخل العارض، ثم وجّه الكاميرا إلى الطاولة ليقف الصنف عليها.' : 'Tap the AR icon inside the viewer and point at your table.'}</p>
      ) : null}
    </div>
  )
}

function ReviewsTab({ reviews }) {
  const { t, lang } = useI18n()
  return (
    <div className="stack">
      {reviews === null ? (
        <Spinner />
      ) : reviews.length === 0 ? (
        <Empty icon="star" title={t('noReviews')} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {reviews.map((r) => (
            <div key={r.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <strong className="small">{r.name || (lang === 'ar' ? 'ضيف' : 'Guest')}</strong>
                  <span className="rating">{Array.from({ length: 5 }).map((_, i) => <Icon key={i} name="star" size={12} fill="currentColor" strokeWidth={1.5} style={{ color: i < (r.rating || 0) ? 'var(--gold)' : 'var(--text-faint)' }} />)}</span>
                  {/* provenance label — imported reviews must declare their source */}
                  {r.source === 'google' && <span className="badge" style={{ fontSize: 10, padding: '2px 8px' }}>{lang === 'ar' ? 'من تقييمات جوجل' : 'From Google reviews'}</span>}
                </div>
                {r.comment && <p className="small muted" style={{ marginTop: 4 }}>{r.comment}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="xs faint text-center" style={{ marginTop: 'var(--sp-2)' }}>{lang === 'ar' ? 'يمكنك تقييم الأصناف بعد تقديم طلبك.' : 'You can rate items after your order is served.'}</p>
    </div>
  )
}

// Offers browser — auto-applied campaigns + every item currently on offer (strike-through price).
function OffersSheet({ open, onClose, promos, offeredItems, currency, onPick }) {
  const { lang } = useI18n()
  const scopeLabel = (o) => o.scope === 'cart' ? (lang === 'ar' ? 'على كل الطلب' : 'Whole order') : o.scope === 'category' ? (lang === 'ar' ? 'على تصنيف' : 'On a category') : (lang === 'ar' ? 'على صنف' : 'On an item')
  const until = (o) => o.endsAt ? ` · ${lang === 'ar' ? 'حتى' : 'until'} ${new Date(Number(o.endsAt)).toLocaleDateString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US')}` : ''
  return (
    <Sheet open={open} onClose={onClose} title={lang === 'ar' ? 'العروض والخصومات' : 'Offers & discounts'}>
      {(promos.length === 0 && offeredItems.length === 0) ? (
        <Empty icon="offers" title={lang === 'ar' ? 'لا توجد عروض حالياً' : 'No active offers'} />
      ) : (
        <div className="stack">
          {promos.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              {promos.map((o) => (
                <div key={o.id} className="offer-banner">
                  <span className="offer-badge">{o.type === 'percent' ? `${o.value}%` : <Price value={o.value} currency={currency} lang={lang} />}</span>
                  <div className="grow stack" style={{ gap: 1 }}>
                    <strong className="small">{pickLang(o, 'name', lang) || (lang === 'ar' ? 'عرض خاص' : 'Special offer')}</strong>
                    <span className="xs faint">{scopeLabel(o)}{until(o)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {offeredItems.length > 0 && (
            <>
              <strong className="small">{lang === 'ar' ? 'أصناف عليها عروض' : 'Items on offer'}</strong>
              <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                {offeredItems.map(({ it, offer }) => (
                  <button key={it.id} className="list-row" onClick={() => onPick(it)}>
                    {it.imageUrl ? <img src={it.imageUrl} alt="" loading="lazy" decoding="async" style={{ width: 46, height: 46, borderRadius: 10, objectFit: 'cover' }} /> : <Icon name="offers" size={22} />}
                    <div className="grow">
                      <div className="bold small">{pickLang(it, 'name', lang)}</div>
                      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <span className="bold" style={{ color: 'var(--brand)' }}><Price value={discountedPrice(it.price, offer)} currency={currency} lang={lang} /></span>
                        <span className="xs faint" style={{ textDecoration: 'line-through' }}><Price value={it.price} currency={currency} lang={lang} /></span>
                        <span className="badge badge-gold">{offer.type === 'percent' ? `−${offer.value}%` : `−${offer.value}`}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}

function MyOrdersSheet({ open, onClose, refs, docs, slug, navigate }) {
  const { t, lang } = useI18n()
  const label = (s) => ({ pending: t('statusPending'), accepted: t('statusAccepted'), preparing: t('statusPreparing'), ready: t('statusReady'), served: t('statusServed'), paid: t('statusPaid'), cancelled: t('statusCancelled') }[s] || t('statusPending'))
  return (
    <Sheet open={open} onClose={onClose} title={t('myOrders')}>
      {refs.length === 0 ? (
        <Empty icon="cashier" title={t('noOrdersYet')} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {refs.map((r) => {
            const status = docs[r.id]?.status || 'pending'
            const cls = status === 'ready' ? 'badge-success' : status === 'cancelled' ? 'badge-danger' : status === 'paid' || status === 'served' ? 'badge-info' : ''
            return (
              <button key={r.id} className="list-row" onClick={() => { onClose(); navigate(`/order/${slug}/${r.id}`) }}>
                <Icon name="orders" size={20} className="faint" />
                <div className="grow">
                  <div className="bold">{orderNumber(r.code)}</div>
                  <div className="xs faint">{timeAgo(r.at, lang)}</div>
                </div>
                <span className={`badge ${cls}`}>{label(status)}</span>
              </button>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}

function NotificationsSheet({ open, onClose, items, lastSeen, onMarkRead, slug, navigate }) {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const label = (s) => ({
    accepted: ar ? 'تم قبول طلبك' : 'Order accepted',
    preparing: ar ? 'طلبك قيد التحضير' : 'Preparing your order',
    ready: ar ? 'طلبك جاهز' : 'Your order is ready',
    served: ar ? 'تم تقديم طلبك' : 'Order served',
    paid: ar ? 'تم دفع طلبك' : 'Order paid',
    cancelled: ar ? 'أُلغي طلبك' : 'Order cancelled',
  }[s] || s)
  const icon = (s) => (s === 'ready' ? 'bellRing' : s === 'cancelled' ? 'no' : s === 'served' || s === 'paid' ? 'ok' : 'clock')
  const hasUnread = items.some((n) => (n.at || 0) > lastSeen)
  return (
    <Sheet open={open} onClose={onClose} title={t('notificationsTitle')}>
      {items.length === 0 ? (
        <Empty icon="bell" title={t('noNotifs')} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {hasUnread && (
            <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={onMarkRead}>
              <Icon name="check" size={14} /> {ar ? 'تحديد الكل كمقروء' : 'Mark all read'}
            </button>
          )}
          {items.map((n) => {
            const unread = (n.at || 0) > lastSeen
            if (n.type === 'notice') {
              return (
                <div key={n.key} className="list-row" style={{ ...(unread ? { background: 'var(--brand-soft)' } : {}), cursor: 'default', alignItems: 'flex-start' }} onClick={onMarkRead}>
                  <span className="center" style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', flex: 'none' }}><Icon name="sparkles" size={18} /></span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="bold small">{n.title || (ar ? 'إعلان' : 'Notice')}</div>
                    {n.body && <div className="xs muted" style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>}
                    <div className="xs faint">{timeAgo(n.at, lang)}</div>
                  </div>
                  {unread && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--brand)', flex: 'none' }} />}
                </div>
              )
            }
            const cancelled = n.status === 'cancelled'
            return (
              <button key={n.key} className="list-row" style={unread ? { background: 'var(--brand-soft)' } : undefined}
                onClick={() => { onMarkRead(); onClose(); navigate(`/order/${slug}/${n.orderId}`) }}>
                <span className="center" style={{ width: 36, height: 36, borderRadius: '50%', background: cancelled ? 'var(--danger-soft)' : 'var(--success-soft)', color: cancelled ? 'var(--danger)' : 'var(--success)' }}><Icon name={icon(n.status)} size={18} /></span>
                <div className="grow">
                  <div className="bold small">{label(n.status)} · {orderNumber(n.code)}</div>
                  <div className="xs faint">{timeAgo(n.at, lang)}</div>
                </div>
                {unread && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--brand)', flex: 'none' }} />}
              </button>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}

function CartSheet({ cart, subtotal, currency, offers, tenant, tenantId, table, partySize, orderType, setOrderType, car, setCar, curbsideEnabled, initialProfile, onProfileSaved, onQty, onOpenItem = null, onClose, onPlaced, preview }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [name, setName] = useState(initialProfile?.name || '')
  const [phone, setPhone] = useState(initialProfile?.phone || '')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [coupon, setCoupon] = useState('')
  const [customer, setCustomer] = useState(null)
  const [memberCard, setMemberCard] = useState(null) // public card via ?m=token (diners can't read customers)
  const [redeem, setRedeem] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [addr, setAddr] = useState('') // delivery address
  const [geo, setGeo] = useState(null) // {lat,lng} from "my location"
  const [locating, setLocating] = useState(false)
  const onlinePayEnabled = tenant?.onlinePayment?.enabled === true
  // Browse-only menu: the cart is a "show the waiter" list — no order submission.
  const browseOnly = tenant?.menuMode === 'browse'
  // Venue-controlled checkout fields (tenant.checkoutFields — absent = shown).
  // The phone force-shows for delivery: place() hard-requires it there.
  const cf = tenant?.checkoutFields || {}
  const showField = (k) => cf[k] !== false
  const ordering = orderingState(tenant)
  // Marketing control: how loudly the cart TOTAL is displayed.
  // 'normal' | 'bold' (big & clear) | 'small' | 'faint' | 'hidden'.
  const totalStyle = tenant?.cartTotalStyle || 'normal'
  // How the guest intends to pay: 'cash' | 'card_terminal' (mada at the counter)
  // | 'online' (pay now). Cash/terminal reach staff immediately (collect on
  // handover); online must settle BEFORE the order reaches the kitchen.
  // #10 Remember this device's last-used method (only offer 'online' when enabled).
  const [payMethod, setPayMethod] = useState(() => {
    try {
      const s = localStorage.getItem('rbt_paymethod')
      if (s === 'cash' || s === 'card_terminal' || (s === 'online' && tenant?.onlinePayment?.enabled === true)) return s
    } catch (_) { /* ignore */ }
    return 'cash'
  })
  // #4 Optional tip (percentage), venue opt-in.
  const tipsEnabled = tenant?.tipsEnabled === true
  const [tipPct, setTipPct] = useState(0)

  const threshold = tenant?.loyaltyThreshold || 5
  const loyaltyEnabled = tenant?.loyaltyEnabled !== false

  // Delivery (non-table orders only): distance zones OR a flat fee, plus an
  // optional free-above threshold + min order.
  const deliveryOpt = tenant?.delivery || {}
  const deliveryEnabled = deliveryOpt.enabled === true && !table && !preview
  const deliveryFee = Number(deliveryOpt.fee) || 0
  const deliveryMin = Number(deliveryOpt.minOrder) || 0
  const deliveryFreeAbove = Number(deliveryOpt.freeAbove) || 0
  const isDelivery = orderType === 'delivery'
  const venueGeo = tenant?.geo
  const deliveryZones = (Array.isArray(deliveryOpt.zones) ? deliveryOpt.zones : [])
    .map((z) => ({ maxKm: Number(z.maxKm) || 0, fee: Number(z.fee) || 0 })).filter((z) => z.maxKm > 0)
    .sort((a, b) => a.maxKm - b.maxKm)
  const distKm = (isDelivery && geo?.lat != null && venueGeo?.lat != null) ? distanceMeters(geo, venueGeo) / 1000 : null
  const matchedZone = (deliveryZones.length && distKm != null) ? deliveryZones.find((z) => distKm <= z.maxKm) : null
  const outOfZone = deliveryZones.length > 0 && distKm != null && !matchedZone
  const baseDeliveryFee = deliveryZones.length ? (matchedZone ? matchedZone.fee : deliveryFee) : deliveryFee

  // VIP member: a diner identifies via their card token (?m=) since they can't read customer docs;
  // staff-preview falls back to the customer's own membership.
  const memPolicy = resolveMembershipPolicy(tenant)
  const memberInfo = memberCard?.active ? memberCard : (customer?.membership?.active ? customer.membership : null)

  // best auto/coupon offer
  const offerEval = useMemo(() => evaluateOffers(offers, cart, subtotal, { couponCode: coupon, isMember: !!memberInfo }), [offers, cart, subtotal, coupon, memberInfo])
  const offerDiscount = offerEval?.discount || 0

  // cheapest drink unit for a free-drink reward
  const cheapestDrink = useMemo(() => {
    const drinks = cart.filter((l) => l.countsForLoyalty)
    if (!drinks.length) return 0
    return Math.min(...drinks.map((l) => l.unitPrice))
  }, [cart])
  const canRedeem = loyaltyEnabled && (customer?.rewards || 0) > 0 && cheapestDrink > 0
  const loyaltyDiscount = redeem && canRedeem ? cheapestDrink : 0

  // VIP standing tier discount — gated by memberSelfDiscount (anti card-sharing:
  // staff-scan only when off) AND by the loyalty mode (perks mode = no discounts,
  // members get privileged notifications instead).
  const memberDiscount = (memberInfo && memPolicy.memberSelfDiscount && memPolicy.mode !== 'perks') ? tierDiscountAmount(memberInfo, Math.max(0, subtotal - offerDiscount)) : 0

  const effDeliveryFee = isDelivery ? (deliveryFreeAbove > 0 && subtotal >= deliveryFreeAbove ? 0 : baseDeliveryFee) : 0
  // #4 Optional gratuity — a % of the post-discount base (venue opt-in).
  const tipBase = Math.max(0, subtotal - offerDiscount - memberDiscount - loyaltyDiscount)
  const tipAmount = tipsEnabled ? Math.round(tipBase * (Number(tipPct) || 0) / 100 * 100) / 100 : 0
  const total = tipBase + effDeliveryFee + tipAmount
  const drinkUnits = cart.reduce((s, l) => s + (l.countsForLoyalty ? l.qty : 0), 0)

  // fetch customer loyalty when a phone is entered
  useEffect(() => {
    const digits = phone.replace(/[^0-9]/g, '')
    if (digits.length < 8 || !tenantId) { setCustomer(null); return }
    let alive = true
    const tmr = setTimeout(async () => {
      const c = await getCustomerByPhone(tenantId, digits).catch(() => null)
      if (alive) setCustomer(c)
      // Diners can't read customers, so recognize a returning member via the public
      // phone→card mirror and apply their standing discount (once, if not already set).
      const mp = await getMemberByPhone(tenantId, digits).catch(() => null)
      if (alive && mp?.token) {
        const card = await getMemberByToken(tenantId, mp.token).catch(() => null)
        if (alive && card?.active) { setMemberCard((prev) => prev || card); setMemberToken(tenantId, mp.token) }
      }
    }, 500)
    return () => { alive = false; clearTimeout(tmr) }
  }, [phone, tenantId])

  // VIP card: identify via ?m=token OR a token remembered on this device → apply the member discount
  useEffect(() => {
    if (!tenantId) return
    let token = ''
    try { token = new URLSearchParams(window.location.search).get('m') || '' } catch (_) { /* ignore */ }
    if (!token) token = getMemberToken(tenantId)
    if (!token) { setMemberCard(null); return }
    let alive = true
    getMemberByToken(tenantId, token).then((c) => { if (alive && c?.active) { setMemberCard(c); if (c?.name) setName((n) => n || c.name); if (c?.phone) setPhone((p) => p || c.phone) } }).catch(() => {})
    return () => { alive = false }
  }, [tenantId])

  const place = async () => {
    if (cart.length === 0) return
    if (preview) { toast.error(lang === 'ar' ? 'هذه معاينة فقط' : 'Preview only'); return }
    if (!ordering.open) { toast.error(orderingClosedMessage(ordering.reason, lang)); return }
    if (orderType === 'curbside' && !car.model.trim()) { toast.error(lang === 'ar' ? 'أدخل بيانات السيارة' : 'Enter your car details'); return }

    // Geofence: table (dine-in) orders may only be placed inside the venue.
    if (orderType === 'dine_in' && table && tenant?.dineInGeofence?.enabled && venueGeo?.lat != null) {
      const radius = Number(tenant.dineInGeofence.radius) || 150
      let here = null
      try { here = await getPosition() } catch { toast.error(lang === 'ar' ? 'فعّل خدمة الموقع لتأكيد وجودك داخل المقهى لإتمام طلب الطاولة' : 'Enable location to confirm you are at the venue for a table order'); return }
      const d = distanceMeters(here, venueGeo)
      if (d != null && d > radius) { toast.error(lang === 'ar' ? 'طلبات الطاولة تُقبل من داخل المكان فقط، ويبدو أنك خارجه' : 'Table orders are available inside the venue only'); return }
    }

    if (isDelivery) {
      if (!addr.trim()) { toast.error(lang === 'ar' ? 'أدخل عنوان التوصيل' : 'Enter the delivery address'); return }
      if (!phone.trim()) { toast.error(lang === 'ar' ? 'أدخل رقم جوالك للتوصيل' : 'Enter your phone for delivery'); return }
      if (deliveryMin > 0 && subtotal < deliveryMin) { toast.error(lang === 'ar' ? `الحد الأدنى للتوصيل ${deliveryMin}` : `Minimum order for delivery is ${deliveryMin}`); return }
      // Distance limit: zones (block beyond the largest zone) or a flat radius.
      if (deliveryZones.length) {
        if (!geo?.lat) { toast.error(lang === 'ar' ? 'حدّد موقعك بزر «موقعي الحالي» لحساب نطاق التوصيل' : 'Set your location to compute the delivery zone'); return }
        if (outOfZone) { const maxKm = deliveryZones[deliveryZones.length - 1].maxKm; toast.error(lang === 'ar' ? `عذراً، أنت خارج نطاق التوصيل (حتى ${maxKm} كم)` : `Sorry, you are outside the delivery zones (up to ${maxKm} km)`); return }
      } else {
        const radiusKm = Number(deliveryOpt.radiusKm) || 0
        if (radiusKm > 0 && venueGeo?.lat != null) {
          if (!geo?.lat) { toast.error(lang === 'ar' ? 'حدّد موقعك بزر «موقعي الحالي» لتأكيد نطاق التوصيل' : 'Set your location to confirm the delivery range'); return }
          const km = distanceMeters(geo, venueGeo) / 1000
          if (km != null && km > radiusKm) { toast.error(lang === 'ar' ? `أنت خارج نطاق التوصيل (${radiusKm} كم)، والمسافة تقريباً ${km.toFixed(1)} كم` : `Sorry, you are outside the ${radiusKm} km delivery range (~${km.toFixed(1)} km)`); return }
        }
      }
    }
    setPlacing(true)
    try {
      // Guest Wi-Fi that filters the IP lookup makes fetchIp HANG (no reject),
      // and checkout was parked on it. The ip is analytics-only: race it.
      const ip = await Promise.race([fetchIp().catch(() => null), new Promise((r) => setTimeout(() => r(null), 400))])
      // Pay-first only when the guest chose online AND it's enabled AND there is a charge.
      const payOnline = payMethod === 'online' && onlinePayEnabled && total > 0
      const payload = {
        items: cart.map((l) => ({
          itemId: l.itemId, nameAr: l.nameAr, nameEn: l.nameEn, variantLabel: l.variantLabel, variantKey: l.variantKey || '',
          modifiers: l.modifiers || [], unitPrice: l.unitPrice, qty: l.qty, lineTotal: l.unitPrice * l.qty,
        })),
        subtotal,
        discount: offerDiscount,
        loyaltyDiscount,
        memberDiscount,
        membershipTier: memberInfo?.tier || null,
        memberCardToken: memberCard?.token || customer?.membership?.token || null,
        total,
        appliedOffer: offerEval ? { nameAr: offerEval.offer.nameAr || '', nameEn: offerEval.offer.nameEn || '', discount: offerDiscount, code: offerEval.offer.code || '' } : null,
        couponCode: offerEval?.offer?.code || '',
        orderType: orderType || (table ? 'dine_in' : 'pickup'),
        car: orderType === 'curbside' ? { model: car.model.trim(), color: car.color.trim(), plate: car.plate.trim() } : null,
        deliveryFee: effDeliveryFee,
        delivery: isDelivery ? { address: addr.trim(), lat: geo?.lat || null, lng: geo?.lng || null, fee: effDeliveryFee, status: 'pending' } : null,
        tableId: table?.id || null, tableLabel: table?.label || '',
        partySize: partySize || null,
        customerName: name || '', customerPhone: phone || '', customerEmail: (email || '').trim(), notes: notes || '',
        drinkUnits, loyaltyRedeemed: loyaltyDiscount > 0,
        // THE LANGUAGE THIS GUEST WAS READING, recorded on the order itself.
        //
        // Nothing else persists it: `lang` lives in localStorage (i18n.jsx) and
        // never reached Firestore, so every confirmation email went out in
        // Arabic no matter which menu the guest had been using. Stamping it on
        // the order — not on the customer — keeps it truthful per interaction:
        // someone who browsed in English tonight gets THIS order's mail in
        // English even if they order in Arabic next week.
        lang,
        currency, ip: ip || '',
        source: table ? 'qr-table' : 'qr-public',
        // How the guest pays. Online must settle first; cash/terminal are collected
        // in person, so the cashier sees the intended method on the ticket/receipt.
        paymentMethod: payMethod,
        paymentStatus: payOnline ? 'awaiting' : 'due',
        tip: tipAmount, tipPct: tipsEnabled ? Number(tipPct) || 0 : 0,
      }
      // Online orders are HELD (awaiting_payment) — hidden from the kitchen until
      // the payment settles. Cash / card-terminal orders go live immediately.
      const res = await createOrder(tenantId, payload, { hold: payOnline })
      // Stock is decremented server-side (onNewOrder for cash/terminal; the
      // settlement path for online) — the client call is permission-denied for diners.
      addMyOrder(tenantId, { id: res.id, code: res.code })
      trackOrdered(res.id, total)
      try { localStorage.setItem('rbt_paymethod', payMethod) } catch (_) { /* ignore */ }
      if (name || phone) {
        setLocalCustomer({ name, phone })
        onProfileSaved?.({ name, phone })
      }
      if (payOnline) {
        // Take payment FIRST. The held order only reaches staff once Moyasar settles.
        try { await startPayment('order', tenantId, res.id); return } catch (_) { toast.error(lang === 'ar' ? 'ما فتحت صفحة الدفع، وطلبك لم يُرسل. جرّب مرة ثانية' : 'The payment page did not open and your order was not sent. Please try again') }
        return
      }
      onPlaced(res.id)
    } catch (e) {
      // Surface the real cause (permission / offline / bad-data) instead of a
      // blind "error" — a diner-facing hint plus the code for support.
      const code = e?.code || ''
      const hint = code.includes('permission')
        ? (lang === 'ar' ? 'المتجر لا يستقبل الطلبات حالياً' : 'Orders are closed right now')
        : code.includes('unavailable')
          ? (lang === 'ar' ? 'تحقق من اتصال الإنترنت وحاول مجدداً' : 'Check your connection and retry')
          : (lang === 'ar' ? 'تعذّر إرسال الطلب، حاول مجدداً' : 'Could not place the order, try again')
      toast.error(code ? `${hint} · ${code}` : hint)
    } finally {
      setPlacing(false)
    }
  }

  return (
    <Sheet open onClose={onClose} className="menu-sheet" title={browseOnly ? (lang === 'ar' ? 'قائمتي' : 'My list') : t('yourOrder')}
      footer={
        browseOnly ? (
          /* browse mode: the list is for the waiter — no submission */
          <div className="row" style={{ gap: 8, alignItems: 'center', justifyContent: 'center', padding: '4px 0', color: 'var(--text-muted)' }}>
            <Icon name="waiter" size={16} />
            <span className="small">{lang === 'ar' ? 'اعرض هذا الطلب للنادل عند طلبك' : 'Show this list to your waiter to order'}</span>
          </div>
        ) : !ordering.open ? (
          /* venue is closed / paused — the menu stays browsable but no submission */
          <div className="row" style={{ gap: 8, alignItems: 'center', justifyContent: 'center', padding: '8px 0', color: 'var(--danger)', textAlign: 'center' }}>
            <Icon name="clock" size={16} />
            <span className="small bold">{orderingClosedMessage(ordering.reason, lang)}</span>
          </div>
        ) : (
          <button className="btn btn-primary btn-lg btn-block" disabled={placing || cart.length === 0} onClick={place}>
            {placing ? t('saving') : <>{t('placeOrder')}{totalStyle !== 'hidden' ? <> · <Price value={total} currency={currency} lang={lang} /></> : null}</>}
          </button>
        )
      }>
      {cart.length === 0 ? (
        <Empty icon="cart" title={t('emptyCart')} />
      ) : (
        <div className="stack">
          {table && <div className="badge" style={{ width: 'fit-content' }}><Icon name="tables" size={13} /> {table.label}{partySize ? ` · ${partySize} ${lang === 'ar' ? 'أشخاص' : 'guests'}` : ''}</div>}

          {/* order type — dine-in only for a table QR; public menu = external */}
          {!browseOnly && (
            <div className="otype-row">
              {(table
                ? [{ id: 'dine_in', icon: 'tables', label: orderTypeLabel('dine_in', lang) }]
                : [
                  { id: 'pickup', icon: 'bag', label: orderTypeLabel('pickup', lang) },
                  ...(curbsideEnabled ? [{ id: 'curbside', icon: 'car', label: orderTypeLabel('curbside', lang) }] : []),
                  ...(deliveryEnabled ? [{ id: 'delivery', icon: 'car', label: orderTypeLabel('delivery', lang) }] : []),
                ]
              ).map((o) => (
                <button key={o.id} className={`otype-chip ${orderType === o.id ? 'on' : ''}`} onClick={() => setOrderType(o.id)}>
                  <Icon name={o.icon} size={18} /><span>{o.label}</span>
                </button>
              ))}
            </div>
          )}
          {!browseOnly && tipsEnabled && tipBase > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="small bold row" style={{ gap: 6 }}><Icon name="heart" size={14} /> {lang === 'ar' ? 'إكرامية للفريق (اختياري)' : 'Tip the team (optional)'}</span>
              <div className="otype-row">
                {[0, 5, 10, 15].map((p) => (
                  <button key={p} type="button" className={`otype-chip ${tipPct === p ? 'on' : ''}`} onClick={() => setTipPct(p)}>
                    <span>{p === 0 ? (lang === 'ar' ? 'بدون' : 'None') : `${p}%`}</span>
                  </button>
                ))}
              </div>
              {tipAmount > 0 && <span className="xs faint">{lang === 'ar' ? 'الإكرامية' : 'Tip'}: <Price value={tipAmount} currency={currency} lang={lang} /></span>}
            </div>
          )}
          {!browseOnly && total > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="small bold">{lang === 'ar' ? 'طريقة الدفع' : 'Payment method'}</span>
              <div className="otype-row">
                {[
                  { id: 'cash', icon: 'wallet', label: lang === 'ar' ? 'نقدي' : 'Cash' },
                  { id: 'card_terminal', icon: 'card', label: lang === 'ar' ? 'شبكة' : 'Card machine' },
                  ...(onlinePayEnabled ? [{ id: 'online', icon: 'wallet', label: lang === 'ar' ? 'ادفع الآن' : 'Pay now' }] : []),
                ].map((o) => (
                  <button key={o.id} type="button" className={`otype-chip ${payMethod === o.id ? 'on' : ''}`} onClick={() => setPayMethod(o.id)}>
                    <Icon name={o.icon} size={18} /><span>{o.label}</span>
                  </button>
                ))}
              </div>
              <span className="xs faint">
                {payMethod === 'online'
                  ? (lang === 'ar' ? 'ستدفع الآن بالدفع الإلكتروني (Apple Pay أو مدى أو بطاقة)، ويصل طلبك للمطبخ بعد نجاح الدفع.' : 'Pay now (Apple Pay/mada/card); your order reaches the kitchen after payment succeeds.')
                  : payMethod === 'card_terminal'
                    ? (lang === 'ar' ? 'ستدفع بالشبكة عند الاستلام؛ يصل طلبك للكاشير فوراً.' : 'Pay by card machine on handover; your order reaches the cashier now.')
                    : (lang === 'ar' ? 'ستدفع نقداً عند الاستلام؛ يصل طلبك للكاشير فوراً.' : 'Pay cash on handover; your order reaches the cashier now.')}
              </span>
            </div>
          )}
          {isDelivery && (
            <div className="card card-pad stack" style={{ gap: 8 }}>
              <strong className="small row" style={{ gap: 6 }}><Icon name="pin" size={16} /> {lang === 'ar' ? 'عنوان التوصيل' : 'Delivery address'}</strong>
              <textarea className="input" rows={2} value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={lang === 'ar' ? 'الحي، الشارع، رقم المبنى، وصف الوصول…' : 'District, street, building, landmarks…'} style={{ resize: 'vertical', minHeight: 52 }} />
              <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm btn-outline" disabled={locating} onClick={() => {
                  if (!navigator.geolocation) { toast.error(lang === 'ar' ? 'الموقع غير مدعوم' : 'Geolocation unsupported'); return }
                  setLocating(true)
                  navigator.geolocation.getCurrentPosition(
                    (pos) => { const g = { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) }; setGeo(g); setLocating(false); toast.success(lang === 'ar' ? 'حُدّد موقعك' : 'Location captured') },
                    () => { setLocating(false); toast.error(lang === 'ar' ? 'تعذّر تحديد الموقع' : 'Could not get location') },
                    { enableHighAccuracy: true, timeout: 8000 },
                  )
                }}><Icon name={geo && !locating ? 'check' : 'pin'} size={14} /> {locating ? (lang === 'ar' ? 'يحدّد…' : 'Locating…') : geo ? (lang === 'ar' ? 'تم تحديد الموقع' : 'Location set') : (lang === 'ar' ? 'موقعي الحالي' : 'My location')}</button>
                {deliveryMin > 0 && subtotal < deliveryMin && (
                  <span className="xs" style={{ color: 'var(--danger)' }}>{lang === 'ar' ? 'الحد الأدنى للتوصيل: ' : 'Min order: '}<Price value={deliveryMin} currency={currency} lang={lang} /></span>
                )}
              </div>
              {distKm != null && (
                outOfZone
                  ? <span className="xs" style={{ color: 'var(--danger)' }}><Icon name="warning" size={12} /> {lang === 'ar' ? `خارج نطاق التوصيل، المسافة تقريباً ${distKm.toFixed(1)} كم` : `Outside delivery range, about ${distKm.toFixed(1)} km away`}</span>
                  : <span className="xs faint">{lang === 'ar' ? `المسافة ~${distKm.toFixed(1)} كم` : `~${distKm.toFixed(1)} km`}{deliveryZones.length ? <> · {lang === 'ar' ? 'الرسوم' : 'fee'} <Price value={baseDeliveryFee} currency={currency} lang={lang} symbolSize="0.85em" /></> : null}</span>
              )}
              {phone.trim() === '' && <span className="xs faint">{lang === 'ar' ? 'أدخل جوالك أدناه ليتواصل السائق معك.' : 'Enter your phone below so the driver can reach you.'}</span>}
            </div>
          )}
          {orderType === 'curbside' && (
            <div className="card card-pad stack" style={{ gap: 8 }}>
              <strong className="small row" style={{ gap: 6 }}><Icon name="car" size={16} /> {t('carDetails')}</strong>
              <div className="field"><label>{t('carModel')}</label><input className="input" value={car.model} onChange={(e) => setCar({ ...car, model: e.target.value })} placeholder={lang === 'ar' ? 'مثال: كامري' : 'e.g. Camry'} /></div>
              <div className="row" style={{ gap: 8 }}>
                <div className="field grow"><label>{t('carColor')}</label><input className="input" value={car.color} onChange={(e) => setCar({ ...car, color: e.target.value })} placeholder={lang === 'ar' ? 'أبيض' : 'White'} /></div>
                <div className="field grow"><label>{t('carPlate')}</label><input className="input" dir="ltr" value={car.plate} onChange={(e) => setCar({ ...car, plate: e.target.value })} placeholder="ABC 1234" /></div>
              </div>
            </div>
          )}

          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {cart.map((l) => {
              // thumb + text: tapping them reopens the item's detail view (when
              // the host wires onOpenItem) so a guest can review what a line IS
              // without hunting the menu again; the Stepper stays a sibling so
              // qty taps never trigger the open.
              const thumb = l.image
                ? <img className="cart-thumb" src={l.image} alt="" loading="lazy" />
                : <span className="cart-thumb cart-thumb-ph"><Icon name="coffee" size={18} /></span>
              const body = (
                <div className="grow">
                  <div className="bold">{lang === 'en' && l.nameEn ? l.nameEn : l.nameAr}</div>
                  {l.variantLabel && <div className="xs faint">{l.variantLabel}</div>}
                  {l.modifiers?.length ? <div className="xs faint">{l.modifiers.map((m) => (lang === 'en' && m.nameEn ? m.nameEn : m.nameAr)).join('، ')}</div> : null}
                  <div className="price small"><Price value={l.unitPrice * l.qty} currency={currency} lang={lang} /></div>
                </div>
              )
              return (
                <div key={l.key} className="list-row">
                  {onOpenItem ? (
                    <button type="button" className="cart-line-open" onClick={() => onOpenItem(l)}>{thumb}{body}</button>
                  ) : (
                    <>{thumb}{body}</>
                  )}
                  <Stepper value={l.qty} min={0} onChange={(q) => onQty(l.key, q)} />
                </div>
              )
            })}
          </div>

          {/* coupon */}
          {!browseOnly && showField('coupon') && (
          <div className="field">
            <label>{t('couponCode')} <span className="faint">({t('optional')})</span></label>
            <input className="input" dir="ltr" value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="WELCOME10" />
            {/* silent rejection confuses diners — say whether the code took */}
            {coupon.trim() !== '' && (
              offerEval?.offer?.code && offerEval.offer.code.toUpperCase() === coupon.trim().toUpperCase() ? (
                <span className="xs" style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="check" size={12} /> {lang === 'ar' ? 'تم تطبيق الكود' : 'Code applied'}
                </span>
              ) : (
                <span className="xs" style={{ color: 'var(--danger)' }}>{lang === 'ar' ? 'كود غير صالح أو غير منطبق' : 'Invalid or inapplicable code'}</span>
              )
            )}
          </div>
          )}

          {/* totals — the TOTAL row obeys the venue's marketing display choice */}
          <div className="stack" style={{ gap: 4, padding: '0 4px' }}>
            {totalStyle !== 'hidden' && <div className="row-between small"><span>{t('subtotal')}</span><span className="price"><Price value={subtotal} currency={currency} lang={lang} /></span></div>}
            {offerDiscount > 0 && (
              <div className="row-between small" style={{ color: 'var(--success)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="offers" size={13} /> {offerEval?.offer ? pickLang(offerEval.offer, 'name', lang) || t('discount') : t('discount')}</span>
                <span>−<Price value={offerDiscount} currency={currency} lang={lang} /></span>
              </div>
            )}
            {memberDiscount > 0 && memberInfo && (
              <div className="row-between small" style={{ color: 'var(--success)' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name={(TIER_META[memberInfo.tier] || {}).icon || 'award'} size={13} /> {lang === 'ar' ? `خصم العضوية ${memberInfo.discountPct}%` : `Member ${memberInfo.discountPct}%`}</span><span>−<Price value={memberDiscount} currency={currency} lang={lang} /></span></div>
            )}
            {loyaltyDiscount > 0 && (
              <div className="row-between small" style={{ color: 'var(--success)' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="star" size={13} /> {lang === 'ar' ? 'مشروب مجاني' : 'Free drink'}</span><span>−<Price value={loyaltyDiscount} currency={currency} lang={lang} /></span></div>
            )}
            {isDelivery && (
              <div className="row-between small"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="car" size={13} /> {lang === 'ar' ? 'رسوم التوصيل' : 'Delivery fee'}</span>{effDeliveryFee > 0 ? <span className="price">+<Price value={effDeliveryFee} currency={currency} lang={lang} /></span> : <span style={{ color: 'var(--success)' }}>{lang === 'ar' ? 'مجاني' : 'Free'}</span>}</div>
            )}
            {tipAmount > 0 && (
              <div className="row-between small"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="heart" size={13} /> {lang === 'ar' ? 'إكرامية' : 'Tip'}</span><span className="price">+<Price value={tipAmount} currency={currency} lang={lang} /></span></div>
            )}
            {/* the marketing trick: 'hidden' removes it, 'faint'/'small' whisper it, 'bold' shouts it */}
            {totalStyle !== 'hidden' && (
              <div className="row-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 6, ...(totalStyle === 'faint' ? { opacity: 0.55 } : {}) }}>
                <span className={totalStyle === 'bold' ? 'bold' : totalStyle === 'small' || totalStyle === 'faint' ? 'xs faint' : 'bold'} style={totalStyle === 'bold' ? { fontSize: 'var(--fs-md)' } : undefined}>{t('total')}</span>
                <span className={`price ${totalStyle === 'small' || totalStyle === 'faint' ? '' : 'bold'}`} style={{ fontSize: totalStyle === 'bold' ? 'var(--fs-xl)' : totalStyle === 'small' || totalStyle === 'faint' ? 'var(--fs-sm)' : undefined, color: totalStyle === 'faint' ? 'var(--text-muted)' : undefined }}>
                  <Price value={total} currency={currency} lang={lang} symbolSize={totalStyle === 'small' || totalStyle === 'faint' ? '0.8em' : undefined} />
                </span>
              </div>
            )}
          </div>

          {!browseOnly && (
          <>
          {showField('name') && (
          <div className="field">
            <label>{t('yourName')} <span className="faint">({t('optional')})</span></label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          )}
          {/* delivery force-shows the phone: place() refuses delivery without it */}
          {(showField('phone') || isDelivery) && (
          <div className="field">
            <label>{t('phone')} <span className="faint">({isDelivery ? (lang === 'ar' ? 'مطلوب للتوصيل' : 'required for delivery') : (lang === 'ar' ? 'للولاء' : 'for loyalty')})</span></label>
            <input className="input num" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          )}
          {showField('email') && (
          <div className="field">
            <label>{lang === 'ar' ? 'البريد الإلكتروني' : 'Email'} <span className="faint">({lang === 'ar' ? 'اختياري، لاستلام الفاتورة' : 'optional, for your invoice'})</span></label>
            <input className="input" dir="ltr" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          )}

          {/* loyalty status */}
          {loyaltyEnabled && customer && (
            <div className="card card-pad stack" style={{ gap: 8, background: 'var(--brand-soft)' }}>
              <div className="row-between">
                <span className="small bold" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="star" size={14} style={{ color: 'var(--gold)' }} /> {lang === 'ar' ? 'نقاط الولاء' : 'Loyalty'}</span>
                <span className="xs">{(customer.loyaltyDrinks || 0)}/{threshold} {lang === 'ar' ? 'مشروب' : 'drinks'}</span>
              </div>
              {canRedeem ? (
                <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={redeem} onChange={(e) => setRedeem(e.target.checked)} style={{ width: 20, height: 20 }} />
                  <span className="small">{lang === 'ar' ? `${arPlural(customer.rewards, { one: 'مشروب مجاني', two: 'مشروبان مجانيان', few: 'مشروبات مجانية', many: 'مشروباً مجانياً' })} بانتظارك، استخدم واحداً الآن` : `You have ${customer.rewards} free drink(s), use one now`}</span>
                </label>
              ) : (
                <span className="xs faint">{lang === 'ar' ? `باقٍ ${Math.max(0, threshold - (customer.loyaltyDrinks || 0))} للحصول على مشروب مجاني` : `${Math.max(0, threshold - (customer.loyaltyDrinks || 0))} more for a free drink`}</span>
              )}
            </div>
          )}

          {showField('notes') && (
          <div className="field">
            <label>{t('notes')}</label>
            <textarea className="textarea" placeholder={t('notesPlaceholder')} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          )}
          </>
          )}
        </div>
      )}
    </Sheet>
  )
}

// Horizontal strip of imported GENERAL Google reviews (itemId empty — item-level
// ones live inside each item's tab). Shown when the venue enables the showcase
// in the reviews studio; loads once, renders nothing while empty. Honest badge.
function ReviewShowcase({ tenantId, lang }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { collection, getDocs, query, where, limit } = await import('firebase/firestore')
        const { db } = await import('../lib/firebase.js')
        const s = await getDocs(query(collection(db, 'tenants', tenantId, 'reviews'), where('source', '==', 'google'), limit(30)))
        const general = s.docs.map((d) => d.data()).filter((r) => !r.itemId && (r.comment || '').trim())
        if (alive) setRows(general.slice(0, 12))
      } catch (_) { if (alive) setRows([]) }
    })()
    return () => { alive = false }
  }, [tenantId])
  if (!rows || rows.length === 0) return null
  return (
    <div className="container" style={{ marginTop: 'var(--sp-3)' }}>
      <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <Icon name="star" size={15} style={{ color: 'var(--gold, #d4a017)' }} />
        <strong className="small">{lang === 'ar' ? 'من تقييمات جوجل' : 'From Google reviews'}</strong>
      </div>
      <div className="rvs-strip scroll-x">
        {rows.map((r, i) => (
          <figure key={i} className="rvs-card">
            <span className="rvs-stars" aria-label={`${r.rating || 5} / 5`}>
              {Array.from({ length: Math.max(1, Math.min(5, Number(r.rating) || 5)) }, (_, k) => (
                <Icon key={k} name="star" size={12} fill="currentColor" strokeWidth={0} />
              ))}
            </span>
            <blockquote className="rvs-text">{r.comment}</blockquote>
            {r.name && <figcaption className="rvs-name">{r.name}</figcaption>}
          </figure>
        ))}
      </div>
    </div>
  )
}

// Fires the checkout funnel step exactly once per cart opening (mount = the
// guest reached the checkout sheet). Kept as a component so the effect is tied
// to the sheet's real lifecycle rather than a manual flag.
function CheckoutTracker() {
  useEffect(() => { trackCheckout() }, [])
  return null
}
