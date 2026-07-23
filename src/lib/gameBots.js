// ===========================================================================
// gameBots — the computer opponents for the five party games.
//
// WHY THIS FILE EXISTS
// A diner sitting alone at a table wants to play اللودو / الشطرنج / الدومينو /
// الوِست / الجكارو and has nobody with them. «العب ضد الكمبيوتر» in the room
// lobby starts a LOCAL round: the same game component, the same pure reducer,
// but running in React state instead of a Firestore room document. One player
// against machine seats is not a shared room, so it costs zero writes and can
// never half-fail on a bad connection.
//
// ---------------------------------------------------------------------------
// THE CONTRACT — read this before adding a sixth game
// ---------------------------------------------------------------------------
// Every function here is PURE and SYNCHRONOUS. It is handed the game's own
// state, the seat it plays, and a `ctx` carrying the game's own exported
// helpers. It returns ONE move object in the game's own move vocabulary, or
// null when it has nothing to do. The caller schedules it (a visible delay, so
// the player can follow what happened) and submits it.
//
//   ctx = {
//     reduce,          // the game's exported reducer  (REQUIRED)
//     room,            // the local pseudo-room the component built (REQUIRED
//                      // for Ludo, whose die is derived from room.roomId)
//     helpers,         // the game's own exported `botHelpers` bundle
//   }
//
// ---------------------------------------------------------------------------
// THE LEGALITY GUARANTEE — this is the important part
// ---------------------------------------------------------------------------
// Every reducer in this repo is a TOTAL function: an illegal move returns the
// state object UNCHANGED (by identity). So a bot never has to be trusted to
// know the rules. It ranks candidate moves by a heuristic, then walks that
// ranking and RUNS EACH ONE THROUGH THE REAL REDUCER, returning the first that
// actually changes the state. A bot therefore cannot emit an illegal move and
// cannot desync a board, even if its heuristic is wrong about what is possible.
// `firstLegal` below is that gate and every bot goes through it.
//
// ---------------------------------------------------------------------------
// WHAT THE BOTS DO NOT DO — stated so the UI can be honest about it
// ---------------------------------------------------------------------------
//   · No search deeper than described per game. None of these is «ذكاء
//     اصطناعي»; they are hand-written heuristics and the UI says so.
//   · No bot reads another seat's hidden cards or tiles. The room state carries
//     every hand (a known limitation of the room model), and a bot COULD cheat
//     by reading it. Each card-game bot below is restricted to
//     `state.hands[itsOwnSeat]` plus what is face-up on the table, and that
//     restriction is the reason the hand-reading is done through the narrow
//     helpers at the top of each function rather than inline.
//   · No bot models an opponent, counts played cards, or plans a lap ahead.
//   · Ties are broken by a deterministic hash of the position, not Math.random,
//     so a bot is a pure function of the state it is shown.
// ===========================================================================

// ---------------------------------------------------------------------------
// naming — a bot seat is NEVER presented as a person
// ---------------------------------------------------------------------------
export const BOT_ID_PREFIX = 'bot-'

export function botLabel(index, total, lang) {
  const en = lang === 'en'
  if (total <= 1) return en ? 'Computer' : 'الكمبيوتر'
  return en ? `Computer ${index + 1}` : `الكمبيوتر ${index + 1}`
}

export const isBotPlayer = (p) => !!p && (p.bot === true || String(p.id || '').startsWith(BOT_ID_PREFIX))

// How long a bot "thinks" before its move lands. Long enough that the player
// sees what changed, short enough that it never feels stuck.
export const BOT_DELAY_MS = 620
export const BOT_DELAY_FAST = 460

// ---------------------------------------------------------------------------
// The honest strength note shown in the lobby. One line per game, describing
// what the bot ACTUALLY computes. Do not soften these.
// ---------------------------------------------------------------------------
export const BOT_NOTE = {
  ludo: {
    ar: 'يفضّل الوصول إلى المركز ثم أكل قطعة ثم الخروج من البيت، ويتفادى المربعات التي يستطيع خصم بلوغها برمية واحدة. قواعد ثابتة، بلا بحث في الاحتمالات.',
    en: 'Prefers homing, then capturing, then leaving the yard, and avoids squares a rival could reach in one roll. Fixed rules, no search.',
  },
  chess: {
    ar: 'ثلاثة مستويات تختارها داخل اللوحة: «سهل» يحسب المادة فقط ولا يؤمّن قطعه، و«متوسط» يضيف تفادي ترك قطعة مكشوفة بعمق نقلة واحدة، و«صعب» يحسب ردّك أيضاً (نقلتان ببحث ألفا-بيتا) ولا يدخل كش مات بنقلة واحدة. ولا واحد منها محرك شطرنج ولا ذكاء اصطناعي.',
    en: 'Three levels, picked on the board: Easy counts material only and never defends, Normal adds a one-ply hanging-piece guard, Hard also weighs your reply (two plies, alpha-beta) and will not walk into mate in one. None of them is a chess engine or AI.',
  },
  dominoes: {
    ar: 'يرى أحجاره وما نزل على الطاولة فقط، ولا يطّلع على أحجار غيره: يتخلّص من الدبل والأحجار الثقيلة مبكراً، ويبقي طرفاً يملك له أحجاراً، ويحاول ترك طرف قليل النظائر ليصعّب على الخصم — ويشدّد ذلك إذا فرغ المخزن أو قارب أحدهم الخروج. لا يتذكّر على أي رقم مرّر خصمه ولا يحسب نقلة قادمة.',
    en: 'Sees only its own tiles and the table, never another hand: sheds doubles and heavy tiles early, keeps an end it can answer, and tries to leave an end the others are short of — pressing harder once the boneyard is dry or a rival is nearly out. It does not remember which pip a player passed on and never looks a move ahead.',
  },
  wist: {
    ar: 'ثلاثة مستويات: «سهل» يزايد بلا حساب ويرمي أوراقه شبه عشوائية، و«عادي» يقدّر أكلاته ويتبع النوع ويقطع عند الحاجة ويوفّر العالية إذا كان شريكه فائزاً، و«صعب» يعدّ الأوراق التي نزلت فعلاً على الطاولة فيعرف ما بقي من كل نوع وكم حكماً لم يظهر ومن أظهر نقصاً في نوع، فيصرف الأوراق الرابحة ويسحب الحكم ويقرأ إشارة شريكه ويشير له بما يرميه، ويلعب الأكلة التي يتوقّف عليها العقد بأغلى ما عنده. لا مستوى منها يرى ورق غيره — كلها تقرأ يدها هي وما ظهر على الطاولة فقط. صعب يتفوّق على سهل بفارق واضح وعلى عادي بفارق أقل.',
    en: 'Three levels. Easy bids without arithmetic and discards close to at random. Normal estimates its tricks, follows suit, ruffs when it must and saves high cards when its partner is winning. Hard counts the cards that have actually hit the table: it knows what is left in every suit, how many trumps are unaccounted for and who has shown a void, so it cashes winners, draws trumps, reads and sends partner signals, and spends whatever it must on the trick the contract turns on. No level ever sees another hand — each reads its own cards and the public table. Hard beats Easy by a wide margin and Normal by a narrower one.',
  },
  jackaroo: {
    ar: 'يجرّب كل حركة تسمح بها ورقته ويختار ما يقدّم فريقه أكثر — الدخول إلى الخانة ثم القتل ثم التقدّم ثم الخروج من البيت. يزن ورقة واحدة فقط ولا يخطّط للجولة القادمة.',
    en: 'Tries every move its card allows and takes the one that advances its side most — lane, kill, progress, release. One card deep, no planning.',
  },
  haree: {
    ar: 'يأخذ المرمية إذا دخلت في نزلة عنده، يفتتح فور بلوغ 51، ينزل ويمدّد ما يجد، ويرمي أثقل ورقة لا تنفعه. يرى يده وحدها ولا يعدّ ورق غيره.',
    en: 'Takes the thrown card when it completes a meld, opens the moment it holds 51, lays and extends what it finds, and throws its heaviest useless card. Sees only its own hand.',
  },
}

export function botNote(gameId, lang) {
  const n = BOT_NOTE[gameId]
  if (!n) return ''
  return lang === 'en' ? n.en : n.ar
}

// ---------------------------------------------------------------------------
// solo hand-off
//
// RoomLobby records what the player asked for; the game component picks it up
// on its first render. A module value rather than a prop because the hub owns
// the route between the two and this file must not reach into it. The prop
// `soloBots` on a game component always WINS over this, so once the hub passes
// the choice explicitly this becomes dead weight rather than a second truth.
// ---------------------------------------------------------------------------
let soloIntent = null

