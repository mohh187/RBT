// Game memory: every question, answer, stage and result a guest produces while
// playing, recorded on the DEVICE first and in Firestore second.
//
// Two copies exist on purpose and they have different jobs:
//   • the DEVICE copy (localStorage) is AUTHORITATIVE FOR RESUME. A guest with a
//     dead connection must still be able to close the tab and come back to the
//     same stage. It is written synchronously on every event.
//   • the CLOUD copy (Firestore) is AUTHORITATIVE FOR ANALYTICS. It is written
//     in BATCHES (~6s, plus on finish and on visibility-hidden) so a 40-question
//     quiz costs a handful of writes instead of forty.
//
// Nothing in this module is allowed to throw into a running game. Every public
// function is wrapped; on failure it degrades to "local only" and the guest
// never sees an error. A lost cloud write costs one analytics row, never a
// broken game.
//
// FIRESTORE SHAPE (fixed by the lead — written exactly):
//   tenants/{tid}/gamePlays/{playId}         playId = `${deviceId}_${gameId}_${startedAtMs}`
//   tenants/{tid}/playerProfiles/{deviceId}  rollup, recomputed on finish
import {
  collection, doc, getDocs, query, where, orderBy, limit, setDoc, runTransaction,
} from 'firebase/firestore'
import { db, firebaseReady } from './firebase.js'
import { normalizePhone } from './format.js'

// --------------------------------------------------------------------------
// Limits. Every one of these exists because the alternative is an unbounded
// document or an unbounded write bill.
// --------------------------------------------------------------------------
const MAX_ANSWERS = 120          // hard cap per play (schema)
const MAX_RESUME_CHARS = 4000    // stringified resumeState ceiling (schema)
const FLUSH_MS = 6000            // batch window
const LOCAL_PLAYS = 12           // live plays kept in localStorage
const MAX_Q = 300                // per-answer question text ceiling
const MAX_CHOICE = 200
const MAX_NAME = 40
const MAX_TAGS = 12

const KINDS = ['arcade', 'quiz', 'puzzle', 'insight']

const LS_LIVE = 'rbt_gp_live'
const lsResume = (tid, gameId, deviceId) => `rbt_gp_r:${tid}:${gameId}:${deviceId}`
const lsProfile = (tid, deviceId) => `rbt_gp_p:${tid}:${deviceId}`

const nowMs = () => Date.now()
const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max)
const safeId = (v) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
const num = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
const intIn = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(num(v, lo))))

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const v = JSON.parse(raw)
    return v == null ? fallback : v
  } catch (_) { return fallback }
}

function writeLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true } catch (_) { return false }
}

// --------------------------------------------------------------------------
// In-memory registry of plays this tab is running. `dirty` marks a record that
// has changed since its last cloud write.
// --------------------------------------------------------------------------
const LIVE = new Map() // playId -> { tid, rec, dirty }
let flushTimer = null
let listenersBound = false

function bindListeners() {
  if (listenersBound || typeof document === 'undefined') return
  listenersBound = true
  const onHide = () => { if (document.visibilityState === 'hidden') flushAll() }
  try {
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushAll)
  } catch (_) { /* non-browser host — batching still works on the timer */ }
}

function schedule() {
  bindListeners()
  if (flushTimer) return
  try {
    flushTimer = setTimeout(() => { flushTimer = null; flushAll() }, FLUSH_MS)
  } catch (_) { flushTimer = null }
}

// Mirror the live registry to localStorage so a reload never loses answers.
function persistLocal() {
  try {
    const out = {}
    const entries = [...LIVE.entries()].slice(-LOCAL_PLAYS)
    for (const [playId, slot] of entries) out[playId] = { tid: slot.tid, rec: slot.rec }
    writeLS(LS_LIVE, out)
  } catch (_) { /* storage full or blocked — cloud batching still runs */ }
}

function touch(playId) {
  const slot = LIVE.get(playId)
  if (!slot) return null
  slot.dirty = true
  persistLocal()
  schedule()
  return slot
}

const playsCol = (tid) => collection(db, 'tenants', tid, 'gamePlays')
const profileRef = (tid, deviceId) => doc(db, 'tenants', tid, 'playerProfiles', safeId(deviceId))

