import { Component } from 'react'
import { reportBoundaryError } from '../lib/monitor.js'

// ---------------------------------------------------------------------------
// One reusable error boundary for the whole app. It exists so a crash in ANY
// React render — a bad item shape, a null deref deep inside a screen, a lazy
// route whose chunk 404s after a deploy — can NEVER unmount the tree into a
// permanent white page («صفحة بيضاء»). It catches, keeps the failure inside one
// screenful, and gives the guest a way back.
//
// IMPORTANT — this only covers JS *render* errors. A tab running OUT OF MEMORY
// (the OOM crash weak phones hit on a heavy menu) is a process-level kill that
// no JavaScript can observe or catch; it is PREVENTED elsewhere (see
// src/lib/deviceCaps.js), not recovered here.
//
// Two render-failure classes, handled differently:
//   1. A stale-deploy / flaky-network chunk load. Every deploy renames the
//      hashed chunk files, so a tab opened before it asks for a module URL that
//      no longer exists the moment it lazy-loads its next route. The only cure
//      is ONE reload to fetch the fresh index.html + module graph — we never
//      show a card for this, we self-heal with a throttled reload.
//   2. A genuine render error. No reload fixes a real bug, so we show a
//      bilingual recovery card and report it to the platform monitor (render
//      errors never reach window.onerror). At the route level the card is
//      inline so the app shell survives; as the last resort in main.jsx it
//      covers the screen.
// ---------------------------------------------------------------------------

const CHUNK_RE = /Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed|Failed to fetch|Load failed|css chunk/i

export function isChunkError(err) {
  return CHUNK_RE.test(String((err && err.message) || err || ''))
}

// Throttled one-shot reload, shared at module scope so nested boundaries and the
// vite:preloadError listener in main.jsx can't double-reload, and a genuine
// outage (offline, host down) can't reload-loop the tab.
const RELOAD_KEY = 'ml.chunk.reload.at'
export function reloadOnceForStaleChunk() {
  let last = 0
  try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0) } catch (_) { /* ignore */ }
  if (Date.now() - last < 30000) return false
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch (_) { /* ignore */ }
  try { window.location.reload() } catch (_) { /* ignore */ }
  return true
}

const TXT = {
  ar: {
    title: 'حدث خلل غير متوقع',
    body: 'جرّب تحديث الصفحة — إن تكرر الخلل فسيصل تقريره لنا تلقائياً.',
    reload: 'حدّث',
    retry: 'إعادة المحاولة',
  },
  en: {
    title: 'Something went wrong',
    body: 'Refreshing usually fixes it. A report reaches us automatically.',
    reload: 'Reload',
    retry: 'Try again',
  },
}

// Plain inline SVG (no emoji, per repo rule) — a soft warning glyph. Inline so
// the boundary renders even when a stylesheet or icon chunk failed to arrive.
function WarnGlyph({ color }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.2 21 19H3L12 3.2Z"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 10v4" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="16.6" r="0.9" fill={color} />
    </svg>
  )
}

