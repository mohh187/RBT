// «مرآة الشخصية» — a two-chapter, cinematic personality mirror.
//
// CHAPTER 1 «المواقف» is the engine's adaptive situational bank (gated on the
// profile so far, deterministic so a resumed session lands on the same
// question). CHAPTER 2 «تحت الضغط» is an ORIGINAL, higher-stakes bank authored
// here in this file — new situations that probe the same seven axes when the
// pressure rises. Progress (chapter + answers + path variant) is persisted via
// onProgress and honoured through resumeState, so a returning guest continues
// exactly where they stopped, and «العب بمسار مختلف» reshuffles the path.
//
// HONESTY is unchanged: situational-judgement items grounded in the Big Five
// plus the decision-style and novelty axes, a live confidence signal per axis,
// and the standing disclaimer. Nothing here is divinatory — the read is built
// only from the answers given this session.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { play } from '../../lib/gameSounds.js'
import '../../styles/insightgames.css'
import {
  INSIGHT_DISCLAIMER_AR,
  INSIGHT_DISCLAIMER_EN,
  MIND_MIRROR_BANK,
  TRAITS,
  answersToLoadings,
  arNum,
  archetypeCopy,
  mindMirrorNext,
  recommendItems,
  scoreProfile,
  traitById,
} from '../../lib/insightEngine.js'
import { lex } from '../../lib/venueTypes.js'

// ===========================================================================
// SHARED INSIGHT KIT (inlined — these three games own no separate module).
// Original SVG artwork drawn here: an archetype "seal" emblem and a live radar,
// plus a bipolar trait meter and a seeded path shuffler. SVG traps avoided:
//   • children are placed with the UNITLESS attribute form transform="rotate(..)"
//   • no filter="url(#..)" anywhere — depth is gradients + layered strokes
//   • the update "pulse" runs on the HTML wrapper (.ig-pulse), never on an SVG
//     child, so no CSS px-transform ever touches an SVG node.
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

// A deterministic Fisher–Yates order from a string/number seed — drives the
// "different path" replay without any global RNG.
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

// A unique, original "majlis seal" per archetype/style, derived from its id so
// the same result always shows the same emblem.
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

// The live radar: a heptagon of the guest's current trait estimates. The update
// "pop" is applied by keying the HTML wrapper with .ig-pulse in the parent — no
// transform ever touches these SVG nodes.
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

// A bipolar trait meter that slides (inset/width transition) as the profile
// tilts. Reused live during play and in the reveal.
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
const PER_Q = 15
const CHAPTER_BONUS = 30
const FINISH_BONUS = 60
const CH1_LEN = 8          // core anchors + a couple of adaptive follow-ups
const CH2_LEN = 5          // five of the six authored high-stakes situations

