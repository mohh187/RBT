// Staff security functions:
//
// 1) PIN verification moved SERVER-SIDE. The 4-digit staff PIN used to be
//    stored as SHA-256(`tid:pin`) on tenants/{tid}/staff/{uid} — a doc every
//    coworker can read. 10,000 candidates against an unsalted fast hash is a
//    spreadsheet exercise: any staffer could recover any manager's PIN
//    offline and stamp actions in their name. PINs now live in
//    tenants/{tid}/staffPins/{uid} (client read/write DENIED by rules),
//    hashed with scrypt + a per-record random salt, verified only through
//    the verifyStaffPin callable, which also rate-limits attempts.
//
// 2) Legacy migration: migrateStaffPins moves any old staff-doc pinHash into
//    staffPins immediately (keeping the legacy digest until the staffer's
//    first successful unlock upgrades it to scrypt) and DELETES the
//    peer-readable copy.
//
// 3) Caps-mirror seeding: firestore.rules read granular permissions from
//    staff/{uid}.caps, but that mirror used to be written only when a MANAGER
//    loaded the admin (healStaffCapsMirrors) — a freshly-invited staffer was
//    locked out of their delegated screens until a manager happened to
//    reload. onStaffDocCreated seeds the mirror the moment the staff doc
//    appears.
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const logger = require('firebase-functions/logger')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')
const crypto = require('crypto')

const db = () => getFirestore()

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
async function memberOf(uid, tenantId) {
  if (!uid || !tenantId) return null
  const snap = await db().doc(`users/${uid}`).get()
  if (!snap.exists) return null
  const d = snap.data() || {}
  return d.tenantId === tenantId ? d : null
}

const isManagerRole = (role) => role === 'owner' || role === 'manager'

const scrypt = (pin, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(String(pin), salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key.toString('hex'))))
})

const legacySha256 = (tenantId, pin) => crypto.createHash('sha256').update(`${tenantId}:${pin}`).digest('hex')

const safeEqualHex = (a, b) => {
  try {
    const ba = Buffer.from(String(a || ''), 'hex')
    const bb = Buffer.from(String(b || ''), 'hex')
    return ba.length > 0 && ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
  } catch (_) {
    return false
  }
}

const MAX_FAILS = 5
const LOCK_MS = 60 * 1000

// ---------------------------------------------------------------------------
// verifyPinCore — the one PIN check everything routes through.
// { count:false } = probe mode (the pinSignIn roster scan): a mismatch is
// EXPECTED there and must not charge that staffer's fail counter; a locked
// record is treated as no-match (never a lock bypass).
// ---------------------------------------------------------------------------
async function verifyPinCore(tenantId, staffId, pin, { count = true } = {}) {
  const pinRef = db().doc(`tenants/${tenantId}/staffPins/${staffId}`)
  const staffRef = db().doc(`tenants/${tenantId}/staff/${staffId}`)
  const now = Date.now()

  const pinSnap = await pinRef.get()
  let rec = pinSnap.exists ? (pinSnap.data() || {}) : null

  // Legacy fallback: PIN still sitting on the staff doc (pre-migration).
  // Adopt it into staffPins on the spot so the counter/lock apply to it too,
  // and strip the peer-readable copy.
  if (!rec || (!rec.hash && !rec.legacySha256)) {
    const staffSnap = await staffRef.get()
    const legacy = staffSnap.exists ? (staffSnap.data() || {}).pinHash : null
    if (!legacy) return { ok: false, none: true }
    rec = { legacySha256: legacy, failCount: 0, lockedUntil: 0 }
    await pinRef.set(rec, { merge: true })
    await staffRef.set({ pinHash: FieldValue.delete(), hasPin: true }, { merge: true })
  }

  if ((rec.lockedUntil || 0) > now) {
    return { ok: false, locked: true, waitMs: rec.lockedUntil - now }
  }

  let ok = false
  if (rec.hash && rec.salt) {
    ok = safeEqualHex(await scrypt(pin, rec.salt), rec.hash)
  } else if (rec.legacySha256) {
    ok = safeEqualHex(legacySha256(tenantId, pin), rec.legacySha256)
    if (ok) {
      // first successful legacy unlock → upgrade to salted scrypt
      const salt = crypto.randomBytes(16).toString('hex')
      await pinRef.set({ hash: await scrypt(pin, salt), salt, legacySha256: FieldValue.delete() }, { merge: true })
    }
  }

  if (ok) {
    await pinRef.set({ failCount: 0, lockedUntil: 0, lastOkAt: now }, { merge: true })
    return { ok: true }
  }
  if (!count) return { ok: false }
  // Atomic per-staff fail charge (was a racy read-modify-write on rec.failCount).
  const r = await db().runTransaction(async (tx) => {
    const s = await tx.get(pinRef)
    const cur = s.exists ? (s.data() || {}) : {}
    const fails = (cur.failCount || 0) + 1
    const patch = { failCount: fails, lastFailAt: now }
    if (fails >= MAX_FAILS) { patch.lockedUntil = now + LOCK_MS; patch.failCount = 0 }
    tx.set(pinRef, patch, { merge: true })
    return { locked: fails >= MAX_FAILS }
  })
  return { ok: false, locked: r.locked, waitMs: r.locked ? LOCK_MS : 0 }
}

