/* RBT360 service worker — notifications (mobile) + offline app shell.
   Network-first so development/online always gets fresh content; cache is the
   offline fallback. */

// Bump on deploy to drop stale/bad cached assets (activate purges old caches).
const CACHE = 'rbt360-v6'
const APP_SHELL = ['/', '/index.html', '/brand/favicon.png', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).catch(() => {}))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // never cache Firestore/Storage/CDN

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
        try {
          if ('focus' in client) await client.focus()
          if ('navigate' in client) { await client.navigate(url); return }
          // Uncontrolled client: it cannot be navigated from here, but it can be
          // told where to go. App code listens for this (src/lib/push.js).
          if ('postMessage' in client) { client.postMessage({ type: 'navigate', url }); return }
          return
        } catch (_) { /* try the next client */ }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    }),
  )
})

// ---- Firebase Cloud Messaging (background push when app is closed) ----
// Best-effort: if offline or blocked, the rest of the SW still works.
try {
  importScripts('https://www.gstatic.com/firebasejs/11.1.0/firebase-app-compat.js')
  importScripts('https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging-compat.js')
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
      icon: '/brand/favicon.png',
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
