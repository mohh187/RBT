// «الشواية المثالية» — PerfectGrill: a timing game. Every piece on the grill
// has its own heat gauge whose needle sweeps toward the burn line. Tap the
// piece while the needle is inside the green band to flip it; the dead centre
// of the band is a perfect flip. Tap too early and it comes off raw (the sweep
// restarts, you lose the tempo); tap too late — or don't tap at all — and it
// chars and costs a life. Two clean flips finish a piece.
//
// STAGES (مراحل): a real ladder. Each stage asks you to plate a set number of
// pieces; clearing one triggers a between-stages beat (a banner + a short
// breather while the grill rests), then the next stage sweeps FASTER, its green
// band SHRINKS, and past stage two a second and third piece share the grate.
// Different ingredients cook at different speeds — fish is quick, vegetables are
// forgiving — so the ideal moment moves with what is on the fire. Progress is
// saved through onProgress, so a guest resumes at their stage with their score.
//
// CONTRACT (hub-rendered): fills its parent, play area only, ABSOLUTE score via
// onScore(). All art is canvas paths — no emojis, Latin digits, Arabic copy,
// pointer events, one rAF loop, dPR aware, torn down on unmount.
import { useEffect, useMemo, useRef, useState } from 'react'
import { play } from '../../lib/gameSounds.js'
import '../../styles/arcade-b.css'

const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

const GAME_ID = 'perfectGrill'
const PROG_V = 2
const BEST_KEY = 'rbt_game_perfectgrill_best'
const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch (_) { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)) } catch (_) { /* private mode */ } }

const LIVES = 3
const STAGE_TARGET = 4          // pieces to plate to clear a stage
const STAGE_HOLD = 1.1          // grill rests while the stage banner shows
const GENERIC = [
  { kind: 0, name: 'لحم' },
  { kind: 1, name: 'سمك' },
  { kind: 2, name: 'خضار' },
]
const FISH_RE = /سمك|سلمون|هامور|روبيان|جمبري|بحري|تونة/
const VEG_RE = /خضار|بطاط|فطر|كوسا|باذنجان|فلفل|ذرة|سلط|حلوم/
// fish cooks quicker, vegetables are more forgiving — the ideal window moves
const KIND_DUR = [1, 0.82, 1.2]