// ---------------------------------------------------------------------------
// verifyStaffPin({ tenantId, staffId, pin }) → { ok, locked?, waitMs? }
// Caller: any signed-in member of the tenant (the shared device's session).
// LEGACY overlay-unlock path — kept one release for stale clients; new clients
// use pinSignIn below, which actually switches the session.
// ---------------------------------------------------------------------------
exports.verifyStaffPin = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign in first')
  const { tenantId, staffId, pin } = request.data || {}
  if (!tenantId || !staffId || !/^\d{4}$/.test(String(pin || ''))) {
    throw new HttpsError('invalid-argument', 'tenantId, staffId and a 4-digit pin are required')
  }
  if (!(await memberOf(uid, tenantId))) throw new HttpsError('permission-denied', 'not a member of this venue')
  return verifyPinCore(tenantId, staffId, pin, { count: true })
})

// ---------------------------------------------------------------------------
// PIN-only sign-in: the PIN itself identifies the staffer and opens THEIR real
// Firebase session (custom token → signInWithCustomToken client-side).
//
//   staffPins/_meta   → { secret, failCount, lockedUntil }   tenant-wide
//   staffPins/_lookup → { pins: { hmac(secret, pin) → uid } } uniqueness index
//
// Both are client-unreadable (rules deny all of staffPins/*). UNAUTHENTICATED
// by design — this IS the cold-start login for a wiped tablet. Brute force is
// bounded twice: per-staff scrypt fail counters (verifyPinCore) and a
// tenant-wide counter here (10 misses → 120s freeze for the whole pad).
// App Check is not configured in this project; when it is, add enforcement.
// ---------------------------------------------------------------------------
const TENANT_MAX_FAILS = 10
const TENANT_LOCK_MS = 120 * 1000
// Rolling ATTEMPT limiter (counts every call, success or fail), charged in a
// transaction BEFORE any verification. The old flow read lockedUntil outside
// any transaction and only charged fails at the very end — N parallel calls
// all saw "unlocked" and every one ran a full roster scrypt scan, so a
// concurrent burst both bypassed the freeze entirely (≈9000 guesses/hour
// against a 4-digit space) and burned one scrypt per staffer per guess on the
// venue's bill. A transaction serializes admission on the meta doc: parallel
// or not, at most 30 verifications happen per 2 minutes. 30 is roomy for a
// whole venue's real logins; it caps an attacker at ~900/hour (~11 hours
// expected per 5-staff venue, behind a visible lock the whole time).
const TENANT_MAX_ATTEMPTS = 30
const TENANT_ATTEMPT_WINDOW_MS = 120 * 1000
const RESERVED_PIN_DOCS = new Set(['_meta', '_lookup'])

