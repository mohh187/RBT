// «صياد البحر» — the order-waiting fishing game, now a STAGED catch. A boat
// glides on the swell; tap to drop the hook and reel a fish up. Each stage is a
// fishing ground with a catch quota and a countdown: fill the quota before the
// clock to clear it and dive into a harder ground — faster fish, then stinging
// jellyfish, then the current, then a rare golden fish. Miss the quota and you
// lose a line (three of them) and retry the same ground; a banner marks every
// beat and the deepest ground reached is kept on the device.
//
// This component PREDATES the games contract and is adapter-wrapped (see the
// FishingAdapter notes in src/lib/games.js). It therefore keeps its own props
// ({ open, onClose, tenantId, brand, onLeaderboard, onScore }), its `wg-overlay`
// root (the adapter positions it and hides the `wg-x` close in the hub), and its
// exported getBestScore — while everything visible is rebuilt to the house
// standard. Pure canvas (paths only, no assets), Latin digits, dpr-aware.
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { play } from '../lib/gameSounds.js'
import { useDismiss } from '../lib/useDismiss.js'
import '../styles/arcade-a.css'

const START_LIVES = 3
const FISH_COLORS = ['#ff8c42', '#4cc3ff', '#ffd166', '#8ecf6b', '#e06fae']

// The grounds ladder. `quota` fish clear the stage; `time` is the countdown;
// `speed` scales the swim speed; the flags gate big/gold fish, jellies, current.
const STAGES = [
  { ar: 'المياه الضحلة', en: 'Shallows', quota: 6, time: 30, speed: 1.0, big: false, gold: false, jelly: 0, current: 0 },
  { ar: 'الشعاب', en: 'The reef', quota: 8, time: 30, speed: 1.16, big: true, gold: false, jelly: 0.16, current: 0 },
  { ar: 'الأعماق', en: 'The deep', quota: 10, time: 32, speed: 1.3, big: true, gold: false, jelly: 0.22, current: 0.4 },
  { ar: 'التيار', en: 'The current', quota: 12, time: 34, speed: 1.42, big: true, gold: true, jelly: 0.2, current: 0.7 },
  { ar: 'الهاوية', en: 'The abyss', quota: 14, time: 36, speed: 1.58, big: true, gold: true, jelly: 0.28, current: 0.9 },
]
function stageAt(i) {
  if (i < STAGES.length) return STAGES[i]
  const b = STAGES[STAGES.length - 1]
  const o = i - STAGES.length + 1
  return { ar: b.ar, en: b.en, quota: b.quota + o * 2, time: b.time + o, speed: b.speed + o * 0.14, big: true, gold: true, jelly: Math.min(0.4, 0.28 + o * 0.03), current: Math.min(1.4, 0.9 + o * 0.15) }
}

const TXT = {
  ar: {
    title: 'صياد البحر',
    how: 'القارب يتحرك وحده. المس الشاشة لإنزال الصنارة واصطد أكبر عدد من الأسماك، واملأ حصّة كل مرحلة قبل نفاد الوقت لتغوص إلى مياه أعمق.',
    start: 'ابدأ الصيد',
    again: 'العب مجدداً',
    cont: 'تابع من المرحلة',
    fresh: 'من البداية',
    over: 'انتهت الخيوط',
    board: 'لوحة صدارة الشهر',
    lives: 'الخيوط',
    stage: 'المرحلة',
    reached: 'أبعد مرحلة',
    caught: 'الأسماك',
    best: 'أفضل نتيجة',
    record: 'رقم قياسي جديد',
    points: 'نقطة',
    time: 'الوقت',
    cleared: 'مرحلة مكتملة',
    retry: 'أعد المحاولة',
    tap: 'المس لإنزال الصنارة',
    hintJelly: 'قنديل البحر يقرصك ويُفلت صيدك، فتجنّبه',
    hintGold: 'السمكة الذهبية نادرة وثمينة',
    hintBig: 'السمكة الكبيرة تساوي نقاطاً أكثر',
    gold: 'سمكة ذهبية',
    sting: 'قرصة',
  },
  en: {
    title: 'Sea Fisher',
    how: 'The boat drifts on its own. Tap to drop the hook and land as many fish as you can, and fill each stage quota before the clock runs out to dive deeper.',
    start: 'Start fishing',
    again: 'Play again',
    cont: 'Continue from stage',
    fresh: 'From the start',
    over: 'Out of lines',
    board: 'Monthly leaderboard',
    lives: 'Lines',
    stage: 'Stage',
    reached: 'Best stage',
    caught: 'Fish',
    best: 'Best score',
    record: 'New record',
    points: 'points',
    time: 'Time',
    cleared: 'Stage cleared',
    retry: 'Try again',
    tap: 'Tap to drop the hook',
    hintJelly: 'Jellyfish sting and drop your catch, so avoid them',
    hintGold: 'The golden fish is rare and valuable',
    hintBig: 'Big fish are worth more points',
    gold: 'Golden fish',
    sting: 'Sting',
  },
}

