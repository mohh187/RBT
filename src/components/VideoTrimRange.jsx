import { useEffect, useState } from 'react'
import { VIDEO_TRIM_RANGE, normalizeVideoTrim } from '../lib/dishComposition.js'

// The ONE trim control (UI half of useVideoTrim.js): a compact dual-thumb
// window over the clip's duration, reused by every admin card that uploads a
// video. Duration is probed with a detached metadata-only <video>; while the
// duration is unknown or non-finite (some recorded webm blobs report
// Infinity) the control hides itself entirely — no broken slider.
//
// The strip is dir="ltr" BY DESIGN: a video timeline flows left-to-right even
// in an Arabic UI, which also sidesteps the RTL translate/inset trap outright.
// onChange(null) when the window covers the whole clip, so «no trim» is
// stored as absence (opt-in, default OFF). Latin digits via toFixed.

const fmt = (s) => {
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return m ? `${m}:${r.toFixed(1).padStart(4, '0')}` : `${r.toFixed(1)}s`
}
const r1 = (v) => Math.round(v * 10) / 10

// value: {start,end}|null. onChange(next|null); null = play the whole clip.
export default function VideoTrimRange({ url, value, onChange, ar = true }) {
  const [dur, setDur] = useState(0)
  useEffect(() => {
    if (!url) { setDur(0); return undefined }
    setDur(0)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    const done = () => setDur(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0)
    v.addEventListener('loadedmetadata', done)
    v.src = url
    return () => {
      v.removeEventListener('loadedmetadata', done)
      v.removeAttribute('src')
      try { v.load() } catch (_) { /* detached probe */ }
    }
  }, [url])

  if (!url || !dur) return null

  const t = normalizeVideoTrim(value)
  const start = t ? Math.min(t.start, dur) : 0
  const end = t && t.end ? Math.min(t.end, dur) : dur
  const span = VIDEO_TRIM_RANGE.span
  const commit = (s, e) => {
    s = Math.max(0, Math.min(s, dur - span))
    e = Math.max(s + span, Math.min(e, dur))
    const full = s < 0.1 && e > dur - 0.1
    onChange(full ? null : { start: r1(s), end: e > dur - 0.1 ? 0 : r1(e) })
  }

  return (
    <div className="field vtrim" dir="ltr">
      <label className="xs" dir="auto">
        {ar ? 'مقطع التشغيل' : 'Playback window'}{' '}
        <span className="num">{fmt(start)} – {fmt(end)} / {fmt(dur)}</span>
      </label>
      <div className="vtrim-track">
        <span
          className="vtrim-fill"
          style={{ left: `${(start / dur) * 100}%`, width: `${((end - start) / dur) * 100}%` }}
          aria-hidden="true"
        />
        <input
          type="range"
          min="0"
          max={dur}
          step={VIDEO_TRIM_RANGE.start.step}
          value={start}
          aria-label={ar ? 'ثانية البداية' : 'Start second'}
          onChange={(e) => commit(Number(e.target.value), end)}
        />
        <input
          type="range"
          min="0"
          max={dur}
          step={VIDEO_TRIM_RANGE.end.step}
          value={end}
          aria-label={ar ? 'ثانية النهاية' : 'End second'}
          onChange={(e) => commit(start, Number(e.target.value))}
        />
      </div>
      {t && (
        <button type="button" className="btn-link xs" onClick={() => onChange(null)}>
          {ar ? 'إلغاء القص — المقطع كاملاً' : 'Clear — play the whole clip'}
        </button>
      )}
    </div>
  )
}
