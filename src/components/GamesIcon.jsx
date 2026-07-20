// GamesIcon — the mark for the games hub.
//
// The generic play triangle means "start a video". This means "play a game":
// a fanned pair of cards, a domino tile, and a die, composed into one balanced
// diagonal cluster.
//
// DESIGN CONSTRAINTS, because the same mark runs at 16px in a tab bar and at
// 48px on a hub header:
//   • 24-unit viewBox and lucide's stroke conventions (round caps/joins, no
//     fill on outlines) so it sits beside every other Icon without looking
//     foreign.
//   • Every shape is at least ~5 units on its short side. Below that a 2-unit
//     stroke closes the counters and the shape turns into a blob at 16px.
//   • Only the back card is rotated. Rotating the die and the domino too would
//     put four different angles in one 24px square and every edge would land
//     off-pixel. Axis-aligned shapes stay crisp on a 1px grid.
//   • Pips live ONLY on the die. Adding pips to the domino at this size makes
//     the two objects read as the same texture; the domino keeps its divider
//     line as its identity instead.
//   • The two cards overlap (that is what a fan IS); the die and the domino
//     clear every other shape by at least 0.3 units of stroke-to-stroke gap.
//     Unrelated outline shapes that cross would need an opaque knockout to stay
//     legible, and an icon that inherits currentColor has no background colour
//     to knock out with. Geometry was checked numerically, not by eye.
//
// `animated` gives the die a slow idle tumble. It is a CSS class (see
// venuememory.css) rather than SMIL so that prefers-reduced-motion can switch
// it off declaratively, with no matchMedia listener to leak.
import '../styles/venuememory.css'

export default function GamesIcon({ size = 20, strokeWidth = 1.9, animated = false, title, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`rbt-gi ${animated ? 'rbt-gi-on' : ''}`}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : 'true'}
      {...rest}
    >
      {title ? <title>{title}</title> : null}

      {/* Back card of the fan — the only rotated element, pivoting on its own
          centre (6, 15). Its rotated bounding box, stroke included, spans
          x 0.98..11.02 / y 8.47..21.53, so it never clips the viewBox. */}
      <rect x="3.2" y="10" width="5.6" height="10" rx="1.5" transform="rotate(-16 6 15)" />

      {/* Front card. Overlapping the back card is the whole point of a fan, and
          two near-parallel rounded rects are what makes the pair read as cards
          rather than as one thick rectangle. */}
      <rect x="6.8" y="9.6" width="5.8" height="10.6" rx="1.6" />

      {/* Domino tile, top-right. Its divider is its identity: pips here would
          give it the same texture as the die and the two would merge at 16px. */}
      <rect x="15.4" y="2.2" width="6.6" height="5.2" rx="1.4" />
      <path d="M18.7 2.8v4" />

      {/* Die, bottom-right — the only pip-carrier in the mark. */}
      <g className="rbt-gi-die">
        <rect x="15.2" y="11.6" width="7" height="7" rx="1.9" />
        <circle cx="17.5" cy="13.9" r="1" fill="currentColor" stroke="none" />
        <circle cx="19.9" cy="16.3" r="1" fill="currentColor" stroke="none" />
      </g>
    </svg>
  )
}
