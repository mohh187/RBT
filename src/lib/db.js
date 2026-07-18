// Firestore data-access layer for RBT360 (multi-tenant).
// All tenant data lives under tenants/{tid}/...; top-level: users, tenantSlugs.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  increment,
  deleteField,
} from 'firebase/firestore'
import { db } from './firebase.js'
import { randomToken, slugify, normalizePhone } from './format.js'
import { isEligible, tierForPoints, newMembership, DEFAULT_MEMBERSHIP_POLICY, resolveMembershipPolicy } from './membership.js'
import { roleDefaultCaps } from './permissions.js'

export { serverTimestamp, increment }

// ---------- path helpers ----------
export const userRef = (uid) => doc(db, 'users', uid)
export const tenantRef = (tid) => doc(db, 'tenants', tid)
export const slugRef = (slug) => doc(db, 'tenantSlugs', slug)
const sub = (tid, name) => collection(db, 'tenants', tid, name)
const subDoc = (tid, name, id) => doc(db, 'tenants', tid, name, id)

// ---------- users ----------
export async function getUserProfile(uid) {
  const snap = await getDoc(userRef(uid))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}
export async function createUserProfile(uid, data) {
  await setDoc(userRef(uid), { createdAt: serverTimestamp(), ...data }, { merge: true })
}

// ---------- tenant / onboarding ----------
export async function getTenant(tid) {
  const snap = await getDoc(tenantRef(tid))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}
export async function resolveSlug(slug) {
  const snap = await getDoc(slugRef(slug))
  return snap.exists() ? snap.data().tenantId : null
}
export async function isSlugAvailable(slug) {
  const snap = await getDoc(slugRef(slug))
  return !snap.exists()
}

// Creates tenant + slug claim + links owner user, atomically.
// NOTE: `active` is a platform-owned field (blocked by rules at create); a venue
// is treated as active unless the platform sets active:false, so we don't write it.
export async function createTenant(ownerUid, { name, type, slug, currency, themeColor, themeAccent, themePreset }) {
  let finalSlug = slugify(slug || name) || `venue-${randomToken(5).toLowerCase()}`
  if (!(await isSlugAvailable(finalSlug))) finalSlug = `${finalSlug}-${randomToken(4).toLowerCase()}`
  const tid = doc(sub('_', 'tmp')).id // generate an id

  // Retry on a slug collision that races the outside-transaction availability
  // check, re-deriving a suffixed slug rather than throwing to the UI.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await runTransaction(db, async (tx) => {
        const slugSnap = await tx.get(slugRef(finalSlug))
        if (slugSnap.exists()) throw new Error('slug-taken')
        tx.set(tenantRef(tid), {
          name,
          type: type || 'cafe',
          slug: finalSlug,
          ownerUid,
          currency: currency || 'SAR',
          themeColor: themeColor || '#171717',
          themeAccent: themeAccent || '#525252',
          themePreset: themePreset || 'mono',
          locale: 'ar',
          loyaltyEnabled: true,
          loyaltyThreshold: 5,
          orderSeq: 0,
          createdAt: serverTimestamp(),
        })
        tx.set(slugRef(finalSlug), { tenantId: tid })
        tx.set(userRef(ownerUid), { tenantId: tid, role: 'owner' }, { merge: true })
      })
      return { id: tid, slug: finalSlug }
    } catch (e) {
      if (e?.message === 'slug-taken' && attempt < 3) {
        finalSlug = `${slugify(slug || name) || 'venue'}-${randomToken(4).toLowerCase()}`
        continue
      }
      throw e
    }
  }
  return { id: tid, slug: finalSlug }
}

export async function updateTenant(tid, data) {
  await updateDoc(tenantRef(tid), { ...data, updatedAt: serverTimestamp() })
}

// ---------- categories ----------
export function watchCategories(tid, cb) {
  const q = query(sub(tid, 'categories'), orderBy('sortOrder', 'asc'))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function listCategories(tid) {
  const s = await getDocs(query(sub(tid, 'categories'), orderBy('sortOrder', 'asc')))
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
}
export async function saveCategory(tid, id, data) {
  const payload = { ...data, sortOrder: Number(data.sortOrder) || 0 }
  if (id) return updateDoc(subDoc(tid, 'categories', id), { ...payload, updatedAt: serverTimestamp() })
  return addDoc(sub(tid, 'categories'), { ...payload, createdAt: serverTimestamp() })
}
export async function deleteCategory(tid, id) {
  return deleteDoc(subDoc(tid, 'categories', id))
}

// ---------- items ----------
export function watchItems(tid, cb) {
  const q = query(sub(tid, 'items'), orderBy('sortOrder', 'asc'))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function listItems(tid) {
  const s = await getDocs(sub(tid, 'items'))
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
}
export async function saveItem(tid, id, data) {
  // partial updates (stock toggles, apply-to-all styling, AI edits) must NOT
  // touch sortOrder — normalizing an absent value to 0 was silently collapsing
  // the whole menu's manual ordering
  if (id) {
    const payload = data.sortOrder != null ? { ...data, sortOrder: Number(data.sortOrder) || 0 } : data
    return updateDoc(subDoc(tid, 'items', id), { ...payload, updatedAt: serverTimestamp() })
  }
  return addDoc(sub(tid, 'items'), { ...data, sortOrder: Number(data.sortOrder) || 0, createdAt: serverTimestamp() })
}
export async function deleteItem(tid, id) {
  return deleteDoc(subDoc(tid, 'items', id))
}
// Full clone of an item — variants, modifiers, recipe, images, pairings, description,
// everything — with a fresh id, a "(نسخة)" name, placed right after the original.
export async function duplicateItem(tid, id) {
  const it = await getItem(tid, id)
  if (!it) return null
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = it
  return saveItem(tid, null, { ...rest, nameAr: `${it.nameAr || ''} (نسخة)`.trim(), sortOrder: (Number(it.sortOrder) || 0) + 1 })
}
export async function setItemAvailability(tid, id, available) {
  return updateDoc(subDoc(tid, 'items', id), { available })
}

// ---------- materials (raw inventory) ----------
export function watchMaterials(tid, cb) {
  return onSnapshot(query(sub(tid, 'materials'), orderBy('nameAr', 'asc')), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function saveMaterial(tid, id, data) {
  if (id) return updateDoc(subDoc(tid, 'materials', id), { ...data, updatedAt: serverTimestamp() })
  return addDoc(sub(tid, 'materials'), { stockQty: 0, avgCost: 0, ...data, createdAt: serverTimestamp() })
}
export async function deleteMaterial(tid, id) {
  return deleteDoc(subDoc(tid, 'materials', id))
}
// Receive purchased stock (qty already converted to the material's base unit) + weighted avg cost.
export async function receiveStock(tid, materialId, { qtyBase = 0, totalCost = 0, actor = '', supplierId = '' } = {}) {
  const ref = subDoc(tid, 'materials', materialId)
  const addQty = Number(qtyBase) || 0
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    const d = snap.data()
    const oldQty = d.stockQty || 0
    const newQty = oldQty + addQty
    const addUnitCost = addQty > 0 ? (Number(totalCost) || 0) / addQty : 0
    const avgCost = newQty > 0 ? ((oldQty * (d.avgCost || 0)) + (addQty * addUnitCost)) / newQty : (d.avgCost || 0)
    tx.update(ref, { stockQty: newQty, avgCost, lastReceivedAt: Date.now(), updatedAt: serverTimestamp() })
  })
  return addDoc(sub(tid, 'stockMoves'), { type: 'receive', materialId, qty: addQty, cost: Number(totalCost) || 0, supplierId: supplierId || '', byName: actor, at: Date.now(), createdAt: serverTimestamp() })
}
// Physical count → set absolute stock; logs the delta.
export async function countStock(tid, materialId, { countedBase = 0, actor = '' } = {}) {
  const ref = subDoc(tid, 'materials', materialId)
  let delta = 0
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    const counted = Math.max(0, Number(countedBase) || 0)
    delta = counted - (snap.data().stockQty || 0)
    tx.update(ref, { stockQty: counted, lastCountAt: Date.now(), updatedAt: serverTimestamp() })
  })
  return addDoc(sub(tid, 'stockMoves'), { type: 'count', materialId, qty: delta, byName: actor, at: Date.now(), createdAt: serverTimestamp() })
}
// Waste / spoilage → subtract a positive amount.
export async function wasteStock(tid, materialId, { qtyBase = 0, reason = '', actor = '' } = {}) {
  const amt = Math.abs(Number(qtyBase) || 0)
  const ref = subDoc(tid, 'materials', materialId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    tx.update(ref, { stockQty: Math.max(0, (snap.data().stockQty || 0) - amt), updatedAt: serverTimestamp() })
  })
  return addDoc(sub(tid, 'stockMoves'), { type: 'waste', materialId, qty: -amt, reason: reason || '', byName: actor, at: Date.now(), createdAt: serverTimestamp() })
}
export function watchStockMoves(tid, cb, max = 120) {
  return onSnapshot(query(sub(tid, 'stockMoves'), orderBy('at', 'desc'), limit(max)), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}

// Produce a semi-finished material (sub-recipe): consume its ingredient materials and add the yield.
export async function produceMaterial(tid, materialId, { batches = 1, actor = '' } = {}) {
  const ref = subDoc(tid, 'materials', materialId)
  const n = Math.max(1, Number(batches) || 1)
  
  try {
    const produced = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new Error('material-not-found')
      const m = snap.data()
      const lines = (m.subRecipe || []).filter((l) => l.materialId && Number(l.qty) > 0)
      const yieldAmt = (Number(m.yieldQty) || 0) * n
      if (!lines.length || yieldAmt <= 0) throw new Error('invalid-recipe')

      // Fetch all ingredients inside transaction
      const ingredientSnaps = await Promise.all(lines.map((l) => tx.get(subDoc(tid, 'materials', l.materialId))))
      
      // Update ingredients stockQty
      ingredientSnaps.forEach((s, idx) => {
        if (!s.exists()) return
        const l = lines[idx]
        const currentStock = s.data().stockQty || 0
        const nextStock = currentStock - (Number(l.qty) || 0) * n
        tx.update(s.ref, { stockQty: nextStock, updatedAt: serverTimestamp() })
      })

      // Update target material stockQty
      const currentProducedStock = snap.data().stockQty || 0
      tx.update(ref, { stockQty: currentProducedStock + yieldAmt, updatedAt: serverTimestamp() })

      // Generate stock moves inside transaction
      const prodMoveRef = doc(sub(tid, 'stockMoves'))
      tx.set(prodMoveRef, {
        type: 'count',
        materialId,
        qty: yieldAmt,
        reason: 'produce',
        byName: actor,
        at: Date.now(),
        createdAt: serverTimestamp()
      })

      lines.forEach((l) => {
        const ingMoveRef = doc(sub(tid, 'stockMoves'))
        tx.set(ingMoveRef, {
          type: 'sale',
          materialId: l.materialId,
          qty: -(Number(l.qty) || 0) * n,
          reason: 'produce',
          byName: actor,
          at: Date.now(),
          createdAt: serverTimestamp()
        })
      })

      return yieldAmt
    })
    return { ok: true, produced }
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) }
  }
}
export async function listMaterials(tid) {
  const s = await getDocs(query(sub(tid, 'materials'), orderBy('nameAr', 'asc')))
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
}
export async function listOrdersSince(tid, sinceDate) {
  const s = await getDocs(query(sub(tid, 'orders'), where('createdAt', '>=', sinceDate), orderBy('createdAt', 'desc')))
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
}
// AI assistant audit log
export function logAi(tid, data) {
  return addDoc(sub(tid, 'aiLog'), { ...data, at: Date.now(), createdAt: serverTimestamp() })
}

