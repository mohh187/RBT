// The pure half of imageBackfill: deciding which strings are menu photos, and
// swapping them inside a document tree. Kept free of any firebase import so it
// can be exercised by imageBackfill.test.mjs under plain node — this code
// rewrites live venue documents, and a mistake in swapUrls would not throw, it
// would quietly point a menu at the wrong picture.

const HOST = 'firebasestorage.googleapis.com'
// The pixel ceiling itself lives in storage.js (maxPxFor), so the upload path
// and the backfill can never drift apart on what "too big" means.
// Digital signage plays full-screen on a venue-owned TV over the venue's own
// network, so a full-resolution master is the point there rather than a
// mistake; it is also the one folder storage.rules gives a bigger ceiling to.
// Attendance holds staff selfies, which are nobody's menu.
const SKIP_FOLDERS = ['signage', 'attendance']
const IS_IMAGE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i

export const isCandidate = (s) => (
  typeof s === 'string'
  && s.length > 40
  && s.includes(HOST)
  && !SKIP_FOLDERS.some((f) => s.includes(`%2F${f}%2F`))
  // a .glb standee and an .mp4 item background live in these same fields
  && IS_IMAGE.test(s.split('?')[0])
)

// Every Storage image URL anywhere in a value, at any depth. Documents are read
// as TREES rather than as a list of known fields on purpose: photos hide in
// imageUrl, images[], bgUrl, table.url, table.topUrl, story frames and hotspots,
// and enumerating those by hand is exactly how one gets missed.
export function collectUrls(v, out) {
  if (typeof v === 'string') { if (isCandidate(v)) out.add(v); return out }
  if (Array.isArray(v)) { v.forEach((x) => collectUrls(x, out)); return out }
  if (v && typeof v === 'object') { Object.values(v).forEach((x) => collectUrls(x, out)) }
  return out
}

// The same tree with every rewritten URL swapped. Returns the ORIGINAL object
// by identity when nothing changed, which is what lets the caller write only
// the fields that moved instead of the whole document.
export function swapUrls(v, map) {
  if (typeof v === 'string') return map.get(v) || v
  if (Array.isArray(v)) {
    let hit = false
    const next = v.map((x) => { const r = swapUrls(x, map); if (r !== x) hit = true; return r })
    return hit ? next : v
  }
  if (v && typeof v === 'object') {
    let hit = false
    const next = {}
    for (const [k, x] of Object.entries(v)) { const r = swapUrls(x, map); if (r !== x) hit = true; next[k] = r }
    return hit ? next : v
  }
  return v
}

// The folder the object already lives in, so a rewritten photo lands beside its
// original and keeps matching the storage.rules path it was written under.
export function folderOf(url) {
  const m = /\/o\/tenants%2F[^%]+%2F(.+?)%2F[^%/?]+\?/.exec(url)
  return m ? decodeURIComponent(m[1]) : 'items'
}
