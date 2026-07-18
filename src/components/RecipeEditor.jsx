import Icon from './Icon.jsx'
import { pickLang } from '../lib/i18n.jsx'
import { unitLabel } from '../lib/units.js'

// Bill-of-materials editor for a menu item: link raw materials (qty in base unit) per variant.
// onChange({ recipe, variantRecipes }). recipe = default/variantless lines.
export default function RecipeEditor({ lang = 'ar', variants = [], materials = [], recipe = [], variantRecipes = {}, onChange }) {
  const ar = lang === 'ar'
  const groups = variants.length
    ? variants.map((v, i) => ({ key: v.key || `v${i}`, label: pickLang(v, 'name', lang) }))
    : [{ key: '__default', label: ar ? 'الوصفة' : 'Recipe' }]
  const getLines = (key) => (key === '__default' ? recipe : (variantRecipes[key] || []))
  const setLines = (key, lines) => {
    if (key === '__default') onChange({ recipe: lines, variantRecipes })
    else onChange({ recipe, variantRecipes: { ...variantRecipes, [key]: lines } })
  }
  const addLine = (key) => setLines(key, [...getLines(key), { materialId: materials[0]?.id || '', qty: '' }])
  const setLine = (key, i, patch) => setLines(key, getLines(key).map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const delLine = (key, i) => setLines(key, getLines(key).filter((_, idx) => idx !== i))
  const matBase = (id) => materials.find((m) => m.id === id)?.baseUnit || 'g'

  if (!materials.length) return <p className="xs faint">{ar ? 'أضِف مواد خام من قسم «المخزون» أولاً لربط الوصفة.' : 'Add raw materials in Inventory first to link a recipe.'}</p>

  return (
    <div className="stack" style={{ gap: 10 }}>
      {groups.map((g) => (
        <div key={g.key} className="stack" style={{ gap: 6 }}>
          {groups.length > 1 && <span className="xs bold" style={{ color: 'var(--brand)' }}>{g.label}</span>}
          {getLines(g.key).map((l, i) => (
            <div key={i} className="row" style={{ gap: 6, alignItems: 'center' }}>
              <select className="select grow" value={l.materialId} onChange={(e) => setLine(g.key, i, { materialId: e.target.value })}>
                {materials.map((m) => <option key={m.id} value={m.id}>{ar ? m.nameAr : (m.nameEn || m.nameAr)}</option>)}
              </select>
              <input className="input num" style={{ width: 72 }} type="number" inputMode="decimal" placeholder={ar ? 'كمية' : 'qty'} value={l.qty} onChange={(e) => setLine(g.key, i, { qty: e.target.value })} />
              <span className="xs faint" style={{ minWidth: 28 }}>{unitLabel(matBase(l.materialId), lang)}</span>
              <button className="icon-btn" style={{ color: 'var(--danger)', width: 28, height: 28 }} onClick={() => delLine(g.key, i)}><Icon name="close" size={14} /></button>
            </div>
          ))}
          <button className="btn btn-sm btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => addLine(g.key)}><Icon name="add" size={14} /> {ar ? 'مادة' : 'Material'}</button>
        </div>
      ))}
    </div>
  )
}
