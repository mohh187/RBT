import { useParams, useNavigate } from 'react-router-dom'
import { usePublicVenue } from '../../lib/usePublicVenue.js'
import { useI18n } from '../../lib/i18n.jsx'
import { FullSpinner, Empty } from '../../components/ui.jsx'
import DinerBar from '../../components/DinerBar.jsx'
import MenuView from '../../components/MenuView.jsx'
import VenueBackground from '../../components/VenueBackground.jsx'

export default function PublicMenu({ slug: slugProp }) {
  const { slug: slugParam } = useParams()
  const slug = slugProp || slugParam // slugProp = rendered at root on a venue's custom domain
  const navigate = useNavigate()
  const { lang } = useI18n()
  const { loading, notFound, tenant, tenantId, items, categories, offers } = usePublicVenue(slug)

  if (loading && !items?.length) {
    if (tenant) {
      return (
        <div className="venue-above" style={{ minHeight: '100dvh' }}>
          <VenueBackground tenant={tenant} />
          <DinerBar tenant={tenant} />
          <div style={{ display: 'grid', placeItems: 'center', minHeight: 'calc(100dvh - 100px)' }}>
            <span className="spinner" style={{ color: 'var(--brand)' }}></span>
          </div>
        </div>
      )
    }
    return <FullSpinner />
  }
  // No dead ends: a mistyped slug or a retired QR code left the guest on a bare
  // icon with nothing clickable. Always offer a way forward.
  if (notFound) {
    return (
      <div className="auth-shell">
        <Empty
          icon="search"
          title={lang === 'ar' ? 'المنشأة غير موجودة' : 'Venue not found'}
          hint={lang === 'ar'
            ? 'تأكّد من الرابط أو أعد مسح رمز QR على الطاولة.'
            : 'Check the link, or scan the QR code on your table again.'}
          action={(
            <div className="row" style={{ gap: 'var(--sp-2)', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => window.location.reload()}>
                {lang === 'ar' ? 'إعادة المحاولة' : 'Try again'}
              </button>
              <a className="btn btn-primary" href="/">
                {lang === 'ar' ? 'الصفحة الرئيسية' : 'Go home'}
              </a>
            </div>
          )}
        />
      </div>
    )
  }

  return (
    <div className="venue-above" style={{ minHeight: '100dvh' }}>
      <VenueBackground tenant={tenant} />
      <DinerBar tenant={tenant} />
      <MenuView
        tenant={tenant}
        tenantId={tenantId}
        items={items}
        categories={categories}
        offers={offers}
        onPlaced={(orderId) => navigate(`/order/${slug}/${orderId}`)}
      />
    </div>
  )
}
