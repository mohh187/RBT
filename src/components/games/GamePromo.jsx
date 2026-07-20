// The marketing splash the guest sees the first time they open «ركن الألعاب».
//
// It also owns the hub's visual language: `GameThumb` draws every game tile as
// pure SVG from a hand-picked palette, so the hub ships zero image assets and
// still looks designed rather than placeholder-y. GamesCenter imports both.
//
// Nothing here promises a prize. The rewards block renders only from rules the
// venue actually configured and that gameRewards.js already validated — when
// `rewards` is empty the whole block is absent, not softened.
import '../../styles/gameshub.css'
import '../../styles/gameart.css'
import Icon from '../Icon.jsx'

const n = (v) => Number(v || 0).toLocaleString('ar-SA-u-nu-latn')

// ---------------------------------------------------------------------------
// colour helpers — a game's palette can be hand-picked, or derived from the
// venue brand so a game added later still lands in a coherent scheme.
// ---------------------------------------------------------------------------
function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return { h: 190, s: 78, l: 30 }
  const int = parseInt(m[1], 16)
  const r = ((int >> 16) & 255) / 255
  const g = ((int >> 8) & 255) / 255
  const b = (int & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  h = Math.round(h * 60)
  if (h < 0) h += 360
  const l = (max + min) / 2
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) }
}

const hsl = (h, s, l) => `hsl(${((h % 360) + 360) % 360} ${Math.max(0, Math.min(100, s))}% ${Math.max(0, Math.min(100, l))}%)`