function rr(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

const mix = (a, b, t) => Math.round(a + (b - a) * Math.max(0, Math.min(1, t)))
const rgb = (r, g, b) => `rgb(${r},${g},${b})`
const slotsForStage = (s) => (s <= 1 ? 1 : s === 2 ? 2 : 3)

export default function PerfectGrill({
  onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '',
  onProgress, resumeState,
}) {
  const rootRef = useRef(null)
  const cvsRef = useRef(null)
  const startRef = useRef(() => {})
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  const brandRef = useRef(brand)
  const menuRef = useRef([])

  const saved = useMemo(() => {
    const s = resumeState
    return s && s.game === GAME_ID && s.v === PROG_V && Number(s.stage) > 0 ? s : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [phase, setPhase] = useState('ready') // ready | play | over
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(LIVES)
  const [stage, setStage] = useState(saved ? Number(saved.stage) : 1)
  const [plated, setPlated] = useState(0)
  const [streak, setStreak] = useState(0)
  const [banner, setBanner] = useState(null)
  const [best, setBest] = useState(readBest)

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])
  useEffect(() => { brandRef.current = brand }, [brand])
  useEffect(() => { if (typeof onScoreRef.current === 'function') onScoreRef.current(score) }, [score])

  // real grill-able menu items become the pieces on the grate
  const itemKey = (Array.isArray(items) ? items : []).map((it) => (it && it.id) || '').join('|')
  useEffect(() => {
    const out = []
    for (const it of Array.isArray(items) ? items : []) {
      const nm = String((it && (it.nameAr || it.nameEn)) || '').trim()
      if (!nm || nm.length > 16) continue
      out.push({ kind: FISH_RE.test(nm) ? 1 : VEG_RE.test(nm) ? 2 : 0, name: nm })
    }
    menuRef.current = out.length >= 3 ? out : GENERIC
  }, [itemKey])

  useEffect(() => {
    const root = rootRef.current
    const cvs = cvsRef.current
    if (!root || !cvs) return undefined
    const ctx = cvs.getContext('2d')
    const rm = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const st = {
      w: 0, h: 0, raf: 0, last: 0, rm, phase: 'ready',
      slots: [], nSlots: 1, stage: 1, plated: 0, score: 0, lives: LIVES, streak: 0,
      hold: 0, smoke: [], shake: 0, glow: 0, glowT: 0,
    }

    const sweepDur = () => Math.max(0.8, 2.2 - st.stage * 0.15)
    const bandW = () => Math.max(0.08, 0.22 - st.stage * 0.016)

    const zone = (s) => {
      const bw = bandW()
      const g0 = 0.40 + Math.random() * (0.92 - bw - 0.40)
      s.g0 = g0
      s.g1 = g0 + bw
    }

    const respawn = (s) => {
      const list = menuRef.current.length ? menuRef.current : GENERIC
      const pick = list[Math.floor(Math.random() * list.length)]
      s.kind = pick.kind
      s.name = pick.name
      s.side = 0
      s.sear = 0
      s.char = 0
      s.t = 0
      s.dur = sweepDur() * (KIND_DUR[pick.kind] || 1)
      s.state = 'cook'
      s.anim = 0
      s.flash = 0
      s.flashTxt = ''
      s.flashCol = '#fff'
      zone(s)
    }

    const mkSlot = () => {
      const s = { kind: 0, name: '', side: 0, sear: 0, char: 0, t: 0, dur: 1.8, g0: 0.5, g1: 0.7, state: 'cook', anim: 0, flash: 0, flashTxt: '', flashCol: '#fff' }
      respawn(s)
      return s
    }

    const syncSlots = () => {
      const want = slotsForStage(st.stage)
      while (st.slots.length < want) st.slots.push(mkSlot())
      st.nSlots = st.slots.length
    }

    const reportProgress = (done) => {
      try {
        onProgressRef.current?.({
          game: GAME_ID, v: PROG_V, stage: st.stage, score: Math.round(st.score),
          done: !!done, completed: false, at: Date.now(),
        })
      } catch (_) { /* best-effort */ }
    }

    const start = (cfg) => {
      st.slots.length = 0
      st.smoke.length = 0
      st.stage = Math.max(1, Math.floor(Number(cfg && cfg.stage) || 1))
      st.plated = 0
      st.score = Math.max(0, Math.floor(Number(cfg && cfg.score) || 0))
      st.lives = LIVES
      st.streak = 0
      st.hold = 0
      st.shake = 0
      st.glow = 0
      syncSlots()
      st.phase = 'play'
      setPhase('play')
      setScore(st.score)
      setLives(LIVES)
      setStage(st.stage)
      setPlated(0)
      setStreak(0)
      setBanner(null)
      play('deal')
    }
    startRef.current = start

    const endGame = () => {
      st.phase = 'over'
      setPhase('over')
      setScore(st.score)
      if (typeof onScoreRef.current === 'function') onScoreRef.current(st.score)
      if (st.score > readBest()) { writeBest(st.score); setBest(st.score) }
      reportProgress(true)
      play('lose')
    }

    const clearStage = () => {
      st.stage += 1
      st.plated = 0
      st.hold = STAGE_HOLD
      st.glow = st.rm ? 0.3 : 1
      st.score += 120 + st.stage * 25
      syncSlots()
      setStage(st.stage)
      setPlated(0)
      setScore(st.score)
      setBanner({ stage: st.stage })
      play('win', { gain: 0.5 })
      reportProgress(false)
    }

    const puff = (x, y, n, col) => {
      const count = st.rm ? Math.round(n * 0.4) : n
      for (let i = 0; i < count; i++) {
        st.smoke.push({
          x: x + (Math.random() - 0.5) * 26,
          y: y + (Math.random() - 0.5) * 14,
          vx: (Math.random() - 0.5) * 24,
          vy: -18 - Math.random() * 40,
          r: 5 + Math.random() * 12,
          t: 0, life: 0.9 + Math.random() * 0.8, col,
        })
      }
    }

    const burn = (s, py) => {
      s.state = 'burnt'
      s.anim = 0
      s.char = 1
      s.flash = 1
      s.flashTxt = 'محترق'
      s.flashCol = '#ff6b52'
      st.streak = 0
      st.lives -= 1
      st.shake = st.rm ? 0 : 1
      puff(st.w * 0.83, py, 16, '60,52,48')
      setStreak(0)
      setLives(st.lives)
      play('lose', { gain: 0.5 })
      if (st.lives <= 0) endGame()
    }

    const plate = () => {
      st.plated += 1
      setPlated(st.plated)
      if (st.plated >= STAGE_TARGET) clearStage()
    }

    const flip = (s, py) => {
      if (s.state !== 'cook' || st.hold > 0) return
      const p = s.t
      if (p < s.g0) {
        s.flash = 1
        s.flashTxt = 'نيء'
        s.flashCol = '#7fc7ff'
        s.t = 0
        s.dur = sweepDur() * (KIND_DUR[s.kind] || 1)
        zone(s)
        st.streak = 0
        setStreak(0)
        play('click', { gain: 0.5 })
        return
      }
      if (p > s.g1) { burn(s, py); return }

      const mid = (s.g0 + s.g1) / 2
      const half = (s.g1 - s.g0) / 2
      const perfect = Math.abs(p - mid) <= half * 0.34
      st.streak += 1
      s.side += 1
      s.sear = Math.min(1, s.sear + 0.55)
      const gain = perfect ? 100 + st.stage * 20 : 40 + st.stage * 10
      st.score += gain + Math.min(60, (st.streak - 1) * 10)
      s.flash = 1
      s.flashTxt = perfect ? 'مثالي' : 'ممتاز'
      s.flashCol = perfect ? '#ffd166' : '#8ee06f'
      if (perfect) { st.glow = 1; play('capture', { gain: 0.55 }) } else play('move', { gain: 0.6 })
      puff(st.w * 0.83, py, perfect ? 10 : 5, '255,214,150')

      if (s.side >= 2) {
        s.state = 'done'
        s.anim = 0
        st.score += 80
        play('turn', { gain: 0.5 })
        plate()
      } else {
        s.t = 0
        s.dur = sweepDur() * 0.92 * (KIND_DUR[s.kind] || 1)
        zone(s)
      }
      setScore(st.score)
      setStreak(st.streak)
    }

    // ---------- layout ----------
    const TOPPAD = 46
    const BOTPAD = 12
    const geo = { bandH: 0, y0: 0 }
    const relayout = () => {
      const usable = Math.max(60, st.h - TOPPAD - BOTPAD)
      geo.bandH = Math.min(usable / st.nSlots, 220)
      geo.y0 = TOPPAD + (usable - geo.bandH * st.nSlots) / 2
    }

    const resize = () => {
      const box = root.getBoundingClientRect()
      st.w = Math.max(1, Math.round(box.width))
      st.h = Math.max(1, Math.round(box.height))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cvs.width = Math.round(st.w * dpr)
      cvs.height = Math.round(st.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      relayout()
    }

    const onDown = (e) => {
      if (st.phase !== 'play' || st.hold > 0) return
      e.preventDefault()
      const b = cvs.getBoundingClientRect()
      const y = e.clientY - b.top
      relayout()
      let i = Math.floor((y - geo.y0) / geo.bandH)
      if (i < 0) i = 0
      if (i > st.nSlots - 1) i = st.nSlots - 1
      const s = st.slots[i]
      if (s) flip(s, geo.y0 + (i + 0.5) * geo.bandH)
    }
    cvs.addEventListener('pointerdown', onDown)

    // ---------- piece art ----------
    const drawPiece = (s, cx, cy, R) => {
      const done = s.sear
      const ch = s.char
      let r1
      let g1
      let b1
      if (s.kind === 1) { r1 = mix(mix(232, 214, done), 40, ch); g1 = mix(mix(185, 150, done), 34, ch); b1 = mix(mix(160, 104, done), 30, ch) }
      else if (s.kind === 2) { r1 = mix(mix(126, 92, done), 38, ch); g1 = mix(mix(184, 138, done), 34, ch); b1 = mix(mix(88, 62, done), 28, ch) }
      else { r1 = mix(mix(180, 128, done), 38, ch); g1 = mix(mix(74, 74, done), 32, ch); b1 = mix(mix(74, 44, done), 28, ch) }

      ctx.save()
      ctx.translate(cx, cy)
      ctx.shadowColor = 'rgba(0,0,0,.5)'
      ctx.shadowBlur = 10
      ctx.shadowOffsetY = 4
      ctx.fillStyle = rgb(r1, g1, b1)

      if (s.kind === 1) {
        ctx.beginPath()
        ctx.moveTo(-R * 1.15, 0)
        ctx.quadraticCurveTo(-R * 0.35, -R * 0.78, R * 0.55, -R * 0.5)
        ctx.quadraticCurveTo(R * 1.2, -R * 0.25, R * 1.2, 0)
        ctx.quadraticCurveTo(R * 1.2, R * 0.25, R * 0.55, R * 0.5)
        ctx.quadraticCurveTo(-R * 0.35, R * 0.78, -R * 1.15, 0)
        ctx.closePath()
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.strokeStyle = `rgba(255,255,255,${0.24 * (1 - ch)})`
        ctx.lineWidth = 1.6
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath()
          ctx.moveTo(-R * 0.85, k * R * 0.3)
          ctx.quadraticCurveTo(0, k * R * 0.44, R * 0.95, k * R * 0.22)
          ctx.stroke()
        }
      } else if (s.kind === 2) {
        ctx.beginPath()
        ctx.arc(0, 0, R * 0.95, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.fillStyle = `rgba(255,255,255,${0.2 * (1 - ch)})`
        ctx.beginPath()
        ctx.arc(0, 0, R * 0.52, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = `rgba(240,236,200,${0.7 * (1 - ch)})`
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2
          ctx.beginPath()
          ctx.ellipse(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3, R * 0.09, R * 0.13, a, 0, Math.PI * 2)
          ctx.fill()
        }
      } else {
        ctx.beginPath()
        ctx.moveTo(-R * 1.1, -R * 0.1)
        ctx.quadraticCurveTo(-R * 0.95, -R * 0.8, -R * 0.1, -R * 0.72)
        ctx.quadraticCurveTo(R * 0.75, -R * 0.85, R * 1.08, -R * 0.2)
        ctx.quadraticCurveTo(R * 1.2, R * 0.55, R * 0.35, R * 0.74)
        ctx.quadraticCurveTo(-R * 0.6, R * 0.85, -R * 1.1, -R * 0.1)
        ctx.closePath()
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.fillStyle = `rgba(250,238,214,${0.35 * (1 - ch)})`
        ctx.beginPath()
        ctx.ellipse(R * 0.72, -R * 0.28, R * 0.3, R * 0.2, 0.5, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.shadowBlur = 0
      if (done > 0.02) {
        ctx.strokeStyle = `rgba(52,26,14,${0.55 * done * (1 - ch * 0.5)})`
        ctx.lineWidth = Math.max(3, R * 0.16)
        ctx.lineCap = 'round'
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath()
          ctx.moveTo(-R * 0.7 + k * R * 0.42, -R * 0.42)
          ctx.lineTo(-R * 0.2 + k * R * 0.42, R * 0.46)
          ctx.stroke()
        }
      }
      if (ch > 0.02) {
        ctx.fillStyle = `rgba(20,14,10,${0.45 * ch})`
        ctx.beginPath()
        ctx.arc(0, 0, R, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    const drawGauge = (s, x0, x1, y, gh) => {
      const wid = x1 - x0
      ctx.fillStyle = 'rgba(0,0,0,.5)'
      rr(ctx, x0, y - gh / 2, wid, gh, gh / 2)
      ctx.fill()
      ctx.save()
      rr(ctx, x0 + 2, y - gh / 2 + 2, wid - 4, gh - 4, (gh - 4) / 2)
      ctx.clip()
      const g = ctx.createLinearGradient(x0, 0, x1, 0)
      g.addColorStop(0, '#2b5f86')
      g.addColorStop(0.5, '#c08a2c')
      g.addColorStop(1, '#8e2a1c')
      ctx.fillStyle = g
      ctx.fillRect(x0, y - gh / 2, wid, gh)
      ctx.fillStyle = 'rgba(120,225,120,.92)'
      ctx.fillRect(x0 + wid * s.g0, y - gh / 2, wid * (s.g1 - s.g0), gh)
      ctx.fillStyle = 'rgba(255,255,255,.5)'
      ctx.fillRect(x0 + wid * ((s.g0 + s.g1) / 2) - 1, y - gh / 2, 2, gh)
      ctx.restore()
      if (s.state === 'cook' && st.hold <= 0) {
        const nx = x0 + wid * s.t
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(nx, y - gh / 2 - 5)
        ctx.lineTo(nx, y + gh / 2 + 5)
        ctx.stroke()
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.arc(nx, y - gh / 2 - 7, 3.6, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = 'rgba(255,255,255,.75)'
      for (let k = 0; k < 2; k++) {
        ctx.beginPath()
        ctx.arc(x0 + 7 + k * 11, y + gh / 2 + 13, 3.4, 0, Math.PI * 2)
        if (k < s.side) ctx.fill()
        else { ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1.4; ctx.stroke() }
      }
    }

    const draw = () => {
      const { w, h } = st
      ctx.save()
      if (st.shake > 0.01) ctx.translate((Math.random() - 0.5) * 8 * st.shake, (Math.random() - 0.5) * 8 * st.shake)

      ctx.fillStyle = '#160f0c'
      ctx.fillRect(-16, -16, w + 32, h + 32)
      const eg = ctx.createLinearGradient(0, 0, 0, h)
      eg.addColorStop(0, 'rgba(255,110,40,.10)')
      eg.addColorStop(0.55, 'rgba(255,80,20,.16)')
      eg.addColorStop(1, 'rgba(120,20,0,.22)')
      ctx.fillStyle = eg
      ctx.fillRect(0, 0, w, h)

      const flick = st.rm ? 0.5 : 0.5 + 0.5 * Math.sin(st.glowT * 2.4)
      for (let i = 0; i < 22; i++) {
        const ex = ((i * 97) % Math.max(1, w - 20)) + 10
        const ey = ((i * 173) % Math.max(1, h - 20)) + 10
        ctx.globalAlpha = 0.10 + 0.10 * ((i % 3) / 2) * flick
        ctx.fillStyle = '#ff7a2a'
        ctx.beginPath()
        ctx.arc(ex, ey, 8 + (i % 4) * 3, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      ctx.strokeStyle = 'rgba(220,220,230,.10)'
      ctx.lineWidth = 5
      for (let y = 14; y < h; y += 26) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }

      relayout()
      const pieceX = w * 0.83
      const gx0 = w * 0.06
      const gx1 = w * 0.68

      for (let i = 0; i < st.nSlots; i++) {
        const s = st.slots[i]
        if (!s) continue
        const cy = geo.y0 + (i + 0.5) * geo.bandH
        const R = Math.min(geo.bandH * 0.28, w * 0.11, 56)
        const gh = Math.max(12, Math.min(22, geo.bandH * 0.16))

        ctx.fillStyle = 'rgba(255,255,255,.035)'
        rr(ctx, 6, cy - geo.bandH * 0.42, w - 12, geo.bandH * 0.84, 16)
        ctx.fill()

        drawGauge(s, gx0, gx1, cy + (s.name ? 4 : 0), gh)

        if (s.name) {
          ctx.fillStyle = 'rgba(255,255,255,.72)'
          ctx.font = '700 12px system-ui, "Segoe UI", Tahoma, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'alphabetic'
          ctx.fillText(s.name, (gx0 + gx1) / 2, cy - gh - 8)
        }

        const pop = s.state === 'done' ? 1 + Math.sin(Math.min(1, s.anim / 0.35) * Math.PI) * 0.16 : 1
        drawPiece(s, pieceX, cy, R * pop)
        if (s.state === 'done') {
          ctx.globalAlpha = Math.max(0, 1 - s.anim / 0.7)
          ctx.strokeStyle = '#ffd166'
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(pieceX, cy, R * (1.3 + s.anim * 2.2), 0, Math.PI * 2)
          ctx.stroke()
          ctx.globalAlpha = 1
        }

        if (s.flash > 0.01) {
          ctx.globalAlpha = Math.min(1, s.flash)
          ctx.fillStyle = s.flashCol
          ctx.font = '900 17px system-ui, "Segoe UI", Tahoma, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(s.flashTxt, pieceX, cy - R - 16 - (1 - s.flash) * 14)
          ctx.globalAlpha = 1
        }
      }

      for (let i = 0; i < st.smoke.length; i++) {
        const p = st.smoke[i]
        ctx.globalAlpha = Math.max(0, 1 - p.t / p.life) * 0.5
        ctx.fillStyle = `rgb(${p.col})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r * (1 + p.t * 1.3), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      if (st.glow > 0.01) {
        ctx.globalAlpha = st.glow * (st.rm ? 0.1 : 0.22)
        ctx.fillStyle = brandRef.current
        ctx.fillRect(0, 0, w, h)
        ctx.globalAlpha = 1
      }
      ctx.restore()
    }

    const frame = (now) => {
      st.raf = requestAnimationFrame(frame)
      const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 0
      st.last = now
      st.glowT += dt

      if (st.phase === 'play') {
        relayout()
        if (st.hold > 0) {
          st.hold -= dt
          if (st.hold <= 0) { st.hold = 0; setBanner(null) }
        } else {
          for (let i = 0; i < st.nSlots; i++) {
            if (st.phase !== 'play') break
            const s = st.slots[i]
            if (!s) continue
            s.flash = Math.max(0, s.flash - dt * 1.6)
            if (s.state === 'cook') {
              s.t += dt / s.dur
              if (s.t >= 1) { s.t = 1; burn(s, geo.y0 + (i + 0.5) * geo.bandH) }
            } else {
              s.anim += dt
              if (s.state === 'burnt' && !st.rm && s.anim < 0.7 && Math.random() < 0.4) {
                st.smoke.push({ x: st.w * 0.83 + (Math.random() - 0.5) * 22, y: geo.y0 + (i + 0.5) * geo.bandH, vx: (Math.random() - 0.5) * 16, vy: -30 - Math.random() * 26, r: 6 + Math.random() * 9, t: 0, life: 1.1, col: '70,62,58' })
              }
              if (s.anim >= (s.state === 'burnt' ? 0.95 : 0.7)) { if (st.phase === 'play') respawn(s) }
            }
          }
        }
      }

      for (let i = st.smoke.length - 1; i >= 0; i--) {
        const p = st.smoke[i]
        p.t += dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vy *= 0.985
        if (p.t >= p.life) st.smoke.splice(i, 1)
      }
      st.shake = Math.max(0, st.shake - dt * 3)
      st.glow = Math.max(0, st.glow - dt * 2.4)

      draw()
    }

    resize()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
    if (ro) ro.observe(root)
    window.addEventListener('resize', resize)
    st.raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(st.raf)
      cvs.removeEventListener('pointerdown', onDown)
      window.removeEventListener('resize', resize)
      if (ro) ro.disconnect()
    }
  }, [])

  const rtl = lang !== 'en'
  const restart = (cfg) => startRef.current(cfg || null)

  return (
    <div
      ref={rootRef}
      className="gmx-root gmpg-root"
      dir={rtl ? 'rtl' : 'ltr'}
      style={{ '--gm-brand': brand }}
    >
      <canvas ref={cvsRef} className="gmx-canvas" />

      {phase === 'play' && (
        <div className="gmx-hud">
          <span className="gmx-pill gmx-pill-score">{fmt(score)}</span>
          <span className="gmx-pill arb-stage-pill">المرحلة {fmt(stage)}</span>
          <span className="gmx-pill">طبق {fmt(plated)}/{fmt(STAGE_TARGET)}</span>
          {streak > 1 && <span className="gmx-pill gmx-pill-hot">تتابع ×{fmt(streak)}</span>}
          <span className="gmx-pill gmx-lives" aria-label={`الأرواح ${lives}`}>
            {[0, 1, 2].map((i) => <i key={i} className={`gmx-life${i < lives ? '' : ' off'}`} />)}
          </span>
        </div>
      )}

      {banner && phase === 'play' && (
        <div className="arb-banner" key={banner.stage}>
          <span className="arb-banner-k">المرحلة {fmt(banner.stage)}</span>
          <span className="arb-banner-n">أسرع، ونطاق أضيق</span>
        </div>
      )}

      {phase === 'ready' && (
        <div className="gmx-veil">
          <div className="gmx-card">
            <div className="gmx-emblem gmpg-emblem" aria-hidden="true">
              <span className="gmpg-bar"><i /></span>
            </div>
            <h3 className="gmx-title">الشواية المثالية</h3>
            <p className="gmx-line">المؤشر يتحرك نحو خط الاحتراق، فاضغط على القطعة عندما يصل إلى المنطقة الخضراء لتقلبها. مبكراً تخرج نيئة، ومتأخراً تحترق. كل مرحلة أسرع، ونطاقها أضيق.</p>
            {saved ? (
              <div className="gmx-actions">
                <button type="button" className="gmx-btn" onClick={() => restart({ stage: Number(saved.stage), score: Number(saved.score) || 0 })}>
                  تابع من المرحلة {fmt(saved.stage)}
                </button>
                <button type="button" className="gmx-btn ghost" onClick={() => restart()}>من البداية</button>
              </div>
            ) : (
              <button type="button" className="gmx-btn" onClick={() => restart()}>أشعل الشواية</button>
            )}
            {best > 0 && <p className="gmx-sub">أفضل نتيجة {fmt(best)}</p>}
          </div>
        </div>
      )}

      {phase === 'over' && (
        <div className="gmx-veil">
          <div className="gmx-card">
            <h3 className="gmx-title">احترقت الطلبات</h3>
            <div className="gmx-big">{fmt(score)}</div>
            <p className="gmx-line">
              {playerName ? `${playerName}، ` : ''}بلغت المرحلة {fmt(stage)}
            </p>
            <p className="gmx-sub">أفضل نتيجة {fmt(Math.max(best, score))}</p>
            <div className="gmx-actions">
              <button type="button" className="gmx-btn" onClick={() => restart()}>العب مرة أخرى</button>
              {typeof onExit === 'function' && (
                <button type="button" className="gmx-btn ghost" onClick={onExit}>إنهاء</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
