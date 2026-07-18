// ==================== CAMPAIGNS + LOYALTY PERKS + LIFECYCLE AUTOMATION ====================
// 1) processCampaigns — scheduled runner: sends due campaigns (targeted, A/B,
//    recurring) via WhatsApp + optional in-menu notice. Atomic claim, monthly cap,
//    per-customer opt-out.
// 2) Auto promos — offer created / item starred / new items: sent to MEMBERS or
//    EVERYONE per tenant.autoPromos (and the perks matrix in perks loyalty mode).
// 3) Lifecycle — welcome on membership grant, congrats on tier upgrade,
//    birthday greetings (daily), win-back for idle customers (daily).
// Registered from index.js via Object.assign(exports, require('./campaigns')).
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { sendWhatsAppText, waCredsFor } = require('./messaging')

// Personalize a template: {name}/{الاسم} → customer name, {venue}/{المنشأة} → venue.
function fill(text, { name, venue }) {
  return String(text || '')
    .replace(/\{name\}|\{الاسم\}/g, name || 'عميلنا العزيز')
    .replace(/\{venue\}|\{المنشأة\}/g, venue || '')
}

const digits = (p) => String(p || '').replace(/[^0-9]/g, '')

// ---- monthly send cap (defends the venue's WhatsApp quota/bill) ----
const PERIOD = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).slice(0, 7)
async function takeQuota(db, tid, want) {
  const ref = db.doc(`tenants/${tid}`)
  let granted = 0
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref)
    if (!s.exists) return
    const t = s.data() || {}
    const cap = Number(t.msgCapMonthly) || 2000
    const cur = t.msgsSent && t.msgsSent.period === PERIOD() ? (Number(t.msgsSent.count) || 0) : 0
    granted = Math.max(0, Math.min(want, cap - cur))
    tx.set(ref, { msgsSent: { period: PERIOD(), count: cur + granted } }, { merge: true })
  }).catch(() => {})
  return granted
}

// Resolve one customer against an audience spec.
function matchesAudience(c, audience, ids) {
  if (c.optOut === true) return false // respects "أوقفوا الرسائل"
  const orders = Number(c.totalOrders) || 0
  const m = c.membership
  switch (audience) {
    case 'custom': return Array.isArray(ids) && ids.includes(digits(c.phone))
    case 'members': return !!(m && m.active)
    case 'silver': case 'gold': case 'platinum': return !!(m && m.active && m.tier === audience)
    case 'active5': return orders >= 5
    case 'orders10': return orders >= 10
    case 'orders15': return orders >= 15
    default: return true // 'all'
  }
}

// Send with bounded concurrency. textFor(c, i) may vary per customer (A/B).
// creds (optional, from waCredsFor) → messages go out from the VENUE's own number.
async function fanOut(customers, textFor, creds) {
  let sent = 0
  let failed = 0
  const BATCH = 8
  for (let i = 0; i < customers.length; i += BATCH) {
    await Promise.all(customers.slice(i, i + BATCH).map(async (c, j) => {
      const to = digits(c.phone)
      if (!to) return
      try { await sendWhatsAppText(to, textFor(c, i + j), creds); sent += 1 } catch (_) { failed += 1 }
    }))
  }
  return { sent, failed }
}

