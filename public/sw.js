/* MenuLink service worker — notifications (mobile) + offline app shell.
   Network-first so development/online always gets fresh content; cache is the
   offline fallback. */

// Bump on deploy to drop stale/bad cached assets (activate purges old caches).
const CACHE = 'menulink-v2'
const APP_SHELL = ['/', '/index.html', '/favicon.svg', '/manifest.webmanifest']

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
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')))
    return
  }
  // network-first, fall back to cache when offline. Only cache OK, same-origin
  // "basic" responses so an error page / 4xx / 5xx never gets persisted and
  // served offline (which would white-screen the app after a bad deploy).
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(() => caches.match(req)),
  )
})

// Page can trigger a notification via postMessage (works when tab is backgrounded).
self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'notify') {
    self.registration.showNotification(data.title || 'MenuLink', {
      body: data.body || '',
      tag: data.tag,
      icon: data.icon || '/favicon.svg',
      badge: '/favicon.svg',
      renotify: true,
      requireInteraction: !!data.requireInteraction,
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
    })
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus()
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
    self.registration.showNotification(n.title || 'MenuLink', {
      body: n.body || '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
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
