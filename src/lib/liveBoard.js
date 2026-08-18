// Shared, refcounted live-board subscriptions. Before this, the active-orders
// query ran once in AdminLayout (badges), once in the cashier board, once in
// the KDS, and once more in the accept modal — four identical onSnapshot
// streams billing four reads per change on the busiest collection in the
// system. One stream per tenant per query now feeds every consumer.
import { useEffect, useState } from 'react'
import { watchActiveOrders, watchOpenWaiterCalls } from './db.js'

function makeShared(watch, initial) {
  const entries = new Map() // tid -> { refs, value, subs, unsub }
  // Last KNOWN data per tenant, kept past teardown. Every shell↔shell
  // navigation destroys and rebuilds the entry (outgoing cleanups run before
  // incoming effects), and the rebuilt listener starts with no data — if its
  // first attempt errored, consumers received a FALSE "loaded, zero tickets"
  // instead of the tickets that were on screen a second ago. New subscribers
  // now seed from this cache instantly, and the live stream overwrites it.
  const lastKnown = new Map()
  return function useShared(tid) {
    const [value, setValue] = useState(() => {
      const e = entries.get(tid)
      if (e && e.value !== undefined) return e.value
      if (lastKnown.has(tid)) return lastKnown.get(tid)
      return initial
    })
    useEffect(() => {
      if (!tid) { setValue(initial); return undefined }
      let e = entries.get(tid)
      if (!e) {
        e = { refs: 0, value: undefined, subs: new Set(), unsub: null }
        entries.set(tid, e)
        e.unsub = watch(tid, (v) => {
          // db.js marks its error-path emission (fromError) — that "empty" is
          // a placeholder, not truth, so it must not clobber the cached board;
          // a REAL empty snapshot (all orders done) always wins.
          if (v && v.fromError && (lastKnown.get(tid) || []).length) {
            e.value = lastKnown.get(tid)
          } else {
            e.value = v
            lastKnown.set(tid, v)
          }
          e.subs.forEach((fn) => fn(e.value))
        })
      }
      e.refs += 1
      e.subs.add(setValue)
      if (e.value !== undefined) setValue(e.value)
      else if (lastKnown.has(tid)) setValue(lastKnown.get(tid))
      return () => {
        e.refs -= 1
        e.subs.delete(setValue)
        if (e.refs <= 0) { try { e.unsub?.() } catch { /* already dead */ } entries.delete(tid) }
      }
    }, [tid])
    return value
  }
}

// null while the first snapshot is in flight — boards use that as "loading".
export const useActiveOrders = makeShared(watchActiveOrders, null)
// calls default to an empty floor, matching every existing consumer.
export const useOpenWaiterCalls = makeShared(watchOpenWaiterCalls, [])
