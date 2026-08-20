// node src/lib/imageBackfill.test.mjs
//
// The backfill rewrites LIVE venue documents, and its failure mode is silent:
// a bad swap does not throw, it points a menu at the wrong picture. These are
// the cases that actually bite.
import assert from 'node:assert/strict'
import { isCandidate, collectUrls, swapUrls, folderOf } from './imageBackfillCore.js'

const u = (folder, file) => `https://firebasestorage.googleapis.com/v0/b/menu-88996.firebasestorage.app/o/tenants%2F5Eg401SLtIhqjaMAdrIg%2F${folder}%2F1784642975364-jZwRQe.${file}?alt=media&token=abc-123`

// --- what counts as a menu photo -------------------------------------------
assert.equal(isCandidate(u('items', 'webp')), true)
assert.equal(isCandidate(u('branding', 'jpg')), true)
assert.equal(isCandidate(u('items', 'png')), true, 'cutouts are png and must be included')
// a 3D standee and a background video sit in the very same fields
assert.equal(isCandidate(u('items', 'glb')), false)
assert.equal(isCandidate(u('itembg', 'mp4')), false)
// signage is a TV master over the venue's own network, not a phone payload
assert.equal(isCandidate(u('signage', 'jpg')), false)
assert.equal(isCandidate(u('attendance', 'jpg')), false, 'staff selfies are nobody\'s menu')
assert.equal(isCandidate('https://example.com/photo.jpg'), false)
assert.equal(isCandidate(''), false)
assert.equal(isCandidate(null), false)
assert.equal(isCandidate(42), false)

// --- finding them wherever they hide ---------------------------------------
const item = {
  nameAr: 'كبسة',
  price: 45,
  imageUrl: u('items', 'webp'),
  images: [u('items', 'jpg'), u('items', 'png')],
  model3dUrl: u('items', 'glb'),
  table: { url: u('branding', 'jpg'), topUrl: u('branding', 'jpg'), blur: 0 },
  story: { frames: [{ bg: u('items', 'avif') }] },
  available: true,
  createdAt: null,
}
const found = collectUrls(item, new Set())
assert.equal(found.size, 5, 'four distinct photos plus the shared table one, the .glb excluded')
assert.ok(found.has(u('items', 'avif')), 'reaches a url nested two levels inside an array')
assert.ok(!found.has(u('items', 'glb')))
// table.url and table.topUrl are the SAME picture: compressing it twice would
// upload one image twice and leave the dish pointing at two different copies
assert.equal([...found].filter((x) => x === u('branding', 'jpg')).length, 1)

// --- swapping, and leaving untouched trees alone ---------------------------
const map = new Map([[u('items', 'webp'), 'NEW_MAIN'], [u('items', 'png'), 'NEW_SECOND']])
const next = swapUrls(item, map)
assert.equal(next.imageUrl, 'NEW_MAIN')
assert.deepEqual(next.images, [u('items', 'jpg'), 'NEW_SECOND'])
assert.equal(next.nameAr, 'كبسة', 'untouched scalars survive')
assert.equal(next.price, 45)
assert.equal(next.available, true)
assert.equal(next.createdAt, null, 'a null field must not become undefined, firestore rejects that')
assert.equal(next.table, item.table, 'an unchanged subtree keeps IDENTITY so it is never rewritten')
assert.equal(next.story, item.story)
// identity is the signal the caller uses to build a partial update
assert.equal(swapUrls(item, new Map()), item, 'no matches at all means no write')

// --- the folder a rewritten photo goes back to -----------------------------
assert.equal(folderOf(u('items', 'webp')), 'items')
assert.equal(folderOf(u('branding', 'jpg')), 'branding')
assert.equal(folderOf(u('library%2Fmarketing', 'jpg')), 'library/marketing', 'nested folders decode')
assert.equal(folderOf('https://example.com/nope.jpg'), 'items', 'unparseable falls back, never crashes')

console.log('imageBackfill core: all checks passed')
