// Accounting engine — PURE functions over plain arrays. No Firestore, no React.
//
// Design rule (non-negotiable): this module NEVER invents a number. Every figure
// it returns is derived from documents the venue actually has (orders, expenses,
// purchase orders, materials, staff salaries, platform invoices, drawer sessions).
// When the source data is missing, the result is 0 / null / an explicit
// "insufficient data" marker — never an estimate presented as a fact.
//
// Revenue math intentionally MIRRORS src/routes/admin/Reports.jsx so the two
// screens can never disagree: settled = status in (paid, refunded); refunds are
// subtracted; VAT is treated as INCLUDED in the price (gross / (1 + rate)).

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------
// category: revenue | contra | cogs | expense | asset | liability | equity
export const ACCOUNTS = {
  sales: { code: 'sales', ar: 'مبيعات', en: 'Sales', category: 'revenue' },
  discounts: { code: 'discounts', ar: 'خصومات ومردودات', en: 'Discounts & returns', category: 'contra' },
  vatPayable: { code: 'vatPayable', ar: 'ضريبة القيمة المضافة المستحقة', en: 'VAT payable', category: 'liability' },
  vatInput: { code: 'vatInput', ar: 'ضريبة مدخلات قابلة للخصم', en: 'Deductible input VAT', category: 'asset' },
  cogs: { code: 'cogs', ar: 'تكلفة البضاعة المباعة', en: 'Cost of goods sold', category: 'cogs' },
  inventory: { code: 'inventory', ar: 'المخزون', en: 'Inventory', category: 'asset' },
  salaries: { code: 'salaries', ar: 'رواتب وأجور', en: 'Salaries & wages', category: 'expense' },
  rent: { code: 'rent', ar: 'إيجار', en: 'Rent', category: 'expense' },
  utilities: { code: 'utilities', ar: 'كهرباء ومياه', en: 'Utilities', category: 'expense' },
  maintenance: { code: 'maintenance', ar: 'صيانة', en: 'Maintenance', category: 'expense' },
  marketing: { code: 'marketing', ar: 'تسويق', en: 'Marketing', category: 'expense' },
  deliveryFees: { code: 'deliveryFees', ar: 'عمولات التوصيل', en: 'Delivery commissions', category: 'expense' },
  paymentFees: { code: 'paymentFees', ar: 'رسوم الدفع الإلكتروني', en: 'Payment processing fees', category: 'expense' },
  subscription: { code: 'subscription', ar: 'اشتراك النظام', en: 'System subscription', category: 'expense' },
  tipsPayable: { code: 'tipsPayable', ar: 'إكراميات مستحقة للموظفين', en: 'Tips payable to staff', category: 'liability' },
  cashDrawer: { code: 'cashDrawer', ar: 'نقدية في الدرج', en: 'Cash on hand', category: 'asset' },
  bank: { code: 'bank', ar: 'نقدية في البنك/الشبكة', en: 'Bank / card settlement', category: 'asset' },
  otherExpense: { code: 'otherExpense', ar: 'مصروفات أخرى', en: 'Other expenses', category: 'expense' },
}

// Accounts a manager may pick when recording an expense by hand.
export const EXPENSE_ACCOUNTS = Object.values(ACCOUNTS).filter((a) => a.category === 'expense')

export const accountAr = (code) => ACCOUNTS[code]?.ar || code
export const accountEn = (code) => ACCOUNTS[code]?.en || code
export const accountLabel = (code, ar = true) => (ar ? accountAr(code) : accountEn(code))

// Free-text expense categories written by older screens / the AI assistant are
// mapped onto the chart of accounts. Anything unrecognised lands in "other" —
// it is never silently dropped and never guessed into a specific bucket.
const EXPENSE_SYNONYMS = [
  [ACCOUNTS.salaries.code, ['salary', 'salaries', 'wage', 'wages', 'payroll', 'staff', 'راتب', 'رواتب', 'اجور', 'أجور', 'موظف']],
  [ACCOUNTS.rent.code, ['rent', 'lease', 'ايجار', 'إيجار', 'الايجار', 'الإيجار']],
  [ACCOUNTS.utilities.code, ['utility', 'utilities', 'electric', 'water', 'power', 'كهرباء', 'مياه', 'ماء', 'فاتورة كهرباء']],
  [ACCOUNTS.maintenance.code, ['maintenance', 'repair', 'fix', 'صيانة', 'اصلاح', 'إصلاح', 'تصليح']],
  [ACCOUNTS.marketing.code, ['marketing', 'ads', 'advertis', 'promo', 'تسويق', 'اعلان', 'إعلان', 'دعاية']],
  [ACCOUNTS.deliveryFees.code, ['delivery', 'courier', 'hungerstation', 'jahez', 'keeta', 'توصيل', 'مندوب', 'عمولة توصيل']],
  [ACCOUNTS.paymentFees.code, ['payment fee', 'gateway', 'mada fee', 'moyasar', 'stripe', 'رسوم دفع', 'رسوم الشبكة', 'بوابة دفع']],
  [ACCOUNTS.subscription.code, ['subscription', 'saas', 'software', 'اشتراك', 'النظام', 'برنامج']],
  [ACCOUNTS.inventory.code, ['purchase', 'stock', 'supplier', 'مشتريات', 'مخزون', 'مورد', 'بضاعة']],
]

