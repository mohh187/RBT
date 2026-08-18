// ==================== WHAT THE METER CANNOT SEE ====================
// functions/spend.js counts what WE send. It cannot see three things, and each
// of them can stop a feature dead with the meter still reading green:
//
//   1. What the vendor is about to REFUSE — a WhatsApp number whose quality
//      dropped, a template Meta rejected or silently recategorised from
//      utility to marketing (a 4.7x price rise on our second-largest channel),
//      a messaging tier we are pressing against, an empty Meshy wallet, an
//      expired access token.
//   2. What the vendor actually CHARGED, as opposed to our estimate.
//   3. Whether our own scheduled jobs are still finishing.
//
// This file probes for (1) and (3). Reconciling (2) needs the vendor accounts
// separated first — see PROFITABILITY.md; today the API keys are shared across
// several of the owner's systems, so a vendor invoice cannot be attributed.
//
// EVERY probe runs under Promise.allSettled: one vendor being down must never
// hide another vendor's alarm.
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { raise, resolveNamespace, stampProbe } = require('./alerts')

const CONSOLE_URL = '/platform/health'

// Manual limits the vendors do not expose. Editable at platformConfig/vendorLimits.
const DEFAULT_LIMITS = {
  gemini: { tier: 1, monthlyCapUsd: 250, tenMinCapUsd: 10, warnPct: 0.6 },
  resend: { plan: 'free', monthlyEmails: 3000 },
  meshy: { minCredits: 20 },
  meta: { wabaId: '' },
}

async function vendorLimits(db) {
  const s = await db.doc('platformConfig/vendorLimits').get().catch(() => null)
  const d = s && s.exists ? (s.data() || {}) : {}
  return {
    gemini: { ...DEFAULT_LIMITS.gemini, ...(d.gemini || {}) },
    resend: { ...DEFAULT_LIMITS.resend, ...(d.resend || {}) },
    meshy: { ...DEFAULT_LIMITS.meshy, ...(d.meshy || {}) },
    meta: { ...DEFAULT_LIMITS.meta, ...(d.meta || {}) },
    apiKeyExpiry: Array.isArray(d.apiKeyExpiry) ? d.apiKeyExpiry : [],
  }
}

