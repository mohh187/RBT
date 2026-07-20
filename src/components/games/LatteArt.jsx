// «فن اللاتيه» — LatteArt: three latte-art patterns (قلب / توليب / روزيتا) are
// ghosted onto the crema and the player traces each one with a single
// continuous drag. The score is an HONEST geometric match: both the target and
// the drawn path are resampled to equal arc-length points and compared with a
// symmetric point-to-segment (chamfer) distance, so shortcuts, over-shoots and
// half-finished strokes are all punished the way they should be.
//
// CONTRACT (hub-rendered): fills its parent, play area only, ABSOLUTE score via
// onScore(). Canvas art only — no emojis, Latin digits, Arabic copy, pointer
// events, single rAF loop, dPR aware, full teardown on unmount.
import { useEffect, useRef, useState } from 'react'

const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

const BEST_KEY = 'rbt_game_latteart_best'
const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch (_) { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)) } catch (_) { /* private mode */ } }

const PATTERNS = [
  { key: 'heart', name: 'قلب', mult: 1 },
  { key: 'tulip', name: 'توليب', mult: 1.25 },
  { key: 'rosetta', name: 'روزيتا', mult: 1.5 },
]
const ROUND_LIMIT = 22 // seconds per pattern — keeps a round near one minute
const SAMPLES = 72     // resample resolution used on both paths
const MAXPTS = 2400    // pre-allocated capacity for the raw drawn stroke

// ---------- geometry helpers (no allocations in the hot path) ----------
function polyLen(a, n) {
  let L = 0
  for (let i = 1; i < n; i++) L += Math.hypot(a[2 * i] - a[2 * i - 2], a[2 * i + 1] - a[2 * i - 1])
  return L
}

// even arc-length resampling of a flat [x,y,...] polyline into `m` points
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

// mean distance from every point of A to the closest place on polyline B
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

// Chamfer alone is a point-CLOUD metric, so it happily gives full marks to a
// half-finished rosetta (its pull-through stroke lies on top of its own
// zigzag). This compares the two paths as ORDERED sequences instead: both are
// already resampled by arc length, so point i of each is at the same fraction
// of its stroke, and a shortcut immediately falls out of step. Closed patterns
// may be started anywhere and traced either way round, so we take the best
// score over every rotation and both directions.
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
        if (sum >= best * n) { bail = true; break } // already worse than the winner
      }
      if (!bail && sum / n < best) best = sum / n
    }
  }
  return best
}

