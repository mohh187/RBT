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
// straw baskets. So the canvas carries a brick + warm-plaster wall (pure CSS,
// index.css), the primary buttons are BRICKS, and each dish screen hangs one
// room ornament — lantern, clay pot or woven basket — behind the content.
// Both themes are first-class: every colour here comes from an --edt-* token
// and index.css re-declares the whole set under [data-theme='light'].
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
// The ONE contract for how a dish is composed: backdrop, photo, effect, entrance.
import { resolveComposition, bgStyle, imgStyle } from '../../lib/dishComposition.js'

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

// Room ornaments — the three objects the owner photographed on his walls,
// drawn as thin inline-SVG strokes so they cost nothing and tint from two
// tokens (--edt-orn-ink / --edt-orn-warm) that both themes redefine. They are
// pure chrome: aria-hidden, pointer-events none, and they sit in the photo
// band at the inline-start edge where no text ever lands.
function OrnLantern() {
  return (
    <svg viewBox="0 0 64 128" focusable="false" aria-hidden="true">
      <circle className="edt-orn-glow" cx="32" cy="54" r="27" />
      <g className="edt-orn-ink">
        <path d="M32 2v11" />
        <path d="M27 17c0-6 10-6 10 0" />
        <path d="M21 30h22l-5-11H26z" />
        <path d="M22 30h20l3 45H19z" />
        <path d="M20 45h24M20 60h24" />
        <path d="M18 75h28l-3 9H21z" />
        <path d="M32 84v7" />
      </g>
      <path className="edt-orn-warm" d="M30 46c0-5 4-7 4-11 3 3 5 6 5 10 0 5-4 8-5 8s-4-3-4-7z" />
    </svg>
  )
}

function OrnClayPot() {
  return (
    <svg viewBox="0 0 96 118" focusable="false" aria-hidden="true">
      <g className="edt-orn-ink">
        <path d="M37 10h22l-3 13H40z" />
        <path d="M40 23c-16 5-26 21-26 40 0 24 15 42 34 42s34-18 34-42c0-19-10-35-26-40z" />
        <path d="M17 52c19 7 43 7 62 0" />
        <path d="M15 70c21 8 45 8 66 0" />
        <path d="M22 88c16 6 36 6 52 0" />
      </g>
      <path className="edt-orn-warm" d="M17 56c19 7 43 7 62 0v8c-19 7-43 7-62 0z" />
    </svg>
  )
}

function OrnWovenBasket() {
  return (
    <svg viewBox="0 0 112 112" focusable="false" aria-hidden="true">
      <g className="edt-orn-ink">
        <circle cx="56" cy="56" r="51" />
        <circle cx="56" cy="56" r="38" />
        <circle cx="56" cy="56" r="25" />
        <circle cx="56" cy="56" r="12" />
        <path d="M56 5v102M5 56h102M20 20l72 72M92 20L20 92" />
      </g>
      <circle className="edt-orn-warm" cx="56" cy="56" r="31" />
    </svg>
  )
}

const ORNAMENTS = ['lantern', 'pot', 'basket']
function EdtOrnament({ idx }) {
  const kind = ORNAMENTS[idx % ORNAMENTS.length]
  return (
    <span className="edt-orn" data-orn={kind} aria-hidden="true">
      {kind === 'lantern' ? <OrnLantern /> : kind === 'pot' ? <OrnClayPot /> : <OrnWovenBasket />}
    </span>
  )
}

// allItems / onQuickAdd are OPTIONAL — with them the venue's curated «يُطلب معه»
// pairings become tappable straight from the LIST row; without them the list
// still renders everything else, so an un-patched caller degrades quietly.
export default function EditorialLayout({ cats, itemsByCat, visibleItems, filtered, activeCat, onPickCat, currency, offers, stickyTop, onOpen, allItems = [], onQuickAdd = null, showPairings = true }) {
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
          <div className="edt-stage" ref={stageRef}>
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
      <EdtOrnament idx={idx} />
      <span className="edt-side" aria-hidden="true">{catLabel}</span>
      <div className="edt-photo" data-fit={fit || undefined}>
        <span className="edt-glow" aria-hidden="true" />
        {/* the material the dish stands on + its garnish scatter: the behind
            layer paints under the photo, the front layer over it. Arrival is
            tied to the same in-view flag the text uses. */}
        <DishProps item={it} active={inview} catName={catLabel} />
        <EdtBackdrop bg={comp.bg} />
        <EdtDish comp={comp} src={it.imageUrl} anim={animAttr(comp)} bind={bind} onLoad={onLoad} fallback={64} />
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
export function EditorialItemStage({ item, currency, onClose, onAdd, originRect = null, allItems = [], offers = null, onQuickAdd = null }) {
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
    <div className={`edt-stg ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true" aria-label={name}>
      <button type="button" className="edt-stg-x" onClick={close} aria-label={t('close')}><Icon name="close" size={20} /></button>
      <div className="edt-stg-scroll">
        <div className="edt-stg-media">
          <div className="edt-stg-hero" ref={heroRef} data-fit={fit || undefined}>
            <span className="edt-glow" aria-hidden="true" />
            {/* quieter here: the stage variant caps the scatter and shortens
                the surface, so the full dish record stays the subject */}
            <DishProps item={item} active variant="stage" />
            <EdtBackdrop bg={comp.bg} />
            <EdtDish comp={comp} src={heroSrc} anim={stageAnim} bind={bind} onLoad={onLoad} fallback={72} />
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
