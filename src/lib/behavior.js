// Guest-behavior analysis engine (RBT360) — PURE.
//
// No Firestore, no network, no React. Every function takes plain arrays of
// session docs (tenants/{tid}/sessions/{sid}), order docs and menu items, and
// returns plain objects. That makes all of it directly testable and safe to run
// on the client or inside a Cloud Function.
//
// TWO RULES THIS FILE OBEYS ABSOLUTELY:
//  1. ZERO invented numbers. Every figure is counted from the input. Nothing is
//     estimated, extrapolated, smoothed or benchmarked against an industry
//     average. A rate whose denominator is zero is `null`, never 0.
//  2. Thin data is LABELLED, never hidden. Any result computed from fewer than
//     the thresholds below carries { thin: true, sample: n } so a caller (or the
//     AI planner) cannot present three sessions as a trend.
//
// WHAT DWELL CAN AND CANNOT PROVE — repeated here because this file is what the
// AI reads: dwellMs is "the item detail was open while the tab was visible". It
// cannot distinguish a guest reading the description from a phone lying on the
// table, and it cannot see a guest looking at the printed menu. Treat high
// dwell + no order as a QUESTION worth asking the venue, not as a finding.

// ---------- thresholds (single place, referenced by every verdict) ----------
export const THRESHOLDS = {
  MEANINGFUL_DWELL_MS: 4000,  // below this an "item view" is a scroll-past, not interest
  QUICK_BOUNCE_MS: 2000,      // average dwell under this = opened and dismissed
  CONVERTS_WELL_RATE: 0.25,   // order-rate at or above this = the item sells itself
  HIGH_INTEREST_SHARE: 0.4,   // share of viewing sessions that lingered and never added
  THIN_SESSIONS: 20,          // fewer sessions than this = no reliable funnel
  THIN_ITEM_VIEWS: 5,         // fewer views than this = no reliable item verdict
  THIN_COHORT: 10,            // fewer sessions than this in a cohort = no reliable rate
}

export const AI_PLANNER_GUARD_AR = [
  'تعليمات صارمة وغير قابلة للتجاوز:',
  'أجب فقط من الأرقام المرفقة في هذا الملخص. لا تخترع أي رقم أو نسبة أو اسم صنف غير موجود فيه.',
  'إذا كان الرقم غير موجود، قل بوضوح: «هذه البيانات غير متوفرة» ولا تقدّر ولا تستنتج رقماً.',
  'إذا كان الحقل thin يساوي true أو كان حجم العينة sample صغيراً، فاذكر ذلك صراحةً قبل أي توصية،',
  'وقل إن العينة غير كافية للحكم.',
  'لا تقارن بمتوسطات السوق أو معايير خارجية — لا توجد لديك بيانات عنها.',
  'مدة البقاء (dwell) تعني أن الصنف كان مفتوحاً على الشاشة فقط، ولا تثبت اهتمام الضيف؛',
  'اعرضها كسؤال للمنشأة لا كحقيقة عن نية الضيف.',
  'الارتباط بين سلوك وآخر (مثل اللعب أو العرض ثلاثي الأبعاد) لا يعني السببية — اذكر ذلك عند المقارنة.',
  'اكتب بالعربية، وبأرقام لاتينية، وبدون رموز تعبيرية.',
].join(' ')

// ---------- small pure helpers ----------
const arr = (v) => (Array.isArray(v) ? v : [])
const numOr = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

// Firestore Timestamp | Date | ms number | ISO string -> ms, or null.
function ms(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'object') {
    if (typeof v.toMillis === 'function') { try { return v.toMillis() } catch (_) { return null } }
    if (Number.isFinite(v.seconds)) return v.seconds * 1000
  }
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null }
  return null
}

