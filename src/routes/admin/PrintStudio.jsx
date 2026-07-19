import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, doc, onSnapshot, query, orderBy, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase.js'
import { useAuth } from '../../lib/auth.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchItems } from '../../lib/db.js'
import { uploadImage } from '../../lib/storage.js'
import { FONT_OPTIONS, loadFont } from '../../lib/skins.js'
import { resolveTenantTheme } from '../../lib/themes.js'
import { qrDataUrl, menuUrl } from '../../lib/qr.js'
import { PRINT_SHAPES, SHAPE_CATS, renderShapeSvg } from '../../lib/printShapes.js'
import { generatePostImage, cleanCaption } from '../../lib/postGen.js'
import { aiQuick } from '../../lib/aiBridge.js'
import PrintCanvas from '../../components/PrintCanvas.jsx'
import { exportDesignPng, downloadBlob } from '../../components/print/exportPng.js'
import MediaLibrary from '../../components/MediaLibrary.jsx'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'

// ================= FREE-FORM PRINT DESIGN STUDIO =================
// «تصاميم لامحدودة بأشكال لامحدودة» — a real canvas editor: the manager designs
// menus/posters/stories freely on a true-size page (text, images, 88 shapes,
// QR, live item cards), with drag/resize/rotate/snap, undo/redo, AI assists
// (generate image / background / copy suggestions via the SAME postGen+aiQuick
// pipeline the rest of the system uses), then exports print-faithful PDF (the
// canvas DOM itself prints at true size) or a native 2x PNG rasterization.
// Designs persist in tenants/{tid}/printDesigns/{id}.

const PAGE_PRESETS = [
  { id: 'A4', ar: 'A4 عمودي', w: 794, h: 1123 },
  { id: 'A5', ar: 'A5', w: 559, h: 794 },
  { id: 'A3', ar: 'A3', w: 1123, h: 1587 },
  { id: 'square', ar: 'مربع (منشور)', w: 1080, h: 1080 },
  { id: 'story', ar: 'ستوري (طولي)', w: 1080, h: 1920 },
]

const TEXT_PRESETS = [
  { ar: 'عنوان رئيسي', size: 44, weight: 800 },
  { ar: 'عنوان فرعي', size: 26, weight: 700 },
  { ar: 'نص عادي', size: 16, weight: 400 },
]

const WEIGHTS = [['400', 'عادي'], ['500', 'متوسط'], ['700', 'عريض'], ['800', 'أعرض'], ['900', 'أسود']]

const uid = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

