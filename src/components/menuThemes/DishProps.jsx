// DishProps — the DRAWING half of the editorial theme's dish styling layer.
// It paints, behind and around a transparent dish cutout:
//   1. a surface the dish stands on (marble / wood / steel / slate / linen /
//      shelf) built only from CSS gradients plus a few hand-authored SVG
//      strokes — no image assets, nothing to download on mobile data,
//   2. a soft contact shadow so the cutout does not float,
//   3. a scatter of garnish props (petals, herbs, citrus, spices, ice...) drawn
//      as layered inline SVG, each one placed and animated individually.
//
// Everything here is decoration: aria-hidden, pointer-events none, and it never
// states anything about the dish. The catalogue, the placement maths and the
// per-item defaults all live in lib/dishProps.js.
//
// Mounting: render INSIDE the photo box (a position:relative element), before
// the <img>. The component emits two sibling layers — one that paints behind
// the photo, one that paints in front of it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { resolveDishProps } from '../../lib/dishProps.js'
import '../../styles/dishprops.css'

// ---------------------------------------------------------------------------
// Garnish art. Every element is drawn on a 64x64 field with a base silhouette,
// a shade pass and a highlight pass, so it reads as a lit object rather than a
// flat sticker. No <defs>/gradients on purpose: dozens of instances share the
// document and gradient ids would collide (and cost more to composite).
// ---------------------------------------------------------------------------

// lemon flesh wedges, computed once
const CITRUS_SEGMENTS = Array.from({ length: 8 }, (_, i) => {
  const r = 21
  const a0 = ((i * 45 + 4) * Math.PI) / 180
  const a1 = (((i + 1) * 45 - 4) * Math.PI) / 180
  const x0 = (32 + Math.cos(a0) * r).toFixed(1)
  const y0 = (32 + Math.sin(a0) * r).toFixed(1)
  const x1 = (32 + Math.cos(a1) * r).toFixed(1)
  const y1 = (32 + Math.sin(a1) * r).toFixed(1)
  return `M32 32L${x0} ${y0}A${r} ${r} 0 0 1 ${x1} ${y1}Z`
})

// rosemary-style needles down a sprig stem
const SPRIG_NEEDLES = Array.from({ length: 11 }, (_, i) => {
  const y = 54 - i * 4.3
  const side = i % 2 ? 1 : -1
  const lean = 3 + i * 0.25
  return { d: `M${32 + side * 1.5} ${y.toFixed(1)}L${(32 + side * (10 + (i % 3))).toFixed(1)} ${(y - lean).toFixed(1)}` }
})

function ArtHibiscusPetal() {
  return (
    <>
      <path d="M31 3c10 4 18 15 20 27 2 13-3 25-14 31-4 2-8 2-11-1C18 53 12 41 13 29 14 16 21 6 31 3z" fill="#7c1027" />
      <path d="M31 3c-10 3-17 13-18 26-1 12 5 24 13 31 2 2 4 2 6 2-7-10-11-22-10-34 1-9 4-17 9-25z" fill="#4c0917" />
      <path d="M50 27c4 9 3 19-3 26 4-10 5-18 3-26z" fill="#b13148" />
      <path d="M29 10c-4 11-5 24-1 36" stroke="#a71f3a" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity=".85" />
      <path d="M24 16c-2 5-3 10-3 15" stroke="#c04a5e" strokeWidth="1.1" fill="none" strokeLinecap="round" opacity=".5" />
    </>
  )
}

function ArtMintLeaf() {
  return (
    <>
      <path d="M32 3q6 6 11 10 4-1 5 3 3 5 5 9 3 2 1 5 1 6-1 11 0 4-3 6-2 5-6 8-5 4-12 8-7-4-12-8-4-3-6-8-3-2-3-6-2-5-1-11-2-3 1-5 2-4 5-9 1-4 5-3 5-4 11-10z" fill="#2f8244" />
      <path d="M31 8c-5 6-9 11-11 17-3 8-3 17 0 23 2 5 6 9 11 12V8z" fill="#1c5730" opacity=".55" />
      <path d="M32 8v45" stroke="#82cf90" strokeWidth="1.5" strokeLinecap="round" opacity=".9" />
      <g stroke="#6cbb7c" strokeWidth=".9" opacity=".55" fill="none">
        <path d="M32 18l-11 8M32 18l11 8M32 29l-13 9M32 29l13 9M32 40l-9 7M32 40l9 7" />
      </g>
      <path d="M26 12c-4 4-7 9-8 14" stroke="rgba(255,255,255,.32)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </>
  )
}