export function mapExpenseAccount(category) {
  const raw = String(category || '').trim().toLowerCase()
  if (!raw) return ACCOUNTS.otherExpense.code
  if (ACCOUNTS[raw]) return raw // already an account code
  for (const [code, words] of EXPENSE_SYNONYMS) {
    if (words.some((w) => raw.includes(w))) return code
  }
  return ACCOUNTS.otherExpense.code
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------
export function toMs(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (typeof v.toDate === 'function') { try { return v.toDate().getTime() } catch (_) { return 0 } }
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100

// Arabic date with LATIN digits (hard rule: never Arabic-Indic numerals).
export function fmtDate(ms, ar = true) {
  if (!ms) return '—'
  const d = new Date(ms)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
export function fmtDateTime(ms, ar = true) {
  if (!ms) return '—'
  const d = new Date(ms)
  if (isNaN(d)) return '—'
  return `${fmtDate(ms, ar)} ${d.toLocaleTimeString(ar ? 'ar-SA-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`
}
// Day key (local) — used for daily buckets and bookkeeping-gap detection.
export const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// Which balance-sheet cash account a payment method settles into.
export function cashAccountFor(method) {
  const m = String(method || 'cash').toLowerCase()
  return m === 'cash' ? ACCOUNTS.cashDrawer.code : ACCOUNTS.bank.code
}
// Normalised inflow bucket for the cash-flow view.
export function methodBucket(method) {
  const m = String(method || 'cash').toLowerCase()
  if (m === 'cash') return 'cash'
  if (m === 'card' || m === 'card_terminal' || m === 'mada' || m === 'network') return 'card'
  if (m === 'online' || m === 'paid_online' || m === 'applepay' || m === 'apple_pay') return 'online'
  if (m === 'transfer' || m === 'bank') return 'transfer'
  return 'other'
}
export const METHOD_LABELS = {
  cash: { ar: 'نقدي', en: 'Cash' },
  card: { ar: 'شبكة', en: 'Card' },
  online: { ar: 'دفع إلكتروني', en: 'Online' },
  transfer: { ar: 'تحويل بنكي', en: 'Transfer' },
  other: { ar: 'أخرى', en: 'Other' },
}

// A settled order is one whose money actually moved (mirrors Reports.jsx).
export const isSettled = (o) => ['paid', 'refunded'].includes(o?.status)
export const refundOf = (o) => (o?.status === 'refunded' ? num(o?.refund?.amount) : 0)
// The moment the money landed — paidAt when known, else creation time.
export const settledAt = (o) => toMs(o?.paidAtMs) || toMs(o?.paidAt) || toMs(o?.createdAt)
// Every manager-applied reduction stored on an order.
export const orderDiscount = (o) => num(o?.discount) + num(o?.loyaltyDiscount) + num(o?.memberDiscount) + num(o?.compDiscount)

// ---------------------------------------------------------------------------
// Recipe costing — the ONLY source of COGS. An item with no recipe contributes
// zero cost and is reported as "uncosted" rather than estimated.
// ---------------------------------------------------------------------------
export function buildMaterialCostMap(materials) {
  const map = {}
  ;(materials || []).forEach((m) => { map[m.id] = num(m.avgCost) })
  return map
}

// Unit cost of one item (optionally a specific variant), from its recipe lines.
// Returns { cost, costed } — costed=false means the item has no recipe at all.
export function itemUnitCost(item, costMap, variantKey) {
  if (!item) return { cost: 0, costed: false }
  const lines = (variantKey && item.variantRecipes?.[variantKey]) || item.recipe
  if (!Array.isArray(lines) || !lines.length) return { cost: 0, costed: false }
  let cost = 0
  let any = false
  lines.forEach((l) => {
    const unit = costMap[l.materialId]
    if (unit == null) return
    any = true
    cost += num(unit) * num(l.qty)
  })
  return { cost: round2(cost), costed: any }
}

// COGS of one settled order, summed over its lines (+ modifier recipes).
export function orderCogs(order, itemsById, costMap) {
  let cogs = 0
  let uncostedLines = 0
  ;(order?.items || []).forEach((line) => {
    const item = itemsById[line.itemId]
    const qty = num(line.qty) || 1
    const { cost, costed } = itemUnitCost(item, costMap, line.variantKey)
    if (!costed) uncostedLines += 1
    cogs += cost * qty
    ;(line.modifiers || []).forEach((mod) => {
      if (!Array.isArray(mod?.recipe)) return
      mod.recipe.forEach((l) => { cogs += num(costMap[l.materialId]) * num(l.qty) * qty })
    })
  })
  return { cogs: round2(cogs), uncostedLines }
}

// ---------------------------------------------------------------------------
// Payroll accrual from the salaries actually stored on staff members.
// ---------------------------------------------------------------------------
// There is no payslip collection in this system, so the only real payroll data
// is staff.salary (a MONTHLY figure). This allocates that real figure across the
// selected period by calendar days — stated arithmetic, not an estimate — and
// every row carries `accrued: true` plus the basis used, so the UI can say
// plainly where the number came from. Members without a salary are skipped
// entirely rather than being assigned a guessed one.
export function accruePayroll(staff = [], from = 0, to = Date.now()) {
  const start = toMs(from)
  const end = toMs(to) || Date.now()
  if (!(end > start)) return []
  const rows = []
  ;(staff || []).forEach((s) => {
    const monthly = num(s.salary)
    if (monthly <= 0) return
    if (s.active === false) return
    // Walk each calendar month the period touches and take the overlapping share.
    const cursor = new Date(start)
    cursor.setDate(1); cursor.setHours(0, 0, 0, 0)
    while (cursor.getTime() <= end) {
      const y = cursor.getFullYear()
      const m = cursor.getMonth()
      const daysInMonth = new Date(y, m + 1, 0).getDate()
      const mStart = new Date(y, m, 1).getTime()
      const mEnd = new Date(y, m + 1, 0, 23, 59, 59, 999).getTime()
      const overlapStart = Math.max(start, mStart)
      const overlapEnd = Math.min(end, mEnd)
      if (overlapEnd > overlapStart) {
        const days = Math.max(1, Math.round((overlapEnd - overlapStart) / 86400000))
        const share = Math.min(1, days / daysInMonth)
        rows.push({
          id: `payroll-${s.uid || s.id}-${y}-${m + 1}`,
          staffName: s.displayName || s.name || s.email || '',
          amount: round2(monthly * share),
          date: overlapStart,
          accrued: true,
          basis: { monthlySalary: monthly, daysCounted: days, daysInMonth },
        })
      }
      cursor.setMonth(cursor.getMonth() + 1)
    }
  })
  return rows
}

// ---------------------------------------------------------------------------
// buildLedger — the normalised journal every other view reads from.
// ---------------------------------------------------------------------------
// Each entry: { id, date, type, account, accountAr, accountEn, category,
//               debit, credit, ref, refType, note, method?, counter? }
// Entries are double-entry balanced per source document.
export function buildLedger({
  orders = [],
  expenses = [],
  purchaseOrders = [],
  materials = [],
  items = [],
  payroll = [],
  subscriptions = [],
  from = 0,
  to = Date.now(),
  vatEnabled = false,
  vatRate = 15,
} = {}) {
  const fromMs = toMs(from)
  const toMsX = toMs(to) || Date.now()
  const inRange = (ms) => ms >= fromMs && ms <= toMsX

  const costMap = buildMaterialCostMap(materials)
  const itemsById = {}
  ;(items || []).forEach((it) => { itemsById[it.id] = it })

  const entries = []
  let seq = 0
  const push = (e) => {
    const acc = ACCOUNTS[e.account]
    entries.push({
      id: `${e.refType}-${e.ref}-${++seq}`,
      date: e.date,
      type: e.type,
      account: e.account,
      accountAr: acc?.ar || e.account,
      accountEn: acc?.en || e.account,
      category: acc?.category || 'expense',
      debit: round2(e.debit || 0),
      credit: round2(e.credit || 0),
      ref: e.ref,
      refType: e.refType,
      note: e.note || '',
      ...(e.method ? { method: e.method } : {}),
      ...(e.counter ? { counter: e.counter } : {}),
    })
  }

  const rate = num(vatRate) || 15
  const vatOf = (gross) => (vatEnabled ? round2(gross - gross / (1 + rate / 100)) : 0)

  // ---- 1. Sales (settled orders) -----------------------------------------
  ;(orders || []).filter((o) => isSettled(o)).forEach((o) => {
    const date = settledAt(o)
    if (!inRange(date)) return
    const refund = refundOf(o)
    const kept = round2(num(o.total) - refund) // money actually retained
    if (kept === 0 && !refund && !num(o.tip)) return
    const vat = vatOf(kept)
    const netSales = round2(kept - vat)
    const disc = round2(orderDiscount(o))
    const tip = round2(num(o.tip))
    const ref = o.id || o.code || 'order'
    const note = o.code ? `طلب ${o.code}` : 'طلب'

    // Debit the cash account(s) the money landed in. paymentBreakdown (split
    // payments) is authoritative when present, otherwise the single method.
    const parts = []
    if (o.paymentBreakdown && typeof o.paymentBreakdown === 'object') {
      Object.entries(o.paymentBreakdown).forEach(([m, a]) => { if (num(a)) parts.push([m, num(a)]) })
    }
    if (!parts.length) parts.push([o.paidOnline ? 'online' : (o.paymentMethod || 'cash'), kept])
    // Split payments are recorded gross; the refund reduces the largest leg so
    // the debits still tie to the retained amount.
    const partsSum = parts.reduce((s, [, a]) => s + a, 0)
    if (refund > 0 && partsSum > kept && parts.length) {
      parts.sort((a, b) => b[1] - a[1])
      parts[0][1] = round2(parts[0][1] - (partsSum - kept))
    }
    // Tips ride along with the payment they were added to (first leg).
    parts.forEach(([m, amt], i) => {
      const val = round2(amt + (i === 0 ? tip : 0))
      if (!val) return
      push({ date, type: 'sale', account: cashAccountFor(m), debit: val, credit: 0, ref, refType: 'order', note, method: methodBucket(m), counter: ACCOUNTS.sales.code })
    })

    if (disc || refund) push({ date, type: 'sale', account: ACCOUNTS.discounts.code, debit: round2(disc + refund), credit: 0, ref, refType: 'order', note: refund ? `${note} — مسترد` : `${note} — خصم` })
    push({ date, type: 'sale', account: ACCOUNTS.sales.code, debit: 0, credit: round2(netSales + disc + refund), ref, refType: 'order', note })
    if (vat) push({ date, type: 'sale', account: ACCOUNTS.vatPayable.code, debit: 0, credit: vat, ref, refType: 'order', note: `${note} — ضريبة مخرجات` })
    if (tip) push({ date, type: 'sale', account: ACCOUNTS.tipsPayable.code, debit: 0, credit: tip, ref, refType: 'order', note: `${note} — إكرامية` })

    // ---- 2. COGS from the order's recipes --------------------------------
    const { cogs } = orderCogs(o, itemsById, costMap)
    if (cogs > 0) {
      push({ date, type: 'cogs', account: ACCOUNTS.cogs.code, debit: cogs, credit: 0, ref, refType: 'order', note: `تكلفة ${note}` })
      push({ date, type: 'cogs', account: ACCOUNTS.inventory.code, debit: 0, credit: cogs, ref, refType: 'order', note: `صرف مخزون — ${note}` })
    }
  })

  // ---- 3. Expenses --------------------------------------------------------
  ;(expenses || []).forEach((x) => {
    const date = toMs(x.at) || toMs(x.createdAt) || toMs(x.date)
    if (!inRange(date)) return
    const gross = round2(num(x.amount))
    if (!gross) return
    const account = x.account && ACCOUNTS[x.account] ? x.account : mapExpenseAccount(x.category)
    // Input VAT is only recognised when the venue explicitly flagged the bill as
    // vatable — never inferred from the amount.
    const inputVat = x.vatable ? round2(num(x.vatAmount) || (gross - gross / (1 + rate / 100))) : 0
    const netCost = round2(gross - inputVat)
    const ref = x.id || 'expense'
    const note = [x.category, x.supplier, x.note].filter(Boolean).join(' · ') || 'مصروف'
    const payAcc = cashAccountFor(x.paidBy || x.method || 'cash')
    push({ date, type: 'expense', account, debit: netCost, credit: 0, ref, refType: 'expense', note })
    if (inputVat) push({ date, type: 'expense', account: ACCOUNTS.vatInput.code, debit: inputVat, credit: 0, ref, refType: 'expense', note: `${note} — ضريبة مدخلات` })
    push({ date, type: 'expense', account: payAcc, debit: 0, credit: gross, ref, refType: 'expense', note, method: methodBucket(x.paidBy || x.method || 'cash'), counter: account })
  })

  // ---- 4. Received purchase orders → inventory ----------------------------
  ;(purchaseOrders || []).filter((p) => p.status === 'received').forEach((p) => {
    const date = toMs(p.receivedAt) || toMs(p.updatedAt) || toMs(p.createdAt)
    if (!inRange(date)) return
    const total = round2((p.items || []).reduce((s, l) => s + num(l.cost), 0) || num(p.total))
    if (!total) return
    const inputVat = p.vatable ? round2(num(p.vatAmount) || (total - total / (1 + rate / 100))) : 0
    const netCost = round2(total - inputVat)
    const ref = p.id || p.code || 'po'
    const note = `أمر شراء ${p.code || ''}${p.supplierName ? ` · ${p.supplierName}` : ''}`.trim()
    push({ date, type: 'purchase', account: ACCOUNTS.inventory.code, debit: netCost, credit: 0, ref, refType: 'purchaseOrder', note })
    if (inputVat) push({ date, type: 'purchase', account: ACCOUNTS.vatInput.code, debit: inputVat, credit: 0, ref, refType: 'purchaseOrder', note: `${note} — ضريبة مدخلات` })
    push({ date, type: 'purchase', account: ACCOUNTS.bank.code, debit: 0, credit: total, ref, refType: 'purchaseOrder', note, method: 'transfer', counter: ACCOUNTS.inventory.code })
  })

  // ---- 5. Payroll ---------------------------------------------------------
  // payroll rows: { id, staffName, amount, date } — supplied by the caller from
  // real staff salary fields. Nothing is pro-rated or invented here.
  ;(payroll || []).forEach((p) => {
    const date = toMs(p.date) || toMs(p.at) || toMs(p.createdAt)
    if (!inRange(date)) return
    const amt = round2(num(p.amount))
    if (!amt) return
    const ref = p.id || 'payroll'
    const note = `راتب ${p.staffName || ''}`.trim()
    push({ date, type: 'payroll', account: ACCOUNTS.salaries.code, debit: amt, credit: 0, ref, refType: 'payroll', note })
    push({ date, type: 'payroll', account: ACCOUNTS.bank.code, debit: 0, credit: amt, ref, refType: 'payroll', note, method: 'transfer', counter: ACCOUNTS.salaries.code })
  })

  // ---- 6. The venue's own platform subscription invoices ------------------
  ;(subscriptions || []).forEach((inv) => {
    const date = toMs(inv.paidAt) || toMs(inv.createdAt)
    if (!inRange(date)) return
    const amt = round2(num(inv.amount))
    if (!amt) return
    const ref = inv.id || 'invoice'
    const note = `اشتراك المنصة ${inv.period || ''}`.trim()
    push({ date, type: 'subscription', account: ACCOUNTS.subscription.code, debit: amt, credit: 0, ref, refType: 'platformInvoice', note })
    push({ date, type: 'subscription', account: ACCOUNTS.bank.code, debit: 0, credit: amt, ref, refType: 'platformInvoice', note, method: 'transfer', counter: ACCOUNTS.subscription.code })
  })

  entries.sort((a, b) => b.date - a.date)
  return entries
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------
const sumBy = (ledger, account, side) => round2((ledger || []).reduce((s, e) => (e.account === account ? s + num(e[side]) : s), 0))

export function profitAndLoss(ledger = []) {
  const revenueGross = sumBy(ledger, ACCOUNTS.sales.code, 'credit')
  const discounts = sumBy(ledger, ACCOUNTS.discounts.code, 'debit')
  const revenueNet = round2(revenueGross - discounts)
  const vat = sumBy(ledger, ACCOUNTS.vatPayable.code, 'credit')
  const cogs = sumBy(ledger, ACCOUNTS.cogs.code, 'debit')
  const grossProfit = round2(revenueNet - cogs)

  const expensesByCategory = {}
  ledger.forEach((e) => {
    if (ACCOUNTS[e.account]?.category !== 'expense') return
    expensesByCategory[e.account] = round2((expensesByCategory[e.account] || 0) + num(e.debit) - num(e.credit))
  })
  const totalExpenses = round2(Object.values(expensesByCategory).reduce((s, v) => s + v, 0))
  const netProfit = round2(grossProfit - totalExpenses)
  const tips = sumBy(ledger, ACCOUNTS.tipsPayable.code, 'credit')

  return {
    revenueGross,
    revenueNet,
    discounts,
    vat,
    cogs,
    grossProfit,
    grossMarginPct: revenueNet ? round2((grossProfit / revenueNet) * 100) : 0,
    expensesByCategory,
    totalExpenses,
    netProfit,
    netMarginPct: revenueNet ? round2((netProfit / revenueNet) * 100) : 0,
    tips,
  }
}

// Journal entries behind a single P&L line — powers the drill-down. Every number
// on screen must be traceable to the documents that produced it.
export function entriesForAccount(ledger = [], account) {
  return (ledger || []).filter((e) => e.account === account)
}
export function entriesForLine(ledger = [], line) {
  if (line === 'revenue') return entriesForAccount(ledger, ACCOUNTS.sales.code)
  if (line === 'discounts') return entriesForAccount(ledger, ACCOUNTS.discounts.code)
  if (line === 'cogs') return entriesForAccount(ledger, ACCOUNTS.cogs.code)
  if (line === 'vat') return entriesForAccount(ledger, ACCOUNTS.vatPayable.code)
  if (line === 'expenses') return (ledger || []).filter((e) => ACCOUNTS[e.account]?.category === 'expense')
  return entriesForAccount(ledger, line)
}

// ---------------------------------------------------------------------------
// Cash flow + drawer reconciliation
// ---------------------------------------------------------------------------
export function cashFlow(ledger = [], drawerSessions = []) {
  const cashAccounts = [ACCOUNTS.cashDrawer.code, ACCOUNTS.bank.code]
  const inflowByMethod = {}
  const outflowByAccount = {}
  let inflow = 0
  let outflow = 0

  ledger.forEach((e) => {
    if (!cashAccounts.includes(e.account)) return
    if (num(e.debit)) {
      const k = e.method || 'other'
      inflowByMethod[k] = round2((inflowByMethod[k] || 0) + num(e.debit))
      inflow = round2(inflow + num(e.debit))
    }
    if (num(e.credit)) {
      const k = e.counter || ACCOUNTS.otherExpense.code
      outflowByAccount[k] = round2((outflowByAccount[k] || 0) + num(e.credit))
      outflow = round2(outflow + num(e.credit))
    }
  })

  // Drawer reconciliation uses the figures the cashier actually recorded at
  // close (closingCount / expectedCash / variance). Open sessions are listed
  // but never scored — there is nothing to reconcile against yet.
  const sessions = (drawerSessions || []).map((s) => {
    const closed = s.status === 'closed'
    const expected = num(s.expectedCash) || round2(num(s.openingFloat) + num(s.cashSales))
    const counted = closed ? num(s.closingCount) : null
    const variance = closed ? round2(counted - expected) : null
    return {
      id: s.id,
      openedAt: toMs(s.openedAtMs) || toMs(s.openedAt),
      closedAt: toMs(s.closedAtMs) || toMs(s.closedAt),
      by: s.closedByName || s.openedByName || '',
      openingFloat: round2(num(s.openingFloat)),
      cashSales: round2(num(s.cashSales)),
      cardSales: round2(num(s.cardSales)),
      onlineSales: round2(num(s.onlineSales)),
      expected: round2(expected),
      counted,
      variance,
      status: s.status || 'open',
    }
  }).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0))

  const closedSessions = sessions.filter((s) => s.status === 'closed')
  const totalVariance = round2(closedSessions.reduce((s, x) => s + num(x.variance), 0))

  return {
    inflow,
    outflow,
    net: round2(inflow - outflow),
    inflowByMethod,
    outflowByAccount,
    sessions,
    totalVariance,
    reconciled: closedSessions.length > 0,
    sessionsCount: sessions.length,
  }
}

// ---------------------------------------------------------------------------
// VAT return (ZATCA-style period summary)
// ---------------------------------------------------------------------------
export function vatReturn(ledger = [], rate = 15) {
  const outputVat = sumBy(ledger, ACCOUNTS.vatPayable.code, 'credit')
  const inputVat = sumBy(ledger, ACCOUNTS.vatInput.code, 'debit')
  const revenueGross = sumBy(ledger, ACCOUNTS.sales.code, 'credit')
  const discounts = sumBy(ledger, ACCOUNTS.discounts.code, 'debit')
  const taxableSales = round2(revenueGross - discounts)
  // Purchases/expenses that were actually flagged vatable — the only ones that
  // may be deducted. Unflagged bills are reported separately, not assumed.
  const vatableRefs = new Set(ledger.filter((e) => e.account === ACCOUNTS.vatInput.code).map((e) => `${e.refType}:${e.ref}`))
  const purchasesTaxable = round2(ledger.reduce((s, e) => {
    if (e.account !== ACCOUNTS.inventory.code && ACCOUNTS[e.account]?.category !== 'expense') return s
    return vatableRefs.has(`${e.refType}:${e.ref}`) ? s + num(e.debit) : s
  }, 0))
  const purchasesUntaxed = round2(ledger.reduce((s, e) => {
    if (e.account !== ACCOUNTS.inventory.code && ACCOUNTS[e.account]?.category !== 'expense') return s
    return vatableRefs.has(`${e.refType}:${e.ref}`) ? s : s + num(e.debit)
  }, 0))

  return {
    rate: num(rate) || 15,
    taxableSales,
    outputVat,
    purchasesTaxable,
    purchasesUntaxed,
    inputVat,
    netPayable: round2(outputVat - inputVat),
  }
}

// ---------------------------------------------------------------------------
// Inventory valuation
// ---------------------------------------------------------------------------
export function inventoryValuation(materials = []) {
  const rows = (materials || []).map((m) => ({
    id: m.id,
    nameAr: m.nameAr || m.name || '—',
    nameEn: m.nameEn || '',
    unit: m.baseUnit || m.unit || '',
    qty: round2(num(m.stockQty)),
    avgCost: round2(num(m.avgCost)),
    value: round2(num(m.stockQty) * num(m.avgCost)),
  })).sort((a, b) => b.value - a.value)
  const total = round2(rows.reduce((s, r) => s + r.value, 0))
  // Stock on hand with no purchase cost recorded yet → its value is unknown,
  // not zero. Surfaced so the manager knows the total understates reality.
  const unpriced = rows.filter((r) => r.qty > 0 && r.avgCost === 0).length
  return { rows, total, count: rows.length, unpriced }
}

// ---------------------------------------------------------------------------
// Break-even
// ---------------------------------------------------------------------------
export function breakEven(pnl, fixedCosts) {
  const revenue = num(pnl?.revenueNet)
  const fixed = fixedCosts == null ? num(pnl?.totalExpenses) : num(fixedCosts)
  const variable = num(pnl?.cogs)
  if (!revenue) return { possible: false, reason: 'no-revenue', fixed, contributionPct: 0, breakEvenRevenue: 0, marginOfSafety: 0 }
  const contributionPct = round2(((revenue - variable) / revenue) * 100)
  if (contributionPct <= 0) return { possible: false, reason: 'no-contribution', fixed, contributionPct, breakEvenRevenue: 0, marginOfSafety: 0 }
  const breakEvenRevenue = round2(fixed / (contributionPct / 100))
  return {
    possible: true,
    reason: '',
    fixed: round2(fixed),
    contributionPct,
    breakEvenRevenue,
    marginOfSafety: round2(revenue - breakEvenRevenue),
    marginOfSafetyPct: round2(((revenue - breakEvenRevenue) / revenue) * 100),
  }
}

// ---------------------------------------------------------------------------
// Per-item cost / price / margin — real recipes only
// ---------------------------------------------------------------------------
export function cogsRatioByItem({ orders = [], items = [], materials = [] } = {}) {
  const costMap = buildMaterialCostMap(materials)
  const sold = {}
  ;(orders || []).filter((o) => isSettled(o)).forEach((o) => {
    ;(o.items || []).forEach((l) => {
      if (!l.itemId) return
      const k = l.itemId
      if (!sold[k]) sold[k] = { qty: 0, revenue: 0 }
      sold[k].qty += num(l.qty) || 1
      sold[k].revenue = round2(sold[k].revenue + num(l.lineTotal))
    })
  })

  const rows = (items || []).map((it) => {
    const { cost, costed } = itemUnitCost(it, costMap)
    const price = round2(num(it.price))
    const s = sold[it.id] || { qty: 0, revenue: 0 }
    const margin = costed ? round2(price - cost) : null
    return {
      id: it.id,
      nameAr: it.nameAr || it.name || '—',
      nameEn: it.nameEn || '',
      price,
      cost: costed ? cost : null,
      costed,
      margin,
      marginPct: costed && price ? round2(((price - cost) / price) * 100) : null,
      cogsPct: costed && price ? round2((cost / price) * 100) : null,
      qtySold: s.qty,
      revenue: s.revenue,
      totalCost: costed ? round2(cost * s.qty) : null,
      belowCost: costed && price > 0 && cost > price,
    }
  })

  // Worst margin first; uncosted items sink to the bottom (unknown, not bad).
  rows.sort((a, b) => {
    if (a.costed !== b.costed) return a.costed ? -1 : 1
    return num(a.marginPct) - num(b.marginPct)
  })

  return {
    rows,
    costedCount: rows.filter((r) => r.costed).length,
    uncostedCount: rows.filter((r) => !r.costed).length,
    belowCost: rows.filter((r) => r.belowCost),
  }
}

// ---------------------------------------------------------------------------
// anomalies — deterministic RULES over real documents. No AI, no guessing.
// Each finding carries the numbers that triggered it so it can be verified.
// ---------------------------------------------------------------------------
export function anomalies({
  orders = [],
  expenses = [],
  ledger = [],
  materials = [],
  items = [],
  drawerSessions = [],
  priorExpenses = [],
  tenant = null,
  from = 0,
  to = Date.now(),
  discountThresholdPct = 10,
} = {}) {
  const out = []
  const add = (o) => out.push({ id: `${o.kind}-${out.length}`, ...o })
  const pnl = profitAndLoss(ledger)

  // R1 — expense category spiking above 2x its own 3-period average.
  // priorExpenses = the SAME length of time immediately before, x3 periods.
  if ((priorExpenses || []).length) {
    const cur = {}
    ledger.forEach((e) => { if (ACCOUNTS[e.account]?.category === 'expense') cur[e.account] = round2((cur[e.account] || 0) + num(e.debit)) })
    const prior = {}
    ;(priorExpenses || []).forEach((x) => {
      const acc = x.account && ACCOUNTS[x.account] ? x.account : mapExpenseAccount(x.category)
      prior[acc] = round2((prior[acc] || 0) + num(x.amount))
    })
    Object.entries(cur).forEach(([acc, amt]) => {
      const avg = round2(num(prior[acc]) / 3)
      if (avg > 0 && amt > avg * 2) {
        add({
          kind: 'expense-spike', severity: 'high', account: acc,
          titleAr: `ارتفاع حاد في «${accountAr(acc)}»`,
          detailAr: `صرفت ${amt} في هذه الفترة مقابل متوسط ${avg} في الفترات الثلاث السابقة — أي أكثر من الضعف.`,
          numbers: { current: amt, average3: avg, ratio: round2(amt / avg) },
        })
      }
    })
  }

  // R2 — discounts eating more than the threshold share of sales.
  if (pnl.revenueGross > 0) {
    const pct = round2((pnl.discounts / pnl.revenueGross) * 100)
    if (pct > discountThresholdPct) {
      add({
        kind: 'discount-ratio', severity: pct > discountThresholdPct * 2 ? 'high' : 'medium',
        titleAr: 'نسبة الخصومات والمردودات مرتفعة',
        detailAr: `الخصومات والمردودات ${pct}% من إجمالي المبيعات (${pnl.discounts} من ${pnl.revenueGross}) — الحد المرجعي ${discountThresholdPct}%.`,
        numbers: { discounts: pnl.discounts, revenueGross: pnl.revenueGross, pct },
      })
    }
  }

  // R3 — voided / refunded / cancelled orders concentrated on one staffer.
  const byStaff = {}
  ;(orders || []).forEach((o) => {
    const isVoid = o.status === 'refunded' || o.status === 'cancelled' || num(o.compDiscount) > 0
    if (!isVoid) return
    const k = o.servedByName || o.cancelledBy || o.compByName || '—'
    if (!byStaff[k]) byStaff[k] = { count: 0, amount: 0 }
    byStaff[k].count += 1
    byStaff[k].amount = round2(byStaff[k].amount + refundOf(o) + num(o.compDiscount))
  })
  const voidRows = Object.entries(byStaff).sort((a, b) => b[1].count - a[1].count)
  const voidTotal = voidRows.reduce((s, [, v]) => s + v.count, 0)
  if (voidTotal >= 4 && voidRows.length) {
    const [name, v] = voidRows[0]
    const share = round2((v.count / voidTotal) * 100)
    if (share >= 60) {
      add({
        kind: 'void-concentration', severity: 'high',
        titleAr: 'تركّز الإلغاءات والمردودات على موظف واحد',
        detailAr: `${name} مسؤول عن ${v.count} من أصل ${voidTotal} عملية إلغاء/استرداد/مجاملة (${share}%) بقيمة ${v.amount}.`,
        numbers: { staff: name, count: v.count, total: voidTotal, sharePct: share, amount: v.amount },
      })
    }
  }

  // R4 — items sold below their recipe cost.
  const margins = cogsRatioByItem({ orders, items, materials })
  margins.belowCost.filter((r) => r.qtySold > 0).forEach((r) => {
    add({
      kind: 'below-cost', severity: 'high', itemId: r.id,
      titleAr: `«${r.nameAr}» يُباع بخسارة`,
      detailAr: `سعر البيع ${r.price} وتكلفة الوصفة ${r.cost} — خسارة ${round2(r.cost - r.price)} لكل وحدة، وبِيع ${r.qtySold} وحدة في الفترة.`,
      numbers: { price: r.price, cost: r.cost, lossPerUnit: round2(r.cost - r.price), qtySold: r.qtySold },
    })
  })

  // R5 — cash variance in closed drawer sessions.
  const cf = cashFlow(ledger, drawerSessions)
  cf.sessions.filter((s) => s.status === 'closed' && Math.abs(num(s.variance)) > 0).forEach((s) => {
    add({
      kind: 'drawer-variance', severity: Math.abs(s.variance) >= 50 ? 'high' : 'low', sessionId: s.id,
      titleAr: s.variance < 0 ? 'عجز في درج النقد' : 'زيادة في درج النقد',
      detailAr: `وردية ${s.by || ''} بتاريخ ${fmtDate(s.openedAt)}: المتوقع ${s.expected} والمعدود ${s.counted} — الفرق ${s.variance}.`,
      numbers: { expected: s.expected, counted: s.counted, variance: s.variance, by: s.by },
    })
  })

  // R6 — days with revenue but zero recorded expenses (bookkeeping gap).
  const revDays = new Set()
  ledger.forEach((e) => { if (e.account === ACCOUNTS.sales.code && num(e.credit)) revDays.add(dayKey(e.date)) })
  const expDays = new Set()
  ledger.forEach((e) => { if (ACCOUNTS[e.account]?.category === 'expense' && num(e.debit)) expDays.add(dayKey(e.date)) })
  const gapDays = [...revDays].filter((d) => !expDays.has(d)).sort()
  if (gapDays.length && revDays.size >= 3 && gapDays.length >= Math.ceil(revDays.size * 0.5)) {
    add({
      kind: 'bookkeeping-gap', severity: 'medium',
      titleAr: 'أيام فيها مبيعات بلا أي مصروف مسجّل',
      detailAr: `${gapDays.length} يوماً من أصل ${revDays.size} يوم بيع لم يُسجَّل فيها أي مصروف — الأرجح أن المصروفات غير مُدخلة، ما يجعل صافي الربح أعلى من الحقيقة.`,
      numbers: { gapDays: gapDays.length, revenueDays: revDays.size, days: gapDays.slice(0, 10) },
    })
  }

  // R7 — VAT collected while the venue has no tax number configured.
  if (pnl.vat > 0 && !(tenant?.vatNumber || tenant?.taxNumber)) {
    add({
      kind: 'vat-no-taxnumber', severity: 'high',
      titleAr: 'ضريبة محصّلة بدون رقم ضريبي مسجّل',
      detailAr: `حُصّلت ضريبة قدرها ${pnl.vat} خلال الفترة، لكن لا يوجد رقم تسجيل ضريبي في إعدادات المنشأة — الفاتورة الضريبية غير مكتملة نظاماً.`,
      numbers: { vat: pnl.vat },
    })
  }

  // R8 — the P&L is structurally incomplete (no COGS at all).
  if (pnl.revenueNet > 0 && pnl.cogs === 0 && margins.costedCount === 0 && (items || []).length > 0) {
    add({
      kind: 'no-recipes', severity: 'medium',
      titleAr: 'لا توجد وصفات مسعّرة — تكلفة البضاعة صفر',
      detailAr: `لم تُربط أي وصفة بمواد خام، لذلك تكلفة البضاعة المباعة تظهر صفراً وهامش الربح الإجمالي غير واقعي. اربط الوصفات من شاشة المخزون.`,
      numbers: { itemsTotal: (items || []).length, costedItems: margins.costedCount },
    })
  }

  // R9 — no expenses recorded at all in the period.
  if (pnl.revenueNet > 0 && (expenses || []).length === 0) {
    add({
      kind: 'no-expenses', severity: 'medium',
      titleAr: 'لا مصروفات مسجّلة في الفترة',
      detailAr: 'صافي الربح المعروض يساوي مجمل الربح لأن أي مصروف تشغيلي لم يُدخل بعد. سجّل الإيجار والرواتب والفواتير للحصول على رقم حقيقي.',
      numbers: { revenueNet: pnl.revenueNet },
    })
  }

  const order = { high: 0, medium: 1, low: 2 }
  out.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3))
  return out
}

