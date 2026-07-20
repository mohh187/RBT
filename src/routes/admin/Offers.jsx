import { lazy, Suspense, useEffect, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n, pickLang } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import Sheet from '../../components/Sheet.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { watchOffers, saveOffer, deleteOffer, watchCategories, watchItems } from '../../lib/db.js'
import { Price } from '../../components/Riyal.jsx'
import Icon from '../../components/Icon.jsx'
const SmartOfferAdvisor = lazy(() => import('../../components/SmartOfferAdvisor.jsx'))

const DAYS = {
  ar: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

const blank = () => ({
  nameAr: '', nameEn: '', type: 'percent', value: '', code: '', active: true, minSubtotal: '',
  scope: 'cart', categoryId: '', itemId: '', startsAt: '', endsAt: '', daysOfWeek: [], startTime: '', endTime: '', autoApply: true, membersOnly: false,
})

// ms epoch ⇄ <input type="datetime-local"> value
const toLocalInput = (ms) => {
  if (!ms) return ''
  const d = new Date(Number(ms)); const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function Offers() {
  const { t, lang } = useI18n()
  const { tenantId, tenant } = useAuth()
  const toast = useToast()
  const currency = tenant?.currency || 'SAR'
  const [offers, setOffers] = useState(null)
  const [cats, setCats] = useState([])
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(null)
  // Offer advisor: real 30-day sales + material costs, loaded only when opened.
  const [advisorOpen, setAdvisorOpen] = useState(false)
  const [advOrders, setAdvOrders] = useState([])
  const [advMaterials, setAdvMaterials] = useState([])

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchOffers(tenantId, setOffers)
    const u2 = watchCategories(tenantId, setCats)
    const u3 = watchItems(tenantId, setItems)
    return () => { u1(); u2(); u3() }
  }, [tenantId])

  useEffect(() => {
    if (!advisorOpen || !tenantId || advOrders.length) return
    let alive = true
    ;(async () => {
      try {
        const { listOrdersSince, listMaterials } = await import('../../lib/db.js')
        const since = new Date(Date.now() - 30 * 86400000)
        const [os, ms] = await Promise.all([
          listOrdersSince ? listOrdersSince(tenantId, since) : Promise.resolve([]),
          listMaterials ? listMaterials(tenantId) : Promise.resolve([]),
        ])
        if (!alive) return
        setAdvOrders(os || [])
        setAdvMaterials(ms || [])
      } catch (_) { /* advisor degrades to rule-free empty state honestly */ }
    })()
    return () => { alive = false }
  }, [advisorOpen, tenantId, advOrders.length])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const toggleDay = (d) => setForm((f) => ({ ...f, daysOfWeek: f.daysOfWeek.includes(d) ? f.daysOfWeek.filter((x) => x !== d) : [...f.daysOfWeek, d] }))
  const openNew = () => { setForm(blank()); setOpen(true) }
  const openEdit = (o) => { setForm({ ...blank(), ...o }); setOpen(true) }
  // Advisor suggestion -> a prefilled (unsaved) offer the manager reviews.
  const openNewFromDraft = (draft) => {
    const one = Array.isArray(draft?.itemIds) ? draft.itemIds[0] : draft?.itemId
    setForm({
      ...blank(),
      nameAr: draft?.name || '',
      type: draft?.type === 'amount' ? 'amount' : 'percent',
      value: Number(draft?.value) || '',
      // The offer model targets ONE item (or the whole cart) — the advisor may
      // propose several, so we seed the first and scope accordingly.
      scope: one ? 'item' : 'cart',
      itemId: one || '',
      startTime: draft?.window?.startTime || '',
      endTime: draft?.window?.endTime || '',
      daysOfWeek: Array.isArray(draft?.window?.days) ? draft.window.days : [],
    })
    setOpen(true)
  }

  const save = async () => {
    if (!form.nameAr?.trim() && !form.nameEn?.trim()) return
    await saveOffer(tenantId, form.id, {
      nameAr: (form.nameAr || '').trim(),
      nameEn: (form.nameEn || '').trim(),
      type: form.type,
      value: Number(form.value) || 0,
      code: (form.code || '').trim().toUpperCase(),
      minSubtotal: Number(form.minSubtotal) || 0,
      scope: form.scope,
      categoryId: form.scope === 'category' ? form.categoryId : '',
      itemId: form.scope === 'item' ? form.itemId : '',
      startsAt: form.startsAt || '',
      endsAt: form.endsAt || '',
      daysOfWeek: form.daysOfWeek || [],
      startTime: form.startTime || '',
      endTime: form.endTime || '',
      autoApply: form.code ? false : form.autoApply !== false,
      membersOnly: !!form.membersOnly,
      active: form.active !== false,
    })
    setOpen(false)
    toast.success(t('saved'))
  }
  const remove = async () => {
    if (!window.confirm(t('areYouSure'))) return
    await deleteOffer(tenantId, form.id)
    setOpen(false)
    toast.success(t('deleted'))
  }

  const fmtValue = (o) => (o.type === 'percent' ? `${o.value}%` : <Price value={o.value} currency={currency} lang={lang} />)
  const fmtWindow = (o) => {
    const parts = []
    if (o.scope === 'item' && o.itemId) { const it = items.find((x) => x.id === o.itemId); if (it) parts.push(pickLang(it, 'name', lang)) }
    if (o.startTime && o.endTime) parts.push(`${o.startTime}–${o.endTime}`)
    if (o.daysOfWeek?.length) parts.push(o.daysOfWeek.map((d) => DAYS[lang][d]).join('، '))
    if (o.endsAt) parts.push(`${lang === 'ar' ? 'حتى' : 'until'} ${new Date(Number(o.endsAt)).toLocaleDateString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US')}`)
    if (o.code) parts.push(o.code)
    return parts.join(' · ')
  }

  if (offers === null) return <Spinner />

  return (
    <div className="page stack">
      <div className="row-between">
        <h2 className="page-title">{t('offers')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm btn-outline" onClick={() => setAdvisorOpen(true)} title={lang === 'ar' ? 'اقتراحات عروض مبنية على مبيعاتك الفعلية' : 'Offer ideas from your real sales'}>
            <Icon name="sparkles" size={14} /> {lang === 'ar' ? 'مستشار العروض' : 'Offer advisor'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={openNew}>+ {t('addOffer')}</button>
        </div>
      </div>

      {advisorOpen && (
        <Suspense fallback={null}>
          <SmartOfferAdvisor
            open onClose={() => setAdvisorOpen(false)}
            orders={advOrders} items={items} materials={advMaterials} offers={offers}
            lang={lang} currency={currency}
            onCreateOffer={(draft) => { setAdvisorOpen(false); openNewFromDraft(draft) }}
          />
        </Suspense>
      )}

      {offers.length === 0 ? (
        <Empty icon="offers" title={lang === 'ar' ? 'لا توجد عروض' : 'No offers'} action={<button className="btn btn-primary" onClick={openNew}>+ {t('addOffer')}</button>} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {offers.map((o) => (
            <button key={o.id} className="list-row" onClick={() => openEdit(o)}>
              <Icon name="offers" size={22} />
              <div className="grow">
                <div className="bold">{pickLang(o, 'name', lang)} <span className="badge badge-gold">{fmtValue(o)}</span></div>
                {fmtWindow(o) && <div className="xs faint">{fmtWindow(o)}</div>}
              </div>
              <span className={`badge ${o.active ? 'badge-success' : 'badge-danger'}`}>{o.active ? t('active') : t('inactive')}</span>
            </button>
          ))}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={form?.id ? t('edit') : t('addOffer')}
        footer={
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            {form?.id && <button className="btn btn-danger" onClick={remove}><Icon name="delete" size={18} /></button>}
            <button className="btn btn-primary grow" onClick={save}>{t('save')}</button>
          </div>
        }>
        {form && (
          <div className="stack">
            <div className="field">
              <label>{t('offerName')}</label>
              <input className="input" value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} placeholder={lang === 'ar' ? 'مثال: ساعة سعيدة' : 'e.g. Happy Hour'} />
            </div>

            <div className="row" style={{ gap: 'var(--sp-3)' }}>
              <div className="field grow">
                <label>{t('offerType')}</label>
                <div className="segmented">
                  <button className={form.type === 'percent' ? 'active' : ''} onClick={() => set('type', 'percent')}>{t('percent')}</button>
                  <button className={form.type === 'fixed' ? 'active' : ''} onClick={() => set('type', 'fixed')}>{t('fixed')}</button>
                </div>
              </div>
              <div className="field" style={{ maxWidth: 110 }}>
                <label>{t('value')} {form.type === 'percent' ? '%' : `(${currency})`}</label>
                <input className="input num" type="number" value={form.value} onChange={(e) => set('value', e.target.value)} />
              </div>
            </div>

            <div className="field">
              <label>{lang === 'ar' ? 'يُطبّق على' : 'Applies to'}</label>
              <div className="segmented">
                <button className={form.scope === 'cart' ? 'active' : ''} onClick={() => set('scope', 'cart')}>{lang === 'ar' ? 'كل الطلب' : 'Whole cart'}</button>
                <button className={form.scope === 'category' ? 'active' : ''} onClick={() => set('scope', 'category')}>{lang === 'ar' ? 'تصنيف' : 'Category'}</button>
                <button className={form.scope === 'item' ? 'active' : ''} onClick={() => set('scope', 'item')}>{lang === 'ar' ? 'صنف' : 'Item'}</button>
              </div>
            </div>
            {form.scope === 'category' && (
              <div className="field">
                <label>{t('category')}</label>
                <select className="select" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                  <option value="">{t('none')}</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{pickLang(c, 'name', lang)}</option>)}
                </select>
              </div>
            )}
            {form.scope === 'item' && (
              <div className="field">
                <label>{lang === 'ar' ? 'الصنف' : 'Item'}</label>
                <select className="select" value={form.itemId} onChange={(e) => set('itemId', e.target.value)}>
                  <option value="">{t('none')}</option>
                  {items.map((it) => <option key={it.id} value={it.id}>{pickLang(it, 'name', lang)}</option>)}
                </select>
              </div>
            )}

            {/* limited-time campaign window (date range) */}
            <div className="field">
              <label>{lang === 'ar' ? 'فترة العرض المحدّدة' : 'Limited-time window'} <span className="faint xs">({t('optional')})</span></label>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input className="input grow" type="datetime-local" value={toLocalInput(form.startsAt)} onChange={(e) => set('startsAt', e.target.value ? new Date(e.target.value).getTime() : '')} />
                <span className="faint">→</span>
                <input className="input grow" type="datetime-local" value={toLocalInput(form.endsAt)} onChange={(e) => set('endsAt', e.target.value ? new Date(e.target.value).getTime() : '')} />
              </div>
            </div>

            {/* happy hour window */}
            <div className="field">
              <label>⏰ {lang === 'ar' ? 'وقت العرض (ساعة سعيدة)' : 'Time window (happy hour)'} <span className="faint xs">({t('optional')})</span></label>
              <div className="row" style={{ gap: 8 }}>
                <input className="input" type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
                <span className="faint">→</span>
                <input className="input" type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>{lang === 'ar' ? 'أيام العرض' : 'Active days'} <span className="faint xs">({lang === 'ar' ? 'فارغ=كل الأيام' : 'empty=all days'})</span></label>
              <div className="row wrap" style={{ gap: 6 }}>
                {DAYS[lang].map((d, i) => (
                  <button key={i} className={`chip ${form.daysOfWeek.includes(i) ? 'active' : ''}`} onClick={() => toggleDay(i)}>{d}</button>
                ))}
              </div>
            </div>

            <div className="row" style={{ gap: 'var(--sp-3)' }}>
              <div className="field grow">
                <label>{t('couponCode')} <span className="faint">({t('optional')})</span></label>
                <input className="input" dir="ltr" value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="WELCOME10" />
              </div>
              <div className="field" style={{ maxWidth: 120 }}>
                <label>{lang === 'ar' ? 'حد أدنى' : 'Min'}</label>
                <input className="input num" type="number" value={form.minSubtotal} onChange={(e) => set('minSubtotal', e.target.value)} />
              </div>
            </div>

            <label className="row-between" style={{ cursor: 'pointer' }}>
              <span className="small">{t('active')}</span>
              <input type="checkbox" checked={form.active !== false} onChange={(e) => set('active', e.target.checked)} style={{ width: 22, height: 22 }} />
            </label>
            <label className="row-between" style={{ cursor: 'pointer' }}>
              <span className="small"><Icon name="award" size={13} style={{ verticalAlign: 'middle', marginInlineEnd: 4 }} /> {lang === 'ar' ? 'حصري لأعضاء VIP' : 'VIP members only'}</span>
              <input type="checkbox" checked={!!form.membersOnly} onChange={(e) => set('membersOnly', e.target.checked)} style={{ width: 22, height: 22 }} />
            </label>
            <p className="xs faint">
              {form.code
                ? (lang === 'ar' ? 'يُطبّق عند إدخال الكود في السلة.' : 'Applied when the code is entered at cart.')
                : (lang === 'ar' ? 'بدون كود = يُطبّق تلقائياً عند توفّر شروطه.' : 'No code = auto-applied when conditions match.')}
            </p>
          </div>
        )}
      </Sheet>
    </div>
  )
}
