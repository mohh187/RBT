import { useEffect, useMemo, useRef, useState } from 'react'
import { watchStories, activeStories, bumpStory, addStoryReply } from '../lib/db.js'
import { normalizeVideoTrim } from '../lib/dishComposition.js'
import { useVideoTrim } from '../lib/useVideoTrim.js'
import { useScrollLock } from '../lib/scrollLock.js'
import Icon from './Icon.jsx'

// Instagram-style stories on the diner menu: a circle strip under the hero,
// and a full-screen viewer (auto-advance, RTL taps, like once per device).
// Renders nothing when there are no active stories — always safe to mount.

const seenKey = (id) => `ml.story.v.${id}`
const likeKey = (id) => `ml.story.l.${id}`
const deviceId = () => {
  let v = localStorage.getItem('ml.did')
  if (!v) { v = Math.random().toString(36).slice(2, 12); localStorage.setItem('ml.did', v) }
  return v
}

export default function Stories({ tenantId, lang = 'ar' }) {
  const ar = lang === 'ar'
  const [list, setList] = useState([])
  const [openAt, setOpenAt] = useState(-1)

  useEffect(() => {
    if (!tenantId) return
    return watchStories(tenantId, setList)
  }, [tenantId])

  const stories = useMemo(() => activeStories(list), [list])
  if (!stories.length) return null

  return (
    <>
      <div className="stories-bar container">
        {stories.map((s, i) => (
          <button key={s.id} type="button" className={`story-dot ${localStorage.getItem(seenKey(s.id)) ? 'seen' : ''}`} onClick={() => setOpenAt(i)}>
            <span className="story-ring"><img src={s.thumb || s.url} alt="" loading="lazy" /></span>
            {(s.title || s.caption) ? <span className="xs story-cap">{s.title || s.caption}</span> : <span className="xs story-cap faint">{ar ? 'استوري' : 'Story'}</span>}
          </button>
        ))}
      </div>
      {openAt >= 0 && (
        <StoryViewer stories={stories} start={openAt} tenantId={tenantId} ar={ar} onClose={() => setOpenAt(-1)} />
      )}
    </>
  )
}

