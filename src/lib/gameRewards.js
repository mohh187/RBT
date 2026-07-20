// Real, venue-configured rewards for «ركن الألعاب».
//
// THE HONESTY CONTRACT (this is the whole point of the file):
//   A guest is NEVER told about a prize that does not exist. There is no
//   "maybe next time", no "you were close". A reward is shown only when the
//   venue configured it, it is currently active, it is fully valid, and the
//   guest actually met its condition. Every reward carries the exact condition
//   it satisfied and the exact way to claim it.
//
// Anything half-configured (a free item with no name, a discount with no
// percentage, an unknown metric) is DROPPED at normalization time rather than
// shown as a vague promise. `normalizeRules` is therefore the enforcement
// point: the UI can render whatever comes out of it without second-guessing.
//
// Config lives on the tenant doc:
//   tenant.gameRewards = {
//     enabled: bool,
//     note: string,                 // optional venue-written line, shown as-is
//     rules: [{
//       id, gameId | 'any',
//       metric: 'score' | 'completed' | 'stage',
//       threshold: number,
//       prize: { kind: 'discount'|'freeItem'|'points', value, itemId, code, label },
//       perGuest: 'once' | 'daily',
//       active: bool,
//     }]
//   }
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, firebaseReady } from './firebase.js'

// ---------------------------------------------------------------------------
// vocabulary (also consumed by the venue-side settings editor)
// ---------------------------------------------------------------------------
export const REWARD_METRICS = [
  { id: 'score', ar: 'مجموع النقاط في الجولة', en: 'Round score', needsThreshold: true },
  { id: 'stage', ar: 'الوصول لمرحلة', en: 'Reaching a stage', needsThreshold: true },
  { id: 'completed', ar: 'إكمال اللعبة', en: 'Completing the game', needsThreshold: false },
]

export const PRIZE_KINDS = [
  { id: 'discount', ar: 'خصم على الفاتورة', en: 'Bill discount' },
  { id: 'freeItem', ar: 'صنف مجاني', en: 'Free item' },
  { id: 'points', ar: 'نقاط ولاء', en: 'Loyalty points' },
]

export const PER_GUEST = [
  { id: 'once', ar: 'مرة واحدة لكل ضيف', en: 'Once per guest' },
  { id: 'daily', ar: 'مرة كل يوم', en: 'Once per day' },
]

const METRIC_IDS = REWARD_METRICS.map((m) => m.id)
const KIND_IDS = PRIZE_KINDS.map((k) => k.id)

// Latin digits, always (hard rule).
const num = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 2 })

// 'YYYY-MM-DD' local (en-CA gives ISO order with Latin digits).
export function today(d = new Date()) {
  return d.toLocaleDateString('en-CA')
}
export function thisMonth(d = new Date()) {
  return d.toLocaleDateString('en-CA').slice(0, 7)
}

// ---------------------------------------------------------------------------
// normalization — the gate that keeps empty promises out of the UI
// ---------------------------------------------------------------------------
function normalizePrize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const kind = KIND_IDS.includes(raw.kind) ? raw.kind : ''
  if (!kind) return null
  const value = Number(raw.value)
  const label = String(raw.label || '').trim().slice(0, 60)
  const itemId = String(raw.itemId || '').trim()
  const code = String(raw.code || '').trim().slice(0, 24)

  // A discount must be a usable percentage.
  if (kind === 'discount' && (!Number.isFinite(value) || value <= 0 || value > 100)) return null
  // Loyalty points must be a positive whole number.
  if (kind === 'points' && (!Number.isFinite(value) || value < 1)) return null
  // A free item the guest cannot name is not a prize — it is a rumour.
  if (kind === 'freeItem' && !label && !itemId) return null

  return {
    kind,
    value: Number.isFinite(value) ? value : 0,
    label,
    itemId,
    code,
  }
}

