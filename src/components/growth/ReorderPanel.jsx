// «إعادة الطلب بضغطة» — admin view.
//
// It answers the only question that matters before shipping the guest card:
// how many returning guests actually HAVE a repeated basket? A venue with two
// habitual guests should be told that, not shown a feature tour.
import { useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import ReorderCard from './ReorderCard.jsx'
import { GCard, GRefusal, GBasis, GTag, GNumbers } from './parts.jsx'
import { repeatGuests, GROWTH_THRESHOLDS as TH } from '../../lib/growth.js'

export default function ReorderPanel({ orders = [], items = [], tenant = null, lang = 'ar', currency = 'SAR' }) {
  const ar = lang !== 'en'
  const [preview, setPreview] = useState('')

  const res = useMemo(() => repeatGuests({ orders, items, limit: 40, lang }), [orders, items, lang])

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <GCard title={ar ? 'الضيوف العائدون' : 'Returning guests'} icon="repeat">
        <GNumbers data={{
          [ar ? 'طلبات فُحصت' : 'Orders scanned']: res.ordersScanned,
          [ar ? 'أرقام مميزة' : 'Distinct phones']: res.totalGuestsWithPhone,
          [ar ? 'لديهم طلب متكرر فعلاً' : 'With a real repeated basket']: res.withRealHabit,
          [ar ? 'قابلون لإعادة الطلب' : 'Reorderable today']: res.rows.length,
        }} />
        <GBasis>
          {ar
            ? `«طلب معتاد» = سلة بنفس الأصناف والكميات والأحجام تكررت ${TH.MIN_REPEATS} مرات على الأقل. من لم يتكرر له طلب تظهر له بطاقة «آخر طلب» بصياغة مختلفة، ولا تُسمّى عادةً. الأصناف المحذوفة أو غير المتاحة تُسقط من البطاقة ويُذكر سببها للضيف.`
            : `"Usual" = an identical basket repeated at least ${TH.MIN_REPEATS} times. Guests without a repeat get a differently worded "last order" card.`}
        </GBasis>
      </GCard>

      {res.rows.length === 0 ? (
        <GRefusal
          icon="repeat"
          title={ar ? 'لا يوجد ضيف قابل لإعادة الطلب بعد' : 'No reorderable guest yet'}
          body={ar
            ? `فُحص ${res.ordersScanned} طلباً تخص ${res.totalGuestsWithPhone} رقماً. لا يوجد ضيف له طلبان صالحان أو أكثر ما زالت أصنافهما متاحة اليوم. البطاقة لن تظهر لأي ضيف حتى يتحقق ذلك.`
            : `${res.ordersScanned} orders across ${res.totalGuestsWithPhone} phones, none with two or more valid orders whose items are still available.`}
        />
      ) : (
        <div className="g-rows">
          {res.rows.map((r) => (
            <div className="g-row" key={r.key}>
              <div className="grow">
                <div className="bold" style={{ fontSize: '.9rem' }}>
                  {r.name || (ar ? 'ضيف' : 'Guest')}
                  <span dir="ltr" style={{ opacity: .6, fontSize: '.8rem', marginInlineStart: 8 }}>{r.phone}</span>
                </div>
                <div className="g-basis" style={{ borderInlineStart: 0, paddingInlineStart: 0 }}>
                  {r.labelAr} · {r.lines} {ar ? 'صنفاً' : 'lines'}
                  {r.dropped > 0 ? (ar ? ` · أُسقط ${r.dropped}` : ` · ${r.dropped} dropped`) : ''}
                </div>
              </div>
              <GTag kind={r.kind === 'usual' ? 'good' : 'warn'}>
                {r.kind === 'usual' ? (ar ? 'عادة' : 'habit') : (ar ? 'آخر طلب' : 'last only')}
              </GTag>
              <span className="g-metric">{r.total} {currency}</span>
              <button
                type="button"
                className="btn btn-xs btn-outline"
                onClick={() => setPreview(preview === r.phone ? '' : r.phone)}
              >
                <Icon name="eye" size={13} /> {ar ? 'معاينة' : 'Preview'}
              </button>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <GCard title={ar ? 'ما يراه هذا الضيف على القائمة' : 'What this guest sees'} icon="eye">
          <ReorderCard
            orders={orders}
            items={items}
            phone={preview}
            tenant={tenant}
            lang={lang}
            currency={currency}
          />
        </GCard>
      )}
    </div>
  )
}
