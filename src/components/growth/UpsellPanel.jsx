// Admin view of «يُطلب معه»: every pairing in the venue that clears the
// thresholds, with support / confidence / lift and the counts behind each.
// It also previews the exact guest component, so the manager sees what a guest
// would see — including seeing NOTHING when the data is too thin.
import { useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import SmartUpsell from '../SmartUpsell.jsx'
import { GCard, GRefusal, GBasis, GTag, GNumbers, pct } from './parts.jsx'
import { basketIndex, topPairings, GROWTH_THRESHOLDS as TH } from '../../lib/growth.js'
import { lex } from '../../lib/venueTypes.js'

export default function UpsellPanel({ orders = [], items = [], tenant = null, lang = 'ar', currency = 'SAR', days = 90 }) {
  const ar = lang !== 'en'
  const [preview, setPreview] = useState('')

  const index = useMemo(() => basketIndex(orders, { days }), [orders, days])
  const pairs = useMemo(() => topPairings(index, { items, limit: 30, lang }), [index, items, lang])

  const itemsWord = lex(tenant, 'items')

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <GCard
        title={ar ? 'قواعد التلازم المحسوبة' : 'Computed co-occurrence'}
        icon="layers"
        badge={<GTag kind={pairs.ok ? 'good' : 'warn'}>{pairs.rows.length}</GTag>}
      >
        <GNumbers data={{
          [ar ? 'طلبات مدفوعة في النافذة' : 'Paid orders in window']: pairs.sample.basketOrders,
          [ar ? 'طلبات بأكثر من صنف' : 'Multi-item orders']: pairs.sample.multiLineOrders,
          [ar ? 'النافذة' : 'Window']: `${pairs.sample.windowDays} ${ar ? 'يوماً' : 'days'}`,
          [ar ? 'أزواج تتجاوز الحدود' : 'Pairs above thresholds']: pairs.rows.length,
        }} />
        <GBasis>
          {ar
            ? `يُحتسب الزوج فقط عند تحقق الثلاثة معاً: ظهور الصنف المرجعي في ${TH.MIN_ANCHOR_ORDERS} طلبات على الأقل، وتلازم فعلي ${TH.MIN_PAIR_ORDERS} مرات على الأقل، ورفع (lift) لا يقل عن ${TH.MIN_LIFT} أي أن وجود الصنف المرجعي يرفع احتمال الآخر فعلاً ولا يعكس شعبيته وحدها. الأساس: ${index.basis}.`
            : `A pair counts only when all three hold: the anchor appears in at least ${TH.MIN_ANCHOR_ORDERS} orders, the pair co-occurred at least ${TH.MIN_PAIR_ORDERS} times, and lift is at least ${TH.MIN_LIFT}.`}
        </GBasis>
      </GCard>

      {!pairs.ok ? (
        <GRefusal
          title={ar ? 'لا توجد قاعدة تلازم يمكن الوثوق بها' : 'No trustworthy pairing yet'}
          body={ar
            ? `${pairs.reasonAr}. لن يظهر أي اقتراح للضيوف حتى تتوفر بيانات كافية — الاقتراح المخترع أسوأ من غيابه.`
            : `${pairs.reasonAr}. Nothing is shown to guests until the data supports it.`}
        />
      ) : (
        <div className="g-rows">
          {pairs.rows.map((r) => (
            <div className="g-row" key={r.key}>
              <div className="grow">
                <div className="g-pair">
                  <span>{r.aName}</span>
                  <span className="g-plus">+</span>
                  <span>{r.bName}</span>
                </div>
                <div className="g-basis" style={{ borderInlineStart: 0, paddingInlineStart: 0 }}>
                  {ar
                    ? `طُلبا معاً ${r.together} من ${r.anchorOrders} طلباً يحتوي «${r.aName}»`
                    : `Together ${r.together} of ${r.anchorOrders} orders containing "${r.aName}"`}
                </div>
              </div>
              <span className="g-metric">{ar ? 'الثقة' : 'Conf.'} {pct(r.confidence)}</span>
              <span className="g-metric">{ar ? 'الدعم' : 'Support'} {pct(r.support)}</span>
              <span className={`g-metric g-lift ${r.lift >= 2 ? 'strong' : ''}`}>lift {r.lift ?? '—'}</span>
              <button
                type="button"
                className="btn btn-xs btn-outline"
                onClick={() => setPreview(preview === r.aId ? '' : r.aId)}
              >
                <Icon name="eye" size={13} /> {ar ? 'معاينة الضيف' : 'Guest preview'}
              </button>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <GCard title={ar ? `ما يراه الضيف مع «${(items.find((i) => i.id === preview) || {}).nameAr || ''}»` : 'What the guest sees'} icon="eye">
          <SmartUpsell
            orders={orders}
            items={items}
            index={index}
            anchorIds={[preview]}
            tenant={tenant}
            lang={lang}
            currency={currency}
            showBasis
          />
          <GBasis>
            {ar
              ? `هذه المعاينة تستخدم نفس المحرك بلا أي تليين. إن لم يظهر شيء أعلاه فهذا ما سيراه الضيف بالضبط: لا شيء.`
              : 'This preview uses the same engine. If nothing renders above, that is exactly what a guest sees: nothing.'}
          </GBasis>
        </GCard>
      )}

      <GBasis>
        {ar
          ? `لا يُقترح ${itemsWord} غير متاح أو نافد المخزون، ولا يُقترح صنف موجود في السلة أصلاً.`
          : 'Unavailable, out-of-stock and already-in-cart items are never suggested.'}
      </GBasis>
    </div>
  )
}
