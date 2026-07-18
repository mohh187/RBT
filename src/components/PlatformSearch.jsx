// PlatformSearch.jsx — platform-wide search sheet (Ctrl/Cmd+K) for the console.
// Searches a static index of every /platform screen (Arabic + English keywords)
// plus live data: venues by name/slug, custom domains by host, open support
// tickets by title/venue. Live sources are fetched one-shot and cached 60s.
// Open/close state + the Ctrl+K listener live in PlatformLayout (the owner).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { watchAllTenants, watchIssues } from '../lib/platform.js'
import { watchDomains } from '../lib/platformDomains.js'

// ---------- static page index (every /platform route) ----------
const PAGES = [
  { to: '/platform', title: 'الرئيسية', kw: 'overview home dashboard نظرة عامة رئيسية لوحة', icon: 'home' },
  { to: '/platform/realtime', title: 'البث المباشر', kw: 'realtime live مباشر لحظي بث', icon: 'zap' },
  { to: '/platform/analytics', title: 'التحليلات', kw: 'analytics stats reports تحليلات إحصاءات تقارير', icon: 'trending' },
  { to: '/platform/insights', title: 'الرؤى', kw: 'insights رؤى تحليلات متعمقة', icon: 'chartBar' },
  { to: '/platform/venues', title: 'المنشآت', kw: 'venues tenants stores منشآت مقاهي مطاعم متاجر', icon: 'store' },
  { to: '/platform/segments', title: 'الشرائح', kw: 'segments targeting شرائح استهداف', icon: 'customers' },
  { to: '/platform/domains', title: 'النطاقات', kw: 'domains dns hostname نطاقات دومين', icon: 'pin' },
  { to: '/platform/activity', title: 'الأنشطة', kw: 'activity feed events نشاط أنشطة أحداث', icon: 'bellRing' },
  { to: '/platform/subscriptions', title: 'الاشتراكات', kw: 'subscriptions اشتراكات باقات', icon: 'wallet' },
  { to: '/platform/billing', title: 'الفواتير', kw: 'billing invoices payments فوترة فواتير مدفوعات', icon: 'receipt' },
  { to: '/platform/plans', title: 'محرر الخطط', kw: 'plans pricing editor خطط باقات أسعار محرر', icon: 'layers' },
  { to: '/platform/growth', title: 'النمو', kw: 'growth onboarding نمو تهيئة', icon: 'award' },
  { to: '/platform/chat', title: 'المحادثات', kw: 'chat messages محادثات دردشة رسائل', icon: 'mail' },
  { to: '/platform/issues', title: 'التذاكر', kw: 'issues tickets support تذاكر مشاكل شكاوى', icon: 'warning' },
  { to: '/platform/broadcast', title: 'التعميمات', kw: 'broadcast announcement بث إعلان تعميم تعميمات', icon: 'sound' },
  { to: '/platform/support', title: 'أدوات الدعم', kw: 'support tools دعم أدوات صيانة', icon: 'wrench' },
  { to: '/platform/assistant', title: 'المساعد الذكي', kw: 'assistant ai مساعد ذكاء اصطناعي', icon: 'sparkles' },
  { to: '/platform/audit', title: 'المراقبة', kw: 'audit log monitoring مراقبة تدقيق سجل', icon: 'notepad' },
  { to: '/platform/roles', title: 'الأدوار', kw: 'roles admins permissions أدوار صلاحيات مشرفين', icon: 'key' },
  { to: '/platform/settings', title: 'الإعدادات', kw: 'settings preferences إعدادات ضبط', icon: 'settings' },
  { to: '/platform/compliance', title: 'الامتثال', kw: 'compliance governance امتثال حوكمة', icon: 'scale' },
  { to: '/platform/legal', title: 'المحرر القانوني', kw: 'legal terms privacy policies قانوني سياسات شروط خصوصية', icon: 'file' },
  { to: '/platform/design-tools', title: 'أدوات التصميم', kw: 'design tools أدوات تصميم', icon: 'penLine' },
  { to: '/platform/design', title: 'التصميم', kw: 'design themes appearance تصميم مظهر ثيم سمات', icon: 'image' },
]

// ---------- live sources, one-shot + 60s module cache ----------
const CACHE_MS = 60_000
let liveCache = { at: 0, venues: [], domains: [], issues: [] }

// Take the first emission of a watcher, then unsubscribe.
function oneShot(subscribe) {
  return new Promise((resolve) => {
    let done = false
    const stop = subscribe((rows) => {
      if (done) return
      done = true
      resolve(Array.isArray(rows) ? rows : [])
      queueMicrotask(() => { try { stop?.() } catch { /* already stopped */ } })
    })
  })
}

