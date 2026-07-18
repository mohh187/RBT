import { createPortal } from 'react-dom'

// Per-venue ambient background: a video (Linktree-style), an image, and/or a
// tiled watermark/logo — all behind the content with a venue-controlled opacity.
// Renders nothing unless the venue configured at least one.
export default function VenueBackground({ tenant, inline = false }) {
  const bgVideoUrl = tenant?.bgVideoUrl || ''
  const bgImageUrl = tenant?.bgImageUrl || ''
  const watermarkUrl = tenant?.watermarkUrl || ''
  const bgGradient = tenant?.bgGradient || ''
  if (!bgVideoUrl && !bgImageUrl && !watermarkUrl && !bgGradient) return null
  const opacity = tenant?.bgOpacity != null ? Number(tenant.bgOpacity) : 0.15
  // bgPosition can be a keyword ('center'/'top'...) or "x% y%" from manual pan.
  const pos = tenant?.bgPosition || 'center'
  const size = tenant?.bgScale ? `${Number(tenant.bgScale) * 100}%` : 'cover'

  const layer = (
    <div className={inline ? 'venue-bg venue-bg-inline' : 'venue-bg'} aria-hidden="true">
      {bgGradient && <div className="venue-bg-media" style={{ background: bgGradient }} />}
      {bgVideoUrl ? (
        // video honors the SAME controls as images: opacity + pan position + zoom
        <video className="venue-bg-media" style={{ opacity, objectPosition: pos, objectFit: 'cover', transform: tenant?.bgScale ? `scale(${Number(tenant.bgScale)})` : undefined, transformOrigin: pos }} src={bgVideoUrl} autoPlay muted loop playsInline preload="auto" />
      ) : bgImageUrl ? (
        <div className="venue-bg-media" style={{ opacity, backgroundImage: `url(${bgImageUrl})`, backgroundSize: size, backgroundPosition: pos, backgroundRepeat: 'no-repeat' }} />
      ) : null}
      {watermarkUrl && <div className="venue-watermark" style={{ opacity: Math.min(0.6, opacity + 0.1), backgroundImage: `url(${watermarkUrl})` }} />}
    </div>
  )
  return inline ? layer : createPortal(layer, document.body)
}
