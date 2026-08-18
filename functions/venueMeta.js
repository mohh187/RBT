// Per-venue SHARE + INSTALL identity, served before any JS runs.
//
// Social crawlers (WhatsApp/X/Facebook/Telegram) never execute the SPA, so a
// shared menu link used to preview as the PLATFORM (rbt360). This module makes
// every venue link present the VENUE:
//
//   /m/:slug                      -> the built index.html shell with the venue's
//                                    <title>/<meta description>/og:*/twitter:*/
//                                    theme-color/manifest/apple-touch-icon injected
//   /m/:slug/manifest.webmanifest -> a per-venue web-app manifest (install = THEIR app)
//   /m/:slug/icon.svg             -> generated letter icon (fallback when no logo)
//   /join/:tid/...                -> shell with the venue's og tags (game-room invites)
//
// Wired via firebase.json rewrites (/m/** and /join/** -> function venueShell).
// FAIL-SAFE BY DESIGN: any error falls back to serving the plain shell — this
// function must NEVER break the menu. Fast by design: the shell is cached in
// module memory (kept stale forever as a last resort) and responses carry
// s-maxage so the Hosting CDN absorbs repeat hits.
'use strict'

const { onRequest } = require('firebase-functions/v2/https')
const { getFirestore } = require('firebase-admin/firestore')

// The deployed shell is fetched from the live site (never bundled — bundle
// hashes change on every build and a stale copy would 404 its own JS).
// `/` is NOT rewritten to this function, so this cannot recurse.
const SHELL_ORIGINS = ['https://menu-88996.web.app', 'https://menu-88996.firebaseapp.com']
const SHELL_TTL_MS = 5 * 60 * 1000
const TENANT_TTL_MS = 60 * 1000

// Hosts that are the PLATFORM itself. On these, the menu lives at /m/:slug;
// on any other host (venue custom domain / slug subdomain) it lives at /.
// Mirrors src/lib/domains.js (kept dependency-free on purpose).
const PLATFORM_APEX = 'rbt360sa.com'
const PLATFORM_HOSTS = new Set([
  'localhost', '127.0.0.1',
  'menu-88996.web.app', 'menu-88996.firebaseapp.com',
  PLATFORM_APEX, `www.${PLATFORM_APEX}`, `app.${PLATFORM_APEX}`,
])
function isPlatformHost(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '')
  if (!h) return true
  if (PLATFORM_HOSTS.has(h)) return true
  if (h.endsWith('.web.app') || h.endsWith('.firebaseapp.com')) return true
  return false
}

