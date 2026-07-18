// Global client error monitor → platformErrors (code monitoring for the
// platform console). Captures uncaught errors + unhandled promise rejections
// from EVERY venue's devices (staff and diners alike), tagged with the current
// tenant/user when known. Deduped per message and capped per session so a
// render loop can't flood Firestore. Rules allow anonymous bounded creates.
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db, firebaseReady } from './firebase.js'

let ctx = { uid: null, tenantId: null, tenantName: '' }
export function setMonitorContext(next) {
  ctx = { ...ctx, ...next }
}

const seen = new Set()
let sent = 0
const MAX_PER_SESSION = 15

function report(message, stack, kind) {
  try {
    if (!firebaseReady || !db) return
    const msg = String(message || '').slice(0, 1900)
    if (!msg) return
    const key = msg.slice(0, 160)
    if (seen.has(key) || sent >= MAX_PER_SESSION) return
    seen.add(key)
    sent++
    addDoc(collection(db, 'platformErrors'), {
      message: msg,
      stack: String(stack || '').slice(0, 1900),
      kind,
      url: String(location.href).slice(0, 300),
      ua: navigator.userAgent.slice(0, 200),
      tenantId: ctx.tenantId || null,
      tenantName: ctx.tenantName || '',
      uid: ctx.uid || null,
      status: 'open',
      at: serverTimestamp(),
    }).catch(() => {})
  } catch { /* never break the app from the monitor */ }
}

let installed = false
export function initMonitor() {
  if (installed) return
  installed = true
  window.addEventListener('error', (e) => {
    // Ignore opaque cross-origin "Script error." noise.
    if (e.message === 'Script error.' && !e.filename) return
    report(e.message, e.error && e.error.stack, 'error')
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    report((r && (r.message || r.code)) || String(r || 'unhandled rejection'), r && r.stack, 'promise')
  })
}
