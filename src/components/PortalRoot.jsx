import { createContext, useContext } from 'react'

// The DOM node that Sheets / Lightboxes portal into. Defaults to <body>, but the
// live menu preview overrides it to the preview frame so sheets stay inside it.
export const PortalRootContext = createContext(null)

export function usePortalRoot() {
  const ctx = useContext(PortalRootContext)
  return ctx || (typeof document !== 'undefined' ? document.body : null)
}