async function admitPinAttempt(metaRef, now) {
  return db().runTransaction(async (tx) => {
    const s = await tx.get(metaRef)
    const cur = s.exists ? (s.data() || {}) : {}
    if ((cur.lockedUntil || 0) > now) return { admitted: false, waitMs: cur.lockedUntil - now }
    let start = cur.attemptWinStart || 0
    let count = cur.attemptCount || 0
    if (now - start > TENANT_ATTEMPT_WINDOW_MS) { start = now; count = 0 }
    count += 1
    const patch = { attemptWinStart: start, attemptCount: count }
    if (count > TENANT_MAX_ATTEMPTS) {
      patch.lockedUntil = now + TENANT_LOCK_MS
      patch.attemptCount = 0
      tx.set(metaRef, patch, { merge: true })
      return { admitted: false, waitMs: TENANT_LOCK_MS }
    }
    tx.set(metaRef, patch, { merge: true })
    return { admitted: true }
  })
}

const hmacPin = (secret, pin) => crypto.createHmac('sha256', String(secret)).update(String(pin)).digest('hex')

async function getPinMeta(tenantId) {
  const ref = db().doc(`tenants/${tenantId}/staffPins/_meta`)
  const snap = await ref.get()
  const meta = snap.exists ? (snap.data() || {}) : {}
  if (!meta.secret) {
    // CREATE-ONCE, transactionally. Two concurrent first-ever PIN calls each
    // reading "no secret" and generating a DIFFERENT random secret would orphan
    // the _lookup entries written under the losing secret. The transaction makes
    // exactly one secret win and every caller adopt it.
    meta.secret = await db().runTransaction(async (tx) => {
      const s = await tx.get(ref)
      const existing = s.exists ? (s.data() || {}).secret : null
      if (existing) return existing
      const fresh = crypto.randomBytes(32).toString('hex')
      tx.set(ref, { secret: fresh }, { merge: true })
      return fresh
    })
  }
  return { ref, meta }
}

// Atomic tenant-wide fail charge (read-modify-write on failCount races under
// concurrent unauthenticated guesses, letting N parallel wrong PINs advance the
// counter by ~1 and defeating the freeze). One transaction per charge.
async function bumpTenantFail(metaRef, now) {
  return db().runTransaction(async (tx) => {
    const s = await tx.get(metaRef)
    const cur = s.exists ? (s.data() || {}) : {}
    const fails = (cur.failCount || 0) + 1
    const patch = { failCount: fails, lastFailAt: now }
    if (fails >= TENANT_MAX_FAILS) { patch.lockedUntil = now + TENANT_LOCK_MS; patch.failCount = 0 }
    tx.set(metaRef, patch, { merge: true })
    return { locked: fails >= TENANT_MAX_FAILS, waitMs: fails >= TENANT_MAX_FAILS ? TENANT_LOCK_MS : 0 }
  })
}

