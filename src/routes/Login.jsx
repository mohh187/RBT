import { useState } from 'react'
import { Link, useNavigate, Navigate } from 'react-router-dom'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../lib/firebase.js'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import AuthShell, { PasswordInput } from '../components/AuthShell.jsx'
import { FullSpinner } from '../components/ui.jsx'
import { authErrorMessage } from '../lib/authErrors.js'

export default function Login() {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const { login, user, tenantId, loading, isPlatformAdmin } = useAuth()
  const navigate = useNavigate()
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

  // While the auth context resolves (refresh / just-signed-in) show a spinner —
  // never the login form for someone already signed in, and never a premature
  // bounce to onboarding before the profile (tenantId) is known.
  if (loading) return <FullSpinner />
  // Platform admins without a venue go to the platform console, not onboarding.
  if (user) return <Navigate to={tenantId ? '/admin' : isPlatformAdmin ? '/platform' : '/onboarding'} replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await login(email.trim(), password)
      navigate('/admin')
    } catch (e2) {
      setErr(authErrorMessage(e2, lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title={t('welcomeBack')}
      subtitle={ar ? 'سجّل الدخول لإدارة مقهاك' : 'Sign in to manage your venue'}
      err={err}
      foot={<>{t('noAccount')} <Link to="/signup">{t('signup')}</Link></>}
    >
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
        {resetMsg && <p className="xs" style={{ color: 'var(--success)', margin: 0 }}>{resetMsg}</p>}
        <button className="rlauth-submit" disabled={busy}>
          {busy ? t('loading') : t('login')}
        </button>
      </form>
    </AuthShell>
  )
}
