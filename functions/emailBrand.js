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
function venueBrand(tenant) {
  const t = tenant || {}
  const color = isHex(t.themeColor) ? t.themeColor : DEFAULT_BRAND
  const accent = isHex(t.themeAccent) ? t.themeAccent : DEFAULT_ACCENT
  const slug = String(t.slug || '')
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  return {
    kind: 'venue',
    name: t.name || '',
    color,
    ink: onColor(color),      // readable ON the brand band, whatever it is
    accent,
    accentInk: onColor(accent),
    logoUrl: absolute(t.logoUrl),
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
function platformBrand(financeCfg) {
  const s = sellerBlock(financeCfg || {})
  return {
    kind: 'platform',
    name: PLATFORM_SELLER.brand,
    legalName: PLATFORM_SELLER.legalNameAr,
    color: RBT_BRAND,
    ink: onColor(RBT_BRAND),
    accent: '#E0219E',
    accentInk: onColor('#E0219E'),
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
