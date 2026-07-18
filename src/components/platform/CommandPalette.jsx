// CommandPalette.jsx — Ctrl+K / Cmd+K quick-navigation palette for the platform
// console. Renders nothing until opened. Mount ONCE inside PlatformLayout.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'

// Static navigation targets across the platform console. Kept simple on purpose:
// jumping to a specific venue by name is NOT implemented here (see note in spec).
const TARGETS = [
  { to: '/platform', ar: 'النظرة العامة', kw: 'overview home نظرة رئيسية', icon: 'home' },
  { to: '/platform/venues', ar: 'المنشآت', kw: 'venues tenants stores منشآت', icon: 'store' },
  { to: '/platform/chat', ar: 'الدردشة', kw: 'chat messages دردشة رسائل', icon: 'mail' },
  { to: '/platform/issues', ar: 'التذاكر', kw: 'issues tickets تذاكر مشاكل', icon: 'warning' },
  { to: '/platform/analytics', ar: 'التحليلات', kw: 'analytics stats تحليلات', icon: 'chartBar' },
  { to: '/platform/billing', ar: 'الفوترة', kw: 'billing invoices فوترة', icon: 'wallet' },
  { to: '/platform/design', ar: 'التصميم', kw: 'design themes تصميم', icon: 'theater' },
  { to: '/platform/audit', ar: 'سجل التدقيق', kw: 'audit log تدقيق سجل', icon: 'notepad' },
  { to: '/platform/growth', ar: 'النمو', kw: 'growth نمو', icon: 'trending' },
  { to: '/platform/realtime', ar: 'الوقت الحقيقي', kw: 'realtime live وقت حقيقي', icon: 'zap' },
  { to: '/platform/subscriptions', ar: 'الاشتراكات', kw: 'subscriptions plans اشتراكات', icon: 'award' },
  { to: '/platform/settings', ar: 'الإعدادات', kw: 'settings preferences إعدادات', icon: 'settings' },
]

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  // Global keydown: Ctrl/Cmd+K toggles, Esc closes.
  useEffect(() => {
    function onKey(e) {
      const k = (e.key || '').toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (k === 'escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Reset + focus each time it opens.
  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
      const t = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
  }, [open])

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return TARGETS
    return TARGETS.filter(
      (t) => t.ar.toLowerCase().includes(term) || t.kw.toLowerCase().includes(term)
    )
  }, [q])

  useEffect(() => {
    if (active >= results.length) setActive(0)
  }, [results, active])

  if (!open) return null

  function go(t) {
    if (!t) return
    setOpen(false)
    navigate(t.to)
  }

  function onListKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(results[active])
    }
  }

  return (
    <div
      onMouseDown={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 'var(--sp-8) var(--sp-4)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onListKey}
        className="card shadow-md"
        style={{
          width: '100%',
          maxWidth: 560,
          marginTop: '8vh',
          overflow: 'hidden',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
      >
        <div className="row" style={{ padding: 'var(--sp-3)', borderBottom: '1px solid var(--border)', gap: 'var(--sp-2)' }}>
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="اذهب إلى… (اكتب للبحث)"
            style={{ border: 'none', background: 'transparent', flex: 1, outline: 'none' }}
            aria-label="بحث سريع"
          />
          <span className="xs muted" style={{ whiteSpace: 'nowrap' }}>Ctrl/Cmd+K</span>
        </div>

        <div style={{ maxHeight: 340, overflowY: 'auto', padding: 'var(--sp-2)' }}>
          {results.length === 0 ? (
            <div className="muted text-center" style={{ padding: 'var(--sp-4)' }}>
              لا نتائج مطابقة
            </div>
          ) : (
            results.map((t, i) => (
              <button
                key={t.to}
                type="button"
                onClick={() => go(t)}
                onMouseEnter={() => setActive(i)}
                className="row"
                style={{
                  width: '100%',
                  textAlign: 'start',
                  gap: 'var(--sp-3)',
                  padding: 'var(--sp-2) var(--sp-3)',
                  borderRadius: 'var(--r-md)',
                  border: 'none',
                  cursor: 'pointer',
                  background: i === active ? 'var(--surface-2)' : 'transparent',
                  color: 'var(--text)',
                }}
              >
                <Icon name={t.icon} size={16} />
                <span className="grow">{t.ar}</span>
                <span className="xs faint truncate" style={{ direction: 'ltr' }}>{t.to}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