exports.pinSignIn = onCall({ region: 'us-central1' }, async (request) => {
  const { tenantId, pin, staffId } = request.data || {}
  // Warm-up ping from the lock screen's FIRST keypad digit: answer before any
  // validation or DB work so a cold container is booted (and billed sub-100ms)
  // while the staffer types the remaining three digits.
  if ((request.data || {}).warm) return { ok: false, warm: true }
  if (!tenantId || !/^\d{4}$/.test(String(pin || ''))) {
    throw new HttpsError('invalid-argument', 'tenantId and a 4-digit pin are required')
  }
  const now = Date.now()
  // Real venues only: without this, any string became a tenantId and the call
  // wrote _meta docs (secret + counters) at arbitrary unauthenticated paths.
  const tenantSnap = await db().doc(`tenants/${tenantId}`).get()
  if (!tenantSnap.exists) return { ok: false, locked: false, waitMs: 0 }
  const { ref: metaRef, meta } = await getPinMeta(tenantId)
  // Transactional admission — the ONLY gate; see admitPinAttempt.
  const gate = await admitPinAttempt(metaRef, now)
  if (!gate.admitted) return { ok: false, locked: true, waitMs: gate.waitMs }
  const lookupRef = db().doc(`tenants/${tenantId}/staffPins/_lookup`)

  const finish = async (uid) => {
    const staffSnap = await db().doc(`tenants/${tenantId}/staff/${uid}`).get()
    const sd = staffSnap.exists ? (staffSnap.data() || {}) : null
    if (!sd || sd.active === false) return { ok: false, inactive: true }
    // membership integrity — the mapped uid must genuinely belong to this venue
    const userSnap = await db().doc(`users/${uid}`).get()
    if (!userSnap.exists || (userSnap.data() || {}).tenantId !== tenantId) return { ok: false, inactive: true }
    await metaRef.set({ failCount: 0, lockedUntil: 0 }, { merge: true }).catch(() => {})
    await staffSnap.ref.set({ lastPinLoginAt: now }, { merge: true }).catch(() => {})
    // Minting a custom token requires the runtime service account to hold
    // "Service Account Token Creator" (iam.serviceAccounts.signBlob). Without it
    // createCustomToken throws and the callable 500s with an opaque message — so
    // catch it, LOG the real cause for the owner, and return a distinguishable
    // {config:true} the lock screen turns into "server not configured" rather
    // than a misleading "wrong PIN".
    let token
    try {
      token = await getAuth().createCustomToken(uid)
    } catch (e) {
      logger.error('pinSignIn: createCustomToken failed — grant the functions runtime service account roles/iam.serviceAccountTokenCreator', { code: e && e.code, message: e && e.message })
      return { ok: false, config: true }
    }
    return { ok: true, token, uid, name: sd.name || sd.email || '' }
  }

  // Explicit staffId = the one-time duplicate-PIN disambiguation retry (the code
  // is shared by ≥2 legacy staffers, so it is NOT unique).
  if (staffId) {
    const res = await verifyPinCore(tenantId, staffId, pin, { count: true })
    if (!res.ok) {
      // A single-target brute via staffId must not bypass the venue-wide freeze
      // (it only charged the per-staff counter before). Charge the tenant too.
      if (!res.locked) await bumpTenantFail(metaRef, now).catch(() => {})
      // NORMALIZED shape: verifyPinCore's raw {none:true} ("this uid holds no
      // PIN") was an unauthenticated oracle over which uids have PINs.
      return { ok: false, locked: !!res.locked, waitMs: res.waitMs || 0 }
    }
    // DO NOT seed _lookup here. Writing pins[hash]=staffId for a SHARED code made
    // the fast path resolve everyone who types that PIN to this one staffer — so
    // the other staffer silently signed in as this identity (their uid, caps,
    // order attribution). An ambiguous PIN must keep prompting until a manager
    // makes it unique (setStaffPinSecure enforces uniqueness on the next set).
    return finish(staffId)
  }

  // Fast path: the uniqueness index knows this PIN.
  const lookupSnap = await lookupRef.get()
  const pins = lookupSnap.exists ? ((lookupSnap.data() || {}).pins || {}) : {}
  const h = hmacPin(meta.secret, pin)
  const mapped = pins[h]
  if (mapped) {
    const res = await verifyPinCore(tenantId, mapped, pin, { count: false }) // defense in depth
    if (res.ok) return finish(mapped)
    // A LOCKED record is not a stale mapping — return the lock so a correct PIN
    // on a locked staffer doesn't (a) delete their valid index entry and (b) fall
    // through to the scan and wrongly charge the tenant counter.
    if (res.locked) return res
    // genuinely stale mapping (record changed out-of-band) → drop it, then scan
    await lookupRef.set({ pins: { [h]: FieldValue.delete() } }, { merge: true }).catch(() => {})
  }

  // Lazy adoption: scan the roster's pin records (small — one per staffer).
  // Existing PINs predate the index and can't be reversed into it; a correct
  // entry is written the first time each PIN succeeds here.
  const allPins = await db().collection(`tenants/${tenantId}/staffPins`).get()
  const matches = []
  for (const d of allPins.docs) {
    if (RESERVED_PIN_DOCS.has(d.id)) continue
    const res = await verifyPinCore(tenantId, d.id, pin, { count: false })
    if (res.ok) matches.push(d.id)
  }
  if (matches.length === 1) {
    await lookupRef.set({ pins: { [h]: matches[0] } }, { merge: true }).catch(() => {})
    return finish(matches[0])
  }
  if (matches.length > 1) {
    // legacy duplicates: the client shows a one-time name pick among ONLY the
    // matched staffers, then retries with an explicit staffId. Managers should
    // change one of the PINs (setStaffPinSecure now enforces uniqueness).
    const names = await Promise.all(matches.map(async (u) => {
      const s = await db().doc(`tenants/${tenantId}/staff/${u}`).get()
      const sd = s.exists ? (s.data() || {}) : {}
      // name only — never leak email to an unauthenticated caller
      return { uid: u, name: sd.name || '' }
    }))
    return { ok: false, ambiguous: true, matches: names }
  }
  // No match anywhere → charge the tenant-wide counter (atomically).
  const r = await bumpTenantFail(metaRef, now)
  return { ok: false, locked: r.locked, waitMs: r.waitMs }
})

