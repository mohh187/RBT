// Google-review import pipeline (Reviews Studio) + guest venue reviews.
//
// INTEGRITY CONTRACT (non-negotiable): an imported Google review may be attached
// to a specific ITEM only when its TEXT genuinely mentions that item (fuzzy
// Arabic-normalized name match confirmed by AI). Anything else stays VENUE-level
// (itemId: null). Imported docs always carry source:'google' so every surface
// can label them «من تقييمات جوجل». We NEVER fabricate, rewrite, or reassign
// review text/ratings — parsing extracts verbatim, matching only classifies.
//
// Docs are written to the SAME tenants/{tid}/reviews collection with the exact
// shape createReview (src/lib/db.js) uses, plus additive fields only:
// { source, authorName, importedAt } and itemId may be null (venue-level).
// Firestore rules require rating to be a number 1..5 on create — rows without a
// parsed rating must get one from the manager before saving (we never invent it).

import { collection, doc, addDoc, deleteDoc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase.js'
import { normalizeAr } from './globalSearch.js'

// aiBridge pulls in the whole assistant tool registry (actions.js, ~120 kB) plus
// firebase/functions. Only the Google-review IMPORT helpers below need it — the
// diner-facing createVenueReview does not — and this module is reachable from
// the public order-status screen, so a static import put all of that on the
// diner's critical path. Both call sites are already async.
const aiQuick = async (...args) => (await import('./aiBridge.js')).aiQuick(...args)

const reviewsCol = (tid) => collection(db, 'tenants', tid, 'reviews')

// High-confidence threshold for auto-attaching a review to an item.
export const ATTACH_CONFIDENCE = 0.8

// ---------- tolerant JSON extraction (models love ```json fences) ----------
function extractJsonArray(text) {
  const raw = String(text || '').replace(/```(?:json)?/gi, '').trim()
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) throw new Error('AI did not return a JSON array')
  return JSON.parse(raw.slice(start, end + 1))
}

const clampRating = (r) => {
  const n = Number(r)
  if (!Number.isFinite(n) || n < 1) return null
  return Math.max(1, Math.min(5, Math.round(n)))
}

// ---------- 1) parse pasted free text into structured reviews ----------
// Accepts any pasted format of Google reviews (copied page text, exported list…)
// and returns [{ authorName, rating (1-5 | null), text }]. Text is verbatim.
export async function parseReviews(rawText) {
  const src = String(rawText || '').trim()
  if (!src) return []
  const prompt = [
    'You are a strict data extractor. The user pasted raw text copied from Google Maps reviews of a café/restaurant (any language, usually Arabic, any formatting).',
    'Extract every distinct customer review into a JSON array. For each review return:',
    '{ "authorName": string (reviewer name, "" if unknown), "rating": number 1-5 or null if no star rating is visible for that review, "text": string (the review body VERBATIM, do not translate, do not rewrite, do not summarize; "" if the review is stars-only) }',
    'Rules: NEVER invent reviews, names, ratings, or text. NEVER merge two reviews. Ignore owner replies, dates, "Local Guide" badges, like counts, and UI noise.',
    'Return ONLY the JSON array, no commentary.',
    '--- PASTED TEXT START ---',
    src,
    '--- PASTED TEXT END ---',
  ].join('\n')
  const out = await aiQuick(prompt)
  const arr = extractJsonArray(out)
  return arr
    .map((r) => ({
      authorName: String(r?.authorName || '').trim().slice(0, 120),
      rating: clampRating(r?.rating),
      text: String(r?.text || '').trim().slice(0, 2000),
    }))
    .filter((r) => r.text || r.rating) // drop empty artifacts
}

// ---------- 2) classify: which item (if any) does each review mention? ----------
// AI answers ONE question per review: does the review TEXT explicitly mention one
// of the venue's item names (Arabic-normalized fuzzy: typos, word order, ال/ة/ى
// variants count; a generic word like «قهوة» alone does NOT equal a specific
// item name)? Returns per review:
//   { itemId: string|null, confidence: 0..1, mentionedItemIds: string[] }
// itemId is non-null only for an explicit mention at/above ATTACH_CONFIDENCE —
// everything else stays venue-level. Ids are validated against the given items
// so a hallucinated id can never attach.
export async function matchReviewsToItems(reviews, items) {
  const list = Array.isArray(reviews) ? reviews : []
  const valid = new Set((items || []).map((i) => i.id))
  const noMatch = { itemId: null, confidence: 0, mentionedItemIds: [] }
  if (!list.length || !valid.size) return list.map(() => ({ ...noMatch }))

  const itemLines = (items || []).map((i) => `${i.id} :: ${[i.nameAr, i.nameEn].filter(Boolean).join(' / ')}`).join('\n')
  const reviewLines = list.map((r, idx) => `#${idx}: ${String(r.text || '').replace(/\s+/g, ' ').slice(0, 500)}`).join('\n')
  const prompt = [
    'You classify café reviews. For EACH review below decide: does the review TEXT explicitly mention one of the menu item NAMES listed (fuzzy Arabic-aware match: spelling variants, ال prefix, ة/ه, ى/ي, word order, minor typos are OK)?',
    'A generic category word (قهوة، شاي، حلى، coffee, dessert…) that is not the item\'s actual name is NOT a mention. Praise of the place, service, or staff is NOT a mention.',
    'MENU ITEMS (id :: name):',
    itemLines,
    'REVIEWS:',
    reviewLines,
    'Return ONLY a JSON array with one object per review, same order:',
    '{ "index": number, "mentionedItemIds": [ids of items whose NAME the text mentions, [] if none], "itemId": the single best-matching mentioned id or null, "confidence": 0..1 (how certain the text names that exact item) }',
    'Be conservative: when unsure, use itemId null and low confidence. NEVER output an id that is not in the menu list.',
  ].join('\n')

  let parsed = []
  try { parsed = extractJsonArray(await aiQuick(prompt)) } catch (_) { parsed = [] }
  const byIndex = new Map()
  parsed.forEach((row) => { if (row && Number.isInteger(Number(row.index))) byIndex.set(Number(row.index), row) })

  return list.map((r, idx) => {
    const row = byIndex.get(idx)
    if (!row) return { ...noMatch }
    const mentioned = [...new Set((Array.isArray(row.mentionedItemIds) ? row.mentionedItemIds : []).filter((id) => valid.has(id)))]
    const confidence = Math.max(0, Math.min(1, Number(row.confidence) || 0))
    let itemId = valid.has(row.itemId) && mentioned.includes(row.itemId) ? row.itemId : null
    // stars-only reviews have no text to mention anything — always venue-level
    if (!String(r.text || '').trim()) itemId = null
    if (itemId && confidence < ATTACH_CONFIDENCE) itemId = null
    return { itemId, confidence, mentionedItemIds: mentioned }
  })
}

// ---------- 3) persist an imported review ----------
// Mirrors createReview's document shape EXACTLY, additive fields only.
// review: { authorName, rating (1-5, REQUIRED by rules), text, itemNameAr?, itemNameEn? }
export async function saveImported(tenantId, review, itemId = null) {
  const rating = clampRating(review?.rating)
  if (!rating) throw new Error('rating 1-5 required') // rules reject it anyway — never invent one
  return addDoc(reviewsCol(tenantId), {
    // ---- mirrored createReview shape ----
    itemId: itemId || null,
    itemNameAr: (itemId && review?.itemNameAr) || '',
    itemNameEn: (itemId && review?.itemNameEn) || '',
    name: review?.authorName || '',
    rating,
    comment: review?.text || '',
    staffUid: '', // imported reviews never credit a staffer (perf scoring ignores '')
    createdAt: serverTimestamp(),
    // ---- additive import fields ----
    source: 'google',
    authorName: review?.authorName || '',
    importedAt: serverTimestamp(),
  })
}

// ---------- guest venue review (order-status flow) ----------
// Same mirrored shape, itemId null (whole-venue), source 'order'.
export async function createVenueReview(tid, { name, rating, comment }) {
  const stars = clampRating(rating)
  if (!stars) throw new Error('rating 1-5 required')
  return addDoc(reviewsCol(tid), {
    itemId: null,
    itemNameAr: '',
    itemNameEn: '',
    name: name || '',
    rating: stars,
    comment: comment || '',
    staffUid: '',
    createdAt: serverTimestamp(),
    source: 'order',
  })
}

// ---------- studio helpers: list + moderate what was imported ----------
export function watchImportedReviews(tid, cb) {
  const q = query(reviewsCol(tid), where('source', '==', 'google'))
  return onSnapshot(
    q,
    (s) => {
      const rows = s.docs.map((d) => ({ id: d.id, ...d.data() }))
      rows.sort((a, b) => (b.importedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0) - (a.importedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0))
      cb(rows)
    },
    () => cb([]),
  )
}

export async function deleteImportedReview(tid, id) {
  return deleteDoc(doc(db, 'tenants', tid, 'reviews', id))
}

// Deterministic Arabic-normalized substring check — used by the studio UI to
// visibly flag when a manager overrides the AI onto an item the text never names.
export function textMentionsItem(text, item) {
  const t = normalizeAr(text)
  if (!t) return false
  return [item?.nameAr, item?.nameEn].filter(Boolean).some((n) => {
    const needle = normalizeAr(n)
    return needle.length >= 3 && t.includes(needle)
  })
}