// ---------------------------------------------------------------------------
// processCampaigns — every 5 minutes. Handles A/B split, recurring re-schedule,
// monthly cap, and the optional in-menu notice channel.
// ---------------------------------------------------------------------------
const processCampaigns = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'Asia/Riyadh', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = getFirestore()
    const snap = await db.collectionGroup('campaigns')
      .where('status', '==', 'scheduled')
      .where('scheduleAt', '<=', Date.now())
      .limit(20).get().catch(() => null)
    if (!snap || snap.empty) return

    for (const doc of snap.docs) {
      let claimed = false
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref)
        if (!fresh.exists || fresh.data().status !== 'scheduled') return
        tx.update(doc.ref, { status: 'sending', startedAt: FieldValue.serverTimestamp() })
        claimed = true
      }).catch(() => {})
      if (!claimed) continue

      const camp = doc.data()
      const tid = doc.ref.parent.parent.id
      try {
        const tSnap = await db.doc(`tenants/${tid}`).get()
        const venue = tSnap.exists ? (tSnap.data().name || '') : ''
        const custSnap = await db.collection(`tenants/${tid}/customers`).get()
        let targets = custSnap.docs.map((d) => d.data())
          .filter((c) => matchesAudience(c, camp.audience || 'all', camp.audienceIds))

        let sent = 0
        let failed = 0
        let capped = 0
        if (camp.channels?.whatsapp !== false && targets.length) {
          const quota = await takeQuota(db, tid, targets.length)
          capped = targets.length - quota
          targets = targets.slice(0, quota)
          const hasB = !!(camp.textB && camp.textB.trim())
          const creds = await waCredsFor(db, tid)
          const r = await fanOut(targets, (c, i) => fill(hasB && i % 2 === 1 ? camp.textB : camp.text, { name: c.name, venue }), creds)
          sent = r.sent; failed = r.failed
        }
        if (camp.channels?.notice) {
          await db.collection(`tenants/${tid}/notices`).add({
            title: camp.title || venue, body: fill(camp.text, { name: '', venue }).trim(),
            createdAt: FieldValue.serverTimestamp(),
          }).catch(() => {})
        }

        const totals = {
          sentCount: (Number(camp.sentCount) || 0) + sent,
          failCount: (Number(camp.failCount) || 0) + failed,
          runs: (Number(camp.runs) || 0) + 1,
        }
        if (camp.repeat === 'weekly' || camp.repeat === 'daily') {
          // recurring: back to scheduled at the next slot, stats accumulate
          const step = camp.repeat === 'daily' ? 86400000 : 7 * 86400000
          let next = Number(camp.scheduleAt) || Date.now()
          while (next <= Date.now()) next += step
          await doc.ref.update({ ...totals, status: 'scheduled', scheduleAt: next, lastRunAt: FieldValue.serverTimestamp(), audienceCount: targets.length + capped, cappedCount: capped })
        } else {
          await doc.ref.update({ ...totals, status: 'sent', sentAt: FieldValue.serverTimestamp(), audienceCount: targets.length + capped, cappedCount: capped })
        }
      } catch (e) {
        await doc.ref.update({ status: 'failed', error: String((e && e.message) || e).slice(0, 300) }).catch(() => {})
      }
    }
  }
)

// ---------------------------------------------------------------------------
// AUTO PROMOS — offers / featured / new items.
// Recipients resolved from (a) an explicit per-item override (item.promoNotify:
// 'off'|'members'|'all'), else (b) tenant.autoPromos[kind]: 'off'|'members'|'all',
// else (c) legacy: members when perks loyalty mode is on. 'members' additionally
// respects the perks matrix tiers when the venue runs perks mode.
// ---------------------------------------------------------------------------
const DEFAULT_PERKS = {
  silver: { offers: true, featured: false, newItems: false },
  gold: { offers: true, featured: true, newItems: false },
  platinum: { offers: true, featured: true, newItems: true },
}

function promoScope(t, kind, itemOverride) {
  if (itemOverride === 'off' || itemOverride === 'members' || itemOverride === 'all') return itemOverride
  const cfg = (t.autoPromos || {})[kind]
  if (cfg === 'off' || cfg === 'members' || cfg === 'all') return cfg
  const pol = t.membershipPolicy || {}
  return pol.enabled === true && (pol.mode || 'discounts') === 'perks' ? 'members' : 'off'
}