function hashOf(str) {
  let h = 2166136261
  const s = String(str || '')
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

// ---------------------------------------------------------------------------
// Per-game presentation: a warmer Arabic name, a one-line hook, the art scene
// and its palette. Keyed by the registry ids; anything not listed falls back to
// the registry text and a brand-derived palette, so a newly registered game is
// never broken — just less bespoke.
// ---------------------------------------------------------------------------
const ART_KINDS = ['waves', 'dash', 'burst', 'cards', 'fall', 'quiz', 'stack', 'swirl', 'grid', 'heat', 'bubbles', 'mind']

export const GAME_ART = {
  fishing: { art: 'waves', c: ['#0b3d55', '#12849c', '#7fe3d6'], name: 'صياد البحر', hook: 'خمس وأربعون ثانية، وصنّارة واحدة.' },
  waiterDash: { art: 'dash', c: ['#4a2410', '#c46a1c', '#ffd08a'], name: 'سباق النادل', hook: 'صينية ممتلئة وصالة مزدحمة.' },
  prizeWheel: { art: 'burst', c: ['#331a52', '#7c46c9', '#ffcf5c'], name: 'دولاب الحظ', hook: 'دورة واحدة. حظك وحده يقرر.' },
  orderRush: { art: 'cards', c: ['#16224d', '#3f5bd6', '#9fc0ff'], name: 'رتّب الطلب', hook: 'احفظ الطلب، ثم أعده كما كان.' },
  catchBasket: { art: 'fall', c: ['#123320', '#2f8f4e', '#b8f08a'], name: 'سلة التمر', hook: 'التقط الطيّب، وتجنّب الفاسد.' },
  tasteQuiz: { art: 'quiz', c: ['#3d1330', '#b0367c', '#ffb3d9'], name: 'اختبار الذوق', hook: 'عشرة أسئلة من قائمة المكان نفسه.' },
  cakeTower: { art: 'stack', c: ['#43213a', '#d2568f', '#ffe0c2'], name: 'برج الكيك', hook: 'طبقة فوق طبقة، وبدقة.' },
  latteArt: { art: 'swirl', c: ['#33200f', '#8a5a2b', '#f3ddc0'], name: 'فن اللاتيه', hook: 'اسكب الحليب وارسم النقشة.' },
  spiceMatch: { art: 'grid', c: ['#3d1c0d', '#c2691f', '#ffcf7a'], name: 'توأم البهارات', hook: 'اقلب البطاقات وطابقها قبل الوقت.' },
  perfectGrill: { art: 'heat', c: ['#40140f', '#cc3f26', '#ffb26b'], name: 'الشواء المثالي', hook: 'اقلبها في اللحظة الصحيحة.' },
  bubblePop: { art: 'bubbles', c: ['#152a44', '#4d7fd6', '#8fe4f0'], name: 'فقاعات الشاي', hook: 'اصنع أطول سلسلة تفجير.' },

  // ---- the table games. `name` is deliberately left empty so the registry in
  // lib/games.js stays the single source of truth for what each one is called.
  // The fourth colour, where present, is an accent the bespoke scenes use for
  // the red suits and the pips — the abstract scenes only ever read three.
  ludo: {
    art: 'ludoBoard',
    c: ['#1d1a2e', '#3d3660', '#f7f4ee'],
    name: '',
    hook: 'أربعة ألوان، وسباق إلى المركز.',
  },
  chess: {
    art: 'chessBoard',
    c: ['#16232e', '#5b7182', '#e9eef3'],
    name: '',
    hook: 'لوح كامل القواعد، وخصم أمامك.',
  },
  dominoes: {
    art: 'dominoTiles',
    c: ['#0f2a22', '#1f6b53', '#f5f1e6', '#16202a'],
    name: '',
    hook: 'افتح بأعلى دبل، وطابق الطرفين.',
  },
  wist: {
    art: 'suitFan',
    c: ['#0e2a26', '#1d6b57', '#f2e6cf', '#d9455f'],
    name: '',
    hook: 'فريقان، مزايدة، وثلاث عشرة أكلة.',
  },
  jackaroo: {
    art: 'marbleTrack',
    c: ['#101f3a', '#3a63b8', '#ffd27a', '#f2e6cf'],
    name: '',
    hook: 'ورق وبِلي، ومضمار حول اللوح.',
  },
}

// A stable, coherent palette for a game with no hand-picked entry: the venue's
// own hue, rotated by a hash of the id so two games never look identical.
function derivedArt(game, brand) {
  const base = hexToHsl(brand)
  const h = hashOf(game?.id)
  const shift = ((h % 5) - 2) * 26
  const hue = base.h + shift
  return {
    art: ART_KINDS[h % ART_KINDS.length],
    c: [hsl(hue, 46, 16), hsl(hue, 58, 40), hsl(hue + 14, 72, 74)],
    name: '',
    hook: '',
  }
}

// The single place the hub asks "how do I present this game?".
export function gameArt(game, brand) {
  const hand = GAME_ART[game?.id]
  return hand || derivedArt(game, brand)
}

export function gameName(game, lang = 'ar') {
  if (lang === 'en') return game?.en || game?.ar || ''
  return GAME_ART[game?.id]?.name || game?.ar || ''
}

export function gameHook(game, lang = 'ar') {
  if (lang === 'en') return game?.descEn || game?.desc || ''
  return GAME_ART[game?.id]?.hook || game?.desc || ''
}

// ---------------------------------------------------------------------------
// BESPOKE SCENES for the five table games.
//
// The abstract scenes below are abstract on purpose: at thumbnail size a shape
// reads as "designed" where a weak illustration reads as noise. These five are
// the exception. A party game has to be RECOGNISED off the shelf, and with no
// hand-picked entry «الليدو» fell through to the hash fallback and drew a
// generic card fan while «الشطرنج» drew a generic target — artwork that tells
// the guest nothing about the game behind it. So each of these draws the real
// object: the actual Ludo cross, real chess silhouettes, real domino pips.
//
// SAFE AREA — the constraint that decides every coordinate here. The tile SVG
// is 160 x 104 drawn with preserveAspectRatio="xMidYMid slice", so the frame is
// CROPPED rather than letterboxed, and how much is cropped depends on where the
// thumb is used:
//     .gh-card-art        16 / 11   -> roughly x   4 .. 156 survives
//     .gh-grid-hero art    4 / 3    -> roughly x  11 .. 149
//     .gh-promo-tile       1 / 1.18 -> roughly x  36 .. 124   <- binding case
// Everything load-bearing therefore lives inside x 36..124, y 0..104. Only
// decoration may sit outside it.
//
// These names are NOT added to ART_KINDS. That array is the pool the hash
// fallback picks from for a game nobody has styled yet, and a future cafe game
// must not randomly land on a chessboard. They are reachable only through a
// hand-picked GAME_ART entry.
// ---------------------------------------------------------------------------

// The four Ludo colours, in the same order and the same hex as COLORS in
// Ludo.jsx, so the shelf art and the board a guest then opens agree.
const LUDO_C = ['#d92b3a', '#16a34a', '#e0a409', '#2563eb']
// 6 x 6 yards, in board units, clockwise from top-left
const LUDO_YARD = [[0, 0], [9, 0], [9, 9], [0, 9]]
// each colour's run of home cells: [x, y, w, h]
const LUDO_LANE = [[1, 7, 5, 1], [7, 1, 1, 5], [9, 7, 5, 1], [7, 9, 1, 5]]
// the centre goal, one triangle per colour, each pointing back down its own lane
const LUDO_GOAL = [
  'M6 6 L6 9 L7.5 7.5 Z',
  'M6 6 L9 6 L7.5 7.5 Z',
  'M9 6 L9 9 L7.5 7.5 Z',
  'M6 9 L9 9 L7.5 7.5 Z',
]

// The cell rulings on the two arms of the cross, as one path.
function ludoRules() {
  const seg = []
  for (let i = 1; i <= 5; i += 1) {
    seg.push(`M6 ${i} h3`, `M6 ${i + 9} h3`, `M${i} 6 v3`, `M${i + 9} 6 v3`)
  }
  seg.push('M7 0 v6', 'M8 0 v6', 'M7 9 v6', 'M8 9 v6')
  seg.push('M0 7 h6', 'M0 8 h6', 'M9 7 h6', 'M9 8 h6')
  return seg.join(' ')
}
const LUDO_RULES = ludoRules()

function SceneLudo({ c }) {
  const [, , hi] = c
  return (
    <g>
      {/* The board plate, drawn in real board units and scaled once, so the
          proportions match the playable board exactly. It fills the safe area
          on its own: a die was tried alongside it and had nowhere to go except
          on top of a corner yard, where at 84px it read as a fifth base. The
          four-armed cross in four colours is already the unmistakable signal. */}
      <g className="ga-lift" transform="translate(37.4 8.8) scale(5.72)">
        <rect x="0" y="0" width="15" height="15" rx="0.7" fill={hi} />

        {LUDO_YARD.map(([x, y], s) => (
          <g key={`yard-${s}`}>
            <rect x={x} y={y} width="6" height="6" rx="0.6" fill={LUDO_C[s]} />
            <rect x={x + 0.9} y={y + 0.9} width="4.2" height="4.2" rx="0.45" fill={hi} />
            {[[2, 2], [4, 2], [2, 4], [4, 4]].map(([dx, dy]) => (
              <circle
                key={`${dx}-${dy}`}
                cx={x + dx}
                cy={y + dy}
                r="0.62"
                fill={LUDO_C[s]}
                stroke="rgba(255,255,255,.72)"
                strokeWidth="0.12"
              />
            ))}
          </g>
        ))}

        {LUDO_LANE.map(([x, y, w, h], s) => (
          <rect key={`lane-${s}`} x={x} y={y} width={w} height={h} fill={LUDO_C[s]} opacity="0.85" />
        ))}
        {LUDO_GOAL.map((d, s) => (
          <path key={`goal-${s}`} d={d} fill={LUDO_C[s]} />
        ))}

        <path className="ga-rule" d={LUDO_RULES} strokeWidth="0.07" />
        <rect className="ga-edge" x="0" y="0" width="15" height="15" rx="0.7" strokeWidth="0.1" />
      </g>

    </g>
  )
}

// Chess piece silhouettes, matching the set Chess.jsx renders on the real board
// so the shelf promises the pieces the guest actually gets. 45 x 45 local box.
const KNIGHT_D =
  'M22 10.2c2.4-2 4.9-2.6 6.4-.6l1.1-3.4 1.6 3.5c3 2.5 4.6 7.5 4.1 13.4-.4 5-1.2 10.4-1.5 15H14'
  + 'c0-5.2 1.6-9.2 5.1-12.2 2.5-2.1 3.5-4 3.5-6.1l-4.6 3.7c-2 1.6-4.1 1-4.6-1.1-.5-2.6 1-5.7 3.6-8.3'
  + '1.5-1.5 3.5-3.2 5-4z'
const KING_BODY_D =
  'M22.5 14.4c-5.5 1-10.5 4-11.5 9-.8 4.1 1 7.1 3 8.8h17c2-1.7 3.8-4.7 3-8.8-1-5-6-8-11.5-9z'
const KING_CROSS_D = 'M21 4.6h3v3.2h3.2v3H24v3.4h-3v-3.4h-3.2v-3H21z'

function SceneChess({ c }) {
  const [deep, mid, hi] = c
  return (
    <g>
      {/* a fragment of the board, tilted just enough to read as an object on a
          table rather than a flat grid pattern */}
      <g className="ga-lift" transform="rotate(-7 80 55)">
        {/* 4 x 4 of 19 = 76, centred on (80, 55). The size is set by the tilt:
            a square of side S rotated 7 degrees reaches (S/2)(cos7 + sin7)
            from its centre, and the safe half-width is 44, so S must stay
            under 79. Measured, not guessed — see the safe-area note above. */}
        {[0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((f) => (
          <rect
            key={`${r}-${f}`}
            className="ga-crisp"
            x={42 + f * 19}
            y={17 + r * 19}
            width="19"
            height="19"
            fill={(r + f) % 2 ? mid : hi}
          />
        )))}
        <rect className="ga-edge" x="42" y="17" width="76" height="76" strokeWidth="1.1" />
      </g>

      {/* the black king behind, the white knight in front — the two silhouettes
          that say "chess" fastest at this size */}
      <g className="ga-lift-sm" transform="translate(84 42) scale(0.78)">
        <path d={KING_BODY_D} fill={deep} stroke={hi} strokeWidth="1.5" strokeLinejoin="round" />
        <path d={KING_CROSS_D} fill={deep} stroke={hi} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M13 32.2h19v3.5H13z" fill={deep} stroke={hi} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M10 35.7h25v4H10z" fill={deep} stroke={hi} strokeWidth="1.5" strokeLinejoin="round" />
      </g>
      <g className="ga-lift-sm" transform="translate(42 31) scale(1.1)">
        <path d={KNIGHT_D} fill={hi} stroke={deep} strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M12.6 38h20.2v4H12.6z" fill={hi} stroke={deep} strokeWidth="1.3" strokeLinejoin="round" />
        <circle cx="26.6" cy="15.6" r="1.7" fill={deep} />
      </g>
    </g>
  )
}

// Pip positions inside one half of a domino face, as fractions of that half.
const DOM_PIPS = {
  0: [],
  1: [[0.5, 0.5]],
  2: [[0.28, 0.26], [0.72, 0.74]],
  3: [[0.26, 0.24], [0.5, 0.5], [0.74, 0.76]],
  4: [[0.28, 0.26], [0.72, 0.26], [0.28, 0.74], [0.72, 0.74]],
  5: [[0.28, 0.26], [0.72, 0.26], [0.5, 0.5], [0.28, 0.74], [0.72, 0.74]],
  6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]],
}