// Write every dirty record. Failures are swallowed: the record stays dirty and
// the next window retries it, and the local mirror already holds the truth.
export async function flushAll() {
  if (!firebaseReady) return
  const dirty = [...LIVE.entries()].filter(([, s]) => s.dirty)
  if (!dirty.length) return
  await Promise.all(dirty.map(async ([playId, slot]) => {
    try {
      await setDoc(doc(playsCol(slot.tid), playId), slot.rec, { merge: true })
      slot.dirty = false
    } catch (_) { /* keep dirty; retried next window */ }
  }))
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

// Begin a play. Returns the playId synchronously (games must not await here).
// '' means "not recorded" — pass it around freely, every other call ignores it.
export function startPlay({ tid, gameId, gameAr = '', kind = 'arcade', deviceId, player = {} } = {}) {
  try {
    if (!tid || !gameId || !deviceId) return ''
    const startedAt = nowMs()
    const playId = `${safeId(deviceId)}_${safeId(gameId)}_${startedAt}`
    const phone = player && player.phone ? normalizePhone(player.phone) : ''
    const rec = {
      playId,
      gameId: String(gameId).slice(0, 64),
      gameAr: clean(gameAr, 60),
      kind: KINDS.includes(kind) ? kind : 'arcade',
      deviceId: String(deviceId).slice(0, 64),
      customerPhone: phone || null,
      customerName: clean(player && player.name, MAX_NAME) || null,
      startedAt,
      endedAt: null,
      durationMs: 0,
      score: 0,
      stage: 0,
      completed: false,
      answers: [],
      result: null,
      resumeState: null,
      device: {
        w: intIn(typeof window !== 'undefined' ? window.innerWidth : 0, 0, 10000),
        h: intIn(typeof window !== 'undefined' ? window.innerHeight : 0, 0, 10000),
        lang: clean(typeof document !== 'undefined' ? document.documentElement.lang : 'ar', 8) || 'ar',
      },
    }
    LIVE.set(playId, { tid, rec, dirty: true })
    persistLocal()
    schedule()
    return playId
  } catch (_) { return '' }
}

// One answer. Extra field beyond the fixed schema: `cat` (category) is kept when
// the game supplies it, because knowledge.byCat cannot be computed without it.
// When absent the gameId is used as the category, so the rollup is always valid.
export function recordAnswer(playId, answer = {}) {
  try {
    const slot = LIVE.get(playId)
    if (!slot) return false
    const rec = slot.rec
    if (rec.answers.length >= MAX_ANSWERS) return false // cap: drop, never grow
    const correct = answer.correct === true ? true : (answer.correct === false ? false : null)
    rec.answers.push({
      q: clean(answer.q, MAX_Q),
      qId: clean(answer.qId, 64),
      choice: clean(answer.choice, MAX_CHOICE),
      correct,
      at: num(answer.at, nowMs()),
      ...(answer.cat ? { cat: clean(answer.cat, 40) } : {}),
    })
    touch(playId)
    return true
  } catch (_) { return false }
}

// Save a resume point. Oversized states are DROPPED, not truncated — a
// half-serialized state would restore a corrupt game, which is worse than none.
export function saveProgress(playId, resumeState, stage) {
  try {
    const slot = LIVE.get(playId)
    if (!slot) return false
    const rec = slot.rec
    if (stage != null) rec.stage = intIn(stage, 0, 9999)

    let state = null
    if (resumeState && typeof resumeState === 'object') {
      let s = ''
      try { s = JSON.stringify(resumeState) } catch (_) { s = '' }
      if (s && s.length <= MAX_RESUME_CHARS) state = JSON.parse(s)
    }
    rec.resumeState = state

    // The device copy is what resume actually reads.
    writeLS(lsResume(slot.tid, rec.gameId, rec.deviceId), {
      playId, resumeState: state, stage: rec.stage, at: nowMs(),
    })
    touch(playId)
    return true
  } catch (_) { return false }
}

// End a play: flush it, then recompute the player rollup. Awaitable, but a game
// may fire-and-forget — it never rejects.
export async function finishPlay(playId, { score = 0, completed = false, result = null } = {}) {
  try {
    const slot = LIVE.get(playId)
    if (!slot) return null
    const rec = slot.rec
    rec.endedAt = nowMs()
    rec.durationMs = Math.max(0, rec.endedAt - rec.startedAt)
    rec.score = intIn(score, 0, 10000000)
    rec.completed = completed === true
    rec.result = sanitizeResult(result)
    slot.dirty = true

    // A completed play has nothing left to resume.
    if (rec.completed) {
      try { localStorage.removeItem(lsResume(slot.tid, rec.gameId, rec.deviceId)) } catch (_) { /* ignore */ }
    }
    persistLocal()

    await flushAll()
    const profile = await updatePlayerProfile(slot.tid, rec.deviceId, rec)
    LIVE.delete(playId)
    persistLocal()
    return profile
  } catch (_) { return null }
}

function sanitizeResult(result) {
  if (!result || typeof result !== 'object') return null
  const traits = {}
  const src = result.traits && typeof result.traits === 'object' ? result.traits : {}
  for (const k of Object.keys(src).slice(0, 12)) {
    const v = Number(src[k])
    if (Number.isFinite(v)) traits[clean(k, 32)] = Math.round(v * 100) / 100
  }
  return {
    archetype: clean(result.archetype, 60),
    traits,
    summary: clean(result.summary, 600),
  }
}

// Resume: LOCAL FIRST, always. The cloud is consulted only when this device has
// no local record (cleared storage, different browser) and returns the newest
// unfinished play for that game.
export async function getResume(tid, gameId, deviceId) {
  try {
    if (!tid || !gameId || !deviceId) return null
    const local = readLS(lsResume(tid, gameId, deviceId), null)
    if (local && local.resumeState) return { ...local, source: 'device' }
    if (!firebaseReady) return null

    const rows = await fetchDevicePlays(tid, deviceId, 20)
    const match = rows
      .filter((p) => p.gameId === gameId && p.completed !== true && p.resumeState)
      .sort((a, b) => num(b.startedAt) - num(a.startedAt))[0]
    if (!match) return null
    return { playId: match.playId, resumeState: match.resumeState, stage: num(match.stage), at: num(match.startedAt), source: 'cloud' }
  } catch (_) { return null }
}

// Bounded device history. Falls back progressively so a missing composite index
// or a strict rule degrades to "fewer rows", never to a thrown error.
async function fetchDevicePlays(tid, deviceId, max) {
  const ref = playsCol(tid)
  const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  try {
    return rows(await getDocs(query(ref, where('deviceId', '==', deviceId), orderBy('startedAt', 'desc'), limit(max))))
  } catch (_) { /* needs (deviceId, startedAt) index — try without the sort */ }
  try {
    return rows(await getDocs(query(ref, where('deviceId', '==', deviceId), limit(max))))
  } catch (_) { return [] }
}

// --------------------------------------------------------------------------
// Rollup. Read-modify-write in a transaction so two tabs finishing at once
// cannot lose a play. Only the fields this play touches are recomputed — the
// transaction never re-reads the whole play history.
// --------------------------------------------------------------------------
export async function updatePlayerProfile(tid, deviceId, play) {
  const merged = mergeIntoProfile(readLS(lsProfile(tid, deviceId), null), deviceId, play)
  writeLS(lsProfile(tid, deviceId), merged) // offline mirror, written first
  if (!firebaseReady || !tid || !deviceId) return merged
  try {
    const ref = profileRef(tid, deviceId)
    let out = merged
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      const prev = snap.exists() ? snap.data() : null
      out = mergeIntoProfile(prev, deviceId, play)
      tx.set(ref, out, { merge: true })
    })
    writeLS(lsProfile(tid, deviceId), out)
    return out
  } catch (_) { return merged }
}