// ---------------------------------------------------------------------------
// setStaffPin({ tenantId, staffId, pin }) — manager sets; pin '' / null clears.
// ---------------------------------------------------------------------------
exports.setStaffPinSecure = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign in first')
  const { tenantId, staffId, pin } = request.data || {}
  if (!tenantId || !staffId) throw new HttpsError('invalid-argument', 'tenantId and staffId are required')
  const me = await memberOf(uid, tenantId)
  if (!me || !isManagerRole(me.role)) throw new HttpsError('permission-denied', 'managers only')

  const pinRef = db().doc(`tenants/${tenantId}/staffPins/${staffId}`)
  const staffRef = db().doc(`tenants/${tenantId}/staff/${staffId}`)
  const { meta } = await getPinMeta(tenantId)
  const lookupRef = db().doc(`tenants/${tenantId}/staffPins/_lookup`)
  const lookupSnap = await lookupRef.get()
  const pins = lookupSnap.exists ? ((lookupSnap.data() || {}).pins || {}) : {}
  // this staffer's previous index entries (old PIN) always get swept
  const stale = Object.keys(pins).filter((k) => pins[k] === staffId)

  if (pin === '' || pin == null) {
    await pinRef.delete().catch(() => {})
    if (stale.length) {
      const patch = {}
      stale.forEach((k) => { patch[k] = FieldValue.delete() })
      await lookupRef.set({ pins: patch }, { merge: true }).catch(() => {})
    }
    await staffRef.set({ hasPin: false, pinHash: FieldValue.delete() }, { merge: true })
    return { ok: true, cleared: true }
  }
  if (!/^\d{4}$/.test(String(pin))) throw new HttpsError('invalid-argument', 'pin must be exactly 4 digits')
  // UNIQUENESS: PIN-only entry means the PIN IS the identity — two staffers
  // sharing one code would be indistinguishable at the lock screen. BUT a code
  // mapped to a DEACTIVATED or DELETED staffer is free to reuse — setStaffActive
  // only flips active:false and never sweeps staffPins/_lookup, so without this
  // a manager could not reassign a departed staffer's PIN («pin-taken» for a
  // code nobody can use).
  const h = hmacPin(meta.secret, pin)
  if (pins[h] && pins[h] !== staffId) {
    const holder = await db().doc(`tenants/${tenantId}/staff/${pins[h]}`).get()
    const active = holder.exists && (holder.data() || {}).active !== false
    if (active) throw new HttpsError('already-exists', 'pin-taken')
    // reassign from the inactive/missing holder: drop their record + index
    // entry AND the hasPin flag — leaving it set listed the old holder on the
    // lock-screen roster with a PIN that no longer exists if reactivated.
    await db().doc(`tenants/${tenantId}/staffPins/${pins[h]}`).delete().catch(() => {})
    await db().doc(`tenants/${tenantId}/staff/${pins[h]}`).set({ hasPin: FieldValue.delete() }, { merge: true }).catch(() => {})
  }
  const salt = crypto.randomBytes(16).toString('hex')
  await pinRef.set({
    hash: await scrypt(pin, salt), salt,
    legacySha256: FieldValue.delete(),
    failCount: 0, lockedUntil: 0, updatedAt: Date.now(),
  }, { merge: true })
  const lookupPatch = {}
  stale.forEach((k) => { if (k !== h) lookupPatch[k] = FieldValue.delete() })
  lookupPatch[h] = staffId
  await lookupRef.set({ pins: lookupPatch }, { merge: true }).catch(() => {})
  // hasPin is the non-secret flag the lock screen lists people by.
  await staffRef.set({ hasPin: true, pinHash: FieldValue.delete() }, { merge: true })
  return { ok: true }
})

