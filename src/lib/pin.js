// Staff PIN lock — an OPERATIONAL tamper guard for shared devices, not crypto:
// whoever holds the Firebase session can bypass it; real security stays with
// auth + rules. PINs are stored as SHA-256(tid:pin) — never plaintext.

export async function hashPin(tid, pin) {
  const data = new TextEncoder().encode(`${tid}:${pin}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

const actorKey = (tid) => `ml.pin.actor.${tid}`
const okKey = (tid) => `ml.pin.ok.${tid}`

// who unlocked this device — used as actorName on orders for accountability
export function getPinActor(tid) {
  try { return JSON.parse(localStorage.getItem(actorKey(tid)) || 'null') } catch (_) { return null }
}
export function setPinActor(tid, actor) {
  try { localStorage.setItem(actorKey(tid), JSON.stringify(actor)) } catch (_) { /* ignore */ }
}

export function isUnlocked(tid) { return sessionStorage.getItem(okKey(tid)) === '1' }
export function markUnlocked(tid) { try { sessionStorage.setItem(okKey(tid), '1') } catch (_) { /* ignore */ } }
export function clearUnlocked(tid) { try { sessionStorage.removeItem(okKey(tid)) } catch (_) { /* ignore */ } }

// any screen can request an immediate lock (e.g. a header lock button)
export function requestLock() { window.dispatchEvent(new Event('ml:pinlock')) }