// ---------------------------------------------------------------------------
// CHAPTER 2 — original authored bank «تحت الضغط» (when it intensifies).
// Higher-stakes situations, each carrying signed loadings on the same axes.
// ---------------------------------------------------------------------------
const CH2_BANK = [
  {
    id: 'mm2-crisis',
    text: 'خبر سيّئ مفاجئ يقلب خطة يومك كاملة.',
    options: [
      { key: 'a', label: 'أعيد ترتيب أولوياتي بهدوء وأبدأ التحرك فوراً.', loadings: { stability: 0.75, conscientiousness: 0.4, analysis: 0.25 } },
      { key: 'b', label: 'أحتاج دقائق أستوعب فيها قبل أن أتصرّف.', loadings: { stability: -0.45, analysis: 0.2 } },
      { key: 'c', label: 'أتصل بأقرب شخص لأفكّر معه بصوت عالٍ.', loadings: { extraversion: 0.55, agreeableness: 0.35, stability: -0.15 } },
    ],
  },
  {
    id: 'mm2-crowd',
    text: 'الجميع متحمّس لقرار تراه أنت خطأً واضحاً.',
    options: [
      { key: 'a', label: 'أقولها ولو وقفت وحدي في الجهة الأخرى.', loadings: { agreeableness: -0.6, extraversion: 0.3, stability: 0.4 } },
      { key: 'b', label: 'أطرح تحفّظي على شكل سؤال لا اعتراض.', loadings: { agreeableness: 0.4, analysis: 0.45, openness: 0.2 } },
      { key: 'c', label: 'أترك الأمر؛ الأيام كفيلة بأن تُظهر الصح.', loadings: { agreeableness: 0.35, extraversion: -0.4, stability: 0.2 } },
    ],
  },
  {
    id: 'mm2-stage',
    text: 'طُلب منك فجأة أن تتحدّث أمام قاعة مليئة.',
    options: [
      { key: 'a', label: 'أقف وأرتجل، فهذه الطاقة تعجبني.', loadings: { extraversion: 0.8, stability: 0.4, novelty: 0.25 } },
      { key: 'b', label: 'أوافق، لكن أطلب دقيقتين أرتّب فيهما رأسي.', loadings: { conscientiousness: 0.45, analysis: 0.3, extraversion: 0.1 } },
      { key: 'c', label: 'أعتذر؛ أُعبّر بالكتابة أفضل من الوقوف.', loadings: { extraversion: -0.7, openness: 0.15 } },
    ],
  },
  {
    id: 'mm2-tempt',
    text: 'عرض مغرٍ جداً، لكنه يكسر مبدأً تلتزم به.',
    options: [
      { key: 'a', label: 'أرفضه بلا تردّد؛ المبدأ ليس للبيع.', loadings: { conscientiousness: 0.6, agreeableness: -0.1, stability: 0.35 } },
      { key: 'b', label: 'أزن حجم المكسب مقابل كلفة المبدأ بدقّة.', loadings: { analysis: 0.6, conscientiousness: 0.2 } },
      { key: 'c', label: 'أبحث عن حلٍّ وسط يحفظ الاثنين معاً.', loadings: { openness: 0.35, novelty: 0.4, agreeableness: 0.2 } },
    ],
  },
  {
    id: 'mm2-longgame',
    text: 'مشروع يحتاج صبر أشهر قبل أن تظهر أي نتيجة.',
    options: [
      { key: 'a', label: 'أستمر بثبات؛ الثمار تأتي متأخرة عادةً.', loadings: { conscientiousness: 0.7, stability: 0.4, novelty: -0.3 } },
      { key: 'b', label: 'أضع محطّات صغيرة أقيس بها تقدّمي.', loadings: { analysis: 0.5, conscientiousness: 0.5 } },
      { key: 'c', label: 'يخفت حماسي، وأبحث عن شيء أسرع مردوداً.', loadings: { conscientiousness: -0.6, novelty: 0.6, openness: 0.2 } },
    ],
  },
  {
    id: 'mm2-between',
    text: 'خلاف حادّ بين شخصين تحبّهما، وكلٌّ يريدك في صفّه.',
    options: [
      { key: 'a', label: 'أستمع للطرفين وأبحث عن أرضية تجمعهما.', loadings: { agreeableness: 0.55, analysis: 0.4 } },
      { key: 'b', label: 'أقول رأيي بصراحة لمن أراه مخطئاً.', loadings: { agreeableness: -0.5, extraversion: 0.25, stability: 0.3 } },
      { key: 'c', label: 'أنسحب من المنتصف؛ ليست معركتي.', loadings: { agreeableness: 0.1, extraversion: -0.4, stability: 0.25 } },
    ],
  },
]
const ch2ById = Object.fromEntries(CH2_BANK.map((q) => [q.id, q]))

