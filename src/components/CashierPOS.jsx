import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n, pickLang } from '../lib/i18n.jsx'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { Price } from './Riyal.jsx'
import { useToast } from './Toast.jsx'
import {
  watchItems, watchCategories, watchTables, watchMaterials, getCustomerByPhone, createOrder, updateOrderStatus,
  upsertCustomerOnOrder, payOrder, processMembershipOnPaid, consumeForOrder,
} from '../lib/db.js'
import { tierDiscountAmount, TIER_META, resolveMembershipPolicy } from '../lib/membership.js'
import { sectionTemplate, templateOptions } from '../lib/systemTemplates.js'
import { systemThemeAttr } from '../lib/systemThemes.js'

const lineKey = (item, variant, mods, note) => `${item.id}|${variant?.key || ''}|${(mods || []).map((m) => m.nameAr).join(',')}|${note || ''}`

// idea #1 (plan): each card remembers the cashier's LAST combo per item on
// this device, and starts from it — repeat orders become one tap.
const posLastKey = (tid) => `ml.poslast.${tid}`
const getLastCombo = (tid, itemId) => { try { return JSON.parse(localStorage.getItem(posLastKey(tid)) || '{}')[itemId] || null } catch (_) { return null } }
const saveLastCombo = (tid, itemId, combo) => {
  try {
    const m = JSON.parse(localStorage.getItem(posLastKey(tid)) || '{}')
    m[itemId] = combo
    localStorage.setItem(posLastKey(tid), JSON.stringify(m))
  } catch (_) { /* storage full/blocked — memory is a convenience only */ }
}

