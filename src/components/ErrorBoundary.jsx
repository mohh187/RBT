import { Component, lazy, useEffect, useState } from 'react'
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
//      no longer exists the moment it lazy-loads its next route. The cure is
//      ONE reload to fetch the fresh index.html + module graph — self-healed
//      with a throttled reload, HARD-CAPPED at 2 per session; past the cap the
//      quiet update card renders with a manual button (never a reload loop).
//   2. A genuine render error. No reload fixes a real bug, so we show a
//      bilingual recovery card and report it to the platform monitor (render
//      errors never reach window.onerror). At the route level the card is
//      inline so the app shell survives; as the last resort in main.jsx it
//      covers the screen.
// ---------------------------------------------------------------------------

// A chunk failure that FAILED TO FETCH. These are the textbook signatures.
//
// DELIBERATELY ABSENT: bare `Failed to fetch` (Chrome) and `Load failed`
// (Safari). Those are the generic TypeError texts for ANY failed fetch() —
// a Firestore stream, a Storage image, an API call — not just module loads.
// Matching them classified ordinary network hiccups as "stale deploy" and
// converted them into silent page reloads (with the old re-arm timer, into a
// 30-second reload LOOP — the reported «تنكسر وتحدث من جديد»). Every real
// dynamic-import failure carries an import-specific phrase on every engine:
//   Chrome/Edge  "Failed to fetch dynamically imported module"
//   Safari       "Importing a module script failed"
//   Firefox      "error loading dynamically imported module"
// so dropping the generic forms loses nothing.
const CHUNK_RE = /Loading chunk|Loading CSS chunk|dynamically imported module|error loading dynamically|Importing a module script failed|css chunk/i

// A chunk failure that SUCCEEDED, and that is the whole problem.
//
// firebase.json rewrites `**` to /index.html. So a tab holding a pre-deploy
// URL like /assets/Screens-OLDHASH.js does not get a 404 — it gets index.html
// with a 200. The fetch succeeds, `vite:preloadError` never fires, and none of
// the phrases above ever appear. The failure surfaces one layer later, in one
// of two shapes depending on how far the browser got parsing HTML as ESM:
//
//   1. Parse died on the doctype     → SyntaxError "Unexpected token '<'"
//   2. Parse produced an empty module → React.lazy reads `.default` of
//      undefined → TypeError, phrased differently per engine:
//        Chrome/Edge  Cannot read properties of undefined (reading 'default')
//        Safari       undefined is not an object (evaluating '….default')
//        Firefox      can't access property "default", … is undefined
//
// Both are stale-chunk tells, not app bugs: `.default` is module-interop
// vocabulary that application code effectively never reads, and a lone `<` is
// not valid JavaScript anywhere. Treating them as stale is a judgement, so it
// is bounded by the same throttle as every other path here — a wrong guess
// costs exactly one reload, never a loop.
// NOTE the `undefined` in the first alternative. An earlier draft matched any
// `reading 'default'`, which also swallowed `Cannot read properties of NULL
// (reading 'default')` — a genuine application bug that would then have been
// "fixed" by a reload and never reported. A missing module is always
// `undefined`; `null` is something our own code did.
const STALE_MODULE_RE = /Unexpected token '<'|properties of undefined \(reading '(default|then)'\)|undefined is not an object \(evaluating '[^']*\.(default|then)'\)|can't access property "(default|then)", [^,]* is undefined/i

export function isChunkError(err) {
  const msg = String((err && err.message) || err || '')
  return CHUNK_RE.test(msg) || STALE_MODULE_RE.test(msg)
}

// The PRIMARY stale-chunk defence — and the only one that checks a fact instead
// of matching a sentence.
//
// React.lazy requires its factory to resolve to a module carrying a `default`
// export. When hosting answers a deleted chunk URL with index.html (200,
// text/html — verified against production, not assumed), the import either dies
// parsing `<` or resolves to a module with no exports at all. Asking "does this
// have a default export?" catches BOTH, on every engine, without needing to
// know how that engine words its error. The regexes above stay as the net for
// failures that never reach this function.
//
// Use for every code-split route: `lazyRoute(() => import('./X.jsx'))`.
export function lazyRoute(factory) {
  return lazy(() => factory().then((m) => {
    if (m && m.default) return m
    reloadOnceForStaleChunk()
    // Throw anyway. If the reload was throttled — a real outage rather than a
    // deploy — the boundary must show its recovery card rather than leave the
    // route suspended forever on a promise that already settled. The wording is
    // deliberate: it matches CHUNK_RE, so every downstream handler agrees on
    // what this is.
    throw new Error('Loading chunk failed: module resolved without a default export')
  }))
}

