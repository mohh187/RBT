import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePortalRoot } from './PortalRoot.jsx'
import { pickLang } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'
import ItemFx from './ItemFx.jsx'
import DishHotspots from './DishHotspots.jsx'
import { Price } from './Riyal.jsx'
import { Spinner } from './ui.jsx'

/**
 * Menu3DWorld — «عالم المنيو ثلاثي الأبعاد».
 *
 * A full-screen walk-through gallery of the venue's dishes that actually have a
 * 3D asset (a real uploaded model, or the auto-generated AR standee). Each dish
 * stands on a virtual pedestal inside an ambient room; the guest swipes (or uses
 * the chevrons / arrow keys) from dish to dish and can drop the active one onto
 * their own table in AR.
 *
 * WEBGL BUDGET (critical on phones): a 30-item menu must never spawn 30 WebGL
 * contexts — browsers hard-cap them (~8-16) and silently kill the oldest, which
 * looks like random blank dishes. So the rail renders every slide's CHROME
 * (pedestal, name, price) but mounts a <model-viewer> only for the active index
 * and its two immediate neighbours (a 3-context ceiling, enough that a swipe
 * lands on an already-warm viewer). The active index is tracked with an
 * IntersectionObserver rooted on the rail — no scroll math, no rAF loop.
 *
 * PROJECT RULE: <model-viewer> is ALWAYS given loading="eager" — lazy loading
 * silently never resolves inside our portalled overlays.
 */

// Same source resolution as the item sheet's AR stage: iPhone Quick Look wants
// USDZ, everything else wants the GLB; an uploaded .usdz main model is honoured.
function modelSources(it) {
  const isUsdzMain = /\.usdz($|\?)/i.test(it?.model3dUrl || '')
  const glb = isUsdzMain ? (it?.arStandeeUrl || '') : (it?.model3dUrl || it?.arStandeeUrl || '')
  const usdz = it?.model3dUsdzUrl || (isUsdzMain ? it?.model3dUrl : '')
  return { glb, usdz }
}

export function has3d(it) {
  const { glb, usdz } = modelSources(it)
  return !!(glb || usdz)
}

