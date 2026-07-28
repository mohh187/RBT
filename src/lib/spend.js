// Client side of the server-enforced spend meters (functions/spend.js).
//
// The server is the ONLY authority here: it grants or refuses each send inside
// a transaction, and the counter document is client-write-denied by the rules.
// Everything in this file is DISPLAY — the venue's honest usage meter and the
// console's cross-venue view — plus the two platform-admin writes (the kill
// switch and the budget), which are guarded by firestore.rules, not by this.
//
// SYNC CONTRACT: PLAN_QUOTAS, BURST_PER_MINUTE, BULK_CHANNELS, DAY_FRACTION,
// DAY_FLOOR and UNIT_COST_USD below are a hand-synced mirror of the same names
// in functions/spend.js. That package is CommonJS and bundling it into the
// browser would be wrong, so the numbers are duplicated — and scripts/guard.mjs
// fails the build if the two copies ever disagree. Change BOTH sides together.
import { doc, onSnapshot, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase.js'
import { planExpired } from './plans.js'

export const CHANNELS = [
  { key: 'waUtility', ar: 'واتساب — رسائل المعاملات', short: 'واتساب معاملات', icon: 'mail', hint: 'حالة الطلب وروابط الفواتير' },
  { key: 'waMarketing', ar: 'واتساب — التسويق', short: 'واتساب تسويق', icon: 'sound', hint: 'الحملات والعروض ورسائل الولاء' },
  { key: 'email', ar: 'البريد الإلكتروني', short: 'بريد', icon: 'mail', hint: 'إشعارات الطلبات والفواتير والدعوات' },
  { key: 'aiText', ar: 'الذكاء الاصطناعي — نصوص', short: 'ذكاء نصي', icon: 'sparkles', hint: 'المساعد وتوليد الأوصاف والتحليلات' },
  { key: 'aiImage', ar: 'الذكاء الاصطناعي — صور', short: 'ذكاء صور', icon: 'image', hint: 'توليد صور الأصناف والمنشورات' },
]
export const CHANNEL_KEYS = CHANNELS.map((c) => c.key)

export const PLAN_QUOTAS = {
  menu: { waUtility: 1000, waMarketing: 150, email: 1500, aiText: 300, aiImage: 10 },
  ops: { waUtility: 3000, waMarketing: 400, email: 4000, aiText: 800, aiImage: 25 },
  pro: { waUtility: 6000, waMarketing: 900, email: 10000, aiText: 2000, aiImage: 60 },
  enterprise: { waUtility: 12000, waMarketing: 1300, email: 25000, aiText: 5000, aiImage: 150 },
}
export const BURST_PER_MINUTE = { waUtility: 20, waMarketing: 0, email: 80, aiText: 30, aiImage: 4 }
export const BULK_CHANNELS = ['waMarketing']
const DAY_FRACTION = 6
const DAY_FLOOR = { waUtility: 50, waMarketing: 50, email: 50, aiText: 50, aiImage: 4 }

export const UNIT_COST_USD = {
  waUtility: 0.0107,
  waMarketing: 0.0501,
  email: 0.0004,
  aiText: 0.0018,
  aiImage: 0.039,
}
export const USD_TO_SAR = 3.75

const RIYADH = { timeZone: 'Asia/Riyadh' }
export function periodKey() {
  return new Date().toLocaleDateString('en-CA', RIYADH).slice(0, 7)
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function planIdOf(tenant) {
  const t = tenant || {}
  if (planExpired(t)) return 'menu'
  const id = t.plan || 'enterprise'
  return PLAN_QUOTAS[id] ? id : 'enterprise'
}

// Mirror of limitsFor() in functions/spend.js — used to show the venue the same
// ceiling the server will actually enforce. A meter that displays a different
// number from the one that refuses you is worse than no meter.
export function limitsFor(tenant, channel) {
  const t = tenant || {}
  const rail = PLAN_QUOTAS[planIdOf(t)] || PLAN_QUOTAS.enterprise
  let month = rail[channel]
  if (channel === 'waMarketing') {
    const legacy = num(t.msgCapMonthly)
    if (legacy !== null) month = legacy
  }
  if (channel === 'aiText') {
    const legacy = num(t.aiLimits && t.aiLimits.monthly)
    if (legacy !== null) month = legacy
    month += Math.max(0, num(t.aiExtra) || 0)
  }
  const ov = num(t.spendCaps && t.spendCaps[channel])
  if (ov !== null) month = ov

  if (BULK_CHANNELS.includes(channel)) return { month, day: -1, minute: 0 }

  const dayOv = num(t.spendCapsDaily && t.spendCapsDaily[channel])
  const aiDay = channel === 'aiText' ? num(t.aiLimits && t.aiLimits.daily) : null
  const derived = Math.max(Math.ceil(month / DAY_FRACTION), Math.min(month, DAY_FLOOR[channel] || 50))
  const day = month < 0 ? -1 : (dayOv !== null ? dayOv : (aiDay !== null ? aiDay : Math.max(1, derived)))
  return { month, day, minute: BURST_PER_MINUTE[channel] || 0 }
}

export function costOf(usage, rates) {
  const r = { ...UNIT_COST_USD, ...(rates || {}) }
  let usd = 0
  CHANNEL_KEYS.forEach((c) => { usd += (Number(usage?.[c]) || 0) * (Number(r[c]) || 0) })
  return { usd: Math.round(usd * 10000) / 10000, sar: Math.round(usd * USD_TO_SAR * 100) / 100 }
}

// ------------------------------- venue side -------------------------------
// One venue's own month. Shape written by functions/spend.js:
//   { period, m: {channel: n}, d: {day, channel: n}, b: {minute, …},
//     blocked: {channel: n}, blockedReason: {channel: 'cap'|'daily'|'burst'} }
function normalizeUsage(data, period) {
  const d = data || {}
  const m = d.m || {}
  const day = d.d || {}
  const out = { period, blocked: d.blocked || {}, blockedReason: d.blockedReason || {}, today: {} }
  CHANNEL_KEYS.forEach((c) => {
    out[c] = Math.max(0, Number(m[c]) || 0)
    out.today[c] = Math.max(0, Number(day[c]) || 0)
  })
  return out
}

export function watchVenueSpend(tid, cb, period) {
  const p = period || periodKey()
  if (!tid) { cb(normalizeUsage(null, p)); return () => {} }
  return onSnapshot(
    doc(db, `tenants/${tid}/counters`, `spend-${p}`),
    (s) => cb(normalizeUsage(s.exists() ? s.data() : null, p)),
    // A read failure must render an empty meter, not a spinner that never ends
    // (the systemic stuck-spinner bug this codebase already paid for once).
    () => cb(normalizeUsage(null, p)),
  )
}

// ----------------------------- platform side ------------------------------
const CONTROLS = () => doc(db, 'platformConfig', 'spendControls')

export const DEFAULT_CONTROLS = {
  killAll: false,
  channels: {},
  unitCostUsd: UNIT_COST_USD,
  monthlyBudgetUsd: 0,
  budgetAction: 'warn',
}

function normalizeControls(data) {
  const d = data || {}
  return {
    killAll: d.killAll === true,
    channels: d.channels && typeof d.channels === 'object' ? d.channels : {},
    unitCostUsd: { ...UNIT_COST_USD, ...(d.unitCostUsd || {}) },
    monthlyBudgetUsd: Math.max(0, num(d.monthlyBudgetUsd) || 0),
    budgetAction: d.budgetAction || 'warn',
    budgetFired: d.budgetFired || null,
    updatedAt: d.updatedAt || null,
  }
}

export function watchSpendControls(cb) {
  return onSnapshot(
    CONTROLS(),
    (s) => cb(normalizeControls(s.exists() ? s.data() : null)),
    () => cb(normalizeControls(null)),
  )
}

export async function getSpendControls() {
  const s = await getDoc(CONTROLS()).catch(() => null)
  return normalizeControls(s && s.exists() ? s.data() : null)
}

// The kill switch takes effect within a minute — functions/spend.js caches this
// document for 60 seconds so a campaign does not re-read it per message.
export async function saveSpendControls(patch) {
  await setDoc(CONTROLS(), { ...patch, updatedAt: serverTimestamp() }, { merge: true })
}

// The cross-venue rollup, rebuilt every two hours by exports.spendRollup.
// Deliberately NOT written per send: one global counter taking every increment
// on the platform is a single document at Firestore's ~1 write/second ceiling.
function normalizeRollup(data, period) {
  const d = data || {}
  const totals = {}
  const blockedTotals = {}
  CHANNEL_KEYS.forEach((c) => {
    totals[c] = Math.max(0, Number(d.totals?.[c]) || 0)
    blockedTotals[c] = Math.max(0, Number(d.blockedTotals?.[c]) || 0)
  })
  const byTenant = d.byTenant && typeof d.byTenant === 'object' ? d.byTenant : {}
  return {
    period,
    exists: !!d.at,
    tenants: Number(d.tenants) || 0,
    spendingTenants: Number(d.spendingTenants) || 0,
    totals,
    blockedTotals,
    totalUsd: Number(d.totalUsd) || 0,
    totalSar: Number(d.totalSar) || 0,
    budgetUsd: Number(d.budgetUsd) || 0,
    budgetPct: Number(d.budgetPct) || 0,
    rates: { ...UNIT_COST_USD, ...(d.rates || {}) },
    at: d.at || null,
    rows: Object.entries(byTenant)
      .map(([id, r]) => ({ id, ...r }))
      .sort((a, b) => (Number(b.usd) || 0) - (Number(a.usd) || 0)),
  }
}

export function watchSpendRollup(cb, period) {
  const p = period || periodKey()
  return onSnapshot(
    doc(db, 'platformStats', `spend-${p}`),
    (s) => cb(normalizeRollup(s.exists() ? s.data() : null, p)),
    () => cb(normalizeRollup(null, p)),
  )
}

// The last N month keys, newest first — the console's period picker.
export function recentPeriods(n = 6) {
  const out = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}