const TXT = {
  ar: {
    title: 'مرآة الشخصية',
    how: 'فصلان من المواقف الواقعية. اختر ما تفعله فعلاً لا ما يُفترض. النتيجة تتغيّر مع كل إجابة، والأسئلة نفسها تتبعك.',
    ch1: 'المواقف', ch2: 'تحت الضغط',
    chLine: (n, total, name) => `الفصل ${arNum(n)} من ${arNum(total)} · ${name}`,
    preview1: 'الفصل الأول: مواقف الحياة اليومية.',
    preview2: 'الفصل الثاني: قرارات حين تشتدّ الأمور.',
    start: 'ابدأ', resume: 'أكمل من حيث توقفت', restart: 'من البداية',
    live: 'قراءة حيّة', clearest: 'أوضح ميل الآن', forming: 'يتشكّل…',
    beatK: 'اكتمل الفصل الأول', beatT: 'تحت الضغط', beatS: 'المواقف تصبح أصعب الآن، وهنا تظهر ملامحك الحقيقية.', beatBtn: 'تابع',
    yourType: 'نمطك', fit: (n) => `تطابق ${arNum(n)}%`, alt: (n) => `وفيك لمسة من «${n}»`,
    portrait: 'الصورة', strengths: 'ما تجيده', blind: 'النقطة العمياء', order: 'كيف تطلب',
    checks: 'ثلاثة أشياء تحقّق منها بنفسك',
    checksNote: 'هذه ميول شائعة لمن يشبه نتيجتك، لا حقائق مؤكدة عنك. اقرأها واحكم بنفسك.',
    axes: 'محاورك السبعة', conf: (n) => `دقة القياس ${arNum(n)}%`, lowConf: 'إشارة ضعيفة',
    recs: 'يناسبك من', again: 'العب بمسار مختلف', done: 'إنهاء',
    share: 'انسخ النتيجة', shared: 'تم النسخ', cardLine: 'نتيجتي في مرآة الشخصية',
  },
  en: {
    title: 'Mind Mirror',
    how: 'Two chapters of real situations. Pick what you actually do. The read shifts with every answer, and the questions follow you.',
    ch1: 'Situations', ch2: 'Under pressure',
    chLine: (n, total, name) => `Chapter ${n} of ${total} · ${name}`,
    preview1: 'Chapter one: everyday situations.',
    preview2: 'Chapter two: choices when the pressure rises.',
    start: 'Start', resume: 'Resume', restart: 'Start over',
    live: 'Live reading', clearest: 'Clearest leaning', forming: 'forming…',
    beatK: 'Chapter one complete', beatT: 'Under pressure', beatS: 'The situations get harder now, and this is where your real shape shows.', beatBtn: 'Continue',
    yourType: 'Your type', fit: (n) => `${n}% match`, alt: (n) => `with a touch of "${n}"`,
    portrait: 'Portrait', strengths: 'Strengths', blind: 'Blind spot', order: 'How you order',
    checks: 'Three things to check for yourself',
    checksNote: 'Common tendencies for profiles like yours, not certainties about you.',
    axes: 'Your seven axes', conf: (n) => `confidence ${n}%`, lowConf: 'weak signal',
    recs: 'Suits you at', again: 'Play a different path', done: 'Finish',
    share: 'Copy result', shared: 'Copied', cardLine: 'My Mind Mirror result',
  },
}