// One tile: ivory body, a divider across the waist, and REAL pip layouts —
// the whole point is that a guest can read the tile, not just see a rectangle.
function DominoTile({ x, y, w, h, a, b, face, ink, rotate }) {
  const half = h / 2
  const pip = w * 0.1
  const spot = (n, oy) => (DOM_PIPS[n] || []).map(([fx, fy], i) => (
    <circle key={`${n}-${i}`} cx={x + fx * w} cy={oy + fy * half} r={pip} fill={ink} />
  ))
  return (
    <g className="ga-lift" transform={rotate ? `rotate(${rotate} ${x + w / 2} ${y + h / 2})` : undefined}>
      <rect x={x} y={y} width={w} height={h} rx={w * 0.14} fill={face} />
      <rect className="ga-edge" x={x} y={y} width={w} height={h} rx={w * 0.14} strokeWidth="0.9" />
      <path className="ga-rule" d={`M${x + w * 0.12} ${y + half} h${w * 0.76}`} strokeWidth="1.1" />
      {spot(a, y)}
      {spot(b, y + half)}
    </g>
  )
}

function SceneDominoes({ c }) {
  const [, , hi, ink] = c
  const face = hi
  const dark = ink || '#16202a'
  return (
    <g>
      {/* the two angled tiles are placed from their rotated extent, not their
          upright one: a 30 x 58 tile turned 16 degrees reaches 22.4 from its
          own centre, so its centre cannot sit closer than that to x 36 / 124 */}
      <DominoTile x={44} y={29} w={30} h={58} a={3} b={5} face={face} ink={dark} rotate={-16} />
      <DominoTile x={86} y={33} w={30} h={58} a={2} b={4} face={face} ink={dark} rotate={14} />
      {/* the double six sits upright and in front: in Gulf dominoes the highest
          double is what opens the round */}
      <DominoTile x={66} y={21} w={30} h={58} a={6} b={6} face={face} ink={dark} />
    </g>
  )
}

