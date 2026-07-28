// ==================== ONE ALERT PRIMITIVE ====================
// Deduplication was reinvented three separate times in this codebase: the
// `flagged` map in spend.js noteRefusal, the `budgetFired` state in the budget
// breaker, and the signature hash in onErrorReported. Each solved the same
// problem — "do not tell me the same thing forty times" — differently, and
// none of them could auto-resolve.
//
// This is that mechanism, once. Everything that wants to raise an operational
// alarm goes through raise() / resolveNamespace().
//
// THE DOCUMENT IS ONE PER PROBLEM, NOT ONE PER OCCURRENCE. A probe failing 48
// times a day produces a single document with count: 48. That single decision
// is what separates an alert system people read from one they mute.
const { FieldValue } = require('firebase-admin/firestore')

const SEVERITIES = ['info', 'warn', 'high', 'critical']
const sevRank = (s) => Math.max(0, SEVERITIES.indexOf(s))

// How long before an OPEN alert notifies again. Escalating backoff, so a
// problem nobody fixes keeps reminding without becoming wallpaper.
const RENOTIFY_HOURS = { info: 0, warn: 24, high: 6, critical: 2 }
const backoffMs = (severity, notifyCount) => {
  const base = RENOTIFY_HOURS[severity] || 24
  if (!base) return Infinity // info never re-notifies
  // 0h → base → 4x base → daily, capped at a day (critical stays at its base).
  if (severity === 'critical') return base * 3600e3
  const steps = [0, base, base * 4, 24]
  return (steps[Math.min(notifyCount, steps.length - 1)] || 24) * 3600e3
}

// Raise or refresh one alert.
//
//   key      stable identity of the PROBLEM, e.g. 'vendor.meta.quality.9665xxx'
//   ns       namespace for auto-resolution, e.g. 'vendor.meta'
//   action   ONE sentence: what to DO about it. Not optional — an alert that
//            does not say what to do is a notification, and notifications get
//            muted.
//
// Returns { changed, shouldNotify } so the caller can route the notification
// (push / email) without this module needing to know about either.
async function raise(db, { key, ns, source, vendor, severity = 'warn', title, body, action, url, detail }) {
  if (!key || !title) return { changed: false, shouldNotify: false }
  const ref = db.doc(`platformAlerts/${key.replace(/[/\s]+/g, '_')}`)
  const now = Date.now()

  let shouldNotify = false
  let changed = false
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const cur = snap.exists ? (snap.data() || {}) : null

    // A resolved alert that recurs is a NEW incident, not a continuation —
    // otherwise its old count and firstAt would misrepresent the history.
    const reopened = cur && cur.status === 'resolved'
    const escalated = cur && cur.status !== 'resolved' && sevRank(severity) > sevRank(cur.severity)
    const isNew = !cur || reopened

    const notifyCount = isNew ? 0 : (Number(cur.notifyCount) || 0)
    const nextAt = Number(cur && cur.nextNotifyAt) || 0
    // Notify on: first sighting, reopen, escalation, or the backoff elapsing.
    shouldNotify = isNew || escalated || (cur.status === 'open' && now >= nextAt)
    changed = isNew || escalated || (cur && cur.status === 'resolved')

    const patch = {
      key, ns: ns || '', source: source || 'probe', vendor: vendor || null,
      severity: escalated || isNew ? severity : cur.severity,
      status: 'open',
      title, body: body || '', action: action || '', url: url || null,
      detail: detail || {},
      lastAt: FieldValue.serverTimestamp(),
      count: isNew ? 1 : (Number(cur.count) || 0) + 1,
      ...(isNew ? { firstAt: FieldValue.serverTimestamp(), ackedBy: null, ackedAt: null, resolvedAt: null } : {}),
    }
    if (shouldNotify) {
      patch.notifiedAt = FieldValue.serverTimestamp()
      patch.notifyCount = notifyCount + 1
      patch.nextNotifyAt = now + backoffMs(patch.severity, notifyCount + 1)
    }
    tx.set(ref, patch, { merge: true })
  }).catch(() => { /* an alert that cannot be written must not break its caller */ })

  return { changed, shouldNotify }
}

// Close every OPEN alert in a namespace whose key is NOT in `liveKeys`.
//
// This is what makes the board trustworthy: each probe reports the COMPLETE
// set of things currently wrong in its namespace, and anything absent is
// fixed. «Meshy balance low» disappears by itself when the balance is topped
// up. An alert you cannot clear by fixing its cause is an alert nobody reads.
async function resolveNamespace(db, ns, liveKeys) {
  if (!ns) return 0
  const live = new Set((liveKeys || []).map((k) => String(k).replace(/[/\s]+/g, '_')))
  const snap = await db.collection('platformAlerts')
    .where('ns', '==', ns).where('status', 'in', ['open', 'acked']).get().catch(() => null)
  if (!snap || snap.empty) return 0
  let closed = 0
  for (const d of snap.docs) {
    if (live.has(d.id)) continue
    await d.ref.set({
      status: 'resolved', resolvedAt: FieldValue.serverTimestamp(), autoResolved: true,
    }, { merge: true }).catch(() => {})
    closed += 1
  }
  return closed
}

// A probe that cannot RUN is itself an alert.
//
// This is the rule most monitoring gets wrong. If the Meta probe dies on an
// expired token, the ABSENCE of a quality alert looks exactly like health.
// Silence must never render as green — so every probe stamps its own liveness
// and a stale stamp raises its own alarm.
async function stampProbe(db, name, ok, error) {
  await db.doc('platformHealth/current').set({
    probes: {
      [name]: {
        lastRunAt: FieldValue.serverTimestamp(),
        ...(ok ? { lastOkAt: FieldValue.serverTimestamp(), lastError: null, consecutiveFailures: 0 } : {}),
        ...(ok ? {} : { lastError: String(error || 'failed').slice(0, 300), consecutiveFailures: FieldValue.increment(1) }),
      },
    },
    at: FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => {})
}

module.exports = { raise, resolveNamespace, stampProbe, SEVERITIES }
