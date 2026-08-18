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

// THE BOARD. One unbroken line crosses the whole header, and the six stations a
// venue runs on are not objects sitting ON that line: they ARE the line. It
// arrives at a station, draws that station's own outline all the way round,
// comes back over the top and leaves, on to the next. No frames, no boxes; the
// icon and the wire are the same stroke.
//
// HOW THE WRAP IS BUILT. Each station is a closed polygon written as a left
// gate, the vertices over the top to a right gate, and the vertices back under.
// The traversal is L over the top to R, under and back to L, then over the top
// to R again and out. The second pass over the top retraces a line already
// drawn, so it is invisible, and it is what lets the signal complete a FULL
// circuit of the shape and still leave on the far side without a chord cutting
// across the icon.
//
// WHY IT IS COMPUTED. The stations are not equally spaced along the line (the
// diagonals between rows and the wraps themselves add length), so splitting the
// lap evenly across six lit them in the wrong places. The builder walks the
// polyline, sums real arc length, and hands each station the fraction of the lap
// where ITS OWN wrap begins; the CSS turns that into an animation-delay. Move a
// station, redraw an icon, and the timing follows by itself.
//
// FITTING: the viewBox is about 3:1, deliberately between a phone board (~1.4:1)
// and a desktop one (~6:1), so `slice` never zooms hard either way. Everything
// lives inside y 120..250, clear of the crop a wide screen takes and clear of
// the logo plate below.
//
// MOTION BUDGET: only `stroke-dashoffset` and `opacity` animate, never `filter`
// (a repaint per frame, worst on Safari), so a station's glow is a pre-blurred
// circle whose opacity moves. `pathLength="1000"` normalises the line so the
// dash numbers survive any edit. All of it stops under prefers-reduced-motion.
const ROW_HI = 150
const ROW_LO = 208
const RETURN_DY = 14

// Each station: `top` runs from the left gate over to the right gate, `bot` runs
// back underneath. Gates sit on the station's own centre line so the wire meets
// the shape head on. `detail` is drawn separately and is never part of the wire.
const STATIONS = [
  {
    k: 'cup', x: 74, row: ROW_LO, gate: [-16, 19],
    top: [[-14, -12], [10, -12], [17, -7]],
    bot: [[14, 6], [9, 8], [7, 14], [-11, 14], [-15, 7]],
    detail: 'M-19 18 h30 M-6 -19 c5 -5 -4 -9 0 -15',
  },
  {
    k: 'pos', x: 286, row: ROW_HI, gate: [-16, 16],
    top: [[-16, -14], [16, -14]],
    bot: [[5, 1], [4, 9], [13, 9], [15, 15], [-15, 15], [-13, 9], [-4, 9], [-5, 1]],
    detail: 'M-9 -9 h11 M-9 -4 h16',
  },
  {
    k: 'kitchen', x: 498, row: ROW_LO, gate: [-15, 15],
    top: [[-13, -9], [-7, -16], [0, -18], [7, -16], [13, -9]],
    bot: [[13, 5], [13, 14], [-13, 14], [-13, 5]],
    detail: 'M-13 5 h26',
  },
  {
    k: 'phone', x: 710, row: ROW_HI, gate: [-11, 11],
    top: [[-11, -16], [-8, -19], [8, -19], [11, -16]],
    bot: [[11, 16], [8, 19], [-8, 19], [-11, 16]],
    detail: 'M-4 -15 h8 M-5 15 h10',
  },
  {
    k: 'bill', x: 922, row: ROW_LO, gate: [-11, 11],
    top: [[-11, -15], [11, -15]],
    bot: [[11, 15], [6, 11], [2, 15], [-2, 11], [-6, 15], [-11, 11]],
    detail: 'M-5 -8 h11 M-5 -2 h7',
  },
  {
    k: 'bell', x: 1092, row: ROW_HI, gate: [-16, 16],
    top: [[-13, -6], [-8, -13], [0, -16], [8, -13], [13, -6]],
    bot: [[13, 6], [-13, 6]],
    detail: 'M0 -16 v-6 M-8 12 h16',
  },
]