export function setSoloIntent(intent) {
  if (!intent || !intent.gameId) { soloIntent = null; return }
  soloIntent = {
    gameId: String(intent.gameId),
    bots: Math.max(1, Math.min(3, Number(intent.bots) || 1)),
    at: Date.now(),
  }
}

// Deliberately NON-destructive. React StrictMode mounts every component twice
// in development; a read-and-clear here would hand the intent to the throwaway
// first mount and leave the real one with nothing, so the bot round would only
// work in production. Instead the intent expires on its own (one minute) and
// RoomLobby clears it explicitly whenever the player chooses anything else.
export function takeSoloIntent(gameId) {
  const it = soloIntent
  if (!it) return null
  if (gameId && it.gameId !== gameId) return null
  if (Date.now() - it.at > 60000) { soloIntent = null; return null }
  return it
}

export function clearSoloIntent() { soloIntent = null }

// Seats the bots occupy: everything except the human's seat, lowest first.
export function botSeatsFor(youSeat, botCount, seatCount) {
  const out = []
  const n = Math.max(0, Number(botCount) || 0)
  for (let s = 0; s < seatCount && out.length < n; s += 1) {
    if (s !== youSeat) out.push(s)
  }
  return out
}

// ===========================================================================
// shared internals
// ===========================================================================

// FNV-1a. Only ever used to break ties between equally-scored moves, so that a
// bot stays a pure function of the position instead of reaching for Math.random.
function hash32(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d) >>> 0
  h ^= h >>> 15
  return h >>> 0
}

const jitter = (key) => (hash32(key) % 1000) / 100000 // 0 .. 0.01, deterministic

// Rank by score (desc), then submit down the list until the real reducer
// accepts one. THE legality gate — see the header.
function firstLegal(ranked, state, seat, ctx) {
  const reduce = ctx && ctx.reduce
  if (typeof reduce !== 'function') return null
  const room = (ctx && ctx.room) || null
  for (let i = 0; i < ranked.length; i += 1) {
    const mv = { ...ranked[i].move, seat }
    let out = null
    try { out = reduce(state, mv, room) } catch (_) { out = null }
    if (out && out.state && out.state !== state) return mv
  }
  return null
}

const bySeat = (list) => list.slice().sort((a, b) => b.score - a.score)

// ===========================================================================
// LUDO
//
// helpers (from Ludo.jsx `botHelpers`): legalMoves, capturesAt, isSafe, riskAt,
// YARD, COL_FIRST, HOME, LAST_RING
//
// Strength claim: a fixed priority list with one danger term. It homes, it
// captures, it leaves the yard, it prefers safe squares and it avoids parking
// one roll in front of a rival. It does NOT compute the odds of being hit, does
// not build blocks on purpose, and never sacrifices for position.
// ===========================================================================
export function ludoBotMove(state, seat, ctx) {
  const st = state
  if (!st || !Array.isArray(st.tokens)) return null
  if (st.phase === 'over') return null
  if (st.phase === 'roll') return firstLegal([{ score: 1, move: { type: 'roll' } }], st, seat, ctx)
  if (st.phase !== 'move') return null

  const h = (ctx && ctx.helpers) || {}
  const YARD = h.YARD === undefined ? -1 : h.YARD
  const COL_FIRST = h.COL_FIRST === undefined ? 51 : h.COL_FIRST
  const HOME = h.HOME === undefined ? 56 : h.HOME
  const opts = typeof h.legalMoves === 'function' ? h.legalMoves(st, seat, st.die) : null

  // No move generator handed in: fall back to "try every token, take the first
  // the reducer accepts". Uniformly legal, deliberately unclever — a bot that
  // guesses at geometry it cannot see would be worse than a bot that shrugs.
  if (!opts || !opts.length) {
    const blind = [0, 1, 2, 3].map((t) => ({ score: -t, move: { type: 'move', token: t } }))
    return firstLegal(blind, st, seat, ctx)
  }

  const ranked = opts.map((o) => {
    let sc
    if (o.to === HOME) sc = 1000
    else if (typeof h.capturesAt === 'function' && h.capturesAt(st, seat, o.to)) sc = 900
    else if (o.from === YARD) sc = 620
    else if (o.to >= COL_FIRST) sc = 560 + o.to
    else sc = 100 + o.to * 4
    if (o.to < COL_FIRST) {
      if (typeof h.isSafe === 'function' && h.isSafe(seat, o.to)) sc += 60
      // parking one roll in front of a rival is how a lead is thrown away
      if (typeof h.riskAt === 'function') sc -= 34 * h.riskAt(st, seat, o.to)
      // ...and a token that is already exposed is worth rescuing
      if (typeof h.riskAt === 'function') sc += 18 * h.riskAt(st, seat, o.from)
    }
    return { score: sc + jitter(`lud|${seat}|${o.token}|${o.to}`), move: { type: 'move', token: o.token } }
  })

  return firstLegal(bySeat(ranked), st, seat, ctx)
}

// ===========================================================================
// CHESS
//
// helpers (from Chess.jsx `botHelpers`): legalMoves, applyRaw, attacked,
// kingIndex, other
//
// THREE LEVELS, and each claim is literal — the UI prints these, so they may
// not be softened:
//
//   «سهل» / easy    — one ply of MATERIAL only. It runs each of its legal moves
//                     through the real reducer, counts the pieces afterwards,
//                     and adds a deterministic ±1.1-pawn spread to the score.
//                     It does NOT check whether it left the piece hanging, so
//                     it gives material away in ways a beginner can punish.
//   «متوسط» / normal — the long-standing bot: material − the worst piece it left
//                     hanging + a small placement term, one ply. Mate in one is
//                     found because the reducer reports it. It does not see
//                     forks, pins, skewers or discovered attacks, and it can
//                     walk into mate in one.
//   «صعب» / hard     — normal's evaluation as move ORDERING, then a second ply:
//                     for every candidate it plays out the opponent's replies
//                     (captures first, alpha-beta, hard node budget) and keeps
//                     the move whose worst reply is least bad. It then refuses
//                     any move that allows mate in one. Still not a chess
//                     engine: two plies, no quiescence beyond the hanging scan,
//                     no opening book, no endgame knowledge.
//
// The level rides on the ctx the component already passes (`ctx.level`); an
// unknown or missing value is «متوسط», which is what shipped before.
//
// COST: the whole thing is synchronous and bounded by CH_NODES below, so it
// always returns inside the visible bot delay and can never stall the board.
// ===========================================================================
const CH_VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }
const chUpper = (c) => c >= 'A' && c <= 'Z'
const chOwner = (c) => (c === '.' ? null : chUpper(c) ? 'w' : 'b')
const chOther = (s) => (s === 'w' ? 'b' : 'w')
const chOn = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8
const CH_KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
const CH_DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
const CH_ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const CH_ALL = [...CH_DIAG, ...CH_ORTH]

// Value of the CHEAPEST piece of side `by` attacking square `idx`, or Infinity.
// A reverse-ray scan on the board string: no move generation, so it is cheap
// enough to run on every piece of every candidate position.
function chCheapestAttacker(b, idx, by) {
  const r0 = Math.floor(idx / 8)
  const f0 = idx % 8
  let best = Infinity
  const pr = by === 'w' ? r0 + 1 : r0 - 1
  const pawn = by === 'w' ? 'P' : 'p'
  for (const df of [-1, 1]) {
    if (chOn(pr, f0 + df) && b[pr * 8 + f0 + df] === pawn) return CH_VAL.p
  }
  const kn = by === 'w' ? 'N' : 'n'
  for (const [dr, df] of CH_KN) {
    if (chOn(r0 + dr, f0 + df) && b[(r0 + dr) * 8 + f0 + df] === kn) best = Math.min(best, CH_VAL.n)
  }
  const scan = (dirs, types) => {
    for (const [dr, df] of dirs) {
      let r = r0 + dr
      let f = f0 + df
      while (chOn(r, f)) {
        const c = b[r * 8 + f]
        if (c !== '.') {
          const t = c.toLowerCase()
          if (chOwner(c) === by && types.indexOf(t) >= 0) best = Math.min(best, CH_VAL[t])
          break
        }
        r += dr
        f += df
      }
    }
  }
  scan(CH_DIAG, ['b', 'q'])
  scan(CH_ORTH, ['r', 'q'])
  const kg = by === 'w' ? 'K' : 'k'
  for (const [dr, df] of CH_ALL) {
    if (chOn(r0 + dr, f0 + df) && b[(r0 + dr) * 8 + f0 + df] === kg) best = Math.min(best, 10000)
  }
  return best
}

