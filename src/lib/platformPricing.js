// Browser mirror of functions/platformPricing.js — DISPLAY ONLY.
//
// Every price that is actually charged is derived on the server
// (`resolvePlanPrice` there, called by both the monthly cron and self-signup).
// This copy exists so a pricing page or a quotation preview can render before
// a document exists, and it is never trusted for an amount.
//
// SYNC CONTRACT: FALLBACK_PRICES and FALLBACK_LIST_PRICES are a hand-synced
// mirror. scripts/guard.mjs fails the build if they drift — a page that shows
// one price while the invoice charges another is a complaint, not a bug report.
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase.js'

export const FALLBACK_PRICES = { menu: 99, ops: 199, pro: 349, enterprise: 549 }
export const FALLBACK_LIST_PRICES = { menu: 149, ops: 299, pro: 499, enterprise: 1299 }
export const YEARLY_DISCOUNT = 0.8

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

// Merge the console's platformConfig/plans over the fallbacks.
export function normalizePlanConfig(data) {
  const d = data || {}
  const merge = (base, over) => {
    const out = { ...base }
    Object.keys(base).forEach((k) => {
      const v = num(over && over[k])
      if (v !== null) out[k] = v
    })
    return out
  }
  return {
    prices: merge(FALLBACK_PRICES, d.prices),
    listPrices: merge(FALLBACK_LIST_PRICES, d.listPrices),
    promo: d.promo && typeof d.promo === 'object' ? d.promo : null,
    currency: d.currency || 'SAR',
    vatMode: d.vatMode === 'inclusive' ? 'inclusive' : 'exclusive',
    yearlyDiscount: num(d.yearlyDiscount) !== null ? num(d.yearlyDiscount) : YEARLY_DISCOUNT,
  }
}

// The struck-through "before" price, or null. Three conditions, all required:
// a higher list price exists, the promo is on, and it has not expired.
// Mirror of promoOf() in functions/platformPricing.js.
export function promoOf(planId, cfg) {
  const p = cfg && cfg.promo
  if (!p || p.active !== true) return null
  const until = Number(p.validUntil) || 0
  if (until && Date.now() > until) return null
  const list = Number(cfg.listPrices && cfg.listPrices[planId])
  const price = Number(cfg.prices && cfg.prices[planId])
  if (!Number.isFinite(list) || !Number.isFinite(price) || list <= price) return null
  return {
    listPrice: list,
    price,
    discount: Math.round((list - price) * 100) / 100,
    discountPct: Math.round(((list - price) / list) * 100),
    labelAr: p.labelAr || 'خصم',
    validUntil: until || null,
  }
}

// Live subscription to the ONE price list — platformConfig/plans, the same
// document the monthly billing cron and the quotation builder read.
//
// WHY THE PUBLIC LANDING READS IT DIRECTLY. The page used to print a second
// table kept in src/lib/plans.js. Two tables is how a landing ends up
// advertising 549 while the invoice charges 899, and nobody notices until a
// customer forwards the screenshot. A price list is public information by
// definition — it is printed on the marketing page either way — so the doc
// carries a public-read rule and the page reads the real thing.
//
// The error callback paints the fallbacks rather than leaving a blank price:
// a pricing section that renders nothing is worse than one that renders the
// shipped defaults, and the server is still the only thing that charges.
export function watchPricing(cb) {
  return onSnapshot(
    doc(db, 'platformConfig', 'plans'),
    (s) => cb(normalizePlanConfig(s.exists() ? s.data() : null)),
    () => cb(normalizePlanConfig(null)),
  )
}

// What a plan costs for a whole year, paid up front. Derived — never a second
// stored field, because two independently editable prices for one plan is
// precisely how they drift apart.
export const yearlyTotal = (monthly, cfg) =>
  Math.round(Number(monthly || 0) * 12 * (Number(cfg && cfg.yearlyDiscount) || YEARLY_DISCOUNT))
