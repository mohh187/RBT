// Cross-party notification dispatcher: sound (via sounds.js) + Web Notifications
// (via service worker so it works on mobile) + vibration. Driven by per-device prefs.
import { getPrefs } from './notifyPrefs.js'
import { playFromPrefs, playPreset, unlockAudio } from './sounds.js'

export { unlockAudio }

// quick beep kept for misc UI feedback
export function beep(freq = 880, dur = 0.3, vol = 0.2) {
  playPreset('urgent', { volume: vol * 4, loops: 1 }).catch(() => {})
}
export function chime() {
  playPreset('chime', { volume: 1, loops: 1 }).catch(() => {})
}

export function vibrate(pattern = [120, 60, 120]) {
  try {
    // The browser blocks (and warns) on vibrate before the user has interacted.
    if (navigator.userActivation && navigator.userActivation.hasBeenActive === false) return
    navigator.vibrate && navigator.vibrate(pattern)
  } catch (_) { /* ignore */ }
}

export function notifyState() {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission // 'default' | 'granted' | 'denied'
}

// iPhone/iPad. iPadOS 13+ masquerades as Mac, so also sniff touch + Mac.
export function isIOS() {
  const ua = navigator.userAgent || ''
  return /iPhone|iPad|iPod/.test(ua)
    || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)
}
// Running as an installed PWA (Add to Home Screen) rather than a browser tab.
export function isStandalone() {
  return window.navigator.standalone === true
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
}
// Apple allows web-push ONLY for an installed PWA. In a plain Safari tab the
// permission prompt cannot even be shown — the app must be added to the Home
// Screen first. Returns: 'ios-needs-install' | 'unsupported' | 'ready'.
export function pushCapability() {
  if (isIOS() && !isStandalone()) return 'ios-needs-install'
  if (!('Notification' in window)) return 'unsupported'
  return 'ready'
}

export async function requestNotifyPermission() {
  try {
    if (!('Notification' in window)) return false
    if (Notification.permission === 'granted') return true
    const r = await Notification.requestPermission()
    return r === 'granted'
  } catch (_) {
    return false
  }
}

// The service worker file is NOT content-hashed, so any CDN in front of Hosting
// can pin an old copy of it — observed in production: Cloudflare served /sw.js
// from its own cache carrying a year-long `immutable` header left by an earlier
// config, so a fixed worker would never have reached anyone. Registering a
// VERSIONED url makes every worker release a distinct resource that no cache
// can confuse with the previous one. A query string does not change the SW's
// scope, so this is transparent to everything else.
// BUMP THIS whenever public/sw.js's CACHE constant changes.
// KEEP IN SYNC with CACHE in public/sw.js — bump BOTH in the same commit.
export const SW_VERSION = 'v9'
export const SW_URL = `/sw.js?v=${SW_VERSION}`

export async function registerSW() {
  try {
    if (!('serviceWorker' in navigator)) return null
    // An existing registration pointing at an older script URL must be replaced,
    // not reused — reg.update() would re-request the SAME (cached) url.
    const existing = await navigator.serviceWorker.getRegistration()
    const activeUrl = existing && (existing.active || existing.waiting || existing.installing)?.scriptURL
    if (existing && activeUrl && activeUrl.includes(`v=${SW_VERSION}`)) return existing
    return await navigator.serviceWorker.register(SW_URL)
  } catch (_) { /* ignore */ }
  return null
}

// Shows a notification using the service worker (required on Android) with a
// fallback to the classic Notification constructor on desktop.
export async function showNotification(title, { body = '', tag, url = '/', requireInteraction = false } = {}) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg) {
        await reg.showNotification(title, {
          body, tag, icon: '/brand/favicon.png', badge: '/brand/favicon.png',
          renotify: true, requireInteraction, vibrate: [200, 100, 200],
          data: { url },
        })
        return
      }
    }
    new Notification(title, { body, tag, icon: '/brand/favicon.png' })
  } catch (_) { /* ignore */ }
}

// High-level: alert this device's user (sound + vibration + system notification),
// gated by the per-device "enabled" preference.
//
// The CHIME is throttled per tag (2s): several raisers watch the same shared
// stream (AdminLayout/Cashier raiser + StaffBell's feed) and land in the same
// React commit, so one new order fired two overlapping sounds on one device.
// The OS notification is NOT throttled — it already collapses by `tag`.
const lastChimeAt = new Map()
export async function alertParty({ title, body, tag, url = '/', requireInteraction = false } = {}) {
  const p = getPrefs()
  if (!p.enabled) return
  const now = Date.now()
  const key = tag || 'x'
  if (now - (lastChimeAt.get(key) || 0) > 2000) {
    lastChimeAt.set(key, now)
    try { playFromPrefs(p) } catch (_) { /* ignore */ }
    vibrate()
  }
  showNotification(title, { body, tag, url, requireInteraction })
}

// Backwards-compatible alias.
export const alertStaff = alertParty
