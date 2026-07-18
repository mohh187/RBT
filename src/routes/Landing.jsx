import { useEffect, useState, Fragment } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { BrandMark } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { Price } from '../components/Riyal.jsx'
import '../landing.css'

export default function Landing() {
  const { t, lang, toggleLang, theme, toggleTheme } = useI18n()
  const { user, tenantId, loading } = useAuth()
  const navigate = useNavigate()
  const ar = lang === 'ar'
  const L = (a, e) => (ar ? a : e)

  const [bar, setBar] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showTop, setShowTop] = useState(false)
  const [faq, setFaq] = useState(0)
  const [bizName, setBizName] = useState('')
  const [bizPhone, setBizPhone] = useState('')

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }),
      { threshold: 0.12 },
    )
    document.querySelectorAll('.rl .reveal').forEach((el) => io.observe(el))
    const onScroll = () => setShowTop(window.scrollY > 640)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { io.disconnect(); window.removeEventListener('scroll', onScroll) }
  }, [])

  // Signed-in visitors are NOT auto-redirected — the landing stays browsable;
  // a slim banner offers the dashboard instead.
  const sessionTarget = !loading && user ? (tenantId ? '/admin' : '/onboarding') : ''

  const stats = [
    { v: '0%', l: L('عمولة على أي طلب', 'commission per order') },
    { v: '+20', l: L('وحدة متكاملة', 'integrated modules') },
    { v: 'ZATCA', l: L('فوترة متوافقة', 'compliant e-invoicing') },
    { v: '∞', l: L('طاولات وأصناف', 'tables & items') },
  ]

  const trust = [
    L('فوترة متوافقة مع زاتكا (ZATCA)', 'ZATCA-ready invoicing'),
    L('عربي أولاً · واجهة تدعم RTL', 'Arabic-first · RTL'),
    L('بدون أي عمولة على طلباتك', 'Zero order commission'),
    L('يعمل على أي جوال أو تابلت', 'Runs on any device'),
  ]

  const problems = [
    { icon: 'clock', ar: ['الطلب اليدوي يبطّئك', 'الورق والتنقّل بين الطاولات يؤخّر الخدمة ويربك المطبخ.'], en: ['Manual orders slow you', 'Paper and back-and-forth delay service and confuse the kitchen.'] },
    { icon: 'wallet', ar: ['العمولات تأكل ربحك', 'تطبيقات التوصيل تقتطع نسبة من كل طلب، وربحك يتآكل.'], en: ['Commissions eat profit', 'Delivery apps take a cut of every order, and your margin shrinks.'] },
    { icon: 'inventory', ar: ['هدر لا تراه', 'بدون مخزون دقيق لن تعرف تكلفتك الحقيقية ولا أين يضيع مالك.'], en: ['Waste you can’t see', 'Without real inventory you won’t know your true cost or where money leaks.'] },
  ]

  // Real, shipped modules only (verified against the codebase).
  const features = [
    { icon: 'qr', ar: ['طلب QR لكل طاولة', 'يُوسَم الطلب بالطاولة تلقائياً — أو استلام وسفري.'], en: ['Per-table QR ordering', 'Auto-tagged to the table — plus pickup & takeaway.'] },
    { icon: 'car', ar: ['توصيل واستلام للسيارة', 'نوع طلب توصيل بعنوان وموقع ورسوم — واستلام للسيارة.'], en: ['Delivery & curbside', 'Delivery with address, GPS & fees — plus car pickup.'] },
    { icon: 'award', ar: ['ولاء وعضوية VIP', 'بطاقة رقمية، نقاط، فئات، ومكافآت «اشترِ N واحصل على واحدة».'], en: ['Loyalty & VIP', 'Digital card, points, tiers, and stamp rewards.'] },
    { icon: 'offers', ar: ['عروض وكوبونات', 'خصومات مجدولة، أكواد، وعروض للأعضاء فقط.'], en: ['Offers & coupons', 'Scheduled discounts, codes, members-only deals.'] },
    { icon: 'customers', ar: ['قاعدة عملاء (CRM)', 'زيارات، تقييمات، تنبيهات — واعرف عملاءك.'], en: ['Customer CRM', 'Visits, ratings, flags — know your guests.'] },
    { icon: 'events', ar: ['فعاليات وتذاكر', 'بطاقات QR ومسح دخول للمناسبات.'], en: ['Events & ticketing', 'QR passes with door check-in.'] },
    { icon: 'reservations', ar: ['حجوزات الطاولات', 'استقبل طلبات الحجز وأدرها من لوحتك.'], en: ['Reservations', 'Take and manage table bookings.'] },
    { icon: 'palette', ar: ['مكتبة ثيمات وسكنات', 'عشرات الثيمات والتخطيطات والخلفيات والعلامة المائية.'], en: ['Themes & skins library', 'Dozens of themes, layouts, backgrounds & watermark.'] },
    { icon: 'staff', ar: ['طاقم وموارد بشرية', 'حضور بموقع، ورديات، رواتب وخصومات، وأداء.'], en: ['Staff & HR', 'Geofenced attendance, shifts, payroll, performance.'] },
    { icon: 'key', ar: ['أدوار وصلاحيات', '9 أدوار ومصفوفة صلاحيات دقيقة لكل موظف.'], en: ['Roles & permissions', '9 roles + granular per-staffer capabilities.'] },
    { icon: 'file', ar: ['فواتير ZATCA', 'ضريبة القيمة المضافة ورمز فاتورة متوافق تلقائياً.'], en: ['ZATCA invoices', 'VAT + compliant e-invoice QR, automatic.'] },
    { icon: 'bellRing', ar: ['إشعارات وواتساب', 'صوت وإشعار لكل طلب — وتحديثات واتساب وبريد للعميل.'], en: ['Alerts & WhatsApp', 'Sound + push per order — WhatsApp & email to guests.'] },
  ]

  const faqs = [
    { ar: ['كيف يطلب العميل؟', 'يمسح رمز QR على طاولته، يتصفّح المنيو، ويرسل الطلب — فيصل فوراً للكاشير والمطبخ.'], en: ['How do guests order?', 'They scan the table QR, browse, and send — it reaches cashier & kitchen instantly.'] },
    { ar: ['هل أحتاج جهازاً خاصاً؟', 'لا. يعمل على أي جوال أو تابلت أو كمبيوتر عبر المتصفح، ويمكن تثبيته كتطبيق.'], en: ['Do I need special hardware?', 'No — any phone, tablet or computer via the browser; installs as an app.'] },
    { ar: ['هل المخزون حقيقي؟', 'نعم — مواد خام بوحداتها، وصفات ومكوّنات، تكلفة، وخصم تلقائي من المخزون عند دفع كل طلب.'], en: ['Is inventory real?', 'Yes — raw materials, recipes/BOM, costing, and auto-deduction on every paid order.'] },
    { ar: ['وماذا عن المساعد الذكي؟', 'مساعد يفهم أوامرك ويشغّل النظام نيابةً عنك — بعد ربط مفتاح Gemini الخاص بك.'], en: ['And the AI assistant?', 'An assistant that understands you and operates the system — once your Gemini key is linked.'] },
    { ar: ['هل يدعم العربية والإنجليزية؟', 'نعم، الواجهة والمنيو ثنائيا اللغة مع تبديل فوري ودعم كامل لليمين‑لليسار.'], en: ['Arabic & English?', 'Yes — fully bilingual UI & menu with instant switch and RTL.'] },
    { ar: ['هل الفوترة متوافقة مع الضريبة؟', 'نعم، فاتورة ضريبية مبسّطة مع رمز ZATCA وضريبة القيمة المضافة عند إدخال رقمك الضريبي.'], en: ['ZATCA-compliant billing?', 'Yes — simplified tax invoice with ZATCA QR and VAT once your VAT number is set.'] },
  ]

  // Real 4-tier structure from src/lib/plans.js (menu / ops / pro / enterprise).
  const plans = [
    { name: L('منيو', 'Menu'), tag: L('للبداية', 'To start'), featured: false, items: [L('منيو رقمي ثنائي اللغة', 'Bilingual digital menu'), L('طلب QR لكل طاولة', 'Per-table QR ordering'), L('هوية بصرية أساسية', 'Basic branding'), L('صفحة المنشأة والقصص', 'Venue profile & stories')] },
    { name: L('منيو + تشغيل', 'Operations'), tag: L('الأنسب لمقهى يعمل', 'For a working venue'), featured: true, items: [L('كل ما في «منيو»', 'Everything in Menu'), L('كاشير ومطبخ لحظي (KDS)', 'Live cashier & kitchen'), L('طاولات وطلبات وحجوزات', 'Tables, orders & reservations'), L('توصيل واستلام للسيارة', 'Delivery & curbside'), L('عروض وكوبونات وولاء', 'Offers, coupons & loyalty')] },
    { name: L('احترافي', 'Pro'), tag: L('لعلامة تلفت الأنظار', 'For a standout brand'), featured: false, items: [L('كل ما في «تشغيل»', 'Everything in Operations'), L('مكتبة الثيمات والسكنات', 'Themes & skins library'), L('خلفيات وعلامة مائية', 'Backgrounds & watermark'), L('استوديو الشاشات والموسيقى', 'Signage studio & music'), L('فعاليات وتذاكر', 'Events & ticketing')] },
    { name: L('متكامل', 'Enterprise'), tag: L('تشغيل كامل بلا حدود', 'Full operation'), featured: false, items: [L('كل ما في «احترافي»', 'Everything in Pro'), L('طاقم كامل: حضور وورديات ورواتب', 'Full HR: attendance, shifts, payroll'), L('أدوار وصلاحيات متقدمة', 'Advanced roles & permissions'), L('مخزون ووصفات (BOM) دقيق', 'Real inventory & recipes'), L('مساعد ذكي وتقارير متقدمة', 'AI assistant & advanced reports')] },
  ]

  const nav = [
    ['#features', L('المزايا', 'Features')],
    ['#flow', L('كيف تعمل', 'How it works')],
    ['#pricing', L('الباقات', 'Pricing')],
    ['#faq', L('الأسئلة', 'FAQ')],
  ]

  return (
    <div className="rl">
      {sessionTarget && (
        <div className="rl-session">
          <span>{L('أنت مسجّل الدخول بالفعل', 'You are already signed in')}</span>
          <Link to={sessionTarget} className="rl-btn" style={{ padding: '8px 16px' }}>{L(tenantId ? 'الدخول للوحتك' : 'أكمل إنشاء منشأتك', tenantId ? 'Open dashboard' : 'Finish setup')}</Link>
        </div>
      )}
      {bar && (
        <div className="rl-annc">
          <Icon name="sparkles" size={15} />
          <span>{L('كل المزايا مجاناً خلال فترة الإطلاق — ابدأ اليوم', 'Every feature free during launch — start today')}</span>
          <button className="x" onClick={() => setBar(false)} aria-label="close"><Icon name="close" size={15} /></button>
        </div>
      )}

      <header className="rl-nav">
        <BrandMark />
        <nav className="links">
          {nav.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
        </nav>
        <div className="act">
          <button className="rl-icon-btn" onClick={toggleTheme} aria-label="theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} /></button>
          <button className="rl-icon-btn" onClick={toggleLang} aria-label="language">{ar ? 'EN' : 'ع'}</button>
          <Link to="/login" className="rl-btn ghost" style={{ padding: '9px 16px' }}>{t('login')}</Link>
          <Link to="/signup" className="rl-btn" style={{ padding: '9px 18px' }}>{L('ابدأ مجاناً', 'Start free')}</Link>
          <button className="rl-icon-btn rl-burger" onClick={() => setMenuOpen((v) => !v)} aria-label="menu"><Icon name={menuOpen ? 'close' : 'more'} /></button>
        </div>
      </header>
      <div className={`rl-mobnav ${menuOpen ? 'open' : ''}`}>
        {nav.map(([href, label]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
        {/* the header hides the login link on narrow phones — keep it reachable here */}
        <Link to="/login" style={{ padding: '13px 6px', color: 'var(--brand)', fontWeight: 700, textDecoration: 'none' }} onClick={() => setMenuOpen(false)}>{t('login')}</Link>
      </div>

      {/* hero */}
      <section className="rl-hero">
        <div className="rl-hero-bg" aria-hidden="true" />
        <div className="rl-wrap rl-hero-in">
          <span className="rl-kicker">{L('نظام تشغيل مقهاك ومطعمك', 'Café & restaurant OS')}</span>
          <h1>{L('شغّل مقهاك كله', 'Run your whole venue')} <span className="em">{L('من نظام واحد', 'from one system')}</span></h1>
          <p className="rl-lead">{L('من المنيو والطلب بالباركود، إلى الكاشير والمطبخ اللحظي، إلى المخزون والمساعد الذكي — تشغيل مقهاك كامل في نظام واحد عربي، وبدون أي عمولة على طلباتك.', 'From QR menu & ordering to a live cashier & kitchen to real inventory and an AI assistant — your whole venue in one Arabic-first system, with zero commission on orders.')}</p>
          <div className="rl-cta">
            <Link to="/signup" className="rl-btn lg">{L('ابدأ الآن مجاناً', 'Start free now')}</Link>
            <a href="#features" className="rl-btn ghost lg">{L('استعرض المزايا', 'See features')}</a>
          </div>
          <p className="rl-hero-note">{L('بدون بطاقة ائتمان · جاهز خلال دقائق', 'No credit card · ready in minutes')}</p>
        </div>
        <div className="rl-wrap rl-hero-media reveal">
          <div className="rl-frame"><CashierMock lang={lang} /></div>
        </div>
      </section>

      {/* trust */}
      <section className="rl-sec pad-sm rl-panel">
        <div className="rl-wrap rl-trust reveal">
          {trust.map((it) => <span key={it}><Icon name="check" size={15} className="ic" />{it}</span>)}
        </div>
      </section>

      {/* problem */}
      <section className="rl-sec">
        <div className="rl-wrap">
          <div className="rl-head center reveal">
            <span className="rl-kicker">{L('المشكلة', 'The problem')}</span>
            <h2 className="rl-h2">{L('الإدارة اليدوية تُبطئك، والعمولات والهدر يأكلان أرباحك', 'Manual ops slow you; commissions and waste eat your profit')}</h2>
          </div>
          <div className="rl-p3 reveal">
            {problems.map((p) => (
              <div key={p.en[0]} className="rl-pcard">
                <div className="rl-fic"><Icon name={p.icon} size={22} /></div>
                <strong>{L(p.ar[0], p.en[0])}</strong>
                <p>{L(p.ar[1], p.en[1])}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* showcase: cashier */}
      <section className="rl-sec rl-panel">
        <div className="rl-wrap rl-show reveal">
          <div className="rl-show-txt">
            <span className="rl-kicker">{L('نقطة البيع', 'Point of sale')}</span>
            <h2 className="rl-h2">{L('كاشير سريع يعمل باللمس', 'A fast, touch-first cashier')}</h2>
            <p className="rl-lead">{L('انقر الصنف فيدخل الفاتورة، اختر الحجم والإضافات، طبّق الخصم، وأرسل للمطبخ — من التابلت أو الكمبيوتر.', 'Tap an item to the ticket, pick size & add-ons, apply a discount, send to the kitchen — on tablet or desktop.')}</p>
            {[L('بطاقات أصناف باللمس مع الأحجام والإضافات.', 'Touch item cards with sizes & modifiers.'), L('نقد، مدى/شبكة، أو تحويل — وطلبات معلّقة وبيع سريع.', 'Cash, mada/card or transfer — held orders & quick sale.'), L('لوحة حالات قابلة للسحب تصل المطبخ لحظياً.', 'Draggable status board, live to the kitchen.')].map((c) => (
              <div key={c} className="rl-check"><Icon name="check" size={20} className="ic" /><span>{c}</span></div>
            ))}
          </div>
          <div className="rl-show-media"><OrderBoardWin lang={lang} /></div>
        </div>
      </section>

      {/* features grid */}
      <section id="features" className="rl-sec">
        <div className="rl-wrap">
          <div className="rl-head center reveal">
            <span className="rl-kicker">{L('المزايا', 'Features')}</span>
            <h2 className="rl-h2">{L('كل ما يحتاجه مقهاك أو مطعمك', 'Everything your venue needs')}</h2>
            <p className="rl-lead">{L('أكثر من عشرين وحدة متكاملة تعمل معاً — لا أدوات متفرقة.', 'Twenty-plus modules that work as one — not scattered tools.')}</p>
          </div>
          <div className="rl-fgrid reveal">
            {features.map((f, i) => (
              <div key={f.en[0]} className="rl-feat">
                <div className="rl-feat-top">
                  <div className="rl-fic"><Icon name={f.icon} size={22} /></div>
                  <span className="no">{String(i + 1).padStart(2, '0')}</span>
                </div>
                <strong>{L(f.ar[0], f.en[0])}</strong>
                <p>{L(f.ar[1], f.en[1])}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* showcase: customization */}
      <section className="rl-sec rl-panel">
        <div className="rl-wrap rl-show rev reveal">
          <div className="rl-show-txt">
            <span className="rl-kicker">{L('التخصيص', 'Make it yours')}</span>
            <h2 className="rl-h2">{L('خصّص كل شيء — أو ابنِ ثيمك الخاص', 'Customize everything — or build your own theme')}</h2>
            <p className="rl-lead">{L('عشرات الثيمات والسكنات الجاهزة للمنيو ولواجهات النظام كلها: الكاشير والمطبخ ولوحة الإدارة — بألوان وخطوط وتخطيطات وخلفيات وعلامة مائية.', 'Dozens of ready themes & skins — for the menu and every system surface: cashier, kitchen, admin — with colors, fonts, layouts, backgrounds & watermark.')}</p>
            {[L('ثيمات كاملة تعيد تلوين النظام كله بنقرة.', 'Full themes reskin the whole system in one click.'), L('عشرات تخطيطات وسكنات المنيو — أو صمّم واحداً.', 'Dozens of menu layouts & skins — or design your own.'), L('خطوط، حواف، حركة، خلفيات، وعلامة مائية.', 'Fonts, corners, motion, backgrounds & watermark.')].map((c) => (
              <div key={c} className="rl-check"><Icon name="check" size={20} className="ic" /><span>{c}</span></div>
            ))}
          </div>
          <div className="rl-show-media"><ThemeSwap lang={lang} /></div>
        </div>
      </section>

      {/* showcase: AI + inventory */}
      <section className="rl-sec">
        <div className="rl-wrap rl-show reveal">
          <div className="rl-show-txt">
            <span className="rl-kicker">{L('ذكاء + مخزون', 'AI + inventory')}</span>
            <h2 className="rl-h2">{L('مخزون دقيق، يديره مساعد ذكي', 'Real inventory, run by an AI assistant')}</h2>
            <p className="rl-lead">{L('مواد خام بوحداتها ووصفات لكل صنف، وتكلفة محسوبة تلقائياً. يُخصم المخزون فور دفع الطلب — والمساعد الذكي ينفّذ أوامرك ويحذّرك قبل النفاد.', 'Raw materials with units, a recipe per item, and auto-calculated cost. Stock deducts the moment an order is paid — and the AI assistant acts on your words and warns before you run out.')}</p>
            {[L('وصفات ومكوّنات فرعية وتحويل وحدات وتكلفة متوسطة.', 'Recipes, sub-recipes, unit conversion & weighted cost.'), L('خصم تلقائي عند الدفع، وجرد وهدر وتباين.', 'Auto-deduct on pay, plus counts, waste & variance.'), L('تنبيه نفاد المخزون، ومساعد ينفّذ ويُعدّل بالأوامر.', 'Low-stock alerts, and an assistant that executes commands.')].map((c) => (
              <div key={c} className="rl-check"><Icon name="check" size={20} className="ic" /><span>{c}</span></div>
            ))}
          </div>
          <div className="rl-show-media"><InventoryMock lang={lang} /></div>
        </div>
      </section>

      {/* flow */}
      <section id="flow" className="rl-sec rl-panel">
        <div className="rl-wrap">
          <div className="rl-head center reveal">
            <span className="rl-kicker">{L('نظام واحد', 'One system')}</span>
            <h2 className="rl-h2">{L('نظام واحد، تدفّق واحد', 'One system, one flow')}</h2>
          </div>
          <div className="reveal"><FlowDiagram lang={lang} /></div>
        </div>
      </section>

      {/* showcase: signage */}
      <section className="rl-sec">
        <div className="rl-wrap rl-show rev reveal">
          <div className="rl-show-txt">
            <span className="rl-kicker">{L('الشاشات', 'Signage')}</span>
            <h2 className="rl-h2">{L('استوديو شاشات بموسيقى', 'A signage studio with music')}</h2>
            <p className="rl-lead">{L('حوّل أي شاشة إلى لوحة عرض حية: شرائح تسحب اسم وسعر الصنف والعرض النشط تلقائياً، انتقالات وجدولة بالساعة، وموسيقى خلفية بقوائم تشغيل.', 'Turn any screen into a live board: slides that pull item names, prices and the active offer, timed transitions & scheduling, and background music with playlists.')}</p>
            {[L('ربط حي بالمنيو والعروض + طبقة QR وقوالب جاهزة.', 'Live menu/offer binding + QR layer & templates.'), L('انتقالات وحركة وجدولة صباحية/مسائية.', 'Transitions, motion & morning/evening scheduling.'), L('موسيقى خلفية بقوائم مسمّاة وتحكّم عن بُعد.', 'Background music, named playlists & remote control.')].map((c) => (
              <div key={c} className="rl-check"><Icon name="check" size={20} className="ic" /><span>{c}</span></div>
            ))}
          </div>
          <div className="rl-show-media"><SignageMock lang={lang} /></div>
        </div>
      </section>

      {/* stats */}
      <section className="rl-sec pad-sm">
        <div className="rl-wrap rl-stats reveal">
          {stats.map((s) => (<div key={s.l} className="rl-stat"><div className="v">{s.v}</div><div className="l">{s.l}</div></div>))}
        </div>
      </section>

      {/* pricing */}
      <section id="pricing" className="rl-sec rl-panel">
        <div className="rl-wrap">
          <div className="rl-head center reveal">
            <span className="rl-kicker">{L('الباقات', 'Pricing')}</span>
            <h2 className="rl-h2">{L('ابدأ صغيراً، وطوّر حسب نموّك', 'Start small, scale as you grow')}</h2>
            <p className="rl-lead">{L('أربع باقات متدرّجة — وكل المزايا مفتوحة مجاناً خلال فترة الإطلاق.', 'Four tiers — and every feature is unlocked free during launch.')}</p>
          </div>
          <div className="rl-plans reveal">
            {plans.map((p) => (
              <div key={p.name} className={`rl-plan ${p.featured ? 'feat' : ''}`}>
                {p.featured && <span className="rl-plan-badge">{L('الأكثر شيوعاً', 'Most popular')}</span>}
                <span className="rl-plan-tag">{p.tag}</span>
                <h3>{p.name}</h3>
                <div className="rl-plan-price"><strong>{L('مجاناً', 'Free')}</strong><span>{L('خلال فترة الإطلاق', 'during launch')}</span></div>
                <ul>{p.items.map((it) => (<li key={it}><Icon name="check" size={16} className="ic" /> {it}</li>))}</ul>
                <Link to="/signup" className={`rl-btn ${p.featured ? '' : 'ghost'} block`}>{L('ابدأ الآن', 'Start now')}</Link>
              </div>
            ))}
          </div>
          <p className="rl-fineprint reveal">{L('بعض المزايا (المساعد الذكي، واتساب، النطاق المخصّص) تحتاج ربط مفتاحك أو إعداداً بسيطاً.', 'A few features (AI assistant, WhatsApp, custom domain) need your key or a quick setup.')}</p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="rl-sec">
        <div className="rl-wrap">
          <div className="rl-head center reveal">
            <span className="rl-kicker">{L('الأسئلة الشائعة', 'FAQ')}</span>
            <h2 className="rl-h2">{L('أسئلة متكررة', 'Common questions')}</h2>
          </div>
          <div className="rl-faq reveal">
            {faqs.map((f, i) => (
              <div key={i} className="rl-faq-item">
                <button className="rl-faq-q" onClick={() => setFaq(faq === i ? -1 : i)}>
                  <span>{L(f.ar[0], f.en[0])}</span>
                  <Icon name={faq === i ? 'close' : 'add'} size={18} className="ic" />
                </button>
                {faq === i && <div className="rl-faq-a">{L(f.ar[1], f.en[1])}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* try now */}
      <section className="rl-sec rl-panel">
        <div className="rl-wrap rl-show reveal">
          <div className="rl-show-txt">
            <h2 className="rl-h2">{L('جرّب الآن في دقيقة', 'Try it in a minute')}</h2>
            <p className="rl-lead">{L('أنشئ حسابك وابدأ استقبال الطلبات اليوم — مجاناً خلال الإطلاق.', 'Create your account and start taking orders today — free during launch.')}</p>
            <div className="rl-cta" style={{ justifyContent: 'flex-start' }}><Link to="/signup" className="rl-btn lg">{L('ابدأ الآن مجاناً', 'Start free now')}</Link></div>
          </div>
          {/* carry what the visitor already typed into signup — don't discard it */}
          <form className="rl-tryform" onSubmit={(e) => { e.preventDefault(); const q = new URLSearchParams(); if (bizName.trim()) q.set('venue', bizName.trim()); if (bizPhone.trim()) q.set('phone', bizPhone.trim()); navigate(`/signup${q.toString() ? `?${q}` : ''}`) }}>
            <strong style={{ fontSize: '1.1rem' }}>{L('جرّب الآن', 'Try it now')}</strong>
            <div className="field"><label>{L('اسم المنشأة', 'Venue name')}</label><input className="rl-input" value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder={L('مثال: كافيه نيمة', 'e.g. Neema Café')} /></div>
            <div className="field"><label>{t('phone')}</label><input className="rl-input" dir="ltr" inputMode="tel" value={bizPhone} onChange={(e) => setBizPhone(e.target.value)} placeholder="05xxxxxxxx" /></div>
            <button className="rl-btn block lg" style={{ marginTop: 16 }}>{L('ابدأ الآن', 'Start now')} <Icon name={ar ? 'back' : 'next'} size={16} /></button>
          </form>
        </div>
      </section>

      {/* final CTA */}
      <section className="rl-sec">
        <div className="rl-wrap">
          <div className="rl-ctaband reveal">
            <h2>{L('حرّر منشأتك من التعقيد', 'Free your venue from friction')}</h2>
            <p>{L('منيو، طلب QR، كاشير، مخزون، ومساعد ذكي — ابدأ اليوم مجاناً.', 'Menu, QR ordering, cashier, inventory & AI — start today, free.')}</p>
            <Link to="/signup" className="rl-btn lg">{L('ابدأ الآن مجاناً', 'Start free now')}</Link>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="rl-foot">
        <div className="rl-wrap">
          <div className="rl-foot-grid">
            <div>
              <BrandMark />
              <p style={{ color: 'var(--ink-2)', maxWidth: 300, marginTop: 10, fontSize: '0.9rem' }}>{t('tagline')}</p>
            </div>
            <div>
              <strong>{L('روابط', 'Links')}</strong>
              <a href="#features">{L('المزايا', 'Features')}</a>
              <a href="#pricing">{L('الباقات', 'Pricing')}</a>
              <a href="#faq">{L('الأسئلة', 'FAQ')}</a>
            </div>
            <div>
              <strong>{L('ابدأ', 'Get started')}</strong>
              <Link to="/signup">{L('إنشاء حساب', 'Sign up')}</Link>
              <Link to="/login">{t('login')}</Link>
            </div>
            <div>
              <strong>{L('قانوني', 'Legal')}</strong>
              <Link to="/legal/terms">{L('الشروط والأحكام', 'Terms')}</Link>
              <Link to="/legal/privacy">{L('سياسة الخصوصية', 'Privacy')}</Link>
              <Link to="/legal/refund">{L('الاسترجاع', 'Refund')}</Link>
              <Link to="/status">{L('حالة المنصة', 'Status')}</Link>
            </div>
          </div>
          <p className="rl-foot-copy">© 2026 rbt360. {L('جميع الحقوق محفوظة.', 'All rights reserved.')}</p>
        </div>
      </footer>

      <button className={`rl-top ${showTop ? 'show' : ''}`} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="top"><Icon name="back" size={20} style={{ transform: 'rotate(90deg)' }} /></button>
    </div>
  )
}

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

