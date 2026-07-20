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