// A rate is ALWAYS reported with the two integers it came from, and is null when
// there is nothing to divide by. Callers must render "n of of" beside the rate.
function rate(n, of) {
  const a = Math.max(0, Math.round(numOr(n)))
  const b = Math.max(0, Math.round(numOr(of)))
  return { n: a, of: b, rate: b > 0 ? a / b : null }
}

// Last 9 digits — matches '9665xxxxxxx' against '05xxxxxxxx' without importing
// anything, so this file stays dependency-free.
function phoneKey(v) {
  const d = String(v || '').replace(/[^0-9]/g, '')
  return d ? d.slice(-9) : ''
}

const sessionItems = (s) => (s && s.items && typeof s.items === 'object' ? s.items : {})
const sessionCounts = (s) => (s && s.counts && typeof s.counts === 'object' ? s.counts : {})
const didOrder = (s) => !!(s && s.outcome && s.outcome.ordered)

// Item helpers shared by several reports.
const viewedIds = (s) => Object.keys(sessionItems(s)).filter((id) => numOr(sessionItems(s)[id].views) > 0)

function itemName(id, sessions, itemsIndex) {
  if (itemsIndex && itemsIndex[id]) return itemsIndex[id]
  for (const s of sessions) {
    const rec = sessionItems(s)[id]
    if (rec && rec.name) return rec.name
  }
  return ''
}

function indexItems(items) {
  const idx = {}
  for (const it of arr(items)) {
    const id = it && (it.id || it.itemId)
    if (!id) continue
    idx[id] = String(it.nameAr || it.name || it.nameEn || '')
  }
  return idx
}

// ---------- 1. one session, normalized ----------
export function sessionSummary(session) {
  if (!session || typeof session !== 'object') return null
  const s = session
  const started = numOr(s.startedAt)
  const counts = sessionCounts(s)
  const events = arr(s.events)

  // Ordered walk of where the guest actually went. Repeats collapsed so a
  // re-render storm does not look like ten page visits.
  const path = []
  for (const e of events) {
    if (!e || !['view', 'itemView', 'checkout', 'ordered', 'search'].includes(e.type)) continue
    const step = {
      t: numOr(e.t),
      kind: e.type === 'itemView' ? 'item' : e.type === 'view' ? 'page' : e.type,
      target: String(e.target || ''),
    }
    const prev = path[path.length - 1]
    if (prev && prev.kind === step.kind && prev.target === step.target) continue
    path.push(step)
  }

  const ordered = didOrder(s)
  const lastStep = path.length ? path[path.length - 1] : null
  const abandonedAt = s.outcome && s.outcome.abandonedAt ? String(s.outcome.abandonedAt) : null
  const dropOff = ordered
    ? null
    : (abandonedAt || (lastStep ? `${lastStep.kind}:${lastStep.target}` : null))

  const items = sessionItems(s)
  const ids = Object.keys(items)

  return {
    sid: String(s.sid || ''),
    deviceId: String(s.deviceId || ''),
    startedAt: started || null,
    lastAt: numOr(s.lastAt) || null,
    durationMs: numOr(s.durationMs),          // ACTIVE time (idle gaps already removed by the SDK)
    identified: !!(s.customerPhone || s.customerName),
    customerPhone: s.customerPhone || null,
    customerName: s.customerName || null,
    entry: s.entry || { table: null, source: '', ref: '' },
    device: s.device || null,
    counts: {
      views: numOr(counts.views), taps: numOr(counts.taps), itemViews: numOr(counts.itemViews),
      arOpens: numOr(counts.arOpens), gamePlays: numOr(counts.gamePlays),
      cartAdds: numOr(counts.cartAdds), cartRemoves: numOr(counts.cartRemoves),
      checkouts: numOr(counts.checkouts), searches: numOr(counts.searches),
    },
    path,
    lastStep,
    dropOff,
    itemsViewed: ids.filter((id) => numOr(items[id].views) > 0).length,
    itemsAdded: ids.filter((id) => numOr(items[id].added) > 0).length,
    totalDwellMs: ids.reduce((a, id) => a + numOr(items[id].dwellMs), 0),
    reachedCheckout: numOr(counts.checkouts) > 0,
    ordered,
    orderId: (s.outcome && s.outcome.orderId) || null,
    total: s.outcome && Number.isFinite(Number(s.outcome.total)) ? Number(s.outcome.total) : null,
    searches: arr(s.search).map((x) => ({ q: String(x.q || ''), results: numOr(x.results), at: ms(x.at) })),
    eventsTruncated: events.length >= 300, // the SDK caps at 300 — earlier steps may be missing
  }
}

