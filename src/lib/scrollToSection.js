// Scroll a menu section/card to just under the sticky category bar — correctly,
// on every layout and every breakpoint.
//
// TWO THINGS BREAK THE OBVIOUS `window.scrollTo(scrollY + rect.top - bar)`:
//
// 1. THE WINDOW IS NOT ALWAYS THE SCROLLER. At >= 980px the menu sets
//    `body { overflow: hidden }` and the real scroller becomes the layout
//    element itself (`.venue-above > [data-menu-layout]`). window.scrollY is
//    pinned at 0 there, so window.scrollTo() silently does NOTHING — measured:
//    tapping a category moved the page 0px and left the target 3138px below the
//    fold. scrollIntoView() has no such problem: the browser walks up to
//    whichever ancestor actually scrolls.
//
// 2. THE PAGE IS STILL LAYING OUT WHEN WE MEASURE. Dish media mounts lazily
//    (the near-gate unmounts off-screen media), so sections below the fold have
//    no final height yet and the first jump undershoots — measured 194px to
//    1590px short, while a SECOND tap always landed exactly. So the jump
//    verifies where it ended up and corrects itself until it is within 8px.
//
// `scroll-margin-top` is set inline from the bar's real rect rather than guessed
// in CSS, so it stays right whatever the venue's chrome height is.

const reduced = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
}

const TOLERANCE = 8
const MAX_TRIES = 12
const SETTLE_MS = 180

// The nearest ancestor that actually scrolls, or null when it is the window.
function scrollerOf(el) {
  let n = el.parentElement
  while (n && n !== document.body && n !== document.documentElement) {
    const cs = getComputedStyle(n)
    if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 4) return n
    n = n.parentElement
  }
  return null
}

// Where the sticky bar will sit ONCE STUCK — not where it happens to be right
// now. Measuring its live rect at the top of the page reads its natural
// position under the hero (measured 757px down), so the jump aimed 757px short
// and every category landed one dish early. Its stuck top is its CSS `top`
// (the sticky offset), so the stuck bottom is that plus its own height.
export function stuckOffset(bar) {
  if (!bar) return 0
  // A plain number is a caller that has no sticky bar to measure and already
  // knows its chrome height (see chromeOffset) — the sidebar, storefront and
  // spotlight skins have no .cat-bar at all, and without this every category
  // jump on them landed the dish underneath the fixed app bar.
  if (typeof bar === 'number') return Math.max(0, bar)
  try {
    const cs = getComputedStyle(bar)
    const h = bar.getBoundingClientRect().height
    const top = parseFloat(cs.top)
    // A sticky bar settles at its CSS  inside its own scrollport.
    if (cs.position === 'sticky' && Number.isFinite(top)) return Math.max(0, top + h)
    return Math.max(0, h)
  } catch (_) { return 0 }
}

export function scrollSectionIntoView(el, bar = null) {
  if (!el || typeof window === 'undefined') return
  const sc = scrollerOf(el)
  // The target line, in VIEWPORT coordinates (which is what getBoundingClientRect
  // returns). Two corrections matter:
  //  • the bar's STUCK offset, not its live rect — at the top of the page it is
  //    still sitting under the hero (measured 757px down), which aimed every
  //    jump one whole dish short;
  //  • the SCROLLPORT origin — on the desktop breakpoint the scroller is an
  //    inner element that starts below the app bar, so an offset of  alone was short by exactly that bar height (a constant -56px).
  const portTop = sc ? sc.getBoundingClientRect().top : 0
  const offset = Math.round(portTop + stuckOffset(bar))

  // Correct by the MEASURED delta rather than asking the browser to align the
  // element: scrollIntoView({block:'start'}) aligns to the scrollPORT, which on
  // the desktop breakpoint starts below the app bar — leaving a constant
  // residual (measured 56px). Moving the scroller by `rect.top - barBottom` is
  // exact by construction on both the window and an inner scroller, and
  // repeating it absorbs the layout shift from lazily-mounted dish media (which
  // is what made the first jump undershoot by up to 1590px).
  const pos = () => (sc ? sc.scrollTop : window.scrollY)
  const move = (delta, behavior) => {
    try {
      if (sc) sc.scrollTo({ top: sc.scrollTop + delta, behavior })
      else window.scrollTo({ top: Math.max(0, window.scrollY + delta), behavior })
    } catch (_) {
      if (sc) sc.scrollTop += delta
      else window.scrollTo(0, Math.max(0, window.scrollY + delta))
    }
  }

  // THE JUMP IS INSTANT, ON PURPOSE. A smooth animation keeps running to ITS
  // original target and simply undoes any correction issued while it is in
  // flight — measured: a category stuck exactly one section (757px) short
  // through six attempts, while the same move applied instantly landed dead on.
  // Waiting for the animation to settle before correcting was worse still
  // (new 2524px misses on desktop, because "settled" is a guess). An instant
  // move plus instant re-measurement is deterministic: no animation, nothing to
  // race. It reads like an anchor jump, which is exactly what it is.
  let tries = 0
  const step = () => {
    const delta = el.getBoundingClientRect().top - offset
    if (Math.abs(delta) <= TOLERANCE || tries >= MAX_TRIES) return
    move(delta, 'auto')
    tries += 1
    // One frame for layout, then a beat for lazily-mounted dish media. The window
  // is generous (12 x 180ms) because the near-gate keeps mounting media as the
  // jump lands, which shifts the target — a short window left one category on
  // desktop stranded thousands of pixels away.
    requestAnimationFrame(() => setTimeout(step, SETTLE_MS))
  }
  step()
}

