import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { I18nProvider } from './lib/i18n.jsx'
import { AuthProvider } from './lib/auth.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { registerSW } from './lib/notify.js'
import { unlockAudio } from './lib/sounds.js'
import { initMonitor, reportBoundaryError } from './lib/monitor.js'
import { initThemeColorSync } from './lib/themeColor.js'
import { initContrastGuard } from './lib/contrastGuard.js'
import { isEmbedded } from './lib/embedded.js'
import ErrorBoundary, { reloadOnceForStaleChunk } from './components/ErrorBoundary.jsx'

// Register the service worker (enables notifications on mobile). Preview
// iframes boot this same file — skip registration there: the parent document
// already owns the worker, and N frames re-registering it is pure churn.
if ('serviceWorker' in navigator && !isEmbedded) {
  window.addEventListener('load', () => registerSW())
}

// Match the browser chrome (iOS status bar / bottom bar) to the app background.
initThemeColorSync()

// Guarantee readable ink on every theme/mode/brand combination (see the file).
initContrastGuard()

// Global error capture → platform console (code monitoring across all venues).
initMonitor()

// ---------------------------------------------------------------------------
// Stale-deploy self-healing. Every deploy renames the hashed chunk files, so a
// tab opened BEFORE the deploy asks for module URLs that no longer exist the
// moment it lazy-loads its next route — which used to render as a dead white
// page («مرات لا تعمل أو تفتح صفحة بيضاء»). Vite reports exactly that failure
// as 'vite:preloadError'; reloadOnceForStaleChunk() (shared with the boundary,
// so they can't double-reload) fetches the fresh index.html and the new graph.
// Throttled so a REAL outage (offline, host down) cannot reload-loop.
// ---------------------------------------------------------------------------
window.addEventListener('vite:preloadError', (e) => {
  if (e && typeof e.preventDefault === 'function') e.preventDefault()
  reloadOnceForStaleChunk()
})