function ArtLemonSlice() {
  return (
    <>
      <circle cx="32" cy="32" r="29" fill="#d29d1d" />
      <circle cx="32" cy="32" r="26" fill="#f7ecc2" />
      <circle cx="32" cy="32" r="22" fill="#eec33c" />
      <g fill="#f6d762">
        {CITRUS_SEGMENTS.map((d, i) => <path key={i} d={d} />)}
      </g>
      <circle cx="32" cy="32" r="3.4" fill="#fbf0c8" opacity=".9" />
      <path d="M14 16a26 26 0 0 1 15-8" stroke="rgba(255,255,255,.45)" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <circle cx="32" cy="32" r="29" fill="none" stroke="#a8770f" strokeWidth="1.2" opacity=".6" />
    </>
  )
}

function ArtLemonWedge() {
  return (
    <>
      <path d="M3 36c0 20 58 20 58 0z" fill="#d9a71f" />
      <path d="M7 36c1 14 49 14 50 0z" fill="#faf0c4" />
      <path d="M10 36c1 11 43 11 44 0z" fill="#eec240" />
      <g stroke="#fbf1cd" strokeWidth="1.3" opacity=".85" fill="none">
        <path d="M32 36v11M32 36l-11 8M32 36l11 8M32 36l-17 5M32 36l17 5" />
      </g>
      <path d="M3 36h58" stroke="rgba(255,255,255,.35)" strokeWidth="1.6" />
      <path d="M6 39c1 8 8 13 16 15" stroke="rgba(0,0,0,.16)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </>
  )
}

function ArtGarlicClove() {
  return (
    <>
      <path d="M32 5c10 5 17 17 17 29 0 12-7 22-17 25-10-3-17-13-17-25 0-12 7-24 17-29z" fill="#efe6d4" />
      <path d="M32 5c10 5 17 17 17 29 0 12-7 22-17 25 6-7 9-17 9-27S38 12 32 5z" fill="#d5c6ac" />
      <path d="M31 9c-4 9-6 18-6 26 0 8 2 15 6 21" stroke="#c6b498" strokeWidth="1.3" fill="none" opacity=".8" />
      <path d="M30 8c1-4 3-6 4-6s2 4 1 7z" fill="#ab8f68" />
      <path d="M24 21c2-6 5-10 8-12" stroke="rgba(255,255,255,.55)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </>
  )
}

function ArtChilli() {
  return (
    <>
      <path d="M31 15c11 3 17 16 17 28 0 10-5 18-10 18s-9-7-9-16c0-9 2-15 2-21 0-4-2-7 0-9z" fill="#c02a1e" />
      <path d="M31 15c11 3 17 16 17 28 0 10-5 18-10 18 4-4 6-11 6-19 0-11-4-22-13-27z" fill="#89170f" />
      <path d="M36 25c3 7 4 14 4 20" stroke="rgba(255,255,255,.35)" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M31 16c-3-4-4-8-3-11" stroke="#4a7c32" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      <path d="M24 15c4-3 10-3 13 1-3 3-11 3-13-1z" fill="#5b933d" />
    </>
  )
}

function ArtPeppercorn() {
  return (
    <>
      <circle cx="32" cy="32" r="25" fill="#3b2a1f" />
      <path d="M32 7a25 25 0 1 1 0 50 25 25 0 0 0 0-50z" fill="#251811" />
      <g stroke="#1c120c" strokeWidth="2" fill="none" opacity=".75" strokeLinecap="round">
        <path d="M18 22c6 3 8 10 6 17M40 15c-3 7-2 14 3 19M26 50c3-5 9-7 15-5" />
      </g>
      <ellipse cx="23" cy="22" rx="6" ry="4" fill="rgba(255,255,255,.24)" transform="rotate(-32 23 22)" />
    </>
  )
}