// extra (optional): { item, code } — fills the venue's custom template placeholders.
async function sendPromo(db, tid, kind, itemOverride, buildText, extra) {
  const tSnap = await db.doc(`tenants/${tid}`).get()
  if (!tSnap.exists) return
  const t = tSnap.data() || {}
  const scope = promoScope(t, kind, itemOverride)
  if (scope === 'off') return
  const pol = t.membershipPolicy || {}
  const perks = { silver: { ...DEFAULT_PERKS.silver }, gold: { ...DEFAULT_PERKS.gold }, platinum: { ...DEFAULT_PERKS.platinum } }
  Object.keys(pol.perks || {}).forEach((tr) => Object.assign(perks[tr] = perks[tr] || {}, pol.perks[tr]))
  const perkTiers = ['silver', 'gold', 'platinum'].filter((tr) => (perks[tr] || {})[kind])

  const custSnap = await db.collection(`tenants/${tid}/customers`).get()
  let targets = custSnap.docs.map((d) => d.data()).filter((c) => c.optOut !== true && digits(c.phone))
  if (scope === 'members') {
    targets = targets.filter((c) => c.membership && c.membership.active)
    if ((pol.mode || 'discounts') === 'perks') targets = targets.filter((c) => perkTiers.includes(c.membership.tier))
  }
  if (!targets.length) return
  const quota = await takeQuota(db, tid, targets.length)
  targets = targets.slice(0, quota)
  const venue = t.name || ''
  // The venue's own template for this promo kind wins over the built-in wording.
  const tpl = String((t.msgTemplates || {})[kind] || '').trim()
  const fillPromo = (c) => tpl
    .replace(/\{name\}|\{الاسم\}/g, c.name || 'عميلنا العزيز')
    .replace(/\{venue\}|\{المنشأة\}/g, venue)
    .replace(/\{item\}|\{الصنف\}/g, (extra && extra.item) || '')
    .replace(/\{code\}|\{الكود\}/g, (extra && extra.code) || '')
  const creds = await waCredsFor(db, tid)
  await fanOut(targets, (c) => (tpl ? fillPromo(c) : buildText({ name: c.name || 'عميلنا العزيز', venue, member: !!(c.membership && c.membership.active) })), creds)
}

// New OFFER published.
const onOfferCreatedNotify = onDocumentCreated('tenants/{tid}/offers/{oid}', async (event) => {
  const offer = event.data && event.data.data()
  if (!offer || offer.active === false) return
  const db = getFirestore()
  const name = offer.nameAr || offer.nameEn || 'عرض جديد'
  await sendPromo(db, event.params.tid, 'offers', null, ({ name: cn, venue, member }) =>
    member
      ? `مرحباً ${cn}،\nبصفتك عضواً مميزاً في ${venue}: عرض جديد قبل الجميع — ${name}${offer.code ? `\nكود الخصم: ${offer.code}` : ''}`
      : `مرحباً ${cn}،\nعرض جديد في ${venue}: ${name}${offer.code ? `\nكود الخصم: ${offer.code}` : ''}`,
    { item: name, code: offer.code || '' })
    .catch(() => {})
})

// Item STARRED (featured flips on) — honors the per-item promoNotify override.
const onItemFeaturedNotify = onDocumentUpdated('tenants/{tid}/items/{iid}', async (event) => {
  const before = event.data && event.data.before.data()
  const after = event.data && event.data.after.data()
  if (!before || !after) return
  if (!(after.featured === true && before.featured !== true)) return
  const db = getFirestore()
  const dish = after.nameAr || after.nameEn || ''
  await sendPromo(db, event.params.tid, 'featured', after.promoNotify || null, ({ name: cn, venue }) =>
    `مرحباً ${cn}،\n${venue} اختارت لك صنفاً مميزاً: ${dish} — جرّبه قبل الجميع.`, { item: dish })
    .catch(() => {})
})

// NEW ITEM added — 6h transactional debounce (bulk imports → one alert).
const onItemCreatedNotify = onDocumentCreated('tenants/{tid}/items/{iid}', async (event) => {
  const item = event.data && event.data.data()
  if (!item || item.available === false) return
  const db = getFirestore()
  const tid = event.params.tid
  const tRef = db.doc(`tenants/${tid}`)
  let proceed = false
  await db.runTransaction(async (tx) => {
    const s = await tx.get(tRef)
    if (!s.exists) return
    const last = Number(s.data().lastNewItemNotifyAt) || 0
    if (Date.now() - last < 6 * 3600 * 1000) return
    tx.update(tRef, { lastNewItemNotifyAt: Date.now() })
    proceed = true
  }).catch(() => {})
  if (!proceed) return
  const dish = item.nameAr || item.nameEn || ''
  await sendPromo(db, tid, 'newItems', item.promoNotify || null, ({ name: cn, venue }) =>
    `مرحباً ${cn}،\nجديدنا في ${venue}: ${dish} وأصناف أخرى أُضيفت للتو — كن أول من يجرّبها.`, { item: dish })
    .catch(() => {})
})

