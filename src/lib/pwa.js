// Per-venue PWA branding. The platform ships ONE static manifest (RBT360); on a
// venue menu we build a manifest from the tenant (name / logo / theme / start_url)
// and inject it, so "Add to Home Screen" installs THE VENUE's app, not ours.
// Client-side injection works on Android/Chrome; iOS reads the apple-* meta which
// we also set. (A server manifest endpoint is the fully-robust upgrade.)
import { isPlatformHost } from './domains.js'

let originalManifestHref = null // captured once, to restore on leaving a venue
let currentBlobUrl = null

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
    const icon = tenant.logoUrl || '/favicon.svg'
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
    setLink('apple-touch-icon', tenant.logoUrl || '/favicon.svg')
  } catch (_) { /* keep the static platform manifest on any failure */ }
}

// Restore the platform's static manifest when leaving a venue surface (SPA nav)
// so the platform's own "Add to Home Screen" identity isn't left as the last venue.
export function restorePlatformManifest() {
  try {
    if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null }
    const link = document.querySelector('link[rel="manifest"]')
    if (link && originalManifestHref !== null) link.setAttribute('href', originalManifestHref)
  } catch (_) { /* ignore */ }
}
