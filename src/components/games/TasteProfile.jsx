// «ذوقك يحكي عنك» — a two-chapter taste-and-preference read.
//
// CHAPTER 1 «من الطاولة» is built from this venue's REAL menu: either/or picks
// between two actual items, scored by the auditable trait mapping in
// insightEngine.js. CHAPTER 2 «من طبعك» is an ORIGINAL either/or bank authored
// here — preference contrasts (not menu) that add a second dimension of signal.
// Chapter + answers + path variant persist through onProgress/resumeState, and
// «العب بمسار مختلف» reshuffles the pairs and the contrasts you meet.
//
// HONESTY: chapter 1 is nothing but real items and the correlational mapping —
// never invented. If the menu is too thin to build honest contrasting pairs,
// the menu chapter is skipped and the read is drawn from the preference chapter
// alone, and the screen SAYS so rather than faking rounds.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { play } from '../../lib/gameSounds.js'
import '../../styles/insightgames.css'
import {
  INSIGHT_DISCLAIMER_AR,
  INSIGHT_DISCLAIMER_EN,
  MIN_TASTE_ITEMS,
  TRAITS,
  arNum,
  archetypeCopy,
  buildTastePairs,
  itemName,
  recommendItems,
  scoreProfile,
  traitById,
} from '../../lib/insightEngine.js'
import { lex } from '../../lib/venueTypes.js'

// ===========================================================================
// SHARED INSIGHT KIT (inlined — these three games own no separate module).
// Original SVG artwork: an archetype "seal" emblem + a live radar, plus a
// bipolar meter and a seeded path shuffler. SVG traps avoided: unitless
// attribute transforms only, no filter="url(#..)", and the update "pulse" runs
// on the HTML wrapper (.ig-pulse), never on an SVG child.
// ===========================================================================
const IG_GOLD = '#d8b366'
const IG_GOLD_B = '#f0d79a'
const IG_GOLD_D = '#a97f34'
const IG_CREAM = '#f4e9d2'

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n)

function igHash(str) {
  let h = 0x811c9dc5
  const s = String(str)
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15
  return h >>> 0
}

function seededOrder(n, seed) {
  const idx = Array.from({ length: n }, (_, i) => i)
  let s = (igHash(String(seed)) >>> 0) || 1
  const rnd = () => {
    s = (s + 0x6D2B79F5) | 0
    let x = Math.imul(s ^ (s >>> 15), 1 | s)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  for (let i = n - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp }
  return idx
}

function igPoly(cx, cy, r, sides, rotDeg) {
  const off = (rotDeg * Math.PI) / 180 - Math.PI / 2
  const p = []
  for (let i = 0; i < sides; i += 1) { const a = off + (Math.PI * 2 * i) / sides; p.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`) }
  return p.join(' ')
}
function igStar(cx, cy, rO, rI, spikes) {
  const p = []
  for (let i = 0; i < spikes * 2; i += 1) { const r = i % 2 === 0 ? rO : rI; const a = (Math.PI / spikes) * i - Math.PI / 2; p.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`) }
  return p.join(' ')
}

