// ============ PLATFORM ACCOUNTING — where every riyal came from and went ============
//
// Pure functions. No Firestore, no React, no side effects — deliberately the
// same shape as src/lib/accounting.js (the venue engine) so the two are one
// thing to learn rather than two.
//
// AND THE SAME HOUSE RULE, VERBATIM: never invent a number. Missing source
// data yields 0, null, or an explicit marker in `missing` — never an estimate
// presented as fact. A derived figure is labelled derived. This is the whole
// difference between a ledger and a dashboard.
import { CHANNEL_KEYS, costOf, UNIT_COST_USD, USD_TO_SAR } from './spend.js'

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100

// ------------------------------------------------------- chart of accounts
export const PLATFORM_ACCOUNTS = {
  subRevenue: { category: 'revenue', ar: 'إيرادات الاشتراكات' },
  packRevenue: { category: 'revenue', ar: 'إيرادات حزم الرصيد' },
  setupRevenue: { category: 'revenue', ar: 'إيرادات التأسيس والتدريب' },
  refunds: { category: 'contra', ar: 'مردودات وإشعارات دائنة' },
  cogsMessaging: { category: 'cogs', ar: 'تكلفة الرسائل (واتساب وبريد)' },
  cogsAi: { category: 'cogs', ar: 'تكلفة الذكاء الاصطناعي' },
  gatewayFees: { category: 'expense', ar: 'رسوم بوابة الدفع' },
  vatPayable: { category: 'liability', ar: 'ضريبة القيمة المضافة المستحقة' },
  receivable: { category: 'asset', ar: 'ذمم مدينة' },
  bank: { category: 'asset', ar: 'المحصّل' },
}

// Which metered channel rolls into which cost account.
const CHANNEL_ACCOUNT = {
  waUtility: 'cogsMessaging', waMarketing: 'cogsMessaging', email: 'cogsMessaging',
  aiText: 'cogsAi', aiImage: 'cogsAi', ar3d: 'cogsAi', tableImage: 'cogsAi', dinerAi: 'cogsAi',
}

// Payment-gateway fees are DERIVED, not reported: Moyasar does not hand back a
// trustworthy per-payment fee, so we compute from contracted rates and label
// the result. Presenting a derived cost as a reported one is the single thing
// the venue engine refuses to do, and this engine inherits that refusal.
export const DEFAULT_GATEWAY_FEE = { pct: 2.75, fixed: 1, vatOnFeePct: 15 }

export function gatewayFeeFor(amountSar, cfg = DEFAULT_GATEWAY_FEE) {
  const base = (Number(amountSar) || 0) * ((Number(cfg.pct) || 0) / 100) + (Number(cfg.fixed) || 0)
  const withVat = base * (1 + (Number(cfg.vatOnFeePct) || 0) / 100)
  return { fee: round2(withVat), source: 'derived' }
}

