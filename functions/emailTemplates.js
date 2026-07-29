// ==================== ONE EMAIL TEMPLATE, EVERY SENDER ====================
//
// `shell(brand, {...})` renders any email in whichever identity it is handed.
// The venue's colours and logo arrive as data (see emailBrand.js), so a new
// venue is branded the moment it picks a colour — there is no per-venue
// template, no per-venue code, and no deploy involved.
//
// ── THE CONSTRAINTS ARE THE DESIGN ──────────────────────────────────────
// An inbox is not a browser. No <style> block survives Gmail's clipping
// reliably, no web font loads, no flexbox is safe in Outlook (which renders
// through Word). So: tables, inline styles only, system font stack, and a
// hidden preheader so the inbox preview says something useful instead of
// repeating the subject.
//
// ── THE HARD PROJECT RULES APPLY HERE TOO ───────────────────────────────
// scripts/guard.mjs only walks src/, so nothing mechanically enforces them in
// functions/ — that makes them easier to break here, not less binding. No
// emojis. Latin digits only (money() in messaging.js already does this).
//
// ── DIRECTION IS DATA, NOT A CONSTANT ───────────────────────────────────
// Every layout helper below takes the direction it should run in. See
// emailLang.js for why one declaration on <html> was not enough.
const { normLang, dirOf, startOf, endOf, L, pickName } = require('./emailLang.js')

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

const FONT = "'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif"
const INK = '#14151a'
const MUTED = '#5c6270'
const LINE = '#e7e9ef'
const PAGE = '#f2f3f5'

// The masthead. A logo when the venue uploaded one, otherwise its NAME set on
// the brand colour — never a blank band and never someone else's mark.
// THE MASTHEAD.
//
// Light plate, logo in a round white disc, and the brand colour as a rule
// underneath. The previous version put the logo straight onto a band of the
// venue's own colour, which is colour on colour: a red square mark on a maroon
// bar, its edge dissolving into the bar.
//
// The disc does the work. A transparent logo sits in it perfectly; an opaque
// square one gets CLIPPED to a circle, which is what a square logo needs. Since
// we cannot know from a URL whether a logo has transparency, the disc is the
// treatment that is right either way.
//
// HONEST LIMIT: border-radius does not render in desktop Outlook (Word engine),
// where the disc shows as a light square. The logo stays perfectly legible
// there because the plate behind it is light — which was the real problem.
function header(brand) {
  const b = brand || {}
  // OUR OWN MAIL KEEPS THE SOLID BAND.
  //
  // The light-plate treatment exists to solve a problem venues have and we do
  // not: an arbitrary uploaded logo, often a coloured square, landing on a
  // coloured band. Our wordmark is a known asset designed for exactly this
  // band. Applying the venue fix to the platform header changed something that
  // was not broken.
  if (b.kind === 'platform') {
    const mark = b.logoUrl
      ? `<img src="${esc(b.logoUrl)}" alt="${esc(b.name)}" width="132" style="display:block;max-width:132px;height:auto;border:0;margin:0 auto 10px;">`
      : ''
    return `
  <tr><td style="background:${esc(b.color || '#1F2A37')};padding:22px 28px;text-align:center;">
    ${mark}
    <div style="font-family:${FONT};font-size:17px;font-weight:700;color:${esc(b.ink || '#ffffff')};line-height:1.5;">${esc(b.name)}</div>
  </td></tr>`
  }

  const plate = b.plate || '#ffffff'
  const ink = b.plateInk || INK
  const rule = b.color || '#1F2A37'
  // ASPECT RATIO IS NEVER FORCED.
  //
  // A venue logo can be a square badge or a wide wordmark, and we cannot know
  // which. An earlier version pinned the image to 76x76 with object-fit:cover —
  // which crops a wide wordmark down to its middle slice. (That is exactly what
  // made our own wide wordmark render as a fragment when it briefly went
  // through this path.) object-fit is also ignored by most email clients, so
  // the fallback there was a stretched, distorted logo.
  //
  // Bounding with max-width/max-height and letting width/height stay auto keeps
  // the proportions in EVERY client, with no object-fit involved: a square logo
  // fills the disc, a wide one letterboxes inside it. The disc itself is the
  // fixed-size, white, round cell.
  //
  // AND THE SIZE IS ARITHMETIC, NOT TASTE.
  //
  // At 60px a SQUARE logo put its corners at sqrt(30^2+30^2) = 42.4 from the
  // centre while the disc's inner radius is only 38 — so all four corners stuck
  // out by ~3.4px. `border-radius` on a <td> does not clip its children in any
  // engine, so nothing caught them, and with a white-background logo the four
  // spurs fused into a white square bulging out of a white circle. That is the
  // "square in a frame" a venue sees in its inbox while the admin UI shows a
  // clean circle (it re-rounds the same file in CSS, which email cannot do).
  //
  // 52 puts the corners at 36.8, inside 38 with room for the 1px border and
  // client rounding. It needs no clipping, so it is right even in Outlook's
  // Word engine, which ignores border-radius entirely.
  //
  // A logo that has ALREADY been masked round (logoRoundUrl — transparent
  // corners, see functions/logoMask.js) has nothing that can protrude, so it is
  // allowed to fill the disc properly at 64.
  const cap = b.logoRound ? 64 : 52
  const logo = b.logoUrl
    ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 12px;">
      <tr><td width="78" height="78" align="center" valign="middle"
              style="width:78px;height:78px;background:#ffffff;border-radius:50%;border:1px solid rgba(0,0,0,.07);text-align:center;line-height:78px;font-size:0;">
        <img src="${esc(b.logoUrl)}" alt="${esc(b.name)}"
             style="display:inline-block;max-width:${cap}px;max-height:${cap}px;width:auto;height:auto;border:0;vertical-align:middle;">
      </td></tr>
    </table>`
    : ''
  return `
  <tr><td style="background:${esc(plate)};padding:26px 28px 20px;text-align:center;">
    ${logo}
    <div style="font-family:${FONT};font-size:17px;font-weight:700;color:${esc(ink)};line-height:1.5;">${esc(b.name)}</div>
  </td></tr>
  <tr><td style="background:${esc(rule)};height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>`
}

