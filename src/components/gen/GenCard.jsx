import { useState } from 'react'
import Icon from '../Icon.jsx'
import { fmtWhen, kindIcon, kindLabel, resultKindOf, sectionLabel } from '../../lib/genLog.js'

// One generation, as a gallery tile or a list row. Failed generations are shown
// with their error rather than hidden — knowing which prompts fail is the point.
export default function GenCard({ row, view = 'grid', onOpen, ar = true }) {
  const [open, setOpen] = useState(false)
  const rk = resultKindOf(row)
  const failed = !row.ok
  const prompt = (row.prompt || '').trim()
  const text = (row.result?.text || '').trim()
  const long = text.length > 220

  if (view === 'grid') {
    return (
      <button type="button" className="gh-tile" onClick={() => onOpen?.(row)}>
        <div className="gh-tile-media">
          {rk === 'image' ? (
            <img src={row.result.url} alt={prompt.slice(0, 80)} loading="lazy" />
          ) : rk === 'text' ? (
            <div className="gh-tile-ph">
              <span className="gh-tile-snippet">{text.slice(0, 240)}</span>
            </div>
          ) : (
            <div className="gh-tile-ph">
              <Icon name={failed ? 'warning' : kindIcon(row.kind)} size={26} />
              <span style={{ fontSize: 10 }}>{failed ? (ar ? 'لم تكتمل' : 'Did not finish') : ar ? 'بدون معاينة' : 'No preview'}</span>
            </div>
          )}
          {failed && (
            <span className="gh-tile-flag">
              <Icon name="warning" size={11} /> {ar ? 'فشل' : 'Failed'}
            </span>
          )}
        </div>
        <div className="gh-tile-body">
          <span className="gh-tile-prompt">{prompt || (ar ? 'بدون برومبت مسجَّل' : 'No prompt recorded')}</span>
          <span className="gh-tile-meta">
            <Icon name={kindIcon(row.kind)} size={11} />
            {kindLabel(row.kind, ar)}
            <span aria-hidden="true">·</span>
            {fmtWhen(row, ar, false)}
          </span>
        </div>
      </button>
    )
  }

  return (
    <div className="gh-row" role="button" tabIndex={0} onClick={() => onOpen?.(row)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(row) } }}>
      <div className="gh-row-thumb">
        {rk === 'image' ? <img src={row.result.url} alt="" loading="lazy" /> : <Icon name={failed ? 'warning' : kindIcon(row.kind)} size={20} />}
      </div>
      <div className="gh-row-main">
        <span className="gh-row-prompt clamp">{prompt || (ar ? 'بدون برومبت مسجَّل' : 'No prompt recorded')}</span>

        {text && (
          <>
            <pre className={`gh-row-text${open ? '' : ' clamp'}`}>{text}</pre>
            {long && (
              <button
                type="button"
                className="gh-inline-btn"
                onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
              >
                {open ? (ar ? 'إخفاء النص' : 'Show less') : ar ? 'عرض النص كاملاً' : 'Show full text'}
              </button>
            )}
          </>
        )}

        {failed && row.error && <span className="gh-fail-note">{row.error}</span>}

        <span className="gh-row-meta">
          <span className="gh-badge">
            <Icon name={kindIcon(row.kind)} size={11} /> {kindLabel(row.kind, ar)}
          </span>
          <span className="gh-badge">{sectionLabel(row.section, ar)}</span>
          {failed && (
            <span className="gh-badge gh-badge-fail">
              <Icon name="warning" size={11} /> {ar ? 'فشل' : 'Failed'}
            </span>
          )}
          <span>{fmtWhen(row, ar)}</span>
          {row.by?.name && <span>· {row.by.name}</span>}
        </span>
      </div>
    </div>
  )
}
