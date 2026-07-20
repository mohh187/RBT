// Pure forecasting + advisory math for RBT360.
// NO Firestore, NO React, NO AI — every function takes documents the caller has
// already loaded and returns plain data. When the data cannot support an answer
// these functions return null / status 'unknown' instead of guessing: a made-up
// number is worse than an honest gap. Latin digits only.

const DAY_MS = 86400000

export const WEEKDAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
export const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Orders that never happened commercially (no revenue, no consumption).
const DEAD_STATUS = new Set(['cancelled', 'awaiting_payment'])
// Orders whose stock/materials were actually consumed.
const SETTLED_STATUS = new Set(['paid', 'served', 'refunded'])

// ---------- small helpers ----------
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const r1 = (v) => Math.round(v * 10) / 10
const r2 = (v) => Math.round(v * 100) / 100
const r3 = (v) => Math.round(v * 1000) / 1000
const pad2 = (n) => String(n).padStart(2, '0')
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export function hourLabel(h) { return `${pad2(h)}:00` }

// Arabic counted nouns: 1 / 2 / 3-10 (plural) / 11+ (singular tamyeez).
// Without this, generated advice reads like machine output ("3 طلب").
export function arPlural(n, { one, two, few, many }) {
  const v = Math.abs(num(n))
  if (v === 1) return `${n} ${one}`
  if (v === 2) return `${n} ${two}`
  if (v === 0 || (v >= 3 && v <= 10)) return `${n} ${few}` // "0 طلبات", not "0 طلباً"
  return `${n} ${many}`
}
const nOrders = (n) => arPlural(n, { one: 'طلب', two: 'طلبان', few: 'طلبات', many: 'طلباً' })
const nUnits = (n) => arPlural(n, { one: 'وحدة', two: 'وحدتان', few: 'وحدات', many: 'وحدة' })
const nDays = (n) => arPlural(n, { one: 'يوم', two: 'يومان', few: 'أيام', many: 'يوماً' })

// A discount the margin can absorb is not automatically a discount worth making:
// deep cuts train guests to wait for them. Suggestions stay at or below this,
// while the TRUE headroom is still reported so the manager can go further.
const SUGGEST_MAX_PCT = 30

function median(list) {
  const s = list.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b)
  if (!s.length) return 0
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Firestore Timestamp | Date | ms → Date | null. Never throws on a partial doc.
export function orderDate(o) {
  if (!o) return null
  const c = o.createdAt
  if (c && typeof c.toDate === 'function') return c.toDate()
  if (c && typeof c.toMillis === 'function') return new Date(c.toMillis())
  if (c instanceof Date) return c
  if (typeof c === 'number' && c > 0) return new Date(c)
  if (typeof o.createdAtMs === 'number' && o.createdAtMs > 0) return new Date(o.createdAtMs)
  if (typeof o.paidAtMs === 'number' && o.paidAtMs > 0) return new Date(o.paidAtMs)
  return null
}

export function countsAsSale(o) { return !!o && !DEAD_STATUS.has(o.status) }
export function isSettled(o) { return !!o && SETTLED_STATUS.has(o.status) }

// Revenue actually kept (refunds subtracted).
export function netTotal(o) {
  if (!o) return 0
  const gross = num(o.total)
  return o.status === 'refunded' ? Math.max(0, gross - num(o.refund?.amount)) : gross
}

// Midnight, `days` days back — a whole-day window so per-day rates are honest.
export function windowStart(days, now = new Date()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return new Date(d.getTime() - (Math.max(1, num(days) || 1) - 1) * DAY_MS)
}

// Sample size is the only honest source of confidence. Small windows lie.
export function confidenceFor(sampleOrders) {
  const n = num(sampleOrders)
  if (n < 20) return 'low'
  if (n < 60) return 'medium'
  return 'high'
}

function ordersInWindow(orders, days, now, filter) {
  const from = windowStart(days, now)
  const out = []
  for (const o of orders || []) {
    if (filter && !filter(o)) continue
    const d = orderDate(o)
    if (d && d >= from && d <= now) out.push(o)
  }
  return out
}

