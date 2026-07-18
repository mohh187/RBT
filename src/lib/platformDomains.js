// Platform data layer for per-venue domains (domains/{hostname}). The platform
// maps a hostname to a venue and activates it once DNS + SSL are ready.
import { db } from './firebase.js'
import { collection, doc, setDoc, deleteDoc, updateDoc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore'

const list = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))
const norm = (host) => String(host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')

export function watchDomains(cb) {
  try {
    return onSnapshot(query(collection(db, 'domains'), orderBy('createdAt', 'desc')), (s) => cb(list(s)), () => cb([]))
  } catch {
    return onSnapshot(collection(db, 'domains'), (s) => cb(list(s)), () => cb([]))
  }
}

// Map a hostname → venue. type: 'subdomain' | 'custom'. status defaults active
// (platform is trusted; DNS/SSL are done out of band before mapping).
export async function saveDomain(host, { tenantId, slug, type = 'custom', status = 'active' }) {
  const h = norm(host)
  if (!h || !tenantId) throw new Error('host and tenantId required')
  await setDoc(doc(db, 'domains', h), {
    tenantId, slug: slug || '', type, status,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }, { merge: true })
  return h
}
export async function setDomainStatus(host, status) {
  await updateDoc(doc(db, 'domains', norm(host)), { status, updatedAt: serverTimestamp() })
}
export async function deleteDomain(host) {
  await deleteDoc(doc(db, 'domains', norm(host)))
}