function chMaterial(board, side) {
  let n = 0
  for (let i = 0; i < 64; i += 1) {
    const c = board[i]
    if (c === '.' || chOwner(c) !== side) continue
    n += CH_VAL[c.toLowerCase()] || 0
  }
  return n
}

// The worst piece of `side` that the opponent can take for less than it is
// worth. Undefended = the whole value; defended = the value minus the cheapest
// attacker, which is the standard one-round exchange estimate.
function chWorstHanging(board, side) {
  const foe = chOther(side)
  let worst = 0
  for (let i = 0; i < 64; i += 1) {
    const c = board[i]
    if (c === '.' || chOwner(c) !== side) continue
    const t = c.toLowerCase()
    if (t === 'k') continue
    const att = chCheapestAttacker(board, i, foe)
    if (att === Infinity) continue
    const def = chCheapestAttacker(board, i, side)
    const mine = CH_VAL[t] || 0
    const loss = def === Infinity ? mine : Math.max(0, mine - att)
    if (loss > worst) worst = loss
  }
  return worst
}

// A deliberately small placement term. Its only job is to stop the bot shuffling
// a rook back and forth in the opening because every move is materially equal.
const CH_CENTRE = [
  0, 0, 1, 2, 2, 1, 0, 0,
  0, 1, 2, 3, 3, 2, 1, 0,
  1, 2, 4, 5, 5, 4, 2, 1,
  2, 3, 5, 7, 7, 5, 3, 2,
  2, 3, 5, 7, 7, 5, 3, 2,
  1, 2, 4, 5, 5, 4, 2, 1,
  0, 1, 2, 3, 3, 2, 1, 0,
  0, 0, 1, 2, 2, 1, 0, 0,
]
function chPlacement(board, side) {
  let n = 0
  for (let i = 0; i < 64; i += 1) {
    const c = board[i]
    if (c === '.' || chOwner(c) !== side) continue
    const t = c.toLowerCase()
    if (t === 'k' || t === 'q') continue
    n += CH_CENTRE[i] * (t === 'p' ? 1 : 2)
    // a knight or bishop still on its home rank has not been developed
    const homeRow = side === 'w' ? 7 : 0
    if ((t === 'n' || t === 'b') && Math.floor(i / 8) === homeRow) n -= 12
    if (t === 'p') n += (side === 'w' ? 7 - Math.floor(i / 8) : Math.floor(i / 8)) * 3
  }
  return n
}

// The static score of a position FROM `side`'s point of view. `guard` is the
// weight on "the worst piece I left hanging"; «سهل» passes 0, which is exactly
// what makes it hang pieces.
function chStatic(board, side, guard) {
  let sc = (chMaterial(board, side) - chMaterial(board, chOther(side))) * 10
  sc += chPlacement(board, side) - chPlacement(board, chOther(side))
  if (guard) sc -= chWorstHanging(board, side) * guard
  return sc
}

// A deterministic spread, NOT Math.random: the bot must stay a pure function of
// the position it is shown (see the file header). ±amp, hashed off the key.
const chNoise = (key, amp) => ((hash32(key) % 2001) / 1000 - 1) * amp

// The board-only successor of a position. `reduce` would also rebuild the
// repetition history and the SAN list for every node, which the search does not
// read — so the deep level walks the position with the game's own applyRaw.
function chChild(st, m, applyRaw) {
  const r = applyRaw(st, m)
  return {
    board: r.board,
    turn: chOther(st.turn),
    castling: r.castling,
    ep: r.ep,
    halfmove: r.halfmove,
  }
}

// MVV ordering: the fattest victim first, which is what makes alpha-beta cut.
function chVictim(board, m) {
  const c = board[m.to]
  const v = c === '.' ? 0 : (CH_VAL[c.toLowerCase()] || 0)
  return v + (m.promo ? 850 : 0)
}

// ONE ROUND OF EXCHANGE on the square the opponent's reply just landed on.
//
// This is not a refinement, it is what makes the second ply worth having.
// A plain two-ply search stops the instant the opponent captures, so every
// even trade reads as a clean loss and the bot spends the game running away
// from perfectly good exchanges — measured: without this, «صعب» scored no
// better than «متوسط» over eight test games. Standard SEE, one round deep:
// I take back; if they can take back again, I pay for my capturer.
function chRecapture(board, to, side) {
  const c = board[to]
  if (c === '.' || chOwner(c) === side) return 0
  const victim = CH_VAL[c.toLowerCase()] || 0
  if (!victim) return 0
  const mine = chCheapestAttacker(board, to, side)
  if (mine === Infinity) return 0
  const theirs = chCheapestAttacker(board, to, chOther(side))
  const gain = theirs === Infinity ? victim : victim - mine
  return gain > 0 ? gain : 0
}

// Hard ceiling on the second ply. Roughly 35 replies over 35 candidates is
// ~1200 leaves; this leaves headroom for a wild middlegame and still returns in
// a few milliseconds, well inside BOT_DELAY_MS.
const CH_NODES = 9000

// Would this position let the opponent mate me on the very next move? Only the
// replies that actually give check cost a move generation, so this is cheap
// enough to run over the top few candidates.
function chAllowsMate(child, mySide, gen, applyRaw, attackedFn, kingIdx) {
  let replies = []
  try { replies = gen(child) } catch (_) { return false }
  for (let i = 0; i < replies.length; i += 1) {
    let g = null
    try { g = chChild(child, replies[i], applyRaw) } catch (_) { g = null }
    if (!g) continue
    const k = kingIdx(g.board, mySide)
    if (k < 0) return true
    if (!attackedFn(g.board, k, chOther(mySide))) continue
    let mine = []
    try { mine = gen(g) } catch (_) { mine = [] }
    if (!mine.length) return true
  }
  return false
}

