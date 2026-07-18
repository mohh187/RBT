import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n.jsx'

import Icon from './Icon.jsx'

// Global offline indicator. The app still works offline (cached shell + Firestore
// local cache); writes queue and sync automatically when the connection returns.
export default function OfflineBanner() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false)

  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  if (!offline) return null
  return (
    <div style={{ position: 'fixed', bottom: 0, insetInline: 0, zIndex: 9999, background: 'var(--warning, #b45309)', color: '#fff', textAlign: 'center', padding: '6px 12px', fontSize: 13, fontWeight: 700 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="zap" size={14} /> {ar ? 'وضع عدم الاتصال — يعمل التطبيق، ويُحفظ طلبك ويُرسَل تلقائياً عند عودة الإنترنت' : 'Offline — the app keeps working; your order is saved and syncs when back online'}</span>
    </div>
  )
}