// Card suits, each authored inside a 24 x 24 local box.
const SUIT_D = {
  spade: 'M12 3s-8 6.5-8 11.2c0 2.8 2 4.4 4.2 4.4 1.4 0 2.6-.6 3.2-1.6L10.2 21.5h3.6L12.6 17c.6 1 1.8 1.6 3.2 1.6 2.2 0 4.2-1.6 4.2-4.4C20 9.5 12 3 12 3z',
  heart: 'M12 20.5S3.5 14.6 3.5 9.4C3.5 6.7 5.6 4.8 8 4.8c1.8 0 3.2 1 4 2.3.8-1.3 2.2-2.3 4-2.3 2.4 0 4.5 1.9 4.5 4.6 0 5.2-8.5 11.1-8.5 11.1z',
  diamond: 'M12 3l7.5 9-7.5 9-7.5-9z',
  // arc flags are spelled out ("0 0 1", never packed as "001") — packed flags
  // are legal SVG but a common source of mis-parses in tooling
  club: 'M12 3.2 a4.1 4.1 0 0 1 3.4 6.4 a4.1 4.1 0 1 1 -1.9 6.2 l.4 5.6 h-3.8 l.4-5.6 a4.1 4.1 0 1 1 -1.9-6.2 a4.1 4.1 0 0 1 3.4-6.4 z',
}

