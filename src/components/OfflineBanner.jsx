import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n.jsx'

import Icon from './Icon.jsx'

// Global offline indicator. The app still works offline (cached shell + image
// cache + Firestore local cache); writes queue and sync when the connection
// returns.
//
// A NON-BLOCKING pill, not a bar: the old full-width fixed strip sat over the
// bottom nav and the cart at z 9999 and swallowed their taps for as long as
// the network was down — «الشريط مزعج ويغطي العناصر ويعيق العمل». This one
// floats above the bottom nav, never intercepts a tap (pointer-events: none),
// and shrinks to a small icon chip a few seconds after appearing so the menu
// stays fully readable while offline.
export default function OfflineBanner() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false)
  const [compact, setCompact] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    const on = () => { setOffline(false); clearTimeout(timer.current) }
    const off = () => {
      setOffline(true)
      setCompact(false)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCompact(true), 5000)
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) off()
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { clearTimeout(timer.current); window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  if (!offline) return null
  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 'calc(var(--bottomnav-h, 0px) + var(--safe-b, 0px) + 12px)',
        insetInline: 0,
        zIndex: 900,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'rgba(20, 16, 12, 0.82)', color: '#f5e9d8',
        border: '1px solid rgba(245, 185, 66, 0.35)',
        borderRadius: 999, padding: compact ? '6px 10px' : '6px 14px',
        fontSize: 12, fontWeight: 700, backdropFilter: 'blur(6px)',
        boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
        maxWidth: '86vw', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        <Icon name="zap" size={13} />
        {compact
          ? (ar ? 'بلا اتصال' : 'Offline')
          : (ar ? 'بلا اتصال — التصفح يعمل، وما تطلبه يُرسل تلقائياً عند عودة الإنترنت' : 'Offline — browsing works; orders sync when back online')}
      </span>
    </div>
  )
}
