// Measurement units + conversion for raw-material inventory (pure; no deps).
// Each family has ONE base unit; materials store stock in their base unit.

export const UNIT_FAMILIES = {
  mass: { base: 'g', units: { mg: 0.001, g: 1, kg: 1000 } },
  volume: { base: 'ml', units: { ml: 1, cl: 10, l: 1000 } },
  count: { base: 'pc', units: { pc: 1, dozen: 12 } },
}

export const UNIT_META = {
  mg: { ar: 'مليجرام', en: 'mg', family: 'mass' },
  g: { ar: 'جرام', en: 'g', family: 'mass' },
  kg: { ar: 'كيلو', en: 'kg', family: 'mass' },
  ml: { ar: 'مل', en: 'ml', family: 'volume' },
  cl: { ar: 'سنتيلتر', en: 'cl', family: 'volume' },
  l: { ar: 'لتر', en: 'L', family: 'volume' },
  pc: { ar: 'قطعة', en: 'pc', family: 'count' },
  dozen: { ar: 'دزينة', en: 'dozen', family: 'count' },
}

export const BASE_UNITS = ['g', 'ml', 'pc'] // pick one per material
export const unitLabel = (u, lang = 'ar') => (UNIT_META[u] ? (lang === 'ar' ? UNIT_META[u].ar : UNIT_META[u].en) : u)
export const familyOf = (unit) => UNIT_META[unit]?.family || null

// Units that belong to the same family as `baseUnit` (valid purchase/recipe units).
export function unitsForBase(baseUnit) {
  const fam = familyOf(baseUnit)
  return fam ? Object.keys(UNIT_FAMILIES[fam].units) : [baseUnit]
}

// Standard factor (how many base units in 1 `unit`), or null if cross-family / unknown.
export function standardFactor(baseUnit, unit) {
  const fam = familyOf(baseUnit)
  if (!fam || familyOf(unit) !== fam) return null
  return UNIT_FAMILIES[fam].units[unit] ?? null
}

// qty in `unit` → base, using an explicit factor when provided (custom packs like box=24pc).
export function toBase(qty, unit, baseUnit, factor) {
  const f = (factor && factor > 0) ? factor : standardFactor(baseUnit, unit)
  return (Number(qty) || 0) * (f || 1)
}
// qty in base → `unit`.
export function fromBase(qtyBase, unit, baseUnit, factor) {
  const f = (factor && factor > 0) ? factor : standardFactor(baseUnit, unit)
  return f ? (Number(qtyBase) || 0) / f : (Number(qtyBase) || 0)
}

// Pretty base-quantity, auto-scaling g→kg / ml→L when large.
export function fmtBaseQty(qtyBase, baseUnit, lang = 'ar') {
  const n = Number(qtyBase) || 0
  if (baseUnit === 'g' && Math.abs(n) >= 1000) return `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unitLabel('kg', lang)}`
  if (baseUnit === 'ml' && Math.abs(n) >= 1000) return `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unitLabel('l', lang)}`
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unitLabel(baseUnit, lang)}`
}