// Build the styles for one variant. Everything is inline: an error boundary that
// depends on an external stylesheet is one that can't paint the day that
// stylesheet is the thing that failed.
function styles(variant) {
  const fullscreen = variant === 'fullscreen'
  if (fullscreen) {
    // Absolute last resort (main.jsx), above the router/providers — it can't
    // read the theme, so it commits to a self-contained dark card.
    return {
      wrap: { minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: '#0f1115', color: '#f5f6f8', fontFamily: 'system-ui, -apple-system, sans-serif' },
      card: { maxWidth: 420, textAlign: 'center', display: 'grid', gap: 14, justifyItems: 'center' },
      glyph: '#f5b74e',
      title: { fontSize: 18, fontWeight: 800 },
      body: { opacity: 0.75, fontSize: 14, lineHeight: 1.6 },
      en: { opacity: 0.55, fontSize: 12, lineHeight: 1.55 },
      btnPrimary: { padding: '10px 26px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.08)', color: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
      btnGhost: { padding: '9px 18px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: 0.85 },
    }
  }
  const soft = variant === 'soft'
  // Route + soft variants blend into whatever screen they sit in, via theme
  // custom properties with safe fallbacks (they still read fine if a variable
  // is undefined). Soft is compact and does not reserve a screenful.
  return {
    wrap: { minHeight: soft ? 0 : '60dvh', display: 'grid', placeItems: 'center', padding: soft ? '18px 16px' : '32px 20px', color: 'var(--text, inherit)', fontFamily: 'inherit' },
    card: { maxWidth: soft ? 360 : 420, textAlign: 'center', display: 'grid', gap: soft ? 10 : 14, justifyItems: 'center', ...(soft ? { padding: '18px 16px', borderRadius: 16, border: '1px solid var(--line, rgba(128,128,128,0.22))', background: 'var(--surface-2, rgba(128,128,128,0.08))' } : null) },
    glyph: 'var(--warn, #e0a11a)',
    title: { fontSize: soft ? 15 : 17, fontWeight: 800, letterSpacing: '-0.3px' },
    body: { margin: 0, fontSize: soft ? 13 : 14, lineHeight: 1.6, color: 'var(--muted, #7a8794)', maxWidth: '42ch' },
    en: { margin: 0, fontSize: 12, lineHeight: 1.55, color: 'var(--muted, #7a8794)', opacity: 0.8 },
    btnPrimary: { padding: '10px 22px', borderRadius: 12, border: '1px solid transparent', background: 'var(--brand, #16a34a)', color: '#fff', font: 'inherit', fontWeight: 700, cursor: 'pointer' },
    btnGhost: { padding: '9px 18px', borderRadius: 12, border: '1px solid var(--line, rgba(128,128,128,0.28))', background: 'transparent', color: 'inherit', font: 'inherit', fontWeight: 600, cursor: 'pointer' },
  }
}

// Props:
//   variant   'route' (default, inline card, app shell survives)
//             'soft'  (compact isolated card for a widget/subtree; offers a
//                      local re-mount "try again" because a subtree CAN recover)
//             'fullscreen' (last-resort cover, used at the very root)
//   resetKey  when it changes, the caught error is cleared — pass the route path
//             so navigating away recovers automatically.
//   lang      'ar' | 'en' for the primary line (both are always shown).
//   label     short context string folded into the report + dedupe key (e.g. the
//             route path), so the console can see WHICH screen crashed.
//   onReset   optional callback fired when the soft "try again" clears the error.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
    this.onReload = this.onReload.bind(this)
    this.onRetry = this.onRetry.bind(this)
  }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidCatch(err) {
    // A stale chunk self-heals with one reload; never report it or paint a card.
    if (isChunkError(err) && reloadOnceForStaleChunk()) return
    try {
      const label = this.props.label
      if (label && err && typeof err === 'object') {
        // Prefix the message with the screen so distinct screens dedupe/report
        // separately, without losing the original stack.
        reportBoundaryError({ message: `[${label}] ${err.message || err.code || err}`, code: err.code, stack: err.stack })
      } else {
        reportBoundaryError(err)
      }
    } catch (_) { /* the monitor must never itself break the boundary */ }
  }

  componentDidUpdate(prev) {
    // Navigating to another route (resetKey changes) clears the error, so one
    // broken screen never strands the whole session on the recovery card.
    if (this.state.err && prev.resetKey !== this.props.resetKey) {
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ err: null })
    }
  }

  onReload() {
    try { window.location.reload() } catch (_) { /* ignore */ }
  }

  onRetry() {
    // Soft isolation: drop the error and re-mount the subtree in place. Real for
    // a widget that can recover; a lazy route cannot (React marks a rejected
    // payload permanently and re-throws it), which is why route-level cards show
    // reload, not retry.
    this.setState({ err: null })
    try { this.props.onReset && this.props.onReset() } catch (_) { /* ignore */ }
  }

  render() {
    const { err } = this.state
    const { children, variant = 'route', lang = 'ar' } = this.props
    if (!err) return children

    const t = TXT[lang] || TXT.ar
    const s = styles(variant)
    const soft = variant === 'soft'

    return (
      <div style={s.wrap} role="alert" dir={lang === 'en' ? 'ltr' : 'rtl'}>
        <div style={s.card}>
          <WarnGlyph color={s.glyph} />
          <div dir="rtl" style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
            <strong style={s.title}>{TXT.ar.title}</strong>
            <p style={s.body}>{TXT.ar.body}</p>
          </div>
          <p dir="ltr" style={s.en}>{TXT.en.body}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBlockStart: 2 }}>
            {soft && (
              <button type="button" style={s.btnPrimary} onClick={this.onRetry}>
                {t.retry} · {TXT[lang === 'en' ? 'ar' : 'en'].retry}
              </button>
            )}
            <button type="button" style={soft ? s.btnGhost : s.btnPrimary} onClick={this.onReload}>
              {t.reload} · {TXT[lang === 'en' ? 'ar' : 'en'].reload}
            </button>
          </div>
        </div>
      </div>
    )
  }
}

// Convenience wrapper for isolating a single widget/subtree without covering the
// screen — import { SoftBoundary } and wrap the risky block.
export function SoftBoundary(props) {
  return <ErrorBoundary variant="soft" {...props} />
}
