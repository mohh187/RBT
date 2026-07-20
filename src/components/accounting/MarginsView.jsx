import { useMemo, useState } from 'react'
import { Price } from '../Riyal.jsx'
import Icon from '../Icon.jsx'
import { downloadCsv } from '../../lib/accounting.js'

// Per-item cost vs price vs margin, worst first. Cost comes ONLY from a real
// recipe priced at the material's weighted average cost; an item with no recipe
// is shown as "غير مسعّر" rather than being assigned a made-up cost.
export default function MarginsView({ margins, inventory, ar = true, lang = 'ar', currency = 'SAR', showMoney = true }) {
  const [onlySold, setOnlySold] = useState(true)
  const M = ({ v }) => (showMoney ? <Price value={v} currency={currency} lang={lang} /> : <span className="faint">—</span>)

  const rows = useMemo(
    () => (margins.rows || []).filter((r) => (onlySold ? r.qtySold > 0 : true)),
    [margins.rows, onlySold],
  )

  const exportCsv = () => downloadCsv('item-margins.csv', rows.map((r) => ({
    name: r.nameAr, price: r.price, cost: r.cost == null ? '' : r.cost,
    margin: r.margin == null ? '' : r.margin, marginPct: r.marginPct == null ? '' : r.marginPct,
    cogsPct: r.cogsPct == null ? '' : r.cogsPct, qty: r.qtySold, revenue: r.revenue,
  })), [
    { key: 'name', label: ar ? 'الصنف' : 'Item' },
    { key: 'price', label: ar ? 'السعر' : 'Price' },
    { key: 'cost', label: ar ? 'التكلفة' : 'Cost' },
    { key: 'margin', label: ar ? 'الهامش' : 'Margin' },
    { key: 'marginPct', label: ar ? 'الهامش %' : 'Margin %' },
    { key: 'cogsPct', label: ar ? 'نسبة التكلفة %' : 'COGS %' },
    { key: 'qty', label: ar ? 'الكمية المباعة' : 'Qty sold' },
    { key: 'revenue', label: ar ? 'الإيراد' : 'Revenue' },
  ])

  return (
    <div className="acc-stack">
      <div className="acc-kpis">
        <div className="acc-kpi">
          <span className="acc-kpi-label">{ar ? 'قيمة المخزون' : 'Inventory value'}</span>
          <span className="acc-kpi-value"><M v={inventory.total} /></span>
          <span className="acc-kpi-sub">{ar ? `${inventory.count} مادة` : `${inventory.count} materials`}</span>
        </div>
        <div className="acc-kpi">
          <span className="acc-kpi-label">{ar ? 'أصناف مسعّرة بوصفة' : 'Items with a recipe'}</span>
          <span className="acc-kpi-value acc-num">{margins.costedCount}</span>
          <span className="acc-kpi-sub">{ar ? `${margins.uncostedCount} بلا وصفة` : `${margins.uncostedCount} without`}</span>
        </div>
        <div className="acc-kpi" data-tone={margins.belowCost.length ? 'bad' : ''}>
          <span className="acc-kpi-label">{ar ? 'أصناف تُباع بخسارة' : 'Sold below cost'}</span>
          <span className="acc-kpi-value acc-num">{margins.belowCost.length}</span>
        </div>
        {inventory.unpriced > 0 && (
          <div className="acc-kpi" data-tone="bad">
            <span className="acc-kpi-label">{ar ? 'مواد بلا تكلفة مسجّلة' : 'Materials without cost'}</span>
            <span className="acc-kpi-value acc-num">{inventory.unpriced}</span>
            <span className="acc-kpi-sub">{ar ? 'قيمة المخزون أقل من الحقيقة' : 'Valuation understated'}</span>
          </div>
        )}
      </div>

      {margins.uncostedCount > 0 && (
        <div className="acc-warn">
          <Icon name="warning" size={15} />
          <span>
            {ar
              ? `${margins.uncostedCount} صنفاً بلا وصفة مرتبطة بالمواد الخام، لذلك لا تُحتسب تكلفتها ضمن تكلفة البضاعة المباعة وهامش الربح الحقيقي أقل مما يظهر. اربط وصفاتها من شاشة المخزون.`
              : `${margins.uncostedCount} items have no recipe, so their cost is excluded from COGS.`}
          </span>
        </div>
      )}

      <div className="acc-card">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="acc-card-title"><Icon name="scale" size={17} /> {ar ? 'التكاليف والهوامش' : 'Costs & margins'}</span>
          <span className="row" style={{ gap: 8, alignItems: 'center' }}>
            <label className="acc-check">
              <input type="checkbox" checked={onlySold} onChange={(e) => setOnlySold(e.target.checked)} />
              <span>{ar ? 'المباع فقط' : 'Sold only'}</span>
            </label>
            <button className="btn btn-sm btn-outline" onClick={exportCsv} disabled={!rows.length}><Icon name="download" size={15} /> CSV</button>
          </span>
        </div>

        {!rows.length ? (
          <p className="acc-empty">{ar ? 'لا أصناف مطابقة.' : 'No items.'}</p>
        ) : (
          <div className="acc-scroll-x">
            <table className="acc-table">
              <thead>
                <tr>
                  <th>{ar ? 'الصنف' : 'Item'}</th>
                  <th className="acc-ta-end">{ar ? 'السعر' : 'Price'}</th>
                  <th className="acc-ta-end">{ar ? 'التكلفة' : 'Cost'}</th>
                  <th className="acc-ta-end">{ar ? 'الهامش' : 'Margin'}</th>
                  <th className="acc-ta-end">{ar ? 'الهامش %' : 'Margin %'}</th>
                  <th className="acc-ta-end">{ar ? 'مباع' : 'Sold'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-loss={r.belowCost ? '1' : ''}>
                    <td>
                      <span className="acc-item-name">{ar ? r.nameAr : (r.nameEn || r.nameAr)}</span>
                      {r.belowCost && <span className="acc-loss-tag">{ar ? 'يُباع بخسارة' : 'Below cost'}</span>}
                      {!r.costed && <span className="acc-uncosted-tag">{ar ? 'غير مسعّر' : 'No recipe'}</span>}
                    </td>
                    <td className="acc-ta-end acc-num"><M v={r.price} /></td>
                    <td className="acc-ta-end acc-num">{r.costed ? <M v={r.cost} /> : <span className="faint">—</span>}</td>
                    <td className="acc-ta-end acc-num">{r.costed ? <M v={r.margin} /> : <span className="faint">—</span>}</td>
                    <td className="acc-ta-end acc-num acc-pct-cell">{r.marginPct == null ? <span className="faint">—</span> : `${r.marginPct}%`}</td>
                    <td className="acc-ta-end acc-num">{r.qtySold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="acc-card">
        <span className="acc-card-title"><Icon name="inventory" size={17} /> {ar ? 'تقييم المخزون' : 'Inventory valuation'}</span>
        {!inventory.rows.length ? (
          <p className="acc-empty">{ar ? 'لا مواد خام مسجّلة.' : 'No materials.'}</p>
        ) : (
          <div className="acc-scroll-y acc-inv-scroll">
            {inventory.rows.slice(0, 60).map((m) => (
              <div key={m.id} className="acc-inv-row">
                <span className="acc-inv-name">{ar ? m.nameAr : (m.nameEn || m.nameAr)}</span>
                <span className="acc-period-label acc-num">{m.qty} {m.unit}</span>
                <span className="acc-num acc-inv-val">{m.avgCost === 0 && m.qty > 0 ? <span className="faint">{ar ? 'بلا تكلفة' : 'No cost'}</span> : <M v={m.value} />}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
