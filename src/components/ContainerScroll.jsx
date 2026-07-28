// Scroll-driven device reveal — a heading that rises and fades while a screen
// rotates from a tilted perspective down to flat and scales up.
//
// WHY THIS IS HAND-WRITTEN. The original is Aceternity UI's ContainerScroll
// (manuarora700 on 21st.dev). It could not be installed here for two separate
// reasons: the registry requires an API key, and — the one that actually
// matters — it is a Tailwind component that depends on framer-motion and a
// cn() helper, none of which this project has. Adding Tailwind and
// framer-motion to a plain-CSS Vite app to obtain one scroll effect would put
// ~50KB gzip and a second styling system in the bundle for a single section.
//
// So the effect is reproduced with the primitives already here: one passive
// scroll listener, rAF-coalesced, writing a single custom property that the
// stylesheet reads. Roughly thirty lines instead of a dependency, and it
// inherits the landing's tokens for free.
//
// The animation is decorative. Under prefers-reduced-motion the progress is
// pinned at 1 — the screen simply renders flat and legible, which is the
// state the animation was travelling towards anyway.
import { useEffect, useRef } from 'react'

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

export default function ContainerScroll({ title, children }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.setProperty('--p', '1')
      return undefined
    }

    let raf = 0
    const measure = () => {
      raf = 0
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight || 1
      // 0 when the block's top is at the bottom of the viewport, 1 by the time
      // that top has travelled to roughly the first sixth of the screen — so
      // the screen finishes laying flat while it is still comfortably in view
      // rather than only after the reader has scrolled past it.
      el.style.setProperty('--p', clamp01((vh - r.top) / (vh * 0.85)).toFixed(4))
    }
    // Coalesce to one measurement per frame: a scroll handler that reads
    // layout on every event is how a marketing page starts dropping frames on
    // the phones it is trying to impress.
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure) }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <div className="csa" ref={ref}>
      {title ? <div className="csa-title">{title}</div> : null}
      <div className="csa-stage">
        <div className="csa-frame">
          <div className="csa-screen">{children}</div>
        </div>
      </div>
    </div>
  )
}