function ArtSesame() {
  return (
    <>
      <path d="M32 6c9 5 15 14 15 25s-6 20-15 25c-9-5-15-14-15-25s6-20 15-25z" fill="#f1e4c4" />
      <path d="M32 6c9 5 15 14 15 25s-6 20-15 25c5-6 8-15 8-25s-3-19-8-25z" fill="#d9c69b" />
      <ellipse cx="26" cy="22" rx="4.5" ry="7" fill="rgba(255,255,255,.55)" transform="rotate(-18 26 22)" />
    </>
  )
}

function ArtCoffeeBean() {
  return (
    <g transform="rotate(-16 32 32)">
      <ellipse cx="32" cy="32" rx="17" ry="25" fill="#4d2c18" />
      <path d="M32 7c9 0 17 11 17 25s-8 25-17 25c6-7 10-16 10-25S38 14 32 7z" fill="#33190d" />
      <path d="M32 8c-5 10-5 38 0 48" stroke="#291308" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <path d="M22 17c-3 8-3 22 0 30" stroke="#6d4224" strokeWidth="4" fill="none" strokeLinecap="round" opacity=".7" />
      <path d="M23 16c2-4 5-7 8-8" stroke="rgba(255,255,255,.22)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </g>
  )
}

function ArtIceCube() {
  return (
    <>
      <path d="M32 6L55 18 32 30 9 18z" fill="rgba(217,238,248,.58)" />
      <path d="M9 18l23 12v25L9 43z" fill="rgba(140,183,205,.46)" />
      <path d="M55 18L32 30v25l23-12z" fill="rgba(186,220,236,.5)" />
      <g stroke="rgba(255,255,255,.55)" strokeWidth="1.3" fill="none" strokeLinejoin="round">
        <path d="M32 6L55 18 32 30 9 18zM9 18v25l23 12 23-12V18M32 30v25" />
      </g>
      <g stroke="rgba(255,255,255,.34)" strokeWidth="1.1" fill="none" strokeLinecap="round">
        <path d="M18 26l7 8-3 9M45 25l-6 9 4 8M30 12l6 4" />
      </g>
      <path className="dp-shine" d="M13 22l16 9v6l-16-9z" fill="rgba(255,255,255,.62)" />
    </>
  )
}

function ArtParsley() {
  const leaf = 'M32 44c-8-6-12-17-9-26 2-6 8-8 11-3 5 8 4 21-2 29z'
  return (
    <>
      <path d="M32 44c0 6 0 11-1 16" stroke="#2d6b34" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <g fill="#2b7c3a">
        <path d={leaf} transform="rotate(-40 32 46)" />
        <path d={leaf} transform="rotate(40 32 46)" />
        <path d={leaf} />
      </g>
      <g fill="#1d5a29" opacity=".45">
        <path d="M32 44c-8-6-12-17-9-26-5 9-3 20 9 26z" transform="rotate(-40 32 46)" />
        <path d="M32 44c-8-6-12-17-9-26-5 9-3 20 9 26z" />
      </g>
      <g stroke="#8ad494" strokeWidth="1" fill="none" opacity=".65">
        <path d="M32 42c-2-8-2-16 0-22" />
        <path d="M32 42c-2-8-2-16 0-22" transform="rotate(-40 32 46)" />
        <path d="M32 42c-2-8-2-16 0-22" transform="rotate(40 32 46)" />
      </g>
    </>
  )
}

function ArtTomato() {
  return (
    <>
      <circle cx="32" cy="37" r="23" fill="#c92f22" />
      <path d="M32 14a23 23 0 1 1 0 46c9-6 14-15 14-23s-5-17-14-23z" fill="#941810" />
      <path d="M32 13c-4-3-9-4-12-2 2 4 6 6 10 6-4 2-7 5-7 9 4 0 8-3 9-7 1 4 5 7 9 7 0-4-3-7-7-9 4 0 8-2 10-6-3-2-8-1-12 2z" fill="#3f7a2e" />
      <path d="M31 13V7" stroke="#4d8a35" strokeWidth="2.8" fill="none" strokeLinecap="round" />
      <ellipse className="dp-shine" cx="23" cy="28" rx="7" ry="4.4" fill="rgba(255,255,255,.42)" transform="rotate(-34 23 28)" />
    </>
  )
}

