import { useEffect, useRef } from 'react'

// Live mini-browser preview: the REAL menu in an iframe.
// Supports mobile (iPhone 12 Pro view scaled), tablet (iPad view scaled), and desktop views.
// We scale using CSS transform to keep standard viewport resolutions (390px and 768px)
// rendering beautifully, while fitting nicely in the editor column without cutoff.
export default function MenuPreview({ slug, override, mode = 'mobile' }) {
  const iframeRef = useRef(null)
  const readyRef = useRef(false)

  const post = () => {
    try {
      iframeRef.current?.contentWindow?.postMessage({ __rbt360Preview: true, appearance: override }, '*')
    } catch (_) { /* ignore */ }
  }

  useEffect(() => {
    const onMsg = (e) => {
      if (e.data && e.data.__rbt360PreviewReady) {
        readyRef.current = true
        post()
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (readyRef.current) post()
  }) // eslint-disable-line react-hooks/exhaustive-deps

  if (mode === 'desktop') {
    // Desktop: 1080 x 1100, scaled down by 0.36 -> 388 x 396
    // This allows the iframe viewport to render as a genuine desktop browser (above 768px),
    // triggering all desktop styling overrides, while fitting perfectly inside the preview column.
    const innerW = 1080
    const innerH = 1100
    const scale = 0.36
    const outerW = innerW * scale
    const outerH = innerH * scale

    return (
      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
        <div style={{
          width: outerW,
          height: outerH,
          position: 'relative',
          overflow: 'hidden',
          flex: 'none'
        }}>
          <div style={{
            width: innerW,
            height: innerH,
            position: 'absolute',
            left: '50%',
            top: 0,
            transform: `translate(-50%, 0) scale(${scale})`,
            transformOrigin: 'top center',
            borderRadius: 12,
            border: '1px solid var(--border)',
            boxShadow: 'var(--sh-2)',
            background: 'var(--bg)',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <div style={{ height: 30, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
              {['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 11, height: 11, borderRadius: '50%', background: c }} />)}
            </div>
            <iframe ref={iframeRef} src={`/preview/${slug}`} title="menu-preview" onLoad={post}
              style={{ display: 'block', border: 0, width: '100%', flex: 1, background: 'var(--bg)' }} />
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'tablet') {
    // iPad: 768 x 1024, scaled down by 0.47 -> 361 x 481, plus 12px bezel -> 385 x 505
    const innerW = 768
    const innerH = 1024
    const scale = 0.47
    const bezel = 12
    const outerW = (innerW + bezel * 2) * scale
    const outerH = (innerH + bezel * 2) * scale

    return (
      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
        <div style={{
          width: outerW,
          height: outerH,
          position: 'relative',
          overflow: 'hidden',
          flex: 'none'
        }}>
          <div style={{
            width: innerW + bezel * 2,
            height: innerH + bezel * 2,
            position: 'absolute',
            left: '50%',
            top: 0,
            transform: `translate(-50%, 0) scale(${scale})`,
            transformOrigin: 'top center',
            border: `${bezel}px solid #374151`,
            borderRadius: '28px',
            boxShadow: 'var(--sh-3)',
            background: '#1c1c1f',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* iPad Screen top speaker/camera dot */}
            <div style={{ height: 14, background: '#1c1c1f', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4b5563' }} />
            </div>
            <iframe ref={iframeRef} src={`/preview/${slug}`} title="menu-preview" onLoad={post}
              style={{ display: 'block', border: 0, width: '100%', flex: 1, background: 'var(--bg)' }} />
          </div>
        </div>
      </div>
    )
  }

  // default: 'mobile' (iPhone 12 Pro: 390 x 844, scaled down by 0.56 -> 218 x 472, plus 10px bezel -> 238 x 492)
  const innerW = 390
  const innerH = 844
  const scale = 0.56
  const bezel = 10
  const outerW = (innerW + bezel * 2) * scale
  const outerH = (innerH + bezel * 2) * scale

  return (
    <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
      <div style={{
        width: outerW,
        height: outerH,
        position: 'relative',
        overflow: 'hidden',
        flex: 'none'
      }}>
        <div style={{
          width: innerW + bezel * 2,
          height: innerH + bezel * 2,
          position: 'absolute',
          left: '50%',
          top: 0,
          transform: `translate(-50%, 0) scale(${scale})`,
          transformOrigin: 'top center',
          border: `${bezel}px solid #1c1c1f`,
          borderRadius: '40px',
          boxShadow: 'var(--sh-3)',
          background: '#000000',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {/* iPhone 12 Pro notch / speaker bar */}
          <div style={{ height: 16, background: '#1c1c1f', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', position: 'relative' }}>
            <div style={{ width: 110, height: 12, background: '#000000', borderRadius: '0 0 10px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span style={{ width: 22, height: 3, borderRadius: 2, background: '#1f2937' }} />
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#111827' }} />
            </div>
          </div>
          <iframe ref={iframeRef} src={`/preview/${slug}`} title="menu-preview" onLoad={post}
            style={{ display: 'block', border: 0, width: '100%', flex: 1, background: 'var(--bg)' }} />
        </div>
      </div>
    </div>
  )
}