// ---------------------------------------------------------------------------
// migrateStaffPins({ tenantId }) — one sweep: every legacy staff-doc pinHash
// moves into staffPins (as the legacy digest, upgraded on first unlock) and
// the world of peer-readable hashes ends. Idempotent; manager-only.
// ---------------------------------------------------------------------------
exports.migrateStaffPins = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign in first')
  const { tenantId } = request.data || {}
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId required')
  const me = await memberOf(uid, tenantId)
  if (!me || !isManagerRole(me.role)) throw new HttpsError('permission-denied', 'managers only')

  const staff = await db().collection(`tenants/${tenantId}/staff`).get()
  let moved = 0
  for (const s of staff.docs) {
    const d = s.data() || {}
    if (!d.pinHash) continue
    await db().doc(`tenants/${tenantId}/staffPins/${s.id}`)
      .set({ legacySha256: d.pinHash, failCount: 0, lockedUntil: 0, migratedAt: Date.now() }, { merge: true })
    await s.ref.set({ pinHash: FieldValue.delete(), hasPin: true }, { merge: true })
    moved++
  }
  return { ok: true, moved }
})

// ---------------------------------------------------------------------------
// Caps-mirror seeding on staff creation.
//
// KEEP IN SYNC with src/lib/permissions.js ROLE_CAPS — rules can't compute
// role defaults, so the mirror on staff/{uid}.caps IS the enforced truth for
// non-managers. tenant.roleCaps (per-venue role customization) wins over
// these defaults, exactly like roleDefaultCaps() client-side.
// ---------------------------------------------------------------------------
const ROLE_CAPS = {
  supervisor: ['take_orders', 'cancel_order', 'refund', 'print', 'scan_tickets', 'kitchen', 'manage_tables', 'view_reports', 'view_revenue', 'view_customers', 'view_complaints', 'view_performance', 'attendance'],
  marketing: ['manage_campaigns', 'manage_offers', 'manage_stories', 'view_customers', 'use_assistant', 'export_data', 'attendance'],
  accountant: ['view_revenue', 'view_reports', 'export_data', 'manage_payroll', 'view_performance', 'refund', 'view_customers', 'use_assistant', 'attendance'],
  cashier: ['take_orders', 'cancel_order', 'refund', 'print', 'scan_tickets', 'attendance'],
  barista: ['take_orders', 'kitchen', 'attendance'],
  waiter: ['take_orders', 'attendance'],
  kitchen: ['kitchen', 'attendance'],
  driver: ['deliver', 'attendance'],
  cleaner: ['attendance'],
  staff: ['attendance'],
}

// Shared with index.js (pushToStaff recipient filter) — do NOT create a third
// copy of the matrix; this and src/lib/permissions.js are the only two.
exports._ROLE_CAPS = ROLE_CAPS

