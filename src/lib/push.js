// Firebase Cloud Messaging (web push) — registers this staff device's token so a
// Cloud Function can alert it even when the app is fully closed.
// Gated: only runs when VITE_FIREBASE_VAPID_KEY is set and notifications are granted.
import { getMessaging, getToken, deleteToken, onMessage, isSupported } from 'firebase/messaging'
import { app } from './firebase.js'
import { savePushToken, deletePushToken } from './db.js'
import { showNotification } from './notify.js'
import { registerSW } from './notify.js'

const VAPID = import.meta.env.VITE_FIREBASE_VAPID_KEY
// Guard by WHO registered, not a boolean: a PIN session-swap on a shared
// tablet must re-save the token doc under the NEW uid, or cap-filtered pushes
// keep landing on whoever signed in first.
let startedFor = null
let messageHooked = false

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
    registered: !!startedFor,
  }
}

export async function initPush(tenantId, uid) {
  try {
    // Preview iframes boot the full app (auth included) — without this guard
    // every Settings/Design-gallery frame re-registered the SW, minted an FCM
    // token and re-wrote the pushTokens doc, bypassing main.jsx's embed skip.
    const { isEmbedded } = await import('./embedded.js')
    if (isEmbedded) return
    if (startedFor === uid) return
    if (!app || !VAPID || !tenantId) return
    if (!('serviceWorker' in navigator)) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    if (!(await isSupported())) return

    const reg = await registerSW()
    const messaging = getMessaging(app)
    const token = await getToken(messaging, { vapidKey: VAPID, serviceWorkerRegistration: reg })
    // token-doc id derives from the token itself, so re-saving after a user
    // swap OVERWRITES the uid in place — the device follows its current user.
    if (token) await savePushToken(tenantId, token, uid)

    if (!messageHooked) {
      onMessage(messaging, (payload) => {
        const n = payload.notification || {}
        // carry the sender's tag: the service worker collapses on data.tag, and
        // the in-app raisers use 'order' — a hardcoded 'push' here meant the OS
        // could not merge the two and every order left two notifications.
        showNotification(n.title || 'RBT360', { body: n.body || '', tag: payload.data?.tag || 'push', url: payload.data?.url || '/cashier' })
      })
      messageHooked = true
    }
    startedFor = uid
  } catch (_) {
    /* ignore */
  }
}

// Sign-out counterpart: drop the token doc AND the token itself, so the device
// stops receiving this venue's pushes the moment the staffer leaves. Entirely
// best-effort — an unsupported browser, a never-granted permission or a device
// that never registered are all normal, and none of them may block the logout.
export async function revokePush(tenantId) {
  const wasFor = startedFor
  startedFor = null
  try {
    if (!wasFor && !tenantId) return
    if (!app || !VAPID) return
    if (!('serviceWorker' in navigator)) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    if (!(await isSupported())) return
    const reg = await registerSW()
    const messaging = getMessaging(app)
    // same registration initPush used, so this reads the EXISTING token instead
    // of minting a second one; permission is already granted, so nobody is
    // prompted on their way out.
    const token = await getToken(messaging, { vapidKey: VAPID, serviceWorkerRegistration: reg }).catch(() => null)
    if (token && tenantId) await deletePushToken(tenantId, token).catch(() => {})
    await deleteToken(messaging).catch(() => {})
  } catch (_) {
    /* ignore */
  }
}
