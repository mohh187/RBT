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
    // Auto-join: a signed-in user with no venue who has a pending staff invite gets claimed.
    if (!prof?.tenantId && fbUser.email) {
      try {
        const claimed = await claimInviteFor(fbUser.uid, fbUser.email)
        if (claimed) prof = await getUserProfile(fbUser.uid)
      } catch (_) {
        /* ignore */
      }
    }
    setProfile(prof)
    setMonitorContext({ uid: fbUser.uid, tenantId: prof?.tenantId || null })
    if (prof?.tenantId) {
      const t = await getTenant(prof.tenantId)
      setTenant(t)
      applyBrand(t)
      setMonitorContext({ tenantName: t?.name || '' })
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

  const refreshProfile = useCallback(async () => {
    if (user) await loadContext(user)
  }, [user, loadContext])

  const updateTenantLocal = useCallback((patch) => {
    setTenant((t) => {
      const next = { ...t, ...patch }
      applyBrand(next)
      return next
    })
  }, [])

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
