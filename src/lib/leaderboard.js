// Firestore layer for the «صياد البحر» monthly leaderboard.
//
// Path:   tenants/{tid}/gameScores/{deviceId}_{month}
// Doc:    { name, score, deviceId, at (serverTimestamp), month:'YYYY-MM' }
//
// The doc id is derived from the device + month, so a device owns exactly ONE
// row per month: submitting is a single read + at most one write, there is no
// way to spam rows, and the monthly reset is just a new id prefix (old months
// stay readable). Rules can therefore key on the id prefix.
import { collection, doc, getDoc, setDoc, updateDoc, onSnapshot, query, where, limit, serverTimestamp } from 'firebase/firestore'
import { db, firebaseReady } from './firebase.js'

// A month holds one row per device; realistic venues stay far below this. The
// cap keeps the listener cheap and bounded instead of streaming a whole year.
const MAX_ROWS = 300
export const TOP_N = 20
const MAX_SCORE = 100000
const MAX_NAME = 24

const col = (tid) => collection(db, 'tenants', tid, 'gameScores')
const rowId = (deviceId, month) => `${String(deviceId || '').replace(/[^A-Za-z0-9_-]/g, '')}_${month}`

// 'YYYY-MM' in the venue's local time (en-CA gives Latin digits + ISO order).
export function currentMonth(d = new Date()) {
  return d.toLocaleDateString('en-CA').slice(0, 7)
}

export function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
}

function sanitizeScore(score) {
  const n = Math.floor(Number(score))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, MAX_SCORE)
}

// Write only when this device actually beat its own best for the month (or is
// renaming an existing row). Read-then-write: one getDoc, then at most one set.
// Returns { written, best, reason }.
export async function submitScore(tid, { name = '', score = 0, deviceId = '' } = {}) {
  if (!firebaseReady || !tid || !deviceId) return { written: false, best: 0, reason: 'unavailable' }
  const s = sanitizeScore(score)
  const month = currentMonth()
  const ref = doc(col(tid), rowId(deviceId, month))
  const snap = await getDoc(ref)
  const prev = snap.exists() ? snap.data() : null
  const best = Math.max(sanitizeScore(prev?.score), s)
  const nm = cleanName(name)
  const nameChanged = nm && nm !== (prev?.name || '')

  if (prev && s <= sanitizeScore(prev.score) && !nameChanged) {
    return { written: false, best, reason: 'not-a-record' }
  }
  await setDoc(ref, {
    name: nm || prev?.name || '',
    score: best,
    deviceId: String(deviceId),
    month,
    at: serverTimestamp(),
  }, { merge: true })
  return { written: true, best, reason: prev ? (s > sanitizeScore(prev.score) ? 'new-record' : 'renamed') : 'first' }
}

// Rename an existing row without touching the score. No-op when the device has
// not played this month yet (there is nothing to name).
export async function setPlayerName(tid, { name = '', deviceId = '' } = {}) {
  if (!firebaseReady || !tid || !deviceId) return false
  const nm = cleanName(name)
  if (!nm) return false
  const ref = doc(col(tid), rowId(deviceId, currentMonth()))
  const snap = await getDoc(ref)
  if (!snap.exists()) return false
  await updateDoc(ref, { name: nm, at: serverTimestamp() })
  return true
}

// Live monthly board. cb({ scores, top, truncated, error }):
//   scores   full list sorted by score desc (capped at MAX_ROWS)
//   top      the first TOP_N of it
//   error    null, or an Arabic message when the listener failed
// Sorting is done client-side over an equality-only query on purpose: it needs
// NO composite index, and the full list is required anyway to show a rank that
// falls outside the top TOP_N.
export function watchTopScores(tid, month, cb) {
  if (!firebaseReady || !tid) {
    cb?.({ scores: [], top: [], truncated: false, error: 'unavailable' })
    return () => {}
  }
  const m = month || currentMonth()
  const q = query(col(tid), where('month', '==', m), limit(MAX_ROWS))
  return onSnapshot(
    q,
    (s) => {
      const scores = s.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .map((x) => ({ ...x, score: sanitizeScore(x.score) }))
        .sort((a, b) => b.score - a.score || String(a.name || '').localeCompare(String(b.name || '')))
      cb?.({ scores, top: scores.slice(0, TOP_N), truncated: s.size >= MAX_ROWS, error: null })
    },
    (err) => {
      cb?.({ scores: [], top: [], truncated: false, error: String(err?.code || err?.message || 'error') })
    },
  )
}

// 1-based rank of this device inside an already-sorted list, or null.
export function myRank(scores, deviceId) {
  if (!deviceId || !Array.isArray(scores)) return null
  const i = scores.findIndex((s) => s.deviceId === deviceId)
  return i < 0 ? null : { rank: i + 1, entry: scores[i], total: scores.length }
}