// ---------- AI durable memory (self-learning: customer/staff behaviour, decisions,
//            menu conventions) — read into every assistant turn's context ----------
export function saveAiMemory(tid, { text = '', tags = [], kind = 'note', by = 'ai' } = {}) {
  return addDoc(sub(tid, 'aiMemory'), {
    text: String(text || '').slice(0, 800),
    tags: (Array.isArray(tags) ? tags : []).map((t) => String(t)).slice(0, 8),
    kind, by, at: Date.now(), createdAt: serverTimestamp(),
  })
}
export async function listAiMemory(tid, max = 100) {
  const snap = await getDocs(query(sub(tid, 'aiMemory'), orderBy('at', 'desc'), limit(max)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}
export function deleteAiMemory(tid, id) { return deleteDoc(subDoc(tid, 'aiMemory', id)) }

// ---------- expenses (operating costs → true net profit) ----------
export function addExpense(tid, { amount = 0, category = '', note = '', actor = '' } = {}) {
  return addDoc(sub(tid, 'expenses'), { amount: Number(amount) || 0, category: category || 'other', note: note || '', byName: actor, at: Date.now(), createdAt: serverTimestamp() })
}
export function deleteExpense(tid, id) { return deleteDoc(subDoc(tid, 'expenses', id)) }
export function watchExpensesSince(tid, sinceDate, cb) {
  return onSnapshot(query(sub(tid, 'expenses'), where('createdAt', '>=', sinceDate), orderBy('createdAt', 'desc')), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function listExpensesSince(tid, sinceDate) {
  const s = await getDocs(query(sub(tid, 'expenses'), where('createdAt', '>=', sinceDate), orderBy('createdAt', 'desc')))
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
}
// One-shot list helpers (used by the AI assistant tools)
export async function listOffers(tid) { const s = await getDocs(sub(tid, 'offers')); return s.docs.map((d) => ({ id: d.id, ...d.data() })) }
export async function listSuppliers(tid) { const s = await getDocs(query(sub(tid, 'suppliers'), orderBy('name', 'asc'))); return s.docs.map((d) => ({ id: d.id, ...d.data() })) }
export async function listActiveOrders(tid) { const s = await getDocs(query(sub(tid, 'orders'), where('status', 'in', ['pending', 'accepted', 'preparing', 'ready']), orderBy('createdAt', 'asc'))); return s.docs.map((d) => ({ id: d.id, ...d.data() })) }
export async function listCustomers(tid, max = 200) { const s = await getDocs(query(sub(tid, 'customers'), orderBy('lastOrderAt', 'desc'), limit(max))); return s.docs.map((d) => ({ id: d.id, ...d.data() })) }
export async function listStockMoves(tid, max = 300) { const s = await getDocs(query(sub(tid, 'stockMoves'), orderBy('at', 'desc'), limit(max))); return s.docs.map((d) => ({ id: d.id, ...d.data() })) }
export async function listLoyaltyLog(tid, phone, max = 50) { const pid = phoneId(phone); const s = await getDocs(query(sub(tid, 'loyaltyLog'), where('phoneId', '==', pid), limit(max))); return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.at || 0) - (a.at || 0)) }

// Award bonus points to a member (manual / AI). Optional policy recomputes the tier.
export async function awardPoints(tid, phone, { points = 0, reason = '', actor = '', policy = null } = {}) {
  if (!phone || points <= 0) return null
  const ref = subDoc(tid, 'customers', phoneId(phone))
  let mid = ''
  const res = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return null
    const d = snap.data(); const m = d.membership
    if (!m?.active) return null
    mid = m.memberId || ''
    const lifetime = (m.pointsLifetime || 0) + points
    const pts = (m.points || 0) + points
    const tt = policy ? tierForPoints(policy, lifetime, d.totalOrders || 0) : { tier: m.tier, discountPct: m.discountPct }
    const upd = { ...m, points: pts, pointsLifetime: lifetime, tier: tt.tier, discountPct: tt.discountPct, lastEarnAt: Date.now() }
    tx.set(ref, { membership: upd }, { merge: true })
    tx.set(subDoc(tid, 'memberCards', m.token), memberCardFields(d, upd), { merge: true })
    return upd
  })
  if (res) logLoyalty(tid, { phone, memberId: mid, type: 'earn', points, byName: actor || reason }).catch(() => {})
  return res
}