const fmtWhen = (ts) => {
  const d = ts?.toDate?.() || (ts instanceof Date ? ts : null)
  if (!d) return ''
  return d.toLocaleDateString('ar-SA-u-nu-latn', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
}

export default function PrintStudio() {
  const { tenantId, tenant } = useAuth()
  const toast = useToast()
  const brand = resolveTenantTheme(tenant).brand || '#7c2d2d'
  const currency = tenant?.currency || 'SAR'

  // ---------- data ----------
  const [designs, setDesigns] = useState(null)
  const [items, setItems] = useState([])
  const [qrSrc, setQrSrc] = useState('')

  // ---------- editor state ----------
  const [design, setDesign] = useState(null) // null = gallery
  const [dirty, setDirty] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [zoom, setZoom] = useState('fit')
  const [curScale, setCurScale] = useState(0.5)
  const [tab, setTab] = useState('shapes')
  const [shapeCat, setShapeCat] = useState('all')
  const [shapeQuery, setShapeQuery] = useState('')
  const [itemQuery, setItemQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [mediaOpen, setMediaOpen] = useState(null) // 'insert' | 'bg' | 'replace'
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [panelSheet, setPanelSheet] = useState(null) // narrow screens: 'lib' | 'props'
  // AI
  const [aiImgPrompt, setAiImgPrompt] = useState('')
  const [aiImgBusy, setAiImgBusy] = useState(false)
  const [aiBgPrompt, setAiBgPrompt] = useState('')
  const [aiBgBusy, setAiBgBusy] = useState(false)
  const [aiSuggest, setAiSuggest] = useState(null)
  const [aiSuggestBusy, setAiSuggestBusy] = useState(false)

  const designRef = useRef(null)
  const selectedIdRef = useRef(null)
  const historyRef = useRef({ stack: [], idx: -1 })
  const [histVer, setHistVer] = useState(0) // re-render for undo/redo disabled states
  useEffect(() => { designRef.current = design }, [design])
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])

  // ---------- firestore ----------
  useEffect(() => {
    if (!tenantId) return
    const q = query(collection(db, 'tenants', tenantId, 'printDesigns'), orderBy('updatedAt', 'desc'))
    return onSnapshot(q, (s) => setDesigns(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setDesigns([]))
  }, [tenantId])
  useEffect(() => {
    if (!tenantId) return
    return watchItems(tenantId, setItems)
  }, [tenantId])
  useEffect(() => {
    if (!tenant?.slug) return
    qrDataUrl(menuUrl(tenant.slug), { width: 512 }).then(setQrSrc).catch(() => {})
  }, [tenant?.slug])

  // fonts for the editor
  useEffect(() => { loadFont('tajawal'); loadFont('cairo') }, [])
  useEffect(() => {
    for (const el of design?.elements || []) if (el.type === 'text' && el.fontKey) loadFont(el.fontKey)
  }, [design?.id])

  // print engine: page-true @page + body flag while the editor is open
  useEffect(() => {
    if (!design) return
    document.body.classList.add('ps-print')
    let el = document.getElementById('ps-page-style')
    if (!el) { el = document.createElement('style'); el.id = 'ps-page-style'; document.head.appendChild(el) }
    el.textContent = `@page { size: ${design.page.w}px ${design.page.h}px; margin: 0; }`
    return () => { document.body.classList.remove('ps-print'); el.remove() }
  }, [design?.page?.w, design?.page?.h, !!design])

  // ---------- history ----------
  const pushHistory = useCallback((d) => {
    const h = historyRef.current
    h.stack = h.stack.slice(0, h.idx + 1)
    h.stack.push(JSON.stringify(d))
    if (h.stack.length > 50) h.stack.shift()
    h.idx = h.stack.length - 1
    setHistVer((v) => v + 1)
  }, [])

  const change = useCallback((next, record = true) => {
    setDesign(next)
    designRef.current = next
    setDirty(true)
    if (record) pushHistory(next)
  }, [pushHistory])

  const undo = useCallback(() => {
    const h = historyRef.current
    if (h.idx <= 0) return
    h.idx -= 1
    const d = JSON.parse(h.stack[h.idx])
    setDesign(d); designRef.current = d; setDirty(true); setHistVer((v) => v + 1)
  }, [])
  const redo = useCallback(() => {
    const h = historyRef.current
    if (h.idx >= h.stack.length - 1) return
    h.idx += 1
    const d = JSON.parse(h.stack[h.idx])
    setDesign(d); designRef.current = d; setDirty(true); setHistVer((v) => v + 1)
  }, [])

  // ---------- element ops ----------
  const patchEl = useCallback((id, patch, record = false) => {
    const d = designRef.current
    if (!d) return
    const next = { ...d, elements: d.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }
    change(next, record)
  }, [change])

  const commit = useCallback(() => { if (designRef.current) pushHistory(designRef.current) }, [pushHistory])

  const addElement = useCallback((partial) => {
    const d = designRef.current
    if (!d) return
    const w = partial.w || 140, h = partial.h || 140
    const maxZ = d.elements.reduce((m, e) => Math.max(m, e.z || 0), 0)
    const el = {
      id: uid(),
      x: Math.round((d.page.w - w) / 2), y: Math.round((d.page.h - h) / 2),
      rotate: 0, opacity: 1, z: maxZ + 1, locked: false,
      ...partial, w, h,
    }
    change({ ...d, elements: [...d.elements, el] })
    setSelectedId(el.id)
    setPanelSheet(null)
  }, [change])

  const selected = useMemo(() => design?.elements.find((e) => e.id === selectedId) || null, [design, selectedId])

  const deleteSel = useCallback(() => {
    const d = designRef.current, id = selectedIdRef.current
    if (!d || !id) return
    change({ ...d, elements: d.elements.filter((e) => e.id !== id) })
    setSelectedId(null)
  }, [change])

  const duplicateSel = useCallback(() => {
    const d = designRef.current, id = selectedIdRef.current
    const el = d?.elements.find((e) => e.id === id)
    if (!el) return
    const maxZ = d.elements.reduce((m, e) => Math.max(m, e.z || 0), 0)
    const copy = { ...el, id: uid(), x: el.x + 18, y: el.y + 18, z: maxZ + 1 }
    change({ ...d, elements: [...d.elements, copy] })
    setSelectedId(copy.id)
  }, [change])

  const nudge = useCallback(([dx, dy]) => {
    const d = designRef.current, id = selectedIdRef.current
    const el = d?.elements.find((e) => e.id === id)
    if (!el || el.locked) return
    patchEl(id, { x: el.x + dx, y: el.y + dy }, true)
  }, [patchEl])

  const zMove = useCallback((dir) => {
    const d = designRef.current, id = selectedIdRef.current
    if (!d || !id) return
    const sorted = [...d.elements].sort((a, b) => (a.z || 0) - (b.z || 0))
    const i = sorted.findIndex((e) => e.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= sorted.length) return
    const ids = sorted.map((e) => e.id)
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    const zmap = new Map(ids.map((eid, idx) => [eid, idx]))
    change({ ...d, elements: d.elements.map((e) => ({ ...e, z: zmap.get(e.id) })) })
  }, [change])

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      if (!designRef.current) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return }
      if (!selectedIdRef.current) return
      if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicateSel(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return }
      const step = e.shiftKey ? 10 : 1
      const dm = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
      if (dm) { e.preventDefault(); nudge(dm) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, duplicateSel, deleteSel, nudge])

  // ---------- open / create / save ----------
  const openDesign = (d) => {
    const clean = JSON.parse(JSON.stringify({ id: d.id, name: d.name || 'تصميم', page: d.page, elements: d.elements || [] }))
    setDesign(clean)
    designRef.current = clean
    historyRef.current = { stack: [JSON.stringify(clean)], idx: 0 }
    setDirty(false); setSelectedId(null); setZoom('fit'); setTab('shapes'); setAiSuggest(null)
  }

  const newDesign = (preset) => {
    const id = doc(collection(db, 'tenants', tenantId, 'printDesigns')).id
    const d = {
      id, name: 'تصميم جديد',
      page: { preset: preset.id, w: preset.w, h: preset.h, bgColor: '#ffffff', bgImageUrl: '', bgOpacity: 1 },
      elements: [{
        id: uid(), type: 'text', text: tenant?.name || 'اسم المنشأة',
        fontKey: 'cairo', size: 40, weight: 800, color: brand, align: 'center',
        lineHeight: 1.3, letterSpacing: 0, dir: 'rtl',
        x: Math.round(preset.w * 0.1), y: Math.round(preset.h * 0.07),
        w: Math.round(preset.w * 0.8), h: 72, rotate: 0, opacity: 1, z: 1, locked: false,
      }],
    }
    setCreating(false)
    openDesign(d)
    setDirty(true)
  }

  const save = async () => {
    const d = designRef.current
    if (!d || saving) return
    setSaving(true)
    try {
      const data = JSON.parse(JSON.stringify(d))
      await setDoc(doc(db, 'tenants', tenantId, 'printDesigns', d.id), { ...data, updatedAt: serverTimestamp() })
      setDirty(false)
      toast.success('تم حفظ التصميم')
    } catch (e) {
      toast.error('تعذر الحفظ: ' + String(e?.message || e))
    } finally { setSaving(false) }
  }

  const closeEditor = () => {
    if (dirty && !window.confirm('لديك تغييرات غير محفوظة — الخروج بدون حفظ؟')) return
    setDesign(null); designRef.current = null; setSelectedId(null)
  }

  const duplicateDesign = async (d) => {
    try {
      const id = doc(collection(db, 'tenants', tenantId, 'printDesigns')).id
      const copy = JSON.parse(JSON.stringify({ id, name: `${d.name || 'تصميم'} (نسخة)`, page: d.page, elements: d.elements || [] }))
      await setDoc(doc(db, 'tenants', tenantId, 'printDesigns', id), { ...copy, updatedAt: serverTimestamp() })
      toast.success('تم النسخ')
    } catch (e) { toast.error('تعذر النسخ: ' + String(e?.message || e)) }
  }
  const deleteDesign = async (d) => {
    if (!window.confirm(`حذف «${d.name || 'التصميم'}» نهائياً؟`)) return
    try { await deleteDoc(doc(db, 'tenants', tenantId, 'printDesigns', d.id)) } catch (e) { toast.error('تعذر الحذف: ' + String(e?.message || e)) }
  }

  // ---------- export ----------
  const doPrint = () => {
    setSelectedId(null)
    setTimeout(() => window.print(), 80)
  }
  const doPng = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const { blob, skipped } = await exportDesignPng({ design: designRef.current, items, currency, qrSrc, scale: 2 })
      downloadBlob(blob, `${(designRef.current.name || 'design').replace(/[\\/:*?"<>|]/g, '')}.png`)
      if (skipped.length) toast.error('نزلت الصورة لكن تعذر رسم: ' + skipped.join('، '))
      else toast.success('تم تنزيل الصورة PNG')
    } catch (e) {
      toast.error(String(e?.message || e))
    } finally { setExporting(false) }
  }

  // ---------- AI assists ----------
  const genAiImage = async (forBg) => {
    const prompt = (forBg ? aiBgPrompt : aiImgPrompt).trim()
    if (!prompt) { toast.error('اكتب وصف الصورة أولاً'); return }
    const setBusy = forBg ? setAiBgBusy : setAiImgBusy
    setBusy(true)
    try {
      const stylePrompt = forBg
        ? `Elegant printable BACKGROUND for a restaurant menu or poster: ${prompt}. Subtle, low contrast, generous empty space, nothing sharp in the foreground, no text.`
        : prompt
      const blob = await generatePostImage({ stylePrompt, tenant, venueName: tenant?.name || '' })
      const file = new File([blob], `print-ai-${Date.now()}.png`, { type: blob.type || 'image/png' })
      const url = await uploadImage(tenantId, file, 'library')
      const d = designRef.current
      if (forBg) {
        change({ ...d, page: { ...d.page, bgImageUrl: url } })
        toast.success('تم توليد الخلفية وتطبيقها (حُفظت في المكتبة)')
      } else {
        const size = Math.round(Math.min(d.page.w, d.page.h) * 0.42)
        addElement({ type: 'image', url, fit: 'cover', radius: 0, borderW: 0, borderColor: '#1c1c1e', shadow: false, flipH: false, w: size, h: size })
        toast.success('تم توليد الصورة وإدراجها (حُفظت في المكتبة)')
      }
    } catch (e) {
      toast.error(String(e?.message || e))
    } finally { setBusy(false) }
  }

  const suggestText = async () => {
    const el = designRef.current?.elements.find((e) => e.id === selectedIdRef.current)
    if (!el || el.type !== 'text' || aiSuggestBusy) return
    setAiSuggestBusy(true)
    setAiSuggest(null)
    try {
      const kind = (el.size || 18) >= 30 ? 'عنوان رئيسي' : (el.size || 18) >= 21 ? 'عنوان فرعي' : 'نص وصفي قصير'
      const p = [
        `أنت كاتب محتوى عربي محترف لمنشأة ضيافة اسمها "${tenant?.name || 'منشأتنا'}".`,
        `داخل تصميم مطبوع (منيو أو بوستر) يوجد ${kind} نصه الحالي: "${el.text || '(فارغ)'}".`,
        'اقترح بديلاً أقوى وأجمل بنفس الغرض وبطول مقارب.',
        'أجب بالنص المقترح فقط دون أي شرح أو علامات اقتباس.',
        'ممنوع الرموز التعبيرية نهائياً، والأرقام لاتينية فقط.',
      ].join(' ')
      const out = cleanCaption(await aiQuick(p))
      if (!out) throw new Error('لم يصل اقتراح — أعد المحاولة')
      setAiSuggest(out)
    } catch (e) {
      toast.error(String(e?.message || e))
    } finally { setAiSuggestBusy(false) }
  }

  // ---------- insert helpers ----------
  const addImageEl = (url) => {
    const d = designRef.current
    const size = Math.round(Math.min(d.page.w, d.page.h) * 0.42)
    addElement({ type: 'image', url, fit: 'cover', radius: 0, borderW: 0, borderColor: '#1c1c1e', shadow: false, flipH: false, w: size, h: size })
  }
  const addShape = (sh) => {
    const d = designRef.current
    const isDiv = sh.cat === 'divider' || sh.id === 'arab-band' || sh.id === 'ribbon-banner'
    const isFrame = sh.cat === 'frame'
    const w = isDiv ? Math.round(d.page.w * 0.6) : isFrame ? Math.round(d.page.w * 0.55) : 150
    const h = isDiv ? 34 : isFrame ? Math.round(d.page.h * 0.4) : 150
    addElement({ type: 'shape', shapeId: sh.id, fill: brand, stroke: '', strokeW: 0, w, h })
  }
  const addText = (p) => {
    const d = designRef.current
    addElement({
      type: 'text', text: p.ar, fontKey: 'tajawal', size: p.size, weight: p.weight,
      color: '#1c1c1e', align: 'center', lineHeight: 1.4, letterSpacing: 0, dir: 'rtl',
      w: Math.min(Math.round(d.page.w * 0.72), 480), h: Math.round(p.size * 1.7),
    })
  }
  const addQr = () => addElement({ type: 'qr', kind: 'menu', size: 140, w: 140, h: 140 })
  const addItemCard = (it) => addElement({ type: 'itemcard', itemId: it.id, showPrice: true, showDesc: false, layout: 'h', w: 280, h: 92 })

  const uploadRef = useRef(null)
  const bgUploadRef = useRef(null)
  const onUpload = async (e, forBg) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const url = await uploadImage(tenantId, file, 'library')
      if (forBg) { const d = designRef.current; change({ ...d, page: { ...d.page, bgImageUrl: url } }) }
      else addImageEl(url)
    } catch (err) { toast.error(String(err?.message || err)) }
  }

  const changePage = (patch, record = true) => {
    const d = designRef.current
    change({ ...d, page: { ...d.page, ...patch } }, record)
  }

  // slider pattern: live patch while dragging + one history entry on release
  const slider = (value, onLive, { min, max, step = 1 }) => (
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onLive(Number(e.target.value))}
      onPointerUp={commit}
    />
  )

  const filteredShapes = useMemo(() => PRINT_SHAPES.filter((s) =>
    (shapeCat === 'all' || s.cat === shapeCat)
    && (!shapeQuery.trim() || s.ar.includes(shapeQuery.trim()))
  ), [shapeCat, shapeQuery])

  const filteredItems = useMemo(() => (items || []).filter((it) =>
    !it.archived && (!itemQuery.trim() || (it.nameAr || '').includes(itemQuery.trim()) || (it.nameEn || '').toLowerCase().includes(itemQuery.trim().toLowerCase()))
  ), [items, itemQuery])

  const h = historyRef.current
  const canUndo = h.idx > 0
  const canRedo = h.idx < h.stack.length - 1
  void histVer

  // ============================ GALLERY ============================
  if (!design) {
    return (
      <div className="page ps-root">
        <div className="row" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <Link to="/admin/print-menu" className="icon-btn" aria-label="رجوع"><Icon name="back" size={18} /></Link>
          <div className="stack" style={{ gap: 2 }}>
            <strong style={{ fontSize: 'var(--fs-md)' }}>استوديو التصميم الحر</strong>
            <span className="xs faint">تصاميم لامحدودة بأشكال لامحدودة — منيوهات، بوسترات، منشورات وستوري للطباعة والنشر</span>
          </div>
          <div className="grow" />
          <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}><Icon name="add" size={16} /> تصميم جديد</button>
        </div>

        {creating && (
          <div className="card ps-presets">
            <strong className="xs faint">اختر مقاس الصفحة</strong>
            <div className="ps-presets-row">
              {PAGE_PRESETS.map((p) => (
                <button key={p.id} className="ps-preset" onClick={() => newDesign(p)}>
                  <span className="ps-preset-box" style={{ aspectRatio: `${p.w} / ${p.h}` }} />
                  <span className="xs">{p.ar}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {designs === null ? <Spinner /> : designs.length === 0 && !creating ? (
          <Empty
            icon="shapes"
            title="لا توجد تصاميم بعد"
            hint="ابدأ أول تصميم حر — صفحة بيضاء وشكّلها كما تريد"
            action={<button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="add" size={15} /> تصميم جديد</button>}
          />
        ) : (
          <div className="ps-gallery">
            {designs.map((d) => (
              <div key={d.id} className="card ps-dcard" role="button" tabIndex={0} onClick={() => openDesign(d)}>
                <div className="ps-dthumb" style={{ aspectRatio: `${d.page?.w || 794} / ${d.page?.h || 1123}`, background: d.page?.bgColor || '#fff' }}>
                  {d.page?.bgImageUrl ? <img src={d.page.bgImageUrl} alt="" style={{ opacity: d.page?.bgOpacity ?? 1 }} /> : null}
                  <span className="ps-dcount xs">{(d.elements || []).length} عنصر</span>
                </div>
                <div className="ps-dmeta">
                  <strong className="small ps-dname">{d.name || 'تصميم'}</strong>
                  <span className="xs faint">{fmtWhen(d.updatedAt)}</span>
                </div>
                <div className="ps-dacts" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn" title="نسخ" onClick={() => duplicateDesign(d)}><Icon name="copy" size={14} /></button>
                  <button className="icon-btn" title="حذف" onClick={() => deleteDesign(d)}><Icon name="delete" size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ============================ EDITOR ============================
  const page = design.page

  return (
    <div className="page ps-root ps-edit-root">
      {/* -------- toolbar -------- */}
      <div className="ps-toolbar no-print">
        <button className="icon-btn" onClick={closeEditor} aria-label="رجوع"><Icon name="back" size={17} /></button>
        <input
          className="input input-sm ps-name" value={design.name}
          onChange={(e) => change({ ...design, name: e.target.value }, false)}
          onBlur={commit}
          placeholder="اسم التصميم"
        />
        <span className="ps-tools-sep" />
        <button className="icon-btn" disabled={!canUndo} onClick={undo} title="تراجع (Ctrl+Z)"><Icon name="undo" size={16} /></button>
        <button className="icon-btn ps-flip" disabled={!canRedo} onClick={redo} title="إعادة (Ctrl+Y)"><Icon name="undo" size={16} /></button>
        <span className="ps-tools-sep" />
        <div className="ps-zoom">
          <button className="icon-btn" onClick={() => setZoom(Math.max(0.25, Math.round((curScale - 0.15) * 20) / 20))} title="تصغير"><Icon name="minus" size={14} /></button>
          <span className="xs num">{Math.round(curScale * 100)}%</span>
          <button className="icon-btn" onClick={() => setZoom(Math.min(2, Math.round((curScale + 0.15) * 20) / 20))} title="تكبير"><Icon name="add" size={14} /></button>
          <button className={`btn btn-sm ${zoom === 'fit' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setZoom('fit')}>ملاءمة</button>
        </div>
        <div className="grow" />
        <button className="btn btn-sm btn-outline ps-sheet-toggle" onClick={() => setPanelSheet(panelSheet === 'lib' ? null : 'lib')}><Icon name="shapes" size={14} /> العناصر</button>
        <button className="btn btn-sm btn-outline ps-sheet-toggle" onClick={() => setPanelSheet(panelSheet === 'props' ? null : 'props')}><Icon name="settings" size={14} /> الخصائص</button>
        <button className="btn btn-sm btn-outline" disabled={saving} onClick={save}>
          <Icon name="check" size={14} /> {saving ? 'يحفظ...' : dirty ? 'حفظ *' : 'حفظ'}
        </button>
        <button className="btn btn-sm btn-outline" onClick={doPrint}><Icon name="print" size={14} /> طباعة / PDF</button>
        <button className="btn btn-sm ps-export-btn" disabled={exporting} onClick={doPng}>
          <Icon name="download" size={14} /> {exporting ? 'يصدّر...' : 'تصدير PNG'}
        </button>
      </div>

      <div className="ps-editor">
        {/* -------- library panel (right side in RTL) -------- */}
        <aside className={`ps-panel ps-lib no-print ${panelSheet === 'lib' ? 'open' : ''}`}>
          <div className="ps-tabs">
            {[['shapes', 'العناصر', 'shapes'], ['text', 'النصوص', 'text'], ['images', 'الصور', 'image'], ['items', 'الأصناف', 'menu'], ['page', 'الصفحة', 'layers']].map(([id, ar, icon]) => (
              <button key={id} className={`ps-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                <Icon name={icon} size={15} /><span>{ar}</span>
              </button>
            ))}
          </div>

          {tab === 'shapes' && (
            <div className="ps-tabbody">
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-outline" style={{ flex: 1 }} onClick={addQr}><Icon name="qr" size={14} /> رمز QR للمنيو</button>
              </div>
              <input className="input input-sm" placeholder="ابحث عن شكل..." value={shapeQuery} onChange={(e) => setShapeQuery(e.target.value)} />
              <div className="ps-chips">
                <button className={`chip ${shapeCat === 'all' ? 'active' : ''}`} onClick={() => setShapeCat('all')}>الكل</button>
                {SHAPE_CATS.map((c) => (
                  <button key={c.id} className={`chip ${shapeCat === c.id ? 'active' : ''}`} onClick={() => setShapeCat(c.id)}>{c.ar}</button>
                ))}
              </div>
              <div className="ps-shapes-grid">
                {filteredShapes.map((sh) => (
                  <button key={sh.id} className="ps-shape-btn" title={sh.ar} onClick={() => addShape(sh)}
                    dangerouslySetInnerHTML={{ __html: renderShapeSvg(sh, { fill: 'currentColor' }) }} />
                ))}
              </div>
              {filteredShapes.length === 0 ? <p className="xs faint" style={{ textAlign: 'center' }}>لا نتائج</p> : null}
            </div>
          )}

          {tab === 'text' && (
            <div className="ps-tabbody">
              {TEXT_PRESETS.map((p) => (
                <button key={p.ar} className="ps-textpreset" style={{ fontSize: Math.min(p.size, 26), fontWeight: p.weight }} onClick={() => addText(p)}>
                  {p.ar}
                </button>
              ))}
              <button className="btn btn-sm btn-outline" onClick={() => addText({ ar: tenant?.name || 'اسم المنشأة', size: 34, weight: 800 })}>
                <Icon name="store" size={14} /> اسم المنشأة
              </button>
              <p className="xs faint">انقر نقرة مزدوجة على أي نص في اللوحة لتحريره مباشرة</p>
            </div>
          )}

          {tab === 'images' && (
            <div className="ps-tabbody">
              <button className="btn btn-sm btn-primary" onClick={() => uploadRef.current?.click()}><Icon name="upload" size={14} /> رفع صورة</button>
              <input ref={uploadRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onUpload(e, false)} />
              <button className="btn btn-sm btn-outline" onClick={() => setMediaOpen('insert')}><Icon name="image" size={14} /> من المكتبة</button>
              <div className="ps-ai-box">
                <strong className="xs"><Icon name="sparkles" size={13} /> توليد بالذكاء</strong>
                <textarea className="input input-sm" rows={2} placeholder="صف الصورة... مثال: كوب قهوة مختصة بجانب حبوب بن على رخام" value={aiImgPrompt} onChange={(e) => setAiImgPrompt(e.target.value)} />
                <button className="btn btn-sm ps-ai-btn" disabled={aiImgBusy} onClick={() => genAiImage(false)}>
                  <Icon name="sparkles" size={14} /> {aiImgBusy ? 'يولّد الصورة...' : 'ولّد صورة'}
                </button>
              </div>
            </div>
          )}

          {tab === 'items' && (
            <div className="ps-tabbody">
              <input className="input input-sm" placeholder="ابحث عن صنف..." value={itemQuery} onChange={(e) => setItemQuery(e.target.value)} />
              <div className="ps-items-list">
                {filteredItems.map((it) => (
                  <button key={it.id} className="ps-item-row" onClick={() => addItemCard(it)}>
                    {it.imageUrl ? <img src={it.imageUrl} alt="" /> : <span className="ps-item-noimg"><Icon name="coffee" size={14} /></span>}
                    <span className="small ps-item-name">{it.nameAr || it.nameEn}</span>
                    <span className="xs faint num">{Number(it.price) || ''}</span>
                  </button>
                ))}
                {filteredItems.length === 0 ? <p className="xs faint" style={{ textAlign: 'center' }}>لا أصناف</p> : null}
              </div>
              <p className="xs faint">بطاقة الصنف تعرض الاسم والسعر والصورة الحية من المنيو</p>
            </div>
          )}

          {tab === 'page' && (
            <div className="ps-tabbody">
              <strong className="xs faint">مقاس الصفحة</strong>
              <div className="ps-chips">
                {PAGE_PRESETS.map((p) => (
                  <button key={p.id} className={`chip ${page.preset === p.id ? 'active' : ''}`}
                    onClick={() => changePage({ preset: p.id, w: p.w, h: p.h })}>{p.ar}</button>
                ))}
              </div>
              <label className="ps-field"><span>لون الخلفية</span>
                <input type="color" value={page.bgColor || '#ffffff'} onChange={(e) => changePage({ bgColor: e.target.value }, false)} onBlur={commit} />
              </label>
              <strong className="xs faint">صورة الخلفية</strong>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-sm btn-outline" onClick={() => bgUploadRef.current?.click()}><Icon name="upload" size={13} /> رفع</button>
                <input ref={bgUploadRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onUpload(e, true)} />
                <button className="btn btn-sm btn-outline" onClick={() => setMediaOpen('bg')}><Icon name="image" size={13} /> من المكتبة</button>
                {page.bgImageUrl ? <button className="btn btn-sm btn-outline" onClick={() => changePage({ bgImageUrl: '' })}><Icon name="close" size={13} /> إزالة</button> : null}
              </div>
              {page.bgImageUrl ? (
                <label className="ps-field"><span>شفافية الخلفية</span>
                  {slider(page.bgOpacity ?? 1, (v) => changePage({ bgOpacity: v }, false), { min: 0.05, max: 1, step: 0.05 })}
                </label>
              ) : null}
              <div className="ps-ai-box">
                <strong className="xs"><Icon name="sparkles" size={13} /> ولّد خلفية بالذكاء</strong>
                <textarea className="input input-sm" rows={2} placeholder="صف الخلفية... مثال: رخام فاتح مع ظلال نباتات ناعمة" value={aiBgPrompt} onChange={(e) => setAiBgPrompt(e.target.value)} />
                <button className="btn btn-sm ps-ai-btn" disabled={aiBgBusy} onClick={() => genAiImage(true)}>
                  <Icon name="sparkles" size={14} /> {aiBgBusy ? 'يولّد الخلفية...' : 'ولّد خلفية'}
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* -------- canvas -------- */}
        <div className="ps-canvas-wrap">
          <PrintCanvas
            design={design}
            items={items}
            currency={currency}
            qrSrc={qrSrc}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onPatch={(id, patch) => patchEl(id, patch, false)}
            onCommit={commit}
            zoom={zoom}
            onScale={setCurScale}
          />
        </div>

        {/* -------- properties panel (left side in RTL) -------- */}
        <aside className={`ps-panel ps-props no-print ${panelSheet === 'props' ? 'open' : ''}`}>
          {!selected ? (
            <div className="ps-tabbody">
              <p className="xs faint" style={{ lineHeight: 1.7 }}>
                اختر عنصراً من اللوحة لتعديل خصائصه.
                <br />اسحب للتحريك، والمقابض للتحجيم والتدوير، والأسهم للتحريك الدقيق (Shift أسرع)، وDelete للحذف.
              </p>
            </div>
          ) : (
            <div className="ps-tabbody" key={selected.id}>
              <div className="row" style={{ alignItems: 'center', gap: 6 }}>
                <strong className="small">
                  {selected.type === 'text' ? 'نص' : selected.type === 'image' ? 'صورة' : selected.type === 'shape' ? 'شكل' : selected.type === 'qr' ? 'رمز QR' : 'بطاقة صنف'}
                </strong>
                <div className="grow" />
                <button className={`icon-btn ${selected.locked ? 'is-on' : ''}`} title={selected.locked ? 'فك القفل' : 'قفل'} onClick={() => patchEl(selected.id, { locked: !selected.locked }, true)}><Icon name="lock" size={14} /></button>
                <button className="icon-btn" title="تكرار (Ctrl+D)" onClick={duplicateSel}><Icon name="copy" size={14} /></button>
                <button className="icon-btn" title="حذف" onClick={deleteSel}><Icon name="delete" size={14} /></button>
              </div>

              <div className="ps-xywh">
                {[['x', 'س'], ['y', 'ص'], ['w', 'عرض'], ['h', 'طول']].map(([k, ar]) => (
                  <label key={k}><span className="xs faint">{ar}</span>
                    <input className="input input-sm num" type="number" value={Math.round(selected[k])}
                      onChange={(e) => patchEl(selected.id, { [k]: Number(e.target.value) || 0 }, false)} onBlur={commit} />
                  </label>
                ))}
              </div>
              <label className="ps-field"><span>تدوير ({selected.rotate || 0} درجة)</span>
                {slider(selected.rotate || 0, (v) => patchEl(selected.id, { rotate: v }), { min: 0, max: 359 })}
              </label>
              <label className="ps-field"><span>الشفافية</span>
                {slider(selected.opacity ?? 1, (v) => patchEl(selected.id, { opacity: v }), { min: 0.05, max: 1, step: 0.05 })}
              </label>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-outline" style={{ flex: 1 }} onClick={() => zMove(1)}>أعلى طبقة</button>
                <button className="btn btn-sm btn-outline" style={{ flex: 1 }} onClick={() => zMove(-1)}>أسفل طبقة</button>
              </div>

              {selected.type === 'text' && (
                <>
                  <textarea className="input input-sm" rows={3} value={selected.text || ''}
                    onChange={(e) => patchEl(selected.id, { text: e.target.value })} onBlur={commit} />
                  <label className="ps-field"><span>الخط</span>
                    <select className="select" value={selected.fontKey || 'tajawal'}
                      onChange={(e) => { loadFont(e.target.value); patchEl(selected.id, { fontKey: e.target.value }, true) }}>
                      {FONT_OPTIONS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </label>
                  <label className="ps-field"><span>الحجم ({selected.size || 18})</span>
                    {slider(selected.size || 18, (v) => patchEl(selected.id, { size: v }), { min: 8, max: 140 })}
                  </label>
                  <label className="ps-field"><span>الوزن</span>
                    <select className="select" value={String(selected.weight || 400)} onChange={(e) => patchEl(selected.id, { weight: Number(e.target.value) }, true)}>
                      {WEIGHTS.map(([v, ar]) => <option key={v} value={v}>{ar}</option>)}
                    </select>
                  </label>
                  <label className="ps-field"><span>اللون</span>
                    <input type="color" value={selected.color || '#1c1c1e'} onChange={(e) => patchEl(selected.id, { color: e.target.value })} onBlur={commit} />
                  </label>
                  <div className="row" style={{ gap: 4 }}>
                    {[['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']].map(([v, ar]) => (
                      <button key={v} className={`btn btn-sm ${(selected.align || 'right') === v ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }} onClick={() => patchEl(selected.id, { align: v }, true)}>{ar}</button>
                    ))}
                  </div>
                  <label className="ps-field"><span>ارتفاع السطر</span>
                    {slider(selected.lineHeight || 1.4, (v) => patchEl(selected.id, { lineHeight: v }), { min: 1, max: 2.4, step: 0.05 })}
                  </label>
                  <label className="ps-field"><span>تباعد الأحرف</span>
                    {slider(selected.letterSpacing || 0, (v) => patchEl(selected.id, { letterSpacing: v }), { min: 0, max: 14, step: 0.5 })}
                  </label>
                  <div className="row" style={{ gap: 4 }}>
                    {[['rtl', 'عربي RTL'], ['ltr', 'لاتيني LTR']].map(([v, ar]) => (
                      <button key={v} className={`btn btn-sm ${(selected.dir || 'rtl') === v ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }} onClick={() => patchEl(selected.id, { dir: v }, true)}>{ar}</button>
                    ))}
                  </div>
                  <button className="btn btn-sm ps-ai-btn" disabled={aiSuggestBusy} onClick={suggestText}>
                    <Icon name="sparkles" size={14} /> {aiSuggestBusy ? 'يفكر...' : 'اقترح نصاً'}
                  </button>
                  {aiSuggest ? (
                    <div className="ps-suggest">
                      <p className="small" style={{ margin: 0, lineHeight: 1.6 }}>{aiSuggest}</p>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn btn-sm btn-primary" style={{ flex: 1 }} onClick={() => { patchEl(selected.id, { text: aiSuggest }, true); setAiSuggest(null) }}>اعتماد</button>
                        <button className="btn btn-sm btn-outline" style={{ flex: 1 }} onClick={() => setAiSuggest(null)}>تجاهل</button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              {selected.type === 'image' && (
                <>
                  <div className="row" style={{ gap: 4 }}>
                    {[['cover', 'تعبئة'], ['contain', 'احتواء']].map(([v, ar]) => (
                      <button key={v} className={`btn btn-sm ${(selected.fit || 'cover') === v ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }} onClick={() => patchEl(selected.id, { fit: v }, true)}>{ar}</button>
                    ))}
                  </div>
                  <label className="ps-field"><span>استدارة الزوايا</span>
                    {slider(selected.radius || 0, (v) => patchEl(selected.id, { radius: v }), { min: 0, max: 200 })}
                  </label>
                  <label className="ps-field"><span>سماكة الإطار</span>
                    {slider(selected.borderW || 0, (v) => patchEl(selected.id, { borderW: v }), { min: 0, max: 14 })}
                  </label>
                  {selected.borderW ? (
                    <label className="ps-field"><span>لون الإطار</span>
                      <input type="color" value={selected.borderColor || '#1c1c1e'} onChange={(e) => patchEl(selected.id, { borderColor: e.target.value })} onBlur={commit} />
                    </label>
                  ) : null}
                  <label className="ps-check"><input type="checkbox" checked={!!selected.shadow} onChange={(e) => patchEl(selected.id, { shadow: e.target.checked }, true)} /><span>ظل</span></label>
                  <label className="ps-check"><input type="checkbox" checked={!!selected.flipH} onChange={(e) => patchEl(selected.id, { flipH: e.target.checked }, true)} /><span>قلب أفقي</span></label>
                  <button className="btn btn-sm btn-outline" onClick={() => setMediaOpen('replace')}><Icon name="image" size={13} /> استبدال الصورة</button>
                </>
              )}

              {selected.type === 'shape' && (
                <>
                  <label className="ps-field"><span>اللون</span>
                    <input type="color" value={selected.fill || '#1c1c1e'} onChange={(e) => patchEl(selected.id, { fill: e.target.value })} onBlur={commit} />
                  </label>
                  <label className="ps-field"><span>لون الحد (للأشكال المصمتة)</span>
                    <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                      <input type="color" value={selected.stroke || '#1c1c1e'} onChange={(e) => patchEl(selected.id, { stroke: e.target.value })} onBlur={commit} />
                      {selected.stroke ? <button className="icon-btn" title="إزالة الحد" onClick={() => patchEl(selected.id, { stroke: '' }, true)}><Icon name="close" size={13} /></button> : null}
                    </span>
                  </label>
                  <label className="ps-field"><span>سماكة الخط ({selected.strokeW || 'افتراضي'})</span>
                    {slider(selected.strokeW || 0, (v) => patchEl(selected.id, { strokeW: v }), { min: 0, max: 14, step: 0.5 })}
                  </label>
                </>
              )}

              {selected.type === 'qr' && (
                <p className="xs faint" style={{ lineHeight: 1.7 }}>رمز QR حي يقود إلى المنيو الرقمي لمنشأتك. حجّمه من المقابض.</p>
              )}

              {selected.type === 'itemcard' && (
                <>
                  <label className="ps-field"><span>الصنف</span>
                    <select className="select" value={selected.itemId || ''} onChange={(e) => patchEl(selected.id, { itemId: e.target.value }, true)}>
                      {(items || []).filter((it) => !it.archived).map((it) => <option key={it.id} value={it.id}>{it.nameAr || it.nameEn}</option>)}
                    </select>
                  </label>
                  <div className="row" style={{ gap: 4 }}>
                    {[['h', 'أفقي'], ['v', 'عمودي']].map(([v, ar]) => (
                      <button key={v} className={`btn btn-sm ${(selected.layout || 'h') === v ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }} onClick={() => patchEl(selected.id, { layout: v }, true)}>{ar}</button>
                    ))}
                  </div>
                  <label className="ps-check"><input type="checkbox" checked={selected.showPrice !== false} onChange={(e) => patchEl(selected.id, { showPrice: e.target.checked }, true)} /><span>السعر</span></label>
                  <label className="ps-check"><input type="checkbox" checked={!!selected.showDesc} onChange={(e) => patchEl(selected.id, { showDesc: e.target.checked }, true)} /><span>الوصف</span></label>
                </>
              )}
            </div>
          )}
        </aside>
      </div>

      <MediaLibrary
        open={!!mediaOpen}
        onClose={() => setMediaOpen(null)}
        tenantId={tenantId}
        kind="image"
        onPick={(url) => {
          if (mediaOpen === 'bg') changePage({ bgImageUrl: url })
          else if (mediaOpen === 'replace' && selectedIdRef.current) patchEl(selectedIdRef.current, { url }, true)
          else addImageEl(url)
          setMediaOpen(null)
        }}
      />
    </div>
  )
}