// One fanned card. The suit is drawn large and centred because at 84px a rank
// glyph is unreadable, while a suit silhouette still is.
function FanCard({ angle, suit, ink, face }) {
  return (
    <g className="ga-lift" transform={`rotate(${angle} 80 104)`}>
      <rect x="63" y="20" width="34" height="48" rx="4.4" fill={face} />
      <rect className="ga-edge" x="63" y="20" width="34" height="48" rx="4.4" strokeWidth="0.9" />
      <g transform="translate(66 23) scale(0.32)">
        <path d={SUIT_D[suit]} fill={ink} />
      </g>
      <g transform="translate(69 34) scale(0.78)">
        <path d={SUIT_D[suit]} fill={ink} />
      </g>
    </g>
  )
}

function SceneWist({ c }) {
  const [, , hi, red] = c
  const black = '#1b2530'
  const warm = red || '#d9455f'
  // Drawn left to right so the rightmost card lands on top of the fan.
  // The spread stops at 18 degrees: the cards pivot from (80, 104), well below
  // the frame, so every extra degree throws the outer cards sideways much
  // faster than it opens the fan. At 24 they measured past the safe edge.
  const fan = [
    { angle: -18, suit: 'club', ink: black },
    { angle: -6, suit: 'diamond', ink: warm },
    { angle: 6, suit: 'heart', ink: warm },
    { angle: 18, suit: 'spade', ink: black },
  ]
  // a fan pivoting from below the frame arcs upward, so the whole group is
  // nudged down to sit on the tile's optical centre rather than above it
  return (
    <g transform="translate(0 8)">
      {fan.map((f) => (
        <FanCard key={f.angle} angle={f.angle} suit={f.suit} ink={f.ink} face={hi} />
      ))}
    </g>
  )
}

// The four partnership colours, same values as --cg-s0..--cg-s3 in cardgames.css.
const JAK_C = ['#38bdf8', '#fbbf24', '#818cf8', '#fb7185']

function SceneJackaroo({ c }) {
  const [deep, mid, hi, cream] = c
  const holes = Array.from({ length: 20 })
  return (
    <g>
      {/* The track: a ring of pegged holes, which is what a Jackaroo board is
          before anything is on it. The band is deliberately heavy — at 84px a
          thin ring dissolved into the plate and the tile read as a target. */}
      <circle cx="80" cy="44" r="30" fill="none" stroke={mid} strokeWidth="12" opacity="0.72" />
      <circle cx="80" cy="44" r="30" fill="none" stroke={hi} strokeWidth="1.1" opacity="0.42" />
      {holes.map((_, i) => {
        const a = (i / holes.length) * Math.PI * 2 - Math.PI / 2
        return (
          <circle
            key={i}
            cx={80 + Math.cos(a) * 30}
            cy={44 + Math.sin(a) * 30}
            r="2.9"
            fill={deep}
            opacity="0.62"
          />
        )
      })}

      {/* one marble per partnership seat, parked on its own quarter of the ring */}
      {JAK_C.map((col, i) => {
        const a = (i / 4) * Math.PI * 2 - Math.PI / 2
        const mx = 80 + Math.cos(a) * 30
        const my = 44 + Math.sin(a) * 30
        return (
          <g key={col} className="ga-lift-sm">
            <circle cx={mx} cy={my} r="6.6" fill={col} stroke={deep} strokeWidth="1.1" />
            <circle cx={mx - 2.1} cy={my - 2.2} r="2" fill="#ffffff" opacity="0.72" />
          </g>
        )
      })}

      <circle cx="80" cy="44" r="9.5" fill={deep} opacity="0.45" />
      <circle cx="80" cy="44" r="9.5" fill="none" stroke={hi} strokeWidth="1.1" opacity="0.5" />

      {/* the card half of the game, tucked in front of the track */}
      <g className="ga-lift" transform="rotate(15 102.5 78)">
        <rect x="88" y="58" width="29" height="40" rx="3.9" fill={cream || '#f2e6cf'} />
        <rect className="ga-edge" x="88" y="58" width="29" height="40" rx="3.9" strokeWidth="0.9" />
        <g transform="translate(93.5 66) scale(0.75)">
          <path d={SUIT_D.spade} fill="#1b2530" />
        </g>
      </g>
    </g>
  )
}