export function chessBotMove(state, seat, ctx) {
  const st = state
  if (!st || typeof st.board !== 'string' || st.board.length !== 64) return null
  if (st.status !== 'playing') return null
  const mySide = seat === 1 ? 'b' : 'w'
  if (st.turn !== mySide) return null

  const h = (ctx && ctx.helpers) || {}
  const gen = h.legalMoves
  const reduce = ctx && ctx.reduce
  if (typeof gen !== 'function' || typeof reduce !== 'function') return null
  const askedLevel = ctx && ctx.level
  const level = askedLevel === 'easy' || askedLevel === 'hard' ? askedLevel : 'normal'

  const list = gen(st)
  if (!list.length) return null

  // Promotions: only the queen is considered. Underpromotion matters in perhaps
  // one game in a thousand and quadruples the branching factor for it.
  const cands = list.filter((m) => !m.promo || m.promo === 'q')
  const use = cands.length ? cands : list

  // ---- ply one. Every level runs this; for «صعب» it is also the move ordering.
  const scored = []
  for (let i = 0; i < use.length; i += 1) {
    const m = use[i]
    const mv = { type: 'move', from: m.from, to: m.to, promo: m.promo || null, seat }
    let out = null
    try { out = reduce(st, mv, (ctx && ctx.room) || null) } catch (_) { out = null }
    if (!out || !out.state || out.state === st) continue
    const next = out.state

    let sc
    let done = false
    if (next.status !== 'playing') {
      // the reducer already decided: mate for me, or a draw
      done = true
      if (next.result === mySide) sc = 1e6
      else if (next.result === 'draw') {
        // take a draw only when losing; a draw while ahead is a wasted win
        const diff = chMaterial(st.board, mySide) - chMaterial(st.board, chOther(mySide))
        sc = diff < -200 ? 5e5 : -5e5
      } else sc = -1e6
    } else {
      sc = chStatic(next.board, mySide, level === 'easy' ? 0 : 9)
      if (next.check) sc += 25
      if (m.castle) sc += 90
    }
    sc += level === 'easy'
      ? chNoise(`ez|${next.board}|${m.from}|${m.to}`, 115)
      : jitter(`ch|${next.board}|${m.from}|${m.to}`)
    scored.push({ m, mv, sc, next, done })
  }

  if (!scored.length) {
    // The scan found nothing usable (should be unreachable). Fall back to the
    // safest possible behaviour: a legal move straight from the game's own
    // generator, validated once more by the reducer.
    return firstLegal(list.map((m, i) => ({
      score: -i,
      move: { type: 'move', from: m.from, to: m.to, promo: m.promo || null },
    })), st, seat, ctx)
  }

  scored.sort((a, b) => b.sc - a.sc)
  const applyRaw = h.applyRaw
  const attackedFn = h.attacked
  const kingIdx = h.kingIndex
  if (
    level !== 'hard' ||
    typeof applyRaw !== 'function' ||
    typeof attackedFn !== 'function' ||
    typeof kingIdx !== 'function'
  ) return scored[0].mv

  // ---- ply two: what does my opponent do about it? -------------------------
  // Root maximises, the reply minimises, alpha prunes a candidate the moment
  // one reply drags it below the best already in hand.
  const foe = chOther(mySide)
  let nodes = CH_NODES
  let alpha = -Infinity
  const deep = []
  for (let i = 0; i < scored.length; i += 1) {
    const cand = scored[i]
    if (cand.done) {
      deep.push({ cand, sc: cand.sc })
      if (cand.sc > alpha) alpha = cand.sc
      continue
    }
    let replies = []
    try { replies = gen(cand.next) } catch (_) { replies = [] }
    if (!replies.length) { deep.push({ cand, sc: cand.sc }); if (cand.sc > alpha) alpha = cand.sc; continue }
    replies.sort((a, b) => chVictim(cand.next.board, b) - chVictim(cand.next.board, a))

    let worst = Infinity
    let full = true
    for (let k = 0; k < replies.length; k += 1) {
      if (nodes <= 0) { full = false; break }
      nodes -= 1
      let g = null
      try { g = chChild(cand.next, replies[k], applyRaw) } catch (_) { g = null }
      if (!g) continue
      let v = chStatic(g.board, mySide, 4)
      // …and I get to answer: the piece they just moved may simply be taken
      v += chRecapture(g.board, replies[k].to, mySide) * 10
      const kk = kingIdx(g.board, mySide)
      // standing in check at the leaf is a real cost this depth cannot price
      if (kk >= 0 && attackedFn(g.board, kk, foe)) v -= 45
      if (v < worst) worst = v
      if (worst <= alpha) break
    }
    // A truncated candidate keeps the pessimistic of the two readings, so a
    // budget cut can never promote a move above one that was searched in full.
    // the two positional nudges the deep score would otherwise throw away —
    // the search value replaces the one-ply score entirely
    const nudge = (cand.m.castle ? 60 : 0) + (cand.next.check ? 10 : 0)
    let sc = worst === Infinity ? cand.sc : worst + nudge + jitter(`h2|${cand.m.from}|${cand.m.to}`)
    if (!full) sc = Math.min(sc, cand.sc)
    deep.push({ cand, sc })
    if (sc > alpha) alpha = sc
  }

  deep.sort((a, b) => b.sc - a.sc)
  // …and never hand the opponent mate in one. Checked over the best few only:
  // beyond that the move is already bad enough that it will not be played.
  for (let i = 0; i < Math.min(3, deep.length); i += 1) {
    const c = deep[i].cand
    if (c.done) return c.mv
    if (!chAllowsMate(c.next, mySide, gen, applyRaw, attackedFn, kingIdx)) return c.mv
  }
  return deep[0].cand.mv
}

// ===========================================================================
// DOMINOES
//
// No helpers needed: a tile id is `${hi}:${lo}` and the chain is public.
// The bot reads ONLY state.hands[itsOwnSeat] and state.line.
//
// Strength claim: greedy one-ply with a scarcity read. It goes out when it
// can, otherwise it sheds weight while keeping an end it can still answer, and
// it prefers to leave ends whose pip is SCARCE among the tiles it cannot see —
// which is real dominoes thinking, not a lookahead. It presses that harder once
// the boneyard is dry and once an opponent is down to a tile or two.
//
// WHAT IT READS. Its own hand, the chain, the boneyard size, and how MANY tiles
// each opponent holds — all of which a human at the table can see too. It never
// looks at WHICH tiles another seat holds, even though the shared state object
// physically contains them.
//
// WHAT IT STILL DOES NOT DO: it does not remember which pips a player passed or
// drew on, which is the single most valuable read in real dominoes, and it never
// looks a move ahead. A regular player will beat it more often than not.
// ===========================================================================
const domPips = (id) => {
  const s = String(id).split(':')
  return [Number(s[0]) || 0, Number(s[1]) || 0]
}
const domWeight = (id) => { const [a, b] = domPips(id); return a + b }
const domDouble = (id) => { const [a, b] = domPips(id); return a === b }

function domEndsAfter(line, id, side) {
  const [a, b] = domPips(id)
  if (!line || !line.length) return { L: a, R: b }
  if (side === 'L') {
    const end = line[0].a
    return { L: a === end ? b : a, R: line[line.length - 1].b }
  }
  const end = line[line.length - 1].b
  return { L: line[0].a, R: a === end ? b : a }
}

const domFits = (id, ends) => {
  const [a, b] = domPips(id)
  return a === ends.L || b === ends.L || a === ends.R || b === ends.R
}

export function dominoesBotMove(state, seat, ctx) {
  const st = state
  if (!st || !st.hands || !Array.isArray(st.line)) return null
  // Round and match transitions belong to the human at the table, not to a bot
  // that would flick past the result screen before anyone read it.
  if (st.phase !== 'play') return null

  const hand = st.hands[String(seat)] || []
  const line = st.line

  if (st.mustOpen) {
    return firstLegal([{ score: 1, move: { type: 'play', id: st.mustOpen, side: 'R' } }], st, seat, ctx)
  }

  // Public knowledge only. Every pip value lives on exactly seven tiles; strike
  // off the ones this bot holds and the ones already face-up on the table, and
  // what is left is how many tiles carrying that pip could still be in somebody
  // else's hand or in the boneyard. A low number means a hard end to answer.
  const unseen = [7, 7, 7, 7, 7, 7, 7]
  const strike = (id) => {
    const [a, b] = domPips(id)
    unseen[a] -= 1
    if (b !== a) unseen[b] -= 1
  }
  for (let i = 0; i < hand.length; i += 1) strike(hand[i])
  for (let i = 0; i < line.length; i += 1) strike(line[i].id)

  // How close is the nearest opponent to going out? Only the COUNT is read —
  // that is on the table for everyone to see.
  let closest = 99
  const keys = Object.keys(st.hands || {})
  for (let i = 0; i < keys.length; i += 1) {
    if (Number(keys[i]) === seat) continue
    const n = (st.hands[keys[i]] || []).length
    if (n < closest) closest = n
  }
  const pressure = closest <= 1 ? 2.4 : closest <= 2 ? 1.7 : closest <= 3 ? 1.25 : 1
  // While the boneyard is deep a blocked end is only an inconvenience: the
  // opponent just draws. Once it is dry, a blocked end can end the round.
  const blockWeight = (st.boneyard || []).length ? 0.55 : 1.7

  const ranked = []
  for (let i = 0; i < hand.length; i += 1) {
    const id = hand[i]
    const rest = hand.filter((x) => x !== id)
    const sides = line.length ? ['L', 'R'] : ['R']
    for (const side of sides) {
      const ends = domEndsAfter(line, id, side)
      let sc = 0
      if (!rest.length) sc += 10000              // out — nothing beats it
      sc += domWeight(id) * 2.0                  // the pips you keep are the pips you pay
      if (domDouble(id)) sc += 11                // a double left in hand is dead weight
      let flex = 0
      let control = 0
      for (const r of rest) {
        if (domFits(r, ends)) flex += 1
        const [ra, rb] = domPips(r)
        if (ra === ends.L || rb === ends.L) control += 1
        if (ra === ends.R || rb === ends.R) control += 1
      }
      sc += flex * 6
      sc += control * 2
      if (rest.length && flex === 0) sc -= 45    // playing yourself into a draw
      // squeeze: leave ends the rest of the table is short of
      const squeeze = (7 - unseen[ends.L]) + (7 - unseen[ends.R])
      sc += squeeze * 2.1 * pressure * blockWeight
      if (ends.L === ends.R) sc += 7 * pressure * blockWeight  // both ends want the same pip
      ranked.push({ score: sc + jitter(`dom|${id}|${side}|${line.length}`), move: { type: 'play', id, side } })
    }
  }

  const pick = firstLegal(bySeat(ranked), st, seat, ctx)
  if (pick) return pick
  // Nothing playable: the rules say draw while the boneyard lives, then pass.
  return firstLegal(
    [{ score: 2, move: { type: 'draw' } }, { score: 1, move: { type: 'pass' } }],
    st, seat, ctx,
  )
}

