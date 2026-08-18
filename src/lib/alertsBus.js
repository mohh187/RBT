// Tiny signal between the POS overlay and the incoming-alerts modal: while a
// cashier is composing an order, a new alert must arrive as the minimized pill,
// never as a full-screen modal over a half-built cart.
let posBusy = false
const subs = new Set()

export function setPosBusy(v) {
  posBusy = !!v
  subs.forEach((fn) => fn(posBusy))
}
export function isPosBusy() { return posBusy }
export function onPosBusy(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}
