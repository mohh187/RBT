import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n, pickLang } from '../../lib/i18n.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { watchItems, watchCategories, saveItem } from '../../lib/db.js'
import Icon from '../../components/Icon.jsx'
import Materials from './Materials.jsx'
import StockMoves from './StockMoves.jsx'
import Suppliers from './Suppliers.jsx'
import Costing from './Costing.jsx'
import Variance from './Variance.jsx'

const LOW = 5 // low-stock threshold for finished goods (simple mode)

// Inventory hub: raw materials (recipe mode) + finished-good counts (simple mode) + movements.
export default function Inventory() {
  const { t, lang } = useI18n()
  const { tenantId } = useAuth()
  const ar = lang === 'ar'
  const [tab, setTab] = useState('materials')

  return (
    <div className="page stack">
      <h2 className="page-title row" style={{ gap: 8 }}><Icon name="inventory" size={22} /> {ar ? 'المخزون' : 'Inventory'}</h2>
      <div className="row scroll-x" style={{ gap: 8, paddingBottom: 6, borderBottom: '1px solid var(--border)', width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {[
          { id: 'materials', lbl: ar ? 'المواد الخام' : 'Materials', icon: 'inventory' },
          { id: 'simple', lbl: ar ? 'الأصناف الجاهزة' : 'Finished Stock', icon: 'coffee' },
          { id: 'costing', lbl: ar ? 'التكاليف' : 'Costing', icon: 'wallet' },
          { id: 'variance', lbl: ar ? 'الانحراف' : 'Variance', icon: 'trending' },
          { id: 'suppliers', lbl: ar ? 'الموردون' : 'Suppliers', icon: 'staff' },
          { id: 'moves', lbl: ar ? 'الحركات' : 'Movements', icon: 'clock' }
        ].map((tItem) => (
          <button
            key={tItem.id}
            className={`btn btn-sm`}
            style={{
              whiteSpace: 'nowrap',
              flex: '0 0 auto',
              borderRadius: 'var(--r-md)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              border: '1px solid',
              borderColor: tab === tItem.id ? 'var(--brand)' : 'var(--border)',
              background: tab === tItem.id ? 'var(--brand)' : 'var(--surface)',
              color: tab === tItem.id ? 'var(--on-brand)' : 'var(--text-muted)'
            }}
            onClick={() => setTab(tItem.id)}
          >
            <Icon name={tItem.icon} size={14} />
            <span>{tItem.lbl}</span>
          </button>
        ))}
      </div>

      {tab === 'materials' && <Materials />}
      {tab === 'costing' && <Costing />}
      {tab === 'variance' && <Variance />}
      {tab === 'suppliers' && <Suppliers />}
      {tab === 'moves' && <StockMoves />}
      {tab === 'simple' && <SimpleStock tenantId={tenantId} t={t} lang={lang} ar={ar} />}
    </div>
  )
}

// Finished-good stock: a plain on-hand count for items sold as-is (water, ready pastries).
function SimpleStock({ tenantId, t, lang, ar }) {
  const [items, setItems] = useState(null)
  const [cats, setCats] = useState([])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('tracked') // tracked | low | out | all

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchItems(tenantId, setItems)
    const u2 = watchCategories(tenantId, setCats)
    return () => { u1(); u2() }
  }, [tenantId])

  const catName = (id) => { const c = cats.find((x) => x.id === id); return c ? pickLang(c, 'name', lang) : '' }
  const setStock = (it, val) => saveItem(tenantId, it.id, { stock: Math.max(0, Number(val) || 0), trackStock: true })
  const adjust = (it, delta) => setStock(it, (it.stock || 0) + delta)
  const toggleTrack = (it) => saveItem(tenantId, it.id, { trackStock: !it.trackStock })

  const stats = useMemo(() => {
    const list = (items || []).filter((i) => i.trackStock)
    return { tracked: list.length, low: list.filter((i) => (i.stock || 0) > 0 && (i.stock || 0) <= LOW).length, out: list.filter((i) => (i.stock || 0) <= 0).length }
  }, [items])

  const shown = useMemo(() => {
    let list = items || []
    const term = q.trim().toLowerCase()
    if (term) list = list.filter((i) => `${i.nameAr || ''} ${i.nameEn || ''}`.toLowerCase().includes(term))
    if (filter === 'tracked') list = list.filter((i) => i.trackStock)
    else if (filter === 'low') list = list.filter((i) => i.trackStock && (i.stock || 0) > 0 && (i.stock || 0) <= LOW)
    else if (filter === 'out') list = list.filter((i) => i.trackStock && (i.stock || 0) <= 0)
    return list
  }, [items, q, filter])

  if (items === null) return <Spinner />

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat"><div className="label">{ar ? 'مُتتبَّع' : 'Tracked'}</div><div className="value num">{stats.tracked}</div></div>
        <div className="stat"><div className="label">{ar ? 'منخفض' : 'Low'}</div><div className="value num" style={{ color: stats.low ? 'var(--gold, #e0a82e)' : undefined }}>{stats.low}</div></div>
        <div className="stat"><div className="label">{ar ? 'نفد' : 'Out'}</div><div className="value num" style={{ color: stats.out ? 'var(--danger)' : undefined }}>{stats.out}</div></div>
      </div>
      <input className="input" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="segmented">
        {[['tracked', ar ? 'مُتتبَّع' : 'Tracked'], ['low', ar ? 'منخفض' : 'Low'], ['out', ar ? 'نفد' : 'Out'], ['all', ar ? 'الكل' : 'All']].map(([id, lbl]) => (
          <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{lbl}</button>
        ))}
      </div>
      {shown.length === 0 ? (
        <Empty icon="package" title={ar ? 'لا أصناف' : 'No items'} hint={ar ? 'للأصناف المُحضّرة استخدم «المواد الخام» بدل العدّ المباشر' : 'For prepared items use Materials instead of a direct count'} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {shown.map((it) => {
            const s = it.stock || 0
            const state = !it.trackStock ? '' : s <= 0 ? 'out' : s <= LOW ? 'low' : 'ok'
            return (
              <div key={it.id} className="list-row" style={{ borderColor: state === 'out' ? 'var(--danger)' : state === 'low' ? 'var(--gold, #e0a82e)' : undefined }}>
                <div className="grow">
                  <div className="bold" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {pickLang(it, 'name', lang)}
                    {state === 'out' && <span className="badge badge-danger">{ar ? 'نفد' : 'Out'}</span>}
                    {state === 'low' && <span className="badge badge-gold">{ar ? 'منخفض' : 'Low'}</span>}
                  </div>
                  <div className="xs faint">{catName(it.categoryId)}</div>
                </div>
                {it.trackStock ? (
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <button className="icon-btn" onClick={() => adjust(it, -1)} title="-1"><Icon name="close" size={14} /></button>
                    <input className="input num" style={{ width: 64, textAlign: 'center' }} type="number" value={s} onChange={(e) => setStock(it, e.target.value)} />
                    <button className="icon-btn" onClick={() => adjust(it, 1)} title="+1"><Icon name="add" size={15} /></button>
                    <button className="icon-btn xs faint" onClick={() => toggleTrack(it)} title={ar ? 'إيقاف التتبّع' : 'Untrack'}><Icon name="eye" size={14} /></button>
                  </div>
                ) : (
                  <button className="btn btn-sm btn-outline" onClick={() => toggleTrack(it)}>{ar ? 'تتبّع' : 'Track'}</button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
