// «المكافأة» — optional, and deliberately blunt about what the product can and
// cannot do.
//
// There is no automatic redemption anywhere in RBT360. A points reward does NOT
// credit a member's balance from the guest's phone: an anonymous diner cannot
// write the customers document, and a "points added" message with no ledger
// behind it is a lie. So both reward kinds issue a code the cashier honours —
// the same mechanism «ركن الألعاب» already uses — and this panel says so before
// the venue commits to a promise it cannot keep.
import Icon from '../Icon.jsx'
import { REWARD_KINDS, rewardText } from '../../lib/ads.js'

export default function AdRewardStep({ ad, onChange, lang = 'ar' }) {
  const ar = lang !== 'en'
  const reward = (patch) => onChange({ ...ad, reward: { ...ad.reward, ...patch } })
  const kind = ad.reward.kind
  const preview = rewardText(ad.reward)

  return (
    <>
      <div>
        <h4>{ar ? 'مكافأة مرتبطة بالإعلان' : 'Attached reward'}</h4>
        <p className="ads-hint">
          {ar
            ? 'عند وجود مكافأة يتحول زر الإجراء إلى استلامها: يظهر للضيف رمز ثابت يعرضه على الكاشير، ولا ينتقل إلى أي وجهة أخرى.'
            : 'With a reward attached the CTA claims it and reveals a code instead of navigating.'}
        </p>
      </div>

      <div className="ads-steps">
        {REWARD_KINDS.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`chip${kind === r.id ? ' active' : ''}`}
            onClick={() => reward({ kind: r.id })}
          >
            <Icon name={r.icon} size={15} />
            {ar ? r.ar : r.en}
          </button>
        ))}
      </div>

      {kind === 'points' ? (
        <>
          <div className="field">
            <label htmlFor="ads-points">{ar ? 'عدد النقاط' : 'Points'}</label>
            <input
              id="ads-points"
              className="input"
              type="number"
              min="1"
              max="10000"
              value={ad.reward.value}
              onChange={(e) => reward({ value: Number(e.target.value) })}
            />
          </div>
          <div className="ads-warn">
            <Icon name="warning" size={16} />
            <span>
              {ar
                ? 'النقاط لا تُضاف تلقائياً إلى رصيد العضو. الضيف يحصل على رمز، والكاشير هو من يضيف النقاط من صفحة العملاء. لا تعد الضيف بغير ذلك في نص الإعلان.'
                : 'Points are not credited automatically. The guest gets a code; a cashier adds the points.'}
            </span>
          </div>
        </>
      ) : null}

      {kind === 'coupon' ? (
        <>
          <div className="field">
            <label htmlFor="ads-code">{ar ? 'رمز الكوبون (اختياري)' : 'Coupon code (optional)'}</label>
            <input
              id="ads-code"
              className="input"
              dir="ltr"
              maxLength={24}
              value={ad.reward.code}
              onChange={(e) => reward({ code: e.target.value.toUpperCase() })}
              placeholder={ar ? 'اتركه فارغاً ليُولَّد رمز فريد لكل ضيف' : 'Leave empty for a per-guest code'}
            />
            <span className="ads-hint">
              {ar
                ? 'الرمز الثابت يصلح لعرض عام يمكن مشاركته. الرمز المولَّد يختلف من ضيف لآخر ويبقى ثابتاً لنفس الضيف عند إعادة الفتح.'
                : 'A fixed code is shareable; a generated code is unique per guest and stable on reopen.'}
            </span>
          </div>
          <div className="field">
            <label htmlFor="ads-rlabel">{ar ? 'وصف الكوبون كما يقرأه الضيف' : 'Coupon description'}</label>
            <input
              id="ads-rlabel"
              className="input"
              maxLength={60}
              value={ad.reward.label}
              onChange={(e) => reward({ label: e.target.value })}
              placeholder={ar ? 'مثال: خصم عشرة بالمئة على أول طلب' : 'e.g. ten percent off your first order'}
            />
          </div>
          <div className="ads-warn">
            <Icon name="warning" size={16} />
            <span>
              {ar
                ? 'هذا الرمز لا يُطبَّق على الفاتورة تلقائياً. تأكد أن فريق الكاشير يعرف ما يقابله قبل تفعيل الإعلان.'
                : 'The code is not applied to the bill automatically. Brief the cashier first.'}
            </span>
          </div>
        </>
      ) : null}

      {kind !== 'none' ? (
        <div className={`ads-warn ${preview ? 'ok' : 'err'}`}>
          <Icon name={preview ? 'ok' : 'no'} size={16} />
          <span>
            {preview
              ? (ar ? `سيقرأ الضيف: ${preview}` : `The guest reads: ${preview}`)
              : (ar
                ? 'المكافأة ناقصة الإعداد، ولن تُعرض على الضيف إطلاقاً — أكمل القيمة أو الوصف.'
                : 'The reward is incomplete and will not be shown to guests.')}
          </span>
        </div>
      ) : null}
    </>
  )
}