const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')
function bestKey(tid) { return `rbt_fishbest_${tid || 'x'}` }
function stageKey(tid) { return `rbt_fishstage_${tid || 'x'}` }
export function getBestScore(tid) {
  try { return Number(localStorage.getItem(bestKey(tid))) || 0 } catch (_) { return 0 }
}
const readReached = (tid) => { try { return Number(localStorage.getItem(stageKey(tid))) || 0 } catch (_) { return 0 } }
const writeReached = (tid, v) => { try { localStorage.setItem(stageKey(tid), String(v)) } catch (_) { /* storage off */ } }
const stageLabel = (n, lang) => (lang === 'en' ? stageAt(n - 1).en : stageAt(n - 1).ar)
const freshEvents = () => ({ score: -1, prog: -1, time: -1, life: -1, stageClear: -1, retry: false, gold: false, sting: false, hint: '', end: false })

function Heart({ lost, hit }) {
  return (
    <svg className={`arc-life${lost ? ' is-lost' : ''}${hit ? ' is-hit' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 21s-7.5-4.7-10-9.3C.4 8.4 2 4.7 5.4 4.7c2 0 3.4 1.2 4.2 2.5.4.6 1.4.6 1.8 0 .8-1.3 2.2-2.5 4.2-2.5 3.4 0 5 3.7 3.4 7C19.5 16.3 12 21 12 21Z" />
    </svg>
  )
}

// `onScore` lets a host (the games centre shell) mirror the live score in its
// own chrome; the standalone order-page usage simply omits it.
export default function WaitGame({ open, onClose, tenantId, brand = '#0e7490', lang = 'ar', embedded = false, onLeaderboard, onScore }) {
  const L = TXT[lang] || TXT.ar
  const canvasRef = useRef(null)
  const gRef = useRef(null)
  const onScoreRef = useRef(onScore)
  const phaseRef = useRef('ready')

  // Escape and the phone's Back gesture both close the game. Standalone on the
  // order page the `wg-x` button is the guest's only other way out, and the
  // canvas sets `touch-action: none`, so a guest who cannot see that button has
  // no exit at all — Back is the one control every phone user already trusts.
  //
  // Not when EMBEDDED: inside the hub the shell already owns one history entry
  // for "a game is running" (see GamesCenter). A second entry here would make
  // the guest press Back twice to leave one game, since `.gb-adapt` hides this
  // component's own close button anyway and the hub is the thing exiting.
  useDismiss(open && !embedded, onClose)

  const [phase, setPhase] = useState('ready')
  const [score, setScore] = useState(0)
  const [stage, setStage] = useState(1)
  const [stageName, setStageName] = useState('')
  const [prog, setProg] = useState(0)
  const [timeLeft, setTimeLeft] = useState(STAGES[0].time)
  const [lives, setLives] = useState(START_LIVES)
  const [lostAt, setLostAt] = useState(-1)
  const [caught, setCaught] = useState(0)
  const [reached, setReached] = useState(1)
  const [banner, setBanner] = useState(null)
  const [toasts, setToasts] = useState([])
  const [hint, setHint] = useState('')
  const [best, setBest] = useState(() => getBestScore(tenantId))
  const savedStage = readReached(tenantId)
  const toastId = useRef(0)
  const bannerTimer = useRef(null)
  const hintTimer = useRef(null)

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
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

  const begin = (fromStage = 0) => {
    const g = gRef.current
    if (!g) return
    const idx = Math.max(0, fromStage - 1)
    const c = stageAt(idx)
    g.fish = []
    g.jelly = []
    g.hook = null
    g.score = 0
    g.stageIdx = idx
    g.caught = 0
    g.tStage = c.time
    g.lives = START_LIVES
    g.reached = idx + 1
    g.elapsed = 0
    g.lastSpawn = 0
    g.seen = new Set()
    g.ev = freshEvents()
    setScore(0)
    setStage(idx + 1)
    setStageName(stageLabel(idx + 1, lang))
    setProg(0)
    setTimeLeft(c.time)
    setLives(START_LIVES)
    setLostAt(-1)
    setCaught(0)
    setReached(idx + 1)
    onScoreRef.current?.(0)
    setPhase('play')
    play('deal', { gain: 0.5 })
    if (idx > 0) showBanner(idx + 1, stageLabel(idx + 1, lang))
  }

  useEffect(() => {
    if (!open) return undefined
    const cvs = canvasRef.current
    if (!cvs) return undefined
    const ctx = cvs.getContext('2d')
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const g = {
      fish: [], jelly: [], hook: null, boatX: 0.5, boatDir: 1, score: 0, stageIdx: 0, caught: 0,
      tStage: STAGES[0].time, lives: START_LIVES, reached: 1, elapsed: 0, lastSpawn: 0,
      raf: 0, w: 0, h: 0, S: 1, last: 0, reduced, seen: new Set(), ev: freshEvents(), uiScore: -1, uiTime: -1,
    }
    gRef.current = g

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      g.w = cvs.clientWidth || 1
      g.h = cvs.clientHeight || 1
      cvs.width = Math.round(g.w * dpr)
      cvs.height = Math.round(g.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.S = Math.max(0.82, Math.min(2.4, g.h / 720))
    }
    resize()
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null
    ro?.observe(cvs)
    window.addEventListener('resize', resize)

    const cfg = () => stageAt(g.stageIdx)
    const seaTop = () => g.h * 0.22
    const boatY = () => seaTop() - 6 * g.S

    const spawn = (now) => {
      const gap = Math.max(430, 720 - g.stageIdx * 40)
      if (now - g.lastSpawn < gap) return
      g.lastSpawn = now
      const c = cfg()
      const y = seaTop() + 44 * g.S + Math.random() * (g.h - seaTop() - 100 * g.S)
      if (Math.random() < c.jelly && g.jelly.length < 4) {
        if (!g.seen.has('jelly')) { g.seen.add('jelly'); g.ev.hint = L.hintJelly }
        g.jelly.push({ x: Math.random() * g.w, y: g.h + 20 * g.S, vy: -(0.35 + Math.random() * 0.3), wob: Math.random() * 6 })
        return
      }
      if (g.fish.length >= 9) return
      const fromLeft = Math.random() < 0.5
      let kind = 'common'
      const roll = Math.random()
      if (c.gold && roll < 0.06) kind = 'gold'
      else if (c.big && roll < 0.28) kind = 'big'
      if (kind === 'gold' && !g.seen.has('gold')) { g.seen.add('gold'); g.ev.hint = L.hintGold }
      if (kind === 'big' && !g.seen.has('big')) { g.seen.add('big'); g.ev.hint = L.hintBig }
      const sizeMul = kind === 'big' ? 2.0 : (kind === 'gold' ? 1.3 : 1)
      const speedMul = kind === 'big' ? 0.72 : (kind === 'gold' ? 1.5 : 1)
      g.fish.push({
        x: fromLeft ? -40 * g.S : g.w + 40 * g.S,
        y,
        baseY: y,
        vx: (fromLeft ? 1 : -1) * (0.9 + Math.random() * 1.4) * c.speed * speedMul,
        size: (13 + Math.random() * 8) * sizeMul * g.S,
        color: kind === 'gold' ? '#ffd94a' : FISH_COLORS[Math.floor(Math.random() * FISH_COLORS.length)],
        pts: kind === 'big' ? 10 : (kind === 'gold' ? 30 : 3),
        kind,
        ph: Math.random() * 6.28,
      })
    }

    const drawFish = (f) => {
      ctx.save()
      ctx.translate(f.x, f.y)
      if (f.vx < 0) ctx.scale(-1, 1)
      if (f.kind === 'gold') { ctx.shadowColor = 'rgba(255,217,74,.85)'; ctx.shadowBlur = 12 * g.S }
      ctx.fillStyle = f.color
      ctx.beginPath()
      ctx.ellipse(0, 0, f.size, f.size * 0.55, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.beginPath()
      ctx.moveTo(-f.size, 0)
      ctx.lineTo(-f.size - f.size * 0.7, -f.size * 0.5)
      ctx.lineTo(-f.size - f.size * 0.7, f.size * 0.5)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#0d1b2a'
      ctx.beginPath()
      ctx.arc(f.size * 0.45, -f.size * 0.12, Math.max(1.6 * g.S, f.size * 0.09), 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    const drawJelly = (j, now) => {
      const S = g.S
      ctx.save()
      ctx.translate(j.x + Math.sin(now / 400 + j.wob) * 10 * S, j.y)
      ctx.fillStyle = 'rgba(214, 130, 255, 0.85)'
      ctx.beginPath()
      ctx.arc(0, 0, 14 * S, Math.PI, 0)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = 'rgba(214, 130, 255, 0.7)'
      ctx.lineWidth = 2 * S
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath()
        ctx.moveTo(i * 7 * S, 0)
        ctx.quadraticCurveTo(i * 7 * S + 3 * S, 9 * S, i * 7 * S, 17 * S)
        ctx.stroke()
      }
      ctx.restore()
    }

    const frame = (now) => {
      g.raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - (g.last || now)) / 1000)
      g.last = now
      const S = g.S
      const playing = phaseRef.current === 'play'
      const c = cfg()

      // sky + sea
      ctx.clearRect(0, 0, g.w, g.h)
      const sky = ctx.createLinearGradient(0, 0, 0, seaTop())
      sky.addColorStop(0, '#bfe7ff'); sky.addColorStop(1, '#e8f7ff')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, g.w, seaTop())
      const sea = ctx.createLinearGradient(0, seaTop(), 0, g.h)
      sea.addColorStop(0, '#2aa5d8')
      sea.addColorStop(1, `rgb(4, ${Math.max(24, 59 - g.stageIdx * 6)}, ${Math.max(48, 102 - g.stageIdx * 8)})`)
      ctx.fillStyle = sea
      ctx.fillRect(0, seaTop(), g.w, g.h - seaTop())
      // waves
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'
      ctx.lineWidth = 2 * S
      ctx.beginPath()
      for (let x = 0; x <= g.w; x += 6) {
        const y = seaTop() + Math.sin((x + now / 6) / 26) * 4 * S
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()

      if (playing) {
        g.elapsed += dt
        g.boatX += g.boatDir * 0.0022
        if (g.boatX > 0.86) g.boatDir = -1
        if (g.boatX < 0.14) g.boatDir = 1
        g.tStage -= dt
        if (g.tStage <= 0) {
          g.tStage = 0
          g.lives = Math.max(0, g.lives - 1)
          g.ev.life = g.lives
          if (g.lives <= 0) g.ev.end = true
          else {
            g.tStage = c.time
            g.caught = 0
            g.fish = []
            g.jelly = []
            g.hook = null
            g.ev.retry = true
          }
        }
      }

      const bx = g.boatX * g.w
      const by = boatY() + Math.sin(now / 300) * 2 * S

      if (playing) {
        spawn(now)
        g.fish.forEach((f) => {
          f.x += f.vx * (g.w / 420)
          if (c.current) f.y = f.baseY + Math.sin(g.elapsed * 1.2 + f.ph) * c.current * 22 * S
        })
        g.fish = g.fish.filter((f) => f.x > -80 * S && f.x < g.w + 80 * S)
        g.jelly.forEach((j) => { j.y += j.vy * (g.h / 400) })
        g.jelly = g.jelly.filter((j) => j.y > seaTop() - 12 * S)

        if (g.hook) {
          const hk = g.hook
          if (hk.mode === 'down') {
            hk.y += 4.6 * S
            for (const f of g.fish) {
              if (!hk.caught && Math.abs(f.x - hk.x) < f.size + 8 * S && Math.abs(f.y - hk.y) < f.size * 0.7 + 8 * S) {
                hk.caught = f
                g.fish = g.fish.filter((x) => x !== f)
                hk.mode = 'up'
                play('click', { gain: 0.5 })
                break
              }
            }
            for (const j of g.jelly) {
              if (Math.abs(j.x - hk.x) < 20 * S && Math.abs(j.y - hk.y) < 20 * S) {
                g.score = Math.max(0, g.score - 5)
                g.ev.score = g.score
                g.ev.gold = false
                hk.mode = 'up'
                hk.stung = true
                g.ev.sting = true
                play('lose', { gain: 0.45 })
                break
              }
            }
            if (hk.y > g.h - 8 * S) hk.mode = 'up'
          } else {
            hk.y -= 6.4 * S
            if (hk.caught) { hk.caught.x = hk.x; hk.caught.y = hk.y + hk.caught.size * 0.6 }
            if (hk.y <= by + 16 * S) {
              if (hk.caught) {
                const f = hk.caught
                g.score += f.pts
                g.caught += 1
                g.ev.score = g.score
                if (f.kind === 'gold') { g.ev.gold = true; play('win', { gain: 0.4 }) } else play('card', { gain: 0.4 })
                if (g.caught >= c.quota) {
                  const bonus = 40 * (g.stageIdx + 1)
                  g.score += bonus
                  g.stageIdx += 1
                  g.caught = 0
                  g.tStage = cfg().time
                  g.reached = Math.max(g.reached, g.stageIdx + 1)
                  g.ev.score = g.score
                  g.ev.stageClear = g.stageIdx + 1
                  play('win', { gain: 0.55 })
                }
              }
              g.hook = null
            }
          }
        }

        if (g.score !== g.uiScore) { g.uiScore = g.score; g.ev.score = g.score }
        const ti = Math.ceil(g.tStage)
        if (ti !== g.uiTime) { g.uiTime = ti; g.ev.time = ti }
        g.ev.prog = Math.max(0, Math.min(1, g.caught / c.quota))
      }

      // boat
      ctx.save()
      ctx.translate(bx, by)
      ctx.fillStyle = '#8a4b2d'
      ctx.beginPath()
      ctx.moveTo(-34 * S, 0); ctx.lineTo(34 * S, 0); ctx.lineTo(22 * S, 14 * S); ctx.lineTo(-22 * S, 14 * S)
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#f4f2ee'
      ctx.beginPath(); ctx.moveTo(0, -30 * S); ctx.lineTo(0, -2 * S); ctx.lineTo(22 * S, -2 * S); ctx.closePath(); ctx.fill()
      ctx.restore()

      g.fish.forEach(drawFish)
      g.jelly.forEach((j) => drawJelly(j, now))
      if (g.hook) {
        ctx.strokeStyle = '#e8e6e1'
        ctx.lineWidth = 1.5 * S
        ctx.beginPath(); ctx.moveTo(g.hook.x, by + 10 * S); ctx.lineTo(g.hook.x, g.hook.y); ctx.stroke()
        ctx.strokeStyle = g.hook.stung ? '#d666ff' : '#ffd166'
        ctx.lineWidth = 3 * S
        ctx.beginPath(); ctx.arc(g.hook.x, g.hook.y + 5 * S, 6 * S, -0.4, Math.PI * 1.1); ctx.stroke()
        if (g.hook.caught) drawFish(g.hook.caught)
      }
    }

    g.raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(g.raf)
      ro?.disconnect()
      window.removeEventListener('resize', resize)
      gRef.current = null
    }
  }, [open, tenantId, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- bridge the canvas event mailbox -> React ----
  useEffect(() => {
    if (!open || phase !== 'play') return undefined
    let raf = 0
    const pump = () => {
      raf = requestAnimationFrame(pump)
      const g = gRef.current
      if (!g || !g.ev) return
      const e = g.ev
      if (e.score >= 0) { const s = e.score; e.score = -1; setScore(s); onScoreRef.current?.(s) }
      if (e.time >= 0) { const ti = e.time; e.time = -1; setTimeLeft(ti) }
      if (e.prog >= 0) { const p = e.prog; e.prog = -1; setProg(p) }
      if (e.life >= 0) {
        const lv = e.life; e.life = -1
        setLives(lv); setLostAt(lv); setTimeout(() => setLostAt(-1), 500)
      }
      if (e.retry) { e.retry = false; showBanner(stage, L.retry); pushToast(L.retry, 'plain') }
      if (e.stageClear > 0) {
        const n = e.stageClear; e.stageClear = -1
        setStage(n); setReached((r) => Math.max(r, n)); setStageName(stageLabel(n, lang))
        setTimeLeft(stageAt(n - 1).time)
        showBanner(n, stageLabel(n, lang)); pushToast(L.cleared, 'plain')
        if (n > readReached(tenantId)) writeReached(tenantId, n)
      }
      if (e.gold) { e.gold = false; pushToast(`${L.gold} +30`, 'gold') }
      if (e.sting) { e.sting = false; pushToast(`${L.sting} -5`, 'plain') }
      if (e.hint) { const h = e.hint; e.hint = ''; showHint(h) }
      if (e.end) { e.end = false; finishRun() }
    }
    raf = requestAnimationFrame(pump)
    return () => cancelAnimationFrame(raf)
  }, [open, phase, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const finishRun = () => {
    const g = gRef.current
    const s = g ? g.score : score
    const rc = g ? g.reached : reached
    setScore(s)
    setReached(rc)
    setCaught(g ? g.caught : caught)
    onScoreRef.current?.(s)
    setBest((b) => {
      const nb = Math.max(b, s)
      try { localStorage.setItem(bestKey(tenantId), String(nb)) } catch (_) { /* storage off */ }
      return nb
    })
    if (rc > readReached(tenantId)) writeReached(tenantId, rc)
    play('lose', { gain: 0.5 })
    setPhase('over')
  }

  const cast = () => {
    const g = gRef.current
    if (!g || phaseRef.current !== 'play' || g.hook) return
    g.hook = { x: g.boatX * g.w, y: g.h * 0.22 + 12 * g.S, mode: 'down', caught: null, stung: false }
    play('move', { gain: 0.4 })
  }

  if (!open) return null
  const rtl = lang !== 'en'
  const startStage = Math.max(savedStage, reached)
  const timeHot = timeLeft <= 10

  return (
    <div className="wg-overlay arc-fish" role="dialog" aria-modal="true" aria-label={L.title} dir={rtl ? 'rtl' : 'ltr'} style={{ '--arc-brand': brand }}>
      <button type="button" className="wg-x arc-x" onClick={onClose} aria-label={lang === 'en' ? 'Close' : 'إغلاق'}>
        <Icon name="close" size={20} />
      </button>
      <canvas ref={canvasRef} className="arc-canvas" onPointerDown={cast} />

      {phase === 'play' && (
        <div className="arc-hud">
          <div className="arc-hud-l">
            <span className="arc-stage">
              <span className="arc-stage-k">{L.stage}</span>
              <span className="arc-stage-n">{fmt(stage)}</span>
              {stageName ? <span className="arc-stage-nm">{stageName}</span> : null}
            </span>
            <span className="arc-track"><i style={{ transform: `scaleX(${prog})` }} /></span>
          </div>
          <div className="arc-hud-r">
            <span className={`arc-chip${timeHot ? ' is-warn' : ''}`}><Icon name="clock" size={14} />{fmt(timeLeft)}</span>
            <span className="arc-lives" aria-label={`${L.lives} ${lives}`}>
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
            <span className="arc-banner-k">{L.stage}</span>
            <span className="arc-banner-num">{fmt(banner.n)}</span>
            {banner.name ? <span className="arc-banner-sub">{banner.name}</span> : null}
          </div>
        </div>
      )}

      {hint && phase === 'play' && (
        <div className="arc-hint"><span><Icon name="warning" size={15} />{hint}</span></div>
      )}

      {phase !== 'play' && (
        <div className="arc-veil">
          <div className="arc-card">
            {phase === 'ready' ? (
              <>
                <svg className="arc-emblem" viewBox="0 0 96 96" aria-hidden="true">
                  <circle cx="48" cy="48" r="46" fill="#0b3a5c" stroke="#e7c46a" strokeWidth="2" />
                  <path d="M14 58 Q48 50 82 58" stroke="#4cc3ff" strokeWidth="3" fill="none" opacity="0.7" />
                  <path d="M22 40 L74 40 L64 52 L32 52 Z" fill="#8a4b2d" />
                  <rect x="46" y="18" width="4" height="24" fill="#f4f2ee" />
                  <path d="M50 20 L66 30 L50 38 Z" fill="#f4f2ee" />
                  <ellipse cx="40" cy="70" rx="12" ry="6" fill="#ff8c42" />
                  <path d="M28 70 L20 64 L20 76 Z" fill="#ff8c42" />
                  <circle cx="46" cy="69" r="1.8" fill="#0d1b2a" />
                </svg>
                <h3 className="arc-card-title">{L.title}</h3>
                <p className="arc-card-line">{L.how}</p>
                <div className="arc-how"><span><Icon name="arrowUp" size={15} />{L.tap}</span></div>
                {best > 0 ? <p className="arc-sub">{L.best}: {fmt(best)}</p> : null}
                <div className="arc-actions">
                  {startStage > 1 ? (
                    <>
                      <button type="button" className="arc-btn is-gold" onClick={() => begin(startStage)}>
                        <Icon name="play" size={17} />{L.cont} {fmt(startStage)}
                      </button>
                      <button type="button" className="arc-btn ghost" onClick={() => begin(0)}>{L.fresh}</button>
                    </>
                  ) : (
                    <button type="button" className="arc-btn" onClick={() => begin(0)}>
                      <Icon name="play" size={17} />{L.start}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <h3 className="arc-card-title">{L.over}</h3>
                <div className="arc-card-big">{fmt(score)}<em>{L.points}</em></div>
                {score >= best && score > 0 ? (
                  <span className="arc-record"><Icon name="award" size={15} />{L.record}</span>
                ) : (
                  <p className="arc-sub">{L.best}: {fmt(best)}</p>
                )}
                <div className="arc-stats">
                  <span className="arc-stat is-record"><b>{fmt(reached)}</b><em>{L.reached}</em></span>
                </div>
                <div className="arc-actions">
                  <button type="button" className="arc-btn" onClick={() => begin(0)}>
                    <Icon name="reload" size={17} />{L.again}
                  </button>
                  {reached > 1 ? (
                    <button type="button" className="arc-btn ghost" onClick={() => begin(reached)}>
                      {L.cont} {fmt(reached)}
                    </button>
                  ) : null}
                </div>
                {onLeaderboard ? (
                  <button type="button" className="arc-btn ghost" onClick={() => onLeaderboard(score)}>
                    <Icon name="award" size={15} />{L.board}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
