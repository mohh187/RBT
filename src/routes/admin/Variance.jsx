import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { Price } from '../../components/Riyal.jsx'
import { watchMaterials, watchStockMoves } from '../../lib/db.js'
import { fmtBaseQty } from '../../lib/units.js'

// Stock variance: aggregates physical-count adjustments (theoretical vs actual) + cost impact.
export default function Variance() {
  const { lang } = useI18n()
  const { tenantId, tenant } = useAuth()
  const ar = lang === 'ar'
  const currency = tenant?.currency || 'SAR'
  const [moves, setMoves] = useState(null)
  const [mats, setMats] = useState([])

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchStockMoves(tenantId, setMoves, 300)
    const u2 = watchMaterials(tenantId, setMats)
    return () => { u1(); u2() }
  }, [tenantId])

  const rows = useMemo(() => {
    const counts = (moves || []).filter((m) => m.type === 'count' && m.reason !== 'restore')
    const byMat = {}
    counts.forEach((c) => { byMat[c.materialId] = (byMat[c.materialId] || 0) + (c.qty || 0) })
    return Object.entries(byMat)
      .map(([mid, delta]) => { const m = mats.find((x) => x.id === mid); return { mid, name: m ? (ar ? m.nameAr : (m.nameEn || m.nameAr)) : mid, baseUnit: m?.baseUnit || 'g', delta, cost: (m?.avgCost || 0) * Math.abs(delta) } })
      .filter((r) => r.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  }, [moves, mats, lang])

  if (moves === null) return <Spinner />
  if (!rows.length) return <Empty icon="scale" title={ar ? 'لا فروقات جرد' : 'No count variances'} hint={ar ? 'تظهر هنا فروق الجرد (النظري مقابل المعدود الفعلي)' : 'Differences between theoretical & counted stock show here'} />

  const totalLoss = rows.filter((r) => r.delta < 0).reduce((s, r) => s + r.cost, 0)
  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      <div className="card card-pad row-between"><span className="small">{ar ? 'إجمالي تكلفة العجز' : 'Total shortage cost'}</span><span className="price bold" style={{ color: 'var(--danger)' }}><Price value={totalLoss} currency={currency} lang={lang} /></span></div>
      {rows.map((r) => (
        <div key={r.mid} className="list-row" style={{ borderColor: r.delta < 0 ? 'var(--danger)' : undefined }}>
          <div className="grow"><div className="bold small">{r.name}</div><div className="xs faint">{ar ? 'تكلفة الفرق' : 'cost impact'} <Price value={r.cost} currency={currency} lang={lang} /></div></div>
          <span className="bold" style={{ color: r.delta < 0 ? 'var(--danger)' : 'var(--success)' }}>{r.delta >= 0 ? '+' : ''}{fmtBaseQty(r.delta, r.baseUnit, lang)}</span>
        </div>
      ))}
    </div>
  )
}