export default function MindMirror({
  onScore, onExit, lang = 'ar', brand = '#0e7490',
  items = [], playerName = '', tenant = null, onProgress, resumeState,
}) {
  const ar = lang !== 'en'
  const t = ar ? TXT.ar : TXT.en
  const uid = `mm${useId().replace(/[:]/g, '')}`
  const onScoreRef = useRef(onScore)
  const onProgRef = useRef(onProgress)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgRef.current = onProgress }, [onProgress])

  const reduceMotion = useMemo(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
  }, [])

  const saved = resumeState && resumeState.v === STATE_V && resumeState.game === 'mindMirror' && !resumeState.done
    ? resumeState : null

  const [phase, setPhase] = useState(saved?.answers?.length ? 'gate' : 'intro')
  const [answers, setAnswers] = useState(() => (Array.isArray(saved?.answers) ? saved.answers : []))
  const [variant, setVariant] = useState(() => Number(saved?.variant) || 0)
  const [flash, setFlash] = useState(null)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(0)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const cores = useMemo(() => MIND_MIRROR_BANK.filter((q) => q.core), [])
  const coreOrder = useMemo(() => seededOrder(cores.length, variant * 3 + 7), [cores.length, variant])
  const ch2Ask = useMemo(
    () => seededOrder(CH2_BANK.length, variant * 5 + 21).slice(0, CH2_LEN).map((i) => CH2_BANK[i]),
    [variant],
  )

  const ch1NextFrom = (a1) => {
    if (a1.length >= CH1_LEN) return null
    const asked = new Set(a1.map((a) => a.id))
    for (const oi of coreOrder) { const q = cores[oi]; if (!asked.has(q.id)) return q }
    return mindMirrorNext(a1) || null
  }
  const ch2NextFrom = (a2) => {
    const asked = new Set(a2.map((a) => a.id))
    for (const q of ch2Ask) if (!asked.has(q.id)) return q
    return null
  }

  const ch1a = useMemo(() => answers.filter((a) => a.ch === 1), [answers])
  const ch2a = useMemo(() => answers.filter((a) => a.ch === 2), [answers])
  const q1 = ch1NextFrom(ch1a)
  const curChapter = q1 ? 1 : 2
  const question = q1 || ch2NextFrom(ch2a)
  const finished = phase === 'reveal'

  const loadsOf = (list) => {
    const l1 = answersToLoadings(list.filter((a) => a.ch === 1))
    const l2 = list.filter((a) => a.ch === 2)
      .map((a) => ch2ById[a.id]?.options.find((o) => o.key === a.key)?.loadings)
      .filter(Boolean)
    return [...l1, ...l2]
  }
  const profile = useMemo(() => scoreProfile(loadsOf(answers), { source: 'mindMirror' }), [answers])

  useEffect(() => {
    const started2 = answers.some((a) => a.ch === 2)
    onScoreRef.current?.(answers.length * PER_Q + (started2 ? CHAPTER_BONUS : 0) + (finished ? FINISH_BONUS : 0))
  }, [answers, finished])

  const persist = (next, v, done) => {
    const stage = next.some((a) => a.ch === 2) ? 2 : 1
    const state = { v: STATE_V, game: 'mindMirror', chapter: stage, stage, variant: v, answers: next, done, at: Date.now() }
    if (done) {
      const p = scoreProfile(loadsOf(next), { source: 'mindMirror' })
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

  const answer = (key) => {
    if (!question || flash || phase !== 'play') return
    play('click')
    setFlash(key)
    timerRef.current = setTimeout(() => {
      const next = [...answers, { ch: curChapter, id: question.id, key }]
      setFlash(null)
      setAnswers(next)
      const n1 = next.filter((a) => a.ch === 1)
      const n2 = next.filter((a) => a.ch === 2)
      const after1 = ch1NextFrom(n1)
      const after2 = ch2NextFrom(n2)
      if (!after1 && !after2) { persist(next, variant, true); play('win'); setPhase('reveal'); return }
      persist(next, variant, false)
      if (!after1 && n2.length === 0) { play('turn'); setPhase('beat') }
    }, 250)
  }

  const arch = useMemo(() => archetypeCopy(profile.archetype, tenant), [profile.archetype, tenant])
  const alt = useMemo(() => archetypeCopy(profile.alt, tenant), [profile.alt, tenant])
  const recs = useMemo(
    () => (finished ? recommendItems(profile, items, tenant, { limit: 3, lang }) : []),
    [finished, profile, items, tenant, lang],
  )

  const doShare = async () => {
    const top = profile.topTraits.slice(0, 3)
      .map((x) => (x.dir === 'high' ? traitById(x.id)?.high : traitById(x.id)?.low)).join(' | ')
    const text = `${t.cardLine}: ${arch?.ar || ''}\n${top}\n${tenant?.name || ''}`.trim()
    try {
      if (navigator.share) { await navigator.share({ text }); return }
      await navigator.clipboard.writeText(text)
      setCopied(true)
      timerRef.current = setTimeout(() => setCopied(false), 1800)
    } catch { /* dismissed */ }
  }

  const chLen = curChapter === 1 ? CH1_LEN : CH2_LEN
  const chAnswered = curChapter === 1 ? ch1a.length : ch2a.length
  const chName = curChapter === 1 ? t.ch1 : t.ch2
  const topT = profile.topTraits[0]
  const headline = topT && topT.confidence > 0.12
    ? (topT.dir === 'high' ? traitById(topT.id)?.high : traitById(topT.id)?.low)
    : t.forming

  const radarAxes = TRAITS
  const Dash = (
    <>
      <div className="ig-dash ig-dash-phone">
        <div className="ig-dash-radar ig-pulse" key={`p${answers.length}`}>
          <Radar traits={profile.traits} axes={radarAxes} brand={brand} uid={`${uid}p`} />
        </div>
        <div className="ig-headline">{t.clearest}: <b>{headline}</b></div>
      </div>
      <div className="ig-dash ig-dash-wide">
        <div className="ig-dash-title">{t.live}</div>
        <div className="ig-dash-radar ig-pulse" key={`w${answers.length}`}>
          <Radar traits={profile.traits} axes={radarAxes} brand={brand} uid={`${uid}w`} />
        </div>
        <div className="ig-meters">
          {TRAITS.map((tr) => (
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
          <span className="ig-chapter">
            <span className="ig-cnum">{t.chLine(curChapter, 2, chName)}</span>
          </span>
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
              : <span className="ig-kicker"><Icon name="sparkles" size={14} /> {ar ? 'بصيرة' : 'Insight'}</span>}
            <h2 className="ig-title">{t.title}</h2>
            <p className="ig-sub">{t.how}</p>
            <div className="ig-chips">
              <span className="ig-chip">{t.preview1}</span>
              <span className="ig-chip">{t.preview2}</span>
            </div>
            <div className="ig-btnrow">
              {phase === 'gate' && (
                <button type="button" className="ig-btn gold" onClick={() => begin(false)}>
                  <Icon name="play" size={18} /> {t.resume}
                </button>
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
            <div className="ig-beat-seal ig-pop">
              <Emblem id={`mm-chapter-2-${variant}`} brand={brand} uid={`${uid}beat`} />
            </div>
            <span className="ig-beat-k">{t.beatK}</span>
            <h3 className="ig-beat-t">{t.beatT}</h3>
            <p className="ig-beat-s">{t.beatS}</p>
            <button type="button" className="ig-btn" onClick={() => { play('turn'); setPhase('play') }}>
              {t.beatBtn} <Icon name="next" size={18} />
            </button>
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
                <p className="ig-q">{question.text}</p>
                <div className="ig-opts">
                  {question.options.map((o, i) => {
                    const cls = flash ? (flash === o.key ? ' picked' : ' faded') : ''
                    return (
                      <button key={o.key} type="button" className={`ig-opt${cls}`} disabled={!!flash} onClick={() => answer(o.key)}>
                        <span className="ig-opt-k">{arNum(i + 1)}</span>
                        <span>{o.label}</span>
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
                <div className={`ig-emblem${reduceMotion ? '' : ' ig-emblem-float'}`}>
                  <Emblem id={profile.archetype?.id || 'x'} brand={brand} uid={`${uid}hero`} />
                </div>
                <span className="ig-hero-type">{t.yourType}</span>
                <h2 className="ig-arch">{arch?.ar}</h2>
                <span className="ig-fit"><Icon name="check" size={14} /> {t.fit(Math.round((profile.archetypeFit || 0) * 100))}</span>
                {alt && alt.id !== arch?.id && <span className="ig-fit">{t.alt(alt.ar)}</span>}
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
                <h3 className="ig-sec-h"><Icon name="orders" size={15} /> {t.order}</h3>
                <p className="ig-body">{arch?.venue}</p>
              </section>

              <section className="ig-sec">
                <h3 className="ig-sec-h"><Icon name="chartBar" size={15} /> {t.axes}<span className="ig-sec-tail">{t.conf(Math.round((profile.confidence || 0) * 100))}</span></h3>
                <div className="ig-meters">
                  {TRAITS.map((tr) => (
                    <Meter key={tr.id} tr={tr} v={profile.traits[tr.id] ?? 0.5} conf={profile.traitConfidence[tr.id] ?? 0} ar={ar} lowConfText={t.lowConf} />
                  ))}
                </div>
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

              {recs.length > 0 && (
                <section className="ig-sec">
                  <h3 className="ig-sec-h"><Icon name="heart" size={15} /> {t.recs} {lex(tenant, 'menu')}</h3>
                  <div className="ig-recs">
                    {recs.map((r) => (
                      <div className="ig-rec" key={String(r.item.id)}>
                        <span className="ig-rec-media">
                          {r.item.imageUrl ? <img src={r.item.imageUrl} alt="" loading="lazy" /> : <Icon name="coffee" size={22} />}
                        </span>
                        <span className="ig-rec-body">
                          <span className="ig-rec-nm">{r.name}</span>
                          <span className="ig-rec-why">{r.reason}</span>
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
                <button type="button" className="ig-btn gold" onClick={() => begin(true)}>
                  <Icon name="repeat" size={16} /> {t.again}
                </button>
                {onExit && (
                  <button type="button" className="ig-btn ghost" onClick={onExit}>
                    <Icon name="ok" size={16} /> {t.done}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
