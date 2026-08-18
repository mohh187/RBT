// «فن اللاتيه» — LatteArt: latte-art patterns are ghosted onto the crema and the
// player traces each one with a single continuous drag. The score is an HONEST
// geometric match: both the target and the drawn path are resampled to equal
// arc-length points and compared with a symmetric point-to-segment (chamfer)
// distance plus an ordered-sequence term, so shortcuts, over-shoots and
// half-finished strokes are all punished the way they should be.
//
// STAGES (مراحل): a real ladder. Each stage hands you a set of patterns to pour;
// clearing the set triggers a between-stages beat, then the next stage gives you
// LESS time per pour and introduces HARDER shapes (a five-petal flower, a
// spiral). A pour graded below the spill line costs one of three cups; run out
// and the round ends. Progress is saved through onProgress so a guest resumes at
// their stage with their score.
//
// CONTRACT (hub-rendered): fills its parent, play area only, ABSOLUTE score via
// onScore(). Canvas art only — no emojis, Latin digits, Arabic copy, pointer
// events, single rAF loop, dPR aware, full teardown on unmount.
import { useEffect, useMemo, useRef, useState } from 'react'
import { play } from '../../lib/gameSounds.js'
import '../../styles/arcade-b.css'

const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

const GAME_ID = 'latteArt'
const PROG_V = 2
const BEST_KEY = 'rbt_game_latteart_best'
const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch (_) { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)) } catch (_) { /* private mode */ } }

// key, arabic name, score multiplier, and the earliest stage it appears in
const PATTERNS = [
  { key: 'heart', name: 'قلب', mult: 1, diff: 1 },
  { key: 'wave', name: 'موجة', mult: 1.15, diff: 1 },
  { key: 'tulip', name: 'توليب', mult: 1.3, diff: 1 },
  { key: 'spiral', name: 'حلزون', mult: 1.45, diff: 2 },
  { key: 'rosetta', name: 'روزيتا', mult: 1.6, diff: 2 },
  { key: 'flower', name: 'زهرة', mult: 1.8, diff: 3 },
]
const patternByKey = (k) => PATTERNS.find((p) => p.key === k) || PATTERNS[0]

const LIVES = 3
const FAIL_ACC = 0.32          // a pour below this spills the cup
const STAGE_HOLD = 1.1
const SAMPLES = 72
const MAXPTS = 2400
const patternsForStage = (n) => Math.min(4, 2 + n)
const stageSeconds = (n) => Math.max(9, 20 - (n - 1) * 2)

// choose the patterns for a stage: eligible by difficulty, ramped hardest-last
function chooseStage(stageNum) {
  const pool = PATTERNS.filter((p) => p.diff <= stageNum)
  const src = pool.length ? pool : PATTERNS
  const count = patternsForStage(stageNum)
  const out = []
  let last = -1
  for (let i = 0; i < count; i++) {
    // bias toward harder patterns as the stage fills up
    const bias = i / Math.max(1, count - 1)
    let idx
    let tries = 0
    do {
      const r = Math.random()
      const pick = r < 0.5 + bias * 0.4 ? src[Math.min(src.length - 1, Math.floor(bias * src.length + Math.random() * 2))] : src[Math.floor(Math.random() * src.length)]
      idx = src.indexOf(pick)
      tries += 1
    } while (idx === last && src.length > 1 && tries < 4)
    last = idx
    out.push(src[idx].key)
  }
  out.sort((a, b) => patternByKey(a).mult - patternByKey(b).mult)
  return out
}

// ---------- geometry helpers (no allocations in the hot path) ----------
function polyLen(a, n) {
  let L = 0
  for (let i = 1; i < n; i++) L += Math.hypot(a[2 * i] - a[2 * i - 2], a[2 * i + 1] - a[2 * i - 1])
  return L
}

