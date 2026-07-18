// Local conversation history for the AI assistant (per tenant, on this device).
// Kept client-side so chats survive reloads without extra Firestore cost.

const KEY = (tid) => `ml_ai_chats_${tid || 'default'}`
const MAX = 60

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

// Upsert a chat; returns the saved record.
export function saveChat(tid, chat) {
  if (!chat?.id) return null
  const list = read(tid)
  const rec = { ...chat, title: chat.title || titleFrom(chat.messages), updatedAt: Date.now() }
  const idx = list.findIndex((c) => c.id === chat.id)
  if (idx >= 0) list[idx] = rec
  else list.unshift(rec)
  write(tid, list)
  return rec
}

export function deleteChat(tid, id) {
  write(tid, read(tid).filter((c) => c.id !== id))
}

export function clearChats(tid) {
  write(tid, [])
}
