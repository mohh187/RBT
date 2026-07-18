import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { Spinner } from './ui.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { CAP } from '../lib/permissions.js'
import { menuUrl } from '../lib/qr.js'
import { PAGE_INDEX, ACTION_INDEX, searchLive, normalizeAr } from '../lib/globalSearch.js'

// Live result groups, in display order. `cap` gates BOTH the fetch and the
// group render — mirrors the caps guarding the destination routes.
const LIVE_KINDS = [
  { kind: 'item', icon: 'menu', ar: 'الأصناف', en: 'Items', cap: CAP.MANAGE_MENU },
  { kind: 'category', icon: 'categories', ar: 'التصنيفات', en: 'Categories', cap: CAP.MANAGE_MENU },
  { kind: 'customer', icon: 'customers', ar: 'العملاء', en: 'Customers', cap: CAP.VIEW_CUSTOMERS },
  { kind: 'staff', icon: 'staff', ar: 'الموظفون', en: 'Staff', cap: CAP.ATTENDANCE },
  { kind: 'campaign', icon: 'bellRing', ar: 'الحملات', en: 'Campaigns', cap: CAP.MANAGE_CAMPAIGNS },
  { kind: 'order', icon: 'orders', ar: 'الطلبات', en: 'Orders', cap: CAP.TAKE_ORDERS },
]

// Command-palette style global search. The PARENT owns the open state and any
// global shortcut wiring; this component only handles keys inside its input.
export default function GlobalSearch({ open, onClose }) {
  const { lang } = useI18n()
  const { tenant, tenantId, can } = useAuth()
  const navigate = useNavigate()
  const ar = lang === 'ar'

  const [q, setQ] = useState('')
  const [live, setLive] = useState([])
  const [pending, setPending] = useState(false)
  const [active, setActive] = useState(0)
  const seq = useRef(0)
  const inputRef = useRef(null)

  // Same visibility rule AdminLayout applies to its nav entries.
  const allowed = (e) => (!e.cap || can(e.cap)) && (!e.anyOf || e.anyOf.some((c) => can(c)))

  // Reset on every open (Sheet unmounts its children when closed).
  useEffect(() => {
    if (!open) return
    setQ('')
    setLive([])
    setPending(false)
    setActive(0)
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open])

  // Debounced live Firestore search (skipped under 2 chars).
  useEffect(() => {
    if (!open) return
    const term = q.trim()
    const my = ++seq.current
    if (term.length < 2) {
      setLive([])
      setPending(false)
      return
    }
    setPending(true)
    const t = setTimeout(() => {
      const kinds = LIVE_KINDS.filter((g) => can(g.cap)).map((g) => g.kind)
      searchLive(tenantId, term, { kinds })
        .then((rows) => {
          if (seq.current !== my) return
          setLive(rows || [])
          setPending(false)
        })
        .catch(() => {
          if (seq.current !== my) return
          setLive([])
          setPending(false)
        })
    }, 250)
    return () => clearTimeout(t)
  }, [open, q, tenantId])

  const qn = normalizeAr(q)
  const matches = (e) =>
    !qn ||
    normalizeAr(e.ar).includes(qn) ||
    normalizeAr(e.en).includes(qn) ||
    (e.keywords || []).some((k) => normalizeAr(k).includes(qn))

  const pages = PAGE_INDEX.filter(allowed).filter(matches)
  const actions = ACTION_INDEX.filter(allowed).filter(matches)

  // Build render sections + the flat keyboard-navigation list in one pass.
  const sections = []
  const flat = []
  const addSection = (titleAr, titleEn, rows) => {
    if (!rows.length) return
    const withIdx = rows.map((r) => {
      const i = flat.length
      flat.push(r)
      return { r, i }
    })
    sections.push({ titleAr, titleEn, rows: withIdx })
  }
  addSection('الصفحات والأقسام', 'Pages & sections', pages)
  addSection('إجراءات سريعة', 'Quick actions', actions)
  for (const g of LIVE_KINDS) {
    addSection(g.ar, g.en, live.filter((x) => x.kind === g.kind).map((x) => ({ ...x, icon: x.icon || g.icon })))
  }

  useEffect(() => {
    setActive(0)
  }, [q, live.length])

  const openResult = (r) => {
    if (!r) return
    if (r.kind === 'menu-preview') {
      if (tenant?.slug) window.open(menuUrl(tenant.slug), '_blank', 'noopener')
      onClose?.()
      return
    }
    if (r.to) {
      navigate(r.to)
      onClose?.()
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      openResult(flat[active] || flat[0])
    } else if (e.key === 'Escape') {
      onClose?.()
    }
  }

  const labelOf = (r) => {
    if (r.ar != null || r.en != null) return ar ? r.ar : r.en
    if (!ar && r.labelEn) return r.labelEn
    return r.label
  }

  const showEmpty = q.trim().length >= 2 && !pending && !sections.length

  return (
    <Sheet open={open} onClose={onClose} title={ar ? 'البحث الشامل' : 'Global search'} tall>
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <input
          ref={inputRef}
          className="input"
          value={q}
          autoFocus
          dir="auto"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={ar
            ? 'ابحث عن أي شيء… صفحة، صنف، عميل، طلب، حملة'
            : 'Search anything… a page, item, customer, order, campaign'}
          aria-label={ar ? 'البحث الشامل' : 'Global search'}
        />
        {sections.map((s) => (
          <div key={s.titleEn} className="stack" style={{ gap: 'var(--sp-1)' }}>
            <div className="xs faint bold" style={{ paddingInlineStart: 4 }}>{ar ? s.titleAr : s.titleEn}</div>
            {s.rows.map(({ r, i }) => (
              <button
                key={i}
                type="button"
                className="list-row"
                data-active={i === active ? 'true' : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => openResult(r)}
                style={{
                  width: '100%',
                  textAlign: 'start',
                  borderRadius: 10,
                  background: i === active ? 'var(--surface-2)' : undefined,
                }}
              >
                <Icon name={r.icon || 'search'} size={18} />
                <span className="bold small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {labelOf(r)}
                </span>
                <span className="grow" />
                {r.meta ? <span className="xs faint" dir="auto">{r.meta}</span> : null}
              </button>
            ))}
          </div>
        ))}
        {pending && <Spinner />}
        {showEmpty && (
          <p className="small faint" style={{ textAlign: 'center', padding: 'var(--sp-4) 0' }}>
            {ar ? 'لا نتائج مطابقة' : 'No matching results'}
          </p>
        )}
      </div>
    </Sheet>
  )
}
