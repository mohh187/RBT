// Venue-side custom-domain flow: a manager requests a hostname (status 'pending'),
// then the platform activates it once DNS + SSL are ready. Firestore rules let a
// manager CREATE a pending domain and DELETE its own pending one, but never
// self-activate — so a venue can't hijack a hostname.
import { db } from './firebase.js'
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore'
import { normHost, isPlatformHost, DOMAIN_CNAME_TARGET } from './domains.js'

// All domains mapped to one venue (live).
export function watchVenueDomains(tenantId, cb) {
  if (!tenantId) { cb([]); return () => {} }
  const q = query(collection(db, 'domains'), where('tenantId', '==', tenantId))
  return onSnapshot(q, (s) => {
    const list = s.docs.map((d) => ({ id: d.id, ...d.data() }))
    list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    cb(list)
  }, () => cb([]))
}

// Request a custom hostname for a venue (created as 'pending' — platform activates).
export async function requestDomain(host, { tenantId, slug, type = 'custom' }) {
  const h = normHost(host)
  if (!h || !tenantId) throw new Error('host and tenantId required')
  if (isPlatformHost(h)) throw new Error('platform-host')
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) throw new Error('invalid-host')
  await setDoc(doc(db, 'domains', h), {
    tenantId,
    slug: slug || '',
    type,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return h
}

// Cancel a still-pending request (rules block deleting an active one).
export async function cancelDomainRequest(host) {
  return deleteDoc(doc(db, 'domains', normHost(host)))
}

// Verify the host's CNAME points at our target via DNS-over-HTTPS (Google DoH).
// Returns { ok, answers } — real DNS check, no server round-trip.
export async function verifyDomainDns(host) {
  const h = normHost(host)
  const target = DOMAIN_CNAME_TARGET
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(h)}&type=CNAME`, { headers: { accept: 'application/dns-json' } })
    const j = await r.json()
    const answers = (j.Answer || []).map((a) => String(a.data || '').replace(/\.$/, '').toLowerCase())
    const ok = answers.some((a) => a === target || a.endsWith(`.${target}`) || a.endsWith(target))
    return { ok, answers, target }
  } catch {
    return { ok: false, answers: [], target }
  }
}
