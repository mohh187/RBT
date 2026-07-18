// Executive AI tool registry for the PLATFORM owner's assistant (/platform/assistant).
// Same tool shape as src/lib/actions.js ({ name, risk, description, parameters, run })
// but cross-venue: every run() reuses the existing platform data layer
// (platform.js / platformConfig.js / platformBilling.js / platformDomains.js /
// platformInsights.js / platformAudit.js) or one-shot reads of the SAME Firestore
// collections those files already use — no invented paths.
// Firestore rules (platformAdmins gate) remain the real security backstop.
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore'
import { db } from './firebase.js'
import { setTenantPlan, setTenantActive, createBroadcast, sendChatMessage, updateIssue } from './platform.js'
import { setDomainStatus } from './platformDomains.js'
import { saveCoupon, markInvoicePaid } from './platformBilling.js'
import { getPlansConfig } from './platformConfig.js'
import { mrrFromTenants } from './platformInsights.js'
import { logPlatformAction } from './platformAudit.js'
import { groupErrors } from './platformAI.js'
import { PLANS } from './plans.js'

// ---- small helpers ----------------------------------------------------------
const rows = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))
const num = (d) => ({ type: 'number', description: d })
const str = (d) => ({ type: 'string', description: d })
const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) })

// Firestore Timestamp | Date | string -> 'YYYY-MM-DD' (or null).
const iso = (ts) => {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  return d && !isNaN(d) ? d.toISOString().slice(0, 10) : null
}

const statusOf = (t) =>
  t.active === false ? 'suspended'
    : t.planStatus === 'expired' ? 'expired'
      : t.planStatus === 'trial' ? 'trial'
        : 'active'

const planAr = (id) => (PLANS.find((p) => p.id === id) || PLANS[PLANS.length - 1]).ar

const brief = (t) => ({
  id: t.id,
  name: t.name || t.id,
  slug: t.slug || '',
  plan: t.plan || 'enterprise',
  status: statusOf(t),
  planExpiresAt: iso(t.planExpiresAt),
  createdAt: iso(t.createdAt),
})

// ---- per-run caches (ctx.cache is created fresh by each askExecutive run) ----
async function loadTenants(ctx) {
  if (ctx?.cache?.tenants) return ctx.cache.tenants
  const all = rows(await getDocs(collection(db, 'tenants')))
  if (ctx) { ctx.cache = ctx.cache || {}; ctx.cache.tenants = all }
  return all
}

async function loadStats(ctx, days = 30) {
  const key = 'stats' + days
  if (ctx?.cache?.[key]) return ctx.cache[key]
  const s = rows(await getDocs(query(collection(db, 'platformStats'), orderBy('date', 'desc'), limit(Math.max(1, Math.min(90, Number(days) || 30))))))
  if (ctx) { ctx.cache = ctx.cache || {}; ctx.cache[key] = s }
  return s
}

// ---- fuzzy venue resolution (never act on a guess) ---------------------------
// Normalize Arabic so «مقهى القهوة» matches «مقهي القهوه»: unify alef forms,
// taa-marbuta, alef-maqsura, drop diacritics + spaces, lowercase Latin.
const normKey = (s) => String(s || '')
  .toLowerCase()
  .replace(/[أإآٱ]/g, 'ا')
  .replace(/ة/g, 'ه')
  .replace(/[ىی]/g, 'ي')
  .replace(/[ً-ْٰ]/g, '') // tashkeel diacritics
  .replace(/\s+/g, '')