// ---------- the three patterns, written straight into a flat array ----------
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
  if (kind === 'tulip') {
    // three-petal rose: r = cos(3t), rotated so one petal points up
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

export default function LatteArt({ onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '' }) {
  const rootRef = useRef(null)
  const cvsRef = useRef(null)
  const startRef = useRef(() => {})
  const nextRef = useRef(() => {})
  const onScoreRef = useRef(onScore)
  const brandRef = useRef(brand)

  const [stage, setStage] = useState('ready') // ready | draw | result | over
  const [score, setScore] = useState(0)
  const [idx, setIdx] = useState(0)
  const [acc, setAcc] = useState(0)
  const [gained, setGained] = useState(0)
  const [tleft, setTleft] = useState(ROUND_LIMIT)
  const [best, setBest] = useState(readBest)

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { brandRef.current = brand }, [brand])
  useEffect(() => { if (typeof onScoreRef.current === 'function') onScoreRef.current(score) }, [score])

  // the venue's own drink gets named on the cup
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
      stage: 'ready', pi: 0, score: 0, timeLeft: ROUND_LIMIT,
      target: new Float32Array(440), tn: 0,
      raw: new Float32Array(MAXPTS * 2), rn: 0,
      sT: new Float32Array(SAMPLES * 2), sD: new Float32Array(SAMPLES * 2), sn: 0,
      drawing: false, pid: -1, reveal: 0, accuracy: 0, swirl: 0, shownTime: -1,
      crema: null, drops: [], accs: [0, 0, 0],
    }

    const buildCrema = () => {
      const g = ctx.createRadialGradient(st.cx - st.R * 0.28, st.cy - st.R * 0.3, st.R * 0.1, st.cx, st.cy, st.R)
      g.addColorStop(0, '#d8a468')
      g.addColorStop(0.45, '#b87a45')
      g.addColorStop(0.86, '#8a5530')
      g.addColorStop(1, '#653c22')
      st.crema = g
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
      st.tn = buildPattern(PATTERNS[st.pi].key, st.cx, st.cy, st.R, st.target)
      st.rn = 0
      st.sn = 0
    }

    const loadPattern = (i) => {
      st.pi = i
      st.tn = buildPattern(PATTERNS[i].key, st.cx, st.cy, st.R, st.target)
      st.rn = 0
      st.sn = 0
      st.reveal = 0
      st.accuracy = 0
      st.drops.length = 0
      st.timeLeft = ROUND_LIMIT
      st.stage = 'draw'
      setStage('draw')
      setIdx(i)
      setTleft(ROUND_LIMIT)
    }

    const start = () => {
      st.score = 0
      st.accs[0] = 0
      st.accs[1] = 0
      st.accs[2] = 0
      setScore(0)
      setAcc(0)
      setGained(0)
      loadPattern(0)
    }
    startRef.current = start

    const finish = () => {
      st.stage = 'over'
      setStage('over')
      setScore(st.score)
      if (typeof onScoreRef.current === 'function') onScoreRef.current(st.score)
      if (st.score > readBest()) { writeBest(st.score); setBest(st.score) }
    }

    const advance = () => {
      if (st.pi >= PATTERNS.length - 1) finish()
      else loadPattern(st.pi + 1)
    }
    nextRef.current = advance

    const grade = () => {
      const tol = st.R * 0.30
      let a = 0
      if (st.rn >= 2) {
        const nd = resample(st.raw, st.rn, st.sD, SAMPLES)
        const nt = resample(st.target, st.tn, st.sT, SAMPLES)
        if (nd && nt) {
          const d1 = chamfer(st.sT, nt, st.sD, nd) // did they cover the target
          const d2 = chamfer(st.sD, nd, st.sT, nt) // did they stray off it
          const seq = ordered(st.sT, st.sD, SAMPLES) // did they actually walk it
          const mean = 0.35 * ((d1 + d2) / 2) + 0.65 * seq
          a = Math.max(0, Math.min(1, 1 - mean / tol))
          st.sn = nd
        }
      }
      st.accuracy = a
      st.accs[st.pi] = Math.round(a * 100)
      const pts = Math.round(a * 100 * PATTERNS[st.pi].mult)
      st.score += pts
      st.reveal = st.rm ? 1 : 0
      st.stage = 'result'
      setStage('result')
      setAcc(Math.round(a * 100))
      setGained(pts)
      setScore(st.score)
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
      if (st.stage !== 'draw' || st.drawing) return
      e.preventDefault()
      const [x, y] = local(e)
      st.drawing = true
      st.pid = e.pointerId
      st.rn = 1
      st.raw[0] = x
      st.raw[1] = y
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
      // an accidental tap is not a stroke — let them try again
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
      // room backdrop
      ctx.fillStyle = '#17110c'
      ctx.fillRect(0, 0, w, h)
      const bg = brandRef.current
      ctx.globalAlpha = 0.16
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
      ctx.globalAlpha = 1

      // saucer
      ctx.fillStyle = 'rgba(255,255,255,.07)'
      ctx.beginPath()
      ctx.ellipse(cx, cy + R * 0.16, R * 1.36, R * 1.2, 0, 0, Math.PI * 2)
      ctx.fill()

      // ceramic cup rim
      ctx.fillStyle = '#f4f6f8'
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.13, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(0,0,0,.10)'
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2)
      ctx.fill()

      // crema
      ctx.fillStyle = st.crema
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.fill()

      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.clip()

      // slow crema swirl
      ctx.strokeStyle = 'rgba(255,224,186,.10)'
      ctx.lineWidth = R * 0.09
      for (let k = 0; k < 3; k++) {
        ctx.beginPath()
        ctx.arc(cx, cy, R * (0.34 + k * 0.22), st.swirl + k * 1.9, st.swirl + k * 1.9 + 2.1)
        ctx.stroke()
      }

      // ghosted target
      if (st.stage === 'draw' || st.stage === 'ready') {
        ctx.strokeStyle = 'rgba(255,246,232,.30)'
        ctx.lineWidth = Math.max(4, R * 0.10)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.setLineDash([R * 0.07, R * 0.07])
        strokePath(st.target, st.tn, 1)
        ctx.setLineDash([])
      }

      // poured milk — the player's stroke
      const live = st.stage === 'draw' && st.rn >= 2
      const shown = st.stage === 'result'
      if (live || shown) {
        const arr = shown && st.sn ? st.sD : st.raw
        const n = shown && st.sn ? st.sn : st.rn
        const upto = shown ? st.reveal : 1
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        // soft milk halo
        ctx.strokeStyle = 'rgba(255,252,244,.35)'
        ctx.lineWidth = Math.max(9, R * 0.20)
        strokePath(arr, n, upto)
        // milk core
        ctx.strokeStyle = '#fffaf0'
        ctx.lineWidth = Math.max(5, R * 0.115)
        strokePath(arr, n, upto)
        // pour head
        if (shown && st.reveal < 1) {
          const i = Math.max(1, Math.min(n - 1, Math.round(n * st.reveal)))
          ctx.fillStyle = '#fff'
          ctx.beginPath()
          ctx.arc(arr[2 * i], arr[2 * i + 1], Math.max(5, R * 0.09), 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // milk droplets on a good pour
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

      // rim shine
      ctx.strokeStyle = 'rgba(255,255,255,.5)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.09, Math.PI * 1.05, Math.PI * 1.75)
      ctx.stroke()

      // cup label
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

      if (st.stage === 'draw') {
        st.timeLeft -= dt
        const nx = Math.max(0, Math.ceil(st.timeLeft))
        if (nx !== st.shownTime) { st.shownTime = nx; setTleft(nx) }
        if (st.timeLeft <= 0) {
          if (st.drawing) { st.drawing = false; st.pid = -1 }
          grade()
        }
      }
      if (st.stage === 'result' && st.reveal < 1) {
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
  const restart = () => startRef.current()
  const gradeTxt = acc >= 90 ? 'باريستا محترف' : acc >= 70 ? 'سكب نظيف' : acc >= 45 ? 'قريب جداً' : 'حاول مرة أخرى'

  return (
    <div
      ref={rootRef}
      className="gmx-root gmla-root"
      dir={rtl ? 'rtl' : 'ltr'}
      style={{ '--gm-brand': brand }}
    >
      <canvas ref={cvsRef} className="gmx-canvas" />

      {(stage === 'draw' || stage === 'result') && (
        <div className="gmx-hud">
          <span className="gmx-pill gmx-pill-score">{fmt(score)}</span>
          <span className="gmx-pill">{PATTERNS[idx].name} {fmt(idx + 1)}/{fmt(PATTERNS.length)}</span>
          {stage === 'draw' && (
            <span className={`gmx-pill${tleft <= 5 ? ' is-warn' : ''}`}>{fmt(tleft)} ث</span>
          )}
        </div>
      )}

      {stage === 'draw' && (
        <div className="gmla-hint">ارسم الشكل الباهت بحركة واحدة متصلة دون رفع إصبعك</div>
      )}

      {stage === 'result' && (
        <div className="gmla-result">
          <div className="gmla-acc">
            <b>{fmt(acc)}</b>
            <span>% دقة</span>
          </div>
          <p className="gmla-grade">{gradeTxt} — {fmt(gained)} نقطة</p>
          <button type="button" className="gmx-btn" onClick={() => nextRef.current()}>
            {idx >= PATTERNS.length - 1 ? 'النتيجة' : 'الشكل التالي'}
          </button>
        </div>
      )}

      {stage === 'ready' && (
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
            <p className="gmx-line">تتبّع الشكل الباهت على الكريما بحركة سحب واحدة متصلة. كلما اقترب خطك من الشكل ارتفعت نسبة الدقة — ثلاثة أشكال في الجولة.</p>
            <button type="button" className="gmx-btn" onClick={restart}>ابدأ السكب</button>
            {best > 0 && <p className="gmx-sub">أفضل نتيجة {fmt(best)}</p>}
          </div>
        </div>
      )}

      {stage === 'over' && (
        <div className="gmx-veil">
          <div className="gmx-card">
            <h3 className="gmx-title">انتهت الجولة</h3>
            <div className="gmx-big">{fmt(score)}</div>
            <p className="gmx-line">
              {playerName ? `${playerName}، ` : ''}متوسط دقتك في الأشكال الثلاثة
            </p>
            <p className="gmx-sub">أفضل نتيجة {fmt(Math.max(best, score))}</p>
            <div className="gmx-actions">
              <button type="button" className="gmx-btn" onClick={restart}>جولة جديدة</button>
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
