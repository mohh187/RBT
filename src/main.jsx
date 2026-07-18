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

// Register the service worker (enables notifications on mobile).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => registerSW())
}

// Match the browser chrome (iOS status bar / bottom bar) to the app background.
initThemeColorSync()

// Global error capture → platform console (code monitoring across all venues).
initMonitor()

// Resume the audio context on the first user gesture so alert sounds work
// without the browser's "AudioContext was not allowed to start" warning.
const unlock = () => { unlockAudio().catch(() => {}) }
;['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, unlock, { once: true, passive: true }),
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
