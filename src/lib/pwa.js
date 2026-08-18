// Per-venue PWA branding. The platform ships ONE static manifest (RBT360); on a
// venue menu we build a manifest from the tenant (name / logo / theme / start_url)
// and inject it, so "Add to Home Screen" installs THE VENUE's app, not ours.
// Client-side injection works on Android/Chrome; iOS reads the apple-* meta which
// we also set. (A server manifest endpoint is the fully-robust upgrade.)
import { isPlatformHost } from './domains.js'

let originalManifestHref = null // captured once, to restore on leaving a venue
let originalIconHref = null     // platform favicon, restored on leaving a venue
let currentBlobUrl = null

// Browser-tab identity: the venue's own logo as favicon (letter-icon endpoint
// as the no-logo fallback in production). Used by menu surfaces AND the venue
// admin dashboard, so every venue tab wears the venue's logo.
// The logo is drawn through a circular canvas mask so the TAB icon has no
// square background plate (tab only — the logo renders untouched elsewhere).
let faviconJob = 0
function setCircularFavicon(url) {
  const job = ++faviconJob
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    if (job !== faviconJob) return
    try {
      const S = 64
      const c = document.createElement('canvas')
      c.width = S; c.height = S
      const g = c.getContext('2d')
      g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.clip()
      const r = Math.max(S / img.naturalWidth, S / img.naturalHeight) // cover fit
      const w = img.naturalWidth * r, h = img.naturalHeight * r
      g.drawImage(img, (S - w) / 2, (S - h) / 2, w, h)
      setLink('icon', c.toDataURL('image/png'))
    } catch (_) { setLink('icon', url) } // tainted canvas (no CORS) → raw logo
  }
  img.onerror = () => { if (job === faviconJob) setLink('icon', url) }
  img.src = url
}
export function applyVenueFavicon(tenant, slug) {
  if (typeof document === 'undefined' || !tenant) return
  try {
    const icon = document.querySelector('link[rel="icon"]')
    if (originalIconHref === null && icon) originalIconHref = icon.getAttribute('href')
    if (tenant.logoUrl) setCircularFavicon(tenant.logoUrl)
    else if (import.meta.env.PROD && slug) setLink('icon', `/m/${encodeURIComponent(slug)}/icon.svg`)
  } catch (_) { /* keep the platform favicon on any failure */ }
}
export function restorePlatformFavicon() {
  try {
    const icon = document.querySelector('link[rel="icon"]')
    if (icon && originalIconHref !== null) icon.setAttribute('href', originalIconHref)
  } catch (_) { /* ignore */ }
}