function Emblem({ id, brand = '#0e7490', uid = 'e' }) {
  const seed = igHash(id || 'x')
  const petals = 6 + (seed % 7)
  const sides = 3 + ((seed >> 3) % 6)
  const rot = (seed % 12) * 5
  const center = (seed >> 6) % 4
  const tint = (seed >> 9) % 3
  const petA = tint === 1 ? brand : tint === 2 ? IG_CREAM : IG_GOLD
  const petB = tint === 1 ? IG_GOLD : brand
  const outer = []
  const inner = []
  for (let i = 0; i < petals; i += 1) {
    const a = (360 / petals) * i + rot
    outer.push(<ellipse key={`o${i}`} cx="60" cy="21" rx="5" ry="12.5" fill={i % 2 ? petB : petA} stroke={IG_GOLD_D} strokeWidth="0.6" opacity={i % 2 ? 0.9 : 0.96} transform={`rotate(${a} 60 60)`} />)
    const b = (360 / petals) * i + rot + 180 / petals
    inner.push(<ellipse key={`i${i}`} cx="60" cy="34" rx="3.2" ry="7.5" fill={IG_GOLD} opacity="0.72" transform={`rotate(${b} 60 60)`} />)
  }
  let motif
  if (center === 0) motif = <g fill="none" stroke={IG_GOLD_B} strokeWidth="1.1"><circle cx="60" cy="60" r="4" /><circle cx="60" cy="60" r="8" /><circle cx="60" cy="60" r="12" opacity="0.65" /></g>
  else if (center === 1) motif = <polygon points={igStar(60, 60, 12, 5, 8)} fill={IG_GOLD_B} />
  else if (center === 2) motif = <g fill={IG_GOLD_B}><polygon points={igPoly(60, 60, 11, 4, 0)} /><circle cx="60" cy="60" r="3" fill={brand} /></g>
  else motif = <g><circle cx="60" cy="60" r="9" fill="none" stroke={IG_GOLD_B} strokeWidth="1.2" /><circle cx="60" cy="60" r="3.4" fill={IG_GOLD_B} /></g>
  return (
    <svg viewBox="0 0 120 120" width="100%" height="100%" role="img" aria-hidden="true">
      <defs>
        <radialGradient id={`${uid}d`} cx="50%" cy="38%" r="66%">
          <stop offset="0%" stopColor="rgba(216,179,102,0.3)" />
          <stop offset="58%" stopColor="#1b120a" />
          <stop offset="100%" stopColor="#0c0704" />
        </radialGradient>
        <radialGradient id={`${uid}c`} cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor={IG_GOLD_B} stopOpacity="0.4" />
          <stop offset="62%" stopColor={brand} />
          <stop offset="100%" stopColor="#0c0704" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="57" fill={`url(#${uid}d)`} stroke={IG_GOLD} strokeWidth="1.6" />
      <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="2" />
      <circle cx="60" cy="60" r="50" fill="none" stroke={IG_GOLD} strokeWidth="0.8" opacity="0.6" />
      {outer}
      {inner}
      <polygon points={igPoly(60, 60, 21, sides, rot)} fill={`url(#${uid}c)`} stroke={IG_GOLD} strokeWidth="1.2" />
      <polygon points={igPoly(60, 60, 21, sides, rot)} fill="none" stroke={IG_GOLD_B} strokeWidth="0.5" opacity="0.5" />
      {motif}
    </svg>
  )
}

function Radar({ traits, axes, brand = '#0e7490', uid = 'r' }) {
  const N = axes.length
  const C = 60
  const R = 40
  const at = (i, v) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / N
    const r = 6 + clamp01(v) * (R - 6)
    return [C + Math.cos(a) * r, C + Math.sin(a) * r]
  }
  const ring = (f) => axes.map((_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / N
    const r = 6 + f * (R - 6)
    return `${(C + Math.cos(a) * r).toFixed(1)},${(C + Math.sin(a) * r).toFixed(1)}`
  }).join(' ')
  const data = axes.map((ax, i) => at(i, traits[ax.id] ?? 0.5))
  return (
    <svg viewBox="0 0 120 120" width="100%" height="100%" role="img" aria-hidden="true">
      <defs>
        <radialGradient id={`${uid}g`} cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor={brand} stopOpacity="0.55" />
          <stop offset="100%" stopColor={brand} stopOpacity="0.14" />
        </radialGradient>
      </defs>
      <g fill="none" stroke="rgba(216,179,102,0.22)" strokeWidth="0.7">
        {[0.34, 0.67, 1].map((f) => <polygon key={f} points={ring(f)} />)}
        {axes.map((_, i) => { const [x, y] = at(i, 1.08); return <line key={i} x1="60" y1="60" x2={x.toFixed(1)} y2={y.toFixed(1)} /> })}
      </g>
      <polygon points={data.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill={`url(#${uid}g)`} stroke={brand} strokeWidth="1.6" strokeLinejoin="round" />
      {data.map(([x, y], i) => <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="2.1" fill={IG_GOLD_B} />)}
    </svg>
  )
}

