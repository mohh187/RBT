import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { storage } from './firebase.js'
import { randomToken } from './format.js'

// Size ceilings MUST mirror storage.rules — checked BEFORE uploading so a
// too-big file fails instantly with a clear Arabic message instead of
// uploading for minutes and then being rejected by the rules at finalize.
export const UPLOAD_LIMITS_MB = { image: 10, video: 100, audio: 30 }

// Some audio/video files arrive with an EMPTY file.type (browser couldn't sniff
// it), which previously mis-classified them as images (10MB) and uploaded them
// as octet-stream (rejected by the audio/* storage rule). Fall back to the
// extension so kind + content-type are correct regardless of file.type.
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba', 'wma']
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'ogv', 'm4v', '3gp']
const AUDIO_CT = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', weba: 'audio/webm', wma: 'audio/x-ms-wma' }
const VIDEO_CT = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', ogv: 'video/ogg', m4v: 'video/mp4', '3gp': 'video/3gpp' }
const extOf = (file) => (file.name.split('.').pop() || '').toLowerCase()

function fileKind(file) {
  const t = file.type || ''
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  if (t.startsWith('image/')) return 'image'
  const ext = extOf(file)
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  return 'image'
}
// Best content-type: trust the browser when it declared a real media type,
// otherwise derive it from the extension (never octet-stream for known media).
function bestContentType(file) {
  const t = file.type || ''
  if (/^(audio|video|image)\//.test(t)) return t
  const ext = extOf(file)
  return VIDEO_CT[ext] || AUDIO_CT[ext] || t || 'application/octet-stream'
}

function guardSize(file) {
  const kind = fileKind(file)
  const limit = UPLOAD_LIMITS_MB[kind]
  if (file.size > limit * 1024 * 1024) {
    const mb = Math.round(file.size / 1024 / 1024)
    throw new Error(`الملف كبير جداً (${mb}MB) — الحد الأقصى ${limit}MB${kind === 'video' ? '. اضغط الفيديو أو قصّر مدته' : kind === 'audio' ? '. اختر أغنية أصغر' : ''}`)
  }
}

// Resumable upload (reliable for large videos on weak connections).
// Broadcasts 'ml:upload' events so the GLOBAL progress HUD (name + size + %)
// appears for EVERY upload in the system with zero per-callsite wiring.
async function put(r, file, contentType, onProgress) {
  const meta = { name: file.name || '', size: file.size || 0 }
  const fire = (detail) => { try { window.dispatchEvent(new CustomEvent('ml:upload', { detail })) } catch (_) { /* ignore */ } }
  fire({ ...meta, progress: 0, state: 'start' })
  try {
    await new Promise((resolve, reject) => {
      const task = uploadBytesResumable(r, file, { contentType })
      task.on('state_changed', (s) => {
        const p = s.totalBytes ? Math.round((s.bytesTransferred / s.totalBytes) * 100) : 0
        if (onProgress) onProgress(p)
        fire({ ...meta, progress: p, state: 'progress' })
      }, reject, resolve)
    })
    fire({ ...meta, progress: 100, state: 'done' })
    return getDownloadURL(r)
  } catch (e) {
    fire({ ...meta, progress: 0, state: 'error' })
    throw e
  }
}

// Auto-register every upload in the central media library (tenants/{tid}/media)
// so any asset can be reused via the "from library" picker instead of re-uploading.
// Dynamic import keeps storage.js free of a db.js dependency; failures are silent
// (e.g. before the media rule is deployed) and never block the upload.
function registerMedia(tid, file, url, kind) {
  if (!tid || !url) return
  import('./db.js').then((m) => m.logMedia(tid, { url, kind, name: file.name || '', size: file.size || 0, contentType: file.type || '' })).catch(() => {})
}

// Uploads an image File to tenants/{tid}/items/... and returns its public URL.
export async function uploadImage(tid, file, folder = 'items', onProgress) {
  if (!file) return ''
  guardSize(file)
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `tenants/${tid}/${folder}/${Date.now()}-${randomToken(6)}.${ext}`
  const url = await put(ref(storage, path), file, file.type, onProgress)
  registerMedia(tid, file, url, 'image')
  return url
}

// Uploads any file (e.g. a background video) as-is and returns its public URL.
export async function uploadFile(tid, file, folder = 'media', onProgress) {
  if (!file) return ''
  guardSize(file)
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const path = `tenants/${tid}/${folder}/${Date.now()}-${randomToken(6)}.${ext}`
  const url = await put(ref(storage, path), file, bestContentType(file), onProgress)
  registerMedia(tid, file, url, fileKind(file))
  return url
}

// Downscale an image File (keeps uploads small/fast). Returns a JPEG File.
export async function shrinkImage(file, max = 800, quality = 0.85) {
  if (!file || !file.type?.startsWith('image/')) return file
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    if (scale === 1 && file.size < 1.2 * 1024 * 1024) return file
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h
    cv.getContext('2d').drawImage(img, 0, 0, w, h)
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', quality))
    return blob ? new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }) : file
  } catch (_) {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}
