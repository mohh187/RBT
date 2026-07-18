import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, updateProfile, signOut } from 'firebase/auth'
import { firebaseConfig } from './firebase.js'

// Create a staff login WITHOUT disturbing the admin's own session, using a
// short-lived secondary Firebase app. The new account is bound to the venue on
// the staffer's first login via the pending invite (see claimInviteFor).
export async function createStaffAccount({ email, password, displayName }) {
  const secondary = initializeApp(firebaseConfig, `staff-provision-${Date.now()}`)
  const secAuth = getAuth(secondary)
  try {
    const cred = await createUserWithEmailAndPassword(secAuth, email, password)
    if (displayName) { try { await updateProfile(cred.user, { displayName }) } catch (_) { /* non-fatal */ } }
    await signOut(secAuth)
    return cred.user.uid
  } finally {
    try { await deleteApp(secondary) } catch (_) { /* ignore */ }
  }
}
