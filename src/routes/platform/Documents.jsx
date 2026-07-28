// المستندات (/platform/documents) — عروض الأسعار والفواتير الضريبية.
//
// The sales desk: build a quotation for one venue, send the link, watch it get
// accepted, and see it become a paid invoice — all in one place.
//
// The sequence audit lives here too, deliberately visible rather than buried:
// a numbered series with a hole in it is the single thing an auditor looks
// for, and the only way to keep it honest is to be able to check it in one
// click, any day.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchAllTenants } from '../../lib/platform.js'
import { watchPlansConfig } from '../../lib/platformConfig.js'
import { PLANS } from '../../lib/plans.js'
import { normalizePlanConfig, promoOf } from '../../lib/platformPricing.js'
import {
  createQuote, watchQuotes, watchPlatformDocs, quoteUrl, invoiceUrl,
  auditSequence, DOC_STATUS_AR, DOC_STATUS_BADGE,
} from '../../lib/platformDocs.js'
import { fmtWhen } from './shared.jsx'

const n2 = (v) => (Number(v) || 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nInt = (v) => (Number(v) || 0).toLocaleString('en-US')
const dateAr = (ms) => (ms ? new Date(ms).toLocaleDateString('ar-SA-u-nu-latn', { dateStyle: 'medium' }) : '—')

const TABS = [
  { id: 'quotes', label: 'عروض الأسعار', icon: 'file' },
  { id: 'invoices', label: 'الفواتير', icon: 'receipt' },
  { id: 'audit', label: 'فحص التسلسل', icon: 'scale' },
]

export default function Documents() {
  const [tab, setTab] = useState('quotes')
  const [tenants, setTenants] = useState(null)
  const [quotes, setQuotes] = useState(null)
  const [docs, setDocs] = useState(null)
  const [cfg, setCfg] = useState(null)

  useEffect(() => watchAllTenants(setTenants), [])
  useEffect(() => watchQuotes(setQuotes), [])
  useEffect(() => watchPlatformDocs(setDocs), [])
  useEffect(() => watchPlansConfig((c) => setCfg(normalizePlanConfig(c))), [])

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div>
        <h2 className="page-title">المستندات</h2>
        <p className="muted small">
          عروض أسعار احترافية بهوية الشركة وشعارها، تتحوّل إلى فاتورة ضريبية عند الدفع. الترقيم متسلسل بلا فجوات،
          ولا يُحذف مستند أبداً — يُلغى بسبب مكتوب ويبقى في السجل.
        </p>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'quotes' && <QuotesTab tenants={tenants} quotes={quotes} cfg={cfg} />}
      {tab === 'invoices' && <InvoicesTab docs={docs} />}
      {tab === 'audit' && <AuditTab docs={docs} />}
    </div>
  )
}