function StoryViewer({ stories, start, tenantId, ar, onClose }) {
  const [idx, setIdx] = useState(start)
  const [paused, setPaused] = useState(false)
  useScrollLock(true) // full-screen story: lock the menu behind it like every other diner overlay
  const [liked, setLiked] = useState(false)
  const [reply, setReply] = useState('')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const timer = useRef(null)
  const startX = useRef(null)
  const audioRef = useRef(null)
  const s = stories[idx]
  const DUR = 5000

  // soundtrack: play from the story's chosen offset; stop on story change/close
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    if (s?.audioUrl) {
      a.src = s.audioUrl
      a.currentTime = Number(s.audioStart) || 0
      a.play().catch(() => {})
    } else { a.pause(); a.removeAttribute('src') }
    return () => a.pause()
  }, [s?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // hold-to-pause also pauses the soundtrack
  useEffect(() => {
    const a = audioRef.current
    if (!a || !s?.audioUrl) return
    if (paused) a.pause()
    else a.play().catch(() => {})
  }, [paused]) // eslint-disable-line react-hooks/exhaustive-deps

  // count a view once per device per story + reset like state
  useEffect(() => {
    if (!s) return
    setLiked(!!localStorage.getItem(likeKey(s.id)))
    if (!localStorage.getItem(seenKey(s.id))) {
      localStorage.setItem(seenKey(s.id), '1')
      bumpStory(tenantId, s.id, 'views').catch(() => {})
    }
  }, [s?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const next = () => setIdx((i) => (i + 1 < stories.length ? i + 1 : (onClose(), i)))
  const prev = () => setIdx((i) => Math.max(0, i - 1))

  // Video trim window (story.trim): at the trim end the reel ADVANCES instead
  // of looping. The hook's onEnd carries a fired-once guard; the native
  // onEnded prop is kept ONLY for untrimmed stories, or the two together
  // would double-advance and skip a story. Hook before the early return.
  const sTrim = s && s.kind === 'video' ? normalizeVideoTrim(s.trim) : null
  const storyTrimRef = useVideoTrim(sTrim, next)

  // auto-advance (images only; videos advance on end)
  useEffect(() => {
    if (!s || paused || s.kind === 'video') return
    timer.current = setTimeout(next, DUR)
    return () => clearTimeout(timer.current)
  }, [idx, paused, s?.kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const like = () => {
    if (liked || !s) return
    localStorage.setItem(likeKey(s.id), '1')
    setLiked(true)
    bumpStory(tenantId, s.id, 'likes').catch(() => {})
  }

  if (!s) return null
  return (
    <div className="story-viewer" role="dialog" aria-modal="true"
      onPointerDown={(e) => { startX.current = e.clientX; setPaused(true) }}
      onPointerUp={(e) => {
        setPaused(false)
        const d = startX.current === null ? 0 : e.clientX - startX.current
        startX.current = null
        if (d < -45) next() // swipe toward start (RTL forward)
        else if (d > 45) prev()
      }}
      onPointerCancel={() => { setPaused(false); startX.current = null }}>
      <div className="story-progress" dir="ltr">
        {stories.map((x, i) => (
          <span key={x.id}><i style={{ width: i < idx ? '100%' : i > idx ? '0%' : undefined, animationDuration: `${DUR}ms`, animationPlayState: paused ? 'paused' : 'running' }} className={i === idx && s.kind !== 'video' ? 'run' : ''} /></span>
        ))}
      </div>
      <button className="icon-btn story-close" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}><Icon name="close" size={22} /></button>

      {s.title && <div className="story-title">{s.title}</div>}
      <audio ref={audioRef} style={{ display: 'none' }} />
      <div key={s.id} className="story-media-wrap">
        {s.kind === 'video'
          ? <video ref={storyTrimRef} className="story-media" src={s.url} autoPlay playsInline muted={!!s.audioUrl} onEnded={sTrim ? undefined : next} style={{ filter: s.filterCss || undefined }} />
          : <img className="story-media" src={s.url} alt="" style={{ filter: s.filterCss || undefined }} />}
        {Array.isArray(s.overlays) && s.overlays.length > 0 && (
          <div className="story-ov-layer" aria-hidden="true">
            {s.overlays.map((o) => (
              <span key={o.id} style={{ left: `${o.x}%`, top: `${o.y}%`, fontSize: o.size || 22, color: o.color || '#fff' }}>{o.text}</span>
            ))}
          </div>
        )}
      </div>

      {/* RTL: start side = next feels natural for Arabic swipes; keep halves simple */}
      <button className="story-nav story-nav-prev" onClick={prev} aria-label="prev" />
      <button className="story-nav story-nav-next" onClick={next} aria-label="next" />

      <div className="story-foot" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          {s.caption && <p className="story-caption">{s.caption}</p>}
          <span className="grow" />
          {s.link && (
            <a className="btn btn-sm btn-primary" style={{ flex: 'none' }} href={s.link} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()}>
              {s.linkLabel || (ar ? 'افتح الرابط' : 'Open')}
            </a>
          )}
          <button className={`story-like ${liked ? 'on' : ''}`} onClick={like}>
            <Icon name="heart" size={20} fill={liked ? 'currentColor' : 'none'} /> {s.likes > 0 ? s.likes : ''}
          </button>
        </div>
        {/* quick reply — goes to the venue's story inbox (staff-only read) */}
        <div className="story-reply" onPointerDown={(e) => e.stopPropagation()}>
          <input value={reply} placeholder={sent ? (ar ? 'وصل ردك' : 'Sent') : (ar ? 'أرسل رداً…' : 'Send a reply…')}
            onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
          {/* THE FAILURE IS NEVER SILENT AGAIN.
              This catch was empty, with a comment guessing "rules not deployed
              yet" — and it was right, for months: the replies rule was filed
              under /posts while this writes under /stories, so every reply was
              refused. With no toast and no console line the outcome was
              indistinguishable from an unwired button, which is exactly how it
              was reported. A write that fails now says so. */}
          <button type="button" aria-label={ar ? 'إرسال' : 'Send'} disabled={!reply.trim() || sending}
            onClick={async () => {
              const txt = reply.trim()
              if (!txt) return
              setSending(true)
              try {
                await addStoryReply(tenantId, s.id, { text: txt.slice(0, 280), deviceId: deviceId() })
                setReply(''); setSent(true); setTimeout(() => setSent(false), 1800)
              } catch (e) {
                console.error('[story] reply failed', e?.code || e)
                setErr(ar ? 'تعذّر إرسال ردك — حاول مرة أخرى' : 'Could not send your reply — try again')
                setTimeout(() => setErr(''), 2600)
              } finally { setSending(false) }
            }}>
            <Icon name="next" size={16} style={{ transform: ar ? 'scaleX(-1)' : undefined }} />
          </button>
        </div>
        {err && <p className="xs" style={{ margin: 0, color: '#ffb4b4', textAlign: 'center' }}>{err}</p>}
      </div>
    </div>
  )
}
