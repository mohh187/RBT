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
import { startPlay, saveProgress, finishPlay } from '../lib/gameMemory.js'
import { registerCustomer } from '../lib/db.js'
import { getLocalCustomer, setLocalCustomer } from '../lib/customer.js'
import { submitScore, watchTopScores, currentMonth, myRank } from '../lib/leaderboard.js'
import { deviceKey } from '../lib/device.js'
import { watchRoom, applyMove, heartbeat, leaveRoom, HEARTBEAT_MS } from '../lib/gameRoom.js'
import { clearSoloIntent } from '../lib/gameBots.js'
import {
  watchLiveTournament, recordTournamentPlay, recordHappyHourPlay, rememberRoom,
} from '../lib/socialPlay.js'
import WeeklyTournament from './social/WeeklyTournament.jsx'
import HangingChallenge from './social/HangingChallenge.jsx'
import TableVsTable from './social/TableVsTable.jsx'
import TableChampions from './social/TableChampions.jsx'
import HappyHourBanner from './social/HappyHourBanner.jsx'
import PlayedWith from './social/PlayedWith.jsx'
const RoomLobby = lazy(() => import('./games/RoomLobby.jsx'))
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
    anyGame: 'هذه البطولة تحتسب كل الألعاب — اختر أي لعبة من القائمة وتُحتسب جولتك فيها.',
    notHere: 'هذه اللعبة لم تعد مفعّلة في هذا المكان. اختر واحدة من القائمة.',
    waitHost: 'مقعدك محفوظ. تبدأ الجولة حين يبدأها المضيف.',
    nowH: 'ما يحدث الآن',
    pastH: 'الطاولة ومن حولك',
    more: 'المزيد',
    expand: 'توسيع البطاقة',
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
    anyGame: 'Every game counts in this tournament — pick any game below and your round enters it.',
    notHere: 'This game is no longer enabled at this venue. Pick one from the list.',
    waitHost: 'Your seat is saved. The round begins when the host starts it.',
    nowH: 'Happening now',
    pastH: 'Your table & who is around',
    more: 'More',
    expand: 'Expand card',
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
  { id: 'party', ar: 'ألعاب جماعية', en: 'Play together', icon: 'customers', hero: true, tag: 'العبوا معاً على الطاولة' },
  { id: 'insight', ar: 'اكتشف شخصيتك', en: 'Discover yourself', icon: 'user', tag: 'الأكثر إدهاشاً' },
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

