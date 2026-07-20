// «الساعات الهادئة والتسعير الذكي».
//
// Two honesty constraints drive this screen:
//  1. "Quiet" only exists relative to a peak that is itself real. forecast.js
//     already restricts the grid to hours the venue demonstrably operates; we
//     additionally refuse when the peak is below the noise floor.
//  2. The discount is bounded by the WORST real margin among priced items with a
//     known recipe cost — a cart-wide offer touches everything, so the weakest
//     item sets the ceiling. With no recipe costs at all, the proposal is
//     labelled "not margin-backed" rather than dressed up as analysis.
import { useMemo } from 'react'
import Icon from '../Icon.jsx'
import { GCard, GRefusal, GBasis, GTag, GNumbers, GLimits, GConfidence } from './parts.jsx'
import { quietHourPlan, quietOfferDraft } from '../../lib/growth.js'

export default function QuietHoursPanel({
  orders = [], items = [], materials = [], offers = [],
  lang = 'ar', days = 30, marginFloorPct = 15, onCreateOffer,
}) {
  const ar = lang !== 'en'
  const plan = useMemo(
    () => quietHourPlan({ orders, items, materials, offers, days, marginFloorPct }),
    [orders, items, materials, offers, days, marginFloorPct],
  )
  const head = plan.headroom

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <GCard title={ar ? 'مساحة الهامش المتاحة' : 'Margin headroom'} icon="scale"
        badge={<GTag kind={head.known ? 'good' : 'bad'}>{head.known ? (ar ? 'مسنود بتكاليف' : 'cost-backed') : (ar ? 'غير محسوب' : 'unknown')}</GTag>}>
        <GNumbers data={{
          [ar ? 'أصناف مسعّرة' : 'Priced items']: head.itemsPriced,
          [ar ? 'أصناف لها تكلفة وصفة' : 'With recipe cost']: head.itemsWithCost,
          [ar ? 'أرضية الهامش' : 'Margin floor']: `${head.marginFloorPct}%`,
          [ar ? 'أقصى خصم آمن' : 'Max safe discount']: head.maxDiscountPct === null ? (ar ? 'غير محسوب' : 'n/a') : `${head.maxDiscountPct}%`,
          [ar ? 'الصنف المُقيِّد' : 'Binding item']: head.bindingItem?.name || (ar ? 'لا يوجد' : 'none'),
        }} />
        <GBasis>{head.noteAr}</GBasis>
      </GCard>

      {!plan.ok ? (
        <GRefusal
          icon="clock"
          title={ar ? 'لا توجد فترة هادئة يمكن التوصية بها' : 'No recommendable quiet window'}
          body={ar
            ? `${plan.reasonAr}. لن نقترح خصماً على فترة قد يكون هدوؤها مجرد تذبذب: العينة ${plan.sample.ordersInWindow} طلباً على ${plan.sample.daysWithOrders} يوماً فيها طلبات.`
            : `${plan.reasonAr}. Sample: ${plan.sample.ordersInWindow} orders across ${plan.sample.daysWithOrders} days with orders.`}
        />
      ) : (
        plan.windows.map((w) => (
          <GCard
            key={w.id}
            icon="clock"
            title={ar ? `${w.weekdayName} · ${w.startTime} — ${w.endTime}` : `${w.weekdayName} ${w.startTime}-${w.endTime}`}
            badge={<GConfidence level={w.confidence} ar={ar} />}
            actions={typeof onCreateOffer === 'function' && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onCreateOffer(quietOfferDraft(w, { lang }))}>
                <Icon name="offers" size={14} />
                {ar ? `أنشئ عرض ${w.suggestedValue}%` : `Create ${w.suggestedValue}% offer`}
              </button>
            )}
          >
            <div className="g-why">{w.whyAr}</div>
            <div className={w.marginBacked ? 'g-why' : 'gu-dropped'}>
              {w.marginBacked
                ? w.boundAr
                : `${w.boundAr}`}
            </div>
            <GNumbers data={w.numbers} />
            <GBasis>
              {ar
                ? `لا يوجد هنا أي رقم توقّعي: الأرقام أعلاه هي الحجم المسجّل فعلاً في تلك الفترة. أثر العرض لن يُعرف إلا بعد تشغيله.`
                : 'No projected figures here: these are the volumes actually recorded. The effect is unknown until the offer runs.'}
            </GBasis>
          </GCard>
        ))
      )}

      <GCard title={ar ? 'العينة' : 'Sample'} icon="chartBar">
        <GNumbers data={{
          [ar ? 'النافذة' : 'Window']: `${plan.sample.windowDays} ${ar ? 'يوماً' : 'days'}`,
          [ar ? 'طلبات' : 'Orders']: plan.sample.ordersInWindow,
          [ar ? 'أيام فيها طلبات' : 'Days with orders']: plan.sample.daysWithOrders,
          [ar ? 'ساعات عمل مرصودة' : 'Operating hours']: plan.sample.openHours,
          [ar ? 'فترات مقارنة' : 'Comparable buckets']: plan.sample.buckets,
        }} />
        <GLimits items={plan.limits} />
      </GCard>
    </div>
  )
}
