import { tableStyle, tableBoxStyle, tableFreeStyle, tableMeltStops, tableMeltBottom } from '../../lib/dishComposition.js'

// ONE paint stack for the menu engine AND the settings card mock. The mock
// used to apply the free transform to the whole box (clip + melt rode along),
// so the card disagreed with the menu on every free/reading dial and the
// owner reported the dials as dead. Furniture (art+tint+dim) and the physical
// lip (edge+contact) ride the free transform in twin wrappers; the reading
// layers (melt/melt-b/veil) stay pinned to the panel box. dim rides the
// FURNITURE wrapper: the contract calls it a veil over the SURFACE, and
// pinned it darkened canvas where no table exists (a stretched box with melt
// near 0 grew a floating dark slab — the very «ظل» class of complaint).
// Paint order is load-bearing: art → tint → dim → melt → melt-b → veil →
// edge → contact. Imports ONLY the contract, never the theme — the admin
// bundle must not swallow the brick generators.
export default function TablePaint({ tb }) {
  if (!tb) return null
  const { a, b } = tableMeltStops(tb)
  const mb = tableMeltBottom(tb)
  const free = tableFreeStyle(tb)
  return (
    <span
      className="edt-table"
      aria-hidden="true"
      style={{ '--tbl-a': `${a}%`, '--tbl-b': `${b}%`, '--tbl-contact': tb.contact, ...(tableBoxStyle(tb) || {}) }}
    >
      <span className="edt-table-free" style={free || undefined}>
        <span className="edt-table-art" data-m={tb.kind === 'material' ? tb.material : undefined} style={tableStyle(tb) || undefined} />
        {tb.tint && tb.tintAmount > 0
          ? <span className="edt-table-tint" style={{ background: tb.tint, opacity: tb.tintAmount }} />
          : null}
        {tb.dim > 0 ? <span className="edt-table-dim" style={{ opacity: tb.dim }} /> : null}
      </span>
      <span className="edt-table-melt" />
      {mb ? <span className="edt-table-melt-b" style={{ '--tbl-mba': `${mb.a}%`, '--tbl-mbb': `${mb.b}%` }} /> : null}
      {tb.veil > 0 ? <span className="edt-table-veil" style={{ opacity: tb.veil }} /> : null}
      <span className="edt-table-free" style={free || undefined}>
        <span className="edt-table-edge" data-e={tb.edge} />
        {tb.contact > 0 ? <span className="edt-table-contact" /> : null}
      </span>
    </span>
  )
}