// ---- tiny utils -------------------------------------------------------------
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
// Only a literal hex color may reach the manifest / theme-color (a themed
// color-mix()/var() string would be silently rejected or, worse, injected).
const safeColor = (v, fb) => (/^#[0-9a-fA-F]{3,8}$/.test(String(v || '').trim()) ? String(v).trim() : fb)
const absUrl = (u) => /^https:\/\//i.test(String(u || '')) ? String(u) : ''

// ---- shell cache (module memory, survives across invocations) ---------------
let shellHtml = ''
let shellAt = 0
async function fetchShell() {
  const now = Date.now()
  if (shellHtml && now - shellAt < SHELL_TTL_MS) return shellHtml
  for (const origin of SHELL_ORIGINS) {
    try {
      const r = await fetch(origin + '/', { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(4000) })
      if (!r.ok) continue
      const html = await r.text()
      // sanity: only cache something that looks like the real SPA shell
      if (html.includes('id="root"')) { shellHtml = html; shellAt = now; return shellHtml }
    } catch (_) { /* try the next origin */ }
  }
  return shellHtml || null // stale shell beats no shell; null only on cold start + full outage
}

// ---- tenant cache ------------------------------------------------------------
const tenantCache = new Map() // key -> { data, at }
function cacheGet(key) {
  const hit = tenantCache.get(key)
  return hit && Date.now() - hit.at < TENANT_TTL_MS ? hit.data : undefined
}
function cachePut(key, data) {
  if (tenantCache.size > 500) tenantCache.clear() // crude cap — venue count is small
  tenantCache.set(key, { data, at: Date.now() })
}

// `internals` is the seam unit tests override (no emulator needed): the handler
// always calls through this object, so a test can swap in REST-backed fetchers.
const internals = {
  async tenantBySlug(slug) {
    const key = 's:' + slug
    const hit = cacheGet(key)
    if (hit !== undefined) return hit
    const db = getFirestore()
    const slugSnap = await db.doc(`tenantSlugs/${slug}`).get()
    const tid = slugSnap.exists ? slugSnap.data().tenantId : null
    const data = tid ? await internals.tenantById(tid) : null
    cachePut(key, data)
    return data
  },
  async tenantById(tid) {
    const key = 't:' + tid
    const hit = cacheGet(key)
    if (hit !== undefined) return hit
    const db = getFirestore()
    const snap = await db.doc(`tenants/${tid}`).get()
    const data = snap.exists ? { id: snap.id, ...snap.data() } : null
    cachePut(key, data)
    return data
  },
  fetchShell,
}

// ---- head surgery -------------------------------------------------------------
// Remove the PLATFORM's identity tags so the venue's (injected below) are the
// only ones a crawler sees. Regexes are deliberately loose on attributes/order;
// if one misses, the venue block is still injected FIRST (right after charset),
// and crawlers take the first occurrence — duplicates degrade, never break.
function stripPlatformIdentity(html, { pwa }) {
  let out = html
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta[^>]+name="description"[^>]*>/gi, '')
    .replace(/<meta[^>]+property="og:[^"]*"[^>]*>/gi, '')
    .replace(/<meta[^>]+name="twitter:[^"]*"[^>]*>/gi, '')
  if (pwa) {
    out = out
      .replace(/<meta[^>]+name="theme-color"[^>]*>/gi, '')
      .replace(/<meta[^>]+name="apple-mobile-web-app-title"[^>]*>/gi, '')
      .replace(/<link[^>]+rel="manifest"[^>]*>/gi, '')
      .replace(/<link[^>]+rel="apple-touch-icon"[^>]*>/gi, '')
      .replace(/<link[^>]+rel="icon"[^>]*>/gi, '')
  }
  return out
}
function injectHead(html, block) {
  // keep <meta charset> first (must sit in the first 1024 bytes)
  if (/<meta charset=[^>]*>/i.test(html)) return html.replace(/(<meta charset=[^>]*>)/i, `$1\n${block}`)
  return html.replace(/<head>/i, `<head>\n${block}`)
}

// The venue's <head> block for a menu page (/m/:slug/**).
function venueHeadBlock(tenant, slug, host, path) {
  const name = tenant.name || slug
  const desc = tenant.descAr || `تصفّح المنيو واطلب من ${name}`
  const brand = safeColor(tenant.themeColor, '#171717')
  const logo = absUrl(tenant.logoUrl)
  const ogImage = absUrl(tenant.coverUrl) || logo
  const pageUrl = `https://${host}${path}`
  const manifestUrl = `/m/${encodeURIComponent(slug)}/manifest.webmanifest`
  const touchIcon = logo || `/m/${encodeURIComponent(slug)}/icon.svg`
  const lines = [
    `<title>${esc(name)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(name)}" />`,
    `<meta property="og:title" content="${esc(name)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    ogImage ? `<meta property="og:image" content="${esc(ogImage)}" />` : '',
    `<meta property="og:url" content="${esc(pageUrl)}" />`,
    `<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(name)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<meta name="theme-color" content="${esc(brand)}" />`,
    `<meta name="apple-mobile-web-app-title" content="${esc(name)}" />`,
    `<link rel="manifest" href="${esc(manifestUrl)}" />`,
    `<link rel="apple-touch-icon" href="${esc(touchIcon)}" />`,
    `<link rel="icon" href="${esc(touchIcon)}" />`,
  ]
  return lines.filter(Boolean).join('\n')
}

// The venue's <head> block for a game-room invite (/join/:tid/...). og/title
// only — the PWA identity (manifest / icons) of the platform shell is kept.
function joinHeadBlock(tenant, host, path) {
  const name = tenant.name || ''
  const title = name ? `انضم إلى الجلسة في ${name}` : 'انضم إلى الجلسة'
  const desc = name ? `دعوة للانضمام إلى طاولة/غرفة لعب في ${name}` : 'دعوة للانضمام إلى غرفة لعب'
  const ogImage = absUrl(tenant.logoUrl) || absUrl(tenant.coverUrl)
  const lines = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<meta property="og:type" content="website" />`,
    name ? `<meta property="og:site_name" content="${esc(name)}" />` : '',
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    ogImage ? `<meta property="og:image" content="${esc(ogImage)}" />` : '',
    `<meta property="og:url" content="${esc(`https://${host}${path}`)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
  ]
  return lines.filter(Boolean).join('\n')
}

