// Billing & invoices — the money desk of the platform console.
// Three boards: invoices (filter + manual payment + create), a collection board
// grouping unpaid dues per venue, and subscription coupons CRUD. MRR + total-due
// KPIs sit up top. Automatic invoicing = the generateMonthlyInvoices function;
// real card capture needs the paymentWebhook gateway wiring.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchAllTenants } from '../../lib/platform.js'
import { PLANS } from '../../lib/plans.js'
import { PlanBadge, fmtWhen, toDateInput } from './shared.jsx'
import {
  watchInvoices,
  createInvoice,
  markInvoicePaid,
  markUnpaid,
  deleteInvoice,
  computeMRR,
  watchCoupons,
  saveCoupon,
  deleteCoupon,
} from '../../lib/platformBilling.js'

const money = (n, cur = 'SAR') => `${(Number(n) || 0).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 2 })} ${cur}`
const periodNow = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const STATUS_BADGE = { paid: 'badge-success', unpaid: 'badge-warning', overdue: 'badge-danger' }
const STATUS_AR = { paid: 'مدفوعة', unpaid: 'غير مدفوعة', overdue: 'متأخرة' }

// ---------- create invoice form ----------
function CreateInvoiceForm({ tenants, onDone }) {
  const toast = useToast()
  const [tenantId, setTenantId] = useState('')
  const [plan, setPlan] = useState('enterprise')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('SAR')
  const [period, setPeriod] = useState(periodNow())
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!tenantId) return toast.error('اختر المنشأة')
    if (!(Number(amount) > 0)) return toast.error('أدخل مبلغاً صحيحاً')
    setBusy(true)
    try {
      const t = tenants.find((x) => x.id === tenantId)
      await createInvoice({ tenantId, tenantName: t?.name || '', plan, amount, currency, period })
      toast.success('تم إنشاء الفاتورة')
      setTenantId(''); setAmount(''); setPeriod(periodNow())
      onDone?.()
    } catch {
      toast.error('تعذّر إنشاء الفاتورة')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card card-pad stack" style={{ gap: 'var(--sp-3)' }} onSubmit={submit}>
      <div className="row-between">
        <strong>إنشاء فاتورة يدوية</strong>
        <Icon name="add" size={16} />
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select className="input" style={{ minWidth: 180, flex: 1 }} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          <option value="">— اختر المنشأة —</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name || t.id}</option>)}
        </select>
        <select className="input" style={{ width: 'auto' }} value={plan} onChange={(e) => setPlan(e.target.value)}>
          {PLANS.map((p) => <option key={p.id} value={p.id}>{p.ar}</option>)}
        </select>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="input" type="number" min="0" step="0.01" placeholder="المبلغ" style={{ width: 120 }} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <select className="input" style={{ width: 'auto' }} value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="SAR">SAR</option>
          <option value="USD">USD</option>
          <option value="AED">AED</option>
          <option value="EGP">EGP</option>
        </select>
        <input className="input" type="month" style={{ width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value)} />
        <button className="btn btn-primary grow" disabled={busy}><Icon name="check" size={15} /> إنشاء</button>
      </div>
    </form>
  )
}

