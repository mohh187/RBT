// The mini-game registry. GamesCenter renders from it, and the venue's game
// picker in Settings reads it to build the on/off list.
//
// Every entry lazy-loads a component that honours the shared game contract:
//   ({ onScore, onExit, lang, brand, items, playerName }) => play area only
// The component renders ONLY its play area — the hub owns the title bar, the
// live score and closing.
//
// Note this file is plain .js, so the one component defined here (the «صياد
// البحر» adapter) is built with createElement rather than JSX.
import { createElement, useEffect, useRef } from 'react'

// ---------------------------------------------------------------------------
// «صياد البحر» adapter
//
// WaitGame.jsx predates the contract: it takes { open, onClose, tenantId, brand,
// onLeaderboard } and renders its own fixed-position overlay with a close
// button. Rather than edit it, this adapter maps it onto the contract:
//   • onExit is wired to its onClose, so the hub's close and its own agree
//   • .gb-adapt creates a containing block (transform) so its `position: fixed`
//     overlay fills the hub's stage instead of the viewport, and hides its
//     duplicate close button
//   • scoring: WaitGame never reports the live score — it only calls
//     onLeaderboard(score) if the player taps the leaderboard button, and
//     writes its device best to localStorage at game over. So the adapter
//     reports BOTH: onLeaderboard when available (exact round score) and a
//     poll of its exported getBestScore (the device best, monotonic). The hub
//     keeps the maximum, so a fishing best always lands correctly even though
//     the score does not tick live like the other games.
// ---------------------------------------------------------------------------
let fishingMod = null

function FishingAdapter({ onScore, onExit, brand = '#0e7490', tenantId = '' }) {
  const onScoreRef = useRef(onScore)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])

  // WaitGame now reports its live score through `onScore`, so no polling is
  // needed; the best-score read stays only as a safety net for an older build.
  useEffect(() => {
    const getBest = fishingMod?.getBestScore
    if (typeof getBest !== 'function' || typeof fishingMod?.default !== 'function') return undefined
    let seen = getBest(tenantId) || 0
    const iv = setInterval(() => {
      const b = getBest(tenantId) || 0
      if (b > seen) { seen = b; onScoreRef.current?.(b) }
    }, 2000)
    return () => clearInterval(iv)
  }, [tenantId])

  if (!fishingMod?.default) return null
  return createElement(
    'div',
    { className: 'gb-adapt' },
    createElement(fishingMod.default, {
      open: true,
      onClose: onExit,
      tenantId,
      brand,
      onLeaderboard: (s) => onScoreRef.current?.(Number(s) || 0),
      onScore: (s) => onScoreRef.current?.(Number(s) || 0),
    }),
  )
}

const loadFishing = () => import('../components/WaitGame.jsx').then((m) => {
  fishingMod = m
  return { default: FishingAdapter }
})

// ---------------------------------------------------------------------------
// Venue types the picker filters by. 'all' means "fits any venue".
// ---------------------------------------------------------------------------
export const GAME_TAGS = [
  { id: 'all', ar: 'كل الأنواع', en: 'Any venue' },
  { id: 'cafe', ar: 'مقهى', en: 'Cafe' },
  { id: 'restaurant', ar: 'مطعم', en: 'Restaurant' },
  { id: 'seafood', ar: 'مأكولات بحرية', en: 'Seafood' },
  { id: 'sweets', ar: 'حلويات', en: 'Sweets' },
  { id: 'lounge', ar: 'لاونج', en: 'Lounge' },
  { id: 'attar', ar: 'عطور وبخور', en: 'Perfume' },
]

