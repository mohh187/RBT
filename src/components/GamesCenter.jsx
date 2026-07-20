// «ركن الألعاب» — the guest-facing games hub.
//
// Four screens, one overlay:
//   promo   the marketing splash, first open only (GamePromo)
//   browse  the player card + category-grouped game cards
//   gate    name + phone, shown only when the guest is not registered yet,
//           and on submit the chosen game opens IMMEDIATELY
//   play    the shell (title, live score, restart, close) around a game
//
// Games render their play area only — the shell here owns all chrome. Progress
// reported through onProgress is persisted per game and handed back as
// resumeState next time, so a multi-stage game continues where it stopped.
//
// Rewards are never invented: everything shown comes from gameRewards.js, which
// drops any rule that is not fully, validly configured by the venue.
import '../styles/gameshub.css'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import GamePromo, { GameThumb, gameName, gameHook, gameArt } from './games/GamePromo.jsx'
import { gamesFor, gameById } from '../lib/games.js'
import { startPlay, saveProgress, finishPlay, updatePlayerProfile } from '../lib/gameMemory.js'
import { registerCustomer } from '../lib/db.js'
import { getLocalCustomer, setLocalCustomer } from '../lib/customer.js'
import { submitScore, watchTopScores, currentMonth, myRank } from '../lib/leaderboard.js'
import { deviceKey } from '../lib/device.js'
import {
  rewardsFor, rewardsNote, evaluateReward, claimReward, readClaims,
  claimText, conditionText, perGuestText, HOW_TO_CLAIM,
} from '../lib/gameRewards.js'

const TXT = {
  ar: {
    hub: 'ركن الألعاب',
    close: 'إغلاق',
    back: 'رجوع',
    restart: 'إعادة من البداية',
    loading: 'جارٍ تحميل اللعبة...',
    gateTitle: 'اسمك ورقمك، ثم نبدأ',
    gateWhy: 'نحفظ نتائجك ومراحلك على هذا الجهاز، ونسجّلك لدى المكان.',
    gateFor: 'ستفتح لك',
    name: 'الاسم',
    phone: 'رقم الجوال',
    namePh: 'اسمك',
    errName: 'اكتب اسمك أولاً.',
    errPhone: 'أدخل رقم جوال سعودي صحيح يبدأ بـ 05.',
    go: 'ابدأ اللعب',
    confirm: 'تأكيد وابدأ',
    saving: 'جارٍ التسجيل...',
    offline: 'تعذّر حفظ تسجيلك لدى المكان الآن، لكن نتائجك محفوظة على جهازك ويمكنك اللعب.',
    hello: 'أهلاً',
    points: 'نقطة',
    plays: 'جولة',
    rank: 'ترتيبك',
    of: 'من',
    best: 'أفضلك',
    bestList: 'أفضل نتائجك',
    noBest: 'لم تلعب بعد',
    resume: 'مراحل محفوظة',
    prize: 'جائزة',
    all: 'الكل',
    empty: 'لم يفعّل هذا المكان أي لعبة بعد.',
    emptyHint: 'اسأل الموظفين — يمكنهم تفعيل الألعاب من لوحة التحكم.',
    boardNote: 'لوحة الصدارة الشهرية تعرض أفضل نتيجة في جولة واحدة.',
    rewardsH: 'جوائز هذا المكان',
    archetype: 'نمطك',
    won: 'ربحت جائزة',
    wonAgain: 'حققت الشرط مرة أخرى',
    already: 'سبق أن حصلت على هذه المكافأة، وهي لا تُمنح أكثر من مرة.',
    code: 'رمز الاستلام',
    condition: 'استحققتها',
    limit: 'الحد',
    done: 'تمام',
  },
  en: {
    hub: 'Games Corner',
    close: 'Close',
    back: 'Back',
    restart: 'Restart',
    loading: 'Loading the game...',
    gateTitle: 'Your name and number, then we start',
    gateWhy: 'We keep your scores and stages on this device, and register you with the venue.',
    gateFor: 'Opening',
    name: 'Name',
    phone: 'Mobile number',
    namePh: 'Your name',
    errName: 'Please enter your name.',
    errPhone: 'Enter a valid Saudi mobile number starting with 05.',
    go: 'Start playing',
    confirm: 'Confirm and start',
    saving: 'Registering...',
    offline: 'We could not save your registration with the venue right now, but your scores are kept on this device.',
    hello: 'Hello',
    points: 'points',
    plays: 'rounds',
    rank: 'Rank',
    of: 'of',
    best: 'Best',
    bestList: 'Your best scores',
    noBest: 'Not played yet',
    resume: 'Saved stages',
    prize: 'Prize',
    all: 'All',
    empty: 'This venue has not enabled any game yet.',
    emptyHint: 'Staff can enable games from the dashboard.',
    boardNote: 'The monthly board shows the best single-round score.',
    rewardsH: 'Rewards at this venue',
    archetype: 'Your type',
    won: 'You won a reward',
    wonAgain: 'You met the condition again',
    already: 'You already received this reward; it is not given twice.',
    code: 'Claim code',
    condition: 'Earned by',
    limit: 'Limit',
    done: 'Done',
  },
}

