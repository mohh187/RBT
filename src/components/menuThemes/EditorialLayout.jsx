// EditorialLayout — skin 'editorial' («المجلة الداكنة»): magazine menu.
// One dish per screen inside a vertical page-scroll stage (hidden scrollbars),
// the photo FIRST and the price under it, amber ingredient amounts, a huge
// low-opacity vertical category label, and a current/total progress read-out
// (Latin digits). Item open = EditorialItemStage below: a FLIP photo-expand
// into a full-screen stage (transform/opacity only) with staggered content and
// the COMPLETE dish record — gallery, story, facts, allergens, offer, stock,
// variants, modifiers and «يُطلب معه» pairings.
//
// The room this theme dresses is a warm Sudanese fish house: red-brown brick,
// walnut tables, rattan chairs, kerosene lanterns, painted clay pots and woven
// straw baskets. So the canvas carries a WALL, the primary buttons are BRICKS,
// and each dish screen hangs one room ornament — lantern, clay pot or woven
// basket — behind the content.
// Both themes are first-class: every colour here comes from an --edt-* token
// and index.css re-declares the whole set under [data-theme='light'].
//
// THE WALL IS THE VENUE'S, NOT THE THEME'S. It used to be one hard-coded brick
// tile in index.css that the owner could not touch at all. It is now built here
// from resolveWall(tenant): nine bonds, six finishes, the venue's own clay and
// mortar, joint width and contrast, or a photograph of its actual room, with
// blend, filter, blur, tint and opacity over the top. See "THE WALL" below and
// styles/menuwall.css. The stylesheet's own --edt-wall tile survives only as the
// fallback for a venue that has never opened the editor.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n, pickLang } from '../../lib/i18n.jsx'
import Icon from '../Icon.jsx'
import ItemFx from '../ItemFx.jsx'
import { Stepper, Empty } from '../ui.jsx'
import { Price } from '../Riyal.jsx'
import { usePortalRoot } from '../PortalRoot.jsx'
import { hasStory } from '../DishStory.jsx'
import { offerForItem, discountedPrice, itemOfferLabel } from '../../lib/offers.js'
// Surface + garnish scatter behind the dish cutout (see lib/dishProps.js).
import DishProps from './DishProps.jsx'
// The ONE contract for how a dish is composed: backdrop, photo, effect, entrance,
// the venue's placed layers, the wall the whole room is set against, how one
// dish is joined to the next, and the objects the venue hangs in its room.
import {
  resolveComposition, bgStyle, imgStyle,
  resolveWall, wallStyle, layerStyle,
  resolveSections, resolveDecor, decorStyle,
} from '../../lib/dishComposition.js'
import '../../styles/menuwall.css'

// Built by a parallel agent — lazy + catch so a missing module never crashes
// the menu; it simply renders nothing until the file exists.
const DishHotspots = lazy(() => import('../DishHotspots.jsx').catch(() => ({ default: () => null })))

const EASE_OUT_QUART = 'cubic-bezier(0.25, 1, 0.5, 1)'
const prefersReduced = () => {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
}

// Ingredient line: digit runs (amounts) render in the amber accent.
const AMT_RE = /([0-9]+(?:[.,][0-9]+)?)/g
function AmberAmounts({ text }) {
  const parts = String(text || '').split(AMT_RE)
  return parts.map((p, i) => (i % 2 ? <b key={i} className="edt-amt">{p}</b> : <span key={i}>{p}</span>))
}

const isOut = (it) => it.available === false || (it.trackStock && (it.stock || 0) <= 0)
const lowStock = (it) => (it.trackStock && (it.stock || 0) > 0 && (it.stock || 0) <= 5 ? it.stock : 0)
const paragraphsOf = (body) => String(body || '').split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean)

// Dish photos in this theme are often WIDE transparent cutouts (a plate shot
// panoramically, e.g. 2029x651). One fixed box letterboxes those into a thin
// strip. Reading the natural ratio lets the CSS give each shape its own stage:
// 'wide' bleeds to the screen edges, 'tall' is height-capped, 'std' fills.
function useImgFit() {
  const [fit, setFit] = useState('')
  const nodeRef = useRef(null)
  const read = (n) => {
    if (!n || !n.naturalWidth || !n.naturalHeight) return
    const r = n.naturalWidth / n.naturalHeight
    setFit(r >= 1.9 ? 'wide' : r <= 0.86 ? 'tall' : 'std')
  }
  // ref callback too: a cached photo is already complete before onLoad fires
  const bind = (n) => { nodeRef.current = n; read(n) }
  return { fit, bind, nodeRef, onLoad: (e) => read(e.currentTarget) }
}

// ===========================================================================
// THE WALL — the room the whole menu is set against.
//
// It used to be ONE hard-coded brick tile in index.css with no controls at all:
// the venue could not change its bond, its colour, its age or swap it for a
// photograph of its own room («الطوب الخلفي لا استطيع التحكم فيه وليس لديه
// تخصيص»). Everything below is now driven by resolveWall(tenant), which is the
// same contract the admin editor writes.
//
// ASSET-FREE ON PURPOSE. Every pattern is one inline-SVG data URI plus CSS
// gradients, built here from the venue's own colours. Nothing is downloaded,
// nothing is cached, nothing can 404 — EXCEPT the 'image' pattern, which is the
// venue's own uploaded photograph and is the only network request the wall can
// ever make.
//
// The PATTERN is the bond (how the units are laid). The FINISH is the material
// state (age, fracture, sheen, coarseness, limewash) and is what makes brick
// read as a wall rather than as a checkerboard, so it is applied in two places:
// inside the tile (per-unit tone, arris, worn nibbles, hairline fractures,
// chipped corners, ragged edges) and over the whole wall (large-scale patches,
// crack runs, sheen bands, grain, limewash).
// ===========================================================================

const WHITE = [255, 255, 255]
const BLACK = [0, 0, 0]
const HEX6 = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
const HEX3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i

function toRgb(v, dflt) {
  const s = String(v || '').trim()
  const m6 = HEX6.exec(s)
  if (m6) return [parseInt(m6[1], 16), parseInt(m6[2], 16), parseInt(m6[3], 16)]
  const m3 = HEX3.exec(s)
  if (m3) return [parseInt(m3[1] + m3[1], 16), parseInt(m3[2] + m3[2], 16), parseInt(m3[3] + m3[3], 16)]
  return dflt
}
const cl255 = (v) => Math.max(0, Math.min(255, Math.round(v)))
const mixRgb = (a, b, t) => [cl255(a[0] + (b[0] - a[0]) * t), cl255(a[1] + (b[1] - a[1]) * t), cl255(a[2] + (b[2] - a[2]) * t)]
// positive lightens toward white, negative darkens toward black
const shade = (c, amt) => (amt >= 0 ? mixRgb(c, WHITE, amt) : mixRgb(c, BLACK, -amt))
const hexOf = (c) => `#${c.map((v) => cl255(v).toString(16).padStart(2, '0')).join('')}`
const rgbaOf = (c, a) => `rgba(${cl255(c[0])},${cl255(c[1])},${cl255(c[2])},${Math.round(a * 1000) / 1000})`
const n2 = (v) => Math.round(v * 100) / 100
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// Deterministic noise. The wall must be IDENTICAL on every render and on every
// diner's phone — a re-shuffling wall would flicker on each state change, so
// nothing here ever calls Math.random().
function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A data URI only has to escape what a URL and a CSS url() actually reserve.
// encodeURIComponent also escapes space, equals, colon and slash, which are
// legal here and which this markup is full of — putting them back is worth
// roughly a quarter of the payload on the busiest walls, and it is the same
// transform the standard svg-to-data-uri tooling makes. Attributes are quoted
// with apostrophes throughout so the outer double quotes are never at risk.
const URI_KEEP = { '%20': ' ', '%3D': '=', '%3A': ':', '%2F': '/' }
const svgUrl = (body, w, h) => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${n2(w)} ${n2(h)}'>${body}</svg>`
  const enc = encodeURIComponent(svg).replace(/%[\dA-F]{2}/g, (m) => URI_KEEP[m] || m.toLowerCase())
  return `url("data:image/svg+xml,${enc}")`
}

// ---- the finish, as it acts INSIDE the tile ----
// rx      : how sharp the arris is (a fired brick has a crisp edge, an old one
//           has a rounded, rubbed one)
// jitter  : how far each single unit's tone may wander from the venue's colour.
//           This is the difference between a wall and a swatch.
// arris   : strength of the lit top edge, bed: strength of the shadowed foot
// ragged  : draw the face as a jittered polygon instead of a rectangle
const WALL_FIN = {
  clean: { rx: 1.6, jitter: 0.05, arris: 0.22, bed: 0.26 },
  aged: { rx: 2.9, jitter: 0.14, arris: 0.11, bed: 0.33, worn: true },
  cracked: { rx: 2, jitter: 0.1, arris: 0.15, bed: 0.31, crack: true, chip: true },
  glossy: { rx: 2.4, jitter: 0.05, arris: 0.44, bed: 0.36, sheen: true },
  rough: { rx: 0.5, jitter: 0.16, arris: 0.1, bed: 0.34, ragged: 1.15 },
  whitewash: { rx: 2.2, jitter: 0.08, arris: 0.18, bed: 0.26, worn: true },
}

// A face drawn as a jittered polygon: the edge wanders, so a rough brick or a
// rubble stone stops reading as a rounded rectangle.
function raggedPath(x, y, w, h, j, rand) {
  const pts = []
  const sx = Math.max(3, Math.round(w / 30))
  const sy = Math.max(2, Math.round(h / 26))
  const jit = () => (rand() * 2 - 1) * j
  for (let i = 0; i <= sx; i++) pts.push([x + (w * i) / sx + jit(), y + jit()])
  for (let i = 1; i <= sy; i++) pts.push([x + w + jit(), y + (h * i) / sy + jit()])
  for (let i = sx - 1; i >= 0; i--) pts.push([x + (w * i) / sx + jit(), y + h + jit()])
  for (let i = sy - 1; i >= 1; i--) pts.push([x + jit(), y + (h * i) / sy + jit()])
  return `M${pts.map((p) => `${n2(p[0])} ${n2(p[1])}`).join('L')}Z`
}