// ---------- suppliers ----------
export function watchSuppliers(tid, cb) {
  return onSnapshot(query(sub(tid, 'suppliers'), orderBy('name', 'asc')), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function saveSupplier(tid, id, data) {
  if (id) return updateDoc(subDoc(tid, 'suppliers', id), { ...data, updatedAt: serverTimestamp() })
  return addDoc(sub(tid, 'suppliers'), { ...data, createdAt: serverTimestamp() })
}
export async function deleteSupplier(tid, id) {
  return deleteDoc(subDoc(tid, 'suppliers', id))
}

// ---------- item reviews (guest-submitted) ----------
export async function createReview(tid, { itemId, itemNameAr, itemNameEn, name, rating, comment, staffUid }) {
  return addDoc(sub(tid, 'reviews'), {
    itemId,
    itemNameAr: itemNameAr || '',
    itemNameEn: itemNameEn || '',
    name: name || '',
    rating: Math.max(1, Math.min(5, Number(rating) || 5)),
    comment: comment || '',
    staffUid: staffUid || '', // the staffer credited for this order (for performance scoring)
    createdAt: serverTimestamp(),
  })
}
// All recent ratings across items (admin dashboard).
export function watchAllReviews(tid, cb, max = 50) {
  const q = query(sub(tid, 'reviews'), orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}

// ---------- complaints (guest-submitted) ----------
export async function createComplaint(tid, { name, phone, orderCode, message }) {
  return addDoc(sub(tid, 'complaints'), {
    name: name || '',
    phone: phone || '',
    orderCode: orderCode || '',
    message: String(message || '').slice(0, 1000),
    status: 'open',
    createdAt: serverTimestamp(),
  })
}
export function watchComplaints(tid, cb, max = 200) {
  const q = query(sub(tid, 'complaints'), orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function setComplaintStatus(tid, id, status) {
  return updateDoc(subDoc(tid, 'complaints', id), { status, updatedAt: serverTimestamp() })
}
export function watchItemReviews(tid, itemId, cb) {
  const q = query(sub(tid, 'reviews'), where('itemId', '==', itemId), limit(100))
  return onSnapshot(
    q,
    (s) => {
      const list = s.docs.map((d) => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      cb(list)
    },
    () => cb([]),
  )
}

// ---------- tables ----------
export function watchTables(tid, cb) {
  const q = query(sub(tid, 'tables'), orderBy('createdAt', 'asc'))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function listTables(tid) {
  const s = await getDocs(sub(tid, 'tables'))
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
}
export async function createTable(tid, { label, seats, shape = 'round', zone = '' }) {
  return addDoc(sub(tid, 'tables'), {
    label,
    seats: seats || 4,
    shape,
    zone,
    qrToken: randomToken(10),
    active: true,
    createdAt: serverTimestamp(),
  })
}
export async function saveTable(tid, id, data) {
  return updateDoc(subDoc(tid, 'tables', id), data)
}
export async function deleteTable(tid, id) {
  return deleteDoc(subDoc(tid, 'tables', id))
}
export async function resolveTableByToken(tid, token) {
  const s = await getDocs(query(sub(tid, 'tables'), where('qrToken', '==', token), limit(1)))
  if (s.empty) return null
  const d = s.docs[0]
  return { id: d.id, ...d.data() }
}

// ---------- offers ----------
export function watchOffers(tid, cb) {
  return onSnapshot(sub(tid, 'offers'), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function saveOffer(tid, id, data) {
  if (id) return updateDoc(subDoc(tid, 'offers', id), { ...data, updatedAt: serverTimestamp() })
  return addDoc(sub(tid, 'offers'), { ...data, createdAt: serverTimestamp() })
}
export async function deleteOffer(tid, id) {
  return deleteDoc(subDoc(tid, 'offers', id))
}

// ---------- orders ----------
// Create an order. Diners are anonymous and cannot write the tenant doc, so we use a
// self-contained short human code (no global counter) instead of a server sequence.
// Decrement on-hand stock for ordered items (best-effort; non-tracked items just ignore the field).
export async function decrementStock(tid, items) {
  const lines = (items || []).filter((l) => l.itemId && l.qty > 0)
  await Promise.all(lines.map((l) => updateDoc(subDoc(tid, 'items', l.itemId), { stock: increment(-l.qty) }).catch(() => {})))
}

export async function getItem(tid, id) {
  const s = await getDoc(subDoc(tid, 'items', id))
  return s.exists() ? { id: s.id, ...s.data() } : null
}

// Consume raw materials for a settled order per each item's recipe (by variant).
// Reads the items itself, deducts material stock (increment), logs sale moves,
// and snapshots usage on the order (idempotent via order.materialUsage).
export async function consumeForOrder(tid, orderId, { actor = '' } = {}) {
  const order = await getOrder(tid, orderId)
  if (!order || order.materialUsage) return null // already consumed / missing
  const ids = [...new Set((order.items || []).map((l) => l.itemId).filter(Boolean))]
  const itemDocs = {}
  await Promise.all(ids.map(async (id) => { const it = await getItem(tid, id).catch(() => null); if (it) itemDocs[id] = it }))
  const usage = {}
  const addUsage = (lines, qty) => (lines || []).forEach((r) => { if (r.materialId) usage[r.materialId] = (usage[r.materialId] || 0) + (Number(r.qty) || 0) * (qty || 1) })
  ;(order.items || []).forEach((line) => {
    const it = itemDocs[line.itemId]
    if (it && it.stockMode === 'recipe') addUsage((line.variantKey && it.variantRecipes?.[line.variantKey]) || it.recipe || [], line.qty)
    ;(line.modifiers || []).forEach((mod) => addUsage(mod.recipe, line.qty)) // modifier consumption (e.g. extra shot)
  })
  const entries = Object.entries(usage).filter(([, q]) => q > 0)
  await updateDoc(subDoc(tid, 'orders', orderId), { materialUsage: usage }).catch(() => {}) // mark consumed (even if empty)
  if (!entries.length) return usage
  await Promise.all(entries.map(([mid, q]) => updateDoc(subDoc(tid, 'materials', mid), { stockQty: increment(-q) }).catch(() => {})))
  await Promise.all(entries.map(([mid, q]) => addDoc(sub(tid, 'stockMoves'), { type: 'sale', materialId: mid, qty: -q, orderId, byName: actor, at: Date.now(), createdAt: serverTimestamp() }).catch(() => {})))
  return usage
}

// Add consumed materials back (on cancel/full refund of a settled order).
async function restoreMaterials(tid, usage, orderId) {
  const entries = Object.entries(usage || {}).filter(([, q]) => q > 0)
  if (!entries.length) return
  await Promise.all(entries.map(([mid, q]) => updateDoc(subDoc(tid, 'materials', mid), { stockQty: increment(q) }).catch(() => {})))
  await Promise.all(entries.map(([mid, q]) => addDoc(sub(tid, 'stockMoves'), { type: 'count', materialId: mid, qty: q, reason: 'restore', orderId, at: Date.now(), createdAt: serverTimestamp() }).catch(() => {})))
}
// Add finished-good stock back (decremented at order creation).
async function restoreFinishedGoods(tid, items) {
  const lines = (items || []).filter((l) => l.itemId && l.qty > 0)
  await Promise.all(lines.map((l) => updateDoc(subDoc(tid, 'items', l.itemId), { stock: increment(l.qty) }).catch(() => {})))
}
// Restore both material + finished-good stock for an order, once.
async function restoreOrderStock(tid, order, id) {
  if (!order || order.stockRestored) return
  if (order.materialUsage) await restoreMaterials(tid, order.materialUsage, id).catch(() => {})
  await restoreFinishedGoods(tid, order.items).catch(() => {})
  await updateDoc(subDoc(tid, 'orders', id), { stockRestored: true }).catch(() => {})
}

// Firestore rejects ANY write containing `undefined` at any depth (a single
// undefined nested field, e.g. a modifier with no English name, aborts the whole
// order). Deep-strip undefined so Arabic-only menus can't break order creation.
export function stripUndefined(v) {
  if (Array.isArray(v)) return v.map(stripUndefined)
  if (v && typeof v === 'object' && !(v instanceof Date) && typeof v.toDate !== 'function') {
    const out = {}
    for (const k in v) { if (v[k] !== undefined) out[k] = stripUndefined(v[k]) }
    return out
  }
  return v
}

// opts.hold=true creates the order as 'awaiting_payment' — it is HIDDEN from the
// kitchen/cashier (watchActiveOrders excludes it) and skipped by onNewOrder until
// the online payment settles, which flips it to 'pending' and runs validation +
// stock + notify exactly once. Cash / card-terminal orders create as 'pending'.
export async function createOrder(tid, payload, opts = {}) {
  const code = String(Date.now()).slice(-4)
  const status = opts.hold ? 'awaiting_payment' : 'pending'
  const ref = await addDoc(sub(tid, 'orders'), {
    ...stripUndefined(payload),
    code,
    status,
    statusHistory: [{ status, at: Date.now() }],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return { id: ref.id, code }
}

export function watchActiveOrders(tid, cb) {
  const q = query(
    sub(tid, 'orders'),
    where('status', 'in', ['pending', 'accepted', 'preparing', 'ready']),
    orderBy('createdAt', 'asc'),
  )
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}

export function watchOrder(tid, id, cb) {
  return onSnapshot(subDoc(tid, 'orders', id), (d) =>
    cb(d.exists() ? { id: d.id, ...d.data() } : null),
  () => cb(null))
}

export function watchOrdersSince(tid, sinceDate, cb) {
  const q = query(sub(tid, 'orders'), where('createdAt', '>=', sinceDate), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}

// ---- Delivery driver fleet ----
const DELIVERY_TS = { assigned: 'assignedAt', picked_up: 'pickedUpAt', on_way: 'onWayAt', delivered: 'deliveredAt', failed: 'failedAt' }

// Orders assigned to one driver (single equality → no composite index; sorted client-side).
export function watchDriverDeliveries(tid, driverUid, cb) {
  if (!tid || !driverUid) { cb([]); return () => {} }
  const q = query(sub(tid, 'orders'), where('delivery.driverId', '==', driverUid))
  return onSnapshot(q, (s) => {
    const list = s.docs.map((d) => ({ id: d.id, ...d.data() }))
    list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    cb(list)
  }, () => cb([]))
}

// Unclaimed delivery orders a driver may pick up (delivery pending, no driver, not cancelled).
export function watchDeliveryPool(tid, cb) {
  if (!tid) { cb([]); return () => {} }
  const q = query(sub(tid, 'orders'), where('delivery.status', '==', 'pending'))
  return onSnapshot(q, (s) => {
    const list = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((o) => !o.delivery?.driverId && o.status !== 'cancelled')
    list.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0))
    cb(list)
  }, () => cb([]))
}

// Assign (or self-claim) a delivery to a driver; pass null to release it.
export async function assignDelivery(tid, orderId, driver) {
  return updateDoc(subDoc(tid, 'orders', orderId), {
    'delivery.driverId': driver?.uid || null,
    'delivery.driverName': driver?.name || '',
    'delivery.status': driver ? 'assigned' : 'pending',
    'delivery.assignedAt': serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

// Advance the delivery sub-status (independent of the order fulfilment status).
export async function setDeliveryStatus(tid, orderId, status) {
  const patch = { 'delivery.status': status, updatedAt: serverTimestamp() }
  if (DELIVERY_TS[status]) patch[`delivery.${DELIVERY_TS[status]}`] = serverTimestamp()
  return updateDoc(subDoc(tid, 'orders', orderId), patch)
}

// Live driver location broadcast (customer tracking). Throttled by the caller.
export async function updateDriverLocation(tid, orderId, geo) {
  if (!geo || geo.lat == null) return
  return updateDoc(subDoc(tid, 'orders', orderId), { 'delivery.driverGeo': { lat: geo.lat, lng: geo.lng, at: Date.now() } })
}

// Driver marks delivered AND records cash collected (COD custody ledger). The
// order itself is marked paid only at settlement, by a manager (full perms).
export async function collectCod(tid, orderId, amount) {
  return updateDoc(subDoc(tid, 'orders', orderId), {
    'delivery.status': 'delivered',
    'delivery.deliveredAt': serverTimestamp(),
    'delivery.codCollected': true,
    'delivery.codAmount': Number(amount) || 0,
    updatedAt: serverTimestamp(),
  })
}

// Manager settles a driver's collected cash (handed to the drawer).
export async function settleCod(tid, orderId) {
  return updateDoc(subDoc(tid, 'orders', orderId), { 'delivery.codSettled': true, updatedAt: serverTimestamp() })
}



export async function updateOrderStatus(tid, id, status, extra = {}) {
  const ref = subDoc(tid, 'orders', id)
  const { _actor, ...rest } = extra // _actor → audit only, not persisted as a field
  const result = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return null
    const orderData = snap.data()
    const hist = orderData.statusHistory || []
    tx.update(ref, {
      status,
      statusHistory: [...hist, { status, at: Date.now(), by: _actor || '' }],
      updatedAt: serverTimestamp(),
      ...rest,
    })
    return orderData
  })

  if (result && status === 'paid' && result.status !== 'paid') {
    const mergedOrder = { id, ...result, ...rest }
    await triggerPostPaymentEffects(tid, id, mergedOrder, _actor || extra.paidByName || '')
  }

  // Signage mirror: keep a PUBLIC doc of ready-order codes so paired TVs
  // (anonymous readers) can flash "order ready" — non-critical, never throws.
  try {
    if (result) {
      if (status === 'ready') {
        await setDoc(subDoc(tid, 'public', 'readyOrders'), { [id]: { code: result.code || '', at: Date.now() } }, { merge: true })
      } else if (['served', 'paid', 'cancelled', 'preparing'].includes(status)) {
        await setDoc(subDoc(tid, 'public', 'readyOrders'), { [id]: deleteField() }, { merge: true })
      }
    }
  } catch (_) { /* signage mirror is best-effort */ }
  return result
}

// signage TVs watch this public doc for ready-order codes
export function watchReadyBoard(tid, cb) {
  return onSnapshot(subDoc(tid, 'public', 'readyOrders'), (d) => cb(d.exists() ? d.data() : {}), () => cb({}))
}

// staff PIN (operational lock) — hash only, never the plaintext pin
export async function setStaffPin(tid, staffId, pinHash) {
  return updateDoc(subDoc(tid, 'staff', staffId), { pinHash })
}

// ===== Digital signage screens (top-level; doc id = the TV pairing code) =====
export function watchScreens(tid, cb) {
  const q = query(collection(db, 'screens'), where('tid', '==', tid))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export function watchScreen(code, cb) {
  return onSnapshot(doc(db, 'screens', code), (d) => cb(d.exists() ? { id: d.id, ...d.data() } : null), () => cb(null))
}
export async function createScreen(tid, name) {
  const code = randomToken(6).toUpperCase().replace(/[O0]/g, 'A')
  await setDoc(doc(db, 'screens', code), { tid, name: name || '', items: [], createdAt: serverTimestamp() })
  return code
}
export async function updateScreen(code, patch) {
  return updateDoc(doc(db, 'screens', code), { ...patch, updatedAt: serverTimestamp() })
}
export async function deleteScreen(code) { return deleteDoc(doc(db, 'screens', code)) }

// ===== Central media library (tenants/{tid}/media) =====
// Every upload is auto-registered here (from storage.js) so any asset — image,
// video, audio, file — can be reused ANYWHERE via the "from library" picker
// instead of re-uploading. Deleting a library entry only unlists it; the actual
// storage file stays (it may still be referenced by a background/menu/etc).
export async function logMedia(tid, { url, kind, name, size, contentType } = {}) {
  if (!tid || !url) return null
  try {
    return await addDoc(sub(tid, 'media'), {
      url, kind: kind || 'file', name: name || '', size: Number(size) || 0,
      contentType: contentType || '', createdAt: serverTimestamp(),
    })
  } catch (_) { return null }
}
export function watchMedia(tid, cb) {
  const q = query(sub(tid, 'media'), orderBy('createdAt', 'desc'), limit(400))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function deleteMedia(tid, id) { return deleteDoc(subDoc(tid, 'media', id)) }

// ===== Venue profile posts (news / events / visits blog on /m/{slug}/about) =====
// Staff view (PostsAdmin): all posts incl. drafts. Error handler so a rules/index
// hiccup shows an empty board instead of hanging on a spinner forever.
export function watchPosts(tid, cb) {
  const q = query(sub(tid, 'posts'), orderBy('createdAt', 'desc'), limit(60))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
// PUBLIC diner view: MUST filter published==true — the posts rule denies an
// unfiltered list to anonymous readers (Firestore rejects the whole query, not
// per-doc), which left the "قصتنا" page spinning forever. Single equality filter
// needs no composite index; caller sorts by createdAt client-side.
export function watchPublishedPosts(tid, cb) {
  const q = query(sub(tid, 'posts'), where('published', '==', true), limit(60))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function addPost(tid, data) {
  return addDoc(sub(tid, 'posts'), {
    type: 'news', title: '', body: '', media: [], pinned: false, published: true,
    likes: 0, views: 0, ...data, createdAt: serverTimestamp(),
  })
}
export async function updatePost(tid, id, patch) {
  return updateDoc(subDoc(tid, 'posts', id), { ...patch, updatedAt: serverTimestamp() })
}
export async function deletePost(tid, id) { return deleteDoc(subDoc(tid, 'posts', id)) }
// public single-field +1 bumps (rules restrict to exactly likes+1 / views+1)
export async function bumpPost(tid, id, field) {
  return updateDoc(subDoc(tid, 'posts', id), { [field]: increment(1) })
}

// ===== Stories (Instagram-style, on the diner menu) =====
// expiresAt is a plain ms number → active filtering happens client-side
// (no composite index needed). Highlights (pinned) never expire.
export function watchStories(tid, cb) {
  const q = query(sub(tid, 'stories'), orderBy('createdAt', 'desc'), limit(40))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export const activeStories = (list) => (list || []).filter((s) => s.active !== false && (s.highlight || (s.expiresAt || 0) > Date.now()))
export async function addStory(tid, data) {
  return addDoc(sub(tid, 'stories'), {
    kind: 'image', caption: '', link: '', highlight: '', ...data,
    active: true, likes: 0, views: 0,
    expiresAt: Date.now() + 24 * 3600 * 1000,
    createdAt: serverTimestamp(),
  })
}
export async function deleteStory(tid, id) { return deleteDoc(subDoc(tid, 'stories', id)) }
export async function updateStory(tid, id, patch) { return updateDoc(subDoc(tid, 'stories', id), patch) }
// replies: diners write (rules-bounded), staff read/manage
export async function addStoryReply(tid, storyId, data) {
  return addDoc(collection(subDoc(tid, 'stories', storyId), 'replies'), { text: '', deviceId: '', ...data, at: serverTimestamp() })
}
export function watchStoryReplies(tid, storyId, cb) {
  const q = query(collection(subDoc(tid, 'stories', storyId), 'replies'), orderBy('at', 'desc'), limit(80))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function deleteStoryReply(tid, storyId, rid) {
  return deleteDoc(doc(collection(subDoc(tid, 'stories', storyId), 'replies'), rid))
}
// public single-field +1 bumps (rules restrict to exactly likes+1 / views+1)
export async function bumpStory(tid, id, field) {
  return updateDoc(subDoc(tid, 'stories', id), { [field]: increment(1) })
}

// KDS expo: per-line bump — mark a single order line done/undone (map keyed by line index).
export async function setOrderLineDone(tid, orderId, lineIdx, done) {
  return updateDoc(subDoc(tid, 'orders', orderId), { [`doneLines.${lineIdx}`]: !!done, updatedAt: serverTimestamp() })
}

// Helper to trigger CRM, loyalty, and inventory consumption on order payment settled.
// Uses a sideEffectsTriggered flag to ensure idempotency.
async function triggerPostPaymentEffects(tid, id, order, actor) {
  const ref = subDoc(tid, 'orders', id)
  let run = false
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    const d = snap.data()
    if (!d.sideEffectsTriggered) {
      tx.update(ref, { sideEffectsTriggered: true })
      run = true
    }
  })
  if (!run) return

  const tenant = await getTenant(tid).catch(() => null)
  const policy = resolveMembershipPolicy(tenant)

  if (order.customerPhone) {
    const redeemReward = order.loyaltyRedeemed || order.loyaltyDiscount > 0
    const threshold = tenant?.loyaltyThreshold || 5
    const loyaltyEnabled = tenant?.loyaltyEnabled !== false
    const drinkUnits = order.drinkUnits || 0

    await upsertCustomerOnOrder(tid, {
      name: order.customerName,
      phone: order.customerPhone,
      total: order.total,
      drinks: drinkUnits,
      threshold,
      loyaltyEnabled,
      redeemReward,
      ip: order.ip || ''
    }).catch(console.error)

    await processMembershipOnPaid(tid, order.customerPhone, order, policy).catch(console.error)
  }

  await consumeForOrder(tid, id, { actor: actor || order.paidByName || '' }).catch(console.error)
}

// Mark an order paid — records method, tip & actor (optionally serving it in one tap).
// breakdown = { cash, card, transfer } for a mixed payment.
export async function payOrder(tid, id, { method = 'cash', tip = 0, actor = '', markServed = false, breakdown = null } = {}) {
  const extra = { paymentMethod: method, tip: Number(tip) || 0, paidByName: actor, paidAtMs: Date.now(), _actor: actor }
  if (markServed) extra.servedByName = actor
  if (breakdown) extra.paymentBreakdown = breakdown
  return updateOrderStatus(tid, id, 'paid', extra)
}

// Record a partial payment; auto-marks the order paid once the running total covers it.
// Returns { completed } so the caller can award loyalty points only on final settlement.
export async function payPartial(tid, id, { amount = 0, method = 'cash', actor = '' } = {}) {
  const ref = subDoc(tid, 'orders', id)
  const res = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return { completed: false }
    const d = snap.data()
    const paid = (d.amountPaid || 0) + (Number(amount) || 0)
    const fields = { amountPaid: paid, lastPaymentMethod: method, updatedAt: serverTimestamp() }
    const completed = paid >= (d.total || 0)
    if (completed) {
      const hist = d.statusHistory || []
      fields.status = 'paid'
      fields.paymentMethod = method
      fields.paidByName = actor
      fields.paidAtMs = Date.now()
      fields.statusHistory = [...hist, { status: 'paid', at: Date.now(), by: actor }]
    }
    tx.update(ref, fields)
    return { completed, order: d }
  })

  if (res.completed && res.order) {
    const mergedOrder = { ...res.order, status: 'paid', paymentMethod: method, paidByName: actor, paidAtMs: Date.now() }
    await triggerPostPaymentEffects(tid, id, mergedOrder, actor)
  }
  return { completed: res.completed }
}

export async function getOrder(tid, id) {
  const s = await getDoc(subDoc(tid, 'orders', id))
  return s.exists() ? { id: s.id, ...s.data() } : null
}

// Undo the CRM/loyalty effects of an order (on cancel or full refund): decrement stats and
// the membership points it earned (recomputed from the order total × earn rate).
async function reverseOrderEffects(tid, order, policy) {
  const phone = order?.customerPhone
  if (!phone) return
  const ref = subDoc(tid, 'customers', phoneId(phone))
  const earned = policy?.enabled ? Math.round((order.total || 0) * (policy.earnRate || 1)) : 0
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    const d = snap.data()

    // Calculate new loyalty progress (reversing the stamps they earned)
    let rewards = d.rewards || 0
    let progress = d.loyaltyDrinks || 0

    // 1. If they redeemed a reward in this order, return it
    if (order.loyaltyRedeemed || order.loyaltyDiscount > 0) {
      rewards += 1
    }

    // 2. Deduct the drinks they earned stamps for in this order
    const drinks = order.drinkUnits || 0
    if (drinks > 0) {
      progress -= drinks
      if (progress < 0) {
        const shortfall = Math.abs(progress)
        const threshold = policy?.loyaltyThreshold || 5
        const deductRewards = Math.ceil(shortfall / threshold)
        rewards = Math.max(0, rewards - deductRewards)
        progress = (threshold - (shortfall % threshold)) % threshold
      }
    }

    const upd = {
      totalOrders: Math.max(0, (d.totalOrders || 0) - 1),
      totalSpent: Math.max(0, (d.totalSpent || 0) - (order.total || 0)),
      totalDrinks: Math.max(0, (d.totalDrinks || 0) - (order.drinkUnits || 0)),
      loyaltyDrinks: progress,
      rewards,
    }
    const m = d.membership
    if (m?.active && earned > 0) {
      const lifetime = Math.max(0, (m.pointsLifetime || 0) - earned)
      const points = Math.max(0, (m.points || 0) - earned)
      const { tier, discountPct } = policy ? tierForPoints(policy, lifetime, upd.totalOrders) : { tier: m.tier, discountPct: m.discountPct }
      upd.membership = { ...m, points, pointsLifetime: lifetime, tier, discountPct }
      if (m.token) tx.set(subDoc(tid, 'memberCards', m.token), { points, pointsLifetime: lifetime, tier, discountPct, updatedAt: Date.now() }, { merge: true })
    }
    tx.set(ref, upd, { merge: true })
  })
}

// Cancel with a mandatory reason; bumps cancel/no-show counters AND reverses the order's CRM/loyalty effects.
export async function cancelOrderWithReason(tid, id, { reason = '', actor = '', noShow = false, policy = null } = {}) {
  const order = await getOrder(tid, id)
  await updateOrderStatus(tid, id, 'cancelled', { cancelReason: reason, cancelledByName: actor, _actor: actor })
  await restoreOrderStock(tid, order, id) // give materials + finished goods back
  const phone = order?.customerPhone
  if (phone) {
    const patch = { cancelCount: increment(1) }
    if (noShow) patch.noShowCount = increment(1)
    try { await setDoc(subDoc(tid, 'customers', phoneId(phone)), patch, { merge: true }) } catch (_) { /* ignore */ }
    if (!order.reversed) {
      await reverseOrderEffects(tid, order, policy).catch(() => {})
      await updateDoc(subDoc(tid, 'orders', id), { reversed: true }).catch(() => {})
    }
  }
}

// Record a refund (full or partial). A FULL refund also reverses the order's CRM/loyalty effects.
export async function refundOrder(tid, id, { amount = 0, reason = '', actor = '', policy = null } = {}) {
  const order = await getOrder(tid, id)
  const amt = Number(amount) || 0
  await updateOrderStatus(tid, id, 'refunded', { refund: { amount: amt, reason, by: actor, at: Date.now() }, _actor: actor })
  if (order && !order.reversed && amt >= (order.total || 0)) {
    await reverseOrderEffects(tid, order, policy).catch(() => {})
    await restoreOrderStock(tid, order, id) // full refund returns stock
    await updateDoc(subDoc(tid, 'orders', id), { reversed: true }).catch(() => {})
  }
}

// Move an active order to a different table (or convert to takeaway).
export async function setOrderTable(tid, id, { tableId = null, tableLabel = '', orderType } = {}) {
  const patch = { tableId: tableId || null, tableLabel: tableLabel || '', updatedAt: serverTimestamp() }
  if (orderType) patch.orderType = orderType
  return updateDoc(subDoc(tid, 'orders', id), patch)
}

// A member's standing discount is a % of the basket, so it must re-scale when the
// lines change; fall back to the stored amount if the original subtotal is unknown.
function scaledMemberDiscount(prev, newSubtotal) {
  const pct = (prev.subtotal || 0) > 0 ? (prev.memberDiscount || 0) / prev.subtotal : 0
  return pct > 0 ? Math.round(newSubtotal * pct) : (prev.memberDiscount || 0)
}

// Append items to an active order and recompute totals (running tab / forgotten item).
export async function addOrderItems(tid, id, newItems, { actor = '' } = {}) {
  const ref = subDoc(tid, 'orders', id)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    const d = snap.data()
    const items = [...(d.items || []), ...(newItems || [])]
    const subtotal = items.reduce((s, l) => s + (l.lineTotal || (l.unitPrice || 0) * (l.qty || 1)), 0)
    const memberDiscount = scaledMemberDiscount(d, subtotal)
    const total = Math.max(0, subtotal - (d.discount || 0) - (d.loyaltyDiscount || 0) - memberDiscount)
    const hist = d.statusHistory || []
    tx.update(ref, { items, subtotal, total, memberDiscount, statusHistory: [...hist, { status: d.status, at: Date.now(), by: actor, edit: 'add-items' }], updatedAt: serverTimestamp() })
  })
  decrementStock(tid, newItems).catch(() => {}) // reserve finished-good stock for the added lines
}

// Change the quantity of a line item in an active order and recompute totals.
export async function setOrderItemQty(tid, id, index, qty, { actor = '' } = {}) {
  const ref = subDoc(tid, 'orders', id)
  const q = Math.max(1, Number(qty) || 1)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    const d = snap.data()
    const items = (d.items || []).map((l, i) => (i === index ? { ...l, qty: q, lineTotal: (l.unitPrice || 0) * q } : l))
    const subtotal = items.reduce((s, l) => s + (l.lineTotal || (l.unitPrice || 0) * (l.qty || 1)), 0)
    const memberDiscount = scaledMemberDiscount(d, subtotal)
    const total = Math.max(0, subtotal - (d.discount || 0) - (d.loyaltyDiscount || 0) - memberDiscount)
    const hist = d.statusHistory || []
    tx.update(ref, { items, subtotal, total, memberDiscount, statusHistory: [...hist, { status: d.status, at: Date.now(), by: actor, edit: 'qty' }], updatedAt: serverTimestamp() })
  })
}

// Remove a line item from an active order and recompute subtotal/total (kitchen mistake / customer change).
export async function voidOrderItem(tid, id, index, { actor = '' } = {}) {
  const ref = subDoc(tid, 'orders', id)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    const d = snap.data()
    const items = (d.items || []).filter((_, i) => i !== index)
    const subtotal = items.reduce((s, l) => s + (l.lineTotal || (l.unitPrice || 0) * (l.qty || 1)), 0)
    const memberDiscount = scaledMemberDiscount(d, subtotal)
    const total = Math.max(0, subtotal - (d.discount || 0) - (d.loyaltyDiscount || 0) - memberDiscount)
    const hist = d.statusHistory || []
    tx.update(ref, { items, subtotal, total, memberDiscount, statusHistory: [...hist, { status: d.status, at: Date.now(), by: actor, edit: 'void-item' }], updatedAt: serverTimestamp() })
  })
}

// Manager comp/discount applied to an active order (reduces the total).
export async function compOrder(tid, id, { amount = 0, reason = '', actor = '' } = {}) {
  const ref = subDoc(tid, 'orders', id)
  const amt = Number(amount) || 0
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    const d = snap.data()
    tx.update(ref, {
      compDiscount: (d.compDiscount || 0) + amt,
      compReason: reason,
      compByName: actor,
      total: Math.max(0, (d.total || 0) - amt),
      updatedAt: serverTimestamp(),
    })
  })
}

// ---------- cashier sessions (cash drawer) ----------
export async function openCashierSession(tid, { openingFloat = 0, actor = '', uid = '' } = {}) {
  return addDoc(sub(tid, 'cashierSessions'), {
    status: 'open', openingFloat: Number(openingFloat) || 0,
    openedByName: actor, openedByUid: uid || '', openedAt: serverTimestamp(), openedAtMs: Date.now(),
  })
}
// One open session PER cashier (by uid); falls back to any-open when no uid (single cashier).
export function watchOpenCashierSession(tid, uid, cb) {
  const qy = uid
    ? query(sub(tid, 'cashierSessions'), where('openedByUid', '==', uid), limit(5))
    : query(sub(tid, 'cashierSessions'), where('status', '==', 'open'), limit(1))
  return onSnapshot(qy, (s) => {
    const open = s.docs.map((d) => ({ id: d.id, ...d.data() })).find((x) => x.status === 'open')
    cb(open || null)
  }, () => cb(null))
}
export async function closeCashierSession(tid, id, data = {}) {
  return updateDoc(subDoc(tid, 'cashierSessions', id), { status: 'closed', closedAt: serverTimestamp(), closedAtMs: Date.now(), ...data })
}

// ---------- waiter calls ----------
export async function callWaiter(tid, { tableId, tableLabel, reason }) {
  return addDoc(sub(tid, 'waiterCalls'), {
    tableId: tableId || null,
    tableLabel: tableLabel || '',
    reason: reason || 'call',
    status: 'open',
    createdAt: serverTimestamp(),
  })
}
export function watchOpenWaiterCalls(tid, cb) {
  const q = query(sub(tid, 'waiterCalls'), where('status', '==', 'open'), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
// Curbside: the diner signals they've arrived (reuses the waiterCalls channel — no order write needed).
export async function notifyArrival(tid, { orderId, code, car, tableLabel }) {
  return addDoc(sub(tid, 'waiterCalls'), {
    reason: 'arrived',
    status: 'open',
    orderId: orderId || null,
    orderCode: code || '',
    car: car || null,
    tableLabel: tableLabel || '',
    createdAt: serverTimestamp(),
  })
}
export async function resolveWaiterCall(tid, id) {
  return updateDoc(subDoc(tid, 'waiterCalls', id), { status: 'done', resolvedAt: serverTimestamp() })
}

// ---------- customers (CRM) + loyalty ----------
const phoneId = (phone) => normalizePhone(phone) || phone.replace(/[^0-9]/g, '') || phone

export async function getCustomerByPhone(tid, phone) {
  if (!phone) return null
  const snap = await getDoc(subDoc(tid, 'customers', phoneId(phone)))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

// Merge a duplicate customer INTO a primary one (same person, two numbers):
// counters sum, the primary keeps its name/membership (falls back to the
// duplicate's membership if the primary has none), then the duplicate is deleted.
export async function mergeCustomers(tid, primaryPhone, dupPhone) {
  const pRef = subDoc(tid, 'customers', phoneId(primaryPhone))
  const dRef = subDoc(tid, 'customers', phoneId(dupPhone))
  if (pRef.path === dRef.path) throw new Error('same customer')
  return runTransaction(db, async (tx) => {
    const [pSnap, dSnap] = await Promise.all([tx.get(pRef), tx.get(dRef)])
    if (!pSnap.exists() || !dSnap.exists()) throw new Error('customer not found')
    const p = pSnap.data()
    const d = dSnap.data()
    const merged = {
      name: p.name || d.name || '',
      totalOrders: (p.totalOrders || 0) + (d.totalOrders || 0),
      totalSpent: (p.totalSpent || 0) + (d.totalSpent || 0),
      totalDrinks: (p.totalDrinks || 0) + (d.totalDrinks || 0),
      loyaltyDrinks: (p.loyaltyDrinks || 0) + (d.loyaltyDrinks || 0),
      rewards: (p.rewards || 0) + (d.rewards || 0),
      cancelCount: (p.cancelCount || 0) + (d.cancelCount || 0),
      noShowCount: (p.noShowCount || 0) + (d.noShowCount || 0),
      birthday: p.birthday || d.birthday || '',
      mergedFrom: phoneId(dupPhone),
      updatedAt: serverTimestamp(),
    }
    if (!p.membership?.active && d.membership?.active) merged.membership = d.membership
    tx.set(pRef, merged, { merge: true })
    tx.delete(dRef)
  })
}

// Staff patch of one customer's plain fields (opt-out, notes…) by phone.
export async function updateCustomer(tid, phone, patch) {
  if (!phone) return
  return setDoc(subDoc(tid, 'customers', phoneId(phone)), { ...patch, updatedAt: serverTimestamp() }, { merge: true })
}

// Self-registration from the menu ("join the family"): creates/merges the
// customer record so the venue's CRM + campaigns + follow-ups know this guest.
// Writes only unprotected fields (rules allow anonymous diners to do this).
export async function registerCustomer(tid, { name = '', phone = '' } = {}) {
  const p = String(phone || '').trim()
  if (!p) return null
  const ref = subDoc(tid, 'customers', phoneId(p))
  await setDoc(ref, {
    ...(name.trim() ? { name: name.trim() } : {}),
    phone: p,
    source: 'menu-register',
    registeredAt: Date.now(),
    updatedAt: serverTimestamp(),
  }, { merge: true })
  return { id: phoneId(p) }
}

// Upsert a customer keyed by phone, accumulating stats + loyalty progress.
// Returns { id, rewards, loyaltyDrinks, earned } after the update.
export async function upsertCustomerOnOrder(
  tid,
  { name, phone, total, drinks = 0, threshold = 5, loyaltyEnabled = true, redeemReward = false, ip = '' },
) {
  if (!phone) return null
  const id = phoneId(phone)
  const ref = subDoc(tid, 'customers', id)
  let result = { id, rewards: 0, loyaltyDrinks: 0, earned: 0 }
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const d = snap.exists() ? snap.data() : {}
    let rewards = d.rewards || 0
    if (redeemReward && rewards > 0) rewards -= 1
    let progress = (d.loyaltyDrinks || 0) + (drinks || 0)
    let earned = 0
    if (loyaltyEnabled && threshold > 0) {
      earned = Math.floor(progress / threshold)
      progress = progress % threshold
      rewards += earned
    }
    const base = {
      name: name || d.name || '',
      phone,
      totalOrders: (d.totalOrders || 0) + 1,
      totalSpent: (d.totalSpent || 0) + (total || 0),
      totalDrinks: (d.totalDrinks || 0) + (drinks || 0),
      loyaltyDrinks: progress,
      rewards,
      lastIp: ip || d.lastIp || '',
      lastOrderAt: serverTimestamp(),
    }
    if (!snap.exists()) base.firstOrderAt = serverTimestamp()
    tx.set(ref, base, { merge: true })
    result = { id, rewards, loyaltyDrinks: progress, earned }
  })
  return result
}
export function watchCustomers(tid, cb) {
  const q = query(sub(tid, 'customers'), orderBy('lastOrderAt', 'desc'), limit(200))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
// Staff-set flag / rating on a customer (keyed by phone). Merges onto the customer doc.
export async function setCustomerFlag(tid, phone, data) {
  if (!phone) return
  return setDoc(subDoc(tid, 'customers', phoneId(phone)), { ...data, flagUpdatedAt: serverTimestamp() }, { merge: true })
}

// ---------- VIP membership (layered over the punch-card; separate `points` currency) ----------

// Public-readable display mirror written to memberCards/{token} (lets the diner open
// their card by URL without staff-only customer read). Holds no sensitive data.
function memberCardFields(d, m) {
  return {
    phone: d.phone || '', name: d.name || '',
    tier: m.tier, memberId: m.memberId, discountPct: m.discountPct || 0,
    points: m.points || 0, pointsLifetime: m.pointsLifetime || 0,
    totalOrders: d.totalOrders || 0, totalSpent: d.totalSpent || 0,
    active: m.active !== false, updatedAt: Date.now(),
  }
}

// Public phone→card lookup mirror: lets a returning member be recognized by phone at
// checkout (diners can't read the customers collection). Holds no sensitive data.
function memberPhoneFields(m) {
  return { token: m.token, active: m.active !== false, discountPct: m.discountPct || 0, tier: m.tier || '', updatedAt: Date.now() }
}

// Auto-grant on eligibility + earn points once per paid order. Call AFTER an order is settled.
export async function processMembershipOnPaid(tid, phone, order, policy) {
  if (!phone || !policy?.enabled || !order) return null
  const ref = subDoc(tid, 'customers', phoneId(phone))
  let earnedOut = 0
  let bdayOut = 0
  let memberOut = null
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const d = snap.exists() ? snap.data() : {}
    let m = d.membership || null
    if (!m?.active && isEligible(policy, d)) m = newMembership(policy, 'auto', randomToken())
    if (!m?.active) { memberOut = null; return }
    // lazy expiry of the redeemable balance after N idle days (status/tier preserved)
    if (policy.pointsExpiryDays > 0 && m.lastEarnAt && (Date.now() - m.lastEarnAt) > policy.pointsExpiryDays * 86400000) m = { ...m, points: 0 }
    earnedOut = 0
    if (m.lastEarnOrderId !== order.id) {
      const earned = Math.round((order.total || 0) * (policy.earnRate || 1) * (policy.pointsMultiplier || 1))
      earnedOut = earned
      const lifetime = (m.pointsLifetime || 0) + earned
      const points = (m.points || 0) + earned
      const { tier, discountPct } = tierForPoints(policy, lifetime, d.totalOrders || 0)
      m = { ...m, points, pointsLifetime: lifetime, tier, discountPct, lastEarnOrderId: order.id, lastEarnAt: Date.now() }
    }
    const custPatch = { membership: m }
    // birthday bonus (once per year, on the member's birthday MM-DD)
    const bonus = Number(policy.birthdayBonus) || 0
    if (bonus > 0 && d.birthday) {
      const now = new Date()
      const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      if (d.birthday === md && d.lastBdayYear !== now.getFullYear()) {
        const lifetime = (m.pointsLifetime || 0) + bonus
        const points = (m.points || 0) + bonus
        const { tier, discountPct } = tierForPoints(policy, lifetime, d.totalOrders || 0)
        m = { ...m, points, pointsLifetime: lifetime, tier, discountPct }
        custPatch.membership = m
        custPatch.lastBdayYear = now.getFullYear()
        bdayOut = bonus
      }
    }
    tx.set(ref, custPatch, { merge: true })
    tx.set(subDoc(tid, 'memberCards', m.token), memberCardFields({ ...d, phone }, m), { merge: true })
    tx.set(subDoc(tid, 'memberPhones', phoneId(phone)), memberPhoneFields(m), { merge: true })
    memberOut = m
  })
  if (earnedOut > 0 && memberOut) logLoyalty(tid, { phone, memberId: memberOut.memberId, type: 'earn', points: earnedOut, orderId: order.id }).catch(() => {})
  if (bdayOut > 0 && memberOut) logLoyalty(tid, { phone, memberId: memberOut.memberId, type: 'earn', points: bdayOut, byName: 'birthday' }).catch(() => {})
  return memberOut
}

// Loyalty points ledger (statement of earn/redeem).
export function logLoyalty(tid, { phone, memberId = '', type, points, orderId = '', byName = '' }) {
  return addDoc(sub(tid, 'loyaltyLog'), { phoneId: phoneId(phone), memberId, type, points: Number(points) || 0, orderId, byName, at: Date.now(), createdAt: serverTimestamp() })
}
export function watchLoyaltyLog(tid, phone, cb, max = 50) {
  const pid = phoneId(phone)
  return onSnapshot(query(sub(tid, 'loyaltyLog'), where('phoneId', '==', pid), limit(max)), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.at || 0) - (a.at || 0))), () => cb([]))
}