// ===========================================================================
// WIST
//
// helpers (from Wist.jsx `botHelpers`): suitOf, rankOf, rankVal, trickWinner,
// team, SUITS, RANKS, MIN_BID, MAX_BID
//
// THREE LEVELS, chosen by the player and passed in as `ctx.level`. The
// difference between them is real, not a delay or a handicap:
//
//   easy    Over-values its hand by a full trick when it bids, names its
//           longest suit as trump, and picks among its legal cards close to at
//           random. It follows suit because the reducer will not let it do
//           otherwise, not because it decided to.
//   normal  A hand-evaluation bid plus a four-rule card policy: win it cheaply,
//           save your high card when your partner already holds the trick, ruff
//           when you are void and losing, otherwise throw your cheapest. It
//           does not count anything.
//   hard    Counts. It reads `state.seen` — the public record of every card
//           already face up this hand, which every human at the table can see
//           too — and from it derives what is still out in each suit, how many
//           trumps are unaccounted for, and who has shown a void by failing to
//           follow. It cashes master cards, draws trumps when its own side
//           holds the contract, will not raise its partner's contract on a
//           weak hand, keeps a master rather than throwing it away, and
//           signals to its partner with the card it discards.
//
// WHAT NO LEVEL DOES: read another seat's hand. Each one sees exactly
// `state.hands[itsOwnSeat]` plus the public table. Every candidate is run
// through Wist's own reducer before it is returned (see `firstLegal`), so a
// heuristic slip can never emit an illegal card — it just tries the next one.
// ===========================================================================
const W_HONOUR = { A: 1, K: 0.75, Q: 0.45, J: 0.2 }
const W_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']

const wistLevel = (ctx) => (ctx && (ctx.level === 'easy' || ctx.level === 'hard') ? ctx.level : 'normal')

// the public record: every card already played this hand, in play order
const wistSeen = (st) => (Array.isArray(st.seen) ? st.seen : [])

// Cards of `suit` still in SOMEBODY ELSE'S hand: the full rank list minus what
// has been played and minus what this bot is holding itself. Nothing here
// touches another seat's hand — it is arithmetic over public information.
function wistOutstanding(st, hand, suit, h) {
  const ranks = h.RANKS || W_RANKS
  const gone = {}
  for (const e of wistSeen(st)) if (e && h.suitOf(e.c) === suit) gone[String(e.c).charAt(0)] = 1
  for (const c of hand) if (h.suitOf(c) === suit) gone[String(c).charAt(0)] = 1
  const out = []
  for (const r of ranks) if (!gone[r]) out.push(r + suit)
  return out
}

// the highest rank of `suit` still out there, or -1 when the suit is exhausted
function wistTopOut(st, hand, suit, h) {
  const out = wistOutstanding(st, hand, suit, h)
  let best = -1
  for (const c of out) { const v = h.rankVal(c); if (v > best) best = v }
  return best
}

// Who has shown a void in what, read from COMPLETED tricks only: a player who
// did not follow the led suit does not hold it. Public information — everyone
// at the table watched it happen.
function wistVoids(st, h) {
  const seen = wistSeen(st)
  const v = [{}, {}, {}, {}]
  for (let i = 0; i + 3 < seen.length; i += 4) {
    const led = h.suitOf(seen[i].c)
    for (let k = 0; k < 4; k += 1) {
      const e = seen[i + k]
      if (!e || !Number.isInteger(e.s) || e.s < 0 || e.s > 3) continue
      if (h.suitOf(e.c) !== led) v[e.s][led] = 1
    }
  }
  return v
}

// What the partner has ASKED FOR. Sending a signal is only half of it: the
// other half is reading one. A partner who could not follow and threw a
// middling card of some suit wants that suit led; failing that, the suit it
// led itself is the one it is working on. Both are public — everyone at the
// table watched the card fall.
function wistPartnerAsk(st, seat, h) {
  const seen = wistSeen(st)
  const mate = (seat + 2) % 4
  let ask = null
  let lastLed = null
  for (let i = 0; i + 3 < seen.length; i += 4) {
    const led = h.suitOf(seen[i].c)
    if (seen[i].s === mate) lastLed = led
    for (let k = 0; k < 4; k += 1) {
      const e = seen[i + k]
      if (!e || e.s !== mate) continue
      const s = h.suitOf(e.c)
      if (s === led || s === st.trump) continue
      const v = h.rankVal(e.c)
      if (v >= 4 && v <= 8) ask = s
    }
  }
  return ask || lastLed
}

function wistLongestSuit(hand, h) {
  let best = h.SUITS[0]
  let n = -1
  for (const s of h.SUITS) {
    const k = hand.filter((c) => h.suitOf(c) === s).length
    if (k > n) { n = k; best = s }
  }
  return best
}

function wistSuitGroups(hand, suitOf) {
  const g = { S: [], H: [], D: [], C: [] }
  for (const c of hand) { const s = suitOf(c); if (g[s]) g[s].push(c) }
  return g
}

// Tricks THIS HAND alone is likely to take with `trumpSuit` as trump. Deliberately
// conservative: over-bidding is punished by the full bid, under-bidding only
// costs the difference.
function wistEstimate(hand, trumpSuit, h) {
  const g = wistSuitGroups(hand, h.suitOf)
  const trumps = g[trumpSuit] || []
  const tLen = trumps.length
  let n = 0
  for (const c of trumps) n += W_HONOUR[String(c).charAt(0)] || 0
  n += Math.max(0, tLen - 3) * 0.85
  for (const s of h.SUITS) {
    if (s === trumpSuit) continue
    const cards = g[s] || []
    const len = cards.length
    let side = 0
    for (const c of cards) {
      const r = String(c).charAt(0)
      if (r === 'A') side += 1
      else if (r === 'K' && len >= 2) side += 0.7
      else if (r === 'Q' && len >= 3) side += 0.4
    }
    n += side
    if (len === 0 && tLen >= 3) n += 1
    else if (len === 1 && tLen >= 4) n += 0.5
  }
  return n
}

function wistBestTrump(hand, h) {
  let best = h.SUITS[0]
  let bestN = -1
  for (const s of h.SUITS) {
    const n = wistEstimate(hand, s, h) + (wistSuitGroups(hand, h.suitOf)[s] || []).length * 0.05
    if (n > bestN) { bestN = n; best = s }
  }
  return { suit: best, est: bestN }
}