// A real button, built the only way that works everywhere: a padded anchor in
// its own table cell. Never rendered when there is no destination.
// The button is a TABLE, i.e. a block box: `text-align` on the parent cell does
// not move it, only `direction` does. That is why the body cell in shell() sets
// both. Do not "fix" a mis-placed button with align= here — HTML align on a
// table floats it and re-flows everything after it.
function button(brand, label, href) {
  if (!href || !label) return ''
  const b = brand || {}
  const dir = b.dir || dirOf(b.lang)
  return `
  <table role="presentation" dir="${dir}" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px;direction:${dir};">
    <tr><td style="background:${esc(b.color || '#1F2A37')};border-radius:8px;">
      <a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:14.5px;font-weight:700;color:${esc(b.ink || '#ffffff')};text-decoration:none;">${esc(label)}</a>
    </td></tr>
  </table>`
}

// MONEY, WITH THE REAL RIYAL MARK.
//
// The app draws the mark as inline SVG and that is correct for a browser. An
// inbox is not a browser: Gmail strips <svg> outright and blocks data: URIs in
// img src, so neither of the app's approaches survives. A hosted PNG does —
// see scripts/make-riyal-png.mjs, which rasterises the same path data so the
// two can never drift.
//
// Arabic order puts the mark BEFORE the number, matching <Price> in the app.
// Non-SAR currencies keep their code: there is no mark to draw.
const RIYAL = (light, lang) => {
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  // No absolute origin to serve the mark from. The word still reads — in the
  // reader's own language, so an English mail never degrades into Arabic.
  if (!base) return L(lang)('ريال ', 'SAR ')
  // margin-RIGHT, not margin-inline-end: Outlook renders through Word, which
  // does not implement logical properties. The span around this is always
  // dir="ltr", so the logical value could never have differed anyway.
  return `<img src="${base}/brand/riyal${light ? '-light' : ''}.png" alt="ريال" width="13" height="13" style="display:inline-block;width:13px;height:13px;vertical-align:-1px;border:0;margin-right:3px;">`
}
// Latin digits always — an Arabic-Indic numeral is a hard project rule against.
const digits = (v) => (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
function money(value, currency = 'SAR', { light = false, lang } = {}) {
  const cur = String(currency || 'SAR').toUpperCase()
  if (cur !== 'SAR') return { html: `<span dir="ltr">${digits(value)} ${esc(cur)}</span>` }
  return { html: `<span dir="ltr">${RIYAL(light, lang)}${digits(value)}</span>` }
}

// A value may be a plain string (escaped, the safe default) or {html} — an
// explicit opt-in used only by money() above. Making raw HTML opt-in by shape
// means a venue name can never become markup by accident.
const cell = (v) => (v && typeof v === 'object' && typeof v.html === 'string' ? v.html : esc(v))
const isBlank = (v) => v === '' || v == null || (typeof v === 'object' && !v.html)

// Label/value rows — order number, table, amount, period. Latin digits, and the
// value side forced LTR so a number never reorders inside an Arabic line.
//
// The `{ dir }` options argument is TRAILING and defaults to RTL on purpose: a
// leading brand parameter would let `facts(rows)` at a call site I missed be
// silently read as `facts(brand)`. Additive and optional cannot do that.
function facts(rows, { dir = 'rtl' } = {}) {
  const start = startOf(dir)
  const end = endOf(dir)
  const body = (rows || []).filter((r) => r && !isBlank(r[1])).map(([k, v]) => `
    <tr>
      <td style="padding:7px 0;font-family:${FONT};font-size:13px;color:${MUTED};white-space:nowrap;direction:${dir};text-align:${start};" align="${start}">${esc(k)}</td>
      <td style="padding:7px 0;font-family:${FONT};font-size:14px;color:${INK};font-weight:700;text-align:${end};" align="${end}" dir="ltr">${cell(v)}</td>
    </tr>`).join('')
  return body ? `<table role="presentation" dir="${dir}" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:14px 0;direction:${dir};">${body}</table>` : ''
}

// An itemised table (order lines, invoice lines).
function lineTable(lines, totalLabel, totalValue, { dir = 'rtl' } = {}) {
  const start = startOf(dir)
  const end = endOf(dir)
  const rows = (lines || []).map((l) => `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:14px;color:${INK};direction:${dir};text-align:${start};" align="${start}">${esc(l.name)}${Number(l.qty) > 1 ? ` <span style="color:${MUTED};">&times;${esc(l.qty)}</span>` : ''}</td>
      <td style="padding:9px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:14px;color:${INK};white-space:nowrap;text-align:${end};" align="${end}" dir="ltr">${cell(l.total)}</td>
    </tr>`).join('')
  if (!rows) return ''
  const total = totalValue == null ? '' : `
    <tr>
      <td style="padding:12px 0 0;font-family:${FONT};font-size:15px;font-weight:700;color:${INK};direction:${dir};text-align:${start};" align="${start}">${esc(totalLabel || '')}</td>
      <td style="padding:12px 0 0;font-family:${FONT};font-size:15px;font-weight:700;color:${INK};white-space:nowrap;text-align:${end};" align="${end}" dir="ltr">${cell(totalValue)}</td>
    </tr>`
  return `<table role="presentation" dir="${dir}" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;direction:${dir};">${rows}${total}</table>`
}

// A REPORT SECTION: a titled bar over label/value rows.
//
// This is the shape a financial summary has to have to be read rather than
// skimmed — the reader is checking figures against their own expectation, one
// group at a time, so the groups must be visually separable and the subtotal of
// each must be findable without counting rows.
//
// rows: [label, value, kind?]  where kind is
//   undefined  ordinary line
//   'strong'   a subtotal — tinted band, heavier ink
//   'muted'    an aside that is not part of the arithmetic
function section(brand, title, rows) {
  const b = brand || {}
  // This one already carries the brand, so it reads the direction from there.
  const dir = b.dir || dirOf(b.lang)
  const start = startOf(dir)
  const end = endOf(dir)
  const body = (rows || []).filter(Boolean).map(([label, value, kind]) => {
    const strong = kind === 'strong'
    const bg = strong ? 'background:#F4F5FA;' : ''
    const weight = strong ? '700' : '400'
    const color = kind === 'muted' ? MUTED : INK
    return `
    <tr>
      <td style="${bg}padding:9px 12px;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:13px;font-weight:${weight};color:${color};direction:${dir};text-align:${start};" align="${start}">${esc(label)}</td>
      <td style="${bg}padding:9px 12px;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:13px;font-weight:${strong ? '700' : '600'};color:${color};white-space:nowrap;text-align:${end};" align="${end}" dir="ltr">${cell(value)}</td>
    </tr>`
  }).join('')
  if (!body) return ''
  return `
  <table role="presentation" dir="${dir}" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;border:1px solid ${LINE};border-radius:6px;border-collapse:separate;border-spacing:0;overflow:hidden;direction:${dir};">
    <tr><td colspan="2" style="background:${esc(b.color || '#1F2A37')};padding:9px 12px;font-family:${FONT};font-size:12.5px;font-weight:700;color:${esc(b.ink || '#ffffff')};direction:${dir};text-align:${start};" align="${start}">${esc(title)}</td></tr>
    ${body}
  </table>`
}

// The footer carries WHO SENT THIS. For a venue that is its own contact block;
// for us it is the legal identity that appears on our invoices. A venue footer
// also carries a quiet «by RBT360» — the guest is the venue's customer, not
// ours, so it stays small and last.
function footer(brand) {
  const b = brand || {}
  const dir = b.dir || dirOf(b.lang)
  const p = L(b.lang)
  // The VAT number was printed as bare text inside an Arabic run, so its 15
  // digits bidi-reordered. The CR number one line below already did it right
  // with <span dir="ltr">; both do now.
  const bits = [b.address, b.phone]
    .filter(Boolean).map((x) => `<div style="margin:2px 0;">${esc(x)}</div>`).join('')
    + (b.vatNumber ? `<div style="margin:2px 0;">${p('الرقم الضريبي', 'VAT number')} <span dir="ltr">${esc(b.vatNumber)}</span></div>` : '')
  const site = b.website
    ? `<div style="margin:6px 0 0;"><a href="${esc(b.website)}" style="color:${esc(b.color || MUTED)};text-decoration:none;font-weight:700;">${esc(String(b.website).replace(/^https?:\/\//, ''))}</a></div>`
    : ''
  const legal = b.kind === 'platform' && b.legalName
    ? `<div style="margin:6px 0 0;">${esc(b.legalName)}${b.crNumber ? ` · ${p('س.ت', 'CR')} <span dir="ltr">${esc(b.crNumber)}</span>` : ''}</div>`
    : ''
  const note = b.footerNote ? `<div style="margin:6px 0 0;">${esc(b.footerNote)}</div>` : ''
  const powered = b.poweredBy
    ? `<div style="margin:12px 0 0;padding-top:10px;border-top:1px solid ${LINE};font-size:11px;color:#9aa0ad;">${p('مُشغَّل بواسطة RBT 360', 'Powered by RBT 360')}</div>`
    : ''
  return `
  <tr><td style="padding:18px 28px 22px;border-top:1px solid ${LINE};background:#fafbfc;direction:${dir};" align="center">
    <div style="font-family:${FONT};font-size:13px;font-weight:700;color:${INK};">${esc(b.name)}</div>
    <div style="font-family:${FONT};font-size:12px;color:${MUTED};line-height:1.8;margin-top:4px;">${bits}${site}${legal}${note}</div>
    ${powered}
  </td></tr>`
}

/**
 * Render a complete email.
 * @param {object} brand  from venueBrand() or platformBrand()
 * @param {object} opts   { title, preheader, body, cta:{label,href}, secondaryCta }
 */
function shell(brand, { title, preheader, body, cta, secondaryCta, lang } = {}) {
  const b = brand || {}
  const lg = normLang(b.lang || lang)
  const dir = dirOf(lg)
  const start = startOf(dir)
  const pre = String(preheader || '').replace(/[<>]/g, '')
  return `<!doctype html>
<html dir="${dir}" lang="${lg}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(title || b.name || '')}</title>
</head>
<body dir="${dir}" style="margin:0;padding:0;background:${PAGE};direction:${dir};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(pre)}</div>
<table role="presentation" dir="${dir}" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};padding:24px 12px;direction:${dir};">
  <tr><td align="center">
    <table role="presentation" dir="${dir}" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;direction:${dir};">
      ${header(b)}
      <tr><td style="padding:26px 28px 8px;direction:${dir};text-align:${start};" align="${start}">
        <h1 style="margin:0;font-family:${FONT};font-size:19px;line-height:1.5;font-weight:700;color:${INK};">${esc(title || '')}</h1>
      </td></tr>
      <tr><td style="padding:2px 28px 24px;font-family:${FONT};color:#3f434d;font-size:14.5px;line-height:1.85;direction:${dir};text-align:${start};" align="${start}">
        ${body || ''}
        ${cta ? button(b, cta.label, cta.href) : ''}
        ${secondaryCta && secondaryCta.href ? `<div style="margin:12px 0 0;"><a href="${esc(secondaryCta.href)}" style="font-family:${FONT};font-size:13.5px;color:${esc(b.color || MUTED)};font-weight:700;text-decoration:none;">${esc(secondaryCta.label)}</a></div>` : ''}
      </td></tr>
      ${footer(b)}
    </table>
  </td></tr>
</table>
</body></html>`
}

module.exports = { shell, header, footer, button, facts, lineTable, section, money, esc }
