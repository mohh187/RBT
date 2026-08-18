// STAFF ENTRY (/app and /app/:slug) — the venue's own front door, fully
// separated from the marketing landing (owner decision: staff must NEVER see
// the landing page). This is the installed tablet app's start_url:
//   · live session            → /admin (the in-shell PIN lock takes over)
//   · known device, PIN on    → /lock (cold-start PIN sign-in)
//   · otherwise               → a venue-branded email login, zero marketing
//
// DESIGN — "the storefront sign" (2026-08-18). The top of the screen is a deep
// board painted in THE VENUE'S OWN brand colour, and the venue's logo sits on a
// plate straddling its lower edge, the way a real sign is mounted on a shopfront.
// Below the line is the calm working surface that holds the form. This is the
// single saturated moment in an otherwise neutral app, and because the colour,
// logo and display font all come from the tenant's own skin, every venue gets a
// visibly different front door from one implementation.
import { useEffect, useState } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { FullSpinner } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { LoginForm } from './Login.jsx'
import { getDeviceVenue, rememberDeviceVenue, forgetDevice } from '../lib/pin.js'
import { isPlatformHost, resolveHostVenue } from '../lib/domains.js'
import { applySkin, resolveSkin } from '../lib/skins.js'
import { RbtMark } from '../components/BrandMark.jsx'

// THE 360 CONSTELLATION, drawn in the brand's own vocabulary.
//
// The RBT mark is a network: filled nodes of varying radius joined by rounded
// links, carrying one gradient from vivid blue through violet to magenta
// (see BrandMark.jsx). This header is that same grammar opened out to a band and
// closed into a ring, so the platform's identity and the promise in its name are
// one drawing: nodes on a full circle, chords across it, and a signal that
// travels the loop without end, blooming each node as it arrives.
//
// It replaced line-art restaurant icons, which read as clip art and had to be
// cropped to fit. A closed ring has no meaningful crop, so it is drawn with
// `meet` and is complete at every width.
//
// MOTION BUDGET: only `opacity` and `stroke-dashoffset` animate. No `filter` is
// animated (blur is expensive and Safari especially so), so the bloom is a
// second static-blur circle whose opacity is what moves. One slow 9s loop, which
// at this frequency reads as ambient rather than busy, and it stops completely
// under prefers-reduced-motion.
//
// GEOMETRY CONTRACT: ring rx 228 / ry 88 about (280,130), circumference about
// 1042 user units. The comet's dasharray and the distance in the se-orbit-run
// keyframe both derive from that number, and the node delays are the period
// divided by the node count. Changing the ellipse means changing all three
// (see the .se-* block in index.css).
const RING = { cx: 280, cy: 130, rx: 228, ry: 88 }
// [angle°, radius] — radii vary the way the mark's do rather than sitting uniform
const ORBIT_NODES = [
  [270, 11], [315, 7], [0, 9], [45, 5.5],
  [90, 10.5], [135, 6.5], [180, 8], [225, 5],
]
const at = (deg) => [
  RING.cx + RING.rx * Math.cos((deg * Math.PI) / 180),
  RING.cy + RING.ry * Math.sin((deg * Math.PI) / 180),
]
// two chords, the mark's dumbbell gesture, so the ring reads as a network and
// not as a plain circle
const CHORDS = [[225, 45], [315, 135]]

function OrbitScene() {
  return (
    <svg className="staff-entry-scene" viewBox="0 0 560 260" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id="seGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2E62F6" />
          <stop offset="52%" stopColor="#7A3BEC" />
          <stop offset="100%" stopColor="#E0219E" />
        </linearGradient>
        <filter id="seBloom" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      {CHORDS.map(([a, b]) => {
        const [x1, y1] = at(a)
        const [x2, y2] = at(b)
        return <line key={`${a}-${b}`} className="se-chord" x1={x1} y1={y1} x2={x2} y2={y2} />
      })}

      <ellipse className="se-orbit" cx={RING.cx} cy={RING.cy} rx={RING.rx} ry={RING.ry} />
      <ellipse className="se-comet" cx={RING.cx} cy={RING.cy} rx={RING.rx} ry={RING.ry} />

      {ORBIT_NODES.map(([deg, r], i) => {
        const [x, y] = at(deg)
        return (
          <g key={deg} className="se-node" style={{ '--i': i }}>
            <circle className="se-node-bloom" cx={x} cy={y} r={r * 2.1} filter="url(#seBloom)" />
            <circle className="se-node-core" cx={x} cy={y} r={r} />
          </g>
        )
      })}

      {/* two free satellites, the mark's own loose dots */}
      <circle className="se-dot" cx="24" cy="54" r="4" />
      <circle className="se-dot" cx="538" cy="206" r="3.5" />
    </svg>
  )
}