function readVar(name) {
  try { return (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim() } catch (_) { return '' }
}
// Only a real hex/rgb is a valid manifest color — a dark-skin `--brand` computes
// to a `color-mix(...)` string that would be silently rejected.
function safeColor(v, fallback) {
  const s = (v || '').trim()
  return (/^#([0-9a-fA-F]{3,8})$/.test(s) || /^rgb/i.test(s)) ? s : fallback
}
function setMeta(name, content) {
  let m = document.querySelector(`meta[name="${name}"]`)
  if (!m) { m = document.createElement('meta'); m.setAttribute('name', name); document.head.appendChild(m) }
  m.setAttribute('content', content)
}
function setLink(rel, href) {
  let l = document.querySelector(`link[rel="${rel}"]`)
  if (!l) { l = document.createElement('link'); l.setAttribute('rel', rel); document.head.appendChild(l) }
  l.setAttribute('href', href)
}

// MUST be called from an effect, never during render (it mutates the document).
export function applyVenueManifest(tenant, slug) {
  if (typeof document === 'undefined' || !tenant || !slug) return
  try {
    let link = document.querySelector('link[rel="manifest"]')
    if (originalManifestHref === null && link) originalManifestHref = link.getAttribute('href')

    // Production: the server endpoint (functions/venueMeta.js, rewritten at
    // /m/:slug/manifest.webmanifest) is the robust install identity — a real
    // URL survives page reloads and is what crawlers/installers see in the
    // server-rendered shell too. The blob below stays as the dev fallback
    // (vite serves no functions rewrite).
    if (import.meta.env.PROD) {
      if (!link) { link = document.createElement('link'); link.setAttribute('rel', 'manifest'); document.head.appendChild(link) }
      link.setAttribute('href', `/m/${encodeURIComponent(slug)}/manifest.webmanifest`)
      setMeta('apple-mobile-web-app-title', tenant.name || 'Menu')
      setLink('apple-touch-icon', tenant.logoUrl || '/brand/favicon.png')
      applyVenueFavicon(tenant, slug)
      return
    }

    const onPlatform = isPlatformHost()
    // Custom domain serves the menu at root; shared host at /m/slug.
    // ABSOLUTE on purpose: this manifest is served from a blob: URL, and a
    // relative start_url/scope would be resolved against that blob — which the
    // browser rejects ("property 'start_url' ignored, URL is invalid"), losing
    // the venue's install target. Anchoring to the real origin fixes both.
    const origin = window.location.origin
    const startUrl = new URL(onPlatform ? `/m/${slug}` : '/', origin).href
    const name = tenant.name || 'Menu'
    const brand = safeColor(tenant.themeColor, safeColor(readVar('--brand'), '#8B5E3C'))
    const bg = safeColor(readVar('--bg'), '#ffffff')
    const icon = tenant.logoUrl || '/brand/favicon.png'
    const ar = (document.documentElement.getAttribute('dir') || 'rtl') === 'rtl'

    const manifest = {
      id: startUrl,
      name,
      short_name: name.slice(0, 24),
      start_url: startUrl,
      scope: startUrl,
      display: 'standalone',
      orientation: 'any',
      dir: ar ? 'rtl' : 'ltr',
      lang: ar ? 'ar' : 'en',
      background_color: bg,
      theme_color: brand,
      // Single non-maskable icon from the venue logo (don't tag an arbitrary logo
      // 'maskable' — Chrome would crop it). Declared 'any' size to avoid a
      // dimension-mismatch rejection on an extension-less remote URL.
      icons: [{ src: icon, sizes: 'any', purpose: 'any' }],
    }

    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' })
    if (currentBlobUrl) { try { URL.revokeObjectURL(currentBlobUrl) } catch (_) { /* ignore */ } }
    currentBlobUrl = URL.createObjectURL(blob)
    if (!link) { link = document.createElement('link'); link.setAttribute('rel', 'manifest'); document.head.appendChild(link) }
    link.setAttribute('href', currentBlobUrl)

    setMeta('apple-mobile-web-app-title', name)
    setLink('apple-touch-icon', tenant.logoUrl || '/brand/favicon.png')
    applyVenueFavicon(tenant, slug)
  } catch (_) { /* keep the static platform manifest on any failure */ }
}

// STAFF surfaces (/admin, /cashier, /kds, /portal): point the manifest at the
// server-rendered STAFF identity (/app/:slug/*) so "Install app" from the
// console produces the venue-logo tablet app that starts at /app/:slug —
// session → /admin behind the PIN lock; cold device → /lock. This was THE
// missing call: AdminLayout only ever swapped the favicon, so installing from
// /admin installed the PLATFORM manifest (generic icon, landing start_url).
export function applyStaffManifest(tenant, slug) {
  if (typeof document === 'undefined' || !tenant || !slug) return
  try {
    let link = document.querySelector('link[rel="manifest"]')
    if (originalManifestHref === null && link) originalManifestHref = link.getAttribute('href')
    if (import.meta.env.PROD) {
      if (!link) { link = document.createElement('link'); link.setAttribute('rel', 'manifest'); document.head.appendChild(link) }
      link.setAttribute('href', `/app/${encodeURIComponent(slug)}/manifest.webmanifest`)
      setMeta('apple-mobile-web-app-title', tenant.name || 'RBT360')
      // RASTER, not the /icon.svg route: Safari's apple-touch-icon has never
      // supported SVG — with it, the shop iPad's home-screen tile fell back to
      // a page screenshot, the exact thing this link exists to prevent.
      setLink('apple-touch-icon', tenant.logoUrl || '/brand/icon-512.png')
      applyVenueFavicon(tenant, slug)
      return
    }
    // dev fallback: vite serves no function rewrite — blob manifest
    const origin = window.location.origin
    const startUrl = new URL(`/app/${slug}`, origin).href
    const name = tenant.name || 'RBT360'
    const manifest = {
      id: startUrl,
      name,
      short_name: name.slice(0, 24),
      start_url: startUrl,
      scope: new URL('/', origin).href,
      display: 'standalone',
      orientation: 'any',
      dir: 'rtl',
      lang: 'ar',
      background_color: '#ffffff',
      theme_color: safeColor(tenant.themeColor, '#171717'),
      icons: [{ src: tenant.logoUrl || '/brand/favicon.png', sizes: 'any', purpose: 'any' }],
    }
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' })
    if (currentBlobUrl) { try { URL.revokeObjectURL(currentBlobUrl) } catch (_) { /* ignore */ } }
    currentBlobUrl = URL.createObjectURL(blob)
    if (!link) { link = document.createElement('link'); link.setAttribute('rel', 'manifest'); document.head.appendChild(link) }
    link.setAttribute('href', currentBlobUrl)
    setMeta('apple-mobile-web-app-title', name)
    applyVenueFavicon(tenant, slug)
  } catch (_) { /* keep whatever manifest was there */ }
}

// Restore the platform's static manifest when leaving a venue surface (SPA nav)
// so the platform's own "Add to Home Screen" identity isn't left as the last venue.
export function restorePlatformManifest() {
  try {
    if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null }
    const link = document.querySelector('link[rel="manifest"]')
    if (link && originalManifestHref !== null) link.setAttribute('href', originalManifestHref)
    restorePlatformFavicon()
  } catch (_) { /* ignore */ }
}
