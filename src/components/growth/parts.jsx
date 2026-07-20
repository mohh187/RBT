// Shared presentational primitives for the growth pack. Deliberately dumb: they
// render what they are given and nothing else. The one opinion they carry is
// that a claim must appear beside the sample it came from — GBasis and GNumbers
// exist so no card can quietly drop its denominators.
import Icon from '../Icon.jsx'

// Latin digits, always — matches the hard rule and the rest of the system.
export const fmt = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('ar-SA-u-nu-latn') : '—')
export const pct = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${Math.round(Number(v) * 100)}%`)

export function GCard({ title, icon, badge, children, actions }) {
  return (
    <div className="g-card">
      {(title || actions) && (
        <div className="g-card-head">
          <div className="g-card-title">
            {icon && <Icon name={icon} size={16} />}
            <span>{title}</span>
            {badge}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}

// The honest "we are not going to answer that" state. Used everywhere a sample
// is too thin — never replaced by a softened guess.
export function GRefusal({ title, body, icon = 'warning', action }) {
  return (
    <div className="g-refusal">
      <Icon name={icon} size={22} />
      <div className="g-refusal-title">{title}</div>
      {body && <div className="g-refusal-body">{body}</div>}
      {action}
    </div>
  )
}

export function GNumbers({ data }) {
  const entries = Object.entries(data || {}).filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (!entries.length) return null
  return (
    <div className="g-numbers">
      {entries.map(([k, v]) => (
        <div className="g-num" key={k}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
    </div>
  )
}

// The provenance line. Every screen in this pack shows one.
export function GBasis({ children }) {
  if (!children) return null
  return <div className="g-basis">{children}</div>
}

export function GTag({ kind = '', children }) {
  return <span className={`g-tag ${kind}`}>{children}</span>
}

export function GLimits({ items }) {
  const list = (items || []).filter(Boolean)
  if (!list.length) return null
  return (
    <ul className="g-limits">
      {list.map((x, i) => <li key={i}>{x}</li>)}
    </ul>
  )
}

// Confidence is derived from sample size ONLY — never from how good the
// suggestion sounds.
export function GConfidence({ level, ar = true }) {
  const map = {
    high: { ar: 'ثقة عالية', en: 'High confidence', kind: 'good' },
    medium: { ar: 'ثقة متوسطة', en: 'Medium confidence', kind: 'warn' },
    low: { ar: 'ثقة منخفضة', en: 'Low confidence', kind: 'bad' },
  }
  const c = map[level]
  if (!c) return null
  return <GTag kind={c.kind}>{ar ? c.ar : c.en}</GTag>
}