// ---------------------------------------------------------------------------
// categories
// ---------------------------------------------------------------------------
// Order is the editorial decision of this screen. What a waiting guest has
// never seen anywhere else comes first — a read of their own personality —
// then things that leave them knowing something, then pure reflex play. The
// first shelf renders as a hero, so this order also decides what dominates.
const CATS = [
  { id: 'insight', ar: 'اكتشف شخصيتك', en: 'Discover yourself', icon: 'user', hero: true, tag: 'الأكثر إدهاشاً' },
  { id: 'trivia', ar: 'معرفة وثقافة', en: 'Knowledge', icon: 'notepad', tag: 'تخرج وقد عرفت' },
  { id: 'puzzle', ar: 'ذكاء وألغاز', en: 'Brains & puzzles', icon: 'shapes', tag: 'مراحل متصاعدة' },
  { id: 'arcade', ar: 'تسلية وسرعة', en: 'Arcade & speed', icon: 'zap', tag: 'جولة سريعة' },
]
const CAT_IDS = CATS.map((c) => c.id)

// The registry carries `kind`. These synonyms and the per-id map keep older /
// differently-worded entries in the right shelf instead of silently vanishing.
const KIND_SYNONYMS = {
  skill: 'arcade', speed: 'arcade', reflex: 'arcade', luck: 'arcade', action: 'arcade',
  memory: 'puzzle', logic: 'puzzle', word: 'puzzle', brain: 'puzzle',
  quiz: 'trivia', knowledge: 'trivia', culture: 'trivia', facts: 'trivia',
  personality: 'insight', psych: 'insight', profile: 'insight', self: 'insight',
}
const ID_CATS = {
  fishing: 'arcade', waiterDash: 'arcade', prizeWheel: 'arcade', catchBasket: 'arcade',
  cakeTower: 'arcade', latteArt: 'arcade', perfectGrill: 'arcade',
  orderRush: 'puzzle', spiceMatch: 'puzzle', bubblePop: 'puzzle',
  tasteQuiz: 'trivia',
}
function catOf(g) {
  const k = String(g?.kind || '').trim()
  if (CAT_IDS.includes(k)) return k
  if (KIND_SYNONYMS[k]) return KIND_SYNONYMS[k]
  return ID_CATS[g?.id] || 'arcade'
}

// ---------------------------------------------------------------------------
// the per-device store
// ---------------------------------------------------------------------------
const storeKey = (tid) => `rbt_games_${tid || 'x'}`
const EMPTY_STORE = {
  v: 2, registered: false, name: '', phone: '', points: 0, plays: 0,
  best: {}, resume: {}, promoSeen: false, archetype: '', archetypeGame: '', archetypeAt: 0,
}
const MAX_RESUME_BYTES = 20000

function readStore(tid) {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(tid)) || 'null')
    if (!v || typeof v !== 'object') return { ...EMPTY_STORE }
    return { ...EMPTY_STORE, ...v, best: { ...(v.best || {}) }, resume: { ...(v.resume || {}) } }
  } catch (_) {
    return { ...EMPTY_STORE }
  }
}
function writeStore(tid, s) {
  try { localStorage.setItem(storeKey(tid), JSON.stringify(s)) } catch (_) { /* storage off */ }
}

// Arabic-Indic digits are written as escapes on purpose: the repo hard-rule
// forbids the literal glyphs in source, but guests still type them.
function toLatinDigits(s) {
  return String(s || '').replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (c) => {
    const code = c.charCodeAt(0)
    return String(code - (code >= 0x06F0 ? 0x06F0 : 0x0660))
  })
}

