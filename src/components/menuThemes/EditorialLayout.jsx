// EditorialLayout — skin 'editorial' («المجلة الداكنة»): dark-magazine menu.
// One dish per screen inside a vertical scroll-snap stage (hidden scrollbars),
// bottom-anchored photo melting into the near-black canvas, amber ingredient
// amounts, a huge low-opacity vertical category label, and a current/total
// progress read-out (Latin digits). Item open = EditorialItemStage below:
// a FLIP photo-expand into a full-screen dark stage (transform/opacity only)
// with staggered content and the full variants/modifiers/qty ordering flow.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n, pickLang } from '../../lib/i18n.jsx'
import Icon from '../Icon.jsx'
import ItemFx from '../ItemFx.jsx'
import { Stepper, Empty } from '../ui.jsx'
import { Price } from '../Riyal.jsx'
import { usePortalRoot } from '../PortalRoot.jsx'
import { offerForItem, discountedPrice } from '../../lib/offers.js'

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

export default function EditorialLayout({ cats, itemsByCat, visibleItems, filtered, activeCat, onPickCat, currency, offers, stickyTop, onOpen }) {
  const { t, lang } = useI18n()
  const stageRef = useRef(null)
  const [cur, setCur] = useState(0)

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
    <div className="edt-wrap" style={{ '--edt-top': stickyTop }}>
      <div className="edt-cats scroll-x">
        <button type="button" className={`edt-chip ${activeCat === 'all' ? 'on' : ''}`} onClick={() => onPickCat('all')}>{t('all')}</button>
        {(cats || []).map((c) => (
          <button key={c.id} type="button" className={`edt-chip ${activeCat === c.id ? 'on' : ''}`} onClick={() => onPickCat(c.id)}>{pickLang(c, 'name', lang)}</button>
        ))}
      </div>
      {flat.length === 0 ? (
        <div className="edt-empty"><Empty icon="menu" title={lang === 'ar' ? 'لا توجد أصناف' : 'No items'} /></div>
      ) : (
        <>
          <div className="edt-stage" ref={stageRef}>
            {flat.map((it, i) => (
              <EdtSection key={it.id} it={it} idx={i} catLabel={catName(it.categoryId)} currency={currency} offers={offers} lang={lang} t={t} onOpen={onOpen} />
            ))}
          </div>
          <div className="edt-progress" aria-hidden="true">{cur + 1} / {flat.length}</div>
        </>
      )}
    </div>
  )
}

