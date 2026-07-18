import { useEffect, useRef, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import Icon from './Icon.jsx'
import { useToast } from './Toast.jsx'
import MediaLibrary from './MediaLibrary.jsx'
import DesignSlideView, { newLayerId } from './DesignSlideView.jsx'
import { uploadImage } from '../lib/storage.js'
import { aiQuick } from '../lib/aiBridge.js'
import { generatePostImage, IMAGE_MODEL, cleanCaption } from '../lib/postGen.js'
import { functions, firebaseReady } from '../lib/firebase.js'

// Fullscreen canvas editor for `design` signage slides (SIGNAGE S1).
// WYSIWYG: the canvas IS DesignSlideView — the same renderer the TV uses.
// Layers: text / image / shape on a % grid; drag to move, corner handle to
// resize, arrows nudge, Ctrl+Z/Y undo/redo. Saving hands the slide JSON back.
//
// V2 (2026-07-18): element library (prebuilt bars/frames/badges/text sets —
// pure layer data, no new render types), media-library picker (image layers +
// bg), client-side PNG background cutout on image layers, and an AI assistant
// (description → headline/sub text, description → generated image as bg or
// layer). The onSave contract is untouched: onSave(slide JSON).

const round1 = (v) => Math.round(v * 10) / 10

// 16:9 canvas: x/w are % of WIDTH, y/h are % of HEIGHT — vertical frame bars
// need w = t * 9/16 so all four sides look equally thick on screen.
const frameLayers = (yIn, t, color, opacity) => {
  const xIn = round1((yIn * 9) / 16)
  const tw = round1((t * 9) / 16)
  return [
    { type: 'shape', shape: 'rect', x: xIn, y: yIn, w: round1(100 - 2 * xIn), h: t, color, opacity },
    { type: 'shape', shape: 'rect', x: xIn, y: round1(100 - yIn - t), w: round1(100 - 2 * xIn), h: t, color, opacity },
    { type: 'shape', shape: 'rect', x: xIn, y: yIn, w: tw, h: round1(100 - 2 * yIn), color, opacity },
    { type: 'shape', shape: 'rect', x: round1(100 - xIn - tw), y: yIn, w: tw, h: round1(100 - 2 * yIn), color, opacity },
  ]
}
// Four corner L-marks (2 ticks per corner, thickness visually even on 16:9).
const cornerTicks = (color, opacity) => {
  const out = []
  for (const cx of [0, 1]) for (const cy of [0, 1]) {
    out.push({ type: 'shape', shape: 'rect', x: cx ? 86 : 4, y: cy ? 91.2 : 7, w: 10, h: 1.8, color, opacity })
    out.push({ type: 'shape', shape: 'rect', x: cx ? 95 : 4, y: cy ? 75.2 : 7, w: 1, h: 17.8, color, opacity })
  }
  return out
}
// Pill badge = rounded rect + centered bold text (radius 4%-of-width ≈ full pill).
const badge = (label, w, color, fs) => [
  { type: 'shape', shape: 'rect', x: round1((100 - w) / 2), y: 43, w, h: 14, color, opacity: 1, radius: 4 },
  { type: 'text', x: round1((100 - w) / 2), y: 43, w, h: 14, content: label, fs, color: '#ffffff', weight: 900, align: 'center', shadow: false },
]

// Element library — categorized prebuilt compositions. Every entry is plain
// layer data the existing renderer already understands; inserts then behave
// exactly like hand-added layers (drag / resize / restyle / delete).
const EL_GROUPS = [
  {
    id: 'shapes', ar: 'الأشكال', en: 'Shapes',
    items: [
      { ar: 'شريط سفلي', en: 'Bottom bar', layers: [{ type: 'shape', shape: 'rect', x: 0, y: 76, w: 100, h: 24, color: '#000000', opacity: 0.55 }] },
      { ar: 'شريط علوي', en: 'Top bar', layers: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 16, color: '#000000', opacity: 0.45 }] },
      { ar: 'لوح جانبي', en: 'Side panel', layers: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 34, h: 100, color: '#000000', opacity: 0.5 }] },
      { ar: 'بطاقة زجاجية', en: 'Glass card', layers: [{ type: 'shape', shape: 'rect', x: 26, y: 22, w: 48, h: 56, color: '#ffffff', opacity: 0.14, radius: 2.5 }] },
      { ar: 'دائرة توهج', en: 'Glow circle', layers: [{ type: 'shape', shape: 'circle', x: 36, y: 25, w: 28, h: 50, color: '#ffffff', opacity: 0.12 }] },
      {
        ar: 'شريط مائل', en: 'Ribbon', layers: [
          { type: 'shape', shape: 'rect', x: 27, y: 44, w: 46, h: 12, color: '#dc2626', opacity: 1, rot: -7, radius: 1 },
          { type: 'text', x: 27, y: 44, w: 46, h: 12, content: 'عرض خاص', fs: 4.2, color: '#ffffff', weight: 900, align: 'center', shadow: false, rot: -7 },
        ],
      },
    ],
  },
  {
    id: 'frames', ar: 'الإطارات', en: 'Frames',
    items: [
      { ar: 'إطار رفيع', en: 'Thin frame', layers: frameLayers(6, 1.5, '#ffffff', 0.9) },
      { ar: 'إطار ذهبي', en: 'Gold frame', layers: frameLayers(8, 2.4, '#c9a24b', 0.95) },
      { ar: 'زوايا', en: 'Corner marks', layers: cornerTicks('#ffffff', 0.92) },
      {
        ar: 'حواف سينمائية', en: 'Cinema bands', layers: [
          { type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 15, color: '#000000', opacity: 0.6 },
          { type: 'shape', shape: 'rect', x: 0, y: 85, w: 100, h: 15, color: '#000000', opacity: 0.6 },
        ],
      },
    ],
  },
  {
    id: 'badges', ar: 'الشارات', en: 'Badges',
    items: [
      { ar: 'جديد', en: 'New', layers: badge('جديد', 18, '#16a34a', 4.2) },
      { ar: 'الأكثر طلباً', en: 'Best seller', layers: badge('الأكثر طلباً', 30, '#d97706', 3.6) },
      { ar: 'خصم خاص', en: 'Discount', layers: badge('خصم خاص', 26, '#dc2626', 4) },
    ],
  },
  {
    id: 'texts', ar: 'النصوص الجاهزة', en: 'Text sets',
    items: [
      {
        ar: 'عنوان + وصف', en: 'Headline + sub', layers: [
          { type: 'text', x: 8, y: 26, w: 84, h: 26, content: 'عنوانك الكبير هنا', fs: 9, color: '#ffffff', weight: 900, align: 'center', shadow: true },
          { type: 'text', x: 14, y: 54, w: 72, h: 14, content: 'سطر وصفي قصير يكمل رسالتك', fs: 4, color: '#ffffff', weight: 400, align: 'center', shadow: true, opacity: 0.88 },
        ],
      },
      {
        ar: 'عنوان ضخم', en: 'Hero title', layers: [
          { type: 'text', x: 5, y: 32, w: 90, h: 36, content: 'عرض اليوم', fs: 13, color: '#ffffff', weight: 900, align: 'center', shadow: true },
        ],
      },
      {
        ar: 'ترويسة + عنوان', en: 'Kicker + title', layers: [
          { type: 'text', x: 20, y: 22, w: 60, h: 9, content: 'لفترة محدودة', fs: 3.2, color: '#fbbf24', weight: 700, align: 'center', shadow: true },
          { type: 'text', x: 8, y: 33, w: 84, h: 26, content: 'خصم نهاية الأسبوع', fs: 8.5, color: '#ffffff', weight: 900, align: 'center', shadow: true },
        ],
      },
    ],
  },
]