// ---------- 2. funnel ----------
// Every stage carries its absolute count next to the two rates, so no rate can
// be quoted without its denominator.
export function funnel(sessions) {
  const list = arr(sessions)
  const total = list.length
  if (!total) return { sample: 0, thin: true, empty: true, stages: [], conversion: rate(0, 0) }

  const nViewed = list.filter((s) => numOr(sessionCounts(s).itemViews) > 0 || viewedIds(s).length > 0).length
  const nAdded = list.filter((s) => numOr(sessionCounts(s).cartAdds) > 0).length
  const nCheckout = list.filter((s) => numOr(sessionCounts(s).checkouts) > 0).length
  const nOrdered = list.filter(didOrder).length

  const raw = [
    { key: 'opened', labelAr: 'فتح القائمة', n: total },
    { key: 'viewedItem', labelAr: 'فتح صنفاً', n: nViewed },
    { key: 'addedToCart', labelAr: 'أضاف للسلة', n: nAdded },
    { key: 'reachedCheckout', labelAr: 'وصل لإتمام الطلب', n: nCheckout },
    { key: 'ordered', labelAr: 'أتمّ الطلب', n: nOrdered },
  ]

  const stages = raw.map((st, i) => {
    const prev = i === 0 ? total : raw[i - 1].n
    return {
      ...st,
      fromPrev: rate(st.n, prev),   // { n, of, rate }
      fromTop: rate(st.n, total),
      lostFromPrev: Math.max(0, prev - st.n),
    }
  })

  return {
    sample: total,
    thin: total < THRESHOLDS.THIN_SESSIONS,
    empty: false,
    stages,
    conversion: rate(nOrdered, total),
    biggestDrop: stages.slice(1).reduce((worst, st) => (!worst || st.lostFromPrev > worst.lostFromPrev ? st : worst), null),
  }
}