// Returns { t } on a unique match, otherwise { out } — a result object the model
// must relay to the owner (candidate list / not found) INSTEAD of acting.
async function resolveVenue(ctx, nameOrSlug) {
  const q = normKey(nameOrSlug)
  if (!q) return { out: { error: 'اذكر اسم المنشأة أو معرّفها (slug).' } }
  const all = await loadTenants(ctx)
  const keysOf = (t) => [t.name, t.nameEn, t.slug, t.id].filter(Boolean).map(normKey).filter(Boolean)
  const exact = all.filter((t) => keysOf(t).includes(q))
  if (exact.length === 1) return { t: exact[0] }
  const pool = exact.length ? exact : all.filter((t) => keysOf(t).some((k) => k.includes(q) || q.includes(k)))
  if (pool.length === 1) return { t: pool[0] }
  if (pool.length > 1) {
    return {
      out: {
        ambiguous: true,
        message: 'الاسم يطابق أكثر من منشأة — اعرض هذه القائمة على المالك واسأله أيّها يقصد، ولا تنفّذ أي إجراء قبل تحديدها.',
        candidates: pool.slice(0, 8).map((t) => ({ name: t.name || t.id, slug: t.slug || '', plan: t.plan || 'enterprise', status: statusOf(t) })),
      },
    }
  }
  return { out: { notFound: true, message: `لا توجد منشأة تطابق «${nameOrSlug}». استخدم list_venues للاطلاع على الأسماء الصحيحة.` } }
}

// Audit stamp for executive writes (never throws — see platformAudit.js).
const audit = (ctx, action, t, detail) =>
  logPlatformAction(ctx?.user || null, { action: `ai_${action}`, targetTid: t?.id || null, targetName: t?.name || null, detail: detail || null })

const CONFIRM_NOTE = 'DANGEROUS: ask the platform owner for a short confirmation in chat BEFORE calling this, unless their latest message explicitly and unambiguously commanded this exact action.'