// ---------------------------------------------------------------------------
// Compact snapshot for the AI accountant. This is the ONLY thing the model
// sees — it is 100% derived from the ledger, so the model has real numbers to
// quote and no room to invent them.
// ---------------------------------------------------------------------------
export function aiSnapshot({ ledger = [], orders = [], items = [], materials = [], drawerSessions = [], findings = [], tenant = null, from = 0, to = Date.now(), vatRate = 15 } = {}) {
  const pnl = profitAndLoss(ledger)
  const cf = cashFlow(ledger, drawerSessions)
  const vat = vatReturn(ledger, vatRate)
  const inv = inventoryValuation(materials)
  const margins = cogsRatioByItem({ orders, items, materials })

  const topExpenses = Object.entries(pnl.expensesByCategory)
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([acc, amt]) => ({ account: accountAr(acc), amount: amt }))

  const bestItems = margins.rows.filter((r) => r.costed && r.qtySold > 0)
    .slice().sort((a, b) => num(b.marginPct) - num(a.marginPct)).slice(0, 5)
    .map((r) => ({ name: r.nameAr, price: r.price, cost: r.cost, marginPct: r.marginPct, qtySold: r.qtySold }))
  const worstItems = margins.rows.filter((r) => r.costed && r.qtySold > 0).slice(0, 5)
    .map((r) => ({ name: r.nameAr, price: r.price, cost: r.cost, marginPct: r.marginPct, qtySold: r.qtySold }))

  const settled = (orders || []).filter(isSettled)

  return {
    period: { from: fmtDate(toMs(from)), to: fmtDate(toMs(to)) },
    currency: tenant?.currency || 'SAR',
    venue: tenant?.name || '',
    ordersSettled: settled.length,
    avgTicket: settled.length ? round2(pnl.revenueNet / settled.length) : 0,
    pnl: {
      revenueNet: pnl.revenueNet, discounts: pnl.discounts, cogs: pnl.cogs,
      grossProfit: pnl.grossProfit, grossMarginPct: pnl.grossMarginPct,
      totalExpenses: pnl.totalExpenses, netProfit: pnl.netProfit, netMarginPct: pnl.netMarginPct,
      tips: pnl.tips,
    },
    topExpenses,
    bestMarginItems: bestItems,
    worstMarginItems: worstItems,
    itemsWithoutRecipe: margins.uncostedCount,
    cash: { inflow: cf.inflow, outflow: cf.outflow, net: cf.net, byMethod: cf.inflowByMethod, drawerVariance: cf.totalVariance, sessions: cf.sessionsCount },
    vat: { rate: vat.rate, taxableSales: vat.taxableSales, outputVat: vat.outputVat, inputVat: vat.inputVat, netPayable: vat.netPayable, taxNumber: tenant?.vatNumber || tenant?.taxNumber || null },
    inventory: { total: inv.total, materials: inv.count, unpricedMaterials: inv.unpriced },
    findings: (findings || []).map((f) => ({ severity: f.severity, title: f.titleAr, detail: f.detailAr })),
    dataCoverage: {
      journalEntries: (ledger || []).length,
      expenseDocuments: (ledger || []).filter((e) => e.refType === 'expense').length,
      hasRecipes: margins.costedCount > 0,
      hasDrawerSessions: cf.sessionsCount > 0,
    },
  }
}

