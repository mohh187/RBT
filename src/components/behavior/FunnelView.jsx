import Icon from '../Icon.jsx'
import { fmtNum } from '../../lib/format.js'
import { dur, pct, THIN_SESSIONS } from './engine.jsx'

const ROW_H = 66

// A rate with no sample size is a rumour. Every percentage on this page carries
// the exact denominator it was computed from, and is flagged when the sample is
// below the shared engine's reliability threshold.
export function Rate({ value, sample, ar = true }) {
  const thin = sample < THIN_SESSIONS
  return (
    <span className="bhv-rate">
      <strong className="bhv-num">{fmtNum(pct(value))}%</strong>
      <span className="bhv-of">{ar ? 'من' : 'of'} {fmtNum(sample)}</span>
      {thin && <span className="bhv-thin">{ar ? 'عينة قليلة' : 'small sample'}</span>}
    </span>
  )
}

export default function FunnelView({ steps = [], drops = null, over, ar = true, sessions = 0 }) {
  const total = over ? over.sessions : sessions
  const h = Math.max(1, steps.length) * ROW_H
  const widthOf = (c) => (total ? Math.max(6, (c / total) * 100) : 6)

  return (
    <div className="bhv-stack">
      <div className="bhv-kpis">
        <div className="bhv-kpi">
          <span className="bhv-kpi-l">{ar ? 'الجلسات' : 'Sessions'}</span>
          <strong className="bhv-kpi-v bhv-num">{fmtNum(total)}</strong>
          <span className="bhv-kpi-s">{ar ? 'في الفترة المختارة' : 'in period'}</span>
        </div>
        <div className="bhv-kpi">
          <span className="bhv-kpi-l">{ar ? 'معدل التحويل' : 'Conversion'}</span>
          <strong className="bhv-kpi-v bhv-num">{fmtNum(pct(over ? over.convRate : 0))}%</strong>
          <span className="bhv-kpi-s">{fmtNum(over ? over.ordered : 0)} {ar ? 'طلباً من' : 'orders of'} {fmtNum(total)}</span>
        </div>
        <div className="bhv-kpi">
          <span className="bhv-kpi-l">{ar ? 'متوسط الوقت النشط' : 'Avg active time'}</span>
          <strong className="bhv-kpi-v bhv-num">{dur(over ? over.avgActiveMs : 0, ar)}</strong>
          <span className="bhv-kpi-s">{ar ? 'الوسيط' : 'median'} {dur(over ? over.medianActiveMs : 0, ar)}</span>
        </div>
        <div className="bhv-kpi">
          <span className="bhv-kpi-l">{ar ? 'زوّار معرّفون' : 'Identified'}</span>
          <strong className="bhv-kpi-v bhv-num">{fmtNum(over ? over.withPhone : 0)}</strong>
          <span className="bhv-kpi-s">{fmtNum(over ? over.anonymous : 0)} {ar ? 'مجهولاً (بلا رقم)' : 'anonymous'}</span>
        </div>
      </div>

      <div className="bhv-card">
        <span className="bhv-card-t"><Icon name="trending" size={17} /> {ar ? 'مسار الشراء' : 'Purchase funnel'}</span>
        <p className="bhv-hint">
          {ar
            ? 'كل خطوة تُحسب مرة واحدة لكل جلسة. النسبة الأولى من كل الجلسات، والثانية من الخطوة السابقة مباشرة.'
            : 'Each step counted once per session: share of all sessions, then share of the previous step.'}
        </p>

        <div className="bhv-funnel">
          {/* height is pinned to the row stack so every band lines up with its
              row exactly; preserveAspectRatio="none" lets the width squash freely */}
          <svg className="bhv-funnel-svg" viewBox={`0 0 100 ${h}`} style={{ height: h }} preserveAspectRatio="none" aria-hidden="true">
            {steps.map((s, i) => {
              const wTop = widthOf(s.count)
              const wBot = widthOf(i + 1 < steps.length ? steps[i + 1].count : s.count)
              const y = i * ROW_H
              const x1 = (100 - wTop) / 2
              const x2 = (100 - wBot) / 2
              return (
                <polygon
                  key={s.key}
                  className={`bhv-fseg${i === steps.length - 1 ? ' is-last' : ''}`}
                  points={`${x1},${y} ${x1 + wTop},${y} ${x2 + wBot},${y + ROW_H - 6} ${x2},${y + ROW_H - 6}`}
                  style={{ opacity: 0.35 + (i / Math.max(1, steps.length)) * 0.55 }}
                />
              )
            })}
          </svg>

          <div className="bhv-funnel-rows">
            {steps.map((s, i) => (
              <div className="bhv-frow" key={s.key} style={{ height: ROW_H }}>
                <div className="bhv-frow-main">
                  <span className="bhv-frow-step">{ar ? s.ar : (s.en || s.ar)}</span>
                  <strong className="bhv-frow-n bhv-num">{fmtNum(s.count)}</strong>
                </div>
                <div className="bhv-frow-meta">
                  <Rate value={s.rate} sample={s.sample || total} ar={ar} />
                  {i > 0 && (
                    <span className="bhv-step-rate">
                      <Icon name="next" size={11} />
                      {fmtNum(pct(s.stepRate))}% {ar ? 'من الخطوة السابقة' : 'of previous'}
                      {s.lost > 0 && <em className="bhv-lost">{ar ? 'تسرّب' : 'lost'} {fmtNum(s.lost)}</em>}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {drops && drops.points.length > 0 && (
        <div className="bhv-card">
          <span className="bhv-card-t"><Icon name="warning" size={17} /> {ar ? 'أين تتوقّف الجلسات فعلياً' : 'Where sessions actually die'}</span>
          <p className="bhv-hint">
            {drops.fromFunnelSteps
              ? (ar ? 'محسوبة من خطوات المسار، لأن نقاط التوقّف التفصيلية غير متاحة.' : 'Derived from funnel steps.')
              : (ar
                ? `آخر شاشة أو صنف وصلت إليه الجلسة قبل أن تنتهي بلا طلب. الأساس هو ${fmtNum(drops.nonConverting)} جلسة غير محوَّلة.`
                : `The last screen or item before a non-converting session ended. Base: ${fmtNum(drops.nonConverting)} sessions.`)}
          </p>
          <div className="bhv-drops">
            {drops.points.slice(0, 12).map((d) => (
              <div className="bhv-drop" key={d.key}>
                <span className="bhv-drop-path">
                  <span className="bhv-mini">{d.kind === 'item' ? (ar ? 'صنف' : 'item') : (ar ? 'شاشة' : 'page')}</span> {d.label}
                </span>
                <span className="bhv-drop-n bhv-num">{fmtNum(d.lost)}</span>
                <Rate value={d.rate} sample={d.base} ar={ar} />
              </div>
            ))}
          </div>
          {drops.unknown > 0 && (
            <p className="bhv-hint">
              {ar
                ? `${fmtNum(drops.unknown)} جلسة غير محوَّلة لم تسجّل نقطة توقّف واضحة، فهي غير محسوبة أعلاه — لا تُقرأ النسب كأنها تغطي كل من غادر.`
                : `${fmtNum(drops.unknown)} non-converting sessions have no recorded drop-off point and are excluded above.`}
            </p>
          )}
        </div>
      )}

      <div className="bhv-two">
        <div className="bhv-card">
          <span className="bhv-card-t"><Icon name="phone" size={17} /> {ar ? 'الأجهزة' : 'Devices'}</span>
          <Bars ar={ar} total={total} rows={[
            { k: 'm', label: ar ? 'جوال' : 'Mobile', v: over ? over.devices.mobile : 0 },
            { k: 'd', label: ar ? 'شاشة كبيرة' : 'Desktop', v: over ? over.devices.desktop : 0 },
            { k: 'u', label: ar ? 'غير معروف' : 'Unknown', v: over ? over.devices.unknown : 0 },
          ]} />
          <p className="bhv-hint">
            {ar ? 'مثبّت كتطبيق على الشاشة الرئيسية: ' : 'Installed to home screen: '}
            <strong className="bhv-num">{fmtNum(over ? over.devices.installed : 0)}</strong>
          </p>
        </div>

        <div className="bhv-card">
          <span className="bhv-card-t"><Icon name="qr" size={17} /> {ar ? 'مصدر الدخول' : 'Entry source'}</span>
          <Bars ar={ar} total={total} rows={[
            { k: 't', label: ar ? 'باركود الطاولة' : 'Table QR', v: over ? over.entry.table : 0 },
            { k: 'x', label: ar ? 'دخول مباشر' : 'Direct', v: over ? over.entry.direct : 0 },
          ]} />
          {over && Object.keys(over.entry.tables).length > 0 && (
            <div className="bhv-tables">
              {Object.entries(over.entry.tables).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tbl, n]) => (
                <span className="bhv-tablechip" key={tbl}>{tbl} <b className="bhv-num">{fmtNum(n)}</b></span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Bars({ rows, total, ar }) {
  return (
    <div className="bhv-bars">
      {rows.map((r) => (
        <div className="bhv-bar" key={r.k}>
          <span className="bhv-bar-l">{r.label}</span>
          <span className="bhv-bar-track"><span className="bhv-bar-fill" style={{ width: `${total ? (r.v / total) * 100 : 0}%` }} /></span>
          <span className="bhv-bar-v bhv-num">{fmtNum(r.v)}</span>
          <span className="bhv-bar-p bhv-num">{fmtNum(pct(total ? r.v / total : 0))}%</span>
        </div>
      ))}
      {!total && <p className="bhv-hint">{ar ? 'لا جلسات في الفترة.' : 'No sessions in period.'}</p>}
    </div>
  )
}
