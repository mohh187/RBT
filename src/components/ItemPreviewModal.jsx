import { useEffect, useMemo, useState } from 'react'
import Sheet from './Sheet.jsx'
import MenuPreview from './MenuPreview.jsx'
import Icon from './Icon.jsx'

// «هكذا يراه الضيف» — tapping an item card in the admin opens THIS, not the raw
// guest component.
//
// It used to render EditorialItemStage / ItemSheet straight into the admin page.
// Those are the real guest surfaces and they are built for a phone held in one
// hand: 100vw backgrounds, 100dvh stages, a full-bleed wall. On a 1920px monitor
// that stretched into a wall of brick with a small dish adrift in the middle,
// which told the owner nothing about what a guest actually sees. Constraining
// them in place is not possible either, because those viewport units resolve
// against the WINDOW no matter what box you put them in.
//
// So the preview runs where the viewport really is 390x844: the studio's proven
// iframe bus (MenuPreview -> /preview/:slug -> PreviewMenu), inside a phone
// frame, with the two views the owner asked for as tabs. Nothing is faked, the
// theme cannot leak in from the back office (separate document), and the pairing
// chips and category bar are live because it IS the menu.
const EMPTY_OVERRIDE = {}

const VIEWS = [
  { id: 'list', ar: 'الصنف في المنيو', en: 'In the menu' },
  { id: 'stage', ar: 'داخل نافذة الصنف', en: 'Inside its window' },
]

// The frame's INNER viewport is always 390x844 (that is what makes the menu lay
// out like a phone). Only the transform scale moves, to fill whatever height the
// admin's screen actually has without ever needing to scroll the window.
const BEZEL = 10
const FRAME_H = 844 + BEZEL * 2
// sheet handle + head + tabs + MenuPreview's own 10px padding + hint + footer +
// the window's bottom offset. Measured, then rounded UP: underestimating it
// makes the sheet overflow its 94dvh cap and grow a scrollbar, and a scrollbar
// around a device mock looks broken.
const CHROME = 300

function fitScale() {
  if (typeof window === 'undefined') return 0.72
  const byH = (window.innerHeight - CHROME) / FRAME_H
  const byW = (Math.min(window.innerWidth, 520) - 48) / (390 + BEZEL * 2)
  return Math.max(0.42, Math.min(0.95, byH, byW))
}

export default function ItemPreviewModal({ item, slug, lang = 'ar', onClose, onEdit }) {
  const ar = lang !== 'en'
  const [view, setView] = useState('list')
  const [replay, setReplay] = useState(0)
  const [scale, setScale] = useState(fitScale)

  useEffect(() => {
    const on = () => setScale(fitScale())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  // A new item means a new subject: always start from how it reads in the list,
  // which is the view that decides whether a guest ever taps it at all.
  useEffect(() => { setView('list') }, [item?.id])

  const focus = useMemo(
    () => (item?.id ? { itemId: item.id, view, replay } : null),
    [item?.id, view, replay],
  )

  if (!item) return null
  const name = (ar ? item.nameAr : item.nameEn) || item.nameAr || item.nameEn || ''

  return (
    <Sheet
      open
      onClose={onClose}
      title={ar ? `${name}: كما يراه الضيف` : `${name}: as a guest sees it`}
      className="itemprev"
      footer={(
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {onEdit && (
            <button type="button" className="btn btn-primary grow" onClick={() => { onClose?.(); onEdit(item) }}>
              <Icon name="edit" size={16} /> {ar ? 'تعديل هذا الصنف' : 'Edit this item'}
            </button>
          )}
          <button type="button" className="btn btn-outline" onClick={() => setReplay((r) => r + 1)}>
            <Icon name="reload" size={16} /> {ar ? 'إعادة الحركة' : 'Replay'}
          </button>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            <Icon name="close" size={16} /> {ar ? 'إغلاق' : 'Close'}
          </button>
        </div>
      )}
    >
      <div className="itemprev-tabs" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            className={`chip ${view === v.id ? 'active' : ''}`}
            onClick={() => setView(v.id)}
          >
            {ar ? v.ar : v.en}
          </button>
        ))}
      </div>
      <div className="itemprev-frame">
        <MenuPreview
          slug={slug}
          override={EMPTY_OVERRIDE}
          mode="mobile"
          scale={scale}
          focus={focus}
        />
      </div>
      <p className="xs faint center" style={{ margin: 0 }}>
        {ar
          ? 'هذه القائمة الحقيقية داخل إطار جوال، والضغط هنا لا يضيف شيئاً لأي سلة'
          : 'This is the real menu inside a phone frame; nothing here touches a real cart'}
      </p>
    </Sheet>
  )
}