// ---- the registry -----------------------------------------------------------
export const PLATFORM_TOOLS = [
  // ============ READ / ANALYZE ============
  {
    name: 'list_venues', risk: 'safe',
    description: 'List all venues (tenants) with plan/status. Optional filter: active | suspended | trial | expired, and/or a plan id (menu|ops|pro|enterprise).',
    parameters: obj({ filter: str('active | suspended | trial | expired (omit for all)'), plan: str('plan id to filter by (menu|ops|pro|enterprise)') }),
    run: async (a, ctx) => {
      let all = (await loadTenants(ctx)).map(brief)
      if (a.filter && a.filter !== 'all') all = all.filter((t) => t.status === a.filter)
      if (a.plan) all = all.filter((t) => t.plan === a.plan)
      return { count: all.length, venues: all }
    },
  },
  {
    name: 'venue_details', risk: 'safe',
    description: 'Full details of one venue resolved fuzzily by name or slug. If the name is ambiguous the result is a candidate list — show it to the owner.',
    parameters: obj({ name: str('venue name or slug (Arabic or English, fuzzy)') }, ['name']),
    run: async (a, ctx) => {
      const r = await resolveVenue(ctx, a.name)
      if (!r.t) return r.out
      const t = r.t
      return {
        ...brief(t),
        planStatus: t.planStatus || 'active',
        suspended: t.active === false,
        suspendReason: t.suspendReason || '',
        customPrice: t.customPrice ?? null,
        currency: t.currency || 'SAR',
        phone: t.phone || t.whatsapp || '',
        city: t.city || '',
        featureOverrides: t.features || null,
        lastOrderAt: iso(t.lastOrderAt),
      }
    },
  },
  {
    name: 'platform_stats', risk: 'safe',
    description: 'Cross-venue revenue/orders rollups from the daily platformStats collection: totals over the last N days plus the per-day series.',
    parameters: obj({ days: num('days back (default 7, max 90)') }),
    run: async (a, ctx) => {
      const stats = await loadStats(ctx, Number(a.days) || 7)
      const revenue = Math.round(stats.reduce((s, d) => s + (Number(d.revenue) || 0), 0))
      const orders = stats.reduce((s, d) => s + (Number(d.orders) || 0), 0)
      return {
        days: stats.length,
        totalRevenue: revenue,
        totalOrders: orders,
        avgDailyRevenue: stats.length ? Math.round(revenue / stats.length) : 0,
        byDay: stats.map((d) => ({ date: d.date || d.id, revenue: Math.round(Number(d.revenue) || 0), orders: Number(d.orders) || 0, activeTenants: Number(d.activeTenants) || 0 })),
      }
    },
  },
  {
    name: 'top_venues', risk: 'safe',
    description: 'Best-performing venues by revenue over the last N days (aggregated from platformStats per-venue breakdowns).',
    parameters: obj({ days: num('days back (default 7)'), limit: num('how many (default 10)') }),
    run: async (a, ctx) => {
      const stats = await loadStats(ctx, Number(a.days) || 7)
      const agg = {}
      for (const d of stats) {
        for (const [tid, v] of Object.entries(d.byTenant || {})) {
          const row = agg[tid] || (agg[tid] = { name: v.name || tid, revenue: 0, orders: 0 })
          row.revenue += Number(v.revenue) || 0
          row.orders += Number(v.orders) || 0
          if (v.name) row.name = v.name
        }
      }
      return Object.values(agg)
        .map((r) => ({ ...r, revenue: Math.round(r.revenue), avgTicket: r.orders ? Math.round(r.revenue / r.orders) : 0 }))
        .sort((x, y) => y.revenue - x.revenue)
        .slice(0, Number(a.limit) || 10)
    },
  },
  {
    name: 'venues_at_risk', risk: 'safe',
    description: 'Venues at churn risk: on trial, already expired, or whose subscription expires within N days — with days left so the owner can decide on extensions.',
    parameters: obj({ days: num('expiry window in days (default 14)') }),
    run: async (a, ctx) => {
      const win = Number(a.days) || 14
      const now = Date.now()
      const out = []
      for (const t of await loadTenants(ctx)) {
        if (t.active === false) continue
        const exp = t.planExpiresAt?.toDate ? t.planExpiresAt.toDate() : t.planExpiresAt ? new Date(t.planExpiresAt) : null
        const daysLeft = exp && !isNaN(exp) ? Math.ceil((exp.getTime() - now) / 86400000) : null
        const risky = t.planStatus === 'trial' || t.planStatus === 'expired' || (daysLeft !== null && daysLeft <= win)
        if (risky) out.push({ ...brief(t), daysLeft, risk: t.planStatus === 'expired' || (daysLeft !== null && daysLeft < 0) ? 'expired' : t.planStatus === 'trial' ? 'trial' : 'expiring-soon' })
      }
      out.sort((x, y) => (x.daysLeft ?? 9999) - (y.daysLeft ?? 9999))
      return { count: out.length, venues: out }
    },
  },
  {
    name: 'revenue_by_plan', risk: 'safe',
    description: 'Subscription revenue picture: venue count per plan, real plan prices from the platform pricing config, and the estimated MRR.',
    parameters: obj({}),
    run: async (_a, ctx) => {
      const [tenants, cfg] = await Promise.all([loadTenants(ctx), getPlansConfig()])
      const m = mrrFromTenants(tenants, cfg.prices)
      return {
        mrr: m.mrr,
        payingVenues: m.paying,
        totalVenues: m.total,
        plans: PLANS.map((p) => ({ id: p.id, name: p.ar, venues: m.byPlan[p.id] || 0, monthlyPrice: Number(cfg.prices[p.id]) || 0 })),
      }
    },
  },
  {
    name: 'error_report', risk: 'safe',
    description: 'Recurring client error signatures grouped from platformErrors (count, sample kind/venue, last seen) — the platform code-health picture.',
    parameters: obj({ max: num('how many recent error docs to scan (default 200)') }),
    run: async (a) => {
      const errs = rows(await getDocs(query(collection(db, 'platformErrors'), orderBy('at', 'desc'), limit(Math.max(20, Math.min(500, Number(a.max) || 200))))))
      const open = errs.filter((e) => e.status !== 'resolved')
      return {
        scanned: errs.length,
        open: open.length,
        groups: groupErrors(open).slice(0, 12).map((g) => ({ signature: g.sig, count: g.count, kind: g.sample?.kind || '', venue: g.sample?.tenantName || '', lastAt: iso(g.lastAt) })),
      }
    },
  },
  {
    name: 'list_domains', risk: 'safe',
    description: 'Custom/subdomain mappings (domains collection). status filter: active | pending (pending = awaiting activation).',
    parameters: obj({ status: str('active | pending (omit for all)') }),
    run: async (a) => {
      let ds = rows(await getDocs(collection(db, 'domains')))
      if (a.status) ds = ds.filter((d) => (d.status || 'active') === a.status)
      return { count: ds.length, domains: ds.map((d) => ({ host: d.id, tenantId: d.tenantId || '', slug: d.slug || '', type: d.type || 'custom', status: d.status || 'active', createdAt: iso(d.createdAt) })) }
    },
  },
  {
    name: 'list_support_issues', risk: 'safe',
    description: 'Support tickets from platformIssues. status: open (default, everything not resolved) | all.',
    parameters: obj({ status: str('open (default) | all') }),
    run: async (a) => {
      let issues = rows(await getDocs(query(collection(db, 'platformIssues'), orderBy('createdAt', 'desc'), limit(100))))
      if ((a.status || 'open') === 'open') issues = issues.filter((i) => i.status !== 'resolved')
      return { count: issues.length, issues: issues.map((i) => ({ id: i.id, title: i.title || '', venue: i.tenantName || '', priority: i.priority || 'normal', status: i.status || 'open', createdAt: iso(i.createdAt) })) }
    },
  },
  {
    name: 'list_invoices', risk: 'safe',
    description: 'Subscription invoices from platformInvoices. Optional status (paid | unpaid) and/or venue name filter.',
    parameters: obj({ status: str('paid | unpaid (omit for all)'), venue: str('venue name/slug to filter by (fuzzy)') }),
    run: async (a, ctx) => {
      let invs = rows(await getDocs(query(collection(db, 'platformInvoices'), orderBy('createdAt', 'desc'), limit(100))))
      if (a.status) invs = invs.filter((i) => (a.status === 'paid' ? i.status === 'paid' : i.status !== 'paid'))
      if (a.venue) {
        const r = await resolveVenue(ctx, a.venue)
        if (!r.t) return r.out
        invs = invs.filter((i) => i.tenantId === r.t.id)
      }
      return { count: invs.length, invoices: invs.map((i) => ({ id: i.id, venue: i.tenantName || i.tenantId || '', plan: i.plan || '', amount: Number(i.amount) || 0, currency: i.currency || 'SAR', period: i.period || '', status: i.status || 'unpaid', createdAt: iso(i.createdAt) })) }
    },
  },
  {
    name: 'list_platform_coupons', risk: 'safe',
    description: 'Subscription discount coupons (platformCoupons): code, type (percent|fixed), value, active, expiry.',
    parameters: obj({}),
    run: async () => {
      const cs = rows(await getDocs(query(collection(db, 'platformCoupons'), orderBy('createdAt', 'desc'), limit(100))))
      return { count: cs.length, coupons: cs.map((c) => ({ id: c.id, code: c.code || '', type: c.type || 'percent', value: Number(c.value) || 0, active: c.active !== false, expiresAt: c.expiresAt || null })) }
    },
  },
  {
    name: 'list_recent_broadcasts', risk: 'safe',
    description: 'Recent platform-wide announcements already sent (platformBroadcasts) — check before sending a duplicate.',
    parameters: obj({ max: num('how many (default 10)') }),
    run: async (a) => {
      const bs = rows(await getDocs(query(collection(db, 'platformBroadcasts'), orderBy('createdAt', 'desc'), limit(Math.max(1, Math.min(30, Number(a.max) || 10))))))
      return bs.map((b) => ({ title: b.title || '', body: b.body || '', plan: b.plan || 'all', createdAt: iso(b.createdAt) }))
    },
  },

  // ============ EXECUTE ============
  {
    name: 'suspend_venue', risk: 'danger',
    description: `Suspend a venue account (it loses access; the reason is shown to the venue). ${CONFIRM_NOTE}`,
    parameters: obj({ nameOrSlug: str('venue name or slug'), reason: str('suspension reason shown to the venue (Arabic)') }, ['nameOrSlug', 'reason']),
    run: async (a, ctx) => {
      const r = await resolveVenue(ctx, a.nameOrSlug)
      if (!r.t) return r.out
      const reason = String(a.reason || '').trim() || 'تجميد إداري من المنصة'
      await setTenantActive(r.t.id, false, reason)
      await audit(ctx, 'suspend_venue', r.t, reason)
      return { ok: true, message: `تم إيقاف منشأة «${r.t.name || r.t.id}» — السبب المسجل: ${reason}.` }
    },
  },
  {
    name: 'activate_venue', risk: 'confirm',
    description: 'Re-activate a previously suspended venue (clears the suspension reason).',
    parameters: obj({ nameOrSlug: str('venue name or slug') }, ['nameOrSlug']),
    run: async (a, ctx) => {
      const r = await resolveVenue(ctx, a.nameOrSlug)
      if (!r.t) return r.out
      await setTenantActive(r.t.id, true)
      await audit(ctx, 'activate_venue', r.t)
      return { ok: true, message: `تمت إعادة تفعيل منشأة «${r.t.name || r.t.id}».` }
    },
  },
  {
    name: 'set_venue_plan', risk: 'danger',
    description: `Change a venue's subscription plan (menu | ops | pro | enterprise), optionally setting a new expiry date (YYYY-MM-DD) which also marks the subscription active. ${CONFIRM_NOTE}`,
    parameters: obj({ nameOrSlug: str('venue name or slug'), planId: str('menu | ops | pro | enterprise'), expiresAt: str('optional new expiry date YYYY-MM-DD') }, ['nameOrSlug', 'planId']),
    run: async (a, ctx) => {
      if (!PLANS.some((p) => p.id === a.planId)) return { error: `خطة غير معروفة «${a.planId}». الخطط: ${PLANS.map((p) => p.id).join(' | ')}.` }
      const r = await resolveVenue(ctx, a.nameOrSlug)
      if (!r.t) return r.out
      const patch = { plan: a.planId }
      let expTxt = ''
      if (a.expiresAt) {
        const d = new Date(a.expiresAt)
        if (isNaN(d)) return { error: 'صيغة التاريخ غير صحيحة — استخدم YYYY-MM-DD.' }
        patch.planStatus = 'active'
        patch.planExpiresAt = d
        expTxt = ` حتى ${iso(d)}`
      }
      await setTenantPlan(r.t.id, patch)
      await audit(ctx, 'set_venue_plan', r.t, `${a.planId}${expTxt}`)
      return { ok: true, message: `تم تحويل «${r.t.name || r.t.id}» إلى خطة «${planAr(a.planId)}»${expTxt}.` }
    },
  },
  {
    name: 'extend_trial', risk: 'confirm',
    description: "Extend a venue's trial/subscription by N days from its current expiry (or from today if none). A trial stays a trial; anything else becomes active.",
    parameters: obj({ nameOrSlug: str('venue name or slug'), days: num('days to add (e.g. 7)') }, ['nameOrSlug', 'days']),
    run: async (a, ctx) => {
      const n = Number(a.days) || 0
      if (n <= 0) return { error: 'حدد عدد أيام موجباً للتمديد.' }
      const r = await resolveVenue(ctx, a.nameOrSlug)
      if (!r.t) return r.out
      const t = r.t
      // Same expiry math as platformConfig.bulkExtend, but preserves trial status.
      const raw = t.planExpiresAt
      const base = raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null
      const from = base && !isNaN(base) && base.getTime() > Date.now() ? base : new Date()
      const next = new Date(from.getTime() + n * 86400000)
      await setTenantPlan(t.id, { planStatus: t.planStatus === 'trial' ? 'trial' : 'active', planExpiresAt: next })
      await audit(ctx, 'extend_trial', t, `${n} يوم حتى ${iso(next)}`)
      return { ok: true, message: `تم تمديد اشتراك «${t.name || t.id}» ${n} يوماً — ينتهي في ${iso(next)}.` }
    },
  },
  {
    name: 'broadcast_announcement', risk: 'danger',
    description: `Send a platform-wide announcement (title + body, with push) to ALL venues or only venues on one plan. ${CONFIRM_NOTE}`,
    parameters: obj({ title: str('announcement title (Arabic)'), body: str('announcement body (Arabic)'), plan: str('optional plan id (menu|ops|pro|enterprise) to target only that plan; omit for all venues') }, ['title', 'body']),
    run: async (a, ctx) => {
      const title = String(a.title || '').trim()
      const body = String(a.body || '').trim()
      if (!title || !body) return { error: 'العنوان والنص مطلوبان للتعميم.' }
      if (a.plan && !PLANS.some((p) => p.id === a.plan)) return { error: `خطة غير معروفة «${a.plan}».` }
      await createBroadcast({ title, body, plan: a.plan || '', push: true })
      await audit(ctx, 'broadcast_announcement', null, `${title} -> ${a.plan || 'all'}`)
      return { ok: true, message: `تم إرسال التعميم «${title}» إلى ${a.plan ? `منشآت خطة «${planAr(a.plan)}»` : 'جميع المنشآت'}.` }
    },
  },
  {
    name: 'send_venue_message', risk: 'confirm',
    description: "Send a direct message to ONE venue in the platform-venue chat thread (appears in the venue's inbox as from platform management).",
    parameters: obj({ nameOrSlug: str('venue name or slug'), text: str('message text (Arabic)') }, ['nameOrSlug', 'text']),
    run: async (a, ctx) => {
      const text = String(a.text || '').trim()
      if (!text) return { error: 'اكتب نص الرسالة.' }
      const r = await resolveVenue(ctx, a.nameOrSlug)
      if (!r.t) return r.out
      // Mirrors how routes/platform/Chat.jsx sends platform-side messages.
      await sendChatMessage(r.t.id, { from: 'platform', uid: ctx?.user?.uid || null, name: 'إدارة المنصة', text, tenantName: r.t.name || '' })
      await audit(ctx, 'send_venue_message', r.t, text.slice(0, 120))
      return { ok: true, message: `تم إرسال الرسالة إلى «${r.t.name || r.t.id}» عبر محادثة المنصة.` }
    },
  },
  {
    name: 'activate_domain', risk: 'confirm',
    description: 'Activate a mapped custom domain/subdomain (status -> active) once DNS/SSL are ready.',
    parameters: obj({ host: str('the hostname, e.g. cafe.example.com') }, ['host']),
    run: async (a, ctx) => {
      const host = String(a.host || '').trim().toLowerCase()
      if (!host) return { error: 'حدد اسم النطاق.' }
      await setDomainStatus(host, 'active')
      await audit(ctx, 'activate_domain', null, host)
      return { ok: true, message: `تم تفعيل النطاق ${host}.` }
    },
  },
  {
    name: 'reject_domain', risk: 'confirm',
    description: 'Deactivate a mapped domain (status -> pending, the only non-active state the console uses). The mapping is kept; it can be re-activated later.',
    parameters: obj({ host: str('the hostname to deactivate') }, ['host']),
    run: async (a, ctx) => {
      const host = String(a.host || '').trim().toLowerCase()
      if (!host) return { error: 'حدد اسم النطاق.' }
      await setDomainStatus(host, 'pending')
      await audit(ctx, 'reject_domain', null, host)
      return { ok: true, message: `تم تعطيل النطاق ${host} (أعيد إلى حالة قيد التفعيل).` }
    },
  },
  {
    name: 'create_platform_coupon', risk: 'confirm',
    description: 'Create a subscription discount coupon (platformCoupons): percent off, optional expiry date. Note: the billing layer has no per-coupon usage cap.',
    parameters: obj({ code: str('coupon code (stored uppercase)'), pct: num('percent discount 1-100'), expiresAt: str('optional expiry date YYYY-MM-DD') }, ['code', 'pct']),
    run: async (a, ctx) => {
      const code = String(a.code || '').trim().toUpperCase()
      const pct = Number(a.pct) || 0
      if (!code) return { error: 'حدد رمز الكوبون.' }
      if (pct <= 0 || pct > 100) return { error: 'نسبة الخصم يجب أن تكون بين 1 و 100.' }
      const id = await saveCoupon(null, { code, type: 'percent', value: pct, expiresAt: a.expiresAt || null, active: true })
      await audit(ctx, 'create_platform_coupon', null, `${code} ${pct}%`)
      return { ok: true, id, message: `تم إنشاء كوبون الاشتراك ${code} بخصم ${pct}%${a.expiresAt ? ` حتى ${a.expiresAt}` : ''}.` }
    },
  },
  {
    name: 'close_issue', risk: 'confirm',
    description: 'Close a support ticket (platformIssues doc id from list_support_issues) by marking it resolved, with an optional resolution note.',
    parameters: obj({ id: str('the issue document id'), note: str('optional resolution note') }, ['id']),
    run: async (a, ctx) => {
      const id = String(a.id || '').trim()
      if (!id) return { error: 'حدد معرف التذكرة.' }
      await updateIssue(id, { status: 'resolved', ...(a.note ? { resolutionNote: String(a.note).slice(0, 500) } : {}) })
      await audit(ctx, 'close_issue', null, `${id}${a.note ? ` — ${String(a.note).slice(0, 120)}` : ''}`)
      return { ok: true, message: `تم إغلاق التذكرة (${id}) بحالة «محلولة»${a.note ? ` — ملاحظة الحل: ${a.note}` : ''}.` }
    },
  },
  {
    name: 'mark_invoice_paid', risk: 'confirm',
    description: 'Mark a subscription invoice (platformInvoices doc id from list_invoices) as paid.',
    parameters: obj({ id: str('the invoice document id') }, ['id']),
    run: async (a, ctx) => {
      const id = String(a.id || '').trim()
      if (!id) return { error: 'حدد معرف الفاتورة.' }
      await markInvoicePaid(id)
      await audit(ctx, 'mark_invoice_paid', null, id)
      return { ok: true, message: `تم تعليم الفاتورة (${id}) كمدفوعة.` }
    },
  },
]

export const PLATFORM_TOOLS_BY_NAME = Object.fromEntries(PLATFORM_TOOLS.map((t) => [t.name, t]))

// Gemini functionDeclarations for the executive loop (computed lazily by the
// caller to stay safe against the platformAI.js <-> platformAiActions.js cycle).
export function platformToolDeclarations() {
  return PLATFORM_TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }))
}

// Execute one tool by name. Never throws — errors come back as { error } so the
// model can read them and self-correct. ctx: { cache, user, actor }.
export async function runPlatformTool(name, args, ctx = {}) {
  const tool = PLATFORM_TOOLS_BY_NAME[name]
  if (!tool) return { error: `unknown tool: ${name}` }
  try {
    return await tool.run(args || {}, ctx)
  } catch (e) {
    return { error: String(e?.message || e) }
  }
}