function usePrefersReduced() {
  const [reduced, setReduced] = useState(() => {
    try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
  })
  useEffect(() => {
    let mq
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)') } catch (_) { return undefined }
    if (!mq) return undefined
    const on = () => setReduced(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return reduced
}

export default function Menu3DWorld({ open, onClose, items = [], cats = [], lang = 'ar', currency = 'SAR', onOpenItem }) {
  const ar = lang === 'ar'
  const root = usePortalRoot()
  const reduced = usePrefersReduced()

  const [mv, setMv] = useState('loading') // loading | ready | error
  const [active, setActive] = useState(0)
  const [arFailed, setArFailed] = useState(false)
  const [loaded, setLoaded] = useState(() => ({}))

  const railRef = useRef(null)
  const slideRefs = useRef([])
  const viewerRefs = useRef([])

  const models = useMemo(
    () => (Array.isArray(items) ? items : []).filter((it) => it && it.available !== false && has3d(it)),
    [items],
  )

  const catName = useMemo(() => {
    const map = {}
    for (const c of cats || []) if (c && c.id) map[c.id] = pickLang(c, 'name', lang)
    return map
  }, [cats, lang])

  // Load the custom element only once the world is actually opened (heavy bundle).
  useEffect(() => {
    if (!open) return undefined
    let alive = true
    setMv('loading')
    import('../lib/ar3d.js')
      .then((m) => m.loadModelViewer())
      .then(() => { if (alive) setMv('ready') })
      .catch(() => { if (alive) setMv('error') })
    return () => { alive = false }
  }, [open])

  // Fresh state each time the world opens.
  useEffect(() => {
    if (!open) return
    setActive(0)
    setArFailed(false)
    setLoaded({})
  }, [open])

  // Lock the page behind the overlay.
  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Active slide = the one covering most of the rail. IntersectionObserver keeps
  // this cheap (no scroll listener) and is what gates the WebGL context budget.
  useEffect(() => {
    if (!open || !models.length) return undefined
    const rail = railRef.current
    if (!rail) return undefined
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const idx = Number(e.target.dataset.idx)
        if (Number.isFinite(idx)) setActive(idx)
      }
    }, { root: rail, threshold: 0.6 })
    slideRefs.current.slice(0, models.length).forEach((el) => { if (el) io.observe(el) })
    return () => io.disconnect()
  }, [open, models.length])

  const goTo = (i) => {
    const idx = Math.max(0, Math.min(models.length - 1, i))
    const el = slideRefs.current[idx]
    if (!el) return
    setActive(idx)
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', inline: 'center', block: 'nearest' })
  }

  // Keyboard: arrows follow the VISUAL axis, so in RTL the left arrow advances.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose?.(); return }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const forward = ar ? e.key === 'ArrowLeft' : e.key === 'ArrowRight'
      goTo(active + (forward ? 1 : -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!open || !root) return null

  const activeItem = models[active] || null

  const bindViewer = (i) => (el) => {
    viewerRefs.current[i] = el
    if (!el || el._rbtWorldBound) return
    el._rbtWorldBound = true
    el.addEventListener('load', () => setLoaded((p) => (p[i] ? p : { ...p, [i]: true })))
    el.addEventListener('ar-status', (e) => { if (e?.detail?.status === 'failed') setArFailed(true) })
  }

  const showOnTable = () => {
    const el = viewerRefs.current[active]
    if (!el || typeof el.activateAR !== 'function') { setArFailed(true); return }
    try {
      const p = el.activateAR()
      if (p && typeof p.catch === 'function') p.catch(() => setArFailed(true))
    } catch (_) { setArFailed(true) }
  }

  const empty = !models.length

  return createPortal(
    <div className="m3d" role="dialog" aria-modal="true" aria-label={ar ? 'عالم المنيو ثلاثي الأبعاد' : '3D menu world'}>
      <div className="m3d-sky" aria-hidden="true" />

      <header className="m3d-head">
        <div className="m3d-title">
          <Icon name="layers" size={17} />
          <span>{ar ? 'عالم المنيو ثلاثي الأبعاد' : '3D menu world'}</span>
        </div>
        <button type="button" className="m3d-x" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}>
          <Icon name="close" size={20} />
        </button>
      </header>

      {empty ? (
        <div className="m3d-empty">
          <span className="m3d-empty-orb" aria-hidden="true"><Icon name="layers" size={30} /></span>
          <strong>{ar ? 'لا توجد مجسمات بعد' : 'No 3D dishes yet'}</strong>
          <p>{ar ? 'حوّل أصنافك إلى مجسمات من محرر الصنف، وستظهر هنا في عالم ثلاثي الأبعاد.' : 'Turn your items into 3D models from the item editor and they will appear here.'}</p>
        </div>
      ) : mv === 'error' ? (
        <div className="m3d-empty">
          <span className="m3d-empty-orb" aria-hidden="true"><Icon name="warning" size={30} /></span>
          <strong>{ar ? 'تعذر تحميل عارض المجسمات' : 'Could not load the 3D viewer'}</strong>
          <p>{ar ? 'تحقق من اتصالك بالإنترنت ثم أعد المحاولة.' : 'Check your connection and try again.'}</p>
        </div>
      ) : (
        <>
          <div className="m3d-rail" ref={railRef}>
            {models.map((it, i) => {
              const near = Math.abs(i - active) <= 1
              const { glb, usdz } = modelSources(it)
              const name = pickLang(it, 'name', lang)
              const price = it.price != null ? it.price : (it.variants && it.variants[0] ? it.variants[0].price : null)
              const cat = catName[it.categoryId]
              const isActive = i === active
              return (
                <section
                  key={it.id || i}
                  className={`m3d-slide ${isActive ? 'is-active' : ''}`}
                  data-idx={i}
                  ref={(el) => { slideRefs.current[i] = el }}
                  aria-hidden={isActive ? undefined : 'true'}
                >
                  {cat ? <span className="m3d-cat">{cat}</span> : null}

                  <div className="m3d-stage">
                    <span className="m3d-beam" aria-hidden="true" />
                    <div className="m3d-viewport">
                      {near && mv === 'ready' ? (
                        <>
                          <model-viewer
                            ref={bindViewer(i)}
                            src={glb || undefined}
                            ios-src={usdz || undefined}
                            alt={name}
                            ar=""
                            ar-modes="scene-viewer webxr quick-look"
                            ar-scale="auto"
                            camera-controls=""
                            touch-action="pan-y"
                            {...(reduced ? {} : { 'auto-rotate': '', 'rotation-per-second': '18deg' })}
                            shadow-intensity="1"
                            shadow-softness="0.9"
                            exposure="1.05"
                            interaction-prompt="none"
                            loading="eager"
                            reveal="auto"
                            style={{ width: '100%', height: '100%', background: 'transparent' }}
                          />
                          {!loaded[i] ? <span className="m3d-load"><Spinner /></span> : null}
                        </>
                      ) : (
                        <span className="m3d-ghost" aria-hidden="true">
                          {it.imageUrl ? <img src={it.imageUrl} alt="" loading="lazy" /> : <Icon name="layers" size={26} />}
                        </span>
                      )}
                      {isActive && it.hotspots && it.hotspots.length ? <DishHotspots hotspots={it.hotspots} /> : null}
                      {isActive ? <ItemFx kind={it.effect} scale={1.5} /> : null}
                    </div>
                    <span className="m3d-pedestal" aria-hidden="true" />
                  </div>

                  <div className="m3d-plate">
                    <h2>{name}</h2>
                    {price != null ? (
                      <div className="m3d-price"><Price value={price} currency={currency} lang={lang} /></div>
                    ) : null}
                    {it.descAr || it.descEn ? <p className="m3d-desc">{pickLang(it, 'desc', lang)}</p> : null}
                  </div>
                </section>
              )
            })}
          </div>

          {models.length > 1 ? (
            <>
              <button
                type="button"
                className="m3d-nav m3d-nav-prev"
                onClick={() => goTo(active - 1)}
                disabled={active === 0}
                aria-label={ar ? 'السابق' : 'Previous'}
              >
                <Icon name={ar ? 'next' : 'back'} size={22} />
              </button>
              <button
                type="button"
                className="m3d-nav m3d-nav-next"
                onClick={() => goTo(active + 1)}
                disabled={active >= models.length - 1}
                aria-label={ar ? 'التالي' : 'Next'}
              >
                <Icon name={ar ? 'back' : 'next'} size={22} />
              </button>
            </>
          ) : null}

          <footer className="m3d-foot">
            {arFailed ? (
              <p className="m3d-warn">
                {ar
                  ? 'تعذر بدء الواقع المعزز على هذا الجهاز: على أندرويد ثبّت «Google Play Services for AR» وافتح الرابط في Chrome نفسه، وعلى آيفون افتح في Safari.'
                  : 'AR could not start: on Android install "Google Play Services for AR" and open in Chrome itself; on iPhone use Safari.'}
              </p>
            ) : null}
            <div className="m3d-actions">
              <button type="button" className="m3d-btn m3d-btn-ghost" onClick={() => activeItem && onOpenItem?.(activeItem)}>
                <Icon name="notepad" size={17} />
                <span>{ar ? 'التفاصيل' : 'Details'}</span>
              </button>
              <button type="button" className="m3d-btn m3d-btn-solid" onClick={showOnTable}>
                <Icon name="scan" size={17} />
                <span>{ar ? 'اعرضه على طاولتك' : 'View on your table'}</span>
              </button>
            </div>
            {models.length > 1 ? (
              <div className="m3d-dots" aria-hidden="true">
                {models.map((it, i) => (
                  <button
                    key={it.id || i}
                    type="button"
                    className={`m3d-dot ${i === active ? 'on' : ''}`}
                    onClick={() => goTo(i)}
                    tabIndex={-1}
                  />
                ))}
              </div>
            ) : null}
            <span className="m3d-count" dir="ltr">{active + 1} / {models.length}</span>
          </footer>
        </>
      )}
    </div>,
    root,
  )
}
