// ==================== BRANCHES ====================
// One owner, several venues, without touching the authorization model.
//
// THE IDEA THAT MAKES THIS SAFE: `users/{uid}.tenantId` keeps its exact
// current meaning — "the venue I am working in RIGHT NOW" — not "the venues I
// belong to". So every one of the ~1050 lines of firestore.rules, all the
// server-side `u.tenantId === tenantId` checks, and storage.rules keep working
// byte-for-byte unchanged, because at any instant a user is authorized in
// exactly one tenant. Branches become a NAVIGATION feature, not an
// authorization feature — and the rules-enforced hard wall (a component that
// passes the wrong tid still gets denied) is preserved rather than spent.
//
// The memberships list is an INDEX FOR THE UI, not an authorization source.
// switchTenant re-validates against the authoritative facts every time
// (tenants/{tid}.ownerUid, or an active staff doc), so a forged index entry
// would be inert — and it cannot be forged anyway, because the subcollection
// is `write: if false`.
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')

// Is `uid` genuinely entitled to work in `tid`? Reads the TRUTH, never the
// membership index.
async function verifyMembership(db, uid, tid) {
  const tSnap = await db.doc(`tenants/${tid}`).get()
  if (!tSnap.exists) return null
  const t = tSnap.data() || {}
  if (t.active === false) return null // a suspended branch is not switchable
  if (t.ownerUid === uid) return { role: 'owner', tenant: t }
  const staff = await db.doc(`tenants/${tid}/staff/${uid}`).get().catch(() => null)
  if (staff && staff.exists && staff.data().active !== false) {
    return { role: staff.data().role || 'staff', tenant: t }
  }
  return null
}

// ------------------------------------------------------------ switch
const switchTenant = onCall(async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'سجّل الدخول أولاً.')
  const tid = String((request.data || {}).tenantId || '')
  if (!tid) throw new HttpsError('invalid-argument', 'tenantId required')

  const db = getFirestore()
  const uRef = db.doc(`users/${uid}`)
  const uSnap = await uRef.get()
  const prev = uSnap.exists ? (uSnap.data().tenantId || null) : null
  if (prev === tid) return { tenantId: tid, unchanged: true }

  const ok = await verifyMembership(db, uid, tid)
  if (!ok) {
    // Self-healing index: an entry that no longer verifies is removed, so the
    // switcher stops offering a branch the user was removed from.
    await db.doc(`users/${uid}/memberships/${tid}`).delete().catch(() => {})
    throw new HttpsError('permission-denied', 'لا تملك صلاحية في هذا الفرع.')
  }

  await uRef.set({ tenantId: tid, role: ok.role }, { merge: true })
  await db.doc(`users/${uid}/memberships/${tid}`).set({
    tenantId: tid, tenantName: ok.tenant.name || '', groupId: ok.tenant.groupId || null,
    role: ok.role, branchLabel: ok.tenant.branchLabel || '', lastActiveAt: FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => {})

  // PUSH TOKENS FOLLOW THE DEVICE, NOT THE TENANT. Without this the owner
  // keeps receiving new-order alerts from the branch they just left while
  // standing in the one they moved to.
  if (prev) {
    const toks = await db.collection(`tenants/${prev}/pushTokens`).where('uid', '==', uid).get().catch(() => null)
    if (toks && !toks.empty) await Promise.all(toks.docs.map((d) => d.ref.delete().catch(() => {})))
  }

  await db.collection('platformActivity').add({
    tenantId: tid, tenantName: ok.tenant.name || '', type: 'branchSwitch', severity: 'info',
    title: 'تبديل فرع', body: `${(request.auth.token && request.auth.token.email) || uid} انتقل إلى الفرع ${tid}${prev ? ` قادماً من ${prev}` : ''}`,
    at: FieldValue.serverTimestamp(),
  }).catch(() => {})

  return { tenantId: tid, role: ok.role, name: ok.tenant.name || '' }
})