// ---------- 3. item interest ----------
// The core question: "they stopped at this dish and did not order it."
export function itemInterest(sessions, items) {
  const list = arr(sessions)
  const idx = indexItems(items)
  const agg = {}

  const bucket = (id) => {
    if (!agg[id]) {
      agg[id] = {
        id, name: '', views: 0, sessionsSeen: 0, dwellMs: 0,
        added: 0, addSessions: 0, ordered: 0, orderSessions: 0,
        lbnoSessions: 0, lbnoDwellMs: 0,
      }
    }
    return agg[id]
  }

  // Menu items that exist but were never opened must still appear (as 'ignored').
  for (const id of Object.keys(idx)) bucket(id).name = idx[id]

  for (const s of list) {
    const recs = sessionItems(s)
    for (const id of Object.keys(recs)) {
      const r = recs[id]
      const views = numOr(r.views)
      const dwell = numOr(r.dwellMs)
      const added = numOr(r.added)
      const ord = numOr(r.ordered)
      const b = bucket(id)
      if (!b.name) b.name = idx[id] || String(r.name || '')
      b.views += views
      b.dwellMs += dwell
      b.added += added
      b.ordered += ord
      if (views > 0) b.sessionsSeen++
      if (added > 0) b.addSessions++
      if (ord > 0) b.orderSessions++
      // THE metric: opened, lingered past the meaningful threshold, never added.
      if (views > 0 && dwell >= THRESHOLDS.MEANINGFUL_DWELL_MS && added === 0) {
        b.lbnoSessions++
        b.lbnoDwellMs += dwell
      }
    }
  }

  const out = Object.keys(agg).map((id) => {
    const b = agg[id]
    const avgDwellMs = b.views > 0 ? Math.round(b.dwellMs / b.views) : null
    const addRate = rate(b.addSessions, b.sessionsSeen)
    const orderRate = rate(b.orderSessions, b.sessionsSeen)
    const lookedButNotOrdered = {
      sessions: b.lbnoSessions,
      ofViewingSessions: b.sessionsSeen,
      share: b.sessionsSeen > 0 ? b.lbnoSessions / b.sessionsSeen : null,
      avgDwellMs: b.lbnoSessions > 0 ? Math.round(b.lbnoDwellMs / b.lbnoSessions) : null,
    }
    const thin = b.views < THRESHOLDS.THIN_ITEM_VIEWS

    // Verdict by RULES ONLY — no judgement calls, no ranking heuristics.
    let verdict
    if (b.sessionsSeen === 0) verdict = 'ignored'                 // on the menu, never opened
    else if (thin) verdict = 'thin-data'                          // seen, but too few times to judge
    else if (orderRate.rate !== null && orderRate.rate >= THRESHOLDS.CONVERTS_WELL_RATE) verdict = 'converts-well'
    else if (lookedButNotOrdered.share !== null
      && lookedButNotOrdered.share >= THRESHOLDS.HIGH_INTEREST_SHARE
      && (lookedButNotOrdered.avgDwellMs || 0) >= THRESHOLDS.MEANINGFUL_DWELL_MS) verdict = 'high-interest-no-order'
    else if (avgDwellMs !== null && avgDwellMs < THRESHOLDS.QUICK_BOUNCE_MS) verdict = 'quick-bounce'
    else verdict = 'neutral'

    return {
      id,
      name: b.name || itemName(id, list, idx),
      views: b.views,
      sessionsSeen: b.sessionsSeen,
      dwellMs: b.dwellMs,
      avgDwellMs,
      added: b.added,
      addRate,
      ordered: b.ordered,
      orderRate,
      lookedButNotOrdered,
      verdict,
      thin,
    }
  })

  // Ranked by the "stopped and did not order" signal first, then raw attention.
  out.sort((a, b) => (b.lookedButNotOrdered.sessions - a.lookedButNotOrdered.sessions) || (b.views - a.views))
  return { sample: list.length, thin: list.length < THRESHOLDS.THIN_SESSIONS, items: out }
}

// ---------- 4. drop-off points ----------
export function dropOffPoints(sessions) {
  const list = arr(sessions)
  if (!list.length) return { sample: 0, thin: true, empty: true, points: [], nonConverting: 0 }

  const dead = []
  for (const s of list) {
    const sum = sessionSummary(s)
    if (!sum || sum.ordered || !sum.dropOff) continue
    dead.push(sum.dropOff)
  }
  const tally = {}
  for (const where of dead) tally[where] = (tally[where] || 0) + 1

  const points = Object.keys(tally).map((where) => {
    const [kind, ...rest] = where.split(':')
    const id = rest.join(':')
    return {
      where,
      kind: kind === 'item' ? 'item' : 'page',
      id,
      name: kind === 'item' ? itemName(id, list, null) : id,
      n: tally[where],
      shareOfLost: dead.length > 0 ? tally[where] / dead.length : null,
      shareOfAll: list.length > 0 ? tally[where] / list.length : null,
      thin: tally[where] < THRESHOLDS.THIN_COHORT,
    }
  })
  points.sort((a, b) => b.n - a.n)

  return {
    sample: list.length,
    nonConverting: dead.length,
    unknownDropOff: list.filter((s) => !didOrder(s)).length - dead.length,
    thin: list.length < THRESHOLDS.THIN_SESSIONS,
    empty: false,
    points,
  }
}

