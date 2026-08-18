// STAFF ENTRY (/app and /app/:slug) — the venue's own front door, fully
// separated from the marketing landing (owner decision: staff must NEVER see
// the landing page). This is the installed tablet app's start_url:
//   · live session            → /admin (the in-shell PIN lock takes over)
//   · known device, PIN on    → /lock (cold-start PIN sign-in)
//   · otherwise               → a venue-branded email login, zero marketing
import { useEffect, useState } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { FullSpinner } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { LoginForm } from './Login.jsx'
import { getDeviceVenue } from '../lib/pin.js'
import { isPlatformHost, resolveHostVenue } from '../lib/domains.js'

export default function StaffEntry() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { lang, toggleTheme, theme } = useI18n()
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
        return t.exists() ? { name: t.data().name || '', logoUrl: t.data().logoUrl || '' } : null
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

  return (
    <div className="staff-entry">
      <button className="icon-btn staff-entry-theme" onClick={toggleTheme} aria-label="theme">
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
      </button>
      <div className="staff-entry-card">
        {venue?.logoUrl
          ? <img className="staff-entry-logo" src={venue.logoUrl} alt="" />
          : <span className="staff-entry-logo staff-entry-logo-ph"><Icon name="store" size={30} /></span>}
        <h1 className="staff-entry-name">{venue?.name || (ar ? 'بوابة فريق العمل' : 'Team portal')}</h1>
        <p className="staff-entry-sub">{ar ? 'بوابة فريق العمل — سجّل الدخول' : 'Staff portal — sign in'}</p>
        <LoginForm onDone={() => navigate('/admin', { replace: true })} />
      </div>
      <p className="staff-entry-powered num" dir="ltr">RBT360</p>
    </div>
  )
}
