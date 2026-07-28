// ==================== SERVER-ENFORCED SPEND METERS ====================
// Every outbound thing that COSTS MONEY passes through takeSpend() before it is
// sent. Until this file existed the platform had exactly one meter — takeQuota()
// in campaigns.js — and it covered marketing sends ONLY: order-status WhatsApp,
// receipt WhatsApp and every Resend email were completely uncapped, on the
// PLATFORM's Meta credentials. A single trigger loop could have spent an
// unbounded amount of the platform's money with nothing to stop it.
//
// The design, in one paragraph: one Firestore document per venue per month
// (tenants/{tid}/counters/spend-YYYY-MM) holds the month, day and minute
// counters for every metered channel. takeSpend() opens ONE transaction on that
// doc, checks all three walls at once and returns how many units it granted —
// the caller sends exactly that many and no more. The document is written by
// the Admin SDK only; managers may READ it (that is their usage meter) but the
// rules deny every client write, so a venue cannot raise its own ceiling.
//
// THREE WALLS, not one. A monthly cap alone does not stop a runaway loop: a bug
// that re-fires a trigger can burn a 40,000-message month in an hour. So every
// channel also carries a DAILY cap (a burst-day ceiling) and a per-MINUTE wall
// (the loop-breaker). The minute wall is what actually saves the bill; the
// month cap is what makes the plan's price cover its own cost.
//
// FAIL-OPEN ON INFRASTRUCTURE, FAIL-CLOSED ON POLICY. If Firestore is
// unreachable the meter GRANTS the send: a transient database blip must not
// silence a guest's order-ready notification. If a real limit is reached the
// meter refuses. The two cases are distinguishable in the return value
// (reason: 'error-open' vs 'cap'|'daily'|'burst'|'killed'), and every refusal
// is counted so the owner and the console can see the pressure.
const { FieldValue } = require('firebase-admin/firestore')

// ---------------------------------------------------------------- channels
// Metered channels. Anything not listed here is UNMETERED and takeSpend() lets
// it through untouched — adding a channel is opt-in, never accidental.
//   waUtility   — transactional WhatsApp (order status, receipt link)
//   waMarketing — campaigns, promos, lifecycle, win-back, owner report
//   email       — every Resend send
//   aiText      — geminiProxy text generations
//   aiImage     — geminiProxy image generations (an order of magnitude dearer)
const CHANNELS = ['waUtility', 'waMarketing', 'email', 'aiText', 'aiImage']
const CHANNEL_AR = {
  waUtility: 'واتساب المعاملات',
  waMarketing: 'واتساب التسويق',
  email: 'البريد',
  aiText: 'الذكاء — نصوص',
  aiImage: 'الذكاء — صور',
}

// Per-plan MONTHLY ceilings.
//
// These are SAFETY RAILS first and commercial tiers second, and the difference
// matters: the failure this file exists to prevent is a runaway loop, not a
// busy restaurant. A rail set at the average venue's real volume cuts off half
// the venues on that plan, which is a worse product than no rail at all.
//
// Sized against verified Saudi rates (see UNIT_COST_USD) and the reference
// profile of a mid-sized venue: ~50 orders/day x 2 status updates = ~3,000
// transactional messages a month, 2 campaigns x 500 recipients, 300 emails,
// 800 assistant turns, 25 generated images. Every rail sits comfortably above
// its plan's realistic profile, and the plan's price covers the realistic bill
// because only the messages that fall OUTSIDE WhatsApp's 24-hour service
// window are billed at all.
//
// Worst case (every message billed, ceiling fully consumed) the top plans
// exceed their own price — that is deliberate headroom, not an oversight. The
// backstops for it are the daily and per-minute walls below, and the platform
// budget breaker. Tightening these into strict commercial tiers is a PRICING
// decision for the owner, not something to impose silently on live venues.
const PLAN_QUOTAS = {
  menu: { waUtility: 1000, waMarketing: 150, email: 1500, aiText: 300, aiImage: 10 },
  ops: { waUtility: 3000, waMarketing: 400, email: 4000, aiText: 800, aiImage: 25 },
  pro: { waUtility: 6000, waMarketing: 900, email: 10000, aiText: 2000, aiImage: 60 },
  enterprise: { waUtility: 12000, waMarketing: 1300, email: 25000, aiText: 5000, aiImage: 150 },
}

