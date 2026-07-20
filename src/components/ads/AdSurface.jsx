// The ad body itself — the ONE renderer shared by the guest popup and the
// studio's live preview. Because both mount this exact component, "preview"
// and "what the guest sees" cannot drift apart.
//
// It is purely presentational: no Firestore, no timers, no decisions. The
// popup wraps it in behaviour (triggers, focus trap, recording); the studio
// wraps it in a phone frame.
import { useEffect, useMemo } from 'react'
import Icon from '../Icon.jsx'
import { normalizeAd, rewardText } from '../../lib/ads.js'
import { fontStacks, loadFont } from '../../lib/skins.js'
import { contrastRatio } from '../../lib/contrast.js'

// Black or white — whichever is actually readable on the venue's accent.
export function onAccent(accent) {
  const dark = contrastRatio(accent, '#101014')
  const light = contrastRatio(accent, '#ffffff')
  if (dark == null || light == null) return '#101014'
  return dark >= light ? '#101014' : '#ffffff'
}

export function surfaceVars(ad) {
  const d = ad.design
  return {
    '--adx-bg': d.bg,
    '--adx-fg': d.textColor,
    '--adx-accent': d.accent,
    '--adx-on-accent': onAccent(d.accent),
    '--adx-radius': `${d.radius}px`,
    '--adx-scrim': `${d.overlayOpacity}%`,
    '--adx-font': fontStacks(d.fontKey).body,
  }
}

export default function AdSurface({
  ad: rawAd,
  lang = 'ar',
  onCta,
  onClose,
  claimed = null,
  surfaceRef = null,
  ctaRef = null,
}) {
  const ad = useMemo(() => normalizeAd(rawAd), [rawAd])
  const ar = lang !== 'en'

  // The chosen face has to actually be on the page or the preview lies.
  useEffect(() => { if (ad?.design?.fontKey) loadFont(ad.design.fontKey) }, [ad?.design?.fontKey])

  if (!ad) return null

  const { media, shape, design } = ad
  const hasMedia = media.type !== 'none' && !!media.url
  // Only ever shown when the venue configured something real (see ads.js).
  const reward = rewardText(ad.reward)

  const body = (
    <div
      className="adx-surface"
      data-shape={shape}
      data-pos={design.textPos}
      style={surfaceVars(ad)}
      ref={surfaceRef}
      role="dialog"
      aria-modal="true"
      aria-label={ad.headline || ad.name || (ar ? 'إعلان' : 'Advertisement')}
    >
      {shape === 'sheet' ? <div className="adx-grabber" /> : null}

      <div className="adx-media">
        {hasMedia && media.type === 'video' ? (
          <video
            src={media.url}
            poster={media.poster || undefined}
            autoPlay
            muted
            playsInline
            loop
            disablePictureInPicture
          />
        ) : null}
        {hasMedia && media.type === 'image' ? <img src={media.url} alt="" /> : null}
      </div>
      <div className="adx-scrim" />

      <div className="adx-body">
        {ad.headline ? <h3 className="adx-headline">{ad.headline}</h3> : null}
        {ad.body ? <p className="adx-text">{ad.body}</p> : null}

        {reward && !claimed ? (
          <div className="adx-reward">
            <Icon name="award" size={13} />
            <span>{reward}</span>
          </div>
        ) : null}

        {claimed?.ok ? (
          <div className="adx-code">
            <b>{claimed.code}</b>
            <small>{claimed.text}</small>
            <small>{claimed.howTo}</small>
          </div>
        ) : null}
        {claimed && !claimed.ok ? (
          <div className="adx-code">
            <small>{claimed.message}</small>
          </div>
        ) : null}

        {ad.ctaLabel && !claimed ? (
          <button type="button" className="adx-cta" onClick={onCta} ref={ctaRef}>
            {ad.ctaLabel}
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className="adx-close"
        onClick={onClose}
        aria-label={ar ? 'إغلاق الإعلان' : 'Close ad'}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  )

  // The circle gets a live accent ring; every other shape renders bare.
  return shape === 'circle' ? <div className="adx-ring">{body}</div> : body
}
