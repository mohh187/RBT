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
