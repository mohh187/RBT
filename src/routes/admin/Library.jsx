import { useEffect, useMemo, useState } from 'react'
import { collection, doc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { watchMedia, deleteMedia, listItems } from '../../lib/db.js'
import { db, storage } from '../../lib/firebase.js'
import { randomToken } from '../../lib/format.js'
import { generatePostImage, PRESET_STYLES } from '../../lib/postGen.js'
import { removeBackgroundToFile } from '../../lib/bgRemove.js'

// /admin/library — full asset studio over the SAME data layer as the
// MediaLibrary picker (tenants/{tid}/media via watchMedia/deleteMedia): grid
// browser + virtual folders + client-side auto-organize + in-library AI
// generation (postGen) + per-image AI actions (edit / enhance / bg removal).
// Uploads mirror MediaLibrary's direct-doc pattern (NOT storage.js logMedia)
// so the virtual `folder` and a correct non-media `kind` are set at create
// time and nothing gets double-registered.

const KINDS = [
  ['all', 'الكل', 'All'],
  ['image', 'صور', 'Images'],
  ['video', 'فيديو', 'Videos'],
  ['audio', 'صوت', 'Audio'],
  ['file', 'ملفات', 'Files'],
]

// Prompt filter chips: [id, arabic label, english prompt fragment]
const LIGHTS = [
  ['warm', 'دافئة', 'warm golden lighting'],
  ['cool', 'باردة', 'cool blue-toned lighting'],
  ['drama', 'درامية', 'dramatic high-contrast lighting with deep shadows'],
]
const ANGLES = [
  ['top', 'علوية', 'top-down overhead flat-lay camera angle'],
  ['side', 'جانبية', 'side-profile camera angle'],
  ['front', 'أمامية', 'straight-on front camera angle at eye level'],
]
const BACKDROPS = [
  ['marble', 'رخام', 'on an elegant white marble surface'],
  ['wood', 'خشب', 'on a rustic warm wooden surface'],
  ['plain', 'سادة', 'clean solid seamless studio background'],
  ['grad', 'تدرج', 'smooth color-gradient backdrop'],
]

const ENHANCE_PROMPT = 'Enhance this exact photo: keep the very same product, framing and composition, improve lighting, sharpness, white balance and appetite appeal, remove noise and distracting artifacts, professional food-photography retouch'

// ---- upload plumbing (mirrors MediaLibrary/storage.js conventions) ----
const LIB_LIMITS_MB = { image: 10, video: 150, audio: 40, file: 25 }
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba', 'wma']
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'ogv', 'm4v', '3gp']
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico']
const AUDIO_CT = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', weba: 'audio/webm', wma: 'audio/x-ms-wma' }
const VIDEO_CT = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', ogv: 'video/ogg', m4v: 'video/mp4', '3gp': 'video/3gpp' }
const extOf = (name) => ((name || '').split('.').pop() || '').toLowerCase()
const kindOf = (f) => {
  const t = f.type || ''
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  if (t.startsWith('image/')) return 'image'
  const ext = extOf(f.name)
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  if (IMAGE_EXT.includes(ext)) return 'image'
  return 'file'
}
const bestCT = (f) => {
  const t = f.type || ''
  if (/^(audio|video|image)\//.test(t)) return t
  const ext = extOf(f.name)
  return VIDEO_CT[ext] || AUDIO_CT[ext] || t || 'application/octet-stream'
}
const fmtMB = (size) => (size > 0 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : '')
const extBadge = (m) => {
  const e = extOf(m.name || m.url).replace(/[?#].*$/, '')
  return (e && e.length <= 5 ? e : 'file').toUpperCase()
}
const baseName = (m) => (m.name || 'image').replace(/\.[^.]+$/, '')

// ---- V3 helpers: duplicates + social sizes + auto-compress (all client-side) ----
// Near-identical-name normalization: drop extension, copy markers ("(2)",
// "copy", "نسخة"), trailing counters, then all punctuation/spacing noise.
const normName = (s) => (s || '').toLowerCase()
  .replace(/\.[a-z0-9]+$/, '')
  .replace(/\(\d+\)|copy|نسخة/g, '')
  .replace(/[-_ ]+\d+$/, '')
  .replace(/[^a-z0-9ء-ي]+/g, '')

// «تصدير مقاسات»: [suffix, w, h] — square 1:1, story 9:16, post 4:5.
const SOCIAL_SIZES = [
  ['square', 1080, 1080],
  ['story', 1080, 1920],
  ['post', 1080, 1350],
]
const loadImg = (url) => new Promise((resolve, reject) => {
  const im = new Image()
  im.crossOrigin = 'anonymous' // needed for canvas export; load fails if bucket CORS is off
  im.onload = () => resolve(im)
  im.onerror = () => reject(new Error('image load blocked'))
  im.src = url
})
const canvasBlob = (c, type, q) => new Promise((resolve, reject) =>
  c.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas export failed'))), type, q))
// Cover-crop centered re-draw (like CSS object-fit: cover) → webp blob.
const coverCrop = async (img, w, h) => {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const scale = Math.max(w / (img.naturalWidth || 1), h / (img.naturalHeight || 1))
  const dw = (img.naturalWidth || 1) * scale
  const dh = (img.naturalHeight || 1) * scale
  c.getContext('2d').drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
  return canvasBlob(c, 'image/webp', 0.9)
}
// «ضغط تلقائي»: images over 2MB → max 2000px webp 0.85 before upload.
const COMPRESS_OVER_MB = 2
const COMPRESS_MAX_PX = 2000
const COMPRESS_SKIP_EXT = ['gif', 'svg'] // animation / vectors would be destroyed
async function compressImage(f) {
  const url = URL.createObjectURL(f)
  try {
    const img = await loadImg(url)
    const scale = Math.min(1, COMPRESS_MAX_PX / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    c.getContext('2d').drawImage(img, 0, 0, w, h)
    const blob = await canvasBlob(c, 'image/webp', 0.85)
    if (blob.size >= f.size) return f // re-encode grew it → keep the original
    return new File([blob], `${(f.name || 'image').replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' })
  } catch (_) { return f } finally { URL.revokeObjectURL(url) }
}

// ---- auto-organize heuristics (pure client-side, NO model call) ----
const ORG = { products: 'صور المنتجات', logos: 'الشعارات', bgs: 'الخلفيات', videos: 'فيديوهات', audio: 'صوتيات', docs: 'مستندات' }
function proposeFolder(m, itemNames) {
  const n = (m.name || '').toLowerCase()
  if (/logo|شعار/.test(n)) return ORG.logos
  if (/background|خلفية|(^|[^a-z])bg([^a-z]|$)/.test(n)) return ORG.bgs
  if (m.kind === 'video') return ORG.videos
  if (m.kind === 'audio') return ORG.audio
  if (m.kind === 'file' || !m.kind) return ORG.docs
  if (m.kind === 'image') {
    const base = n.replace(/\.[a-z0-9]+$/, '')
    if (itemNames.some((it) => base.includes(it) || (base.length >= 3 && it.includes(base)))) return ORG.products
  }
  return ''
}

// Single-select chip row for the studio prompt filters.
function ChipRow({ label, options, value, onPick, disabled }) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="lib-lbl">{label}</span>
      {options.map(([id, arLabel]) => (
        <button key={id} className={`chip ${value === id ? 'active' : ''}`} disabled={disabled}
          onClick={() => onPick(value === id ? '' : id)}>{arLabel}</button>
      ))}
    </div>
  )
}

export default function Library() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const { tenantId, tenant, isManager } = useAuth()
  const toast = useToast()

  const [items, setItems] = useState(null)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('all')
  const [folderSel, setFolderSel] = useState('all')
  const [localFolders, setLocalFolders] = useState([])
  const [newFolder, setNewFolder] = useState(null)
  const [upBusy, setUpBusy] = useState(false)

  // selection: multi-select mode (bulk bar) vs single detail strip
  const [selMode, setSelMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [detailId, setDetailId] = useState(null)

  // studio (in-library AI designer)
  const [studioOpen, setStudioOpen] = useState(false)
  const [desc, setDesc] = useState('')
  const [styleId, setStyleId] = useState('')
  const [light, setLight] = useState('')
  const [angle, setAngle] = useState('')
  const [backdrop, setBackdrop] = useState('')
  const [imitate, setImitate] = useState(false)
  const [libRefs, setLibRefs] = useState([]) // media docs picked from the grid (max 2)
  const [fileRefs, setFileRefs] = useState([]) // directly-uploaded Files (max 2, CORS-immune)
  const [refPick, setRefPick] = useState(false)
  const [genBusy, setGenBusy] = useState(false)

  // per-image AI actions
  const [editOpen, setEditOpen] = useState(false)
  const [editText, setEditText] = useState('')
  const [busyId, setBusyId] = useState('')

  // auto-organize preview
  const [orgRows, setOrgRows] = useState(null)
  const [orgBusy, setOrgBusy] = useState(false)

  // V3: favorites + trash bin + duplicate scan + social-size export + auto-compress
  const [favOnly, setFavOnly] = useState(false)
  const [trashView, setTrashView] = useState(false)
  const [dupGroups, setDupGroups] = useState(null) // array of id-arrays | null
  const [sizesBusy, setSizesBusy] = useState(false)
  const [autoCompress, setAutoCompress] = useState(() => {
    try { return localStorage.getItem('lib.autoCompress') !== '0' } catch (_) { return true }
  })

  useEffect(() => { if (!tenantId) return; setItems(null); return watchMedia(tenantId, setItems) }, [tenantId])

  // V3: everything below the trash chip works on `live` (non-trashed) docs only —
  // the grid, folders, counts, studio ref-picking and organize never see trash.
  const live = useMemo(() => (items || []).filter((m) => !m.trashed), [items])
  const trashItems = useMemo(() => (items || []).filter((m) => m.trashed), [items])
  const folders = useMemo(() => {
    const set = new Set(localFolders)
    for (const m of live) if (m.folder) set.add(m.folder)
    return [...set].sort((a, b) => a.localeCompare(b, ar ? 'ar' : 'en'))
  }, [live, localFolders, ar])
  // per-folder stats: count + total MB (Latin digits, rendered with .toFixed(1))
  const counts = useMemo(() => {
    const by = {}; const root = { n: 0, mb: 0 }; const all = { n: 0, mb: 0 }
    for (const m of live) {
      const mb = (Number(m.size) || 0) / (1024 * 1024)
      all.n += 1; all.mb += mb
      const f = m.folder || ''
      if (!f) { root.n += 1; root.mb += mb; continue }
      const e = by[f] || (by[f] = { n: 0, mb: 0 })
      e.n += 1; e.mb += mb
    }
    return { by, root, all }
  }, [live])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return live.filter((m) =>
      (tab === 'all' ? true : (m.kind || 'file') === tab)
      && (folderSel === 'all' ? true : (m.folder || '') === folderSel)
      && (!favOnly || m.fav === true)
      && (!needle || (m.name || '').toLowerCase().includes(needle)))
  }, [live, tab, folderSel, q, favOnly])
  const detail = useMemo(() => live.find((m) => m.id === detailId) || null, [live, detailId])
  const totalMB = counts.all.mb.toFixed(1)
  const favCount = useMemo(() => live.filter((m) => m.fav === true).length, [live])
  // duplicate groups resolved against live docs, so trashing one updates the panel
  const dupLive = useMemo(() => {
    if (!dupGroups) return null
    const byId = new Map(live.map((m) => [m.id, m]))
    return dupGroups.map((g) => g.map((id) => byId.get(id)).filter(Boolean)).filter((g) => g.length >= 2)
  }, [dupGroups, live])

  // ---- data-layer actions (mirror MediaLibrary's gating: move = manager-only) ----
  const moveHint = ar ? 'النقل بين المجلدات للمدير فقط' : 'Only managers can move files'
  const targetFolder = () => (folderSel === 'all' ? '' : folderSel)

  // Direct upload + doc registration (same pattern as MediaLibrary.uploadOne):
  // sets virtual `folder` + correct `kind` at create time, fires the global
  // 'ml:upload' HUD events, never double-registers via logMedia.
  const uploadDirect = async (f, folder) => {
    const k = kindOf(f)
    const limit = LIB_LIMITS_MB[k]
    if (f.size > limit * 1024 * 1024) {
      throw new Error(ar ? `الملف كبير جداً (${fmtMB(f.size)}) — الحد الأقصى ${limit}MB` : `File too large (${fmtMB(f.size)}) — max ${limit}MB`)
    }
    const meta = { name: f.name || '', size: f.size || 0 }
    const fire = (detailEv) => { try { window.dispatchEvent(new CustomEvent('ml:upload', { detail: detailEv })) } catch (_) { /* ignore */ } }
    const r = storageRef(storage, `tenants/${tenantId}/library/${Date.now()}-${randomToken(6)}.${extOf(f.name) || 'bin'}`)
    fire({ ...meta, progress: 0, state: 'start' })
    try {
      await new Promise((resolve, reject) => {
        const task = uploadBytesResumable(r, f, { contentType: bestCT(f) })
        task.on('state_changed', (s) => {
          const p = s.totalBytes ? Math.round((s.bytesTransferred / s.totalBytes) * 100) : 0
          fire({ ...meta, progress: p, state: 'progress' })
        }, reject, resolve)
      })
      fire({ ...meta, progress: 100, state: 'done' })
    } catch (e) {
      fire({ ...meta, progress: 0, state: 'error' })
      throw e
    }
    const url = await getDownloadURL(r)
    const data = { url, name: f.name || '', size: f.size || 0, contentType: bestCT(f), kind: k, folder: folder || '' }
    try { await addDoc(collection(db, 'tenants', tenantId, 'media'), { ...data, createdAt: serverTimestamp() }) } catch (_) { /* best-effort: file already uploaded */ }
    return url
  }

  const onUpload = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length || upBusy) return
    setUpBusy(true)
    const folder = targetFolder()
    for (let f of files) {
      try {
        // «ضغط تلقائي»: big raster images re-encoded before upload (opt-out toggle)
        if (autoCompress && kindOf(f) === 'image' && f.size > COMPRESS_OVER_MB * 1024 * 1024 && !COMPRESS_SKIP_EXT.includes(extOf(f.name))) {
          const before = f.size
          f = await compressImage(f)
          if (f.size < before) {
            toast.success(ar ? `ضُغطت «${f.name}» من ${fmtMB(before)} إلى ${fmtMB(f.size)}` : `Compressed "${f.name}" from ${fmtMB(before)} to ${fmtMB(f.size)}`)
          }
        }
        await uploadDirect(f, folder)
      } catch (err) { toast.error(String(err?.message || err)) }
    }
    setUpBusy(false)
  }

  const moveTo = async (m, target) => {
    if (!isManager || target === (m.folder || '')) return
    try { await updateDoc(doc(db, 'tenants', tenantId, 'media', m.id), { folder: target }) } catch (_) { toast.error(ar ? 'تعذّر النقل' : 'Move failed') }
  }
  // V3 soft delete: «حذف» moves the doc to سلة المحذوفات (trashed:true) — restorable.
  // NOTE: firestore.rules currently allow media UPDATE for managers only, so
  // trashing / restoring / starring fails for non-manager staff until rules add
  // a narrow staff update path (the old hard-delete WAS any-staff).
  const patchMedia = (id, patch) => updateDoc(doc(db, 'tenants', tenantId, 'media', id), patch)
  const trashNow = async (m) => {
    try {
      await patchMedia(m.id, { trashed: true, trashedAt: serverTimestamp() })
      if (detailId === m.id) setDetailId(null)
    } catch (_) { toast.error(ar ? 'تعذّر النقل إلى السلة — تعديل الوسائط للمدير فقط' : 'Trash failed — media edits are manager-only') }
  }
  const removeOne = async (m) => {
    if (!window.confirm(ar ? 'نقل إلى سلة المحذوفات؟ (يمكن استعادته لاحقاً، ولا يُحذف من الأماكن المستخدَم فيها)' : 'Move to trash? (restorable later; stays where already used)')) return
    await trashNow(m)
  }
  const restoreOne = async (m) => {
    try { await patchMedia(m.id, { trashed: false, trashedAt: null }) }
    catch (_) { toast.error(ar ? 'تعذّرت الاستعادة' : 'Restore failed') }
  }
  const hardDelete = async (m) => {
    if (!isManager) return
    if (!window.confirm(ar ? 'حذف نهائي؟ لا يمكن التراجع بعدها' : 'Delete forever? This cannot be undone')) return
    try { await deleteMedia(tenantId, m.id) } catch (_) { toast.error(ar ? 'تعذّر الحذف' : 'Delete failed') }
  }
  const toggleFav = async (m) => {
    try { await patchMedia(m.id, { fav: !m.fav }) }
    catch (_) { toast.error(ar ? 'تعذّر الحفظ — تعديل الوسائط للمدير فقط' : 'Save failed — media edits are manager-only') }
  }
  const copyUrl = async (m) => {
    try { await navigator.clipboard.writeText(m.url); toast.success(ar ? 'تم نسخ الرابط' : 'Link copied') } catch (_) { toast.error(ar ? 'تعذّر النسخ' : 'Copy failed') }
  }
  const download = async (m) => {
    try {
      const r = await fetch(m.url)
      if (!r.ok) throw new Error('fetch')
      const blob = await r.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = m.name || `file.${extOf(m.url) || 'bin'}`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    } catch (_) { window.open(m.url, '_blank', 'noopener') } // CORS-blocked fetch → open in a tab
  }

  const addFolder = () => {
    const name = (newFolder || '').trim()
    if (!name) { setNewFolder(null); return }
    if (!folders.includes(name)) setLocalFolders((fs) => [...fs, name])
    setFolderSel(name)
    setNewFolder(null)
  }

  // ---- selection ----
  const tapCard = (m) => {
    if (refPick) {
      if (m.kind !== 'image') { toast.error(ar ? 'المرجع يجب أن يكون صورة' : 'References must be images'); return }
      setLibRefs((rs) => {
        if (rs.some((r) => r.id === m.id)) return rs.filter((r) => r.id !== m.id)
        if (rs.length >= 2) { toast.error(ar ? 'الحد الأقصى مرجعان من المكتبة' : 'Max 2 library references'); return rs }
        return [...rs, m]
      })
      return
    }
    if (selMode) {
      setSelected((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n })
      return
    }
    setEditOpen(false); setEditText('')
    setDetailId((id) => (id === m.id ? null : m.id))
  }
  const bulkMove = async (target) => {
    if (!isManager || !selected.size) return
    const ids = [...selected]
    const ok = await Promise.all(ids.map((id) => updateDoc(doc(db, 'tenants', tenantId, 'media', id), { folder: target }).then(() => 1).catch(() => 0)))
    const n = ok.reduce((a, b) => a + b, 0)
    setSelected(new Set())
    if (n) toast.success(ar ? `نُقل ${n} إلى «${target || 'الجذر'}»` : `Moved ${n} to "${target || 'root'}"`)
    else toast.error(ar ? 'تعذّر النقل' : 'Move failed')
  }
  const bulkDelete = async () => {
    if (!selected.size) return
    if (!window.confirm(ar ? `نقل ${selected.size} إلى سلة المحذوفات؟ (يمكن استعادتها لاحقاً)` : `Move ${selected.size} to trash? (restorable later)`)) return
    const ok = await Promise.all([...selected].map((id) =>
      patchMedia(id, { trashed: true, trashedAt: serverTimestamp() }).then(() => 1).catch(() => 0)))
    const n = ok.reduce((a, b) => a + b, 0)
    if (detailId && selected.has(detailId)) setDetailId(null)
    setSelected(new Set())
    if (n) toast.success(ar ? `نُقل ${n} إلى سلة المحذوفات` : `Moved ${n} to trash`)
    else toast.error(ar ? 'تعذّر النقل إلى السلة — تعديل الوسائط للمدير فقط' : 'Trash failed — media edits are manager-only')
  }

  // ---- «فحص التكرارات»: identical size + near-identical normalized name (no model) ----
  const scanDups = () => {
    const groups = {}
    for (const m of live) {
      const size = Number(m.size) || 0
      if (!size) continue
      const key = `${size}::${normName(m.name)}`
      if (!groups[key]) groups[key] = []
      groups[key].push(m.id)
    }
    const found = Object.values(groups).filter((g) => g.length >= 2)
    if (!found.length) { setDupGroups(null); toast.success(ar ? 'لا تكرارات — كل الملفات فريدة' : 'No duplicates — every file is unique') }
    else setDupGroups(found)
  }

  // ---- «تصدير مقاسات»: canvas cover-crop → 3 NEW library items (no model) ----
  const exportSizes = async (m) => {
    if (sizesBusy || upBusy) return
    setSizesBusy(true)
    try {
      const img = await loadImg(m.url)
      for (const [suffix, w, h] of SOCIAL_SIZES) {
        const blob = await coverCrop(img, w, h) // throws on CORS-tainted canvas
        await uploadDirect(new File([blob], `${baseName(m)}-${suffix}.webp`, { type: 'image/webp' }), m.folder || '')
      }
      toast.success(ar ? 'صُدّرت 3 مقاسات وحُفظت كعناصر جديدة في المكتبة' : 'Exported 3 sizes as new library items')
    } catch (_) {
      toast.error(ar ? 'تعذّر التصدير — فعّل CORS للتخزين أو ارفع الصورة من جهازك' : 'Export failed — enable storage CORS or re-upload the image from your device')
    } finally { setSizesBusy(false) }
  }

  // ---- auto-organize (client-side heuristics + preview + manager-only apply) ----
  const autoOrganize = async () => {
    if (!isManager || orgBusy) return
    setOrgBusy(true)
    try {
      let names = []
      try {
        const its = await listItems(tenantId)
        names = its.flatMap((i) => [i.nameAr, i.nameEn, i.name]).filter(Boolean)
          .map((s) => String(s).trim().toLowerCase()).filter((s) => s.length >= 3)
      } catch (_) { /* items unreadable → name-match heuristic just skips */ }
      const rows = live.map((m) => {
        const to = proposeFolder(m, names)
        return to && to !== (m.folder || '') ? { id: m.id, name: m.name || m.kind || 'file', from: m.folder || '', to, on: true } : null
      }).filter(Boolean)
      if (!rows.length) toast.success(ar ? 'كل شيء منظّم — لا اقتراحات جديدة' : 'All organized — nothing to propose')
      else setOrgRows(rows)
    } finally { setOrgBusy(false) }
  }
  const applyOrganize = async () => {
    if (!isManager) return
    const rows = (orgRows || []).filter((r) => r.on)
    if (!rows.length) return
    const ok = await Promise.all(rows.map((r) => updateDoc(doc(db, 'tenants', tenantId, 'media', r.id), { folder: r.to }).then(() => 1).catch(() => 0)))
    const n = ok.reduce((a, b) => a + b, 0)
    setOrgRows(null)
    if (n) toast.success(ar ? `نُظّم ${n} ملفاً في مجلداته` : `Organized ${n} files`)
    else toast.error(ar ? 'تعذّر التنظيم' : 'Organize failed')
  }

  // ---- AI: studio generation + per-image actions ----
  const buildPrompt = () => {
    const pick = (arr, id) => (arr.find((o) => o[0] === id)?.[2] || '')
    const preset = PRESET_STYLES.find((s) => s.id === styleId)?.prompt || ''
    return [desc.trim(), preset, pick(LIGHTS, light), pick(ANGLES, angle), pick(BACKDROPS, backdrop)].filter(Boolean).join(', ')
  }
  const onRefFiles = (e) => {
    const fs = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'))
    e.target.value = ''
    if (fs.length) setFileRefs((cur) => [...cur, ...fs].slice(0, 2))
  }
  const generate = async () => {
    if (genBusy) return
    const stylePrompt = buildPrompt()
    if (!stylePrompt && !libRefs.length && !fileRefs.length) {
      toast.error(ar ? 'اكتب وصفاً أو اختر نمطاً أو مرجعاً أولاً' : 'Describe, pick a style or a reference first')
      return
    }
    setGenBusy(true)
    try {
      const blob = await generatePostImage({
        itemImageUrls: libRefs.map((r) => r.url), refFiles: fileRefs,
        stylePrompt, venueName: tenant?.name || '', tenant, imitate,
      })
      await uploadDirect(new File([blob], `studio-${Date.now()}.png`, { type: blob.type || 'image/png' }), targetFolder())
      toast.success(ar ? 'وُلّدت الصورة وحُفظت في المكتبة' : 'Generated and saved to the library')
    } catch (e) { toast.error(String(e?.message || e)) } finally { setGenBusy(false) }
  }
  // Edit/enhance always SAVE A NEW ITEM (never overwrite the original doc/file).
  const runAiOnImage = async (m, stylePrompt) => {
    if (busyId || !stylePrompt) return
    setBusyId(m.id)
    try {
      const blob = await generatePostImage({ itemImageUrls: [m.url], stylePrompt, venueName: tenant?.name || '', tenant, imitate: true })
      await uploadDirect(new File([blob], `${baseName(m)}-ai-${Date.now()}.png`, { type: blob.type || 'image/png' }), m.folder || '')
      setEditOpen(false); setEditText('')
      toast.success(ar ? 'حُفظت النسخة الجديدة في المكتبة — الأصل كما هو' : 'New version saved — original untouched')
    } catch (e) { toast.error(String(e?.message || e)) } finally { setBusyId('') }
  }
  const bgCut = async (m) => {
    if (busyId) return
    setBusyId(m.id)
    try {
      const f = await removeBackgroundToFile(m.url, `${baseName(m)}-cutout.png`)
      await uploadDirect(f, m.folder || '')
      toast.success(ar ? 'حُفظت نسخة PNG بلا خلفية' : 'Transparent PNG saved')
    } catch (_) {
      toast.error(ar ? 'تعذّرت إزالة الخلفية — إن كان الرابط محجوباً (CORS) حمّل الصورة ثم ارفعها من جهازك' : 'Background removal failed — if the URL is CORS-blocked, download then re-upload the image')
    } finally { setBusyId('') }
  }

  if (items === null) return <Spinner />

  const kindCount = (id) => (id === 'all' ? live.length : live.filter((m) => (m.kind || 'file') === id).length)

  return (
    <div className="page stack" style={{ gap: 'var(--sp-3)' }}>
      {/* header: title + totals + upload + select mode */}
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="page-title" style={{ margin: 0 }}>{ar ? 'المكتبة والاستوديو' : 'Library & studio'}</h2>
          <span className="xs faint num">{live.length} {ar ? 'ملف' : 'files'} · {totalMB} MB</span>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <label className="lib-comp-toggle"
            title={ar ? 'الصور الأكبر من 2MB تُضغط تلقائياً قبل الرفع (webp بعرض أقصى 2000px)' : 'Images over 2MB are auto-compressed before upload (webp, max 2000px)'}>
            <input type="checkbox" checked={autoCompress}
              onChange={(ev) => {
                setAutoCompress(ev.target.checked)
                try { localStorage.setItem('lib.autoCompress', ev.target.checked ? '1' : '0') } catch (_) { /* ignore */ }
              }} />
            <span className="xs">{ar ? 'ضغط تلقائي' : 'Auto-compress'}</span>
          </label>
          <label className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}>
            <Icon name="upload" size={14} /> {upBusy ? (ar ? 'يرفع…' : 'Uploading…') : (ar ? 'رفع ملفات' : 'Upload')}
            <input type="file" multiple style={{ display: 'none' }} disabled={upBusy} onChange={onUpload} />
          </label>
          <button className={`btn btn-sm ${selMode ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => { setSelMode((v) => !v); setSelected(new Set()); setDetailId(null); setRefPick(false); setTrashView(false) }}>
            <Icon name="check" size={14} /> {selMode ? (ar ? 'إنهاء التحديد' : 'Done') : (ar ? 'تحديد' : 'Select')}
          </button>
        </div>
      </div>

      {/* ==== استوديو التوليد (collapsible in-library AI designer) ==== */}
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <button className="row-between" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', width: '100%', textAlign: 'start', color: 'inherit' }} onClick={() => setStudioOpen((o) => !o)}>
          <span className="small bold" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="sparkles" size={16} /> {ar ? 'استوديو التوليد' : 'AI studio'}
          </span>
          <Icon name={studioOpen ? 'close' : 'add'} size={15} className="faint" />
        </button>
        {studioOpen && (
          <>
            <textarea className="textarea" rows={2} disabled={genBusy}
              placeholder={ar ? 'صف الصورة المطلوبة… (مثال: كوب لاتيه بتغطية كراميل وبجانبه كرواسون)' : 'Describe the image…'}
              value={desc} onChange={(e) => setDesc(e.target.value)} />
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="lib-lbl">{ar ? 'النمط' : 'Style'}</span>
              {PRESET_STYLES.map((s) => (
                <button key={s.id} className={`chip ${styleId === s.id ? 'active' : ''}`} disabled={genBusy}
                  onClick={() => setStyleId((v) => (v === s.id ? '' : s.id))}>{s.ar}</button>
              ))}
            </div>
            <ChipRow label={ar ? 'إضاءة' : 'Light'} options={LIGHTS} value={light} onPick={setLight} disabled={genBusy} />
            <ChipRow label={ar ? 'زاوية' : 'Angle'} options={ANGLES} value={angle} onPick={setAngle} disabled={genBusy} />
            <ChipRow label={ar ? 'خلفية' : 'Backdrop'} options={BACKDROPS} value={backdrop} onPick={setBackdrop} disabled={genBusy} />
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="lib-lbl">{ar ? 'المراجع' : 'Refs'}</span>
              <button className={`btn btn-sm ${refPick ? 'btn-primary' : 'btn-outline'}`} disabled={genBusy}
                onClick={() => { setRefPick((p) => !p); setSelMode(false); setDetailId(null); setTrashView(false) }}>
                <Icon name="grid" size={14} /> {refPick ? (ar ? `تم (${libRefs.length})` : `Done (${libRefs.length})`) : (ar ? 'اختيار من المكتبة' : 'Pick from library')}
              </button>
              <label className="btn btn-sm btn-outline" style={{ cursor: 'pointer' }}>
                <Icon name="upload" size={14} /> {ar ? 'رفع مرجع مباشر' : 'Upload reference'}
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} disabled={genBusy} onChange={onRefFiles} />
              </label>
            </div>
            {(libRefs.length > 0 || fileRefs.length > 0) && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {libRefs.map((r) => (
                  <button key={r.id} className="chip active" disabled={genBusy} title={ar ? 'إزالة المرجع' : 'Remove reference'}
                    onClick={() => setLibRefs((rs) => rs.filter((x) => x.id !== r.id))}>
                    <Icon name="image" size={12} /> {r.name || (ar ? 'صورة' : 'image')} <Icon name="close" size={11} />
                  </button>
                ))}
                {fileRefs.map((f, i) => (
                  <button key={`${f.name}-${i}`} className="chip active" disabled={genBusy} title={ar ? 'إزالة المرجع' : 'Remove reference'}
                    onClick={() => setFileRefs((fs) => fs.filter((_, j) => j !== i))}>
                    <Icon name="upload" size={12} /> {f.name} <Icon name="close" size={11} />
                  </button>
                ))}
              </div>
            )}
            <label className="row" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={imitate} disabled={genBusy} onChange={(e) => setImitate(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span className="xs">{ar ? 'قلّد المرجع بالضبط مع تغيير ما أصفه' : 'Imitate the reference exactly, applying only my changes'}</span>
            </label>
            {genBusy && (
              <div className="center ai-scanning" style={{ height: 110, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px dashed var(--border-strong)' }}>
                <Icon name="sparkles" size={22} className="muted" />
              </div>
            )}
            <button className="btn btn-primary" disabled={genBusy} onClick={generate}>
              <Icon name="sparkles" size={15} /> {genBusy ? (ar ? 'جارٍ التوليد…' : 'Generating…') : (ar ? 'توليد وحفظ في المكتبة' : 'Generate & save')}
            </button>
            <p className="xs faint" style={{ margin: 0 }}>
              {ar
                ? 'المرجع المرفوع مباشرة هو الأوثق — مراجع روابط المكتبة قد تُتجاهل بصمت إذا لم تُضبط CORS للحاوية، فيخرج الناتج من الوصف وحده. الناتج يُحفظ في المجلد المفتوح حالياً.'
                : 'Directly-uploaded references are the most reliable — library-URL refs may be silently skipped until bucket CORS is configured. Results are saved into the currently open folder.'}
            </p>
          </>
        )}
      </div>

      {/* search + type filter */}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input input-sm" style={{ maxWidth: 220 }} placeholder={ar ? 'بحث بالاسم…' : 'Search by name…'}
          value={q} onChange={(e) => setQ(e.target.value)} />
        {KINDS.map(([id, a, e]) => (
          <button key={id} className={`chip ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {ar ? a : e} <span className="num">({kindCount(id)})</span>
          </button>
        ))}
        <button className={`chip ${favOnly ? 'active' : ''}`} onClick={() => setFavOnly((v) => !v)}
          title={ar ? 'إظهار المفضلة فقط' : 'Show favorites only'}>
          <Icon name="star" size={13} /> {ar ? 'المفضلة' : 'Favorites'} <span className="num">({favCount})</span>
        </button>
      </div>

      {/* virtual folders + new folder + auto-organize */}
      <div className="ml-folders">
        <button className={`chip ${folderSel === 'all' ? 'active' : ''}`} onClick={() => setFolderSel('all')}>{ar ? 'الكل' : 'All'} <span className="num">({counts.all.n} · {counts.all.mb.toFixed(1)}MB)</span></button>
        <button className={`chip ${folderSel === '' ? 'active' : ''}`} onClick={() => setFolderSel('')}><Icon name="folder" size={13} /> {ar ? 'الجذر' : 'Root'} <span className="num">({counts.root.n} · {counts.root.mb.toFixed(1)}MB)</span></button>
        {folders.map((f) => (
          <button key={f} className={`chip ${folderSel === f ? 'active' : ''}`} onClick={() => setFolderSel(f)}>
            <Icon name="folder" size={13} /> {f} <span className="num">({counts.by[f]?.n || 0} · {(counts.by[f]?.mb || 0).toFixed(1)}MB)</span>
          </button>
        ))}
        {newFolder === null ? (
          <button className="chip" onClick={() => setNewFolder('')}><Icon name="add" size={13} /> {ar ? 'مجلد جديد' : 'New folder'}</button>
        ) : (
          <span className="ml-newfolder">
            <input className="input input-sm" autoFocus value={newFolder} placeholder={ar ? 'اسم المجلد' : 'Folder name'}
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addFolder(); if (e.key === 'Escape') setNewFolder(null) }} />
            <button className="icon-btn" onClick={addFolder} title={ar ? 'إنشاء' : 'Create'}><Icon name="check" size={15} /></button>
            <button className="icon-btn" onClick={() => setNewFolder(null)} title={ar ? 'إلغاء' : 'Cancel'}><Icon name="close" size={15} /></button>
          </span>
        )}
        {isManager && (
          <button className="chip" disabled={orgBusy} onClick={autoOrganize}>
            <Icon name="zap" size={13} /> {orgBusy ? (ar ? 'يحلل…' : 'Analyzing…') : (ar ? 'تنظيم تلقائي بالذكاء' : 'Auto-organize')}
          </button>
        )}
        <button className="chip" onClick={scanDups} title={ar ? 'تجميع الملفات المتطابقة حجماً والمتشابهة اسماً' : 'Group files with identical size and near-identical name'}>
          <Icon name="layers" size={13} /> {ar ? 'فحص التكرارات' : 'Find duplicates'}
        </button>
        <button className={`chip lib-trashchip ${trashView ? 'active' : ''}`}
          onClick={() => { setTrashView((v) => !v); setDetailId(null); setSelMode(false); setSelected(new Set()); setRefPick(false) }}>
          <Icon name="delete" size={13} /> {ar ? 'سلة المحذوفات' : 'Trash'} <span className="num">({trashItems.length})</span>
        </button>
      </div>

      {/* auto-organize preview: nothing moves until «تطبيق» */}
      {orgRows && (
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <div className="row-between">
            <span className="small bold" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="zap" size={15} /> {ar ? `اقتراحات التنظيم (${orgRows.length})` : `Proposed moves (${orgRows.length})`}
            </span>
            <button className="icon-btn" onClick={() => setOrgRows(null)} title={ar ? 'إغلاق' : 'Close'}><Icon name="close" size={14} /></button>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            {orgRows.map((r) => (
              <label key={r.id} className="lib-org-row" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={r.on} style={{ width: 16, height: 16, flex: 'none' }}
                  onChange={() => setOrgRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, on: !x.on } : x)))} />
                <span className="xs lib-org-name" title={r.name}>{r.name}</span>
                <span className="xs faint" style={{ flex: 'none' }}>{r.from || (ar ? 'الجذر' : 'root')}</span>
                <Icon name="arrowLeftRight" size={12} className="faint" style={{ flex: 'none' }} />
                <span className="xs lib-org-to" style={{ flex: 'none' }}>{r.to}</span>
              </label>
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-primary" disabled={!orgRows.some((r) => r.on)} onClick={applyOrganize}>
              {ar ? `تطبيق (${orgRows.filter((r) => r.on).length})` : `Apply (${orgRows.filter((r) => r.on).length})`}
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => setOrgRows(null)}>{ar ? 'إلغاء' : 'Cancel'}</button>
          </div>
        </div>
      )}

      {/* duplicate-scan results: size+name groups; delete buttons only TRASH (restorable) */}
      {dupLive && (
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <div className="row-between">
            <span className="small bold" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="layers" size={15} /> {ar ? `مجموعات متكررة (${dupLive.length})` : `Duplicate groups (${dupLive.length})`}
            </span>
            <button className="icon-btn" onClick={() => setDupGroups(null)} title={ar ? 'إغلاق' : 'Close'}><Icon name="close" size={14} /></button>
          </div>
          {dupLive.length === 0 ? (
            <p className="xs faint" style={{ margin: 0 }}>{ar ? 'عولجت كل التكرارات — أعد الفحص متى شئت.' : 'All duplicates handled — rescan any time.'}</p>
          ) : dupLive.map((g) => (
            <div key={g[0].id} className="lib-dup-group">
              <span className="xs faint num" style={{ flexBasis: '100%' }}>{fmtMB(g[0].size)} · {g.length} {ar ? 'نسخ متطابقة الحجم' : 'same-size copies'}</span>
              {g.map((m) => (
                <div key={m.id} className="lib-dup-item">
                  <div className="lib-dup-thumb">
                    {m.kind === 'image' ? <img src={m.url} alt="" loading="lazy" />
                      : m.kind === 'video' ? <video src={m.url} preload="metadata" muted playsInline />
                        : <Icon name={m.kind === 'audio' ? 'sound' : 'file'} size={16} className="faint" />}
                  </div>
                  <span className="xs lib-dup-name" title={m.name}>{m.name || m.kind}</span>
                  <button className="icon-btn" style={{ color: 'var(--danger)', flex: 'none' }} onClick={() => trashNow(m)}
                    title={ar ? 'نقل إلى سلة المحذوفات' : 'Move to trash'}><Icon name="delete" size={13} /></button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* reference-pick banner */}
      {refPick && (
        <div className="card card-pad row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', borderColor: 'var(--brand)' }}>
          <Icon name="image" size={16} className="faint" />
          <span className="small grow" style={{ minWidth: 160 }}>
            {ar ? 'اضغط على الصور في الشبكة لاختيارها كمراجع (حتى صورتين) — يظهر وسم «مرجع» على المختار.' : 'Tap images in the grid to pick up to 2 references.'}
          </span>
          <button className="btn btn-sm btn-primary" onClick={() => setRefPick(false)}>{ar ? `تم (${libRefs.length})` : `Done (${libRefs.length})`}</button>
        </div>
      )}

      {/* bulk actions bar (multi-select mode) */}
      {selMode && (
        <div className="card card-pad row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="small bold num">{selected.size} {ar ? 'محدد' : 'selected'}</span>
          <button className="btn btn-sm btn-outline" onClick={() => setSelected(new Set(shown.map((m) => m.id)))}>{ar ? 'تحديد المعروض' : 'Select shown'}</button>
          <select className="ml-move" style={{ maxWidth: 170, height: 30 }} value="__ph" disabled={!isManager || !selected.size}
            title={isManager ? (ar ? 'نقل المحدد إلى…' : 'Move selected to…') : moveHint}
            onChange={(e) => bulkMove(e.target.value === '__root' ? '' : e.target.value)}>
            <option value="__ph" disabled>{ar ? 'نقل إلى مجلد…' : 'Move to folder…'}</option>
            <option value="__root">{ar ? 'الجذر' : 'Root'}</option>
            {folders.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)' }} disabled={!selected.size} onClick={bulkDelete}>
            <Icon name="delete" size={14} /> {ar ? 'حذف' : 'Delete'}
          </button>
          {!isManager && <span className="xs faint">{moveHint}</span>}
        </div>
      )}

      {/* single-item detail strip + per-image AI actions */}
      {detail && !selMode && !refPick && (
        <div className="card card-pad lib-detail">
          <div className={`lib-detail-thumb ${busyId === detail.id ? 'ai-scanning' : ''}`}>
            {detail.kind === 'image' ? <img src={detail.url} alt="" />
              : detail.kind === 'video' ? <video src={detail.url} preload="metadata" muted playsInline />
                : <Icon name={detail.kind === 'audio' ? 'sound' : 'file'} size={28} className="muted" />}
          </div>
          <div className="stack grow" style={{ gap: 7, minWidth: 220 }}>
            <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="small bold lib-name grow" style={{ minWidth: 0 }} title={detail.name}>{detail.name || detail.kind}</span>
              <button className={`icon-btn lib-starbtn ${detail.fav ? 'on' : ''}`} style={{ flex: 'none' }} onClick={() => toggleFav(detail)}
                title={detail.fav ? (ar ? 'إزالة من المفضلة' : 'Unfavorite') : (ar ? 'إضافة إلى المفضلة' : 'Favorite')}>
                <Icon name="star" size={15} />
              </button>
              {fmtMB(detail.size) && <span className="xs faint num" style={{ flex: 'none' }}>{fmtMB(detail.size)}</span>}
              <select className="ml-move" style={{ maxWidth: 130, flex: 'none' }} value={detail.folder || ''} disabled={!isManager}
                title={isManager ? (ar ? 'نقل إلى…' : 'Move to…') : moveHint} onChange={(e) => moveTo(detail, e.target.value)}>
                <option value="">{ar ? 'الجذر' : 'Root'}</option>
                {folders.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <button className="icon-btn" style={{ flex: 'none' }} onClick={() => setDetailId(null)} title={ar ? 'إغلاق' : 'Close'}><Icon name="close" size={14} /></button>
            </div>
            {detail.kind === 'image' && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className={`btn btn-sm ${editOpen ? 'btn-primary' : 'btn-outline'}`} disabled={!!busyId} onClick={() => setEditOpen((o) => !o)}>
                  <Icon name="sparkles" size={14} /> {ar ? 'تعديل بالذكاء' : 'AI edit'}
                </button>
                <button className="btn btn-sm btn-outline" disabled={!!busyId} onClick={() => runAiOnImage(detail, ENHANCE_PROMPT)}>
                  <Icon name="zap" size={14} /> {busyId === detail.id ? (ar ? 'جارٍ…' : 'Working…') : (ar ? 'حسّنها' : 'Enhance')}
                </button>
                <button className="btn btn-sm btn-outline" disabled={!!busyId} onClick={() => bgCut(detail)}>
                  <Icon name="scan" size={14} /> {ar ? 'إزالة الخلفية' : 'Remove background'}
                </button>
                <button className="btn btn-sm btn-outline" disabled={!!busyId || sizesBusy} onClick={() => exportSizes(detail)}
                  title={ar ? 'قصّ مركزي إلى 1:1 و9:16 و4:5 — تُحفظ كعناصر جديدة' : 'Center-crop to 1:1, 9:16 and 4:5 — saved as new items'}>
                  <Icon name="layers" size={14} /> {sizesBusy ? (ar ? 'يصدّر…' : 'Exporting…') : (ar ? 'تصدير مقاسات' : 'Export sizes')}
                </button>
              </div>
            )}
            {editOpen && detail.kind === 'image' && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <input className="input input-sm grow" style={{ minWidth: 180 }} autoFocus disabled={!!busyId}
                  placeholder={ar ? 'ماذا أغيّر؟ (مثال: اجعل الخلفية رخاماً أبيض)' : 'What should change?'}
                  value={editText} onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && editText.trim()) runAiOnImage(detail, editText.trim()) }} />
                <button className="btn btn-sm btn-primary" disabled={!!busyId || !editText.trim()} onClick={() => runAiOnImage(detail, editText.trim())}>
                  {busyId === detail.id ? (ar ? 'جارٍ التوليد…' : 'Generating…') : (ar ? 'توليد نسخة' : 'Generate version')}
                </button>
              </div>
            )}
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-outline" onClick={() => copyUrl(detail)}><Icon name="copy" size={14} /> {ar ? 'نسخ الرابط' : 'Copy link'}</button>
              <button className="btn btn-sm btn-outline" onClick={() => download(detail)}><Icon name="download" size={14} /> {ar ? 'تحميل' : 'Download'}</button>
              <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeOne(detail)}><Icon name="delete" size={14} /> {ar ? 'حذف' : 'Delete'}</button>
            </div>
            {detail.kind === 'image' && (
              <p className="xs faint" style={{ margin: 0 }}>
                {ar
                  ? 'نتائج الذكاء تُحفظ كنسخة جديدة — الأصل لا يُمس. إن خرج الناتج مختلفاً عن الصورة فغالباً حُجب رابطها (CORS): حمّلها ثم ارفعها كمرجع مباشر في الاستوديو.'
                  : 'AI results are saved as a NEW copy — the original is untouched. If the output ignores this image, its URL was likely CORS-blocked: download it, then upload it as a direct reference in the studio.'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* trash-bin view: restore for everyone the rules allow, hard delete manager-only */}
      {trashView ? (
        trashItems.length === 0 ? (
          <p className="muted small" style={{ textAlign: 'center', padding: 20 }}>{ar ? 'سلة المحذوفات فارغة.' : 'Trash is empty.'}</p>
        ) : (
          <div className="lib-grid">
            {trashItems.map((m) => (
              <div key={m.id} className="card lib-card lib-trashed" title={m.name}>
                <div className="lib-thumb">
                  {m.kind === 'image' ? <img src={m.url} alt="" loading="lazy" />
                    : m.kind === 'video' ? <video src={m.url} preload="metadata" muted playsInline />
                      : (
                        <div className="stack" style={{ alignItems: 'center', gap: 4 }}>
                          <Icon name={m.kind === 'audio' ? 'sound' : 'file'} size={22} className="faint" />
                          <span className="lib-ext">{extBadge(m)}</span>
                        </div>
                      )}
                </div>
                <div className="xs lib-name" style={{ padding: '5px 7px' }}>{m.name || m.kind}</div>
                <div className="row" style={{ gap: 4, padding: '0 6px 6px', flexWrap: 'wrap' }}>
                  <button className="btn btn-sm btn-outline" onClick={() => restoreOne(m)}>
                    <Icon name="undo" size={13} /> {ar ? 'استعادة' : 'Restore'}
                  </button>
                  {isManager && (
                    <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)' }} onClick={() => hardDelete(m)}>
                      <Icon name="delete" size={13} /> {ar ? 'حذف نهائي' : 'Delete forever'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : live.length === 0 ? (
        <Empty icon="image" title={ar ? 'المكتبة فارغة' : 'Library is empty'}
          hint={ar ? 'أي ملف يُرفع في النظام يُحفظ هنا تلقائياً — أو ارفع ملفات الآن، أو ولّد صورة من الاستوديو أعلاه.' : 'Every upload in the system lands here automatically — or upload now, or generate from the studio above.'} />
      ) : shown.length === 0 ? (
        <p className="muted small" style={{ textAlign: 'center', padding: 20 }}>{ar ? 'لا نتائج مطابقة للبحث أو الفلاتر.' : 'Nothing matches the current filters.'}</p>
      ) : (
        <div className="lib-grid">
          {shown.map((m) => {
            const isSel = selMode ? selected.has(m.id) : detailId === m.id
            const refIdx = libRefs.findIndex((r) => r.id === m.id)
            if (m.kind === 'audio') {
              return (
                <div key={m.id} className={`card lib-card lib-audio ${isSel ? 'lib-sel' : ''}`} role="button" tabIndex={0} title={m.name} onClick={() => tapCard(m)}>
                  {selMode && <span className={`lib-mark ${selected.has(m.id) ? 'on' : ''}`} style={{ position: 'static', flex: 'none' }}><Icon name="check" size={12} /></span>}
                  <Icon name="sound" size={18} className="faint" style={{ flex: 'none' }} />
                  <div className="grow" style={{ minWidth: 90, overflow: 'hidden' }}>
                    <div className="xs lib-name">{m.name || (ar ? 'صوت' : 'Audio')}</div>
                    {fmtMB(m.size) && <div className="xs faint num">{fmtMB(m.size)}</div>}
                  </div>
                  <button className={`icon-btn lib-starbtn ${m.fav ? 'on' : ''}`} style={{ flex: 'none' }}
                    onClick={(e) => { e.stopPropagation(); toggleFav(m) }} title={ar ? 'المفضلة' : 'Favorite'}>
                    <Icon name="star" size={14} />
                  </button>
                  <audio src={m.url} controls preload="none" onClick={(e) => e.stopPropagation()} />
                </div>
              )
            }
            return (
              <div key={m.id} className={`card lib-card ${isSel ? 'lib-sel' : ''}`} role="button" tabIndex={0} title={m.name} onClick={() => tapCard(m)}>
                <div className={`lib-thumb ${busyId === m.id ? 'ai-scanning' : ''}`}>
                  {m.kind === 'image' ? <img src={m.url} alt="" loading="lazy" />
                    : m.kind === 'video' ? <video src={m.url} preload="metadata" muted playsInline />
                      : (
                        <div className="stack" style={{ alignItems: 'center', gap: 4 }}>
                          <Icon name="file" size={22} className="faint" />
                          <span className="lib-ext">{extBadge(m)}</span>
                        </div>
                      )}
                </div>
                <div className="xs lib-name" style={{ padding: '5px 7px' }}>{m.name || m.kind}</div>
                {fmtMB(m.size) && <div className="xs faint num" style={{ padding: '0 7px 6px' }}>{fmtMB(m.size)}</div>}
                {selMode && <span className={`lib-mark ${selected.has(m.id) ? 'on' : ''}`}><Icon name="check" size={12} /></span>}
                {refIdx >= 0 && <span className="lib-refbadge">{ar ? 'مرجع' : 'Ref'} {refIdx + 1}</span>}
                {!selMode && !refPick && (
                  <button className={`lib-star ${m.fav ? 'on' : ''}`} title={ar ? 'المفضلة' : 'Favorite'}
                    onClick={(e) => { e.stopPropagation(); toggleFav(m) }}><Icon name="star" size={12} /></button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
