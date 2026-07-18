import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { resolveSlug, getTenant, getMemberByToken } from '../../lib/db.js'
import { resolveMembershipPolicy, TIER_META, nextTierProgress, pointsToDiscount } from '../../lib/membership.js'
import { qrDataUrl } from '../../lib/qr.js'
import { useI18n } from '../../lib/i18n.jsx'
import { FullSpinner, Empty } from '../../components/ui.jsx'
import { Price } from '../../components/Riyal.jsx'
import Icon from '../../components/Icon.jsx'
import VipCard from '../../components/VipCard.jsx'

// Public VIP member card — reached via the card QR (/mcard/:slug/:token).
export default function MemberCard() {
  const { slug, token } = useParams()
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const [state, setState] = useState({ loading: true })
  const [qr, setQr] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const tid = await resolveSlug(slug).catch(() => null)
        if (!tid) { if (alive) setState({ loading: false }); return }
        const [tenant, member] = await Promise.all([getTenant(tid), getMemberByToken(tid, token)])
        if (alive) setState({ loading: false, tenant, member })
      } catch (_) {
        // a rules/network failure must not leave an infinite spinner
        if (alive) setState({ loading: false })
      }
    })()
    qrDataUrl(window.location.href, { width: 320 }).then((d) => { if (alive) setQr(d) }).catch(() => {})
    return () => { alive = false }
  }, [slug, token])

  if (state.loading) return <FullSpinner />
  const { tenant, member: card } = state
  if (!card?.active) return <div className="container page"><Empty icon="wallet" title={ar ? 'بطاقة غير صالحة' : 'Invalid card'} /></div>

  const policy = resolveMembershipPolicy(tenant)
  const meta = TIER_META[card.tier] || TIER_META.silver
  const prog = nextTierProgress(policy, card.pointsLifetime || 0, card.totalOrders ?? null)
  const worth = pointsToDiscount(policy, card.points || 0)
  const currency = tenant?.currency || 'SAR'
  const pct = prog ? Math.min(100, Math.round(((prog.have || 0) / (prog.need || 1)) * 100)) : 100
  const nextMeta = prog ? TIER_META[prog.next] : null

  return (
    <div className="container page stack" style={{ maxWidth: 460, gap: 'var(--sp-4)' }}>
      {/* the luxury card itself — venue-designed (template/photo), tier-metaled */}
      <VipCard tenant={tenant} card={card} lang={lang} />

      <div className="card card-pad stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Box label={ar ? 'النقاط' : 'Points'} value={card.points || 0} />
          <Box label={ar ? 'قيمتها' : 'Worth'} value={<Price value={worth} currency={currency} lang={lang} />} />
          <Box label={ar ? 'خصم دائم' : 'Discount'} value={`${card.discountPct || 0}%`} />
        </div>
        {prog ? (
          <div className="stack" style={{ gap: 4 }}>
            <div className="xs faint">
              {prog.by === 'orders'
                ? (ar ? `${prog.remaining} طلب${prog.remaining === 2 ? 'ين' : prog.remaining > 2 && prog.remaining <= 10 ? 'ات' : ''} تفصلك عن عضوية ${nextMeta ? nextMeta.ar : ''}` : `${prog.remaining} orders to ${nextMeta ? nextMeta.en : 'next'} tier`)
                : (ar ? `${prog.remaining} نقطة للترقية لعضوية ${nextMeta ? nextMeta.ar : ''}` : `${prog.remaining} pts to ${nextMeta ? nextMeta.en : 'next'} tier`)}
            </div>
            <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-2)' }}><div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: nextMeta?.color || meta.color }} /></div>
          </div>
        ) : <div className="xs" style={{ color: meta.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="star" size={12} /> {ar ? 'أعلى مستوى — بلاتيني' : 'Top tier — Platinum'}</div>}
      </div>

      {qr && (
        <div className="card card-pad stack center" style={{ gap: 8 }}>
          <img src={qr} alt="QR" style={{ width: 200, height: 200 }} />
          <span className="xs faint" style={{ textAlign: 'center' }}>{ar ? 'اعرض هذا الرمز للكاشير لإضافة نقاطك مع كل زيارة' : 'Show this to the cashier to earn points each visit'}</span>
        </div>
      )}

      <a className="btn btn-primary btn-block" href={`/m/${slug}?m=${token}`} style={{ minHeight: 46, fontWeight: 800 }}>{ar ? `اطلب الآن بخصم ${card.discountPct || 0}%` : `Order now · ${card.discountPct || 0}% off`}</a>
      <button className="btn btn-outline btn-block" disabled>{ar ? 'أضِف إلى Apple Wallet (قريباً)' : 'Add to Apple Wallet (soon)'}</button>

      <div className="row" style={{ gap: 8 }}>
        <Box label={ar ? 'إجمالي الطلبات' : 'Orders'} value={card.totalOrders || 0} />
        <Box label={ar ? 'إجمالي الإنفاق' : 'Spent'} value={<Price value={card.totalSpent || 0} currency={currency} lang={lang} />} />
      </div>
    </div>
  )
}

function Box({ label, value }) {
  return (
    <div className="card card-pad stack center" style={{ gap: 2, padding: '10px 12px', flex: '1 0 28%' }}>
      <span className="bold">{value}</span>
      <span className="xs faint">{label}</span>
    </div>
  )
}