// ---------------------------------------------------------------------------
// Firestore INTERNAL-ASSERTION self-heal — WIPE-FIRST with a hard cap.
// The persistent multi-tab cache can, on this SDK line, receive an unexpected
// watch-target state and throw "FIRESTORE INTERNAL ASSERTION FAILED (ID:
// ca9/b815)", which puts the async queue into a PERMANENTLY failed state —
// every later read/write throws and the app bricks until "Clear site data".
// Design (v2 — the v1 ladder had a fatal flaw: an 8s "clean run" timer reset
// the sessionStorage stage, so any assertion firing later than 8s into a
// session always took the useless reload-only rung and the wipe never ran —
// an endless break-and-reload loop, exactly the reported symptom):
//   · FIRST assertion → wipe the Firestore IndexedDB + reload. The wipe is
//     safe — it is only a cache, all data lives server-side — and it IS the
//     cure for a corrupted cache, so there is no reload-only rung any more.
//   · Incident log in localStorage (shared across tabs — sessionStorage gave
//     each tab its own ladder and they could reload-storm each other), pruned
//     to the last 10 minutes.
//   · HARD CAP: 2 heals per 10 minutes. Past it: NO reload — a static Arabic
//     overlay with a manual wipe+reload button (user-initiated = loop-proof),
//     plus one monitor report so /platform/health sees the uncured fault.
//   · Iframes never heal: a preview realm must not wipe the top page's live
//     cache (post-fix they run a memory cache and cannot assert anyway).
const FS_HEAL_KEY = 'ml.fsHeal.v2'
const FS_HEAL_WINDOW = 10 * 60 * 1000
const FS_HEAL_MAX = 2
const fsHealLog = () => {
  try {
    const now = Date.now()
    const arr = JSON.parse(localStorage.getItem(FS_HEAL_KEY) || '[]')
    return (Array.isArray(arr) ? arr : []).filter((t) => typeof t === 'number' && now - t < FS_HEAL_WINDOW)
  } catch (_) { return [] }
}
const fsHealMark = (log) => { try { localStorage.setItem(FS_HEAL_KEY, JSON.stringify(log)) } catch (_) { /* ignore */ } }
async function wipeFirestoreCache() {
  // The SDK holds an open IDB connection for the page's lifetime, and
  // deleteDatabase against an open DB just fires `blocked` — the delete stays
  // pending and loses the race with the reload, so the corrupt cache survives
  // and re-asserts. terminate() closes the SDK's connection first (bounded so
  // a hung queue can't stall the recovery).
  try {
    const { terminate } = await import('firebase/firestore')
    const { db } = await import('./lib/firebase.js')
    if (db) await Promise.race([terminate(db), new Promise((r) => setTimeout(r, 1200))])
  } catch (_) { /* best effort */ }
  try {
    const listed = (indexedDB.databases ? await indexedDB.databases() : []) || []
    const names = listed.map((d) => d && d.name).filter((n) => n && /firestore/i.test(n))
    if (!names.length) names.push(`firestore/[DEFAULT]/${import.meta.env.VITE_FIREBASE_PROJECT_ID}/main`)
    await Promise.all(names.map((n) => new Promise((res) => {
      let done = false; const fin = () => { if (!done) { done = true; res() } }
      try { const req = indexedDB.deleteDatabase(n); req.onsuccess = fin; req.onerror = fin; req.onblocked = fin } catch (_) { fin() }
      setTimeout(fin, 1500) // never hang the recovery on a blocked delete
    })))
  } catch (_) { /* best effort — a plain reload still often recovers */ }
}
// Past the cap: a static DOM overlay (no React — the tree may be dead), with
// the ONLY remaining action a manual wipe+reload. Deliberately unstyled by app
// CSS (inline styles) so it renders even if the stylesheet never loaded.
let fsOverlayShown = false
function showFsHealCapped() {
  if (fsOverlayShown || !document.body) return
  fsOverlayShown = true
  const el = document.createElement('div')
  el.setAttribute('dir', 'rtl')
  el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(10,10,12,.92);color:#fafafa;font-family:inherit;padding:24px;text-align:center'
  const card = document.createElement('div')
  card.style.cssText = 'max-width:420px;display:flex;flex-direction:column;gap:12px;align-items:center'
  card.innerHTML =
    '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#e0a050" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18.1a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
    '<strong style="font-size:17px">تعذّر تشغيل قاعدة البيانات المحلية</strong>' +
    '<span style="font-size:13.5px;opacity:.8;line-height:1.7">حدث عطل متكرر في التخزين المؤقت على هذا الجهاز. اضغط الزر لمسح البيانات المؤقتة وإعادة التحميل. لن تفقد أي بيانات، فكل شيء محفوظ في الخادم.</span>'
  const btn = document.createElement('button')
  btn.textContent = 'مسح البيانات المؤقتة وإعادة التحميل'
  btn.style.cssText = 'margin-top:4px;padding:12px 22px;border-radius:12px;border:0;background:#3f6dd8;color:#fff;font:inherit;font-weight:700;font-size:14px;cursor:pointer'
  btn.onclick = () => { btn.disabled = true; wipeFirestoreCache().finally(() => window.location.reload()) }
  card.appendChild(btn)
  el.appendChild(card)
  document.body.appendChild(el)
}
let fsHealing = false
let fsCapReported = false
function onFatalFirestore(msg) {
  if (fsHealing || isEmbedded) return
  if (typeof msg !== 'string' || !/INTERNAL ASSERTION FAILED/i.test(msg) || !/FIRESTORE/i.test(msg)) return
  fsHealing = true
  const log = fsHealLog()
  if (log.length >= FS_HEAL_MAX) {
    // Two wipes in 10 minutes did not cure it — stop reloading, surface it.
    // Report ONCE: the report itself writes into the bricked Firestore, whose
    // rejection lands right back on these listeners — without the flag that
    // ping-pong burned monitor budget in a loop.
    if (!fsCapReported) {
      fsCapReported = true
      try { reportBoundaryError(new Error('[fs-heal-capped] ' + msg.slice(0, 300)), '') } catch (_) { /* ignore */ }
    }
    showFsHealCapped()
    fsHealing = false // allow the overlay path again if the first call raced before <body>
    return
  }
  fsHealMark(log.concat(Date.now()))
  wipeFirestoreCache().finally(() => window.location.reload())
}
window.addEventListener('unhandledrejection', (e) => onFatalFirestore(String((e && e.reason && (e.reason.message || e.reason)) || '')))
window.addEventListener('error', (e) => onFatalFirestore(String((e && (e.message || (e.error && e.error.message))) || '')))
// v1 key cleanup (sessionStorage-based ladder, replaced by the v2 log above)
try { sessionStorage.removeItem('ml.fsHeal') } catch (_) { /* ignore */ }

// The last-resort boundary. Anything that throws in render ABOVE the router
// (providers, the app shell) — or that the route-level boundary re-throws —
// lands here instead of unmounting everything into a permanent white page. The
// reusable component folds in the same stale-chunk one-shot reload and reports
// genuine crashes to the platform monitor. Rendered as `fullscreen` because at
// this depth it sits above the theme and the router, so it can't be inline.

// Resume the audio context on the first user gesture so alert sounds work
// without the browser's "AudioContext was not allowed to start" warning.
const unlock = () => { unlockAudio().catch(() => {}) }
;['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, unlock, { once: true, passive: true }),
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary variant="fullscreen">
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <I18nProvider>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </I18nProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
