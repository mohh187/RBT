// Shared client wrapper for the guest-facing `dinerOrderAi` callable (photo +
// voice ordering). Used by PhotoOrder and VoiceWaiter; guests only ever go
// through the callable — the manager-dev direct-key path stays OUT of this
// file on purpose.
//
// Errors are normalized to STABLE codes the UIs translate:
//   'disabled' | 'quota' | 'toolarge' | 'offline' | 'failed'
// All numeric bounds come from AI_ORDER_RANGE in dishComposition.js (server
// mirror: DINER_AI in functions/platformExtensions.js).

import { httpsCallable } from 'firebase/functions'
import { functions, firebaseReady } from './firebase.js'
import { AI_ORDER_RANGE } from './dishComposition.js'

const coded = (code, msg) => {
  const e = new Error(msg || code)
  e.code = code
  return e
}

// File/Blob -> Gemini inlineData part (same pattern as postGen.js).
// Moved verbatim from PhotoOrder.jsx (blobToInlineData) so both features share
// the one reader.
export function blobToInline(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => {
      const [head, data] = String(fr.result).split(',')
      const mimeType = /data:(.*?)[;,]/.exec(`${head},`)?.[1] || blob.type || 'image/jpeg'
      resolve({ mimeType, data })
    }
    fr.onerror = () => reject(new Error('read failed'))
    fr.readAsDataURL(blob)
  })
}

/**
 * Call the diner AI. payload: { tenantId, mode: 'photo'|'audio',
 * media: { mimeType, data }, lang }. Resolves the server's response data;
 * rejects with a coded error (see header).
 */
export async function callDinerAi({ tenantId, mode, media, lang } = {}) {
  if (!firebaseReady || !functions) throw coded('offline')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw coded('offline')
  let timer = null
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(coded('failed', 'timeout')), AI_ORDER_RANGE.cloudTimeoutMs.dflt)
  })
  try {
    const res = await Promise.race([
      httpsCallable(functions, 'dinerOrderAi')({ tenantId, mode, media, lang }),
      timeout,
    ])
    return res.data
  } catch (e) {
    const c = String(e?.code || '')
    if (c === 'offline' || c === 'quota' || c === 'disabled' || c === 'toolarge' || c === 'failed') throw e
    if (/resource-exhausted/.test(c)) throw coded('quota')
    if (/permission-denied/.test(c)) throw coded('disabled')
    if (/invalid-argument/.test(c) && /large/i.test(String(e?.message || ''))) throw coded('toolarge')
    throw coded('failed', String(e?.message || e))
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Canvas downscale: any studio/camera file -> JPEG whose long edge is at most
 * `maxEdge` px. Returns the ORIGINAL file untouched when it is already small
 * enough (no pointless re-encode). Bounds ride AI_ORDER_RANGE only.
 */
export function downscaleImage(file, maxEdge, quality) {
  const R = AI_ORDER_RANGE
  const MAX = Math.min(R.photoMaxEdge.max, Math.max(R.photoMaxEdge.min, Number(maxEdge) || R.photoMaxEdge.dflt))
  const Q = Math.min(R.photoJpegQ.max, Math.max(R.photoJpegQ.min, Number(quality) || R.photoJpegQ.dflt))
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const edge = Math.max(1, Math.max(img.naturalWidth, img.naturalHeight))
      const k = Math.min(1, MAX / edge)
      if (k === 1 && file.size <= R.photoMaxBytes.dflt) { resolve(file); return }
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.naturalWidth * k))
      c.height = Math.max(1, Math.round(img.naturalHeight * k))
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', Q)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
    img.src = url
  })
}