// Cost of one unit of an item from its recipe × each material's avgCost.
// Returns 0 when the item has no recipe — the caller must treat 0 as "unknown",
// never as "free".
export function recipeCost(item, materialsById, variantKey) {
  if (!item) return 0
  const lines = (variantKey && item.variantRecipes?.[variantKey]) || item.recipe || []
  let c = 0
  for (const l of lines) {
    const m = materialsById.get?.(l.materialId) || materialsById[l.materialId]
    if (m) c += num(m.avgCost) * num(l.qty)
  }
  return c
}

// ---------- A1. sales velocity ----------
// Units/day per itemId over the window. Pass `items` to also get per-material
// consumption derived from the recipes those items actually carry.
export function salesVelocity(orders, { days = 30, items = null, now = new Date() } = {}) {
  const d = Math.max(1, num(days) || 30)
  const list = ordersInWindow(orders, d, now, countsAsSale)
  const byItem = {}
  for (const o of list) {
    for (const l of o.items || []) {
      const key = l.itemId || `name:${l.nameAr || l.nameEn || 'unknown'}`
      const qty = num(l.qty) || 1
      const line = num(l.lineTotal) || num(l.unitPrice) * qty
      let rec = byItem[key]
      if (!rec) {
        rec = { itemId: l.itemId || null, name: l.nameAr || l.nameEn || '', units: 0, revenue: 0, orders: 0, perDay: 0 }
        byItem[key] = rec
      }
      rec.units += qty
      rec.revenue += line
      rec.orders += 1
    }
  }
  for (const rec of Object.values(byItem)) {
    rec.perDay = r3(rec.units / d)
    rec.revenue = r2(rec.revenue)
  }

  let byMaterial = null
  let usageMeta = null
  if (items) {
    const settled = list.filter(isSettled)
    const { usage, ...meta } = materialUsage(settled, items)
    usageMeta = { ...meta, settledOrders: settled.length }
    byMaterial = {}
    for (const [mid, qty] of Object.entries(usage)) {
      byMaterial[mid] = { materialId: mid, used: r3(qty), perDay: r3(qty / d) }
    }
  }

  return {
    days: d,
    from: windowStart(d, now),
    to: now,
    sampleOrders: list.length,
    byItem,
    byMaterial,
    usageMeta,
    confidence: confidenceFor(list.length),
  }
}

// Real material consumption for a set of orders. Prefers `order.materialUsage`
// (the snapshot consumeForOrder() wrote at settle time — the ground truth) and
// only falls back to re-deriving from the item recipes when it is absent.
export function materialUsage(orders, items) {
  const byId = new Map()
  for (const i of items || []) byId.set(i.id, i)
  const usage = {}
  let recorded = 0
  let derived = 0
  let noSignal = 0
  for (const o of orders || []) {
    if (o.materialUsage && typeof o.materialUsage === 'object') {
      recorded += 1
      for (const [mid, q] of Object.entries(o.materialUsage)) {
        const v = num(q)
        if (v > 0) usage[mid] = (usage[mid] || 0) + v
      }
      continue
    }
    let touched = false
    const add = (lines, qty) => {
      for (const r of lines || []) {
        if (!r.materialId) continue
        usage[r.materialId] = (usage[r.materialId] || 0) + num(r.qty) * qty
        touched = true
      }
    }
    for (const l of o.items || []) {
      const it = byId.get(l.itemId)
      const qty = num(l.qty) || 1
      if (it && it.stockMode === 'recipe') add((l.variantKey && it.variantRecipes?.[l.variantKey]) || it.recipe || [], qty)
      for (const mod of l.modifiers || []) add(mod.recipe, qty)
    }
    if (touched) derived += 1
    else noSignal += 1
  }
  return { usage, ordersWithRecordedUsage: recorded, ordersWithDerivedUsage: derived, ordersWithNoUsageSignal: noSignal }
}

