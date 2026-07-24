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
import GamePromo, { gameName, gameHook } from './games/GamePromo.jsx'
import { gamesFor, gameById, NEW_GAME_IDS } from '../lib/games.js'
import { startPlay, saveProgress, finishPlay } from '../lib/gameMemory.js'
import { registerCustomer } from '../lib/db.js'
import { getLocalCustomer, setLocalCustomer } from '../lib/customer.js'
import { useScrollLock } from '../lib/scrollLock.js'
import { submitScore, watchTopScores, currentMonth, myRank } from '../lib/leaderboard.js'
import { deviceKey } from '../lib/device.js'
// startGame is aliased: this file already has a local startGame (the solo
// launcher), and the room restart below must not shadow or collide with it.
import { watchRoom, applyMove, startGame as startRoomGame, heartbeat, leaveRoom, HEARTBEAT_MS } from '../lib/gameRoom.js'
import { clearSoloIntent } from '../lib/gameBots.js'
import { isMuted, setMuted, play as playSound } from '../lib/gameSounds.js'
import {
  watchLiveTournament, recordTournamentPlay, recordHappyHourPlay, rememberRoom,
  tournamentCounts,
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
    soundOn: 'تشغيل أصوات اللعبة',
    soundOff: 'كتم أصوات اللعبة',
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
    inCup: 'ضمن البطولة',
    newTag: 'جديد',
    featStages: 'مراحل',
    featCpu: 'ضد الكمبيوتر',
    play: 'العب الآن',
  },
  en: {
    hub: 'Games Corner',
    close: 'Close',
    back: 'Back',
    restart: 'Restart',
    soundOn: 'Unmute game sounds',
    soundOff: 'Mute game sounds',
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
    inCup: 'In the tournament',
    newTag: 'New',
    featStages: 'Stages',
    featCpu: 'vs CPU',
    play: 'Play now',
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

// ===========================================================================
// PER-GAME COVERS — original SVG scenes, drawn here so the hub owns its shelf
// art end-to-end. Every game carries a declarative
//     cover: { motif, palette, players, stages, vsCpu }     (see lib/games.js)
// `renderScene` turns a motif into an original SVG scene painted over the
// game's own gradient; `renderCard` frames it with a large Arabic name and a
// truthful feature strip. The promo splash keeps its own tiles (GamePromo).
//
// The four engine traps proven in this repo this week are honoured throughout:
//  1) SVG children are positioned with the UNITLESS attribute transform
//     (transform="translate(x y)") — never a CSS px transform.
//  2) depth is drawn with plain shapes + gradients — never filter="url(#…)".
//  3) the whole cover is ONE <button>; the art is aria-hidden with
//     pointer-events:none in CSS, so the hit area never exceeds the card.
//  4) the feature strip only ever states what is true for that game.
// All motif geometry lives in a local 0..100 box, placed by CoverArt into the
// upper region of the card so the name band below never crops the focal object.
// ===========================================================================
const NEW_SET = new Set(NEW_GAME_IDS)
const COVER_FALLBACK = ['#123448', '#2a5a72', '#7fd3e6']
function coverPalette(g) {
  const p = Array.isArray(g?.cover?.palette)
    ? g.cover.palette.filter((x) => /^#[0-9a-f]{3,8}$/i.test(x))
    : []
  return p.length >= 3 ? p : COVER_FALLBACK
}

// Universal game symbols — my own copies. A card suit, a domino face and the
// four Ludo colours are domain facts, not any app's proprietary artwork.
const CV_LUDO = ['#d92b3a', '#16a34a', '#e0a409', '#2563eb']
const CV_JAK = ['#38bdf8', '#fbbf24', '#818cf8', '#fb7185']
const CV_FLAVOR = ['#e0662a', '#e8b53a', '#3f9d54', '#2f8fb0', '#8a5cc4', '#d64d7a']
const CV_SUIT = {
  spade: 'M12 3s-8 6.5-8 11.2c0 2.8 2 4.4 4.2 4.4 1.4 0 2.6-.6 3.2-1.6L10.2 21.5h3.6L12.6 17c.6 1 1.8 1.6 3.2 1.6 2.2 0 4.2-1.6 4.2-4.4C20 9.5 12 3 12 3z',
  heart: 'M12 20.5S3.5 14.6 3.5 9.4C3.5 6.7 5.6 4.8 8 4.8c1.8 0 3.2 1 4 2.3.8-1.3 2.2-2.3 4-2.3 2.4 0 4.5 1.9 4.5 4.6 0 5.2-8.5 11.1-8.5 11.1z',
  diamond: 'M12 3l7.5 9-7.5 9-7.5-9z',
  club: 'M12 3.2 a4.1 4.1 0 0 1 3.4 6.4 a4.1 4.1 0 1 1 -1.9 6.2 l.4 5.6 h-3.8 l.4-5.6 a4.1 4.1 0 1 1 -1.9-6.2 a4.1 4.1 0 0 1 3.4-6.4 z',
}
const CV_DOMPIPS = {
  0: [], 1: [[0.5, 0.5]], 2: [[0.3, 0.28], [0.7, 0.72]],
  3: [[0.28, 0.26], [0.5, 0.5], [0.72, 0.74]],
  4: [[0.3, 0.28], [0.7, 0.28], [0.3, 0.72], [0.7, 0.72]],
  5: [[0.3, 0.28], [0.7, 0.28], [0.5, 0.5], [0.3, 0.72], [0.7, 0.72]],
  6: [[0.3, 0.24], [0.7, 0.24], [0.3, 0.5], [0.7, 0.5], [0.3, 0.76], [0.7, 0.76]],
}
// A stylised chess knight + king, authored here in a 40-unit box.
const CV_KNIGHT = 'M13 34 C10 30 9.4 24 12.6 20 C10 21.4 8 20 8.6 17.4 C9.4 13.6 11.8 10 15.4 7.8 L14.8 3.8 L18.4 6.8 C20.4 5.6 22.9 5.6 24.9 7.1 L23.7 3.2 C28 4.9 31.2 8.6 32.2 13.2 C33.6 19.4 32 25.8 28.2 29.8 C30.4 31 31.4 32.4 31.4 34 Z'
const CV_KING = 'M20 12 C13.8 13 9.6 16.6 8.6 21.2 C7.8 25.4 9.7 28.6 12 30.2 H28 C30.3 28.6 32.2 25.4 31.4 21.2 C30.4 16.6 26.2 13 20 12 Z'

function CvDie({ x, y, s, ink = '#2a2320' }) {
  const r = s * 0.13
  const P = [[0.28, 0.28], [0.28, 0.5], [0.28, 0.72], [0.72, 0.28], [0.72, 0.5], [0.72, 0.72]]
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="1.6" y={s * 0.09 + 1.6} width={s} height={s} rx={s * 0.22} fill="#000" opacity="0.24" />
      <rect width={s} height={s} rx={s * 0.22} fill="#fbfaf5" />
      <rect x="0.6" y="0.6" width={s - 1.2} height={s - 1.2} rx={s * 0.2} fill="none" stroke="#000" strokeOpacity="0.12" strokeWidth="0.7" />
      {P.map(([fx, fy], i) => <circle key={i} cx={fx * s} cy={fy * s} r={r} fill={ink} />)}
    </g>
  )
}

function CvDomino({ x, y, w, h, a, b, face, ink, rot }) {
  const half = h / 2
  const pr = w * 0.096
  const spot = (nn, oy) => (CV_DOMPIPS[nn] || []).map(([fx, fy], i) => (
    <circle key={`${nn}-${i}`} cx={x + fx * w} cy={oy + fy * half} r={pr} fill={ink} />
  ))
  const cx = x + w / 2
  const cy = y + h / 2
  return (
    <g transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}>
      <rect x={x + 1.2} y={y + 1.8} width={w} height={h} rx={w * 0.16} fill="#000" opacity="0.22" />
      <rect x={x} y={y} width={w} height={h} rx={w * 0.16} fill={face} />
      <rect x={x} y={y} width={w} height={h} rx={w * 0.16} fill="none" stroke="#000" strokeOpacity="0.16" strokeWidth="0.7" />
      <line x1={x + w * 0.14} y1={y + half} x2={x + w * 0.86} y2={y + half} stroke={ink} strokeOpacity="0.45" strokeWidth="0.9" />
      {spot(a, y)}
      {spot(b, y + half)}
    </g>
  )
}

