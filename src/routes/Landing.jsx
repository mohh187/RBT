// Public landing — CMS-driven copy over LIVE pricing.
//
// COPY comes from platformConfig/landing merged over src/lib/landingContent.js
// (section order, visibility, every headline, bullet, tier blurb and FAQ).
//
// PRICES come from platformConfig/plans — the SAME document the monthly
// billing cron and the quotation builder read. The page used to print a second
// table out of src/lib/plans.js, which is how a landing ends up advertising
// 549 while the invoice charges 899. There is now one price list.
//
// LEGAL IDENTITY in the footer comes from src/lib/platformSeller.js, the
// mirror of the constant stamped onto every tax invoice we issue. Guarded
// against drift by scripts/guard.mjs.
//
// DESIGN: see landing.css. The short version — the brand gradient signs, it
// does not decorate; one action colour carries every conversion button.
import { useEffect, useState, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import BrandMark, { RbtMark, RbtTagline } from '../components/BrandMark.jsx'
import ContainerScroll from '../components/ContainerScroll.jsx'
import Icon from '../components/Icon.jsx'
import { Price } from '../components/Riyal.jsx'
import { db } from '../lib/firebase.js'
import { mergeLanding, watchLanding } from '../lib/landingContent.js'
import { PLANS } from '../lib/plans.js'
import { PLATFORM_SELLER, SELLER_ADDRESS_AR, SELLER_CONTACT } from '../lib/platformSeller.js'
import { normalizePlanConfig, promoOf, watchPricing, yearlyTotal } from '../lib/platformPricing.js'
import '../landing.css'

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
  // The live price list. Seeded with the shipped fallbacks so the pricing
  // section paints real numbers on the first frame instead of dashes.
  const [pricing, setPricing] = useState(() => normalizePlanConfig(null))
  const [annc, setAnnc] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showTop, setShowTop] = useState(false)

  useEffect(() => watchLanding(db, setContent), [])
  useEffect(() => watchPricing(setPricing), [])

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
    reveal: RevealSec,
    features: FeaturesSec,
    showcase: ShowcaseSec,
    stats: StatsSec,
    pricing: PricingSec,
    faq: FaqSec,
    cta: CtaSec,
  }

  const accent = content.theme?.accent?.trim()
  // The studio may override the action colour. It maps to --act alone: the
  // gradient stays the logo's, and every conversion button on the page moves
  // together rather than one of them drifting.
  const rootStyle = accent ? { '--act': accent, '--act-hover': accent } : undefined
  const waNumber = String(content.whatsappFloat?.number || '').replace(/[^0-9]/g, '')

  return (
    <div className={`rl ${content.theme?.density === 'compact' ? 'lx-compact' : ''}`} dir="rtl" style={rootStyle}>
      {/* Keyboard users reach the content without tabbing the entire header. */}
      <a href="#main" className="rl-skip">تخطَّ إلى المحتوى</a>
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

      {/* The mark sits on a plate that hangs from the top edge of the header,
          underlined by the brand gradient — the one element on the page that
          could not belong to any other company. */}
      <header className="rl-nav">
        <Link to="/" className="rl-plate" aria-label="RBT 360 — الصفحة الرئيسية"><BrandMark size={28} /></Link>
        <nav className="links" aria-label="أقسام الصفحة">
          {navLinks.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
        </nav>
        <div className="act">
          <button className="rl-icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'التبديل للوضع الفاتح' : 'التبديل للوضع الداكن'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
          </button>
          <Link to="/login" className="rl-btn ghost">تسجيل الدخول</Link>
          <Link to="/signup" className="rl-btn">إنشاء حساب</Link>
          <button className="rl-icon-btn rl-burger" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} aria-label={menuOpen ? 'إغلاق القائمة' : 'فتح القائمة'}>
            <Icon name={menuOpen ? 'close' : 'more'} />
          </button>
        </div>
      </header>
      <div className={`rl-mobnav ${menuOpen ? 'open' : ''}`}>
        {navLinks.map(([href, label]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
        {/* the header hides the login link on narrow phones — keep it reachable here */}
        <Link to="/login" style={{ padding: '13px 6px', color: 'var(--act)', fontWeight: 700, textDecoration: 'none' }} onClick={() => setMenuOpen(false)}>تسجيل الدخول</Link>
      </div>

      <main id="main">
        {flowKeys.map((k) => {
          const Sec = RENDER[k]
          if (!Sec) return null
          if (k === 'logos' && !content.logos.enabled) return null
          if (k === 'reveal' && content.reveal?.enabled === false) return null
          if (k === 'stats' && !content.stats.enabled) return null
          if (k === 'faq' && !content.faq.enabled) return null
          return <Sec key={k} c={content} pricing={pricing} />
        })}
      </main>

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
    <section className="rl-hero">
      <div className="rl-hero-bg" aria-hidden="true" />
      <div className="rl-wrap lx-hero">
        <div className="lx-hero-txt">
          <span className="rl-kicker">نظام تشغيل منشأتك</span>
          <h1>{h.title} {h.titleAccent && <span className="em">{h.titleAccent}</span>}</h1>
          <p className="rl-lead">{h.subtitle}</p>
          {/* On the permanently-dark hero the action colour inverts to white:
              a deep violet pill on near-black navy clears the text check but
              not the 3:1 boundary check against the canvas behind it. Same
              button, inverted for its surface — not a second style. */}
          <div className="rl-cta">
            <Smart href={h.ctaHref || '/signup'} className="rl-btn onDark lg">{h.ctaText}</Smart>
            {h.secondaryText && <Smart href={h.secondaryHref || '#pricing'} className="rl-btn onDark ghost lg">{h.secondaryText}</Smart>}
          </div>
          {(h.badges || []).length > 0 && (
            <div className="lx-badges">
              {h.badges.map((b) => <span key={b} className="lx-badge"><Icon name="check" size={13} className="ic" />{b}</span>)}
            </div>
          )}
          <div className="lx-tagline"><RbtTagline size={10} /></div>
        </div>
        {/* The collage SHOWS the product instead of describing it: the real
            POS component, with the two moments a venue owner actually watches
            for floating off its edges. Both satellites read the same numbers
            the mock renders — nothing here is an invented metric. */}
        <div className="lx-hero-media reveal">
          <span className="lx-hero-chip" aria-hidden="true"><RbtMark size={52} /></span>
          <div className="rl-frame"><CashierMock lang="ar" /></div>
          <div className="lx-sat s1" aria-hidden="true">
            <i><Icon name="check" size={16} /></i>
            <div><b>طلب طاولة 7</b><span>وصل المطبخ الآن</span></div>
          </div>
          <div className="lx-sat s2" aria-hidden="true">
            <i><Icon name="qr" size={16} /></i>
            <div><b>مسح ثم طلب</b><span>بدون تطبيق</span></div>
          </div>
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
        {/* Eight tint slots, cycled. Each tile gets an identity from its plate
            colour without introducing a second type style — and every glyph
            colour clears 4.5:1 on its own tint, so no tile is decorative-only. */}
        <div className="rl-fgrid reveal">
          {(f.items || []).map((it, i) => {
            const slot = (i % 8) + 1
            return (
              <article key={`${it.title}-${i}`} className="rl-feat" style={{ '--_tb': `var(--t${slot}-bg)`, '--_tf': `var(--t${slot}-fg)` }}>
                <div className="rl-fic"><Icon name={it.icon || 'star'} size={24} /></div>
                <h3>{it.title}</h3>
                <p>{it.desc}</p>
              </article>
            )
          })}
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

// The scroll-driven reveal. Deliberately placed on a panel rather than the
// page: the device is dark-framed, and it needs a surface to sit ON.
function RevealSec({ c }) {
  const r = c.reveal || {}
  const Visual = VISUALS[r.visual] || VISUALS.ops
  return (
    <section className="rl-sec rl-panel">
      <div className="rl-wrap">
        <ContainerScroll
          title={(
            <>
              {r.kicker && <span className="rl-kicker">{r.kicker}</span>}
              <h2 className="rl-h2">{r.title}</h2>
              {r.subtitle && <p className="rl-lead">{r.subtitle}</p>}
            </>
          )}
        >
          <Visual lang="ar" />
        </ContainerScroll>
      </div>
    </section>
  )
}

// Splits «+160» / «0%» into figure and unit so the unit can carry the accent
// while the figure stays ink — the small typographic move that makes a number
// read as a claim rather than as a label.
function splitFigure(v) {
  const m = String(v ?? '').match(/^([^\d]*)([\d.,]*)(.*)$/)
  if (!m) return { pre: '', fig: String(v ?? ''), post: '' }
  return { pre: m[1], fig: m[2], post: m[3] }
}

function StatsSec({ c }) {
  return (
    <section className="rl-sec pad-sm">
      <div className="rl-wrap rl-stats reveal">
        {(c.stats.items || []).map((s, i) => {
          const { pre, fig, post } = splitFigure(s.value)
          return (
            <div key={`${s.label}-${i}`} className="rl-stat">
              <div className="v num">
                {pre && <span className="u">{pre}</span>}
                <span>{fig}</span>
                {post && <span className="u">{post}</span>}
              </div>
              <div className="l">{s.label}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PricingSec({ c, pricing }) {
  const pr = c.pricing
  const [open, setOpen] = useState({})
  // Which figure the cards show. The yearly number is COMPUTED from the one
  // stored monthly price — never a second editable field, because two prices
  // for one plan is exactly how they end up disagreeing.
  const [cycle, setCycle] = useState(pr.cycleDefault === 'yearly' ? 'yearly' : 'monthly')
  const yearly = cycle === 'yearly'
  const offPct = Math.round((1 - (Number(pricing?.yearlyDiscount) || 0.8)) * 100)

  return (
    <section id="pricing" className="rl-sec rl-panel">
      <div className="rl-wrap">
        <div className="rl-head center reveal">
          <span className="rl-kicker">الباقات</span>
          <h2 className="rl-h2">{pr.title}</h2>
          {pr.subtitle && <p className="rl-lead">{pr.subtitle}</p>}
          <div className="lx-cycle" role="group" aria-label="دورة الدفع">
            {[['monthly', 'شهري'], ['yearly', 'سنوي']].map(([id, label]) => (
              <button key={id} className={cycle === id ? 'on' : ''} aria-pressed={cycle === id} onClick={() => setCycle(id)}>
                {label}
                {id === 'yearly' && <span className="off num">وفّر {offPct}%</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="rl-plans reveal">
          {PLANS.map((p) => {
            const t = pr.tiers?.[p.id] || {}
            // The live price list — the one the server bills from.
            const monthly = Number(pricing?.prices?.[p.id]) || 0
            const promo = promoOf(p.id, pricing)
            const shown = yearly ? yearlyTotal(monthly, pricing) : monthly
            // The struck original is shown in the SAME unit as the price beside
            // it. Comparing a yearly «before» against a monthly «now» is the
            // kind of arithmetic a customer notices and stops trusting.
            const was = promo ? (yearly ? yearlyTotal(promo.listPrice, pricing) : promo.listPrice) : 0
            const extra = t.more || []
            const isOpen = !!open[p.id]
            return (
              <div key={p.id} className={`rl-plan ${t.highlight ? 'feat' : ''}`}>
                {t.badge && <span className="rl-plan-badge">{t.badge}</span>}
                {t.tagline && <span className="rl-plan-tag">{t.tagline}</span>}
                <h3>{p.ar}</h3>
                <div className="lx-price">
                  <Price value={shown} lang="ar" symbolSize="0.6em" />
                  <span className="per">{yearly ? '/ سنوياً' : '/ شهرياً'}</span>
                </div>
                {promo ? (
                  <div className="lx-was">
                    <s><Price value={was} lang="ar" symbolSize="0.9em" /></s>
                    <span className="cut num">{promo.labelAr} {promo.discountPct}%</span>
                  </div>
                ) : null}
                <div className="lx-yearly">
                  {yearly
                    ? <>يعادل <Price value={Math.round(shown / 12)} lang="ar" symbolSize="0.9em" /> شهرياً</>
                    : <>أو <Price value={yearlyTotal(monthly, pricing)} lang="ar" symbolSize="0.9em" /> سنوياً بخصم <span className="num">{offPct}%</span></>}
                </div>
                <ul>
                  {(t.bullets || []).map((it) => <li key={it}><Icon name="check" size={16} className="ic" /> {it}</li>)}
                  {isOpen && extra.map((it) => <li key={it}><Icon name="add" size={16} className="ic" /> {it}</li>)}
                </ul>
                {extra.length > 0 && (
                  <button className="lx-more" onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))} aria-expanded={isOpen}>
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
          {/* Real headings, not styled <strong>. A flat outline with one h1 and
              seven h2s gives a screen-reader user no way to move between the
              questions, the features or the plans. */}
          {(c.faq.items || []).map((f, i) => (
            <div key={`${f.q}-${i}`} className="lx-faq-item">
              <h3>{f.q}</h3>
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
          <span className="lx-cta-mark" aria-hidden="true"><RbtMark size={380} mono /></span>
          <h2>{c.cta.title}</h2>
          <p>{c.cta.subtitle}</p>
          <Link to="/signup" className="rl-btn onDark lg">{c.cta.buttonText}</Link>
          <span className="lx-tagline"><RbtTagline size={10} mono /></span>
        </div>
      </div>
    </section>
  )
}

/* ============================ footer ============================ */

// Every social link needs a NAME, not just a glyph — an icon-only anchor is
// an unlabelled link to anyone using a screen reader.
const SOCIAL_AR = { whatsapp: 'واتساب', x: 'منصة إكس', instagram: 'انستقرام', tiktok: 'تيك توك', email: 'البريد الإلكتروني' }

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
            <BrandMark size={34} tagline />
            {f.about && <p className="rl-foot-about">{f.about}</p>}
            {socialLinks.length > 0 && (
              <div className="lx-social">
                {socialLinks.map((s) => (
                  <a key={s.k} href={s.href} target="_blank" rel="noreferrer" aria-label={SOCIAL_AR[s.k] || s.k}>
                    {s.icon ? <Icon name={s.icon} size={16} /> : <SocialGlyph kind={s.k} />}
                  </a>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3>روابط</h3>
            {(f.links || []).map((l, i) => <Smart key={`${l.href}-${i}`} href={l.href}>{l.label}</Smart>)}
          </div>
          <div>
            <h3>ابدأ</h3>
            <Link to="/signup">إنشاء حساب</Link>
            <Link to="/login">تسجيل الدخول</Link>
            {/* <bdi>, not dir="ltr". Setting a direction reorders the glyphs but
                leaves the element in its parent's bidi run, so the surrounding
                neutrals still get pulled around it. Isolation is what actually
                keeps a Latin address out of the Arabic column's ordering. */}
            <a href={`mailto:${SELLER_CONTACT.email}`}><bdi>{SELLER_CONTACT.email}</bdi></a>
          </div>
          <div>
            <h3>قانوني</h3>
            <Link to="/legal/terms">الشروط والأحكام</Link>
            <Link to="/legal/privacy">سياسة الخصوصية</Link>
            <Link to="/legal/refund">الاسترجاع</Link>
          </div>
        </div>

        {/* The company actually behind the brand. These are the SAME values
            stamped onto every tax invoice we issue (src/lib/platformSeller.js,
            drift-guarded against the server copy) — a buyer who checks the
            footer against the invoice must find them identical.

            EVERY Latin fragment is wrapped in <bdi>. The previous version used
            <span dir="ltr">, which sets direction WITHOUT isolating, so the
            neutral characters around it — the spaces, the full stop, the em
            dash — joined the wrong run and the line rendered as
            «…المحدودة.Wameed Al-Ibdaa Co. Ltd. — RBT 360 نشاط مسجّل تحتها»,
            with the stop jumped and the brand name displaced. The em dash was
            the worst of them: a neutral sitting exactly between two opposing
            runs has no correct side to fall on, so the fix is not only to
            isolate but to STOP BUILDING one sentence out of both scripts. Each
            fact now gets its own labelled line. */}
        <div className="lx-legal">
          <div>
            <strong>{PLATFORM_SELLER.legalNameAr}</strong>
            <bdi className="lx-legal-en">{PLATFORM_SELLER.legalNameEn}</bdi>
          </div>
          <div><span>العلامة</span> RBT 360 — نشاط مسجّل تحت السجل أدناه</div>
          <div><span>العنوان</span> {SELLER_ADDRESS_AR}</div>
          <div>
            <span>السجل التجاري</span> <bdi className="num">{PLATFORM_SELLER.crNumber}</bdi>
            <span>الرقم الضريبي</span> <bdi className="num">{PLATFORM_SELLER.vatNumber}</bdi>
            <span>الرقم الموحد</span> <bdi className="num">{PLATFORM_SELLER.unifiedNumber}</bdi>
          </div>
        </div>

        {f.showPayments !== false && (
          <div className="lx-pay">
            <span className="lbl">وسائل دفع مقبولة:</span>
            {['مدى', 'Visa', 'Mastercard', 'Apple Pay'].map((p) => <span key={p} className="chip">{p}</span>)}
          </div>
        )}
        <p className="rl-foot-copy">© 2026 {PLATFORM_SELLER.legalNameAr}. جميع الحقوق محفوظة.</p>
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

// The live kitchen board. Tickets carry their ITEMS and their elapsed time,
// because that is what a real KDS ticket carries — an order number over a table
// name is a wireframe, and it read as one: four sparse cards floating in a wide
// frame. Six populated tickets fill the same frame and, more usefully, show a
// visitor what the screen actually does.
function OrderBoardWin({ lang }) {
  const ar = lang === 'ar'
  const cols = [
    { h: ar ? 'جديد' : 'New', k: 'new', tk: [
      { no: '#142', at: ar ? 'طاولة 5' : 'Table 5', t: '0:40', items: [[ar ? 'سبانش لاتيه' : 'Spanish Latte', 2], [ar ? 'كرواسون' : 'Croissant', 1]] },
      { no: '#143', at: ar ? 'سفري' : 'Takeaway', t: '1:15', items: [[ar ? 'أمريكانو' : 'Americano', 1]] },
    ] },
    { h: ar ? 'تحضير' : 'Prep', k: 'prep', tk: [
      { no: '#141', at: ar ? 'طاولة 2' : 'Table 2', t: '3:20', items: [[ar ? 'موهيتو' : 'Mojito', 2], [ar ? 'تشيز كيك' : 'Cheesecake', 1]] },
      { no: '#140', at: ar ? 'طاولة 9' : 'Table 9', t: '4:05', items: [[ar ? 'فلات وايت' : 'Flat White', 1]] },
    ] },
    { h: ar ? 'جاهز' : 'Ready', k: 'done', tk: [
      { no: '#139', at: ar ? 'طاولة 8' : 'Table 8', t: '6:10', items: [[ar ? 'قهوة مقطرة' : 'Filter Coffee', 2]] },
      { no: '#138', at: ar ? 'توصيل' : 'Delivery', t: '7:45', items: [[ar ? 'تشيز كيك' : 'Cheesecake', 1], [ar ? 'موهيتو' : 'Mojito', 1]] },
    ] },
  ]
  return (
    <div className="r-win">
      <div className="r-win-bar"><span className="d" /><span className="d" /><span className="d" /><span className="t">{ar ? 'شاشة المطبخ · مباشر' : 'Kitchen display · live'}</span></div>
      <div className="r-win-body">
        {cols.map((c) => (
          <div key={c.h}>
            <div className="r-col-h"><span>{c.h}</span><span className="num">{c.tk.length}</span></div>
            {c.tk.map((tk) => (
              <div key={tk.no} className={`r-tk is-${c.k}`}>
                <div className="r-tk-h">
                  <b className="num">{tk.no}</b>
                  <span>{tk.at}</span>
                  <i className="num">{tk.t}</i>
                </div>
                {tk.items.map(([n, q]) => (
                  <div key={n} className="r-tk-i"><span className="num">{q}×</span> {n}</div>
                ))}
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
            <strong>{ar ? 'مقهى الرصيف' : 'Rasif Coffee'}</strong>
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
