import { useEffect } from 'react'

// Switches the whole app into the compact density scale while a management/operational
// surface (admin, cashier, kitchen, staff portal) is mounted. Set on <html> so it also
// reaches portaled sheets/dialogs. Reverts to the comfortable scale (diner menu) on unmount.
export function useCompactUI() {
  useEffect(() => {
    const r = document.documentElement
    const prev = r.getAttribute('data-density')
    r.setAttribute('data-density', 'compact')
    return () => { if (prev) r.setAttribute('data-density', prev); else r.removeAttribute('data-density') }
  }, [])
}