// Pure: previous profile + one play -> next profile. Exported so the admin page
// can rebuild a rollup from raw plays without a write.
export function mergeIntoProfile(prev, deviceId, play) {
  const p = prev && typeof prev === 'object' ? prev : {}
  const started = num(play.startedAt, nowMs())
  const ended = num(play.endedAt, started)

  const byGame = { ...(p.byGame || {}) }
  const g = byGame[play.gameId] || { plays: 0, best: 0, lastAt: 0, stage: 0 }
  byGame[play.gameId] = {
    plays: num(g.plays) + 1,
    best: Math.max(num(g.best), num(play.score)),
    lastAt: Math.max(num(g.lastAt), ended),
    stage: Math.max(num(g.stage), num(play.stage)),
  }

  // Knowledge: only answers that carry a real true/false verdict count. An
  // insight/personality answer has correct === null and must NEVER be scored as
  // right or wrong — there is no right answer to "which do you prefer".
  const kn = p.knowledge && typeof p.knowledge === 'object' ? p.knowledge : {}
  const byCat = { ...(kn.byCat || {}) }
  let answered = num(kn.answered)
  let correct = num(kn.correct)
  for (const a of (play.answers || [])) {
    if (a.correct !== true && a.correct !== false) continue
    const cat = clean(a.cat, 40) || play.gameId
    const c = byCat[cat] || { answered: 0, correct: 0 }
    c.answered += 1
    if (a.correct === true) c.correct += 1
    byCat[cat] = c
    answered += 1
    if (a.correct === true) correct += 1
  }

  const next = {
    deviceId: String(deviceId).slice(0, 64),
    customerPhone: play.customerPhone || p.customerPhone || null,
    customerName: play.customerName || p.customerName || null,
    firstAt: num(p.firstAt) ? Math.min(num(p.firstAt), started) : started,
    lastAt: Math.max(num(p.lastAt), ended),
    totalPlays: num(p.totalPlays) + 1,
    totalScore: num(p.totalScore) + num(play.score),
    byGame,
    insight: play.result && play.result.archetype
      ? { archetype: play.result.archetype, traits: play.result.traits || {}, updatedAt: ended }
      : (p.insight || null),
    knowledge: { answered, correct, byCat },
    // Counters the tag rules need. They are derived from plays, not guessed.
    completedPlays: num(p.completedPlays) + (play.completed === true ? 1 : 0),
    totalDurationMs: num(p.totalDurationMs) + num(play.durationMs),
    tags: [],
  }
  next.tags = derivePlayerTags(next)
  return next
}

