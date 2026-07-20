// «ذاكرة المكان» — what the venue may say out loud to a returning guest.
//
// PURE. No Firestore, no network, no React. Every function takes plain arrays
// and returns plain objects, so the whole thing is testable and safe to run on
// the client or inside a Cloud Function.
//
// ==========================================================================
// THE ONE RULE THIS FILE EXISTS TO ENFORCE
// ==========================================================================
// A good waiter who remembers a regular says: "طال غيابك", "المعتاد؟",
// "عاشر زيارة لك معنا". He does NOT say: "you looked at the latte for 22
// seconds across 4 menu opens from device a3f9". Both are built from the same
// observations. Only the first is something a guest is glad to hear.
//
// So this module draws a hard line between EVIDENCE and SPEECH:
//   • EVIDENCE may use anything we legitimately recorded (views, dwell,
//     sessions) to DECIDE which line is worth saying and to let the venue
//     verify it. It is attached to every line as `evidence` and is meant for
//     the venue's eyes.
//   • SPEECH (`text`) may only state facts the guest ALREADY KNOWS about
//     themselves — they were here, they ordered this, they have not tried
//     that, they played a game. Never a count of how they browsed.
// The signal picks the SUBJECT; the sentence states the mutually-known FACT.
//
// Hard consequences of that rule, implemented below:
//   1. Dwell time, device ids, session counts and view counts NEVER appear in
//      any `text`. They appear only inside `evidence`.
//   2. A "visit" is counted ONLY from real orders. Opening the menu is not a
//      visit, and telling someone how often they opened a menu is exactly the
//      thing we refuse to do.
//   3. Nothing true to say -> return []. A fabricated "أهلاً بعودتك" to a
//      first-time guest is worse than silence, because it is a lie the guest
//      can detect instantly, and it poisons every true line that follows.
//   4. Every claim carries the integers it was counted from. Nothing is
//      estimated, smoothed, or inferred from a model.
//
// ASSUMPTION ABOUT `orders` (stated because a wrong assumption here produces a
// false claim): the caller passes THIS GUEST'S known order history — device
// history and/or the phone-matched CRM rows — not a global window of the
// venue's orders. If a `customer` with a lifetime `totalOrders` counter is
// supplied, that counter wins for milestone counting because it is the venue's
// own authoritative number; otherwise milestones are counted from `orders` and
// `evidence.source` records which of the two was used.

// ---------- tone contract, exported so reviewers and the AI read the same text ----------
export const MEMORY_TONE_NOTE_AR = [
  'ذاكرة المكان — قواعد النبرة (ملزمة):',
  'اذكر فقط ما يعرفه الضيف عن نفسه أصلاً: أنه زارنا، وماذا طلب، وكم مرة، وأنه لم يجرّب صنفاً بعد.',
  'لا تذكر أبداً مدة بقائه على الشاشة، ولا معرّف جهازه، ولا كم مرة فتح المنيو، ولا كم مرة شاهد صنفاً.',
  'هذه البيانات تُستخدم لاختيار ما يستحق أن يُقال فقط، ولا تُقال أبداً.',
  'الصنف الذي شاهده ولم يطلبه يُذكر كدعوة لتجربته، لا كملاحظة عن مراقبته.',
  'الزيارة تُحتسب من الطلبات الفعلية فقط. فتح المنيو ليس زيارة.',
  'كل سطر يحمل دليله (evidence) ليتمكن الموظف من التحقق منه قبل قوله.',
  'إذا لم يوجد شيء صحيح ومحدد نقوله، لا نقول شيئاً. ترحيب عام بضيف لأول مرة أسوأ من الصمت.',
  'النمط الشخصي ناتج عن إجابات اختارها الضيف بنفسه داخل لعبة، ويُذكر كاختيار له لا كتشخيص.',
  'اكتب بالعربية، وبأرقام لاتينية، وبدون رموز تعبيرية.',
].join(' ')

