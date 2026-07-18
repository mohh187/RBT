import { useEffect, useState } from 'react'

// Optional "prefer landscape for cashier" gate. When the venue enables it and the
// cashier is opened on a PORTRAIT touch device, this offers to enter fullscreen +
// lock landscape (Android / Samsung — the vast majority of POS tablets). On iOS,
// where orientation-lock is unsupported, it shows a "rotate your device" hint.
// It auto-dismisses the moment the device is actually in landscape.
const mq = (q) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false)
const isPortrait = () => mq('(orientation: portrait)')
const isTouch = () => mq('(pointer: coarse)')
const canLock = () => !!(typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.lock === 'function')

export default function LandscapeGate({ enabled }) {
  const [portrait, setPortrait] = useState(isPortrait())
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const onCh = () => setPortrait(isPortrait())
    window.addEventListener('resize', onCh)
    window.addEventListener('orientationchange', onCh)
    return () => {
      window.removeEventListener('resize', onCh)
      window.removeEventListener('orientationchange', onCh)
      try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock() } catch (_) { /* ignore */ }
    }
  }, [])

  if (!enabled || !isTouch() || !portrait || dismissed) return null

  const lockable = canLock()
  const go = async () => {
    try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen() } catch (_) { /* ignore */ }
    try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape') } catch (_) { /* iOS / not fullscreen */ }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(10,10,12,.93)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', color: '#fff' }}>
      <div style={{ maxWidth: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <svg width="66" height="66" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--brand, #c0392b)' }} aria-hidden="true">
          <rect x="4" y="2" width="10" height="16" rx="2" transform="rotate(-18 9 10)" />
          <path d="M17 8a6 6 0 0 1 3 5" /><path d="M20 9v4h-4" />
        </svg>
        <strong style={{ fontSize: 19 }}>الوضع الأفقي أفضل للكاشير</strong>
        <p style={{ opacity: 0.85, lineHeight: 1.7, fontSize: 14, margin: 0 }}>
          {lockable
            ? 'ادخل بملء الشاشة والوضع الأفقي لعرض الكتالوج والفاتورة معاً بمساحة كاملة.'
            : 'أدِر جهازك أفقياً للحصول على أفضل تجربة كاشير — يظهر الكتالوج والفاتورة جنباً إلى جنب.'}
        </p>
        {lockable && (
          <button onClick={go} style={{ background: 'var(--brand, #c0392b)', color: '#fff', border: 'none', borderRadius: 999, padding: '13px 30px', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>
            دخول الوضع الأفقي
          </button>
        )}
        <button onClick={() => setDismissed(true)} style={{ background: 'transparent', color: 'rgba(255,255,255,.7)', border: '1px solid rgba(255,255,255,.25)', borderRadius: 999, padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          المتابعة عمودياً
        </button>
      </div>
    </div>
  )
}
