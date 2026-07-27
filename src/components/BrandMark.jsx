// RBT 360 — the platform's own brand mark, redrawn as an original inline SVG
// (transparent background, works on dark and light surfaces).
//
// Identity: a rounded network/molecule of connected nodes — CONNECT — carrying
// one continuous gradient from vivid blue through violet to magenta; wordmark
// «RBT 360» with RBT in deep navy (inherits surface ink) and 360 in the
// gradient; tagline CONNECT · BUILD · SCALE.
//
// PLATFORM SURFACES ONLY (landing / auth / central console). Venue surfaces
// keep the venue's own identity — never render this inside /admin or menus.
//
//   <BrandMark />                        row lockup: mark + RBT 360
//   <BrandMark variant="mark" />         the molecule alone
//   <BrandMark variant="full" tagline /> stacked hero lockup (+ tagline)
//   <BrandMark mono />                   single-ink (currentColor) for
//                                        gradient/photo backgrounds
//
// Ink hooks (optional): --bm-ink (wordmark RBT), --bm-ink-2 (tagline) — both
// default to currentColor, so the lockup adapts to any surface automatically.

export const BRAND_GRADIENT = ['#2E62F6', '#7A3BEC', '#E0219E']
export const BRAND_GRADIENT_CSS = `linear-gradient(105deg, ${BRAND_GRADIENT[0]}, ${BRAND_GRADIENT[1]} 52%, ${BRAND_GRADIENT[2]})`
export const BRAND_NAVY = '#131B4D'

// Geometry (viewBox 0 0 100 82): nodes [cx, cy, r], links [from, to, width].
// Five dumbbell groups in varied directions + two free satellite dots — an
// original composition in the vocabulary of the owner's reference logo.
const NODES = [
  [30, 18, 9.5], [56, 12, 10.5], [82, 20, 8.5],
  [18, 42, 8], [46, 40, 11], [72, 44, 9],
  [30, 66, 10], [58, 70, 9.5], [84, 64, 7],
  [6, 20, 4.5], [95, 42, 4],
]
const LINKS = [
  [1, 2, 8], [0, 3, 7], [4, 6, 9], [6, 7, 8.5], [5, 8, 6.5],
]

// THE OFFICIAL ASSETS. The owner supplied the real logo as SVG files
// («RBT360 - Brand/» → copied to public/brand/): logo-mark.svg is the mark
// alone, logo-full.svg is the complete lockup with wordmark + tagline baked
// in. They embed traced raster art, so they render as <img> (they cannot be
// recolored). The colored brand therefore ALWAYS shows the official art;
// only `mono` (single-ink on gradient/photo surfaces, where an image cannot
// follow currentColor) falls back to the drawn node composition below.
export const BRAND_MARK_URL = '/brand/logo-mark.svg'
export const BRAND_FULL_URL = '/brand/logo-full.svg'
// Official logotype (owner-supplied «logo font» files), viewBox-cropped to the
// lettering: wordmark alone (ratio 6.4:1) and wordmark + tagline (4.285:1).
export const BRAND_WORD_URL = '/brand/wordmark.svg'
export const BRAND_WORD_TAG_URL = '/brand/wordmark-tagline.svg'
const WORD_RATIO = 6.4
const WORD_TAG_RATIO = 4.285

export function RbtMark({ size = 32, mono = false, className, style }) {
  if (!mono) {
    // The traced export carries generous transparent margins inside its square
    // viewBox (the cluster fills ~66% of the box) — scale it up so the VISIBLE
    // mark matches the requested size like the drawn composition does. The
    // overflow is fully transparent, so no layout/clipping side effects.
    return (
      <img
        src={BRAND_MARK_URL}
        alt="RBT 360"
        width={size}
        height={size}
        draggable={false}
        className={className}
        style={{ display: 'inline-block', objectFit: 'contain', userSelect: 'none', transform: 'scale(1.42)', transformOrigin: 'center', ...style }}
      />
    )
  }
  const paint = 'currentColor'
  return (
    <svg
      width={size}
      height={Math.round(size * 0.82)}
      viewBox="0 0 100 82"
      fill="none"
      role="img"
      aria-label="RBT 360"
      className={className}
      style={style}
    >
      {LINKS.map(([a, b, w], i) => (
        <line
          key={i}
          x1={NODES[a][0]} y1={NODES[a][1]}
          x2={NODES[b][0]} y2={NODES[b][1]}
          stroke={paint} strokeWidth={w} strokeLinecap="round"
        />
      ))}
      {NODES.map(([cx, cy, r], i) => <circle key={i} cx={cx} cy={cy} r={r} fill={paint} />)}
    </svg>
  )
}