// ------------------------------------------------------ create a branch
// NOT createTenant. That function writes the owner's tenantId inside the
// creation transaction (src/lib/db.js:91), so reusing it would eject the owner
// from the branch they are standing in, mid-session.
const createBranch = onCall(async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'سجّل الدخول أولاً.')
  const db = getFirestore()
  const d = request.data || {}
  const sourceTid = String(d.sourceTenantId || '')
  const name = String(d.name || '').trim()
  const slug = String(d.slug || '').trim().toLowerCase()
  const branchLabel = String(d.branchLabel || '').trim()
  if (!sourceTid || !name || !slug) throw new HttpsError('invalid-argument', 'sourceTenantId + name + slug required')
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new HttpsError('invalid-argument', 'رابط الفرع يقبل الحروف الإنجليزية الصغيرة والأرقام والشرطة فقط.')

  // Owner of the source venue, or a platform admin acting on their behalf.
  const srcSnap = await db.doc(`tenants/${sourceTid}`).get()
  if (!srcSnap.exists) throw new HttpsError('not-found', 'المنشأة الأصل غير موجودة')
  const src = srcSnap.data() || {}
  const adminSnap = await db.doc(`platformAdmins/${uid}`).get().catch(() => null)
  const isAdmin = adminSnap && adminSnap.exists
  if (src.ownerUid !== uid && !isAdmin) throw new HttpsError('permission-denied', 'إضافة فرع جديد لمالك المنشأة وحده.')

  const ownerUid = src.ownerUid
  const slugRef = db.doc(`tenantSlugs/${slug}`)
  if ((await slugRef.get()).exists) throw new HttpsError('already-exists', 'هذا الرابط محجوز، اختر رابطاً آخر.')

  // Group: create on first branch, reuse afterwards.
  let gid = src.groupId || null
  if (!gid) {
    const gRef = db.collection('venueGroups').doc()
    await gRef.set({
      name: src.name || name, ownerUid, primaryTenantId: sourceTid,
      branchIds: [sourceTid], billing: 'perBranch', maxBranches: Number(d.maxBranches) || 10,
      currency: src.currency || 'SAR',
      createdAt: FieldValue.serverTimestamp(), createdBy: uid,
    })
    gid = gRef.id
    // groupId is client-denied in the rules, so only the Admin SDK writes it.
    await srcSnap.ref.set({ groupId: gid, branchLabel: src.branchLabel || 'الفرع الرئيسي' }, { merge: true })
  }

  const gSnap = await db.doc(`venueGroups/${gid}`).get()
  const g = gSnap.exists ? (gSnap.data() || {}) : {}
  const count = (g.branchIds || []).length
  if (count >= (Number(g.maxBranches) || 10)) throw new HttpsError('resource-exhausted', 'وصلت إلى الحد الأقصى للفروع. تواصل معنا لرفع الحد.')

  const tRef = db.collection('tenants').doc()
  await tRef.set({
    name, slug, ownerUid, groupId: gid, branchLabel: branchLabel || name,
    currency: src.currency || 'SAR',
    // INHERIT the subscription. Without this the branch has no plan, and
    // generateMonthlyInvoices skips venues with no plan — you would be giving
    // the branch away for free.
    plan: src.plan || null,
    planStatus: src.planStatus || 'active',
    planExpiresAt: src.planExpiresAt || null,
    vatEnabled: src.vatEnabled === true,
    vatNumber: src.vatNumber || '',
    createdAt: FieldValue.serverTimestamp(),
  })
  await slugRef.set({ tenantId: tRef.id })
  await db.doc(`venueGroups/${gid}`).set({ branchIds: FieldValue.arrayUnion(tRef.id) }, { merge: true })

  // Optional one-shot menu copy. A COPY, never a live sync — the owner chose
  // full isolation, and live cross-branch sync is a distributed-consistency
  // problem with per-branch price/stock divergence.
  if (d.copyMenu) {
    for (const col of ['categories', 'items']) {
      const snap = await db.collection(`tenants/${sourceTid}/${col}`).limit(500).get().catch(() => null)
      if (!snap || snap.empty) continue
      const batch = db.batch()
      snap.docs.forEach((doc) => batch.set(db.doc(`tenants/${tRef.id}/${col}/${doc.id}`), doc.data()))
      await batch.commit().catch(() => {})
    }
  }

  // Membership for the owner — but do NOT switch them. They are working
  // somewhere right now.
  await db.doc(`users/${ownerUid}/memberships/${tRef.id}`).set({
    tenantId: tRef.id, tenantName: name, groupId: gid, role: 'owner',
    branchLabel: branchLabel || name, addedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  // And backfill the source, so the switcher has both to offer.
  await db.doc(`users/${ownerUid}/memberships/${sourceTid}`).set({
    tenantId: sourceTid, tenantName: src.name || '', groupId: gid, role: 'owner',
    branchLabel: src.branchLabel || 'الفرع الرئيسي', addedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return { tenantId: tRef.id, groupId: gid, name, slug }
})

// -------------------------------------------------- backfill memberships
// Idempotent. Gives every existing user a membership row for the venue they
// already work in, so the switcher has something to read. Nothing depends on
// it until the switcher ships, and running it twice is harmless.
const backfillMemberships = onCall(async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign in')
  const db = getFirestore()
  const adminSnap = await db.doc(`platformAdmins/${uid}`).get()
  if (!adminSnap.exists) throw new HttpsError('permission-denied', 'platform admins only')

  const users = await db.collection('users').get()
  let written = 0
  for (const u of users.docs) {
    const d = u.data() || {}
    if (!d.tenantId) continue
    const t = await db.doc(`tenants/${d.tenantId}`).get().catch(() => null)
    if (!t || !t.exists) continue
    await db.doc(`users/${u.id}/memberships/${d.tenantId}`).set({
      tenantId: d.tenantId, tenantName: t.data().name || '', groupId: t.data().groupId || null,
      role: d.role || 'staff', branchLabel: t.data().branchLabel || '',
      addedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {})
    written += 1
  }
  return { users: users.size, written }
})

module.exports = { switchTenant, createBranch, backfillMemberships, verifyMembership }