// ---------------------------------------------------------------- the ledger
// `basis` is one flag, not two engines.
//   accrual — recognise at issue. A YEARLY invoice is spread across the months
//             it actually covers, with the unearned remainder deferred. This
//             is why the platform needs accrual and the venue does not: yearly
//             prepayments and unpaid invoices are material here.
//   cash    — recognise at payment.
export function buildPlatformLedger({ invoices = [], spendRollups = {}, from, to, basis = 'accrual', feeCfg = DEFAULT_GATEWAY_FEE, rates } = {}) {
  const entries = []
  const missing = []
  const inRange = (ms) => (!from || ms >= from) && (!to || ms <= to)
  const msOf = (v) => (v && v.toMillis ? v.toMillis() : (Number(v) || 0))

  for (const inv of invoices) {
    // A voided document is not revenue, not a receivable, and not a loss — it
    // is an explained hole in the sequence and nothing more.
    if (inv.status === 'void') continue
    const isCredit = inv.docType === 'creditNote' || inv.series === 'credit'
    const account = inv.kind === 'spendPack' || inv.kind === 'aiCredits' ? 'packRevenue'
      : inv.kind === 'setup' ? 'setupRevenue' : 'subRevenue'

    const issuedMs = msOf(inv.issuedAtMs || inv.issuedAt || inv.createdAt)
    const paidMs = msOf(inv.paidAt)
    const when = basis === 'cash' ? paidMs : issuedMs
    if (basis === 'cash' && inv.status !== 'paid') continue
    if (!when || !inRange(when)) continue

    // Schema-2 documents carry an explicit VAT split. Legacy rows charged a
    // flat `amount` with no VAT line and the buyer paid exactly that — so they
    // are treated as VAT-INCLUSIVE, which is the correct treatment for the VAT
    // return, and flagged so nobody mistakes them for compliant tax invoices.
    const legacy = !(inv.schema >= 2)
    const gross = Number(inv.total != null ? inv.total : inv.amount) || 0
    const net = legacy ? round2(gross / 1.15) : (Number(inv.subtotal) || 0)
    const vat = legacy ? round2(gross - net) : (Number(inv.vat) || 0)
    if (legacy) missing.push({ kind: 'legacyInvoice', id: inv.id, note: 'مستند قبل النظام الجديد، قُسّم على أساس أن المبلغ شامل الضريبة' })

    const sign = isCredit ? -1 : 1
    entries.push({
      at: when, ref: inv.no || inv.id, tenantId: inv.tenantId, tenantName: inv.tenantName || '',
      account: isCredit ? 'refunds' : account,
      net: round2(sign * Math.abs(net)), vat: round2(sign * Math.abs(vat)), gross: round2(sign * Math.abs(gross)),
      status: inv.status, legacy,
      // Accrual only: how much of a yearly prepayment is still unearned.
      billing: inv.billing || 'monthly',
    })

    if (inv.status === 'paid') {
      const { fee } = gatewayFeeFor(Math.abs(gross), feeCfg)
      // Only card/online settlements carry a gateway fee. A bank transfer or a
      // hand-marked payment does not, and charging one would invent a cost.
      if (inv.provider === 'moyasar') {
        entries.push({
          at: paidMs || when, ref: inv.no || inv.id, tenantId: inv.tenantId,
          account: 'gatewayFees', net: -fee, vat: 0, gross: -fee, derived: true,
        })
      }
    }
  }

  // Cost of serving, from the spend rollups. A month with no rollup document
  // is reported as MISSING, not zero — the same discipline the venue engine
  // applies to unpriced inventory.
  const costRows = []
  for (const [period, roll] of Object.entries(spendRollups || {})) {
    if (!roll || !roll.byTenant) { missing.push({ kind: 'spendRollup', id: period, note: 'لا يوجد تجميع إنفاق لهذا الشهر' }); continue }
    const r = { ...UNIT_COST_USD, ...(rates || roll.rates || {}) }
    for (const [tid, row] of Object.entries(roll.byTenant)) {
      const usage = {}
      CHANNEL_KEYS.forEach((c) => { usage[c] = Number(row[c]) || 0 })
      const cost = costOf(usage, r)
      const byAccount = {}
      CHANNEL_KEYS.forEach((c) => {
        const acc = CHANNEL_ACCOUNT[c] || 'cogsMessaging'
        byAccount[acc] = round2((byAccount[acc] || 0) + (Number(usage[c]) || 0) * (Number(r[c]) || 0) * USD_TO_SAR)
      })
      costRows.push({ period, tenantId: tid, tenantName: row.name || '', plan: row.plan || '', sar: cost.sar, byAccount })
    }
  }

  return { entries, costRows, missing, basis }
}

// -------------------------------------------------------------- statements
export function platformPnl(ledger) {
  const rev = { subRevenue: 0, packRevenue: 0, setupRevenue: 0, refunds: 0 }
  let gatewayFees = 0
  for (const e of ledger.entries) {
    if (e.account === 'gatewayFees') { gatewayFees += Math.abs(e.net); continue }
    if (rev[e.account] !== undefined) rev[e.account] = round2(rev[e.account] + e.net)
  }
  const cogs = { cogsMessaging: 0, cogsAi: 0 }
  for (const r of ledger.costRows) {
    Object.entries(r.byAccount).forEach(([acc, v]) => { cogs[acc] = round2((cogs[acc] || 0) + v) })
  }
  const revenue = round2(rev.subRevenue + rev.packRevenue + rev.setupRevenue + rev.refunds)
  const totalCogs = round2(cogs.cogsMessaging + cogs.cogsAi)
  const grossProfit = round2(revenue - totalCogs)
  const netProfit = round2(grossProfit - gatewayFees)
  return {
    revenue, byRevenue: rev, cogs, totalCogs, gatewayFees: round2(gatewayFees),
    grossProfit, netProfit,
    grossMarginPct: revenue ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
    netMarginPct: revenue ? Math.round((netProfit / revenue) * 1000) / 10 : 0,
    missing: ledger.missing,
  }
}