// ---------------------------------------------------------------------------
// updateStaffCredentials({ tenantId, staffId, newEmail?, newPassword? })
// The ONLY path that changes a login email or password for someone else.
// Client-side Firebase Auth cannot touch another user's account, so this is
// necessarily server-side (Admin SDK). Authorization:
//   - a PLATFORM admin (platformAdmins/{uid} exists) may change anyone's, or
//   - the venue's owner/manager may change their OWN staff — with one carve-out:
//     a manager may NOT change the OWNER's credentials (the owner themself or
//     the platform only), or a rogue manager could lock the owner out.
// Every change emails the CENTRAL system (platform support address) with who
// changed what for whom — never including the password itself.
// ---------------------------------------------------------------------------
exports.updateStaffCredentials = onCall({ region: 'us-central1' }, async (request) => {
  const callerUid = request.auth && request.auth.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'sign in first')
  const { tenantId, staffId, newEmail, newPassword } = request.data || {}
  if (!tenantId || !staffId) throw new HttpsError('invalid-argument', 'tenantId and staffId are required')
  const email = String(newEmail || '').trim().toLowerCase()
  const password = String(newPassword || '')
  if (!email && !password) throw new HttpsError('invalid-argument', 'nothing to change')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError('invalid-argument', 'invalid email')
  if (password && password.length < 6) throw new HttpsError('invalid-argument', 'password too short (min 6)')

  // ---- authorization ----
  const platformAdminSnap = await db().doc(`platformAdmins/${callerUid}`).get().catch(() => null)
  const isPlatform = !!(platformAdminSnap && platformAdminSnap.exists)
  const target = await memberOf(staffId, tenantId)
  if (!target) throw new HttpsError('not-found', 'target is not a member of this venue')
  if (!isPlatform) {
    const me = await memberOf(callerUid, tenantId)
    if (!me || !isManagerRole(me.role)) throw new HttpsError('permission-denied', 'managers only')
    if (target.role === 'owner' && callerUid !== staffId) {
      throw new HttpsError('permission-denied', 'only the owner or the platform can change the owner credentials')
    }
  }

  // ---- apply on Firebase Auth ----
  const oldEmail = target.email || ''
  const patch = {}
  if (email) patch.email = email
  if (password) patch.password = password
  try {
    await getAuth().updateUser(staffId, patch)
  } catch (e) {
    if (e && e.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'email-taken')
    logger.error('updateStaffCredentials: updateUser failed', { code: e && e.code, message: e && e.message })
    throw new HttpsError('internal', 'auth-update-failed')
  }

  // ---- mirror the email everywhere the app reads it ----
  if (email) {
    await db().doc(`users/${staffId}`).set({ email }, { merge: true }).catch(() => {})
    await db().doc(`tenants/${tenantId}/staff/${staffId}`).set({ email }, { merge: true }).catch(() => {})
  }

  // ---- notify the CENTRAL system + audit trail (best-effort, never blocks) ----
  try {
    const tSnap = await db().doc(`tenants/${tenantId}`).get()
    const tenantName = tSnap.exists ? (tSnap.data() || {}).name || '' : ''
    const callerDoc = await db().doc(`users/${callerUid}`).get().catch(() => null)
    const callerEmail = callerDoc && callerDoc.exists ? (callerDoc.data() || {}).email || callerUid : callerUid
    const what = [
      email ? `البريد: ${oldEmail || '—'} ← ${email}` : '',
      password ? 'كلمة المرور: غُيّرت' : '',
    ].filter(Boolean).join(' · ')
    await db().collection('platformActivity').add({
      tenantId, tenantName, kind: 'settings', severity: 'high',
      title: 'تغيير بيانات دخول', body: `${what} — للموظف ${target.displayName || staffId} بواسطة ${callerEmail}${isPlatform ? ' (منصة)' : ''}`,
      at: FieldValue.serverTimestamp(),
    }).catch(() => {})
    const { sendEmail } = require('./messaging')
    const cfgSnap = await db().doc('platformConfig/finance').get().catch(() => null)
    const centralTo = (cfgSnap && cfgSnap.exists && (cfgSnap.data().sellerDisplay || {}).contactEmail) || 'support@rbt360sa.com'
    await sendEmail({
      meter: 'platform',
      to: centralTo,
      subject: `تغيير بيانات دخول — ${tenantName || tenantId}`,
      html: `<p>منشأة: <b>${tenantName || tenantId}</b></p><p>${what}</p><p>الموظف: ${target.displayName || ''} (${staffId})</p><p>بواسطة: ${callerEmail}${isPlatform ? ' — مشرف منصة' : ''}</p>`,
    }).catch(() => {})
  } catch (_) { /* the change itself already succeeded */ }

  return { ok: true }
})

exports.onStaffDocCreated = onDocumentCreated('tenants/{tid}/staff/{uid}', async (event) => {
  const snap = event.data
  if (!snap) return
  const d = snap.data() || {}
  const role = d.role || 'staff'
  if (role === 'owner' || role === 'manager') return       // managers hold every cap by role
  if (Array.isArray(d.caps)) return                        // already seeded (manager-created row)
  const tid = event.params.tid
  let want = ROLE_CAPS[role] || ROLE_CAPS.staff
  try {
    const t = await db().doc(`tenants/${tid}`).get()
    const rc = t.exists ? (t.data() || {}).roleCaps : null
    if (rc && Array.isArray(rc[role])) want = rc[role]
  } catch (_) { /* fall back to defaults */ }
  await snap.ref.set({ caps: want, capsCustom: false, capsSeededAt: Date.now() }, { merge: true })
})