function CvCard({ angle, px, py, suit, ink, face, w = 23, h = 33 }) {
  const top = py - h
  const left = px - w / 2
  return (
    <g transform={`rotate(${angle} ${px} ${py})`}>
      <rect x={left + 1.2} y={top + 1.6} width={w} height={h} rx="3.2" fill="#000" opacity="0.18" />
      <rect x={left} y={top} width={w} height={h} rx="3.2" fill={face} />
      <rect x={left} y={top} width={w} height={h} rx="3.2" fill="none" stroke="#000" strokeOpacity="0.13" strokeWidth="0.6" />
      <g transform={`translate(${left + 1.8} ${top + 1.6}) scale(0.26)`}><path d={CV_SUIT[suit]} fill={ink} /></g>
      <g transform={`translate(${px - 6} ${top + h / 2 - 6}) scale(0.5)`}><path d={CV_SUIT[suit]} fill={ink} /></g>
    </g>
  )
}

function renderScene(motif, C) {
  const [deep, mid, hi] = C
  const accent = C[3] || hi
  switch (motif) {
    case 'ludo': {
      const yards = [[0, 0], [9, 0], [9, 9], [0, 9]]
      const lanes = [[1, 7, 5, 1], [7, 1, 1, 5], [9, 7, 5, 1], [7, 9, 1, 5]]
      const goals = ['M6 6L6 9L7.5 7.5Z', 'M6 6L9 6L7.5 7.5Z', 'M9 6L9 9L7.5 7.5Z', 'M6 9L9 9L7.5 7.5Z']
      return (
        <g>
          <ellipse cx="40" cy="66" rx="34" ry="7" fill="#000" opacity="0.22" />
          <g transform="translate(12 10) scale(3.6)">
            <rect x="-0.4" y="-0.4" width="15.8" height="15.8" rx="1" fill={deep} />
            <rect width="15" height="15" rx="0.7" fill={hi} />
            {yards.map(([yx, yy], s) => (
              <g key={s}>
                <rect x={yx} y={yy} width="6" height="6" rx="0.7" fill={CV_LUDO[s]} />
                <rect x={yx + 0.9} y={yy + 0.9} width="4.2" height="4.2" rx="0.5" fill={hi} />
                {[[2, 2], [4, 2], [2, 4], [4, 4]].map(([dx, dy]) => (
                  <circle key={`${dx}-${dy}`} cx={yx + dx} cy={yy + dy} r="0.6" fill={CV_LUDO[s]} />
                ))}
              </g>
            ))}
            {lanes.map(([lx, ly, lw, lh], s) => <rect key={s} x={lx} y={ly} width={lw} height={lh} fill={CV_LUDO[s]} opacity="0.9" />)}
            {goals.map((d, s) => <path key={s} d={d} fill={CV_LUDO[s]} />)}
            <rect x="0" y="0" width="15" height="15" rx="0.7" fill="none" stroke={deep} strokeOpacity="0.5" strokeWidth="0.12" />
          </g>
          <CvDie x={58} y={2} s={22} ink={deep} />
        </g>
      )
    }
    case 'chess':
      return (
        <g>
          <ellipse cx="50" cy="70" rx="36" ry="7" fill="#000" opacity="0.22" />
          <g transform="rotate(-9 46 46)">
            {[0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((f) => (
              <rect key={`${r}-${f}`} x={22 + f * 12} y={22 + r * 12} width="12" height="12" fill={(r + f) % 2 ? mid : hi} />
            )))}
            <rect x="22" y="22" width="48" height="48" fill="none" stroke={deep} strokeOpacity="0.6" strokeWidth="1.4" />
          </g>
          <g transform="translate(52 20) scale(0.62)">
            <ellipse cx="20" cy="41" rx="16" ry="4" fill="#000" opacity="0.2" />
            <path d={CV_KING} fill={deep} stroke={hi} strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M18.5 3h3v3h3v3h-3v3h-3v-3h-3V6h3z" fill={deep} stroke={hi} strokeWidth="1.4" strokeLinejoin="round" />
            <rect x="10" y="30" width="20" height="4" rx="1.4" fill={deep} stroke={hi} strokeWidth="1.4" />
            <rect x="7.5" y="34" width="25" height="5" rx="2" fill={deep} stroke={hi} strokeWidth="1.4" />
          </g>
          <g transform="translate(20 22) scale(0.82)">
            <ellipse cx="20" cy="40" rx="15" ry="4" fill="#000" opacity="0.22" />
            <path d={CV_KNIGHT} fill={hi} stroke={deep} strokeWidth="1.4" strokeLinejoin="round" />
            <rect x="9" y="33.5" width="22" height="4" rx="1.4" fill={hi} stroke={deep} strokeWidth="1.4" />
            <rect x="6.5" y="37.5" width="27" height="5" rx="2" fill={hi} stroke={deep} strokeWidth="1.4" />
          </g>
        </g>
      )
    case 'domino': {
      const ink = C[3] || deep
      return (
        <g>
          <ellipse cx="50" cy="72" rx="36" ry="7" fill="#000" opacity="0.2" />
          <CvDomino x={20} y={26} w={22} h={44} a={3} b={5} face={hi} ink={ink} rot={-15} />
          <CvDomino x={58} y={30} w={22} h={44} a={2} b={4} face={hi} ink={ink} rot={14} />
          <CvDomino x={39} y={16} w={22} h={44} a={6} b={6} face={hi} ink={ink} />
        </g>
      )
    }
    case 'fan': {
      const red = C[3] || '#d9455f'
      const fan = [
        { angle: -21, suit: 'club', ink: deep },
        { angle: -7, suit: 'diamond', ink: red },
        { angle: 7, suit: 'heart', ink: red },
        { angle: 21, suit: 'spade', ink: deep },
      ]
      return (
        <g>
          <ellipse cx="50" cy="76" rx="30" ry="6" fill="#000" opacity="0.2" />
          {fan.map((f) => <CvCard key={f.angle} angle={f.angle} px={50} py={90} suit={f.suit} ink={f.ink} face={hi} />)}
        </g>
      )
    }
    case 'fireFan': {
      const ember = C[3] || '#ffb347'
      return (
        <g>
          <path d="M50 8 C60 22 58 30 54 38 C60 34 62 26 61 20 C66 30 66 42 58 50 C64 49 69 44 71 38 C73 50 66 60 52 62 C40 63 32 55 34 44 C35 38 39 34 41 36 C39 28 44 18 50 8 Z" fill={mid} opacity="0.5" />
          <path d="M50 20 C56 30 55 36 52 42 C57 40 58 34 57 30 C60 38 58 47 51 51 C44 52 39 47 40 40 C41 34 46 28 50 20 Z" fill={ember} opacity="0.9" />
          <ellipse cx="50" cy="76" rx="30" ry="6" fill="#000" opacity="0.2" />
          <CvCard angle={-16} px={50} py={92} suit="heart" ink={mid} face={hi} />
          <CvCard angle={2} px={50} py={92} suit="spade" ink={deep} face={hi} />
          <CvCard angle={18} px={50} py={92} suit="diamond" ink={mid} face={hi} />
        </g>
      )
    }
    case 'marbles': {
      const holes = 16
      return (
        <g>
          <ellipse cx="46" cy="74" rx="34" ry="7" fill="#000" opacity="0.2" />
          <circle cx="46" cy="42" r="28" fill="none" stroke={mid} strokeWidth="10" opacity="0.7" />
          <circle cx="46" cy="42" r="28" fill="none" stroke={hi} strokeWidth="1" opacity="0.4" />
          {Array.from({ length: holes }).map((_, i) => {
            const a = (i / holes) * Math.PI * 2 - Math.PI / 2
            return <circle key={i} cx={(46 + Math.cos(a) * 28).toFixed(2)} cy={(42 + Math.sin(a) * 28).toFixed(2)} r="2.6" fill={deep} opacity="0.6" />
          })}
          {CV_JAK.map((col, i) => {
            const a = (i / 4) * Math.PI * 2 - Math.PI / 2
            const mx = 46 + Math.cos(a) * 28
            const my = 42 + Math.sin(a) * 28
            return (
              <g key={col}>
                <circle cx={mx.toFixed(2)} cy={(my + 1).toFixed(2)} r="6.4" fill="#000" opacity="0.2" />
                <circle cx={mx.toFixed(2)} cy={my.toFixed(2)} r="6.4" fill={col} stroke={deep} strokeWidth="1" />
                <circle cx={(mx - 2).toFixed(2)} cy={(my - 2.2).toFixed(2)} r="2" fill="#fff" opacity="0.7" />
              </g>
            )
          })}
          <circle cx="46" cy="42" r="9" fill={deep} opacity="0.4" />
          <g transform="rotate(14 74 60)">
            <rect x="63" y="42" width="24" height="34" rx="3.2" fill={accent} />
            <rect x="63" y="42" width="24" height="34" rx="3.2" fill="none" stroke="#000" strokeOpacity="0.14" strokeWidth="0.6" />
            <g transform="translate(66 46) scale(0.62)"><path d={CV_SUIT.spade} fill={deep} /></g>
          </g>
        </g>
      )
    }
    case 'fishing':
      return (
        <g>
          <path d="M-6 66 q13 -7 26 0 t26 0 t26 0 t26 0 v40 H-6 Z" fill={mid} opacity="0.5" />
          <path d="M-6 78 q13 -7 26 0 t26 0 t26 0 t26 0 v30 H-6 Z" fill={hi} opacity="0.32" />
          <path d="M84 -8 v10 M84 2 L60 44" stroke={hi} strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.9" />
          <path d="M60 44 q-4 5 1 8 q4 2 5 -2" stroke={hi} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <g transform="translate(30 50)">
            <ellipse cx="1" cy="9" rx="12" ry="3" fill="#000" opacity="0.18" />
            <ellipse cx="0" cy="0" rx="14" ry="9" fill={hi} />
            <path d="M12 0 l11 -7 v14 z" fill={hi} />
            <circle cx="-7" cy="-2" r="2" fill={deep} />
            <path d="M-3 4 q4 3 9 1" stroke={deep} strokeWidth="1" fill="none" opacity="0.4" />
          </g>
        </g>
      )
    case 'tray':
      return (
        <g>
          <ellipse cx="50" cy="70" rx="34" ry="6" fill="#000" opacity="0.2" />
          <ellipse cx="50" cy="58" rx="38" ry="12" fill={deep} />
          <ellipse cx="50" cy="55" rx="38" ry="12" fill={mid} />
          <ellipse cx="50" cy="55" rx="30" ry="8.5" fill={hi} opacity="0.35" />
          <path d="M34 54 q-2 0 -2 -3 v-8 h12 v8 q0 3 -2 3 z" fill={hi} />
          <ellipse cx="38" cy="43" rx="6" ry="2" fill={deep} opacity="0.35" />
          <path d="M46 46 q4 -1 4 3 t-4 3" fill="none" stroke={hi} strokeWidth="2" />
          <path d="M58 54 q-2 0 -2 -3 v-6 h11 v6 q0 3 -2 3 z" fill={hi} />
          <ellipse cx="63.5" cy="45" rx="5.5" ry="2" fill={deep} opacity="0.35" />
          <path d="M38 36 q-3 -4 0 -8 M63 38 q-3 -4 0 -8" fill="none" stroke={hi} strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
        </g>
      )
    case 'wheel': {
      const segs = 8
      const cx = 50; const cy = 46; const R = 30
      const pt = (deg, r) => [cx + Math.cos(deg * Math.PI / 180) * r, cy + Math.sin(deg * Math.PI / 180) * r]
      return (
        <g>
          <ellipse cx="50" cy="76" rx="30" ry="6" fill="#000" opacity="0.2" />
          <circle cx={cx} cy={cy} r={R + 3} fill={deep} />
          {Array.from({ length: segs }).map((_, i) => {
            const [x0, y0] = pt(i * (360 / segs) - 90, R)
            const [x1, y1] = pt((i + 1) * (360 / segs) - 90, R)
            return <path key={i} d={`M${cx} ${cy} L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`} fill={i % 2 ? mid : hi} opacity={i % 2 ? 0.7 : 0.95} />
          })}
          <circle cx={cx} cy={cy} r={R} fill="none" stroke={deep} strokeOpacity="0.4" strokeWidth="1" />
          <circle cx={cx} cy={cy} r="6" fill={deep} />
          <circle cx={cx} cy={cy} r="6" fill="none" stroke={hi} strokeWidth="1.4" opacity="0.6" />
          <path d={`M${cx - 5} ${cy - R - 6} L${cx + 5} ${cy - R - 6} L${cx} ${cy - R + 4} Z`} fill={hi} />
        </g>
      )
    }
    case 'ticket':
      return (
        <g>
          <ellipse cx="50" cy="76" rx="30" ry="6" fill="#000" opacity="0.2" />
          <g transform="rotate(-9 40 44)">
            <rect x="26" y="18" width="36" height="52" rx="5" fill={mid} opacity="0.6" />
          </g>
          <g transform="rotate(6 60 46)">
            <rect x="41.5" y="16" width="38" height="56" rx="5" fill="#000" opacity="0.18" />
            <rect x="40" y="14" width="38" height="56" rx="5" fill={hi} />
            <path d="M46 26 h26 M46 34 h26 M46 42 h20 M46 50 h24" stroke={deep} strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
            <circle cx="66" cy="60" r="7" fill={mid} />
            <path d="M63 60 l2 2.4 l4 -4.6" fill="none" stroke={hi} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
      )
    case 'basket':
      return (
        <g>
          <circle cx="34" cy="14" r="6" fill={hi} opacity="0.9" />
          <circle cx="58" cy="8" r="4.6" fill={mid} />
          <circle cx="70" cy="22" r="5.4" fill={hi} opacity="0.7" />
          <circle cx="48" cy="26" r="4" fill={accent} opacity="0.6" />
          <ellipse cx="50" cy="72" rx="30" ry="6" fill="#000" opacity="0.2" />
          <path d="M26 46 h48 l-6 26 a5 5 0 0 1 -5 4 H37 a5 5 0 0 1 -5 -4 Z" fill={mid} />
          <path d="M26 46 h48 l-1.4 6 H27.4 Z" fill={hi} opacity="0.85" />
          <path d="M34 54 l3 20 M50 54 v20 M66 54 l-3 20" stroke={deep} strokeWidth="1.6" opacity="0.35" />
          <path d="M32 50 q18 -12 36 0" fill="none" stroke={hi} strokeWidth="2" opacity="0.5" />
        </g>
      )
    case 'quiz':
      return (
        <g>
          <ellipse cx="50" cy="74" rx="30" ry="6" fill="#000" opacity="0.2" />
          <rect x="22" y="18" width="56" height="42" rx="12" fill={mid} opacity="0.65" />
          <path d="M40 60 l-2 12 l14 -10 z" fill={mid} opacity="0.65" />
          <path d="M42 34 a9 9 0 1 1 11 9 v4" fill="none" stroke={hi} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="47.5" cy="53" r="3.4" fill={hi} />
          <circle cx="70" cy="16" r="5" fill={hi} opacity="0.5" />
        </g>
      )
    case 'cake':
      return (
        <g>
          <ellipse cx="50" cy="74" rx="32" ry="6" fill="#000" opacity="0.2" />
          <rect x="24" y="58" width="52" height="16" rx="6" fill={mid} />
          <rect x="30" y="44" width="40" height="15" rx="6" fill={hi} opacity="0.92" />
          <rect x="36" y="31" width="28" height="14" rx="6" fill={mid} />
          <rect x="42" y="20" width="16" height="12" rx="5" fill={hi} />
          <path d="M30 50 q5 6 10 0 q5 6 10 0 q5 6 10 0" fill="none" stroke={accent} strokeWidth="2" opacity="0.55" />
          <circle cx="50" cy="14" r="4.4" fill={accent} />
          <path d="M50 10 q3 -5 6 -4" fill="none" stroke={hi} strokeWidth="1.4" opacity="0.6" />
        </g>
      )
    case 'latte':
      return (
        <g>
          <ellipse cx="48" cy="72" rx="30" ry="6" fill="#000" opacity="0.2" />
          <ellipse cx="48" cy="46" rx="34" ry="20" fill={mid} opacity="0.55" />
          <ellipse cx="48" cy="44" rx="24" ry="15" fill={deep} />
          <ellipse cx="48" cy="43" rx="22" ry="13.5" fill={hi} />
          <g fill={mid} opacity="0.9">
            <path d="M48 33 q7 10 0 21 q-7 -11 0 -21 Z" />
            <path d="M48 37 q-9 3 -13 8 q9 -1 13 -4 Z" opacity="0.7" />
            <path d="M48 37 q9 3 13 8 q-9 -1 -13 -4 Z" opacity="0.7" />
          </g>
          <path d="M70 40 q9 3 0 10" fill="none" stroke={deep} strokeWidth="4" />
          <path d="M70 41 q7 2.5 0 8" fill="none" stroke={hi} strokeWidth="1.4" opacity="0.5" />
        </g>
      )
    case 'match': {
      const cards = [
        [22, 22, true], [46, 22, false], [70, 22, false],
        [22, 50, false], [46, 50, false], [70, 50, true],
      ]
      return (
        <g>
          {cards.map(([cx, cy, on], i) => (
            <g key={i}>
              <rect x={cx} y={cy} width="20" height="24" rx="4" fill={on ? hi : mid} opacity={on ? 0.95 : 0.5} />
              {on ? (
                <g transform={`translate(${cx + 5} ${cy + 5})`} fill={deep}>
                  <path d="M5 0 C7 4 7 7 5 10 C3 7 3 4 5 0 Z" />
                  <circle cx="5" cy="6" r="2.4" opacity="0.6" />
                </g>
              ) : (
                <circle cx={cx + 10} cy={cy + 12} r="3.4" fill={hi} opacity="0.3" />
              )}
            </g>
          ))}
        </g>
      )
    }
    case 'grill':
      return (
        <g>
          <path d="M50 12 q16 18 7 32 q-3 6 -7 8 q-4 -2 -7 -8 q-9 -14 7 -32 Z" fill={mid} />
          <path d="M50 26 q9 11 4 20 q-2 4 -4 5 q-2 -1 -4 -5 q-5 -9 4 -20 Z" fill={accent} opacity="0.75" />
          <ellipse cx="50" cy="66" rx="34" ry="8" fill={deep} />
          <path d="M20 64 h60 M22 68 h56 M26 72 h48" stroke={mid} strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />
          <ellipse cx="42" cy="64" rx="8" ry="3.4" fill={accent} opacity="0.85" />
          <ellipse cx="62" cy="66" rx="7" ry="3" fill={hi} opacity="0.7" />
        </g>
      )
    case 'bubbles': {
      const b = [
        [40, 44, 18, mid, 0.75], [64, 30, 13, hi, 0.85], [70, 54, 15, mid, 0.6],
        [50, 62, 9, hi, 0.55], [30, 26, 8, hi, 0.5], [78, 20, 6, hi, 0.4],
      ]
      return (
        <g>
          {b.map(([x, y, r, col, o], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r={r} fill={col} opacity={o} />
              <circle cx={x - r * 0.35} cy={y - r * 0.38} r={r * 0.24} fill="#fff" opacity="0.55" />
            </g>
          ))}
        </g>
      )
    }
    case 'bulb':
      return (
        <g>
          <circle cx="50" cy="40" r="30" fill={mid} opacity="0.35" />
          <path d="M50 6 v-4 M28 16 l-3 -3 M72 16 l3 -3 M18 40 h-5 M82 40 h5" stroke={hi} strokeWidth="2.6" strokeLinecap="round" opacity="0.6" />
          <circle cx="50" cy="38" r="23" fill={hi} />
          <path d="M40 60 h20 l-2 6 h-16 z" fill={mid} />
          <path d="M43 63.5 h14 M45 68.5 h10" stroke={deep} strokeWidth="1.6" opacity="0.6" />
          <path d="M42 32 a9 9 0 1 1 12 8.4 q-4 2.7 -4 6.6" fill="none" stroke={deep} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="50" cy="53" r="3" fill={deep} />
          <path d="M44 74 h12 v1.5 a6 6 0 0 1 -12 0 z" fill={mid} />
        </g>
      )
    case 'jigsaw':
      return (
        <g>
          <rect x="26" y="20" width="26" height="26" rx="5" fill={hi} />
          <rect x="26" y="52" width="26" height="26" rx="5" fill={mid} />
          <rect x="54" y="52" width="26" height="26" rx="5" fill={hi} />
          <circle cx="39" cy="49" r="4.6" fill={hi} />
          <circle cx="57" cy="65" r="4.6" fill={mid} />
          <rect x="54" y="20" width="26" height="26" rx="5" fill={deep} opacity="0.28" />
          <rect x="54" y="20" width="26" height="26" rx="5" fill="none" stroke={hi} strokeOpacity="0.5" strokeWidth="1.4" strokeDasharray="4 4" />
          <g transform="rotate(10 70 12)">
            <rect x="58" y="2" width="24" height="24" rx="5" fill={accent} />
            <circle cx="82" cy="14" r="4.4" fill={accent} />
            <rect x="58" y="2" width="24" height="24" rx="5" fill="none" stroke="#000" strokeOpacity="0.15" strokeWidth="1" />
          </g>
        </g>
      )
    case 'letters': {
      const cell = (x, y, fill) => <rect x={x} y={y} width="18" height="18" rx="3.4" fill={fill} />
      return (
        <g>
          {[26, 46, 66].map((x) => <g key={`r${x}`}>{cell(x, 38, hi)}</g>)}
          {cell(46, 18, hi)}
          {cell(46, 58, hi)}
          {cell(46, 38, mid)}
          <g fill="none" stroke={deep} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.78">
            <path d="M31 42 v10 M31 52 h7" />
            <path d="M69 42 l4 8 l4 -8" />
            <path d="M51 22 h8 M55 22 v10" />
            <path d="M51 62 v10 M59 62 v10 M51 67 h8" />
          </g>
        </g>
      )
    }
    case 'flavor': {
      const cx = 50; const cy = 42; const R = 30
      const pt = (deg, r) => [cx + Math.cos(deg * Math.PI / 180) * r, cy + Math.sin(deg * Math.PI / 180) * r]
      return (
        <g>
          <ellipse cx="50" cy="72" rx="30" ry="6" fill="#000" opacity="0.2" />
          {CV_FLAVOR.map((col, i) => {
            const [x0, y0] = pt(i * 60 - 90, R)
            const [x1, y1] = pt(i * 60 - 30, R)
            return <path key={col} d={`M${cx} ${cy} L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`} fill={col} opacity="0.92" />
          })}
          <circle cx={cx} cy={cy} r={R} fill="none" stroke={deep} strokeOpacity="0.4" strokeWidth="1.4" />
          <circle cx={cx} cy={cy} r="8" fill={deep} />
          <circle cx={cx} cy={cy} r="8" fill="none" stroke={hi} strokeWidth="1.4" opacity="0.6" />
          <path d={`M${cx} ${cy} L${cx + 3} ${cy - 2} L${pt(-54, R + 4)[0].toFixed(2)} ${pt(-54, R + 4)[1].toFixed(2)} L${cx - 3} ${cy + 2} Z`} fill={hi} />
          <circle cx={cx} cy={cy} r="3.4" fill={hi} />
        </g>
      )
    }
    case 'mirror': {
      const bust = 'M20 84 C21 64 28 60 36 58 C29 50 28 40 33 32 C38 24 47 20 54 25 C58 28 57 34 55 37 L58 42 L53 45 L58 50 L52 54 L56 58 L50 62 L50 84 Z'
      return (
        <g>
          <rect x="44" y="14" width="12" height="72" fill={hi} opacity="0.12" />
          <path d="M50 16 v68" stroke={hi} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
          <path d={bust} fill={mid} />
          <path d={bust} fill={hi} opacity="0.45" transform="matrix(-1 0 0 1 100 0)" />
          <path d={bust} fill="none" stroke={deep} strokeWidth="1.2" opacity="0.4" />
        </g>
      )
    }
    case 'scale':
      return (
        <g>
          <ellipse cx="50" cy="80" rx="24" ry="5" fill="#000" opacity="0.2" />
          <path d="M47 34 h6 v44 h-6 z" fill={mid} />
          <path d="M34 78 h32 l-5 7 h-22 z" fill={mid} />
          <path d="M37 81.5 h26" stroke={deep} strokeWidth="1.4" opacity="0.5" />
          <path d="M50 26 l6 9 h-12 z" fill={hi} />
          <path d="M24 33 L76 41" fill="none" stroke={hi} strokeWidth="4" strokeLinecap="round" />
          <path d="M25 34 v10 M75 41 v12" stroke={hi} strokeWidth="1.4" opacity="0.7" />
          <path d="M15 44 q10 10 20 0 z" fill={hi} />
          <path d="M65 53 q10 10 20 0 z" fill={hi} />
        </g>
      )
    default:
      return (
        <g>
          <circle cx="50" cy="44" r="30" fill={mid} opacity="0.4" />
          <circle cx="50" cy="44" r="30" fill="none" stroke={hi} strokeWidth="2" opacity="0.5" />
          <circle cx="50" cy="44" r="18" fill="none" stroke={hi} strokeWidth="3" opacity="0.75" />
          <circle cx="50" cy="44" r="7" fill={hi} />
        </g>
      )
  }
}

