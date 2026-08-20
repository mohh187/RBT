import { useEffect, useMemo, useState } from 'react'
import Sheet from './Sheet.jsx'
import MenuPreview from './MenuPreview.jsx'
import GalleryZoom from './GalleryZoom.jsx'
import Icon from './Icon.jsx'
import { Price } from './Riyal.jsx'
import { pickLang } from '../lib/i18n.jsx'

// The window that opens when an owner taps an item CARD in the admin: everything
// there is to know about that dish, beside the two views a guest actually gets.
//
// Two problems shaped it. First, tapping a card used to render the guest's own
// EditorialItemStage / ItemSheet straight into the admin page. Those are built
// for a phone in one hand (100vw backgrounds, 100dvh stage, a table forced to
// 100vw), so on a 1920px monitor they became a wall of brick with a dish adrift
// in it. Constraining them in place is not possible: viewport units resolve
// against the WINDOW whatever box you put them in. So the preview runs where the
// viewport really is 390x844, inside the studio's proven iframe bus, in a phone
// frame, with the two views as tabs.
//
// Second, a preview alone still made the owner open the editor to answer
// «كم سعرة؟ ما الأحجام؟ هل يحتسب للولاء؟». So the left half is a read-only
// record of the whole document: every field that has a value, nothing that does
// not. An empty row is worse than no row, so each block is conditional.
const EMPTY_OVERRIDE = {}

const VIEWS = [
  { id: 'list', ar: 'الصنف في المنيو', en: 'In the menu' },
  { id: 'stage', ar: 'داخل نافذة الصنف', en: 'Inside its window' },
]

// The frame's INNER viewport stays 390x844 whatever happens, because that is
// what makes the menu lay out like a phone. Only the transform scale moves.
const BEZEL = 10
const FRAME_H = 844 + BEZEL * 2
// sheet handle + head + tabs + MenuPreview's own padding + caption + footer +
// the window's bottom offset. Rounded UP: underestimating it pushes the sheet
// past its max-height and grows a scrollbar around a device mock.
const CHROME = 300

function fitScale(wide) {
  if (typeof window === 'undefined') return 0.72
  const byH = (window.innerHeight - (wide ? 200 : CHROME)) / FRAME_H
  // …and by WIDTH, which matters more than it looks: the mock is a
  // transform-scaled box, so its layout width is the unscaled 410px whatever the
  // scale says. Left to grow by height alone it overflowed its column and
  // squeezed the record beside it into a ribbon.
  const byW = (wide ? 356 : Math.min(window.innerWidth, 560) - 56) / (390 + BEZEL * 2)
  return Math.max(0.42, Math.min(0.86, byH, byW))
}

const has = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)

// One fact cell. Renders nothing at all when the field is empty, which is what
// keeps the grid honest on a half-filled item.
function Fact({ icon, label, value, hint }) {
  if (!has(value)) return null
  return (
    <div className="ipv-fact">
      <span className="ipv-fact-k"><Icon name={icon} size={13} /> {label}</span>
      <strong className="ipv-fact-v">{value}</strong>
      {hint ? <span className="xs faint">{hint}</span> : null}
    </div>
  )
}

function Block({ title, children, count }) {
  if (!children) return null
  return (
    <section className="ipv-block">
      <h4 className="ipv-block-h">
        {title}
        {count ? <span className="ipv-count">{count}</span> : null}
      </h4>
      {children}
    </section>
  )
}