export function normalizeRule(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null
  if (raw.active === false) return null
  const metric = METRIC_IDS.includes(raw.metric) ? raw.metric : ''
  if (!metric) return null
  const prize = normalizePrize(raw.prize)
  if (!prize) return null

  const needsThreshold = metric !== 'completed'
  const threshold = Math.floor(Number(raw.threshold))
  if (needsThreshold && (!Number.isFinite(threshold) || threshold <= 0)) return null

  return {
    id: String(raw.id || `r${index + 1}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || `r${index + 1}`,
    gameId: String(raw.gameId || 'any').trim() || 'any',
    metric,
    threshold: needsThreshold ? threshold : 0,
    prize,
    perGuest: raw.perGuest === 'daily' ? 'daily' : 'once',
  }
}

export function rewardsEnabled(tenant) {
  return Boolean(tenant?.gameRewards?.enabled)
}

// Every valid, active rule this venue currently offers.
export function normalizeRules(tenant) {
  if (!rewardsEnabled(tenant)) return []
  const list = tenant?.gameRewards?.rules
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  list.forEach((raw, i) => {
    const r = normalizeRule(raw, i)
    if (!r || seen.has(r.id)) return
    seen.add(r.id)
    out.push(r)
  })
  return out
}

// The rules that can fire for one game (a rule with gameId 'any' fires for all).
// Called with no gameId it returns everything on offer — that is what the
// promo screen and the "what you can win" strip render.
export function rewardsFor(tenant, gameId) {
  const all = normalizeRules(tenant)
  if (!gameId) return all
  return all.filter((r) => r.gameId === 'any' || r.gameId === gameId)
}

// The venue's own free-text line, shown verbatim and only when it exists.
export function rewardsNote(tenant) {
  if (!rewardsEnabled(tenant)) return ''
  return String(tenant?.gameRewards?.note || '').trim().slice(0, 200)
}

// ---------------------------------------------------------------------------
// human text — exact, never vague
// ---------------------------------------------------------------------------
// `itemName` lets the caller resolve prize.itemId against the live menu; when it
// cannot, the configured label is used. One of the two always exists (enforced
// by normalizePrize), so this never renders a nameless prize.
export function claimText(prize, { itemName = '' } = {}) {
  if (!prize) return ''
  if (prize.kind === 'discount') return `خصم ${num(prize.value)}٪ على فاتورتك`
  if (prize.kind === 'points') return `${num(prize.value)} نقطة في برنامج ولاء المكان`
  const nm = String(itemName || prize.label || '').trim()
  return nm ? `${nm} مجاناً` : ''
}

export function claimTextEn(prize, { itemName = '' } = {}) {
  if (!prize) return ''
  if (prize.kind === 'discount') return `${prize.value}% off your bill`
  if (prize.kind === 'points') return `${prize.value} loyalty points`
  const nm = String(itemName || prize.label || '').trim()
  return nm ? `Free ${nm}` : ''
}

// The condition, stated exactly as it was evaluated.
export function conditionText(rule, gameName = '') {
  if (!rule) return ''
  const where = gameName ? ` في «${gameName}»` : ''
  if (rule.metric === 'completed') return `بإكمال اللعبة${where}`
  if (rule.metric === 'stage') return `بالوصول إلى المرحلة ${num(rule.threshold)}${where}`
  return `بتسجيل ${num(rule.threshold)} نقطة أو أكثر${where}`
}

export function perGuestText(rule) {
  if (!rule) return ''
  return rule.perGuest === 'daily' ? 'مرة واحدة كل يوم' : 'مرة واحدة فقط لكل ضيف'
}

// How to actually get it. There is no automatic redemption anywhere in the
// product, so the instruction is the truth: show the code to the cashier.
export const HOW_TO_CLAIM = 'أظهر هذا الرمز للكاشير قبل الدفع'

// ---------------------------------------------------------------------------
// codes
// ---------------------------------------------------------------------------
// Ambiguous glyphs (O/0, I/1, S/5, B/8, Z/2) are left out so a code read off a
// phone screen by a cashier cannot be mistyped.
const ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679'

function hashCode(s, len) {
  let h = 2166136261
  const str = String(s)
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  let out = ''
  for (let i = 0; i < len; i += 1) {
    out += ALPHABET[h % ALPHABET.length]
    h = Math.floor(h / ALPHABET.length) + Math.imul(h, 2654435761) % 100000
    h >>>= 0
  }
  return out
}

// A venue-fixed coupon code wins when configured; otherwise a stable code is
// derived from rule + device + entitlement window, so the SAME entitlement
// always shows the SAME code (the guest can reopen the hub and read it again)
// while two guests never share one.
export function rewardCode(rule, { deviceId = '', day = today() } = {}) {
  if (!rule) return ''
  if (rule.prize?.code) return rule.prize.code.toUpperCase()
  const scope = rule.perGuest === 'daily' ? day : 'once'
  return `RB-${hashCode(`${rule.id}|${rule.gameId}`, 3)}-${hashCode(`${rule.id}|${deviceId}|${scope}`, 5)}`
}

// ---------------------------------------------------------------------------
// the device-local claim ledger
//
// LIMIT, stated plainly: this ledger lives in the guest's own browser. It stops
// the hub from handing the same prize out twice and it survives a reload, but a
// guest who clears storage or switches phone can be offered it again. The
// cashier is the real gate — the code is what they check, and `recordClaim`
// mirrors every issued code to Firestore so staff can see it.
// ---------------------------------------------------------------------------
const claimsKey = (tid) => `rbt_game_claims_${tid || 'x'}`

export function readClaims(tid) {
  try {
    const v = JSON.parse(localStorage.getItem(claimsKey(tid)) || '[]')
    return Array.isArray(v) ? v.filter((c) => c && c.ruleId) : []
  } catch (_) {
    return []
  }
}

export function writeClaims(tid, claims) {
  try {
    localStorage.setItem(claimsKey(tid), JSON.stringify((claims || []).slice(-60)))
  } catch (_) { /* storage off — the reveal still works, it just is not remembered */ }
}

// Accepts the ledger array, a plain array of rule ids, or a Set.
function claimList(claimedBefore) {
  if (!claimedBefore) return []
  if (claimedBefore instanceof Set) return [...claimedBefore].map((id) => ({ ruleId: String(id) }))
  if (!Array.isArray(claimedBefore)) return []
  return claimedBefore.map((c) => (typeof c === 'string' ? { ruleId: c } : c)).filter((c) => c && c.ruleId)
}

export function hasClaimed(claimedBefore, rule, day = today()) {
  if (!rule) return false
  const list = claimList(claimedBefore)
  return list.some((c) => c.ruleId === rule.id && (rule.perGuest === 'daily' ? c.day === day : true))
}

// ---------------------------------------------------------------------------
// evaluation
// ---------------------------------------------------------------------------
function meets(rule, run) {
  if (rule.metric === 'completed') return run.completed === true
  if (rule.metric === 'stage') return Math.floor(Number(run.stage) || 0) >= rule.threshold
  return Math.floor(Number(run.score) || 0) >= rule.threshold
}

// Ranking when several rules fire at once: an unclaimed prize beats an already
// claimed one, then the harder condition, then the richer prize.
function prizeWeight(prize) {
  if (prize.kind === 'freeItem') return 1000
  if (prize.kind === 'discount') return 500 + prize.value
  return prize.value
}

// Returns null when there is NOTHING truthful to show — rewards off, none
// configured for this game, or the guest did not meet any condition. The caller
// renders exactly nothing in that case; no hints, no near-misses.
//
// Returns an object when a real, configured reward was actually earned:
//   { rule, prize, code, prizeText, conditionText, perGuestText, howTo,
//     alreadyClaimed, day }
export function evaluateReward(tenant, run = {}, claimedBefore = [], opts = {}) {
  const rules = rewardsFor(tenant, run.gameId)
  if (!rules.length) return null
  const won = rules.filter((r) => meets(r, run))
  if (!won.length) return null

  const day = opts.day || today()
  const ranked = won
    .map((r) => ({ r, claimed: hasClaimed(claimedBefore, r, day) }))
    .sort((a, b) => (
      (a.claimed === b.claimed ? 0 : a.claimed ? 1 : -1)
      || b.r.threshold - a.r.threshold
      || prizeWeight(b.r.prize) - prizeWeight(a.r.prize)
    ))

  const { r: rule, claimed } = ranked[0]
  // The winning rule is only known here, so the item name is resolved now —
  // callers pass a resolver rather than a pre-resolved name.
  let itemName = opts.itemName || ''
  if (!itemName && typeof opts.resolveItemName === 'function') {
    try { itemName = opts.resolveItemName(rule.prize.itemId) || '' } catch (_) { itemName = '' }
  }
  const prizeText = claimText(rule.prize, { itemName })
  if (!prizeText) return null // unnameable prize: say nothing rather than something vague

  return {
    rule,
    prize: rule.prize,
    code: rewardCode(rule, { deviceId: opts.deviceId, day }),
    prizeText,
    conditionText: conditionText(rule, opts.gameName),
    perGuestText: perGuestText(rule),
    howTo: HOW_TO_CLAIM,
    alreadyClaimed: claimed,
    day,
  }
}

// Marks the entitlement as issued on this device and mirrors it to Firestore so
// the venue can see (and later reconcile) what was handed out. The remote write
// is best-effort: if rules deny it or the device is offline the guest still has
// a valid code on screen, which is all the cashier needs.
export function claimReward(tid, earned, meta = {}) {
  if (!earned?.rule) return null
  const entry = {
    ruleId: earned.rule.id,
    gameId: meta.gameId || earned.rule.gameId,
    code: earned.code,
    kind: earned.prize.kind,
    value: earned.prize.value,
    label: earned.prize.label || '',
    text: earned.prizeText,
    day: earned.day || today(),
    at: Date.now(),
  }
  const ledger = readClaims(tid)
  if (!ledger.some((c) => c.ruleId === entry.ruleId && c.day === entry.day && c.code === entry.code)) {
    ledger.push(entry)
    writeClaims(tid, ledger)
  }
  recordClaimRemote(tid, earned, meta).catch(() => { /* best-effort mirror */ })
  return entry
}

const safeId = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)

// tenants/{tid}/gameRewardClaims/{deviceId}_{ruleId}_{scope}
// The id is deterministic (one doc per entitlement), so a guest cannot spam
// rows and a re-reveal overwrites instead of duplicating.
export async function recordClaimRemote(tid, earned, meta = {}) {
  if (!firebaseReady || !db || !tid || !earned?.rule) return false
  const scope = earned.rule.perGuest === 'daily' ? (earned.day || today()) : 'once'
  const id = `${safeId(meta.deviceId)}_${safeId(earned.rule.id)}_${safeId(scope)}`
  await setDoc(doc(db, 'tenants', tid, 'gameRewardClaims', id), {
    ruleId: earned.rule.id,
    gameId: meta.gameId || earned.rule.gameId,
    metric: earned.rule.metric,
    threshold: earned.rule.threshold,
    perGuest: earned.rule.perGuest,
    prizeKind: earned.prize.kind,
    prizeValue: earned.prize.value,
    prizeLabel: earned.prize.label || '',
    itemId: earned.prize.itemId || '',
    prizeText: earned.prizeText,
    code: earned.code,
    score: Math.max(0, Math.floor(Number(meta.score) || 0)),
    stage: Math.max(0, Math.floor(Number(meta.stage) || 0)),
    name: String(meta.name || '').slice(0, 40),
    phone: String(meta.phone || '').slice(0, 20),
    deviceId: String(meta.deviceId || '').slice(0, 64),
    day: earned.day || today(),
    month: thisMonth(),
    redeemed: false,
    at: serverTimestamp(),
  }, { merge: true })
  return true
}
