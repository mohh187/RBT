// The ONE playback engine for video trim windows (tenant.*VideoTrim /
// item.bgVideoTrim / story.trim …). The UI half is VideoTrimRange.jsx; the
// bounds and the {start,end} normalization live in dishComposition.js
// (VIDEO_TRIM_RANGE / normalizeVideoTrim / trimWindow) — this file adds only
// the event wiring.
//
// Semantics:
//  • without onEnd the window LOOPS (ambient backgrounds, banners, backdrops);
//  • with onEnd it fires ONCE per pass instead of looping (stories advance).
// It never touches muted/autoplay/loop attributes, so iOS muted-autoplay is
// preserved and untouched call sites keep the native loop as their fallback:
// a null/absent trim attaches nothing and playback is byte-identical.

import { useCallback, useRef } from 'react'
import { normalizeVideoTrim, trimWindow } from './dishComposition.js'

/**
 * Wire a <video> element to a trim window. Returns a detach function.
 * `opts` is either the onEnd function itself or an { onEnd } options object.
 */
export function attachTrim(el, rawTrim, opts) {
  const trim = normalizeVideoTrim(rawTrim)
  if (!el || !trim) return () => {}
  const onEnd = typeof opts === 'function' ? opts : (opts && typeof opts.onEnd === 'function' ? opts.onEnd : null)

  let win = trimWindow(trim, el.duration)
  // one advance per pass — timeupdate near the end PLUS the ended event would
  // otherwise double-fire and skip a story
  let fired = false

  const seekStart = () => {
    try { el.currentTime = win.start } catch (_) { /* not seekable yet */ }
  }
  const onMeta = () => {
    win = trimWindow(trim, el.duration)
    fired = false
    if (el.currentTime < win.start) seekStart()
  }
  const wrap = () => {
    if (onEnd) {
      if (!fired) { fired = true; onEnd() }
      return
    }
    seekStart()
    if (el.paused) {
      const p = el.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
  }
  const onTime = () => {
    if (win.end !== Infinity && el.currentTime >= win.end - 0.08) wrap()
    // the native loop attribute suppresses `ended` and wraps to 0; with
    // start > 0 that lands BEFORE the window, so seek forward again
    else if (win.start > 0 && el.currentTime < win.start - 0.25) seekStart()
  }
  const onEnded = () => wrap()

  el.addEventListener('loadedmetadata', onMeta)
  el.addEventListener('timeupdate', onTime)
  el.addEventListener('ended', onEnded)
  if (el.readyState >= 1) onMeta()

  return () => {
    el.removeEventListener('loadedmetadata', onMeta)
    el.removeEventListener('timeupdate', onTime)
    el.removeEventListener('ended', onEnded)
  }
}

/**
 * Ref-callback hook: `<video ref={useVideoTrim(trim)} …/>` — attaches on
 * mount, cleans on unmount/element swap. Its identity depends ONLY on the two
 * window scalars, so unrelated renders never re-attach; a null trim is a
 * complete no-op. Second argument: optional onEnd (stories advance).
 */
export function useVideoTrim(trim, onEnd) {
  const endRef = useRef(onEnd)
  endRef.current = onEnd
  const cleanRef = useRef(null)
  const start = trim && trim.start != null ? Number(trim.start) : 0
  const end = trim && trim.end != null ? Number(trim.end) : 0
  return useCallback((el) => {
    if (cleanRef.current) { cleanRef.current(); cleanRef.current = null }
    if (!el || (!start && !end)) return
    cleanRef.current = attachTrim(
      el,
      { start, end },
      endRef.current ? () => { if (endRef.current) endRef.current() } : null,
    )
  }, [start, end])
}