// ONE laid unit — brick, stone or board. Base tone, lit arris, shadowed bed,
// then whatever the finish adds on top of it.
function face(x, y, w, h, ctx) {
  const { rand, base, fin, mortar } = ctx
  const tone = shade(base, (rand() * 2 - 1) * fin.jitter)
  const rag = fin.ragged || ctx.ragged || 0
  let s = rag
    ? `<path d='${raggedPath(x, y, w, h, rag, rand)}' fill='${hexOf(tone)}'/>`
    : `<rect x='${n2(x)}' y='${n2(y)}' width='${n2(w)}' height='${n2(h)}' rx='${fin.rx}' fill='${hexOf(tone)}'/>`
  const lip = Math.min(1.7, h / 7)
  if (fin.arris > 0) s += `<rect x='${n2(x + 1.2)}' y='${n2(y)}' width='${n2(Math.max(0, w - 2.4))}' height='${n2(lip)}' fill='${rgbaOf(shade(tone, 0.66), fin.arris)}'/>`
  if (fin.bed > 0) s += `<rect x='${n2(x + 1.2)}' y='${n2(y + h - lip * 1.2)}' width='${n2(Math.max(0, w - 2.4))}' height='${n2(lip * 1.2)}' fill='${rgbaOf(shade(tone, -0.72), fin.bed)}'/>`
  // glossy: a wet highlight across the upper half of every single unit, which is
  // what separates a glazed brick from a matt one at this size
  if (fin.sheen) s += `<rect x='${n2(x)}' y='${n2(y)}' width='${n2(w)}' height='${n2(h * 0.44)}' rx='${fin.rx}' fill='${rgbaOf(WHITE, 0.11)}'/>`
  // aged: the corners are rubbed away and the mortar has crept over them
  if (fin.worn && rand() < 0.6) {
    const cx = rand() < 0.5 ? x + 2 + rand() * 6 : x + w - 2 - rand() * 6
    const cy = rand() < 0.5 ? y + 1 : y + h - 1
    s += `<circle cx='${n2(cx)}' cy='${n2(cy)}' r='${n2(1.8 + rand() * 3.4)}' fill='${rgbaOf(mortar, 0.5 + rand() * 0.3)}'/>`
  }
  // cracked: a hairline fracture wandering across the face
  if (fin.crack && rand() < 0.55) {
    let px = x + 2 + rand() * (w - 4)
    let py = y
    const pts = [`${n2(px)} ${n2(py)}`]
    const steps = 3 + Math.floor(rand() * 3)
    for (let i = 0; i < steps; i++) {
      px += (rand() * 2 - 1) * (w / 7)
      py += h / steps
      pts.push(`${n2(px)} ${n2(Math.min(y + h, py))}`)
    }
    s += `<path d='M${pts.join('L')}' fill='none' stroke='${rgbaOf(shade(tone, -0.8), 0.55)}' stroke-width='${n2(0.5 + rand() * 0.5)}' stroke-linecap='round'/>`
  }
  // cracked: a chipped corner, mortar showing through the broken arris
  if (fin.chip && rand() < 0.4) {
    const c = 3 + rand() * 5
    const left = rand() < 0.5
    const top = rand() < 0.5
    const cx = left ? x : x + w
    const cy = top ? y : y + h
    const dx = left ? c : -c
    const dy = top ? c : -c
    s += `<path d='M${n2(cx)} ${n2(cy)}L${n2(cx + dx)} ${n2(cy)}L${n2(cx)} ${n2(cy + dy)}Z' fill='${rgbaOf(mortar, 0.85)}'/>`
    s += `<path d='M${n2(cx + dx)} ${n2(cy)}L${n2(cx)} ${n2(cy + dy)}' fill='none' stroke='${rgbaOf(shade(tone, -0.7), 0.5)}' stroke-width='0.8'/>`
  }
  return s
}

// ---- the bonds ----
// Each one is a genuinely different geometry, not the same tile recoloured.
// Every tile is seamless by construction: the joint at a tile edge is exactly
// half the joint width on each side, so the wall never shows a repeat line.
function wallTile(w, base, mortar) {
  const g = w.grout
  const fin = WALL_FIN[w.finish] || WALL_FIN.clean
  const ctx = { rand: mulberry(0x51a7 + w.grout * 7), base, fin, mortar }
  const bg = (tw, th) => `<rect width='${n2(tw)}' height='${n2(th)}' fill='${hexOf(mortar)}'/>`

  // RUNNING BOND — every course offset by half a brick. The ordinary wall.
  if (w.pattern === 'running') {
    const bw = 118
    const bh = 46
    const tw = bw + g
    const th = 2 * (bh + g)
    let s = bg(tw, th)
    s += face(g / 2, g / 2, bw, bh, ctx)
    s += face(g / 2 - tw / 2, bh + g + g / 2, bw, bh, ctx)
    s += face(g / 2 + tw / 2, bh + g + g / 2, bw, bh, ctx)
    return { img: svgUrl(s, tw, th), w: tw, h: th }
  }

  // STACK BOND — no offset at all: every joint lines up, head and bed, into a
  // strict grid. The most modern-looking of the bonds, and unmistakably not
  // running bond at a glance.
  if (w.pattern === 'stack') {
    const bw = 118
    const bh = 46
    const tw = bw + g
    const th = bh + g
    let s = bg(tw, th)
    s += face(g / 2, g / 2, bw, bh, ctx)
    return { img: svgUrl(s, tw, th), w: tw, h: th }
  }

  // ROMAN — a long, thin unit (roughly nine to one) laid in a THIRD bond, so
  // the offsets march across three courses instead of alternating. Reads as a
  // long horizontal wall rather than a stack of blocks.
  if (w.pattern === 'roman') {
    const bw = 214
    const bh = 24
    const tw = bw + g
    const th = 3 * (bh + g)
    let s = bg(tw, th)
    for (let k = 0; k < 3; k++) {
      const y = k * (bh + g) + g / 2
      const xo = (k * tw) / 3
      for (let j = -1; j <= 1; j++) s += face(g / 2 + xo + j * tw, y, bw, bh, ctx)
    }
    return { img: svgUrl(s, tw, th), w: tw, h: th }
  }

  // BASKETWEAVE — square blocks of TWO parallel bricks, alternating between
  // lying and standing like a chequerboard. A woven floor, not a bond.
  if (w.pattern === 'basket') {
    const bh = 46
    const len = 2 * bh + g
    const blk = len + g
    const tw = 2 * blk
    let s = bg(tw, tw)
    const block = (bx, by, vertical) => {
      if (vertical) {
        return face(bx + g / 2, by + g / 2, bh, len, ctx)
          + face(bx + g / 2 + bh + g, by + g / 2, bh, len, ctx)
      }
      return face(bx + g / 2, by + g / 2, len, bh, ctx)
        + face(bx + g / 2, by + g / 2 + bh + g, len, bh, ctx)
    }
    s += block(0, 0, false)
    s += block(blk, 0, true)
    s += block(0, blk, true)
    s += block(blk, blk, false)
    return { img: svgUrl(s, tw, tw), w: tw, h: tw }
  }

  // HERRINGBONE — every brick's END abuts the next brick's SIDE, and the whole
  // field is turned forty-five degrees so the courses read as chevrons.
  //
  // The repeat is real, not eyeballed: with a two-to-one brick of side u the
  // pattern is generated by the lattice (4u, 0) and (-u, u), which has the
  // rectangular sub-lattice 4u by 4u. Turning that by forty-five degrees turns
  // those two vectors into (S, 0) and (0, S) with S = 4u * root two, so the
  // OUTER tile is square and still seamless. That is why the rotation is done
  // with patternTransform on an SVG <pattern> rather than by rotating the tile
  // itself, which could never repeat.
  if (w.pattern === 'herringbone') {
    const S = 192
    const u = S / (4 * Math.SQRT2)
    const pw = 4 * u
    // <pattern> CLIPS its tile, it does not wrap it, so every lattice copy whose
    // brick touches the tile has to be emitted — and every copy that does not
    // must not, or a fifth of the wall's weight would be geometry no eye ever
    // sees. The test is per BRICK, not per copy: the two halves of a copy sit in
    // different places and one of them is very often outside on its own.
    const near = (x, y, bw, bh) => x + bw > -0.5 && x < pw + 0.5 && y + bh > -0.5 && y < pw + 0.5
    let bricks = ''
    for (let b = -2; b <= 4; b++) {
      for (let a = -1; a <= 2; a++) {
        const ox = a * 4 * u - b * u
        const oy = b * u
        if (near(ox, oy, 2 * u, u)) bricks += face(ox + g / 2, oy + g / 2, 2 * u - g, u - g, ctx)
        if (near(ox + 2 * u, oy, u, 2 * u)) bricks += face(ox + 2 * u + g / 2, oy + g / 2, u - g, 2 * u - g, ctx)
      }
    }
    const body = `<defs><pattern id='hb' width='${n2(pw)}' height='${n2(pw)}' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'>${bricks}</pattern></defs>`
      + bg(S, S)
      + `<rect width='${S}' height='${S}' fill='url(#hb)'/>`
    return { img: svgUrl(body, S, S), w: S, h: S }
  }

  // STONE — coursed rubble. Course heights wander, every course is split into a
  // different number of stones, and every face is a jittered polygon, so no two
  // stones in the tile are the same shape. Widths per course sum EXACTLY to the
  // tile width, which is what keeps it seamless despite the randomness.
  if (w.pattern === 'stone') {
    const tw = 352
    const th = 265
    const rows = 5
    const rowH = th / rows
    const rand = ctx.rand
    const sctx = { ...ctx, ragged: 1.7 }
    const jit = [0]
    for (let i = 1; i < rows; i++) jit.push((rand() * 2 - 1) * 7)
    jit.push(0)
    let s = bg(tw, th)
    for (let r = 0; r < rows; r++) {
      const yTop = r * rowH + jit[r] + (r === 0 ? 2.5 : 0)
      const yBot = (r + 1) * rowH + jit[r + 1] - (r === rows - 1 ? 2.5 : 0)
      const count = 4 + Math.floor(rand() * 3)
      const raw = []
      let sum = 0
      for (let i = 0; i < count; i++) { const v = 0.62 + rand(); raw.push(v); sum += v }
      const widths = raw.map((v) => (v / sum) * tw)
      // the run starts a whole tile early so the course's phase carries across
      // the seam; anything that lands entirely off the tile is never drawn
      let x = rand() * tw - tw
      let i = 0
      while (x < tw) {
        const wd = widths[i % count]
        if (x + wd > -1) s += face(x + g / 2, yTop + g / 2, wd - g, yBot - yTop - g, sctx)
        x += wd
        i += 1
      }
    }
    return { img: svgUrl(s, tw, th), w: tw, h: th }
  }

  // WOOD — horizontal boards. The grain is a set of sine curves whose period
  // divides the tile width exactly, so both the value AND the slope match at
  // the seam and the boards run on for ever without a visible join.
  if (w.pattern === 'wood') {
    const tw = 480
    const bh = 52
    const th = 3 * (bh + g)
    const rand = ctx.rand
    let s = bg(tw, th)
    for (let k = 0; k < 3; k++) {
      const y = k * (bh + g) + g / 2
      const tone = shade(base, (rand() * 2 - 1) * (fin.jitter * 0.8))
      s += face(0, y, tw, bh, { ...ctx, base: tone })
      for (let ln = 0; ln < 3; ln++) {
        const y0 = y + bh * (0.2 + 0.28 * ln) + (rand() * 2 - 1) * 3
        const amp = 1.5 + rand() * 3.2
        const per = 1 + Math.floor(rand() * 3)
        const pts = []
        const steps = 16
        for (let i = 0; i <= steps; i++) {
          const px = (tw * i) / steps
          pts.push(`${n2(px)} ${n2(y0 + Math.sin((2 * Math.PI * per * i) / steps) * amp)}`)
        }
        s += `<path d='M${pts.join('L')}' fill='none' stroke='${rgbaOf(shade(tone, -0.55), 0.2 + rand() * 0.18)}' stroke-width='${n2(0.8 + rand() * 1.1)}'/>`
      }
      const kx = 60 + rand() * (tw - 140)
      const ky = y + bh * (0.35 + rand() * 0.3)
      s += `<ellipse cx='${n2(kx)}' cy='${n2(ky)}' rx='9' ry='5.4' fill='none' stroke='${rgbaOf(shade(tone, -0.6), 0.3)}' stroke-width='1.6'/>`
      s += `<ellipse cx='${n2(kx)}' cy='${n2(ky)}' rx='4.4' ry='2.6' fill='${rgbaOf(shade(tone, -0.5), 0.34)}'/>`
    }
    return { img: svgUrl(s, tw, th), w: tw, h: th }
  }

  return null
}

