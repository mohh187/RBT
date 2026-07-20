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
    ar: 'يحسب قيمة القطع بعد نقلته مباشرة، ويترك النقلة التي تُبقي قطعة مكشوفة، ويرى كش مات في نقلة واحدة. هذا حساب مادي بسيط بعمق نقلة واحدة — ليس محرك شطرنج وليس ذكاءً اصطناعياً، ويقع في المصائد التكتيكية.',
    en: 'Counts material after its own move, avoids leaving a piece hanging, and sees mate in one. A one-ply material heuristic — not a chess engine, not AI; it falls for tactics.',
  },
  dominoes: {
    ar: 'يرى أحجاره وحدها ولا يطّلع على أحجار غيره: يتخلّص من الدبل والأحجار الثقيلة مبكراً، ويحاول إبقاء طرف يملك له أحجاراً.',
    en: 'Sees only its own tiles: sheds doubles and heavy tiles early and tries to keep an end it can answer.',
  },
  wist: {
    ar: 'يقدّر عدد أكلاته من يده قبل المزايدة، ويتبع النوع ويقطع بالحكم عند الحاجة، ويوفّر الورقة العالية إذا كان شريكه فائزاً بالأكلة. لا يعدّ الأوراق الملعوبة ولا يرى أوراق غيره.',
    en: 'Estimates its own tricks before bidding, follows suit, ruffs when it must, and saves high cards when its partner is winning. It does not count cards and never sees another hand.',
  },
  jackaroo: {
    ar: 'يجرّب كل حركة تسمح بها ورقته ويختار ما يقدّم فريقه أكثر — الدخول إلى الخانة ثم القتل ثم التقدّم ثم الخروج من البيت. يزن ورقة واحدة فقط ولا يخطّط للجولة القادمة.',
    en: 'Tries every move its card allows and takes the one that advances its side most — lane, kill, progress, release. One card deep, no planning.',
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
// helpers (from Chess.jsx `botHelpers`): legalMoves
//
// Strength claim, defended literally: for each of its own legal moves it runs
// the real reducer, then scores the resulting position by
//     material  −  the worst piece it left hanging  +  a small placement term
// and takes the best. Mate in one is found because the reducer reports it.
// That is ONE ply plus a static hanging-piece scan. It does not see forks,
// pins, skewers, discovered attacks, its opponent's threats beyond a single
// direct capture, or anything about endgames. It will lose to any player who
// knows basic tactics, and it can walk into mate in one.
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

  const list = gen(st)
  if (!list.length) return null

  // Promotions: only the queen is considered. Underpromotion matters in perhaps
  // one game in a thousand and quadruples the branching factor for it.
  const cands = list.filter((m) => !m.promo || m.promo === 'q')
  const use = cands.length ? cands : list

  let best = null
  let bestScore = -Infinity
  for (let i = 0; i < use.length; i += 1) {
    const m = use[i]
    const mv = { type: 'move', from: m.from, to: m.to, promo: m.promo || null, seat }
    let out = null
    try { out = reduce(st, mv, (ctx && ctx.room) || null) } catch (_) { out = null }
    if (!out || !out.state || out.state === st) continue
    const next = out.state

    let sc
    if (next.status !== 'playing') {
      // the reducer already decided: mate for me, or a draw
      if (next.result === mySide) sc = 1e6
      else if (next.result === 'draw') {
        // take a draw only when losing; a draw while ahead is a wasted win
        const diff = chMaterial(st.board, mySide) - chMaterial(st.board, chOther(mySide))
        sc = diff < -200 ? 5e5 : -5e5
      } else sc = -1e6
    } else {
      sc = (chMaterial(next.board, mySide) - chMaterial(next.board, chOther(mySide))) * 10
      sc -= chWorstHanging(next.board, mySide) * 9
      sc += chPlacement(next.board, mySide) - chPlacement(next.board, chOther(mySide))
      if (next.check) sc += 25
      if (m.castle) sc += 90
    }
    sc += jitter(`ch|${next.board}|${m.from}|${m.to}`)
    if (sc > bestScore) { bestScore = sc; best = mv }
  }

  if (best) return best
  // The scan found nothing usable (should be unreachable). Fall back to the
  // safest possible behaviour: a legal move straight from the game's own
  // generator, validated once more by the reducer.
  return firstLegal(list.map((m, i) => ({
    score: -i,
    move: { type: 'move', from: m.from, to: m.to, promo: m.promo || null },
  })), st, seat, ctx)
}