// Throttled + CAPPED reload, shared at module scope so nested boundaries and
// the vite:preloadError listener in main.jsx can't double-reload.
//
// Two independent guards:
//   · 30s throttle — bursts of chunk errors right after a reload count as one.
//   · HARD CAP of 2 automatic reloads per tab session (sessionStorage counter
//     survives the reloads themselves). One reload refreshes the entire module
//     graph; needing a third in the same session means reloading is NOT the
//     cure — from then on the quiet «يجري تحديث النسخة» card renders with its
//     manual button, and a reload loop is structurally impossible.
const RELOAD_KEY = 'ml.chunk.reload.at'
const RELOAD_N_KEY = 'ml.chunk.reload.n'
const RELOAD_WINDOW = 30000
const RELOAD_MAX = 2
export function reloadOnceForStaleChunk() {
  let last = 0
  let n = 0
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    n = Number(sessionStorage.getItem(RELOAD_N_KEY) || 0)
  } catch (_) { /* ignore */ }
  if (n >= RELOAD_MAX) return false
  if (Date.now() - last < RELOAD_WINDOW) return false
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    sessionStorage.setItem(RELOAD_N_KEY, String(n + 1))
  } catch (_) { /* ignore */ }
  try { window.location.reload() } catch (_) { /* ignore */ }
  return true
}

// Has the session cap been spent? A capped chunk error is no longer routine
// self-healing — it is a recurring failure wearing a chunk costume, and the
// one case on this path worth reporting to /platform/health.
function chunkReloadsExhausted() {
  try { return Number(sessionStorage.getItem(RELOAD_N_KEY) || 0) >= RELOAD_MAX } catch (_) { return false }
}

// The last crash, kept for one session so it can be read after the fact.
//
// A guest is not going to press «نسخ التفاصيل» and send it — they press Reload
// and move on, and the evidence is gone. Stashing the message and the component
// stack means the next person to open the console (or the /platform/health page)
// can still see what actually threw, which is the difference between fixing the
// cause and guessing at it.
const LAST_ERR_KEY = 'ml.lastError'
export function readLastBoundaryError() {
  try { return JSON.parse(sessionStorage.getItem(LAST_ERR_KEY) || 'null') } catch (_) { return null }
}