// ---------------------------------------------------------------------------
// The art scenes. Each draws inside a 160 x 104 box on top of the tile's own
// gradient, using only the game's three colours. Deliberately geometric —
// abstract shapes read as "designed" at thumbnail size where illustration
// attempts read as noise.
// ---------------------------------------------------------------------------
function Scene({ art, c }) {
  const [, mid, hi] = c
  const common = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (art) {
    case 'waves':
      return (
        <g>
          <path d="M-6 66 q26 -14 52 0 t52 0 t52 0 v52 H-6 Z" fill={mid} opacity="0.55" />
          <path d="M-6 80 q26 -14 52 0 t52 0 t52 0 v40 H-6 Z" fill={hi} opacity="0.4" />
          <path d="M112 8 v30" stroke={hi} strokeWidth="2.5" {...common} opacity="0.8" />
          <path d="M112 38 q-9 7 -3 13 t3 9" stroke={hi} strokeWidth="2.5" {...common} />
          <circle cx="46" cy="52" r="9" fill={hi} opacity="0.9" />
          <circle cx="43" cy="49" r="2.4" fill={c[0]} />
        </g>
      )
    case 'dash':
      return (
        <g>
          <path d="M16 74 h128" stroke={hi} strokeWidth="3" opacity="0.28" {...common} />
          <path d="M8 30 h44 M16 46 h34 M4 62 h26" stroke={hi} strokeWidth="4" opacity="0.35" {...common} />
          <rect x="86" y="40" width="52" height="9" rx="4.5" fill={hi} />
          <circle cx="100" cy="32" r="6" fill={hi} opacity="0.85" />
          <circle cx="118" cy="30" r="8" fill={mid} stroke={hi} strokeWidth="2.5" />
          <path d="M96 74 q16 -10 32 0" stroke={hi} strokeWidth="3" opacity="0.5" {...common} />
        </g>
      )
    case 'burst':
      return (
        <g>
          {Array.from({ length: 10 }).map((_, i) => (
            <path
              key={i}
              d="M80 62 L80 10 A52 52 0 0 1 110 20 Z"
              fill={i % 2 ? hi : mid}
              opacity={i % 2 ? 0.85 : 0.5}
              transform={`rotate(${i * 36} 80 62)`}
            />
          ))}
          <circle cx="80" cy="62" r="11" fill={c[0]} />
          <circle cx="80" cy="62" r="4" fill={hi} />
        </g>
      )
    case 'cards':
      return (
        <g>
          <rect x="22" y="30" width="40" height="54" rx="9" fill={mid} opacity="0.55" transform="rotate(-11 42 57)" />
          <rect x="60" y="24" width="40" height="54" rx="9" fill={hi} opacity="0.9" />
          <rect x="100" y="30" width="40" height="54" rx="9" fill={mid} opacity="0.55" transform="rotate(11 120 57)" />
          <path d="M70 42 h20 M70 52 h14 M70 62 h18" stroke={c[0]} strokeWidth="3.4" opacity="0.75" {...common} />
        </g>
      )
    case 'fall':
      return (
        <g>
          <circle cx="42" cy="22" r="7" fill={hi} opacity="0.9" />
          <circle cx="86" cy="14" r="5" fill={mid} />
          <circle cx="112" cy="34" r="6.5" fill={hi} opacity="0.7" />
          <circle cx="62" cy="44" r="5" fill={hi} opacity="0.5" />
          <path d="M34 66 h92 l-13 30 a6 6 0 0 1 -5 3 H52 a6 6 0 0 1 -5 -3 Z" fill={hi} />
          <path d="M34 66 h92" stroke={c[0]} strokeWidth="5" opacity="0.35" {...common} />
        </g>
      )
    case 'quiz':
      return (
        <g>
          <rect x="24" y="26" width="94" height="50" rx="14" fill={mid} opacity="0.6" />
          <path d="M42 86 l10 -14 h18 Z" fill={mid} opacity="0.6" />
          <path d="M60 44 a10 10 0 1 1 12 15 v5" stroke={hi} strokeWidth="5" {...common} />
          <circle cx="72" cy="70" r="3.6" fill={hi} />
          <circle cx="128" cy="24" r="5" fill={hi} opacity="0.55" />
        </g>
      )
    case 'stack':
      return (
        <g>
          <rect x="38" y="72" width="84" height="18" rx="7" fill={mid} />
          <rect x="46" y="52" width="68" height="18" rx="7" fill={hi} opacity="0.9" />
          <rect x="56" y="32" width="50" height="18" rx="7" fill={mid} />
          <rect x="72" y="14" width="30" height="16" rx="7" fill={hi} />
          <circle cx="87" cy="8" r="4" fill={hi} />
        </g>
      )
    case 'swirl':
      return (
        <g>
          <circle cx="80" cy="54" r="40" fill={mid} opacity="0.45" />
          <path d="M80 20 a34 34 0 1 1 -24 58 a24 24 0 1 1 34 -34 a14 14 0 1 1 -14 20" stroke={hi} strokeWidth="5" {...common} />
          <circle cx="80" cy="54" r="40" fill="none" stroke={hi} strokeWidth="2" opacity="0.4" />
        </g>
      )
    case 'grid':
      return (
        <g>
          {[[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]].map(([col, row]) => {
            const on = (col + row) % 3 === 0
            return (
              <rect
                key={`${col}-${row}`}
                x={26 + col * 38}
                y={20 + row * 38}
                width="30"
                height="30"
                rx="9"
                fill={on ? hi : mid}
                opacity={on ? 0.95 : 0.5}
              />
            )
          })}
          <path d="M33 27 l16 16 M49 27 l-16 16" stroke={c[0]} strokeWidth="3" opacity="0.55" {...common} />
        </g>
      )
    case 'heat':
      return (
        <g>
          <path d="M80 16 q18 20 8 34 q-4 6 -8 8 q-4 -2 -8 -8 q-10 -14 8 -34 Z" fill={hi} />
          <path d="M80 34 q10 12 4 22 q-2 4 -4 5 q-2 -1 -4 -5 q-6 -10 4 -22 Z" fill={c[0]} opacity="0.55" />
          <path d="M28 74 h104 M34 86 h92" stroke={mid} strokeWidth="7" {...common} />
          <path d="M28 74 h104" stroke={hi} strokeWidth="2" opacity="0.6" {...common} />
        </g>
      )
    case 'bubbles':
      return (
        <g>
          <circle cx="46" cy="60" r="20" fill={mid} opacity="0.75" />
          <circle cx="86" cy="38" r="14" fill={hi} opacity="0.85" />
          <circle cx="112" cy="68" r="17" fill={mid} opacity="0.6" />
          <circle cx="74" cy="78" r="9" fill={hi} opacity="0.55" />
          <circle cx="126" cy="30" r="7" fill={hi} opacity="0.4" />
          <circle cx="40" cy="53" r="5" fill={hi} opacity="0.45" />
          <circle cx="81" cy="33" r="4" fill="#fff" opacity="0.6" />
        </g>
      )
    // the five bespoke table-game scenes (see the long note above)
    case 'ludoBoard':
      return <SceneLudo c={c} />
    case 'chessBoard':
      return <SceneChess c={c} />
    case 'dominoTiles':
      return <SceneDominoes c={c} />
    case 'suitFan':
      return <SceneWist c={c} />
    case 'marbleTrack':
      return <SceneJackaroo c={c} />
    case 'mind':
    default:
      return (
        <g>
          <circle cx="80" cy="54" r="36" fill={mid} opacity="0.45" />
          <circle cx="80" cy="54" r="36" fill="none" stroke={hi} strokeWidth="2" opacity="0.5" />
          <circle cx="80" cy="54" r="23" fill="none" stroke={hi} strokeWidth="3" opacity="0.75" />
          <circle cx="80" cy="54" r="9" fill={hi} />
          <path d="M80 18 v-10 M80 100 v10 M44 54 h-12 M116 54 h12" stroke={hi} strokeWidth="3" opacity="0.5" {...common} />
        </g>
      )
  }
}

