/* RBT360 service worker — notifications (mobile) + offline app shell.
   Network-first so development/online always gets fresh content; cache is the
   offline fallback. */

// Bump on deploy to drop stale/bad cached assets (activate purges old caches).
// KEEP IN SYNC with SW_VERSION in src/lib/notify.js (the ?v= cache-buster on
// the registration URL) — drifting versions leave devices on a stale worker.
const CACHE = 'rbt360-v9'
// The venue's photographs (wall, tables, dishes, header, logo) — a SEPARATE
// cache that SURVIVES deploys: every Storage upload lives at a unique
// timestamped path, so its bytes never change and cache-first is always
// correct. This is what makes a repeat menu open paint instantly instead of
// «تظهر النوافذ فارغة بعدها تحمل الصور».
const IMG_CACHE = 'rbt360-img-v1'
const IMG_HOSTS = ['firebasestorage.googleapis.com']
const IMG_MAX_ENTRIES = 400
// NOT the manifest: precaching the PLATFORM manifest under the app-shell cache
// leaked the platform's install identity onto venue/staff surfaces whose
// manifest is per-venue (/m/:slug, /app/:slug). It's tiny and no-cache'd anyway.
const APP_SHELL = ['/', '/index.html', '/brand/favicon.png']

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).catch(() => {}))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE && k !== IMG_CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

// Cache-first for the venue photos: hit = zero network, miss = fetch + store.
// Opaque (no-cors <img>) responses are stored too — their status is unreadable,
// which also means an opaque 403/404 (Storage token not yet propagated, a 429)
// is indistinguishable from a good image and would otherwise sit in the cache
// FOREVER, leaving that dish photo permanently blank on the device. So opaque
// hits are served instantly but re-fetched in the background and overwritten
// (stale-while-revalidate) — cheap, because the browser's HTTP cache answers
// the revalidation for genuinely-immutable URLs, while a cached error heals on
// the next successful fetch. Insertion-ordered trim bounds the cache.
async function imgPut(cache, req, res) {
  try {
    await cache.put(req, res.clone())
    const keys = await cache.keys()
    if (keys.length > IMG_MAX_ENTRIES) await Promise.all(keys.slice(0, keys.length - IMG_MAX_ENTRIES).map((k) => cache.delete(k)))
  } catch (_) { /* storage full — serve from network as-is */ }
}
async function imageFirst(req) {
  const cache = await caches.open(IMG_CACHE)
  const hit = await cache.match(req, { ignoreVary: true })
  if (hit) {
    if (hit.type === 'opaque') {
      // background revalidate: replaces a cached opaque error with the real image
      fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) return imgPut(cache, req, res) }).catch(() => {})
    }
    return hit
  }
  const res = await fetch(req)
  if (res && (res.ok || res.type === 'opaque')) await imgPut(cache, req, res)
  return res
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) {
    // ONLY no-cors <img> requests to the venue-photo hosts get the cache.
    // A CORS fetch (canvas edits, manifest icons, background removal) served
    // an opaque cache hit is a spec violation the browser turns into
    // net::ERR_FAILED — exactly the pwa.js console failure — so CORS-mode
    // requests pass straight through to the network untouched.
    if (IMG_HOSTS.includes(url.hostname) && req.destination === 'image' && req.mode === 'no-cors') {
      event.respondWith(imageFirst(req).catch(() => fetch(req)))
    }
    return
  }

  if (req.mode === 'navigate') {
    // ALWAYS resolve to a real Response. `caches.match` returns undefined when
    // nothing is cached (every fresh dev server, and prod right after the
    // activate purge), and respondWith(undefined) throws "Failed to convert
    // value to 'Response'" — which surfaced as an uncaught sw.js error and a
    // rejected FetchEvent while the app was reloading. Fall through network →
    // cached shell → Response.error() (a normal network-error the page can
    // handle), never undefined.
    event.respondWith(
      fetch(req).catch(async () => (await caches.match('/index.html')) || (await caches.match('/')) || Response.error()),
    )
    return
  }
  // network-first, fall back to cache when offline. Only cache OK, same-origin
  // "basic" responses so an error page / 4xx / 5xx never gets persisted and
  // served offline (which would white-screen the app after a bad deploy).
  // On a miss return Response.error(), NOT the undefined caches.match yields —
  // undefined makes respondWith throw; Response.error() lets the app's own
  // vite:preloadError reload handler catch a failed chunk fetch normally.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(async () => (await caches.match(req)) || Response.error()),
  )
})

// Page can trigger a notification via postMessage (works when tab is backgrounded).
self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'notify') {
    self.registration.showNotification(data.title || 'RBT360', {
      body: data.body || '',
      tag: data.tag,
      icon: data.icon || '/brand/favicon.png',
      badge: '/brand/favicon.png',
      renotify: true,
      requireInteraction: !!data.requireInteraction,
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
    })
  }
})

// TAPPING A NOTIFICATION GOES WHERE THE NOTIFICATION POINTS.
//
// This read `url` and then threw it away: with any window client open it called
// focus() and stopped, so the staff tablet — which always has the app open —
// surfaced whatever screen it was already on. The order id in the payload
// travelled the whole way and was discarded at the last step, which is why
// "tap the new-order alert and it opens that order" never worked while the
// exact same link worked from the in-app bell.
//
// focus() AND navigate(). navigate() is only available to a client this worker
// controls, so the openWindow fallback stays for a hard-reloaded or
// uncontrolled page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      for (const client of list) {
        try { if ('focus' in client) await client.focus() } catch (_) { /* keep going */ }
        // navigate() exists on every WindowClient but REJECTS for a client this
        // worker doesn't control (e.g. after a hard reload) — so the message
        // fallback must live in the catch, not behind an `in` test that is
        // always true. AdminLayout listens for the message; other shells fall
        // through to openWindow below.
        try { await client.navigate(url); return } catch (_) { /* uncontrolled */ }
        try { client.postMessage({ type: 'navigate', url }); return } catch (_) { /* try next */ }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    }),
  )
})

// ---- Firebase Cloud Messaging (background push when app is closed) ----
// Best-effort: if offline or blocked, the rest of the SW still works.
try {
  // KEEP IN SYNC with the app bundle's firebase version (package-lock resolves
  // ^11.1.0 → 11.10.0); a 9-minor skew between getToken (page) and
  // onBackgroundMessage (this worker) is silent drift.
  importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js')
  importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js')
  firebase.initializeApp({
    apiKey: 'AIzaSyCeR42D9DdwYgXMb4CCAqbzCTkp_AMpfU8',
    projectId: 'menu-88996',
    messagingSenderId: '623710075919',
    appId: '1:623710075919:web:47fc7af1e4f3d0446e377a',
  })
  const messaging = firebase.messaging()
  messaging.onBackgroundMessage((payload) => {
    const n = payload.notification || {}
    const data = payload.data || {}
    self.registration.showNotification(n.title || 'RBT360', {
      body: n.body || '',
      // the sender may carry the venue's own logo (data.icon) — honor it
      icon: data.icon || n.icon || '/brand/favicon.png',
      badge: '/brand/favicon.png',
      tag: data.tag || 'push',
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: { url: data.url || '/cashier' },
    })
  })
} catch (e) {
  /* FCM unavailable (offline / unsupported) — ignore */
}
