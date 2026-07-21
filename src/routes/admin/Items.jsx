import { useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAuth } from '../../lib/auth.jsx'
import { CAP } from '../../lib/permissions.js'
import { planAllows } from '../../lib/plans.js'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../lib/firebase.js'
import { useI18n, pickLang } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import Sheet from '../../components/Sheet.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { watchItems, watchCategories, saveItem, deleteItem, setItemAvailability, watchMaterials, duplicateItem, publishUrlAsStory } from '../../lib/db.js'
import { uploadImage, uploadFile } from '../../lib/storage.js'
import ContrastHint from '../../components/ContrastHint.jsx'
import ImageCropper from '../../components/ImageCropper.jsx'
import RecipeEditor from '../../components/RecipeEditor.jsx'
import { Price } from '../../components/Riyal.jsx'
import Icon from '../../components/Icon.jsx'
import { ItemSheet } from '../../components/MenuView.jsx'
import ModelStudio from '../../components/ModelStudio.jsx'
import ItemFx from '../../components/ItemFx.jsx'
import DishHotspots from '../../components/DishHotspots.jsx'
import { lex, venueType } from '../../lib/venueTypes.js'
import { sectionTemplate, templateOptions } from '../../lib/systemTemplates.js'
// Surface + garnish: the catalogue is data-only (no React, no CSS), the drawing
// component is the very one the live menu uses — so the editor preview is the
// real thing rather than an approximation of it.
import { SURFACES, PROPS, PROP_CATEGORIES } from '../../lib/dishProps.js'
import DishProps from '../../components/menuThemes/DishProps.jsx'
// Dish composition: the ONE contract for the backdrop, the photo on it, the
// effect over it and how it arrives. The composer below builds every control
// from these catalogues and previews with the renderer's own style functions,
// so a control and the pixel it produces cannot drift.
import { BLEND_MODES, FILTERS, ANIMS, FX, RANGE, resolveComposition, bgStyle, imgStyle } from '../../lib/dishComposition.js'
import '../../styles/appearance.css'

// NOTE: none of the composition fields live here. An item nobody has composed
// must not carry a document full of defaults, so the composer treats an absent
// key as "default" and only writes what the owner actually moved.
const blank = () => ({
  nameAr: '', nameEn: '', price: '', calories: '', categoryId: '',
  descAr: '', descEn: '', kdsWarning: '', imageUrl: '', images: [], imageStyle: '', hotspots: [], story: null, arStandeeUrl: '', model3dUrl: '', model3dUsdzUrl: '', available: true, availableFrom: '', availableTo: '', countsForLoyalty: true, featured: false, promoNotify: 'default', trackStock: false, stock: '',
  prepTime: '', serves: '', rating: '', reviewsCount: '',
  ingredients: [], variants: [], modifierGroups: [], sortOrder: 0,
  recipe: [], variantRecipes: {},
  namePriceLayout: '', nameColor: '', priceColor: '', namePriceStyle: '',
  // dish styling layer (lib/dishProps.js): '' surface = the layer is off, which
  // is the default for every new item — it renders only when asked for
  surface: '', props: null,
})

// The garnish half of the item document, read back into the flat shape the
// editor's controls need. This MIRRORS readConfig() in lib/dishProps.js: the
// same document can arrive as 'none', an id array, or an object, and the editor
// must understand every form it might already be stored in.
function readGarnish(raw) {
  if (raw === 'none' || raw === false || raw === '') return { on: false, ids: [], density: 'normal' }
  if (Array.isArray(raw)) return { on: true, ids: raw.filter((x) => typeof x === 'string'), density: 'normal' }
  if (raw && typeof raw === 'object') {
    if (raw.off === true) return { on: false, ids: [], density: 'normal' }
    return { on: true, ids: Array.isArray(raw.ids) ? raw.ids.filter((x) => typeof x === 'string') : [], density: raw.density || 'normal' }
  }
  // absent -> the layer picks its own garnish from the dish name
  return { on: true, ids: [], density: 'normal' }
}

// Surface choices, in picker order. 'auto' is deliberately NOT a catalogue id:
// resolveDishProps() falls back to the automatic material for an unknown one,
// which is exactly the behaviour "let the system choose" needs — and it keeps
// the field truthy, which is what switches the whole layer on.
const SURFACE_CHOICES = [
  { id: 'auto', labelAr: 'تلقائي حسب الصنف', labelEn: 'Auto for this dish' },
  { id: 'none', labelAr: 'بدون سطح', labelEn: 'No surface' },
  ...SURFACES,
]
const DENSITY_CHOICES = [
  ['low', 'خفيفة', 'Light'],
  ['normal', 'متوسطة', 'Normal'],
  ['rich', 'غنية', 'Rich'],
]

// ---------------------------------------------------- dish composition ------
// The default of every field lib/dishComposition.js reads, in that module's own
// terms. `null` on the three list-only fields is not "zero": resolveComposition
// falls back to the opened-item value while they are absent, which is exactly
// what an owner who only tuned the item screen expects the list to do.
const COMPOSE_DEFAULTS = {
  bgUrl: '', bgKind: '', bgOpacity: RANGE.bgOpacity.dflt, bgPos: 'center', bgScale: 1, bgBlend: 'normal', bgFilter: '',
  imageScale: RANGE.scale.dflt, imageX: RANGE.offset.dflt, imageY: RANGE.offset.dflt,
  listScale: null, listX: null, listY: null,
  imageRot: RANGE.rot.dflt, imageBlend: 'normal', imageFilter: '', imageBlur: RANGE.blur.dflt,
  shadowOn: false, shadowX: 0, shadowY: 14, shadowBlur: RANGE.shadowBlur.dflt, shadowOpacity: 0.45, shadowColor: '#000000',
  effect: '', anim: '',
}

// The bounds resolveComposition() clamps each numeric field to. Sliders read
// them and the save clamps to them, so a value that reaches the document is
// always a value the renderer will honour. bgScale and the two shadow offsets
// have no RANGE entry — those numbers come from resolveComposition's own clamps.
const COMPOSE_BOUNDS = {
  bgOpacity: [RANGE.bgOpacity.min, RANGE.bgOpacity.max],
  bgScale: [0.5, 3],
  imageScale: [RANGE.scale.min, RANGE.scale.max],
  listScale: [RANGE.scale.min, RANGE.scale.max],
  imageX: [RANGE.offset.min, RANGE.offset.max],
  imageY: [RANGE.offset.min, RANGE.offset.max],
  listX: [RANGE.offset.min, RANGE.offset.max],
  listY: [RANGE.offset.min, RANGE.offset.max],
  imageRot: [RANGE.rot.min, RANGE.rot.max],
  imageBlur: [RANGE.blur.min, RANGE.blur.max],
  shadowX: [-60, 60],
  shadowY: [-60, 60],
  shadowBlur: [RANGE.shadowBlur.min, RANGE.shadowBlur.max],
  shadowOpacity: [RANGE.opacity.min, RANGE.opacity.max],
}
const compClamp = (v, key, dflt) => {
  const b = COMPOSE_BOUNDS[key]
  const n = Number(v)
  if (!Number.isFinite(n) || !b) return dflt
  return Math.min(b[1], Math.max(b[0], n))
}
// A list-only override: absent stays absent (null), a number is clamped.
const compOpt = (v, key) => (v == null || v === '' ? null : compClamp(v, key, null))
const compId = (v, catalogue, dflt) => (catalogue.some((c) => c.id === String(v || '')) ? String(v || '') : dflt)

/**
 * What the composer contributes to the item's save payload.
 *
 * A key is written ONLY when the owner moved it off its default, or when the
 * stored document already carries that key (so a reset can clear a value that
 * really is saved). An item nobody has composed therefore gains nothing —
 * the alternative, stamping twenty-six defaults onto every dish in the menu,
 * would bloat every document and make "never touched" indistinguishable from
 * "deliberately set to the default".
 */
function composePayload(form, original) {
  const f = form || {}
  const orig = original || {}
  const next = {
    bgUrl: String(f.bgUrl || ''),
    bgKind: f.bgUrl ? (f.bgKind || 'image') : '',
    bgOpacity: compClamp(f.bgOpacity, 'bgOpacity', COMPOSE_DEFAULTS.bgOpacity),
    bgPos: String(f.bgPos || 'center'),
    bgScale: compClamp(f.bgScale, 'bgScale', COMPOSE_DEFAULTS.bgScale),
    bgBlend: compId(f.bgBlend, BLEND_MODES, 'normal'),
    bgFilter: compId(f.bgFilter, FILTERS, ''),
    imageScale: compClamp(f.imageScale, 'imageScale', COMPOSE_DEFAULTS.imageScale),
    imageX: compClamp(f.imageX, 'imageX', COMPOSE_DEFAULTS.imageX),
    imageY: compClamp(f.imageY, 'imageY', COMPOSE_DEFAULTS.imageY),
    listScale: compOpt(f.listScale, 'listScale'),
    listX: compOpt(f.listX, 'listX'),
    listY: compOpt(f.listY, 'listY'),
    imageRot: compClamp(f.imageRot, 'imageRot', COMPOSE_DEFAULTS.imageRot),
    imageBlend: compId(f.imageBlend, BLEND_MODES, 'normal'),
    imageFilter: compId(f.imageFilter, FILTERS, ''),
    imageBlur: compClamp(f.imageBlur, 'imageBlur', COMPOSE_DEFAULTS.imageBlur),
    shadowOn: !!f.shadowOn,
    shadowX: compClamp(f.shadowX, 'shadowX', COMPOSE_DEFAULTS.shadowX),
    shadowY: compClamp(f.shadowY, 'shadowY', COMPOSE_DEFAULTS.shadowY),
    shadowBlur: compClamp(f.shadowBlur, 'shadowBlur', COMPOSE_DEFAULTS.shadowBlur),
    shadowOpacity: compClamp(f.shadowOpacity, 'shadowOpacity', COMPOSE_DEFAULTS.shadowOpacity),
    shadowColor: String(f.shadowColor || COMPOSE_DEFAULTS.shadowColor),
    effect: compId(f.effect, FX, ''),
    anim: compId(f.anim, ANIMS, ''),
  }
  const out = {}
  Object.keys(COMPOSE_DEFAULTS).forEach((k) => {
    if (next[k] !== COMPOSE_DEFAULTS[k] || orig[k] !== undefined) out[k] = next[k]
  })
  return out
}