// ---------- 5. one guest's whole story ----------
function orderLines(order) {
  const raw = arr(order && (order.items || order.lines || order.cart))
  return raw.map((l) => ({
    id: String((l && (l.itemId || l.id)) || ''),
    name: String((l && (l.nameAr || l.name || l.nameEn)) || ''),
    qty: Math.max(0, numOr(l && l.qty, 0)),
    lineTotal: numOr(l && (l.lineTotal !== undefined ? l.lineTotal : numOr(l.unitPrice) * numOr(l.qty))),
  })).filter((l) => l.id || l.name)
}

export function customerProfile({ sessions, orders, customerPhone } = {}) {
  const key = phoneKey(customerPhone)
  if (!key) return { found: false, reason: 'no-phone', sessions: 0, thin: true, sample: 0 }

  const mine = arr(sessions).filter((s) => phoneKey(s && s.customerPhone) === key)
  const myOrders = arr(orders).filter((o) => phoneKey(o && o.customerPhone) === key)

  if (!mine.length && !myOrders.length) {
    return { found: false, reason: 'no-data', customerPhone: String(customerPhone), sessions: 0, thin: true, sample: 0 }
  }

  const sums = mine.map(sessionSummary).filter(Boolean)
  const name = (sums.find((x) => x.customerName) || {}).customerName
    || String((myOrders.find((o) => o.customerName) || {}).customerName || '')
    || null

  // Viewed vs actually ordered — the gap between the two IS the insight.
  const viewed = {}
  for (const s of mine) {
    const recs = sessionItems(s)
    for (const id of Object.keys(recs)) {
      const r = recs[id]
      if (numOr(r.views) <= 0) continue
      if (!viewed[id]) viewed[id] = { id, name: String(r.name || ''), views: 0, dwellMs: 0 }
      viewed[id].views += numOr(r.views)
      viewed[id].dwellMs += numOr(r.dwellMs)
    }
  }
  const orderedMap = {}
  for (const o of myOrders) {
    for (const l of orderLines(o)) {
      const id = l.id || l.name
      if (!orderedMap[id]) orderedMap[id] = { id: l.id, name: l.name, qty: 0, spend: 0 }
      orderedMap[id].qty += l.qty
      orderedMap[id].spend += l.lineTotal
    }
  }
  const viewedList = Object.values(viewed).sort((a, b) => b.dwellMs - a.dwellMs || b.views - a.views)
  const orderedList = Object.values(orderedMap).sort((a, b) => b.qty - a.qty)
  const orderedIds = new Set(orderedList.map((x) => x.id).filter(Boolean))

  const searches = []
  for (const s of mine) for (const x of arr(s.search)) searches.push({ q: String(x.q || ''), results: numOr(x.results), at: ms(x.at) })

  const firstSeen = sums.reduce((a, x) => (x.startedAt && (a === null || x.startedAt < a) ? x.startedAt : a), null)
  const lastSeenSession = sums.reduce((a, x) => (x.lastAt && (a === null || x.lastAt > a) ? x.lastAt : a), null)
  const lastSeenOrder = myOrders.reduce((a, o) => { const t = ms(o.createdAt); return t && (a === null || t > a) ? t : a }, null)

  const arOpens = sums.reduce((a, x) => a + x.counts.arOpens, 0)
  const gamePlays = sums.reduce((a, x) => a + x.counts.gamePlays, 0)
  const totalActiveMs = sums.reduce((a, x) => a + x.durationMs, 0)
  const orderedSessions = sums.filter((x) => x.ordered).length

  return {
    found: true,
    customerPhone: String(customerPhone),
    name,
    sessions: mine.length,
    sample: mine.length,
    thin: mine.length < 3, // one or two visits is a snapshot, not a habit
    firstSeen,
    lastSeen: [lastSeenSession, lastSeenOrder].filter((x) => x !== null).sort((a, b) => b - a)[0] || null,
    totalActiveMs,
    avgActiveMs: mine.length ? Math.round(totalActiveMs / mine.length) : null,
    conversion: rate(orderedSessions, mine.length),
    viewedItems: viewedList,
    orderedItems: orderedList,
    // Looked at repeatedly across visits and never once ordered.
    viewedNeverOrdered: viewedList.filter((v) => !orderedIds.has(v.id)),
    ar: { opens: arOpens, usedIn: sums.filter((x) => x.counts.arOpens > 0).length },
    games: { plays: gamePlays, playedIn: sums.filter((x) => x.counts.gamePlays > 0).length },
    searches,
    // What they asked for and the venue does not have — the single most
    // actionable thing in this whole report.
    zeroResultSearches: searches.filter((x) => x.results === 0),
    orders: myOrders.map((o) => ({
      id: String(o.id || ''),
      at: ms(o.createdAt),
      total: numOr(o.total, null),
      status: String(o.status || ''),
      lines: orderLines(o).length,
    })).sort((a, b) => (b.at || 0) - (a.at || 0)),
    ordersCount: myOrders.length,
    ordersTotal: myOrders.reduce((a, o) => a + numOr(o.total), 0),
    dropOffs: sums.filter((x) => x.dropOff).map((x) => x.dropOff),
  }
}

