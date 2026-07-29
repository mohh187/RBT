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
  const logo = b.logoUrl
    ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 12px;">
      <tr><td width="76" height="76" align="center" valign="middle"
              style="width:76px;height:76px;background:#ffffff;border-radius:50%;overflow:hidden;border:1px solid rgba(0,0,0,.06);">
        <img src="${esc(b.logoUrl)}" alt="${esc(b.name)}" width="76" height="76"
             style="display:block;width:76px;height:76px;border:0;border-radius:50%;object-fit:cover;">
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
function button(brand, label, href) {
  if (!href || !label) return ''
  const b = brand || {}
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px;">
    <tr><td style="background:${esc(b.color || '#1F2A37')};border-radius:8px;">
      <a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:14.5px;font-weight:700;color:${esc(b.ink || '#ffffff')};text-decoration:none;">${esc(label)}</a>
    </td></tr>
  </table>`
}

// Label/value rows — order number, table, amount, period. Latin digits, and the
// value side forced LTR so a number never reorders inside an Arabic line.
function facts(rows) {
  const body = (rows || []).filter((r) => r && r[1] !== '' && r[1] != null).map(([k, v]) => `
    <tr>
      <td style="padding:7px 0;font-family:${FONT};font-size:13px;color:${MUTED};white-space:nowrap;">${esc(k)}</td>
      <td style="padding:7px 0;font-family:${FONT};font-size:14px;color:${INK};font-weight:700;" align="left" dir="ltr">${esc(v)}</td>
    </tr>`).join('')
  return body ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:14px 0;">${body}</table>` : ''
}

// An itemised table (order lines, invoice lines).
function lineTable(lines, totalLabel, totalValue) {
  const rows = (lines || []).map((l) => `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:14px;color:${INK};">${esc(l.name)}${Number(l.qty) > 1 ? ` <span style="color:${MUTED};">&times;${esc(l.qty)}</span>` : ''}</td>
      <td style="padding:9px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:14px;color:${INK};white-space:nowrap;" align="left" dir="ltr">${esc(l.total)}</td>
    </tr>`).join('')
  if (!rows) return ''
  const total = totalValue == null ? '' : `
    <tr>
      <td style="padding:12px 0 0;font-family:${FONT};font-size:15px;font-weight:700;color:${INK};">${esc(totalLabel || '')}</td>
      <td style="padding:12px 0 0;font-family:${FONT};font-size:15px;font-weight:700;color:${INK};white-space:nowrap;" align="left" dir="ltr">${esc(totalValue)}</td>
    </tr>`
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">${rows}${total}</table>`
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
  const body = (rows || []).filter(Boolean).map(([label, value, kind]) => {
    const strong = kind === 'strong'
    const bg = strong ? 'background:#F4F5FA;' : ''
    const weight = strong ? '700' : '400'
    const color = kind === 'muted' ? MUTED : INK
    return `
    <tr>
      <td style="${bg}padding:9px 12px;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:13px;font-weight:${weight};color:${color};">${esc(label)}</td>
      <td style="${bg}padding:9px 12px;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:13px;font-weight:${strong ? '700' : '600'};color:${color};white-space:nowrap;" align="left" dir="ltr">${esc(value)}</td>
    </tr>`
  }).join('')
  if (!body) return ''
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;border:1px solid ${LINE};border-radius:6px;border-collapse:separate;border-spacing:0;overflow:hidden;">
    <tr><td colspan="2" style="background:${esc(b.color || '#1F2A37')};padding:9px 12px;font-family:${FONT};font-size:12.5px;font-weight:700;color:${esc(b.ink || '#ffffff')};">${esc(title)}</td></tr>
    ${body}
  </table>`
}

// The footer carries WHO SENT THIS. For a venue that is its own contact block;
// for us it is the legal identity that appears on our invoices. A venue footer
// also carries a quiet «by RBT360» — the guest is the venue's customer, not
// ours, so it stays small and last.
function footer(brand) {
  const b = brand || {}
  const bits = [b.address, b.phone, b.vatNumber ? `الرقم الضريبي ${b.vatNumber}` : '']
    .filter(Boolean).map((x) => `<div style="margin:2px 0;">${esc(x)}</div>`).join('')
  const site = b.website
    ? `<div style="margin:6px 0 0;"><a href="${esc(b.website)}" style="color:${esc(b.color || MUTED)};text-decoration:none;font-weight:700;">${esc(String(b.website).replace(/^https?:\/\//, ''))}</a></div>`
    : ''
  const legal = b.kind === 'platform' && b.legalName
    ? `<div style="margin:6px 0 0;">${esc(b.legalName)}${b.crNumber ? ` · س.ت <span dir="ltr">${esc(b.crNumber)}</span>` : ''}</div>`
    : ''
  const note = b.footerNote ? `<div style="margin:6px 0 0;">${esc(b.footerNote)}</div>` : ''
  const powered = b.poweredBy
    ? `<div style="margin:12px 0 0;padding-top:10px;border-top:1px solid ${LINE};font-size:11px;color:#9aa0ad;">مُشغَّل بواسطة RBT 360</div>`
    : ''
  return `
  <tr><td style="padding:18px 28px 22px;border-top:1px solid ${LINE};background:#fafbfc;" align="center">
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
function shell(brand, { title, preheader, body, cta, secondaryCta } = {}) {
  const b = brand || {}
  const pre = String(preheader || '').replace(/[<>]/g, '')
  return `<!doctype html>
<html dir="rtl" lang="ar" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(title || b.name || '')}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;">
      ${header(b)}
      <tr><td style="padding:26px 28px 8px;" align="right">
        <h1 style="margin:0;font-family:${FONT};font-size:19px;line-height:1.5;font-weight:700;color:${INK};">${esc(title || '')}</h1>
      </td></tr>
      <tr><td style="padding:2px 28px 24px;font-family:${FONT};color:#3f434d;font-size:14.5px;line-height:1.85;" align="right">
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

module.exports = { shell, header, footer, button, facts, lineTable, section, esc }
