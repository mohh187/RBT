// Per-device notification preferences (localStorage). Each device (cashier tablet,
// admin phone, diner phone) keeps its own sound/volume choice.
const KEY = 'ml.notify'

const DEFAULTS = {
  enabled: false,
  soundId: 'ding',
  volume: 1.6,
  loop: false,
  customSoundUrl: '',
}

export function getPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch (_) {
    return { ...DEFAULTS }
  }
}

export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch (_) {
    /* ignore (quota / private mode) */
  }
  return next
}