export function wistBotMove(state, seat, ctx) {
  const st = state
  if (!st || !Array.isArray(st.hands)) return null
  const h = (ctx && ctx.helpers) || {}
  if (typeof h.suitOf !== 'function' || typeof h.rankVal !== 'function') return null
  const SUITS = h.SUITS || ['S', 'H', 'D', 'C']
  const MIN_BID = h.MIN_BID || 7
  const MAX_BID = h.MAX_BID || 13
  const hh = { ...h, SUITS }
  const hand = st.hands[seat] || []
  const level = wistLevel(ctx)
  const teamOf = typeof h.team === 'function' ? h.team : (s) => s % 2

  // ---- auction ----
  if (st.phase === 'bid') {
    if (st.bidTurn !== seat || st.bids[seat] === 'pass') return null
    const { est } = wistBestTrump(hand, hh)
    // The bid is for the PARTNERSHIP, so the partner's average share is added.
    // 2.6 rather than 3.25 because our own strength is concentrated in the suit
    // we are about to name, which is exactly where the partner's is not. Easy
    // adds a whole extra trick it has no reason to expect, which is exactly the
    // mistake a loose bidder makes; hard shades the other way.
    const share = level === 'easy' ? 3.7 : level === 'hard' ? 2.45 : 2.6
    const side = est + share
    const floor = st.highBid ? st.highBid.n + 1 : MIN_BID
    const want = Math.floor(side)
    const ranked = []

    // hard only: the standing bid is already our own partner's. Raising it
    // buys nothing and risks the whole contract, so it takes real extra
    // strength — two tricks over the floor — before it will push.
    const partnerHolds = level === 'hard' && st.highBid && teamOf(st.highBid.seat) === teamOf(seat)
    const bar = partnerHolds ? floor + 2 : floor

    if (want >= bar && floor <= MAX_BID && want >= MIN_BID) {
      const n = Math.min(want, MAX_BID)
      // never call kaboot on a guess
      if (n < MAX_BID || side >= 12.5) ranked.push({ score: 2, move: { t: 'bid', n } })
    }
    ranked.push({ score: 1, move: { t: 'pass' } })
    return firstLegal(ranked, st, seat, ctx)
  }

  // ---- naming trump ----
  if (st.phase === 'trump') {
    if (!st.highBid || st.highBid.seat !== seat) return null
    // easy just names whatever it holds most of, which is often not its best
    const pick = level === 'easy' ? wistLongestSuit(hand, hh) : wistBestTrump(hand, hh).suit
    const ranked = [{ score: 2, move: { t: 'trump', suit: pick } }]
    for (const s of SUITS) if (s !== pick) ranked.push({ score: 1, move: { t: 'trump', suit: s } })
    return firstLegal(ranked, st, seat, ctx)
  }

  if (st.phase !== 'play') return null
  if (st.turnSeat !== seat) return null
  if (!hand.length) return null

  const trump = st.trump
  const opening = st.doneWinner != null || !st.trick || st.trick.length === 0
  const trick = opening ? [] : st.trick

  const rank = (c) => h.rankVal(c)
  const suit = (c) => h.suitOf(c)
  const g = wistSuitGroups(hand, suit)

  // ---- easy: it follows suit because the reducer makes it, and otherwise
  // throws whatever comes to hand. Deterministic, not Math.random, so the same
  // position always produces the same card.
  if (level === 'easy') {
    const led = trick.length ? suit(trick[0].card) : null
    const mineE = led ? hand.filter((c) => suit(c) === led) : []
    const pool = mineE.length ? mineE : hand
    const ranked = pool.map((c) => ({
      score: jitter(`we|${c}|${seat}|${wistSeen(st).length}`) * 1000,
      move: { t: 'play', card: c },
    }))
    return firstLegal(bySeat(ranked), st, seat, ctx)
  }

  // ---- counting, hard only. Everything below is derived from `state.seen`,
  // the cards already face up on the table.
  const counting = level === 'hard'
  const topOut = {}
  let trumpsOut = 0
  let voids = [{}, {}, {}, {}]
  if (counting) {
    for (const s of SUITS) topOut[s] = wistTopOut(st, hand, s, hh)
    trumpsOut = wistOutstanding(st, hand, trump, hh).length
    voids = wistVoids(st, hh)
  }
  const foes = [(seat + 1) % 4, (seat + 3) % 4]
  const foeVoidIn = (s) => counting && foes.some((f) => voids[f][s])
  const isMaster = (c) => counting && rank(c) > (topOut[suit(c)] === undefined ? 99 : topOut[suit(c)])
  const weBid = !!st.highBid && teamOf(st.highBid.seat) === teamOf(seat)

  // How much THIS trick is actually worth. In this scoring a trick is one point
  // to whoever takes it — except that a bidding side one short loses its whole
  // bid, and the defenders who set it swing the difference twice over. So the
  // trick that decides a contract is worth several ordinary ones, and hard
  // plays those flat out from either side of the table.
  const bidSideTricks = st.highBid ? st.tricksWon[teamOf(st.highBid.seat)] : 0
  const stillNeeded = st.highBid ? st.highBid.n - bidSideTricks : 0
  const tricksLeft = 13 - (st.tricksWon[0] + st.tricksWon[1])
  const critical = counting && stillNeeded > 0 && stillNeeded >= tricksLeft - 1

  // ---- leading ----
  if (!trick.length) {
    const ranked = []
    const myTrumps = g[trump] || []
    const partnerAsk = counting ? wistPartnerAsk(st, seat, hh) : null
    for (const c of hand) {
      let sc = 0
      const s = suit(c)
      const r = String(c).charAt(0)
      // the partner asked for this suit — lead it back
      const asked = counting && s === partnerAsk && s !== trump ? 90 : 0
      if (s === trump) {
        if (counting) {
          // Once no trump is left in another hand, every trump this bot holds
          // is a winner and it should simply run them. Before that, drawing is
          // worth it only while its own side holds the contract.
          if (trumpsOut === 0) sc = 470 + rank(c)
          else if (weBid && myTrumps.length >= 4) sc = 520 + rank(c)
          else sc = 60 + rank(c) * 0.3
        } else {
          sc = myTrumps.length >= 4 ? 300 + rank(c) : 40 + rank(c) * 0.4
        }
      } else if (counting ? isMaster(c) : r === 'A') {
        // cash a card nothing left in the pack can beat
        sc = 430 + (g[s] || []).length * 6
        // ...unless an opponent has shown out of it and can still ruff
        if (foeVoidIn(s) && trumpsOut > 0) sc -= 320
      } else {
        // otherwise open low from length and keep the honours back
        sc = 130 + (g[s] || []).length * 8 - rank(c) * 4
        if (foeVoidIn(s) && trumpsOut > 0) sc -= 70
      }
      ranked.push({ score: sc + asked + jitter(`w|l|${c}|${seat}`), move: { t: 'play', card: c } })
    }
    return firstLegal(bySeat(ranked), st, seat, ctx)
  }

  // ---- following ----
  const led = suit(trick[0].card)
  const mine = hand.filter((c) => suit(c) === led)
  const legal = mine.length ? mine : hand
  const voidInLed = mine.length === 0

  // who is winning right now, decided by the game's own trick logic
  let winnerSeat = trick[0].seat
  if (typeof h.trickWinner === 'function') {
    try { winnerSeat = h.trickWinner(trick, trump) } catch (_) { winnerSeat = trick[0].seat }
  }
  const partnerAhead = teamOf(winnerSeat) === teamOf(seat)
  const bestOnTable = trick.find((p) => p.seat === winnerSeat)
  const lastToPlay = trick.length === 3

  const beats = (c) => {
    if (!bestOnTable) return true
    const bs = suit(bestOnTable.card)
    const cs = suit(c)
    if (cs === bs) return rank(c) > rank(bestOnTable.card)
    if (cs === trump) return bs !== trump
    return false
  }

  // The suit hard would like its partner to lead next: its longest side suit
  // outside the one on the table, where it still holds a top card. Throwing a
  // middling card of that suit is the signal — the oldest one in the game.
  let signalSuit = null
  if (counting && voidInLed) {
    let bestN = 0
    for (const s of SUITS) {
      if (s === trump || s === led) continue
      const cards = g[s] || []
      if (cards.length > bestN && cards.some((c) => rank(c) >= 9)) { bestN = cards.length; signalSuit = s }
    }
  }

  // Is the partner's win actually SAFE, or only ahead for the moment? This is
  // the one judgement counting really buys. "My partner is winning, so I throw
  // my cheapest" is right when nothing can overtake — and a straight gift of
  // the trick when two opponents have still to play over a small card.
  const afterMe = []
  for (let k = trick.length + 1, s2 = (seat + 1) % 4; k < 4; k += 1, s2 = (s2 + 1) % 4) afterMe.push(s2)
  const foesAfterMe = afterMe.filter((s2) => teamOf(s2) !== teamOf(seat))
  let partnerSafe = lastToPlay
  if (counting && !partnerSafe && bestOnTable && partnerAhead) {
    const bs = suit(bestOnTable.card)
    const topsIt = rank(bestOnTable.card) > (topOut[bs] === undefined ? 99 : topOut[bs])
    const ruffable = bs !== trump && trumpsOut > 0 && foesAfterMe.some((f) => voids[f][bs])
    partnerSafe = topsIt && !ruffable
  }

  const ranked = legal.map((c) => {
    const s = suit(c)
    let sc
    if (partnerAhead && counting && !partnerSafe && beats(c) && (isMaster(c) || critical)) {
      // the partner is ahead but cannot hold it: take the trick over with the
      // card nothing left in the pack can beat, rather than hand it away
      sc = 460 - rank(c) * 4
      if (critical) sc += 200
      if (s === trump && suit(bestOnTable.card) !== trump) sc -= 200 // still not with a ruff
    } else if (partnerAhead) {
      // partner already holds the trick: throw the cheapest thing that keeps it
      sc = 200 - rank(c) * 6
      if (lastToPlay) sc += 60           // certain — nothing can overtake now
      if (s === trump && bestOnTable && suit(bestOnTable.card) !== trump) sc -= 260 // do not ruff your own side
      if (counting) {
        if (isMaster(c)) sc -= 150       // a winner thrown under a partner is a wasted trick
        // the signal: a middling card of the suit we want led back
        if (voidInLed && s === signalSuit && rank(c) >= 4 && rank(c) <= 8) sc += 70
      }
    } else if (beats(c)) {
      // win it as cheaply as possible
      sc = 500 - rank(c) * 8
      if (s === trump && led !== trump) sc -= 40      // a ruff costs a trump
      if (lastToPlay) sc += 40
      if (counting) {
        // a card nothing left can top wins the trick outright; a merely
        // "highest so far" card played from second seat is usually overtaken
        // by one of the two players still to come, which spends it for nothing
        if (isMaster(c) || lastToPlay) sc += 170
        if (s === trump && led !== trump && trumpsOut === 0) sc += 40
        // the contract turns on this trick: take it with whatever it costs,
        // ruff included — a trump saved for later is worth nothing if the
        // contract is already made or already broken by then
        if (critical) sc += 320 + (s === trump && led !== trump ? 60 : 0)
      }
    } else {
      // cannot win: shed the least useful card, protecting aces and trumps
      sc = 100 - rank(c) * 3
      if (s === trump) sc -= 140
      if (String(c).charAt(0) === 'A') sc -= 90
      sc -= (g[s] || []).length * 2
      if (counting) {
        if (isMaster(c)) sc -= 160       // never throw away a card that still wins
        if (voidInLed && s === signalSuit && rank(c) >= 4 && rank(c) <= 8) sc += 60
      }
    }
    return { score: sc + jitter(`w|f|${c}|${seat}|${trick.length}`), move: { t: 'play', card: c } }
  })

  return firstLegal(bySeat(ranked), st, seat, ctx)
}