// 'options' template card (POS_CARD_TEMPLATE_PLAN): sizes + modifier groups as
// chips ON the card — the cashier composes the whole line without any sheet.
// Live price on the Add button; required groups glow + shake if skipped.
function PosOptionCard({ it, currency, lang, ar, onAdd, onOpenFull, tid }) {
  const variants = it.variants || []
  const groups = it.modifierGroups || []
  const last = useMemo(() => getLastCombo(tid, it.id), [tid, it.id])
  const [vKey, setVKey] = useState(() => (last?.vKey && variants.some((v) => v.key === last.vKey) ? last.vKey : variants[0]?.key || ''))
  const [sel, setSel] = useState(() => groups.map((g, gi) => (Array.isArray(last?.sel?.[gi]) ? last.sel[gi].filter((oi) => g.options?.[oi]) : [])))
  const [qty, setQty] = useState(1)
  const [warn, setWarn] = useState(-1)
  const variant = variants.find((v) => v.key === vKey) || null
  const mods = groups.flatMap((g, gi) => (sel[gi] || []).map((oi) => g.options?.[oi]).filter(Boolean)
    .map((o) => ({ nameAr: o.nameAr, nameEn: o.nameEn || '', price: Number(o.price) || 0 })))
  const unit = (variant ? Number(variant.price) || 0 : Number(it.price) || 0) + mods.reduce((s, m) => s + m.price, 0)
  const toggleOpt = (gi, oi, g) => {
    setSel((s) => {
      const cur = s[gi] || []
      const max = Number(g.max) || 0
      let next
      if (cur.includes(oi)) next = cur.filter((x) => x !== oi)
      else if (max === 1) next = [oi]
      else if (max > 0 && cur.length >= max) next = cur
      else next = [...cur, oi]
      const n = [...s]; n[gi] = next; return n
    })
  }
  const add = (q = qty) => {
    const missing = groups.findIndex((g, gi) => (g.required || Number(g.min) > 0) && (sel[gi] || []).length < Math.max(1, Number(g.min) || 0))
    if (missing >= 0) { setWarn(missing); setTimeout(() => setWarn(-1), 900); return }
    onAdd(it, variant, mods, q, '')
    saveLastCombo(tid, it.id, { vKey, sel })
    setQty(1) // the combo STAYS selected (idea #1) — repeat orders are one tap
  }
  // idea #4: LONG-PRESS on Add = bulk quantity entry (catering / large groups)
  const pressT = useRef(null)
  const pressFired = useRef(false)
  const pressStart = () => {
    pressFired.current = false
    pressT.current = setTimeout(() => {
      pressFired.current = true
      const v = Number(window.prompt(ar ? 'الكمية الكبيرة؟' : 'Bulk quantity?', '10')) || 0
      if (v > 0) add(v)
    }, 480)
  }
  const pressEnd = () => clearTimeout(pressT.current)
  // critical sizing is INLINE on purpose: the card must render sane even if a
  // stale dev-server ships new JS with old CSS (happened — giant raw images)
  const imgBox = { width: 56, height: 56, borderRadius: 14, objectFit: 'cover', background: 'var(--surface-2)', flex: 'none' }
  return (
    <div className="pos-opt-card card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, minWidth: 0 }}>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        {it.imageUrl
          ? <img src={it.imageUrl} alt="" className="pos-opt-img" style={imgBox} />
          : <div className="pos-opt-img" style={{ ...imgBox, display: 'grid', placeItems: 'center' }}><Icon name="coffee" size={20} className="faint" /></div>}
        <div className="stack grow" style={{ gap: 2, minWidth: 0 }}>
          <span className="bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pickLang(it, 'name', lang)}</span>
          <span className="pos-price"><Price value={unit} currency={currency} lang={lang} /></span>
        </div>
        {/* idea #8: escape hatch to the FULL item sheet (photos, notes, details) */}
        {onOpenFull && (
          <button type="button" className="icon-btn" style={{ width: 40, height: 40, flex: 'none' }} onClick={() => onOpenFull(it)} title={ar ? 'النافذة الكاملة (صور وملاحظات)' : 'Full view (photos & notes)'}>
            <Icon name="eye" size={16} />
          </button>
        )}
      </div>
      {variants.length > 0 && (
        <div className="pos-opt-group">
          <span className="xs faint bold">{ar ? 'الحجم' : 'Size'}</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {variants.map((v) => (
              <button key={v.key} type="button" className={`chip ${vKey === v.key ? 'active' : ''}`} onClick={() => setVKey(v.key)}>{pickLang(v, 'name', lang)}</button>
            ))}
          </div>
        </div>
      )}
      {groups.map((g, gi) => (
        <div key={gi} className={`pos-opt-group ${warn === gi ? 'pos-opt-warn' : ''}`}>
          <span className="xs faint bold">{pickLang(g, 'name', lang)}{(g.required || Number(g.min) > 0) && <span style={{ color: 'var(--danger)' }}> *</span>}</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {(g.options || []).map((o, oi) => (
              <button key={oi} type="button" className={`chip ${(sel[gi] || []).includes(oi) ? 'active' : ''}`} onClick={() => toggleOpt(gi, oi, g)}>
                {pickLang(o, 'name', lang)}{Number(o.price) > 0 && <span className="num" style={{ fontSize: 10, opacity: 0.85 }}> +{Number(o.price)}</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="row pos-opt-foot" style={{ gap: 8, alignItems: 'center' }}>
        <div className="stepper" style={{ flex: 'none' }}>
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="minus">−</button>
          <span className="val num">{qty}</span>
          <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="plus">+</button>
        </div>
        <button type="button" className="btn btn-primary grow" style={{ minHeight: 42, fontWeight: 800 }}
          onClick={() => { if (!pressFired.current) add() }}
          onPointerDown={pressStart} onPointerUp={pressEnd} onPointerLeave={pressEnd} onContextMenu={(e) => e.preventDefault()}
          title={ar ? 'ضغطة مطوّلة = كمية كبيرة' : 'Long-press = bulk quantity'}>
          {ar ? 'أضف' : 'Add'} · <Price value={unit * qty} currency={currency} lang={lang} />
        </button>
      </div>
    </div>
  )
}

// Held (parked) orders, per venue, on this device.
const heldKey = (tid) => `ml.held.${tid}`
const getHeld = (tid) => { try { return JSON.parse(localStorage.getItem(heldKey(tid)) || '[]') } catch (_) { return [] } }
const saveHeld = (tid, list) => { try { localStorage.setItem(heldKey(tid), JSON.stringify(list)) } catch (_) { /* ignore */ } }

// In-store POS: build a customized order for a walk-in / phone-in, identify the customer,
// pick a table or take it to their car, and push it onto the board. Opens FULL-SCREEN as a
// 3-pane POS (catalog + order) so the whole order is visible with no scrolling of the frame.
export default function CashierPOS({ open, onClose, tenantId, tenant, lang = 'ar', actorName = '', onCreated, initialTable = null, canPay = true }) {
  const ar = lang === 'ar'
  const { t } = useI18n()
  const currency = tenant?.currency || 'SAR'
  const toast = useToast()
  const [items, setItems] = useState([])
  const [cats, setCats] = useState([])
  const [tables, setTables] = useState([])
  const [materials, setMaterials] = useState([])
  const [activeCat, setActiveCat] = useState('all')
  // Cashier layout template (grid | compact | touch | lite) — the tenant's saved
  // choice is plan-gated (Pro+); staff can switch on the fly here.
  const [tpl, setTpl] = useState('grid')
  const [cart, setCart] = useState([])
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [customer, setCustomer] = useState(null)
  const [orderType, setOrderType] = useState('takeaway')
  const [tableId, setTableId] = useState('')
  const [car, setCar] = useState({ model: '', color: '', plate: '' })
  const [viewItem, setViewItem] = useState(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [partySize, setPartySize] = useState('')
  const [discType, setDiscType] = useState('amount') // amount | percent
  const [discVal, setDiscVal] = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [orderNote, setOrderNote] = useState('')
  const [rush, setRush] = useState(false) // fire-first priority on the KDS
  const [held, setHeldState] = useState([])
  const [heldOpen, setHeldOpen] = useState(false)
  const [openItemOpen, setOpenItemOpen] = useState(false)
  const [oiName, setOiName] = useState('')
  const [oiPrice, setOiPrice] = useState('')
  // Which cart line just changed via a catalog tap — drives the add-to-cart pulse.
  // Bumping `n` re-keys the line so its enter animation replays on every add.
  const [flash, setFlash] = useState(null)
  const flashLine = (key) => setFlash((f) => ({ key, n: (f && f.key === key ? f.n : 0) + 1 }))

  useEffect(() => {
    if (!open || !tenantId) return
    const u1 = watchItems(tenantId, setItems)
    const u2 = watchCategories(tenantId, setCats)
    const u3 = watchTables(tenantId, setTables)
    const u4 = watchMaterials(tenantId, setMaterials)
    return () => { u1(); u2(); u3(); u4() }
  }, [open, tenantId])

  // full reset ONLY when the POS opens — NOT on every tenant snapshot (a design
  // tweak from the studio mid-order must never wipe the cashier's active cart)
  useEffect(() => { if (open) { setCart([]); setPhone(''); setName(''); setCustomer(null); setActiveCat('all'); setOrderType(initialTable ? 'dine_in' : 'takeaway'); setTableId(initialTable?.id || ''); setCar({ model: '', color: '', plate: '' }); setQ(''); setPartySize(''); setDiscType('amount'); setDiscVal(''); setPayMethod('cash'); setOrderNote(''); setRush(false); setHeldState(getHeld(tenantId)) } }, [open, tenantId, initialTable]) // eslint-disable-line react-hooks/exhaustive-deps
  // template follows the SAVED choice — resync only when that value itself changes
  const savedTpl = sectionTemplate(tenant, 'cashier')
  useEffect(() => { if (open) setTpl(window.matchMedia('(max-width: 640px)').matches ? 'compact' : savedTpl) }, [open, savedTpl])

  useEffect(() => {
    const digits = phone.replace(/[^0-9]/g, '')
    if (digits.length < 8 || !tenantId) { setCustomer(null); return }
    let alive = true
    getCustomerByPhone(tenantId, digits).then((c) => { if (alive) { setCustomer(c); if (c?.name) setName((n) => n || c.name) } }).catch(() => {})
    return () => { alive = false }
  }, [phone, tenantId])

  const matStock = useMemo(() => { const m = {}; materials.forEach((x) => { m[x.id] = x.stockQty || 0 }); return m }, [materials])
  const outOfMaterial = (it) => {
    if (it.stockMode !== 'recipe') return false
    const lines = [...(it.recipe || []), ...Object.values(it.variantRecipes || {}).flat()]
    return lines.some((l) => (matStock[l.materialId] ?? 0) < (Number(l.qty) || 0))
  }
  const shownItems = useMemo(() => {
    const term = q.trim().toLowerCase()
    return items.filter((i) => i.available !== false && !(i.trackStock && (i.stock || 0) <= 0) && !outOfMaterial(i) && (activeCat === 'all' || i.categoryId === activeCat) && (!term || `${i.nameAr || ''} ${i.nameEn || ''}`.toLowerCase().includes(term)))
  }, [items, activeCat, q, matStock]) // eslint-disable-line react-hooks/exhaustive-deps
  // base price, or the lowest variant price ("from …") for variant-only items
  const priceOf = (it) => {
    const base = Number(it.price) || 0
    if (base) return { value: base, from: false }
    const vs = (it.variants || []).map((v) => Number(v.price) || 0).filter((x) => x > 0)
    return vs.length ? { value: Math.min(...vs), from: true } : { value: 0, from: false }
  }

  const addLine = (item, variant, mods, qty, note) => {
    const unitPrice = (variant ? Number(variant.price) || 0 : Number(item.price) || 0) + (mods || []).reduce((s, m) => s + (Number(m.price) || 0), 0)
    const key = lineKey(item, variant, mods, note)
    setCart((c) => {
      const idx = c.findIndex((l) => l.key === key)
      if (idx >= 0) { const n = [...c]; n[idx] = { ...n[idx], qty: n[idx].qty + qty }; return n }
      return [...c, { key, itemId: item.id, categoryId: item.categoryId || '', nameAr: item.nameAr, nameEn: item.nameEn || '', variantLabel: variant ? pickLang(variant, 'name', lang) : '', variantKey: variant?.key || '', modifiers: mods || [], unitPrice, qty, countsForLoyalty: item.countsForLoyalty !== false, note: note || '' }]
    })
    flashLine(key)
  }
  // quick-add an item with no variants/modifiers; otherwise open the customization sheet
  const tapItem = (it) => {
    if ((it.variants || []).length || (it.modifierGroups || []).length) setViewItem(it)
    else addLine(it, null, [], 1, '')
  }
  // featured quick row (options template, idea #7): one tap adds the item with
  // its remembered/default combo; unmet required groups fall back to the sheet
  const quickAddFeatured = (it) => {
    const groups = it.modifierGroups || []
    const variants = it.variants || []
    const last = getLastCombo(tenantId, it.id)
    const vKey = last?.vKey && variants.some((v) => v.key === last.vKey) ? last.vKey : variants[0]?.key || ''
    const variant = variants.find((v) => v.key === vKey) || null
    const sel = groups.map((g, gi) => (Array.isArray(last?.sel?.[gi]) ? last.sel[gi].filter((oi) => g.options?.[oi]) : []))
    if (groups.some((g, gi) => (g.required || Number(g.min) > 0) && sel[gi].length < Math.max(1, Number(g.min) || 0))) { setViewItem(it); return }
    const mods = groups.flatMap((g, gi) => sel[gi].map((oi) => g.options[oi]).filter(Boolean).map((o) => ({ nameAr: o.nameAr, nameEn: o.nameEn || '', price: Number(o.price) || 0 })))
    addLine(it, variant, mods, 1, '')
  }
  const setQty = (key, qty) => setCart((c) => (qty <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, qty } : l))))

  // hold / resume a parked order
  const holdOrder = () => {
    if (!cart.length) return
    const entry = { id: `h${cart.length}_${cart[0]?.itemId || 'x'}_${Math.round(subtotal)}`, label: name || tables.find((x) => x.id === tableId)?.label || `${cart.reduce((s, l) => s + l.qty, 0)} ${ar ? 'صنف' : 'items'}`, cart, orderType, name, phone, partySize, tableId, at: subtotal }
    const list = [entry, ...getHeld(tenantId).filter((h) => h.id !== entry.id)].slice(0, 20)
    saveHeld(tenantId, list); setHeldState(list)
    setCart([]); setName(''); setPhone(''); setCustomer(null); setPartySize('')
    toast.success(ar ? 'تم تعليق الطلب' : 'Order held')
  }
  const resumeHeld = (e) => {
    setCart(e.cart || []); setOrderType(e.orderType || 'takeaway'); setName(e.name || ''); setPhone(e.phone || ''); setPartySize(e.partySize || ''); setTableId(e.tableId || '')
    const list = getHeld(tenantId).filter((h) => h.id !== e.id); saveHeld(tenantId, list); setHeldState(list); setHeldOpen(false)
  }
  const deleteHeld = (id) => { const list = getHeld(tenantId).filter((h) => h.id !== id); saveHeld(tenantId, list); setHeldState(list) }

  // open-price line (custom item, no recipe / no loyalty)
  const addOpenItem = () => {
    const p = Number(oiPrice) || 0
    if (!oiName.trim() || p <= 0) return
    setCart((c) => [...c, { key: `open${c.length}_${oiName.trim()}_${p}`, itemId: '', categoryId: '', nameAr: oiName.trim(), nameEn: oiName.trim(), variantLabel: '', variantKey: '', modifiers: [], unitPrice: p, qty: 1, countsForLoyalty: false, note: '' }])
    setOpenItemOpen(false); setOiName(''); setOiPrice('')
  }

  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  const manualDiscount = (() => { const v = Number(discVal) || 0; if (v <= 0) return 0; return discType === 'percent' ? Math.round((subtotal * Math.min(v, 100)) / 100 * 100) / 100 : Math.min(v, subtotal) })()
  const membership = customer?.membership?.active ? customer.membership : null
  const memberDiscount = membership ? tierDiscountAmount(membership, Math.max(0, subtotal - manualDiscount)) : 0
  const total = Math.max(0, subtotal - manualDiscount - memberDiscount)
  const drinkUnits = cart.reduce((s, l) => s + (l.countsForLoyalty ? l.qty : 0), 0)
  const count = cart.reduce((s, l) => s + l.qty, 0)
  const meta = membership ? (TIER_META[membership.tier] || TIER_META.silver) : null
  const table = tables.find((x) => x.id === tableId)

  const create = async (payNow) => {
    if (!cart.length || busy) return
    if (orderType === 'curbside' && !car.model && !car.plate) { toast.error(ar ? 'أدخل بيانات السيارة' : 'Enter car details'); return }
    setBusy(true)
    try {
      const digits = phone.replace(/[^0-9]/g, '')
      const payload = {
        items: cart.map((l) => ({ itemId: l.itemId, nameAr: l.nameAr, nameEn: l.nameEn, variantLabel: l.variantLabel || '', variantKey: l.variantKey || '', modifiers: l.modifiers || [], unitPrice: l.unitPrice, qty: l.qty, lineTotal: l.unitPrice * l.qty, note: l.note || '' })),
        subtotal, discount: manualDiscount, loyaltyDiscount: 0, memberDiscount, membershipTier: membership?.tier || null, total,
        orderType, tableId: orderType === 'dine_in' ? (tableId || null) : null, tableLabel: orderType === 'dine_in' ? (table?.label || '') : '',
        partySize: orderType === 'dine_in' ? (Number(partySize) || null) : null,
        car: orderType === 'curbside' ? { model: car.model.trim(), color: car.color.trim(), plate: car.plate.trim() } : null,
        customerName: name || '', customerPhone: digits || '', notes: orderNote || '',
        memberCardToken: customer?.membership?.token || null, // server validates the member discount
        rush, drinkUnits, currency, source: 'cashier',
      }
      const res = await createOrder(tenantId, payload)
      // Finished-goods stock is decremented server-side by onNewOrder (single authority).
      await updateOrderStatus(tenantId, res.id, 'accepted', { acceptedByName: actorName, _actor: actorName })
      if (payNow) {
        await payOrder(tenantId, res.id, { method: payMethod, actor: actorName, markServed: true })
      }
      toast.success(ar ? 'تم إنشاء الطلب' : 'Order created')
      onCreated?.()
      onClose?.()
    } catch (_) {
      toast.error(ar ? 'تعذّر إنشاء الطلب' : 'Failed to create order')
    } finally { setBusy(false) }
  }

  const TYPES = [
    { id: 'takeaway', ar: 'سفري', en: 'Takeaway' },
    { id: 'dine_in', ar: 'محلي', en: 'Dine-in' },
    { id: 'pickup', ar: 'استلام', en: 'Pickup' },
    { id: 'curbside', ar: 'السيارة', en: 'Curbside' },
  ]

  if (!open) return null

  const isGrid = tpl === 'grid' || tpl === 'touch'
  const withThumb = tpl !== 'lite' // compact shows a thumb; lite is text-only

  return (
    <div className="pos-fullscreen" role="dialog" aria-modal="true" data-systheme={systemThemeAttr(tenant, 'cashier')}>
      {/* top bar: order type + layout template + close */}
      <header className="pos-topbar">
        <button className="icon-btn" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}><Icon name="close" size={20} /></button>
        <strong style={{ fontSize: 'var(--fs-md)', flex: 'none' }}>{ar ? 'طلب جديد' : 'New order'}</strong>
        <div className="segmented" style={{ marginInlineStart: 'auto' }}>
          {TYPES.map((ty) => <button key={ty.id} className={orderType === ty.id ? 'active' : ''} onClick={() => setOrderType(ty.id)}>{ar ? ty.ar : ty.en}</button>)}
        </div>
        <div className="pos-tpl-switch row" style={{ gap: 2, flex: 'none' }}>
          {templateOptions('cashier').map((o) => (
            <button key={o.id} type="button" className={`icon-btn ${tpl === o.id ? 'active' : ''}`} title={ar ? `${o.ar}${o.hint ? ' — ' + o.hint : ''}` : o.en} onClick={() => setTpl(o.id)}>
              <Icon name={{ grid: 'grid', compact: 'list', touch: 'store', lite: 'bag' }[o.id] || 'grid'} size={16} />
            </button>
          ))}
        </div>
      </header>

      <div className="pos-body">
        {/* ===== catalog (items) ===== */}
        <section className="pos-catalog">
          {/* venue-set ambient backdrop (image/video) behind the grid — opacity capped for legibility */}
          {tenant?.posBg?.url && (() => {
            const op = Math.min(0.6, Math.max(0, Number(tenant?.posBgOpacity ?? 0.12)))
            const pos = tenant?.posBgPosition || 'center'
            const sc = Math.max(1, Number(tenant?.posBgScale) || 1)
            return (
              <div className="pos-bg-layer" aria-hidden="true" style={{ opacity: op }}>
                {tenant.posBg.kind === 'video'
                  ? <video src={tenant.posBg.url} autoPlay muted loop playsInline preload="auto" style={{ objectPosition: pos, transform: sc > 1 ? `scale(${sc})` : undefined, transformOrigin: pos }} />
                  : <div style={{ backgroundImage: `url(${tenant.posBg.url})`, backgroundPosition: pos, backgroundSize: sc > 1 ? `${sc * 100}%` : 'cover' }} />}
              </div>
            )
          })()}
          <div className="row" style={{ gap: 6, flex: 'none' }}>
            <input className="input grow" placeholder={ar ? 'بحث عن صنف…' : 'Search item…'} value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn btn-outline" style={{ flex: 'none' }} onClick={() => setOpenItemOpen(true)} title={ar ? 'صنف مفتوح' : 'Open item'}><Icon name="add" size={16} /> {ar ? 'مفتوح' : 'Open'}</button>
            <button className="btn btn-outline" style={{ flex: 'none' }} onClick={() => setHeldOpen(true)}>{ar ? 'المعلّقة' : 'Held'} ({held.length})</button>
          </div>
          <div className="row" style={{ gap: 6, overflowX: 'auto', paddingBottom: 2, flex: 'none' }}>
            <button className={`btn btn-sm ${activeCat === 'all' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setActiveCat('all')}>{ar ? 'الكل' : 'All'}</button>
            {cats.map((c) => <button key={c.id} className={`btn btn-sm ${activeCat === c.id ? 'btn-primary' : 'btn-outline'}`} style={{ whiteSpace: 'nowrap' }} onClick={() => setActiveCat(c.id)}>{pickLang(c, 'name', lang)}</button>)}
          </div>

          {tpl === 'options' && shownItems.some((x) => x.featured) && (
            <div className="row" style={{ gap: 6, overflowX: 'auto', padding: '2px 2px 4px', flex: 'none' }}>
              {shownItems.filter((x) => x.featured).map((it) => (
                <button key={it.id} type="button" className="chip" style={{ flex: 'none' }} onClick={() => quickAddFeatured(it)}>
                  <Icon name="star" size={12} /> {pickLang(it, 'name', lang)}
                </button>
              ))}
            </div>
          )}
          <div className="pos-items" data-template={tpl}
            style={tpl === 'options' ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, alignItems: 'stretch', alignContent: 'start' } : undefined}>
            {shownItems.map((it) => { const p = priceOf(it); return tpl === 'options' ? (
              <PosOptionCard key={it.id} it={it} currency={currency} lang={lang} ar={ar} onAdd={addLine} tid={tenantId} onOpenFull={setViewItem} />
            ) : isGrid ? (
              <button key={it.id} className="pos-tile card" style={{ overflow: 'hidden', cursor: 'pointer', padding: 0, textAlign: 'start' }} onClick={() => tapItem(it)}>
                {it.imageUrl
                  ? <img src={it.imageUrl} alt="" className="pos-tile-media" />
                  : <div className="pos-tile-media" style={{ display: 'grid', placeItems: 'center' }}><Icon name="coffee" size={24} className="faint" /></div>}
                <div className="stack" style={{ gap: 3, padding: '8px 10px' }}>
                  <span className="bold" style={{ lineHeight: 1.25, fontSize: tpl === 'touch' ? 14 : 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pickLang(it, 'name', lang)}</span>
                  <span className="pos-price" style={{ fontSize: tpl === 'touch' ? 15 : 14 }}>{p.from ? (ar ? 'من ' : 'from ') : ''}<Price value={p.value} currency={currency} lang={lang} /></span>
                </div>
              </button>
            ) : (
              <button key={it.id} className="pos-row card" style={{ gap: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', textAlign: 'start', padding: withThumb ? '8px 12px' : '11px 14px', minHeight: withThumb ? 52 : 46 }} onClick={() => tapItem(it)}>
                {withThumb && (it.imageUrl
                  ? <img src={it.imageUrl} alt="" style={{ width: 42, height: 42, borderRadius: 9, objectFit: 'cover', flex: 'none' }} />
                  : <div style={{ width: 42, height: 42, borderRadius: 9, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', flex: 'none' }}><Icon name="coffee" size={18} className="faint" /></div>)}
                <span className="bold grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: tpl === 'lite' ? 16 : 15 }}>{pickLang(it, 'name', lang)}</span>
                <span className="pos-price" style={{ fontSize: 15 }}>{p.from ? (ar ? 'من ' : 'from ') : ''}<Price value={p.value} currency={currency} lang={lang} /></span>
              </button>
            ) })}
            {shownItems.length === 0 && <p className="faint" style={{ gridColumn: '1/-1', textAlign: 'center', padding: 'var(--sp-6)' }}>{ar ? 'لا أصناف مطابقة' : 'No matching items'}</p>}
          </div>
        </section>

        {/* ===== order / bill (always visible) ===== */}
        <aside className="pos-order">
          <div className="pos-order-lines">
            {orderType === 'dine_in' && (
              <div className="stack" style={{ gap: 6 }}>
                {tables.length > 0 && (
                  <div className="row" style={{ gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                    {tables.map((tb) => <button key={tb.id} className={`btn btn-sm ${tableId === tb.id ? 'btn-primary' : 'btn-outline'}`} style={{ whiteSpace: 'nowrap' }} onClick={() => setTableId((v) => (v === tb.id ? '' : tb.id))}>{tb.label}</button>)}
                  </div>
                )}
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="xs faint">{ar ? 'عدد الأشخاص' : 'Party size'}</span>
                  <input className="input num" style={{ width: 80 }} type="number" min="1" inputMode="numeric" value={partySize} onChange={(e) => setPartySize(e.target.value)} />
                </div>
              </div>
            )}
            {orderType === 'curbside' && (
              <div className="row" style={{ gap: 6 }}>
                <input className="input grow" placeholder={ar ? 'نوع السيارة' : 'Model'} value={car.model} onChange={(e) => setCar((c) => ({ ...c, model: e.target.value }))} />
                <input className="input grow" placeholder={ar ? 'اللون' : 'Color'} value={car.color} onChange={(e) => setCar((c) => ({ ...c, color: e.target.value }))} />
                <input className="input grow" dir="ltr" placeholder={ar ? 'اللوحة' : 'Plate'} value={car.plate} onChange={(e) => setCar((c) => ({ ...c, plate: e.target.value }))} />
              </div>
            )}
            <div className="row" style={{ gap: 8 }}>
              <input className="input num grow" dir="ltr" inputMode="tel" placeholder={ar ? 'رقم العميل (اختياري)' : 'Customer phone'} value={phone} onChange={(e) => setPhone(e.target.value)} />
              <input className="input grow" placeholder={ar ? 'الاسم' : 'Name'} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {customer && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {meta && <span className="badge" style={{ borderColor: meta.color, color: meta.color, background: 'transparent', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name={meta.icon} size={12} /> {ar ? meta.ar : meta.en} · {membership.discountPct}% · {membership.points} {ar ? 'نقطة' : 'pts'}</span>}
                <span className="xs faint">{customer.totalOrders || 0} {ar ? 'طلب سابق' : 'orders'}</span>
                {customer.rewards ? <span className="badge badge-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="star" size={12} /> {customer.rewards} {ar ? 'مجاني' : 'free'}</span> : null}
                {customer.flagged && <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="warning" size={12} /> {ar ? 'موسوم' : 'Tagged'}{customer.flagNote ? ` — ${customer.flagNote}` : ''}</span>}
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--border)' }} />

            {cart.length === 0 ? (
              <div className="empty" style={{ padding: 'var(--sp-6) var(--sp-3)' }}>
                <div className="emoji"><Icon name="cart" size={34} className="faint" /></div>
                <p className="small faint">{ar ? 'اختر الأصناف لبناء الطلب' : 'Pick items to build the order'}</p>
              </div>
            ) : cart.map((l) => (
              <div key={flash && flash.key === l.key ? `${l.key}::${flash.n}` : l.key} className="row-between pos-line" style={{ gap: 8, alignItems: 'flex-start' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <span className="bold">{ar ? l.nameAr : (l.nameEn || l.nameAr)}</span>{l.variantLabel ? <span className="small faint"> · {l.variantLabel}</span> : null}
                  {l.modifiers?.length ? <div className="xs faint">{l.modifiers.map((m) => pickLang(m, 'name', lang)).join(' · ')}</div> : null}
                  {l.note ? <div className="xs faint">{ar ? 'ملاحظة' : 'Note'}: {l.note}</div> : null}
                </div>
                <div className="row" style={{ gap: 6, alignItems: 'center', flex: 'none' }}>
                  <button className="icon-btn pos-qty" onClick={() => setQty(l.key, l.qty - 1)}><Icon name="minus" size={16} /></button>
                  <span key={l.qty} className="bold num pos-pop" style={{ minWidth: 22, textAlign: 'center' }}>{l.qty}</span>
                  <button className="icon-btn pos-qty" onClick={() => setQty(l.key, l.qty + 1)}><Icon name="add" size={17} /></button>
                  <span className="pos-price" style={{ minWidth: 58, textAlign: 'end' }}><Price value={l.unitPrice * l.qty} currency={currency} lang={lang} /></span>
                </div>
              </div>
            ))}
            {cart.length > 0 && (
              <input className="input" placeholder={ar ? 'ملاحظة للطلب (اختياري)' : 'Order note (optional)'} value={orderNote} onChange={(e) => setOrderNote(e.target.value)} />
            )}
          </div>

          {/* pinned totals + actions */}
          <div className="pos-order-foot stack" style={{ gap: 8 }}>
            {cart.length > 0 && (
              <>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <span className="xs faint grow">{ar ? 'خصم يدوي' : 'Discount'}</span>
                  <input className="input num" style={{ width: 72 }} type="number" min="0" value={discVal} onChange={(e) => setDiscVal(e.target.value)} />
                  <div className="segmented" style={{ minWidth: 0 }}>
                    <button className={discType === 'amount' ? 'active' : ''} onClick={() => setDiscType('amount')}>{currency === 'SAR' ? '﷼' : currency}</button>
                    <button className={discType === 'percent' ? 'active' : ''} onClick={() => setDiscType('percent')}>%</button>
                  </div>
                  <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)', flex: 'none' }} onClick={() => setCart([])}>{ar ? 'مسح' : 'Clear'}</button>
                </div>
                <div className="row-between small"><span className="faint">{ar ? 'المجموع' : 'Subtotal'}</span><span className="num"><Price value={subtotal} currency={currency} lang={lang} /></span></div>
                {manualDiscount > 0 && <div className="row-between small" style={{ color: 'var(--success)' }}><span>{ar ? 'خصم' : 'Discount'}</span><span className="num">−<Price value={manualDiscount} currency={currency} lang={lang} /></span></div>}
                {memberDiscount > 0 && <div className="row-between small" style={{ color: 'var(--success)' }}><span>{ar ? `عضوية ${membership.discountPct}%` : `Member ${membership.discountPct}%`}</span><span className="num">−<Price value={memberDiscount} currency={currency} lang={lang} /></span></div>}
                <div className="row-between" style={{ borderTop: '2px solid var(--border-strong)', paddingTop: 6 }}><strong style={{ fontSize: 'var(--fs-md)' }}>{ar ? 'الإجمالي' : 'Total'}</strong><span key={total} className="pos-price pos-total-pop" style={{ fontSize: 'var(--fs-xl)' }}><Price value={total} currency={currency} lang={lang} /></span></div>
                <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {canPay && <>
                    <span className="xs faint">{ar ? 'الدفع:' : 'Pay:'}</span>
                    {[['cash', ar ? 'نقدي' : 'Cash'], ['card', ar ? 'شبكة' : 'Card'], ['transfer', ar ? 'تحويل' : 'Transfer']].map(([id, lbl]) => (
                      <button key={id} className={`btn btn-sm ${payMethod === id ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPayMethod(id)}>{lbl}</button>
                    ))}
                  </>}
                  <button className={`btn btn-sm ${rush ? 'btn-danger' : 'btn-outline'}`} style={{ marginInlineStart: 'auto' }} onClick={() => setRush((r) => !r)} title={ar ? 'أولوية قصوى في المطبخ' : 'Fire-first on the KDS'}><Icon name="flame" size={14} /> {ar ? 'استعجال' : 'Rush'}</button>
                  <button className="btn btn-sm btn-outline" onClick={holdOrder}><Icon name="clock" size={14} /> {ar ? 'تعليق' : 'Hold'}</button>
                </div>
              </>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary grow" style={{ minHeight: 54, fontWeight: 800, fontSize: 'var(--fs-md)' }} disabled={!cart.length || busy} onClick={() => create(false)}><Icon name="orders" size={18} /> {ar ? `إرسال · ${count}` : `Send · ${count}`}</button>
              {canPay && <button className="btn btn-success grow" style={{ minHeight: 54, fontWeight: 800, fontSize: 'var(--fs-md)' }} disabled={!cart.length || busy} onClick={() => create(true)}><Icon name="cashier" size={18} /> {ar ? 'بيع سريع' : 'Quick sale'}</button>}
            </div>
          </div>
        </aside>
      </div>

      {viewItem && <POSItemSheet item={viewItem} currency={currency} lang={lang} t={t} onClose={() => setViewItem(null)} onAdd={(variant, mods, qty, note) => { addLine(viewItem, variant, mods, qty, note); setViewItem(null) }} />}

      <Sheet open={heldOpen} onClose={() => setHeldOpen(false)} title={ar ? 'الطلبات المعلّقة' : 'Held orders'}>
        {held.length === 0 ? <p className="muted small">{ar ? 'لا طلبات معلّقة' : 'None'}</p> : (
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {held.map((e) => (
              <div key={e.id} className="list-row">
                <button className="grow" style={{ background: 'none', border: 'none', textAlign: 'start', cursor: 'pointer', padding: 0 }} onClick={() => resumeHeld(e)}>
                  <div className="bold small">{e.label}</div>
                  <div className="xs faint">{(e.cart || []).reduce((s, l) => s + l.qty, 0)} {ar ? 'صنف' : 'items'}</div>
                </button>
                <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => deleteHeld(e.id)}><Icon name="delete" size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </Sheet>

      <Sheet open={openItemOpen} onClose={() => setOpenItemOpen(false)} title={ar ? 'صنف مفتوح' : 'Open item'}>
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <div className="field"><label>{ar ? 'الاسم' : 'Name'}</label><input className="input" value={oiName} onChange={(e) => setOiName(e.target.value)} /></div>
          <div className="field"><label>{ar ? 'السعر' : 'Price'}</label><input className="input num" type="number" value={oiPrice} onChange={(e) => setOiPrice(e.target.value)} /></div>
          <button className="btn btn-primary btn-block" onClick={addOpenItem}>{ar ? 'إضافة' : 'Add'}</button>
        </div>
      </Sheet>
    </div>
  )
}

// Lightweight item customization for the POS (variants + modifier groups + note).
function POSItemSheet({ item, currency, lang, t, onClose, onAdd }) {
  const ar = lang === 'ar'
  const toast = useToast()
  const variants = item.variants || []
  const groups = item.modifierGroups || []
  const [variant, setVariant] = useState(variants[0] || null)
  const [selected, setSelected] = useState(() => groups.map(() => []))
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')

  const toggle = (gi, opt) => {
    const g = groups[gi]
    const max = Number(g.max) || 0
    setSelected((sel) => {
      const cur = sel[gi] || []
      const exists = cur.find((o) => o.nameAr === opt.nameAr && o.nameEn === opt.nameEn)
      let next
      if (max === 1) next = exists ? [] : [opt]
      else if (exists) next = cur.filter((o) => o !== exists)
      else if (max > 0 && cur.length >= max) next = cur
      else next = [...cur, opt]
      return sel.map((s, i) => (i === gi ? next : s))
    })
  }

  const flatMods = groups.flatMap((g, gi) => (selected[gi] || []).map((o) => ({ nameAr: o.nameAr, nameEn: o.nameEn, price: Number(o.price) || 0, recipe: o.recipe || [] })))
  const modSum = flatMods.reduce((s, m) => s + m.price, 0)
  const unit = (variant ? Number(variant.price) || 0 : Number(item.price) || 0) + modSum
  const missing = groups.find((g, gi) => {
    const need = Math.max(Number(g.min) || 0, g.required ? 1 : 0)
    return need > 0 && (selected[gi] || []).length < need
  })
  const add = () => {
    if (missing) { toast.error(`${ar ? 'اختر من' : 'Choose from'}: ${pickLang(missing, 'name', lang)}`); return }
    onAdd(variant, flatMods, qty, note.trim())
  }

  return (
    <Sheet open onClose={onClose} title={pickLang(item, 'name', lang)}>
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        {item.imageUrl && <img src={item.imageUrl} alt="" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 'var(--r-md, 12px)', alignSelf: 'center' }} />}

        {variants.length > 0 && (
          <div className="stack" style={{ gap: 4 }}>
            <label className="xs faint">{t('variants') || (ar ? 'الحجم' : 'Size')}</label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {variants.map((v) => <button key={v.key} className={`chip ${variant?.key === v.key ? 'active' : ''}`} onClick={() => setVariant(v)}>{pickLang(v, 'name', lang)} · <Price value={v.price} currency={currency} lang={lang} /></button>)}
            </div>
          </div>
        )}

        {groups.map((g, gi) => (
          <div key={gi} className="stack" style={{ gap: 4 }}>
            <label className="xs faint">{pickLang(g, 'name', lang)}{(g.required || Number(g.min) > 0) ? <span style={{ color: 'var(--danger)' }}> *</span> : <span className="faint"> ({t('optional') || (ar ? 'اختياري' : 'optional')})</span>}</label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {(g.options || []).map((o, oi) => {
                const on = (selected[gi] || []).some((x) => x.nameAr === o.nameAr && x.nameEn === o.nameEn)
                return <button key={oi} className={`chip ${on ? 'active' : ''}`} onClick={() => toggle(gi, o)}>{pickLang(o, 'name', lang)}{Number(o.price) ? <> · +<Price value={Number(o.price)} currency={currency} lang={lang} /></> : null}</button>
              })}
            </div>
          </div>
        ))}

        <input className="input" placeholder={ar ? 'ملاحظة (اختياري)' : 'Note (optional)'} value={note} onChange={(e) => setNote(e.target.value)} />

        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <button className="icon-btn" onClick={() => setQty((q) => Math.max(1, q - 1))}><Icon name="minus" size={15} /></button>
          <span className="bold" style={{ minWidth: 24, textAlign: 'center' }}>{qty}</span>
          <button className="icon-btn" onClick={() => setQty((q) => q + 1)}><Icon name="add" size={16} /></button>
          <button className="btn btn-primary grow" style={{ minHeight: 42, fontWeight: 800 }} onClick={add}>{ar ? 'إضافة' : 'Add'} · <Price value={unit * qty} currency={currency} lang={lang} /></button>
        </div>
      </div>
    </Sheet>
  )
}
