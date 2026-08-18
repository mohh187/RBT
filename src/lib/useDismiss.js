import { useEffect, useRef } from 'react'

// ESCAPE + THE BACK BUTTON, for full-screen overlays that are opened by state.
//
// Escape alone is already spelled inline in a dozen components and that is
// fine — a one-line key handler does not need a hook. What needs one is the
// BACK BUTTON, which nothing in this repo handled: `grep popstate` over `src/`
// returned zero. Opening an overlay with `setOpen(true)` is a state change, not
// a navigation, so the phone's back gesture skipped past the overlay and left
// the page underneath it entirely — the guest tapped Back expecting to close a
// game and lost their order-tracking screen instead.
//
// The contract: while `open`, one history entry belongs to this overlay.
//   • Back        -> popstate fires, we call onClose, and the entry is already
//                    gone (the browser consumed it). We must NOT pop again.
//   • X / Escape  -> onClose runs, `open` goes false, cleanup runs. The entry
//                    is still on the stack, so we take it back off — otherwise
//                    the guest's next Back press would be swallowed doing
//                    nothing visible.
//
// The guard before that pop matters: cleanup also runs when the component
// unmounts because the user navigated somewhere else. Popping then would undo
// THEIR navigation. So we only pop when our own entry is still the current one.
//
// WHY THE MODULE-LEVEL STACK: overlays nest. In the games hub, GamesCenter is
// open and a game is mounted inside it, so two hooks are live at once. Every
// instance listens on `window`, but one Back press consumes only ONE history
// entry — so if both instances acted on it, a single press would close the game
// AND the hub together. The stack makes the innermost overlay the only one that
// answers: Back closes the game and returns to the game list, and a second Back
// closes the hub. That is the nesting the guest expects.
const open_ = []

// THE ECHO PROBLEM.
//
// Cleanup takes our history entry back off with history.back(), and the browser
// answers that with a `popstate` — the SAME event a real Back press produces,
// arriving asynchronously, after cleanup has finished. Nothing in the event says
// who asked for it.
//
// That was survivable while `byPop` lived inside the effect, because the only
// listener that could hear the echo had already been removed. It stopped being
// survivable the moment a SECOND instance existed by the time the echo landed —
// which is exactly what React.StrictMode does in development (setup → cleanup →
// setup) and what any fast close-then-reopen does in production. The new
// instance heard the previous instance's echo, read it as a user pressing Back,
// and closed itself in the same frame. Visibly: the games hub opened and
// vanished, so tapping «الألعاب والتحديات» appeared to do nothing at all.
//
// The flag therefore has to outlive the instance that set it, so it lives at
// module scope beside the stack. It is consumed by the first popstate that sees
// it, and cleared on a timer as well: if the browser never delivers the echo
// (no entry left to pop), a stuck flag would swallow the user's next real Back.
let selfPop = false
let selfPopTimer = 0
function markSelfPop() {
  selfPop = true
  clearTimeout(selfPopTimer)
  selfPopTimer = setTimeout(() => { selfPop = false }, 500)
}

export function useDismiss(open, onClose) {
  // Read the latest onClose without re-running the effect (and thus without
  // pushing a second history entry) every time the parent re-renders.
  const cb = useRef(onClose)
  cb.current = onClose

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined

    const me = {}
    let byPop = false
    const top = () => open_[open_.length - 1] === me

    const onKey = (e) => {
      if (e.key !== 'Escape' || !top()) return
      e.stopPropagation()
      cb.current?.()
    }
    const onPop = () => {
      // Our own history.back() echoing back. Swallow it once — acting on it
      // would close an overlay the user never asked to close.
      if (selfPop) { selfPop = false; return }
      if (!top()) return
      byPop = true
      cb.current?.()
    }

    open_.push(me)
    // SPREAD, don't replace. react-router keeps its own bookkeeping in
    // history.state — `{ usr, key, idx }` — and getIndex() reads state.idx
    // (@remix-run/router router.cjs.js:449). Overwriting the object with a bare
    // `{ dismiss: true }` left idx undefined, so the router's pop-delta maths
    // went NaN and it desynced from the actual history stack. Preserving the
    // existing state costs one spread and keeps navigation coherent.
    window.history.pushState({ ...(window.history.state || {}), dismiss: true }, '')
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
      const at = open_.indexOf(me)
      if (at >= 0) open_.splice(at, 1)
      if (byPop) return
      if (window.history.state?.dismiss) {
        markSelfPop()
        window.history.back()
      }
    }
  }, [open])
}

export default useDismiss
