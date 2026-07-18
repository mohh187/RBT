import { useEffect, useState } from 'react'
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n, pickLang } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import Sheet from '../../components/Sheet.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { watchCategories, saveCategory, deleteCategory } from '../../lib/db.js'
import { uploadImage } from '../../lib/storage.js'
import ImageCropper from '../../components/ImageCropper.jsx'
import Icon from '../../components/Icon.jsx'

// One draggable category row — grip drags, the rest opens the editor.
function CatRow({ c, lang, onEdit }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: c.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.55 : 1 }
  return (
    <div ref={setNodeRef} style={style} className="list-row" onClick={() => onEdit(c)}>
      <button type="button" className="icon-btn" {...listeners} {...attributes} onClick={(e) => e.stopPropagation()} style={{ cursor: 'grab', touchAction: 'none', flex: 'none' }} aria-label={lang === 'ar' ? 'اسحب للترتيب' : 'Drag to reorder'} title={lang === 'ar' ? 'اسحب للترتيب' : 'Drag to reorder'}><Icon name="drag" size={18} className="faint" /></button>
      {c.coverUrl ? <img src={c.coverUrl} alt="" style={{ width: 30, height: 30, borderRadius: 7, objectFit: 'cover', flex: 'none' }} /> : <Icon name="categories" size={20} />}
      <span className="bold">{pickLang(c, 'name', lang)}</span>
      <span className="grow" />
      <Icon name="next" size={16} className="faint" />
    </div>
  )
}

