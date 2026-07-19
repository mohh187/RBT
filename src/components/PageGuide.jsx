// «دليل الصفحة»: a top-bar button on every admin page opening a step-by-step
// manual for the CURRENT page (from pageGuides.js — the same registry the AI
// assistant teaches from). Includes replay-tour + ask-assistant shortcuts.
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { guideForPath } from '../lib/pageGuides.js'
import { TOURS } from '../lib/tours.js'
import { resetTour } from './Tour.jsx'

export default function PageGuide() {
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()
  const guide = guideForPath(loc.pathname)
  if (!guide) return null

  // Tour keys mirror AdminLayout's route mapping; only offer replay when one exists.
  const tourKey = guide.key === 'menu' ? 'items' : guide.key
  const hasTour = !!TOURS[tourKey]

  const replayTour = () => {
    resetTour(tourKey)
    setOpen(false)
    // Tour mounts on page load — reload so it re-runs immediately.
    window.location.reload()
  }

  let stepNo = 0
  return (
    <>
      <button className="icon-btn" onClick={() => setOpen(true)} title={`دليل الصفحة: ${guide.title}`} aria-label="page guide">
        <Icon name="notepad" size={18} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`دليل: ${guide.title}`}>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <p className="small muted" style={{ margin: 0, lineHeight: 1.8 }}>{guide.intro}</p>
          {guide.sections.map((sec) => (
            <div key={sec.title} className="card card-pad stack" style={{ gap: 'var(--sp-2)' }}>
              <strong style={{ fontSize: 'var(--fs-md)' }}>{sec.title}</strong>
              {sec.steps.map((s) => {
                stepNo += 1
                return (
                  <div key={s} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <span className="pg-step-no">{stepNo}</span>
                    <p className="small" style={{ margin: 0, lineHeight: 1.8 }}>{s}</p>
                  </div>
                )
              })}
            </div>
          ))}
          <div className="row wrap" style={{ gap: 8 }}>
            {hasTour && (
              <button className="btn btn-outline btn-sm" onClick={replayTour}>
                <Icon name="play" size={14} /> شغّل الجولة الإرشادية
              </button>
            )}
            <button className="btn btn-outline btn-sm" onClick={() => { setOpen(false); nav('/admin/assistant') }}>
              <Icon name="sparkles" size={14} /> اسأل المساعد عن هذه الصفحة
            </button>
          </div>
        </div>
      </Sheet>
    </>
  )
}
