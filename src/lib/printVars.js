// VARIABLE DATA FOR PRINT DESIGNS.
//
// A print design is a template, and a table sticker is that template printed
// once per table: the QR must resolve to THAT table's token and the number must
// read THAT table's label. Both the live canvas and the PNG rasterizer need the
// identical substitution or an export silently disagrees with its preview, so
// the rule lives here rather than in either of them.
//
// Kept dependency-free (no React, no canvas) precisely so both can import it
// without a cycle.

export const PRINT_TOKENS = [
  { token: '{{table}}', ar: 'رقم الطاولة', en: 'Table label' },
  { token: '{{venue}}', ar: 'اسم المنشأة', en: 'Venue name' },
]

// Unresolved tokens collapse to '' rather than printing the braces — a sticker
// that reads «طاولة {{table}}» on a stand is worse than one that reads «طاولة».
export function applyVars(text, vars) {
  if (!text || String(text).indexOf('{{') === -1) return text || ''
  return String(text)
    .replace(/\{\{\s*table\s*\}\}/gi, vars?.tableLabel ?? '')
    .replace(/\{\{\s*venue\s*\}\}/gi, vars?.venueName ?? '')
}

// True when a design depends on per-table data, i.e. printing one copy is
// meaningless and it should be run over a table set instead.
export function usesTableVars(design) {
  return (design?.elements || []).some(
    (el) => (el.type === 'qr' && el.kind === 'table')
      || (el.type === 'text' && /\{\{\s*table\s*\}\}/i.test(el.text || '')),
  )
}

// CACHE KEY FOR A RENDERED QR.
//
// Once every QR element carries its own style and colours, one shared dataURL is
// no longer enough — two codes on the same page can legitimately differ in shape,
// palette AND target table. Rasterising is also far too slow to redo per frame,
// so the studio renders each DISTINCT combination once into a map and both the
// DOM and the canvas exporter look it up by this key.
//
// Both renderers MUST derive the key identically or an export silently falls back
// to the wrong code, which is why this lives here beside applyVars rather than in
// either renderer.
export function qrKeyOf(el, vars) {
  const target = el?.kind === 'table' ? `t:${vars?.tableId || ''}` : 'menu'
  // EVERY input that changes the rendered pixels belongs in the key. Frame and
  // caption were the easy ones to forget: leave them out and editing the caption
  // updates nothing, because the cache keeps serving the previous render.
  return [
    target, el?.qrStyle || 'classic',
    el?.qrDark || '', el?.qrDark2 || '', el?.qrLight || '',
    el?.qrFrame || 'none', el?.qrCaption || '', el?.qrFrameColor || '',
  ].join('|')
}

// Every distinct QR that a design needs for a given set of rows. Used to build
// the map once up front instead of discovering keys mid-render.
export function qrKeysForDesign(design, rows = [null]) {
  const els = (design?.elements || []).filter((e) => e.type === 'qr' && !e.hidden)
  const out = new Map()
  for (const el of els) {
    for (const vars of (el.kind === 'table' ? rows : [null])) {
      const key = qrKeyOf(el, vars)
      if (!out.has(key)) out.set(key, { el, vars })
    }
  }
  return out
}