// ---- per-venue manifest --------------------------------------------------------
function buildManifest(tenant, slug, host) {
  const name = tenant.name || slug
  // On the shared platform host the venue app lives under /m/:slug; on the
  // venue's own (sub)domain the same menu is served at the root.
  const startPath = isPlatformHost(host) ? `/m/${slug}` : '/'
  const logo = absUrl(tenant.logoUrl)
  const ar = (tenant.locale || 'ar') === 'ar'
  return {
    id: startPath,
    name,
    short_name: String(name).slice(0, 24),
    start_url: startPath,
    scope: startPath,
    display: 'standalone',
    orientation: 'any',
    dir: ar ? 'rtl' : 'ltr',
    lang: ar ? 'ar' : 'en',
    background_color: '#ffffff',
    theme_color: safeColor(tenant.themeColor, '#171717'),
    // A venue logo is an arbitrary bitmap — declared 'any' (never 'maskable',
    // Chrome would crop it). No logo -> the generated letter icon below.
    icons: logo
      ? [{ src: logo, sizes: 'any', purpose: 'any' }]
      : [{ src: `/m/${encodeURIComponent(slug)}/icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }
}

// ---- STAFF app identity (/app/:slug) — the tablet's own install -----------------
// The staff PWA must (a) carry the VENUE's name+logo as its launcher icon and
// (b) start at /app/:slug (→ session ? /admin+PinLock : /lock|login). Scope is
// '/' — staff navigate to /admin, /cashier, /kds; a narrow /app scope would
// throw every post-login navigation out of the app window.
function buildStaffManifest(tenant, slug) {
  const name = tenant.name || slug
  const iconUrl = `/app/${encodeURIComponent(slug)}/icon.svg`
  return {
    id: `/app/${slug}`,
    name,
    short_name: String(name).slice(0, 24),
    start_url: `/app/${slug}`,
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    dir: 'rtl',
    lang: 'ar',
    background_color: '#ffffff',
    theme_color: safeColor(tenant.themeColor, '#171717'),
    // One generated 512 SVG serves both purposes: the logo (inlined server-side
    // as a data URI — external hrefs inside manifest-icon SVGs are not fetched)
    // sits inside the maskable safe zone on the brand plate.
    icons: [
      { src: iconUrl, sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
      { src: iconUrl, sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }
}

// Staff icon: venue logo INLINED (data URI) on the brand plate, letter beneath
// as the always-renders fallback. Cached per tenant (icon URL itself is CDN-cached).
const ICON_LOGO_MAX = 400 * 1024
async function staffIconSvg(tenant, slug) {
  const brand = safeColor(tenant && tenant.themeColor, '#171717')
  const letter = String((tenant && tenant.name) || slug || '?').trim().charAt(0).toUpperCase() || '?'
  const base = (inner) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" fill="${esc(brand)}"/>` +
    `<text x="256" y="256" fill="rgba(255,255,255,.9)" font-family="Tajawal, system-ui, sans-serif" font-size="240" font-weight="700" text-anchor="middle" dominant-baseline="central">${esc(letter)}</text>` +
    inner +
    `</svg>`
  const logo = absUrl(tenant && tenant.logoUrl)
  if (!logo) return base('')
  try {
    const r = await fetch(logo, { signal: AbortSignal.timeout(3500) })
    const type = String(r.headers.get('content-type') || '')
    if (!r.ok || !type.startsWith('image/')) return base('')
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length || buf.length > ICON_LOGO_MAX) return base('')
    const dataUri = `data:${type};base64,${buf.toString('base64')}`
    // logo covers the letter when it loads; rounded, inside the maskable safe zone
    return base(
      `<clipPath id="r"><rect x="88" y="88" width="336" height="336" rx="76"/></clipPath>` +
      `<rect x="88" y="88" width="336" height="336" rx="76" fill="#ffffff"/>` +
      `<image href="${esc(dataUri)}" x="88" y="88" width="336" height="336" preserveAspectRatio="xMidYMid slice" clip-path="url(#r)"/>`,
    )
  } catch (_) { return base('') }
}

// The staff shell's <head>: venue title/theme/manifest — no og (never shared).
function staffHeadBlock(tenant, slug) {
  const name = tenant.name || slug
  const brand = safeColor(tenant.themeColor, '#171717')
  const iconUrl = `/app/${encodeURIComponent(slug)}/icon.svg`
  const lines = [
    `<title>${esc(name)}</title>`,
    `<meta name="description" content="${esc(`بوابة فريق العمل في ${name}`)}" />`,
    `<meta name="theme-color" content="${esc(brand)}" />`,
    `<meta name="apple-mobile-web-app-title" content="${esc(name)}" />`,
    `<link rel="manifest" href="/app/${encodeURIComponent(slug)}/manifest.webmanifest" />`,
    `<link rel="apple-touch-icon" href="${esc(iconUrl)}" />`,
    `<link rel="icon" href="${esc(iconUrl)}" />`,
  ]
  return lines.join('\n')
}

// Generated fallback icon: the venue's first letter on its brand color.
function letterIconSvg(tenant, slug) {
  const brand = safeColor(tenant && tenant.themeColor, '#171717')
  const letter = String((tenant && tenant.name) || slug || '?').trim().charAt(0).toUpperCase() || '?'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" rx="256" fill="${esc(brand)}"/>` +
    `<text x="256" y="256" fill="#ffffff" font-family="Tajawal, system-ui, sans-serif" font-size="264" font-weight="700" text-anchor="middle" dominant-baseline="central">${esc(letter)}</text>` +
    `</svg>`
}

// ---- responses ------------------------------------------------------------------
const SHELL_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400'
async function sendShell(res, headBlock, stripPwa) {
  const shell = await internals.fetchShell()
  if (!shell) {
    // cold start during a full origin outage — one automatic retry, then a manual one
    res.set('Cache-Control', 'no-store').status(200).send(
      '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
      '<meta http-equiv="refresh" content="2"/><title>...</title></head>' +
      '<body style="font-family:sans-serif;text-align:center;padding-top:40vh">جارٍ التحميل…</body></html>')
    return
  }
  let html = shell
  if (headBlock) {
    try { html = injectHead(stripPlatformIdentity(shell, { pwa: stripPwa }), headBlock) } catch (_) { html = shell }
  }
  res.set('Cache-Control', SHELL_CACHE).set('Content-Type', 'text/html; charset=utf-8').status(200).send(html)
}

async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).send('method not allowed'); return }
    const path = String(req.path || '/')
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || PLATFORM_APEX).split(',')[0].trim()
    let m

    // /app/:slug/manifest.webmanifest — the STAFF tablet's install identity
    if ((m = path.match(/^\/app\/([^/]+)\/manifest\.webmanifest$/))) {
      const slug = decodeURIComponent(m[1])
      const tenant = await internals.tenantBySlug(slug)
      if (!tenant) { res.set('Cache-Control', 'no-store').status(404).json({ error: 'venue not found' }); return }
      res.set('Cache-Control', 'public, max-age=300, s-maxage=600')
        .set('Content-Type', 'application/manifest+json; charset=utf-8')
        .status(200).send(JSON.stringify(buildStaffManifest(tenant, slug)))
      return
    }

    // /app/:slug/icon.svg — venue logo (inlined) on the brand plate
    if ((m = path.match(/^\/app\/([^/]+)\/icon\.svg$/))) {
      const slug = decodeURIComponent(m[1])
      const tenant = await internals.tenantBySlug(slug).catch(() => null)
      res.set('Cache-Control', 'public, max-age=600, s-maxage=3600')
        .set('Content-Type', 'image/svg+xml; charset=utf-8')
        .status(200).send(await staffIconSvg(tenant, slug))
      return
    }

    // /app/:slug/** — the staff shell wearing the venue's install identity
    if ((m = path.match(/^\/app\/([^/]+)/))) {
      const slug = decodeURIComponent(m[1])
      const tenant = await internals.tenantBySlug(slug).catch(() => null)
      await sendShell(res, tenant ? staffHeadBlock(tenant, slug) : null, true)
      return
    }

    // /m/:slug/manifest.webmanifest — the venue's own install identity
    if ((m = path.match(/^\/m\/([^/]+)\/manifest\.webmanifest$/))) {
      const slug = decodeURIComponent(m[1])
      const tenant = await internals.tenantBySlug(slug)
      if (!tenant) { res.set('Cache-Control', 'no-store').status(404).json({ error: 'venue not found' }); return }
      res.set('Cache-Control', 'public, max-age=300, s-maxage=600')
        .set('Content-Type', 'application/manifest+json; charset=utf-8')
        .status(200).send(JSON.stringify(buildManifest(tenant, slug, host)))
      return
    }

    // /m/:slug/icon.svg — generated letter icon (manifest fallback)
    if ((m = path.match(/^\/m\/([^/]+)\/icon\.svg$/))) {
      const slug = decodeURIComponent(m[1])
      const tenant = await internals.tenantBySlug(slug).catch(() => null)
      res.set('Cache-Control', 'public, max-age=600, s-maxage=3600')
        .set('Content-Type', 'image/svg+xml; charset=utf-8')
        .status(200).send(letterIconSvg(tenant, slug))
      return
    }

    // /m/:slug/** — the menu shell wearing the venue's identity
    if ((m = path.match(/^\/m\/([^/]+)/))) {
      const slug = decodeURIComponent(m[1])
      const tenant = await internals.tenantBySlug(slug).catch(() => null)
      await sendShell(res, tenant ? venueHeadBlock(tenant, slug, host, path) : null, true)
      return
    }

    // /t/:slug/:token — the TABLE sticker scan, the same scan-to-first-paint
    // path as /m/:slug and just as common: without this branch the firebase.json
    // rewrite fell through to the plain shell and every sticker scan lost the
    // venue's title/og/icon (and the CDN edge cache).
    if ((m = path.match(/^\/t\/([^/]+)/))) {
      const slug = decodeURIComponent(m[1])
      const tenant = await internals.tenantBySlug(slug).catch(() => null)
      await sendShell(res, tenant ? venueHeadBlock(tenant, slug, host, path) : null, true)
      return
    }

    // /join/:tid/** — game-room invite wearing the venue's og identity
    if ((m = path.match(/^\/join\/([^/]+)/))) {
      const tenant = await internals.tenantById(decodeURIComponent(m[1])).catch(() => null)
      await sendShell(res, tenant ? joinHeadBlock(tenant, host, path) : null, false)
      return
    }

    await sendShell(res, null, false) // unknown path under the rewrite — plain shell
  } catch (e) {
    // NEVER break the menu: last-ditch plain shell (or the retry page inside sendShell)
    try { await sendShell(res, null, false) } catch (_) {
      try { res.set('Cache-Control', 'no-store').status(200).send('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2">') } catch (_) { /* response already gone */ }
    }
  }
}

exports.venueShell = onRequest({ region: 'us-central1', memory: '256MiB', timeoutSeconds: 15, maxInstances: 10 }, handler)
// test seam: lets a unit test swap the Firestore/shell fetchers and drive the
// handler with a mock req/res — no emulator or credentials required.
exports._internals = internals
exports._handler = handler