// --------------------------------------------------------------------------
// Tags — RULE-BASED ONLY. Every tag below is a threshold on a counter we
// actually incremented. No model, no inference, no personality guessing. If a
// rule's evidence is thin the tag is simply not applied.
// --------------------------------------------------------------------------
export const TAG_RULES = [
  { id: 'competitive', ar: 'منافس', rule: 'أعاد لعبة واحدة بعينها 3 مرات أو أكثر.', ruleEn: 'Replayed a single game 3+ times.' },
  { id: 'curious', ar: 'فضولي', rule: 'جرّب 3 ألعاب مختلفة أو أكثر.', ruleEn: 'Tried 3+ distinct games.' },
  { id: 'completionist', ar: 'يُنهي ما يبدأ', rule: 'أنهى 80% أو أكثر من محاولاته، وله 3 محاولات فأكثر.', ruleEn: '80%+ completion over 3+ plays.' },
  { id: 'quitter', ar: 'ينسحب مبكراً', rule: 'أنهى 25% أو أقل من محاولاته، وله 4 محاولات فأكثر.', ruleEn: '25% or less completion over 4+ plays.' },
  { id: 'returning', ar: 'عائد', rule: 'بين أول وآخر لعبة 7 أيام أو أكثر، وله 3 محاولات فأكثر.', ruleEn: '7+ days between first and last play, 3+ plays.' },
  { id: 'one-shot', ar: 'محاولة واحدة', rule: 'لعب مرة واحدة فقط ولم يعد.', ruleEn: 'Exactly one play, never returned.' },
  { id: 'quiz-strong', ar: 'قوي في الأسئلة', rule: 'أجاب 12 سؤالاً فأكثر بنسبة صحة 75% فما فوق.', ruleEn: '12+ scored answers at 75%+ accuracy.' },
  { id: 'quiz-weak', ar: 'يحتاج تلميحات', rule: 'أجاب 12 سؤالاً فأكثر بنسبة صحة 40% فما دون.', ruleEn: '12+ scored answers at 40% or less.' },
  { id: 'identified', ar: 'معروف الهوية', rule: 'ترك رقم جوال — يمكن مراسلته.', ruleEn: 'Left a phone number — reachable.' },
  { id: 'anonymous', ar: 'مجهول', rule: 'لا رقم جوال — لا يمكن مراسلته.', ruleEn: 'No phone — unreachable.' },
]

