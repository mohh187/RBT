// «كيف تقرر؟» — a two-chapter read of your decision-making style.
//
// CHAPTER 1 «القرار اليومي» is the engine's everyday decision scenarios.
// CHAPTER 2 «القرارات الكبرى» is an ORIGINAL bank authored here — big,
// irreversible, high-stakes decisions that press the same four axes harder
// (analysis, conscientiousness, novelty, emotional stability). Chapter + answers
// + path variant persist through onProgress/resumeState, and «العب بمسار مختلف»
// reshuffles which scenarios you meet and in what order.
//
// HONESTY unchanged: the reveal names a STYLE, never a verdict — every style
// carries real strengths and a genuine cost, because no decision style is best
// in all situations. Grounded in the dual-process view of decision making.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { play } from '../../lib/gameSounds.js'
import '../../styles/insightgames.css'
import {
  DECISION_SCENARIOS,
  INSIGHT_DISCLAIMER_AR,
  INSIGHT_DISCLAIMER_EN,
  TRAITS,
  arNum,
  decisionAnswersToLoadings,
  decisionStyle,
  fillLex,
  scoreProfile,
  traitById,
} from '../../lib/insightEngine.js'

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
const PER_Q = 14
const CHAPTER_BONUS = 30
const FINISH_BONUS = 50
const CH1_LEN = 5
const CH2_LEN = 4
// The axes eight-to-nine decision items can honestly speak to.
const SHOWN = ['analysis', 'conscientiousness', 'novelty', 'stability']

// ---------------------------------------------------------------------------
// CHAPTER 2 — original authored bank «القرارات الكبرى» (the big, irreversible
// ones). Higher-stakes decisions on the same axes.
// ---------------------------------------------------------------------------
const CH2_BANK = [
  {
    id: 'ds2-move',
    text: 'فرصة عمل ممتازة، لكنها في مدينة أخرى بعيدة عن كل ما تعرفه.',
    options: [
      { key: 'a', label: 'أحسب الكلفة والعائد على ورق قبل أي خطوة.', loadings: { analysis: 0.8, conscientiousness: 0.4 } },
      { key: 'b', label: 'أسأل من جرّب الانتقال وأبني على تجربته.', loadings: { agreeableness: 0.4, extraversion: 0.3, analysis: 0.2 } },
      { key: 'c', label: 'إن حرّكني الحدس نحوها، أذهب.', loadings: { analysis: -0.7, novelty: 0.6, stability: 0.3 } },
    ],
  },
  {
    id: 'ds2-noreturn',
    text: 'قرار لا رجعة فيه، والمعلومات التي بين يديك ناقصة.',
    options: [
      { key: 'a', label: 'أؤجّله حتى أجمع ما يكفي لأطمئن.', loadings: { analysis: 0.6, conscientiousness: 0.5, novelty: -0.3 } },
      { key: 'b', label: 'أقرّر بأفضل تقدير متاح وأتحمّل نتيجته.', loadings: { analysis: -0.3, stability: 0.7, novelty: 0.3 } },
      { key: 'c', label: 'أصمّم أصغر خطوة قابلة للاختبار أولاً.', loadings: { analysis: 0.5, openness: 0.4, conscientiousness: 0.3 } },
    ],
  },
  {
    id: 'ds2-money',
    text: 'استثمار واعد قد يضاعف مالك أو يبتلع نصفه.',
    options: [
      { key: 'a', label: 'أدخل بجزء محسوب أختبر به فقط.', loadings: { analysis: 0.6, conscientiousness: 0.4, novelty: 0.2 } },
      { key: 'b', label: 'أدخل بثقة؛ لا مكسب كبير بلا مخاطرة.', loadings: { novelty: 0.8, analysis: -0.4, stability: 0.3 } },
      { key: 'c', label: 'أتركه؛ حماية ما عندي أهم من مكسب محتمل.', loadings: { novelty: -0.7, conscientiousness: 0.3, stability: 0.2 } },
    ],
  },
  {
    id: 'ds2-people',
    text: 'قرار يرضيك ويغضب من تحب، أو يرضيهم ويثقل عليك.',
    options: [
      { key: 'a', label: 'أوازن، ثم أشرح موقفي بصراحة هادئة.', loadings: { agreeableness: 0.3, analysis: 0.4, conscientiousness: 0.3 } },
      { key: 'b', label: 'أقدّم راحتهم؛ العلاقة أبقى من القرار.', loadings: { agreeableness: 0.8, novelty: -0.1 } },
      { key: 'c', label: 'أختار ما أراه صحيحاً ولو غضبوا مؤقتاً.', loadings: { agreeableness: -0.6, stability: 0.4 } },
    ],
  },
  {
    id: 'ds2-clock',
    text: 'قرار مصيري وأمامك ساعة واحدة فقط للحسم.',
    options: [
      { key: 'a', label: 'أختصر لأهم معيارين وأحسم بهما.', loadings: { analysis: 0.4, stability: 0.5, conscientiousness: 0.2 } },
      { key: 'b', label: 'أتصل فوراً بمن أثق برأيه.', loadings: { agreeableness: 0.4, extraversion: 0.4 } },
      { key: 'c', label: 'أتبع أول ميل واضح في داخلي.', loadings: { analysis: -0.7, novelty: 0.4 } },
    ],
  },
  {
    id: 'ds2-legacy',
    text: 'قرار يمتد أثره سنوات لا شهوراً.',
    options: [
      { key: 'a', label: 'أرسم السيناريوهات بعيدة المدى بالتفصيل.', loadings: { analysis: 0.7, conscientiousness: 0.5, novelty: -0.2 } },
      { key: 'b', label: 'أسأل: أيّهما لن أندم عليه بعد عشر سنين؟', loadings: { analysis: 0.3, stability: 0.4, openness: 0.3 } },
      { key: 'c', label: 'أثق أن الطريق يتّضح كلّما مشيت فيه.', loadings: { analysis: -0.5, novelty: 0.5, conscientiousness: -0.2 } },
    ],
  },
]
const ch2ById = Object.fromEntries(CH2_BANK.map((q) => [q.id, q]))

