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
import { lex } from '../../lib/venueTypes.js'
import { PRINT_SHAPES, SHAPE_CATS, renderShapeSvg, shapeById } from '../../lib/printShapes.js'
import { generatePostImage, cleanCaption } from '../../lib/postGen.js'
import { aiQuick } from '../../lib/aiBridge.js'
import PrintCanvas, { aabbOf, bboxOfMany } from '../../components/PrintCanvas.jsx'
import { exportDesignPng, downloadBlob } from '../../components/print/exportPng.js'
import MediaLibrary from '../../components/MediaLibrary.jsx'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import '../../styles/printstudio.css'

// ================= FREE-FORM PRINT DESIGN STUDIO =================
// «تصاميم لامحدودة بأشكال لامحدودة» — a real canvas editor: the manager designs
// menus/posters/stories freely on a true-size page (text, images, 88 shapes,
// QR, live item cards), with multi-select, drag/resize/rotate/snap, alignment,
// layers, undo/redo and AI assists (image/background/copy via the SAME
// postGen+aiQuick pipeline the rest of the system uses), then exports a
// print-faithful PDF (the canvas DOM itself prints at true size) or a native
// 2x PNG rasterization. Designs persist in tenants/{tid}/printDesigns/{id}.

// 96dpi: 1mm = 96/25.4 px. Page sizes are stored in CSS px so @page, the DOM
// and the rasterizer all agree without a unit conversion anywhere.
const MM = 96 / 25.4
const mmOf = (px) => Math.round(px / MM)
const pxOfMm = (mm) => Math.round(mm * MM)