function ArtOlive() {
  return (
    <>
      <ellipse cx="32" cy="35" rx="17" ry="22" fill="#4c5f24" />
      <path d="M32 13c9 0 17 10 17 22s-8 22-17 22c6-6 9-14 9-22s-3-16-9-22z" fill="#32411a" />
      <path d="M32 13V8" stroke="#6d7c3a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <ellipse cx="25" cy="26" rx="5" ry="7.5" fill="rgba(226,236,190,.32)" transform="rotate(-20 25 26)" />
    </>
  )
}

function ArtCardamom() {
  return (
    <>
      <path d="M32 5c8 6 12 17 12 27s-4 21-12 27c-8-6-12-17-12-27S24 11 32 5z" fill="#bccb8d" />
      <path d="M32 5c8 6 12 17 12 27s-4 21-12 27c4-8 6-17 6-27s-2-19-6-27z" fill="#9aab6e" />
      <g stroke="#8d9e63" strokeWidth="1.3" fill="none" opacity=".85">
        <path d="M26 15c-2 11-2 23 0 34M32 9v46M38 15c2 11 2 23 0 34" />
      </g>
      <path d="M32 5V1" stroke="#8a9a5e" strokeWidth="2" strokeLinecap="round" />
      <path d="M27 16c-2 9-2 19 0 28" stroke="rgba(255,255,255,.35)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </>
  )
}

function ArtCinnamonStick() {
  return (
    <>
      <rect x="5" y="22" width="50" height="20" rx="9" fill="#8a4a22" />
      <path d="M8 38h44" stroke="#6a3517" strokeWidth="2.4" strokeLinecap="round" opacity=".7" />
      <path d="M10 32h34" stroke="#7a3f1c" strokeWidth="1.6" strokeLinecap="round" opacity=".6" />
      <path d="M10 27h38" stroke="rgba(255,255,255,.18)" strokeWidth="2.4" strokeLinecap="round" />
      <ellipse cx="52" cy="32" rx="6" ry="10" fill="#6d3818" />
      <path d="M52 24c5 3 5 13 0 16-3-2-3-14 0-16z" fill="#9c5629" />
      <path d="M52 28c2 1 2 6 0 7" stroke="#c07a3f" strokeWidth="1.2" fill="none" />
    </>
  )
}

function ArtSaltCrystals() {
  return (
    <>
      <path d="M16 41l9-9 9 7-9 9z" fill="#f4f2ea" />
      <path d="M25 32l9 7-9 9z" fill="#d8d3c5" />
      <path d="M31 29l10-7 8 9-9 7z" fill="#fbfaf5" />
      <path d="M41 22l8 9-9 7z" fill="#dedac9" />
      <path d="M40 43l8-4 4 8-8 3z" fill="#f0eee5" />
      <path d="M48 39l4 8-8 3z" fill="#cfcabb" />
      <circle cx="20" cy="26" r="2.2" fill="#eeece2" />
      <circle cx="52" cy="27" r="1.7" fill="#e4e0d2" />
      <circle cx="34" cy="50" r="1.9" fill="#f3f1e8" />
    </>
  )
}

function ArtHerbSprig() {
  return (
    <>
      <path d="M32 61c-2-16-2-34 0-53" stroke="#3f5c2b" strokeWidth="2.8" fill="none" strokeLinecap="round" />
      <g stroke="#4f7d34" strokeWidth="2.6" fill="none" strokeLinecap="round">
        {SPRIG_NEEDLES.map((n, i) => <path key={i} d={n.d} />)}
      </g>
      <g stroke="#6ea24a" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity=".75">
        {SPRIG_NEEDLES.map((n, i) => <path key={i} d={n.d} />)}
      </g>
      <path d="M32 22c-1-6-1-11 0-15" stroke="#87bd60" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity=".8" />
    </>
  )
}

const ART = {
  hibiscusPetal: ArtHibiscusPetal,
  mintLeaf: ArtMintLeaf,
  lemonSlice: ArtLemonSlice,
  lemonWedge: ArtLemonWedge,
  garlicClove: ArtGarlicClove,
  chilli: ArtChilli,
  peppercorn: ArtPeppercorn,
  sesame: ArtSesame,
  coffeeBean: ArtCoffeeBean,
  iceCube: ArtIceCube,
  parsley: ArtParsley,
  tomato: ArtTomato,
  olive: ArtOlive,
  cardamom: ArtCardamom,
  cinnamonStick: ArtCinnamonStick,
  saltCrystals: ArtSaltCrystals,
  herbSprig: ArtHerbSprig,
}

