import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n, pickLang } from '../../lib/i18n.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { Price } from '../../components/Riyal.jsx'
import { watchItems, watchMaterials } from '../../lib/db.js'

// Cost of goods + margin per recipe item, from each item's BOM × material avg cost.
export default function Costing() {
  const { lang } = useI18n()
  const { tenantId, tenant } = useAuth()
  const ar = lang === 'ar'
  const currency = tenant?.currency || 'SAR'
  const [items, setItems] = useState(null)
  const [mats, setMats] = useState([])

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchItems(tenantId, setItems)
    const u2 = watchMaterials(tenantId, setMats)
    return () => { u1(); u2() }
  }, [tenantId])

  const costOf = (lines) => (lines || []).reduce((s, l) => { const m = mats.find((x) => x.id === l.materialId); return s + (m?.avgCost || 0) * (Number(l.qty) || 0) }, 0)

  const rows = useMemo(() => (items || []).filter((i) => i.stockMode === 'recipe').map((it) => {
    const variants = it.variants || []
    const lines = variants.length
      ? variants.map((v, i) => ({ name: pickLang(v, 'name', lang), price: Number(v.price) || 0, cost: costOf((it.variantRecipes || {})[v.key || `v${i}`] || it.recipe) }))
      : [{ name: '', price: Number(it.price) || 0, cost: costOf(it.recipe) }]
    return { id: it.id, name: pickLang(it, 'name', lang), lines }
  }), [items, mats, lang])

  if (items === null) return <Spinner />
  if (!rows.length) return <Empty icon="reports" title={ar ? 'لا أصناف بوصفات' : 'No recipe items'} hint={ar ? 'اربط وصفات بالأصناف لرؤية التكلفة والهامش' : 'Link recipes to items to see cost & margin'} />

  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      {rows.map((r) => (
        <div key={r.id} className="card card-pad stack" style={{ gap: 6 }}>
          <strong className="small">{r.name}</strong>
          {r.lines.map((v, i) => {
            const margin = v.price - v.cost
            const pct = v.price > 0 ? Math.round((margin / v.price) * 100) : 0
            return (
              <div key={i} className="row-between xs" style={{ flexWrap: 'wrap', gap: 6 }}>
                <span className="faint">{v.name || (ar ? 'السعر' : 'Price')}</span>
                <span className="row" style={{ gap: 10, alignItems: 'center' }}>
                  <span>{ar ? 'تكلفة' : 'cost'} <Price value={v.cost} currency={currency} lang={lang} /></span>
                  <span>{ar ? 'سعر' : 'price'} <Price value={v.price} currency={currency} lang={lang} /></span>
                  <span style={{ color: margin >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>{pct}%</span>
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
