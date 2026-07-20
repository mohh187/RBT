// «يُطلب معه» — the GUEST-side upsell.
//
// It shows a suggestion ONLY when the venue's own paid orders prove the pairing:
// the anchor must appear in enough orders, the pair must have co-occurred enough
// times, and the lift must beat the other item's baseline popularity. When any
// of those fails this component renders NOTHING. That silence is the feature —
// a fabricated "goes well with" teaches guests to ignore the whole surface.
//
// The reason under each suggestion is the arithmetic itself ("ordered with X in
// 12 of 40 orders"), so nothing is claimed that the guest could not verify.
import { useMemo } from 'react'
import Icon from './Icon.jsx'
import { Price } from './Riyal.jsx'
import { basketIndex, upsellFor, effectivePrice } from '../lib/growth.js'
import { lex } from '../lib/venueTypes.js'
import '../styles/growth.css'

/**
 * @param {object[]} orders   venue orders (settled ones are filtered internally)
 * @param {object[]} items    menu items, for names/prices/availability
 * @param {string[]} anchorIds  itemId(s) to suggest against (cart contents, or
 *                              the one item whose sheet is open)
 * @param {string[]} excludeIds items already in the cart — never re-suggested
 * @param {function} onAdd    (item, suggestion) => void  — the lead wires this
 *                            to the real cart action
 * @param {object}   index    optional precomputed basketIndex() (avoids
 *                            recomputing per item sheet)
 * @param {boolean}  showBasis  render the sample line (admin previews)
 */
export default function SmartUpsell({
  orders = [], items = [], anchorIds = [], excludeIds = [],
  onAdd, index = null, tenant = null, lang = 'ar', currency = 'SAR',
  max = 3, title = '', showBasis = false, days = 90,
}) {
  const ar = lang !== 'en'

  const idx = useMemo(
    () => index || basketIndex(orders, { days }),
    [index, orders, days],
  )

  // Anchors/exclusions are usually inlined arrays by the caller, so a fresh
  // identity every render would recompute on each keystroke elsewhere in the
  // page. Key the memo on the CONTENT instead.
  const anchorKey = anchorIds.join(',')
  const excludeKey = excludeIds.join(',')
  const result = useMemo(
    () => upsellFor(idx, anchorKey ? anchorKey.split(',') : [], {
      items, limit: max, exclude: excludeKey ? excludeKey.split(',') : [], lang,
    }),
    [idx, anchorKey, excludeKey, items, max, lang],
  )

  // THE suppression. No fallback, no "popular items" consolation rail — if the
  // data cannot prove a pairing we say nothing at all.
  if (!result.ok || !result.suggestions.length) return null

  const itemWord = lex(tenant, 'item')
  const heading = title || (ar ? `يُطلب معه عادةً` : 'Usually ordered with')

  return (
    <div className="gu-upsell">
      <div className="gu-upsell-title">
        <Icon name="sparkles" size={14} />
        <span>{heading}</span>
      </div>

      <div className="gu-list">
        {result.suggestions.map((s) => {
          const it = s.item
          const price = it ? effectivePrice(it) : 0
          const img = it?.imageUrl || (it?.images || [])[0] || ''
          return (
            <button
              type="button"
              className="gu-item"
              key={s.itemId}
              onClick={() => { if (typeof onAdd === 'function' && it) onAdd(it, s) }}
              disabled={!it || typeof onAdd !== 'function'}
              aria-label={`${ar ? 'أضف' : 'Add'} ${s.name}`}
            >
              {img
                ? <img className="gu-thumb" src={img} alt="" loading="lazy" />
                : <span className="gu-thumb ph"><Icon name="coffee" size={20} /></span>}
              <span className="grow">
                <span className="gu-name">{s.name}</span>
                {/* the reason IS the count — nothing softer, nothing invented */}
                <span className="gu-reason">{ar ? s.reasonAr : s.reasonEn}</span>
              </span>
              {price > 0 && (
                <span className="gu-price"><Price value={price} currency={currency} lang={lang} /></span>
              )}
              <span className="gu-add" aria-hidden="true"><Icon name="add" size={15} /></span>
            </button>
          )
        })}
      </div>

      {showBasis && (
        <div className="g-basis">
          {ar
            ? `محسوب من ${result.sample.basketOrders} طلباً مدفوعاً خلال ${result.sample.windowDays} يوماً، منها ${result.sample.multiLineOrders} طلباً بأكثر من ${itemWord} واحد.`
            : `From ${result.sample.basketOrders} paid orders over ${result.sample.windowDays} days, ${result.sample.multiLineOrders} of them with more than one item.`}
        </div>
      )}
    </div>
  )
}
