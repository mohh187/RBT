import { useEffect, useState } from 'react'
import { resolveSlug, getTenant, watchItems, watchCategories, watchOffers } from './db.js'
import { applySkin, resolveSkin, applyTypography } from './skins.js'
import { applyChrome, clearChrome } from './systemThemes.js'
import { applyVenueManifest, restorePlatformManifest } from './pwa.js'

function applyBrand(tenant) {
  applySkin(resolveSkin(tenant, 'menu'), { applyMode: true })
  applyTypography(tenant)
  // top bar + bottom nav colour (tenant.chromeTheme); cleared on the way out so
  // one venue's chrome never follows the visitor to the next screen
  applyChrome(tenant)
}

// Loads a venue (tenant) + its live menu/offers by public slug. No auth required.
export function usePublicVenue(slug) {
  // Use cached data if available for instant initial render
  const [state, setState] = useState(() => {
    const cachedTid = localStorage.getItem(`venue_tid_${slug}`)
    if (cachedTid) {
      const cachedTenantStr = localStorage.getItem(`venue_tenant_${cachedTid}`)
      if (cachedTenantStr) {
        try {
          const cachedTenant = JSON.parse(cachedTenantStr)
          // Pre-apply brand styles during initialization for 0ms style pop.
          // (The manifest is injected from the effect below, never during render.)
          applyBrand(cachedTenant)

          // Load cached menu elements
          const cachedItems = localStorage.getItem(`venue_items_${cachedTid}`)
          const cachedCats = localStorage.getItem(`venue_categories_${cachedTid}`)
          const cachedOffers = localStorage.getItem(`venue_offers_${cachedTid}`)

          const items = cachedItems ? JSON.parse(cachedItems) : []
          const categories = cachedCats ? JSON.parse(cachedCats) : []
          const offers = cachedOffers ? JSON.parse(cachedOffers) : []

          return {
            loading: items.length === 0, // Only show loader if we have NO cached items
            notFound: false,
            tenant: cachedTenant,
            tenantId: cachedTid,
            items,
            categories,
            offers
          }
        } catch (_) {}
      }
    }
    return { loading: true, notFound: false, tenant: null, items: [], categories: [], offers: [] }
  })

  // Chrome (bar colour) gets its OWN effect rather than riding on applyBrand
  // alone: a staff shell clears the attribute when it unmounts, and that cleanup
  // runs AFTER this tree renders — so a venue restored from cache would flash
  // its bars back to the default. An effect re-asserts it after that cleanup,
  // and hands it back when the visitor leaves the menu.
  const chrome = state.tenant?.chromeTheme
  useEffect(() => {
    applyChrome({ chromeTheme: chrome })
    return () => clearChrome()
  }, [chrome])

  useEffect(() => {
    let unsubs = []
    let cancelled = false

    // Check initial cached values
    const cachedTid = localStorage.getItem(`venue_tid_${slug}`)
    let activeTid = cachedTid
    // localStorage can throw QuotaExceededError on large menus — never let a
    // cache write break the listener callback it runs inside.
    const safeSet = (k, v) => { try { localStorage.setItem(k, v) } catch (_) { /* quota — skip cache */ } }
    // Watchdog: never leave the spinner hanging forever if a load stalls.
    const watchdog = setTimeout(() => { if (!cancelled) setState((s) => (s.loading ? { ...s, loading: false } : s)) }, 8000)

    const startWatching = (tid) => {
      // watchItems now always fires (success OR error → []), so it is the single
      // authority that clears `loading`.
      unsubs.push(watchItems(tid, (items) => {
        if (cancelled) return
        setState((s) => ({ ...s, items, loading: false }))
        safeSet(`venue_items_${tid}`, JSON.stringify(items))
      }))
      unsubs.push(watchCategories(tid, (categories) => {
        if (cancelled) return
        setState((s) => ({ ...s, categories }))
        safeSet(`venue_categories_${tid}`, JSON.stringify(categories))
      }))
      unsubs.push(watchOffers(tid, (offers) => {
        if (cancelled) return
        setState((s) => ({ ...s, offers }))
        safeSet(`venue_offers_${tid}`, JSON.stringify(offers))
      }))
    }

    const load = async () => {
      let tenantPromise = null

      // If we have a cached tenant ID, trigger queries immediately in parallel!
      if (activeTid) {
        tenantPromise = getTenant(activeTid)
        startWatching(activeTid)
      }

      // Always resolve slug in background/parallel to check for changes
      const resolvedTid = await resolveSlug(slug)
      if (cancelled) return

      if (!resolvedTid) {
        setState((s) => ({ ...s, loading: false, notFound: true }))
        return
      }

      // If slug resolved to a different tenant ID than what was cached (or if cache was empty)
      if (resolvedTid !== activeTid) {
        activeTid = resolvedTid
        safeSet(`venue_tid_${slug}`, resolvedTid)

        // Clean up previous listeners
        unsubs.forEach((u) => u && u())
        unsubs = []

        tenantPromise = getTenant(resolvedTid)
        startWatching(resolvedTid)
      }

      const tenant = await tenantPromise
      if (cancelled) return

      if (tenant) {
        applyBrand(tenant)
        applyVenueManifest(tenant, slug)
        // Don't override `loading` here — watchItems owns it (fires even on error/empty).
        setState((s) => ({ ...s, tenant, tenantId: activeTid }))
        safeSet(`venue_tenant_${activeTid}`, JSON.stringify(tenant))
      }
    }

    // A rejected slug/tenant getDoc (network/permission/offline first-load) must
    // not strand the spinner — clear loading and surface an error state.
    load().catch((e) => {
      if (cancelled) return
      console.warn('[venue] load failed', e?.code || e?.message || e)
      setState((s) => ({ ...s, loading: false, error: true }))
    })

    return () => {
      cancelled = true
      clearTimeout(watchdog)
      restorePlatformManifest() // don't leave the platform install identity as this venue
      clearChrome()
      unsubs.forEach((u) => u && u())
    }
  }, [slug])

  return state
}
