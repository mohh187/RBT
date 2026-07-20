// Shared table ordering — «الطلب الجماعي».
//
// One live session per TABLE per DAY:  tenants/{tid}/tableSessions/{tableId}_{YYYYMMDD}
// Several phones sitting at the same table write into ONE document, so every
// guest sees the whole table's basket in real time and the bill splits itself.
//
// CONCURRENCY (the crux): a naive read-then-write from four phones loses lines.
//  - addLine   → arrayUnion (a single atomic server-side op, zero contention)
//  - remove / setQty / join / markOrdered → runTransaction (read-modify-write
//    with automatic retry on conflict)
// Never a plain updateDoc({ lines: [...] }) built from a local snapshot.
//
// HONEST LIMIT: Firestore forbids serverTimestamp() INSIDE array elements, so
// per-line/per-guest times are client clocks (Date.now()). Only the document's
// createdAt/updatedAt are server time. Client clocks can be skewed — these
// timestamps are for ordering the UI list, never for billing or audit.
import {
  doc,
  onSnapshot,
  runTransaction,
  updateDoc,
  serverTimestamp,
  arrayUnion,
} from 'firebase/firestore'
import { db } from './firebase.js'

const GUEST_ID_KEY = 'rbt_table_guest_id'
const GUEST_NAME_KEY = 'rbt_table_guest_name'

const sessionRef = (tid, sessionId) => doc(db, 'tenants', tid, 'tableSessions', sessionId)

// ---------- identity (device-local, no auth) ----------