// ---------- thresholds (one place; every verdict points at one of these) ----------
export const MEMORY_THRESHOLDS = {
  MEANINGFUL_DWELL_MS: 4000,   // mirrors behavior.js — below this a view is a scroll-past
  CURIOUS_MIN_SESSIONS: 2,     // must have come back to the item on a different visit
  CURIOUS_MIN_VIEWS: 3,
  USUAL_MIN_VISITS: 3,         // fewer than this and "the usual" is not a pattern
  USUAL_MIN_TIMES: 2,
  USUAL_MIN_SHARE: 0.4,
  STREAK_MIN_WEEKS: 3,
  STALE_VISIT_DAYS: 400,       // beyond this we welcome them back but never push "the usual"
  BIRTHDAY_WINDOW_DAYS: 1,
  MAX_LINES: 6,
}

// Milestones a venue would actually celebrate out loud.
const MILESTONES = [3, 5, 10, 20, 25, 50, 100]

// Statuses that mean the visit did not really happen as an order.
const DEAD_STATUSES = new Set(['cancelled', 'canceled', 'refunded', 'void', 'voided', 'rejected', 'awaiting_payment', 'failed'])

const DAY_MS = 24 * 60 * 60 * 1000

// ---------- tiny pure helpers ----------
const arr = (v) => (Array.isArray(v) ? v : [])
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const str = (v) => String(v == null ? '' : v).trim()

// Firestore Timestamp | Date | ms | ISO -> ms, or null. Never throws.
function ms(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null
  if (typeof v === 'object') {
    if (typeof v.toMillis === 'function') { try { return v.toMillis() } catch (_) { return null } }
    if (typeof v.toDate === 'function') { try { return v.toDate().getTime() } catch (_) { return null } }
    if (Number.isFinite(v.seconds)) return v.seconds * 1000
  }
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null }
  return null
}

// Local calendar day key. Two orders on the same evening are ONE visit.
function dayKey(msVal) {
  const d = new Date(msVal)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// Last 9 digits — matches '9665xxxxxxx' against '05xxxxxxxx' without importing
// anything, so this file stays dependency-free and unit-testable in isolation.
function phoneKey(v) {
  const d = str(v).replace(/[^0-9]/g, '')
  return d ? d.slice(-9) : ''
}

// ---------- Arabic counted nouns (real grammar, not `${n} مرة` everywhere) ----------
function arTimes(n) {
  if (n === 1) return 'مرة واحدة'
  if (n === 2) return 'مرتين'
  if (n >= 3 && n <= 10) return `${n} مرات`
  return `${n} مرة`
}
function arVisits(n) {
  if (n === 1) return 'زيارة واحدة'
  if (n === 2) return 'زيارتين'
  if (n >= 3 && n <= 10) return `${n} زيارات`
  return `${n} زيارة`
}
function arDays(n) {
  if (n >= 3 && n <= 10) return `${n} أيام`
  return `${n} يوماً`
}
function arWeeks(n) {
  if (n === 2) return 'أسبوعين'
  if (n >= 3 && n <= 10) return `${n} أسابيع`
  return `${n} أسبوعاً`
}
function arMonths(n) {
  if (n === 2) return 'شهرين'
  if (n >= 3 && n <= 10) return `${n} أشهر`
  return `${n} شهراً`
}
const AR_ORDINAL = { 3: 'ثالث', 5: 'خامس', 10: 'عاشر' }
const EN_ORDINAL = (n) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

// "how long ago" in the way a person says it, never as a raw day count > a week.
function agoAr(days) {
  if (days <= 0) return 'اليوم'
  if (days === 1) return 'أمس'
  if (days === 2) return 'أول أمس'
  if (days <= 6) return `قبل ${arDays(days)}`
  if (days <= 13) return 'قبل أسبوع'
  if (days <= 29) return `قبل ${arWeeks(Math.round(days / 7))}`
  if (days <= 59) return 'قبل شهر'
  if (days <= 364) return `قبل ${arMonths(Math.round(days / 30))}`
  return 'قبل أكثر من سنة'
}
function agoEn(days) {
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days <= 6) return `${days} days ago`
  if (days <= 13) return 'a week ago'
  if (days <= 29) return `${Math.round(days / 7)} weeks ago`
  if (days <= 59) return 'a month ago'
  if (days <= 364) return `${Math.round(days / 30)} months ago`
  return 'over a year ago'
}

