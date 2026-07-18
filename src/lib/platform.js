// Platform console data layer — cross-venue oversight for platform admins.
// Access is granted by firestore.rules ONLY when platformAdmins/{uid} exists
// (created manually via Firebase Console / Admin SDK — never from the client).
// Per-venue deep data (orders/staff/customers…) reuses the tenant-scoped
// watchers in db.js: pass any tid, rules allow platform admins through.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  getCountFromServer,
} from 'firebase/firestore'
import { db, app, auth, functions } from './firebase.js'

const list = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))

// ---------- membership ----------
export async function checkPlatformAdmin(uid) {
  if (!uid) return false
  try {
    const snap = await getDoc(doc(db, 'platformAdmins', uid))
    return snap.exists()
  } catch {
    return false
  }
}

// ---------- venues (tenants) ----------
export function watchAllTenants(cb) {
  return onSnapshot(collection(db, 'tenants'), (s) => {
    const rows = list(s)
    rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    cb(rows)
  }, () => cb([]))
}
export function watchTenantDoc(tid, cb) {
  return onSnapshot(doc(db, 'tenants', tid), (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null), () => cb(null))
}
// Full subscription control (plan / status / expiry) — platform-owned fields.
export async function setTenantPlan(tid, { plan, planStatus, planExpiresAt }) {
  const patch = { updatedAt: serverTimestamp() }
  if (plan !== undefined) patch.plan = plan
  if (planStatus !== undefined) patch.planStatus = planStatus
  if (planExpiresAt !== undefined) patch.planExpiresAt = planExpiresAt
  await updateDoc(doc(db, 'tenants', tid), patch)
}
// Suspend / re-activate a venue account.
export async function setTenantActive(tid, active, reason = '') {
  await updateDoc(doc(db, 'tenants', tid), {
    active: !!active,
    suspendReason: active ? '' : reason,
    updatedAt: serverTimestamp(),
  })
}
export async function platformUpdateTenant(tid, patch) {
  await updateDoc(doc(db, 'tenants', tid), { ...patch, updatedAt: serverTimestamp() })
}
// Cheap aggregate counts for the venue 360° view.
export async function countSub(tid, name, ...clauses) {
  try {
    const col = collection(db, 'tenants', tid, name)
    const q = clauses.length ? query(col, ...clauses) : col
    const snap = await getCountFromServer(q)
    return snap.data().count
  } catch {
    return null
  }
}
export const countOpenComplaints = (tid) => countSub(tid, 'complaints', where('status', '==', 'open'))

// ---------- activity feed (written by Cloud Functions only) ----------
export function watchActivity(cb, { tenantId = null, max = 100 } = {}) {
  const col = collection(db, 'platformActivity')
  const q = tenantId
    ? query(col, where('tenantId', '==', tenantId), orderBy('at', 'desc'), limit(max))
    : query(col, orderBy('at', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(list(s)), () => cb([]))
}

// Live cross-venue "today" pulse: every order lands in the feed with its amount.
export function watchTodayOrderActivity(cb, max = 1000) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const q = query(
    collection(db, 'platformActivity'),
    where('kind', '==', 'order'),
    where('at', '>=', start),
    orderBy('at', 'desc'),
    limit(max),
  )
  return onSnapshot(q, (s) => cb(list(s)), () => cb([]))
}