const TXT = {
  ar: {
    title: 'كيف تقرر؟',
    how: 'فصلان من المواقف. اختر ما تفعله فعلاً — لا يوجد أسلوب قرار «صحيح»؛ لكل أسلوب موضع يتفوّق فيه وموضع يكلّفك.',
    ch1: 'القرار اليومي', ch2: 'القرارات الكبرى',
    chLine: (n, total, name) => `الفصل ${arNum(n)} من ${arNum(total)} · ${name}`,
    preview1: 'الفصل الأول: قرارات الحياة اليومية.',
    preview2: 'الفصل الثاني: القرارات الكبرى التي لا رجعة فيها.',
    start: 'ابدأ', resume: 'أكمل من حيث توقفت', restart: 'من البداية',
    live: 'قراءة حيّة', clearest: 'أوضح محور الآن', forming: 'يتشكّل…',
    beatK: 'اكتمل الفصل الأول', beatT: 'القرارات الكبرى', beatS: 'الآن ترتفع الرهانات — القرارات التي لا رجعة فيها تكشف أسلوبك الحقيقي.', beatBtn: 'تابع',
    style: 'أسلوبك في القرار',
    strengths: 'أين يتفوّق أسلوبك', watch: 'وأين يكلّفك', takeaway: 'خذها معك',
    axes: 'محاور القرار', lowConf: 'إشارة ضعيفة',
    again: 'العب بمسار مختلف', done: 'إنهاء',
    share: 'انسخ النتيجة', shared: 'تم النسخ', cardLine: 'أسلوبي في اتخاذ القرار',
  },
  en: {
    title: 'How You Decide',
    how: 'Two chapters of scenarios. Pick what you actually do — no decision style is the right one; each wins somewhere and costs somewhere.',
    ch1: 'Everyday calls', ch2: 'The big ones',
    chLine: (n, total, name) => `Chapter ${n} of ${total} · ${name}`,
    preview1: 'Chapter one: everyday decisions.',
    preview2: 'Chapter two: the big, irreversible ones.',
    start: 'Start', resume: 'Resume', restart: 'Start over',
    live: 'Live reading', clearest: 'Clearest axis', forming: 'forming…',
    beatK: 'Chapter one complete', beatT: 'The big decisions', beatS: 'The stakes rise now — irreversible calls reveal your real style.', beatBtn: 'Continue',
    style: 'Your decision style',
    strengths: 'Where it wins', watch: 'Where it costs you', takeaway: 'Take this with you',
    axes: 'Decision axes', lowConf: 'weak signal',
    again: 'Play a different path', done: 'Finish',
    share: 'Copy result', shared: 'Copied', cardLine: 'My decision style',
  },
}

