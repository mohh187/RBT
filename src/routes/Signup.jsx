import { useEffect, useState } from 'react'
import { Link, useNavigate, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import AuthShell, { PasswordInput } from '../components/AuthShell.jsx'
import { FullSpinner } from '../components/ui.jsx'
import { authErrorMessage } from '../lib/authErrors.js'

export default function Signup() {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const { signup, user, tenantId, loading } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // The landing "try now" form passes ?venue=&phone= — keep them for onboarding
  // instead of discarding what the visitor already typed.
  const [params] = useSearchParams()
  const prefillVenue = params.get('venue') || ''
  useEffect(() => {
    try {
      if (params.get('venue')) sessionStorage.setItem('rbt_prefill_venue', params.get('venue'))
      if (params.get('phone')) sessionStorage.setItem('rbt_prefill_phone', params.get('phone'))
    } catch (_) { /* ignore */ }
  }, [params])

  if (loading) return <FullSpinner />
  if (user) return <Navigate to={tenantId ? '/admin' : '/onboarding'} replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await signup(email.trim(), password, name.trim())
      navigate('/onboarding')
    } catch (e2) {
      setErr(authErrorMessage(e2, lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title={t('createYourAccount')}
      subtitle={ar ? 'أنشئ حسابك وابدأ استقبال الطلبات اليوم — مجاناً' : 'Create your account and start taking orders today — free'}
      err={err}
      foot={<>{t('haveAccount')} <Link to="/login">{t('login')}</Link></>}
    >
      <form className="rlauth-body" onSubmit={submit}>
        {prefillVenue && (
          <div className="badge" style={{ alignSelf: 'flex-start', gap: 6 }}>{ar ? `سننشئ منشأة: ${prefillVenue}` : `Creating venue: ${prefillVenue}`}</div>
        )}
        <div className="field">
          <label>{t('fullName')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label>{t('email')}</label>
          <input className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label>{t('password')}</label>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={6} />
          <span className="xs faint">{ar ? 'ستة أحرف على الأقل' : 'At least 6 characters'}</span>
        </div>
        <button className="rlauth-submit" disabled={busy}>
          {busy ? t('loading') : t('signup')}
        </button>
      </form>
    </AuthShell>
  )
}