// ---------- menu index ----------
// Availability mirrors MenuView exactly: `available === false` or a tracked
// item at zero stock is not orderable, so we never invite a guest to try
// something the kitchen cannot make.
function indexItems(items) {
  const idx = new Map()
  for (const it of arr(items)) {
    const id = str(it && (it.id || it.itemId))
    if (!id) continue
    idx.set(id, {
      id,
      nameAr: str(it.nameAr || it.name || it.nameEn),
      nameEn: str(it.nameEn || it.name || it.nameAr),
      orderable: !(it.available === false || (it.trackStock && num(it.stock) <= 0)),
    })
  }
  return idx
}

const nameOf = (rec, lang) => (lang === 'en' ? (rec.nameEn || rec.nameAr) : (rec.nameAr || rec.nameEn))

// Join up to two names naturally; anything beyond becomes "وغيرها".
function joinAr(names) {
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} و${names[1]}`
  return `${names[0]} و${names[1]} وغيرها`
}
function joinEn(names) {
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names[0]}, ${names[1]} and more`
}

// ---------- visits ----------
// A VISIT IS AN ORDER. Not a session, not a scan, not a menu open.
// Returns [{ day, at, itemIds:Set, names:[{ar,en}], total }] oldest -> newest.
function buildVisits(orders, customer) {
  const wantPhone = phoneKey(customer && customer.phone)
  const byDay = new Map()

  for (const o of arr(orders)) {
    if (!o || typeof o !== 'object') continue
    if (DEAD_STATUSES.has(str(o.status).toLowerCase())) continue
    // When we know who the guest is, only their own rows count. When we do not,
    // we trust the caller's scoping (documented at the top of this file).
    if (wantPhone && phoneKey(o.customerPhone) && phoneKey(o.customerPhone) !== wantPhone) continue

    const at = ms(o.createdAt) ?? ms(o.paidAtMs) ?? ms(o.at) ?? ms(o.updatedAt)
    if (at == null) continue

    const day = dayKey(at)
    const v = byDay.get(day) || { day, at, itemIds: new Set(), names: [], total: 0, orders: 0 }
    v.at = Math.max(v.at, at)
    v.orders += 1
    v.total += num(o.total)
    for (const line of arr(o.items)) {
      const id = str(line && (line.itemId || line.id))
      const ar = str(line && (line.nameAr || line.name))
      const en = str(line && (line.nameEn || line.name))
      if (!id && !ar && !en) continue
      if (id) v.itemIds.add(id)
      v.names.push({ id, ar: ar || en, en: en || ar })
    }
    byDay.set(day, v)
  }

  return [...byDay.values()].sort((a, b) => a.at - b.at)
}

// ---------- lines ----------
const line = (id, kind, textAr, textEn, strength, evidence, action) => ({
  id, kind, text: textAr, textEn, strength, evidence, ...(action ? { action } : {}),
})

/**
 * recallFor — the ordered list of things this venue may honestly say to this guest.
 *
 * @param {object}  input
 * @param {Array}   input.orders    this guest's known orders (device history and/or phone-matched CRM rows)
 * @param {Array}   input.sessions  this guest's menu sessions (used ONLY to choose a subject, never quoted)
 * @param {Array}   input.plays     this guest's gamePlays rows
 * @param {object}  input.customer  CRM row: { phone, name, totalOrders, birthday: 'MM-DD', ... }
 * @param {Array}   input.items     the live menu, so we never name an unorderable item
 * @param {object}  input.tenant    venue doc (reserved; no claim is derived from it today)
 * @param {number}  input.now       ms clock, injectable for tests
 * @returns {Array<{id,kind,text,textEn,strength,evidence,action?}>} strongest first; [] when there is nothing true to say
 */