// ===========================================================================
// DOMINOES
//
// No helpers needed: a tile id is `${hi}:${lo}` and the chain is public.
// The bot reads ONLY state.hands[itsOwnSeat] and state.line.
//
// Strength claim: greedy one-ply. It goes out when it can, otherwise it sheds
// weight (doubles first, then heavy tiles) while trying to leave an open end it
// still holds tiles for. It does not track which pips an opponent has passed on
// — the single most valuable read in real dominoes — and it never plays to
// block. Any regular player will beat it more often than not.
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

  const ranked = []
  for (let i = 0; i < hand.length; i += 1) {
    const id = hand[i]
    const rest = hand.filter((x) => x !== id)
    const sides = line.length ? ['L', 'R'] : ['R']
    for (const side of sides) {
      const ends = domEndsAfter(line, id, side)
      let sc = 0
      if (!rest.length) sc += 10000              // out — nothing beats it
      sc += domWeight(id) * 2.2                  // shed weight while you can
      if (domDouble(id)) sc += 14                // a double left in hand is dead weight
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
// helpers (from Wist.jsx `botHelpers`): suitOf, rankVal, trickWinner, team,
// SUITS, MIN_BID, MAX_BID
//
// Strength claim: a hand-evaluation bid and a four-rule card policy (win it
// cheaply / save your high card when your partner already has it / ruff when
// void and losing / throw your cheapest). It does NOT count cards, does not
// signal, does not read the auction for information, and does not know what
// its partner holds. A good Wist player will take it apart; a beginner will
// find it a real game.
// ===========================================================================
const W_HONOUR = { A: 1, K: 0.75, Q: 0.45, J: 0.2 }

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
  const hand = st.hands[seat] || []

  // ---- auction ----
  if (st.phase === 'bid') {
    if (st.bidTurn !== seat || st.bids[seat] === 'pass') return null
    const { est } = wistBestTrump(hand, { ...h, SUITS })
    // The bid is for the PARTNERSHIP, so the partner's average share is added.
    // 2.6 rather than 3.25 because our own strength is concentrated in the suit
    // we are about to name, which is exactly where the partner's is not.
    const side = est + 2.6
    const floor = st.highBid ? st.highBid.n + 1 : MIN_BID
    const want = Math.floor(side)
    const ranked = []
    if (want >= floor && floor <= MAX_BID && want >= MIN_BID) {
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
    const { suit } = wistBestTrump(hand, { ...h, SUITS })
    const ranked = [{ score: 2, move: { t: 'trump', suit } }]
    for (const s of SUITS) if (s !== suit) ranked.push({ score: 1, move: { t: 'trump', suit: s } })
    return firstLegal(ranked, st, seat, ctx)
  }

  if (st.phase !== 'play') return null
  if (st.turnSeat !== seat) return null
  if (!hand.length) return null

  const trump = st.trump
  const teamOf = typeof h.team === 'function' ? h.team : (s) => s % 2
  const opening = st.doneWinner != null || !st.trick || st.trick.length === 0
  const trick = opening ? [] : st.trick

  const rank = (c) => h.rankVal(c)
  const suit = (c) => h.suitOf(c)
  const g = wistSuitGroups(hand, suit)

  // ---- leading ----
  if (!trick.length) {
    const ranked = []
    const myTrumps = g[trump] || []
    for (const c of hand) {
      let sc = 0
      const s = suit(c)
      const r = String(c).charAt(0)
      if (s === trump) {
        // draw trumps only when you hold plenty of them
        sc = myTrumps.length >= 4 ? 300 + rank(c) : 40 + rank(c) * 0.4
      } else if (r === 'A') {
        sc = 400 + (g[s] || []).length * 5      // cash a side ace while it lives
      } else {
        // otherwise open low from length and keep the honours back
        sc = 120 + (g[s] || []).length * 8 - rank(c) * 4
      }
      ranked.push({ score: sc + jitter(`w|l|${c}|${seat}`), move: { t: 'play', card: c } })
    }
    return firstLegal(bySeat(ranked), st, seat, ctx)
  }

  // ---- following ----
  const led = suit(trick[0].card)
  const mine = hand.filter((c) => suit(c) === led)
  const legal = mine.length ? mine : hand

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

  const ranked = legal.map((c) => {
    const s = suit(c)
    let sc
    if (partnerAhead) {
      // partner already holds the trick: throw the cheapest thing that keeps it
      sc = 200 - rank(c) * 6
      if (lastToPlay) sc += 60           // certain — nothing can overtake now
      if (s === trump && bestOnTable && suit(bestOnTable.card) !== trump) sc -= 260 // do not ruff your own side
    } else if (beats(c)) {
      // win it as cheaply as possible
      sc = 500 - rank(c) * 8
      if (s === trump && led !== trump) sc -= 40      // a ruff costs a trump
      if (lastToPlay) sc += 40
    } else {
      // cannot win: shed the least useful card, protecting aces and trumps
      sc = 100 - rank(c) * 3
      if (s === trump) sc -= 140
      if (String(c).charAt(0) === 'A') sc -= 90
      sc -= (g[s] || []).length * 2
    }
    return { score: sc + jitter(`w|f|${c}|${seat}|${trick.length}`), move: { t: 'play', card: c } }
  })

  return firstLegal(bySeat(ranked), st, seat, ctx)
}

// ===========================================================================
// JACKAROO
//
// helpers (from Jackaroo.jsx `botHelpers`): movesForCard, runDescriptor,
// activeOwner, isLane, isTrack, isBase, TRACK, LANE, team
//
// Strength claim: it enumerates every descriptor its own cards allow — through
// the game's own generator, so the enumeration is the rulebook — evaluates each
// resulting board with one number (its side's progress minus the other side's)
// and takes the best. One card deep. It does not hold a King back for a marble
// still in base, does not save a Jack for a good swap, and does not plan the
// seven-split around a future card.
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
  const base = jakTeamValue(st.marbles, myTeam, h) - jakTeamValue(st.marbles, foeTeam, h)

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
      const sc = (jakTeamValue(res.marbles, myTeam, h) - jakTeamValue(res.marbles, foeTeam, h)) - base
      ranked.push({
        score: sc + jitter(`jak|${card}|${i}|${k}`),
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
// registry
// ===========================================================================
export const BOTS = {
  ludo: ludoBotMove,
  chess: chessBotMove,
  dominoes: dominoesBotMove,
  wist: wistBotMove,
  jackaroo: jackarooBotMove,
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
