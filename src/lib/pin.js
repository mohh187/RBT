// Staff PIN lock — an OPERATIONAL tamper guard for shared devices, not crypto:
// whoever holds the Firebase session can bypass it; real security stays with
// auth + rules.
//
// Verification is SERVER-SIDE now (verifyStaffPin callable): hashes live in
// tenants/{tid}/staffPins/{uid} — a collection no client can read — salted
// and scrypt-stretched, with attempt rate-limiting. They used to be
// SHA-256(tid:pin) on the peer-readable staff doc, where any coworker could
// brute-force all 10,000 candidates offline and unlock as a manager.
import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase.js'

// Server verify → { ok, locked?, waitMs?, none? }. Network errors surface as
// { ok:false, error:true } so the lock screen can say "check the connection"
// instead of counting it as a wrong PIN.
export async function verifyPin(tid, staffId, pin) {
  try {
    const res = await httpsCallable(functions, 'verifyStaffPin')({ tenantId: tid, staffId, pin })
    return res?.data || { ok: false }
  } catch (_) {
    return { ok: false, error: true }
  }
}

// Manager sets (4 digits) or clears (''/null) a staffer's PIN.
export async function setStaffPinSecure(tid, staffId, pin) {
  const res = await httpsCallable(functions, 'setStaffPinSecure')({ tenantId: tid, staffId, pin: pin || null })
  return res?.data || { ok: false }
}

// One idempotent sweep moving legacy staff-doc pinHash fields into the
// server-only staffPins collection (manager session; safe to re-run).
export async function migrateStaffPins(tid) {
  const res = await httpsCallable(functions, 'migrateStaffPins')({ tenantId: tid })
  return res?.data || { ok: false, moved: 0 }
}

// A staffer appears on the lock screen when they have a PIN: the non-secret
// hasPin flag going forward, or a legacy pinHash still awaiting migration.
export const staffHasPin = (s) => !!(s && (s.hasPin || s.pinHash))

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
