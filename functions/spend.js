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
//   ar3d        — realistic image-to-3D conversions (platform Meshy credits)
//   tableImage  — generated table/wall images
//   dinerAi     — the guest-facing photo/voice ordering assistant
const CHANNELS = ['waUtility', 'waMarketing', 'email', 'aiText', 'aiImage', 'ar3d', 'tableImage', 'dinerAi']
const CHANNEL_AR = {
  waUtility: 'واتساب المعاملات',
  waMarketing: 'واتساب التسويق',
  email: 'البريد',
  aiText: 'الذكاء — نصوص',
  aiImage: 'الذكاء — صور',
  ar3d: 'المجسمات الواقعية',
  tableImage: 'صور الطاولات',
  dinerAi: 'مساعد الطلب للضيف',
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
// ar3d stays an enterprise-tier perk (it burns real Meshy credits and the app
// already gates the feature at that tier), so the lower plans carry 0 — which
// the meter reads as "disabled", matching the existing feature gate rather
// than contradicting it.
const PLAN_QUOTAS = {
  menu: { waUtility: 1000, waMarketing: 150, email: 1500, aiText: 300, aiImage: 10, ar3d: 0, tableImage: 10, dinerAi: 500 },
  ops: { waUtility: 3000, waMarketing: 400, email: 4000, aiText: 800, aiImage: 25, ar3d: 0, tableImage: 20, dinerAi: 1500 },
  pro: { waUtility: 6000, waMarketing: 900, email: 10000, aiText: 2000, aiImage: 60, ar3d: 0, tableImage: 40, dinerAi: 4000 },
  enterprise: { waUtility: 12000, waMarketing: 1300, email: 25000, aiText: 5000, aiImage: 150, ar3d: 20, tableImage: 80, dinerAi: 10000 },
}

// The loop-breaker. Fixed per channel, NOT per plan — no plan has a legitimate
// reason to emit more than this in sixty seconds, and a bug always will.
// waUtility sits at 20: even the busiest venue's real peak is a few orders a
// minute, so anything above this is a trigger firing on itself.
// dinerAi keeps its historic 20/min burst: it is GUEST-facing, so a busy
// dinner rush is many different people, not one loop.
const BURST_PER_MINUTE = { waUtility: 20, waMarketing: 0, email: 80, aiText: 30, aiImage: 4, ar3d: 3, tableImage: 4, dinerAi: 20 }

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
const DAY_FLOOR = { waUtility: 50, waMarketing: 50, email: 50, aiText: 50, aiImage: 4, ar3d: 3, tableImage: 5, dinerAi: 50 }

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
  ar3d: 1.2, // Meshy image-to-3D task — the dearest unit on the platform
  tableImage: 0.039, // same gemini-2.5-flash-image call as aiImage
  dinerAi: 0.0025, // gemini-2.5-flash with an image or audio part attached
}
const USD_TO_SAR = 3.75

// ------------------------------------------------------- purchasable top-ups
// A venue that outgrows its plan should be able to BUY headroom instead of
// waiting for the platform to raise a number by hand.
//
// The price is server-side and only server-side: `createPayIntent` derives the
// amount from this table (or its console override at
// platformConfig/spendPacks), never from anything the client sends.
//
// Quantities and SAR prices. Margins are set against UNIT_COST_USD above, most
// generous on the cheap channels and thinnest on ar3d, where a single unit is
// a real 1.20 USD out of the platform's Meshy wallet.
const SPEND_PACKS = {
  waUtility: [{ qty: 1000, sar: 79 }, { qty: 3000, sar: 199 }, { qty: 10000, sar: 599 }],
  waMarketing: [{ qty: 500, sar: 149 }, { qty: 2000, sar: 499 }, { qty: 5000, sar: 1099 }],
  email: [{ qty: 5000, sar: 39 }, { qty: 20000, sar: 119 }, { qty: 50000, sar: 249 }],
  // aiText MUST keep the historic /admin/assistant pack prices — the same
  // product is already sold at {100:49, 300:129, 1000:349} and two different
  // prices for one thing is the kind of detail a customer notices.
  aiText: [{ qty: 100, sar: 49 }, { qty: 300, sar: 129 }, { qty: 1000, sar: 349 }],
  aiImage: [{ qty: 25, sar: 39 }, { qty: 100, sar: 129 }, { qty: 300, sar: 329 }],
  ar3d: [{ qty: 5, sar: 149 }, { qty: 20, sar: 499 }],
  tableImage: [{ qty: 30, sar: 49 }, { qty: 100, sar: 139 }],
  dinerAi: [{ qty: 1000, sar: 49 }, { qty: 5000, sar: 199 }],
}

