// Public landing — fully CMS-driven (platformConfig/landing over
// src/lib/landingContent.js defaults). Section order & visibility, every text,
// bullet, tier and FAQ come from the merged content object; prices come from
// src/lib/plans.js unless a tier sets priceOverride (server stays the truth at
// checkout). Design: the existing glass/premium landing language (landing.css)
// + the lx-* additions appended to index.css (landing-cms v1 block).
import { useEffect, useState, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { BrandMark } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { Price } from '../components/Riyal.jsx'
import { db } from '../lib/firebase.js'
import { mergeLanding, watchLanding } from '../lib/landingContent.js'
import { PLANS, PLAN_PRICES, YEARLY_DISCOUNT } from '../lib/plans.js'
import '../landing.css'

const YEARLY_PCT = Math.round((1 - YEARLY_DISCOUNT) * 100)

// href-aware link: SPA routes via <Link>, anchors/external via <a>.
function Smart({ href, className, style, children, onClick }) {
  if (href && href.startsWith('/')) return <Link to={href} className={className} style={style} onClick={onClick}>{children}</Link>
  const ext = href && /^https?:/i.test(href)
  return <a href={href || '#'} className={className} style={style} onClick={onClick} {...(ext ? { target: '_blank', rel: 'noreferrer' } : {})}>{children}</a>
}

export default function Landing() {
  const { theme, toggleTheme } = useI18n()
  const { user, tenantId, loading } = useAuth()

  const [content, setContent] = useState(() => mergeLanding({}))
  const [annc, setAnnc] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showTop, setShowTop] = useState(false)

  useEffect(() => watchLanding(db, setContent), [])

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }),
      { threshold: 0.12 },
    )
    document.querySelectorAll('.rl .reveal:not(.in)').forEach((el) => io.observe(el))
    const onScroll = () => setShowTop(window.scrollY > 640)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { io.disconnect(); window.removeEventListener('scroll', onScroll) }
  }, [content])

  // Signed-in visitors are NOT auto-redirected — the landing stays browsable;
  // a slim banner offers the dashboard instead.
  const sessionTarget = !loading && user ? (tenantId ? '/admin' : '/onboarding') : ''

  const secEnabled = Object.fromEntries((content.sections || []).map((s) => [s.key, s.enabled !== false]))
  const flowKeys = (content.sections || []).filter((s) => s.enabled !== false && s.key !== 'announcement').map((s) => s.key)

  const navLinks = [
    ['#features', 'المزايا', secEnabled.features],
    ['#pricing', 'الباقات', secEnabled.pricing],
    ['#faq', 'الأسئلة', secEnabled.faq && content.faq.enabled],
  ].filter((l) => l[2])

  const RENDER = {
    hero: HeroSec,
    logos: LogosSec,
    features: FeaturesSec,
    showcase: ShowcaseSec,
    stats: StatsSec,
    pricing: PricingSec,
    faq: FaqSec,
    cta: CtaSec,
  }

  const accent = content.theme?.accent?.trim()
  const rootStyle = accent ? { '--brand': accent, '--brand-2': accent } : undefined
  const waNumber = String(content.whatsappFloat?.number || '').replace(/[^0-9]/g, '')

  return (
    <div className={`rl ${content.theme?.density === 'compact' ? 'lx-compact' : ''}`} dir="rtl" style={rootStyle}>
      {sessionTarget && (
        <div className="rl-session">
          <span>أنت مسجّل الدخول بالفعل</span>
          <Link to={sessionTarget} className="rl-btn" style={{ padding: '8px 16px' }}>{tenantId ? 'الدخول للوحتك' : 'أكمل إنشاء منشأتك'}</Link>
        </div>
      )}

      {secEnabled.announcement && content.announcement.enabled && annc && (
        <div className="rl-annc">
          <Icon name="sparkles" size={15} />
          {content.announcement.href
            ? <Smart href={content.announcement.href} style={{ color: '#fff', textDecoration: 'none' }}>{content.announcement.text}</Smart>
            : <span>{content.announcement.text}</span>}
          <button className="x" onClick={() => setAnnc(false)} aria-label="close"><Icon name="close" size={15} /></button>
        </div>
      )}

      <header className="rl-nav">
        <BrandMark />
        <nav className="links">
          {navLinks.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
        </nav>
        <div className="act">
          <button className="rl-icon-btn" onClick={toggleTheme} aria-label="theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} /></button>
          <Link to="/login" className="rl-btn ghost" style={{ padding: '9px 16px' }}>تسجيل الدخول</Link>
          <Link to="/signup" className="rl-btn" style={{ padding: '9px 18px' }}>إنشاء حساب</Link>
          <button className="rl-icon-btn rl-burger" onClick={() => setMenuOpen((v) => !v)} aria-label="menu"><Icon name={menuOpen ? 'close' : 'more'} /></button>
        </div>
      </header>
      <div className={`rl-mobnav ${menuOpen ? 'open' : ''}`}>
        {navLinks.map(([href, label]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
        {/* the header hides the login link on narrow phones — keep it reachable here */}
        <Link to="/login" style={{ padding: '13px 6px', color: 'var(--brand)', fontWeight: 700, textDecoration: 'none' }} onClick={() => setMenuOpen(false)}>تسجيل الدخول</Link>
      </div>

      {flowKeys.map((k) => {
        const Sec = RENDER[k]
        if (!Sec) return null
        if (k === 'logos' && !content.logos.enabled) return null
        if (k === 'stats' && !content.stats.enabled) return null
        if (k === 'faq' && !content.faq.enabled) return null
        return <Sec key={k} c={content} />
      })}

      <FooterSec c={content} />

      {content.whatsappFloat?.enabled && waNumber && (
        <a className="lx-wa" href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer" aria-label="WhatsApp">
          <Icon name="message" size={24} />
        </a>
      )}
      <button className={`rl-top ${showTop ? 'show' : ''}`} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="top"><Icon name="back" size={20} style={{ transform: 'rotate(90deg)' }} /></button>
    </div>
  )
}

/* ============================ sections ============================ */

function HeroSec({ c }) {
  const h = c.hero
  return (
    <section className="rl-hero lx-heroS">
      <div className="rl-hero-bg" aria-hidden="true" />
      <div className="rl-wrap lx-hero">
        <div className="lx-hero-txt">
          <span className="rl-kicker">نظام تشغيل مقهاك ومطعمك</span>
          <h1>{h.title} {h.titleAccent && <span className="em">{h.titleAccent}</span>}</h1>
          <p className="rl-lead">{h.subtitle}</p>
          <div className="rl-cta lx-start">
            <Smart href={h.ctaHref || '/signup'} className="rl-btn lg">{h.ctaText}</Smart>
            {h.secondaryText && <Smart href={h.secondaryHref || '#pricing'} className="rl-btn ghost lg">{h.secondaryText}</Smart>}
          </div>
          {(h.badges || []).length > 0 && (
            <div className="lx-badges">
              {h.badges.map((b) => <span key={b} className="lx-badge"><Icon name="check" size={13} className="ic" />{b}</span>)}
            </div>
          )}
        </div>
        <div className="lx-hero-media reveal">
          <div className="rl-frame"><CashierMock lang="ar" /></div>
        </div>
      </div>
    </section>
  )
}

function LogosSec({ c }) {
  const items = (c.logos.items || []).filter((it) => it?.name)
  if (!items.length) return null
  const strip = [...items, ...items] // duplicated for the seamless CSS loop
  return (
    <section className="rl-sec pad-sm rl-panel">
      <div className="rl-wrap">
        {c.logos.title && <p className="lx-logos-title reveal">{c.logos.title}</p>}
        <div className="lx-marquee" dir="ltr">
          <div className="lx-marquee-track">
            {strip.map((it, i) => <span key={i} className="lx-chip"><Icon name="store" size={14} className="ic" />{it.name}</span>)}
          </div>
        </div>
      </div>
    </section>
  )
}

function FeaturesSec({ c }) {
  const f = c.features
  return (
    <section id="features" className="rl-sec">
      <div className="rl-wrap">
        <div className="rl-head center reveal">
          <span className="rl-kicker">المزايا</span>
          <h2 className="rl-h2">{f.title}</h2>
          {f.subtitle && <p className="rl-lead">{f.subtitle}</p>}
        </div>
        <div className="rl-fgrid reveal">
          {(f.items || []).map((it, i) => (
            <div key={`${it.title}-${i}`} className="rl-feat">
              <div className="rl-feat-top">
                <div className="rl-fic"><Icon name={it.icon || 'star'} size={22} /></div>
                <span className="no">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <strong>{it.title}</strong>
              <p>{it.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const VISUALS = {
  menu: (props) => <ThemeSwap {...props} />,
  ops: (props) => <OrderBoardWin {...props} />,
  ai: (props) => <InventoryMock {...props} />,
  signage: (props) => <SignageMock {...props} />,
  flow: (props) => <FlowDiagram {...props} />,
}

function ShowcaseSec({ c }) {
  const items = Array.isArray(c.showcase) ? c.showcase : []
  return (
    <>
      {items.map((s, i) => {
        const Visual = VISUALS[s.visual]
        return (
          <section key={`${s.title}-${i}`} className={`rl-sec ${i % 2 === 0 ? 'rl-panel' : ''}`}>
            <div className={`rl-wrap rl-show ${s.flip ? 'rev' : ''} reveal`}>
              <div className="rl-show-txt">
                <span className="rl-kicker"><Icon name={s.icon || 'star'} size={14} /> {String(i + 1).padStart(2, '0')}</span>
                <h2 className="rl-h2">{s.title}</h2>
                {s.desc && <p className="rl-lead">{s.desc}</p>}
                {(s.bullets || []).map((b) => (
                  <div key={b} className="rl-check"><Icon name="check" size={20} className="ic" /><span>{b}</span></div>
                ))}
              </div>
              <div className="rl-show-media">
                {Visual ? <Visual lang="ar" /> : <div className="lx-icpanel"><Icon name={s.icon || 'star'} size={64} /></div>}
              </div>
            </div>
          </section>
        )
      })}
    </>
  )
}

function StatsSec({ c }) {
  return (
    <section className="rl-sec pad-sm">
      <div className="rl-wrap rl-stats reveal">
        {(c.stats.items || []).map((s, i) => (
          <div key={`${s.label}-${i}`} className="rl-stat"><div className="v num">{s.value}</div><div className="l">{s.label}</div></div>
        ))}
      </div>
    </section>
  )
}

function PricingSec({ c }) {
  const pr = c.pricing
  const [open, setOpen] = useState({})
  return (
    <section id="pricing" className="rl-sec rl-panel">
      <div className="rl-wrap">
        <div className="rl-head center reveal">
          <span className="rl-kicker">الباقات</span>
          <h2 className="rl-h2">{pr.title}</h2>
          {pr.subtitle && <p className="rl-lead">{pr.subtitle}</p>}
        </div>
        <div className="rl-plans reveal">
          {PLANS.map((p) => {
            const t = pr.tiers?.[p.id] || {}
            const price = Number.isFinite(Number(t.priceOverride)) && t.priceOverride !== null && t.priceOverride !== ''
              ? Number(t.priceOverride)
              : PLAN_PRICES[p.id]
            const yearly = Math.round(price * YEARLY_DISCOUNT)
            const extra = t.more || []
            const isOpen = !!open[p.id]
            return (
              <div key={p.id} className={`rl-plan ${t.highlight ? 'feat' : ''} ${t.glow ? 'lx-ent' : ''}`}>
                {t.badge && <span className="rl-plan-badge">{t.badge}</span>}
                {t.tagline && <span className="rl-plan-tag">{t.tagline}</span>}
                <h3>{p.ar}</h3>
                <div className="lx-price">
                  <Price value={price} lang="ar" symbolSize="0.62em" />
                  <span className="per">/ شهرياً</span>
                </div>
                <div className="lx-yearly">
                  سنوياً: <Price value={yearly} lang="ar" symbolSize="0.8em" /> شهرياً
                  <span className="save num">وفّر {YEARLY_PCT}%</span>
                </div>
                <ul>
                  {(t.bullets || []).map((it) => <li key={it}><Icon name="check" size={16} className="ic" /> {it}</li>)}
                  {isOpen && extra.map((it) => <li key={it}><Icon name="add" size={16} className="ic" /> {it}</li>)}
                </ul>
                {extra.length > 0 && (
                  <button className="lx-more" onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}>
                    {isOpen ? 'عرض أقل' : `عرض المزيد (${extra.length})`} <Icon name={isOpen ? 'minus' : 'add'} size={14} />
                  </button>
                )}
                <Link to="/signup" className={`rl-btn ${t.highlight ? '' : 'ghost'} block`}>ابدأ الآن</Link>
              </div>
            )
          })}
        </div>
        {pr.note && <p className="rl-fineprint reveal">{pr.note}</p>}
      </div>
    </section>
  )
}

// Deliberately accordion-free: a scannable two-column Q&A list.
function FaqSec({ c }) {
  return (
    <section id="faq" className="rl-sec">
      <div className="rl-wrap">
        <div className="rl-head center reveal">
          <span className="rl-kicker">الأسئلة الشائعة</span>
          <h2 className="rl-h2">أسئلة يكثر طرحها</h2>
        </div>
        <div className="lx-faq2 reveal">
          {(c.faq.items || []).map((f, i) => (
            <div key={`${f.q}-${i}`} className="lx-faq-item">
              <strong>{f.q}</strong>
              <p>{f.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function CtaSec({ c }) {
  return (
    <section className="rl-sec">
      <div className="rl-wrap">
        <div className="rl-ctaband reveal">
          <h2>{c.cta.title}</h2>
          <p>{c.cta.subtitle}</p>
          <Link to="/signup" className="rl-btn lg">{c.cta.buttonText}</Link>
        </div>
      </div>
    </section>
  )
}

/* ============================ footer ============================ */

// Minimal inline glyphs for networks Icon.jsx doesn't carry (rules: SVG only).
function SocialGlyph({ kind }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  if (kind === 'x') return <svg {...common}><path d="M5 4l14 16M19 4L5 20" /></svg>
  if (kind === 'instagram') return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" /></svg>
  if (kind === 'tiktok') return <svg {...common}><path d="M14 4v9.5a4 4 0 1 1-3.2-3.92" /><path d="M14 5.5c.9 1.9 2.6 3.1 4.8 3.3" /></svg>
  return null
}

function FooterSec({ c }) {
  const f = c.footer || {}
  const socials = f.socials || {}
  const waDigits = String(socials.whatsapp || '').replace(/[^0-9]/g, '')
  const socialLinks = [
    socials.whatsapp && { k: 'whatsapp', href: `https://wa.me/${waDigits}`, icon: 'message' },
    socials.x && { k: 'x', href: socials.x },
    socials.instagram && { k: 'instagram', href: socials.instagram },
    socials.tiktok && { k: 'tiktok', href: socials.tiktok },
    socials.email && { k: 'email', href: `mailto:${socials.email}`, icon: 'mail' },
  ].filter(Boolean)
  return (
    <footer className="rl-foot">
      <div className="rl-wrap">
        <div className="rl-foot-grid">
          <div>
            <BrandMark />
            {f.about && <p style={{ color: 'var(--ink-2)', maxWidth: 320, marginTop: 10, fontSize: '0.9rem', lineHeight: 1.7 }}>{f.about}</p>}
            {socialLinks.length > 0 && (
              <div className="lx-social">
                {socialLinks.map((s) => (
                  <a key={s.k} href={s.href} target="_blank" rel="noreferrer" aria-label={s.k}>
                    {s.icon ? <Icon name={s.icon} size={16} /> : <SocialGlyph kind={s.k} />}
                  </a>
                ))}
              </div>
            )}
          </div>
          <div>
            <strong>روابط</strong>
            {(f.links || []).map((l, i) => <Smart key={`${l.href}-${i}`} href={l.href}>{l.label}</Smart>)}
          </div>
          <div>
            <strong>ابدأ</strong>
            <Link to="/signup">إنشاء حساب</Link>
            <Link to="/login">تسجيل الدخول</Link>
          </div>
          <div>
            <strong>قانوني</strong>
            <Link to="/legal/terms">الشروط والأحكام</Link>
            <Link to="/legal/privacy">سياسة الخصوصية</Link>
            <Link to="/legal/refund">الاسترجاع</Link>
          </div>
        </div>
        {f.showPayments !== false && (
          <div className="lx-pay">
            <span className="lbl">وسائل دفع مقبولة:</span>
            {['مدى', 'Visa', 'Mastercard', 'Apple Pay'].map((p) => <span key={p} className="chip">{p}</span>)}
          </div>
        )}
        <p className="rl-foot-copy">© 2026 rbt360. جميع الحقوق محفوظة.</p>
      </div>
    </footer>
  )
}

/* ==================== live product mockups (kept) ==================== */

function FlowDiagram({ lang }) {
  const ar = lang === 'ar'
  const nodes = [
    { icon: 'user', ar: 'الضيف', en: 'Guest' },
    { icon: 'qr', ar: 'مسح QR', en: 'Scan QR' },
    { icon: 'cart', ar: 'الطلب', en: 'Order' },
    { icon: 'cashier', ar: 'الكاشير والمطبخ', en: 'Cashier & kitchen' },
    { icon: 'check', ar: 'جاهز', en: 'Ready' },
  ]
  return (
    <div className="r-flow">
      {nodes.map((n, i) => (
        <Fragment key={n.en}>
          <div className="r-node"><div className="ic"><Icon name={n.icon} size={20} /></div><strong>{ar ? n.ar : n.en}</strong></div>
          {i < nodes.length - 1 && <div className="r-link"><Icon name={ar ? 'back' : 'next'} size={22} /></div>}
        </Fragment>
      ))}
    </div>
  )
}

function OrderBoardWin({ lang }) {
  const ar = lang === 'ar'
  const cols = [
    { h: ar ? 'جديد' : 'New', tk: [[ar ? 'طاولة 5' : 'Table 5', '#142'], [ar ? 'سفري' : 'Takeaway', '#143']] },
    { h: ar ? 'تحضير' : 'Prep', tk: [[ar ? 'طاولة 2' : 'Table 2', '#141']] },
    { h: ar ? 'جاهز' : 'Ready', tk: [[ar ? 'طاولة 8' : 'Table 8', '#139']] },
  ]
  return (
    <div className="r-win">
      <div className="r-win-bar"><span className="d" /><span className="d" /><span className="d" /><span className="t">{ar ? 'الكاشير · مباشر' : 'Cashier · live'}</span></div>
      <div className="r-win-body">
        {cols.map((c) => (
          <div key={c.h}>
            <div className="r-col-h"><span>{c.h}</span><span>{c.tk.length}</span></div>
            {c.tk.map((tk, i) => (
              <div key={i} className="r-tk">
                <div style={{ fontSize: 11, fontWeight: 800 }}>{tk[1]}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{tk[0]}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// Cashier POS recreation — catalog tiles + live order ticket.
function CashierMock({ lang }) {
  const ar = lang === 'ar'
  const tiles = [
    [ar ? 'سبانش لاتيه' : 'Spanish Latte', '15', 'coffee', true],
    [ar ? 'موهيتو' : 'Mojito', '18', 'coffee', false],
    [ar ? 'فلات وايت' : 'Flat White', '14', 'coffee', false],
    [ar ? 'تشيز كيك' : 'Cheesecake', '22', 'cake', false],
    [ar ? 'كرواسون' : 'Croissant', '12', 'cake', false],
    [ar ? 'أمريكانو' : 'Americano', '11', 'coffee', false],
  ]
  const order = [[ar ? 'سبانش لاتيه' : 'Spanish Latte', 2, '30'], [ar ? 'تشيز كيك' : 'Cheesecake', 1, '22']]
  return (
    <div className="r-win pw">
      <div className="r-win-bar"><span className="d" /><span className="d" /><span className="d" /><span className="t">{ar ? 'الكاشير · نقطة البيع' : 'Cashier · POS'}</span></div>
      <div className="pw-body">
        <div className="pw-cat">
          <div className="pw-chips"><span className="on">{ar ? 'الكل' : 'All'}</span><span>{ar ? 'قهوة' : 'Coffee'}</span><span>{ar ? 'حلى' : 'Sweets'}</span></div>
          <div className="pw-grid">
            {tiles.map((it) => (
              <div key={it[0]} className={`pw-tile${it[3] ? ' hot' : ''}`}>
                <span className="pw-thumb"><Icon name={it[2]} size={16} /></span>
                <span className="pw-tt">{it[0]}</span>
                <span className="pw-tp"><Price value={it[1]} lang={lang} symbolSize="0.8em" /></span>
              </div>
            ))}
          </div>
        </div>
        <div className="pw-ord">
          <div className="pw-ord-h"><Icon name="user" size={13} /><span>{ar ? 'طاولة 7' : 'Table 7'}</span></div>
          {order.map((o) => (
            <div key={o[0]} className="pw-ord-row">
              <span className="q">{o[1]}×</span>
              <span className="n">{o[0]}</span>
              <span className="p"><Price value={o[2]} lang={lang} symbolSize="0.8em" /></span>
            </div>
          ))}
          <div className="pw-ord-total"><span>{ar ? 'الإجمالي' : 'Total'}</span><strong><Price value={52} lang={lang} symbolSize="0.8em" /></strong></div>
          <div className="pw-pay"><span>{ar ? 'دفع' : 'Pay'}</span></div>
        </div>
      </div>
    </div>
  )
}

// Inventory recreation — stock table + AI assistant bubble.
function InventoryMock({ lang }) {
  const ar = lang === 'ar'
  const rows = [
    [ar ? 'حليب طازج' : 'Fresh milk', '4.2', ar ? 'لتر' : 'L', 'low'],
    [ar ? 'حبوب بن' : 'Coffee beans', '11.5', ar ? 'كجم' : 'kg', 'ok'],
    [ar ? 'شوكولاتة' : 'Chocolate', '2.0', ar ? 'كجم' : 'kg', 'low'],
    [ar ? 'سكر' : 'Sugar', '18', ar ? 'كجم' : 'kg', 'ok'],
  ]
  return (
    <div className="r-win iv">
      <div className="r-win-bar"><span className="d" /><span className="d" /><span className="d" /><span className="t">{ar ? 'المخزون · المواد الخام' : 'Inventory · materials'}</span></div>
      <div className="iv-body">
        <div className="iv-table">
          {rows.map((r) => (
            <div key={r[0]} className="iv-row">
              <span className="iv-n">{r[0]}</span>
              <span className="iv-q num">{r[1]} <i>{r[2]}</i></span>
              <span className={`iv-badge ${r[3]}`}>{r[3] === 'low' ? (ar ? 'منخفض' : 'Low') : (ar ? 'متوفر' : 'OK')}</span>
            </div>
          ))}
        </div>
        <div className="iv-ai">
          <span className="iv-ai-ic"><Icon name="sparkles" size={14} /></span>
          <div className="iv-ai-txt">
            <strong>{ar ? 'المساعد الذكي' : 'AI assistant'}</strong>
            <p>{ar ? 'الحليب يكفي ليومين حسب مبيعاتك. أطلب 20 لتر من المورّد؟' : 'Milk lasts ~2 days at your pace. Order 20 L from the supplier?'}</p>
            <span className="iv-ai-do">{ar ? 'نفّذ الطلب' : 'Place order'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Signage recreation — TV frame with a live menu slide + music bar.
function SignageMock({ lang }) {
  const ar = lang === 'ar'
  return (
    <div className="tv">
      <div className="tv-screen">
        <div className="tv-slide">
          <span className="tv-kick">{ar ? 'الأكثر طلباً اليوم' : "Today's top pick"}</span>
          <strong className="tv-name">{ar ? 'سبانش لاتيه' : 'Spanish Latte'}</strong>
          <div className="tv-price"><Price value={15} lang={lang} symbolSize="0.7em" /></div>
          <span className="tv-qr"><Icon name="qr" size={26} /></span>
        </div>
        <div className="tv-music">
          <Icon name="play" size={13} />
          <span className="tv-eq"><i /><i /><i /><i /></span>
          <span className="tv-track">{ar ? 'قائمة صباحية · Lofi' : 'Morning list · Lofi'}</span>
          <Icon name="sound" size={13} style={{ marginInlineStart: 'auto' }} />
        </div>
      </div>
      <span className="tv-stand" />
    </div>
  )
}

// Real menu skins (ids + colors pulled from src/lib/skins.js) — the live
// theme-switcher cycles through them to show real customization, not a fake.
const SKINS = [
  { id: 'lagoon', ar: 'بحيرة', brand: '#0E7490', accent: '#14B8A6', bg: '#eef9fb', surface: '#ffffff', ink: '#0b2a30' },
  { id: 'golden', ar: 'ذهبي', brand: '#D99400', accent: '#C8102E', bg: '#fffaef', surface: '#ffffff', ink: '#2a2412' },
  { id: 'blossom', ar: 'زهر', brand: '#DB2777', accent: '#7C3AED', bg: '#fdf1f7', surface: '#ffffff', ink: '#2a1220' },
  { id: 'forest', ar: 'غابة', brand: '#0B6B3A', accent: '#16A34A', bg: '#eef9f1', surface: '#ffffff', ink: '#0c2417' },
  { id: 'cobalt', ar: 'كوبالت', brand: '#2563EB', accent: '#0EA5E9', bg: '#eef4ff', surface: '#ffffff', ink: '#0f1e3a' },
  { id: 'midnight', ar: 'ليلي', brand: '#22D3EE', accent: '#6366F1', bg: '#0b1220', surface: '#141d31', ink: '#eaf2ff', dark: true },
  { id: 'noir', ar: 'نوار', brand: '#E5C07B', accent: '#c98b3a', bg: '#0c0c0d', surface: '#171716', ink: '#f4efe4', dark: true },
  { id: 'crimson', ar: 'قرمزي', brand: '#E11D48', accent: '#312E81', bg: '#fff3f4', surface: '#ffffff', ink: '#2a1216' },
]

// Live theme switcher — a menu preview that reskins through real skins.
function ThemeSwap({ lang }) {
  const ar = lang === 'ar'
  const [i, setI] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setI((v) => (v + 1) % SKINS.length), 2600)
    return () => clearInterval(id)
  }, [])
  const s = SKINS[i]
  const style = { '--tsw-brand': s.brand, '--tsw-accent': s.accent, '--tsw-bg': s.bg, '--tsw-surface': s.surface, '--tsw-ink': s.ink }
  const items = [[ar ? 'سبانش لاتيه' : 'Spanish Latte', '15'], [ar ? 'موهيتو' : 'Mojito', '18'], [ar ? 'تشيز كيك' : 'Cheesecake', '22']]
  return (
    <div className="tsw">
      <div className="tsw-phone" style={style}>
        <div className="tsw-screen">
          <div className="tsw-hd">
            <span className="tsw-logo"><Icon name="coffee" size={13} /></span>
            <strong>{ar ? 'كافيه نيمة' : 'Neema Café'}</strong>
            <span className="tsw-name">{ar ? s.ar : s.id}</span>
          </div>
          <div className="tsw-hero"><span>{ar ? 'الأكثر طلباً' : 'Top pick'}</span><strong>{ar ? 'سبانش لاتيه' : 'Spanish Latte'}</strong></div>
          <div className="tsw-list">
            {items.map((it) => (
              <div key={it[0]} className="tsw-item">
                <span className="tsw-th"><Icon name="coffee" size={13} /></span>
                <span className="tsw-in">{it[0]}</span>
                <span className="tsw-ip"><Price value={it[1]} lang={lang} symbolSize="0.8em" /></span>
              </div>
            ))}
          </div>
          <div className="tsw-cta">{ar ? 'أضف للسلة' : 'Add to cart'}</div>
        </div>
      </div>
      <div className="tsw-dots">
        {SKINS.map((sk, idx) => (
          <button key={sk.id} className={`tsw-dot${idx === i ? ' on' : ''}`} style={{ background: sk.brand }} onClick={() => setI(idx)} aria-label={sk.id} />
        ))}
      </div>
    </div>
  )
}