// Hard anti-hallucination instruction wrapped around every AI accountant call.
export const AI_GUARD_AR = [
  'أنت محاسب المنشأة. أجب فقط من الأرقام المرفقة في كائن JSON أدناه.',
  'لا تخترع أي رقم مهما كان صغيراً، ولا تقدّر، ولا تكمل من معرفتك العامة.',
  'كل رقم تذكره يجب أن يكون موجوداً حرفياً في البيانات المرفقة أو ناتجاً عن عملية حسابية بسيطة بين أرقامها، وبيّن مصدره.',
  'إن لم تكن البيانات كافية للإجابة، قل ذلك صراحة واذكر ما الذي ينقص بالتحديد.',
  'استخدم الأرقام اللاتينية فقط. لا تستخدم رموزاً تعبيرية إطلاقاً.',
  'اكتب بالعربية، بإيجاز ووضوح، وبتنسيق markdown بسيط (عناوين قصيرة ونقاط وجداول عند الحاجة).',
].join('\n')

export function buildAiPrompt(question, snapshot) {
  return [
    AI_GUARD_AR,
    '',
    'البيانات المالية الحقيقية للفترة (JSON):',
    JSON.stringify(snapshot),
    '',
    `سؤال المدير: ${question}`,
  ].join('\n')
}

