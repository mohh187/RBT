import { useEffect, useState, useMemo } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { Price } from '../../components/Riyal.jsx'
import { useToast } from '../../components/Toast.jsx'
import Sheet from '../../components/Sheet.jsx'
import Icon from '../../components/Icon.jsx'
import { watchSuppliers, saveSupplier, deleteSupplier, watchPurchaseOrders, createPurchaseOrder, receivePurchaseOrderShipment, watchMaterials } from '../../lib/db.js'
import { unitLabel } from '../../lib/units.js'

const blankSupplier = () => ({ name: '', phone: '', notes: '' })

export default function Suppliers() {
  const { lang } = useI18n()
  const { tenantId, tenant, profile } = useAuth()
  const ar = lang === 'ar'
  const toast = useToast()
  const currency = tenant?.currency || 'SAR'
  const actor = profile?.displayName || profile?.email || ''

  const [subTab, setSubTab] = useState('list') // list | orders
  const [suppliers, setSuppliers] = useState(null)
  const [orders, setOrders] = useState([])
  const [materials, setMaterials] = useState([])

  // Modal sheets states
  const [supplierForm, setSupplierForm] = useState(null)
  const [poFormOpen, setPoFormOpen] = useState(false)
  const [poDetail, setPoDetail] = useState(null)

  // PO creation state
  const [poSupplierId, setPoSupplierId] = useState('')
  const [poLines, setPoLines] = useState([]) // [{ materialId, name, qty, cost, purchaseUnit, factor }]

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchSuppliers(tenantId, setSuppliers)
    const u2 = watchPurchaseOrders(tenantId, setOrders)
    const u3 = watchMaterials(tenantId, setMaterials)
    return () => { u1(); u2(); u3() }
  }, [tenantId])

  const setSF = (k, v) => setSupplierForm((f) => ({ ...f, [k]: v }))
  
  const saveSupplierForm = async () => {
    if (!supplierForm.name?.trim()) return
    await saveSupplier(tenantId, supplierForm.id, {
      name: supplierForm.name.trim(),
      phone: supplierForm.phone || '',
      notes: supplierForm.notes || ''
    })
    setSupplierForm(null)
    toast?.success?.(ar ? 'تم حفظ المورد' : 'Supplier saved')
  }

  const deleteSupplierForm = async () => {
    if (window.confirm(ar ? 'حذف المورّد؟' : 'Delete supplier?')) {
      await deleteSupplier(tenantId, supplierForm.id)
      setSupplierForm(null)
      toast?.success?.(ar ? 'تم الحذف' : 'Deleted')
    }
  }

  // Initialize PO creator
  const openNewPo = () => {
    if (!suppliers?.length) {
      toast?.error?.(ar ? 'أضف مورد واحد على الأقل أولاً' : 'Add at least one supplier first')
      return
    }
    setPoSupplierId(suppliers[0].id)
    setPoLines([])
    setPoFormOpen(true)
  }

  const addPoLine = (mat) => {
    if (poLines.find(x => x.materialId === mat.id)) return
    setPoLines(prev => [...prev, {
      materialId: mat.id,
      name: ar ? mat.nameAr : (mat.nameEn || mat.nameAr),
      qty: 1,
      cost: 0,
      purchaseUnit: mat.purchaseUnit || mat.baseUnit,
      factor: mat.purchaseFactor || 1
    }])
  }

  const removePoLine = (matId) => {
    setPoLines(prev => prev.filter(x => x.materialId !== matId))
  }

  const updatePoLine = (matId, field, val) => {
    setPoLines(prev => prev.map(x => x.materialId === matId ? { ...x, [field]: Number(val) || 0 } : x))
  }

  const submitPo = async () => {
    if (!poSupplierId) return
    const activeLines = poLines.filter(l => l.qty > 0)
    if (!activeLines.length) {
      toast?.error?.(ar ? 'أضف مادة واحدة على الأقل بأمر الشراء' : 'Add at least one material to order')
      return
    }
    const sup = suppliers.find(s => s.id === poSupplierId)
    const payload = {
      supplierId: poSupplierId,
      supplierName: sup ? sup.name : '',
      items: activeLines.map(l => ({
        materialId: l.materialId,
        materialName: l.name,
        qty: l.qty,
        cost: l.cost,
        qtyBase: l.qty * l.factor // convert to base unit (e.g. grams)
      })),
      totalCost: activeLines.reduce((s, l) => s + l.cost, 0),
      createdBy: actor
    }
    await createPurchaseOrder(tenantId, payload)
    setPoFormOpen(false)
    toast?.success?.(ar ? 'تم إنشاء أمر الشراء كمسودة' : 'Purchase order created as draft')
  }

  const receivePo = async (po) => {
    if (window.confirm(ar ? 'تأكيد استلام كامل شحنة أمر الشراء وإضافتها للمخزن؟' : 'Confirm receiving the shipment and updating inventory?')) {
      try {
        await receivePurchaseOrderShipment(tenantId, po.id, actor)
        setPoDetail(null)
        toast?.success?.(ar ? 'تم استلام الشحنة وتحديث المخزون بنجاح!' : 'Shipment received and stock updated!')
      } catch (err) {
        toast?.error?.(ar ? 'فشل استلام الشحنة' : 'Failed to receive')
      }
    }
  }

  if (suppliers === null) return <Spinner />

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      {/* Sub tabs for Suppliers and Purchase Orders */}
      <div className="segmented" style={{ width: 'fit-content' }}>
        <button className={subTab === 'list' ? 'active' : ''} onClick={() => setSubTab('list')}>{ar ? 'قائمة الموردين' : 'Suppliers List'}</button>
        <button className={subTab === 'orders' ? 'active' : ''} onClick={() => setSubTab('orders')}>{ar ? 'أوامر الشراء (POs)' : 'Purchase Orders'}</button>
      </div>

      {/* ============ SUPPLIERS LIST ============ */}
      {subTab === 'list' && (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <div className="row-between">
            <span className="small faint">{suppliers.length} {ar ? 'مورّد' : 'suppliers'}</span>
            <button className="btn btn-sm btn-primary" onClick={() => setSupplierForm(blankSupplier())}><Icon name="add" size={14} /> {ar ? 'مورّد' : 'Supplier'}</button>
          </div>
          {suppliers.length === 0 ? (
            <Empty icon="car" title={ar ? 'لا موردين' : 'No suppliers'} hint={ar ? 'أضف الموردين لمتابعة مشتريات القهوة والحليب' : 'Add suppliers to track purchasing'} />
          ) : (
            suppliers.map((s) => (
              <button key={s.id} className="list-row" style={{ width: '100%', textAlign: 'inherit', cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--border)' }} onClick={() => setSupplierForm({ ...blankSupplier(), ...s })}>
                <div className="grow">
                  <div className="bold">{s.name}</div>
                  {s.phone && <div className="xs faint num" dir="ltr">{s.phone}</div>}
                </div>
                <Icon name="next" size={16} className="faint" />
              </button>
            ))
          )}
        </div>
      )}

      {/* ============ PURCHASE ORDERS ============ */}
      {subTab === 'orders' && (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <div className="row-between">
            <span className="small faint">{orders.length} {ar ? 'طلب شراء' : 'purchase orders'}</span>
            <button className="btn btn-sm btn-primary" onClick={openNewPo}><Icon name="add" size={14} /> {ar ? 'طلب شراء' : 'New PO'}</button>
          </div>
          
          {orders.length === 0 ? (
            <Empty icon="notepad" title={ar ? 'لا يوجد طلبات شراء' : 'No purchase orders'} hint={ar ? 'أرسل أوامر الشراء الرقمية لمورّديك واستلم الشحنات بنقرة واحدة' : 'Create digital purchase orders and receive stock instantly'} />
          ) : (
            <div className="stack" style={{ gap: 'var(--sp-2)' }}>
              {orders.map((po) => {
                const received = po.status === 'received'
                return (
                  <button 
                    key={po.id} 
                    className="card card-pad row-between" 
                    style={{ width: '100%', textAlign: 'inherit', cursor: 'pointer', borderLeft: `4px solid ${received ? 'var(--success)' : 'var(--warning)'}`, boxShadow: 'var(--sh-1)' }}
                    onClick={() => setPoDetail(po)}
                  >
                    <div className="stack" style={{ gap: 4 }}>
                      <div className="bold row" style={{ gap: 8 }}>
                        <span className="num">{po.code}</span>
                        {received ? (
                          <span className="badge badge-success">{ar ? 'مستلمة' : 'Received'}</span>
                        ) : (
                          <span className="badge badge-gold">{ar ? 'مسودة' : 'Draft'}</span>
                        )}
                      </div>
                      <div className="xs faint">{po.supplierName} · {po.items?.length || 0} {ar ? 'مواد' : 'items'}</div>
                    </div>
                    <div className="text-end">
                      <strong className="num" style={{ fontSize: 'var(--fs-md)' }}><Price value={po.totalCost} currency={currency} lang={lang} /></strong>
                      <div className="xs faint num">{po.createdAt?.toMillis ? new Date(po.createdAt.toMillis()).toLocaleDateString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US') : ''}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Supplier Form Sheet */}
      <Sheet open={!!supplierForm} onClose={() => setSupplierForm(null)} title={supplierForm?.id ? (ar ? 'تعديل مورّد' : 'Edit supplier') : (ar ? 'مورّد جديد' : 'New supplier')}>
        {supplierForm && (
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            <div className="field"><label>{ar ? 'الاسم' : 'Name'}</label><input className="input" value={supplierForm.name} onChange={(e) => setSF('name', e.target.value)} /></div>
            <div className="field"><label>{ar ? 'الجوال' : 'Phone'}</label><input className="input num" dir="ltr" value={supplierForm.phone} onChange={(e) => setSF('phone', e.target.value)} /></div>
            <div className="field"><label>{ar ? 'ملاحظات' : 'Notes'}</label><textarea className="textarea" rows={2} value={supplierForm.notes} onChange={(e) => setSF('notes', e.target.value)} /></div>
            <button className="btn btn-primary btn-block" onClick={saveSupplierForm}>{ar ? 'حفظ' : 'Save'}</button>
            {supplierForm.id && <button className="btn btn-outline btn-block" style={{ color: 'var(--danger)' }} onClick={deleteSupplierForm}>{ar ? 'حذف' : 'Delete'}</button>}
          </div>
        )}
      </Sheet>

      {/* PO Form Sheet */}
      <Sheet open={poFormOpen} onClose={() => setPoFormOpen(false)} title={ar ? 'إنشاء أمر شراء' : 'Create Purchase Order'}>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="field">
            <label>{ar ? 'اختر المورّد' : 'Select Supplier'}</label>
            <select className="select" value={poSupplierId} onChange={(e) => setPoSupplierId(e.target.value)}>
              {suppliers?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="card card-pad stack" style={{ gap: 8, maxHeight: 180, overflowY: 'auto' }}>
            <strong className="xs muted">{ar ? 'اختر المواد الخام لإضافتها للطلب:' : 'Select raw materials to add:'}</strong>
            <div className="row wrap" style={{ gap: 6 }}>
              {materials?.map(m => (
                <button 
                  key={m.id} 
                  className={`chip ${poLines.find(x => x.materialId === m.id) ? 'active' : ''}`}
                  onClick={() => addPoLine(m)}
                >
                  <Icon name="add" size={12} /> {ar ? m.nameAr : (m.nameEn || m.nameAr)}
                </button>
              ))}
            </div>
          </div>

          {poLines.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <strong className="small">{ar ? 'المواد المطلوبة وتكلفتها:' : 'Ordered Items & Costs'}</strong>
              {poLines.map(l => (
                <div key={l.materialId} className="card card-pad stack" style={{ gap: 6, position: 'relative' }}>
                  <button className="icon-btn xs" style={{ position: 'absolute', top: 8, insetInlineEnd: 8, color: 'var(--danger)' }} onClick={() => removePoLine(l.materialId)}>✕</button>
                  <div className="bold small">{l.name}</div>
                  <div className="row" style={{ gap: 8 }}>
                    <div className="field grow">
                      <label>{ar ? `الكمية (${unitLabel(l.purchaseUnit, lang)})` : `Qty (${unitLabel(l.purchaseUnit, lang)})`}</label>
                      <input className="input num" type="number" value={l.qty} onChange={(e) => updatePoLine(l.materialId, 'qty', e.target.value)} />
                    </div>
                    <div className="field grow">
                      <label>{ar ? `إجمالي التكلفة (${currency})` : `Total Cost (${currency})`}</label>
                      <input className="input num" type="number" value={l.cost} onChange={(e) => updatePoLine(l.materialId, 'cost', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="row-between bold" style={{ fontSize: 'var(--fs-md)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <span>{ar ? 'إجمالي تكلفة أمر الشراء:' : 'PO Total Cost:'}</span>
            <span className="num"><Price value={poLines.reduce((s, l) => s + l.cost, 0)} currency={currency} lang={lang} /></span>
          </div>

          <button className="btn btn-primary btn-block" onClick={submitPo}>{ar ? 'إرسال وحفظ كمسودة' : 'Send & Save as Draft'}</button>
        </div>
      </Sheet>

      {/* PO Detail Sheet */}
      <Sheet open={!!poDetail} onClose={() => setPoDetail(null)} title={poDetail ? `${ar ? 'تفاصيل الطلب' : 'PO Details'} ${poDetail.code}` : ''}>
        {poDetail && (
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="row-between">
              <div>
                <div className="bold">{poDetail.supplierName}</div>
                <div className="xs faint">{poDetail.createdBy ? `${ar ? 'المنشئ:' : 'Created by:'} ${poDetail.createdBy}` : ''}</div>
                {poDetail.receivedBy && (
                  <div className="xs faint" style={{ color: 'var(--success)', fontWeight: 500, marginTop: 2 }}>
                    {ar ? 'المستلم:' : 'Received by:'} {poDetail.receivedBy}
                  </div>
                )}
              </div>
              <div className="text-end">
                {poDetail.status === 'received' ? (
                  <span className="badge badge-success">{ar ? 'مستلمة' : 'Received'}</span>
                ) : (
                  <span className="badge badge-gold">{ar ? 'مسودة معلّقة' : 'Pending Draft'}</span>
                )}
              </div>
            </div>

            <div style={{ borderBottom: '1px dashed var(--border)' }} />

            <div className="stack" style={{ gap: 6 }}>
              <strong className="xs muted">{ar ? 'قائمة المواد المستلمة:' : 'Material List:'}</strong>
              {poDetail.items?.map((item, idx) => (
                <div key={idx} className="row-between xs">
                  <span>{item.materialName}</span>
                  <span className="bold num">{item.qty} x <Price value={item.cost / (item.qty || 1)} currency={currency} lang={lang} /></span>
                </div>
              ))}
            </div>

            <div style={{ borderBottom: '1px dashed var(--border)' }} />

            <div className="row-between bold">
              <span>{ar ? 'القيمة الإجمالية:' : 'Total Value:'}</span>
              <span className="num"><Price value={poDetail.totalCost} currency={currency} lang={lang} /></span>
            </div>

            {poDetail.status === 'draft' && (
              <button 
                className="btn btn-success btn-block" 
                onClick={() => receivePo(poDetail)}
              >
                <Icon name="check" size={15} /> {ar ? 'تأكيد استلام البضائع ودمجها بالمخزن' : 'Confirm & Receive Goods'}
              </button>
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}

