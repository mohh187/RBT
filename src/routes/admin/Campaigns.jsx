import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import Sheet from '../../components/Sheet.jsx'
import { watchCampaigns, saveCampaign, deleteCampaign, watchCustomers, listOffers, listOrdersSince, updateTenant, getPrivateDoc, setPrivateDoc } from '../../lib/db.js'
import { aiQuick } from '../../lib/aiBridge.js'
import { TIER_META } from '../../lib/membership.js'
import { CAP } from '../../lib/permissions.js'

// Marketing hub: compose → target (down to a single customer) → schedule/repeat
// → the processCampaigns Cloud Function sends automatically (WhatsApp + notice).
const AUDIENCES = [
  ['all', 'كل العملاء', 'All customers'],
  ['members', 'الأعضاء فقط', 'Members only'],
  ['silver', 'عضوية فضية', 'Silver members'],
  ['gold', 'عضوية ذهبية', 'Gold members'],
  ['platinum', 'عضوية بلاتينية', 'Platinum members'],
  ['active5', 'نشِط · 5+ طلبات', 'Active · 5+ orders'],
  ['orders10', 'مميّز · 10+ طلبات', 'Premium · 10+ orders'],
  ['orders15', 'نخبة · 15+ طلب', 'Elite · 15+ orders'],
  ['custom', 'عملاء محددون…', 'Specific customers…'],
]

const digitsOf = (p) => String(p || '').replace(/[^0-9]/g, '')

const matches = (c, audience, ids) => {
  if (c.optOut === true) return false
  const orders = Number(c.totalOrders) || 0
  const m = c.membership
  switch (audience) {
    case 'custom': return (ids || []).includes(digitsOf(c.phone))
    case 'members': return !!(m && m.active)
    case 'silver': case 'gold': case 'platinum': return !!(m && m.active && m.tier === audience)
    case 'active5': return orders >= 5
    case 'orders10': return orders >= 10
    case 'orders15': return orders >= 15
    default: return true
  }
}

const STATUS_META = {
  scheduled: { ar: 'مجدولة', en: 'Scheduled', cls: 'badge-gold' },
  sending: { ar: 'قيد الإرسال', en: 'Sending', cls: 'badge-gold' },
  sent: { ar: 'أُرسلت', en: 'Sent', cls: 'badge-success' },
  failed: { ar: 'فشلت', en: 'Failed', cls: 'badge-danger' },
  template: { ar: 'قالب', en: 'Template', cls: '' },
}

