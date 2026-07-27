import Icon from './Icon.jsx'
import { RbtMark, RbtWordmark } from './BrandMark.jsx'

// Tiny shared UI atoms.
export function Spinner({ lg }) {
  return (
    <div className="center" style={{ padding: 'var(--sp-8)' }}>
      <div className={`spinner ${lg ? 'spinner-lg' : ''}`} />
    </div>
  )
}

export function FullSpinner() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <div className="spinner spinner-lg" />
    </div>
  )
}

export function Empty({ icon = 'notepad', title, hint, action }) {
  return (
    <div className="empty">
      <div className="emoji"><Icon name={icon} size={40} /></div>
      {title && <p className="bold" style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>{title}</p>}
      {hint && <p className="small" style={{ marginTop: 4 }}>{hint}</p>}
      {action && <div style={{ marginTop: 'var(--sp-4)' }}>{action}</div>}
    </div>
  )
}

export function Stepper({ value, onChange, min = 1, max = 99 }) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="-">−</button>
      <span className="val num">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label="+">+</button>
    </div>
  )
}

export function BrandMark({ name }) {
  return (
    <span className="brand-mark brand-mark-official">
      <RbtMark size={30} />
      {name ? <span className="brand-word">{name}</span> : <RbtWordmark size={17} />}
    </span>
  )
}