export default function ItemPreviewModal({ item, slug, lang = 'ar', currency = 'SAR', catName, onClose, onEdit }) {
  const ar = lang !== 'en'
  const [view, setView] = useState('list')
  const [replay, setReplay] = useState(0)
  const [zoom, setZoom] = useState(-1)
  const [wide, setWide] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(min-width: 980px)').matches
  ))
  const [scale, setScale] = useState(() => fitScale(wide))

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 980px)')
    const on = () => { setWide(mq.matches); setScale(fitScale(mq.matches)) }
    mq.addEventListener('change', on)
    window.addEventListener('resize', on)
    return () => { mq.removeEventListener('change', on); window.removeEventListener('resize', on) }
  }, [])

  // A new subject starts from how it reads in the list, which is the view that
  // decides whether a guest ever taps it at all.
  useEffect(() => { setView('list'); setZoom(-1) }, [item?.id])

  const focus = useMemo(
    () => (item?.id ? { itemId: item.id, view, replay } : null),
    [item?.id, view, replay],
  )
  const gallery = useMemo(
    () => [...new Set([item?.imageUrl, ...(item?.images || [])].filter(Boolean))],
    [item?.imageUrl, item?.images],
  )

  if (!item) return null
  const name = pickLang(item, 'name', lang) || item.nameAr || item.nameEn || ''
  const desc = pickLang(item, 'desc', lang) || item.descAr || item.descEn || ''
  const otherName = ar ? item.nameEn : item.nameAr
  const variants = item.variants || []
  const groups = item.modifierGroups || []
  const ingredients = item.ingredients || []
  const extras = [
    item.model3dUrl && (ar ? 'مجسم ثلاثي الأبعاد' : '3D model'),
    item.arStandeeUrl && (ar ? 'مجسم الواقع المعزز' : 'AR standee'),
    item.story && (ar ? 'قصة الطبق' : 'Dish story'),
    item.hotspots?.length && (ar ? `نقاط تفاعلية على الصورة: ${item.hotspots.length}` : `Hotspots: ${item.hotspots.length}`),
    item.recipe?.length && (ar ? `وصفة مرتبطة بالمخزون: ${item.recipe.length} مادة` : `Recipe: ${item.recipe.length} materials`),
    item.table && (ar ? 'منضدة خاصة بهذا الصنف' : 'Own table'),
    item.surface && (ar ? 'سطح تقديم مخصص' : 'Custom surface'),
  ].filter(Boolean)

  const window_ = item.availableFrom && item.availableTo
    ? `${item.availableFrom} إلى ${item.availableTo}`
    : ''

  const details = (
    <div className="ipv-detail">
      {/* photo BESIDE the identity, not a banner above it: a dish photo is
          square-ish, and stretched full width it swallowed the top of the record
          and pushed the facts below the fold. */}
      <div className="ipv-top">
        {gallery.length > 0 && (
          <div className="ipv-shot">
            <button
              type="button"
              className="ipv-shot-btn"
              onClick={() => setZoom(0)}
              title={ar ? 'اضغط لعرض الصورة بحجمها الكامل' : 'Open the photo full size'}
            >
              <img src={gallery[0]} alt={name} />
              <span className="ipv-shot-zoom"><Icon name="search" size={14} /></span>
            </button>
            {gallery.length > 1 && (
              <div className="ipv-thumbs">
                {gallery.slice(1, 5).map((g, i) => (
                  <button key={g} type="button" className="ipv-thumb" onClick={() => setZoom(i + 1)}>
                    <img src={g} alt="" loading="lazy" />
                  </button>
                ))}
                {gallery.length > 5 ? <span className="ipv-thumb-more">+{gallery.length - 5}</span> : null}
              </div>
            )}
          </div>
        )}
        <div className="ipv-ident">
          <div className="ipv-title">
            <strong>{name}</strong>
            {otherName ? <span className="xs faint">{otherName}</span> : null}
          </div>
          <div className="ipv-price"><Price value={item.price} currency={currency} lang={lang} /></div>
          <div className="ipv-badges">
            <span className={`badge ${item.available ? 'badge-success' : 'badge-danger'}`}>
              {item.available ? (ar ? 'متوفر' : 'Available') : (ar ? 'نفد' : 'Sold out')}
            </span>
            {catName && item.categoryId ? <span className="badge">{catName(item.categoryId)}</span> : null}
            {item.featured ? <span className="badge">{ar ? 'مميّز' : 'Featured'}</span> : null}
            {item.countsForLoyalty === false ? <span className="badge">{ar ? 'لا يحتسب للولاء' : 'No loyalty'}</span> : null}
            {item.archived ? <span className="badge badge-danger">{ar ? 'مؤرشف' : 'Archived'}</span> : null}
            {item.active === false ? <span className="badge">{ar ? 'مخفي من المنيو' : 'Hidden'}</span> : null}
          </div>
        </div>
      </div>

      <div className="ipv-facts">
        <Fact icon="flame" label={ar ? 'السعرات' : 'Calories'} value={item.calories} />
        <Fact icon="clock" label={ar ? 'وقت التحضير' : 'Prep time'} value={item.prepTime} hint={ar ? 'دقيقة' : 'min'} />
        <Fact icon="user" label={ar ? 'يكفي' : 'Serves'} value={item.serves} />
        <Fact icon="star" label={ar ? 'التقييم' : 'Rating'} value={item.rating} hint={item.reviewsCount ? (ar ? `من ${item.reviewsCount} تقييماً` : `${item.reviewsCount} reviews`) : ''} />
        <Fact icon="inventory" label={ar ? 'المخزون' : 'Stock'} value={item.trackStock ? (item.stock === '' ? '0' : item.stock) : ''} />
        <Fact icon="calendar" label={ar ? 'يُعرض بين' : 'Shown between'} value={window_} />
      </div>

      <Block title={ar ? 'الوصف' : 'Description'}>
        {desc ? <p className="ipv-desc">{desc}</p> : null}
      </Block>

      <Block title={ar ? 'المكوّنات' : 'Ingredients'} count={ingredients.length}>
        {ingredients.length ? (
          <div className="ipv-chips">
            {ingredients.map((ing, i) => (
              <span key={i} className="chip">{pickLang(ing, 'name', lang)}</span>
            ))}
          </div>
        ) : null}
      </Block>

      <Block title={ar ? 'الأحجام' : 'Sizes'} count={variants.length}>
        {variants.length ? (
          <ul className="ipv-rows">
            {variants.map((v, i) => (
              <li key={v.key || i}>
                <span>{pickLang(v, 'name', lang)}</span>
                <b><Price value={v.price} currency={currency} lang={lang} /></b>
              </li>
            ))}
          </ul>
        ) : null}
      </Block>

      <Block title={ar ? 'الإضافات' : 'Add-ons'} count={groups.length}>
        {groups.length ? (
          <div className="ipv-groups">
            {groups.map((g, gi) => (
              <div key={gi} className="ipv-group">
                <div className="ipv-group-h">
                  <span>{pickLang(g, 'name', lang)}</span>
                  <span className="xs faint">
                    {(g.required || Number(g.min) > 0) ? (ar ? 'إلزامية' : 'Required') : (ar ? 'اختيارية' : 'Optional')}
                    {Number(g.max) === 1 ? (ar ? ', خيار واحد' : ', one choice') : ''}
                  </span>
                </div>
                <div className="ipv-chips">
                  {(g.options || []).map((o, oi) => (
                    <span key={oi} className="chip">
                      {pickLang(o, 'name', lang)}
                      {Number(o.price) ? <> +<Price value={o.price} currency={currency} lang={lang} /></> : null}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Block>

      <Block title={ar ? 'تنبيه للمطبخ' : 'Kitchen note'}>
        {item.kdsWarning ? <p className="ipv-desc">{item.kdsWarning}</p> : null}
      </Block>

      <Block title={ar ? 'إضافات مُفعّلة على هذا الصنف' : 'Enabled extras'}>
        {extras.length ? (
          <div className="ipv-chips">
            {extras.map((x) => <span key={x} className="chip">{x}</span>)}
          </div>
        ) : null}
      </Block>
    </div>
  )

  const preview = (
    <div className="ipv-preview">
      <div className="itemprev-tabs" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            className={`chip ${view === v.id ? 'active' : ''}`}
            onClick={() => setView(v.id)}
          >
            {ar ? v.ar : v.en}
          </button>
        ))}
      </div>
      <div className="itemprev-frame">
        <MenuPreview slug={slug} override={EMPTY_OVERRIDE} mode="mobile" scale={scale} focus={focus} />
      </div>
      <p className="xs faint center" style={{ margin: 0 }}>
        {ar
          ? 'هذه القائمة الحقيقية داخل إطار جوال، والضغط هنا لا يضيف شيئاً لأي سلة'
          : 'The real menu inside a phone frame; nothing here touches a real cart'}
      </p>
    </div>
  )

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={name}
        className="itemprev"
        footer={(
          <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {onEdit && (
              <button type="button" className="btn btn-primary" onClick={() => { onClose?.(); onEdit(item) }}>
                <Icon name="edit" size={16} /> {ar ? 'تعديل هذا الصنف' : 'Edit this item'}
              </button>
            )}
            <button type="button" className="btn btn-outline" onClick={() => setReplay((r) => r + 1)}>
              <Icon name="reload" size={16} /> {ar ? 'إعادة الحركة' : 'Replay'}
            </button>
            <button type="button" className="btn btn-outline" onClick={onClose}>
              <Icon name="close" size={16} /> {ar ? 'إغلاق' : 'Close'}
            </button>
          </div>
        )}
      >
        <div className="ipv-grid">
          {details}
          {preview}
        </div>
      </Sheet>
      {zoom >= 0 && gallery.length > 0 && (
        <GalleryZoom gallery={gallery} startIdx={zoom} onClose={() => setZoom(-1)} />
      )}
    </>
  )
}