// ---- long, jagged crack runs that cross MANY units ----
// A fracture that stops at a brick edge is a scratch; a wall cracks through its
// courses, so this pass is drawn over the whole surface, not inside the tile.
function crackArt(base, tw, th, seed) {
  const rand = mulberry(seed)
  const ink = rgbaOf(shade(base, -0.82), 0.5)
  const lip = rgbaOf(shade(base, 0.5), 0.16)
  let s = ''
  const run = (sx, sy, segs, spread) => {
    let x = sx
    let y = sy
    const pts = [`${n2(x)} ${n2(y)}`]
    let ang = rand() * Math.PI * 2
    for (let i = 0; i < segs; i++) {
      ang += (rand() * 2 - 1) * spread
      const len = 14 + rand() * 34
      x += Math.cos(ang) * len
      y += Math.sin(ang) * len
      pts.push(`${n2(x)} ${n2(y)}`)
    }
    const d = `M${pts.join('L')}`
    return `<path d='${d}' fill='none' stroke='${lip}' stroke-width='2.2' stroke-linecap='round'/>`
      + `<path d='${d}' fill='none' stroke='${ink}' stroke-width='${n2(0.6 + rand() * 0.8)}' stroke-linecap='round'/>`
  }
  for (let k = 0; k < 4; k++) {
    const sx = rand() * tw
    const sy = rand() * th
    s += run(sx, sy, 6 + Math.floor(rand() * 5), 0.85)
    // a fork off the main run, which is what a real fracture does
    s += run(sx + (rand() * 2 - 1) * 30, sy + (rand() * 2 - 1) * 30, 2 + Math.floor(rand() * 3), 1.1)
  }
  return svgUrl(s, tw, th)
}

// ---- grain ----
// feTurbulence, so the coarseness is real noise rather than a repeated dot.
// `discrete` turns the ramp into sparse specks (grit) instead of even grain.
function noiseArt(freq, oct, amt, seed, size, discrete) {
  const fn = discrete
    ? `<feFuncA type='discrete' tableValues='0 0 0 0 0 0 ${amt}'/>`
    : `<feFuncA type='linear' slope='${amt}'/>`
  const body = `<filter id='n' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>`
    + `<feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='${oct}' seed='${seed}' stitchTiles='stitch'/>`
    + `<feColorMatrix type='saturate' values='0'/>`
    + `<feComponentTransfer>${fn}</feComponentTransfer></filter>`
    + `<rect width='${size}' height='${size}' filter='url(#n)'/>`
  return svgUrl(body, size, size)
}

// ---- the finish, as it acts over the WHOLE wall ----
// Large-scale passes. Sizes are deliberately non-commensurate primes so the
// combined repeat period is thousands of pixels and the eye never finds it.
function finishOverlays(w, base, mortar, mortarRaw) {
  const px = (v) => `${Math.max(3, Math.round(v * w.scale))}px`
  const L = (i, sw, sh) => ({ i, s: sw == null ? '100% 100%' : `${px(sw)} ${px(sh)}`, r: sw == null ? 'no-repeat' : 'repeat', p: 'center' })
  const dark = (a) => rgbaOf(BLACK, a)
  const light = (a) => rgbaOf(WHITE, a)
  const clear = rgbaOf(BLACK, 0)
  const clearW = rgbaOf(WHITE, 0)
  const out = []

  if (w.finish === 'aged') {
    out.push(L(`radial-gradient(58% 46% at 24% 30%, ${dark(0.34)}, ${clear} 72%)`, 431, 289))
    out.push(L(`radial-gradient(46% 38% at 72% 66%, ${light(0.1)}, ${clearW} 74%)`, 317, 383))
    out.push(L(`radial-gradient(34% 30% at 58% 12%, ${dark(0.24)}, ${clear} 70%)`, 251, 197))
    out.push(L(`radial-gradient(40% 34% at 12% 78%, ${rgbaOf(mortar, 0.18)}, ${rgbaOf(mortar, 0)} 72%)`, 349, 233))
    out.push(L(noiseArt(0.75, 3, 0.11, 7, 190), 190, 190))
  } else if (w.finish === 'cracked') {
    out.push(L(crackArt(base, 397, 281, 0x9e11), 397, 281))
    out.push(L(crackArt(base, 271, 419, 0x3f02), 271, 419))
    out.push(L(`radial-gradient(52% 44% at 30% 26%, ${dark(0.24)}, ${clear} 74%)`, 373, 269))
    out.push(L(`radial-gradient(40% 34% at 74% 70%, ${light(0.08)}, ${clearW} 72%)`, 293, 347))
    out.push(L(noiseArt(0.68, 3, 0.09, 11, 180), 180, 180))
  } else if (w.finish === 'glossy') {
    out.push(L(`linear-gradient(112deg, ${clearW} 20%, ${light(0.2)} 37%, ${light(0.05)} 47%, ${clearW} 62%)`, 641, 557))
    out.push(L(`linear-gradient(112deg, ${clearW} 54%, ${light(0.12)} 66%, ${clearW} 75%)`, 383, 331))
    out.push(L(`linear-gradient(196deg, ${light(0.07)} 0%, ${clearW} 34%, ${dark(0.1)} 100%)`, 457, 419))
  } else if (w.finish === 'rough') {
    out.push(L(noiseArt(0.28, 2, 0.24, 3, 320), 320, 320))
    out.push(L(noiseArt(0.9, 4, 0.32, 19, 160), 160, 160))
    out.push(L(noiseArt(0.42, 1, 0.55, 29, 240, true), 240, 240))
    out.push(L(`radial-gradient(46% 40% at 34% 62%, ${dark(0.16)}, ${clear} 74%)`, 337, 269))
  } else if (w.finish === 'whitewash') {
    // The limewash takes its hue from the venue's OWN mortar colour rather than
    // pure white, so a warm lime stays warm and a grey one stays grey.
    const wash = shade(mortarRaw, 0.66)
    const wa = (a) => rgbaOf(wash, a)
    out.push(L(`repeating-linear-gradient(92deg, ${wa(0.26)} 0 3px, ${wa(0)} 3px 15px, ${wa(0.14)} 15px 20px, ${wa(0)} 20px 43px)`))
    out.push(L(`radial-gradient(66% 54% at 30% 22%, ${wa(0.7)}, ${wa(0.2)} 66%, ${wa(0)} 86%)`, 389, 293))
    out.push(L(`radial-gradient(58% 48% at 76% 72%, ${wa(0.6)}, ${wa(0)} 78%)`, 307, 421))
    out.push(L(`radial-gradient(44% 40% at 12% 74%, ${wa(0.44)}, ${wa(0)} 76%)`, 233, 347))
    out.push(L(`linear-gradient(0deg, ${wa(0.28)}, ${wa(0.28)})`))
    out.push(L(noiseArt(0.8, 2, 0.08, 23, 170), 170, 170))
  } else {
    // clean: a plain, well-kept wall still needs a little life or it reads as a
    // flat swatch — one very soft tonal drift and nothing else.
    out.push(L(`radial-gradient(50% 44% at 30% 30%, ${light(0.05)}, ${clearW} 76%)`, 421, 337))
    out.push(L(`radial-gradient(44% 38% at 74% 72%, ${dark(0.09)}, ${clear} 74%)`, 293, 379))
  }
  return out
}

// PLASTER is not a bond, it is a surface: no units, no joints. It is built from
// trowel-flattened tonal drifts plus grain rather than from a tile, and it is
// the pattern to pick when the wall should carry the room's colour and let the
// food be the only texture on the screen.
function plasterOverlays(w, base, mortar) {
  const px = (v) => `${Math.max(3, Math.round(v * w.scale))}px`
  const L = (i, sw, sh) => ({ i, s: `${px(sw)} ${px(sh)}`, r: 'repeat', p: 'center' })
  const hi = shade(base, 0.16)
  const lo = shade(base, -0.16)
  return [
    L(`radial-gradient(64% 22% at 28% 34%, ${rgbaOf(hi, 0.55)}, ${rgbaOf(hi, 0)} 76%)`, 419, 263),
    L(`radial-gradient(58% 20% at 72% 64%, ${rgbaOf(lo, 0.5)}, ${rgbaOf(lo, 0)} 74%)`, 313, 349),
    L(`radial-gradient(46% 26% at 14% 78%, ${rgbaOf(mortar, 0.22)}, ${rgbaOf(mortar, 0)} 72%)`, 269, 211),
    L(`radial-gradient(52% 18% at 84% 18%, ${rgbaOf(hi, 0.34)}, ${rgbaOf(hi, 0)} 78%)`, 367, 233),
    L(noiseArt(0.85, 3, 0.09, 13, 200), 200, 200),
  ]
}