// ---------- A2. stock runway ----------
// Per material: how long the shelf lasts at the consumption rate actually seen
// in settled orders. status 'unknown' means we measured NO consumption — it is
// not a prediction of "fine", it is an admission that we cannot tell.
export function stockRunway({ materials = [], orders = [], items = [], days = 30, now = new Date(), coverDays = 14 } = {}) {
  const d = Math.max(1, num(days) || 30)
  const settled = ordersInWindow(orders, d, now, isSettled)
  const { usage, ...meta } = materialUsage(settled, items)

  const rows = (materials || []).map((m) => {
    const used = num(usage[m.id])
    const perDay = used / d
    const stockQty = num(m.stockQty)
    const parLevel = num(m.parLevel)
    const reorderLevel = num(m.reorderLevel)
    const belowReorder = reorderLevel > 0 && stockQty <= reorderLevel

    let daysLeft = null
    let runsOutOn = null
    let status = 'unknown'
    if (perDay > 0) {
      daysLeft = stockQty > 0 ? stockQty / perDay : 0
      runsOutOn = new Date(now.getTime() + daysLeft * DAY_MS)
      status = daysLeft < 3 ? 'critical' : daysLeft < 7 ? 'soon' : 'ok'
    }

    let suggestedOrderQty = null
    let suggestedBasis = 'none'
    if (parLevel > 0 && stockQty < parLevel) {
      suggestedOrderQty = r2(parLevel - stockQty)
      suggestedBasis = 'par'
    } else if (perDay > 0 && daysLeft !== null && daysLeft < coverDays) {
      suggestedOrderQty = r2(perDay * coverDays - stockQty)
      suggestedBasis = 'coverage'
    } else if (belowReorder && perDay <= 0) {
      suggestedOrderQty = reorderLevel > 0 ? r2(reorderLevel) : null
      suggestedBasis = 'reorder'
    }

    const note = perDay > 0
      ? `استهلاك ${r2(perDay)} ${m.baseUnit || ''}/يوم محسوب من ${nOrders(settled.length)} خلال ${nDays(d)}`
      : `لا يوجد استهلاك مسجّل خلال ${nDays(d)} — لا يمكن حساب مدة النفاد`

    return {
      id: m.id,
      name: m.nameAr || m.nameEn || m.name || '',
      unit: m.baseUnit || m.unit || '',
      stockQty: r2(stockQty),
      avgCost: r2(num(m.avgCost)),
      stockValue: r2(stockQty * num(m.avgCost)),
      used: r2(used),
      perDay: r3(perDay),
      daysLeft: daysLeft === null ? null : r1(daysLeft),
      runsOutOn,
      status,
      belowReorder,
      reorderLevel,
      parLevel,
      suggestedOrderQty,
      suggestedBasis,
      note,
    }
  })

  const rank = { critical: 0, soon: 1, unknown: 2, ok: 3 }
  rows.sort((a, b) => (rank[a.status] - rank[b.status]) || ((a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9)))

  return {
    days: d,
    settledOrders: settled.length,
    materials: rows,
    counts: {
      critical: rows.filter((x) => x.status === 'critical').length,
      soon: rows.filter((x) => x.status === 'soon').length,
      ok: rows.filter((x) => x.status === 'ok').length,
      unknown: rows.filter((x) => x.status === 'unknown').length,
    },
    usageMeta: meta,
    confidence: confidenceFor(settled.length),
  }
}

