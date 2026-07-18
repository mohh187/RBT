// Venue 360° — literally everything about one registered venue: profile,
// subscription control (plan/status/expiry), suspension, sales KPIs, live
// orders, the full staff roster, counts, complaints and its activity log.
// Reads reuse the tenant-scoped watchers in db.js (rules let platform admins through).
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchOrdersSince, watchStaff } from '../../lib/db.js'
import {
  watchTenantDoc, watchActivity, setTenantPlan, setTenantActive, platformUpdateTenant,
  countSub, countOpenComplaints, impersonateTenantOwner,
} from '../../lib/platform.js'
import { PLANS, FEATURE_CATALOG } from '../../lib/plans.js'
import { PlanBadge, StatusChip, fmtWhen, toDateInput, ActivityRow, startOfToday, promptSuspendReason } from './shared.jsx'

const ORDER_STATUS_AR = {
  pending: 'جديد', accepted: 'مقبول', preparing: 'تحضير', ready: 'جاهز',
  paid: 'مدفوع', served: 'مقدَّم', cancelled: 'ملغي', refunded: 'مسترجع',
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

export default function VenueDetail() {
  const { tid } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [tenant, setTenant] = useState(undefined)
  const [orders, setOrders] = useState(null) // last 7 days
  const [staff, setStaff] = useState([])
  const [activity, setActivity] = useState([])
  const [counts, setCounts] = useState({})
  // subscription form
  const [plan, setPlan] = useState('')
  const [planStatus, setPlanStatus] = useState('')
  const [expiry, setExpiry] = useState('')
  const [note, setNote] = useState('')
  const [features, setFeatures] = useState({})
  const [savingSub, setSavingSub] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [toggling, setToggling] = useState(false)

  useEffect(() => watchTenantDoc(tid, setTenant), [tid])
  useEffect(() => watchOrdersSince(tid, daysAgo(7), setOrders), [tid])
  useEffect(() => watchStaff(tid, setStaff), [tid])
  useEffect(() => watchActivity(setActivity, { tenantId: tid, max: 30 }), [tid])
  useEffect(() => {
    Promise.all([
      countSub(tid, 'customers'),
      countSub(tid, 'items'),
      countSub(tid, 'categories'),
      countOpenComplaints(tid),
      countSub(tid, 'materials'),
    ]).then(([customers, items, categories, complaints, materials]) => setCounts({ customers, items, categories, complaints, materials }))
  }, [tid])
  useEffect(() => {
    if (!tenant) return
    setPlan(tenant.plan || 'enterprise')
    setPlanStatus(tenant.planStatus || 'active')
    setExpiry(toDateInput(tenant.planExpiresAt))
    setNote(tenant.platformNote || '')
    setFeatures(tenant.features || {})
  }, [tenant])

  // Order-type split for the last 7 days (surfaces delivery/curbside usage).
  const mix = useMemo(() => {
    const list = (orders || []).filter((o) => o.status !== 'cancelled')
    const c = { dine_in: 0, pickup: 0, delivery: 0, curbside: 0 }
    for (const o of list) {
      if (o.delivery || o.orderType === 'delivery') c.delivery++
      else if (o.orderType === 'curbside') c.curbside++
      else if (o.orderType === 'takeaway' || o.orderType === 'pickup') c.pickup++
      else c.dine_in++
    }
    return c
  }, [orders])

  const kpi = useMemo(() => {
    const list = orders || []
    const ok = (o) => o.status !== 'cancelled'
    const today = list.filter((o) => ok(o) && (o.createdAt?.toDate?.() || 0) >= startOfToday())
    const week = list.filter(ok)
    return {
      todayOrders: today.length,
      todayRevenue: Math.round(today.reduce((s, o) => s + (o.total || 0), 0)),
      weekOrders: week.length,
      weekRevenue: Math.round(week.reduce((s, o) => s + (o.total || 0), 0)),
    }
  }, [orders])

  if (tenant === undefined) return <Spinner />
  if (tenant === null) return <Empty icon="store" title="منشأة غير موجودة" />

  const saveSubscription = async () => {
    if (savingSub) return
    setSavingSub(true)
    try {
      await setTenantPlan(tid, {
        plan,
        planStatus,
        planExpiresAt: expiry ? new Date(expiry + 'T23:59:59') : null,
      })
      toast.success('تم تحديث الاشتراك')
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setSavingSub(false)
    }
  }

  const toggleActive = async () => {
    if (toggling) return
    setToggling(true)
    try {
      if (tenant.active === false) {
        await setTenantActive(tid, true)
        toast.success('تم تفعيل الحساب')
      } else {
        const reason = promptSuspendReason(tenant.name || tid)
        if (reason === null) return
        await setTenantActive(tid, false, reason)
        toast.success('تم إيقاف الحساب')
      }
    } catch {
      toast.error('تعذّر تحديث حالة المنشأة — أعد المحاولة')
    } finally {
      setToggling(false)
    }
  }

  const saveNote = async () => {
    if (savingNote) return
    setSavingNote(true)
    try {
      await platformUpdateTenant(tid, { platformNote: note })
      toast.success('حُفظت الملاحظة')
    } catch {
      toast.error('تعذّر حفظ الملاحظة')
    } finally {
      setSavingNote(false)
    }
  }

  // Per-venue feature override: 'default' follows the plan, 'on'/'off' force it.
  const setFeature = async (key, mode) => {
    const next = { ...features }
    if (mode === 'default') delete next[key]
    else next[key] = mode === 'on'
    setFeatures(next)
    try {
      await platformUpdateTenant(tid, { features: next })
      toast.success('حُدّثت المزايا')
    } catch {
      toast.error('تعذّر الحفظ')
    }
  }

  // Support login: swap this session to the venue owner's account (audited server-side).
  const impersonate = async () => {
    const ok = window.confirm(
      `سيتم تسجيل خروجك من حساب المنصة والدخول بحساب مالك «${tenant.name}» لمعاينة النظام كما يراه تماماً.\nللعودة: سجّل الخروج ثم ادخل بحساب المنصة. متابعة؟`,
    )
    if (!ok) return
    try {
      await impersonateTenantOwner(tid)
      navigate('/admin')
    } catch {
      toast.error('تعذّر الدخول — تأكد من نشر دالة platformImpersonate')
    }
  }

  const currency = tenant.currency || 'SAR'

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      {/* header */}
      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {tenant.logoUrl ? (
          <img src={tenant.logoUrl} alt="" style={{ width: 52, height: 52, borderRadius: 14, objectFit: 'cover' }} />
        ) : (
          <span className="dot" style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--brand)', color: 'var(--on-brand)', display: 'grid', placeItems: 'center' }}>
            <Icon name="store" size={24} />
          </span>
        )}
        <div className="grow">
          <h2 className="page-title" style={{ marginBottom: 2 }}>{tenant.name}</h2>
          <p className="muted small">/{tenant.slug} · {tenant.type || 'cafe'} · انضمت {fmtWhen(tenant.createdAt)}</p>
        </div>
        <PlanBadge plan={tenant.plan} />
        <StatusChip tenant={tenant} />
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Link to={`/platform/chat/${tid}`} className="btn btn-primary"><Icon name="mail" size={16} /> دردشة مع المنشأة</Link>
        <a href={`/m/${tenant.slug}`} target="_blank" rel="noreferrer" className="btn btn-outline"><Icon name="menu" size={16} /> فتح المنيو العام</a>
        <button className="btn btn-outline" onClick={impersonate} title="معاينة النظام بحساب مالك المنشأة (مسجَّل في سجل النشاط)">
          <Icon name="eye" size={16} /> الدخول كمالك
        </button>
        <button className="btn btn-outline" disabled={toggling} style={{ color: tenant.active === false ? 'var(--success)' : 'var(--danger)' }} onClick={toggleActive}>
          <Icon name={tenant.active === false ? 'ok' : 'no'} size={16} /> {tenant.active === false ? 'تفعيل الحساب' : 'إيقاف الحساب'}
        </button>
      </div>

      {tenant.active === false && tenant.suspendReason ? (
        <div className="card card-pad" style={{ borderColor: 'var(--danger)' }}>
          <span className="small bold" style={{ color: 'var(--danger)' }}>سبب الإيقاف: </span>
          <span className="small">{tenant.suspendReason}</span>
        </div>
      ) : null}

      {/* KPIs */}
      <div className="stat-grid">
        <div className="stat"><div className="label">مبيعات اليوم</div><div className="value num">{kpi.todayRevenue.toLocaleString('en-US')} <span className="xs faint">{currency}</span></div></div>
        <div className="stat"><div className="label">طلبات اليوم</div><div className="value num">{kpi.todayOrders}</div></div>
        <div className="stat"><div className="label">مبيعات 7 أيام</div><div className="value num">{kpi.weekRevenue.toLocaleString('en-US')} <span className="xs faint">{currency}</span></div></div>
        <div className="stat"><div className="label">طلبات 7 أيام</div><div className="value num">{kpi.weekOrders}</div></div>
        <div className="stat"><div className="label">العملاء</div><div className="value num">{counts.customers ?? '…'}</div></div>
        <div className="stat"><div className="label">الأصناف</div><div className="value num">{counts.items ?? '…'}</div></div>
        <div className="stat"><div className="label">الموظفون</div><div className="value num">{staff.length}</div></div>
        <div className="stat"><div className="label">شكاوى مفتوحة</div><div className="value num" style={{ color: counts.complaints ? 'var(--danger)' : 'inherit' }}>{counts.complaints ?? '…'}</div></div>
      </div>

      {/* enabled modules + order-type mix (feature awareness) */}
      <div className="card card-pad stack">
        <strong><Icon name="grid" size={16} /> المزايا المُفعّلة وأنواع الطلب</strong>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {[
            ['التوصيل', tenant.delivery?.enabled === true],
            ['استلام السيارة', tenant.curbsideEnabled === true],
            ['ضريبة ZATCA', tenant.vatEnabled === true],
            ['قفل PIN', tenant.pinLock?.enabled === true],
            ['الوضع الأفقي', tenant.cashierLandscape === true],
            ['مخزون ووصفات', (counts.materials || 0) > 0],
          ].map(([label, on]) => (
            <span key={label} className={`badge ${on ? 'badge-success' : ''}`} style={on ? undefined : { opacity: 0.5 }}>
              <Icon name={on ? 'ok' : 'no'} size={12} /> {label}
            </span>
          ))}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          {[['محلي', mix.dine_in], ['سفري', mix.pickup], ['توصيل', mix.delivery], ['استلام سيارة', mix.curbside]].map(([l, n]) => (
            <div key={l} className="stat" style={{ flex: 1, minWidth: 92 }}><div className="label">{l}</div><div className="value num">{n}</div></div>
          ))}
        </div>
        <p className="xs faint">المزايا التشغيلية المُفعّلة + توزيع أنواع الطلب لآخر 7 أيام.</p>
      </div>

      {/* subscription control */}
      <div className="card card-pad stack">
        <strong><Icon name="wallet" size={16} /> التحكم في الاشتراك</strong>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="stack grow" style={{ gap: 4, minWidth: 140 }}>
            <span className="xs faint bold">الباقة</span>
            <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {PLANS.map((p) => <option key={p.id} value={p.id}>{p.ar} ({p.en})</option>)}
            </select>
          </label>
          <label className="stack grow" style={{ gap: 4, minWidth: 140 }}>
            <span className="xs faint bold">حالة الاشتراك</span>
            <select className="input" value={planStatus} onChange={(e) => setPlanStatus(e.target.value)}>
              <option value="active">فعّال</option>
              <option value="trial">تجريبي</option>
              <option value="expired">منتهٍ</option>
            </select>
          </label>
          <label className="stack grow" style={{ gap: 4, minWidth: 140 }}>
            <span className="xs faint bold">تاريخ الانتهاء</span>
            <input type="date" className="input" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </label>
        </div>
        <button className="btn btn-primary" disabled={savingSub} onClick={saveSubscription}><Icon name="check" size={16} /> {savingSub ? 'جارٍ الحفظ…' : 'حفظ الاشتراك'}</button>
        <p className="xs faint">تُسجَّل التغييرات تلقائياً في سجل النشاط وتصل إشعاراتها للطرفين.</p>
      </div>

      {/* per-venue feature control (override plan gating) */}
      <div className="card card-pad stack">
        <strong><Icon name="key" size={16} /> التحكم بالمزايا (تجاوز الباقة)</strong>
        <p className="xs faint">فعّل أو عطّل ميزة لهذه المنشأة تحديداً بغضّ النظر عن باقتها. «افتراضي» = حسب الباقة.</p>
        <div className="divide">
          {FEATURE_CATALOG.map((f) => {
            const st = features[f.key] === true ? 'on' : features[f.key] === false ? 'off' : 'default'
            return (
              <div key={f.key} className="row-between" style={{ padding: '8px 0', gap: 8, flexWrap: 'wrap' }}>
                <div className="grow" style={{ minWidth: 120 }}>
                  <span className="small bold">{f.ar}</span> <span className="xs faint">· {f.tier}</span>
                </div>
                <div className="segmented">
                  {[['default', 'افتراضي'], ['on', 'تشغيل'], ['off', 'إيقاف']].map(([v, l]) => (
                    <button key={v} className={st === v ? 'active' : ''} onClick={() => setFeature(f.key, v)}>{l}</button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* internal note */}
      <div className="card card-pad stack">
        <strong><Icon name="edit" size={16} /> ملاحظة داخلية (لا تراها المنشأة)</strong>
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظات المتابعة، الاتفاقات، حالة التحصيل…" />
        <button className="btn btn-outline" disabled={savingNote} onClick={saveNote}>{savingNote ? 'جارٍ الحفظ…' : 'حفظ الملاحظة'}</button>
      </div>

      {/* staff roster */}
      <div className="card card-pad stack">
        <strong><Icon name="staff" size={16} /> الموظفون ({staff.length})</strong>
        {staff.length === 0 ? (
          <p className="muted small">لا موظفين مسجّلين</p>
        ) : (
          <div className="divide">
            {staff.map((m) => (
              <div key={m.uid} className="row-between" style={{ padding: '8px 0', gap: 8 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small bold">{m.name || m.email || m.uid}</div>
                  <div className="xs faint">{m.email}{m.lastSeenAt ? ` · آخر ظهور ${fmtWhen(m.lastSeenAt)}` : ''}</div>
                </div>
                <span className="badge">{m.role || 'staff'}</span>
                {m.active === false ? <span className="badge badge-danger">موقوف</span> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* recent orders */}
      <div className="card card-pad stack">
        <strong><Icon name="orders" size={16} /> أحدث الطلبات (7 أيام)</strong>
        {!orders || orders.length === 0 ? (
          <p className="muted small">لا طلبات في آخر 7 أيام</p>
        ) : (
          <div className="divide">
            {orders.slice(0, 12).map((o) => (
              <div key={o.id} className="row-between" style={{ padding: '8px 0', gap: 8 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small bold">#{o.code || o.id.slice(0, 5)} · {o.tableLabel || (o.orderType === 'takeaway' ? 'سفري' : 'طلب')}</div>
                  <div className="xs faint">{fmtWhen(o.createdAt)}{o.customerName ? ` · ${o.customerName}` : ''}</div>
                </div>
                <span className="num small bold">{o.total || 0}</span>
                <span className={`badge ${['cancelled', 'refunded'].includes(o.status) ? 'badge-danger' : ['paid', 'served'].includes(o.status) ? 'badge-success' : 'badge-info'}`}>
                  {ORDER_STATUS_AR[o.status] || o.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* venue activity log */}
      <div className="card card-pad stack">
        <strong><Icon name="bellRing" size={16} /> سجل نشاط المنشأة</strong>
        {activity.length === 0 ? (
          <p className="muted small">لا نشاط مسجّل بعد</p>
        ) : (
          <div className="divide">
            {activity.map((a) => <ActivityRow key={a.id} a={a} showTenant={false} />)}
          </div>
        )}
      </div>
    </div>
  )
}