/**
 * wallPaint(wall) -> a complete inline style for the wall element.
 *
 * Layer order in `background-image` is TOP first, so it reads: the venue's
 * tint, then the finish, then the surface itself. Everything the contract calls
 * mood — blend, filter, blur, opacity — comes straight from wallStyle().
 */
// Exported so the SETTINGS preview paints its tiles with this exact generator.
// A second copy in the admin screen would drift from the menu the first time
// either changed, and the owner would be tuning a wall he is not actually
// getting. Pure function of resolveWall()'s output; its helpers stay local.
export function wallPaint(w) {
  if (!w) return null
  const base = toRgb(w.color, [138, 74, 44])
  const mortarRaw = toRgb(w.mortarColor, [185, 168, 147])
  // The joint contrast slider is a REAL mix, not an opacity: at zero the mortar
  // is the brick's own tone and the bond all but disappears; at one it is the
  // venue's mortar colour at full strength.
  const mortar = mixRgb(base, mortarRaw, 0.2 + 0.8 * w.mortar)

  const layers = []
  if (w.tint && w.tintAmount > 0) {
    const t = toRgb(w.tint, null)
    if (t) layers.push({ i: `linear-gradient(0deg, ${rgbaOf(t, w.tintAmount)}, ${rgbaOf(t, w.tintAmount)})`, s: '100% 100%', r: 'no-repeat', p: 'center' })
  }
  layers.push(...finishOverlays(w, base, mortar, mortarRaw))
  if (w.pattern === 'plaster') layers.push(...plasterOverlays(w, base, mortar))

  const imgs = layers.map((l) => l.i)
  const sizes = layers.map((l) => l.s)
  const reps = layers.map((l) => l.r)
  const poss = layers.map((l) => l.p)

  if (w.pattern === 'image') {
    // the venue's own photograph — the only thing on this wall that is fetched
    imgs.push(`url("${String(w.url).replace(/["\\]/g, '')}")`)
    sizes.push(w.scale === 1 ? 'cover' : `${Math.round(w.scale * 100)}%`)
    reps.push(w.scale === 1 ? 'no-repeat' : 'repeat')
    poss.push('center')
  } else {
    const tile = wallTile(w, base, mortar)
    if (tile) {
      imgs.push(tile.img)
      sizes.push(`${Math.max(6, Math.round(tile.w * w.scale))}px ${Math.max(6, Math.round(tile.h * w.scale))}px`)
      reps.push('repeat')
      poss.push('center')
    }
  }

  const style = { ...wallStyle(w) }
  style.backgroundImage = imgs.join(', ')
  style.backgroundSize = sizes.join(', ')
  style.backgroundRepeat = reps.join(', ')
  style.backgroundPosition = poss.join(', ')
  style.backgroundColor = hexOf(w.pattern === 'plaster' || w.pattern === 'image' ? base : mortar)
  return style
}

function EdtWall({ wall }) {
  const paint = useMemo(() => wallPaint(wall), [wall])
  if (!paint) return null
  return (
    <span
      className="edt-wall" style={paint} aria-hidden="true"
      data-pattern={wall.pattern} data-finish={wall.finish} data-blur={wall.blur ? '1' : undefined}
    />
  )
}

// ---- how one dish is joined to the next (resolveSections) ----
//
// Five numbers that were all hard-coded before, the worst of them a fade to
// solid canvas over the bottom 40 per cent of EVERY dish — with one dish per
// screen that is a black band between dishes that the venue never asked for and
// could not remove. They become custom properties here and the .edt-* block of
// index.css does the rest; the MODE lands as a data attribute on .edt-stage.
// `dividerColor` falls back to the theme's own hairline rather than to nothing,
// so choosing «خط فاصل» without choosing a colour still draws a line.
const sectionVars = (s) => ({
  '--edt-h': `${s.height}svh`,
  '--edt-gap': `${s.gap}px`,
  '--edt-fade': s.fade,
  '--edt-radius': `${s.radius}px`,
  '--edt-divider': s.dividerColor || 'var(--edt-line)',
})

// ===========================================================================
// THE BRICK HEADER — «اتحكم في الهيدر والازرار لتكون طوب».
//
// The app bar is NOT inside this component (it is rendered by DinerBar, a
// sibling of the whole menu), so the theme cannot reach it with a descendant
// selector. It is dressed the way the app already dresses that bar from the
// outside: the chrome custom properties, set on the portal root, plus one rule
// in the .edt-* block of index.css keyed on [data-edt-head='brick'].
//
// THE HEADER IS THE SAME WALL, not a second brick. The bond, the clay, the
// mortar, the joint and the finish all come from resolveWall(tenant); only three
// things are changed, and each for a stated reason:
//   * the unit is scaled DOWN, because a course sized for a whole room shows one
//     brick face inside a 56px bar and stops reading as a wall,
//   * blur / blend / opacity are dropped, because a header that inherits the
//     room's blur is an unreadable smear,
//   * a fixed dark scrim is laid over the top. That last one is what makes the
//     contrast PROVABLE: whatever colour the venue paints its room, every pixel
//     of the header is at most (1 - a) of that colour plus the scrim, so white
//     ink is 4.98:1 against the lightest pixel the header can possibly produce
//     (a pure-white wall) and 9.8-12.7:1 against this venue's own clay.
// ===========================================================================

const HEADER_SCRIM = 'rgba(46,18,8,.62)'
// Goes through the contract like everything else — resolveWall() now carries
// `header`, so the theme has no raw tenant reads left. resolveWall returns null
// when the room wall is off, hence the fallback read for the "brick header with
// no room wall" case, which the block below deliberately supports.
const headerBrickOn = (tenant) => {
  const w = resolveWall(tenant)
  if (w) return w.header
  return !!(tenant && tenant.menuWall && tenant.menuWall.header)
}
// A venue can ask for a brick header with the room wall switched OFF. The toggle
// still has to do something, so it falls back to the contract's own default clay
// rather than silently doing nothing.
const HEADER_FALLBACK_WALL = {
  pattern: 'running', url: '', finish: 'clean', color: '#8a4a2c', mortarColor: '#b9a893',
  scale: 1, opacity: 1, blend: 'normal', filter: '', blur: 0, mortar: 0.5, grout: 3,
  tint: '', tintAmount: 0,
}

function headerBrickVars(wall) {
  const w = {
    ...(wall || HEADER_FALLBACK_WALL),
    scale: clampNum((wall ? wall.scale : 1) * 0.55, 0.3, 0.8),
    opacity: 1, blur: 0, blend: 'normal', filter: '',
  }
  const p = wallPaint(w)
  if (!p) return null
  const scrim = `linear-gradient(0deg, ${HEADER_SCRIM}, ${HEADER_SCRIM})`
  return {
    '--edt-hd-img': `${scrim}, ${p.backgroundImage}`,
    '--edt-hd-size': `auto, ${p.backgroundSize}`,
    '--edt-hd-rep': `no-repeat, ${p.backgroundRepeat}`,
    '--edt-hd-pos': `center, ${p.backgroundPosition}`,
    '--edt-hd-color': p.backgroundColor,
  }
}

// ---- the venue's OWN hung objects (resolveDecor / decorStyle) ----
//
// This replaces the drawn lantern / clay pot / woven basket entirely. A
// photograph of the owner's own lantern beats any stroke I can author, and the
// rings of the drawn basket are what he saw as a stupid shadow.
//
// GEOMETRY. decorStyle() places a piece at (x, y) as percentages of its ANCHOR
// BOX and sizes it in `cqmin`, so every anchor box below has `container-type:
// size` AND a definite height (styles/menuwall.css).
//
// x and y are read as distances from the corner the anchor NAMES. That is the
// only reading under which «علّق نسخة مقابلة» — the same numbers on the opposite
// anchor — puts the second lantern where the eye expects it:
//   *-start  : x from the inline-start edge
//   *-end    : x from the inline-end edge
//   *-center : x is the OFFSET from the centre, so 0 is dead centre
//   page-bottom-* : y from the bottom edge
//
// WHY THE OFFSETS ARE REWRITTEN INSTEAD OF USED AS THEY COME. decorStyle()
// centres a piece on its anchor point with `transform: translate(-50%, -50%)`,
// and `transform` is PHYSICAL — its X axis is left-to-right whatever the
// document direction is. `inset-inline-start`, which decorStyle pairs it with,
// is not: under <html dir="rtl"> — which is every Arabic diner reading this menu
// — it resolves to `right`, so the translate pulls the piece a whole width away
// from the point it was supposed to be centred on. The pairing only works when
// the offset is a physical `left`/`top`, so every case below is solved into one:
// the arithmetic is done here in plain percentages (no calc(), so a negative x
// cannot produce `calc(100% - -20%)`), and the result is always the same corner
// the venue named. The same mismatch exists in layerStyle() — see the report.
const decorSide = (a) => (a.endsWith('-end') ? 'end' : a.endsWith('-center') ? 'center' : 'start')

// Exported for the SETTINGS placement tool, which drags a piece around a
// miniature of this room: it maps a stored (x, y) to a screen position with this
// exact function rather than a copy, because a copy would drift and the owner
// would be arranging lanterns against a diagram of a menu he is not getting.
export function decorPlace(d, rtl) {
  const st = decorStyle(d) || {}
  const place = { ...st }
  // The blend has to sit on the size container (it blends OUTWARD with the page
  // behind it, while the container's own containment isolates its children), and
  // the motion duration has to sit on the thing that actually moves — which is
  // the artwork, never the placement element. Swinging the placement element
  // would rotate its own centring offset and make the piece orbit its anchor
  // instead of pivoting on its top edge.
  const blend = place.mixBlendMode
  const dur = place.animationDuration
  delete place.mixBlendMode
  delete place.animationDuration
  delete place.insetInlineStart
  const side = decorSide(d.anchor)
  // does x count from the physical RIGHT edge? the inline-end anchor in an LTR
  // page, and the inline-start one in an RTL page
  const fromRight = (side === 'end') !== !!rtl
  const left = side === 'center'
    ? (rtl ? 50 - d.x : 50 + d.x)
    : (fromRight ? 100 - d.x : d.x)
  place.left = `${n2(left)}%`
  place.top = `${n2(d.anchor.startsWith('page-bottom') ? 100 - d.y : d.y)}%`
  // the same width for an engine that cannot resolve cqmin (see menuwall.css)
  place['--edt-dec-w-n'] = n2(d.w)
  return { place, blend, dur }
}

