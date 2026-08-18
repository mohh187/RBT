// Staff-device registry — every till / kitchen screen / manager phone gets a
// stable anonymous id and heartbeats a small doc under
// tenants/{tid}/devices/{deviceId}. This is what lets the venue answer "which
// devices are actually running my system, and when were they last alive?"
// without walking to each tablet. Deliberately context-free: no auth import,
// no uid required — the heartbeat identifies the DEVICE, and the optional
// { uid, actorName } patch (passed by callers that have a session) records who
// happened to be signed in when it beat.
import { useEffect } from 'react'
import { doc, setDoc, onSnapshot, collection } from 'firebase/firestore'
import { db } from './firebase.js'
import { SW_VERSION } from './notify.js'
import { isEmbedded } from './embedded.js'

// Same pattern as device.js's deviceKey (guest card scoping) but a SEPARATE
// key: a staffer's till identity and a guest's saved-card identity must never
// share a lifecycle — clearing one must not clear the other.
const ID_KEY = 'ml.staffdev.id'
const NAME_KEY = 'ml.staffdev.name'

export function getStaffDeviceId() {
  try {
    let k = localStorage.getItem(ID_KEY)
    if (!k) {
      k = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `d${Date.now()}${Math.random().toString(36).slice(2)}`
      localStorage.setItem(ID_KEY, k)
    }
    return k
  } catch (_) { return '' }
}

// Short human platform label — enough to tell "the counter iPad" from "the
// kitchen Android" in a list; never used for logic.
function sniffPlatform() {
  const ua = navigator.userAgent || ''
  // iPadOS 13+ masquerades as Macintosh; the touch-points check unmasks it.
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/Android/i.test(ua)) return 'Android'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac'
  return 'Web'
}

export function getStaffDeviceName() {
  try {
    const n = localStorage.getItem(NAME_KEY)
    if (n) return n
  } catch (_) { /* storage blocked */ }
  const p = sniffPlatform()
  if (p === 'Android') return 'جهاز أندرويد'
  if (p === 'iPad') return 'جهاز iPad'
  if (p === 'iPhone') return 'جهاز آيفون'
  return 'جهاز كمبيوتر'
}

export function setStaffDeviceName(name) {
  try { localStorage.setItem(NAME_KEY, String(name || '').trim()) } catch (_) { /* storage blocked */ }
}

// Upsert this device's registry doc. merge:true so a rename from the check
// sheet and a background heartbeat never clobber each other. No createdAt:
// merge would overwrite it on every beat anyway — lastSeenAt is the only
// timestamp that means anything for a heartbeat doc.
// Never throws: a dead network or a rules denial must not break the shell
// that fired it — the registry is a diagnostic, not a dependency.
export async function registerStaffDevice(tid, patch = {}) {
  try {
    if (!db || !tid) return
    // Preview iframes (StaffPreview, Settings galleries) boot this full app —
    // without the guard every preview frame would mint a phantom "device".
    if (isEmbedded) return
    const id = getStaffDeviceId()
    if (!id) return
    await setDoc(doc(db, 'tenants', tid, 'devices', id), {
      name: getStaffDeviceName(),
      ua: navigator.userAgent || '',
      platform: sniffPlatform(),
      standalone: !!(window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone),
      screenW: window.screen?.width || 0,
      screenH: window.screen?.height || 0,
      appVersion: SW_VERSION,
      lastSeenAt: Date.now(),
      ...patch,
    }, { merge: true })
  } catch (_) { /* offline / rules — the heartbeat must never surface */ }
}

export function watchStaffDevices(tid, cb) {
  return onSnapshot(
    collection(db, 'tenants', tid, 'devices'),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => cb([]),
  )
}

// Heartbeat hook for the staff shells (cashier / KDS). Beats on mount, every
// 5 minutes, and when the tab returns to the foreground — the visibility beat
// matters most on tablets that sleep between rushes: the interval is frozen
// while suspended, so waking the screen is what stamps "alive again".
// 5-minute cadence against DeviceCheck's 6-minute "online" window means one
// on-time beat keeps a device green; a single missed beat flips it.
export function useDeviceHeartbeat(tenantId) {
  useEffect(() => {
    if (!tenantId || isEmbedded) return
    const beat = () => { registerStaffDevice(tenantId) } // fire-and-forget
    beat()
    const iv = setInterval(beat, 5 * 60 * 1000)
    const onVis = () => { if (document.visibilityState === 'visible') beat() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
  }, [tenantId])
}
