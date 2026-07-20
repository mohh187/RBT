// SCROLL AFFORDANCE — the systemic answer to "the screen is cut off".
//
// The product forbids visible scrollbars, which is right aesthetically but left
// every horizontal strip (tab chips, kanban lanes, category rails, tables)
// looking truncated: content really was scrollable, but nothing told the user.
//
// This enhancer runs once per admin/menu shell and, for EVERY horizontally
// scrollable element it can find — present or added later — sets:
//     data-ovf="none" | "start" | "end" | "both"
// The stylesheet (src/styles/scrollfix.css) turns that into an edge fade plus
// optional nudge arrows, so a user always sees that more content exists.
//
// RTL is handled properly: browsers report scrollLeft differently under
// direction:rtl (negative in Chrome/Firefox, positive-decreasing in older
// WebKit), so distances are computed from magnitudes rather than raw signs.

const MARK = '__rbtOvf'
const EPS = 2 // sub-pixel layouts must not register as "scrollable"

function edges(el) {
  const max = el.scrollWidth - el.clientWidth
  if (max <= EPS) return 'none'
  // Distance already scrolled away from the natural start edge, and what is
  // left before the far edge — both as positive magnitudes.
  const scrolled = Math.abs(el.scrollLeft)
  const remaining = max - scrolled
  const atStart = scrolled <= EPS
  const atEnd = remaining <= EPS
  if (atStart && atEnd) return 'none'
  if (atStart) return 'end'
  if (atEnd) return 'start'
  return 'both'
}

function apply(el) {
  const next = edges(el)
  if (el.dataset.ovf !== next) el.dataset.ovf = next
}

// An element counts when it can actually scroll horizontally right now.
function scrollsX(el) {
  if (!(el instanceof HTMLElement)) return false
  const s = getComputedStyle(el)
  if (s.overflowX !== 'auto' && s.overflowX !== 'scroll') return false
  return el.scrollWidth - el.clientWidth > EPS
}

function attach(el) {
  if (el[MARK]) { apply(el); return }
  el[MARK] = true
  const onScroll = () => apply(el)
  el.addEventListener('scroll', onScroll, { passive: true })
  // Content and size both change independently of scrolling (filters, data
  // arriving, window resize), so observe the box as well as its children.
  let ro = null
  try {
    ro = new ResizeObserver(() => apply(el))
    ro.observe(el)
    for (const child of el.children) ro.observe(child)
  } catch (_) { /* very old engines: scroll + interval below still cover it */ }
  el[`${MARK}Cleanup`] = () => {
    el.removeEventListener('scroll', onScroll)
    if (ro) ro.disconnect()
    delete el[MARK]
  }
  apply(el)
}

let observer = null
let rafId = 0

function sweep(root) {
  const scope = root || document
  // Only elements that already declare horizontal overflow are candidates;
  // scanning every node would be wasteful on large admin pages.
  // Substring class matching on purpose: the codebase names its strips many
  // ways (scroll-x, acc-scroll-x, ord-lanes, set-chips, dish-tabs, exp-bar…),
  // and a scroller that is missed simply keeps today's behaviour.
  const nodes = scope.querySelectorAll(
    '[class*="scroll-x"], [class*="scrollx"], [class*="lanes"], [class*="tabs"],'
    + ' [class*="chips"], [class*="rail"], [class*="strip"], [class*="-bar"],'
    + ' .segmented, [data-ovf-watch]',
  )
  for (const el of nodes) {
    if (scrollsX(el)) attach(el)
    else if (el[MARK]) apply(el) // keep the attribute honest when it stops scrolling
  }
}

function schedule(root) {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    try { sweep(root) } catch (_) { /* never break the app for an affordance */ }
  })
}

// Starts the enhancer. Safe to call more than once; returns a stop function.
export function initScrollAffordance(root = document.body) {
  if (typeof window === 'undefined' || !root) return () => {}
  schedule(root)
  if (!observer) {
    observer = new MutationObserver(() => schedule(root))
    observer.observe(root, { childList: true, subtree: true })
  }
  const onResize = () => schedule(root)
  window.addEventListener('resize', onResize)
  return () => {
    window.removeEventListener('resize', onResize)
    if (observer) { observer.disconnect(); observer = null }
  }
}

// Imperative helper for a component that just changed its own content and
// wants the affordance refreshed immediately rather than on the next mutation.
export function refreshScrollAffordance(el) {
  if (el instanceof HTMLElement) { if (scrollsX(el)) attach(el); else apply(el) }
  else schedule(document.body)
}
