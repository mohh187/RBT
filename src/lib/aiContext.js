import { listItems, listMaterials, listOrdersSince, listAiMemory } from './db.js'

// A compact system snapshot to ground the assistant before each turn. It also
// injects recent DURABLE MEMORY (so the assistant "remembers" without being asked)
// and a 7-day best-seller signal (so it can advise like an analyst).
export async function buildContext(tid, tenant) {
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7); weekAgo.setHours(0, 0, 0, 0)
  const [items, mats, memory, weekOrders] = await Promise.all([
    listItems(tid).catch(() => []),
    listMaterials(tid).catch(() => []),
    listAiMemory(tid, 18).catch(() => []),
    listOrdersSince(tid, weekAgo).catch(() => []),
  ])
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const orders = weekOrders.filter((o) => (o.createdAt?.toDate ? o.createdAt.toDate() : new Date(0)) >= start)
  const settled = orders.filter((o) => ['paid', 'served', 'refunded'].includes(o.status))
  const revenue = settled.reduce((s, o) => s + (o.total || 0) - (o.status === 'refunded' ? (o.refund?.amount || 0) : 0), 0)
  const active = orders.filter((o) => ['pending', 'accepted', 'preparing', 'ready'].includes(o.status)).length
  const low = mats.filter((m) => (m.stockQty || 0) <= (Number(m.reorderLevel) || 0))
  // 7-day best/worst sellers (by qty) — analyst hooks without extra tool calls.
  const sold = {}
  weekOrders.filter((o) => o.status !== 'cancelled').forEach((o) => (o.items || []).forEach((it) => { const k = it.nameAr || 'item'; sold[k] = (sold[k] || 0) + (it.qty || 1) }))
  const topWeek = Object.entries(sold).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, qty]) => ({ name, qty }))
  const neverSold7d = items.filter((i) => i.available !== false && !sold[i.nameAr]).slice(0, 6).map((i) => i.nameAr)
  const week = weekOrders.filter((o) => ['paid', 'served'].includes(o.status))
  const weekRevenue = Math.round(week.reduce((s, o) => s + (o.total || 0), 0))
  // this venue's configuration — so advice matches how IT actually runs
  const pol = tenant?.membershipPolicy || {}
  return {
    venue: tenant?.name || 'venue',
    currency: tenant?.currency || 'SAR',
    counts: { items: items.length, materials: mats.length, lowStock: low.length },
    today: { orders: orders.length, revenue: Math.round(revenue), active },
    week: { orders: weekOrders.length, revenue: weekRevenue },
    topSellers7d: topWeek,
    notSold7d: neverSold7d,
    lowStock: low.slice(0, 12).map((m) => ({ id: m.id, name: m.nameAr, stock: m.stockQty || 0, unit: m.baseUnit })),
    setup: {
      loyalty: pol.enabled === true ? { mode: pol.mode || 'discounts', tierBy: pol.tierBy || 'orders' } : 'off',
      menuMode: tenant?.menuMode || 'order',
      onlinePay: tenant?.onlinePayment?.enabled === true,
      vat: tenant?.vatEnabled === true,
      autoPromos: tenant?.autoPromos || null,
      followup: tenant?.followup?.enabled === true,
      winback: tenant?.winback?.enabled === true,
      waiterCall: tenant?.waiterCallEnabled !== false,
    },
    memory: memory.map((m) => m.text).filter(Boolean).slice(0, 18),
  }
}
