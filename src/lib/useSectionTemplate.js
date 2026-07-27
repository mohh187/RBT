import { useCallback, useEffect, useState } from 'react'
import { sectionTemplate } from './systemTemplates.js'
import { updateTenant } from './db.js'

// The chosen VIEW TEMPLATE of a section (menu grid/list/catalog, orders kanban/
// timeline, KDS rail/grid, cashier, dashboard) — and the reason it now sticks.
//
// Every screen used to hold the choice in plain component state and re-seed it
// from the tenant doc on mount:
//     const [tpl, setTpl] = useState('table')
//     useEffect(() => { setTpl(sectionTemplate(tenant, 'menu')) }, [tenant])
// so picking a view lasted exactly as long as you stayed on the screen. Leave
// and come back — or reload, or log out — and it was gone. Five screens shared
// the bug.
//
// Persistence is deliberately two-layered:
//   • localStorage, written immediately — survives reload AND logout, and works
//     for staff who cannot write the tenant document.
//   • the tenant doc, best-effort — so the choice follows the account to another
//     device. A permission failure is silently fine; the local layer still holds.
// Local wins on read: it is the most recent thing this person actually chose.

const lsKey = (tid, section) => `rbt.tpl.${tid || 'anon'}.${section}`

export function useSectionTemplate(tenant, tenantId, section, options) {
  const allowed = (id) => !options || options.some((o) => o.id === id)

  const read = useCallback(() => {
    try {
      const local = localStorage.getItem(lsKey(tenantId, section))
      if (local && allowed(local)) return local
    } catch (_) { /* storage off — fall through to the tenant value */ }
    return sectionTemplate(tenant, section)
  }, [tenant, tenantId, section])

  const [tpl, setTplState] = useState(read)

  // Re-seed when the tenant resolves (first load) or the venue changes, but
  // NEVER stomp a local choice — that is what made the setting feel broken.
  useEffect(() => { setTplState(read()) }, [read])

  const setTpl = useCallback((id) => {
    if (!allowed(id)) return
    setTplState(id)
    try { localStorage.setItem(lsKey(tenantId, section), id) } catch (_) { /* ignore */ }
    if (tenantId) {
      updateTenant(tenantId, { systemTemplates: { ...(tenant?.systemTemplates || {}), [section]: id } })
        .catch(() => { /* staff without settings permission keep the local choice */ })
    }
  }, [tenant, tenantId, section])

  return [tpl, setTpl]
}
