import { normalizeVideoTrim } from '../lib/dishComposition.js'
import { useVideoTrim } from '../lib/useVideoTrim.js'

// System-wide ambient background (tenant.appBg): a gradient, image, or video
// behind the ENTIRE staff system — this is what makes Liquid Glass shine in
// light mode. Rendered as the first child of each shell; shells go transparent
// via body[data-appbg] so the fixed layer shows through every glass surface.
export default function AppBackground({ tenant }) {
  const bg = tenant?.appBg
  // trim nests INSIDE the appBg object (appBg.trim) next to kind/url/opacity —
  // hook BEFORE the early returns (Rules of Hooks); null trim attaches nothing
  const trimRef = useVideoTrim(bg && bg.kind === 'video' ? normalizeVideoTrim(bg?.trim) : null)
  if (!bg || !bg.kind || bg.kind === 'mesh') return null
  if (bg.kind === 'gradient') {
    return <div className="app-bg" aria-hidden="true" style={{ background: `linear-gradient(${Number(bg.angle) || 160}deg, ${bg.from || '#eef1f7'}, ${bg.to || '#dfe6f0'})` }} />
  }
  if (!bg.url) return null
  const op = bg.opacity ?? 1
  return (
    <div className="app-bg" aria-hidden="true">
      {bg.kind === 'video'
        ? <video ref={trimRef} src={bg.url} autoPlay muted loop playsInline style={{ opacity: op }} />
        : <div style={{ backgroundImage: `url(${bg.url})`, opacity: op }} />}
    </div>
  )
}