export function recallFor({ orders, sessions, plays, customer, items, tenant, now } = {}) {
  const t = Number.isFinite(now) ? now : Date.now()
  const today = dayKey(t)
  const idx = indexItems(items)
  const out = []

  const visits = buildVisits(orders, customer)
  // Every claim below is built from PAST visits only. Today's order is excluded
  // on purpose: the card renders at the top of the menu, usually before the
  // guest orders, and a sentence must not change meaning mid-session.
  const past = visits.filter((v) => v.day !== today)

  // ---- GATE: no proven prior visit -> say nothing at all. ----
  // This is the single most important branch in the file. Everything downstream
  // assumes the guest has genuinely been here before.
  if (!past.length) return []

  const last = past[past.length - 1]
  const daysSince = Math.max(0, Math.floor((t - last.at) / DAY_MS))
  const stale = daysSince > MEMORY_THRESHOLDS.STALE_VISIT_DAYS
  const visitCount = past.length

  // ---------- 1. birthday (only when the venue itself holds it) ----------
  const bday = str(customer && customer.birthday) // 'MM-DD'
  if (/^\d{2}-\d{2}$/.test(bday)) {
    const d = new Date(t)
    const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    // Compare against a small window so a timezone edge does not miss the day.
    // The TEXT is only ever a greeting: we never announce "your birthday is in
    // N days", which is the creepy version of the same fact.
    let hit = mmdd === bday
    if (!hit) {
      for (let k = 1; k <= MEMORY_THRESHOLDS.BIRTHDAY_WINDOW_DAYS && !hit; k++) {
        for (const sign of [-1, 1]) {
          const alt = new Date(t + sign * k * DAY_MS)
          const key = `${String(alt.getMonth() + 1).padStart(2, '0')}-${String(alt.getDate()).padStart(2, '0')}`
          if (key === bday) { hit = true; break }
        }
      }
    }
    if (hit) {
      out.push(line(
        'birthday', 'birthday',
        'كل عام وأنت بخير — سعداء أنك اخترت أن تكون معنا اليوم.',
        'Happy birthday — we are glad you chose to spend it with us.',
        0.98,
        { source: 'customer.birthday', birthday: bday, heldByVenue: true },
      ))
    }
  }

  // ---------- 2. milestone (this visit's number) ----------
  // Prefer the venue's own lifetime counter; it is authoritative and complete.
  // Fall back to what we counted, and record which was used so the venue can
  // verify the claim before a staffer repeats it.
  const crmOrders = num(customer && customer.totalOrders, NaN)
  const usingCrm = Number.isFinite(crmOrders) && crmOrders > 0
  const priorCount = usingCrm ? Math.round(crmOrders) : visitCount
  const thisVisitNo = priorCount + 1
  if (MILESTONES.includes(thisVisitNo)) {
    const ord = AR_ORDINAL[thisVisitNo]
    out.push(line(
      'milestone', 'milestone',
      ord ? `${ord} زيارة لك معنا.` : `زيارتك رقم ${thisVisitNo} معنا.`,
      `Your ${EN_ORDINAL(thisVisitNo)} visit with us.`,
      0.9,
      {
        source: usingCrm ? 'customer.totalOrders' : 'counted orders',
        priorVisits: priorCount,
        thisVisitNo,
        countedVisitDays: visitCount,
      },
    ))
  }

  // ---------- 3. the usual ----------
  // "طلبته 4 مرات من 6 زيارات" — both integers are counted, never rounded.
  let usual = null
  if (!stale && visitCount >= MEMORY_THRESHOLDS.USUAL_MIN_VISITS) {
    const tally = new Map() // itemId -> { times, ar, en }
    for (const v of past) {
      const seen = new Set()
      for (const n of v.names) {
        const key = n.id || `name:${n.ar || n.en}`
        if (!key || seen.has(key)) continue
        seen.add(key)
        const rec = tally.get(key) || { times: 0, ar: n.ar, en: n.en, itemId: n.id || '' }
        rec.times += 1
        if (!rec.ar && n.ar) rec.ar = n.ar
        if (!rec.en && n.en) rec.en = n.en
        tally.set(key, rec)
      }
    }
    const ranked = [...tally.values()].sort((a, b) => b.times - a.times)
    const top = ranked[0]
    if (top && top.times >= MEMORY_THRESHOLDS.USUAL_MIN_TIMES && top.times / visitCount >= MEMORY_THRESHOLDS.USUAL_MIN_SHARE) {
      const menuRec = top.itemId ? idx.get(top.itemId) : null
      // Only offer to re-add it when it is genuinely on the menu right now.
      const canReorder = !!(menuRec && menuRec.orderable)
      const ar = (menuRec && menuRec.nameAr) || top.ar || top.en
      const en = (menuRec && menuRec.nameEn) || top.en || top.ar
      if (ar || en) {
        usual = { itemId: top.itemId, ar, en, times: top.times }
        out.push(line(
          'usual', 'usual',
          `${ar} هو المعتاد لك — طلبته ${arTimes(top.times)} من ${arVisits(visitCount)}.`,
          `${en} is your usual — ordered on ${top.times} of ${visitCount} visits.`,
          0.8,
          { source: 'orders', itemId: top.itemId, times: top.times, ofVisits: visitCount, onMenuNow: canReorder },
          canReorder ? { kind: 'reorder', itemId: top.itemId, labelAr: 'اطلب المعتاد', labelEn: 'Order the usual' } : null,
        ))
      }
    }
  }

  // ---------- 4. weekly streak ----------
  // Consecutive 7-day windows (counted back from today) that contain at least
  // one visit. Three or more is a habit worth naming.
  {
    const weekOf = (atMs) => Math.floor((t - atMs) / (7 * DAY_MS))
    const weeks = new Set(past.map((v) => weekOf(v.at)))
    let streak = 0
    // Week 0 is the current 7 days; a visit today is excluded already, so we
    // start at the most recent week that actually has a visit.
    const newest = Math.min(...weeks)
    let w = newest
    if (Number.isFinite(w)) {
      while (weeks.has(w)) { streak += 1; w += 1 }
    }
    // A streak must be CURRENT to be spoken in the present tense. A guest who
    // came weekly for five weeks and then vanished six months ago would
    // otherwise be told "خمسة أسابيع على التوالي وأنت معنا" — grammatically
    // present, factually past, and instantly recognisable to them as a machine
    // talking. Historical streaks stay unspoken.
    const isCurrent = Number.isFinite(newest) && newest <= 1
    if (isCurrent && streak >= MEMORY_THRESHOLDS.STREAK_MIN_WEEKS) {
      out.push(line(
        'streak', 'streak',
        `${arWeeks(streak)} على التوالي وأنت معنا.`,
        `${streak} weeks in a row with us.`,
        0.72,
        { source: 'orders', consecutiveWeeks: streak, visitDays: past.length, weeksSinceLastVisit: newest },
      ))
    }
  }

  // ---------- 5. last visit ----------
  {
    const names = []
    const seen = new Set()
    for (const n of last.names) {
      const label = n.ar || n.en
      if (!label || seen.has(label)) continue
      seen.add(label)
      names.push({ ar: n.ar || n.en, en: n.en || n.ar })
      if (names.length >= 3) break
    }
    const ar = names.length
      ? `آخر مرة كنت معنا ${agoAr(daysSince)}، وطلبت ${joinAr(names.map((n) => n.ar))}.`
      : `آخر مرة كنت معنا ${agoAr(daysSince)}.`
    const en = names.length
      ? `Last time you were here ${agoEn(daysSince)}, and you ordered ${joinEn(names.map((n) => n.en))}.`
      : `Last time you were here ${agoEn(daysSince)}.`
    out.push(line(
      'last-visit', 'lastVisit',
      stale ? `طال غيابك — آخر مرة كنت معنا ${agoAr(daysSince)}. أهلاً بعودتك.` : ar,
      stale ? `It has been a while — last time you were here ${agoEn(daysSince)}. Welcome back.` : en,
      stale ? 0.85 : 0.6,
      { source: 'orders', lastVisitDay: last.day, daysSince, itemsOnThatVisit: names.length, orderCountThatDay: last.orders },
    ))
  }

  // ---------- 6. the thing they keep coming back to look at ----------
  //
  // READ THIS BEFORE CHANGING THE WORDING.
  // The view/dwell signal chooses WHICH item to name. The sentence itself
  // states only a fact the guest already knows: they have not tried it. We do
  // not say "you looked at it N times" — that is the surveillance version of
  // the same helpful thought, and it would make a guest feel watched rather
  // than remembered. The counts live in `evidence` for the venue to verify.
  {
    const orderedIds = new Set()
    for (const v of visits) for (const id of v.itemIds) orderedIds.add(id)

    const looked = new Map() // itemId -> { sessions, views, bestDwell }
    for (const s of arr(sessions)) {
      const bag = s && s.items && typeof s.items === 'object' ? s.items : {}
      for (const id of Object.keys(bag)) {
        const rec = bag[id] || {}
        const views = num(rec.views)
        if (views <= 0) continue
        const cur = looked.get(id) || { sessions: 0, views: 0, bestDwell: 0 }
        cur.sessions += 1
        cur.views += views
        cur.bestDwell = Math.max(cur.bestDwell, num(rec.dwellMs))
        looked.set(id, cur)
      }
    }

    const candidates = []
    for (const [id, sig] of looked) {
      if (orderedIds.has(id)) continue
      const menuRec = idx.get(id)
      if (!menuRec || !menuRec.orderable) continue
      if (sig.sessions < MEMORY_THRESHOLDS.CURIOUS_MIN_SESSIONS) continue
      if (sig.views < MEMORY_THRESHOLDS.CURIOUS_MIN_VIEWS) continue
      if (sig.bestDwell < MEMORY_THRESHOLDS.MEANINGFUL_DWELL_MS) continue
      candidates.push({ id, menuRec, sig })
    }
    candidates.sort((a, b) => (b.sig.sessions - a.sig.sessions) || (b.sig.views - a.sig.views))

    const pick = candidates[0]
    if (pick && !stale) {
      const ar = nameOf(pick.menuRec, 'ar')
      const en = nameOf(pick.menuRec, 'en')
      out.push(line(
        'curious', 'curious',
        `${ar} ما زال بانتظارك — لم تجرّبه معنا بعد.`,
        `${en} is still waiting for you — you have not tried it with us yet.`,
        0.5,
        {
          source: 'sessions + orders',
          itemId: pick.id,
          neverOrdered: true,
          // For the venue only. Never rendered as text.
          distinctSessionsViewed: pick.sig.sessions,
          totalViews: pick.sig.views,
          longestOpenMs: pick.sig.bestDwell,
        },
        { kind: 'try', itemId: pick.id, labelAr: 'جرّبه اليوم', labelEn: 'Try it today' },
      ))
    }
  }

  // ---------- 7. games ----------
  {
    const rows = arr(plays).filter((p) => p && num(p.score, NaN) === num(p.score, NaN))
    let best = null
    for (const p of rows) {
      const score = num(p.score)
      if (score <= 0) continue
      if (!best || score > num(best.score)) best = p
    }
    // The archetype is a SELF-REPORT the guest produced by choosing answers in a
    // game. It is never presented as a diagnosis or a judgement about a person.
    let archetype = ''
    let archetypeFrom = ''
    for (const p of rows) {
      const a = str(p.result && p.result.archetype)
      if (a) { archetype = a; archetypeFrom = str(p.gameAr || p.gameId) }
    }

    if (best) {
      const game = str(best.gameAr || best.gameId)
      const score = Math.round(num(best.score))
      const ar = archetype
        ? `أفضل نتيجة لك ${game ? `في «${game}» ` : ''}كانت ${score} — واخترت لنفسك نمط «${archetype}».`
        : `أفضل نتيجة لك ${game ? `في «${game}» ` : ''}كانت ${score}.`
      const en = archetype
        ? `Your best score${game ? ` in ${game}` : ''} was ${score} — and you picked "${archetype}" for yourself.`
        : `Your best score${game ? ` in ${game}` : ''} was ${score}.`
      out.push(line(
        'game-best', 'game',
        ar, en, 0.4,
        { source: 'gamePlays', gameId: str(best.gameId), score, playsCounted: rows.length, archetype: archetype || null, archetypeFrom: archetypeFrom || null, archetypeBasis: 'إجابات اختارها الضيف داخل لعبة' },
      ))
    } else if (archetype) {
      out.push(line(
        'game-archetype', 'game',
        `اخترت لنفسك نمط «${archetype}» في إحدى ألعابنا.`,
        `You picked "${archetype}" for yourself in one of our games.`,
        0.35,
        { source: 'gamePlays', archetype, archetypeFrom: archetypeFrom || null, archetypeBasis: 'إجابات اختارها الضيف داخل لعبة' },
      ))
    }
  }

  // Strongest first, stable, capped. `usual` is referenced above only to keep
  // the reorder action honest; it needs no further use here.
  void usual
  void tenant
  return out
    .filter((l) => l && str(l.text))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MEMORY_THRESHOLDS.MAX_LINES)
}

// Convenience for callers that only want to know whether to mount the card.
export function hasRecall(input) {
  return recallFor(input).length > 0
}