// A custom-report spec asked from the model. Returns null when the reply is not
// usable — the caller MUST tell the user honestly instead of faking a report.
export function parseReportSpec(text) {
  if (!text) return null
  const match = String(text).match(/\{[\s\S]*\}/)
  if (!match) return null
  let spec
  try { spec = JSON.parse(match[0]) } catch (_) { return null }
  const cols = Array.isArray(spec?.columns) ? spec.columns.filter((c) => c && c.key) : []
  if (!cols.length) return null
  return {
    title: String(spec.title || 'تقرير مخصص'),
    source: ['ledger', 'expenses', 'items', 'orders'].includes(spec.source) ? spec.source : 'ledger',
    columns: cols.map((c) => ({ key: String(c.key), label: String(c.label || c.key) })),
    filterAccount: spec.filterAccount && ACCOUNTS[spec.filterAccount] ? spec.filterAccount : null,
    filterType: spec.filterType ? String(spec.filterType) : null,
    sortBy: spec.sortBy ? String(spec.sortBy) : null,
    sortDir: spec.sortDir === 'asc' ? 'asc' : 'desc',
    limit: Number.isFinite(Number(spec.limit)) ? Math.max(1, Math.min(1000, Number(spec.limit))) : 200,
  }
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------
const csvCell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// columns: [{ key, label }]. Returns a UTF-8 string; download() adds the BOM so
// Excel opens Arabic correctly instead of showing mojibake.
export function toCsv(rows = [], columns = []) {
  const cols = columns.length ? columns : Object.keys(rows[0] || {}).map((k) => ({ key: k, label: k }))
  const head = cols.map((c) => csvCell(c.label)).join(',')
  const body = (rows || []).map((r) => cols.map((c) => csvCell(r[c.key])).join(',')).join('\r\n')
  return `${head}\r\n${body}`
}

export function toJson(data) {
  return JSON.stringify(data, null, 2)
}

// Browser download with the BOM prefix required by Excel for Arabic CSV.
export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  const isCsv = mime.startsWith('text/csv')
  const blob = new Blob([isCsv ? '﻿' + text : text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsv(filename, rows, columns) {
  downloadText(filename, toCsv(rows, columns), 'text/csv;charset=utf-8')
}
export function downloadJson(filename, data) {
  downloadText(filename, toJson(data), 'application/json;charset=utf-8')
}

// ---------------------------------------------------------------------------
// Period helpers (used by the page's picker; kept here so they stay testable)
// ---------------------------------------------------------------------------
export function periodRange(key, custom = {}) {
  const now = new Date()
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }
  let from
  let to = endOfDay(now)
  switch (key) {
    case 'today': from = startOfDay(now); break
    case 'week': { from = startOfDay(now); from.setDate(from.getDate() - 6); break }
    case 'month': from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)); break
    case 'quarter': from = startOfDay(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)); break
    case 'year': from = startOfDay(new Date(now.getFullYear(), 0, 1)); break
    case 'custom': {
      from = custom.from ? startOfDay(new Date(custom.from)) : startOfDay(new Date(now.getFullYear(), now.getMonth(), 1))
      to = custom.to ? endOfDay(new Date(custom.to)) : endOfDay(now)
      break
    }
    default: from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1))
  }
  if (isNaN(from)) from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1))
  if (isNaN(to)) to = endOfDay(now)
  return { from, to }
}

