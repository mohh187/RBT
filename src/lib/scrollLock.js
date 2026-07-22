import { useEffect } from 'react'

// App-like scroll lock for overlays (sheets, stories, viewers, popups).
//
// Why not `body { overflow: hidden }`: iOS Safari (and some Android WebViews)
// keep scrolling the page under a fixed overlay anyway — the diner sees the
// menu/table scene DRIFT behind an open item sheet. The only reliable lock is
// pinning <body> with `position: fixed` at the current scroll offset, then
// restoring the offset on unlock.
//
// Why ref-counted: overlays stack (item sheet → dish story → image zoom). With
// each component saving/restoring style on its own, closing the FIRST-opened
// overlay used to unlock the page while another was still up. The page stays
// pinned until the LAST lock releases.
let count = 0
let savedY = 0

export function lockScroll() {
  if (typeof document === 'undefined') return
  count += 1
  if (count > 1) return
  savedY = window.scrollY || 0
  const b = document.body.style
  b.position = 'fixed'
  b.top = `-${savedY}px`
  b.left = '0'
  b.right = '0'
  b.width = '100%'
  b.overflow = 'hidden'
  document.documentElement.style.overflow = 'hidden'
}

export function unlockScroll() {
  if (typeof document === 'undefined') return
  count = Math.max(0, count - 1)
  if (count > 0) return
  const b = document.body.style
  b.position = ''
  b.top = ''
  b.left = ''
  b.right = ''
  b.width = ''
  b.overflow = ''
  document.documentElement.style.overflow = ''
  // pinning zeroed the scroller — put the diner back exactly where they were,
  // instantly (smooth scroll here would look like the page sliding on close)
  const html = document.documentElement
  const prevBehavior = html.style.scrollBehavior
  html.style.scrollBehavior = 'auto'
  window.scrollTo(0, savedY)
  html.style.scrollBehavior = prevBehavior
}

// Hook form: lock while `active`, release on close/unmount.
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined
    lockScroll()
    return unlockScroll
  }, [active])
}
