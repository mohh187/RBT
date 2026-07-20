// «صحة المنيو» — a scored audit where the score's formula is on screen.
//
// The important design decision: a check we could not run (no recipe costs, no
// orders, no categories) is EXCLUDED from the score and its weight redistributed
// across the checks that did run. Scoring a venue on a test we never performed
// would be the exact kind of invented number this system refuses.
import { useState } from 'react'
import Icon from '../Icon.jsx'
import { GCard, GRefusal, GBasis, GTag, GNumbers, GLimits } from './parts.jsx'

export default function MenuHealthPanel({ health, lang = 'ar', onFixItem }) {
  const ar = lang !== 'en'
  const [open, setOpen] = useState('')

  if (!health) return null
  if (health.score === null) {
    return (
      <GRefusal
        icon="notepad"
        title={ar ? 'لا يمكن حساب درجة' : 'No score can be computed'}
        body={health.formulaAr}
      />
    )
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <GCard title={ar ? 'درجة صحة القائمة' : 'Menu health score'} icon="chartBar">
        <div className="g-score">
          <div className={`g-dial ${health.grade}`} style={{ '--pct': health.score }}>
            <span className="g-dial-v">{health.score}</span>
          </div>
          <div className="grow" style={{ minWidth: 200 }}>
            <div className="g-formula">{health.formulaAr}</div>
            <div className="g-basis" style={{ marginTop: 6 }}>
              {ar
                ? `أُجري ${health.measurableChecks} فحصاً من ${health.totalChecks}. الفحوص غير القابلة للقياس استُبعدت من الدرجة وأُعيد توزيع أوزانها — لا تُحتسب المنشأة على اختبار لم يُجرَ.`
                : `${health.measurableChecks} of ${health.totalChecks} checks ran. Unmeasurable checks are excluded and their weight redistributed.`}
            </div>
          </div>
        </div>

        <GNumbers data={{
          [ar ? 'أصناف' : 'Items']: health.sample.items,
          [ar ? 'تصنيفات' : 'Categories']: health.sample.categories,
          [ar ? `طلبات آخر ${health.days} يوماً` : `Orders in ${health.days}d`]: health.sample.ordersInWindow,
          [ar ? 'أصناف بيعت في النافذة' : 'Items sold in window']: health.sample.itemsSoldInWindow,
          [ar ? 'مواد خام' : 'Materials']: health.sample.materials,
        }} />
        <GLimits items={health.notes} />
      </GCard>

      <div className="g-card">
        {health.findings.map((f) => {
          const isOpen = open === f.key
          const share = f.measurable ? Math.round((f.share || 0) * 100) : 0
          const cls = !f.measurable ? 'unmeasured' : f.affected === 0 ? 'ok' : share >= 50 ? 'bad' : ''
          return (
            <div className={`g-finding ${cls}`} key={f.key}>
              <button
                type="button"
                className="g-finding-head"
                onClick={() => setOpen(isOpen ? '' : f.key)}
                disabled={!f.measurable || f.affected === 0}
              >
                <Icon name={f.measurable ? (f.affected === 0 ? 'ok' : 'warning') : 'no'} size={16} />
                <div className="grow">
                  <div style={{ fontSize: '.88rem', fontWeight: 600 }}>
                    {ar ? f.labelAr : f.labelEn}
                    <span style={{ opacity: .55, fontWeight: 400, fontSize: '.78rem' }}> · {ar ? 'الوزن' : 'weight'} {f.weight}</span>
                  </div>
                  {f.measurable ? (
                    <>
                      <div className="g-bar"><i style={{ width: `${share}%` }} /></div>
                      <div className="g-basis" style={{ borderInlineStart: 0, paddingInlineStart: 0, marginTop: 4 }}>
                        {f.affected} {ar ? 'من' : 'of'} {f.applicable} ({share}%){ar ? ` — ${f.whyAr}` : ''}
                      </div>
                    </>
                  ) : (
                    <div className="g-basis" style={{ borderInlineStart: 0, paddingInlineStart: 0, marginTop: 4 }}>
                      {ar ? `غير قابل للقياس: ${f.unmeasurableAr}` : `Not measurable: ${f.unmeasurableAr}`}
                    </div>
                  )}
                </div>
                {f.measurable && <GTag kind={f.affected === 0 ? 'good' : share >= 50 ? 'bad' : 'warn'}>{f.affected}</GTag>}
              </button>

              {isOpen && f.items.length > 0 && (
                <div className="g-chips">
                  {f.items.map((it) => (
                    <button
                      type="button"
                      className="g-chip"
                      key={it.id}
                      onClick={() => { if (typeof onFixItem === 'function') onFixItem(it.id, f.key) }}
                      disabled={typeof onFixItem !== 'function'}
                    >
                      <Icon name="edit" size={12} />
                      {it.name || it.id}
                      {f.key === 'belowCost' && it.price !== undefined
                        ? <span style={{ opacity: .6 }}> ({ar ? 'سعر' : 'price'} {it.price} / {ar ? 'تكلفة' : 'cost'} {it.cost})</span>
                        : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <GBasis>
        {ar
          ? 'كل نتيجة تسرد أصنافها بالاسم، والضغط على أي صنف يفتحه في محرر الأصناف. لا توجد هنا نسبة مقارنة بمتوسط سوق — لا نملك بيانات عنه.'
          : 'Every finding lists its exact items. No market-average comparison appears here: we hold no such data.'}
      </GBasis>
    </div>
  )
}
