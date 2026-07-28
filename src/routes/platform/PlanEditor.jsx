// Plan/pricing editor + bulk subscription actions (platform admin).
// (1) edit each tier's monthly price + feature list, stored in platformConfig/plans
// (2) multi-select venues and bulk-apply a plan change or extend expiry
// (3) set a per-venue custom price override.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchAllTenants, watchAllVenueMeta } from '../../lib/platform.js'
import { PLANS } from '../../lib/plans.js'
import {
  watchPlansConfig, savePlansConfig, bulkSetPlan, bulkExtend, setCustomPrice,
} from '../../lib/platformConfig.js'
import { PlanBadge, StatusChip, toDateInput, fmtWhen } from './shared.jsx'

// ---- (1) one plan's price + editable feature list ----
function PlanCard({ plan, price, listPrice, features, onChange }) {
  const setFeature = (i, val) => {
    const next = features.slice()
    next[i] = val
    onChange({ features: next })
  }
  const addFeature = () => onChange({ features: [...features, ''] })
  const removeFeature = (i) => onChange({ features: features.filter((_, j) => j !== i) })
  const p = Number(price) || 0
  const lp = Number(listPrice) || 0
  const off = lp > p && lp > 0 ? Math.round(((lp - p) / lp) * 100) : 0

  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      <div className="row-between">
        <strong>{plan.ar}</strong>
        <PlanBadge plan={plan.id} />
      </div>
      <label className="stack xs" style={{ gap: 4 }}>
        <span className="faint bold">السعر المعروض (بعد الخصم)</span>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <input
            type="number" min="0" className="input input-sm num" style={{ width: 110 }}
            value={price} onChange={(e) => onChange({ price: e.target.value })}
          />
          <span className="xs faint">ريال / شهر</span>
        </div>
      </label>
      {/* The struck-through «before» price. It only ever prints when it is
          genuinely higher AND the launch offer is switched on — a fake
          «before» price is the kind of thing a customer checks. */}
      <label className="stack xs" style={{ gap: 4 }}>
        <span className="faint bold">السعر الأصلي (يظهر مشطوباً)</span>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <input
            type="number" min="0" className="input input-sm num" style={{ width: 110 }}
            value={listPrice} onChange={(e) => onChange({ listPrice: e.target.value })}
          />
          <span className="xs faint">
            {off > 0 ? `الخصم يظهر ${off}%` : 'اتركه صفراً أو أقل من السعر المعروض ليختفي الشطب'}
          </span>
        </div>
      </label>
      <div className="stack xs" style={{ gap: 6 }}>
        <span className="faint bold">المزايا</span>
        {features.map((f, i) => (
          <div key={i} className="row" style={{ gap: 6 }}>
            <input
              className="input input-sm grow" value={f}
              placeholder="ميزة…" onChange={(e) => setFeature(i, e.target.value)}
            />
            <button className="btn btn-outline btn-icon btn-sm" title="حذف" onClick={() => removeFeature(i)}>
              <Icon name="delete" size={14} />
            </button>
          </div>
        ))}
        <button className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={addFeature}>
          <Icon name="add" size={14} /> إضافة ميزة
        </button>
      </div>
    </div>
  )
}

