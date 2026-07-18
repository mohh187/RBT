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

export async function registerSW() {
  try {
    if ('serviceWorker' in navigator) {
      return await navigator.serviceWorker.register('/sw.js')
    }
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
          body, tag, icon: '/favicon.svg', badge: '/favicon.svg',
          renotify: true, requireInteraction, vibrate: [200, 100, 200],
          data: { url },
        })
        return
      }
    }
    new Notification(title, { body, tag, icon: '/favicon.svg' })
  } catch (_) { /* ignore */ }
}

// High-level: alert this device's user (sound + vibration + system notification),
// gated by the per-device "enabled" preference.
export async function alertParty({ title, body, tag, url = '/', requireInteraction = false } = {}) {
  const p = getPrefs()
  if (!p.enabled) return
  try { playFromPrefs(p) } catch (_) { /* ignore */ }
  vibrate()
  showNotification(title, { body, tag, url, requireInteraction })
}

// Backwards-compatible alias.
export const alertStaff = alertParty
