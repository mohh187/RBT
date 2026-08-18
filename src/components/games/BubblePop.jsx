// «فقاعات الشاي» — a staged tapioca-pearl popper. Pearls rise through the tea and
// stack under the lid. Tapping a pearl pops it together with every same-coloured
// pearl it touches (a flood fill through the contact graph); the score grows with
// the SQUARE of the chain, so a long chain is worth far more than its parts. Each
// pearl entering the cup lifts the tea; a lone pop shoves it up while big chains
// relieve it. Overflow spills the cup and costs a LIFE (three of them).
//
// STAGES («مراحل»): a real ladder. Every cup adds an element and rises faster:
// more colours, then FROZEN pearls (can't be tapped — a pop beside them cracks
// them), then BOMB pearls (tap to blow a whole neighbourhood, any colour). A cup
// clears once you reach its score target; a banner marks the beat, the cup drains
// as a reward, and the reached stage is saved via onProgress (resume continues).
//
// CONTRACT (hub-rendered): fills its parent, play area only, ABSOLUTE score via
// onScore(). Canvas paths only — no emojis, Latin digits, Arabic copy, pointer
// events, one rAF loop, dPR aware, fully torn down on unmount.
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { play } from '../../lib/gameSounds.js'
import '../../styles/arcade-a.css'

const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

const BEST_KEY = 'rbt_game_bubblepop_best'
const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch (_) { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)) } catch (_) { /* private mode */ } }

const TAU = Math.PI * 2
const MAXB = 66
const START_LIVES = 3
const COLORS = ['#43261a', '#8e6bb8', '#4f9d55', '#d4557f', '#e0913a']
const LIGHT = ['#7a4a30', '#b394d8', '#7cc47f', '#ee87a6', '#f5b463']
const OVERFLOW = 0.12 // the cup spills when the tea surface passes this fraction

// chain -> points: quadratic, with a kicker once the chain gets big
const chainScore = (n) => Math.round(5 * n * n * (n >= 6 ? 1.5 : 1))

// The cup ladder. `target` clears the stage; `colors` how many pearl colours are
// live; `rise` scales the pressure climb; `ice`/`bomb` gate the new elements.
const STAGES = [
  { ar: 'كوب البداية', en: 'First cup', target: 120, colors: 3, rise: 1.0, ice: false, bomb: false },
  { ar: 'كوب مزدحم', en: 'Busy cup', target: 230, colors: 4, rise: 1.14, ice: false, bomb: false },
  { ar: 'اللؤلؤ المتجمد', en: 'Frozen pearls', target: 360, colors: 5, rise: 1.28, ice: true, bomb: false },
  { ar: 'قنابل التابيوكا', en: 'Tapioca bombs', target: 500, colors: 5, rise: 1.42, ice: true, bomb: true },
  { ar: 'الطوفان', en: 'The flood', target: 660, colors: 5, rise: 1.58, ice: true, bomb: true },
]
function stageAt(i) {
  if (i < STAGES.length) return STAGES[i]
  const b = STAGES[STAGES.length - 1]
  const over = i - STAGES.length + 1
  return { ar: b.ar, en: b.en, target: b.target + over * 190, colors: 5, rise: b.rise + over * 0.16, ice: true, bomb: true }
}
const stageLabel = (n, lang) => (lang === 'en' ? stageAt(n - 1).en : stageAt(n - 1).ar)

const TXT = {
  ar: {
    title: 'فقاعات الشاي',
    how: 'اضغط على فقاعة لتفجيرها مع كل الفقاعات الملاصقة لها بنفس اللون. السلاسل الكبيرة تضاعف النقاط وتخفض ضغط الكوب. لا تدع الشاي يتجاوز الخط.',
    start: 'ابدأ',
    again: 'العب مجدداً',
    cont: 'تابع من المرحلة',
    fresh: 'من البداية',
    over: 'طفح الكوب',
    lives: 'المحاولات',
    stage: 'المرحلة',
    reached: 'أبعد مرحلة',
    chain: 'أطول سلسلة',
    best: 'أفضل نتيجة',
    record: 'رقم قياسي جديد',
    pressure: 'الضغط',
    cleared: 'مرحلة مكتملة',
    tap: 'اضغط على الفقاعات',
    hintIce: 'فجّر فقاعة بجانب المتجمدة ليتشقق جليدها',
    hintBomb: 'فقاعة قنبلة: اضغطها لتفجير كل ما حولها',
    ice: 'تشقق الجليد',
    boom: 'انفجار',
    chainT: 'سلسلة',
  },
  en: {
    title: 'BubblePop',
    how: 'Tap a pearl to pop it with every touching pearl of the same colour. Long chains multiply the score and relieve the cup. Do not let the tea cross the line.',
    start: 'Start',
    again: 'Play again',
    cont: 'Continue from stage',
    fresh: 'From the start',
    over: 'The cup overflowed',
    lives: 'Lives',
    stage: 'Stage',
    reached: 'Best stage',
    chain: 'Best chain',
    best: 'Best score',
    record: 'New record',
    pressure: 'Pressure',
    cleared: 'Stage cleared',
    tap: 'Tap the pearls',
    hintIce: 'Pop a pearl beside a frozen one to crack its ice',
    hintBomb: 'Bomb pearl: tap it to blow up everything around it',
    ice: 'Ice cracked',
    boom: 'Boom',
    chainT: 'Chain',
  },
}

