import { useMemo } from 'react'

// Live staff-screen preview — the REAL app in an iframe (same mechanism as
// MenuPreview): /preview/pos renders the actual CashierPOS, /kds the actual KDS.
// Desktop / tablet / mobile are true viewport sizes scaled to fit the column.
const FRAMES = {
  desktop: { w: 1280, h: 800, scale: 0.3, bezel: 0, radius: 12 },
  tablet: { w: 1024, h: 768, scale: 0.37, bezel: 12, radius: 26 },
  mobile: { w: 390, h: 780, scale: 0.56, bezel: 10, radius: 38 },
}

export default function StaffPreview({ which = 'pos', mode = 'desktop' }) {
  const f = FRAMES[mode] || FRAMES.desktop
  const src = which === 'kds' ? '/kds' : which === 'pinlock' ? '/preview/pinlock' : '/preview/pos'
  const outerW = (f.w + f.bezel * 2) * f.scale
  const outerH = (f.h + f.bezel * 2) * f.scale
  // remount the iframe when target/size changes so media queries re-evaluate
  const key = useMemo(() => `${which}-${mode}`, [which, mode])
  return (
    <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
      <div style={{ width: outerW, height: outerH, position: 'relative', overflow: 'hidden', flex: 'none' }}>
        <div style={{
          width: f.w + f.bezel * 2, height: f.h + f.bezel * 2,
          position: 'absolute', left: '50%', top: 0,
          transform: `translate(-50%, 0) scale(${f.scale})`, transformOrigin: 'top center',
          border: f.bezel ? `${f.bezel}px solid #1c1c1f` : '1px solid var(--border)',
          borderRadius: f.radius, boxShadow: 'var(--sh-2)', background: 'var(--bg)',
          boxSizing: 'border-box', overflow: 'hidden', display: 'flex',
        }}>
          {/* fully interactive — click through the real screen while designing */}
          <iframe key={key} src={src} title="staff-preview"
            style={{ display: 'block', border: 0, width: '100%', height: '100%', background: 'var(--bg)' }} />
        </div>
      </div>
    </div>
  )
}