// ---------------------------------------------------------------------------
// Surface art. The material itself is CSS (gradients keyed on data-surface in
// dishprops.css); these strokes add the irregularity a gradient cannot fake:
// veins in marble, grain in wood, the brush pass on steel, fractures in slate,
// folds in linen. Drawn on a 100x40 field, stretched across the plane.
// ---------------------------------------------------------------------------
function SurfaceArt({ grain }) {
  if (grain === 'marble') {
    return (
      <svg className="dp-grain" viewBox="0 0 100 40" preserveAspectRatio="none" focusable="false">
        <g fill="none" strokeLinecap="round">
          <path d="M-4 11c14 3 22-3 34 1s18 8 30 5 24-6 44-2" stroke="rgba(255,255,255,.14)" strokeWidth=".7" />
          <path d="M-4 19c18-2 25 6 40 5s22-7 36-5 20 5 32 3" stroke="rgba(255,255,255,.09)" strokeWidth=".5" />
          <path d="M6 30c12 2 18-4 30-2s16 6 28 4 20-5 40-1" stroke="rgba(255,255,255,.07)" strokeWidth=".9" />
          <path d="M12 6c9 4 14 1 22 4" stroke="rgba(201,119,58,.16)" strokeWidth=".6" />
          <path d="M58 26c10 3 16-2 26 1" stroke="rgba(201,119,58,.12)" strokeWidth=".6" />
        </g>
      </svg>
    )
  }
  if (grain === 'wood' || grain === 'shelf') {
    return (
      <svg className="dp-grain" viewBox="0 0 100 40" preserveAspectRatio="none" focusable="false">
        <g fill="none" strokeLinecap="round">
          <path d="M-2 8c20-2 32 3 52 1s32-3 52-1" stroke="rgba(28,16,9,.42)" strokeWidth=".8" />
          <path d="M-2 14c22 2 30-2 50 0s34 2 54 0" stroke="rgba(28,16,9,.26)" strokeWidth=".5" />
          <path d="M-2 21c18-3 34 2 52 0s30-2 52 1" stroke="rgba(28,16,9,.34)" strokeWidth=".7" />
          <path d="M-2 28c24 3 32-2 52 0s28 3 52 0" stroke="rgba(28,16,9,.22)" strokeWidth=".5" />
          <path d="M-2 34c20-2 34 2 52 1s30-2 52 0" stroke="rgba(28,16,9,.3)" strokeWidth=".8" />
          <path d="M22 10c5 4 5 12 0 17" stroke="rgba(28,16,9,.3)" strokeWidth=".6" />
          <path d="M70 12c6 4 6 11 0 15" stroke="rgba(28,16,9,.24)" strokeWidth=".6" />
        </g>
      </svg>
    )
  }
  if (grain === 'steel') {
    return (
      <svg className="dp-grain" viewBox="0 0 100 40" preserveAspectRatio="none" focusable="false">
        <g fill="none" strokeLinecap="round" stroke="rgba(255,255,255,.13)">
          <path d="M4 9h38" strokeWidth=".4" />
          <path d="M52 13h40" strokeWidth=".4" />
          <path d="M10 22h56" strokeWidth=".35" />
          <path d="M30 31h62" strokeWidth=".4" />
          <path d="M2 35h30" strokeWidth=".3" />
        </g>
      </svg>
    )
  }
  if (grain === 'slate') {
    return (
      <svg className="dp-grain" viewBox="0 0 100 40" preserveAspectRatio="none" focusable="false">
        <g fill="none" strokeLinecap="round">
          <path d="M-2 13l16 3 12-4 20 5 18-3 20 4 18-2" stroke="rgba(255,255,255,.08)" strokeWidth=".6" />
          <path d="M-2 26l22 2 14-3 24 4 16-2 28 3" stroke="rgba(0,0,0,.4)" strokeWidth=".7" />
          <path d="M18 6l6 9-4 8" stroke="rgba(255,255,255,.05)" strokeWidth=".5" />
          <path d="M72 8l-5 10 6 9" stroke="rgba(255,255,255,.05)" strokeWidth=".5" />
        </g>
      </svg>
    )
  }
  if (grain === 'linen') {
    return (
      <svg className="dp-grain" viewBox="0 0 100 40" preserveAspectRatio="none" focusable="false">
        <g fill="none" strokeLinecap="round">
          <path d="M-2 12c14 6 22-4 36 1s24 8 38 2 20-6 30-2" stroke="rgba(255,255,255,.07)" strokeWidth="1.6" />
          <path d="M-2 22c16 5 24-5 38 0s22 7 36 2 20-4 30-1" stroke="rgba(0,0,0,.28)" strokeWidth="1.8" />
          <path d="M-2 31c18 4 26-4 40 1s24 6 38 1" stroke="rgba(255,255,255,.05)" strokeWidth="1.4" />
        </g>
      </svg>
    )
  }
  return null
}