const TXT = {
  ar: {
    title: 'حدث خلل غير متوقع',
    body: 'جرّب تحديث الصفحة — إن تكرر الخلل فسيصل تقريره لنا تلقائياً.',
    reload: 'حدّث',
    retry: 'إعادة المحاولة',
    // Deploy-moved files: not a fault, and already self-healing.
    staleTitle: 'يجري تحديث النسخة',
    staleBody: 'صدر تحديث للنظام أثناء فتحك للصفحة — تُحمَّل النسخة الجديدة الآن.',
  },
  en: {
    title: 'Something went wrong',
    body: 'Refreshing usually fixes it. A report reaches us automatically.',
    reload: 'Reload',
    retry: 'Try again',
    staleTitle: 'Updating',
    staleBody: 'A new version shipped while this page was open. Loading it now.',
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
    this.state = { err: null, stale: false, componentStack: '', copied: false }
    this.onReload = this.onReload.bind(this)
    this.onRetry = this.onRetry.bind(this)
    this.onCopy = this.onCopy.bind(this)
  }

  onCopy() {
    const { err, componentStack } = this.state
    const text = [
      `message: ${(err && (err.message || err.code)) || String(err || '')}`,
      `screen:  ${this.props.label || '-'}`,
      `url:     ${(() => { try { return location.href } catch (_) { return '-' } })()}`,
      `ua:      ${(() => { try { return navigator.userAgent } catch (_) { return '-' } })()}`,
      '',
      'stack:',
      (err && err.stack) || '(none)',
      '',
      'component stack:',
      componentStack || '(none)',
    ].join('\n')
    const done = () => { this.setState({ copied: true }) }
    try {
      // The clipboard API is unavailable on insecure origins and inside some
      // in-app browsers — which is exactly where a diner hits this. Fall back to
      // the old selection trick rather than leaving the button dead.
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => this.copyFallback(text, done))
      } else {
        this.copyFallback(text, done)
      }
    } catch (_) { this.copyFallback(text, done) }
  }

  copyFallback(text, done) {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      done()
    } catch (_) { /* nothing more to try; the monitor still has it */ }
  }

  static getDerivedStateFromError(err) {
    // A stale chunk is classified HERE, in the same commit that records the
    // error, so render() can never paint the alarming recovery card for what is
    // really just a deploy that moved the files.
    return { err, stale: isChunkError(err) }
  }

  // REACT'S SECOND ARGUMENT IS THE DIAGNOSIS, and this used to drop it.
  //
  // `info.componentStack` is the chain of components that owned the throwing
  // render. Without it, a minified production stack for a render crash is
  // almost entirely React internals — you learn that a hook failed, never which
  // component's. That is fatal for errors whose text is identical across every
  // possible cause: "Cannot read properties of null (reading 'useState')" is
  // what React throws whenever the dispatcher is null, and the dispatcher is
  // null for half a dozen unrelated reasons. The component stack is the only
  // thing that separates them.
  componentDidCatch(err, info) {
    // A stale chunk self-heals with a capped reload; no alarming card either way.
    //
    // When the reload is blocked (throttle window or the 2-per-session cap),
    // we DELIBERATELY do nothing more here: getDerivedStateFromError already
    // set `stale: true`, so render() paints the quiet «يجري تحديث النسخة» card
    // with its manual reload button. An earlier version re-armed a timer to
    // reload again after the throttle window — combined with the then-broad
    // CHUNK_RE that matched any 'Failed to fetch', a recurring NON-chunk error
    // became a silent permanent 30-second reload loop. The timer is gone for
    // good; past the cap the user always gets a visible card, never a loop.
    // Only ROUTE-LEVEL boundaries may convert a chunk-shaped error into a page
    // reload. A 'soft' widget or 'silent' ambient boundary reloading the page
    // would destroy the diner's in-progress cart over a failure the guest was
    // never even meant to see — those variants fall through to their own
    // rendering (compact card / nothing) and report like any other error.
    const variant = this.props.variant || 'route'
    if ((variant === 'route' || variant === 'fullscreen') && isChunkError(err)) {
      if (!reloadOnceForStaleChunk() && chunkReloadsExhausted()) {
        // A third chunk-shaped failure in one session is not a deploy — report
        // it once so /platform/health sees what keeps failing.
        try {
          reportBoundaryError(
            { message: `[chunk-loop] ${(err && (err.message || err.code)) || String(err || '')}`, stack: err && err.stack },
            (info && info.componentStack) || '',
          )
        } catch (_) { /* the monitor must never itself break the boundary */ }
      }
      return
    }
    const componentStack = (info && info.componentStack) || ''
    this.setState({ componentStack })
    // Keep the evidence for the session even if nobody presses «نسخ التفاصيل».
    try {
      sessionStorage.setItem(LAST_ERR_KEY, JSON.stringify({
        at: new Date().toISOString(),
        message: (err && (err.message || err.code)) || String(err || ''),
        screen: this.props.label || '',
        url: (() => { try { return location.href } catch (_) { return '' } })(),
        stack: (err && err.stack) || '',
        componentStack,
      }))
    } catch (_) { /* storage full or blocked — the monitor still has it */ }
    try {
      const label = this.props.label
      if (label && err && typeof err === 'object') {
        // Prefix the message with the screen so distinct screens dedupe/report
        // separately, without losing the original stack.
        reportBoundaryError({ message: `[${label}] ${err.message || err.code || err}`, code: err.code, stack: err.stack }, componentStack)
      } else {
        reportBoundaryError(err, componentStack)
      }
    } catch (_) { /* the monitor must never itself break the boundary */ }
  }

  componentDidUpdate(prev) {
    // Navigating to another route (resetKey changes) clears the error, so one
    // broken screen never strands the whole session on the recovery card.
    // Guarded by the condition above, which is the sanctioned form of
    // setState-in-componentDidUpdate. (There used to be a disable comment for
    // react/no-did-update-set-state here, but eslint-plugin-react is not in
    // this config, and a disable naming an unknown rule is itself an error.)
    if (this.state.err && prev.resetKey !== this.props.resetKey) {
      this.setState({ err: null, stale: false, componentStack: '', copied: false })
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
    this.setState({ err: null, stale: false, componentStack: '', copied: false })
    try { this.props.onReset && this.props.onReset() } catch (_) { /* ignore */ }
  }

  render() {
    const { err, stale } = this.state
    const { children, variant = 'route', lang = 'ar' } = this.props
    if (!err) return children

    // 'silent': an ambient widget (ad popup, venue memory) that crashed simply
    // disappears — reported to the monitor above, but never painted as a card
    // inside the guest menu.
    if (variant === 'silent') return null

    const t = TXT[lang] || TXT.ar
    const s = styles(variant)
    const soft = variant === 'soft'

    // A moved file after a deploy is not a fault the guest should be alarmed by,
    // and it is about to fix itself. Say only that, and say it quietly.
    if (stale) {
      return (
        <div style={{ ...s.wrap, minHeight: soft ? 0 : '40dvh' }} role="status" dir="rtl">
          <div style={{ ...s.card, gap: 8 }}>
            <strong style={s.title}>{TXT.ar.staleTitle}</strong>
            <p style={s.body}>{TXT.ar.staleBody}</p>
            <p dir="ltr" style={s.en}>{TXT.en.staleBody}</p>
            <button type="button" style={s.btnPrimary} onClick={this.onReload}>
              {t.reload} · {TXT[lang === 'en' ? 'ar' : 'en'].reload}
            </button>
          </div>
        </div>
      )
    }

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
            {/* A screenshot of this card carries no diagnosis — every render
                crash paints exactly the same words. One tap puts the message,
                the stack and the component chain on the clipboard, which is
                the difference between "it crashed" and knowing which component
                did it. Reported to the monitor too, but a staff member who
                cannot reach /platform/health can just paste this. */}
            <button type="button" style={s.btnGhost} onClick={this.onCopy}>
              {this.state.copied ? 'تم النسخ · Copied' : 'نسخ التفاصيل · Copy details'}
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

// ---------------------------------------------------------------------------
// lazyOverlay() — the lazy loader for OVERLAY features (games hub, voice
// waiter, AR, compare, wrapped…), and the reason it is NOT React.lazy:
//
//   1. React.lazy caches a REJECTED import forever — the only recovery is a
//      page navigation or reload. An overlay is a bonus feature; its chunk
//      failing to arrive (offline blip, stale deploy) must cost a small retry
//      card INSIDE the overlay, never the page.
//   2. A rejected lazy() propagates through Suspense to the route boundary.
//      Before this helper, the games tab used raw lazy() + fallback={null}:
//      the rejection bubbled up, matched the chunk classifier, and RELOADED
//      the whole page — the reported «الضغط على الألعاب يعيد تحميل الصفحة».
//   3. fallback={null} also meant zero feedback while a 100kB+ chunk loaded.
//
// So this is a stateful loader: it absorbs the import promise entirely (one
// silent retry after 800ms), shows an immediate shimmer, renders an inline
// bilingual retry card on failure, and wraps the loaded component in a
// SoftBoundary so even a crash INSIDE the overlay stays inside the overlay.
// The loaded component is cached per factory (module scope) so reopening an
// overlay never refetches or flickers. StrictMode-safe: the effect is
// idempotent and guards setState-after-unmount with `on`.
// ---------------------------------------------------------------------------
function OverlaySpin({ size = 30, tone = '#ffffff' }) {
  // SMIL-animated so it spins with zero CSS dependencies (this file must render
  // even when the stylesheet is the thing that failed).
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke={tone} strokeOpacity="0.22" strokeWidth="2.4" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke={tone} strokeWidth="2.4" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
      </path>
    </svg>
  )
}

function OverlayShimmer({ variant, onClose }) {
  // 'silent': ambient self-deciding widgets (ad popup, venue memory) rendered
  // eagerly in the page flow — they must never flash a spinner or scrim into
  // the guest menu; parity with the old fallback={null}, minus the crash.
  if (variant === 'silent') return null
  if (variant === 'inline') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', padding: '38px 16px' }} role="status" aria-label="loading">
        <OverlaySpin tone="var(--text-muted, #8a8a94)" />
      </div>
    )
  }
  // 'scrim': instant full-screen feedback where the overlay is about to appear.
  // Tapping it cancels (calls onClose) so a slow network never traps the user.
  return (
    <div
      role="status"
      aria-label="loading"
      onClick={() => { try { onClose && onClose() } catch (_) { /* ignore */ } }}
      style={{ position: 'fixed', inset: 0, zIndex: 1300, display: 'grid', placeItems: 'center', background: 'rgba(8, 9, 12, 0.45)' }}
    >
      <OverlaySpin size={36} />
    </div>
  )
}

