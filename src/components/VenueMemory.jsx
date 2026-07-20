// «ذاكرة المكان» — the recognition card a returning guest sees at the top of
// the menu.
//
// This component is deliberately dumb about truth: src/lib/venueMemory.js has
// already decided what may be said. Here we only decide how quietly to say it.
//
// Three rules shape the design:
//   1. ONE headline. The strongest line is the whole message; the rest are
//      support in a smaller voice. A list of six facts about a guest reads
//      like a dossier, not a greeting.
//   2. AT MOST ONE action. A card that asks for two things is a form.
//   3. ONCE PER SESSION. Being recognised twice in one sitting is the moment
//      warmth turns into a notification. Enforced with sessionStorage, before
//      the first paint, so it never flashes and disappears.
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import '../styles/venuememory.css'

const SEEN_PREFIX = 'rbt.vm.seen.'

function alreadyShown(key) {
  try { return sessionStorage.getItem(SEEN_PREFIX + key) === '1' } catch (_) { return false }
}
function markShown(key) {
  try { sessionStorage.setItem(SEEN_PREFIX + key, '1') } catch (_) { /* private mode — degrade to showing once per mount */ }
}

export default function VenueMemory({ lines, venueName = '', lang = 'ar', onAction, storageKey = 'default' }) {
  const ar = lang !== 'en'
  const list = Array.isArray(lines) ? lines.filter(Boolean) : []

  // Read the session flag ONCE, during the initial state computation, so a card
  // that was already shown never mounts visible for a frame.
  const [open, setOpen] = useState(() => list.length > 0 && !alreadyShown(storageKey))
  const [leaving, setLeaving] = useState(false)
  const closeTimer = useRef(null)

  useEffect(() => {
    if (open) markShown(storageKey)
  }, [open, storageKey])

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  if (!open || !list.length) return null

  const headline = list[0]
  const support = list.slice(1, 3)
  // The action belongs to whichever line earned it, strongest first.
  const actionLine = list.find((l) => l && l.action) || null
  const action = actionLine ? actionLine.action : null

  const textOf = (l) => (ar ? l.text : (l.textEn || l.text))

  const dismiss = () => {
    setLeaving(true)
    closeTimer.current = setTimeout(() => setOpen(false), 260)
  }

  const fire = () => {
    if (typeof onAction === 'function') {
      try { onAction(action, actionLine) } catch (_) { /* a host handler must never break the menu */ }
    }
    dismiss()
  }

  return (
    <section
      className={`vm-card ${leaving ? 'vm-leaving' : ''}`}
      dir={ar ? 'rtl' : 'ltr'}
      aria-label={ar ? 'ذاكرة المكان' : 'What we remember'}
    >
      <span className="vm-edge" aria-hidden="true" />

      <button type="button" className="vm-x" onClick={dismiss} aria-label={ar ? 'إخفاء' : 'Dismiss'}>
        <Icon name="close" size={15} strokeWidth={2.2} />
      </button>

      <div className="vm-body">
        {venueName ? (
          <p className="vm-eyebrow">{ar ? `${venueName} يتذكّرك` : `${venueName} remembers you`}</p>
        ) : null}

        <p className="vm-headline">{textOf(headline)}</p>

        {support.length ? (
          <ul className="vm-support">
            {support.map((l) => (
              <li key={l.id}>
                <span className="vm-dot" aria-hidden="true" />
                <span>{textOf(l)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {action ? (
          <button type="button" className="vm-action" onClick={fire}>
            <span>{ar ? (action.labelAr || 'اطلبه') : (action.labelEn || 'Order it')}</span>
            <Icon name={ar ? 'back' : 'next'} size={15} strokeWidth={2.2} />
          </button>
        ) : null}
      </div>
    </section>
  )
}