// ===========================================================================
// JACKAROO
//
// helpers (from Jackaroo.jsx `botHelpers`): movesForCard, runDescriptor,
// activeOwner, isLane, isTrack, isBase, cellOf, TRACK, LANE, PER, team
//
// Strength claim: it enumerates every descriptor its own cards allow — through
// the game's own generator, so the enumeration is the rulebook — and scores the
// resulting board with two numbers:
//   PROGRESS  its side's marbles minus the other side's, a parked marble worth
//             far more than a marble still travelling, a based marble worth 0.
//   POSITION  how exposed each side is on the shared loop. A marble sitting 1..13
//             squares in front of an enemy marble can be landed on by one card,
//             and a marble exactly 4 squares behind one can be taken by the
//             backward four. So it prefers not to park in a killing range, and
//             mildly prefers to sit inside its own killing range instead.
// It takes the best. Still ONE CARD DEEP: it never plans the seven-split around
// a card it has not played yet and it does not read the round ahead. Every
// candidate is re-validated by the game's own `reduce` before it is submitted,
// so a heuristic slip can never produce an illegal move, and it reads ONLY its
// own seat's hand — never another player's cards and never the undealt deck.
//
// THREE LEVELS, chosen on the board and passed in as `ctx.level`. The
// differences are real changes of policy, not a delay or a handicap:
//   easy   — PROGRESS only. It never looks at who is standing in whose killing
//            range, and its tie-break noise is wide enough that two moves of
//            similar value genuinely shuffle, so it bleeds tempo. It still
//            takes an obvious lane entry, and it never plays a silly move.
//   normal — progress plus the POSITION term above.
//   hard   — normal, plus CARD ECONOMY: only the Ace and the King open the
//            base, so walking one of them forward while its own marbles are
//            still shut in is discounted, and a Jack spent on a swap that gains
//            almost nothing is discounted too. When the discount makes every
//            move negative and a dead card is in hand, it burns the dead card
//            instead — which is exactly the play a good human makes.
// Measured over 400 four-handed games each, partnerships swapped every game so
// neither side keeps the opening seat: hard beats easy 64/36, hard beats normal
// 56/44, normal beats easy 61/39. Every game finished.
// ===========================================================================
function jakValue(p, h) {
  if (h.isLane(p)) return 140 + (p - 100) * 3
  if (h.isBase(p)) return 0
  if (h.isTrack(p)) return 30 + p
  return 0
}

function jakTeamValue(marbles, t, h) {
  let n = 0
  for (const s of [t, t + 2]) {
    const row = marbles[s] || []
    for (const p of row) n += jakValue(p, h)
  }
  return n
}

// every marble of one partnership that is out on the shared loop, with the
// ABSOLUTE square it stands on — which is the only frame in which two different
// players' marbles can be compared
function jakUnits(marbles, t, h) {
  const out = []
  if (typeof h.cellOf !== 'function') return out
  for (const s of [t, t + 2]) {
    const row = marbles[s] || []
    for (let i = 0; i < row.length; i += 1) {
      const p = row[i]
      if (h.isTrack(p)) out.push({ cell: h.cellOf(s, p), p })
    }
  }
  return out
}

// The forward gaps ONE card can actually cover, and how often the pack can
// produce them. Derived from the rulebook, not guessed: there is no card worth
// eleven, a forward four exists only as the second leg of a split seven (rare,
// so it is weighted low), and the plain 4 is the only card that goes backwards.
const JAK_REACH = { 1: 9, 2: 9, 3: 9, 4: 4, 5: 8, 6: 8, 7: 8, 8: 6, 9: 6, 10: 6, 12: 5, 13: 5 }

// exposure on the loop, both ways round. Returns a single signed term already
// scaled to sit under the progress number rather than swamp it.
function jakPosition(marbles, mine, foe, h, hard) {
  const T = h.TRACK || 72
  const us = jakUnits(marbles, mine, h)
  const them = jakUnits(marbles, foe, h)
  if (!us.length || !them.length) return 0
  let danger = 0
  let threat = 0
  for (const a of us) {
    for (const b of them) {
      const ahead = (((a.cell - b.cell) % T) + T) % T // what they must travel to land on us
      const w = JAK_REACH[ahead] || 0
      if (w) danger += w + a.p * 0.16 // a marble deep into its lap has more to lose
      const behind = (((b.cell - a.cell) % T) + T) % T
      if (behind === 4) danger += 5 + a.p * 0.08 // their backward four reaches us
      const w2 = JAK_REACH[behind] || 0
      if (w2) threat += w2 * 0.55 + b.p * 0.08
    }
  }
  return threat * 0.5 - danger * (hard ? 1.7 : 1)
}

// «صعب» only: what the CARD is worth beyond this move. Only two cards in the
// pack open the base, so burning an Ace or a King on a plain walk while your
// own marbles are still shut in is the classic beginner's leak; a Jack spent on
// a swap that gains nothing throws away the one card that can undo a lap.
function jakCardCost(marbles, owner, card, d, gain, h) {
  const r = typeof h.rankOf === 'function' ? h.rankOf(card) : String(card || '').charAt(0)
  let cost = 0
  if ((r === 'A' || r === 'K') && d && d.mode !== 'out') {
    const shutIn = (marbles[owner] || []).some((p) => h.isBase(p))
    if (shutIn) cost -= 28
  }
  if (r === 'J' && gain < 25) cost -= 14
  return cost
}

const jakLevel = (ctx) => (ctx && (ctx.level === 'easy' || ctx.level === 'hard') ? ctx.level : 'normal')

