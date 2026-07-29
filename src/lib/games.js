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
      // The hub owns the Escape/Back entry for a running game; see useDismiss.
      embedded: true,
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
    cover: { motif: 'fishing', palette: ['#0b3d55', '#12849c', '#7fe3d6'], players: '1' },
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
    cover: { motif: 'tray', palette: ['#4a2410', '#c46a1c', '#ffd08a'], players: '1', stages: true },
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
    cover: { motif: 'wheel', palette: ['#331a52', '#7c46c9', '#ffcf5c'], players: '1' },
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
    cover: { motif: 'ticket', palette: ['#16224d', '#3f5bd6', '#9fc0ff'], players: '1', stages: true },
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
    cover: { motif: 'basket', palette: ['#123320', '#2f8f4e', '#b8f08a'], players: '1', stages: true },
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
    cover: { motif: 'quiz', palette: ['#3d1330', '#b0367c', '#ffb3d9'], players: '1', stages: true },
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
    cover: { motif: 'cake', palette: ['#43213a', '#d2568f', '#ffe0c2'], players: '1', stages: true },
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
    cover: { motif: 'latte', palette: ['#33200f', '#8a5a2b', '#f3ddc0'], players: '1', stages: true },
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
    cover: { motif: 'match', palette: ['#3d1c0d', '#c2691f', '#ffcf7a'], players: '1', stages: true },
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
    cover: { motif: 'grill', palette: ['#40140f', '#cc3f26', '#ffb26b'], players: '1', stages: true },
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
    cover: { motif: 'bubbles', palette: ['#152a44', '#4d7fd6', '#8fe4f0'], players: '1', stages: true },
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
    cover: { motif: 'bulb', palette: ['#132145', '#3552a8', '#ffd76b'], players: '1', stages: true },
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
    cover: { motif: 'jigsaw', palette: ['#20143f', '#5b46c4', '#c3b2ff', '#ffd27a'], players: '1', stages: true },
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
    cover: { motif: 'letters', palette: ['#3a2410', '#b0741d', '#ffe1a8'], players: '1', stages: true },
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
    cover: { motif: 'flavor', palette: ['#2a1330', '#9c3d80', '#ffd0e6'], players: '1', stages: true },
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
    cover: { motif: 'mirror', palette: ['#122740', '#3f74b0', '#c6e2ff'], players: '1', stages: true },
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
    cover: { motif: 'scale', palette: ['#123026', '#2c8a6a', '#ffdf9e'], players: '1', stages: true },
    ar: 'كيف تقرر؟',
    en: 'How You Decide',
    desc: 'ثمانية مواقف قصيرة تكشف أسلوبك في اتخاذ القرار وخلاصة عملية.',
    descEn: 'Eight short scenarios revealing your decision style.',
    icon: 'arrowLeftRight',
    tags: ['all'],
    kind: 'insight',
    load: () => import('../components/games/DecisionStyle.jsx'),
  },

  // ---- ألعاب جماعية: several phones around one table, or an invited friend ----
  // `multiplayer` makes the hub open the room lobby instead of launching solo;
  // min/maxPlayers drive the seat count the lobby waits for.
  {
    id: 'wist',
    cover: { motif: 'fan', palette: ['#0e2a26', '#1d6b57', '#f2e6cf', '#d9455f'], players: '4', vsCpu: true },
    ar: 'الوِست',
    en: 'Wist',
    desc: 'وِست بالمزايدة والشراكات — أربعة لاعبون، فريقان، ثلاث عشرة أكلة.',
    descEn: 'Partnership trick-taking with bidding, four players.',
    icon: 'card',
    tags: ['all'],
    kind: 'party',
    multiplayer: true,
    minPlayers: 4,
    maxPlayers: 4,
    // Online rooms only: gameRoom stamps turn.deadlineAt from this and the
    // board draws a countdown ring on the seat that owes a bid or a card. The
    // clock never decides anything — a seat that runs past it is skipped only
    // through Wist's own `forceSkip`, which any other player has to press.
    turnMs: 45000,
    load: () => import('../components/games/Wist.jsx'),
  },
  {
    id: 'ludo',
    cover: { motif: 'ludo', palette: ['#1d1a2e', '#3d3660', '#f7f4ee'], players: '2-4', vsCpu: true },
    ar: 'الليدو',
    en: 'Ludo',
    desc: 'اللعبة الكلاسيكية بأربعة ألوان — أخرج قطعك بستة، كُل قطع الخصم، وأوصلها إلى المركز.',
    descEn: 'The classic four-colour race: leave the yard on a six, capture rivals, get all four home.',
    icon: 'shapes',
    tags: ['all'],
    kind: 'party',
    multiplayer: true,
    minPlayers: 2,
    maxPlayers: 4,
    // Online rooms only: gameRoom stamps turn.deadlineAt from this, and the
    // board renders a countdown ring on the active seat. Local/solo rounds
    // carry no deadline (the local room mirrors deadlineAt: null).
    turnMs: 45000,
    load: () => import('../components/games/Ludo.jsx'),
  },
  {
    id: 'haree',
    cover: { motif: 'fireFan', palette: ['#2a0f14', '#c0392b', '#f2e6cf', '#ffb347'], players: '2-4', vsCpu: true },
    ar: 'الحريق',
    en: 'Hareeg',
    desc: 'حريق 14 — شدّتان وجوكرات، افتتح بخمسين ونقطة، وارمِ بلا غطاء. من بلغ 31 احترق وخرج، وآخر من يبقى يفوز.',
    descEn: 'Hareeg 14 — two decks and jokers; open at 51, never throw a cover. Reach 31 and you burn; last one standing wins.',
    icon: 'flame',
    tags: ['all'],
    kind: 'party',
    multiplayer: true,
    minPlayers: 2,
    maxPlayers: 4,
    load: () => import('../components/games/Haree.jsx'),
  },
  {
    id: 'chess',
    cover: { motif: 'chess', palette: ['#16232e', '#5b7182', '#e9eef3'], players: '2', vsCpu: true },
    ar: 'الشطرنج',
    en: 'Chess',
    desc: 'شطرنج كامل القواعد — التبييت والأخذ بالمرور والترقية، وحركة غير قانونية مستحيلة.',
    descEn: 'Full-rules chess: castling, en passant, promotion, draws.',
    icon: 'grid',
    tags: ['all'],
    kind: 'party',
    multiplayer: true,
    minPlayers: 2,
    maxPlayers: 2,
    load: () => import('../components/games/Chess.jsx'),
  },
  {
    id: 'jackaroo',
    cover: { motif: 'marbles', palette: ['#101f3a', '#3a63b8', '#ffd27a', '#f2e6cf'], players: '4', vsCpu: true },
    ar: 'الجكارو',
    en: 'Jackaroo',
    desc: 'جكارو بالورق والبِلي — فريقان، أخرج بِلْيَك بالآص أو الشايب، والسبعة تنقسم.',
    descEn: 'Cards-and-marbles partnership race.',
    icon: 'shapes',
    tags: ['all'],
    kind: 'party',
    multiplayer: true,
    minPlayers: 4,
    maxPlayers: 4,
    load: () => import('../components/games/Jackaroo.jsx'),
  },
  {
    id: 'dominoes',
    cover: { motif: 'domino', palette: ['#0f2a22', '#1f6b53', '#f5f1e6', '#16202a'], players: '2-4', vsCpu: true },
    ar: 'الدومينو',
    en: 'Dominoes',
    desc: 'دومينو الخليج — افتح بأعلى دبل، طابق الطرفين، واسحب حتى تلعب. أول من يبلغ 101 يفوز.',
    descEn: 'Gulf-style block-and-draw dominoes to 101.',
    icon: 'layers',
    tags: ['all'],
    kind: 'party',
    multiplayer: true,
    minPlayers: 2,
    maxPlayers: 4,
    load: () => import('../components/games/Dominoes.jsx'),
  },
]

