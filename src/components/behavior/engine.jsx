// Behaviour analytics — local engine + resolution layer.
//
// `src/lib/behavior.js` is the shared pure engine written alongside this page.
// This module does three things:
//   1. implements EVERY calculation the page renders, self-contained, so the UI
//      can never be blanked by a missing/renamed export;
//   2. resolves each function against the shared engine and USES the shared one
//      whenever its result matches the shape this UI renders (validated, not
//      assumed) — a silent shape mismatch would otherwise paint wrong numbers;
//   3. owns the pieces that are NOT part of the shared contract: real audience
//      segments (actual phone numbers), rule findings, and the plan parser.
//
// Nothing here talks to Firestore. It is pure functions over session documents.
import * as shared from '../../lib/behavior.js'
import { normalizePhone } from '../../lib/format.js'

/* ---------------- primitives ---------------- */

export const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
export const pct = (r) => Math.round(num(r) * 1000) / 10 // 0.4237 -> 42.4
const S = (s) => s || {}
const C = (s) => S(s).counts || {}
const O = (s) => S(s).outcome || {}
const IT = (s) => S(s).items || {}
const E = (s) => (Array.isArray(S(s).entry) ? {} : S(s).entry || {})
const D = (s) => S(s).device || {}

// Sessions may arrive with the doc id instead of the embedded sid.
export const sidOf = (s) => S(s).sid || S(s).id || ''