// Manually grant a membership to a customer (staff action).
export async function grantMembership(tid, phone, { source = 'manual', policy } = {}) {
  if (!phone) return null
  const pol = policy || DEFAULT_MEMBERSHIP_POLICY
  const ref = subDoc(tid, 'customers', phoneId(phone))
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const d = snap.exists() ? snap.data() : {}
    if (d.membership?.active) return d.membership
    const m = newMembership(pol, source, randomToken())
    tx.set(ref, { membership: m, phone }, { merge: true })
    tx.set(subDoc(tid, 'memberCards', m.token), memberCardFields({ ...d, phone }, m), { merge: true })
    tx.set(subDoc(tid, 'memberPhones', phoneId(phone)), memberPhoneFields(m), { merge: true })
    return m
  })
}

// Revoke / restore a membership (syncs the public card).
export async function setMembershipActive(tid, phone, active) {
  if (!phone) return
  const ref = subDoc(tid, 'customers', phoneId(phone))
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    const m = snap.data().membership
    if (!m?.token) return
    tx.update(ref, { 'membership.active': !!active })
    tx.set(subDoc(tid, 'memberCards', m.token), { active: !!active, updatedAt: Date.now() }, { merge: true })
    tx.set(subDoc(tid, 'memberPhones', phoneId(phone)), { active: !!active, updatedAt: Date.now() }, { merge: true })
  })
}

