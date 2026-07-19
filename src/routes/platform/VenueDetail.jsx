// Venue 360° — the complete inspector for one registered venue: identity,
// owner, subscription control (plan/status/expiry/features/AI quotas), staff
// roster + permissions summary, data & content tables, messaging/integrations
// presence (never secret values) and a guarded raw-field editor.
// Organized in lazy tabs: each tab fetches its data on first open only.
// Reads reuse the tenant-scoped watchers in db.js (rules let platform admins
// through via the tenants/{tid}/{document=**} platform-admin match).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  collection, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore'
import { db } from '../../lib/firebase.js'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchOrdersSince, watchStaff } from '../../lib/db.js'
import {
  watchTenantDoc, watchActivity, setTenantPlan, setTenantActive, platformUpdateTenant,
  impersonateTenantOwner, fetchRecentSub,
} from '../../lib/platform.js'
import { PLANS, FEATURE_CATALOG } from '../../lib/plans.js'
import { PLATFORM_APEX } from '../../lib/domains.js'
import { PlanBadge, StatusChip, fmtWhen, toDateInput, ActivityRow, startOfToday, promptSuspendReason } from './shared.jsx'

const ORDER_STATUS_AR = {
  pending: 'جديد', accepted: 'مقبول', preparing: 'تحضير', ready: 'جاهز',
  paid: 'مدفوع', served: 'مقدَّم', cancelled: 'ملغي', refunded: 'مسترجع',
}

const TABS = [
  { id: 'overview', ar: 'نظرة عامة', icon: 'home' },
  { id: 'plan', ar: 'الاشتراك والباقة', icon: 'wallet' },
  { id: 'team', ar: 'الفريق والصلاحيات', icon: 'staff' },
  { id: 'data', ar: 'البيانات والمحتوى', icon: 'orders' },
  { id: 'comms', ar: 'الرسائل والتكاملات', icon: 'mail' },
  { id: 'advanced', ar: 'تحكم متقدم', icon: 'wrench' },
]

// Known venue-branded message templates (keys only — content stays in the venue).
const MSG_TEMPLATE_AR = {
  orderStatus: 'حالة الطلب', receipt: 'إيصال الطلب', welcome: 'ترحيب بعميل جديد',
  upgrade: 'ترقية مستوى الولاء', birthday: 'تهنئة عيد الميلاد', offers: 'تنبيه العروض',
  featured: 'الصنف المميز', newItems: 'الأصناف الجديدة',
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

// Server-side aggregation count with a graceful fallback to a capped snapshot
// size (older SDK / rules edge). Returns null when both fail (rendered as «—»).
async function countAgg(q, fallbackQ) {
  try {
    return (await getCountFromServer(q)).data().count
  } catch {
    try {
      return (await getDocs(fallbackQ)).size
    } catch {
      return null
    }
  }
}
function countCol(tid, name, ...clauses) {
  const col = collection(db, 'tenants', tid, name)
  return countAgg(
    clauses.length ? query(col, ...clauses) : query(col),
    query(col, ...clauses, limit(1000)),
  )
}
function countScreens(tid) {
  const q = query(collection(db, 'screens'), where('tid', '==', tid))
  return countAgg(q, q)
}

// One-shot fetch cached per venue for the session — a tab loads its data on
// first open only; returning to the tab reuses the cache (no refetch storm).
function useCached(cache, key, fetcher) {
  const fnRef = useRef(fetcher)
  fnRef.current = fetcher
  const [value, setValue] = useState(() => cache.current[key])
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (cache.current[key] !== undefined) { setValue(cache.current[key]); return undefined }
    let on = true
    fnRef.current()
      .then((v) => { if (!on) return; cache.current[key] = v; setValue(v) })
      .catch(() => { if (on) setFailed(true) })
    return () => { on = false }
  }, [cache, key])
  return [value, failed]
}

function Skeleton({ rows = 3, h = 38 }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: h }} />)}
    </div>
  )
}

function Section({ icon, title, children, danger }) {
  return (
    <div className={`card card-pad stack ${danger ? 'v360-danger-card' : ''}`}>
      <strong><Icon name={icon} size={16} /> {title}</strong>
      {children}
    </div>
  )
}

function KV({ k, v, ltr }) {
  return (
    <div className="row-between" style={{ gap: 10, padding: '4px 0', flexWrap: 'wrap' }}>
      <span className="xs faint bold" style={{ flex: 'none' }}>{k}</span>
      <span className={ltr ? 'v360-mono' : 'small'} style={{ textAlign: 'start', wordBreak: 'break-word' }}>{v ?? '—'}</span>
    </div>
  )
}

const fmtNum = (v) => (v === undefined ? '…' : v === null ? '—' : Number(v).toLocaleString('en-US'))

