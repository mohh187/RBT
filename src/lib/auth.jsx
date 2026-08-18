import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db, firebaseReady } from './firebase.js'
import { getUserProfile, createUserProfile, getTenant, claimInviteFor, upsertStaffMember, getStaffMember } from './db.js'
import { applyTheme, resolveTenantTheme } from './themes.js'
import { effectiveCan } from './permissions.js'
import { pinSignIn as pinSignInCall, rememberDeviceVenue, markUnlocked, setPinActor, rememberQuickUnlock } from './pin.js'
import { checkPlatformAdmin } from './platform.js'
import { setMonitorContext } from './monitor.js'

const AuthContext = createContext(null)

function applyBrand(tenant) {
  applyTheme(resolveTenantTheme(tenant))
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null) // firebase user
  const [profile, setProfile] = useState(null) // users/{uid}
  const [tenant, setTenant] = useState(null) // tenants/{tid}
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false) // platformAdmins/{uid} exists
  const [staffCaps, setStaffCaps] = useState(null) // per-staffer resolved caps override (staff/{uid}.caps), or null
  const [loading, setLoading] = useState(true)

  const loadContext = useCallback(async (fbUser) => {
    if (!fbUser) {
      setProfile(null)
      setTenant(null)
      setIsPlatformAdmin(false)
      setStaffCaps(null)
      setMonitorContext({ uid: null, tenantId: null, tenantName: '' })
      // HAND THE PALETTE BACK. Signing out of a venue used to leave that
      // venue's brand on the document, so the login screen wore the colours of
      // the account that had just left — on a shared back-office device, the
      // previous tenant's identity greeting the next person.
      //
      // Here, not in logout(): this branch is where EVERY way of becoming
      // signed-out arrives — the logout button, an expired or revoked token,
      // and a sign-out performed in another tab. logout() is only the first of
      // those. resolveTenantTheme(null) is not a no-op; it returns the platform
      // default explicitly, which is what we want painted.
      applyBrand(null)
      return
    }
    // The platform-admin check and the profile fetch are independent — run them
    // in parallel to shave a round trip off first authed paint (both still
    // resolve before loading ends, so the /platform guard never races).
    const [platformAdmin, initialProfile] = await Promise.all([
      checkPlatformAdmin(fbUser.uid),
      getUserProfile(fbUser.uid),
    ])
    setIsPlatformAdmin(platformAdmin)
    let prof = initialProfile
    // Auto-join: pending staff invites for this VERIFIED address are claimed
    // server-side. Runs even when the user already has a venue — the callable
    // joins them to the other venue without moving them, so an invite can no
    // longer evict someone from where they already work.
    if (fbUser.email) {
      try {
        const res = await claimInviteFor()
        if (res && (res.claimed || []).length) prof = await getUserProfile(fbUser.uid)
      } catch (_) {
        /* an invite that cannot be claimed must never block signing in */
      }
    }
    setProfile(prof)
    setMonitorContext({ uid: fbUser.uid, tenantId: prof?.tenantId || null })
    if (prof?.tenantId) {
      const t = await getTenant(prof.tenantId)
      setTenant(t)
      applyBrand(t)
      setMonitorContext({ tenantName: t?.name || '' })
      // Device memory: the /lock cold-start screen needs the venue identity
      // before anyone is signed in — stamp it while a member IS signed in.
      rememberDeviceVenue(t)
      // Self-register membership under THIS tenant (strictly tenant-scoped via rules).
      // Await so the staff doc exists before we read its capability override below.
      await upsertStaffMember(prof.tenantId, fbUser.uid, {
        name: fbUser.displayName || prof.displayName || (fbUser.email || '').split('@')[0],
        email: fbUser.email || '',
        role: prof.role || 'staff',
        active: true,
      }).catch(() => {})
      // Per-staffer capability override (manager-set on staff/{uid}.caps). Null → role default.
      const sm = await getStaffMember(prof.tenantId, fbUser.uid).catch(() => null)
      setStaffCaps(Array.isArray(sm?.caps) ? sm.caps : null)
      // Register this staff device for push (no-op unless VAPID key set + permission granted).
      import('./push.js').then((m) => m.initPush(prof.tenantId, fbUser.uid)).catch(() => {})
    } else {
      setTenant(null)
      setStaffCaps(null)
    }
  }, [])

  useEffect(() => {
    if (!firebaseReady) {
      setLoading(false)
      return
    }
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      // Gate route guards through EVERY auth transition (not just first mount):
      // without this, a fresh login briefly renders with user set but profile
      // still loading (tenantId null) — and RequireTenant/Login bounced people
      // to the CREATION page mid-login. loading=true until the profile is known.
      setLoading(true)
      setUser(fbUser)
      await loadContext(fbUser)
      setLoading(false)
    })
    return unsub
  }, [loadContext])

  // Live tenant doc: platform-console changes (plan / suspension / settings)
  // take effect immediately — no re-login needed.
  useEffect(() => {
    const tid = profile?.tenantId
    if (!firebaseReady || !tid) return
    const unsub = onSnapshot(
      doc(db, 'tenants', tid),
      (s) => {
        if (!s.exists()) { setTenant(null); return } // venue deleted → drop stale context
        const t = { id: s.id, ...s.data() }
        setTenant(t)
        applyBrand(t)
        setMonitorContext({ tenantName: t.name || '' })
      },
      () => {},
    )
    return unsub
  }, [profile?.tenantId])

  const signup = useCallback(async (email, password, displayName) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    if (displayName) await updateProfile(cred.user, { displayName })
    await createUserProfile(cred.user.uid, { email, displayName: displayName || '' })
    await loadContext(cred.user)
    return cred.user
  }, [loadContext])

  const login = useCallback(async (email, password) => {
    const cred = await signInWithEmailAndPassword(auth, email, password)
    await loadContext(cred.user)
    return cred.user
  }, [loadContext])

  const logout = useCallback(async () => {
    await signOut(auth)
    setProfile(null)
    setTenant(null)
  }, [])

  // PIN sign-in: the PIN identifies the staffer server-side; when it belongs to
  // someone other than the current Firebase user, the session is genuinely
  // SWAPPED via signInWithCustomToken — onAuthStateChanged then rebuilds
  // profile/tenant/caps and re-registers push for the new identity. The unlock
  // markers are stamped BEFORE the swap so the remounted PinLock doesn't
  // re-lock mid-transition.
  const pinLogin = useCallback(async (tid, pin, staffId = null) => {
    const res = await pinSignInCall(tid, pin, staffId)
    if (res.ok && res.uid) {
      // SWAP FIRST, then stamp. Stamping markUnlocked/setPinActor before awaiting
      // the token sign-in meant a swap that threw (offline, revoked/expired
      // token, clock skew) left the device marked "unlocked as the new staffer"
      // while Firebase was still the PREVIOUS user — the tablet then ran under
      // one identity but attributed every order to another. Now a failed swap
      // surfaces as { ok:false, swapFailed } so the pad shows a retry instead.
      if (res.token && res.uid !== auth.currentUser?.uid) {
        try {
          const { signInWithCustomToken } = await import('firebase/auth')
          await signInWithCustomToken(auth, res.token)
        } catch (_) {
          return { ok: false, swapFailed: true, error: true }
        }
      }
      markUnlocked(tid)
      setPinActor(tid, { id: res.uid, name: res.name || '' })
      // arm the same-user instant re-unlock for this tab (fire-and-forget)
      rememberQuickUnlock(tid, res.uid, pin)
    }
    return res
  }, [])

  const refreshProfile = useCallback(async () => {
    if (user) await loadContext(user)
  }, [user, loadContext])

  // A STATE UPDATER MUST BE PURE — it was painting the document from inside one.
  //
  // `setTenant(t => { applyBrand(next); return next })` runs during render, not
  // after it. React may call an updater more than once for a single update
  // (StrictMode does so deliberately) and may discard the result of a render it
  // decides not to commit — so the DOM was being written for tenant states that
  // never became real. Around thirty callers in Settings alone go through here.
  //
  // The patch is merged in the pure updater; the paint happens in the effect
  // below, after the state it describes is actually committed.
  const updateTenantLocal = useCallback((patch) => {
    setTenant((t) => ({ ...t, ...patch }))
  }, [])

  // Keyed on the resolved palette rather than the tenant object, so the ~30
  // unrelated local patches (opening hours, KDS stations, game toggles) do not
  // each trigger a repaint and a contrast re-measure.
  const brandKey = `${tenant?.themeColor || ''}|${tenant?.themeAccent || ''}|${tenant?.themePreset || ''}`
  useEffect(() => {
    if (tenant) applyBrand(tenant)
  }, [brandKey])

  // A staffer edits their own display name / photo (auth + staff directory).
  const updateMyProfile = useCallback(async ({ displayName, photoUrl }) => {
    const u = auth.currentUser
    if (!u) return
    const authPatch = {}
    if (displayName != null) authPatch.displayName = displayName
    if (photoUrl != null) authPatch.photoURL = photoUrl
    if (Object.keys(authPatch).length) await updateProfile(u, authPatch)
    if (profile?.tenantId) {
      await upsertStaffMember(profile.tenantId, u.uid, {
        ...(displayName != null ? { name: displayName } : {}),
        ...(photoUrl != null ? { photoUrl } : {}),
      })
    }
    await loadContext(u)
  }, [profile, loadContext])

  // A staffer changes their own password (re-auth with current password if required).
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const u = auth.currentUser
    if (!u) throw new Error('no-user')
    try {
      await updatePassword(u, newPassword)
    } catch (e) {
      if (e?.code === 'auth/requires-recent-login') {
        if (!currentPassword) throw e
        await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, currentPassword))
        await updatePassword(u, newPassword)
      } else throw e
    }
  }, [])

  const value = {
    user,
    profile,
    tenant,
    role: profile?.role || null,
    tenantId: profile?.tenantId || null,
    isManager: ['owner', 'manager'].includes(profile?.role),
    isPlatformAdmin,
    staffCaps,
    can: (cap) => effectiveCan(profile?.role, staffCaps, cap, tenant?.roleCaps),
    loading,
    firebaseReady,
    signup,
    login,
    logout,
    pinLogin,
    refreshProfile,
    updateTenantLocal,
    // These were defined but never exported — every staff photo upload and
    // password change crashed on `undefined is not a function`.
    updateMyProfile,
    changePassword,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