function buildBoard() {
  const pts = [[-80, STATIONS[0].row]]
  const wrapStart = []
  STATIONS.forEach((s, i) => {
    const [gl, gr] = s.gate
    const L = [s.x + gl, s.row]
    const R = [s.x + gr, s.row]
    const top = s.top.map(([dx, dy]) => [s.x + dx, s.row + dy])
    const bot = s.bot.map(([dx, dy]) => [s.x + dx, s.row + dy])
    pts.push(L)
    wrapStart.push(pts.length - 1)
    // L over the top to R, back under to L, then over the top again and out:
    // the repeat retraces a drawn line, so the wrap reads as one full circuit.
    top.forEach((p) => pts.push(p))
    pts.push(R)
    bot.forEach((p) => pts.push(p))
    pts.push(L)
    top.forEach((p) => pts.push(p))
    pts.push(R)
    const n = STATIONS[i + 1]
    if (!n) return
    const dh = Math.abs(n.row - s.row) / 2
    const mid = (s.x + n.x) / 2
    pts.push([mid - dh, s.row])
    pts.push([mid + dh, n.row])
  })
  const last = STATIONS[STATIONS.length - 1]
  pts.push([last.x + 110, last.row])

  const cum = [0]
  for (let i = 1; i < pts.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  }
  const total = cum[cum.length - 1] || 1
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')

  // the dashed return line and its rungs decorate ONLY the straight runs between
  // stations, never a wrap, or the icons would sit in a thicket
  const near = (x) => STATIONS.some((s) => x > s.x + s.gate[0] - 3 && x < s.x + s.gate[1] + 3)
  const segs = []
  const rungs = []
  const vias = []
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    if (near(ax) || near(bx)) continue
    segs.push(`M${ax} ${ay + RETURN_DY} L${bx} ${by + RETURN_DY}`)
    if (ay !== by) { vias.push(pts[i - 1], pts[i]); continue }
    for (let x = Math.min(ax, bx) + 20; x < Math.max(ax, bx) - 14; x += 28) rungs.push(`M${x} ${ay} l5 ${RETURN_DY}`)
  }

  return { d, dReturn: segs.join(' '), rungs: rungs.join(' '), vias, fracs: wrapStart.map((i) => cum[i] / total) }
}

const BOARD = buildBoard()

function OrbitScene() {
  return (
    <svg className="staff-entry-scene" viewBox="0 0 1120 360" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="seGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#2E62F6" />
          <stop offset="52%" stopColor="#7A3BEC" />
          <stop offset="100%" stopColor="#E0219E" />
        </linearGradient>
        <filter id="seBloom" x="-160%" y="-160%" width="420%" height="420%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>

      {STATIONS.map((s, i) => (
        <circle key={`b${s.k}`} className="se-chip-bloom" cx={s.x} cy={s.row} r="21"
          filter="url(#seBloom)" style={{ '--lit': BOARD.fracs[i] }} />
      ))}

      <path className="se-return" d={BOARD.dReturn} />
      <path className="se-rung" d={BOARD.rungs} />
      {BOARD.vias.map(([x, y], i) => <circle key={`v${i}`} className="se-via" cx={x} cy={y} r="2.8" />)}

      {/* the wire IS the icons */}
      <path className="se-trace" d={BOARD.d} />
      {STATIONS.map((s, i) => (
        <path key={`d${s.k}`} className="se-chip-detail" d={s.detail}
          style={{ '--lit': BOARD.fracs[i] }} transform={`translate(${s.x} ${s.row})`} />
      ))}
      {/* the signal, built as three stacked strokes rather than a blur:
          a wide faint halo, a mid glow, and a thin bright core. A filter would
          have to re-render every frame; stacked strokes cost nothing and give
          the same soft edge the logo's own links have. */}
      <path className="se-comet se-comet-halo" d={BOARD.d} pathLength="1000" />
      <path className="se-comet se-comet-mid" d={BOARD.d} pathLength="1000" />
      <path className="se-comet se-comet-core" d={BOARD.d} pathLength="1000" />
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
