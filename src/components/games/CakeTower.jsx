// «برج الكيك» — CakeTower: the classic stacker, re-skinned as a layer cake.
// A cake layer slides horizontally over the tower; tap to drop it. The part
// that hangs over the layer below is sliced off and tumbles away; a pixel
// perfect drop pays a combo bonus, flashes the screen and hands back a sliver
// of width. Endless — the tower scrolls down as it grows, and a total miss
// ends the round.
//
// CONTRACT (hub-rendered): fills its parent, draws only the play area, reports
// the ABSOLUTE score through onScore(). No emojis (every crumb is a canvas
// path), Latin digits only, Arabic copy, pointer events, one rAF loop,
// devicePixelRatio aware, everything torn down on unmount.
import { useEffect, useRef, useState } from 'react'

const fmt = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

const BEST_KEY = 'rbt_game_caketower_best'
const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch (_) { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)) } catch (_) { /* private mode */ } }

// sponge / cream pairs — deliberately warm and edible-looking
const PALETTE = [
  { sponge: '#f0d29b', cream: '#fff7e8', crumb: '#d9b478' },
  { sponge: '#c9835a', cream: '#ffeedd', crumb: '#a86540' },
  { sponge: '#7d4f36', cream: '#f6e0c9', crumb: '#5d3826' },
  { sponge: '#e9a2b6', cream: '#fff1f5', crumb: '#cf7f95' },
  { sponge: '#9fc98a', cream: '#f3fbe9', crumb: '#7ba767' },
  { sponge: '#d9a066', cream: '#fdf1e1', crumb: '#b57e48' },
  { sponge: '#b98ecb', cream: '#f7effb', crumb: '#946ba6' },
]
const FLAVORS = ['فانيلا', 'شوكولاتة', 'تمر', 'فستق', 'توت', 'قهوة', 'كراميل', 'جوز الهند', 'ليمون', 'عسل']

// rounded rect without depending on ctx.roundRect
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