// Manually ADD bonus points (compensation / promotions — staff action).
// Counts toward tier progression like the birthday bonus; syncs both public
// mirrors and writes an 'earn' ledger entry naming the actor.
export async function addBonusPoints(tid, phone, { points = 0, actor = '', policy = null } = {}) {
  if (!phone || points <= 0) return null
  const ref = subDoc(tid, 'customers', phoneId(phone))
  let memberId = ''
  const res = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return null
    const d = snap.data()
    const m = d.membership
    if (!m?.active) return null
    memberId = m.memberId || ''
    const lifetime = (m.pointsLifetime || 0) + points
    let tier = m.tier
    let discountPct = m.discountPct || 0
    if (policy) ({ tier, discountPct } = tierForPoints(policy, lifetime, d.totalOrders || 0))
    const upd = { ...m, points: (m.points || 0) + points, pointsLifetime: lifetime, tier, discountPct }
    tx.set(ref, { membership: upd }, { merge: true })
    if (m.token) {
      tx.set(subDoc(tid, 'memberCards', m.token), memberCardFields(d, upd), { merge: true })
      tx.set(subDoc(tid, 'memberPhones', phoneId(phone)), memberPhoneFields(upd), { merge: true })
    }
    return upd
  })
  if (res) logLoyalty(tid, { phone, memberId, type: 'earn', points, byName: actor || 'bonus' }).catch(() => {})
  return res
}