// Free-form image generation (no product reference). postGen.generatePostImage
// REQUIRES a reference photo, so this mirrors its exact proxy→direct-key
// pattern for the "describe → image" case. NEVER fakes an image — throws a
// clear Arabic message the toast shows as-is.
const freeImgError = (raw) => {
  const s = String(raw || '')
  if (/(429|quota|exhausted|RESOURCE_EXHAUSTED|rate.?limit)/i.test(s)) return 'استُهلكت حصة توليد الصور مؤقتاً — انتظر دقيقة ثم أعد المحاولة.'
  if (/(503|500|502|overload|unavailable|deadline|timeout)/i.test(s)) return 'نموذج الصور مزدحم الآن — أعد المحاولة بعد لحظات.'
  if (/(404|not.?found|NOT_FOUND|unsupported|is not supported)/i.test(s)) return 'نموذج توليد الصور غير متاح حالياً على هذا المفتاح — جرّب لاحقاً.'
  if (/(unauthenticated|permission)/i.test(s)) return 'توليد الصور متاح للمالك والمدير فقط، وبعد نشر الدوال السحابية.'
  return 'تعذر توليد الصورة: ' + s.slice(0, 140)
}
async function generateFreeImage(desc, venueName) {
  if (!firebaseReady) throw new Error('الذكاء غير مهيأ — أكمل إعداد Firebase أولاً.')
  const prompt = [
    `Professional digital-signage marketing visual for the cafe/restaurant "${venueName || 'a specialty cafe'}".`,
    `Scene description: ${desc}.`,
    'Widescreen 16:9 composition, premium advertising photography quality, rich lighting, appetizing.',
    'Do NOT add any text, letters, numbers, logos or watermarks. If any incidental signage is unavoidable it must be correct, natural Arabic.',
  ].join(' ')
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  }
  let json
  try {
    json = (await httpsCallable(functions, 'geminiProxy')({ model: IMAGE_MODEL, body })).data
  } catch (e) {
    const key = import.meta.env.VITE_GEMINI_API_KEY
    if (!key) throw new Error(freeImgError(e?.message || e))
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(freeImgError(`${r.status} ${await r.text().catch(() => '')}`))
    json = await r.json()
  }
  const img = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
  if (!img) throw new Error('لم يُرجع النموذج صورة — أعد المحاولة أو عدّل الوصف.')
  const bin = atob(img.inlineData.data)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: img.inlineData.mimeType || 'image/png' })
}

