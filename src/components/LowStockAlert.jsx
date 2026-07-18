import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { watchMaterials, watchItems } from '../lib/db.js'
import { fmtBaseQty } from '../lib/units.js'
import Icon from './Icon.jsx'

// Manager-home banner: raw materials at/below reorder level + out-of-stock finished goods.
export default function LowStockAlert() {
  const { lang } = useI18n()
  const { tenantId } = useAuth()
  const ar = lang === 'ar'
  const [mats, setMats] = useState([])
  const [items, setItems] = useState([])

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchMaterials(tenantId, setMats)
    const u2 = watchItems(tenantId, setItems)
    return () => { u1(); u2() }
  }, [tenantId])

  const daysUntil = (d) => { try { return Math.ceil((new Date(d) - new Date()) / 86400000) } catch (_) { return 999 } }
  const lowMats = mats.filter((m) => m.trackStock && (m.stockQty || 0) <= (Number(m.reorderLevel) || 0))
  const outItems = items.filter((i) => i.trackStock && (i.stock || 0) <= 0)
  const expiring = mats.filter((m) => m.expiryDate && daysUntil(m.expiryDate) <= 7)
  if (!lowMats.length && !outItems.length && !expiring.length) return null

  return (
    <div className="card card-pad stack" style={{ gap: 8, borderColor: 'var(--danger)' }}>
      <div className="row-between">
        <strong className="small" style={{ color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="warning" size={14} /> {ar ? 'تنبيه المخزون' : 'Stock alerts'}</strong>
        <Link to="/admin/inventory" className="btn btn-sm btn-outline">{ar ? 'المخزون' : 'Inventory'}</Link>
      </div>
      {lowMats.slice(0, 6).map((m) => {
        const order = (Number(m.parLevel) || 0) - (m.stockQty || 0)
        return (
          <div key={m.id} className="row-between xs">
            <span>{ar ? m.nameAr : (m.nameEn || m.nameAr)}{order > 0 ? ` · ${ar ? 'اطلب' : 'order'} ${fmtBaseQty(order, m.baseUnit, lang)}` : ''}</span>
            <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{fmtBaseQty(m.stockQty || 0, m.baseUnit, lang)}</span>
          </div>
        )
      })}
      {expiring.slice(0, 4).map((m) => {
        const dleft = daysUntil(m.expiryDate)
        return (
          <div key={`x${m.id}`} className="row-between xs">
            <span>{ar ? m.nameAr : (m.nameEn || m.nameAr)}</span>
            <span className="badge badge-gold">{dleft <= 0 ? (ar ? 'منتهية' : 'Expired') : (ar ? `تنتهي خلال ${dleft}ي` : `${dleft}d left`)}</span>
          </div>
        )
      })}
      {outItems.slice(0, 4).map((i) => (
        <div key={i.id} className="row-between xs">
          <span>{ar ? i.nameAr : (i.nameEn || i.nameAr)}</span>
          <span className="badge badge-danger">{ar ? 'نفد' : 'Out'}</span>
        </div>
      ))}
      {(lowMats.length > 6 || outItems.length > 4) && <span className="xs faint">{ar ? '…والمزيد في قسم المخزون' : '…more in Inventory'}</span>}
    </div>
  )
}