// ---------------------------------------------------------------------------
// LIFECYCLE MESSAGES (tenant.lifecycleMsgs.{welcome,upgrade,birthday,winback})
// ---------------------------------------------------------------------------
const TIER_AR = { silver: 'الفضية', gold: 'الذهبية', platinum: 'البلاتينية' }

// Welcome on membership grant + congrats on tier upgrade. Also stamps
// lastOrderAt for the win-back scan whenever order counters move.
const onCustomerMembershipChange = onDocumentUpdated('tenants/{tid}/customers/{pid}', async (event) => {
  const before = event.data && event.data.before.data()
  const after = event.data && event.data.after.data()
  if (!before || !after) return
  const db = getFirestore()
  const tid = event.params.tid
  const to = digits(after.phone)
  if (!to || after.optOut === true) return
  const tSnap = await db.doc(`tenants/${tid}`).get()
  const t = tSnap.exists ? (tSnap.data() || {}) : {}
  const lc = t.lifecycleMsgs || {}
  const venue = t.name || ''
  const mB = before.membership
  const mA = after.membership

  const tpls = t.msgTemplates || {}
  const fillLc = (s, extraMap) => Object.entries({
    '\\{name\\}|\\{الاسم\\}': after.name || '', '\\{venue\\}|\\{المنشأة\\}': venue, ...(extraMap || {}),
  }).reduce((acc, [re, val]) => acc.replace(new RegExp(re, 'g'), val), String(s))

  // welcome: membership just became active
  if (lc.welcome !== false && mA && mA.active && !(mB && mB.active)) {
    const link = t.slug && mA.token ? `${(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')}/mcard/${t.slug}/${mA.token}` : ''
    const granted = await takeQuota(db, tid, 1)
    const creds = await waCredsFor(db, tid)
    const text = tpls.welcome
      ? fillLc(tpls.welcome, { '\\{link\\}|\\{الرابط\\}': link })
      : `أهلاً ${after.name || ''} — أصبحت عضواً في ${venue}.\nبطاقتك الرقمية جاهزة${link ? `:\n${link}` : '.'}`
    if (granted) await sendWhatsAppText(to, text, creds).catch(() => {})
    return
  }
  // upgrade: tier moved up
  const order = ['silver', 'gold', 'platinum']
  if (lc.upgrade !== false && mA && mA.active && mB && mB.active && order.indexOf(mA.tier) > order.indexOf(mB.tier)) {
    const granted = await takeQuota(db, tid, 1)
    const creds = await waCredsFor(db, tid)
    const tierAr = TIER_AR[mA.tier] || mA.tier
    const text = tpls.upgrade
      ? fillLc(tpls.upgrade, { '\\{tier\\}|\\{العضوية\\}': tierAr })
      : `مبروك ${after.name || ''}!\nترقّيت إلى العضوية ${tierAr} في ${venue} — مزايا أكثر بانتظارك.`
    if (granted) await sendWhatsAppText(to, text, creds).catch(() => {})
  }
})

// Stamp lastOrderAt whenever an order is settled (drives win-back).
const onOrderPaidTouchCustomer = onDocumentUpdated('tenants/{tid}/orders/{oid}', async (event) => {
  const before = event.data && event.data.before.data()
  const after = event.data && event.data.after.data()
  if (!before || !after) return
  const becamePaid = (after.status === 'paid' && before.status !== 'paid')
    || (after.paidOnline === true && before.paidOnline !== true)
  if (!becamePaid) return
  const phone = digits(after.customerPhone)
  if (!phone) return
  const db = getFirestore()
  await db.doc(`tenants/${event.params.tid}/customers/${phone}`)
    .set({ lastOrderAt: Date.now() }, { merge: true }).catch(() => {})
})