// A venue that has never touched the picker gets this starter set: one game per
// flavour (skill, luck, memory, reflex) and nothing that needs a rich menu.
// A venue that has never opened the picker gets EVERY game. The centre is a
// destination, not a sampler: showing four arcade titles left three of the four
// shelves (ألغاز / معرفة / شخصية) empty, which read as a broken screen. Owners
// narrow the list in Settings when they want to.
export const DEFAULT_GAME_IDS = GAMES.map((g) => g.id)

// The «جديد» shelf tag — a plain, hand-kept list of the newest / freshly rebuilt
// titles. Editable at a glance so the owner can retire a tag once a game is no
// longer new. The hub reads it; nothing else depends on it.
export const NEW_GAME_IDS = ['haree', 'knowledgeQuiz', 'brainPuzzles', 'wordRiddles', 'tasteProfile', 'mindMirror', 'decisionStyle']

export function gameById(id) {
  return GAMES.find((g) => g.id === id) || null
}

// The games this venue enabled. `tenant.games` is an array of ids; when it is
// missing (never configured) the starter set is used. An explicitly EMPTY array
// means the venue turned games off — that is respected and returns [].
// Games this venue has never been OFFERED — as opposed to ones it turned off.
//
// The stored array holds enabled ids, so an id's absence is ambiguous: either
// the owner switched it off, or the game did not exist when they last saved.
// Nothing distinguished the two, and the consequence was severe — the FIRST
// time a venue toggled any single game, Settings.jsx froze the whole registry
// as it stood that day (`base = chosen || catalog.map(...)`), and every game
// shipped afterwards was invisible to that venue forever. «الحريق» was the
// symptom the owner noticed; six others were hidden by the same line.
//
// `gamesSeen` records the catalogue as it was at save time, which makes the
// question answerable exactly. Venues that saved before that field existed get
// NEW_GAME_IDS as a one-time bridge — it is already hand-kept for the «جديد»
// badge and already names precisely the affected titles. Once a venue saves
// again it is on the exact path and the bridge stops mattering.
export function unseenGames(tenant, enabledIds) {
  const seen = tenant && Array.isArray(tenant.gamesSeen) ? tenant.gamesSeen : null
  const known = new Set(enabledIds || [])
  return GAMES.filter((g) => {
    if (known.has(g.id)) return false
    return seen ? !seen.includes(g.id) : NEW_GAME_IDS.includes(g.id)
  })
}