// ---------- error reports (code monitoring) ----------
export function watchErrors(cb, max = 100) {
  const q = query(collection(db, 'platformErrors'), orderBy('at', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(list(s)), () => cb([]))
}
export async function updateError(id, patch) {
  await updateDoc(doc(db, 'platformErrors', id), patch)
}
export async function deleteError(id) {
  await deleteDoc(doc(db, 'platformErrors', id))
}

// ---------- support tickets / issues ----------
export function watchIssues(cb, { tenantId = null, max = 100 } = {}) {
  const col = collection(db, 'platformIssues')
  const q = tenantId
    ? query(col, where('tenantId', '==', tenantId), orderBy('createdAt', 'desc'), limit(max))
    : query(col, orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(list(s)), () => cb([]))
}
export async function createIssue({ tenantId, tenantName, title, body, priority = 'normal', createdBy, createdByName }) {
  await addDoc(collection(db, 'platformIssues'), {
    tenantId, tenantName: tenantName || '', title, body: body || '',
    priority, status: 'open', createdBy: createdBy || null, createdByName: createdByName || '',
    createdAt: serverTimestamp(),
  })
}
export async function updateIssue(id, patch) {
  await updateDoc(doc(db, 'platformIssues', id), { ...patch, updatedAt: serverTimestamp() })
}

// ---------- venue ⇄ platform chat (thread id == tenantId) ----------
export function watchChatThreads(cb, max = 200) {
  const q = query(collection(db, 'platformChats'), orderBy('lastAt', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(list(s)), () => cb([]))
}
export function watchChatThread(tid, cb) {
  return onSnapshot(doc(db, 'platformChats', tid), (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null), () => cb(null))
}
export function watchChatMessages(tid, cb, max = 120) {
  const q = query(collection(db, 'platformChats', tid, 'messages'), orderBy('at', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(list(s).reverse()), () => cb([]))
}
// from: 'platform' | 'venue'. Thread meta/unread counters are maintained by the
// onPlatformChatMessage Cloud Function; we only ensure the thread doc exists.
export async function sendChatMessage(tid, { from, uid, name, text, tenantName, fileUrl, fileName, fileType, audioDuration }) {
  const body = String(text || '').trim()
  if (!body && !fileUrl) return
  await setDoc(doc(db, 'platformChats', tid), {
    tenantId: tid,
    ...(tenantName ? { tenantName } : {}),
  }, { merge: true })
  await addDoc(collection(db, 'platformChats', tid, 'messages'), {
    from, uid: uid || null, name: name || '',
    text: body.slice(0, 2000), at: serverTimestamp(),
    ...(fileUrl ? { fileUrl, fileName: fileName || '', fileType: fileType || 'file', audioDuration: audioDuration || null } : {})
  })
}
export async function markThreadRead(tid, side /* 'platform' | 'venue' */) {
  try {
    await setDoc(doc(db, 'platformChats', tid),
      side === 'platform' ? { unreadByPlatform: 0 } : { unreadByVenue: 0 },
      { merge: true })
  } catch { /* thread may not exist yet */ }
}

// ---------- impersonation (support: sign in as a venue's owner) ----------
// Calls the audited platformImpersonate function, then swaps THIS session to
// the owner's account. The caller returns to the platform by logging back in.
export async function impersonateTenantOwner(tid) {
  const { httpsCallable } = await import('firebase/functions')
  const res = await httpsCallable(functions, 'platformImpersonate')({ tid })
  const token = res?.data?.token
  if (!token) throw new Error('no-token')
  const { signInWithCustomToken } = await import('firebase/auth')
  await signInWithCustomToken(auth, token)
}

// ---------- global broadcasts (fan out via Cloud Function) ----------
export async function createBroadcast({ title, body, plan = '', push = true, days = 14 }) {
  await addDoc(collection(db, 'platformBroadcasts'), {
    title: String(title || '').slice(0, 140),
    body: String(body || '').slice(0, 1500),
    plan: plan || null, // null = all plans
    push: !!push,
    days: Number(days) || 14,
    createdAt: serverTimestamp(),
  })
}
export function watchBroadcasts(cb, max = 20) {
  const q = query(collection(db, 'platformBroadcasts'), orderBy('createdAt', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(list(s)), () => cb([]))
}

// ---------- daily rollups ----------
export async function getPlatformStats(dateId) {
  const snap = await getDoc(doc(db, 'platformStats', dateId))
  return snap.exists() ? snap.data() : null
}
export function watchRecentStats(cb, max = 30) {
  const q = query(collection(db, 'platformStats'), orderBy('date', 'desc'), limit(max))
  return onSnapshot(q, (s) => cb(list(s)), () => cb([]))
}

// ---------- platform device push (FCM) ----------
export async function registerPlatformPush(uid) {
  try {
    const VAPID = import.meta.env.VITE_FIREBASE_VAPID_KEY
    if (!app || !VAPID) return false
    if (!('serviceWorker' in navigator)) return false
    if (!('Notification' in window) || Notification.permission !== 'granted') return false
    const { getMessaging, getToken, isSupported } = await import('firebase/messaging')
    if (!(await isSupported())) return false
    const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register('/sw.js'))
    const token = await getToken(getMessaging(app), { vapidKey: VAPID, serviceWorkerRegistration: reg })
    if (!token) return false
    // Key by a hash of the full token so a rotated token overwrites its own doc
    // (rather than accumulating stale duplicates from a 60-char prefix collision).
    let h = 0
    for (let i = 0; i < token.length; i++) { h = (h * 31 + token.charCodeAt(i)) | 0 }
    await setDoc(doc(db, 'platformPushTokens', 'tok_' + (h >>> 0).toString(36)), {
      token, uid: uid || null, ua: navigator.userAgent.slice(0, 160), at: serverTimestamp(),
    })
    return true
  } catch {
    return false
  }
}

// One-shot fetch helpers for the 360° venue view (non-realtime, cheap).
export async function fetchRecentSub(tid, name, field = 'createdAt', max = 10) {
  try {
    const s = await getDocs(query(collection(db, 'tenants', tid, name), orderBy(field, 'desc'), limit(max)))
    return list(s)
  } catch {
    return []
  }
}
