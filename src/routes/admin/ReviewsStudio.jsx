// استوديو التقييمات — import Google reviews (paste → AI parse → AI item-match →
// manager confirms → save into tenants/{tid}/reviews with the exact createReview
// shape + {source:'google', authorName, importedAt}), moderate what was imported,
// and toggle the venue-level Google-reviews showcase strip (tenant.reviewShowcase).
//
// INTEGRITY: a review is offered for item-attachment ONLY when the AI flagged its
// text as mentioning that item's name. A free override to any other item is
// possible but defaults OFF and shows an explicit misleading-review warning.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n, pickLang } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { listItems, updateTenant } from '../../lib/db.js'
import {
  parseReviews, matchReviewsToItems, saveImported,
  watchImportedReviews, deleteImportedReview, textMentionsItem, ATTACH_CONFIDENCE,
} from '../../lib/reviewImport.js'

const GENERAL = '' // select value for venue-level («عام»)

function Stars({ value, onChange, size = 16 }) {
  return (
    <span className="stars" style={{ gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={(value || 0) >= n ? 'on' : ''} disabled={!onChange}
          style={{ padding: onChange ? 4 : 0, cursor: onChange ? 'pointer' : 'default' }}
          onClick={onChange ? () => onChange(n) : undefined}>
          <Icon name="star" size={size} />
        </button>
      ))}
    </span>
  )
}

