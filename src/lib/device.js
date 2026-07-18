// A stable, anonymous per-device key kept in localStorage. Saved cards are scoped
// to this key (never to a phone), so knowing someone's phone can't charge their
// card — only the physical device that saved it can list/use it.
export function deviceKey() {
  try {
    let k = localStorage.getItem('rbt_device')
    if (!k) {
      k = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `d${Date.now()}${Math.random().toString(36).slice(2)}`
      localStorage.setItem('rbt_device', k)
    }
    return k
  } catch (_) { return '' }
}
