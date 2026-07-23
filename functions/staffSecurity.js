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
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
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
// verifyStaffPin({ tenantId, staffId, pin }) → { ok, locked?, waitMs? }
// Caller: any signed-in member of the tenant (the shared device's session).
// ---------------------------------------------------------------------------
exports.verifyStaffPin = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign in first')
  const { tenantId, staffId, pin } = request.data || {}
  if (!tenantId || !staffId || !/^\d{4}$/.test(String(pin || ''))) {
    throw new HttpsError('invalid-argument', 'tenantId, staffId and a 4-digit pin are required')
  }
  if (!(await memberOf(uid, tenantId))) throw new HttpsError('permission-denied', 'not a member of this venue')

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
  const fails = (rec.failCount || 0) + 1
  const patch = { failCount: fails, lastFailAt: now }
  if (fails >= MAX_FAILS) {
    patch.lockedUntil = now + LOCK_MS
    patch.failCount = 0
  }
  await pinRef.set(patch, { merge: true })
  return { ok: false, locked: fails >= MAX_FAILS, waitMs: fails >= MAX_FAILS ? LOCK_MS : 0 }
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

  if (pin === '' || pin == null) {
    await pinRef.delete().catch(() => {})
    await staffRef.set({ hasPin: false, pinHash: FieldValue.delete() }, { merge: true })
    return { ok: true, cleared: true }
  }
  if (!/^\d{4}$/.test(String(pin))) throw new HttpsError('invalid-argument', 'pin must be exactly 4 digits')
  const salt = crypto.randomBytes(16).toString('hex')
  await pinRef.set({
    hash: await scrypt(pin, salt), salt,
    legacySha256: FieldValue.delete(),
    failCount: 0, lockedUntil: 0, updatedAt: Date.now(),
  }, { merge: true })
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
  supervisor: ['take_orders', 'cancel_order', 'refund', 'print', 'scan_tickets', 'kitchen', 'view_reports', 'view_revenue', 'view_customers', 'view_complaints', 'view_performance', 'attendance'],
  marketing: ['manage_campaigns', 'manage_offers', 'manage_stories', 'view_customers', 'use_assistant', 'export_data', 'attendance'],
  cashier: ['take_orders', 'cancel_order', 'refund', 'print', 'scan_tickets', 'attendance'],
  barista: ['take_orders', 'kitchen', 'attendance'],
  waiter: ['take_orders', 'attendance'],
  kitchen: ['kitchen', 'attendance'],
  driver: ['deliver', 'attendance'],
  cleaner: ['attendance'],
  staff: ['attendance'],
}

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
