import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { watchOrdersSince, watchAllReviews, watchItems, watchCategories } from '../../lib/db.js'
import { Price } from '../../components/Riyal.jsx'
import { Spinner } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import LowStockAlert from '../../components/LowStockAlert.jsx'
import { sectionTemplate, templateOptions } from '../../lib/systemTemplates.js'

function Stars({ value = 0, size = 13 }) {
  return (
    <span className="rating" style={{ gap: 2 }} dir="ltr">
      {Array.from({ length: 5 }).map((_, i) => (
        <Icon key={i} name="star" size={size} fill="currentColor" strokeWidth={1.5} style={{ color: i < Math.round(value) ? 'var(--gold)' : 'var(--text-faint)' }} />
      ))}
    </span>
  )
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// ---- «جاهزية النظام» onboarding checklist ----
// Dismissable per device; resurfaces automatically if completeness drops
// below what it was when dismissed (e.g. logo removed, loyalty turned off).
const READY_KEY = 'rbt_ready_dismissed'

function ReadinessCard({ tenant, items, categories, ar }) {
  const [dismissedAt, setDismissedAt] = useState(() => localStorage.getItem(READY_KEY))
  const loaded = items !== null && categories !== null

  const checks = useMemo(() => [
    { id: 'logo', ok: !!tenant?.logoUrl, ar: 'الشعار مرفوع', en: 'Logo uploaded', to: '/admin/settings' },
    { id: 'items', ok: (items || []).length > 0, ar: 'أصناف مضافة', en: 'Items added', to: '/admin/menu' },
    { id: 'cats', ok: (categories || []).length > 0, ar: 'تصنيفات مضافة', en: 'Categories added', to: '/admin/menu' },
    { id: 'maps', ok: !!(tenant?.social?.googleMaps || '').trim(), ar: 'رابط خرائط جوجل', en: 'Google Maps link', to: '/admin/settings' },
    { id: 'loyalty', ok: tenant?.membershipPolicy?.enabled === true, ar: 'الولاء مفعّل', en: 'Loyalty enabled', to: '/admin/settings' },
    { id: 'followup', ok: tenant?.followup?.enabled === true, ar: 'رسالة ما بعد الزيارة', en: 'Post-visit message', to: '/admin/campaigns' },
    // Settings treats an unset flag as ON («!== false»), so mirror that here.
    { id: 'wa', ok: tenant?.customerNotify?.whatsapp !== false, ar: 'إشعارات العملاء واتساب', en: 'WhatsApp customer alerts', to: '/admin/settings' },
    { id: 'vat', optional: true, ok: tenant?.vatEnabled === true, ar: 'الضريبة مفعّلة', en: 'VAT enabled', to: '/admin/settings' },
    { id: 'pay', optional: true, ok: tenant?.onlinePayment?.enabled === true, ar: 'الدفع الإلكتروني', en: 'Online payment', to: '/admin/settings' },
  ], [tenant, items, categories])

  const done = checks.filter((c) => c.ok).length
  const total = checks.length
  const missing = checks.filter((c) => !c.ok)
  const essentialDone = missing.every((c) => c.optional)

  useEffect(() => {
    if (!loaded || dismissedAt === null) return
    if (done < Number(dismissedAt)) {
      localStorage.removeItem(READY_KEY)
      setDismissedAt(null)
    }
  }, [loaded, done, dismissedAt])

  if (!loaded || dismissedAt !== null) return null

  const dismiss = () => {
    localStorage.setItem(READY_KEY, String(done))
    setDismissedAt(String(done))
  }

  // Everything essential is done — collapse to a single green row.
  if (essentialDone) {
    return (
      <div className="card" style={{ padding: 'var(--sp-2) var(--sp-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="ok" size={18} style={{ color: 'var(--success)', flex: 'none' }} />
        <span className="small bold" style={{ color: 'var(--success)', flex: 1, minWidth: 0 }}>{ar ? 'نظامك جاهز بالكامل' : 'Your system is fully ready'}</span>
        <button type="button" className="icon-btn" onClick={dismiss} aria-label="dismiss" title={ar ? 'إخفاء' : 'Dismiss'} style={{ flex: 'none' }}>
          <Icon name="close" size={15} />
        </button>
      </div>
    )
  }

  return (
    <div className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="row-between" style={{ gap: 8 }}>
        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Icon name="zap" size={16} style={{ color: 'var(--brand)', flex: 'none' }} /> {ar ? 'جاهزية النظام' : 'System readiness'}
        </strong>
        <div className="row" style={{ gap: 4, flex: 'none' }}>
          <span className="xs faint">{ar ? `اكتمل ${done} من ${total}` : `${done} of ${total} done`}</span>
          <button type="button" className="icon-btn" onClick={dismiss} aria-label="dismiss" title={ar ? 'إخفاء' : 'Dismiss'}>
            <Icon name="close" size={15} />
          </button>
        </div>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.round((done / total) * 100)}%`, borderRadius: 999, background: 'var(--brand)', transition: 'width .3s ease' }} />
      </div>
      <div className="divide">
        {missing.map((c) => (
          <div key={c.id} className="row-between" style={{ gap: 8, minHeight: 36 }}>
            <span className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', border: '1.5px solid var(--text-faint)', flex: 'none' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ar ? c.ar : c.en}</span>
              {c.optional && <span className="xs faint" style={{ flex: 'none' }}>{ar ? '(اختياري)' : '(optional)'}</span>}
            </span>
            <Link to={c.to} className="xs bold" style={{ color: 'var(--brand)', flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {ar ? 'إعداد' : 'Set up'} <Icon name="next" size={13} />
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { t, lang } = useI18n()
  const { tenantId, tenant } = useAuth()
  const [orders, setOrders] = useState(null)
  const [reviews, setReviews] = useState([])
  // Menu data only feeds the readiness checklist (small collections, cleaned up on unmount).
  const [items, setItems] = useState(null)
  const [categories, setCategories] = useState(null)
  // Dashboard layout template (exec | ops | min) — plan-gated saved default,
  // switchable on the fly for this device.
  const [tpl, setTpl] = useState('exec')
  const currency = tenant?.currency || 'SAR'
  const ar = lang === 'ar'

  useEffect(() => { setTpl(sectionTemplate(tenant, 'dashboard')) }, [tenant])

  useEffect(() => {
    if (!tenantId) return
    const unsub = watchOrdersSince(tenantId, startOfToday(), setOrders)
    return unsub
  }, [tenantId])

  useEffect(() => {
    if (!tenantId) return
    return watchAllReviews(tenantId, setReviews, 30)
  }, [tenantId])

  useEffect(() => {
    if (!tenantId) return
    const unsubItems = watchItems(tenantId, setItems)
    const unsubCats = watchCategories(tenantId, setCategories)
    return () => { unsubItems(); unsubCats() }
  }, [tenantId])

  const avgRating = reviews.length ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1) : null

  const stats = useMemo(() => {
    const list = (orders || []).filter((o) => o.status !== 'cancelled')
    const revenue = list.reduce((s, o) => s + (o.total || 0), 0)
    const count = list.length
    const active = (orders || []).filter((o) => ['pending', 'accepted', 'preparing', 'ready'].includes(o.status)).length
    const avg = count ? revenue / count : 0
    // top items today
    const tally = {}
    list.forEach((o) => (o.items || []).forEach((it) => {
      const key = lang === 'en' && it.nameEn ? it.nameEn : it.nameAr
      tally[key] = (tally[key] || 0) + (it.qty || 1)
    }))
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 5)
    // revenue by hour (exec) + live counts by status (ops)
    const byHour = Array.from({ length: 24 }, (_, h) => ({ h, v: 0 }))
    list.forEach((o) => { const d = o.createdAt?.toDate ? o.createdAt.toDate() : null; if (d) byHour[d.getHours()].v += o.total || 0 })
    const byStatus = { pending: 0, accepted: 0, preparing: 0, ready: 0 }
    ;(orders || []).forEach((o) => { if (byStatus[o.status] !== undefined) byStatus[o.status] += 1 })
    return { revenue, count, active, avg, top, byHour, byStatus }
  }, [orders, lang])

  if (orders === null) return <Spinner />

  const maxHour = Math.max(...stats.byHour.map((x) => x.v), 1)
  const hasHourData = stats.byHour.some((x) => x.v > 0)

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <ReadinessCard tenant={tenant} items={items} categories={categories} ar={ar} />

      <div className="row-between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div>
          <h2 className="page-title">{t('dashboard')}</h2>
          <p className="muted small">{tenant?.name} · {t('today')}</p>
        </div>
        <div className="pos-tpl-switch row" style={{ gap: 2, flex: 'none' }}>
          {templateOptions('dashboard').map((o) => (
            <button key={o.id} type="button" className={`icon-btn ${tpl === o.id ? 'active' : ''}`} title={ar ? `${o.ar}${o.hint ? ' — ' + o.hint : ''}` : o.en} onClick={() => setTpl(o.id)}>
              <Icon name={{ exec: 'reports', ops: 'orders', min: 'home' }[o.id] || 'grid'} size={16} />
            </button>
          ))}
        </div>
      </div>

      {/* ops: live board first — what needs hands now */}
      {tpl === 'ops' && (
        <div className="dash-live">
          {[
            ['pending', ar ? 'بانتظار القبول' : 'Pending', 'warning'],
            ['accepted', ar ? 'مقبولة' : 'Accepted', 'info'],
            ['preparing', ar ? 'قيد التحضير' : 'Preparing', 'brand'],
            ['ready', ar ? 'جاهزة' : 'Ready', 'success'],
          ].map(([st, lbl, clr]) => (
            <Link key={st} to="/admin/orders" className="dash-live-cell" data-tone={clr}>
              <span className="num dash-live-num">{stats.byStatus[st]}</span>
              <span className="xs">{lbl}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="stat-grid">
        <div className="stat">
          <div className="label">{t('todaysSales')}</div>
          <div className="value price"><Price value={stats.revenue} currency={currency} lang={lang} /></div>
        </div>
        <div className="stat">
          <div className="label">{t('todaysOrders')}</div>
          <div className="value num">{stats.count}</div>
        </div>
        <div className="stat">
          <div className="label">{t('avgTicket')}</div>
          <div className="value price"><Price value={stats.avg} currency={currency} lang={lang} /></div>
        </div>
        <div className="stat">
          <div className="label">{lang === 'ar' ? 'طلبات نشطة' : 'Active orders'}</div>
          <div className="value num" style={{ color: stats.active ? 'var(--brand)' : 'var(--text)' }}>{stats.active}</div>
        </div>
      </div>

      {/* exec: today's shape at a glance — pure-CSS hourly bars, no chart lib */}
      {tpl === 'exec' && hasHourData && (
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <strong className="small">{ar ? 'مبيعات اليوم بالساعة' : 'Sales by hour'}</strong>
          <div className="dash-hours" dir="ltr">
            {stats.byHour.map((x) => (
              <div key={x.h} className={`dash-hour ${x.v === maxHour && x.v > 0 ? 'peak' : ''}`} title={`${String(x.h).padStart(2, '0')}:00`}>
                <span style={{ height: `${Math.max(3, Math.round((x.v / maxHour) * 100))}%`, opacity: x.v ? 1 : 0.35 }} />
              </div>
            ))}
          </div>
          <div className="row-between xs faint" dir="ltr"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
        </div>
      )}

      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <Link to="/cashier" className="btn btn-primary grow"><Icon name="cashier" size={18} /> {t('cashier')}</Link>
        <Link to="/admin/items" className="btn btn-outline grow"><Icon name="menu" size={18} /> {t('menu')}</Link>
      </div>

      {tpl !== 'min' && <LowStockAlert />}

      {tpl !== 'min' && (
        <div className="card card-pad stack">
          <strong>{t('topItems')}</strong>
          {stats.top.length === 0 ? (
            <p className="muted small">{lang === 'ar' ? 'لا مبيعات بعد اليوم' : 'No sales yet today'}</p>
          ) : (
            <div className="divide">
              {stats.top.map(([name, qty], i) => (
                <div key={name} className="row-between">
                  <span className="small"><span className="faint">{i + 1}.</span> {name}</span>
                  <span className="badge">{qty}×</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tpl === 'exec' && (
        <div className="card card-pad stack">
          <div className="row-between">
            <strong>{lang === 'ar' ? 'أحدث التقييمات' : 'Recent ratings'}</strong>
            {avgRating && <span className="rating" style={{ gap: 4 }}><Icon name="star" size={15} fill="currentColor" strokeWidth={1.5} /> {avgRating} <span className="faint xs">({reviews.length})</span></span>}
          </div>
          {reviews.length === 0 ? (
            <p className="muted small">{lang === 'ar' ? 'لا تقييمات بعد' : 'No ratings yet'}</p>
          ) : (
            <div className="divide">
              {reviews.slice(0, 6).map((r) => (
                <div key={r.id} className="row-between" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <div className="grow">
                    <div className="small bold">{(lang === 'en' && r.itemNameEn ? r.itemNameEn : r.itemNameAr) || (lang === 'ar' ? 'صنف' : 'Item')}</div>
                    <div className="xs faint">{r.name || (lang === 'ar' ? 'ضيف' : 'Guest')}{r.comment ? ` · ${r.comment}` : ''}</div>
                  </div>
                  <Stars value={r.rating} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tpl !== 'min' && (
        <div className="menu-grid">
          <Link to="/admin/reports" className="card card-pad row"><Icon name="reports" size={24} /><span className="bold">{t('reports')}</span></Link>
          <Link to="/admin/customers" className="card card-pad row"><Icon name="customers" size={24} /><span className="bold">{t('customers')}</span></Link>
          <Link to="/admin/complaints" className="card card-pad row"><Icon name="complaint" size={24} /><span className="bold">{lang === 'ar' ? 'الشكاوى' : 'Complaints'}</span></Link>
          <Link to="/admin/offers" className="card card-pad row"><Icon name="offers" size={24} /><span className="bold">{t('offers')}</span></Link>
        </div>
      )}
    </div>
  )
}