// The loop-breaker. Fixed per channel, NOT per plan — no plan has a legitimate
// reason to emit more than this in sixty seconds, and a bug always will.
// waUtility sits at 20: even the busiest venue's real peak is a few orders a
// minute, so anything above this is a trigger firing on itself.
const BURST_PER_MINUTE = { waUtility: 20, waMarketing: 0, email: 80, aiText: 30, aiImage: 4 }

// A day may carry this fraction of the month. 1/6 lets a genuine peak day (Eid,
// a launch) run at six times the average without tripping, while still capping
// a runaway at a sixth of the monthly damage.
const DAY_FRACTION = 6
// …but the daily wall must never bite below this. Derived from a fraction, a
// small monthly cap produces an absurd daily one — a console-set marketing cap
// of 10 became "2 per day", and a 300-message cap became 50, which would refuse
// an ordinary blast. Below this floor the monthly cap is already the binding
// constraint and a second wall only breaks the venue.
//
// Per channel, because one floor cannot serve both. Image generation is
// counted in DOZENS a month, so a floor of 50 let a whole month's images burn
// in one afternoon — the exact runaway the daily wall exists to stop, on the
// single most expensive unit the platform buys.
const DAY_FLOOR = { waUtility: 50, waMarketing: 50, email: 50, aiText: 50, aiImage: 4 }

// Channels whose budget is claimed in BULK, up front: a campaign asks for its
// entire audience in ONE takeSpend() call before it fans out. A daily or
// per-minute wall applied to that single grant would clip a legitimate 2,000
// person blast to 400 and silently drop the rest — so for these channels the
// monthly cap IS the wall. (The atomic claim is also what stops a campaign
// double-sending, so the loop risk the burst wall exists for does not apply.)
const BULK_CHANNELS = new Set(['waMarketing'])

// Fallback unit costs in USD, used ONLY to price the console's spend view and
// the budget breaker. The live numbers live in
// platformConfig/spendControls.unitCostUsd so a Meta or Google price change is
// a console edit, not a redeploy — and Meta reprices QUARTERLY (Jan/Apr/Jul/Oct)
// on one month's notice, so these constants WILL go stale. They are the
// fallback, not the source of truth.
//
// Verified 2026-07-28 against Meta's live Saudi pricing and ai.google.dev.
// The first two were wrong on the way in — utility was over-stated and
// marketing UNDER-stated by 30%, which would have let the budget breaker fire
// late on the single largest line of the bill.
const UNIT_COST_USD = {
  waUtility: 0.0107, // Meta utility template, Saudi Arabia (free inside the 24h window)
  waMarketing: 0.0501, // Meta marketing template, Saudi Arabia
  email: 0.0004, // Resend Pro: 20 USD / 50,000 emails
  aiText: 0.0018, // gemini-2.5-flash at ~2.5k in / 400 out per turn
  aiImage: 0.039, // gemini-2.5-flash-image, per generated 1024px image
}
const USD_TO_SAR = 3.75