function OverlayLoadFail({ variant, onRetry, onClose }) {
  // An ambient widget failing to load is a non-event — its whole contract is
  // "appear only when there is something to show". Fail silently.
  if (variant === 'silent') return null
  const card = (
    <div dir="rtl" style={{ maxWidth: 340, textAlign: 'center', display: 'grid', gap: 10, justifyItems: 'center', padding: '22px 20px', borderRadius: 16, background: '#16171c', color: '#f5f6f8', border: '1px solid rgba(255,255,255,0.12)' }}>
      <WarnGlyph color="#f5b74e" />
      <strong style={{ fontSize: 15.5, fontWeight: 800 }}>تعذّر تحميل هذه الميزة</strong>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, opacity: 0.75 }}>تحقّق من الاتصال ثم أعد المحاولة.</p>
      <p dir="ltr" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, opacity: 0.55 }}>This feature failed to load. Check the connection and retry.</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button type="button" onClick={onRetry} style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid transparent', background: 'rgba(255,255,255,0.14)', color: 'inherit', font: 'inherit', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
          إعادة المحاولة · Retry
        </button>
        {onClose && (
          <button type="button" onClick={onClose} style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.16)', background: 'transparent', color: 'inherit', font: 'inherit', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: 0.85 }}>
            إغلاق · Close
          </button>
        )}
      </div>
    </div>
  )
  if (variant === 'inline') {
    return <div style={{ display: 'grid', placeItems: 'center', padding: '26px 14px' }}>{card}</div>
  }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1300, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(8, 9, 12, 0.55)' }}>
      {card}
    </div>
  )
}

