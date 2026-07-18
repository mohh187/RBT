import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'

// Global upload HUD — listens to 'ml:upload' events fired by storage.js, so
// every image/video/audio upload anywhere in the system shows file name,
// size, and a live progress bar automatically.
const fmtMB = (b) => (b / 1024 / 1024) >= 1 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`

export default function UploadProgress() {
  const [u, setU] = useState(null)
  useEffect(() => {
    let hideTimer
    const on = (e) => {
      const d = e.detail || {}
      clearTimeout(hideTimer)
      setU(d)
      // errors must stay VISIBLE (vanishing instantly read as "the bar never
      // showed up"); success lingers briefly then clears
      if (d.state === 'done') hideTimer = setTimeout(() => setU(null), 1200)
      if (d.state === 'error') hideTimer = setTimeout(() => setU(null), 3200)
    }
    window.addEventListener('ml:upload', on)
    return () => { window.removeEventListener('ml:upload', on); clearTimeout(hideTimer) }
  }, [])
  if (!u) return null
  const done = u.state === 'done'
  const failed = u.state === 'error'
  const tone = failed ? 'var(--danger)' : done ? 'var(--success)' : 'var(--brand)'
  return (
    <div className="upload-hud" role="status">
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <Icon name={failed ? 'warning' : done ? 'check' : 'upload'} size={16} style={{ color: tone, flex: 'none' }} />
        <span className="small bold grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || 'ملف'}</span>
        <span className="xs num" dir="ltr" style={{ flex: 'none', color: failed ? 'var(--danger)' : 'var(--text-faint)', fontWeight: failed ? 800 : undefined }}>
          {failed ? 'فشل الرفع' : `${fmtMB(u.size || 0)} · ${u.progress}%`}
        </span>
      </div>
      <div className="upload-bar"><span style={{ width: failed ? '100%' : `${u.progress}%`, background: tone }} /></div>
    </div>
  )
}
