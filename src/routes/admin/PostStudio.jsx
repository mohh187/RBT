import { useEffect, useRef, useState } from 'react'
import { collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, limit, serverTimestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase.js'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import Sheet from '../../components/Sheet.jsx'
import { listItems, addStory, addPost, saveCampaign, updateTenant } from '../../lib/db.js'
import { uploadImage } from '../../lib/storage.js'
import { generatePostImage, generateCaption, PRESET_STYLES, cleanCaption } from '../../lib/postGen.js'
import { aiQuick, aiConfigured } from '../../lib/aiBridge.js'
import { CAP } from '../../lib/permissions.js'

// Post Studio: AI (nano-banana) or manual-canvas marketing designs → an APPROVAL
// queue (tenants/{tid}/marketingPosts) → on explicit approval only: publish as a
// story / a profile post / a WhatsApp campaign. Nothing auto-publishes, ever.
// Firestore rules for marketingPosts: staff read, manage_campaigns write (deployed by lead).
const mpDoc = (tid, id) => doc(db, 'tenants', tid, 'marketingPosts', id)
const watchMarketingPosts = (tid, cb) => onSnapshot(
  query(collection(db, 'tenants', tid, 'marketingPosts'), orderBy('createdAt', 'desc'), limit(80)),
  (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]),
)
const addMarketingPost = (tid, data) => addDoc(collection(db, 'tenants', tid, 'marketingPosts'), { status: 'draft', caption: '', ...data, createdAt: serverTimestamp() })
const patchMarketingPost = (tid, id, patch) => updateDoc(mpDoc(tid, id), { ...patch, updatedAt: serverTimestamp() })
const deleteMarketingPost = (tid, id) => deleteDoc(mpDoc(tid, id))

