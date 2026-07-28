// Spend & limits (/platform/spend) — platform-admin only.
//
// The one screen that answers «what is this platform costing me, and who is
// spending it» — and the one place that can stop the spending without a
// deploy. Everything shown here is produced by the server-side meters in
// functions/spend.js; nothing on this page is advisory.
//
// Three things live here on purpose:
//   1. the emergency stop (global + per channel), because the moment you need
//      it you should not be hunting for it in a settings tab;
//   2. the monthly budget and what it does when crossed — the circuit breaker
//      that runs every two hours whether anyone is watching or not;
//   3. the per-venue table, sorted by cost, with the REFUSALS beside the sends
//      so a venue pressing against its ceiling is visible before it complains.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import {
  CHANNELS, CHANNEL_KEYS, USD_TO_SAR,
  watchSpendControls, saveSpendControls, watchSpendRollup, recentPeriods, periodKey,
} from '../../lib/spend.js'
import { PlanBadge, fmtWhen } from './shared.jsx'

// Latin digits, always — an Arabic-Indic numeral is a hard project rule against.
const n = (v) => (Number(v) || 0).toLocaleString('en-US')

const BUDGET_ACTIONS = [
  { id: 'warn', ar: 'تنبيه فقط', hint: 'يُسجَّل تنبيه ويصل إشعار — لا يتوقف شيء.' },
  { id: 'stopMarketing', ar: 'إيقاف التسويق', hint: 'تتوقف الحملات والعروض. رسائل الطلبات والفواتير تستمر.' },
  { id: 'stopAll', ar: 'إيقاف كل الإرسال', hint: 'يتوقف كل شيء يكلّف مالاً، بما فيه إشعارات الطلبات.' },
]

const REASON_AR = {
  cap: 'السقف الشهري', daily: 'السقف اليومي', burst: 'الحد اللحظي', killed: 'موقوف من المنصة',
}

