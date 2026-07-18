import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { usePortalRoot } from './PortalRoot.jsx'

// Tap-to-enlarge image overlay (portaled to the active portal root — body, or the
// menu preview frame when inside it — uses the global .img-zoom styles).
export default function Lightbox({ src, onClose }) {
  const portalRoot = usePortalRoot()
  if (!src) return null
  return createPortal(
    <div className="img-zoom" onClick={onClose} role="dialog" aria-modal="true">
      <img src={src} alt="" />
      <button className="img-zoom-x" onClick={onClose} aria-label="close"><Icon name="close" size={22} /></button>
    </div>,
    portalRoot,
  )
}
