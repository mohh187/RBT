import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { resolveSlug, getTenant, watchPublishedPosts, bumpPost } from '../../lib/db.js'
import { useI18n } from '../../lib/i18n.jsx'
import { FullSpinner, Empty } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import SocialLinks from '../../components/SocialLinks.jsx'
import { timeAgo } from '../../lib/format.js'

const TYPES = [
  ['all', 'الكل', 'All'],
  ['news', 'أخبار', 'News'],
  ['event', 'فعاليات', 'Events'],
  ['visit', 'زيارات', 'Visits'],
  ['video', 'فيديو', 'Video'],
]
export const POST_TYPES = [
  ['news', 'خبر', 'News'],
  ['event', 'فعالية', 'Event'],
  ['visit', 'زيارة مميزة', 'Notable visit'],
  ['announcement', 'إعلان', 'Announcement'],
  ['video', 'فيديو', 'Video'],
]

const likeKey = (id) => `ml.post.l.${id}`
const seenKey = (id) => `ml.post.v.${id}`

// Public venue profile — a living blog: news, events, notable visits, videos.
export default function VenueProfile() {
  const { slug } = useParams()
  const { lang } = useI18n()
  const ar = lang === 'ar'
  const [tid, setTid] = useState(null)
  const [venue, setVenue] = useState(null)
  const [posts, setPosts] = useState(null)
  const [tab, setTab] = useState('all')
  const [liked, setLiked] = useState({})

  useEffect(() => {
    let unsub
    resolveSlug(slug).then((id) => {
      setTid(id)
      if (!id) { setPosts([]); return }
      getTenant(id).then(setVenue).catch(() => {})
      unsub = watchPublishedPosts(id, setPosts)
    })
    return () => unsub && unsub()
  }, [slug])

  const shown = useMemo(() => {
    const list = (posts || []).filter((p) => p.published !== false)
    const f = tab === 'all' ? list : list.filter((p) => (tab === 'video' ? p.type === 'video' || (p.media || []).some((m) => m.kind === 'video') : p.type === tab))
    // the published query is unordered (no composite index) → sort here: pinned first, then newest.
    const ms = (p) => (p.createdAt?.toMillis?.() ?? (p.createdAt?.seconds ? p.createdAt.seconds * 1000 : 0))
    return [...f].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || ms(b) - ms(a))
  }, [posts, tab])

  // count a view once per device per post (first 10 visible)
  useEffect(() => {
    if (!tid) return
    shown.slice(0, 10).forEach((p) => {
      if (!localStorage.getItem(seenKey(p.id))) {
        localStorage.setItem(seenKey(p.id), '1')
        bumpPost(tid, p.id, 'views').catch(() => {})
      }
    })
  }, [tid, shown])

  const like = (p) => {
    if (liked[p.id] || localStorage.getItem(likeKey(p.id))) return
    localStorage.setItem(likeKey(p.id), '1')
    setLiked((x) => ({ ...x, [p.id]: true }))
    bumpPost(tid, p.id, 'likes').catch(() => {})
  }

  if (posts === null) return <FullSpinner />

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      <header className="app-bar">
        <Link to={`/m/${slug}`} className="icon-btn"><Icon name="back" /></Link>
        {venue?.logoUrl && <img src={venue.logoUrl} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} />}
        <strong style={{ fontSize: 'var(--fs-md)' }}>{venue?.name || ''}</strong>
      </header>

      <div className="container page stack" style={{ gap: 'var(--sp-3)', maxWidth: 680 }}>
        <div className="stack center" style={{ gap: 6, textAlign: 'center', paddingTop: 'var(--sp-2)' }}>
          <h2 style={{ margin: 0 }}>{ar ? 'قصتنا وأخبارنا' : 'Our story & news'}</h2>
          {venue?.descAr && <p className="muted small" style={{ margin: 0 }}>{venue.descAr}</p>}
          <SocialLinks social={venue?.social} appearance={venue?.socialStyle} />
        </div>

        <div className="row" style={{ gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {TYPES.map(([id, a, e]) => (
            <button key={id} className={`chip ${tab === id ? 'active' : ''}`} style={{ flex: 'none' }} onClick={() => setTab(id)}>{ar ? a : e}</button>
          ))}
        </div>

        {shown.length === 0 ? (
          <Empty icon="events" title={ar ? 'لا منشورات بعد' : 'Nothing here yet'} />
        ) : shown.map((p) => {
          const typeMeta = POST_TYPES.find(([id]) => id === p.type)
          return (
            <article key={p.id} className="card stack" style={{ gap: 0, overflow: 'hidden' }}>
              {(p.media || []).slice(0, 1).map((m, i) => m.kind === 'video'
                ? <video key={i} src={m.url} controls playsInline style={{ width: '100%', maxHeight: 380, background: '#000' }} />
                : <img key={i} src={m.url} alt="" loading="lazy" style={{ width: '100%', maxHeight: 380, objectFit: 'cover' }} />)}
              <div className="stack card-pad" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {p.pinned && <span className="badge badge-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="pin" size={11} /> {ar ? 'مثبّت' : 'Pinned'}</span>}
                  {typeMeta && <span className="badge">{ar ? typeMeta[1] : typeMeta[2]}</span>}
                  <span className="xs faint">{p.createdAt ? timeAgo(p.createdAt, lang) : ''}</span>
                </div>
                <strong style={{ fontSize: 'var(--fs-md)' }}>{p.title}</strong>
                {p.body && <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{p.body}</p>}
                {(p.media || []).length > 1 && (
                  <div className="row" style={{ gap: 6, overflowX: 'auto' }}>
                    {(p.media || []).slice(1).map((m, i) => m.kind === 'video'
                      ? <video key={i} src={m.url} controls playsInline style={{ height: 110, borderRadius: 10, background: '#000', flex: 'none' }} />
                      : <img key={i} src={m.url} alt="" loading="lazy" style={{ height: 110, borderRadius: 10, objectFit: 'cover', flex: 'none' }} />)}
                  </div>
                )}
                <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                  <button className={`btn btn-sm ${liked[p.id] || localStorage.getItem(likeKey(p.id)) ? 'btn-primary' : 'btn-outline'}`} onClick={() => like(p)}>
                    <Icon name="heart" size={14} /> {p.likes > 0 ? p.likes : ''}
                  </button>
                  <span className="xs faint" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="eye" size={12} /> {p.views || 0}</span>
                </div>
              </div>
            </article>
          )
        })}

        <Link to={`/m/${slug}`} className="btn btn-outline btn-block">{ar ? 'العودة للمنيو' : 'Back to menu'}</Link>
      </div>
    </div>
  )
}
