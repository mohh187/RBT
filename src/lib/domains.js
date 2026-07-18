// Per-venue custom domains / subdomains. A venue on an advanced plan can serve
// its menu from its own hostname (venue.com) or a platform subdomain
// (venue.ourplatform.com); the free plan stays on the shared path-based domain
// (ourplatform.com/m/slug). Resolution: hostname → domains/{host} → tenant slug.
//
// The `domains` collection is publicly readable (like tenantSlugs) so the menu
// can resolve at load with no auth. Activation is controlled (platform / DNS +
// Cloudflare-for-SaaS), never self-served, so a venue can't hijack a hostname.
import { db } from './firebase.js'
import { doc, getDoc } from 'firebase/firestore'

// The platform's own apex domain (used to suggest subdomains: slug.APEX) and the
// CNAME target a venue points its custom host at (Cloudflare-for-SaaS / Firebase
// ingress). Both env-driven so a rebrand / real domain is a one-line change.
export const PLATFORM_APEX = (import.meta.env.VITE_PLATFORM_APEX || 'rbt360sa.com').trim().toLowerCase()
export const DOMAIN_CNAME_TARGET = (import.meta.env.VITE_DOMAIN_CNAME_TARGET || `connect.${PLATFORM_APEX}`).trim().toLowerCase()

// Normalize a hostname: strip scheme/path, lowercase, trim.
export const normHost = (host) => String(host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '')

// Hosts that are the PLATFORM itself (never a venue custom domain).
// Extend via VITE_PLATFORM_HOSTS ("app.rbt360.sa,rbt360.sa").
const EXTRA = (import.meta.env.VITE_PLATFORM_HOSTS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const PLATFORM_HOSTS = new Set([
  'localhost', '127.0.0.1',
  'menu-88996.web.app', 'menu-88996.firebaseapp.com',
  PLATFORM_APEX, `www.${PLATFORM_APEX}`, `app.${PLATFORM_APEX}`,
  ...EXTRA,
])

export function isPlatformHost(host) {
  const h = (host || (typeof location !== 'undefined' ? location.hostname : '')).toLowerCase()
  if (!h) return true
  if (PLATFORM_HOSTS.has(h)) return true
  if (h.endsWith('.web.app') || h.endsWith('.firebaseapp.com')) return true
  return false
}

// Reserved first labels on the platform apex that are NEVER venue subdomains.
const RESERVED_SUBS = new Set(['www', 'app', 'api', 'connect', 'mail', 'admin', 'platform', 'status', 'cdn'])

// slug.rbt360sa.com → 'slug' (automatic venue subdomain), else null.
export function subdomainSlug(host) {
  const h = normHost(host)
  if (!h.endsWith('.' + PLATFORM_APEX)) return null
  const label = h.slice(0, -(PLATFORM_APEX.length + 1))
  if (!label || label.includes('.') || RESERVED_SUBS.has(label)) return null
  return label
}

// Returns { tenantId, slug } for an ACTIVE venue domain, else null.
// Resolution order: (1) automatic platform subdomain slug.APEX via tenantSlugs —
// zero setup, every venue gets one; (2) custom domain via domains/{host} (platform-
// activated after DNS). Both collections are public-read so the menu resolves unauthenticated.
export async function resolveHostVenue(host) {
  const h = (host || (typeof location !== 'undefined' ? location.hostname : '')).toLowerCase()
  if (!h || isPlatformHost(h)) return null
  const sub = subdomainSlug(h)
  if (sub) {
    try {
      const snap = await getDoc(doc(db, 'tenantSlugs', sub))
      if (snap.exists()) return { id: h, tenantId: snap.data().tenantId, slug: sub, kind: 'subdomain' }
    } catch { /* fall through */ }
    return null
  }
  try {
    const snap = await getDoc(doc(db, 'domains', h))
    if (snap.exists() && snap.data().status === 'active') return { id: h, ...snap.data(), kind: 'custom' }
  } catch {
    /* ignore — falls through to platform behaviour */
  }
  return null
}
