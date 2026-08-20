import { collection, getDocs, doc, updateDoc, getDoc } from 'firebase/firestore'
import { db } from './firebase.js'
import { uploadImage, maxPxFor } from './storage.js'
import { collectUrls, swapUrls, folderOf } from './imageBackfillCore.js'

// «ضغط صور المنيو» — re-encode the photos ALREADY LIVE on a venue's menu.
//
// WHY THIS EXISTS, and why capping uploads was not enough. uploadImage used to
// store whatever the browser handed it, byte for byte, so a venue photographing
// dishes on a phone filled its menu with 1600x1600 and 2166x1625 originals. A
// phone does not care what a picture WEIGHS; it cares what it costs DECODED,
// which is width x height x 4 bytes however well the file compressed. One
// 2166x1625 photo is 14 MB of texture — to paint a dish 443 px wide.
//
// Measured on a real venue menu: 26.1 megapixels, about 104 MB, resident to
// fill roughly 0.25 MP of actual screen. That is what was killing the tab and
// showing the guest «A problem repeatedly occurred». The upload cap in
// storage.js closes the door for every NEW photo and changes exactly zero bytes
// for the ones already on the menu, so it cannot help the guest scanning a QR
// today. This walks those and rewrites them.
//
// It reads each document as a TREE rather than a list of known fields. Images
// hide in imageUrl, images[], bgUrl, table.url, table.topUrl, story frames and
// hotspots, and enumerating them is how a field gets missed. Anything that
// looks like a Storage image is a candidate; everything else is left alone.

// Natural pixel size WITHOUT decoding into a canvas. createImageBitmap reads the
// header; the blob URL is same-origin so nothing is tainted either way.
async function sizeOf(blob) {
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('decode'))
      i.src = url
    })
    return { w: img.naturalWidth, h: img.naturalHeight }
  } finally { URL.revokeObjectURL(url) }
}

// Compress ONE url. Returns the new URL, or '' when it should stay as it is.
async function shrinkOne(tid, url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) return ''
  // The SAME ceiling the upload path uses, read from the same place, so a photo
  // uploaded tomorrow and a photo rewritten today can never disagree — and so
  // signage keeps its TV master and the print studio keeps its 300 dpi asset.
  const folder = folderOf(url)
  const { w, h } = await sizeOf(blob)
  if (Math.max(w, h) <= maxPxFor(folder)) return ''
  const name = `menu-${Date.now()}.${blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg'}`
  const file = new File([blob], name, { type: blob.type })
  // uploadImage runs the file through shrinkImage and writes a NEW timestamped
  // path. The original object is deliberately left in Storage: rolling back is
  // then reverting a field, with no window where a URL points at nothing.
  return uploadImage(tid, file, folder)
}

// Walks items, categories and the venue document. onProgress gets
// { done, total, phase } so the caller can show something honest.
export async function compressMenuImages(tid, onProgress = () => {}) {
  if (!tid) throw new Error('no tenant')
  const sources = []
  for (const name of ['items', 'categories']) {
    const snap = await getDocs(collection(db, 'tenants', tid, name))
    snap.forEach((d) => sources.push({ ref: d.ref, data: d.data() }))
  }
  const tenantSnap = await getDoc(doc(db, 'tenants', tid))
  if (tenantSnap.exists()) sources.push({ ref: tenantSnap.ref, data: tenantSnap.data() })

  // One set for the whole venue: the room's table photo is referenced by every
  // dish that inherits it, and compressing it 58 times would be 58 uploads of
  // the same picture and 58 different URLs for one image.
  const urls = new Set()
  sources.forEach((s) => collectUrls(s.data, urls))

  const list = [...urls]
  const map = new Map()
  let done = 0
  let saved = 0
  const failed = []
  for (const url of list) {
    onProgress({ done, total: list.length, phase: 'scan' })
    try {
      const next = await shrinkOne(tid, url)
      if (next) { map.set(url, next); saved += 1 }
    } catch (e) {
      // one unreachable object must not abort the run — the rest still helps
      failed.push(String(e.message || e).slice(0, 60))
    }
    done += 1
  }
  onProgress({ done, total: list.length, phase: 'write' })

  let docs = 0
  for (const s of sources) {
    // Only the top-level fields that actually changed. Writing the whole
    // document back would clobber an edit someone made while this ran, and on
    // the venue document it would replay fields the rules do not let an owner
    // write (plan, ownerUid) and fail the whole update over them.
    const patch = {}
    for (const [k, v] of Object.entries(s.data)) {
      const next = swapUrls(v, map)
      if (next !== v) patch[k] = next
    }
    if (!Object.keys(patch).length) continue
    await updateDoc(s.ref, patch)
    docs += 1
  }
  return { scanned: list.length, compressed: saved, docs, failed }
}
