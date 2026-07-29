// ==================== WHO AN EMAIL IS FROM, VISUALLY ====================
//
// Two identities, resolved from data, never hand-written per venue:
//
//   venueBrand(tenant)  — mail a VENUE sends to ITS OWN guests. Carries the
//                         venue's menu colours, its logo and its name. A guest
//                         who scanned a QR at «مزاج فال» should get mail that
//                         looks like «مزاج فال», not like us.
//   platformBrand()     — mail WE send to a venue owner: invoices, reports,
//                         alerts. Carries RBT360.
//
// Every venue is themed automatically the moment it picks a colour in Setup.
// Nothing here needs a per-venue template, and nothing needs a deploy.
//
// ── WHY onColor IS NOT OPTIONAL ─────────────────────────────────────────
// A venue may pick sand, cream or gold as its brand. A header band with
// hardcoded white text on a light brand is an unreadable header — and it is
// unreadable in an INBOX, where nobody can report it and we never see it. So
// the ink is measured against the actual colour, exactly as the app does it in
// src/lib/themes.js.
const { PLATFORM_SELLER, sellerBlock } = require('./platformSeller.js')
const { normLang, dirOf } = require('./emailLang.js')

// --- contrast, ported from src/lib/contrast.js -------------------------------
function srgb(c) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
function luminance(hex) {
  const h = String(hex || '').replace('#', '')
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16)
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b)
  if (la == null || lb == null) return null
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
// Mirror of onColor() in src/lib/themes.js — same two candidates, same rule.
const INK_DARK = '#101114'
const INK_LIGHT = '#ffffff'
function onColor(bg) {
  const cl = contrast(INK_LIGHT, bg)
  const cd = contrast(INK_DARK, bg)
  if (cl == null || cd == null) return INK_LIGHT
  return cd > cl ? INK_DARK : INK_LIGHT
}

// Mix a colour toward white. Email CSS has no color-mix() — every value has to
// resolve to a literal hex before it is written into the markup.
function tint(hex, ratio) {
  const h = String(hex || '').replace('#', '')
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return '#ffffff'
  const to = (i) => {
    const c = parseInt(full.slice(i, i + 2), 16)
    return Math.round(c + (255 - c) * (1 - ratio)).toString(16).padStart(2, '0')
  }
  return `#${to(0)}${to(2)}${to(4)}`
}

// Mirror of DEFAULT_THEME in src/lib/themes.js.
const DEFAULT_BRAND = '#1F2A37'
const DEFAULT_ACCENT = '#8A6A3F'
const RBT_BRAND = '#6429DE'   // the platform violet the console and landing use

const isHex = (v) => /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(v || ''))

// An email cannot resolve a relative path. Every asset URL has to be absolute,
// against the deployed origin — a logo referenced as /brand/x.png simply does
// not render in a mailbox.
function absolute(url) {
  const u = String(url || '')
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  const base = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').replace(/\/+$/, '')
  return base ? `${base}/${u.replace(/^\/+/, '')}` : ''
}

// The venue's own identity, derived entirely from its tenant document.
//
// `lang` is the READER's language, not the venue's — for guest mail it comes off
// the order (order.lang, recorded when the guest placed it), for venue-facing
// mail off tenant.lang. It rides on the brand object because "who is this from"
// and "which way does it read" are the same kind of fact, and carrying it here
// means the shell() call shape at every builder stays unchanged.
function venueBrand(tenant, lang) {
  const t = tenant || {}
  const color = isHex(t.themeColor) ? t.themeColor : DEFAULT_BRAND
  const accent = isHex(t.themeAccent) ? t.themeAccent : DEFAULT_ACCENT
  const slug = String(t.slug || '')
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  const lg = normLang(lang)
  return {
    kind: 'venue',
    lang: lg,
    dir: dirOf(lg),
    name: t.name || '',
    color,
    ink: onColor(color),      // readable ON the brand colour, whatever it is
    accent,
    accentInk: onColor(accent),
    // THE MASTHEAD IS LIGHT, NOT THE BRAND COLOUR.
    //
    // A venue logo is usually a coloured square with its own background. Put
    // that on a band of the venue's own brand colour and you get colour on
    // colour — a red mark on a maroon bar, with its edge dissolving into the
    // bar. Every venue with a warm brand loses its logo exactly that way.
    //
    // So the masthead is a 14% tint of the brand mixed into white: a warm beige
    // under a maroon, a cool grey under a blue. Derived, so it is right for
    // every venue without anyone configuring anything — and the brand itself
    // signs the header with a rule underneath instead of swallowing the logo.
    plate: tint(color, 0.14),
    plateInk: onColor(tint(color, 0.14)),
    // PREFER THE MASKED COPY. logoMask.js writes logoRoundUrl: the same mark as
    // a PNG with its corners cut to a circle and made transparent. It solves two
    // things at once — a round logo cannot poke out of the round plate, and PNG
    // renders in Outlook's Word engine where the uploaded .webp does not. When
    // it is absent (not yet processed) we fall back to the original and the
    // template caps the size so the corners still cannot protrude.
    logoUrl: absolute(t.logoRoundUrl || t.logoUrl),
    logoRound: !!t.logoRoundUrl,
    // Contact block for the footer — only what the venue actually filled in.
    phone: t.phone || '',
    address: t.address || '',
    website: slug && base ? `${base}/m/${slug}` : '',
    vatNumber: t.vatNumber || '',
    // The rate-us destination. Empty means the CTA is simply not rendered —
    // never a dead button.
    mapsUrl: t.googleMapsUrl || '',
    footerNote: '',
    poweredBy: true,   // a discreet «by RBT360» line under a venue footer
  }
}

// Ours.
function platformBrand(financeCfg, lang) {
  const s = sellerBlock(financeCfg || {})
  const lg = normLang(lang)
  return {
    kind: 'platform',
    lang: lg,
    dir: dirOf(lg),
    name: PLATFORM_SELLER.brand,
    legalName: PLATFORM_SELLER.legalNameAr,
    color: RBT_BRAND,
    ink: onColor(RBT_BRAND),
    accent: '#E0219E',
    accentInk: onColor('#E0219E'),
    plate: tint(RBT_BRAND, 0.1),
    plateInk: onColor(tint(RBT_BRAND, 0.1)),
    logoUrl: absolute(s.logoUrl),
    phone: s.contactPhone || '',
    address: s.addressAr || '',
    website: s.website ? `https://${String(s.website).replace(/^https?:\/\//, '')}` : '',
    email: s.contactEmail || '',
    crNumber: PLATFORM_SELLER.crNumber,
    vatNumber: PLATFORM_SELLER.vatNumber,
    mapsUrl: '',
    footerNote: s.footerNoteAr || '',
    poweredBy: false,
  }
}

// The guest's live order page — /order/:slug/:orderId (src/App.jsx).
//
// This is the single most useful link an order email can carry: it answers
// «where is my order» without the guest replying to anything or phoning the
// counter. Empty when the venue has no slug or the id is missing, so the caller
// renders no button at all rather than a link to a 404.
function orderTrackUrl(tenant, orderId) {
  const slug = String((tenant && tenant.slug) || '')
  const id = String(orderId || '')
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  if (!slug || !id || !base) return ''
  return `${base}/order/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`
}

module.exports = { venueBrand, platformBrand, orderTrackUrl, onColor, contrast, absolute, DEFAULT_BRAND, DEFAULT_ACCENT, RBT_BRAND }
