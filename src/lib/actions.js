// AI action registry: the tools the manager-assistant can call (read + write).
// Each run() calls the normal db layer, so Firestore rules remain the security backstop.
// risk: 'safe' (auto) | 'confirm' (ask) | 'danger' (ask, sensitive/irreversible).
import * as db from './db.js'
import { db as fsdb } from './firebase.js'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { resolveMembershipPolicy, tierForPoints } from './membership.js'
import { uploadImage } from './storage.js'
import { publicBaseUrl } from './qr.js'
import { CAP, CAP_LABELS, roleDefaultCaps, effectiveCaps, roleName } from './permissions.js'
import { PLATFORM_APEX, DOMAIN_CNAME_TARGET } from './domains.js'
import { SKINS, FONT_OPTIONS, SHAPE_OPTIONS, LAYOUT_OPTIONS } from './skins.js'
import { SYSTEM_THEMES, THEMEABLE_SECTIONS } from './systemThemes.js'

// Real registries — validation + tool descriptions are generated from these so
// the model can never be misled by stale hardcoded id lists again.
const SKIN_IDS = SKINS.map((s) => s.id)
const FONT_KEYS = FONT_OPTIONS.map((f) => f.key)
const SYSTHEME_IDS = SYSTEM_THEMES.map((t) => t.id)

// base64 (no data: prefix) -> Blob, for uploading an attached image to Storage.
function b64ToBlob(b64, mime) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime || 'image/jpeg' })
}

async function cropBase64(base64, mime, box) {
  const url = `data:${mime};base64,${base64}`
  const img = await new Promise((res, rej) => {
    const i = new Image()
    i.crossOrigin = 'anonymous'
    i.onload = () => res(i)
    i.onerror = rej
    i.src = url
  })
  
  const ymin = Math.max(0, Number(box.ymin) || 0)
  const xmin = Math.max(0, Number(box.xmin) || 0)
  const ymax = Math.min(1000, Number(box.ymax) || 1000)
  const xmax = Math.min(1000, Number(box.xmax) || 1000)
  
  const x = (xmin / 1000) * img.width
  const y = (ymin / 1000) * img.height
  const w = ((xmax - xmin) / 1000) * img.width
  const h = ((ymax - ymin) / 1000) * img.height
  
  if (w <= 0 || h <= 0) throw new Error('invalid bounding box dimensions')
  
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h)
  
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9))
  if (!blob) throw new Error('failed to export cropped canvas to blob')
  return blob
}

const num = (d) => ({ type: 'number', description: d })
const str = (d) => ({ type: 'string', description: d })
const bool = (d) => ({ type: 'boolean', description: d })
const arr = (items, d) => ({ type: 'array', description: d, items })
const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) })
const recipeArr = arr(obj({ materialId: str('material id'), qty: num('quantity in base unit') }, ['materialId', 'qty']), 'recipe lines')

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d }
const NEXT = { pending: 'accepted', accepted: 'preparing', preparing: 'ready', ready: 'served' }

// Resolve a record by explicit id OR by (fuzzy) name. LLMs are reliable with names
// but frequently fabricate opaque ids — this makes write tools accept either, and
// turns a hallucinated id into a correct hit as long as a real name is present.
async function resolveByName(list, { id, name }) {
  if (id) { const hit = list.find((x) => x.id === id); if (hit) return hit }
  const q = String(name || '').trim().toLowerCase()
  if (!q) return null
  return list.find((x) => (x.nameAr || '').trim().toLowerCase() === q || (x.nameEn || '').trim().toLowerCase() === q)
    || list.find((x) => (x.nameAr || '').toLowerCase().includes(q) || (x.nameEn || '').toLowerCase().includes(q))
    || null
}
const resolveItem = async (tid, a) => resolveByName(await db.listItems(tid), { id: a.itemId, name: a.itemName })
// Like resolveItem, but NEVER guesses between several partial matches — returns
// { item } | { candidates } | { error } so destructive tools can ask instead.
async function resolveItemStrict(tid, a) {
  const items = await db.listItems(tid)
  if (a.itemId) { const hit = items.find((x) => x.id === a.itemId); if (hit) return { item: hit } }
  const q = String(a.itemName || '').trim().toLowerCase()
  if (!q) return { error: 'حدد اسم الصنف' }
  const exact = items.find((x) => (x.nameAr || '').trim().toLowerCase() === q || (x.nameEn || '').trim().toLowerCase() === q)
  if (exact) return { item: exact }
  const partial = items.filter((x) => (x.nameAr || '').toLowerCase().includes(q) || (x.nameEn || '').toLowerCase().includes(q))
  if (partial.length === 1) return { item: partial[0] }
  if (partial.length > 1) return { candidates: partial.map((x) => x.nameAr || x.nameEn), message: 'أكثر من صنف مطابق — حدد الاسم بدقة' }
  return { error: 'الصنف غير موجود — استخدم list_items' }
}
// Resolve a staffer by (fuzzy) name/email. Never guesses: several matches → candidates.
async function resolveStaff(tid, ref) {
  const q = String(ref || '').trim().toLowerCase()
  if (!q) return { error: 'حدد اسم الموظف' }
  const staff = await db.listStaff(tid)
  const nameOf = (s) => s.name || s.displayName || ''
  const exact = staff.filter((s) => nameOf(s).trim().toLowerCase() === q || String(s.email || '').trim().toLowerCase() === q || s.uid === ref)
  const pool = exact.length ? exact : staff.filter((s) => nameOf(s).toLowerCase().includes(q) || String(s.email || '').toLowerCase().includes(q))
  if (!pool.length) return { error: 'لا يوجد موظف بهذا الاسم — استخدم list_staff' }
  if (pool.length > 1) return { candidates: pool.map((s) => ({ name: nameOf(s) || s.email || s.uid, role: roleName(s.role || 'staff', 'ar') })), message: 'أكثر من موظف مطابق — حدد الاسم أو البريد بدقة' }
  return { staff: pool[0] }
}
const staffLabel = (s) => s.name || s.displayName || s.email || s.uid
// The venue-editable automated-message template keys (mirrors admin/Campaigns.jsx).
const MSG_TEMPLATE_KEYS = ['orderStatus', 'receipt', 'welcome', 'upgrade', 'birthday', 'offers', 'featured', 'newItems']
// Reject obviously fabricated product photos (placeholders / example URLs) — a
// hallucinated image is worse than none, so we refuse to persist it.
const isBadImageUrl = (u) => { const s = String(u || '').trim(); return !s || /placeholder|example\.(com|org)|your-?image|dummy|lorem|sample-?image/i.test(s) }

