// Shared building blocks for the six social-play surfaces.
//
// This exists so the six components stay about their FEATURE and not about
// chrome: every one of them needs the same card shell, the same brand
// resolution, the same one-second ticker for a countdown, and the same
// board row. Duplicating those six times is how they drift apart.
//
// Nothing here talks to Firestore. Nothing here is a default export except the
// card, so the feature components read as a list of named parts.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { fmtNum } from '../../lib/socialPlay.js'
import '../../styles/social.css'

// The venue's colour, or the games hub's own teal. Never a random accent.
export function safeBrand(tenant) {
  const c = String(tenant?.themeColor || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v
  } catch (_) { /* SSR / no document */ }
  return '#0e7490'
}

export function useBrand(tenant) {
  return useMemo(() => safeBrand(tenant), [tenant])
}

// A shared one-second clock for countdowns. It stops itself when `on` is false,
// so a card with nothing to count down costs no timer at all.
export function useNow(on = true, ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return undefined
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [on, ms])
  return now
}

// Subscribe with a cleanup that is safe against a late callback. Every social
// watcher returns an unsubscribe, and every one of them may fire once more
// after unmount on a slow connection.
export function useWatch(subscribe, deps, initial) {
  const [state, setState] = useState(initial)
  const subRef = useRef(subscribe)
  subRef.current = subscribe
  useEffect(() => {
    let alive = true
    const stop = subRef.current((v) => { if (alive) setState(v) })
    return () => { alive = false; if (typeof stop === 'function') stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

export function Card({ brand, hot = false, className = '', children, ...rest }) {
  return (
    <section
      className={`sp-card${hot ? ' sp-hot' : ''}${className ? ` ${className}` : ''}`}
      style={brand ? { '--sp-brand': brand } : undefined}
      {...rest}
    >
      {children}
    </section>
  )
}

export function Head({ icon, title, right = null }) {
  return (
    <div className="sp-head">
      <span className="sp-head-ic"><Icon name={icon} size={17} /></span>
      <h3 className="sp-title">{title}</h3>
      {right}
    </div>
  )
}

export function LivePill({ children }) {
  return <span className="sp-live">{children}</span>
}

// One standings row. `meta` is optional and is never invented — a row with no
// play count simply has no meta.
export function BoardRow({ rank, name, score, meta = '', me = false }) {
  return (
    <div className={`sp-row${me ? ' sp-me' : ''}`}>
      <span className="sp-rank">{fmtNum(rank)}</span>
      <span className="sp-name">{name}</span>
      {meta ? <span className="sp-meta">{meta}</span> : null}
      <span className="sp-score">{fmtNum(score)}</span>
    </div>
  )
}

// The first letter of a name, for a peer avatar. Falls back to a person icon
// rather than a guessed initial.
export function Initial({ name }) {
  const ch = String(name || '').trim().slice(0, 1)
  return <span className="sp-av">{ch || <Icon name="user" size={15} />}</span>
}

export const pick = (lang, ar, en) => (lang === 'en' ? en : ar)
