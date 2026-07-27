// ===========================================================================
// CoverPlate — the join-flow hero art.
//
// A wide gradient plate painted from the SAME cover spec the shelf cards use
// (games.js → game.cover.palette / game.cover.motif), so the lobby, the /join
// page and the shelf all read as one product. This is NOT a copy of the hub's
// full CoverArt scenes: the join surfaces only ever host the six multiplayer
// board games, so it carries compact glyphs for exactly those motifs plus one
// tasteful default. Pure presentation — SVG only, aria-hidden, no text.
// ===========================================================================

const FALLBACK = ['#123448', '#2a5a72', '#7fd3e6']

// The four Ludo seat colours are domain facts (see GamesCenter), not artwork.
const LUDO4 = ['#e05a4e', '#3f9d58', '#f0c04a', '#4a7fd6']

function pal(game) {
  const p = Array.isArray(game?.cover?.palette)
    ? game.cover.palette.filter((x) => /^#[0-9a-f]{3,8}$/i.test(x))
    : []
  return p.length >= 3 ? p : FALLBACK
}

// Local motif glyphs in a 200x120 box. [deep, mid, hi, extra?] from the spec.
function glyph(motif, C) {
  const [deep, mid, hi, extra] = C
  const card = hi
  const pip = extra || mid
  switch (motif) {
    case 'fan': // الوست — a fanned trick of cards
      return (
        <g>
          <g transform="rotate(-20 100 128)">
            <rect x="78" y="24" width="44" height="64" rx="7" fill={card} opacity="0.55" />
          </g>
          <g transform="rotate(20 100 128)">
            <rect x="78" y="24" width="44" height="64" rx="7" fill={card} opacity="0.55" />
          </g>
          <rect x="78" y="18" width="44" height="66" rx="7" fill={card} />
          <path d="M100 36 l9 12 -9 12 -9 -12 z" fill={pip} />
          <circle cx="86" cy="27" r="2.6" fill={deep} opacity="0.55" />
          <circle cx="114" cy="75" r="2.6" fill={deep} opacity="0.55" />
        </g>
      )
    case 'fireFan': // الحريق — the fan, alight
      return (
        <g>
          <g transform="rotate(-18 100 130)">
            <rect x="80" y="34" width="40" height="58" rx="6" fill={card} opacity="0.5" />
          </g>
          <g transform="rotate(18 100 130)">
            <rect x="80" y="34" width="40" height="58" rx="6" fill={card} opacity="0.5" />
          </g>
          <rect x="80" y="30" width="40" height="60" rx="6" fill={card} />
          <path d="M100 4 c7 8 12 13 12 21 a12 12 0 0 1 -24 0 c0 -8 5 -13 12 -21 z" fill={extra || mid} />
          <path d="M100 14 c3.6 4.2 6 7 6 11 a6 6 0 0 1 -12 0 c0 -4 2.4 -6.8 6 -11 z" fill="#fff" opacity="0.85" />
          <path d="M100 48 l8 11 -8 11 -8 -11 z" fill={mid} />
        </g>
      )
    case 'marbles': // الجكارو — track and marbles
      return (
        <g>
          <circle cx="100" cy="62" r="40" fill="none" stroke={hi} strokeWidth="2" opacity="0.3" />
          <circle cx="100" cy="62" r="27" fill="none" stroke={hi} strokeWidth="1.4" opacity="0.2" />
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <circle
              key={a}
              cx={100 + 40 * Math.cos((a * Math.PI) / 180)}
              cy={62 + 40 * Math.sin((a * Math.PI) / 180)}
              r="3"
              fill={hi}
              opacity="0.35"
            />
          ))}
          <circle cx="100" cy="22" r="9" fill={extra || hi} />
          <circle cx="140" cy="62" r="9" fill={hi} />
          <circle cx="100" cy="102" r="9" fill={mid} />
          <circle cx="60" cy="62" r="9" fill="#fff" opacity="0.92" />
          <circle cx="97" cy="19" r="3" fill="#fff" opacity="0.55" />
          <circle cx="137" cy="59" r="3" fill="#fff" opacity="0.55" />
        </g>
      )
    case 'ludo': // اللودو — the four homes and a die
      return (
        <g>
          {LUDO4.map((c, i) => (
            <rect
              key={c}
              x={i % 2 === 0 ? 62 : 106}
              y={i < 2 ? 22 : 66}
              width="32"
              height="32"
              rx="9"
              fill={c}
              opacity="0.9"
            />
          ))}
          <path d="M100 46 l14 14 -14 14 -14 -14 z" fill="#fff" opacity="0.94" />
          <rect x="146" y="44" width="26" height="26" rx="7" fill="#fff" opacity="0.94" />
          <circle cx="153" cy="51" r="2.6" fill={deep} />
          <circle cx="165" cy="63" r="2.6" fill={deep} />
          <circle cx="159" cy="57" r="2.6" fill={deep} />
        </g>
      )
    case 'chess': // الشطرنج — a rook over its squares
      return (
        <g>
          <rect x="120" y="70" width="22" height="22" fill={hi} opacity="0.28" />
          <rect x="142" y="48" width="22" height="22" fill={hi} opacity="0.16" />
          <g transform="translate(70 16)" fill={hi}>
            <path d="M4 0 h6 v8 h6 v-8 h8 v8 h6 v-8 h6 v18 h-32 z" />
            <path d="M8 22 h20 l-3 40 h-14 z" opacity="0.92" />
            <path d="M2 66 h32 v8 h-32 z" />
          </g>
        </g>
      )
    case 'domino': // الدومينو — two tiles mid-fall
      return (
        <g>
          <g transform="rotate(-14 86 60)">
            <rect x="70" y="26" width="32" height="64" rx="6" fill={hi} />
            <path d="M72 58 h28" stroke={deep} strokeWidth="2" opacity="0.5" />
            <circle cx="86" cy="42" r="3.4" fill={deep} />
            <circle cx="79" cy="72" r="3.4" fill={deep} />
            <circle cx="93" cy="72" r="3.4" fill={deep} />
            <circle cx="86" cy="79" r="3.4" fill={deep} opacity="0" />
          </g>
          <g transform="rotate(12 128 66)">
            <rect x="112" y="32" width="32" height="64" rx="6" fill={extra || mid} />
            <path d="M114 64 h28" stroke="#fff" strokeWidth="2" opacity="0.35" />
            <circle cx="121" cy="46" r="3.4" fill="#fff" opacity="0.85" />
            <circle cx="135" cy="54" r="3.4" fill="#fff" opacity="0.85" />
            <circle cx="128" cy="80" r="3.4" fill="#fff" opacity="0.85" />
          </g>
        </g>
      )
    default:
      return (
        <g>
          <circle cx="100" cy="60" r="34" fill={mid} opacity="0.4" />
          <circle cx="100" cy="60" r="34" fill="none" stroke={hi} strokeWidth="2" opacity="0.5" />
          <circle cx="100" cy="60" r="19" fill="none" stroke={hi} strokeWidth="3" opacity="0.75" />
          <circle cx="100" cy="60" r="8" fill={hi} />
        </g>
      )
  }
}

export default function CoverPlate({ game, className = '' }) {
  const C = pal(game)
  const [deep, mid] = C
  const motif = game?.cover?.motif || 'default'
  const gid = `rmcv-${String(game?.id || 'x').replace(/[^A-Za-z0-9_-]/g, '')}`
  return (
    <span className={className} aria-hidden="true">
      <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id={`${gid}-p`} x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor={mid} />
            <stop offset="1" stopColor={deep} />
          </linearGradient>
          <radialGradient id={`${gid}-h`} cx="0.72" cy="0.1" r="0.9">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.26" />
            <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="200" height="120" fill={`url(#${gid}-p)`} />
        <rect width="200" height="120" fill={`url(#${gid}-h)`} />
        {/* the motif sits off-centre so RTL hero copy owns the start side */}
        <g transform="translate(34 0)" opacity="0.96">{glyph(motif, C)}</g>
      </svg>
    </span>
  )
}