const tsMs = (v) => (v?.toMillis ? v.toMillis() : Number(v) || 0)
const iName = (i) => i?.nameAr || i?.name || i?.nameEn || ''
const hexToRgba = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return `rgba(124, 45, 45, ${a})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

const CANVAS_W = 1080
const CANVAS_H = 1350 // 4:5 portrait — the standard feed-post frame
const SIZES = { s: [58, 34], m: [76, 42], l: [96, 52] }
const TONES = [['', 'راقي (افتراضي)', 'Elegant (default)'], ['حماسي وشبابي', 'حماسي', 'Energetic'], ['ودود وعائلي', 'ودود', 'Friendly']]

// V2 — seasonal presets LOCAL to this page: PRESET_STYLES lives in postGen.js and
// is shared with the assistant/pilot pipelines, so extra entries are merged here only.
const EXTRA_STYLES = [
  { id: 'national', ar: 'اليوم الوطني', prompt: 'Saudi National Day celebration theme, elegant green and white palette, subtle Saudi flag and falcon motifs softly blurred in the background, festive green uplighting, proud premium celebratory mood' },
  { id: 'school', ar: 'العودة للمدارس', prompt: 'back-to-school season theme, cheerful bright morning scene, notebooks pencils and a backpack softly blurred in the background, crisp optimistic daylight, energetic fresh-start mood' },
  { id: 'winter', ar: 'الشتاء', prompt: 'cozy winter theme, gentle steam rising from the drink, knitted wool and warm blanket textures, soft cool daylight through a fogged window, comforting hot-drink season mood' },
]
const ALL_STYLES = [...PRESET_STYLES, ...EXTRA_STYLES]

// V2 — defensive parse of the 30-day plan: strips code fences, grabs the first
// JSON array, validates/clamps every entry, de-dupes days, hygienes captions.
function parsePlan(raw) {
  let s = String(raw || '').trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s)
  if (fence) s = fence[1]
  const a = s.indexOf('[')
  const b = s.lastIndexOf(']')
  if (a < 0 || b <= a) return []
  let arr
  try { arr = JSON.parse(s.slice(a, b + 1)) } catch (_) { return [] }
  if (!Array.isArray(arr)) return []
  const seen = new Set()
  const out = []
  for (const e of arr) {
    const day = Math.round(Number(e?.day))
    if (!Number.isFinite(day) || day < 1 || day > 31 || seen.has(day)) continue
    const idea = cleanCaption(String(e?.idea || '')).slice(0, 180)
    const caption = cleanCaption(String(e?.caption || '')).slice(0, 600)
    if (!idea && !caption) continue
    seen.add(day)
    out.push({ day, idea, itemName: String(e?.itemName || '').slice(0, 60), caption })
  }
  return out.sort((x, y) => x.day - y.day).slice(0, 30)
}

export default function PostStudio() {
  const { t, lang } = useI18n()
  const ar = lang === 'ar'
  const { tenantId, tenant, updateTenantLocal, can } = useAuth()
  const toast = useToast()
  const canWrite = can(CAP.MANAGE_CAMPAIGNS)
  const canStories = can(CAP.MANAGE_STORIES)
  const brand = tenant?.brandColor || tenant?.themeColor || '#7c2d2d'

  const [items, setItems] = useState(null)
  const [drafts, setDrafts] = useState(null)
  const [tab, setTab] = useState('ai')

  // ---- AI generation state ----
  const [aiItemId, setAiItemId] = useState('')
  const [styleId, setStyleId] = useState(PRESET_STYLES[0].id)
  const [freePrompt, setFreePrompt] = useState('')
  const [tone, setTone] = useState('')
  const [offer, setOffer] = useState('')
  const [genBusy, setGenBusy] = useState('') // '' | 'image' | 'imageA' | 'imageB' | 'caption' | 'translate'
  const [preview, setPreview] = useState(null) // { blob, url, caption }
  const [saveBusy, setSaveBusy] = useState(false)
  const [abMode, setAbMode] = useState(false) // V2: A/B — two variants, pick one
  const [abPair, setAbPair] = useState(null) // { a: {blob,url}, b: {blob,url} | null }
  const [planBusy, setPlanBusy] = useState(false) // V2: 30-day content plan
  const [draftGenId, setDraftGenId] = useState('') // V2: per-draft image generation
  const [transId, setTransId] = useState('') // V2: per-draft translation

  // ---- manual composer state ----
  const canvasRef = useRef(null)
  const mUrlRef = useRef('')
  const [mImg, setMImg] = useState(null)
  const [mBusy, setMBusy] = useState(false)
  const [headline, setHeadline] = useState('')
  const [subline, setSubline] = useState('')
  const [mCaption, setMCaption] = useState('')
  const [textColor, setTextColor] = useState('#ffffff')
  const [sizeKey, setSizeKey] = useState('m')
  const [posKey, setPosKey] = useState('bottom')
  const [band, setBand] = useState(true)

  // Content brief handed over by the behaviour planner («صمّم بالذكاء»): it
  // arrives via sessionStorage because it is a full brief, not a URL param.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!new URLSearchParams(window.location.search).get('draft')) return
    try {
      const raw = sessionStorage.getItem('rbt_content_draft')
      sessionStorage.removeItem('rbt_content_draft')
      if (!raw) return
      const d = JSON.parse(raw)
      const brief = [d?.subject, d?.style].filter(Boolean).join(' — ')
      if (brief) setFreePrompt(brief)
      if (d?.caption) setMCaption(String(d.caption))
      if (Array.isArray(d?.itemIds) && d.itemIds[0]) setAiItemId(String(d.itemIds[0]))
    } catch (_) { /* malformed brief: the studio simply opens empty */ }
  }, [])

  // ---- publish-as-campaign sheet ----
  const [campFor, setCampFor] = useState(null) // draft doc
  const [campAudience, setCampAudience] = useState('all')
  const [campBusy, setCampBusy] = useState(false)

  const [pilotBusy, setPilotBusy] = useState(false)
  const pilotRan = useRef(false)

  useEffect(() => {
    if (!tenantId) return
    listItems(tenantId).then(setItems).catch(() => setItems([]))
    return watchMarketingPosts(tenantId, setDrafts)
  }, [tenantId])

  const withImages = (items || []).filter((i) => i.imageUrl || (i.images || []).length)

  // ---------- AI generate ----------
  const buildStylePrompt = () => {
    const p = ALL_STYLES.find((s) => s.id === styleId)
    return [p?.prompt, freePrompt.trim()].filter(Boolean).join(', ')
  }
  const refUrls = (it) => [it?.imageUrl, ...(it?.images || [])].filter(Boolean)

  const [refFiles, setRefFiles] = useState([]) // directly-uploaded references (product/logo) — no CORS involved
  const [imitateRef, setImitateRef] = useState(false) // replicate the uploaded design EXACTLY with only the described changes
  const genOneImage = (it) => generatePostImage({ itemImageUrls: it ? refUrls(it) : [], refFiles, stylePrompt: buildStylePrompt(), venueName: tenant?.name || '', tenant, imitate: imitateRef })
  const discardAb = () => setAbPair((p) => { if (p?.a?.url) URL.revokeObjectURL(p.a.url); if (p?.b?.url) URL.revokeObjectURL(p.b.url); return null })
  const regenImage = async () => {
    const it = withImages.find((i) => i.id === aiItemId)
    if (!it && !refFiles.length && !freePrompt.trim()) { toast.error(ar ? 'اختر صنفاً أو ارفع صورة مرجعية أو صف المشهد' : 'Pick an item, upload a reference, or describe the scene'); return }
    discardAb()
    if (!abMode) {
      setGenBusy('image')
      try {
        const blob = await genOneImage(it)
        const url = URL.createObjectURL(blob)
        setPreview((p) => { if (p?.url) URL.revokeObjectURL(p.url); return { blob, url, caption: p?.caption || '' } })
      } catch (e) { toast.error(String(e?.message || e)) }
      finally { setGenBusy('') }
      return
    }
    // V2 A/B: two sequential generations (same prompt — model variance), pick one
    setGenBusy('imageA')
    let a = null
    try {
      const blob = await genOneImage(it)
      a = { blob, url: URL.createObjectURL(blob) }
      setAbPair({ a, b: null })
    } catch (e) { toast.error(String(e?.message || e)); setGenBusy(''); return }
    setGenBusy('imageB')
    try {
      const blob = await genOneImage(it)
      setAbPair({ a, b: { blob, url: URL.createObjectURL(blob) } })
    } catch (_) {
      // second variant failed — keep the first as the preview, with a note
      setAbPair(null)
      setPreview((p) => { if (p?.url) URL.revokeObjectURL(p.url); return { blob: a.blob, url: a.url, caption: p?.caption || '' } })
      toast.error(ar ? 'تعذر توليد النسخة الثانية — اعتُمدت الأولى' : 'Second variant failed — kept the first')
    }
    finally { setGenBusy('') }
  }
  const pickAb = (k) => {
    const pair = abPair
    const win = pair?.[k]
    if (!win) return
    const lose = pair[k === 'a' ? 'b' : 'a']
    if (lose?.url) URL.revokeObjectURL(lose.url)
    setPreview((p) => { if (p?.url) URL.revokeObjectURL(p.url); return { blob: win.blob, url: win.url, caption: p?.caption || '' } })
    setAbPair(null)
  }
  const regenCaption = async () => {
    const it = (items || []).find((i) => i.id === aiItemId)
    if (!it) { toast.error(ar ? 'اختر صنفاً أولاً' : 'Pick an item first'); return }
    setGenBusy('caption')
    try {
      const caption = await generateCaption({ itemName: iName(it), venueName: tenant?.name || '', tone, offer: offer.trim() })
      setPreview((p) => (p ? { ...p, caption } : { blob: null, url: '', caption }))
    } catch (e) { toast.error(String(e?.message || e)) }
    finally { setGenBusy('') }
  }
  const doGenerate = async () => {
    await regenImage()
    await regenCaption()
  }

  // ---------- V2: EN translation appended under the Arabic ----------
  const hasEnglishTail = (cap) => {
    const parts = String(cap || '').trim().split(/\n\s*\n/)
    const last = parts[parts.length - 1] || ''
    const latin = (last.match(/[A-Za-z]/g) || []).length
    return latin > 15 && latin > (last.match(/[؀-ۿ]/g) || []).length
  }
  const translateCaption = async (text) => {
    const out = cleanCaption(await aiQuick([
      'Translate this Arabic cafe/restaurant marketing caption into natural, polished ENGLISH marketing copy (marketing tone, not literal).',
      'Keep the hashtags line: translate it into fitting English hashtags.',
      'No emojis. Reply with the English text only, no explanations.',
      '---',
      String(text || '').trim(),
    ].join('\n')))
    if (!out) throw new Error(ar ? 'لم تصل ترجمة — أعد المحاولة' : 'No translation returned — retry')
    return out
  }
  const translatePreview = async () => {
    const cap = (preview?.caption || '').trim()
    if (!cap || genBusy) return
    if (hasEnglishTail(cap)) { toast.error(ar ? 'النص مُترجم مسبقاً' : 'Already translated'); return }
    setGenBusy('translate')
    try {
      const en = await translateCaption(cap)
      setPreview((p) => (p ? { ...p, caption: `${(p.caption || '').trim()}\n\n${en}` } : p))
    } catch (e) { toast.error(String(e?.message || e)) }
    finally { setGenBusy('') }
  }
  const translateDraft = async (d) => {
    if (transId) return
    const cap = (d.caption || '').trim()
    if (!cap) return
    if (hasEnglishTail(cap)) { toast.error(ar ? 'النص مُترجم مسبقاً' : 'Already translated'); return }
    setTransId(d.id)
    try { await patchMarketingPost(tenantId, d.id, { caption: `${cap}\n\n${await translateCaption(cap)}` }) }
    catch (e) { draftError(e) }
    finally { setTransId('') }
  }

  // ---------- V2: prompt library (tenant.promptLibrary, max 20) ----------
  const promptLib = Array.isArray(tenant?.promptLibrary) ? tenant.promptLibrary : []
  const persistLib = async (next) => {
    try { await updateTenant(tenantId, { promptLibrary: next }); updateTenantLocal?.({ promptLibrary: next }) }
    catch (_) { toast.error(t('error')) }
  }
  const savePromptToLib = async () => {
    const prompt = freePrompt.trim()
    if (!prompt) { toast.error(ar ? 'اكتب الوصف الحر أولاً' : 'Write the free prompt first'); return }
    const name = (window.prompt(ar ? 'اسم البرومبت:' : 'Prompt name:', prompt.slice(0, 24)) || '').trim().slice(0, 40)
    if (!name) return
    const rest = promptLib.filter((p) => p?.name !== name)
    if (rest.length >= 20) { toast.error(ar ? 'الحد 20 برومبتاً — احذف واحداً أولاً' : 'Limit is 20 prompts — delete one first'); return }
    await persistLib([{ name, prompt: prompt.slice(0, 400), styleId }, ...rest])
    toast.success(t('saved'))
  }
  const applyLibPrompt = (p) => {
    setFreePrompt(p?.prompt || '')
    if (p?.styleId && ALL_STYLES.some((s) => s.id === p.styleId)) setStyleId(p.styleId)
  }
  const removeLibPrompt = (p) => persistLib(promptLib.filter((x) => x?.name !== p?.name))

  // ---------- V2: 30-day content calendar (tenant.contentPlan) ----------
  const plan = tenant?.contentPlan || null
  const generatePlan = async () => {
    if (planBusy || !canWrite) return
    if (plan?.entries?.length && !window.confirm(ar ? 'توجد خطة محفوظة — استبدالها بخطة جديدة؟' : 'A saved plan exists — replace it?')) return
    setPlanBusy(true)
    try {
      const tops = [...(items || [])].sort((x, y) => (Number(y.soldCount) || 0) - (Number(x.soldCount) || 0)).slice(0, 8).map(iName).filter(Boolean)
      const entries = parsePlan(await aiQuick([
        'أنت مخطط محتوى تسويقي محترف لمنشآت الضيافة السعودية.',
        `أنشئ خطة محتوى لمدة 30 يوماً لمنشأة "${tenant?.name || 'مقهى'}".`,
        tops.length ? `أصنافها الأكثر مبيعاً: ${tops.join('، ')}.` : '',
        'أجب بمصفوفة JSON صارمة فقط دون أي شرح أو Markdown أو أسوار كود، بهذا الشكل بالضبط:',
        '[{"day":1,"idea":"فكرة قصيرة للمنشور","itemName":"اسم صنف من القائمة أو اتركه فارغاً","caption":"نص المنشور الجاهز من سطرين مع هاشتاقات"}]',
        '30 عنصراً (day من 1 إلى 30) مع تنويع: أصناف، عروض، مناسبات، محتوى تفاعلي، كواليس.',
        'ممنوع: الرموز التعبيرية والأرقام العربية المشرقية — أرقام لاتينية فقط.',
      ].filter(Boolean).join('\n')))
      if (!entries.length) throw new Error(ar ? 'تعذرت قراءة خطة صالحة من الذكاء — أعد المحاولة' : 'Could not parse a valid plan — retry')
      const next = { month: new Date().toISOString().slice(0, 7), entries, createdAt: Date.now() }
      await updateTenant(tenantId, { contentPlan: next })
      updateTenantLocal?.({ contentPlan: next })
      toast.success(ar ? `جاهزة — خطة ${entries.length} يوماً` : `Ready — a ${entries.length}-day plan`)
    } catch (e) { toast.error(String(e?.message || e)) }
    finally { setPlanBusy(false) }
  }
  const planToDraft = async (entry, idx) => {
    if (!canWrite) return
    try {
      await addMarketingPost(tenantId, { kind: 'ai', caption: entry.caption || entry.idea || '', plannedDay: entry.day, itemName: entry.itemName || '', imageUrl: '' })
      const entries = (plan?.entries || []).map((e, i) => (i === idx ? { ...e, drafted: true } : e))
      const next = { ...plan, entries }
      updateTenant(tenantId, { contentPlan: next }).then(() => updateTenantLocal?.({ contentPlan: next })).catch(() => {})
      toast.success(ar ? 'أُنشئت المسودة — ولّد صورتها من قائمة الاعتماد' : 'Draft created — generate its image from the queue')
    } catch (e) { draftError(e) }
  }
  // V2: image for an image-less (plan-born) draft — scene from its caption/item
  const genDraftImage = async (d) => {
    if (draftGenId) return
    setDraftGenId(d.id)
    try {
      const it = (items || []).find((i) => i.id === d.itemId || (d.itemName && iName(i) === d.itemName))
      const scene = [(d.caption || '').split('\n')[0], d.itemName].filter(Boolean).join(', ')
      const blob = await generatePostImage({ itemImageUrls: it ? refUrls(it) : [], stylePrompt: scene, venueName: tenant?.name || '', tenant })
      const file = new File([blob], `post-${Date.now()}.${(blob.type || '').includes('jpeg') ? 'jpg' : 'png'}`, { type: blob.type || 'image/png' })
      const imageUrl = await uploadImage(tenantId, file, 'library/marketing')
      await patchMarketingPost(tenantId, d.id, { imageUrl })
      toast.success(ar ? 'وُلّدت صورة المسودة' : 'Draft image generated')
    } catch (e) { toast.error(String(e?.message || e)) }
    finally { setDraftGenId('') }
  }

  const saveDraftFromBlob = async (blob, extra) => {
    const file = new File([blob], `post-${Date.now()}.${(blob.type || '').includes('jpeg') ? 'jpg' : 'png'}`, { type: blob.type || 'image/png' })
    const imageUrl = await uploadImage(tenantId, file, 'library/marketing')
    await addMarketingPost(tenantId, { imageUrl, ...extra })
    return imageUrl
  }
  const draftError = (e) => {
    const code = e?.code || ''
    toast.error(code.includes('permission')
      ? (ar ? 'انشر قواعد Firestore لمجموعة marketingPosts أولاً' : 'Deploy the marketingPosts Firestore rules first')
      : String(e?.message || t('error')))
  }

  const saveAiDraft = async () => {
    if (!preview?.blob || saveBusy) return
    setSaveBusy(true)
    try {
      const it = (items || []).find((i) => i.id === aiItemId)
      await saveDraftFromBlob(preview.blob, { kind: 'ai', itemId: aiItemId || '', itemName: iName(it), style: styleId, caption: cleanCaption(preview.caption || '') })
      URL.revokeObjectURL(preview.url)
      setPreview(null)
      toast.success(ar ? 'حُفظت المسودة — بانتظار الاعتماد' : 'Draft saved — awaiting approval')
    } catch (e) { draftError(e) }
    finally { setSaveBusy(false) }
  }

  // ---------- manual composer ----------
  const loadImg = (url) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('load failed')); im.src = url })
  const setManualImage = async (blob) => {
    const url = URL.createObjectURL(blob)
    try {
      const im = await loadImg(url)
      if (mUrlRef.current) URL.revokeObjectURL(mUrlRef.current)
      mUrlRef.current = url
      setMImg(im)
    } catch (_) { URL.revokeObjectURL(url); toast.error(ar ? 'تعذر قراءة الصورة' : 'Could not read the image') }
  }
  const pickManualItem = async (id) => {
    const it = withImages.find((i) => i.id === id)
    const src = it?.imageUrl || (it?.images || [])[0]
    if (!src) return
    setMBusy(true)
    try {
      const r = await fetch(src)
      if (!r.ok) throw new Error(String(r.status))
      await setManualImage(await r.blob())
    } catch (_) { toast.error(ar ? 'تعذر تحميل صورة الصنف' : 'Could not load the item photo') }
    finally { setMBusy(false) }
  }
  const onManualFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) await setManualImage(f)
  }

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    if (mImg) {
      const sc = Math.max(CANVAS_W / mImg.width, CANVAS_H / mImg.height)
      const dw = mImg.width * sc, dh = mImg.height * sc
      ctx.drawImage(mImg, (CANVAS_W - dw) / 2, (CANVAS_H - dh) / 2, dw, dh)
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H)
      g.addColorStop(0, hexToRgba(brand, 1))
      g.addColorStop(1, '#1c1c1e')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
    }
    const [headPx, subPx] = SIZES[sizeKey] || SIZES.m
    const maxW = CANVAS_W - 140
    ctx.direction = 'rtl'
    ctx.textAlign = 'center'
    const wrap = (text, font) => {
      ctx.font = font
      const words = String(text || '').split(/\s+/).filter(Boolean)
      const lines = []
      let cur = ''
      for (const w of words) {
        const cand = cur ? `${cur} ${w}` : w
        if (ctx.measureText(cand).width > maxW && cur) { lines.push(cur); cur = w } else cur = cand
      }
      if (cur) lines.push(cur)
      return lines
    }
    const headFont = `800 ${headPx}px Tajawal, system-ui, sans-serif`
    const subFont = `500 ${subPx}px Tajawal, system-ui, sans-serif`
    const headLines = headline.trim() ? wrap(headline.trim(), headFont) : []
    const subLines = subline.trim() ? wrap(subline.trim(), subFont) : []
    const headLH = Math.round(headPx * 1.3), subLH = Math.round(subPx * 1.45)
    const gap = headLines.length && subLines.length ? 16 : 0
    const blockH = headLines.length * headLH + subLines.length * subLH + gap
    if (!blockH) return
    const top = posKey === 'top' ? 110 : posKey === 'center' ? (CANVAS_H - blockH) / 2 : CANVAS_H - blockH - 120
    if (band) {
      ctx.fillStyle = hexToRgba(brand, 0.82)
      ctx.fillRect(0, top - 42, CANVAS_W, blockH + 84)
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
      ctx.shadowBlur = 16
    }
    ctx.fillStyle = textColor
    let y = top + headPx
    ctx.font = headFont
    headLines.forEach((l) => { ctx.fillText(l, CANVAS_W / 2, y, maxW); y += headLH })
    y += gap
    ctx.font = subFont
    subLines.forEach((l) => { ctx.fillText(l, CANVAS_W / 2, y, maxW); y += subLH })
    ctx.shadowBlur = 0
  }, [mImg, headline, subline, textColor, sizeKey, posKey, band, brand])

  const saveManualDraft = async () => {
    if (saveBusy) return
    if (!mImg && !headline.trim() && !subline.trim()) { toast.error(ar ? 'اختر صورة أو اكتب نصاً أولاً' : 'Pick an image or write some text first'); return }
    setSaveBusy(true)
    try {
      const blob = await new Promise((res) => canvasRef.current.toBlob(res, 'image/jpeg', 0.92))
      if (!blob) throw new Error(ar ? 'تعذر تصدير التصميم' : 'Could not export the design')
      await saveDraftFromBlob(blob, { kind: 'manual', caption: cleanCaption(mCaption || [headline, subline].filter(Boolean).join('\n')) })
      toast.success(ar ? 'حُفظت المسودة — بانتظار الاعتماد' : 'Draft saved — awaiting approval')
    } catch (e) { draftError(e) }
    finally { setSaveBusy(false) }
  }

  // ---------- approval queue actions ----------
  const approve = async (d) => {
    if (!d.imageUrl) { toast.error(ar ? 'ولّد صورة المسودة أولاً' : 'Generate the draft image first'); return }
    try { await patchMarketingPost(tenantId, d.id, { status: 'approved', approvedAt: Date.now() }) } catch (e) { draftError(e) }
  }
  const remove = async (d) => {
    if (!window.confirm(ar ? 'حذف هذا التصميم نهائياً؟' : 'Delete this design?')) return
    try { await deleteMarketingPost(tenantId, d.id) } catch (e) { draftError(e) }
  }
  const markPublished = (d, channel) => patchMarketingPost(tenantId, d.id, {
    status: 'published', publishedAt: Date.now(),
    publishedTo: [...new Set([...(d.publishedTo || []), channel])],
  })
  const publishStory = async (d) => {
    try {
      // mirrors StoriesAdmin's addStory shape exactly
      await addStory(tenantId, { kind: 'image', url: d.imageUrl, title: '', caption: d.caption || '', filterCss: '', link: '', linkLabel: '', overlays: [], audioUrl: '', audioStart: 0 })
      await markPublished(d, 'story')
      toast.success(ar ? 'نُشر كستوري (يظهر 24 ساعة)' : 'Published as a story (24h)')
    } catch (e) { draftError(e) }
  }
  const publishPost = async (d) => {
    try {
      const lines = (d.caption || '').split('\n').map((l) => l.trim()).filter(Boolean)
      const title = (lines[0] || d.itemName || tenant?.name || (ar ? 'منشور' : 'Post')).slice(0, 90)
      // mirrors PostsAdmin's addPost shape exactly (media: [{kind,url}])
      await addPost(tenantId, { type: 'news', title, body: lines.slice(1).join('\n'), media: [{ kind: 'image', url: d.imageUrl }], pinned: false, published: true })
      await markPublished(d, 'post')
      toast.success(ar ? 'نُشر في بروفايل المنشأة' : 'Published to the venue profile')
    } catch (e) { draftError(e) }
  }
  const submitCampaign = async (mode) => {
    const d = campFor
    if (!d || campBusy) return
    setCampBusy(true)
    try {
      // mirrors Campaigns' saveCampaign shape exactly; WhatsApp is text-only → image as a link line
      const base = {
        title: (ar ? 'منشور: ' : 'Post: ') + (d.itemName || (d.caption || '').split('\n')[0] || '').slice(0, 40),
        text: `${d.caption || ''}\n\n${ar ? 'الصورة' : 'Image'}: ${d.imageUrl}`.trim(),
        audience: campAudience,
        channels: { whatsapp: true, notice: false },
        repeat: 'none',
      }
      if (mode === 'template') {
        await saveCampaign(tenantId, null, { ...base, status: 'template' })
        toast.success(ar ? 'حُفظت كقالب في الحملات' : 'Saved as a campaign template')
      } else {
        await saveCampaign(tenantId, null, { ...base, status: 'scheduled', scheduleAt: Date.now() })
        toast.success(ar ? 'جُدولت — ستُرسل خلال دقائق' : 'Scheduled — sending within minutes')
      }
      await markPublished(d, 'whatsapp')
      setCampFor(null)
    } catch (e) { draftError(e) }
    finally { setCampBusy(false) }
  }

  // ---------- auto-pilot (weekly suggested drafts, approval still required) ----------
  const pilot = tenant?.postPilot || {}
  const togglePilot = async (enabled) => {
    const next = { cadence: 'weekly', ...pilot, enabled }
    try { await updateTenant(tenantId, { postPilot: next }); updateTenantLocal?.({ postPilot: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
  }
  useEffect(() => {
    if (pilotRan.current || !pilot.enabled || !canWrite || !aiConfigured() || !items || !drafts) return
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
    const recent = drafts.filter((d) => d.pilot && tsMs(d.createdAt) > weekAgo)
    pilotRan.current = true
    const need = 2 - recent.length
    if (need <= 0) return
    const tops = [...withImages].sort((a, b) => (Number(b.soldCount) || 0) - (Number(a.soldCount) || 0)).slice(0, need)
    if (!tops.length) return
    ;(async () => {
      setPilotBusy(true)
      for (let n = 0; n < tops.length; n++) {
        const it = tops[n]
        try {
          const style = ALL_STYLES[(Math.floor(Date.now() / (7 * 24 * 3600 * 1000)) + n) % ALL_STYLES.length]
          const blob = await generatePostImage({ itemImageUrls: refUrls(it), stylePrompt: style.prompt, venueName: tenant?.name || '' })
          const caption = await generateCaption({ itemName: iName(it), venueName: tenant?.name || '' }).catch(() => '')
          await saveDraftFromBlob(blob, { kind: 'ai', pilot: true, itemId: it.id, itemName: iName(it), style: style.id, caption })
        } catch (e) { toast.error(String(e?.message || e)); break }
      }
      setPilotBusy(false)
    })()
  }, [pilot.enabled, canWrite, items, drafts]) // eslint-disable-line react-hooks/exhaustive-deps

  if (items === null || drafts === null) return <Spinner />

  const pending = drafts.filter((d) => d.status === 'draft')
  const approved = drafts.filter((d) => d.status === 'approved')
  const published = drafts.filter((d) => d.status === 'published').slice(0, 12)
  const fmtWhen = (ms) => { try { return new Date(ms).toLocaleString(ar ? 'ar-SA-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) } catch (_) { return '' } }
  const CH_LABEL = { story: ar ? 'ستوري' : 'Story', post: ar ? 'خبر' : 'Post', whatsapp: ar ? 'واتساب' : 'WhatsApp' }

  const DraftCard = ({ d }) => (
    <div className="ps-card">
      {d.imageUrl ? (
        <img src={d.imageUrl} alt="" loading="lazy" />
      ) : (
        <div className="ps2-noimg center stack" style={{ gap: 6 }}>
          <Icon name="image" size={26} />
          <span className="xs faint">{ar ? 'بلا صورة بعد' : 'No image yet'}</span>
        </div>
      )}
      <div className="ps-card-body">
        <div className="ps-badge-row">
          <span className="badge">{d.kind === 'ai' ? (ar ? 'ذكاء' : 'AI') : (ar ? 'يدوي' : 'Manual')}</span>
          {d.pilot && <span className="badge badge-gold">{ar ? 'مقترح آلي' : 'Auto-pilot'}</span>}
          {d.plannedDay > 0 && <span className="badge num">{(ar ? 'اليوم ' : 'Day ') + d.plannedDay}</span>}
          {d.itemName && <span className="badge">{d.itemName}</span>}
          {(d.publishedTo || []).map((c) => <span key={c} className="badge badge-success">{CH_LABEL[c] || c}</span>)}
        </div>
        {d.caption && <div className="ps-cap">{d.caption}</div>}
        {d.publishedAt && <span className="xs faint num">{fmtWhen(d.publishedAt)}</span>}
        <div className="ps-actions">
          {d.status === 'draft' && canWrite && !d.imageUrl && (
            <button className="btn btn-sm btn-outline" disabled={!!draftGenId || !aiConfigured()} onClick={() => genDraftImage(d)}>
              <Icon name="sparkles" size={13} /> {draftGenId === d.id ? (ar ? 'يولّد…' : 'Generating…') : (ar ? 'توليد الصورة' : 'Generate image')}
            </button>
          )}
          {d.status === 'draft' && canWrite && (
            <button className="btn btn-sm btn-primary" disabled={!d.imageUrl} onClick={() => approve(d)}><Icon name="check" size={13} /> {ar ? 'اعتماد' : 'Approve'}</button>
          )}
          {d.status !== 'draft' && (
            <>
              {canStories && <button className="btn btn-sm btn-outline" onClick={() => publishStory(d)}><Icon name="camera" size={13} /> {ar ? 'نشر كستوري' : 'As story'}</button>}
              {canStories && <button className="btn btn-sm btn-outline" onClick={() => publishPost(d)}><Icon name="events" size={13} /> {ar ? 'نشر كخبر' : 'As post'}</button>}
              {canWrite && <button className="btn btn-sm btn-outline" onClick={() => { setCampFor(d); setCampAudience('all') }}><Icon name="message" size={13} /> {ar ? 'حملة واتساب' : 'WA campaign'}</button>}
            </>
          )}
          {canWrite && d.caption && d.status !== 'published' && (
            <button className="btn btn-sm btn-outline" disabled={!!transId} onClick={() => translateDraft(d)}>
              <Icon name="lang" size={13} /> {transId === d.id ? (ar ? 'يترجم…' : 'Translating…') : (ar ? 'ترجم EN' : 'EN')}
            </button>
          )}
          {canWrite && <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => remove(d)} aria-label={ar ? 'حذف' : 'Delete'}><Icon name="delete" size={14} /></button>}
        </div>
      </div>
    </div>
  )

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 className="page-title row" style={{ gap: 8 }}><Icon name="image" size={22} /> {ar ? 'استوديو المنشورات' : 'Post studio'}</h2>
        <div className="row" style={{ gap: 6 }}>
          <button className={`chip ${tab === 'ai' ? 'active' : ''}`} onClick={() => setTab('ai')}><Icon name="sparkles" size={13} /> {ar ? 'توليد بالذكاء' : 'AI generate'}</button>
          <button className={`chip ${tab === 'manual' ? 'active' : ''}`} onClick={() => setTab('manual')}><Icon name="penLine" size={13} /> {ar ? 'تصميم يدوي' : 'Manual design'}</button>
        </div>
      </div>

      <p className="ps-note">
        {ar
          ? 'كل تصميم — بالذكاء أو يدوياً — يُحفظ كمسودة في «قائمة الاعتماد» ولا يُنشر أي شيء دون ضغطة اعتماد صريحة. ملاحظة صادقة: النشر التلقائي لمنصات التواصل (انستقرام/إكس) يتطلب ربط حسابات Meta/X عبر خوادمها — غير متاح حالياً؛ المتاح: الاستوري والأخبار داخل منيوك وحملات واتساب.'
          : 'Every design (AI or manual) is saved as a DRAFT in the approval queue — nothing publishes without an explicit approval click. Honest note: auto-posting to Instagram/X requires linking Meta/X accounts through their servers — not available yet; available now: in-menu stories, profile posts and WhatsApp campaigns.'}
      </p>

      {!canWrite && !canStories && (
        <div className="card card-pad row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="lock" size={16} />
          <span className="small">{ar ? 'صلاحياتك تسمح بالاطلاع فقط — الإنشاء والاعتماد يتطلبان صلاحية الحملات.' : 'View-only — creating and approving require the campaigns capability.'}</span>
        </div>
      )}

      {/* ---- auto-pilot ---- */}
      <div className="card card-pad stack" style={{ gap: 8 }}>
        <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
          <strong className="small"><Icon name="zap" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'مؤتمت مع موافقة — مسودات مقترحة أسبوعياً' : 'Auto-pilot — weekly suggested drafts'}</strong>
          <input type="checkbox" checked={pilot.enabled === true} disabled={!canWrite} onChange={(e) => togglePilot(e.target.checked)} style={{ width: 22, height: 22 }} />
        </div>
        <span className="xs faint">
          {ar
            ? 'عند التفعيل: يقترح الاستوديو حتى مسودتين أسبوعياً من أصنافك الأكثر مبيعاً عند فتح هذه الصفحة (لا جدولة سحابية في هذه المرحلة) — وتبقى مسودات لا تُنشر إلا باعتمادك.'
            : 'When on: up to 2 weekly drafts are generated from your best-sellers when this page opens (no cloud scheduling in this pass) — they stay drafts until you approve them.'}
        </span>
        {pilotBusy && <span className="small row" style={{ gap: 6, alignItems: 'center', color: 'var(--brand)' }}><Icon name="sparkles" size={14} /> {ar ? 'يجري توليد مسودات هذا الأسبوع…' : 'Generating this week’s drafts…'}</span>}
      </div>

      {/* ---- V2: content calendar — a 30-day plan whose ideas convert to drafts ---- */}
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
          <strong className="small">
            <Icon name="calendar" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'تقويم المحتوى' : 'Content calendar'}
            {plan?.month && <span className="xs faint num"> — {plan.month}</span>}
          </strong>
          {canWrite && (
            <button className="btn btn-sm btn-outline" disabled={planBusy || !aiConfigured()} onClick={generatePlan}>
              <Icon name="sparkles" size={13} /> {planBusy ? (ar ? 'يولّد الخطة…' : 'Generating the plan…') : (ar ? 'ولّد خطة 30 يوماً' : 'Generate a 30-day plan')}
            </button>
          )}
        </div>
        {plan?.entries?.length ? (
          <div className="ps2-plan">
            {plan.entries.map((e, i) => (
              <div key={e.day} className="ps2-plan-cell">
                <span className="ps2-plan-day num">{e.day}</span>
                <div className="stack" style={{ gap: 4, minWidth: 0, flex: 1 }}>
                  {e.idea && <strong className="xs">{e.idea}</strong>}
                  {e.itemName && <span className="badge" style={{ alignSelf: 'flex-start' }}>{e.itemName}</span>}
                  {e.caption && <span className="xs faint ps2-clamp">{e.caption}</span>}
                  {canWrite && (e.drafted
                    ? <span className="xs row" style={{ gap: 4, alignItems: 'center', color: 'var(--success)' }}><Icon name="check" size={11} /> {ar ? 'تحولت لمسودة' : 'Drafted'}</span>
                    : (
                      <button className="btn btn-sm btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => planToDraft(e, i)}>
                        <Icon name="penLine" size={12} /> {ar ? 'حوّلها لمسودة' : 'To draft'}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <span className="xs faint">
            {ar
              ? 'خطة شهر كاملة بضغطة: فكرة ونص جاهز لكل يوم اعتماداً على اسم منشأتك وأصنافك الأكثر مبيعاً — وكل فكرة تتحول لمسودة في قائمة الاعتماد (الصورة تولّدها لاحقاً من المسودة).'
              : 'A full month in one tap: an idea and a ready caption for every day, based on your venue and best-sellers — each idea converts to a draft in the approval queue (generate its image later from the draft).'}
          </span>
        )}
      </div>

      {/* ---- composer ---- */}
      {tab === 'ai' ? (
        <div className="card card-pad ps-gen-grid">
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{ar ? 'الصنف (صوره تُستخدم مرجعاً للمنتج نفسه)' : 'Item (its photos are the product reference)'}</label>
              <select className="select" value={aiItemId} onChange={(e) => setAiItemId(e.target.value)}>
                <option value="">{ar ? 'اختر صنفاً…' : 'Pick an item…'}</option>
                {withImages.map((i) => <option key={i.id} value={i.id}>{iName(i)}</option>)}
              </select>
              {!withImages.length && <span className="xs" style={{ color: 'var(--warning)' }}>{ar ? 'لا توجد أصناف بصور — أضف صور المنتجات أولاً.' : 'No items with photos yet — add product photos first.'}</span>}
              {/* direct reference uploads (product + logo …) — local files, immune to bucket CORS */}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
                  <Icon name="upload" size={13} /> {ar ? 'أو ارفع مراجع (منتج + شعار…)' : 'Or upload references'}
                  <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => {
                    const fs = Array.from(e.target.files || []).slice(0, 3 - refFiles.length)
                    e.target.value = ''
                    if (fs.length) setRefFiles((r) => [...r, ...fs].slice(0, 3))
                  }} />
                </label>
                {refFiles.map((f, i) => (
                  <span key={i} className="badge row" style={{ gap: 4 }}>
                    {f.name.slice(0, 18)}
                    <button type="button" className="icon-btn" style={{ width: 16, height: 16 }} onClick={() => setRefFiles((r) => r.filter((_, j) => j !== i))}><Icon name="close" size={10} /></button>
                  </span>
                ))}
                {refFiles.length > 0 && (
                  <label className="row xs" style={{ gap: 5, cursor: 'pointer', alignItems: 'center' }}>
                    <input type="checkbox" checked={imitateRef} onChange={(e) => setImitateRef(e.target.checked)} style={{ width: 16, height: 16 }} />
                    <span>{ar ? 'قلّد التصميم المرفوع بالضبط (مع تغييراتي الموصوفة فقط)' : 'Imitate the uploaded design exactly'}</span>
                  </label>
                )}
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{ar ? 'نمط الصورة' : 'Image style'}</label>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {ALL_STYLES.map((s) => (
                  <button key={s.id} type="button" className={`chip ${styleId === s.id ? 'active' : ''}`} onClick={() => setStyleId(s.id)}>{s.ar}</button>
                ))}
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{ar ? 'وصف إضافي حر (اختياري)' : 'Extra free prompt (optional)'}</label>
              <input className="input" value={freePrompt} onChange={(e) => setFreePrompt(e.target.value)} placeholder={ar ? 'مثال: مع حبوب قهوة متناثرة وبخار خفيف' : 'e.g. scattered coffee beans, soft steam'} />
              {/* V2: prompt library — save the current prompt+style, reapply with one tap */}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                {canWrite && (
                  <button type="button" className="btn btn-sm btn-outline" onClick={savePromptToLib}>
                    <Icon name="star" size={12} /> {ar ? 'احفظ كبرومبت' : 'Save prompt'}
                  </button>
                )}
                {promptLib.map((p) => (
                  <span key={p.name} className="chip ps2-lib-chip" title={p.prompt} onClick={() => applyLibPrompt(p)}>
                    <span className="ps2-lib-name">{p.name}</span>
                    {canWrite && (
                      <button type="button" className="icon-btn ps2-lib-del" aria-label={ar ? 'حذف' : 'Delete'} onClick={(e) => { e.stopPropagation(); removeLibPrompt(p) }}>
                        <Icon name="close" size={9} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="field grow" style={{ marginBottom: 0, minWidth: 140 }}>
                <label>{ar ? 'أسلوب النص' : 'Caption tone'}</label>
                <select className="select" value={tone} onChange={(e) => setTone(e.target.value)}>
                  {TONES.map(([v, a, en]) => <option key={v} value={v}>{ar ? a : en}</option>)}
                </select>
              </div>
              <div className="field grow" style={{ marginBottom: 0, minWidth: 160 }}>
                <label>{ar ? 'عرض يُذكر في النص (اختياري)' : 'Offer to mention (optional)'}</label>
                <input className="input" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder={ar ? 'مثال: خصم 15% هذا الخميس' : 'e.g. 15% off this Thursday'} />
              </div>
            </div>
            {/* V2: A/B toggle — two variants of the same prompt, keep the better one */}
            <label className="row xs" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={abMode} onChange={(e) => setAbMode(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span>{ar ? 'نسختان A/B — صورتان لنفس الوصف وتختار أفضلهما' : 'A/B — two variants of the same prompt, pick the better'}</span>
            </label>
            <button className="btn btn-primary" disabled={!!genBusy || !canWrite || !aiConfigured()} onClick={doGenerate}>
              <Icon name="sparkles" size={15} /> {genBusy
                ? (genBusy === 'caption' ? (ar ? 'يكتب النص…' : 'Writing caption…')
                  : genBusy === 'translate' ? (ar ? 'يترجم…' : 'Translating…')
                  : genBusy === 'imageA' ? (ar ? 'يولّد النسخة A…' : 'Generating variant A…')
                  : genBusy === 'imageB' ? (ar ? 'يولّد النسخة B…' : 'Generating variant B…')
                  : (ar ? 'يولّد الصورة…' : 'Generating image…'))
                : (ar ? 'توليد التصميم والنص' : 'Generate design + caption')}
            </button>
            {!aiConfigured() && <span className="xs" style={{ color: 'var(--warning)' }}>{ar ? 'الذكاء غير مهيأ — أكمل إعداد Firebase/Gemini.' : 'AI not configured — finish Firebase/Gemini setup.'}</span>}
          </div>

          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {abPair ? (
              <>
                {/* V2: A/B chooser — the picked variant becomes the preview */}
                <span className="xs faint">{ar ? 'قارن واختر — النسخة الأخرى تُهمل' : 'Compare and pick — the other variant is discarded'}</span>
                <div className="ps2-ab">
                  {['a', 'b'].map((k) => (
                    <div key={k} className="ps2-ab-slot">
                      <span className="ps2-ab-tag">{k === 'a' ? 'A' : 'B'}</span>
                      {abPair[k]
                        ? <img src={abPair[k].url} alt="" />
                        : <div className="ps2-ab-wait center">{genBusy === 'imageB' ? <div className="spinner" /> : <Icon name="image" size={22} />}</div>}
                      {abPair[k] && (
                        <button className="btn btn-sm btn-primary" disabled={!!genBusy} onClick={() => pickAb(k)}>
                          <Icon name="check" size={13} /> {ar ? 'اختيار هذه' : 'Pick this'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : preview?.url ? (
              <>
                <img className="ps-preview-img" src={preview.url} alt="" />
                <textarea className="textarea" rows={4} value={preview.caption} onChange={(e) => setPreview((p) => ({ ...p, caption: e.target.value }))} placeholder={ar ? 'نص المنشور…' : 'Caption…'} />
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-sm btn-outline" disabled={!!genBusy} onClick={regenImage}><Icon name="reload" size={13} /> {ar ? 'صورة أخرى' : 'New image'}</button>
                  <button className="btn btn-sm btn-outline" disabled={!!genBusy} onClick={regenCaption}><Icon name="reload" size={13} /> {ar ? 'نص آخر' : 'New caption'}</button>
                  <button className="btn btn-sm btn-outline" disabled={!!genBusy || !(preview.caption || '').trim()} onClick={translatePreview}><Icon name="lang" size={13} /> {ar ? 'ترجم EN' : 'EN'}</button>
                  <button className="btn btn-sm btn-primary grow" disabled={saveBusy || !canWrite} onClick={saveAiDraft}>{saveBusy ? t('saving') : (ar ? 'حفظ في قائمة الاعتماد' : 'Save to approval queue')}</button>
                </div>
              </>
            ) : (
              <div className="ps-empty-stage center stack" style={{ gap: 6 }}>
                <Icon name="image" size={30} style={{ color: 'var(--text-muted)' }} />
                <span className="xs faint">{ar ? 'المعاينة تظهر هنا — لا يُنشر شيء قبل اعتمادك' : 'Preview appears here — nothing publishes before your approval'}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card card-pad ps-gen-grid">
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <span className="xs faint">{ar ? 'محرر منظم بقوالب جاهزة (مواضع وأحجام محددة — ليس سحباً حراً).' : 'A structured composer with presets (fixed positions/sizes — not free-drag).'}</span>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field grow" style={{ marginBottom: 0, minWidth: 160 }}>
                <label>{ar ? 'صورة من صنف' : 'Image from an item'}</label>
                <select className="select" value="" disabled={mBusy} onChange={(e) => e.target.value && pickManualItem(e.target.value)}>
                  <option value="">{ar ? 'اختر…' : 'Pick…'}</option>
                  {withImages.map((i) => <option key={i.id} value={i.id}>{iName(i)}</option>)}
                </select>
              </div>
              <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
                <Icon name="upload" size={14} /> {ar ? 'رفع صورة' : 'Upload'}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onManualFile} />
              </label>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{ar ? 'العنوان الرئيسي' : 'Headline'}</label>
              <input className="input" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder={ar ? 'مثال: جديدنا وصل' : 'e.g. New arrival'} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{ar ? 'سطر فرعي' : 'Subline'}</label>
              <input className="input" value={subline} onChange={(e) => setSubline(e.target.value)} placeholder={ar ? 'مثال: جربه اليوم في فرعنا' : 'e.g. try it today'} />
            </div>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="row" style={{ gap: 4 }}>
                {[['#ffffff', ar ? 'أبيض' : 'White'], ['#111111', ar ? 'أسود' : 'Black'], [brand, ar ? 'الهوية' : 'Brand'], ['#d4af37', ar ? 'ذهبي' : 'Gold']].map(([c, l]) => (
                  <button key={c} type="button" className="ps-swatch" title={l} aria-label={l} style={{ background: c, outline: textColor === c ? '2px solid var(--brand)' : 'none' }} onClick={() => setTextColor(c)} />
                ))}
              </div>
              <div className="row" style={{ gap: 4 }}>
                {[['s', ar ? 'صغير' : 'S'], ['m', ar ? 'وسط' : 'M'], ['l', ar ? 'كبير' : 'L']].map(([v, l]) => (
                  <button key={v} type="button" className={`chip ${sizeKey === v ? 'active' : ''}`} onClick={() => setSizeKey(v)}>{l}</button>
                ))}
              </div>
              <div className="row" style={{ gap: 4 }}>
                {[['top', ar ? 'أعلى' : 'Top'], ['center', ar ? 'وسط' : 'Center'], ['bottom', ar ? 'أسفل' : 'Bottom']].map(([v, l]) => (
                  <button key={v} type="button" className={`chip ${posKey === v ? 'active' : ''}`} onClick={() => setPosKey(v)}>{l}</button>
                ))}
              </div>
              <label className="row" style={{ gap: 6, cursor: 'pointer', alignItems: 'center' }}>
                <input type="checkbox" checked={band} onChange={(e) => setBand(e.target.checked)} style={{ width: 18, height: 18 }} />
                <span className="xs">{ar ? 'شريط بلون الهوية خلف النص' : 'Brand-color band behind text'}</span>
              </label>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{ar ? 'نص المنشور المرافق' : 'Accompanying caption'}</label>
              <textarea className="textarea" rows={3} value={mCaption} onChange={(e) => setMCaption(e.target.value)} placeholder={ar ? 'يُستخدم عند النشر كستوري/خبر/حملة (اختياري — الافتراضي: العنوانان)' : 'Used when publishing (optional — defaults to the two lines)'} />
            </div>
            <button className="btn btn-primary" disabled={saveBusy || !canWrite} onClick={saveManualDraft}>{saveBusy ? t('saving') : (ar ? 'حفظ في قائمة الاعتماد' : 'Save to approval queue')}</button>
          </div>
          <div className="ps-stage">
            <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} />
          </div>
        </div>
      )}

      {/* ---- approval queue ---- */}
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        <strong className="small"><Icon name="clock" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? `بانتظار الاعتماد (${pending.length})` : `Awaiting approval (${pending.length})`}</strong>
        {pending.length === 0
          ? <span className="xs faint">{ar ? 'لا مسودات بانتظار الاعتماد.' : 'No drafts awaiting approval.'}</span>
          : <div className="ps-queue">{pending.map((d) => <DraftCard key={d.id} d={d} />)}</div>}
      </div>
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        <strong className="small"><Icon name="check" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? `معتمدة وجاهزة للنشر (${approved.length})` : `Approved, ready to publish (${approved.length})`}</strong>
        {approved.length === 0
          ? <span className="xs faint">{ar ? 'اعتمد مسودة لتظهر هنا مع أزرار النشر.' : 'Approve a draft to see publish actions here.'}</span>
          : <div className="ps-queue">{approved.map((d) => <DraftCard key={d.id} d={d} />)}</div>}
      </div>
      {published.length > 0 && (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <strong className="small"><Icon name="share" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'نُشرت' : 'Published'}</strong>
          <div className="ps-queue">{published.map((d) => <DraftCard key={d.id} d={d} />)}</div>
        </div>
      )}
      {drafts.length === 0 && (
        <Empty icon="image" title={ar ? 'لا تصاميم بعد' : 'No designs yet'} hint={ar ? 'ولّد تصميماً بالذكاء أو صمم يدوياً — وكلها تمر بالاعتماد قبل النشر' : 'Generate with AI or design manually — everything passes approval first'} />
      )}

      {/* ---- WhatsApp campaign sheet ---- */}
      <Sheet open={!!campFor} onClose={() => setCampFor(null)} title={ar ? 'إرسال كحملة واتساب' : 'Send as WhatsApp campaign'}
        footer={
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-outline" disabled={campBusy} onClick={() => submitCampaign('template')}>{ar ? 'حفظ كقالب' : 'Save template'}</button>
            <button className="btn btn-primary grow" disabled={campBusy} onClick={() => submitCampaign('now')}>{campBusy ? t('saving') : (ar ? 'جدولة الإرسال الآن' : 'Schedule now')}</button>
          </div>
        }>
        {campFor && (
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <img src={campFor.imageUrl} alt="" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 'var(--r-md)', flex: 'none' }} />
              <div className="xs faint" style={{ whiteSpace: 'pre-wrap' }}>{campFor.caption || (ar ? 'بدون نص' : 'No caption')}</div>
            </div>
            <div className="field">
              <label>{ar ? 'الجمهور' : 'Audience'}</label>
              <select className="select" value={campAudience} onChange={(e) => setCampAudience(e.target.value)}>
                <option value="all">{ar ? 'كل العملاء' : 'All customers'}</option>
                <option value="members">{ar ? 'الأعضاء فقط' : 'Members only'}</option>
              </select>
            </div>
            <p className="xs faint" style={{ margin: 0 }}>
              {ar ? 'واتساب يُرسل نصاً فقط — تُرفق الصورة كسطر رابط داخل الرسالة. تديرها شاشة «الحملات» كأي حملة أخرى.' : 'WhatsApp campaigns are text-only — the image is included as a link line. Manage it from Campaigns like any other campaign.'}
            </p>
          </div>
        )}
      </Sheet>
    </div>
  )
}
