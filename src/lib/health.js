// Client access to the health board and the operational alert feed.
// Modelled on src/lib/spend.js — including its error-callback rule: a read
// failure renders an EMPTY state, never a spinner that runs forever.
import { collection, doc, onSnapshot, orderBy, query, updateDoc, where, limit, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase.js'

export const SEVERITY_AR = { info: 'معلومة', warn: 'تحذير', high: 'مهم', critical: 'حرج' }
export const SEVERITY_ORDER = { critical: 0, high: 1, warn: 2, info: 3 }
export const SEVERITY_BADGE = { critical: 'badge-danger', high: 'badge-danger', warn: 'badge-warning', info: '' }

// A probe is STALE when it has not reported for 3x its interval. The probe
// runs every 30 minutes, so 90 minutes of silence means the probe itself is
// broken — and silence must never render as green.
const STALE_MS = 90 * 60 * 1000
export const isStale = (lastRunAt) => {
  const ms = lastRunAt?.toMillis ? lastRunAt.toMillis() : Number(lastRunAt) || 0
  return !ms || (Date.now() - ms) > STALE_MS
}

export function watchHealth(cb) {
  return onSnapshot(
    doc(db, 'platformHealth', 'current'),
    (s) => cb(s.exists() ? s.data() : null),
    () => cb(null),
  )
}

export function watchJobs(cb) {
  return onSnapshot(doc(db, 'platformHealth', 'jobs'), (s) => cb(s.exists() ? s.data() : null), () => cb(null))
}

export function watchAlerts(cb, { max = 100 } = {}) {
  const q = query(
    collection(db, 'platformAlerts'),
    where('status', 'in', ['open', 'acked']),
    orderBy('lastAt', 'desc'),
    limit(max),
  )
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]))
}

// Acknowledge only — the rules pin exactly these keys, so the update cannot be
// repurposed to rewrite an alert's severity or body after the fact.
export async function ackAlert(id, by) {
  await updateDoc(doc(db, 'platformAlerts', id), {
    status: 'acked', ackedBy: by || '', ackedAt: serverTimestamp(),
  })
}

// One overall verdict. Deliberately blunt: if anything critical is open, or a
// probe has gone quiet, the platform is not "ok".
export function overallOf(health, alerts) {
  const crit = (alerts || []).filter((a) => a.severity === 'critical' && a.status === 'open').length
  const high = (alerts || []).filter((a) => a.severity === 'high' && a.status === 'open').length
  const probes = (health && health.probes) || {}
  const staleProbes = Object.entries(probes).filter(([, p]) => isStale(p.lastRunAt)).map(([k]) => k)
  if (crit > 0) return { level: 'down', ar: 'يوجد خلل حرج', crit, high, staleProbes }
  if (high > 0 || staleProbes.length) return { level: 'degraded', ar: 'يحتاج انتباهك', crit, high, staleProbes }
  return { level: 'ok', ar: 'كل شيء يعمل', crit: 0, high: 0, staleProbes: [] }
}