function Meter({ tr, v, conf, ar, lowConfText }) {
  const val = clamp01(v)
  const left = Math.min(val, 0.5) * 100
  const w = Math.max(2, Math.abs(val - 0.5) * 100)
  return (
    <div className={`ig-meter${conf < 0.3 ? ' low-conf' : ''}`}>
      <div className="ig-meter-top">
        <span className="ig-meter-nm">{ar ? tr.ar : tr.en}</span>
        <span className="ig-meter-val">{conf < 0.3 ? lowConfText : `${arNum(Math.round(val * 100))}%`}</span>
      </div>
      <div className="ig-meter-track"><span className="ig-meter-fill" style={{ insetInlineStart: `${left}%`, width: `${w}%` }} /></div>
      <div className="ig-meter-poles"><span>{tr.low}</span><span>{tr.high}</span></div>
    </div>
  )
}

const STATE_V = 2
const PER_ROUND = 13
const CHAPTER_BONUS = 25
const FINISH_BONUS = 45
const PAIRS_TARGET = 12
const CH1_LEN = 6
const CH2_LEN = 5

// ---------------------------------------------------------------------------
// CHAPTER 2 — original authored either/or bank «من طبعك».
// Preference contrasts (NOT menu items). Each side carries signed loadings.
// ---------------------------------------------------------------------------
const CH2_BANK = [
  {
    id: 'tp2-seat',
    a: { label: 'طاولة في زاوية هادئة', icon: 'eye', loadings: { extraversion: -0.6, openness: 0.2 } },
    b: { label: 'طاولة في قلب الحركة', icon: 'sparkles', loadings: { extraversion: 0.6, novelty: 0.2 } },
  },
  {
    id: 'tp2-plan',
    a: { label: 'أخطّط رحلتي بالتفصيل', icon: 'clock', loadings: { conscientiousness: 0.6, analysis: 0.3, novelty: -0.2 } },
    b: { label: 'أترك مساحة للمفاجأة', icon: 'star', loadings: { novelty: 0.6, openness: 0.3, conscientiousness: -0.2 } },
  },
  {
    id: 'tp2-try',
    a: { label: 'أطلب المضمون الذي أحبّه', icon: 'heart', loadings: { novelty: -0.7, conscientiousness: 0.2 } },
    b: { label: 'أجرّب الجديد في كل مرة', icon: 'sparkles', loadings: { novelty: 0.7, openness: 0.4 } },
  },
  {
    id: 'tp2-decide',
    a: { label: 'أقرّر بعد مقارنة وتمعّن', icon: 'chartBar', loadings: { analysis: 0.7, conscientiousness: 0.2 } },
    b: { label: 'أقرّر بالإحساس بسرعة', icon: 'star', loadings: { analysis: -0.7, novelty: 0.3 } },
  },
  {
    id: 'tp2-weekend',
    a: { label: 'عطلة مع الناس والحركة', icon: 'customers', loadings: { extraversion: 0.7, agreeableness: 0.3 } },
    b: { label: 'عطلة هادئة على راحتي', icon: 'eye', loadings: { extraversion: -0.7, openness: 0.2 } },
  },
  {
    id: 'tp2-detail',
    a: { label: 'تجذبني التفاصيل والطبقات', icon: 'sparkles', loadings: { openness: 0.6, analysis: 0.3 } },
    b: { label: 'أحبّ البساطة والوضوح', icon: 'check', loadings: { openness: -0.5, conscientiousness: 0.2 } },
  },
]

