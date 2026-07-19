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
import { ITEM_EFFECTS } from '../../lib/itemEffects.js'
import { sectionTemplate, templateOptions } from '../../lib/systemTemplates.js'

const blank = () => ({
  nameAr: '', nameEn: '', price: '', calories: '', categoryId: '',
  descAr: '', descEn: '', kdsWarning: '', imageUrl: '', images: [], imageStyle: '', imageScale: 1, effect: '', arStandeeUrl: '', model3dUrl: '', model3dUsdzUrl: '', available: true, availableFrom: '', availableTo: '', countsForLoyalty: true, featured: false, promoNotify: 'default', trackStock: false, stock: '',
  prepTime: '', serves: '', rating: '', reviewsCount: '',
  ingredients: [], variants: [], modifierGroups: [], sortOrder: 0,
  recipe: [], variantRecipes: {},
  namePriceLayout: '', nameColor: '', priceColor: '', namePriceStyle: '',
  bgUrl: '', bgKind: '', bgOpacity: 0.5, bgPos: 'center', bgScale: 1,
})

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
    ['ie-images', lang === 'ar' ? 'الصور والمؤثرات' : 'Images & FX'],
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
      const out = await aiQuick(`اكتب وصفاً شهياً قصيراً (15-25 كلمة) لصنف اسمه "${label}"${ing ? ` مكوناته: ${ing}` : ''} في منيو مقهى. بلا رموز تعبيرية وبلا مبالغة مبتذلة. أجب بالوصف فقط.`)
      const clean = String(out || '').trim()
      if (!clean) throw new Error(lang === 'ar' ? 'لم يصل رد' : 'No response')
      set('descAr', clean)
      toast.success(lang === 'ar' ? 'كُتب الوصف — عدّله كما تحب' : 'Description written')
    } catch (e) {
      toast.error(e?.message || (lang === 'ar' ? 'تعذرت الكتابة' : 'Failed'))
    } finally { setAiDescBusy(false) }
  }

  // per-item detail backdrop (image or video) — size is guarded inside storage.js
  const onBgPick = (kind) => async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const url = kind === 'video' ? await uploadFile(tenantId, file, 'itembg') : await uploadImage(tenantId, file)
      setForm((f) => ({ ...f, bgUrl: url, bgKind: kind, bgOpacity: f.bgOpacity ?? 0.5, bgPos: f.bgPos || 'center', bgScale: f.bgScale || 1 }))
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
        imageScale: Math.min(1.8, Math.max(0.6, Number(form.imageScale) || 1)),
        effect: form.effect || '',
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
        bgUrl: form.bgUrl || '',
        bgKind: form.bgUrl ? (form.bgKind || 'image') : '',
        bgOpacity: Math.min(1, Math.max(0.1, Number(form.bgOpacity ?? 0.5))),
        bgPos: form.bgPos || 'center',
        bgScale: Math.min(3, Math.max(1, Number(form.bgScale) || 1)),
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
          <ImageCropper file={cropState.file} imageSrc={cropState.src} aspect={1} output={{ width: 800, height: 800 }}
            title={cropState.src ? (lang === 'ar' ? 'تعديل صورة الصنف' : 'Edit item image') : (lang === 'ar' ? 'قص صورة الصنف' : 'Crop item image')}
            hint={lang === 'ar' ? 'حرّك وكبّر/صغّر لضبط الصورة على الثيم (مربّع يناسب كل الأشكال)' : 'Move & zoom to fit the theme (square fits all shapes)'}
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

        {/* per-item image size INSIDE the product-detail view (list cards unaffected) */}
        <div className="field">
          <label>{lang === 'ar' ? 'حجم الصورة داخل تفاصيل المنتج' : 'Image size in the product details'} <span className="faint">({Math.round((Number(form.imageScale) || 1) * 100)}%)</span></label>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <span className="xs faint">{lang === 'ar' ? 'أصغر' : 'Smaller'}</span>
            <input type="range" min="0.6" max="1.8" step="0.05" value={Number(form.imageScale) || 1} onChange={(e) => set('imageScale', Number(e.target.value))} style={{ flex: 1 }} />
            <span className="xs faint">{lang === 'ar' ? 'أكبر' : 'Bigger'}</span>
            {(Number(form.imageScale) || 1) !== 1 && <button type="button" className="btn btn-xs btn-ghost" onClick={() => set('imageScale', 1)}>{lang === 'ar' ? 'إعادة' : 'Reset'}</button>}
          </div>
          <p className="xs faint">{lang === 'ar' ? 'يكبّر/يصغّر الصورة عند فتح تفاصيل المنتج فقط، دون التأثير على حجمها في القائمة.' : 'Scales the photo only when the product is opened — the menu card stays as-is.'}</p>
        </div>

        {/* live visual effect over the item (menu detail + spotlight + in-app 3D viewer) */}
        <div className="field">
          <label>{lang === 'ar' ? 'مؤثر حي على الصنف' : 'Live effect'}</label>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <select className="select grow" value={form.effect || ''} onChange={(e) => set('effect', e.target.value)}>
              {ITEM_EFFECTS.map((fx) => <option key={fx.id} value={fx.id}>{lang === 'ar' ? fx.ar : fx.en}</option>)}
            </select>
            {form.imageUrl && (
              <span style={{ position: 'relative', width: 52, height: 52, flex: 'none', borderRadius: 10, overflow: 'hidden' }}>
                <img src={form.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <ItemFx kind={form.effect} />
              </span>
            )}
          </div>
          <p className="xs faint">{lang === 'ar' ? 'بخار أو دخان أو لمعان يتحرك فوق الصنف في تفاصيل المنيو وفي عارض المجسم داخل التطبيق. في وضع AR على الطاولة (الكاميرا) يظهر المجسم فقط بلا مؤثر — قيد تقني من نظام التشغيل.' : 'Animates over the photo in the menu detail and the in-app 3D viewer. Real camera AR shows the bare model only (OS limitation).'}</p>
        </div>

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

        {/* Per-item detail BACKDROP (image/video) — wins over the venue-wide
            immersive backdrop; tuned live against a mini mock of the detail sheet */}
        <div className="card card-pad stack" style={{ gap: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 'var(--sp-3)' }}>
          <div className="row-between">
            <strong className="xs"><Icon name="image" size={13} style={{ verticalAlign: 'middle' }} /> {lang === 'ar' ? 'خلفية خاصة بشاشة هذا الصنف (صورة أو فيديو)' : 'Item detail backdrop (image/video)'}</strong>
            {form.bgUrl && (
              <button type="button" className="btn btn-xs btn-outline" onClick={() => setForm((f) => ({ ...f, bgUrl: '', bgKind: '' }))}>{lang === 'ar' ? 'إزالة' : 'Remove'}</button>
            )}
          </div>
          <p className="xs faint" style={{ margin: 0 }}>{lang === 'ar' ? 'تظهر خلف تفاصيل الصنف عند فتحه، وتتفوق على الخلفية الموحدة في الاستوديو — لكل صنف أجواؤه الخاصة.' : 'Shows behind this item\'s detail view and overrides the venue-wide backdrop.'}</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
              <Icon name="image" size={14} /> {lang === 'ar' ? 'رفع صورة' : 'Upload image'}
              <input hidden type="file" accept="image/*" onChange={onBgPick('image')} />
            </label>
            <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
              <Icon name="play" size={14} /> {lang === 'ar' ? 'رفع فيديو' : 'Upload video'}
              <input hidden type="file" accept="video/*" onChange={onBgPick('video')} />
            </label>
            {uploading && <Spinner />}
          </div>
          {form.bgUrl && (
            <div className="row wrap" style={{ gap: 14, alignItems: 'flex-start' }}>
              <div className="stack grow" style={{ gap: 8, minWidth: 200 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{lang === 'ar' ? `الشفافية: ${Math.round((form.bgOpacity ?? 0.5) * 100)}%` : `Opacity: ${Math.round((form.bgOpacity ?? 0.5) * 100)}%`}</label>
                  <input type="range" min="0.1" max="1" step="0.05" value={form.bgOpacity ?? 0.5} style={{ width: '100%' }} onChange={(e) => set('bgOpacity', Number(e.target.value))} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{lang === 'ar' ? `التكبير: ${Number(form.bgScale || 1).toFixed(1)}×` : `Zoom: ${Number(form.bgScale || 1).toFixed(1)}×`}</label>
                  <input type="range" min="1" max="3" step="0.1" value={form.bgScale || 1} style={{ width: '100%' }} onChange={(e) => set('bgScale', Number(e.target.value))} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{lang === 'ar' ? 'موقع الخلفية' : 'Position'}</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 32px)', gap: 4 }} dir="ltr">
                    {['left top', 'center top', 'right top', 'left center', 'center', 'right center', 'left bottom', 'center bottom', 'right bottom'].map((p) => (
                      <button key={p} type="button" onClick={() => set('bgPos', p)} aria-label={p}
                        style={{ width: 32, height: 26, borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', background: (form.bgPos || 'center') === p ? 'var(--brand)' : 'var(--surface)' }} />
                    ))}
                  </div>
                </div>
              </div>
              {/* live mini mock of the item detail sheet */}
              <div style={{ width: 172, height: 300, borderRadius: 18, overflow: 'hidden', position: 'relative', border: '1px solid var(--border)', background: 'var(--surface)', flex: 'none', isolation: 'isolate' }}>
                {form.bgKind === 'video' ? (
                  <video src={form.bgUrl} autoPlay muted loop playsInline
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: form.bgPos || 'center', opacity: form.bgOpacity ?? 0.5, transform: Number(form.bgScale) > 1 ? `scale(${Number(form.bgScale)})` : undefined, transformOrigin: form.bgPos || 'center' }} />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${form.bgUrl})`, backgroundSize: Number(form.bgScale) > 1 ? `${Number(form.bgScale) * 100}%` : 'cover', backgroundPosition: form.bgPos || 'center', opacity: form.bgOpacity ?? 0.5 }} />
                )}
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                  <div className="stack" style={{ gap: 6, alignItems: 'center' }}>
                    {form.imageUrl && <img src={form.imageUrl} alt="" style={{ width: 76, height: 76, borderRadius: '50%', objectFit: 'cover', boxShadow: 'var(--sh-2)' }} />}
                    <strong className="small" style={{ textShadow: '0 1px 10px rgba(0,0,0,0.35)' }}>{form.nameAr || (lang === 'ar' ? 'اسم الصنف' : 'Item name')}</strong>
                    <span className="xs bold num" style={{ textShadow: '0 1px 10px rgba(0,0,0,0.35)' }}>{form.price || '00'} {currency}</span>
                  </div>
                </div>
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