const PAGE_PRESETS = [
  { id: 'A4', ar: 'A4 عمودي', w: 794, h: 1123 },
  { id: 'A4L', ar: 'A4 أفقي', w: 1123, h: 794 },
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
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const R = Math.round

const fmtWhen = (ts) => {
  const d = ts?.toDate?.() || (ts instanceof Date ? ts : null)
  if (!d) return ''
  return d.toLocaleDateString('ar-SA-u-nu-latn', { day: 'numeric', month: 'short' })
    + ' ' + d.toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
}

// ---------------------------------------------------------------- templates
// Each build() returns a plain element array laid out PROPORTIONALLY, so the
// same template works on A4, a square post and a story. z is assigned after.
const relSize = (page, f) => Math.max(11, R(Math.min(page.w, page.h) * f))

const mkText = (o) => ({
  type: 'text', fontKey: 'tajawal', align: 'center', lineHeight: 1.35,
  letterSpacing: 0, dir: 'rtl', color: '#1c1c1e', weight: 700, ...o,
})
const mkShape = (o) => ({ type: 'shape', stroke: '', strokeW: 0, ...o })

const TEMPLATES = [
  {
    id: 'blank', ar: 'صفحة فارغة', prev: [],
    build: () => [],
  },
  {
    id: 'header', ar: 'ترويسة وفاصل',
    prev: [[10, 10, 80, 10, 'a'], [26, 25, 48, 4, 'b'], [16, 33, 68, 5, '']],
    build: ({ page, brand, tenant }) => [
      mkText({
        text: tenant?.name || 'اسم المنشأة', size: relSize(page, 0.056), weight: 800, color: brand,
        x: R(page.w * 0.08), y: R(page.h * 0.06), w: R(page.w * 0.84), h: R(page.h * 0.095),
      }),
      mkShape({
        shapeId: 'div-scroll', fill: brand,
        x: R(page.w * 0.26), y: R(page.h * 0.165), w: R(page.w * 0.48), h: R(page.h * 0.035),
      }),
      mkText({
        text: 'وصف قصير يعرّف بالمكان', size: relSize(page, 0.026), weight: 500, color: '#5c5c66',
        x: R(page.w * 0.12), y: R(page.h * 0.215), w: R(page.w * 0.76), h: R(page.h * 0.06),
      }),
    ],
  },
  {
    id: 'poster', ar: 'بوستر عرض',
    prev: [[62, 6, 30, 21, 'a'], [10, 33, 80, 12, 'b'], [20, 49, 60, 5, ''], [38, 68, 24, 24, 'b']],
    build: ({ page, brand, tenant }) => {
      const badge = R(Math.min(page.w, page.h) * 0.26)
      const qr = R(Math.min(page.w, page.h) * 0.22)
      return [
        mkShape({ shapeId: 'burst-sale', fill: brand, x: R(page.w * 0.62), y: R(page.h * 0.05), w: badge, h: badge }),
        mkText({
          text: 'عرض خاص', size: R(badge * 0.2), weight: 900, color: '#ffffff',
          x: R(page.w * 0.62), y: R(page.h * 0.05 + badge * 0.4), w: badge, h: R(badge * 0.24),
        }),
        mkText({
          text: 'اكتب عنوان العرض هنا', size: relSize(page, 0.075), weight: 900, color: brand,
          x: R(page.w * 0.08), y: R(page.h * 0.33), w: R(page.w * 0.84), h: R(page.h * 0.13),
        }),
        mkShape({ shapeId: 'div-taper', fill: brand, x: R(page.w * 0.3), y: R(page.h * 0.47), w: R(page.w * 0.4), h: R(page.h * 0.025) }),
        mkText({
          text: 'تفاصيل العرض وشروطه', size: relSize(page, 0.028), weight: 500, color: '#5c5c66',
          x: R(page.w * 0.12), y: R(page.h * 0.51), w: R(page.w * 0.76), h: R(page.h * 0.06),
        }),
        { type: 'qr', kind: 'menu', x: R((page.w - qr) / 2), y: R(page.h * 0.68), w: qr, h: qr },
        mkText({
          text: `امسح الرمز لتصفح ${tenant?.name || 'المنيو'}`, size: relSize(page, 0.022), weight: 600, color: '#5c5c66',
          x: R(page.w * 0.15), y: R(page.h * 0.68 + qr + page.h * 0.012), w: R(page.w * 0.7), h: R(page.h * 0.04),
        }),
      ]
    },
  },
  {
    id: 'menu', ar: 'قائمة أصناف', needsItems: true,
    prev: [[14, 8, 72, 9, 'a'], [12, 24, 76, 11, ''], [12, 38, 76, 11, ''], [12, 52, 76, 11, ''], [12, 66, 76, 11, '']],
    build: ({ page, brand, tenant, items }) => {
      const cardH = clamp(R(page.h * 0.075), 64, 120)
      const gap = R(cardH * 0.2)
      const top = R(page.h * 0.2)
      const room = Math.floor((page.h * 0.94 - top) / (cardH + gap))
      const n = Math.max(1, Math.min(items.length, room))
      const out = [
        mkText({
          text: tenant?.name || 'القائمة', size: relSize(page, 0.05), weight: 800, color: brand,
          x: R(page.w * 0.1), y: R(page.h * 0.06), w: R(page.w * 0.8), h: R(page.h * 0.08),
        }),
        mkShape({ shapeId: 'div-dots3', fill: brand, x: R(page.w * 0.25), y: R(page.h * 0.15), w: R(page.w * 0.5), h: R(page.h * 0.03) }),
      ]
      for (let i = 0; i < n; i++) {
        out.push({
          type: 'itemcard', itemId: items[i].id, showPrice: true, showDesc: false, layout: 'h',
          bg: '#ffffff', ink: '#1c1c1e', accent: brand,
          x: R(page.w * 0.1), y: top + i * (cardH + gap), w: R(page.w * 0.8), h: cardH,
        })
      }
      return out
    },
  },
  {
    id: 'qrcard', ar: 'بطاقة QR',
    prev: [[8, 8, 84, 84, 'f'], [22, 18, 56, 8, 'a'], [30, 34, 40, 34, 'b'], [24, 74, 52, 6, '']],
    build: ({ page, brand, tenant }) => {
      const qr = R(Math.min(page.w, page.h) * 0.38)
      return [
        mkShape({ shapeId: 'frame-double-rounded', fill: brand, x: R(page.w * 0.06), y: R(page.h * 0.06), w: R(page.w * 0.88), h: R(page.h * 0.88) }),
        mkText({
          text: tenant?.name || 'اسم المنشأة', size: relSize(page, 0.05), weight: 800, color: brand,
          x: R(page.w * 0.14), y: R(page.h * 0.16), w: R(page.w * 0.72), h: R(page.h * 0.09),
        }),
        { type: 'qr', kind: 'menu', x: R((page.w - qr) / 2), y: R(page.h * 0.34), w: qr, h: qr },
        mkText({
          text: 'امسح الرمز لتصفح القائمة والطلب', size: relSize(page, 0.026), weight: 600, color: '#1c1c1e',
          x: R(page.w * 0.12), y: R(page.h * 0.34 + qr + page.h * 0.03), w: R(page.w * 0.76), h: R(page.h * 0.07),
        }),
      ]
    },
  },
]

// ------------------------------------------------------------ align icons
// Local inline SVG (no emoji, no invented Icon names).
const AIco = ({ d, lines }) => (
  <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    {d ? <path d={d} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /> : null}
    {lines.map((l, i) => <rect key={i} x={l[0]} y={l[1]} width={l[2]} height={l[3]} rx="1" fill="currentColor" />)}
  </svg>
)
const ALIGN_TOOLS = [
  ['left', 'محاذاة يسار', <AIco key="l" d="M2 2v12" lines={[[3.5, 4, 9, 3], [3.5, 9, 5.5, 3]]} />],
  ['hcenter', 'توسيط أفقي', <AIco key="c" d="M8 2v12" lines={[[3, 4, 10, 3], [4.8, 9, 6.4, 3]]} />],
  ['right', 'محاذاة يمين', <AIco key="r" d="M14 2v12" lines={[[3.5, 4, 9, 3], [7, 9, 5.5, 3]]} />],
  ['top', 'محاذاة أعلى', <AIco key="t" d="M2 2h12" lines={[[4, 3.5, 3, 9], [9, 3.5, 3, 5.5]]} />],
  ['vcenter', 'توسيط رأسي', <AIco key="m" d="M2 8h12" lines={[[4, 3, 3, 10], [9, 4.8, 3, 6.4]]} />],
  ['bottom', 'محاذاة أسفل', <AIco key="b" d="M2 14h12" lines={[[4, 3.5, 3, 9], [9, 7, 3, 5.5]]} />],
]
const DIST_TOOLS = [
  ['distH', 'توزيع أفقي', <AIco key="dh" d="" lines={[[1.5, 3, 2.4, 10], [6.8, 3, 2.4, 10], [12.1, 3, 2.4, 10]]} />],
  ['distV', 'توزيع رأسي', <AIco key="dv" d="" lines={[[3, 1.5, 10, 2.4], [3, 6.8, 10, 2.4], [3, 12.1, 10, 2.4]]} />],
]

const SHORTCUTS = [
  ['سحب العنصر', 'Drag'],
  ['تحديد متعدد', 'Shift + Click'],
  ['تحديد بالإطار', 'Drag on empty page'],
  ['تحديد الكل', 'Ctrl + A'],
  ['إلغاء التحديد', 'Esc'],
  ['تراجع / إعادة', 'Ctrl+Z / Ctrl+Shift+Z'],
  ['نسخ / لصق / قص', 'Ctrl+C / Ctrl+V / Ctrl+X'],
  ['تكرار', 'Ctrl + D'],
  ['حذف', 'Delete'],
  ['تحريك دقيق', 'Arrows (Shift = 10)'],
  ['حفظ النسبة أثناء التحجيم', 'Shift + Resize'],
  ['تدوير بخطوات 15 درجة', 'Shift + Rotate'],
  ['قفل المحور أثناء السحب', 'Shift + Drag'],
  ['تعطيل الالتصاق مؤقتاً', 'Alt + Drag'],
  ['تحريك اللوحة', 'Space + Drag'],
  ['تكبير / تصغير', 'Ctrl + Wheel'],
  ['تحرير النص', 'Double click'],
  ['حفظ', 'Ctrl + S'],
  ['هذه القائمة', 'Shift + /'],
]

const TYPE_AR = { text: 'نص', image: 'صورة', shape: 'شكل', qr: 'رمز QR', itemcard: 'بطاقة صنف' }

export default function PrintStudio() {
  const { tenantId, tenant } = useAuth()
  const toast = useToast()
  const brand = resolveTenantTheme(tenant).brand || '#7c2d2d'
  const currency = tenant?.currency || 'SAR'
  const itemWord = lex(tenant, 'item')

  // ---------- data ----------
  const [designs, setDesigns] = useState(null)
  const [items, setItems] = useState([])
  const [qrSrc, setQrSrc] = useState('')

  // ---------- editor state ----------
  const [design, setDesign] = useState(null) // null = gallery
  const [dirty, setDirty] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [zoom, setZoom] = useState('fit')
  const [curScale, setCurScale] = useState(0.5)
  const [showGrid, setShowGrid] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [tab, setTab] = useState('shapes')
  const [shapeCat, setShapeCat] = useState('all')
  const [shapeQuery, setShapeQuery] = useState('')
  const [itemQuery, setItemQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [sizeId, setSizeId] = useState('A4')
  const [customUnit, setCustomUnit] = useState('mm')
  const [customW, setCustomW] = useState('210')
  const [customH, setCustomH] = useState('297')
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
  const selIdsRef = useRef([])
  const clipRef = useRef(null)
  const historyRef = useRef({ stack: [], idx: -1 })
  const [histVer, setHistVer] = useState(0) // re-render for undo/redo disabled states
  useEffect(() => { designRef.current = design }, [design])
  useEffect(() => { selIdsRef.current = selectedIds }, [selectedIds])

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
  const pageW = design?.page?.w, pageH = design?.page?.h
  useEffect(() => {
    if (!pageW || !pageH) return
    document.body.classList.add('ps-print')
    let el = document.getElementById('ps-page-style')
    if (!el) { el = document.createElement('style'); el.id = 'ps-page-style'; document.head.appendChild(el) }
    el.textContent = `@page { size: ${pageW}px ${pageH}px; margin: 0; }`
    return () => { document.body.classList.remove('ps-print'); el.remove() }
  }, [pageW, pageH])

  // ---------- history ----------
  const pushHistory = useCallback((d) => {
    const h = historyRef.current
    h.stack = h.stack.slice(0, h.idx + 1)
    h.stack.push(JSON.stringify(d))
    if (h.stack.length > 60) h.stack.shift()
    h.idx = h.stack.length - 1
    setHistVer((v) => v + 1)
  }, [])

  const change = useCallback((next, record = true) => {
    setDesign(next)
    designRef.current = next
    setDirty(true)
    if (record) pushHistory(next)
  }, [pushHistory])

  const applyHistory = useCallback((d) => {
    setDesign(d)
    designRef.current = d
    setDirty(true)
    // an undone insert must not stay "selected"
    const live = new Set(d.elements.map((e) => e.id))
    setSelectedIds((ids) => ids.filter((id) => live.has(id)))
    setHistVer((v) => v + 1)
  }, [])

  const undo = useCallback(() => {
    const h = historyRef.current
    if (h.idx <= 0) return
    h.idx -= 1
    applyHistory(JSON.parse(h.stack[h.idx]))
  }, [applyHistory])
  const redo = useCallback(() => {
    const h = historyRef.current
    if (h.idx >= h.stack.length - 1) return
    h.idx += 1
    applyHistory(JSON.parse(h.stack[h.idx]))
  }, [applyHistory])

  // ---------- element ops ----------
  const patchMany = useCallback((map, record = false) => {
    const d = designRef.current
    if (!d) return
    const next = { ...d, elements: d.elements.map((e) => (map[e.id] ? { ...e, ...map[e.id] } : e)) }
    change(next, record)
  }, [change])

  const patchEl = useCallback((id, patch, record = false) => patchMany({ [id]: patch }, record), [patchMany])

  const commit = useCallback(() => { if (designRef.current) pushHistory(designRef.current) }, [pushHistory])

  const topZ = (d) => d.elements.reduce((m, e) => Math.max(m, e.z || 0), 0)

  const addElement = useCallback((partial) => {
    const d = designRef.current
    if (!d) return
    const w = partial.w || 140, h = partial.h || 140
    const el = {
      id: uid(),
      x: R((d.page.w - w) / 2), y: R((d.page.h - h) / 2),
      rotate: 0, opacity: 1, z: topZ(d) + 1, locked: false, hidden: false,
      ...partial, w, h,
    }
    change({ ...d, elements: [...d.elements, el] })
    setSelectedIds([el.id])
    setPanelSheet(null)
  }, [change])

  const selectedEls = useMemo(
    () => (design?.elements || []).filter((e) => selectedIds.includes(e.id)),
    [design, selectedIds],
  )
  const selected = selectedEls.length === 1 ? selectedEls[0] : null

  const deleteSel = useCallback(() => {
    const d = designRef.current, ids = selIdsRef.current
    if (!d || !ids.length) return
    const kill = new Set(ids)
    change({ ...d, elements: d.elements.filter((e) => !kill.has(e.id)) })
    setSelectedIds([])
  }, [change])

  const duplicateSel = useCallback(() => {
    const d = designRef.current, ids = selIdsRef.current
    const src = d?.elements.filter((e) => ids.includes(e.id)) || []
    if (!src.length) return
    let z = topZ(d)
    const copies = src.map((el) => ({ ...el, id: uid(), x: el.x + 18, y: el.y + 18, z: ++z }))
    change({ ...d, elements: [...d.elements, ...copies] })
    setSelectedIds(copies.map((c) => c.id))
  }, [change])

  const copySel = useCallback((cut = false) => {
    const d = designRef.current, ids = selIdsRef.current
    const src = d?.elements.filter((e) => ids.includes(e.id)) || []
    if (!src.length) return false
    clipRef.current = JSON.parse(JSON.stringify(src))
    if (cut) deleteSel()
    return true
  }, [deleteSel])

  const pasteClip = useCallback(() => {
    const d = designRef.current
    const clip = clipRef.current
    if (!d || !clip?.length) return
    let z = topZ(d)
    const copies = clip.map((el) => ({
      ...el, id: uid(), z: ++z,
      x: clamp(el.x + 16, -el.w + 20, d.page.w - 20),
      y: clamp(el.y + 16, -el.h + 20, d.page.h - 20),
    }))
    // paste again = paste again further along, never on top of the last one
    clipRef.current = JSON.parse(JSON.stringify(copies))
    change({ ...d, elements: [...d.elements, ...copies] })
    setSelectedIds(copies.map((c) => c.id))
  }, [change])

  const nudge = useCallback(([dx, dy]) => {
    const d = designRef.current, ids = selIdsRef.current
    const movers = d?.elements.filter((e) => ids.includes(e.id) && !e.locked && !e.hidden) || []
    if (!movers.length) return
    const map = {}
    for (const e of movers) map[e.id] = { x: e.x + dx, y: e.y + dy }
    patchMany(map, true)
  }, [patchMany])

  // z-order for the whole selection; z is re-normalised to a dense 0..n-1 range
  const reorder = useCallback((mode) => {
    const d = designRef.current, ids = new Set(selIdsRef.current)
    if (!d || !ids.size) return
    let arr = [...d.elements].sort((a, b) => (a.z || 0) - (b.z || 0))
    if (mode === 'front') arr = [...arr.filter((e) => !ids.has(e.id)), ...arr.filter((e) => ids.has(e.id))]
    else if (mode === 'back') arr = [...arr.filter((e) => ids.has(e.id)), ...arr.filter((e) => !ids.has(e.id))]
    else if (mode === 'up') {
      for (let i = arr.length - 2; i >= 0; i--) {
        if (ids.has(arr[i].id) && !ids.has(arr[i + 1].id)) { const t = arr[i]; arr[i] = arr[i + 1]; arr[i + 1] = t }
      }
    } else if (mode === 'down') {
      for (let i = 1; i < arr.length; i++) {
        if (ids.has(arr[i].id) && !ids.has(arr[i - 1].id)) { const t = arr[i]; arr[i] = arr[i - 1]; arr[i - 1] = t }
      }
    }
    const zmap = new Map(arr.map((e, i) => [e.id, i]))
    change({ ...d, elements: d.elements.map((e) => ({ ...e, z: zmap.get(e.id) })) })
  }, [change])

  // Align uses each element's ROTATED bounding box, so a tilted element lines up
  // by what you actually see. One element aligns to the page; two or more align
  // to the selection's own bounds.
  const alignSel = useCallback((mode) => {
    const d = designRef.current, ids = selIdsRef.current
    const els = d?.elements.filter((e) => ids.includes(e.id) && !e.locked) || []
    if (!els.length) return
    const bounds = els.length > 1 ? bboxOfMany(els) : { x: 0, y: 0, w: d.page.w, h: d.page.h }
    const map = {}
    for (const e of els) {
      const b = aabbOf(e)
      if (mode === 'left') map[e.id] = { x: R(e.x + (bounds.x - b.x)) }
      else if (mode === 'right') map[e.id] = { x: R(e.x + (bounds.x + bounds.w - (b.x + b.w))) }
      else if (mode === 'hcenter') map[e.id] = { x: R(e.x + (bounds.x + (bounds.w - b.w) / 2 - b.x)) }
      else if (mode === 'top') map[e.id] = { y: R(e.y + (bounds.y - b.y)) }
      else if (mode === 'bottom') map[e.id] = { y: R(e.y + (bounds.y + bounds.h - (b.y + b.h))) }
      else if (mode === 'vcenter') map[e.id] = { y: R(e.y + (bounds.y + (bounds.h - b.h) / 2 - b.y)) }
    }
    patchMany(map, true)
  }, [patchMany])

  // Distribute spreads the CENTRES evenly between the two outermost elements.
  const distributeSel = useCallback((axis) => {
    const d = designRef.current, ids = selIdsRef.current
    const els = d?.elements.filter((e) => ids.includes(e.id) && !e.locked) || []
    if (els.length < 3) return
    const key = axis === 'distH' ? 'x' : 'y'
    const sizeKey = axis === 'distH' ? 'w' : 'h'
    const rows = els.map((e) => ({ e, b: aabbOf(e) }))
      .sort((a, b) => (a.b[key] + a.b[sizeKey] / 2) - (b.b[key] + b.b[sizeKey] / 2))
    const first = rows[0].b[key] + rows[0].b[sizeKey] / 2
    const last = rows[rows.length - 1].b[key] + rows[rows.length - 1].b[sizeKey] / 2
    const step = (last - first) / (rows.length - 1)
    const map = {}
    rows.forEach((r, i) => {
      if (i === 0 || i === rows.length - 1) return
      const want = first + step * i
      const have = r.b[key] + r.b[sizeKey] / 2
      map[r.e.id] = { [key]: R(r.e[key] + (want - have)) }
    })
    patchMany(map, true)
  }, [patchMany])

  const selectAll = useCallback(() => {
    const d = designRef.current
    if (!d) return
    setSelectedIds(d.elements.filter((e) => !e.hidden).map((e) => e.id))
  }, [])

  // ---------- open / create / save ----------
  const openDesign = (d) => {
    const clean = JSON.parse(JSON.stringify({
      id: d.id, name: d.name || 'تصميم', page: d.page, elements: d.elements || [],
    }))
    setDesign(clean)
    designRef.current = clean
    historyRef.current = { stack: [JSON.stringify(clean)], idx: 0 }
    setHistVer((v) => v + 1)
    setDirty(false); setSelectedIds([]); setZoom('fit'); setTab('shapes'); setAiSuggest(null)
  }

  const newDesign = (size, template) => {
    const id = doc(collection(db, 'tenants', tenantId, 'printDesigns')).id
    const page = { preset: size.id, w: size.w, h: size.h, bgColor: '#ffffff', bgImageUrl: '', bgOpacity: 1 }
    const built = template.build({ page, brand, tenant, items: items.filter((it) => !it.archived) })
    const d = {
      id, name: template.id === 'blank' ? 'تصميم جديد' : template.ar,
      page,
      elements: built.map((el, i) => ({
        id: uid(), rotate: 0, opacity: 1, locked: false, hidden: false, z: i + 1, ...el,
      })),
    }
    setCreating(false)
    openDesign(d)
    setDirty(true)
  }

  const save = useCallback(async () => {
    const d = designRef.current
    if (!d) return
    setSaving(true)
    try {
      const data = JSON.parse(JSON.stringify(d))
      await setDoc(doc(db, 'tenants', tenantId, 'printDesigns', d.id), { ...data, updatedAt: serverTimestamp() })
      setDirty(false)
      toast.success('تم حفظ التصميم')
    } catch (e) {
      toast.error('تعذر الحفظ: ' + String(e?.message || e))
    } finally { setSaving(false) }
  }, [tenantId, toast])

  const closeEditor = () => {
    if (dirty && !window.confirm('لديك تغييرات غير محفوظة — الخروج بدون حفظ؟')) return
    setDesign(null); designRef.current = null; setSelectedIds([])
  }

  const duplicateDesign = async (d) => {
    try {
      const id = doc(collection(db, 'tenants', tenantId, 'printDesigns')).id
      const copy = JSON.parse(JSON.stringify({
        id, name: `${d.name || 'تصميم'} (نسخة)`, page: d.page, elements: d.elements || [],
      }))
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
    setSelectedIds([])
    setShowGrid(false)
    setTimeout(() => window.print(), 120)
  }
  const doPng = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const { blob, skipped } = await exportDesignPng({ design: designRef.current, items, currency, qrSrc, scale: 2 })
      downloadBlob(blob, `${(designRef.current.name || 'design').replace(/[\\/:*?"<>|]/g, '')}.png`)
      if (skipped.length) toast.error('نزلت الصورة لكن تعذر رسم: ' + [...new Set(skipped)].join('، '))
      else toast.success('تم تنزيل الصورة PNG')
    } catch (e) {
      toast.error(String(e?.message || e))
    } finally { setExporting(false) }
  }

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      if (!designRef.current) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (e.key === 'Escape') { if (helpOpen) setHelpOpen(false); else setSelectedIds([]); return }
      if (e.key === '?' || (e.shiftKey && k === '/')) { e.preventDefault(); setHelpOpen((v) => !v); return }
      if (mod && k === 's') { e.preventDefault(); save(); return }
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && k === 'y') { e.preventDefault(); redo(); return }
      if (mod && k === 'a') { e.preventDefault(); selectAll(); return }
      if (mod && k === 'v') { e.preventDefault(); pasteClip(); return }
      if (!selIdsRef.current.length) return
      if (mod && k === 'c') { e.preventDefault(); copySel(false); return }
      if (mod && k === 'x') { e.preventDefault(); copySel(true); return }
      if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return }
      if (mod && k === ']') { e.preventDefault(); reorder(e.shiftKey ? 'front' : 'up'); return }
      if (mod && k === '[') { e.preventDefault(); reorder(e.shiftKey ? 'back' : 'down'); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return }
      const step = e.shiftKey ? 10 : 1
      const dm = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
      if (dm) { e.preventDefault(); nudge(dm) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, duplicateSel, deleteSel, nudge, copySel, pasteClip, selectAll, reorder, save, helpOpen])

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
        const size = R(Math.min(d.page.w, d.page.h) * 0.42)
        addElement({ type: 'image', url, fit: 'cover', radius: 0, borderW: 0, borderColor: '#1c1c1e', shadow: false, flipH: false, w: size, h: size })
        toast.success('تم توليد الصورة وإدراجها (حُفظت في المكتبة)')
      }
    } catch (e) {
      toast.error(String(e?.message || e))
    } finally { setBusy(false) }
  }

  const suggestText = async () => {
    const el = selected
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
    const size = R(Math.min(d.page.w, d.page.h) * 0.42)
    addElement({ type: 'image', url, fit: 'cover', radius: 0, borderW: 0, borderColor: '#1c1c1e', shadow: false, flipH: false, w: size, h: size })
  }
  const addShape = (sh) => {
    const d = designRef.current
    const isDiv = sh.cat === 'divider' || sh.id === 'arab-band' || sh.id === 'ribbon-banner'
    const isFrame = sh.cat === 'frame'
    const w = isDiv ? R(d.page.w * 0.6) : isFrame ? R(d.page.w * 0.55) : 150
    const h = isDiv ? 34 : isFrame ? R(d.page.h * 0.4) : 150
    addElement({ type: 'shape', shapeId: sh.id, fill: brand, stroke: '', strokeW: 0, w, h })
  }
  const addText = (p) => {
    const d = designRef.current
    addElement({
      type: 'text', text: p.ar, fontKey: 'tajawal', size: p.size, weight: p.weight,
      color: '#1c1c1e', align: 'center', lineHeight: 1.4, letterSpacing: 0, dir: 'rtl',
      w: Math.min(R(d.page.w * 0.72), 480), h: R(p.size * 1.7),
    })
  }
  const addQr = () => addElement({ type: 'qr', kind: 'menu', w: 140, h: 140 })
  const addItemCard = (it) => addElement({
    type: 'itemcard', itemId: it.id, showPrice: true, showDesc: false, layout: 'h',
    bg: '#ffffff', ink: '#1c1c1e', accent: brand, w: 280, h: 92,
  })

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
      onKeyUp={commit}
    />
  )

  const filteredShapes = useMemo(() => PRINT_SHAPES.filter((s) =>
    (shapeCat === 'all' || s.cat === shapeCat)
    && (!shapeQuery.trim() || s.ar.includes(shapeQuery.trim()))
  ), [shapeCat, shapeQuery])

  const filteredItems = useMemo(() => (items || []).filter((it) =>
    !it.archived && (!itemQuery.trim()
      || (it.nameAr || '').includes(itemQuery.trim())
      || (it.nameEn || '').toLowerCase().includes(itemQuery.trim().toLowerCase()))
  ), [items, itemQuery])

  const hist = historyRef.current
  const canUndo = hist.idx > 0
  const canRedo = hist.idx < hist.stack.length - 1
  void histVer

  // custom size, resolved live from the two inputs (never cached into state —
  // otherwise editing the inputs after picking «مخصص» would create the OLD size)
  const customSize = useMemo(() => {
    const w = Number(customW) || 0, h = Number(customH) || 0
    const pw = customUnit === 'mm' ? pxOfMm(w) : R(w)
    const ph = customUnit === 'mm' ? pxOfMm(h) : R(h)
    return {
      id: 'custom', ar: 'حجم مخصص',
      w: clamp(pw, 120, 6000), h: clamp(ph, 120, 6000),
      ok: pw >= 120 && ph >= 120 && pw <= 6000 && ph <= 6000,
    }
  }, [customW, customH, customUnit])
  const activeSize = sizeId === 'custom' ? customSize : (PAGE_PRESETS.find((p) => p.id === sizeId) || PAGE_PRESETS[0])

  const layerLabel = (el) => {
    if (el.type === 'text') return (el.text || '').trim().slice(0, 28) || 'نص فارغ'
    if (el.type === 'shape') return shapeById(el.shapeId)?.ar || 'شكل'
    if (el.type === 'itemcard') {
      const it = items.find((i) => i.id === el.itemId)
      return it ? (it.nameAr || it.nameEn) : `${itemWord} غير موجود`
    }
    return TYPE_AR[el.type] || el.type
  }
  const layerIcon = (el) => (
    el.type === 'text' ? 'text' : el.type === 'image' ? 'image'
      : el.type === 'shape' ? 'shapes' : el.type === 'qr' ? 'qr' : 'menu'
  )

  // ============================ GALLERY ============================
  if (!design) {
    const tplList = TEMPLATES.filter((t) => !t.needsItems || items.some((it) => !it.archived))
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
            <strong className="xs faint">1 — مقاس الصفحة</strong>
            <div className="ps-presets-row">
              {PAGE_PRESETS.map((p) => (
                <button
                  key={p.id} className="ps-preset" aria-pressed={sizeId === p.id}
                  onClick={() => setSizeId(p.id)}
                >
                  <span className="ps-preset-box" style={{ aspectRatio: `${p.w} / ${p.h}` }} />
                  <span className="xs">{p.ar}</span>
                  <span className="xs faint ps-preset-dim num">{mmOf(p.w)} × {mmOf(p.h)} mm</span>
                </button>
              ))}
              <button
                className="ps-preset" aria-pressed={sizeId === 'custom'}
                disabled={!customSize.ok} onClick={() => setSizeId('custom')}
              >
                <span className="ps-preset-box" style={{ aspectRatio: `${customSize.w} / ${customSize.h}` }} />
                <span className="xs">حجم مخصص</span>
                <span className="xs faint ps-preset-dim num">{customSize.w} × {customSize.h} px</span>
              </button>
            </div>

            <div className="ps-size-custom">
              <div className="ps-unit-toggle">
                {[['mm', 'مليمتر'], ['px', 'بكسل']].map(([u, ar]) => (
                  <button key={u} className={customUnit === u ? 'active' : ''} onClick={() => setCustomUnit(u)}>{ar}</button>
                ))}
              </div>
              <label><span className="xs faint">العرض</span>
                <input className="input input-sm num" type="number" value={customW} onChange={(e) => setCustomW(e.target.value)} />
              </label>
              <label><span className="xs faint">الطول</span>
                <input className="input input-sm num" type="number" value={customH} onChange={(e) => setCustomH(e.target.value)} />
              </label>
              <button className="btn btn-sm btn-outline" disabled={!customSize.ok} onClick={() => setSizeId('custom')}>
                استخدم المقاس المخصص
              </button>
              {!customSize.ok ? <span className="xs faint num">المقاس المسموح بين 120 و 6000 بكسل</span> : null}
            </div>

            <strong className="xs faint">2 — ابدأ من قالب</strong>
            <div className="ps-tpl-grid">
              {tplList.map((t) => (
                <button key={t.id} className="ps-tpl" onClick={() => newDesign(activeSize, t)}>
                  <span className="ps-tpl-prev" style={{ aspectRatio: `${activeSize.w} / ${activeSize.h}` }}>
                    {t.prev.map((b, i) => (
                      <i key={i} className={b[4]} style={{ left: `${b[0]}%`, top: `${b[1]}%`, width: `${b[2]}%`, height: `${b[3]}%` }} />
                    ))}
                  </span>
                  <span className="ps-tpl-name">{t.ar}</span>
                </button>
              ))}
            </div>
            {TEMPLATES.some((t) => t.needsItems) && !items.some((it) => !it.archived) ? (
              <p className="xs faint">قالب «قائمة أصناف» يظهر بعد إضافة أصناف للمنيو — لا نعرض بطاقات لأصناف غير موجودة.</p>
            ) : null}
          </div>
        )}

        {designs === null ? <Spinner /> : designs.length === 0 && !creating ? (
          <Empty
            icon="shapes"
            title="لا توجد تصاميم بعد"
            hint="ابدأ أول تصميم حر — اختر مقاساً وقالباً وشكّله كما تريد"
            action={<button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="add" size={15} /> تصميم جديد</button>}
          />
        ) : (
          <div className="ps-gallery">
            {designs.map((d) => (
              <div key={d.id} className="card ps-dcard" role="button" tabIndex={0}
                onClick={() => openDesign(d)}
                onKeyDown={(e) => { if (e.key === 'Enter') openDesign(d) }}>
                <div className="ps-dthumb" style={{ aspectRatio: `${d.page?.w || 794} / ${d.page?.h || 1123}`, background: d.page?.bgColor || '#fff' }}>
                  {d.page?.bgImageUrl ? <img src={d.page.bgImageUrl} alt="" style={{ opacity: d.page?.bgOpacity ?? 1 }} /> : null}
                  <span className="ps-dcount xs num">{(d.elements || []).length} عنصر</span>
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
  const zSorted = [...design.elements].sort((a, b) => (b.z || 0) - (a.z || 0))
  // count the RESOLVED elements, not the id list: an id can outlive its element
  // for a render (undo, external change) and `selected` would be null.
  const nSel = selectedEls.length

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
        <button className="icon-btn ps-flip" disabled={!canRedo} onClick={redo} title="إعادة (Ctrl+Shift+Z)"><Icon name="undo" size={16} /></button>
        <span className="ps-tools-sep" />
        <div className="ps-zoom">
          <button className="icon-btn" onClick={() => setZoom(clamp(R((curScale - 0.15) * 20) / 20, 0.05, 4))} title="تصغير"><Icon name="minus" size={14} /></button>
          <span className="xs num">{Math.round(curScale * 100)}%</span>
          <button className="icon-btn" onClick={() => setZoom(clamp(R((curScale + 0.15) * 20) / 20, 0.05, 4))} title="تكبير"><Icon name="add" size={14} /></button>
          <button className={`btn btn-sm ${zoom === 'fit' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setZoom('fit')}>ملاءمة</button>
        </div>
        <button className={`icon-btn ${showGrid ? 'is-on' : ''}`} onClick={() => setShowGrid((v) => !v)} title="شبكة مساعدة (لا تُطبع)"><Icon name="grid" size={16} /></button>
        <button className="icon-btn" onClick={() => setHelpOpen(true)} title="اختصارات لوحة المفاتيح"><Icon name="key" size={16} /></button>
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
            {[
              ['shapes', 'العناصر', 'shapes'], ['text', 'النصوص', 'text'], ['images', 'الصور', 'image'],
              ['items', 'الأصناف', 'menu'], ['layers', 'الطبقات', 'layers'], ['page', 'الصفحة', 'file'],
            ].map(([id, ar, icon]) => (
              <button key={id} className={`ps-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                <Icon name={icon} size={15} /><span>{ar}</span>
              </button>
            ))}
          </div>

          {tab === 'shapes' && (
            <div className="ps-tabbody">
              <button className="btn btn-sm btn-outline" onClick={addQr}><Icon name="qr" size={14} /> رمز QR للمنيو</button>
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
              <input className="input input-sm" placeholder={`ابحث عن ${itemWord}...`} value={itemQuery} onChange={(e) => setItemQuery(e.target.value)} />
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

          {tab === 'layers' && (
            <div className="ps-tabbody">
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-outline" style={{ flex: 1 }} disabled={!nSel} onClick={() => reorder('front')}>للمقدمة</button>
                <button className="btn btn-sm btn-outline" style={{ flex: 1 }} disabled={!nSel} onClick={() => reorder('back')}>للخلف</button>
              </div>
              <div className="ps-layers">
                {zSorted.map((el) => (
                  <div
                    key={el.id}
                    className={`ps-layer ${selectedIds.includes(el.id) ? 'sel' : ''} ${el.hidden ? 'off' : ''}`}
                    role="button" tabIndex={0}
                    onClick={(e) => {
                      const add = e.shiftKey || e.ctrlKey || e.metaKey
                      setSelectedIds((ids) => (add
                        ? (ids.includes(el.id) ? ids.filter((i) => i !== el.id) : [...ids, el.id])
                        : [el.id]))
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelectedIds([el.id]) }}
                  >
                    <span className="ps-layer-ico"><Icon name={layerIcon(el)} size={14} /></span>
                    <span className="ps-layer-name">{layerLabel(el)}</span>
                    <span className="ps-layer-acts" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn" title={el.hidden ? 'إظهار' : 'إخفاء'}
                        onClick={() => patchEl(el.id, { hidden: !el.hidden }, true)}>
                        <Icon name={el.hidden ? 'eyeOff' : 'eye'} size={13} />
                      </button>
                      <button className={`icon-btn ${el.locked ? 'is-on' : ''}`} title={el.locked ? 'فك القفل' : 'قفل'}
                        onClick={() => patchEl(el.id, { locked: !el.locked }, true)}>
                        <Icon name="lock" size={13} />
                      </button>
                    </span>
                  </div>
                ))}
                {zSorted.length === 0 ? <p className="ps-layer-empty">الصفحة فارغة — أضف عنصراً من التبويبات</p> : null}
              </div>
              <p className="xs faint">الأعلى في القائمة = الأعلى في الطبقات. العناصر المخفية لا تُطبع ولا تُصدَّر.</p>
            </div>
          )}

          {tab === 'page' && (
            <div className="ps-tabbody">
              <strong className="ps-sect">مقاس الصفحة</strong>
              <div className="ps-chips">
                {PAGE_PRESETS.map((p) => (
                  <button key={p.id} className={`chip ${page.preset === p.id ? 'active' : ''}`}
                    onClick={() => changePage({ preset: p.id, w: p.w, h: p.h })}>{p.ar}</button>
                ))}
                <button className={`chip ${page.preset === 'custom' ? 'active' : ''}`}
                  onClick={() => changePage({ preset: 'custom' })}>حجم مخصص</button>
              </div>
              <div className="ps-xywh">
                <label><span className="xs faint">العرض (px)</span>
                  <input className="input input-sm num" type="number" value={page.w}
                    onChange={(e) => changePage({ preset: 'custom', w: clamp(Number(e.target.value) || 0, 120, 6000) }, false)}
                    onBlur={commit} />
                </label>
                <label><span className="xs faint">الطول (px)</span>
                  <input className="input input-sm num" type="number" value={page.h}
                    onChange={(e) => changePage({ preset: 'custom', h: clamp(Number(e.target.value) || 0, 120, 6000) }, false)}
                    onBlur={commit} />
                </label>
              </div>
              <p className="xs faint num" style={{ direction: 'ltr', textAlign: 'start' }}>
                {mmOf(page.w)} × {mmOf(page.h)} mm — 96dpi
              </p>

              <strong className="ps-sect">لون وخلفية</strong>
              <label className="ps-field"><span>لون الخلفية</span>
                <input type="color" value={page.bgColor || '#ffffff'} onChange={(e) => changePage({ bgColor: e.target.value }, false)} onBlur={commit} />
              </label>
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
            selectedIds={selectedIds}
            onSelect={setSelectedIds}
            onPatchMany={patchMany}
            onCommit={commit}
            zoom={zoom}
            onScale={setCurScale}
            onZoom={setZoom}
            showGrid={showGrid}
          />
        </div>

        {/* -------- properties panel (left side in RTL) -------- */}
        <aside className={`ps-panel ps-props no-print ${panelSheet === 'props' ? 'open' : ''}`}>
          {nSel === 0 ? (
            <div className="ps-tabbody">
              <p className="xs faint" style={{ lineHeight: 1.8 }}>
                اختر عنصراً من اللوحة لتعديل خصائصه.
                <br />اسحب للتحريك، والمقابض للتحجيم والتدوير، واسحب على الفراغ لتحديد عدة عناصر بإطار.
              </p>
              <button className="btn btn-sm btn-outline" onClick={() => setHelpOpen(true)}><Icon name="key" size={14} /> كل الاختصارات</button>
            </div>
          ) : (
            <div className="ps-tabbody">
              <div className="row" style={{ alignItems: 'center', gap: 6 }}>
                <strong className="small">
                  {nSel > 1 ? <span className="num">{nSel} عناصر محددة</span> : (TYPE_AR[selected.type] || selected.type)}
                </strong>
                <div className="grow" />
                <button className="icon-btn" title="نسخ (Ctrl+C)" onClick={() => { if (copySel(false)) toast.success('تم النسخ'); }}><Icon name="copy" size={14} /></button>
                <button className="icon-btn" title="تكرار (Ctrl+D)" onClick={duplicateSel}><Icon name="add" size={14} /></button>
                <button className="icon-btn" title="حذف (Delete)" onClick={deleteSel}><Icon name="delete" size={14} /></button>
              </div>

              <strong className="ps-sect">المحاذاة {nSel > 1 ? '(داخل التحديد)' : '(على الصفحة)'}</strong>
              <div className="ps-align-grid">
                {ALIGN_TOOLS.map(([mode, ar, ico]) => (
                  <button key={mode} className="ps-align-btn" title={ar} aria-label={ar} onClick={() => alignSel(mode)}>{ico}</button>
                ))}
              </div>
              <div className="ps-align-grid">
                {DIST_TOOLS.map(([mode, ar, ico]) => (
                  <button key={mode} className="ps-align-btn" title={`${ar} — يحتاج 3 عناصر أو أكثر`} aria-label={ar}
                    disabled={nSel < 3} onClick={() => distributeSel(mode)}>{ico}</button>
                ))}
              </div>

              <strong className="ps-sect">الطبقة</strong>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-outline" style={{ flex: 1 }} onClick={() => reorder('up')}>أعلى</button>
                <button className="btn btn-sm btn-outline" style={{ flex: 1 }} onClick={() => reorder('down')}>أسفل</button>
                <button className="btn btn-sm btn-outline" style={{ flex: 1 }} onClick={() => reorder('front')}>المقدمة</button>
                <button className="btn btn-sm btn-outline" style={{ flex: 1 }} onClick={() => reorder('back')}>الخلفية</button>
              </div>

              {nSel > 1 ? (
                <>
                  <label className="ps-field"><span>الشفافية</span>
                    {slider(selectedEls[0].opacity ?? 1,
                      (v) => patchMany(Object.fromEntries(selectedEls.map((e) => [e.id, { opacity: v }])), false),
                      { min: 0.05, max: 1, step: 0.05 })}
                  </label>
                  <button className="btn btn-sm btn-outline"
                    onClick={() => patchMany(Object.fromEntries(selectedEls.map((e) => [e.id, { locked: !selectedEls.every((x) => x.locked) }])), true)}>
                    <Icon name="lock" size={13} /> {selectedEls.every((x) => x.locked) ? 'فك قفل الكل' : 'قفل الكل'}
                  </button>
                  <p className="xs faint">الخصائص التفصيلية تظهر عند تحديد عنصر واحد.</p>
                </>
              ) : (
                <div key={selected.id}>
                  <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                    <button className={`btn btn-sm ${selected.locked ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }}
                      onClick={() => patchEl(selected.id, { locked: !selected.locked }, true)}>
                      <Icon name="lock" size={13} /> {selected.locked ? 'مقفل' : 'قفل'}
                    </button>
                    <button className={`btn btn-sm ${selected.hidden ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }}
                      onClick={() => patchEl(selected.id, { hidden: !selected.hidden }, true)}>
                      <Icon name={selected.hidden ? 'eyeOff' : 'eye'} size={13} /> {selected.hidden ? 'مخفي' : 'ظاهر'}
                    </button>
                  </div>

                  <div className="ps-xywh">
                    {[['x', 'س'], ['y', 'ص'], ['w', 'عرض'], ['h', 'طول']].map(([k, ar]) => (
                      <label key={k}><span className="xs faint">{ar}</span>
                        <input className="input input-sm num" type="number" value={R(selected[k])}
                          onChange={(e) => patchEl(selected.id, { [k]: Number(e.target.value) || 0 }, false)} onBlur={commit} />
                      </label>
                    ))}
                  </div>
                  <label className="ps-field"><span>تدوير (<span className="num">{selected.rotate || 0}</span> درجة)</span>
                    {slider(selected.rotate || 0, (v) => patchEl(selected.id, { rotate: v }), { min: 0, max: 359 })}
                  </label>
                  <label className="ps-field"><span>الشفافية</span>
                    {slider(selected.opacity ?? 1, (v) => patchEl(selected.id, { opacity: v }), { min: 0.05, max: 1, step: 0.05 })}
                  </label>

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
                      <label className="ps-field"><span>الحجم (<span className="num">{selected.size || 18}</span>)</span>
                        {slider(selected.size || 18, (v) => patchEl(selected.id, { size: v }), { min: 8, max: 240 })}
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
                      <label className="ps-field"><span>سماكة الخط (<span className="num">{selected.strokeW || 0}</span>)</span>
                        {slider(selected.strokeW || 0, (v) => patchEl(selected.id, { strokeW: v }), { min: 0, max: 14, step: 0.5 })}
                      </label>
                      <p className="xs faint">سماكة 0 تعني إبقاء السماكة الأصلية للشكل.</p>
                    </>
                  )}

                  {selected.type === 'qr' && (
                    <p className="xs faint" style={{ lineHeight: 1.7 }}>
                      {tenant?.slug
                        ? 'رمز QR حي يقود إلى المنيو الرقمي لمنشأتك. حجّمه من المقابض.'
                        : 'لم يُضبط رابط المنيو (slug) للمنشأة بعد — الرمز لن يُطبع ولن يُصدَّر حتى يُضبط.'}
                    </p>
                  )}

                  {selected.type === 'itemcard' && (
                    <>
                      <label className="ps-field"><span>{itemWord}</span>
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
                      <label className="ps-field"><span>خلفية البطاقة</span>
                        <input type="color" value={selected.bg || '#ffffff'} onChange={(e) => patchEl(selected.id, { bg: e.target.value })} onBlur={commit} />
                      </label>
                      <label className="ps-field"><span>لون النص</span>
                        <input type="color" value={selected.ink || '#1c1c1e'} onChange={(e) => patchEl(selected.id, { ink: e.target.value })} onBlur={commit} />
                      </label>
                      <label className="ps-field"><span>لون السعر</span>
                        <input type="color" value={selected.accent || '#1c1c1e'} onChange={(e) => patchEl(selected.id, { accent: e.target.value })} onBlur={commit} />
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {helpOpen ? (
        <div className="ps-help-back no-print" role="dialog" aria-modal="true" aria-label="اختصارات لوحة المفاتيح"
          onClick={(e) => { if (e.target === e.currentTarget) setHelpOpen(false) }}>
          <div className="ps-help">
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 'var(--fs-md)' }}>اختصارات لوحة المفاتيح</strong>
              <div className="grow" />
              <button className="icon-btn" onClick={() => setHelpOpen(false)} aria-label="إغلاق"><Icon name="close" size={16} /></button>
            </div>
            <div className="ps-help-rows">
              {SHORTCUTS.map(([ar, keys]) => (
                <div key={ar} className="ps-help-row"><span>{ar}</span><kbd>{keys}</kbd></div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <MediaLibrary
        open={!!mediaOpen}
        onClose={() => setMediaOpen(null)}
        tenantId={tenantId}
        kind="image"
        onPick={(url) => {
          if (mediaOpen === 'bg') changePage({ bgImageUrl: url })
          else if (mediaOpen === 'replace' && selIdsRef.current.length === 1) patchEl(selIdsRef.current[0], { url }, true)
          else addImageEl(url)
          setMediaOpen(null)
        }}
      />
    </div>
  )
}