export default function SlideDesigner({ slide: initial, tenantId, lang = 'ar', data, onSave, onClose }) {
  const ar = lang === 'ar'
  const toast = useToast()
  const [slide, setSlide] = useState(() => JSON.parse(JSON.stringify(initial || { type: 'design', duration: 10, bg: { kind: 'color', color: '#101826' }, layers: [] })))
  const [selIdx, setSelIdx] = useState((initial?.layers?.length || 0) > 0 ? 0 : -1)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef(null)
  const gesture = useRef(null)
  const hist = useRef({ undo: [], redo: [] })

  // V2 panels + tools
  const [panel, setPanel] = useState('') // '' | 'elements' | 'ai'
  const [elGroup, setElGroup] = useState('shapes')
  const [lib, setLib] = useState(null) // null | 'layer' | 'bg' — media-library picker target
  const [cutBusy, setCutBusy] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiTextBusy, setAiTextBusy] = useState(false)
  const [aiImg, setAiImg] = useState('')
  const [aiRefId, setAiRefId] = useState('')
  const [aiImgBusy, setAiImgBusy] = useState('') // '' | 'bg' | 'layer'

  const layers = slide.layers || []
  const sel = selIdx >= 0 && selIdx < layers.length ? layers[selIdx] : null
  const venueName = data?.venue?.name || ''
  const itemsWithImages = (data?.items || []).filter((it) => it.imageUrl)

  useEffect(() => { if (selIdx >= layers.length) setSelIdx(layers.length - 1) }, [layers.length, selIdx])

  // ---- history (snapshot BEFORE each mutation; drags snapshot once at start)
  const snap = () => {
    const h = hist.current
    h.undo.push(JSON.stringify(slide))
    if (h.undo.length > 60) h.undo.shift()
    h.redo = []
  }
  const undo = () => {
    const h = hist.current
    const prev = h.undo.pop()
    if (!prev) return
    h.redo.push(JSON.stringify(slide))
    setSlide(JSON.parse(prev))
  }
  const redo = () => {
    const h = hist.current
    const next = h.redo.pop()
    if (!next) return
    h.undo.push(JSON.stringify(slide))
    setSlide(JSON.parse(next))
  }

  const apply = (fn) => { snap(); setSlide((s) => fn(s)) }
  const patchLayer = (i, patch, withSnap = true) => {
    const doIt = (s) => { const ls = [...(s.layers || [])]; ls[i] = { ...ls[i], ...patch }; return { ...s, layers: ls } }
    if (withSnap) apply(doIt); else setSlide(doIt)
  }
  const patchSel = (patch) => { if (sel) patchLayer(selIdx, patch) }

  // ---- pointer gestures on the canvas
  const pctPoint = (e) => {
    const r = wrapRef.current.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }
  }
  const rnd = (v) => Math.round(v * 10) / 10
  const onLayerDown = (i, e) => {
    setSelIdx(i)
    const p = pctPoint(e)
    const l = layers[i]
    snap()
    gesture.current = { mode: 'move', i, dx: p.x - l.x, dy: p.y - l.y }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onHandleDown = (i, e) => {
    setSelIdx(i)
    snap()
    gesture.current = { mode: 'resize', i }
    e.target.setPointerCapture?.(e.pointerId)
  }
  const onCanvasMove = (e) => {
    const g = gesture.current
    if (!g) return
    const p = pctPoint(e)
    setSlide((s) => {
      const ls = [...(s.layers || [])]
      const l = { ...ls[g.i] }
      if (g.mode === 'move') { l.x = rnd(Math.max(-30, Math.min(110, p.x - g.dx))); l.y = rnd(Math.max(-30, Math.min(110, p.y - g.dy))) }
      else { l.w = rnd(Math.max(3, Math.min(140, p.x - l.x))); l.h = rnd(Math.max(3, Math.min(140, p.y - l.y))) }
      ls[g.i] = l
      return { ...s, layers: ls }
    })
  }
  const onCanvasUp = () => { gesture.current = null }

  // ---- keyboard: nudge / delete / undo / redo
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); redo(); return }
      if (selIdx < 0) return
      const step = e.shiftKey ? 2 : 0.5
      if (e.key === 'ArrowLeft') { e.preventDefault(); patchLayer(selIdx, { x: rnd((layers[selIdx]?.x || 0) - step) }) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); patchLayer(selIdx, { x: rnd((layers[selIdx]?.x || 0) + step) }) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); patchLayer(selIdx, { y: rnd((layers[selIdx]?.y || 0) - step) }) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); patchLayer(selIdx, { y: rnd((layers[selIdx]?.y || 0) + step) }) }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- layer operations
  const addText = () => apply((s) => ({ ...s, layers: [...(s.layers || []), { id: newLayerId(), type: 'text', x: 10, y: 35, w: 80, h: 30, content: ar ? 'نص جديد' : 'New text', fs: 7, color: '#ffffff', weight: 800, align: 'center', shadow: true }] }))
  const addShape = () => apply((s) => ({ ...s, layers: [...(s.layers || []), { id: newLayerId(), type: 'shape', x: 30, y: 30, w: 40, h: 40, shape: 'rect', color: '#ffffff', opacity: 0.16, radius: 3 }] }))
  const addQr = () => apply((s) => ({ ...s, layers: [...(s.layers || []), { id: newLayerId(), type: 'qr', x: 38, y: 22, w: 24, h: 42, qrKind: 'menu', value: '', radius: 2 }] }))
  const addImageLayer = (url) => apply((s) => ({ ...s, layers: [...(s.layers || []), { id: newLayerId(), type: 'image', x: 25, y: 18, w: 50, h: 64, url, fit: 'cover', radius: 3 }] }))
  const addImage = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || busy) return
    setBusy(true)
    try {
      const url = await uploadImage(tenantId, f, 'signage')
      addImageLayer(url)
    } catch (_) { toast.error(ar ? 'فشل رفع الصورة' : 'Upload failed') } finally { setBusy(false) }
  }
  const onBgImage = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || busy) return
    setBusy(true)
    try {
      const url = await uploadImage(tenantId, f, 'signage')
      apply((s) => ({ ...s, bg: { ...(s.bg || {}), kind: 'image', url } }))
    } catch (_) { toast.error(ar ? 'فشل رفع الصورة' : 'Upload failed') } finally { setBusy(false) }
  }
  const removeSel = () => { if (selIdx >= 0) apply((s) => ({ ...s, layers: (s.layers || []).filter((_, j) => j !== selIdx) })) }
  const duplicateSel = () => { if (sel) apply((s) => ({ ...s, layers: [...(s.layers || []), { ...sel, id: newLayerId(), x: rnd(sel.x + 4), y: rnd(sel.y + 4) }] })) }
  const orderSel = (dir) => {
    if (selIdx < 0) return
    const j = selIdx + dir
    if (j < 0 || j >= layers.length) return
    apply((s) => { const ls = [...(s.layers || [])]; [ls[selIdx], ls[j]] = [ls[j], ls[selIdx]]; return { ...s, layers: ls } })
    setSelIdx(j)
  }

  // ---- element library insert: prebuilt layer group → normal layers
  const insertPreset = (p) => {
    apply((s) => ({ ...s, layers: [...(s.layers || []), ...p.layers.map((l) => ({ id: newLayerId(), ...l }))] }))
    setSelIdx(layers.length + p.layers.length - 1)
  }

  // ---- media-library pick → image layer OR slide background
  const onLibPick = (url) => {
    if (url) {
      if (lib === 'bg') apply((s) => ({ ...s, bg: { ...(s.bg || {}), kind: 'image', url } }))
      else { addImageLayer(url); setSelIdx(layers.length) }
    }
    setLib(null)
  }

  // ---- PNG cutout on the selected image layer (client-side model → upload →
  // swap url). Patch by layer id: selection may move during the slow await.
  const cutBg = async () => {
    if (!sel || sel.type !== 'image' || !sel.url || cutBusy) return
    const id = sel.id
    const srcUrl = sel.url
    setCutBusy(true)
    try {
      const { removeBackgroundToFile } = await import('../lib/bgRemove.js')
      const file = await removeBackgroundToFile(srcUrl, `cutout-${Date.now()}.png`)
      const url = await uploadImage(tenantId, file, 'signage')
      apply((s) => ({ ...s, layers: (s.layers || []).map((l) => (l.id === id ? { ...l, url, fit: 'contain' } : l)) }))
      toast.success(ar ? 'قُصّت الخلفية' : 'Background removed')
    } catch (_) {
      toast.error(ar ? 'تعذّر قصّ الخلفية — جرّب صورة أصغر أو أعد المحاولة' : 'Background removal failed — try a smaller image')
    } finally { setCutBusy(false) }
  }

  // ---- AI: description → headline + sub (strict JSON, parsed defensively).
  // Re-runs UPDATE the previously inserted AI text layers (aiRole marker)
  // instead of stacking duplicates.
  const genText = async () => {
    const desc = aiText.trim()
    if (!desc || aiTextBusy) return
    setAiTextBusy(true)
    try {
      const prompt = [
        `أنت مصمم إعلانات لشاشات العرض داخل منشأة "${venueName || 'مقهى'}".`,
        `حوّل هذا الوصف إلى نص إعلاني عربي: ${desc}`,
        'المطلوب: عنوان قصير جذاب (3 إلى 6 كلمات) وسطر فرعي مكمل (8 إلى 14 كلمة).',
        'أجب بصيغة JSON فقط دون أي شرح أو أسوار كود، بهذا الشكل تماماً: {"headline":"...","sub":"..."}',
        'ممنوع منعاً باتاً: الرموز التعبيرية بكل أنواعها، والأرقام العربية المشرقية — استخدم الأرقام اللاتينية فقط.',
      ].join('\n')
      const raw = await aiQuick(prompt)
      let headline = ''
      let sub = ''
      try {
        const m = /\{[\s\S]*\}/.exec(raw)
        const j = JSON.parse(m ? m[0] : raw)
        headline = cleanCaption(String(j.headline || ''))
        sub = cleanCaption(String(j.sub || ''))
      } catch (_) {
        const lines = String(raw).split('\n').map((l) => l.trim()).filter(Boolean)
        headline = cleanCaption(lines[0] || '')
        sub = cleanCaption(lines.slice(1).join(' '))
      }
      if (!headline) throw new Error('empty')
      apply((s) => {
        const ls = [...(s.layers || [])]
        const upsert = (role, content, base) => {
          const i = ls.findIndex((l) => l.type === 'text' && l.aiRole === role)
          if (i >= 0) ls[i] = { ...ls[i], content }
          else ls.push({ id: newLayerId(), type: 'text', aiRole: role, content, ...base })
        }
        upsert('headline', headline, { x: 8, y: 28, w: 84, h: 24, fs: 8.5, color: '#ffffff', weight: 900, align: 'center', shadow: true })
        if (sub) upsert('sub', sub, { x: 14, y: 54, w: 72, h: 14, fs: 4, color: '#ffffff', weight: 400, align: 'center', shadow: true, opacity: 0.88 })
        return { ...s, layers: ls }
      })
      toast.success(ar ? 'أُدرج النص في الشريحة' : 'Text inserted')
    } catch (_) {
      toast.error(ar ? 'تعذّر توليد النص — أعد المحاولة' : 'Text generation failed — try again')
    } finally { setAiTextBusy(false) }
  }

  // ---- AI: description → image (reference product photo optional) → upload →
  // background or image layer. Real model output only — errors surface as-is.
  const [aiRefFile, setAiRefFile] = useState(null) // uploaded reference (local file — immune to bucket CORS)
  const genImage = async (target) => {
    const desc = aiImg.trim()
    if (!desc || aiImgBusy) return
    setAiImgBusy(target)
    try {
      const refUrl = itemsWithImages.find((it) => it.id === aiRefId)?.imageUrl
      const blob = (refUrl || aiRefFile)
        ? await generatePostImage({ itemImageUrls: refUrl ? [refUrl] : [], refFiles: aiRefFile ? [aiRefFile] : [], stylePrompt: desc, venueName })
        : await generateFreeImage(desc, venueName)
      const file = new File([blob], `ai-slide-${Date.now()}.png`, { type: blob.type || 'image/png' })
      const url = await uploadImage(tenantId, file, 'signage')
      if (target === 'bg') apply((s) => ({ ...s, bg: { ...(s.bg || {}), kind: 'image', url } }))
      else { addImageLayer(url); setSelIdx(layers.length) }
      toast.success(ar ? 'وُلّدت الصورة وأُدرجت' : 'Image generated')
    } catch (e) {
      toast.error(e?.message || (ar ? 'تعذر توليد الصورة' : 'Image generation failed'))
    } finally { setAiImgBusy('') }
  }

  const bg = slide.bg || {}
  const bgKind = bg.kind === 'image' ? 'image' : bg.color2 ? 'gradient' : 'color'
  const setBg = (patch) => apply((s) => ({ ...s, bg: { ...(s.bg || {}), ...patch } }))

  const close = () => {
    if (hist.current.undo.length > 0 && !window.confirm(ar ? 'إغلاق بدون حفظ؟ ستفقد التعديلات.' : 'Close without saving?')) return
    onClose?.()
  }

  const seg = (active) => `btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}`
  const fieldRow = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }
  const elGroupDef = EL_GROUPS.find((g) => g.id === elGroup) || EL_GROUPS[0]

  return (
    <div className="sd2-root" style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <Icon name="palette" size={18} style={{ color: 'var(--brand)' }} />
        <strong style={{ flex: 1 }}>{ar ? 'مصمم الشريحة' : 'Slide designer'}</strong>
        <button className="icon-btn" title={ar ? 'تراجع (Ctrl+Z)' : 'Undo'} onClick={undo}><Icon name="undo" size={16} /></button>
        <button className="icon-btn" title={ar ? 'إعادة (Ctrl+Y)' : 'Redo'} onClick={redo}><Icon name="undo" size={16} style={{ transform: 'scaleX(-1)' }} /></button>
        <button className="btn btn-sm btn-primary" onClick={() => onSave?.(slide)}><Icon name="check" size={15} /> {ar ? 'حفظ الشريحة' : 'Save slide'}</button>
        <button className="icon-btn" onClick={close}><Icon name="close" size={18} /></button>
      </div>

      {/* scrollable body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14 }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* canvas 16:9 — the same renderer the TV uses */}
          <div ref={wrapRef} onPointerMove={onCanvasMove} onPointerUp={onCanvasUp} onPointerLeave={onCanvasUp}
            style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 8px 30px rgba(0,0,0,.18)' }}>
            <DesignSlideView slide={slide} data={data} selIdx={selIdx} onLayerDown={onLayerDown} onHandleDown={onHandleDown} />
          </div>
          <p className="xs faint" style={{ margin: 0, textAlign: 'center' }}>{ar ? 'اسحب العناصر للتحريك، والمقبض السماوي للتحجيم — الأسهم للدقة (Shift أسرع)' : 'Drag to move, cyan handle to resize — arrows nudge (Shift = faster)'}</p>

          {/* add layers + panels + duration */}
          <div style={fieldRow}>
            <button className="btn btn-sm btn-outline" onClick={addText}><Icon name="text" size={14} /> {ar ? 'نص' : 'Text'}</button>
            <button className="btn btn-sm btn-outline" onClick={addShape}><Icon name="shapes" size={14} /> {ar ? 'شكل' : 'Shape'}</button>
            <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
              <Icon name="image" size={14} /> {busy ? (ar ? 'يرفع…' : 'Uploading…') : (ar ? 'صورة' : 'Image')}
              <input type="file" accept="image/*" style={{ display: 'none' }} disabled={busy} onChange={addImage} />
            </label>
            <button className="btn btn-sm btn-outline" onClick={() => setLib('layer')}><Icon name="folder" size={14} /> {ar ? 'من المكتبة' : 'Library'}</button>
            <button className="btn btn-sm btn-outline" onClick={addQr}><Icon name="qr" size={14} /> QR</button>
            <button className={seg(panel === 'elements')} onClick={() => setPanel(panel === 'elements' ? '' : 'elements')}><Icon name="grid" size={14} /> {ar ? 'عناصر' : 'Elements'}</button>
            <button className={seg(panel === 'ai')} onClick={() => setPanel(panel === 'ai' ? '' : 'ai')}><Icon name="sparkles" size={14} /> {ar ? 'مساعد الشريحة' : 'Assistant'}</button>
            <span style={{ flex: 1 }} />
            <label className="xs faint">{ar ? 'المدة (ث)' : 'Duration (s)'}</label>
            <input className="input num" type="number" min="3" max="120" value={slide.duration || 10} style={{ width: 74 }}
              onChange={(e) => apply((s) => ({ ...s, duration: Math.max(3, Math.min(120, Number(e.target.value) || 10)) }))} />
          </div>

          {/* element library — categorized prebuilt inserts with live previews */}
          {panel === 'elements' && (
            <div className="card card-pad sd2-panel">
              <div style={fieldRow}>
                {EL_GROUPS.map((g) => (
                  <button key={g.id} className={seg(elGroup === g.id)} onClick={() => setElGroup(g.id)}>{ar ? g.ar : g.en}</button>
                ))}
              </div>
              <div className="sd2-grid">
                {elGroupDef.items.map((p, i) => (
                  <button key={i} className="sd2-el" onClick={() => insertPreset(p)} title={ar ? p.ar : p.en}>
                    <span className="sd2-el-prev">
                      <DesignSlideView slide={{ type: 'design', duration: 0, bg: { kind: 'color', color: '#182234' }, layers: p.layers }} />
                    </span>
                    <span className="xs">{ar ? p.ar : p.en}</span>
                  </button>
                ))}
              </div>
              <p className="xs faint" style={{ margin: 0 }}>{ar ? 'كل عنصر يُدرج كطبقات عادية — حرّكها وعدّل ألوانها كأي طبقة' : 'Every element inserts as normal layers — drag and restyle freely'}</p>
            </div>
          )}

          {/* AI assistant — description → text layers / generated image */}
          {panel === 'ai' && (
            <div className="card card-pad sd2-panel">
              <strong className="small"><Icon name="sparkles" size={14} style={{ verticalAlign: 'middle', color: 'var(--brand)' }} /> {ar ? 'مساعد الشريحة' : 'Slide assistant'}</strong>
              <label className="xs faint">{ar ? 'صف الإعلان وسيُكتب لك عنوان وسطر فرعي جاهزان' : 'Describe the ad — get a headline + subline'}</label>
              <textarea className="input" rows={2} value={aiText} onChange={(e) => setAiText(e.target.value)} style={{ resize: 'vertical', minHeight: 44 }}
                placeholder={ar ? 'مثال: عرض نهاية الأسبوع على القهوة المختصة بخصم 20%' : 'e.g. weekend specialty-coffee offer, 20% off'} />
              <div style={fieldRow}>
                <button className="btn btn-sm btn-primary" disabled={aiTextBusy || !aiText.trim()} onClick={genText}>
                  <Icon name="text" size={13} /> {aiTextBusy ? (ar ? 'يولّد…' : 'Generating…') : (ar ? 'توليد نص' : 'Generate text')}
                </button>
                <span className="xs faint">{ar ? 'التوليد مرة أخرى يحدّث نفس الطبقتين' : 'Re-running updates the same two layers'}</span>
              </div>
              <div className="sd2-sep" />
              <label className="xs faint">{ar ? 'صف مشهداً لتوليد صورة بالذكاء — واختيارياً اختر صنفاً بصورة كمرجع للمنتج' : 'Describe a scene to generate an image — optionally pick a menu item photo as product reference'}</label>
              <textarea className="input" rows={2} value={aiImg} onChange={(e) => setAiImg(e.target.value)} style={{ resize: 'vertical', minHeight: 44 }}
                placeholder={ar ? 'مثال: كوب قهوة مثلجة على طاولة رخامية بإضاءة ذهبية دافئة' : 'e.g. iced coffee on a marble table, warm golden light'} />
              <div style={fieldRow}>
                <select className="select" style={{ maxWidth: 230 }} value={aiRefId} onChange={(e) => setAiRefId(e.target.value)}>
                  <option value="">{ar ? 'بلا صنف مرجعي (مشهد حر)' : 'No reference item (free scene)'}</option>
                  {itemsWithImages.map((it) => <option key={it.id} value={it.id}>{it.nameAr || it.nameEn}</option>)}
                </select>
                <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }} title={ar ? 'ارفع صورة مرجعية مباشرة (منتج/شعار)' : 'Upload a direct reference'}>
                  <Icon name="upload" size={13} /> {aiRefFile ? aiRefFile.name.slice(0, 14) : (ar ? 'رفع مرجع' : 'Upload ref')}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setAiRefFile(f) }} />
                </label>
                {aiRefFile && <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setAiRefFile(null)}><Icon name="close" size={12} /></button>}
                <button className="btn btn-sm btn-outline" disabled={!!aiImgBusy || !aiImg.trim()} onClick={() => genImage('bg')}>
                  <Icon name="image" size={13} /> {aiImgBusy === 'bg' ? (ar ? 'يولّد…' : 'Generating…') : (ar ? 'توليد كخلفية' : 'Generate as background')}
                </button>
                <button className="btn btn-sm btn-outline" disabled={!!aiImgBusy || !aiImg.trim()} onClick={() => genImage('layer')}>
                  <Icon name="layers" size={13} /> {aiImgBusy === 'layer' ? (ar ? 'يولّد…' : 'Generating…') : (ar ? 'توليد كعنصر' : 'Generate as layer')}
                </button>
              </div>
              <p className="xs faint" style={{ margin: 0 }}>{ar ? 'قد يستغرق التوليد حتى 30 ثانية — عند فشل النموذج لا تُدرج أي صورة بديلة.' : 'Generation can take up to 30 seconds — on model failure nothing fake is inserted.'}</p>
            </div>
          )}

          {/* background */}
          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <strong className="small">{ar ? 'الخلفية' : 'Background'}</strong>
            <div style={fieldRow}>
              <button className={seg(bgKind === 'color')} onClick={() => setBg({ kind: 'color', color2: '', url: '' })}>{ar ? 'لون' : 'Color'}</button>
              <button className={seg(bgKind === 'gradient')} onClick={() => setBg({ kind: 'color', color2: bg.color2 || '#3b0d0d', angle: bg.angle ?? 135, url: '' })}>{ar ? 'تدرج' : 'Gradient'}</button>
              <label className={seg(bgKind === 'image')} style={{ cursor: 'pointer' }}>
                {ar ? 'صورة' : 'Image'}
                <input type="file" accept="image/*" style={{ display: 'none' }} disabled={busy} onChange={onBgImage} />
              </label>
              <button className="btn btn-sm btn-outline" onClick={() => setLib('bg')}><Icon name="folder" size={13} /> {ar ? 'من المكتبة' : 'Library'}</button>
              {bgKind !== 'image' && <input type="color" value={bg.color || '#101826'} onChange={(e) => setBg({ color: e.target.value })} style={{ width: 40, height: 30, border: 'none', background: 'transparent', cursor: 'pointer' }} />}
              {bgKind === 'gradient' && (
                <>
                  <input type="color" value={bg.color2 || '#3b0d0d'} onChange={(e) => setBg({ color2: e.target.value })} style={{ width: 40, height: 30, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                  <label className="xs faint">{ar ? 'الزاوية' : 'Angle'}</label>
                  <input type="range" min="0" max="360" value={bg.angle ?? 135} onChange={(e) => setBg({ angle: Number(e.target.value) })} style={{ width: 120 }} />
                </>
              )}
            </div>
          </div>

          {/* selected layer properties */}
          {sel ? (
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={fieldRow}>
                <strong className="small" style={{ flex: 1 }}>
                  <Icon name="layers" size={14} style={{ verticalAlign: 'middle' }} /> {sel.type === 'text' ? (ar ? 'طبقة نص' : 'Text layer') : sel.type === 'image' ? (ar ? 'طبقة صورة' : 'Image layer') : sel.type === 'qr' ? (ar ? 'طبقة QR' : 'QR layer') : (ar ? 'طبقة شكل' : 'Shape layer')}
                </strong>
                <button className="btn btn-sm btn-outline" onClick={() => orderSel(1)} title={ar ? 'تقديم للأمام' : 'Bring forward'}><Icon name="arrowUp" size={13} /> {ar ? 'أمام' : 'Front'}</button>
                <button className="btn btn-sm btn-outline" onClick={() => orderSel(-1)} title={ar ? 'إرسال للخلف' : 'Send back'}><Icon name="arrowUp" size={13} style={{ transform: 'rotate(180deg)' }} /> {ar ? 'خلف' : 'Back'}</button>
                <button className="btn btn-sm btn-outline" onClick={duplicateSel}><Icon name="copy" size={13} /> {ar ? 'تكرار' : 'Duplicate'}</button>
                <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={removeSel}><Icon name="delete" size={13} /></button>
              </div>

              {sel.type === 'text' && (
                <>
                  <textarea className="input" rows={2} value={sel.content || ''} onChange={(e) => patchSel({ content: e.target.value })} style={{ resize: 'vertical', minHeight: 46 }} />
                  <div style={fieldRow}>
                    <label className="xs faint">{ar ? 'الحجم' : 'Size'}</label>
                    <input type="range" min="2" max="18" step="0.5" value={sel.fs || 7} onChange={(e) => patchSel({ fs: Number(e.target.value) })} style={{ width: 140 }} />
                    <input type="color" value={sel.color || '#ffffff'} onChange={(e) => patchSel({ color: e.target.value })} style={{ width: 40, height: 30, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                    <button className={seg(Number(sel.weight) === 400)} onClick={() => patchSel({ weight: 400 })}>{ar ? 'عادي' : 'Reg'}</button>
                    <button className={seg(!sel.weight || Number(sel.weight) === 800)} onClick={() => patchSel({ weight: 800 })}>{ar ? 'عريض' : 'Bold'}</button>
                    <button className={seg(Number(sel.weight) === 900)} onClick={() => patchSel({ weight: 900 })}>{ar ? 'أسود' : 'Black'}</button>
                  </div>
                  <div style={fieldRow}>
                    <label className="xs faint">{ar ? 'المحاذاة' : 'Align'}</label>
                    <button className={seg(sel.align === 'start')} onClick={() => patchSel({ align: 'start' })}>{ar ? 'بداية' : 'Start'}</button>
                    <button className={seg(!sel.align || sel.align === 'center')} onClick={() => patchSel({ align: 'center' })}>{ar ? 'وسط' : 'Center'}</button>
                    <button className={seg(sel.align === 'end')} onClick={() => patchSel({ align: 'end' })}>{ar ? 'نهاية' : 'End'}</button>
                    <label className="row xs" style={{ gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                      <input type="checkbox" checked={sel.shadow !== false} onChange={(e) => patchSel({ shadow: e.target.checked })} /> {ar ? 'ظل' : 'Shadow'}
                    </label>
                  </div>
                  {/* live binding: text pulls item / active-offer data from Firestore */}
                  <div style={fieldRow}>
                    <label className="xs faint"><Icon name="zap" size={12} style={{ verticalAlign: 'middle' }} /> {ar ? 'ربط حي' : 'Live binding'}</label>
                    <select className="select" style={{ maxWidth: 190 }} value={sel.binding?.kind || ''}
                      onChange={(e) => { const kind = e.target.value; patchSel({ binding: kind ? { kind, itemId: sel.binding?.itemId || (data?.items?.[0]?.id || '') } : null }) }}>
                      <option value="">{ar ? 'بلا ربط (نص ثابت)' : 'None (static)'}</option>
                      <option value="itemName">{ar ? 'اسم صنف' : 'Item name'}</option>
                      <option value="itemPrice">{ar ? 'سعر صنف' : 'Item price'}</option>
                      <option value="offerTitle">{ar ? 'اسم العرض النشط' : 'Active offer name'}</option>
                      <option value="offerValue">{ar ? 'قيمة العرض النشط' : 'Active offer value'}</option>
                      <option value="offerCode">{ar ? 'كود العرض النشط' : 'Active offer code'}</option>
                    </select>
                    {(sel.binding?.kind === 'itemName' || sel.binding?.kind === 'itemPrice') && (
                      <select className="select" style={{ maxWidth: 190 }} value={sel.binding?.itemId || ''}
                        onChange={(e) => patchSel({ binding: { ...sel.binding, itemId: e.target.value } })}>
                        {(data?.items || []).map((it) => <option key={it.id} value={it.id}>{it.nameAr || it.nameEn}</option>)}
                      </select>
                    )}
                  </div>
                  {sel.binding?.kind?.startsWith('offer') && (
                    <p className="xs faint" style={{ margin: 0 }}>{ar ? 'يُعرض النص الثابت أعلاه تلقائياً عندما لا يوجد عرض نشط.' : 'The static text above shows automatically when no offer is active.'}</p>
                  )}
                </>
              )}

              {sel.type === 'qr' && (
                <>
                  <div style={fieldRow}>
                    <button className={seg(!sel.qrKind || sel.qrKind === 'menu')} onClick={() => patchSel({ qrKind: 'menu' })}>{ar ? 'رابط المنيو' : 'Menu link'}</button>
                    <button className={seg(sel.qrKind === 'custom')} onClick={() => patchSel({ qrKind: 'custom' })}>{ar ? 'رابط مخصص' : 'Custom URL'}</button>
                    <label className="xs faint">{ar ? 'لون' : 'Color'}</label>
                    <input type="color" value={sel.dark || '#111111'} onChange={(e) => patchSel({ dark: e.target.value })} style={{ width: 40, height: 30, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                    <label className="xs faint">{ar ? 'استدارة' : 'Radius'}</label>
                    <input type="range" min="0" max="10" value={sel.radius || 0} onChange={(e) => patchSel({ radius: Number(e.target.value) })} style={{ width: 100 }} />
                  </div>
                  {sel.qrKind === 'custom' && (
                    <input className="input" dir="ltr" placeholder="https://…" value={sel.value || ''} onChange={(e) => patchSel({ value: e.target.value })} />
                  )}
                </>
              )}

              {sel.type === 'image' && (
                <div style={fieldRow}>
                  <button className={seg(!sel.fit || sel.fit === 'cover')} onClick={() => patchSel({ fit: 'cover' })}>{ar ? 'تعبئة' : 'Cover'}</button>
                  <button className={seg(sel.fit === 'contain')} onClick={() => patchSel({ fit: 'contain' })}>{ar ? 'احتواء' : 'Contain'}</button>
                  <label className="xs faint">{ar ? 'استدارة' : 'Radius'}</label>
                  <input type="range" min="0" max="25" value={sel.radius || 0} onChange={(e) => patchSel({ radius: Number(e.target.value) })} style={{ width: 120 }} />
                  <button className="btn btn-sm btn-outline" disabled={cutBusy || !sel.url} onClick={cutBg}>
                    <Icon name="sparkles" size={13} /> {cutBusy ? (ar ? 'يقصّ…' : 'Cutting…') : (ar ? 'قصّ الخلفية' : 'Cut background')}
                  </button>
                </div>
              )}

              {sel.type === 'shape' && (
                <div style={fieldRow}>
                  <button className={seg(!sel.shape || sel.shape === 'rect')} onClick={() => patchSel({ shape: 'rect' })}>{ar ? 'مستطيل' : 'Rect'}</button>
                  <button className={seg(sel.shape === 'circle')} onClick={() => patchSel({ shape: 'circle' })}>{ar ? 'دائرة' : 'Circle'}</button>
                  <input type="color" value={sel.color || '#ffffff'} onChange={(e) => patchSel({ color: e.target.value })} style={{ width: 40, height: 30, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                  {(!sel.shape || sel.shape === 'rect') && (
                    <>
                      <label className="xs faint">{ar ? 'استدارة' : 'Radius'}</label>
                      <input type="range" min="0" max="25" value={sel.radius || 0} onChange={(e) => patchSel({ radius: Number(e.target.value) })} style={{ width: 120 }} />
                    </>
                  )}
                </div>
              )}

              {/* precision: exact position/size + opacity + rotation */}
              <div style={fieldRow}>
                {[['X', 'x', -30, 110], ['Y', 'y', -30, 110], [ar ? 'عرض' : 'W', 'w', 3, 140], [ar ? 'ارتفاع' : 'H', 'h', 3, 140]].map(([lb, k, mn, mx]) => (
                  <label key={k} className="xs faint" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {lb}
                    <input className="input num" type="number" step="0.5" value={sel[k] ?? 0} style={{ width: 64 }}
                      onChange={(e) => patchSel({ [k]: rnd(Math.max(mn, Math.min(mx, Number(e.target.value) || 0))) })} />
                  </label>
                ))}
              </div>
              <div style={fieldRow}>
                <label className="xs faint">{ar ? 'الشفافية' : 'Opacity'}</label>
                <input type="range" min="0.05" max="1" step="0.05" value={sel.opacity ?? 1} onChange={(e) => patchSel({ opacity: Number(e.target.value) })} style={{ width: 120 }} />
                <label className="xs faint">{ar ? 'الدوران' : 'Rotate'}</label>
                <input type="range" min="-180" max="180" step="1" value={sel.rot || 0} onChange={(e) => patchSel({ rot: Number(e.target.value) })} style={{ width: 140 }} />
                <span className="xs num">{sel.rot || 0}°</span>
                {sel.rot ? <button className="btn btn-sm btn-outline" onClick={() => patchSel({ rot: 0 })}>{ar ? 'تصفير' : 'Reset'}</button> : null}
              </div>
            </div>
          ) : (
            <p className="xs faint" style={{ margin: 0, textAlign: 'center' }}>{ar ? 'اختر عنصراً من الكانفس لتعديله، أو أضف نصاً / شكلاً / صورة' : 'Tap a layer to edit it, or add text / shape / image'}</p>
          )}
        </div>
      </div>

      {/* media-library picker — sd2-root CSS lifts the sheet above this overlay */}
      {lib && (
        <MediaLibrary open tenantId={tenantId} lang={lang} kind="image" folder="signage"
          onClose={() => setLib(null)} onPick={onLibPick} />
      )}
    </div>
  )
}