// Per-category strength tags are emitted as `quiz-strong-<cat>` on top of the
// list above, using the same 12-answer / 75% thresholds within one category.
const CAT_MIN = 12
const CAT_STRONG = 0.75
const DAY = 24 * 60 * 60 * 1000

export function derivePlayerTags(profile) {
  const out = []
  try {
    const p = profile || {}
    const byGame = p.byGame || {}
    const games = Object.values(byGame)
    const plays = num(p.totalPlays)
    const done = num(p.completedPlays)
    const kn = p.knowledge || {}
    const answered = num(kn.answered)
    const acc = answered > 0 ? num(kn.correct) / answered : null

    if (games.some((g) => num(g.plays) >= 3)) out.push('competitive')
    if (Object.keys(byGame).length >= 3) out.push('curious')
    if (plays >= 3 && done / plays >= 0.8) out.push('completionist')
    if (plays >= 4 && done / plays <= 0.25) out.push('quitter')
    if (plays >= 3 && num(p.lastAt) - num(p.firstAt) >= 7 * DAY) out.push('returning')
    if (plays === 1) out.push('one-shot')
    if (answered >= CAT_MIN && acc != null && acc >= CAT_STRONG) out.push('quiz-strong')
    if (answered >= CAT_MIN && acc != null && acc <= 0.4) out.push('quiz-weak')
    out.push(p.customerPhone ? 'identified' : 'anonymous')

    for (const [cat, c] of Object.entries(kn.byCat || {})) {
      const a = num(c.answered)
      if (a >= CAT_MIN && num(c.correct) / a >= CAT_STRONG) out.push(`quiz-strong-${safeId(cat) || 'cat'}`)
    }
  } catch (_) { /* a tagging failure must never break a write */ }
  return out.slice(0, MAX_TAGS)
}

export function tagLabel(tag, ar = true) {
  const hit = TAG_RULES.find((t) => t.id === tag)
  if (hit) return ar ? hit.ar : hit.id
  if (tag.startsWith('quiz-strong-')) {
    const cat = tag.slice('quiz-strong-'.length)
    return ar ? `قوي في: ${cat}` : `strong: ${cat}`
  }
  return tag
}

export function tagRule(tag, ar = true) {
  const hit = TAG_RULES.find((t) => t.id === tag)
  if (hit) return ar ? hit.rule : hit.ruleEn
  if (tag.startsWith('quiz-strong-')) {
    return ar
      ? `أجاب ${CAT_MIN} سؤالاً فأكثر في هذا التصنيف بنسبة صحة ${Math.round(CAT_STRONG * 100)}% فما فوق.`
      : `${CAT_MIN}+ answers in this category at ${Math.round(CAT_STRONG * 100)}%+.`
  }
  return ''
}

// --------------------------------------------------------------------------
// AI snapshot for ONE player. This is the only thing about a player that ever
// reaches a model — computed figures, no raw documents, no free text beyond the
// questions the guest actually saw.
// --------------------------------------------------------------------------
export function playerAiSnapshot(profile, plays = []) {
  const p = profile || {}
  const list = Array.isArray(plays) ? plays : []
  const finished = list.filter((x) => num(x.durationMs) > 0)
  const answered = num((p.knowledge || {}).answered)
  const correct = num((p.knowledge || {}).correct)

  return {
    deviceId: p.deviceId || null,
    identified: Boolean(p.customerPhone),
    name: p.customerName || null,
    firstAt: p.firstAt || null,
    lastAt: p.lastAt || null,
    totalPlays: num(p.totalPlays),
    completedPlays: num(p.completedPlays),
    completionRate: num(p.totalPlays) > 0 ? round2(num(p.completedPlays) / num(p.totalPlays)) : null,
    avgDurationSec: finished.length ? Math.round(finished.reduce((s, x) => s + num(x.durationMs), 0) / finished.length / 1000) : null,
    totalScore: num(p.totalScore),
    byGame: Object.entries(p.byGame || {}).map(([gameId, g]) => ({
      gameId, plays: num(g.plays), best: num(g.best), stage: num(g.stage),
    })),
    knowledge: {
      answered,
      correct,
      accuracy: answered > 0 ? round2(correct / answered) : null,
      thinSample: answered < CAT_MIN,
      byCat: Object.entries((p.knowledge || {}).byCat || {}).map(([cat, c]) => ({
        cat,
        answered: num(c.answered),
        correct: num(c.correct),
        accuracy: num(c.answered) > 0 ? round2(num(c.correct) / num(c.answered)) : null,
        thinSample: num(c.answered) < CAT_MIN,
      })),
    },
    // Self-report, not a diagnosis. The label is carried through verbatim so the
    // model cannot upgrade it into a clinical claim.
    insight: p.insight ? { archetype: p.insight.archetype, traits: p.insight.traits || {}, basis: 'self-report items inside a menu mini-game' } : null,
    tags: p.tags || [],
    tagRulesApplied: (p.tags || []).map((t) => ({ tag: t, rule: tagRule(t, false) })),
    recentAnswers: list.slice(0, 3).flatMap((x) => (x.answers || []).slice(0, 8).map((a) => ({
      game: x.gameId, q: a.q, choice: a.choice, correct: a.correct,
    }))).slice(0, 24),
  }
}

