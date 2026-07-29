// ==================== ROUND LOGOS, FOR EVERY VENUE ====================
//
// WHAT WAS WRONG. The logo cropper showed venues a ROUND viewport and saved a
// SQUARE file — `getCroppedBlob` was never told the shape. Every admin screen
// then re-rounded that square in CSS (`border-radius:50%`), so the product
// looked right everywhere and nobody could see the mismatch. Email is where CSS
// cannot clip: the square's corners protruded from the round plate, and a venue
// whose mark sits on a white background saw a white square bulging out of a
// white circle.
//
// src/lib/cropImage.js now honours the shape, so anything uploaded from today is
// already «مفرّغ» — transparent corners, in the pixels. This file is for
// everything uploaded BEFORE that: it masks the stored logo server-side and
// records the result as `logoRoundUrl`, so existing venues are fixed without
// anyone re-uploading anything.
//
// TWO WAYS IN, deliberately:
//   • a Firestore trigger on the tenant document, so a logo that changes is
//     re-masked automatically and the venue never waits;
//   • a one-shot callable that sweeps every existing venue.
//
// WHY NOT A STORAGE TRIGGER: uploads land at `tenants/{tid}/branding/{ts}-{rand}`
// with a randomised name, so the path cannot tell a logo from a cover, a wall or
// a decoration. The tenant document is the only place that says which URL is the
// logo.
//
// PNG, NOT WEBP. The mask needs an alpha channel, and desktop Outlook renders
// through Word, which cannot display WebP at all — so a venue's `.webp` logo may
// already have been a broken-image box for a share of its recipients. PNG keeps
// the transparency and renders everywhere.
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getFirestore } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')
const nodeCrypto = require('crypto')

const SIZE = 512

// `sharp` is a large native module. Requiring it at the top of this file would
// put it in the cold-start path of EVERY function in the deployment, because
// index.js requires all of them. Loaded here, only a mask actually pays for it.
function loadSharp() {
  try {
    // eslint-disable-next-line global-require
    return require('sharp')
  } catch (_) {
    return null
  }
}

// Circle mask as an SVG, composited with `dest-in` so the source keeps its own
// colours and only its ALPHA is replaced by the circle. Anything outside becomes
// fully transparent — which is the whole point: there are no corner pixels left
// to protrude, in any renderer.
function circleMask(size) {
  const r = size / 2
  return Buffer.from(
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`,
  )
}

// Fetch -> fit inside a square -> mask -> PNG.
//
// `fit: 'contain'` with a transparent background, NOT 'cover': a venue whose
// logo is a wide wordmark must not be centre-cropped down to its middle slice.
// A wordmark letterboxes inside the circle instead, which is the same thing the
// email template does when it has no masked copy.
async function maskToRoundPng(sourceUrl) {
  const sharp = loadSharp()
  if (!sharp) throw new Error('sharp unavailable')
  const res = await fetch(sourceUrl)
  if (!res || !res.ok) throw new Error(`fetch failed: ${res && res.status}`)
  const input = Buffer.from(await res.arrayBuffer())
  return sharp(input)
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .composite([{ input: circleMask(SIZE), blend: 'dest-in' }])
    .png()
    .toBuffer()
}

async function storeRound(tenantId, buf) {
  const bucket = getStorage().bucket()
  // Timestamped rather than a fixed name: a stable path would be served from
  // caches (and from the venue's own CDN) long after the logo changed.
  const path = `tenants/${tenantId}/branding/logo-round-${Date.now()}.png`
  const token = nodeCrypto.randomUUID()
  await bucket.file(path).save(buf, {
    metadata: { contentType: 'image/png', metadata: { firebaseStorageDownloadTokens: token } },
  })
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
}

// Returns '' when there is nothing to do, so callers can count real work.
async function maskFor(db, tenantId, data) {
  const logoUrl = String((data && data.logoUrl) || '')
  if (!logoUrl || !/^https?:\/\//i.test(logoUrl)) return ''
  // Already round: either masked before, or uploaded through the fixed cropper
  // (which records logoRoundUrl === logoUrl). Re-masking would be pure cost.
  if (data.logoRoundUrl && data.logoRoundSrc === logoUrl) return ''
  const buf = await maskToRoundPng(logoUrl)
  const url = await storeRound(tenantId, buf)
  // `logoRoundSrc` remembers WHICH logo this was made from. Without it, a venue
  // that changes its logo keeps the old circle forever, because logoRoundUrl is
  // set and nothing would notice the source moved.
  await db.doc(`tenants/${tenantId}`).set({ logoRoundUrl: url, logoRoundSrc: logoUrl }, { merge: true })
  return url
}

// TRIGGER: a venue's logo appears or changes -> mask it.
const onLogoMask = onDocumentWritten('tenants/{tid}', async (event) => {
  const after = event.data && event.data.after && event.data.after.data()
  if (!after) return
  const before = event.data.before && event.data.before.exists ? event.data.before.data() : {}
  // Only react to the logo moving. Tenant docs are written constantly (orderSeq,
  // theme edits, plan changes); without this the mask would run on all of them.
  if (before.logoUrl === after.logoUrl && after.logoRoundSrc === after.logoUrl) return
  // Our own write above re-enters this trigger; that write does not move
  // logoUrl, so the guard above already stops the loop. This is the second belt.
  if (after.logoRoundSrc === after.logoUrl) return
  await maskFor(getFirestore(), event.params.tid, after).catch(() => {})
})

// ONE-SHOT SWEEP over venues that pre-date the fix. Platform-admin only, and
// idempotent — maskFor() skips anything already current, so it is safe to run
// again after a partial pass (the batch limit exists for exactly that).
const backfillRoundLogos = onCall({ timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  const db = getFirestore()
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'يلزم تسجيل الدخول')
  const admin = await db.doc(`admins/${uid}`).get().catch(() => null)
  if (!admin || !admin.exists) throw new HttpsError('permission-denied', 'للمشرفين فقط')

  const limit = Math.min(Math.max(Number(request.data && request.data.limit) || 200, 1), 500)
  const snap = await db.collection('tenants').limit(limit).get()
  let done = 0
  let skipped = 0
  const failed = []
  for (const doc of snap.docs) {
    try {
      const url = await maskFor(db, doc.id, doc.data() || {})
      if (url) done += 1; else skipped += 1
    } catch (e) {
      // Named, not swallowed: a venue whose logo 404s or is an unsupported
      // format has to be visible, or the sweep silently under-reports.
      failed.push({ id: doc.id, error: (e && e.message) || 'failed' })
    }
  }
  return { scanned: snap.size, masked: done, skipped, failed }
})

module.exports = { onLogoMask, backfillRoundLogos, maskToRoundPng, circleMask }