export const ACTIONS = [
  // ============ READ — inventory ============
  { name: 'inventory_summary', risk: 'safe', description: 'Counts + low-stock materials + out-of-stock finished goods.', parameters: obj({}),
    run: async (_a, { tid }) => { const [items, mats] = await Promise.all([db.listItems(tid), db.listMaterials(tid)]); const low = mats.filter((m) => (m.stockQty || 0) <= (Number(m.reorderLevel) || 0)); return { items: items.length, materials: mats.length, lowStock: low.map((m) => ({ id: m.id, name: m.nameAr, stock: m.stockQty || 0, unit: m.baseUnit })), outFinished: items.filter((i) => i.trackStock && (i.stock || 0) <= 0).map((i) => i.nameAr) } } },
  { name: 'list_materials', risk: 'safe', description: 'All raw materials with stock, unit, reorder/par level and avg cost.', parameters: obj({}),
    run: async (_a, { tid }) => (await db.listMaterials(tid)).map((m) => ({ id: m.id, name: m.nameAr, stock: m.stockQty || 0, unit: m.baseUnit, reorder: m.reorderLevel || 0, par: m.parLevel || 0, avgCost: m.avgCost || 0, expiry: m.expiryDate || null })) },
  { name: 'list_low_stock', risk: 'safe', description: 'Materials at or below reorder level, with suggested order qty to reach par.', parameters: obj({}),
    run: async (_a, { tid }) => (await db.listMaterials(tid)).filter((m) => (m.stockQty || 0) <= (Number(m.reorderLevel) || 0)).map((m) => ({ id: m.id, name: m.nameAr, stock: m.stockQty || 0, unit: m.baseUnit, suggestOrder: Math.max(0, (Number(m.parLevel) || 0) - (m.stockQty || 0)) })) },
  { name: 'list_expiring_materials', risk: 'safe', description: 'Materials expiring within N days (default 7).', parameters: obj({ days: num('days ahead') }),
    run: async (a, { tid }) => { const lim = Number(a.days) || 7; const now = Date.now(); return (await db.listMaterials(tid)).filter((m) => m.expiryDate).map((m) => ({ id: m.id, name: m.nameAr, expiry: m.expiryDate, daysLeft: Math.ceil((new Date(m.expiryDate) - now) / 86400000) })).filter((m) => m.daysLeft <= lim) } },
  { name: 'stock_value', risk: 'safe', description: 'Total inventory value = sum(stock × avg cost).', parameters: obj({}),
    run: async (_a, { tid }) => ({ value: Math.round((await db.listMaterials(tid)).reduce((s, m) => s + (m.stockQty || 0) * (m.avgCost || 0), 0)) }) },

  // ============ READ — catalogue ============
  { name: 'list_items', risk: 'safe', description: 'Menu items: id, name, price, availability, stock mode, category.', parameters: obj({}),
    run: async (_a, { tid }) => (await db.listItems(tid)).map((i) => ({ id: i.id, name: i.nameAr, price: i.price || 0, available: i.available !== false, stockMode: i.stockMode || 'none', categoryId: i.categoryId || '' })) },
  { name: 'list_categories', risk: 'safe', description: 'Menu categories.', parameters: obj({}),
    run: async (_a, { tid }) => (await db.listCategories(tid)).map((c) => ({ id: c.id, name: c.nameAr })) },
  { name: 'list_offers', risk: 'safe', description: 'Offers/discounts with type, value, code, active, members-only.', parameters: obj({}),
    run: async (_a, { tid }) => (await db.listOffers(tid)).map((o) => ({ id: o.id, name: o.nameAr, type: o.type, value: o.value, code: o.code || '', active: o.active !== false, membersOnly: !!o.membersOnly })) },
  { name: 'list_tables', risk: 'safe', description: 'Dine-in tables.', parameters: obj({}),
    run: async (_a, { tid }) => (await db.listTables(tid)).map((t) => ({ id: t.id, label: t.label })) },
  { name: 'list_suppliers', risk: 'safe', description: 'Suppliers.', parameters: obj({}),
    run: async (_a, { tid }) => (await db.listSuppliers(tid)).map((s) => ({ id: s.id, name: s.name, phone: s.phone || '' })) },

  // ============ READ — sales / reports ============
  { name: 'today_summary', risk: 'safe', description: "Today's orders, revenue, active orders.", parameters: obj({}),
    run: async (_a, { tid }) => { const o = await db.listOrdersSince(tid, startOfToday()); const set = o.filter((x) => ['paid', 'served', 'refunded'].includes(x.status)); return { orders: o.length, revenue: Math.round(set.reduce((s, x) => s + (x.total || 0) - (x.status === 'refunded' ? (x.refund?.amount || 0) : 0), 0)), active: o.filter((x) => ['pending', 'accepted', 'preparing', 'ready'].includes(x.status)).length } } },
  { name: 'sales_report', risk: 'safe', description: 'Revenue, order count, avg ticket and payment-method breakdown over the last N days.', parameters: obj({ days: num('days back, default 7') }),
    run: async (a, { tid }) => { const list = (await db.listOrdersSince(tid, daysAgo(Number(a.days) || 7))).filter((o) => o.status !== 'cancelled'); const rev = list.reduce((s, o) => s + (o.total || 0), 0); const byMethod = {}; list.filter((o) => ['paid', 'refunded'].includes(o.status)).forEach((o) => { if (o.paymentBreakdown) Object.entries(o.paymentBreakdown).forEach(([m, v]) => { byMethod[m] = (byMethod[m] || 0) + (Number(v) || 0) }); else { const m = o.paymentMethod || 'cash'; byMethod[m] = (byMethod[m] || 0) + (o.total || 0) } }); return { revenue: Math.round(rev), orders: list.length, avg: list.length ? Math.round(rev / list.length) : 0, byMethod } } },
  { name: 'top_items', risk: 'safe', description: 'Best-selling items over the last N days.', parameters: obj({ days: num('days back'), limit: num('how many') }),
    run: async (a, { tid }) => { const list = (await db.listOrdersSince(tid, daysAgo(Number(a.days) || 7))).filter((o) => o.status !== 'cancelled'); const t = {}; list.forEach((o) => (o.items || []).forEach((it) => { const k = it.nameAr || 'item'; t[k] = (t[k] || 0) + (it.qty || 1) })); return Object.entries(t).sort((x, y) => y[1] - x[1]).slice(0, Number(a.limit) || 10).map(([name, qty]) => ({ name, qty })) } },
  { name: 'peak_hours', risk: 'safe', description: 'Busiest hours of the day over the last N days.', parameters: obj({ days: num('days back') }),
    run: async (a, { tid }) => { const list = (await db.listOrdersSince(tid, daysAgo(Number(a.days) || 7))).filter((o) => o.status !== 'cancelled'); const h = Array(24).fill(0); list.forEach((o) => { const d = o.createdAt?.toDate ? o.createdAt.toDate() : null; if (d) h[d.getHours()] += 1 }); return h.map((c, hr) => ({ hour: hr, orders: c })).filter((x) => x.orders).sort((a2, b2) => b2.orders - a2.orders).slice(0, 6) } },
  { name: 'cogs_report', risk: 'safe', description: 'Cost & margin for recipe items (item cost = recipe × material avg cost).', parameters: obj({}),
    run: async (_a, { tid }) => { const [items, mats] = await Promise.all([db.listItems(tid), db.listMaterials(tid)]); const cost = (lines) => (lines || []).reduce((s, l) => s + ((mats.find((m) => m.id === l.materialId)?.avgCost || 0) * (Number(l.qty) || 0)), 0); return items.filter((i) => i.stockMode === 'recipe').map((i) => { const c = cost(i.recipe); const p = i.price || 0; return { name: i.nameAr, price: p, cost: Math.round(c * 100) / 100, marginPct: p > 0 ? Math.round(((p - c) / p) * 100) : 0 } }) } },
  { name: 'list_active_orders', risk: 'safe', description: 'Orders currently in progress.', parameters: obj({}),
    run: async (_a, { tid }) => (await db.listActiveOrders(tid)).map((o) => ({ id: o.id, code: o.code, status: o.status, total: o.total || 0, table: o.tableLabel || '', customer: o.customerName || '' })) },
  { name: 'get_order', risk: 'safe', description: 'Full details of one order by id.', parameters: obj({ orderId: str('order id') }, ['orderId']),
    run: async (a, { tid }) => { const o = await db.getOrder(tid, a.orderId); return o ? { code: o.code, status: o.status, total: o.total, items: (o.items || []).map((l) => ({ name: l.nameAr, qty: l.qty, lineTotal: l.lineTotal })), customer: o.customerName, table: o.tableLabel } : { found: false } } },

  // ============ READ — customers / loyalty ============
  { name: 'get_customer', risk: 'safe', description: 'Look up a customer by phone (stats, membership, flags).', parameters: obj({ phone: str('phone') }, ['phone']),
    run: async (a, { tid }) => { const c = await db.getCustomerByPhone(tid, a.phone); return c ? { name: c.name, totalOrders: c.totalOrders || 0, totalSpent: c.totalSpent || 0, flagged: !!c.flagged, rating: c.staffRating || 0, member: c.membership?.active ? { tier: c.membership.tier, points: c.membership.points } : null } : { found: false } } },
  { name: 'list_top_customers', risk: 'safe', description: 'Top customers by spend.', parameters: obj({ limit: num('how many') }),
    run: async (a, { tid }) => (await db.listCustomers(tid)).sort((x, y) => (y.totalSpent || 0) - (x.totalSpent || 0)).slice(0, Number(a.limit) || 10).map((c) => ({ name: c.name, phone: c.phone, spent: c.totalSpent || 0, orders: c.totalOrders || 0 })) },
  { name: 'loyalty_summary', risk: 'safe', description: 'Members count by tier + outstanding points.', parameters: obj({}),
    run: async (_a, { tid }) => { const m = (await db.listCustomers(tid)).filter((c) => c.membership?.active); const t = { silver: 0, gold: 0, platinum: 0 }; let pts = 0; m.forEach((c) => { t[c.membership.tier] = (t[c.membership.tier] || 0) + 1; pts += c.membership.points || 0 }); return { members: m.length, byTier: t, pointsOutstanding: pts } } },
  { name: 'get_settings', risk: 'safe', description: 'Key venue settings (currency, VAT, loyalty, membership policy).', parameters: obj({}),
    run: async (_a, { tid }) => { const t = await db.getTenant(tid); return { name: t?.name, currency: t?.currency || 'SAR', vatEnabled: !!t?.vatEnabled, vatRate: t?.vatRate ?? 15, loyaltyEnabled: t?.loyaltyEnabled !== false, loyaltyThreshold: t?.loyaltyThreshold || 5, membership: t?.membershipPolicy || null } } },

  // ============ KNOWLEDGE — system help, live market research, item doctor ============
  { name: 'help_guide', risk: 'safe', description: 'Authoritative how-to guide for THIS system (rbt360): where every feature lives and how to use it. Call for ANY "how do I / where is / what does X do" question from the manager or staff, then answer from the returned guide text.', parameters: obj({ query: str('the feature/task being asked about, in Arabic or English') }, ['query']),
    run: async (a) => { const { searchGuide } = await import('./aiGuide.js'); const hits = searchGuide(a.query, 3); return hits.length ? { sections: hits } : { sections: [], note: 'no direct match — answer from your general knowledge of the snapshot and tools, honestly' } },
  },
  { name: 'explain_page', risk: 'safe', description: 'Detailed step-by-step usage guide for a SPECIFIC admin page (the same manual behind the «دليل الصفحة» button): sections, tabs and exact steps. Call when the user asks how to use a page/section, then teach from the returned steps and OFFER to open the page with open_page.', parameters: obj({ page: str('page name or keyword, Arabic or English — e.g. "المنيو", "الكاشير", "campaigns"') }, ['page']),
    run: async (a) => { const { findGuides, PAGE_GUIDES } = await import('./pageGuides.js'); const hits = findGuides(a.page, 2); return hits.length ? { guides: hits.map((g) => ({ title: g.title, path: g.path, intro: g.intro, sections: g.sections })) } : { guides: [], availablePages: PAGE_GUIDES.map((g) => ({ title: g.title, path: g.path })) } },
  },
  { name: 'open_page', risk: 'safe', description: 'Navigate the user to a system page RIGHT NOW (in-app, no reload). Use after explaining where something lives, or when the user says "خذني إلى / افتح صفحة …". Path must be one of the known page paths from explain_page.', parameters: obj({ path: str('in-app path, e.g. /admin/menu or /cashier') }, ['path']),
    run: async (a) => {
      const { PAGE_GUIDES } = await import('./pageGuides.js')
      const p = String(a.path || '')
      const ok = p.startsWith('/') && (PAGE_GUIDES.some((g) => p === g.path || p.startsWith(g.path + '/')) || ['/portal', '/scan', '/admin'].some((x) => p === x || p.startsWith(x + '/')))
      if (!ok) return { error: 'unknown path — call explain_page first and use one of its paths' }
      window.dispatchEvent(new CustomEvent('rbt:navigate', { detail: { to: p } }))
      return { ok: true, navigated: p }
    },
  },
  { name: 'set_tours_enabled', risk: 'confirm', description: 'Turn the first-run guided tours (الجولات الإرشادية) on or off for the WHOLE venue (all staff devices).', parameters: obj({ enabled: bool('true = show tours, false = hide') }, ['enabled']),
    run: async (a, { tid }) => { await db.updateTenant(tid, { toursEnabled: !!a.enabled }); return { ok: true, toursEnabled: !!a.enabled } },
  },
  { name: 'market_research', risk: 'safe', description: 'LIVE internet research via Google Search (market trends, competitor pricing, popular dishes, supplier prices, seasonal demand in Saudi/GCC). Use for any question about the OUTSIDE market — never guess market facts from memory.', parameters: obj({ query: str('specific research question, e.g. "متوسط سعر اللاتيه في مقاهي الرياض 2026"') }, ['query']),
    run: async (a) => { const { aiQuick } = await import('./aiBridge.js'); try { const out = await aiQuick(`أجب بدقة وباختصار مع أرقام وحقائق من نتائج البحث، وبالعربية:\n${a.query}`, { withSearch: true }); return { findings: out || 'لم تصل نتائج' } } catch (e) { return { error: 'تعذّر البحث: ' + String(e?.message || e) } } },
  },
  { name: 'item_doctor', risk: 'safe', description: 'REAL-DATA diagnosis of a weak-selling item (or auto-picks the slowest movers when no item given): 30-day sales & revenue, price vs its category average, photo/description presence, rating, and which levers are unused. Base every improvement plan on this — never invent numbers.', parameters: obj({ itemName: str('item name or id (optional — omit to auto-pick 3 slowest movers)') }),
    run: async (a, { tid }) => {
      const [items, orders] = await Promise.all([db.listItems(tid), db.listOrdersSince(tid, daysAgo(30))])
      const sold = {}
      const revenue = {}
      orders.filter((o) => o.status !== 'cancelled').forEach((o) => (o.items || []).forEach((l) => {
        if (!l.itemId) return
        sold[l.itemId] = (sold[l.itemId] || 0) + (l.qty || 1)
        revenue[l.itemId] = (revenue[l.itemId] || 0) + (l.lineTotal || 0)
      }))
      const catAvg = {}
      const catCount = {}
      items.forEach((i) => { const c = i.categoryId || '_'; catAvg[c] = (catAvg[c] || 0) + (i.price || 0); catCount[c] = (catCount[c] || 0) + 1 })
      Object.keys(catAvg).forEach((c) => { catAvg[c] = Math.round((catAvg[c] / (catCount[c] || 1)) * 100) / 100 })
      const diagnose = (i) => ({
        name: i.nameAr, id: i.id,
        sold30d: sold[i.id] || 0, revenue30d: Math.round(revenue[i.id] || 0),
        price: i.price || 0, categoryAvgPrice: catAvg[i.categoryId || '_'] || 0,
        hasImage: !!i.imageUrl, hasDescription: !!(i.descAr || i.descEn), rating: i.rating || null,
        featured: !!i.featured, hasPairings: !!(i.pairings && i.pairings.length), available: i.available !== false,
        unusedLevers: [
          !i.imageUrl && 'صورة المنتج مفقودة',
          !(i.descAr || i.descEn) && 'بلا وصف',
          !i.featured && 'ليس في المميّزة',
          !(i.pairings && i.pairings.length) && 'بلا توصيات «يُطلب معه»',
          (i.promoNotify || 'default') === 'off' && 'الإشعار الترويجي موقوف',
        ].filter(Boolean),
      })
      if (a.itemName) {
        const it = await resolveItem(tid, { itemName: a.itemName, itemId: a.itemName })
        if (!it) return { error: 'item not found — call list_items' }
        return { item: diagnose(it) }
      }
      const slow = items.filter((i) => i.available !== false).sort((x, y) => (sold[x.id] || 0) - (sold[y.id] || 0)).slice(0, 3)
      return { slowestMovers: slow.map(diagnose), note: 'حلّل كل صنف واقترح خطة من الروافع غير المستخدمة + سعر/عرض/حملة مبنية على الأرقام أعلاه' }
    },
  },

  // ============ MEMORY — self-learning (durable across conversations) ============
  { name: 'recall_facts', risk: 'safe', description: 'Recall durable facts/insights you previously remembered about this venue (customers, staff, decisions, menu conventions). Optional keyword filter.', parameters: obj({ query: str('optional keyword to filter by') }),
    run: async (a, { tid }) => { const all = await db.listAiMemory(tid, 200); const q = String(a.query || '').toLowerCase().trim(); const list = q ? all.filter((m) => (m.text || '').toLowerCase().includes(q) || (m.tags || []).some((t) => String(t).toLowerCase().includes(q))) : all; return list.slice(0, 60).map((m) => ({ id: m.id, text: m.text, tags: m.tags || [] })) } },
  { name: 'remember_fact', risk: 'safe', description: 'Save a durable, useful fact/insight so you recall it in every future conversation (a customer preference/behaviour, a staff pattern, a standing decision, a menu convention, an approved strategy). Keep it concise.', parameters: obj({ text: str('the fact to remember'), tags: arr(str('tag'), 'optional tags e.g. customer, staff, menu, pricing') }, ['text']),
    run: async (a, { tid, actor }) => { const r = await db.saveAiMemory(tid, { text: a.text, tags: a.tags || [], kind: 'insight', by: actor || 'ai' }); return { ok: true, id: r?.id } } },
  { name: 'forget_fact', risk: 'confirm', description: 'Delete a remembered fact by its id (from recall_facts).', parameters: obj({ id: str('memory id') }, ['id']),
    run: async (a, { tid }) => { await db.deleteAiMemory(tid, a.id); return { ok: true } } },

  // ============ WRITE — inventory ============
  { name: 'add_material', risk: 'confirm', description: 'Create a raw material. baseUnit g|ml|pc.', parameters: obj({ nameAr: str('name'), baseUnit: str('g|ml|pc'), reorderLevel: num('reorder level base unit'), parLevel: num('par level'), purchaseUnit: str('e.g. kg'), purchaseFactor: num('base units per purchase unit') }, ['nameAr', 'baseUnit']),
    run: async (a, { tid }) => { const r = await db.saveMaterial(tid, null, { nameAr: a.nameAr, nameEn: a.nameEn || '', baseUnit: a.baseUnit || 'g', reorderLevel: Number(a.reorderLevel) || 0, parLevel: Number(a.parLevel) || 0, purchaseUnit: a.purchaseUnit || 'kg', purchaseFactor: Number(a.purchaseFactor) || 1000 }); return { ok: true, id: r?.id } } },
  { name: 'update_material', risk: 'confirm', description: 'Update a material (reorderLevel, parLevel, name, expiryDate YYYY-MM-DD).', parameters: obj({ materialId: str('id'), reorderLevel: num(''), parLevel: num(''), nameAr: str(''), expiryDate: str('') }, ['materialId']),
    run: async (a, { tid }) => { const patch = {}; if (a.reorderLevel != null) patch.reorderLevel = Number(a.reorderLevel) || 0; if (a.parLevel != null) patch.parLevel = Number(a.parLevel) || 0; if (a.nameAr) patch.nameAr = a.nameAr; if (a.expiryDate) patch.expiryDate = a.expiryDate; await db.saveMaterial(tid, a.materialId, patch); return { ok: true } } },
  { name: 'receive_stock', risk: 'confirm', description: 'Receive purchased stock (qty in BASE unit) + optional total cost.', parameters: obj({ materialId: str('id'), qtyBase: num('qty in base unit'), totalCost: num('total cost') }, ['materialId', 'qtyBase']),
    run: async (a, { tid, actor }) => { await db.receiveStock(tid, a.materialId, { qtyBase: a.qtyBase, totalCost: a.totalCost || 0, actor }); return { ok: true } } },
  { name: 'count_stock', risk: 'confirm', description: 'Set a material stock to an actual counted amount (base unit).', parameters: obj({ materialId: str('id'), countedBase: num('counted base unit') }, ['materialId', 'countedBase']),
    run: async (a, { tid, actor }) => { await db.countStock(tid, a.materialId, { countedBase: a.countedBase, actor }); return { ok: true } } },
  { name: 'waste_material', risk: 'confirm', description: 'Record waste for a material (base unit).', parameters: obj({ materialId: str('id'), qtyBase: num('wasted base unit'), reason: str('') }, ['materialId', 'qtyBase']),
    run: async (a, { tid, actor }) => { await db.wasteStock(tid, a.materialId, { qtyBase: a.qtyBase, reason: a.reason || '', actor }); return { ok: true } } },
  { name: 'produce_material', risk: 'confirm', description: 'Produce a semi-finished material from its sub-recipe (consumes ingredients, adds yield).', parameters: obj({ materialId: str('id'), batches: num('number of batches') }, ['materialId']),
    run: async (a, { tid, actor }) => { const r = await db.produceMaterial(tid, a.materialId, { batches: Number(a.batches) || 1, actor }); return r } },

  // ============ WRITE — items / catalogue ============
  { name: 'add_item', risk: 'confirm', description: 'Create a menu item.', parameters: obj({ nameAr: str('name'), price: num('price'), categoryId: str('category id') }, ['nameAr', 'price']),
    run: async (a, { tid }) => { const r = await db.saveItem(tid, null, { nameAr: a.nameAr, nameEn: a.nameEn || '', price: Number(a.price) || 0, categoryId: a.categoryId || '', available: true }); return { ok: true, id: r?.id } } },
  { name: 'update_item', risk: 'confirm', description: 'Update item price / name / description / availability / image. Identify the item by itemId (from list_items) OR by itemName — never guess an id.', parameters: obj({ itemId: str('id from list_items'), itemName: str('item name — used if itemId is missing/unknown'), price: num(''), nameAr: str(''), descAr: str('Arabic description'), descEn: str('English description'), available: bool(''), imageUrl: str('product image URL from upload_attached_image/crop_and_upload_image — NEVER a placeholder') }),
    run: async (a, { tid }) => { const it = await resolveItem(tid, a); if (!it) return { error: 'item not found — call list_items and use the exact id or name' }; const patch = {}; if (a.price != null) patch.price = Number(a.price) || 0; if (a.nameAr) patch.nameAr = a.nameAr; if (a.descAr != null) patch.descAr = a.descAr; if (a.descEn != null) patch.descEn = a.descEn; if (a.available != null) patch.available = !!a.available; if (a.imageUrl && !isBadImageUrl(a.imageUrl)) patch.imageUrl = a.imageUrl; await db.saveItem(tid, it.id, patch); return { ok: true, id: it.id, name: it.nameAr } } },
  { name: 'set_item_image', risk: 'confirm', description: 'Set an item\'s product photo to an image URL (the URL returned by upload_attached_image/crop_and_upload_image). Identify by itemId or itemName.', parameters: obj({ itemId: str('id'), itemName: str('item name (fallback)'), imageUrl: str('public image URL — never a placeholder') }, ['imageUrl']),
    run: async (a, { tid }) => { if (isBadImageUrl(a.imageUrl)) return { error: 'refusing a placeholder/example image — upload a real photo (upload_attached_image) first' }; const it = await resolveItem(tid, a); if (!it) return { error: 'item not found — call list_items first' }; await db.saveItem(tid, it.id, { imageUrl: a.imageUrl }); return { ok: true, id: it.id, name: it.nameAr } } },
  { name: 'set_item_effect', risk: 'confirm', description: 'Set a LIVE visual effect on an item (animates over its photo in the menu detail/spotlight and over the in-app 3D viewer — NOT in real camera AR). Valid ids: steam (hot-drink steam), smoke, sparkle, bubbles (cold drinks), frost, fire — or empty string to remove. Identify by itemId or itemName.', parameters: obj({ itemId: str('id'), itemName: str('item name (fallback)'), effect: str('steam | smoke | sparkle | bubbles | frost | fire | "" to clear') }, ['effect']),
    run: async (a, { tid }) => {
      const { EFFECT_IDS } = await import('./itemEffects.js')
      const fx = String(a.effect || '')
      if (fx && !EFFECT_IDS.includes(fx)) return { error: 'unknown effect — valid: ' + EFFECT_IDS.join(', ') + ' or "" to clear' }
      const it = await resolveItem(tid, a)
      if (!it) return { error: 'item not found — call list_items first' }
      await db.saveItem(tid, it.id, { effect: fx })
      return { ok: true, id: it.id, name: it.nameAr, effect: fx }
    } },
  { name: 'set_item_price', risk: 'confirm', description: 'Set an item base price. Identify by itemId or itemName.', parameters: obj({ itemId: str('id'), itemName: str('item name (fallback)'), price: num('new price') }, ['price']),
    run: async (a, { tid }) => { const it = await resolveItem(tid, a); if (!it) return { error: 'item not found — call list_items first' }; await db.saveItem(tid, it.id, { price: Number(a.price) || 0 }); return { ok: true, id: it.id, name: it.nameAr } } },
  { name: 'set_item_availability', risk: 'confirm', description: 'Mark item available or sold out. Identify by itemId or itemName.', parameters: obj({ itemId: str('id'), itemName: str('item name (fallback)'), available: bool('') }, ['available']),
    run: async (a, { tid }) => { const it = await resolveItem(tid, a); if (!it) return { error: 'item not found — call list_items first' }; await db.setItemAvailability(tid, it.id, !!a.available); return { ok: true, id: it.id, name: it.nameAr } } },
  { name: 'set_item_recipe', risk: 'confirm', description: 'Set the default recipe (materials consumed) for an item; sets stockMode=recipe. Identify by itemId or itemName.', parameters: obj({ itemId: str('id'), itemName: str('item name (fallback)'), recipe: recipeArr }, ['recipe']),
    run: async (a, { tid }) => { const it = await resolveItem(tid, a); if (!it) return { error: 'item not found — call list_items first' }; const recipe = (a.recipe || []).filter((l) => l.materialId && Number(l.qty) > 0).map((l) => ({ materialId: l.materialId, qty: Number(l.qty) })); await db.saveItem(tid, it.id, { recipe, stockMode: recipe.length ? 'recipe' : 'none' }); return { ok: true, lines: recipe.length } } },
  { name: 'reorder_items', risk: 'confirm', description: 'Reorder menu items (sets sortOrder = the order shown in the menu). EITHER pass `order` = item names or ids in the exact desired sequence, OR a `strategy`: images_first (items with a photo lead) | price_asc | price_desc | name. Optionally limit to one category via categoryName; otherwise it orders every item (still grouped by category in the menu).', parameters: obj({ categoryName: str('optional: restrict to this category (name or id)'), order: arr(str('item name or id'), 'explicit order, most-important first'), strategy: str('images_first | price_asc | price_desc | name') }),
    run: async (a, { tid }) => {
      const items = await db.listItems(tid)
      let scope = items
      if (a.categoryName) {
        const cats = await db.listCategories(tid)
        const q = String(a.categoryName).trim().toLowerCase()
        const cat = cats.find((c) => c.id === a.categoryName) || cats.find((c) => (c.nameAr || '').toLowerCase() === q || (c.nameEn || '').toLowerCase() === q) || cats.find((c) => (c.nameAr || '').toLowerCase().includes(q) || (c.nameEn || '').toLowerCase().includes(q))
        if (cat) scope = items.filter((i) => (i.categoryId || '') === cat.id)
        else return { error: 'category not found — call list_categories' }
      }
      let ordered
      if (Array.isArray(a.order) && a.order.length) {
        const pick = (ref) => scope.find((i) => i.id === ref) || scope.find((i) => (i.nameAr || '').trim().toLowerCase() === String(ref).trim().toLowerCase()) || scope.find((i) => (i.nameEn || '').trim().toLowerCase() === String(ref).trim().toLowerCase())
        ordered = a.order.map(pick).filter(Boolean)
        const seen = new Set(ordered.map((i) => i.id))
        ordered = [...ordered, ...scope.filter((i) => !seen.has(i.id))]
      } else {
        const s = a.strategy || 'images_first'
        ordered = [...scope].sort((x, y) => {
          if (s === 'price_asc') return (x.price || 0) - (y.price || 0)
          if (s === 'price_desc') return (y.price || 0) - (x.price || 0)
          if (s === 'name') return (x.nameAr || '').localeCompare(y.nameAr || '', 'ar')
          return (y.imageUrl ? 1 : 0) - (x.imageUrl ? 1 : 0) // images_first (default)
        })
      }
      await Promise.all(ordered.map((it, idx) => db.saveItem(tid, it.id, { sortOrder: idx })))
      return { ok: true, reordered: ordered.length }
    } },
  { name: 'add_category', risk: 'confirm', description: 'Create a menu category.', parameters: obj({ nameAr: str('name') }, ['nameAr']),
    run: async (a, { tid }) => { const r = await db.saveCategory(tid, null, { nameAr: a.nameAr, nameEn: a.nameEn || '' }); return { ok: true, id: r?.id } } },
  { name: 'create_offer', risk: 'confirm', description: 'Create an offer. type percent|fixed; optional code; membersOnly.', parameters: obj({ nameAr: str('name'), type: str('percent|fixed'), value: num('value'), code: str('coupon code'), membersOnly: bool('') }, ['nameAr', 'type', 'value']),
    run: async (a, { tid }) => { const r = await db.saveOffer(tid, null, { nameAr: a.nameAr, nameEn: a.nameEn || '', type: a.type === 'fixed' ? 'fixed' : 'percent', value: Number(a.value) || 0, code: (a.code || '').toUpperCase(), scope: 'cart', autoApply: !a.code, membersOnly: !!a.membersOnly, active: true }); return { ok: true, id: r?.id } } },
  { name: 'toggle_offer', risk: 'confirm', description: 'Activate or deactivate an offer.', parameters: obj({ offerId: str('id'), active: bool('') }, ['offerId', 'active']),
    run: async (a, { tid }) => { await db.saveOffer(tid, a.offerId, { active: !!a.active }); return { ok: true } } },
  { name: 'add_table', risk: 'confirm', description: 'Add a dine-in table with seats and shape (round|square).', parameters: obj({ label: str('table label'), seats: num('number of chairs'), shape: str('round|square') }, ['label']),
    run: async (a, { tid }) => { const r = await db.createTable(tid, { label: a.label, seats: Number(a.seats) || 4, shape: a.shape === 'square' ? 'square' : 'round' }); return { ok: true, id: r?.id } } },
  { name: 'list_table_bookings', risk: 'safe', description: 'List active table bookings (advance reservations).', parameters: obj({}),
    run: async (_a, { tid }) => (await db.listReservations(tid)).filter((r) => r.kind === 'table' && !['cancelled', 'done'].includes(r.status)).map((r) => ({ id: r.id, name: r.name, party: r.partySize, table: r.tableLabel || '', date: r.date || '', time: r.time || '', status: r.status })) },
  { name: 'confirm_reservation', risk: 'confirm', description: 'Confirm a table booking.', parameters: obj({ reservationId: str('id') }, ['reservationId']),
    run: async (a, { tid }) => { await db.setReservationStatus(tid, a.reservationId, 'confirmed'); return { ok: true } } },
  { name: 'cancel_reservation', risk: 'confirm', description: 'Cancel a table booking.', parameters: obj({ reservationId: str('id') }, ['reservationId']),
    run: async (a, { tid }) => { await db.setReservationStatus(tid, a.reservationId, 'cancelled'); return { ok: true } } },

  // ============ WRITE — orders ============
  { name: 'advance_order', risk: 'confirm', description: 'Move an order to its next status (pending→accepted→preparing→ready→served).', parameters: obj({ orderId: str('id') }, ['orderId']),
    run: async (a, { tid, actor }) => { const o = await db.getOrder(tid, a.orderId); const next = NEXT[o?.status]; if (!next) return { ok: false, reason: 'no next status' }; await db.updateOrderStatus(tid, a.orderId, next, { _actor: actor }); return { ok: true, status: next } } },
  { name: 'cancel_order', risk: 'confirm', description: 'Cancel an order with a reason (restores stock).', parameters: obj({ orderId: str('id'), reason: str('') }, ['orderId']),
    run: async (a, { tid, tenant, actor }) => { await db.cancelOrderWithReason(tid, a.orderId, { reason: a.reason || '', actor, policy: resolveMembershipPolicy(tenant) }); return { ok: true } } },
  { name: 'refund_order', risk: 'danger', description: 'Refund a paid order (amount; full refund restores stock/points).', parameters: obj({ orderId: str('id'), amount: num('refund amount'), reason: str('') }, ['orderId', 'amount']),
    run: async (a, { tid, tenant, actor }) => { await db.refundOrder(tid, a.orderId, { amount: Number(a.amount) || 0, reason: a.reason || '', actor, policy: resolveMembershipPolicy(tenant) }); return { ok: true } } },
  { name: 'comp_order', risk: 'confirm', description: 'Apply a comp/discount amount to an active order.', parameters: obj({ orderId: str('id'), amount: num('discount amount'), reason: str('') }, ['orderId', 'amount']),
    run: async (a, { tid, actor }) => { await db.compOrder(tid, a.orderId, { amount: Number(a.amount) || 0, reason: a.reason || '', actor }); return { ok: true } } },
  { name: 'move_order_table', risk: 'confirm', description: 'Move an order to a table (by id) or to takeaway (omit tableId).', parameters: obj({ orderId: str('id'), tableId: str('table id'), tableLabel: str('label') }, ['orderId']),
    run: async (a, { tid }) => { await db.setOrderTable(tid, a.orderId, a.tableId ? { tableId: a.tableId, tableLabel: a.tableLabel || '', orderType: 'dine_in' } : { tableId: null, tableLabel: '', orderType: 'takeaway' }); return { ok: true } } },

  // ============ WRITE — customers / loyalty ============
  { name: 'flag_customer', risk: 'confirm', description: 'Tag/untag a customer (warns staff next order).', parameters: obj({ phone: str('phone'), flagged: bool(''), note: str('') }, ['phone', 'flagged']),
    run: async (a, { tid }) => { await db.setCustomerFlag(tid, a.phone, { flagged: !!a.flagged, ...(a.note ? { flagNote: a.note } : {}) }); return { ok: true } } },
  { name: 'rate_customer', risk: 'confirm', description: 'Set a staff rating (0-5) for a customer.', parameters: obj({ phone: str('phone'), rating: num('0-5') }, ['phone', 'rating']),
    run: async (a, { tid }) => { await db.setCustomerFlag(tid, a.phone, { staffRating: Math.max(0, Math.min(5, Number(a.rating) || 0)) }); return { ok: true } } },
  { name: 'grant_membership', risk: 'confirm', description: 'Grant a VIP membership to a customer by phone.', parameters: obj({ phone: str('phone') }, ['phone']),
    run: async (a, { tid }) => { const m = await db.grantMembership(tid, a.phone, { source: 'ai' }); return m ? { ok: true, memberId: m.memberId } : { ok: false } } },
  { name: 'revoke_membership', risk: 'confirm', description: 'Revoke a customer membership.', parameters: obj({ phone: str('phone') }, ['phone']),
    run: async (a, { tid }) => { await db.setMembershipActive(tid, a.phone, false); return { ok: true } } },
  { name: 'redeem_points', risk: 'confirm', description: 'Redeem points from a member.', parameters: obj({ phone: str('phone'), points: num('points') }, ['phone', 'points']),
    run: async (a, { tid, actor }) => { const r = await db.redeemPoints(tid, a.phone, { points: Number(a.points) || 0, actor }); return r ? { ok: true, remaining: r.points } : { ok: false } } },

  // ============ WRITE — settings ============
  { name: 'update_settings', risk: 'danger', description: 'Update venue settings. Allowed keys: vatEnabled, vatRate, vatNumber, loyaltyEnabled, loyaltyThreshold, currency, curbsideEnabled.', parameters: obj({ vatEnabled: bool(''), vatRate: num(''), vatNumber: str(''), loyaltyEnabled: bool(''), loyaltyThreshold: num(''), currency: str(''), curbsideEnabled: bool('') }),
    run: async (a, { tid }) => { const allow = ['vatEnabled', 'vatRate', 'vatNumber', 'loyaltyEnabled', 'loyaltyThreshold', 'currency', 'curbsideEnabled']; const patch = {}; allow.forEach((k) => { if (a[k] != null) patch[k] = a[k] }); if (!Object.keys(patch).length) return { ok: false, reason: 'no allowed keys' }; await db.updateTenant(tid, patch); return { ok: true, updated: Object.keys(patch) } } },
  { name: 'set_points_multiplier', risk: 'confirm', description: 'Set the loyalty points multiplier (e.g. 2 for double points).', parameters: obj({ multiplier: num('multiplier') }, ['multiplier']),
    run: async (a, { tid, tenant }) => { const mp = { ...(tenant?.membershipPolicy || {}), pointsMultiplier: Number(a.multiplier) || 1 }; await db.updateTenant(tid, { membershipPolicy: mp }); return { ok: true } } },

  // ============ READ — advanced reports ============
  { name: 'material_moves', risk: 'safe', description: 'Recent stock movements for a material.', parameters: obj({ materialId: str('id'), limit: num('') }, ['materialId']),
    run: async (a, { tid }) => (await db.listStockMoves(tid)).filter((m) => m.materialId === a.materialId).slice(0, Number(a.limit) || 20).map((m) => ({ type: m.type, qty: m.qty, at: m.at, reason: m.reason || '' })) },
  { name: 'consumption_report', risk: 'safe', description: 'Total material consumed by sales over the last N days.', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const since = daysAgo(Number(a.days) || 7).getTime(); const mats = await db.listMaterials(tid); const moves = (await db.listStockMoves(tid)).filter((m) => m.type === 'sale' && (m.at || 0) >= since); const by = {}; moves.forEach((m) => { by[m.materialId] = (by[m.materialId] || 0) + Math.abs(m.qty || 0) }); return Object.entries(by).map(([id, q]) => { const m = mats.find((x) => x.id === id); return { name: m?.nameAr || id, consumed: q, unit: m?.baseUnit || 'g' } }).sort((x, y) => y.consumed - x.consumed) } },
  { name: 'variance_report', risk: 'safe', description: 'Stock count variances (theoretical vs counted) + cost impact.', parameters: obj({}),
    run: async (_a, { tid }) => { const mats = await db.listMaterials(tid); const counts = (await db.listStockMoves(tid)).filter((m) => m.type === 'count' && m.reason !== 'restore'); const by = {}; counts.forEach((c) => { by[c.materialId] = (by[c.materialId] || 0) + (c.qty || 0) }); return Object.entries(by).filter(([, d]) => d !== 0).map(([id, d]) => { const m = mats.find((x) => x.id === id); return { name: m?.nameAr || id, variance: d, costImpact: Math.round((m?.avgCost || 0) * Math.abs(d)) } }) } },
  { name: 'sales_by_category', risk: 'safe', description: 'Revenue by category over the last N days.', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const [items, cats] = await Promise.all([db.listItems(tid), db.listCategories(tid)]); const catOf = {}; items.forEach((i) => { catOf[i.id] = i.categoryId }); const cn = {}; cats.forEach((c) => { cn[c.id] = c.nameAr }); const list = (await db.listOrdersSince(tid, daysAgo(Number(a.days) || 7))).filter((o) => o.status !== 'cancelled'); const t = {}; list.forEach((o) => (o.items || []).forEach((it) => { const c = cn[it.categoryId || catOf[it.itemId]] || 'أخرى'; t[c] = (t[c] || 0) + (it.lineTotal || 0) })); return Object.entries(t).sort((x, y) => y[1] - x[1]).map(([name, rev]) => ({ name, revenue: Math.round(rev) })) } },
  { name: 'vat_report', risk: 'safe', description: 'VAT collected over the last N days (if VAT enabled).', parameters: obj({ days: num('') }),
    run: async (a, { tid, tenant }) => { if (!tenant?.vatEnabled) return { vatEnabled: false }; const rate = Number(tenant?.vatRate ?? 15) || 15; const list = (await db.listOrdersSince(tid, daysAgo(Number(a.days) || 7))).filter((o) => ['paid', 'served', 'refunded'].includes(o.status)); const gross = list.reduce((s, o) => s + (o.total || 0) - (o.status === 'refunded' ? (o.refund?.amount || 0) : 0), 0); return { gross: Math.round(gross), vat: Math.round((gross - gross / (1 + rate / 100)) * 100) / 100, rate } } },
  { name: 'staff_performance', risk: 'safe', description: 'Orders & revenue per staff (who served) over N days.', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const list = (await db.listOrdersSince(tid, daysAgo(Number(a.days) || 7))).filter((o) => ['served', 'paid'].includes(o.status)); const t = {}; list.forEach((o) => { const k = o.servedByName || '—'; t[k] = t[k] || { orders: 0, rev: 0 }; t[k].orders += 1; t[k].rev += o.total || 0 }); return Object.entries(t).sort((x, y) => y[1].rev - x[1].rev).map(([name, v]) => ({ name, orders: v.orders, revenue: Math.round(v.rev) })) } },
  { name: 'tips_report', risk: 'safe', description: 'Tips collected per staff over N days.', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const list = (await db.listOrdersSince(tid, daysAgo(Number(a.days) || 7))); const t = {}; list.forEach((o) => { if (o.tip) { const k = o.servedByName || '—'; t[k] = (t[k] || 0) + (o.tip || 0) } }); return Object.entries(t).sort((x, y) => y[1] - x[1]).map(([name, tips]) => ({ name, tips })) } },
  { name: 'list_members', risk: 'safe', description: 'VIP members, optionally filtered by tier.', parameters: obj({ tier: str('silver|gold|platinum') }),
    run: async (a, { tid }) => (await db.listCustomers(tid)).filter((c) => c.membership?.active && (!a.tier || c.membership.tier === a.tier)).map((c) => ({ name: c.name, phone: c.phone, tier: c.membership.tier, points: c.membership.points })) },
  { name: 'points_statement', risk: 'safe', description: 'A customer\'s loyalty points earn/redeem history.', parameters: obj({ phone: str('phone') }, ['phone']),
    run: async (a, { tid }) => (await db.listLoyaltyLog(tid, a.phone)).map((e) => ({ type: e.type, points: e.points, at: e.at, by: e.byName || '' })) },
  { name: 'suggest_purchase_order', risk: 'safe', description: 'Suggest what to buy: materials below reorder, quantity to reach par.', parameters: obj({}),
    run: async (_a, { tid }) => (await db.listMaterials(tid)).filter((m) => (m.stockQty || 0) <= (Number(m.reorderLevel) || 0)).map((m) => ({ name: m.nameAr, current: m.stockQty || 0, unit: m.baseUnit, order: Math.max(0, (Number(m.parLevel) || 0) - (m.stockQty || 0)), estCost: Math.round((m.avgCost || 0) * Math.max(0, (Number(m.parLevel) || 0) - (m.stockQty || 0))) })) },

  // ============ WRITE — advanced ============
  { name: 'bulk_count', risk: 'confirm', description: 'Set counted stock for several materials at once.', parameters: obj({ counts: arr(obj({ materialId: str('id'), countedBase: num('counted') }, ['materialId', 'countedBase']), 'count entries') }, ['counts']),
    run: async (a, { tid, actor }) => { for (const c of (a.counts || [])) await db.countStock(tid, c.materialId, { countedBase: c.countedBase, actor }); return { ok: true, counted: (a.counts || []).length } } },
  { name: 'assign_supplier', risk: 'confirm', description: 'Assign a supplier to a material.', parameters: obj({ materialId: str('id'), supplierId: str('id') }, ['materialId', 'supplierId']),
    run: async (a, { tid }) => { await db.saveMaterial(tid, a.materialId, { supplierId: a.supplierId }); return { ok: true } } },
  { name: 'set_material_factor', risk: 'confirm', description: 'Set a material purchase unit + conversion factor (base units per purchase unit).', parameters: obj({ materialId: str('id'), purchaseUnit: str(''), purchaseFactor: num('') }, ['materialId', 'purchaseFactor']),
    run: async (a, { tid }) => { const patch = { purchaseFactor: Number(a.purchaseFactor) || 1 }; if (a.purchaseUnit) patch.purchaseUnit = a.purchaseUnit; await db.saveMaterial(tid, a.materialId, patch); return { ok: true } } },
  { name: 'update_category', risk: 'confirm', description: 'Rename a category.', parameters: obj({ categoryId: str('id'), nameAr: str('') }, ['categoryId', 'nameAr']),
    run: async (a, { tid }) => { await db.saveCategory(tid, a.categoryId, { nameAr: a.nameAr }); return { ok: true } } },
  { name: 'bump_category_prices', risk: 'danger', description: 'Raise/lower all prices in a category by a percent (e.g. 10 = +10%).', parameters: obj({ categoryId: str('id'), percent: num('percent change') }, ['categoryId', 'percent']),
    run: async (a, { tid }) => { const items = (await db.listItems(tid)).filter((i) => i.categoryId === a.categoryId && (i.price || 0) > 0); const f = 1 + (Number(a.percent) || 0) / 100; for (const i of items) await db.saveItem(tid, i.id, { price: Math.round((i.price || 0) * f * 100) / 100 }); return { ok: true, updated: items.length } } },
  { name: 'duplicate_item', risk: 'confirm', description: 'Duplicate a menu item with ALL its details (variants, modifiers, recipe, image, description). Identify by itemId or itemName.', parameters: obj({ itemId: str('id'), itemName: str('item name (fallback)') }),
    run: async (a, { tid }) => { const it = await resolveItem(tid, a); if (!it) return { error: 'item not found — call list_items first' }; const r = await db.duplicateItem(tid, it.id); return r ? { ok: true, id: r?.id } : { ok: false } } },
  { name: 'void_order_item', risk: 'confirm', description: 'Remove a line item (by index) from an active order.', parameters: obj({ orderId: str('id'), index: num('item index') }, ['orderId', 'index']),
    run: async (a, { tid, actor }) => { await db.voidOrderItem(tid, a.orderId, Number(a.index) || 0, { actor }); return { ok: true } } },
  { name: 'set_order_item_qty', risk: 'confirm', description: 'Change the quantity of a line item (by index) in an active order.', parameters: obj({ orderId: str('id'), index: num('item index'), qty: num('new qty') }, ['orderId', 'index', 'qty']),
    run: async (a, { tid, actor }) => { await db.setOrderItemQty(tid, a.orderId, Number(a.index) || 0, Number(a.qty) || 1, { actor }); return { ok: true } } },
  { name: 'add_order_items', risk: 'confirm', description: 'Add items to an active order (open lines: name + price + qty).', parameters: obj({ orderId: str('id'), items: arr(obj({ nameAr: str('name'), unitPrice: num('price'), qty: num('qty') }, ['nameAr', 'unitPrice']), 'lines') }, ['orderId', 'items']),
    run: async (a, { tid, actor }) => {
      const allItems = await db.listItems(tid)
      const lines = (a.items || []).map((l) => {
        const nameClean = String(l.nameAr || '').trim().toLowerCase()
        const matched = allItems.find((i) => String(i.nameAr || '').trim().toLowerCase() === nameClean || String(i.nameEn || '').trim().toLowerCase() === nameClean)
        const price = Number(l.unitPrice) || (matched ? matched.price : 0) || 0
        return {
          itemId: matched ? matched.id : '',
          nameAr: matched ? matched.nameAr : l.nameAr,
          nameEn: matched ? matched.nameEn : (l.nameAr || ''),
          variantLabel: '',
          variantKey: '',
          modifiers: [],
          unitPrice: price,
          qty: Number(l.qty) || 1,
          lineTotal: price * (Number(l.qty) || 1),
          categoryId: matched ? (matched.categoryId || '') : '',
        }
      })
      await db.addOrderItems(tid, a.orderId, lines, { actor })
      return { ok: true, added: lines.length }
    }
  },
  { name: 'mark_order_paid', risk: 'confirm', description: 'Mark an order paid (method cash|card|transfer).', parameters: obj({ orderId: str('id'), method: str('cash|card|transfer') }, ['orderId']),
    run: async (a, { tid, actor }) => { await db.payOrder(tid, a.orderId, { method: a.method || 'cash', actor, markServed: true }); return { ok: true } } },
  { name: 'create_order', risk: 'confirm', description: 'Create a new order from open lines (name+price+qty). orderType takeaway|dine_in|pickup.', parameters: obj({ items: arr(obj({ nameAr: str('name'), unitPrice: num('price'), qty: num('qty') }, ['nameAr', 'unitPrice']), 'lines'), customerName: str(''), customerPhone: str(''), orderType: str('') }, ['items']),
    run: async (a, { tid, tenant, actor }) => {
      const allItems = await db.listItems(tid)
      const lines = (a.items || []).map((l) => {
        const nameClean = String(l.nameAr || '').trim().toLowerCase()
        const matched = allItems.find((i) => String(i.nameAr || '').trim().toLowerCase() === nameClean || String(i.nameEn || '').trim().toLowerCase() === nameClean)
        const price = Number(l.unitPrice) || (matched ? matched.price : 0) || 0
        return {
          itemId: matched ? matched.id : '',
          nameAr: matched ? matched.nameAr : l.nameAr,
          nameEn: matched ? matched.nameEn : (l.nameAr || ''),
          variantLabel: '',
          variantKey: '',
          modifiers: [],
          unitPrice: price,
          qty: Number(l.qty) || 1,
          lineTotal: price * (Number(l.qty) || 1),
          categoryId: matched ? (matched.categoryId || '') : '',
        }
      })
      const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0)
      const res = await db.createOrder(tid, {
        items: lines,
        subtotal,
        discount: 0,
        loyaltyDiscount: 0,
        memberDiscount: 0,
        total: subtotal,
        orderType: a.orderType || 'takeaway',
        tableId: null,
        tableLabel: '',
        customerName: a.customerName || '',
        customerPhone: (a.customerPhone || '').replace(/[^0-9]/g, ''),
        notes: '',
        currency: tenant?.currency || 'SAR',
        source: 'ai'
      })
      await db.updateOrderStatus(tid, res.id, 'accepted', { acceptedByName: actor, _actor: actor })
      return { ok: true, code: res.code }
    }
  },
  { name: 'open_cash_drawer', risk: 'confirm', description: 'Open a cashier session with an opening float.', parameters: obj({ openingFloat: num('opening cash') }),
    run: async (a, { tid, actor }) => { await db.openCashierSession(tid, { openingFloat: Number(a.openingFloat) || 0, actor }); return { ok: true } } },
  { name: 'award_points', risk: 'confirm', description: 'Grant bonus loyalty points to a member.', parameters: obj({ phone: str('phone'), points: num('points'), reason: str('') }, ['phone', 'points']),
    run: async (a, { tid, tenant, actor }) => { const r = await db.awardPoints(tid, a.phone, { points: Number(a.points) || 0, reason: a.reason || '', actor, policy: resolveMembershipPolicy(tenant) }); return r ? { ok: true, points: r.points } : { ok: false } } },
  { name: 'set_customer_birthday', risk: 'confirm', description: "Set a customer's birthday (MM-DD).", parameters: obj({ phone: str('phone'), birthday: str('MM-DD') }, ['phone', 'birthday']),
    run: async (a, { tid }) => { await db.setCustomerFlag(tid, a.phone, { birthday: a.birthday }); return { ok: true } } },
  { name: 'configure_membership', risk: 'danger', description: 'Configure VIP membership policy (enabled, minOrders, minSpent, earnRate, redeemRate, birthdayBonus).', parameters: obj({ enabled: bool(''), minOrders: num(''), minSpent: num(''), earnRate: num(''), redeemRate: num(''), birthdayBonus: num('') }),
    run: async (a, { tid, tenant }) => { const mp = { ...(tenant?.membershipPolicy || {}) }; ['enabled', 'minOrders', 'minSpent', 'earnRate', 'redeemRate', 'birthdayBonus'].forEach((k) => { if (a[k] != null) mp[k] = a[k] }); await db.updateTenant(tid, { membershipPolicy: mp }); return { ok: true } } },
  { name: 'set_staff_attendance_policy', risk: 'danger', description: 'Set attendance policy (graceMinutes, lateDeductionPerHour).', parameters: obj({ graceMinutes: num(''), lateDeductionPerHour: num('') }),
    run: async (a, { tid, tenant }) => { const p = { ...(tenant?.attendancePolicy || {}) }; if (a.graceMinutes != null) p.graceMinutes = Number(a.graceMinutes) || 0; if (a.lateDeductionPerHour != null) p.lateDeductionPerHour = Number(a.lateDeductionPerHour) || 0; await db.updateTenant(tid, { attendancePolicy: p }); return { ok: true } } },
  { name: 'set_theme', risk: 'confirm', description: 'Set the brand theme color and accent (hex).', parameters: obj({ themeColor: str('#hex'), themeAccent: str('#hex') }),
    run: async (a, { tid }) => { const patch = {}; if (a.themeColor) patch.themeColor = a.themeColor; if (a.themeAccent) patch.themeAccent = a.themeAccent; if (!Object.keys(patch).length) return { ok: false }; await db.updateTenant(tid, patch); return { ok: true } } },

  // ============ READ — analytics & forecasting ============
  { name: 'forecast_sales', risk: 'safe', description: "Estimate next day's revenue from the average of the same weekday over recent weeks.", parameters: obj({}),
    run: async (_a, { tid }) => { const list = (await db.listOrdersSince(tid, daysAgo(28))).filter((o) => o.status !== 'cancelled'); const dow = (new Date().getDay() + 1) % 7; const byDay = {}; list.forEach((o) => { const d = o.createdAt?.toDate?.(); if (d && d.getDay() === dow) { const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; byDay[k] = (byDay[k] || 0) + (o.total || 0) } }); const v = Object.values(byDay); return { forecast: Math.round(v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0), basedOn: v.length } } },
  { name: 'compare_periods', risk: 'safe', description: 'Compare revenue & orders of the last N days vs the previous N days.', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const n = Number(a.days) || 7; const all = (await db.listOrdersSince(tid, daysAgo(n * 2))).filter((o) => o.status !== 'cancelled'); const cut = daysAgo(n).getTime(); const cur = all.filter((o) => (o.createdAt?.toMillis?.() || 0) >= cut); const prev = all.filter((o) => (o.createdAt?.toMillis?.() || 0) < cut); const rev = (l) => l.reduce((s, o) => s + (o.total || 0), 0); const cr = rev(cur); const pr = rev(prev); return { current: { revenue: Math.round(cr), orders: cur.length }, previous: { revenue: Math.round(pr), orders: prev.length }, revenueChangePct: pr ? Math.round(((cr - pr) / pr) * 100) : 0 } } },
  { name: 'slow_movers', risk: 'safe', description: 'Menu items with no/low sales in the last N days.', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const items = await db.listItems(tid); const list = (await db.listOrdersSince(tid, daysAgo(Number(a.days) || 14))).filter((o) => o.status !== 'cancelled'); const sold = {}; list.forEach((o) => (o.items || []).forEach((it) => { if (it.itemId) sold[it.itemId] = (sold[it.itemId] || 0) + (it.qty || 1) })); return items.map((i) => ({ name: i.nameAr, sold: sold[i.id] || 0 })).sort((x, y) => x.sold - y.sold).slice(0, 15) } },
  { name: 'basket_analysis', risk: 'safe', description: 'Most frequent item pairs ordered together (last N days).', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const list = (await db.listOrdersSince(tid, daysAgo(Number(a.days) || 14))).filter((o) => o.status !== 'cancelled'); const p = {}; list.forEach((o) => { const names = [...new Set((o.items || []).map((it) => it.nameAr).filter(Boolean))]; for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) { const k = [names[i], names[j]].sort().join(' + '); p[k] = (p[k] || 0) + 1 } }); return Object.entries(p).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([pair, count]) => ({ pair, count })) } },
  { name: 'predict_depletion', risk: 'safe', description: 'Estimate days until each material runs out at the recent consumption rate.', parameters: obj({ days: num('lookback window, default 14') }),
    run: async (a, { tid }) => { const win = Number(a.days) || 14; const since = daysAgo(win).getTime(); const mats = await db.listMaterials(tid); const moves = (await db.listStockMoves(tid)).filter((m) => m.type === 'sale' && (m.at || 0) >= since); const used = {}; moves.forEach((m) => { used[m.materialId] = (used[m.materialId] || 0) + Math.abs(m.qty || 0) }); return mats.map((m) => { const perDay = (used[m.id] || 0) / win; return { name: m.nameAr, stock: m.stockQty || 0, perDay: Math.round(perDay * 10) / 10, daysLeft: perDay > 0 ? Math.floor((m.stockQty || 0) / perDay) : null } }).filter((x) => x.perDay > 0).sort((x, y) => (x.daysLeft ?? 9999) - (y.daysLeft ?? 9999)) } },
  { name: 'forecast_material_needs', risk: 'safe', description: 'Projected weekly consumption per material from the recent rate.', parameters: obj({ window: num('lookback days, default 14') }),
    run: async (a, { tid }) => { const win = Number(a.window) || 14; const since = daysAgo(win).getTime(); const mats = await db.listMaterials(tid); const moves = (await db.listStockMoves(tid)).filter((m) => m.type === 'sale' && (m.at || 0) >= since); const used = {}; moves.forEach((m) => { used[m.materialId] = (used[m.materialId] || 0) + Math.abs(m.qty || 0) }); return mats.map((m) => ({ name: m.nameAr, weekly: Math.round(((used[m.id] || 0) / win) * 7), unit: m.baseUnit })).filter((x) => x.weekly > 0) } },
  { name: 'menu_engineering', risk: 'safe', description: 'Classify recipe items by popularity & margin into star / plowhorse / puzzle / dog.', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const [items, mats] = await Promise.all([db.listItems(tid), db.listMaterials(tid)]); const cost = (l) => (l || []).reduce((s, x) => s + ((mats.find((m) => m.id === x.materialId)?.avgCost || 0) * (Number(x.qty) || 0)), 0); const list = (await db.listOrdersSince(tid, daysAgo(Number(a.days) || 30))).filter((o) => o.status !== 'cancelled'); const qty = {}; list.forEach((o) => (o.items || []).forEach((it) => { if (it.itemId) qty[it.itemId] = (qty[it.itemId] || 0) + (it.qty || 1) })); const rec = items.filter((i) => i.stockMode === 'recipe'); const qs = rec.map((i) => qty[i.id] || 0).sort((x, y) => x - y); const med = qs[Math.floor(qs.length / 2)] || 0; return rec.map((i) => { const c = cost(i.recipe); const p = i.price || 0; const margin = p > 0 ? ((p - c) / p) * 100 : 0; const pop = qty[i.id] || 0; return { name: i.nameAr, sold: pop, marginPct: Math.round(margin), class: pop >= med && margin >= 50 ? 'star' : pop >= med ? 'plowhorse' : margin >= 50 ? 'puzzle' : 'dog' } }) } },
  { name: 'item_profitability', risk: 'safe', description: 'Recipe items ranked by total profit (margin × qty) over N days.', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const [items, mats] = await Promise.all([db.listItems(tid), db.listMaterials(tid)]); const cost = (l) => (l || []).reduce((s, x) => s + ((mats.find((m) => m.id === x.materialId)?.avgCost || 0) * (Number(x.qty) || 0)), 0); const list = (await db.listOrdersSince(tid, daysAgo(Number(a.days) || 30))).filter((o) => o.status !== 'cancelled'); const qty = {}; list.forEach((o) => (o.items || []).forEach((it) => { if (it.itemId) qty[it.itemId] = (qty[it.itemId] || 0) + (it.qty || 1) })); return items.filter((i) => i.stockMode === 'recipe').map((i) => ({ name: i.nameAr, sold: qty[i.id] || 0, profit: Math.round(((i.price || 0) - cost(i.recipe)) * (qty[i.id] || 0)) })).sort((x, y) => y.profit - x.profit) } },
  { name: 'cancellation_report', risk: 'safe', description: 'Cancellation rate and reasons over N days.', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const all = await db.listOrdersSince(tid, daysAgo(Number(a.days) || 30)); const c = all.filter((o) => o.status === 'cancelled'); const reasons = {}; c.forEach((o) => { const r = o.cancelReason || '—'; reasons[r] = (reasons[r] || 0) + 1 }); return { total: all.length, cancelled: c.length, ratePct: all.length ? Math.round((c.length / all.length) * 100) : 0, reasons } } },
  { name: 'customer_ltv', risk: 'safe', description: 'Average customer lifetime value + top spenders.', parameters: obj({}),
    run: async (_a, { tid }) => { const cs = await db.listCustomers(tid); const sp = cs.map((c) => c.totalSpent || 0); const avg = sp.length ? sp.reduce((s, v) => s + v, 0) / sp.length : 0; return { customers: cs.length, avgLtv: Math.round(avg), top: cs.sort((x, y) => (y.totalSpent || 0) - (x.totalSpent || 0)).slice(0, 5).map((c) => ({ name: c.name, spent: c.totalSpent || 0 })) } } },
  { name: 'profit_report', risk: 'safe', description: 'Net profit over N days = revenue − COGS (recipes) − refunds − expenses.', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const days = Number(a.days) || 7; const [items, mats, expenses] = await Promise.all([db.listItems(tid), db.listMaterials(tid), db.listExpensesSince(tid, daysAgo(days))]); const cm = {}; items.forEach((i) => { cm[i.id] = (i.recipe || []).reduce((s, x) => s + ((mats.find((m) => m.id === x.materialId)?.avgCost || 0) * (Number(x.qty) || 0)), 0) }); const list = (await db.listOrdersSince(tid, daysAgo(days))).filter((o) => o.status !== 'cancelled'); let rev = 0; let cogs = 0; let refunds = 0; list.forEach((o) => { rev += o.total || 0; refunds += o.status === 'refunded' ? (o.refund?.amount || 0) : 0; (o.items || []).forEach((it) => { cogs += (cm[it.itemId] || 0) * (it.qty || 1) }) }); const exp = expenses.reduce((s, e) => s + (e.amount || 0), 0); const gross = rev - refunds - cogs; const net = gross - exp; return { revenue: Math.round(rev), cogs: Math.round(cogs), refunds: Math.round(refunds), expenses: Math.round(exp), grossProfit: Math.round(gross), netProfit: Math.round(net), marginPct: rev ? Math.round((net / rev) * 100) : 0 } } },
  { name: 'expenses_report', risk: 'safe', description: 'Operating expenses total + by category over N days.', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const list = await db.listExpensesSince(tid, daysAgo(Number(a.days) || 30)); const by = {}; list.forEach((e) => { by[e.category || 'other'] = (by[e.category || 'other'] || 0) + (e.amount || 0) }); return { total: Math.round(list.reduce((s, e) => s + (e.amount || 0), 0)), byCategory: by, count: list.length } } },
  { name: 'log_expense', risk: 'confirm', description: 'Record an operating expense (rent, salaries, utilities, supplies, other).', parameters: obj({ amount: num('amount'), category: str('category'), note: str('') }, ['amount']),
    run: async (a, { tid, actor }) => { await db.addExpense(tid, { amount: Number(a.amount) || 0, category: a.category || 'other', note: a.note || '', actor }); return { ok: true } } },
  { name: 'refunds_report', risk: 'safe', description: 'Refunds count + total over N days.', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const r = (await db.listOrdersSince(tid, daysAgo(Number(a.days) || 30))).filter((o) => o.status === 'refunded'); return { count: r.length, total: Math.round(r.reduce((s, o) => s + (o.refund?.amount || 0), 0)), items: r.slice(0, 10).map((o) => ({ code: o.code, amount: o.refund?.amount || 0, reason: o.refund?.reason || '' })) } } },
  { name: 'discounts_report', risk: 'safe', description: 'Discounts/comps total over N days (offer, member, loyalty, comp).', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const list = (await db.listOrdersSince(tid, daysAgo(Number(a.days) || 30))).filter((o) => o.status !== 'cancelled'); let off = 0; let mem = 0; let comp = 0; let loy = 0; list.forEach((o) => { off += o.discount || 0; mem += o.memberDiscount || 0; comp += o.compDiscount || 0; loy += o.loyaltyDiscount || 0 }); return { offer: Math.round(off), member: Math.round(mem), comp: Math.round(comp), loyalty: Math.round(loy), total: Math.round(off + mem + comp + loy) } } },
  { name: 'offer_impact', risk: 'safe', description: 'Orders with vs without a discount, and avg ticket of each (last N days).', parameters: obj({ days: num('') }),
    run: async (a, { tid }) => { const list = (await db.listOrdersSince(tid, daysAgo(Number(a.days) || 30))).filter((o) => o.status !== 'cancelled'); const hasD = (o) => (o.discount || 0) > 0 || (o.memberDiscount || 0) > 0; const w = list.filter(hasD); const wo = list.filter((o) => !hasD(o)); const avg = (l) => (l.length ? Math.round(l.reduce((s, o) => s + (o.total || 0), 0) / l.length) : 0); return { withOffer: { orders: w.length, avgTicket: avg(w) }, withoutOffer: { orders: wo.length, avgTicket: avg(wo) } } } },

  // ============ DANGER — deletes ============
  { name: 'delete_item', risk: 'danger', description: 'Delete a menu item.', parameters: obj({ itemId: str('id') }, ['itemId']),
    run: async (a, { tid }) => { await db.deleteItem(tid, a.itemId); return { ok: true } } },
  { name: 'delete_material', risk: 'danger', description: 'Delete a raw material.', parameters: obj({ materialId: str('id') }, ['materialId']),
    run: async (a, { tid }) => { await db.deleteMaterial(tid, a.materialId); return { ok: true } } },
  { name: 'delete_offer', risk: 'danger', description: 'Delete an offer.', parameters: obj({ offerId: str('id') }, ['offerId']),
    run: async (a, { tid }) => { await db.deleteOffer(tid, a.offerId); return { ok: true } } },
  { name: 'delete_category', risk: 'danger', description: 'Delete a category.', parameters: obj({ categoryId: str('id') }, ['categoryId']),
    run: async (a, { tid }) => { await db.deleteCategory(tid, a.categoryId); return { ok: true } } },
  { name: 'delete_table', risk: 'danger', description: 'Delete a dine-in table.', parameters: obj({ tableId: str('id') }, ['tableId']),
    run: async (a, { tid }) => { await db.deleteTable(tid, a.tableId); return { ok: true } } },

  // ============ MENU PREVIEW & DESIGN ============
  { name: 'preview_menu', risk: 'safe', description: 'Get the live public menu link + table-booking link + a structure summary, so the manager can preview the menu.', parameters: obj({}),
    run: async (_a, { tid, tenant }) => { const [items, cats] = await Promise.all([db.listItems(tid), db.listCategories(tid)]); const slug = tenant?.slug || (await db.getTenant(tid))?.slug || ''; const base = publicBaseUrl(); return { menuUrl: slug ? `${base}/m/${slug}` : null, bookTableUrl: slug ? `${base}/reserve/${slug}` : null, categories: cats.length, items: items.length, available: items.filter((i) => i.available !== false).length, skin: tenant?.skin?.skinId || 'classic' } } },
  { name: 'set_menu_design', risk: 'confirm', description: 'Change menu design/branding: skin (classic|nova|editorial|serene|vivid|bento|authority|luxe|mono|lagoon|forest|golden|sunrise|midnight|blossom|sand|cobalt|grape|crimson|slate), theme colors (hex), menuLayout (list|grid|cards), venue name and tagline.', parameters: obj({ skinId: str('skin id'), themeColor: str('#hex'), themeAccent: str('#hex'), menuLayout: str('list|grid|cards'), name: str('venue name'), tagline: str('short tagline') }),
    run: async (a, { tid, tenant }) => { const patch = {}; if (a.themeColor) patch.themeColor = a.themeColor; if (a.themeAccent) patch.themeAccent = a.themeAccent; if (a.name) patch.name = a.name; if (a.tagline) patch.descAr = a.tagline; if (a.skinId || a.menuLayout) { const skin = { ...(tenant?.skin || {}) }; if (a.skinId) skin.skinId = a.skinId; if (a.menuLayout) skin.overrides = { ...(skin.overrides || {}), menuLayout: a.menuLayout }; patch.skin = skin } if (!Object.keys(patch).length) return { ok: false, reason: 'nothing to change' }; await db.updateTenant(tid, patch); return { ok: true, updated: Object.keys(patch) } } },
  { name: 'add_menu_item', risk: 'confirm', description: 'Create a menu item, optionally with a photo from an attached image or an existing URL. Use imageUrl if you already cropped an image using crop_and_upload_image.', parameters: obj({ nameAr: str('name (Arabic)'), nameEn: str('name (English)'), price: num('price'), categoryId: str('category id, optional'), descAr: str('description, optional'), imageIndex: num('0-based index of an attached image to use as the photo, optional'), imageUrl: str('URL of an existing image to use as photo, optional') }, ['nameAr', 'price']),
    run: async (a, { tid, attachments }) => { let imageUrl = a.imageUrl || ''; const idx = a.imageIndex; if (!imageUrl && idx != null && attachments && attachments[idx] && attachments[idx].kind === 'image') { const at = attachments[idx]; try { const file = new File([b64ToBlob(at.data, at.mime)], at.name || 'photo.jpg', { type: at.mime || 'image/jpeg' }); imageUrl = await uploadImage(tid, file, 'items') } catch (_) { /* keep item without photo */ } } const r = await db.saveItem(tid, null, { nameAr: a.nameAr, nameEn: a.nameEn || '', price: Number(a.price) || 0, categoryId: a.categoryId || '', descAr: a.descAr || '', imageUrl, available: true }); return { ok: true, id: r?.id, photo: !!imageUrl } } },

  // ============ EXECUTIVE — marketing, loyalty policy & venue modes ============
  { name: 'list_campaigns', risk: 'safe', description: 'List marketing campaigns (status, audience, schedule, delivery counts) and saved templates.', parameters: obj({}),
    run: async (_a, { tid }) => (await db.listCampaigns(tid)).map((c) => ({ id: c.id, title: c.title || '', status: c.status, audience: c.audience, scheduleAt: c.scheduleAt || null, repeat: c.repeat || 'none', sent: c.sentCount || 0, failed: c.failCount || 0 })) },
  { name: 'create_campaign', risk: 'confirm', description: 'Create a marketing campaign (WhatsApp + optional in-menu notice). audience: all|members|silver|gold|platinum|active5|orders10|orders15. scheduleAtMs omitted = send within minutes. Supports {الاسم}/{المنشأة} placeholders, coupon attribution and weekly/daily repeat.', parameters: obj({ title: str('internal title'), text: str('message text'), audience: str('audience key'), scheduleAtMs: num('epoch ms to send at (optional)'), repeat: str('none|weekly|daily'), couponCode: str('attach an offer code (optional)'), noticeAlso: bool('also post as in-menu notice') }, ['text']),
    run: async (a, { tid }) => { const r = await db.saveCampaign(tid, null, { title: a.title || '', text: a.text, audience: a.audience || 'all', channels: { whatsapp: true, notice: !!a.noticeAlso }, repeat: ['weekly', 'daily'].includes(a.repeat) ? a.repeat : 'none', ...(a.couponCode ? { couponCode: a.couponCode } : {}), status: 'scheduled', scheduleAt: Number(a.scheduleAtMs) || Date.now() }); return { ok: true, id: r?.id } } },
  { name: 'message_customer', risk: 'confirm', description: 'Send ONE customer a direct WhatsApp message (by phone). Sent within minutes via the campaign engine.', parameters: obj({ phone: str('customer phone'), text: str('message') }, ['phone', 'text']),
    run: async (a, { tid }) => { const pid = String(a.phone).replace(/[^0-9]/g, ''); if (!pid) return { error: 'invalid phone' }; const r = await db.saveCampaign(tid, null, { title: `رسالة مباشرة ${pid}`, text: a.text, audience: 'custom', audienceIds: [pid], channels: { whatsapp: true, notice: false }, repeat: 'none', status: 'scheduled', scheduleAt: Date.now() }); return { ok: true, id: r?.id } } },
  { name: 'set_loyalty_mode', risk: 'confirm', description: "Configure the loyalty policy: mode 'discounts' (tier %) or 'perks' (privileged notifications, no discounts); tierBy 'orders' or 'points'; optional order thresholds for gold/platinum.", parameters: obj({ mode: str('discounts|perks'), tierBy: str('orders|points'), goldMinOrders: num(''), platinumMinOrders: num(''), enabled: bool('enable/disable membership') }),
    run: async (a, { tid, tenant }) => { const mp = { ...(tenant?.membershipPolicy || {}) }; if (a.mode === 'discounts' || a.mode === 'perks') mp.mode = a.mode; if (a.tierBy === 'orders' || a.tierBy === 'points') mp.tierBy = a.tierBy; if (a.enabled != null) mp.enabled = !!a.enabled; const tiers = { ...(mp.tiers || {}) }; if (a.goldMinOrders != null) tiers.gold = { ...(tiers.gold || {}), minOrders: Number(a.goldMinOrders) }; if (a.platinumMinOrders != null) tiers.platinum = { ...(tiers.platinum || {}), minOrders: Number(a.platinumMinOrders) }; if (Object.keys(tiers).length) mp.tiers = tiers; await db.updateTenant(tid, { membershipPolicy: mp }); return { ok: true, mode: mp.mode, tierBy: mp.tierBy } } },
  { name: 'set_auto_promos', risk: 'confirm', description: "Who gets automatic WhatsApp when the venue publishes offers / stars items / adds new items: 'off' | 'members' | 'all' per kind.", parameters: obj({ offers: str('off|members|all'), featured: str('off|members|all'), newItems: str('off|members|all') }),
    run: async (a, { tid, tenant }) => { const auto = { ...(tenant?.autoPromos || {}) }; ['offers', 'featured', 'newItems'].forEach((k) => { if (['off', 'members', 'all'].includes(a[k])) auto[k] = a[k] }); await db.updateTenant(tid, { autoPromos: auto }); return { ok: true, autoPromos: auto } } },
  { name: 'set_winback', risk: 'confirm', description: 'Configure the automatic "we miss you" message for idle customers (enabled, idle days, custom text).', parameters: obj({ enabled: bool(''), days: num('idle days, default 30'), text: str('custom message, {الاسم}/{المنشأة} supported') }),
    run: async (a, { tid, tenant }) => { const wb = { ...(tenant?.winback || {}) }; if (a.enabled != null) wb.enabled = !!a.enabled; if (a.days != null) wb.days = Number(a.days) || 30; if (a.text != null) wb.text = a.text; await db.updateTenant(tid, { winback: wb }); return { ok: true } } },
  { name: 'set_followup', risk: 'confirm', description: 'Configure the post-visit thanks message (delay after payment in minutes, custom text, Google-Maps review link attach).', parameters: obj({ enabled: bool(''), delayMins: num('default 60'), text: str('custom text'), includeReview: bool('attach Google Maps review link') }),
    run: async (a, { tid, tenant }) => { const fu = { ...(tenant?.followup || {}) }; if (a.enabled != null) fu.enabled = !!a.enabled; if (a.delayMins != null) fu.delayMins = Number(a.delayMins) || 60; if (a.text != null) fu.text = a.text; if (a.includeReview != null) fu.includeReview = !!a.includeReview; await db.updateTenant(tid, { followup: fu }); return { ok: true } } },
  { name: 'set_menu_mode', risk: 'confirm', description: "Menu mode: 'order' (full ordering) or 'browse' (display-only: guests browse, build a show-the-waiter list, and register for WhatsApp updates — no order submission).", parameters: obj({ mode: str('order|browse') }, ['mode']),
    run: async (a, { tid }) => { if (!['order', 'browse'].includes(a.mode)) return { error: 'mode must be order|browse' }; await db.updateTenant(tid, { menuMode: a.mode }); return { ok: true } } },
  { name: 'set_waiter_call', risk: 'confirm', description: 'Enable/disable the waiter-call button (with note) on table QR menus.', parameters: obj({ enabled: bool('') }, ['enabled']),
    run: async (a, { tid }) => { await db.updateTenant(tid, { waiterCallEnabled: !!a.enabled }); return { ok: true } } },
  { name: 'set_cart_total_style', risk: 'confirm', description: "Marketing display of the cart TOTAL: 'normal' | 'bold' (big) | 'small' | 'faint' | 'hidden'.", parameters: obj({ style: str('normal|bold|small|faint|hidden') }, ['style']),
    run: async (a, { tid }) => { if (!['normal', 'bold', 'small', 'faint', 'hidden'].includes(a.style)) return { error: 'invalid style' }; await db.updateTenant(tid, { cartTotalStyle: a.style }); return { ok: true } } },
  { name: 'set_banner_fade', risk: 'confirm', description: "Banner melt-into-menu fade: direction 'bottom'|'top'|'both'|'none' and strength 0..1.", parameters: obj({ direction: str('bottom|top|both|none'), strength: num('0..1') }),
    run: async (a, { tid }) => { const patch = {}; if (['bottom', 'top', 'both', 'none'].includes(a.direction)) patch.bannerFadeDir = a.direction; if (a.strength != null) patch.bannerGradient = Math.max(0, Math.min(1, Number(a.strength))); if (!Object.keys(patch).length) return { error: 'nothing to change' }; await db.updateTenant(tid, patch); return { ok: true } } },
  { name: 'set_featured_config', risk: 'confirm', description: "Featured strip: mode 'manual' (starred items) or 'auto' (best-sellers), how many (4-12), and card look 'soft'|'plain'|'circle'.", parameters: obj({ mode: str('manual|auto'), count: num('4-12'), look: str('soft|plain|circle') }),
    run: async (a, { tid }) => { const patch = {}; if (['manual', 'auto'].includes(a.mode)) patch.featuredMode = a.mode; if (a.count != null) patch.featuredCount = Math.min(12, Math.max(4, Number(a.count) || 8)); if (['soft', 'plain', 'circle'].includes(a.look)) patch.featuredStyle = a.look; if (!Object.keys(patch).length) return { error: 'nothing to change' }; await db.updateTenant(tid, patch); return { ok: true } } },
  { name: 'set_member_card_design', risk: 'confirm', description: "VIP card design: template 'metal'|'glass'|'noir', showLogo true/false.", parameters: obj({ template: str('metal|glass|noir'), showLogo: bool('') }),
    run: async (a, { tid, tenant }) => { const d = { ...(tenant?.memberCardDesign || {}) }; if (['metal', 'glass', 'noir'].includes(a.template)) d.template = a.template; if (a.showLogo != null) d.showLogo = !!a.showLogo; await db.updateTenant(tid, { memberCardDesign: d }); return { ok: true } } },
  { name: 'set_customer_optout', risk: 'confirm', description: 'Opt a customer OUT of (or back INTO) marketing messages, by phone.', parameters: obj({ phone: str('customer phone'), optOut: bool('true = stop messaging them') }, ['phone', 'optOut']),
    run: async (a, { tid }) => { const c = await db.getCustomerByPhone(tid, a.phone); if (!c) return { error: 'customer not found' }; await db.updateCustomer(tid, a.phone, { optOut: !!a.optOut }); return { ok: true } } },
  { name: 'set_item_promo_tag', risk: 'confirm', description: "Per-item promo tag: who gets auto-notified about this item — 'default' | 'members' | 'all' | 'off'. Identify by itemId or itemName.", parameters: obj({ itemId: str('id'), itemName: str('name (fallback)'), promoNotify: str('default|members|all|off') }, ['promoNotify']),
    run: async (a, { tid }) => { const it = await resolveItem(tid, a); if (!it) return { error: 'item not found — call list_items first' }; if (!['default', 'members', 'all', 'off'].includes(a.promoNotify)) return { error: 'invalid promoNotify' }; await db.saveItem(tid, it.id, { promoNotify: a.promoNotify }); return { ok: true, id: it.id } } },

  // ============ TABLES — status & advance booking ============
  { name: 'table_status', risk: 'safe', description: 'Live status of every dine-in table: free, occupied (unpaid order) or reserved (booking today).', parameters: obj({}),
    run: async (_a, { tid }) => { const [tables, active, resv] = await Promise.all([db.listTables(tid), db.listActiveOrders(tid), db.listReservations(tid, 100)]); const occ = new Set(active.filter((o) => o.tableId && !['paid', 'cancelled', 'refunded'].includes(o.status)).map((o) => o.tableId)); const today = new Date().toISOString().slice(0, 10); const res = new Set(resv.filter((r) => r.kind === 'table' && r.tableId && ['requested', 'confirmed'].includes(r.status) && (!r.date || r.date === today)).map((r) => r.tableId)); return tables.map((t) => ({ id: t.id, label: t.label, seats: t.seats || 4, status: occ.has(t.id) ? 'occupied' : res.has(t.id) ? 'reserved' : 'free' })) } },
  { name: 'book_table', risk: 'confirm', description: 'Create an advance table booking (name, party size required; phone/date/time/table optional).', parameters: obj({ name: str('guest name'), phone: str('phone'), partySize: num('party size'), date: str('YYYY-MM-DD'), time: str('HH:mm'), tableId: str('table id'), tableLabel: str('table label') }, ['name', 'partySize']),
    run: async (a, { tid }) => { const r = await db.createReservation(tid, { kind: 'table', name: a.name, phone: a.phone || '', partySize: Number(a.partySize) || 1, date: a.date || '', time: a.time || '', tableId: a.tableId || null, tableLabel: a.tableLabel || '' }); return { ok: true, id: r.id, code: r.code } } },

  // ============ STAFF decisions ============
  { name: 'list_staff', risk: 'safe', description: 'List team members with role and active status.', parameters: obj({}),
    run: async (_a, { tid }) => (await db.listStaff(tid)).map((s) => ({ uid: s.uid, name: s.name || s.displayName || '', role: s.role || '', active: s.active !== false })) },
  { name: 'list_leave_requests', risk: 'safe', description: 'List staff leave requests with status.', parameters: obj({}),
    run: async (_a, { tid }) => (await db.listLeaves(tid, 100)).map((l) => ({ id: l.id, staff: l.staffName || l.staffUid, from: l.from || l.startDate || '', to: l.to || l.endDate || '', status: l.status, reason: l.reason || '' })) },
  { name: 'decide_leave', risk: 'confirm', description: 'Approve or decline a staff leave request.', parameters: obj({ leaveId: str('leave id'), approve: bool('true=approve, false=decline') }, ['leaveId', 'approve']),
    run: async (a, { tid }) => { await db.setLeaveStatus(tid, a.leaveId, a.approve ? 'approved' : 'declined'); return { ok: true } } },
  { name: 'set_staff_active', risk: 'confirm', description: 'Enable or suspend a staff member.', parameters: obj({ uid: str('staff uid'), active: bool('') }, ['uid', 'active']),
    run: async (a, { tid }) => { await db.setStaffActive(tid, a.uid, !!a.active); return { ok: true } } },
  { name: 'post_announcement', risk: 'confirm', description: 'Post a venue-wide announcement to all staff.', parameters: obj({ title: str('title'), body: str('message') }, ['body']),
    run: async (a, { tid, actor }) => { await db.addAnnouncement(tid, { title: a.title || '', body: a.body, by: actor }); return { ok: true } } },
  { name: 'set_role_permissions', risk: 'danger', description: 'Set which capability keys a ROLE has, venue-wide (role e.g. cashier|waiter|kitchen|supervisor).', parameters: obj({ role: str('role key'), caps: arr(str('capability key'), 'capabilities') }, ['role', 'caps']),
    run: async (a, { tid, tenant }) => { const rc = { ...(tenant?.roleCaps || {}) }; rc[a.role] = a.caps || []; await db.updateTenant(tid, { roleCaps: rc }); return { ok: true, role: a.role, caps: a.caps } } },

  // ============ NEW WRITE ACTIONS - RECIPES, PURCHASES & SUPPLIERS ============
  { name: 'add_recipe_ingredient', risk: 'confirm', description: 'Add or update a material in an item\'s recipe.', parameters: obj({ itemId: str('item id'), materialId: str('material id'), qty: num('quantity in base unit') }, ['itemId', 'materialId', 'qty']),
    run: async (a, { tid }) => { await db.addRecipeIngredient(tid, a.itemId, a.materialId, a.qty); return { ok: true } } },
  { name: 'remove_recipe_ingredient', risk: 'confirm', description: 'Remove a material from an item\'s recipe.', parameters: obj({ itemId: str('item id'), materialId: str('material id') }, ['itemId', 'materialId']),
    run: async (a, { tid }) => { await db.removeRecipeIngredient(tid, a.itemId, a.materialId); return { ok: true } } },
  { name: 'set_variant_recipe', risk: 'confirm', description: 'Set custom recipe for a variant (e.g. large size).', parameters: obj({ itemId: str('item id'), variantKey: str('variant key (e.g. v0)'), recipe: recipeArr }, ['itemId', 'variantKey', 'recipe']),
    run: async (a, { tid }) => { const recipe = (a.recipe || []).map((l) => ({ materialId: l.materialId, qty: Number(l.qty) || 0 })); await db.setVariantRecipe(tid, a.itemId, a.variantKey, recipe); return { ok: true } } },
  { name: 'link_barcode_to_material', risk: 'confirm', description: 'Link a barcode string to a raw material.', parameters: obj({ materialId: str('material id'), barcode: str('barcode value') }, ['materialId', 'barcode']),
    run: async (a, { tid }) => { await db.linkBarcodeToMaterial(tid, a.materialId, a.barcode); return { ok: true } } },
  { name: 'mark_material_as_opened', risk: 'confirm', description: 'Mark a material as opened and calculate expiry date based on shelf life days.', parameters: obj({ materialId: str('material id'), shelfLifeDays: num('shelf life in days') }, ['materialId', 'shelfLifeDays']),
    run: async (a, { tid }) => { await db.markMaterialAsOpened(tid, a.materialId, a.shelfLifeDays); return { ok: true } } },
  { name: 'create_purchase_order', risk: 'confirm', description: 'Create a draft purchase order with lines (materialId + qty + cost).', parameters: obj({ supplierId: str('supplier id'), items: arr(obj({ materialId: str('material id'), qty: num('quantity'), cost: num('unit cost or total line cost') }, ['materialId', 'qty']), 'lines') }, ['supplierId', 'items']),
    run: async (a, { tid }) => { const items = (a.items || []).map((i) => ({ materialId: i.materialId, qty: Number(i.qty) || 0, cost: Number(i.cost) || 0 })); const res = await db.createPurchaseOrder(tid, { supplierId: a.supplierId, items }); return { ok: true, id: res.id, code: res.code } } },
  { name: 'update_purchase_order_status', risk: 'confirm', description: 'Update a purchase order status (draft|sent|received|cancelled).', parameters: obj({ poId: str('po id'), status: str('status') }, ['poId', 'status']),
    run: async (a, { tid }) => { await db.updatePurchaseOrderStatus(tid, a.poId, a.status); return { ok: true } } },
  { name: 'receive_purchase_order_shipment', risk: 'confirm', description: 'Receive shipment for a purchase order (adds items to stockQty + updates average cost).', parameters: obj({ poId: str('po id') }, ['poId']),
    run: async (a, { tid, actor }) => { await db.receivePurchaseOrderShipment(tid, a.poId, actor); return { ok: true } } },
  { name: 'log_supplier_payment', risk: 'confirm', description: 'Record a cash payment made to a supplier.', parameters: obj({ supplierId: str('supplier id'), amount: num('amount paid'), note: str('note') }, ['supplierId', 'amount']),
    run: async (a, { tid }) => { await db.addSupplierPayment(tid, a.supplierId, a.amount, a.note); return { ok: true } } },

  { name: 'list_menu_themes', risk: 'safe', description: 'List every REAL menu theme (skin) id + name, plus valid fonts, layouts, and shapes. ALWAYS call this before update_venue_branding when changing the theme/font/layout so you use a valid id.',
    parameters: obj({}),
    run: async () => ({
      skins: SKINS.map((s) => ({ id: s.id, name: s.name?.ar || s.name?.en || s.id })),
      fonts: FONT_OPTIONS.map((f) => ({ key: f.key, label: f.label })),
      layouts: LAYOUT_OPTIONS,
      shapes: SHAPE_OPTIONS,
      systemThemes: SYSTEM_THEMES.map((t) => ({ id: t.id, name: t.ar })),
    }) },

  { name: 'update_venue_branding', risk: 'confirm', description: `Update the digital menu design precisely. ONLY the fields you pass change — everything else is preserved. Valid skinId: ${SKIN_IDS.join('|')}. Valid font keys: ${FONT_KEYS.join('|')}. Valid menuLayout: ${LAYOUT_OPTIONS.join('|')}. Valid shape: ${SHAPE_OPTIONS.join('|')}. If unsure of ids, call list_menu_themes first.`,
    parameters: obj({
      themeColor: str('brand primary color (e.g. #7c2d2d)'),
      themeAccent: str('brand accent contrast color (e.g. #2a1212)'),
      themePreset: str('gradient preset name (e.g. maroon, gold, forest, dark)'),
      skinId: str('menu theme (skin) id — MUST be one of the real ids listed in the tool description'),
      font: str('font KEY (lowercase) — one of the real keys listed in the tool description'),
      shape: str('button/card border style (sharp|soft|round|pill)'),
      menuLayout: str('menu layout id — one of the real ids listed in the tool description'),
      gradEnabled: bool('true if background gradient is enabled'),
      gradC1: str('first gradient color'),
      gradC2: str('second gradient color'),
      gradAngle: num('gradient rotation angle (in degrees)'),
      bannerStyle: str('header banner border/style (full|rounded|card|tall)'),
      immersiveBgUrl: str('optional full background image URL'),
      immersiveBgOpacity: num('transparency of immersive background (0 to 1)'),
      bgImageUrl: str('optional tiled/centered background texture URL'),
      bgOpacity: num('background texture opacity'),
    }),
    run: async (a, { tid, tenant }) => {
      // HARD VALIDATION: an invalid id must FAIL LOUDLY with the valid list —
      // the old version silently "succeeded" and the menu never changed.
      if (a.skinId && !SKIN_IDS.includes(a.skinId)) return { ok: false, error: `skinId "${a.skinId}" غير موجود`, validSkinIds: SKIN_IDS }
      if (a.font && !FONT_KEYS.includes(a.font)) return { ok: false, error: `font "${a.font}" غير موجود — استخدم المفاتيح الصغيرة`, validFonts: FONT_KEYS }
      if (a.menuLayout && !LAYOUT_OPTIONS.includes(a.menuLayout)) return { ok: false, error: `menuLayout "${a.menuLayout}" غير موجود`, validLayouts: LAYOUT_OPTIONS }
      if (a.shape && !SHAPE_OPTIONS.includes(a.shape)) return { ok: false, error: `shape "${a.shape}" غير موجود`, validShapes: SHAPE_OPTIONS }

      // Precise merge: touch ONLY what was provided; existing values are kept.
      const prevOv = tenant?.skin?.overrides || {}
      const skinOverrides = {
        ...prevOv,
        ...(a.themeColor ? { brand: a.themeColor } : {}),
        ...(a.themeAccent ? { accent: a.themeAccent } : {}),
        ...(a.font ? { font: a.font } : {}),
        ...(a.shape ? { shape: a.shape } : {}),
        ...(a.menuLayout ? { menuLayout: a.menuLayout } : {}),
      }
      const patch = {
        skin: { ...(tenant?.skin || {}), skinId: a.skinId || tenant?.skin?.skinId || 'classic', overrides: skinOverrides },
      }
      if (a.themeColor) patch.themeColor = a.themeColor
      if (a.themeAccent) patch.themeAccent = a.themeAccent
      if (a.themePreset) patch.themePreset = a.themePreset
      if (a.gradEnabled !== undefined) patch.gradEnabled = !!a.gradEnabled
      if (a.gradC1) patch.gradC1 = a.gradC1
      if (a.gradC2) patch.gradC2 = a.gradC2
      if (a.gradAngle !== undefined) patch.gradAngle = Number(a.gradAngle) || 135
      if (a.bannerStyle) patch.bannerStyle = a.bannerStyle
      if (a.immersiveBgUrl) patch.immersiveBgUrl = a.immersiveBgUrl
      if (a.immersiveBgOpacity !== undefined) patch.immersiveBgOpacity = Number(a.immersiveBgOpacity) || 0.5
      if (a.bgImageUrl) patch.bgImageUrl = a.bgImageUrl
      if (a.bgOpacity !== undefined) patch.bgOpacity = Number(a.bgOpacity) || 0.15
      await db.updateTenant(tid, patch)
      const changed = Object.keys(a).filter((k) => a[k] !== undefined)
      return { ok: true, changed, applied: a.skinId ? `الثيم الآن: ${a.skinId}` : 'تم تطبيق التعديلات المحددة فقط' }
    }
  },

  { name: 'set_system_theme', risk: 'confirm', description: `Change the BACK-OFFICE system theme (admin/cashier/kitchen look) — separate from the customer menu theme. Valid ids: ${SYSTHEME_IDS.join('|')}. Optional section: admin|cashier|kds (omit = all).`,
    parameters: obj({ themeId: str('system theme id'), section: str('admin|cashier|kds (optional — omit for global)') }, ['themeId']),
    run: async (a, { tid, tenant }) => {
      if (!SYSTHEME_IDS.includes(a.themeId)) return { ok: false, error: `themeId "${a.themeId}" غير موجود`, valid: SYSTHEME_IDS }
      const sections = THEMEABLE_SECTIONS.map((s) => s.id)
      if (a.section && !sections.includes(a.section)) return { ok: false, error: 'section غير صحيح', valid: sections }
      if (a.section) {
        const by = { ...(tenant?.systemThemeBy || {}), [a.section]: a.themeId }
        await db.updateTenant(tid, { systemThemeBy: by })
      } else {
        await db.updateTenant(tid, { systemTheme: a.themeId, systemThemeBy: {} })
      }
      return { ok: true, applied: `ثيم النظام${a.section ? ` (${a.section})` : ''}: ${a.themeId}` }
    } },

  { name: 'generate_image', risk: 'confirm', description: 'Generate a professional marketing/menu image with AI (nano-banana) from an Arabic/English description, optionally using an existing item photo as the product reference. The image is uploaded to the venue media library and its URL returned.',
    parameters: obj({ description: str('what the image should look like (style, mood, composition)'), itemName: str('optional: menu item whose photo is the product reference') }, ['description']),
    run: async (a, { tid, tenant }) => {
      const { generatePostImage } = await import('./postGen.js')
      let refs = []
      if (a.itemName) {
        const items = await db.listItems(tid)
        const hit = items.find((i) => (i.nameAr || '').includes(a.itemName) || (i.nameEn || '').toLowerCase().includes(String(a.itemName).toLowerCase()))
        if (!hit) return { ok: false, error: `لا صنف باسم "${a.itemName}"` }
        if (!hit.imageUrl) return { ok: false, error: `الصنف "${hit.nameAr || hit.nameEn}" بلا صورة لاستخدامها مرجعاً` }
        refs = [hit.imageUrl]
      }
      const blob = await generatePostImage({ itemImageUrls: refs, stylePrompt: a.description, venueName: tenant?.name || '', tenant })
      const file = new File([blob], `ai-${Date.now()}.png`, { type: blob.type || 'image/png' })
      const url = await uploadImage(tid, file, 'library')
      await db.logMedia(tid, { url, kind: 'image', name: file.name, size: file.size, contentType: file.type })
      return { ok: true, url, note: 'الصورة في المكتبة الآن — استخدمها لأي صنف أو منشور أو خلفية' }
    } },

  { name: 'edit_attached_images', risk: 'confirm', description: 'Generate a NEW professional image FROM the photos the user attached to THIS chat message (e.g. a product photo + the venue logo) following their description. Use whenever the user uploads image(s) and asks to design/edit/compose from them. Result is uploaded to the media library; optionally also set it as an item photo by passing itemName.',
    parameters: obj({ description: str('what to create from the attached photos (style, composition, where the logo goes...)'), itemName: str('optional: also set the result as this item\'s photo'), imitate: bool('true when the user wants the attached design REPLICATED exactly with only the described changes') }, ['description']),
    run: async (a, { tid, tenant, attachments }) => {
      const imgs = (attachments || []).filter((x) => x.kind === 'image' && x.data).map((x) => ({ mimeType: x.mime || 'image/jpeg', data: x.data }))
      if (!imgs.length) return { ok: false, error: 'لا توجد صور مرفقة مع الرسالة — اطلب من المستخدم إرفاق الصور أولاً' }
      const { generateFromInlineRefs } = await import('./postGen.js')
      const blob = await generateFromInlineRefs({ inlineRefs: imgs, stylePrompt: a.description, venueName: tenant?.name || '', tenant, imitate: !!a.imitate })
      const file = new File([blob], `ai-edit-${Date.now()}.png`, { type: blob.type || 'image/png' })
      const url = await uploadImage(tid, file, 'library')
      await db.logMedia(tid, { url, kind: 'image', name: file.name, size: file.size, contentType: file.type })
      if (a.itemName) {
        const items = await db.listItems(tid)
        const hit = items.find((i) => (i.nameAr || '').includes(a.itemName) || (i.nameEn || '').toLowerCase().includes(String(a.itemName).toLowerCase()))
        if (hit) { await db.saveItem(tid, hit.id, { imageUrl: url }); return { ok: true, url, applied: `الصورة الجديدة على الصنف: ${hit.nameAr || hit.nameEn}` } }
        return { ok: true, url, note: `وُلِّدت وحُفظت في المكتبة، لكن لا صنف باسم "${a.itemName}"` }
      }
      return { ok: true, url, note: 'الصورة في المكتبة — جاهزة للاستخدام في أي مكان' }
    } },

  { name: 'set_item_image_ai', risk: 'confirm', description: 'Generate a new AI product image for a menu item (using its current photo as reference when available) and set it as the item photo.',
    parameters: obj({ itemName: str('item name'), description: str('desired style, e.g. لقطة استوديو فاخرة بخلفية رخامية') }, ['itemName', 'description']),
    run: async (a, { tid, tenant }) => {
      const items = await db.listItems(tid)
      const hit = items.find((i) => (i.nameAr || '').includes(a.itemName) || (i.nameEn || '').toLowerCase().includes(String(a.itemName).toLowerCase()))
      if (!hit) return { ok: false, error: `لا صنف باسم "${a.itemName}"` }
      const { generatePostImage } = await import('./postGen.js')
      const blob = await generatePostImage({ itemImageUrls: hit.imageUrl ? [hit.imageUrl] : [], stylePrompt: a.description, venueName: tenant?.name || '', tenant })
      const file = new File([blob], `item-ai-${Date.now()}.png`, { type: blob.type || 'image/png' })
      const url = await uploadImage(tid, file)
      await db.saveItem(tid, hit.id, { imageUrl: url })
      return { ok: true, url, applied: `صورة جديدة للصنف: ${hit.nameAr || hit.nameEn}` }
    } },

  { name: 'upload_attached_image', risk: 'confirm', description: 'Upload an attached image AS-IS, without any cropping, to Storage and return its public URL. This is the DEFAULT for setting a product photo. Only use crop_and_upload_image instead when the user EXPLICITLY asks to crop/cut a region.',
    parameters: obj({ imageIndex: num('0-based index of the attached image (usually 0)'), label: str('descriptive filename e.g. "latte"') }, ['imageIndex']),
    run: async (a, { tid, attachments }) => {
      const att = attachments?.[a.imageIndex]
      if (!att || att.kind !== 'image' || !att.data) throw new Error(`No image attachment found at index ${a.imageIndex}`)
      const mime = att.mime || 'image/jpeg'
      const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      const fileObj = new File([b64ToBlob(att.data, mime)], `${a.label || 'photo'}-${Date.now()}.${ext}`, { type: mime })
      const url = await uploadImage(tid, fileObj, 'items')
      return { ok: true, imageUrl: url }
    } },
  { name: 'crop_and_upload_image', risk: 'confirm', description: 'Crop a specific region of an attached image and upload it. Use ONLY when the user explicitly asks to crop/cut a region — otherwise use upload_attached_image (no crop). Returns the public URL.',
    parameters: obj({
      imageIndex: num('0-based index of the attached image (usually 0)'),
      ymin: num('normalized top coordinate (0 to 1000)'),
      xmin: num('normalized left coordinate (0 to 1000)'),
      ymax: num('normalized bottom coordinate (0 to 1000)'),
      xmax: num('normalized right coordinate (0 to 1000)'),
      label: str('descriptive label for filename e.g. "latte", "bg"'),
    }, ['imageIndex', 'ymin', 'xmin', 'ymax', 'xmax']),
    run: async (a, { tid, attachments }) => {
      const att = attachments?.[a.imageIndex]
      if (!att || att.kind !== 'image' || !att.data) throw new Error(`No image attachment found at index ${a.imageIndex}`)
      const blob = await cropBase64(att.data, att.mime, {
        ymin: a.ymin,
        xmin: a.xmin,
        ymax: a.ymax,
        xmax: a.xmax
      })
      const fileObj = new File([blob], `${a.label || 'crop'}-${Date.now()}.webp`, { type: 'image/webp' })
      const url = await uploadImage(tid, fileObj, 'items')
      return { ok: true, imageUrl: url }
    }
  },

  // ============ SIMPLIFICATION — archive, dedupe, templates, domains, permissions, delivery, orientation ============
  { name: 'archive_item', risk: 'confirm', description: 'Archive a menu item: hidden from the menu but kept with all its data (sales history, recipe, photo). Reversible any time via restore_item. Identify by itemName (or itemId).', parameters: obj({ itemName: str('item name'), itemId: str('id (optional)') }),
    run: async (a, { tid }) => { const r = await resolveItemStrict(tid, a); if (!r.item) return r; await db.saveItem(tid, r.item.id, { archived: true, available: false }); return { ok: true, id: r.item.id, message: `تمت أرشفة «${r.item.nameAr}» — اختفى من المنيو مع بقاء كل بياناته، ويمكن استرجاعه في أي وقت` } } },
  { name: 'restore_item', risk: 'confirm', description: 'Restore an archived menu item back to the live menu (also marks it available). Identify by itemName (or itemId).', parameters: obj({ itemName: str('item name'), itemId: str('id (optional)') }),
    run: async (a, { tid }) => { const r = await resolveItemStrict(tid, a); if (!r.item) return r; await db.saveItem(tid, r.item.id, { archived: false, available: true }); return { ok: true, id: r.item.id, message: `تم استرجاع «${r.item.nameAr}» إلى المنيو وهو متاح الآن` } } },

  { name: 'merge_customers', risk: 'danger', description: 'Merge a DUPLICATE customer record into the PRIMARY one (orders, spend, drinks, loyalty and rewards are summed; membership is kept from whichever is active; the duplicate record is DELETED). Irreversible — confirm the two phone numbers with the manager first.', parameters: obj({ primaryPhone: str('phone of the customer to KEEP'), duplicatePhone: str('phone of the duplicate to merge then delete') }, ['primaryPhone', 'duplicatePhone']),
    run: async (a, { tid }) => { await db.mergeCustomers(tid, a.primaryPhone, a.duplicatePhone); return { ok: true, message: `تم تنفيذ الدمج: سجل ${a.duplicatePhone} دُمج في ${a.primaryPhone} وحُذف السجل المكرر. تنبيه: هذا الإجراء نهائي ولا يمكن التراجع عنه.` } } },

  { name: 'set_message_template', risk: 'confirm', description: "Set the venue's own wording for one automated WhatsApp message. templateKey: orderStatus (تحديث حالة الطلب) | receipt (الفاتورة) | welcome (ترحيب العضوية) | upgrade (ترقية العضوية) | birthday (عيد الميلاد) | offers (عرض جديد) | featured (تمييز صنف) | newItems (أصناف جديدة). Placeholders usable inside the text: {الاسم} {المنشأة} {الصنف} {الكود} {الطلب} {الحالة} {المبلغ} {الرابط} {العضوية}. Empty text clears the key back to the default wording.", parameters: obj({ templateKey: str('orderStatus|receipt|welcome|upgrade|birthday|offers|featured|newItems'), text: str('template text — empty/omitted to reset to default') }, ['templateKey']),
    run: async (a, { tid, tenant }) => { if (!MSG_TEMPLATE_KEYS.includes(a.templateKey)) return { error: `مفتاح قالب غير معروف — المفاتيح الصحيحة: ${MSG_TEMPLATE_KEYS.join(', ')}` }; const t = tenant || await db.getTenant(tid); const tpl = { ...(t?.msgTemplates || {}) }; const txt = String(a.text || '').trim(); if (txt) tpl[a.templateKey] = txt; else delete tpl[a.templateKey]; await db.updateTenant(tid, { msgTemplates: tpl }); return { ok: true, message: txt ? `تم حفظ قالب «${a.templateKey}» — سيُستخدم نصك في كل رسالة قادمة من هذا النوع` : `أُعيد قالب «${a.templateKey}» إلى الصياغة الافتراضية` } } },

  { name: 'get_domain_info', risk: 'safe', description: "The venue's web addresses: the automatic platform subdomain (slug.platform), the shared menu link, and every custom-domain request with its status (pending = awaiting DNS + platform activation, active = live) plus the CNAME target to point DNS at.", parameters: obj({}),
    run: async (_a, { tid, tenant }) => {
      const t = tenant || await db.getTenant(tid)
      const slug = t?.slug || ''
      const s = await getDocs(query(collection(fsdb, 'domains'), where('tenantId', '==', tid)))
      const domains = s.docs.map((d) => ({ id: d.id, ...d.data() }))
      domains.sort((x, y) => (y.createdAt?.toMillis?.() || 0) - (x.createdAt?.toMillis?.() || 0))
      return {
        subdomain: slug ? `${slug}.${PLATFORM_APEX}` : null,
        menuUrl: slug ? `${publicBaseUrl()}/m/${slug}` : null,
        customDomains: domains.map((d) => ({ host: d.id, status: d.status, type: d.type || 'custom' })),
        cnameTarget: DOMAIN_CNAME_TARGET,
        note: `النطاق الفرعي التلقائي يعمل مباشرة بدون إعداد. النطاق الخاص: وجّه CNAME إلى ${DOMAIN_CNAME_TARGET} ثم تفعّله المنصة (الحالة pending حتى التفعيل).`,
      }
    } },

  { name: 'set_staff_permissions', risk: 'danger', description: "Permissions engineer: adjust ONE staffer's capabilities by name/email — grant with add, revoke with remove, or resetToRole=true to wipe the custom override back to the role default. NEVER works on owner/manager (always full access). Valid capability keys: take_orders, cancel_order, refund, print, kitchen, scan_tickets, manage_menu, manage_offers, manage_events, manage_tables, view_reports, view_customers, view_complaints, manage_staff, manage_payroll, view_performance, manage_settings, attendance, deliver, manage_campaigns, manage_loyalty, manage_appearance, manage_stories, manage_inventory, manage_integrations, use_assistant, view_revenue, edit_prices, export_data.", parameters: obj({ staffName: str('staffer name or email (from list_staff)'), add: arr(str('capability key'), 'caps to grant'), remove: arr(str('capability key'), 'caps to revoke'), resetToRole: bool('true = drop the custom override, return to role defaults') }, ['staffName']),
    run: async (a, { tid, tenant }) => {
      const t = tenant || await db.getTenant(tid)
      const r = await resolveStaff(tid, a.staffName)
      if (!r.staff) return r
      const s = r.staff
      if (s.role === 'owner' || s.role === 'manager') return { error: 'لا يمكن تعديل صلاحيات المالك أو المدير — صلاحياتهما كاملة دائماً' }
      const label = (c) => CAP_LABELS[c]?.ar || c
      if (a.resetToRole) {
        const defs = roleDefaultCaps(s.role || 'staff', t?.roleCaps)
        await db.setStaffCaps(tid, s.uid, defs, false)
        return { ok: true, message: `أُعيدت صلاحيات ${staffLabel(s)} إلى افتراضي دوره (${roleName(s.role || 'staff', 'ar')})`, caps: defs.map(label) }
      }
      const valid = Object.values(CAP)
      const bad = [...(a.add || []), ...(a.remove || [])].filter((c) => !valid.includes(c))
      if (bad.length) return { error: `مفاتيح صلاحيات غير معروفة: ${bad.join(', ')}`, validCaps: valid }
      if (!(a.add || []).length && !(a.remove || []).length) return { error: 'حدد صلاحيات للإضافة (add) أو الإزالة (remove) أو resetToRole' }
      const set = new Set(effectiveCaps(s.role || 'staff', s.caps, t?.roleCaps))
      ;(a.add || []).forEach((c) => set.add(c))
      ;(a.remove || []).forEach((c) => set.delete(c))
      const next = [...set]
      await db.setStaffCaps(tid, s.uid, next, true)
      return { ok: true, message: `تم تحديث صلاحيات ${staffLabel(s)} (${roleName(s.role || 'staff', 'ar')}) — صلاحياته الآن مخصصة له شخصياً`, caps: next.map(label) }
    } },
  { name: 'list_staff_permissions', risk: 'safe', description: "Staff permissions overview. Without staffName: every staffer with role + effective caps count. With staffName: that staffer's full capability list (Arabic labels) and whether it's a personal override or the role default.", parameters: obj({ staffName: str('optional: one staffer by name/email') }),
    run: async (a, { tid, tenant }) => {
      const t = tenant || await db.getTenant(tid)
      const label = (c) => CAP_LABELS[c]?.ar || c
      if (a.staffName) {
        const r = await resolveStaff(tid, a.staffName)
        if (!r.staff) return r
        const s = r.staff
        const caps = effectiveCaps(s.role || 'staff', s.caps, t?.roleCaps)
        return { name: staffLabel(s), role: roleName(s.role || 'staff', 'ar'), source: s.capsCustom ? 'صلاحيات مخصصة لهذا الموظف' : 'افتراضي الدور', custom: !!s.capsCustom, caps: caps.map(label) }
      }
      return (await db.listStaff(tid)).map((s) => ({ name: staffLabel(s), role: roleName(s.role || 'staff', 'ar'), custom: !!s.capsCustom, capsCount: effectiveCaps(s.role || 'staff', s.caps, t?.roleCaps).length }))
    } },

  { name: 'set_delivery_zones', risk: 'confirm', description: 'Set tiered delivery-fee zones: each zone = maxKm (outer distance) + fee (charged up to that distance). REPLACES the existing zones, sorted by distance. The map in Settings → التوصيل draws them visually.', parameters: obj({ zones: arr(obj({ maxKm: num('zone outer distance in km'), fee: num('delivery fee within this zone') }, ['maxKm', 'fee']), 'zones, e.g. [{maxKm:3,fee:5},{maxKm:7,fee:12}]') }, ['zones']),
    run: async (a, { tid, tenant }) => { const t = tenant || await db.getTenant(tid); const zones = (a.zones || []).map((z) => ({ maxKm: Number(z.maxKm) || 0, fee: Math.max(0, Number(z.fee) || 0) })).filter((z) => z.maxKm > 0).sort((x, y) => x.maxKm - y.maxKm); if (!zones.length) return { error: 'حدد منطقة واحدة على الأقل بمسافة أكبر من صفر' }; await db.updateTenant(tid, { delivery: { ...(t?.delivery || {}), zones } }); return { ok: true, zones, message: `تم حفظ ${zones.length} من مناطق التوصيل — تظهر بصرياً على الخريطة في الإعدادات > التوصيل` } } },
  { name: 'set_delivery_range', risk: 'confirm', description: 'Set the maximum delivery radius in km (orders beyond it are refused at checkout). The map in Settings → التوصيل draws the circle visually. Requires the venue location (set_venue_location).', parameters: obj({ radiusKm: num('radius in km — 0 removes the limit') }, ['radiusKm']),
    run: async (a, { tid, tenant }) => { const t = tenant || await db.getTenant(tid); const radiusKm = Math.max(0, Number(a.radiusKm) || 0); await db.updateTenant(tid, { delivery: { ...(t?.delivery || {}), radiusKm } }); return { ok: true, radiusKm, message: radiusKm ? `نطاق التوصيل الآن ${radiusKm} كم — يظهر كدائرة على الخريطة في الإعدادات > التوصيل` : 'أُزيل حد نطاق التوصيل' } } },
  { name: 'set_venue_location', risk: 'confirm', description: 'Set the venue GPS coordinates — used by the staff-attendance geofence and by delivery distance/zone fees.', parameters: obj({ lat: num('latitude, -90 to 90'), lng: num('longitude, -180 to 180') }, ['lat', 'lng']),
    run: async (a, { tid }) => { const lat = Number(a.lat); const lng = Number(a.lng); if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return { error: 'إحداثيات غير صحيحة — lat بين -90 و 90، وlng بين -180 و 180' }; await db.updateTenant(tid, { geo: { lat, lng } }); return { ok: true, message: `تم حفظ موقع المنشأة (${lat}, ${lng}) — يُستخدم في التحقق الجغرافي للحضور وحساب مسافة التوصيل` } } },

  { name: 'system_overview', risk: 'safe', description: 'One-call Arabic orientation digest of the whole system: the 5 main sections, the «المزيد» groups, global search, help center, and the first 5 things a new venue should do. Call for «كيف أستخدم النظام؟» or any general-orientation question, then answer from it.', parameters: obj({}),
    run: async () => ({ overview: [
      'الأقسام الخمسة الرئيسية (الشريط السفلي / الجانبي):',
      '1. الرئيسية /admin — لوحة اليوم: المبيعات، الطلبات النشطة، التنبيهات.',
      '2. الطلبات /admin/orders — استقبال الطلبات ومتابعة حالتها حتى التسليم.',
      '3. المنيو /admin/menu — التصنيفات والأصناف والأسعار والصور والوصفات.',
      '4. العمليات /admin/operations — الطاولات ورموز QR والتشغيل اليومي.',
      '5. الفريق /admin/hr — الموظفون والأدوار والحضور والرواتب.',
      '',
      'زر «المزيد» يجمع الباقي في مجموعات:',
      '- التسويق والعملاء: العملاء، الإعلانات والحملات، العروض والخصومات، استوديو التقييمات، استوديو المنشورات، سجل الرسائل والتحليلات، المكتبة، الاستوري، البروفايل والأخبار.',
      '- التشغيل اليومي: الكاشير، شاشة المطبخ، مسح التذاكر، المخزون والموردون، الشكاوى.',
      '- الفعاليات والحجوزات: الفعاليات والتذاكر، حجوزات الطاولات.',
      '- التقارير والتحليلات: التقارير، تقرير اليوم.',
      '- النظام والمساعدة: المساعد الذكي، شاشات العرض، الإعدادات، الفوترة والاشتراك، مركز المساعدة، الدعم، بوابتي.',
      '',
      'قدرات ذكاء بارزة: توليد صور بهوية منشأتك في (المكتبة، استوديو المنشورات، الاستوري، الأخبار، الفعاليات، محرر الصنف)، إزالة الخلفية، الواقع المعزز AR للأصناف، ومهندس الصلاحيات بالمحادثة.',
      '',
      'اختصارات تسهّل كل شيء: بحث شامل بضغطة Ctrl+K يفتح أي شاشة أو صنفاً أو عميلاً بالاسم، ومركز المساعدة في /admin/help فيه شروحات لكل ميزة، والمساعد الذكي ينفّذ معظم المهام بأمر واحد بدل التنقّل.',
      '',
      'أول 5 خطوات لمنشأة جديدة:',
      '1. أنشئ التصنيفات وأضف الأصناف بأسعارها وصورها من «المنيو».',
      '2. اضبط الهوية (الاسم، الألوان، الشعار) وحدّد الموقع الجغرافي من «الإعدادات».',
      '3. أضف الطاولات واطبع رموز QR من «العمليات» ليطلب الضيوف بأنفسهم.',
      '4. أضف موظفيك وحدّد أدوارهم وصلاحياتهم من «الفريق».',
      '5. فعّل الولاء أو العضويات وأنشئ أول عرض، ثم جرّب طلباً تجريبياً من رابط المنيو.',
    ].join('\n') }) },
]

export const ACTIONS_BY_NAME = Object.fromEntries(ACTIONS.map((a) => [a.name, a]))
export const TOOL_DECLARATIONS = ACTIONS.map((a) => ({ name: a.name, description: a.description, parameters: a.parameters }))
