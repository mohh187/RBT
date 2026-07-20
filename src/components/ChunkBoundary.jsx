import { Component } from 'react'
import Icon from './Icon.jsx'
import '../styles/chunkfail.css'

// Why this exists:
// Routes are code-split, so opening one fetches a JS chunk at that moment. That
// fetch can fail for two mundane reasons — the device is offline, or a new
// version was deployed and the old chunk hash no longer exists on the server.
// A rejected dynamic import throws during render, and without a boundary React
// unmounts the whole tree: a WHITE SCREEN, which is the worst possible way to
// say "the network hiccuped".
//
// So this catches it and says what happened, in the venue's language, with a
// way out. It deliberately does NOT auto-retry in a loop: a stale chunk will
// fail forever, and silent retries would just spin.

const TXT = {
  ar: {
    title: 'تعذّر تحميل هذا الجزء',
    offline: 'يبدو أن الجهاز غير متصل بالإنترنت. تحقّق من الاتصال ثم أعد المحاولة.',
    stale: 'قد يكون التطبيق حُدّث للتو. إعادة التحميل تجلب النسخة الجديدة.',
    reload: 'إعادة تحميل الصفحة',
  },
  en: {
    title: 'This part could not load',
    offline: 'The device appears to be offline. Check the connection and try again.',
    stale: 'The app may have just been updated. Reloading fetches the new version.',
    reload: 'Reload page',
  },
}

// A chunk failure has a recognisable shape across browsers. Anything else is a
// real bug in our own code and must not be dressed up as a network problem.
function isChunkError(err) {
  const msg = String(err?.message || err || '')
  return /Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(msg)
}

export default class ChunkBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidUpdate(prev) {
    // Navigating away from the broken route clears the error, so one failed
    // chunk does not strand the whole session on an error screen.
    if (this.state.err && prev.routeKey !== this.props.routeKey) {
      this.setState({ err: null })
    }
  }

  render() {
    const { err } = this.state
    const { children, lang = 'ar' } = this.props
    if (!err) return children

    // Not a chunk problem: rethrow so it reaches the monitor rather than being
    // silently mislabelled as a connectivity issue.
    if (!isChunkError(err)) throw err

    const t = TXT[lang] || TXT.ar
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false

    return (
      <div className="chunkfail" role="alert">
        <span className="chunkfail-ico"><Icon name={offline ? 'wifi' : 'reload'} size={22} /></span>
        <strong className="chunkfail-h">{t.title}</strong>
        <p className="chunkfail-p">{offline ? t.offline : t.stale}</p>
        {/* Only ONE action, deliberately. A soft "try again" that just clears
            this state cannot work: React.lazy marks a rejected payload Rejected
            permanently and re-throws it on every later render, and the browser
            caches the failed module specifier too. A button that always fails is
            worse than no button, because it teaches the guest the app is broken
            rather than that a reload fixes it. Reloading genuinely recovers both
            causes — a new deploy, and offline via the service worker shell. */}
        <div className="chunkfail-acts">
          <button type="button" className="chunkfail-btn primary" onClick={() => window.location.reload()}>
            {t.reload}
          </button>
        </div>
      </div>
    )
  }
}