// ---------- 6. cohorts ----------
// Correlation only. A cohort that converts better may simply be the cohort of
// guests who were already going to order — `note` says so, every time.
function cohortPair(list, key, labelAr, predicate) {
  const inSet = list.filter(predicate)
  const outSet = list.filter((s) => !predicate(s))
  const side = (name, labelSideAr, group) => ({
    key: name,
    labelAr: labelSideAr,
    sample: group.length,
    ordered: group.filter(didOrder).length,
    conversion: rate(group.filter(didOrder).length, group.length),
    avgActiveMs: group.length ? Math.round(group.reduce((a, s) => a + numOr(s.durationMs), 0) / group.length) : null,
    thin: group.length < THRESHOLDS.THIN_COHORT,
  })
  const a = side('yes', 'نعم', inSet)
  const b = side('no', 'لا', outSet)
  const lift = (a.conversion.rate !== null && b.conversion.rate !== null && b.conversion.rate > 0)
    ? (a.conversion.rate / b.conversion.rate) - 1
    : null
  return {
    key,
    labelAr,
    yes: a,
    no: b,
    lift,                                   // null when either side has no denominator
    thin: a.thin || b.thin,                 // a rate over 4 sessions is thin, and says so
    note: 'ارتباط لا سببية — قد يكون الفارق بسبب نوع الضيف لا بسبب الميزة',
  }
}

export function cohorts(sessions, orders) {
  const list = arr(sessions)
  if (!list.length) return { sample: 0, thin: true, empty: true, cohorts: [], ordersSeen: arr(orders).length }
  return {
    sample: list.length,
    thin: list.length < THRESHOLDS.THIN_SESSIONS,
    empty: false,
    ordersSeen: arr(orders).length,
    cohorts: [
      cohortPair(list, 'playedGame', 'لعب لعبة', (s) => numOr(sessionCounts(s).gamePlays) > 0),
      cohortPair(list, 'usedAr', 'استخدم العرض ثلاثي الأبعاد', (s) => numOr(sessionCounts(s).arOpens) > 0),
      cohortPair(list, 'searched', 'استخدم البحث', (s) => numOr(sessionCounts(s).searches) > 0),
      cohortPair(list, 'fromTable', 'دخل من طاولة', (s) => !!(s.entry && s.entry.table)),
      cohortPair(list, 'identified', 'سجّل بياناته', (s) => !!(s.customerPhone || s.customerName)),
    ],
  }
}