// Saudi mobile: 05XXXXXXXX, also accepting +966 / 00966 / 966 prefixes.
// Returns the normalized 05XXXXXXXX, or '' when it is not a valid number.
export function normalizeSaPhone(raw) {
  let n = toLatinDigits(raw).replace(/\D/g, '')
  if (n.startsWith('00966')) n = n.slice(5)
  else if (n.startsWith('966')) n = n.slice(3)
  if (/^5\d{8}$/.test(n)) n = `0${n}`
  return /^05\d{8}$/.test(n) ? n : ''
}

function safeBrand(tenant) {
  const c = String(tenant?.themeColor || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v
  } catch (_) { /* SSR / no document */ }
  return '#0e7490'
}

const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

// ---------------------------------------------------------------------------
// optional shared game memory (src/lib/gameMemory.js)
//
// import.meta.glob is used instead of a plain dynamic import on purpose: when
// the file does not exist the glob is simply empty at build time, whereas a
// dynamic import of a missing path fails the build. The hub's own localStorage
// resume is always authoritative — this is a mirror, never a dependency.
// ---------------------------------------------------------------------------
const MEMORY_MODULES = import.meta.glob('../lib/gameMemory.js')
let memoryPromise = null
function loadGameMemory() {
  if (!memoryPromise) {
    const loader = MEMORY_MODULES['../lib/gameMemory.js']
    memoryPromise = loader ? loader().catch(() => null) : Promise.resolve(null)
  }
  return memoryPromise
}
const pickFn = (mod, names) => {
  for (const nm of names) if (typeof mod?.[nm] === 'function') return mod[nm]
  return null
}
const MEM_SAVE = ['saveProgress', 'setProgress', 'saveGameState', 'writeProgress', 'remember', 'save']
const MEM_LOAD = ['loadProgress', 'getProgress', 'readProgress', 'loadGameState', 'recall', 'load']
const MEM_CLEAR = ['clearProgress', 'resetProgress', 'removeProgress', 'forget', 'clear']

function memCall(fn, tid, gameId, state) {
  if (!fn) return undefined
  try {
    return state === undefined ? fn(tid, gameId) : fn(tid, gameId, state)
  } catch (_) {
    try {
      return state === undefined ? fn(gameId) : fn(gameId, state)
    } catch (__) {
      return undefined
    }
  }
}

// An insight game reports its result through onProgress; this pulls the
// archetype out of whatever shape it used, without guessing when it is absent.
function readArchetype(p) {
  const cand = p?.archetype ?? p?.result?.archetype ?? p?.profile ?? p?.result?.type ?? p?.type
  if (typeof cand === 'string') return cand.trim().slice(0, 40)
  if (cand && typeof cand === 'object') {
    return String(cand.ar || cand.label || cand.title || cand.name || '').trim().slice(0, 40)
  }
  return ''
}