// Redeem points (staff/app). Subtracts from balance, never below zero.
export async function redeemPoints(tid, phone, { points = 0, actor = '' } = {}) {
  if (!phone || points <= 0) return null
  const ref = subDoc(tid, 'customers', phoneId(phone))
  let memberId = ''
  const res = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return null
    const d = snap.data()
    const m = d.membership
    if (!m?.active || (m.points || 0) < points) return null
    memberId = m.memberId || ''
    const upd = { ...m, points: (m.points || 0) - points, pointsRedeemed: (m.pointsRedeemed || 0) + points, lastRedeemAt: Date.now(), lastRedeemBy: actor }
    tx.set(ref, { membership: upd }, { merge: true })
    tx.set(subDoc(tid, 'memberCards', m.token), memberCardFields(d, upd), { merge: true })
    return upd
  })
  if (res) logLoyalty(tid, { phone, memberId, type: 'redeem', points, byName: actor }).catch(() => {})
  return res
}

// One-shot SELF-HEAL: rebuild the public member mirrors (memberCards +
// memberPhones) for members created BEFORE the mirrors existed — their
// printed /mcard QR links showed «بطاقة غير صالحة» until the next paid order.
// Staff context only (customers collection is staff-readable); returns count.
export async function healMemberMirrors(tid) {
  const s = await getDocs(query(sub(tid, 'customers'), where('membership.active', '==', true)))
  let fixed = 0
  for (const c of s.docs) {
    const d = c.data()
    const m = d.membership
    if (!m?.token) continue
    const cardRef = subDoc(tid, 'memberCards', m.token)
    const card = await getDoc(cardRef)
    if (!card.exists()) {
      await setDoc(cardRef, memberCardFields({ ...d, phone: d.phone || c.id }, m), { merge: true })
      await setDoc(subDoc(tid, 'memberPhones', c.id), memberPhoneFields(m), { merge: true })
      fixed++
    }
  }
  return fixed
}

// Look up a member by their card token (public-safe — reads the display mirror).
export async function getMemberByToken(tid, token) {
  if (!token) return null
  const snap = await getDoc(subDoc(tid, 'memberCards', token))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

// Recognize a returning member by phone (public-safe — reads the phone→card mirror).
// Diners can't read the customers collection, so this is how the menu applies the
// member discount for someone who never opened their card link on this device.
export async function getMemberByPhone(tid, phone) {
  if (!phone) return null
  const snap = await getDoc(subDoc(tid, 'memberPhones', phoneId(phone)))
  if (!snap.exists()) return null
  const d = snap.data()
  if (d.active === false || !d.token) return null
  return { token: d.token, active: true, discountPct: d.discountPct || 0, tier: d.tier || '' }
}

// ---------- staff invites (no-backend invite flow) ----------
const inviteKey = (email) => email.trim().toLowerCase()
export const inviteRef = (email) => doc(db, 'staffInvites', inviteKey(email))

export async function getInvite(email) {
  const s = await getDoc(inviteRef(email))
  return s.exists() ? { email: inviteKey(email), ...s.data() } : null
}
export async function createInvite(email, { tenantId, role, venueName, invitedBy, name }) {
  return setDoc(inviteRef(email), { tenantId, role: role || 'waiter', name: name || '', venueName: venueName || '', invitedBy: invitedBy || '', createdAt: serverTimestamp() })
}
export async function deleteInvite(email) {
  return deleteDoc(inviteRef(email))
}
export function watchInvites(tid, cb) {
  const q = query(collection(db, 'staffInvites'), where('tenantId', '==', tid))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ email: d.id, ...d.data() }))), () => cb([]))
}

