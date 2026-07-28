// الصحة (/platform/health) — «هل هناك خلل الآن، وما العمل؟»
//
// DELIBERATELY SMALL. Most health dashboards are theatre. What actually
// prevents a disaster, in order, is (1) the alert that reaches a phone at
// 3am, (2) the automatic action that fires with no human — spend.js already
// has that, (3) the projection that turns «40%» into «you overshoot on the
// 22nd», and only then (4) a screen. So this screen does one job: answer the
// question above, above the fold.
//
// WHEN IT IS GREEN, THE REST OF THE PAGE SHOULD BE BORING. That is the point.
// No latency charts, no invocation graphs, no uptime percentages, no mirror of
// the vendors' own status pages — nobody reads them and Google's console
// already has them.
import { useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { useAuth } from '../../lib/auth.jsx'
import { watchHealth, watchJobs, watchAlerts, ackAlert, overallOf, isStale, SEVERITY_AR, SEVERITY_BADGE, SEVERITY_ORDER } from '../../lib/health.js'
import { fmtWhen } from './shared.jsx'

const n2 = (v) => (Number(v) || 0).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 2 })
const nInt = (v) => (Number(v) || 0).toLocaleString('en-US')

const LEVEL_STYLE = {
  ok: { bg: 'color-mix(in srgb, var(--ok, #1c7a44) 12%, transparent)', fg: 'var(--ok, #1c7a44)', icon: 'ok' },
  degraded: { bg: 'color-mix(in srgb, var(--gold) 14%, transparent)', fg: 'var(--gold)', icon: 'warning' },
  down: { bg: 'color-mix(in srgb, var(--danger) 12%, transparent)', fg: 'var(--danger)', icon: 'warning' },
}