// The warm halo a lamp throws on the wall behind it. Drawn only when the venue
// asked for one; `motion: 'glow'` makes it breathe, and also breathes the piece
// itself so the motion is never invisible on a piece with no halo.
// Exported for the same reason decorPlace() is: the settings preview paints the
// halo with this function, not with a second one that could drift from it.
export const glowPaint = (d) => `radial-gradient(50% 50% at 50% 50%, ${rgbaOf(toRgb(d.glowColor, [245, 185, 66]), 0.62 * d.glow)}, transparent 70%)`

function EdtDecorPiece({ d, mv, rtl }) {
  const { place, blend, dur } = decorPlace(d, rtl)
  const outer = blend ? { mixBlendMode: blend } : undefined
  const motion = d.motion || undefined
  const art = dur ? { animationDuration: dur } : undefined
  const is3d = d.kind === 'model'
  return (
    <span className="edt-dec" style={outer} aria-hidden="true">
      <span className="edt-dec-p" style={place}>
        {d.glow > 0 ? (
          <span className="edt-dec-glow" data-motion={motion} style={{ background: glowPaint(d), ...(art || {}) }} />
        ) : null}
        {is3d
          ? (mv ? (
            <model-viewer
              className="edt-dec-mv" data-motion={motion} style={art} src={d.url}
              interaction-prompt="none" loading="eager" disable-zoom="" disable-tap=""
            />
          ) : null)
          : <img className="edt-dec-img" data-motion={motion} style={art} src={d.url} alt="" decoding="async" />}
      </span>
    </span>
  )
}

// One zone per anchor and per depth. Two zones rather than one because `front`
// is per piece and the zone is what carries the stacking level: a lantern in
// FRONT of the app bar and a pot BEHIND the menu cannot be children of the same
// stacking context.
function EdtDecorZones({ anchors, byAnchor, mv, rtl }) {
  const out = []
  anchors.forEach((a) => {
    const list = byAnchor[a] || []
    if (!list.length) return
    ;[true, false].forEach((front) => {
      const part = list.filter((d) => !!d.front === front)
      if (!part.length) return
      out.push(
        <span
          key={`${a}-${front ? 'f' : 'b'}`} className="edt-dec-zone"
          data-anchor={a} data-front={front ? '1' : '0'} aria-hidden="true"
        >
          {part.map((d, i) => <EdtDecorPiece key={`${d.id}-${i}`} d={d} mv={mv} rtl={rtl} />)}
        </span>,
      )
    })
  })
  return out.length ? out : null
}

const HEADER_ANCHORS = ['header-start', 'header-center', 'header-end']
const PAGE_ANCHORS = ['page-top-start', 'page-top-end', 'page-bottom-start', 'page-bottom-end']

// <model-viewer> is a custom element that has to be registered before it renders
// anything at all, and it is heavy — so it is imported only when the venue has
// actually hung a .glb, and the piece renders nothing until it is ready.
function useModelViewer(needed) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!needed) return undefined
    let alive = true
    import('../../lib/ar3d.js')
      .then((m) => m.loadModelViewer())
      .then(() => { if (alive) setReady(true) })
      .catch(() => { /* a viewer that will not load simply draws nothing */ })
    return () => { alive = false }
  }, [needed])
  return ready
}

// resolveWall() answers null both when the venue turned the wall OFF and when it
// has simply never opened the editor, and those two are not the same thing: a
// menu that is live today would silently lose its brick. So the wall engine only
// takes the canvas over once `menuWall.pattern` actually exists; until then the
// stylesheet's own --edt-wall tile stays exactly as it always was.
const wallConfigured = (tenant) => !!(tenant && tenant.menuWall && tenant.menuWall.pattern)

// ---- the venue's PLACED LAYERS (its own cut-out photographs) ----
//
// Three nested elements per layer, and each level exists for one reason:
//   .edt-lyr    is the SIZE CONTAINER — layerStyle() sizes a layer in `cqmin`,
//               a share of the box's SMALLER side, which only resolves against
//               a container-type: size ancestor. It also carries the blend
//               mode: an element blends OUTWARD with its parent's backdrop even
//               though its own containment isolates its children, so the blend
//               has to live here and nowhere deeper.
//   .edt-lyr-p  is the PLACEMENT — everything layerStyle() returns. It owns the
//               inline transform (the centring translate, rotation, flip).
//   img         is the layer itself, and the ONLY thing the idle motion moves.
//               The motion cannot go on .edt-lyr-p: the individual `rotate`
//               property composes BEFORE `transform`, so spinning that element
//               would swing its centring offset around and make the layer orbit
//               its anchor instead of turning on the spot.
function EdtLayer({ layer }) {
  const st = layerStyle(layer) || {}
  const place = { ...st }
  const blend = place.mixBlendMode
  delete place.mixBlendMode
  const outer = {}
  if (blend) outer.mixBlendMode = blend
  if (place.animationDelay) outer.animationDelay = place.animationDelay
  const anim = layer.anim && layer.anim !== 'none' ? layer.anim : undefined
  return (
    <span className="edt-lyr" style={outer} data-anim={anim} aria-hidden="true">
      <span className="edt-lyr-p" style={place}>
        <img className="edt-lyr-img" data-motion={layer.motion || undefined} src={layer.url} alt="" loading="lazy" decoding="async" />
      </span>
    </span>
  )
}

function EdtLayers({ list }) {
  if (!list || !list.length) return null
  return list.map((l, i) => <EdtLayer key={`${l.id}-${i}`} layer={l} />)
}

// ---- the shadow under the dish, and the reflection beside it ----
//
// «ظل غبي يظهر تحت المنتج». Both used to be drawn for EVERY dish that had a
// surface, with no way to remove them; they are OPT-IN per dish now and OFF
// until the venue asks, which is the default the owner is entitled to.
//
// The flag is read here and lands as a data attribute on the photo box, because
// the elements themselves are drawn by DishProps (styles/dishprops.css hides
// them unless one of these attributes is on an ancestor). Turning the SURFACE
// off still removes both outright — DishProps never mounts them without one.
//   item.contactShadow : true -> the dish casts a contact shadow on its surface
//   item.reflect       : true -> a polished surface shows a reflection under it
const truthy = (v) => v === true || v === 'true' || v === 1
const dpShadow = (it) => (it && truthy(it.contactShadow) ? '1' : undefined)
const dpReflect = (it) => (it && truthy(it.reflect) ? '1' : undefined)

/**
 * The item as DishProps should see it. Unchanged unless the dish carries real
 * placed layers, in which case the vector garnish is switched off and only the
 * surface it was already drawing is kept. A dish that never asked for either is
 * passed straight through, so this can never ADD decoration to a plain plate.
 */
function dishPropsItem(it, comp) {
  if (!it || !comp || !comp.layers.all.length) return it
  const p = it.props
  const decorated = !!(it.surface || (p && p !== 'none' && p !== ''))
  if (!decorated) return it
  const keep = it.surface || (p && typeof p === 'object' && !Array.isArray(p) && p.surface) || 'auto'
  return { ...it, props: { off: true, surface: keep } }
}

// ---------------------------------------------------------------------------
// PER-DISH COMPOSITION — the venue's own art direction for a single dish:
// the backdrop behind it, where the photo sits on that backdrop and how big it
// is, the filter and blend that marry the two, the shadow it casts, the live
// effect over it, and the way it arrives on screen.
//
// EVERY value comes from lib/dishComposition.js. Nothing here reads a raw item
// field and nothing here clamps, so the admin editor and this renderer read the
// same contract and cannot drift apart.
//
// WHY THE LAYER ORDER IS LOAD-BEARING
// mix-blend-mode blends an element with what is ALREADY PAINTED inside the
// nearest isolated group, so:
//   1. the backdrop must be painted BEFORE the photo (it is the photo's
//      blending backdrop), and after the theme's own glow and dish surface (so
//      the backdrop's own blend mode has something to act on too),
//   2. no element between the blending group and the photo may create a
//      stacking context — .edt-photo and .edt-comp therefore carry no z-index,
//      no transform, no filter and no isolation. See index.css (.edt-comp).
// In the list the blending group is .edt-sec (it sets isolation: isolate and
// paints the lamp/plaster gradient at z-index -1); in the stage it is
// .edt-stg-hero, which the FLIP transform isolates.
// ---------------------------------------------------------------------------

// A video backdrop is the same layer with a different kind of paint: reuse the
// module's opacity / blend / filter and swap background-image for the element.
// (bg.pos and bg.scale are already resolved and clamped by the module.)
function bgVideoStyle(bg) {
  const s = bgStyle(bg)
  if (!s) return undefined
  const out = { opacity: s.opacity, objectFit: 'cover', objectPosition: bg.pos }
  if (s.mixBlendMode) out.mixBlendMode = s.mixBlendMode
  if (s.filter) out.filter = s.filter
  if (bg.scale !== 1) { out.transform = `scale(${bg.scale})`; out.transformOrigin = bg.pos }
  return out
}

// The backdrop layer. Mounted as a direct child of the photo box (list) or the
// hero band (stage) so it fills that whole area, always behind the dish, always
// transparent to touch, and never anywhere near a line of text.
function EdtBackdrop({ bg }) {
  if (!bg) return null
  if (bg.kind === 'video') {
    // A moving backdrop is motion like any other: under prefers-reduced-motion
    // it holds its first frame instead of looping behind the dish.
    const still = prefersReduced()
    return (
      <video
        className="edt-backdrop" style={bgVideoStyle(bg)} src={bg.url} aria-hidden="true"
        autoPlay={!still} loop={!still} preload={still ? 'metadata' : 'auto'}
        muted playsInline
      />
    )
  }
  return <span className="edt-backdrop" style={bgStyle(bg) || undefined} aria-hidden="true" />
}