const round2 = (n) => Math.round(n * 100) / 100

// The guard prefixed to every model call that touches play data.
export const PLAY_AI_GUARD_AR = [
  'أنت محلل بيانات داخل نظام مطاعم ومقاهٍ. أمامك لقطة JSON واحدة فيها أرقام محسوبة مسبقاً عن نشاط الضيوف في ألعاب المنيو.',
  '',
  'قواعد ملزمة، مخالفتها خطأ فادح:',
  '1. لا تستخدم أي رقم غير موجود حرفياً في اللقطة المرفقة. ممنوع تماماً تقدير أو استنتاج أو اختراع أي رقم.',
  '2. إذا كان الرقم المطلوب غير موجود في اللقطة، قل صراحة: «هذا الرقم غير متاح في البيانات» ولا تعوّضه بتخمين.',
  '3. أي حقل عليه thinSample=true يعني أن العينة صغيرة. اذكر ذلك صراحة قبل أي استنتاج مبني عليه، ولا تبنِ توصية حاسمة على عينة صغيرة.',
  '4. ما يسمى «النمط» أو archetype ناتج عن إجابات اختيارية تركها الضيف بنفسه داخل لعبة في المنيو. هو وصف ذاتي وليس تشخيصاً نفسياً ولا حكماً على شخص. لا تقدّمه كحقيقة علمية ولا تبنِ عليه ادعاءً طبياً أو نفسياً.',
  '5. ممنوع منعاً باتاً أي ربط بالأبراج أو الأرقام أو التنجيم أو أي ادعاء غيبي. التحليل سلوكي رقمي فقط.',
  '6. لا تخترع أسماء ضيوف ولا أرقام جوال. الجمهور يُبنى من قوائم النظام نفسها وليس من كلامك.',
  '7. اكتب بالعربية، بإيجاز، وبتوصيات قابلة للتنفيذ اليوم. اذكر بجانب كل توصية الرقم الذي بنيتها عليه.',
].join('\n')

// Venue-level guard is the same contract; exported under a second name so the
// admin page reads clearly at the call site.
export const PLAY_AI_GUARD = PLAY_AI_GUARD_AR

// --------------------------------------------------------------------------
// Recovery: if a tab died mid-play, the local mirror still holds the record.
// Called once by the hub on mount so nothing is silently lost.
// --------------------------------------------------------------------------
export function recoverPending(tid) {
  try {
    const stored = readLS(LS_LIVE, {})
    let n = 0
    for (const [playId, slot] of Object.entries(stored)) {
      if (!slot || !slot.rec) continue
      if (tid && slot.tid !== tid) continue
      if (LIVE.has(playId)) continue
      LIVE.set(playId, { tid: slot.tid, rec: slot.rec, dirty: true })
      n += 1
    }
    if (n) schedule()
    return n
  } catch (_) { return 0 }
}

// Read-only peek at a live record (used by tests and by the hub's debug view).
export function peekPlay(playId) {
  const slot = LIVE.get(playId)
  return slot ? { ...slot.rec } : null
}