const TXT = {
  ar: {
    title: 'ذوقك يحكي عنك',
    how: (items) => `فصلان: أولاً اختيارات بين صنفين من ${items} الحقيقية هنا، ثم بين ميلين في طبعك. لا توجد إجابة صحيحة، فنحن نقرأ الميل لا المعرفة.`,
    howThin: 'المنيو لا يكفي لفصل الذوق، ولنكن صريحين: نقرأ من فصل الميول وحده.',
    ch1: 'من الطاولة', ch2: 'من طبعك',
    chLine: (n, total, name) => `الفصل ${arNum(n)} من ${arNum(total)} · ${name}`,
    preview1: 'الفصل الأول: صنفان من المنيو.',
    preview2: 'الفصل الثاني: ميلان في طبعك.',
    thinChip: 'المنيو قصير: فصل واحد',
    start: 'ابدأ', resume: 'أكمل من حيث توقفت', restart: 'من البداية',
    pick: 'أيّهما تختار الآن؟', or: 'أو',
    live: 'قراءة حيّة', clearest: 'أوضح ميل الآن', forming: 'يتشكّل…',
    beatK: 'اكتمل فصل الطاولة', beatT: 'من طبعك', beatS: 'الآن نترك المنيو ونقرأ ميولك مباشرة، وهنا تكتمل الصورة.', beatBtn: 'تابع',
    yourType: 'نمطك', fit: (n) => `تطابق ${arNum(n)}%`,
    strengths: 'ما تجيده', blind: 'النقطة العمياء', inPlace: 'أنت هنا',
    checks: 'ثلاثة أشياء تحقّق منها بنفسك',
    checksNote: 'هذه ميول شائعة لمن يشبه نتيجتك، لا حقائق مؤكدة عنك.',
    axes: 'محاور شخصيتك', lowConf: 'إشارة ضعيفة',
    recs: 'مبني على اختياراتك', again: 'العب بمسار مختلف', done: 'إنهاء',
    share: 'انسخ النتيجة', shared: 'تم النسخ', cardLine: 'نتيجتي في اختبار الذوق',
    thinTitle: 'لا يمكن قراءة الذوق من المنيو',
    thin: (items, n) => `تحتاج قراءة الذوق إلى ${items} أكثر تنوعاً: على الأقل ${arNum(n)} أصناف مختلفة الطابع. لكن يمكنك خوض فصل الميول للحصول على قراءة.`,
  },
  en: {
    title: 'Your Taste, Read',
    how: () => 'Two chapters: first either/or picks from this venue\'s real menu, then between two leanings in you. There is no right answer: we read leaning, not knowledge.',
    howThin: 'The menu is too thin for a taste chapter, so, honestly, we read from the preference chapter alone.',
    ch1: 'From the table', ch2: 'From your nature',
    chLine: (n, total, name) => `Chapter ${n} of ${total} · ${name}`,
    preview1: 'Chapter one: two items from the menu.',
    preview2: 'Chapter two: two leanings in you.',
    thinChip: 'Short menu: one chapter',
    start: 'Start', resume: 'Resume', restart: 'Start over',
    pick: 'Which one, right now?', or: 'or',
    live: 'Live reading', clearest: 'Clearest leaning', forming: 'forming…',
    beatK: 'The table chapter is done', beatT: 'From your nature', beatS: 'Now we leave the menu and read your leanings directly, and that completes the picture.', beatBtn: 'Continue',
    yourType: 'Your type', fit: (n) => `${n}% match`,
    strengths: 'Strengths', blind: 'Blind spot', inPlace: 'Here',
    checks: 'Three things to check for yourself',
    checksNote: 'Common tendencies for profiles like yours, not certainties about you.',
    axes: 'Your axes', lowConf: 'weak signal',
    recs: 'Based on your picks', again: 'Play a different path', done: 'Finish',
    share: 'Copy result', shared: 'Copied', cardLine: 'My taste profile',
    thinTitle: 'Cannot read taste from the menu',
    thin: (items, n) => `A taste read needs a more varied menu, at least ${n} items of different character. You can still play the preference chapter for a read.`,
  },
}