// The «RBT 360» wordmark — the OFFICIAL logotype image (exact brand font).
// `size` keeps the old font-size contract: the image cap-height ≈ 0.72×size,
// so existing call sites keep their visual scale. `withTagline` swaps in the
// official lockup that carries CONNECT·BUILD·SCALE under the word.
// The official art is navy+gradient — on dark/photo surfaces pass `mono`,
// which falls back to the styled-text version in surface ink.
export function RbtWordmark({ size = 18, mono = false, withTagline = false, style }) {
  if (!mono) {
    // tagline variant: word keeps the same cap-height; total grows 139/93.
    const h = Math.round(size * 0.72 * (withTagline ? 1.4946 : 1))
    return (
      <img
        src={withTagline ? BRAND_WORD_TAG_URL : BRAND_WORD_URL}
        alt="RBT 360"
        height={h}
        width={Math.round(h * (withTagline ? WORD_TAG_RATIO : WORD_RATIO))}
        draggable={false}
        style={{ display: 'inline-block', objectFit: 'contain', userSelect: 'none', ...style }}
      />
    )
  }
  return (
    <span
      dir="ltr"
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: '0.22em',
        fontWeight: 800,
        letterSpacing: '0.02em',
        lineHeight: 1,
        fontSize: size,
        fontFamily: "var(--font-brand, 'Montserrat', system-ui, sans-serif)",
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span style={{ color: 'var(--bm-ink, currentColor)' }}>RBT</span>
      <span
        style={
          mono
            ? { color: 'var(--bm-ink, currentColor)' }
            : {
                background: BRAND_GRADIENT_CSS,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }
        }
      >
        360
      </span>
    </span>
  )
}

export function RbtTagline({ size = 9, mono = false, style }) {
  const dot = (c) => (
    <span aria-hidden="true" style={mono ? { opacity: 0.6 } : { color: c }}>·</span>
  )
  return (
    <span
      dir="ltr"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.7em',
        fontWeight: 700,
        fontSize: size,
        fontFamily: "var(--font-brand, 'Montserrat', system-ui, sans-serif)",
        letterSpacing: '0.34em',
        textIndent: '0.34em', /* re-center: letter-spacing trails the last glyph */
        lineHeight: 1,
        color: 'var(--bm-ink-2, currentColor)',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span>CONNECT</span>{dot(BRAND_GRADIENT[1])}<span>BUILD</span>{dot(BRAND_GRADIENT[2])}<span>SCALE</span>
    </span>
  )
}

export default function BrandMark({ variant = 'lockup', size = 30, mono = false, tagline = false, className, style }) {
  if (variant === 'mark') return <RbtMark size={size} mono={mono} className={className} style={style} />

  if (variant === 'full') {
    // The official full lockup already carries the wordmark + tagline baked
    // into the artwork — render it whole. Mono surfaces keep the drawn stack.
    if (!mono) {
      return (
        <img
          src={BRAND_FULL_URL}
          alt="RBT 360 — CONNECT · BUILD · SCALE"
          width={Math.round(size * 2.2)}
          draggable={false}
          className={className}
          style={{ display: 'inline-block', objectFit: 'contain', userSelect: 'none', ...style }}
        />
      )
    }
    return (
      <span
        className={className}
        style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(size * 0.14), ...style }}
      >
        <RbtMark size={size} mono={mono} />
        <RbtWordmark size={Math.max(13, Math.round(size * 0.34))} mono={mono} />
        {tagline && <RbtTagline size={Math.max(8, Math.round(size * 0.105))} mono={mono} />}
      </span>
    )
  }

  // default: row lockup (nav / footer)
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.32), ...style }}
    >
      <RbtMark size={size} mono={mono} />
      {mono ? (
        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: tagline ? Math.round(size * 0.14) : 0 }}>
          <RbtWordmark size={Math.max(14, Math.round(size * 0.58))} mono />
          {tagline && <RbtTagline size={Math.max(7, Math.round(size * 0.17))} mono />}
        </span>
      ) : (
        // official logotype image — the tagline variant carries the official
        // CONNECT·BUILD·SCALE lockup baked into the artwork
        <RbtWordmark size={Math.max(14, Math.round(size * 0.58))} withTagline={tagline} />
      )}
    </span>
  )
}
