// «فقاعات الشاي» — BubblePop: tapioca pearls rise through the tea and stack up
// under the lid. Tapping a pearl pops it together with every same-coloured
// pearl it is touching (a flood fill through the contact graph), and the score
// grows with the SQUARE of the chain, so a six-pearl chain is worth far more
// than six singles. Every pearl that enters the cup pushes the tea level up;
// popping a lone pearl shoves it up hard, while chains of three or more relieve
// the pressure. When the tea reaches the overflow line the cup spills.
//
// CONTRACT (hub-rendered): fills its parent, play area only, ABSOLUTE score via
// onScore(). Canvas paths only — no emojis, Latin digits, Arabic copy, pointer
// events, one rAF loop, dPR aware, fully torn down on unmount.
import { useEffect, useRef, useState } from 'react'

const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

const BEST_KEY = 'rbt_game_bubblepop_best'
const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch (_) { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)) } catch (_) { /* private mode */ } }

const TAU = Math.PI * 2
const MAXB = 64
const COLORS = ['#43261a', '#8e6bb8', '#4f9d55', '#d4557f', '#e0913a']
const LIGHT = ['#7a4a30', '#b394d8', '#7cc47f', '#ee87a6', '#f5b463']
const TOPPAD = 46   // room for the HUD pills
const OVERFLOW = 0.12 // the cup spills when the tea surface passes this fraction

// chain -> points: quadratic, with a kicker once the chain gets big
const chainScore = (n) => Math.round(5 * n * n * (n >= 6 ? 1.5 : 1))

