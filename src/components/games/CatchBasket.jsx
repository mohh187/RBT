// «سلة التمر» — a staged catcher. Dates, sweets, coffee beans and (later) a
// golden date rain down; drag the basket to catch them. Clean streaks build a
// combo multiplier; a spoiled date costs a life; missing a good item breaks the
// streak. Each STAGE adds a new element and falls faster/denser than the last,
// and clears once you have caught its quota of good items — a banner marks the
// beat and the reached stage is saved via onProgress (continue via resumeState).
//
// Contract: renders ONLY the play area — the hub owns the chrome and closing.
// Everything is drawn with canvas paths (no emoji, no assets), Latin digits.
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { play } from '../../lib/gameSounds.js'
import '../../styles/arcade-a.css'

const START_LIVES = 3
const PTS = { date: 5, sweet: 8, bean: 3, gold: 25 }

// The harvest ladder. `good` are the safe kinds alive in the stage; `bad` turns
// on the spoiled date; `gold` turns on the bonus; `goal` good catches clear it.
const STAGES = [
  { ar: 'التمر', en: 'Dates', goal: 9, fall: 208, good: ['date'], bad: false, gold: false, wind: 0 },
  { ar: 'الحلوى', en: 'Sweets', goal: 11, fall: 248, good: ['date', 'sweet'], bad: false, gold: false, wind: 0 },
  { ar: 'حبوب البن', en: 'Coffee beans', goal: 13, fall: 288, good: ['date', 'sweet', 'bean'], bad: true, gold: false, wind: 0 },
  { ar: 'التمر الذهبي', en: 'Golden dates', goal: 15, fall: 328, good: ['date', 'sweet', 'bean'], bad: true, gold: true, wind: 0 },
  { ar: 'الوليمة', en: 'The feast', goal: 17, fall: 370, good: ['date', 'sweet', 'bean'], bad: true, gold: true, wind: 0.5 },
]
function stageAt(i) {
  if (i < STAGES.length) return STAGES[i]
  const b = STAGES[STAGES.length - 1]
  const over = i - STAGES.length + 1
  return { ar: b.ar, en: b.en, goal: b.goal + over * 2, fall: b.fall + over * 40, good: b.good, bad: true, gold: true, wind: 0.5 + over * 0.2 }
}
const stageLabel = (n, lang) => (lang === 'en' ? stageAt(n - 1).en : stageAt(n - 1).ar)

const TXT = {
  ar: {
    title: 'سلة التمر',
    how: 'حرّك السلة بإصبعك لالتقاط الخير المتساقط. التقاطات متتالية تضاعف نقاطك، والصنف الفائت يكسر التتابع.',
    start: 'ابدأ الالتقاط',
    again: 'العب مجدداً',
    cont: 'تابع من المرحلة',
    fresh: 'من البداية',
    over: 'انتهت المحاولات',
    lives: 'المحاولات',
    stage: 'المرحلة',
    reached: 'أبعد مرحلة',
    caught: 'الملتقطات',
    best: 'أفضل نتيجة',
    record: 'رقم قياسي جديد',
    points: 'نقطة',
    combo: 'مضاعف',
    cleared: 'مرحلة مكتملة',
    drag: 'اسحب السلة',
    hintBad: 'لا تلتقط التمر الفاسد، فهو يكلّفك محاولة',
    hintGold: 'التمر الذهبي يمنحك نقاطاً كثيرة',
    hintWind: 'رياح: الأصناف تنحرف وهي تسقط',
    gold: 'تمر ذهبي',
  },
  en: {
    title: 'Catch Basket',
    how: 'Drag the basket to catch what falls. Clean streaks multiply your score; a missed good item breaks the streak.',
    start: 'Start catching',
    again: 'Play again',
    cont: 'Continue from stage',
    fresh: 'From the start',
    over: 'Out of lives',
    lives: 'Lives',
    stage: 'Stage',
    reached: 'Best stage',
    caught: 'Caught',
    best: 'Best score',
    record: 'New record',
    points: 'points',
    combo: 'Combo',
    cleared: 'Stage cleared',
    drag: 'Drag the basket',
    hintBad: 'A spoiled date costs a life, so leave it',
    hintGold: 'The golden date is worth a lot',
    hintWind: 'Wind: items drift as they fall',
    gold: 'Golden date',
  },
}