// ---------- A3. peak windows ----------
// A real weekday x hour histogram. "Quiet" is only computed over hours/weekdays
// the venue was demonstrably open (had at least one order) — recommending a
// happy hour at 04:00 because nothing sold then would be nonsense.
export function peakWindows(orders, { days = 30, now = new Date(), top = 6 } = {}) {
  const d = Math.max(1, num(days) || 30)
  const list = ordersInWindow(orders, d, now, countsAsSale)

  const grid = new Map()
  const byHour = Array.from({ length: 24 }, () => ({ orders: 0, revenue: 0 }))
  const byWeekday = Array.from({ length: 7 }, () => ({ orders: 0, revenue: 0 }))
  const daysSeen = new Set()

  for (const o of list) {
    const dt = orderDate(o)
    if (!dt) continue
    const wd = dt.getDay()
    const hr = dt.getHours()
    const rev = netTotal(o)
    const key = `${wd}-${hr}`
    const cur = grid.get(key) || { weekday: wd, hour: hr, orders: 0, revenue: 0 }
    cur.orders += 1
    cur.revenue += rev
    grid.set(key, cur)
    byHour[hr].orders += 1
    byHour[hr].revenue += rev
    byWeekday[wd].orders += 1
    byWeekday[wd].revenue += rev
    daysSeen.add(`${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`)
  }

  const openHours = byHour.map((v, h) => (v.orders > 0 ? h : -1)).filter((h) => h >= 0)
  const openWeekdays = byWeekday.map((v, w) => (v.orders > 0 ? w : -1)).filter((w) => w >= 0)
  const weeksCovered = Math.max(1, d / 7)

  // Full grid across the open hours/weekdays only — a zero inside opening time
  // is real information; a zero outside it is just "closed".
  const buckets = []
  for (const wd of openWeekdays) {
    for (const hr of openHours) {
      const cur = grid.get(`${wd}-${hr}`)
      buckets.push({
        weekday: wd,
        hour: hr,
        label: `${WEEKDAYS_AR[wd]} ${hourLabel(hr)}`,
        orders: cur ? cur.orders : 0,
        revenue: cur ? r2(cur.revenue) : 0,
        ordersPerWeek: r1((cur ? cur.orders : 0) / weeksCovered),
      })
    }
  }

  const byOrdersDesc = buckets.slice().sort((a, b) => b.orders - a.orders || b.revenue - a.revenue)
  const byOrdersAsc = buckets.slice().sort((a, b) => a.orders - b.orders || a.revenue - b.revenue)

  return {
    days: d,
    sampleOrders: list.length,
    daysWithOrders: daysSeen.size,
    weeksCovered: r1(weeksCovered),
    buckets,
    busiest: byOrdersDesc.slice(0, top),
    quiet: byOrdersAsc.slice(0, top),
    openHours,
    openWeekdays,
    byHour: byHour.map((v, h) => ({ hour: h, orders: v.orders, revenue: r2(v.revenue) })),
    byWeekday: byWeekday.map((v, w) => ({ weekday: w, name: WEEKDAYS_AR[w], orders: v.orders, revenue: r2(v.revenue) })),
    confidence: confidenceFor(list.length),
  }
}

