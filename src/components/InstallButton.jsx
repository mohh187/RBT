import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n.jsx'

// Shows an "install app" button when the browser offers the PWA install prompt.
export default function InstallButton({ className }) {
  const { lang } = useI18n()
  const [deferred, setDeferred] = useState(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferred(e) }
    const onInstalled = () => { setInstalled(true); setDeferred(null) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed || !deferred) return null
  return (
    <button
      className={className || 'btn btn-outline btn-block'}
      onClick={async () => { deferred.prompt(); await deferred.userChoice; setDeferred(null) }}
    >
      {lang === 'ar' ? 'تثبيت التطبيق على الجهاز' : 'Install app'}
    </button>
  )
}