// The gradient plate + scene. `translate(25 22)` drops the local 0..100 motif
// box into the upper region of the 150x200 cover; the bottom scrim rect keeps
// the HTML name band legible over any palette. Slice-cropped, so it fills every
// aspect it is placed in (shelf card, hero, gate thumb) without letterboxing.
function CoverArt({ game, className = '', top = false }) {
  const C = coverPalette(game)
  const [deep, mid] = C
  const motif = game?.cover?.motif || 'default'
  const gid = `gcv-${String(game?.id || 'x').replace(/[^A-Za-z0-9_-]/g, '')}`
  // A wide hero crops the tall viewBox to a horizontal band; aligning to the
  // TOP keeps the focal motif (which lives in the upper region) in view rather
  // than showing only the empty lower plate.
  const par = top ? 'xMidYMin slice' : 'xMidYMid slice'
  return (
    <span className={`gh-cover-art ${className}`} aria-hidden="true">
      <svg viewBox="0 0 150 200" preserveAspectRatio={par} focusable="false">
        <defs>
          <linearGradient id={`${gid}-p`} x1="0.1" y1="0" x2="0.55" y2="1">
            <stop offset="0" stopColor={mid} />
            <stop offset="1" stopColor={deep} />
          </linearGradient>
          <radialGradient id={`${gid}-h`} cx="0.5" cy="0.14" r="0.85">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.24" />
            <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${gid}-s`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={deep} stopOpacity="0" />
            <stop offset="1" stopColor={deep} stopOpacity="0.85" />
          </linearGradient>
        </defs>
        <rect width="150" height="200" fill={`url(#${gid}-p)`} />
        <rect width="150" height="200" fill={`url(#${gid}-h)`} />
        <g transform="translate(25 22)">{renderScene(motif, C)}</g>
        <rect y="104" width="150" height="96" fill={`url(#${gid}-s)`} />
      </svg>
    </span>
  )
}

// The feature strip — never more than what is true. Party games carry a seat
// range + «ضد الكمبيوتر»; staged games carry «مراحل»; a one-shot round carries
// only its seat count.
function coverFeatures(g, t) {
  const cv = g?.cover || {}
  const out = []
  if (cv.players) out.push({ k: 'p', icon: 'customers', label: cv.players, ltr: true })
  if (cv.stages) out.push({ k: 's', icon: 'layers', label: t.featStages })
  if (cv.vsCpu) out.push({ k: 'c', icon: 'grid', label: t.featCpu })
  return out
}

export default function GamesCenter({
  open, onClose, tenantId, tenant, items = [], lang = 'ar', table = null,
  onIdentify, onGamePlay,
  // Set when the guest arrived from an invite link (/join → menu?room=&game=).
  // The hub then skips promo and browse and drops straight onto that board.
  joinRoomId = '', joinGameId = '',
  // Direct-open a single game through the NORMAL gate/lobby flow (used by the
  // post-order «العب وأنت تنتظر» card). Default '' changes nothing: the effect
  // below no-ops. Unlike joinGameId this needs no room — it simply drives the
  // hub's own pickGame once, so registration is never bypassed.
  openGameId = '',
}) {
  const t = TXT[lang] || TXT.ar
  useScrollLock(open) // full-screen games hub: lock the menu behind it
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
  // Game-sounds mute. The module owns persistence; this state only re-renders
  // the icon. Toggling ON plays a confirmation click, which doubles as the
  // user-gesture that unlocks the AudioContext for everything after it.
  const [sndMuted, setSndMuted] = useState(() => isMuted())
  const toggleSound = useCallback(() => {
    setSndMuted((m) => {
      const next = !m
      setMuted(next)
      if (!next) playSound('click')
      return next
    })
  }, [])

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
  const modRef = useRef(null)      // the loaded game module — the rematch path re-deals from its initialState
  const mySeat = useMemo(() => {
    const p = (room?.players || []).find((x) => x.id === deviceKey())
    return p ? p.seat : null
  }, [room])

  // Latest room snapshot for callbacks: submitMove must judge a rematch against
  // the CURRENT room status, not the one captured when it was created.
  const roomRef = useRef(null)
  useEffect(() => { roomRef.current = room }, [room])

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
    const mt = move?.type || move?.t
    // A finished room refuses applyMove outright, so the in-game «مباراة
    // جديدة» buttons can only work as a restart of the SAME room: the host
    // re-deals through startGame with a fresh initialState. Non-hosts stay a
    // no-op, exactly like any other rejected move.
    const cur = roomRef.current
    if (cur?.status === 'ended' && (mt === 'newGame' || mt === 'reset')) {
      if (cur.hostId !== deviceKey() || !modRef.current) return Promise.resolve()
      const mod = modRef.current
      let st = {}
      try { st = typeof mod.initialState === 'function' ? mod.initialState(cur.players?.length || 2) : {} } catch (_) { st = {} }
      return startRoomGame({
        tid: tenantId,
        roomId,
        playerId: deviceKey(),
        initialState: st,
        // Same rule as the lobby start: an opener the deal pre-picked
        // (Dominoes' highest double) must become the room's turn seat.
        firstSeat: Number.isInteger(st?.turn) ? st.turn : 0,
      }).catch(() => { /* rejected restart: the snapshot already shows the truth */ })
    }
    return applyMove({
      tid: tenantId,
      roomId,
      seat: mySeat,
      move,
      reduce: reduceRef.current,
      // Moves a NON-turn seat must legitimately submit: anti-stall skips, chess
      // resign/draw negotiation (the offerer keeps the turn), and deals/rematches
      // (the host's seat is not necessarily the turn seat after a host transfer).
      // Every one of them is still fully validated by the game's own reducer.
      allowOutOfTurn: ['forceSkip', 'skipTurn', 'resign', 'offerDraw', 'acceptDraw', 'declineDraw', 'deal', 'next'].includes(mt),
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
      modRef.current = mod
      reduceRef.current = typeof mod.reduce === 'function' ? mod.reduce : null
    } catch (_) { modRef.current = null; reduceRef.current = null }
    // Remember the room locally so «من لعبت معهم» still knows these people
    // tomorrow — the room doc itself is not queryable by participant.
    rememberRoom(tenantId, rid)
    setRoomId(rid)
    // Re-assert the active game AFTER the await. On the invite mount `setActiveId`
    // above (line ~1012) runs before `g.load()`, then the [tenantId] reset effect
    // fires later in the same mount and clobbers activeId back to null — so by the
    // time we land here `view` becomes 'play' but `active` would be null and the
    // board never mounts (the render falls through to the browse shelf). `id` was
    // captured at the top of enterRoom, so it survives the clobber. On the lobby
    // and solo paths this is a harmless no-op (id is already the active game).
    setActiveId(id)
    activeRef.current = id
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

  // Direct-open from the post-order wait card: run the guest's chosen game
  // through the very same pickGame the shelves use, once per mount. It respects
  // the gate (unregistered → registration first), routes a party game to the
  // lobby, and simply does nothing when the id is empty or the venue disabled it.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (!open || autoOpenedRef.current) return
    if (!openGameId || !gameById(openGameId)) return
    if (!enabled.some((g) => g.id === openGameId)) return
    // Deferred to a macrotask on purpose: the hub's [tenantId] reset effect sets
    // the initial view (promo/browse), and under StrictMode's double effect
    // invoke it runs a second time AFTER this one — a synchronous pickGame here
    // would be clobbered back to promo. A timeout lands the pick after the whole
    // mount settles (the same reason the joinGameId path gets away with it: its
    // enterRoom is async). Cleared on cleanup so it never fires post-unmount.
    const id = setTimeout(() => {
      if (autoOpenedRef.current) return
      autoOpenedRef.current = true
      pickGame(openGameId)
    }, 0)
    return () => clearTimeout(id)
  }, [open, openGameId, enabled, pickGame])

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

  // One game cover: an original SVG scene under a large Arabic name and a
  // truthful feature strip. `hero` renders the wider featured card for the
  // leading party shelf. Every card is a single button wired to pickGame, so
  // the gate / lobby / solo / room routing is entirely unchanged.
  const renderCard = (g, opts = {}) => {
    const hero = !!opts.hero
    const pal = coverPalette(g)
    const best = store.best?.[g.id] || 0
    const hasResume = Boolean(resumeFor(g.id))
    const hasPrize = hasAnyReward || rewardGameIds.has(g.id)
    const isNew = NEW_SET.has(g.id)
    const feats = coverFeatures(g, t)
    return (
      <button
        key={opts.key || g.id}
        type="button"
        className={`gh-cover gh-press${hero ? ' gh-cover-hero' : ''}${opts.className ? ` ${opts.className}` : ''}`}
        style={{ '--cd': pal[0], '--cm': pal[1], '--ch': pal[2] }}
        onClick={() => pickGame(g.id)}
        aria-label={gameName(g, lang)}
      >
        <CoverArt game={g} top={hero} />
        <span className="gh-cover-sheen" aria-hidden="true" />
        <span className="gh-cover-tl">
          {isNew ? <span className="gh-tag-new">{t.newTag}</span> : null}
          {hasResume ? <span className="gh-chip gh-chip-resume"><Icon name="reload" size={11} />{t.resume}</span> : null}
          {hasPrize ? <span className="gh-chip gh-chip-prize"><Icon name="offers" size={11} />{t.prize}</span> : null}
        </span>
        {best > 0 ? (
          <span className="gh-cover-best" title={t.best}><Icon name="star" size={11} />{fmt(best)}</span>
        ) : null}
        <span className="gh-cover-info">
          <strong className="gh-cover-name">{gameName(g, lang)}</strong>
          {hero ? <span className="gh-cover-hook">{gameHook(g, lang)}</span> : null}
          {feats.length ? (
            <span className="gh-feat-strip">
              {feats.map((f) => (
                <span key={f.k} className="gh-feat" dir={f.ltr ? 'ltr' : undefined}>
                  <Icon name={f.icon} size={12} />{f.label}
                </span>
              ))}
            </span>
          ) : null}
        </span>
        {hero ? (
          <span className="gh-cover-cta"><Icon name="play" size={17} />{t.play}</span>
        ) : null}
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
            {/* TOURNAMENT MARKER. The «ما يحدث الآن» card that announces a
                running tournament lives on the browse screen, so the moment a
                guest opened a game they lost every sign that this round was
                being counted for a prize. This chip is the shell's job (the
                games render only their play area), it appears ONLY when the
                venue really has one running AND it counts THIS game
                (tournamentCounts — an 'any' tournament counts all of them),
                and it never claims a rank the board has not written. */}
            {tour && tournamentCounts(tour, active) ? (
              <span
                title={tour.name || ''}
                style={{
                  flex: '0 0 auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 9px',
                  borderRadius: 999,
                  border: '1px solid color-mix(in srgb, var(--gh-brand, #0e7490) 55%, transparent)',
                  background: 'color-mix(in srgb, var(--gh-brand, #0e7490) 18%, transparent)',
                  fontSize: 11.5,
                  fontWeight: 800,
                  maxWidth: '38%',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}
              >
                <Icon name="award" size={13} aria-hidden="true" />
                {t.inCup}
              </span>
            ) : null}
            <span className="gh-live" aria-live="polite">{fmt(runScore)}</span>
            <button
              type="button"
              className="gh-icon-btn gh-press"
              onClick={toggleSound}
              aria-label={sndMuted ? t.soundOn : t.soundOff}
              aria-pressed={sndMuted}
            >
              <Icon name={sndMuted ? 'soundOff' : 'sound'} size={17} />
            </button>
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
            {pendingGame ? <CoverArt game={pendingGame} /> : null}
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
                // The leading shelf (when the guest has not filtered) leads with
                // a wide featured hero card; every shelf then scrolls as a
                // horizontal row so the covers keep a consistent, poster-like
                // ratio at both phone and TV widths.
                const hero = si === 0 && cat === 'all' && c.hero
                const [featGame, ...restGames] = c.games
                const heading = (
                  <h3 className={`gh-sect-h${hero ? ' gh-sect-h-hero' : ''}`}>
                    <Icon name={c.icon} size={hero ? 16 : 14} />
                    <span className="gh-sect-t">{lang === 'en' ? c.en : c.ar}</span>
                    {c.tag && lang !== 'en' ? <em className="gh-sect-tag">{c.tag}</em> : null}
                    <span className="gh-sect-n">{fmt(c.games.length)}</span>
                  </h3>
                )
                if (hero && featGame) {
                  // The featured card is a phone-only enhancement: on the phone
                  // it leads full-width as a hero, with the rest in the shelf
                  // below. On wider screens (tablet / venue TV) the hero is
                  // hidden and the shelf carries EVERY party game as an equal
                  // cover, so the row fills the width with no empty void. The
                  // featured game is therefore rendered twice — once as the
                  // phone hero, once as the shelf's wide-only lead — each with a
                  // distinct React key so the two never collide.
                  return (
                    <section key={c.id} className="gh-sect gh-sect-hero">
                      {heading}
                      {renderCard(featGame, { hero: true, className: 'gh-only-phone', key: `${featGame.id}-hero` })}
                      <div className="gh-shelf">
                        {renderCard(featGame, { className: 'gh-only-wide', key: `${featGame.id}-lead` })}
                        {restGames.map((g) => renderCard(g))}
                      </div>
                    </section>
                  )
                }
                return (
                  <section key={c.id} className="gh-sect">
                    {heading}
                    <div className="gh-shelf">{c.games.map((g) => renderCard(g))}</div>
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