function resample(src, n, out, m) {
  if (n < 2) return 0
  const total = polyLen(src, n)
  if (total <= 1e-6) return 0
  const step = total / (m - 1)
  out[0] = src[0]
  out[1] = src[1]
  let o = 1
  let px = src[0]
  let py = src[1]
  let acc = 0
  for (let i = 1; i < n && o < m - 1; i++) {
    const qx = src[2 * i]
    const qy = src[2 * i + 1]
    let seg = Math.hypot(qx - px, qy - py)
    if (seg <= 1e-6) { px = qx; py = qy; continue }
    while (acc + seg >= step && o < m - 1) {
      const t = (step - acc) / seg
      px += (qx - px) * t
      py += (qy - py) * t
      out[2 * o] = px
      out[2 * o + 1] = py
      o += 1
      seg = Math.hypot(qx - px, qy - py)
      acc = 0
      if (seg <= 1e-6) break
    }
    acc += seg
    px = qx
    py = qy
  }
  while (o < m) {
    out[2 * o] = src[2 * (n - 1)]
    out[2 * o + 1] = src[2 * n - 1]
    o += 1
  }
  return m
}

function ptSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const L2 = vx * vx + vy * vy
  let t = L2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t))
}

function chamfer(A, na, B, nb) {
  if (na < 1 || nb < 2) return Infinity
  let sum = 0
  for (let i = 0; i < na; i++) {
    const px = A[2 * i]
    const py = A[2 * i + 1]
    let best = Infinity
    for (let j = 1; j < nb; j++) {
      const d = ptSeg(px, py, B[2 * j - 2], B[2 * j - 1], B[2 * j], B[2 * j + 1])
      if (d < best) best = d
    }
    sum += best
  }
  return sum / na
}

function ordered(A, B, n) {
  let best = Infinity
  for (let dir = 0; dir < 2; dir++) {
    for (let rot = 0; rot < n; rot++) {
      let sum = 0
      let bail = false
      for (let i = 0; i < n; i++) {
        const j = dir === 0 ? (i + rot) % n : (n - 1 - i + rot) % n
        const dx = A[2 * i] - B[2 * j]
        const dy = A[2 * i + 1] - B[2 * j + 1]
        sum += Math.sqrt(dx * dx + dy * dy)
        if (sum >= best * n) { bail = true; break }
      }
      if (!bail && sum / n < best) best = sum / n
    }
  }
  return best
}

// ---------- the patterns, written straight into a flat array ----------
function buildPattern(kind, cx, cy, R, out) {
  if (kind === 'heart') {
    const N = 150
    for (let i = 0; i < N; i++) {
      const t = -Math.PI / 2 + (i / (N - 1)) * Math.PI * 2
      const s = Math.sin(t)
      const yv = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))
      out[2 * i] = cx + (16 * s * s * s / 17) * R * 0.82
      out[2 * i + 1] = cy + ((yv - 6) / 12) * R * 0.82
    }
    return N
  }
  if (kind === 'wave') {
    const N = 140
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1)
      out[2 * i] = cx + (-0.86 + s * 1.72) * R
      out[2 * i + 1] = cy + Math.sin(s * Math.PI * 4) * R * 0.34
    }
    return N
  }
  if (kind === 'tulip') {
    const N = 190
    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) * Math.PI
      const r = Math.cos(3 * t) * R * 0.86
      const a = t - Math.PI / 2
      out[2 * i] = cx + r * Math.cos(a)
      out[2 * i + 1] = cy + r * Math.sin(a)
    }
    return N
  }
  if (kind === 'spiral') {
    const N = 180
    const turns = 2.4
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1)
      const a = s * Math.PI * 2 * turns - Math.PI / 2
      const r = R * (0.12 + 0.82 * s)
      out[2 * i] = cx + r * Math.cos(a)
      out[2 * i + 1] = cy + r * Math.sin(a)
    }
    return N
  }
  if (kind === 'flower') {
    const N = 200
    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) * Math.PI
      const r = Math.cos(5 * t) * R * 0.9
      const a = t - Math.PI / 2
      out[2 * i] = cx + r * Math.cos(a)
      out[2 * i + 1] = cy + r * Math.sin(a)
    }
    return N
  }
  // rosetta — the real pour: a decaying zigzag, then the pull-through
  const N = 210
  const zig = 135
  for (let i = 0; i < zig; i++) {
    const s = i / (zig - 1)
    const amp = 0.54 * (1 - s * 0.68)
    out[2 * i] = cx + amp * Math.sin(s * Math.PI * 5) * R
    out[2 * i + 1] = cy + (-0.78 + s * 1.36) * R
  }
  for (let i = zig; i < N; i++) {
    const s = (i - zig) / (N - zig - 1)
    out[2 * i] = cx
    out[2 * i + 1] = cy + (0.58 - s * 1.44) * R
  }
  return N
}

