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
// as 'vite:preloadError'; one reload fetches the fresh index.html and the new
// graph. Throttled so a REAL outage (offline, host down) cannot reload-loop.
// ---------------------------------------------------------------------------
const RELOAD_KEY = 'ml.chunk.reload.at'
function reloadOnceForStaleChunk() {
  let last = 0
  try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0) } catch (_) { /* ignore */ }
  if (Date.now() - last < 30000) return false
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch (_) { /* ignore */ }
  location.reload()
  return true
}
window.addEventListener('vite:preloadError', (e) => {
  if (e && typeof e.preventDefault === 'function') e.preventDefault()
  reloadOnceForStaleChunk()
})

const CHUNK_ERR = /dynamically imported module|Importing a module script failed|Failed to fetch|Load failed|css chunk/i

// Any render crash below used to unmount everything React had painted — the
// same white page, this time permanent. The boundary keeps the failure inside
// one screenful: chunk-load crashes trigger the same one-shot reload as
// above; anything else shows a bilingual recovery card and reports to the
// platform error monitor (render errors never reach window.onerror).
class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidCatch(err) {
    if (CHUNK_ERR.test(String(err && err.message)) && reloadOnceForStaleChunk()) return
    reportBoundaryError(err)
  }

  render() {
    if (!this.state.err) return this.props.children
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: '#0f1115', color: '#f5f6f8', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 420, textAlign: 'center', display: 'grid', gap: 14 }}>
          <div dir="rtl" style={{ display: 'grid', gap: 6 }}>
            <strong style={{ fontSize: 18 }}>حدث خلل غير متوقع</strong>
            <span style={{ opacity: 0.75, fontSize: 14 }}>جرّب تحديث الصفحة — إن تكرر الخلل فسيصل تقريره لنا تلقائياً.</span>
          </div>
          <div dir="ltr" style={{ display: 'grid', gap: 4, opacity: 0.6, fontSize: 12 }}>
            <span>Something went wrong. Refreshing usually fixes it.</span>
          </div>
          <button
            type="button"
            onClick={() => location.reload()}
            style={{ justifySelf: 'center', padding: '10px 26px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.08)', color: 'inherit', fontSize: 15, cursor: 'pointer' }}
          >
            تحديث الصفحة · Reload
          </button>
        </div>
      </div>
    )
  }
}

// Resume the audio context on the first user gesture so alert sounds work
// without the browser's "AudioContext was not allowed to start" warning.
const unlock = () => { unlockAudio().catch(() => {}) }
;['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, unlock, { once: true, passive: true }),
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <I18nProvider>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </I18nProvider>
      </BrowserRouter>
    </RootErrorBoundary>
  </React.StrictMode>,
)
