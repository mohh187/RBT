import Icon from './Icon.jsx'

// Realistic in-context previews — pure presentational frames used wherever the
// admin composes content (campaigns, stories, posts) to show "how it will look".
// Built entirely with CSS (no external assets). RTL-safe.
//
// <RealPreview kind="whatsapp" venueName logoUrl text imageUrl time width />
// <RealPreview kind="story"    venueName logoUrl imageUrl caption width />
// <RealPreview kind="post"     venueName logoUrl imageUrl caption width />

function Avatar({ logoUrl, name, size = 30 }) {
  const letter = String(name || '').trim().charAt(0) || null
  return (
    <span className="rp-ava" style={{ width: size, height: size, fontSize: size * 0.44 }} aria-hidden="true">
      {logoUrl ? <img src={logoUrl} alt="" /> : (letter || <Icon name="store" size={Math.round(size * 0.55)} />)}
    </span>
  )
}

// double-check "delivered/read" marks drawn as SVG (no external assets)
function DoubleCheck() {
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" fill="none" aria-hidden="true">
      <path d="M1.5 6 L4.4 9 L10 2" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.7 6.4 L9.2 9 L14.8 2" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function WhatsAppPreview({ venueName, logoUrl, text, imageUrl, time, width }) {
  const t = time || new Date().toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="rp rp-wa" style={{ width }} dir="rtl">
      <div className="rp-wa-head">
        <Avatar logoUrl={logoUrl} name={venueName} size={28} />
        <div className="rp-wa-title">{venueName || 'اسم المنشأة'}</div>
      </div>
      <div className="rp-wa-chat">
        <div className="rp-wa-bubble">
          {imageUrl ? <img className="rp-wa-thumb" src={imageUrl} alt="" /> : null}
          <div className="rp-wa-text">{text || ''}</div>
          <div className="rp-wa-meta">
            <span>{t}</span>
            <DoubleCheck />
          </div>
        </div>
      </div>
      <div className="rp-label">معاينة واقعية</div>
    </div>
  )
}

function StoryPreview({ venueName, logoUrl, imageUrl, caption, width }) {
  return (
    <div className="rp rp-story" style={{ width }} dir="rtl">
      <div className="rp-story-screen">
        {imageUrl
          ? <img className="rp-story-img" src={imageUrl} alt="" />
          : <span className="rp-story-empty"><Icon name="image" size={30} /></span>}
        <div className="rp-story-top">
          <div className="rp-story-bars"><i className="on" /><i /><i /></div>
          <div className="rp-story-user">
            <Avatar logoUrl={logoUrl} name={venueName} size={22} />
            <span>{venueName || 'اسم المنشأة'}</span>
          </div>
        </div>
        {caption ? <div className="rp-story-cap">{caption}</div> : null}
      </div>
    </div>
  )
}

function PostPreview({ venueName, logoUrl, imageUrl, caption, width }) {
  return (
    <div className="rp rp-post" style={{ width }} dir="rtl">
      <div className="rp-post-head">
        <Avatar logoUrl={logoUrl} name={venueName} size={26} />
        <span className="rp-post-name">{venueName || 'اسم المنشأة'}</span>
      </div>
      <div className="rp-post-img">
        {imageUrl ? <img src={imageUrl} alt="" /> : <Icon name="image" size={28} />}
      </div>
      <div className="rp-post-icons">
        <Icon name="heart" size={18} />
        <Icon name="message" size={18} />
        <Icon name="share" size={18} />
      </div>
      {caption ? (
        <div className="rp-post-cap"><b>{venueName || ''}</b> {caption}</div>
      ) : null}
    </div>
  )
}

export default function RealPreview({ kind, width = 260, ...props }) {
  if (kind === 'story') return <StoryPreview width={width} {...props} />
  if (kind === 'post') return <PostPreview width={width} {...props} />
  return <WhatsAppPreview width={width} {...props} />
}
