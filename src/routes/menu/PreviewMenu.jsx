import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { resolveSlug, getTenant, watchItems, watchCategories, watchOffers } from '../../lib/db.js'
import { applySkin, resolveSkin, applyTypography } from '../../lib/skins.js'
import { applyChrome } from '../../lib/systemThemes.js'
import { FullSpinner } from '../../components/ui.jsx'
import DinerBar from '../../components/DinerBar.jsx'
import MenuView from '../../components/MenuView.jsx'
import VenueBackground from '../../components/VenueBackground.jsx'

// A TRUE carbon-copy preview of the real customer menu, rendered in an iframe so
// fixed bars / 100dvh / future theme layouts behave exactly as on the live menu.
// The admin Settings page and the item editor feed live (unsaved) state via postMessage.
//
// postMessage envelope (transport contract with MenuPreview.jsx — keep both headers in sync):
//   { __rbt360Preview: true, appearance, draftItem, focus, previewTheme }
//   - appearance:   tenant-shaped override merged over the saved tenant (may be {}).
//   - draftItem:    optional item-shaped draft merged into the fetched items —
//                   replace-by-id for a saved item, append when id is '__draft__'.
//   - focus:        optional { itemId, view: 'list'|'stage', replay } — passed to
//                   MenuView as previewFocus; replay remounts MenuView (key) so
//                   entrance animations run again.
//   - previewTheme: optional 'light'|'dark' pin for this frame's data-theme,
//                   re-asserted AFTER applySkin (the skin's own mode stamp would
//                   clobber a standalone effect). Top-level sibling of appearance
//                   by contract — never smuggled inside it.
//   Senders that post only { appearance } keep working unchanged.
export default function PreviewMenu() {
  const { slug } = useParams()
  const [tenant, setTenant] = useState(null)
  const [tenantId, setTenantId] = useState(null)
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [offers, setOffers] = useState([])
  const [override, setOverride] = useState({})
  const [draftItem, setDraftItem] = useState(null)
  const [focus, setFocus] = useState(null)
  const [previewTheme, setPreviewTheme] = useState(null)

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

  // receive the live envelope from the parent Settings page / item editor
  useEffect(() => {
    const onMsg = (e) => {
      if (!e.data || !e.data.__rbt360Preview) return
      setOverride(e.data.appearance || {})
      setDraftItem(e.data.draftItem || null)
      setFocus(e.data.focus || null)
      const th = e.data.previewTheme
      setPreviewTheme(th === 'light' || th === 'dark' ? th : null)
    }
    window.addEventListener('message', onMsg)
    try { window.parent && window.parent.postMessage({ __rbt360PreviewReady: true }, '*') } catch (_) { /* ignore */ }
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const draft = tenant ? { ...tenant, ...override } : null
  // applyChrome writes to THIS frame's body, so the mock bars in the studio and
  // the real bars in here stay one and the same choice. The previewTheme pin is
  // re-asserted INSIDE this same effect, after applySkin: the editorial skin
  // stamps data-theme='dark' (applyMode) on every streamed tick, so a standalone
  // effect keyed only on previewTheme would run once and then be clobbered.
  useEffect(() => {
    if (draft) {
      applySkin(resolveSkin(draft, 'menu'), { applyMode: true })
      applyTypography(draft)
      applyChrome(draft)
      if (previewTheme === 'light' || previewTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', previewTheme)
      }
    }
  }, [override, tenant, previewTheme]) // eslint-disable-line react-hooks/exhaustive-deps

  // Merge the streamed draft into the fetched items: replace-by-id when it is a
  // saved item being edited, append when it is a brand-new one (id '__draft__').
  const shownItems = useMemo(() => {
    if (!draftItem) return items
    const i = items.findIndex((x) => x.id === draftItem.id)
    if (i < 0) return [...items, draftItem]
    const out = items.slice()
    out[i] = { ...out[i], ...draftItem }
    return out
  }, [items, draftItem])

  if (!draft) return <FullSpinner />
  return (
    <div className="venue-above" style={{ minHeight: '100dvh' }}>
      {/* hide the scrollbar so the menu stays perfectly centered (wheel still scrolls) */}
      <style>{'html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}html,body{scrollbar-width:none;-ms-overflow-style:none}'}</style>
      <VenueBackground tenant={draft} />
      <DinerBar tenant={draft} />
      <MenuView key={(focus && focus.replay) || 0} tenant={draft} tenantId={tenantId} items={shownItems} categories={categories} offers={offers} preview previewFocus={focus} onPlaced={() => {}} />
    </div>
  )
}