// The dish itself plus the effect that plays over it, in a box that is exactly
// the photo box — so a steam plume stays glued to the plate even after the
// photo has been moved, scaled or rotated.
//
// `anim` is the entrance the venue chose. The stylesheet plays it with the
// individual translate / scale / rotate properties, which COMPOSE with the
// composition's own inline transform instead of overwriting it.
function EdtDish({ comp, src, anim = '', bind = null, onLoad = null, fallback = 64 }) {
  const photo = imgStyle(comp.img, comp.shadow)
  return (
    <span className="edt-comp" data-anim={anim || undefined}>
      {src
        ? <img className="edt-dish" ref={bind} onLoad={onLoad} src={src} alt="" decoding="async" style={photo || undefined} />
        : <span className="edt-noimg"><Icon name="coffee" size={fallback} /></span>}
      {comp.fx ? (
        <span className="edt-fx" aria-hidden="true" style={photo && photo.transform ? { transform: photo.transform } : undefined}>
          <ItemFx kind={comp.fx} />
        </span>
      ) : null}
    </span>
  )
}

// '' is the theme's own default (no photo entrance, exactly as before) and
// 'none' is the venue asking for stillness — neither mounts an animation.
const animAttr = (comp) => (comp.anim && comp.anim !== 'none' ? comp.anim : '')

// THE DRAWN ORNAMENTS ARE GONE. This is where a lantern, a clay pot and a woven
// basket used to be hand-authored as SVG strokes and dropped behind every dish
// by section index. They were rejected as crude («الايقونات والعلامات بايخة»),
// and the basket's concentric rings were read as a stupid shadow under the food.
// Nothing replaces them in code: the venue hangs its OWN photographs now
// (resolveDecor / EdtDecorZones above), which is the only version of this that
// can ever look like the room it is meant to be.

// allItems / onQuickAdd are OPTIONAL — with them the venue's curated «يُطلب معه»
// pairings become tappable straight from the LIST row; without them the list
// still renders everything else, so an un-patched caller degrades quietly.
export default function EditorialLayout({ tenant = null, cats, itemsByCat, visibleItems, filtered, activeCat, onPickCat, currency, offers, stickyTop, onOpen, allItems = [], onQuickAdd = null, showPairings = true }) {
  const { t, lang, dir } = useI18n()
  const rtl = dir === 'rtl'
  const stageRef = useRef(null)
  const portalRoot = usePortalRoot()
  const [cur, setCur] = useState(0)

  // The venue's wall. Fingerprinted rather than watched by identity, so a new
  // tenant object with the same wall does not rebuild every data URI on screen.
  const wallOn = wallConfigured(tenant)
  const wallKey = wallOn ? JSON.stringify(tenant.menuWall) : ''
  const wall = useMemo(() => (wallKey ? resolveWall(tenant) : null), [wallKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const wallAttr = wallOn ? (wall ? wall.pattern : 'none') : undefined

  // HOW ONE DISH IS JOINED TO THE NEXT. Every one of these five numbers used to
  // be hard-coded, and the fade to solid canvas at the foot of every dish is
  // what produced the black band the venue could not remove.
  const sections = useMemo(() => resolveSections(tenant), [JSON.stringify(tenant && tenant.menuSections) || '']) // eslint-disable-line react-hooks/exhaustive-deps
  const secVars = sectionVars(sections)

  // The objects the venue has hung. Header pieces are portalled: the app bar is
  // not inside this component and .edt-wrap is an isolated stacking context, so
  // a piece rendered here could never sit in front of the bar.
  const decor = useMemo(() => resolveDecor(tenant), [JSON.stringify(tenant && tenant.menuDecor) || '']) // eslint-disable-line react-hooks/exhaustive-deps
  const mv = useModelViewer(decor.all.some((d) => d.kind === 'model'))

  // THE BRICK HEADER, dressed from outside (see headerBrickVars above).
  const headOn = headerBrickOn(tenant)
  const headVars = useMemo(() => (headOn ? headerBrickVars(wall) : null), [headOn, wallKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const node = portalRoot
    if (!node || !headVars) return undefined
    node.setAttribute('data-edt-head', 'brick')
    Object.entries(headVars).forEach(([k, v]) => node.style.setProperty(k, v))
    return () => {
      node.removeAttribute('data-edt-head')
      Object.keys(headVars).forEach((k) => node.style.removeProperty(k))
    }
  }, [portalRoot, headVars])

  const catName = (id) => {
    const c = (cats || []).find((x) => x.id === id)
    return c ? pickLang(c, 'name', lang) : (lang === 'ar' ? 'القائمة' : 'Menu')
  }
  // Category order when browsing everything; the filtered list when searching
  // or when a single category chip is active.
  const flat = useMemo(() => {
    if (filtered) return visibleItems
    const out = []
    ;(cats || []).forEach((c) => (itemsByCat[c.id] || []).forEach((it) => out.push(it)))
    ;(itemsByCat._uncat || []).forEach((it) => out.push(it))
    return out
  }, [filtered, visibleItems, cats, itemsByCat])

  // Progress: which section currently owns the viewport. Sections ride the
  // PAGE scroll (no inner scroller — it trapped the scroll under the hero),
  // so the IO root is the viewport itself.
  useEffect(() => {
    const root = stageRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setCur(Number(e.target.dataset.idx) || 0) })
    }, { threshold: 0.55 })
    root.querySelectorAll('.edt-sec').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [flat])

  return (
    <div className="edt-wrap" data-wall={wallAttr} style={{ '--edt-top': stickyTop, ...secVars }}>
      <EdtWall wall={wall} />
      <EdtDecorZones anchors={PAGE_ANCHORS} byAnchor={decor.byAnchor} mv={mv} rtl={rtl} />
      {portalRoot && decor.header.length
        ? createPortal(<EdtDecorZones anchors={HEADER_ANCHORS} byAnchor={decor.byAnchor} mv={mv} rtl={rtl} />, portalRoot)
        : null}
      {/* opaque sticky bar (outer) + its own scroller (inner): dish content can
          never bleed through the chips, and the fade lives outside the scroller */}
      <div className="edt-catbar">
        <div className="edt-cats scroll-x">
          <button type="button" className={`edt-chip ${activeCat === 'all' ? 'on' : ''}`} onClick={() => onPickCat('all')}>{t('all')}</button>
          {(cats || []).map((c) => (
            <button key={c.id} type="button" className={`edt-chip ${activeCat === c.id ? 'on' : ''}`} onClick={() => onPickCat(c.id)}>{pickLang(c, 'name', lang)}</button>
          ))}
        </div>
      </div>
      {flat.length === 0 ? (
        <div className="edt-empty"><Empty icon="menu" title={lang === 'ar' ? 'لا توجد أصناف' : 'No items'} /></div>
      ) : (
        <>
          <div className="edt-stage" ref={stageRef} data-sec={sections.mode}>
            {flat.map((it, i) => (
              <EdtSection
                key={it.id} it={it} idx={i} catLabel={catName(it.categoryId)}
                currency={currency} offers={offers} lang={lang} t={t} onOpen={onOpen}
                allItems={allItems} onQuickAdd={onQuickAdd} showPairings={showPairings}
              />
            ))}
          </div>
          <div className="edt-progress" aria-hidden="true">{cur + 1} / {flat.length}</div>
        </>
      )}
    </div>
  )
}

