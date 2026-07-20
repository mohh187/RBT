import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { watchCampaigns, saveCampaign, listOrdersSince } from '../../lib/db.js'
import { CAP } from '../../lib/permissions.js'

// «سجل الرسائل والتحليلات» — read-only log of every campaign (sent/scheduled/failed)
// with coupon attribution, plus the CONFIG state of each automation. Numbers shown
// here are only the ones we truly record (sentCount/failCount/cappedCount +
// coupon-attributed orders). Per-message delivery/read receipts require the Meta
// webhook (WHATSAPP_SETUP.md) — we say so instead of inventing them.

const AUDIENCE_LABELS = {
  all: ['كل العملاء', 'All customers'],
  members: ['الأعضاء فقط', 'Members only'],
  silver: ['عضوية فضية', 'Silver members'],
  gold: ['عضوية ذهبية', 'Gold members'],
  platinum: ['عضوية بلاتينية', 'Platinum members'],
  active5: ['نشِط · 5+ طلبات', 'Active · 5+ orders'],
  orders10: ['مميّز · 10+ طلبات', 'Premium · 10+ orders'],
  orders15: ['نخبة · 15+ طلب', 'Elite · 15+ orders'],
}

const STATUS_META = {
  scheduled: { ar: 'مجدولة', en: 'Scheduled', cls: 'badge-gold' },
  sending: { ar: 'قيد الإرسال', en: 'Sending', cls: 'badge-gold' },
  sent: { ar: 'أُرسلت', en: 'Sent', cls: 'badge-success' },
  failed: { ar: 'فشلت', en: 'Failed', cls: 'badge-danger' },
}

const FILTERS = [
  ['all', 'الكل', 'All'],
  ['sent', 'مُرسلة', 'Sent'],
  ['scheduled', 'مجدولة', 'Scheduled'],
  ['failed', 'فاشلة', 'Failed'],
]