// ============================== نظرة عامة ==============================
function OverviewTab({ tid, tenant, cache }) {
  const [orders, setOrders] = useState(null) // last 7 days, live
  const [activity, setActivity] = useState(null)
  useEffect(() => watchOrdersSince(tid, daysAgo(7), setOrders), [tid])
  useEffect(() => watchActivity(setActivity, { tenantId: tid, max: 15 }), [tid])

  const [counts, countsFailed] = useCached(cache, `${tid}:counts`, async () => {
    const [items, categories, orders30, customers, staffN, screens, stories, complaintsOpen, materials] = await Promise.all([
      countCol(tid, 'items'),
      countCol(tid, 'categories'),
      countCol(tid, 'orders', where('createdAt', '>=', daysAgo(30))),
      countCol(tid, 'customers'),
      countCol(tid, 'staff'),
      countScreens(tid),
      countCol(tid, 'stories'),
      countCol(tid, 'complaints', where('status', '==', 'open')),
      countCol(tid, 'materials'),
    ])
    return { items, categories, orders30, customers, staffN, screens, stories, complaintsOpen, materials }
  })

  const [owner, ownerFailed] = useCached(cache, `${tid}:owner`, async () => {
    if (!tenant.ownerUid) return null
    const s = await getDoc(doc(db, 'users', tenant.ownerUid))
    return s.exists() ? { id: s.id, ...s.data() } : null
  })

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

  const currency = tenant.currency || 'SAR'

  return (
    <>
      {/* live sales KPIs (7-day realtime watch) */}
      {orders === null ? <Skeleton rows={1} h={82} /> : (
        <div className="stat-grid">
          <div className="stat"><div className="label">مبيعات اليوم</div><div className="value num">{kpi.todayRevenue.toLocaleString('en-US')} <span className="xs faint">{currency}</span></div></div>
          <div className="stat"><div className="label">طلبات اليوم</div><div className="value num">{kpi.todayOrders}</div></div>
          <div className="stat"><div className="label">مبيعات 7 أيام</div><div className="value num">{kpi.weekRevenue.toLocaleString('en-US')} <span className="xs faint">{currency}</span></div></div>
          <div className="stat"><div className="label">طلبات 7 أيام</div><div className="value num">{kpi.weekOrders}</div></div>
        </div>
      )}

      {/* headline counts (server aggregation, on demand) */}
      <Section icon="chartBar" title="أرقام إجمالية">
        {countsFailed ? (
          <p className="small" style={{ color: 'var(--danger)' }}>تعذّر تحميل العدادات — أعد فتح التبويب</p>
        ) : (
          <div className="stat-grid">
            <div className="stat"><div className="label">الأصناف</div><div className="value num">{fmtNum(counts?.items)}</div></div>
            <div className="stat"><div className="label">التصنيفات</div><div className="value num">{fmtNum(counts?.categories)}</div></div>
            <div className="stat"><div className="label">طلبات 30 يوماً</div><div className="value num">{fmtNum(counts?.orders30)}</div></div>
            <div className="stat"><div className="label">العملاء</div><div className="value num">{fmtNum(counts?.customers)}</div></div>
            <div className="stat"><div className="label">الموظفون</div><div className="value num">{fmtNum(counts?.staffN)}</div></div>
            <div className="stat"><div className="label">شاشات العرض</div><div className="value num">{fmtNum(counts?.screens)}</div></div>
            <div className="stat"><div className="label">القصص</div><div className="value num">{fmtNum(counts?.stories)}</div></div>
            <div className="stat"><div className="label">شكاوى مفتوحة</div><div className="value num" style={{ color: counts?.complaintsOpen ? 'var(--danger)' : 'inherit' }}>{fmtNum(counts?.complaintsOpen)}</div></div>
          </div>
        )}
      </Section>

      <div className="v360-cols">
        {/* identity */}
        <Section icon="store" title="الهوية">
          <div>
            <KV k="الاسم" v={tenant.name} />
            <KV k="الرابط العام" v={<a href={`/m/${tenant.slug}`} target="_blank" rel="noreferrer">/m/{tenant.slug}</a>} />
            <KV k="النوع" v={tenant.type || 'cafe'} />
            <KV k="العملة" v={currency} />
            <KV k="الانضمام" v={fmtWhen(tenant.createdAt)} />
            <KV k="النطاق الفرعي" v={`${tenant.slug}.${PLATFORM_APEX}`} ltr />
            <KV k="المعرّف" v={tid} ltr />
          </div>
        </Section>

        {/* owner (users collection) */}
        <Section icon="user" title="المالك">
          {!tenant.ownerUid ? (
            <p className="muted small">لا مالك مرتبط بهذه المنشأة (ownerUid فارغ)</p>
          ) : ownerFailed ? (
            <p className="small" style={{ color: 'var(--danger)' }}>تعذّر قراءة ملف المالك</p>
          ) : owner === undefined ? (
            <Skeleton rows={3} h={22} />
          ) : owner === null ? (
            <p className="muted small">لا يوجد ملف مستخدم لهذا المالك في users</p>
          ) : (
            <div>
              <KV k="الاسم" v={owner.name || owner.displayName || '—'} />
              <KV k="البريد" v={owner.email || '—'} ltr />
              <KV k="الجوال" v={owner.phone || '—'} ltr />
              <KV k="الدور" v={owner.role || '—'} />
              <KV k="آخر دخول" v={owner.lastLoginAt ? fmtWhen(owner.lastLoginAt) : owner.lastSeenAt ? fmtWhen(owner.lastSeenAt) : '—'} />
              <KV k="UID" v={tenant.ownerUid} ltr />
            </div>
          )}
        </Section>
      </div>

      {/* enabled modules + order-type mix (feature awareness) */}
      <Section icon="grid" title="المزايا المُفعّلة وأنواع الطلب">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {[
            ['التوصيل', tenant.delivery?.enabled === true],
            ['استلام السيارة', tenant.curbsideEnabled === true],
            ['ضريبة ZATCA', tenant.vatEnabled === true],
            ['قفل PIN', tenant.pinLock?.enabled === true],
            ['الوضع الأفقي', tenant.cashierLandscape === true],
            ['مخزون ووصفات', (counts?.materials || 0) > 0],
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
      </Section>

      {/* venue activity log */}
      <Section icon="bellRing" title="سجل نشاط المنشأة">
        {activity === null ? (
          <Skeleton rows={3} h={30} />
        ) : activity.length === 0 ? (
          <p className="muted small">لا نشاط مسجّل بعد</p>
        ) : (
          <div className="divide">
            {activity.map((a) => <ActivityRow key={a.id} a={a} showTenant={false} />)}
          </div>
        )}
      </Section>
    </>
  )
}

// ============================== الاشتراك والباقة ==============================
function PlanTab({ tid, tenant, toast, toggleActive, toggling }) {
  const [plan, setPlan] = useState(tenant.plan || 'enterprise')
  const [planStatus, setPlanStatus] = useState(tenant.planStatus || 'active')
  const [expiry, setExpiry] = useState(toDateInput(tenant.planExpiresAt))
  const [features, setFeatures] = useState(tenant.features || {})
  const [note, setNote] = useState(tenant.platformNote || '')
  const [aiDaily, setAiDaily] = useState(String(Number(tenant.aiLimits?.daily) || 60))
  const [aiMonthly, setAiMonthly] = useState(String(Number(tenant.aiLimits?.monthly) || 900))
  const [aiExtra, setAiExtra] = useState(String(Number(tenant.aiExtra) || 0))
  const [ar3dCap, setAr3dCap] = useState(String(Number(tenant.ar3dMonthly) || 20))
  const [suspendText, setSuspendText] = useState(tenant.suspendReason || '')
  const [savingSub, setSavingSub] = useState(false)
  const [savingAi, setSavingAi] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [savingReason, setSavingReason] = useState(false)

  // Writes send ONLY the changed keys.
  const saveSubscription = async () => {
    if (savingSub) return
    const patch = {}
    if (plan !== (tenant.plan || 'enterprise')) patch.plan = plan
    if (planStatus !== (tenant.planStatus || 'active')) patch.planStatus = planStatus
    if (expiry !== toDateInput(tenant.planExpiresAt)) patch.planExpiresAt = expiry ? new Date(expiry + 'T23:59:59') : null
    if (!Object.keys(patch).length) { toast.success('لا توجد تغييرات للحفظ'); return }
    setSavingSub(true)
    try {
      await setTenantPlan(tid, patch)
      toast.success('تم تحديث الاشتراك')
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setSavingSub(false)
    }
  }

  const saveAi = async () => {
    if (savingAi) return
    const curD = Number(tenant.aiLimits?.daily) || 60
    const curM = Number(tenant.aiLimits?.monthly) || 900
    const curX = Number(tenant.aiExtra) || 0
    const nextD = Math.max(0, Number(aiDaily) || 0)
    const nextM = Math.max(0, Number(aiMonthly) || 0)
    const nextX = Math.max(0, Number(aiExtra) || 0)
    const curA = Number(tenant.ar3dMonthly) || 20
    const nextA = Math.max(0, Number(ar3dCap) || 0)
    const patch = {}
    if (nextD !== curD || nextM !== curM) patch.aiLimits = { daily: nextD, monthly: nextM }
    if (nextX !== curX) patch.aiExtra = nextX
    if (nextA !== curA) patch.ar3dMonthly = nextA
    if (!Object.keys(patch).length) { toast.success('لا توجد تغييرات للحفظ'); return }
    setSavingAi(true)
    try {
      await platformUpdateTenant(tid, patch)
      toast.success('حُدّثت حدود الذكاء')
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setSavingAi(false)
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

  const saveReason = async () => {
    if (savingReason) return
    setSavingReason(true)
    try {
      await platformUpdateTenant(tid, { suspendReason: suspendText.trim() })
      toast.success('حُفظ سبب الإيقاف')
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setSavingReason(false)
    }
  }

  return (
    <>
      {/* subscription control */}
      <Section icon="wallet" title="التحكم في الاشتراك">
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
      </Section>

      {/* account active state + suspend reason */}
      <Section icon="lock" title="حالة الحساب">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusChip tenant={tenant} />
          <button className="btn btn-outline" disabled={toggling} style={{ color: tenant.active === false ? 'var(--success)' : 'var(--danger)' }} onClick={toggleActive}>
            <Icon name={tenant.active === false ? 'ok' : 'no'} size={16} /> {tenant.active === false ? 'تفعيل الحساب' : 'إيقاف الحساب'}
          </button>
        </div>
        {tenant.active === false && (
          <>
            <label className="stack" style={{ gap: 4 }}>
              <span className="xs faint bold">سبب الإيقاف (يظهر للمنشأة)</span>
              <input className="input" value={suspendText} onChange={(e) => setSuspendText(e.target.value)} placeholder="تجميد إداري من المنصة" />
            </label>
            <button className="btn btn-outline" disabled={savingReason} onClick={saveReason}>{savingReason ? 'جارٍ الحفظ…' : 'حفظ السبب'}</button>
          </>
        )}
      </Section>

      {/* AI usage quotas */}
      <Section icon="sparkles" title="حدود المساعد الذكي">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="stack grow" style={{ gap: 4, minWidth: 120 }}>
            <span className="xs faint bold">يومياً</span>
            <input type="number" min="0" className="input num" value={aiDaily} onChange={(e) => setAiDaily(e.target.value)} />
          </label>
          <label className="stack grow" style={{ gap: 4, minWidth: 120 }}>
            <span className="xs faint bold">شهرياً</span>
            <input type="number" min="0" className="input num" value={aiMonthly} onChange={(e) => setAiMonthly(e.target.value)} />
          </label>
          <label className="stack grow" style={{ gap: 4, minWidth: 120 }}>
            <span className="xs faint bold">رصيد إضافي مشترى</span>
            <input type="number" min="0" className="input num" value={aiExtra} onChange={(e) => setAiExtra(e.target.value)} />
          </label>
          <label className="stack grow" style={{ gap: 4, minWidth: 120 }}>
            <span className="xs faint bold">مجسمات 3D شهرياً</span>
            <input type="number" min="0" className="input num" value={ar3dCap} onChange={(e) => setAr3dCap(e.target.value)} />
          </label>
        </div>
        <button className="btn btn-outline" disabled={savingAi} onClick={saveAi}>{savingAi ? 'جارٍ الحفظ…' : 'حفظ حدود الذكاء'}</button>
        <p className="xs faint">الافتراضي 60 يومياً / 900 شهرياً. الرصيد الإضافي يُضاف للحد الشهري بعد شراء المنشأة باقة رصيد. مجسمات 3D: حد التحويلات الواقعية الشهري (الافتراضي 20 — كل تحويل يستهلك رصيد Meshy المدفوع من المنصة، وحد كل صنف تحويلان شهرياً مفروض على الخادم).</p>
      </Section>

      {/* per-venue feature control (override plan gating) */}
      <Section icon="key" title="التحكم بالمزايا (تجاوز الباقة)">
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
      </Section>

      {/* internal note */}
      <Section icon="edit" title="ملاحظة داخلية (لا تراها المنشأة)">
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظات المتابعة، الاتفاقات، حالة التحصيل…" />
        <button className="btn btn-outline" disabled={savingNote} onClick={saveNote}>{savingNote ? 'جارٍ الحفظ…' : 'حفظ الملاحظة'}</button>
      </Section>
    </>
  )
}

// ============================== الفريق والصلاحيات ==============================
function TeamTab({ tid, tenant }) {
  const [staff, setStaff] = useState(null)
  useEffect(() => watchStaff(tid, setStaff), [tid])
  const roleCaps = tenant.roleCaps || {}
  const roleEntries = Object.entries(roleCaps)

  return (
    <>
      <Section icon="staff" title={`الموظفون (${staff ? staff.length : '…'})`}>
        {staff === null ? (
          <Skeleton rows={4} h={44} />
        ) : staff.length === 0 ? (
          <p className="muted small">لا موظفين مسجّلين</p>
        ) : (
          <div className="divide">
            {staff.map((m) => (
              <div key={m.uid} className="row-between" style={{ padding: '8px 0', gap: 8, flexWrap: 'wrap' }}>
                <div className="grow" style={{ minWidth: 140 }}>
                  <div className="small bold">
                    {m.name || m.email || m.uid}
                    {m.uid === tenant.ownerUid ? <span className="badge badge-gold" style={{ marginInlineStart: 6 }}>المالك</span> : null}
                  </div>
                  <div className="xs faint">{m.email || ''}{m.lastSeenAt ? ` · آخر ظهور ${fmtWhen(m.lastSeenAt)}` : ''}</div>
                </div>
                <span className="badge">{m.role || 'staff'}</span>
                <span className="badge badge-info">
                  {Array.isArray(m.caps) ? `${m.caps.length} صلاحية${m.capsCustom ? ' (مخصّص)' : ''}` : 'افتراضي الدور'}
                </span>
                {m.active === false ? <span className="badge badge-danger">موقوف</span> : null}
              </div>
            ))}
          </div>
        )}
        <p className="xs faint">عرض فقط — تعديل الأدوار والصلاحيات التفصيلي يتم من لوحة المنشأة نفسها (الإدارة ← الأدوار) أو عبر «الدخول كمالك».</p>
      </Section>

      <div className="v360-cols">
        <Section icon="user" title="مالك الحساب">
          <div>
            <KV k="UID" v={tenant.ownerUid || '—'} ltr />
          </div>
          <p className="xs faint">بطاقة المالك الكاملة في تبويب «نظرة عامة».</p>
        </Section>

        <Section icon="key" title="تخصيص صلاحيات الأدوار (roleCaps)">
          {roleEntries.length === 0 ? (
            <p className="muted small">لا تخصيص — تعمل المنشأة بافتراضيات أدوار النظام</p>
          ) : (
            <div>
              {roleEntries.map(([role, caps]) => (
                <KV key={role} k={role} v={`${Array.isArray(caps) ? caps.length : 0} صلاحية مخصّصة`} />
              ))}
            </div>
          )}
        </Section>
      </div>
    </>
  )
}

// ============================== البيانات والمحتوى ==============================
function DataTab({ tid, tenant, cache }) {
  const [recentOrders] = useCached(cache, `${tid}:recentOrders`, () => fetchRecentSub(tid, 'orders', 'createdAt', 10))
  const [recentCustomers] = useCached(cache, `${tid}:recentCustomers`, () => fetchRecentSub(tid, 'customers', 'lastOrderAt', 10))
  const [catRows, catsFailed] = useCached(cache, `${tid}:catCounts`, async () => {
    const s = await getDocs(query(collection(db, 'tenants', tid, 'categories'), orderBy('sortOrder', 'asc'), limit(15)))
    const cats = s.docs.map((d) => ({ id: d.id, ...d.data() }))
    const nums = await Promise.all(cats.map((c) => countCol(tid, 'items', where('categoryId', '==', c.id))))
    return cats.map((c, i) => ({ ...c, count: nums[i] }))
  })
  const [invoices, invoicesFailed] = useCached(cache, `${tid}:invoices`, async () => {
    // Single equality + client-side sort → no composite index needed.
    const s = await getDocs(query(collection(db, 'platformInvoices'), where('tenantId', '==', tid), limit(50)))
    const rows = s.docs.map((d) => ({ id: d.id, ...d.data() }))
    rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    return rows
  })
  const currency = tenant.currency || 'SAR'
  const adminHint = <p className="xs faint">عرض فقط — للتحرير استخدم «الدخول كمالك» لفتح النظام كمدير.</p>

  return (
    <>
      <Section icon="orders" title="أحدث 10 طلبات">
        {recentOrders === undefined ? <Skeleton rows={4} h={40} /> : recentOrders.length === 0 ? (
          <p className="muted small">لا طلبات بعد</p>
        ) : (
          <div className="divide">
            {recentOrders.map((o) => (
              <div key={o.id} className="row-between" style={{ padding: '8px 0', gap: 8 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small bold">#{o.code || o.id.slice(0, 5)} · {o.tableLabel || (o.orderType === 'takeaway' ? 'سفري' : 'طلب')}</div>
                  <div className="xs faint">{fmtWhen(o.createdAt)}{o.customerName ? ` · ${o.customerName}` : ''}</div>
                </div>
                <span className="num small bold">{(o.total || 0).toLocaleString('en-US')} <span className="xs faint">{currency}</span></span>
                <span className={`badge ${['cancelled', 'refunded'].includes(o.status) ? 'badge-danger' : ['paid', 'served'].includes(o.status) ? 'badge-success' : 'badge-info'}`}>
                  {ORDER_STATUS_AR[o.status] || o.status}
                </span>
              </div>
            ))}
          </div>
        )}
        {adminHint}
      </Section>

      <div className="v360-cols">
        <Section icon="customers" title="أحدث العملاء">
          {recentCustomers === undefined ? <Skeleton rows={4} h={36} /> : recentCustomers.length === 0 ? (
            <p className="muted small">لا عملاء بعد (أو لا حقل lastOrderAt)</p>
          ) : (
            <div className="divide">
              {recentCustomers.map((c) => (
                <div key={c.id} className="row-between" style={{ padding: '7px 0', gap: 8 }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="small bold">{c.name || c.phone || c.id}</div>
                    <div className="xs faint" dir="ltr" style={{ textAlign: 'end' }}>{c.phone || ''}</div>
                  </div>
                  <span className="xs faint num">{c.lastOrderAt ? fmtWhen(c.lastOrderAt) : ''}</span>
                </div>
              ))}
            </div>
          )}
          {adminHint}
        </Section>

        <Section icon="categories" title="الأصناف حسب التصنيف">
          {catsFailed ? (
            <p className="small" style={{ color: 'var(--danger)' }}>تعذّر تحميل التصنيفات</p>
          ) : catRows === undefined ? <Skeleton rows={4} h={30} /> : catRows.length === 0 ? (
            <p className="muted small">لا تصنيفات بعد</p>
          ) : (
            <div>
              {catRows.map((c) => (
                <KV key={c.id} k={c.nameAr || c.name || c.id} v={`${fmtNum(c.count)} صنف`} />
              ))}
              <p className="xs faint">أول 15 تصنيفاً حسب الترتيب.</p>
            </div>
          )}
          {adminHint}
        </Section>
      </div>

      <Section icon="receipt" title="فواتير الاشتراك (المنصة)">
        {invoicesFailed ? (
          <p className="small" style={{ color: 'var(--danger)' }}>تعذّر تحميل الفواتير</p>
        ) : invoices === undefined ? <Skeleton rows={3} h={40} /> : invoices.length === 0 ? (
          <p className="muted small">لا فواتير لهذه المنشأة</p>
        ) : (
          <div className="divide">
            {invoices.map((inv) => (
              <div key={inv.id} className="row-between" style={{ padding: '8px 0', gap: 8, flexWrap: 'wrap' }}>
                <div className="grow" style={{ minWidth: 120 }}>
                  <div className="small bold num">{inv.period || '—'} · {(PLANS.find((p) => p.id === inv.plan)?.ar) || inv.plan || ''}</div>
                  <div className="xs faint">{fmtWhen(inv.createdAt)}{inv.source ? ` · ${inv.source === 'manual' ? 'يدوية' : inv.source}` : ''}</div>
                </div>
                <span className="num small bold">{(Number(inv.amount) || 0).toLocaleString('en-US')} <span className="xs faint">{inv.currency || 'SAR'}</span></span>
                <span className={`badge ${inv.status === 'paid' ? 'badge-success' : 'badge-danger'}`}>{inv.status === 'paid' ? 'مدفوعة' : 'غير مدفوعة'}</span>
              </div>
            ))}
          </div>
        )}
        <p className="xs faint">الإدارة الكاملة للفواتير من شاشة «الفواتير» في المنصة. <Link to="/platform/billing">فتح الفواتير</Link></p>
      </Section>
    </>
  )
}

// ============================== الرسائل والتكاملات ==============================
function CommsTab({ tid, tenant, cache, toast }) {
  const monthKey = new Date().toLocaleDateString('en-CA').slice(0, 7)
  const monthSent = tenant.msgsSent?.period === monthKey ? (Number(tenant.msgsSent?.count) || 0) : 0
  const cap = Number(tenant.msgCapMonthly) || 2000
  const [capEdit, setCapEdit] = useState(String(Number(tenant.msgCapMonthly) || 2000))
  const [savingCap, setSavingCap] = useState(false)
  const tpl = tenant.msgTemplates || {}
  const extraTplKeys = Object.keys(tpl).filter((k) => !(k in MSG_TEMPLATE_AR))

  const [domains, domainsFailed] = useCached(cache, `${tid}:domains`, async () => {
    const s = await getDocs(query(collection(db, 'domains'), where('tenantId', '==', tid)))
    return s.docs.map((d) => ({ id: d.id, ...d.data() }))
  })

  // PRESENCE ONLY: we read tenants/{tid}/private to list doc ids + key NAMES.
  // Secret values are never rendered anywhere in this screen.
  const [priv, privFailed] = useCached(cache, `${tid}:private`, async () => {
    const s = await getDocs(collection(db, 'tenants', tid, 'private'))
    return s.docs.map((d) => ({ id: d.id, keys: Object.keys(d.data()).filter((k) => k !== 'updatedAt').sort() }))
  })

  const saveCap = async () => {
    if (savingCap) return
    const next = Math.max(0, Number(capEdit) || 0)
    if (next === (Number(tenant.msgCapMonthly) || 2000)) { toast.success('لا توجد تغييرات للحفظ'); return }
    setSavingCap(true)
    try {
      await platformUpdateTenant(tid, { msgCapMonthly: next })
      toast.success('حُدّث سقف الرسائل')
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setSavingCap(false)
    }
  }

  const waDoc = (priv || []).find((d) => d.id === 'wa')
  const otherPriv = (priv || []).filter((d) => d.id !== 'wa')
  const pct = Math.min(100, cap ? (monthSent / cap) * 100 : 0)

  return (
    <>
      <Section icon="message" title="رسائل واتساب (العدّاد والسقف)">
        <div className="row-between small"><span>المرسل هذا الشهر ({monthKey})</span><strong className="num">{monthSent.toLocaleString('en-US')} / {cap.toLocaleString('en-US')}</strong></div>
        <div className="v360-bar"><div style={{ width: `${pct}%`, background: monthSent >= cap ? 'var(--danger)' : 'var(--brand)' }} /></div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="stack grow" style={{ gap: 4, minWidth: 140 }}>
            <span className="xs faint bold">السقف الشهري (msgCapMonthly)</span>
            <input type="number" min="0" className="input num" value={capEdit} onChange={(e) => setCapEdit(e.target.value)} />
          </label>
          <button className="btn btn-outline" disabled={savingCap} onClick={saveCap}>{savingCap ? 'جارٍ الحفظ…' : 'حفظ السقف'}</button>
        </div>
      </Section>

      <div className="v360-cols">
        <Section icon="file" title="قوالب الرسائل (الأسماء فقط)">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(MSG_TEMPLATE_AR).map(([key, ar]) => {
              const set = typeof tpl[key] === 'string' && tpl[key].trim().length > 0
              return (
                <span key={key} className={`badge ${set ? 'badge-success' : ''}`} style={set ? undefined : { opacity: 0.5 }}>
                  <Icon name={set ? 'ok' : 'no'} size={12} /> {ar} <span className="v360-mono" style={{ fontSize: 10 }}>{key}</span>
                </span>
              )
            })}
            {extraTplKeys.map((k) => (
              <span key={k} className="badge badge-info"><span className="v360-mono" style={{ fontSize: 10 }}>{k}</span></span>
            ))}
          </div>
          <p className="xs faint">«مخصّص» يعني أن المنشأة كتبت نص قالبها؛ غير ذلك يُستخدم النص الافتراضي. محتوى القوالب لا يُعرض هنا.</p>
        </Section>

        <Section icon="pin" title="النطاقات">
          <div>
            <KV k="الرابط العام" v={<a href={`/m/${tenant.slug}`} target="_blank" rel="noreferrer">/m/{tenant.slug}</a>} />
            <KV k="الفرعي التلقائي" v={`${tenant.slug}.${PLATFORM_APEX}`} ltr />
          </div>
          {domainsFailed ? (
            <p className="small" style={{ color: 'var(--danger)' }}>تعذّر تحميل النطاقات</p>
          ) : domains === undefined ? <Skeleton rows={2} h={26} /> : domains.length === 0 ? (
            <p className="muted small">لا نطاقات مرتبطة من شاشة النطاقات</p>
          ) : (
            <div className="divide">
              {domains.map((d) => (
                <div key={d.id} className="row-between" style={{ padding: '6px 0', gap: 8 }}>
                  <span className="v360-mono grow">{d.id}</span>
                  <span className="badge">{d.type === 'subdomain' ? 'فرعي' : 'خاص'}</span>
                  <span className={`badge ${d.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{d.status === 'active' ? 'نشط' : 'قيد التفعيل'}</span>
                </div>
              ))}
            </div>
          )}
          <p className="xs faint"><Link to="/platform/domains">إدارة النطاقات من شاشة النطاقات</Link></p>
        </Section>
      </div>

      <Section icon="key" title="التكاملات السرّية (وجود فقط — بلا قيم)">
        {privFailed ? (
          <p className="small" style={{ color: 'var(--danger)' }}>تعذّر قراءة إعدادات التكاملات</p>
        ) : priv === undefined ? <Skeleton rows={2} h={30} /> : (
          <div>
            <div className="row-between" style={{ padding: '6px 0', gap: 8, flexWrap: 'wrap' }}>
              <span className="small bold">واتساب خاص بالمنشأة (wa)</span>
              <span className={`badge ${waDoc ? 'badge-success' : ''}`} style={waDoc ? undefined : { opacity: 0.5 }}>
                <Icon name={waDoc ? 'ok' : 'no'} size={12} /> {waDoc ? 'مضبوط' : 'غير مضبوط'}
              </span>
            </div>
            {waDoc && waDoc.keys.length > 0 && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {waDoc.keys.map((k) => <span key={k} className="badge badge-info"><span className="v360-mono" style={{ fontSize: 10 }}>{k}</span></span>)}
              </div>
            )}
            {otherPriv.map((d) => (
              <div key={d.id} className="row-between" style={{ padding: '6px 0', gap: 8, flexWrap: 'wrap' }}>
                <span className="small bold v360-mono">{d.id}</span>
                <span className="badge badge-success"><Icon name="ok" size={12} /> مضبوط ({d.keys.length} حقل)</span>
              </div>
            ))}
            <div className="row-between" style={{ padding: '6px 0', gap: 8, flexWrap: 'wrap' }}>
              <span className="small bold">بوابة الدفع (Moyasar)</span>
              <span className="badge badge-info">مفاتيح على مستوى المنصة — لا مفاتيح خاصة بالمنشأة</span>
            </div>
          </div>
        )}
        <p className="xs faint">تُعرض أسماء الحقول فقط للتأكد من الضبط — القيم السرّية لا تُقرأ ولا تُعرض في هذه الشاشة إطلاقاً.</p>
      </Section>
    </>
  )
}

// ============================== تحكم متقدم ==============================
function AdvancedTab({ tid, tenant, toast, impersonate, toggleActive, toggling }) {
  const keys = useMemo(() => Object.keys(tenant).filter((k) => k !== 'id').sort(), [tenant])
  const [sel, setSel] = useState('')
  const [json, setJson] = useState('')
  const [jsonErr, setJsonErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newJson, setNewJson] = useState('')
  const [newErr, setNewErr] = useState('')

  const pick = (k) => {
    setSel(k)
    setJsonErr('')
    setJson(k ? JSON.stringify(tenant[k] === undefined ? null : tenant[k], null, 2) : '')
  }

  const parseJson = (text) => {
    if (!String(text).trim()) return { error: 'القيمة فارغة — اكتب JSON صالحاً (مثال: true أو "نص" أو {"a":1})' }
    try {
      return { value: JSON.parse(text) }
    } catch (e) {
      return { error: 'JSON غير صالح: ' + (e?.message || '') }
    }
  }

  const saveSel = async () => {
    if (!sel || busy) return
    const p = parseJson(json)
    if (p.error) { setJsonErr(p.error); return }
    const ok = window.confirm(`كتابة مباشرة على الحقل «${sel}» في وثيقة «${tenant.name || tid}».\nهذا إجراء خطر: قيمة غير متوقعة قد تعطّل النظام لدى المنشأة. متابعة؟`)
    if (!ok) return
    setBusy(true)
    try {
      await platformUpdateTenant(tid, { [sel]: p.value })
      toast.success(`حُفظ الحقل ${sel}`)
      setJsonErr('')
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setBusy(false)
    }
  }

  const saveNew = async () => {
    if (busy) return
    const k = newKey.trim()
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k)) { setNewErr('اسم الحقل يجب أن يبدأ بحرف لاتيني ويحتوي حروفاً/أرقاماً/شرطة سفلية فقط') ; return }
    const p = parseJson(newJson)
    if (p.error) { setNewErr(p.error); return }
    const exists = k in tenant
    const ok = window.confirm(`${exists ? 'الحقل موجود وسيُستبدل!' : 'إضافة حقل جديد'} «${k}» على وثيقة «${tenant.name || tid}». متابعة؟`)
    if (!ok) return
    setBusy(true)
    try {
      await platformUpdateTenant(tid, { [k]: p.value })
      toast.success(`حُفظ الحقل ${k}`)
      setNewErr('')
      setNewKey('')
      setNewJson('')
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="v360-warn">
        <Icon name="warning" size={16} /> منطقة خطرة: الكتابة هنا تعدّل وثيقة المنشأة مباشرة دون أي تحقق من جانب التطبيق. حقول التواريخ (Timestamp) تظهر ككائن seconds/nanoseconds — لا تعدّلها من هنا لأنها ستُحفظ كخريطة عادية وتُفسد التاريخ.
      </div>

      <Section icon="wrench" title="محرر حقول الوثيقة (خام)" danger>
        <label className="stack" style={{ gap: 4 }}>
          <span className="xs faint bold">الحقل</span>
          <select className="input" value={sel} onChange={(e) => pick(e.target.value)}>
            <option value="">— اختر حقلاً —</option>
            {keys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        {sel && (
          <>
            <textarea className="input v360-json" rows={8} value={json} onChange={(e) => { setJson(e.target.value); setJsonErr('') }} spellCheck={false} />
            {jsonErr ? <p className="small" style={{ color: 'var(--danger)' }}>{jsonErr}</p> : null}
            <button className="btn btn-primary" disabled={busy} onClick={saveSel} style={{ background: 'var(--danger)' }}>
              <Icon name="warning" size={16} /> {busy ? 'جارٍ الحفظ…' : `كتابة الحقل ${sel}`}
            </button>
          </>
        )}
      </Section>

      <Section icon="add" title="تعديل حر (إضافة حقل جديد)" danger>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="stack grow" style={{ gap: 4, minWidth: 160 }}>
            <span className="xs faint bold">اسم الحقل (لاتيني)</span>
            <input className="input v360-mono" value={newKey} onChange={(e) => { setNewKey(e.target.value); setNewErr('') }} placeholder="customFlag" />
          </label>
        </div>
        <textarea className="input v360-json" rows={4} value={newJson} onChange={(e) => { setNewJson(e.target.value); setNewErr('') }} placeholder='true أو 12 أو "نص" أو {"a": 1}' spellCheck={false} />
        {newErr ? <p className="small" style={{ color: 'var(--danger)' }}>{newErr}</p> : null}
        <button className="btn btn-outline" disabled={busy} onClick={saveNew} style={{ color: 'var(--danger)' }}>
          <Icon name="add" size={16} /> {busy ? 'جارٍ الحفظ…' : 'إضافة الحقل'}
        </button>
      </Section>

      <Section icon="lock" title="إجراءات الدعم والخطر" danger>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={impersonate} title="معاينة النظام بحساب مالك المنشأة (مسجَّل في سجل النشاط)">
            <Icon name="eye" size={16} /> الدخول كمالك
          </button>
          <button className="btn btn-outline" disabled={toggling} style={{ color: tenant.active === false ? 'var(--success)' : 'var(--danger)' }} onClick={toggleActive}>
            <Icon name={tenant.active === false ? 'ok' : 'no'} size={16} /> {tenant.active === false ? 'تفعيل الحساب' : 'إيقاف الحساب'}
          </button>
        </div>
        <p className="xs faint">الدخول كمالك يبدّل جلستك الحالية إلى حساب المالك (مُدقَّق عبر دالة platformImpersonate).</p>
      </Section>
    </>
  )
}

// ============================== الصفحة ==============================
export default function VenueDetail() {
  const { tid } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [tenant, setTenant] = useState(undefined)
  const [tab, setTab] = useState('overview')
  const [toggling, setToggling] = useState(false)
  // Per-venue session cache: keys are `${tid}:name`, so a venue switch never
  // reads another venue's cached data even before the reset effect runs.
  const cache = useRef({})

  useEffect(() => watchTenantDoc(tid, setTenant), [tid])
  useEffect(() => { cache.current = {}; setTab('overview') }, [tid])

  if (tenant === undefined) return <Spinner />
  if (tenant === null) return <Empty icon="store" title="منشأة غير موجودة" />

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

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      {/* sticky header: identity + status + tabs */}
      <div className="v360-sticky">
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {tenant.logoUrl ? (
            <img src={tenant.logoUrl} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', flex: 'none' }} />
          ) : (
            <span className="dot" style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--brand)', color: 'var(--on-brand)', display: 'grid', placeItems: 'center', flex: 'none' }}>
              <Icon name="store" size={20} />
            </span>
          )}
          <div className="grow" style={{ minWidth: 140 }}>
            <h2 className="page-title" style={{ marginBottom: 0, fontSize: 'var(--fs-lg)' }}>{tenant.name}</h2>
            <p className="muted xs">/{tenant.slug} · {tenant.type || 'cafe'} · انضمت {fmtWhen(tenant.createdAt)}</p>
          </div>
          <PlanBadge plan={tenant.plan} />
          <StatusChip tenant={tenant} />
        </div>
        <div className="v360-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`chip ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={15} /> {t.ar}
            </button>
          ))}
        </div>
      </div>

      {/* quick actions */}
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

      {/* tabs render lazily: a tab mounts (and fetches) only when opened */}
      {tab === 'overview' && <OverviewTab key={tid} tid={tid} tenant={tenant} cache={cache} />}
      {tab === 'plan' && <PlanTab key={tid} tid={tid} tenant={tenant} toast={toast} toggleActive={toggleActive} toggling={toggling} />}
      {tab === 'team' && <TeamTab key={tid} tid={tid} tenant={tenant} />}
      {tab === 'data' && <DataTab key={tid} tid={tid} tenant={tenant} cache={cache} />}
      {tab === 'comms' && <CommsTab key={tid} tid={tid} tenant={tenant} cache={cache} toast={toast} />}
      {tab === 'advanced' && <AdvancedTab key={tid} tid={tid} tenant={tenant} toast={toast} impersonate={impersonate} toggleActive={toggleActive} toggling={toggling} />}
    </div>
  )
}