// The tenant field holding a channel's remaining purchased balance.
// aiText keeps the LEGACY `aiExtra` number so /admin/assistant and
// /admin/billing keep reading the field they already read; everything else
// lives under `spendExtra.<channel>`.
function extraOf(tenant, channel) {
  const t = tenant || {}
  if (channel === 'aiText') return Math.max(0, Number(t.aiExtra) || 0)
  return Math.max(0, Number(t.spendExtra && t.spendExtra[channel]) || 0)
}
function extraField(channel) {
  return channel === 'aiText' ? 'aiExtra' : `spendExtra.${channel}`
}

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

// Resolve the walls for one channel. Precedence for the PLAN cap, most
// specific first:
//   tenant.spendCaps[channel]  — the console's per-venue override
//   tenant.msgCapMonthly       — the LEGACY marketing cap; still authoritative
//                                for waMarketing so every venue the console has
//                                already configured keeps exactly its old limit
//   tenant.aiLimits.monthly    — the assistant's existing per-venue AI limit
//   PLAN_QUOTAS[plan][channel] — the plan rail
// A negative cap means UNLIMITED (counted, never refused).
//
// PURCHASED CREDIT IS HEADROOM ON TOP, AND IT DEPLETES. The old aiExtra
// behaviour added the purchased quantity to the ceiling every single month
// forever — buy 1,000 requests once, receive 1,000 EXTRA every month for the
// life of the account. That is not what a credit pack means, and it was a
// standing revenue leak. Now the balance is drawn down as it is consumed
// (see takeSpend), so 1,000 purchased requests are 1,000 requests.
//
// Returns { plan, extra, month, day, minute } where `month` is the effective
// ceiling (plan + remaining balance).
function limitsFor(tenant, channel) {
  const t = tenant || {}
  const rail = PLAN_QUOTAS[planIdOf(t)] || PLAN_QUOTAS.enterprise
  let plan = rail[channel]

  // LEGACY per-venue caps the console has been writing for months, and which
  // other screens still display. They keep winning over the plan rail so no
  // venue's configured limit silently changes underneath it.
  const legacy = channel === 'waMarketing' ? num(t.msgCapMonthly)
    : channel === 'aiText' ? num(t.aiLimits && t.aiLimits.monthly)
      : channel === 'ar3d' ? num(t.ar3dMonthly)
        : channel === 'dinerAi' ? num(t.dinerAiMonthly)
          : null
  if (legacy !== null) plan = legacy
  const ov = num(t.spendCaps && t.spendCaps[channel])
  if (ov !== null) plan = ov
  if (plan == null) plan = 0

  const extra = extraOf(t, channel)
  // Unlimited stays unlimited; there is nothing for a top-up to add to it.
  const month = plan < 0 ? -1 : plan + extra

  if (BULK_CHANNELS.has(channel)) return { plan, extra, month, day: -1, minute: 0 }

  const dayOv = num(t.spendCapsDaily && t.spendCapsDaily[channel])
  const aiDay = channel === 'aiText' ? num(t.aiLimits && t.aiLimits.daily) : null
  const floor = DAY_FLOOR[channel] || 50
  // Derived from the EFFECTIVE ceiling, not the plan cap: a venue that paid for
  // headroom before a busy week should be able to use it that week. The
  // per-minute wall still bounds a runaway either way.
  const derived = Math.max(Math.ceil(month / DAY_FRACTION), Math.min(month, floor))
  const day = month < 0
    ? -1
    : (dayOv !== null ? dayOv : (aiDay !== null ? aiDay : Math.max(1, derived)))

  return { plan, extra, month, day, minute: BURST_PER_MINUTE[channel] || 0 }
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

// ------------------------------------------- the PLATFORM-wide Gemini wall
// Every other wall in this file is per venue. That is exactly wrong for the
// one resource all venues share: a single Gemini API key on a single Google
// billing account, which Google rate-limits by SPEND — Tier 1 allows
// 10 USD per rolling 10 minutes.
//
// The arithmetic that makes this urgent, from this file's own constants:
// aiImage and tableImage are the same model at 0.039 USD, and each carries its
// OWN 4-per-minute venue wall. So one venue may legitimately burn 8 images a
// minute = 3.12 USD per 10 minutes. FOUR venues generating at once exceed
// Google's limit — whereupon Google pauses EVERY Gemini request on the billing
// account and the manager assistant, the guest ordering assistant, item image
// generation and table images all die simultaneously, on a busy evening, while
// every per-venue meter still reads green.
//
// A platform average of 1 USD/minute would sit exactly on Google's line, so
// the wall is set well under it. The venue walls stay as they are; this one
// exists solely to stop the SUM.
const GEMINI_CHANNELS = new Set(['aiText', 'aiImage', 'tableImage', 'dinerAi'])
const PLATFORM_GEMINI_USD_PER_MIN = 0.6

// One document per minute, so contention is naturally bounded by time rather
// than by sharding — and an old minute's document is never touched again.
// Transactional, because an approximate wall in front of a hard vendor limit
// is not a wall. If the transaction fails, takeSpend's existing fail-open path
// (with its bounded blind-grant budget) takes over.
async function takePlatformGemini(db, channel, rates) {
  const usd = Number((rates && rates[channel]) || UNIT_COST_USD[channel]) || 0
  if (!usd) return true
  const ref = db.doc(`platformCounters/geminiMin-${minuteKey().replace(/[^0-9]/g, '')}`)
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref)
    const cur = s.exists ? (Number(s.data().usd) || 0) : 0
    if (cur + usd > PLATFORM_GEMINI_USD_PER_MIN) return false
    tx.set(ref, {
      usd: cur + usd,
      n: (s.exists ? (Number(s.data().n) || 0) : 0) + 1,
      minute: minuteKey(),
      at: FieldValue.serverTimestamp(),
    }, { merge: true })
    return true
  })
}

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

  // The shared-key wall, BEFORE the per-venue ones: a venue can be well within
  // its own quota while the platform as a whole is about to be cut off by
  // Google. Only the caller's first unit is checked — these channels are
  // called one at a time, and metering a bulk grant against a per-minute
  // platform wall would refuse work that is not actually concurrent.
  if (GEMINI_CHANNELS.has(channel)) {
    const ok = await takePlatformGemini(db, channel, controls.unitCostUsd).catch(() => true)
    if (!ok) {
      await noteRefusal(db, tid, channel, n, 'platformBurst', tenant).catch(() => {})
      return { granted: 0, reason: 'platformBurst' }
    }
  }

  const lim = limitsFor(tenant, channel)
  if (lim.month === 0) return { granted: 0, reason: 'disabled', limits: lim }

  const ref = db.doc(`tenants/${tid}/counters/spend-${periodKey()}`)
  const day = dayKey()
  const minute = minuteKey()
  let granted = 0
  let reason = 'ok'
  let used = null
  let firstRefusal = false
  let fromExtra = 0

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

      // How much of THIS grant reaches past the plan cap and into paid credit.
      // Measured as the difference between the two month totals so a grant that
      // straddles the boundary is split correctly and one that is entirely
      // inside the plan draws nothing.
      if (lim.plan >= 0 && lim.extra > 0 && allow > 0) {
        fromExtra = Math.max(0, (m + allow) - lim.plan) - Math.max(0, m - lim.plan)
      }

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

  // Draw the paid balance down by exactly what was consumed beyond the plan.
  // Deliberately OUTSIDE the transaction and via an atomic increment: pulling
  // the tenant doc into every metered send would put the platform's busiest
  // document under write contention for the sake of a field that is only
  // touched once a venue is past its plan. Two concurrent sends can each see
  // the same balance and both draw, so the balance can dip a few units below
  // zero under heavy concurrency — it reads back clamped at 0, and erring
  // toward a few free units is the right side to be wrong on for something the
  // venue already paid for.
  if (fromExtra > 0) {
    db.doc(`tenants/${tid}`).update({
      [extraField(channel)]: FieldValue.increment(-fromExtra),
    }).catch(() => {})
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
    platformBurst: 'بلغت المنصة كلها حدّ الذكاء الاصطناعي في هذه الدقيقة — حماية من إيقاف Google للمفتاح',
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
    // platformBurst means the SHARED key is at its ceiling — that is a
    // platform incident, not one venue's usage story.
    severity: (reason === 'burst' || reason === 'platformBurst') ? 'high' : 'warn',
    title: `حد الإنفاق — ${CHANNEL_AR[channel] || channel}`,
    body: `${name || tid}: ${reasonAr}. رُفضت ${count} رسالة/طلب.`,
    channel,
    reason,
    at: FieldValue.serverTimestamp(),
  })
}

