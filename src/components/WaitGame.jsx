// «صياد البحر» — the order-waiting mini-game: a boat glides over animated
// waves, tap to drop the hook, catch fish for points (bigger fish = more),
// jellyfish sting -5. A 45-second round with a per-venue best score. Pure
// canvas (fish drawn with paths — no emoji assets, Latin digits) and pure
// requestAnimationFrame; devicePixelRatio-aware; tap/click to play.
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

const ROUND_S = 45
const FISH_COLORS = ['#ff8c42', '#4cc3ff', '#ffd166', '#8ecf6b', '#e06fae']

function bestKey(tid) { return `rbt_fishbest_${tid || 'x'}` }
export function getBestScore(tid) {
  try { return Number(localStorage.getItem(bestKey(tid))) || 0 } catch (_) { return 0 }
}

// `onScore` lets a host (the games centre shell) mirror the live score in its
// own chrome; the standalone order-page usage simply omits it.
export default function WaitGame({ open, onClose, tenantId, brand = '#0e7490', onLeaderboard, onScore }) {
  const canvasRef = useRef(null)
  const stateRef = useRef(null)
  const [phase, setPhase] = useState('ready') // ready | play | over
  const [score, setScore] = useState(0)
  const [timeLeft, setTimeLeft] = useState(ROUND_S)
  const [best, setBest] = useState(() => getBestScore(tenantId))
  // frame() reads the phase via a ref so the rAF loop never re-subscribes
  const phaseRef = useRef(phase)
  useEffect(() => { phaseRef.current = phase }, [phase])
  // Mirror the live score outward (ref-held so the game loop stays stable).
  const onScoreRef = useRef(onScore)
  useEffect(() => { onScoreRef.current = onScore }, [onScore])
  useEffect(() => { onScoreRef.current?.(score) }, [score])

  // (re)start a round
  const start = () => {
    const st = stateRef.current
    if (!st) return
    st.fish = []
    st.jelly = []
    st.hook = null
    st.score = 0
    st.t0 = performance.now()
    st.lastSpawn = 0
    setScore(0)
    setTimeLeft(ROUND_S)
    setPhase('play')
  }

  useEffect(() => {
    if (!open) return undefined
    const cvs = canvasRef.current
    if (!cvs) return undefined
    const ctx = cvs.getContext('2d')
    const st = { fish: [], jelly: [], hook: null, boatX: 0.5, boatDir: 1, score: 0, t0: 0, lastSpawn: 0, raf: 0, w: 0, h: 0 }
    stateRef.current = st

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      st.w = cvs.clientWidth
      st.h = cvs.clientHeight
      cvs.width = Math.round(st.w * dpr)
      cvs.height = Math.round(st.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const seaTop = () => st.h * 0.22

    const spawn = (now) => {
      if (now - st.lastSpawn < 700) return
      st.lastSpawn = now
      const big = Math.random() < 0.22
      const fromLeft = Math.random() < 0.5
      const y = seaTop() + 40 + Math.random() * (st.h - seaTop() - 90)
      if (Math.random() < 0.16 && st.jelly.length < 3) {
        st.jelly.push({ x: Math.random() * st.w, y: st.h + 20, vy: -(0.35 + Math.random() * 0.3), wob: Math.random() * 6 })
      } else if (st.fish.length < 9) {
        st.fish.push({
          x: fromLeft ? -40 : st.w + 40,
          y,
          vx: (fromLeft ? 1 : -1) * (0.9 + Math.random() * 1.4) * (big ? 0.7 : 1),
          size: big ? 26 : 13 + Math.random() * 8,
          color: FISH_COLORS[Math.floor(Math.random() * FISH_COLORS.length)],
          pts: big ? 10 : 3,
        })
      }
    }

    const drawFish = (f) => {
      ctx.save()
      ctx.translate(f.x, f.y)
      if (f.vx < 0) ctx.scale(-1, 1)
      ctx.fillStyle = f.color
      ctx.beginPath()
      ctx.ellipse(0, 0, f.size, f.size * 0.55, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath() // tail
      ctx.moveTo(-f.size, 0)
      ctx.lineTo(-f.size - f.size * 0.7, -f.size * 0.5)
      ctx.lineTo(-f.size - f.size * 0.7, f.size * 0.5)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#0d1b2a' // eye
      ctx.beginPath()
      ctx.arc(f.size * 0.45, -f.size * 0.12, Math.max(1.6, f.size * 0.09), 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    const drawJelly = (j, now) => {
      ctx.save()
      ctx.translate(j.x + Math.sin(now / 400 + j.wob) * 10, j.y)
      ctx.fillStyle = 'rgba(214, 130, 255, 0.85)'
      ctx.beginPath()
      ctx.arc(0, 0, 14, Math.PI, 0)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = 'rgba(214, 130, 255, 0.7)'
      ctx.lineWidth = 2
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath()
        ctx.moveTo(i * 7, 0)
        ctx.quadraticCurveTo(i * 7 + 3, 9, i * 7, 17)
        ctx.stroke()
      }
      ctx.restore()
    }

    const frame = (now) => {
      st.raf = requestAnimationFrame(frame)
      const playing = stateRef.current && phaseRef.current === 'play'
      // sky + sea
      ctx.clearRect(0, 0, st.w, st.h)
      const sky = ctx.createLinearGradient(0, 0, 0, seaTop())
      sky.addColorStop(0, '#bfe7ff'); sky.addColorStop(1, '#e8f7ff')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, st.w, seaTop())
      const sea = ctx.createLinearGradient(0, seaTop(), 0, st.h)
      sea.addColorStop(0, '#2aa5d8'); sea.addColorStop(1, '#083b66')
      ctx.fillStyle = sea
      ctx.fillRect(0, seaTop(), st.w, st.h - seaTop())
      // waves
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let x = 0; x <= st.w; x += 6) {
        const y = seaTop() + Math.sin((x + now / 6) / 26) * 4
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()

      // boat drifts side to side
      if (playing) {
        st.boatX += st.boatDir * 0.0022
        if (st.boatX > 0.86) st.boatDir = -1
        if (st.boatX < 0.14) st.boatDir = 1
      }
      const bx = st.boatX * st.w
      const by = seaTop() - 6
      ctx.save()
      ctx.translate(bx, by + Math.sin(now / 300) * 2)
      ctx.fillStyle = '#8a4b2d'
      ctx.beginPath()
      ctx.moveTo(-34, 0); ctx.lineTo(34, 0); ctx.lineTo(22, 14); ctx.lineTo(-22, 14)
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#f4f2ee'
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(0, -2); ctx.lineTo(22, -2); ctx.closePath(); ctx.fill()
      ctx.restore()

      if (playing) {
        spawn(now)
        // fish + jellies advance
        st.fish.forEach((f) => { f.x += f.vx * (st.w / 420) })
        st.fish = st.fish.filter((f) => f.x > -70 && f.x < st.w + 70)
        st.jelly.forEach((j) => { j.y += j.vy * (st.h / 400) })
        st.jelly = st.jelly.filter((j) => j.y > seaTop() - 10)
        // hook physics: descend, then reel back up with any catch
        if (st.hook) {
          const hk = st.hook
          if (hk.mode === 'down') {
            hk.y += 4.4
            for (const f of st.fish) {
              if (!hk.caught && Math.abs(f.x - hk.x) < f.size + 8 && Math.abs(f.y - hk.y) < f.size * 0.7 + 8) {
                hk.caught = f
                st.fish = st.fish.filter((x) => x !== f)
                hk.mode = 'up'
                break
              }
            }
            for (const j of st.jelly) {
              if (Math.abs(j.x - hk.x) < 20 && Math.abs(j.y - hk.y) < 20) {
                st.score = Math.max(0, st.score - 5)
                setScore(st.score)
                hk.mode = 'up'
                hk.stung = true
                break
              }
            }
            if (hk.y > st.h - 8) hk.mode = 'up'
          } else {
            hk.y -= 6
            if (hk.caught) { hk.caught.x = hk.x; hk.caught.y = hk.y + hk.caught.size * 0.6 }
            if (hk.y <= by + 16) {
              if (hk.caught) { st.score += hk.caught.pts; setScore(st.score) }
              st.hook = null
            }
          }
        }
        // countdown
        const left = Math.max(0, ROUND_S - (now - st.t0) / 1000)
        setTimeLeft(Math.ceil(left))
        if (left <= 0) {
          setPhase('over')
          setBest((b) => {
            const nb = Math.max(b, st.score)
            try { localStorage.setItem(bestKey(tenantId), String(nb)) } catch (_) { /* storage off */ }
            return nb
          })
        }
      }

      // draw actors (also on ready/over screens for life)
      st.fish.forEach(drawFish)
      st.jelly.forEach((j) => drawJelly(j, now))
      if (st.hook) {
        ctx.strokeStyle = '#e8e6e1'
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.moveTo(st.hook.x, by + 10); ctx.lineTo(st.hook.x, st.hook.y); ctx.stroke()
        ctx.strokeStyle = st.hook.stung ? '#d666ff' : '#ffd166'
        ctx.lineWidth = 3
        ctx.beginPath(); ctx.arc(st.hook.x, st.hook.y + 5, 6, -0.4, Math.PI * 1.1); ctx.stroke()
        if (st.hook.caught) drawFish(st.hook.caught)
      }
    }

    st.raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(st.raf)
      window.removeEventListener('resize', resize)
      stateRef.current = null
    }
  }, [open, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  const cast = () => {
    const st = stateRef.current
    if (!st || phaseRef.current !== 'play' || st.hook) return
    st.hook = { x: st.boatX * st.w, y: st.h * 0.22 + 12, mode: 'down', caught: null, stung: false }
  }

  if (!open) return null
  return (
    <div className="wg-overlay" role="dialog" aria-modal="true" aria-label="صياد البحر">
      <div className="wg-top">
        <button type="button" className="icon-btn wg-x" onClick={onClose} aria-label="إغلاق"><Icon name="close" size={20} /></button>
        <span className="wg-score">{score}</span>
        <span className="wg-time" style={{ color: timeLeft <= 10 ? '#ff8080' : undefined }}>{timeLeft} ث</span>
      </div>
      <canvas ref={canvasRef} className="wg-canvas" onPointerDown={cast} />
      {phase !== 'play' && (
        <div className="wg-card">
          <strong className="wg-title">صياد البحر</strong>
          {phase === 'over' ? (
            <>
              <p className="wg-line">نتيجتك: <b>{score}</b> نقطة</p>
              <p className="wg-line faint">أفضل نتيجة على هذا الجهاز: {best}</p>
            </>
          ) : (
            <p className="wg-line">القارب يتحرك وحده — المس الشاشة لإنزال الصنارة واصطد أكبر عدد من الأسماك في {ROUND_S} ثانية. السمكة الكبيرة 10 نقاط، وقنديل البحر يقرصك -5!</p>
          )}
          <button type="button" className="btn btn-primary wg-btn" style={{ background: brand }} onClick={start}>
            <Icon name="play" size={16} /> {phase === 'over' ? 'جولة جديدة' : 'ابدأ الصيد'}
          </button>
          {onLeaderboard && phase === 'over' && (
            <button type="button" className="btn btn-outline wg-btn" onClick={() => onLeaderboard(score)}>
              <Icon name="award" size={16} /> لوحة صدارة الشهر
            </button>
          )}
        </div>
      )}
    </div>
  )
}