// A game tile visual: gradient plate + scene + the game's own icon badge.
// `size` is only a class hint — the tile always fills its container.
export function GameThumb({ game, brand = '#0e7490', showIcon = true, className = '' }) {
  const a = gameArt(game, brand)
  const [deep, mid, hi] = a.c
  const gid = `ghg-${String(game?.id || 'x').replace(/[^A-Za-z0-9_-]/g, '')}`
  return (
    <span className={`gh-thumb ${className}`} aria-hidden="true">
      <svg viewBox="0 0 160 104" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={mid} stopOpacity="0.9" />
            <stop offset="100%" stopColor={deep} />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="160" height="104" fill={`url(#${gid})`} />
        <Scene art={a.art} c={a.c} />
      </svg>
      {showIcon && game?.icon ? (
        <span className="gh-thumb-badge" style={{ color: hi }}>
          <Icon name={game.icon} size={15} />
        </span>
      ) : null}
    </span>
  )
}

// ---------------------------------------------------------------------------
// the splash
// ---------------------------------------------------------------------------
const TXT = {
  ar: {
    kicker: 'ركن الألعاب',
    title: 'العب وأنت تنتظر',
    sub: 'ألعاب قصيرة صُنعت لهذا المكان — دقيقة واحدة تكفي لجولة كاملة.',
    f1: 'أربع مجموعات',
    f1d: 'تسلية وسرعة، ذكاء وألغاز، معرفة وثقافة، واكتشف شخصيتك.',
    f2: 'نتائجك محفوظة',
    f2d: 'أفضل نتيجة لكل لعبة، ومراحلك تُستأنف من حيث توقفت.',
    f3: 'لوحة صدارة شهرية',
    f3d: 'نافس بقية ضيوف المكان على المركز الأول كل شهر.',
    rewards: 'جوائز حقيقية من المكان',
    rewardsHow: 'عند تحقيق الشرط يظهر لك رمز — أظهره للكاشير قبل الدفع.',
    cta: 'تصفّح الألعاب',
    count: (c) => `${n(c)} ألعاب متاحة الآن`,
    countOne: 'لعبة واحدة متاحة الآن',
    countTwo: 'لعبتان متاحتان الآن',
  },
  en: {
    kicker: 'Games Corner',
    title: 'Play while you wait',
    sub: 'Short games made for this venue — one minute is a full round.',
    f1: 'Four collections',
    f1d: 'Arcade, puzzles, knowledge, and personality.',
    f2: 'Your progress is kept',
    f2d: 'A best score per game, and saved stages you can resume.',
    f3: 'Monthly leaderboard',
    f3d: 'Compete with the venue’s other guests every month.',
    rewards: 'Real rewards from this venue',
    rewardsHow: 'Meet the condition and a code appears — show it to the cashier.',
    cta: 'Browse the games',
    count: (c) => `${c} games available`,
    countOne: '1 game available',
    countTwo: '2 games available',
  },
}