// Birthday greetings — daily 10:00 Riyadh.
const birthdayGreetings = onSchedule(
  { schedule: '0 10 * * *', timeZone: 'Asia/Riyadh', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = getFirestore()
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }))
    const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const year = now.getFullYear()
    const tenants = await db.collection('tenants').get()
    for (const t of tenants.docs) {
      const td = t.data() || {}
      if ((td.lifecycleMsgs || {}).birthday === false) continue
      const snap = await db.collection(`tenants/${t.id}/customers`).where('birthday', '==', md).get().catch(() => null)
      if (!snap || snap.empty) continue
      const targets = snap.docs.map((d) => d.data()).filter((c) => c.optOut !== true && digits(c.phone) && c.lastBdayMsgYear !== year)
      if (!targets.length) continue
      const quota = await takeQuota(db, t.id, targets.length)
      const bonus = Number(td.membershipPolicy && td.membershipPolicy.birthdayBonus) || 0
      const bdayTpl = String((td.msgTemplates || {}).birthday || '').trim()
      const creds = await waCredsFor(db, t.id)
      await fanOut(targets.slice(0, quota), (c) => bdayTpl
        ? fill(bdayTpl, { name: c.name, venue: td.name || '' })
        : `كل عام وأنت بخير ${c.name || ''}!\n${td.name || ''} تهنّئك بيوم ميلادك${bonus > 0 ? ` — ولك ${bonus} نقطة هدية على طلبك القادم.` : ' — نسعد بزيارتك اليوم.'}`, creds)
      await Promise.all(snap.docs.map((d) => d.ref.set({ lastBdayMsgYear: year }, { merge: true }).catch(() => {})))
    }
  }
)

// Win-back — daily 11:00 Riyadh: idle customers (no order for N days) get one
// gentle nudge, at most once per 60 days.
const winbackNudge = onSchedule(
  { schedule: '0 11 * * *', timeZone: 'Asia/Riyadh', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = getFirestore()
    const tenants = await db.collection('tenants').get()
    for (const t of tenants.docs) {
      const td = t.data() || {}
      const wb = td.winback || {}
      if (wb.enabled !== true) continue
      const idleDays = Number(wb.days) || 30
      const cutoff = Date.now() - idleDays * 86400000
      const snap = await db.collection(`tenants/${t.id}/customers`).get().catch(() => null)
      if (!snap) continue
      const targets = snap.docs
        .map((d) => ({ ref: d.ref, ...d.data() }))
        .filter((c) => c.optOut !== true && digits(c.phone)
          && (Number(c.lastOrderAt) || 0) > 0 && (Number(c.lastOrderAt) || 0) < cutoff
          && (Number(c.lastWinbackAt) || 0) < Date.now() - 60 * 86400000)
        .slice(0, 100)
      if (!targets.length) continue
      const quota = await takeQuota(db, t.id, targets.length)
      const text = (wb.text || '').trim() || `اشتقنا لك {الاسم}! زُرنا هذا الأسبوع في {المنشأة} — جديدنا بانتظارك.`
      const creds = await waCredsFor(db, t.id)
      await fanOut(targets.slice(0, quota), (c) => fill(text, { name: c.name, venue: td.name || '' }), creds)
      await Promise.all(targets.map((c) => c.ref.set({ lastWinbackAt: Date.now() }, { merge: true }).catch(() => {})))
    }
  }
)

