import { memo, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePortalRoot } from './PortalRoot.jsx'
import MenuPreview from './MenuPreview.jsx'
import Icon from './Icon.jsx'

// The single LIVE preview pane of the item editor: the REAL menu (the studio's
// proven iframe bus — MenuPreview -> /preview/:slug -> PreviewMenu) with the
// unsaved draft item streamed in over the postMessage envelope
// { appearance, draftItem, focus, previewTheme }. override stays EMPTY on
// purpose: the frame previews the SAVED tenant — real wall, real table, real
// header — so the owner sees the dish inside his actual room while only the
// ITEM is a draft.
//
// Perf guards (all load-bearing): the draft is debounced ~100ms; the override
// is a module const (a fresh {} per render would defeat React.memo); the
// focus object is memoized on its scalars; MenuPreview is memo-wrapped so the
// iframe re-posts at the debounce rate, not per keystroke.
//
// ≥1000px renders inline as the sticky side pane (.ilp-pane, CSS in
// appearance.css). Below that it portals to the portal root as a fixed bottom
// drawer (.ilp-drawer) — NOT a fixed child of .sheet, whose overflow:hidden +
// entrance transform would clip/trap it — starting COLLAPSED so it never
// covers the editor's Save bar; collapsing is a transform, so the iframe
// never unmounts and keeps its state.

const EMPTY_OVERRIDE = {}
const MemoMenuPreview = memo(MenuPreview)

export default function ItemLivePreview({ slug, draftItem, variant = 'list', onVariant, lang = 'ar' }) {
  const ar = lang !== 'en'
  const portalRoot = usePortalRoot()

  const [sent, setSent] = useState(draftItem)
  useEffect(() => {
    const t = setTimeout(() => setSent(draftItem), 100)
    return () => clearTimeout(t)
  }, [draftItem])

  const [replay, setReplay] = useState(0)
  const [collapsed, setCollapsed] = useState(true)
  const [wide, setWide] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1000px)').matches
  ))
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1000px)')
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const sentId = sent ? sent.id : null
  const focus = useMemo(
    () => (sentId ? { itemId: sentId, view: variant === 'stage' ? 'stage' : 'list', replay } : null),
    [sentId, variant, replay],
  )

  // no venue slug (auth still hydrating) -> no frame at all, never /preview/undefined
  if (!slug || !sent) return null

  const body = (
    <div className={wide ? 'ilp ilp-pane' : 'ilp ilp-drawer'} data-collapsed={!wide && collapsed ? '1' : undefined}>
      <div className="ilp-head">
        <div className="row" style={{ gap: 6 }}>
          <button
            type="button"
            className={`chip ${variant === 'list' ? 'active' : ''}`}
            onClick={() => onVariant && onVariant('list')}
          >
            {ar ? 'القائمة' : 'List'}
          </button>
          <button
            type="button"
            className={`chip ${variant === 'stage' ? 'active' : ''}`}
            onClick={() => onVariant && onVariant('stage')}
          >
            {ar ? 'الصنف المفتوح' : 'Opened item'}
          </button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn btn-xs btn-outline" onClick={() => setReplay((r) => r + 1)}>
            <Icon name="reload" size={12} /> {ar ? 'إعادة الحركة' : 'Replay'}
          </button>
          {!wide && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setCollapsed((v) => !v)}
              aria-label={ar ? (collapsed ? 'افتح المعاينة' : 'اطوِ المعاينة') : (collapsed ? 'Open preview' : 'Collapse preview')}
            >
              <Icon name={collapsed ? 'chevronUp' : 'chevronDown'} size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="ilp-body">
        <MemoMenuPreview slug={slug} override={EMPTY_OVERRIDE} mode="mobile" draftItem={sent} focus={focus} />
      </div>
    </div>
  )

  if (wide) return body
  return portalRoot ? createPortal(body, portalRoot) : null
}