export const PERIODS = [
  { key: 'today', ar: 'اليوم', en: 'Today' },
  { key: 'week', ar: 'الأسبوع', en: 'Week' },
  { key: 'month', ar: 'الشهر', en: 'Month' },
  { key: 'quarter', ar: 'الربع', en: 'Quarter' },
  { key: 'year', ar: 'السنة', en: 'Year' },
  { key: 'custom', ar: 'مخصص', en: 'Custom' },
]

// Daily revenue/expense/profit series for the dashboard trend chart.
export function dailySeries(ledger = [], from = 0, to = Date.now()) {
  const buckets = new Map()
  const start = new Date(toMs(from)); start.setHours(0, 0, 0, 0)
  const end = new Date(toMs(to) || Date.now()); end.setHours(0, 0, 0, 0)
  // Cap at 120 buckets so a year view stays renderable without a chart library.
  const days = Math.min(120, Math.max(1, Math.round((end - start) / 86400000) + 1))
  const step = Math.max(1, Math.ceil(((end - start) / 86400000 + 1) / days))
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i * step)
    if (d > end) break
    buckets.set(dayKey(d.getTime()), { key: dayKey(d.getTime()), ms: d.getTime(), revenue: 0, expense: 0, profit: 0 })
  }
  const keys = [...buckets.keys()]
  const nearest = (k) => (buckets.has(k) ? k : keys.filter((x) => x <= k).pop() || keys[0])

  ledger.forEach((e) => {
    const k = nearest(dayKey(e.date))
    const b = buckets.get(k)
    if (!b) return
    if (e.account === ACCOUNTS.sales.code) b.revenue = round2(b.revenue + num(e.credit))
    if (e.account === ACCOUNTS.discounts.code) b.revenue = round2(b.revenue - num(e.debit))
    if (e.account === ACCOUNTS.cogs.code || ACCOUNTS[e.account]?.category === 'expense') b.expense = round2(b.expense + num(e.debit))
  })
  const rows = [...buckets.values()]
  rows.forEach((b) => { b.profit = round2(b.revenue - b.expense) })
  return rows
}
