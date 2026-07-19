// <ItemFx kind="steam" /> — decorative live-effect overlay for an item photo
// or 3D viewer. Pure CSS particles (transform/opacity only, GPU-cheap),
// pointer-events none, hidden under prefers-reduced-motion (see index.css).
// Parent must be position:relative with overflow suited to the effect.
import { EFFECT_IDS } from '../lib/itemEffects.js'

// Fixed pseudo-random layouts per effect (no Math.random — stable renders).
const LAYOUTS = {
  steam:   [[38, 0], [50, 0.9], [62, 1.7]],
  smoke:   [[30, 0], [46, 0.7], [58, 1.3], [70, 2.1]],
  sparkle: [[18, 0], [34, 0.5], [55, 1.1], [72, 0.2], [84, 1.6], [45, 2.2]],
  bubbles: [[22, 0], [38, 0.8], [52, 1.5], [66, 0.4], [80, 1.9]],
  frost:   [[15, 0], [35, 1.2], [58, 0.6], [78, 1.8]],
  fire:    [[50, 0]],
}

export default function ItemFx({ kind, scale = 1 }) {
  if (!kind || !EFFECT_IDS.includes(kind)) return null
  const parts = LAYOUTS[kind] || []
  return (
    <span className={`itemfx itemfx-${kind}`} style={scale !== 1 ? { '--fx-scale': scale } : undefined} aria-hidden="true">
      {parts.map(([left, delay], i) => (
        <i key={i} style={{ left: `${left}%`, animationDelay: `${delay}s` }} />
      ))}
    </span>
  )
}
