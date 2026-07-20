import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { usePortalRoot } from './PortalRoot.jsx'
import { pickLang } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'

/**
 * DishStory — «قصة الطبق».
 *
 * An editorial reader for one dish's origin story: where the ingredients come
 * from, why the venue makes it this way, what the chef wants you to notice.
 *
 * NEW OPTIONAL ITEM FIELD (the item editor writes it):
 *   item.story = {
 *     title:      string,   // headline; falls back to the item name
 *     body:       string,   // flowing text; blank lines split paragraphs
 *     sourceLine: string,   // «المصدر» accent, e.g. سمك طازج من سواحل جازان
 *     chefLine:   string,   // «من الشيف» accent
 *     imageUrl:   string,   // hero art; falls back to item.imageUrl
 *   }
 *
 * A story with no body AND no accent lines is not a story — the component
 * renders nothing, so a half-filled editor never ships an empty page.
 */

export function hasStory(item) {
  const s = item?.story
  if (!s || typeof s !== 'object') return false
  return !!(String(s.body || '').trim() || String(s.sourceLine || '').trim() || String(s.chefLine || '').trim())
}

const paragraphs = (body) => String(body || '').split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean)

/** Small entry-point pill for the item sheet. */
export function StoryBadge({ onClick, lang = 'ar' }) {
  const ar = lang === 'ar'
  return (
    <button type="button" className="story-badge" onClick={onClick}>
      <span className="story-badge-ic" aria-hidden="true"><Icon name="notepad" size={14} /></span>
      <span>{ar ? 'اقرأ قصة الطبق' : 'Read the dish story'}</span>
      <Icon name={ar ? 'back' : 'next'} size={15} className="story-badge-go" />
    </button>
  )
}

export default function DishStory({ open, onClose, item, tenant, lang = 'ar' }) {
  const ar = lang === 'ar'
  const root = usePortalRoot()
  const on = !!(open && hasStory(item))

  useEffect(() => {
    if (!on) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [on, onClose])

  if (!on || !root) return null

  const story = item.story
  const hero = story.imageUrl || item.imageUrl || ''
  const name = pickLang(item, 'name', lang)
  const title = String(story.title || '').trim() || name
  const venue = (ar ? (tenant?.name || tenant?.nameAr) : (tenant?.nameEn || tenant?.name)) || ''
  const paras = paragraphs(story.body)
  const source = String(story.sourceLine || '').trim()
  const chef = String(story.chefLine || '').trim()

  return createPortal(
    <article className="story" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="story-x" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}>
        <Icon name="close" size={20} />
      </button>

      <div className="story-scroll">
        <header className="story-hero">
          {hero ? <img src={hero} alt="" className="story-hero-img" loading="eager" /> : <span className="story-hero-fill" aria-hidden="true" />}
          <span className="story-hero-scrim" aria-hidden="true" />
          <div className="story-hero-txt">
            <span className="story-kicker">{venue ? `${venue} · ` : ''}{ar ? 'قصة الطبق' : 'The dish story'}</span>
            <h1 className="story-title">{title}</h1>
            {title !== name && name ? <p className="story-sub">{name}</p> : null}
          </div>
        </header>

        <div className="story-body">
          {paras.map((p, i) => (
            <p key={i} className={i === 0 ? 'story-p story-lede' : 'story-p'}>{p}</p>
          ))}

          {(source || chef) ? <span className="story-rule" aria-hidden="true" /> : null}

          {source ? (
            <div className="story-note story-note-source">
              <span className="story-note-lbl"><Icon name="pin" size={14} /> {ar ? 'المصدر' : 'Sourced from'}</span>
              <p>{source}</p>
            </div>
          ) : null}

          {chef ? (
            <div className="story-note story-note-chef">
              <span className="story-note-lbl"><Icon name="kitchen" size={14} /> {ar ? 'من الشيف' : 'From the chef'}</span>
              <p>{chef}</p>
            </div>
          ) : null}
        </div>
      </div>
    </article>,
    root,
  )
}
