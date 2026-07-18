// Data layer for the platform audit log + platform admin roles.
// Platform-only collections (read/write gated to platform admins by security rules).
import { db } from './firebase.js'
import {
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'

// Record a super-admin / support action into the immutable audit trail.
// actor = the current auth `user` ({ uid, email }) so we always stamp WHO did it.
// Never throws to the caller — audit logging must not break the action it records.
export async function logPlatformAction(actor, { action, targetTid = null, targetName = null, detail = null } = {}) {
  try {
    await addDoc(collection(db, 'platformAudit'), {
      action: action || 'unknown',
      targetTid: targetTid || null,
      targetName: targetName || null,
      detail: detail || null,
      byUid: actor?.uid || null,
      byEmail: actor?.email || null,
      at: serverTimestamp(),
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[platformAudit] logPlatformAction failed', e)
  }
}

// Live audit entries, newest first.
export function watchAudit(cb, max = 200) {
  const q = query(collection(db, 'platformAudit'), orderBy('at', 'desc'), limit(max))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => cb([]),
  )
}

// Live list of platform admins (doc id = admin uid; may carry a `role` field).
export function watchPlatformAdmins(cb) {
  const q = collection(db, 'platformAdmins')
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => cb([]),
  )
}