// ---------------------------------------------------------------------------

const reducedMotion = () => {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch (_) { return false }
}

function PropEl({ p }) {
  const Art = ART[p.id]
  if (!Art) return null
  return (
    <span
      className={`dp-prop dp-m-${p.motion}${p.idle ? ' dp-has-idle' : ''}${p.shine ? ' dp-has-shine' : ''}`}
      data-flip={p.flip ? '1' : undefined}
      style={{
        '--x': `${p.x}%`,
        '--y': `${p.y}%`,
        // Unitless: the stylesheet turns this into cqmin, so a prop is sized
        // against the SMALLER side of the photo box. Sizing by width while
        // positioning by height made props enormous on the panoramic cutouts
        // this theme is built around (a 2029x651 photo is three times wider
        // than it is tall, so a "9% wide" garnish came out 28% of the height).
        '--w': `${p.w}`,
        '--r': `${p.rot}deg`,
        '--dx': `${p.dx}px`,
        '--d': `${p.delay}ms`,
      }}
    >
      <span className="dp-arrive">
        <span className="dp-idle">
          <svg viewBox="0 0 64 64" focusable="false" aria-hidden="true"><Art /></svg>
        </span>
      </span>
    </span>
  )
}

/**
 * <DishProps item={it} active={inview} variant="list" />
 *   item    — the menu item document (reads item.surface / item.props)
 *   active  — true while the dish owns the viewport. Arrival plays once and
 *             stays settled; the idle life only runs while active, so scrolled
 *             past dishes stop costing anything.
 *   variant — 'list' (default) or 'stage' (quieter, shorter plane)
 *   catName — optional category name, feeds the automatic styling match
 */
export default function DishProps({ item, active = false, variant = 'list', catName = '' }) {
  const [settled, setSettled] = useState(false)
  const reduced = useRef(reducedMotion())
  const { surface, props, plane } = useMemo(
    () => resolveDishProps(item, { variant, catName }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item && item.id, item && item.surface, item && item.props, variant, catName],
  )

  // latch: once a dish has settled it never replays, so scrolling back up does
  // not re-drop every garnish in the menu
  useEffect(() => { if (active) setSettled(true) }, [active])
  useEffect(() => { if (reduced.current) setSettled(true) }, [])

  if (!surface && !props.length) return null
  const live = active && !reduced.current
  const back = props.filter((p) => p.depth === 'back')
  const front = props.filter((p) => p.depth !== 'back')

  return (
    <>
      <span
        className={`dp-root dp-behind dp-${variant}${settled ? ' in' : ''}${live ? ' live' : ''}`}
        data-surface={surface ? surface.id : undefined}
        style={{ '--dp-plane': `${plane}%` }}
        aria-hidden="true"
      >
        {surface && (
          <span className="dp-plane">
            <SurfaceArt grain={surface.grain} />
            <span className="dp-horizon" />
            {surface.reflective && <span className="dp-reflect" />}
          </span>
        )}
        {surface && <span className="dp-contact" />}
        {back.map((p) => <PropEl key={p.key} p={p} />)}
      </span>
      <span
        className={`dp-root dp-front dp-${variant}${settled ? ' in' : ''}${live ? ' live' : ''}`}
        aria-hidden="true"
      >
        {front.map((p) => <PropEl key={p.key} p={p} />)}
      </span>
    </>
  )
}