// Post-visit follow-up — every 15 min: orders settled between (delay) and (6h)
// ago get ONE thanks message: gratitude + Google-Maps review link + experience
// ask. Fully venue-configurable: tenant.followup { enabled, delayMins, text,
// includeReview }. Idempotent via order.followupSent.
const followupMessages = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'Asia/Riyadh', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = getFirestore()
    const tenants = await db.collection('tenants').get()
    for (const t of tenants.docs) {
      const td = t.data() || {}
      const fu = td.followup || {}
      if (fu.enabled !== true) continue
      const delayMs = Math.max(10, Number(fu.delayMins) || 60) * 60000
      const now = Date.now()
      // window: old enough to have "finished the visit", young enough to be relevant
      const snap = await db.collection(`tenants/${t.id}/orders`)
        .where('paidAtMs', '>=', now - 6 * 3600 * 1000)
        .limit(300).get().catch(() => null)
      if (!snap || snap.empty) continue
      const due = snap.docs.filter((d) => {
        const o = d.data()
        return !o.followupSent && (Number(o.paidAtMs) || 0) <= now - delayMs && digits(o.customerPhone)
      })
      if (!due.length) continue

      const review = fu.includeReview !== false ? String((td.social || {}).googleMaps || '').trim() : ''
      const base = (fu.text || '').trim()
        || `شكراً لزيارتك {الاسم}! سعدنا بخدمتك في {المنشأة}.\nكيف كانت تجربتك؟ يسعدنا ردّك برسالة.`
      // dedupe: one follow-up per phone per run (a table may have several orders)
      const seen = new Set()
      let want = 0
      const targets = []
      for (const d of due) {
        const o = d.data()
        const ph = digits(o.customerPhone)
        if (seen.has(ph)) { await d.ref.set({ followupSent: true }, { merge: true }).catch(() => {}); continue }
        seen.add(ph)
        const cust = await db.doc(`tenants/${t.id}/customers/${ph}`).get().catch(() => null)
        if (cust && cust.exists && cust.data().optOut === true) { await d.ref.set({ followupSent: true }, { merge: true }).catch(() => {}); continue }
        targets.push({ ref: d.ref, phone: ph, name: o.customerName || (cust && cust.exists ? cust.data().name : '') })
        want += 1
      }
      if (!targets.length) continue
      const quota = await takeQuota(db, t.id, want)
      const creds = await waCredsFor(db, t.id)
      for (const tr of targets.slice(0, quota)) {
        const msg = fill(base, { name: tr.name, venue: td.name || '' }) + (review ? `\n\nقيّمنا على خرائط جوجل — يعني لنا الكثير:\n${review}` : '')
        try { await sendWhatsAppText(tr.phone, msg, creds) } catch (_) { /* per-guest best effort */ }
        await tr.ref.set({ followupSent: true }, { merge: true }).catch(() => {})
      }
      // anything past quota stays unmarked → picked up next run when quota allows
    }
  }
)

