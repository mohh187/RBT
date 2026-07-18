// Compliance & data-governance data layer for the platform console.
// Owns three platform-only collections/docs:
//   - platformConsent : audit log of consent/agreement records per venue
//   - platformExports : ready-to-download venue data exports (written by the
//                       requestVenueExport Cloud Function when it finishes)
//   - platformConfig/retention : data-retention policy (activity/error days)
// Firestore rules for platformConsent + platformExports are provided by the
// backend bundle (platform-admin only). This module never edits shared files.
import {
  collection,
  doc,
  addDoc,
  getDoc,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from './firebase.js'

// ---------- consent log ----------

// Live subscription to the consent audit log (newest first).
export function watchConsents(cb) {
  const q = query(collection(db, 'platformConsent'), orderBy('at', 'desc'), limit(300))
  return onSnapshot(
    q,
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => cb([]),
  )
}

// Record a consent/agreement event (kind e.g. "dpa" | "privacy" | "marketing").
export async function recordConsent({ tenantId, kind, by }) {
  return addDoc(collection(db, 'platformConsent'), {
    tenantId: tenantId || null,
    kind: kind || 'general',
    by: by || null,
    at: serverTimestamp(),
  })
}

// ---------- data export ----------

// Trigger a full data export for a venue via the Cloud Function. The function
// gathers the venue's data and writes a platformExports doc when it's ready.
export async function requestExport(tid) {
  const fn = httpsCallable(functions, 'requestVenueExport')
  const res = await fn({ tenantId: tid })
  return res?.data || null
}

// Live subscription to ready/pending exports (newest first).
export function watchExports(cb) {
  const q = query(collection(db, 'platformExports'), orderBy('createdAt', 'desc'), limit(200))
  return onSnapshot(
    q,
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => cb([]),
  )
}

// ---------- PII masking ----------

// Pure util: mask a phone/email-ish string keeping the first 2 + last 2 chars.
// "0551234567" -> "05••••••67" ; "moh.idris@x.com" masks local + domain parts.
export function maskPII(str) {
  const s = String(str == null ? '' : str)
  if (!s) return ''
  // Email: mask the local part and the domain name, keep structure + TLD.
  const at = s.indexOf('@')
  if (at > 0) {
    const local = s.slice(0, at)
    const domain = s.slice(at + 1)
    const dot = domain.lastIndexOf('.')
    const host = dot > 0 ? domain.slice(0, dot) : domain
    const tld = dot > 0 ? domain.slice(dot) : ''
    return `${maskCore(local)}@${maskCore(host)}${tld}`
  }
  return maskCore(s)
}

// Keep first 2 + last 2 visible, mask the middle. Short strings mask fully.
function maskCore(s) {
  const str = String(s)
  if (str.length <= 4) return '•'.repeat(str.length)
  const head = str.slice(0, 2)
  const tail = str.slice(-2)
  return head + '•'.repeat(str.length - 4) + tail
}

// ---------- retention policy ----------

const RETENTION_DOC = () => doc(db, 'platformConfig', 'retention')

// Defaults so the editor renders before the doc exists; the cleanup Cloud
// Function reads the same doc and falls back to these numbers.
export const DEFAULT_RETENTION = { activityDays: 90, errorDays: 30 }

function normalizeRetention(data) {
  const d = data || {}
  const activityDays = Number(d.activityDays)
  const errorDays = Number(d.errorDays)
  return {
    activityDays: Number.isFinite(activityDays) && activityDays > 0 ? activityDays : DEFAULT_RETENTION.activityDays,
    errorDays: Number.isFinite(errorDays) && errorDays > 0 ? errorDays : DEFAULT_RETENTION.errorDays,
  }
}

// One-shot read of the retention policy (merged with defaults).
export async function getRetentionConfig() {
  try {
    const snap = await getDoc(RETENTION_DOC())
    return normalizeRetention(snap.exists() ? snap.data() : null)
  } catch {
    return { ...DEFAULT_RETENTION }
  }
}

// Merge-save the retention policy ({activityDays, errorDays}).
export async function saveRetentionConfig({ activityDays, errorDays }) {
  await setDoc(
    RETENTION_DOC(),
    {
      activityDays: Number(activityDays) || DEFAULT_RETENTION.activityDays,
      errorDays: Number(errorDays) || DEFAULT_RETENTION.errorDays,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}