export function gamesFor(tenant) {
  const ids = tenant && Array.isArray(tenant.games) ? tenant.games : null
  if (!ids) return GAMES.filter((g) => DEFAULT_GAME_IDS.includes(g.id))
  const fresh = unseenGames(tenant, ids)

  // WHOSE ORDER WINS.
  //
  // Toggling a game on or off writes `games`, and that array's ORDER used to be
  // taken as the venue's arrangement even though the venue never arranged
  // anything — it was just the order the toggles happened to be saved in. So a
  // change to the registry order (say, putting «وست» and «لودو» and «الحريق»
  // first) could never reach a venue that had merely switched one game off.
  //
  // `gamesOrdered` is set only by the DRAG handle. Without it, the venue's
  // choices are honoured but the registry decides the sequence — which is what
  // a venue that never touched the order expects. With it, their sequence is
  // untouchable.
  if (!tenant.gamesOrdered) {
    const on = new Set(ids)
    const show = new Set(fresh.map((g) => g.id))
    return GAMES.filter((g) => on.has(g.id) || show.has(g.id))
  }

  // They arranged it themselves. Keep that order exactly — and slot anything
  // new into its REGISTRY neighbourhood rather than dumping it at the end,
  // which would drop «الحريق» to the bottom the moment we un-hid it.
  //
  // Placement rule: sit directly AFTER the game that is its nearest preceding
  // neighbour in the registry and is actually present. In a list still close to
  // registry order that puts it exactly where it belongs; in a heavily
  // rearranged one it lands beside its most closely related sibling instead of
  // jumping to the front — which is what "first game ranked after me" would do
  // to a venue that had reversed its list.
  const rankOf = (id) => GAMES.findIndex((x) => x.id === id)
  const out = ids.map(gameById).filter(Boolean)
  for (const g of fresh) {
    const rank = rankOf(g.id)
    let at = 0
    let best = -1
    for (let i = 0; i < out.length; i += 1) {
      const r = rankOf(out[i].id)
      if (r < rank && r > best) { best = r; at = i + 1 }
    }
    out.splice(at, 0, g)
  }
  return out
}

// THE WAIT-GAME SETTING, resolved in ONE place.
//
// Three screens read it — the guest's order page, /admin/guest-play and
// Settings — and they must not disagree about what "unset" means. They did:
// the admin screens treated absence as OFF while the order page fell through
// to a hard-coded «صياد البحر», so a venue saw a switch that looked off while
// its guests were served one fixed game.
//
// Absence now means ON + 'auto', because that is the behaviour a venue that
// never touched the setting already had (a game did appear) — only now it is
// drawn from the games that venue actually enabled instead of one name in the
// source. `waitGameEnabled === false` is the older explicit OFF and still wins:
// it is the only off anyone could have deliberately set.
export function resolveWaitGame(tenant) {
  const cfg = tenant && tenant.waitGame
  if (cfg && typeof cfg === 'object') {
    return { enabled: cfg.enabled === true, gameId: cfg.gameId || 'auto' }
  }
  return { enabled: tenant?.waitGameEnabled !== false, gameId: 'auto' }
}

// For the picker: every game that suits a venue type ('all' always matches).
export function gamesForTag(tag) {
  if (!tag || tag === 'all') return GAMES
  return GAMES.filter((g) => g.tags.includes(tag) || g.tags.includes('all'))
}
