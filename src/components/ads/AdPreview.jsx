// The live preview: a phone frame with a hint of a menu behind the ad, and the
// SAME AdSurface the guest gets — so what the venue approves is literally what
// ships. Only the wrapper differs (absolute inside the frame, not fixed).
import { useEffect, useState } from 'react'
import AdSurface from './AdSurface.jsx'
import { AD_KINDS, AD_SHAPES, labelOf } from '../../lib/ads.js'

export default function AdPreview({ ad, lang = 'ar' }) {
  const ar = lang !== 'en'
  const [key, setKey] = useState(0)
  const [entered, setEntered] = useState(false)

  // Replay the entrance whenever the placement or shape changes, so the venue
  // actually sees the motion it just chose (mount at 0, then flip to 1 on the
  // next frame — a component that mounts already-final never transitions).
  useEffect(() => { setEntered(false); setKey((k) => k + 1) }, [ad.kind, ad.shape])
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [key])

  return (
    <div className="ads-phone-wrap">
      <div className="ads-phone">
        <div className="ads-screen">
          <div className="ads-screen-bg" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </div>
          <div
            key={key}
            className="adx-root"
            data-preview="1"
            data-kind={ad.kind}
            data-shape={ad.shape}
            data-in={entered ? '1' : '0'}
          >
            <div className="adx-backdrop" />
            <AdSurface ad={ad} lang={lang} onCta={() => {}} onClose={() => {}} />
          </div>
        </div>
      </div>
      <p className="ads-preview-note">
        {ar
          ? `${labelOf(AD_KINDS, ad.kind)} — ${labelOf(AD_SHAPES, ad.shape)}. هذه هي نفس الواجهة التي يراها الضيف تماماً.`
          : `${ad.kind} — ${ad.shape}. This is the exact surface the guest sees.`}
      </p>
    </div>
  )
}