/* ================= quotations ================= */
function QuotesTab({ tenants, quotes, cfg }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)

  if (!quotes) return <div className="card card-pad"><Spinner /></div>

  const copyLink = async (q) => {
    try {
      await navigator.clipboard.writeText(quoteUrl(q))
      toast.success('نُسخ رابط العرض — أرسله للعميل')
    } catch {
      // Clipboard is blocked in some embedded contexts; showing the link is
      // more useful than an error the operator can do nothing with.
      window.prompt('انسخ الرابط يدوياً:', quoteUrl(q))
    }
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="row-between">
        <strong className="small">{quotes.length ? `${nInt(quotes.length)} عرضاً` : 'لا عروض بعد'}</strong>
        <button className={`btn btn-sm ${open ? 'btn-outline' : 'btn-primary'}`} onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? 'close' : 'add'} size={14} /> {open ? 'إغلاق' : 'عرض سعر جديد'}
        </button>
      </div>

      {open && <QuoteForm tenants={tenants} cfg={cfg} onDone={() => setOpen(false)} />}

      {quotes.length === 0 ? (
        <Empty icon="file" title="لا عروض أسعار" hint="أنشئ عرضاً وأرسل رابطه للعميل — يقبله ويدفع مباشرة." />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {quotes.map((q) => (
            <div key={q.id} className="card card-pad row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="grow" style={{ minWidth: 180 }}>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <strong className="num" dir="ltr">{q.no}</strong>
                  <span className={`badge ${DOC_STATUS_BADGE[q.status] || ''}`}>{DOC_STATUS_AR[q.status] || q.status}</span>
                </div>
                <div className="xs faint">
                  {q.buyer?.nameAr || '—'} · باقة {(PLANS.find((p) => p.id === q.planId) || {}).ar || q.planId}
                  {q.billing === 'yearly' ? ' · سنوي' : ''} · ساري حتى {dateAr(q.validUntil)}
                </div>
              </div>
              <div style={{ textAlign: 'start' }}>
                <strong className="num" dir="ltr">{n2(q.total)}</strong>
                <div className="xs faint">شامل الضريبة</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <a className="btn btn-sm btn-outline" href={quoteUrl(q)} target="_blank" rel="noreferrer">
                  <Icon name="search" size={13} /> معاينة
                </a>
                <button className="btn btn-sm btn-outline" onClick={() => copyLink(q)}>
                  <Icon name="copy" size={13} /> نسخ الرابط
                </button>
                {q.convertedInvoiceId && (
                  <a className="btn btn-sm btn-outline" href={invoiceUrl(q.convertedInvoiceId)} target="_blank" rel="noreferrer">
                    <Icon name="receipt" size={13} /> الفاتورة
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function QuoteForm({ tenants, cfg, onDone }) {
  const toast = useToast()
  const [tenantId, setTenantId] = useState('')
  const [planId, setPlanId] = useState('enterprise')
  const [billing, setBilling] = useState('monthly')
  const [buyerName, setBuyerName] = useState('')
  const [buyerVat, setBuyerVat] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [override, setOverride] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  // Live preview of exactly what the sheet will print — the struck-through
  // list price only appears when a real promo is running.
  const preview = useMemo(() => {
    if (!cfg) return null
    const promo = promoOf(planId, cfg)
    const monthly = override !== '' && Number.isFinite(Number(override)) ? Number(override) : cfg.prices[planId]
    const yearly = billing === 'yearly'
    const price = yearly ? Math.round(monthly * 12 * cfg.yearlyDiscount) : monthly
    const listM = promo ? promo.listPrice : monthly
    const list = yearly ? Math.round(listM * 12 * cfg.yearlyDiscount) : listM
    const vat = Math.round(price * 0.15 * 100) / 100
    return { promo, price, list, vat, total: Math.round((price + vat) * 100) / 100, showStrike: list > price }
  }, [cfg, planId, billing, override])

  const submit = async (e) => {
    e.preventDefault()
    if (!buyerName.trim()) return toast.error('اكتب اسم المنشأة كما تريده على العرض')
    setBusy(true)
    try {
      const r = await createQuote({
        tenantId: tenantId || null, planId, billing,
        buyerName: buyerName.trim(), buyerVat: buyerVat.trim(),
        contactName: contactName.trim(), email: email.trim(), phone: phone.trim(),
        unitPrice: override !== '' ? Number(override) : undefined,
        notesAr: notes.trim(),
      })
      toast.success(`أُنشئ العرض ${r.no}`)
      onDone?.()
    } catch (err) {
      toast.error(err?.message || 'تعذّر إنشاء العرض')
    } finally { setBusy(false) }
  }

  return (
    <form className="card card-pad stack" style={{ gap: 12 }} onSubmit={submit}>
      <strong className="small">عرض سعر جديد</strong>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="stack grow" style={{ gap: 4, minWidth: 200 }}>
          <span className="xs faint">اسم المنشأة على العرض</span>
          <input className="input" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="مثال: مؤسسة نكهة الأصيل للتجارة" />
        </label>
        <label className="stack" style={{ gap: 4, minWidth: 170 }}>
          <span className="xs faint">الرقم الضريبي للعميل (اختياري)</span>
          <input className="input num" dir="ltr" value={buyerVat} onChange={(e) => setBuyerVat(e.target.value)} />
        </label>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="stack" style={{ gap: 4, minWidth: 150 }}>
          <span className="xs faint">جهة الاتصال</span>
          <input className="input" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 4, minWidth: 170 }}>
          <span className="xs faint">البريد</span>
          <input className="input" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 4, minWidth: 140 }}>
          <span className="xs faint">الجوال</span>
          <input className="input num" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="stack" style={{ gap: 4, minWidth: 150 }}>
          <span className="xs faint">الباقة</span>
          <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {PLANS.map((p) => <option key={p.id} value={p.id}>{p.ar}</option>)}
          </select>
        </label>
        <label className="stack" style={{ gap: 4, minWidth: 120 }}>
          <span className="xs faint">الدورة</span>
          <select className="input" value={billing} onChange={(e) => setBilling(e.target.value)}>
            <option value="monthly">شهري</option>
            <option value="yearly">سنوي</option>
          </select>
        </label>
        <label className="stack" style={{ gap: 4, minWidth: 150 }}>
          <span className="xs faint">سعر متفق عليه (اختياري)</span>
          <input className="input num" type="number" min="0" dir="ltr" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="اتركه فارغاً للسعر المعتمد" />
        </label>
        <label className="stack grow" style={{ gap: 4, minWidth: 200 }}>
          <span className="xs faint">ربط بمنشأة قائمة (اختياري)</span>
          <select className="input" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            <option value="">— عميل محتمل، بلا حساب بعد —</option>
            {(tenants || []).map((t) => <option key={t.id} value={t.id}>{t.name || t.id}</option>)}
          </select>
        </label>
      </div>

      <label className="stack" style={{ gap: 4 }}>
        <span className="xs faint">ملاحظات تظهر على العرض (اختياري)</span>
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {preview && (
        <div className="card card-pad stack" style={{ gap: 4, background: 'var(--surface-2)' }}>
          <span className="xs faint">كما سيظهر على العرض</span>
          <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            {preview.showStrike && (
              <s className="faint num" dir="ltr">{n2(preview.list)}</s>
            )}
            <strong className="num" dir="ltr" style={{ fontSize: 'var(--fs-lg)' }}>{n2(preview.price)}</strong>
            <span className="xs faint">+ ضريبة <span className="num" dir="ltr">{n2(preview.vat)}</span></span>
            <span className="bold num" dir="ltr">= {n2(preview.total)} ريال</span>
          </div>
          {preview.promo
            ? <span className="xs" style={{ color: 'var(--brand)' }}>{preview.promo.labelAr} — خصم {preview.promo.discountPct}%، ساري حتى {dateAr(preview.promo.validUntil)}</span>
            : <span className="xs faint">لا يوجد عرض ساري — لن يظهر سعر مشطوب. اضبطه من محرر الخطط.</span>}
        </div>
      )}

      <button className="btn btn-primary" disabled={busy}>
        {busy ? <Spinner /> : <><Icon name="check" size={15} /> إنشاء العرض</>}
      </button>
    </form>
  )
}

/* ================= invoices ================= */
function InvoicesTab({ docs }) {
  if (!docs) return <div className="card card-pad"><Spinner /></div>
  // Only the NEW schema carries a number, a seller block and a QR. Older rows
  // are shown by the existing /platform/billing screen; mixing them here would
  // imply they are tax invoices, and they are not.
  const rows = docs.filter((d) => d.schema >= 2)
  if (!rows.length) {
    return <Empty icon="receipt" title="لا فواتير بالنظام الجديد بعد" hint="تصدر تلقائياً عند قبول عرض سعر أو في دورة الفوترة الشهرية." />
  }
  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      {rows.map((d) => (
        <div key={d.id} className="card card-pad row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="grow" style={{ minWidth: 180 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <strong className="num" dir="ltr">{d.no}</strong>
              <span className={`badge ${DOC_STATUS_BADGE[d.status] || ''}`}>{DOC_STATUS_AR[d.status] || d.status}</span>
              {d.docType === 'creditNote' && <span className="badge badge-danger">إشعار دائن</span>}
            </div>
            <div className="xs faint">
              <Link to={`/platform/venues/${d.tenantId}`}>{d.tenantName || d.tenantId}</Link>
              {d.period ? ` · فترة ${d.period}` : ''} · صدرت {fmtWhen(d.issuedAt || d.createdAt)}
            </div>
            {d.status === 'void' && d.voidReason ? <div className="xs" style={{ color: 'var(--danger)' }}>ملغاة: {d.voidReason}</div> : null}
          </div>
          <div style={{ textAlign: 'start' }}>
            <strong className="num" dir="ltr">{n2(d.total)}</strong>
            <div className="xs faint num" dir="ltr">{n2(d.subtotal)} + {n2(d.vat)} ضريبة</div>
          </div>
          <a className="btn btn-sm btn-outline" href={invoiceUrl(d.id)} target="_blank" rel="noreferrer">
            <Icon name="print" size={13} /> فتح
          </a>
        </div>
      ))}
    </div>
  )
}

/* ================= sequence audit ================= */
function AuditTab({ docs }) {
  const year = new Date().getFullYear()
  const results = useMemo(() => (
    ['invoice', 'credit', 'legacy'].map((s) => auditSequence(docs || [], s, year))
  ), [docs, year])

  if (!docs) return <div className="card card-pad"><Spinner /></div>

  return (
    <div className="card card-pad stack" style={{ gap: 12 }}>
      <div>
        <strong className="small">فحص تسلسل الترقيم — <span className="num" dir="ltr">{year}</span></strong>
        <p className="xs faint" style={{ margin: '4px 0 0' }}>
          سلسلة الفواتير يجب أن تكون متصلة من واحد بلا رقم ناقص. الرقم المفقود هو أول ما يبحث عنه المدقّق —
          ولهذا لا يُحذف مستند هنا أبداً، بل يُلغى بسبب مكتوب ويبقى محتلاً رقمه.
        </p>
      </div>
      {results.map((r) => (
        <div key={r.series} className="row-between" style={{ gap: 12, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
          <div>
            <strong className="small">{{ invoice: 'الفواتير الضريبية', credit: 'الإشعارات الدائنة', legacy: 'المُرحَّلة' }[r.series]}</strong>
            <div className="xs faint num" dir="ltr">{r.count} / أعلى رقم {r.highest}</div>
          </div>
          {r.count === 0
            ? <span className="badge">لا مستندات</span>
            : r.ok
              ? <span className="badge badge-success"><Icon name="ok" size={12} /> متصل بلا فجوات</span>
              : <span className="badge badge-danger">فجوات: <span className="num" dir="ltr">{r.gaps.slice(0, 8).join('، ')}</span>{r.gaps.length > 8 ? '…' : ''}</span>}
        </div>
      ))}
    </div>
  )
}
