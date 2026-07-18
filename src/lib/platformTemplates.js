// Platform appearance templates — reusable named looks (theme preset + brand/
// accent colors + optional full skin) that a platform admin can define once and
// bulk-apply across venues. Stored in the platform-only `platformTemplates`
// collection (rules come from the backend bundle). Applying a template writes
// the same tenant appearance fields the per-venue Design screen writes, so the
// public menu picks them up immediately.
import {
  collection,
  doc,
  setDoc,
  addDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase.js'
import { platformUpdateTenant } from './platform.js'

const list = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))

// Live list of saved templates (newest first).
export function watchTemplates(cb) {
  return onSnapshot(
    collection(db, 'platformTemplates'),
    (s) => {
      const rows = list(s)
      rows.sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))
      cb(rows)
    },
    () => cb([]),
  )
}

// Create (id omitted) or update (id given) a template. Only the known
// appearance fields are persisted.
export async function saveTemplate(id, { name, themePreset, themeAccent, themeColor, skinId }) {
  const data = {
    name: String(name || '').slice(0, 80) || 'قالب',
    themePreset: themePreset || null,
    themeColor: themeColor || null,
    themeAccent: themeAccent || null,
    skinId: skinId || null,
    updatedAt: serverTimestamp(),
  }
  if (id) {
    await setDoc(doc(db, 'platformTemplates', id), data, { merge: true })
    return id
  }
  const ref = await addDoc(collection(db, 'platformTemplates'), { ...data, createdAt: serverTimestamp() })
  return ref.id
}

export async function deleteTemplate(id) {
  await deleteDoc(doc(db, 'platformTemplates', id))
}

// Apply a template's appearance to many venues at once. Returns {ok, failed}.
export async function applyTemplateToTenants(tids, template) {
  const ids = Array.isArray(tids) ? tids : []
  const patch = {
    themePreset: template?.themePreset || null,
    themeColor: template?.themeColor || null,
    themeAccent: template?.themeAccent || null,
    skin: template?.skinId ? { skinId: template.skinId } : null,
  }
  let ok = 0
  const failed = []
  for (const tid of ids) {
    try {
      await platformUpdateTenant(tid, patch)
      ok += 1
    } catch {
      failed.push(tid)
    }
  }
  return { ok, failed }
}

// ---------- WCAG contrast helpers (pure) ----------
function toRgb(hex) {
  let h = String(hex || '').trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function relLuminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// WCAG relative contrast ratio (1..21). Returns 1 for invalid input.
export function contrastRatio(hex1, hex2) {
  const a = toRgb(hex1)
  const b = toRgb(hex2)
  if (!a || !b) return 1
  const l1 = relLuminance(a)
  const l2 = relLuminance(b)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

// Passes WCAG AA for normal text.
export function isReadable(bg, fg) {
  return contrastRatio(bg, fg) >= 4.5
}