export default function CakeTower({ onScore, onExit, lang = 'ar', brand = '#0e7490', items = [], playerName = '' }) {
  const rootRef = useRef(null)
  const cvsRef = useRef(null)
  const stRef = useRef(null)
  const startRef = useRef(() => {})
  const onScoreRef = useRef(onScore)
  const brandRef = useRef(brand)
  const labelsRef = useRef(FLAVORS)

  const [phase, setPhase] = useState('ready') // ready | play | over
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [tall, setTall] = useState(0)
  const [best, setBest] = useState(readBest)

  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { brandRef.current = brand }, [brand])
  useEffect(() => { if (typeof onScoreRef.current === 'function') onScoreRef.current(score) }, [score])

  // real menu items become the flavour written on each layer
  const itemKey = (Array.isArray(items) ? items : []).map((it) => (it && it.id) || '').join('|')
  useEffect(() => {
    const names = (Array.isArray(items) ? items : [])
      .map((it) => String((it && (it.nameAr || it.nameEn)) || '').trim())
      .filter((s) => s && s.length <= 18)
    labelsRef.current = names.length >= 3 ? names : FLAVORS
  }, [itemKey])

  useEffect(() => {
    const root = rootRef.current
    const cvs = cvsRef.current
    if (!root || !cvs) return undefined
    const ctx = cvs.getContext('2d')
    const rm = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const st = {
      w: 0, h: 0, lh: 26, baseY: 0, raf: 0, last: 0, phase: 'ready', rm,
      layers: [], mov: null, debris: [], sparks: [],
      cam: 0, camTarget: 0, flash: 0, shake: 0,
      score: 0, combo: 0, bg: null, glow: null, toast: { t: 0, txt: '', x: 0, y: 0 },
    }
    stRef.current = st

    const pickLabel = (n) => {
      const list = labelsRef.current
      return list[((n % list.length) + list.length) % list.length]
    }

    const buildPaints = () => {
      const g = ctx.createLinearGradient(0, 0, 0, st.h)
      g.addColorStop(0, '#1b1220')
      g.addColorStop(0.55, '#2a1a2b')
      g.addColorStop(1, '#3a2231')
      st.bg = g
      const rg = ctx.createRadialGradient(st.w / 2, st.h * 0.62, 10, st.w / 2, st.h * 0.62, Math.max(st.w, st.h) * 0.7)
      rg.addColorStop(0, 'rgba(255,255,255,.10)')
      rg.addColorStop(1, 'rgba(255,255,255,0)')
      st.glow = rg
    }

    const resize = () => {
      const box = root.getBoundingClientRect()
      const w = Math.max(1, Math.round(box.width))
      const h = Math.max(1, Math.round(box.height))
      if (st.w > 0 && w !== st.w) {
        const k = w / st.w
        for (let i = 0; i < st.layers.length; i++) { st.layers[i].x *= k; st.layers[i].w *= k }
        if (st.mov) { st.mov.x *= k; st.mov.w *= k; st.mov.speed *= k }
      }
      st.w = w
      st.h = h
      st.lh = Math.max(16, Math.min(34, h * 0.058))
      st.baseY = h - Math.max(30, h * 0.085)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cvs.width = Math.round(w * dpr)
      cvs.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      buildPaints()
    }

    const mkMov = (n) => {
      const prev = st.layers[st.layers.length - 1]
      const w = prev ? prev.w : Math.min(st.w * 0.62, 260)
      const fromLeft = n % 2 === 1
      const speed = Math.min(st.w * 1.85, st.w * 0.52 * (1 + n * 0.05))
      return {
        x: fromLeft ? 0 : Math.max(0, st.w - w),
        w, dir: fromLeft ? 1 : -1, speed,
        ci: n % PALETTE.length, label: pickLabel(n),
      }
    }

    const start = () => {
      st.layers.length = 0
      st.debris.length = 0
      st.sparks.length = 0
      const bw = Math.min(st.w * 0.62, 260)
      st.layers.push({ x: (st.w - bw) / 2, w: bw, ci: 0, label: pickLabel(0) })
      st.mov = mkMov(1)
      st.score = 0
      st.combo = 0
      st.cam = 0
      st.camTarget = 0
      st.flash = 0
      st.shake = 0
      st.toast.t = 0
      st.phase = 'play'
      setPhase('play')
      setScore(0)
      setCombo(0)
      setTall(1)
    }
    startRef.current = start

    const burst = (x, y, ci, n) => {
      const count = st.rm ? Math.round(n * 0.4) : n
      const c = PALETTE[ci % PALETTE.length]
      for (let i = 0; i < count; i++) {
        st.sparks.push({
          x, y,
          vx: (Math.random() - 0.5) * 260,
          vy: -Math.random() * 220 - 40,
          r: 1.6 + Math.random() * 2.8,
          life: 0.5 + Math.random() * 0.5,
          t: 0,
          col: Math.random() < 0.5 ? c.cream : c.crumb,
        })
      }
    }

    const endGame = () => {
      st.phase = 'over'
      setPhase('over')
      setScore(st.score)
      if (typeof onScoreRef.current === 'function') onScoreRef.current(st.score)
      if (st.score > readBest()) { writeBest(st.score); setBest(st.score) }
    }

    const drop = () => {
      const m = st.mov
      const top = st.layers[st.layers.length - 1]
      if (!m || !top) return
      const left = Math.max(top.x, m.x)
      const right = Math.min(top.x + top.w, m.x + m.w)
      const overlap = right - left
      const y = st.baseY - st.layers.length * st.lh + st.cam

      if (overlap <= 2) {
        // total miss — the whole layer tumbles off and the round ends
        st.debris.push({ x: m.x, y, w: m.w, h: st.lh, vx: (m.x < top.x ? -1 : 1) * 90, vy: -120, rot: 0, vr: (Math.random() - 0.5) * 6, ci: m.ci })
        st.mov = null
        st.shake = st.rm ? 0 : 1
        endGame()
        return
      }

      const dx = m.x - top.x
      const perfect = Math.abs(dx) <= Math.max(3, top.w * 0.022)
      let nx = left
      let nw = overlap

      if (perfect) {
        nx = top.x
        nw = Math.min(Math.min(st.w * 0.62, 260), top.w + 3)
        st.combo += 1
        st.flash = 1
        st.toast.t = 1
        st.toast.txt = 'مثالي'
        st.toast.x = nx + nw / 2
        st.toast.y = y
        st.score += 10 + 15 * Math.min(st.combo, 8)
        burst(nx + nw / 2, y, m.ci, 22)
      } else {
        st.combo = 0
        // the sliced overhang falls away on the side it stuck out
        if (dx > 0) st.debris.push({ x: right, y, w: dx, h: st.lh, vx: 70, vy: -90, rot: 0, vr: 3.4, ci: m.ci })
        else st.debris.push({ x: m.x, y, w: -dx, h: st.lh, vx: -70, vy: -90, rot: 0, vr: -3.4, ci: m.ci })
        st.score += 10
        burst(nx + nw / 2, y, m.ci, 8)
      }

      st.layers.push({ x: nx, w: nw, ci: m.ci, label: m.label })
      st.mov = mkMov(st.layers.length)
      setScore(st.score)
      setCombo(st.combo)
      setTall(st.layers.length)
    }

    const onDown = (e) => {
      if (st.phase !== 'play') return
      e.preventDefault()
      drop()
    }
    cvs.addEventListener('pointerdown', onDown)

    // ---------- drawing ----------
    const drawLayer = (x, y, w, h, ci, label, alpha) => {
      const c = PALETTE[ci % PALETTE.length]
      ctx.globalAlpha = alpha
      // sponge
      ctx.fillStyle = c.sponge
      rr(ctx, x, y, w, h, Math.min(6, h * 0.3))
      ctx.fill()
      // crumb speckles (deterministic so they never shimmer)
      ctx.fillStyle = c.crumb
      for (let k = 1; k <= 3; k++) {
        const px = x + ((k * 53 + ci * 17) % Math.max(1, Math.floor(w)))
        const py = y + h * 0.55 + ((k * 7) % 5)
        ctx.fillRect(px, py, 2, 2)
      }
      // cream band across the top
      const ch = Math.max(4, h * 0.36)
      ctx.fillStyle = c.cream
      rr(ctx, x, y, w, ch, Math.min(5, ch * 0.5))
      ctx.fill()
      // cream drips
      const drips = Math.max(2, Math.min(5, Math.floor(w / 46)))
      for (let k = 0; k < drips; k++) {
        const px = x + (w / (drips + 1)) * (k + 1)
        const dr = 3 + ((k * 13 + ci * 5) % 4)
        ctx.beginPath()
        ctx.arc(px, y + ch - 1, dr, 0, Math.PI)
        ctx.fill()
      }
      // top highlight
      ctx.fillStyle = 'rgba(255,255,255,.35)'
      ctx.fillRect(x + 3, y + 1.5, Math.max(0, w - 6), 1.5)
      // flavour name
      if (w > 96 && h > 18 && label) {
        ctx.fillStyle = 'rgba(0,0,0,.45)'
        ctx.font = `700 ${Math.round(Math.min(13, h * 0.42))}px system-ui, "Segoe UI", Tahoma, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, x + w / 2, y + h * 0.72, w - 14)
      }
      ctx.globalAlpha = 1
    }

    const draw = () => {
      const { w, h } = st
      ctx.save()
      if (st.shake > 0.01) {
        ctx.translate((Math.random() - 0.5) * 9 * st.shake, (Math.random() - 0.5) * 9 * st.shake)
      }
      ctx.fillStyle = st.bg
      ctx.fillRect(-20, -20, w + 40, h + 40)
      ctx.fillStyle = st.glow
      ctx.fillRect(-20, -20, w + 40, h + 40)

      // cake stand
      const standY = st.baseY + st.cam
      if (standY < h + 40) {
        ctx.fillStyle = 'rgba(255,255,255,.14)'
        rr(ctx, w * 0.5 - Math.min(w * 0.42, 190), standY, Math.min(w * 0.84, 380), 9, 5)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,.07)'
        rr(ctx, w * 0.5 - 16, standY + 9, 32, Math.max(0, h - standY - 9), 4)
        ctx.fill()
      }

      // stacked layers (skip everything outside the viewport)
      for (let i = 0; i < st.layers.length; i++) {
        const y = st.baseY - (i + 1) * st.lh + st.cam
        if (y > h + st.lh || y < -st.lh * 2) continue
        const L = st.layers[i]
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,.35)'
        ctx.shadowBlur = 6
        ctx.shadowOffsetY = 2
        drawLayer(L.x, y, L.w, st.lh, L.ci, L.label, 1)
        ctx.restore()
      }

      // the sliding layer
      if (st.mov && st.phase === 'play') {
        const y = st.baseY - (st.layers.length + 1) * st.lh + st.cam
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,.45)'
        ctx.shadowBlur = 14
        ctx.shadowOffsetY = 5
        drawLayer(st.mov.x, y, st.mov.w, st.lh, st.mov.ci, st.mov.label, 1)
        ctx.restore()
        // drop guide rails on the layer below
        const top = st.layers[st.layers.length - 1]
        if (top) {
          const ty = st.baseY - st.layers.length * st.lh + st.cam
          ctx.strokeStyle = 'rgba(255,255,255,.22)'
          ctx.lineWidth = 1
          ctx.setLineDash([4, 5])
          ctx.beginPath()
          ctx.moveTo(top.x + 0.5, y + st.lh)
          ctx.lineTo(top.x + 0.5, ty)
          ctx.moveTo(top.x + top.w - 0.5, y + st.lh)
          ctx.lineTo(top.x + top.w - 0.5, ty)
          ctx.stroke()
          ctx.setLineDash([])
        }
      }

      // sliced-off pieces
      for (let i = 0; i < st.debris.length; i++) {
        const d = st.debris[i]
        ctx.save()
        ctx.translate(d.x + d.w / 2, d.y + d.h / 2)
        ctx.rotate(d.rot)
        drawLayer(-d.w / 2, -d.h / 2, d.w, d.h, d.ci, '', 0.92)
        ctx.restore()
      }

      // crumbs
      for (let i = 0; i < st.sparks.length; i++) {
        const s = st.sparks[i]
        ctx.globalAlpha = Math.max(0, 1 - s.t / s.life)
        ctx.fillStyle = s.col
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // perfect-drop flash + ring
      if (st.flash > 0.01) {
        ctx.globalAlpha = st.flash * (st.rm ? 0.12 : 0.3)
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, w, h)
        ctx.globalAlpha = 1
      }
      if (st.toast.t > 0.01) {
        const p = 1 - st.toast.t
        ctx.globalAlpha = st.toast.t
        ctx.strokeStyle = brandRef.current
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(st.toast.x, st.toast.y - p * 26, 16 + p * 44, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = '#fff'
        ctx.font = '800 18px system-ui, "Segoe UI", Tahoma, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(st.toast.txt, st.toast.x, st.toast.y - 26 - p * 34)
        ctx.globalAlpha = 1
      }
      ctx.restore()
    }

    // ---------- loop ----------
    const frame = (now) => {
      st.raf = requestAnimationFrame(frame)
      const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 0
      st.last = now

      if (st.phase === 'play' && st.mov) {
        const m = st.mov
        m.x += m.dir * m.speed * dt
        const maxX = Math.max(0, st.w - m.w)
        if (m.x <= 0) { m.x = 0; m.dir = 1 } else if (m.x >= maxX) { m.x = maxX; m.dir = -1 }
        st.camTarget = Math.max(0, (st.layers.length + 2) * st.lh - st.h * 0.52)
      }
      st.cam += (st.camTarget - st.cam) * Math.min(1, dt * (st.rm ? 14 : 7))

      for (let i = st.debris.length - 1; i >= 0; i--) {
        const d = st.debris[i]
        d.vy += 1700 * dt
        d.x += d.vx * dt
        d.y += d.vy * dt
        d.rot += d.vr * dt
        if (d.y > st.h + 160) st.debris.splice(i, 1)
      }
      for (let i = st.sparks.length - 1; i >= 0; i--) {
        const s = st.sparks[i]
        s.t += dt
        s.vy += 900 * dt
        s.x += s.vx * dt
        s.y += s.vy * dt
        if (s.t >= s.life) st.sparks.splice(i, 1)
      }
      st.flash = Math.max(0, st.flash - dt * 2.4)
      st.shake = Math.max(0, st.shake - dt * 3.2)
      st.toast.t = Math.max(0, st.toast.t - dt * 1.5)

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
      stRef.current = null
    }
  }, [])

  const rtl = lang !== 'en'
  const restart = () => startRef.current()

  return (
    <div
      ref={rootRef}
      className="gmx-root gmct-root"
      dir={rtl ? 'rtl' : 'ltr'}
      style={{ '--gm-brand': brand }}
    >
      <canvas ref={cvsRef} className="gmx-canvas" />

      {phase === 'play' && (
        <div className="gmx-hud">
          <span className="gmx-pill gmx-pill-score">{fmt(score)}</span>
          <span className="gmx-pill">طبقات {fmt(tall)}</span>
          {combo > 1 && <span className="gmx-pill gmx-pill-hot">تتابع ×{fmt(combo)}</span>}
        </div>
      )}

      {phase === 'ready' && (
        <div className="gmx-veil">
          <div className="gmx-card">
            <div className="gmx-emblem gmct-emblem" aria-hidden="true">
              <span /><span /><span />
            </div>
            <h3 className="gmx-title">برج الكيك</h3>
            <p className="gmx-line">اضغط في أي مكان لإسقاط الطبقة فوق البرج. الجزء الزائد يُقطع، والإسقاط المثالي يمنحك مكافأة تتابع.</p>
            <button type="button" className="gmx-btn" onClick={restart}>ابدأ</button>
            {best > 0 && <p className="gmx-sub">أفضل نتيجة {fmt(best)}</p>}
          </div>
        </div>
      )}

      {phase === 'over' && (
        <div className="gmx-veil">
          <div className="gmx-card">
            <h3 className="gmx-title">انتهت اللعبة</h3>
            <div className="gmx-big">{fmt(score)}</div>
            <p className="gmx-line">
              بنيت {fmt(tall)} طبقة{playerName ? ` — أحسنت يا ${playerName}` : ''}
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