// ---------- A4. offer advice ----------
// Rule-based and fully explainable. Every suggestion carries the figures it was
// derived from so a human (or the AI layer) can check the reasoning.
export function offerAdvice({
  orders = [], items = [], materials = [], offers = [],
  days = 30, now = new Date(), marginFloorPct = 15,
} = {}) {
  const d = Math.max(1, num(days) || 30)
  const matById = new Map((materials || []).map((m) => [m.id, m]))
  const itemById = new Map((items || []).map((i) => [i.id, i]))
  const vel = salesVelocity(orders, { days: d, items, now })
  const peaks = peakWindows(orders, { days: d, now })
  const runway = stockRunway({ materials, orders, items, days: d, now })
  const sample = vel.sampleOrders
  const baseConfidence = confidenceFor(sample)

  // Items already covered by an active offer — do not suggest stacking on them.
  const covered = new Set()
  for (const o of offers || []) {
    if (o?.active === false) continue
    if (o?.scope === 'item' && o.itemId) covered.add(o.itemId)
  }

  const suggestions = []
  const unitsOf = (id) => num(vel.byItem[id]?.units)

  // (1) Slow movers that can afford a discount.
  const priced = (items || []).filter((i) => num(i.price) > 0)
  const withCost = priced.map((i) => {
    const cost = recipeCost(i, matById)
    const price = num(i.price)
    return { item: i, price, cost, hasCost: cost > 0, units: unitsOf(i.id) }
  })
  const medianUnits = median(withCost.map((x) => x.units))
  const slowCut = Math.max(1, medianUnits * 0.5)
  const discountable = withCost
    .filter((x) => x.hasCost && !covered.has(x.item.id) && x.units <= slowCut)
    .map((x) => {
      const marginPct = ((x.price - x.cost) / x.price) * 100
      const floor = clamp(num(marginFloorPct), 0, 90) / 100
      // Keep margin above the floor: p*(1-v) - c >= floor * p*(1-v)
      const maxDiscountPct = Math.floor(100 * (1 - x.cost / ((1 - floor) * x.price)))
      return { ...x, marginPct: Math.round(marginPct), maxDiscountPct }
    })
    .filter((x) => x.marginPct >= 40 && x.maxDiscountPct >= 10)
    .sort((a, b) => a.units - b.units)
    .slice(0, 3)

  for (const c of discountable) {
    const ceiling = Math.min(c.maxDiscountPct, SUGGEST_MAX_PCT)
    const suggestedValue = clamp(Math.floor((ceiling * 0.7) / 5) * 5, 5, ceiling)
    suggestions.push({
      id: `slow-${c.item.id}`,
      kind: 'slow-mover',
      title: `خصم على «${c.item.nameAr || c.item.nameEn || ''}»`,
      why: `بيع ${nUnits(c.units)} فقط في ${nDays(d)} · الهامش الحالي ${c.marginPct}% · يحتمل الصنف خصماً حتى ${c.maxDiscountPct}% مع بقاء الهامش فوق ${marginFloorPct}%، والمقترح ${suggestedValue}% تفادياً لتعويد الضيوف على التخفيض`,
      numbers: {
        'الوحدات المباعة': `${nUnits(c.units)} خلال ${nDays(d)}`,
        'وسيط مبيعات المنيو': `${r1(medianUnits)} وحدة`,
        'سعر البيع': r2(c.price),
        'تكلفة الوصفة': r2(c.cost),
        'الهامش الحالي': `${c.marginPct}%`,
        'أقصى خصم يبقي الهامش آمناً': `${c.maxDiscountPct}%`,
        'الخصم المقترح': `${suggestedValue}%`,
      },
      suggestedType: 'percent',
      suggestedValue,
      suggestedScope: 'item',
      itemIds: [c.item.id],
      suggestedWindow: null,
      confidence: sample < 20 ? 'low' : c.units === 0 && sample < 60 ? 'medium' : baseConfidence,
    })
  }

  // (2) The quiet window a happy-hour offer should target.
  if (peaks.quiet.length && peaks.busiest.length && peaks.sampleOrders > 0) {
    const q = peaks.quiet[0]
    const b = peaks.busiest[0]
    // A 1-vs-0 difference is noise, not a quiet hour. Require a peak with real
    // volume AND a real gap before telling anyone to discount a time slot.
    if (b.orders >= 3 && b.orders - q.orders >= 2) {
      const endHour = Math.min(23, q.hour + 2)
      suggestions.push({
        id: `quiet-${q.weekday}-${q.hour}`,
        kind: 'happy-hour',
        title: `عرض «ساعة هادئة» — ${WEEKDAYS_AR[q.weekday]} ${hourLabel(q.hour)}`,
        why: `أهدأ فترة عمل: ${WEEKDAYS_AR[q.weekday]} ${hourLabel(q.hour)} بـ ${nOrders(q.orders)} خلال ${nDays(d)}، مقابل ${nOrders(b.orders)} في الذروة (${WEEKDAYS_AR[b.weekday]} ${hourLabel(b.hour)})`,
        numbers: {
          'طلبات الفترة الهادئة': `${nOrders(q.orders)} (${q.ordersPerWeek} أسبوعياً)`,
          'طلبات فترة الذروة': `${nOrders(b.orders)} (${b.ordersPerWeek} أسبوعياً)`,
          'إيراد الفترة الهادئة': r2(q.revenue),
          'ساعات العمل المرصودة': `${peaks.openHours.length} ساعة`,
          'أيام فيها طلبات': `${peaks.daysWithOrders} من ${d}`,
        },
        suggestedType: 'percent',
        suggestedValue: 15,
        suggestedScope: 'cart',
        itemIds: [],
        suggestedWindow: { daysOfWeek: [q.weekday], startTime: hourLabel(q.hour), endTime: hourLabel(endHour) },
        confidence: peaks.daysWithOrders < 7 ? 'low' : baseConfidence,
      })
    }
  }

  // (3) Overstock / expiry risk — move it before it spoils.
  const stale = (runway.materials || [])
    .filter((m) => m.stockQty > 0 && (m.daysLeft === null || m.daysLeft > 45))
    .sort((a, b) => b.stockValue - a.stockValue)
    .slice(0, 2)
  for (const m of stale) {
    const users = (items || []).filter((i) => (i.recipe || []).some((l) => l.materialId === m.id) && !covered.has(i.id))
    if (!users.length) continue
    const known = m.daysLeft !== null
    suggestions.push({
      id: `overstock-${m.id}`,
      kind: 'overstock',
      title: `حرّك مخزون «${m.name}»`,
      why: known
        ? `المخزون ${m.stockQty} ${m.unit} يكفي ${nDays(m.daysLeft)} بمعدل ${m.perDay}/يوم · قيمة راكدة ${m.stockValue}`
        : `المخزون ${m.stockQty} ${m.unit} بقيمة ${m.stockValue}، ولا يوجد استهلاك مسجّل خلال ${nDays(d)} — يُرجّح الركود أو نقص في تسجيل الوصفات`,
      numbers: {
        'الكمية الحالية': `${m.stockQty} ${m.unit}`,
        'قيمة المخزون': r2(m.stockValue),
        'الاستهلاك اليومي': known ? `${m.perDay} ${m.unit}` : 'غير مرصود',
        'مدة التغطية': known ? nDays(m.daysLeft) : 'غير محسوبة',
        'أصناف تستهلكه': `${users.length}`,
      },
      suggestedType: 'percent',
      suggestedValue: 20,
      suggestedScope: 'item',
      itemIds: users.slice(0, 4).map((i) => i.id),
      suggestedWindow: null,
      confidence: known ? (baseConfidence === 'high' ? 'medium' : baseConfidence) : 'low',
    })
  }

  // (4) Pairings from actual co-occurrence in the same order.
  const inWin = ordersInWindow(orders, d, now, countsAsSale)
  const pairs = new Map()
  for (const o of inWin) {
    const ids = [...new Set((o.items || []).map((l) => l.itemId).filter(Boolean))].sort()
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = `${ids[i]}|${ids[j]}`
        pairs.set(k, (pairs.get(k) || 0) + 1)
      }
    }
  }
  const topPairs = [...pairs.entries()]
    .map(([k, count]) => ({ ids: k.split('|'), count }))
    .filter((p) => p.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
  for (const p of topPairs) {
    const a = itemById.get(p.ids[0])
    const b = itemById.get(p.ids[1])
    if (!a || !b) continue
    const pct = sample ? Math.round((p.count / sample) * 100) : 0
    suggestions.push({
      id: `pair-${p.ids.join('-')}`,
      kind: 'pairing',
      title: `باقة «${a.nameAr || a.nameEn || ''}» + «${b.nameAr || b.nameEn || ''}»`,
      why: `طُلبا معاً في ${nOrders(p.count)} من ${sample} خلال ${nDays(d)} (${pct}% من الطلبات) — الباقة تثبّت هذا السلوك وترفع قيمة الفاتورة`,
      numbers: {
        'مرات الطلب معاً': `${p.count}`,
        'إجمالي الطلبات في النافذة': `${sample}`,
        'نسبة التلازم': `${pct}%`,
        'مبيعات الصنف الأول': nUnits(unitsOf(a.id)),
        'مبيعات الصنف الثاني': nUnits(unitsOf(b.id)),
      },
      suggestedType: 'percent',
      suggestedValue: 10,
      suggestedScope: 'item',
      itemIds: [a.id, b.id],
      suggestedWindow: null,
      confidence: p.count >= 10 ? 'high' : p.count >= 5 ? 'medium' : 'low',
    })
  }

  return {
    days: d,
    generatedAt: now,
    sample: {
      orders: sample,
      items: (items || []).length,
      materials: (materials || []).length,
      offers: (offers || []).length,
      daysWithOrders: peaks.daysWithOrders,
      itemsWithRecipeCost: withCost.filter((x) => x.hasCost).length,
    },
    confidence: baseConfidence,
    limits: sample < 20
      ? `العينة صغيرة (${nOrders(sample)} خلال ${nDays(d)}) — التوصيات إرشادية ولا تصلح كقرار نهائي`
      : '',
    suggestions,
    // A compact, already-computed snapshot. Anything shown to an AI layer must
    // come from HERE so the model reasons over real figures instead of inventing.
    snapshot: {
      windowDays: d,
      ordersInWindow: sample,
      daysWithOrders: peaks.daysWithOrders,
      topSellers: Object.values(vel.byItem).sort((a, b) => b.units - a.units).slice(0, 8)
        .map((x) => ({ name: x.name, units: x.units, perDay: x.perDay, revenue: x.revenue })),
      slowSellers: Object.values(vel.byItem).sort((a, b) => a.units - b.units).slice(0, 8)
        .map((x) => ({ name: x.name, units: x.units, revenue: x.revenue })),
      busiestWindows: peaks.busiest.map((x) => ({ when: x.label, orders: x.orders, revenue: x.revenue })),
      quietWindows: peaks.quiet.map((x) => ({ when: x.label, orders: x.orders, revenue: x.revenue })),
      stockAtRisk: (runway.materials || []).filter((m) => m.status === 'critical' || m.status === 'soon')
        .map((m) => ({ name: m.name, qty: m.stockQty, unit: m.unit, daysLeft: m.daysLeft })),
      overstock: stale.map((m) => ({ name: m.name, qty: m.stockQty, unit: m.unit, value: m.stockValue, daysLeft: m.daysLeft })),
      activeOffers: (offers || []).filter((o) => o?.active !== false)
        .map((o) => ({ name: o.nameAr || o.nameEn || '', type: o.type, value: num(o.value), scope: o.scope })),
      ruleSuggestions: suggestions.map((s) => ({ title: s.title, why: s.why, value: s.suggestedValue, confidence: s.confidence })),
    },
  }
}