export function lazyOverlay(factory, { label = 'overlay', variant = 'scrim' } = {}) {
  let Cached = null // per-factory: survives close/reopen, shared by all mounts
  function Overlay(props) {
    const [Comp, setComp] = useState(() => Cached)
    const [failed, setFailed] = useState(false)
    useEffect(() => {
      if (Comp || failed) return undefined
      let on = true
      factory()
        .catch(() => new Promise((res) => setTimeout(res, 800)).then(factory)) // one silent retry
        .then((m) => {
          if (!on) return
          if (m && m.default) { Cached = m.default; setComp(() => m.default) }
          else setFailed(true)
        })
        .catch(() => { if (on) setFailed(true) })
      return () => { on = false }
    }, [Comp, failed])
    // Some overlays close via onExit rather than onClose (game boards, lobby)
    const onClose = typeof props.onClose === 'function' ? props.onClose
      : typeof props.onExit === 'function' ? props.onExit : null
    if (Comp) {
      return (
        <ErrorBoundary variant={variant === 'silent' ? 'silent' : 'soft'} label={label}>
          <Comp {...props} />
        </ErrorBoundary>
      )
    }
    // A permanently-MOUNTED overlay driven by an `open` prop (NotificationSettings
    // stays mounted for its close animation) must not paint the scrim/fail card
    // while it is closed — without this, a failed load became an undismissable
    // full-screen scrim: onClose set open=false but the component stayed mounted.
    if (props.open === false) return null
    if (failed) return <OverlayLoadFail variant={variant} onRetry={() => setFailed(false)} onClose={onClose} />
    return <OverlayShimmer variant={variant} onClose={onClose} />
  }
  Overlay.displayName = `lazyOverlay(${label})`
  return Overlay
}
