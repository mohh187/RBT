// «طلبك المعتاد؟» — the GUEST-side one-tap reorder card.
//
// Honesty rules this card enforces:
//  - It says «طلبك المعتاد» ONLY when a basket actually repeated (>= 2 times)
//    and shows how many times. A single past visit is labelled «آخر طلب لك».
//  - Items removed from the menu or currently unavailable are DROPPED and named,
//    with the reason. It never silently refills a cart with things that cannot
//    be made.
//  - The total is recomputed from today's prices, and says so when they changed.
import { useMemo } from 'react'
import Icon from '../Icon.jsx'
import { Price } from '../Riyal.jsx'
import { usualOrder } from '../../lib/growth.js'
import { lex } from '../../lib/venueTypes.js'
import '../../styles/growth.css'

/**
 * @param {object[]} orders  venue order history (the guest's are filtered by phone)
 * @param {object[]} items   current menu, for availability + current prices
 * @param {string}   phone   the returning guest's phone
 * @param {function} onRefill  (lines, result) => void — the lead wires this to
 *                             the real cart; `lines` carry itemId/qty/variantKey
 * @param {function} onDismiss optional
 */
export default function ReorderCard({
  orders = [], items = [], phone = '', onRefill, onDismiss,
  tenant = null, lang = 'ar', currency = 'SAR',
}) {
  const ar = lang !== 'en'
  const usual = useMemo(
    () => usualOrder(orders, phone, { items, lang }),
    [orders, phone, items, lang],
  )

  // Nothing reorderable = nothing rendered. We do not show an empty teaser.
  if (!usual.found) return null

  const isHabit = usual.kind === 'usual'
  const orderWord = lex(tenant, 'order')

  return (
    <div className="gu-reorder">
      <div className="gu-reorder-head">
        <div className="gu-reorder-title">
          <Icon name="repeat" size={17} />
          <span>
            {isHabit
              ? (ar ? `${orderWord}ك المعتاد؟` : 'Your usual?')
              : (ar ? `تعيد ${orderWord}ك السابق؟` : 'Reorder your last one?')}
          </span>
        </div>
        {onDismiss && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onDismiss} aria-label={ar ? 'إخفاء' : 'Dismiss'}>
            <Icon name="close" size={15} />
          </button>
        )}
      </div>

      {/* the claim and its evidence, together */}
      <div className="gu-reorder-sub">
        {ar
          ? usual.labelAr
          : (isHabit
            ? `Repeated ${usual.timesOrdered} of ${usual.ofOrders} orders`
            : `Your last order of ${usual.ofOrders}`)}
        {usual.honestNote && ar ? ` — ${usual.honestNote}` : ''}
      </div>

      <div className="gu-reorder-lines">
        {usual.lines.map((l, i) => (
          <div className="gu-reorder-line" key={`${l.itemId}-${i}`}>
            <span className="q">{l.qty}x</span>
            <span className="grow">
              {l.name}
              {l.variantName ? <span className="q"> · {l.variantName}</span> : null}
              {l.variantDropped ? <span className="q"> · {ar ? 'الحجم السابق لم يعد متاحاً' : 'old size gone'}</span> : null}
            </span>
            <span className="q"><Price value={l.lineTotal} currency={currency} lang={lang} /></span>
          </div>
        ))}
      </div>

      {/* dropped items are NAMED, never quietly omitted */}
      {usual.dropped.length > 0 && (
        <div className="gu-dropped">
          {ar
            ? usual.droppedNoteAr
            : `Dropped ${usual.dropped.length} item(s) from your previous order: ${usual.dropped.map((x) => `"${x.name || 'item'}"`).join(', ')}`}
        </div>
      )}

      {usual.priceChanged && (
        <div className="gu-reorder-sub">
          {ar
            ? `تغيّرت بعض الأسعار منذ ذلك الطلب — الإجمالي أدناه محسوب بأسعار اليوم (كان ${usual.historicalTotal}).`
            : `Some prices changed since then — the total below uses today's prices (was ${usual.historicalTotal}).`}
        </div>
      )}

      <div className="gu-reorder-actions">
        <button
          type="button"
          className="btn btn-primary grow"
          onClick={() => { if (typeof onRefill === 'function') onRefill(usual.lines, usual) }}
          disabled={typeof onRefill !== 'function'}
        >
          <Icon name="cart" size={16} />
          {ar ? 'أضف للسلة' : 'Add to cart'}
          <span> · </span>
          <Price value={usual.total} currency={currency} lang={lang} />
        </button>
      </div>
    </div>
  )
}