const jsonFetch = async (url, opts) => {
  const r = await fetch(url, opts)
  const body = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(body || {}).slice(0, 200)}`)
  return body
}

// ------------------------------------------------------------------- Meta
// Quality, throughput and template state. The template check is the one that
// pays for this whole file: Meta can move a template from UTILITY to MARKETING
// on a day's notice, which multiplies its price by roughly 4.7 and loses it the
// free 24-hour service window — and NOTHING in our meter can detect that,
// because the meter prices by channel, not by what Meta decided to charge.
async function probeMeta(db, limits, live) {
  const token = process.env.WA_ACCESS_TOKEN
  const waba = limits.meta.wabaId
  const out = { status: 'skipped', checkedAt: Date.now() }
  if (!token || !waba) {
    out.status = 'unconfigured'
    out.note = 'ربط واتساب مع Meta غير مكتمل، فلا يمكن مراقبة جودة الأرقام.'
    return out
  }
  const auth = { headers: { Authorization: `Bearer ${token}` } }
  const base = `https://graph.facebook.com/v21.0/${waba}`

  const nums = await jsonFetch(`${base}/phone_numbers?fields=display_phone_number,quality_rating,throughput,name_status,code_verification_status&limit=25`, auth)
  out.numbers = (nums.data || []).map((n) => ({
    phone: n.display_phone_number, quality: n.quality_rating || 'UNKNOWN',
    throughput: (n.throughput && n.throughput.level) || '', nameStatus: n.name_status || '',
  }))
  for (const n of out.numbers) {
    if (['RED', 'LOW'].includes(String(n.quality).toUpperCase())) {
      const key = `vendor.meta.quality.${n.phone}`
      live.push(key)
      await raise(db, {
        key, ns: 'vendor.meta', source: 'vendor', vendor: 'meta', severity: 'high',
        title: `جودة رقم واتساب ${n.phone} منخفضة`,
        body: `تقييم Meta الحالي: ${n.quality}. الجودة المنخفضة تخفض حدّ الإرسال ثم توقف الرقم.`,
        action: 'راجع محتوى القوالب ومعدل الحظر من المستلمين، وأوقف الحملات على هذا الرقم مؤقتاً.',
        url: CONSOLE_URL, detail: n,
      })
    }
  }

  const tpl = await jsonFetch(`${base}/message_templates?fields=name,status,category,language&limit=200`, auth)
  const templates = tpl.data || []
  out.templates = {
    approved: templates.filter((t) => t.status === 'APPROVED').length,
    rejected: templates.filter((t) => t.status === 'REJECTED').length,
    pending: templates.filter((t) => t.status === 'PENDING').length,
  }
  for (const t of templates) {
    if (t.status === 'REJECTED' || t.status === 'DISABLED' || t.status === 'PAUSED') {
      const key = `vendor.meta.template.${t.name}`
      live.push(key)
      await raise(db, {
        key, ns: 'vendor.meta', source: 'vendor', vendor: 'meta',
        severity: t.status === 'REJECTED' ? 'high' : 'warn',
        title: `قالب واتساب «${t.name}» ${t.status === 'REJECTED' ? 'مرفوض' : 'موقوف'}`,
        body: `الحالة لدى Meta: ${t.status}. الرسائل التي تستخدمه لن تصل.`,
        action: 'عدّل نص القالب وأعد تقديمه من WhatsApp Manager، أو بدّل الرسائل إلى قالب معتمد.',
        url: CONSOLE_URL, detail: { name: t.name, status: t.status, category: t.category },
      })
    }
    // The silent one. An order-status template that becomes MARKETING costs
    // 4.7x more and loses the free service window.
    if (/order|status|receipt|رسال|طلب/i.test(t.name) && t.category === 'MARKETING') {
      const key = `vendor.meta.category.${t.name}`
      live.push(key)
      await raise(db, {
        key, ns: 'vendor.meta', source: 'vendor', vendor: 'meta', severity: 'high',
        title: `قالب معاملات «${t.name}» صُنّف تسويقياً`,
        body: 'Meta تصنّفه MARKETING الآن، أي نحو 4.7 أضعاف السعر، مع فقدان مجانية نافذة الـ 24 ساعة.',
        action: 'اطلب إعادة التصنيف إلى UTILITY من WhatsApp Manager، وأزل أي عبارة ترويجية من نص القالب.',
        url: CONSOLE_URL, detail: { name: t.name, category: t.category },
      })
    }
  }
  out.status = 'ok'
  return out
}

// ------------------------------------------------------------------ Meshy
// The dearest unit on the platform. An empty wallet stops 3D conversion with
// an error the venue reads as «the feature is broken».
async function probeMeshy(db, limits, live) {
  const key = process.env.MESHY_API_KEY
  if (!key) return { status: 'unconfigured' }
  const bal = await jsonFetch('https://api.meshy.ai/openapi/v1/balance', { headers: { Authorization: `Bearer ${key}` } })
  const credits = Number(bal && (bal.balance != null ? bal.balance : bal.credits)) || 0
  const min = Number(limits.meshy.minCredits) || 20
  if (credits <= 0 || credits < min) {
    const k = 'vendor.meshy.balance'
    live.push(k)
    await raise(db, {
      key: k, ns: 'vendor.meshy', source: 'vendor', vendor: 'meshy',
      severity: credits <= 0 ? 'critical' : 'high',
      title: credits <= 0 ? 'رصيد Meshy نفد' : 'رصيد Meshy منخفض',
      body: `المتبقي ${credits} وحدة (الحد الأدنى المضبوط ${min}). تحويل المجسمات الواقعية يتوقف عند النفاد.`,
      action: 'اشحن رصيد Meshy من لوحتهم، أو أوقف المجسمات الواقعية مؤقتاً من /platform/spend حتى الشحن.',
      url: CONSOLE_URL, detail: { credits, min },
    })
  }
  return { status: 'ok', credits }
}

