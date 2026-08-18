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

// The service counter, drawn in white line-work along the foot of the board: a
// cup, the point-of-sale terminal, a cloche, a receipt, flatware — each standing
// on one continuous counter edge.
//
// Composed as a FRIEZE on purpose. A single centred scene cropped to a phone's
// width showed only severed fragments — a lamp with no ceiling, half a handle —
// which is exactly the arbitrary look this screen must not have. Evenly spaced
// objects on a shared baseline read as a complete counter at any crop, and the
// piece running off the edge implies the counter continues.
//
// Inline SVG: no request, no bitmap, crisp at every density, and it inherits the
// board's own colour. (Same approach as the ecosystem drawing on /login.)
function CounterScene() {
  return (
    <svg className="staff-entry-scene" viewBox="0 0 720 190" fill="none" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <g stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {/* the counter itself — the line everything shares */}
        <path d="M0 168 H720" />
        <path d="M0 182 H720" opacity="0.45" />
        {/* cup on a saucer */}
        <path d="M34 118 h48 v18 a24 24 0 0 1 -24 24 a24 24 0 0 1 -24 -24 z" />
        <path d="M82 126 h10 a12 12 0 0 1 0 24 h-3" />
        <path d="M22 168 h76" />
        <path d="M46 106 c7 -9 -7 -16 0 -25 M70 106 c7 -9 -7 -16 0 -25" opacity="0.5" />
        {/* point of sale */}
        <rect x="176" y="64" width="88" height="62" rx="8" />
        <path d="M190 82 h30 M190 96 h44 M190 110 h22" opacity="0.6" />
        <path d="M220 126 v22" />
        <path d="M194 168 h52 a9 9 0 0 0 -9 -14 h-34 a9 9 0 0 0 -9 14 z" />
        {/* cloche */}
        <path d="M334 168 a46 46 0 0 1 92 0 z" />
        <path d="M380 122 v-11" />
        {/* receipt */}
        <path d="M508 96 h64 v64 l-10 -8 -11 8 -11 -8 -11 8 -11 -8 -10 8 z" />
        <path d="M521 114 h38 M521 128 h26 M521 142 h32" opacity="0.6" />
        {/* flatware — runs off the edge, so the counter reads as continuing */}
        <path d="M682 88 v22 M690 88 v22 M698 88 v22 M682 110 h16 M690 110 v58" />
        <path d="M722 88 c9 7 9 26 0 28 v52" />
      </g>
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
        <CounterScene />
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
        <CounterScene />
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