export default function DecisionStyle({
  onScore, onExit, lang = 'ar', brand = '#0e7490',
  playerName = '', tenant = null, onProgress, resumeState,
}) {
  const ar = lang !== 'en'
  const t = ar ? TXT.ar : TXT.en
  const uid = `ds${useId().replace(/[:]/g, '')}`
  const onScoreRef = useRef(onScore)
  const onProgRef = useRef(onProgress)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgRef.current = onProgress }, [onProgress])

  const reduceMotion = useMemo(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
  }, [])

  const saved = resumeState && resumeState.v === STATE_V && resumeState.game === 'decisionStyle' && !resumeState.done
    ? resumeState : null

  const [phase, setPhase] = useState(saved?.answers?.length ? 'gate' : 'intro')
  const [answers, setAnswers] = useState(() => (Array.isArray(saved?.answers) ? saved.answers : []))
  const [variant, setVariant] = useState(() => Number(saved?.variant) || 0)
  const [flash, setFlash] = useState(null)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(0)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const ch1Ask = useMemo(
    () => seededOrder(DECISION_SCENARIOS.length, variant * 3 + 5).slice(0, CH1_LEN).map((i) => DECISION_SCENARIOS[i]),
    [variant],
  )
  const ch2Ask = useMemo(
    () => seededOrder(CH2_BANK.length, variant * 5 + 19).slice(0, CH2_LEN).map((i) => CH2_BANK[i]),
    [variant],
  )

  const nextFrom = (list, chapter) => {
    const bank = chapter === 1 ? ch1Ask : ch2Ask
    const asked = new Set(list.filter((a) => a.ch === chapter).map((a) => a.id))
    for (const q of bank) if (!asked.has(q.id)) return q
    return null
  }

  const q1 = nextFrom(answers, 1)
  const curChapter = q1 ? 1 : 2
  const question = q1 || nextFrom(answers, 2)
  const finished = phase === 'reveal'

  const loadsOf = (list) => {
    const l1 = decisionAnswersToLoadings(list.filter((a) => a.ch === 1))
    const l2 = list.filter((a) => a.ch === 2)
      .map((a) => ch2ById[a.id]?.options.find((o) => o.key === a.key)?.loadings)
      .filter(Boolean)
    return [...l1, ...l2]
  }
  const profile = useMemo(() => scoreProfile(loadsOf(answers), { source: 'decisionStyle' }), [answers])
  const style = useMemo(() => decisionStyle(profile), [profile])

  useEffect(() => {
    const started2 = answers.some((a) => a.ch === 2)
    onScoreRef.current?.(answers.length * PER_Q + (started2 ? CHAPTER_BONUS : 0) + (finished ? FINISH_BONUS : 0))
  }, [answers, finished])

  const persist = (next, v, done) => {
    const stage = next.some((a) => a.ch === 2) ? 2 : 1
    const state = { v: STATE_V, game: 'decisionStyle', chapter: stage, stage, variant: v, answers: next, done, at: Date.now() }
    if (done) {
      const s = decisionStyle(scoreProfile(loadsOf(next), { source: 'decisionStyle' }))
      state.result = { archetype: s ? { id: s.id, ar: s.ar } : null }
    }
    onProgRef.current?.(state)
  }

  const begin = (fresh) => {
    clearTimeout(timerRef.current)
    const nv = fresh ? variant + 1 : variant
    if (fresh) { setVariant(nv); setAnswers([]); persist([], nv, false) }
    setPhase('play')
  }

  const answer = (key) => {
    if (!question || flash || phase !== 'play') return
    play('click')
    setFlash(key)
    timerRef.current = setTimeout(() => {
      const next = [...answers, { ch: curChapter, id: question.id, key }]
      setFlash(null)
      setAnswers(next)
      const after1 = nextFrom(next, 1)
      const after2 = nextFrom(next, 2)
      if (!after1 && !after2) { persist(next, variant, true); play('win'); setPhase('reveal'); return }
      persist(next, variant, false)
      if (!after1 && next.filter((a) => a.ch === 2).length === 0) { play('turn'); setPhase('beat') }
    }, 250)
  }

  const doShare = async () => {
    const text = `${t.cardLine}: ${style?.ar || ''}\n${style?.takeaway || ''}\n${tenant?.name || ''}`.trim()
    try {
      if (navigator.share) { await navigator.share({ text }); return }
      await navigator.clipboard.writeText(text)
      setCopied(true)
      timerRef.current = setTimeout(() => setCopied(false), 1800)
    } catch { /* dismissed */ }
  }

  const shownAxes = useMemo(() => TRAITS.filter((tr) => SHOWN.includes(tr.id)), [])
  const ch1a = answers.filter((a) => a.ch === 1)
  const ch2a = answers.filter((a) => a.ch === 2)
  const chLen = curChapter === 1 ? CH1_LEN : CH2_LEN
  const chAnswered = curChapter === 1 ? ch1a.length : ch2a.length
  const chName = curChapter === 1 ? t.ch1 : t.ch2
  const topShown = profile.topTraits.find((x) => SHOWN.includes(x.id))
  const headline = topShown && topShown.confidence > 0.12
    ? (topShown.dir === 'high' ? traitById(topShown.id)?.high : traitById(topShown.id)?.low)
    : t.forming

  const Dash = (
    <>
      <div className="ig-dash ig-dash-phone">
        <div className="ig-dash-radar ig-pulse" key={`p${answers.length}`}>
          <Radar traits={profile.traits} axes={shownAxes} brand={brand} uid={`${uid}p`} />
        </div>
        <div className="ig-headline">{t.clearest}: <b>{headline}</b></div>
      </div>
      <div className="ig-dash ig-dash-wide">
        <div className="ig-dash-title">{t.live}</div>
        <div className="ig-dash-radar ig-pulse" key={`w${answers.length}`}>
          <Radar traits={profile.traits} axes={shownAxes} brand={brand} uid={`${uid}w`} />
        </div>
        <div className="ig-meters">
          {shownAxes.map((tr) => (
            <Meter key={tr.id} tr={tr} v={profile.traits[tr.id] ?? 0.5} conf={profile.traitConfidence[tr.id] ?? 0} ar={ar} lowConfText={t.lowConf} />
          ))}
        </div>
      </div>
    </>
  )

  return (
    <div className="ig-root" dir={ar ? 'rtl' : 'ltr'} style={{ '--ig-brand': brand }}>
      {phase === 'play' && (
        <div className="ig-top">
          <span className="ig-chapter"><span className="ig-cnum">{t.chLine(curChapter, 2, chName)}</span></span>
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
              ? <span className="ig-resume"><Icon name="clock" size={14} /> {t.chLine(saved?.stage || 1, 2, (saved?.stage || 1) === 2 ? t.ch2 : t.ch1)}</span>
              : <span className="ig-kicker"><Icon name="arrowLeftRight" size={14} /> {ar ? 'بصيرة' : 'Insight'}</span>}
            <h2 className="ig-title">{t.title}</h2>
            <p className="ig-sub">{t.how}</p>
            <div className="ig-chips">
              <span className="ig-chip">{t.preview1}</span>
              <span className="ig-chip">{t.preview2}</span>
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
            <div className="ig-beat-seal ig-pop"><Emblem id={`ds-chapter-2-${variant}`} brand={brand} uid={`${uid}beat`} /></div>
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
            <div className="ig-scene-wrap">
              <div className="ig-in" key={question.id} style={{ display: 'grid', gap: 'clamp(14px,2.4vh,30px)', justifyItems: 'center', width: '100%' }}>
                <span className="ig-q-kicker">{t.chLine(curChapter, 2, chName)}</span>
                <p className="ig-q">{fillLex(question.text, tenant)}</p>
                <div className="ig-opts">
                  {question.options.map((o, i) => {
                    const cls = flash ? (flash === o.key ? ' picked' : ' faded') : ''
                    return (
                      <button key={o.key} type="button" className={`ig-opt${cls}`} disabled={!!flash} onClick={() => answer(o.key)}>
                        <span className="ig-opt-k">{arNum(i + 1)}</span>
                        <span>{fillLex(o.label, tenant)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {finished && (
        <div className="ig-scroll">
          <div className="ig-pad">
            <div className="ig-reveal wide">
              <div className="ig-hero">
                <div className={`ig-emblem${reduceMotion ? '' : ' ig-emblem-float'}`}><Emblem id={style?.id || 'x'} brand={brand} uid={`${uid}hero`} /></div>
                <span className="ig-hero-type">{t.style}</span>
                <h2 className="ig-arch">{style?.ar}</h2>
                <p className="ig-portrait">{style?.portrait}</p>
              </div>

              <section className="ig-sec">
                <h3 className="ig-sec-h"><Icon name="star" size={15} /> {t.strengths}</h3>
                <ul className="ig-list">{(style?.strengths || []).map((s, i) => <li key={i}>{s}</li>)}</ul>
              </section>

              <section className="ig-sec">
                <h3 className="ig-sec-h"><Icon name="warning" size={15} /> {t.watch}</h3>
                <p className="ig-body">{style?.watchOut}</p>
              </section>

              <section className="ig-sec accent">
                <h3 className="ig-sec-h"><Icon name="key" size={15} /> {t.takeaway}</h3>
                <p className="ig-body" style={{ fontWeight: 700 }}>{style?.takeaway}</p>
              </section>

              <section className="ig-sec">
                <h3 className="ig-sec-h"><Icon name="chartBar" size={15} /> {t.axes}</h3>
                <div className="ig-meters">
                  {shownAxes.map((tr) => (
                    <Meter key={tr.id} tr={tr} v={profile.traits[tr.id] ?? 0.5} conf={profile.traitConfidence[tr.id] ?? 0} ar={ar} lowConfText={t.lowConf} />
                  ))}
                </div>
              </section>

              <div className="ig-card">
                <div className="ig-card-emblem"><Emblem id={style?.id || 'x'} brand={brand} uid={`${uid}card`} /></div>
                {playerName ? <span className="ig-who">{playerName}</span> : null}
                <strong className="ig-card-arch">{style?.ar}</strong>
                <div className="ig-chips">
                  {profile.topTraits.filter((x) => SHOWN.includes(x.id)).slice(0, 3).map((x) => (
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