export default function Categories() {
  const { t, lang } = useI18n()
  const { tenantId } = useAuth()
  const toast = useToast()
  const [cats, setCats] = useState(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(null)
  const [cropState, setCropState] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }))

  // Drag to set the category order shown in the menu (persists sortOrder).
  const onDragEnd = async ({ active, over }) => {
    if (!over || active.id === over.id) return
    const ids = cats.map((c) => c.id)
    const next = arrayMove(cats, ids.indexOf(active.id), ids.indexOf(over.id))
    setCats(next) // optimistic
    await Promise.all(next.map((c, idx) => (c.sortOrder !== idx ? saveCategory(tenantId, c.id, { sortOrder: idx }) : null)).filter(Boolean))
  }

  // Cover image → crop (wide) → upload → set on the category form.
  const onPickCover = (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) setCropState({ file }) }
  const onCovered = async (blob) => {
    setCropState(null); setUploading(true)
    try {
      const f = new File([blob], `cover-${Date.now()}.webp`, { type: 'image/webp' })
      const url = await uploadImage(tenantId, f, 'categories')
      setForm((prev) => ({ ...prev, coverUrl: url }))
    } catch (_) { toast.error(lang === 'ar' ? 'تعذّر رفع الصورة' : 'Upload failed') }
    finally { setUploading(false) }
  }

  useEffect(() => {
    if (!tenantId) return
    return watchCategories(tenantId, setCats)
  }, [tenantId])

  const openNew = () => { setForm({ nameAr: '', nameEn: '', sortOrder: (cats?.length || 0) + 1 }); setOpen(true) }
  const openEdit = (c) => { setForm({ ...c }); setOpen(true) }

  const save = async () => {
    if (!form.nameAr?.trim() && !form.nameEn?.trim()) return
    if (busy) return
    setBusy(true)
    try {
      await saveCategory(tenantId, form.id, {
        nameAr: (form.nameAr || '').trim(),
        nameEn: (form.nameEn || '').trim(),
        descAr: (form.descAr || '').trim(),
        coverUrl: form.coverUrl || '',
        sortOrder: Number(form.sortOrder) || 0,
        active: true,
      })
      setOpen(false)
      toast.success(t('saved'))
    } catch (_) { toast.error(t('error')) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm(t('areYouSure'))) return
    if (busy) return
    setBusy(true)
    try {
      await deleteCategory(tenantId, form.id)
      setOpen(false)
      toast.success(t('deleted'))
    } catch (_) { toast.error(t('error')) }
    finally { setBusy(false) }
  }

  if (cats === null) return <Spinner />

  return (
    <div className="page stack">
      <div className="row-between">
        <h2 className="page-title">{t('categories')}</h2>
        <button className="btn btn-primary btn-sm" onClick={openNew}>+ {t('addCategory')}</button>
      </div>

      {cats.length === 0 ? (
        <Empty icon="categories" title={t('noCategories')} action={<button className="btn btn-primary" onClick={openNew}>+ {t('addCategory')}</button>} />
      ) : (
        <>
          {cats.length > 1 && <p className="xs faint"><Icon name="arrowUpDown" size={12} style={{ verticalAlign: 'middle' }} /> {lang === 'ar' ? 'اسحب لإعادة ترتيب الفئات كما تظهر في المنيو' : 'Drag to reorder categories as shown in the menu'}</p>}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={cats.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                {cats.map((c) => <CatRow key={c.id} c={c} lang={lang} onEdit={openEdit} />)}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={form?.id ? t('edit') : t('addCategory')}
        footer={
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            {form?.id && <button className="btn btn-danger" onClick={remove} disabled={busy}><Icon name="delete" size={18} /></button>}
            <button className="btn btn-primary grow" onClick={save} disabled={busy || uploading}>{busy ? t('saving') : t('save')}</button>
          </div>
        }
      >
        {form && (
          <div className="stack">
            {cropState && (
              <ImageCropper file={cropState.file} imageSrc={cropState.src} aspect={16 / 9} output={{ width: 1200, height: 675 }}
                title={lang === 'ar' ? 'غلاف الفئة' : 'Category cover'}
                hint={lang === 'ar' ? 'حرّك وكبّر لضبط الغلاف' : 'Move & zoom to frame the cover'}
                onClose={() => setCropState(null)} onCropped={onCovered} />
            )}
            <div className="field">
              <label>{t('categoryName')}</label>
              <input className="input" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
            </div>
            <div className="field">
              <label>{t('itemNameEn')} <span className="faint">({t('optional')})</span></label>
              <input className="input" dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
            </div>
            <div className="field">
              <label>{lang === 'ar' ? 'صورة غلاف الفئة (لثيم واجهة العرض)' : 'Category cover (Spotlight theme)'}</label>
              <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                <label className="thumb center" style={{ width: 104, height: 64, overflow: 'hidden', border: '1px dashed var(--border-strong)', cursor: 'pointer', flex: 'none', borderRadius: 'var(--r-md)' }}>
                  {uploading ? <div className="spinner" /> : form.coverUrl ? <img src={form.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="image" size={22} className="muted" />}
                  <input type="file" accept="image/*" hidden onChange={onPickCover} />
                </label>
                <div className="stack" style={{ gap: 4 }}>
                  {form.coverUrl && !uploading && (
                    <div className="row" style={{ gap: 6 }}>
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => setCropState({ src: form.coverUrl })}><Icon name="search" size={13} /> {lang === 'ar' ? 'تعديل' : 'Edit'}</button>
                      <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setForm((p) => ({ ...p, coverUrl: '' }))}>{lang === 'ar' ? 'حذف' : 'Remove'}</button>
                    </div>
                  )}
                  <span className="xs faint">{lang === 'ar' ? 'تظهر كشريحة فاصلة قبل منتجات الفئة.' : 'Shown as a chapter divider before the category.'}</span>
                </div>
              </div>
            </div>
            <div className="field">
              <label>{lang === 'ar' ? 'وصف قصير للغلاف' : 'Short cover description'} <span className="faint">({t('optional')})</span></label>
              <input className="input" value={form.descAr || ''} onChange={(e) => setForm({ ...form, descAr: e.target.value })} placeholder={lang === 'ar' ? 'مثال: أجود أنواع القهوة بالحليب' : 'e.g. Our finest milk coffees'} />
            </div>
            <div className="field">
              <label>{lang === 'ar' ? 'الترتيب' : 'Sort order'}</label>
              <input className="input num" type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}
