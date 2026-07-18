import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { Price } from '../../components/Riyal.jsx'
import Sheet from '../../components/Sheet.jsx'
import Icon from '../../components/Icon.jsx'
import { watchMaterials, saveMaterial, deleteMaterial, receiveStock, countStock, wasteStock, watchSuppliers, produceMaterial } from '../../lib/db.js'
import { BASE_UNITS, unitsForBase, standardFactor, toBase, fmtBaseQty, unitLabel } from '../../lib/units.js'
import RecipeEditor from '../../components/RecipeEditor.jsx'

const blank = () => ({ nameAr: '', nameEn: '', baseUnit: 'g', reorderLevel: '', parLevel: '', purchaseUnit: 'kg', purchaseFactor: 1000, category: '', expiryDate: '', subRecipe: [], yieldQty: '' })

// Raw-material inventory: stock in a base unit (g/ml/pc), received in purchase units, weighted avg cost.
export default function Materials() {
  const { lang } = useI18n()
  const { tenantId, tenant, profile } = useAuth()
  const ar = lang === 'ar'
  const currency = tenant?.currency || 'SAR'
  const actor = profile?.displayName || profile?.email || ''
  const [mats, setMats] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [q, setQ] = useState('')
  const [form, setForm] = useState(null) // add/edit material
  const [op, setOp] = useState(null) // { material, kind:'receive'|'count'|'waste' }
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkCounts, setBulkCounts] = useState({})
  const [statusFilter, setStatusFilter] = useState('all') // all | stable | low | out

  useEffect(() => { if (!tenantId) return; const u1 = watchMaterials(tenantId, setMats); const u2 = watchSuppliers(tenantId, setSuppliers); return () => { u1(); u2() } }, [tenantId])

  const totalValue = useMemo(() => {
    return (mats || []).reduce((s, m) => s + (m.stockQty || 0) * (m.avgCost || 0), 0)
  }, [mats])

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    let list = mats || []
    if (term) list = list.filter((m) => `${m.nameAr || ''} ${m.nameEn || ''}`.toLowerCase().includes(term))
    if (statusFilter === 'low') {
      list = list.filter((m) => (m.stockQty || 0) > 0 && (m.stockQty || 0) <= (Number(m.reorderLevel) || 0))
    } else if (statusFilter === 'out') {
      list = list.filter((m) => (m.stockQty || 0) <= 0)
    } else if (statusFilter === 'stable') {
      list = list.filter((m) => (m.stockQty || 0) > (Number(m.reorderLevel) || 0))
    }
    return list
  }, [mats, q, statusFilter])

  const lowCount = useMemo(() => (mats || []).filter((m) => (m.stockQty || 0) <= (Number(m.reorderLevel) || 0)).length, [mats])

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const onBaseChange = (u) => setForm((f) => {
    const units = unitsForBase(u)
    const pu = units.includes(f.purchaseUnit) ? f.purchaseUnit : u
    return { ...f, baseUnit: u, purchaseUnit: pu, purchaseFactor: standardFactor(u, pu) || 1 }
  })
  const onPurchaseUnitChange = (u) => setForm((f) => ({ ...f, purchaseUnit: u, purchaseFactor: standardFactor(f.baseUnit, u) || f.purchaseFactor || 1 }))

  const saveForm = async () => {
    if (!form.nameAr?.trim() && !form.nameEn?.trim()) return
    await saveMaterial(tenantId, form.id, {
      nameAr: (form.nameAr || '').trim(), nameEn: (form.nameEn || '').trim(),
      baseUnit: form.baseUnit, reorderLevel: Number(form.reorderLevel) || 0, parLevel: Number(form.parLevel) || 0,
      purchaseUnit: form.purchaseUnit, purchaseFactor: Number(form.purchaseFactor) || 1,
      category: (form.category || '').trim(), expiryDate: form.expiryDate || '',
      subRecipe: (form.subRecipe || []).filter((l) => l.materialId && Number(l.qty) > 0).map((l) => ({ materialId: l.materialId, qty: Number(l.qty) })),
      yieldQty: Number(form.yieldQty) || 0,
    })
    setForm(null)
  }
  const remove = async () => { if (window.confirm(ar ? 'حذف هذه المادة؟' : 'Delete material?')) { await deleteMaterial(tenantId, form.id); setForm(null) } }
  const openBulk = () => { const m = {}; (mats || []).forEach((x) => { m[x.id] = String(x.stockQty || 0) }); setBulkCounts(m); setBulkOpen(true) }
  const submitBulk = async () => {
    for (const x of (mats || [])) {
      const raw = bulkCounts[x.id]
      if (raw === undefined) continue
      const v = Number(raw) || 0
      if (v !== (x.stockQty || 0)) await countStock(tenantId, x.id, { countedBase: v, actor })
    }
    setBulkOpen(false)
  }

  if (mats === null) return <Spinner />

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      {/* Overview stats */}
      <div className="stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-3)' }}>
        <div className="stat card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', borderLeft: '4px solid var(--brand)', boxShadow: 'var(--sh-1)' }}>
          <div className="center" style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)' }}>
            <Icon name="inventory" size={20} />
          </div>
          <div>
            <div className="xs faint">{ar ? 'إجمالي المواد' : 'Total Materials'}</div>
            <div className="value bold" style={{ fontSize: 'var(--fs-lg)', lineHeight: 1.2 }}>{mats.length}</div>
          </div>
        </div>
        
        <div className="stat card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', borderLeft: `4px solid ${lowCount > 0 ? 'var(--danger)' : 'var(--success)'}`, boxShadow: 'var(--sh-1)' }}>
          <div className="center" style={{ width: 40, height: 40, borderRadius: '50%', background: lowCount > 0 ? 'var(--danger-soft)' : 'var(--success-soft)', color: lowCount > 0 ? 'var(--danger)' : 'var(--success)' }}>
            <Icon name="warning" size={20} />
          </div>
          <div>
            <div className="xs faint">{ar ? 'نقص المخزون' : 'Low Stock Alert'}</div>
            <div className="value bold" style={{ fontSize: 'var(--fs-lg)', lineHeight: 1.2, color: lowCount > 0 ? 'var(--danger)' : 'var(--success)' }}>{lowCount}</div>
          </div>
        </div>
        
        <div className="stat card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', borderLeft: '4px solid var(--gold)', boxShadow: 'var(--sh-1)' }}>
          <div className="center" style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--warning-soft)', color: 'var(--gold)' }}>
            <Icon name="wallet" size={20} />
          </div>
          <div>
            <div className="xs faint">{ar ? 'قيمة المستودع' : 'Stock Value'}</div>
            <div className="value bold num" style={{ fontSize: 'var(--fs-lg)', lineHeight: 1.2 }}><Price value={totalValue} currency={currency} lang={lang} /></div>
          </div>
        </div>
      </div>

      <div className="row-between wrap" style={{ gap: 'var(--sp-3)' }}>
        {/* Quick status filter pills */}
        <div className="row wrap" style={{ gap: 6 }}>
          {[
            { id: 'all', lbl: ar ? 'الكل' : 'All', count: mats.length, color: 'var(--text-muted)' },
            { id: 'stable', lbl: ar ? 'مستقر' : 'Stable', count: mats.filter(m => (m.stockQty || 0) > (Number(m.reorderLevel) || 0)).length, color: 'var(--success)' },
            { id: 'low', lbl: ar ? 'منخفض' : 'Low Stock', count: lowCount, color: 'var(--warning)' },
            { id: 'out', lbl: ar ? 'نفد' : 'Out of Stock', count: mats.filter(m => (m.stockQty || 0) <= 0).length, color: 'var(--danger)' }
          ].map((f) => (
            <button
              key={f.id}
              className={`btn btn-sm ${statusFilter === f.id ? 'btn-primary' : 'btn-outline'}`}
              style={{
                borderRadius: 'var(--r-pill)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 12px',
                borderColor: statusFilter === f.id ? undefined : 'var(--border)'
              }}
              onClick={() => setStatusFilter(f.id)}
            >
              <span>{f.lbl}</span>
              <span
                className="xs num"
                style={{
                  background: statusFilter === f.id ? 'rgba(255,255,255,0.22)' : 'var(--surface-2)',
                  padding: '1px 6px',
                  borderRadius: 'var(--r-pill)',
                  color: statusFilter === f.id ? '#fff' : f.color,
                  fontWeight: 700
                }}
              >
                {f.count}
              </span>
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 6 }}>
          {mats.length > 0 && <button className="btn btn-sm btn-outline" style={{ borderRadius: 'var(--r-md)' }} onClick={openBulk}><Icon name="tables" size={14} /> {ar ? 'جرد شامل' : 'Bulk count'}</button>}
          <button className="btn btn-sm btn-primary" style={{ borderRadius: 'var(--r-md)' }} onClick={() => setForm(blank())}><Icon name="add" size={14} /> {ar ? 'مادة جديدة' : 'Add Material'}</button>
        </div>
      </div>

      {mats.length > 0 && (
        <div className="row" style={{ position: 'relative' }}>
          <input className="input" style={{ paddingInlineStart: 'var(--sp-10)', borderRadius: 'var(--r-md)' }} placeholder={ar ? 'ابحث باسم المادة الخام...' : 'Search raw materials...'} value={q} onChange={(e) => setQ(e.target.value)} />
          <div style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }}><Icon name="search" size={16} /></div>
        </div>
      )}

      {shown.length === 0 ? (
        <Empty icon="inventory" title={ar ? 'لا مواد مطابقة' : 'No matching materials'} hint={ar ? 'جرّب تعديل البحث أو إضافة مادة جديدة' : 'Try adjusting the search or add a new material'} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          {shown.map((m) => {
            const low = (m.stockQty || 0) <= (Number(m.reorderLevel) || 0)
            const empty = (m.stockQty || 0) <= 0
            const stateColor = empty ? 'var(--danger)' : low ? 'var(--warning)' : 'var(--success)'
            const stateBg = empty ? 'var(--danger-soft)' : low ? 'var(--warning-soft)' : 'var(--success-soft)'
            
            return (
              <div
                key={m.id}
                className="card card-pad stack"
                style={{
                  borderLeft: `4px solid ${stateColor}`,
                  boxShadow: 'var(--sh-1)',
                  gap: 'var(--sp-2)',
                  position: 'relative',
                  transition: 'all var(--dur-fast) var(--ease)'
                }}
              >
                {/* Header info */}
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div className="stack" style={{ gap: 4 }}>
                    <div className="bold row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 'var(--fs-base)' }}>{ar ? m.nameAr : (m.nameEn || m.nameAr)}</span>
                      {m.category && (
                        <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', padding: '2px 8px', borderRadius: 'var(--r-sm)' }}>
                          {m.category}
                        </span>
                      )}
                      {empty ? (
                        <span className="badge badge-danger" style={{ fontSize: 'var(--fs-xs)' }}>{ar ? 'نفد' : 'Out'}</span>
                      ) : low ? (
                        <span className="badge badge-gold" style={{ fontSize: 'var(--fs-xs)' }}>{ar ? 'منخفض' : 'Low'}</span>
                      ) : (
                        <span className="badge" style={{ background: 'var(--success-soft)', color: 'var(--success)', fontSize: 'var(--fs-xs)' }}>{ar ? 'مستقر' : 'Stable'}</span>
                      )}
                    </div>
                    <div className="xs faint row wrap" style={{ gap: 8 }}>
                      <span>{ar ? 'الوحدة الأساسية:' : 'Base:'} <strong className="num">{unitLabel(m.baseUnit, lang)}</strong></span>
                      {m.purchaseUnit && (
                        <span>· {ar ? 'وحدة الشراء:' : 'Purchase:'} <strong className="num">{m.purchaseUnit === '__custom' ? (m.purchaseUnitName || (ar ? 'وحدة' : 'unit')) : unitLabel(m.purchaseUnit, lang)}</strong></span>
                      )}
                      {m.expiryDate && (
                        <span style={{ color: 'var(--danger)' }}>· {ar ? 'انتهاء:' : 'Expiry:'} <strong className="num">{m.expiryDate}</strong></span>
                      )}
                    </div>
                  </div>
                  
                  <button className="icon-btn xs" style={{ opacity: 0.6 }} onClick={() => setForm({ ...blank(), ...m })} title={ar ? 'تعديل' : 'Edit'}>
                    <Icon name="edit" size={15} />
                  </button>
                </div>

                {/* Stock Gauge */}
                <div className="stack" style={{ gap: 4 }}>
                  <div className="row-between xs">
                    <span>{ar ? 'الرصيد الفعلي:' : 'Physical Stock:'} <strong className="num" style={{ fontSize: 'var(--fs-md)', color: low ? 'var(--danger)' : 'var(--text)' }}>{fmtBaseQty(m.stockQty || 0, m.baseUnit, lang)}</strong></span>
                    {m.parLevel > 0 && <span className="faint">{ar ? 'المستوى المستهدف (Par):' : 'Par Level:'} <span className="num">{fmtBaseQty(m.parLevel, m.baseUnit, lang)}</span></span>}
                  </div>
                  {m.parLevel > 0 && (
                    <div style={{ width: '100%', height: 6, background: 'var(--bg-2)', borderRadius: 3, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.min(100, ((m.stockQty || 0) / m.parLevel) * 100)}%`,
                          height: '100%',
                          background: stateColor,
                          borderRadius: 3
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Avg Cost info */}
                {m.avgCost ? (
                  <div className="row-between xs rounded" style={{ background: 'var(--surface-2)', padding: '6px 10px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
                    <span className="faint">{ar ? 'متوسط تكلفة الوحدة:' : 'Avg Cost per unit:'}</span>
                    <strong className="num">
                      <Price value={(m.avgCost || 0) * (m.baseUnit === 'pc' ? 1 : 1000)} currency={currency} lang={lang} />
                      {' / '}
                      {unitLabel(m.baseUnit === 'g' ? 'kg' : m.baseUnit === 'ml' ? 'l' : 'pc', lang)}
                    </strong>
                  </div>
                ) : null}

                {/* Actions row */}
                <div className="row wrap" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                  {m.subRecipe?.length > 0 && (
                    <button className="btn btn-sm btn-outline grow" style={{ background: 'var(--brand-soft)', color: 'var(--brand)', borderColor: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }} onClick={() => setOp({ material: m, kind: 'produce' })}>
                      <Icon name="store" size={13} /> <span>{ar ? 'إنتاج' : 'Produce'}</span>
                    </button>
                  )}
                  <button className="btn btn-sm btn-outline grow" style={{ background: 'var(--success-soft)', color: 'var(--success)', borderColor: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }} onClick={() => setOp({ material: m, kind: 'receive' })}>
                    <Icon name="add" size={13} /> <span>{ar ? 'استلام' : 'Receive'}</span>
                  </button>
                  <button className="btn btn-sm btn-outline grow" style={{ background: 'var(--info-soft)', color: 'var(--info)', borderColor: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }} onClick={() => setOp({ material: m, kind: 'tables' })}>
                    <Icon name="check" size={13} /> <span>{ar ? 'جرد' : 'Count'}</span>
                  </button>
                  <button className="btn btn-sm btn-outline grow" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', borderColor: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }} onClick={() => setOp({ material: m, kind: 'waste' })}>
                    <Icon name="close" size={13} /> <span>{ar ? 'هدر' : 'Waste'}</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* add / edit material */}
      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.id ? (ar ? 'تعديل مادة' : 'Edit material') : (ar ? 'مادة جديدة' : 'New material')}>
        {form && (
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            <div className="row" style={{ gap: 8 }}>
              <div className="field grow"><label>{ar ? 'الاسم (ع)' : 'Name (AR)'}</label><input className="input" value={form.nameAr} onChange={(e) => setF('nameAr', e.target.value)} /></div>
              <div className="field grow"><label>{ar ? 'الاسم (EN)' : 'Name (EN)'}</label><input className="input" dir="ltr" value={form.nameEn} onChange={(e) => setF('nameEn', e.target.value)} /></div>
            </div>
            <div className="field"><label>{ar ? 'وحدة التخزين الأساسية' : 'Base unit'}</label>
              <div className="segmented">{BASE_UNITS.map((u) => <button key={u} className={form.baseUnit === u ? 'active' : ''} onClick={() => onBaseChange(u)}>{unitLabel(u, lang)}</button>)}</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <div className="field grow"><label>{ar ? 'وحدة الشراء' : 'Purchase unit'}</label>
                <select className="select" value={form.purchaseUnit} onChange={(e) => onPurchaseUnitChange(e.target.value)}>
                  {unitsForBase(form.baseUnit).map((u) => <option key={u} value={u}>{unitLabel(u, lang)}</option>)}
                  <option value="__custom">{ar ? 'مخصّص (صندوق/كيس…)' : 'Custom (box/bag…)'}</option>
                </select>
              </div>
              <div className="field" style={{ maxWidth: 160 }}><label>{ar ? `${unitLabel(form.baseUnit, lang)} لكل وحدة شراء` : `${unitLabel(form.baseUnit, lang)} per purchase unit`}</label><input className="input num" type="number" value={form.purchaseFactor} onChange={(e) => setF('purchaseFactor', e.target.value)} /></div>
            </div>
            {form.purchaseUnit === '__custom' && <div className="field"><label>{ar ? 'اسم وحدة الشراء' : 'Purchase unit name'}</label><input className="input" value={form.purchaseUnitName || ''} onChange={(e) => setF('purchaseUnitName', e.target.value)} placeholder={ar ? 'صندوق' : 'box'} /></div>}
            <div className="row" style={{ gap: 8 }}>
              <div className="field grow"><label>{ar ? `حد إعادة الطلب (${unitLabel(form.baseUnit, lang)})` : `Reorder level (${unitLabel(form.baseUnit, lang)})`}</label><input className="input num" type="number" value={form.reorderLevel} onChange={(e) => setF('reorderLevel', e.target.value)} /></div>
              <div className="field grow"><label>{ar ? `مستوى Par (${unitLabel(form.baseUnit, lang)})` : `Par level (${unitLabel(form.baseUnit, lang)})`}</label><input className="input num" type="number" value={form.parLevel} onChange={(e) => setF('parLevel', e.target.value)} /></div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <div className="field grow"><label>{ar ? 'التصنيف' : 'Category'}</label><input className="input" value={form.category} onChange={(e) => setF('category', e.target.value)} /></div>
              <div className="field grow"><label>{ar ? 'الصلاحية' : 'Expiry'}</label><input className="input" type="date" value={form.expiryDate} onChange={(e) => setF('expiryDate', e.target.value)} /></div>
            </div>
            <div className="field">
              <label>{ar ? 'وصفة فرعية (مصنّع داخلياً)' : 'Sub-recipe (made in-house)'} <span className="faint xs">({ar ? 'يُحضَّر من مواد أخرى' : 'made from other materials'})</span></label>
              <RecipeEditor lang={lang} variants={[]} materials={(mats || []).filter((x) => x.id !== form.id)} recipe={form.subRecipe || []} variantRecipes={{}} onChange={({ recipe }) => setF('subRecipe', recipe)} />
            </div>
            {(form.subRecipe || []).length > 0 && <div className="field" style={{ maxWidth: 220 }}><label>{ar ? `الناتج لكل دفعة (${unitLabel(form.baseUnit, lang)})` : `Yield per batch (${unitLabel(form.baseUnit, lang)})`}</label><input className="input num" type="number" value={form.yieldQty} onChange={(e) => setF('yieldQty', e.target.value)} /></div>}
            <button className="btn btn-primary btn-block" onClick={saveForm}>{ar ? 'حفظ' : 'Save'}</button>
            {form.id && <button className="btn btn-outline btn-block" style={{ color: 'var(--danger)' }} onClick={remove}>{ar ? 'حذف' : 'Delete'}</button>}
          </div>
        )}
      </Sheet>

      <Sheet open={bulkOpen} onClose={() => setBulkOpen(false)} title={ar ? 'جرد شامل' : 'Bulk count'}>
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <p className="xs faint">{ar ? 'أدخل العدّ الفعلي لكل مادة (بوحدتها الأساسية).' : 'Enter the actual counted amount per material (base unit).'}</p>
          {(mats || []).map((m) => (
            <div key={m.id} className="row-between" style={{ gap: 8 }}>
              <span className="small grow">{ar ? m.nameAr : (m.nameEn || m.nameAr)} <span className="xs faint">({unitLabel(m.baseUnit, lang)})</span></span>
              <input className="input num" style={{ width: 96 }} type="number" value={bulkCounts[m.id] ?? ''} onChange={(e) => setBulkCounts((b) => ({ ...b, [m.id]: e.target.value }))} />
            </div>
          ))}
          <button className="btn btn-primary btn-block" onClick={submitBulk}>{ar ? 'حفظ الجرد' : 'Save count'}</button>
        </div>
      </Sheet>

      <StockOpSheet op={op} onClose={() => setOp(null)} tenantId={tenantId} actor={actor} currency={currency} lang={lang} suppliers={suppliers} />
    </div>
  )
}

// Receive / count / waste a single material.
function StockOpSheet({ op, onClose, tenantId, actor, currency, lang, suppliers = [] }) {
  const ar = lang === 'ar'
  const toast = useToast()
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')
  const [reason, setReason] = useState('')
  const [supplierId, setSupplierId] = useState('')
  useEffect(() => { setQty(''); setCost(''); setReason(''); setSupplierId('') }, [op])
  if (!op) return null
  const m = op.material
  const puName = m.purchaseUnit === '__custom' ? (m.purchaseUnitName || (ar ? 'وحدة' : 'unit')) : unitLabel(m.purchaseUnit, lang)
  const baseName = unitLabel(m.baseUnit, lang)
  const title = op.kind === 'receive' ? (ar ? 'استلام بضاعة' : 'Receive stock') : op.kind === 'count' ? (ar ? 'جرد فعلي' : 'Physical count') : op.kind === 'produce' ? (ar ? 'إنتاج دفعة' : 'Produce batch') : (ar ? 'هدر/تالف' : 'Waste')

  const submit = async () => {
    try {
      if (op.kind === 'receive') {
        const qtyBase = toBase(qty, m.purchaseUnit === '__custom' ? '' : m.purchaseUnit, m.baseUnit, Number(m.purchaseFactor) || 1)
        await receiveStock(tenantId, m.id, { qtyBase, totalCost: Number(cost) || 0, actor, supplierId })
      } else if (op.kind === 'count') {
        await countStock(tenantId, m.id, { countedBase: Number(qty) || 0, actor })
      } else if (op.kind === 'produce') {
        await produceMaterial(tenantId, m.id, { batches: Number(qty) || 1, actor })
      } else {
        await wasteStock(tenantId, m.id, { qtyBase: Number(qty) || 0, reason: reason.trim(), actor })
      }
      toast?.success?.(ar ? 'تم' : 'Done')
      onClose?.()
    } catch (_) { toast?.error?.(ar ? 'تعذّر' : 'Failed') }
  }

  return (
    <Sheet open={!!op} onClose={onClose} title={`${title} — ${ar ? m.nameAr : (m.nameEn || m.nameAr)}`}>
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        <div className="row-between xs faint"><span>{ar ? 'الرصيد الحالي' : 'Current'}</span><span>{fmtBaseQty(m.stockQty || 0, m.baseUnit, lang)}</span></div>
        {op.kind === 'receive' ? (
          <>
            <div className="field"><label>{ar ? `الكمية (${puName})` : `Quantity (${puName})`}</label><input className="input num" type="number" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            <div className="field"><label>{ar ? 'التكلفة الإجمالية' : 'Total cost'}</label><input className="input num" type="number" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
            {suppliers.length > 0 && (
              <div className="field"><label>{ar ? 'المورّد' : 'Supplier'}</label>
                <select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">{ar ? '— بدون —' : '— none —'}</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <p className="xs faint">= {fmtBaseQty(toBase(qty, m.purchaseUnit === '__custom' ? '' : m.purchaseUnit, m.baseUnit, Number(m.purchaseFactor) || 1), m.baseUnit, lang)}</p>
          </>
        ) : op.kind === 'count' ? (
          <div className="field"><label>{ar ? `العدّ الفعلي (${baseName})` : `Counted (${baseName})`}</label><input className="input num" type="number" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        ) : op.kind === 'produce' ? (
          <>
            <div className="field"><label>{ar ? 'عدد الدفعات' : 'Batches'}</label><input className="input num" type="number" min="1" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            <p className="xs faint">{ar ? 'الناتج' : 'Yields'}: {fmtBaseQty((Number(m.yieldQty) || 0) * (Number(qty) || 1), m.baseUnit, lang)}</p>
          </>
        ) : (
          <>
            <div className="field"><label>{ar ? `الكمية التالفة (${baseName})` : `Wasted (${baseName})`}</label><input className="input num" type="number" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            <div className="field"><label>{ar ? 'السبب' : 'Reason'}</label><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          </>
        )}
        <button className="btn btn-primary btn-block" onClick={submit}>{ar ? 'تأكيد' : 'Confirm'}</button>
      </div>
    </Sheet>
  )
}