export default function BubblePop({ onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '' }) {
  const rootRef = useRef(null)
  const cvsRef = useRef(null)
  const startRef = useRef(() => {})
  const onScoreRef = useRef(onScore)
  const brandRef = useRef(brand)

  const [phase, setPhase] = useState('ready') // ready | play | over
  const [score, setScore] = useState(0)
  const [pressure, setPressure] = useState(0)
  const [bestChain, setBestChain] = useState(0)
  const [best, setBest] = useState(readBest)

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { brandRef.current = brand }, [brand])
  useEffect(() => { if (typeof onScoreRef.current === 'function') onScoreRef.current(score) }, [score])

  const drinkName = (() => {
    const list = Array.isArray(items) ? items : []
    const hit = list.find((it) => /شاي|بوبا|فقاع|تابيوكا|حليب|مثلج/.test(String((it && it.nameAr) || '')))
    const nm = String((hit && (hit.nameAr || hit.nameEn)) || '').trim()
    return nm && nm.length <= 20 ? nm : 'شاي الفقاعات'
  })()

  useEffect(() => {
    const root = rootRef.current
    const cvs = cvsRef.current
    if (!root || !cvs) return undefined
    const ctx = cvs.getContext('2d')
    const rm = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const st = {
      w: 0, h: 0, raf: 0, last: 0, rm, phase: 'ready',
      bs: new Array(MAXB), parts: [], pops: [],
      stamp: new Int32Array(MAXB), queue: new Int32Array(MAXB), chain: new Int32Array(MAXB), gen: 0,
      P: 0, elapsed: 0, nextSpawn: 0, score: 0, bestChain: 0,
      wave: 0, shownP: -1, teaY: 0, shake: 0, relief: 0,
    }
    for (let i = 0; i < MAXB; i++) {
      st.bs[i] = { alive: false, popping: false, x: 0, y: 0, vx: 0, vy: 0, r: 12, c: 0, ph: 0, pop: 0 }
    }

    const colorCount = () => (st.elapsed > 25 ? 5 : 4)
    const teaSurface = () => st.h - st.h * (0.20 + st.P * (1 - OVERFLOW - 0.20))

    const aliveCount = () => {
      let n = 0
      for (let i = 0; i < MAXB; i++) if (st.bs[i].alive) n += 1
      return n
    }

    const spawn = () => {
      let slot = -1
      for (let i = 0; i < MAXB; i++) if (!st.bs[i].alive) { slot = i; break }
      if (slot < 0) return
      const b = st.bs[slot]
      const r = Math.max(11, Math.min(st.w * 0.062, 24))
      b.alive = true
      b.popping = false
      b.pop = 0
      b.r = r * (0.86 + Math.random() * 0.28)
      b.x = b.r + Math.random() * Math.max(1, st.w - b.r * 2)
      b.y = Math.min(st.h - b.r, st.teaY + b.r + 6 + Math.random() * 30)
      b.vx = (Math.random() - 0.5) * 24
      b.vy = -30 - Math.random() * 20
      b.c = Math.floor(Math.random() * colorCount())
      b.ph = Math.random() * TAU
      st.P = Math.min(1, st.P + 0.012)
    }

    const start = () => {
      for (let i = 0; i < MAXB; i++) st.bs[i].alive = false
      st.parts.length = 0
      st.pops.length = 0
      st.P = 0
      st.elapsed = 0
      st.nextSpawn = 0
      st.score = 0
      st.bestChain = 0
      st.shownP = -1
      st.shake = 0
      st.relief = 0
      st.teaY = st.h * 0.8
      st.phase = 'play'
      setPhase('play')
      setScore(0)
      setPressure(0)
      setBestChain(0)
      for (let i = 0; i < 12; i++) spawn()
      st.P = 0
    }
    startRef.current = start

    const endGame = () => {
      st.phase = 'over'
      setPhase('over')
      setScore(st.score)
      setBestChain(st.bestChain)
      if (typeof onScoreRef.current === 'function') onScoreRef.current(st.score)
      if (st.score > readBest()) { writeBest(st.score); setBest(st.score) }
    }

    const burst = (b) => {
      const n = st.rm ? 4 : 10
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + Math.random()
        const sp = 60 + Math.random() * 150
        st.parts.push({
          x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
          r: 1.8 + Math.random() * 3.2, t: 0, life: 0.4 + Math.random() * 0.4, c: b.c,
        })
      }
      st.pops.push({ x: b.x, y: b.y, r: b.r, t: 0, c: b.c })
    }

    // flood fill through touching, same-coloured pearls
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
          if (!b.alive || b.popping || b.c !== col) continue
          const dx = a.x - b.x
          const dy = a.y - b.y
          const reach = a.r + b.r + 9
          if (dx * dx + dy * dy <= reach * reach) { st.stamp[j] = g; st.queue[qt++] = j }
        }
      }
      return cn
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
        if (d <= b.r + 10 && d < bestD) { bestD = d; hit = i }
      }
      if (hit < 0) return
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
      const gain = chainScore(n)
      st.score += gain
      if (n > st.bestChain) st.bestChain = n

      if (n === 1) st.P = Math.min(1, st.P + 0.05)
      else if (n === 2) st.P = Math.min(1, st.P + 0.015)
      else {
        st.P = Math.max(0, st.P - Math.min(0.10, 0.012 * (n - 2)))
        st.relief = 1
      }
      if (n >= 4 && !st.rm) st.shake = Math.min(1, n / 10)

      st.pops.push({ x: sx / n, y: sy / n, r: 0, t: 0, c: st.bs[st.chain[0]].c, txt: `+${gain}`, chain: n })
      setScore(st.score)
      setBestChain(st.bestChain)
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
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cvs.width = Math.round(st.w * dpr)
      cvs.height = Math.round(st.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (!st.teaY) st.teaY = st.h * 0.8
    }

    // ---------- physics ----------
    const step = (dt) => {
      st.elapsed += dt
      st.teaY = teaSurface()

      st.nextSpawn -= dt
      if (st.nextSpawn <= 0) {
        st.nextSpawn = Math.max(0.30, 0.95 - st.elapsed * 0.012)
        if (aliveCount() < MAXB - 2) spawn()
        else st.P = Math.min(1, st.P + 0.02)
      }

      const top = TOPPAD
      for (let i = 0; i < MAXB; i++) {
        const b = st.bs[i]
        if (!b.alive) continue
        if (b.popping) {
          b.pop -= dt * 6
          if (b.pop <= 0) { b.alive = false; b.popping = false }
          continue
        }
        b.vy -= 300 * dt
        if (b.vy < -95) b.vy = -95
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
        p.vy += 620 * dt
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
      if (np !== st.shownP) { st.shownP = np; setPressure(np) }
      if (st.teaY <= st.h * OVERFLOW) endGame()
    }

    // ---------- rendering ----------
    const draw = () => {
      const { w, h } = st
      ctx.save()
      if (st.shake > 0.01) ctx.translate((Math.random() - 0.5) * 7 * st.shake, (Math.random() - 0.5) * 7 * st.shake)

      // glass
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
      ctx.fillRect(-11, TOPPAD - 30, 22, h)
      ctx.restore()
      ctx.globalAlpha = 1

      // tea
      const ty = st.teaY
      ctx.beginPath()
      ctx.moveTo(0, h)
      ctx.lineTo(0, ty)
      const amp = st.rm ? 0 : 3.4
      for (let x = 0; x <= w; x += 10) {
        ctx.lineTo(x, ty + Math.sin(x * 0.032 + st.wave) * amp)
      }
      ctx.lineTo(w, h)
      ctx.closePath()
      const tg = ctx.createLinearGradient(0, ty, 0, h)
      tg.addColorStop(0, 'rgba(214,176,132,.92)')
      tg.addColorStop(1, 'rgba(150,106,66,.96)')
      ctx.fillStyle = tg
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,.42)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, ty)
      for (let x = 0; x <= w; x += 10) ctx.lineTo(x, ty + Math.sin(x * 0.032 + st.wave) * amp)
      ctx.stroke()

      // overflow line
      const oy = h * OVERFLOW
      ctx.setLineDash([7, 6])
      ctx.strokeStyle = st.P > 0.75 ? 'rgba(255,110,90,.95)' : 'rgba(255,255,255,.35)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, oy)
      ctx.lineTo(w, oy)
      ctx.stroke()
      ctx.setLineDash([])

      // pearls
      for (let i = 0; i < MAXB; i++) {
        const b = st.bs[i]
        if (!b.alive) continue
        const jig = st.rm ? 1 : 1 + Math.sin(st.wave * 3 + b.ph) * 0.03
        const r = b.popping ? b.r * (1 + (1 - b.pop) * 0.7) : b.r * jig
        if (b.popping) ctx.globalAlpha = Math.max(0, b.pop)
        ctx.fillStyle = COLORS[b.c]
        ctx.beginPath()
        ctx.arc(b.x, b.y, r, 0, TAU)
        ctx.fill()
        ctx.fillStyle = LIGHT[b.c]
        ctx.beginPath()
        ctx.arc(b.x - r * 0.16, b.y - r * 0.2, r * 0.62, 0, TAU)
        ctx.fill()
        ctx.fillStyle = COLORS[b.c]
        ctx.beginPath()
        ctx.arc(b.x, b.y, r * 0.52, 0, TAU)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,.6)'
        ctx.beginPath()
        ctx.arc(b.x - r * 0.34, b.y - r * 0.36, r * 0.2, 0, TAU)
        ctx.fill()
        ctx.globalAlpha = 1
      }

      // pop rings + chain labels
      for (let i = 0; i < st.pops.length; i++) {
        const p = st.pops[i]
        if (p.txt) {
          const k = Math.min(1, p.t / 1.0)
          ctx.globalAlpha = 1 - k
          ctx.fillStyle = '#fff'
          ctx.font = '900 22px system-ui, "Segoe UI", Tahoma, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(p.txt, p.x, p.y - k * 40)
          if (p.chain >= 3) {
            ctx.font = '800 12px system-ui, "Segoe UI", Tahoma, sans-serif'
            ctx.fillStyle = '#ffd166'
            ctx.fillText(`سلسلة ${p.chain}`, p.x, p.y - k * 40 + 19)
          }
          ctx.globalAlpha = 1
        } else {
          const k = Math.min(1, p.t / 0.45)
          ctx.globalAlpha = (1 - k) * 0.8
          ctx.strokeStyle = LIGHT[p.c]
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r * (1 + k * 1.6), 0, TAU)
          ctx.stroke()
          ctx.globalAlpha = 1
        }
      }

      // droplets
      for (let i = 0; i < st.parts.length; i++) {
        const p = st.parts[i]
        ctx.globalAlpha = Math.max(0, 1 - p.t / p.life)
        ctx.fillStyle = LIGHT[p.c]
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, TAU)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // relief pulse when a big chain drains the cup
      if (st.relief > 0.01) {
        ctx.globalAlpha = st.relief * 0.18
        ctx.fillStyle = '#8ef0c0'
        ctx.fillRect(0, 0, w, h)
        ctx.globalAlpha = 1
      }

      // glass rim + label
      ctx.strokeStyle = 'rgba(255,255,255,.16)'
      ctx.lineWidth = 3
      ctx.strokeRect(1.5, 1.5, w - 3, h - 3)
      ctx.fillStyle = 'rgba(255,255,255,.4)'
      ctx.font = '700 11px system-ui, "Segoe UI", Tahoma, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(drinkName, w / 2, h - 6)
      ctx.restore()
    }

    const frame = (now) => {
      st.raf = requestAnimationFrame(frame)
      const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 0
      st.last = now
      st.wave += dt * 1.5
      if (st.phase === 'play') step(dt)
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
  const restart = () => startRef.current()

  return (
    <div
      ref={rootRef}
      className="gmx-root gmbp-root"
      dir={rtl ? 'rtl' : 'ltr'}
      style={{ '--gm-brand': brand }}
    >
      <canvas ref={cvsRef} className="gmx-canvas" />

      {phase === 'play' && (
        <div className="gmx-hud">
          <span className="gmx-pill gmx-pill-score">{fmt(score)}</span>
          <span className={`gmx-pill${pressure >= 75 ? ' is-warn' : ''}`}>الضغط {fmt(pressure)}%</span>
          {bestChain >= 3 && <span className="gmx-pill gmx-pill-hot">أطول سلسلة {fmt(bestChain)}</span>}
        </div>
      )}

      {phase === 'ready' && (
        <div className="gmx-veil">
          <div className="gmx-card">
            <div className="gmx-emblem gmbp-emblem" aria-hidden="true">
              <span /><span /><span /><span />
            </div>
            <h3 className="gmx-title">فقاعات الشاي</h3>
            <p className="gmx-line">اضغط على فقاعة لتفجيرها مع كل الفقاعات الملاصقة لها بنفس اللون. السلاسل الكبيرة تضاعف النقاط وتخفض ضغط الكوب، أما الفقاعة الوحيدة فترفعه — لا تدع الشاي يتجاوز الخط.</p>
            <button type="button" className="gmx-btn" onClick={restart}>ابدأ</button>
            {best > 0 && <p className="gmx-sub">أفضل نتيجة {fmt(best)}</p>}
          </div>
        </div>
      )}

      {phase === 'over' && (
        <div className="gmx-veil">
          <div className="gmx-card">
            <h3 className="gmx-title">طفح الكوب</h3>
            <div className="gmx-big">{fmt(score)}</div>
            <p className="gmx-line">
              {playerName ? `${playerName}، ` : ''}أطول سلسلة فجّرتها {fmt(bestChain)} فقاعات
            </p>
            <p className="gmx-sub">أفضل نتيجة {fmt(Math.max(best, score))}</p>
            <div className="gmx-actions">
              <button type="button" className="gmx-btn" onClick={restart}>العب مرة أخرى</button>
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