export default function Spend() {
  const [period, setPeriod] = useState(periodKey())
  const [controls, setControls] = useState(null)
  const [roll, setRoll] = useState(null)

  useEffect(() => watchSpendControls(setControls), [])
  useEffect(() => {
    setRoll(null)
    return watchSpendRollup(setRoll, period)
  }, [period])

  const periods = useMemo(() => recentPeriods(6), [])

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div>
        <h2 className="page-title">الإنفاق والحدود</h2>
        <p className="muted small">
          كل ما يكلّف المنصة مالاً — رسائل واتساب والبريد وطلبات الذكاء الاصطناعي — يمر عبر عدّاد على الخادم
          قبل أن يُرسل. هنا ترى الاستهلاك الفعلي لكل منشأة، وهنا يمكنك إيقافه.
        </p>
      </div>

      <KillSwitch controls={controls} />
      <Budget controls={controls} roll={roll} />

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="xs faint">الشهر</span>
        {periods.map((p) => (
          <button key={p} className={`btn btn-sm ${period === p ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPeriod(p)}>
            <span className="num">{p}</span>
          </button>
        ))}
      </div>

      <Totals roll={roll} controls={controls} />
      <VenueTable roll={roll} />
    </div>
  )
}

/* ============ emergency stop ============ */
function KillSwitch({ controls }) {
  const toast = useToast()
  const [busy, setBusy] = useState('')
  if (!controls) return <div className="card"><Spinner /></div>

  const flip = async (patch, label) => {
    setBusy(label)
    try {
      await saveSpendControls(patch)
      toast.success('تم الحفظ — يسري خلال دقيقة')
    } catch (e) {
      toast.error(e?.message || 'تعذّر الحفظ')
    } finally { setBusy('') }
  }

  const anyOff = controls.killAll || CHANNEL_KEYS.some((k) => controls.channels[k] === true)

  return (
    <div className="card stack" style={{ gap: 12, borderColor: anyOff ? 'var(--danger)' : undefined }}>
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div className="bold row" style={{ gap: 6, alignItems: 'center' }}>
            <Icon name="warning" size={16} /> إيقاف الإنفاق
          </div>
          <div className="xs faint">
            الإيقاف يسري خلال دقيقة على كل الخوادم. الرسائل المرفوضة تُحتسب وتظهر في الجدول أدناه.
          </div>
        </div>
        <button
          className={`btn ${controls.killAll ? 'btn-danger' : 'btn-outline'}`}
          disabled={busy === 'all'}
          onClick={() => flip({ killAll: !controls.killAll }, 'all')}
        >
          <Icon name={controls.killAll ? 'play' : 'close'} size={15} />
          {controls.killAll ? 'استئناف كل الإرسال' : 'إيقاف كل الإرسال فوراً'}
        </button>
      </div>

      {controls.killAll && (
        <div className="spend-alert">
          كل الإرسال موقوف الآن على مستوى المنصة — بما في ذلك إشعارات حالة الطلب للعملاء.
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {CHANNELS.map((c) => {
          const off = controls.channels[c.key] === true
          return (
            <button
              key={c.key}
              className={`btn btn-sm ${off ? 'btn-danger' : 'btn-outline'}`}
              disabled={busy === c.key || controls.killAll}
              onClick={() => flip({ [`channels.${c.key}`]: !off }, c.key)}
              title={c.hint}
            >
              <Icon name={off ? 'close' : c.icon} size={14} /> {c.short}
              {off ? ' — موقوف' : ''}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ============ monthly budget + circuit breaker ============ */
function Budget({ controls, roll }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [action, setAction] = useState('warn')
  const [busy, setBusy] = useState(false)

  // Re-sync from the doc whenever it changes elsewhere, so the inputs never
  // show a stale budget after another admin edits it.
  useEffect(() => {
    if (!controls) return
    setAmount(controls.monthlyBudgetUsd ? String(controls.monthlyBudgetUsd) : '')
    setAction(controls.budgetAction || 'warn')
  }, [controls?.monthlyBudgetUsd, controls?.budgetAction])

  if (!controls) return null
  const dirty = String(controls.monthlyBudgetUsd || '') !== String(Number(amount) || '') || (controls.budgetAction || 'warn') !== action

  const save = async () => {
    setBusy(true)
    try {
      await saveSpendControls({ monthlyBudgetUsd: Math.max(0, Number(amount) || 0), budgetAction: action })
      toast.success('تم حفظ الميزانية')
    } catch (e) {
      toast.error(e?.message || 'تعذّر الحفظ')
    } finally { setBusy(false) }
  }

  const spent = roll?.totalUsd || 0
  const budget = controls.monthlyBudgetUsd
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0
  const fired = controls.budgetFired && controls.budgetFired.period === (roll?.period || periodKey())

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="bold row" style={{ gap: 6, alignItems: 'center' }}>
        <Icon name="wallet" size={16} /> ميزانية الشهر
      </div>
      <div className="xs faint">
        تُفحص كل ساعتين. عند بلوغ ثمانين بالمئة يصلك تنبيه، وعند التجاوز يُنفَّذ الإجراء المختار تلقائياً — مرة واحدة في الشهر.
      </div>

      {budget > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="row-between small">
            <span>المصروف</span>
            <strong className="num" dir="ltr">{spent.toFixed(2)} / {budget} USD</strong>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--gold)' : 'var(--brand)' }} />
          </div>
          <div className="xs faint num" dir="ltr">{(spent * USD_TO_SAR).toFixed(2)} SAR</div>
        </div>
      )}

      {fired && controls.budgetFired.trip && (
        <div className="spend-alert">
          تجاوزت الميزانية هذا الشهر ونُفِّذ الإجراء. لن يتكرر التنفيذ حتى الشهر القادم — ارفع الميزانية أو أعد التشغيل يدوياً من الأعلى.
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="stack" style={{ gap: 4, minWidth: 150 }}>
          <span className="xs faint">الميزانية الشهرية (USD) — صفر يعني بلا ميزانية</span>
          <input type="number" min="0" step="1" className="input num" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 4, minWidth: 190 }}>
          <span className="xs faint">عند التجاوز</span>
          <select className="input" value={action} onChange={(e) => setAction(e.target.value)}>
            {BUDGET_ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.ar}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" disabled={!dirty || busy} onClick={save}>
          {busy ? <Spinner /> : <><Icon name="check" size={15} /> حفظ</>}
        </button>
      </div>
      <div className="xs faint">{BUDGET_ACTIONS.find((a) => a.id === action)?.hint}</div>
    </div>
  )
}

/* ============ per-channel totals ============ */
function Totals({ roll, controls }) {
  if (!roll) return <div className="card"><Spinner /></div>
  if (!roll.exists) {
    return (
      <Empty
        icon="chartBar"
        title="لا توجد بيانات لهذا الشهر بعد"
        hint="يُبنى التجميع كل ساعتين من عدّادات المنشآت. إن كان الشهر جديداً فانتظر أول تشغيل."
      />
    )
  }
  const rates = controls?.unitCostUsd || roll.rates
  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="row-between" style={{ alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div className="bold row" style={{ gap: 6, alignItems: 'center' }}>
          <Icon name="chartBar" size={16} /> إجمالي الشهر
        </div>
        <div className="xs faint">
          {n(roll.spendingTenants)} منشأة منفقة من {n(roll.tenants)} · آخر تحديث {fmtWhen(roll.at)}
        </div>
      </div>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Stat label="التكلفة" value={`${roll.totalUsd.toFixed(2)} USD`} sub={`${roll.totalSar.toFixed(2)} SAR`} strong />
        {CHANNELS.map((c) => {
          const used = roll.totals[c.key]
          const blocked = roll.blockedTotals[c.key]
          const cost = used * (Number(rates[c.key]) || 0)
          return (
            <Stat
              key={c.key}
              label={c.short}
              value={n(used)}
              sub={`${cost.toFixed(2)} USD${blocked ? ` · رُفض ${n(blocked)}` : ''}`}
              danger={blocked > 0}
            />
          )
        })}
      </div>
    </div>
  )
}

function Stat({ label, value, sub, strong, danger }) {
  return (
    <div
      className="stack"
      style={{
        gap: 2, padding: 'var(--sp-4) var(--sp-5)', borderRadius: 'var(--r-md)', minWidth: 116,
        background: 'var(--surface-2)',
        border: `1px solid ${danger ? 'var(--danger)' : 'transparent'}`,
      }}
    >
      <span className="xs faint">{label}</span>
      <strong className="num" dir="ltr" style={{ fontSize: strong ? 'var(--fs-lg)' : 'var(--fs-md)' }}>{value}</strong>
      {sub ? <span className="xs faint num" dir="ltr">{sub}</span> : null}
    </div>
  )
}

/* ============ per-venue table ============ */
function VenueTable({ roll }) {
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  if (!roll || !roll.exists) return null

  const rows = onlyBlocked
    ? roll.rows.filter((r) => CHANNEL_KEYS.some((k) => Number(r[`blocked_${k}`]) > 0))
    : roll.rows

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="bold">المنشآت — مرتّبة حسب التكلفة</div>
        <button className={`btn btn-sm ${onlyBlocked ? 'btn-primary' : 'btn-outline'}`} onClick={() => setOnlyBlocked((v) => !v)}>
          <Icon name="warning" size={14} /> التي بلغت حدودها فقط
        </button>
      </div>

      {!rows.length ? (
        <Empty icon="store" title={onlyBlocked ? 'لا توجد منشأة بلغت حدودها' : 'لا إنفاق هذا الشهر'} />
      ) : (
        <div className="pc-table-wrap">
          <table className="pc-table">
            <thead>
              <tr style={{ textAlign: 'start' }}>
                <th>المنشأة</th>
                <th>الباقة</th>
                {CHANNELS.map((c) => <th key={c.key} style={{ textAlign: 'center' }}>{c.short}</th>)}
                <th style={{ textAlign: 'center' }}>التكلفة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td>
                    <Link to={`/platform/venues/${r.id}`} className="bold" style={{ textDecoration: 'none' }}>
                      {r.name || r.id}
                    </Link>
                  </td>
                  <td><PlanBadge plan={r.plan} /></td>
                  {CHANNELS.map((c) => {
                    const blocked = Number(r[`blocked_${c.key}`]) || 0
                    return (
                      <td key={c.key} style={{ textAlign: 'center' }}>
                        <span className="num">{n(r[c.key])}</span>
                        {blocked > 0 && (
                          <div className="xs num" style={{ color: 'var(--danger)' }} title={`رُفضت ${blocked}`}>
                            −{n(blocked)}
                          </div>
                        )}
                      </td>
                    )
                  })}
                  <td style={{ textAlign: 'center' }}>
                    <strong className="num" dir="ltr">{(Number(r.usd) || 0).toFixed(2)}</strong>
                    <div className="xs faint num" dir="ltr">{(Number(r.sar) || 0).toFixed(2)} SAR</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="xs faint">
        الرقم الأحمر تحت العدد هو ما رُفض إرساله بعد بلوغ الحد ({Object.values(REASON_AR).join(' / ')}).
      </div>
    </div>
  )
}

