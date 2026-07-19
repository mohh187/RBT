import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { watchCustomers, mergeCustomers, getCustomerByPhone } from '../../lib/db.js'
import Sheet from '../../components/Sheet.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Price } from '../../components/Riyal.jsx'
import Icon from '../../components/Icon.jsx'
import CustomerCard from '../../components/CustomerCard.jsx'
import { TIER_META } from '../../lib/membership.js'

export default function Customers() {
  const { t, lang } = useI18n()
  const { tenantId, tenant } = useAuth()
  const currency = tenant?.currency || 'SAR'
  const [customers, setCustomers] = useState(null)
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState(null)
  // Segment by activity (completed orders) or by membership tier — the owner's
  // "who are my regulars?" question in one tap. Sorted by orders desc when segmenting.
  const [seg, setSeg] = useState('all') // all | active5 | orders10 | orders15 | silver | gold | platinum
  const toast = useToast()
  // duplicate merge: same person, two phone records → one
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeKeep, setMergeKeep] = useState('')
  const [mergeDup, setMergeDup] = useState('')
  const [mergeBusy, setMergeBusy] = useState(false)
  const doMerge = async () => {
    if (!mergeKeep || !mergeDup || mergeKeep === mergeDup) { toast.error(lang === 'ar' ? 'اختر عميلين مختلفين' : 'Pick two different customers'); return }
    const keep = customers.find((c) => c.id === mergeKeep)
    const dup = customers.find((c) => c.id === mergeDup)
    if (!window.confirm(lang === 'ar' ? `دمج «${dup?.name || dup?.phone}» داخل «${keep?.name || keep?.phone}»؟ تُجمع الطلبات والنقاط ويُحذف السجل المكرر — لا يمكن التراجع.` : `Merge "${dup?.name || dup?.phone}" into "${keep?.name || keep?.phone}"? Irreversible.`)) return
    setMergeBusy(true)
    try {
      await mergeCustomers(tenantId, keep.phone || keep.id, dup.phone || dup.id)
      toast.success(lang === 'ar' ? 'تم الدمج' : 'Merged')
      setMergeOpen(false); setMergeKeep(''); setMergeDup('')
    } catch (_) { toast.error(t('error')) }
    finally { setMergeBusy(false) }
  }

  useEffect(() => {
    if (!tenantId) return
    return watchCustomers(tenantId, setCustomers)
  }, [tenantId])

  // Deep-link (bell / OS notification): ?id=<customerId> opens that customer's
  // profile sheet. Freshly self-registered customers may not be in the
  // lastOrderAt-ordered list yet, so fall back to a direct lookup by id (=phone).
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const want = params.get('id')
    if (!want || customers === null) return
    const p = new URLSearchParams(params); p.delete('id'); setParams(p, { replace: true })
    const c = customers.find((x) => x.id === want)
    if (c) { setSel({ phone: c.phone || c.id, name: c.name }); return }
    getCustomerByPhone(tenantId, want).then((found) => {
      if (found) setSel({ phone: found.phone || want, name: found.name })
      else toast.error(lang === 'ar' ? 'العنصر لم يعد موجوداً' : 'Item no longer exists')
    }).catch(() => {})
  }, [params, customers])

  const shown = useMemo(() => {
    let list = customers || []
    if (seg === 'active5') list = list.filter((c) => (c.totalOrders || 0) >= 5)
    else if (seg === 'orders10') list = list.filter((c) => (c.totalOrders || 0) >= 10)
    else if (seg === 'orders15') list = list.filter((c) => (c.totalOrders || 0) >= 15)
    else if (['silver', 'gold', 'platinum'].includes(seg)) list = list.filter((c) => c.membership?.active && c.membership.tier === seg)
    if (seg !== 'all') list = [...list].sort((a, b) => (b.totalOrders || 0) - (a.totalOrders || 0))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((c) => `${c.name || ''} ${c.phone || ''}`.toLowerCase().includes(q))
    }
    return list
  }, [customers, search, seg])

  const totals = useMemo(() => {
    const list = customers || []
    return {
      count: list.length,
      spent: list.reduce((s, c) => s + (c.totalSpent || 0), 0),
    }
  }, [customers])

  const memberStats = useMemo(() => {
    const list = (customers || []).filter((c) => c.membership?.active)
    const byTier = { silver: 0, gold: 0, platinum: 0 }
    let points = 0
    let redeemed = 0
    list.forEach((c) => {
      const m = c.membership
      byTier[m.tier] = (byTier[m.tier] || 0) + 1
      points += m.points || 0
      redeemed += m.pointsRedeemed || 0
    })
    return { count: list.length, byTier, points, redeemed }
  }, [customers])

  const exportCsv = () => {
    const rows = [['name', 'phone', 'orders', 'spent', 'drinks']]
    ;(customers || []).forEach((c) => rows.push([c.name || '', c.phone || '', c.totalOrders || 0, c.totalSpent || 0, c.totalDrinks || 0]))
    const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'customers.csv'
    a.click()
  }

  if (customers === null) return <Spinner />

  return (
    <div className="page stack">
      <div className="row-between">
        <h2 className="page-title">{t('customers')}</h2>
        <div className="row" style={{ gap: 6 }}>
          {customers.length > 1 && <button className="btn btn-sm btn-outline" onClick={() => setMergeOpen(true)}><Icon name="repeat" size={14} /> {lang === 'ar' ? 'دمج مكرر' : 'Merge dupes'}</button>}
          {customers.length > 0 && <button className="btn btn-sm btn-outline" onClick={exportCsv}><Icon name="download" size={16} /> CSV</button>}
        </div>
      </div>

      <Sheet open={mergeOpen} onClose={() => setMergeOpen(false)} title={lang === 'ar' ? 'دمج عميل مكرر' : 'Merge duplicate customer'}
        footer={<button className="btn btn-primary btn-lg btn-block" disabled={mergeBusy} onClick={doMerge}>{mergeBusy ? t('saving') : (lang === 'ar' ? 'دمج' : 'Merge')}</button>}>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <p className="muted small">{lang === 'ar' ? 'نفس الشخص برقمين؟ تُجمع طلباته ونقاطه في السجل الأساسي ويُحذف المكرر نهائياً.' : 'Same person with two numbers? Orders & points sum into the primary; the duplicate is deleted.'}</p>
          <div className="field">
            <label>{lang === 'ar' ? 'السجل الأساسي (يبقى)' : 'Primary (kept)'}</label>
            <select className="select" value={mergeKeep} onChange={(e) => setMergeKeep(e.target.value)}>
              <option value="">{lang === 'ar' ? 'اختر…' : 'Pick…'}</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name || (lang === 'ar' ? 'بدون اسم' : 'No name')} · {c.phone} · {c.totalOrders || 0} {lang === 'ar' ? 'طلب' : 'orders'}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{lang === 'ar' ? 'السجل المكرر (يُحذف بعد الدمج)' : 'Duplicate (deleted after merge)'}</label>
            <select className="select" value={mergeDup} onChange={(e) => setMergeDup(e.target.value)}>
              <option value="">{lang === 'ar' ? 'اختر…' : 'Pick…'}</option>
              {customers.filter((c) => c.id !== mergeKeep).map((c) => <option key={c.id} value={c.id}>{c.name || (lang === 'ar' ? 'بدون اسم' : 'No name')} · {c.phone} · {c.totalOrders || 0} {lang === 'ar' ? 'طلب' : 'orders'}</option>)}
            </select>
          </div>
        </div>
      </Sheet>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        <div className="stat"><div className="label">{t('totalCustomers')}</div><div className="value num">{totals.count}</div></div>
        <div className="stat"><div className="label">{lang === 'ar' ? 'إجمالي الإنفاق' : 'Total spend'}</div><div className="value price"><Price value={totals.spent} currency={currency} lang={lang} /></div></div>
      </div>

      {memberStats.count > 0 && (
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <strong className="small"><Icon name="award" size={13} style={{ verticalAlign: 'middle', marginInlineEnd: 4 }} /> {lang === 'ar' ? 'تحليلات الولاء' : 'Loyalty analytics'}</strong>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="stat" style={{ flex: '1 0 28%' }}><div className="label">{lang === 'ar' ? 'الأعضاء' : 'Members'}</div><div className="value num">{memberStats.count}</div></div>
            <div className="stat" style={{ flex: '1 0 28%' }}><div className="label">{lang === 'ar' ? 'نقاط قائمة' : 'Points out'}</div><div className="value num">{memberStats.points}</div></div>
            <div className="stat" style={{ flex: '1 0 28%' }}><div className="label">{lang === 'ar' ? 'نقاط مُستبدلة' : 'Redeemed'}</div><div className="value num">{memberStats.redeemed}</div></div>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {['silver', 'gold', 'platinum'].map((tk) => memberStats.byTier[tk] > 0 && (
              <span key={tk} className="badge" style={{ borderColor: TIER_META[tk].color, color: TIER_META[tk].color, background: 'transparent', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name={TIER_META[tk].icon} size={12} /> {lang === 'ar' ? TIER_META[tk].ar : TIER_META[tk].en}: {memberStats.byTier[tk]}</span>
            ))}
          </div>
        </div>
      )}

      {customers.length > 0 && <input className="input" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />}

      {customers.length > 0 && (
        <div className="scroll-x" style={{ gap: 6 }}>
          {[
            ['all', lang === 'ar' ? 'الكل' : 'All'],
            ['active5', lang === 'ar' ? 'نشِط · 5+ طلبات' : 'Active · 5+ orders'],
            ['orders10', lang === 'ar' ? 'مميّز · 10+' : 'Premium · 10+'],
            ['orders15', lang === 'ar' ? 'نخبة · 15+' : 'Elite · 15+'],
            ['silver', lang === 'ar' ? 'فضي' : 'Silver'],
            ['gold', lang === 'ar' ? 'ذهبي' : 'Gold'],
            ['platinum', lang === 'ar' ? 'بلاتيني' : 'Platinum'],
          ].map(([id, label]) => (
            <button key={id} className={`chip ${seg === id ? 'active' : ''}`} onClick={() => setSeg(id)}>
              {['silver', 'gold', 'platinum'].includes(id) && <Icon name="award" size={12} style={{ color: (TIER_META[id] || {}).color }} />} {label}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <Empty icon="customers" title={lang === 'ar' ? 'لا عملاء بعد' : 'No customers yet'} hint={lang === 'ar' ? 'تُسجَّل بيانات العميل تلقائياً عند الطلب مع رقم الجوال' : 'Customers are captured when they order with a phone number'} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {shown.map((c) => (
            <button key={c.id} className="list-row" style={{ width: '100%', textAlign: 'inherit', background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setSel({ phone: c.phone, name: c.name })}>
              <div className="center" style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', fontWeight: 800, position: 'relative' }}>
                {(c.name || c.phone || '?').charAt(0)}
                {c.flagged && <span style={{ position: 'absolute', insetInlineEnd: -2, top: -2, width: 12, height: 12, borderRadius: '50%', background: 'var(--danger)', border: '2px solid var(--surface)' }} />}
              </div>
              <div className="grow">
                <div className="bold" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {c.name || (lang === 'ar' ? 'عميل' : 'Guest')}
                  {c.membership?.active && TIER_META[c.membership.tier] ? <span className="badge" style={{ background: 'transparent', borderColor: TIER_META[c.membership.tier].color, color: TIER_META[c.membership.tier].color, padding: '0 5px' }}>{TIER_META[c.membership.tier].emoji} {lang === 'ar' ? TIER_META[c.membership.tier].ar : TIER_META[c.membership.tier].en}</span> : null}
                  {c.staffRating ? <span className="xs" style={{ color: 'var(--gold, #e0a82e)' }}><Icon name="star" size={11} fill="currentColor" strokeWidth={1.4} /> {c.staffRating}</span> : null}
                </div>
                <div className="xs faint num" dir="ltr">{c.phone}</div>
              </div>
              <div className="text-center">
                <div className="price bold small"><Price value={c.totalSpent} currency={currency} lang={lang} /></div>
                <div className="xs faint">{c.totalOrders || 0} {lang === 'ar' ? 'طلب' : 'orders'}{c.rewards ? ` · ${c.rewards} ${lang === 'ar' ? 'مكافأة' : 'rwd'}` : ''}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {sel && <CustomerCard tid={tenantId} phone={sel.phone} name={sel.name} currency={currency} onClose={() => setSel(null)} />}
    </div>
  )
}
