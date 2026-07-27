import { useNavigate } from 'react-router-dom'
import { useI18n } from '../lib/i18n.jsx'
import { resolveSkin } from '../lib/skins.js'
import { resolveChrome } from '../lib/dishComposition.js'
import Icon from './Icon.jsx'

// Shared diner bottom nav. On the menu page, cart/orders open sheets (pass callbacks);
// on events/reservations pages they navigate back to the menu.
// The style (`data-nav`) comes from the active skin or a manual override; 'none' hides it.
//
// LAYOUT RULE — the cart used to be hard-coded as the THIRD child, so it only
// looked centred when all six entries happened to be visible. Hide «العروض» or
// «المناسبات» and the raised cart button slid off to one side, which is exactly
// what the owner saw. The entries are data now: they are filtered first, then
// the cart is INSERTED AT THE MIDDLE of whatever survived, so it is centred for
// any count. A venue can override both the order and the cart's slot through
// tenant.dinerNav = { order: ['menu','orders',...], cart: 'center'|'start'|'end' }.
export const DINER_NAV_KEYS = ['menu', 'orders', 'offers', 'events', 'reservations', 'waiter']
export const DINER_NAV_LABELS = {
  menu: { ar: 'المنيو', en: 'Menu' },
  orders: { ar: 'طلباتي', en: 'My orders' },
  offers: { ar: 'العروض', en: 'Offers' },
  events: { ar: 'الفعاليات', en: 'Events' },
  reservations: { ar: 'المناسبات', en: 'Occasions' },
  waiter: { ar: 'نداء الجرسون', en: 'Call waiter' },
}

export default function DinerNav({ slug, tenant, variant, active = 'menu', cartCount = 0, readyCount = 0, onMenu, onOrders, onCart, onOffers, onEvents, onReservations, onWaiter, showWaiter = false, showCart = true }) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const tap = (cb, path) => () => (cb ? cb() : navigate(path))
  const resolved = resolveSkin(tenant, 'menu')
  const navStyle = variant || resolved?.layout?.bottomNav || 'standard'
  const hidden = resolved?.hidden || []
  // menuChrome custom cart-fab icon: the fab FACE rides body-level --mch-fab
  // vars stamped by ChromeSkin — only the glyph swap lives here.
  const cartIcon = resolveChrome(tenant)?.elements?.cartFab?.icon || ''
  if (navStyle === 'none') return null

  const cfg = tenant?.dinerNav || {}
  const cartSlot = ['center', 'start', 'end'].includes(cfg.cart) ? cfg.cart : 'center'

  // Every candidate entry, with the condition that makes it real.
  const all = {
    menu: {
      show: true,
      node: (
        <button key="menu" className={active === 'menu' ? 'active' : ''} onClick={tap(onMenu, `/m/${slug}`)}>
          <Icon name="home" size={20} /><span>{t('menu')}</span>
        </button>
      ),
    },
    orders: {
      show: true,
      node: (
        <button key="orders" onClick={tap(onOrders, `/m/${slug}`)}>
          <Icon name="orders" size={20} />{readyCount > 0 && <span className="cart-badge">{readyCount}</span>}<span>{t('myOrders')}</span>
        </button>
      ),
    },
    offers: {
      show: !!onOffers && !hidden.includes('offers'),
      node: (
        <button key="offers" className={active === 'offers' ? 'active' : ''} onClick={onOffers}>
          <Icon name="offers" size={20} /><span>{lang === 'ar' ? 'العروض' : 'Offers'}</span>
        </button>
      ),
    },
    events: {
      show: !!slug && !hidden.includes('events'),
      node: (
        <button key="events" className={active === 'events' ? 'active' : ''} onClick={onEvents || (() => navigate(`/e/${slug}`))}>
          <Icon name="events" size={20} /><span>{t('events')}</span>
        </button>
      ),
    },
    reservations: {
      show: !!slug && !hidden.includes('reservations'),
      node: (
        <button key="reservations" className={active === 'reservations' ? 'active' : ''} onClick={onReservations || (() => navigate(`/book/${slug}`))}>
          <Icon name="reservations" size={20} /><span>{lang === 'ar' ? 'المناسبات' : 'Occasions'}</span>
        </button>
      ),
    },
    waiter: {
      show: !!showWaiter,
      node: (
        <button key="waiter" onClick={onWaiter}><Icon name="waiter" size={20} /><span>{t('callWaiter')}</span></button>
      ),
    },
  }

  // Venue order first, then anything it did not mention (so a new entry added
  // later still appears instead of silently vanishing).
  const wanted = Array.isArray(cfg.order) && cfg.order.length
    ? [...cfg.order.filter((k) => DINER_NAV_KEYS.includes(k)), ...DINER_NAV_KEYS.filter((k) => !cfg.order.includes(k))]
    : DINER_NAV_KEYS
  const items = wanted.filter((k) => all[k]?.show).map((k) => all[k].node)

  const cartNode = showCart ? (
    <button key="cart" className="center-cart-btn" onClick={onCart || tap(null, `/m/${slug}?cart=1`)}>
      <div className="cart-circle-container">
        {cartIcon ? <img className="mch-icon" src={cartIcon} alt="" /> : <Icon name="cart" size={20} />}
        {cartCount > 0 && <span className="cart-badge-count">{cartCount}</span>}
      </div>
      <span>{lang === 'ar' ? 'السلة' : 'Cart'}</span>
    </button>
  ) : null

  // Two equal-width halves with the cart between them. Earlier attempts put the
  // cart at a computed INDEX (drifts whenever the entry count is odd) and then
  // pinned it to the centre with a reserved spacer at that same index — but the
  // spacer's index is not the bar's centre either, so the cart landed on top of
  // a real button. Two `flex: 1` groups make the geometry exact by construction:
  // each half always occupies half the bar, whatever it contains, so the cart is
  // on the centre line and nothing can sit under it.
  const half = Math.ceil(items.length / 2)
  const sides = [items.slice(0, half), items.slice(half)]

  return (
    <nav className="m-bottomnav" data-nav={navStyle} data-cart={cartNode ? cartSlot : 'none'}>
      {cartNode && cartSlot === 'start' ? cartNode : null}
      {cartNode && cartSlot === 'center' ? (
        <>
          <span className="m-bn-side">{sides[0]}</span>
          {cartNode}
          <span className="m-bn-side">{sides[1]}</span>
        </>
      ) : items}
      {cartNode && cartSlot === 'end' ? cartNode : null}
    </nav>
  )
}