export default function TasteProfile({
  onScore, onExit, lang = 'ar', brand = '#0e7490',
  items = [], playerName = '', tenant = null, onProgress, resumeState,
}) {
  const ar = lang !== 'en'
  const t = ar ? TXT.ar : TXT.en
  const uid = `tp${useId().replace(/[:]/g, '')}`
  const onScoreRef = useRef(onScore)
  const onProgRef = useRef(onProgress)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgRef.current = onProgress }, [onProgress])

  const reduceMotion = useMemo(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
  }, [])

  const allPairs = useMemo(() => buildTastePairs(items, PAIRS_TARGET), [items])
  const hasMenu = !!allPairs

  const saved = resumeState && resumeState.v === STATE_V && resumeState.game === 'tasteProfile' && !resumeState.done
    ? resumeState : null

  const [phase, setPhase] = useState(saved?.answers?.length ? 'gate' : 'intro')
  const [answers, setAnswers] = useState(() => (Array.isArray(saved?.answers) ? saved.answers : []))
  const [variant, setVariant] = useState(() => Number(saved?.variant) || 0)
  const [flash, setFlash] = useState(null)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(0)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  // The two chapters as ordered question lists (menu pairs, then preference
  // contrasts). A thin menu drops the first chapter entirely.
  const stages = useMemo(() => {
    const out = []
    if (hasMenu) {
      const order = seededOrder(allPairs.length, variant * 3 + 5)
      const list = order.slice(0, Math.min(CH1_LEN, allPairs.length)).map((i) => allPairs[i])
      out.push({ name: t.ch1, kind: 'pair', list })
    }
    const c2 = seededOrder(CH2_BANK.length, variant * 5 + 17).slice(0, CH2_LEN).map((i) => CH2_BANK[i])
    out.push({ name: t.ch2, kind: 'trait', list: c2 })
    return out
  }, [hasMenu, allPairs, variant, t])

  const progressOf = (list) => {
    const ids = new Set(list.map((a) => a.id))
    for (let si = 0; si < stages.length; si += 1) {
      const q = stages[si].list.find((it) => !ids.has(it.id))
      if (q) return { si, q }
    }
    return { si: stages.length, q: null }
  }
  const cur = progressOf(answers)
  const finished = phase === 'reveal'
  const question = cur.q
  const stage = stages[Math.min(cur.si, stages.length - 1)]

  const profile = useMemo(
    () => scoreProfile(answers.map((a) => a.l).filter(Boolean), { source: 'tasteProfile' }),
    [answers],
  )

  const started2 = stages.length > 1 && answers.some((a) => a.si === 1)
  useEffect(() => {
    onScoreRef.current?.(answers.length * PER_ROUND + (started2 ? CHAPTER_BONUS : 0) + (finished ? FINISH_BONUS : 0))
  }, [answers, finished, started2])

  const persist = (next, v, done) => {
    const stg = (next.some((a) => a.si === 1) ? 2 : 1)
    const state = { v: STATE_V, game: 'tasteProfile', chapter: stg, stage: stg, variant: v, answers: next, done, at: Date.now() }
    if (done) {
      const p = scoreProfile(next.map((a) => a.l).filter(Boolean), { source: 'tasteProfile' })
      state.result = { archetype: p.archetype ? { id: p.archetype.id, ar: p.archetype.ar } : null }
    }
    onProgRef.current?.(state)
  }

  const begin = (fresh) => {
    clearTimeout(timerRef.current)
    const nv = fresh ? variant + 1 : variant
    if (fresh) { setVariant(nv); setAnswers([]); persist([], nv, false) }
    setPhase('play')
  }

  const pick = (side) => {
    if (!question || flash || phase !== 'play') return
    play('click')
    setFlash(side)
    const opt = side === 'a' ? question.a : question.b
    const l = opt.loadings || (opt.item ? opt.loadings : {})
    timerRef.current = setTimeout(() => {
      const next = [...answers, { si: cur.si, id: question.id, side, l }]
      setFlash(null)
      setAnswers(next)
      const p2 = progressOf(next)
      if (p2.si >= stages.length) { persist(next, variant, true); play('win'); setPhase('reveal'); return }
      persist(next, variant, false)
      if (p2.si > cur.si) { play('turn'); setPhase('beat') }
    }, 260)
  }

  const arch = useMemo(() => archetypeCopy(profile.archetype, tenant), [profile.archetype, tenant])

  const recs = useMemo(() => {
    if (!finished) return []
    const skip = []
    for (const a of answers) {
      if (a.si !== 0 || !hasMenu) continue
      const p = allPairs.find((x) => x.id === a.id)
      if (p) skip.push(String((a.side === 'a' ? p.b.item : p.a.item)?.id || ''))
    }
    return recommendItems(profile, items, tenant, { limit: 3, lang, excludeIds: skip })
  }, [finished, profile, items, tenant, lang, answers, allPairs, hasMenu])

  const doShare = async () => {
    const top = profile.topTraits.slice(0, 2)
      .map((x) => `${traitById(x.id)?.ar}: ${x.dir === 'high' ? traitById(x.id)?.high : traitById(x.id)?.low}`).join(' | ')
    const text = `${t.cardLine}: ${arch?.ar || ''}\n${top}\n${tenant?.name || ''}`.trim()
    try {
      if (navigator.share) { await navigator.share({ text }); return }
      await navigator.clipboard.writeText(text)
      setCopied(true)
      timerRef.current = setTimeout(() => setCopied(false), 1800)
    } catch { /* dismissed */ }
  }

  const curChapterNo = Math.min(cur.si, stages.length - 1) + 1
  const chLen = stage ? stage.list.length : 0
  const chAnswered = stage ? stage.list.filter((it) => answers.some((a) => a.id === it.id)).length : 0
  const topT = profile.topTraits[0]
  const headline = topT && topT.confidence > 0.1
    ? (topT.dir === 'high' ? traitById(topT.id)?.high : traitById(topT.id)?.low)
    : t.forming

  const Dash = (
    <>
      <div className="ig-dash ig-dash-phone">
        <div className="ig-dash-radar ig-pulse" key={`p${answers.length}`}>
          <Radar traits={profile.traits} axes={TRAITS} brand={brand} uid={`${uid}p`} />
        </div>
        <div className="ig-headline">{t.clearest}: <b>{headline}</b></div>
      </div>
      <div className="ig-dash ig-dash-wide">
        <div className="ig-dash-title">{t.live}</div>
        <div className="ig-dash-radar ig-pulse" key={`w${answers.length}`}>
          <Radar traits={profile.traits} axes={TRAITS} brand={brand} uid={`${uid}w`} />
        </div>
        <div className="ig-meters">
          {TRAITS.map((tr) => (
            <Meter key={tr.id} tr={tr} v={profile.traits[tr.id] ?? 0.5} conf={profile.traitConfidence[tr.id] ?? 0} ar={ar} lowConfText={t.lowConf} />
          ))}
        </div>
      </div>
    </>
  )

  const renderScene = () => {
    if (!question) return null
    const isPair = stage.kind === 'pair'
    return (
      <div className="ig-scene-wrap">
        <div className="ig-in" key={question.id} style={{ display: 'grid', gap: 'clamp(14px,2.4vh,30px)', justifyItems: 'center', width: '100%' }}>
          <span className="ig-q-kicker">{t.pick}</span>
          <div className="ig-duo">
            {(['a', 'b']).map((side, idx) => {
              const opt = side === 'a' ? question.a : question.b
              const cls = flash ? (flash === side ? ' picked' : ' faded') : ''
              const el = (
                <button key={side} type="button" className={`ig-duo-card${cls}`} disabled={!!flash} onClick={() => pick(side)}>
                  {isPair ? (
                    <>
                      <span className="ig-duo-media">
                        {opt.item?.imageUrl ? <img src={opt.item.imageUrl} alt="" loading="lazy" /> : <Icon name="coffee" size={30} />}
                      </span>
                      <span className="ig-duo-name">{itemName(opt.item, lang)}</span>
                      {Number(opt.item?.price) > 0 && <span className="ig-duo-meta">{arNum(Number(opt.item.price))}</span>}
                    </>
                  ) : (
                    <>
                      <span className="ig-duo-glyph"><Icon name={opt.icon || 'star'} size={30} /></span>
                      <span className="ig-duo-name">{opt.label}</span>
                    </>
                  )}
                </button>
              )
              return idx === 0 ? [el, <span key="or" className="ig-duo-or">{t.or}</span>] : el
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ig-root" dir={ar ? 'rtl' : 'ltr'} style={{ '--ig-brand': brand }}>
      {phase === 'play' && (
        <div className="ig-top">
          <span className="ig-chapter"><span className="ig-cnum">{t.chLine(curChapterNo, stages.length, stage?.name || '')}</span></span>
          <span className="ig-dots">
            {Array.from({ length: chLen }, (_, i) => (
              <span key={i} className={`ig-dot${i < chAnswered ? ' done' : i === chAnswered ? ' now' : ''}`} />
            ))}
          </span>
        </div>
      )}

      {(phase === 'intro' || phase === 'gate') && (
        <div className="ig-scroll">
          <div className="ig-pad ig-center ig-in">
            {phase === 'gate'
              ? <span className="ig-resume"><Icon name="clock" size={14} /> {t.chLine(saved?.stage || 1, stages.length, (saved?.stage || 1) >= 2 ? t.ch2 : (stages[0]?.name || t.ch2))}</span>
              : <span className="ig-kicker"><Icon name="sparkles" size={14} /> {ar ? 'بصيرة' : 'Insight'}</span>}
            <h2 className="ig-title">{t.title}</h2>
            <p className="ig-sub">{hasMenu ? t.how(lex(tenant, 'items')) : t.howThin}</p>
            <div className="ig-chips">
              {hasMenu && <span className="ig-chip">{t.preview1}</span>}
              <span className="ig-chip">{t.preview2}</span>
              {!hasMenu && <span className="ig-chip">{t.thinChip}</span>}
            </div>
            <div className="ig-btnrow">
              {phase === 'gate' && (
                <button type="button" className="ig-btn gold" onClick={() => begin(false)}><Icon name="play" size={18} /> {t.resume}</button>
              )}
              <button type="button" className={phase === 'gate' ? 'ig-btn ghost' : 'ig-btn gold'} onClick={() => begin(true)}>
                <Icon name={phase === 'gate' ? 'reload' : 'play'} size={17} /> {phase === 'gate' ? t.restart : t.start}
              </button>
            </div>
            <p className="ig-disc">{ar ? INSIGHT_DISCLAIMER_AR : INSIGHT_DISCLAIMER_EN}</p>
          </div>
        </div>
      )}

      {phase === 'beat' && (
        <div className="ig-stage">
          <div className="ig-beat ig-in">
            <div className="ig-beat-seal ig-pop"><Emblem id={`tp-chapter-2-${variant}`} brand={brand} uid={`${uid}beat`} /></div>
            <span className="ig-beat-k">{t.beatK}</span>
            <h3 className="ig-beat-t">{t.beatT}</h3>
            <p className="ig-beat-s">{t.beatS}</p>
            <button type="button" className="ig-btn" onClick={() => { play('turn'); setPhase('play') }}>{t.beatBtn} <Icon name="next" size={18} /></button>
          </div>
        </div>
      )}

      {phase === 'play' && question && (
        <div className="ig-stage">
          <div className="ig-play">
            {Dash}
            {renderScene()}
          </div>
        </div>
      )}

      {finished && (
        <div className="ig-scroll">
          <div className="ig-pad">
            <div className="ig-reveal wide">
              <div className="ig-hero">
                <div className={`ig-emblem${reduceMotion ? '' : ' ig-emblem-float'}`}><Emblem id={profile.archetype?.id || 'x'} brand={brand} uid={`${uid}hero`} /></div>
                <span className="ig-hero-type">{t.yourType}</span>
                <h2 className="ig-arch">{arch?.ar}</h2>
                <span className="ig-fit"><Icon name="check" size={14} /> {t.fit(Math.round((profile.archetypeFit || 0) * 100))}</span>
                {!hasMenu && <span className="ig-fit">{t.howThin}</span>}
                <p className="ig-portrait">{arch?.portrait}</p>
              </div>

              <section className="ig-sec">
                <h3 className="ig-sec-h"><Icon name="star" size={15} /> {t.strengths}</h3>
                <ul className="ig-list">{(arch?.strengths || []).map((s, i) => <li key={i}>{s}</li>)}</ul>
              </section>

              <section className="ig-sec">
                <h3 className="ig-sec-h"><Icon name="eye" size={15} /> {t.blind}</h3>
                <p className="ig-body">{arch?.blindSpot}</p>
              </section>

              <section className="ig-sec">
                <h3 className="ig-sec-h"><Icon name="store" size={15} /> {t.inPlace}</h3>
                <p className="ig-body">{arch?.venue}</p>
              </section>

              <section className="ig-sec">
                <h3 className="ig-sec-h"><Icon name="check" size={15} /> {t.checks}</h3>
                <ol className="ig-preds">
                  {(arch?.predictions || []).map((p, i) => (
                    <li className="ig-pred" key={i}><span className="ig-pred-n">{arNum(i + 1)}</span>{p}</li>
                  ))}
                </ol>
                <p className="ig-note">{t.checksNote}</p>
              </section>

              <section className="ig-sec">
                <h3 className="ig-sec-h"><Icon name="chartBar" size={15} /> {t.axes}</h3>
                <div className="ig-meters">
                  {TRAITS.map((tr) => (
                    <Meter key={tr.id} tr={tr} v={profile.traits[tr.id] ?? 0.5} conf={profile.traitConfidence[tr.id] ?? 0} ar={ar} lowConfText={t.lowConf} />
                  ))}
                </div>
              </section>

              {recs.length > 0 && (
                <section className="ig-sec">
                  <h3 className="ig-sec-h"><Icon name="heart" size={15} /> {t.recs}</h3>
                  <div className="ig-recs">
                    {recs.map((r) => (
                      <div className="ig-rec" key={String(r.item.id)}>
                        <span className="ig-rec-media">
                          {r.item.imageUrl ? <img src={r.item.imageUrl} alt="" loading="lazy" /> : <Icon name="coffee" size={22} />}
                        </span>
                        <span className="ig-rec-body">
                          <span className="ig-rec-nm">{r.name}</span>
                          <span className="ig-rec-why">{r.reason}</span>
                          {Number(r.item.price) > 0 && <span className="ig-rec-price">{arNum(Number(r.item.price))}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div className="ig-card">
                <div className="ig-card-emblem"><Emblem id={profile.archetype?.id || 'x'} brand={brand} uid={`${uid}card`} /></div>
                {playerName ? <span className="ig-who">{playerName}</span> : null}
                <strong className="ig-card-arch">{arch?.ar}</strong>
                <div className="ig-chips">
                  {profile.topTraits.slice(0, 3).map((x) => (
                    <span className="ig-chip" key={x.id}>{x.dir === 'high' ? traitById(x.id)?.high : traitById(x.id)?.low}</span>
                  ))}
                </div>
                <span className="ig-card-line">{tenant?.name || ''}</span>
                <button type="button" className="ig-btn ghost" onClick={doShare}>
                  <Icon name={copied ? 'check' : 'share'} size={16} /> {copied ? t.shared : t.share}
                </button>
              </div>

              <p className="ig-disc">{ar ? INSIGHT_DISCLAIMER_AR : INSIGHT_DISCLAIMER_EN}</p>

              <div className="ig-btnrow">
                <button type="button" className="ig-btn gold" onClick={() => begin(true)}><Icon name="repeat" size={16} /> {t.again}</button>
                {onExit && <button type="button" className="ig-btn ghost" onClick={onExit}><Icon name="ok" size={16} /> {t.done}</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