export default function ReviewsStudio() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const { tenantId, tenant, updateTenantLocal } = useAuth()
  const toast = useToast()

  const [items, setItems] = useState([])
  const [raw, setRaw] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [rows, setRows] = useState([]) // parsed+matched, pre-save working set
  const [saving, setSaving] = useState(false)
  const [imported, setImported] = useState(null)
  const [filter, setFilter] = useState('all') // all | general | <itemId>
  const [showcaseBusy, setShowcaseBusy] = useState(false)

  useEffect(() => {
    if (!tenantId) return
    listItems(tenantId).then(setItems).catch(() => setItems([]))
    return watchImportedReviews(tenantId, setImported)
  }, [tenantId])

  const itemById = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items])
  const itemName = (id) => (itemById[id] ? pickLang(itemById[id], 'name', lang) : id)

  // ---------- analyze: paste → parse → match ----------
  const analyze = async () => {
    if (!raw.trim()) { toast.error(ar ? 'الصق نص التقييمات أولاً' : 'Paste the reviews text first'); return }
    setAnalyzing(true)
    try {
      const parsed = await parseReviews(raw)
      if (!parsed.length) { toast.error(ar ? 'لم يتم العثور على تقييمات في النص' : 'No reviews found in the text'); return }
      const matches = await matchReviewsToItems(parsed, items)
      setRows(parsed.map((r, i) => ({
        ...r,
        parsedRating: r.rating, // null ⇒ manager must set stars before saving
        itemId: matches[i]?.itemId || GENERAL,
        confidence: matches[i]?.confidence || 0,
        mentionedItemIds: matches[i]?.mentionedItemIds || [],
        override: false,
        selected: true,
      })))
    } catch (e) {
      toast.error((ar ? 'تعذّر التحليل: ' : 'Analysis failed: ') + (e?.message || e))
    } finally {
      setAnalyzing(false)
    }
  }

  const patchRow = (idx, patch) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)))

  // ---------- bulk save ----------
  const selectable = rows.filter((r) => r.selected)
  const missingRating = selectable.filter((r) => !r.rating).length
  const saveSelected = async () => {
    const ready = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.selected && r.rating)
    if (!ready.length) { toast.error(ar ? 'لا توجد صفوف جاهزة للحفظ (يلزم تقييم بالنجوم لكل صف)' : 'Nothing ready to save (each row needs a star rating)'); return }
    setSaving(true)
    let ok = 0, fail = 0
    const savedIdx = new Set()
    for (const { r, i } of ready) {
      const item = r.itemId ? itemById[r.itemId] : null
      try {
        await saveImported(tenantId, {
          authorName: r.authorName, rating: r.rating, text: r.text,
          itemNameAr: item?.nameAr || '', itemNameEn: item?.nameEn || '',
        }, r.itemId || null)
        ok++; savedIdx.add(i)
      } catch (_) { fail++ }
    }
    setRows((rs) => rs.filter((_, i) => !savedIdx.has(i)))
    setSaving(false)
    if (ok) toast.success(ar ? `تم استيراد ${ok} تقييماً` : `Imported ${ok} reviews`)
    if (fail) toast.error(ar ? `تعذّر حفظ ${fail}` : `${fail} failed`)
  }

  // ---------- moderation ----------
  const remove = async (rv) => {
    if (!window.confirm(ar ? 'حذف هذا التقييم المستورد نهائياً؟' : 'Delete this imported review permanently?')) return
    try { await deleteImportedReview(tenantId, rv.id) } catch (_) { toast.error(ar ? 'تعذّر الحذف' : 'Delete failed') }
  }

  // ---------- venue showcase toggle (tenant.reviewShowcase.enabled) ----------
  const showcaseOn = tenant?.reviewShowcase?.enabled === true
  const toggleShowcase = async (enabled) => {
    setShowcaseBusy(true)
    const next = { ...(tenant?.reviewShowcase || {}), enabled }
    try { await updateTenant(tenantId, { reviewShowcase: next }); updateTenantLocal({ reviewShowcase: next }) }
    catch (_) { toast.error(ar ? 'تعذّر الحفظ' : 'Save failed') }
    finally { setShowcaseBusy(false) }
  }

  const filtered = (imported || []).filter((rv) => filter === 'all' ? true : filter === 'general' ? !rv.itemId : rv.itemId === filter)
  const importedItemIds = [...new Set((imported || []).map((rv) => rv.itemId).filter(Boolean))]

  return (
    <div className="stack" style={{ gap: 'var(--sp-5)' }}>
      <div className="row-between wrap" style={{ gap: 10 }}>
        <div>
          <h2>{ar ? 'استوديو التقييمات' : 'Reviews Studio'}</h2>
          <p className="muted small">{ar ? 'استورد تقييمات جوجل، وأسندها للأصناف التي تذكرها فقط — الباقي يبقى تقييماً عاماً للمنشأة.' : 'Import Google reviews; attach to items only when the text mentions them — the rest stay venue-level.'}</p>
        </div>
      </div>

      {/* venue showcase toggle — menu-side strip rendering is wired separately */}
      <label className="card card-pad row" style={{ gap: 12, alignItems: 'center', cursor: 'pointer' }}>
        <Icon name="star" size={20} style={{ color: 'var(--gold)', flex: 'none' }} />
        <span className="grow">
          <strong className="small" style={{ display: 'block' }}>{ar ? 'شريط تقييمات جوجل في صفحة المنيو' : 'Google reviews strip on the menu page'}</strong>
          <span className="xs faint">{ar ? 'يعرض التقييمات العامة المستوردة (المصنّفة «عام») لزوار المنيو' : 'Shows imported venue-level reviews to menu visitors'}</span>
        </span>
        <input type="checkbox" checked={showcaseOn} disabled={showcaseBusy} style={{ width: 22, height: 22 }}
          onChange={(e) => toggleShowcase(e.target.checked)} />
      </label>

      {/* ---- paste + analyze ---- */}
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <strong className="small">{ar ? 'لصق التقييمات' : 'Paste reviews'}</strong>
        <textarea className="textarea" rows={6} dir="auto" value={raw} onChange={(e) => setRaw(e.target.value)}
          placeholder={ar ? 'انسخ نص التقييمات من صفحة منشأتك على خرائط جوجل والصقه هنا بأي تنسيق…' : 'Copy your Google Maps reviews text and paste it here in any format…'} />
        <button className="btn btn-primary" disabled={analyzing} onClick={analyze}>
          <Icon name="sparkles" size={16} /> {analyzing ? (ar ? 'جارٍ التحليل…' : 'Analyzing…') : (ar ? 'تحليل بالذكاء' : 'Analyze with AI')}
        </button>
      </div>

      {/* ---- parsed working table ---- */}
      {rows.length > 0 && (
        <div className="card card-pad stack" style={{ gap: 10 }}>
          <div className="row-between wrap" style={{ gap: 8 }}>
            <strong className="small">{ar ? `النتائج (${rows.length})` : `Parsed (${rows.length})`}</strong>
            <button className="btn btn-primary btn-sm" disabled={saving || !selectable.length} onClick={saveSelected}>
              <Icon name="check" size={15} /> {saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? `حفظ المحدد (${selectable.length})` : `Save selected (${selectable.length})`)}
            </button>
          </div>
          {missingRating > 0 && (
            <p className="xs" style={{ color: 'var(--danger)' }}>
              {ar ? `${missingRating} صف بلا تقييم نجوم — حدد النجوم يدوياً وإلا لن يُحفظ (لا نخترع تقييماً).` : `${missingRating} rows have no star rating — set stars manually or they will be skipped (we never invent a rating).`}
            </p>
          )}
          <div className="stack" style={{ gap: 8 }}>
            {rows.map((r, i) => {
              const chosenItem = r.itemId ? itemById[r.itemId] : null
              const offMention = chosenItem && !r.mentionedItemIds.includes(r.itemId) && !textMentionsItem(r.text, chosenItem)
              return (
                <div key={i} className="rvw-row" data-off={r.selected ? undefined : ''}>
                  <input type="checkbox" checked={r.selected} style={{ width: 20, height: 20, flex: 'none', marginTop: 4 }}
                    onChange={(e) => patchRow(i, { selected: e.target.checked })} />
                  <div className="grow stack" style={{ gap: 6, minWidth: 0 }}>
                    <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                      <strong className="small">{r.authorName || (ar ? 'بدون اسم' : 'No name')}</strong>
                      {r.parsedRating
                        ? <Stars value={r.rating} size={14} />
                        : <span className="row" style={{ gap: 6, alignItems: 'center' }}><Stars value={r.rating} size={14} onChange={(n) => patchRow(i, { rating: n })} /><span className="xs" style={{ color: 'var(--danger)' }}>{ar ? 'حدد النجوم' : 'set stars'}</span></span>}
                      <span className="rvw-src-badge">{ar ? 'من تقييمات جوجل' : 'From Google reviews'}</span>
                    </div>
                    {r.text && <p className="small muted" style={{ margin: 0 }}>{r.text}</p>}
                    <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                      <select className="input" style={{ maxWidth: 260, paddingBlock: 6 }} value={r.itemId}
                        onChange={(e) => patchRow(i, { itemId: e.target.value })}>
                        <option value={GENERAL}>{ar ? 'عام (المنشأة)' : 'General (venue)'}</option>
                        {/* only AI-flagged mentioned items — unless free override is on */}
                        {(r.override ? items : items.filter((it) => r.mentionedItemIds.includes(it.id))).map((it) => (
                          <option key={it.id} value={it.id}>{pickLang(it, 'name', lang)}</option>
                        ))}
                      </select>
                      {r.itemId && r.mentionedItemIds.includes(r.itemId) && (
                        <span className="xs faint">{ar ? `يذكر الصنف (ثقة ${Math.round(r.confidence * 100)}%)` : `mentions item (${Math.round(r.confidence * 100)}%)`}{r.confidence < ATTACH_CONFIDENCE ? (ar ? ' — أُسند يدوياً' : ' — manual attach') : ''}</span>
                      )}
                      <label className="row xs faint" style={{ gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                        <input type="checkbox" checked={r.override} style={{ width: 16, height: 16 }}
                          onChange={(e) => patchRow(i, { override: e.target.checked, ...(e.target.checked ? {} : { itemId: r.mentionedItemIds.includes(r.itemId) ? r.itemId : GENERAL }) })} />
                        {ar ? 'إسناد حر' : 'Free override'}
                      </label>
                    </div>
                    {offMention && (
                      <p className="rvw-warn"><Icon name="warning" size={13} /> {ar ? 'هذا التقييم لا يذكر الصنف — إسناده إليه تضليل للعملاء' : 'This review does not mention that item — attaching it is misleading to customers'}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ---- already imported ---- */}
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <div className="row-between wrap" style={{ gap: 8 }}>
          <strong className="small">{ar ? `المستوردة سابقاً (${(imported || []).length})` : `Imported (${(imported || []).length})`}</strong>
          <select className="input" style={{ maxWidth: 220, paddingBlock: 6 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">{ar ? 'الكل' : 'All'}</option>
            <option value="general">{ar ? 'عام (المنشأة)' : 'General (venue)'}</option>
            {importedItemIds.map((id) => <option key={id} value={id}>{itemName(id)}</option>)}
          </select>
        </div>
        {imported === null ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <Empty icon="star" title={ar ? 'لا توجد تقييمات مستوردة' : 'No imported reviews'} />
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {filtered.map((rv) => (
              <div key={rv.id} className="rvw-row">
                <div className="grow stack" style={{ gap: 4, minWidth: 0 }}>
                  <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                    <strong className="small">{rv.authorName || rv.name || (ar ? 'بدون اسم' : 'No name')}</strong>
                    <Stars value={rv.rating} size={14} />
                    <span className="rvw-src-badge">{ar ? 'من تقييمات جوجل' : 'From Google reviews'}</span>
                    <span className="badge">{rv.itemId ? itemName(rv.itemId) : (ar ? 'عام' : 'General')}</span>
                  </div>
                  {rv.comment && <p className="small muted" style={{ margin: 0 }}>{rv.comment}</p>}
                </div>
                <button className="icon-btn" title={ar ? 'حذف' : 'Delete'} style={{ color: 'var(--danger)', flex: 'none' }} onClick={() => remove(rv)}>
                  <Icon name="delete" size={17} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
