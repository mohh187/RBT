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
import { initMonitor } from './lib/monitor.js'
import { initThemeColorSync } from './lib/themeColor.js'
import ErrorBoundary, { reloadOnceForStaleChunk } from './components/ErrorBoundary.jsx'

// Register the service worker (enables notifications on mobile).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => registerSW())
}

// Match the browser chrome (iOS status bar / bottom bar) to the app background.
initThemeColorSync()

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