// Stable random id for THIS device. Used to decide which lines a guest may
// delete. It is not a security boundary on its own — rules must re-check it.
export function deviceGuestId() {
  try {
    let id = localStorage.getItem(GUEST_ID_KEY)
    if (!id) {
      id = `g${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
      localStorage.setItem(GUEST_ID_KEY, id)
    }
    return id
  } catch (_) {
    // private mode / storage blocked: a per-tab id still works for one sitting
    if (!deviceGuestId._mem) deviceGuestId._mem = `g${Math.random().toString(36).slice(2, 12)}`
    return deviceGuestId._mem
  }
}

export function savedGuestName() {
  try { return localStorage.getItem(GUEST_NAME_KEY) || '' } catch (_) { return '' }
}

export function rememberGuestName(name) {
  try { localStorage.setItem(GUEST_NAME_KEY, String(name || '').slice(0, 40)) } catch (_) { /* ignore */ }
}

// ---------- ids ----------

// YYYYMMDD in the device's local day — built from numbers so the digits are
// always Latin (toLocaleDateString would emit Arabic-Indic under ar locales).
export function dayKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

// Firestore ids may not contain '/'; table ids come from our own docs but a
// hand-made table id could still be odd, so sanitize defensively.
export function sessionIdFor(tableId, date = new Date()) {
  const safe = String(tableId || 'table').replace(/[^A-Za-z0-9_-]/g, '')
  return `${safe || 'table'}_${dayKey(date)}`
}

// ---------- normalisation ----------

function normalizeMods(mods) {
  if (!Array.isArray(mods)) return []
  return mods.map((m) => ({
    nameAr: String(m?.nameAr || ''),
    nameEn: String(m?.nameEn || ''),
    price: Number(m?.price) || 0,
  }))
}

function normalizeVariant(variant) {
  if (!variant) return { key: '', label: '' }
  if (typeof variant === 'string') return { key: '', label: variant }
  return { key: String(variant.key || ''), label: String(variant.label || variant.nameAr || '') }
}

// Build the exact stored shape. Anything undefined breaks Firestore writes, so
// every field is forced to a concrete value.
export function makeLine(input, guest) {
  const qty = Math.max(1, Math.min(99, Number(input?.qty) || 1))
  const unitPrice = Number(input?.unitPrice) || 0
  return {
    id: `l${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-5)}`,
    itemId: String(input?.itemId || ''),
    nameAr: String(input?.nameAr || ''),
    nameEn: String(input?.nameEn || ''),
    imageUrl: String(input?.imageUrl || input?.image || ''),
    variant: normalizeVariant(input?.variant),
    mods: normalizeMods(input?.mods ?? input?.modifiers),
    qty,
    unitPrice,
    lineTotal: Math.round(unitPrice * qty * 100) / 100,
    // Optional 3D payload so «المائدة الحية» can render the table from the
    // session alone, without re-reading the menu items.
    model3dUrl: String(input?.model3dUrl || ''),
    arStandeeUrl: String(input?.arStandeeUrl || ''),
    model3dUsdzUrl: String(input?.model3dUsdzUrl || ''),
    by: String(guest?.name || input?.by || '').slice(0, 40),
    byId: String(guest?.id || input?.byId || deviceGuestId()),
    at: Date.now(),
  }
}

// ---------- reads ----------

// cb(session, error) — session is null while missing/failed. The error branch
// is ALWAYS called on failure so callers can drop the spinner instead of
// hanging forever on a permission/offline snapshot error.
export function watchSession(tid, sessionId, cb) {
  if (!tid || !sessionId) { cb(null, new Error('missing-session')); return () => {} }
  return onSnapshot(
    sessionRef(tid, sessionId),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null, null),
    (err) => cb(null, err),
  )
}

// ---------- writes ----------

// Join (or create) today's session for this table and register the guest.
// Renaming yourself later just updates your entry — never duplicates it.
export async function joinSession(tid, table, name) {
  const tableId = table?.id || ''
  const sessionId = sessionIdFor(tableId)
  const guest = {
    id: deviceGuestId(),
    name: String(name || '').trim().slice(0, 40) || 'ضيف',
    joinedAt: Date.now(),
  }
  const ref = sessionRef(tid, sessionId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) {
      tx.set(ref, {
        tableId,
        tableLabel: String(table?.label || ''),
        status: 'open',
        lines: [],
        guests: [guest],
        orderIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      return
    }
    const data = snap.data() || {}
    // A closed session means the previous party settled and left. The next
    // party at the same table on the same day starts clean instead of
    // inheriting a stranger's basket.
    if (data.status === 'closed') {
      tx.update(ref, {
        status: 'open',
        lines: [],
        guests: [guest],
        orderIds: [],
        tableLabel: String(table?.label || data.tableLabel || ''),
        updatedAt: serverTimestamp(),
      })
      return
    }
    const guests = Array.isArray(data.guests) ? data.guests : []
    const idx = guests.findIndex((g) => g?.id === guest.id)
    const next = idx >= 0
      ? guests.map((g, i) => (i === idx ? { ...g, name: guest.name } : g))
      : [...guests, guest]
    tx.update(ref, { guests: next, updatedAt: serverTimestamp() })
  })
  return { sessionId, guest }
}

// Atomic append — the ONE hot path where several phones write at once.
// arrayUnion is applied server-side, so no concurrent write can clobber it.
export async function addLine(tid, sessionId, line) {
  const ref = sessionRef(tid, sessionId)
  const stored = line?.id && line?.byId ? line : makeLine(line, null)
  try {
    await updateDoc(ref, { lines: arrayUnion(stored), updatedAt: serverTimestamp() })
  } catch (e) {
    if (e?.code === 'not-found') throw new Error('session-missing')
    throw e
  }
  return stored
}

// Shared read-modify-write with retry, used by every ownership-checked edit.
async function mutateLines(tid, sessionId, fn) {
  const ref = sessionRef(tid, sessionId)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('session-missing')
    const data = snap.data() || {}
    const lines = Array.isArray(data.lines) ? data.lines : []
    const next = fn(lines, data)
    if (next === null) return
    tx.update(ref, { lines: next, updatedAt: serverTimestamp() })
  })
}

// A guest may remove ONLY their own line. Enforced here AND (must be) in rules —
// the client check is convenience, the rule is the boundary.
export async function removeLine(tid, sessionId, lineId, byId) {
  const me = byId || deviceGuestId()
  return mutateLines(tid, sessionId, (lines) => {
    const target = lines.find((l) => l?.id === lineId)
    if (!target) return null
    if (target.byId !== me) throw new Error('not-your-line')
    return lines.filter((l) => l?.id !== lineId)
  })
}

export async function setLineQty(tid, sessionId, lineId, qty, byId) {
  const me = byId || deviceGuestId()
  const n = Math.max(0, Math.min(99, Number(qty) || 0))
  return mutateLines(tid, sessionId, (lines) => {
    const target = lines.find((l) => l?.id === lineId)
    if (!target) return null
    if (target.byId !== me) throw new Error('not-your-line')
    if (n <= 0) return lines.filter((l) => l?.id !== lineId)
    return lines.map((l) => (l?.id === lineId
      ? { ...l, qty: n, lineTotal: Math.round((Number(l.unitPrice) || 0) * n * 100) / 100 }
      : l))
  })
}

// The table sent its round to the kitchen. Lines are cleared so a second round
// starts empty; the created order ids stay on the session for the receipt.
export async function markOrdered(tid, sessionId, orderId) {
  const ref = sessionRef(tid, sessionId)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('session-missing')
    const data = snap.data() || {}
    const ids = Array.isArray(data.orderIds) ? data.orderIds : []
    tx.update(ref, {
      status: 'ordered',
      lines: [],
      orderIds: orderId ? [...ids, String(orderId)] : ids,
      lastOrderedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  })
}

export async function closeSession(tid, sessionId) {
  return updateDoc(sessionRef(tid, sessionId), {
    status: 'closed',
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

// ---------- derived math (pure, no I/O) ----------

export function sessionTotal(session) {
  const lines = Array.isArray(session?.lines) ? session.lines : []
  return lines.reduce((s, l) => s + (Number(l?.lineTotal) || (Number(l?.unitPrice) || 0) * (Number(l?.qty) || 0)), 0)
}

export function sessionCount(session) {
  const lines = Array.isArray(session?.lines) ? session.lines : []
  return lines.reduce((s, l) => s + (Number(l?.qty) || 0), 0)
}

// Smart split: what each person actually ordered. Guests who joined but added
// nothing still appear (total zero) so the table sees everyone.
export function splitByGuest(session) {
  const lines = Array.isArray(session?.lines) ? session.lines : []
  const guests = Array.isArray(session?.guests) ? session.guests : []
  const byId = new Map()
  guests.forEach((g) => {
    if (g?.id) byId.set(g.id, { id: g.id, name: g.name || 'ضيف', joinedAt: g.joinedAt || 0, lines: [], total: 0, count: 0 })
  })
  lines.forEach((l) => {
    const id = l?.byId || 'unknown'
    if (!byId.has(id)) byId.set(id, { id, name: l?.by || 'ضيف', joinedAt: l?.at || 0, lines: [], total: 0, count: 0 })
    const g = byId.get(id)
    g.lines.push(l)
    g.total += Number(l?.lineTotal) || 0
    g.count += Number(l?.qty) || 0
  })
  return [...byId.values()].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
}

// The «تقسيم بالتساوي» alternative figure.
export function equalShare(session) {
  const people = Math.max(1, splitByGuest(session).length)
  return Math.round((sessionTotal(session) / people) * 100) / 100
}
