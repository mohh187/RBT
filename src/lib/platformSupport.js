// Support tooling data layer — canned responses, support tags & SLA config.
// Platform-only collections/docs (guarded by firestore.rules isPlatformAdmin()).
// Consumed by the chat/issues screens (canned replies + tags) and the
// SupportTools screen (SLA settings + breach detection on open tickets).
import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase.js'

const list = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))

// ---------- canned responses (top-level: platformCannedResponses) ----------
export function watchCanned(cb) {
  const q = query(collection(db, 'platformCannedResponses'), orderBy('title'))
  return onSnapshot(
    q,
    (s) => cb(list(s)),
    () => cb([]),
  )
}

// id null/undefined → create; otherwise upsert/merge an existing response.
export async function saveCanned(id, { title, body }) {
  const data = {
    title: String(title || '').slice(0, 120),
    body: String(body || '').slice(0, 2000),
    updatedAt: serverTimestamp(),
  }
  if (id) {
    await setDoc(doc(db, 'platformCannedResponses', id), data, { merge: true })
    return id
  }
  const ref = await addDoc(collection(db, 'platformCannedResponses'), {
    ...data,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function deleteCanned(id) {
  await deleteDoc(doc(db, 'platformCannedResponses', id))
}

// ---------- support config (platformConfig/support doc) ----------
// { slaMinutes:number, tags:[string] }
const SUPPORT_DOC = () => doc(db, 'platformConfig', 'support')

export async function getSupportConfig() {
  try {
    const snap = await getDoc(SUPPORT_DOC())
    const data = snap.exists() ? snap.data() : {}
    return {
      slaMinutes: Number(data.slaMinutes) || 60,
      tags: Array.isArray(data.tags) ? data.tags : [],
    }
  } catch {
    return { slaMinutes: 60, tags: [] }
  }
}

export async function saveSupportConfig({ slaMinutes, tags }) {
  const patch = { updatedAt: serverTimestamp() }
  if (slaMinutes !== undefined) patch.slaMinutes = Math.max(1, Number(slaMinutes) || 60)
  if (tags !== undefined) {
    patch.tags = (Array.isArray(tags) ? tags : [])
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .slice(0, 40)
  }
  await setDoc(SUPPORT_DOC(), patch, { merge: true })
}

// Live watcher for the config doc (so the screen reacts to concurrent edits).
export function watchSupportConfig(cb) {
  return onSnapshot(
    SUPPORT_DOC(),
    (s) => {
      const data = s.exists() ? s.data() : {}
      cb({
        slaMinutes: Number(data.slaMinutes) || 60,
        tags: Array.isArray(data.tags) ? data.tags : [],
      })
    },
    () => cb({ slaMinutes: 60, tags: [] }),
  )
}

// ---------- SLA breach helper ----------
// Given a ticket createdAt (Firestore Timestamp | Date | ms | ISO string) and
// the target SLA minutes, returns true once the response window has elapsed.
export function isBreached(createdAt, slaMinutes) {
  const mins = Number(slaMinutes)
  if (!mins || mins <= 0) return false
  const d = createdAt?.toDate ? createdAt.toDate() : createdAt ? new Date(createdAt) : null
  if (!d || isNaN(d)) return false
  return Date.now() - d.getTime() > mins * 60000
}

// Minutes elapsed since a ticket was opened (for display), or null.
export function minutesSince(createdAt) {
  const d = createdAt?.toDate ? createdAt.toDate() : createdAt ? new Date(createdAt) : null
  if (!d || isNaN(d)) return null
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 60000))
}