// ---------------------------------------------------------------------------
// OWNER DAILY REPORT — daily 07:00 Riyadh: yesterday's numbers over WhatsApp to
// the venue owner (tenant.ownerReport { enabled, phone }). Paid/served count,
// revenue net of refunds, cancellations, top-3 items, payment split. On Sundays
// also flags the 3 slowest sellers of the past week among available items.
// Counts against the monthly WhatsApp cap (1 message per tenant).
// ---------------------------------------------------------------------------
const ownerDailyReport = onSchedule(
  { schedule: '0 7 * * *', timeZone: 'Asia/Riyadh', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = getFirestore()
    // Yesterday 00:00 → 24:00 Riyadh (UTC+3, no DST): today's Riyadh midnight = end.
    const todayRiyadh = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }) // YYYY-MM-DD
    const endMs = Date.parse(`${todayRiyadh}T00:00:00+03:00`)
    const startMs = endMs - 86400000
    const yDate = new Date(startMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
    const isSunday = new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Riyadh' }).startsWith('Sun')

    const tenants = await db.collection('tenants').get()
    for (const t of tenants.docs) {
      try {
        const td = t.data() || {}
        const rep = td.ownerReport || {}
        if (rep.enabled !== true) continue
        const phone = digits(rep.phone)
        if (!phone) continue

        // Single-field range only (no composite index) — upper bound applied in code.
        const snap = await db.collection(`tenants/${t.id}/orders`)
          .where('paidAtMs', '>=', startMs).get().catch(() => null)
        if (!snap) continue
        const dayOrders = snap.docs.map((d) => d.data()).filter((o) => (Number(o.paidAtMs) || 0) < endMs)

        const settled = dayOrders.filter((o) => ['paid', 'served', 'refunded'].includes(o.status))
        const paidCount = dayOrders.filter((o) => o.status === 'paid' || o.status === 'served').length
        const cancelledCount = dayOrders.filter((o) => o.status === 'cancelled').length
        const revenue = Math.round(settled.reduce((s, o) =>
          s + (Number(o.total) || 0) - (o.status === 'refunded' ? (Number(o.refund && o.refund.amount) || 0) : 0), 0))

        // Top 3 items by quantity.
        const qtyByName = {}
        for (const o of dayOrders) {
          if (o.status === 'cancelled') continue
          for (const l of (o.items || [])) {
            const n = l.nameAr || l.nameEn || ''
            if (n) qtyByName[n] = (qtyByName[n] || 0) + (Number(l.qty) || 1)
          }
        }
        const top = Object.entries(qtyByName).sort((a, b) => b[1] - a[1]).slice(0, 3)

        // Payment split over settled orders.
        let cash = 0
        let card = 0
        let online = 0
        for (const o of settled) {
          if (o.paidOnline === true || o.paymentMethod === 'online') online += 1
          else if (o.paymentMethod === 'card_terminal' || o.paymentMethod === 'card') card += 1
          else cash += 1
        }

        // Sunday extra: 3 slowest sellers of the past 7 days among available items.
        let slowLines = []
        if (isSunday) {
          const weekStartMs = endMs - 7 * 86400000
          const wkSnap = await db.collection(`tenants/${t.id}/orders`)
            .where('paidAtMs', '>=', weekStartMs).get().catch(() => null)
          const itSnap = await db.collection(`tenants/${t.id}/items`).get().catch(() => null)
          if (wkSnap && itSnap && !itSnap.empty) {
            const weekQty = {}
            for (const d of wkSnap.docs) {
              const o = d.data()
              if ((Number(o.paidAtMs) || 0) >= endMs || o.status === 'cancelled') continue
              for (const l of (o.items || [])) {
                const q = Number(l.qty) || 1
                if (l.itemId) weekQty[`id:${l.itemId}`] = (weekQty[`id:${l.itemId}`] || 0) + q
                const n = l.nameAr || l.nameEn || ''
                if (n) weekQty[`nm:${n}`] = (weekQty[`nm:${n}`] || 0) + q
              }
            }
            slowLines = itSnap.docs
              .map((d) => {
                const it = d.data() || {}
                const name = it.nameAr || it.nameEn || ''
                return { name, avail: it.available !== false, qty: Math.max(weekQty[`id:${d.id}`] || 0, weekQty[`nm:${name}`] || 0) }
              })
              .filter((x) => x.avail && x.name)
              .sort((a, b) => a.qty - b.qty) // zero-sale items first
              .slice(0, 3)
              .map((x) => (x.qty === 0 ? `${x.name}: بلا مبيعات هذا الأسبوع` : `${x.name}: ${x.qty} فقط هذا الأسبوع`))
          }
        }

        const lines = [
          `${td.name || ''} — تقرير أمس (${yDate})`,
          '',
          `الطلبات المدفوعة: ${paidCount}`,
          `الإيرادات: ${revenue} ريال`,
        ]
        if (cancelledCount) lines.push(`الطلبات الملغاة: ${cancelledCount}`)
        if (top.length) {
          lines.push('', 'الأكثر مبيعاً:')
          top.forEach(([n, q]) => lines.push(`- ${n}: ${q}`))
        }
        lines.push('', `طرق الدفع: نقداً ${cash} | شبكة ${card} | أونلاين ${online}`)
        if (slowLines.length) {
          lines.push('', 'أصناف تحتاج انتباهك:')
          slowLines.forEach((s) => lines.push(`- ${s}`))
        }

        const q = await takeQuota(db, t.id, 1)
        if (!q) continue
        const creds = await waCredsFor(db, t.id)
        await sendWhatsAppText(phone, lines.join('\n'), creds).catch(() => {})
      } catch (_) { /* one tenant's failure never stops the loop */ }
    }
  }
)

module.exports = {
  processCampaigns,
  onOfferCreatedNotify, onItemFeaturedNotify, onItemCreatedNotify,
  onCustomerMembershipChange, onOrderPaidTouchCustomer,
  birthdayGreetings, winbackNudge, followupMessages,
  ownerDailyReport,
}
