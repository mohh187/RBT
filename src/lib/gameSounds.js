// «أصوات الألعاب» — one tiny WebAudio synth for every mini-game. Zero assets:
// every cue is an oscillator/noise envelope built on the fly, all under 300ms.
//
// Deliberately SEPARATE from src/lib/sounds.js: that module is the venue's
// notification bell (loud, staff-facing, its own unlock/volume prefs). Game
// feedback is quiet, guest-facing and individually mutable, so sharing a
// context would couple two unrelated volume/mute worlds. Same unlock pattern,
// own context.
//
//   play(name)         — 'dice' | 'move' | 'capture' | 'card' | 'deal' |
//                        'win' | 'lose' | 'turn' | 'click'
//   play(name, {gain}) — optional loudness multiplier (0..1) for soft variants
//   isMuted()/setMuted(v) — persisted in localStorage 'ml.games.mute'
//
// play() NEVER throws and no-ops silently when muted, unsupported, or before
// the browser lets audio start (an unlock listener arms itself on first use).

const MUTE_KEY = 'ml.games.mute'

let ctx = null
let armed = false // gesture-unlock listeners attached
let muted = (() => {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch (_) { return false }
})()

export function isMuted() { return muted }
export function setMuted(v) {
  muted = !!v
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch (_) { /* storage off */ }
}

function resume() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}) }

// Autoplay policy: a context created outside a user gesture starts suspended.
// The games are tap-driven, so the very next tap unlocks it; these one-shot
// listeners cover the case where the first cue comes from a REMOTE player's
// move before the local guest has touched anything this page-load.
function arm() {
  if (armed || typeof window === 'undefined') return
  armed = true
  const kick = () => resume()
  window.addEventListener('pointerdown', kick, { passive: true, capture: true })
  window.addEventListener('keydown', kick, { passive: true, capture: true })
}

function ac() {
  if (!ctx) {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
    if (!AC) return null
    ctx = new AC()
    arm()
  }
  resume()
  return ctx.state === 'running' || ctx.state === 'suspended' ? ctx : null
}

// one enveloped oscillator voice
function tone(c, dest, { f, to = 0, at = 0, dur = 0.12, type = 'sine', v = 0.5 }) {
  const t0 = c.currentTime + at
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(Math.max(1, f), t0)
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t0 + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g)
  g.connect(dest)
  o.start(t0)
  o.stop(t0 + dur + 0.03)
}

// one short filtered-noise tick (dice rattle, card swish, capture snap)
let noiseBuf = null
function noise(c, dest, { at = 0, dur = 0.05, hz = 2400, q = 0.9, v = 0.4 }) {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, Math.ceil(c.sampleRate * 0.12), c.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1
  }
  const t0 = c.currentTime + at
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  const f = c.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = hz
  f.Q.value = q
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t0 + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(f)
  f.connect(g)
  g.connect(dest)
  src.start(t0)
  src.stop(t0 + dur + 0.03)
}

// Every cue is a recipe over the two voices above. Quiet by design (~0.5 peak):
// these live under conversation at a table, not over it.
const CUES = {
  click: (c, d) => tone(c, d, { f: 1150, dur: 0.05, type: 'triangle', v: 0.28 }),
  turn: (c, d) => {
    tone(c, d, { f: 660, dur: 0.09, type: 'triangle', v: 0.34 })
    tone(c, d, { f: 990, at: 0.09, dur: 0.14, type: 'triangle', v: 0.3 })
  },
  move: (c, d) => tone(c, d, { f: 520, to: 390, dur: 0.07, type: 'triangle', v: 0.32 }),
  card: (c, d) => {
    noise(c, d, { dur: 0.06, hz: 3200, v: 0.32 })
    tone(c, d, { f: 740, at: 0.02, dur: 0.05, type: 'sine', v: 0.16 })
  },
  deal: (c, d) => {
    for (let i = 0; i < 3; i += 1) noise(c, d, { at: i * 0.07, dur: 0.05, hz: 2900 - i * 300, v: 0.3 })
  },
  dice: (c, d) => {
    const gaps = [0, 0.055, 0.125, 0.21]
    gaps.forEach((at, i) => {
      noise(c, d, { at, dur: 0.04, hz: 1900 + i * 350, q: 1.4, v: 0.34 })
      tone(c, d, { f: 340 + i * 60, at, dur: 0.035, type: 'square', v: 0.07 })
    })
  },
  capture: (c, d) => {
    tone(c, d, { f: 165, to: 58, dur: 0.14, type: 'sine', v: 0.6 })
    noise(c, d, { at: 0.01, dur: 0.05, hz: 1400, v: 0.3 })
    tone(c, d, { f: 1320, at: 0.09, dur: 0.06, type: 'triangle', v: 0.2 })
  },
  win: (c, d) => {
    [523, 659, 784].forEach((f, i) => {
      tone(c, d, { f, at: i * 0.085, dur: 0.16, type: 'triangle', v: 0.34 })
      tone(c, d, { f: f * 2, at: i * 0.085, dur: 0.09, type: 'sine', v: 0.1 })
    })
  },
  lose: (c, d) => {
    [440, 349, 262].forEach((f, i) => tone(c, d, { f, at: i * 0.09, dur: 0.15, type: 'triangle', v: 0.3 }))
  },
}

export function play(name, { gain = 1 } = {}) {
  try {
    if (muted) return
    const c = ac()
    if (!c || c.state !== 'running') return // not unlocked yet — stay silent
    const cue = CUES[name]
    if (!cue) return
    const master = c.createGain()
    master.gain.value = Math.max(0.05, Math.min(1.5, gain))
    master.connect(c.destination)
    cue(c, master)
  } catch (_) { /* sound is decoration — never let it break a game */ }
}
