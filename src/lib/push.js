// Firebase Cloud Messaging (web push) — registers this staff device's token so a
// Cloud Function can alert it even when the app is fully closed.
// Gated: only runs when VITE_FIREBASE_VAPID_KEY is set and notifications are granted.
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging'
import { app } from './firebase.js'
import { savePushToken } from './db.js'
import { showNotification } from './notify.js'

const VAPID = import.meta.env.VITE_FIREBASE_VAPID_KEY
let started = false

// Diagnostic for the notification settings UI — tells the user (and support)
// exactly which layer of background push is missing. `vapid` false = the build
// has no VITE_FIREBASE_VAPID_KEY, so no device can ever register for closed-app
// push (this was THE reason notifications never arrived while the browser was shut).
export function pushDiag() {
  const notif = typeof Notification !== 'undefined'
  return {
    supported: notif && 'serviceWorker' in navigator,
    vapid: !!VAPID,
    permission: notif ? Notification.permission : 'unsupported',
    registered: started,
  }
}

export async function initPush(tenantId, uid) {
  try {
    if (started) return
    if (!app || !VAPID || !tenantId) return
    if (!('serviceWorker' in navigator)) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    if (!(await isSupported())) return

    const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register('/sw.js'))
    const messaging = getMessaging(app)
    const token = await getToken(messaging, { vapidKey: VAPID, serviceWorkerRegistration: reg })
    if (token) await savePushToken(tenantId, token, uid)

    onMessage(messaging, (payload) => {
      const n = payload.notification || {}
      showNotification(n.title || 'RBT360', { body: n.body || '', tag: 'push', url: payload.data?.url || '/cashier' })
    })
    started = true
  } catch (_) {
    /* ignore */
  }
}
