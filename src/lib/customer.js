// Customer recognition stored in the diner's own browser (per device).
// Lets a returning guest be greeted by name and have checkout prefilled.

const KEY = 'ml.customer'

export function getLocalCustomer() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return v && (v.name || v.phone) ? v : null
  } catch (_) {
    return null
  }
}

export function setLocalCustomer({ name, phone }) {
  try {
    const prev = getLocalCustomer() || {}
    localStorage.setItem(KEY, JSON.stringify({ name: name || prev.name || '', phone: phone || prev.phone || '', savedAt: Date.now() }))
  } catch (_) { /* ignore */ }
}

export function clearLocalCustomer() {
  try { localStorage.removeItem(KEY) } catch (_) { /* ignore */ }
}

// Remembered VIP card token per venue, so a member is recognized on return without ?m=.
const MTOKEN_KEY = 'ml.mtoken'
export function getMemberToken(tid) {
  try { return (JSON.parse(localStorage.getItem(MTOKEN_KEY) || '{}'))[tid] || '' } catch (_) { return '' }
}
export function setMemberToken(tid, token) {
  try {
    const all = JSON.parse(localStorage.getItem(MTOKEN_KEY) || '{}')
    if (token) all[tid] = token; else delete all[tid]
    localStorage.setItem(MTOKEN_KEY, JSON.stringify(all))
  } catch (_) { /* ignore */ }
}

// Per-venue dismissal of the "register" invite banner.
export function isRegisterDismissed(tid) {
  try { return localStorage.getItem(`ml.reg.${tid}`) === '1' } catch (_) { return false }
}
export function dismissRegister(tid) {
  try { localStorage.setItem(`ml.reg.${tid}`, '1') } catch (_) { /* ignore */ }
}

// ---------- the device's own order history (no accounts) ----------
const ORDERS_KEY = 'ml.myorders' // { [tenantId]: [{ id, code, at }] }

export function getMyOrders(tid) {
  try {
    const all = JSON.parse(localStorage.getItem(ORDERS_KEY) || '{}')
    return all[tid] || []
  } catch (_) {
    return []
  }
}
export function addMyOrder(tid, { id, code }) {
  try {
    const all = JSON.parse(localStorage.getItem(ORDERS_KEY) || '{}')
    const list = (all[tid] || []).filter((o) => o.id !== id)
    all[tid] = [{ id, code: code || '', at: Date.now() }, ...list].slice(0, 25)
    localStorage.setItem(ORDERS_KEY, JSON.stringify(all))
  } catch (_) { /* ignore */ }
}

// ---------- the device's own event tickets / passes (no accounts) ----------
const PASSES_KEY = 'ml.mypasses' // { [tenantId]: [{ id, code, kind, title, at }] }
export function getMyPasses(tid) {
  try {
    const all = JSON.parse(localStorage.getItem(PASSES_KEY) || '{}')
    return all[tid] || []
  } catch (_) {
    return []
  }
}
export function addMyPass(tid, { id, code, kind = 'ticket', title = '' }) {
  try {
    const all = JSON.parse(localStorage.getItem(PASSES_KEY) || '{}')
    const list = (all[tid] || []).filter((p) => p.id !== id)
    all[tid] = [{ id, code: code || '', kind, title: title || '', at: Date.now() }, ...list].slice(0, 25)
    localStorage.setItem(PASSES_KEY, JSON.stringify(all))
  } catch (_) { /* ignore */ }
}

// rated orders (so we prompt only once)
const RATED_KEY = 'ml.rated'
export function isRated(orderId) {
  try { return JSON.parse(localStorage.getItem(RATED_KEY) || '[]').includes(orderId) } catch (_) { return false }
}
export function markRated(orderId) {
  try {
    const a = JSON.parse(localStorage.getItem(RATED_KEY) || '[]')
    if (!a.includes(orderId)) { a.push(orderId); localStorage.setItem(RATED_KEY, JSON.stringify(a)) }
  } catch (_) { /* ignore */ }
}

const ARRIVED_KEY = 'ml.arrived'
export function isArrived(orderId) {
  try { return JSON.parse(localStorage.getItem(ARRIVED_KEY) || '[]').includes(orderId) } catch (_) { return false }
}
export function markArrived(orderId) {
  try {
    const a = JSON.parse(localStorage.getItem(ARRIVED_KEY) || '[]')
    if (!a.includes(orderId)) { a.push(orderId); localStorage.setItem(ARRIVED_KEY, JSON.stringify(a)) }
  } catch (_) { /* ignore */ }
}

// Best-effort public IP (client-side; for analytics/recognition). Cached per session.
let cachedIp = null
export async function fetchIp() {
  if (cachedIp) return cachedIp
  try {
    const r = await fetch('https://api.ipify.org?format=json')
    const j = await r.json()
    cachedIp = j.ip || null
  } catch (_) {
    cachedIp = null
  }
  return cachedIp
}