// ------------------------------------------------------------------ periods
// Riyadh, not UTC. The venue's month is the month it bills and reports in, and
// the pre-existing msgsSent counter already used Riyadh — a second convention
// would make the two disagree for three hours every night.
const RIYADH = { timeZone: 'Asia/Riyadh' }
function dayKey() { return new Date().toLocaleDateString('en-CA', RIYADH) } // YYYY-MM-DD
function periodKey() { return dayKey().slice(0, 7) } // YYYY-MM
function minuteKey() {
  // en-CA + 24h gives 'YYYY-MM-DD, HH:MM' → a stable, collation-safe minute id.
  return new Date().toLocaleString('en-CA', { ...RIYADH, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// -------------------------------------------------------------- plan lookup
// Hand-synced mirror of planExpired()/planOrder() in src/lib/plans.js. That
// module is ESM and this package is CommonJS, so the logic is duplicated
// rather than imported — change BOTH sides together.
const EXPIRED_GRACE_DAYS = 7
function planIdOf(tenant) {
  const t = tenant || {}
  if (t.planStatus === 'expired') {
    const raw = t.planExpiresAt
    const exp = raw && raw.toDate ? raw.toDate() : (raw ? new Date(raw) : null)
    if (!exp || isNaN(exp) || Date.now() > exp.getTime() + EXPIRED_GRACE_DAYS * 86400000) return 'menu'
  }
  const id = t.plan || 'enterprise' // unset = top tier, same default the app gates on
  return PLAN_QUOTAS[id] ? id : 'enterprise'
}

// A number the console may have typed, or nothing. Written out rather than
// `Number(x) || d` because 0 is a MEANINGFUL value here — it disables the
// channel — and the `||` idiom would silently re-enable it.
function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Resolve the three walls for one channel. Precedence, most specific first:
//   tenant.spendCaps[channel]  — the console's per-venue override
//   tenant.msgCapMonthly       — the LEGACY marketing cap; still authoritative
//                                for waMarketing so every venue the console has
//                                already configured keeps exactly its old limit
//   tenant.aiLimits.monthly    — the assistant's existing per-venue AI limit
//   PLAN_QUOTAS[plan][channel] — the plan rail
// A negative month cap means UNLIMITED (counted, never refused).
function limitsFor(tenant, channel) {
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
    // Purchased credit packs (createPayIntent kind='aiCredits' → tenant.aiExtra)
    // are real money the venue already paid; they add to the ceiling.
    month += Math.max(0, num(t.aiExtra) || 0)
  }
  const ov = num(t.spendCaps && t.spendCaps[channel])
  if (ov !== null) month = ov

  if (BULK_CHANNELS.has(channel)) return { month, day: -1, minute: 0 }

  const dayOv = num(t.spendCapsDaily && t.spendCapsDaily[channel])
  const aiDay = channel === 'aiText' ? num(t.aiLimits && t.aiLimits.daily) : null
  const floor = DAY_FLOOR[channel] || 50
  const derived = Math.max(Math.ceil(month / DAY_FRACTION), Math.min(month, floor))
  const day = month < 0
    ? -1
    : (dayOv !== null ? dayOv : (aiDay !== null ? aiDay : Math.max(1, derived)))

  return { month, day, minute: BURST_PER_MINUTE[channel] || 0 }
}

// ------------------------------------------------------- platform kill switch
// platformConfig/spendControls — the one document that can stop the platform
// spending money, globally or per channel, without a deploy. Cached in module
// memory for a minute: a warm instance sending a campaign must not read it once
// per message, and a minute is a tolerable delay on an emergency stop (the
// instances that matter are the hot ones, and they turn over constantly).
// How many units one instance may grant BLIND while the meter itself is
// failing, before it gives up and refuses instead. See the catch block in
// takeSpend for why this number has to exist.
const ERROR_OPEN_BUDGET = 200
let _errorOpen = 0
let _errorClosedLogged = false

const CONTROLS_TTL_MS = 60000
let _controls = null
let _controlsAt = 0
const DEFAULT_CONTROLS = { killAll: false, channels: {}, unitCostUsd: UNIT_COST_USD, monthlyBudgetUsd: 0, budgetAction: 'warn' }

async function getControls(db) {
  if (_controls && Date.now() - _controlsAt < CONTROLS_TTL_MS) return _controls
  const snap = await db.doc('platformConfig/spendControls').get().catch(() => null)
  // No doc, or an unreadable one, means NOTHING is killed. A read failure must
  // never masquerade as "the owner pressed stop".
  const d = snap && snap.exists ? (snap.data() || {}) : {}
  _controls = {
    killAll: d.killAll === true,
    channels: d.channels && typeof d.channels === 'object' ? d.channels : {},
    unitCostUsd: { ...UNIT_COST_USD, ...(d.unitCostUsd || {}) },
    monthlyBudgetUsd: Math.max(0, num(d.monthlyBudgetUsd) || 0),
    budgetAction: d.budgetAction || 'warn',
  }
  _controlsAt = Date.now()
  return _controls
}
// Exposed for tests / immediate effect after a console write in the same instance.
// Also clears the blind-grant tally: a test that exercised the outage path must
// not leave the next test failing closed.
function invalidateControls() { _controlsAt = 0; _errorOpen = 0; _errorClosedLogged = false }

// ------------------------------------------------------------------ the meter
// Ask for `want` units of `channel` for venue `tid`. Returns how many were
// GRANTED — the caller must send exactly that many.
//
//   { granted, reason, limits, used }
//   reason: 'ok' | 'unmetered' | 'killed' | 'suspended' | 'disabled'
//         | 'cap' | 'daily' | 'burst' | 'error-open'
//
// opts.tenant — pass the tenant doc data when the caller already has it (every
// trigger does) to save a read per send.
async function takeSpend(db, tid, channel, want = 1, opts = {}) {
  const n = Math.max(0, Math.floor(Number(want) || 0))
  if (!db || !tid || !CHANNELS.includes(channel)) return { granted: n, reason: 'unmetered' }
  if (!n) return { granted: 0, reason: 'ok' }

  const controls = await getControls(db).catch(() => DEFAULT_CONTROLS)
  if (controls.killAll || controls.channels[channel] === true) {
    await noteRefusal(db, tid, channel, n, 'killed').catch(() => {})
    return { granted: 0, reason: 'killed' }
  }

  let tenant = opts.tenant
  if (!tenant) {
    const s = await db.doc(`tenants/${tid}`).get().catch(() => null)
    tenant = s && s.exists ? (s.data() || {}) : null
    // An unreadable tenant is an infrastructure problem, not a policy one —
    // and it draws on the same blind-grant budget as a failed transaction.
    if (!tenant) {
      _errorOpen += n
      if (_errorOpen > ERROR_OPEN_BUDGET) return { granted: 0, reason: 'error-closed' }
      return { granted: n, reason: 'error-open' }
    }
  }
  // A suspended venue is switched off, including its wallet.
  if (tenant.active === false) return { granted: 0, reason: 'suspended' }

  const lim = limitsFor(tenant, channel)
  if (lim.month === 0) return { granted: 0, reason: 'disabled', limits: lim }

  const ref = db.doc(`tenants/${tid}/counters/spend-${periodKey()}`)
  const day = dayKey()
  const minute = minuteKey()
  let granted = 0
  let reason = 'ok'
  let used = null
  let firstRefusal = false

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const d = snap.exists ? (snap.data() || {}) : {}
      const m = Math.max(0, Number(d.m && d.m[channel]) || 0)
      const sameDay = d.d && d.d.day === day
      const dCur = sameDay ? Math.max(0, Number(d.d[channel]) || 0) : 0
      const sameMinute = d.b && d.b.minute === minute
      const bCur = sameMinute ? Math.max(0, Number(d.b[channel]) || 0) : 0

      // The tightest wall wins, and its name becomes the reason — the console
      // needs to know WHICH ceiling a venue is pressing against, because the
      // remedy differs (raise the plan vs find the loop).
      let allow = n
      let hit = 'ok'
      if (lim.month >= 0 && lim.month - m < allow) { allow = lim.month - m; hit = 'cap' }
      if (lim.day >= 0 && lim.day - dCur < allow) { allow = lim.day - dCur; hit = 'daily' }
      if (lim.minute > 0 && lim.minute - bCur < allow) { allow = lim.minute - bCur; hit = 'burst' }
      allow = Math.max(0, allow)
      granted = allow
      reason = allow >= n ? 'ok' : hit
      used = { month: m, day: dCur, minute: bCur }

      const refused = n - allow
      // Only the first refusal of the month per channel raises a flag, so a
      // venue that keeps hitting its ceiling produces one console event, not
      // one per message.
      const flagged = !!(d.flagged && d.flagged[channel])
      firstRefusal = refused > 0 && !flagged

      const patch = { period: periodKey(), updatedAt: FieldValue.serverTimestamp() }
      if (allow > 0) patch[`m.${channel}`] = m + allow
      if (refused > 0) {
        patch[`blocked.${channel}`] = Math.max(0, Number(d.blocked && d.blocked[channel]) || 0) + refused
        patch[`blockedReason.${channel}`] = hit
        patch.lastBlockedAt = FieldValue.serverTimestamp()
        if (firstRefusal) patch[`flagged.${channel}`] = true
      }

      if (!snap.exists) {
        // Create: dotted paths are not valid in a create, so the first write
        // materialises the maps whole.
        tx.set(ref, {
          period: periodKey(),
          m: { [channel]: allow },
          d: { day, [channel]: allow },
          b: { minute, [channel]: allow },
          ...(refused > 0 ? { blocked: { [channel]: refused }, blockedReason: { [channel]: hit }, flagged: { [channel]: true } } : {}),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        return
      }
      // A rolled-over day or minute REPLACES its whole map — writing only this
      // channel's key with a merge would leave yesterday's other channels
      // counting against today. update() replaces a whole map value; a dotted
      // path merges into it. Both are used here, deliberately.
      if (sameDay) patch[`d.${channel}`] = dCur + allow
      else patch.d = { day, [channel]: allow }
      if (sameMinute) patch[`b.${channel}`] = bCur + allow
      else patch.b = { minute, [channel]: allow }
      tx.update(ref, patch)
    })
  } catch (e) {
    // Contention or an outage — grant it. See the fail-open note at the top.
    // BUT NOT FOREVER. Fail-open is the right call for a blip and the wrong
    // call for an outage: if Firestore is down, the meter is down, and
    // "grant everything" is unbounded spending with the brakes removed. Each
    // instance therefore has a budget of blind grants; past it the same
    // failure flips to fail-CLOSED, because at that point the outage is the
    // story and a missed notification is cheaper than an unmetered bill.
    const wasOpen = _errorOpen
    _errorOpen += n
    if (_errorOpen > ERROR_OPEN_BUDGET) {
      // Once, on the way over. An outage produces thousands of these and a log
      // line per refusal buries the one line that matters.
      if (!_errorClosedLogged) {
        _errorClosedLogged = true
        console.error(`[spend] meter unavailable after ${wasOpen} blind grants — failing CLOSED until this instance recycles`)
      }
      return { granted: 0, reason: 'error-closed', limits: lim }
    }
    // Log the FIRST blind grant and then every 50th. An outage is a burst, and
    // a line per grant is 200 lines that say the same thing — which is how a
    // log stops being read at exactly the moment it matters.
    if (!wasOpen || Math.floor(wasOpen / 50) !== Math.floor(_errorOpen / 50)) {
      console.warn(`[spend] meter unavailable (${tid}/${channel}) — granting blind, ${_errorOpen}/${ERROR_OPEN_BUDGET} of this instance's budget used`)
    }
    return { granted: n, reason: 'error-open', limits: lim }
  }

  // Marketing keeps its legacy mirror on the tenant doc: /admin/campaigns,
  // /admin/messages and the console's venue detail all read msgsSent, and this
  // change must not blank their meters. Best-effort and outside the
  // transaction — it is a display value, and the counter doc is the truth.
  if (channel === 'waMarketing' && granted > 0) {
    db.doc(`tenants/${tid}`).set({
      msgsSent: { period: periodKey(), count: (used ? used.month : 0) + granted },
    }, { merge: true }).catch(() => {})
  }

  if (firstRefusal) {
    await noteRefusal(db, tid, channel, n - granted, reason, tenant).catch(() => {})
  }
  return { granted, reason, limits: lim, used }
}

// Tell the console a venue just hit a ceiling. Written straight into the
// existing cross-venue activity feed so it shows up where an operator already
// looks, instead of in a screen nobody opens.
async function noteRefusal(db, tid, channel, count, reason, tenant) {
  const reasonAr = {
    cap: 'تجاوز السقف الشهري', daily: 'تجاوز السقف اليومي',
    burst: 'تجاوز الحد اللحظي (قد يكون خللاً متكرراً)', killed: 'أوقفته المنصة',
  }[reason] || reason
  let name = tenant && tenant.name ? tenant.name : ''
  if (!name) {
    const t = await db.doc(`tenants/${tid}`).get().catch(() => null)
    name = t && t.exists ? (t.data().name || '') : ''
  }
  await db.collection('platformActivity').add({
    tenantId: tid,
    tenantName: name,
    type: 'spendLimit',
    severity: reason === 'burst' ? 'high' : 'warn',
    title: `حد الإنفاق — ${CHANNEL_AR[channel] || channel}`,
    body: `${name || tid}: ${reasonAr}. رُفضت ${count} رسالة/طلب.`,
    channel,
    reason,
    at: FieldValue.serverTimestamp(),
  })
}

// Read one venue's current-month usage (console + venue meter).
async function readSpend(db, tid, period) {
  const p = period || periodKey()
  const s = await db.doc(`tenants/${tid}/counters/spend-${p}`).get().catch(() => null)
  const d = s && s.exists ? (s.data() || {}) : {}
  const m = d.m || {}
  const out = { period: p, blocked: d.blocked || {} }
  CHANNELS.forEach((c) => { out[c] = Math.max(0, Number(m[c]) || 0) })
  return out
}

// Price a usage row. Kept here so the console, the rollup and any report all
// agree on one arithmetic.
function costOf(usage, rates) {
  const r = { ...UNIT_COST_USD, ...(rates || {}) }
  let usd = 0
  CHANNELS.forEach((c) => { usd += (Number(usage[c]) || 0) * (Number(r[c]) || 0) })
  return { usd: Math.round(usd * 10000) / 10000, sar: Math.round(usd * USD_TO_SAR * 100) / 100 }
}

// ------------------------------------------------- cross-venue rollup + budget
// The meter deliberately writes NOTHING platform-wide: a single global counter
// receiving every venue's increments is one document taking every write on the
// platform, and Firestore gives a document about one write per second. So the
// aggregate is REBUILT on a schedule instead — N cheap reads every two hours,
// no contention, and a console view that costs one document read.
//
// The same pass is the budget circuit breaker. A monthly ceiling in USD that,
// when crossed, can flip the kill switches by itself: a runaway that starts on
// a Friday night stops within two hours instead of on Monday morning.
const ROLLUP_EVERY = 'every 2 hours'

function makeRollup(onSchedule, getFirestore) {
  return onSchedule({ schedule: ROLLUP_EVERY, timeZone: 'Asia/Riyadh', timeoutSeconds: 540, memory: '512MiB' }, async () => {
    const db = getFirestore()
    const period = periodKey()
    const controls = await getControls(db).catch(() => DEFAULT_CONTROLS)
    const rates = controls.unitCostUsd

    const tenants = await db.collection('tenants').get()
    const byTenant = {}
    const totals = {}
    const blockedTotals = {}
    CHANNELS.forEach((c) => { totals[c] = 0; blockedTotals[c] = 0 })
    let totalUsd = 0

    // Bounded concurrency — 500 venues must not open 500 sockets at once.
    const docs = tenants.docs
    for (let i = 0; i < docs.length; i += 25) {
      await Promise.all(docs.slice(i, i + 25).map(async (t) => {
        const usage = await readSpend(db, t.id, period)
        const cost = costOf(usage, rates)
        const anything = CHANNELS.some((c) => usage[c] > 0) || Object.keys(usage.blocked || {}).length > 0
        if (!anything) return // silent venues stay out of the map: it is a spend view
        const row = { name: t.data().name || '', plan: planIdOf(t.data()), usd: cost.usd, sar: cost.sar }
        CHANNELS.forEach((c) => {
          row[c] = usage[c]
          totals[c] += usage[c]
          const b = Math.max(0, Number(usage.blocked && usage.blocked[c]) || 0)
          if (b) { row[`blocked_${c}`] = b; blockedTotals[c] += b }
        })
        byTenant[t.id] = row
        totalUsd += cost.usd
      }))
    }

    totalUsd = Math.round(totalUsd * 10000) / 10000
    const budget = controls.monthlyBudgetUsd
    const pct = budget > 0 ? totalUsd / budget : 0

    await db.doc(`platformStats/spend-${period}`).set({
      period,
      tenants: tenants.size,
      spendingTenants: Object.keys(byTenant).length,
      totals,
      blockedTotals,
      totalUsd,
      totalSar: Math.round(totalUsd * USD_TO_SAR * 100) / 100,
      budgetUsd: budget,
      budgetPct: Math.round(pct * 1000) / 10,
      rates,
      byTenant,
      at: FieldValue.serverTimestamp(),
    }, { merge: true })

    if (!budget) return

    // Trip once per month per threshold — the doc remembers, so a breaker that
    // already fired does not re-fire (and re-notify) every two hours.
    const stateRef = db.doc('platformConfig/spendControls')
    const st = await stateRef.get().catch(() => null)
    const s = st && st.exists ? (st.data() || {}) : {}
    const firedFor = s.budgetFired && s.budgetFired.period === period ? s.budgetFired : { period, warn: false, trip: false }

    const patch = {}
    let alert = null
    if (pct >= 1 && !firedFor.trip) {
      const action = controls.budgetAction
      if (action === 'stopAll') patch.killAll = true
      else if (action === 'stopMarketing') patch['channels.waMarketing'] = true
      patch['budgetFired.period'] = period
      patch['budgetFired.trip'] = true
      patch['budgetFired.at'] = FieldValue.serverTimestamp()
      alert = {
        title: 'تجاوز ميزانية المنصة',
        body: `الإنفاق ${totalUsd.toFixed(2)} دولار من ميزانية ${budget} — ${action === 'stopAll' ? 'أُوقف الإرسال بالكامل' : action === 'stopMarketing' ? 'أُوقف الإرسال التسويقي' : 'تنبيه فقط، لم يُوقَف شيء'}.`,
        severity: 'high',
      }
    } else if (pct >= 0.8 && !firedFor.warn && !firedFor.trip) {
      patch['budgetFired.period'] = period
      patch['budgetFired.warn'] = true
      alert = {
        title: 'الميزانية على وشك النفاد',
        body: `بلغ إنفاق المنصة ${Math.round(pct * 100)}% من ميزانية الشهر (${totalUsd.toFixed(2)} من ${budget} دولار).`,
        severity: 'warn',
      }
    }
    if (!alert) return
    await stateRef.set(patch, { merge: true }).catch(() => {})
    invalidateControls()
    await db.collection('platformActivity').add({
      tenantId: null, tenantName: '', type: 'spendBudget',
      ...alert, at: FieldValue.serverTimestamp(),
    }).catch(() => {})
  })
}

module.exports = {
  CHANNELS, CHANNEL_AR, PLAN_QUOTAS, BURST_PER_MINUTE, UNIT_COST_USD, USD_TO_SAR,
  takeSpend, readSpend, costOf, limitsFor, planIdOf,
  getControls, invalidateControls, periodKey, dayKey,
  makeRollup,
}