// ---------- A5. customer year in review ----------
// `orders` should be the venue's orders for the year (not pre-filtered) so the
// customer can be ranked against the rest; passing only their own orders still
// works but then `rank` is returned as null instead of a fake "top 1%".
const phoneKey = (p) => String(p || '').replace(/\D/g, '').slice(-9)

export function customerYear({ orders = [], customer = null, year = new Date().getFullYear() } = {}) {
  const y = num(year) || new Date().getFullYear()
  const key = phoneKey(customer?.phone)
  const inYear = (orders || []).filter((o) => {
    if (!countsAsSale(o)) return false
    const d = orderDate(o)
    return d && d.getFullYear() === y
  })

  const mine = key ? inYear.filter((o) => phoneKey(o.customerPhone) === key) : []
  const empty = {
    year: y, hasData: false, visits: mine.length, totalSpent: 0, avgTicket: 0,
    favouriteItem: null, favouriteDay: null, favouriteHour: null,
    firstVisit: null, lastVisit: null, longestStreak: 0, longestWeekStreak: 0,
    distinctItems: 0, biggestOrder: null, byMonth: Array.from({ length: 12 }, () => 0),
    rank: null, milestones: [], venueOrdersInYear: inYear.length,
  }
  if (!key || !mine.length) return empty

  const dated = mine
    .map((o) => ({ o, d: orderDate(o) }))
    .filter((x) => x.d)
    .sort((a, b) => a.d - b.d)
  if (!dated.length) return empty

  const totalSpent = mine.reduce((s, o) => s + netTotal(o), 0)
  const visits = dated.length

  // favourite dish
  const itemCount = new Map()
  for (const { o } of dated) {
    for (const l of o.items || []) {
      const id = l.itemId || `name:${l.nameAr || l.nameEn || ''}`
      const cur = itemCount.get(id) || { itemId: l.itemId || null, name: l.nameAr || l.nameEn || '', count: 0 }
      cur.count += num(l.qty) || 1
      itemCount.set(id, cur)
    }
  }
  const topItems = [...itemCount.values()].sort((a, b) => b.count - a.count)
  const favouriteItem = topItems[0] && topItems[0].count > 0 ? topItems[0] : null

  // favourite day / hour
  const dayCount = Array.from({ length: 7 }, () => 0)
  const hourCount = Array.from({ length: 24 }, () => 0)
  const byMonth = Array.from({ length: 12 }, () => 0)
  const dayKeys = new Set()
  for (const { d } of dated) {
    dayCount[d.getDay()] += 1
    hourCount[d.getHours()] += 1
    byMonth[d.getMonth()] += 1
    dayKeys.add(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`)
  }
  const bestDayIdx = dayCount.indexOf(Math.max(...dayCount))
  const bestHourIdx = hourCount.indexOf(Math.max(...hourCount))
  const favouriteDay = dayCount[bestDayIdx] > 0 ? { weekday: bestDayIdx, name: WEEKDAYS_AR[bestDayIdx], count: dayCount[bestDayIdx] } : null
  const favouriteHour = hourCount[bestHourIdx] > 0 ? { hour: bestHourIdx, label: hourLabel(bestHourIdx), count: hourCount[bestHourIdx] } : null

  // streaks: consecutive calendar days visited, and consecutive ISO-ish weeks
  const sortedDays = [...dayKeys].sort()
  let longestStreak = 1
  let run = 1
  for (let i = 1; i < sortedDays.length; i++) {
    const prev = new Date(sortedDays[i - 1])
    const cur = new Date(sortedDays[i])
    const gap = Math.round((cur - prev) / DAY_MS)
    run = gap === 1 ? run + 1 : 1
    if (run > longestStreak) longestStreak = run
  }
  const weekOf = (d) => {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    t.setDate(t.getDate() - t.getDay())
    return t.getTime()
  }
  const weeks = [...new Set(dated.map((x) => weekOf(x.d)))].sort((a, b) => a - b)
  let longestWeekStreak = weeks.length ? 1 : 0
  let wrun = 1
  for (let i = 1; i < weeks.length; i++) {
    wrun = Math.round((weeks[i] - weeks[i - 1]) / (7 * DAY_MS)) === 1 ? wrun + 1 : 1
    if (wrun > longestWeekStreak) longestWeekStreak = wrun
  }

  // rank among the venue's customers this year (needs a real crowd to be honest)
  const spendByPhone = new Map()
  for (const o of inYear) {
    const k = phoneKey(o.customerPhone)
    if (!k) continue
    spendByPhone.set(k, (spendByPhone.get(k) || 0) + netTotal(o))
  }
  let rank = null
  if (spendByPhone.size >= 5) {
    const ranked = [...spendByPhone.entries()].sort((a, b) => b[1] - a[1])
    const pos = ranked.findIndex(([k]) => k === key) + 1
    if (pos > 0) {
      rank = {
        position: pos,
        totalCustomers: ranked.length,
        topPercent: Math.max(1, Math.round((pos / ranked.length) * 100)),
      }
    }
  }

  // biggest single order
  let biggest = dated[0]
  for (const x of dated) if (netTotal(x.o) > netTotal(biggest.o)) biggest = x

  const milestones = []
  milestones.push({ key: 'first', label: 'أول زيارة هذا العام', value: dated[0].d.toLocaleDateString('en-CA'), at: dated[0].d })
  for (const n of [10, 25, 50, 100]) {
    if (visits >= n) milestones.push({ key: `visit-${n}`, label: `الزيارة رقم ${n}`, value: dated[n - 1].d.toLocaleDateString('en-CA'), at: dated[n - 1].d })
  }
  if (longestStreak >= 2) milestones.push({ key: 'streak', label: 'أطول تتابع يومي', value: `${longestStreak} يوماً متتالياً`, at: null })
  if (longestWeekStreak >= 3) milestones.push({ key: 'weeks', label: 'أطول تتابع أسبوعي', value: `${longestWeekStreak} أسبوعاً`, at: null })
  if (itemCount.size >= 5) milestones.push({ key: 'variety', label: 'أصناف جرّبتها', value: `${itemCount.size} صنفاً`, at: null })

  return {
    year: y,
    hasData: true,
    visits,
    totalSpent: r2(totalSpent),
    avgTicket: r2(totalSpent / visits),
    favouriteItem,
    topItems: topItems.slice(0, 5),
    favouriteDay,
    favouriteHour,
    firstVisit: dated[0].d,
    lastVisit: dated[dated.length - 1].d,
    longestStreak,
    longestWeekStreak,
    distinctItems: itemCount.size,
    biggestOrder: { total: r2(netTotal(biggest.o)), at: biggest.d },
    byMonth,
    rank,
    milestones,
    venueOrdersInYear: inYear.length,
    // Thin data still renders, but the caller should soften the copy.
    thin: visits < 3,
  }
}
