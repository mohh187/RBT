import { textReadability } from '../lib/contrast.js'

// Live readability verdict for a picked text color: one chip per app mode
// (light / dark). Green = clear, amber = weak (large text only), red = won't
// be readable in that mode. Renders nothing until a valid hex is chosen.
const TONE = {
  ok: { bg: 'var(--success-soft)', fg: 'var(--success)' },
  weak: { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
  bad: { bg: 'var(--danger-soft)', fg: 'var(--danger)' },
}
const WORD = { ok: 'واضح', weak: 'ضعيف', bad: 'غير مقروء' }
const WORD_EN = { ok: 'clear', weak: 'weak', bad: 'unreadable' }

export default function ContrastHint({ color, ar = true }) {
  const r = textReadability(color)
  if (!r.light || !r.dark) return null
  if (r.light === 'ok' && r.dark === 'ok') {
    return <span className="xs" style={{ color: 'var(--success)', fontWeight: 700 }}>{ar ? 'واضح في الوضعين الفاتح والداكن' : 'Clear in both light & dark'}</span>
  }
  const chip = (label, verdict) => (
    <span className="xs" style={{ background: TONE[verdict].bg, color: TONE[verdict].fg, fontWeight: 800, padding: '2px 8px', borderRadius: 'var(--r-pill)' }}>
      {label}: {ar ? WORD[verdict] : WORD_EN[verdict]}
    </span>
  )
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {chip(ar ? 'الفاتح' : 'Light', r.light)}
      {chip(ar ? 'الداكن' : 'Dark', r.dark)}
    </span>
  )
}