export default function Items() {
  const { t, lang } = useI18n()
  const { tenantId, tenant } = useAuth()
  const toast = useToast()
  const currency = tenant?.currency || 'SAR'

  const [items, setItems] = useState(null)
  const [cats, setCats] = useState([])
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)
  const [previewItem, setPreviewItem] = useState(null)
  // Menu-management layout template (table | cards | catalog) — plan-gated saved
  // default, switchable on the fly. Drag-reorder stays a table-view affordance.
  const [tpl, setTpl] = useState('table')
  // Bulk selection mode — checkboxes on rows/cards + a sticky action bar.
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  // Batch photo→realistic-3D queue + per-item model studio (list-level entries).
  const can3d = planAllows(tenant, 'ar3d')
  const [batchOpen, setBatchOpen] = useState(false)
  const [studioItem, setStudioItem] = useState(null)

  useEffect(() => { setTpl(sectionTemplate(tenant, 'menu')) }, [tenant])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  )

  useEffect(() => {
    if (!tenantId) return
    const u1 = watchItems(tenantId, setItems)
    const u2 = watchCategories(tenantId, setCats)
    return () => { u1(); u2() }
  }, [tenantId])

  const catName = (id) => {
    const c = cats.find((x) => x.id === id)
    return c ? pickLang(c, 'name', lang) : ''
  }

  // Archived items stay out of every normal view — only the dedicated chip shows them.
  const archivedCount = useMemo(() => (items || []).filter((i) => i.archived).length, [items])

  const shown = useMemo(() => {
    let list = items || []
    list = filter === 'archived' ? list.filter((i) => i.archived) : list.filter((i) => !i.archived)
    if (filter !== 'all' && filter !== 'archived') list = list.filter((i) => i.categoryId === filter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((i) => `${i.nameAr} ${i.nameEn}`.toLowerCase().includes(q))
    }
    return list
  }, [items, filter, search])

  // Reorder in table view — for the whole menu ('all') OR within one selected
  // category. Not while searching (the visible set isn't the real order then),
  // not in the archive view, and not while bulk-selecting.
  const reorderable = !search.trim() && filter !== 'archived' && !selectMode

  // Reorder a visible list (whole view, one filtered category, or one catalog
  // section) and merge it back into the full items array before persisting.
  const reorderList = async (list, active, over) => {
    if (!over || active.id === over.id) return
    const ids = list.map((i) => i.id)
    const next = arrayMove(list, ids.indexOf(active.id), ids.indexOf(over.id))
    const setIds = new Set(ids)
    let k = 0
    setItems(items.map((it) => (setIds.has(it.id) ? next[k++] : it)))
    await Promise.all(next.map((it, idx) => (it.sortOrder !== idx ? saveItem(tenantId, it.id, { sortOrder: idx }) : null)).filter(Boolean))
  }
  const onDragEnd = ({ active, over }) => reorderList(shown, active, over)
  const sectionDragEnd = (list) => ({ active, over }) => reorderList(list, active, over)

  const openNew = () => { setEditing(blank()); setOpen(true) }
  const openEdit = (it) => { setEditing({ ...blank(), ...it, ingredients: it.ingredients || [], variants: it.variants || [], modifierGroups: it.modifierGroups || [] }); setOpen(true) }
  // One-tap full clone (variants, modifiers, recipe, image, description, …).
  const [dupBusy, setDupBusy] = useState('')
  const dup = async (it, e) => {
    e?.stopPropagation()
    if (dupBusy) return
    setDupBusy(it.id)
    try { await duplicateItem(tenantId, it.id); toast.success(lang === 'ar' ? 'تم تكرار الصنف' : 'Item duplicated') }
    catch (_) { toast.error(lang === 'ar' ? 'تعذّر التكرار' : 'Could not duplicate') }
    finally { setDupBusy('') }
  }
  // Star toggle → add/remove the item from the featured strip (manual featured mode).
  const toggleStar = (it, e) => {
    e?.stopPropagation()
    saveItem(tenantId, it.id, { featured: !it.featured })
      .then(() => toast.success(it.featured ? (lang === 'ar' ? 'أُزيل من المميّزة' : 'Removed from featured') : (lang === 'ar' ? 'أُضيف للمميّزة' : 'Added to featured')))
      .catch(() => toast.error(t('error')))
  }
  // Bring an archived item back to the live menu.
  const restoreItem = (it, e) => {
    e?.stopPropagation()
    saveItem(tenantId, it.id, { archived: false, available: true })
      .then(() => toast.success(lang === 'ar' ? 'تمت استعادة الصنف' : 'Item restored'))
      .catch(() => toast.error(t('error')))
  }

  const toggleSelectMode = () => { setSelectMode((v) => !v); setSelected(new Set()) }
  const toggleSelect = (id) => setSelected((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  // Apply one partial patch to every selected item, then leave selection mode.
  const applyBulk = async (patch) => {
    if (!selected.size || bulkBusy) return
    setBulkBusy(true)
    try {
      await Promise.all([...selected].map((id) => saveItem(tenantId, id, patch)))
      toast.success(lang === 'ar' ? `تم تحديث ${selected.size} صنف` : `Updated ${selected.size} items`)
      setSelected(new Set())
      setSelectMode(false)
    } catch (_) {
      toast.error(t('error'))
    } finally {
      setBulkBusy(false)
    }
  }

  if (items === null) return <Spinner />

  const Row = (it) => (
    <div
      className={`item-card ${!it.available ? 'unavailable' : ''}`}
      style={{ marginBottom: 8, cursor: 'pointer', outline: selectMode && selected.has(it.id) ? '2px solid var(--brand)' : undefined }}
      onClick={() => (selectMode ? toggleSelect(it.id) : setPreviewItem(it))}
    >
      {selectMode && (
        <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggleSelect(it.id)} onClick={(e) => e.stopPropagation()}
          style={{ width: 22, height: 22, flex: 'none', alignSelf: 'center', cursor: 'pointer', accentColor: 'var(--brand)' }} />
      )}
      {it.imageUrl ? <img className="thumb" src={it.imageUrl} alt="" loading="lazy" /> : <div className="thumb center muted"><Icon name="coffee" size={26} /></div>}
      <div className="body">
        <div className="name">{pickLang(it, 'name', lang)}</div>
        <div className="xs faint">
          {catName(it.categoryId)}
          {it.variants?.length ? ` · ${it.variants.length} ${t('variants')}` : ''}
          {it.modifierGroups?.length ? ` · ${it.modifierGroups.length} ${lang === 'ar' ? 'إضافات' : 'mods'}` : ''}
        </div>
        <div className="meta">
          <span className="price"><Price value={it.price} currency={currency} lang={lang} /></span>
          {it.archived ? (
            <button className="btn btn-sm btn-outline" onClick={(e) => restoreItem(it, e)}><Icon name="undo" size={14} /> {lang === 'ar' ? 'استعادة' : 'Restore'}</button>
          ) : (
            <div className="row" style={{ gap: 6 }}>
              <button className={`badge ${it.available ? 'badge-success' : 'badge-danger'}`} onClick={(e) => { e.stopPropagation(); setItemAvailability(tenantId, it.id, !it.available) }}>
                {it.available ? t('available') : t('soldOut')}
              </button>
              <button className="btn btn-sm btn-outline" onClick={(e) => toggleStar(it, e)} title={lang === 'ar' ? 'صنف مميّز' : 'Featured'} style={{ color: it.featured ? 'var(--gold)' : 'var(--text-muted)' }}><Icon name="star" size={14} /></button>
              <button className="btn btn-sm btn-outline" disabled={dupBusy === it.id} onClick={(e) => dup(it, e)} title={lang === 'ar' ? 'تكرار الصنف' : 'Duplicate'}><Icon name="copy" size={14} /></button>
              {(it.model3dUrl || it.arStandeeUrl) && (
                <button className="btn btn-sm btn-outline" onClick={(e) => { e.stopPropagation(); setStudioItem(it) }} title={lang === 'ar' ? 'استوديو المجسم' : '3D studio'} style={{ color: 'var(--brand)' }}><Icon name="layers" size={14} /></button>
              )}
              <button className="btn btn-sm btn-outline" onClick={(e) => { e.stopPropagation(); openEdit(it) }}>{t('edit')}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  // cards template: visual tile with the same quick actions
  const Card = (it) => (
    <div
      key={it.id}
      className={`item-tile card ${!it.available ? 'unavailable' : ''}`}
      style={{ position: 'relative', outline: selectMode && selected.has(it.id) ? '2px solid var(--brand)' : undefined }}
      onClick={() => (selectMode ? toggleSelect(it.id) : setPreviewItem(it))}
    >
      {selectMode && (
        <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggleSelect(it.id)} onClick={(e) => e.stopPropagation()}
          style={{ position: 'absolute', top: 8, insetInlineStart: 8, width: 22, height: 22, zIndex: 2, cursor: 'pointer', accentColor: 'var(--brand)' }} />
      )}
      {it.imageUrl
        ? <img src={it.imageUrl} alt="" loading="lazy" style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }} />
        : <div style={{ width: '100%', height: 110, background: 'var(--surface-2)', display: 'grid', placeItems: 'center' }}><Icon name="coffee" size={26} className="faint" /></div>}
      <div className="stack" style={{ gap: 4, padding: '8px 10px 10px' }}>
        <span className="bold" style={{ lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pickLang(it, 'name', lang)}</span>
        <span className="xs faint">{catName(it.categoryId) || '—'}</span>
        <div className="row-between" style={{ alignItems: 'center' }}>
          <span className="pos-price"><Price value={it.price} currency={currency} lang={lang} /></span>
          {!it.archived && (
            <button className={`badge ${it.available ? 'badge-success' : 'badge-danger'}`} onClick={(e) => { e.stopPropagation(); setItemAvailability(tenantId, it.id, !it.available) }}>
              {it.available ? t('available') : t('soldOut')}
            </button>
          )}
        </div>
        {it.archived ? (
          <button className="btn btn-sm btn-outline" onClick={(e) => restoreItem(it, e)}><Icon name="undo" size={14} /> {lang === 'ar' ? 'استعادة' : 'Restore'}</button>
        ) : (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-outline grow" onClick={(e) => { e.stopPropagation(); openEdit(it) }}>{t('edit')}</button>
            <button className="btn btn-sm btn-outline" onClick={(e) => toggleStar(it, e)} title={lang === 'ar' ? 'صنف مميّز' : 'Featured'} style={{ color: it.featured ? 'var(--gold)' : 'var(--text-muted)' }}><Icon name="star" size={14} /></button>
            <button className="btn btn-sm btn-outline" disabled={dupBusy === it.id} onClick={(e) => dup(it, e)} title={lang === 'ar' ? 'تكرار الصنف' : 'Duplicate'}><Icon name="copy" size={14} /></button>
            {(it.model3dUrl || it.arStandeeUrl) && (
              <button className="btn btn-sm btn-outline" onClick={(e) => { e.stopPropagation(); setStudioItem(it) }} title={lang === 'ar' ? 'استوديو المجسم' : '3D studio'} style={{ color: 'var(--brand)' }}><Icon name="layers" size={14} /></button>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="page stack">
      <div className="row-between">
        <h2 className="page-title">{t('items')}</h2>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <button className={`btn btn-sm ${selectMode ? 'btn-primary' : 'btn-outline'}`} onClick={toggleSelectMode}>
            <Icon name="check" size={14} /> {lang === 'ar' ? 'تحديد' : 'Select'}
          </button>
          <div className="pos-tpl-switch row" style={{ gap: 2, flex: 'none' }}>
            {templateOptions('menu').map((o) => (
              <button key={o.id} type="button" className={`icon-btn ${tpl === o.id ? 'active' : ''}`} title={lang === 'ar' ? o.ar : o.en} onClick={() => setTpl(o.id)}>
                <Icon name={{ table: 'list', cards: 'grid', catalog: 'categories' }[o.id] || 'list'} size={16} />
              </button>
            ))}
          </div>
          {can3d ? (
            <button className="btn btn-sm btn-outline" onClick={() => setBatchOpen(true)} title={lang === 'ar' ? 'حوّل كل الأصناف المصوّرة إلى مجسمات واقعية دفعة واحدة' : 'Convert all photographed items to realistic 3D'}>
              <Icon name="layers" size={14} /> {lang === 'ar' ? 'تحويل جماعي 3D' : 'Batch 3D'}
            </button>
          ) : (
            <span className="badge" title={lang === 'ar' ? 'التحويل الواقعي الجماعي ميزة الباقة المتكاملة' : 'Batch realistic 3D is an Enterprise feature'}>
              <Icon name="lock" size={11} /> 3D
            </span>
          )}
          <button className="btn btn-primary btn-sm" onClick={openNew}>+ {t('addItem')}</button>
        </div>
      </div>

      <input className="input" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="scroll-x">
        <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>{t('all')}</button>
        {cats.map((c) => (
          <button key={c.id} className={`chip ${filter === c.id ? 'active' : ''}`} onClick={() => setFilter(c.id)}>{pickLang(c, 'name', lang)}</button>
        ))}
        {(archivedCount > 0 || filter === 'archived') && (
          <button className={`chip ${filter === 'archived' ? 'active' : ''}`} onClick={() => setFilter('archived')}>
            {lang === 'ar' ? `المؤرشفة (${archivedCount})` : `Archived (${archivedCount})`}
          </button>
        )}
      </div>

      {tpl === 'table' && reorderable && shown.length > 1 && <p className="xs faint"><Icon name="arrowUpDown" size={12} style={{ verticalAlign: 'middle' }} /> {lang === 'ar' ? 'اسحب لإعادة الترتيب' : 'Drag to reorder'}</p>}

      {shown.length === 0 ? (
        <Empty icon="menu" title={t('noItems')} hint={t('addFirstItem')} action={<button className="btn btn-primary" onClick={openNew}>+ {t('addItem')}</button>} />
      ) : tpl === 'cards' ? (
        /* cards: visual grid — fastest to scan by photo */
        <div className="item-grid">{shown.map((it) => Card(it))}</div>
      ) : tpl === 'catalog' ? (
        /* catalog: grouped by category with section headers */
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          {[...cats.map((c) => ({ id: c.id, name: pickLang(c, 'name', lang) })), { id: '', name: lang === 'ar' ? 'بدون تصنيف' : 'Uncategorized' }].map((sec) => {
            const list = shown.filter((it) => (it.categoryId || '') === sec.id)
            if (!list.length) return null
            return (
              <section key={sec.id || 'none'} className="stack" style={{ gap: 'var(--sp-2)' }}>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <strong>{sec.name}</strong>
                  <span className="badge">{list.length}</span>
                  {reorderable && list.length > 1 && <span className="xs faint" style={{ marginInlineStart: 'auto' }}><Icon name="arrowUpDown" size={11} style={{ verticalAlign: 'middle' }} /> {lang === 'ar' ? 'اسحب للترتيب' : 'Drag to sort'}</span>}
                </div>
                {reorderable && list.length > 1 ? (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={sectionDragEnd(list)}>
                    <SortableContext items={list.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                      {list.map((it) => (
                        <SortableItem key={it.id} id={it.id}>{(handle) => (
                          <div className="row" style={{ gap: 4, alignItems: 'stretch' }}>
                            <button className="icon-btn" style={{ touchAction: 'none', cursor: 'grab', alignSelf: 'center' }} {...handle} aria-label="drag"><Icon name="drag" /></button>
                            <div className="grow">{Row(it)}</div>
                          </div>
                        )}</SortableItem>
                      ))}
                    </SortableContext>
                  </DndContext>
                ) : (
                  <div>{list.map((it) => <div key={it.id}>{Row(it)}</div>)}</div>
                )}
              </section>
            )
          })}
        </div>
      ) : reorderable ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={shown.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            {shown.map((it) => (
              <SortableItem key={it.id} id={it.id}>{(handle) => (
                <div className="row" style={{ gap: 4, alignItems: 'stretch' }}>
                  <button className="icon-btn" style={{ touchAction: 'none', cursor: 'grab', alignSelf: 'center' }} {...handle} aria-label="drag"><Icon name="drag" /></button>
                  <div className="grow">{Row(it)}</div>
                </div>
              )}</SortableItem>
            ))}
          </SortableContext>
        </DndContext>
      ) : (
        <div>{shown.map((it) => <div key={it.id}>{Row(it)}</div>)}</div>
      )}

      {selectMode && (
        /* sticky bulk-action bar — stays pinned above the list while scrolling; wraps at 360px */
        <div className="card card-pad" style={{ position: 'sticky', bottom: 0, zIndex: 30, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', boxShadow: 'var(--sh-2)' }}>
          <strong className="small num" style={{ flex: 'none' }}>
            {bulkBusy ? (lang === 'ar' ? 'جارٍ التطبيق' : 'Applying') : `${selected.size} ${lang === 'ar' ? 'محدد' : 'selected'}`}
          </strong>
          <select
            className="select" disabled={bulkBusy || !selected.size} value=""
            style={{ flex: '1 1 150px', minWidth: 0, width: 'auto' }}
            onChange={(e) => { if (e.target.value) applyBulk({ categoryId: e.target.value }) }}
          >
            <option value="">{lang === 'ar' ? 'تغيير التصنيف' : 'Change category'}</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{pickLang(c, 'name', lang)}</option>)}
          </select>
          <button className="btn btn-sm btn-outline" disabled={bulkBusy || !selected.size} onClick={() => applyBulk({ available: false })}>
            <Icon name="eyeOff" size={14} /> {lang === 'ar' ? 'تعطيل' : 'Disable'}
          </button>
          <button className="btn btn-sm btn-outline" disabled={bulkBusy || !selected.size} onClick={() => applyBulk({ available: true })}>
            <Icon name="eye" size={14} /> {lang === 'ar' ? 'تفعيل' : 'Enable'}
          </button>
          <button className="btn btn-sm btn-outline" disabled={bulkBusy || !selected.size} onClick={() => applyBulk({ archived: true, available: false })}>
            <Icon name="package" size={14} /> {lang === 'ar' ? 'أرشفة' : 'Archive'}
          </button>
          <button className="btn btn-sm btn-outline" disabled={bulkBusy || !selected.size} onClick={() => applyBulk({ featured: true })} style={{ color: 'var(--gold)' }}>
            <Icon name="star" size={14} /> {lang === 'ar' ? 'نجمة المميزة' : 'Feature'}
          </button>
          <button className="btn btn-sm btn-ghost" disabled={bulkBusy} onClick={toggleSelectMode} style={{ marginInlineStart: 'auto' }}>
            <Icon name="close" size={14} /> {lang === 'ar' ? 'إلغاء التحديد' : 'Cancel selection'}
          </button>
        </div>
      )}

      {open && (
        <ItemEditor
          tenantId={tenantId} cats={cats} currency={currency} value={editing} items={items}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); toast.success(t('saved')) }}
          onDeleted={() => { setOpen(false); toast.success(t('deleted')) }}
          onOpenStudio={(it) => { setOpen(false); setStudioItem(it) }}
        />
      )}

      {batchOpen && (
        <Batch3dSheet
          tenantId={tenantId} items={items} lang={lang}
          onClose={() => setBatchOpen(false)}
          onOpenStudio={(it) => { setBatchOpen(false); setStudioItem(it) }}
        />
      )}

      {studioItem && (
        <ModelStudio
          open onClose={() => setStudioItem(null)}
          tenantId={tenantId} item={studioItem}
          onChange={async (patch) => {
            try {
              if (studioItem.id) await saveItem(tenantId, studioItem.id, patch)
              setStudioItem((s) => (s ? { ...s, ...patch } : s))
            } catch (_) { toast.error(t('error')) }
          }}
        />
      )}

      {previewItem && (
        <ItemSheet
          item={previewItem}
          tenant={tenant}
          currency={currency}
          tenantId={tenantId}
          detail={tenant?.skin?.overrides?.detailLayout || 'sheet'}
          onClose={() => setPreviewItem(null)}
          onAdd={() => { toast.info(lang === 'ar' ? 'هذه معاينة فقط لعرض الصنف من لوحة الإدارة.' : 'This is a details preview only.') }}
        />
      )}
    </div>
  )
}

// Visual section header inside the item editor — groups the long flat form
// without moving any field or touching state/logic.
function EditorSection({ title, first, id }) {
  return (
    <div id={id} style={{ ...(first ? { paddingBottom: 2 } : { borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)', marginTop: 'var(--sp-2)', paddingBottom: 2 }), scrollMarginTop: 54 }}>
      <strong style={{ fontSize: 'var(--fs-md)' }}>{title}</strong>
    </div>
  )
}

// Sticky jump-chips inside the item editor sheet: one long form (state never
// unmounts) organized by anchors — a chip scrolls its section into view.
function EditorTabs({ lang }) {
  const tabs = [
    ['ie-basics', lang === 'ar' ? 'الأساسي' : 'Basics'],
    ['ie-images', lang === 'ar' ? 'الصور' : 'Images'],
    ['ie-compose', lang === 'ar' ? 'تركيب الصنف' : 'Composition'],
    ['ie-dish', lang === 'ar' ? 'السطح والزينة' : 'Surface & garnish'],
    ['ie-pricing', lang === 'ar' ? 'المقاسات والإضافات' : 'Sizes & mods'],
    ['ie-ar', lang === 'ar' ? '3D وAR' : '3D & AR'],
    ['ie-recipe', lang === 'ar' ? 'الوصفة والمخزون' : 'Recipe'],
    ['ie-advanced', lang === 'ar' ? 'متقدم' : 'Advanced'],
  ]
  const jump = (id) => {
    const el = document.getElementById(id)
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <div className="row ie-tabs" style={{ gap: 6, flexWrap: 'nowrap', overflowX: 'auto', position: 'sticky', top: -1, zIndex: 3, background: 'var(--surface)', paddingBlock: 6, marginBlock: -6 }}>
      {tabs.map(([id, label]) => (
        <button key={id} type="button" className="chip" style={{ flex: 'none' }} onClick={() => jump(id)}>{label}</button>
      ))}
    </div>
  )
}

function SortableItem({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return <div ref={setNodeRef} style={style}>{children({ ...listeners, ...attributes })}</div>
}

function ItemEditor({ tenantId, cats, currency, value, onClose, onSaved, onDeleted, onOpenStudio, items = [] }) {
  const { t, lang } = useI18n()
  const { can } = useAuth()
  // Price fields lock without the edit_prices cap — the staffer can still fix
  // names/photos/recipes, but pricing stays management-controlled.
  const canPrice = can(CAP.EDIT_PRICES)
  const toast = useToast()
  const [form, setForm] = useState(value)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [cropState, setCropState] = useState(null)
  const [materials, setMaterials] = useState([])
  const isNew = !form.id
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  // The document as it arrived. composePayload() needs it to tell "the owner
  // never touched this" (write nothing) from "the owner reset it" (write the
  // default, which clears what is stored).
  const origRef = useRef(value || {})

  useEffect(() => { if (!tenantId) return; return watchMaterials(tenantId, setMaterials) }, [tenantId])

  // Pick → open the cropper (zoom/move/crop to fit the theme), then upload.
  const onPick = (e, target = 'primary') => { const file = e.target.files?.[0]; e.target.value = ''; if (file) setCropState({ file, target }) }
  const onCropped = async (blob) => {
    const target = cropState?.target || 'primary'
    setCropState(null)
    setUploading(true)
    try {
      const f = new File([blob], `item-${Date.now()}.webp`, { type: 'image/webp' })
      const url = await uploadImage(tenantId, f)
      if (target === 'extra') set('images', [...(form.images || []), url])
      else if (target === 'bg') setForm((s) => ({ ...s, bgUrl: url, bgKind: 'image' }))
      else set('imageUrl', url)
    } catch (_) {
      toast.error(lang === 'ar' ? 'تعذّر رفع الصورة' : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }
  const removeImage = (i) => set('images', (form.images || []).filter((_, idx) => idx !== i))

  // AI background removal: runs fully in the browser (model cached after first
  // use), uploads the transparent PNG cutout and swaps the item photo to it.
  const [bgBusy, setBgBusy] = useState(false)
  const stripBg = async () => {
    if (!form.imageUrl || bgBusy) return
    setBgBusy(true)
    try {
      const { removeBackgroundToFile } = await import('../../lib/bgRemove.js')
      const file = await removeBackgroundToFile(form.imageUrl, `item-cutout-${Date.now()}.png`)
      const url = await uploadImage(tenantId, file)
      set('imageUrl', url)
      toast.success(lang === 'ar' ? 'أُزيلت الخلفية' : 'Background removed')
    } catch (_) {
      toast.error(lang === 'ar' ? 'تعذّرت إزالة الخلفية — جرّب صورة أصغر أو أعد المحاولة' : 'Background removal failed — try again')
    } finally {
      setBgBusy(false)
    }
  }

  // AI product photo: item name (+ current photo as reference when present) →
  // nano-banana. CORS-blocked references degrade to a free scene automatically.
  const [aiImgBusy, setAiImgBusy] = useState(false)
  const [storyBusy, setStoryBusy] = useState(false)

  // ---- AR (عرض على الطاولة) ----
  // Generated standee: bg-removed photo → real GLB via ar3d.js. Real 3D meshes
  // (.glb/.usdz made externally) upload via the file input — both render in the
  // menu's AR viewer. Honest scope: photo→full-3D-mesh needs an external service.
  const [arBusy, setArBusy] = useState('')
  const genArStandee = async () => {
    if (!form.imageUrl) { toast.error(lang === 'ar' ? 'أضف صورة للصنف أولاً' : 'Add a photo first'); return }
    setArBusy('gen')
    try {
      const { photoToArStandee } = await import('../../lib/ar3d.js')
      const glb = await photoToArStandee(form.imageUrl, { onStep: (s) => setArBusy(s === 'bg' ? 'bg' : 'glb') })
      const file = new File([glb], `ar-${Date.now()}.glb`, { type: 'model/gltf-binary' })
      const url = await uploadFile(tenantId, file, 'library/ar')
      set('arStandeeUrl', url)
      toast.success(lang === 'ar' ? 'جاهز — احفظ الصنف ليظهر زر AR في المنيو' : 'Done — save the item to enable AR')
    } catch (e) {
      toast.error(e?.message || (lang === 'ar' ? 'تعذر إنشاء المجسم' : 'AR build failed'))
    } finally { setArBusy('') }
  }
  // REALISTIC 3D (top plan): server callable → Meshy image-to-3D → GLB in the
  // library + attached to the item. Long-running (1-8 min) with a live timer.
  const { tenant: tnt } = useAuth()
  const can3d = planAllows(tnt, 'ar3d')
  const [real3dSec, setReal3dSec] = useState(-1) // -1 idle, >=0 running (elapsed)
  useEffect(() => {
    if (real3dSec < 0) return undefined
    const iv = setInterval(() => setReal3dSec((s) => (s >= 0 ? s + 1 : s)), 1000)
    return () => clearInterval(iv)
  }, [real3dSec >= 0]) // eslint-disable-line react-hooks/exhaustive-deps
  const genReal3d = async () => {
    if (!form.imageUrl) { toast.error(lang === 'ar' ? 'أضف صورة للصنف أولاً' : 'Add a photo first'); return }
    setReal3dSec(0)
    try {
      const res = await httpsCallable(functions, 'imageTo3d', { timeout: 540000 })({ tenantId, itemId: form.id || '', imageUrl: form.imageUrl })
      const url = res?.data?.url
      if (!url) throw new Error(lang === 'ar' ? 'لم يصل رابط المجسم' : 'No model URL returned')
      set('model3dUrl', url)
      set('model3dUsdzUrl', res?.data?.usdzUrl || '')
      toast.success(lang === 'ar' ? 'اكتمل المجسم الواقعي — احفظ الصنف' : 'Realistic model ready — save the item')
    } catch (e) {
      toast.error(String(e?.message || e))
    } finally { setReal3dSec(-1) }
  }

  const onPickModel = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    if (!/\.(glb|usdz)$/i.test(f.name)) { toast.error(lang === 'ar' ? 'الملف يجب أن يكون .glb أو .usdz' : 'Must be .glb or .usdz'); return }
    setArBusy('upload')
    try {
      const url = await uploadFile(tenantId, f, 'library/ar')
      set('model3dUrl', url)
      toast.success(lang === 'ar' ? 'رُفع النموذج — احفظ الصنف' : 'Model uploaded — save the item')
    } catch (_) { toast.error(t('error')) } finally { setArBusy('') }
  }
  const genItemImage = async () => {
    if (aiImgBusy) return
    const label = form.nameAr || form.nameEn
    if (!label) { toast.error(lang === 'ar' ? 'اكتب اسم الصنف أولاً' : 'Name the item first'); return }
    setAiImgBusy(true)
    try {
      const { generatePostImage } = await import('../../lib/postGen.js')
      const blob = await generatePostImage({
        itemImageUrls: form.imageUrl ? [form.imageUrl] : [],
        stylePrompt: `appetizing hero shot of "${label}", premium cafe menu photography, clean composition`,
        venueName: '',
      })
      const f = new File([blob], `item-ai-${Date.now()}.png`, { type: blob.type || 'image/png' })
      const url = await uploadImage(tenantId, f)
      set('imageUrl', url)
      toast.success(lang === 'ar' ? 'وُلّدت الصورة — احفظ الصنف لتثبيتها' : 'Generated — save the item to keep it')
    } catch (e) {
      toast.error(e?.message || (lang === 'ar' ? 'تعذر التوليد' : 'Generation failed'))
    } finally { setAiImgBusy(false) }
  }

  // AI description writer for the Arabic description field.
  const [aiDescBusy, setAiDescBusy] = useState(false)
  const genItemDesc = async () => {
    if (aiDescBusy) return
    const label = form.nameAr || form.nameEn
    if (!label) { toast.error(lang === 'ar' ? 'اكتب اسم الصنف أولاً' : 'Name the item first'); return }
    setAiDescBusy(true)
    try {
      const { aiQuick } = await import('../../lib/aiBridge.js')
      const ing = (form.ingredients || []).map((x) => x.nameAr || x.nameEn).filter(Boolean).join('، ')
      // The venue's own vocabulary — a perfumery must not be told it is a cafe.
      const out = await aiQuick(
        `اكتب وصفاً جذاباً قصيراً (15-25 كلمة) لـ${lex(tnt, 'item')} اسمه "${label}"${ing ? ` مكوناته: ${ing}` : ''} في ${lex(tnt, 'menu')} الخاص بـ${venueType(tnt).ar}. بلا رموز تعبيرية وبلا مبالغة مبتذلة. أجب بالوصف فقط.`,
        { logAs: { tid: tenantId, kind: 'text', section: 'item-editor', itemId: form.id || '' } },
      )
      const clean = String(out || '').trim()
      if (!clean) throw new Error(lang === 'ar' ? 'لم يصل رد' : 'No response')
      set('descAr', clean)
      toast.success(lang === 'ar' ? 'كُتب الوصف — عدّله كما تحب' : 'Description written')
    } catch (e) {
      toast.error(e?.message || (lang === 'ar' ? 'تعذرت الكتابة' : 'Failed'))
    } finally { setAiDescBusy(false) }
  }

  // «قصة الطبق» writer — a short editorial piece, returned as strict JSON so
  // the four fields land in the right inputs (defensive parse, no fabrication
  // of sourcing claims: the model is told to stay generic unless we gave facts).
  const [dishStoryBusy, setDishStoryBusy] = useState(false)
  const genDishStory = async () => {
    if (dishStoryBusy) return
    const label = form.nameAr || form.nameEn
    if (!label) { toast.error(lang === 'ar' ? 'اكتب اسم الصنف أولاً' : 'Name the item first'); return }
    setDishStoryBusy(true)
    try {
      const { aiQuick } = await import('../../lib/aiBridge.js')
      const ing = (form.ingredients || []).map((x) => x.nameAr || x.nameEn).filter(Boolean).join('، ')
      const out = await aiQuick(
        `اكتب «قصة» قصيرة عن ${lex(tnt, 'item')} اسمه "${label}" في ${venueType(tnt).ar}${ing ? ` ومكوناته: ${ing}` : ''}${form.descAr ? ` ووصفه: ${form.descAr}` : ''}.`
        + ' أعد JSON فقط بالمفاتيح: title (عنوان جذاب 3-6 كلمات)، body (60-90 كلمة بأسلوب أدبي دافئ)، sourceLine (سطر واحد عن الطزاجة أو التحضير)، chefLine (جملة قصيرة على لسان صاحب المكان).'
        + ' لا تخترع ادعاءات محددة عن مصدر جغرافي أو جوائز أو شهادات. بلا رموز تعبيرية. JSON فقط بلا أي نص آخر.',
        { logAs: { tid: tenantId, kind: 'story', section: 'item-editor', itemId: form.id || '' } },
      )
      const raw = String(out || '')
      const m = raw.match(/\{[\s\S]*\}/)
      const j = m ? JSON.parse(m[0]) : null
      if (!j || !(j.title || j.body)) throw new Error(lang === 'ar' ? 'رد غير مفهوم — أعد المحاولة' : 'Unparseable response')
      set('story', {
        ...(form.story || {}),
        title: String(j.title || '').trim(),
        body: String(j.body || '').trim(),
        sourceLine: String(j.sourceLine || '').trim(),
        chefLine: String(j.chefLine || '').trim(),
      })
      toast.success(lang === 'ar' ? 'كُتبت القصة — راجعها وعدّلها' : 'Story written — review it')
    } catch (e) {
      toast.error(e?.message || (lang === 'ar' ? 'تعذرت الكتابة' : 'Failed'))
    } finally { setDishStoryBusy(false) }
  }

  // per-item backdrop VIDEO — size is guarded inside storage.js. A backdrop
  // IMAGE does not come through here: it rides the same pick → crop → upload
  // path the dish photo uses (onPick(e, 'bg')), so the owner frames it once
  // instead of discovering later that the interesting half is off-screen.
  const onBgPick = (kind) => async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const url = kind === 'video' ? await uploadFile(tenantId, file, 'itembg') : await uploadImage(tenantId, file)
      setForm((f) => ({ ...f, bgUrl: url, bgKind: kind }))
    } catch (err) {
      toast.error(err?.message || (lang === 'ar' ? 'تعذّر الرفع' : 'Upload failed'))
    } finally {
      setUploading(false)
    }
  }

  const addVariant = () => set('variants', [...(form.variants || []), { nameAr: '', nameEn: '', price: '' }])
  const setVariant = (i, k, v) => set('variants', form.variants.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)))
  const delVariant = (i) => set('variants', form.variants.filter((_, idx) => idx !== i))

  const addIng = () => set('ingredients', [...(form.ingredients || []), { nameAr: '', emoji: '' }])
  const setIng = (i, k, v) => set('ingredients', form.ingredients.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)))
  const delIng = (i) => set('ingredients', form.ingredients.filter((_, idx) => idx !== i))

  // ---- dish surface + garnish ------------------------------------------------
  // `surface` is the master switch: while it is empty the whole layer is off and
  // the dish renders exactly as it does today. Every updater re-reads the
  // garnish out of the CURRENT form inside the setter, so two quick taps can
  // never write a stale id list.
  const dpOn = !!form.surface
  const dpG = readGarnish(form.props)
  const dpEnable = (on) => setForm((f) => (on
    ? { ...f, surface: f.surface || 'auto', props: f.props == null ? { ids: [], density: 'normal' } : f.props }
    : { ...f, surface: '', props: null }))
  const dpSetSurface = (id) => setForm((f) => ({ ...f, surface: id }))
  const dpSetGarnish = (on) => setForm((f) => {
    const g = readGarnish(f.props)
    return { ...f, props: on ? { ids: g.ids, density: g.density } : 'none' }
  })
  const dpToggleProp = (id) => setForm((f) => {
    const g = readGarnish(f.props)
    const ids = g.ids.includes(id) ? g.ids.filter((x) => x !== id) : [...g.ids, id].slice(0, 8)
    return { ...f, props: { ids, density: g.density } }
  })
  const dpSetDensity = (d) => setForm((f) => {
    const g = readGarnish(f.props)
    return { ...f, props: { ids: g.ids, density: d } }
  })
  // Exactly what will be written to the document — so the preview below and the
  // saved item can never drift apart.
  const dpPropsValue = dpOn
    ? (dpG.on ? { ids: dpG.ids.filter((id) => PROPS.some((p) => p.id === id)).slice(0, 8), density: dpG.density } : 'none')
    : null
  const dpCatName = cats.find((c) => c.id === form.categoryId) ? pickLang(cats.find((c) => c.id === form.categoryId), 'name', lang) : ''
  const dpPreviewItem = {
    id: form.id || 'preview',
    nameAr: form.nameAr, nameEn: form.nameEn,
    ingredients: form.ingredients || [],
    surface: form.surface || '',
    props: dpPropsValue,
  }

  const save = async () => {
    if (!form.nameAr.trim() && !form.nameEn.trim()) {
      toast.error(lang === 'ar' ? 'أدخل اسم الصنف' : 'Enter item name')
      return
    }
    setBusy(true)
    try {
      const cleanLines = (lines) => (lines || []).filter((l) => l.materialId && Number(l.qty) > 0).map((l) => ({ materialId: l.materialId, qty: Number(l.qty) }))
      const recipe = cleanLines(form.recipe)
      const variantRecipes = {}
      Object.entries(form.variantRecipes || {}).forEach(([k, v]) => { const c = cleanLines(v); if (c.length) variantRecipes[k] = c })
      const hasRecipe = recipe.length > 0 || Object.keys(variantRecipes).length > 0
      const payload = {
        nameAr: form.nameAr.trim(),
        nameEn: form.nameEn.trim(),
        price: Math.max(0, Number(form.price) || 0),
        calories: Math.max(0, Number(form.calories) || 0),
        categoryId: form.categoryId || (cats[0]?.id ?? ''),
        prepTime: Math.max(0, Number(form.prepTime) || 0),
        serves: Math.max(0, Number(form.serves) || 0),
        rating: Math.max(0, Number(form.rating) || 0),
        reviewsCount: (form.reviewsCount || '').toString().trim(),
        ingredients: (form.ingredients || []).filter((x) => x.nameAr || x.nameEn).map((x) => ({ nameAr: x.nameAr || '', nameEn: x.nameEn || '', emoji: x.emoji || '' })),
        descAr: form.descAr || '',
        descEn: form.descEn || '',
        kdsWarning: (form.kdsWarning || '').trim(),
        imageUrl: form.imageUrl || '',
        images: (form.images || []).filter(Boolean),
        imageStyle: form.imageStyle || '',
        hotspots: (form.hotspots || [])
          .filter((h) => h && (h.label || '').trim())
          .slice(0, 8)
          .map((h) => ({
            x: Math.min(100, Math.max(0, Number(h.x) || 0)),
            y: Math.min(100, Math.max(0, Number(h.y) || 0)),
            label: (h.label || '').trim(),
            desc: (h.desc || '').trim(),
          })),
        // «قصة الطبق» — saved only when it actually has content, so the reader
        // entry point never appears on an empty story.
        story: (form.story && (form.story.title || form.story.body || '').trim())
          ? {
            title: (form.story.title || '').trim(),
            body: (form.story.body || '').trim(),
            sourceLine: (form.story.sourceLine || '').trim(),
            chefLine: (form.story.chefLine || '').trim(),
            imageUrl: form.story.imageUrl || '',
          }
          : null,
        arStandeeUrl: form.arStandeeUrl || '',
        model3dUrl: form.model3dUrl || '',
        model3dUsdzUrl: form.model3dUsdzUrl || '',
        pairings: (form.pairings || []).filter(Boolean).slice(0, 3),
        available: form.available !== false,
        availableFrom: (form.availableFrom || '').trim(),
        availableTo: (form.availableTo || '').trim(),
        countsForLoyalty: form.countsForLoyalty !== false,
        featured: !!form.featured,
        promoNotify: form.promoNotify || 'default',
        // a recipe item's availability comes from its materials, so it never also
        // tracks a finished-good count (prevents double deduction / false sold-out).
        trackStock: hasRecipe ? false : !!form.trackStock,
        recipe,
        variantRecipes,
        stockMode: hasRecipe ? 'recipe' : (form.trackStock ? 'simple' : 'none'),
        variants: (form.variants || [])
          .filter((v) => v.nameAr || v.nameEn)
          .map((v, idx) => ({ key: `v${idx}`, nameAr: v.nameAr, nameEn: v.nameEn, price: Math.max(0, Number(v.price) || 0) })),
        modifierGroups: (form.modifierGroups || [])
          .filter((g) => (g.nameAr || g.nameEn) && (g.options || []).some((o) => o.nameAr || o.nameEn))
          .map((g) => ({
            nameAr: g.nameAr || '', nameEn: g.nameEn || '',
            min: Math.max(0, Number(g.min) || 0), max: Math.max(0, Number(g.max) || 0), required: !!g.required,
            options: (g.options || []).filter((o) => o.nameAr || o.nameEn).map((o) => ({ nameAr: o.nameAr || '', nameEn: o.nameEn || '', price: Math.max(0, Number(o.price) || 0), recipe: cleanLines(o.recipe) })),
          })),
        sortOrder: form.sortOrder || 0,
        namePriceLayout: form.namePriceLayout || '',
        nameColor: form.nameColor || '',
        priceColor: form.priceColor || '',
        namePriceStyle: form.namePriceStyle || '',
        // «تركيب الصنف» — backdrop, photo, shadow, effect, entrance. Clamped to
        // the same bounds resolveComposition() clamps to, and emitted only for
        // the fields this item actually uses (see composePayload).
        ...composePayload(form, origRef.current),
        // dish styling layer, in the exact shape lib/dishProps.js reads back.
        // Never `undefined` on either key — Firestore rejects that outright.
        surface: form.surface || '',
        props: dpPropsValue,
      }
      await saveItem(tenantId, form.id, payload)
      onSaved()
    } catch (_) {
      toast.error(t('error'))
      setBusy(false)
    }
  }

  // Apply this item's menu image-style to every item (batch partial update).
  const applyImageStyleToAll = async () => {
    if (!window.confirm(lang === 'ar' ? 'تطبيق أسلوب عرض الصورة هذا على كل الأصناف؟' : 'Apply this image style to ALL items?')) return
    try {
      await Promise.all((items || []).map((it) => saveItem(tenantId, it.id, { imageStyle: form.imageStyle || '' })))
      toast.success(lang === 'ar' ? 'طُبّق على كل الأصناف' : 'Applied to all items')
    } catch (_) { toast.error(t('error')) }
  }

  // Apply this item's custom text styling, colors, and layout to all items.
  const applyStylingToAll = async () => {
    if (!window.confirm(lang === 'ar' ? 'تطبيق هذا المظهر والألوان والموضع على كل الأصناف؟' : 'Apply this layout, colors, and styling to ALL items?')) return
    try {
      await Promise.all((items || []).map((it) => saveItem(tenantId, it.id, {
        namePriceLayout: form.namePriceLayout || '',
        nameColor: form.nameColor || '',
        priceColor: form.priceColor || '',
        namePriceStyle: form.namePriceStyle || '',
      })))
      toast.success(lang === 'ar' ? 'طُبّق التنسيق على كل الأصناف' : 'Applied styling to all items')
    } catch (_) { toast.error(t('error')) }
  }

  // Delete is two-step: the trash button reveals a choice between archiving
  // (hidden from menus, keeps its reports/history) and a true permanent delete.
  const [delOpen, setDelOpen] = useState(false)
  const archive = async () => {
    setBusy(true)
    try {
      await saveItem(tenantId, form.id, { archived: true, available: false })
      toast.success(lang === 'ar' ? 'تمت أرشفة الصنف' : 'Item archived')
      onClose()
    } catch (_) {
      toast.error(t('error'))
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!window.confirm(t('areYouSure'))) return
    setBusy(true)
    await deleteItem(tenantId, form.id)
    onDeleted()
  }

  return (
    <Sheet
      open onClose={onClose}
      title={isNew ? t('addItem') : t('editItem')}
      footer={
        delOpen && !isNew ? (
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            <button className="btn btn-outline" onClick={archive} disabled={busy}>
              <Icon name="package" size={16} /> {lang === 'ar' ? 'أرشفة (يُخفى ويحتفظ بتقاريره)' : 'Archive (hidden, keeps its reports)'}
            </button>
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              <button className="btn btn-danger grow" onClick={remove} disabled={busy}>
                <Icon name="delete" size={16} /> {lang === 'ar' ? 'حذف نهائي' : 'Delete permanently'}
              </button>
              <button className="btn btn-outline" onClick={() => setDelOpen(false)} disabled={busy}>{t('cancel')}</button>
            </div>
          </div>
        ) : (
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            {!isNew && <button className="btn btn-danger" onClick={() => setDelOpen(true)} disabled={busy}><Icon name="delete" size={18} /></button>}
            <button className="btn btn-primary grow" onClick={save} disabled={busy || uploading}>{busy ? t('saving') : t('save')}</button>
          </div>
        )
      }
    >
      <div className="stack">
        {cropState && (
          <ImageCropper file={cropState.file} imageSrc={cropState.src}
            title={cropState.src ? (lang === 'ar' ? 'تعديل صورة الصنف' : 'Edit item image') : (lang === 'ar' ? 'قص صورة الصنف' : 'Crop item image')}
            hint={lang === 'ar' ? 'اختر الشكل المناسب لثيمك، ثم حرّك وكبّر لضبط الصورة' : 'Pick the shape your theme needs, then move and zoom to fit'}
            onClose={() => setCropState(null)} onCropped={onCropped} />
        )}
        <EditorTabs lang={lang} />
        <EditorSection first id="ie-basics" title={lang === 'ar' ? 'الأساسي' : 'Basics'} />
        <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
          <div className="stack" style={{ flex: 'none', gap: 4, alignItems: 'stretch', width: 88 }}>
            <label style={{ cursor: 'pointer' }}>
              <div className={`thumb center ${(bgBusy || aiImgBusy) ? 'ai-scanning' : ''}`} style={{ width: 88, height: 88, overflow: 'hidden', border: '1px dashed var(--border-strong)' }}>
                {uploading ? <div className="spinner" /> : form.imageUrl ? <img src={form.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="camera" size={24} className="muted" />}
              </div>
              <input type="file" accept="image/*" hidden onChange={(e) => onPick(e, 'primary')} />
              <span className="xs faint text-center" style={{ display: 'block', marginTop: 4 }}>{uploading ? t('uploading') : t('uploadImage')}</span>
            </label>
            {form.imageUrl && !uploading && (
              <button type="button" className="btn btn-sm btn-outline" style={{ padding: '4px 6px' }} onClick={() => setCropState({ src: form.imageUrl, target: 'primary' })}>
                <Icon name="search" size={13} /> {lang === 'ar' ? 'تعديل الحجم' : 'Adjust'}
              </button>
            )}
            {form.imageUrl && !uploading && (
              <button type="button" className="btn btn-sm btn-outline" style={{ padding: '4px 6px' }} disabled={bgBusy} onClick={stripBg}>
                <Icon name="sparkles" size={13} /> {bgBusy ? (lang === 'ar' ? 'يعالج…' : 'Working…') : (lang === 'ar' ? 'إزالة الخلفية' : 'Remove bg')}
              </button>
            )}
            {!uploading && (
              <button type="button" className="btn btn-sm btn-outline" style={{ padding: '4px 6px' }} disabled={aiImgBusy} onClick={genItemImage}
                title={lang === 'ar' ? 'يولّد صورة احترافية بالذكاء (صورة الصنف الحالية مرجع إن وُجدت)' : 'AI-generate a pro product photo'}>
                <Icon name="image" size={13} /> {aiImgBusy ? (lang === 'ar' ? 'يولّد…' : 'Generating…') : (lang === 'ar' ? 'توليد بالذكاء' : 'AI photo')}
              </button>
            )}
            {form.imageUrl && !uploading && (
              <button type="button" className="btn btn-sm btn-outline" style={{ padding: '4px 6px' }} disabled={storyBusy}
                title={lang === 'ar' ? 'ينشر صورة الصنف كستوري 24 ساعة فوراً' : 'Publish this photo as a 24h story'}
                onClick={async () => {
                  setStoryBusy(true)
                  try {
                    await publishUrlAsStory(tenantId, { url: form.imageUrl, caption: form.nameAr || form.nameEn || '' })
                    toast.success(lang === 'ar' ? 'نُشر في الاستوري' : 'Published to stories')
                  } catch (_) { toast.error(t('error')) } finally { setStoryBusy(false) }
                }}>
                <Icon name="camera" size={13} /> {storyBusy ? (lang === 'ar' ? 'ينشر…' : 'Posting…') : (lang === 'ar' ? 'نشر في الاستوري' : 'To story')}
              </button>
            )}
          </div>
          <div className="stack grow" style={{ gap: 'var(--sp-2)' }}>
            <div className="field">
              <label>{t('itemName')}</label>
              <input className="input" value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} />
            </div>
            <div className="field">
              <label>{t('itemNameEn')} <span className="faint">({t('optional')})</span></label>
              <input className="input" dir="ltr" value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} />
            </div>
          </div>
        </div>

        <EditorSection id="ie-images" title={lang === 'ar' ? 'الصور' : 'Images'} />
        {/* additional images — swiped in the item screen */}
        <div className="field">
          <label>{lang === 'ar' ? 'صور إضافية (يمكن التمرير بينها في الصنف)' : 'Extra images (swiped in the item screen)'}</label>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {(form.images || []).map((src, i) => (
              <div key={i} style={{ position: 'relative', width: 56, height: 56 }}>
                <img src={src} alt="" style={{ width: '100%', height: '100%', borderRadius: 'var(--r-md)', objectFit: 'cover' }} />
                <button className="icon-btn" onClick={() => removeImage(i)} style={{ position: 'absolute', top: -8, insetInlineEnd: -8, width: 22, height: 22, background: 'var(--danger)', color: '#fff', borderRadius: '50%' }}><Icon name="close" size={13} /></button>
              </div>
            ))}
            <label className="center" style={{ width: 56, height: 56, borderRadius: 'var(--r-md)', border: '1px dashed var(--border-strong)', cursor: 'pointer', flex: 'none' }}>
              <Icon name="add" size={20} className="muted" />
              <input type="file" accept="image/*" hidden onChange={(e) => onPick(e, 'extra')} />
            </label>
          </div>
        </div>

        {/* product image style in the menu (transparent float vs framed circle) + apply to all */}
        <div className="field">
          <label>{lang === 'ar' ? 'أسلوب عرض الصورة في المنيو' : 'Image style on the menu'}</label>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <select className="select grow" value={form.imageStyle || ''} onChange={(e) => set('imageStyle', e.target.value)}>
              <option value="">{lang === 'ar' ? 'تلقائي (حسب الثيم)' : 'Auto (theme)'}</option>
              <option value="circle">{lang === 'ar' ? 'شكل دائري كلاسيكي بإطار' : 'Classic Circle with Border'}</option>
              <option value="square">{lang === 'ar' ? 'شكل مربع بحواف مستديرة' : 'Soft Rounded Square'}</option>
              <option value="float">{lang === 'ar' ? 'طافية ومجسمة بدون إطار (PNG)' : 'Frameless Float PNG'}</option>
              <option value="hexagon">{lang === 'ar' ? 'شكل هندسي سداسي' : 'Elegant Hexagonal Polygon'}</option>
              <option value="heart">{lang === 'ar' ? 'شكل قلبي رومانسي' : 'Heart Shape'}</option>
              <option value="hidden">{lang === 'ar' ? 'مخفية بالكامل (نصي فقط)' : 'Hidden (Text Only)'}</option>
            </select>
            <button type="button" className="btn btn-sm btn-outline" style={{ whiteSpace: 'nowrap' }} onClick={applyImageStyleToAll}>{lang === 'ar' ? 'تطبيق على الكل' : 'Apply to all'}</button>
          </div>
          <p className="xs faint">{lang === 'ar' ? 'الشفاف العائم: تظهر الصورة بلا إطار بظلّ ناعم — مثالي لصور PNG بدون خلفية في ثيم المتجر.' : 'Transparent float: frameless image with a soft shadow — ideal for background-free PNGs in the storefront theme.'}</p>
        </div>

        {/* «نقاط تفاعلية على الصورة» — tappable ingredient/sauce pins inside the dish photo */}
        <div className="field">
          <label>
            {lang === 'ar' ? 'نقاط تفاعلية على الصورة' : 'Interactive photo hotspots'}{' '}
            <span className="faint xs num">({(form.hotspots || []).length}/8)</span>
          </label>
          <HotspotsEditor lang={lang} imageUrl={form.imageUrl} hotspots={form.hotspots || []} onChange={(v) => set('hotspots', v)} />
          <p className="xs faint">{lang === 'ar' ? 'يضغط العميل على النقطة داخل صورة الطبق ليقرأ ما هي — نوع الجبن، الصوص، الإضافة المميزة.' : 'Customers tap a dot inside the dish photo to read what that part of the plate is.'}</p>
        </div>

        {/* «قصة الطبق» — an editorial story the guest can read from the item sheet */}
        <details className="card card-pad" style={{ marginBottom: 'var(--sp-3)' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 'var(--fs-sm)' }}>
            <Icon name="notepad" size={13} style={{ verticalAlign: 'middle' }} /> {lang === 'ar' ? 'قصة الطبق (اختياري)' : 'Dish story (optional)'}
            {form.story?.title ? <span className="badge badge-success" style={{ marginInlineStart: 8 }}><Icon name="check" size={10} /></span> : null}
          </summary>
          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            <p className="xs faint" style={{ margin: 0 }}>{lang === 'ar' ? 'حكاية قصيرة تُميّز الطبق: من أين يأتي السمك، كيف يُشوى، لمسة الشيف. تظهر للعميل كزر «اقرأ قصة الطبق» داخل تفاصيل الصنف.' : 'A short editorial story shown to guests from the item sheet.'}</p>
            <div className="field">
              <label>{lang === 'ar' ? 'العنوان' : 'Title'}</label>
              <input className="input" value={form.story?.title || ''} placeholder={lang === 'ar' ? 'مثال: من سواحل جازان إلى الصاج' : 'e.g. From the coast to the grill'}
                onChange={(e) => set('story', { ...(form.story || {}), title: e.target.value })} />
            </div>
            <div className="field">
              <label>{lang === 'ar' ? 'النص' : 'Body'}</label>
              <textarea className="input" rows={4} value={form.story?.body || ''}
                onChange={(e) => set('story', { ...(form.story || {}), body: e.target.value })} />
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="field grow" style={{ minWidth: 180 }}>
                <label>{lang === 'ar' ? 'سطر المصدر' : 'Source line'}</label>
                <input className="input input-sm" value={form.story?.sourceLine || ''} placeholder={lang === 'ar' ? 'سمك طازج يومياً' : 'Fresh daily'}
                  onChange={(e) => set('story', { ...(form.story || {}), sourceLine: e.target.value })} />
              </div>
              <div className="field grow" style={{ minWidth: 180 }}>
                <label>{lang === 'ar' ? 'من الشيف' : 'From the chef'}</label>
                <input className="input input-sm" value={form.story?.chefLine || ''}
                  onChange={(e) => set('story', { ...(form.story || {}), chefLine: e.target.value })} />
              </div>
            </div>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm btn-outline" disabled={dishStoryBusy || !(form.nameAr || form.nameEn)} onClick={genDishStory}>
                <Icon name="sparkles" size={13} /> {dishStoryBusy ? (lang === 'ar' ? 'يكتب…' : 'Writing…') : (lang === 'ar' ? 'اكتب القصة بالذكاء' : 'AI write')}
              </button>
              {form.story?.title && (
                <button type="button" className="btn-link xs" style={{ color: 'var(--danger)' }} onClick={() => set('story', null)}>{lang === 'ar' ? 'حذف القصة' : 'Clear story'}</button>
              )}
            </div>
          </div>
        </details>

        {/* Custom styling options for individual items (name & price position, colors, effects) */}
        <div className="card card-pad stack" style={{ gap: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 'var(--sp-3)' }}>
          <div className="row-between">
            <strong className="xs"><Icon name="penLine" size={13} style={{ verticalAlign: 'middle' }} /> {lang === 'ar' ? 'تخصيص موضع وتصميم الاسم والسعر' : 'Name & Price Styling'}</strong>
            <button type="button" className="btn btn-xs btn-outline" onClick={applyStylingToAll}>{lang === 'ar' ? 'تطبيق على الكل' : 'Apply to all'}</button>
          </div>

          <div className="field">
            <label>{lang === 'ar' ? 'موضع ومحاذاة الاسم والسعر' : 'Position & Alignment'}</label>
            <select className="select" value={form.namePriceLayout || ''} onChange={(e) => set('namePriceLayout', e.target.value)}>
              <option value="">{lang === 'ar' ? 'الافتراضي (حسب المنيو)' : 'Default (Theme)'}</option>
              <option value="right">{lang === 'ar' ? 'محاذاة لليمين' : 'Right-aligned'}</option>
              <option value="center">{lang === 'ar' ? 'محاذاة للوسط' : 'Centered'}</option>
              <option value="left">{lang === 'ar' ? 'محاذاة لليسار' : 'Left-aligned'}</option>
              <option value="stack">{lang === 'ar' ? 'الاسم فوق والسعر تحت' : 'Name Top, Price Bottom'}</option>
              <option value="reverse">{lang === 'ar' ? 'السعر فوق والاسم تحت' : 'Price Top, Name Bottom'}</option>
            </select>
          </div>

          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <div className="field grow" style={{ minWidth: '120px' }}>
              <label>{lang === 'ar' ? 'لون الاسم' : 'Name Color'}</label>
              <div className="row" style={{ gap: 6 }}>
                <input type="color" className="input" style={{ width: 40, padding: 2, height: 38, cursor: 'pointer', flex: 'none' }} value={form.nameColor || '#000000'} onChange={(e) => set('nameColor', e.target.value)} />
                <input className="input grow" style={{ minWidth: 0 }} value={form.nameColor || ''} placeholder="#000000" onChange={(e) => set('nameColor', e.target.value)} />
              </div>
              {form.nameColor && <ContrastHint color={form.nameColor} ar={lang === 'ar'} />}
            </div>
            <div className="field grow" style={{ minWidth: '120px' }}>
              <label>{lang === 'ar' ? 'لون السعر' : 'Price Color'}</label>
              <div className="row" style={{ gap: 6 }}>
                <input type="color" className="input" style={{ width: 40, padding: 2, height: 38, cursor: 'pointer', flex: 'none' }} value={form.priceColor || '#000000'} onChange={(e) => set('priceColor', e.target.value)} />
                <input className="input grow" style={{ minWidth: 0 }} value={form.priceColor || ''} placeholder="#000000" onChange={(e) => set('priceColor', e.target.value)} />
              </div>
              {form.priceColor && <ContrastHint color={form.priceColor} ar={lang === 'ar'} />}
            </div>
          </div>

          <div className="field">
            <label>{lang === 'ar' ? 'تأثيرات وتنسيق الخط' : 'Style & Effects'}</label>
            <select className="select" value={form.namePriceStyle || ''} onChange={(e) => set('namePriceStyle', e.target.value)}>
              <option value="">{lang === 'ar' ? 'بدون تأثير' : 'None (Default)'}</option>
              <option value="bold">{lang === 'ar' ? 'خط عريض (Bold)' : 'Bold Text'}</option>
              <option value="glow">{lang === 'ar' ? 'تأثير التوهج المضيء' : 'Neon Glow'}</option>
              <option value="shadow">{lang === 'ar' ? 'ظلال بارزة ثلاثية الأبعاد' : '3D Drop Shadow'}</option>
              <option value="serif">{lang === 'ar' ? 'خط كلاسيكي عتيق (Serif)' : 'Classic Serif Font'}</option>
            </select>
          </div>
        </div>

        <EditorSection id="ie-compose" title={lang === 'ar' ? 'تركيب الصنف' : 'Dish composition'} />
        <CompositionEditor
          form={form} setForm={setForm} lang={lang} currency={currency} uploading={uploading}
          onPickBgImage={(e) => onPick(e, 'bg')}
          onEditBgImage={() => setCropState({ src: form.bgUrl, target: 'bg' })}
          onPickBgVideo={onBgPick('video')}
        />

        <EditorSection id="ie-dish" title={lang === 'ar' ? 'السطح والزينة حول الطبق' : 'Dish surface & garnish'} />
        <div className="card card-pad stack" style={{ gap: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 'var(--sp-3)' }}>
          <label className="row-between" style={{ cursor: 'pointer', gap: 10, alignItems: 'flex-start' }}>
            <span className="stack" style={{ gap: 2 }}>
              <strong className="xs"><Icon name="sparkles" size={13} style={{ verticalAlign: 'middle' }} /> {lang === 'ar' ? 'ضع الطبق على سطح وزيّنه' : 'Stand this dish on a surface'}</strong>
              <span className="xs faint">{lang === 'ar' ? 'يظهر في ثيم «المجلة الداكنة»: سطح تحت صورة الطبق وزينة متناثرة حولها. مغلق في كل الأصناف حتى تفعّله هنا.' : 'Shows in the Dark Editorial theme: a material under the cutout plus a scatter of garnish. Off on every item until switched on here.'}</span>
            </span>
            <input type="checkbox" checked={dpOn} onChange={(e) => dpEnable(e.target.checked)} style={{ width: 22, height: 22, flex: 'none' }} />
          </label>

          {dpOn && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>{lang === 'ar' ? 'السطح تحت الطبق' : 'Surface under the dish'}</label>
                <div className="dpx-surfaces">
                  {SURFACE_CHOICES.map((s) => (
                    <button key={s.id} type="button" className="dpx-surface" data-on={form.surface === s.id ? 'true' : 'false'}
                      aria-pressed={form.surface === s.id} onClick={() => dpSetSurface(s.id)}>
                      <span className="dpx-chip" data-s={s.id} />
                      <span className="dpx-surface-name">{lang === 'ar' ? s.labelAr : s.labelEn}</span>
                    </button>
                  ))}
                </div>
              </div>

              <label className="row-between" style={{ cursor: 'pointer' }}>
                <span className="xs bold">{lang === 'ar' ? 'زينة متناثرة حول الطبق' : 'Garnish scattered around the dish'}</span>
                <input type="checkbox" checked={dpG.on} onChange={(e) => dpSetGarnish(e.target.checked)} style={{ width: 22, height: 22, flex: 'none' }} />
              </label>

              {dpG.on && (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>{lang === 'ar' ? 'كثافة الزينة' : 'Garnish density'}</label>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {DENSITY_CHOICES.map(([id, la, le]) => (
                        <button key={id} type="button" className={`chip ${dpG.density === id ? 'active' : ''}`} onClick={() => dpSetDensity(id)}>{lang === 'ar' ? la : le}</button>
                      ))}
                    </div>
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>
                      {lang === 'ar' ? 'عناصر الزينة' : 'Garnish elements'}{' '}
                      <span className="faint xs num">({dpG.ids.length}/8)</span>
                    </label>
                    <p className="xs faint" style={{ margin: '0 0 6px' }}>{lang === 'ar' ? 'اترك الاختيار فارغاً ليختار النظام ما يناسب اسم الصنف تلقائياً، أو حدّد ما تريده بنفسك.' : 'Leave the choice empty and the system picks from the dish name, or select your own.'}</p>
                    <div className="dpx-groups">
                      {PROP_CATEGORIES.map((c) => {
                        const list = PROPS.filter((p) => p.category === c.id)
                        if (!list.length) return null
                        return (
                          <div key={c.id} className="dpx-group">
                            <span className="dpx-group-label">{lang === 'ar' ? c.labelAr : c.labelEn}</span>
                            {list.map((p) => (
                              <button key={p.id} type="button" className={`chip ${dpG.ids.includes(p.id) ? 'active' : ''}`}
                                aria-pressed={dpG.ids.includes(p.id)} onClick={() => dpToggleProp(p.id)}>
                                {lang === 'ar' ? p.labelAr : p.labelEn}
                              </button>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="field" style={{ marginBottom: 0 }}>
                <label>{lang === 'ar' ? 'معاينة حية — كما سيراها العميل' : 'Live preview — what the guest sees'}</label>
                <div className="dpx-stage">
                  <DishProps item={dpPreviewItem} active variant="stage" catName={dpCatName} />
                  {form.imageUrl
                    ? <img src={form.imageUrl} alt="" />
                    : <span className="dpx-noimg">{lang === 'ar' ? 'ارفع صورة الصنف لترى المعاينة كاملة — الأفضل صورة بخلفية شفافة' : 'Upload the item photo for the full preview (a transparent cutout works best)'}</span>}
                </div>
                <p className="xs faint">{lang === 'ar' ? 'الزينة زخرفية فقط: لا تُعرض كمكوّنات ولا تُطبع في الطلب.' : 'Garnish is decoration only: never presented as an ingredient, never printed on the order.'}</p>
              </div>
            </div>
          )}
        </div>

        <EditorSection id="ie-pricing" title={lang === 'ar' ? 'التسعير والمقاسات' : 'Pricing & sizes'} />
        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <div className="field grow">
            <label className="row" style={{ gap: 5 }}>{t('price')} ({currency}){!canPrice && <Icon name="lock" size={12} className="faint" />}</label>
            <input className="input num" type="number" inputMode="decimal" value={form.price} disabled={!canPrice} onChange={(e) => set('price', e.target.value)} />
            {!canPrice && <span className="xs faint">{lang === 'ar' ? 'تعديل الأسعار يتطلب صلاحية من الإدارة' : 'Price editing requires a management permission'}</span>}
          </div>
          <div className="field grow">
            <label>{t('calories')}</label>
            <input className="input num" type="number" inputMode="numeric" value={form.calories} onChange={(e) => set('calories', e.target.value)} />
          </div>
        </div>

        {/* Time window: the item shows in the menu only between these hours (e.g.
            a breakfast dish 06:00–11:30). Both empty = always available. */}
        <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ width: 130, marginBottom: 0 }}>
            <label>{lang === 'ar' ? 'يظهر من الساعة' : 'Visible from'}</label>
            <input className="input" type="time" value={form.availableFrom || ''} onChange={(e) => set('availableFrom', e.target.value)} />
          </div>
          <div className="field" style={{ width: 130, marginBottom: 0 }}>
            <label>{lang === 'ar' ? 'حتى الساعة' : 'Until'}</label>
            <input className="input" type="time" value={form.availableTo || ''} onChange={(e) => set('availableTo', e.target.value)} />
          </div>
          <span className="xs faint" style={{ paddingBottom: 8 }}>{lang === 'ar' ? 'اتركهما فارغين ليظهر دائماً — مثال: فطور 06:00 حتى 11:30 يختفي تلقائياً بعدها.' : 'Leave empty for always — e.g. breakfast 06:00-11:30 auto-hides after.'}</span>
        </div>

        {/* AR — عرض الصنف على طاولة العميل */}
        <EditorSection id="ie-ar" title={lang === 'ar' ? 'الواقع المعزز AR' : 'Augmented reality'} />
        <div className="stack" style={{ gap: 8 }}>
          <p className="xs faint" style={{ margin: 0 }}>
            {lang === 'ar'
              ? 'زر «اعرضه على طاولتك» في المنيو يفتح الكاميرا ويضع الصنف على الطاولة فعلياً (أندرويد وآيفون بلا تطبيق). «مجسم من الصورة» يبني ستاند واقعي من صورة الصنف مقصوصة الخلفية تلقائياً، ولنموذج ثلاثي الأبعاد كامل ارفع ملف .glb أو .usdz جاهزاً.'
              : 'The menu AR button places the item on the real table (Android/iOS, no app). Generate a standee from the photo, or upload a full .glb/.usdz model.'}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn btn-sm btn-outline" disabled={!!arBusy} onClick={genArStandee}>
              <Icon name="sparkles" size={13} /> {arBusy === 'bg' ? (lang === 'ar' ? 'يقصّ الخلفية…' : 'Cutting bg…') : arBusy === 'glb' ? (lang === 'ar' ? 'يبني المجسم…' : 'Building…') : (lang === 'ar' ? 'مجسم من الصورة' : 'Standee from photo')}
            </button>
            <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
              <Icon name="upload" size={13} /> {arBusy === 'upload' ? (lang === 'ar' ? 'يرفع…' : 'Uploading…') : (lang === 'ar' ? 'رفع نموذج GLB/USDZ' : 'Upload GLB/USDZ')}
              <input type="file" accept=".glb,.usdz" hidden onChange={onPickModel} disabled={!!arBusy} />
            </label>
            {can3d ? (
              <button type="button" className="btn btn-sm btn-primary" disabled={real3dSec >= 0 || !!arBusy} onClick={genReal3d}
                title={lang === 'ar' ? 'يحوّل صورة الصنف إلى مجسم ثلاثي الأبعاد واقعي كامل بالذكاء (1-8 دقائق)' : 'AI-convert the photo to a full realistic 3D mesh'}>
                <Icon name="sparkles" size={13} /> {real3dSec >= 0 ? (lang === 'ar' ? `يحوّل واقعياً… ${real3dSec} ث` : `Converting… ${real3dSec}s`) : (lang === 'ar' ? 'تحويل واقعي 3D' : 'Realistic 3D')}
              </button>
            ) : (
              <span className="badge badge-gold" title={lang === 'ar' ? 'التحويل الواقعي الكامل ميزة الباقة المتكاملة' : 'Realistic conversion is an Enterprise perk'}>
                <Icon name="lock" size={11} /> {lang === 'ar' ? 'تحويل واقعي 3D — الباقة المتكاملة' : 'Realistic 3D — Enterprise'}
              </span>
            )}
            {form.arStandeeUrl && <span className="badge badge-success"><Icon name="check" size={11} /> {lang === 'ar' ? 'مجسم الصورة جاهز' : 'Standee ready'}</span>}
            {form.model3dUrl && <span className="badge badge-success"><Icon name="check" size={11} /> {lang === 'ar' ? 'نموذج 3D مرفوع' : '3D model set'}</span>}
            {(form.arStandeeUrl || form.model3dUrl) && form.id && onOpenStudio && (
              <button type="button" className="btn btn-sm btn-outline" style={{ color: 'var(--brand)' }} onClick={() => onOpenStudio({ ...form })}>
                <Icon name="layers" size={13} /> {lang === 'ar' ? 'عرض المجسم في الاستوديو' : 'Open 3D studio'}
              </button>
            )}
            {(form.arStandeeUrl || form.model3dUrl) && (
              <button type="button" className="btn-link xs" style={{ color: 'var(--danger)' }} onClick={() => { set('arStandeeUrl', ''); set('model3dUrl', ''); set('model3dUsdzUrl', '') }}>{lang === 'ar' ? 'إزالة' : 'Clear'}</button>
            )}
          </div>
        </div>

        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <div className="field grow">
            <label>{t('prepTime')}</label>
            <input className="input num" type="number" inputMode="numeric" value={form.prepTime} onChange={(e) => set('prepTime', e.target.value)} />
          </div>
          <div className="field grow">
            <label>{t('serves')} ({t('persons')})</label>
            <input className="input num" type="number" inputMode="numeric" value={form.serves} onChange={(e) => set('serves', e.target.value)} />
          </div>
        </div>

        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <div className="field grow">
            <label>{t('ratingLabel')} (0-5)</label>
            <input className="input num" type="number" step="0.1" max="5" inputMode="decimal" value={form.rating} onChange={(e) => set('rating', e.target.value)} />
          </div>
          <div className="field grow">
            <label>{t('reviewsCount')}</label>
            <input className="input" value={form.reviewsCount} onChange={(e) => set('reviewsCount', e.target.value)} placeholder="1k+" />
          </div>
        </div>

        <div className="field">
          <label>{t('category')}</label>
          <select className="select" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">{t('none')}</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{pickLang(c, 'name', lang)}</option>)}
          </select>
        </div>

        {(items || []).some((it) => it.id !== form.id) && (
          <div className="field">
            <label>{lang === 'ar' ? 'يُطلب عادةً معه (ثيم واجهة العرض)' : 'Frequently paired with (Spotlight)'} <span className="faint">({lang === 'ar' ? 'حتى 3' : 'up to 3'})</span></label>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {(items || []).filter((it) => it.id !== form.id).map((it) => {
                const on = (form.pairings || []).includes(it.id)
                const full = (form.pairings || []).length >= 3
                return (
                  <button type="button" key={it.id} disabled={!on && full}
                    className={`btn btn-sm ${on ? 'btn-primary' : 'btn-outline'}`}
                    style={{ gap: 6, paddingInline: 8, opacity: !on && full ? 0.4 : 1 }}
                    onClick={() => set('pairings', on ? (form.pairings || []).filter((x) => x !== it.id) : [...(form.pairings || []), it.id])}>
                    {it.imageUrl
                      ? <img src={it.imageUrl} alt="" style={{ width: 20, height: 20, borderRadius: 6, objectFit: 'cover', flex: 'none' }} />
                      : <Icon name="image" size={14} />}
                    {pickLang(it, 'name', lang)}
                    {on && <Icon name="check" size={13} />}
                  </button>
                )
              })}
            </div>
            <span className="xs faint">{lang === 'ar' ? 'تظهر كاقتراحات «أضِف أيضاً» أسفل المنتج. اتركها فارغة ليقترح النظام تلقائياً.' : 'Shown as “add also” chips under the product. Leave empty for automatic pairing.'}</span>
          </div>
        )}

        <div className="field">
          <div className="row-between">
            <label>{t('description')} (عربي) <span className="faint">({t('optional')})</span></label>
            <button type="button" className="btn btn-sm btn-ghost" disabled={aiDescBusy} onClick={genItemDesc} style={{ padding: '2px 8px' }}>
              <Icon name="sparkles" size={13} /> {aiDescBusy ? (lang === 'ar' ? 'يكتب…' : 'Writing…') : (lang === 'ar' ? 'اكتبه بالذكاء' : 'AI write')}
            </button>
          </div>
          <textarea className="textarea" value={form.descAr} onChange={(e) => set('descAr', e.target.value)} />
        </div>
        <div className="field">
          <label>{t('description')} (English) <span className="faint">({t('optional')})</span></label>
          <textarea className="textarea" dir="ltr" value={form.descEn} onChange={(e) => set('descEn', e.target.value)} />
        </div>

        <div className="field">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="warning" size={13} style={{ color: 'var(--danger)' }} /> {lang === 'ar' ? 'تحذير للمطبخ (حساسية / مكوّن خطر)' : 'Kitchen warning (allergy)'} <span className="faint">({t('optional')})</span></label>
          <input className="input" placeholder={lang === 'ar' ? 'مثال: يحتوي مكسرات · يحتوي جلوتين' : 'e.g. contains nuts'} value={form.kdsWarning || ''} onChange={(e) => set('kdsWarning', e.target.value)} />
        </div>

        <div className="row" style={{ gap: 'var(--sp-4)' }}>
          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.available !== false} onChange={(e) => set('available', e.target.checked)} style={{ width: 20, height: 20 }} />
            <span className="small">{t('available')}</span>
          </label>
          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.countsForLoyalty !== false} onChange={(e) => set('countsForLoyalty', e.target.checked)} style={{ width: 20, height: 20 }} />
            <span className="small">{t('countsForLoyalty')}</span>
          </label>
          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.featured} onChange={(e) => set('featured', e.target.checked)} style={{ width: 20, height: 20 }} />
            <span className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="star" size={14} style={{ color: 'var(--gold)' }} /> {lang === 'ar' ? 'يظهر في المميّزة' : 'Featured on menu'}</span>
          </label>
          {/* promo tag: who gets an automatic WhatsApp when this item is starred/added */}
          <div className="field" style={{ width: '100%' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="bellRing" size={13} /> {lang === 'ar' ? 'الوسم الترويجي — من يُبلَّغ بهذا الصنف تلقائياً؟' : 'Promo tag — who gets auto-notified about this item?'}</label>
            <select className="select" value={form.promoNotify || 'default'} onChange={(e) => set('promoNotify', e.target.value)}>
              <option value="default">{lang === 'ar' ? 'حسب إعدادات الأتمتة العامة' : 'Follow global automation settings'}</option>
              <option value="members">{lang === 'ar' ? 'الأعضاء فقط' : 'Members only'}</option>
              <option value="all">{lang === 'ar' ? 'كل العملاء' : 'Everyone'}</option>
              <option value="off">{lang === 'ar' ? 'بدون إشعار' : 'No notification'}</option>
            </select>
            <span className="xs faint">{lang === 'ar' ? 'يُرسل واتساب تلقائياً عند تمييز الصنف بالنجمة أو إضافته — الإعدادات العامة في صفحة «الإعلانات والحملات».' : 'Auto WhatsApp on starring/adding this item — global defaults live in Campaigns.'}</span>
          </div>
          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.trackStock} onChange={(e) => set('trackStock', e.target.checked)} style={{ width: 20, height: 20 }} />
            <span className="small">{lang === 'ar' ? 'تتبّع المخزون' : 'Track stock'}</span>
          </label>
          {form.trackStock && <p className="xs faint" style={{ width: '100%' }}>{lang === 'ar' ? 'تُدار الكمية من قسم «المخزون» (العمليات).' : 'Quantity is managed in the Inventory section (Operations).'}</p>}
        </div>

        {/* variants (single-select size, replaces base price) */}
        <div className="field">
          <div className="row-between">
            <label>{t('variants')} <span className="faint xs">({lang === 'ar' ? 'حجم/نوع — يستبدل السعر' : 'size — replaces price'})</span></label>
            <button className="btn btn-sm btn-outline" onClick={addVariant}>+ {t('addVariant')}</button>
          </div>
          {(form.variants || []).map((v, i) => (
            <div key={i} className="row" style={{ gap: 6, marginTop: 6 }}>
              <input className="input" placeholder={lang === 'ar' ? 'الاسم' : 'Name'} value={v.nameAr} onChange={(e) => setVariant(i, 'nameAr', e.target.value)} />
              <input className="input num" style={{ maxWidth: 90 }} type="number" placeholder={t('price')} value={v.price} disabled={!canPrice} onChange={(e) => setVariant(i, 'price', e.target.value)} />
              <button className="icon-btn" onClick={() => delVariant(i)}><Icon name="close" size={16} /></button>
            </div>
          ))}
        </div>

        <EditorSection id="ie-recipe" title={lang === 'ar' ? 'الوصفة والمخزون' : 'Recipe & inventory'} />
        {/* recipe / BOM — links raw materials consumed per variant (deducted on sale) */}
        <div className="field">
          <label>{lang === 'ar' ? 'الوصفة (المخزون)' : 'Recipe (inventory)'} <span className="faint xs">({lang === 'ar' ? 'استهلاك المواد الخام لكل حجم' : 'raw-material usage per size'})</span></label>
          <RecipeEditor lang={lang} variants={form.variants || []} materials={materials} recipe={form.recipe || []} variantRecipes={form.variantRecipes || {}} onChange={({ recipe, variantRecipes }) => setForm((f) => ({ ...f, recipe, variantRecipes }))} />
        </div>

        {/* ingredients — no emoji entry (hard rule); the menu shows the name's initial */}
        <div className="field">
          <div className="row-between">
            <label>{t('ingredients')}</label>
            <button className="btn btn-sm btn-outline" onClick={addIng}>+ {t('addIngredient')}</button>
          </div>
          {(form.ingredients || []).map((x, i) => (
            <div key={i} className="row" style={{ gap: 6, marginTop: 6 }}>
              <input className="input" placeholder={lang === 'ar' ? 'المكوّن (مثال: حليب)' : 'Ingredient (e.g. milk)'} value={x.nameAr} onChange={(e) => setIng(i, 'nameAr', e.target.value)} />
              <button className="icon-btn" onClick={() => delIng(i)}><Icon name="close" size={16} /></button>
            </div>
          ))}
        </div>

        <EditorSection id="ie-advanced" title={lang === 'ar' ? 'خيارات متقدمة' : 'Advanced options'} />
        {/* modifier groups (add-ons, add to price) */}
        <ModifierGroupsEditor groups={form.modifierGroups || []} onChange={(g) => set('modifierGroups', g)} currency={currency} materials={materials} />
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// «تركيب الصنف» — the per-dish visual composer.
//
// The owner asked to decide how each dish looks and how it arrives: the backdrop
// behind it and how it BLENDS with the photo, filters, a live effect over it,
// the photo's size SEPARATELY in the menu list and in the opened item, its
// position, rotation and blur, a shadow he can move, and an entrance animation.
//
// Nothing here invents a value: every option comes from a catalogue in
// lib/dishComposition.js and every slider is bounded by that module's RANGE, so
// the editor cannot offer a setting the renderer would clamp away. The preview
// is drawn by resolveComposition() + bgStyle() + imgStyle() — the very functions
// the menu renders with — so it cannot promise something the menu will not draw.

// value formatters, Latin digits only (hard rule)
const cxPct = (v) => `${Math.round(Number(v) * 100)}%`
const cxTimes = (v) => `${Number(v).toFixed(2)}×`
const cxDeg = (v) => `${Number(v)}°`
const cxPx = (v) => `${Number(v)} px`
const cxOff = (v) => `${Number(v)}%`
const cxNum = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt)

const BG_POSITIONS = ['left top', 'center top', 'right top', 'left center', 'center', 'right center', 'left bottom', 'center bottom', 'right bottom']

// One slider bound to a contract RANGE: label, live value, control.
function CxSlider({ label, value, min, max, step, format, onChange }) {
  return (
    <div className="dcx-slider">
      <div className="dcx-slider-top">
        <b>{label}</b>
        <span className="num">{format ? format(value) : String(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

// One catalogue picker (blend modes, filters). Renders the Arabic label.
function CxSelect({ label, value, options, lang, onChange }) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      <select className="select" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id || 'dflt'} value={o.id}>{lang === 'ar' ? o.ar : o.en}</option>)}
      </select>
    </div>
  )
}

// A titled group with its own reset — five small cards instead of one wall of sliders.
function CxGroup({ icon, title, hint, resetLabel, onReset, children }) {
  return (
    <section className="dcx-group">
      <div className="row-between" style={{ alignItems: 'center', gap: 8 }}>
        <strong className="xs"><Icon name={icon} size={13} style={{ verticalAlign: 'middle' }} /> {title}</strong>
        <button type="button" className="btn btn-xs btn-ghost" style={{ flex: 'none' }} onClick={onReset}>
          <Icon name="undo" size={12} /> {resetLabel}
        </button>
      </div>
      {hint ? <p className="xs faint" style={{ margin: 0 }}>{hint}</p> : null}
      {children}
    </section>
  )
}

function CompositionEditor({ form, setForm, lang, currency, uploading, onPickBgImage, onEditBgImage, onPickBgVideo }) {
  const ar = lang === 'ar'
  const patch = (o) => setForm((f) => ({ ...f, ...o }))
  const set = (k, v) => patch({ [k]: v })

  // Which variant the stage is showing. The two size/position blocks below are
  // ringed to match, so it is never ambiguous which one a slider is moving.
  const [variant, setVariant] = useState('list')
  const [replay, setReplay] = useState(0)
  const comp = resolveComposition(form, { variant })

  // Replay the entrance whenever the choice or the previewed variant changes —
  // an animation you cannot see is an animation you cannot judge.
  useEffect(() => { setReplay((r) => r + 1) }, [form.anim, variant])

  // '' means "leave it to the theme"; the stage shows a gentle rise for it and
  // says so, rather than pretending to know what each theme does.
  const animPreview = comp.anim === 'none' ? '' : (comp.anim || 'rise')
  const bgWrapStyle = comp.bg && comp.bg.kind === 'video'
    ? {
      opacity: comp.bg.opacity,
      ...(comp.bg.blend !== 'normal' ? { mixBlendMode: comp.bg.blend } : null),
      ...(comp.bg.filter ? { filter: comp.bg.filter } : null),
    }
    : null
  const bgVideoStyle = comp.bg
    ? {
      objectPosition: comp.bg.pos,
      ...(comp.bg.scale !== 1 ? { transform: `scale(${comp.bg.scale})`, transformOrigin: comp.bg.pos } : null),
    }
    : null

  // The list values FALL BACK to the opened-item ones while they are unset
  // (resolveComposition does exactly this), so the sliders must show the value
  // that is really in force — not a zero the list does not use.
  const stageScale = cxNum(form.imageScale, RANGE.scale.dflt)
  const stageX = cxNum(form.imageX, RANGE.offset.dflt)
  const stageY = cxNum(form.imageY, RANGE.offset.dflt)
  const listScale = form.listScale != null ? cxNum(form.listScale, stageScale) : stageScale
  const listX = form.listX != null ? cxNum(form.listX, stageX) : stageX
  const listY = form.listY != null ? cxNum(form.listY, stageY) : stageY
  const listFollows = form.listScale == null && form.listX == null && form.listY == null

  const resetBg = () => patch({ bgOpacity: COMPOSE_DEFAULTS.bgOpacity, bgPos: COMPOSE_DEFAULTS.bgPos, bgScale: COMPOSE_DEFAULTS.bgScale, bgBlend: COMPOSE_DEFAULTS.bgBlend, bgFilter: COMPOSE_DEFAULTS.bgFilter })
  const resetImg = () => patch({
    imageScale: COMPOSE_DEFAULTS.imageScale, imageX: COMPOSE_DEFAULTS.imageX, imageY: COMPOSE_DEFAULTS.imageY,
    listScale: null, listX: null, listY: null,
    imageRot: COMPOSE_DEFAULTS.imageRot, imageBlend: COMPOSE_DEFAULTS.imageBlend, imageFilter: COMPOSE_DEFAULTS.imageFilter, imageBlur: COMPOSE_DEFAULTS.imageBlur,
  })
  const resetShadow = () => patch({
    shadowOn: false, shadowX: COMPOSE_DEFAULTS.shadowX, shadowY: COMPOSE_DEFAULTS.shadowY,
    shadowBlur: COMPOSE_DEFAULTS.shadowBlur,
    shadowOpacity: COMPOSE_DEFAULTS.shadowOpacity, shadowColor: COMPOSE_DEFAULTS.shadowColor,
  })
  const resetLabel = ar ? 'إعادة الضبط' : 'Reset'

  return (
    <div className="stack" style={{ gap: 10, marginBottom: 'var(--sp-3)' }}>
      <p className="xs faint" style={{ margin: 0 }}>
        {ar
          ? 'تتحكم هنا في شكل هذا الصنف وحده: خلفيته وطريقة مزجها، مقاس صورته وموضعها في القائمة وفي شاشة الصنف كلٌّ على حدة، ظلّه، المؤثر فوقه، وطريقة ظهوره. كل قيمة تبقى على الافتراضي ما لم تحرّكها.'
          : 'Controls how this one item looks: its backdrop and blend, its photo size and position separately in the list and on its own screen, its shadow, the effect over it, and how it appears.'}
      </p>

      <section className="dcx-group">
        <div className="row-between" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong className="xs"><Icon name="eye" size={13} style={{ verticalAlign: 'middle' }} /> {ar ? 'معاينة حية' : 'Live preview'}</strong>
          <div className="row" style={{ gap: 6, flex: 'none' }}>
            <button type="button" className={`chip ${variant === 'list' ? 'active' : ''}`} onClick={() => setVariant('list')}>{ar ? 'القائمة' : 'Menu list'}</button>
            <button type="button" className={`chip ${variant === 'stage' ? 'active' : ''}`} onClick={() => setVariant('stage')}>{ar ? 'الصنف المفتوح' : 'Opened item'}</button>
            <button type="button" className="btn btn-xs btn-outline" onClick={() => setReplay((r) => r + 1)}>
              <Icon name="reload" size={12} /> {ar ? 'إعادة الحركة' : 'Replay'}
            </button>
          </div>
        </div>

        <div className="dcx-stage" data-variant={variant}>
          {comp.bg && comp.bg.kind === 'video' ? (
            <span className="dcx-bg" style={bgWrapStyle}>
              <video key={comp.bg.url} src={comp.bg.url} autoPlay muted loop playsInline style={bgVideoStyle} />
            </span>
          ) : comp.bg ? (
            <span className="dcx-bg" style={bgStyle(comp.bg)} />
          ) : null}

          {form.imageUrl ? (
            <span className="dcx-shot">
              <img key={replay} src={form.imageUrl} alt="" data-anim={animPreview || undefined} style={imgStyle(comp.img, comp.shadow) || undefined} />
            </span>
          ) : (
            <span className="dcx-empty">{ar ? 'ارفع صورة الصنف لترى التركيب — الأفضل صورة بخلفية شفافة' : 'Upload the item photo to compose it (a transparent cutout works best)'}</span>
          )}

          <ItemFx kind={comp.fx} />

          <span className="dcx-meta">
            <b>{form.nameAr || form.nameEn || (ar ? 'اسم الصنف' : 'Item name')}</b>
            <span className="num">{form.price || '0'} {currency}</span>
          </span>
        </div>

        <p className="xs faint" style={{ margin: 0 }}>
          {ar
            ? 'الخلفية الداكنة هنا هي نفسها خلفية ثيم المجلة — وضع المزج يختلف كلياً فوق الفاتح والداكن، فالمعاينة تريك الحالة الحقيقية.'
            : 'The dark canvas mirrors the editorial theme: blend modes read completely differently on light and dark.'}
        </p>
      </section>

      <CxGroup icon="image" title={ar ? 'الخلفية' : 'Backdrop'} resetLabel={resetLabel} onReset={resetBg}
        hint={ar ? 'صورة أو فيديو خلف هذا الصنف — تتفوق على الخلفية الموحّدة في الاستوديو.' : 'An image or video behind this item, overriding the venue-wide backdrop.'}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
            <Icon name="image" size={13} /> {ar ? 'رفع صورة' : 'Upload image'}
            <input hidden type="file" accept="image/*" onChange={onPickBgImage} />
          </label>
          <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
            <Icon name="play" size={13} /> {ar ? 'رفع فيديو' : 'Upload video'}
            <input hidden type="file" accept="video/*" onChange={onPickBgVideo} />
          </label>
          {form.bgUrl && form.bgKind !== 'video' && (
            <button type="button" className="btn btn-sm btn-outline" onClick={onEditBgImage}>
              <Icon name="search" size={13} /> {ar ? 'قص وتأطير' : 'Crop'}
            </button>
          )}
          {form.bgUrl && (
            <button type="button" className="btn-link xs" style={{ color: 'var(--danger)' }} onClick={() => patch({ bgUrl: '', bgKind: '' })}>{ar ? 'إزالة الخلفية' : 'Remove'}</button>
          )}
          {uploading && <span className="spinner" style={{ flex: 'none' }} />}
        </div>

        {form.bgUrl ? (
          <div className="stack" style={{ gap: 9 }}>
            <CxSlider label={ar ? 'شفافية الخلفية' : 'Backdrop opacity'} format={cxPct}
              min={RANGE.bgOpacity.min} max={RANGE.bgOpacity.max} step={RANGE.bgOpacity.step}
              value={cxNum(form.bgOpacity, RANGE.bgOpacity.dflt)} onChange={(v) => set('bgOpacity', v)} />
            <CxSlider label={ar ? 'تكبير الخلفية' : 'Backdrop zoom'} format={cxTimes}
              min={COMPOSE_BOUNDS.bgScale[0]} max={COMPOSE_BOUNDS.bgScale[1]} step={0.05}
              value={cxNum(form.bgScale, COMPOSE_DEFAULTS.bgScale)} onChange={(v) => set('bgScale', v)} />
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{ar ? 'موقع الخلفية' : 'Backdrop position'}</label>
              <div className="dcx-pos" dir="ltr">
                {BG_POSITIONS.map((p) => (
                  <button key={p} type="button" aria-label={p} data-on={(form.bgPos || 'center') === p ? 'true' : 'false'}
                    aria-pressed={(form.bgPos || 'center') === p} onClick={() => set('bgPos', p)} />
                ))}
              </div>
            </div>
            <CxSelect lang={lang} label={ar ? 'مزج الخلفية مع سطح الشاشة' : 'Backdrop blend with the surface'} options={BLEND_MODES}
              value={form.bgBlend || 'normal'} onChange={(v) => set('bgBlend', v)} />
            <CxSelect lang={lang} label={ar ? 'فلتر الخلفية' : 'Backdrop filter'} options={FILTERS}
              value={form.bgFilter || ''} onChange={(v) => set('bgFilter', v)} />
          </div>
        ) : (
          <p className="xs faint" style={{ margin: 0 }}>{ar ? 'لا خلفية لهذا الصنف — يظهر على خلفية الثيم العادية.' : 'No backdrop: the item sits on the theme background.'}</p>
        )}
      </CxGroup>

      <CxGroup icon="camera" title={ar ? 'الصورة' : 'The photo'} resetLabel={resetLabel} onReset={resetImg}
        hint={ar ? 'المقاس والموضع يُضبطان لكل شاشة على حدة: صورة بحجم صف في القائمة لا تكفي شاشة الصنف.' : 'Size and position are set per screen: a photo sized for a list row cannot carry a full item screen.'}>
        <div className="dcx-sub" data-live={variant === 'list' ? 'true' : 'false'}>
          <div className="dcx-sub-head">
            <strong className="xs">{ar ? 'في القائمة (أثناء التصفح)' : 'In the menu list'}</strong>
            {!listFollows && (
              <button type="button" className="btn btn-xs btn-ghost" style={{ flex: 'none' }} onClick={() => patch({ listScale: null, listX: null, listY: null })}>
                {ar ? 'اتبع الصنف المفتوح' : 'Follow the item screen'}
              </button>
            )}
          </div>
          <CxSlider label={ar ? 'الحجم في القائمة' : 'Size in the list'} format={cxTimes}
            min={RANGE.scale.min} max={RANGE.scale.max} step={RANGE.scale.step}
            value={listScale} onChange={(v) => set('listScale', v)} />
          <CxSlider label={ar ? 'الإزاحة الأفقية في القائمة' : 'Horizontal offset in the list'} format={cxOff}
            min={RANGE.offset.min} max={RANGE.offset.max} step={RANGE.offset.step}
            value={listX} onChange={(v) => set('listX', v)} />
          <CxSlider label={ar ? 'الإزاحة الرأسية في القائمة' : 'Vertical offset in the list'} format={cxOff}
            min={RANGE.offset.min} max={RANGE.offset.max} step={RANGE.offset.step}
            value={listY} onChange={(v) => set('listY', v)} />
          {listFollows && (
            <p className="xs faint" style={{ margin: 0 }}>{ar ? 'تتبع القائمة حالياً قيم الصنف المفتوح — حرّك أي مؤشر هنا لتفصلها.' : 'The list currently follows the item screen — move any slider here to split them.'}</p>
          )}
        </div>

        <div className="dcx-sub" data-live={variant === 'stage' ? 'true' : 'false'}>
          <div className="dcx-sub-head">
            <strong className="xs">{ar ? 'في الصنف المفتوح' : 'On the opened item'}</strong>
          </div>
          <CxSlider label={ar ? 'الحجم في الصنف المفتوح' : 'Size on the item screen'} format={cxTimes}
            min={RANGE.scale.min} max={RANGE.scale.max} step={RANGE.scale.step}
            value={stageScale} onChange={(v) => set('imageScale', v)} />
          <CxSlider label={ar ? 'الإزاحة الأفقية' : 'Horizontal offset'} format={cxOff}
            min={RANGE.offset.min} max={RANGE.offset.max} step={RANGE.offset.step}
            value={stageX} onChange={(v) => set('imageX', v)} />
          <CxSlider label={ar ? 'الإزاحة الرأسية' : 'Vertical offset'} format={cxOff}
            min={RANGE.offset.min} max={RANGE.offset.max} step={RANGE.offset.step}
            value={stageY} onChange={(v) => set('imageY', v)} />
        </div>

        <CxSlider label={ar ? 'الميلان (الدوران)' : 'Rotation'} format={cxDeg}
          min={RANGE.rot.min} max={RANGE.rot.max} step={RANGE.rot.step}
          value={cxNum(form.imageRot, RANGE.rot.dflt)} onChange={(v) => set('imageRot', v)} />
        <CxSlider label={ar ? 'التمويه' : 'Blur'} format={cxPx}
          min={RANGE.blur.min} max={RANGE.blur.max} step={RANGE.blur.step}
          value={cxNum(form.imageBlur, RANGE.blur.dflt)} onChange={(v) => set('imageBlur', v)} />
        <CxSelect lang={lang} label={ar ? 'مزج الصورة مع خلفيتها' : 'Photo blend'} options={BLEND_MODES}
          value={form.imageBlend || 'normal'} onChange={(v) => set('imageBlend', v)} />
        <CxSelect lang={lang} label={ar ? 'فلتر الصورة' : 'Photo filter'} options={FILTERS}
          value={form.imageFilter || ''} onChange={(v) => set('imageFilter', v)} />
      </CxGroup>

      <CxGroup icon="moon" title={ar ? 'الظل' : 'Shadow'} resetLabel={resetLabel} onReset={resetShadow}
        hint={ar ? 'ظل يتبع حدود الطبق نفسه لا حدود المربع — مناسب للصور المقصوصة الخلفية، ويمكن تحريكه في أي اتجاه.' : 'A shadow that follows the dish cutout rather than its box, movable in any direction.'}>
        <label className="row-between" style={{ cursor: 'pointer', gap: 10 }}>
          <span className="xs bold">{ar ? 'تشغيل الظل' : 'Shadow on'}</span>
          <input type="checkbox" checked={!!form.shadowOn} onChange={(e) => set('shadowOn', e.target.checked)} style={{ width: 22, height: 22, flex: 'none' }} />
        </label>
        {form.shadowOn && (
          <div className="stack" style={{ gap: 9 }}>
            <CxSlider label={ar ? 'إزاحة الظل أفقياً' : 'Shadow X'} format={cxPx}
              min={COMPOSE_BOUNDS.shadowX[0]} max={COMPOSE_BOUNDS.shadowX[1]} step={1}
              value={cxNum(form.shadowX, COMPOSE_DEFAULTS.shadowX)} onChange={(v) => set('shadowX', v)} />
            <CxSlider label={ar ? 'إزاحة الظل رأسياً' : 'Shadow Y'} format={cxPx}
              min={COMPOSE_BOUNDS.shadowY[0]} max={COMPOSE_BOUNDS.shadowY[1]} step={1}
              value={cxNum(form.shadowY, COMPOSE_DEFAULTS.shadowY)} onChange={(v) => set('shadowY', v)} />
            <CxSlider label={ar ? 'نعومة الظل' : 'Shadow blur'} format={cxPx}
              min={RANGE.shadowBlur.min} max={RANGE.shadowBlur.max} step={RANGE.shadowBlur.step}
              value={cxNum(form.shadowBlur, RANGE.shadowBlur.dflt)} onChange={(v) => set('shadowBlur', v)} />
            <CxSlider label={ar ? 'قوة الظل' : 'Shadow strength'} format={cxPct}
              min={RANGE.opacity.min} max={RANGE.opacity.max} step={RANGE.opacity.step}
              value={cxNum(form.shadowOpacity, COMPOSE_DEFAULTS.shadowOpacity)} onChange={(v) => set('shadowOpacity', v)} />
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{ar ? 'لون الظل' : 'Shadow colour'}</label>
              <div className="row" style={{ gap: 6 }}>
                <input type="color" className="input" style={{ width: 40, padding: 2, height: 38, cursor: 'pointer', flex: 'none' }}
                  value={form.shadowColor || COMPOSE_DEFAULTS.shadowColor} onChange={(e) => set('shadowColor', e.target.value)} />
                <input className="input grow" style={{ minWidth: 0 }} dir="ltr" placeholder={COMPOSE_DEFAULTS.shadowColor}
                  value={form.shadowColor || ''} onChange={(e) => set('shadowColor', e.target.value)} />
              </div>
            </div>
          </div>
        )}
      </CxGroup>

      <CxGroup icon="sparkles" title={ar ? 'المؤثر الحي' : 'Live effect'} resetLabel={resetLabel} onReset={() => set('effect', '')}
        hint={ar
          ? 'بخار أو دخان أو لمعان يتحرك فوق الصنف في المنيو وفي عارض المجسم داخل التطبيق. في وضع AR على الطاولة (الكاميرا) يظهر المجسم فقط بلا مؤثر — قيد تقني من نظام التشغيل.'
          : 'Animates over the photo in the menu and the in-app 3D viewer. Real camera AR shows the bare model only (OS limitation).'}>
        <CxSelect lang={lang} label={ar ? 'المؤثر فوق الصنف' : 'Effect over the dish'} options={FX}
          value={form.effect || ''} onChange={(v) => set('effect', v)} />
      </CxGroup>

      <CxGroup icon="zap" title={ar ? 'حركة الظهور' : 'Entrance animation'} resetLabel={resetLabel} onReset={() => set('anim', '')}
        hint={ar
          ? 'كيف يدخل هذا الصنف الشاشة. «افتراضي» يترك القرار للثيم، والمعاينة تعرضه كصعود خفيف. تتوقف كل الحركات تلقائياً لمن فعّل تقليل الحركة في جهازه.'
          : 'How this item enters the screen. Default leaves it to the theme; all of them stop for anyone with reduced motion switched on.'}>
        <div className="dcx-anims">
          {ANIMS.map((a) => (
            <button key={a.id || 'dflt'} type="button" className={`chip ${(form.anim || '') === a.id ? 'active' : ''}`}
              aria-pressed={(form.anim || '') === a.id} onClick={() => set('anim', a.id)}>
              {ar ? a.ar : a.en}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => setReplay((r) => r + 1)}>
          <Icon name="play" size={13} /> {ar ? 'شغّل الحركة في المعاينة' : 'Play it in the preview'}
        </button>
      </CxGroup>
    </div>
  )
}

function ModifierGroupsEditor({ groups, onChange, currency, materials = [] }) {
  const { t, lang } = useI18n()
  const setG = (i, patch) => onChange(groups.map((g, idx) => (idx === i ? { ...g, ...patch } : g)))
  const addGroup = () => onChange([...groups, { nameAr: '', nameEn: '', min: 0, max: 0, required: false, options: [{ nameAr: '', nameEn: '', price: '' }] }])
  const delGroup = (i) => onChange(groups.filter((_, idx) => idx !== i))
  const addOpt = (gi) => setG(gi, { options: [...(groups[gi].options || []), { nameAr: '', nameEn: '', price: '' }] })
  const setOpt = (gi, oi, patch) => setG(gi, { options: groups[gi].options.map((o, idx) => (idx === oi ? { ...o, ...patch } : o)) })
  const delOpt = (gi, oi) => setG(gi, { options: groups[gi].options.filter((_, idx) => idx !== oi) })

  return (
    <div className="field">
      <div className="row-between">
        <label>{lang === 'ar' ? 'الإضافات والخيارات' : 'Add-ons & options'} <span className="faint xs">({lang === 'ar' ? 'تُضاف للسعر' : 'add to price'})</span></label>
        <button className="btn btn-sm btn-outline" onClick={addGroup}>+ {lang === 'ar' ? 'مجموعة' : 'Group'}</button>
      </div>
      {groups.map((g, gi) => (
        <div key={gi} className="card card-pad stack" style={{ marginTop: 8, gap: 8, background: 'var(--surface-2)' }}>
          <div className="row" style={{ gap: 6 }}>
            <input className="input" placeholder={lang === 'ar' ? 'اسم المجموعة (مثال: إضافات)' : 'Group name'} value={g.nameAr} onChange={(e) => setG(gi, { nameAr: e.target.value })} />
            <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => delGroup(gi)}><Icon name="delete" size={18} /></button>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="field grow">
              <label className="xs">{lang === 'ar' ? 'أدنى' : 'Min'}</label>
              <input className="input num" type="number" value={g.min} onChange={(e) => setG(gi, { min: e.target.value })} />
            </div>
            <div className="field grow">
              <label className="xs">{lang === 'ar' ? 'أقصى (0=غير محدود)' : 'Max (0=∞)'}</label>
              <input className="input num" type="number" value={g.max} onChange={(e) => setG(gi, { max: e.target.value })} />
            </div>
            <label className="row" style={{ gap: 6, alignSelf: 'flex-end', paddingBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!g.required} onChange={(e) => setG(gi, { required: e.target.checked })} style={{ width: 18, height: 18 }} />
              <span className="xs">{t('required')}</span>
            </label>
          </div>
          {(g.options || []).map((o, oi) => (
            <div key={oi} className="stack" style={{ gap: 4 }}>
              <div className="row" style={{ gap: 6 }}>
                <input className="input" placeholder={lang === 'ar' ? 'خيار' : 'Option'} value={o.nameAr} onChange={(e) => setOpt(gi, oi, { nameAr: e.target.value })} />
                <input className="input num" style={{ maxWidth: 80 }} type="number" placeholder="+0" value={o.price} onChange={(e) => setOpt(gi, oi, { price: e.target.value })} />
                <button className="icon-btn" onClick={() => delOpt(gi, oi)}><Icon name="close" size={16} /></button>
              </div>
              {materials.length > 0 && (
                <details>
                  <summary className="xs faint" style={{ cursor: 'pointer' }}>{lang === 'ar' ? 'استهلاك مخزون' : 'Stock usage'}{o.recipe?.length ? ` (${o.recipe.length})` : ''}</summary>
                  <div style={{ marginTop: 4 }}>
                    <RecipeEditor lang={lang} variants={[]} materials={materials} recipe={o.recipe || []} variantRecipes={{}} onChange={({ recipe }) => setOpt(gi, oi, { recipe })} />
                  </div>
                </details>
              )}
            </div>
          ))}
          <button className="btn btn-sm btn-ghost" style={{ color: 'var(--brand)' }} onClick={() => addOpt(gi)}>+ {lang === 'ar' ? 'خيار' : 'Option'}</button>
        </div>
      ))}
    </div>
  )
}

// «نقاط تفاعلية على الصورة» — pins up to 8 tappable info points on the dish
// photo. Clicking the photo adds a point at that exact spot (percent of the
// image box via getBoundingClientRect), dragging a numbered dot repositions it
// (pointer capture), and the preview toggle renders the real customer-facing
// component (DishHotspots) so the manager sees exactly what diners get.
// x/y are stored as 0-100 percentages from the image's left/top edges.
function HotspotsEditor({ imageUrl, hotspots, onChange, lang }) {
  const ar = lang === 'ar'
  const boxRef = useRef(null)
  const dragRef = useRef(null) // { idx } while a numbered dot is being dragged
  const [preview, setPreview] = useState(false)
  const spots = hotspots || []
  const full = spots.length >= 8

  const clampPct = (v) => Math.min(100, Math.max(0, v))
  const round1 = (n) => Math.round(n * 10) / 10
  const pointPct = (e) => {
    const r = boxRef.current.getBoundingClientRect()
    return {
      x: round1(clampPct(((e.clientX - r.left) / r.width) * 100)),
      y: round1(clampPct(((e.clientY - r.top) / r.height) * 100)),
    }
  }

  const addAt = (e) => {
    if (preview || full) return
    onChange([...spots, { ...pointPct(e), label: '', desc: '' }])
  }
  const setSpot = (i, patch) => onChange(spots.map((h, idx) => (idx === i ? { ...h, ...patch } : h)))
  const delSpot = (i) => onChange(spots.filter((_, idx) => idx !== i))

  const dragStart = (i) => (e) => {
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = { idx: i }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const dragMove = (i) => (e) => {
    if (dragRef.current?.idx !== i) return
    setSpot(i, pointPct(e))
  }
  const dragEnd = () => { dragRef.current = null }

  if (!imageUrl) {
    return (
      <p className="xs faint" style={{ margin: 0 }}>
        <Icon name="camera" size={13} style={{ verticalAlign: 'middle' }} />{' '}
        {ar ? 'أضف صورة رئيسية للصنف أولاً حتى تتمكن من تثبيت النقاط عليها.' : 'Add a main photo first, then pin points on it.'}
      </p>
    )
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row-between" style={{ alignItems: 'center', gap: 8 }}>
        <span className="xs faint">
          {full
            ? (ar ? 'وصلت للحد الأقصى: 8 نقاط — احذف نقطة لإضافة غيرها.' : 'Maximum reached: 8 points — delete one to add another.')
            : spots.length === 0
              ? (ar ? 'انقر على الصورة لإضافة نقطة — مثال: نوع الجبن، الصوص، الإضافة المميزة.' : 'Click the photo to add a point — e.g. the cheese, the sauce, the signature side.')
              : (ar ? 'انقر على الصورة لإضافة نقطة، واسحب الرقم لتحريكه.' : 'Click the photo to add a point, drag a number to move it.')}
        </span>
        <button type="button" className={`btn btn-xs ${preview ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 'none' }} onClick={() => setPreview((v) => !v)}>
          <Icon name="eye" size={12} /> {ar ? 'معاينة' : 'Preview'}
        </button>
      </div>

      <div ref={boxRef} className={`dh-edit-box ${preview ? 'dh-edit-box--preview' : ''}`} onClick={addAt}>
        <img src={imageUrl} alt="" draggable={false} />
        {preview ? (
          <DishHotspots hotspots={spots} />
        ) : (
          spots.map((h, i) => (
            <span
              key={i}
              className="dh-edit-dot num"
              style={{ left: `${clampPct(Number(h.x) || 0)}%`, top: `${clampPct(Number(h.y) || 0)}%` }}
              onPointerDown={dragStart(i)}
              onPointerMove={dragMove(i)}
              onPointerUp={dragEnd}
              onPointerCancel={dragEnd}
              onClick={(e) => e.stopPropagation()}
            >
              {i + 1}
            </span>
          ))
        )}
      </div>

      {spots.map((h, i) => (
        <div key={i} className="row" style={{ gap: 6, alignItems: 'center' }}>
          <span className="dh-num-chip num">{i + 1}</span>
          <input
            className="input" style={{ flex: '1 1 40%', minWidth: 0 }}
            placeholder={ar ? 'الاسم — مطلوب (مثال: جبن حلوم)' : 'Label — required (e.g. halloumi)'}
            value={h.label || ''} onChange={(e) => setSpot(i, { label: e.target.value })}
          />
          <input
            className="input" style={{ flex: '1 1 50%', minWidth: 0 }}
            placeholder={ar ? 'وصف قصير (اختياري)' : 'Short description (optional)'}
            value={h.desc || ''} onChange={(e) => setSpot(i, { desc: e.target.value })}
          />
          <button type="button" className="icon-btn" style={{ color: 'var(--danger)', flex: 'none' }} onClick={() => delSpot(i)} aria-label={ar ? 'حذف النقطة' : 'Delete point'}>
            <Icon name="close" size={15} />
          </button>
        </div>
      ))}
      {spots.some((h) => !(h.label || '').trim()) && (
        <p className="xs faint" style={{ margin: 0 }}>{ar ? 'النقاط بلا اسم لا تُحفظ مع الصنف.' : 'Unnamed points are not saved with the item.'}</p>
      )}
    </div>
  )
}

// «تحويل جماعي إلى 3D»: converts every photographed item without a realistic
// model via the imageTo3d callable — client-side queue, CONCURRENCY 2, live
// per-item status. Each conversion takes 1-8 minutes (Meshy polls server-side);
// a missing provider key aborts the whole queue with the server's honest
// Arabic message (every item would fail identically).
function Batch3dSheet({ tenantId, items, lang, onClose, onOpenStudio }) {
  const ar = lang === 'ar'
  const candidates = useMemo(
    () => (items || []).filter((i) => !i.archived && i.imageUrl && !i.model3dUrl),
    [items],
  )
  // Monthly credit meter (server-enforced quota; this mirror is display-only).
  const [quota, setQuota] = useState(null) // {used, cap}
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { collection, getDocs, query, where, Timestamp, doc, getDoc } = await import('firebase/firestore')
        const { db } = await import('../../lib/firebase.js')
        const ms = new Date(); ms.setDate(1); ms.setHours(0, 0, 0, 0)
        const snap = await getDocs(query(collection(db, 'tenants', tenantId, 'ar3dJobs'), where('createdAt', '>=', Timestamp.fromDate(ms))))
        const used = snap.docs.map((d) => d.data()).filter((j) => j.status === 'done' || j.status === 'running').length
        const t = await getDoc(doc(db, 'tenants', tenantId))
        const cap = Math.max(0, Number(t.data()?.ar3dMonthly) || 20)
        if (alive) setQuota({ used, cap })
      } catch (_) { /* meter is cosmetic — the server enforces the real quota */ }
    })()
    return () => { alive = false }
  }, [tenantId])
  const [picked, setPicked] = useState(() => new Set(candidates.map((i) => i.id)))
  const [status, setStatus] = useState({}) // id -> {state:'wait'|'run'|'done'|'fail', sec, msg, url}
  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)
  const [abortMsg, setAbortMsg] = useState('')

  // Elapsed-seconds ticker for items currently converting.
  useEffect(() => {
    if (!running) return undefined
    const t = setInterval(() => {
      setStatus((s) => {
        const n = { ...s }
        for (const k of Object.keys(n)) if (n[k].state === 'run') n[k] = { ...n[k], sec: (n[k].sec || 0) + 1 }
        return n
      })
    }, 1000)
    return () => clearInterval(t)
  }, [running])

  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allPicked = picked.size === candidates.length && candidates.length > 0

  const start = async () => {
    const queue = candidates.filter((i) => picked.has(i.id))
    if (!queue.length) return
    stopRef.current = false
    setAbortMsg('')
    setRunning(true)
    setStatus(Object.fromEntries(queue.map((i) => [i.id, { state: 'wait' }])))
    let idx = 0
    const worker = async () => {
      while (!stopRef.current) {
        const my = idx++
        if (my >= queue.length) return
        const it = queue[my]
        setStatus((s) => ({ ...s, [it.id]: { state: 'run', sec: 0 } }))
        try {
          const res = await httpsCallable(functions, 'imageTo3d', { timeout: 540000 })({ tenantId, itemId: it.id, imageUrl: it.imageUrl })
          const url = res?.data?.url || ''
          setStatus((s) => ({ ...s, [it.id]: { state: 'done', url } }))
        } catch (e) {
          const msg = String(e?.message || e)
          // Provider key not configured -> identical failure for every item: abort the queue.
          if (/MESHY|مزود|مفتاح/i.test(msg)) { setAbortMsg(msg); stopRef.current = true }
          setStatus((s) => ({ ...s, [it.id]: { state: 'fail', msg } }))
        }
      }
    }
    await Promise.all([worker(), worker()])
    setRunning(false)
  }

  const doneCount = Object.values(status).filter((x) => x.state === 'done').length
  const failCount = Object.values(status).filter((x) => x.state === 'fail').length
  const total = Object.keys(status).length

  return (
    <Sheet open onClose={running ? () => {} : onClose} title={ar ? 'تحويل جماعي إلى مجسمات واقعية' : 'Batch realistic 3D'}>
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <p className="small muted" style={{ margin: 0, lineHeight: 1.8 }}>
          {ar
            ? `${candidates.length.toLocaleString('ar-SA-u-nu-latn')} صنفاً مصوّراً بلا مجسم واقعي. التحويل يستغرق 1-8 دقائق لكل صنف (صنفان معاً في كل مرة) — أبقِ الصفحة مفتوحة حتى الانتهاء.`
            : `${candidates.length} photographed items without a realistic model. Each takes 1-8 minutes (2 at a time) — keep this page open.`}
        </p>
        {quota && (
          <div className="row-between card card-pad" style={{ paddingBlock: 8 }}>
            <span className="small bold">{ar ? 'رصيد الشهر' : 'Monthly quota'}</span>
            <span className="small" style={{ direction: 'ltr' }}>{Math.max(0, quota.cap - quota.used)} / {quota.cap}</span>
          </div>
        )}
        {quota && quota.used >= quota.cap && (
          <p className="xs" style={{ margin: 0, color: 'var(--danger)' }}>
            {ar ? 'اكتمل حد هذا الشهر — يتجدد مطلع الشهر، أو اطلب رفعه من المنصة.' : 'Monthly cap reached — resets next month, or ask the platform to raise it.'}
          </p>
        )}
        {abortMsg && (
          <div className="card card-pad" style={{ borderColor: 'var(--danger)' }}>
            <p className="small" style={{ margin: 0, color: 'var(--danger)' }}>{abortMsg}</p>
          </div>
        )}
        {total > 0 && (
          <div className="stack" style={{ gap: 4 }}>
            <div className="row-between">
              <span className="xs faint">{ar ? 'التقدم' : 'Progress'}</span>
              <span className="xs faint" style={{ direction: 'ltr' }}>{doneCount + failCount} / {total}</span>
            </div>
            <div style={{ height: 6, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${total ? Math.round(((doneCount + failCount) / total) * 100) : 0}%`, background: 'var(--brand)', transition: 'width 0.4s ease' }} />
            </div>
          </div>
        )}
        {!running && total === 0 && candidates.length > 0 && (
          <label className="row" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(candidates.map((i) => i.id)))} style={{ width: 18, height: 18 }} />
            <span className="small bold">{ar ? 'تحديد الكل' : 'Select all'}</span>
          </label>
        )}
        <div className="stack" style={{ gap: 6, maxHeight: '46dvh', overflowY: 'auto' }}>
          {candidates.length === 0 && (
            <p className="small muted" style={{ textAlign: 'center', padding: 16 }}>
              {ar ? 'كل الأصناف المصوّرة لديها مجسمات بالفعل — أضف صوراً لأصنافك أولاً.' : 'Every photographed item already has a model.'}
            </p>
          )}
          {candidates.map((it) => {
            const st = status[it.id]
            return (
              <div key={it.id} className="row" style={{ gap: 10, alignItems: 'center', padding: '6px 4px', borderBottom: '1px solid var(--border)' }}>
                {!running && !st && (
                  <input type="checkbox" checked={picked.has(it.id)} onChange={() => toggle(it.id)} style={{ width: 18, height: 18, flex: 'none' }} />
                )}
                <img src={it.imageUrl} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: 'cover', flex: 'none' }} />
                <span className="small grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.nameAr || it.nameEn}</span>
                {st?.state === 'wait' && <span className="badge">{ar ? 'بانتظار الدور' : 'Queued'}</span>}
                {st?.state === 'run' && <span className="badge" style={{ color: 'var(--brand)' }}><Spinner size={12} /> {ar ? `يحوّل… ${st.sec || 0} ث` : `Converting… ${st.sec || 0}s`}</span>}
                {st?.state === 'done' && (
                  <button className="badge badge-success" onClick={() => onOpenStudio({ ...it, model3dUrl: st.url })}>
                    <Icon name="check" size={11} /> {ar ? 'تم — عرض' : 'Done — view'}
                  </button>
                )}
                {st?.state === 'fail' && <span className="badge badge-danger" title={st.msg}><Icon name="warning" size={11} /> {ar ? 'فشل' : 'Failed'}</span>}
              </div>
            )
          })}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {!running ? (
            <>
              <button className="btn btn-primary grow" disabled={!picked.size || candidates.length === 0} onClick={start}>
                <Icon name="layers" size={16} /> {ar ? `ابدأ التحويل (${picked.size.toLocaleString('ar-SA-u-nu-latn')})` : `Start (${picked.size})`}
              </button>
              <button className="btn btn-outline" onClick={onClose}>{ar ? 'إغلاق' : 'Close'}</button>
            </>
          ) : (
            <button className="btn btn-outline grow" onClick={() => { stopRef.current = true }}>
              <Icon name="stop" size={16} /> {ar ? 'إيقاف الباقي (يُكمل الجاري الآن)' : 'Stop the rest (current ones finish)'}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