export default function Campaigns() {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const { tenantId, tenant, updateTenantLocal, can } = useAuth()
  const toast = useToast()
  const [params] = useSearchParams()
  const [campaigns, setCampaigns] = useState(null)
  const [customers, setCustomers] = useState([])
  const [offers, setOffers] = useState([])
  const [orders30, setOrders30] = useState([]) // attribution + peak-hour source
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const [pickQ, setPickQ] = useState('')

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchCampaigns(tenantId, setCampaigns)
    const u2 = watchCustomers(tenantId, setCustomers)
    listOffers(tenantId).then(setOffers).catch(() => {})
    const d = new Date(); d.setDate(d.getDate() - 30)
    listOrdersSince(tenantId, d).then(setOrders30).catch(() => {})
    return () => { u1(); u2() }
  }, [tenantId])

  const blank = () => ({ title: '', text: '', textB: '', audience: 'all', audienceIds: [], channels: { whatsapp: true, notice: false }, when: 'now', scheduleAt: '', repeat: 'none', couponCode: '', purpose: '' })
  const openNew = (preset = {}) => { setForm({ ...blank(), ...preset }); setOpen(true) }
  const openFromTemplate = (c) => openNew({ title: c.title || '', text: c.text || '', textB: c.textB || '', audience: c.audience || 'all', audienceIds: c.audienceIds || [], channels: c.channels || { whatsapp: true, notice: false }, couponCode: c.couponCode || '' })

  // Deep link: /admin/campaigns?to=<phone> — message ONE customer directly.
  useEffect(() => {
    const to = digitsOf(params.get('to'))
    if (to) openNew({ audience: 'custom', audienceIds: [to] })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const reach = useMemo(() => (form ? customers.filter((c) => matches(c, form.audience, form.audienceIds)).length : 0), [customers, form])
  const reachWithPhone = useMemo(() => (form ? customers.filter((c) => matches(c, form.audience, form.audienceIds) && digitsOf(c.phone)).length : 0), [customers, form])

  // Peak ordering hour from the last 30 days → "smart send time".
  const peakHour = useMemo(() => {
    const h = Array(24).fill(0)
    orders30.forEach((o) => { const d = o.createdAt?.toDate ? o.createdAt.toDate() : null; if (d) h[d.getHours()] += 1 })
    let best = 17
    h.forEach((n, i) => { if (n > h[best]) best = i })
    return best
  }, [orders30])
  const nextPeakISO = () => {
    const d = new Date()
    if (d.getHours() >= peakHour) d.setDate(d.getDate() + 1)
    d.setHours(peakHour, 0, 0, 0)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  // Coupon attribution: paid orders since the campaign was sent carrying its code.
  const attribution = useMemo(() => {
    const map = {}
    ;(campaigns || []).forEach((c) => {
      if (!c.couponCode || !c.sentAt) return
      const sentMs = c.sentAt?.toMillis ? c.sentAt.toMillis() : 0
      map[c.id] = orders30.filter((o) => (o.couponCode || '').toUpperCase() === c.couponCode.toUpperCase()
        && (o.createdAt?.toMillis ? o.createdAt.toMillis() : 0) >= sentMs
        && !['cancelled'].includes(o.status)).length
    })
    return map
  }, [campaigns, orders30])

  // "تحسين بالذكاء": venue-aware copywriting from real data.
  const improveWithAi = async () => {
    if (aiBusy) return
    setAiBusy(true)
    try {
      const top = [...customers].sort((a, b) => (b.totalOrders || 0) - (a.totalOrders || 0)).slice(0, 3).map((c) => c.name).filter(Boolean)
      const sold = {}
      orders30.forEach((o) => (o.items || []).forEach((it) => { sold[it.nameAr || ''] = (sold[it.nameAr || ''] || 0) + (it.qty || 1) }))
      const topItems = Object.entries(sold).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n).filter(Boolean)
      const members = customers.filter((c) => c.membership?.active).length
      const prompt = [
        `أنت خبير تسويق مطاعم سعودي. اكتب نص رسالة واتساب ترويجية واحدة قصيرة (2-4 أسطر) جذابة بلهجة سعودية خفيفة راقية بلا مبالغة ولا رموز تعبيرية.`,
        `المنشأة: ${tenant?.name || ''}. الأصناف الأكثر مبيعاً آخر 30 يوماً: ${topItems.join('، ') || 'غير متوفر'}. عدد الأعضاء: ${members}. الجمهور المستهدف: ${(AUDIENCES.find((a) => a[0] === form.audience) || [])[1] || ''}.`,
        form.couponCode ? `أدرج كود الخصم: ${form.couponCode}.` : '',
        form.purpose ? `الغرض الذي حدده صاحب المنشأة: ${form.purpose}` : (form.text ? `حسّن هذه المسودة: ${form.text}` : 'اقترح عرضاً مناسباً لهذا النشاط.'),
        `استخدم {الاسم} مكان اسم العميل و{المنشأة} مكان اسم المنشأة. أجب بنص الرسالة فقط دون أي شرح.`,
      ].filter(Boolean).join('\n')
      const out = await aiQuick(prompt)
      if (out) { setForm((f) => ({ ...f, text: out })); toast.success(ar ? 'كتب الذكاء نسخة محسّنة' : 'AI drafted an improved copy') }
      else toast.error(ar ? 'لم يصل رد من الذكاء' : 'No AI response')
    } catch (_) { toast.error(ar ? 'تعذّر الاتصال بالذكاء — تأكد من نشر الدوال أو مفتاح Gemini' : 'AI unavailable — deploy functions or set a Gemini key') }
    finally { setAiBusy(false) }
  }

  const insertVar = (v) => setForm((f) => ({ ...f, text: `${f.text || ''}${v}` }))

  const submit = async (asTemplate) => {
    if (!form?.text?.trim()) { toast.error(ar ? 'اكتب نص الرسالة أولاً' : 'Write the message first'); return }
    if (form.audience === 'custom' && !form.audienceIds.length) { toast.error(ar ? 'اختر العملاء المستهدفين' : 'Pick the target customers'); return }
    setBusy(true)
    try {
      const base = {
        title: (form.title || '').trim(),
        text: form.text.trim(),
        ...(form.textB?.trim() ? { textB: form.textB.trim() } : {}),
        audience: form.audience,
        ...(form.audience === 'custom' ? { audienceIds: form.audienceIds } : {}),
        channels: { whatsapp: form.channels.whatsapp !== false, notice: !!form.channels.notice },
        repeat: form.repeat || 'none',
        ...(form.couponCode ? { couponCode: form.couponCode } : {}),
      }
      if (asTemplate) {
        await saveCampaign(tenantId, null, { ...base, status: 'template' })
        toast.success(ar ? 'حُفظ القالب' : 'Template saved')
      } else {
        const when = form.when === 'later' && form.scheduleAt ? new Date(form.scheduleAt).getTime() : Date.now()
        if (form.when === 'later' && (!form.scheduleAt || Number.isNaN(when))) { toast.error(ar ? 'اختر موعد الإرسال' : 'Pick a send time'); setBusy(false); return }
        await saveCampaign(tenantId, null, { ...base, status: 'scheduled', scheduleAt: when })
        toast.success(form.when === 'later' ? (ar ? 'جُدولت الحملة' : 'Scheduled') : (ar ? 'ستُرسل خلال دقائق' : 'Sending within minutes'))
      }
      setOpen(false)
    } catch (_) { toast.error(t('error')) }
    finally { setBusy(false) }
  }

  const cancel = async (c) => {
    if (!window.confirm(ar ? 'حذف/إلغاء هذه الحملة؟' : 'Delete/cancel this campaign?')) return
    try { await deleteCampaign(tenantId, c.id) } catch (_) { toast.error(t('error')) }
  }

  // Automation panel (tenant.autoPromos + winback) — instant save.
  const auto = tenant?.autoPromos || {}
  const setAuto = async (kind, val) => {
    const next = { ...auto, [kind]: val }
    try { await updateTenant(tenantId, { autoPromos: next }); updateTenantLocal?.({ autoPromos: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
  }
  const wb = tenant?.winback || {}
  const setWinback = async (patch) => {
    const next = { ...wb, ...patch }
    try { await updateTenant(tenantId, { winback: next }); updateTenantLocal?.({ winback: next }) } catch (_) { toast.error(t('error')) }
  }
  const fu = tenant?.followup || {}
  const setFollowup = async (patch) => {
    const next = { ...fu, ...patch }
    try { await updateTenant(tenantId, { followup: next }); updateTenantLocal?.({ followup: next }) } catch (_) { toast.error(t('error')) }
  }
  const rep = tenant?.ownerReport || {}
  const setOwnerReport = async (patch) => {
    const next = { ...rep, ...patch }
    try { await updateTenant(tenantId, { ownerReport: next }); updateTenantLocal?.({ ownerReport: next }) } catch (_) { toast.error(t('error')) }
  }
  // Message templates — the venue's own wording for every automated message.
  const [tpl, setTpl] = useState(() => ({ ...(tenant?.msgTemplates || {}) }))
  const [tplBusy, setTplBusy] = useState(false)
  const saveTemplates = async () => {
    setTplBusy(true)
    const clean = {}
    Object.entries(tpl).forEach(([k, v]) => { if (String(v || '').trim()) clean[k] = String(v).trim() })
    try { await updateTenant(tenantId, { msgTemplates: clean }); updateTenantLocal?.({ msgTemplates: clean }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } finally { setTplBusy(false) }
  }
  // Venue's OWN WhatsApp number (Meta Cloud API creds — stored in the private subcollection).
  const canIntegrations = can(CAP.MANAGE_INTEGRATIONS)
  const [wa, setWa] = useState({ phoneNumberId: '', accessToken: '', templateOrderUpdate: '', templateReceipt: '' })
  const [waLoaded, setWaLoaded] = useState(false)
  const [waBusy, setWaBusy] = useState(false)
  useEffect(() => {
    if (!tenantId || !canIntegrations || waLoaded) return
    getPrivateDoc(tenantId, 'wa')
      .then((d) => { if (d) setWa((w) => ({ ...w, ...d })); setWaLoaded(true) })
      .catch(() => setWaLoaded(true))
  }, [tenantId, canIntegrations, waLoaded])
  const saveWa = async () => {
    setWaBusy(true)
    try { await setPrivateDoc(tenantId, 'wa', wa); toast.success(t('saved')) } catch (_) { toast.error(t('error')) } finally { setWaBusy(false) }
  }

  if (campaigns === null) return <Spinner />
  const templates = campaigns.filter((c) => c.status === 'template')
  const rest = campaigns.filter((c) => c.status !== 'template')
  const fmtWhen = (ms) => { try { return new Date(ms).toLocaleString(ar ? 'ar-SA-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) } catch (_) { return '' } }
  const audLabel = (c) => {
    if (c.audience === 'custom') return ar ? `${(c.audienceIds || []).length} عميل محدد` : `${(c.audienceIds || []).length} selected`
    const a = AUDIENCES.find((x) => x[0] === c.audience)
    return a ? (ar ? a[1] : a[2]) : c.audience
  }
  const monthSent = tenant?.msgsSent?.period === new Date().toLocaleDateString('en-CA').slice(0, 7) ? (tenant?.msgsSent?.count || 0) : 0
  const cap = tenant?.msgCapMonthly || 2000

  const AUTO_OPTS = [['off', ar ? 'إيقاف' : 'Off'], ['members', ar ? 'الأعضاء' : 'Members'], ['all', ar ? 'الجميع' : 'Everyone']]

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="row-between">
        <h2 className="page-title row" style={{ gap: 8 }}><Icon name="bellRing" size={22} /> {ar ? 'الإعلانات والحملات' : 'Campaigns'}</h2>
        <button className="btn btn-primary btn-sm" onClick={() => openNew()}>+ {ar ? 'حملة جديدة' : 'New campaign'}</button>
      </div>

      {/* analytics header */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat"><div className="label">{ar ? 'رسائل هذا الشهر' : 'Sent this month'}</div><div className="value num">{monthSent} / {cap}</div></div>
        <div className="stat"><div className="label">{ar ? 'حملات مُرسلة' : 'Campaigns sent'}</div><div className="value num">{rest.filter((c) => c.status === 'sent').length}</div></div>
        <div className="stat"><div className="label">{ar ? 'وقت الذروة (للإرسال الذكي)' : 'Peak hour (smart send)'}</div><div className="value num">{peakHour}:00</div></div>
      </div>

      {/* automation: item/offer promos + win-back */}
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <strong className="small"><Icon name="sparkles" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'الأتمتة — رسائل تُرسل وحدها' : 'Automation — messages that send themselves'}</strong>
        {[['offers', ar ? 'عند نشر عرض جديد' : 'New offer published'], ['featured', ar ? 'عند تمييز صنف بالنجمة' : 'Item starred'], ['newItems', ar ? 'عند إضافة أصناف جديدة' : 'New items added']].map(([k, label]) => (
          <div key={k} className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="small">{label}</span>
            <div className="row" style={{ gap: 4 }}>
              {AUTO_OPTS.map(([v, vl]) => (
                <button key={v} className={`chip ${(auto[k] || (tenant?.membershipPolicy?.mode === 'perks' && v === 'members' ? 'members' : 'off')) === v ? 'active' : ''}`} onClick={() => setAuto(k, v)}>{vl}</button>
              ))}
            </div>
          </div>
        ))}
        <div className="row-between" style={{ gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <span className="small">{ar ? 'رسالة «اشتقنا لك» للعميل الخامل' : '“We miss you” for idle customers'}</span>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            {wb.enabled && <span className="xs faint">{ar ? 'بعد' : 'after'} <input className="input num input-sm" style={{ width: 56, display: 'inline-block' }} type="number" value={wb.days ?? 30} onChange={(e) => setWinback({ days: Number(e.target.value) || 30 })} /> {ar ? 'يوم' : 'days'}</span>}
            <input type="checkbox" checked={wb.enabled === true} onChange={(e) => setWinback({ enabled: e.target.checked })} style={{ width: 22, height: 22 }} />
          </div>
        </div>

        {/* post-visit thanks: gratitude + Google-Maps review ask, X mins after payment */}
        <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="small">{ar ? 'رسالة ما بعد الزيارة (شكر + تقييم جوجل)' : 'Post-visit thanks (+ Google review)'}</span>
            <input type="checkbox" checked={fu.enabled === true} onChange={(e) => setFollowup({ enabled: e.target.checked })} style={{ width: 22, height: 22 }} />
          </div>
          {fu.enabled && (
            <>
              <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="xs faint">{ar ? 'تُرسل بعد' : 'Send after'} <input className="input num input-sm" style={{ width: 64, display: 'inline-block' }} type="number" min="10" value={fu.delayMins ?? 60} onChange={(e) => setFollowup({ delayMins: Number(e.target.value) || 60 })} /> {ar ? 'دقيقة من الدفع' : 'mins after payment'}</span>
                <label className="row" style={{ gap: 6, cursor: 'pointer', alignItems: 'center' }}>
                  <input type="checkbox" checked={fu.includeReview !== false} onChange={(e) => setFollowup({ includeReview: e.target.checked })} style={{ width: 18, height: 18 }} />
                  <span className="xs">{ar ? 'إرفاق رابط تقييم خرائط جوجل' : 'Attach Google Maps review link'}</span>
                </label>
              </div>
              <textarea className="textarea" rows={2} value={fu.text || ''} onChange={(e) => setFollowup({ text: e.target.value })}
                placeholder={ar ? 'شكراً لزيارتك {الاسم}! سعدنا بخدمتك في {المنشأة}.\nكيف كانت تجربتك؟' : 'Thanks for visiting {name}! How was your experience at {venue}?'} />
              {fu.includeReview !== false && !(tenant?.social?.googleMaps || '').trim() && (
                <span className="xs" style={{ color: 'var(--warning)' }}>{ar ? 'أضف رابط خرائط جوجل من الإعدادات ← وسائل التواصل ليُرفق تلقائياً.' : 'Add your Google Maps link in Settings → Social so it attaches automatically.'}</span>
              )}
            </>
          )}
        </div>
        {/* the owner's own daily digest — sales, tops, payment split, weekly slow movers */}
        <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="small">{ar ? 'تقرير المالك اليومي (واتساب 7 صباحاً)' : 'Owner daily report (WhatsApp 7am)'}</span>
            <input type="checkbox" checked={rep.enabled === true} onChange={(e) => setOwnerReport({ enabled: e.target.checked })} style={{ width: 22, height: 22 }} />
          </div>
          {rep.enabled && (
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input className="input num" dir="ltr" inputMode="tel" style={{ maxWidth: 200 }} placeholder="05xxxxxxxx" value={rep.phone || ''} onChange={(e) => setOwnerReport({ phone: e.target.value })} />
              <span className="xs faint">{ar ? 'مبيعات أمس + الأكثر مبيعاً + تقسيم الدفع، والأحد: الأصناف الراكدة أسبوعياً.' : 'Yesterday sales + tops + payment split; Sundays add weekly slow movers.'}</span>
            </div>
          )}
        </div>

        <p className="xs faint" style={{ margin: 0 }}>{ar ? 'أيضاً تلقائياً: ترحيب عند منح العضوية، تهنئة الترقية، وتهنئة عيد الميلاد — من إعدادات العضوية. لكل صنف خيار «وسم ترويجي» خاص في محرره يتجاوز هذه الإعدادات.' : 'Also automatic: membership welcome, tier-upgrade congrats, and birthday greetings. Each item can override these in its editor.'}</p>
      </div>

      {/* the venue's own wording for every automated message */}
      <details className="card card-pad">
        <summary className="small bold" style={{ cursor: 'pointer', listStyle: 'none' }}>
          <Icon name="penLine" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'قوالب الرسائل باسم منشأتك' : 'Your message templates'}
          <span className="xs faint"> — {ar ? 'اتركها فارغة لاستخدام الصياغة الافتراضية' : 'leave empty for the default wording'}</span>
        </summary>
        <div className="stack" style={{ gap: 10, marginTop: 10 }}>
          <p className="xs faint" style={{ margin: 0 }}>
            {ar ? 'المتغيرات: ' : 'Placeholders: '}
            <span dir="ltr" className="mono">{'{الاسم} {المنشأة} {الصنف} {الكود} {الطلب} {الحالة} {المبلغ} {الرابط} {العضوية}'}</span>
          </p>
          {[
            ['orderStatus', ar ? 'تحديث حالة الطلب' : 'Order status update', ar ? '{المنشأة}: {الحالة} — طلبك {الطلب}' : '{venue}: {status} — order {code}'],
            ['receipt', ar ? 'رسالة الفاتورة' : 'Receipt message', ar ? '{المنشأة}: استلمنا دفعتك {المبلغ} ريال. فاتورتك: {الرابط}' : '{venue}: payment {total} received. Invoice: {link}'],
            ['welcome', ar ? 'ترحيب العضوية الجديدة' : 'Membership welcome', ar ? 'أهلاً {الاسم} — صرت عضواً في {المنشأة}! بطاقتك: {الرابط}' : 'Welcome {name} — your card: {link}'],
            ['upgrade', ar ? 'تهنئة ترقية العضوية' : 'Tier upgrade', ar ? 'مبروك {الاسم}! ترقّيت إلى {العضوية} في {المنشأة}' : 'Congrats {name}! You reached {tier}'],
            ['birthday', ar ? 'تهنئة عيد الميلاد' : 'Birthday greeting', ar ? 'كل عام وأنت بخير {الاسم}! {المنشأة} تهنّئك' : 'Happy birthday {name}!'],
            ['offers', ar ? 'نشر عرض جديد' : 'New offer', ar ? '{الاسم}، عرض جديد في {المنشأة}: {الصنف} — الكود {الكود}' : 'New offer at {venue}: {item} — code {code}'],
            ['featured', ar ? 'تمييز صنف' : 'Item starred', ar ? '{المنشأة} اختارت لك: {الصنف}' : '{venue} picked for you: {item}'],
            ['newItems', ar ? 'أصناف جديدة' : 'New items', ar ? 'جديدنا في {المنشأة}: {الصنف}' : 'New at {venue}: {item}'],
          ].map(([k, label, ph]) => (
            <div key={k} className="field" style={{ marginBottom: 0 }}>
              <label>{label}</label>
              <textarea className="textarea" rows={2} value={tpl[k] || ''} placeholder={ph} onChange={(e) => setTpl((s) => ({ ...s, [k]: e.target.value }))} />
            </div>
          ))}
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={tplBusy} onClick={saveTemplates}>{tplBusy ? t('saving') : (ar ? 'حفظ القوالب' : 'Save templates')}</button>
        </div>
      </details>

      {/* venue's own WhatsApp number — messages arrive FROM the venue, not the platform */}
      {canIntegrations && (
        <details className="card card-pad">
          <summary className="small bold" style={{ cursor: 'pointer', listStyle: 'none' }}>
            <Icon name="message" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'أرسل برقم واتساب منشأتك الخاص' : 'Send from your own WhatsApp number'}
            <span className="xs faint"> — {ar ? 'اختياري: بدونه تُرسل الرسائل عبر رقم المنصة باسم منشأتك' : 'optional; otherwise the platform number sends in your name'}</span>
          </summary>
          <div className="stack" style={{ gap: 10, marginTop: 10 }}>
            <p className="xs faint" style={{ margin: 0 }}>{ar ? 'من لوحة Meta for Developers (منتج WhatsApp): انسخ Phone Number ID وتوكن System User الدائم. تُحفظ بأمان في خزنة المنشأة الخاصة ولا تظهر لأي زائر.' : 'From Meta for Developers (WhatsApp product): copy the Phone Number ID and a permanent System-User token. Stored in the venue-private vault.'}</p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="field grow" style={{ minWidth: 180, marginBottom: 0 }}>
                <label>Phone Number ID</label>
                <input className="input" dir="ltr" value={wa.phoneNumberId || ''} onChange={(e) => setWa((s) => ({ ...s, phoneNumberId: e.target.value.trim() }))} />
              </div>
              <div className="field grow" style={{ minWidth: 220, marginBottom: 0 }}>
                <label>{ar ? 'التوكن الدائم' : 'Permanent access token'}</label>
                <input className="input" dir="ltr" type="password" value={wa.accessToken || ''} onChange={(e) => setWa((s) => ({ ...s, accessToken: e.target.value.trim() }))} />
              </div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="field grow" style={{ minWidth: 180, marginBottom: 0 }}>
                <label>{ar ? 'اسم قالب حالة الطلب (المعتمد)' : 'Approved order-update template'}</label>
                <input className="input" dir="ltr" placeholder="order_update" value={wa.templateOrderUpdate || ''} onChange={(e) => setWa((s) => ({ ...s, templateOrderUpdate: e.target.value.trim() }))} />
              </div>
              <div className="field grow" style={{ minWidth: 180, marginBottom: 0 }}>
                <label>{ar ? 'اسم قالب الفاتورة (اختياري)' : 'Receipt template (optional)'}</label>
                <input className="input" dir="ltr" placeholder="receipt" value={wa.templateReceipt || ''} onChange={(e) => setWa((s) => ({ ...s, templateReceipt: e.target.value.trim() }))} />
              </div>
            </div>
            <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={waBusy || !waLoaded} onClick={saveWa}>{waBusy ? t('saving') : (ar ? 'حفظ الربط' : 'Save connection')}</button>
          </div>
        </details>
      )}

      {templates.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <strong className="small">{ar ? 'قوالبك المحفوظة' : 'Saved templates'}</strong>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {templates.map((c) => (
              <div key={c.id} className="card card-pad row" style={{ gap: 8, alignItems: 'center', maxWidth: 340 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || (ar ? 'قالب' : 'Template')}</div>
                  <div className="xs faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.text}</div>
                </div>
                <button className="btn btn-sm btn-outline" onClick={() => openFromTemplate(c)}>{ar ? 'استخدام' : 'Use'}</button>
                <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => cancel(c)} aria-label={t('delete')}><Icon name="delete" size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {rest.length === 0 ? (
        <Empty icon="bellRing" title={ar ? 'لا حملات بعد' : 'No campaigns yet'} hint={ar ? 'أنشئ أول حملة ترويجية لعملائك' : 'Create your first promo blast'} action={<button className="btn btn-primary" onClick={() => openNew()}>+ {ar ? 'حملة جديدة' : 'New campaign'}</button>} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {rest.map((c) => {
            const st = STATUS_META[c.status] || STATUS_META.scheduled
            return (
              <div key={c.id} className="card card-pad stack" style={{ gap: 6 }}>
                <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <strong className="small">{c.title || (ar ? 'حملة' : 'Campaign')}{c.repeat && c.repeat !== 'none' ? <span className="badge" style={{ marginInlineStart: 6 }}><Icon name="repeat" size={11} /> {c.repeat === 'weekly' ? (ar ? 'أسبوعية' : 'weekly') : (ar ? 'يومية' : 'daily')}</span> : null}</strong>
                  <span className={`badge ${st.cls}`}>{ar ? st.ar : st.en}</span>
                </div>
                <div className="xs faint" style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
                {c.textB && <div className="xs faint" style={{ whiteSpace: 'pre-wrap', borderInlineStart: '2px solid var(--border)', paddingInlineStart: 8 }}>B: {c.textB}</div>}
                <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="customers" size={12} /> {audLabel(c)}</span>
                  {c.scheduleAt && <span className="xs faint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="clock" size={12} /> {fmtWhen(c.scheduleAt)}</span>}
                  {c.couponCode && <span className="xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="offers" size={12} /> {c.couponCode}{attribution[c.id] != null ? ` · ${attribution[c.id]} ${ar ? 'طلب بالكود' : 'orders'}` : ''}</span>}
                  {(c.status === 'sent' || c.runs > 0) && <span className="xs" style={{ color: 'var(--success)' }}>{ar ? `وصلت ${c.sentCount || 0}` : `${c.sentCount || 0} delivered`}{c.failCount ? ` · ${c.failCount} ${ar ? 'فشل' : 'failed'}` : ''}{c.cappedCount ? ` · ${c.cappedCount} ${ar ? 'تجاوز السقف' : 'capped'}` : ''}</span>}
                  {c.status === 'failed' && c.error && <span className="xs" style={{ color: 'var(--danger)' }}>{c.error}</span>}
                  <span className="grow" />
                  {(c.status === 'scheduled' || c.status === 'sent') && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => cancel(c)}>{c.status === 'scheduled' ? (ar ? 'إلغاء' : 'Cancel') : (ar ? 'حذف' : 'Delete')}</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={ar ? 'حملة ترويجية' : 'New campaign'} tall
        footer={
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-outline" disabled={busy} onClick={() => submit(true)}>{ar ? 'حفظ كقالب' : 'Save template'}</button>
            <button className="btn btn-primary grow" disabled={busy} onClick={() => submit(false)}>
              {busy ? t('saving') : form?.when === 'later' ? (ar ? 'جدولة الإرسال' : 'Schedule') : (ar ? 'إرسال الآن' : 'Send now')}
            </button>
          </div>
        }>
        {form && (
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="field">
              <label>{ar ? 'عنوان الحملة (داخلي)' : 'Campaign title (internal)'}</label>
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={ar ? 'مثال: عرض نهاية الأسبوع' : 'e.g. Weekend deal'} />
            </div>

            {/* AI composer: purpose → venue-aware copy */}
            <div className="field" style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-md)', padding: 10 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="sparkles" size={14} style={{ color: 'var(--brand)' }} /> {ar ? 'ما هدف الرسالة؟ (للذكاء)' : 'Message goal (for AI)'}</label>
              <div className="row" style={{ gap: 8 }}>
                <input className="input grow" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder={ar ? 'مثال: تنشيط مبيعات الفترة الصباحية بخصم على القهوة' : 'e.g. boost morning sales with a coffee deal'} />
                <button type="button" className="btn btn-outline" disabled={aiBusy} onClick={improveWithAi} style={{ whiteSpace: 'nowrap' }}>
                  <Icon name="sparkles" size={15} /> {aiBusy ? (ar ? 'يكتب…' : 'Writing…') : (ar ? 'تحسين بالذكاء' : 'Improve with AI')}
                </button>
              </div>
              <span className="xs faint">{ar ? 'الذكاء يكتب بناءً على أصنافك الأكثر مبيعاً وأعضائك ونشاطك الفعلي.' : 'AI writes from your real best-sellers, members and activity.'}</span>
            </div>

            <div className="field">
              <label>{ar ? 'نص الرسالة' : 'Message'}</label>
              <textarea className="textarea" rows={4} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })}
                placeholder={ar ? 'مرحباً {الاسم}، خصم 20% على كل المشروبات في {المنشأة} هذا الخميس…' : 'Hi {name}, 20% off all drinks at {venue} this Thursday…'} />
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="chip" onClick={() => insertVar(ar ? '{الاسم}' : '{name}')}>+ {ar ? 'اسم العميل' : 'Customer name'}</button>
                <button type="button" className="chip" onClick={() => insertVar(ar ? '{المنشأة}' : '{venue}')}>+ {ar ? 'اسم المنشأة' : 'Venue name'}</button>
              </div>
            </div>

            <details>
              <summary className="small bold" style={{ cursor: 'pointer' }}>{ar ? 'اختبار A/B (نسخة ثانية اختيارية)' : 'A/B test (optional variant B)'}</summary>
              <textarea className="textarea" rows={3} style={{ marginTop: 8 }} value={form.textB} onChange={(e) => setForm({ ...form, textB: e.target.value })}
                placeholder={ar ? 'النسخة B — تُرسل لنصف الجمهور لقياس الأفضل' : 'Variant B — sent to half the audience'} />
            </details>

            <div className="field">
              <label>{ar ? 'الجمهور المستهدف' : 'Audience'}</label>
              <select className="select" value={form.audience} onChange={(e) => { const v = e.target.value; setForm({ ...form, audience: v }); if (v === 'custom') setPickOpen(true) }}>
                {AUDIENCES.map(([id, a, e]) => <option key={id} value={id}>{ar ? a : e}</option>)}
              </select>
              {form.audience === 'custom' && (
                <button type="button" className="btn btn-sm btn-outline" style={{ marginTop: 6, alignSelf: 'flex-start' }} onClick={() => setPickOpen(true)}>
                  <Icon name="customers" size={14} /> {ar ? `اختيار العملاء (${form.audienceIds.length})` : `Pick customers (${form.audienceIds.length})`}
                </button>
              )}
              <span className="xs faint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                <Icon name="customers" size={12} /> {ar ? `سيصل إلى ${reachWithPhone} عميل (لديهم جوال) من أصل ${reach}` : `Reaches ${reachWithPhone} with a phone (of ${reach})`}
              </span>
            </div>

            <div className="field">
              <label>{ar ? 'ربط بكود خصم (لقياس أثر الحملة)' : 'Attach coupon (measures conversions)'}</label>
              <select className="select" value={form.couponCode} onChange={(e) => setForm({ ...form, couponCode: e.target.value })}>
                <option value="">{ar ? 'بدون' : 'None'}</option>
                {offers.filter((o) => o.code).map((o) => <option key={o.id} value={o.code}>{o.code} — {o.nameAr}</option>)}
              </select>
            </div>

            <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
              <label className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'center' }}>
                <input type="checkbox" checked={form.channels.whatsapp !== false} onChange={(e) => setForm({ ...form, channels: { ...form.channels, whatsapp: e.target.checked } })} style={{ width: 20, height: 20 }} />
                <span className="small">{ar ? 'واتساب' : 'WhatsApp'}</span>
              </label>
              <label className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'center' }}>
                <input type="checkbox" checked={!!form.channels.notice} onChange={(e) => setForm({ ...form, channels: { ...form.channels, notice: e.target.checked } })} style={{ width: 20, height: 20 }} />
                <span className="small">{ar ? 'إشعار داخل المنيو' : 'In-menu notice'}</span>
              </label>
            </div>

            <div className="field">
              <label>{ar ? 'موعد الإرسال' : 'When'}</label>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className={`chip ${form.when === 'now' ? 'active' : ''}`} onClick={() => setForm({ ...form, when: 'now' })}>{ar ? 'الآن' : 'Now'}</button>
                <button type="button" className={`chip ${form.when === 'later' ? 'active' : ''}`} onClick={() => setForm({ ...form, when: 'later' })}>{ar ? 'جدولة' : 'Schedule'}</button>
                <button type="button" className="chip" onClick={() => setForm({ ...form, when: 'later', scheduleAt: nextPeakISO() })}><Icon name="sparkles" size={12} /> {ar ? `وقت الذروة (${peakHour}:00)` : `Peak time (${peakHour}:00)`}</button>
              </div>
              {form.when === 'later' && (
                <input className="input" type="datetime-local" style={{ marginTop: 8 }} value={form.scheduleAt} onChange={(e) => setForm({ ...form, scheduleAt: e.target.value })} />
              )}
            </div>

            <div className="field">
              <label>{ar ? 'التكرار' : 'Repeat'}</label>
              <div className="row" style={{ gap: 6 }}>
                {[['none', ar ? 'مرة واحدة' : 'Once'], ['weekly', ar ? 'أسبوعياً (نفس اليوم والوقت)' : 'Weekly'], ['daily', ar ? 'يومياً' : 'Daily']].map(([v, l]) => (
                  <button key={v} type="button" className={`chip ${form.repeat === v ? 'active' : ''}`} onClick={() => setForm({ ...form, repeat: v })}>{l}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Sheet>

      {/* customer picker (custom audience / single customer) */}
      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title={ar ? 'اختيار العملاء' : 'Pick customers'} tall
        footer={<button className="btn btn-primary btn-block" onClick={() => setPickOpen(false)}>{ar ? `تم (${form?.audienceIds?.length || 0})` : `Done (${form?.audienceIds?.length || 0})`}</button>}>
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <input className="input" placeholder={t('search')} value={pickQ} onChange={(e) => setPickQ(e.target.value)} />
          {customers
            .filter((c) => digitsOf(c.phone))
            .filter((c) => !pickQ.trim() || `${c.name || ''} ${c.phone || ''}`.toLowerCase().includes(pickQ.trim().toLowerCase()))
            .slice(0, 80)
            .map((c) => {
              const id = digitsOf(c.phone)
              const on = form?.audienceIds?.includes(id)
              return (
                <button key={id} className="list-row" onClick={() => setForm((f) => ({ ...f, audienceIds: on ? f.audienceIds.filter((x) => x !== id) : [...f.audienceIds, id] }))}>
                  <span className="center" style={{ width: 30, height: 30, borderRadius: '50%', background: on ? 'var(--brand)' : 'var(--surface-2)', color: on ? 'var(--on-brand)' : 'var(--text-muted)', flex: 'none' }}>
                    <Icon name={on ? 'check' : 'user'} size={14} />
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="small bold">{c.name || (ar ? 'عميل' : 'Customer')}</div>
                    <div className="xs faint num" dir="ltr">{c.phone} · {c.totalOrders || 0} {ar ? 'طلب' : 'orders'}</div>
                  </div>
                  {c.membership?.active && <Icon name="award" size={15} style={{ color: (TIER_META[c.membership.tier] || {}).color }} />}
                </button>
              )
            })}
        </div>
      </Sheet>
    </div>
  )
}