// ---------- staff directory (per-tenant; strictly isolated by tenant) ----------
// Each staffer self-registers their own membership doc under THEIR tenant on login.
// Rules ensure a member can only write their own doc within their own tenant.
export async function upsertStaffMember(tid, uid, data) {
  return setDoc(subDoc(tid, 'staff', uid), { ...data, lastSeenAt: serverTimestamp() }, { merge: true })
}
// One staffer's directory doc (used by auth to read per-staffer capability overrides).
export async function getStaffMember(tid, uid) {
  const snap = await getDoc(subDoc(tid, 'staff', uid))
  return snap.exists() ? { uid: snap.id, ...snap.data() } : null
}
// Manager writes a staffer's RESOLVED capability array. `custom` marks it as a
// per-person override (kept as-is) vs a role-default mirror (refreshed by healing).
export async function setStaffCaps(tid, uid, caps, custom = true) {
  return updateDoc(subDoc(tid, 'staff', uid), { caps, capsCustom: !!custom, updatedAt: serverTimestamp() })
}

// ---------- orphan-venue recovery ----------
// If a venue exists with ownerUid == uid but the users doc lost its tenantId link
// (historic partial creations / rules races), find and re-link it instead of
// letting the owner re-create a duplicate venue from onboarding.
export async function findTenantByOwner(uid) {
  const s = await getDocs(query(collection(db, 'tenants'), where('ownerUid', '==', uid), limit(1)))
  return s.empty ? null : { id: s.docs[0].id, ...s.docs[0].data() }
}
export async function linkOwnerTenant(uid, tid) {
  return setDoc(userRef(uid), { tenantId: tid, role: 'owner' }, { merge: true })
}

// ---------- AI usage metering ----------
// Counter doc lives in aiMemory/_usage (staff-writable + venue-scoped by rules),
// so every assistant user can bump it. Limits live on the tenant (platform-set:
// tenant.aiLimits {daily, monthly}) + purchased extras (tenant.aiExtra).
export async function getAiUsage(tid) {
  const s = await getDoc(subDoc(tid, 'aiMemory', '_usage'))
  return s.exists() ? s.data() : {}
}
export async function bumpAiUsage(tid) {
  const d = new Date().toLocaleDateString('en-CA')
  const m = d.slice(0, 7)
  const cur = await getAiUsage(tid).catch(() => ({}))
  const patch = {
    d,
    m,
    dc: (cur.d === d ? Number(cur.dc) || 0 : 0) + 1,
    mc: (cur.m === m ? Number(cur.mc) || 0 : 0) + 1,
    updatedAt: serverTimestamp(),
  }
  await setDoc(subDoc(tid, 'aiMemory', '_usage'), patch, { merge: true })
  return patch
}

// ---------- venue secrets (tenants/{tid}/private/*) ----------
// Rules: manage_integrations only. Holds the venue's OWN WhatsApp Cloud API
// credentials etc. — never on the public tenant doc.
export async function getPrivateDoc(tid, id) {
  const snap = await getDoc(subDoc(tid, 'private', id))
  return snap.exists() ? snap.data() : null
}
export async function setPrivateDoc(tid, id, data) {
  return setDoc(subDoc(tid, 'private', id), { ...data, updatedAt: serverTimestamp() }, { merge: true })
}

// Firestore rules read granular caps ONLY from staff/{uid}.caps (they can't compute
// role defaults). This keeps every non-manager staffer's mirror fresh: role-default
// mirrors are recomputed from the (tenant-customized) role caps; manager-tailored
// overrides (capsCustom) are left untouched. Managers run it on admin load and after
// saving the Roles screen — writes only when stale, so it's cheap.
export async function healStaffCapsMirrors(tid, roleCapsOverride) {
  const s = await getDocs(sub(tid, 'staff'))
  let fixed = 0
  for (const m of s.docs) {
    const d = m.data()
    if (d.role === 'owner' || d.role === 'manager') continue
    if (d.capsCustom && Array.isArray(d.caps)) continue
    const want = roleDefaultCaps(d.role || 'staff', roleCapsOverride)
    const have = Array.isArray(d.caps) ? d.caps : null
    const same = have && have.length === want.length && want.every((c) => have.includes(c))
    if (same) continue
    await updateDoc(m.ref, { caps: want, capsCustom: false, updatedAt: serverTimestamp() }).catch(() => {})
    fixed += 1
  }
  return fixed
}
export function watchStaff(tid, cb) {
  return onSnapshot(sub(tid, 'staff'), (s) => cb(s.docs.map((d) => ({ uid: d.id, ...d.data() }))), () => cb([]))
}
// One-shot staff list (for the AI assistant / reports).
export async function listStaff(tid) {
  const s = await getDocs(sub(tid, 'staff'))
  return s.docs.map((d) => ({ uid: d.id, ...d.data() }))
}
export async function setStaffActive(tid, uid, active) {
  return updateDoc(subDoc(tid, 'staff', uid), { active, updatedAt: serverTimestamp() })
}
// Manager-set HR fields on a staff member (salary, hire date, deductions...).
export async function setStaffMeta(tid, uid, data) {
  return updateDoc(subDoc(tid, 'staff', uid), { ...data, updatedAt: serverTimestamp() })
}

