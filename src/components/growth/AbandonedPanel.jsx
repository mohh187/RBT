// «استرجاع السلة المتروكة» — the reachable list, built from real sessions.
//
// The unreachable count is shown with the SAME prominence as the reachable one.
// A recovery list that hides how many people it cannot reach is a vanity metric.
// No phone is ever inferred: each row states how we came to hold that number.
import { useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import { GCard, GRefusal, GBasis, GTag, GNumbers, GLimits } from './parts.jsx'
import { abandonedCarts, abandonedCampaignDraft, abandonedMessage, GROWTH_THRESHOLDS as TH } from '../../lib/growth.js'
import { arPlural } from '../../lib/forecast.js'

const VIA_TAG = { session: 'good', device: 'warn', 'past-order': 'warn' }

export default function AbandonedPanel({
  sessions = [], orders = [], customers = [], items = [],
  tenant = null, lang = 'ar', currency = 'SAR', days = 14,
  onCreateCampaign, sessionsLoadError = '',
}) {
  const ar = lang !== 'en'
  const [picked, setPicked] = useState(null) // null = all reachable

  const res = useMemo(
    () => abandonedCarts({ sessions, orders, customers, items, days, lang }),
    [sessions, orders, customers, items, days, lang],
  )

  const selected = picked ? res.reachable.filter((r) => r.phoneKey === picked) : res.reachable
  const canSend = typeof onCreateCampaign === 'function' && selected.length > 0

  const send = () => {
    if (!canSend) return
    onCreateCampaign(abandonedCampaignDraft(res, { venueName: tenant?.name || '', lang, rows: selected }))
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <GCard
        title={ar ? 'السلال المتروكة' : 'Abandoned carts'}
        icon="cart"
        actions={canSend && (
          <button type="button" className="btn btn-sm btn-primary" onClick={send}>
            <Icon name="message" size={14} />
            {ar ? `جهّز حملة لـ ${selected.length}` : `Draft campaign for ${selected.length}`}
          </button>
        )}
      >
        <GNumbers data={{
          [ar ? 'جلسات في النافذة' : 'Sessions in window']: res.sample.sessionsInWindow,
          [ar ? 'أضاف للسلة ولم يطلب' : 'Added, never ordered']: res.sample.abandonedSessions,
          [ar ? 'يمكن الوصول إليهم' : 'Reachable']: res.sample.distinctReachableGuests,
          [ar ? 'لا يمكن الوصول إليهم' : 'Unreachable']: res.unreachable,
          [ar ? 'قيمة متروكة' : 'Value left behind']: res.leftBehindValue === null ? (ar ? 'غير محسوبة' : 'not computable') : `${res.leftBehindValue} ${currency}`,
        }} />

        {res.unreachableNote && (
          <div className="gu-dropped">{res.unreachableNote}.</div>
        )}

        <GBasis>
          {ar
            ? `النافذة ${arPlural(res.days, { one: 'يوم', two: 'يومان', few: 'أيام', many: 'يوماً' })}. ${res.leftBehindNote}. القيمة محسوبة لـ ${arPlural(res.leftBehindPricedRows, { one: 'سلة', two: 'سلتين', few: 'سلال', many: 'سلة' })} تحمل كل أسطرها سعراً.`
            : `Window ${res.days} days. ${res.leftBehindNote}.`}
        </GBasis>
      </GCard>

      {sessionsLoadError && (
        <GRefusal
          icon="warning"
          title={ar ? 'تعذّر تحميل الجلسات' : 'Sessions could not be loaded'}
          body={ar
            ? 'الأرقام أدناه محسوبة على ما وصل فقط، وقد تكون ناقصة. أعد فتح الصفحة بعد قليل لترى القائمة كاملة.'
            : 'The figures below cover only what loaded, so they may be incomplete. Reopen the page shortly for the full list.'}
        />
      )}

      {res.reachable.length === 0 ? (
        <GRefusal
          icon="phone"
          title={ar ? 'لا يوجد أحد يمكن مراسلته' : 'Nobody is reachable'}
          body={ar
            ? `رُصدت ${arPlural(res.sample.abandonedSessions, { one: 'جلسة', two: 'جلستان', few: 'جلسات', many: 'جلسة' })} تركت السلة، ولا يحمل أي منها رقماً معروفاً. لن نخترع رقماً، ولا يمكن اشتقاقه من جهاز لم يعرّف نفسه قط.`
            : `${res.sample.abandonedSessions} abandoning sessions, none carrying a known phone. We will not invent one.`}
        />
      ) : (
        <>
          {res.thin && (
            <GRefusal
              icon="warning"
              title={ar ? 'العينة صغيرة' : 'Thin sample'}
              body={ar
                ? `${res.thinNote}. يمكنك مراسلتهم فردياً، لكن لا تقرأ في هذا العدد اتجاهاً. الحد الأدنى لاعتباره حملة هو ${TH.MIN_ABANDONED}.`
                : `${res.thinNote}.`}
            />
          )}

          <div className="g-rows">
            {res.reachable.map((r) => (
              <div className="g-row" key={r.phoneKey}>
                <div className="grow">
                  <div className="bold" style={{ fontSize: '.9rem' }}>
                    {r.name || (ar ? 'ضيف' : 'Guest')}
                    <span dir="ltr" style={{ opacity: .6, fontSize: '.8rem', marginInlineStart: 8 }}>{r.phone}</span>
                  </div>
                  <div className="g-basis" style={{ borderInlineStart: 0, paddingInlineStart: 0 }}>
                    {ar ? 'ترك: ' : 'Left: '}
                    {r.items.slice(0, 3).map((i) => `${i.qty}x ${i.name}`).join('، ')}
                    {r.items.length > 3 ? (ar ? ` و${r.items.length - 3} أخرى` : ` +${r.items.length - 3}`) : ''}
                    {' · '}
                    {r.viaAr}
                    {r.sessionsAbandoned > 1 ? (ar ? ` · ترك السلة ${arPlural(r.sessionsAbandoned, { one: 'مرة', two: 'مرتين', few: 'مرات', many: 'مرة' })}` : ` · ${r.sessionsAbandoned} times`) : ''}
                  </div>
                </div>
                <GTag kind={VIA_TAG[r.via] || ''}>{r.reachedCheckout ? (ar ? 'وصل للدفع' : 'reached checkout') : (ar ? 'سلة فقط' : 'cart only')}</GTag>
                {r.estValue !== null && <span className="g-metric">{r.estValue} {currency}</span>}
                <button
                  type="button"
                  className={`btn btn-xs ${picked === r.phoneKey ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setPicked(picked === r.phoneKey ? null : r.phoneKey)}
                >
                  {picked === r.phoneKey ? (ar ? 'محدّد' : 'Selected') : (ar ? 'اختر' : 'Select')}
                </button>
              </div>
            ))}
          </div>

          <GCard title={ar ? 'الرسالة المقترحة' : 'Suggested message'} icon="message">
            <div className="g-why" style={{ whiteSpace: 'pre-wrap' }}>
              {abandonedMessage(selected[0] || res.reachable[0], { venueName: tenant?.name || '', lang })}
            </div>
            <GBasis>
              {ar
                ? 'الرسالة تذكر ما تركه الضيف فعلاً ولا تعد بخصم أو مكافأة لم تُهيّئها المنشأة. تُسلَّم كمسودة لصفحة الحملات ولا تُرسل من هنا.'
                : 'The message references what was actually left and promises no reward the venue has not configured.'}
            </GBasis>
          </GCard>
        </>
      )}

      <GLimits items={res.limits} />
    </div>
  )
}