export const GAMES = [
  {
    id: 'fishing',
    ar: 'صياد البحر',
    en: 'Sea Fisher',
    desc: 'أنزل الصنارة واصطد أكبر عدد من الأسماك في خمس وأربعين ثانية.',
    descEn: 'Drop the hook and land as many fish as you can.',
    icon: 'sparkles',
    tags: ['seafood', 'restaurant'],
    load: loadFishing,
  },
  {
    id: 'waiterDash',
    ar: 'سباق النادل',
    en: 'Waiter Dash',
    desc: 'اجرِ بالصينية بين الطاولات، اجمع الأكواب وحافظ على اتزانك.',
    descEn: 'Run the tray through the floor, collect cups, keep your balance.',
    icon: 'waiter',
    tags: ['restaurant', 'cafe', 'lounge'],
    load: () => import('../components/games/WaiterDash.jsx'),
  },
  {
    id: 'prizeWheel',
    ar: 'دولاب الحظ',
    en: 'Prize Wheel',
    desc: 'دورة واحدة في كل جلسة — أدر الدولاب واكسب نقاطك.',
    descEn: 'One spin per session — turn the wheel and win points.',
    icon: 'repeat',
    tags: ['all'],
    load: () => import('../components/games/PrizeWheel.jsx'),
  },
  {
    id: 'orderRush',
    ar: 'رتب الطلب',
    en: 'Order Rush',
    desc: 'احفظ طلب الزبون ثم أعد ترتيب أصنافه بالتسلسل الصحيح.',
    descEn: 'Memorize the order, then rebuild it in the right sequence.',
    icon: 'orders',
    tags: ['restaurant', 'cafe', 'sweets'],
    load: () => import('../components/games/OrderRush.jsx'),
  },
  {
    id: 'catchBasket',
    ar: 'سلة التمر',
    en: 'Catch Basket',
    desc: 'حرّك السلة والتقط التمر والحلوى، وتجنّب الفاسد منها.',
    descEn: 'Move the basket, catch the good, dodge the spoiled.',
    icon: 'bag',
    tags: ['sweets', 'cafe', 'attar'],
    load: () => import('../components/games/CatchBasket.jsx'),
  },
  {
    id: 'tasteQuiz',
    ar: 'اختبار الذوق',
    en: 'Taste Quiz',
    desc: 'عشرة أسئلة مبنية على قائمة المكان نفسها.',
    descEn: 'Ten questions built from this venue’s own menu.',
    icon: 'notepad',
    tags: ['all'],
    load: () => import('../components/games/TasteQuiz.jsx'),
  },
  {
    id: 'cakeTower',
    ar: 'برج الكيك',
    en: 'Cake Tower',
    desc: 'كدّس طبقات الكيك بدقة وابنِ أطول برج ممكن.',
    descEn: 'Stack cake layers and build the tallest tower.',
    icon: 'cake',
    tags: ['sweets', 'cafe'],
    load: () => import('../components/games/CakeTower.jsx'),
  },
  {
    id: 'latteArt',
    ar: 'فن اللاتيه',
    en: 'Latte Art',
    desc: 'اسكب الحليب وارسم نقشة اللاتيه كما في النموذج.',
    descEn: 'Pour the milk and trace the latte pattern.',
    icon: 'coffee',
    tags: ['cafe', 'lounge'],
    load: () => import('../components/games/LatteArt.jsx'),
  },
  {
    id: 'spiceMatch',
    ar: 'توأم البهارات',
    en: 'Spice Match',
    desc: 'اقلب البطاقات وطابق البهارات المتشابهة قبل انتهاء الوقت.',
    descEn: 'Flip the cards and match the spices before time runs out.',
    icon: 'flame',
    tags: ['restaurant', 'attar'],
    load: () => import('../components/games/SpiceMatch.jsx'),
  },
  {
    id: 'perfectGrill',
    ar: 'الشواء المثالي',
    en: 'Perfect Grill',
    desc: 'اقلب اللحم في اللحظة الصحيحة — لا نيء ولا محترق.',
    descEn: 'Flip at the right moment — neither raw nor burnt.',
    icon: 'kitchen',
    tags: ['restaurant', 'seafood'],
    load: () => import('../components/games/PerfectGrill.jsx'),
  },
  {
    id: 'bubblePop',
    ar: 'فقاعات الشاي',
    en: 'Bubble Pop',
    desc: 'فرقع الفقاعات المتشابهة واصنع أطول سلسلة.',
    descEn: 'Pop matching bubbles and chain the longest run.',
    icon: 'shapes',
    tags: ['cafe', 'lounge', 'sweets'],
    load: () => import('../components/games/BubblePop.jsx'),
  },

  // ---- knowledge & brain training (useful, not just time-killing) ----
  {
    id: 'knowledgeQuiz',
    ar: 'موسوعة الأسئلة',
    en: 'Knowledge Quiz',
    desc: 'أسئلة في الدين والمجتمع والجغرافيا والاقتصاد والعلوم والفن — مع شرح بعد كل إجابة.',
    descEn: 'Verified questions across ten fields, with a short explanation after each answer.',
    icon: 'notepad',
    tags: ['all'],
    kind: 'trivia',
    load: () => import('../components/games/KnowledgeQuiz.jsx'),
  },
  {
    id: 'brainPuzzles',
    ar: 'ألغاز الذكاء',
    en: 'Brain Puzzles',
    desc: 'متتابعات ومنطق وتحليل بصري بمراحل متصاعدة تقوّي التفكير.',
    descEn: 'Sequences, logic and spatial reasoning across rising stages.',
    icon: 'shapes',
    tags: ['all'],
    kind: 'puzzle',
    load: () => import('../components/games/BrainPuzzles.jsx'),
  },
  {
    id: 'wordRiddles',
    ar: 'ألغاز الكلمات',
    en: 'Word Riddles',
    desc: 'أحاجي وأمثال ومفردات عربية بمراحل تُحفظ وتُستكمل.',
    descEn: 'Arabic riddles, proverbs and vocabulary across saved stages.',
    icon: 'text',
    tags: ['all'],
    kind: 'puzzle',
    load: () => import('../components/games/WordRiddles.jsx'),
  },

  // ---- insight: psychology-based, not divination ----
  {
    id: 'tasteProfile',
    ar: 'ذوقك يحكي عنك',
    en: 'Your Taste, Read',
    desc: 'اختيارات بين صنفين من قائمة المكان، ثم قراءة لشخصيتك وترشيحات مبنية عليها.',
    descEn: 'Either/or picks from this venue\'s own menu, then a personality read.',
    icon: 'sparkles',
    tags: ['all'],
    kind: 'insight',
    load: () => import('../components/games/TasteProfile.jsx'),
  },
  {
    id: 'mindMirror',
    ar: 'مرآة الشخصية',
    en: 'Mind Mirror',
    desc: 'اثنا عشر موقفاً تتغيّر بحسب إجاباتك، ثم صورة شخصية مفصّلة.',
    descEn: 'Twelve situations that adapt to your answers, then a detailed portrait.',
    icon: 'user',
    tags: ['all'],
    kind: 'insight',
    load: () => import('../components/games/MindMirror.jsx'),
  },
  {
    id: 'decisionStyle',
    ar: 'كيف تقرر؟',
    en: 'How You Decide',
    desc: 'ثمانية مواقف قصيرة تكشف أسلوبك في اتخاذ القرار وخلاصة عملية.',
    descEn: 'Eight short scenarios revealing your decision style.',
    icon: 'arrowLeftRight',
    tags: ['all'],
    kind: 'insight',
    load: () => import('../components/games/DecisionStyle.jsx'),
  },
]

// A venue that has never touched the picker gets this starter set: one game per
// flavour (skill, luck, memory, reflex) and nothing that needs a rich menu.
export const DEFAULT_GAME_IDS = ['fishing', 'waiterDash', 'catchBasket', 'prizeWheel']

export function gameById(id) {
  return GAMES.find((g) => g.id === id) || null
}

// The games this venue enabled. `tenant.games` is an array of ids; when it is
// missing (never configured) the starter set is used. An explicitly EMPTY array
// means the venue turned games off — that is respected and returns [].
export function gamesFor(tenant) {
  const ids = tenant && Array.isArray(tenant.games) ? tenant.games : null
  if (!ids) return GAMES.filter((g) => DEFAULT_GAME_IDS.includes(g.id))
  return ids.map(gameById).filter(Boolean)
}

// For the picker: every game that suits a venue type ('all' always matches).
export function gamesForTag(tag) {
  if (!tag || tag === 'all') return GAMES
  return GAMES.filter((g) => g.tags.includes(tag) || g.tags.includes('all'))
}
