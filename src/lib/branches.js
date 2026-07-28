// Branch switching, client side.
//
// `users/{uid}.tenantId` remains "the venue I am working in right now", so
// nothing about permissions changes — this is navigation. See
// functions/branches.js for why that framing is what keeps the whole thing
// safe.
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from './firebase.js'

// The venues this user may switch to. For 100% of accounts today this is
// exactly one row, and the switcher renders nothing — which is what makes the
// rollout invisible.
export function watchMyMemberships(uid, cb) {
  if (!uid) { cb([]); return () => {} }
  const q = query(collection(db, `users/${uid}/memberships`), orderBy('addedAt', 'asc'))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}

export async function switchTenant(tenantId) {
  const r = await httpsCallable(functions, 'switchTenant')({ tenantId })
  return r.data
}

export async function createBranch(payload) {
  const r = await httpsCallable(functions, 'createBranch')(payload)
  return r.data
}

// After a switch: a HARD reload, not a React navigation.
//
// Dozens of admin screens hold per-tenant Firestore listeners and open sheets.
// A soft navigation leaves them mounted against the previous tenant, and the
// first cross-branch data bleed would be a silent correctness bug in someone's
// orders list. A full reload makes that structurally impossible.
export function reloadIntoAdmin() {
  try {
    // Drafts are per-venue; carrying one across a switch would paste branch
    // A's campaign into branch B's composer.
    Object.keys(sessionStorage).forEach((k) => { if (/^rbt_.*draft/i.test(k)) sessionStorage.removeItem(k) })
  } catch (_) { /* storage off — the reload still does the important part */ }
  window.location.assign('/admin')
}