function countLine(t, c) {
  if (c === 1) return t.countOne
  if (c === 2) return t.countTwo
  return t.count(c)
}

export default function GamePromo({
  brand = '#0e7490',
  lang = 'ar',
  games = [],
  rewards = [],
  rewardsNote = '',
  onStart,
  rewardLine,
}) {
  const t = TXT[lang] || TXT.ar
  const tiles = games.slice(0, 4)
  const feats = [
    { icon: 'shapes', h: t.f1, d: t.f1d },
    { icon: 'user', h: t.f2, d: t.f2d },
    { icon: 'award', h: t.f3, d: t.f3d },
  ]

  return (
    <div className="gh-promo gh-fade">
      <div className="gh-promo-scroll">
        <div className="gh-promo-hero">
          <span className="gh-promo-glow" style={{ background: brand }} />
          <div className="gh-promo-tiles">
            {tiles.map((g, i) => (
              <span key={g.id} className="gh-promo-tile" style={{ '--i': i }}>
                <GameThumb game={g} brand={brand} />
              </span>
            ))}
          </div>
        </div>

        <p className="gh-promo-kicker" style={{ color: brand }}>{t.kicker}</p>
        <h2 className="gh-promo-title">{t.title}</h2>
        <p className="gh-promo-sub">{t.sub}</p>
        {games.length ? <p className="gh-promo-count">{countLine(t, games.length)}</p> : null}

        <ul className="gh-feats">
          {feats.map((f) => (
            <li key={f.h} className="gh-feat">
              <span className="gh-feat-ico" style={{ color: brand }}><Icon name={f.icon} size={17} /></span>
              <span className="gh-feat-txt">
                <strong>{f.h}</strong>
                <em>{f.d}</em>
              </span>
            </li>
          ))}
        </ul>

        {rewards.length ? (
          <section className="gh-promo-rewards">
            <h3 className="gh-promo-rw-h">
              <Icon name="offers" size={15} />
              {t.rewards}
            </h3>
            <ul className="gh-promo-rw-list">
              {rewards.slice(0, 4).map((r) => (
                <li key={r.id}>{rewardLine ? rewardLine(r) : null}</li>
              ))}
            </ul>
            {rewardsNote ? <p className="gh-promo-rw-note">{rewardsNote}</p> : null}
            <p className="gh-promo-rw-how">{t.rewardsHow}</p>
          </section>
        ) : null}
      </div>

      <div className="gh-promo-foot">
        <button type="button" className="gh-cta gh-press" style={{ background: brand }} onClick={onStart}>
          <Icon name="play" size={16} />
          {t.cta}
        </button>
      </div>
    </div>
  )
}