// ---------- attendance (selfie clock-in/out + time + location) ----------
export async function recordAttendance(tid, payload) {
  return addDoc(sub(tid, 'attendance'), { ...payload, at: serverTimestamp() })
}
export function watchAttendance(tid, cb, max = 200) {
  const q = query(sub(tid, 'attendance'), orderBy('at', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
// One staffer's recent punches (no composite index needed — sorted client-side).
export function watchMyAttendance(tid, uid, cb, max = 40) {
  const q = query(sub(tid, 'attendance'), where('staffUid', '==', uid), limit(max))
  return onSnapshot(q, (s) => {
    const list = s.docs.map((d) => ({ id: d.id, ...d.data() }))
    list.sort((a, b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0))
    cb(list)
  }, () => cb([]))
}

// ---------- leave requests (staff portal) ----------
export async function createLeaveRequest(tid, { staffUid, staffName, type, from, to, reason }) {
  return addDoc(sub(tid, 'leaves'), {
    staffUid, staffName: staffName || '', type: type || 'leave',
    from: from || '', to: to || '', reason: reason || '',
    status: 'pending', createdAt: serverTimestamp(),
  })
}
export function watchMyLeaves(tid, uid, cb, max = 30) {
  const q = query(sub(tid, 'leaves'), where('staffUid', '==', uid), limit(max))
  return onSnapshot(q, (s) => {
    const list = s.docs.map((d) => ({ id: d.id, ...d.data() }))
    list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    cb(list)
  }, () => cb([]))
}
export function watchLeaves(tid, cb, max = 200) {
  const q = query(sub(tid, 'leaves'), orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function setLeaveStatus(tid, id, status, reason) {
  return updateDoc(subDoc(tid, 'leaves', id), { status, ...(reason != null ? { declineReason: reason } : {}), updatedAt: serverTimestamp() })
}

// ---------- announcements (manager → team) ----------
// publishAt/expiresAt are epoch-millis (numbers) so the portal can schedule
// when an announcement becomes visible and when it auto-hides.
export async function createAnnouncement(tid, { title, body, authorName, publishAt, expiresAt }) {
  return addDoc(sub(tid, 'announcements'), {
    title: title || '', body: body || '', authorName: authorName || '',
    publishAt: Number(publishAt) || Date.now(),
    expiresAt: expiresAt ? Number(expiresAt) : null,
    createdAt: serverTimestamp(),
  })
}
export function watchAnnouncements(tid, cb, max = 50) {
  const q = query(sub(tid, 'announcements'), orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function addAnnouncement(tid, { title = '', body = '', by = '' } = {}) {
  return addDoc(sub(tid, 'announcements'), { title, body, by, createdAt: serverTimestamp() })
}
export async function deleteAnnouncement(tid, id) {
  return deleteDoc(subDoc(tid, 'announcements', id))
}
// One-shot leave-request list (for the AI assistant).
export async function listLeaves(tid, max = 100) {
  const s = await getDocs(query(sub(tid, 'leaves'), limit(max)))
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// ---------- status sessions (busy / break duration tracking) ----------
// One doc per busy/break session. Opened when the staffer switches into the
// status (endedAt:null) and closed with a duration when they switch away.
// startedAt/endedAt are epoch-millis so we can order/aggregate without indexes.
export async function startStatusSession(tid, { staffUid, staffName, status, startedAt }) {
  const ref = await addDoc(sub(tid, 'statusLog'), {
    staffUid, staffName: staffName || '', status, startedAt: Number(startedAt) || Date.now(),
    endedAt: null, durationMs: 0, createdAt: serverTimestamp(),
  })
  return ref.id
}
export async function endStatusSession(tid, id, { endedAt, durationMs }) {
  if (!id) return
  return updateDoc(subDoc(tid, 'statusLog', id), { endedAt: Number(endedAt) || Date.now(), durationMs: Number(durationMs) || 0 })
}
export function watchStatusLog(tid, cb, max = 200) {
  const q = query(sub(tid, 'statusLog'), orderBy('startedAt', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}

// ---------- shifts (weekly schedule) ----------
// One shift per staffer per day; deterministic id `${date}_${uid}` makes
// set/clear idempotent. `date` is 'YYYY-MM-DD'; start/end are 'HH:MM'.
const shiftId = (date, uid) => `${date}_${uid}`
export async function setShift(tid, { date, staffUid, staffName, start, end, note }) {
  return setDoc(subDoc(tid, 'shifts', shiftId(date, staffUid)), {
    date, staffUid, staffName: staffName || '', start: start || '', end: end || '', note: note || '',
    createdAt: serverTimestamp(),
  }, { merge: true })
}
export async function clearShift(tid, date, staffUid) {
  return deleteDoc(subDoc(tid, 'shifts', shiftId(date, staffUid)))
}
// Range query over the (lexicographically sortable) ISO date string — no composite index.
export function watchShiftsRange(tid, fromDate, toDate, cb) {
  const q = query(sub(tid, 'shifts'), where('date', '>=', fromDate), where('date', '<=', toDate))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
// One staffer's shifts (sorted client-side to avoid a composite index).
export function watchMyShifts(tid, uid, cb, max = 60) {
  const q = query(sub(tid, 'shifts'), where('staffUid', '==', uid), limit(max))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date < b.date ? -1 : 1))), () => cb([]))
}
export async function getShift(tid, date, uid) {
  const snap = await getDoc(subDoc(tid, 'shifts', shiftId(date, uid)))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

// ---------- shift swaps (between coworkers; manager approves) ----------
export async function createShiftSwap(tid, data) {
  return addDoc(sub(tid, 'shiftSwaps'), { ...data, status: 'pending', createdAt: serverTimestamp() })
}
export function watchShiftSwaps(tid, cb, max = 100) {
  const q = query(sub(tid, 'shiftSwaps'), orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function setShiftSwapStatus(tid, id, status, declineReason) {
  const swapRef = subDoc(tid, 'shiftSwaps', id)
  if (status === 'accepted') {
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(swapRef)
      if (!snap.exists()) throw new Error('swap-not-found')
      const sw = snap.data()
      const fromShiftRef = subDoc(tid, 'shifts', shiftId(sw.date, sw.fromUid))
      const toShiftRef = subDoc(tid, 'shifts', shiftId(sw.date, sw.toUid))
      tx.delete(fromShiftRef)
      tx.set(toShiftRef, {
        date: sw.date,
        staffUid: sw.toUid,
        staffName: sw.toName || '',
        start: sw.fromStart || '',
        end: sw.fromEnd || '',
        createdAt: serverTimestamp(),
      }, { merge: true })
      tx.update(swapRef, { status: 'accepted', updatedAt: serverTimestamp() })
    })
  }
  const updateData = { status, updatedAt: serverTimestamp() }
  if (declineReason != null) updateData.declineReason = declineReason
  return updateDoc(swapRef, updateData)
}

// ---------- events (café-hosted) ----------
export function watchEvents(tid, cb) {
  const q = query(sub(tid, 'events'), orderBy('startsAt', 'asc'))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => { console.warn('[events]', e.code); cb([]) })
}
export async function getEvent(tid, id) {
  const snap = await getDoc(subDoc(tid, 'events', id))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}
export async function saveEvent(tid, id, data) {
  if (id) return updateDoc(subDoc(tid, 'events', id), { ...data, updatedAt: serverTimestamp() })
  return addDoc(sub(tid, 'events'), { ...data, createdAt: serverTimestamp() })
}
export async function deleteEvent(tid, id) {
  return deleteDoc(subDoc(tid, 'events', id))
}

// ---------- tickets (issued for events) ----------
export async function createTicket(tid, payload, { pending = false } = {}) {
  const code = `T-${randomToken(5).toUpperCase()}`
  const ref = await addDoc(sub(tid, 'tickets'), {
    ...payload,
    code,
    qrToken: randomToken(12),
    // Priced tickets with online payment are created 'pending' and only flipped
    // to 'valid' by the payment webhook — a diner can't self-issue a paid ticket.
    status: pending ? 'pending' : 'valid',
    createdAt: serverTimestamp(),
  })
  return { id: ref.id, code }
}
export async function getTicket(tid, id) {
  const snap = await getDoc(subDoc(tid, 'tickets', id))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}
export function watchTickets(tid, cb) {
  const q = query(sub(tid, 'tickets'), orderBy('createdAt', 'desc'), limit(300))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => { console.warn('[tickets]', e.code); cb([]) })
}
export async function setTicketStatus(tid, id, status) {
  return updateDoc(subDoc(tid, 'tickets', id), { status, checkedInAt: status === 'used' ? serverTimestamp() : null })
}
export function watchTicket(tid, id, cb) {
  return onSnapshot(subDoc(tid, 'tickets', id), (d) => cb(d.exists() ? { id: d.id, ...d.data() } : null), () => cb(null))
}

// ---------- marketing campaigns (scheduled WhatsApp/notice blasts) ----------
// status: 'template' (saved reusable) | 'scheduled' | 'sending' | 'sent' | 'failed'.
// The processCampaigns Cloud Function picks up due 'scheduled' docs.
export function watchCampaigns(tid, cb) {
  return onSnapshot(query(sub(tid, 'campaigns'), orderBy('createdAt', 'desc'), limit(100)),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export function saveCampaign(tid, id, data) {
  if (id) return updateDoc(subDoc(tid, 'campaigns', id), { ...data, updatedAt: serverTimestamp() })
  return addDoc(sub(tid, 'campaigns'), { ...data, createdAt: serverTimestamp() })
}
export function deleteCampaign(tid, id) { return deleteDoc(subDoc(tid, 'campaigns', id)) }
export async function listCampaigns(tid, max = 100) {
  const snap = await getDocs(query(sub(tid, 'campaigns'), orderBy('createdAt', 'desc'), limit(max)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// ---------- diner-facing notices (venue announcements the customer reads) ----------
export function watchDinerNotices(tid, cb) {
  const q = query(sub(tid, 'notices'), orderBy('createdAt', 'desc'), limit(20))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}
export async function saveDinerNotice(tid, { title, body }) {
  return addDoc(sub(tid, 'notices'), { title: (title || '').trim(), body: (body || '').trim(), createdAt: serverTimestamp() })
}
export async function deleteDinerNotice(tid, id) {
  return deleteDoc(subDoc(tid, 'notices', id))
}

// ---------- reservations (customer occasions) ----------
export async function createReservation(tid, payload) {
  const code = `R-${randomToken(5).toUpperCase()}`
  const ref = await addDoc(sub(tid, 'reservations'), {
    ...payload,
    code,
    qrToken: randomToken(12),
    status: 'requested',
    createdAt: serverTimestamp(),
  })
  return { id: ref.id, code }
}
export async function getReservation(tid, id) {
  const snap = await getDoc(subDoc(tid, 'reservations', id))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}
export function watchReservations(tid, cb) {
  const q = query(sub(tid, 'reservations'), orderBy('createdAt', 'desc'), limit(300))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => { console.warn('[reservations]', e.code); cb([]) })
}
export async function setReservationStatus(tid, id, status, extra = {}) {
  return updateDoc(subDoc(tid, 'reservations', id), { status, ...extra, updatedAt: serverTimestamp() })
}
export async function listReservations(tid, max = 100) {
  const s = await getDocs(query(sub(tid, 'reservations'), orderBy('createdAt', 'desc'), limit(max)))
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
}
export function watchReservation(tid, id, cb) {
  return onSnapshot(subDoc(tid, 'reservations', id), (d) => cb(d.exists() ? { id: d.id, ...d.data() } : null), () => cb(null))
}

// ---------- push tokens (FCM) ----------
export async function savePushToken(tid, token, uid) {
  const id = token.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256)
  return setDoc(doc(db, 'tenants', tid, 'pushTokens', id), {
    token, uid: uid || '', ua: navigator.userAgent, updatedAt: serverTimestamp(),
  })
}

// Called at login: if the user has no tenant but a pending invite matches their email, claim it.
export async function claimInviteFor(uid, email) {
  if (!email) return null
  const inv = await getInvite(email)
  if (!inv) return null
  await setDoc(userRef(uid), { tenantId: inv.tenantId, role: inv.role || 'waiter', ...(inv.name ? { displayName: inv.name } : {}) }, { merge: true })
  await deleteInvite(email)
  return inv
}

// ---------- recipes modifications ----------
export async function addRecipeIngredient(tid, itemId, materialId, qty) {
  const ref = subDoc(tid, 'items', itemId)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('item-not-found')
    const item = snap.data()
    const recipe = Array.isArray(item.recipe) ? [...item.recipe] : []
    const idx = recipe.findIndex((x) => x.materialId === materialId)
    if (idx >= 0) {
      recipe[idx].qty = Number(qty) || 0
    } else {
      recipe.push({ materialId, qty: Number(qty) || 0 })
    }
    tx.update(ref, { recipe, stockMode: recipe.length ? 'recipe' : 'none', updatedAt: serverTimestamp() })
  })
}

export async function removeRecipeIngredient(tid, itemId, materialId) {
  const ref = subDoc(tid, 'items', itemId)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('item-not-found')
    const item = snap.data()
    const recipe = (Array.isArray(item.recipe) ? item.recipe : []).filter((x) => x.materialId !== materialId)
    tx.update(ref, { recipe, stockMode: recipe.length ? 'recipe' : 'none', updatedAt: serverTimestamp() })
  })
}

export async function updateRecipeIngredientQty(tid, itemId, materialId, qty) {
  return addRecipeIngredient(tid, itemId, materialId, qty)
}

export async function setVariantRecipe(tid, itemId, variantKey, recipeLines) {
  const ref = subDoc(tid, 'items', itemId)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('item-not-found')
    const item = snap.data()
    const variantRecipes = item.variantRecipes ? { ...item.variantRecipes } : {}
    variantRecipes[variantKey] = recipeLines
    tx.update(ref, { variantRecipes, stockMode: 'recipe', updatedAt: serverTimestamp() })
  })
}

// ---------- barcode and opened flag ----------
export async function linkBarcodeToMaterial(tid, materialId, barcode) {
  return updateDoc(subDoc(tid, 'materials', materialId), { barcode, updatedAt: serverTimestamp() })
}

export async function markMaterialAsOpened(tid, materialId, shelfLifeDays) {
  const openedAt = Date.now()
  const days = Number(shelfLifeDays) || 0
  const expiryDate = days > 0 ? new Date(openedAt + (days * 86400000)).toISOString().slice(0, 10) : ''
  const patch = { openedAt, updatedAt: serverTimestamp() }
  if (expiryDate) patch.expiryDate = expiryDate
  return updateDoc(subDoc(tid, 'materials', materialId), patch)
}

// ---------- purchase orders ----------
export function watchPurchaseOrders(tid, cb) {
  const q = query(sub(tid, 'purchaseOrders'), orderBy('createdAt', 'desc'), limit(100))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}

export async function createPurchaseOrder(tid, payload) {
  const code = 'PO-' + String(Date.now()).slice(-6)
  const ref = await addDoc(sub(tid, 'purchaseOrders'), {
    ...payload,
    code,
    status: 'draft',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return { id: ref.id, code }
}

export async function updatePurchaseOrderStatus(tid, poId, status) {
  return updateDoc(subDoc(tid, 'purchaseOrders', poId), { status, updatedAt: serverTimestamp() })
}

export async function receivePurchaseOrderShipment(tid, poId, actor = '') {
  const poRef = subDoc(tid, 'purchaseOrders', poId)
  await runTransaction(db, async (tx) => {
    const poSnap = await tx.get(poRef)
    if (!poSnap.exists()) throw new Error('po-not-found')
    const po = poSnap.data()
    if (po.status === 'received') return

    // Receive each item in the purchase order
    const items = po.items || []
    for (const item of items) {
      if (!item.materialId) continue
      const matRef = subDoc(tid, 'materials', item.materialId)
      const matSnap = await tx.get(matRef)
      if (!matSnap.exists()) continue
      const d = matSnap.data()
      const oldQty = d.stockQty || 0
      const addQty = Number(item.qtyBase) || Number(item.qty) || 0
      const totalCost = Number(item.cost) || 0
      const newQty = oldQty + addQty
      const addUnitCost = addQty > 0 ? totalCost / addQty : 0
      const avgCost = newQty > 0 ? ((oldQty * (d.avgCost || 0)) + (addQty * addUnitCost)) / newQty : (d.avgCost || 0)
      tx.update(matRef, { stockQty: newQty, avgCost, lastReceivedAt: Date.now(), updatedAt: serverTimestamp() })

      // Write stockMove inside transaction
      const moveRef = doc(sub(tid, 'stockMoves'))
      tx.set(moveRef, {
        type: 'receive',
        materialId: item.materialId,
        qty: addQty,
        cost: totalCost,
        supplierId: po.supplierId || '',
        byName: actor,
        at: Date.now(),
        createdAt: serverTimestamp()
      })
    }

    tx.update(poRef, { status: 'received', receivedAt: Date.now(), receivedBy: actor, updatedAt: serverTimestamp() })
  })
}

export async function addSupplierPayment(tid, supplierId, amount, note = '') {
  return addDoc(sub(tid, 'supplierPayments'), {
    supplierId,
    amount: Number(amount) || 0,
    note,
    createdAt: serverTimestamp(),
  })
}