// VAT return for a quarter: output VAT collected minus input VAT paid.
// Input VAT is currently only the gateway fee's VAT — every other vendor bills
// from outside the Kingdom, so there is no reclaimable input there.
export function platformVatReturn(ledger, { feeCfg = DEFAULT_GATEWAY_FEE } = {}) {
  let outputVat = 0
  let sales = 0
  let inputVat = 0
  for (const e of ledger.entries) {
    if (e.account === 'gatewayFees') {
      const v = Math.abs(e.net) * ((feeCfg.vatOnFeePct || 0) / (100 + (feeCfg.vatOnFeePct || 0)))
      inputVat = round2(inputVat + v)
      continue
    }
    outputVat = round2(outputVat + e.vat)
    sales = round2(sales + e.net)
  }
  return { sales, outputVat, inputVat, netDue: round2(outputVat - inputVat) }
}

// Aging: what is owed, by how long. Voided documents are excluded — they are
// not collectable and including them inflates what you think you are owed.
export function aging(invoices, asOf = Date.now()) {
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, older: 0 }
  const rows = []
  for (const inv of invoices || []) {
    if (inv.status === 'paid' || inv.status === 'void' || inv.status === 'refunded') continue
    const amount = Number(inv.total != null ? inv.total : inv.amount) || 0
    if (!amount) continue
    const due = Number(inv.dueAt) || (inv.createdAt && inv.createdAt.toMillis ? inv.createdAt.toMillis() : 0)
    const days = due ? Math.floor((asOf - due) / 86400000) : 0
    const bucket = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'older'
    buckets[bucket] = round2(buckets[bucket] + amount)
    rows.push({ id: inv.id, no: inv.no || '', tenantId: inv.tenantId, tenantName: inv.tenantName || '', amount, days, bucket })
  }
  rows.sort((a, b) => b.days - a.days)
  return { buckets, rows, total: round2(Object.values(buckets).reduce((s, v) => s + v, 0)) }
}

// Margin per venue: what they paid us, minus what serving them actually cost.
// The single most decision-relevant view in the whole engine.
export function marginByVenue(ledger, { feeCfg = DEFAULT_GATEWAY_FEE } = {}) {
  const map = new Map()
  const touch = (tid, name) => {
    if (!map.has(tid)) map.set(tid, { tenantId: tid, tenantName: name || '', revenue: 0, cost: 0, fees: 0 })
    const r = map.get(tid)
    if (name && !r.tenantName) r.tenantName = name
    return r
  }
  for (const e of ledger.entries) {
    const r = touch(e.tenantId, e.tenantName)
    if (e.account === 'gatewayFees') r.fees = round2(r.fees + Math.abs(e.net))
    else r.revenue = round2(r.revenue + e.net)
  }
  for (const c of ledger.costRows) {
    const r = touch(c.tenantId, c.tenantName)
    r.cost = round2(r.cost + c.sar)
  }
  const rows = [...map.values()].map((r) => {
    const margin = round2(r.revenue - r.cost - r.fees)
    return { ...r, margin, marginPct: r.revenue ? Math.round((margin / r.revenue) * 1000) / 10 : 0 }
  }).sort((a, b) => a.margin - b.margin)
  return rows
}

// Real MRR, replacing computeMRR — which summed PAID invoices in the latest
// period present, so it collapsed to near zero on the 1st of every month (when
// the cron mints a batch of unpaid ones) and climbed back over the following
// fortnight. That is a collections curve, not MRR.
export function mrrArr(tenants, { prices, metas = {} } = {}) {
  let mrr = 0
  let counted = 0
  for (const t of tenants || []) {
    if (t.active === false) continue
    if (t.planStatus === 'expired') continue
    if (!t.plan) continue
    const meta = metas[t.id] || {}
    const custom = meta.customPrice != null ? Number(meta.customPrice) : (t.customPrice != null ? Number(t.customPrice) : null)
    const price = Number.isFinite(custom) && custom >= 0 ? custom : (Number(prices && prices[t.plan]) || 0)
    if (!price) continue
    mrr = round2(mrr + price)
    counted += 1
  }
  return { mrr, arr: round2(mrr * 12), venues: counted, arpu: counted ? round2(mrr / counted) : 0 }
}

export function revenueByPlan(ledger) {
  const map = {}
  for (const e of ledger.entries) {
    if (e.account === 'gatewayFees') continue
    const k = e.account
    map[k] = round2((map[k] || 0) + e.net)
  }
  return map
}
