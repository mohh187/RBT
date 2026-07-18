import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { Price } from '../../components/Riyal.jsx'
import { watchMaterials, watchStockMoves } from '../../lib/db.js'
import { fmtBaseQty } from '../../lib/units.js'

const TYPE = {
  receive: { ar: 'استلام', en: 'Receive', c: 'var(--success)' },
  sale: { ar: 'بيع', en: 'Sale', c: 'var(--text-muted)' },
  waste: { ar: 'هدر', en: 'Waste', c: 'var(--danger)' },
  count: { ar: 'جرد', en: 'Count', c: 'var(--brand)' },
}

export default function StockMoves() {
  const { lang } = useI18n()
  const { tenantId, tenant } = useAuth()
  const ar = lang === 'ar'
  const currency = tenant?.currency || 'SAR'
  const [moves, setMoves] = useState(null)
  const [mats, setMats] = useState([])

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchStockMoves(tenantId, setMoves)
    const u2 = watchMaterials(tenantId, setMats)
    return () => { u1(); u2() }
  }, [tenantId])

  const mat = (id) => mats.find((x) => x.id === id)
  const matName = (id) => { const m = mat(id); return m ? (ar ? m.nameAr : (m.nameEn || m.nameAr)) : (id || '') }
  const fmtTime = (ms) => { try { return new Date(ms).toLocaleString(ar ? 'ar-SA' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch (_) { return '' } }

  if (moves === null) return <Spinner />
  if (!moves.length) return <Empty icon="file" title={ar ? 'لا حركات مخزون' : 'No stock movements'} />

  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      {moves.map((mv) => {
        const ty = TYPE[mv.type] || { ar: mv.type, en: mv.type, c: 'var(--text-muted)' }
        const base = mat(mv.materialId)?.baseUnit || 'g'
        return (
          <div key={mv.id} className="list-row">
            <div className="grow">
              <div className="bold small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{matName(mv.materialId)} <span className="badge" style={{ borderColor: ty.c, color: ty.c, background: 'transparent' }}>{ar ? ty.ar : ty.en}</span></div>
              <div className="xs faint">{fmtTime(mv.at)}{mv.byName ? ` · ${mv.byName}` : ''}{mv.reason ? ` · ${mv.reason}` : ''}</div>
            </div>
            <div className="text-center">
              <div className="bold small" style={{ color: (mv.qty || 0) < 0 ? 'var(--danger)' : 'var(--success)' }}>{(mv.qty || 0) >= 0 ? '+' : ''}{fmtBaseQty(mv.qty || 0, base, lang)}</div>
              {mv.cost ? <div className="xs faint"><Price value={mv.cost} currency={currency} lang={lang} /></div> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
