// Loud, distinctive notification sounds synthesized with the Web Audio API
// (no audio files to bundle), plus playback of a user-uploaded custom sound.

let ctx = null
let unlocked = false
export function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  return ctx
}

// Returns the context ONLY if a user gesture has unlocked audio — otherwise null.
// This avoids the "AudioContext was not allowed to start" warning when a background
// alert (e.g. a new order) tries to play before the user has interacted.
function liveCtx() {
  if (!unlocked || !ctx) return null
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

// Must be called from a user gesture (button tap) to satisfy autoplay policies.
export async function unlockAudio() {
  try {
    const c = audioCtx()
    unlocked = true
    if (c.state === 'suspended') await c.resume()
    const o = c.createOscillator()
    const g = c.createGain()
    g.gain.value = 0.00001
    o.connect(g)
    g.connect(c.destination)
    o.start()
    o.stop(c.currentTime + 0.03)
    return true
  } catch (_) {
    return false
  }
}

// Schedule one tone on the destination node.
function tone(c, dest, { freq, start = 0, dur = 0.25, type = 'sine', vol = 1, sweepTo }) {
  const t0 = c.currentTime + start
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g)
  g.connect(dest)
  o.start(t0)
  o.stop(t0 + dur + 0.03)
}

// Distinctive presets — richer (layered harmonics) and much louder. `len` ~ seconds.
export const SOUNDS = [
  {
    id: 'ding', name: { ar: 'دينغ', en: 'Ding' }, len: 0.7,
    build: (c, d) => {
      tone(c, d, { freq: 1175, dur: 0.5, type: 'triangle', vol: 1.4 })
      tone(c, d, { freq: 1568, start: 0.13, dur: 0.55, type: 'triangle', vol: 1.3 })
      tone(c, d, { freq: 2349, start: 0.13, dur: 0.3, type: 'sine', vol: 0.55 })
    },
  },
  {
    id: 'chime', name: { ar: 'كورال', en: 'Chime' }, len: 0.95,
    build: (c, d) => {
      [1319, 1047, 1568].forEach((f, i) => {
        tone(c, d, { freq: f, start: i * 0.16, dur: 0.6, type: 'triangle', vol: 1.3 })
        tone(c, d, { freq: f * 2, start: i * 0.16, dur: 0.25, type: 'sine', vol: 0.4 })
      })
    },
  },
  {
    id: 'bell', name: { ar: 'جرس رنّان', en: 'Bell' }, len: 1.1,
    build: (c, d) => {
      tone(c, d, { freq: 1568, dur: 1.0, type: 'triangle', vol: 1.4 })
      tone(c, d, { freq: 2349, dur: 0.6, type: 'sine', vol: 0.7 })
      tone(c, d, { freq: 3136, dur: 0.35, type: 'sine', vol: 0.35 })
    },
  },
  {
    id: 'cash', name: { ar: 'كاشير', en: 'Cash register' }, len: 0.8,
    build: (c, d) => {
      tone(c, d, { freq: 1760, dur: 0.12, type: 'square', vol: 1.15 })
      tone(c, d, { freq: 2637, start: 0.1, dur: 0.5, type: 'triangle', vol: 1.4 })
      tone(c, d, { freq: 3520, start: 0.1, dur: 0.3, type: 'sine', vol: 0.55 })
    },
  },
  {
    id: 'marimba', name: { ar: 'خشبي', en: 'Marimba' }, len: 0.8,
    build: (c, d) => { [784, 1047, 1319].forEach((f, i) => tone(c, d, { freq: f, start: i * 0.12, dur: 0.42, type: 'sine', vol: 1.4 })) },
  },
  {
    id: 'alarm', name: { ar: 'إنذار قوي', en: 'Alarm' }, len: 1.1,
    build: (c, d) => { for (let i = 0; i < 5; i++) { tone(c, d, { freq: 1175, start: i * 0.17, dur: 0.11, type: 'square', vol: 1.4 }); tone(c, d, { freq: 1568, start: i * 0.17, dur: 0.11, type: 'square', vol: 0.7 }) } },
  },
  {
    id: 'arcade', name: { ar: 'أركيد', en: 'Arcade' }, len: 0.7,
    build: (c, d) => { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(c, d, { freq: f, start: i * 0.07, dur: 0.13, type: 'square', vol: 1.2 })) },
  },
  {
    id: 'urgent', name: { ar: 'عاجل', en: 'Urgent' }, len: 0.8,
    build: (c, d) => { for (let i = 0; i < 4; i++) { tone(c, d, { freq: 1568, start: i * 0.12, dur: 0.09, type: 'square', vol: 1.45 }); tone(c, d, { freq: 2093, start: i * 0.12, dur: 0.09, type: 'square', vol: 0.6 }) } },
  },
  {
    id: 'siren', name: { ar: 'صفّارة', en: 'Siren' }, len: 1.1,
    build: (c, d) => { tone(c, d, { freq: 700, dur: 0.5, type: 'sawtooth', sweepTo: 1400, vol: 1.2 }); tone(c, d, { freq: 1400, start: 0.5, dur: 0.5, type: 'sawtooth', sweepTo: 700, vol: 1.2 }) },
  },
]

function makeMaster(c, volume) {
  const master = c.createGain()
  master.gain.value = Math.max(0.1, Math.min(4, volume * 1.7))
  // Brick-wall limiter avoids harsh clipping at high gain...
  const comp = c.createDynamicsCompressor()
  comp.threshold.value = -8
  comp.knee.value = 4
  comp.ratio.value = 16
  comp.attack.value = 0.002
  comp.release.value = 0.2
  // ...then a makeup gain after limiting for a much louder perceived volume.
  const makeup = c.createGain()
  makeup.gain.value = 1.8
  master.connect(comp)
  comp.connect(makeup)
  makeup.connect(c.destination)
  return master
}

export async function playPreset(id, { volume = 1, loops = 1 } = {}) {
  const c = liveCtx()
  if (!c) return
  const def = SOUNDS.find((s) => s.id === id) || SOUNDS[0]
  const master = makeMaster(c, volume)
  const gap = (def.len + 0.25) * 1000
  for (let i = 0; i < loops; i++) {
    setTimeout(() => {
      try { def.build(c, master) } catch (_) { /* ignore */ }
    }, i * gap)
  }
}

let customBuf = null
let customKey = ''
export async function playCustom(dataUrl, { volume = 1, loops = 1 } = {}) {
  const c = liveCtx()
  if (!c) return
  if (customKey !== dataUrl || !customBuf) {
    const resp = await fetch(dataUrl)
    const arr = await resp.arrayBuffer()
    customBuf = await c.decodeAudioData(arr)
    customKey = dataUrl
  }
  const master = makeMaster(c, volume)
  for (let i = 0; i < loops; i++) {
    const src = c.createBufferSource()
    src.buffer = customBuf
    src.connect(master)
    src.start(c.currentTime + i * (customBuf.duration + 0.15))
  }
}

export function playFromPrefs(p) {
  const loops = p.loop ? 3 : 1
  if (p.soundId === 'custom' && p.customSoundUrl) return playCustom(p.customSoundUrl, { volume: p.volume, loops })
  return playPreset(p.soundId, { volume: p.volume, loops })
}