// ----------------------------------------------------------------- Resend
// There is no usage endpoint. `GET /domains` is a cheap liveness check that
// also catches a lapsed DKIM/SPF verification — which makes every email bounce
// while the send call still returns success.
async function probeResend(db, live) {
  const key = process.env.RESEND_API_KEY
  if (!key) return { status: 'unconfigured' }
  const body = await jsonFetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } })
  const domains = (body && body.data) || []
  const bad = domains.filter((d) => d.status && d.status !== 'verified')
  if (bad.length) {
    const k = 'vendor.resend.domain'
    live.push(k)
    await raise(db, {
      key: k, ns: 'vendor.resend', source: 'vendor', vendor: 'resend', severity: 'critical',
      title: 'نطاق البريد غير موثّق لدى Resend',
      body: `النطاقات: ${bad.map((d) => `${d.name} (${d.status})`).join('، ')}. البريد سيُرفض أو يذهب للمهملات.`,
      action: 'أعد التحقق من سجلات DKIM/SPF في DNS من لوحة Resend.',
      url: CONSOLE_URL, detail: { domains: bad },
    })
  }
  return { status: 'ok', domains: domains.map((d) => ({ name: d.name, status: d.status })) }
}

// ----------------------------------------------------------------- Gemini
// Liveness only. The SPEND is computed from our own meter — we count the same
// events with known unit prices, which is both cheaper and more precise than
// anything Google exposes.
async function probeGemini(db, live) {
  const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY
  if (!key) return { status: 'unconfigured' }
  await jsonFetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`)
  return { status: 'ok' }
}

// ------------------------------------------------------- key/cert expiry
// A dated list checked daily beats a clever probe. A 60-day WhatsApp token
// dying at 3am on a Friday is exactly the «feature stopped for an unknown
// reason» this system exists to prevent.
async function probeKeyExpiry(db, limits, live) {
  const out = []
  for (const k of limits.apiKeyExpiry) {
    const at = Date.parse(k.expiresAt)
    if (!Number.isFinite(at)) continue
    const days = Math.floor((at - Date.now()) / 86400000)
    out.push({ label: k.label, vendor: k.vendor || '', days })
    if (days > 30) continue
    const key = `vendor.key.${String(k.label).replace(/\W+/g, '_')}`
    live.push(key)
    await raise(db, {
      key, ns: 'vendor.key', source: 'vendor', vendor: k.vendor || null,
      severity: days <= 0 ? 'critical' : days <= 7 ? 'high' : 'warn',
      title: days <= 0 ? `انتهت صلاحية ${k.label}` : `${k.label} تنتهي خلال ${days} يوماً`,
      body: `تاريخ الانتهاء: ${k.expiresAt}.`,
      action: 'جدّد المفتاح لدى المزوّد وحدّثه في functions/.env ثم أعد نشر الدوال.',
      url: CONSOLE_URL, detail: { label: k.label, expiresAt: k.expiresAt, days },
    })
  }
  return out
}

// ------------------------------------------------------------- the probe
const vendorProbe = onSchedule(
  { schedule: 'every 30 minutes', timeZone: 'Asia/Riyadh', timeoutSeconds: 300, memory: '256MiB' },
  async () => {
    const db = getFirestore()
    const limits = await vendorLimits(db)
    // Keys still failing THIS run. Anything absent gets auto-resolved, which is
    // what lets a fixed problem clear itself off the board.
    const live = []

    const results = await Promise.allSettled([
      probeMeta(db, limits, live),
      probeMeshy(db, limits, live),
      probeResend(db, live),
      probeGemini(db, live),
      probeKeyExpiry(db, limits, live),
    ])
    const [meta, meshy, resend, gemini, keys] = results
    const val = (r) => (r.status === 'fulfilled' ? r.value : { status: 'error', error: String(r.reason && r.reason.message || r.reason).slice(0, 200) })

    await stampProbe(db, 'meta', meta.status === 'fulfilled', meta.reason)
    await stampProbe(db, 'meshy', meshy.status === 'fulfilled', meshy.reason)
    await stampProbe(db, 'resend', resend.status === 'fulfilled', resend.reason)
    await stampProbe(db, 'gemini', gemini.status === 'fulfilled', gemini.reason)

    // A probe that THREW is its own alarm — see the note in alerts.js. Without
    // this, a dead Meta token and a perfectly healthy account look identical.
    for (const [name, r] of [['meta', meta], ['meshy', meshy], ['resend', resend], ['gemini', gemini]]) {
      const k = `probe.${name}`
      if (r.status === 'rejected') {
        live.push(k)
        await raise(db, {
          key: k, ns: 'probe', source: 'probe', vendor: name, severity: 'high',
          title: `تعذّر فحص ${name}`,
          body: `الفحص نفسه فشل: ${String(r.reason && r.reason.message || r.reason).slice(0, 200)}. غياب التنبيهات عن ${name} الآن لا يعني أنه سليم.`,
          action: 'تحقق من صلاحية المفتاح ومن اتصال الخدمة. الصمت هنا ليس دليل سلامة.',
          url: CONSOLE_URL,
        })
      }
    }

    await resolveNamespace(db, 'vendor.meta', live)
    await resolveNamespace(db, 'vendor.meshy', live)
    await resolveNamespace(db, 'vendor.resend', live)
    await resolveNamespace(db, 'vendor.key', live)
    await resolveNamespace(db, 'probe', live)

    await db.doc('platformHealth/current').set({
      vendors: { meta: val(meta), meshy: val(meshy), resend: val(resend), gemini: val(gemini) },
      keys: val(keys),
      at: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {})
  },
)

// ---------------------------------------------------- the Gemini cap guard
// Google's Tier 1 allows 10 USD per rolling 10 minutes and 250 USD a month,
// and enforces both by PAUSING the billing account — which kills the manager
// assistant, the guest ordering assistant, item images and table images at the
// same instant. functions/spend.js now has a per-minute platform wall that
// prevents the 10-minute breach structurally; this watches the slower fuse and
// warns long before either is reached.
//
// Runs from OUR meter, not from Google: we count the same events with known
// unit prices, which is cheaper and more precise than any metric Google
// samples.
const GEMINI_CHANNELS = ['aiText', 'aiImage', 'tableImage', 'dinerAi']

const geminiCapGuard = onSchedule(
  { schedule: 'every 30 minutes', timeZone: 'Asia/Riyadh', timeoutSeconds: 300, memory: '256MiB' },
  async () => {
    const db = getFirestore()
    const spend = require('./spend')
    const limits = await vendorLimits(db)
    const cap = Number(limits.gemini.monthlyCapUsd) || 250
    const warnPct = Number(limits.gemini.warnPct) || 0.6
    const period = spend.periodKey()
    const live = []

    // Month-to-date Gemini cost, from the rollup the meter already produces.
    const rollSnap = await db.doc(`platformStats/spend-${period}`).get().catch(() => null)
    const roll = rollSnap && rollSnap.exists ? (rollSnap.data() || {}) : {}
    const rates = { ...spend.UNIT_COST_USD, ...((roll.rates) || {}) }
    const totals = roll.totals || {}
    const mtdUsd = GEMINI_CHANNELS.reduce((s, ch) => s + (Number(totals[ch]) || 0) * (Number(rates[ch]) || 0), 0)

    // PROJECTION, not level. A level alert at 60% stays silent until the month
    // is nearly gone; a projection says «you cross the cap on the 22nd» while
    // there is still time to act. This is the difference between a warning and
    // a post-mortem.
    const now = new Date()
    const dayOfMonth = Number(now.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).slice(8, 10))
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const projected = dayOfMonth > 0 ? (mtdUsd / dayOfMonth) * daysInMonth : mtdUsd
    const crossesOn = projected > cap && mtdUsd > 0
      ? Math.max(1, Math.ceil(cap / (mtdUsd / dayOfMonth)))
      : null

    if (projected >= cap || mtdUsd >= cap * warnPct) {
      const overNow = mtdUsd >= cap
      const key = 'gemini.month'
      live.push(key)
      await raise(db, {
        key, ns: 'gemini', source: 'budget', vendor: 'google',
        severity: overNow ? 'critical' : projected >= cap ? 'high' : 'warn',
        title: overNow ? 'تجاوز سقف Gemini الشهري' : projected >= cap ? 'الاتجاه يتجاوز سقف Gemini' : 'اقتراب من سقف Gemini',
        body: overNow
          ? `المستهلك ${mtdUsd.toFixed(2)} من ${cap} دولار. Google توقف كل طلبات Gemini على الحساب عند التجاوز.`
          : `المستهلك ${mtdUsd.toFixed(2)} دولار، والاتجاه الحالي يصل ${projected.toFixed(2)} نهاية الشهر${crossesOn ? `، ويتجاوز السقف يوم ${crossesOn}` : ''}.`,
        action: overNow
          ? 'ارفع شريحة Gemini في Google AI Studio فوراً، أو أوقف قنوات الذكاء من /platform/spend حتى تُرفع.'
          : 'ارفع الشريحة قبل الموعد، أو اخفض سقوف صور الذكاء وصور الطاولات في الباقات الأعلى.',
        url: CONSOLE_URL,
        detail: { mtdUsd: Math.round(mtdUsd * 100) / 100, cap, projected: Math.round(projected * 100) / 100, crossesOn },
      })
    }
    await resolveNamespace(db, 'gemini', live)
    await stampProbe(db, 'geminiCap', true)

    await db.doc('platformHealth/current').set({
      gemini: {
        mtdUsd: Math.round(mtdUsd * 100) / 100,
        capUsd: cap,
        pct: cap ? Math.round((mtdUsd / cap) * 1000) / 10 : 0,
        projectedUsd: Math.round(projected * 100) / 100,
        crossesOnDay: crossesOn,
        tier: limits.gemini.tier,
      },
      at: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {})
  },
)

// ------------------------------------------------------------- job health
// A scheduled job that silently stops finishing is the hardest failure to
// diagnose, because nothing errors. followupMessages reads every tenant then
// 300 orders per enabled tenant — 36% of all Firestore reads, growing linearly
// with a 300x multiplier. When it eventually exceeds its timeout it stops
// MID-ITERATION, so venues later in document order simply stop receiving
// follow-ups, forever, with no error anywhere.
//
// Each scheduler calls this at its end. Cheap, and it makes that failure loud.
async function noteJobRun(db, name, { ms, docsRead, timeoutSeconds, ok = true, error }) {
  const pct = timeoutSeconds ? Math.round((ms / (timeoutSeconds * 1000)) * 100) : 0
  await db.doc('platformHealth/jobs').set({
    [name]: {
      lastRunAt: FieldValue.serverTimestamp(),
      ...(ok ? { lastOkAt: FieldValue.serverTimestamp() } : { lastError: String(error || '').slice(0, 300) }),
      ms, docsRead: docsRead || 0, timeoutPct: pct,
    },
  }, { merge: true }).catch(() => {})

  if (ok && pct >= 80) {
    await raise(db, {
      key: `job.${name}.timeout`, ns: 'job', source: 'job', severity: 'high',
      title: `الوظيفة ${name} تقترب من مهلتها`,
      body: `استغرقت ${Math.round(ms / 1000)} ثانية أي ${pct}% من المهلة، وعدد المستندات المقروءة ${docsRead || 0}. عند تجاوز المهلة تتوقف في منتصف الدوران، فتُحرم المنشآت المتأخرة في الترتيب من الخدمة بلا أي خطأ ظاهر.`,
      action: 'قسّم الوظيفة على دفعات أو ارفع timeoutSeconds، وراجع عدد المستندات المقروءة.',
      url: CONSOLE_URL, detail: { name, ms, pct, docsRead },
    })
  }
}

// ------------------------------------------------- venue low-balance nudge
// Today a venue only learns it has run out when a send is REFUSED. This tells
// them before that, and it is the only item in the observability work that
// makes money rather than saving it: aiText packs run 52-73x margin and are
// the least sold thing on the platform.
//
// THREE TRIGGERS, AND THE SECOND IS THE ONE THAT MATTERS:
//   level     — used >= 80% of the ceiling.
//   pace      — the venue's own 7-day rate projects past the ceiling with 5+
//               days still to go. A venue at 45% on day 8 is tracking to 170%,
//               and a level-only rule stays silent until day 20 — by which
//               point the warning is a post-mortem.
//   depletion — under 15% of a PURCHASED pack remains. Highest conversion of
//               the three, because they have already shown they will pay.
//
// NEVER OVER WHATSAPP. It would burn the most expensive unit on the platform
// to warn about spending, and on waMarketing it would consume the very budget
// being warned about. In-app announcement (zero marginal cost, and where
// managers already look) then a push; email only at the very top.
const NUDGE_COOLDOWN_DAYS = 14

const venueBalanceNudge = onSchedule(
  { schedule: '0 11 * * *', timeZone: 'Asia/Riyadh', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = getFirestore()
    const spend = require('./spend')
    const period = spend.periodKey()
    const now = Date.now()
    const dayOfMonth = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).slice(8, 10)) || 1
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
    const daysLeft = daysInMonth - dayOfMonth

    const tenants = await db.collection('tenants').get()
    for (const t of tenants.docs) {
      const td = t.data() || {}
      // A suspended or expired venue needs a renewal conversation, not a
      // top-up pitch.
      if (td.active === false || td.planStatus === 'expired') continue

      const usage = await spend.readSpend(db, t.id, period).catch(() => null)
      if (!usage) continue
      const nudgeSnap = await db.doc(`tenants/${t.id}/counters/nudges`).get().catch(() => null)
      const nudges = nudgeSnap && nudgeSnap.exists ? (nudgeSnap.data() || {}) : {}

      const hits = []
      for (const ch of spend.CHANNELS) {
        const lim = spend.limitsFor(td, ch)
        if (lim.month <= 0) continue // unlimited or plan-locked: nothing to top up
        const used = Number(usage[ch]) || 0
        if (used <= 0) continue
        const pct = used / lim.month
        const projected = (used / dayOfMonth) * daysInMonth

        const last = nudges[ch] || {}
        const cooled = !last.at || (now - Number(last.at)) > NUDGE_COOLDOWN_DAYS * 86400000
        // A fresh month is genuinely new information, so the window resets.
        const newPeriod = last.period !== period
        if (!cooled && !newPeriod) continue

        const level = pct >= 0.8
        const pace = projected >= lim.month && daysLeft >= 5 && pct < 0.8
        const depleted = lim.extra > 0 && lim.extra <= Math.max(1, Math.round((lim.extra + used) * 0.15))
        if (!level && !pace && !depleted) continue

        hits.push({
          ch, label: spend.CHANNEL_AR[ch] || ch, used, cap: lim.month,
          pct: Math.round(pct * 100),
          reason: level ? 'level' : pace ? 'pace' : 'depleted',
          crossesOn: pace ? Math.max(1, Math.ceil(lim.month / (used / dayOfMonth))) : null,
        })
      }
      if (!hits.length) continue

      // COMBINE, DO NOT MULTIPLY. A venue pressing four ceilings has one
      // problem — «my plan is too small» — not four. One announcement naming
      // all of them beats four notifications that each look like spam.
      const lines = hits.map((h) => (
        h.reason === 'pace'
          ? `${h.label}: استهلكت ${h.used} من ${h.cap}، وبهذا المعدّل ينفد رصيدك يوم ${h.crossesOn} من الشهر.`
          : h.reason === 'depleted'
            ? `${h.label}: رصيدك المشترى أوشك على النفاد.`
            : `${h.label}: استهلكت ${h.pct}% من ${h.cap}.`
      ))
      const primary = hits[0].ch

      await db.collection(`tenants/${t.id}/announcements`).add({
        fromPlatform: true,
        title: hits.length > 1 ? 'رصيدك في عدة خدمات أوشك على النفاد' : `رصيد «${hits[0].label}» أوشك على النفاد`,
        body: `${lines.join('\n')}\n\nيمكنك شحن رصيد إضافي من صفحة الفوترة، أو ترقية باقتك.`,
        // ONE TAP from the notice to checkout: the billing screen opens with
        // this channel's packs already expanded. Removing that tap is worth
        // more than any wording change.
        link: `/admin/billing?buy=${primary}`,
        linkLabel: 'شحن رصيد الآن',
        severity: 'warn',
        at: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      }).catch(() => {})

      const patch = {}
      hits.forEach((h) => { patch[h.ch] = { at: now, period, pct: h.pct, reason: h.reason } })
      await db.doc(`tenants/${t.id}/counters/nudges`).set(patch, { merge: true }).catch(() => {})
    }
  },
)

module.exports = { vendorProbe, geminiCapGuard, noteJobRun, venueBalanceNudge }
