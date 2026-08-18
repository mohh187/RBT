// المالية (/platform/finance) — «أين ذهب كل ريال».
//
// Follows the venue accounting screen's shape on purpose (src/routes/admin/
// Accounting.jsx): one expensive computation, everything else memoised on top,
// so switching tabs is free.
//
// It also inherits that engine's honesty rule: anything derived says it is
// derived, and anything missing is reported as MISSING rather than quietly
// counted as zero. A finance screen that rounds an unknown down to zero is
// worse than one that admits it does not know.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../lib/firebase.js'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { watchAllTenants } from '../../lib/platform.js'
import { watchPlansConfig } from '../../lib/platformConfig.js'
import { normalizePlanConfig } from '../../lib/platformPricing.js'
import { watchPlatformDocs } from '../../lib/platformDocs.js'
import { recentPeriods } from '../../lib/spend.js'
import {
  buildPlatformLedger, platformPnl, platformVatReturn, aging, marginByVenue, mrrArr,
} from '../../lib/platformAccounting.js'
import { toCsv, downloadCsv } from '../../lib/accounting.js'

const n2 = (v) => (Number(v) || 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nInt = (v) => (Number(v) || 0).toLocaleString('en-US')

const TABS = [
  { id: 'dash', label: 'اللوحة', icon: 'chartBar' },
  { id: 'pnl', label: 'قائمة الدخل', icon: 'trending' },
  { id: 'margin', label: 'هامش كل منشأة', icon: 'store' },
  { id: 'aging', label: 'الأعمار والتحصيل', icon: 'clock' },
  { id: 'vat', label: 'الضريبة', icon: 'scale' },
]

export default function Finance() {
  const [tab, setTab] = useState('dash')
  const [basis, setBasis] = useState('accrual')
  const [months, setMonths] = useState(3)
  const [tenants, setTenants] = useState(null)
  const [docs, setDocs] = useState(null)
  const [cfg, setCfg] = useState(null)
  const [rollups, setRollups] = useState(null)

  useEffect(() => watchAllTenants(setTenants), [])
  useEffect(() => watchPlatformDocs(setDocs, { max: 500 }), [])
  useEffect(() => watchPlansConfig((c) => setCfg(normalizePlanConfig(c))), [])

  // Spend rollups for the selected window. Read by document id — one get per
  // month, which is cheaper and more predictable than a query, and a month
  // with no rollup stays `null` so the ledger can report it MISSING rather
  // than counting it as zero cost.
  useEffect(() => {
    let alive = true
    const periods = recentPeriods(months)
    Promise.all(periods.map(async (p) => {
      const s = await getDoc(doc(db, 'platformStats', `spend-${p}`)).catch(() => null)
      return [p, s && s.exists() ? s.data() : null]
    })).then((pairs) => { if (alive) setRollups(Object.fromEntries(pairs)) })
    return () => { alive = false }
  }, [months])

  const window = useMemo(() => {
    const periods = recentPeriods(months)
    const oldest = periods[periods.length - 1]
    const from = Date.parse(`${oldest}-01T00:00:00+03:00`)
    return { from, to: Date.now() }
  }, [months])

  // THE one expensive computation; everything below memoises off it.
  const ledger = useMemo(() => {
    if (!docs || !rollups) return null
    return buildPlatformLedger({ invoices: docs, spendRollups: rollups, from: window.from, to: window.to, basis })
  }, [docs, rollups, window, basis])

  const pnl = useMemo(() => (ledger ? platformPnl(ledger) : null), [ledger])
  const margins = useMemo(() => (ledger ? marginByVenue(ledger) : []), [ledger])
  const ageing = useMemo(() => aging(docs || []), [docs])
  const vat = useMemo(() => (ledger ? platformVatReturn(ledger) : null), [ledger])
  const mrr = useMemo(() => (tenants && cfg ? mrrArr(tenants, { prices: cfg.prices }) : null), [tenants, cfg])

  const loading = !ledger || !mrr

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div>
        <h2 className="page-title">المالية</h2>
        <p className="muted small">
          كل ريال دخل وخرج: الاشتراكات وحزم الرصيد مقابل تكلفة الرسائل والذكاء ورسوم البوابة.
          الأرقام المشتقة موسومة بذلك، وما لا نملك بياناته يُذكر مفقوداً لا صفراً.
        </p>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {TABS.map((t) => (
          <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        ))}
        <span className="grow" />
        <select className="input" style={{ width: 'auto' }} value={basis} onChange={(e) => setBasis(e.target.value)}>
          <option value="accrual">أساس الاستحقاق</option>
          <option value="cash">أساس نقدي</option>
        </select>
        <select className="input" style={{ width: 'auto' }} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
          <option value={1}>هذا الشهر</option>
          <option value={3}>3 أشهر</option>
          <option value={6}>6 أشهر</option>
          <option value={12}>سنة</option>
        </select>
      </div>

      {loading ? <div className="card card-pad"><Spinner /></div> : (
        <>
          {(ledger.missing || []).length > 0 && (
            <div className="spend-alert">
              <Icon name="warning" size={15} />
              <span>
                بيانات ناقصة في هذه الفترة: {nInt(ledger.missing.length)} بند.
                {ledger.missing.some((m) => m.kind === 'spendRollup') ? ' منها شهور بلا تجميع إنفاق. تكلفتها غير محتسبة، ولم تُعامَل صفراً.' : ''}
                {ledger.missing.some((m) => m.kind === 'legacyInvoice') ? ' ومنها فواتير قديمة قُسّمت على أساس أن مبلغها شامل الضريبة.' : ''}
              </span>
            </div>
          )}

          {tab === 'dash' && <Dash pnl={pnl} mrr={mrr} ageing={ageing} />}
          {tab === 'pnl' && <Pnl pnl={pnl} basis={basis} />}
          {tab === 'margin' && <Margins rows={margins} />}
          {tab === 'aging' && <Aging data={ageing} />}
          {tab === 'vat' && <Vat data={vat} />}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className="stack" style={{
      gap: 2, padding: 'var(--sp-4) var(--sp-5)', borderRadius: 'var(--r-md)', minWidth: 140,
      background: 'var(--surface-2)',
      border: `1px solid ${tone === 'bad' ? 'var(--danger)' : 'transparent'}`,
    }}>
      <span className="xs faint">{label}</span>
      <strong className="num" dir="ltr" style={{ fontSize: 'var(--fs-lg)' }}>{value}</strong>
      {sub ? <span className="xs faint">{sub}</span> : null}
    </div>
  )
}

function Dash({ pnl, mrr, ageing }) {
  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Stat label="الإيراد المتكرر شهرياً" value={n2(mrr.mrr)} sub={`${nInt(mrr.venues)} منشأة · متوسط ${n2(mrr.arpu)}`} />
        <Stat label="الإيراد السنوي المتوقع" value={n2(mrr.arr)} />
        <Stat label="صافي الربح" value={n2(pnl.netProfit)} sub={`هامش ${pnl.netMarginPct}%`} tone={pnl.netProfit < 0 ? 'bad' : ''} />
        <Stat label="تكلفة الخدمة" value={n2(pnl.totalCogs)} sub={`رسائل ${n2(pnl.cogs.cogsMessaging)} · ذكاء ${n2(pnl.cogs.cogsAi)}`} />
        <Stat label="مستحقات غير محصّلة" value={n2(ageing.total)} tone={ageing.buckets.older > 0 ? 'bad' : ''} />
      </div>
      <div className="card card-pad">
        <span className="xs faint">
          رسوم بوابة الدفع محسوبة من نسب العقد لا من تقرير المزوّد، وهي موسومة «مشتقة».
          وتكلفة القنوات مقدّرة من أسعار الوحدة ولم تُطابَق بفاتورة مزوّد بعد.
        </span>
      </div>
    </div>
  )
}

function Pnl({ pnl, basis }) {
  const rows = [
    ['إيرادات الاشتراكات', pnl.byRevenue.subRevenue],
    ['إيرادات حزم الرصيد', pnl.byRevenue.packRevenue],
    ['إيرادات التأسيس', pnl.byRevenue.setupRevenue],
    ['مردودات وإشعارات دائنة', pnl.byRevenue.refunds],
    ['إجمالي الإيراد', pnl.revenue, 'sum'],
    ['تكلفة الرسائل', -pnl.cogs.cogsMessaging],
    ['تكلفة الذكاء الاصطناعي', -pnl.cogs.cogsAi],
    ['مجمل الربح', pnl.grossProfit, 'sum'],
    ['رسوم بوابة الدفع (مشتقة)', -pnl.gatewayFees],
    ['صافي الربح', pnl.netProfit, 'total'],
  ]
  return (
    <div className="card card-pad stack" style={{ gap: 8 }}>
      <div className="row-between">
        <strong className="small">قائمة الدخل: {basis === 'cash' ? 'أساس نقدي' : 'أساس الاستحقاق'}</strong>
        <button className="btn btn-sm btn-outline" onClick={() => downloadCsv('platform-pnl.csv', toCsv(rows.map(([k, v]) => ({ البند: k, المبلغ: v }))))}>
          <Icon name="download" size={13} /> تصدير
        </button>
      </div>
      <table className="pc-table">
        <tbody>
          {rows.map(([label, val, kind]) => (
            <tr key={label} style={{ borderTop: kind ? '1px solid var(--border)' : 'none' }}>
              <td style={{ fontWeight: kind ? 700 : 400 }}>{label}</td>
              <td className="num" dir="ltr" style={{ textAlign: 'start', fontWeight: kind ? 700 : 400, color: val < 0 ? 'var(--danger)' : undefined }}>
                {n2(val)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Margins({ rows }) {
  if (!rows.length) return <Empty icon="store" title="لا بيانات هامش بعد" hint="تظهر بعد أول دورة تجميع إنفاق وأول فاتورة." />
  const losing = rows.filter((r) => r.margin < 0)
  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      <div className="row-between">
        <strong className="small">هامش كل منشأة: الأقل أولاً</strong>
        <button className="btn btn-sm btn-outline" onClick={() => downloadCsv('platform-margins.csv', toCsv(rows))}>
          <Icon name="download" size={13} /> تصدير
        </button>
      </div>
      {losing.length > 0 && (
        <div className="spend-alert">
          <Icon name="warning" size={15} />
          <span><span className="num">{nInt(losing.length)}</span> منشأة تكلّفك أكثر مما تدفع. راجع سقوفها أو باقتها.</span>
        </div>
      )}
      <div className="pc-table-wrap">
        <table className="pc-table">
          <thead>
            <tr>
              <th>المنشأة</th>
              <th style={{ textAlign: 'center' }}>الإيراد</th>
              <th style={{ textAlign: 'center' }}>التكلفة</th>
              <th style={{ textAlign: 'center' }}>الرسوم</th>
              <th style={{ textAlign: 'center' }}>الهامش</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tenantId} style={{ borderTop: '1px solid var(--border)' }}>
                <td><Link to={`/platform/venues/${r.tenantId}`}>{r.tenantName || r.tenantId}</Link></td>
                <td style={{ textAlign: 'center' }} className="num" dir="ltr">{n2(r.revenue)}</td>
                <td style={{ textAlign: 'center' }} className="num" dir="ltr">{n2(r.cost)}</td>
                <td style={{ textAlign: 'center' }} className="num" dir="ltr">{n2(r.fees)}</td>
                <td style={{ textAlign: 'center', color: r.margin < 0 ? 'var(--danger)' : 'var(--ok, inherit)' }}>
                  <strong className="num" dir="ltr">{n2(r.margin)}</strong>
                  <div className="xs faint num" dir="ltr">{r.marginPct}%</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Aging({ data }) {
  const B = [['غير مستحق', 'current'], ['1-30 يوماً', 'd30'], ['31-60', 'd60'], ['61-90', 'd90'], ['أكثر من 90', 'older']]
  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        {B.map(([label, k]) => (
          <Stat key={k} label={label} value={n2(data.buckets[k])} tone={k === 'older' && data.buckets[k] > 0 ? 'bad' : ''} />
        ))}
      </div>
      {data.rows.length === 0
        ? <Empty icon="ok" title="لا مستحقات متأخرة" />
        : (
          <div className="card card-pad stack" style={{ gap: 6 }}>
            {data.rows.slice(0, 40).map((r) => (
              <div key={r.id} className="row-between small" style={{ padding: '5px 0', borderTop: '1px solid var(--border)' }}>
                <Link to={`/platform/venues/${r.tenantId}`}>{r.tenantName || r.tenantId}</Link>
                <span className="xs faint num" dir="ltr">{r.no}</span>
                <span className="num" dir="ltr">{n2(r.amount)}</span>
                <span className={`xs ${r.days > 60 ? '' : 'faint'}`} style={r.days > 60 ? { color: 'var(--danger)' } : undefined}>
                  {r.days > 0 ? `متأخرة ${nInt(r.days)} يوماً` : 'غير مستحقة بعد'}
                </span>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

function Vat({ data }) {
  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      <strong className="small">الإقرار الضريبي للفترة المختارة</strong>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Stat label="المبيعات الخاضعة" value={n2(data.sales)} />
        <Stat label="ضريبة المخرجات" value={n2(data.outputVat)} />
        <Stat label="ضريبة المدخلات" value={n2(data.inputVat)} sub="من رسوم البوابة" />
        <Stat label="المستحق للهيئة" value={n2(data.netDue)} tone={data.netDue > 0 ? '' : 'bad'} />
      </div>
      <span className="xs faint">
        ضريبة المدخلات هنا من رسوم بوابة الدفع فقط. بقية المزوّدين يفوترون من خارج المملكة فلا مدخلات قابلة للخصم منهم.
        الإقرار ربع سنوي، ويستحق آخر الشهر التالي لنهاية الربع.
      </span>
    </div>
  )
}

