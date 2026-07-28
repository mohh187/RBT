// ==================== STAFF INVITES — server-side claim ====================
// Claiming a staff invite used to happen entirely on the client: read
// staffInvites/{email}, then write your own users/{uid} doc with the tenantId
// and role you just read. Two holes came out of that, and both were live.
//
// HOLE 1 — PRIVILEGE ESCALATION. firestore.rules let any signed-in user create
// their own users/{uid} doc carrying an `email` field THEY choose (the create
// rule only required the absence of role/tenantId/caps). The privileged update
// rule then authorised the escalation by checking
// `exists(/staffInvites/$(resource.data.email))` — i.e. against the attacker's
// own freely-written field. Combined with `allow get: if isSignedIn()` on
// staffInvites, the chain was: probe for a pending manager invite, write that
// address into your own user doc, then update yourself to
// {tenantId, role:'manager'} and become a manager of a venue you have nothing
// to do with.
//
// HOLE 2 — GRIEFING. `allow delete: if isSignedIn()` meant ANY signed-in
// account could delete ANY venue's pending invites.
//
// The fix is this file. Claiming moves to a callable that reads
// `request.auth.token.email` — the address FIREBASE verified, which no client
// can forge — and the rules drop the invite branches entirely.
//
// It also fixes the eviction bug on the way past: the doc id used to be the
// email alone, so one address could hold one invite platform-wide, and
// claiming it OVERWROTE users/{uid}.tenantId — accepting an invite to venue B
// silently threw you out of venue A. The id is now `{email}__{tid}` and an
// existing tenant binding is never overwritten.
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')

// Doc id: deterministic, so duplicate prevention stays a free write-collision
// rather than a query, and cancelling an invite stays a direct delete.
// `__` separates because an email may contain almost anything except spaces,
// but never two consecutive underscores in a real address's local part.
const inviteId = (email, tid) => `${String(email || '').trim().toLowerCase()}__${tid}`

const claimStaffInvites = onCall(async (request) => {
  const auth = request.auth
  if (!auth) throw new HttpsError('unauthenticated', 'سجّل الدخول أولاً.')
  // THE verified address. Not request.data, not a users-doc field.
  const email = String(auth.token && auth.token.email || '').trim().toLowerCase()
  if (!email) return { claimed: [], added: [], active: null }

  const db = getFirestore()
  // Admin SDK, so no `list` rule is needed — and none should exist: the
  // invitee could never satisfy the manager-only list rule anyway.
  const snap = await db.collection('staffInvites').where('email', '==', email).get().catch(() => null)
  const docs = snap && !snap.empty ? [...snap.docs] : []

  // LEGACY FALLBACK. Invites created before the id change have the bare email
  // as their id and no `email` FIELD at all, so the query above cannot see
  // them. Without this, everyone holding a pending invite at the moment of
  // deploy would silently be unable to join — and the backfill script needs
  // credentials that may not be to hand. Fetch that one document directly.
  if (!docs.some((d) => d.id === email)) {
    const legacy = await db.doc(`staffInvites/${email}`).get().catch(() => null)
    if (legacy && legacy.exists) docs.push(legacy)
  }
  if (!docs.length) return { claimed: [], added: [], active: null }

  const uSnap = await db.doc(`users/${auth.uid}`).get().catch(() => null)
  const user = uSnap && uSnap.exists ? (uSnap.data() || {}) : {}
  // Whether the user is ALREADY working somewhere decides everything below.
  let activeTenant = user.tenantId || null

  const claimed = []
  const added = []

  for (const d of docs) {
    const inv = d.data() || {}
    const tid = inv.tenantId
    if (!tid) { await d.ref.delete().catch(() => {}); continue }
    const tSnap = await db.doc(`tenants/${tid}`).get().catch(() => null)
    if (!tSnap || !tSnap.exists) { await d.ref.delete().catch(() => {}); continue }

    const role = inv.role || 'waiter'
    // The staff doc is the durable proof of membership; users.tenantId is only
    // "where I am working right now".
    await db.doc(`tenants/${tid}/staff/${auth.uid}`).set({
      uid: auth.uid, email, name: inv.name || user.displayName || '', role,
      active: true, joinedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {})

    if (!activeTenant) {
      // First venue: bind it as the active one, exactly as before.
      await db.doc(`users/${auth.uid}`).set({
        tenantId: tid, role, ...(inv.name ? { displayName: inv.name } : {}),
      }, { merge: true })
      activeTenant = tid
      claimed.push({ tenantId: tid, role, venueName: inv.venueName || tSnap.data().name || '' })
    } else {
      // ALREADY working somewhere. Do NOT overwrite — that is the eviction bug.
      // Record the membership and let the UI offer a switch.
      added.push({ tenantId: tid, role, venueName: inv.venueName || tSnap.data().name || '' })
    }
    await d.ref.delete().catch(() => {})
  }

  return { claimed, added, active: activeTenant }
})

module.exports = { claimStaffInvites, inviteId }