function EdtSection({ it, idx, catLabel, currency, offers, lang, t, onOpen, allItems = [], onQuickAdd = null, showPairings = true }) {
  const ref = useRef(null)
  const { fit, bind, nodeRef, onLoad } = useImgFit()
  const [inview, setInview] = useState(false)
  const [added, setAdded] = useState('')
  const addedTimer = useRef(0)
  useEffect(() => {
    const el = ref.current
    // No observer means no arrival signal, and the entrance animation below
    // starts the photo at opacity 0 — so fall straight through to "arrived"
    // rather than leaving a dish permanently invisible.
    if (!el || typeof IntersectionObserver === 'undefined') { setInview(true); return undefined }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => setInview(e.isIntersecting)), { threshold: 0.35 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => () => clearTimeout(addedTimer.current), [])

  const out = isOut(it)
  const low = lowStock(it)
  const offer = offerForItem(it, offers)
  const offerTag = offer ? itemOfferLabel(it, offers, currency) : ''
  const price = offer ? discountedPrice(it.price, offer) : it.price
  const name = pickLang(it, 'name', lang)
  const desc = pickLang(it, 'desc', lang)
  const ings = it.ingredients || []
  // the venue's art direction for THIS dish, at list size (item.listScale and
  // friends, falling back to the stage values for items saved before the split)
  const comp = useMemo(() => resolveComposition(it, { variant: 'list' }), [it])
  // REAL PHOTOGRAPHS BEAT DRAWINGS. The hand-drawn SVG garnish was rejected as
  // primitive, so once a dish carries the venue's OWN cut-out layers the theme
  // stops scattering vector props on top of them — two decoration systems on one
  // plate is what made it look busy rather than styled. The material the dish
  // stands on is untouched: `props: { off: true }` keeps the surface and drops
  // only the scatter, and 'auto' preserves whichever surface it already had.
  const dpItem = useMemo(() => dishPropsItem(it, comp), [it, comp])
  // FLIP origin: the photo's on-screen rect, so the stage grows out of it.
  // getBoundingClientRect already reports the TRANSFORMED box, so a dish the
  // venue has moved or scaled still hands the stage the rect a diner can see.
  const open = () => { if (!out) onOpen(it, nodeRef.current ? nodeRef.current.getBoundingClientRect() : null) }

  // «يُطلب معه» in the LIST, not only inside the opened dish: the venue's
  // curated item.pairings resolved against the live menu, exactly the rule the
  // stage below uses. Capped at three so the row never becomes a second menu.
  const pairs = useMemo(() => {
    const ids = showPairings && Array.isArray(it.pairings) ? it.pairings : []
    if (!ids.length || !allItems.length) return []
    return ids.map((id) => allItems.find((x) => x.id === id)).filter((x) => x && x.id !== it.id).slice(0, 3)
  }, [showPairings, it.pairings, it.id, allItems])

  // One tap adds the pairing to the cart when the caller wired onQuickAdd;
  // otherwise the chip opens that dish, which is still better than dead art.
  const pickPair = (p) => {
    if (isOut(p)) return
    if (!onQuickAdd) { onOpen(p, null); return }
    onQuickAdd(p)
    setAdded(p.id)
    clearTimeout(addedTimer.current)
    addedTimer.current = setTimeout(() => setAdded(''), 1500)
  }

  return (
    <section ref={ref} data-idx={idx} data-fit={fit || undefined} className={`edt-sec ${inview ? 'in' : ''} ${out ? 'is-out' : ''}`}>
      <span className="edt-side" aria-hidden="true">{catLabel}</span>
      <div className="edt-photo" data-fit={fit || undefined} data-dp-contact={dpShadow(it)} data-dp-reflect={dpReflect(it)}>
        <span className="edt-glow" aria-hidden="true" />
        {/* the material the dish stands on + its garnish scatter: the behind
            layer paints under the photo, the front layer over it. Arrival is
            tied to the same in-view flag the text uses. */}
        <DishProps item={dpItem} active={inview} catName={catLabel} />
        <EdtBackdrop bg={comp.bg} />
        <EdtLayers list={comp.layers.behind} />
        <EdtDish comp={comp} src={it.imageUrl} anim={animAttr(comp)} bind={bind} onLoad={onLoad} fallback={64} />
        <EdtLayers list={comp.layers.front} />
        <span className="edt-vignette" aria-hidden="true" />
        <button type="button" className="edt-photo-open" onClick={open} aria-label={name} tabIndex={-1} disabled={out} />
        {it.hotspots?.length ? <Suspense fallback={null}><DishHotspots hotspots={it.hotspots} /></Suspense> : null}
      </div>
      <div className="edt-main">
        <h2 className="edt-name">{name}</h2>
        <div className="edt-price">
          <Price value={price} currency={currency} lang={lang} />
          {offer && <span className="edt-was"><Price value={it.price} currency={currency} lang={lang} /></span>}
          {offerTag && <span className="edt-tag edt-tag-offer">{offerTag}</span>}
          {out && <span className="edt-tag edt-tag-out">{t('soldOut')}</span>}
          {!out && low ? <span className="edt-tag edt-tag-low">{lang === 'ar' ? `آخر ${low}` : `Only ${low} left`}</span> : null}
        </div>
        <div className="edt-facts">
          {it.calories ? <span className="edt-fact"><i>{lang === 'ar' ? 'سعرات' : 'Calories'}</i><b>{it.calories}</b></span> : null}
          {it.prepTime ? <span className="edt-fact"><i>{lang === 'ar' ? 'التحضير' : 'Prep'}</i><b>{it.prepTime} {t('minutesShort')}</b></span> : null}
          {it.serves ? <span className="edt-fact"><i>{lang === 'ar' ? 'يكفي' : 'Serves'}</i><b>{it.serves}</b></span> : null}
          {it.rating ? <span className="edt-fact"><i>{lang === 'ar' ? 'التقييم' : 'Rating'}</i><b>{it.rating}</b></span> : null}
        </div>
        {ings.length > 0 && (
          <div className="edt-ing">
            <span className="edt-ing-title">{lang === 'ar' ? 'المكونات' : 'Ingredients'}</span>
            <ul>
              {ings.slice(0, 6).map((g, i) => (
                <li key={i} style={{ transitionDelay: `${(0.18 + i * 0.05).toFixed(2)}s` }}><AmberAmounts text={pickLang(g, 'name', lang)} /></li>
              ))}
            </ul>
          </div>
        )}
        {desc && <p className="edt-desc">{desc}</p>}
        {pairs.length > 0 && (
          <div className="edt-lpairs">
            <span className="edt-ing-title">{lang === 'ar' ? 'يُطلب معه' : 'Goes well with'}</span>
            <div className="edt-lpair-row">
              {pairs.map((p) => {
                const pOut = isOut(p)
                const pOffer = offerForItem(p, offers)
                const done = added === p.id
                const label = pickLang(p, 'name', lang)
                const act = onQuickAdd ? t('addToCart') : (lang === 'ar' ? 'اعرض الطبق' : 'View dish')
                return (
                  <button
                    key={p.id} type="button" disabled={pOut}
                    className={`edt-lpair ${done ? 'done' : ''} ${pOut ? 'is-out' : ''}`}
                    onClick={() => pickPair(p)} aria-label={`${act} ${label}`}
                  >
                    <span className="edt-lpair-media">
                      {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" decoding="async" /> : <Icon name="coffee" size={16} />}
                    </span>
                    <span className="edt-lpair-txt">
                      <b>{label}</b>
                      <i>{pOut ? t('soldOut') : <Price value={pOffer ? discountedPrice(p.price, pOffer) : p.price} currency={currency} lang={lang} />}</i>
                    </span>
                    {!pOut && (
                      <span className="edt-lpair-add" aria-hidden="true"><Icon name={done ? 'check' : (onQuickAdd ? 'add' : (lang === 'ar' ? 'back' : 'next'))} size={13} /></span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <button type="button" className="edt-open-btn" onClick={open} disabled={out}>
          {lang === 'ar' ? 'اعرض الطبق' : 'View dish'} <Icon name={lang === 'ar' ? 'back' : 'next'} size={15} />
        </button>
      </div>
    </section>
  )
}

// Full-screen item stage — detail mode 'editorial'. The tapped photo expands
// from its list position (FLIP transform, 300ms ease-out-quart), content
// slides up staggered; close reverses. prefers-reduced-motion => crossfade.
// Ordering is complete here: variants, modifier groups (min/max/required),
// qty and add — same contract as ItemSheet's onAdd(variant, mods, qty).
// allItems + onQuickAdd are OPTIONAL: with them the venue's curated «يُطلب معه»
// pairings become tappable; without them the stage still renders everything
// else, so an un-patched caller degrades instead of crashing.
export function EditorialItemStage({ item, tenant = null, currency, onClose, onAdd, originRect = null, allItems = [], offers = null, onQuickAdd = null }) {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const portalRoot = usePortalRoot()
  const heroRef = useRef(null)
  const closingRef = useRef(false)
  const addedTimer = useRef(0)
  const { fit, bind, onLoad } = useImgFit()
  const [closing, setClosing] = useState(false)
  const [err, setErr] = useState('')
  const [added, setAdded] = useState('')
  const [storyOpen, setStoryOpen] = useState(false)
  const reduced = prefersReduced()
  const variants = item.variants || []
  const groups = item.modifierGroups || []
  const [variant, setVariant] = useState(variants[0] || null)
  const [qty, setQty] = useState(1)
  const [imgIdx, setImgIdx] = useState(0)
  const [selected, setSelected] = useState(() => groups.map(() => []))
  const name = pickLang(item, 'name', lang)
  const desc = pickLang(item, 'desc', lang)
  const ings = item.ingredients || []
  const out = isOut(item)
  const low = lowStock(item)
  const offer = offerForItem(item, offers)
  const offerTag = offer ? itemOfferLabel(item, offers, currency) : ''
  const story = hasStory(item) ? item.story : null
  const storyParas = story ? paragraphsOf(story.body) : []
  // The venue's art direction for this dish at STAGE size. item.imageScale used
  // to move only a max-height cap here, which does nothing at all when the photo
  // is already shorter than the cap («الخيار الحالي لايعمل في هذا الثيم»); the
  // module turns it into a real transform, and the list has its own listScale.
  const comp = useMemo(() => resolveComposition(item, { variant: 'stage' }), [item])
  const dpItem = useMemo(() => dishPropsItem(item, comp), [item, comp])
  // the same room as the list, drawn from the same tenant contract
  const wallOn = wallConfigured(tenant)
  const wallKey = wallOn ? JSON.stringify(tenant.menuWall) : ''
  const wall = useMemo(() => (wallKey ? resolveWall(tenant) : null), [wallKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const wallAttr = wallOn ? (wall ? wall.pattern : 'none') : undefined
  // The same dial as the list: how much the room dims behind the record. The
  // stage's own plaster fade was a fixed band, which is the same complaint one
  // surface along, so it reads the venue's number too.
  const secVars = sectionVars(resolveSections(tenant))
  // The FLIP is the stage's own entrance. When there is no origin rect (opened
  // from a pairing chip) there is no FLIP, so the dish plays the entrance the
  // venue chose for it instead of simply appearing.
  const stageAnim = originRect ? '' : animAttr(comp)
  // primary photo first, then the extra gallery shots (deduped)
  const gallery = useMemo(
    () => [...new Set([item.imageUrl, ...(item.images || [])].filter(Boolean))],
    [item.imageUrl, item.images],
  )
  const heroSrc = gallery[Math.min(imgIdx, Math.max(0, gallery.length - 1))] || ''
  // Venue-curated «يُطلب معه»: item.pairings = [itemId, …] resolved against the
  // live menu (same rule the default/spotlight views use).
  const pairs = useMemo(() => {
    const ids = Array.isArray(item.pairings) ? item.pairings : []
    if (!ids.length || !allItems.length) return []
    return ids.map((id) => allItems.find((x) => x.id === id)).filter((x) => x && x.id !== item.id).slice(0, 3)
  }, [item.pairings, item.id, allItems])

  // FLIP open: place the hero at the origin rect via transform, then release.
  useEffect(() => {
    const el = heroRef.current
    if (!el || !originRect || reduced) return undefined
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return undefined
    el.style.transformOrigin = '0 0'
    el.style.transform = `translate(${originRect.left - r.left}px, ${originRect.top - r.top}px) scale(${originRect.width / r.width}, ${originRect.height / r.height})`
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = `transform 300ms ${EASE_OUT_QUART}`
      el.style.transform = 'none'
    }))
    return () => cancelAnimationFrame(raf)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    const el = heroRef.current
    if (el && originRect && !reduced) {
      const r = el.getBoundingClientRect()
      el.style.transition = `transform 280ms ${EASE_OUT_QUART}`
      el.style.transformOrigin = '0 0'
      el.style.transform = `translate(${originRect.left - r.left}px, ${originRect.top - r.top}px) scale(${originRect.width / r.width}, ${originRect.height / r.height})`
    }
    setTimeout(onClose, reduced ? 180 : 280)
  }

  // Scroll lock + Escape while the stage is up.
  useEffect(() => {
    const prev = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => { document.documentElement.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(addedTimer.current), [])

  // Same selection rules as ItemSheet (max 1 = radio; max N caps; min/required gate).
  const toggle = (gi, opt) => {
    setErr('')
    const g = groups[gi]
    const max = Number(g.max) || 0
    setSelected((sel) => {
      const curSel = sel[gi] || []
      const exists = curSel.find((o) => o.nameAr === opt.nameAr && o.nameEn === opt.nameEn)
      let next
      if (max === 1) next = exists ? [] : [opt]
      else if (exists) next = curSel.filter((o) => o !== exists)
      else if (max > 0 && curSel.length >= max) next = curSel
      else next = [...curSel, opt]
      return sel.map((s, i) => (i === gi ? next : s))
    })
  }
  const flatMods = groups.flatMap((g, gi) => (selected[gi] || []).map((o) => ({ nameAr: o.nameAr, nameEn: o.nameEn, price: Number(o.price) || 0, recipe: o.recipe || [] })))
  const modSum = flatMods.reduce((s, m) => s + m.price, 0)
  const base = (variant ? variant.price : item.price) || 0
  // Offer pricing is shown the same way the item cards and the spotlight view
  // show it; the cart applies the matching discount at checkout.
  const unit = (offer ? discountedPrice(base, offer) : base) + modSum
  const total = unit * qty
  const wasTotal = (base + modSum) * qty
  const missing = groups.find((g, gi) => {
    const need = Math.max(Number(g.min) || 0, g.required ? 1 : 0)
    return need > 0 && (selected[gi] || []).length < need
  })
  const add = () => {
    if (out) return
    if (missing) { setErr(`${ar ? 'اختر من' : 'Choose from'}: ${pickLang(missing, 'name', lang)}`); return }
    onAdd(variant, flatMods, qty)
  }
  const quickAdd = (p) => {
    if (!onQuickAdd) return
    onQuickAdd(p)
    setAdded(p.id)
    clearTimeout(addedTimer.current)
    addedTimer.current = setTimeout(() => setAdded(''), 1500)
  }

  if (!portalRoot) return null
  return createPortal(
    <div className={`edt-stg ${closing ? 'closing' : ''}`} data-wall={wallAttr} style={secVars} role="dialog" aria-modal="true" aria-label={name}>
      <EdtWall wall={wall} />
      {/* the stage paints its own plaster fade over the room: it used to live in
          the element's background, where a wall CHILD covered it and its
          strength could not be a setting. Mounted for every venue now, wall or
          fallback tile, because the dial that governs it is the same one. */}
      <span className="edt-wall-fade" aria-hidden="true" />
      <button type="button" className="edt-stg-x" onClick={close} aria-label={t('close')}><Icon name="close" size={20} /></button>
      <div className="edt-stg-scroll">
        <div className="edt-stg-media">
          <div className="edt-stg-hero" ref={heroRef} data-fit={fit || undefined} data-dp-contact={dpShadow(item)} data-dp-reflect={dpReflect(item)}>
            <span className="edt-glow" aria-hidden="true" />
            {/* quieter here: the stage variant caps the scatter and shortens
                the surface, so the full dish record stays the subject */}
            <DishProps item={dpItem} active variant="stage" />
            <EdtBackdrop bg={comp.bg} />
            <EdtLayers list={comp.layers.behind} />
            <EdtDish comp={comp} src={heroSrc} anim={stageAnim} bind={bind} onLoad={onLoad} fallback={72} />
            <EdtLayers list={comp.layers.front} />
            {item.hotspots?.length ? <Suspense fallback={null}><DishHotspots hotspots={item.hotspots} /></Suspense> : null}
          </div>
          {gallery.length > 1 && (
            <div className="edt-thumbs scroll-x">
              {gallery.map((src, i) => (
                <button key={src} type="button" className={`edt-thumb ${i === imgIdx ? 'on' : ''}`}
                  onClick={() => setImgIdx(i)} aria-label={`${ar ? 'صورة' : 'Photo'} ${i + 1}`}>
                  <img src={src} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="edt-stg-body">
          {(offerTag || out || low || item.featured) && (
            <div className="edt-stg-tags">
              {offerTag && <span className="edt-tag edt-tag-offer">{offerTag}</span>}
              {out && <span className="edt-tag edt-tag-out">{t('soldOut')}</span>}
              {!out && low ? <span className="edt-tag edt-tag-low">{ar ? `آخر ${low}` : `Only ${low} left`}</span> : null}
              {item.featured && <span className="edt-tag edt-tag-star"><Icon name="star" size={11} /> {ar ? 'مميّز' : 'Featured'}</span>}
            </div>
          )}
          <h2 className="edt-stg-name">{name}</h2>
          {/* tracks the selected size, so the headline price never contradicts the bar */}
          <div className="edt-stg-price">
            <Price value={offer ? discountedPrice(base, offer) : base} currency={currency} lang={lang} />
            {offer && <span className="edt-was"><Price value={base} currency={currency} lang={lang} /></span>}
          </div>
          <div className="edt-facts">
            {item.calories ? <span className="edt-fact"><i>{ar ? 'سعرات' : 'Calories'}</i><b>{item.calories}</b></span> : null}
            {item.prepTime ? <span className="edt-fact"><i>{ar ? 'التحضير' : 'Prep'}</i><b>{item.prepTime} {t('minutesShort')}</b></span> : null}
            {item.serves ? <span className="edt-fact"><i>{ar ? 'يكفي' : 'Serves'}</i><b>{item.serves}</b></span> : null}
            {item.rating ? <span className="edt-fact"><i>{ar ? 'التقييم' : 'Rating'}</i><b>{item.rating}{item.reviewsCount ? ` (${item.reviewsCount})` : ''}</b></span> : null}
          </div>
          {desc && <p className="edt-stg-desc">{desc}</p>}
          {item.allergens && (
            <p className="edt-note"><Icon name="warning" size={14} /> <span>{ar ? 'قد يحتوي: ' : 'May contain: '}{item.allergens}</span></p>
          )}
          {ings.length > 0 && (
            <div className="edt-ing edt-stg-ing">
              <span className="edt-ing-title">{ar ? 'المكونات' : 'Ingredients'}</span>
              <ul>
                {ings.map((g, i) => (
                  <li key={i} style={{ animationDelay: `${(0.3 + i * 0.05).toFixed(2)}s` }}><AmberAmounts text={pickLang(g, 'name', lang)} /></li>
                ))}
              </ul>
            </div>
          )}
          {story && (
            <div className="edt-story">
              <span className="edt-ing-title">{ar ? 'قصة الطبق' : 'The dish story'}</span>
              {story.title && <h3 className="edt-story-t">{story.title}</h3>}
              {(storyOpen ? storyParas : storyParas.slice(0, 1)).map((p, i) => <p key={i} className="edt-story-p">{p}</p>)}
              {storyParas.length > 1 && (
                <button type="button" className="edt-more" onClick={() => setStoryOpen((v) => !v)}>
                  {storyOpen ? (ar ? 'إخفاء' : 'Show less') : (ar ? 'اقرأ المزيد' : 'Read more')}
                </button>
              )}
              {story.sourceLine && <p className="edt-story-line"><Icon name="pin" size={13} /> <span>{story.sourceLine}</span></p>}
              {story.chefLine && <p className="edt-story-line"><Icon name="kitchen" size={13} /> <span>{story.chefLine}</span></p>}
            </div>
          )}
          {variants.length > 0 && (
            <div className="edt-stg-field">
              <span className="edt-stg-lbl">{t('variants')}</span>
              <div className="edt-opts">
                {variants.map((v) => (
                  <button key={v.key} type="button" className={`edt-opt ${variant?.key === v.key ? 'on' : ''}`} onClick={() => { setVariant(v); setErr('') }}>
                    {pickLang(v, 'name', lang)} · <Price value={v.price} currency={currency} lang={lang} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {groups.map((g, gi) => (
            <div key={gi} className="edt-stg-field">
              <span className="edt-stg-lbl">
                {pickLang(g, 'name', lang)}
                {(g.required || Number(g.min) > 0) ? <b className="edt-req"> *</b> : <span className="edt-opt-note"> ({t('optional')})</span>}
              </span>
              <div className="edt-opts">
                {(g.options || []).map((o, oi) => {
                  const on = (selected[gi] || []).some((x) => x.nameAr === o.nameAr && x.nameEn === o.nameEn)
                  return (
                    <button key={oi} type="button" className={`edt-opt ${on ? 'on' : ''}`} onClick={() => toggle(gi, o)}>
                      {pickLang(o, 'name', lang)}{Number(o.price) ? <> +<Price value={o.price} currency={currency} lang={lang} /></> : ''}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          {pairs.length > 0 && (
            <div className="edt-stg-field">
              <span className="edt-stg-lbl">{ar ? 'يُطلب معه' : 'Goes well with'}</span>
              <div className="edt-pair-row">
                {pairs.map((p) => {
                  const pOut = isOut(p)
                  const pOffer = offerForItem(p, offers)
                  const tappable = !!onQuickAdd && !pOut
                  const Tag = tappable ? 'button' : 'div'
                  const done = added === p.id
                  return (
                    <Tag key={p.id} className={`edt-pair ${done ? 'done' : ''} ${pOut ? 'is-out' : ''}`}
                      {...(tappable ? { type: 'button', onClick: () => quickAdd(p), 'aria-label': `${t('addToCart')} ${pickLang(p, 'name', lang)}` } : {})}>
                      <span className="edt-pair-media">
                        {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" decoding="async" /> : <Icon name="coffee" size={18} />}
                      </span>
                      <span className="edt-pair-txt">
                        <b>{pickLang(p, 'name', lang)}</b>
                        <i>{pOut ? t('soldOut') : <Price value={pOffer ? discountedPrice(p.price, pOffer) : p.price} currency={currency} lang={lang} />}</i>
                      </span>
                      {tappable && (
                        <span className="edt-pair-add" aria-hidden="true"><Icon name={done ? 'check' : 'add'} size={14} /></span>
                      )}
                    </Tag>
                  )
                })}
              </div>
            </div>
          )}
          {err && <p className="edt-stg-err" role="alert">{err}</p>}
        </div>
      </div>
      {onAdd && (
        <div className="edt-stg-bar">
          <Stepper value={qty} onChange={setQty} min={1} max={item.trackStock && item.stock > 0 ? Math.min(99, item.stock) : 99} />
          <div className="edt-stg-total">
            <Price value={total} currency={currency} lang={lang} />
            {offer && <span className="edt-was"><Price value={wasTotal} currency={currency} lang={lang} /></span>}
          </div>
          <button type="button" className="edt-stg-add" onClick={add} disabled={out}>
            <Icon name={out ? 'no' : 'add'} size={18} /> {out ? t('soldOut') : t('addToCart')}
          </button>
        </div>
      )}
    </div>,
    portalRoot,
  )
}