// VENUE GATE — the very first screen a brand-new device shows.
//
// The installed app's start_url is /app on the PLATFORM host with no slug, so a
// fresh tablet has no way to know which venue it belongs to. This asks once, in
// RBT360's own purple, and REMEMBERS the answer on the device: from then on the
// tablet opens straight into that venue's own door (or its PIN pad), and nobody
// types a venue name again.
//
// It reuses the door's whole structure — board, plate, frieze, form — and only
// re-points `--brand` at the platform purple (see .staff-entry-gate in
// index.css). One token switches the identity, so the two screens can never
// drift apart, and entering a name visibly re-paints the SAME layout in the
// venue's colours.
function VenueGate({ onFound }) {
  const { lang, toggleLang, toggleTheme, theme } = useI18n()
  const ar = lang === 'ar'
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    // venue slugs are lowercase Latin; forgive the casing and stray spaces a
    // staffer typing on a tablet keyboard will produce
    const s = name.trim().toLowerCase().replace(/\s+/g, '')
    if (!s) return
    setBusy(true)
    setErr('')
    try {
      const map = await getDoc(doc(db, 'tenantSlugs', s))
      if (!map.exists()) {
        setErr(ar ? 'لا توجد منشأة بهذا الاسم. تأكّد من الكتابة وحاول مرة أخرى.' : 'No venue with that name. Check the spelling and try again.')
        return
      }
      const tid = map.data().tenantId
      const t = await getDoc(doc(db, 'tenants', tid))
      if (!t.exists()) {
        setErr(ar ? 'لا توجد منشأة بهذا الاسم. تأكّد من الكتابة وحاول مرة أخرى.' : 'No venue with that name. Check the spelling and try again.')
        return
      }
      onFound({ id: tid, slug: s, ...(t.data() || {}) })
    } catch (_) {
      setErr(ar ? 'ما قدرنا نوصل للخادم. تأكّد من اتصال الإنترنت وحاول مرة أخرى.' : 'Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="staff-entry staff-entry-gate">
      <div className="staff-entry-board">
        <OrbitScene />
        <div className="staff-entry-top">
          <span className="staff-entry-wordmark num" dir="ltr">RBT 360</span>
          <div className="staff-entry-tools">
            <button type="button" onClick={toggleLang} aria-label={ar ? 'English' : 'العربية'}>{ar ? 'EN' : 'ع'}</button>
            <button type="button" onClick={toggleTheme} aria-label={ar ? 'المظهر' : 'Theme'}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
            </button>
          </div>
        </div>
      </div>

      <div className="staff-entry-plate"><RbtMark size={46} /></div>

      <div className="staff-entry-body">
        <h1 className="staff-entry-name">{ar ? 'أدخل اسم المنشأة' : 'Enter your venue name'}</h1>
        <p className="staff-entry-sub">
          {ar ? 'مرة واحدة فقط، وسيتذكّرها هذا الجهاز' : 'Just once, then this device remembers it'}
        </p>
        <form className="staff-entry-form" onSubmit={submit}>
          <div className="rlauth-body">
            <div className="field">
              <label htmlFor="se-venue">{ar ? 'اسم المنشأة' : 'Venue name'}</label>
              {/* LTR on purpose: slugs are Latin, and an RTL field would put the
                  caret and the text on the wrong side while typing them */}
              <input
                id="se-venue"
                className="input"
                dir="ltr"
                value={name}
                onChange={(e) => { setName(e.target.value); if (err) setErr('') }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                autoComplete="off"
                autoFocus
                required
              />
              <span className="staff-entry-hint">
                {ar ? 'الاسم المختصر الظاهر في رابط منيو المنشأة' : 'The short name in your menu link'}
              </span>
            </div>
            {err && <p className="staff-entry-err"><Icon name="warning" size={15} />{err}</p>}
            <button className="rlauth-submit" disabled={busy || !name.trim()}>
              {busy ? (ar ? 'جارٍ البحث…' : 'Checking…') : (ar ? 'متابعة' : 'Continue')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function StaffEntry() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { lang, toggleLang, toggleTheme, theme } = useI18n()
  const ar = lang === 'ar'
  const { user, tenantId, loading, isPlatformAdmin } = useAuth()
  const deviceVenue = getDeviceVenue()
  // venue branding: slug param → host venue → the device's remembered venue
  const [venue, setVenue] = useState(() => (deviceVenue ? { name: deviceVenue.name, logoUrl: deviceVenue.logoUrl } : null))
  const [resolving, setResolving] = useState(!!slug || !isPlatformHost())

  useEffect(() => {
    let alive = true
    const done = (v) => { if (alive) { if (v) setVenue(v); setResolving(false) } }
    const fromTid = async (tid) => {
      try {
        const t = await getDoc(doc(db, 'tenants', tid))
        if (!t.exists()) return null
        const data = t.data() || {}
        // Paint the door in the venue's own colours. applyMode is OFF on
        // purpose: the light/dark choice belongs to whoever is holding the
        // device (the toggle above), not to the venue's admin skin.
        try { applySkin(resolveSkin(data, 'admin'), { applyMode: false }) } catch (_) { /* default skin */ }
        return { name: data.name || '', logoUrl: data.logoUrl || '' }
      } catch (_) { return null }
    }
    if (slug) {
      getDoc(doc(db, 'tenantSlugs', slug))
        .then((s) => (s.exists() ? fromTid(s.data().tenantId) : null))
        .then(done)
        .catch(() => done(null))
    } else if (!isPlatformHost()) {
      resolveHostVenue()
        .then((v) => (v?.tenantId ? fromTid(v.tenantId) : (v?.id ? fromTid(v.id) : null)))
        .then(done)
        .catch(() => done(null))
    } else if (deviceVenue?.tid) {
      // THE INSTALLED APP LANDS HERE. Its start_url is /app on the PLATFORM host
      // (twa-manifest: host rbt360sa.com, startUrl /app), so neither the slug nor
      // the host branch can fire — and without this the tablet showed the venue's
      // cached NAME and LOGO on the platform's navy board, because the skin is
      // only applied inside fromTid. The cache carries the tenant id, so resolve
      // it and the door gets the venue's real colour and display font too.
      fromTid(deviceVenue.tid).then(done).catch(() => done(null))
    } else {
      done(null)
    }
    return () => { alive = false }
  }, [slug])

  if (loading) return <FullSpinner />
  if (user && tenantId) return <Navigate to="/admin" replace />
  if (user) return <Navigate to={isPlatformAdmin ? '/platform' : '/onboarding'} replace />
  // a tablet this venue already uses goes straight to the PIN pad — but only
  // when the URL's slug IS that venue: /app/venue-b typed on a tablet that
  // remembers venue A must show B's entry, not silently open A's lock screen
  if (deviceVenue?.tid && deviceVenue?.pinLock?.enabled && (!slug || deviceVenue?.slug === slug)) return <Navigate to="/lock" replace />
  if (resolving) return <FullSpinner />

  // Nothing identifies a venue — not the URL, not the host, not this device.
  // Ask once, then never again. A venue whose PIN lock is on goes STRAIGHT to
  // the pad: the staffer signs in with their own PIN and no one ever types an
  // email on this tablet.
  if (!venue) {
    return (
      <VenueGate
        onFound={(t) => {
          rememberDeviceVenue(t)
          try { applySkin(resolveSkin(t, 'admin'), { applyMode: false }) } catch (_) { /* default skin */ }
          navigate(t.pinLock?.enabled ? '/lock' : `/app/${t.slug}`, { replace: true })
        }}
      />
    )
  }

  return (
    <div className="staff-entry">
      <div className="staff-entry-board">
        <OrbitScene />
        <div className="staff-entry-top">
          <span className="staff-entry-wordmark num" dir="ltr">RBT 360</span>
          <div className="staff-entry-tools">
            <button onClick={toggleLang} aria-label={ar ? 'English' : 'العربية'}>{ar ? 'EN' : 'ع'}</button>
            <button onClick={toggleTheme} aria-label={ar ? 'المظهر' : 'Theme'}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
            </button>
          </div>
        </div>
      </div>

      <div className="staff-entry-plate">
        {venue?.logoUrl
          ? <img src={venue.logoUrl} alt="" />
          : <Icon name="store" size={34} />}
      </div>

      <div className="staff-entry-body">
        <h1 className="staff-entry-name">{venue?.name || (ar ? 'بوابة الفريق' : 'Team access')}</h1>
        <p className="staff-entry-sub">
          {venue?.name
            ? (ar ? 'سجّل دخولك لبدء الوردية' : 'Sign in to start your shift')
            : (ar ? 'سجّل دخولك للمتابعة' : 'Sign in to continue')}
        </p>
        <div className="staff-entry-form">
          <LoginForm onDone={() => navigate('/admin', { replace: true })} />
        </div>
        {/* the way back out: a device bound to the wrong venue (a typo at the
            gate) must not be a dead end */}
        <button type="button" className="staff-entry-switch" onClick={() => { forgetDevice(); navigate('/app', { replace: true }) }}>
          {ar ? 'منشأة أخرى' : 'Use a different venue'}
        </button>
      </div>
    </div>
  )
}