// The live pack catalogue: the code table above, overridden per channel by
// platformConfig/spendPacks so a price change is a console edit rather than a
// deploy. An override must be a non-empty array of {qty, sar} with positive
// numbers — anything else is ignored rather than trusted, because this value
// decides what a customer is charged.
let _packs = null
let _packsAt = 0
async function resolvePacks(db) {
  if (_packs && Date.now() - _packsAt < CONTROLS_TTL_MS) return _packs
  const snap = await db.doc('platformConfig/spendPacks').get().catch(() => null)
  const ov = snap && snap.exists ? (snap.data() || {}) : {}
  const out = {}
  CHANNELS.forEach((c) => {
    const raw = ov[c]
    const clean = Array.isArray(raw)
      ? raw.filter((p) => p && Number(p.qty) > 0 && Number(p.sar) > 0)
        .map((p) => ({ qty: Math.floor(Number(p.qty)), sar: Math.round(Number(p.sar) * 100) / 100 }))
      : []
    out[c] = clean.length ? clean : (SPEND_PACKS[c] || [])
  })
  _packs = out
  _packsAt = Date.now()
  return out
}

// The price of one pack, or null when the channel/quantity is not on sale.
// createPayIntent calls THIS and nothing else — a client-supplied amount never
// reaches the payment provider.
async function packPrice(db, channel, qty) {
  if (!CHANNELS.includes(channel)) return null
  const packs = await resolvePacks(db).catch(() => SPEND_PACKS)
  const found = (packs[channel] || []).find((p) => Number(p.qty) === Number(qty))
  return found ? Number(found.sar) : null
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

    // A DAILY series, for the cost of one map field on a document that is
    // already being written. Without it there is no burn-down curve and no
    // projection — and a projection is what turns «you are at 40%» into «you
    // cross the budget on the 22nd», which is the difference between a warning
    // and a post-mortem. ~30 keys a month.
    const today = dayKey()
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
      daily: { [today]: { usd: totalUsd, at: Date.now() } },
      at: FieldValue.serverTimestamp(),
    }, { merge: true })

    if (!budget) return

    // Trip once per month per threshold — the doc remembers, so a breaker that
    // already fired does not re-fire (and re-notify) every two hours.
    const stateRef = db.doc('platformConfig/spendControls')
    const st = await stateRef.get().catch(() => null)
    const s = st && st.exists ? (st.data() || {}) : {}
    const firedFor = s.budgetFired && s.budgetFired.period === period ? s.budgetFired : { period, warn: false, trip: false }

    // PROJECTION, not just level. A level threshold at 80% stays silent while
    // the month is young and only speaks once it is nearly too late; the run
    // rate says «you cross the budget on the 22nd» while there is still time.
    // The projection is a WARNING only — it never trips the breaker, because
    // acting on a forecast would stop real messages over an arithmetic guess.
    const dayNum = Number(dayKey().slice(8, 10)) || 1
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
    const projected = (totalUsd / dayNum) * daysInMonth
    const crossesOnDay = projected > budget && totalUsd > 0
      ? Math.max(1, Math.ceil(budget / (totalUsd / dayNum)))
      : null

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
    } else if (crossesOnDay && !firedFor.projected && !firedFor.warn && !firedFor.trip) {
      // Fires while still comfortably under the level thresholds — that is the
      // whole point of it.
      patch['budgetFired.period'] = period
      patch['budgetFired.projected'] = true
      alert = {
        title: 'الاتجاه الحالي يتجاوز الميزانية',
        body: `المصروف ${totalUsd.toFixed(2)} من ${budget} دولار (${Math.round(pct * 100)}%)، لكن معدّل الإنفاق يصل ${projected.toFixed(2)} نهاية الشهر — أي التجاوز يوم ${crossesOnDay}.`,
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
  SPEND_PACKS, resolvePacks, packPrice, extraOf, extraField,
  takeSpend, readSpend, costOf, limitsFor, planIdOf,
  getControls, invalidateControls, periodKey, dayKey,
  makeRollup,
}