const BEST_KEY = 'rbt_catchbasket_best'
const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch (_) { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)) } catch (_) { /* private mode */ } }
const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')
const freshEvents = () => ({ score: -1, mult: -1, prog: -1, life: -1, stageClear: -1, gold: false, hint: '', end: false })

function Heart({ lost, hit }) {
  return (
    <svg className={`arc-life${lost ? ' is-lost' : ''}${hit ? ' is-hit' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 21s-7.5-4.7-10-9.3C.4 8.4 2 4.7 5.4 4.7c2 0 3.4 1.2 4.2 2.5.4.6 1.4.6 1.8 0 .8-1.3 2.2-2.5 4.2-2.5 3.4 0 5 3.7 3.4 7C19.5 16.3 12 21 12 21Z" />
    </svg>
  )
}

export default function CatchBasket({
  onScore, onExit, onProgress, resumeState,
  lang = 'ar', brand = '#0e7490', items = [], playerName = '',
}) {
  const t = TXT[lang] || TXT.ar
  const cvsRef = useRef(null)
  const gRef = useRef(null)
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  const phaseRef = useRef('ready')

  const resumeStage = Math.max(0, Math.floor(Number(resumeState?.stage) || 0))
  const [phase, setPhase] = useState('ready')
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(START_LIVES)
  const [lostAt, setLostAt] = useState(-1)
  const [mult, setMult] = useState(1)
  const [stage, setStage] = useState(1)
  const [stageName, setStageName] = useState('')
  const [prog, setProg] = useState(0)
  const [banner, setBanner] = useState(null)
  const [toasts, setToasts] = useState([])
  const [hint, setHint] = useState('')
  const [reached, setReached] = useState(1)
  const [caught, setCaught] = useState(0)
  const [best, setBest] = useState(readBest)
  const toastId = useRef(0)
  const bannerTimer = useRef(null)
  const hintTimer = useRef(null)

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])
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
    hintTimer.current = setTimeout(() => setHint(''), 2500)
  }

  const start = (fromStage = 0) => {
    const g = gRef.current
    if (!g) return
    const idx = Math.max(0, fromStage - 1)
    g.drops = []
    g.bits = []
    g.score = 0
    g.lives = START_LIVES
    g.streak = 0
    g.stageIdx = idx
    g.stageGood = 0
    g.totalGood = 0
    g.elapsed = 0
    g.spawnIn = 0
    g.last = 0
    g.uiScore = 0
    g.uiMult = 1
    g.reached = idx + 1
    g.seen = new Set()
    g.ev = freshEvents()
    setScore(0)
    setLives(START_LIVES)
    setLostAt(-1)
    setMult(1)
    setStage(idx + 1)
    setStageName(stageLabel(idx + 1, lang))
    setProg(0)
    setReached(idx + 1)
    setCaught(0)
    onScoreRef.current?.(0)
    setPhase('play')
    play('deal', { gain: 0.5 })
    if (idx > 0) showBanner(idx + 1, stageLabel(idx + 1, lang))
  }

  useEffect(() => {
    const cvs = cvsRef.current
    if (!cvs) return undefined
    const ctx = cvs.getContext('2d')
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const g = {
      drops: [], bits: [], score: 0, lives: START_LIVES, streak: 0, stageIdx: 0, stageGood: 0, totalGood: 0,
      elapsed: 0, spawnIn: 0, last: 0, bx: 0.5, raf: 0, w: 0, h: 0, reduced, S: 1,
      uiScore: 0, uiMult: 1, reached: 1, seen: new Set(), ev: freshEvents(),
    }
    gRef.current = g

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      g.w = cvs.clientWidth || 1
      g.h = cvs.clientHeight || 1
      cvs.width = Math.round(g.w * dpr)
      cvs.height = Math.round(g.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.S = Math.max(0.82, Math.min(2.2, g.h / 720))
    }
    resize()
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null
    ro?.observe(cvs)
    window.addEventListener('resize', resize)

    const cfg = () => stageAt(g.stageIdx)
    const basketW = () => Math.max(72 * g.S, Math.min(g.w * 0.22, 150 * g.S))
    const basketY = () => g.h - 66 * g.S
    const multiplier = () => Math.min(5, 1 + Math.floor(g.streak / 4))

    const spawn = () => {
      const c = cfg()
      const r = (15 + Math.random() * 5) * g.S
      let kind
      let bad = false
      const badChance = c.bad ? Math.min(0.3, 0.13 + g.stageIdx * 0.015) : 0
      const goldChance = c.gold ? 0.07 : 0
      const roll = Math.random()
      if (roll < badChance) { kind = 'spoiled'; bad = true }
      else if (roll < badChance + goldChance) { kind = 'gold' }
      else kind = c.good[Math.floor(Math.random() * c.good.length)]
      if (!g.seen.has(kind)) {
        g.seen.add(kind)
        if (kind === 'spoiled') g.ev.hint = t.hintBad
        else if (kind === 'gold') g.ev.hint = t.hintGold
      }
      g.drops.push({
        x: r + 10 + Math.random() * Math.max(1, g.w - 2 * r - 20),
        y: -30 * g.S, r, spin: (Math.random() - 0.5) * 3, rot: Math.random() * Math.PI,
        drift: c.wind ? (Math.random() - 0.5) * c.wind : 0, ph: Math.random() * 6.28,
        kind, pts: PTS[kind] || 0, bad,
      })
    }

    const burst = (x, y, color) => {
      if (g.reduced) return
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * Math.PI * 2
        g.bits.push({ x, y, vx: Math.cos(a) * 100, vy: Math.sin(a) * 100 - 40, life: 0.5, color })
      }
    }

    const drawDrop = (d) => {
      const S = g.S
      ctx.save()
      ctx.translate(d.x, d.y)
      ctx.rotate(d.rot)
      if (d.kind === 'date') {
        ctx.fillStyle = '#8a5321'
        ctx.beginPath(); ctx.ellipse(0, 0, d.r * 0.62, d.r, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = 'rgba(255, 214, 150, 0.45)'
        ctx.beginPath(); ctx.ellipse(-d.r * 0.2, -d.r * 0.28, d.r * 0.2, d.r * 0.4, 0.3, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#5d3512'; ctx.lineWidth = 1.4 * S
        ctx.beginPath(); ctx.moveTo(0, -d.r); ctx.lineTo(0, d.r * 0.8); ctx.stroke()
      } else if (d.kind === 'sweet') {
        ctx.fillStyle = '#e8617f'
        ctx.beginPath(); ctx.arc(0, 0, d.r * 0.85, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#fff3f6'; ctx.lineWidth = 3 * S
        ctx.beginPath(); ctx.arc(0, 0, d.r * 0.45, 0.4, 4.2); ctx.stroke()
      } else if (d.kind === 'bean') {
        ctx.fillStyle = '#4a2c1a'
        ctx.beginPath(); ctx.ellipse(0, 0, d.r * 0.58, d.r * 0.9, 0, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#c9a27a'; ctx.lineWidth = 2 * S
        ctx.beginPath(); ctx.moveTo(0, -d.r * 0.75); ctx.quadraticCurveTo(d.r * 0.3, 0, 0, d.r * 0.75); ctx.stroke()
      } else if (d.kind === 'gold') {
        const gg = ctx.createLinearGradient(0, -d.r, 0, d.r)
        gg.addColorStop(0, '#ffe9a8'); gg.addColorStop(1, '#c98f27')
        ctx.shadowColor = 'rgba(231,196,106,.9)'; ctx.shadowBlur = 14 * S
        ctx.fillStyle = gg
        ctx.beginPath(); ctx.ellipse(0, 0, d.r * 0.64, d.r, 0, 0, Math.PI * 2); ctx.fill()
        ctx.shadowBlur = 0
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.beginPath(); ctx.ellipse(-d.r * 0.22, -d.r * 0.3, d.r * 0.16, d.r * 0.32, 0.3, 0, Math.PI * 2); ctx.fill()
      } else {
        ctx.fillStyle = '#4f5a4a'
        ctx.beginPath(); ctx.ellipse(0, 0, d.r * 0.62, d.r, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#2e3a2c'
        ctx.beginPath(); ctx.arc(-d.r * 0.2, -d.r * 0.3, d.r * 0.22, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(d.r * 0.22, d.r * 0.25, d.r * 0.18, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#1d251c'; ctx.lineWidth = 2 * S // the crack that reads "do not catch"
        ctx.beginPath()
        ctx.moveTo(-d.r * 0.5, -d.r * 0.6); ctx.lineTo(0, -d.r * 0.1); ctx.lineTo(-d.r * 0.3, d.r * 0.35); ctx.lineTo(d.r * 0.4, d.r * 0.85)
        ctx.stroke()
      }
      ctx.restore()
    }

    const drawBasket = (x) => {
      const S = g.S
      const w = basketW()
      const y = basketY()
      const hot = g.streak >= 8
      ctx.save()
      ctx.translate(x, y)
      if (hot && !g.reduced) {
        ctx.shadowColor = 'rgba(231,196,106,.7)'; ctx.shadowBlur = 16 * S
      }
      ctx.fillStyle = '#a9713c'
      ctx.beginPath()
      ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.lineTo(w / 2 - 10 * S, 42 * S); ctx.lineTo(-w / 2 + 10 * S, 42 * S)
      ctx.closePath(); ctx.fill()
      ctx.shadowBlur = 0
      ctx.strokeStyle = 'rgba(60, 34, 12, 0.5)'; ctx.lineWidth = 2 * S
      for (let i = 1; i < 4; i++) {
        const yy = i * 10.5 * S
        const k = (w / 2) - (yy / (42 * S)) * 10 * S
        ctx.beginPath(); ctx.moveTo(-k, yy); ctx.lineTo(k, yy); ctx.stroke()
      }
      ctx.fillStyle = hot ? '#e7c46a' : brand
      ctx.fillRect(-w / 2 - 3 * S, -8 * S, w + 6 * S, 9 * S)
      ctx.restore()
    }

    const frame = (now) => {
      g.raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - (g.last || now)) / 1000)
      g.last = now
      const playing = phaseRef.current === 'play'
      const S = g.S

      ctx.clearRect(0, 0, g.w, g.h)
      const sky = ctx.createLinearGradient(0, 0, 0, g.h)
      sky.addColorStop(0, '#14261f'); sky.addColorStop(1, '#08120e')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, g.w, g.h)
      ctx.fillStyle = 'rgba(231,196,106,0.05)'
      ctx.fillRect(0, g.h - 26 * S, g.w, 26 * S)

      if (playing) {
        const c = cfg()
        g.elapsed += dt
        const fall = (c.fall * (g.reduced ? 0.8 : 1) + g.stageGood * 5) * S
        g.spawnIn -= dt
        if (g.spawnIn <= 0) {
          spawn()
          g.spawnIn = Math.max(0.3, 0.95 - g.elapsed / 55 - g.stageIdx * 0.03)
        }
        const bx = g.bx * g.w
        const bw = basketW()
        const by = basketY()
        for (const d of g.drops) {
          d.y += fall * dt
          d.rot += d.spin * dt
          if (d.drift) d.x += Math.sin(g.elapsed * 1.4 + d.ph) * d.drift * 60 * S * dt
          if (d.caught || d.gone) continue
          if (d.y + d.r * 0.5 >= by && d.y - d.r * 0.5 <= by + 28 * S && Math.abs(d.x - bx) < bw / 2 + d.r * 0.4) {
            d.caught = true
            if (d.bad) {
              g.streak = 0
              g.lives = Math.max(0, g.lives - 1)
              g.ev.life = g.lives
              g.ev.mult = 1
              burst(d.x, by, '#6f7a68')
              play('capture', { gain: 0.5 })
              if (g.lives <= 0) { play('lose', { gain: 0.5 }); g.ev.end = true }
            } else {
              g.streak += 1
              g.stageGood += 1
              g.totalGood += 1
              g.score += (d.pts || 0) * multiplier()
              burst(d.x, by, d.kind === 'gold' ? '#ffe08a' : '#ffd166')
              if (d.kind === 'gold') { g.ev.gold = true; play('win', { gain: 0.4 }) } else play('click', { gain: 0.5 })
              if (g.stageGood >= c.goal) {
                g.stageIdx += 1
                g.stageGood = 0
                g.reached = Math.max(g.reached, g.stageIdx + 1)
                g.ev.stageClear = g.stageIdx + 1
                play('win', { gain: 0.5 })
              }
            }
          } else if (d.y - d.r > g.h) {
            d.gone = true
            if (!d.bad) { g.streak = 0; g.ev.mult = 1 } // a dropped good item breaks the combo
          }
        }
        g.drops = g.drops.filter((d) => !d.caught && !d.gone)

        if (g.score !== g.uiScore) { g.uiScore = g.score; g.ev.score = g.score }
        const m = multiplier()
        if (m !== g.uiMult) { g.uiMult = m; g.ev.mult = m }
        g.ev.prog = Math.max(0, Math.min(1, g.stageGood / c.goal))
      }

      for (const d of g.drops) drawDrop(d)
      drawBasket(g.bx * g.w)

      for (const b of g.bits) {
        b.life -= dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.vy += 340 * dt
        ctx.save()
        ctx.globalAlpha = Math.max(0, b.life * 2)
        ctx.fillStyle = b.color
        ctx.beginPath(); ctx.arc(b.x, b.y, 3 * S, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
      }
      g.bits = g.bits.filter((b) => b.life > 0)
    }

    g.raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(g.raf)
      ro?.disconnect()
      window.removeEventListener('resize', resize)
      gRef.current = null
    }
  }, [brand, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- bridge the canvas event mailbox -> React ----
  useEffect(() => {
    if (phase !== 'play') return undefined
    let raf = 0
    const pump = () => {
      raf = requestAnimationFrame(pump)
      const g = gRef.current
      if (!g || !g.ev) return
      const e = g.ev
      if (e.score >= 0) { const s = e.score; e.score = -1; setScore(s); onScoreRef.current?.(s) }
      if (e.mult >= 0) { const m = e.mult; e.mult = -1; setMult(m) }
      if (e.prog >= 0) { const p = e.prog; e.prog = -1; setProg(p) }
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
      if (e.gold) { e.gold = false; pushToast(`${t.gold} +${PTS.gold}`, 'gold') }
      if (e.hint) { const h = e.hint; e.hint = ''; showHint(h) }
      if (e.end) { e.end = false; finishRun() }
    }
    raf = requestAnimationFrame(pump)
    return () => cancelAnimationFrame(raf)
  }, [phase, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const finishRun = () => {
    const g = gRef.current
    const s = g ? g.score : score
    const rc = g ? g.reached : reached
    setScore(s)
    setReached(rc)
    setCaught(g ? g.totalGood : caught)
    onScoreRef.current?.(s)
    if (s > readBest()) { writeBest(s); setBest(s) }
    if (rc > 1) onProgressRef.current?.({ stage: rc })
    setPhase('over')
  }

  const moveTo = (clientX) => {
    const g = gRef.current
    const cvs = cvsRef.current
    if (!g || !cvs) return
    const r = cvs.getBoundingClientRect()
    g.bx = Math.max(0.08, Math.min(0.92, (clientX - r.left) / Math.max(1, r.width)))
  }
  const dragging = useRef(false)
  const onDown = (e) => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); moveTo(e.clientX) }
  const onMove = (e) => { if (dragging.current) moveTo(e.clientX) }
  const onUp = () => { dragging.current = false }

  useEffect(() => {
    const onKey = (e) => {
      const g = gRef.current
      if (!g) return
      if (e.key === 'ArrowLeft') g.bx = Math.max(0.08, g.bx - 0.06)
      else if (e.key === 'ArrowRight') g.bx = Math.min(0.92, g.bx + 0.06)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rtl = lang !== 'en'

  return (
    <div className="arc-root" dir={rtl ? 'rtl' : 'ltr'} style={{ '--arc-brand': brand }}>
      <canvas
        ref={cvsRef}
        className="arc-canvas"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />

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
            {mult > 1 ? <span className="arc-chip is-gold">{t.combo} x{fmt(mult)}</span> : null}
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
        <div className="arc-hint"><span><Icon name="warning" size={15} />{hint}</span></div>
      )}

      {phase !== 'play' && (
        <div className="arc-veil">
          <div className="arc-card">
            {phase === 'ready' ? (
              <>
                <svg className="arc-emblem" viewBox="0 0 96 96" aria-hidden="true">
                  <circle cx="48" cy="48" r="46" fill="#123c35" stroke="#e7c46a" strokeWidth="2" />
                  <path d="M26 46 L70 46 L64 74 L32 74 Z" fill="#a9713c" />
                  <path d="M28 52 H68 M30 60 H66 M33 68 H63" stroke="rgba(60,34,12,.55)" strokeWidth="2" fill="none" />
                  <rect x="24" y="42" width="48" height="7" rx="3" fill={brand} />
                  <ellipse cx="42" cy="34" rx="6" ry="9" fill="#8a5321" />
                  <ellipse cx="55" cy="32" rx="6" ry="9" fill="#c98f27" />
                </svg>
                <h3 className="arc-card-title">{t.title}</h3>
                <p className="arc-card-line">{t.how}</p>
                <div className="arc-how"><span><Icon name="arrowLeftRight" size={15} />{t.drag}</span></div>
                {best > 0 ? <p className="arc-sub">{t.best}: {fmt(best)}</p> : null}
                <div className="arc-actions">
                  {resumeStage > 1 ? (
                    <>
                      <button type="button" className="arc-btn is-gold" onClick={() => start(resumeStage)}>
                        <Icon name="play" size={17} />{t.cont} {fmt(resumeStage)}
                      </button>
                      <button type="button" className="arc-btn ghost" onClick={() => start(0)}>{t.fresh}</button>
                    </>
                  ) : (
                    <button type="button" className="arc-btn" onClick={() => start(0)}>
                      <Icon name="play" size={17} />{t.start}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <h3 className="arc-card-title">{t.over}</h3>
                <div className="arc-card-big">{fmt(score)}<em>{t.points}</em></div>
                {score >= best && score > 0 ? (
                  <span className="arc-record"><Icon name="award" size={15} />{t.record}</span>
                ) : (
                  <p className="arc-sub">{t.best}: {fmt(best)}</p>
                )}
                <div className="arc-stats">
                  <span className="arc-stat is-record"><b>{fmt(reached)}</b><em>{t.reached}</em></span>
                  <span className="arc-stat"><b>{fmt(caught)}</b><em>{t.caught}</em></span>
                </div>
                <div className="arc-actions">
                  <button type="button" className="arc-btn" onClick={() => start(0)}>
                    <Icon name="reload" size={17} />{t.again}
                  </button>
                  {reached > 1 ? (
                    <button type="button" className="arc-btn ghost" onClick={() => start(reached)}>
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
