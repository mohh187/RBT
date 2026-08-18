// Staff PIN lock — since the pinSignIn upgrade this is a REAL session gate:
// entering a PIN identifies the staffer server-side (unique per venue) and the
// device's Firebase session is SWAPPED to that staffer's own account via a
// custom token. The old overlay behavior survives only as the same-user fast
// path (the unlocker already holds the session — nothing to swap).
//
// Verification is SERVER-SIDE (staffSecurity.js): hashes live in
// tenants/{tid}/staffPins/{uid} — a collection no client can read — salted
// and scrypt-stretched, with per-staff AND tenant-wide attempt rate-limiting.
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

// PIN-only sign-in: the PIN alone identifies the staffer. Success returns
// { ok, token, uid, name } — the caller swaps the Firebase session with the
// token. staffId is passed ONLY on the duplicate-PIN disambiguation retry.
// Works unauthenticated (cold PWA start on a wiped tablet).
export async function pinSignIn(tid, pin, staffId = null) {
  try {
    const res = await httpsCallable(functions, 'pinSignIn')({ tenantId: tid, pin, ...(staffId ? { staffId } : {}) })
    return res?.data || { ok: false }
  } catch (_) {
    return { ok: false, error: true }
  }
}

// Fire-and-forget container warm-up: called on the FIRST keypad digit, so a
// cold Cloud Function instance boots while the remaining three digits are
// typed instead of adding seconds after the fourth. The server answers a
// { warm:true } ping before doing any work; even against an older deploy the
// rejected call still warms the instance, so this can never make things worse.
export function warmPinSignIn() {
  try { httpsCallable(functions, 'pinSignIn')({ warm: true }).catch(() => {}) } catch (_) { /* ignore */ }
}

// ---- same-user quick unlock ----
// After a successful SERVER sign-in, a salted PBKDF2 digest of the PIN is kept
// for THIS TAB ONLY (sessionStorage, 8h). The idle-lock overlay then lifts
// instantly — zero network — for the user who is ALREADY signed in on the
// device. It can never switch identities: the digest is bound to the current
// session's uid, and any PIN that doesn't match falls through to the server
// (which keeps all rate limiting). Threat-wise this grants nothing the tab
// doesn't already hold — the Firebase session token itself lives beside it.
const quickKey = (tid) => `ml.pin.quick.${tid}`
const QUICK_TTL_MS = 8 * 60 * 60 * 1000 // one shift

async function pinDigest(pin, saltHex) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((b) => parseInt(b, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 120000 }, key, 256)
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function rememberQuickUnlock(tid, uid, pin) {
  try {
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('')
    const hash = await pinDigest(pin, salt)
    sessionStorage.setItem(quickKey(tid), JSON.stringify({ uid, salt, hash, at: Date.now() }))
  } catch (_) { /* no WebCrypto / storage — quick unlock simply stays off */ }
}

export async function tryQuickUnlock(tid, uid, pin) {
  try {
    const rec = JSON.parse(sessionStorage.getItem(quickKey(tid)) || 'null')
    if (!rec || !uid || rec.uid !== uid || Date.now() - (rec.at || 0) > QUICK_TTL_MS) return false
    return (await pinDigest(pin, rec.salt)) === rec.hash
  } catch (_) {
    return false
  }
}

// ---- device memory (localStorage) — what the lock screen needs before anyone
// is signed in: which venue this tablet belongs to, and the team roster to
// greet people by name. Written while any member is signed in; read cold. ----
const deviceVenueKey = 'ml.device.venue'
const rosterKey = (tid) => `ml.device.roster.${tid}`

export function rememberDeviceVenue(t) {
  if (!t?.id) return
  try {
    localStorage.setItem(deviceVenueKey, JSON.stringify({
      tid: t.id, name: t.name || '', logoUrl: t.logoUrl || '', slug: t.slug || '',
      pinLock: t.pinLock || null, pinLockStyle: t.pinLockStyle || '',
    }))
  } catch (_) { /* storage blocked */ }
}
export function getDeviceVenue() {
  try { return JSON.parse(localStorage.getItem(deviceVenueKey) || 'null') } catch (_) { return null }
}
export function rememberRoster(tid, staff) {
  try {
    const slim = (staff || []).filter((s) => s.active !== false).map((s) => ({
      uid: s.uid || s.id, name: s.name || s.email || '', role: s.role || 'staff',
      photoUrl: s.photoUrl || '', hasPin: !!(s.hasPin || s.pinHash),
    }))
    localStorage.setItem(rosterKey(tid), JSON.stringify(slim))
  } catch (_) { /* ignore */ }
}
export function getRoster(tid) {
  try { return JSON.parse(localStorage.getItem(rosterKey(tid)) || '[]') } catch (_) { return [] }
}
export function forgetDevice() {
  try {
    const v = getDeviceVenue()
    localStorage.removeItem(deviceVenueKey)
    if (v?.tid) localStorage.removeItem(rosterKey(v.tid))
  } catch (_) { /* ignore */ }
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
