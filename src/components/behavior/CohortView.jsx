import Icon from '../Icon.jsx'
import { Price } from '../Riyal.jsx'
import { fmtNum } from '../../lib/format.js'
import { dur, pct, COHORT_MIN } from './engine.jsx'

// A cohort comparison is only shown as a comparison when BOTH sides clear the
// sample threshold. Below it the card refuses to draw a conclusion instead of
// printing a percentage nobody should act on.
export default function CohortView({ cohortList = [], ar = true, currency = 'SAR', lang = 'ar', showMoney = true, sessions = 0 }) {
  if (!sessions) {
    return (
      <div className="bhv-card">
        <span className="bhv-card-t"><Icon name="layers" size={17} /> {ar ? 'الشرائح' : 'Cohorts'}</span>
        <p className="bhv-hint">
          {ar
            ? 'لا جلسات بعد. ستقارن هذه الشاشة معدل التحويل ومتوسط قيمة الطلب بين: من لعب لعبة ومن لم يلعب، من استخدم العرض ثلاثي الأبعاد ومن لم يستخدمه، من دخل بباركود الطاولة ومن دخل مباشرة، والعائد مقابل الزائر لأول مرة.'
            : 'No sessions yet.'}
        </p>
      </div>
    )
  }

  return (
    <div className="bhv-stack">
      <div className="bhv-card">
        <span className="bhv-card-t"><Icon name="warning" size={17} /> {ar ? 'اقرأ هذا أولاً' : 'Read this first'}</span>
        <p className="bhv-hint">
          {ar
            ? `الفروق هنا ارتباط وليست سببية: من يلعب لعبة قد يكون أصلاً أكثر حماساً للطلب. لا تُعرض المقارنة إلا إذا بلغت كل مجموعة ${fmtNum(COHORT_MIN)} جلسة على الأقل، وإلا فالمكتوب هو «العينة غير كافية».`
            : `Differences are correlation, not causation. Comparisons need at least ${fmtNum(COHORT_MIN)} sessions per group.`}
        </p>
      </div>

      <div className="bhv-two">
        {cohortList.map((c) => {
          const [a, b] = c.groups || []
          const comparable = a && b && a.enough && b.enough
          const diff = comparable ? a.convRate - b.convRate : 0
          return (
            <div className="bhv-card" key={c.key}>
              <div className="bhv-row-between">
                <span className="bhv-card-t"><Icon name={c.icon || 'layers'} size={17} /> {c.ar}</span>
                {comparable ? (
                  <span className={`bhv-verdict is-${Math.abs(diff) < 0.05 ? 'neutral' : (diff > 0 ? 'good' : 'warn')}`}>
                    {Math.abs(diff) < 0.05
                      ? (ar ? 'لا فرق يُذكر' : 'no real difference')
                      : `${ar ? 'فرق' : 'gap'} ${fmtNum(pct(Math.abs(diff)))} ${ar ? 'نقطة' : 'pts'}`}
                  </span>
                ) : (
                  <span className="bhv-verdict is-warn">{ar ? 'العينة غير كافية' : 'sample too small'}</span>
                )}
              </div>

              {(c.groups || []).map((g) => (
                <div className={`bhv-cgroup${g.enough ? '' : ' is-thin'}`} key={g.key}>
                  <div className="bhv-cgroup-head">
                    <span className="bhv-cgroup-n">{g.ar}</span>
                    <span className="bhv-mini bhv-num">{fmtNum(g.n)} {ar ? 'جلسة' : 'sessions'}</span>
                  </div>
                  {g.enough ? (
                    <>
                      <div className="bhv-bar">
                        <span className="bhv-bar-l">{ar ? 'التحويل' : 'Conversion'}</span>
                        <span className="bhv-bar-track"><span className="bhv-bar-fill" style={{ width: `${Math.min(100, pct(g.convRate))}%` }} /></span>
                        <span className="bhv-bar-v bhv-num">{fmtNum(pct(g.convRate))}%</span>
                        <span className="bhv-bar-p bhv-num">{fmtNum(g.ordered)}/{fmtNum(g.n)}</span>
                      </div>
                      <div className="bhv-facts">
                        <span>{ar ? 'متوسط قيمة الطلب' : 'Avg order'} <b>{showMoney ? <Price value={g.avgOrder} currency={currency} lang={lang} /> : '—'}</b></span>
                        <span>{ar ? 'متوسط الوقت النشط' : 'Avg active'} <b className="bhv-num">{dur(g.avgActiveMs, ar)}</b></span>
                      </div>
                    </>
                  ) : (
                    <p className="bhv-hint">
                      {ar
                        ? `العينة غير كافية — ${fmtNum(g.n)} جلسة فقط مقابل حد أدنى ${fmtNum(COHORT_MIN)}. لن نعرض نسبة تحويل قد تكون مضلّلة.`
                        : `Sample too small (${fmtNum(g.n)} of ${fmtNum(COHORT_MIN)}).`}
                    </p>
                  )}
                </div>
              ))}

              {c.note && <p className="bhv-hint"><Icon name="warning" size={12} /> {c.note}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
