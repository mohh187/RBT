// Pure computation behind «نشاط الألعاب والتحليل».
//
// Everything here is a plain function over the raw gamePlays / playerProfiles
// rows. No component, no Firestore, no model. Two consequences that matter:
//   • every figure on the page can be traced to a counted row, and
//   • the AI snapshot is built from the SAME functions that render the tables,
//     so the "الأرقام المستخدمة" block can never disagree with the screen.
import { tagRule, derivePlayerTags } from '../../lib/gameMemory.js'

const num = (v, f = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : f
}
const round2 = (n) => Math.round(n * 100) / 100
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)

export const dayStamp = (ms) => (ms ? new Date(num(ms)).toLocaleDateString('en-CA') : '—')
export const clockOf = (ms) => (ms ? new Date(num(ms)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—')
export const dateTime = (ms) => (ms ? `${dayStamp(ms)} ${clockOf(ms)}` : '—')

// Sample-size floors. Below these a figure is LABELLED thin everywhere it
// appears — on screen and inside the AI snapshot. It is never hidden and never
// silently presented as solid.
export const THIN_ANSWERS = 20
export const THIN_PLAYS = 15
export const THIN_PLAYERS = 8

export const maskPhone = (p) => {
  const s = String(p || '')
  return s.length > 6 ? `${s.slice(0, 5)}***${s.slice(-3)}` : s
}

export const shortDevice = (d) => {
  const s = String(d || '')
  return s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s
}

export function playerLabel(row, ar = true) {
  if (row && row.customerName) return row.customerName
  if (row && row.customerPhone) return maskPhone(row.customerPhone)
  return ar ? `مجهول · ${shortDevice(row && row.deviceId)}` : `Anonymous · ${shortDevice(row && row.deviceId)}`
}

// --------------------------------------------------------------------------
// Overview. Durations come ONLY from plays that actually ended — an abandoned
// play has durationMs 0 and would drag the average toward a lie.
// --------------------------------------------------------------------------
export function overview(plays = []) {
  const total = plays.length
  const devices = new Set(plays.map((p) => p.deviceId).filter(Boolean))
  const identified = new Set(plays.filter((p) => p.customerPhone).map((p) => p.deviceId))
  const ended = plays.filter((p) => num(p.durationMs) > 0)
  const completed = plays.filter((p) => p.completed === true)
  const answers = plays.reduce((s, p) => s + (p.answers || []).length, 0)

  return {
    plays: total,
    players: devices.size,
    identifiedPlayers: identified.size,
    anonymousPlayers: Math.max(0, devices.size - identified.size),
    endedPlays: ended.length,
    avgDurationSec: ended.length ? Math.round(ended.reduce((s, p) => s + num(p.durationMs), 0) / ended.length / 1000) : null,
    medianDurationSec: ended.length ? Math.round(median(ended.map((p) => num(p.durationMs))) / 1000) : null,
    completedPlays: completed.length,
    completionRate: total > 0 ? round2(completed.length / total) : null,
    answersRecorded: answers,
    playsPerPlayer: devices.size > 0 ? round2(total / devices.size) : null,
    thin: total < THIN_PLAYS,
  }
}

function median(list) {
  const s = [...list].sort((a, b) => a - b)
  if (!s.length) return 0
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Most-played games, with the completion rate and best score of each.
export function gameStats(plays = []) {
  const map = new Map()
  for (const p of plays) {
    const id = p.gameId || 'unknown'
    const g = map.get(id) || { gameId: id, gameAr: p.gameAr || id, kind: p.kind || 'arcade', plays: 0, completed: 0, best: 0, durSum: 0, durN: 0, devices: new Set() }
    g.plays += 1
    if (p.completed === true) g.completed += 1
    g.best = Math.max(g.best, num(p.score))
    if (num(p.durationMs) > 0) { g.durSum += num(p.durationMs); g.durN += 1 }
    if (p.deviceId) g.devices.add(p.deviceId)
    if (p.gameAr) g.gameAr = p.gameAr
    map.set(id, g)
  }
  return [...map.values()]
    .map((g) => ({
      gameId: g.gameId,
      gameAr: g.gameAr,
      kind: g.kind,
      plays: g.plays,
      players: g.devices.size,
      completed: g.completed,
      completionRate: g.plays > 0 ? round2(g.completed / g.plays) : null,
      best: g.best,
      avgDurationSec: g.durN ? Math.round(g.durSum / g.durN / 1000) : null,
      thin: g.plays < THIN_PLAYS,
    }))
    .sort((a, b) => b.plays - a.plays)
}

// --------------------------------------------------------------------------
// Quiz accuracy by category. Only answers carrying a real true/false verdict
// are counted — an insight answer (correct === null) has no right answer and is
// excluded from accuracy entirely.
// --------------------------------------------------------------------------
export function quizAccuracy(plays = []) {
  const map = new Map()
  let answered = 0
  let correct = 0
  for (const p of plays) {
    for (const a of (p.answers || [])) {
      if (a.correct !== true && a.correct !== false) continue
      const cat = String(a.cat || p.gameAr || p.gameId || 'عام')
      const c = map.get(cat) || { cat, answered: 0, correct: 0 }
      c.answered += 1
      if (a.correct === true) c.correct += 1
      map.set(cat, c)
      answered += 1
      if (a.correct === true) correct += 1
    }
  }
  const rows = [...map.values()]
    .map((c) => ({ ...c, accuracy: c.answered > 0 ? round2(c.correct / c.answered) : null, thin: c.answered < THIN_ANSWERS }))
    .sort((a, b) => b.answered - a.answered)
  return {
    rows,
    answered,
    correct,
    accuracy: answered > 0 ? round2(correct / answered) : null,
    thin: answered < THIN_ANSWERS,
  }
}

// The hardest questions actually asked, by miss rate. Needs at least 5 attempts
// on a question before it can be called "hard" at all.
export function hardestQuestions(plays = [], min = 5) {
  const map = new Map()
  for (const p of plays) {
    for (const a of (p.answers || [])) {
      if (a.correct !== true && a.correct !== false) continue
      const key = a.qId || a.q
      if (!key) continue
      const q = map.get(key) || { key, q: a.q || key, game: p.gameAr || p.gameId, asked: 0, missed: 0 }
      q.asked += 1
      if (a.correct === false) q.missed += 1
      map.set(key, q)
    }
  }
  return [...map.values()]
    .filter((q) => q.asked >= min)
    .map((q) => ({ ...q, missRate: round2(q.missed / q.asked) }))
    .sort((a, b) => b.missRate - a.missRate || b.asked - a.asked)
    .slice(0, 10)
}

// Distribution of insight archetypes across players who produced one.
export function archetypeSpread(profiles = []) {
  const map = new Map()
  for (const p of profiles) {
    const a = p.insight && p.insight.archetype
    if (!a) continue
    map.set(a, (map.get(a) || 0) + 1)
  }
  const total = [...map.values()].reduce((s, n) => s + n, 0)
  return {
    total,
    thin: total < THIN_PLAYERS,
    rows: [...map.entries()]
      .map(([archetype, count]) => ({ archetype, count, share: total > 0 ? round2(count / total) : 0 }))
      .sort((a, b) => b.count - a.count),
  }
}

// --------------------------------------------------------------------------
// Player rows. Profiles are the rollup, but a venue whose rules blocked the
// profile write (or whose players finished before this feature shipped) still
// has raw plays — so rows are rebuilt from plays and ENRICHED by profiles,
// never the other way round. The page therefore works with zero profile docs.
// --------------------------------------------------------------------------
export function playersFrom(plays = [], profiles = []) {
  const byDevice = new Map()
  for (const p of plays) {
    if (!p.deviceId) continue
    const r = byDevice.get(p.deviceId) || {
      deviceId: p.deviceId, customerPhone: null, customerName: null,
      firstAt: 0, lastAt: 0, totalPlays: 0, completedPlays: 0, totalScore: 0,
      byGame: {}, insight: null, knowledge: { answered: 0, correct: 0, byCat: {} },
      plays: [], hasProfile: false, tags: [],
    }
    if (p.customerPhone) r.customerPhone = p.customerPhone
    if (p.customerName) r.customerName = p.customerName
    const started = num(p.startedAt)
    const ended = num(p.endedAt) || started
    r.firstAt = r.firstAt ? Math.min(r.firstAt, started) : started
    r.lastAt = Math.max(r.lastAt, ended)
    r.totalPlays += 1
    if (p.completed === true) r.completedPlays += 1
    r.totalScore += num(p.score)

    const g = r.byGame[p.gameId] || { plays: 0, best: 0, lastAt: 0, stage: 0, gameAr: p.gameAr || p.gameId }
    g.plays += 1
    g.best = Math.max(g.best, num(p.score))
    g.lastAt = Math.max(g.lastAt, ended)
    g.stage = Math.max(g.stage, num(p.stage))
    if (p.gameAr) g.gameAr = p.gameAr
    r.byGame[p.gameId] = g

    for (const a of (p.answers || [])) {
      if (a.correct !== true && a.correct !== false) continue
      const cat = String(a.cat || p.gameAr || p.gameId || 'عام')
      const c = r.knowledge.byCat[cat] || { answered: 0, correct: 0 }
      c.answered += 1
      if (a.correct === true) c.correct += 1
      r.knowledge.byCat[cat] = c
      r.knowledge.answered += 1
      if (a.correct === true) r.knowledge.correct += 1
    }
    if (p.result && p.result.archetype) {
      if (!r.insight || ended >= num(r.insight.updatedAt)) {
        r.insight = { archetype: p.result.archetype, traits: p.result.traits || {}, summary: p.result.summary || '', updatedAt: ended }
      }
    }
    r.plays.push(p)
    byDevice.set(p.deviceId, r)
  }

  // Profiles supply tags and can carry history older than the fetched window.
  const profById = new Map(profiles.map((p) => [p.deviceId || p.id, p]))
  for (const [deviceId, r] of byDevice) {
    const prof = profById.get(deviceId)
    if (!prof) continue
    r.hasProfile = true
    r.tags = Array.isArray(prof.tags) ? prof.tags : []
    r.customerPhone = r.customerPhone || prof.customerPhone || null
    r.customerName = r.customerName || prof.customerName || null
    r.profileTotalPlays = num(prof.totalPlays)
    r.profileFirstAt = num(prof.firstAt)
  }
  // A profile with no play in the window is still a real player — surface it,
  // flagged, rather than pretending it does not exist.
  for (const prof of profiles) {
    const id = prof.deviceId || prof.id
    if (!id || byDevice.has(id)) continue
    byDevice.set(id, {
      deviceId: id,
      customerPhone: prof.customerPhone || null,
      customerName: prof.customerName || null,
      firstAt: num(prof.firstAt), lastAt: num(prof.lastAt),
      totalPlays: num(prof.totalPlays), completedPlays: num(prof.completedPlays),
      totalScore: num(prof.totalScore),
      byGame: prof.byGame || {}, insight: prof.insight || null,
      knowledge: prof.knowledge || { answered: 0, correct: 0, byCat: {} },
      plays: [], hasProfile: true, outsideWindow: true,
      tags: Array.isArray(prof.tags) ? prof.tags : [],
    })
  }

  return [...byDevice.values()]
    .map((r) => ({
      ...r,
      plays: r.plays.sort((a, b) => num(b.startedAt) - num(a.startedAt)),
      bestScore: Math.max(0, ...Object.values(r.byGame).map((g) => num(g.best)), 0),
      gamesTried: Object.keys(r.byGame).length,
      accuracy: r.knowledge.answered > 0 ? round2(r.knowledge.correct / r.knowledge.answered) : null,
      completionRate: r.totalPlays > 0 ? round2(r.completedPlays / r.totalPlays) : null,
      // A venue whose profile writes were blocked still gets tags: the SAME
      // rule function runs over the rebuilt row, so the label means exactly
      // what it means everywhere else.
      tags: (r.tags && r.tags.length) ? r.tags : derivePlayerTags(r),
    }))
    .sort((a, b) => num(b.lastAt) - num(a.lastAt))
}

// --------------------------------------------------------------------------
// Segments. Each one is a REAL list of devices resolved to REAL phone numbers.
// `why` states the exact rule, so a manager can argue with it. Nothing here
// involves a model, and each segment stands on its own without the AI tab.
// --------------------------------------------------------------------------
const DAY = 24 * 60 * 60 * 1000

export function buildSegments(players = [], customers = []) {
  // Phones that have actually ordered, so "played but never ordered" is a fact
  // and not an assumption.
  const ordered = new Set(
    customers.filter((c) => num(c.totalOrders) > 0).map((c) => String(c.phone || '')).filter(Boolean),
  )

  const defs = [
    {
      id: 'curious-no-order',
      ar: 'فضوليون: أنهوا اختبار الشخصية ولم يطلبوا',
      why: 'أنهى الضيف لعبة من نوع «insight» ووصل إلى نتيجة، ولا يوجد له أي طلب مسجّل في سجل العملاء.',
      test: (p) => Boolean(p.insight) && !ordered.has(String(p.customerPhone || '')),
    },
    {
      id: 'competitive',
      ar: 'منافسون: أعادوا اللعبة 3 مرات فأكثر',
      why: 'لعب الضيف لعبة واحدة بعينها 3 مرات أو أكثر — إعادة المحاولة سلوك تنافسي مقيس، لا تخمين.',
      test: (p) => Object.values(p.byGame || {}).some((g) => num(g.plays) >= 3),
    },
    {
      id: 'unfinished',
      ar: 'توقفوا في المنتصف',
      why: 'للضيف محاولة واحدة على الأقل تجاوزت المرحلة الأولى ولم تُكمَل — أي بدأ فعلاً ثم انسحب.',
      test: (p) => (p.plays || []).some((x) => x.completed !== true && num(x.stage) > 0),
    },
    {
      id: 'quiz-strong',
      ar: 'أقوياء في الأسئلة',
      why: `أجاب ${THIN_ANSWERS} سؤالاً فأكثر (أسئلة لها إجابة صحيحة) بنسبة صحة 75% فما فوق.`,
      test: (p) => num(p.knowledge && p.knowledge.answered) >= THIN_ANSWERS && num(p.accuracy) >= 0.75,
    },
    {
      id: 'quiz-weak',
      ar: 'يحتاجون تلميحات',
      why: `أجاب ${THIN_ANSWERS} سؤالاً فأكثر بنسبة صحة 40% فما دون — فرصة لمحتوى تعريفي بالقائمة.`,
      test: (p) => num(p.knowledge && p.knowledge.answered) >= THIN_ANSWERS && p.accuracy != null && num(p.accuracy) <= 0.4,
    },
    {
      id: 'returning',
      ar: 'عائدون',
      why: 'بين أول وآخر لعبة للضيف 7 أيام أو أكثر، وله 3 محاولات فأكثر — أي عاد للمكان فعلياً.',
      test: (p) => num(p.totalPlays) >= 3 && num(p.lastAt) - num(p.firstAt) >= 7 * DAY,
    },
    {
      id: 'one-and-done',
      ar: 'لعبوا مرة واحدة ولم يعودوا',
      why: 'محاولة واحدة فقط، وآخر نشاط قبل 14 يوماً أو أكثر.',
      test: (p) => num(p.totalPlays) === 1 && Date.now() - num(p.lastAt) >= 14 * DAY,
    },
  ]

  return defs.map((d) => {
    const members = players.filter((p) => {
      try { return d.test(p) } catch (_) { return false }
    })
    const seen = new Set()
    const phones = []
    let anonymousDevices = 0
    for (const m of members) {
      const ph = String(m.customerPhone || '')
      if (!ph) { anonymousDevices += 1; continue }
      if (seen.has(ph)) continue
      seen.add(ph)
      phones.push({ phone: ph, name: m.customerName || '' })
    }
    return {
      id: d.id,
      ar: d.ar,
      why: d.why,
      playerCount: members.length,
      deviceIds: members.map((m) => m.deviceId),
      phones,
      anonymousDevices,
      thin: members.length < THIN_PLAYERS,
    }
  }).filter((s) => s.playerCount > 0)
}

// --------------------------------------------------------------------------
// Findings that are true with or without a model. Each carries its own sample
// size, and none of them fires on a sample too small to mean anything.
// --------------------------------------------------------------------------
export function ruleFindings({ over, games = [], quiz, hard = [], segments = [], players = [] }) {
  const out = []
  if (!over || !over.plays) return out

  if (over.plays < THIN_PLAYS) {
    out.push({
      key: 'thin', tone: 'warn', sample: over.plays,
      title: 'العينة ما زالت صغيرة',
      body: `عدد المحاولات المسجّلة ${over.plays} فقط. أي نسبة على هذه الصفحة قابلة للانقلاب بمحاولات قليلة قادمة، فلا تُبنَ عليها قرارات نهائية بعد.`,
    })
  }

  if (over.completionRate != null && over.plays >= THIN_PLAYS && over.completionRate < 0.4) {
    out.push({
      key: 'low-completion', tone: 'bad', sample: over.plays,
      title: 'أغلب الضيوف لا يُنهون اللعبة',
      body: `أُنهيت ${over.completedPlays} محاولة من ${over.plays}، أي ${pct(over.completedPlays, over.plays)}%. اللعبة إما طويلة أو صعبة أو غير واضحة البداية.`,
    })
  }

  const weakGame = games.filter((g) => !g.thin && g.completionRate != null && g.completionRate < 0.3).sort((a, b) => a.completionRate - b.completionRate)[0]
  if (weakGame) {
    out.push({
      key: `weak-${weakGame.gameId}`, tone: 'bad', sample: weakGame.plays,
      title: `«${weakGame.gameAr}» تُترك قبل نهايتها`,
      body: `${pct(weakGame.completed, weakGame.plays)}% فقط من ${weakGame.plays} محاولة وصلت للنهاية. راجع صعوبتها أو طولها قبل الترويج لها.`,
    })
  }

  const topGame = games[0]
  if (topGame && games.length > 1 && topGame.plays >= THIN_PLAYS) {
    out.push({
      key: 'top-game', tone: 'good', sample: topGame.plays,
      title: `«${topGame.gameAr}» هي الأكثر لعباً`,
      body: `${topGame.plays} محاولة من ${topGame.players} لاعباً. هي المرشّحة لأي مسابقة أو جائزة داخل المكان.`,
    })
  }

  if (quiz && quiz.answered >= THIN_ANSWERS) {
    const worst = quiz.rows.filter((r) => !r.thin).sort((a, b) => num(a.accuracy) - num(b.accuracy))[0]
    if (worst && num(worst.accuracy) < 0.5) {
      out.push({
        key: `weak-cat-${worst.cat}`, tone: 'warn', sample: worst.answered,
        title: `ضعف واضح في «${worst.cat}»`,
        body: `${worst.correct} إجابة صحيحة من ${worst.answered}، أي ${pct(worst.correct, worst.answered)}%. إن كان التصنيف عن قائمتك، فالضيوف لا يعرفونها كما تظن.`,
      })
    }
  }

  if (hard.length) {
    const h = hard[0]
    out.push({
      key: 'hardest-q', tone: 'neutral', sample: h.asked,
      title: 'أصعب سؤال فعلياً',
      body: `«${h.q}» أُخطئ فيه ${h.missed} مرة من ${h.asked} محاولة (${pct(h.missed, h.asked)}%).`,
    })
  }

  const anon = over.anonymousPlayers
  if (over.players >= THIN_PLAYERS && anon / over.players > 0.6) {
    out.push({
      key: 'anon', tone: 'warn', sample: over.players,
      title: 'أغلب اللاعبين مجهولون',
      body: `${anon} لاعباً من ${over.players} بلا رقم جوال، أي ${pct(anon, over.players)}%. هؤلاء لا يمكن مراسلتهم مهما كانت نتائجهم — اطلب الاسم أو الرقم قبل عرض النتيجة.`,
    })
  }

  const curious = segments.find((s) => s.id === 'curious-no-order')
  if (curious && curious.phones.length > 0) {
    out.push({
      key: 'curious', tone: 'good', sample: curious.playerCount,
      title: 'فضوليون لم يطلبوا بعد',
      body: `${curious.playerCount} ضيفاً أنهوا اختبار الشخصية ولا طلب لهم، منهم ${curious.phones.length} يمكن مراسلتهم فعلاً.`,
    })
  }

  const repeat = players.filter((p) => num(p.totalPlays) >= 2).length
  if (over.players >= THIN_PLAYERS) {
    out.push({
      key: 'repeat', tone: repeat / over.players >= 0.3 ? 'good' : 'neutral', sample: over.players,
      title: 'نسبة من عاد للعب مرة ثانية',
      body: `${repeat} لاعباً من ${over.players} لعبوا أكثر من مرة، أي ${pct(repeat, over.players)}%.`,
    })
  }

  return out
}

// --------------------------------------------------------------------------
// The venue-level AI snapshot: the ONLY thing sent to a model. Built from the
// functions above so it always matches the rendered page.
// --------------------------------------------------------------------------
export function venueAiSnapshot({ over, games = [], quiz, hard = [], archetypes, segments = [], periodLabel = '', venue = '' }) {
  return {
    venue: venue || null,
    period: periodLabel || null,
    sampleSize: { plays: over ? over.plays : 0, players: over ? over.players : 0, scoredAnswers: quiz ? quiz.answered : 0 },
    thinSample: !over || over.plays < THIN_PLAYS,
    overview: over ? {
      plays: over.plays,
      players: over.players,
      identifiedPlayers: over.identifiedPlayers,
      anonymousPlayers: over.anonymousPlayers,
      avgDurationSec: over.avgDurationSec,
      medianDurationSec: over.medianDurationSec,
      completedPlays: over.completedPlays,
      completionRate: over.completionRate,
      playsPerPlayer: over.playsPerPlayer,
    } : null,
    games: games.slice(0, 12).map((g) => ({
      gameAr: g.gameAr, kind: g.kind, plays: g.plays, players: g.players,
      completionRate: g.completionRate, avgDurationSec: g.avgDurationSec,
      bestScore: g.best, thinSample: g.thin,
    })),
    quiz: quiz ? {
      scoredAnswers: quiz.answered, correct: quiz.correct, accuracy: quiz.accuracy, thinSample: quiz.thin,
      byCategory: quiz.rows.slice(0, 12).map((r) => ({
        cat: r.cat, answered: r.answered, correct: r.correct, accuracy: r.accuracy, thinSample: r.thin,
      })),
    } : null,
    hardestQuestions: hard.slice(0, 6).map((h) => ({ q: h.q, asked: h.asked, missed: h.missed, missRate: h.missRate })),
    archetypes: archetypes ? {
      basis: 'self-report answers inside a menu mini-game, not a psychological assessment',
      totalPlayersWithResult: archetypes.total,
      thinSample: archetypes.thin,
      spread: archetypes.rows.slice(0, 10),
    } : null,
    availableAudiences: segments.map((s) => ({
      segmentId: s.id, label: s.ar, rule: s.why,
      players: s.playerCount, reachablePhones: s.phones.length,
      unreachableAnonymous: s.anonymousDevices, thinSample: s.thin,
    })),
  }
}

// The prompt. The snapshot is embedded verbatim under the guard, and the model
// is told in the contract that it may only NAME a segmentId that already exists
// — it never receives or emits a phone number.
export function buildPlayPrompt(guard, snapshot, question) {
  return [
    guard,
    '',
    'عقد الإخراج:',
    '- اكتب تحليلاً نصياً موجزاً بالعربية.',
    '- إذا اقترحت حملة، اذكر في آخر ردك سطراً منفصلاً بالشكل: SEGMENT: <segmentId> حيث يكون segmentId واحداً من availableAudiences المرفقة حرفياً، ولا شيء غيرها.',
    '- ممنوع ذكر أي رقم جوال أو اسم ضيف. قائمة الجمهور يبنيها النظام لا أنت.',
    '',
    'اللقطة (كل الأرقام المتاحة لك):',
    JSON.stringify(snapshot),
    '',
    `سؤال المدير: ${String(question || '').slice(0, 600)}`,
  ].join('\n')
}

// Pull the segment reference out of a reply. Anything that is not an EXACT
// known segmentId is rejected and reported, never silently accepted.
export function parsePlayReply(reply, segments = []) {
  const text = String(reply || '').trim()
  const rejected = []
  let segment = null
  const m = text.match(/SEGMENT:\s*([A-Za-z0-9_-]+)/)
  if (m) {
    const hit = segments.find((s) => s.id === m[1])
    if (hit) segment = hit
    else rejected.push(`شريحة غير معروفة: ${m[1]}`)
  }
  return { text: text.replace(/SEGMENT:\s*[A-Za-z0-9_-]+/g, '').trim(), segment, rejected }
}

// Re-exported so components import one module for both the numbers and the
// human-readable rule behind a tag.
export { tagRule }