export default function GamesCenter({ open, onClose, tenantId, tenant, items = [], lang = 'ar', onIdentify, onGamePlay }) {
  const t = TXT[lang] || TXT.ar
  const brand = useMemo(() => safeBrand(tenant), [tenant])
  const deviceId = useMemo(() => deviceKey(), [])
  const enabled = useMemo(() => gamesFor(tenant), [tenant])

  const [store, setStore] = useState(() => readStore(tenantId))
  const [view, setView] = useState(() => (readStore(tenantId).promoSeen ? 'browse' : 'promo'))
  const [pendingId, setPendingId] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [runKey, setRunKey] = useState(0)
  const [runScore, setRunScore] = useState(0)
  const [board, setBoard] = useState(null)
  const [cat, setCat] = useState('all')
  const [memResume, setMemResume] = useState({})
  const [reveal, setReveal] = useState(null)

  const runScoreRef = useRef(0)
  const activeRef = useRef(null)
  const playIdRef = useRef('') // the open durable play record for this round
  const progressRef = useRef({ stage: 0, completed: false })
  const resumeRef = useRef(null)
  const revealedRef = useRef(new Set())

  useEffect(() => { runScoreRef.current = runScore }, [runScore])
  useEffect(() => { activeRef.current = activeId }, [activeId])
  useEffect(() => {
    const s = readStore(tenantId)
    setStore(s)
    setView(s.promoSeen ? 'browse' : 'promo')
    setActiveId(null)
    setPendingId('')
    setReveal(null)
  }, [tenantId])

  // ---- rewards (validated config only) ----
  const allRewards = useMemo(() => rewardsFor(tenant), [tenant])
  const note = useMemo(() => rewardsNote(tenant), [tenant])
  const rewardGameIds = useMemo(() => new Set(allRewards.map((r) => r.gameId)), [allRewards])
  const hasAnyReward = rewardGameIds.has('any')

  const resolveItemName = useCallback((itemId) => {
    if (!itemId) return ''
    const it = (items || []).find((x) => x?.id === itemId)
    if (!it) return ''
    return String((lang === 'en' ? it.nameEn : it.nameAr) || it.nameAr || it.nameEn || '').trim()
  }, [items, lang])

  const nameOfGame = useCallback((id) => {
    const g = enabled.find((x) => x.id === id)
    return g ? gameName(g, lang) : ''
  }, [enabled, lang])

  // One honest line per configured rule: what it is, and exactly how it is won.
  const rewardLine = useCallback((r) => {
    const prize = claimText(r.prize, { itemName: resolveItemName(r.prize.itemId) })
    if (!prize) return null
    const where = r.gameId === 'any' ? '' : nameOfGame(r.gameId)
    return `${prize} — ${conditionText(r, where)}`
  }, [resolveItemName, nameOfGame])

  // ---- registration gate ----
  const localCustomer = useMemo(() => getLocalCustomer(), [])
  const [form, setForm] = useState({ name: '', phone: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState('')

  useEffect(() => {
    // Prefill from the device so a returning guest confirms with one tap.
    setForm({ name: store.name || localCustomer?.name || '', phone: store.phone || localCustomer?.phone || '' })
  }, [store.name, store.phone, localCustomer])

  // ---- resume state ----
  const resumeFor = useCallback((id) => {
    if (memResume[id]) return memResume[id]
    const r = store.resume?.[id]
    return r?.state || null
  }, [memResume, store.resume])

  // Mirror-read every enabled game's saved state once, if the shared memory
  // module exists. Failures are silent: the local store already covers resume.
  useEffect(() => {
    if (!open || !enabled.length) return undefined
    let dead = false
    loadGameMemory().then(async (mod) => {
      const fn = pickFn(mod, MEM_LOAD)
      if (!fn || dead) return
      const out = {}
      for (const g of enabled) {
        try {
          const v = await memCall(fn, tenantId, g.id)
          if (v && typeof v === 'object') out[g.id] = v.state && typeof v.state === 'object' ? v.state : v
        } catch (_) { /* per-game, never fatal */ }
      }
      // merge, never replace: anything written during this session is fresher
      // than what the module had when the hub opened
      if (!dead && Object.keys(out).length) setMemResume((m) => ({ ...out, ...m }))
    })
    return () => { dead = true }
  }, [open, enabled, tenantId])

  // ---- monthly board (for the rank line only) ----
  const registered = store.registered
  useEffect(() => {
    if (!open || !registered || !tenantId) return undefined
    const unsub = watchTopScores(tenantId, currentMonth(), (b) => setBoard(b))
    return () => { try { unsub?.() } catch (_) { /* already gone */ } }
  }, [open, registered, tenantId])

  const rank = board && !board.error ? myRank(board.scores, deviceId) : null

  // ---- runs ----
  // Leaving the shelves must not lose the guest's place: a hub with four
  // shelves scrolls, and returning to the top after every round would make
  // browsing feel punishing. The offset is captured on the way out and
  // reapplied after the browse view has painted.
  const scrollRef = useRef(null)
  const savedScroll = useRef(0)
  const rememberScroll = useCallback(() => {
    savedScroll.current = scrollRef.current ? scrollRef.current.scrollTop : 0
  }, [])
  const restoreScroll = useCallback(() => {
    const y = savedScroll.current
    if (!y) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = y
      })
    })
  }, [])

  const startGame = useCallback((id) => {
    rememberScroll()
    // Open a durable play record for this round. It is fire-and-forget: if the
    // write fails the guest still plays, and the local store still counts it.
    try {
      const g = gameById(id)
      playIdRef.current = startPlay({
        tid: tenantId,
        gameId: id,
        gameAr: g?.ar || '',
        kind: g?.kind || 'arcade',
        deviceId,
        player: { name: store.name || '', phone: store.phone || '' },
      }) || ''
    } catch (_) { playIdRef.current = '' }
    resumeRef.current = resumeFor(id)
    progressRef.current = { stage: 0, completed: false }
    setRunScore(0)
    runScoreRef.current = 0
    setActiveId(id)
    setRunKey((k) => k + 1)
    setView('play')
  }, [resumeFor, rememberScroll, tenantId, deviceId, store.name, store.phone])

  const pickGame = useCallback((id) => {
    if (!store.registered) { setPendingId(id); setErr(''); setView('gate'); return }
    startGame(id)
  }, [store.registered, startGame])

  const submitGate = async (e) => {
    e?.preventDefault?.()
    const nm = String(form.name || '').trim()
    if (nm.length < 2) { setErr(t.errName); return }
    const ph = normalizeSaPhone(form.phone)
    if (!ph) { setErr(t.errPhone); return }
    setErr('')
    setBusy(true)
    let ok = true
    try {
      // reuse the venue's real CRM registration, so the guest lands in it
      await registerCustomer(tenantId, { name: nm, phone: ph })
    } catch (_) {
      ok = false
    }
    setLocalCustomer({ name: nm, phone: ph })
    const next = { ...readStore(tenantId), registered: true, name: nm, phone: ph, promoSeen: true }
    writeStore(tenantId, next)
    setStore(next)
    setWarn(ok ? '' : t.offline)
    setBusy(false)
    try { onIdentify?.({ name: nm, phone: ph }) } catch (_) { /* caller's problem, not the guest's */ }
    // The game opens right now — no second tap, no "come back later".
    const target = pendingId || enabled[0]?.id
    setPendingId('')
    if (target) startGame(target)
    else setView('browse')
  }

  // A finished run adds to lifetime points, updates the per-game device best,
  // is offered to the shared monthly board, and is checked against the venue's
  // configured rewards (which return null when there is nothing true to say).
  // Returns the reward being revealed, or null — the caller needs to know,
  // because closing the hub on top of a fresh prize code would throw it away.
  const commitRun = useCallback(() => {
    const id = activeRef.current
    if (!id) return null
    const s = Math.max(0, Math.round(runScoreRef.current || 0))
    const prog = progressRef.current || {}
    // A quiz-style game may legitimately finish with no score; it is still a
    // round played, so it counts even though nothing goes to the board.
    const played = s > 0 || prog.completed === true || (prog.stage || 0) > 0
    if (played) {
      const prev = readStore(tenantId)
      const next = {
        ...prev,
        points: (prev.points || 0) + s,
        plays: (prev.plays || 0) + 1,
        best: { ...prev.best, [id]: Math.max(prev.best?.[id] || 0, s) },
      }
      writeStore(tenantId, next)
      setStore(next)
      if (s > 0 && tenantId && deviceId) {
        submitScore(tenantId, { name: next.name, score: s, deviceId }).catch(() => { /* board is best-effort */ })
      }
      // Report the finished run to behaviour analytics (which game, what score).
      onGamePlay?.(id, s)
      // ...and to the durable play record, so «نشاط الألعاب» and the player's
      // own history actually contain something. This was the missing link:
      // the hub previously guessed at a memory API that did not exist, so no
      // round was ever written anywhere.
      const pid = playIdRef.current
      if (pid) {
        finishPlay(pid, { score: s, completed: prog.completed === true, result: prog.result || null })
          .then(() => updatePlayerProfile(tenantId, deviceId, {
            gameId: id,
            gameAr: gameById(id)?.ar || '',
            score: s,
            stage: prog.stage || 0,
            completed: prog.completed === true,
            result: prog.result || null,
            endedAt: Date.now(),
          }))
          .catch(() => { /* the local store already has the run */ })
        playIdRef.current = ''
      }
    }

    const earned = evaluateReward(
      tenant,
      { gameId: id, score: s, completed: prog.completed === true, stage: prog.stage || 0 },
      readClaims(tenantId),
      { deviceId, gameName: nameOfGame(id), resolveItemName },
    )
    if (!earned) return null
    if (earned.alreadyClaimed) {
      // Said once, plainly, then dropped — repeating "you already had this"
      // after every round would be nagging, not honesty.
      if (revealedRef.current.has(earned.rule.id)) return null
      revealedRef.current.add(earned.rule.id)
    } else {
      claimReward(tenantId, earned, {
        deviceId, gameId: id, score: s, stage: prog.stage || 0, name: store.name, phone: store.phone,
      })
    }
    setReveal(earned)
    return earned
  }, [tenantId, deviceId, tenant, onGamePlay, nameOfGame, resolveItemName, store.name, store.phone])

  // A game reporting a completed stage / a meaningful answer: persist so the
  // next open resumes, and capture an insight archetype when one is reported.
  const handleProgress = useCallback((state) => {
    const id = activeRef.current
    if (!id || !state || typeof state !== 'object') return
    const done = state.done === true || state.completed === true || state.finished === true
    const stage = Math.max(0, Math.floor(Number(state.stage ?? state.level ?? 0)) || 0)
    // `result` is what an insight game reveals (archetype/traits) — carried
    // through to the durable record so a profile survives the device.
    progressRef.current = { stage, completed: done, result: state.result || state.profile || null }
    // Mirror the stage into the cloud record; batched inside gameMemory.
    if (playIdRef.current) {
      try { saveProgress(playIdRef.current, done ? null : state, stage) } catch (_) { /* local copy stands */ }
    }

    let payload = null
    if (!done) {
      try {
        const json = JSON.stringify(state)
        if (json.length <= MAX_RESUME_BYTES) payload = JSON.parse(json)
      } catch (_) { payload = null } // unserialisable state simply is not resumable
    }

    const arche = readArchetype(state)
    const prev = readStore(tenantId)
    const resume = { ...prev.resume }
    if (payload) resume[id] = { state: payload, at: Date.now() }
    else delete resume[id]
    const next = { ...prev, resume }
    if (arche) { next.archetype = arche; next.archetypeGame = id; next.archetypeAt = Date.now() }
    writeStore(tenantId, next)
    setStore(next)
    setMemResume((m) => {
      if (payload) return { ...m, [id]: payload }
      if (!m[id]) return m
      const cp = { ...m }
      delete cp[id]
      return cp
    })

    loadGameMemory().then((mod) => {
      if (payload) memCall(pickFn(mod, MEM_SAVE), tenantId, id, payload)
      else memCall(pickFn(mod, MEM_CLEAR), tenantId, id)
    })
  }, [tenantId])

  const restart = useCallback(() => {
    const id = activeRef.current
    commitRun()
    // Restart means from scratch: the saved stages for this game are dropped.
    if (id) {
      const prev = readStore(tenantId)
      const resume = { ...prev.resume }
      delete resume[id]
      const next = { ...prev, resume }
      writeStore(tenantId, next)
      setStore(next)
      setMemResume((m) => {
        if (!m[id]) return m
        const cp = { ...m }
        delete cp[id]
        return cp
      })
      loadGameMemory().then((mod) => memCall(pickFn(mod, MEM_CLEAR), tenantId, id))
    }
    resumeRef.current = null
    progressRef.current = { stage: 0, completed: false }
    setRunScore(0)
    runScoreRef.current = 0
    setRunKey((k) => k + 1)
  }, [commitRun, tenantId])

  const exitGame = useCallback(() => {
    commitRun()
    setActiveId(null)
    activeRef.current = null
    setRunScore(0)
    runScoreRef.current = 0
    setView('browse')
    restoreScroll()
  }, [commitRun, restoreScroll])

  const closeHub = useCallback(() => {
    const earned = commitRun()
    setActiveId(null)
    activeRef.current = null
    // A prize code has just appeared: stay open so the guest can actually read
    // it. Closing here would hand out a reward the guest never saw.
    if (earned) { setView('browse'); return }
    onClose?.()
  }, [commitRun, onClose])

  const leavePromo = useCallback(() => {
    const next = { ...readStore(tenantId), promoSeen: true }
    writeStore(tenantId, next)
    setStore(next)
    setView('browse')
  }, [tenantId])

  const active = activeId ? enabled.find((g) => g.id === activeId) : null
  const Comp = useMemo(() => (active ? lazy(() => active.load()) : null), [active])

  // ---- grouping ----
  const groups = useMemo(() => {
    const map = new Map(CATS.map((c) => [c.id, []]))
    enabled.forEach((g) => { map.get(catOf(g))?.push(g) })
    return CATS.map((c) => ({ ...c, games: map.get(c.id) || [] })).filter((c) => c.games.length)
  }, [enabled])

  const shown = cat === 'all' ? groups : groups.filter((g) => g.id === cat)
  const topBests = useMemo(() => (
    Object.entries(store.best || {})
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
  ), [store.best])

  if (!open) return null

  const pendingGame = pendingId ? enabled.find((g) => g.id === pendingId) : null
  const inGame = view === 'play' && active

  const renderCard = (g) => {
    const art = gameArt(g, brand)
    const best = store.best?.[g.id] || 0
    const hasResume = Boolean(resumeFor(g.id))
    const hasPrize = hasAnyReward || rewardGameIds.has(g.id)
    return (
      <button
        key={g.id}
        type="button"
        className="gh-card gh-press"
        style={{ '--card-hi': art.c[2], '--card-deep': art.c[0] }}
        onClick={() => pickGame(g.id)}
      >
        <span className="gh-card-art">
          <GameThumb game={g} brand={brand} />
          <span className="gh-card-chips">
            {hasResume ? <span className="gh-chip gh-chip-resume"><Icon name="reload" size={11} />{t.resume}</span> : null}
            {hasPrize ? <span className="gh-chip gh-chip-prize"><Icon name="offers" size={11} />{t.prize}</span> : null}
          </span>
        </span>
        <span className="gh-card-body">
          <strong className="gh-card-nm">{gameName(g, lang)}</strong>
          <span className="gh-card-hook">{gameHook(g, lang)}</span>
          <span className="gh-card-foot">
            {best > 0 ? (
              <>
                <Icon name="star" size={11} />
                <b>{fmt(best)}</b>
                <em>{t.best}</em>
              </>
            ) : (
              <em className="faint">{t.noBest}</em>
            )}
          </span>
        </span>
      </button>
    )
  }

  return (
    <div className="gh-root" role="dialog" aria-modal="true" aria-label={t.hub} style={{ '--gh-brand': brand }}>
      <header className="gh-bar">
        <button
          type="button"
          className="gh-icon-btn gh-press"
          onClick={inGame ? exitGame : closeHub}
          aria-label={inGame ? t.back : t.close}
        >
          <Icon name={inGame ? 'back' : 'close'} size={19} />
        </button>
        <strong className="gh-bar-title">{inGame ? gameName(active, lang) : t.hub}</strong>
        {inGame ? (
          <>
            <span className="gh-live" aria-live="polite">{fmt(runScore)}</span>
            <button type="button" className="gh-icon-btn gh-press" onClick={restart} aria-label={t.restart}>
              <Icon name="reload" size={17} />
            </button>
            <button type="button" className="gh-icon-btn gh-press" onClick={closeHub} aria-label={t.close}>
              <Icon name="close" size={19} />
            </button>
          </>
        ) : null}
      </header>

      {inGame && Comp ? (
        <div className="gh-stage">
          <Suspense fallback={<div className="gh-loading">{t.loading}</div>}>
            <Comp
              key={runKey}
              onScore={setRunScore}
              onExit={exitGame}
              onProgress={handleProgress}
              resumeState={resumeRef.current}
              lang={lang}
              brand={brand}
              items={items}
              playerName={store.name}
              tenant={tenant}
              tenantId={tenantId}
            />
          </Suspense>
        </div>
      ) : view === 'promo' ? (
        <GamePromo
          brand={brand}
          lang={lang}
          games={enabled}
          rewards={allRewards}
          rewardsNote={note}
          rewardLine={rewardLine}
          onStart={leavePromo}
        />
      ) : view === 'gate' ? (
        <form className="gh-body gh-gate gh-fade" onSubmit={submitGate}>
          <span className="gh-gate-art">
            {pendingGame ? <GameThumb game={pendingGame} brand={brand} /> : null}
          </span>
          <strong className="gh-gate-title">{t.gateTitle}</strong>
          {pendingGame ? (
            <p className="gh-gate-for">{t.gateFor} «{gameName(pendingGame, lang)}»</p>
          ) : null}
          <p className="gh-gate-why">{t.gateWhy}</p>
          <label className="gh-field">
            <span>{t.name}</span>
            <input
              type="text"
              value={form.name}
              placeholder={t.namePh}
              autoComplete="name"
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="gh-field">
            <span>{t.phone}</span>
            <input
              type="tel"
              inputMode="tel"
              dir="ltr"
              value={form.phone}
              placeholder="05XXXXXXXX"
              autoComplete="tel"
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </label>
          {err && <p className="gh-err">{err}</p>}
          <button type="submit" className="gh-cta gh-press" style={{ background: brand }} disabled={busy}>
            <Icon name={busy ? 'clock' : 'play'} size={16} />
            {busy ? t.saving : (localCustomer?.phone ? t.confirm : t.go)}
          </button>
        </form>
      ) : (
        <div className="gh-body gh-fade" ref={scrollRef}>
          {warn && <p className="gh-warn">{warn}</p>}

          {store.registered ? (
            <section className="gh-player">
              <span className="gh-player-glow" style={{ background: brand }} />
              <div className="gh-player-top">
                <span className="gh-avatar" style={{ background: brand }}>
                  <Icon name="user" size={19} />
                </span>
                <div className="gh-player-id">
                  <strong>{t.hello} {store.name}</strong>
                  {store.archetype ? (
                    <span className="gh-arche"><Icon name="sparkles" size={11} />{t.archetype}: {store.archetype}</span>
                  ) : null}
                </div>
              </div>
              <div className="gh-metrics">
                <span className="gh-metric"><b>{fmt(store.points)}</b><em>{t.points}</em></span>
                <span className="gh-metric"><b>{fmt(store.plays)}</b><em>{t.plays}</em></span>
                {rank ? (
                  <span className="gh-metric"><b>{fmt(rank.rank)}</b><em>{t.rank} {t.of} {fmt(rank.total)}</em></span>
                ) : null}
              </div>
              {topBests.length ? (
                <ul className="gh-bests">
                  <li className="gh-bests-h">{t.bestList}</li>
                  {topBests.map(([id, v]) => (
                    <li key={id}>
                      <span>{nameOfGame(id) || id}</span>
                      <b>{fmt(v)}</b>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {enabled.length === 0 ? (
            <div className="gh-empty">
              <span className="gh-empty-ico" style={{ background: brand }}><Icon name="theater" size={22} /></span>
              <p className="gh-gate-why">{t.empty}</p>
              <p className="gh-gate-why faint">{t.emptyHint}</p>
            </div>
          ) : (
            <>
              {groups.length > 1 ? (
                <div className="gh-chips" role="tablist" aria-label={t.hub}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={cat === 'all'}
                    className={`gh-tab gh-press ${cat === 'all' ? 'on' : ''}`}
                    onClick={() => setCat('all')}
                  >
                    {t.all}
                  </button>
                  {groups.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="tab"
                      aria-selected={cat === c.id}
                      className={`gh-tab gh-press ${cat === c.id ? 'on' : ''}`}
                      onClick={() => setCat(c.id)}
                    >
                      <Icon name={c.icon} size={13} />
                      {lang === 'en' ? c.en : c.ar}
                    </button>
                  ))}
                </div>
              ) : null}

              {shown.map((c, si) => {
                // The leading shelf (when the guest has not filtered) gets the
                // hero treatment: bigger art, a reason to care, and room for
                // its cards to breathe.
                const hero = si === 0 && cat === 'all' && c.hero
                return (
                  <section key={c.id} className={`gh-sect${hero ? ' gh-sect-hero' : ''}`}>
                    <h3 className="gh-sect-h">
                      <Icon name={c.icon} size={hero ? 16 : 14} />
                      <span className="gh-sect-t">{lang === 'en' ? c.en : c.ar}</span>
                      {c.tag && lang !== 'en' ? <em className="gh-sect-tag">{c.tag}</em> : null}
                      <span className="gh-sect-n">{fmt(c.games.length)}</span>
                    </h3>
                    <div className={`gh-grid${hero ? ' gh-grid-hero' : ''}`}>{c.games.map(renderCard)}</div>
                  </section>
                )
              })}

              {allRewards.length ? (
                <section className="gh-rewards">
                  <h3 className="gh-sect-h"><Icon name="offers" size={14} />{t.rewardsH}</h3>
                  <ul className="gh-rw-list">
                    {allRewards.map((r) => {
                      const line = rewardLine(r)
                      return line ? (
                        <li key={r.id}>
                          <span>{line}</span>
                          <em>{perGuestText(r)}</em>
                        </li>
                      ) : null
                    })}
                  </ul>
                  <p className="gh-rw-how">{HOW_TO_CLAIM}</p>
                  {note ? <p className="gh-rw-note">{note}</p> : null}
                </section>
              ) : null}

              <p className="gh-note">{t.boardNote}</p>
            </>
          )}
        </div>
      )}

      {reveal ? (
        <div className="gh-reveal" role="alertdialog" aria-label={t.won}>
          <div className="gh-reveal-card">
            <span className="gh-reveal-ring" style={{ background: brand }}><Icon name="award" size={26} /></span>
            <strong className="gh-reveal-h">{reveal.alreadyClaimed ? t.wonAgain : t.won}</strong>
            <p className="gh-reveal-prize">{reveal.prizeText}</p>
            <div className="gh-code" dir="ltr">{reveal.code}</div>
            <p className="gh-reveal-how">{reveal.howTo}</p>
            <ul className="gh-reveal-meta">
              <li><span>{t.condition}</span><b>{reveal.conditionText}</b></li>
              <li><span>{t.limit}</span><b>{reveal.perGuestText}</b></li>
            </ul>
            {reveal.alreadyClaimed ? <p className="gh-reveal-again">{t.already}</p> : null}
            <button type="button" className="gh-cta gh-press" style={{ background: brand }} onClick={() => setReveal(null)}>
              {t.done}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