export default function GamesCenter({
  open, onClose, tenantId, tenant, items = [], lang = 'ar', table = null,
  onIdentify, onGamePlay,
  // Set when the guest arrived from an invite link (/join → menu?room=&game=).
  // The hub then skips promo and browse and drops straight onto that board.
  joinRoomId = '', joinGameId = '',
}) {
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
  // One line explaining why the hub did NOT open a board when something asked it
  // to. Two causes, both real and both previously silent: a social card asking
  // for «any game» (a tournament whose gameId is 'any' — the default), and a
  // link naming a game this venue has since disabled. Routing used to validate
  // against the global game registry while rendering from the venue's enabled
  // list, so either case fell through every branch to the bare shelf and the tap
  // appeared to do nothing at all.
  const [hint, setHint] = useState('')
  const [memResume, setMemResume] = useState({})
  const [reveal, setReveal] = useState(null)

  // Which lower-priority «now» cards the guest has expanded from their one-line
  // teaser. Add-only for the session — opening one is deliberate, and having it
  // silently re-collapse would feel like the card vanished.
  const [nowOpen, setNowOpen] = useState(() => new Set())
  const openNowItem = useCallback((key) => {
    setNowOpen((s) => (s.has(key) ? s : new Set(s).add(key)))
  }, [])

  // The running tournament is watched here rather than inside the card, because
  // a finished round must be posted to it even when the card is scrolled away.
  // watchLiveTournament calls back with a WRAPPER ({ tournament, upcoming, all,
  // error }), not the tournament itself. Unwrap it here: passing the wrapper on
  // to recordTournamentPlay made its `!tournament?.id` guard reject every single
  // round, so no standing was ever written and the board stayed empty forever.
  const [tour, setTour] = useState(null)
  const tourRef = useRef(null)
  useEffect(() => { tourRef.current = tour }, [tour])
  useEffect(() => {
    if (!tenantId || !open) return undefined
    return watchLiveTournament(tenantId, (live) => setTour(live?.tournament || null))
  }, [tenantId, open])

  // The last finished round, handed to the challenge card so it can offer
  // «اترك تحدياً» with a real score instead of asking the player to retype one.
  const [lastRun, setLastRun] = useState(null)

  const socialPlayer = useMemo(
    () => ({ id: deviceId, name: store.name || '' }),
    [deviceId, store.name],
  )

  const runScoreRef = useRef(0)
  const activeRef = useRef(null)
  const playIdRef = useRef('') // the open durable play record for this round

  // ---- multiplayer room state ----
  const [roomId, setRoomId] = useState('')
  const [room, setRoom] = useState(null)
  const reduceRef = useRef(null)   // the active game's pure reducer
  const mySeat = useMemo(() => {
    const p = (room?.players || []).find((x) => x.id === deviceKey())
    return p ? p.seat : null
  }, [room])

  // Live room subscription + presence while a room is open.
  useEffect(() => {
    if (!tenantId || !roomId) { setRoom(null); return undefined }
    let alive = true
    const stop = watchRoom(tenantId, roomId, (r) => { if (alive) setRoom(r) })
    const beat = setInterval(() => { heartbeat({ tid: tenantId, roomId, playerId: deviceKey() }) }, HEARTBEAT_MS)
    return () => { alive = false; if (typeof stop === 'function') stop(); clearInterval(beat) }
  }, [tenantId, roomId])

  // Every move goes through the room transaction with the game's own reducer,
  // so two phones tapping at once can never both apply.
  const submitMove = useCallback((move) => {
    if (!tenantId || !roomId || mySeat == null || !reduceRef.current) return Promise.resolve()
    return applyMove({
      tid: tenantId,
      roomId,
      seat: mySeat,
      move,
      reduce: reduceRef.current,
      // Anti-stall skips are submitted by a player other than the turn holder.
      allowOutOfTurn: move?.type === 'forceSkip' || move?.type === 'skipTurn',
    }).catch(() => { /* rejected move: the snapshot already shows the truth */ })
  }, [tenantId, roomId, mySeat])

  // The lobby hands back a started room; load the game module so its reducer is
  // available before the board renders. `gid` lets the invite path pass the
  // game explicitly, since nothing was picked from the shelves in that flow.
  const enterRoom = useCallback(async (rid, gid) => {
    const id = gid || activeRef.current
    // Entering a room is the OPPOSITE of a solo round. Clear the machine-seat
    // hand-off first: a board decides bot mode on its first frame, and on the
    // invite path that frame happens before the room snapshot arrives — so a
    // stale solo intent could silently turn a real multiplayer game into a game
    // against the computer.
    setSoloBots(0)
    soloRef.current = 0
    clearSoloIntent()
    if (gid) { setActiveId(gid); activeRef.current = gid }
    const g = gameById(id)
    // Not enabled here means nothing will render. Say so, and RELEASE the seat:
    // the join page already seated this guest, and silently falling through left
    // them holding a seat against the other players with no board to show for it.
    if (!g || !enabled.some((x) => x.id === id)) {
      if (rid && tenantId) leaveRoom({ tid: tenantId, roomId: rid, playerId: deviceKey() })
      setHint(t.notHere)
      setView('browse')
      return
    }
    try {
      const mod = await g.load()
      reduceRef.current = typeof mod.reduce === 'function' ? mod.reduce : null
    } catch (_) { reduceRef.current = null }
    // Remember the room locally so «من لعبت معهم» still knows these people
    // tomorrow — the room doc itself is not queryable by participant.
    rememberRoom(tenantId, rid)
    setRoomId(rid)
    setView('play')
    setRunKey((k) => k + 1)
  }, [tenantId, enabled, t])

  // Table-vs-table is shown BEFORE registration — it is the reason to register,
  // not a reward for having done so. When an unregistered guest actually enters
  // a board from it, capture their name first through the very same gate every
  // game uses, then drop them onto the board. Registration is never skipped,
  // only deferred to the last honest moment.
  const pendingRoomRef = useRef(null)
  const openRoomGated = useCallback((rid, gid) => {
    if (!rid) return
    if (!store.registered) {
      pendingRoomRef.current = { roomId: rid, gameId: gid }
      setPendingId('')
      setErr('')
      setView('gate')
      return
    }
    enterRoom(rid, gid)
  }, [store.registered, enterRoom])

  // Arriving from an invite link: the join page already seated this guest, so
  // go straight to the board instead of making them find the game again.
  // Declared AFTER enterRoom on purpose — a const is in its temporal dead zone
  // until its initialiser runs, and referencing it above crashed the menu.
  const joinedRef = useRef(false)
  useEffect(() => {
    if (!open || joinedRef.current) return
    if (!joinRoomId || !joinGameId || !gameById(joinGameId)) return
    joinedRef.current = true
    enterRoom(joinRoomId, joinGameId)
  }, [open, joinRoomId, joinGameId, enterRoom])

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

  // «العب ضد الكمبيوتر»: a solo round against machine seats. It is a normal
  // single-player run (durable play record, restart, exit) and NOT a room, so it
  // costs no Firestore writes. `soloRef` is read by commitRun, which keeps these
  // rounds off the shared boards — beating a fixed heuristic is not the same
  // achievement as beating three people, and mixing them would make the board a lie.
  const [soloBots, setSoloBots] = useState(0)
  const soloRef = useRef(0)
  useEffect(() => { soloRef.current = soloBots }, [soloBots])

  const startGame = useCallback((id, bots = 0) => {
    setSoloBots(bots)
    soloRef.current = bots
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
        // Marked HERE, on the durable record, not just held in soloRef. The
        // guest-facing boards below already skip a computer round; without this
        // mark the ADMIN standings and every per-game figure still counted it as
        // real play, so a guest farming a fixed heuristic could outrank people.
        solo: bots > 0,
        soloBots: bots,
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

  // A party game never launches straight into a board: it opens the lobby so
  // the guest chooses between playing with the table and inviting a friend.
  const pickGame = useCallback((id) => {
    // «any game»: the card had no single game to open (a tournament that counts
    // every game). Falling through called startGame('') — which opened a play
    // record with an empty gameId and flipped to a view that mounts nothing, so
    // the tap did nothing at all. Answer it instead: the full shelf, back at the
    // top, with one line saying every game on it enters.
    if (!id) {
      setHint(t.anyGame)
      setCat('all')
      setView('browse')
      if (scrollRef.current) scrollRef.current.scrollTop = 0
      return
    }
    // Validate against the list the RENDER uses, not just the global registry.
    // A game the venue disabled resolves to nothing at render time, so routing
    // to it produced a blank screen with no explanation.
    if (!enabled.some((g) => g.id === id)) { setHint(t.notHere); setView('browse'); return }
    setHint('')
    if (!store.registered) { setPendingId(id); setErr(''); setView('gate'); return }
    const g = gameById(id)
    if (g?.multiplayer) {
      rememberScroll()
      setActiveId(id)
      activeRef.current = id
      setView('lobby')
      return
    }
    startGame(id)
  }, [store.registered, startGame, rememberScroll, enabled, t])

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
    // A table-vs-table board was waiting on this registration: enter it now,
    // ahead of opening any game from the shelves.
    if (pendingRoomRef.current) {
      const { roomId: rid, gameId: gid } = pendingRoomRef.current
      pendingRoomRef.current = null
      setPendingId('')
      enterRoom(rid, gid)
      return
    }
    // The game opens right now — no second tap, no "come back later". But a
    // party game must still route through the LOBBY (play with the table vs
    // invite a friend), exactly as pickGame does; calling startGame on it would
    // silently drop a first-timer into a single-device hotseat game instead.
    const target = pendingId || enabled[0]?.id
    setPendingId('')
    if (!target) { setView('browse'); return }
    if (gameById(target)?.multiplayer) {
      rememberScroll()
      setActiveId(target)
      activeRef.current = target
      setView('lobby')
      return
    }
    startGame(target)
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
      // A computer round counts for this guest — points, rounds, personal best,
      // and the durable record below — but is NEVER posted to the venue's shared
      // boards, nor offered as a challenge others must beat.
      const solo = soloRef.current > 0
      if (s > 0 && tenantId && deviceId && !solo) {
        submitScore(tenantId, { name: next.name, score: s, deviceId }).catch(() => { /* board is best-effort */ })
      }
      // Report the finished run to behaviour analytics (which game, what score).
      onGamePlay?.(id, s)
      if (!solo) setLastRun({ gameId: id, score: s, at: Date.now() })
      // ...and to the two social boards. Both are self-written rows keyed by
      // this device, and both no-op when nothing is running, so this is a plain
      // "post the round" call rather than a conditional the caller has to get
      // right. Without it the tournament and happy-hour boards render empty no
      // matter how much anyone plays.
      if (!solo) {
        recordTournamentPlay({
          tid: tenantId, tournament: tourRef.current, deviceId, name: next.name, gameId: id, score: s,
        }).catch(() => { /* board is best-effort; the run is already recorded */ })
        recordHappyHourPlay({
          tid: tenantId, deviceId, name: next.name, gameId: id, score: s, cfg: tenant?.gameHappyHour,
        }).catch(() => { /* ditto */ })
      }
      // ...and to the durable play record, so «نشاط الألعاب» and the player's
      // own history actually contain something. This was the missing link:
      // the hub previously guessed at a memory API that did not exist, so no
      // round was ever written anywhere.
      const pid = playIdRef.current
      if (pid) {
        // finishPlay OWNS the player rollup: it merges the profile itself from
        // the full live record (which also carries the duration and the answers
        // the knowledge breakdown needs). Merging a second time here counted one
        // round as two plays and doubled its score in the staff roster.
        finishPlay(pid, { score: s, completed: prog.completed === true, result: prog.result || null })
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
    // Tell the table this player stepped away. The seat is KEPT (gameRoom never
    // auto-removes anyone) so returning to the same room resumes the seat.
    if (tenantId && roomId) leaveRoom({ tid: tenantId, roomId, playerId: deviceKey() })
    setRoomId('')
    setRoom(null)
    // commitRun() ran at the top of this callback, so it already read soloRef
    // before it is cleared here.
    setSoloBots(0)
    soloRef.current = 0
    reduceRef.current = null
    setActiveId(null)
    activeRef.current = null
    setRunScore(0)
    runScoreRef.current = 0
    setView('browse')
    restoreScroll()
  }, [commitRun, restoreScroll, tenantId, roomId])

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
  const roomPending = !!room && room.status === 'lobby'

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
        {!inGame ? <Icon name="games" size={20} strokeWidth={1.9} style={{ flex: '0 0 auto' }} aria-hidden="true" /> : null}
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

      {/* A room that has not started yet must NOT mount a board. Fixed here once
          rather than in five games: an invited guest arriving during the lobby
          got a live-looking board built from an empty room state — Dominoes
          fabricated a random hand and presented it as theirs, Chess offered
          resign and draw on a game nobody had begun. Waiting is the truth, and
          the room subscription flips this the moment the host starts. */}
      {inGame && roomPending ? (
        <div className="gh-stage">
          <div className="gh-loading">{t.waitHost}</div>
        </div>
      ) : inGame && Comp ? (
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
              room={room}
              mySeat={mySeat}
              isHost={room ? room.hostId === deviceId : false}
              onMove={submitMove}
              soloBots={soloBots}
            />
          </Suspense>
        </div>
      ) : view === 'lobby' && active ? (
        <div className="gh-stage">
          <Suspense fallback={<div className="gh-loading">{t.loading}</div>}>
            <RoomLobby
              tid={tenantId}
              tenant={tenant}
              game={active}
              table={table}
              player={{ id: deviceId, name: store.name, phone: store.phone }}
              lang={lang}
              onStart={enterRoom}
              onSolo={({ gameId, bots }) => startGame(gameId || activeRef.current, bots)}
              onExit={() => { setActiveId(null); activeRef.current = null; setView('browse'); restoreScroll() }}
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
          {hint ? (
            <p className="gh-hint"><Icon name="award" size={14} />{hint}</p>
          ) : null}

          {/* Who you are, sized to what you have done. A first-timer (no rounds
              yet) gets a single calm greeting pill — never a scoreboard of
              zeros above the fold — and it grows into the full card with points,
              rank and personal bests only once there is something real to show. */}
          {store.registered && store.plays > 0 ? (
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
          ) : store.registered ? (
            <div className="gh-player-pill">
              <span className="gh-avatar gh-avatar-sm" style={{ background: brand }}>
                <Icon name="user" size={15} />
              </span>
              <strong className="gh-pill-hi">{t.hello} {store.name}</strong>
              {store.archetype ? (
                <span className="gh-arche"><Icon name="sparkles" size={11} />{store.archetype}</span>
              ) : null}
            </div>
          ) : null}

          {/* «ما يحدث الآن» — the live, act-now surfaces in priority order:
              table-vs-table, then hanging challenge, tournament, happy hour.
              Every card self-hides when it has nothing true to show, and the
              whole area (heading and all) disappears on a quiet day via :has().
              The first card that actually has content is shown in full; each
              lower one collapses to a one-line teaser that opens on tap, so
              nothing is ever hidden for good — only tucked. */}
          <section className="gh-now" aria-label={t.nowH}>
            <h3 className="gh-now-h"><Icon name="flame" size={14} />{t.nowH}</h3>

            {/* The one surface shown before registration: it is the REASON to
                register, not a reward. Entering a board from it routes through
                the gate (openRoomGated) so a name is captured first. */}
            <div className={`gh-now-item${nowOpen.has('vs') ? ' is-open' : ''}`}>
              <TableVsTable
                tenantId={tenantId} tenant={tenant} lang={lang} table={table}
                player={socialPlayer} onOpenRoom={openRoomGated}
              />
              <button type="button" className="gh-now-cover" onClick={() => openNowItem('vs')} aria-label={t.expand}>
                <span className="gh-now-more"><Icon name="arrowUpDown" size={13} />{t.more}</span>
              </button>
            </div>

            {store.registered ? (
              <>
                <div className={`gh-now-item${nowOpen.has('challenge') ? ' is-open' : ''}`}>
                  <HangingChallenge
                    tenantId={tenantId} tenant={tenant} lang={lang} table={table}
                    player={socialPlayer} onPlay={pickGame} result={lastRun}
                  />
                  <button type="button" className="gh-now-cover" onClick={() => openNowItem('challenge')} aria-label={t.expand}>
                    <span className="gh-now-more"><Icon name="arrowUpDown" size={13} />{t.more}</span>
                  </button>
                </div>
                <div className={`gh-now-item${nowOpen.has('tournament') ? ' is-open' : ''}`}>
                  <WeeklyTournament
                    tenantId={tenantId} tenant={tenant} lang={lang} table={table}
                    player={socialPlayer} onPlay={pickGame}
                  />
                  <button type="button" className="gh-now-cover" onClick={() => openNowItem('tournament')} aria-label={t.expand}>
                    <span className="gh-now-more"><Icon name="arrowUpDown" size={13} />{t.more}</span>
                  </button>
                </div>
                <div className={`gh-now-item${nowOpen.has('happy') ? ' is-open' : ''}`}>
                  <HappyHourBanner
                    tenantId={tenantId} tenant={tenant} lang={lang} table={table}
                    player={socialPlayer} onPlay={pickGame}
                  />
                  <button type="button" className="gh-now-cover" onClick={() => openNowItem('happy')} aria-label={t.expand}>
                    <span className="gh-now-more"><Icon name="arrowUpDown" size={13} />{t.more}</span>
                  </button>
                </div>
              </>
            ) : null}
          </section>

          {enabled.length === 0 ? (
            <div className="gh-empty">
              <span className="gh-empty-ico" style={{ background: brand }}><Icon name="games" size={24} strokeWidth={1.9} /></span>
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

          {/* Retrospective boards — the champions of this table and the people
              you have played with — live at the bottom, near the rewards. Both
              self-hide when there is nothing true to show, so this whole block
              (heading included) disappears via :has() on a fresh device. */}
          <section className="gh-past" aria-label={t.pastH}>
            <h3 className="gh-past-h"><Icon name="star" size={13} />{t.pastH}</h3>
            <TableChampions
              tenantId={tenantId} tenant={tenant} lang={lang} table={table}
              player={socialPlayer} gameId={lastRun?.gameId || ''}
            />
            <PlayedWith
              tenantId={tenantId} tenant={tenant} lang={lang} table={table}
              player={socialPlayer}
            />
          </section>
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