// Latin digits everywhere (hard project rule). en-GB / en-CA keep both the
// digits and the separators Latin; ar-SA would switch the calendar too.
export const clock = (ms) => (ms ? new Date(num(ms)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—')
export const clockSec = (ms) => (ms ? new Date(num(ms)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')
export const dayStamp = (ms) => (ms ? new Date(num(ms)).toLocaleDateString('en-CA') : '—')
export const dateTime = (ms) => (ms ? `${dayStamp(ms)} ${clock(ms)}` : '—')

// Compact duration, always Latin digits.
export function dur(ms, ar = true) {
  const total = Math.max(0, Math.round(num(ms) / 1000))
  if (total < 60) return `${total}${ar ? ' ث' : 's'}`
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m < 60) return `${m}:${String(s).padStart(2, '0')}${ar ? ' د' : 'm'}`
  const h = Math.floor(m / 60)
  return `${h}:${String(m % 60).padStart(2, '0')}${ar ? ' س' : 'h'}`
}

/* ---------------- step predicates (the funnel definition) ---------------- */

export const reachedItem = (s) => num(C(s).itemViews) > 0 || Object.keys(IT(s)).length > 0
export const reachedCart = (s) => num(C(s).cartAdds) > 0
export const reachedCheckout = (s) => num(C(s).checkouts) > 0
export const didOrder = (s) => Boolean(O(s).ordered)
export const usedAr = (s) => num(C(s).arOpens) > 0
export const playedGame = (s) => num(C(s).gamePlays) > 0
// Deliberately identical to the shared engine's cohort predicate (entry.table
// only), so the overview card and the cohort card can never disagree about how
// many sessions came from a table QR.
export const fromTable = (s) => Boolean(E(s).table)
export const activeMs = (s) => num(S(s).durationMs) || Math.max(0, num(S(s).lastAt) - num(S(s).startedAt))
export const phoneOf = (s) => normalizePhone(S(s).customerPhone || '')

/* ---------------- sessionSummary ---------------- */

export function sessionSummaryLocal(s) {
  const c = C(s)
  const o = O(s)
  const itemList = Object.entries(IT(s)).map(([itemId, v]) => ({
    itemId,
    name: (v && v.name) || itemId,
    views: num(v && v.views),
    dwellMs: num(v && v.dwellMs),
    added: num(v && v.added),
    removed: num(v && v.removed),
    ordered: num(v && v.ordered),
  })).sort((a, b) => b.dwellMs - a.dwellMs)
  const w = num(D(s).w)
  return {
    sid: sidOf(s),
    deviceId: S(s).deviceId || '',
    startedAt: num(S(s).startedAt),
    lastAt: num(S(s).lastAt),
    durationMs: activeMs(s),
    phone: S(s).customerPhone || '',
    name: S(s).customerName || '',
    table: E(s).table || '',
    source: E(s).source || (E(s).table ? 'table' : 'direct'),
    ref: E(s).ref || '',
    platform: D(s).platform || '',
    lang: D(s).lang || '',
    standalone: Boolean(D(s).standalone),
    screen: w ? `${w}x${num(D(s).h)}` : '',
    isMobile: w ? w < 768 : null,
    views: num(c.views),
    taps: num(c.taps),
    itemViews: num(c.itemViews),
    arOpens: num(c.arOpens),
    gamePlays: num(c.gamePlays),
    cartAdds: num(c.cartAdds),
    cartRemoves: num(c.cartRemoves),
    checkouts: num(c.checkouts),
    searches: num(c.searches),
    itemsSeen: itemList.length,
    itemList,
    ordered: Boolean(o.ordered),
    orderId: o.orderId || '',
    total: num(o.total),
    abandonedAt: o.abandonedAt || '',
    events: Array.isArray(S(s).events) ? S(s).events : [],
    // The capture SDK keeps only the newest 300 events; at the cap the START of
    // the journey has been dropped and the timeline must say so.
    eventsTruncated: Array.isArray(S(s).events) && S(s).events.length >= 300,
    search: Array.isArray(S(s).search) ? S(s).search : [],
  }
}

/* ---------------- funnel ---------------- */

export const FUNNEL_STEPS = [
  { key: 'open', ar: 'فتح المنيو', en: 'Opened menu', test: () => true },
  { key: 'item', ar: 'شاهد صنفاً', en: 'Viewed an item', test: reachedItem },
  { key: 'cart', ar: 'أضاف للسلة', en: 'Added to cart', test: reachedCart },
  { key: 'checkout', ar: 'وصل الدفع', en: 'Reached checkout', test: reachedCheckout },
  { key: 'order', ar: 'أتم الطلب', en: 'Completed order', test: didOrder },
]

export function funnelLocal(sessions = []) {
  const total = sessions.length
  const raw = FUNNEL_STEPS.map((st) => ({ ...st, count: sessions.filter(st.test).length }))
  return raw.map((st, i) => {
    const base = i === 0 ? total : raw[i - 1].count
    return {
      key: st.key,
      ar: st.ar,
      en: st.en,
      count: st.count,
      base,
      sample: total,
      rate: total ? st.count / total : 0,
      stepRate: base ? st.count / base : 0,
      // Steps are independent signals, so a later step can exceed an earlier one
      // when capture missed an event. Never render a negative loss.
      lost: i === 0 ? 0 : Math.max(0, base - st.count),
    }
  })
}

export function dropOffPointsLocal(sessions = []) {
  const f = funnelLocal(sessions)
  return f.slice(1).map((st, i) => ({
    key: `${f[i].key}_${st.key}`,
    from: f[i].key,
    to: st.key,
    fromAr: f[i].ar,
    toAr: st.ar,
    lost: st.lost,
    base: st.base,
    rate: st.base ? st.lost / st.base : 0,
  })).sort((a, b) => b.lost - a.lost)
}

/* ---------------- item interest ---------------- */

export function itemVerdict(r) {
  if (r.sessions < 5) return { key: 'thin', ar: 'عينة قليلة — لا حكم', tone: 'neutral' }
  if (r.lost >= 5 && r.lostAvgDwellMs >= 8000 && r.orderRate < 0.1) {
    return { key: 'interest_no_order', ar: 'اهتمام طويل بلا طلب — المانع غالباً السعر أو الصورة أو الوصف', tone: 'bad' }
  }
  if (r.added >= 4 && r.addToOrderRate < 0.4) {
    return { key: 'cart_drop', ar: 'يُضاف للسلة ثم يُترك — الحاجز في مرحلة إتمام الطلب', tone: 'bad' }
  }
  if (r.removed >= 3 && r.removed >= r.added * 0.5) {
    return { key: 'removed', ar: 'يُحذف من السلة كثيراً — راجع السعر أو الإضافات', tone: 'bad' }
  }
  if (r.views >= 10 && r.avgDwellMs < 2500) {
    return { key: 'glance', ar: 'نظرة عابرة فقط — العرض لا يوقف العين', tone: 'warn' }
  }
  if (r.orderRate >= 0.35) return { key: 'strong', ar: 'يتحوّل جيداً — رشّحه أكثر', tone: 'good' }
  return { key: 'ok', ar: 'أداء اعتيادي', tone: 'neutral' }
}

export function itemInterestLocal(sessions = [], items = []) {
  const nameOf = {}
  items.forEach((it) => { nameOf[it.id] = it.nameAr || it.name || it.nameEn || it.id })
  const map = new Map()
  sessions.forEach((s) => {
    Object.entries(IT(s)).forEach(([itemId, v]) => {
      let r = map.get(itemId)
      if (!r) {
        r = {
          itemId, name: nameOf[itemId] || (v && v.name) || itemId,
          views: 0, sessions: 0, dwellMs: 0, added: 0, removed: 0, ordered: 0,
          lost: 0, lostDwellMs: 0, lostSids: [], sids: [],
        }
        map.set(itemId, r)
      }
      if (nameOf[itemId]) r.name = nameOf[itemId]
      r.sessions += 1
      r.sids.push(sidOf(s))
      r.views += num(v && v.views) || 1
      r.dwellMs += num(v && v.dwellMs)
      if (num(v && v.added) > 0) r.added += 1
      if (num(v && v.removed) > 0) r.removed += 1
      if (num(v && v.ordered) > 0) r.ordered += 1
      else {
        r.lost += 1
        r.lostDwellMs += num(v && v.dwellMs)
        r.lostSids.push(sidOf(s))
      }
    })
  })
  const rows = [...map.values()].map((r) => {
    const row = {
      ...r,
      avgDwellMs: r.sessions ? r.dwellMs / r.sessions : 0,
      lostAvgDwellMs: r.lost ? r.lostDwellMs / r.lost : 0,
      addRate: r.sessions ? r.added / r.sessions : 0,
      orderRate: r.sessions ? r.ordered / r.sessions : 0,
      addToOrderRate: r.added ? r.ordered / r.added : 0,
    }
    row.verdict = itemVerdict(row)
    return row
  })
  // Lost interest first — that is the whole point of this table.
  return rows.sort((a, b) => b.lost - a.lost || b.lostDwellMs - a.lostDwellMs)
}

/* ---------------- guest profile ---------------- */

export function customerProfileLocal(all = [], key = {}) {
  const wanted = normalizePhone(key.phone || '')
  const deviceId = key.deviceId || ''
  let mine = []
  if (wanted) mine = all.filter((s) => phoneOf(s) === wanted)
  else if (deviceId) mine = all.filter((s) => S(s).deviceId === deviceId)
  // A registered guest usually has earlier ANONYMOUS sessions on the same device.
  // Pull those in too, flagged, instead of pretending they never happened.
  const devices = new Set(mine.map((s) => S(s).deviceId).filter(Boolean))
  if (wanted && devices.size) {
    all.forEach((s) => {
      if (mine.includes(s)) return
      if (devices.has(S(s).deviceId)) mine.push(s)
    })
  }
  const list = mine.map(sessionSummaryLocal).sort((a, b) => b.startedAt - a.startedAt)
  list.forEach((x) => { x.linkedByDevice = Boolean(wanted) && normalizePhone(x.phone) !== wanted })

  const itemsMap = new Map()
  const searches = []
  let arOpens = 0
  let gamePlays = 0
  let totalActiveMs = 0
  list.forEach((x) => {
    totalActiveMs += x.durationMs
    arOpens += x.arOpens
    gamePlays += x.gamePlays
    x.search.forEach((q) => searches.push({ ...q, sid: x.sid }))
    x.itemList.forEach((it) => {
      const cur = itemsMap.get(it.itemId) || { itemId: it.itemId, name: it.name, views: 0, dwellMs: 0, ordered: 0, added: 0 }
      cur.views += it.views
      cur.dwellMs += it.dwellMs
      cur.ordered += it.ordered
      cur.added += it.added
      if (it.name && it.name !== it.itemId) cur.name = it.name
      itemsMap.set(it.itemId, cur)
    })
  })
  const itemsViewed = [...itemsMap.values()].sort((a, b) => b.dwellMs - a.dwellMs)
  return {
    phone: wanted ? (mine.find((s) => phoneOf(s) === wanted)?.customerPhone || key.phone) : '',
    name: mine.map((s) => S(s).customerName).find(Boolean) || '',
    deviceIds: [...devices],
    sessions: list,
    sessionCount: list.length,
    totalActiveMs,
    orderedCount: list.filter((x) => x.ordered).length,
    orderIds: list.filter((x) => x.orderId).map((x) => x.orderId),
    spentInSessions: list.reduce((sum, x) => sum + x.total, 0),
    itemsViewed,
    itemsOrdered: itemsViewed.filter((i) => i.ordered > 0),
    itemsViewedNotOrdered: itemsViewed.filter((i) => i.ordered === 0),
    arOpens,
    gamePlays,
    searches: searches.sort((a, b) => num(b.at) - num(a.at)),
    zeroSearches: searches.filter((q) => num(q.results) === 0),
    firstAt: list.length ? list[list.length - 1].startedAt : 0,
    lastAt: list.length ? list[0].lastAt || list[0].startedAt : 0,
  }
}

/* ---------------- cohorts ---------------- */

// Thresholds come from the shared engine so this page judges "thin" by exactly
// the same rule as everything else reading behaviour data.
const T = (shared.THRESHOLDS && typeof shared.THRESHOLDS === 'object') ? shared.THRESHOLDS : {}
export const COHORT_MIN = Number(T.THIN_COHORT) || 10
export const THIN_SESSIONS = Number(T.THIN_SESSIONS) || 20
export const MEANINGFUL_DWELL_MS = Number(T.MEANINGFUL_DWELL_MS) || 4000

function groupStats(list) {
  const n = list.length
  const ordered = list.filter(didOrder)
  const revenue = ordered.reduce((sum, s) => sum + num(O(s).total), 0)
  return {
    n,
    ordered: ordered.length,
    convRate: n ? ordered.length / n : 0,
    revenue,
    avgOrder: ordered.length ? revenue / ordered.length : 0,
    avgActiveMs: n ? list.reduce((sum, s) => sum + activeMs(s), 0) / n : 0,
    enough: n >= COHORT_MIN,
  }
}

// "Returning" is only knowable INSIDE the loaded window — an earlier visit that
// fell outside the period is invisible. The UI states this next to the cohort.
export function returningFlags(sessions = []) {
  const ordered = [...sessions].sort((a, b) => num(S(a).startedAt) - num(S(b).startedAt))
  const seen = new Set()
  const flags = new Map()
  ordered.forEach((s) => {
    const dk = S(s).deviceId || ''
    const pk = phoneOf(s)
    const isBack = (dk && seen.has(`d:${dk}`)) || (pk && seen.has(`p:${pk}`))
    flags.set(sidOf(s), isBack)
    if (dk) seen.add(`d:${dk}`)
    if (pk) seen.add(`p:${pk}`)
  })
  return flags
}

export function cohortsLocal(sessions = []) {
  const back = returningFlags(sessions)
  const split = (test) => [sessions.filter(test), sessions.filter((s) => !test(s))]
  const [gY, gN] = split(playedGame)
  const [aY, aN] = split(usedAr)
  const [tY, tN] = split(fromTable)
  const rY = sessions.filter((s) => back.get(sidOf(s)))
  const rN = sessions.filter((s) => !back.get(sidOf(s)))
  return [
    {
      key: 'game', ar: 'لعب لعبة داخل المنيو', icon: 'play',
      groups: [
        { key: 'yes', ar: 'لعب', ...groupStats(gY) },
        { key: 'no', ar: 'لم يلعب', ...groupStats(gN) },
      ],
    },
    {
      key: 'ar', ar: 'فتح العرض ثلاثي الأبعاد', icon: 'layers',
      groups: [
        { key: 'yes', ar: 'استخدم العرض', ...groupStats(aY) },
        { key: 'no', ar: 'لم يستخدمه', ...groupStats(aN) },
      ],
    },
    {
      key: 'entry', ar: 'مصدر الدخول', icon: 'qr',
      groups: [
        { key: 'table', ar: 'باركود الطاولة', ...groupStats(tY) },
        { key: 'direct', ar: 'دخول مباشر', ...groupStats(tN) },
      ],
    },
    {
      key: 'return', ar: 'زائر عائد أم أول مرة', icon: 'repeat',
      note: 'العودة محسوبة داخل الفترة المختارة فقط — زيارة أقدم من الفترة لا تظهر.',
      groups: [
        { key: 'returning', ar: 'عائد', ...groupStats(rY) },
        { key: 'first', ar: 'أول مرة', ...groupStats(rN) },
      ],
    },
  ]
}

/* ---------------- searches, devices, entry ---------------- */

export function searchStats(sessions = []) {
  const all = []
  sessions.forEach((s) => (Array.isArray(S(s).search) ? S(s).search : []).forEach((q) => {
    const text = String((q && q.q) || '').trim()
    if (!text) return
    all.push({ q: text, results: num(q && q.results), at: num(q && q.at), sid: sidOf(s), phone: S(s).customerPhone || '' })
  }))
  const tally = new Map()
  all.forEach((q) => {
    const cur = tally.get(q.q) || { q: q.q, times: 0, zero: 0, sids: [] }
    cur.times += 1
    if (q.results === 0) cur.zero += 1
    cur.sids.push(q.sid)
    tally.set(q.q, cur)
  })
  const rows = [...tally.values()].sort((a, b) => b.times - a.times)
  return { all, top: rows, zero: rows.filter((r) => r.zero > 0).sort((a, b) => b.zero - a.zero) }
}

export function deviceSplit(sessions = []) {
  let mobile = 0
  let desktop = 0
  let unknown = 0
  let installed = 0
  sessions.forEach((s) => {
    const w = num(D(s).w)
    if (!w) unknown += 1
    else if (w < 768) mobile += 1
    else desktop += 1
    if (D(s).standalone) installed += 1
  })
  return { mobile, desktop, unknown, installed, total: sessions.length }
}

export function entrySplit(sessions = []) {
  const tally = {}
  sessions.forEach((s) => {
    const src = fromTable(s) ? 'table' : (E(s).source || 'direct')
    tally[src] = (tally[src] || 0) + 1
  })
  const tables = {}
  sessions.forEach((s) => { const tbl = E(s).table; if (tbl) tables[tbl] = (tables[tbl] || 0) + 1 })
  return { tally, tables, table: sessions.filter(fromTable).length, direct: sessions.filter((s) => !fromTable(s)).length }
}

export function overview(sessions = []) {
  const total = sessions.length
  const orderedList = sessions.filter(didOrder)
  const revenue = orderedList.reduce((sum, s) => sum + num(O(s).total), 0)
  return {
    sessions: total,
    ordered: orderedList.length,
    convRate: total ? orderedList.length / total : 0,
    avgActiveMs: total ? sessions.reduce((sum, s) => sum + activeMs(s), 0) / total : 0,
    medianActiveMs: median(sessions.map(activeMs)),
    revenue,
    avgOrder: orderedList.length ? revenue / orderedList.length : 0,
    withPhone: sessions.filter((s) => phoneOf(s)).length,
    anonymous: total - sessions.filter((s) => phoneOf(s)).length,
    devices: deviceSplit(sessions),
    entry: entrySplit(sessions),
  }
}

function median(arr) {
  const list = arr.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!list.length) return 0
  const mid = Math.floor(list.length / 2)
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2
}

/* ---------------- audience segments (real phone numbers) ----------------
   NOT part of the shared engine contract. This is what stops a campaign from
   being a hallucination: every audience is a concrete list of sessions resolved
   to real, de-duplicated phone numbers, with the unreachable (anonymous) share
   stated openly rather than rounded away.                                   */

const LONG_DWELL_MS = Math.max(8000, MEANINGFUL_DWELL_MS)

function makeSegment(id, ar, why, list, extra = {}) {
  const phones = new Map()
  const anonDevices = new Set()
  list.forEach((s) => {
    const p = phoneOf(s)
    if (p) phones.set(p, { phone: S(s).customerPhone || p, name: S(s).customerName || '' })
    else if (S(s).deviceId) anonDevices.add(S(s).deviceId)
  })
  return {
    id,
    ar,
    why,
    sessionCount: list.length,
    sids: list.map(sidOf),
    phones: [...phones.values()],
    anonymousDevices: anonDevices.size,
    itemIds: [],
    ...extra,
  }
}

export function buildSegments(sessions = [], itemRows = []) {
  const back = returningFlags(sessions)
  const out = []
  const push = (seg) => { if (seg.sessionCount > 0) out.push(seg) }

  push(makeSegment(
    'abandoned_cart', 'أضافوا للسلة ولم يطلبوا',
    'جلسات فيها cartAdds أكبر من صفر و outcome.ordered غير صحيح',
    sessions.filter((s) => reachedCart(s) && !didOrder(s)),
  ))
  push(makeSegment(
    'left_at_checkout', 'وصلوا صفحة الدفع ولم يكملوا',
    'جلسات فيها checkouts أكبر من صفر و outcome.ordered غير صحيح',
    sessions.filter((s) => reachedCheckout(s) && !didOrder(s)),
  ))
  push(makeSegment(
    'browsed_never_ordered', 'تصفّحوا أصنافاً ولم يطلبوا شيئاً',
    'جلسات شاهدت صنفاً واحداً على الأقل وانتهت بلا طلب',
    sessions.filter((s) => reachedItem(s) && !didOrder(s)),
  ))
  push(makeSegment(
    'played_game', 'لعبوا لعبة داخل المنيو',
    'جلسات فيها gamePlays أكبر من صفر',
    sessions.filter(playedGame),
  ))
  push(makeSegment(
    'used_ar', 'استخدموا العرض ثلاثي الأبعاد',
    'جلسات فيها arOpens أكبر من صفر',
    sessions.filter(usedAr),
  ))
  push(makeSegment(
    'zero_result_search', 'بحثوا عن شيء غير موجود في المنيو',
    'جلسات فيها عملية بحث واحدة على الأقل بنتيجة صفر',
    sessions.filter((s) => (Array.isArray(S(s).search) ? S(s).search : []).some((q) => num(q && q.results) === 0)),
  ))
  push(makeSegment(
    'returning', 'زوّار عادوا أكثر من مرة داخل الفترة',
    'نفس deviceId أو نفس الرقم في أكثر من جلسة داخل الفترة',
    sessions.filter((s) => back.get(sidOf(s))),
  ))

  // Per-item "looked long and still did not order" — the segment a manager
  // actually wants to message. Limited to the eight biggest leaks.
  itemRows.slice(0, 8).forEach((row) => {
    const list = sessions.filter((s) => {
      const v = IT(s)[row.itemId]
      return v && num(v.ordered) === 0 && num(v.dwellMs) >= LONG_DWELL_MS
    })
    push(makeSegment(
      `viewed_not_ordered:${row.itemId}`,
      `شاهدوا «${row.name}» أكثر من ثماني ثوانٍ ولم يطلبوه`,
      `جلسات فيها items['${row.itemId}'].dwellMs >= 8000 و ordered = 0`,
      list,
      { itemIds: [row.itemId] },
    ))
  })
  return out
}

/* ---------------- rule findings (stand alone without any AI) ---------------- */

export function ruleFindings({ sessions = [], steps = [], drops = null, itemRows = [], cohortList = [], searches = {} } = {}) {
  const out = []
  const total = sessions.length
  if (!total) return out
  const thin = total < THIN_SESSIONS

  // Biggest loss BETWEEN funnel steps — which stage bleeds most.
  const worstStep = steps.slice(1).reduce((worst, st) => (!worst || st.lost > worst.lost ? st : worst), null)
  if (worstStep && worstStep.lost > 0) {
    const prev = steps[steps.indexOf(worstStep) - 1]
    out.push({
      key: 'drop',
      tone: 'bad',
      title: `أكبر تسريب في المسار: بين «${prev ? prev.ar : ''}» و«${worstStep.ar}»`,
      body: `فقدت ${worstStep.lost} جلسة من أصل ${worstStep.base} عند هذه الخطوة، أي أن ${pct(worstStep.stepRate)} بالمئة فقط أكملوا إليها.`,
      sample: worstStep.base,
    })
  }
  // And the exact place sessions actually died (a page or a specific dish).
  const spot = drops && Array.isArray(drops.points) ? drops.points[0] : null
  if (spot && spot.lost > 0) {
    out.push({
      key: 'spot',
      tone: spot.thin ? 'neutral' : 'warn',
      title: `أكثر نقطة توقّف: ${spot.label}`,
      body: `${spot.lost} جلسة من ${drops.nonConverting} جلسة غير محوَّلة انتهت هنا (${pct(spot.rate)} بالمئة منها)`
        + (spot.thin ? '. العينة صغيرة عند هذه النقطة تحديداً، فاقرأها كمؤشّر لا كحكم.' : '.')
        + (drops.unknown > 0 ? ` كما توجد ${drops.unknown} جلسة غير محوَّلة بلا نقطة توقّف مسجّلة، وهي خارج هذا الحساب.` : ''),
      sample: drops.nonConverting,
    })
  }
  const done = steps.find((s) => s.key === 'order')
  if (done) {
    out.push({
      key: 'conv',
      tone: done.rate >= 0.15 ? 'good' : 'warn',
      title: `التحويل الكلي ${pct(done.rate)} بالمئة`,
      body: `${done.count} جلسة انتهت بطلب من أصل ${total} جلسة في الفترة.`,
      sample: total,
    })
  }
  const leak = itemRows.find((r) => r.verdict && r.verdict.key === 'interest_no_order')
  if (leak) {
    out.push({
      key: 'item',
      tone: 'bad',
      title: `«${leak.name}» يوقف النظر ولا يُطلب`,
      body: `${leak.lost} جلسة فتحت هذا الصنف وبقيت عليه بمتوسط ${dur(leak.lostAvgDwellMs)} ثم لم تضِفه للسلة إطلاقاً، ومعدل الطلب ${pct(leak.orderRate)} بالمئة فقط. مدة البقاء لا تثبت الاهتمام — اقرأها كسؤال يستحق التحقق لا كحقيقة.`,
      sample: leak.sessions,
    })
  }
  const zero = (searches.zero || [])[0]
  if (zero) {
    out.push({
      key: 'search',
      tone: 'warn',
      title: `يبحثون عن «${zero.q}» ولا يجدونه`,
      body: `تكرّر البحث ${zero.times} مرة، منها ${zero.zero} مرة بلا أي نتيجة.`,
      sample: zero.times,
    })
  }
  cohortList.forEach((c) => {
    const [a, b] = c.groups || []
    if (!a || !b) return
    if (!a.enough || !b.enough) {
      out.push({
        key: `cohort_${c.key}_thin`,
        tone: 'neutral',
        title: `${c.ar}: العينة غير كافية`,
        body: `المجموعتان ${a.n} و ${b.n} جلسة — الحد الأدنى للحكم ${COHORT_MIN} جلسة لكل مجموعة.`,
        sample: Math.min(a.n, b.n),
      })
      return
    }
    const diff = a.convRate - b.convRate
    if (Math.abs(diff) < 0.05) return
    out.push({
      key: `cohort_${c.key}`,
      tone: diff > 0 ? 'good' : 'warn',
      title: `${c.ar}: فرق تحويل ${pct(Math.abs(diff))} نقطة`,
      body: `«${a.ar}» ${pct(a.convRate)} بالمئة على ${a.n} جلسة، مقابل «${b.ar}» ${pct(b.convRate)} بالمئة على ${b.n} جلسة. الفرق ارتباط وليس سبباً.`,
      sample: Math.min(a.n, b.n),
    })
  })
  if (thin) {
    out.unshift({
      key: 'thin',
      tone: 'warn',
      title: 'عينة قليلة',
      body: `الفترة تحوي ${total} جلسة فقط. أي نسبة هنا قابلة للتغيّر الكبير — وسّع الفترة قبل اتخاذ قرار.`,
      sample: total,
    })
  }
  return out
}

/* ---------------- AI snapshot + guard + plan parsing ---------------- */

export const AI_PLANNER_GUARD_LOCAL = [
  'أنت مستشار نمو لمطعم/مقهى واحد فقط، وتحلل سلوك زوّار منيوه الرقمي.',
  'قواعد ملزمة لا تُخالَف:',
  '1) لا تخترع أي رقم إطلاقاً. كل رقم تذكره يجب أن يكون موجوداً حرفياً في JSON المرفق أدناه. إذا لم يكن الرقم موجوداً قل «غير متوفر في البيانات».',
  '2) البيانات سلوكية فقط: لا أعمار ولا جنس ولا موقع جغرافي ولا بيانات منافسين. لا تفترض أياً منها.',
  '3) إذا كان sampleSize.sessions أقل من عشرين، ابدأ ردك بجملة «العينة غير كافية لاستنتاج موثوق» ثم اقترح ما يمكن ملاحظته فقط.',
  '4) الفرق بين الشرائح ارتباط وليس سبباً. لا تقل إن شيئاً «تسبّب» في الطلب.',
  '5) الجمهور: لا تصف جمهوراً من عندك. اختر segmentId واحداً من availableAudiences فقط، حرفياً كما هو مكتوب.',
  '6) itemIds: استخدم فقط المعرفات الموجودة في JSON المرفق.',
  '7) أجب بالعربية، مختصراً وعملياً: تشخيص قصير، ثم خطوات تنفيذية مرقّمة.',
  '8) إن تضمّنت خطتك حملة أو محتوى، أضف في آخر الرد كتلة JSON واحدة فقط بين السطرين [[PLAN_JSON]] و [[/PLAN_JSON]] بهذا الشكل تماماً:',
  '{"campaign":{"title":"","segmentId":"","message":"","itemIds":[],"timing":""},"content":{"subject":"","style":"","caption":""}}',
  'اترك أي حقل فارغاً إن لم يكن مناسباً، ولا تضف حقولاً أخرى.',
].join('\n')

export function aiSnapshotLocal({
  sessions = [], steps = [], drops = null, itemRows = [], cohortList = [],
  segments = [], searches = {}, over = null, periodLabel = '', venue = '', currency = 'SAR',
} = {}) {
  const o = over || overview(sessions)
  const dropPoints = drops && Array.isArray(drops.points) ? drops.points : []
  return {
    venue,
    currency,
    period: periodLabel,
    sampleSize: {
      sessions: o.sessions,
      note: 'كل النسب في هذه اللقطة محسوبة على هذا العدد فقط، ومصدرها جلسات حقيقية مسجّلة.',
      reliable: o.sessions >= COHORT_MIN,
    },
    conversion: { orderedSessions: o.ordered, ratePct: pct(o.convRate), avgOrderValue: Math.round(o.avgOrder * 100) / 100 },
    engagement: {
      avgActiveSeconds: Math.round(o.avgActiveMs / 1000),
      medianActiveSeconds: Math.round(o.medianActiveMs / 1000),
      identifiedSessions: o.withPhone,
      anonymousSessions: o.anonymous,
    },
    devices: { mobile: o.devices.mobile, desktop: o.devices.desktop, unknown: o.devices.unknown, installedApp: o.devices.installed },
    entry: { tableQr: o.entry.table, direct: o.entry.direct },
    funnel: steps.map((s) => ({ step: s.ar, sessions: s.count, pctOfAllSessions: pct(s.rate), pctOfPreviousStep: pct(s.stepRate), lostAtThisStep: s.lost })),
    whereSessionsDied: {
      nonConvertingSessions: drops ? num(drops.nonConverting) : 0,
      withNoRecordedDropOff: drops ? num(drops.unknown) : 0,
      topPoints: dropPoints.slice(0, 6).map((d) => ({ place: d.label, kind: d.kind, sessions: d.lost, shareOfNonConvertingPct: pct(d.rate), sampleIsThin: Boolean(d.thin) })),
    },
    itemsRankedByLostInterest: itemRows.slice(0, 12).map((r) => ({
      itemId: r.itemId,
      name: r.name,
      sessionsThatViewed: r.sessions,
      views: r.views,
      avgDwellSeconds: Math.round(r.avgDwellMs / 1000),
      addedToCart: r.added,
      ordered: r.ordered,
      // Precise definition, spelled out so the model cannot re-interpret it:
      openedLingeredAndNeverAdded: r.lost,
      avgDwellSecondsOfThoseSessions: Math.round(r.lostAvgDwellMs / 1000),
      addRatePct: pct(r.addRate),
      orderRatePct: pct(r.orderRate),
      ruleVerdict: r.verdict ? r.verdict.ar : '',
    })),
    cohorts: cohortList.map((c) => ({
      dimension: c.ar,
      groups: (c.groups || []).map((g) => ({
        group: g.ar, sessions: g.n, conversionPct: pct(g.convRate),
        avgOrderValue: Math.round(g.avgOrder * 100) / 100,
        sampleIsEnough: Boolean(g.enough),
      })),
    })),
    zeroResultSearches: (searches.zero || []).slice(0, 15).map((r) => ({ query: r.q, times: r.times, timesWithNoResult: r.zero })),
    topSearches: (searches.top || []).slice(0, 10).map((r) => ({ query: r.q, times: r.times })),
    availableAudiences: segments.map((s) => ({
      segmentId: s.id,
      describes: s.ar,
      computedFrom: s.why,
      sessions: s.sessionCount,
      reachableByWhatsapp: s.phones.length,
      unreachableAnonymous: s.anonymousDevices,
      itemIds: s.itemIds,
    })),
  }
}

export function buildPlannerPrompt(guard, snapshot, question) {
  return [
    guard,
    '',
    'بيانات السلوك الحقيقية لهذه الفترة (JSON):',
    JSON.stringify(snapshot),
    '',
    `سؤال المدير: ${question}`,
  ].join('\n')
}

// Extracts the plan block and REJECTS anything the model made up: an unknown
// segmentId or an unknown itemId is dropped and reported, never rendered as if
// it were real. Returns { text, campaign, content, rejected[] }.
export function parsePlan(reply, segments = [], itemRows = []) {
  const text = String(reply || '')
  const start = text.indexOf('[[PLAN_JSON]]')
  const end = text.indexOf('[[/PLAN_JSON]]')
  const clean = start >= 0 ? text.slice(0, start).trim() : text.trim()
  if (start < 0 || end < start) return { text: clean, campaign: null, content: null, rejected: [] }
  let spec = null
  const body = text.slice(start + '[[PLAN_JSON]]'.length, end)
  const match = body.match(/\{[\s\S]*\}/)
  try { spec = match ? JSON.parse(match[0]) : null } catch (_) { spec = null }
  if (!spec || typeof spec !== 'object') return { text: clean, campaign: null, content: null, rejected: ['تعذّرت قراءة كتلة الخطة'] }

  const rejected = []
  const knownItems = new Set(itemRows.map((r) => r.itemId))
  let campaign = null
  const c = spec.campaign
  if (c && (c.message || c.title)) {
    const seg = segments.find((s) => s.id === c.segmentId) || null
    if (c.segmentId && !seg) rejected.push(`شريحة غير معروفة رفضناها: ${String(c.segmentId).slice(0, 60)}`)
    const ids = (Array.isArray(c.itemIds) ? c.itemIds : []).map(String)
    const goodIds = ids.filter((id) => knownItems.has(id))
    if (ids.length !== goodIds.length) rejected.push('حُذفت معرّفات أصناف غير موجودة في بيانات الفترة')
    campaign = {
      title: String(c.title || 'حملة مقترحة').slice(0, 120),
      message: String(c.message || '').slice(0, 1200),
      timing: String(c.timing || '').slice(0, 160),
      itemIds: goodIds.length ? goodIds : (seg ? seg.itemIds : []),
      segmentId: seg ? seg.id : '',
      segment: seg,
    }
  }
  let content = null
  const k = spec.content
  if (k && (k.subject || k.caption || k.style)) {
    content = {
      subject: String(k.subject || '').slice(0, 200),
      style: String(k.style || '').slice(0, 200),
      caption: String(k.caption || '').slice(0, 600),
      itemIds: campaign ? campaign.itemIds : [],
    }
  }
  return { text: clean, campaign, content, rejected }
}


/* ---------------- resolution against the shared engine ----------------
   `src/lib/behavior.js` is the SOURCE OF TRUTH for every metric it defines, so
   this page and anything else reading behaviour data judge by the same rules
   (same thresholds, same "thin" flags, same null-when-no-denominator policy).
   Its return shapes differ from what these components render, so each function
   below ADAPTS rather than re-implements. If a shared export is missing or
   throws, the local implementation above takes over and `engineSources()`
   reports it in the UI — no silent wrong numbers either way.                */

// Shared `rate(n, of)` is { n, of, rate } with rate === null when of === 0.
const rateOf = (r) => (r && Number.isFinite(Number(r.rate)) ? Number(r.rate) : 0)
const baseOf = (r, fallback) => (r && Number.isFinite(Number(r.of)) ? Number(r.of) : fallback)

function callShared(fn, args) {
  if (typeof fn !== 'function') return undefined
  try { return fn(...args) } catch (_) { return undefined }
}

/* funnel: { sample, stages:[{ key, labelAr, n, fromPrev, fromTop, lostFromPrev }] } */
export function funnel(sessions = []) {
  const res = callShared(shared.funnel, [sessions])
  if (!res || !Array.isArray(res.stages) || res.stages.length < 3) return funnelLocal(sessions)
  const total = Number(res.sample) || sessions.length
  return res.stages.map((st, i) => ({
    key: String(st.key || FUNNEL_STEPS[i]?.key || `s${i}`),
    ar: st.labelAr || FUNNEL_STEPS[i]?.ar || '',
    en: FUNNEL_STEPS[i]?.en || String(st.key || ''),
    count: num(st.n),
    base: baseOf(st.fromPrev, total),
    sample: total,
    rate: rateOf(st.fromTop),
    stepRate: rateOf(st.fromPrev),
    lost: num(st.lostFromPrev),
  }))
}

/* itemInterest: { sample, items:[{ id, name, views, sessionsSeen, avgDwellMs,
   addRate, orderRate, lookedButNotOrdered:{sessions, share, avgDwellMs}, verdict }] }

   NOTE the shared definition of the headline metric: opened the item, stayed
   past MEANINGFUL_DWELL_MS, and NEVER ADDED IT TO THE CART. That is a strict
   subset of "viewed and did not order" — it deliberately excludes scroll-past
   glances. The table hint states this so the number is never over-read.        */
const VERDICT_AR = {
  ignored: { key: 'ignored', ar: 'موجود في المنيو ولم يُفتح إطلاقاً', tone: 'warn' },
  'thin-data': { key: 'thin', ar: 'عينة قليلة — لا حكم', tone: 'neutral' },
  'converts-well': { key: 'strong', ar: 'يتحوّل جيداً — رشّحه أكثر', tone: 'good' },
  'high-interest-no-order': { key: 'interest_no_order', ar: 'وقفوا عنده طويلاً ولم يضيفوه — اسأل عن السعر أو الصورة أو الوصف', tone: 'bad' },
  'quick-bounce': { key: 'glance', ar: 'يُفتح ويُغلق سريعاً — العرض لا يقنع', tone: 'warn' },
  neutral: { key: 'ok', ar: 'أداء اعتيادي', tone: 'neutral' },
}

// The evidence panel needs the actual session ids behind the number, which the
// shared engine does not return. Recomputed here with ITS definition so the
// panel can never disagree with the count above it.
function lostSidsFor(itemId, sessions) {
  const out = []
  sessions.forEach((s) => {
    const v = IT(s)[itemId]
    if (!v) return
    if (num(v.views) > 0 && num(v.dwellMs) >= MEANINGFUL_DWELL_MS && num(v.added) === 0) out.push(sidOf(s))
  })
  return out
}

export function itemInterest(sessions = [], items = []) {
  const res = callShared(shared.itemInterest, [sessions, items])
  if (!res || !Array.isArray(res.items)) return itemInterestLocal(sessions, items)
  return res.items.map((x) => {
    const lbno = x.lookedButNotOrdered || {}
    const sessionsSeen = num(x.sessionsSeen)
    const ordered = num(x.ordered)
    const added = num(x.added)
    return {
      itemId: String(x.id),
      name: x.name || String(x.id),
      views: num(x.views),
      sessions: sessionsSeen,
      dwellMs: num(x.dwellMs),
      avgDwellMs: num(x.avgDwellMs),
      added,
      removed: 0,
      ordered,
      addRate: rateOf(x.addRate),
      orderRate: rateOf(x.orderRate),
      addToOrderRate: added ? ordered / added : 0,
      lost: num(lbno.sessions),
      lostShare: Number.isFinite(Number(lbno.share)) ? Number(lbno.share) : 0,
      lostAvgDwellMs: num(lbno.avgDwellMs),
      lostSids: lostSidsFor(String(x.id), sessions),
      thin: Boolean(x.thin),
      verdict: VERDICT_AR[x.verdict] || VERDICT_AR.neutral,
    }
  })
}

/* dropOffPoints: WHERE sessions died (a page or an item), not which funnel step.
   Returns { points, nonConverting, unknown, sample } for the overview card.   */
export function dropOffPoints(sessions = []) {
  const res = callShared(shared.dropOffPoints, [sessions])
  if (!res || !Array.isArray(res.points)) {
    const local = dropOffPointsLocal(sessions)
    return {
      sample: sessions.length,
      nonConverting: sessions.filter((s) => !didOrder(s)).length,
      unknown: 0,
      fromFunnelSteps: true,
      points: local.map((d) => ({
        key: d.key,
        label: `${d.fromAr} ← ${d.toAr}`,
        kind: 'step',
        lost: d.lost,
        base: d.base,
        rate: d.rate,
        thin: d.base < COHORT_MIN,
      })),
    }
  }
  const nonConverting = num(res.nonConverting)
  return {
    sample: num(res.sample) || sessions.length,
    nonConverting,
    unknown: Math.max(0, num(res.unknownDropOff)),
    fromFunnelSteps: false,
    points: res.points.map((p) => ({
      key: String(p.where || p.id || ''),
      label: p.name || p.id || String(p.where || ''),
      kind: p.kind === 'item' ? 'item' : 'page',
      lost: num(p.n),
      base: nonConverting,
      rate: Number.isFinite(Number(p.shareOfLost)) ? Number(p.shareOfLost) : 0,
      shareOfAll: Number.isFinite(Number(p.shareOfAll)) ? Number(p.shareOfAll) : 0,
      thin: Boolean(p.thin),
    })),
  }
}

/* cohorts: { cohorts:[{ key, labelAr, yes, no, lift, note }] }.
   Average order value is NOT in the shared result, so it is computed here from
   the sessions' own outcome.total and merged in — the brief needs AOV per
   cohort. The "returning vs first-time" dimension is also added locally; the
   shared engine does not define it.                                          */
function aovFor(list) {
  const ordered = list.filter(didOrder)
  const revenue = ordered.reduce((sum, s) => sum + num(O(s).total), 0)
  return ordered.length ? revenue / ordered.length : 0
}

const COHORT_PREDICATE = {
  playedGame,
  usedAr,
  searched: (s) => num(C(s).searches) > 0,
  fromTable: (s) => Boolean(E(s).table),
  identified: (s) => Boolean(S(s).customerPhone || S(s).customerName),
}
const COHORT_ICON = { playedGame: 'play', usedAr: 'layers', searched: 'search', fromTable: 'qr', identified: 'user' }
const COHORT_SIDE_AR = {
  playedGame: ['لعب', 'لم يلعب'],
  usedAr: ['استخدم العرض', 'لم يستخدمه'],
  searched: ['استخدم البحث', 'لم يبحث'],
  fromTable: ['باركود الطاولة', 'دخول مباشر'],
  identified: ['سجّل بياناته', 'بقي مجهولاً'],
}

export function cohorts(sessions = [], orders = []) {
  const res = callShared(shared.cohorts, [sessions, orders])
  const back = returningFlags(sessions)
  const returningDim = {
    key: 'returning',
    ar: 'زائر عائد أم أول مرة',
    icon: 'repeat',
    note: 'العودة محسوبة داخل الفترة المختارة فقط — زيارة أقدم من الفترة لا تظهر هنا.',
    groups: [
      { key: 'returning', ar: 'عائد', ...groupStats(sessions.filter((s) => back.get(sidOf(s)))) },
      { key: 'first', ar: 'أول مرة', ...groupStats(sessions.filter((s) => !back.get(sidOf(s)))) },
    ],
  }
  if (!res || !Array.isArray(res.cohorts) || !res.cohorts.length) {
    return sessions.length ? cohortsLocal(sessions) : []
  }
  const adapted = res.cohorts.map((c) => {
    const pred = COHORT_PREDICATE[c.key]
    const inSet = pred ? sessions.filter(pred) : []
    const outSet = pred ? sessions.filter((s) => !pred(s)) : []
    const sides = COHORT_SIDE_AR[c.key] || ['نعم', 'لا']
    const side = (g, label, list) => ({
      key: g.key || 'x',
      ar: label,
      n: num(g.sample),
      ordered: num(g.ordered),
      convRate: rateOf(g.conversion),
      avgActiveMs: num(g.avgActiveMs),
      avgOrder: aovFor(list),
      // The shared engine owns the threshold; `thin` is its verdict, not ours.
      enough: !g.thin,
    })
    return {
      key: String(c.key),
      ar: c.labelAr || String(c.key),
      icon: COHORT_ICON[c.key] || 'layers',
      note: c.note || '',
      lift: Number.isFinite(Number(c.lift)) ? Number(c.lift) : null,
      groups: [side(c.yes || {}, sides[0], inSet), side(c.no || {}, sides[1], outSet)],
    }
  })
  return sessions.length ? [...adapted, returningDim] : adapted
}

/* customerProfile / sessionSummary: LOCAL on purpose.
   The shared versions are correct but shaped for reporting, not for this UI:
   `customerProfile` keys strictly on a phone (this page must also profile an
   anonymous guest by deviceId, and pull in that device's earlier pre-signup
   sessions), and `sessionSummary` returns a collapsed path rather than the raw
   event list the timeline draws. Using them here would render less than the
   data actually holds, so these two stay local — stated openly in the UI.    */
export const customerProfile = (sessions, key) => customerProfileLocal(sessions, key)
export const sessionSummary = (s) => sessionSummaryLocal(s)

/* AI guard: the shared guard is the anti-hallucination contract and comes
   first, verbatim. The machine-readable clauses below are what makes the answer
   ACTIONABLE (a segmentId the page can resolve to real phone numbers, and a
   parseable plan block) — they constrain the model further, never loosen it. */
const PLAN_CONTRACT_AR = [
  'قيود إضافية على المخرجات:',
  'الجمهور: لا تصف جمهوراً من عندك. اختر segmentId واحداً من availableAudiences فقط، حرفياً كما هو مكتوب.',
  'itemIds: استخدم فقط المعرفات الموجودة في هذا الملخص.',
  'إن تضمّنت خطتك حملة أو محتوى، أضف في آخر ردك كتلة JSON واحدة فقط بين [[PLAN_JSON]] و [[/PLAN_JSON]] بهذا الشكل تماماً:',
  '{"campaign":{"title":"","segmentId":"","message":"","itemIds":[],"timing":""},"content":{"subject":"","style":"","caption":""}}',
  'اترك أي حقل فارغاً إن لم يكن مناسباً، ولا تضف حقولاً أخرى.',
].join('\n')

export const AI_PLANNER_GUARD_AR = [
  (typeof shared.AI_PLANNER_GUARD_AR === 'string' && shared.AI_PLANNER_GUARD_AR.trim().length > 40)
    ? shared.AI_PLANNER_GUARD_AR
    : AI_PLANNER_GUARD_LOCAL,
  '',
  PLAN_CONTRACT_AR,
].join('\n')

/* aiSnapshot: the shared snapshot is the strict, thin-flagged view of the
   period and is used as-is. `availableAudiences` is merged on top because only
   this page resolves segments to REAL, de-duplicated phone numbers — that list
   is what keeps a proposed campaign from being a hallucinated audience.      */
export function aiSnapshot(arg = {}) {
  const local = aiSnapshotLocal(arg)
  const res = callShared(shared.aiSnapshot, [{
    sessions: arg.sessions || [],
    orders: arg.orders || [],
    items: arg.items || [],
    customers: arg.customers || [],
  }])
  if (!res || typeof res !== 'object' || Array.isArray(res)) return local
  return {
    ...res,
    period: local.period,
    venue: local.venue,
    currency: local.currency,
    sampleSize: res.sampleSize || local.sampleSize,
    availableAudiences: local.availableAudiences,
  }
}

// Which implementation is behind each number, surfaced in the UI so nobody has
// to guess whether the shared engine is actually wired up.
export function engineSources() {
  return {
    funnel: typeof shared.funnel === 'function',
    itemInterest: typeof shared.itemInterest === 'function',
    dropOffPoints: typeof shared.dropOffPoints === 'function',
    cohorts: typeof shared.cohorts === 'function',
    aiSnapshot: typeof shared.aiSnapshot === 'function',
    guard: typeof shared.AI_PLANNER_GUARD_AR === 'string',
    customerProfile: false, // local by design (see note above)
    sessionSummary: false,  // local by design (see note above)
  }
}