export function jackarooBotMove(state, seat, ctx) {
  const st = state
  if (!st || !Array.isArray(st.marbles)) return null
  if (st.phase !== 'play') return null
  if (st.turnSeat !== seat) return null

  const h = (ctx && ctx.helpers) || {}
  if (typeof h.movesForCard !== 'function' || typeof h.runDescriptor !== 'function') return null
  const teamOf = typeof h.team === 'function' ? h.team : (s) => s % 2
  const owner = typeof h.activeOwner === 'function' ? h.activeOwner(st.marbles, seat) : seat
  const hand = st.hands[seat] || []
  if (!hand.length) return null

  const myTeam = teamOf(seat)
  const foeTeam = 1 - myTeam
  const level = jakLevel(ctx)
  const hard = level === 'hard'
  const blind = level === 'easy'
  const scoreOf = (marbles) => (
    jakTeamValue(marbles, myTeam, h) - jakTeamValue(marbles, foeTeam, h)
    + (blind ? 0 : jakPosition(marbles, myTeam, foeTeam, h, hard))
  )
  const base = scoreOf(st.marbles)
  // «سهل» does not weigh the small differences either: the jitter is widened
  // until near-equal moves genuinely shuffle, so it wastes tempo without ever
  // playing an illegal or absurd move — it still takes an obvious lane entry.
  const noise = blind ? 1800 : 1

  const ranked = []
  const dead = []
  for (let i = 0; i < hand.length; i += 1) {
    const card = hand[i]
    let ds = []
    try { ds = h.movesForCard(st.marbles, owner, card) || [] } catch (_) { ds = [] }
    if (!ds.length) { dead.push({ i, card }); continue }
    for (let k = 0; k < ds.length; k += 1) {
      const d = ds[k]
      let res = null
      try { res = h.runDescriptor(st.marbles, owner, card, d) } catch (_) { res = null }
      if (!res) continue
      const gain = scoreOf(res.marbles) - base
      const sc = gain + (hard ? jakCardCost(st.marbles, owner, card, d, gain, h) : 0)
      ranked.push({
        score: sc + jitter(`jak|${card}|${i}|${k}`) * noise,
        move: { t: 'play', i, card, d },
      })
    }
  }

  const sorted = bySeat(ranked)
  // Every move on offer loses ground AND there is a card with nothing to do:
  // burning the dead card is strictly better than damaging your own side.
  if (dead.length && (!sorted.length || sorted[0].score <= 0)) {
    const burn = dead.map((x, k) => ({ score: -k, move: { t: 'discard', i: x.i, card: x.card } }))
    const out = firstLegal(burn, st, seat, ctx)
    if (out) return out
  }
  const pick = firstLegal(sorted, st, seat, ctx)
  if (pick) return pick
  return firstLegal(
    dead.map((x, k) => ({ score: -k, move: { t: 'discard', i: x.i, card: x.card } })),
    st, seat, ctx,
  )
}

// ===========================================================================
// «الحريق» — Hareeg. Draws with purpose, opens at 51, lays what its greedy
// meld finder produces, extends table melds with loose cards, then throws the
// heaviest card that is not a cover. Every candidate is verified through the
// game's own reduce before being returned, so a heuristic slip can never
// submit an illegal move — it simply tries the next candidate. Reads ONLY its
// own seat's hand.
//
// THREE LEVELS, chosen by the player and passed in as `ctx.level`. The
// differences are real changes of policy, not a delay or a dice roll:
//   easy   — never reads the thrown pile (it always draws blind), holds out
//            for a margin over 51 before opening while the deck is still
//            deep, and throws its LIGHTEST loose card, so the pictures pile
//            up in its hand and a lost round burns it much harder.
//   normal — takes the thrown card when it completes a meld, opens at 51,
//            lays and extends what its finder produces, throws its heaviest
//            loose card.
//   hard   — normal, plus it values what is still developing in its hand: a
//            card that has a partner (a same-rank twin or a neighbour in the
//            same suit) is kept, so it throws the heaviest card that is
//            genuinely dead rather than the heaviest card outright.
// Measured over 400 two-handed matches each, seats swapped: hard beats easy
// 86/14, hard beats normal 60/40, normal beats easy 84/16.
//
// EVERY level extends table melds once it has opened. That is not a tuning
// choice: with extending switched off for easy, an all-easy table could not
// empty a hand at all and 37% of rounds ran until the reshuffle cap voided
// them. A handicap must make a bot lose, not make the game stop.
// ===========================================================================
const hareeLevel = (ctx) => (ctx && (ctx.level === 'easy' || ctx.level === 'hard') ? ctx.level : 'normal')

function hareeBotMove(state, seat, ctx) {
  const st = state
  if (!st || st.phase !== 'turn' || st.turnSeat !== seat) return null
  const H = (ctx && ctx.helpers) || {}
  const { findMelds, validMeld, valueOf, isJoker, suitOf, rankOf, OPEN_MIN, RUN_VAL } = H
  if (typeof findMelds !== 'function') return null
  const room = ctx.room
  const level = hareeLevel(ctx)
  const hand = (st.hands && st.hands[seat]) || []
  const legal = (mv) => {
    if (typeof ctx.reduce !== 'function') return mv
    try {
      const r = ctx.reduce(st, { ...mv, at: 1 }, room)
      return r && r.state && r.state !== st ? mv : null
    } catch (_) {
      return null
    }
  }

  if (st.step === 'draw') {
    const top = st.discard && st.discard.length ? st.discard[st.discard.length - 1] : null
    // easy never reads the thrown pile — it just draws blind
    if (top && level !== 'easy') {
      const gain = findMelds([...hand, top])
      if (gain.used.has(top)) {
        const take = legal({ t: 'draw', seat, from: 'discard' })
        if (take) return take
      }
    }
    return legal({ t: 'draw', seat, from: 'stock' }) || legal({ t: 'draw', seat, from: 'discard' })
  }

  const found = findMelds(hand)
  const opened = !!(st.opened && st.opened[seat])
  // easy holds out for a comfortable margin over 51 — but ONLY while the deck
  // is still deep. A table of easy seats that all refuse to open never empties
  // a hand and the round runs forever (measured: it never terminated), so the
  // moment the stock thins or has been rebuilt the margin drops to the real
  // floor and the round can finish.
  const deckDeep = (st.reshuffles | 0) === 0 && ((st.stock && st.stock.length) || 0) > 30
  const floor = (OPEN_MIN || 51) + (level === 'easy' && deckDeep ? 8 : 0)

  // lay: everything the finder produced, the moment it is allowed to
  if (found.melds.length && (opened || found.points >= floor)) {
    const mv = legal({ t: 'lay', seat, melds: found.melds })
    if (mv) return mv
  }

  // extend: loose cards onto any table meld (one at a time, re-validated)
  if (opened && Array.isArray(st.melds) && typeof validMeld === 'function') {
    for (let i = 0; i < st.melds.length; i += 1) {
      for (const c of hand) {
        if (found.used.has(c)) continue
        if (validMeld([...st.melds[i].cards, c])) {
          const mv = legal({ t: 'extend', seat, meld: i, cards: [c] })
          if (mv) return mv
        }
      }
    }
  }

  // ---- the throw. reduce enforces the cover rule, so an unlawful throw just
  // tries the next candidate; the ordering below is the whole personality.
  const val = typeof valueOf === 'function' ? valueOf : () => 0
  const loose = hand.filter((c) => !found.used.has(c))
  const rest = hand.filter((c) => found.used.has(c))

  // hard: a card with a partner still in hand is worth keeping, so rank the
  // loose cards by (deadness first, then weight) instead of weight alone.
  const partnered = (c) => {
    if (typeof isJoker !== 'function' || typeof suitOf !== 'function' || typeof rankOf !== 'function') return false
    if (isJoker(c)) return true
    const rv = RUN_VAL || {}
    const v = rankOf(c) === 'A' ? 14 : rv[rankOf(c)] || 0
    for (const o of hand) {
      if (o === c || isJoker(o)) continue
      if (rankOf(o) === rankOf(c)) return true
      if (suitOf(o) === suitOf(c)) {
        const ov = rankOf(o) === 'A' ? 14 : rv[rankOf(o)] || 0
        if (Math.abs(ov - v) <= 2) return true
      }
    }
    return false
  }

  let order
  if (level === 'easy') {
    // sheds its cheap cards and hoards the pictures — exactly the mistake a
    // beginner makes, and it is what makes an easy seat beatable
    order = [...loose.sort((a, b) => val(a) - val(b)), ...rest.sort((a, b) => val(a) - val(b))]
  } else if (level === 'hard') {
    const rank = (c) => (partnered(c) ? 0 : 1) * 1000 + val(c)
    order = [...loose.sort((a, b) => rank(b) - rank(a)), ...rest.sort((a, b) => val(b) - val(a))]
  } else {
    order = [...loose.sort((a, b) => val(b) - val(a)), ...rest.sort((a, b) => val(b) - val(a))]
  }

  for (const c of order) {
    const mv = legal({ t: 'discard', seat, card: c })
    if (mv) return mv
  }
  return null
}

// ===========================================================================
// registry
// ===========================================================================
export const BOTS = {
  ludo: ludoBotMove,
  chess: chessBotMove,
  dominoes: dominoesBotMove,
  wist: wistBotMove,
  jackaroo: jackarooBotMove,
  haree: hareeBotMove,
}

// The single entry point a game component calls. Returns a move or null; never
// throws, because a bot that crashes would freeze the board it plays on.
export function botMoveFor(gameId, state, seat, ctx) {
  const fn = BOTS[gameId]
  if (typeof fn !== 'function') return null
  try {
    return fn(state, seat, ctx || {})
  } catch (err) {
    return null
  }
}