// How far down the viewport the venue's chrome reaches, in real pixels.
//
// The layouts WITHOUT a sticky category bar still sit under a fixed app bar,
// and the amount is a CSS custom property (--menu-sticky-top) built out of
// calc(), safe-area insets and a breakpoint override — getPropertyValue hands
// back the unevaluated `calc(...)` string, not a number. So it is MEASURED:
// a throwaway fixed probe is positioned at exactly that offset and asked where
// it landed. One layout read, no parsing, correct on every device and
// breakpoint including the notch.
export function chromeOffset(root) {
  if (typeof document === 'undefined') return 0
  const host = root || document.querySelector('.venue-above') || document.body
  try {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;top:var(--menu-sticky-top,0px);left:0;width:0;height:0;pointer-events:none;visibility:hidden'
    host.appendChild(probe)
    const top = probe.getBoundingClientRect().top
    probe.remove()
    return Number.isFinite(top) ? Math.max(0, Math.round(top)) : 0
  } catch (_) { return 0 }
}

// Some layouts lay each category out as a HORIZONTAL rail (the gallery skin
// makes .showcase-grid a scroll-snapping flex carousel), so a purely vertical
// jump lands on the right section while the dish itself is still parked off to
// the side — the diner taps a category and sees the middle of it.
//
// Deliberately NOT scrollIntoView({inline:'start'}): that scrolls EVERY
// scrollable ancestor, including the vertical one the caller is about to
// correct by measurement, and the two fight. This moves the rail and nothing
// else.
//
// RTL-safe by construction: the delta is measured against the rail's INLINE
// START edge — its right edge in Arabic, its left in English — and per the
// modern scrollLeft spec adding that delta moves the content the same way in
// both directions.
//
// The rail may not come to rest exactly on that line, and that is correct: the
// gallery rail is `scroll-snap-type: x mandatory` with centre-aligned cards, so
// the snap engine pulls the final position to the nearest card centre.
// Measured on the built stylesheet at 390px RTL: the target moved from
// off-rail to fully visible, resting 50px off the start line — snapped, which
// is the layout's own intent. The property that matters is that the dish is
// on screen, not which pixel it starts at.
export function scrollRailIntoView(el) {
  if (!el || typeof window === 'undefined') return
  let rail = el.parentElement
  while (rail && rail !== document.body) {
    const cs = getComputedStyle(rail)
    if (/(auto|scroll)/.test(cs.overflowX) && rail.scrollWidth > rail.clientWidth + 4) {
      try {
        const r = rail.getBoundingClientRect()
        const e = el.getBoundingClientRect()
        const delta = cs.direction === 'rtl' ? (e.right - r.right) : (e.left - r.left)
        if (Math.abs(delta) > 2) rail.scrollTo({ left: rail.scrollLeft + delta, behavior: reduced() ? 'auto' : 'smooth' })
      } catch (_) { /* a browser without scrollTo options keeps the vertical jump */ }
      return
    }
    rail = rail.parentElement
  }
}

// Back to the very top of whichever element is actually scrolling.
export function scrollSectionToTop(el) {
  if (typeof window === 'undefined') return
  const behavior = reduced() ? 'auto' : 'smooth'
  // Walk up from the given node to the nearest real scroller; fall back to the
  // window (which is the scroller below the desktop breakpoint).
  let n = el
  while (n && n !== document.body) {
    const cs = getComputedStyle(n)
    if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 4) {
      try { n.scrollTo({ top: 0, behavior }) } catch (_) { n.scrollTop = 0 }
      return
    }
    n = n.parentElement
  }
  try { window.scrollTo({ top: 0, behavior }) } catch (_) { window.scrollTo(0, 0) }
}
