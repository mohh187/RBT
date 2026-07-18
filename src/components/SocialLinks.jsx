// Social profile icons for the venue — shown under the menu name and on the
// order-status / rating screen. Renders ONLY the filled entries; returns null
// when nothing is configured, so it's always safe to mount.
// Brand glyphs are inline SVG (lucide ships no brand icons).

export const SOCIAL_KEYS = [
  ['instagram', 'Instagram'],
  ['x', 'X (Twitter)'],
  ['tiktok', 'TikTok'],
  ['snapchat', 'Snapchat'],
  ['whatsapp', 'WhatsApp'],
  ['googleMaps', 'Google Maps'],
  ['website', 'Website'],
]

// Accepts a full URL, or a handle/number and builds the URL per network.
export function socialHref(key, raw) {
  const v = (raw || '').trim()
  if (!v) return ''
  if (/^https?:\/\//i.test(v)) return v
  const handle = v.replace(/^@/, '')
  switch (key) {
    case 'whatsapp': return `https://wa.me/${v.replace(/[^0-9]/g, '')}`
    case 'instagram': return `https://instagram.com/${handle}`
    case 'x': return `https://x.com/${handle}`
    case 'tiktok': return `https://tiktok.com/@${handle}`
    case 'snapchat': return `https://snapchat.com/add/${handle}`
    default: return `https://${v}`
  }
}

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }
const GLYPH = {
  instagram: (
    <g {...S}><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" /></g>
  ),
  x: (
    <path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
  ),
  tiktok: (
    <path fill="currentColor" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
  ),
  snapchat: (
    <g {...S}><path d="M12 3.6c2.9 0 4.7 2.1 4.7 4.8v2.1c.9.3 2 .8 2 1.5 0 .8-1.4 1.1-2.1 1.8.7 1.5 2.6 1.7 2.6 2.5 0 .8-1.9.8-2.8 1.3-.6.3-1 .9-2.4.9s-1.8-.6-2.4-.9c-.9-.5-2.8-.5-2.8-1.3 0-.8 1.9-1 2.6-2.5-.7-.7-2.1-1-2.1-1.8 0-.7 1.1-1.2 2-1.5V8.4c0-2.7 1.8-4.8 4.7-4.8z" /></g>
  ),
  whatsapp: (
    <path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  ),
  googleMaps: (
    <g {...S}><path d="M12 21s-6.5-5.7-6.5-10.5a6.5 6.5 0 1 1 13 0C18.5 15.3 12 21 12 21z" /><circle cx="12" cy="10.3" r="2.4" /></g>
  ),
  website: (
    <g {...S}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c-2.4 2.4-3.5 5.3-3.5 8.5s1.1 6.1 3.5 8.5c2.4-2.4 3.5-5.3 3.5-8.5s-1.1-6.1-3.5-8.5z" /></g>
  ),
}

// appearance (tenant.socialStyle): { shape: 'circle'|'rounded'|'square'|'bare',
//   tone: 'auto'|'brand'|'custom', color: '#hex', size: 'sm'|'md'|'lg' }
export default function SocialLinks({ social, className = '', style, appearance }) {
  const entries = SOCIAL_KEYS
    .map(([k]) => [k, socialHref(k, social?.[k])])
    .filter(([, href]) => href)
  if (!entries.length) return null
  const tone = appearance?.tone || 'auto'
  const color = tone === 'brand' ? 'var(--brand)' : tone === 'custom' ? (appearance?.color || undefined) : undefined
  const size = { sm: 15, md: 18, lg: 22 }[appearance?.size || 'md'] || 18
  return (
    <div className={`social-links ${className}`} data-shape={appearance?.shape || 'circle'} style={{ ...(color ? { color } : null), ...style }}>
      {entries.map(([k, href]) => (
        <a key={k} href={href} target="_blank" rel="noopener noreferrer" aria-label={k} title={SOCIAL_KEYS.find(([id]) => id === k)?.[1]}>
          <svg width={size} height={size} viewBox="0 0 24 24">{GLYPH[k]}</svg>
        </a>
      ))}
    </div>
  )
}
