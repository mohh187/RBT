import { useState } from 'react'
import { Link, useNavigate, Navigate } from 'react-router-dom'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../lib/firebase.js'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import AuthShell, { PasswordInput } from '../components/AuthShell.jsx'
import { FullSpinner } from '../components/ui.jsx'
import { authErrorMessage } from '../lib/authErrors.js'
import { getDeviceVenue } from '../lib/pin.js'
import Icon from '../components/Icon.jsx'

// The email/password form alone — shared between the marketing-site /login and
// the venue-branded staff entry (/app, routes/StaffEntry.jsx). One place owns
// the submit + forgot-password behavior.
export function LoginForm({ onDone }) {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [resetMsg, setResetMsg] = useState('')

  // Forgot password: uses the email already typed in the field above.
  const forgot = async () => {
    setErr(''); setResetMsg('')
    const em = email.trim()
    if (!em) { setErr(ar ? 'اكتب بريدك الإلكتروني أولاً ثم اضغط «نسيت كلمة المرور».' : 'Type your email first, then tap “Forgot password”.'); return }
    try {
      await sendPasswordResetEmail(auth, em)
      setResetMsg(ar ? `أرسلنا رابط استعادة كلمة المرور إلى ${em} — تحقق من بريدك.` : `Password reset link sent to ${em} — check your inbox.`)
    } catch (e2) { setErr(authErrorMessage(e2, lang)) }
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await login(email.trim(), password)
      onDone?.()
    } catch (e2) {
      setErr(authErrorMessage(e2, lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="rlauth-body" onSubmit={submit}>
      <div className="field">
        <label>{t('email')}</label>
        <input className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="field">
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {t('password')}
          <button type="button" onClick={forgot} style={{ background: 'none', border: 0, color: 'var(--brand)', cursor: 'pointer', font: 'inherit', fontSize: 'var(--fs-xs)', fontWeight: 700, padding: 0 }}>
            {ar ? 'نسيت كلمة المرور؟' : 'Forgot password?'}
          </button>
        </label>
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </div>
      {err && <p className="xs" style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>}
      {resetMsg && <p className="xs" style={{ color: 'var(--success)', margin: 0 }}>{resetMsg}</p>}
      <button className="rlauth-submit" disabled={busy}>
        {busy ? t('loading') : t('login')}
      </button>
    </form>
  )
}

export default function Login() {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const { user, tenantId, loading, isPlatformAdmin } = useAuth()
  const navigate = useNavigate()
  const deviceVenue = getDeviceVenue()

  // While the auth context resolves (refresh / just-signed-in) show a spinner —
  // never the login form for someone already signed in, and never a premature
  // bounce to onboarding before the profile (tenantId) is known.
  if (loading) return <FullSpinner />
  // Platform admins without a venue go to the platform console, not onboarding.
  if (user) return <Navigate to={tenantId ? '/admin' : isPlatformAdmin ? '/platform' : '/onboarding'} replace />

  return (
    <AuthShell
      title={t('welcomeBack')}
      subtitle={ar ? 'سجّل الدخول لإدارة منشأتك' : 'Sign in to manage your venue'}
      foot={<>{t('noAccount')} <Link to="/signup">{t('signup')}</Link></>}
    >
      <LoginForm onDone={() => navigate('/admin')} />
      {/* a tablet this venue already uses signs staff in by PIN — one tap away */}
      {deviceVenue?.pinLock?.enabled && (
        <Link to="/lock" className="btn btn-outline btn-block" style={{ marginTop: 10, minHeight: 44, fontWeight: 700 }}>
          <Icon name="key" size={16} /> {ar ? `الدخول برمز PIN — ${deviceVenue.name || ''}` : `PIN sign-in — ${deviceVenue.name || ''}`}
        </Link>
      )}
    </AuthShell>
  )
}