// ---------- 7. compact snapshot for the AI planner ----------
function tallySearches(sessions) {
  const all = {}
  const zero = {}
  for (const s of arr(sessions)) {
    for (const x of arr(s.search)) {
      const q = String(x.q || '').trim()
      if (!q) continue
      all[q] = (all[q] || 0) + 1
      if (numOr(x.results) === 0) zero[q] = (zero[q] || 0) + 1
    }
  }
  const top = (o) => Object.keys(o).map((q) => ({ q, n: o[q] })).sort((a, b) => b.n - a.n)
  return { top: top(all).slice(0, 15), zero: top(zero).slice(0, 15) }
}

export function aiSnapshot({ sessions, orders, items, customers } = {}) {
  const list = arr(sessions)
  const ordersList = arr(orders)
  const f = funnel(list)
  const ii = itemInterest(list, items)
  const dp = dropOffPoints(list)
  const ch = cohorts(list, ordersList)
  const sq = tallySearches(list)

  const from = list.reduce((a, s) => { const t = numOr(s.startedAt); return t && (a === null || t < a) ? t : a }, null)
  const to = list.reduce((a, s) => { const t = numOr(s.lastAt); return t && (a === null || t > a) ? t : a }, null)

  const compactItem = (x) => ({
    id: x.id, name: x.name, views: x.views, sessionsSeen: x.sessionsSeen,
    avgDwellMs: x.avgDwellMs,
    addRate: x.addRate, orderRate: x.orderRate,
    lookedButNotOrdered: x.lookedButNotOrdered,
    verdict: x.verdict, thin: x.thin,
  })

  const devices = { ios: 0, android: 0, other: 0 }
  const sources = {}
  for (const s of list) {
    const p = (s.device && s.device.platform) || 'other'
    devices[p === 'ios' || p === 'android' ? p : 'other']++
    const src = (s.entry && s.entry.source) || 'unknown'
    sources[src] = (sources[src] || 0) + 1
  }

  return {
    generatedAt: Date.now(),
    window: { fromMs: from, toMs: to },
    sample: {
      sessions: list.length,
      orders: ordersList.length,
      identifiedSessions: list.filter((s) => s.customerPhone || s.customerName).length,
      knownCustomers: arr(customers).length,
      menuItems: arr(items).length,
    },
    thin: list.length < THRESHOLDS.THIN_SESSIONS,
    thresholds: THRESHOLDS,
    funnel: { sample: f.sample, thin: f.thin, stages: f.stages, conversion: f.conversion },
    items: {
      thin: ii.thin,
      top: ii.items.slice(0, 12).map(compactItem),
      lookedButNotOrdered: ii.items.filter((x) => x.verdict === 'high-interest-no-order').slice(0, 8).map(compactItem),
      ignored: ii.items.filter((x) => x.verdict === 'ignored').slice(0, 12).map((x) => ({ id: x.id, name: x.name })),
    },
    dropOff: { sample: dp.sample, nonConverting: dp.nonConverting, thin: dp.thin, points: dp.points.slice(0, 8) },
    cohorts: ch.cohorts,
    searches: { top: sq.top, zeroResults: sq.zero },
    devices,
    sources,
    // Shipped WITH the numbers so the planner cannot read the figures without
    // reading their limits.
    limits: [
      'dwellMs = الصنف كان مفتوحاً والشاشة ظاهرة فقط، ولا يثبت أن الضيف كان ينظر إليه',
      'durationMs = وقت نشاط فعلي بعد استبعاد فترات الخمول، وليس مدة الجلوس في المطعم',
      'الجلسة لكل تبويب متصفح: هاتف واحد يتنقل بين الضيوف = جلسة واحدة',
      'سجل الأحداث محدود بـ 300 حدث لكل جلسة، وقد تُحذف أقدم الخطوات في الجلسات الطويلة',
      'abandonedAt = آخر موضع قبل التوقف، وقد يعني المغادرة أو الطلب من الموظف مباشرة',
    ],
    guard: AI_PLANNER_GUARD_AR,
  }
}