export default function Health() {
  const { user } = useAuth()
  const toast = useToast()
  const [health, setHealth] = useState(undefined)
  const [jobs, setJobs] = useState(undefined)
  const [alerts, setAlerts] = useState(undefined)

  useEffect(() => watchHealth(setHealth), [])
  useEffect(() => watchJobs(setJobs), [])
  useEffect(() => watchAlerts(setAlerts), [])

  const overall = useMemo(() => overallOf(health, alerts || []), [health, alerts])
  const sorted = useMemo(() => (
    [...(alerts || [])].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
  ), [alerts])

  if (health === undefined || alerts === undefined) {
    return <div className="page"><div className="card card-pad"><Spinner /></div></div>
  }

  const st = LEVEL_STYLE[overall.level]
  const ack = async (a) => {
    try { await ackAlert(a.id, user?.email || ''); toast.success('تم الإقرار — يبقى التنبيه مفتوحاً حتى يُحل') }
    catch { toast.error('تعذّر الإقرار') }
  }

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      <div>
        <h2 className="page-title">الصحة</h2>
        <p className="muted small">
          ما لا يستطيع عدّاد الإنفاق رؤيته: حدود المزوّدين، وصلاحية المفاتيح، وهل ما زالت الوظائف المجدولة تُنهي دورتها.
        </p>
      </div>

      {/* one status line — the whole point of the page */}
      <div className="card card-pad row" style={{ gap: 12, alignItems: 'center', background: st.bg, borderColor: st.fg }}>
        <Icon name={st.icon} size={22} style={{ color: st.fg }} />
        <div className="grow">
          <strong style={{ color: st.fg }}>{overall.ar}</strong>
          <div className="xs faint">
            {overall.crit ? `${nInt(overall.crit)} حرج · ` : ''}
            {overall.high ? `${nInt(overall.high)} مهم · ` : ''}
            {overall.staleProbes.length ? `فحوصات متوقفة: ${overall.staleProbes.join('، ')}` : 'كل الفحوصات تعمل'}
          </div>
        </div>
        {health?.at ? <span className="xs faint">آخر فحص {fmtWhen(health.at)}</span> : null}
      </div>

      {/* open alerts — 80% of the screen's value */}
      <section className="stack" style={{ gap: 'var(--sp-2)' }}>
        <strong className="small">التنبيهات المفتوحة</strong>
        {sorted.length === 0
          ? <Empty icon="ok" title="لا تنبيهات" hint="كل المسابير تعمل ولم يبلغ أي مزوّد حدّه." />
          : sorted.map((a) => (
            <div key={a.id} className="card card-pad stack" style={{ gap: 6, borderColor: a.severity === 'critical' ? 'var(--danger)' : undefined }}>
              <div className="row-between wrap" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className={`badge ${SEVERITY_BADGE[a.severity] || ''}`}>{SEVERITY_AR[a.severity] || a.severity}</span>
                  <strong className="small">{a.title}</strong>
                  {a.count > 1 ? <span className="xs faint num" dir="ltr">×{a.count}</span> : null}
                  {a.status === 'acked' ? <span className="badge">مُقَرّ به</span> : null}
                </div>
                <span className="xs faint">{fmtWhen(a.lastAt)}</span>
              </div>
              {a.body ? <span className="small">{a.body}</span> : null}
              {/* The action sentence is non-optional in alerts.js — an alert
                  that does not say what to DO is a notification, and
                  notifications get muted. */}
              {a.action ? (
                <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                  <Icon name="arrowUp" size={13} className="faint" style={{ marginTop: 3, transform: 'rotate(90deg)' }} />
                  <span className="small bold">{a.action}</span>
                </div>
              ) : null}
              {a.status === 'open' && (
                <button className="btn btn-sm btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => ack(a)}>
                  <Icon name="check" size={13} /> إقرار
                </button>
              )}
            </div>
          ))}
      </section>

      {/* vendor tiles — each shows WHEN it was checked, with a visible STALE
          badge, because a probe that stopped running looks exactly like health */}
      <section className="stack" style={{ gap: 'var(--sp-2)' }}>
        <strong className="small">المزوّدون</strong>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <VendorTile
            name="واتساب (Meta)" probe={health?.probes?.meta} data={health?.vendors?.meta}
            lines={health?.vendors?.meta?.templates
              ? [`قوالب معتمدة ${nInt(health.vendors.meta.templates.approved)}`,
                health.vendors.meta.templates.rejected ? `مرفوضة ${nInt(health.vendors.meta.templates.rejected)}` : '',
                (health.vendors.meta.numbers || []).map((x) => `${x.phone}: ${x.quality}`).join(' · ')].filter(Boolean)
              : []}
          />
          <VendorTile
            name="Gemini" probe={health?.probes?.gemini} data={health?.vendors?.gemini}
            lines={health?.gemini ? [
              `${n2(health.gemini.mtdUsd)} من ${n2(health.gemini.capUsd)} دولار (${health.gemini.pct}%)`,
              health.gemini.crossesOnDay ? `الاتجاه يتجاوز السقف يوم ${health.gemini.crossesOnDay}` : `الإسقاط ${n2(health.gemini.projectedUsd)} دولار`,
            ] : []}
          />
          <VendorTile
            name="Meshy" probe={health?.probes?.meshy} data={health?.vendors?.meshy}
            lines={health?.vendors?.meshy?.credits != null ? [`الرصيد ${nInt(health.vendors.meshy.credits)}`] : []}
          />
          <VendorTile
            name="Resend" probe={health?.probes?.resend} data={health?.vendors?.resend}
            lines={(health?.vendors?.resend?.domains || []).map((d) => `${d.name}: ${d.status}`)}
          />
        </div>
      </section>

      {/* scheduled jobs — the silent failure nobody would ever diagnose */}
      {jobs && Object.keys(jobs).length > 0 && (
        <section className="stack" style={{ gap: 'var(--sp-2)' }}>
          <strong className="small">الوظائف المجدولة</strong>
          <div className="card card-pad stack" style={{ gap: 6 }}>
            {Object.entries(jobs).map(([name, j]) => (
              <div key={name} className="row-between small" style={{ padding: '5px 0', borderTop: '1px solid var(--border)' }}>
                <span className="num" dir="ltr">{name}</span>
                <span className="xs faint">قرأت <span className="num">{nInt(j.docsRead)}</span> مستنداً</span>
                <span className={`xs ${j.timeoutPct >= 80 ? '' : 'faint'}`} style={j.timeoutPct >= 80 ? { color: 'var(--danger)' } : undefined}>
                  <span className="num" dir="ltr">{Math.round((j.ms || 0) / 1000)}</span> ثانية · <span className="num" dir="ltr">{j.timeoutPct}%</span> من المهلة
                </span>
                <span className="xs faint">{fmtWhen(j.lastOkAt || j.lastRunAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="card card-pad">
        <span className="xs faint">
          تكلفة القنوات هنا وفي المالية <strong>تقديرية</strong> — محسوبة من أسعار الوحدة ولم تُطابَق بفاتورة مزوّد،
          لأن مفاتيح المزوّدين مشتركة مع أنظمة أخرى. تُصبح المطابقة ممكنة بفصل المفاتيح لكل نظام.
        </span>
      </div>
    </div>
  )
}

function VendorTile({ name, probe, data, lines }) {
  const stale = isStale(probe?.lastRunAt)
  const status = data?.status
  const bad = status === 'error' || status === 'unconfigured'
  return (
    <div className="stack" style={{
      gap: 4, padding: '12px 16px', borderRadius: 12, minWidth: 200, flex: '1 1 220px',
      background: 'var(--surface-2)',
      border: `1px solid ${bad || stale ? 'var(--danger)' : 'transparent'}`,
    }}>
      <div className="row-between" style={{ gap: 8 }}>
        <strong className="small">{name}</strong>
        {/* SILENCE MUST NOT LOOK GREEN. */}
        {stale
          ? <span className="badge badge-danger">فحص متوقف</span>
          : status === 'unconfigured'
            ? <span className="badge badge-warning">غير مضبوط</span>
            : status === 'error'
              ? <span className="badge badge-danger">خطأ</span>
              : <span className="badge badge-success">يعمل</span>}
      </div>
      {(lines || []).filter(Boolean).map((l, i) => <span key={i} className="xs faint">{l}</span>)}
      {data?.note ? <span className="xs" style={{ color: 'var(--danger)' }}>{data.note}</span> : null}
      {data?.error ? <span className="xs" style={{ color: 'var(--danger)' }}>{String(data.error).slice(0, 120)}</span> : null}
      <span className="xs faint">{probe?.lastRunAt ? `آخر فحص ${fmtWhen(probe.lastRunAt)}` : 'لم يُفحص بعد'}</span>
    </div>
  )
}
