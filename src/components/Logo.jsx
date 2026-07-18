// RBT360 logomark.
// Evolves the existing coffee-cup identity (kept from the favicon for brand
// continuity) into a professional mark: the steam becomes two connected "link"
// nodes — the literal RBT360 idea, a menu that's connected. The cup adapts to
// the active brand color; the nodes carry the gold accent.

export function LogoMark({ size = 34, tile = true, className }) {
  const stroke = tile ? '#F7F2EC' : 'currentColor'
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="rbt360" fill="none">
      {tile && <rect width="64" height="64" rx="15" fill="var(--brand)" />}
      {tile && <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="14.25" stroke="rgba(255,255,255,.16)" strokeWidth="1.5" />}
      {/* cup + handle (from the favicon geometry) */}
      <path d="M20 24h17a9 9 0 0 1 0 18h-3v5a3 3 0 0 1-3 3H23a3 3 0 0 1-3-3V24z" stroke={stroke} strokeWidth="3.6" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M37 29h1.6a4 4 0 0 1 0 8H37" stroke={stroke} strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" />
      {/* steam → link nodes */}
      <line x1="24" y1="15" x2="34" y2="10" stroke="var(--gold)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="15" r="3.1" fill="var(--gold)" />
      <circle cx="34" cy="10" r="3.1" fill="var(--gold)" />
    </svg>
  )
}

// Full lockup: mark + two-tone wordmark. Pass a custom `name` to render it plain.
export function BrandLogo({ name, size = 32, className }) {
  return (
    <span className={`brand-mark${className ? ' ' + className : ''}`}>
      <LogoMark size={size} />
      {name ? (
        <span className="brand-word">{name}</span>
      ) : (
        <span className="brand-word">rbt<span className="brand-word-accent">360</span></span>
      )}
    </span>
  )
}

export default BrandLogo