export default function Messages() {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const { tenantId, tenant, can } = useAuth()
  const toast = useToast()
  const [campaigns, setCampaigns] = useState(null)
  const [orders30, setOrders30] = useState([]) // coupon-attribution source (same window as Campaigns)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState(null)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    if (!tenantId) return
    const un = watchCampaigns(tenantId, setCampaigns)
    const d = new Date(); d.setDate(d.getDate() - 30)
    listOrdersSince(tenantId, d).then(setOrders30).catch(() => {})
    return un
  }, [tenantId])

  // Coupon attribution — mirrors Campaigns.jsx exactly: non-cancelled orders in the
  // last 30 days carrying the campaign's code, created after it was sent.
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

  const log = useMemo(() => (campaigns || []).filter((c) => c.status !== 'template'), [campaigns])

  const best = useMemo(() => {
    let b = null
    log.forEach((c) => { const n = attribution[c.id]; if (n != null && n > 0 && (!b || n > attribution[b.id])) b = c })
    return b
  }, [log, attribution])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return log.filter((c) => {
      if (filter === 'sent' && c.status !== 'sent') return false
      if (filter === 'scheduled' && !['scheduled', 'sending'].includes(c.status)) return false
      if (filter === 'failed' && c.status !== 'failed') return false
      if (needle && !`${c.title || ''} ${c.text || ''} ${c.textB || ''}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [log, filter, q])

  const fmtWhen = (v) => {
    const ms = v?.toMillis ? v.toMillis() : (typeof v === 'number' ? v : null)
    if (!ms) return ''
    try { return new Date(ms).toLocaleString(ar ? 'ar-SA-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) } catch (_) { return '' }
  }
  const audLabel = (c) => {
    if (c.audience === 'custom') return ar ? `${(c.audienceIds || []).length} عميل محدد` : `${(c.audienceIds || []).length} selected`
    const a = AUDIENCE_LABELS[c.audience]
    return a ? (ar ? a[0] : a[1]) : (c.audience || '')
  }

  // Same month-counter logic as Campaigns.jsx (tenant.msgsSent {period, count}).
  const monthSent = tenant?.msgsSent?.period === new Date().toLocaleDateString('en-CA').slice(0, 7) ? (tenant?.msgsSent?.count || 0) : 0
  const cap = tenant?.msgCapMonthly || 2000
  const canManage = can(CAP.MANAGE_CAMPAIGNS)

  // Resend = duplicate as a NEW scheduled campaign (same saveCampaign shape as
  // Campaigns.jsx) one hour ahead, so the owner can still edit/cancel it there.
  const resend = async (c) => {
    if (busyId) return
    setBusyId(c.id)
    try {
      await saveCampaign(tenantId, null, {
        title: (c.title || '').trim(),
        text: c.text || '',
        ...(c.textB ? { textB: c.textB } : {}),
        audience: c.audience || 'all',
        ...(c.audience === 'custom' ? { audienceIds: c.audienceIds || [] } : {}),
        channels: { whatsapp: c.channels?.whatsapp !== false, notice: !!c.channels?.notice },
        repeat: 'none',
        ...(c.couponCode ? { couponCode: c.couponCode } : {}),
        status: 'scheduled',
        scheduleAt: Date.now() + 3600e3,
      })
      toast.success(ar ? 'أُنشئت نسخة مجدولة بعد ساعة — عدّلها أو ألغِها من صفحة الحملات' : 'Duplicated as a campaign scheduled in 1 hour — manage it from Campaigns')
    } catch (_) { toast.error(t('error')) }
    finally { setBusyId(null) }
  }

  const copyText = async (c) => {
    try { await navigator.clipboard.writeText(c.text || ''); toast.success(ar ? 'نُسخ النص' : 'Text copied') }
    catch (_) { toast.error(t('error')) }
  }

  // Automation CONFIG state — read from the same tenant fields the Cloud Functions use.
  const fu = tenant?.followup || {}
  const wb = tenant?.winback || {}
  const rep = tenant?.ownerReport || {}
  const lc = tenant?.lifecycleMsgs || {}
  const bdayBonus = Number(tenant?.membershipPolicy?.birthdayBonus) || 0
  const AUTOMATIONS = [
    { key: 'followup', icon: 'star', on: fu.enabled === true,
      ar: 'ما بعد الزيارة', en: 'Post-visit thanks',
      detAr: fu.enabled === true ? `تُرسل بعد ${fu.delayMins ?? 60} دقيقة من الدفع${fu.includeReview !== false ? ' + رابط تقييم جوجل' : ''}` : 'شكر بعد الدفع + طلب تقييم — فعّلها من صفحة الحملات',
      detEn: fu.enabled === true ? `Sends ${fu.delayMins ?? 60} mins after payment${fu.includeReview !== false ? ' + Google review link' : ''}` : 'Thanks after payment + review ask — enable it in Campaigns' },
    { key: 'winback', icon: 'heart', on: wb.enabled === true,
      ar: 'اشتقنا لك', en: 'We miss you',
      detAr: wb.enabled === true ? `للعميل الخامل بعد ${wb.days ?? 30} يوماً بلا طلبات` : 'رسالة للعميل الخامل — فعّلها من صفحة الحملات',
      detEn: wb.enabled === true ? `Idle customers after ${wb.days ?? 30} days` : 'Idle-customer nudge — enable it in Campaigns' },
    { key: 'birthday', icon: 'cake', on: lc.birthday !== false,
      ar: 'عيد الميلاد', en: 'Birthday',
      detAr: lc.birthday !== false ? `تهنئة يومية لمن سُجّل تاريخ ميلاده${bdayBonus > 0 ? ` + ${bdayBonus} نقطة هدية` : ''}` : 'متوقفة من إعدادات العضوية',
      detEn: lc.birthday !== false ? `Daily greeting for recorded birthdays${bdayBonus > 0 ? ` + ${bdayBonus} bonus points` : ''}` : 'Disabled in membership settings' },
    { key: 'ownerReport', icon: 'chartBar', on: rep.enabled === true,
      ar: 'تقرير المالك', en: 'Owner report',
      detAr: rep.enabled === true ? `واتساب يومياً 7 صباحاً${rep.phone ? ` إلى ${rep.phone}` : ' — أضف رقم الجوال من صفحة الحملات'}` : 'ملخص المبيعات اليومي — فعّله من صفحة الحملات',
      detEn: rep.enabled === true ? `Daily WhatsApp at 7am${rep.phone ? ` to ${rep.phone}` : ' — add a phone in Campaigns'}` : 'Daily sales digest — enable it in Campaigns' },
    { key: 'welcome', icon: 'award', on: lc.welcome !== false,
      ar: 'الترحيب', en: 'Welcome',
      detAr: lc.welcome !== false ? 'تُرسل تلقائياً عند منح العضوية مع رابط البطاقة' : 'متوقفة من إعدادات العضوية',
      detEn: lc.welcome !== false ? 'Sent automatically on membership grant with the card link' : 'Disabled in membership settings' },
  ]

  if (campaigns === null) return <Spinner />

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      <h2 className="page-title row" style={{ gap: 8 }}><Icon name="message" size={22} /> {ar ? 'سجل الرسائل والتحليلات' : 'Message log & analytics'}</h2>

      {/* header stats — only numbers we truly record */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat">
          <div className="label">{ar ? 'رسائل هذا الشهر' : 'Sent this month'}</div>
          <div className="value num">{monthSent} / {cap}</div>
        </div>
        <div className="stat">
          <div className="label">{ar ? 'حملات مُرسلة' : 'Campaigns sent'}</div>
          <div className="value num">{log.filter((c) => c.status === 'sent').length}</div>
        </div>
        <div className="stat">
          <div className="label">{ar ? 'أفضل حملة (طلبات محققة)' : 'Best campaign (attributed)'}</div>
          <div className="value num">{best ? attribution[best.id] : '—'}</div>
          <div className="xs faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {best ? (best.title || (ar ? 'حملة' : 'Campaign')) : (ar ? 'اربط كود خصم بحملتك لقياس الأثر' : 'Attach a coupon to measure impact')}
          </div>
        </div>
      </div>

      {/* filters + search */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {FILTERS.map(([id, a, e]) => (
          <button key={id} className={`chip ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>{ar ? a : e}</button>
        ))}
        <input className="input grow" style={{ minWidth: 160, maxWidth: 300 }} placeholder={ar ? 'بحث في نص الرسائل…' : 'Search message text…'} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {/* campaign log — every campaign, expandable */}
      {shown.length === 0 ? (
        <Empty icon="message" title={ar ? 'لا رسائل مطابقة' : 'No matching messages'} hint={ar ? 'أنشئ حملاتك من صفحة «الإعلانات والحملات»' : 'Create campaigns from the Campaigns page'} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {shown.map((c) => {
            const st = STATUS_META[c.status] || STATUS_META.scheduled
            const expanded = openId === c.id
            const attr = attribution[c.id]
            const when = c.sentAt || c.lastRunAt || c.scheduleAt
            return (
              <div key={c.id} className="card card-pad stack" style={{ gap: 6 }}>
                <button onClick={() => setOpenId(expanded ? null : c.id)}
                  style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', width: '100%' }}>
                  <Icon name={expanded ? 'back' : 'next'} size={14} style={{ color: 'var(--text-muted)', flex: 'none', transform: ar ? 'scaleX(-1)' : 'none' }} />
                  <strong className="small grow" style={{ minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.title || (ar ? 'حملة' : 'Campaign')}
                    {c.repeat && c.repeat !== 'none' ? <span className="badge" style={{ marginInlineStart: 6 }}><Icon name="repeat" size={11} /> {c.repeat === 'weekly' ? (ar ? 'أسبوعية' : 'weekly') : (ar ? 'يومية' : 'daily')}</span> : null}
                  </strong>
                  {when && <span className="xs faint num" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="clock" size={12} /> {fmtWhen(when)}</span>}
                  {(c.status === 'sent' || c.runs > 0) && (
                    <span className="xs num" style={{ color: 'var(--success)' }}>
                      {ar ? `وصلت ${c.sentCount || 0}` : `${c.sentCount || 0} sent`}
                      {c.failCount ? ` · ${c.failCount} ${ar ? 'فشل' : 'failed'}` : ''}
                    </span>
                  )}
                  <span className={`badge ${st.cls}`}>{ar ? st.ar : st.en}</span>
                </button>

                {expanded && (
                  <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
                    {c.textB && (
                      <div className="stack" style={{ gap: 4, borderInlineStart: '2px solid var(--border)', paddingInlineStart: 8 }}>
                        <span className="xs bold">{ar ? 'النسخة B — أُرسلت لنصف الجمهور (اختبار A/B)' : 'Variant B — sent to half the audience (A/B test)'}</span>
                        <div className="xs faint" style={{ whiteSpace: 'pre-wrap' }}>{c.textB}</div>
                      </div>
                    )}
                    <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Icon name="customers" size={12} /> {audLabel(c)}{c.audienceCount != null ? ` · ${c.audienceCount} ${ar ? 'مستهدف' : 'targeted'}` : ''}
                      </span>
                      {(c.status === 'sent' || c.runs > 0) && (
                        <span className="xs num">
                          {ar ? `مُرسلة: ${c.sentCount || 0}` : `Sent: ${c.sentCount || 0}`}
                          {` · ${ar ? 'فاشلة' : 'Failed'}: ${c.failCount || 0}`}
                          {c.skippedCount ? <b style={{ color: 'var(--warning)' }}>{` · ${c.skippedCount} ${ar ? 'لم تُرسل (واتساب غير مربوط)' : 'skipped (WhatsApp not connected)'}`}</b> : ''}
                          {c.cappedCount ? ` · ${c.cappedCount} ${ar ? 'تجاوز السقف' : 'capped'}` : ''}
                        </span>
                      )}
                      {c.runs > 0 && (
                        <span className="xs faint num">
                          {ar ? `مرات الإرسال: ${c.runs}` : `Runs: ${c.runs}`}
                          {c.lastRunAt ? ` · ${ar ? 'آخرها' : 'last'} ${fmtWhen(c.lastRunAt)}` : ''}
                        </span>
                      )}
                      {c.scheduleAt && ['scheduled', 'sending'].includes(c.status) && (
                        <span className="xs faint num" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="clock" size={12} /> {fmtWhen(c.scheduleAt)}</span>
                      )}
                      {c.status === 'failed' && c.error && <span className="xs" style={{ color: 'var(--danger)' }}>{c.error}</span>}
                    </div>
                    {c.couponCode && (
                      <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="offers" size={12} /> {c.couponCode}</span>
                        {attr != null
                          ? <span className="badge badge-success num">{ar ? `طلبات محققة: ${attr}` : `Attributed orders: ${attr}`}</span>
                          : <span className="xs faint">{ar ? 'تُحسب الطلبات المحققة بعد الإرسال' : 'Attribution counts after sending'}</span>}
                        <span className="xs faint">{ar ? '(طلبات حملت الكود خلال آخر 30 يوماً)' : '(orders carrying the code, last 30 days)'}</span>
                      </div>
                    )}
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      {canManage && (
                        <button className="btn btn-sm btn-outline" disabled={busyId === c.id} onClick={() => resend(c)}>
                          <Icon name="repeat" size={14} /> {busyId === c.id ? (t('saving') || '…') : (ar ? 'إعادة الإرسال' : 'Resend')}
                        </button>
                      )}
                      <button className="btn btn-sm btn-ghost" onClick={() => copyText(c)}><Icon name="copy" size={14} /> {ar ? 'نسخ النص' : 'Copy text'}</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* automation log — CONFIG state only; no invented per-message numbers */}
      <div className="stack" style={{ gap: 8 }}>
        <strong className="small"><Icon name="sparkles" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'الرسائل التلقائية — حالة التفعيل' : 'Automations — configuration'}</strong>
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))' }}>
          {AUTOMATIONS.map((a) => (
            <div key={a.key} className="card card-pad stack" style={{ gap: 6 }}>
              <div className="row-between" style={{ gap: 8 }}>
                <span className="small bold" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name={a.icon} size={15} /> {ar ? a.ar : a.en}</span>
                <span className={`badge ${a.on ? 'badge-success' : ''}`}>{a.on ? (ar ? 'مفعّلة' : 'On') : (ar ? 'متوقفة' : 'Off')}</span>
              </div>
              <span className="xs faint">{ar ? a.detAr : a.detEn}</span>
            </div>
          ))}
        </div>
        <p className="xs faint" style={{ margin: 0 }}>
          {ar
            ? 'الإحصاء الفردي لكل رسالة تلقائية وإيصالات القراءة يتطلبان Webhook من Meta — قادم مع تفعيل واتساب الرسمي.'
            : 'Per-message stats for automations and read receipts require a Meta webhook — coming with official WhatsApp activation.'}
        </p>
      </div>

      {/* honesty card: what the numbers here mean */}
      <div className="card card-pad row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon name="eye" size={18} style={{ color: 'var(--text-muted)', flex: 'none', marginTop: 2 }} />
        <p className="xs faint" style={{ margin: 0 }}>
          {ar
            ? 'أعداد «مُرسلة/فاشلة» حقيقية من سجل الإرسال الفعلي. أما إيصالات التسليم والقراءة لكل رسالة فتصل فقط عبر Webhook رسمي من Meta، وتظهر هنا فور ربط واتساب الرسمي (راجع WHATSAPP_SETUP.md).'
            : 'Sent/failed counts are real numbers from the actual send log. Per-message delivery and read receipts only arrive via an official Meta webhook and will appear here once official WhatsApp is connected (see WHATSAPP_SETUP.md).'}
        </p>
      </div>
    </div>
  )
}