// ---------- invoices tab ----------
function InvoicesTab({ invoices, tenants }) {
  const toast = useToast()
  const [filter, setFilter] = useState('all') // all | unpaid | paid
  const [showForm, setShowForm] = useState(false)

  const rows = useMemo(() => {
    if (filter === 'all') return invoices
    return invoices.filter((i) => (filter === 'paid' ? i.status === 'paid' : i.status !== 'paid'))
  }, [invoices, filter])

  const counts = useMemo(() => ({
    all: invoices.length,
    unpaid: invoices.filter((i) => i.status !== 'paid').length,
    paid: invoices.filter((i) => i.status === 'paid').length,
  }), [invoices])

  const pay = async (inv) => {
    try { await markInvoicePaid(inv.id); toast.success('سُجّل الدفع') } catch { toast.error('تعذّر التحديث') }
  }
  const unpay = async (inv) => {
    try { await markUnpaid(inv.id); toast.success('أُعيدت كغير مدفوعة') } catch { toast.error('تعذّر التحديث') }
  }
  const remove = async (inv) => {
    // deleting a FINANCIAL record needs explicit confirmation with its identity
    if (!window.confirm(`حذف الفاتورة ${inv.period || inv.id} بمبلغ ${inv.amount || 0} ${inv.currency || 'SAR'}؟ لا يمكن التراجع.`)) return
    try { await deleteInvoice(inv.id); toast.success('حُذفت الفاتورة') } catch { toast.error('تعذّر الحذف') }
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 6 }}>
          {['all', 'unpaid', 'paid'].map((f) => (
            <button key={f} className={`btn ${filter === f ? 'btn-primary' : 'btn-outline'}`} style={{ padding: '5px 12px' }} onClick={() => setFilter(f)}>
              {f === 'all' ? 'الكل' : f === 'unpaid' ? 'غير مدفوعة' : 'مدفوعة'} ({counts[f]})
            </button>
          ))}
        </div>
        <button className={`btn ${showForm ? 'btn-outline' : 'btn-primary'}`} style={{ padding: '5px 12px' }} onClick={() => setShowForm((v) => !v)}>
          <Icon name={showForm ? 'close' : 'add'} size={15} /> {showForm ? 'إغلاق' : 'فاتورة جديدة'}
        </button>
      </div>

      {showForm && <CreateInvoiceForm tenants={tenants} onDone={() => setShowForm(false)} />}

      {rows.length === 0 ? (
        <Empty icon="wallet" title="لا فواتير" hint="أنشئ فاتورة يدوية أو انتظر توليد الفواتير الشهرية تلقائياً" />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {rows.map((inv) => (
            <div key={inv.id} className="card card-pad row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="grow" style={{ minWidth: 160 }}>
                <Link to={`/platform/venues/${inv.tenantId}`} className="bold">{inv.tenantName || inv.tenantId}</Link>
                <div className="xs faint">
                  {inv.period ? `فترة ${inv.period} · ` : ''}أُنشئت {fmtWhen(inv.createdAt)}
                  {inv.status === 'paid' && inv.paidAt ? ` · دُفعت ${fmtWhen(inv.paidAt)}` : ''}
                </div>
              </div>
              <PlanBadge plan={inv.plan} />
              <span className="bold num">{money(inv.amount, inv.currency)}</span>
              <span className={`badge ${STATUS_BADGE[inv.status] || 'badge-warning'}`}>{STATUS_AR[inv.status] || inv.status}</span>
              <div className="row" style={{ gap: 6 }}>
                {inv.status !== 'paid' ? (
                  <button className="btn btn-success" style={{ padding: '4px 10px' }} onClick={() => pay(inv)}>
                    <Icon name="check" size={14} /> تسجيل دفع
                  </button>
                ) : (
                  <button className="btn btn-outline" style={{ padding: '4px 10px' }} onClick={() => unpay(inv)}>
                    <Icon name="undo" size={14} /> إلغاء الدفع
                  </button>
                )}
                <button className="btn btn-outline" style={{ padding: '4px 10px', color: 'var(--danger)' }} onClick={() => remove(inv)}>
                  <Icon name="delete" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- collection board ----------
function CollectionTab({ invoices }) {
  const groups = useMemo(() => {
    const map = new Map()
    invoices.filter((i) => i.status !== 'paid').forEach((i) => {
      const key = i.tenantId || '—'
      const g = map.get(key) || { tenantId: i.tenantId, tenantName: i.tenantName, items: [], total: 0, currency: i.currency || 'SAR' }
      g.items.push(i)
      g.total += Number(i.amount) || 0
      map.set(key, g)
    })
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }, [invoices])

  if (groups.length === 0) return <Empty icon="check" title="لا مستحقات" hint="كل الفواتير مدفوعة — لا يوجد ما يُحصّل" />

  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      {groups.map((g) => (
        <div key={g.tenantId || '—'} className="card card-pad stack" style={{ gap: 8 }}>
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <Link to={`/platform/venues/${g.tenantId}`} className="bold">{g.tenantName || g.tenantId}</Link>
            <span className="badge badge-warning num">مستحق {money(g.total, g.currency)}</span>
          </div>
          <div className="stack divide" style={{ gap: 0 }}>
            {g.items.map((i) => (
              <div key={i.id} className="row-between" style={{ padding: '6px 0', gap: 8 }}>
                <span className="small">{i.period || 'بدون فترة'}</span>
                <span className="xs faint num">{fmtWhen(i.createdAt)}</span>
                <span className="small bold num">{money(i.amount, i.currency)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- coupons tab ----------
function CouponForm({ editing, onDone }) {
  const toast = useToast()
  const [code, setCode] = useState(editing?.code || '')
  const [type, setType] = useState(editing?.type || 'percent')
  const [value, setValue] = useState(editing?.value ?? '')
  const [expiresAt, setExpiresAt] = useState(toDateInput(editing?.expiresAt))
  const [active, setActive] = useState(editing?.active !== false)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!code.trim()) return toast.error('أدخل رمز القسيمة')
    setBusy(true)
    try {
      await saveCoupon(editing?.id || null, {
        code, type, value,
        expiresAt: expiresAt ? new Date(expiresAt + 'T23:59:59') : null,
        active,
      })
      toast.success(editing ? 'تم تحديث القسيمة' : 'تم إنشاء القسيمة')
      onDone?.()
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card card-pad stack" style={{ gap: 'var(--sp-3)' }} onSubmit={submit}>
      <strong>{editing ? 'تعديل قسيمة' : 'قسيمة جديدة'}</strong>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="input" placeholder="الرمز (WELCOME20)" style={{ minWidth: 150, flex: 1, textTransform: 'uppercase' }} value={code} onChange={(e) => setCode(e.target.value)} />
        <select className="input" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="percent">نسبة %</option>
          <option value="fixed">مبلغ ثابت</option>
        </select>
        <input className="input" type="number" min="0" step="0.01" placeholder="القيمة" style={{ width: 100 }} value={value} onChange={(e) => setValue(e.target.value)} />
        <input className="input" type="date" style={{ width: 'auto' }} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
      </div>
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span className="small">مُفعّلة</span>
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={busy}><Icon name="check" size={15} /> حفظ</button>
        <button type="button" className="btn btn-outline" onClick={() => onDone?.()}>إلغاء</button>
      </div>
    </form>
  )
}

function CouponsTab({ coupons }) {
  const toast = useToast()
  const [editing, setEditing] = useState(null) // coupon obj | 'new' | null

  const isExpired = (c) => {
    const d = c.expiresAt?.toDate ? c.expiresAt.toDate() : c.expiresAt ? new Date(c.expiresAt) : null
    return d && !isNaN(d) && Date.now() > d.getTime()
  }
  const remove = async (c) => {
    try { await deleteCoupon(c.id); toast.success('حُذفت القسيمة') } catch { toast.error('تعذّر الحذف') }
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      {editing ? (
        <CouponForm editing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      ) : (
        <div className="row">
          <button className="btn btn-primary" style={{ padding: '5px 12px' }} onClick={() => setEditing('new')}>
            <Icon name="add" size={15} /> قسيمة جديدة
          </button>
        </div>
      )}

      {coupons.length === 0 ? (
        <Empty icon="ticket" title="لا قسائم" hint="أنشئ قسائم خصم على الاشتراكات لتفعيلها للمنشآت" />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {coupons.map((c) => (
            <div key={c.id} className="card card-pad row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="grow" style={{ minWidth: 120 }}>
                <span className="bold num" dir="ltr" style={{ letterSpacing: 1 }}>{c.code}</span>
                <div className="xs faint">
                  {c.type === 'fixed' ? money(c.value, 'SAR') : `${c.value}%`}
                  {c.expiresAt ? ` · حتى ${toDateInput(c.expiresAt)}` : ' · بلا انتهاء'}
                </div>
              </div>
              {isExpired(c)
                ? <span className="badge badge-danger">منتهية</span>
                : c.active !== false
                  ? <span className="badge badge-success">مُفعّلة</span>
                  : <span className="badge">موقوفة</span>}
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-outline" style={{ padding: '4px 10px' }} onClick={() => setEditing(c)}>
                  <Icon name="edit" size={14} />
                </button>
                <button className="btn btn-outline" style={{ padding: '4px 10px', color: 'var(--danger)' }} onClick={() => remove(c)}>
                  <Icon name="delete" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- page ----------
export default function Billing() {
  const [tab, setTab] = useState('invoices') // invoices | collection | coupons
  const [invoices, setInvoices] = useState(null)
  const [tenants, setTenants] = useState([])
  const [coupons, setCoupons] = useState([])

  useEffect(() => watchInvoices(setInvoices, { max: 300 }), [])
  useEffect(() => watchAllTenants(setTenants), [])
  useEffect(() => watchCoupons(setCoupons), [])

  const mrr = useMemo(() => computeMRR(invoices || []), [invoices])
  const totalDue = useMemo(
    () => (invoices || []).filter((i) => i.status !== 'paid').reduce((s, i) => s + (Number(i.amount) || 0), 0),
    [invoices],
  )
  const unpaidCount = useMemo(() => (invoices || []).filter((i) => i.status !== 'paid').length, [invoices])

  if (invoices === null) return <Spinner />

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div>
        <h2 className="page-title">الفوترة والاشتراكات</h2>
        <p className="muted small">إدارة فواتير المنشآت، تحصيل المستحقات، وقسائم الخصم</p>
      </div>

      {/* KPIs */}
      <div className="stat-grid">
        <div className="stat">
          <div className="row" style={{ gap: 6, alignItems: 'center' }}><Icon name="trending" size={15} /><span className="faint xs">الإيراد الشهري MRR</span></div>
          <strong className="num">{money(mrr)}</strong>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 6, alignItems: 'center' }}><Icon name="wallet" size={15} /><span className="faint xs">إجمالي المستحقات</span></div>
          <strong className="num" style={{ color: totalDue > 0 ? 'var(--warning)' : 'var(--success)' }}>{money(totalDue)}</strong>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 6, alignItems: 'center' }}><Icon name="file" size={15} /><span className="faint xs">فواتير غير مدفوعة</span></div>
          <strong className="num">{unpaidCount}</strong>
        </div>
      </div>

      {/* tabs */}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className={`btn ${tab === 'invoices' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('invoices')}>
          <Icon name="file" size={14} style={{ verticalAlign: 'middle' }} /> الفواتير
        </button>
        <button className={`btn ${tab === 'collection' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('collection')}>
          <Icon name="wallet" size={14} style={{ verticalAlign: 'middle' }} /> لوحة التحصيل {unpaidCount ? `(${unpaidCount})` : ''}
        </button>
        <button className={`btn ${tab === 'coupons' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('coupons')}>
          <Icon name="ticket" size={14} style={{ verticalAlign: 'middle' }} /> قسائم الخصم
        </button>
      </div>

      {tab === 'invoices' && <InvoicesTab invoices={invoices} tenants={tenants} />}
      {tab === 'collection' && <CollectionTab invoices={invoices} />}
      {tab === 'coupons' && <CouponsTab coupons={coupons} />}

      {/* automation note */}
      <div className="card card-pad small muted" style={{ borderStyle: 'dashed' }}>
        <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <Icon name="warning" size={16} />
          <span>
            توليد الفواتير الشهري يتم تلقائياً عبر دالة <span className="bold" dir="ltr">generateMonthlyInvoices</span>.
            تسجيل الدفع هنا يدوي؛ التقاط المدفوعات الحقيقية من بوابة الدفع يتطلب ربط <span className="bold" dir="ltr">paymentWebhook</span>.
          </span>
        </div>
      </div>
    </div>
  )
}
