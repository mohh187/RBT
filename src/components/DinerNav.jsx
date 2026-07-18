import { useNavigate } from 'react-router-dom'
import { useI18n } from '../lib/i18n.jsx'
import { resolveSkin } from '../lib/skins.js'
import Icon from './Icon.jsx'

// Shared diner bottom nav. On the menu page, cart/orders open sheets (pass callbacks);
// on events/reservations pages they navigate back to the menu.
// The style (`data-nav`) comes from the active skin or a manual override; 'none' hides it.
export default function DinerNav({ slug, tenant, variant, active = 'menu', cartCount = 0, readyCount = 0, onMenu, onOrders, onCart, onOffers, onEvents, onReservations, onWaiter, showWaiter = false, showCart = true }) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const tap = (cb, path) => () => (cb ? cb() : navigate(path))
  const resolved = resolveSkin(tenant, 'menu')
  const navStyle = variant || resolved?.layout?.bottomNav || 'standard'
  const hidden = resolved?.hidden || []
  if (navStyle === 'none') return null

  return (
    <nav className="m-bottomnav" data-nav={navStyle}>
      <button className={active === 'menu' ? 'active' : ''} onClick={tap(onMenu, `/m/${slug}`)}>
        <Icon name="home" size={20} /><span>{t('menu')}</span>
      </button>
      
      <button onClick={tap(onOrders, `/m/${slug}`)}>
        <Icon name="orders" size={20} />{readyCount > 0 && <span className="cart-badge">{readyCount}</span>}<span>{t('myOrders')}</span>
      </button>

      {/* Floating Center Cart button — hidden on display-only (browse) menus */}
      {showCart && (
        <button className="center-cart-btn" onClick={onCart || tap(null, `/m/${slug}?cart=1`)}>
          <div className="cart-circle-container">
            <Icon name="cart" size={20} />
            {cartCount > 0 && <span className="cart-badge-count">{cartCount}</span>}
          </div>
          <span>{lang === 'ar' ? 'السلة' : 'Cart'}</span>
        </button>
      )}

      {onOffers && !hidden.includes('offers') && (
        <button className={active === 'offers' ? 'active' : ''} onClick={onOffers}>
          <Icon name="offers" size={20} /><span>{lang === 'ar' ? 'العروض' : 'Offers'}</span>
        </button>
      )}
      
      {slug && !hidden.includes('events') && (
        <button className={active === 'events' ? 'active' : ''} onClick={onEvents || (() => navigate(`/e/${slug}`))}>
          <Icon name="events" size={20} /><span>{t('events')}</span>
        </button>
      )}
      
      {slug && !hidden.includes('reservations') && (
        <button className={active === 'reservations' ? 'active' : ''} onClick={onReservations || (() => navigate(`/book/${slug}`))}>
          <Icon name="reservations" size={20} /><span>{lang === 'ar' ? 'المناسبات' : 'Occasions'}</span>
        </button>
      )}
      
      {showWaiter && (
        <button onClick={onWaiter}><Icon name="waiter" size={20} /><span>{t('callWaiter')}</span></button>
      )}
    </nav>
  )
}