export default function LatteArt({
  onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '',
  onProgress, resumeState,
}) {
  const rootRef = useRef(null)
  const cvsRef = useRef(null)
  const startRef = useRef(() => {})
  const nextRef = useRef(() => {})
  const finishRef = useRef(() => {})
  const onScoreRef = useRef(onScore)
  const onProgressRef = useRef(onProgress)
  const brandRef = useRef(brand)

  const saved = useMemo(() => {
    const s = resumeState
    return s && s.game === GAME_ID && s.v === PROG_V && Number(s.stage) > 0 ? s : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [view, setView] = useState('ready') // ready | draw | result | stageEnd | over
  const [score, setScore] = useState(0)
  const [stageNum, setStageNum] = useState(saved ? Number(saved.stage) : 1)
  const [lives, setLives] = useState(LIVES)
  const [pIndex, setPIndex] = useState(0)
  const [pCount, setPCount] = useState(3)
  const [pName, setPName] = useState('قلب')
  const [acc, setAcc] = useState(0)
  const [gained, setGained] = useState(0)
  const [spill, setSpill] = useState(false)
  const [tleft, setTleft] = useState(20)
  const [best, setBest] = useState(readBest)

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])
  useEffect(() => { brandRef.current = brand }, [brand])
  useEffect(() => { if (typeof onScoreRef.current === 'function') onScoreRef.current(score) }, [score])

  const drinkName = (() => {
    const list = Array.isArray(items) ? items : []
    const hit = list.find((it) => /لات|قهو|كابتش|موكا|شاي|اسبرس|إسبرس/.test(String((it && it.nameAr) || '')))
    const nm = String((hit && (hit.nameAr || hit.nameEn)) || '').trim()
    return nm && nm.length <= 20 ? nm : 'لاتيه'
  })()

  useEffect(() => {
    const root = rootRef.current
    const cvs = cvsRef.current
    if (!root || !cvs) return undefined
    const ctx = cvs.getContext('2d')
    const rm = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const st = {
      w: 0, h: 0, cx: 0, cy: 0, R: 60, raf: 0, last: 0, rm,
      view: 'ready', stage: 1, lives: LIVES, score: 0,
      keys: [], pi: 0, limit: 20, timeLeft: 20, shownTime: -1, hold: 0,
      target: new Float32Array(440), tn: 0,
      raw: new Float32Array(MAXPTS * 2), rn: 0,
      sT: new Float32Array(SAMPLES * 2), sD: new Float32Array(SAMPLES * 2), sn: 0,
      drawing: false, pid: -1, reveal: 0, accuracy: 0, swirl: 0,
      crema: null, drops: [],
    }

    const buildCrema = () => {
      const g = ctx.createRadialGradient(st.cx - st.R * 0.28, st.cy - st.R * 0.3, st.R * 0.1, st.cx, st.cy, st.R)
      g.addColorStop(0, '#d8a468')
      g.addColorStop(0.45, '#b87a45')
      g.addColorStop(0.86, '#8a5530')
      g.addColorStop(1, '#653c22')
      st.crema = g
    }

    const rebuildTarget = () => {
      const k = st.keys[st.pi] || 'heart'
      st.tn = buildPattern(k, st.cx, st.cy, st.R, st.target)
    }

    const layout = () => {
      const box = root.getBoundingClientRect()
      st.w = Math.max(1, Math.round(box.width))
      st.h = Math.max(1, Math.round(box.height))
      st.cx = st.w / 2
      st.cy = st.h * 0.47
      st.R = Math.max(40, Math.min(st.w * 0.40, st.h * 0.34))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cvs.width = Math.round(st.w * dpr)
      cvs.height = Math.round(st.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      buildCrema()
      rebuildTarget()
      st.rn = 0
      st.sn = 0
    }

    const reportProgress = (done) => {
      try {
        onProgressRef.current?.({
          game: GAME_ID, v: PROG_V, stage: st.stage, score: Math.round(st.score),
          done: !!done, completed: false, at: Date.now(),
        })
      } catch (_) { /* best-effort */ }
    }

    const loadPour = (i) => {
      st.pi = i
      rebuildTarget()
      st.rn = 0
      st.sn = 0
      st.reveal = 0
      st.accuracy = 0
      st.drops.length = 0
      st.timeLeft = st.limit
      st.view = 'draw'
      setView('draw')
      setPIndex(i)
      setPName(patternByKey(st.keys[i] || 'heart').name)
      setTleft(Math.ceil(st.limit))
    }

    const loadStage = (n) => {
      st.stage = n
      st.limit = stageSeconds(n)
      st.keys = chooseStage(n)
      setStageNum(n)
      setPCount(st.keys.length)
      loadPour(0)
    }

    const start = (cfg) => {
      st.score = Math.max(0, Math.floor(Number(cfg && cfg.score) || 0))
      st.lives = LIVES
      setScore(st.score)
      setLives(LIVES)
      setAcc(0)
      setGained(0)
      setSpill(false)
      play('deal')
      loadStage(Math.max(1, Math.floor(Number(cfg && cfg.stage) || 1)))
    }
    startRef.current = start

    const finish = () => {
      st.view = 'over'
      setView('over')
      setScore(st.score)
      if (typeof onScoreRef.current === 'function') onScoreRef.current(st.score)
      if (st.score > readBest()) { writeBest(st.score); setBest(st.score) }
      reportProgress(true)
      play('lose')
    }
    finishRef.current = finish

    const clearStage = () => {
      st.score += 100 + st.stage * 40
      st.hold = STAGE_HOLD
      st.view = 'stageEnd'
      setScore(st.score)
      setView('stageEnd')
      play('win', { gain: 0.55 })
      reportProgress(false)
    }

    const advance = () => {
      if (st.view === 'stageEnd') { loadStage(st.stage + 1); return }
      if (st.pi >= st.keys.length - 1) {
        if (st.lives <= 0) finish()
        else clearStage()
      } else {
        loadPour(st.pi + 1)
      }
    }
    nextRef.current = advance

    const grade = () => {
      const tol = st.R * 0.30
      let a = 0
      if (st.rn >= 2) {
        const nd = resample(st.raw, st.rn, st.sD, SAMPLES)
        const nt = resample(st.target, st.tn, st.sT, SAMPLES)
        if (nd && nt) {
          const d1 = chamfer(st.sT, nt, st.sD, nd)
          const d2 = chamfer(st.sD, nd, st.sT, nt)
          const seq = ordered(st.sT, st.sD, SAMPLES)
          const mean = 0.35 * ((d1 + d2) / 2) + 0.65 * seq
          a = Math.max(0, Math.min(1, 1 - mean / tol))
          st.sn = nd
        }
      }
      st.accuracy = a
      const pts = Math.round(a * 100 * patternByKey(st.keys[st.pi] || 'heart').mult)
      st.score += pts
      st.reveal = st.rm ? 1 : 0
      const spilled = a < FAIL_ACC
      if (spilled) { st.lives -= 1; setLives(st.lives) }
      st.view = 'result'
      setView('result')
      setAcc(Math.round(a * 100))
      setGained(pts)
      setSpill(spilled)
      setScore(st.score)
      if (spilled) {
        play('lose', { gain: 0.5 })
        if (st.lives <= 0) {
          // let the result card show, then the "التالي" button finishes; but a
          // dead run should read as over on its own — reveal then finish.
        }
      } else {
        play(a > 0.75 ? 'win' : 'capture', { gain: 0.5 })
      }
      if (!st.rm && a > 0.55) {
        for (let i = 0; i < 14; i++) {
          st.drops.push({
            x: st.cx + (Math.random() - 0.5) * st.R,
            y: st.cy + (Math.random() - 0.5) * st.R,
            r: 1.5 + Math.random() * 3, t: 0, life: 0.6 + Math.random() * 0.5,
          })
        }
      }
    }

    // ---------- input: one continuous stroke ----------
    const local = (e) => {
      const b = cvs.getBoundingClientRect()
      return [e.clientX - b.left, e.clientY - b.top]
    }
    const onDown = (e) => {
      if (st.view !== 'draw' || st.drawing || st.hold > 0) return
      e.preventDefault()
      const [x, y] = local(e)
      st.drawing = true
      st.pid = e.pointerId
      st.rn = 1
      st.raw[0] = x
      st.raw[1] = y
      play('card', { gain: 0.4 })
      try { cvs.setPointerCapture(e.pointerId) } catch (_) { /* not captureable */ }
    }
    const onMove = (e) => {
      if (!st.drawing || e.pointerId !== st.pid) return
      e.preventDefault()
      const [x, y] = local(e)
      const lx = st.raw[2 * st.rn - 2]
      const ly = st.raw[2 * st.rn - 1]
      if (Math.hypot(x - lx, y - ly) < 2.5) return
      if (st.rn >= MAXPTS) return
      st.raw[2 * st.rn] = x
      st.raw[2 * st.rn + 1] = y
      st.rn += 1
    }
    const onUp = (e) => {
      if (!st.drawing || e.pointerId !== st.pid) return
      st.drawing = false
      st.pid = -1
      try { cvs.releasePointerCapture(e.pointerId) } catch (_) { /* ignore */ }
      if (st.rn < 4 || polyLen(st.raw, st.rn) < st.R * 0.4) { st.rn = 0; return }
      grade()
    }
    cvs.addEventListener('pointerdown', onDown)
    cvs.addEventListener('pointermove', onMove)
    cvs.addEventListener('pointerup', onUp)
    cvs.addEventListener('pointercancel', onUp)

    // ---------- drawing ----------
    const strokePath = (arr, n, upto) => {
      if (n < 2) return
      const lim = Math.max(2, Math.min(n, Math.round(n * upto)))
      ctx.beginPath()
      ctx.moveTo(arr[0], arr[1])
      for (let i = 1; i < lim; i++) ctx.lineTo(arr[2 * i], arr[2 * i + 1])
      ctx.stroke()
    }

    const draw = () => {
      const { w, h, cx, cy, R } = st
      ctx.fillStyle = '#17110c'
      ctx.fillRect(0, 0, w, h)
      const bg = brandRef.current
      ctx.globalAlpha = 0.16
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
      ctx.globalAlpha = 1

      ctx.fillStyle = 'rgba(255,255,255,.07)'
      ctx.beginPath()
      ctx.ellipse(cx, cy + R * 0.16, R * 1.36, R * 1.2, 0, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = '#f4f6f8'
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.13, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(0,0,0,.10)'
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = st.crema
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.fill()

      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.clip()

      ctx.strokeStyle = 'rgba(255,224,186,.10)'
      ctx.lineWidth = R * 0.09
      for (let k = 0; k < 3; k++) {
        ctx.beginPath()
        ctx.arc(cx, cy, R * (0.34 + k * 0.22), st.swirl + k * 1.9, st.swirl + k * 1.9 + 2.1)
        ctx.stroke()
      }

      if (st.view === 'draw' || st.view === 'ready') {
        ctx.strokeStyle = 'rgba(255,246,232,.30)'
        ctx.lineWidth = Math.max(4, R * 0.10)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.setLineDash([R * 0.07, R * 0.07])
        strokePath(st.target, st.tn, 1)
        ctx.setLineDash([])
      }

      const live = st.view === 'draw' && st.rn >= 2
      const shown = st.view === 'result'
      if (live || shown) {
        const arr = shown && st.sn ? st.sD : st.raw
        const n = shown && st.sn ? st.sn : st.rn
        const upto = shown ? st.reveal : 1
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.strokeStyle = 'rgba(255,252,244,.35)'
        ctx.lineWidth = Math.max(9, R * 0.20)
        strokePath(arr, n, upto)
        ctx.strokeStyle = '#fffaf0'
        ctx.lineWidth = Math.max(5, R * 0.115)
        strokePath(arr, n, upto)
        if (shown && st.reveal < 1) {
          const i = Math.max(1, Math.min(n - 1, Math.round(n * st.reveal)))
          ctx.fillStyle = '#fff'
          ctx.beginPath()
          ctx.arc(arr[2 * i], arr[2 * i + 1], Math.max(5, R * 0.09), 0, Math.PI * 2)
          ctx.fill()
        }
      }

      for (let i = 0; i < st.drops.length; i++) {
        const d = st.drops[i]
        ctx.globalAlpha = Math.max(0, 1 - d.t / d.life) * 0.8
        ctx.fillStyle = '#fffdf6'
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r * (1 + d.t * 1.6), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.restore()

      ctx.strokeStyle = 'rgba(255,255,255,.5)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.09, Math.PI * 1.05, Math.PI * 1.75)
      ctx.stroke()

      ctx.fillStyle = 'rgba(255,255,255,.55)'
      ctx.font = '700 12px system-ui, "Segoe UI", Tahoma, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(drinkName, cx, cy + R * 1.36)
    }

    const frame = (now) => {
      st.raf = requestAnimationFrame(frame)
      const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 0
      st.last = now
      if (!st.rm) st.swirl += dt * 0.22
      if (st.hold > 0) st.hold = Math.max(0, st.hold - dt)

      if (st.view === 'draw') {
        st.timeLeft -= dt
        const nx = Math.max(0, Math.ceil(st.timeLeft))
        if (nx !== st.shownTime) { st.shownTime = nx; setTleft(nx) }
        if (st.timeLeft <= 0) {
          if (st.drawing) { st.drawing = false; st.pid = -1 }
          grade()
        }
      }
      if (st.view === 'result' && st.reveal < 1) {
        st.reveal = Math.min(1, st.reveal + dt * 1.6)
      }
      for (let i = st.drops.length - 1; i >= 0; i--) {
        const d = st.drops[i]
        d.t += dt
        if (d.t >= d.life) st.drops.splice(i, 1)
      }
      draw()
    }

    layout()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(layout) : null
    if (ro) ro.observe(root)
    window.addEventListener('resize', layout)
    st.raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(st.raf)
      cvs.removeEventListener('pointerdown', onDown)
      cvs.removeEventListener('pointermove', onMove)
      cvs.removeEventListener('pointerup', onUp)
      cvs.removeEventListener('pointercancel', onUp)
      window.removeEventListener('resize', layout)
      if (ro) ro.disconnect()
    }
  }, [])

  const rtl = lang !== 'en'
  const restart = (cfg) => startRef.current(cfg || null)
  const deadRun = lives <= 0
  const gradeTxt = spill ? 'انسكب الحليب' : acc >= 90 ? 'باريستا محترف' : acc >= 70 ? 'سكب نظيف' : acc >= 45 ? 'قريب جداً' : 'حاول أفضل'

  return (
    <div
      ref={rootRef}
      className="gmx-root gmla-root"
      dir={rtl ? 'rtl' : 'ltr'}
      style={{ '--gm-brand': brand }}
    >
      <canvas ref={cvsRef} className="gmx-canvas" />

      {(view === 'draw' || view === 'result' || view === 'stageEnd') && (
        <div className="gmx-hud">
          <span className="gmx-pill gmx-pill-score">{fmt(score)}</span>
          <span className="gmx-pill arb-stage-pill">المرحلة {fmt(stageNum)}</span>
          <span className="gmx-pill">{pName} {fmt(pIndex + 1)}/{fmt(pCount)}</span>
          {view === 'draw' && (
            <span className={`gmx-pill${tleft <= 5 ? ' is-warn' : ''}`}>{fmt(tleft)} ث</span>
          )}
          <span className="gmx-pill gmx-lives" aria-label={`الأكواب ${lives}`}>
            {[0, 1, 2].map((i) => <i key={i} className={`gmx-life${i < lives ? '' : ' off'}`} />)}
          </span>
        </div>
      )}

      {view === 'draw' && (
        <div className="gmla-hint">ارسم الشكل الباهت بحركة واحدة متصلة دون رفع إصبعك</div>
      )}

      {view === 'result' && (
        <div className="gmla-result">
          <div className={`gmla-acc${spill ? ' spill' : ''}`}>
            <b>{fmt(acc)}</b>
            <span>% دقة</span>
          </div>
          {/* Arabic tamyeez: 3-10 take «نقاط», everything else «نقطة» */}
          <p className="gmla-grade">{gradeTxt}: {fmt(gained)} {gained >= 3 && gained <= 10 ? 'نقاط' : 'نقطة'}</p>
          <button type="button" className="gmx-btn" onClick={() => (deadRun ? finishRef.current() : nextRef.current())}>
            {deadRun ? 'انتهت الأكواب' : (pIndex >= pCount - 1 ? 'أنهِ المرحلة' : 'الشكل التالي')}
          </button>
        </div>
      )}

      {view === 'stageEnd' && (
        <div className="gmx-veil">
          <div className="gmx-card">
            <h3 className="gmx-title">اكتملت المرحلة {fmt(stageNum)}</h3>
            <div className="gmx-big">{fmt(score)}</div>
            <p className="gmx-line">المرحلة التالية وقتها أقصر وأشكالها أصعب.</p>
            <div className="gmx-actions">
              <button type="button" className="gmx-btn" onClick={() => nextRef.current()}>المرحلة التالية</button>
              {typeof onExit === 'function' && (
                <button type="button" className="gmx-btn ghost" onClick={onExit}>إنهاء</button>
              )}
            </div>
          </div>
        </div>
      )}

      {view === 'ready' && (
        <div className="gmx-veil">
          <div className="gmx-card">
            <div className="gmx-emblem gmla-emblem" aria-hidden="true">
              <svg viewBox="0 0 48 48" width="48" height="48" focusable="false">
                <circle cx="24" cy="24" r="21" fill="#b87a45" />
                <path
                  d="M24 35c-7-5-11-9-11-14a6 6 0 0 1 11-3 6 6 0 0 1 11 3c0 5-4 9-11 14z"
                  fill="#fffaf0"
                />
              </svg>
            </div>
            <h3 className="gmx-title">فن اللاتيه</h3>
            <p className="gmx-line">تتبّع الشكل الباهت على الكريما بحركة سحب واحدة متصلة. كل مرحلة أشكال أكثر ووقت أقل، وسكب ضعيف يكسر كوباً. لديك ثلاثة أكواب.</p>
            {saved ? (
              <div className="gmx-actions">
                <button type="button" className="gmx-btn" onClick={() => restart({ stage: Number(saved.stage), score: Number(saved.score) || 0 })}>
                  تابع من المرحلة {fmt(saved.stage)}
                </button>
                <button type="button" className="gmx-btn ghost" onClick={() => restart()}>من البداية</button>
              </div>
            ) : (
              <button type="button" className="gmx-btn" onClick={() => restart()}>ابدأ السكب</button>
            )}
            {best > 0 && <p className="gmx-sub">أفضل نتيجة {fmt(best)}</p>}
          </div>
        </div>
      )}

      {view === 'over' && (
        <div className="gmx-veil">
          <div className="gmx-card">
            <h3 className="gmx-title">انتهت الجولة</h3>
            <div className="gmx-big">{fmt(score)}</div>
            <p className="gmx-line">
              {playerName ? `${playerName}، ` : ''}بلغت المرحلة {fmt(stageNum)}
            </p>
            <p className="gmx-sub">أفضل نتيجة {fmt(Math.max(best, score))}</p>
            <div className="gmx-actions">
              <button type="button" className="gmx-btn" onClick={() => restart()}>جولة جديدة</button>
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