export default function PlanEditor() {
  const toast = useToast()
  const [tenants, setTenants] = useState(null)
  const [cfg, setCfg] = useState(null)          // {prices, features} from Firestore
  const [draft, setDraft] = useState(null)       // editable copy
  const [saving, setSaving] = useState(false)

  // bulk selection + actions
  const [selected, setSelected] = useState(() => new Set())
  const [bulkPlan, setBulkPlan] = useState('menu')
  const [bulkDays, setBulkDays] = useState(30)
  const [busy, setBusy] = useState(false)

  // Custom price overrides live in platformVenueMeta now (the tenant doc is
  // world-readable); the map keys venue id → {customPrice, note}.
  const [meta, setMeta] = useState({})
  useEffect(() => watchAllTenants(setTenants), [])
  useEffect(() => watchAllVenueMeta(setMeta), [])
  useEffect(() => watchPlansConfig((c) => {
    setCfg(c)
    // Only seed the draft the first time (or keep it if user hasn't touched it).
    setDraft((prev) => prev || {
      prices: { ...c.prices }, listPrices: { ...(c.listPrices || {}) }, features: cloneFeatures(c.features),
      promo: { ...(c.promo || { active: false, labelAr: 'سعر الانطلاقة', validUntil: 0 }) },
    })
  }), [])

  const dirty = useMemo(() => {
    if (!cfg || !draft) return false
    const a = { prices: draft.prices, listPrices: draft.listPrices, features: draft.features, promo: draft.promo }
    const b = { prices: cfg.prices, listPrices: cfg.listPrices || {}, features: cfg.features, promo: cfg.promo || { active: false, labelAr: 'سعر الانطلاقة', validUntil: 0 } }
    return JSON.stringify(a) !== JSON.stringify(b)
  }, [cfg, draft])

  if (tenants === null || draft === null) return <Spinner />

  const patchPlan = (planId, patch) => {
    setDraft((d) => {
      const next = { ...d, prices: { ...d.prices }, listPrices: { ...d.listPrices }, features: cloneFeatures(d.features) }
      if (patch.price !== undefined) next.prices[planId] = patch.price
      if (patch.listPrice !== undefined) next.listPrices[planId] = patch.listPrice
      if (patch.features !== undefined) next.features[planId] = patch.features
      return next
    })
  }
  const patchPromo = (patch) => setDraft((d) => ({ ...d, promo: { ...d.promo, ...patch } }))

  const saveConfig = async () => {
    setSaving(true)
    try {
      const prices = {}
      const listPrices = {}
      const features = {}
      PLANS.forEach((p) => {
        prices[p.id] = Number(draft.prices[p.id]) || 0
        listPrices[p.id] = Number(draft.listPrices[p.id]) || 0
        features[p.id] = (draft.features[p.id] || []).map((s) => String(s).trim()).filter(Boolean)
      })
      await savePlansConfig({
        prices, listPrices, features,
        promo: {
          active: !!draft.promo.active,
          labelAr: String(draft.promo.labelAr || 'سعر الانطلاقة').trim(),
          validUntil: Number(draft.promo.validUntil) || 0,
        },
      })
      toast.success('تم حفظ الباقات والأسعار')
    } catch {
      toast.error('تعذّر حفظ الإعدادات')
    } finally {
      setSaving(false)
    }
  }

  // ---- bulk selection ----
  const toggle = (id) => setSelected((s) => {
    const next = new Set(s)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const allSelected = tenants.length > 0 && selected.size === tenants.length
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(tenants.map((t) => t.id)))
  const selectedTenants = tenants.filter((t) => selected.has(t.id))

  const doBulkPlan = async () => {
    if (!selectedTenants.length) return
    const label = PLANS.find((p) => p.id === bulkPlan)?.ar || bulkPlan
    if (!window.confirm(`تغيير باقة ${selectedTenants.length} منشأة إلى «${label}»؟`)) return
    setBusy(true)
    try {
      const r = await bulkSetPlan(selectedTenants.map((t) => t.id), bulkPlan)
      toast.success(`تم تحديث ${r.ok} منشأة${r.fail ? ` · فشل ${r.fail}` : ''}`)
      setSelected(new Set())
    } catch {
      toast.error('تعذّر تنفيذ العملية')
    } finally {
      setBusy(false)
    }
  }

  const doBulkExtend = async () => {
    if (!selectedTenants.length) return
    const n = Number(bulkDays) || 0
    if (!n) return toast.error('أدخل عدد أيام صحيح')
    if (!window.confirm(`تمديد اشتراك ${selectedTenants.length} منشأة بمقدار ${n} يوم؟`)) return
    setBusy(true)
    try {
      const r = await bulkExtend(selectedTenants, n)
      toast.success(`تم تمديد ${r.ok} منشأة${r.fail ? ` · فشل ${r.fail}` : ''}`)
      setSelected(new Set())
    } catch {
      toast.error('تعذّر تنفيذ العملية')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page stack" style={{ gap: 'var(--sp-5)' }}>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 className="page-title">محرّر الباقات والأسعار</h2>
          <p className="muted small">تعديل أسعار ومزايا كل باقة، وإجراءات جماعية على الاشتراكات</p>
        </div>
        <button className={`btn ${dirty ? 'btn-primary' : 'btn-outline'}`} disabled={!dirty || saving} onClick={saveConfig}>
          <Icon name="check" size={15} /> {saving ? 'جارٍ الحفظ…' : 'حفظ الأسعار'}
        </button>
      </div>

      {/* the launch offer — ONE switch that turns every struck-through price
          on or off, so ending it in January is a single click, not an edit
          per plan */}
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <div className="row-between wrap" style={{ gap: 10 }}>
          <div>
            <strong className="small">عرض الانطلاقة</strong>
            <div className="xs faint">
              حين يكون مفعّلاً وساري المدة، تُطبع الأسعار الأصلية مشطوبةً في عروض الأسعار والفواتير.
              إطفاؤه هنا يوقفها كلها دفعةً واحدة.
            </div>
          </div>
          <button
            className={`btn btn-sm ${draft.promo.active ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => patchPromo({ active: !draft.promo.active })}
          >
            <Icon name={draft.promo.active ? 'ok' : 'no'} size={14} /> {draft.promo.active ? 'مفعّل' : 'متوقف'}
          </button>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="stack" style={{ gap: 4, minWidth: 170 }}>
            <span className="xs faint bold">اسم العرض على المستند</span>
            <input className="input input-sm" value={draft.promo.labelAr || ''} onChange={(e) => patchPromo({ labelAr: e.target.value })} />
          </label>
          <label className="stack" style={{ gap: 4, minWidth: 170 }}>
            <span className="xs faint bold">ساري حتى</span>
            <input
              className="input input-sm" type="date"
              value={draft.promo.validUntil ? new Date(Number(draft.promo.validUntil)).toISOString().slice(0, 10) : ''}
              onChange={(e) => patchPromo({ validUntil: e.target.value ? Date.parse(`${e.target.value}T23:59:59+03:00`) : 0 })}
            />
          </label>
          <span className="xs faint">
            {draft.promo.active && draft.promo.validUntil && Date.now() > Number(draft.promo.validUntil)
              ? 'انتهت المدة — لن يظهر أي شطب حتى تُمدَّد.'
              : 'اتركه فارغاً ليستمر بلا تاريخ انتهاء.'}
          </span>
        </div>
      </div>

      {/* (1) plan pricing + features */}
      <div style={{ display: 'grid', gap: 'var(--sp-3)', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {PLANS.map((p) => (
          <PlanCard
            key={p.id} plan={p}
            price={draft.prices[p.id] ?? 0}
            listPrice={draft.listPrices[p.id] ?? 0}
            features={draft.features[p.id] || []}
            onChange={(patch) => patchPlan(p.id, patch)}
          />
        ))}
      </div>

      {/* (2) bulk subscription actions */}
      <div className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <strong className="row" style={{ gap: 6 }}><Icon name="scale" size={16} /> إجراءات جماعية</strong>
          <span className="xs faint">محدد: {selected.size} من {tenants.length}</span>
        </div>

        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="stack xs" style={{ gap: 4 }}>
            <span className="faint bold">تغيير الباقة إلى</span>
            <div className="row" style={{ gap: 6 }}>
              <select className="input input-sm" style={{ width: 'auto' }} value={bulkPlan} onChange={(e) => setBulkPlan(e.target.value)}>
                {PLANS.map((p) => <option key={p.id} value={p.id}>{p.ar}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" disabled={busy || !selected.size} onClick={doBulkPlan}>تطبيق</button>
            </div>
          </label>
          <label className="stack xs" style={{ gap: 4 }}>
            <span className="faint bold">تمديد الاشتراك (أيام)</span>
            <div className="row" style={{ gap: 6 }}>
              <input type="number" className="input input-sm num" style={{ width: 90 }} value={bulkDays} onChange={(e) => setBulkDays(e.target.value)} />
              <button className="btn btn-primary btn-sm" disabled={busy || !selected.size} onClick={doBulkExtend}>تمديد</button>
            </div>
          </label>
        </div>

        {/* selectable venue list */}
        {tenants.length === 0 ? (
          <Empty icon="store" title="لا توجد منشآت" hint="سجّل منشأة أولاً" />
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span className="xs bold">تحديد الكل</span>
            </label>
            <div className="divide" style={{ maxHeight: 420, overflowY: 'auto' }}>
              {tenants.map((t) => (
                <VenueSelectRow key={t.id} t={t} meta={meta[t.id]} checked={selected.has(t.id)} onToggle={() => toggle(t.id)} price={draft.prices[t.plan || 'enterprise']} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---- (3) a venue row: checkbox + inline custom price override ----
function VenueSelectRow({ t, meta, checked, onToggle, price }) {
  const toast = useToast()
  // platformVenueMeta first; the tenant-doc field only as a legacy fallback
  // for a roster the self-heal migration hasn't finished moving yet.
  const current = meta?.customPrice ?? t.customPrice ?? ''
  const [custom, setCustom] = useState(current)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setCustom(current) }, [current])
  const dirty = String(custom) !== String(current)

  const saveCustom = async () => {
    setSaving(true)
    try {
      await setCustomPrice(t.id, custom === '' ? null : custom)
      toast.success(`تم تحديث سعر «${t.name || t.id}»`)
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="list-row row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <div className="grow" style={{ minWidth: 150 }}>
        <Link to={`/platform/venues/${t.id}`} className="bold">{t.name || t.id}</Link>
        <div className="xs faint">/{t.slug} · انضمت {fmtWhen(t.createdAt)}</div>
      </div>
      <StatusChip tenant={t} />
      <PlanBadge plan={t.plan || 'enterprise'} />
      <span className="xs faint num" title="سعر الباقة">{Number(price) || 0} ريال</span>
      <div className="row" style={{ gap: 4, alignItems: 'center' }}>
        <input
          type="number" min="0" className="input input-sm num" style={{ width: 90 }}
          placeholder="سعر خاص" value={custom} onChange={(e) => setCustom(e.target.value)}
        />
        <button className={`btn btn-sm ${dirty ? 'btn-primary' : 'btn-outline'}`} disabled={!dirty || saving} onClick={saveCustom} title="حفظ السعر الخاص">
          <Icon name="check" size={14} />
        </button>
      </div>
    </div>
  )
}

function cloneFeatures(f) {
  const out = {}
  PLANS.forEach((p) => { out[p.id] = Array.isArray(f?.[p.id]) ? f[p.id].slice() : [] })
  return out
}