function EdtSection({ it, idx, catLabel, currency, offers, lang, t, onOpen }) {
  const ref = useRef(null)
  const imgRef = useRef(null)
  const [inview, setInview] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((entries) => entries.forEach((e) => setInview(e.isIntersecting)), { threshold: 0.35 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const out = isOut(it)
  const offer = offerForItem(it, offers)
  const price = offer ? discountedPrice(it.price, offer) : it.price
  const name = pickLang(it, 'name', lang)
  const desc = pickLang(it, 'desc', lang)
  const ings = it.ingredients || []
  // FLIP origin: the photo's on-screen rect, so the stage grows out of it.
  const open = () => { if (!out) onOpen(it, imgRef.current ? imgRef.current.getBoundingClientRect() : null) }

  return (
    <section ref={ref} data-idx={idx} className={`edt-sec ${inview ? 'in' : ''} ${out ? 'is-out' : ''}`}>
      <span className="edt-side" aria-hidden="true">{catLabel}</span>
      <div className="edt-main">
        <h2 className="edt-name">{name}</h2>
        <div className="edt-price">
          <Price value={price} currency={currency} lang={lang} />
          {offer && <span className="edt-was"><Price value={it.price} currency={currency} lang={lang} /></span>}
          {out && <span className="edt-out">{t('soldOut')}</span>}
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
        <button type="button" className="edt-open-btn" onClick={open} disabled={out}>
          {lang === 'ar' ? 'اعرض الطبق' : 'View dish'} <Icon name={lang === 'ar' ? 'back' : 'next'} size={15} />
        </button>
      </div>
      <div className="edt-photo">
        {it.imageUrl ? <img ref={imgRef} src={it.imageUrl} alt="" /> : <span className="edt-noimg"><Icon name="coffee" size={64} /></span>}
        <span className="edt-vignette" aria-hidden="true" />
        <button type="button" className="edt-photo-open" onClick={open} aria-label={name} tabIndex={-1} disabled={out} />
        <ItemFx kind={it.effect} />
        {it.hotspots?.length ? <Suspense fallback={null}><DishHotspots hotspots={it.hotspots} /></Suspense> : null}
      </div>
    </section>
  )
}

// Full-screen item stage — detail mode 'editorial'. The tapped photo expands
// from its list position (FLIP transform, 300ms ease-out-quart), content
// slides up staggered; close reverses. prefers-reduced-motion => crossfade.
// Ordering is complete here: variants, modifier groups (min/max/required),
// qty and add — same contract as ItemSheet's onAdd(variant, mods, qty).
export function EditorialItemStage({ item, currency, onClose, onAdd, originRect = null }) {
  const { t, lang } = useI18n()
  const portalRoot = usePortalRoot()
  const heroRef = useRef(null)
  const closingRef = useRef(false)
  const [closing, setClosing] = useState(false)
  const [err, setErr] = useState('')
  const reduced = prefersReduced()
  const variants = item.variants || []
  const groups = item.modifierGroups || []
  const [variant, setVariant] = useState(variants[0] || null)
  const [qty, setQty] = useState(1)
  const [selected, setSelected] = useState(() => groups.map(() => []))
  const name = pickLang(item, 'name', lang)
  const desc = pickLang(item, 'desc', lang)
  const ings = item.ingredients || []

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
  const total = ((variant ? variant.price : item.price || 0) + modSum) * qty
  const missing = groups.find((g, gi) => {
    const need = Math.max(Number(g.min) || 0, g.required ? 1 : 0)
    return need > 0 && (selected[gi] || []).length < need
  })
  const add = () => {
    if (missing) { setErr(`${lang === 'ar' ? 'اختر من' : 'Choose from'}: ${pickLang(missing, 'name', lang)}`); return }
    onAdd(variant, flatMods, qty)
  }

  if (!portalRoot) return null
  return createPortal(
    <div className={`edt-stg ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true" aria-label={name}>
      <button type="button" className="edt-stg-x" onClick={close} aria-label={t('close')}><Icon name="close" size={20} /></button>
      <div className="edt-stg-scroll">
        <div className="edt-stg-hero" ref={heroRef}>
          {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className="edt-noimg"><Icon name="coffee" size={72} /></span>}
          <span className="edt-vignette" aria-hidden="true" />
          <ItemFx kind={item.effect} />
          {item.hotspots?.length ? <Suspense fallback={null}><DishHotspots hotspots={item.hotspots} /></Suspense> : null}
        </div>
        <div className="edt-stg-body">
          <h2 className="edt-stg-name">{name}</h2>
          <div className="edt-facts">
            {item.calories ? <span className="edt-fact"><i>{lang === 'ar' ? 'سعرات' : 'Calories'}</i><b>{item.calories}</b></span> : null}
            {item.prepTime ? <span className="edt-fact"><i>{lang === 'ar' ? 'التحضير' : 'Prep'}</i><b>{item.prepTime} {t('minutesShort')}</b></span> : null}
            {item.serves ? <span className="edt-fact"><i>{lang === 'ar' ? 'يكفي' : 'Serves'}</i><b>{item.serves}</b></span> : null}
            {item.rating ? <span className="edt-fact"><i>{lang === 'ar' ? 'التقييم' : 'Rating'}</i><b>{item.rating}</b></span> : null}
          </div>
          {desc && <p className="edt-stg-desc">{desc}</p>}
          {ings.length > 0 && (
            <div className="edt-ing edt-stg-ing">
              <span className="edt-ing-title">{lang === 'ar' ? 'المكونات' : 'Ingredients'}</span>
              <ul>
                {ings.map((g, i) => (
                  <li key={i} style={{ animationDelay: `${(0.3 + i * 0.05).toFixed(2)}s` }}><AmberAmounts text={pickLang(g, 'name', lang)} /></li>
                ))}
              </ul>
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
          {err && <p className="edt-stg-err" role="alert">{err}</p>}
        </div>
      </div>
      {onAdd && (
        <div className="edt-stg-bar">
          <Stepper value={qty} onChange={setQty} min={1} max={99} />
          <div className="edt-stg-total"><Price value={total} currency={currency} lang={lang} /></div>
          <button type="button" className="edt-stg-add" onClick={add}><Icon name="add" size={18} /> {t('addToCart')}</button>
        </div>
      )}
    </div>,
    portalRoot,
  )
}
