// OceanArtLayout — skin 'oceanart' («اللوحة الفنية»): Ocean-Basket-style art
// direction. Deep saturated painted backdrop (per-category cover image >
// tenant.artBgUrl > CSS-crafted texture of tenant.artBgTone), grain overlay,
// one dominant rotated plate photo per row with a layered tone-tinted shadow,
// a scalloped white price seal on the photo corner, hand-styled names and
// wavy divider accents. Item open reuses the existing sheet/immersive detail;
// the [data-oa-tone] attribute (mirrored onto the portal root by MenuView)
// re-skins the portaled sheet in the same blue-canvas styling.
import { lazy, Suspense, useMemo } from 'react'
import { useI18n, pickLang } from '../../lib/i18n.jsx'
import Icon from '../Icon.jsx'
import ItemFx from '../ItemFx.jsx'
import { Empty } from '../ui.jsx'
import { Price } from '../Riyal.jsx'
import { offerForItem, discountedPrice } from '../../lib/offers.js'

// Built by a parallel agent — lazy + catch so a missing module never crashes
// the menu; pulse-dots over the plate open its own label/desc popover.
const DishHotspots = lazy(() => import('../DishHotspots.jsx').catch(() => ({ default: () => null })))

export const OA_TONES = ['deepblue', 'emerald', 'burgundy', 'charcoal']

// Scalloped seal: points on a base circle joined by small outward arcs.
const SEAL_PATH = (() => {
  const N = 12; const R = 42; const r = 11.5
  let d = ''
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * 2 * Math.PI
    const x = (50 + R * Math.cos(a)).toFixed(2)
    const y = (50 + R * Math.sin(a)).toFixed(2)
    d += i === 0 ? `M ${x} ${y}` : ` A ${r} ${r} 0 0 1 ${x} ${y}`
  }
  return d + ' Z'
})()

function WaveDivider() {
  return (
    <svg className="oa-wave" viewBox="0 0 120 10" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 5 Q 7.5 0, 15 5 T 30 5 T 45 5 T 60 5 T 75 5 T 90 5 T 105 5 T 120 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

const isOut = (it) => it.available === false || (it.trackStock && (it.stock || 0) <= 0)

export default function OceanArtLayout({ tenant, cats, itemsByCat, visibleItems, filtered, activeCat, onPickCat, currency, offers, stickyTop, onOpen }) {
  const { t, lang } = useI18n()
  const tone = OA_TONES.includes(tenant?.artBgTone) ? tenant.artBgTone : 'deepblue'
  const artBg = tenant?.artBgUrl || ''

  const groups = useMemo(() => (
    filtered
      ? [{ cat: null, items: visibleItems }]
      : [
          ...(cats || []).map((c) => ({ cat: c, items: itemsByCat[c.id] || [] })).filter((g) => g.items.length),
          ...((itemsByCat._uncat || []).length ? [{ cat: null, items: itemsByCat._uncat }] : []),
        ]
  ), [filtered, visibleItems, cats, itemsByCat])
  const empty = groups.every((g) => !g.items.length)

  return (
    <div className="oa-wrap" data-oa-tone={tone}>
      <div className="oa-cats scroll-x" style={{ top: stickyTop }}>
        <button type="button" className={`oa-chip ${activeCat === 'all' ? 'on' : ''}`} onClick={() => onPickCat('all')}>{t('all')}</button>
        {(cats || []).map((c) => (
          <button key={c.id} type="button" className={`oa-chip ${activeCat === c.id ? 'on' : ''}`} onClick={() => onPickCat(c.id)}>{pickLang(c, 'name', lang)}</button>
        ))}
      </div>
      {empty ? (
        <div className="oa-empty"><Empty icon="menu" title={lang === 'ar' ? 'لا توجد أصناف' : 'No items'} /></div>
      ) : (
        groups.map((g, gi) => (
          <OaSection key={g.cat?.id || `g${gi}`} cat={g.cat} items={g.items} artBg={artBg} currency={currency} offers={offers} lang={lang} t={t} onOpen={onOpen} />
        ))
      )}
    </div>
  )
}

function OaSection({ cat, items, artBg, currency, offers, lang, t, onOpen }) {
  // Backdrop priority: this category's cover image > venue art image > tone texture.
  const bgImg = cat?.coverUrl || cat?.imageUrl || artBg
  const cdesc = cat ? pickLang(cat, 'desc', lang) : ''
  return (
    <section className="oa-sec">
      {bgImg ? <span className="oa-bg" style={{ backgroundImage: `url(${bgImg})` }} aria-hidden="true" /> : <span className="oa-texture" aria-hidden="true" />}
      <span className="oa-veil" aria-hidden="true" />
      <div className="oa-in">
        <header className="oa-head">
          <h3 className="oa-cat-name">{cat ? pickLang(cat, 'name', lang) : (lang === 'ar' ? 'القائمة' : 'The Menu')}</h3>
          {cdesc && <p className="oa-cat-desc">{cdesc}</p>}
          <WaveDivider />
        </header>
        {items.map((it, i) => (
          <OaCard key={it.id} it={it} flip={i % 2 === 1} currency={currency} offers={offers} lang={lang} t={t} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}

function OaCard({ it, flip, currency, offers, lang, t, onOpen }) {
  const out = isOut(it)
  const offer = offerForItem(it, offers)
  const price = offer ? discountedPrice(it.price, offer) : it.price
  const name = pickLang(it, 'name', lang)
  const desc = pickLang(it, 'desc', lang)
  const open = () => { if (!out) onOpen(it) }
  return (
    <div className={`oa-card ${out ? 'is-out' : ''}`} data-flip={flip ? '1' : '0'}>
      <div className="oa-plate">
        {it.imageUrl ? <img src={it.imageUrl} alt="" /> : <span className="oa-noimg"><Icon name="coffee" size={54} /></span>}
        <button type="button" className="oa-plate-open" onClick={open} aria-label={name} disabled={out} />
        <ItemFx kind={it.effect} />
        {it.hotspots?.length ? <Suspense fallback={null}><DishHotspots hotspots={it.hotspots} /></Suspense> : null}
        <span className="oa-seal" aria-hidden="true">
          <svg viewBox="0 0 100 100"><path d={SEAL_PATH} /></svg>
          <span className="oa-seal-in">
            <Price value={price} currency={currency} lang={lang} />
            {offer && <span className="oa-seal-was"><Price value={it.price} currency={currency} lang={lang} /></span>}
          </span>
        </span>
        {out && <span className="oa-out">{t('soldOut')}</span>}
      </div>
      <div className="oa-txt">
        <button type="button" className="oa-name" onClick={open} disabled={out}>{name}</button>
        {desc && <p className="oa-desc">{desc}</p>}
        <div className="oa-meta">
          {it.rating ? <span><Icon name="star" size={13} fill="currentColor" strokeWidth={1.5} /> {it.rating}</span> : null}
          {it.calories ? <span><Icon name="flame" size={13} /> {it.calories}</span> : null}
          {it.prepTime ? <span><Icon name="clock" size={13} /> {it.prepTime} {t('minutesShort')}</span> : null}
        </div>
      </div>
    </div>
  )
}
