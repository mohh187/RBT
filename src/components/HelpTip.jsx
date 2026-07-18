import { useEffect, useRef, useState } from 'react'
import { searchGuide } from '../lib/aiGuide.js'

// Tiny inline help: a «؟» dot next to a section title that toggles a popover
// with the matching entry from the system knowledge base (lib/aiGuide.js).
// Usage: <HelpTip topic="الثيمات" />
export default function HelpTip({ topic }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  const entries = open ? searchGuide(topic, 1) : []
  return (
    <span ref={boxRef} style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle', marginInlineStart: 4 }}>
      <button
        type="button"
        aria-label={`دليل: ${topic}`}
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v) }}
        style={{
          width: 18, height: 18, borderRadius: '50%', padding: 0, cursor: 'pointer',
          border: '1px solid var(--border-strong)', lineHeight: 1,
          background: open ? 'var(--brand)' : 'var(--surface-2)',
          color: open ? '#fff' : 'var(--text-muted)',
          fontSize: 11, fontWeight: 800,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
        }}
      >؟</button>
      {open && (
        <span
          role="note"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', insetInlineStart: 0, zIndex: 70,
            width: 300, maxWidth: '72vw', display: 'block', textAlign: 'start',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-md, 10px)', boxShadow: 'var(--sh-2, 0 10px 28px rgba(0,0,0,.16))',
            padding: '10px 12px', whiteSpace: 'normal', fontWeight: 400,
          }}
        >
          {entries.length ? entries.map((e) => (
            <span key={e.topic} style={{ display: 'block' }}>
              <strong style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text)' }}>{e.topic}</strong>
              <span style={{ display: 'block', fontSize: 11, lineHeight: 1.8, color: 'var(--text-muted)' }}>{e.guide}</span>
            </span>
          )) : (
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>لا يوجد دليل لهذا الموضوع بعد.</span>
          )}
        </span>
      )}
    </span>
  )
}
