// AI-assistant conversation history — FIRESTORE is the source of truth (the
// owner's requirement: «عند دخوله من حسابه من أي مكان يجد كل شيء حتى محادثات
// الذكاء»), localStorage stays as a synchronous warm cache so the sidebar
// paints instantly and the old call sites keep working offline.
//
// Storage: tenants/{tid}/aiChats/{uid}_{chatId} = { uid, chatId, title,
// messages, updatedAt }. The uid prefix in the DOC ID + a uid field lets the
// rules pin every user to their own chats — which also fixes the old leak
// where everyone on a shared browser profile saw each other's conversations
// (the localStorage key had no uid at all).
//
// Sync model: reads serve the local cache first; syncChats() pulls the user's
// chats from Firestore into the cache (and uploads any local-only chats once —
// the migration for pre-sync history). saveChat/deleteChat write the cache
// synchronously and Firestore fire-and-forget.
import { doc, setDoc, deleteDoc, getDocs, query, where, collection } from 'firebase/firestore'
import { db, auth } from './firebase.js'

const KEY = (tid) => `ml_ai_chats_${tid || 'default'}`
const MAX = 60
// Firestore doc ceiling is 1MB; long tool-heavy chats can approach it. Keep
// the durable copy to the last 200 entries (the cache keeps whatever fits).
const MAX_MSGS = 200

const uidNow = () => auth?.currentUser?.uid || ''

function read(tid) {
  try { return JSON.parse(localStorage.getItem(KEY(tid)) || '[]') } catch (_) { return [] }
}
function write(tid, list) {
  try { localStorage.setItem(KEY(tid), JSON.stringify(list.slice(0, MAX))) } catch (_) { /* quota */ }
}

export function listChats(tid) {
  return read(tid).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

export function getChat(tid, id) {
  return read(tid).find((c) => c.id === id) || null
}

export function newChatId() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// Derive a short title from the first user message.
export function titleFrom(messages) {
  const first = (messages || []).find((m) => m.role === 'user' && m.text)
  const t = (first?.text || '').trim().replace(/\s+/g, ' ')
  return t ? (t.length > 40 ? t.slice(0, 40) + '…' : t) : 'محادثة جديدة'
}

const chatRef = (tid, uid, id) => doc(db, 'tenants', tid, 'aiChats', `${uid}_${id}`)

// Strip anything Firestore can't hold (functions, undefined) and cap length.
function durable(chat) {
  const msgs = (chat.messages || []).slice(-MAX_MSGS).map((m) => {
    const clean = {}
    Object.entries(m || {}).forEach(([k, v]) => { if (v !== undefined && typeof v !== 'function') clean[k] = v })
    return clean
  })
  return msgs
}

// Upsert a chat; returns the saved record. Local write is synchronous (the UI
// reads it right back); the Firestore mirror is fire-and-forget.
export function saveChat(tid, chat) {
  if (!chat?.id) return null
  const list = read(tid)
  const rec = { ...chat, title: chat.title || titleFrom(chat.messages), updatedAt: Date.now() }
  const idx = list.findIndex((c) => c.id === chat.id)
  if (idx >= 0) list[idx] = rec
  else list.unshift(rec)
  write(tid, list)
  const uid = uidNow()
  if (tid && uid) {
    setDoc(chatRef(tid, uid, chat.id), {
      uid, chatId: chat.id, title: rec.title, updatedAt: rec.updatedAt, messages: durable(rec),
    }).catch(() => { /* offline / rules — the cache still has it; next save retries */ })
  }
  return rec
}

export function deleteChat(tid, id) {
  write(tid, read(tid).filter((c) => c.id !== id))
  const uid = uidNow()
  if (tid && uid) deleteDoc(chatRef(tid, uid, id)).catch(() => {})
}

export function clearChats(tid) {
  write(tid, [])
}

// Pull this user's chats from Firestore into the cache and push any
// local-only ones up (one-time migration of pre-sync history). Returns the
// merged, sorted list. Safe to call on every Assistant mount.
export async function syncChats(tid) {
  const uid = uidNow()
  if (!tid || !uid) return listChats(tid)
  try {
    const snap = await getDocs(query(collection(db, 'tenants', tid, 'aiChats'), where('uid', '==', uid)))
    const remote = snap.docs.map((d) => {
      const x = d.data() || {}
      return { id: x.chatId || d.id.replace(`${uid}_`, ''), title: x.title || '', updatedAt: x.updatedAt || 0, messages: x.messages || [] }
    })
    const local = read(tid)
    const remoteIds = new Set(remote.map((c) => c.id))
    // local-only chats (written before sync existed, or offline) → upload once
    const localOnly = local.filter((c) => c.id && !remoteIds.has(c.id))
    localOnly.forEach((c) => {
      setDoc(chatRef(tid, uid, c.id), {
        uid, chatId: c.id, title: c.title || titleFrom(c.messages), updatedAt: c.updatedAt || Date.now(), messages: durable(c),
      }).catch(() => {})
    })
    // remote wins on conflict (it is the cross-device truth); cache the merge
    const merged = [...remote, ...localOnly].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    write(tid, merged)
    return merged
  } catch (_) {
    return listChats(tid) // offline / rules not deployed yet — cache serves
  }
}
