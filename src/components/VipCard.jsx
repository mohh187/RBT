import Icon from './Icon.jsx'
import { TIER_META } from '../lib/membership.js'

// Luxury physical-style membership card. One component renders the member page,
// the staff view, and the admin design preview — so the venue designs it once.
// Design source: tenant.memberCardDesign = { template: 'metal'|'glass'|'noir',
// bgUrl: '' (photo behind the card face), showLogo: true }.
// Tier drives the metal: silver → gold → platinum gradients (TIER_META colors).
export default function VipCard({ tenant, card, lang = 'ar' }) {
  const ar = lang === 'ar'
  const design = tenant?.memberCardDesign || {}
  const tpl = design.template || 'metal'
  const tier = card?.tier || 'silver'
  const meta = TIER_META[tier] || TIER_META.silver
  const memberName = card?.name || (ar ? 'عميل' : 'Member')

  return (
    <div className="vipcard" data-tier={tier} data-tpl={tpl} data-hasbg={design.bgUrl ? '1' : '0'} dir={ar ? 'rtl' : 'ltr'}>
      {design.bgUrl && <img className="vip-bgimg" src={design.bgUrl} alt="" aria-hidden="true" />}
      <span className="vip-veil" aria-hidden="true" />
      <span className="vip-sheen" aria-hidden="true" />

      <div className="vip-top">
        {design.showLogo !== false && (
          tenant?.logoUrl
            ? <img className="vip-logo" src={tenant.logoUrl} alt="" />
            : <span className="vip-logo vip-logo-ph"><Icon name="store" size={20} /></span>
        )}
        <div className="vip-venue">
          <strong>{tenant?.name || 'rbt360'}</strong>
          <span className="vip-club">{ar ? 'نادي الأعضاء' : 'Members Club'}</span>
        </div>
        <span className="vip-tierbadge"><Icon name={meta.icon || 'award'} size={12} /> {ar ? meta.ar : meta.en}</span>
      </div>

      <div className="vip-mid">
        <span className="vip-emvchip" aria-hidden="true"><i /><i /><i /></span>
        <Icon name="wifi" size={20} className="vip-nfc" aria-hidden="true" />
      </div>

      <div className="vip-bottom">
        <div className="vip-name">{memberName}</div>
        <div className="vip-meta">
          <span className="vip-id" dir="ltr">{card?.memberId || '—'}</span>
          {card?.discountPct ? <span className="vip-disc">{card.discountPct}%</span> : null}
        </div>
      </div>
    </div>
  )
}