const freshEvents = () => ({ score: -1, pressure: -1, prog: -1, life: -1, stageClear: -1, bestChain: -1, bigPop: null, hint: '', end: false })

function Heart({ lost, hit }) {
  return (
    <svg className={`arc-life${lost ? ' is-lost' : ''}${hit ? ' is-hit' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 21s-7.5-4.7-10-9.3C.4 8.4 2 4.7 5.4 4.7c2 0 3.4 1.2 4.2 2.5.4.6 1.4.6 1.8 0 .8-1.3 2.2-2.5 4.2-2.5 3.4 0 5 3.7 3.4 7C19.5 16.3 12 21 12 21Z" />
    </svg>
  )
}

export default function BubblePop({
  onScore, onExit, onProgress, resumeState,
  lang = 'ar', brand = '#0e7490', items = [], playerName = '',
}) {
  const t = TXT[lang] || TXT.ar
  const rootRef = useRef(null)
  const cvsRef = useRef(null)
  const gStRef = useRef(null)          // the live engine state, for the sync loop
  const startRef = useRef(() => {})
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  const brandRef = useRef(brand)
  const phaseRef = useRef('ready')

  const resumeStage = Math.max(0, Math.floor(Number(resumeState?.stage) || 0))
  const [phase, setPhase] = useState('ready')
  const [score, setScore] = useState(0)
  const [pressure, setPressure] = useState(0)
  const [lives, setLives] = useState(START_LIVES)
  const [lostAt, setLostAt] = useState(-1)
  const [stage, setStage] = useState(1)
  const [stageName, setStageName] = useState('')
  const [prog, setProg] = useState(0)
  const [bestChain, setBestChain] = useState(0)
  const [reached, setReached] = useState(1)
  const [banner, setBanner] = useState(null)
  const [toasts, setToasts] = useState([])
  const [hint, setHint] = useState('')
  const [best, setBest] = useState(readBest)
  const toastId = useRef(0)
  const bannerTimer = useRef(null)
  const hintTimer = useRef(null)

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])
  useEffect(() => { brandRef.current = brand }, [brand])
  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => () => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    if (hintTimer.current) clearTimeout(hintTimer.current)
  }, [])

  const pushToast = (text, kind) => {
    toastId.current += 1
    const id = toastId.current
    setToasts((list) => [...list.slice(-2), { id, text, kind }])
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 1100)
  }
  const showBanner = (n, name) => {
    setBanner({ n, name })
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    bannerTimer.current = setTimeout(() => setBanner(null), 1650)
  }
  const showHint = (text) => {
    setHint(text)
    if (hintTimer.current) clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setHint(''), 2600)
  }

  const drinkName = (() => {
    const list = Array.isArray(items) ? items : []
    const hit = list.find((it) => /شاي|بوبا|فقاع|تابيوكا|حليب|مثلج/.test(String((it && it.nameAr) || '')))
    const nm = String((hit && (hit.nameAr || hit.nameEn)) || '').trim()
    return nm && nm.length <= 20 ? nm : (lang === 'en' ? 'Bubble tea' : 'شاي الفقاعات')
  })()

  const begin = (fromStage = 0) => {
    const idx = Math.max(0, fromStage - 1)
    setScore(0)
    setPressure(0)
    setLives(START_LIVES)
    setLostAt(-1)
    setStage(idx + 1)
    setStageName(stageLabel(idx + 1, lang))
    setProg(0)
    setBestChain(0)
    setReached(idx + 1)
    onScoreRef.current?.(0)
    setPhase('play')
    startRef.current(idx)
    play('deal', { gain: 0.5 })
    if (idx > 0) showBanner(idx + 1, stageLabel(idx + 1, lang))
  }

  useEffect(() => {
    const root = rootRef.current
    const cvs = cvsRef.current
    if (!root || !cvs) return undefined
    const ctx = cvs.getContext('2d')
    const rm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const st = {
      w: 0, h: 0, raf: 0, last: 0, rm, phase: 'ready', S: 1, top: 48,
      bs: new Array(MAXB), parts: [], pops: [],
      stamp: new Int32Array(MAXB), queue: new Int32Array(MAXB), chain: new Int32Array(MAXB), gen: 0,
      P: 0, elapsed: 0, nextSpawn: 0, score: 0, stageScore: 0, stageIdx: 0, lives: START_LIVES,
      reached: 1, bestChain: 0, invuln: 0, wave: 0, shownP: -1, teaY: 0, shake: 0, relief: 0,
      seen: new Set(), ev: freshEvents(),
    }
    for (let i = 0; i < MAXB; i++) {
      st.bs[i] = { alive: false, popping: false, ice: false, bomb: false, x: 0, y: 0, vx: 0, vy: 0, r: 12, c: 0, ph: 0, pop: 0 }
    }

    const cfg = () => stageAt(st.stageIdx)
    const teaSurface = () => st.h - st.h * (0.20 + st.P * (1 - OVERFLOW - 0.20))
    const pearlBase = () => Math.max(12 * st.S, Math.min(st.w * 0.055, 30 * st.S))

    const aliveCount = () => {
      let n = 0
      for (let i = 0; i < MAXB; i++) if (st.bs[i].alive) n += 1
      return n
    }

    const spawn = () => {
      let slot = -1
      for (let i = 0; i < MAXB; i++) if (!st.bs[i].alive) { slot = i; break }
      if (slot < 0) return
      const c = cfg()
      const b = st.bs[slot]
      const base = pearlBase()
      b.alive = true
      b.popping = false
      b.pop = 0
      b.ice = false
      b.bomb = false
      const roll = Math.random()
      if (c.ice && roll < 0.07) b.ice = true
      else if (c.bomb && roll < 0.07 + 0.055) b.bomb = true
      if (b.ice && !st.seen.has('ice')) { st.seen.add('ice'); st.ev.hint = t.hintIce }
      if (b.bomb && !st.seen.has('bomb')) { st.seen.add('bomb'); st.ev.hint = t.hintBomb }
      b.r = base * (0.86 + Math.random() * 0.28)
      b.x = b.r + Math.random() * Math.max(1, st.w - b.r * 2)
      b.y = Math.min(st.h - b.r, st.teaY + b.r + 6 + Math.random() * 30 * st.S)
      b.vx = (Math.random() - 0.5) * 24 * st.S
      b.vy = -(30 + Math.random() * 20) * st.S
      b.c = Math.floor(Math.random() * c.colors)
      b.ph = Math.random() * TAU
      st.P = Math.min(1, st.P + 0.012 * c.rise)
    }

    const start = (fromStage = 0) => {
      const idx = Math.max(0, fromStage)
      for (let i = 0; i < MAXB; i++) st.bs[i].alive = false
      st.parts.length = 0
      st.pops.length = 0
      st.P = 0
      st.elapsed = 0
      st.nextSpawn = 0
      st.score = 0
      st.stageScore = 0
      st.stageIdx = idx
      st.lives = START_LIVES
      st.reached = idx + 1
      st.bestChain = 0
      st.invuln = 0
      st.shownP = -1
      st.shake = 0
      st.relief = 0
      st.seen = new Set()
      st.ev = freshEvents()
      st.teaY = st.h * 0.8
      st.phase = 'play'
      for (let i = 0; i < 12; i++) spawn()
      st.P = 0
    }
    startRef.current = (fromStage) => { start(fromStage); }

    const burst = (b) => {
      const n = st.rm ? 4 : 10
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + Math.random()
        const sp = (60 + Math.random() * 150) * st.S
        st.parts.push({
          x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40 * st.S,
          r: (1.8 + Math.random() * 3.2) * st.S, t: 0, life: 0.4 + Math.random() * 0.4, c: b.ice ? 1 : b.c,
        })
      }
      st.pops.push({ x: b.x, y: b.y, r: b.r, t: 0, c: b.c })
    }

    // flood fill through touching, same-coloured pearls (ice/bomb are walls)
    const collect = (idx) => {
      st.gen += 1
      const g = st.gen
      const col = st.bs[idx].c
      let qh = 0
      let qt = 0
      let cn = 0
      st.queue[qt++] = idx
      st.stamp[idx] = g
      while (qh < qt) {
        const i = st.queue[qh++]
        st.chain[cn++] = i
        const a = st.bs[i]
        for (let j = 0; j < MAXB; j++) {
          if (st.stamp[j] === g) continue
          const b = st.bs[j]
          if (!b.alive || b.popping || b.ice || b.bomb || b.c !== col) continue
          const dx = a.x - b.x
          const dy = a.y - b.y
          const reach = a.r + b.r + 9 * st.S
          if (dx * dx + dy * dy <= reach * reach) { st.stamp[j] = g; st.queue[qt++] = j }
        }
      }
      return cn
    }

    // crack any frozen pearl touching a just-popped pearl (chain held in st.chain)
    const crackIce = (n) => {
      let cracked = 0
      for (let j = 0; j < MAXB; j++) {
        const b = st.bs[j]
        if (!b.alive || b.popping || !b.ice) continue
        for (let k = 0; k < n; k++) {
          const a = st.bs[st.chain[k]]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const reach = a.r + b.r + 12 * st.S
          if (dx * dx + dy * dy <= reach * reach) {
            b.ice = false
            b.c = Math.floor(Math.random() * cfg().colors)
            cracked += 1
            break
          }
        }
      }
      if (cracked && !st.seen.has('cracked')) { st.seen.add('cracked'); st.ev.bigPop = { n: cracked, txt: t.ice } }
    }

    const detonate = (idx) => {
      const centre = st.bs[idx]
      const rad = centre.r * 3.4
      let cn = 0
      for (let j = 0; j < MAXB; j++) {
        const b = st.bs[j]
        if (!b.alive || b.popping) continue
        const dx = b.x - centre.x
        const dy = b.y - centre.y
        if (dx * dx + dy * dy <= rad * rad) { st.chain[cn++] = j }
      }
      let sx = 0
      let sy = 0
      for (let k = 0; k < cn; k++) {
        const b = st.bs[st.chain[k]]
        b.popping = true
        b.pop = 1
        burst(b)
        sx += b.x
        sy += b.y
      }
      const gain = Math.round(chainScore(cn) * 1.2)
      st.score += gain
      st.stageScore += gain
      st.P = Math.max(0, st.P - Math.min(0.16, 0.02 * cn))
      st.relief = 1
      play('capture', { gain: 0.6 })
      if (!st.rm) st.shake = Math.min(1, cn / 8)
      st.pops.push({ x: sx / Math.max(1, cn), y: sy / Math.max(1, cn), r: 0, t: 0, c: centre.c, txt: `+${gain}`, chain: cn })
      st.ev.bigPop = { n: cn, gain, txt: t.boom, boom: true }
      st.ev.score = st.score
      checkClear()
    }

    const checkClear = () => {
      const c = cfg()
      if (st.stageScore >= c.target) {
        st.stageIdx += 1
        st.stageScore = 0
        st.reached = Math.max(st.reached, st.stageIdx + 1)
        st.P = Math.max(0, st.P - 0.32)
        st.relief = 1
        st.ev.stageClear = st.stageIdx + 1
        play('win', { gain: 0.5 })
      }
      st.ev.prog = Math.max(0, Math.min(1, st.stageScore / cfg().target))
    }

    const popAt = (px, py) => {
      let hit = -1
      let bestD = Infinity
      for (let i = 0; i < MAXB; i++) {
        const b = st.bs[i]
        if (!b.alive || b.popping) continue
        const dx = b.x - px
        const dy = b.y - py
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d <= b.r + 10 * st.S && d < bestD) { bestD = d; hit = i }
      }
      if (hit < 0) return
      const target = st.bs[hit]
      if (target.bomb) { detonate(hit); return }
      if (target.ice) {
        if (!st.rm) st.shake = Math.min(st.shake + 0.25, 0.5)
        st.ev.hint = t.hintIce
        play('click', { gain: 0.3 })
        return
      }
      const n = collect(hit)
      let sx = 0
      let sy = 0
      for (let k = 0; k < n; k++) {
        const b = st.bs[st.chain[k]]
        b.popping = true
        b.pop = 1
        burst(b)
        sx += b.x
        sy += b.y
      }
      crackIce(n)
      const gain = chainScore(n)
      st.score += gain
      st.stageScore += gain
      if (n > st.bestChain) { st.bestChain = n; st.ev.bestChain = n }

      if (n === 1) st.P = Math.min(1, st.P + 0.05)
      else if (n === 2) st.P = Math.min(1, st.P + 0.015)
      else { st.P = Math.max(0, st.P - Math.min(0.10, 0.012 * (n - 2))); st.relief = 1 }
      play('card', { gain: Math.min(1, 0.32 + n * 0.1) })
      if (n >= 4 && !st.rm) st.shake = Math.min(1, n / 10)
      if (n >= 4) st.ev.bigPop = { n, gain, txt: `${t.chainT} ${n}` }

      st.pops.push({ x: sx / n, y: sy / n, r: 0, t: 0, c: st.bs[st.chain[0]].c, txt: `+${gain}`, chain: n })
      st.ev.score = st.score
      checkClear()
    }

    const onDown = (e) => {
      if (st.phase !== 'play') return
      e.preventDefault()
      const b = cvs.getBoundingClientRect()
      popAt(e.clientX - b.left, e.clientY - b.top)
    }
    cvs.addEventListener('pointerdown', onDown)

    const resize = () => {
      const box = root.getBoundingClientRect()
      st.w = Math.max(1, Math.round(box.width))
      st.h = Math.max(1, Math.round(box.height))
      st.S = Math.max(0.82, Math.min(2.2, st.h / 720))
      st.top = Math.max(48, Math.min(104, 46 * st.S + 12))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cvs.width = Math.round(st.w * dpr)
      cvs.height = Math.round(st.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (!st.teaY) st.teaY = st.h * 0.8
    }

    const spill = () => {
      st.lives = Math.max(0, st.lives - 1)
      st.ev.life = st.lives
      st.P = 0.32
      st.relief = 1
      st.invuln = 0.6
      if (!st.rm) st.shake = 0.8
      play('lose', { gain: 0.5 })
      if (st.lives <= 0) { st.phase = 'over'; st.ev.end = true }
    }

    const step = (dt) => {
      const c = cfg()
      st.elapsed += dt
      if (st.invuln > 0) st.invuln -= dt
      st.teaY = teaSurface()

      st.nextSpawn -= dt
      if (st.nextSpawn <= 0) {
        st.nextSpawn = Math.max(0.28, (0.95 - st.elapsed * 0.012) / c.rise)
        if (aliveCount() < MAXB - 2) spawn()
        else st.P = Math.min(1, st.P + 0.02 * c.rise)
      }

      const top = st.top
      for (let i = 0; i < MAXB; i++) {
        const b = st.bs[i]
        if (!b.alive) continue
        if (b.popping) {
          b.pop -= dt * 6
          if (b.pop <= 0) { b.alive = false; b.popping = false }
          continue
        }
        b.vy -= 300 * st.S * dt
        if (b.vy < -95 * st.S) b.vy = -95 * st.S
        b.vx *= 0.985
        b.vy *= 0.992
        b.x += b.vx * dt
        b.y += b.vy * dt
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.45 }
        else if (b.x > st.w - b.r) { b.x = st.w - b.r; b.vx = -Math.abs(b.vx) * 0.45 }
        if (b.y < top + b.r) { b.y = top + b.r; b.vy = 0 }
        else if (b.y > st.h - b.r) { b.y = st.h - b.r; b.vy = Math.min(0, b.vy) }
      }

      // two relaxation passes are plenty for a soft, jelly-ish pile
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < MAXB; i++) {
          const a = st.bs[i]
          if (!a.alive || a.popping) continue
          for (let j = i + 1; j < MAXB; j++) {
            const b = st.bs[j]
            if (!b.alive || b.popping) continue
            let dx = b.x - a.x
            let dy = b.y - a.y
            const min = a.r + b.r
            const d2 = dx * dx + dy * dy
            if (d2 >= min * min || d2 < 1e-4) continue
            const d = Math.sqrt(d2)
            const push = (min - d) * 0.5
            dx /= d
            dy /= d
            a.x -= dx * push
            a.y -= dy * push
            b.x += dx * push
            b.y += dy * push
            const rel = (b.vy - a.vy) * 0.1
            a.vy += rel
            b.vy -= rel
          }
        }
      }

      for (let i = st.parts.length - 1; i >= 0; i--) {
        const p = st.parts[i]
        p.t += dt
        p.vy += 620 * st.S * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        if (p.t >= p.life) st.parts.splice(i, 1)
      }
      for (let i = st.pops.length - 1; i >= 0; i--) {
        const p = st.pops[i]
        p.t += dt
        if (p.t >= (p.txt ? 1.0 : 0.45)) st.pops.splice(i, 1)
      }
      st.shake = Math.max(0, st.shake - dt * 3)
      st.relief = Math.max(0, st.relief - dt * 1.6)

      const np = Math.round(st.P * 100)
      if (np !== st.shownP) { st.shownP = np; st.ev.pressure = np }
      if (st.teaY <= st.h * OVERFLOW && st.invuln <= 0) spill()
    }

    const drawPearl = (b) => {
      const jig = st.rm ? 1 : 1 + Math.sin(st.wave * 3 + b.ph) * 0.03
      const r = b.popping ? b.r * (1 + (1 - b.pop) * 0.7) : b.r * jig
      if (b.popping) ctx.globalAlpha = Math.max(0, b.pop)
      if (b.ice) {
        ctx.fillStyle = '#bfe3ef'
        ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,.75)'
        ctx.beginPath(); ctx.arc(b.x - r * 0.2, b.y - r * 0.24, r * 0.5, 0, TAU); ctx.fill()
        ctx.strokeStyle = 'rgba(120,180,210,.9)'
        ctx.lineWidth = 1.6 * st.S
        ctx.beginPath(); ctx.moveTo(b.x - r * 0.5, b.y); ctx.lineTo(b.x + r * 0.5, b.y)
        ctx.moveTo(b.x, b.y - r * 0.5); ctx.lineTo(b.x, b.y + r * 0.5)
        ctx.moveTo(b.x - r * 0.35, b.y - r * 0.35); ctx.lineTo(b.x + r * 0.35, b.y + r * 0.35)
        ctx.stroke()
      } else if (b.bomb) {
        ctx.fillStyle = '#1c1a24'
        ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill()
        const glow = 0.5 + (st.rm ? 0 : Math.sin(st.wave * 6 + b.ph) * 0.5)
        ctx.fillStyle = `rgba(231,120,60,${0.5 + glow * 0.5})`
        ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.42, 0, TAU); ctx.fill()
        ctx.strokeStyle = 'rgba(231,196,106,.9)'
        ctx.lineWidth = 2 * st.S
        ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.72, 0, TAU); ctx.stroke()
        ctx.fillStyle = 'rgba(255,255,255,.55)'
        ctx.beginPath(); ctx.arc(b.x - r * 0.3, b.y - r * 0.34, r * 0.16, 0, TAU); ctx.fill()
      } else {
        ctx.fillStyle = COLORS[b.c]
        ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill()
        ctx.fillStyle = LIGHT[b.c]
        ctx.beginPath(); ctx.arc(b.x - r * 0.16, b.y - r * 0.2, r * 0.62, 0, TAU); ctx.fill()
        ctx.fillStyle = COLORS[b.c]
        ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.52, 0, TAU); ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,.6)'
        ctx.beginPath(); ctx.arc(b.x - r * 0.34, b.y - r * 0.36, r * 0.2, 0, TAU); ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    const draw = () => {
      const { w, h } = st
      ctx.save()
      if (st.shake > 0.01) ctx.translate((Math.random() - 0.5) * 7 * st.shake, (Math.random() - 0.5) * 7 * st.shake)

      ctx.fillStyle = '#12212a'
      ctx.fillRect(-12, -12, w + 24, h + 24)
      ctx.globalAlpha = 0.2
      ctx.fillStyle = brandRef.current
      ctx.fillRect(0, 0, w, h)
      ctx.globalAlpha = 1

      // straw, behind the pearls
      ctx.save()
      ctx.globalAlpha = 0.24
      ctx.fillStyle = '#ffffff'
      ctx.translate(w * 0.74, 0)
      ctx.rotate(0.16)
      ctx.fillRect(-11 * st.S, st.top - 30 * st.S, 22 * st.S, h)
      ctx.restore()
      ctx.globalAlpha = 1

      // tea
      const ty = st.teaY
      const amp = st.rm ? 0 : 3.4 * st.S
      ctx.beginPath()
      ctx.moveTo(0, h)
      ctx.lineTo(0, ty)
      for (let x = 0; x <= w; x += 10) ctx.lineTo(x, ty + Math.sin(x * 0.032 + st.wave) * amp)
      ctx.lineTo(w, h)
      ctx.closePath()
      const tg = ctx.createLinearGradient(0, ty, 0, h)
      tg.addColorStop(0, 'rgba(214,176,132,.92)')
      tg.addColorStop(1, 'rgba(150,106,66,.96)')
      ctx.fillStyle = tg
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,.42)'
      ctx.lineWidth = 2 * st.S
      ctx.beginPath()
      ctx.moveTo(0, ty)
      for (let x = 0; x <= w; x += 10) ctx.lineTo(x, ty + Math.sin(x * 0.032 + st.wave) * amp)
      ctx.stroke()

      // overflow line
      const oy = h * OVERFLOW
      ctx.setLineDash([7, 6])
      ctx.strokeStyle = st.P > 0.75 ? 'rgba(255,110,90,.95)' : 'rgba(255,255,255,.35)'
      ctx.lineWidth = 2 * st.S
      ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(w, oy); ctx.stroke()
      ctx.setLineDash([])

      for (let i = 0; i < MAXB; i++) { const b = st.bs[i]; if (b.alive) drawPearl(b) }

      // pop rings + chain labels
      for (let i = 0; i < st.pops.length; i++) {
        const p = st.pops[i]
        if (p.txt) {
          const k = Math.min(1, p.t / 1.0)
          ctx.globalAlpha = 1 - k
          ctx.fillStyle = '#fff'
          ctx.font = `900 ${22 * st.S}px system-ui, "Segoe UI", Tahoma, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(p.txt, p.x, p.y - k * 40 * st.S)
          if (p.chain >= 3) {
            ctx.font = `800 ${12 * st.S}px system-ui, "Segoe UI", Tahoma, sans-serif`
            ctx.fillStyle = '#ffd166'
            ctx.fillText(`${t.chainT} ${p.chain}`, p.x, p.y - k * 40 * st.S + 19 * st.S)
          }
          ctx.globalAlpha = 1
        } else {
          const k = Math.min(1, p.t / 0.45)
          ctx.globalAlpha = (1 - k) * 0.8
          ctx.strokeStyle = LIGHT[p.c]
          ctx.lineWidth = 3 * st.S
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + k * 1.6), 0, TAU); ctx.stroke()
          ctx.globalAlpha = 1
        }
      }

      for (let i = 0; i < st.parts.length; i++) {
        const p = st.parts[i]
        ctx.globalAlpha = Math.max(0, 1 - p.t / p.life)
        ctx.fillStyle = LIGHT[p.c]
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill()
      }
      ctx.globalAlpha = 1

      if (st.relief > 0.01) {
        ctx.globalAlpha = st.relief * 0.18
        ctx.fillStyle = '#8ef0c0'
        ctx.fillRect(0, 0, w, h)
        ctx.globalAlpha = 1
      }

      ctx.strokeStyle = 'rgba(255,255,255,.16)'
      ctx.lineWidth = 3 * st.S
      ctx.strokeRect(1.5, 1.5, w - 3, h - 3)
      ctx.fillStyle = 'rgba(255,255,255,.4)'
      ctx.font = `700 ${11 * st.S}px system-ui, "Segoe UI", Tahoma, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(drinkName, w / 2, h - 6 * st.S)
      ctx.restore()
    }

    const frame = (now) => {
      st.raf = requestAnimationFrame(frame)
      const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 0
      st.last = now
      st.wave += dt * 1.5
      if (st.phase === 'play' && phaseRef.current === 'play') step(dt)
      draw()
    }

    resize()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
    if (ro) ro.observe(root)
    window.addEventListener('resize', resize)
    st.raf = requestAnimationFrame(frame)
    gStRef.current = st

    return () => {
      cancelAnimationFrame(st.raf)
      cvs.removeEventListener('pointerdown', onDown)
      window.removeEventListener('resize', resize)
      if (ro) ro.disconnect()
      gStRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- bridge the canvas event mailbox -> React ----
  useEffect(() => {
    if (phase !== 'play') return undefined
    let raf = 0
    const pump = () => {
      raf = requestAnimationFrame(pump)
      const st = gStRef.current
      if (!st || !st.ev) return
      const e = st.ev
      if (e.score >= 0) { const s = e.score; e.score = -1; setScore(s); onScoreRef.current?.(s) }
      if (e.pressure >= 0) { const p = e.pressure; e.pressure = -1; setPressure(p) }
      if (e.prog >= 0) { const p = e.prog; e.prog = -1; setProg(p) }
      if (e.bestChain >= 0) { const n = e.bestChain; e.bestChain = -1; setBestChain(n) }
      if (e.life >= 0) {
        const lv = e.life; e.life = -1
        setLives(lv); setLostAt(lv); setTimeout(() => setLostAt(-1), 500)
      }
      if (e.stageClear > 0) {
        const n = e.stageClear; e.stageClear = -1
        setStage(n); setReached((r) => Math.max(r, n)); setStageName(stageLabel(n, lang))
        showBanner(n, stageLabel(n, lang)); pushToast(t.cleared, 'plain')
        onProgressRef.current?.({ stage: n })
      }
      if (e.bigPop) { const bp = e.bigPop; e.bigPop = null; pushToast(`${bp.txt}${bp.gain ? ` +${bp.gain}` : ''}`, bp.boom ? 'gold' : 'plain') }
      if (e.hint) { const h = e.hint; e.hint = ''; showHint(h) }
      if (e.end) { e.end = false; finishRun() }
    }
    raf = requestAnimationFrame(pump)
    return () => cancelAnimationFrame(raf)
  }, [phase, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const finishRun = () => {
    const st = gStRef.current
    const s = st ? st.score : score
    const rc = st ? st.reached : reached
    const bc = st ? st.bestChain : bestChain
    setScore(s)
    setReached(rc)
    setBestChain(bc)
    onScoreRef.current?.(s)
    if (s > readBest()) { writeBest(s); setBest(s) }
    if (rc > 1) onProgressRef.current?.({ stage: rc })
    setPhase('over')
  }

  const rtl = lang !== 'en'
  const pressureHot = pressure >= 75

  return (
    <div ref={rootRef} className="arc-root" dir={rtl ? 'rtl' : 'ltr'} style={{ '--arc-brand': brand }}>
      <canvas ref={cvsRef} className="arc-canvas" />

      {phase === 'play' && (
        <div className="arc-hud">
          <div className="arc-hud-l">
            <span className="arc-stage">
              <span className="arc-stage-k">{t.stage}</span>
              <span className="arc-stage-n">{fmt(stage)}</span>
              {stageName ? <span className="arc-stage-nm">{stageName}</span> : null}
            </span>
            <span className="arc-track"><i style={{ transform: `scaleX(${prog})` }} /></span>
          </div>
          <div className="arc-hud-r">
            <span className={`arc-chip${pressureHot ? ' is-warn' : ''}`}>{t.pressure} {fmt(pressure)}%</span>
            <span className="arc-lives" aria-label={`${t.lives} ${lives}`}>
              {Array.from({ length: START_LIVES }).map((_, i) => (
                <Heart key={i} lost={i >= lives} hit={i === lostAt} />
              ))}
            </span>
          </div>
        </div>
      )}

      {phase === 'play' && toasts.length > 0 && (
        <div className="arc-toasts">
          {toasts.map((x) => (
            <span key={x.id} className={`arc-toast${x.kind === 'plain' ? ' is-plain' : ''}`}>{x.text}</span>
          ))}
        </div>
      )}

      {banner && phase === 'play' && (
        <div className="arc-banner">
          <div className="arc-banner-card">
            <span className="arc-banner-k">{t.stage}</span>
            <span className="arc-banner-num">{fmt(banner.n)}</span>
            {banner.name ? <span className="arc-banner-sub">{banner.name}</span> : null}
          </div>
        </div>
      )}

      {hint && phase === 'play' && (
        <div className="arc-hint"><span><Icon name="sparkles" size={15} />{hint}</span></div>
      )}

      {phase !== 'play' && (
        <div className="arc-veil">
          <div className="arc-card">
            {phase === 'ready' ? (
              <>
                <svg className="arc-emblem" viewBox="0 0 96 96" aria-hidden="true">
                  <circle cx="48" cy="48" r="46" fill="#123c35" stroke="#e7c46a" strokeWidth="2" />
                  <path d="M30 34 H66 L62 74 A6 6 0 0 1 56 80 H40 A6 6 0 0 1 34 74 Z" fill="rgba(214,176,132,.9)" />
                  <rect x="56" y="20" width="7" height="46" rx="3" fill="#fff" opacity="0.5" transform="rotate(12 59 43)" />
                  <circle cx="42" cy="64" r="7" fill="#43261a" />
                  <circle cx="56" cy="66" r="6" fill="#8e6bb8" />
                  <circle cx="49" cy="54" r="6" fill="#4f9d55" />
                  <circle cx="60" cy="55" r="5" fill="#d4557f" />
                </svg>
                <h3 className="arc-card-title">{t.title}</h3>
                <p className="arc-card-line">{t.how}</p>
                <div className="arc-how"><span><Icon name="sparkles" size={15} />{t.tap}</span></div>
                {best > 0 ? <p className="arc-sub">{t.best}: {fmt(best)}</p> : null}
                <div className="arc-actions">
                  {resumeStage > 1 ? (
                    <>
                      <button type="button" className="arc-btn is-gold" onClick={() => begin(resumeStage)}>
                        <Icon name="play" size={17} />{t.cont} {fmt(resumeStage)}
                      </button>
                      <button type="button" className="arc-btn ghost" onClick={() => begin(0)}>{t.fresh}</button>
                    </>
                  ) : (
                    <button type="button" className="arc-btn" onClick={() => begin(0)}>
                      <Icon name="play" size={17} />{t.start}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <h3 className="arc-card-title">{t.over}</h3>
                <div className="arc-card-big">{fmt(score)}</div>
                {score >= best && score > 0 ? (
                  <span className="arc-record"><Icon name="award" size={15} />{t.record}</span>
                ) : (
                  <p className="arc-sub">{t.best}: {fmt(best)}</p>
                )}
                <div className="arc-stats">
                  <span className="arc-stat is-record"><b>{fmt(reached)}</b><em>{t.reached}</em></span>
                  <span className="arc-stat"><b>{fmt(bestChain)}</b><em>{t.chain}</em></span>
                </div>
                <div className="arc-actions">
                  <button type="button" className="arc-btn" onClick={() => begin(0)}>
                    <Icon name="reload" size={17} />{t.again}
                  </button>
                  {reached > 1 ? (
                    <button type="button" className="arc-btn ghost" onClick={() => begin(reached)}>
                      {t.cont} {fmt(reached)}
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
