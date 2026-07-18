import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { resolveSlug, getTenant, watchItems, watchCategories, watchOffers } from '../../lib/db.js'
import { applySkin, resolveSkin, applyTypography } from '../../lib/skins.js'
import { FullSpinner } from '../../components/ui.jsx'
import DinerBar from '../../components/DinerBar.jsx'
import MenuView from '../../components/MenuView.jsx'
import VenueBackground from '../../components/VenueBackground.jsx'

// A TRUE carbon-copy preview of the real customer menu, rendered in an iframe so
// fixed bars / 100dvh / future theme layouts behave exactly as on the live menu.
// The admin Settings page feeds live (unsaved) appearance via postMessage.
export default function PreviewMenu() {
  const { slug } = useParams()
  const [tenant, setTenant] = useState(null)
  const [tenantId, setTenantId] = useState(null)
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [offers, setOffers] = useState([])
  const [override, setOverride] = useState({})

  useEffect(() => {
    let unsubs = [], cancelled = false
    ;(async () => {
      const tid = await resolveSlug(slug); if (cancelled || !tid) return
      const tn = await getTenant(tid); if (cancelled) return
      setTenantId(tid); setTenant(tn)
      unsubs.push(watchItems(tid, setItems))
      unsubs.push(watchCategories(tid, setCategories))
      unsubs.push(watchOffers(tid, setOffers))
    })()
    return () => { cancelled = true; unsubs.forEach((u) => u && u()) }
  }, [slug])

  // receive live appearance overrides from the parent Settings page
  useEffect(() => {
    const onMsg = (e) => { if (e.data && e.data.__rbt360Preview) setOverride(e.data.appearance || {}) }
    window.addEventListener('message', onMsg)
    try { window.parent && window.parent.postMessage({ __rbt360PreviewReady: true }, '*') } catch (_) { /* ignore */ }
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const draft = tenant ? { ...tenant, ...override } : null
  useEffect(() => { if (draft) { applySkin(resolveSkin(draft, 'menu'), { applyMode: true }); applyTypography(draft) } }, [override, tenant]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft) return <FullSpinner />
  return (
    <div className="venue-above" style={{ minHeight: '100dvh' }}>
      {/* hide the scrollbar so the menu stays perfectly centered (wheel still scrolls) */}
      <style>{'html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}html,body{scrollbar-width:none;-ms-overflow-style:none}'}</style>
      <VenueBackground tenant={draft} />
      <DinerBar tenant={draft} />
      <MenuView tenant={draft} tenantId={tenantId} items={items} categories={categories} offers={offers} preview onPlaced={() => {}} />
    </div>
  )
}