async function loadLive() {
  if (Date.now() - liveCache.at < CACHE_MS) return liveCache
  const [venues, domains, issues] = await Promise.all([
    oneShot((cb) => watchAllTenants(cb)),
    oneShot((cb) => watchDomains(cb)),
    oneShot((cb) => watchIssues(cb, { max: 100 })),
  ])
  liveCache = { at: Date.now(), venues, domains, issues: issues.filter((i) => i.status === 'open') }
  return liveCache
}

const MAX_PER_GROUP = 8

export default function PlatformSearch({ open, onClose }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [live, setLive] = useState(liveCache)
  const inputRef = useRef(null)

  // Reset + focus + refresh live data each time the sheet opens.
  useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
    let on = true
    loadLive().then((d) => { if (on) setLive(d) })
    const t = setTimeout(() => inputRef.current?.focus(), 60)
    return () => { on = false; clearTimeout(t) }
  }, [open])

  const { groups, flat } = useMemo(() => {
    const term = q.trim().toLowerCase()
    const hit = (...parts) => parts.some((p) => String(p || '').toLowerCase().includes(term))
    const out = []

    const pages = term ? PAGES.filter((p) => hit(p.title, p.kw)) : PAGES
    if (pages.length) {
      out.push({ title: 'الصفحات', items: pages.map((p) => ({ key: 'page:' + p.to, icon: p.icon, title: p.title, sub: p.to, to: p.to })) })
    }
    if (term) {
      const venues = live.venues.filter((v) => hit(v.name, v.slug)).slice(0, MAX_PER_GROUP)
      if (venues.length) {
        out.push({ title: 'المنشآت', items: venues.map((v) => ({ key: 'venue:' + v.id, icon: 'store', title: v.name || v.slug || v.id, sub: v.slug ? '/' + v.slug : '', to: `/platform/venues/${v.id}` })) })
      }
      const domains = live.domains.filter((d) => hit(d.id, d.slug)).slice(0, MAX_PER_GROUP)
      if (domains.length) {
        out.push({ title: 'النطاقات', items: domains.map((d) => ({ key: 'domain:' + d.id, icon: 'pin', title: d.id, sub: d.status === 'active' ? 'مفعّل' : 'قيد التفعيل', to: '/platform/domains' })) })
      }
      const issues = live.issues.filter((i) => hit(i.title, i.tenantName)).slice(0, MAX_PER_GROUP)
      if (issues.length) {
        out.push({ title: 'تذاكر مفتوحة', items: issues.map((i) => ({ key: 'issue:' + i.id, icon: 'warning', title: i.title || 'بدون عنوان', sub: i.tenantName || '', to: '/platform/issues' })) })
      }
    }
    // Flat index across groups for keyboard navigation.
    let n = 0
    out.forEach((g) => g.items.forEach((it) => { it.i = n; n += 1 }))
    return { groups: out, flat: out.flatMap((g) => g.items) }
  }, [q, live])

  useEffect(() => { if (active >= flat.length) setActive(0) }, [flat, active])

  const go = (item) => {
    if (!item) return
    onClose?.()
    navigate(item.to)
  }

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(flat[active])
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="بحث في المنصة" tall>
      <div className="stack" style={{ gap: 'var(--sp-3)' }} onKeyDown={onKey}>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            className="input grow"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث عن صفحة، منشأة، نطاق، أو تذكرة…"
            aria-label="بحث في المنصة"
          />
          <span className="xs muted" style={{ whiteSpace: 'nowrap', direction: 'ltr' }}>Ctrl+K</span>
        </div>

        {flat.length === 0 ? (
          <p className="muted text-center" style={{ padding: 'var(--sp-4)' }}>لا نتائج مطابقة</p>
        ) : (
          groups.map((g) => (
            <div key={g.title} className="stack" style={{ gap: 2 }}>
              <div className="xs faint bold" style={{ padding: '2px 4px' }}>{g.title}</div>
              {g.items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  className="row"
                  onClick={() => go(it)}
                  onMouseEnter={() => setActive(it.i)}
                  aria-selected={it.i === active}
                  style={{
                    width: '100%',
                    textAlign: 'start',
                    gap: 'var(--sp-3)',
                    padding: 'var(--sp-2) var(--sp-3)',
                    borderRadius: 'var(--r-md)',
                    border: 'none',
                    cursor: 'pointer',
                    background: it.i === active ? 'var(--surface-2)' : 'transparent',
                    color: 'var(--text)',
                  }}
                >
                  <Icon name={it.icon} size={16} />
                  <span className="grow truncate">{it.title}</span>
                  {it.sub ? <span className="xs faint truncate" style={{ direction: 'ltr', maxWidth: '45%' }}>{it.sub}</span> : null}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </Sheet>
  )
}
