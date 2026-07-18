import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../lib/i18n.jsx'
import { usePortalRoot } from './PortalRoot.jsx'
import Icon from './Icon.jsx'

// Bottom sheet (mobile-first modal). Renders nothing when !open.
// Portaled to <body> so `position: fixed` is relative to the viewport even when
// the trigger lives inside a backdrop-filtered/transformed ancestor (e.g. the app bar).
export default function Sheet({ open, onClose, title, children, footer, tall = false, full = false, className = '', windowStyle = {}, bgNode }) {
  const { t } = useI18n()
  const portalRoot = usePortalRoot()
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <>
      <div className="backdrop" onClick={onClose} />
      <div className={`sheet${tall ? ' sheet-tall' : ''}${full ? ' sheet-full' : ''} ${className}`} style={windowStyle} role="dialog" aria-modal="true" aria-label={title}>
        {bgNode}
        <div className="sheet-handle" />
        {title && (
          <div className="sheet-head">
            <strong style={{ fontSize: 'var(--fs-md)' }}>{title}</strong>
            <button className="icon-btn" onClick={onClose} aria-label={t('close')}>
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>,
    portalRoot,
  )
}
